// 라벨 골든 (AC-P1-01, D-P1-01): tests/golden/label/*.json의 모든 사례를 글 계산 순수 함수로 돌려 out과 깊은 같음으로 비교한다.
// 오류 사례는 글·그림을 만들지 않는지, 성공 사례는 렌더한 배치 결과의 글이 글 계산 값과 같은지(AC-P1-06)도 본다.
// 골든 파일은 보호 경로라 고치지 않는다. 파일 수·사례 수는 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_SIZE,
  a4Layout,
  computePackingText,
  computeProductText,
  defaultTemplate,
  isLabelSize,
  renderPackingLabels,
  renderProductLabel,
  validateTemplate,
} from '../src/index.ts'
import { SAMPLE_PRODUCT, expectLayoutMatchesText, nodeEnv } from './helpers.ts'

const GOLDEN_DIR = join(import.meta.dirname, '..', '..', '..', 'tests', 'golden', 'label')

const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = {
  product: ['id', 'title', 'refs', 'note', 'template', 'data', 'out'],
  packing: ['id', 'title', 'refs', 'note', 'template', 'data', 'out'],
  size: ['id', 'title', 'refs', 'note', 'size', 'out'],
} as const
const REQUIRED = { product: ['id', 'title', 'refs', 'data', 'out'], packing: ['id', 'title', 'refs', 'data', 'out'], size: ['id', 'title', 'refs', 'size', 'out'] } as const
const TEMPLATE_KEYS = { product: ['shopName', 'priceStyle', 'visible'], packing: ['shopName', 'perPage', 'visible'] } as const
const ERROR_CODES = ['INVALID_DATA', 'INVALID_TEMPLATE']

type Kind = keyof typeof CASE_KEYS
interface GoldenCase {
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly template?: Record<string, unknown>
  readonly data?: unknown
  readonly size?: string
  readonly out: Record<string, unknown>
}
interface GoldenFile {
  readonly file: string
  readonly kind: Kind
  readonly cases: readonly GoldenCase[]
}

/** 골든 파일을 읽고 형식 계약(tests/golden/README.md "라벨 골든")을 검사한다. 어기면 읽기 오류로 던진다 */
function loadGolden(): GoldenFile[] {
  const files = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
  const ids = new Set<string>()
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as Record<string, unknown>
    const where = `읽기 오류 ${file}`
    for (const key of Object.keys(raw)) if (!FILE_KEYS.includes(key)) throw new Error(`${where}: 모르는 키 ${key}`)
    const kind = raw.kind
    if (kind !== 'product' && kind !== 'packing' && kind !== 'size') throw new Error(`${where}: 모르는 kind ${String(kind)}`)
    if (!Array.isArray(raw.cases)) throw new Error(`${where}: cases가 목록이 아니다`)
    const cases = raw.cases as Record<string, unknown>[]
    for (const c of cases) {
      const at = `${where} ${String(c.id)}`
      for (const key of Object.keys(c)) if (!(CASE_KEYS[kind] as readonly string[]).includes(key)) throw new Error(`${at}: 모르는 키 ${key}`)
      for (const key of REQUIRED[kind]) if (!Object.hasOwn(c, key)) throw new Error(`${at}: ${key}가 없다`)
      if (typeof c.id !== 'string' || !/^G-LBL-\d{3}$/.test(c.id)) throw new Error(`${at}: id 형식`)
      if (ids.has(c.id)) throw new Error(`${at}: 겹친 id`)
      ids.add(c.id)
      if (!Array.isArray(c.refs) || c.refs.length === 0) throw new Error(`${at}: refs가 비었다`)
      if (c.template !== undefined) {
        if (kind === 'size' || typeof c.template !== 'object' || c.template === null) throw new Error(`${at}: template 형식`)
        for (const key of Object.keys(c.template)) if (!(TEMPLATE_KEYS[kind] as readonly string[]).includes(key)) throw new Error(`${at}: 모르는 template 키 ${key}`)
      }
      const out = c.out as Record<string, unknown>
      if (typeof out !== 'object' || out === null) throw new Error(`${at}: out 형식`)
      if ('error' in out) {
        if (Object.keys(out).length !== 1 || !ERROR_CODES.includes(out.error as string)) throw new Error(`${at}: 오류 out 형식`)
      } else {
        const allowed = kind === 'product' ? ['items'] : kind === 'packing' ? ['common', 'pages'] : ['width', 'height', 'a4PerPage', 'default']
        for (const key of Object.keys(out)) if (!allowed.includes(key)) throw new Error(`${at}: 모르는 out 키 ${key}`)
        for (const key of allowed) if (!Object.hasOwn(out, key)) throw new Error(`${at}: out.${key}가 없다`)
      }
    }
    return { file, kind, cases: cases as unknown as GoldenCase[] }
  })
}

/** 기본 템플릿(50×30)에 사례의 덮어쓸 값을 얹는다 */
function templateFor(kind: 'product' | 'packing', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = structuredClone(defaultTemplate(kind)) as unknown as Record<string, unknown>
  const items = base.items as Record<string, Record<string, unknown>>
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'visible') {
      for (const [id, visible] of Object.entries(value as Record<string, unknown>)) items[id] = { ...(items[id] ?? {}), visible }
    } else base[key] = value
  }
  return base
}

/** 글 계산은 되지만 기본 50×30 템플릿에 들어가지 않는 사례: G-LBL-013 `100,000,000원`(1억, 아홉 자리) */
const TOO_WIDE_FOR_DEFAULT = ['G-LBL-013']

const golden = loadGolden()

describe('라벨 골든 (AC-P1-01)', () => {
  it('파일 3개 · 사례 83개(상품 50 · 포장 29 · 크기 4)를 읽는다', () => {
    expect(golden.map((g) => g.file)).toEqual(['packing.json', 'product.json', 'sizes.json'])
    const count = (kind: Kind): number => golden.filter((g) => g.kind === kind).reduce((n, g) => n + g.cases.length, 0)
    expect(count('product')).toBe(50)
    expect(count('packing')).toBe(29)
    expect(count('size')).toBe(4)
    expect(golden.reduce((n, g) => n + g.cases.length, 0)).toBe(83)
  })

  const env = nodeEnv()
  for (const g of golden) {
    describe(g.file, () => {
      for (const c of g.cases) {
        it(`${c.id} ${c.title}`, () => {
          if (g.kind === 'product') {
            const template = templateFor('product', c.template)
            const result = computeProductText(template, c.data)
            const rendered = renderProductLabel(env, template, c.data)
            if ('error' in c.out) {
              expect(result.ok).toBe(false)
              if (!result.ok) expect(result.error.code).toBe(c.out.error)
              expect(rendered.ok).toBe(false)
              if (!rendered.ok) expect(rendered.error.code).toBe(c.out.error)
              return
            }
            expect(result.ok).toBe(true)
            if (!result.ok) return
            expect(result.text.items).toStrictEqual(c.out.items)
            if (!rendered.ok) {
              // 기본 템플릿 가격 상자는 AC-P1-14의 최악값(99,999,999원)까지 담는다. 그보다 긴 가격은 잘린 숫자 대신 DOES_NOT_FIT(L-5 맞추기 4)
              expect(rendered.error.code).toBe('DOES_NOT_FIT')
              expect(rendered.error.item).toBe('price')
              expect(TOO_WIDE_FOR_DEFAULT).toContain(c.id)
              return
            }
            expect(TOO_WIDE_FOR_DEFAULT).not.toContain(c.id)
            const items = result.text.items as Record<string, string>
            expect(rendered.layout.items.map((i) => i.id).sort()).toEqual(Object.keys(items).sort())
            for (const item of rendered.layout.items) expectLayoutMatchesText(item, items[item.id] as string)
            return
          }
          if (g.kind === 'packing') {
            const template = templateFor('packing', c.template)
            const result = computePackingText(template, c.data)
            const rendered = renderPackingLabels(env, template, c.data)
            if ('error' in c.out) {
              expect(result.ok).toBe(false)
              if (!result.ok) expect(result.error.code).toBe(c.out.error)
              expect(rendered.ok).toBe(false)
              if (!rendered.ok) expect(rendered.error.code).toBe(c.out.error)
              return
            }
            expect(result.ok).toBe(true)
            if (!result.ok) return
            expect({ common: result.text.common, pages: result.text.pages }).toStrictEqual(c.out)
            expect(rendered.ok).toBe(true)
            if (!rendered.ok) return
            expect(rendered.pages).toHaveLength(result.text.pages.length)
            rendered.pages.forEach((page, k) => {
              const p = result.text.pages[k]
              const values: Record<string, string | undefined> = {
                ...result.text.common,
                page: p?.page,
                broadcast: p?.broadcast,
                numbers: p?.numbers.join(', '),
              }
              const expected = Object.entries(values).filter(([, v]) => v !== undefined)
              expect(page.layout.items.map((i) => i.id).sort()).toEqual(expected.map(([k2]) => k2).sort())
              for (const item of page.layout.items) expectLayoutMatchesText(item, values[item.id] as string)
            })
            return
          }
          // 크기: 그 크기의 기본 상품 템플릿으로 실제 렌더한 점 수, A4 한 장의 라벨 수, 기본 크기인지
          const size = c.size as string
          if ('error' in c.out) {
            expect(isLabelSize(size)).toBe(false)
            const checked = validateTemplate({ ...defaultTemplate('product'), size })
            expect(checked.ok).toBe(false)
            if (!checked.ok) expect(checked.error.code).toBe(c.out.error)
            const rendered = renderProductLabel(env, { ...defaultTemplate('product'), size }, SAMPLE_PRODUCT)
            expect(rendered.ok).toBe(false)
            return
          }
          expect(isLabelSize(size)).toBe(true)
          if (!isLabelSize(size)) return
          const rendered = renderProductLabel(env, defaultTemplate('product', size), SAMPLE_PRODUCT)
          expect(rendered.ok).toBe(true)
          if (!rendered.ok) return
          expect({
            width: rendered.image.width,
            height: rendered.image.height,
            a4PerPage: a4Layout(size).perPage,
            default: size === DEFAULT_LABEL_SIZE,
          }).toStrictEqual(c.out)
        })
      }
    })
  }
})
