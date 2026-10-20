// N1 적대 테스트 (test-domain): 작은 라벨·테이프 공격 (AC-N1-11·12·13·22, LABEL_RULES L-1·L-4·L-5·L-12 2).
// - 작은 크기 넷(50×15·테이프 12×40·15×30·15×50) × 무작위 데이터(번호 1~9999, 가격 0~99,999,999, 이모지·1만 자·문자찜 닉네임, 두 가격 표기)
//   → 라벨이 만들어지고(닉네임은 한 줄 `…`), 숫자 항목은 줄지 않으며, 잉크는 켠 항목 상자 안, 글자는 20점 이상
// - 꺼진 항목(가게 이름·품종·날짜)을 모두 켜도 상자 밖으로 그리지 않는다
// - 작은 크기의 포장 템플릿은 어떤 길로 들어와도(JSON·덮어쓰기) 그림을 만들지 않는다
// - 테이프 라벨 그림 → 테이프 프로필 작업 바이트: 폭 칸 0C 00, 보낸 그림을 되돌리면 원래 라벨 그림
import {
  SMALL_LABEL_SIZES,
  TEMPLATE_MESSAGES,
  TAPE_LABEL_SIZES,
  defaultTemplate,
  getPixel,
  labelSizeInfo,
  parseTemplateJson,
  renderPackingLabels,
  renderProductLabel,
  renderTestLabel,
  templateToJson,
  type LabelBitmap,
  type LabelLayout,
  type LabelSizeId,
  type ProductTemplate,
} from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { MARKLIFE_PROFILES, buildPrintJob } from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const env = createNodeRenderEnv()
const SMALL = SMALL_LABEL_SIZES as readonly LabelSizeId[]

function strayInk(image: LabelBitmap, layout: LabelLayout): number {
  let n = 0
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      if (!getPixel(image, x, y)) continue
      if (!layout.items.some((i) => x >= i.box.x - 1 && x < i.box.x + i.box.width + 1 && y >= i.box.y - 1 && y < i.box.y + i.box.height + 1)) n++
    }
  return n
}

const nickArb = fc.oneof(
  fc.constantFrom('우주천사', '👨‍👩‍👧‍👦 가족', '🌵다육🌵', '<b>굵게</b>', 'ＡＢＣ１２３', '우​주﻿천⁠사', '꧁༺ 𝓢𝓽𝓪𝓻 ༻꧂', 'مرحبا 우주'),
  fc.string({ minLength: 1, maxLength: 30 }),
  fc.constant('다육이사랑해요'.repeat(1500)),
)

describe('AC-N1-11 작은 템플릿 — 무작위 데이터', () => {
  it('작은 크기 넷 × 무작위 번호·가격·닉네임·가격 표기: 만들어지고, 숫자는 줄지 않고, 잉크는 상자 안, 20점 이상', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SMALL),
        fc.integer({ min: 1, max: 9999 }),
        fc.oneof(fc.constantFrom(0, 1000, 99_999_000, 99_999_999), fc.integer({ min: 0, max: 99_999_999 })),
        fc.constantFrom('THOUSAND' as const, 'WON' as const),
        fc.oneof(nickArb.map((name) => ({ kind: 'youtube' as const, name })), fc.constant({ kind: 'sms' as const })),
        (size, no, price, priceStyle, buyer) => {
          // 천원 표기는 천 원 단위 가격만 (L-3)
          const p = priceStyle === 'THOUSAND' ? Math.floor(price / 1000) * 1000 : price
          const t = { ...defaultTemplate('product', size), priceStyle }
          const r = renderProductLabel(env, t, { no, name: '왕비뇌신금', price: p, date: '2026-10-08', buyer })
          if (!r.ok) throw new Error(`${size} ${no} ${p} ${priceStyle} ${JSON.stringify(buyer).slice(0, 60)}: ${r.error.code} ${r.error.message}`)
          const info = labelSizeInfo(size)
          expect([r.image.width, r.image.height]).toEqual([info.widthDots, info.heightDots])
          expect(strayInk(r.image, r.layout)).toBe(0)
          for (const item of r.layout.items) {
            expect(item.fontSize, `${size} ${item.id}`).toBeGreaterThanOrEqual(20)
            if (item.id === 'number' || item.id === 'price') expect(item.method, `${size} ${item.id}`).not.toBe('truncated')
            if (item.id === 'buyer') expect(item.lines).toHaveLength(1)
          }
          expect(r.layout.items.map((i) => i.id).sort()).toEqual(['buyer', 'number', 'price'])
        },
      ),
      { numRuns: 200, seed: 0x4e3174 },
    )
  })

  it.each(SMALL)('%s: 가게 이름·품종·날짜를 모두 켜고 1만 자를 넣어도 상자 밖으로 그리지 않는다', (size) => {
    const base = defaultTemplate('product', size) as ProductTemplate
    const items = Object.fromEntries(Object.entries(base.items).map(([k, v]) => [k, { ...v, visible: true }]))
    const t = { ...base, shopName: '다육농장'.repeat(2500).slice(0, 20), items }
    const r = renderProductLabel(env, t, { no: 9999, name: '왕비뇌신금'.repeat(2000), price: 99_999_000, date: '2026-12-31', buyer: { kind: 'youtube', name: '우주천사'.repeat(2500) } })
    if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`)
    expect(strayInk(r.image, r.layout)).toBe(0)
    expect(r.layout.items.map((i) => i.id).sort()).toEqual(['buyer', 'date', 'name', 'number', 'price', 'shop'])
  })
})

describe('AC-N1-12 작은 크기의 포장 라벨 — 어느 길로도 그림이 없다', () => {
  const data = { date: '2026-10-18', buyer: { kind: 'youtube', name: '우주천사' }, broadcasts: [{ title: '1부', numbers: [1, 2, 3] }], subtotal: 30000 }
  it.each(SMALL)('%s: 50×30 포장 템플릿의 size만 바꾼 것·JSON으로 읽은 것', (size) => {
    const t = { ...defaultTemplate('packing', '50x30'), size }
    const r = renderPackingLabels(env, t, data)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVALID_TEMPLATE')
    expect(JSON.stringify(r.error)).toContain(TEMPLATE_MESSAGES.packingSize)
    expect(r).not.toHaveProperty('pages')
    // JSON 왕복으로 몰래 들어와도 같다
    const json = templateToJson(defaultTemplate('packing', '50x30')).replace('"50x30"', JSON.stringify(size))
    const parsed = parseTemplateJson(json)
    expect(parsed.ok).toBe(false)
    expect(() => defaultTemplate('packing', size)).toThrow(RangeError)
  })
})

describe('AC-N1-13 작은 테스트 라벨', () => {
  it.each(SMALL)('%s: 테두리 네 변, 글자 20점 이상, 빠진 글자 없음', (size) => {
    const r = renderTestLabel(env, { size, shopName: '다육농장', date: '2026-10-18' })
    if (!r.ok) throw new Error(r.error.message)
    const { width, height } = r.image
    const count = (pts: [number, number][]): number => pts.filter(([x, y]) => getPixel(r.image, x, y)).length
    const row = (y: number): [number, number][] => Array.from({ length: width }, (_, x) => [x, y])
    const col = (x: number): [number, number][] => Array.from({ length: height }, (_, y) => [x, y])
    for (const line of [row(0), row(height - 1)]) expect(count(line)).toBeGreaterThanOrEqual(width * 0.9)
    for (const line of [col(0), col(width - 1)]) expect(count(line)).toBeGreaterThanOrEqual(height * 0.9)
    expect(r.layout.missing).toEqual([])
    for (const item of r.layout.items) expect(item.fontSize).toBeGreaterThanOrEqual(20)
  })
})

describe('AC-N1-22 테이프 라벨 그림 → 테이프 프로필 작업 바이트', () => {
  const tapes = MARKLIFE_PROFILES.filter((p) => p.rotate === 'CW90')
  it.each(TAPE_LABEL_SIZES as readonly LabelSizeId[])('%s: 모든 테이프 프로필에서 폭 칸 0C 00, 높이 = 라벨 길이 점, 줄을 되돌리면 라벨 그림', (size) => {
    const r = renderProductLabel(env, defaultTemplate('product', size), { no: 9999, name: '왕비뇌신금', price: 99_999_000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } })
    if (!r.ok) throw new Error(r.error.message)
    const img = r.image
    for (const profile of tapes) {
      const job = buildPrintJob(profile, img)
      if (!job.ok) throw new Error(`${profile.id} ${job.code}`)
      const head = 15 + 4
      expect([...job.bytes.subarray(head, head + 8)], profile.id).toEqual([0x1d, 0x76, 0x30, 0x00, 0x0c, 0x00, img.width & 0xff, img.width >> 8])
      const rows = job.bytes.subarray(head + 8, head + 8 + 12 * img.width)
      // 보낸 (x, y) = 받은 (y, H−1−x)
      for (let y = 0; y < img.width; y++)
        for (let x = 0; x < 96; x++) {
          const sent = (((rows[y * 12 + (x >> 3)] as number) >> (7 - (x & 7))) & 1) === 1
          if (sent !== getPixel(img, y, img.height - 1 - x)) throw new Error(`${profile.id} (${x}, ${y}) 다르다`)
        }
    }
  })
})
