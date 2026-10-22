// O3 적대 시험 라운드 0 (test-domain) — 재현한 지적의 최소 반례.
// - TD-O3-001: 수량 붙은 가격의 L-5 보장값(D-O3-02)이 `9`만으로 된 글로만 확인됐다. 내장 글꼴은 숫자 폭이 같지 않아(`0`·`4`가 `9`보다 넓다)
//   `3개 300,000원`·`40개 40,000원` 같은 값이 50×20~50×50 기본 템플릿 원 표기에서 DOES_NOT_FIT(price)였다.
//   판정(SA-O3-001, D-O3-11): 큰 템플릿 원 표기 보장값은 `9개 99,999원`(수량 한 자리·금액 다섯 자리)·`99개 9,999원`(두 자리·네 자리)이고,
//   보장은 글자 수 기준 — 각 자리를 0~9 어느 숫자로 채워도 들어가야 한다. 그보다 긴 값(`3개 300,000원`·`40개 40,000원` 등)은
//   잘린 글을 찍지 않고 DOES_NOT_FIT(price)으로 알린다(L-5 맞추기 4 — 가격은 숫자 항목이라 줄이지 않는다).
//   이 파일의 기대는 그 새 스펙이다. 보장값 안의 값은 숫자가 섞여도(자리마다 따로) 모두 들어가야 한다 — 단위 시험(같은 숫자로 채운 값)보다 넓다.
import { defaultTemplate, renderProductLabel, type LabelSizeId } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { rng } from './scenarios.ts'

const env = createNodeRenderEnv()
const BIG: readonly LabelSizeId[] = ['50x20', '50x30', '50x40', '50x50']

const data = (price: number, qty: number) => ({ no: 9999, name: '반팔티', price, date: '2026-10-25', buyer: { kind: 'youtube', name: '홍길동' }, variant: '105/검정색', qty })
const render = (size: LabelSizeId, price: number, qty: number) => renderProductLabel(env, { ...defaultTemplate('product', size), priceStyle: 'WON' }, data(price, qty))
const won = (n: number): string => n.toLocaleString('en-US')

/** 보장값 안: 수량 한 자리(2~9)·금액 다섯 자리, 수량 두 자리·금액 네 자리. 첫 자리(1~9)와 나머지 자리(0~9)를 따로 돌리고, 결정적 무작위로 자리마다 다른 숫자를 더한다 */
function insideCases(): [number, number][] {
  const out: [number, number][] = []
  for (let q = 2; q <= 9; q++) for (let f = 1; f <= 9; f++) for (let w = 0; w <= 9; w++) out.push([q, Number(String(f) + String(w).repeat(4))])
  for (const q of [10, 11, 20, 40, 44, 80, 88, 99, 14, 41]) for (let f = 1; f <= 9; f++) for (let w = 0; w <= 9; w++) out.push([q, Number(String(f) + String(w).repeat(3))])
  const r = rng(20261022)
  for (let k = 0; k < 80; k++) {
    out.push([2 + Math.floor(r() * 8), 10_000 + Math.floor(r() * 90_000)])
    out.push([10 + Math.floor(r() * 90), 1_000 + Math.floor(r() * 9_000)])
  }
  return out
}

describe('TD-O3-001 큰 템플릿 원 표기 수량 붙은 가격 (L-5 O3 문장, D-O3-02·D-O3-11, AC-O3-04)', () => {
  // D-O3-11: 보장값(`9개 99,999원`·`99개 9,999원`)보다 긴 값 — 원래 TD-O3-001 사례들. 잘린 글 없이 DOES_NOT_FIT(price)
  const longer: readonly [string, number, number][] = [
    ['3개 300,000원 (10만 원 × 3)', 300_000, 3],
    ['4개 400,000원 (10만 원 × 4)', 400_000, 4],
    ['6개 600,000원 (10만 원 × 6)', 600_000, 6],
    ['8개 800,000원 (10만 원 × 8)', 800_000, 8],
    ['60개 30,000원 (500원 × 60)', 30_000, 60],
    ['40개 40,000원 (1,000원 × 40, 원 표기)', 40_000, 40],
    ['4개 444,444원 (111,111원 × 4)', 444_444, 4],
  ]
  const inside = insideCases()
  for (const size of BIG) {
    it(`${size} 원 표기: 보장값보다 긴 값은 잘린 글 없이 DOES_NOT_FIT(price)`, () => {
      const wrong: string[] = []
      for (const [title, price, qty] of longer) {
        const r = render(size, price, qty)
        if (r.ok) wrong.push(`${title}: 그려짐(${r.layout.items.find((i) => i.id === 'price')?.method ?? '?'})`)
        else if (r.error.code !== 'DOES_NOT_FIT' || r.error.item !== 'price') wrong.push(`${title}: ${r.error.code}/${String(r.error.item)}`)
      }
      expect(wrong).toEqual([])
    })

    it(`${size} 원 표기: 보장값 안의 값은 숫자가 섞여도 모두 20점 이상, 가격 글 그대로`, () => {
      const failed: string[] = []
      for (const [qty, price] of inside) {
        const text = `${String(qty)}개 ${won(price)}원`
        const r = render(size, price, qty)
        const item = r.ok ? r.layout.items.find((i) => i.id === 'price') : undefined
        if (!r.ok) failed.push(`${text}: ${r.error.code}`)
        else if (item === undefined || item.method === 'truncated' || item.fontSize < 20 || item.value !== text) failed.push(`${text}: ${item?.method ?? '없음'} ${String(item?.fontSize)}`)
      }
      expect(failed).toEqual([])
    })
  }

  it('대조: 보장값 글 그대로(`9개 99,999원`·`99개 9,999원`)는 들어간다', () => {
    for (const size of BIG) {
      for (const [price, qty] of [[99_999, 9], [9_999, 99]] as const) {
        const r = render(size, price, qty)
        expect(r.ok, `${size} ${String(qty)}개 ${String(price)}`).toBe(true)
      }
    }
  })
})
