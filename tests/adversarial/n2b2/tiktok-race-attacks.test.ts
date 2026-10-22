// N2b-2 적대 시험 (test-domain): 틱톡 연결의 경합 — 끊기·끝내기와 댓글 몰림, 동의 끄기와 잇기, 다시 연결 연타 (AC-N2b-2-23·32·33·34·51).
// 가짜 웹캐스트·주입한 시계 — 바깥 연결 없음.
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { client, rid } from '../../../apps/server/test/support.ts'
import { chats, connected, linkTiktok, msgId, realBroadcast, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from '../../../apps/server/test/tiktok-live-support.ts'

installNetworkGuard()

const worlds: TtWorld[] = []
async function world(): Promise<TtWorld> {
  const w = await ttWorld()
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const register = async (w: TtWorld, cookie: string, b: string, no: number) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price: 1000 })
  expect(response.status, response.text).toBe(200)
}

async function linkRows(w: TtWorld, sellerId: string): Promise<{ id: number; state: string; not_recorded: number; save_failed: number }[]> {
  const rows = await w.database.pglite?.query<{ id: number; state: string; not_recorded: number; save_failed: number }>(
    `select id, state, not_recorded, save_failed from tiktok_links where seller_id = $1 order by id`,
    [sellerId],
  )
  return rows?.rows ?? []
}

/** 서로 다른 시청자 댓글 n개를 한꺼번에 보낸다 (연결 모듈은 받은 순서대로 바로 넘긴다 — 기록은 아직) */
function flood(w: TtWorld, tiktokId: string, n: number): void {
  for (let i = 0; i < n; i += 1) w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: `71019${String(i).padStart(14, '0')}`, uniqueId: `v${String(i)}`, nickname: `시청자${String(i)}`, comment: '15' })
}

describe('N2b-2 틱톡 끊기·끝내기와 댓글 몰림', () => {
  it('TD-N2b-2-R01: 댓글 300개가 기록되는 중에 끊으면 — 끊은 뒤 기록 0, 기록한 수 + 기록하지 않은 수 = 받은 수 (AC-N2b-2-32·51)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    flood(w, tiktokId, 300)
    const unlinked = await unlinkTiktok(w, seller, b)
    expect(unlinked.status, unlinked.text).toBe(200)
    await w.server.tiktok.idle()
    const recorded = (await chats(w, seller.sellerId)).length
    // 끊은 뒤에는 더 늘지 않는다
    flood(w, tiktokId, 10)
    await w.server.tiktok.idle()
    expect((await chats(w, seller.sellerId)).length).toBe(recorded)
    const [link] = await linkRows(w, seller.sellerId)
    expect(link?.state).toBe('UNLINKED')
    expect(recorded + (link?.not_recorded ?? 0) + (link?.save_failed ?? 0)).toBe(300)
    expect(link?.save_failed).toBe(0)
  })

  it('TD-N2b-2-R02: 댓글 300개가 기록되는 중에 회차를 끝내면 — 기록된 chat은 모두 broadcast.end 앞, 기록한 수 + 기록하지 않은 수 = 받은 수 (AC-N2b-2-33·51)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    flood(w, tiktokId, 300)
    const ended = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    expect(ended.status, ended.text).toBe(200)
    await w.server.tiktok.idle()
    const recorded = await chats(w, seller.sellerId)
    const endSeq = (await w.database.pglite?.query<{ seq: number }>(`select seq from events where seller_id = $1 and type = 'broadcast.end'`, [seller.sellerId]))?.rows[0]?.seq as number
    expect(recorded.every((chat) => chat.seq < endSeq)).toBe(true)
    const view = (await client(w, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: { state: string; notRecorded: number; comments: number } }
    expect(view.collection.state).toBe('FINISHED')
    expect(view.collection.comments).toBe(recorded.length)
    expect(recorded.length + view.collection.notRecorded).toBe(300)
  })
})

describe('N2b-2 동의 끄기와 잇기가 겹침', () => {
  it('TD-N2b-2-R03: 잇기와 동의 끄기를 동시에 보내도 — 끈 뒤 열린 틱톡 연결이 남지 않는다 (AC-N2b-2-23)', async () => {
    const w = await world()
    for (let round = 0; round < 6; round += 1) {
      const { seller, tiktokId } = await tiktokSeller(w)
      const b = await realBroadcast(w, seller)
      const api = client(w, seller.cookie)
      const [linked, off] = await Promise.all([linkTiktok(w, seller, b), api.post('/api/tiktok/consent', { requestId: rid('off'), on: false })])
      expect(off.status, off.text).toBe(200)
      expect([200, 409]).toContain(linked.status)
      for (let i = 0; i < 5; i += 1) await w.tclock.advance(0)
      await w.server.tiktok.idle()
      expect(w.webcast.openHandles(tiktokId), `round ${String(round)}`).toHaveLength(0)
      if (linked.status === 200) {
        const view = (await api.get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: { state: string } }
        expect(view.collection.state).toBe('OFF')
        // 끈 뒤 보낸 댓글은 기록 0
        w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7101', uniqueId: 'v', nickname: 'v', comment: '15' })
        await w.server.tiktok.idle()
        expect(await chats(w, seller.sellerId)).toHaveLength(0)
      }
    }
  })
})

describe('N2b-2 다시 시도 중에 끄기·끝내기', () => {
  it('TD-N2b-2-R05: 방송 전 기다리기(RETRYING)·끊김 다시 시도 중에 동의를 끄거나 회차를 끝내면 남은 타이머 0, 그 뒤 1시간 동안 바깥 시도 0 (AC-N2b-2-23·33)', async () => {
    const w = await world()
    // (가) 방송 전 기다리기 중 동의 끄기
    const a = await tiktokSeller(w, { account: 'OFFLINE' })
    const ba = await realBroadcast(w, a.seller)
    expect((await linkTiktok(w, a.seller, ba)).status).toBe(200)
    for (let i = 0; i < 5; i += 1) await w.tclock.advance(0)
    expect(((await client(w, a.seller.cookie).get(`/api/broadcasts/${ba}/tiktok`)).body.link as { collection: { state: string } }).collection.state).toBe('RETRYING')
    expect((await client(w, a.seller.cookie).post('/api/tiktok/consent', { requestId: rid('off'), on: false })).status).toBe(200)
    expect(w.tclock.pendingTimers).toBe(0)
    // (나) 끊김 다시 시도 중 회차 끝내기
    const b = await tiktokSeller(w)
    const bb = await realBroadcast(w, b.seller)
    expect((await linkTiktok(w, b.seller, bb)).status).toBe(200)
    await connected(w, b.seller, bb)
    w.webcast.last?.drop()
    for (let i = 0; i < 5; i += 1) await w.tclock.advance(0)
    expect((await client(w, b.seller.cookie).post(`/api/broadcasts/${bb}/end`, { requestId: rid('end') })).status).toBe(200)
    expect(w.tclock.pendingTimers).toBe(0)
    const attempts = w.webcast.attempts
    await w.tclock.advance(3_600_000)
    expect(w.webcast.attempts).toBe(attempts)
  })
})

describe('N2b-2 다시 연결 연타', () => {
  it('TD-N2b-2-R04: 30초가 지난 뒤 다시 연결을 8번 동시에 눌러도 받는 것은 하나, 바깥 시도도 하나 (AC-N2b-2-34)', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w, { account: 'OFFLINE' })
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await w.tclock.advance(0)
    await w.tclock.advance(30_000)
    await w.server.tiktok.idle()
    const attempts = w.webcast.attempts
    // 방송 전 기다리기(60초 간격)라 30초 시점에는 다시 시도가 없다 — 늘어난 시도는 다시 연결 몫
    const api = client(w, seller.cookie)
    const responses = await Promise.all(Array.from({ length: 8 }, () => api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})))
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1)
    expect(responses.filter((r) => r.status === 409).every((r) => (r.body.error as { code: string }).code === 'TOO_SOON')).toBe(true)
    for (let i = 0; i < 5; i += 1) await w.tclock.advance(0)
    expect(w.webcast.attempts - attempts).toBeLessThanOrEqual(1)
  })
})
