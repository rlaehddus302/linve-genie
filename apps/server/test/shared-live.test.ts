// D-SHARE-LIVE-01 같이 보는 라이브 (사용자 지시 2026-11-17 "한 라이브에 대해서는 모든 정보를 공유하기로 했잖아. 라이브와 앱 계정은 1:N 관계"):
// 다른 판매자 계정이 이미 이어 둔 라이브를 이으면 새로 잇지 않고 먼저 이은 방송에 들어간다 — 상품·찜이 한 기록이다.
// 나가기·새 라이브 만들기면 원래 가게로 돌아온다.
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, rid, writeEvent, type Seller } from './support.ts'
import { consentOn, realBroadcast, ttWorld, type TtWorld } from './tiktok-live-support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld } from './youtube-support.ts'

type World = Parameters<typeof client>[0]

async function productsOf(w: World, seller: Seller, date: string) {
  const day = await client(w, seller.cookie).get(`/api/days/${date}`)
  expect(day.status, day.text).toBe(200)
  return (day.body.products ?? []) as { no: number; name: string; price: number }[]
}

describe('D-SHARE-LIVE-01 같이 보는 라이브 — 유튜브', () => {
  it('두 번째 계정이 같은 라이브를 이으면 먼저 이은 방송에 들어가 같은 상품을 보고, 거기서 등록한 상품도 한 기록에 들어간다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    await expectOk(writeEvent(world, one.seller, { type: 'product.register', b: b1.id, no: 12, name: '라울', price: 5000 }))

    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    const linked = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body).toEqual({ joined: { broadcastId: b1.id, shopName: expect.any(String) } })

    // 두 번째 계정의 내 정보: 같이 보는 라이브 + 방송 주인 가게 이름
    const me = await client(world, two.seller.cookie).get('/api/me')
    expect(me.body.live).toEqual({ broadcastId: b1.id, shopName: (me.body.seller as { name: string }).name })
    // 같은 상품이 보이고, 두 번째 계정이 등록한 상품도 같은 방송에 들어간다
    expect(await productsOf(world, two.seller, b1.date)).toContainEqual(expect.objectContaining({ no: 12, name: '라울' }))
    await expectOk(writeEvent(world, two.seller, { type: 'product.register', b: b1.id, no: 13, name: '창수박금', price: 60000 }))
    await expectOk(writeEvent(world, two.seller, { type: 'product.update', b: b1.id, no: 12, price: 7000 }))
    const mine = await productsOf(world, one.seller, b1.date)
    expect(mine).toContainEqual(expect.objectContaining({ no: 13, name: '창수박금', price: 60000 }))
    expect(mine).toContainEqual(expect.objectContaining({ no: 12, price: 7000 }))
    // 두 번째 계정의 방송은 잇지 않았다 (따로 동기화하지 않는다)
    const list = await client(world, two.seller.cookie).get('/api/broadcasts')
    expect((list.body.broadcasts as { id: string }[]).map((b) => b.id)).toContain(b1.id)
    expect((list.body.broadcasts as { id: string }[]).map((b) => b.id)).not.toContain(b2.id)

    // 나가면 원래 가게로 돌아온다
    await expectOk(client(world, two.seller.cookie).post('/api/live-join/leave', {}))
    const back = await client(world, two.seller.cookie).get('/api/me')
    expect(back.body.live).toBeUndefined()
    expect(await productsOf(world, two.seller, b1.date)).toEqual([])
    // 먼저 이은 계정은 그대로
    expect((await client(world, one.seller.cookie).get('/api/me')).body.live).toBeUndefined()
  })

  it('들어가 있는 계정이 새 라이브를 만들면 나가고 원래 가게에 만든다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { live } = await linkedBroadcast(world, one)
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    const linked = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked.body.joined).toBeDefined()

    const made = await client(world, two.seller.cookie).post('/api/broadcasts', { requestId: rid('b'), title: '내 라이브', draft: true })
    expect(made.status, made.text).toBe(200)
    expect(made.body.left).toBe(true)
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
    const id = (made.body.broadcast as { id: string }).id
    // 새 라이브는 두 번째 계정 가게의 것 — 먼저 이은 계정에서는 보이지 않는다
    expect((await client(world, two.seller.cookie).get(`/api/broadcasts/${id}/youtube`)).status).toBe(200)
    expect((await client(world, one.seller.cookie).get(`/api/broadcasts/${id}/youtube`)).status).toBe(404)
  })

  it('라이브가 끝나면 12시간 동안은 같이 보고, 그 뒤에는 저절로 원래 가게로 돌아온다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    await expectOk(client(world, one.seller.cookie).post(`/api/broadcasts/${b1.id}/end`, { requestId: rid('end') }))
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toEqual({ broadcastId: b1.id, shopName: expect.any(String) })
    await world.timer.set(world.timer.now() + 12 * 60 * 60 * 1000 + 1000)
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
  })

  it('끝난 라이브나 먼저 이은 계정 자신에게는 들어가지 않는다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    await expectOk(client(world, one.seller.cookie).post(`/api/broadcasts/${b1.id}/end`, { requestId: rid('end') }))
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    const linked = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body.joined).toBeUndefined()
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
  })
})

describe('D-SHARE-LIVE-02 같이 본 라이브 기록 (사용자 2026-11-19 "세 계정으로 동시에 보고 있었을텐데 그거랑 상관없이 기록 남아야 하는거 아니야?")', () => {
  it('같이 본 라이브는 나간 뒤에도 원래 가게의 지난 라이브에 남고, 눌러 다시 열면 그 기록을 본다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    await expectOk(writeEvent(world, one.seller, { type: 'product.register', b: b1.id, no: 12, name: '라울', price: 5000 }))
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })

    // 같이 보는 동안은 목록이 이미 방송 주인 것 — 따로 붙이지 않는다
    expect((await client(world, two.seller.cookie).get('/api/live-join/past')).body).toEqual({ lives: [] })
    await expectOk(client(world, one.seller.cookie).post(`/api/broadcasts/${b1.id}/end`, { requestId: rid('end') }))
    // 끝나고 12시간이 지나 원래 가게로 돌아와도 같이 본 라이브가 남는다
    await world.timer.set(world.timer.now() + 12 * 60 * 60 * 1000 + 1000)
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
    const past = await client(world, two.seller.cookie).get('/api/live-join/past')
    expect(past.status, past.text).toBe(200)
    const ownerName = ((await client(world, one.seller.cookie).get('/api/me')).body.seller as { name: string }).name
    expect(past.body.lives).toEqual([expect.objectContaining({ id: b1.id, ended: true, shopName: ownerName })])
    // 원래 가게 목록에는 섞지 않는다 (날짜로 방송을 찾는 화면이 많다)
    expect((await client(world, two.seller.cookie).get('/api/broadcasts')).body.broadcasts as { id: string }[]).not.toContainEqual(expect.objectContaining({ id: b1.id }))

    // 다시 열면 같이 보는 라이브로 들어가 같은 상품을 본다
    const reopened = await client(world, two.seller.cookie).post('/api/live-join/reopen', { broadcastId: b1.id })
    expect(reopened.status, reopened.text).toBe(200)
    expect(reopened.body).toEqual({ live: { broadcastId: b1.id, shopName: ownerName } })
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toEqual({ broadcastId: b1.id, shopName: ownerName })
    expect(await productsOf(world, two.seller, b1.date)).toContainEqual(expect.objectContaining({ no: 12, name: '라울' }))
    // 연 때부터 12시간 뒤에는 원래 가게로
    await world.timer.set(world.timer.now() + 12 * 60 * 60 * 1000 + 1000)
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
  })

  // D-SHARE-LIVE-04 (사용자 2026-11-20 "애초에 왜 다른 샵으로 바꿔야 하냐고"): 같이 본 라이브는 가게를 바꾸지 않고 X-Live-View 요청만 방송 주인 것으로
  it('X-Live-View: 같이 본 라이브는 그 요청만 방송 주인 가게로, 내 가게·내 정보는 그대로, 같이 본 적 없으면 내 가게', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    await expectOk(writeEvent(world, one.seller, { type: 'product.register', b: b1.id, no: 12, name: '라울', price: 5000 }))
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    await expectOk(client(world, two.seller.cookie).post('/api/live-join/leave', {}))
    const three = await connectSeller(world, { channelTitle: '세 번째 가게' })

    const view = async (cookie: string, path: string) => client(world, cookie).raw(path, { headers: { 'X-Live-View': b1.id } })
    const days = await view(two.seller.cookie, `/api/days/${b1.date}`)
    expect(days.status).toBe(200)
    expect(((await days.json()) as { products: { no: number }[] }).products).toContainEqual(expect.objectContaining({ no: 12 }))
    const list = (await (await view(two.seller.cookie, '/api/broadcasts')).json()) as { broadcasts: { id: string }[] }
    expect(list.broadcasts.map((b) => b.id)).toContain(b1.id)
    // 머리 없이는 내 가게 그대로, 같이 보기에 들어가지도 않는다
    expect(((await client(world, two.seller.cookie).get('/api/broadcasts')).body.broadcasts as { id: string }[]).map((b) => b.id)).not.toContain(b1.id)
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
    // 같이 본 적 없는 계정은 머리를 보내도 내 가게
    expect(((await (await view(three.seller.cookie, `/api/days/${b1.date}`)).json()) as { products?: unknown[] }).products ?? []).toEqual([])
  })

  it('같이 본 적 없는 라이브는 다시 열 수 없다', async () => {
    const world = await youtubeWorld()
    const one = await connectSeller(world)
    const { b: b1 } = await linkedBroadcast(world, one)
    await expectOk(client(world, one.seller.cookie).post(`/api/broadcasts/${b1.id}/end`, { requestId: rid('end') }))
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    expect((await client(world, two.seller.cookie).post('/api/live-join/reopen', { broadcastId: b1.id })).status).toBe(404)
    expect((await client(world, two.seller.cookie).post('/api/live-join/reopen', { broadcastId: 'x', more: 1 })).status).toBe(400)
    expect((await client(world, two.seller.cookie).get('/api/live-join/past')).body).toEqual({ lives: [] })
    expect((await client(world, two.seller.cookie).get('/api/me')).body.live).toBeUndefined()
  })
})

describe('D-SHARE-LIVE-01 같이 보는 라이브 — 틱톡', () => {
  const worlds: TtWorld[] = []
  afterEach(async () => {
    for (const w of worlds.splice(0)) await w.close()
  })

  it('다른 계정이 이어 둔 틱톡 라이브 링크를 넣으면 그 방송에 들어간다', async () => {
    const w = await ttWorld()
    worlds.push(w)
    w.webcast.account('bit_farm.test', 'LIVE')
    const one = await addSeller(w)
    await consentOn(w, one)
    const b1 = await realBroadcast(w, one)
    const first = await client(w, one.cookie).post(`/api/broadcasts/${b1}/tiktok/link-url`, { requestId: rid('lu'), url: 'https://www.tiktok.com/@bit_farm.test/live' })
    expect(first.status, first.text).toBe(200)
    expect(first.body.joined).toBeUndefined()

    const two = await addSeller(w)
    await consentOn(w, two)
    const b2 = await realBroadcast(w, two)
    const second = await client(w, two.cookie).post(`/api/broadcasts/${b2}/tiktok/link-url`, { requestId: rid('lu'), url: 'https://www.tiktok.com/@bit_farm.test/live' })
    expect(second.status, second.text).toBe(200)
    expect(second.body).toEqual({ joined: { broadcastId: b1, shopName: expect.any(String) } })
    expect((await client(w, two.cookie).get('/api/me')).body.live).toEqual({ broadcastId: b1, shopName: expect.any(String) })
  })
})
