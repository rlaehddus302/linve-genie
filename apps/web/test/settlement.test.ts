// 정산 화면 값 (AC-S06-30·33·34, R-12, D-058, D-092, G-ENG-172·173): 요약·정렬·미리 보기.
// 미리 보기(코어 settle로 계산)는 실제 엔진에 그 기록을 넣은 결과와 같아야 한다.
import { describe, expect, it } from 'vitest'
import type { Settlement } from '../src/api/types.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { fromFull, settlementKey } from '../src/lib/scope-data.ts'
import { filterSettlements, paymentChange, previewWith, remainingOf, sortSettlements, summarize } from '../src/lib/settlement.ts'
import { chat, register, run, viewOf } from './engine.ts'
import { DATE } from './support.ts'

const BASE = [
  register(15, '핑크프릴', 10000),
  register(28, '청보석', 5000),
  register(31, '금황', 15000, 'b2'),
  chat('m1', 'c1', '가나', '15'),
  chat('m2', 'c1', '가나', '28'),
  chat('m3', 'c1', '가나', '31', 'b2'),
  chat('m4', 'c2', '다라', '안녕'),
  register(40, '루비', 7000),
  chat('m5', 'c2', '다라', '40'),
  register(41, '사파이어', 3000),
  chat('m6', 'c3', '마바', '41'),
  { type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 11000 },
  { type: 'settlement.payment', buyer: 'c3', date: DATE, amount: 3000 },
]

function settlementOf(events: Record<string, unknown>[], buyer: string, settings = {}) {
  const { state, seq } = run(events, settings)
  const data = fromFull(viewOf(state, seq))
  return { data, settlement: data.settlements.get(settlementKey({ buyer, date: DATE })) as Settlement }
}

describe('정산 목록 요약·정렬 (AC-S06-30)', () => {
  const { data } = settlementOf(BASE, 'c1')
  const list = [...data.settlements.values()]
  const names = new BuyerNames(data.buyers, data.claims)

  it('요약: 묶음 수·상태별 수·최종 합·받은 합·남은 합(Σ max(최종 − 받은, 0))·환불 필요 합', () => {
    // 가나 30,000 + 4,000 = 34,000 미입금 · 다라 7,000 + 4,000 = 11,000 입금 완료 · 마바 3,000 + 4,000 = 7,000 중 3,000 부분 입금
    expect(summarize(list)).toEqual({ count: 3, byStatus: { UNPAID: 1, PARTIAL: 1, PAID: 1, OVERPAID: 0 }, total: 52000, received: 14000, remaining: 38000, refundDue: 0 })
  })

  it('기본 정렬: 미입금·부분 입금 먼저, 그다음 표시 이름 순', () => {
    expect(sortSettlements(list, (id) => names.name(id)).map((item) => names.name(item.buyer))).toEqual(['가나', '마바', '다라'])
  })

  it('상태 거르기·이름 찾기', () => {
    expect(filterSettlements(list, 'PAID', '', (id) => names.name(id)).map((item) => item.buyer)).toEqual(['c2'])
    expect(filterSettlements(list, 'ALL', '마', (id) => names.name(id)).map((item) => item.buyer)).toEqual(['c3'])
  })

  it('남은 금액은 0 아래로 내려가지 않는다', () => {
    expect(remainingOf({ total: 10000, received: 14000 })).toBe(0)
    expect(remainingOf({ total: 34000, received: 14000 })).toBe(20000)
  })
})

describe('보내기 전 미리 보기 = 엔진 결과 (AC-S06-33·34)', () => {
  const cases: [string, Record<string, unknown>, Parameters<typeof previewWith>[2]][] = [
    ['직접 수령', { type: 'settlement.shippingOverride', buyer: 'c1', date: DATE, mode: 'PICKUP' }, { kind: 'shipping', mode: 'PICKUP', amount: null }],
    ['합배송', { type: 'settlement.shippingOverride', buyer: 'c1', date: DATE, mode: 'COMBINED' }, { kind: 'shipping', mode: 'COMBINED', amount: null }],
    ['배송비 직접 정함 7,000원', { type: 'settlement.shippingOverride', buyer: 'c1', date: DATE, mode: 'FIXED', amount: 7000 }, { kind: 'shipping', mode: 'FIXED', amount: 7000 }],
    ['할인 1,000원', { type: 'settlement.adjust', buyer: 'c1', date: DATE, amount: -1000, reason: '단골 할인' }, { kind: 'adjust', amount: -1000 }],
    ['추가 2,000원', { type: 'settlement.adjust', buyer: 'c1', date: DATE, amount: 2000, reason: '포장 추가' }, { kind: 'adjust', amount: 2000 }],
    ['할인이 금액보다 큼 → 0원', { type: 'settlement.adjust', buyer: 'c1', date: DATE, amount: -100000, reason: '단골 할인' }, { kind: 'adjust', amount: -100000 }],
  ]
  it.each(cases)('%s', (_name, event, entry) => {
    const before = settlementOf(BASE, 'c1')
    const preview = previewWith(before.data, before.settlement, entry)
    const after = settlementOf([...BASE, event], 'c1').settlement
    expect({ shipping: preview.shipping, total: preview.total, adjustments: preview.adjustments }).toEqual({ shipping: after.shipping, total: after.total, adjustments: after.adjustments })
  })

  // 입금 상태 미리 보기 (AC-S06b-23): 입금·환불을 더해도 엔진의 입금 상태·환불 필요와 같다
  const payments: [string, Record<string, unknown>[], Record<string, unknown>, Parameters<typeof previewWith>[2]][] = [
    ['입금 34,000원 → 입금 완료', [], { type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 34000 }, { kind: 'payment', amount: 34000 }],
    ['입금 40,000원 → 과입금', [], { type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 40000 }, { kind: 'payment', amount: 40000 }],
    [
      '과입금에서 환불 6,000원 → 입금 완료',
      [{ type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 40000 }],
      { type: 'settlement.refund', buyer: 'c1', date: DATE, amount: 6000, reason: '환불함' },
      { kind: 'refund', amount: 6000 },
    ],
  ]
  it.each(payments)('%s', (_name, prior, event, entry) => {
    const before = settlementOf([...BASE, ...prior], 'c1')
    const preview = previewWith(before.data, before.settlement, entry)
    const after = settlementOf([...BASE, ...prior, event], 'c1').settlement
    expect({ payment: preview.payment, refundDue: preview.refundDue, received: preview.received }).toEqual({ payment: after.payment, refundDue: after.refundDue, received: after.received })
  })

  it('예외가 있을 때 "기본 배송비로" — 무료 기준(그날 첫 방송 설정, 상품 합계만)', () => {
    const settings = { 'shipping.freeThreshold': 30000 }
    const withPickup = [...BASE, { type: 'settlement.shippingOverride', buyer: 'c1', date: DATE, mode: 'PICKUP' }, { type: 'settlement.adjust', buyer: 'c1', date: DATE, amount: -5000, reason: '단골 할인' }]
    const before = settlementOf(withPickup, 'c1', settings)
    const preview = previewWith(before.data, before.settlement, { kind: 'shipping', mode: 'DEFAULT', amount: null })
    const after = settlementOf([...withPickup, { type: 'settlement.shippingOverride', buyer: 'c1', date: DATE, mode: 'DEFAULT' }], 'c1', settings).settlement
    // 상품 합계 30,000 ≥ 무료 기준 30,000 → 배송비 0 (조정 −5,000은 무료 기준에 들지 않는다)
    expect(preview.shipping).toBe(0)
    expect([preview.shipping, preview.total]).toEqual([after.shipping, after.total])
  })
})


describe('입금 상태 변화 문장 (AC-S06b-23, D-101)', () => {
  it('바뀌면 "입금 상태: 앞 → 뒤", 그대로면 "입금 상태: 그대로(…)"', () => {
    expect(paymentChange({ payment: 'PAID', refundDue: 0 }, { payment: 'OVERPAID', refundDue: 4000 })).toEqual({ text: '입금 상태: 입금 완료 → 과입금(환불 필요 4,000원)', warning: true })
    expect(paymentChange({ payment: 'UNPAID', refundDue: 0 }, { payment: 'UNPAID', refundDue: 0 })).toEqual({ text: '입금 상태: 그대로(미입금)', warning: false })
    expect(paymentChange({ payment: 'PAID', refundDue: 0 }, { payment: 'PARTIAL', refundDue: 0 })).toEqual({ text: '입금 상태: 입금 완료 → 부분 입금', warning: false })
  })

  it('과입금이 새로 생기거나 환불 필요가 늘면 주의, 줄면 주의가 아니다', () => {
    expect(paymentChange({ payment: 'OVERPAID', refundDue: 4000 }, { payment: 'OVERPAID', refundDue: 5000 }).warning).toBe(true)
    expect(paymentChange({ payment: 'OVERPAID', refundDue: 4000 }, { payment: 'OVERPAID', refundDue: 4000 })).toEqual({ text: '입금 상태: 그대로(과입금(환불 필요 4,000원))', warning: false })
    expect(paymentChange({ payment: 'OVERPAID', refundDue: 5000 }, { payment: 'OVERPAID', refundDue: 1000 }).warning).toBe(false)
    expect(paymentChange({ payment: 'OVERPAID', refundDue: 5000 }, { payment: 'PAID', refundDue: 0 }).warning).toBe(false)
  })
})
