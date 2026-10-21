// 템플릿 JSON과 검사 (AC-P1-20, L-5).
import { describe, expect, it } from 'vitest'
import {
  LABEL_SIZES,
  PACKING_ITEMS,
  PRODUCT_ITEMS,
  defaultTemplate,
  parseTemplateJson,
  renderProductLabel,
  templateToJson,
  validateTemplate,
  type LabelTemplate,
} from '../src/index.ts'
import { SAMPLE_PRODUCT, nodeEnv } from './helpers.ts'

type Mutable = Record<string, unknown> & { items: Record<string, Record<string, unknown>> }
const clone = (t: LabelTemplate): Mutable => structuredClone(t) as unknown as Mutable

function problems(value: unknown): string[] {
  const r = validateTemplate(value)
  expect(r.ok).toBe(false)
  if (r.ok) return []
  expect(r.error.code).toBe('INVALID_TEMPLATE')
  expect(r.error.message).toBe('라벨 설정에 고칠 곳이 있어요.')
  for (const p of r.error.problems ?? []) {
    // 문제마다 쉬운 한국어 한 문장, 영어 개발 용어 없음
    expect(p.message).toMatch(/[가-힣]/)
    expect(p.message).toMatch(/[.요]$/)
    expect(p.message).not.toMatch(/[A-Za-z]/)
  }
  return (r.error.problems ?? []).map((p) => p.message)
}

describe('템플릿 JSON과 검사 (AC-P1-20)', () => {
  it('크기마다 기본 템플릿이 상품·포장 한 벌씩 있고 모두 검사를 통과한다(경고도 없음)', () => {
    for (const size of LABEL_SIZES) {
      for (const kind of ['product', 'packing'] as const) {
        const t = defaultTemplate(kind, size)
        expect(t.format).toBe(1)
        expect(t.size).toBe(size)
        expect(t.shopName).toBe('')
        if (t.kind === 'product') expect(t.priceStyle).toBe('THOUSAND')
        else expect(t.perPage).toBeGreaterThanOrEqual(4)
        const r = validateTemplate(t)
        expect(r.ok, `${kind} ${size}`).toBe(true)
        expect(r.warnings).toEqual([])
        expect(Object.keys(t.items).sort()).toEqual([...(kind === 'product' ? PRODUCT_ITEMS : PACKING_ITEMS)].sort())
      }
    }
    expect(defaultTemplate('packing').perPage).toBe(10)
  })

  it('JSON으로 저장하고 다시 읽으면 같은 템플릿이다', () => {
    for (const size of LABEL_SIZES) {
      for (const kind of ['product', 'packing'] as const) {
        const t = { ...defaultTemplate(kind, size), shopName: '다육 농장' }
        const json = templateToJson(t)
        const back = parseTemplateJson(json)
        expect(back.ok).toBe(true)
        if (back.ok) {
          expect(back.template).toStrictEqual(t)
          expect(templateToJson(back.template)).toBe(json)
        }
        const raw = JSON.parse(json) as Record<string, unknown>
        expect(Object.keys(raw)).toEqual(['format', 'kind', 'size', 'shopName', kind === 'product' ? 'priceStyle' : 'perPage', 'items'])
      }
    }
    expect(parseTemplateJson('{').ok).toBe(false)
  })

  it('모르는 칸 · 목록 밖 크기 · 모르는 가격 표기 · perPage 범위 밖 · 형식 번호', () => {
    const t = clone(defaultTemplate('product'))
    expect(problems({ ...t, align: 'left' })).toContain('라벨 설정에 알 수 없는 값이 있어요.')
    // 크기 오류 문장은 목록을 늘어놓지 않는다 (L-5, AC-N1-10 — 크기가 프린터마다 다르다)
    expect(problems({ ...t, size: '40x30' })).toEqual(['쓸 수 없는 라벨 크기예요. 라벨 크기 목록에서 다시 골라 주세요.'])
    expect(problems({ ...t, priceStyle: 'MAN' })).toEqual(['가격 표기 방법을 다시 골라 주세요.'])
    expect(problems({ ...t, format: 2 })).toEqual(['라벨 설정 형식을 읽을 수 없어요.'])
    expect(problems({ ...t, kind: 'sticker' })).toEqual(['라벨 종류를 읽을 수 없어요.'])
    expect(problems({ ...t, perPage: 10 })).toContain('라벨 설정에 알 수 없는 값이 있어요.')
    const p = clone(defaultTemplate('packing'))
    for (const perPage of [0, 41, 1.5, '10']) expect(problems({ ...p, perPage })).toEqual(['한 장에 넣을 번호 수는 1~40 사이로 정해 주세요.'])
    expect(validateTemplate({ ...p, perPage: 1 }).ok).toBe(true)
    expect(validateTemplate({ ...p, perPage: 40 }).ok).toBe(true)
    const extraItem = clone(defaultTemplate('product'))
    extraItem.items.memo = { ...extraItem.items.name }
    expect(problems(extraItem)).toContain('라벨 설정에 알 수 없는 값이 있어요.')
    const extraKey = clone(defaultTemplate('product'))
    extraKey.items.name = { ...extraKey.items.name, align: 'center' }
    expect(problems(extraKey)).toContain('라벨 설정에 알 수 없는 값이 있어요.')
    const missing = clone(defaultTemplate('product'))
    delete missing.items.price
    expect(problems(missing)).toEqual(['가격 칸 설정이 없어요.'])
  })

  it('끌 수 없는 항목을 끄면 문장 "번호는 끌 수 없어요." 등', () => {
    const cases: [kind: 'product' | 'packing', id: string, message: string][] = [
      ['product', 'number', '번호는 끌 수 없어요.'],
      ['product', 'buyer', '구매자는 끌 수 없어요.'],
      ['packing', 'buyer', '구매자는 끌 수 없어요.'],
      ['packing', 'page', '쪽 표시는 끌 수 없어요.'],
      ['packing', 'broadcast', '방송 제목은 끌 수 없어요.'],
      ['packing', 'numbers', '번호 목록은 끌 수 없어요.'],
    ]
    for (const [kind, id, message] of cases) {
      const t = clone(defaultTemplate(kind))
      t.items[id] = { ...t.items[id], visible: false }
      expect(problems(t)).toEqual([message])
    }
    for (const [kind, id] of [['product', 'shop'], ['product', 'price'], ['product', 'date'], ['product', 'name'], ['packing', 'shop'], ['packing', 'date'], ['packing', 'count'], ['packing', 'subtotal']] as const) {
      const t = clone(defaultTemplate(kind))
      t.items[id] = { ...t.items[id], visible: false }
      expect(validateTemplate(t).ok, `${kind} ${id}`).toBe(true)
    }
  })

  it('라벨 밖 상자 · 글자 크기 16~120 밖 · 최소 > 글자 크기 · 상자 값 형식', () => {
    const base = clone(defaultTemplate('product'))
    const withName = (patch: Record<string, unknown>): Mutable => ({ ...base, items: { ...base.items, name: { ...base.items.name, ...patch } } })
    expect(problems(withName({ x: 300 }))).toEqual(['품종 칸이 라벨 밖으로 나갔어요.'])
    expect(problems(withName({ y: -1 }))).toEqual(['품종 칸이 라벨 밖으로 나갔어요.'])
    expect(problems(withName({ height: 200 }))).toEqual(['품종 칸이 라벨 밖으로 나갔어요.'])
    expect(problems(withName({ fontSize: 15, minFontSize: 15 }))).toHaveLength(2)
    expect(problems(withName({ fontSize: 121 }))).toEqual(['품종 글자 크기는 16~120 사이로 정해 주세요.'])
    expect(problems(withName({ fontSize: 20, minFontSize: 24 }))).toEqual(['품종 최소 글자 크기가 글자 크기보다 커요.'])
    expect(problems(withName({ width: 0 }))).toEqual(['품종 칸의 위치나 크기가 올바르지 않아요.'])
    expect(problems(withName({ x: 1.5 }))).toEqual(['품종 칸의 위치나 크기가 올바르지 않아요.'])
    expect(problems(withName({ visible: 'yes' }))).toEqual(['품종 칸 설정을 읽을 수 없어요.'])
    expect(validateTemplate(withName({ fontSize: 16, minFontSize: 16 })).ok).toBe(true)
    expect(validateTemplate(withName({ fontSize: 120, minFontSize: 120, height: 88 })).ok).toBe(true)
    // 50×20에서는 높이 160을 넘으면 밖이다
    const small = clone(defaultTemplate('product', '50x20'))
    small.items.buyer = { ...small.items.buyer, y: 140 }
    expect(problems(small)).toEqual(['구매자 칸이 라벨 밖으로 나갔어요.'])
  })

  it('상자 겹침은 오류가 아니라 경고다', () => {
    const t = clone(defaultTemplate('product'))
    t.items.price = { ...t.items.price, x: 60 }
    const r = validateTemplate(t)
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.message)).toEqual(['번호 칸과 가격 칸이 겹쳐요.'])
    // 끈 항목은 겹침 경고에서 뺀다
    t.items.price = { ...t.items.price, visible: false }
    expect(validateTemplate(t).warnings).toEqual([])
  })

  it('오류가 있는 템플릿으로는 렌더하지 않는다, 받은 템플릿을 바꾸지 않는다', () => {
    const t = clone(defaultTemplate('product'))
    t.items.number = { ...t.items.number, visible: false }
    const frozen = Object.freeze(t)
    const r = renderProductLabel(nodeEnv(), frozen, SAMPLE_PRODUCT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_TEMPLATE')
    const packing = renderProductLabel(nodeEnv(), defaultTemplate('packing'), SAMPLE_PRODUCT)
    expect(packing.ok).toBe(false)
  })
})
