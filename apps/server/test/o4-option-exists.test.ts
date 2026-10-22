// AC-O4-38 옵션 방송 있음 가벼운 조회 (LBL-01, NFR-06, D-O4-13 — RA-O4-01): GET /api/option-broadcasts/exists → { exists } 하나뿐.
import { describe, expect, it } from 'vitest'
import { addSeller, client, newWorld, rid, type Seller, type TestServer } from './support.ts'

async function broadcast(world: TestServer, seller: Seller, input: Record<string, unknown>): Promise<void> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), ...input })
  expect(response.status, response.text).toBe(200)
}

describe('AC-O4-38 GET /api/option-broadcasts/exists', () => {
  it('A(리허설에만 옵션 방송) 참, B(번호 방송만 — 다른 판매자 C에 옵션 방송) 거짓, 세션 없으면 401, no-store·exists 칸만', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    const c = await addSeller(world)
    const exists = async (seller: Seller | null) => client(world, seller === null ? null : seller.cookie).get('/api/option-broadcasts/exists')

    // 아무 방송도 없을 때는 모두 거짓
    expect((await exists(a)).body).toEqual({ exists: false })

    await broadcast(world, a, { saleMode: 'NUMBERS' })
    await broadcast(world, a, { saleMode: 'OPTIONS', rehearsal: true })
    await broadcast(world, b, { saleMode: 'NUMBERS' })
    await broadcast(world, b, { saleMode: 'NUMBERS', rehearsal: true })
    await broadcast(world, c, { saleMode: 'OPTIONS' })

    const ra = await exists(a)
    expect(ra.status).toBe(200)
    expect(ra.body).toEqual({ exists: true })
    expect(Object.keys(ra.body)).toEqual(['exists'])
    expect(ra.headers.get('Cache-Control')).toBe('no-store')

    const rb = await exists(b)
    expect(rb.status).toBe(200)
    expect(rb.body).toEqual({ exists: false })

    expect((await exists(c)).body).toEqual({ exists: true })

    const anonymous = await exists(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).not.toHaveProperty('exists')
  })
})
