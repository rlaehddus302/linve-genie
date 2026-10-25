// TTX 수정 라운드 2 — 서버 몫: D-TTX-16(확장이 버린 댓글 → 저장 실패 알림, AC-TTX-32), D-TTX-17(막혔을 때 확장 안내 한 줄, AC-TTX-33),
// D-TTX-18(확장 경고 두 문장의 할 일), RA-TTX-03(서버가 다시 켜진 뒤 "조용함" 예약 다시 걸기), RA-TTX-06(보기 계산 모으기).
// 가짜 웹캐스트·주입한 가짜 시계로 돈다 — 실제 틱톡에 붙지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '../src/log.ts'
import { EXT_TIKTOK_DROPPED_MAX, EXT_TIKTOK_HINT, EXT_TIKTOK_ROUTES, EXT_TIKTOK_WARNINGS } from '../src/tiktok-live/extension.ts'
import { addSeller, client, waitFor, type Seller } from './support.ts'
import { connected, consentOn, linkTiktok, logText, msgId, realBroadcast, restart, tiktokSeller, ttWorld, type TtOptions, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(options: TtOptions = {}): Promise<TtWorld> {
  const w = await ttWorld(options)
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

interface ExtResponse {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly text: string
}

async function ext(w: TtWorld, method: 'GET' | 'POST', path: string, token: string | null, body?: unknown, step = 250): Promise<ExtResponse> {
  if (step > 0) await w.tclock.advance(step)
  const headers: Record<string, string> = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await w.server.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text }
}

async function connectExt(w: TtWorld, seller: Seller): Promise<string> {
  const issued = await client(w, seller.cookie).post('/api/extension/code', {})
  expect(issued.status, issued.text).toBe(200)
  const exchanged = await ext(w, 'POST', '/ext/connect', null, { code: issued.body.code })
  expect(exchanged.status, exchanged.text).toBe(200)
  return exchanged.body.token as string
}

let counter = 0
function item(fields: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1
  return { commentId: msgId(), userId: `71020000000000${String(10_000 + counter)}`, uniqueId: 'buyer_a', nickname: '시청자', text: '15', ...fields }
}

const send = (w: TtWorld, token: string, items: unknown[], pageId: unknown = 'seller_kim') => ext(w, 'POST', '/ext/tiktok/chats', token, { pageId, items })
const status = (w: TtWorld, token: string, input: Record<string, unknown> = {}) => ext(w, 'POST', '/ext/tiktok/status', token, { screen: 'OWN', hidden: false, read: 1, unread: 0, ...input })

type LinkView = Record<string, unknown> & { collection: Record<string, unknown> | null; extension: Record<string, unknown> | null }
const linkView = async (w: TtWorld, cookie: string, b: string) => (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as LinkView

/** 저장 실패 알림 문장 (acceptance "화면 문구" 글자 그대로) */
const saveFailedText = (n: number) => `저장하지 못한 틱톡 댓글이 ${String(n)}개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.`
const HINT = 'PC 크롬에서 내 틱톡 방송 화면을 열어 두면 확장이 댓글을 대신 받아요.'

/** 판매자 + 동의 + 실제 회차 + 틱톡 잇기(서명 실패로 다시 시도 중, 또는 받는 중) + 확장 토큰 */
async function linkedWorld(options: { direct?: 'blocked' | 'connected'; tiktokId?: string; logs?: LogRecord[]; w?: TtWorld } = {}) {
  const logs = options.logs
  const w = options.w ?? (await world(logs === undefined ? {} : { overrides: { log: (record: LogRecord) => logs.push(record) } }))
  const { seller, tiktokId } = await tiktokSeller(w, { tiktokId: options.tiktokId ?? 'seller_kim' })
  const b = await realBroadcast(w, seller)
  if ((options.direct ?? 'blocked') === 'blocked') w.webcast.failNext('SIGN_FAILED', 9)
  const linked = await linkTiktok(w, seller, b)
  expect(linked.status, linked.text).toBe(200)
  if (options.direct === 'connected') await connected(w, seller, b)
  else await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
  const token = await connectExt(w, seller)
  return { w, seller, b, token, tiktokId }
}

const linkEvents = (w: TtWorld, from: number) => w.published.slice(from).map((p) => p.data.link as LinkView | undefined)

describe('AC-TTX-32 확장이 버린 댓글 → 저장 실패 알림 (D-TTX-16)', () => {
  it('dropped 3 → 그 연결의 saveFailed +3, 알림 문장·실시간 알림, 받는 길 줄은 "확장으로 받는 중" 그대로 · 0이면 그대로 · 같은 수를 두 번 알리면 두 번 센다', async () => {
    const logs: LogRecord[] = []
    const { w, seller, b, token } = await linkedWorld({ logs })
    expect((await status(w, token)).status).toBe(200)
    expect((await send(w, token, [item()])).body).toMatchObject({ result: 'recorded', recorded: 1 })
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 0, missed: false })
    const before = w.published.length
    const reply = await status(w, token, { dropped: 3 })
    expect(reply.status, reply.text).toBe(200)
    expect(reply.body).toMatchObject({ mode: 'recording', broadcast: b })
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toMatchObject({ saveFailed: 3, saveFailedSeen: 0, missed: true, missedMessage: saveFailedText(3) })
    expect(view.extension).toMatchObject({ state: 'RECEIVING', active: true, route: EXT_TIKTOK_ROUTES.EXTENSION })
    // extension 칸이 그대로여도 저장 실패 수가 바뀌었으니 실시간으로 알린다
    await waitFor(() => linkEvents(w, before).some((link) => link?.collection?.saveFailed === 3))
    // 다음 상태 dropped 0 → 그대로
    await status(w, token, { dropped: 0 })
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 3 })
    // 응답을 못 받아 같은 수를 다시 알리면 다시 더한다 (적게 세기보다 많이 세는 쪽)
    await status(w, token, { dropped: 3 })
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 6, missedMessage: saveFailedText(6) })
    // 로그에는 코드와 수만
    const dropLog = logs.find((record) => record.code === 'TTX_EXT_DROPPED')
    expect(dropLog).toMatchObject({ level: 'warn', count: 3 })
    expect(logText(logs)).not.toContain('seller_kim')
    expect(logText(logs)).not.toContain(token)
  })

  it('직접 연결이 받는 중(확장은 대기)이어도 버린 수는 이어진 연결에 더한다', async () => {
    const { w, seller, b, token } = await linkedWorld({ direct: 'connected' })
    await status(w, token, { dropped: 2 })
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toMatchObject({ state: 'CONNECTED', saveFailed: 2, missed: true, missedMessage: saveFailedText(2) })
    expect(view.extension).toMatchObject({ state: 'STANDBY', route: EXT_TIKTOK_ROUTES.DIRECT_STANDBY })
  })

  it('dropped가 0 이상 10,000 이하 정수가 아니면 400 — 수도 상태도 바뀌지 않는다 · 10,000은 받는다 · 보내지 않으면 0', async () => {
    const { w, seller, b, token } = await linkedWorld()
    expect(EXT_TIKTOK_DROPPED_MAX).toBe(10_000)
    for (const dropped of [-1, 1.5, 10_001, 2 ** 53, '3', null, true, [], {}, Number.NaN]) {
      const reply = await status(w, token, { dropped })
      expect(reply.status, `${JSON.stringify(dropped)} ${reply.text}`).toBe(400)
      expect(reply.body.error).toMatchObject({ code: 'INVALID_INPUT' })
    }
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toMatchObject({ saveFailed: 0, missed: false })
    expect(view.extension).toMatchObject({ state: 'NONE', statusAt: null })
    expect((await status(w, token, { dropped: 10_000 })).status).toBe(200)
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 10_000 })
    expect((await status(w, token)).status).toBe(200)
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 10_000 })
  })

  it('이어진 연결이 없으면 어디에도 더하지 않는다 · 다른 판매자의 연결 수는 어떤 경우에도 바뀌지 않는다', async () => {
    const mine = await linkedWorld()
    const { w } = mine
    // 다른 판매자: 이어진 연결이 있음
    const { seller: other } = await tiktokSeller(w, { tiktokId: 'other_seller' })
    const ob = await realBroadcast(w, other)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, other, ob)
    // 이어진 연결이 없는 세 번째 판매자의 확장
    const lonely = await addSeller(w)
    await consentOn(w, lonely)
    const lonelyToken = await connectExt(w, lonely)
    expect((await status(w, lonelyToken, { dropped: 7 })).status).toBe(200)
    // 내 확장이 남의 화면 아이디를 실어 보내도 상태는 내 연결에만
    expect((await status(w, mine.token, { dropped: 4, screen: 'OTHER' })).status).toBe(200)
    expect((await linkView(w, other.cookie, ob)).collection).toMatchObject({ saveFailed: 0, missed: false })
    expect((await linkView(w, mine.seller.cookie, mine.b)).collection).toMatchObject({ saveFailed: 4 })
    // 나중에 이 판매자가 이어도 앞에서 보낸 수는 남지 않는다
    const { seller: late } = await tiktokSeller(w, { tiktokId: 'late_seller', seller: lonely })
    const lb = await realBroadcast(w, late)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, late, lb)
    expect((await linkView(w, late.cookie, lb)).collection).toMatchObject({ saveFailed: 0 })
  })

  it('서버 저장 실패(500)는 세지 않고 받는 길 줄도 그대로 — 다시 보내 성공하면 기록 한 번', async () => {
    let failing = false
    const w = await world({
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (failing && records.some((r) => r.type === 'chat')) throw new Error('DB 끊김 흉내')
          },
        },
      },
    })
    const { seller, b, token } = await linkedWorld({ w })
    await status(w, token)
    failing = true
    const batch = [item({ text: '15' })]
    expect((await send(w, token, batch)).status).toBe(500)
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toMatchObject({ saveFailed: 0, missed: false })
    expect(view.extension).toMatchObject({ active: true, route: EXT_TIKTOK_ROUTES.EXTENSION })
    failing = false
    expect((await send(w, token, batch)).body).toMatchObject({ result: 'recorded', recorded: 1 })
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ saveFailed: 0, comments: 1 })
  })
})

describe('AC-TTX-33 막혔을 때 확장 안내 한 줄 (D-TTX-17)', () => {
  it('확장을 이었고 직접 연결이 서명 실패로 다시 시도 중이고 확장 상태 없음 → 안내 · 확장 상태가 생기면 없음 · 확장을 끊으면 없음', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim' })
    const b = await realBroadcast(w, seller)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, seller, b)
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    expect(EXT_TIKTOK_HINT).toBe(HINT)
    // 확장을 잇지 않은 판매자(휴대폰만) → 없음
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'NONE', hint: null, warning: null, route: null })
    const before = w.published.length
    const token = await connectExt(w, seller)
    // 확장을 이으면 실시간으로 알린다
    await waitFor(() => linkEvents(w, before).some((link) => link?.extension?.hint === HINT))
    const view = await linkView(w, seller.cookie, b)
    expect(view.extension).toMatchObject({ state: 'NONE', hint: HINT, warning: null, route: null, active: false })
    // 붙여넣기 알림 띠의 조건은 그대로 (직접 연결 상태 그대로, missed 그대로)
    expect(view.collection).toMatchObject({ state: 'RETRYING', reason: 'SIGN_FAILED' })
    // 확장 상태가 생기면(받는 중) 없음, 조용해져도 없음(확장 경고가 할 일을 말한다)
    await status(w, token)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'RECEIVING', hint: null })
    await w.tclock.advance(31_000)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'STALE', hint: null, warning: EXT_TIKTOK_WARNINGS.STALE })
    // 확장을 끊으면 상태가 비지만 토큰이 없으니 안내도 없음
    expect((await client(w, seller.cookie).post('/api/extension/disconnect', {})).status).toBe(200)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'NONE', hint: null })
  })

  it('막힘(BLOCKED)·멈춤(STOPPED) → 안내 · 네트워크 실패·방송 전·받는 중·잇는 중 → 없음', async () => {
    const cases: { name: string; account?: 'LIVE' | 'OFFLINE' | 'MISSING'; prepare: (w: TtWorld) => void; until: (c: Record<string, unknown> | null) => boolean; hint: string | null }[] = [
      { name: 'BLOCKED', prepare: (w) => w.webcast.failNext('BLOCKED', 9), until: (c) => c?.state === 'RETRYING' && c.reason === 'BLOCKED', hint: HINT },
      { name: 'STOPPED', account: 'MISSING', prepare: () => undefined, until: (c) => c?.state === 'STOPPED', hint: HINT },
      { name: 'NETWORK', prepare: (w) => w.webcast.failNext('NETWORK', 9), until: (c) => c?.state === 'RETRYING' && c.reason === 'NETWORK', hint: null },
      { name: 'NOT_LIVE', account: 'OFFLINE', prepare: () => undefined, until: (c) => c?.state === 'RETRYING' && c.reason === 'NOT_LIVE', hint: null },
      { name: 'CONNECTED', prepare: () => undefined, until: (c) => c?.state === 'CONNECTED', hint: null },
      { name: 'CONNECTING', prepare: (w) => w.webcast.hold(), until: (c) => c?.state === 'CONNECTING', hint: null },
    ]
    for (const c of cases) {
      const w = await world()
      const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim', ...(c.account === undefined ? {} : { account: c.account }) })
      const b = await realBroadcast(w, seller)
      c.prepare(w)
      await linkTiktok(w, seller, b)
      await connectExt(w, seller)
      await waitFor(async () => {
        await w.tclock.advance(0)
        return c.until((await linkView(w, seller.cookie, b)).collection)
      })
      expect((await linkView(w, seller.cookie, b)).extension, c.name).toMatchObject({ state: 'NONE', hint: c.hint })
    }
  })

  it('연결 코드를 다시 만들면(앞 토큰 끊김) 안내가 없어지고, 새로 이으면 다시 보인다 · 다른 판매자의 확장은 내 안내를 켜지 않는다', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w, { tiktokId: 'seller_kim' })
    const b = await realBroadcast(w, seller)
    w.webcast.failNext('SIGN_FAILED', 9)
    await linkTiktok(w, seller, b)
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    const other = await addSeller(w)
    await connectExt(w, other)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ hint: null })
    await connectExt(w, seller)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ hint: HINT })
    const renewed = await client(w, seller.cookie).post('/api/extension/renew', {})
    expect(renewed.status, renewed.text).toBe(200)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ hint: null })
    const again = await ext(w, 'POST', '/ext/connect', null, { code: renewed.body.code })
    expect(again.status, again.text).toBe(200)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ hint: HINT })
  })
})

describe('D-TTX-18 확장 경고 두 문장에 할 일', () => {
  it('조용함·읽지 못함 문장이 표의 글자 그대로, 나머지 둘은 그대로', () => {
    expect(EXT_TIKTOK_WARNINGS).toEqual({
      STALE: '확장에서 틱톡 댓글이 오지 않아요. 크롬에서 내 틱톡 방송 화면을 다시 열어 주세요.',
      HIDDEN: '틱톡 방송 화면을 앞으로 꺼내 두세요',
      UNREADABLE: '틱톡 화면이 바뀌어 댓글을 읽지 못해요. 댓글을 직접 붙여 넣어 주세요.',
      ELSEWHERE: '확장이 내 틱톡 방송 화면에 있지 않아요. 내 방송 화면을 열어 주세요.',
    })
    for (const text of Object.values(EXT_TIKTOK_WARNINGS)) expect(text).not.toContain('서버')
  })
})

describe('RA-TTX-03 서버가 다시 켜진 뒤 "조용함" 예약 다시 걸기', () => {
  it('확장으로 받는 중 → 서버 다시 켜짐 → 상태가 다시 오지 않아도 30초 뒤 조용함으로 바뀌어 실시간으로 알린다', async () => {
    const { w, seller, b, token } = await linkedWorld()
    await status(w, token)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'RECEIVING', active: true })
    await w.tclock.advance(5_000)
    const again = await restart(w)
    worlds.push(again)
    expect(await again.server.tiktokExtension.resume()).toBe(1)
    expect((await linkView(again, seller.cookie, b)).extension).toMatchObject({ state: 'RECEIVING', active: true })
    const before = again.published.length
    await again.tclock.advance(26_000)
    await waitFor(() => linkEvents(again, before).some((link) => link?.extension?.state === 'STALE'))
    expect((await linkView(again, seller.cookie, b)).extension).toMatchObject({ state: 'STALE', active: false, warning: EXT_TIKTOK_WARNINGS.STALE })
  })

  it('이미 조용해진 연결·확장 상태가 없는 연결은 예약하지 않는다', async () => {
    const { w, seller, token } = await linkedWorld()
    await status(w, token)
    const quiet = await linkedWorld({ w, tiktokId: 'quiet_seller' })
    expect(quiet.seller.sellerId).not.toBe(seller.sellerId)
    await w.tclock.advance(40_000)
    const again = await restart(w)
    worlds.push(again)
    expect(await again.server.tiktokExtension.resume()).toBe(0)
  })
})

describe('RA-TTX-06 같은 판매자의 보기 계산을 모은다', () => {
  it('상태를 몰아 보내도 마지막 상태가 알려지고, 바뀌지 않은 칸은 다시 알리지 않는다', async () => {
    const { w, seller, b, token } = await linkedWorld()
    await status(w, token)
    await waitFor(() => linkEvents(w, 0).some((link) => link?.extension?.state === 'RECEIVING'))
    const before = w.published.length
    await w.tclock.advance(1_100)
    const burst = (input: Record<string, unknown>) => ext(w, 'POST', '/ext/tiktok/status', token, { screen: 'OWN', hidden: false, read: 1, unread: 0, ...input }, 0)
    const replies = await Promise.all(Array.from({ length: 4 }, () => burst({})))
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200])
    await status(w, token, { hidden: true })
    await waitFor(() => linkEvents(w, before).some((link) => link?.extension?.state === 'HIDDEN'))
    const events = linkEvents(w, before)
    expect(events.filter((link) => link?.extension?.state === 'RECEIVING')).toHaveLength(0)
    expect((await linkView(w, seller.cookie, b)).extension).toMatchObject({ state: 'HIDDEN', warning: EXT_TIKTOK_WARNINGS.HIDDEN })
  })
})
