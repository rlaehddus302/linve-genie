// D-SCR-01 화면 일꾼 입구: 토큰·요청 모양·영상 번호로 방송 찾기·등록·같은 번호 다시 보냄·같은 요청 다시 보냄.
// D-SCR-04: 같은 영상에 이어진 방송이 여럿이면(판매자 여럿) 모두에 등록, 같은 요청은 방송마다 한 번.
// 포트를 열지 않는다 — app.request로 /internal/screen/register를 부른다.
import { describe, expect, it, vi } from 'vitest'
import { client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld } from './youtube-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'

async function post(world: Awaited<ReturnType<typeof youtubeWorld>>, body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== null) headers.Authorization = `Bearer ${token}`
  const response = await world.server.app.request('/internal/screen/register', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> }
}

async function products(world: Awaited<ReturnType<typeof youtubeWorld>>, cookie: string, date: string) {
  const day = await client(world, cookie).get(`/api/days/${date}`)
  expect(day.status, day.text).toBe(200)
  return (day.body.products ?? []) as { no: number; name: string; price: number }[]
}

describe('D-SCR-01 화면 일꾼 입구', () => {
  it('토큰이 없으면 입구가 없다(404)', async () => {
    const world = await youtubeWorld()
    expect((await post(world, {})).status).toBe(404)
  })

  it('토큰이 틀리면 401, 짧은 토큰은 서버가 뜨지 않는다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    expect((await post(world, {}, null)).status).toBe(401)
    expect((await post(world, {}, 'wrong-token-wrong-token-wrong-token')).status).toBe(401)
    await expect(youtubeWorld({ overrides: { screenWorkerToken: 'short' } })).rejects.toThrow()
  })

  it('요청 모양이 틀리면 400이고 아무것도 쓰지 않는다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const ok = { videoId: 'abcdefghijk', no: 237, price: 10000, requestId: 'screen-a-237-1' }
    for (const body of ['not json', [], { ...ok, extra: 1 }, { ...ok, videoId: 'x' }, { ...ok, no: 0 }, { ...ok, no: 1.5 }, { ...ok, price: -1 }, { ...ok, price: 1.5 },
      { ...ok, requestId: 'voice-1' }, { ...ok, heard: 'ㄱ'.repeat(301) }, { ...ok, conf: 2 }]) {
      expect((await post(world, body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('영상에 이어진 방송이 없으면 404 NOT_LINKED', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const r = await post(world, { videoId: 'abcdefghijk', no: 237, price: 10000, requestId: 'screen-a-237-1' })
    expect(r.status).toBe(404)
    expect(r.body).toMatchObject({ error: { code: 'NOT_LINKED' } })
  })

  it('이어진 방송에 상품을 등록하고, 같은 번호는 다시 등록하지 않으며(R-2), 같은 요청은 한 번만', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const first = await post(world, { videoId: live.videoId, no: 237, price: 10000, name: '녹색금', heard: '자 237 만원에 드릴게요', conf: 0.9, requestId: 'screen-v-237-1' })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body).toMatchObject({ ok: true, changed: true, broadcastId: b.id, no: 237 })
    let list = await products(world, connected.seller.cookie, b.date)
    expect(list.find((p) => p.no === 237)).toMatchObject({ no: 237, name: '녹색금', price: 10000 })

    const again = await post(world, { videoId: live.videoId, no: 237, price: 30000, requestId: 'screen-v-237-2' })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ ok: true, changed: false })
    list = await products(world, connected.seller.cookie, b.date)
    expect(list.find((p) => p.no === 237)?.price).toBe(10000)

    const same = await post(world, { videoId: live.videoId, no: 238, price: 5000, requestId: 'screen-v-238-1' })
    const repeat = await post(world, { videoId: live.videoId, no: 238, price: 5000, requestId: 'screen-v-238-1' })
    expect(same.body).toMatchObject({ ok: true, changed: true })
    expect(repeat.status).toBe(200)
    expect((await products(world, connected.seller.cookie, b.date)).filter((p) => p.no === 238)).toHaveLength(1)
  })

  it('삭제 전 인식의 지연 전송은 무시하고 삭제 뒤의 새 333번은 가격과 품종을 바꿔 다시 연다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const base = { videoId: live.videoId, no: 333, name: '오색글래머', price: 70000 }
    await post(world, { ...base, requestId: 'screen-first-333' })
    await expectOk(writeEvent(world, connected.seller, { b: b.id, type: 'product.close', no: 333 }))
    const delayed = await post(world, { ...base, requestId: 'screen-late-333', observedAt: 1 })
    expect(delayed.body).toMatchObject({ changed: false })
    const next = { ...base, name: '수박색금', price: 50000, requestId: 'screen-next-333', observedAt: Date.now() }
    expect((await post(world, next)).status).toBe(200)
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 333)).toMatchObject({ status: 'OPEN', name: '수박색금', price: 50000 })
    expect((await post(world, next)).body).toMatchObject({ duplicate: true })
  })

  it('60번에서 늦게 도착한 옛 음성 등록과 재시도는 가격을 선점하지 못하고 화면 일꾼의 가격만 등록된다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const api = client(world, connected.seller.cookie)
    const old = { requestId: 'voice-60-discount', type: 'product.register', b: b.id, no: 60, name: '', price: 50000, voiceLog: { heard: '5만원 할인해서 40만원이나 갈게요 60번', source: 'voice', device: 'old-phone' } }
    expect((await api.get('/api/me')).body.screenProducts).toBe(true)
    expect((await api.post('/api/events', old)).status).toBe(409)
    const body = { videoId: live.videoId, no: 60, price: 400000, name: '투구', requestId: 'screen-incident-60' }
    expect((await post(world, body)).body).toMatchObject({ changed: true })
    expect((await api.post('/api/events', old)).status).toBe(409)
    expect((await post(world, body)).body).toMatchObject({ duplicate: true })
    expect((await api.post('/api/events', { requestId: 'manual-61', type: 'product.register', b: b.id, no: 61, name: '손입력', price: 30000 })).status).toBe(200)
    expect(await products(world, connected.seller.cookie, b.date)).toEqual(expect.arrayContaining([
      expect.objectContaining({ no: 60, price: 400000 }), expect.objectContaining({ no: 61, price: 30000 }),
    ]))
  })

  it('D-SCR-04 같은 영상에 이어진 방송이 여럿이면 모두에 등록하고, 같은 요청을 다시 보내도 방송마다 한 번', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    // 다른 판매자가 같은 라이브를 잇는다(D-LV1-15)
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    const linked2 = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: `link-${b2.id}`, video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked2.status, JSON.stringify(linked2.body)).toBe(200)

    const body = { videoId: live.videoId, no: 17, price: 70000, name: '녹금', requestId: 'screen-v-17' }
    const first = await post(world, body)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body).toMatchObject({ ok: true, changed: true, no: 17 })
    expect(first.body.broadcasts).toHaveLength(2)
    const again = await post(world, body)
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body).toMatchObject({ ok: true, changed: false, duplicate: true })
    for (const [seller, b] of [[one.seller, b1], [two.seller, b2]] as const) {
      const list = (await products(world, seller.cookie, b.date)).filter((p) => p.no === 17)
      expect(list, b.id).toHaveLength(1)
      expect(list[0]).toMatchObject({ no: 17, name: '녹금', price: 70000 })
    }
  })

  it('공동 관리에 참여한 두 계정은 377번의 수정·삭제를 양방향으로 받고 주문은 따로 둔다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    // 다른 판매자가 같은 라이브를 잇는다(D-LV1-15)
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    const linked2 = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: `link-${b2.id}`, video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked2.status, JSON.stringify(linked2.body)).toBe(200)

    const a = client(world, one.seller.cookie)
    const c = client(world, two.seller.cookie)
    const path = (b: string) => `/api/broadcasts/${b}/product-team`
    const team = await expectOk(a.post(path(b1.id), {}))
    expect((await c.post(path(b2.id), { code: '1234567890123456' })).status).toBe(409)
    await expectOk(writeEvent(world, one.seller, { type:'product.register',b:b1.id,no:377,name:'녹근',price:50000 }))
    await expectOk(c.post(path(b2.id), {code:team.body.code}))
    const theirs = () => products(world,two.seller.cookie,b2.date).then((list) => list.find((p) => p.no===377))
    await vi.waitFor(async () => expect(await theirs()).toMatchObject({ name:'녹근' }))
    await expectOk(writeEvent(world, one.seller, {type:'product.update',b:b1.id,no:377,name:'녹금'}))
    await vi.waitFor(async () => expect(await theirs()).toMatchObject({name:'녹금'}))
    await expectOk(writeEvent(world, two.seller, {type:'product.close',b:b2.id,no:377}))
    await vi.waitFor(async () => expect((await products(world,one.seller.cookie,b1.date)).find((p) => p.no===377)).toMatchObject({status:'CLOSED'}))
  })

  it('D-SCR-02 지금 볼 라이브: 토큰 없으면 404·틀리면 401, 이어진 방송의 영상 번호만, 방송을 끝내면 빠진다', async () => {
    const off = await youtubeWorld()
    expect((await off.server.app.request('/internal/screen/live')).status).toBe(404)
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const get = async (token: string | null = TOKEN) => {
      const response = await world.server.app.request('/internal/screen/live', { headers: token === null ? {} : { Authorization: `Bearer ${token}` } })
      const text = await response.text()
      return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown>, text }
    }
    expect((await get(null)).status).toBe(401)
    expect((await get()).body).toEqual({ videos: [] })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const listed = await get()
    expect(listed.body).toEqual({ videos: [{ videoId: live.videoId }] })
    // 판매자·방송 정보는 내보내지 않는다
    expect(listed.text).not.toContain(connected.seller.sellerId)
    expect(listed.text).not.toContain(b.id)
    const ended = await client(world, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: `end-${b.id}` })
    expect(ended.status, ended.text).toBe(200)
    expect((await get()).body).toEqual({ videos: [] })
  })
})
