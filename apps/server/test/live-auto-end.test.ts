// 플랫폼 라이브가 끝나면 회차를 저절로 끝냄 (D-LIVE-AUTOEND).
// 틱톡 (D-TT-END-01이 D-LIVE-AUTOEND의 "STREAM_END 뒤 5분"을 바꿈): 끝 신호(방송 끝 STREAM_END, 또는 받던 라이브가 끊긴 뒤 방 상태 "방송 중 아님")
// 뒤 1분 넘게 지나 시작한 방 상태 확인이 다시 "방송 중 아님"이면 끝낸다. 그 사이 다시 받는 중이 되면 끝내지 않는다. 끊김·오류만으로는 끝내지 않는다.
// 2026-11-16 @bit_succulent_farm 방송 1:36 끝 — 판매자는 저절로 끝나지 않았다고 느꼈다(옛 판은 5분을 기다렸고, 끝 신호 없이 연결만 닫히면 끝내지 않았다).
// 유튜브: 수집기가 채팅 끝을 알면(남은 채팅을 다 기록한 뒤) 바로 끝낸다.
// 끝내기는 판매자가 [라이브 연결 끊기]를 누를 때와 같은 길(service.endBroadcast) · 회차마다 정해진 요청 번호 — 두 번 와도 한 번.
import { afterEach, describe, expect, it } from 'vitest'
import { LiveAutoEnd, autoEndRequestId } from '../src/live-auto-end.ts'
import { findBroadcast } from '../src/store.ts'
import { FakeWebcast, TIKTOK_NOT_LIVE_RETRY_MS, TIKTOK_RETRY_DELAYS_MS, TIKTOK_STALL_MS } from '../src/tiktok/index.ts'
import { TIKTOK_AUTO_END_CONFIRM_MS } from '../src/tiktok-live/live.ts'
import { addSeller, client, createBroadcast, rid, waitFor as waitReal, type TestServer } from './support.ts'
import { chats, connected, linkTiktok, realBroadcast, restart, tiktokComment, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'
import { collectorOfWorld, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const ttWorlds: TtWorld[] = []
const webWorlds: WebWorld[] = []
async function tt(): Promise<TtWorld> {
  const w = await ttWorld()
  ttWorlds.push(w)
  return w
}
async function yt(): Promise<WebWorld> {
  const w = await webWorld()
  webWorlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of ttWorlds.splice(0)) await w.close()
  const closing = webWorlds.splice(0)
  for (const w of closing) {
    w.server.close()
    await w.server.stop()
  }
  for (const w of closing) await w.web.close()
})

const endedAt = async (w: TestServer, sellerId: string, b: string) => (await findBroadcast(w.database.db, sellerId, b))?.endedAt ?? null
const endEvents = async (w: TestServer, sellerId: string) =>
  (await w.database.pglite?.query<{ actor: string; request_id: string | null; changed: boolean }>(`select actor, request_id, changed from events where seller_id = $1 and type = 'broadcast.end' order by seq`, [sellerId]))?.rows ?? []
const codes = (w: TestServer, prefix = 'BROADCAST_AUTO_END') => w.logs.filter((log) => log.code.startsWith(prefix)).map((log) => `${log.code}${log.reason === undefined ? '' : `:${log.reason}`}`)

/** 틱톡 판매자 하나 + 받는 중인 실제 회차 */
async function liveTiktok(w: TtWorld) {
  const { seller, tiktokId } = await tiktokSeller(w)
  const b = await realBroadcast(w, seller)
  expect((await linkTiktok(w, seller, b)).status).toBe(200)
  await connected(w, seller, b)
  return { seller, tiktokId, b }
}

/** 틱톡이 방송 끝을 알림 (그 뒤 계정은 방송 전 — 다시 확인하면 NOT_LIVE) */
async function tiktokEnds(w: TtWorld, tiktokId: string) {
  w.webcast.account(tiktokId, 'OFFLINE')
  for (const handle of w.webcast.openHandles(tiktokId)) handle.endStream()
  await w.tclock.advance(0)
}

/** 시계를 ms만큼 (연결 객체의 동의 확인·기록이 끝날 때까지 기다리며) */
async function after(w: TtWorld, ms: number) {
  await w.tclock.advance(ms)
  await w.server.tiktok.idle()
  await w.tclock.advance(0)
  await w.server.tiktok.idle()
}

/** 회차가 끝날 때까지 */
async function endsSoon(w: TtWorld, sellerId: string, b: string) {
  await waitReal(async () => {
    await w.tclock.advance(0)
    await w.server.tiktok.idle()
    return (await endedAt(w, sellerId, b)) !== null
  })
}

/** 연결 객체 상태가 그것이 될 때까지 */
async function stateIs(w: TtWorld, cookie: string, b: string, state: string, reason?: string) {
  await waitReal(async () => {
    await w.tclock.advance(0)
    const view = (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection?: { state?: string; reason?: string | null } }
    return view.collection?.state === state && (reason === undefined || view.collection.reason === reason)
  })
}

describe('틱톡 라이브 끝 → 한 번 더 확인한 뒤 회차를 끝낸다 (D-TT-END-01)', () => {
  it('STREAM_END 뒤 1분 지나 다시 확인해도 방송 중이 아니면 판매자가 끝낼 때와 같은 길로 끝낸다 (서버 조치·정해진 요청 번호, 틱톡 연결 마침)', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING'])
    // 확인 전에는 끝내지 않는다
    await after(w, TIKTOK_AUTO_END_CONFIRM_MS - 1000)
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    await w.tclock.advance(1000)
    await endsSoon(w, seller.sellerId, b)
    expect(await endEvents(w, seller.sellerId)).toEqual([{ actor: 'server', request_id: autoEndRequestId(b), changed: true }])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_ENDED:TIKTOK'])
    // 같은 길: 회차를 끝내면 틱톡 연결이 마침(FINISHED)이 되고 연결 객체가 멈춘다
    const view = (await client(w, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: { state: string } }
    expect(view.collection.state).toBe('FINISHED')
    expect(w.server.tiktok.connections).toBe(0)
    expect(w.tclock.pendingTimers).toBe(0)
  })

  it('2026-11-16 1:36: 끝 신호 없이 연결만 닫히고 방 상태가 "방송 중 아님"이면, 1분 뒤 다시 물어 같으면 끝낸다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    w.webcast.account(tiktokId, 'OFFLINE')
    for (const handle of w.webcast.openHandles(tiktokId)) handle.drop()
    await w.tclock.advance(0)
    expect(codes(w)).toEqual([])
    // 끊김 → 5초 뒤 다시 연결 → 방 상태 "방송 중 아님" (첫 신호)
    await after(w, TIKTOK_RETRY_DELAYS_MS[0] ?? 5000)
    await stateIs(w, seller.cookie, b, 'RETRYING', 'NOT_LIVE')
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING'])
    await after(w, TIKTOK_AUTO_END_CONFIRM_MS - 1000)
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    await w.tclock.advance(1000)
    await endsSoon(w, seller.sellerId, b)
    expect(await endEvents(w, seller.sellerId)).toEqual([{ actor: 'server', request_id: autoEndRequestId(b), changed: true }])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_ENDED:TIKTOK'])
  })

  it('끊긴 뒤 같은(끝난) 방에 다시 붙었다가 자료가 끊겨도(멈춘 연결) 결국 방 상태로 끝낸다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    for (const handle of w.webcast.openHandles(tiktokId)) handle.endStream()
    await w.tclock.advance(0)
    // 1분 뒤 확인에서 틱톡이 아직 방송 중이라고 해 다시 붙는다 → 취소
    await after(w, TIKTOK_AUTO_END_CONFIRM_MS)
    await connected(w, seller, b)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_END_CANCELLED'])
    // 끝난 방이라 자료가 오지 않는다 → 멈춘 연결(2분) → 다시 연결 → 이제 방송 중 아님 → 1분 뒤 다시 확인 → 끝
    w.webcast.account(tiktokId, 'OFFLINE')
    await after(w, TIKTOK_STALL_MS)
    await after(w, TIKTOK_RETRY_DELAYS_MS[0] ?? 5000)
    await stateIs(w, seller.cookie, b, 'RETRYING', 'NOT_LIVE')
    await after(w, TIKTOK_AUTO_END_CONFIRM_MS)
    await endsSoon(w, seller.sellerId, b)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_END_CANCELLED', 'BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_ENDED:TIKTOK'])
  })

  it('확인 전에 판매자가 틱톡 방송을 다시 켜면(2026-11-16 23:46 끝 → 35초 뒤 새 방송) 끝내지 않는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    await after(w, 35_000)
    w.webcast.account(tiktokId, 'LIVE')
    await after(w, TIKTOK_AUTO_END_CONFIRM_MS - 35_000)
    await connected(w, seller, b)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_END_CANCELLED'])
    await after(w, 10 * TIKTOK_AUTO_END_CONFIRM_MS)
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(await endEvents(w, seller.sellerId)).toEqual([])
  })

  it('끊김(방 상태는 방송 중)은 오래 이어져도 끝내지 않는다 — 다시 붙는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    w.webcast.failNext('NETWORK', 3)
    for (const handle of w.webcast.openHandles(tiktokId)) handle.drop()
    await after(w, 60_000)
    await after(w, 60_000)
    await connected(w, seller, b)
    await after(w, 5 * TIKTOK_AUTO_END_CONFIRM_MS)
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(codes(w)).toEqual([])
  })

  it('방송을 시작하기 전에 이어 둔 연결의 "방송 중 아님"은 끝 신호가 아니다', async () => {
    const w = await tt()
    const { seller, tiktokId } = await tiktokSeller(w, { account: 'OFFLINE' })
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await stateIs(w, seller.cookie, b, 'RETRYING', 'NOT_LIVE')
    for (let i = 0; i < 5; i += 1) await after(w, TIKTOK_NOT_LIVE_RETRY_MS)
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(codes(w)).toEqual([])
    // 그 뒤 방송을 켜면 받는다
    w.webcast.account(tiktokId, 'LIVE')
    await after(w, TIKTOK_NOT_LIVE_RETRY_MS)
    await connected(w, seller, b)
  })

  it('서버가 다시 켜진 뒤: 이 회차에 틱톡 댓글을 기록한 적이 있으면 받던 라이브로 보고 끝낸다 · 없으면 끝내지 않는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokComment(w, tiktokId, { userId: '7101', comment: '15' })
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    const quiet = await tiktokSeller(w)
    const qb = await realBroadcast(w, quiet.seller)
    expect((await linkTiktok(w, quiet.seller, qb)).status).toBe(200)
    await connected(w, quiet.seller, qb)
    // 서버가 꺼진 사이 두 틱톡 방송이 끝났다
    const fresh = new FakeWebcast().account(tiktokId, 'OFFLINE').account(quiet.tiktokId, 'OFFLINE')
    const again = await restart(w, { webcast: fresh })
    ttWorlds.push(again)
    expect(await again.server.tiktok.resume()).toBe(2)
    await stateIs(again, seller.cookie, b, 'RETRYING', 'NOT_LIVE')
    await stateIs(again, quiet.seller.cookie, qb, 'RETRYING', 'NOT_LIVE')
    await after(again, TIKTOK_AUTO_END_CONFIRM_MS)
    await endsSoon(again, seller.sellerId, b)
    await after(again, 3 * TIKTOK_AUTO_END_CONFIRM_MS)
    expect(await endedAt(again, quiet.seller.sellerId, qb)).toBeNull()
  })

  it('확인 중에 판매자가 먼저 끝내면 그대로 — 확인이 사라지고 오류 없음. 서버를 닫으면 남은 타이머가 없다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    const ended = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    expect(ended.status, ended.text).toBe(200)
    await after(w, 3 * TIKTOK_AUTO_END_CONFIRM_MS)
    expect((await endEvents(w, seller.sellerId)).map((row) => row.actor)).toEqual(['account'])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING'])

    // 다른 판매자: 확인 중에 서버를 닫는다
    const other = await liveTiktok(w)
    await tiktokEnds(w, other.tiktokId)
    expect(w.tclock.pendingTimers).toBeGreaterThan(0)
    w.server.tiktok.close()
    expect(w.tclock.pendingTimers).toBe(0)
    await w.tclock.advance(3 * TIKTOK_AUTO_END_CONFIRM_MS)
    expect(await endedAt(w, other.seller.sellerId, other.b)).toBeNull()
  })
})

describe('유튜브 라이브 끝 → 남은 채팅을 기록한 뒤 회차를 끝낸다', () => {
  it('수집기가 채팅 끝을 알면(방송 페이지로 확인) 회차를 끝낸다 — 끝 전 채팅은 모두 기록', async () => {
    const w = await yt()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '1번 찜' })
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).recorded === 1, { step: 500 })
    expect(await endedAt(w, seller.sellerId, b.id)).toBeNull()
    video.state = 'ended'
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'CHAT_ENDED', { step: 500 })
    await waitFor(w, async () => (await endedAt(w, seller.sellerId, b.id)) !== null, { step: 100 })
    expect(await endEvents(w, seller.sellerId)).toEqual([{ actor: 'server', request_id: autoEndRequestId(b.id), changed: true }])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_ENDED:YOUTUBE'])
    expect((await collectorOfWorld(w, seller.cookie, b.id)).recorded).toBe(1)
  })

  it('끊김(연결 오류)은 끝내지 않는다', async () => {
    const w = await yt()
    const { seller, b } = await webLinked(w)
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { kind: 'reset' }, 5)
    await pass(w, 120_000, 1000)
    expect(await endedAt(w, seller.sellerId, b.id)).toBeNull()
    expect(codes(w)).toEqual([])
  })
})

describe('끝내기 조건 (LiveAutoEnd)', () => {
  it('리허설·이미 끝낸 회차·만드는 중은 끝내지 않는다. 두 번 불러도 한 번만 기록', async () => {
    const w = await tt()
    const seller = await addSeller(w)
    const auto = new LiveAutoEnd({ db: w.database.db, service: w.server.service, log: () => undefined })
    const rehearsal = await createBroadcast(w, seller, { rehearsal: true })
    expect(await auto.ended(seller.sellerId, rehearsal.id, { platform: 'TIKTOK' })).toBe('REHEARSAL')
    expect(await endedAt(w, seller.sellerId, rehearsal.id)).toBeNull()

    const draft = await client(w, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), draft: true })
    expect(draft.status, draft.text).toBe(200)
    const draftId = (draft.body.broadcast as { id: string }).id
    expect(await auto.ended(seller.sellerId, draftId, { platform: 'TIKTOK' })).toBe('DRAFT')

    const real = await createBroadcast(w, seller)
    expect(await auto.ended(seller.sellerId, real.id, { platform: 'TIKTOK' })).toBe('ENDED')
    expect(await auto.ended(seller.sellerId, real.id, { platform: 'TIKTOK' })).toBe('ALREADY_ENDED')
    expect(await auto.ended(seller.sellerId, real.id, { platform: 'YOUTUBE', linkId: 'yl_x', started: true })).toBe('ALREADY_ENDED')
    expect((await endEvents(w, seller.sellerId)).filter((row) => row.request_id === autoEndRequestId(real.id))).toHaveLength(1)

    // 판매자가 먼저 끝낸 회차
    const manual = await createBroadcast(w, seller)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${manual.id}/end`, { requestId: rid('end') })).status).toBe(200)
    expect(await auto.ended(seller.sellerId, manual.id, { platform: 'TIKTOK' })).toBe('ALREADY_ENDED')
    expect(await auto.ended(seller.sellerId, 'b_missing', { platform: 'TIKTOK' })).toBe('NOT_FOUND')
  })

  it('같은 회차에 아직 끝나지 않은 다른 플랫폼이 있으면 끝내지 않는다 · 유튜브는 지금 이어 둔 그 연결이 실제로 시작했을 때만', async () => {
    const w = await yt()
    // 수집기는 돌리지 않는다 — 이어 둔 연결(끊지 않음·채팅 끝 모름)만 본다
    const { seller, b } = await webLinked(w)
    let tiktokLive = true
    const auto = new LiveAutoEnd({ db: w.database.db, service: w.server.service, log: () => undefined, tiktokMayBeLive: async () => tiktokLive })
    const rows = await w.database.pglite?.query<{ id: string }>(`select id from youtube_links where seller_id = $1 and broadcast_id = $2`, [seller.sellerId, b.id])
    const linkId = rows?.rows[0]?.id as string
    expect(await auto.ended(seller.sellerId, b.id, { platform: 'YOUTUBE', linkId: 'yl_other', started: true })).toBe('LINK_CHANGED')
    expect(await auto.ended(seller.sellerId, b.id, { platform: 'YOUTUBE', linkId, started: false })).toBe('NOT_STARTED')
    expect(await auto.ended(seller.sellerId, b.id, { platform: 'YOUTUBE', linkId, started: true })).toBe('OTHER_LIVE')
    // 틱톡 끝은 유튜브가 아직 끝나지 않았으면(채팅 끝 모름) 끝내지 않는다
    expect(await auto.ended(seller.sellerId, b.id, { platform: 'TIKTOK' })).toBe('OTHER_LIVE')
    expect(await endedAt(w, seller.sellerId, b.id)).toBeNull()
    tiktokLive = false
    expect(await auto.ended(seller.sellerId, b.id, { platform: 'YOUTUBE', linkId, started: true })).toBe('ENDED')
  })
})
