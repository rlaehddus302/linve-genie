// 플랫폼 라이브가 끝나면 회차를 저절로 끝냄 (D-LIVE-AUTOEND).
// 틱톡: 방송 끝(STREAM_END) 뒤 5분 기다림 — 그 안에 다시 받는 중이 되면 끝내지 않는다. 끊김·오류는 끝내지 않는다.
// 유튜브: 수집기가 채팅 끝을 알면(남은 채팅을 다 기록한 뒤) 바로 끝낸다.
// 끝내기는 판매자가 [라이브 연결 끊기]를 누를 때와 같은 길(service.endBroadcast) · 회차마다 정해진 요청 번호 — 두 번 와도 한 번.
import { afterEach, describe, expect, it } from 'vitest'
import { LiveAutoEnd, autoEndRequestId } from '../src/live-auto-end.ts'
import { findBroadcast } from '../src/store.ts'
import { TIKTOK_NOT_LIVE_RETRY_MS } from '../src/tiktok/index.ts'
import { TIKTOK_AUTO_END_GRACE_MS, TIKTOK_AUTO_END_RECHECK_MS } from '../src/tiktok-live/live.ts'
import { addSeller, client, createBroadcast, rid, waitFor as waitReal, type TestServer } from './support.ts'
import { connected, linkTiktok, realBroadcast, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'
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

describe('틱톡 방송 끝 → 기다린 뒤 회차를 끝낸다', () => {
  it('STREAM_END 뒤 5분 동안 다시 켜지지 않으면 판매자가 끝낼 때와 같은 길로 끝낸다 (서버 조치·정해진 요청 번호, 틱톡 연결 마침)', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING'])
    // 기다리는 동안은 끝내지 않는다 (다시 확인하면 방송 전)
    await w.tclock.advance(TIKTOK_AUTO_END_GRACE_MS - 1000)
    await w.server.tiktok.idle()
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    await w.tclock.advance(1000)
    await waitReal(async () => {
      await w.server.tiktok.idle()
      return (await endedAt(w, seller.sellerId, b)) !== null
    })
    expect(await endEvents(w, seller.sellerId)).toEqual([{ actor: 'server', request_id: autoEndRequestId(b), changed: true }])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_ENDED:TIKTOK'])
    // 같은 길: 회차를 끝내면 틱톡 연결이 마침(FINISHED)이 되고 연결 객체가 멈춘다
    const view = (await client(w, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: { state: string } }
    expect(view.collection.state).toBe('FINISHED')
    expect(w.server.tiktok.connections).toBe(0)
    expect(w.tclock.pendingTimers).toBe(0)
  })

  it('기다리는 동안 판매자가 틱톡 방송을 다시 켜면(다시 받는 중) 끝내지 않는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    // 첫 다시 확인은 방송 전, 그 사이 판매자가 새로 켠다 → 다음 확인(연결 객체의 방송 전 다시 확인)에서 받는 중
    await w.tclock.advance(TIKTOK_AUTO_END_RECHECK_MS)
    await w.server.tiktok.idle()
    w.webcast.account(tiktokId, 'LIVE')
    await w.tclock.advance(TIKTOK_NOT_LIVE_RETRY_MS)
    await connected(w, seller, b)
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_END_CANCELLED'])
    await w.tclock.advance(3 * TIKTOK_AUTO_END_GRACE_MS)
    await w.server.tiktok.idle()
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(await endEvents(w, seller.sellerId)).toEqual([])
  })

  it('방송 끝 직후 다시 확인에서 바로 받는 중이 되어도(같은 아이디로 새 방송) 끝내지 않는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    for (const handle of w.webcast.openHandles(tiktokId)) handle.endStream()
    await w.tclock.advance(TIKTOK_AUTO_END_RECHECK_MS)
    await connected(w, seller, b)
    await w.tclock.advance(2 * TIKTOK_AUTO_END_GRACE_MS)
    await w.server.tiktok.idle()
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING', 'BROADCAST_AUTO_END_CANCELLED'])
  })

  it('끊김(방송 끝 신호 없음)은 오래 이어져도 끝내지 않는다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    w.webcast.account(tiktokId, 'OFFLINE')
    for (const handle of w.webcast.openHandles(tiktokId)) handle.drop()
    await w.tclock.advance(4 * TIKTOK_AUTO_END_GRACE_MS)
    await w.server.tiktok.idle()
    expect(await endedAt(w, seller.sellerId, b)).toBeNull()
    expect(codes(w)).toEqual([])
  })

  it('기다리는 동안 판매자가 먼저 끝내면 그대로 — 기다림이 사라지고 오류 없음. 서버를 닫으면 남은 타이머가 없다', async () => {
    const w = await tt()
    const { seller, tiktokId, b } = await liveTiktok(w)
    await tiktokEnds(w, tiktokId)
    const ended = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    expect(ended.status, ended.text).toBe(200)
    await w.tclock.advance(2 * TIKTOK_AUTO_END_GRACE_MS)
    await w.server.tiktok.idle()
    expect((await endEvents(w, seller.sellerId)).map((row) => row.actor)).toEqual(['account'])
    expect(codes(w)).toEqual(['BROADCAST_AUTO_END_WAITING'])

    // 다른 판매자: 기다리는 중에 서버를 닫는다
    const other = await liveTiktok(w)
    await tiktokEnds(w, other.tiktokId)
    expect(w.tclock.pendingTimers).toBeGreaterThan(0)
    w.server.tiktok.close()
    expect(w.tclock.pendingTimers).toBe(0)
    await w.tclock.advance(2 * TIKTOK_AUTO_END_GRACE_MS)
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
