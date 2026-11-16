// D-SCR-TT-01 화면 일꾼이 틱톡 라이브도 본다: 지금 볼 라이브 목록에 `@틱톡아이디`가 실리고, 그 열쇠로 등록하면 틱톡에 이어진 방송에 올라간다.
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client } from './support.ts'
import { connected, DATE, linkTiktok, realBroadcast, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from './tiktok-live-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'
const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

async function world(): Promise<TtWorld> {
  const w = await ttWorld({ overrides: { screenWorkerToken: TOKEN } })
  worlds.push(w)
  return w
}

async function call(w: TtWorld, method: 'GET' | 'POST', path: string, body?: unknown) {
  const response = await w.server.app.request(path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown>, text }
}

async function productsOf(w: TtWorld, cookie: string) {
  const day = await client(w, cookie).get(`/api/days/${DATE}`)
  expect(day.status, day.text).toBe(200)
  return (day.body.products ?? []) as { no: number; name: string; price: number }[]
}

describe('D-SCR-TT-01 화면 일꾼 × 틱톡 라이브', () => {
  it('틱톡에 이은 방송은 지금 볼 라이브에 @아이디로 실리고, 끊으면 빠진다 (판매자·방송 정보 없이)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w, { tiktokId: 'bit_farm.test' })
    const b = await realBroadcast(w, seller)
    expect((await call(w, 'GET', '/internal/screen/live')).body).toEqual({ videos: [] })
    const linked = await linkTiktok(w, seller, b)
    expect(linked.status, linked.text).toBe(200)
    await connected(w, seller, b)
    const listed = await call(w, 'GET', '/internal/screen/live')
    expect(listed.body).toEqual({ videos: [{ videoId: `@${tiktokId}`, priceUnit: 'THOUSAND' }] })
    expect(listed.text).not.toContain(seller.sellerId)
    expect(listed.text).not.toContain(b)
    const off = await unlinkTiktok(w, seller, b)
    expect(off.status, off.text).toBe(200)
    expect((await call(w, 'GET', '/internal/screen/live')).body).toEqual({ videos: [] })
  })

  it('@아이디로 등록하면 그 틱톡에 이어진 방송 모두에 올라가고, 이어진 방송이 없으면 NOT_LINKED', async () => {
    const w = await world()
    const one = await tiktokSeller(w, { tiktokId: 'bit_farm.test' })
    const two = await tiktokSeller(w, { tiktokId: 'bit_farm.test', seller: await addSeller(w) })
    const b1 = await realBroadcast(w, one.seller)
    const b2 = await realBroadcast(w, two.seller)
    for (const [s, b] of [[one.seller, b1], [two.seller, b2]] as const) {
      const linked = await linkTiktok(w, s, b)
      expect(linked.status, linked.text).toBe(200)
    }
    const res = await call(w, 'POST', '/internal/screen/register', { videoId: '@bit_farm.test', no: 7, price: 30000, name: '청개구리', requestId: 'screen-tt-7' })
    expect(res.status, res.text).toBe(200)
    for (const s of [one.seller, two.seller]) expect((await productsOf(w, s.cookie)).find((p) => p.no === 7)).toMatchObject({ name: '청개구리', price: 30000 })
    const none = await call(w, 'POST', '/internal/screen/register', { videoId: '@other.farm', no: 8, price: 10000, requestId: 'screen-tt-8' })
    expect(none.status).toBe(404)
    expect(none.body).toMatchObject({ error: { code: 'NOT_LINKED' } })
  })

  it('틱톡 아이디 모양이 아니면 받지 않는다 (대문자·@ 없음·너무 김)', async () => {
    const w = await world()
    for (const videoId of ['@Bit_Farm', 'bit_farm.test', `@${'a'.repeat(25)}`, '@a']) {
      const res = await call(w, 'POST', '/internal/screen/register', { videoId, no: 1, price: 1000, requestId: 'screen-tt-bad' })
      expect(res.status, videoId).toBe(400)
    }
  })
})
