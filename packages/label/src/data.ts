// 라벨 데이터 형식과 입력 검사 (LABEL_RULES L-0 4, L-3·L-4 데이터 표, R-11, D-P1-03·05).
// 표에 없는 칸이 하나라도 있으면 INVALID_DATA — 문자찜의 메모·전화번호가 라벨로 새는 길을 형식으로 막는다.
import { invalidDataError, type LabelError } from './errors.ts'
import { isCalendarDate, trimLabelText } from './text.ts'

/** 구매자: 유튜브는 닉네임, 문자찜은 종류 하나뿐 — 메모·전화번호·이름을 담을 칸이 없다 (AC-P1-04) */
export type LabelBuyer = { readonly kind: 'youtube'; readonly name: string } | { readonly kind: 'sms' }

/** 상품 라벨 데이터 (L-3) */
export interface ProductLabelData {
  /** 상품 번호, 정수 1~9999 */
  readonly no: number
  /** 품종 (비어도 된다) */
  readonly name: string
  /** 가격, 0 이상 안전한 정수 원 (찜의 가격 스냅샷 — L-9) */
  readonly price: number
  /** 방송 날짜 `YYYY-MM-DD` */
  readonly date: string
  readonly buyer: LabelBuyer
  /** 옵션 글 (O3, D-O3-01 — 코어 ClaimInfo.variant). 검사를 통과한 데이터에는 옵션이 있을 때만 있다 */
  readonly variant?: string | null
  /** 수량 1~99 (O3, D-O3-01). 없으면 1. 검사를 통과한 데이터에는 2 이상일 때만 있다 */
  readonly qty?: number
}

/** 포장 라벨의 옵션 항목 (L-4, O3 — D-O3-03). 옵션 글 없고 수량 1이면 정수 번호와 같다 */
export interface PackingEntryObject {
  readonly no: number
  readonly variant?: string | null
  readonly qty?: number
}

/** 포장 라벨 번호 목록의 항목: 상품 번호 또는 옵션 항목 */
export type PackingEntry = number | PackingEntryObject

/** 포장 라벨의 방송 하나 (L-4) */
export interface PackingBroadcast {
  readonly title: string
  /**
   * 그 방송에서 이 구매자가 1등인 상품의 항목 (1개 이상, 같은 (번호, 다듬은 옵션 글)이 겹치지 않음).
   * 검사를 통과한 데이터에서는 옵션 없는 수량 1 항목이 정수 번호다
   */
  readonly numbers: readonly PackingEntry[]
}

/** 포장 라벨 데이터 (L-4) */
export interface PackingLabelData {
  /** 묶음 날짜 `YYYY-MM-DD` */
  readonly date: string
  readonly buyer: LabelBuyer
  /** 그날 방송 선언 순서대로 */
  readonly broadcasts: readonly PackingBroadcast[]
  /** 상품 합계 — 코어 정산 결과를 그대로 받는다 */
  readonly subtotal: number
}

export type LabelKind = 'product' | 'packing'

type Checked<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: LabelError }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 정해진 칸만 있는지. 처음 만난 모르는 칸(또는 빠진 칸)의 경로를 돌려준다 */
function checkKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string): string | undefined {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return `${prefix}${key}`
  for (const key of allowed) if (!Object.hasOwn(value, key)) return `${prefix}${key}`
  return undefined
}

const isLabelNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999
const isWon = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
/** 수량 (O3, D-O3-01): 정수 1~99 */
const isQty = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99

/** 옵션 글·수량 선택 칸 검사 (L-3 표, D-O3-01). variant: 없음·null = 옵션 없음, 글이면 다듬어 비지 않아야. qty: 없음 = 1, 있으면 정수 1~99 */
function checkOptionFields(value: Record<string, unknown>, prefix: string): { ok: true; variant: string | null; qty: number } | { ok: false; error: LabelError } {
  let variant: string | null = null
  if (Object.hasOwn(value, 'variant') && value.variant !== null) {
    if (typeof value.variant !== 'string' || trimLabelText(value.variant) === '') return { ok: false, error: invalidDataError(`${prefix}variant`) }
    variant = value.variant
  }
  let qty = 1
  if (Object.hasOwn(value, 'qty')) {
    if (!isQty(value.qty)) return { ok: false, error: invalidDataError(`${prefix}qty`) }
    qty = value.qty
  }
  return { ok: true, variant, qty }
}

/** 선택 칸이 있어도 되는 칸 검사: 모르는 칸이 있거나 꼭 있어야 할 칸이 없으면 그 경로 */
function checkKeysWithOptional(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], prefix: string): string | undefined {
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) return `${prefix}${key}`
  for (const key of required) if (!Object.hasOwn(value, key)) return `${prefix}${key}`
  return undefined
}

function checkBuyer(value: unknown): Checked<LabelBuyer> {
  if (!isPlainObject(value)) return { ok: false, error: invalidDataError('buyer') }
  if (value.kind === 'sms') {
    const bad = checkKeys(value, ['kind'], 'buyer.')
    return bad ? { ok: false, error: invalidDataError(bad) } : { ok: true, data: { kind: 'sms' } }
  }
  if (value.kind === 'youtube') {
    const bad = checkKeys(value, ['kind', 'name'], 'buyer.')
    if (bad) return { ok: false, error: invalidDataError(bad) }
    if (typeof value.name !== 'string') return { ok: false, error: invalidDataError('buyer.name') }
    return { ok: true, data: { kind: 'youtube', name: value.name } }
  }
  return { ok: false, error: invalidDataError('buyer.kind') }
}

/** 상품 라벨 데이터 검사 (L-3). 받은 값을 바꾸지 않고, 통과하면 표의 칸만 담은 새 객체를 돌려준다 */
export function checkProductData(value: unknown): Checked<ProductLabelData> {
  if (!isPlainObject(value)) return { ok: false, error: invalidDataError('') }
  const bad = checkKeysWithOptional(value, ['no', 'name', 'price', 'date', 'buyer'], ['variant', 'qty'], '')
  if (bad) return { ok: false, error: invalidDataError(bad) }
  if (!isLabelNumber(value.no)) return { ok: false, error: invalidDataError('no') }
  if (typeof value.name !== 'string') return { ok: false, error: invalidDataError('name') }
  if (!isWon(value.price)) return { ok: false, error: invalidDataError('price') }
  if (typeof value.date !== 'string' || !isCalendarDate(value.date)) return { ok: false, error: invalidDataError('date') }
  const buyer = checkBuyer(value.buyer)
  if (!buyer.ok) return buyer
  const option = checkOptionFields(value, '')
  if (!option.ok) return option
  // 옵션 없는 수량 1이면 O3 전과 같은 다섯 칸 (CMT-07)
  return {
    ok: true,
    data: {
      no: value.no,
      name: value.name,
      price: value.price,
      date: value.date,
      buyer: buyer.data,
      ...(option.variant === null ? {} : { variant: option.variant }),
      ...(option.qty === 1 ? {} : { qty: option.qty }),
    },
  }
}

/** 포장 라벨 데이터 검사 (L-4) */
export function checkPackingData(value: unknown): Checked<PackingLabelData> {
  if (!isPlainObject(value)) return { ok: false, error: invalidDataError('') }
  const bad = checkKeys(value, ['date', 'buyer', 'broadcasts', 'subtotal'], '')
  if (bad) return { ok: false, error: invalidDataError(bad) }
  if (typeof value.date !== 'string' || !isCalendarDate(value.date)) return { ok: false, error: invalidDataError('date') }
  const buyer = checkBuyer(value.buyer)
  if (!buyer.ok) return buyer
  if (!Array.isArray(value.broadcasts) || value.broadcasts.length === 0) return { ok: false, error: invalidDataError('broadcasts') }
  const broadcasts: PackingBroadcast[] = []
  for (let i = 0; i < value.broadcasts.length; i++) {
    const item: unknown = value.broadcasts[i]
    const at = `broadcasts.${String(i)}`
    if (!isPlainObject(item)) return { ok: false, error: invalidDataError(at) }
    const badKey = checkKeys(item, ['title', 'numbers'], `${at}.`)
    if (badKey) return { ok: false, error: invalidDataError(badKey) }
    if (typeof item.title !== 'string') return { ok: false, error: invalidDataError(`${at}.title`) }
    const numbers: unknown = item.numbers
    if (!Array.isArray(numbers) || numbers.length === 0) return { ok: false, error: invalidDataError(`${at}.numbers`) }
    const seen = new Set<string>()
    const entries: PackingEntry[] = []
    for (let k = 0; k < numbers.length; k++) {
      const entry = checkPackingEntry(numbers[k], `${at}.numbers`, `${at}.numbers.${String(k)}`)
      if (!entry.ok) return entry
      // 같음 = (번호, 다듬은 옵션 글) — 정수 5와 { no: 5 }는 같은 항목 (D-O3-03)
      const same = JSON.stringify(entrySameKey(entry.entry))
      if (seen.has(same)) return { ok: false, error: invalidDataError(`${at}.numbers`) }
      seen.add(same)
      entries.push(entry.entry)
    }
    broadcasts.push({ title: item.title, numbers: entries })
  }
  if (!isWon(value.subtotal)) return { ok: false, error: invalidDataError('subtotal') }
  return { ok: true, data: { date: value.date, buyer: buyer.data, broadcasts, subtotal: value.subtotal } }
}

/** 포장 항목 하나 검사 (L-4, D-O3-03). 옵션 없는 수량 1은 정수 번호로 돌려준다 */
function checkPackingEntry(value: unknown, list: string, at: string): { ok: true; entry: PackingEntry } | { ok: false; error: LabelError } {
  // 정수 번호가 아닌 값의 경로는 O3 전과 같은 번호 목록 경로
  if (typeof value === 'number') return isLabelNumber(value) ? { ok: true, entry: value } : { ok: false, error: invalidDataError(list) }
  if (!isPlainObject(value)) return { ok: false, error: invalidDataError(list) }
  const bad = checkKeysWithOptional(value, ['no'], ['variant', 'qty'], `${at}.`)
  if (bad) return { ok: false, error: invalidDataError(bad) }
  if (!isLabelNumber(value.no)) return { ok: false, error: invalidDataError(`${at}.no`) }
  const option = checkOptionFields(value, `${at}.`)
  if (!option.ok) return option
  if (option.variant === null && option.qty === 1) return { ok: true, entry: value.no }
  return {
    ok: true,
    entry: { no: value.no, ...(option.variant === null ? {} : { variant: option.variant }), ...(option.qty === 1 ? {} : { qty: option.qty }) },
  }
}

/** 항목의 번호 */
export function entryNo(entry: PackingEntry): number {
  return typeof entry === 'number' ? entry : entry.no
}

/** 항목의 수량 (없으면 1) */
export function entryQty(entry: PackingEntry): number {
  return typeof entry === 'number' ? 1 : (entry.qty ?? 1)
}

/** 항목의 다듬은 옵션 글 (없으면 null) */
export function entryVariant(entry: PackingEntry): string | null {
  if (typeof entry === 'number' || entry.variant === undefined || entry.variant === null) return null
  return trimLabelText(entry.variant)
}

/** 옵션 항목인가 — 옵션 글이 있거나 수량이 2 이상 (D-O3-04) */
export function isOptionEntry(entry: PackingEntry): boolean {
  return entryVariant(entry) !== null || entryQty(entry) !== 1
}

function entrySameKey(entry: PackingEntry): [number, string | null] {
  return [entryNo(entry), entryVariant(entry)]
}

/**
 * 내용 키 (L-10, D-P1-10) — 라벨 종류와 L-3·L-4의 값(템플릿을 뺀 다듬은 값)으로 정한 글. 같은 값이면 같은 키다.
 * 라벨 키의 마지막으로 출력한 내용 키와 지금 데이터의 내용 키가 다르면 "재출력 필요".
 */
export function labelContentKey(kind: LabelKind, data: unknown): { ok: true; key: string } | { ok: false; error: LabelError } {
  if (kind === 'product') {
    const checked = checkProductData(data)
    if (!checked.ok) return checked
    const d = checked.data
    const base: unknown[] = ['product', d.no, trimLabelText(d.name), d.price, d.date, ...buyerKey(d.buyer)]
    // 옵션 글·수량은 있을 때만 키에 더한다 — 옵션 없는 수량 1 라벨의 키는 O3 전과 글자까지 같다 (D-O3-09)
    const variant = d.variant === undefined || d.variant === null ? null : trimLabelText(d.variant)
    const qty = d.qty ?? 1
    if (variant !== null || qty !== 1) base.push(['option', variant, qty])
    return { ok: true, key: JSON.stringify(base) }
  }
  const checked = checkPackingData(data)
  if (!checked.ok) return checked
  const d = checked.data
  // 번호 순(같은 번호는 받은 순서 — 찍는 순서와 같다). 옵션 없는 수량 1 항목은 정수 그대로라 O3 전 키와 같다 (D-O3-09)
  const broadcasts = d.broadcasts.map((b) => [
    trimLabelText(b.title),
    [...b.numbers].sort((x, y) => entryNo(x) - entryNo(y)).map((e) => (isOptionEntry(e) ? [entryNo(e), entryVariant(e), entryQty(e)] : entryNo(e))),
  ])
  return { ok: true, key: JSON.stringify(['packing', d.date, ...buyerKey(d.buyer), broadcasts, d.subtotal]) }
}

function buyerKey(buyer: LabelBuyer): string[] {
  return buyer.kind === 'sms' ? ['sms'] : ['youtube', trimLabelText(buyer.name)]
}
