// 상품 수정·재고 변경·재출력 필요·번호 변경 (AC-S03-30~33).
import { applyEvent, getBuyer, getProduct, getSettlement, listCancelRequests, listClaims, listEffects, listPending, type EngineEvent } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { RECEIVED_TIME, T0, chat, host, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

const update = (no: number, fields: Partial<{ name: string; price: number; stock: number; applyTo: 'NEW_ONLY' | 'UNPAID_CLAIMS' }>): EventInput => ({ type: 'product.update', b: 'b1', no, ...fields })
const renumber = (from: number, to: number): EventInput => ({ type: 'product.renumber', b: 'b1', from, to })
const pay = (buyer: string, amount: number): EventInput => ({ type: 'settlement.payment', buyer, date: '2026-10-18', amount }) as EventInput
const printed = (claim: string, version = 1): EventInput => ({ type: 'effect.labelPrinted', effectId: `${claim}:PRINT_PRODUCT_LABEL:-:${String(version)}` })
const claimOf = (state: ReturnType<typeof play>['state'], id: string) => listClaims(state).find((c) => c.id === id)

describe('AC-S03-30 상품 수정 — 한 번에, 가격 변경', () => {
  it('재고를 확정 수보다 작게 하면 품종·가격까지 이벤트 전체가 아무 일도 없다. 같은 값·없는 상품도 아무 일도 없다', () => {
    const { state } = play([register(15, { stock: 2 }), chat('A', '15'), chat('B', '15')])
    for (const event of [update(15, { name: '라울', price: 1, stock: 1 }), update(15, { price: 10000, name: '핑크프릴', stock: 2 }), update(15, {}), update(15, { applyTo: 'UNPAID_CLAIMS' }), update(99, { price: 1 })]) {
      const result = applyEvent(state, { seq: 9, at: T0 + 9000, ...event } as EngineEvent)
      expect(result.state, JSON.stringify(event)).toBe(state)
      expect(result.effects).toEqual([])
    }
  })

  it('상품 상태와 상관없이 고친다 (READY·HOLD·CLOSED), 이력에는 바꾼 시각', () => {
    const { state } = play([
      register(1, { status: 'READY' }),
      register(2),
      { type: 'product.hold', b: 'b1', no: 2 },
      register(3),
      { type: 'product.close', b: 'b1', no: 3 },
      update(1, { price: 1000, name: '라울' }),
      update(2, { stock: 3 }),
      update(3, { price: 3000, at: kst(21) } as never),
    ])
    expect(getProduct(state, 'b1', 1)).toMatchObject({ status: 'READY', price: 1000, name: '라울', priceHistory: [{ from: 10000, to: 1000, at: T0 + 5000 }], nameHistory: [{ from: '핑크프릴', to: '라울', at: T0 + 5000 }] })
    expect(getProduct(state, 'b1', 2)).toMatchObject({ status: 'HOLD', stock: 3 })
    expect(getProduct(state, 'b1', 3)).toMatchObject({ status: 'CLOSED', price: 3000, priceHistory: [{ from: 10000, to: 3000, at: kst(21) }] })
  })

  it('NEW_ONLY(기본)는 확정 찜 스냅샷 그대로, UNPAID_CLAIMS는 받은 금액 0인 묶음의 확정 찜만 새 가격 + 찜별 이력, 대기 찜은 확정 때 새 가격', () => {
    const { state } = play([
      register(15, { stock: 3 }),
      chat('A', '15'),
      chat('B', '15'),
      chat('C', '15'),
      chat('D', '15'),
      pay('B', 1),
      update(15, { price: 12000 }),
      update(15, { price: 13000, applyTo: 'UNPAID_CLAIMS' }),
      host('host.cancel', 15, 'C'),
    ])
    expect(listClaims(state).map((c) => [c.buyer, c.status, c.price, c.priceHistory.map(({ from, to }) => [from, to])])).toEqual([
      ['A', 'CONFIRMED', 13000, [[10000, 13000]]],
      ['B', 'CONFIRMED', 10000, []],
      ['C', 'CANCELLED', 13000, [[10000, 13000]]],
      ['D', 'CONFIRMED', 13000, []],
    ])
    expect(getProduct(state, 'b1', 15)?.priceHistory.map(({ from, to }) => [from, to])).toEqual([
      [10000, 12000],
      [12000, 13000],
    ])
    expect([getBuyer(state, 'A')?.subtotal, getBuyer(state, 'B')?.subtotal, getBuyer(state, 'D')?.subtotal]).toEqual([13000, 10000, 13000])
    expect(getSettlement(state, 'A', '2026-10-18')).toMatchObject({ subtotal: 13000, total: 17000 })
  })

  it('UNPAID_CLAIMS의 "입금 전"은 지금의 구매자 묶음으로 본다 — 합친 상대가 입금했으면 바꾸지 않는다', () => {
    const { state } = play([register(15), chat('A', '15'), chat('H', '안녕'), pay('H', 100), { type: 'buyer.merge', from: 'A', into: 'H', reason: '같은 사람' } as EventInput, update(15, { price: 9000, applyTo: 'UNPAID_CLAIMS' })])
    expect(claimOf(state, 'c1')?.price).toBe(10000)
  })

  it('품종을 바꾸면 이후 확정의 감사 문구에 새 품종, 이미 나온 효과(미실행 포함)의 문구·ID는 그대로', () => {
    const { state, emitted } = play([register(15), chat('A', '15'), chat('B', '15'), update(15, { name: '라울' }), host('host.cancel', 15, 'A')])
    expect(emitted[3]).toEqual([])
    const texts = listEffects(state)
      .filter((e) => e.kind === 'POST_THANKS')
      .map((e) => [e.id, e.text])
    expect(texts).toEqual([
      ['c1:POST_THANKS:LIVE_CHAT:1', '15번 핑크프릴 10,000원 A님 구매 감사합니다'],
      ['c2:POST_THANKS:LIVE_CHAT:2', '15번 라울 10,000원 B님 구매 감사합니다'],
    ])
  })
})

describe('AC-S03-31 재고 변경', () => {
  it('늘리면 늘린 수만큼(대기가 적으면 전부) 대기 1순위부터 확정, 확정버전은 순서대로', () => {
    const { state, emitted } = play([register(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), update(15, { stock: 3 }), update(15, { stock: 6 })])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A', 'B', 'C'], waitlist: [], status: 'OPEN', confirmVersion: 3 })
    expect(emitted[4]?.map((e) => e.id)).toEqual(['c2:PRINT_PRODUCT_LABEL:-:2', 'c2:POST_THANKS:LIVE_CHAT:2', 'c3:PRINT_PRODUCT_LABEL:-:3', 'c3:POST_THANKS:LIVE_CHAT:3'])
    expect(emitted[5]).toEqual([])
  })

  it('늘리면서 가격도 바꾸면 새로 확정되는 찜은 새 가격·새 품종으로', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), update(15, { stock: 2, price: 7000, name: '라울' })])
    expect(claimOf(state, 'c2')).toMatchObject({ status: 'CONFIRMED', price: 7000 })
    expect(listEffects(state).find((e) => e.id === 'c2:POST_THANKS:LIVE_CHAT:2')?.text).toBe('15번 라울 7,000원 B님 구매 감사합니다')
  })

  it('줄이면 확정 수 이상만: 같으면 SOLD, 승계 결정 필요 표시가 사라진다', () => {
    const { state } = play([register(15, { stock: 2 }), chat('A', '15'), chat('B', '15'), chat('C', '15'), host('host.cancel', 15, 'A'), update(15, { stock: 1 })], { 'cancel.succession': 'ASK' })
    expect(getProduct(state, 'b1', 15)).toMatchObject({ stock: 1, status: 'SOLD', awaitingSuccession: false, winners: ['B'], waitlist: ['C'] })
  })

  it('충돌이 있으면 먼저 풀려 순위대로 대기에 들어간 뒤 늘린 자리를 채운다', () => {
    const { state } = play(
      [register(15, { at: kst(20) }), chat('A', '15', { at: kst(20, 0, 10) }), { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput, sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }), update(15, { stock: 2 })],
      RECEIVED_TIME,
    )
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A', 'sms:s1'], conflict: false, confirmVersion: 2 })
  })
})

describe('AC-S03-32 재출력 필요', () => {
  it('출력 보고가 있는 지금 확정 찜에만: 품종 변경, 그 찜의 스냅샷이 바뀐 가격 변경. NEW_ONLY·출력 전이면 없다. 효과는 나오지 않는다', () => {
    const base: EventInput[] = [register(15, { stock: 3 }), chat('A', '15'), chat('B', '15'), chat('C', '15'), printed('c1'), printed('c2', 2), pay('B', 1)]
    const renamed = play([...base, update(15, { name: '라울' })])
    expect(listClaims(renamed.state).map((c) => c.reprintNeeded)).toEqual([true, true, false])
    expect(renamed.emitted.at(-1)).toEqual([])
    const newOnly = play([...base, update(15, { price: 1 })])
    expect(listClaims(newOnly.state).map((c) => c.reprintNeeded)).toEqual([false, false, false])
    const unpaid = play([...base, update(15, { price: 1, applyTo: 'UNPAID_CLAIMS' })])
    // A: 출력됨·입금 전 → 스냅샷 바뀜 → 재출력 필요. B: 입금됨 → 스냅샷 그대로. C: 출력 전
    expect(listClaims(unpaid.state).map((c) => [c.price, c.reprintNeeded])).toEqual([
      [1, true],
      [10000, false],
      [1, false],
    ])
  })

  it('다시 확정되면(새 라벨) 표시는 새 확정 기준이다', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), printed('c1'), update(15, { name: '라울' }), { type: 'host.assign', b: 'b1', no: 15, buyer: 'B', reason: 'r', replace: 'A', replaceTo: 'WAITLIST' }, host('host.cancel', 15, 'B')])
    expect(claimOf(state, 'c1')).toMatchObject({ status: 'CONFIRMED', confirmVersion: 3, reprintNeeded: false })
  })
})

describe('AC-S03-33 번호 변경', () => {
  it('a 상품 없음·b에 상품 기록(닫힌 상품 포함)·a = b → 아무 일도 없다', () => {
    const { state } = play([register(51), register(15), register(16), { type: 'product.close', b: 'b1', no: 16 }, chat('A', '51'), chat('B', '20')])
    for (const event of [renumber(99, 20), renumber(51, 15), renumber(51, 16), renumber(51, 51)]) {
      expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...event } as EngineEvent).state, JSON.stringify(event)).toBe(state)
    }
  })

  it('a의 확정·대기·충돌 찜은 잠금·입금과 상관없이 RENUMBERED(라벨은 a 키로 폐기, 요청도 사라짐), 승계 없음, a의 보류 찜은 그대로', () => {
    const { state, emitted } = play(
      [
        register(51, { at: kst(20) }),
        chat('A', '51', { at: kst(20, 0, 10) }),
        printed('c1'),
        pay('A', 14000),
        chat('B', '51', { at: kst(20, 0, 20) }),
        chat('B', '51 취소', { at: kst(20, 0, 21) }),
        sms('s1', 51, '20:00:05', { at: kst(20, 0, 30) }),
        renumber(51, 15),
        chat('C', '51', { at: kst(20, 1) }),
      ],
      RECEIVED_TIME,
    )
    expect(emitted[7]?.map((e) => [e.kind, e.product, e.confirmVersion])).toEqual([['VOID_LABEL', 'b1/51', 1]])
    expect(listClaims(state).map((c) => [c.buyer, c.product, c.status, c.reason])).toEqual([
      ['A', 'b1/15', 'REJECTED', 'RENUMBERED'],
      ['B', 'b1/15', 'REJECTED', 'RENUMBERED'],
      ['sms:s1', 'b1/15', 'REJECTED', 'RENUMBERED'],
      ['C', 'b1/51', 'PENDING', 'UNOPENED'],
    ])
    expect(listCancelRequests(state)).toEqual([])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: [], waitlist: [], conflict: false, status: 'OPEN' })
    expect(getProduct(state, 'b1', 51)).toBeNull()
    expect(getSettlement(state, 'A', '2026-10-18')).toMatchObject({ total: 0, received: 14000, refundDue: 14000, payment: 'OVERPAID' })
  })

  it('상품은 품종·가격·재고·상태·이력·확정버전을 가지고 b로. 판매 중이면 T = 변경 시각으로 b의 보류 찜 판정, 확정버전은 이어서', () => {
    const { state } = play([
      register(51, { stock: 2, price: 8000, at: kst(20) }),
      update(51, { price: 9000, at: kst(20, 0, 1) } as never),
      chat('A', '51', { at: kst(20, 0, 2) }),
      chat('B', '15', { at: kst(20, 0, 3) }),
      chat('C', '15', { at: kst(20, 0, 4) }),
      { ...renumber(51, 15), at: kst(20, 0, 34) } as EventInput,
    ])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ price: 9000, stock: 2, priceHistory: [{ from: 8000, to: 9000, at: kst(20, 0, 1) }], winners: ['C'], confirmVersion: 2 })
    // B의 at 20:00:03 < 20:00:04(T − 30초) → 만료, C(20:00:04)는 경계 포함
    expect(listClaims(state).map((c) => [c.buyer, c.product, c.status, c.reason])).toEqual([
      ['A', 'b1/15', 'REJECTED', 'RENUMBERED'],
      ['B', 'b1/15', 'REJECTED', 'EXPIRED'],
      ['C', 'b1/15', 'CONFIRMED', null],
    ])
    expect(listEffects(state).filter((e) => e.buyer === 'C').map((e) => e.id)).toEqual(['c3:PRINT_PRODUCT_LABEL:-:2', 'c3:POST_THANKS:LIVE_CHAT:2'])
  })

  it('READY·HOLD·CLOSED 상품이면 b의 보류 찜은 그대로 보류, 공개할 때 판정', () => {
    for (const phase of ['READY', 'HOLD', 'CLOSED'] as const) {
      const setupPhase: EventInput[] = phase === 'READY' ? [] : [{ type: phase === 'HOLD' ? 'product.hold' : 'product.close', b: 'b1', no: 51 }]
      const { state } = play([register(51, { status: phase === 'READY' ? 'READY' : 'OPEN' }), ...setupPhase, chat('A', '15'), renumber(51, 15)])
      expect(getProduct(state, 'b1', 15)?.status, phase).toBe(phase)
      expect(listPending(state).map((p) => [p.product, p.buyers])).toEqual([['b1/15', ['A']]])
      const opened = applyEvent(state, { seq: 9, at: T0 + 9000, type: 'product.open', b: 'b1', no: 15 }).state
      expect(getProduct(opened, 'b1', 15)?.winners).toEqual(['A'])
    }
  })

  it('번호를 바꾼 뒤 a에 새 상품을 등록할 수 있고, 그 상품은 확정버전을 1부터 센다', () => {
    const { state } = play([register(51), chat('A', '51'), renumber(51, 15), register(51, { name: '라울' }), chat('B', '51')])
    expect(getProduct(state, 'b1', 51)).toMatchObject({ name: '라울', winners: ['B'], confirmVersion: 1 })
    expect(getProduct(state, 'b1', 15)).toMatchObject({ name: '핑크프릴', confirmVersion: 1, winners: [] })
    expect(listClaims(state).map((c) => [c.buyer, c.product, c.productId])).toEqual([
      ['A', 'b1/15', 'p1'],
      ['B', 'b1/51', 'p2'],
    ])
  })

  it('번호를 바꾼 뒤 이전 라벨의 늦은 출력 보고 → 폐기 표시는 이전 키(a)', () => {
    const { state } = play([register(51), chat('A', '51'), renumber(51, 15), printed('c1')])
    expect(listEffects(state).filter((e) => e.kind === 'VOID_LABEL').map((e) => [e.product, e.confirmVersion])).toEqual([['b1/51', 1]])
  })
})
