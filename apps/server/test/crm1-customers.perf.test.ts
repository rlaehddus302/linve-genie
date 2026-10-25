// CRM1 AC-CRM1-31 성능 (게이트 밖, D-902·D-CRM1-11): 실제 날짜 90개 × 날마다 구매자 200명에서 "모든 손님" 첫 쪽·구매자 목록 꼬리표 조회를 되풀이하면 p95 2초 안.
// `pnpm perf`가 돌린다. 한 번 데운 뒤(날짜 재료 캐시) 재고, 사이사이 마지막 날짜에 입금을 넣어 그 날짜만 다시 세는 경우도 함께 잰다.
// 크기는 PERF_CRM_DAYS·PERF_CRM_BUYERS로 줄일 수 있다(빠른 확인용 — 기준은 기본값 90·200).
import { describe, expect, it } from 'vitest'
import { client, createBroadcast, expectOk, fakeClock, newWorld, addSeller } from './support.ts'
import { kst } from './i2-support.ts'

const DAYS = Number(process.env.PERF_CRM_DAYS ?? '90')
const BUYERS = Number(process.env.PERF_CRM_BUYERS ?? '200')
const ROUNDS = 20

const dateOf = (i: number) => {
  const ms = Date.UTC(2026, 6, 1) + i * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

const p95 = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] as number

describe('AC-CRM1-31 손님 기록 조회 성능', () => {
  it(`실제 날짜 ${String(DAYS)}개 × 구매자 ${String(BUYERS)}명 — "모든 손님" 첫 쪽·구매자 목록 꼬리표 p95 2초 안`, async () => {
    const world = await newWorld({ clock: fakeClock(kst(dateOf(DAYS - 1), '09:00:00')) })
    const seller = await addSeller(world)
    for (let day = 0; day < DAYS; day++) {
      const date = dateOf(day)
      const b = (await createBroadcast(world, seller, { date })).id
      const outcome = await world.server.writer.write({
        sellerId: seller.sellerId,
        date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        build: () => {
          const drafts = []
          for (let i = 1; i <= BUYERS; i++) {
            // 손님은 날마다 일부 겹친다 (전체 손님 수 = 구매자 수 × 3)
            const buyer = `UC_${String((day * 37 + i) % (BUYERS * 3)).padStart(4, '0')}`
            drafts.push({ fields: { type: 'product.register', b, no: i, name: `품종${String(i % 41)}`, price: 1000 + (i % 13) * 500 }, actor: { kind: 'server' } as const })
            drafts.push({ fields: { type: 'chat', b, id: `d${String(day)}-${String(i)}`, ch: buyer, nick: `손님${buyer.slice(3)}`, text: String(i) }, actor: { kind: 'collector' } as const, chat: { b, id: `d${String(day)}-${String(i)}` } })
          }
          return drafts
        },
      })
      expect(outcome.kind).toBe('ok')
    }
    const api = client(world, seller.cookie)
    const last = dateOf(DAYS - 1)
    await expectOk(api.get('/api/customers'))
    await expectOk(api.get(`/api/days/${last}/customers`))
    const times: number[] = []
    for (let round = 0; round < ROUNDS; round++) {
      if (round % 5 === 4) {
        // 마지막 날짜에 입금 하나 (그 날짜 재료만 다시 만든다)
        const view = await expectOk(api.get(`/api/days/${last}`))
        const settlement = (view.body.settlements as { buyer: string; total: number }[])[round]
        await expectOk(api.post(`/api/events?date=${last}`, { requestId: `perf-pay-${String(round)}`, type: 'settlement.payment', buyer: settlement?.buyer, date: last, amount: settlement?.total }))
      }
      for (const path of ['/api/customers', `/api/days/${last}/customers`]) {
        const started = performance.now()
        const response = await api.get(path)
        times.push(performance.now() - started)
        expect(response.status).toBe(200)
      }
    }
    const rows = (await expectOk(api.get('/api/customers'))).body
    expect(rows.customers).toHaveLength(20)
    expect(p95(times)).toBeLessThan(2000)
  }, 1_800_000)
})
