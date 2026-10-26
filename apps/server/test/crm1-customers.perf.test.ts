// CRM1 AC-CRM1-31 성능 (게이트 밖, D-902·D-CRM1-11): 실제 날짜 90개 × 날마다 구매자 200명에서 "모든 손님" 첫 쪽·구매자 목록 꼬리표 조회를 되풀이하면 p95 2초 안.
// `pnpm perf`가 돌린다. 한 번 데운 뒤(날짜 재료 캐시) 재고, 사이사이 마지막 날짜에 입금을 넣어 그 날짜만 다시 세는 경우도 함께 잰다.
// 크기는 PERF_CRM_DAYS·PERF_CRM_BUYERS로 줄일 수 있다(빠른 확인용 — 기준은 기본값 90·200).
// RA-CRM1-03: 데운 캐시만 재지 않게 (1) 서버를 막 켠 뒤의 첫 조회(손님 기록 캐시·범위 상태를 버린 뒤), (2) '입금 안 함' 취소가 든 날짜(다시 적용 경로),
// (3) 방송 중 채팅이 계속 들어오며 구매자 화면이 꼬리표를 받을 때의 판정·저장 p95(NFR-01 300ms)와 메모리 늘어난 양을 함께 잰다.
import { describe, expect, it } from 'vitest'
import { forgetCustomerCaches } from '../src/customers/facts.ts'
import { client, createBroadcast, expectOk, fakeClock, newWorld, addSeller } from './support.ts'
import { kst } from './i2-support.ts'

const DAYS = Number(process.env.PERF_CRM_DAYS ?? '90')
const BUYERS = Number(process.env.PERF_CRM_BUYERS ?? '200')
const ROUNDS = 20
/** 서버를 막 켠 뒤 첫 '모든 손님' 조회 상한 (AC-CRM1-31의 2초와 같은 기준) */
const COLD_LIMIT_MS = 2000

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
  it(`차가운 첫 조회·'입금 안 함' 취소가 든 날짜·채팅이 계속 들어올 때 판정 p95 (RA-CRM1-03)`, async () => {
    const world = await newWorld({ clock: fakeClock(kst(dateOf(DAYS - 1), '09:00:00')) })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const broadcasts: string[] = []
    for (let day = 0; day < DAYS; day++) {
      const date = dateOf(day)
      const b = (await createBroadcast(world, seller, { date })).id
      broadcasts.push(b)
      const outcome = await world.server.writer.write({
        sellerId: seller.sellerId,
        date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        build: () => {
          const drafts = []
          for (let i = 1; i <= BUYERS; i++) {
            const buyer = `UC_${String((day * 37 + i) % (BUYERS * 3)).padStart(4, '0')}`
            drafts.push({ fields: { type: 'product.register', b, no: i, name: `품종${String(i % 41)}`, price: 1000 + (i % 13) * 500 }, actor: { kind: 'server' } as const })
            drafts.push({ fields: { type: 'chat', b, id: `d${String(day)}-${String(i)}`, ch: buyer, nick: `손님${buyer.slice(3)}`, text: String(i) }, actor: { kind: 'collector' } as const, chat: { b, id: `d${String(day)}-${String(i)}` } })
          }
          return drafts
        },
      })
      expect(outcome.kind).toBe('ok')
      // 셋째 날마다 1등 셋을 '입금 안 함'으로 취소 (그 날짜는 '입금 안 함' 찾기가 이벤트를 다시 적용한다)
      if (day % 3 === 0) {
        for (const no of [1, 2, 3]) {
          const buyer = `UC_${String((day * 37 + no) % (BUYERS * 3)).padStart(4, '0')}`
          await expectOk(api.post(`/api/events`, { requestId: `perf-cancel-${String(day)}-${String(no)}`, type: 'host.cancel', b, no, buyer, reason: '입금 안 함' }))
        }
      }
    }
    // (1) 서버를 막 켠 것처럼: 손님 기록 캐시와 범위 상태를 버린 뒤 첫 조회
    forgetCustomerCaches()
    world.server.writer.forgetSeller(seller.sellerId)
    const coldStarted = performance.now()
    const cold = await expectOk(api.get('/api/customers?sort=unpaid'))
    const coldMs = performance.now() - coldStarted
    expect((cold.body.customers as { unpaidDays: number }[])[0]?.unpaidDays).toBeGreaterThanOrEqual(1)
    // (3) 마지막 날짜에 채팅이 계속 들어오고, 구매자 화면이 2초마다(여기선 채팅 10개마다) 꼬리표를 받는다
    const last = dateOf(DAYS - 1)
    const b = broadcasts[DAYS - 1] as string
    const heapBefore = process.memoryUsage().heapUsed
    const judge: number[] = []
    const polls: Promise<unknown>[] = []
    const pollTimes: number[] = []
    for (let i = 0; i < 300; i++) {
      if (i % 10 === 0) {
        const started = performance.now()
        polls.push(
          api.get(`/api/days/${last}/customers`).then((response) => {
            pollTimes.push(performance.now() - started)
            expect(response.status).toBe(200)
          }),
        )
      }
      const started = performance.now()
      const outcome = await world.server.ingestChat(seller.sellerId, { b, id: `live-${String(i)}`, ch: `UC_L${String(i % 50)}`, nick: `방송손님${String(i % 50)}`, text: String((i % BUYERS) + 1) })
      judge.push(performance.now() - started)
      expect(outcome.status).toBe('recorded')
    }
    await Promise.all(polls)
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore
    // 잰 값을 남긴다 (dev-notes에 옮긴다 — 게이트 밖)
    console.info(JSON.stringify({ case: 'RA-CRM1-03', days: DAYS, buyers: BUYERS, coldMs: Math.round(coldMs), judgeP95: Math.round(p95(judge)), pollP95: Math.round(p95(pollTimes)), heapGrowthMb: Math.round(heapGrowth / 1e6) }))
    expect(coldMs).toBeLessThan(COLD_LIMIT_MS)
    expect(p95(pollTimes)).toBeLessThan(2000)
    // NFR-01: 판정·저장 300ms
    expect(p95(judge)).toBeLessThan(300)
  }, 1_800_000)
})
