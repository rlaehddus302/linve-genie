// O3 옵션 라벨 그리기 (test-domain, AC-O3-04·AC-O3-09·AC-O3-30 (4)). 무작위 옵션 방송 상태의 실제 서버 라벨 데이터를
// 모든 기본 템플릿(상품 8크기 × 가격 표기 2, 포장 4크기)으로 그린다:
// - 상품: 그려지거나 DOES_NOT_FIT(숫자 항목)뿐. 그려지면 가격 글은 자르지 않은 그대로이고 수량이 있으면 그 찜의 수량이다.
//   (L-5 보장값은 round0-findings의 TD-O3-001이 고정 사례로 본다)
// - 포장: 그려지거나 DOES_NOT_FIT(numbers)뿐. 그려지면 번호 목록 줄을 공백으로 이어 붙이면 원래 글(글자 사이 줄 바꿈 없음, 잘림 없음).
import { listClaims, listSettlements } from '@livejjim/core'
import { ALL_LABEL_SIZES, PACKING_LABEL_SIZES, defaultTemplate, renderPackingLabels, renderProductLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { buildClaimIndex, packingLabelData, productLabelBuyer, productLabelData } from '../../../apps/server/src/label-data.ts'
import { D1, optionScenario, play } from './scenarios.ts'

const env = createNodeRenderEnv()
describe('AC-O3-30 옵션 라벨 그리기 — 수량·가격은 잘리지 않고, 번호 목록은 공백·쉼표에서만 줄을 바꾼다', () => {
  it('상품 라벨: 무작위 옵션 판매 씨앗 12개 × 8크기 × 가격 표기 2', () => {
    let drawn = 0
    for (let seed = 1; seed <= 12; seed++) {
      const { state } = play(optionScenario(seed * 104_729))
      const index = buildClaimIndex(state)
      for (const claim of listClaims(state)) {
        if (claim.status !== 'CONFIRMED' || claim.confirmVersion === null) continue
        const data = productLabelData(state, index, { claim: claim.id, version: claim.confirmVersion, buyer: productLabelBuyer(state, claim) })
        expect(data).not.toBeNull()
        if (data === null) continue
        for (const size of ALL_LABEL_SIZES) {
          for (const style of ['THOUSAND', 'WON'] as const) {
            const where = `씨앗 ${String(seed)} ${size} ${style} ${JSON.stringify(data)}`
            const r = renderProductLabel(env, { ...defaultTemplate('product', size), priceStyle: style }, data)
            if (!r.ok) {
              expect(r.error.code, where).toBe('DOES_NOT_FIT')
              expect(['price', 'number'], where).toContain(r.error.item)
              continue
            }
            drawn++
            const price = r.layout.items.find((item) => item.id === 'price')
            if (price === undefined) continue
            expect(price.method, where).not.toBe('truncated')
            expect(price.valueLines.join(''), where).toBe(price.value)
            const m = /^(\d+)개 /.exec(price.value)
            expect(m === null ? 1 : Number(m[1]), where).toBe(claim.qty)
          }
        }
      }
    }
    expect(drawn).toBeGreaterThan(200)
  })

  it('포장 라벨: 무작위 옵션 판매 씨앗 30개 × 포장 4크기', () => {
    let pages = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = play(optionScenario(seed * 7_919))
      for (const settlement of listSettlements(state)) {
        if (settlement.items.length === 0) continue
        const packed = packingLabelData(state, settlement.buyer, D1)
        expect(packed).not.toBeNull()
        if (packed === null) continue
        for (const size of PACKING_LABEL_SIZES) {
          const where = `씨앗 ${String(seed)} ${size} ${JSON.stringify(packed.data.broadcasts)}`
          const r = renderPackingLabels(env, defaultTemplate('packing', size), packed.data)
          if (!r.ok) {
            expect(r.error, where).toMatchObject({ code: 'DOES_NOT_FIT', item: 'numbers' })
            continue
          }
          r.pages.forEach((page, k) => {
            pages++
            const numbers = page.layout.items.find((item) => item.id === 'numbers')
            const want = r.text.pages[k]?.numbers.map(String).join(', ')
            expect(numbers?.value, where).toBe(want)
            expect(numbers?.valueLines.join(' '), where).toBe(want)
            expect(numbers?.method, where).not.toBe('truncated')
            // 옵션 항목(글)이 있는 쪽은 perPage의 절반까지 (D-O3-04)
            const nums = r.text.pages[k]?.numbers ?? []
            if (nums.some((n) => typeof n === 'string')) expect(nums.length, where).toBeLessThanOrEqual(Math.max(1, Math.floor(defaultTemplate('packing', size).perPage / 2)))
          })
        }
      }
    }
    expect(pages).toBeGreaterThan(100)
  })
})
