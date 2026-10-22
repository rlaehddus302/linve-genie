// 기본 템플릿 날짜 보장 (LABEL_RULES L-5 보장값 — 어느 날짜든 2000~2099의 모든 YY.MM.DD가 20점 이상, D-STB-01).
// 2000-01-01~2099-12-31 모든 날짜(36,525일)를 네 크기(50×20·30·40·50) 기본 상품·포장 템플릿에 맞춘다.
// 맞추기(글자 크기·DOES_NOT_FIT 판단)는 실제 렌더 함수가 실제 글꼴 치수(Node 캔버스 measureText)로 한다 — 그리기·1비트 변환만 건너뛰는
// 캔버스를 넣어 날짜 수만큼 빠르게 돈다. 가장 넓은 날짜들은 진짜 캔버스로도 그려 배치를 확인한다.
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import {
  ALL_LABEL_SIZES,
  defaultTemplate,
  formatLabelDate,
  isSmallLabelSize,
  renderPackingLabels,
  renderPackingPage,
  renderProductLabel,
  renderProductText,
  type LabelCanvas2D,
  type LabelRenderEnv,
  type LabelSizeId,
  type PackingTemplate,
  type ProductTemplate,
} from '../src/index.ts'
import { STB_DATE_BOX, STB_DATE_SIZES, revertStbDateBox } from './base-snapshot.ts'
import { expectCleanLayout, expectLayoutMatchesText, nodeEnv } from './helpers.ts'

const env = nodeEnv()

/** 그리기 직전까지(맞추기)만 실제로 하고 멈추는 신호 */
class Placed extends Error {}

/**
 * 실제 글꼴로 재기만 하고 그리지는 않는 렌더 환경. 맞추기(글자 크기·DOES_NOT_FIT)는 실제 렌더 함수가 실제 치수로 하고,
 * 맞춘 뒤 찍는 글과 그때의 글자 크기를 적어 둔 다음 1비트 변환 앞에서 멈춘다(변환이 시간 대부분이라).
 */
function measuringEnv(real: LabelRenderEnv): { env: LabelRenderEnv; drawn: { size: number; text: string }[] } {
  const ctx = createCanvas(8, 8).getContext('2d') as unknown as LabelCanvas2D
  const drawn: { size: number; text: string }[] = []
  const fake: LabelCanvas2D = {
    get font() {
      return ctx.font
    },
    set font(v: string) {
      ctx.font = v
    },
    fillStyle: '#000000',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => undefined,
    fillText: (text) => {
      drawn.push({ size: Number.parseFloat(ctx.font), text })
    },
    measureText: (text) => ctx.measureText(text),
    getImageData: () => {
      throw new Placed()
    },
  }
  return {
    env: {
      font: real.font,
      createContext: () => {
        drawn.length = 0
        return fake
      },
    },
    drawn,
  }
}

/** 2000-01-01부터 2099-12-31까지 모든 날짜 (YYYY-MM-DD) */
function allDates(): string[] {
  const out: string[] = []
  const DAY = 86_400_000
  for (let t = Date.UTC(2000, 0, 1); t <= Date.UTC(2099, 11, 31); t += DAY) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

const DATES = allDates()
const fast = measuringEnv(env)
const productData = (date: string) => ({ no: 9999, name: '왕비뇌신금', price: 99999999, date, buyer: { kind: 'youtube', name: '우주천사' } })
const packingData = (date: string) => ({ date, buyer: { kind: 'youtube', name: '우주천사' }, broadcasts: [{ title: '1부', numbers: [31, 15, 28] }], subtotal: 30000 })

type Fit = { ok: true; fontSize: number; line: string } | { ok: false; code: string; item: string }

/** 날짜 칸 하나만 맞춘 결과 — 항목은 서로 따로 맞추므로(L-5) 날짜 칸의 결과는 다른 항목과 함께일 때와 같다(아래 진짜 캔버스 시험) */
function fitDateOnly(render: () => { ok: boolean; error?: { code: string; item?: string } }, line: string): Fit {
  try {
    const r = render()
    if (!r.ok) return { ok: false, code: r.error?.code ?? '', item: r.error?.item ?? '' }
    throw new Error('그리기 앞에서 멈추지 않았다')
  } catch (e) {
    if (!(e instanceof Placed)) throw e
  }
  const hit = fast.drawn.filter((d) => d.text === line)
  if (hit.length !== 1) return { ok: false, code: 'NOT_DRAWN', item: 'date' }
  return { ok: true, fontSize: hit[0]?.size ?? 0, line }
}

function fitProductFast(template: ProductTemplate, date: string): Fit {
  const line = formatLabelDate(date)
  return fitDateOnly(() => renderProductText(fast.env, { kind: 'product', template, items: { date: line } }), line)
}

function fitPackingFast(template: PackingTemplate, date: string): Fit {
  const line = formatLabelDate(date)
  return fitDateOnly(() => renderPackingPage(fast.env, { kind: 'packing', template, common: { date: line }, pages: [] }, { page: '1/1', numbers: [1] }), line)
}

/** 진짜 캔버스로 온전한 라벨을 그린 날짜 칸 결과 */
function fitProduct(template: ProductTemplate, date: string): Fit {
  const r = renderProductLabel(env, template, productData(date))
  if (!r.ok) return { ok: false, code: r.error.code, item: r.error.item ?? '' }
  const d = r.layout.items.find((i) => i.id === 'date')
  return d ? { ok: true, fontSize: d.fontSize, line: d.lines.join('\n') } : { ok: false, code: 'NO_DATE', item: '' }
}

function fitPacking(template: PackingTemplate, date: string): Fit {
  const r = renderPackingLabels(env, template, packingData(date))
  if (!r.ok) return { ok: false, code: r.error.code, item: r.error.item ?? '' }
  const fits = r.pages.map((p): Fit => {
    const d = p.layout.items.find((i) => i.id === 'date')
    return d ? { ok: true, fontSize: d.fontSize, line: d.lines.join('\n') } : { ok: false, code: 'NO_DATE', item: '' }
  })
  return fits.find((f) => !f.ok || f.fontSize !== (fits[0] as Fit & { ok: true }).fontSize) ?? (fits[0] as Fit)
}

/** 날짜 칸이 20점 아래이거나 들어가지 않는 날짜와 그 까닭 */
function failures(fit: (date: string) => Fit): [string, Fit][] {
  const out: [string, Fit][] = []
  for (const date of DATES) {
    const f = fit(date)
    if (!f.ok || f.fontSize < 20 || f.line !== formatLabelDate(date)) out.push([date, f])
  }
  return out
}

describe('L-5 보장값: 2000~2099 모든 날짜가 기본 템플릿에 20점 이상 (D-STB-01)', () => {
  it('날짜는 36,525일이고 YY.MM.DD 글은 모두 다르다', () => {
    expect(DATES).toHaveLength(36_525)
    expect(DATES[0]).toBe('2000-01-01')
    expect(DATES.at(-1)).toBe('2099-12-31')
    expect(new Set(DATES.map(formatLabelDate)).size).toBe(36_525)
  })

  it('네 크기 기본 상품 템플릿의 날짜 칸은 x 290 · 폭 90 (오른쪽 끝 380 그대로, 가격 칸과 겹치지 않음)', () => {
    // 작은 크기가 아닌 크기 전부 (작은 템플릿의 날짜 칸은 꺼져 있고 폭 104 이상)
    expect([...STB_DATE_SIZES].sort()).toEqual(ALL_LABEL_SIZES.filter((s) => !isSmallLabelSize(s)).sort())
    for (const size of STB_DATE_SIZES) {
      const t = defaultTemplate('product', size)
      expect([t.items.date.x, t.items.date.width], size).toEqual([STB_DATE_BOX.now.x, STB_DATE_BOX.now.width])
      expect(t.items.date.x + t.items.date.width, size).toBe(380)
      expect(t.items.price.x + t.items.price.width, size).toBeLessThanOrEqual(t.items.date.x)
    }
  })

  for (const size of STB_DATE_SIZES) {
    it(`${size} 기본 상품 템플릿: 모든 날짜가 DOES_NOT_FIT 없이 20점 이상 (번호 9999 · 가격 99,999,999원과 함께)`, () => {
      expect(failures((date) => fitProductFast(defaultTemplate('product', size), date))).toEqual([])
    }, 180_000)

    it(`${size} 기본 포장 템플릿: 모든 날짜가 DOES_NOT_FIT 없이 20점 이상`, () => {
      expect(failures((date) => fitPackingFast(defaultTemplate('packing', size), date))).toEqual([])
    }, 180_000)
  }

  it('옛 날짜 칸(x 292 · 폭 88)은 04.04.04 같은 날짜가 들어가지 않았다 — 앞으로 처음은 2034-04-04 (이 시험이 문제를 잡는다)', () => {
    for (const size of STB_DATE_SIZES) {
      const old = failures((date) => fitProductFast(revertStbDateBox('product', size) as ProductTemplate, date))
      expect(old.length, size).toBeGreaterThan(0)
      for (const [, f] of old) expect(f, size).toEqual({ ok: false, code: 'DOES_NOT_FIT', item: 'date' })
      const dates = old.map(([d]) => d)
      expect(dates, size).toContain('2004-04-04')
      expect(dates.find((d) => d >= '2026-10-23'), size).toBe('2034-04-04')
    }
  }, 300_000)

  it('가장 넓은 날짜(2004-04-04 · 2044-04-04 · 2000-04-04 · 2034-04-04)를 진짜 캔버스로 그려도 같은 결과이고 배치가 깨끗하다', () => {
    for (const size of STB_DATE_SIZES as readonly LabelSizeId[]) {
      for (const date of ['2004-04-04', '2044-04-04', '2000-04-04', '2034-04-04']) {
        // 날짜 칸만 맞춘 빠른 결과 = 온전한 라벨을 진짜 캔버스로 그린 결과 (옛 칸도)
        expect(fitProductFast(defaultTemplate('product', size), date), `${size} ${date}`).toEqual(fitProduct(defaultTemplate('product', size), date))
        expect(fitPackingFast(defaultTemplate('packing', size), date), `${size} ${date}`).toEqual(fitPacking(defaultTemplate('packing', size), date))
        const old = revertStbDateBox('product', size) as ProductTemplate
        expect(fitProductFast(old, date), `${size} ${date} 옛 칸`).toEqual(fitProduct(old, date))
        const r = renderProductLabel(env, defaultTemplate('product', size), productData(date))
        expect(r.ok, `${size} ${date}`).toBe(true)
        if (r.ok) {
          for (const item of r.layout.items) expectLayoutMatchesText(item, r.text.items[item.id as keyof typeof r.text.items] as string)
          expectCleanLayout(r.image, r.layout)
        }
        const p = renderPackingLabels(env, defaultTemplate('packing', size), packingData(date))
        expect(p.ok, `${size} ${date}`).toBe(true)
        if (p.ok) for (const page of p.pages) expectCleanLayout(page.image, page.layout)
      }
    }
  })
})
