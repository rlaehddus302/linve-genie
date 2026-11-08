// D-SCR-01 화면 일꾼 입구: 토큰·요청 모양·영상 번호로 방송 찾기·등록·같은 번호 다시 보냄·같은 요청 다시 보냄.
// 포트를 열지 않는다 — app.request로 /internal/screen/register를 부른다.
import { describe, expect, it } from 'vitest'
import { client } from './support.ts'
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
})
