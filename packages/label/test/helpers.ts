// 라벨 시험 도우미 — Node 렌더 환경, 배치 검사, 샘플 데이터.
import { expect } from 'vitest'
import { createNodeRenderEnv } from '../src/node.ts'
import { getPixel, splitGraphemes, type LabelBitmap, type LabelLayout, type LabelRenderEnv, type LayoutItem, type TemplateItem } from '../src/index.ts'

let env: LabelRenderEnv | undefined
export function nodeEnv(): LabelRenderEnv {
  env ??= createNodeRenderEnv()
  return env
}

/** 판매자 샘플 (G-LBL-001) */
export const SAMPLE_PRODUCT = { no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } } as const

/** 포장 라벨 보통 데이터 (G-LBL-101) */
export const SAMPLE_PACKING = {
  date: '2026-10-18',
  buyer: { kind: 'youtube', name: '우주천사' },
  broadcasts: [{ title: '1부', numbers: [31, 15, 28] }],
  subtotal: 30000,
} as const

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const inside = (r: Rect, x: number, y: number, pad = 0): boolean =>
  x >= r.x - pad && x < r.x + r.width + pad && y >= r.y - pad && y < r.y + r.height + pad

export function blackIn(image: LabelBitmap, r: Rect): number {
  let n = 0
  for (let y = Math.max(0, r.y); y < Math.min(image.height, r.y + r.height); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(image.width, r.x + r.width); x++) if (getPixel(image, x, y)) n++
  }
  return n
}

/** 검정 점 중 어느 상자(1점 넓힌)에도 들지 않는 점 수 */
export function strayInk(image: LabelBitmap, boxes: readonly Rect[]): { count: number; first?: [number, number] } {
  let count = 0
  let first: [number, number] | undefined
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!getPixel(image, x, y)) continue
      if (boxes.some((b) => inside(b, x, y, 1))) continue
      count++
      first ??= [x, y]
    }
  }
  return first ? { count, first } : { count }
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * AC-P1-12 배치 검사 (a)·(c)·(d)·(e)·(f). hidden = 끈 항목 상자.
 */
export function expectCleanLayout(image: LabelBitmap, layout: LabelLayout, hidden: readonly TemplateItem[] = [], minFont = 20): void {
  for (const item of layout.items) {
    // (a) 상자는 그림 안
    expect(item.box.x, item.id).toBeGreaterThanOrEqual(0)
    expect(item.box.y, item.id).toBeGreaterThanOrEqual(0)
    expect(item.box.x + item.box.width, item.id).toBeLessThanOrEqual(image.width)
    expect(item.box.y + item.box.height, item.id).toBeLessThanOrEqual(image.height)
    // (d) 빈 글이 아닌 항목 상자에는 잉크가 있다
    if (item.lines.join('').trim() !== '') expect(blackIn(image, item.box), item.id).toBeGreaterThan(0)
    // (f) 글자 크기
    expect(item.fontSize, item.id).toBeGreaterThanOrEqual(minFont)
  }
  // (c) 다른 곳에 잉크가 없다
  expect(strayInk(image, layout.items.map((i) => i.box))).toEqual({ count: 0 })
  // (e) 끈 항목 상자 안에는 잉크가 없다 (다른 항목 상자와 겹치지 않는 부분)
  for (const box of hidden) {
    let n = 0
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        if (getPixel(image, x, y) && !layout.items.some((i) => inside(i.box, x, y, 1))) n++
      }
    }
    expect(n).toBe(0)
  }
}

export function diffOutside(a: LabelBitmap, b: LabelBitmap, excluded: readonly Rect[]): number {
  let n = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (excluded.some((r) => inside(r, x, y, 1))) continue
      if (getPixel(a, x, y) !== getPixel(b, x, y)) n++
    }
  }
  return n
}

/** AC-P1-06: 배치 결과의 글 = 캡션 + 글 계산 값 + 꼬리 (다른 점은 L-5의 줄 나누기와 끝 `…`뿐) */
export function expectLayoutMatchesText(item: LayoutItem, value: string): void {
  expect(item.value, item.id).toBe(value)
  const lines = item.valueLines
  expect(item.lines[0]?.startsWith(item.caption), item.id).toBe(true)
  expect(item.lines.at(-1)?.endsWith(item.suffix), item.id).toBe(true)
  if (item.method === 'fit' || item.method === 'shrunk') {
    if (item.id === 'numbers') expect(lines.join(' ')).toBe(value)
    else {
      expect(lines).toEqual([value])
      expect(item.lines).toEqual([`${item.caption}${value}${item.suffix}`])
    }
  } else if (item.method === 'twoLines') {
    expect(lines).toHaveLength(2)
    const joined = value.includes(' ') ? lines.join(' ') : lines.join('')
    expect(joined).toBe(value)
  } else {
    const last = lines.at(-1) ?? ''
    expect(last.endsWith('…')).toBe(true)
    const shown = lines.join('').slice(0, -1)
    expect(value.startsWith(shown)).toBe(true)
    // 보이는 글자를 가르지 않는다
    const g = splitGraphemes(value)
    expect(splitGraphemes(shown)).toEqual(g.slice(0, splitGraphemes(shown).length))
  }
}

