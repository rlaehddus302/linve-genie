// D-UX3-25 (사용자 지시 2026-11-04 "방송 확정 전 링크 넣고 확인만 누르면 내 방송 이력에 뜸 — 방송 중 화면 들어가기 전까지는 뜨면 안 됨")
// 앱 새 방송 단계는 draft: true로 만든다 → 방송 화면에 들어와 open을 부르기 전까지 GET /api/broadcasts에 없다. draft를 주지 않으면 예전처럼 바로 보인다.
import { describe, expect, it } from 'vitest'
import { addSeller, client, expectOk, newWorld, rid } from './support.ts'

const ids = (body: unknown) => (body as { broadcasts: { id: string }[] }).broadcasts.map((b) => b.id)
const made = (body: unknown) => (body as { broadcast: { id: string } }).broadcast.id

describe('D-UX3-25 만드는 중인 방송은 방송 화면에 들어올 때까지 목록에 없다', () => {
  it('draft로 만들면 숨고, open 뒤에 보인다 (open은 몇 번 불러도 같다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const id = made((await expectOk(api.post('/api/broadcasts', { requestId: rid(), title: '다육이 방송', draft: true }))).body)
    expect(ids((await api.get('/api/broadcasts')).body)).not.toContain(id)
    expect((await api.post(`/api/broadcasts/${id}/open`, {})).status).toBe(200)
    expect((await api.post(`/api/broadcasts/${id}/open`, {})).status).toBe(200)
    expect(ids((await api.get('/api/broadcasts')).body)).toEqual([id])
  })

  it('draft 없이 만든 방송은 바로 보인다 (웹·리허설 등 예전 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const id = made((await expectOk(api.post('/api/broadcasts', { requestId: rid() }))).body)
    expect(ids((await api.get('/api/broadcasts')).body)).toEqual([id])
  })

  it('남의 방송·없는 방송 open은 404, draft가 예/아니오가 아니면 400', async () => {
    const world = await newWorld()
    const mine = await addSeller(world)
    const other = await addSeller(world)
    const id = made((await expectOk(client(world, other.cookie).post('/api/broadcasts', { requestId: rid(), draft: true }))).body)
    const api = client(world, mine.cookie)
    expect((await api.post(`/api/broadcasts/${id}/open`, {})).status).toBe(404)
    expect((await api.post('/api/broadcasts/nope/open', {})).status).toBe(404)
    expect(ids((await client(world, other.cookie).get('/api/broadcasts')).body)).not.toContain(id)
    expect((await api.post('/api/broadcasts', { requestId: rid(), draft: 'yes' })).status).toBe(400)
  })
})
