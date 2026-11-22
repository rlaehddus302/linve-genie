// 그리기 (LABEL_RULES L-0 2·3, L-1, L-2 글꼴, L-5 글 맞추기, D-P1-04·06).
// 글 계산 결과만 받아 캔버스(주입)에 그리고 1비트 그림과 배치 결과를 돌려준다. 글을 새로 만들지 않는다 —
// 바꾸는 것은 L-5의 줄 나누기와 끝 `…`뿐이다. 내장 글꼴에 없는 글자는 캔버스에 맡기지 않고 빈 네모로 그린다
// (캔버스는 없는 글자를 시스템 글꼴로 대신 그리기 때문이다). 시각·난수·실행 환경 언어를 쓰지 않는다.
import { areaItem, productArea, safeMargin } from './captions.ts'
import { oneBitFromRgba, type LabelBitmap } from './bitmap.ts'
import type { PackingPage, PackingText, ProductText } from './compute.ts'
import { LABEL_MESSAGES, doesNotFitError, type LabelError } from './errors.ts'
import type { LabelFont } from './font.ts'
import { DEFAULT_LABEL_SIZE, isLabelSize, labelSizeInfo, type LabelSizeId } from './sizes.ts'
import { TEMPLATE_MESSAGES, type TemplateItem } from './template.ts'
import { SHOP_MARK_TEXT, formatLabelDate, formatLabelTime, isCalendarDate, splitGraphemes, trimLabelText } from './text.ts'

/** 캔버스 2D 문맥에서 이 패키지가 쓰는 부분 (브라우저 캔버스·OffscreenCanvas·Node 캔버스 모두 맞는다) */
export interface LabelCanvas2D {
  font: string
  fillStyle: unknown
  textAlign: string
  textBaseline: string
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): LabelTextMetrics
  getImageData(x: number, y: number, width: number, height: number): { readonly data: ArrayLike<number> }
}

export interface LabelTextMetrics {
  readonly width: number
  readonly actualBoundingBoxLeft?: number
  readonly actualBoundingBoxRight?: number
}

/** 렌더 환경 — 글꼴(내장 글꼴을 캔버스에 등록한 뒤의 정보)과 캔버스 만들기를 주입한다 (L-0 3) */
export interface LabelRenderEnv {
  readonly font: LabelFont
  createContext(width: number, height: number): LabelCanvas2D
}

export type FitMethod = 'fit' | 'shrunk' | 'twoLines' | 'truncated'

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 배치 결과의 항목 하나 (L-5) */
export interface LayoutItem {
  readonly id: string
  /** 템플릿 상자 */
  readonly box: Box
  /** 실제로 찍은 글자 크기 (점) */
  readonly fontSize: number
  readonly method: FitMethod
  /** 첫 줄 앞에 붙는 글 (`번호: `, `-` 등) */
  readonly caption: string
  /** 마지막 줄 뒤에 붙는 글 (`-`, `개` 등) */
  readonly suffix: string
  /** 글 계산 값 (그리기 전) */
  readonly value: string
  /** 줄마다 실제로 찍은 글 (첫 줄은 캡션 포함, 마지막 줄은 꼬리 포함) */
  readonly lines: readonly string[]
  /** 줄마다 찍은 값 부분 (말줄임표 포함) */
  readonly valueLines: readonly string[]
  /** 내장 글꼴에 없어 빈 네모로 그린 글자 (보이는 글자 단위, 나온 순서, 겹침 없음) */
  readonly missing: readonly string[]
}

export interface LabelLayout {
  readonly size: LabelSizeId
  readonly width: number
  readonly height: number
  readonly items: readonly LayoutItem[]
  /** 모든 항목의 missing을 모은 것 */
  readonly missing: readonly string[]
}

export interface RenderedLabel {
  readonly image: LabelBitmap
  readonly layout: LabelLayout
}

export type RenderResult<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: LabelError }

export const ELLIPSIS = '…'

type Mode = 'text' | 'name' | 'number' | 'list'
type Align = 'left' | 'center' | 'right'

interface ItemSpec {
  readonly id: string
  readonly box: TemplateItem
  readonly caption: string
  readonly suffix: string
  readonly value: string
  readonly mode: Mode
  readonly align: Align
  /** list 모드: 번호들 */
  readonly tokens?: readonly string[]
}

interface Segment {
  readonly text: string
  readonly missing: boolean
  readonly offset: number
  readonly advance: number
  readonly inkLeft: number
  readonly inkRight: number
}

interface LineMeasure {
  readonly advance: number
  /** 줄 시작에서 잉크 왼쪽 끝 (음수면 시작보다 왼쪽) */
  readonly inkLeft: number
  readonly inkRight: number
  readonly segments: readonly Segment[]
}

/** 줄을 놓을 때 필요한 폭 (왼쪽으로 삐져나온 잉크 포함) */
const extentOf = (m: LineMeasure): number => Math.max(m.advance, m.inkRight) - Math.min(0, m.inkLeft)

interface PlacedLine {
  readonly graphemes: readonly string[]
  /** 상자 왼쪽에서 줄 시작까지 (두 번째 줄 들여쓰기) */
  readonly indent: number
}

interface Placement {
  readonly size: number
  readonly method: FitMethod
  readonly lines: readonly PlacedLine[]
  readonly valueLines: readonly string[]
}

/** 빈 네모의 모양 (글자 크기에 비례, 정수 점) */
function boxGlyph(size: number): { advance: number; left: number; width: number; height: number; stroke: number } {
  return {
    advance: Math.round(size * 0.8),
    left: Math.round(size * 0.1),
    width: Math.round(size * 0.6),
    height: Math.round(size * 0.7),
    stroke: Math.max(2, Math.round(size / 12)),
  }
}

class Painter {
  private currentSize = 0
  private readonly missingCache = new Map<string, boolean>()

  readonly ctx: LabelCanvas2D
  readonly font: LabelFont

  constructor(ctx: LabelCanvas2D, font: LabelFont) {
    this.ctx = ctx
    this.font = font
  }

  setSize(size: number): void {
    if (size !== this.currentSize) {
      this.ctx.font = `${String(size)}px ${this.font.family}`
      this.currentSize = size
    }
  }

  lineHeight(size: number): number {
    return Math.ceil((this.font.ascent + this.font.descent) * size)
  }

  isMissing(grapheme: string): boolean {
    let missing = this.missingCache.get(grapheme)
    if (missing === undefined) {
      missing = false
      for (const ch of grapheme) {
        if (!this.font.hasCodePoint(ch.codePointAt(0) ?? 0)) {
          missing = true
          break
        }
      }
      this.missingCache.set(grapheme, missing)
    }
    return missing
  }

  measure(size: number, graphemes: readonly string[]): LineMeasure {
    this.setSize(size)
    const segments: Segment[] = []
    let offset = 0
    let inkLeft = 0
    let inkRight = 0
    let run = ''
    let first = true
    const flushRun = (): void => {
      if (run === '') return
      const m = this.ctx.measureText(run)
      const left = -(m.actualBoundingBoxLeft ?? 0)
      const right = m.actualBoundingBoxRight ?? m.width
      const seg = { text: run, missing: false, offset, advance: m.width, inkLeft: offset + left, inkRight: offset + right }
      segments.push(seg)
      if (first || seg.inkLeft < inkLeft) inkLeft = seg.inkLeft
      if (first || seg.inkRight > inkRight) inkRight = seg.inkRight
      first = false
      offset += m.width
      run = ''
    }
    const glyph = boxGlyph(size)
    for (const g of graphemes) {
      if (!this.isMissing(g)) {
        run += g
        continue
      }
      flushRun()
      const seg = { text: g, missing: true, offset, advance: glyph.advance, inkLeft: offset + glyph.left, inkRight: offset + glyph.left + glyph.width }
      segments.push(seg)
      if (first || seg.inkLeft < inkLeft) inkLeft = seg.inkLeft
      if (first || seg.inkRight > inkRight) inkRight = seg.inkRight
      first = false
      offset += glyph.advance
    }
    flushRun()
    return { advance: offset, inkLeft, inkRight, segments }
  }

  /** 맞추기용 폭: 줄 끝 공백은 잉크가 없으니 빼고 잰다 */
  extent(size: number, graphemes: readonly string[]): number {
    let end = graphemes.length
    while (end > 0 && graphemes[end - 1] === ' ') end--
    return extentOf(this.measure(size, end === graphemes.length ? graphemes : graphemes.slice(0, end)))
  }
}

const join = (parts: readonly string[]): string => parts.join('')

/** 위에서 내려오며 가장 큰 맞는 크기. 폭 비례 추정으로 시작해 몇 번만 잰다 */
function largestSize(min: number, max: number, fits: (size: number) => boolean, estimate: (size: number) => number): number | undefined {
  if (fits(max)) return max
  let s = Math.min(max - 1, Math.max(min, estimate(max)))
  if (s < min) return undefined
  if (fits(s)) {
    while (s + 1 < max && fits(s + 1)) s++
    return s
  }
  for (s = s - 1; s >= min; s--) if (fits(s)) return s
  return undefined
}

function placeItem(p: Painter, spec: ItemSpec): Placement | LabelError {
  const { box, caption, suffix, value } = spec
  const W = box.width
  const H = box.height
  const min = box.minFontSize
  const max = box.fontSize
  const cap = splitGraphemes(caption)
  const suf = splitGraphemes(suffix)

  if (spec.mode === 'list') return placeList(p, spec)

  const valueG = splitGraphemes(value)
  const single = [...cap, ...valueG, ...suf]
  const singleFits = (s: number): boolean => p.lineHeight(s) <= H && p.extent(s, single) <= W
  const estimate = (s: number): number => {
    const byWidth = Math.floor((s * W) / Math.max(1, p.extent(s, single)))
    const byHeight = Math.floor(H / (p.font.ascent + p.font.descent))
    return Math.min(byWidth, byHeight) + 1
  }
  const size = largestSize(min, max, singleFits, estimate)
  if (size !== undefined) {
    return { size, method: size === max ? 'fit' : 'shrunk', lines: [{ graphemes: single, indent: 0 }], valueLines: [value] }
  }
  if (spec.mode === 'number') return doesNotFitError(spec.id)

  if (spec.mode === 'name' && 2 * p.lineHeight(min) <= H) {
    const two = placeTwoLines(p, spec, cap, valueG)
    if (two) return two
    return truncateTwoLines(p, spec, cap, valueG)
  }
  return truncateOneLine(p, spec, cap, valueG, suf)
}

/** 품종 두 줄 (L-5 맞추기 2): 공백이 있으면 공백에서, 없으면 보이는 글자 사이에서 두 줄 폭 차가 가장 작은 곳 */
function placeTwoLines(p: Painter, spec: ItemSpec, cap: readonly string[], g: readonly string[]): Placement | undefined {
  const { box } = spec
  const min = box.minFontSize
  const W = box.width
  // 두 줄 모두 캡션 폭만큼 들여 쓴다(두 번째 줄은 값이 첫 줄 값 아래에서 시작)
  const capAdvance = (s: number): number => p.measure(s, cap).advance
  const avail = W - capAdvance(min)
  if (avail <= 0 || g.length < 2) return undefined
  // 아주 긴 품종은 두 줄로도 안 된다 — 나눌 곳을 찾지 않는다(1만 자 품종도 빨리 끝나게)
  if (p.measure(min, g).advance > 2 * avail * 1.1 + 2 * p.lineHeight(min)) return undefined

  const hasSpace = g.includes(' ')
  const cuts: number[] = []
  for (let i = 1; i < g.length; i++) {
    if (hasSpace ? g[i] === ' ' : true) cuts.push(i)
  }
  if (cuts.length === 0) return undefined
  const partsAt = (cut: number): [readonly string[], readonly string[]] =>
    hasSpace ? [g.slice(0, cut), g.slice(cut + 1)] : [g.slice(0, cut), g.slice(cut)]
  const diff = (cut: number): number => {
    const [a, b] = partsAt(cut)
    return p.extent(min, a) - p.extent(min, b)
  }
  // diff는 자르는 곳이 뒤로 갈수록 커진다 → 처음으로 0 이상이 되는 곳과 그 앞을 비교한다
  let lo = 0
  let hi = cuts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (diff(cuts[mid] as number) >= 0) hi = mid
    else lo = mid + 1
  }
  let best = cuts[lo] as number
  if (lo > 0) {
    const prev = cuts[lo - 1] as number
    if (Math.abs(diff(prev)) <= Math.abs(diff(best))) best = prev
  }
  const [a, b] = partsAt(best)
  const line1 = [...cap, ...a]
  const fits = (s: number): boolean => 2 * p.lineHeight(s) <= box.height && p.extent(s, line1) <= W && capAdvance(s) + p.extent(s, b) <= W
  const size = largestSize(min, box.fontSize, fits, (s) => {
    const widest = Math.max(p.extent(s, line1), capAdvance(s) + p.extent(s, b))
    return Math.min(Math.floor((s * W) / Math.max(1, widest)), Math.floor(box.height / 2 / (p.font.ascent + p.font.descent))) + 1
  })
  if (size === undefined) return undefined
  return {
    size,
    method: 'twoLines',
    lines: [
      { graphemes: line1, indent: 0 },
      { graphemes: b, indent: capAdvance(size) },
    ],
    valueLines: [join(a), join(b)],
  }
}

/** 맞는 가장 긴 앞부분의 길이 (0~n). make(k)가 상자에 맞는지로 이분 탐색한다 */
function longestPrefix(n: number, fits: (k: number) => boolean): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 품종: minFontSize 두 줄, 둘째 줄 끝을 `…`로 (L-5 맞추기 2) */
function truncateTwoLines(p: Painter, spec: ItemSpec, cap: readonly string[], g: readonly string[]): Placement | LabelError {
  const s = spec.box.minFontSize
  const W = spec.box.width
  if (p.extent(s, cap) > W) return doesNotFitError(spec.id)
  let k = longestPrefix(g.length, (n) => p.extent(s, [...cap, ...g.slice(0, n)]) <= W)
  while (k < g.length && g[k] === ' ') k++ // 줄 끝 공백은 첫 줄에 남긴다(보이지 않는다)
  const indent = p.measure(s, cap).advance
  const rest = g.slice(k)
  const m = longestPrefix(rest.length, (n) => indent + p.extent(s, [...rest.slice(0, n), ELLIPSIS]) <= W)
  if (indent + p.extent(s, [...rest.slice(0, m), ELLIPSIS]) > W) return doesNotFitError(spec.id)
  const second = [...rest.slice(0, m), ELLIPSIS]
  return {
    size: s,
    method: 'truncated',
    lines: [
      { graphemes: [...cap, ...g.slice(0, k)], indent: 0 },
      { graphemes: second, indent },
    ],
    valueLines: [join(g.slice(0, k)), join(second)],
  }
}

/** 가게 이름·닉네임·방송 제목(그리고 두 줄 자리가 없는 품종): minFontSize 한 줄, 끝을 `…`로 (L-5 맞추기 3) */
function truncateOneLine(p: Painter, spec: ItemSpec, cap: readonly string[], g: readonly string[], suf: readonly string[]): Placement | LabelError {
  const s = spec.box.minFontSize
  const W = spec.box.width
  if (p.lineHeight(s) > spec.box.height) return doesNotFitError(spec.id)
  const make = (n: number): string[] => [...cap, ...g.slice(0, n), ELLIPSIS, ...suf]
  const k = longestPrefix(g.length, (n) => p.extent(s, make(n)) <= W)
  if (p.extent(s, make(k)) > W) return doesNotFitError(spec.id)
  const shown = [...g.slice(0, k), ELLIPSIS]
  return { size: s, method: 'truncated', lines: [{ graphemes: make(k), indent: 0 }], valueLines: [join(shown)] }
}

/**
 * 번호 목록 (L-5 맞추기 4): `, ` 뒤와 옵션 항목 안의 공백에서만 줄을 바꾸고(글자 사이는 아님), minFontSize로도 안 맞으면 DOES_NOT_FIT.
 * 글을 공백으로 나눈 낱말을 앞에서부터 채운다 — 정수 번호만 있으면 낱말 = `번호,`라 O3 전의 `, ` 뒤 줄 바꿈과 같은 줄이 된다(AC-O3-02).
 * 옵션 항목 글(`22 105/검정색 ×2`)의 공백은 모두 그 항목 안의 공백이다.
 */
function placeList(p: Painter, spec: ItemSpec): Placement | LabelError {
  const tokens = spec.tokens ?? []
  const { box } = spec
  const words = tokens.flatMap((token, i) => {
    const parts = token.split(' ')
    if (i < tokens.length - 1) parts[parts.length - 1] = `${parts[parts.length - 1] as string},`
    return parts
  })
  const wrap = (s: number): string[] | undefined => {
    const lines: string[] = []
    let current: string[] = []
    for (const word of words) {
      const tryLine = [...current, word]
      if (p.extent(s, splitGraphemes(tryLine.join(' '))) <= box.width) {
        current = tryLine
        continue
      }
      if (current.length === 0) return undefined
      lines.push(current.join(' '))
      current = [word]
      if (p.extent(s, splitGraphemes(word)) > box.width) return undefined
    }
    if (current.length > 0) lines.push(current.join(' '))
    return lines.length * p.lineHeight(s) <= box.height ? lines : undefined
  }
  for (let s = box.fontSize; s >= box.minFontSize; s--) {
    const lines = wrap(s)
    if (lines) {
      return {
        size: s,
        method: s === box.fontSize ? 'fit' : 'shrunk',
        lines: lines.map((line) => ({ graphemes: splitGraphemes(line), indent: 0 })),
        valueLines: lines,
      }
    }
  }
  return doesNotFitError(spec.id)
}

function drawItem(p: Painter, spec: ItemSpec, placed: Placement): string[] {
  const { box } = spec
  const size = placed.size
  p.setSize(size)
  const lh = p.lineHeight(size)
  const top = box.y + Math.floor((box.height - lh * placed.lines.length) / 2)
  const ascent = Math.round(p.font.ascent * size)
  const glyph = boxGlyph(size)
  const missing: string[] = []
  placed.lines.forEach((line, i) => {
    const m = p.measure(size, line.graphemes)
    let fitWidth = extentOf(m)
    // 줄 끝 공백은 맞출 때 재지 않았으므로 놓을 때도 빼고 잰다
    let end = line.graphemes.length
    while (end > 0 && line.graphemes[end - 1] === ' ') end--
    if (end !== line.graphemes.length) fitWidth = extentOf(p.measure(size, line.graphemes.slice(0, end)))
    const shift = -Math.min(0, m.inkLeft)
    let start: number
    if (spec.align === 'center') start = box.x + Math.floor((box.width - fitWidth) / 2) + shift
    else if (spec.align === 'right') start = Math.max(box.x, Math.floor(box.x + box.width - fitWidth)) + shift
    else start = box.x + line.indent + shift
    start = Math.round(start)
    const baseline = top + i * lh + ascent
    for (const seg of m.segments) {
      const x = start + seg.offset
      if (!seg.missing) {
        p.ctx.fillText(seg.text, x, baseline)
        continue
      }
      if (!missing.includes(seg.text)) missing.push(seg.text)
      const bx = Math.round(x + glyph.left)
      const by = baseline - glyph.height
      p.ctx.fillRect(bx, by, glyph.width, glyph.stroke)
      p.ctx.fillRect(bx, baseline - glyph.stroke, glyph.width, glyph.stroke)
      p.ctx.fillRect(bx, by, glyph.stroke, glyph.height)
      p.ctx.fillRect(bx + glyph.width - glyph.stroke, by, glyph.stroke, glyph.height)
    }
  })
  return missing
}

interface DrawExtra {
  /** 그림 가장자리 네 줄을 지나는 테두리 두께 (테스트 라벨) */
  readonly cells?: readonly TemplateItem[]
  readonly border?: number
}

/** 항목을 맞추고 그린다. 하나라도 DOES_NOT_FIT이면 그림을 만들지 않는다 */
function renderSpecs(env: LabelRenderEnv, size: LabelSizeId, specs: readonly ItemSpec[], extra: DrawExtra = {}): RenderResult<RenderedLabel> {
  const { widthDots: width, heightDots: height } = labelSizeInfo(size)
  const ctx = env.createContext(width, height)
  const p = new Painter(ctx, env.font)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const placements: Placement[] = []
  for (const spec of specs) {
    const placed = placeItem(p, spec)
    if ('code' in placed) return { ok: false, error: placed }
    placements.push(placed)
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  for (const cell of extra.cells ?? []) {
    const { x, y, width: w, height: h } = cell
    ctx.fillRect(x, y, w, 1)
    ctx.fillRect(x, y + h - 1, w, 1)
    ctx.fillRect(x, y, 1, h)
    ctx.fillRect(x + w - 1, y, 1, h)
  }
  if (extra.border) {
    const b = extra.border
    ctx.fillRect(0, 0, width, b)
    ctx.fillRect(0, height - b, width, b)
    ctx.fillRect(0, 0, b, height)
    ctx.fillRect(width - b, 0, b, height)
  }
  const items: LayoutItem[] = []
  const allMissing: string[] = []
  specs.forEach((spec, i) => {
    const placed = placements[i] as Placement
    const missing = drawItem(p, spec, placed)
    for (const g of missing) if (!allMissing.includes(g)) allMissing.push(g)
    const lines = placed.lines.map((line) => join(line.graphemes))
    items.push({
      id: spec.id,
      box: { x: spec.box.x, y: spec.box.y, width: spec.box.width, height: spec.box.height },
      fontSize: placed.size,
      method: placed.method,
      caption: spec.caption,
      suffix: spec.suffix,
      value: spec.value,
      lines,
      valueLines: placed.valueLines,
      missing,
    })
  })
  const image = oneBitFromRgba(ctx.getImageData(0, 0, width, height).data, width, height)
  return { ok: true, image, layout: { size, width, height, items, missing: allMissing } }
}

/** 상품 라벨 항목의 캡션·꾸밈·맞추기 방식 (L-3 "찍는 글") */
const PRODUCT_SPEC = {
  shop: { caption: '-', suffix: '-', mode: 'text', align: 'center' },
  number: { caption: '번호: ', suffix: '', mode: 'number', align: 'left' },
  price: { caption: '가격: ', suffix: '', mode: 'number', align: 'left' },
  date: { caption: '', suffix: '', mode: 'number', align: 'right' },
  name: { caption: '품종: ', suffix: '', mode: 'name', align: 'left' },
  buyer: { caption: '닉네임: ', suffix: '', mode: 'text', align: 'left' },
  time: { caption: '', suffix: '', mode: 'number', align: 'right' },
} as const satisfies Record<string, { caption: string; suffix: string; mode: Mode; align: Align }>

/** 포장 라벨 항목 (L-4 "찍는 글") */
const PACKING_SPEC = {
  shop: { caption: '-', suffix: '-', mode: 'text', align: 'left' },
  page: { caption: '', suffix: '', mode: 'number', align: 'right' },
  buyer: { caption: '', suffix: '', mode: 'text', align: 'left' },
  date: { caption: '', suffix: '', mode: 'number', align: 'right' },
  broadcast: { caption: '', suffix: '', mode: 'text', align: 'left' },
  numbers: { caption: '', suffix: '', mode: 'list', align: 'left' },
  count: { caption: '상품 ', suffix: '개', mode: 'number', align: 'left' },
  subtotal: { caption: '상품 합계 ', suffix: '', mode: 'number', align: 'left' },
} as const satisfies Record<string, { caption: string; suffix: string; mode: Mode; align: Align }>

/** 상품 칸 하나의 그리기 설명: 안전 영역 안 칸(표형은 테두리 안쪽), 가게 이름 양옆 기호(D-LABEL-ITEMS-01) */
function productSpec(t: ProductText['template'], id: keyof typeof PRODUCT_SPEC, value: string, cellFor: (item: TemplateItem) => TemplateItem): ItemSpec {
  const cell = cellFor(t.items[id])
  const box = t.design === 'table' ? { ...cell, x: cell.x + 2, y: cell.y + 1, width: Math.max(1, cell.width - 4), height: Math.max(1, cell.height - 2) } : cell
  const [caption, suffix] = id === 'shop' ? SHOP_MARK_TEXT[t.shopMark ?? 'dash'] : [PRODUCT_SPEC[id].caption, PRODUCT_SPEC[id].suffix]
  return { id, box, value, ...PRODUCT_SPEC[id], caption, suffix }
}

/** 상품 라벨 그리기 — 글 계산 결과(computeProductText)만 받는다 */
export function renderProductText(env: LabelRenderEnv, text: ProductText): RenderResult<RenderedLabel> {
  const t = text.template
  const info = labelSizeInfo(t.size)
  const { widthDots, heightDots } = info
  // 종이 가장자리 1mm 안전 영역 안에만 그린다 (D-LABEL-SAFE-01)
  const { body, innerHeight, lines } = productArea(t.captions ?? [], widthDots, heightDots, safeMargin(info))
  const cellFor = (item: TemplateItem) => areaItem(item, widthDots, heightDots, body, innerHeight)
  const specs: ItemSpec[] = []
  for (const id of ['shop', 'number', 'price', 'date', 'name', 'buyer', 'time'] as const) {
    const value = text.items[id]
    if (value === undefined) continue
    specs.push(productSpec(t, id, value, cellFor))
  }
  for (const line of lines) {
    const box = { x: line.x, y: line.y, width: line.width, height: line.height, fontSize: 20, minFontSize: 12, visible: true }
    specs.push({ id: 'caption', box, value: line.text, caption: '', suffix: '', mode: 'text', align: line.left ? 'left' : 'right' })
  }
  return renderSpecs(env, t.size, specs, t.design === 'table' ? { cells: Object.values(t.items).filter((cell) => cell.visible).map(cellFor) } : {})
}

/** 칸의 가장 작은 폭·높이 (점, 템플릿 좌표 — 라벨 그림 전체 기준) */
export interface ItemMinSize {
  readonly width: number
  readonly height: number
}

/**
 * 켜진 상품 칸마다 가장 작은 칸 (D-LABEL-MINBOX-01, 사용자 지시 2026-11-23 "사이즈를 이상하게 줄였을때 칸이 좁아 만들수 없다고 띄우지 말고 걍 안 줄어들게 해").
 * 그 칸의 최소 글자 크기(minFontSize)로 이 글(견본 값)이 DOES_NOT_FIT 없이 한 줄에 들어가는 가장 작은 폭·높이를 재고,
 * 안전 영역·문구 줄 축소(areaItem)와 표형 테두리 안쪽(폭 4·높이 2)을 거꾸로 더해 템플릿 좌표로 돌려준다(반올림 여유 1점).
 * 숫자 칸(번호·가격 — 자르지 않음)은 값 전체, 자를 수 있는 글 칸(가게 이름·품종·닉네임)은 캡션 + 첫 글자 + `…`.
 * 날짜·시간은 날마다 값이 바뀌어 오늘 값에 맞춘 칸이 다른 날 DOES_NOT_FIT이 될 수 있다 — 그 표기에서 가장 넓은 값으로 잰다(AUTO).
 * 라벨보다 커야 들어가는 칸은 라벨 크기로 자른다. 시각·난수를 쓰지 않는 순수 계산이다(캔버스는 글자 폭 재기에만).
 */
export function minProductItemSizes(env: LabelRenderEnv, text: ProductText): Partial<Record<keyof typeof PRODUCT_SPEC, ItemMinSize>> {
  const t = text.template
  const info = labelSizeInfo(t.size)
  const { widthDots, heightDots } = info
  const { body, innerHeight } = productArea(t.captions ?? [], widthDots, heightDots, safeMargin(info))
  const cellFor = (item: TemplateItem) => areaItem(item, widthDots, heightDots, body, innerHeight)
  const p = new Painter(env.createContext(widthDots, heightDots), env.font)
  const sx = body.width / widthDots
  const sy = body.height / heightDots
  const [padX, padY] = t.design === 'table' ? [4, 2] : [0, 0]
  const out: Partial<Record<keyof typeof PRODUCT_SPEC, ItemMinSize>> = {}
  const BIG = 100_000
  for (const id of ['shop', 'number', 'price', 'date', 'name', 'buyer', 'time'] as const) {
    const value = text.items[id]
    if (value === undefined || sx <= 0 || sy <= 0) continue
    const spec = productSpec(t, id, value, cellFor)
    const min = spec.box.minFontSize
    const widest = id === 'date' ? widestOf(p, min, DATE_PROBES.map((d) => formatLabelDate(d, t.dateStyle))) : id === 'time' ? widestOf(p, min, TIME_PROBES.map((v) => formatLabelTime(v, t.timeStyle))) : value
    const g = splitGraphemes(widest)
    const probe: ItemSpec = spec.mode === 'number' ? { ...spec, value: widest } : { ...spec, mode: 'number', value: g.length > 1 ? `${g[0] as string}${ELLIPSIS}` : widest }
    const fits = (w: number, h: number): boolean => !('code' in placeItem(p, { ...probe, box: { ...probe.box, width: w, height: h, fontSize: min, minFontSize: min } }))
    if (!fits(BIG, BIG)) continue
    const height = smallest(BIG, (h) => fits(BIG, h))
    const width = smallest(BIG, (w) => fits(w, height))
    out[id] = {
      width: Math.min(widthDots, Math.ceil((width + padX) / sx) + 1),
      height: Math.min(heightDots, Math.ceil((height + padY) / sy) + 1),
    }
  }
  return out
}

// 넓은 숫자(0·4·8 등)로 지은 날짜·시각 후보 — 2000~2099 날짜·24시간 시각 중 가장 넓은 것이 이 안에 있다(내장 글꼴, D-STB-01 `04.04.04`)
const WIDE_DIGITS = ['00', '04', '08', '20', '24', '28', '30', '40', '44', '48', '80', '84', '88'] as const
const DATE_PROBES: readonly string[] = WIDE_DIGITS.flatMap((yy) => ['02', '04', '08', '10', '12'].flatMap((mm) => ['04', '08', '20', '24', '28', '30'].map((dd) => `20${yy}-${mm}-${dd}`))).filter(isCalendarDate)
const TIME_PROBES: readonly string[] = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).flatMap((hh) => ['00', '04', '08', '20', '24', '28', '40', '44', '48', '50', '58'].map((mm) => `${hh}:${mm}`))

/** 후보 중 그 글자 크기로 가장 넓은 글 */
function widestOf(p: Painter, size: number, values: readonly string[]): string {
  let best = values[0] ?? ''
  let width = -1
  for (const value of values) {
    const w = p.extent(size, splitGraphemes(value))
    if (w > width) {
      width = w
      best = value
    }
  }
  return best
}

/** 1..max 중 fits가 참인 가장 작은 정수 (fits는 커질수록 참이 되는 것) */
function smallest(max: number, fits: (n: number) => boolean): number {
  let lo = 1
  let hi = max
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (fits(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** 포장 라벨 한 쪽 그리기 */
export function renderPackingPage(env: LabelRenderEnv, text: PackingText, page: PackingPage): RenderResult<RenderedLabel> {
  const t = text.template
  const specs: ItemSpec[] = []
  const values: Record<string, string | undefined> = {
    shop: text.common.shop,
    page: page.page,
    buyer: text.common.buyer,
    date: text.common.date,
    broadcast: page.broadcast,
    numbers: page.numbers.join(', '),
    count: text.common.count,
    subtotal: text.common.subtotal,
  }
  for (const id of ['shop', 'page', 'buyer', 'date', 'broadcast', 'numbers', 'count', 'subtotal'] as const) {
    const value = values[id]
    if (value === undefined) continue
    const spec: ItemSpec = { id, box: t.items[id], value, ...PACKING_SPEC[id] }
    specs.push(id === 'numbers' ? { ...spec, tokens: page.numbers.map(String) } : spec)
  }
  return renderSpecs(env, t.size, specs)
}

/** 포장 라벨 모든 쪽 그리기. 한 쪽이라도 DOES_NOT_FIT이면 아무 쪽도 만들지 않는다 */
export function renderPackingText(env: LabelRenderEnv, text: PackingText): RenderResult<{ readonly pages: readonly RenderedLabel[] }> {
  const pages: RenderedLabel[] = []
  for (const page of text.pages) {
    const rendered = renderPackingPage(env, text, page)
    if (!rendered.ok) return rendered
    pages.push({ image: rendered.image, layout: rendered.layout })
  }
  return { ok: true, pages }
}

/** 테스트 라벨 글 (L-7 테스트 라벨, LBL-06 AC1) */
export const TEST_LABEL_TITLE = '테스트 라벨'
export const TEST_LABEL_HANGUL = '한글 확인: 가나다 똠햏 ㄱㄴㄷ'
export const TEST_LABEL_DIGITS = '0123456789'
/** 작은 크기(L-1)의 테스트 라벨 한글 확인 글 — 둘째 줄은 `0123456789 <YY.MM.DD>` (L-7, N1) */
export const TEST_LABEL_SMALL_HANGUL = '한글 확인: 가나다 똠햏'
/** 작은 크기 테스트 라벨의 가장 작은 글자 크기 (점) — 높이 96~120점에 20점 이상으로 들어간다 */
const SMALL_TEST_MIN_FONT = 20
/** 테스트 라벨 테두리 두께 (점) */
export const TEST_LABEL_BORDER = 2

export interface TestLabelInput {
  /** 가게 이름 (다듬어 찍는다. 비면 줄을 빼고 그린다) */
  readonly shopName: string
  /** 받은 날짜 `YYYY-MM-DD` — 이 함수는 시계를 읽지 않는다 */
  readonly date: string
  readonly size?: LabelSizeId
}

/**
 * 테스트 라벨 (연결 마법사의 테스트 인쇄): 가게 이름, `테스트 라벨`, 한글 확인 글, 숫자, 날짜(`YY.MM.DD`),
 * 그림의 맨 위·맨 아래·맨 왼쪽·맨 오른쪽 줄을 지나는 테두리. 맨 아래 테두리가 찍히면 마지막 줄 대응이 된 것이다(HG-2).
 * 작은 크기(50×15·테이프)는 `한글 확인: 가나다 똠햏`과 `0123456789 <날짜>` 두 줄과 같은 테두리만 찍는다(L-7, N1).
 */
export function renderTestLabel(env: LabelRenderEnv, input: TestLabelInput): RenderResult<RenderedLabel> {
  if (typeof input.date !== 'string' || !isCalendarDate(input.date)) {
    return { ok: false, error: { code: 'INVALID_DATA', message: '라벨에 넣을 수 없는 값이 있어요: 날짜', field: 'date' } }
  }
  const size: unknown = input.size === undefined ? DEFAULT_LABEL_SIZE : input.size
  // L-1 목록 밖의 크기는 쓰지 않는다 — 템플릿 검사와 같은 오류·문장으로 알린다(그림을 만들지 않고, 던지지 않는다)
  if (!isLabelSize(size)) {
    return { ok: false, error: { code: 'INVALID_TEMPLATE', message: LABEL_MESSAGES.invalidTemplate, problems: [{ path: 'size', message: TEMPLATE_MESSAGES.size }] } }
  }
  const { widthDots: width, heightDots: height, small } = labelSizeInfo(size)
  const inset = TEST_LABEL_BORDER + 4
  if (small) {
    const rowHeight = Math.floor((height - 2 * inset) / 2)
    const fontSize = Math.max(SMALL_TEST_MIN_FONT, Math.min(32, Math.floor(rowHeight / (env.font.ascent + env.font.descent))))
    const smallRows = [
      { id: 'check', value: TEST_LABEL_SMALL_HANGUL },
      { id: 'digits', value: `${TEST_LABEL_DIGITS} ${formatLabelDate(input.date)}` },
    ]
    const smallSpecs: ItemSpec[] = smallRows.map((row, i) => ({
      id: row.id,
      box: { visible: true, x: inset, y: inset + i * rowHeight, width: width - 2 * inset, height: rowHeight, fontSize, minFontSize: SMALL_TEST_MIN_FONT },
      caption: '',
      suffix: '',
      value: row.value,
      mode: 'number',
      align: 'center',
    }))
    return renderSpecs(env, size, smallSpecs, { border: TEST_LABEL_BORDER })
  }
  const shop = trimLabelText(typeof input.shopName === 'string' ? input.shopName : '')
  const rows: { id: string; value: string; mode: Mode }[] = [
    ...(shop === '' ? [] : [{ id: 'shop', value: shop, mode: 'text' as const }]),
    { id: 'title', value: TEST_LABEL_TITLE, mode: 'number' },
    { id: 'check', value: TEST_LABEL_HANGUL, mode: 'number' },
    { id: 'digits', value: TEST_LABEL_DIGITS, mode: 'number' },
    { id: 'date', value: formatLabelDate(input.date), mode: 'number' },
  ]
  const rowHeight = Math.floor((height - 2 * inset) / 5)
  const fontSize = Math.max(16, Math.min(32, Math.floor(rowHeight / (env.font.ascent + env.font.descent))))
  const specs: ItemSpec[] = rows.map((row, i) => ({
    id: row.id,
    box: { visible: true, x: inset, y: inset + i * rowHeight, width: width - 2 * inset, height: rowHeight, fontSize, minFontSize: Math.min(fontSize, 16) },
    caption: '',
    suffix: '',
    value: row.value,
    mode: row.mode,
    align: 'center',
  }))
  return renderSpecs(env, size, specs, { border: TEST_LABEL_BORDER })
}
