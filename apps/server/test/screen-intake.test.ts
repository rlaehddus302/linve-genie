// D-SCR-01 화면 일꾼 입구: 토큰·요청 모양·영상 번호로 방송 찾기·등록·같은 번호 다시 보냄·같은 요청 다시 보냄.
// D-SCR-04: 같은 영상에 이어진 방송이 여럿이면(판매자 여럿) 모두에 등록, 같은 요청은 방송마다 한 번.
// 포트를 열지 않는다 — app.request로 /internal/screen/register를 부른다.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderProductLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { deployedCommit, registerScreenIntake } from '../src/screen/routes.ts'
import { becomeDevice, chat, DEVICE_A, printApi } from './print-support.ts'
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
    // 유예 0초(D-SCR-11의 60초 유예는 아래 시험) — 다시 열기 자체를 본다
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN, screenReopenGraceMs: 0 } })
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

  it('같은 영상에 연결된 두 계정은 377번의 수정·삭제를 양방향으로 받고 주문은 따로 둔다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const one = await connectSeller(world)
    const { b: b1, live } = await linkedBroadcast(world, one)
    // 다른 판매자가 같은 라이브를 잇는다(D-LV1-15)
    const two = await connectSeller(world, { channelTitle: '두 번째 가게' })
    const b2 = await createBroadcast(world, two.seller)
    await expectOk(writeEvent(world, one.seller, {type:'product.register',b:b1.id,no:376,name:'기존 상품',price:10000}))
    const other = await connectSeller(world, {channelTitle:'다른 라이브'})
    const isolated = await linkedBroadcast(world, other)
    const linked2 = await client(world, two.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: `link-${b2.id}`, video: `https://www.youtube.com/watch?v=${live.videoId}`, confirmInvited: true })
    expect(linked2.status, JSON.stringify(linked2.body)).toBe(200)

    await vi.waitFor(async () => expect(await products(world,two.seller.cookie,b2.date)).toContainEqual(expect.objectContaining({no:376})))
    await becomeDevice(world, two.seller)
    await expectOk(writeEvent(world, one.seller, { type:'product.register',b:b1.id,no:377,name:'녹근',price:50000 }))
    const theirs = () => products(world,two.seller.cookie,b2.date).then((list) => list.find((p) => p.no===377))
    await vi.waitFor(async () => expect(await theirs()).toMatchObject({ name:'녹근' }))
    await expectOk(writeEvent(world, one.seller, {type:'product.update',b:b1.id,no:377,name:'녹금'}))
    await chat(world, two.seller, b2.id, 'UC_B', '손님', '377')
    const job = (await printApi(world, two.seller).claim(DEVICE_A)).job
    expect(job?.data).toMatchObject({no:377,name:'녹금',price:50000})
    const label = renderProductLabel(createNodeRenderEnv(), job?.template, job?.data)
    expect(label.ok && label.layout.items.find(item => item.id === 'name')?.valueLines).toEqual(['녹금'])
    await vi.waitFor(async () => expect(await theirs()).toMatchObject({name:'녹금'}))
    await expectOk(writeEvent(world, two.seller, {type:'product.register',b:b2.id,no:378,name:'테스트',price:10000}))
    await expectOk(writeEvent(world, two.seller, {type:'product.close',b:b2.id,no:378}))
    await vi.waitFor(async () => expect((await products(world,one.seller.cookie,b1.date)).find((p) => p.no===378)).toMatchObject({status:'CLOSED'}))
    expect(await products(world,other.seller.cookie,isolated.b.date)).toHaveLength(0)
  })

  it('D-SCR-09 금액 고치기: 일꾼이 등록한 번호만 새 금액으로, 판매자가 금액을 고쳤거나 손으로 등록한 번호는 그대로', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const reprice = async (body: unknown) => {
      const response = await world.server.app.request('/internal/screen/reprice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    expect((await post(world, { videoId: live.videoId, no: 393, price: 20000, name: '손톱', requestId: 'screen-v-393-1' })).status).toBe(200)
    // 30분 뒤 같은 번호를 만원에 다시 내놓음
    const cheaper = await reprice({ videoId: live.videoId, no: 393, price: 10000, requestId: 'screen-v-price-393-1' })
    expect(cheaper.status, JSON.stringify(cheaper.body)).toBe(200)
    expect(cheaper.body).toMatchObject({ ok: true, changed: true })
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 393)?.price).toBe(10000)
    expect((await reprice({ videoId: live.videoId, no: 393, price: 10000, requestId: 'screen-v-price-393-2' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'SAME' }] })

    // 판매자가 금액을 직접 고친 번호는 덮어쓰지 않는다
    expect((await post(world, { videoId: live.videoId, no: 402, price: 30000, requestId: 'screen-v-402-1' })).status).toBe(200)
    await expectOk(writeEvent(world, connected.seller, { type: 'product.update', b: b.id, no: 402, price: 120000 }))
    expect((await reprice({ videoId: live.videoId, no: 402, price: 50000, requestId: 'screen-v-price-402-1' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'SELLER_PRICED' }] })
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 402)?.price).toBe(120000)

    // 판매자가 손으로 등록한 번호
    await expectOk(writeEvent(world, connected.seller, { type: 'product.register', b: b.id, no: 397, name: '오색글래머', price: 40000 }))
    expect((await reprice({ videoId: live.videoId, no: 397, price: 70000, requestId: 'screen-v-price-397-1' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NOT_SCREEN' }] })
    expect((await reprice({ videoId: live.videoId, no: 397, price: 70.5, requestId: 'screen-v-price-397-2' })).status).toBe(400)
  })

  it('D-SCR-10 번호 바꾸기는 일꾼이 방금 보낸 그 등록의 상품만: 다시 켠 일꾼이 같은 번호를 보내 무시된 뒤에는 옛 429를 371로 옮기지 않는다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const renumber = async (body: unknown) => {
      const response = await world.server.app.request('/internal/screen/renumber', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    expect((await post(world, { videoId: live.videoId, no: 429, price: 10000, name: '프랭크 3번', requestId: 'screen-v-429-1' })).body).toMatchObject({ changed: true })
    // 한 시간 뒤 다시 켠 일꾼이 다른 상품을 429로 잘못 들어 보냄 → 있는 번호라 무시(R-2)
    expect((await post(world, { videoId: live.videoId, no: 429, price: 30000, name: '홍상생술', requestId: 'screen-v-429-2' })).body).toMatchObject({ changed: false })
    const wrong = await renumber({ videoId: live.videoId, from: 429, to: 371, requestId: 'screen-v-fix-429-371', registerRequestId: 'screen-v-429-2' })
    expect(wrong.body).toMatchObject({ changed: false, broadcasts: [{ skip: 'OTHER_REGISTER' }] })
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 429)).toMatchObject({ name: '프랭크 3번', price: 10000 })
    expect((await renumber({ videoId: live.videoId, from: 429, to: 371, requestId: 'screen-v-fix-429-371b' })).status).toBe(400)
    // 방금 보낸 등록이 만든 상품이면 바꾼다
    const right = await renumber({ videoId: live.videoId, from: 429, to: 371, requestId: 'screen-v-fix-429-371c', registerRequestId: 'screen-v-429-1' })
    expect(right.body).toMatchObject({ changed: true })
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 371)).toMatchObject({ name: '프랭크 3번' })
  })

  it('D-SCR-11 판매자가 지운 번호는 지운 직후(60초 안) 도착한 일꾼 등록으로 다시 열지 않는다: 394 리마인드 삭제 7초 뒤 로라클론 7만원', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    await post(world, { videoId: live.videoId, no: 394, name: '리마인드', price: 20000, requestId: 'screen-v-394-1' })
    await expectOk(writeEvent(world, connected.seller, { b: b.id, type: 'product.close', no: 394 }))
    const late = await post(world, { videoId: live.videoId, no: 394, name: '로라클론', price: 70000, requestId: 'screen-v-394-2', observedAt: world.timer.now() + 7000 })
    expect(late.body).toMatchObject({ changed: false })
    expect((await products(world, connected.seller.cookie, b.date)).find((p) => p.no === 394)).toMatchObject({ status: 'CLOSED', name: '리마인드', price: 20000 })
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

describe('D-RETRO-32 서버가 받는 일꾼 요청 목록·판 번호', () => {
  const caps = async (app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, token: string | null = TOKEN, method = 'GET') => {
    const response = await app.request('/internal/screen/capabilities', { method, headers: token === null ? {} : { Authorization: `Bearer ${token}` } })
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown>, text }
  }

  it('토큰 없으면 404·틀리면 401·GET만, 응답은 입구 이름마다 방식·주소·받는 항목과 서버 판(모르면 null)', async () => {
    expect((await caps((await youtubeWorld()).server.app)).status).toBe(404)
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    expect((await caps(world.server.app, null)).status).toBe(401)
    expect((await caps(world.server.app, 'wrong-token-wrong-token-wrong-token')).status).toBe(401)
    expect((await caps(world.server.app, TOKEN, 'POST')).status).toBe(405)
    const got = await caps(world.server.app)
    expect(got.status, got.text).toBe(200)
    // 응답 예 — 일꾼(sw/post.py)이 이 모양에 기댄다. 입구·항목을 더할 때만 여기도 더한다
    expect(got.body).toEqual({
      commit: null,
      endpoints: {
        register: { method: 'POST', path: '/internal/screen/register', fields: ['videoId', 'no', 'price', 'name', 'heard', 'conf', 'requestId', 'observedAt'] },
        renumber: { method: 'POST', path: '/internal/screen/renumber', fields: ['videoId', 'from', 'to', 'requestId', 'drop', 'registerRequestId'] },
        rename: { method: 'POST', path: '/internal/screen/rename', fields: ['videoId', 'no', 'name', 'requestId'] },
        reprice: { method: 'POST', path: '/internal/screen/reprice', fields: ['videoId', 'no', 'price', 'requestId'] },
        'end-stale': { method: 'POST', path: '/internal/screen/end-stale', fields: ['videoId'] },
        live: { method: 'GET', path: '/internal/screen/live', fields: [] },
        capabilities: { method: 'GET', path: '/internal/screen/capabilities', fields: [] },
      },
    })
  })

  it('목록에 적힌 항목은 실제 검사가 받는다: 적힌 항목을 모두 보내도 "받을 수 없는 항목"으로 거절되지 않는다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const endpoints = (await caps(world.server.app)).body['endpoints'] as Record<string, { method: string; path: string; fields: string[] }>
    const send = async (path: string, body: Record<string, unknown>) => {
      const response = await world.server.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
      return JSON.stringify(await response.json())
    }
    const posts = Object.values(endpoints).filter((e) => e.method === 'POST')
    expect(posts.map((e) => e.path).sort()).toEqual(['/internal/screen/end-stale', '/internal/screen/register', '/internal/screen/rename', '/internal/screen/renumber', '/internal/screen/reprice'])
    for (const endpoint of posts) {
      const listed = Object.fromEntries(endpoint.fields.map((field) => [field, null]))
      expect(await send(endpoint.path, listed), endpoint.path).not.toContain('받을 수 없는 항목')
    }
  })

  it('서버 판은 배포가 남긴 파일에서 읽는다: 커밋 모양이 아니거나 파일이 없으면 null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lg-commit-'))
    try {
      expect(await deployedCommit(dir)).toBeNull()
      await writeFile(join(dir, 'server-commit'), '63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5\n')
      expect(await deployedCommit(dir)).toBe('63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5')
      await writeFile(join(dir, 'server-commit'), '<script>alert(1)</script>\n')
      expect(await deployedCommit(dir)).toBeNull()
      expect(await deployedCommit(undefined)).toBeNull()
      expect(await deployedCommit(' ')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    // 입구는 넘겨받은 판을 그대로 돌려준다 (DB·기록 없이도 답한다)
    const app = new Hono()
    registerScreenIntake(app, { token: TOKEN, db: null as never, service: null as never, commit: () => Promise.resolve('63fb1cf8') })
    expect((await caps(app)).body['commit']).toBe('63fb1cf8')
  })
})
