// 라벨 템플릿 — JSON 모델·검사·크기마다 기본 템플릿 (LABEL_RULES L-5, D-P1-06, AC-P1-20).
// 위치·크기·글자 크기는 모두 점(1mm = 8점) 단위, 상자 왼쪽 위 기준이다.
import { ITEM_NAMES, LABEL_MESSAGES, type LabelError, type TemplateProblem } from './errors.ts'
import { DEFAULT_LABEL_SIZE, LABEL_SIZES, isLabelSize, labelSizeInfo, type LabelSizeId } from './sizes.ts'
import { PRICE_STYLES, type PriceStyle } from './text.ts'

export const TEMPLATE_FORMAT = 1 as const

export const PRODUCT_ITEMS = ['shop', 'number', 'price', 'date', 'name', 'buyer'] as const
export const PACKING_ITEMS = ['shop', 'date', 'buyer', 'page', 'broadcast', 'count', 'subtotal', 'numbers'] as const
export type ProductItemId = (typeof PRODUCT_ITEMS)[number]
export type PackingItemId = (typeof PACKING_ITEMS)[number]

/** 끌 수 없는 항목 (L-3·L-4 표) */
export const PRODUCT_LOCKED: readonly ProductItemId[] = ['number', 'buyer']
export const PACKING_LOCKED: readonly PackingItemId[] = ['buyer', 'page', 'broadcast', 'numbers']

/** 글자 크기 범위 (점) */
export const FONT_SIZE_MIN = 16
export const FONT_SIZE_MAX = 120
/** 포장 라벨 한 쪽 번호 수 범위 */
export const PER_PAGE_MIN = 1
export const PER_PAGE_MAX = 40

export interface TemplateItem {
  readonly visible: boolean
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fontSize: number
  readonly minFontSize: number
}

const ITEM_KEYS = ['visible', 'x', 'y', 'width', 'height', 'fontSize', 'minFontSize'] as const

export interface ProductTemplate {
  readonly format: 1
  readonly kind: 'product'
  readonly size: LabelSizeId
  /** 가게 이름 (머리글). 기본은 빈 글 — 판매자가 정한다 */
  readonly shopName: string
  readonly priceStyle: PriceStyle
  readonly items: Readonly<Record<ProductItemId, TemplateItem>>
}

export interface PackingTemplate {
  readonly format: 1
  readonly kind: 'packing'
  readonly size: LabelSizeId
  readonly shopName: string
  /** 한 쪽에 찍는 번호 수 (1~40) */
  readonly perPage: number
  readonly items: Readonly<Record<PackingItemId, TemplateItem>>
}

export type LabelTemplate = ProductTemplate | PackingTemplate

const item = (x: number, y: number, width: number, height: number, fontSize: number, minFontSize = 20): TemplateItem => ({
  visible: true,
  x,
  y,
  width,
  height,
  fontSize,
  minFontSize,
})

// 기본 상품 템플릿 — 판매자 샘플 배치(L-3): 맨 위 가운데 가게 이름, 둘째 줄 왼쪽부터 번호·가격·날짜, 셋째 줄 품종(두 줄 자리), 넷째 줄 닉네임.
// 둘째 줄은 최악의 값(번호: 9999 · 가격: 99,999,999원 · 26.10.08)이 20점으로 들어가는 폭이다(AC-P1-14).
const PRODUCT_DEFAULT_ITEMS: Record<LabelSizeId, Record<ProductItemId, TemplateItem>> = {
  '50x30': {
    shop: item(72, 6, 240, 38, 28),
    number: item(4, 48, 100, 36, 24),
    price: item(108, 48, 180, 36, 24),
    date: item(292, 48, 88, 36, 24),
    name: item(4, 88, 376, 88, 28, 22),
    buyer: item(4, 180, 376, 54, 28),
  },
  '50x20': {
    shop: item(72, 3, 240, 30, 24),
    number: item(4, 35, 100, 30, 22),
    price: item(108, 35, 180, 30, 22),
    date: item(292, 35, 88, 30, 22),
    name: item(4, 67, 376, 56, 24),
    buyer: item(4, 125, 376, 32, 24),
  },
  '50x40': {
    shop: item(72, 8, 240, 44, 32),
    number: item(4, 58, 100, 40, 26),
    price: item(108, 58, 180, 40, 26),
    date: item(292, 58, 88, 40, 26),
    name: item(4, 104, 376, 124, 36, 26),
    buyer: item(4, 234, 376, 78, 32),
  },
}

// 기본 포장 템플릿 (L-4): 첫 줄 가게 이름·쪽, 둘째 줄 구매자·날짜, 셋째 줄 방송 제목, 번호 목록, 끝 줄 상품 수·상품 합계.
// 번호 목록 상자는 네 자리 번호 perPage개가 20점으로 들어가는 크기다(AC-P1-14).
const PACKING_DEFAULT_ITEMS: Record<LabelSizeId, Record<PackingItemId, TemplateItem>> = {
  '50x30': {
    shop: item(4, 4, 268, 32, 24),
    page: item(276, 4, 104, 32, 24),
    buyer: item(4, 38, 268, 32, 24),
    date: item(276, 38, 104, 32, 22),
    broadcast: item(4, 72, 376, 28, 22),
    numbers: item(4, 102, 376, 100, 26),
    count: item(4, 206, 112, 30, 22),
    subtotal: item(120, 206, 260, 30, 22),
  },
  '50x20': {
    shop: item(4, 2, 268, 25, 20),
    page: item(276, 2, 104, 25, 20),
    buyer: item(4, 28, 268, 25, 20),
    date: item(276, 28, 104, 25, 20),
    broadcast: item(4, 54, 376, 25, 20),
    numbers: item(4, 80, 376, 52, 22),
    count: item(4, 133, 112, 25, 20),
    subtotal: item(120, 133, 260, 25, 20),
  },
  '50x40': {
    shop: item(4, 6, 268, 36, 28),
    page: item(276, 6, 104, 36, 24),
    buyer: item(4, 44, 268, 36, 28),
    date: item(276, 44, 104, 36, 24),
    broadcast: item(4, 82, 376, 32, 24),
    numbers: item(4, 116, 376, 158, 28),
    count: item(4, 278, 112, 34, 24),
    subtotal: item(120, 278, 260, 34, 24),
  },
}

/** 크기마다 기본 포장 라벨 한 쪽 번호 수 (50×30은 10 — D-P1-05) */
export const DEFAULT_PER_PAGE: Readonly<Record<LabelSizeId, number>> = { '50x30': 10, '50x20': 8, '50x40': 16 }

/** 기본 템플릿 (크기마다 상품·포장 한 벌). 기본 가게 이름은 빈 글, 기본 가격 표기는 THOUSAND */
export function defaultTemplate(kind: 'product', size?: LabelSizeId): ProductTemplate
export function defaultTemplate(kind: 'packing', size?: LabelSizeId): PackingTemplate
export function defaultTemplate(kind: 'product' | 'packing', size?: LabelSizeId): LabelTemplate
export function defaultTemplate(kind: 'product' | 'packing', size: LabelSizeId = DEFAULT_LABEL_SIZE): LabelTemplate {
  if (kind === 'product') {
    return { format: TEMPLATE_FORMAT, kind, size, shopName: '', priceStyle: 'THOUSAND', items: { ...PRODUCT_DEFAULT_ITEMS[size] } }
  }
  return { format: TEMPLATE_FORMAT, kind, size, shopName: '', perPage: DEFAULT_PER_PAGE[size], items: { ...PACKING_DEFAULT_ITEMS[size] } }
}

/** 받침이 있으면 앞, 없으면 뒤 (은/는, 이/가) */
function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charCodeAt(word.length - 1)
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0
  return `${word}${hasFinal ? withFinal : withoutFinal}`
}

const itemName = (id: string): string => ITEM_NAMES[id] ?? id

export const TEMPLATE_MESSAGES = {
  notObject: '라벨 설정 형식을 읽을 수 없어요.',
  format: '라벨 설정 형식을 읽을 수 없어요.',
  kind: '라벨 종류를 읽을 수 없어요.',
  unknownKey: '라벨 설정에 알 수 없는 값이 있어요.',
  missingKey: '라벨 설정에 빠진 값이 있어요.',
  size: `쓸 수 없는 라벨 크기예요. ${LABEL_SIZES.map((s) => s.replace('x', '×')).join(', ')} 중에서 골라 주세요.`,
  shopName: '가게 이름을 다시 적어 주세요.',
  priceStyle: '가격 표기 방법을 다시 골라 주세요.',
  perPage: `한 장에 넣을 번호 수는 ${String(PER_PAGE_MIN)}~${String(PER_PAGE_MAX)} 사이로 정해 주세요.`,
  locked: (id: string) => `${josa(itemName(id), '은', '는')} 끌 수 없어요.`,
  missingItem: (id: string) => `${itemName(id)} 칸 설정이 없어요.`,
  badItem: (id: string) => `${itemName(id)} 칸 설정을 읽을 수 없어요.`,
  badBox: (id: string) => `${itemName(id)} 칸의 위치나 크기가 올바르지 않아요.`,
  outside: (id: string) => `${itemName(id)} 칸이 라벨 밖으로 나갔어요.`,
  fontSize: (id: string) => `${itemName(id)} 글자 크기는 ${String(FONT_SIZE_MIN)}~${String(FONT_SIZE_MAX)} 사이로 정해 주세요.`,
  minAboveMax: (id: string) => `${itemName(id)} 최소 글자 크기가 글자 크기보다 커요.`,
  overlap: (a: string, b: string) => `${itemName(a)} 칸과 ${itemName(b)} 칸이 겹쳐요.`,
} as const

export type TemplateCheck<T extends LabelTemplate = LabelTemplate> =
  | { readonly ok: true; readonly template: T; readonly warnings: readonly TemplateProblem[] }
  | { readonly ok: false; readonly error: LabelError; readonly warnings: readonly TemplateProblem[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

function checkItem(id: string, value: unknown, locked: boolean, labelW: number, labelH: number, problems: TemplateProblem[]): TemplateItem | undefined {
  const path = `items.${id}`
  if (!isPlainObject(value)) {
    problems.push({ path, message: TEMPLATE_MESSAGES.badItem(id) })
    return undefined
  }
  for (const key of Object.keys(value)) {
    if (!(ITEM_KEYS as readonly string[]).includes(key)) problems.push({ path: `${path}.${key}`, message: TEMPLATE_MESSAGES.unknownKey })
  }
  for (const key of ITEM_KEYS) if (!Object.hasOwn(value, key)) problems.push({ path: `${path}.${key}`, message: TEMPLATE_MESSAGES.badItem(id) })
  const { visible, x, y, width, height, fontSize, minFontSize } = value
  let ok = true
  if (typeof visible !== 'boolean') {
    problems.push({ path: `${path}.visible`, message: TEMPLATE_MESSAGES.badItem(id) })
    ok = false
  } else if (!visible && locked) {
    problems.push({ path: `${path}.visible`, message: TEMPLATE_MESSAGES.locked(id) })
    ok = false
  }
  if (!isInt(x) || !isInt(y) || !isInt(width) || !isInt(height) || width < 1 || height < 1) {
    problems.push({ path, message: TEMPLATE_MESSAGES.badBox(id) })
    ok = false
  } else if (x < 0 || y < 0 || x + width > labelW || y + height > labelH) {
    problems.push({ path, message: TEMPLATE_MESSAGES.outside(id) })
    ok = false
  }
  const sizeOk = (v: unknown): v is number => isInt(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX
  if (!sizeOk(fontSize)) {
    problems.push({ path: `${path}.fontSize`, message: TEMPLATE_MESSAGES.fontSize(id) })
    ok = false
  }
  if (!sizeOk(minFontSize)) {
    problems.push({ path: `${path}.minFontSize`, message: TEMPLATE_MESSAGES.fontSize(id) })
    ok = false
  } else if (sizeOk(fontSize) && minFontSize > fontSize) {
    problems.push({ path: `${path}.minFontSize`, message: TEMPLATE_MESSAGES.minAboveMax(id) })
    ok = false
  }
  if (!ok) return undefined
  return { visible: visible as boolean, x: x as number, y: y as number, width: width as number, height: height as number, fontSize: fontSize as number, minFontSize: minFontSize as number }
}

function overlaps(a: TemplateItem, b: TemplateItem): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * 템플릿 검사 (L-5). 모르는 칸, 목록 밖 크기, 끌 수 없는 항목 끄기, 라벨 밖 상자, 글자 크기 16~120 밖, 최소 > 글자 크기,
 * perPage 1~40 밖, 모르는 가격 표기를 INVALID_TEMPLATE으로 알린다(문제마다 쉬운 한국어 한 문장). 켠 상자끼리 겹치면 경고다.
 * 받은 값을 바꾸지 않고, 통과하면 새 템플릿 객체를 돌려준다.
 */
export function validateTemplate(value: unknown): TemplateCheck {
  const problems: TemplateProblem[] = []
  const warnings: TemplateProblem[] = []
  const fail = (): TemplateCheck => ({ ok: false, error: { code: 'INVALID_TEMPLATE', message: LABEL_MESSAGES.invalidTemplate, problems }, warnings })
  if (!isPlainObject(value)) {
    problems.push({ path: '', message: TEMPLATE_MESSAGES.notObject })
    return fail()
  }
  const kind = value.kind
  if (kind !== 'product' && kind !== 'packing') {
    problems.push({ path: 'kind', message: TEMPLATE_MESSAGES.kind })
    return fail()
  }
  const allowed = ['format', 'kind', 'size', 'shopName', 'items', kind === 'product' ? 'priceStyle' : 'perPage']
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push({ path: key, message: TEMPLATE_MESSAGES.unknownKey })
  for (const key of allowed) if (!Object.hasOwn(value, key)) problems.push({ path: key, message: TEMPLATE_MESSAGES.missingKey })
  if (value.format !== TEMPLATE_FORMAT) problems.push({ path: 'format', message: TEMPLATE_MESSAGES.format })
  const size = value.size
  if (!isLabelSize(size)) problems.push({ path: 'size', message: TEMPLATE_MESSAGES.size })
  if (typeof value.shopName !== 'string') problems.push({ path: 'shopName', message: TEMPLATE_MESSAGES.shopName })
  if (kind === 'product') {
    if (!(PRICE_STYLES as readonly unknown[]).includes(value.priceStyle)) problems.push({ path: 'priceStyle', message: TEMPLATE_MESSAGES.priceStyle })
  } else if (!isInt(value.perPage) || value.perPage < PER_PAGE_MIN || value.perPage > PER_PAGE_MAX) {
    problems.push({ path: 'perPage', message: TEMPLATE_MESSAGES.perPage })
  }
  const ids: readonly string[] = kind === 'product' ? PRODUCT_ITEMS : PACKING_ITEMS
  const lockedIds: readonly string[] = kind === 'product' ? PRODUCT_LOCKED : PACKING_LOCKED
  const items: Record<string, TemplateItem> = {}
  if (!isPlainObject(value.items)) {
    problems.push({ path: 'items', message: TEMPLATE_MESSAGES.notObject })
  } else {
    // 크기를 모르면 라벨 밖 검사는 가장 큰 크기로 한다 (크기 오류는 이미 알렸다)
    const info = labelSizeInfo(isLabelSize(size) ? size : '50x40')
    for (const key of Object.keys(value.items)) if (!ids.includes(key)) problems.push({ path: `items.${key}`, message: TEMPLATE_MESSAGES.unknownKey })
    for (const id of ids) {
      if (!Object.hasOwn(value.items, id)) {
        problems.push({ path: `items.${id}`, message: TEMPLATE_MESSAGES.missingItem(id) })
        continue
      }
      const checked = checkItem(id, value.items[id], lockedIds.includes(id), info.widthDots, info.heightDots, problems)
      if (checked) items[id] = checked
    }
    const shown = ids.filter((id) => items[id]?.visible === true)
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i] as string
        const b = shown[j] as string
        if (overlaps(items[a] as TemplateItem, items[b] as TemplateItem)) warnings.push({ path: `items.${a}`, message: TEMPLATE_MESSAGES.overlap(a, b) })
      }
    }
  }
  if (problems.length > 0) return fail()
  const base = { format: TEMPLATE_FORMAT, size: size as LabelSizeId, shopName: value.shopName as string }
  const template: LabelTemplate =
    kind === 'product'
      ? { ...base, kind, priceStyle: value.priceStyle as PriceStyle, items: items as Record<ProductItemId, TemplateItem> }
      : { ...base, kind, perPage: value.perPage as number, items: items as Record<PackingItemId, TemplateItem> }
  return { ok: true, template, warnings }
}

/** 템플릿을 JSON 글로 (저장용). 칸 순서가 정해져 있어 같은 템플릿이면 같은 글이다 */
export function templateToJson(template: LabelTemplate): string {
  const ids: readonly string[] = template.kind === 'product' ? PRODUCT_ITEMS : PACKING_ITEMS
  const items: Record<string, TemplateItem> = {}
  for (const id of ids) {
    const it = (template.items as Record<string, TemplateItem>)[id]
    if (it) items[id] = { visible: it.visible, x: it.x, y: it.y, width: it.width, height: it.height, fontSize: it.fontSize, minFontSize: it.minFontSize }
  }
  const head =
    template.kind === 'product'
      ? { format: template.format, kind: template.kind, size: template.size, shopName: template.shopName, priceStyle: template.priceStyle }
      : { format: template.format, kind: template.kind, size: template.size, shopName: template.shopName, perPage: template.perPage }
  return JSON.stringify({ ...head, items })
}

/** JSON 글을 읽어 검사한다 */
export function parseTemplateJson(text: string): TemplateCheck {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: { code: 'INVALID_TEMPLATE', message: LABEL_MESSAGES.invalidTemplate, problems: [{ path: '', message: TEMPLATE_MESSAGES.notObject }] },
      warnings: [],
    }
  }
  return validateTemplate(value)
}
