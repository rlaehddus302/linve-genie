// D-RECENT-TT-01 (판매자 보고 2026-11-17 "라이브 링크 넣는 화면에 최근 연결한 채널에 틱톡은 없음"): GET /api/youtube/live-broadcasts가
// 최근 연결한 틱톡 계정도 따로 된 칸(tiktok)으로 알린다 — 아이디마다 한 줄, 최근 이은 것이 먼저, 5곳까지. 유튜브 채널 줄(channels)은 그대로에
// 이은 때(linkedAt)만 더한다. 틱톡에는 묻지 않는다(라이브인지 모름). 다른 판매자의 틱톡 연결은 보이지 않는다.
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { broadcasts } from '../src/db/schema.ts'
import { insertTiktokLink, unlinkTiktokLink } from '../src/tiktok-live/store.ts'
import { addSeller, client, createBroadcast, type Seller } from './support.ts'
import { pass, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
async function world(): Promise<WebWorld> {
  const created = await webWorld()
  worlds.push(created)
  return created
}
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of new Set(closing.map((w) => w.web))) await item.close()
})

/** 그 회차에 틱톡 아이디를 이어 둔다 (지금 시계로) — 잇기 경로의 바깥 연결 없이 기록만 */
async function tiktokLinked(w: WebWorld, seller: Seller, broadcastId: string, tiktokId: string): Promise<number> {
  const [row] = await w.database.db.select({ scopeId: broadcasts.scopeId }).from(broadcasts).where(eq(broadcasts.id, broadcastId))
  return insertTiktokLink(w.database.db, { sellerId: seller.sellerId, broadcastId, scopeId: row!.scopeId, tiktokId, actorAccountId: seller.accountId, now: new Date(w.timer.now()) })
}
const unlink = async (w: WebWorld, seller: Seller, linkId: number) => {
  expect(await unlinkTiktokLink(w.database.db, seller.sellerId, linkId, seller.accountId, new Date(w.timer.now()))).toBe(true)
}

describe('D-RECENT-TT-01 최근 연결한 채널에 틱톡 계정', () => {
  it('틱톡 계정을 아이디마다 한 줄, 최근 이은 것부터 — 이어진 회차·사진 볼 회차, 유튜브 채널 줄은 그대로에 이은 때만 더한다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    // 차례: 유튜브 채널1 → 틱톡 shop.one(b2) → 유튜브 채널2 → 틱톡 shop.three(b4, 끊음) → 틱톡 shop.two(b4, 이어짐) → 틱톡 shop.one 다시(b5, 끊음)
    const first = await webLinked(w, { seller, video: w.web.addVideo({ channelTitle: '채널1' }), date: '2026-10-10' })
    await pass(w, 60_000, 60_000)
    const b2 = await createBroadcast(w, seller, { date: '2026-10-11' })
    await unlink(w, seller, await tiktokLinked(w, seller, b2.id, 'shop.one'))
    await pass(w, 60_000, 60_000)
    const second = await webLinked(w, { seller, video: w.web.addVideo({ channelTitle: '채널2' }), date: '2026-10-12' })
    await pass(w, 60_000, 60_000)
    const b4 = await createBroadcast(w, seller, { date: '2026-10-13' })
    await unlink(w, seller, await tiktokLinked(w, seller, b4.id, 'shop.three'))
    await pass(w, 60_000, 60_000)
    const b5 = await createBroadcast(w, seller, { date: '2026-10-14' })
    await unlink(w, seller, await tiktokLinked(w, seller, b5.id, 'shop.one'))
    await pass(w, 60_000, 60_000)
    await tiktokLinked(w, seller, b4.id, 'shop.two')
    // 다른 판매자의 틱톡 연결은 보이지 않는다
    const other = await addSeller(w)
    const ob = await createBroadcast(w, other, { date: '2026-10-15' })
    await tiktokLinked(w, other, ob.id, 'not.mine')

    const before = w.web.calls('channelLive')
    const found = await api.get('/api/youtube/live-broadcasts')
    expect(found.status).toBe(200)
    const tiktok = found.body.tiktok as { tiktokId: string; linkedAt: string; linkedBroadcast: string | null; photoBroadcast: string | null }[]
    expect(tiktok.map((row) => row.tiktokId)).toEqual(['shop.two', 'shop.one', 'shop.three'])
    expect(tiktok.map((row) => row.linkedBroadcast)).toEqual([b4.id, null, null])
    // 사진은 그 회차의 마지막 틱톡 연결이 이 아이디인 회차에서 — b4의 마지막은 shop.two라 shop.three는 볼 회차가 없다
    expect(tiktok.map((row) => row.photoBroadcast)).toEqual([b4.id, b5.id, null])
    // 이은 때는 가장 최근 것 (shop.one은 b5)
    const times = tiktok.map((row) => Date.parse(row.linkedAt))
    expect(times[0]).toBeGreaterThan(times[1]!)
    expect(times[1]).toBeGreaterThan(times[2]!)

    // 유튜브 채널 줄은 전과 같고 이은 때만 더해졌다 — 틱톡 아이디는 섞이지 않는다
    const channels = found.body.channels as { channelId: string; channelTitle: string | null; videoId: string | null; linkedAt: string }[]
    expect(channels.map((row) => ({ channelId: row.channelId, channelTitle: row.channelTitle, videoId: row.videoId }))).toEqual([
      { channelId: second.video.channelId, channelTitle: '채널2', videoId: second.video.videoId },
      { channelId: first.video.channelId, channelTitle: '채널1', videoId: first.video.videoId },
    ])
    // 섞는 차례: shop.two > shop.one(b5) > shop.three > 채널2 > shop.one(b2, 같은 아이디라 한 줄) > 채널1
    expect(Date.parse(channels[0]!.linkedAt)).toBeLessThan(times[2]!)
    expect(Date.parse(channels[0]!.linkedAt)).toBeGreaterThan(Date.parse(channels[1]!.linkedAt))
    // 유튜브는 최근 채널마다 한 번씩만 본다(전과 같다) — 틱톡에는 묻지 않는다
    expect(w.web.calls('channelLive') - before).toBe(2)
  })

  it('틱톡 계정은 5곳까지, 틱톡을 이은 적이 없으면 빈 목록', async () => {
    const w = await world()
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).get('/api/youtube/live-broadcasts')).body).toEqual({ broadcasts: [], channels: [], tiktok: [] })
    for (let i = 0; i < 6; i++) {
      const b = await createBroadcast(w, seller, { date: `2026-10-${String(10 + i)}` })
      await unlink(w, seller, await tiktokLinked(w, seller, b.id, `shop.n${String(i)}`))
      await pass(w, 60_000, 60_000)
    }
    const tiktok = (await client(w, seller.cookie).get('/api/youtube/live-broadcasts')).body.tiktok as { tiktokId: string }[]
    expect(tiktok.map((row) => row.tiktokId)).toEqual(['shop.n5', 'shop.n4', 'shop.n3', 'shop.n2', 'shop.n1'])
  })
})
