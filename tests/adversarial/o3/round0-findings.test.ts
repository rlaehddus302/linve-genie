// O3 적대 시험 라운드 0 (test-domain) — 재현한 지적의 최소 반례.
// - TD-O3-001: 수량 붙은 가격의 L-5 보장값(D-O3-02)이 `9`만으로 된 글로만 확인됐다. 내장 글꼴은 숫자 폭이 같지 않아(`0`·`4`가 `9`보다 넓다)
//   보장값 안의 값(수량 ≤ 9 · 금액 ≤ 999,999원, 수량 ≤ 99 · 금액 ≤ 99,999원)이 원 표기에서 50×20·50×30·50×40·50×50 기본 템플릿에
//   들어가지 않는다 — `3개 300,000원`(10만 원 × 3), `4개 400,000원`, `60개 30,000원`(500원 × 60)이 DOES_NOT_FIT(price).
//   방송 중 자동 출력에서 그 라벨이 막힌다. 보장값과 글자 수가 같고 더 작은 값이다("그보다 긴 값"이 아니다).
import { defaultTemplate, renderProductLabel, type LabelSizeId } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'

const env = createNodeRenderEnv()
const BIG: readonly LabelSizeId[] = ['50x20', '50x30', '50x40', '50x50']

const data = (price: number, qty: number) => ({ no: 9999, name: '반팔티', price, date: '2026-10-25', buyer: { kind: 'youtube', name: '홍길동' }, variant: '105/검정색', qty })

describe('TD-O3-001 수량 붙은 가격의 보장값은 숫자 모양과 상관없이 지켜진다 (L-5 O3 문장, D-O3-02, AC-O3-04)', () => {
  // 모두 보장값 `9개 999,999원`(수량 ≤ 9, 금액 ≤ 999,999) 또는 `99개 99,999원`(수량 ≤ 99, 금액 ≤ 99,999) 안이다
  const cases: readonly [string, number, number][] = [
    ['3개 300,000원 (10만 원 × 3)', 300_000, 3],
    ['4개 400,000원 (10만 원 × 4)', 400_000, 4],
    ['6개 600,000원 (10만 원 × 6)', 600_000, 6],
    ['8개 800,000원 (10만 원 × 8)', 800_000, 8],
    ['60개 30,000원 (500원 × 60)', 30_000, 60],
    ['40개 40,000원 (1,000원 × 40, 원 표기)', 40_000, 40],
    ['4개 444,444원 (111,111원 × 4)', 444_444, 4],
  ]
  for (const size of BIG) {
    it(`${size} 원 표기: 보장값 안의 값이 모두 DOES_NOT_FIT 없이 20점 이상, 가격 글 그대로`, () => {
      const failed: string[] = []
      for (const [title, price, qty] of cases) {
        const r = renderProductLabel(env, { ...defaultTemplate('product', size), priceStyle: 'WON' }, data(price, qty))
        const item = r.ok ? r.layout.items.find((i) => i.id === 'price') : undefined
        if (!r.ok || item === undefined || item.method === 'truncated' || item.fontSize < 20) failed.push(`${title}: ${r.ok ? 'truncated' : r.error.code}`)
      }
      expect(failed).toEqual([])
    })
  }

  it('대조: 보장값 글 그대로(`9개 999,999원`·`99개 99,999원`)는 지금도 들어간다', () => {
    for (const size of BIG) {
      for (const [price, qty] of [[999_999, 9], [99_999, 99]] as const) {
        const r = renderProductLabel(env, { ...defaultTemplate('product', size), priceStyle: 'WON' }, data(price, qty))
        expect(r.ok, `${size} ${String(qty)}개 ${String(price)}`).toBe(true)
      }
    }
  })
})
