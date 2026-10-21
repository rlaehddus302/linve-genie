// O3 라벨 옵션 글·수량 (AC-O3-02~09 — LABEL_RULES L-3·L-4·L-5·L-10, D-O3-01~04·09).
// 다육 회귀는 BASE(O3 전) src로 그린 그림 해시·내용 키 고정값(fixtures/base-o3.json — gen-base-snapshot.ts)과 비교한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ALL_LABEL_SIZES,
  PACKING_LABEL_SIZES,
  SMALL_LABEL_SIZES,
  checkPackingData,
  checkProductData,
  computePackingText,
  computeProductText,
  defaultTemplate,
  labelContentKey,
  renderPackingLabels,
  renderProductLabel,
  type LabelSizeId,
} from '../src/index.ts'
import { collectSnapshot, type BaseSnapshot } from './base-snapshot.ts'
import { expectCleanLayout, expectLayoutMatchesText, nodeEnv } from './helpers.ts'

const env = nodeEnv()
const BASE: BaseSnapshot = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'base-o3.json'), 'utf8')) as BaseSnapshot

const HONG = { kind: 'youtube', name: '홍길동' } as const
const product = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({ no: 22, name: '반팔티', price: 34000, date: '2026-10-25', buyer: HONG, ...fields })
const packing = (numbers: readonly unknown[], fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  date: '2026-10-25',
  buyer: HONG,
  broadcasts: [{ title: '의류 2부', numbers }],
  subtotal: 68000,
  ...fields,
})

/** 옵션 없는 수량 1 데이터에 `qty: 1`·`variant: null`을 더하고, 포장 데이터의 정수 번호는 `{ no }`로 바꾼다 */
function withNeutralOptions(kind: 'product' | 'packing', data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data
  const d = data as Record<string, unknown>
  if (kind === 'product') return { ...d, variant: null, qty: 1 }
  if (!Array.isArray(d.broadcasts)) return data
  return {
    ...d,
    broadcasts: (d.broadcasts as unknown[]).map((b) => {
      if (typeof b !== 'object' || b === null || !Array.isArray((b as Record<string, unknown>).numbers)) return b
      const numbers = (b as { numbers: unknown[] }).numbers
      return { ...b, numbers: numbers.map((n, i) => (typeof n !== 'number' ? n : i % 3 === 0 ? { no: n } : i % 3 === 1 ? { no: n, qty: 1 } : { no: n, variant: null })) }
    }),
  }
}

describe('AC-O3-02·06 다육 회귀 — O3 전 그림·내용 키 그대로', () => {
  const now = collectSnapshot(env)

  it('고정값은 O3 전 라벨 골든 상품·포장 102사례 × (사례 템플릿 + 크기마다 기본 템플릿)이다', () => {
    expect(Object.keys(BASE.keys)).toHaveLength(102)
    expect(Object.keys(BASE.renders)).toHaveLength(782)
    // 그림이 있는 것 570 — 나머지는 오류 사례와 작은 크기에 들어가지 않는 값(DOES_NOT_FIT)·포장 템플릿 없는 크기다(그 오류도 같아야 한다)
    expect(Object.values(BASE.renders).filter((v) => !v.startsWith('error:'))).toHaveLength(570)
  })

  it('지금 코드로 그린 1비트 그림이 O3 전과 점 하나까지 같다 (해시)', () => {
    expect(now.renders).toStrictEqual(BASE.renders)
  })

  it('내용 키가 O3 전과 글자까지 같다', () => {
    expect(now.keys).toStrictEqual(BASE.keys)
  })

  it('qty: 1 · variant: null을 더해도, 포장의 정수 번호를 { no }로 바꿔도 같은 그림·같은 키다', () => {
    const neutral = collectSnapshot(env, (c) => withNeutralOptions(c.kind, c.data))
    expect(neutral.renders).toStrictEqual(BASE.renders)
    expect(neutral.keys).toStrictEqual(BASE.keys)
  })

  it('검사를 통과한 옵션 없는 수량 1 데이터는 O3 전과 같은 칸만 있다', () => {
    const checked = checkProductData(product({ variant: null, qty: 1 }))
    expect(checked.ok && Object.keys(checked.data).sort()).toEqual(['buyer', 'date', 'name', 'no', 'price'])
    const packed = checkPackingData(packing([{ no: 7 }, { no: 3, qty: 1 }, 5]))
    expect(packed.ok && packed.data.broadcasts[0]?.numbers).toEqual([7, 3, 5])
  })
})

describe('AC-O3-03 옵션 글은 품종 자리, 수량은 가격 자리', () => {
  it('50×30 기본 템플릿: 품종: 반팔티 105/검정색 · 가격: 2개 34 천원 (가격은 잘리지 않는다)', () => {
    const r = renderProductLabel(env, defaultTemplate('product'), product({ variant: '105/검정색', qty: 2 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const price = r.layout.items.find((i) => i.id === 'price')
    const name = r.layout.items.find((i) => i.id === 'name')
    expect(price?.lines).toEqual(['가격: 2개 34 천원'])
    expect(price?.method).not.toBe('truncated')
    expect(name?.value).toBe('반팔티 105/검정색')
    expect(name?.lines.join(' ').startsWith('품종: ')).toBe(true)
    for (const item of r.layout.items) expectLayoutMatchesText(item, r.text.items[item.id as keyof typeof r.text.items] as string)
    expectCleanLayout(r.image, r.layout)
  })

  it('수량이 1이거나 없으면 가격 항목에 "개"가 없다', () => {
    for (const fields of [{}, { qty: 1 }, { variant: 'M' }, { variant: 'M', qty: 1 }]) {
      const r = computeProductText(defaultTemplate('product'), product(fields))
      expect(r.ok && r.text.items.price).toBe('34 천원')
    }
  })

  it('긴 품종 + 옵션 글은 품종 규칙(두 줄·…) 그대로다', () => {
    const r = renderProductLabel(env, defaultTemplate('product'), product({ name: '아주 긴 품종 이름 오버핏 반팔 티셔츠 여름 신상', variant: '아이폰 17 프로 맥스/투명' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const name = r.layout.items.find((i) => i.id === 'name')
    expect(['twoLines', 'truncated']).toContain(name?.method)
    expectCleanLayout(r.image, r.layout)
  })
})

describe('AC-O3-04 수량 붙은 가격의 보장값', () => {
  const BIG: readonly LabelSizeId[] = ['50x20', '50x30', '50x40', '50x50']
  const bigCases = [
    { text: '9개 999,999원', price: 999_999, qty: 9, style: 'WON' },
    { text: '99개 99,999원', price: 99_999, qty: 99, style: 'WON' },
    { text: '9개 9,999 천원', price: 9_999_000, qty: 9, style: 'THOUSAND' },
    { text: '99개 999 천원', price: 999_000, qty: 99, style: 'THOUSAND' },
  ] as const
  const smallCases = [
    { text: '99개 99,999,999원', price: 99_999_999, qty: 99, style: 'WON' },
    { text: '99개 99,999 천원', price: 99_999_000, qty: 99, style: 'THOUSAND' },
  ] as const

  const check = (size: LabelSizeId, c: { text: string; price: number; qty: number; style: string }): void => {
    const template = { ...defaultTemplate('product', size), priceStyle: c.style }
    const r = renderProductLabel(env, template, product({ no: 9999, price: c.price, qty: c.qty, variant: '105/검정색' }))
    expect(r.ok, `${size} ${c.text}`).toBe(true)
    if (!r.ok) return
    const price = r.layout.items.find((i) => i.id === 'price')
    expect(price?.value, size).toBe(c.text)
    expect(price?.lines, size).toEqual([`가격: ${c.text}`])
    expect(r.layout.items.find((i) => i.id === 'number')?.lines, size).toEqual(['번호: 9999'])
    expectCleanLayout(r.image, r.layout, [], 20)
  }

  for (const size of BIG) for (const c of bigCases) it(`${size} ${c.text}`, () => check(size, c))
  for (const size of SMALL_LABEL_SIZES) for (const c of smallCases) it(`${size} ${c.text}`, () => check(size, c))

  it('그보다 긴 값(50×30 `10개 120,000원`)은 잘린 글 없이 DOES_NOT_FIT(price)', () => {
    const r = renderProductLabel(env, { ...defaultTemplate('product'), priceStyle: 'WON' }, product({ price: 120_000, qty: 10 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'DOES_NOT_FIT', item: 'price' })
  })

  it('모든 크기에서 수량 1 라벨은 가격 자리 그대로', () => {
    for (const size of ALL_LABEL_SIZES) {
      const r = computeProductText(defaultTemplate('product', size), product({ qty: 1 }))
      expect(r.ok && r.text.items.price, size).toBe('34 천원')
    }
  })
})

describe('AC-O3-05 라벨 데이터 검사', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['variant 빈 글', { variant: '' }],
    ['variant 공백', { variant: '   ' }],
    ['variant 보이지 않는 글자만', { variant: '​⁠﻿' }],
    ['variant 공백 + 폭 없는 공백', { variant: ' ​ ' }],
    ['variant 수', { variant: 105 }],
    ['variant 배열', { variant: ['105', '검정색'] }],
    ['variant 객체', { variant: { 사이즈: '105' } }],
    ['qty 0', { qty: 0 }],
    ['qty 100', { qty: 100 }],
    ['qty 1.5', { qty: 1.5 }],
    ['qty "2"', { qty: '2' }],
    ['qty null', { qty: null }],
    ['qty NaN', { qty: Number.NaN }],
    ['qty -1', { qty: -1 }],
    ['qty Infinity', { qty: Number.POSITIVE_INFINITY }],
    ['options 칸', { options: [['사이즈', '105']] }],
    ['memo 칸', { memo: '문 앞에 두세요' }],
    ['unitPrice 칸', { unitPrice: 17000 }],
  ]
  for (const [title, fields] of bad) {
    it(`${title} → INVALID_DATA, 글·그림 없음`, () => {
      const data = product(fields)
      const before = structuredClone(data)
      const c = computeProductText(defaultTemplate('product'), data)
      expect(c.ok).toBe(false)
      if (!c.ok) expect(c.error.code).toBe('INVALID_DATA')
      const r = renderProductLabel(env, defaultTemplate('product'), data)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_DATA')
      expect(labelContentKey('product', data).ok).toBe(false)
      expect(data).toStrictEqual(before)
    })
  }

  it('잘못된 칸 이름은 쉬운 한국어로 알린다', () => {
    const v = checkProductData(product({ variant: '' }))
    expect(!v.ok && v.error.message).toBe('라벨에 넣을 수 없는 값이 있어요: 옵션')
    const q = checkProductData(product({ qty: 0 }))
    expect(!q.ok && q.error.message).toBe('라벨에 넣을 수 없는 값이 있어요: 수량')
  })

  it('variant 없음·null, qty 없음·1~99 정수는 받는다 — 통과한 데이터는 표의 칸만, 받은 객체는 그대로', () => {
    for (const fields of [{}, { variant: null }, { qty: 1 }, { qty: 2 }, { qty: 99 }, { variant: 'M', qty: 50 }, { variant: ' M ' }]) {
      const data = product(fields)
      const before = structuredClone(data)
      const checked = checkProductData(data)
      expect(checked.ok, JSON.stringify(fields)).toBe(true)
      if (!checked.ok) continue
      for (const key of Object.keys(checked.data)) expect(['no', 'name', 'price', 'date', 'buyer', 'variant', 'qty']).toContain(key)
      expect(checked.data).not.toBe(data)
      expect(data).toStrictEqual(before)
    }
    const full = checkProductData(product({ variant: '105/검정색', qty: 2 }))
    expect(full.ok && full.data).toStrictEqual({ no: 22, name: '반팔티', price: 34000, date: '2026-10-25', buyer: HONG, variant: '105/검정색', qty: 2 })
  })

  it('포장 항목도 같은 검사 — 모르는 칸·빈 옵션 글·범위 밖 수량·번호는 INVALID_DATA', () => {
    for (const entry of [{ no: 1, name: 'x' }, { no: 1, variant: '' }, { no: 1, qty: 0 }, { no: 1, qty: 100 }, { no: 0 }, { no: 1.5 }, { variant: 'M' }, '1', null, [1]]) {
      const r = computePackingText(defaultTemplate('packing'), packing([entry]))
      expect(r.ok, JSON.stringify(entry)).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_DATA')
    }
  })
})

describe('AC-O3-06 내용 키 — 옵션 글·수량', () => {
  const key = (kind: 'product' | 'packing', data: unknown): string => {
    const r = labelContentKey(kind, data)
    if (!r.ok) throw new Error(r.error.message)
    return r.key
  }

  it('옵션 글이나 수량이 다르면 키가 다르다 (재출력 필요)', () => {
    const keys = [product(), product({ variant: 'M' }), product({ variant: 'L' }), product({ qty: 2 }), product({ qty: 3 }), product({ variant: 'M', qty: 2 })].map((d) => key('product', d))
    expect(new Set(keys).size).toBe(keys.length)
    const packs = [packing([21]), packing([{ no: 21, variant: 'M' }]), packing([{ no: 21, qty: 2 }]), packing([{ no: 21, variant: 'M', qty: 2 }]), packing([{ no: 21, variant: 'L', qty: 2 }])].map((d) => key('packing', d))
    expect(new Set(packs).size).toBe(packs.length)
  })

  it('다듬으면 같은 옵션 글(" M"·"M")은 키가 같다', () => {
    expect(key('product', product({ variant: ' M' }))).toBe(key('product', product({ variant: 'M' })))
    expect(key('product', product({ variant: 'M​' }))).toBe(key('product', product({ variant: 'M' })))
    expect(key('packing', packing([{ no: 21, variant: ' M' }]))).toBe(key('packing', packing([{ no: 21, variant: 'M' }])))
  })

  it('옵션 없는 수량 1 키는 O3 전 모양 그대로 (qty: 1·variant: null·{ no })', () => {
    const plain = key('product', product())
    expect(plain).toBe(JSON.stringify(['product', 22, '반팔티', 34000, '2026-10-25', 'youtube', '홍길동']))
    expect(key('product', product({ qty: 1, variant: null }))).toBe(plain)
    expect(key('packing', packing([{ no: 5 }, 3]))).toBe(key('packing', packing([5, 3])))
  })
})

describe('AC-O3-07 포장 옵션 항목·같음·상품 수', () => {
  it('옵션 없는 수량 1 항목은 정수, 옵션 항목은 `{번호}[ {옵션 글}][ ×{수량}]`', () => {
    const r = computePackingText(defaultTemplate('packing'), packing([{ no: 22, variant: '105/검정색', qty: 2 }, { no: 11, qty: 3 }, 7, { no: 21, variant: 'M' }, { no: 5 }]))
    expect(r.ok && r.text.pages).toEqual([{ page: '1/1', numbers: [5, 7, '11 ×3', '21 M', '22 105/검정색 ×2'] }])
    expect(r.ok && r.text.common.count).toBe('8')
  })

  // 무작위 항목: 같은 (번호, 옵션 글)이 없게 만든 항목 목록 → 정렬·수량 합·쪽 크기 성질
  const entryArb = fc.record({ no: fc.integer({ min: 1, max: 30 }), variant: fc.option(fc.constantFrom('M', 'L', '105/검정색', '흰색 대형'), { nil: undefined }), qty: fc.option(fc.integer({ min: 1, max: 99 }), { nil: undefined }) })
  const broadcastArb = fc
    .array(fc.oneof(fc.integer({ min: 1, max: 30 }), entryArb), { minLength: 1, maxLength: 25 })
    .map((items) => {
      const seen = new Set<string>()
      return items.filter((e) => {
        const k = typeof e === 'number' ? `${String(e)}|` : `${String(e.no)}|${e.variant ?? ''}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    })
  const strip = (e: unknown): Record<string, unknown> | number =>
    typeof e === 'number' ? e : Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => v !== undefined))

  it('성질: 상품 수 = 수량 합, 번호 순(같은 번호는 받은 순서), 옵션 방송의 쪽은 max(1, ⌊perPage ÷ 2⌋)까지, k/n의 n = 쪽 수 (AC-O3-08)', () => {
    fc.assert(
      fc.property(fc.array(broadcastArb, { minLength: 1, maxLength: 3 }), fc.integer({ min: 1, max: 40 }), (lists, perPage) => {
        const broadcasts = lists.map((numbers, i) => ({ title: `${String(i + 1)}부`, numbers: numbers.map(strip) }))
        const r = computePackingText({ ...defaultTemplate('packing'), perPage }, { date: '2026-10-25', buyer: HONG, broadcasts, subtotal: 0 })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const qtyOf = (e: number | Record<string, unknown>): number => (typeof e === 'number' ? 1 : ((e.qty as number | undefined) ?? 1))
        expect(r.text.common.count).toBe(String(broadcasts.reduce((n, b) => n + b.numbers.reduce<number>((m, e) => m + qtyOf(e), 0), 0)))
        const many = broadcasts.length > 1
        let k = 0
        for (const b of broadcasts) {
          const option = b.numbers.some((e) => typeof e !== 'number' && (e.variant !== undefined || qtyOf(e) !== 1))
          const limit = option ? Math.max(1, Math.floor(perPage / 2)) : perPage
          const expected = [...b.numbers]
            .sort((x, y) => (typeof x === 'number' ? x : (x.no as number)) - (typeof y === 'number' ? y : (y.no as number)))
            .map((e) => {
              if (typeof e === 'number') return e
              const v = e.variant as string | undefined
              const q = qtyOf(e)
              return v === undefined && q === 1 ? (e.no as number) : `${String(e.no)}${v === undefined ? '' : ` ${v}`}${q >= 2 ? ` ×${String(q)}` : ''}`
            })
          const got: (number | string)[] = []
          const pagesHere = Math.ceil(expected.length / limit)
          for (let i = 0; i < pagesHere; i++) {
            const page = r.text.pages[k++]
            expect(page?.numbers.length).toBeLessThanOrEqual(limit)
            if (many) expect(page?.broadcast).toBe(b.title)
            got.push(...(page?.numbers ?? []))
          }
          expect(got).toEqual(expected)
        }
        expect(r.text.pages).toHaveLength(k)
        for (const page of r.text.pages) expect(page.page.endsWith(`/${String(k)}`)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('같은 (번호, 다듬은 옵션 글)이 한 방송에 둘이면 INVALID_DATA — 다른 방송이면 된다', () => {
    for (const numbers of [[5, { no: 5 }], [{ no: 5, qty: 2 }, 5], [{ no: 5, variant: 'M' }, { no: 5, variant: 'M​' }], [{ no: 5, variant: ' M' }, { no: 5, variant: 'M', qty: 3 }]]) {
      const r = computePackingText(defaultTemplate('packing'), packing(numbers))
      expect(r.ok, JSON.stringify(numbers)).toBe(false)
    }
    const two = computePackingText(defaultTemplate('packing'), {
      date: '2026-10-25',
      buyer: HONG,
      broadcasts: [
        { title: '1부', numbers: [{ no: 5, variant: 'M' }] },
        { title: '2부', numbers: [{ no: 5, variant: 'M' }] },
      ],
      subtotal: 0,
    })
    expect(two.ok).toBe(true)
  })
})

describe('AC-O3-09 옵션 항목 안 공백에서도 줄 바꿈', () => {
  const half = (size: LabelSizeId): number => Math.max(1, Math.floor(defaultTemplate('packing', size).perPage / 2))

  for (const size of ['50x30', '50x40', '50x50'] as const) {
    it(`${size}: 옵션 방송 한 쪽 분량(${String(half(size))}개)의 "N 105/검정색 ×2"가 DOES_NOT_FIT 없이 찍히고 줄은 공백에서만 바뀐다`, () => {
      const entries = Array.from({ length: half(size) }, (_, i) => ({ no: 21 + i, variant: '105/검정색', qty: 2 }))
      const r = renderPackingLabels(env, defaultTemplate('packing', size), packing(entries))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.pages).toHaveLength(1)
      const item = r.pages[0]?.layout.items.find((i) => i.id === 'numbers')
      const value = entries.map((e) => `${String(e.no)} 105/검정색 ×2`).join(', ')
      expect(item?.value).toBe(value)
      // 이어 붙이면 원래 글 — 글자 사이에서 바뀐 줄이 없다
      expect(item?.valueLines.join(' ')).toBe(value)
      expect(item?.valueLines.every((line) => !line.startsWith(' ') && !line.endsWith(' '))).toBe(true)
      expectCleanLayout(r.pages[0]!.image, r.pages[0]!.layout)
    })

    it(`${size}: 한 줄보다 긴 항목 "121 아이폰 17 프로 맥스/투명 ×10"은 항목 안 공백에서 줄을 바꿔 찍힌다`, () => {
      const r = renderPackingLabels(env, defaultTemplate('packing', size), packing([{ no: 121, variant: '아이폰 17 프로 맥스/투명', qty: 10 }]))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const item = r.pages[0]?.layout.items.find((i) => i.id === 'numbers')
      expect(item?.valueLines.join(' ')).toBe('121 아이폰 17 프로 맥스/투명 ×10')
      expectCleanLayout(r.pages[0]!.image, r.pages[0]!.layout)
    })
  }

  it('정수 번호만 있는 쪽은 줄 바꿈이 `, ` 뒤에서만 (O3 전과 같은 줄)', () => {
    const numbers = Array.from({ length: 10 }, (_, i) => 9990 + i)
    const r = renderPackingLabels(env, defaultTemplate('packing'), packing(numbers))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.pages[0]?.layout.items.find((i) => i.id === 'numbers')
    const lines = item?.valueLines ?? []
    expect(lines.length).toBeGreaterThan(1)
    lines.slice(0, -1).forEach((line) => expect(line.endsWith(',')).toBe(true))
  })

  it('들어가지 않으면 잘린 글 없이 DOES_NOT_FIT(numbers)', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ no: 9900 + i, variant: '아이폰 17 프로 맥스/투명 케이스 특대형', qty: 99 }))
    const r = renderPackingLabels(env, { ...defaultTemplate('packing'), perPage: 40 }, packing(entries))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'DOES_NOT_FIT', item: 'numbers' })
  })

  it('낱말 하나가 상자보다 넓으면 글자 사이에서 자르지 않고 DOES_NOT_FIT', () => {
    const r = renderPackingLabels(env, defaultTemplate('packing', '50x20'), packing([{ no: 9999, variant: '아주아주아주아주긴옵션글자가띄어쓰기없이이어진것/검정색', qty: 99 }]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'DOES_NOT_FIT', item: 'numbers' })
  })

  it('PACKING_LABEL_SIZES 기본 템플릿 모두 G-LBL-O3-51 데이터를 그린다', () => {
    const data = {
      date: '2026-10-25',
      buyer: HONG,
      broadcasts: [
        { title: '다육 1부', numbers: [7] },
        { title: '의류 2부', numbers: [{ no: 21, variant: 'M' }, { no: 21, variant: 'L' }, { no: 22, variant: '105/검정색', qty: 2 }, { no: 11, qty: 3 }] },
      ],
      subtotal: 68000,
    }
    for (const size of PACKING_LABEL_SIZES) {
      const r = renderPackingLabels(env, defaultTemplate('packing', size), data)
      expect(r.ok, size).toBe(true)
      if (r.ok) for (const page of r.pages) expectCleanLayout(page.image, page.layout)
    }
  })
})
