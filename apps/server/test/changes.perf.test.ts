// AC-S05-61 증분 조회 지연 — 성능 시험(D-902): pnpm verify에서 빼고 pnpm perf로 부하 없는 때에 잰다.
// 상품 500·채팅 1만 건 범위에서 쓰기 1건 → 증분 조회 응답 p99 300ms 이내 (앞 10번은 준비 구간).
// 증분의 내용·크기(정확성)는 changes.test.ts가 verify에서 지킨다.
import { describe, expect, it } from 'vitest'
import { fillScope } from '../src/e2e.ts'
import { addSeller, client, expectOk, newWorld, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'

async function seqNow(world: TestServer, seller: Seller): Promise<number> {
  return (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))).body.seq as number
}

describe('AC-S05-61 지연 (상품 500·채팅 1만 건)', () => {
  it('쓰기 1건 → 증분 조회 응답 p99 300ms 이내 (앞 10번은 준비 구간)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const filled = await fillScope(world.server, seller.sellerId, { date: DAY, products: 500, chats: 10_000, clock: world.clock })
    expect(filled.seq).toBe(10_501)
    const api = client(world, seller.cookie)
    // 지연: 쓰기 1건 → 증분 조회, 60번 (앞 10번 준비)
    const timings: number[] = []
    let known = await seqNow(world, seller)
    for (let i = 0; i < 60; i++) {
      const text = i % 3 === 0 ? String(1 + (i % 500)) : '와 대박'
      await world.server.ingestChat(seller.sellerId, { b: filled.broadcast, id: `lat-${String(i)}`, ch: `UClat${String(i % 7)}`, nick: '손님', text })
      const started = performance.now()
      const response = await api.get(`/api/days/${DAY}/changes?since=${String(known)}`)
      timings.push(performance.now() - started)
      expect(response.status).toBe(200)
      known = response.body.seq as number
    }
    const measured = timings.slice(10).sort((a, b) => a - b)
    const p99 = measured[Math.ceil(measured.length * 0.99) - 1] as number
    expect(p99).toBeLessThan(300)
    expect(p99).toBeLessThanOrEqual(measured.at(-1) as number)
  }, 180_000)
})
