// P2 적대 테스트 (test-domain): 확인서·판매대장이 코어 정산과 갈라지는 길 (AC-P2-21·AC-P2-33). 통과한 공격을 회귀로 남긴다.
// 개발 시험의 무작위 이벤트에 없는 조작을 섞는다: 번호 변경, 직접 배정(교체 포함), 문자찜, 다시 열기, 재고 변경,
// 가격 변경(UNPAID_CLAIMS 포함), 환불, 따로 정한 배송비(FIXED), 합치기 풀기, 일시 중지.
// - 품목이 있는 모든 묶음의 확인서가 만들어지고(줄 합 불일치로 정산이 멈추지 않는다) 최종 금액 = getSettlement
// - 대장: 확정 행 수 = 확정 찜 수, 확정 행 가격 합 = 모든 묶음 상품 합계의 합, 확정 없는 상품마다 한 행
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getSettlement, listClaims, listProducts, listSettlements } from '@livejjim/core'
import { buildLedger, buildReceipt, buildReceipts } from '@livejjim/documents'
import { playLoosely, type EventInput } from '../../../packages/documents/test/helpers.ts'

const buyer = fc.constantFrom('UC_1', 'UC_2', 'UC_3', 'sms:r1', 'sms:r2')
const b = fc.constantFrom('b1', 'b2')
const no = fc.integer({ min: 1, max: 4 })
const date = fc.constantFrom('2026-10-18', '2026-10-19')
const reason = fc.constant('사유')

const event = fc.oneof(
  { arbitrary: fc.record({ type: fc.constant('product.register'), b, no, name: fc.constantFrom('핑크프릴', '라울', ''), price: fc.integer({ min: 0, max: 20 }).map((k) => k * 1000), stock: fc.integer({ min: 1, max: 2 }) }), weight: 6 },
  { arbitrary: fc.record({ type: fc.constant('chat'), b, id: fc.uuid(), ch: fc.constantFrom('UC_1', 'UC_2', 'UC_3'), nick: fc.constantFrom('홍길동', '꽃님', '🌵다육맘'), text: no.map(String) }), weight: 8 },
  { arbitrary: fc.record({ type: fc.constant('sms'), b, ref: fc.constantFrom('r1', 'r2', 'r3'), no, received: fc.constantFrom('20:00', '20:00:30'), memo: fc.constant('김영희') }), weight: 3 },
  { arbitrary: fc.record({ type: fc.constant('host.cancel'), b, no, buyer, reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('host.assign'), b, no, buyer, reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('host.assign'), b, no, buyer, reason, replace: buyer, replaceTo: fc.constantFrom('WAITLIST', 'CANCEL') }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('host.reopen'), b, no, reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('product.renumber'), b, from: no, to: fc.integer({ min: 1, max: 6 }) }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('product.update'), b, no, price: fc.integer({ min: 1, max: 20 }).map((k) => k * 1000), applyTo: fc.constantFrom('NEW_ONLY', 'UNPAID_CLAIMS') }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('product.update'), b, no, stock: fc.integer({ min: 1, max: 3 }) }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constantFrom('product.close', 'product.hold', 'product.open'), b, no }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('settlement.payment'), buyer, date, amount: fc.integer({ min: 1, max: 40 }).map((k) => k * 1000) }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('settlement.refund'), buyer, date, amount: fc.integer({ min: 1, max: 40 }).map((k) => k * 1000), reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('settlement.adjust'), buyer, date, amount: fc.integer({ min: -20, max: 20 }).map((k) => k * 1000), reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('settlement.shippingOverride'), buyer, date, mode: fc.constantFrom('PICKUP', 'COMBINED', 'DEFAULT', 'FIXED'), amount: fc.constant(2500) }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('buyer.merge'), from: buyer, into: buyer, reason }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('buyer.unmerge'), from: buyer, reason }), weight: 1 },
)

describe('P2 문서 ↔ 코어 정산 (번호 변경·직접 배정·문자찜·환불·FIXED·합치기 풀기를 섞은 무작위 열)', () => {
  it('확인서는 품목이 있는 모든 묶음에서 만들어지고 금액 칸이 getSettlement와 같다, 대장 확정 행·가격 합·안 팔린 상품 행이 코어와 맞다', () => {
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 50 }), (events) => {
        const state = playLoosely(events as unknown as EventInput[])
        for (const day of ['2026-10-18', '2026-10-19']) {
          const settlements = listSettlements(state).filter((settlement) => settlement.date === day && settlement.items.length > 0)
          for (const settlement of settlements) {
            const result = buildReceipt({ state, buyer: settlement.buyer, date: day, rehearsal: false, createdAt: 0 })
            expect(result.ok, result.ok ? '' : result.error.code).toBe(true)
            if (!result.ok) return
            const core = getSettlement(state, settlement.buyer, day)
            expect([result.receipt.subtotal, result.receipt.shipping, result.receipt.adjustments, result.receipt.total, result.receipt.received, result.receipt.refundDue]).toEqual([
              core.subtotal,
              core.shipping,
              core.adjustments,
              core.total,
              core.received,
              core.refundDue,
            ])
          }
          const batch = buildReceipts({ state, date: day, rehearsal: false, createdAt: 0 })
          expect(batch.ok ? batch.receipts.length : 0).toBe(settlements.length)
        }
        const ledger = buildLedger({ scopes: [{ state, rehearsal: false }], from: '2026-10-18', to: '2026-10-19' })
        expect(ledger.ok).toBe(true)
        if (!ledger.ok) return
        const confirmed = listClaims(state).filter((claim) => claim.status === 'CONFIRMED')
        const sold = ledger.rows.filter((row) => row.status === '1등')
        expect(sold).toHaveLength(confirmed.length)
        expect(sold.reduce((sum, row) => sum + (row.price as number), 0)).toBe(listSettlements(state).reduce((sum, settlement) => sum + settlement.subtotal, 0))
        const unsoldProducts = listProducts(state).filter((product) => !confirmed.some((claim) => claim.product === product.key))
        expect(ledger.rows.filter((row) => row.status !== '1등')).toHaveLength(unsoldProducts.length)
      }),
      { numRuns: 1500, seed: 20261020 },
    )
  })
})
