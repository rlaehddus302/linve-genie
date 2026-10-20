// N2 적대 테스트 (test-domain): 옮기기(AC-N2-25)의 조건 (아) "이은·옮긴 시각에서 60초를 넘겨 받은 댓글만 옮긴다"와 이유 TOO_SOON (D-N2-18, 수정 라운드 5).
// - (아) 받은 시각(서버 시계) − b 연결의 이은 시각(옮겼으면 마지막으로 옮긴 시각)이 60,000ms 이하면 옮기지 않고, 60,001ms부터 옮긴다.
//   entry.time은 늦은 댓글 판단에만 쓰고 (아)에는 쓰지 않는다. 기준은 마지막 활동이 아니라 이은·옮긴 시각이다.
// - (아)로 막히면 LIVE_NOT_MOVED reason TOO_SOON(라이브마다 처음 한 번과 그 뒤 1분에 한 번까지). 이유가 여럿이면 GAP → OTHER_BROADCAST → TOO_SOON.
// - (아)로 막힌 라이브는 "이어진 적 있는 라이브"가 아니다 — 60초 뒤 그 라이브의 늦지 않은 댓글은 옮긴다.
// 공격: 세 번·네 번 연속 다시 켜기와 늦은 배달(끝난 라이브로 되돌아가지 않는다, 끝난 라이브에 머무는 시간 ≤ 60초, 방송 중인 라이브는 60초 뒤 기록),
// 60초 경계 ±1ms·정각(.250ms로 초 단위 자르기를 잡는다), entry.time과 서버 시계 어긋남, 한 웹훅 두 라이브·동시 배달, 두 인스턴스 사이 기록 트랜잭션 안 다시 확인,
// 이유 순서, 그 밖의 조건은 UNLINKED_COMMENTS, 알림 간격, 속성 시험(쓴 시각 = entry.time인 다시 켜기 열을 무작위 배달 순서로).
// 서버를 프로세스 안에서 PGlite로 띄우고 가짜 메타 서버(127.0.0.1, 실제 HTTP)·주입한 시계를 쓴다. 네트워크 가드(AC-N2-62).
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import {
  chatEvents,
  connectedShop,
  igWorld,
  linkLive,
  liveBroadcast,
  REDIRECT_URI,
  register,
  sendComments,
  TEST_TIMEOUTS,
  webhookTarget,
  type IgWorld,
  type Shop,
} from '../../../apps/server/test/instagram-support.ts'
import { client, createBroadcast, rid, startServer, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

installNetworkGuard()

let ig: IgWorld | null = null
const extra: TestServer[] = []
afterEach(async () => {
  for (const other of extra.splice(0)) other.server.close()
  await ig?.close()
  ig = null
})
async function world(): Promise<IgWorld> {
  ig = await igWorld()
  return ig
}

/** (아) 60초 */
const SOON = 60_000
/** 2026-10-<day> h:m:s.ms KST */
const kst = (day: number, h: number, m: number, s = 0, ms = 0) => Date.UTC(2026, 9, day, h - 9, m, s, ms)
const iso = (ms: number) => new Date(ms).toISOString()
/** entry.time (초) */
const sec = (ms: number) => Math.floor(ms / 1000)

const TOO_SOON_MESSAGE =
  '방송을 방금 인스타그램 라이브에 이어서, 1분 동안은 다른 라이브에서 온 댓글을 기록하지 않아요. 1분이 지나도 지금 방송 중인 라이브의 댓글이 기록되지 않으면 방송을 그 라이브에 다시 이어 주세요.'
const OTHER_MESSAGE =
  '새 인스타그램 라이브 댓글이 오고 있는데, 끝나지 않은 방송이 여럿이라 어느 방송에 이을지 몰라 기록하지 않고 있어요. 쓰지 않는 방송은 끝내고, 이어 갈 방송을 새 라이브에 이어 주세요.'

let counter = 0
/** 시험마다 겹치지 않는 댓글 ID (숫자) */
const nextId = () => `1796${String(++counter).padStart(11, '0')}`

interface LinkBody {
  readonly state: string
  readonly liveId: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string } | null
  readonly moved?: { readonly fromLiveId: string; readonly movedAt: string; readonly comments: number; readonly message: string } | null
}

async function linkOf(w: TestServer, seller: Seller, b: string): Promise<LinkBody> {
  const response = await client(w, seller.cookie).get(`/api/broadcasts/${b}/live`)
  expect(response.status, response.text).toBe(200)
  return response.body.link as LinkBody
}

async function wait(w: TestServer, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })
  expect(response.status, response.text).toBe(200)
}

async function end(w: TestServer, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
  expect(response.status, response.text).toBe(200)
}

async function unlinkedOf(w: TestServer, seller: Seller): Promise<Record<string, number>> {
  const lives = (await client(w, seller.cookie).get('/api/instagram/unlinked')).body.lives as { liveId: string; count: number }[]
  return Object.fromEntries(lives.map((live) => [live.liveId, live.count]))
}

/** 그 뒤에 보낸 알림 문장 알림 (kind NOTICE) */
function noticesSince(w: IgWorld, from: number): Record<string, unknown>[] {
  return w.published
    .slice(from)
    .map((item) => item.data)
    .filter((data) => data.kind === 'NOTICE')
}

async function chatIdsOf(w: TestServer, seller: Seller, b: string): Promise<string[]> {
  return (await chatEvents(w, seller.sellerId)).filter((event) => event.b === b).map((event) => event.id as string)
}

async function winners(w: TestServer, seller: Seller, key: string): Promise<string[]> {
  const view = (await client(w, seller.cookie).get('/api/days/2026-10-19')).body as { products: { key: string; winners: string[] }[] }
  return view.products.find((product) => product.key === key)?.winners ?? []
}

/** at에 그 라이브의 댓글 하나를 보낸다 (entry.time 기본 = 받은 시각, 초). 기록되면 쓰일 메시지 ID(ig:…)를 돌려준다 */
async function commentAt(w: IgWorld, shop: Shop, live: string, at: number, text = '안녕하세요', options: { readonly time?: number; readonly igsid?: string } = {}): Promise<string> {
  w.clock.set(at)
  const id = nextId()
  const sent = await sendComments(w, shop.account, live, [{ id, igsid: options.igsid ?? `60245${id.slice(-11)}`, username: 'viewer.one', text }], options.time === undefined ? {} : { time: options.time })
  expect(sent.status).toBe(200)
  return `ig:${id}`
}

/** 판매자 하나·회차 b(2026-10-19, 15~18번 판매 중)를 waitAt에 기다리기로 두고 at에 라이브 M의 첫 댓글로 저절로 잇는다 (조치자 서버) */
async function autoLinkedAt(w: IgWorld, at: number, waitAt = at - 60_000): Promise<Shop & { readonly b: string; readonly m: string; readonly first: string }> {
  w.clock.set(waitAt)
  const shop = await connectedShop(w)
  const b = await liveBroadcast(w, shop.seller)
  for (const no of [15, 16, 17, 18]) await register(w, shop.seller, b, no, `다육 ${String(no)}`, 10000)
  await wait(w, shop.seller, b)
  const m = w.fake.startLive(shop.account.id)
  const first = await commentAt(w, shop, m, at)
  expect(await linkOf(w, shop.seller, b)).toMatchObject({ state: 'LINKED', liveId: m, actor: { kind: 'server' }, linkedAt: iso(at) })
  return { ...shop, b, m, first }
}

/** 옮겨졌는지: b가 to에 이어지고(이은 시각 = 받은 시각) 그 댓글이 b에 기록, LIVE_MOVED 하나, LIVE_NOT_MOVED·UNLINKED_COMMENTS 없음 */
async function expectMoved(w: IgWorld, seller: Seller, b: string, to: string, at: number, id: string, from: number): Promise<void> {
  expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: to, linkedAt: iso(at), actor: { kind: 'server' } })
  expect(await chatIdsOf(w, seller, b)).toContain(id)
  const notices = noticesSince(w, from)
  expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ broadcast: b, liveId: to })])
  expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
}

/**
 * (아)로 막혔는지: b는 stay에 그대로(이은 시각도 그대로), 그 댓글은 어느 회차에도 기록하지 않고 이어지지 않은 수(to)를 세며,
 * LIVE_NOT_MOVED(TOO_SOON)만 — 알림 차례가 아니면(같은 라이브에 1분 안) 아무 알림도 없다. UNLINKED_COMMENTS·LIVE_MOVED는 없다.
 */
async function expectTooSoon(
  w: IgWorld,
  seller: Seller,
  b: string,
  stay: { readonly live: string; readonly linkedAt: number },
  to: string,
  id: string,
  from: number,
  expected: { readonly count: number; readonly notice: boolean },
): Promise<void> {
  expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: stay.live, linkedAt: iso(stay.linkedAt) })
  expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(id)
  expect((await unlinkedOf(w, seller))[to]).toBe(expected.count)
  const notices = noticesSince(w, from)
  expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
  expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual(
    expected.notice ? [expect.objectContaining({ code: 'LIVE_NOT_MOVED', reason: 'TOO_SOON', broadcast: b, liveId: to, count: expected.count, message: TOO_SOON_MESSAGE })] : [],
  )
}

/** 옮기지 않고 UNLINKED_COMMENTS만 (그 밖의 조건이 틀림 — LIVE_NOT_MOVED·LIVE_MOVED 없음) */
function expectUnlinkedOnly(w: IgWorld, from: number, liveId: string, count = 1): void {
  const notices = noticesSince(w, from)
  expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'LIVE_MOVED')).toEqual([])
  expect(notices.find((data) => data.code === 'UNLINKED_COMMENTS')).toMatchObject({ liveId, count })
}

describe('D-N2-18 (아) 60초 경계 — 이은·옮긴 시각에서 ±1ms·정각', () => {
  // 이은·옮긴 시각을 20:00:00.250에 둔다 — 초 단위로 자르거나 반올림하면 +1ms가 0으로 보인다
  const base = kst(19, 20, 0, 0, 250)
  it.each([
    { label: '60초 − 1ms', offset: -1, moves: false },
    { label: '60초 정각', offset: 0, moves: false },
    { label: '60초 + 1ms', offset: 1, moves: true },
  ])('⑭ 저절로 이은 시각 20:00:00.250 → 새 라이브 M2의 늦지 않은 "15"를 $label 뒤에 받음: 옮김 = $moves (막히면 TOO_SOON)', async ({ offset, moves }) => {
    const w = await world()
    const shop = await autoLinkedAt(w, base)
    const { seller, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = base + SOON + offset
    const id = await commentAt(w, shop, m2, at, '15', { igsid: '6024500000000001' })
    if (moves) {
      await expectMoved(w, seller, b, m2, at, id, from)
      expect(await winners(w, seller, `${b}/15`)).toEqual(['ig:6024500000000001'])
    } else {
      await expectTooSoon(w, seller, b, { live: m, linkedAt: base }, m2, id, from, { count: 1, notice: true })
      expect(await winners(w, seller, `${b}/15`)).toEqual([])
    }
  })

  it.each([
    { label: '60초 − 1ms', offset: -1, moves: false },
    { label: '60초 정각', offset: 0, moves: false },
    { label: '60초 + 1ms', offset: 1, moves: true },
  ])('⑬ 옮긴 시각 20:00:00.250(M → M2, 처음 이은 지 한참 뒤) → M3 "16"을 $label 뒤에 받음: 옮김 = $moves (처음 이은 시각이 기준이 아니다)', async ({ offset, moves }) => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 30))
    const { seller, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const moveId = await commentAt(w, shop, m2, base, '15')
    await expectMoved(w, seller, b, m2, base, moveId, from)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    from = w.published.length
    const at = base + SOON + offset
    const id = await commentAt(w, shop, m3, at, '16', { igsid: '6024500000000002' })
    if (moves) {
      await expectMoved(w, seller, b, m3, at, id, from)
      expect((await linkOf(w, seller, b)).moved).toMatchObject({ fromLiveId: m2, movedAt: iso(at), comments: 2 })
      expect(await winners(w, seller, `${b}/16`)).toEqual(['ig:6024500000000002'])
    } else {
      await expectTooSoon(w, seller, b, { live: m2, linkedAt: base }, m3, id, from, { count: 1, notice: true })
      expect((await linkOf(w, seller, b)).moved).toMatchObject({ fromLiveId: m, movedAt: iso(base) })
      expect(await winners(w, seller, `${b}/16`)).toEqual([])
    }
  })

  it('기준은 이은 시각이지 마지막 활동이 아니다 — 20:00:00.000에 저절로 이은 뒤 M 댓글이 20:00:59.999까지 이어져도 M2 댓글 20:01:00.001은 옮긴다', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 0, 30), '예뻐요')
    await commentAt(w, shop, m, kst(19, 20, 0, 59, 999), '물 주기는요?')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = linkedAt + SOON + 1
    const id = await commentAt(w, shop, m2, at, '15')
    await expectMoved(w, seller, b, m2, at, id, from)
    expect((await linkOf(w, seller, b)).moved).toMatchObject({ fromLiveId: m, comments: 3 })
  })

  it('⑭ 기다리기로 정한 시각이 아니라 저절로 이은 시각이 기준 — 19:00에 기다리기, 20:00:00.000에 이어짐 → M2 20:00:45는 TOO_SOON, 20:01:00.001은 옮김', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt, kst(19, 19, 0))
    const { seller, b, m } = shop
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const blocked = await commentAt(w, shop, m2, kst(19, 20, 0, 45), '15')
    await expectTooSoon(w, seller, b, { live: m, linkedAt }, m2, blocked, from, { count: 1, notice: true })
    from = w.published.length
    const at = linkedAt + SOON + 1
    const id = await commentAt(w, shop, m2, at, '16')
    await expectMoved(w, seller, b, m2, at, id, from)
    // 막혀 기록하지 않은 댓글은 되살리지 않는다
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, id])
  })
})

describe('D-N2-18 entry.time과 서버 시계가 어긋날 때 — (아)는 서버 시계만', () => {
  const linkedAt = kst(19, 20, 0, 0, 250)
  it.each([
    { label: '메타 시계가 90초 빠름(entry.time = 받은 시각 + 90초), 이은 지 30초', after: 30_000, skew: 90_000, moves: false },
    { label: '메타 시계가 1시간 빠름, 이은 지 60초 정각', after: SOON, skew: 3_600_000, moves: false },
    { label: '메타 시계가 90초 빠름, 이은 지 60초 + 1ms', after: SOON + 1, skew: 90_000, moves: true },
    { label: 'entry.time이 59초 이름(늦은 댓글 아님 — entry.time으로 재면 이은 지 1초), 이은 지 60초 + 1ms', after: SOON + 1, skew: -59_000, moves: true },
  ])('$label: 옮김 = $moves', async ({ after, skew, moves }) => {
    const w = await world()
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const at = linkedAt + after
    // 늦은 댓글 판단은 받은 시각 − entry.time*1000 > 60,000 — 초로 올림해 −59,000이 늦은 댓글이 되지 않게 한다
    const time = Math.ceil((at + skew) / 1000)
    expect(at - time * 1000).toBeLessThanOrEqual(60_000)
    const id = await commentAt(w, shop, m2, at, '15', { time })
    if (moves) await expectMoved(w, seller, b, m2, at, id, from)
    else await expectTooSoon(w, seller, b, { live: m, linkedAt }, m2, id, from, { count: 1, notice: true })
  })

  it('(마)와 (아)가 틈 없이 맞물린다 — 이은 시각 20:06:30.000보다 먼저 쓴 끝난 라이브 댓글(entry.time 20:06:30)은 60,000ms에 받으면 TOO_SOON, 60,001ms에 받으면 늦은 댓글이라 UNLINKED_COMMENTS — 어느 쪽도 옮기지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    const moveAt = kst(19, 20, 6, 30)
    let from = w.published.length
    const moved = await commentAt(w, shop, m3, moveAt, '15')
    await expectMoved(w, seller, b, m3, moveAt, moved, from)
    from = w.published.length
    const atBoundary = await commentAt(w, shop, m2, moveAt + SOON, '16', { time: sec(moveAt) })
    await expectTooSoon(w, seller, b, { live: m3, linkedAt: moveAt }, m2, atBoundary, from, { count: 1, notice: true })
    from = w.published.length
    const late = await commentAt(w, shop, m2, moveAt + SOON + 1, '17', { time: sec(moveAt) })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3, linkedAt: iso(moveAt) })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(late)
    expectUnlinkedOnly(w, from, m2, 2)
  })
})

describe('D-N2-18 빠른 연속 다시 켜기와 늦은 배달 — 끝난 라이브로 되돌아가지 않는다', () => {
  it('TD-N2-005 ⑫ M → M2 → M3, M2 댓글이 M3 첫 댓글보다 늦게 배달: b는 M3에 그대로, "16"은 TOO_SOON, M3 "17"은 기록돼 17번 1등', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 5, 50), '예뻐요')
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    const movedAt = kst(19, 20, 6, 30)
    let from = w.published.length
    const fifteen = await commentAt(w, shop, m3, movedAt, '15', { time: sec(movedAt) })
    await expectMoved(w, seller, b, m3, movedAt, fifteen, from)
    from = w.published.length
    const sixteen = await commentAt(w, shop, m2, kst(19, 20, 6, 40), '16', { time: sec(kst(19, 20, 6, 0)) })
    await expectTooSoon(w, seller, b, { live: m3, linkedAt: movedAt }, m2, sixteen, from, { count: 1, notice: true })
    expect(await winners(w, seller, `${b}/16`)).toEqual([])
    await commentAt(w, shop, m3, kst(19, 20, 7, 0), '17', { igsid: '6024500000000017' })
    expect(await winners(w, seller, `${b}/17`)).toEqual(['ig:6024500000000017'])
    // 옮긴 지 40초에 옛 라이브 M의 댓글(늦지 않음) — M은 이어진 적 있는 라이브(그 밖의 조건)라 TOO_SOON이 아니라 UNLINKED_COMMENTS
    from = w.published.length
    const old = await commentAt(w, shop, m, kst(19, 20, 7, 10), '18', { time: sec(kst(19, 20, 6, 15)) })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(old)
    expectUnlinkedOnly(w, from, m)
    expect(await winners(w, seller, `${b}/18`)).toEqual([])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3, linkedAt: iso(movedAt), moved: { fromLiveId: m } })
  })

  it('세 번 다시 켜기 M → M2 → M3 → M4, 방송 중인 M4의 첫 댓글이 먼저 오고 끝난 M2·M3 댓글이 뒤늦게(늦지 않게) 섞여 옴: b는 M4에만 머물고 M4 댓글은 모두 기록, M2·M3 댓글은 TOO_SOON(라이브마다 알림 하나) 또는 늦은 댓글', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, b, m } = shop
    const last = await commentAt(w, shop, m, kst(19, 20, 5, 50), '예뻐요')
    // M은 20:06:00에 끊김. M2 20:06:00~20:06:08, M3 20:06:10~20:06:18, M4는 20:06:20부터 방송 중
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(shop.account.id)
    w.fake.endLive(m3)
    const m4 = w.fake.startLive(shop.account.id)
    const movedAt = kst(19, 20, 6, 30)
    const from = w.published.length
    const m4a = await commentAt(w, shop, m4, movedAt, '15', { igsid: '6024500000000415' })
    const m2a = await commentAt(w, shop, m2, kst(19, 20, 6, 40), '16', { time: sec(kst(19, 20, 6, 5)) })
    const m3a = await commentAt(w, shop, m3, kst(19, 20, 6, 50), '17', { time: sec(kst(19, 20, 6, 15)) })
    const m4b = await commentAt(w, shop, m4, kst(19, 20, 6, 55), '18', { igsid: '6024500000000418' })
    // M3 댓글(20:06:16에 씀)이 59초 늦게 — 늦은 댓글은 아니고 옮긴 지 45초
    const m3b = await commentAt(w, shop, m3, kst(19, 20, 7, 15), '16', { time: sec(kst(19, 20, 6, 16)) })
    // M2 댓글(20:06:07에 씀)이 옮긴 지 60초 + 1ms에 — 늦은 댓글(83초)이라 그 밖의 조건이 틀림
    const m2b = await commentAt(w, shop, m2, movedAt + SOON + 1, '17', { time: sec(kst(19, 20, 6, 7)) })
    const m4c = await commentAt(w, shop, m4, kst(19, 20, 7, 31), '17', { igsid: '6024500000000417' })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m4, linkedAt: iso(movedAt), moved: { fromLiveId: m, comments: 2 } })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, last, m4a, m4b, m4c])
    for (const blocked of [m2a, m3a, m3b, m2b]) expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(blocked)
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 2, [m3]: 2 })
    expect(await winners(w, seller, `${b}/15`)).toEqual(['ig:6024500000000415'])
    expect(await winners(w, seller, `${b}/16`)).toEqual([])
    expect(await winners(w, seller, `${b}/17`)).toEqual(['ig:6024500000000417'])
    expect(await winners(w, seller, `${b}/18`)).toEqual(['ig:6024500000000418'])
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ broadcast: b, liveId: m4, count: 2 })])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').map((data) => [data.reason, data.liveId, data.count])).toEqual([
      ['TOO_SOON', m2, 1],
      ['TOO_SOON', m3, 1],
    ])
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS').map((data) => [data.liveId, data.count])).toEqual([[m2, 2]])
  })

  it('네 번 다시 켜기 M → M2 → M3 → M4 → M5, 끝난 M2 댓글이 가장 먼저 와 b가 M2로 옮겨져도(⑯) 그 뒤 M3·M4·M5 댓글은 60초까지 TOO_SOON, 60,001ms의 M5 댓글이 b를 방송 중인 M5로 옮긴다 — 끝난 라이브에 머문 시간 60.001초, M3·M4로는 가지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, b, m } = shop
    await commentAt(w, shop, m, kst(19, 20, 5, 50), '예뻐요')
    // M 20:06:00 끊김, M2 20:06:05~20:06:12, M3 20:06:15~20:06:20, M4 20:06:22~20:06:26, M5 20:06:28부터 방송 중
    w.fake.endLive(m)
    const lives = [w.fake.startLive(shop.account.id), w.fake.startLive(shop.account.id), w.fake.startLive(shop.account.id), w.fake.startLive(shop.account.id)] as const
    const [m2, m3, m4, m5] = lives
    for (const ended of [m2, m3, m4]) w.fake.endLive(ended)
    const t = kst(19, 20, 6, 30)
    let from = w.published.length
    const m2a = await commentAt(w, shop, m2, t, '15', { time: sec(kst(19, 20, 6, 10)) })
    await expectMoved(w, seller, b, m2, t, m2a, from)
    from = w.published.length
    const blocked = [
      await commentAt(w, shop, m5, t + 1_000, '16', { time: sec(kst(19, 20, 6, 29)) }),
      await commentAt(w, shop, m4, t + 10_000, '16', { time: sec(kst(19, 20, 6, 25)) }),
      await commentAt(w, shop, m3, t + 40_000, '16', { time: sec(kst(19, 20, 6, 18)) }),
      await commentAt(w, shop, m5, t + SOON, '17', { time: sec(t + SOON) }),
    ]
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: iso(t) })
    const ids = (await chatEvents(w, seller.sellerId)).map((event) => event.id)
    for (const id of blocked) expect(ids).not.toContain(id)
    let notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').map((data) => [data.reason, data.liveId])).toEqual([
      ['TOO_SOON', m5],
      ['TOO_SOON', m4],
      ['TOO_SOON', m3],
    ])
    from = w.published.length
    const back = t + SOON + 1
    const m5c = await commentAt(w, shop, m5, back, '18', { time: sec(back), igsid: '6024500000000518' })
    await expectMoved(w, seller, b, m5, back, m5c, from)
    expect((await linkOf(w, seller, b)).moved).toMatchObject({ fromLiveId: m2, comments: 3 })
    // 그 뒤 끝난 M3·M4 댓글이 늦게 와도(늦은 댓글) b는 M5에 그대로, M5 댓글은 기록
    from = w.published.length
    await commentAt(w, shop, m4, back + 1_000, '17', { time: sec(kst(19, 20, 6, 25)) })
    await commentAt(w, shop, m3, back + 2_000, '17', { time: sec(kst(19, 20, 6, 19)) })
    const m5d = await commentAt(w, shop, m5, back + 3_000, '17', { igsid: '6024500000000517' })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m5, linkedAt: iso(back) })
    expect((await chatIdsOf(w, seller, b)).slice(-2)).toEqual([m5c, m5d])
    notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'LIVE_NOT_MOVED')).toEqual([])
    expect(await winners(w, seller, `${b}/17`)).toEqual(['ig:6024500000000517'])
    expect(await winners(w, seller, `${b}/18`)).toEqual(['ig:6024500000000518'])
    expect(await winners(w, seller, `${b}/16`)).toEqual([])
  })

  it('네 번 진짜로 빠르게 다시 켜기(배달은 순서대로): 다시 켤 때마다 새 라이브 첫 1분 댓글은 TOO_SOON, 60,001ms 뒤 댓글이 옮긴다 — M → M2 → M3 → M4 → M5, LIVE_MOVED 넷, moved는 마지막 것', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b, m } = shop
    const recorded = [shop.first]
    let moves = 0
    const from = w.published.length
    // 첫 다시 켜기는 이은 지 5분 뒤 (TOO_SOON 없음)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const firstMove = kst(19, 20, 5)
    recorded.push(await commentAt(w, shop, m2, firstMove, '안녕하세요'))
    moves++
    expect(linkedAt).toBeLessThan(firstMove)
    let current = { live: m2, linkedAt: firstMove }
    for (let round = 0; round < 3; round++) {
      w.fake.endLive(current.live)
      const next = w.fake.startLive(shop.account.id)
      const step = w.published.length
      const early = await commentAt(w, shop, next, current.linkedAt + 20_000, '다시 왔어요')
      await expectTooSoon(w, seller, b, current, next, early, step, { count: 1, notice: true })
      const boundaryStep = w.published.length
      const atBoundary = await commentAt(w, shop, next, current.linkedAt + SOON, '15')
      await expectTooSoon(w, seller, b, current, next, atBoundary, boundaryStep, { count: 2, notice: false })
      const at = current.linkedAt + SOON + 1
      const moveStep = w.published.length
      const id = await commentAt(w, shop, next, at, '16')
      await expectMoved(w, seller, b, next, at, id, moveStep)
      expect((await linkOf(w, seller, b)).moved).toMatchObject({ fromLiveId: current.live, comments: recorded.length })
      recorded.push(id)
      moves++
      current = { live: next, linkedAt: at }
    }
    expect(await chatIdsOf(w, seller, b)).toEqual(recorded)
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(moves)
    expect(new Set(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').map((data) => data.reason))).toEqual(new Set(['TOO_SOON']))
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS')).toEqual([])
  })
})

describe('D-N2-18 한 웹훅에 두 라이브·동시 배달 — 앞 댓글이 옮기면 뒤 댓글은 TOO_SOON', () => {
  it('한 웹훅 [M3 "15", M2 "16"] (b는 M에 한참 전에 이음): M3이 옮기고 M2는 같은 ms라 TOO_SOON. 30초 뒤 [M2 "17", M3 "18"]: M2는 TOO_SOON(알림 없음), M3은 기록', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, account, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(account.id)
    let from = w.published.length
    const at = kst(19, 20, 10, 0, 250)
    w.clock.set(at)
    const [a, c] = [nextId(), nextId()]
    const first = w.fake.payload([
      {
        accountId: account.id,
        changes: [
          w.fake.comment({ accountId: account.id, liveId: m3, id: a, igsid: '6024500000000301', username: 'm3.one', text: '15' }),
          w.fake.comment({ accountId: account.id, liveId: m2, id: c, igsid: '6024500000000302', username: 'm2.one', text: '16' }),
        ],
      },
    ])
    expect((await w.fake.deliver(webhookTarget(w), first)).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3, linkedAt: iso(at) })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, `ig:${a}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    let notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ broadcast: b, liveId: m3, count: 1 })])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'TOO_SOON', broadcast: b, liveId: m2, count: 1, message: TOO_SOON_MESSAGE })])
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS')).toEqual([])
    from = w.published.length
    w.clock.set(at + 30_000)
    const [d, e] = [nextId(), nextId()]
    const second = w.fake.payload([
      {
        accountId: account.id,
        changes: [
          w.fake.comment({ accountId: account.id, liveId: m2, id: d, igsid: '6024500000000303', username: 'm2.two', text: '17' }),
          w.fake.comment({ accountId: account.id, liveId: m3, id: e, igsid: '6024500000000304', username: 'm3.two', text: '18' }),
        ],
      },
    ])
    expect((await w.fake.deliver(webhookTarget(w), second)).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3, linkedAt: iso(at) })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, `ig:${a}`, `ig:${e}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 2 })
    notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'LIVE_NOT_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(await winners(w, seller, `${b}/16`)).toEqual([])
    expect(await winners(w, seller, `${b}/17`)).toEqual([])
    expect(await winners(w, seller, `${b}/18`)).toEqual(['ig:6024500000000304'])
  })

  it('한 웹훅의 두 entry(entry.time이 다름) [M2, M3]: 첫 entry가 옮기고 둘째 entry의 다른 라이브는 TOO_SOON', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, account, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(account.id)
    const at = kst(19, 20, 10)
    w.clock.set(at)
    const from = w.published.length
    const [a, c] = [nextId(), nextId()]
    const body = w.fake.payload([
      { accountId: account.id, time: sec(at) - 20, changes: [w.fake.comment({ accountId: account.id, liveId: m2, id: a, igsid: '6024500000000311', username: 'm2.one', text: '15' })] },
      { accountId: account.id, time: sec(at), changes: [w.fake.comment({ accountId: account.id, liveId: m3, id: c, igsid: '6024500000000312', username: 'm3.one', text: '16' })] },
    ])
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: iso(at) })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, `ig:${a}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m3]: 1 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(1)
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'TOO_SOON', liveId: m3, count: 1 })])
  })

  it('⑭ 기다리는 b와 한 웹훅 [M "안녕", M2 "15"]: M 댓글로 저절로 이은 바로 그 ms의 M2 댓글은 TOO_SOON', async () => {
    const w = await world()
    w.clock.set(kst(19, 19, 0))
    const shop = await connectedShop(w)
    const { seller, account } = shop
    const b = await liveBroadcast(w, seller)
    await wait(w, seller, b)
    const m = w.fake.startLive(account.id)
    const m2 = w.fake.startLive(account.id)
    const at = kst(19, 20, 0, 0, 250)
    w.clock.set(at)
    const from = w.published.length
    const [a, c] = [nextId(), nextId()]
    const body = w.fake.payload([
      {
        accountId: account.id,
        changes: [
          w.fake.comment({ accountId: account.id, liveId: m, id: a, igsid: '6024500000000321', username: 'm.one', text: '안녕하세요' }),
          w.fake.comment({ accountId: account.id, liveId: m2, id: c, igsid: '6024500000000322', username: 'm2.one', text: '15' }),
        ],
      },
    ])
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, linkedAt: iso(at), actor: { kind: 'server' } })
    expect(await chatIdsOf(w, seller, b)).toEqual([`ig:${a}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'TOO_SOON', broadcast: b, liveId: m2, count: 1 })])
  })

  it('동시에 온 두 웹훅(M2 댓글·M3 댓글, 같은 ms): 옮기기는 한 번뿐, 다른 라이브는 TOO_SOON — 두 댓글이 모두 기록되거나 b가 두 번 옮겨지지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, account, b, m } = shop
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(account.id)
    const at = kst(19, 20, 10)
    w.clock.set(at)
    const from = w.published.length
    const [a, c] = [nextId(), nextId()]
    const results = await Promise.all([
      sendComments(w, account, m2, [{ id: a, igsid: '6024500000000331', username: 'm2.one', text: '15' }]),
      sendComments(w, account, m3, [{ id: c, igsid: '6024500000000332', username: 'm3.one', text: '16' }]),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    const link = await linkOf(w, seller, b)
    expect([m2, m3]).toContain(link.liveId)
    expect(link.linkedAt).toBe(iso(at))
    const winner = link.liveId === m2 ? `ig:${a}` : `ig:${c}`
    const loser = link.liveId === m2 ? m3 : m2
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, winner])
    expect(await unlinkedOf(w, seller)).toEqual({ [loser]: 1 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ liveId: link.liveId })])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'TOO_SOON', liveId: loser, count: 1 })])
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS')).toEqual([])
  })

  it('두 서버 인스턴스: A가 M3 댓글로 옮기기로 정한 뒤 기록하기 전에 B가 M2 댓글로 b를 M2로 옮겨 커밋 → A의 기록 트랜잭션 안 다시 확인이 바뀐 이은 시각을 보고 옮기지 않는다(TOO_SOON), M3 댓글은 기록하지 않는다', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 19, 50))
    const { seller, account, b, m } = shop
    // 같은 데이터베이스·같은 메타 앱의 둘째 인스턴스 (판매자 줄은 인스턴스마다 따로)
    const second = startServer(w.database, w.masterKey, {
      clock: w.clock,
      instagram: w.fake.settings({ redirectUri: REDIRECT_URI, login: 'FACEBOOK', timeouts: TEST_TIMEOUTS }),
      dmAutoRun: false,
      collectionIntervalMs: 25,
    })
    extra.push(second)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    w.fake.endLive(m2)
    const m3 = w.fake.startLive(account.id)
    const at = kst(19, 20, 10, 0, 250)
    w.clock.set(at)
    const [a, c] = [nextId(), nextId()]
    const links = w.server.instagram.links
    const original = links.resolveTarget.bind(links)
    let injected = 0
    links.resolveTarget = async (sellerId, igAccountId, liveId, fresh) => {
      const target = await original(sellerId, igAccountId, liveId, fresh)
      if (injected === 0 && liveId === m3 && target.kind === 'move') {
        injected++
        const other = await w.fake.deliver(
          webhookTarget(second),
          w.fake.payload([{ accountId: account.id, changes: [w.fake.comment({ accountId: account.id, liveId: m2, id: a, igsid: '6024500000000341', username: 'm2.one', text: '15' })] }]),
        )
        expect(other.status).toBe(200)
      }
      return target
    }
    const from = w.published.length
    const sent = await sendComments(w, account, m3, [{ id: c, igsid: '6024500000000342', username: 'm3.one', text: '16' }])
    expect(sent.status).toBe(200)
    expect(injected).toBe(1)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: iso(at), moved: { fromLiveId: m } })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, `ig:${a}`])
    expect(await unlinkedOf(w, seller)).toEqual({ [m3]: 1 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'TOO_SOON', broadcast: b, liveId: m3, count: 1 })])
  })
})

describe('D-N2-18 이유 순서 — GAP → OTHER_BROADCAST → TOO_SOON, 그 밖의 조건은 UNLINKED_COMMENTS', () => {
  it.each([
    { kind: '연결 없는 회차' as const },
    { kind: '판매자가 손으로 이은 회차' as const },
    { kind: '전날 회차' as const },
  ])('⑮(가) 이은 지 30초 + 끝나지 않은 다른 실제 회차 c($kind) → reason OTHER_BROADCAST(TOO_SOON 아님). c를 끝내면 다른 라이브 댓글은 TOO_SOON, 60초가 지나면 옮긴다', async ({ kind }) => {
    const w = await world()
    w.clock.set(kst(19, 19, 0))
    const shop = await connectedShop(w)
    const { seller, account } = shop
    let c: string
    if (kind === '전날 회차') c = (await createBroadcast(w, seller, { date: '2026-10-18' })).id
    else {
      c = await liveBroadcast(w, seller)
      if (kind === '판매자가 손으로 이은 회차') await linkLive(w, seller, c, w.fake.startLive(account.id))
    }
    const b = await liveBroadcast(w, seller)
    await wait(w, seller, b)
    const m = w.fake.startLive(account.id)
    const linkedAt = kst(19, 20, 0)
    const first = await commentAt(w, shop, m, linkedAt)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, actor: { kind: 'server' } })
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    let from = w.published.length
    const blocked = await commentAt(w, shop, m2, linkedAt + 30_000, '15')
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain(blocked)
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'LIVE_MOVED' || data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'OTHER_BROADCAST', broadcast: b, liveId: m2, count: 1, message: OTHER_MESSAGE })])
    // c를 끝낸다 → 아직 이은 지 60초 안이라 이제 (아)만 남는다 (다른 라이브 M3로 새 알림을 본다)
    w.clock.set(linkedAt + 40_000)
    await end(w, seller, c)
    const m3 = w.fake.startLive(account.id)
    from = w.published.length
    const soon = await commentAt(w, shop, m3, linkedAt + 50_000, '16')
    await expectTooSoon(w, seller, b, { live: m, linkedAt }, m3, soon, from, { count: 1, notice: true })
    from = w.published.length
    const at = linkedAt + SOON + 1
    const id = await commentAt(w, shop, m2, at, '17')
    await expectMoved(w, seller, b, m2, at, id, from)
    expect(await chatIdsOf(w, seller, b)).toEqual([first, id])
  })

  it('이은 지 60초 안에는 GAP가 나오지 않는다 — 이은 지 59초, 다른 회차 없음 → TOO_SOON, 다른 회차가 생기면 → OTHER_BROADCAST', async () => {
    const w = await world()
    const shop = await autoLinkedAt(w, kst(19, 20, 0))
    const { seller, b, m } = shop
    const m2 = w.fake.startLive(shop.account.id)
    let from = w.published.length
    const one = await commentAt(w, shop, m2, kst(19, 20, 0, 59), '15')
    await expectTooSoon(w, seller, b, { live: m, linkedAt: kst(19, 20, 0) }, m2, one, from, { count: 1, notice: true })
    w.clock.set(kst(19, 20, 0, 59, 500))
    await liveBroadcast(w, seller)
    const m3 = w.fake.startLive(shop.account.id)
    from = w.published.length
    await commentAt(w, shop, m3, kst(19, 20, 0, 59, 900), '15')
    expect(noticesSince(w, from).filter((data) => data.code === 'LIVE_NOT_MOVED')).toEqual([expect.objectContaining({ reason: 'OTHER_BROADCAST', liveId: m3 })])
  })

  it.each([
    { kind: '⑮(나) 늦은 댓글(entry.time 61초 이름)' as const },
    { kind: 'entry.time 없음' as const },
    { kind: '⑮(다) 판매자가 손으로 이은 b' as const },
    { kind: 'M2가 끝난 다른 회차에 이어졌던 라이브' as const },
    { kind: '조건에 맞는 회차 둘' as const },
  ])('이은 지 30초 + $kind → 그 밖의 조건이 틀려 UNLINKED_COMMENTS (LIVE_NOT_MOVED·TOO_SOON 아님), b는 그대로', async ({ kind }) => {
    const w = await world()
    w.clock.set(kst(19, 19, 0))
    const shop = await connectedShop(w)
    const { seller, account } = shop
    let m2: string
    if (kind === 'M2가 끝난 다른 회차에 이어졌던 라이브') {
      const d = await liveBroadcast(w, seller)
      m2 = w.fake.startLive(account.id)
      await linkLive(w, seller, d, m2)
      await end(w, seller, d)
    } else m2 = ''
    const b = await liveBroadcast(w, seller)
    const m = w.fake.startLive(account.id)
    const linkedAt = kst(19, 20, 0)
    if (kind === '⑮(다) 판매자가 손으로 이은 b') {
      w.clock.set(linkedAt)
      await linkLive(w, seller, b, m)
    } else {
      await wait(w, seller, b)
      await commentAt(w, shop, m, linkedAt)
    }
    if (kind === '조건에 맞는 회차 둘') {
      w.clock.set(linkedAt + 1_000)
      const b2 = await liveBroadcast(w, seller)
      await wait(w, seller, b2)
      const n = w.fake.startLive(account.id)
      await commentAt(w, shop, n, linkedAt + 5_000)
      expect(await linkOf(w, seller, b2)).toMatchObject({ liveId: n, actor: { kind: 'server' } })
    }
    if (m2 === '') m2 = w.fake.startLive(account.id)
    const from = w.published.length
    const at = linkedAt + 30_000
    if (kind === 'entry.time 없음') {
      w.clock.set(at)
      const change = w.fake.comment({ accountId: account.id, liveId: m2, igsid: '6024500000000401', username: 'no.time', text: '15' })
      const body = JSON.parse(w.fake.payload([{ accountId: account.id, changes: [change] }])) as { entry: Record<string, unknown>[] }
      for (const entry of body.entry) delete entry.time
      expect((await w.fake.deliver(webhookTarget(w), JSON.stringify(body))).status).toBe(200)
    } else await commentAt(w, shop, m2, at, '15', kind === '⑮(나) 늦은 댓글(entry.time 61초 이름)' ? { time: sec(at - 61_000) } : {})
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, linkedAt: iso(linkedAt) })
    expectUnlinkedOnly(w, from, m2)
  })

  it('⑦ 기다리는 회차가 먼저다 — b를 이은 지 10초, 기다리는 b3이 있으면 M2 댓글은 b3을 M2에 잇는다(TOO_SOON으로 막지 않는다)', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b, m } = shop
    w.clock.set(linkedAt + 5_000)
    const b3 = await liveBroadcast(w, seller)
    await wait(w, seller, b3)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const id = await commentAt(w, shop, m2, linkedAt + 10_000, '15')
    expect(await linkOf(w, seller, b3)).toMatchObject({ state: 'LINKED', liveId: m2, actor: { kind: 'server' } })
    expect(await chatIdsOf(w, seller, b3)).toEqual([id])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, linkedAt: iso(linkedAt) })
    expect(noticesSince(w, from).filter((data) => data.code === 'LIVE_NOT_MOVED' || data.code === 'UNLINKED_COMMENTS' || data.code === 'LIVE_MOVED')).toEqual([])
  })
})

describe('D-N2-18 알림 간격·고치는 길', () => {
  it('TOO_SOON 알림은 라이브마다 처음 한 번과 1분에 한 번까지 — 같은 라이브는 한 번, 다른 라이브는 따로. 옮긴 뒤 새 60초 창에서 1분이 지난 라이브는 다시 알린다', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b } = shop
    const m2 = w.fake.startLive(shop.account.id)
    const m3 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    await commentAt(w, shop, m2, linkedAt + 1, '15')
    await commentAt(w, shop, m2, linkedAt + 30_000, '15')
    await commentAt(w, shop, m3, linkedAt + 40_000, '16')
    await commentAt(w, shop, m2, linkedAt + 59_999, '15')
    const move = linkedAt + SOON + 1
    await commentAt(w, shop, m2, move, '17')
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: iso(move) })
    // 새 창: M3은 옮긴 지 30초(마지막 M3 알림에서 50.001초 — 알림 없음), 옮긴 지 60초 정각(마지막 알림에서 80.001초 — 알림)
    await commentAt(w, shop, m3, move + 30_000, '16')
    await commentAt(w, shop, m3, move + SOON, '16')
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: iso(move) })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 3, [m3]: 3 })
    const notices = noticesSince(w, from)
    expect(notices.filter((data) => data.code === 'UNLINKED_COMMENTS')).toEqual([])
    expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toEqual([expect.objectContaining({ liveId: m2, count: 1 })])
    expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').map((data) => [data.reason, data.broadcast, data.liveId, data.count])).toEqual([
      ['TOO_SOON', b, m2, 1],
      ['TOO_SOON', b, m3, 1],
      ['TOO_SOON', b, m3, 3],
    ])
  })

  it('고치는 길: TOO_SOON으로 막힌 뒤 기다리지 않고 b를 끊고 M2에 이으면 이어진다(LIVE_TAKEN 아님 — 막힌 라이브는 이어진 적 없는 라이브), 그 뒤 M2 댓글부터 기록', async () => {
    const w = await world()
    const linkedAt = kst(19, 20, 0)
    const shop = await autoLinkedAt(w, linkedAt)
    const { seller, b, m } = shop
    const api = client(w, seller.cookie)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(shop.account.id)
    const from = w.published.length
    const blocked = await commentAt(w, shop, m2, linkedAt + 20_000, '15')
    await expectTooSoon(w, seller, b, { live: m, linkedAt }, m2, blocked, from, { count: 1, notice: true })
    w.clock.set(linkedAt + 25_000)
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    await linkLive(w, seller, b, m2)
    expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: m2, actor: { kind: 'account' }, moved: null })
    const after = await commentAt(w, shop, m2, linkedAt + 30_000, '15', { igsid: '6024500000000501' })
    expect(await chatIdsOf(w, seller, b)).toEqual([shop.first, after])
    expect(await winners(w, seller, `${b}/15`)).toEqual(['ig:6024500000000501'])
  })
})

describe('D-N2-18 속성: 쓴 시각 = entry.time인 다시 켜기 열을 무작위 순서로 배달해도 스펙 모형과 같고, 끝난 라이브로 되돌아가지 않는다', () => {
  interface Plan {
    readonly restarts: number
    readonly durations: readonly number[]
    readonly gaps: readonly number[]
    readonly comments: readonly { readonly live: number; readonly offset: number; readonly delay: number }[]
  }
  const plan: fc.Arbitrary<Plan> = fc.record({
    restarts: fc.integer({ min: 2, max: 4 }),
    durations: fc.array(fc.integer({ min: 2_000, max: 40_000 }), { minLength: 5, maxLength: 5 }),
    gaps: fc.array(fc.integer({ min: 1_000, max: 20_000 }), { minLength: 5, maxLength: 5 }),
    comments: fc.array(fc.record({ live: fc.nat({ max: 20 }), offset: fc.nat({ max: 120_000 }), delay: fc.integer({ min: 0, max: 90_000 }) }), { minLength: 3, maxLength: 10 }),
  })

  it('모형: 지금 라이브면 기록 · 이어진 적 있는 라이브·늦은 댓글이면 기록 안 함 · 이은·옮긴 지 60,000ms 이하면 TOO_SOON · 아니면 옮김. 라이브 순번은 줄지 않고, 마지막(방송 중) 라이브에 이어지면 떠나지 않으며, 끝에 방송 중 라이브 댓글이 b를 데려온다', async () => {
    const w = await world()
    let run = 0
    await fc.assert(
      fc.asyncProperty(plan, async (p) => {
        run++
        const linkAt = kst(19, 20, 0) + run * 2 * 3_600_000
        const shop = await autoLinkedAt(w, linkAt)
        const { seller, b, m } = shop
        // 라이브 0 = M (linkAt − 60초 ~ linkAt + 5분), 그 뒤 라이브 1..k는 하나가 끝나고 1초 넘게 지나 다음이 켜진다. 마지막 라이브는 방송 중
        const lives = [m]
        const spans: [number, number][] = [[linkAt, linkAt + 300_000]]
        for (let i = 1; i <= p.restarts; i++) {
          const start = (spans[i - 1] as [number, number])[1] + (p.gaps[i - 1] as number)
          lives.push(w.fake.startLive(shop.account.id))
          spans.push([start, start + (i === p.restarts ? 120_000 : (p.durations[i - 1] as number))])
        }
        const lastIndex = p.restarts
        const planned = p.comments
          .map((c, index) => {
            const live = c.live % (p.restarts + 1)
            const [start, stop] = spans[live] as [number, number]
            const written = start + (c.offset % (stop - start + 1))
            return { index, live, written, received: written + c.delay }
          })
          .sort((x, y) => x.received - y.received || x.index - y.index)
        const indexOf = (liveId: string | null) => lives.indexOf(liveId ?? '')
        const ever = new Set([m])
        let current = { live: m, linkedAt: linkAt }
        const from = w.published.length
        let moves = 0
        for (const c of planned) {
          const before = await linkOf(w, seller, b)
          expect(before.liveId).toBe(current.live)
          expect(before.linkedAt).toBe(iso(current.linkedAt))
          const liveId = lives[c.live] as string
          const time = sec(c.written)
          const late = c.received - time * 1000 > 60_000
          const id = await commentAt(w, shop, liveId, c.received, '안녕하세요', { time })
          const after = await linkOf(w, seller, b)
          const recorded = (await chatIdsOf(w, seller, b)).includes(id)
          // 스펙 모형 (다른 회차 없음·간격 60분 안이라 (바)·(사)는 걸리지 않는다)
          let expected: 'record' | 'skip' | 'move'
          if (liveId === current.live) expected = 'record'
          else if (ever.has(liveId) || late) expected = 'skip'
          else if (c.received - current.linkedAt <= SOON) expected = 'skip'
          else expected = 'move'
          const label = JSON.stringify({ c, expected, current, late, lives })
          if (expected === 'move') {
            expect(after.liveId, label).toBe(liveId)
            expect(after.linkedAt, label).toBe(iso(c.received))
            expect(recorded, label).toBe(true)
            current = { live: liveId, linkedAt: c.received }
            ever.add(liveId)
            moves++
          } else {
            expect(after.liveId, label).toBe(current.live)
            expect(after.linkedAt, label).toBe(iso(current.linkedAt))
            expect(recorded, label).toBe(expected === 'record')
          }
          // 불변: 라이브 순번은 줄지 않는다 (끝난 라이브로 되돌아가지 않는다), 방송 중인 라이브에 이어졌으면 떠나지 않는다
          expect(indexOf(after.liveId), label).toBeGreaterThanOrEqual(indexOf(before.liveId))
          if (indexOf(before.liveId) === lastIndex) expect(indexOf(after.liveId), label).toBe(lastIndex)
        }
        // 끝: 마지막으로 받은 것에서 61초 뒤 방송 중 라이브의 늦지 않은 댓글 → b는 방송 중 라이브에 있다
        const finalAt = Math.max(linkAt, ...planned.map((c) => c.received)) + 61_000
        const finalId = await commentAt(w, shop, lives[lastIndex] as string, finalAt, '마지막')
        expect(await linkOf(w, seller, b)).toMatchObject({ liveId: lives[lastIndex] })
        expect(await chatIdsOf(w, seller, b)).toContain(finalId)
        if (current.live !== lives[lastIndex]) moves++
        const notices = noticesSince(w, from).filter((data) => (data.broadcast ?? b) === b)
        expect(notices.filter((data) => data.code === 'LIVE_MOVED')).toHaveLength(moves)
        expect(notices.filter((data) => data.code === 'LIVE_NOT_MOVED').every((data) => data.reason === 'TOO_SOON')).toBe(true)
      }),
      { numRuns: 14, seed: 20261020 },
    )
  }, 300_000)
})
