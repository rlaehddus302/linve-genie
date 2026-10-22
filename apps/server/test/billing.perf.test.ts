// N5 AC-N5-23 "주문 건 쓰기는 판정 처리를 늦추지 않는다" (성능 시험 — D-902, pnpm perf만 돈다).
// 요금 기능을 켜고 주문 건(ORDERS) 방식으로 시작한 방송: 상품 100개·채팅 3,000건 범위에서 입력 200건(앞 20건 준비)을 차례로 쓴다.
// 응답 p99 ≤ 300ms (AC-S04-70과 같은 기준). 처음 1등이 나오는 상품마다 주문 건 쓰기가 같은 트랜잭션에 들어간다.
import { describe, expect, it } from 'vitest'
import { billingWorld, grant, usageKeys } from './billing-support.ts'
import { addSeller, client, createBroadcast, expectOk, rid, writeEvent } from './support.ts'

const WARMUP = 20
const MEASURED = 180
const PRODUCTS = 100
const CHATS = 3000

/** p99: 정렬한 표본에서 99% 위치의 값 (최댓값이 아니다 — latency.perf.test.ts와 같은 셈) */
function p99(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? Number.NaN
}

describe('AC-N5-23 주문 건 쓰기의 판정 지연 (요금 기능 켬)', () => {
  it('ORDERS 방송, 상품 100개·채팅 3,000건, 입력 200건: 응답 p99 ≤ 300ms', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'ORDERS', 50)
    const b = await createBroadcast(world, seller)
    for (let no = 1; no <= PRODUCTS; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: `품종${String(no)}`, price: 1000 * no, stock: 2 }))
    // 앞 절반 상품만 채팅으로 1등이 나온다 — 측정 구간에서 나머지 상품이 처음 1등을 얻으며 주문 건을 쓴다
    for (let i = 0; i < CHATS; i++) {
      const result = await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i % 400)}`, nick: `시청자${String(i % 400)}`, text: String((i % (PRODUCTS / 2)) + 1) })
      expect(result.status).toBe('recorded')
    }
    const api = client(world, seller.cookie)
    const responseMs: number[] = []
    for (let i = 0; i < WARMUP + MEASURED; i++) {
      const no = (i % PRODUCTS) + 1
      const body =
        i % 2 === 0
          ? { requestId: rid('lat'), type: 'sms', b: b.id, no, received: '12:00', phone: `010-1000-${String(1000 + (i % 50))}` }
          : { requestId: rid('lat'), type: 'product.update', b: b.id, no, price: 2000 + i }
      const started = performance.now()
      const response = await api.post('/api/events', body)
      const finished = performance.now()
      expect(response.status, response.text).toBe(200)
      if (i >= WARMUP) responseMs.push(finished - started)
    }
    // 채팅으로 1~50번, 측정 구간의 문자찜(짝수 차례 — 홀수 번호)으로 51~99번 중 홀수 25개가 처음 1등 → 75건
    expect(await usageKeys(world, 'ORDERS')).toHaveLength(PRODUCTS / 2 + 25)
    expect(p99(responseMs), '응답 p99 (ms)').toBeLessThanOrEqual(300)
    world.server.close()
  }, 180_000)
})
