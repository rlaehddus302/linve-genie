// 인스타그램 시험 도우미 (N2). 가짜 메타 서버(127.0.0.1의 빈 포트, 실제 HTTP)에 실제 어댑터가 붙는다. 서버 시계·가짜 서버 시계는 같은 주입 시계다.
// DM 실행기는 스스로 돌지 않는다(dmAutoRun: false) — 시험이 시계를 옮기고 drain()을 부른다.
import { expect } from 'vitest'
import type { InstagramLogin, InstagramTimeouts } from '../src/instagram/config.ts'
import { FakeMeta, type FakeAccount, type FakeAccountType, type FakeChange, type WebhookTarget } from '../src/instagram/fake-meta.ts'
import type { ServerOptions } from '../src/server.ts'
import { MERGED_BODY, RAW_JOIN, addSeller, client, fakeClock, newWorld, rid, type FakeClock, type Seller, type TestServer } from './support.ts'

export const REDIRECT_URI = 'https://api.livejjim.test/api/instagram/callback'

/**
 * 시험의 메타 호출 시간 제한 (SA-N2-007). 운영값(보내기 10초·대화 조회 30초)보다 짧지만, 부하가 걸린 병렬 실행에서도 정상 호출이 시간 초과로
 * 거짓 실패하지 않을 만큼 둔다. 시간 초과 자체를 보는 시험(가짜 서버가 응답하지 않음 — HANG·HANG_AFTER)만 SHORT_SEND_TIMEOUT으로 보내기를 줄인다.
 */
export const TEST_TIMEOUTS: InstagramTimeouts = { requestMs: 5000, sendMs: 5000, confirmMs: 5000 }
/** 보내기 시간 초과를 직접 보는 시험용 — 대화 조회·그 밖 호출은 TEST_TIMEOUTS 그대로 */
export const SHORT_SEND_TIMEOUT: Partial<InstagramTimeouts> = { sendMs: 400 }

export interface IgWorld extends TestServer {
  readonly fake: FakeMeta
  readonly clock: FakeClock
  /** 받은 SSE instagram 알림 (판매자마다) */
  readonly published: { sellerId: string; data: Record<string, unknown> }[]
  close(): Promise<void>
}

export async function igWorld(
  options: { readonly login?: InstagramLogin; readonly timeouts?: Partial<InstagramTimeouts>; readonly configured?: boolean; readonly overrides?: Omit<Partial<ServerOptions>, 'clock'> } = {},
): Promise<IgWorld> {
  const clock = fakeClock()
  const fake = await FakeMeta.start({ now: () => clock.now() })
  const world = await newWorld({
    clock,
    instagram: options.configured === false ? null : fake.settings({ redirectUri: REDIRECT_URI, login: options.login ?? 'FACEBOOK', timeouts: { ...TEST_TIMEOUTS, ...options.timeouts } }),
    dmAutoRun: false,
    // 수집 상태 알림은 묶어서 보낸다 (운영 1초 — 시험은 25밀리초로 줄인다)
    collectionIntervalMs: 25,
    ...options.overrides,
  })
  const published: { sellerId: string; data: Record<string, unknown> }[] = []
  const original = world.server.hub.publishInstagram.bind(world.server.hub)
  world.server.hub.publishInstagram = (sellerId, data) => {
    published.push({ sellerId, data: data as Record<string, unknown> })
    original(sellerId, data)
  }
  return {
    ...world,
    clock,
    fake,
    published,
    close: async () => {
      world.server.close()
      await fake.close()
      await world.database.close()
    },
  }
}

/** 웹훅을 받는 쪽 (포트 없이 app.request) */
export function webhookTarget(world: TestServer): WebhookTarget {
  return async (body, headers) => world.server.app.request('/webhooks/instagram', { method: 'POST', headers: { ...headers }, body })
}

/** 연결 시작 → 가짜 승인 창 → 돌아오기. 화면 주소에 붙은 결과 코드를 돌려준다 */
export async function connectInstagram(
  ig: IgWorld,
  seller: Seller,
  scenario: { readonly accounts: readonly string[]; readonly declined?: readonly string[]; readonly decision?: 'approve' | 'deny' },
  path: '/api/instagram/connect' | 'consent' = '/api/instagram/connect',
): Promise<string> {
  const api = client(ig, seller.cookie)
  const started = path === 'consent' ? await api.post('/api/instagram/consent', { on: true }) : await api.post(path, {})
  expect(started.status, started.text).toBe(200)
  const url = started.body.url as string
  ig.fake.setLogin({ decision: scenario.decision ?? 'approve', accounts: scenario.accounts, declined: scenario.declined ?? [] })
  const location = await ig.fake.authorize(url)
  return callback(ig, seller.cookie, location)
}

/** 돌아오는 주소 부르기 (쿠키는 그 세션의 것 또는 없음) */
export async function callback(ig: TestServer, cookie: string | null, location: string): Promise<string> {
  const target = new URL(location)
  const response = await ig.server.app.request(`${target.pathname}${target.search}`, { headers: cookie === null ? {} : { Cookie: cookie } })
  expect(response.status).toBe(302)
  const back = new URL(response.headers.get('location') ?? '')
  return back.searchParams.get('instagram') ?? ''
}

export interface Shop {
  readonly seller: Seller
  readonly account: FakeAccount
}

/** 판매자 하나와 연결한 가짜 계정 하나 (동의를 켜려면 consent: true) */
export async function connectedShop(ig: IgWorld, options: { readonly username?: string; readonly type?: FakeAccountType; readonly consent?: boolean; readonly declined?: readonly string[] } = {}): Promise<Shop> {
  const seller = await addSeller(ig)
  const account = ig.fake.addAccount({ username: options.username ?? `shop.${seller.loginId}`, type: options.type ?? 'BUSINESS' })
  expect(await connectInstagram(ig, seller, { accounts: [account.id], declined: options.declined ?? [] })).toBe('CONNECTED')
  if (options.consent === true) {
    const on = await client(ig, seller.cookie).post('/api/instagram/consent', { on: true })
    expect(on.status, on.text).toBe(200)
    expect((on.body.connection as { consent: { on: boolean } }).consent.on).toBe(true)
  }
  return { seller, account }
}

/** 실제 방송 하나 만들기 (설정 덮어쓰기는 방송을 만들기 전에) */
export async function liveBroadcast(ig: TestServer, seller: Seller, settings?: Record<string, unknown>): Promise<string> {
  const api = client(ig, seller.cookie)
  if (settings !== undefined) expect((await api.patch('/api/settings', { settings })).status).toBe(200)
  const created = await api.post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-19' })
  expect(created.status, created.text).toBe(200)
  return (created.body.broadcast as { id: string }).id
}

/** 회차를 라이브에 잇기 (성공을 기대한다) */
export async function linkLive(ig: TestServer, seller: Seller, broadcast: string, liveId: string): Promise<void> {
  const linked = await client(ig, seller.cookie).post(`/api/broadcasts/${broadcast}/live/link`, { requestId: rid('link'), platform: 'INSTAGRAM', liveId })
  expect(linked.status, linked.text).toBe(200)
}

/** 상품 등록 */
export async function register(ig: TestServer, seller: Seller, b: string, no: number, name: string, price: number, extra: Record<string, unknown> = {}): Promise<void> {
  const response = await client(ig, seller.cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name, price, ...extra })
  expect(response.status, response.text).toBe(200)
}

/** 댓글들을 웹훅 하나로 보낸다 (응답 상태 코드) */
export async function sendComments(
  ig: IgWorld,
  account: FakeAccount,
  liveId: string,
  comments: readonly { readonly igsid: string; readonly username: string; readonly text: string; readonly id?: string }[],
  options: { readonly time?: number } = {},
): Promise<{ status: number; changes: FakeChange[] }> {
  const changes = comments.map((comment) => ig.fake.comment({ accountId: account.id, liveId, ...comment }))
  const body = ig.fake.payload([{ accountId: account.id, ...(options.time === undefined ? {} : { time: options.time }), changes }])
  const response = await ig.fake.deliver(webhookTarget(ig), body)
  return { status: response.status, changes }
}

/** 범위의 채팅 이벤트 본문 (기록 순서) */
export async function chatEvents(ig: TestServer, sellerId: string): Promise<Record<string, unknown>[]> {
  const rows = await ig.database.pglite?.query<{ body: string }>(`select ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.seller_id = $1 and e.type = 'chat' order by e.scope_id, e.seq`, [sellerId])
  return (rows?.rows ?? []).map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

export { fakeClock }
