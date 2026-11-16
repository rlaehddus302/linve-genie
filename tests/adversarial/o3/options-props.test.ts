// O3 옵션 표시 성질 (test-domain, AC-O3-30 (2)~(5), AC-O3-07·08·20·21). 무작위 옵션 방송(b2, maxQuantity 99 — 변형 둘 이상·
// 수량·옵션 가격 차이·HTML/수식 모양 선택지·빈 품종) + 같은 날 다육 방송(b1)을 실제 코어로 돌린 상태에서:
// (2) 확인서 줄 금액 합 = 코어 상품 합계, 상품 수 = 수량 합
// (3) 포장 라벨 count = 수량 합, 한 방송 안에 같은 (번호, 다듬은 옵션 글)이 없다, 옵션 없는 수량 1만 정수
// (4) 상품 라벨: 가격 = 찜 금액, 수량 2 이상일 때만 qty·가격 글의 `{수량}개 `, 옵션이 있을 때만 variant
// (5) 대장: 확정 행 수 = 확정 찜 수, 가격 = 단가 × 수량, 모든 행 14열
import fc from 'fast-check'
import { listClaims, listSettlements, type ClaimInfo } from '@livejjim/core'
import { buildLedger, buildReceipt, ledgerRowValues } from '@livejjim/documents'
import { checkPackingData, checkProductData, computePackingText, computeProductText, defaultTemplate, entryNo, entryQty, entryVariant, type PackingEntry } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import { buildClaimIndex, packingLabelData, productLabelBuyer, productLabelData } from '../../../apps/server/src/label-data.ts'
import { packingLabelData as packingRouteData } from '../../../apps/server/src/packing.ts'
import { CREATED_AT, D1, optionScenario, play } from './scenarios.ts'

function checkState(seed: number): void {
  const { state } = play(optionScenario(seed))
  const claims = listClaims(state).filter((c) => c.status === 'CONFIRMED')
  const index = buildClaimIndex(state)
  // (4) 상품 라벨
  for (const claim of claims) {
    const buyer = productLabelBuyer(state, claim)
    const data = productLabelData(state, index, { claim: claim.id, version: claim.confirmVersion as number, buyer })
    expect(data, `씨앗 ${String(seed)} 찜 ${claim.id}`).not.toBeNull()
    if (data === null) continue
    expect(checkProductData(data).ok).toBe(true)
    expect(data.price).toBe(claim.amount)
    expect(data.price).toBe((claim.price as number) * claim.qty)
    expect(Object.hasOwn(data, 'qty')).toBe(claim.qty >= 2)
    if (claim.qty >= 2) expect(data.qty).toBe(claim.qty)
    expect(Object.hasOwn(data, 'variant')).toBe(claim.variant !== null)
    if (claim.variant !== null) expect(data.variant).toBe(claim.variant)
    const text = computeProductText(defaultTemplate('product'), data)
    expect(text.ok).toBe(true)
    if (!text.ok) continue
    const price = text.text.items.price ?? ''
    const m = /^(\d+)개 /.exec(price)
    if (claim.qty >= 2) expect(m?.[1]).toBe(String(claim.qty))
    else expect(m).toBeNull()
    if (claim.variant !== null) expect(text.text.items.name?.endsWith(claim.variant)).toBe(true)
  }
  for (const settlement of listSettlements(state)) {
    if (settlement.items.length === 0 || settlement.date !== D1) continue
    const mine = claims.filter((c) => c.currentBuyer === settlement.buyer)
    const qtySum = mine.reduce((n, c) => n + c.qty, 0)
    // (3) 포장 라벨
    const packed = packingLabelData(state, settlement.buyer, D1)
    expect(packed, `씨앗 ${String(seed)} 묶음 ${settlement.buyer}`).not.toBeNull()
    const route = packingRouteData(state, D1, settlement.buyer)
    expect(route).toEqual(packed?.data)
    if (packed === null) continue
    expect(checkPackingData(packed.data).ok).toBe(true)
    for (const b of packed.data.broadcasts) {
      const same = b.numbers.map((e: PackingEntry) => JSON.stringify([entryNo(e), entryVariant(e)]))
      expect(new Set(same).size).toBe(same.length)
      for (const e of b.numbers) expect(typeof e === 'number').toBe(entryVariant(e) === null && entryQty(e) === 1)
    }
    const text = computePackingText(defaultTemplate('packing'), packed.data)
    expect(text.ok).toBe(true)
    if (text.ok) expect(text.text.common.count).toBe(String(qtySum))
    // (2) 확인서
    const receipt = buildReceipt({ state, date: D1, buyer: settlement.buyer, rehearsal: false, createdAt: CREATED_AT })
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true)
    if (!receipt.ok) continue
    expect(receipt.receipt.lines.reduce((n, line) => n + line.price, 0)).toBe(settlement.subtotal)
    expect(receipt.receipt.itemCount).toBe(qtySum)
    expect(receipt.receipt.rows.find((row) => row.key === 'itemCount')?.text).toBe(`${String(qtySum)}개`)
  }
  // (5) 대장
  const ledger = buildLedger({ scopes: [{ state, rehearsal: false }], from: D1, to: D1 })
  expect(ledger.ok).toBe(true)
  if (!ledger.ok) return
  expect(ledger.options).toBe(true)
  const confirmedRows = ledger.rows.filter((row) => row.status === '1등')
  expect(confirmedRows).toHaveLength(claims.length)
  for (const row of confirmedRows) {
    expect(typeof row.qty).toBe('number')
    expect(typeof row.unitPrice).toBe('number')
    expect(row.price).toBe((row.unitPrice as number) * (row.qty as number))
  }
  for (const row of ledger.rows) expect(ledgerRowValues(row)).toHaveLength(14)
  // 확정 찜마다 한 행 — (번호, 옵션, 수량, 가격)의 묶음이 같다
  const sig = (no: number, variant: string, qty: number, price: number): string => JSON.stringify([no, variant, qty, price])
  expect(confirmedRows.map((row) => sig(row.no, row.variant ?? '', row.qty as number, row.price as number)).sort()).toEqual(
    claims.map((c: ClaimInfo) => sig(c.no, c.variant ?? '', c.qty, c.amount as number)).sort(),
  )
}

describe('AC-O3-30 무작위 옵션 방송의 라벨·포장·확인서·대장 성질', () => {
  it('씨앗 200개', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), (seed) => {
        checkState(seed)
      }),
      { numRuns: 200, seed: 20261025 },
    )
  })

  it('무작위 판매에 수량 2 이상·옵션 찜·여러 묶음이 실제로 생긴다 (시험이 빈 상태만 보지 않는다)', () => {
    let multi = 0
    let variants = 0
    for (let seed = 1; seed <= 50; seed++) {
      const claims = listClaims(play(optionScenario(seed)).state).filter((c) => c.status === 'CONFIRMED')
      multi += claims.filter((c) => c.qty >= 2).length
      variants += claims.filter((c) => c.variant !== null).length
    }
    expect(multi).toBeGreaterThan(30)
    expect(variants).toBeGreaterThan(30)
  })
})
