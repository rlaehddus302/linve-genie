// 상품 라벨 칸 형식 (D-LABEL-ITEMS-01·D-LABEL-TIME-01·D-LABEL-SAMPLE-01·D-LABEL-MINBOX-01, 사용자 지시 2026-11-23):
// 가게 이름 양옆 기호, 날짜 연도 끄기·사이 기호, 시간 칸(17:30 · 5:30 PM), 미리 보기 견본, 칸마다 가장 작은 칸.
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_PRODUCT,
  PRODUCT_ITEMS,
  SHOP_MARKS,
  computeProductText,
  defaultTemplate,
  formatLabelDate,
  formatLabelTime,
  labelContentKey,
  minItemSizes,
  parseTemplateJson,
  renderProductLabel,
  templateToJson,
  validateTemplate,
  type ProductTemplate,
} from '../src/index.ts'
import { SAMPLE_PRODUCT, expectCleanLayout, nodeEnv } from './helpers.ts'

const env = nodeEnv()
const base = (): ProductTemplate => ({ ...defaultTemplate('product'), shopName: '다육농장' })
const withTime = (t: ProductTemplate): ProductTemplate => ({ ...t, items: { ...t.items, time: { ...t.items.time, visible: true } } })

describe('가게 이름 양옆 기호', () => {
  it('없으면 옛 -가게- 그대로, 고르면 < > · [ ] · ( ) · 없음', () => {
    const words: Record<(typeof SHOP_MARKS)[number], string> = { none: '다육농장', dash: '-다육농장-', angle: '<다육농장>', square: '[다육농장]', round: '(다육농장)' }
    const plain = renderProductLabel(env, base(), SAMPLE_PRODUCT)
    expect(plain.ok && plain.layout.items.find((i) => i.id === 'shop')?.lines).toEqual(['-다육농장-'])
    for (const shopMark of SHOP_MARKS) {
      const r = renderProductLabel(env, { ...base(), shopMark }, SAMPLE_PRODUCT)
      expect(r.ok, shopMark).toBe(true)
      if (!r.ok) continue
      expect(r.layout.items.find((i) => i.id === 'shop')?.lines).toEqual([words[shopMark]])
      expectCleanLayout(r.image, r.layout)
    }
  })

  it('모르는 기호는 거절', () => {
    expect(validateTemplate({ ...base(), shopMark: 'star' }).ok).toBe(false)
  })
})

describe('날짜 표기', () => {
  it('연도 켜고 끄기, 사이 기호 . / -', () => {
    expect(formatLabelDate('2026-11-23')).toBe('26.11.23')
    expect(formatLabelDate('2026-11-23', { year: false, sep: '.' })).toBe('11.23')
    expect(formatLabelDate('2026-11-23', { year: false, sep: '/' })).toBe('11/23')
    expect(formatLabelDate('2026-11-23', { year: true, sep: '-' })).toBe('26-11-23')
    const r = computeProductText({ ...base(), dateStyle: { year: false, sep: '/' } }, SAMPLE_PRODUCT)
    expect(r.ok && r.text.items.date).toBe('10/08')
  })

  it('모르는 표기는 거절', () => {
    expect(validateTemplate({ ...base(), dateStyle: { year: true, sep: '~' } }).ok).toBe(false)
    expect(validateTemplate({ ...base(), dateStyle: { year: 'yes', sep: '.' } }).ok).toBe(false)
    expect(validateTemplate({ ...base(), dateStyle: { year: true, sep: '.', extra: 1 } }).ok).toBe(false)
  })
})

describe('시간 칸', () => {
  it('24h `17:30` · 12h `5:30 PM` (자정 12:05 AM, 정오 12:05 PM)', () => {
    expect(formatLabelTime('17:30')).toBe('17:30')
    expect(formatLabelTime('17:30', '12h')).toBe('5:30 PM')
    expect(formatLabelTime('00:05', '12h')).toBe('12:05 AM')
    expect(formatLabelTime('12:05', '12h')).toBe('12:05 PM')
    expect(formatLabelTime('09:00', '12h')).toBe('9:00 AM')
  })

  it('기본 템플릿은 시간 칸을 끈다 — 시각이 와도 찍지 않는다', () => {
    expect(PRODUCT_ITEMS).toContain('time')
    expect(base().items.time.visible).toBe(false)
    const r = computeProductText(base(), { ...SAMPLE_PRODUCT, time: '17:30' })
    expect(r.ok && r.text.items.time).toBeUndefined()
  })

  it('켜면 표기대로 찍고, 시각이 없으면 빈 칸(오류 아님)', () => {
    const on = withTime(base())
    const r = renderProductLabel(env, { ...on, timeStyle: '12h' }, { ...SAMPLE_PRODUCT, time: '17:30' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.layout.items.find((i) => i.id === 'time')?.lines).toEqual(['5:30 PM'])
    const none = renderProductLabel(env, on, SAMPLE_PRODUCT)
    expect(none.ok && none.layout.items.some((i) => i.id === 'time')).toBe(false)
  })

  it('가장 넓은 12시간 표기도 기본 시간 칸에 20점 이상으로 들어간다 (모든 크기)', () => {
    for (const size of ['50x30', '50x20', '50x40', '50x50', '50x15', 'tape12x40', 'tape15x30', 'tape15x50'] as const) {
      const t = withTime({ ...defaultTemplate('product', size), timeStyle: '12h' })
      // `10:08 AM`·`12:58 PM` — 내장 글꼴로 가장 넓은 12시간 표기 쪽
      for (const time of ['10:08', '12:58', '00:08']) {
        const r = renderProductLabel(env, t, { ...SAMPLE_PRODUCT, time })
        expect(r.ok, `${size} ${time}`).toBe(true)
        if (r.ok) expect(r.layout.items.find((i) => i.id === 'time')?.fontSize, size).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('잘못된 시각은 INVALID_DATA(시간)', () => {
    for (const time of ['24:00', '7:30', '17:3', 1730, '']) {
      const r = computeProductText(base(), { ...SAMPLE_PRODUCT, time })
      expect(r.ok, String(time)).toBe(false)
      if (!r.ok) expect(r.error).toMatchObject({ code: 'INVALID_DATA', field: 'time' })
    }
  })

  it('시각은 내용 키에 넣지 않는다 — 같은 찜이면 시각이 있어도 없어도 같은 키', () => {
    expect(labelContentKey('product', { ...SAMPLE_PRODUCT, time: '17:30' })).toEqual(labelContentKey('product', SAMPLE_PRODUCT))
  })

  it('시간 칸이 없는 옛 저장본은 끈 기본 칸으로 채워 읽고, 끈 기본 칸은 JSON에 적지 않는다(옛 JSON 그대로)', () => {
    const t = base()
    const { time: _time, ...oldItems } = t.items
    const old = validateTemplate({ ...t, items: oldItems })
    expect(old.ok).toBe(true)
    if (old.ok && old.template.kind === 'product') expect(old.template.items.time).toEqual(t.items.time)
    expect(JSON.parse(templateToJson(t)).items.time).toBeUndefined()
    const on = withTime(t)
    expect(JSON.parse(templateToJson(on)).items.time).toEqual(on.items.time)
    const back = parseTemplateJson(templateToJson({ ...on, shopMark: 'square', dateStyle: { year: false, sep: '-' }, timeStyle: '12h' }))
    expect(back.ok && back.template).toEqual({ ...on, shopMark: 'square', dateStyle: { year: false, sep: '-' }, timeStyle: '12h' })
  })
})

describe('미리 보기 견본 (D-LABEL-SAMPLE-01)', () => {
  it('적당히 긴 품종·닉네임, 가격 백만 원', () => {
    expect(PREVIEW_PRODUCT.price).toBe(1_000_000)
    expect(PREVIEW_PRODUCT.name.length).toBeGreaterThanOrEqual(8)
    expect(PREVIEW_PRODUCT.buyer.kind === 'youtube' && PREVIEW_PRODUCT.buyer.name.length).toBeGreaterThanOrEqual(7)
    const r = renderProductLabel(env, { ...base(), priceStyle: 'WON' }, PREVIEW_PRODUCT)
    expect(r.ok).toBe(true)
  })
})

describe('칸마다 가장 작은 칸 (D-LABEL-MINBOX-01)', () => {
  it('켠 칸마다 있고, 그 크기면 최소 글자 크기로 DOES_NOT_FIT 없이 그린다', () => {
    const t = withTime({ ...base(), priceStyle: 'WON' })
    const r = minItemSizes(env, t, PREVIEW_PRODUCT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.sizes).sort()).toEqual(['buyer', 'date', 'name', 'number', 'price', 'shop', 'time'])
    for (const [id, size] of Object.entries(r.sizes)) {
      const key = id as keyof ProductTemplate['items']
      const item = t.items[key]
      const shrunk = { ...t, items: { ...t.items, [key]: { ...item, x: 4, y: 4, width: size.width, height: size.height, fontSize: item.minFontSize } } }
      expect(renderProductLabel(env, shrunk, PREVIEW_PRODUCT).ok, id).toBe(true)
    }
  })

  it('숫자 칸은 그보다 좁으면 들어가지 않는다 (가격 1,000,000원)', () => {
    const t = { ...base(), priceStyle: 'WON' as const }
    const r = minItemSizes(env, t, PREVIEW_PRODUCT)
    if (!r.ok) throw new Error('최소 칸')
    const price = r.sizes.price
    if (price === undefined) throw new Error('가격')
    const narrow = { ...t, items: { ...t.items, price: { ...t.items.price, width: price.width - 2, height: price.height, fontSize: t.items.price.minFontSize } } }
    const drawn = renderProductLabel(env, narrow, PREVIEW_PRODUCT)
    expect(drawn.ok).toBe(false)
  })

  it('날짜는 그 표기의 가장 넓은 날로 잰다 — `-` 표기는 `.`보다 넓다', () => {
    const dot = minItemSizes(env, base(), SAMPLE_PRODUCT)
    const dash = minItemSizes(env, { ...base(), dateStyle: { year: true, sep: '-' } }, SAMPLE_PRODUCT)
    if (!dot.ok || !dash.ok) throw new Error('최소 칸')
    expect(dash.sizes.date?.width ?? 0).toBeGreaterThan(dot.sizes.date?.width ?? 0)
    // 기본 날짜 칸(폭 90)에는 `.` 표기의 가장 넓은 날이 들어간다 (D-STB-01)
    expect(dot.sizes.date?.width ?? 999).toBeLessThanOrEqual(base().items.date.width)
  })

  it('끈 칸과 값이 없는 칸은 없다', () => {
    const r = minItemSizes(env, base(), SAMPLE_PRODUCT)
    expect(r.ok && Object.keys(r.sizes).sort()).toEqual(['buyer', 'date', 'name', 'number', 'price', 'shop'])
  })
})
