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
}

/** 포장 라벨의 방송 하나 (L-4) */
export interface PackingBroadcast {
  readonly title: string
  /** 그 방송에서 이 구매자가 1등인 상품 번호 (정수 1~9999, 1개 이상, 겹치지 않음) */
  readonly numbers: readonly number[]
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
  const bad = checkKeys(value, ['no', 'name', 'price', 'date', 'buyer'], '')
  if (bad) return { ok: false, error: invalidDataError(bad) }
  if (!isLabelNumber(value.no)) return { ok: false, error: invalidDataError('no') }
  if (typeof value.name !== 'string') return { ok: false, error: invalidDataError('name') }
  if (!isWon(value.price)) return { ok: false, error: invalidDataError('price') }
  if (typeof value.date !== 'string' || !isCalendarDate(value.date)) return { ok: false, error: invalidDataError('date') }
  const buyer = checkBuyer(value.buyer)
  if (!buyer.ok) return buyer
  return { ok: true, data: { no: value.no, name: value.name, price: value.price, date: value.date, buyer: buyer.data } }
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
    const seen = new Set<number>()
    for (const n of numbers as unknown[]) {
      if (!isLabelNumber(n) || seen.has(n)) return { ok: false, error: invalidDataError(`${at}.numbers`) }
      seen.add(n)
    }
    broadcasts.push({ title: item.title, numbers: [...seen] })
  }
  if (!isWon(value.subtotal)) return { ok: false, error: invalidDataError('subtotal') }
  return { ok: true, data: { date: value.date, buyer: buyer.data, broadcasts, subtotal: value.subtotal } }
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
    return { ok: true, key: JSON.stringify(['product', d.no, trimLabelText(d.name), d.price, d.date, ...buyerKey(d.buyer)]) }
  }
  const checked = checkPackingData(data)
  if (!checked.ok) return checked
  const d = checked.data
  const broadcasts = d.broadcasts.map((b) => [trimLabelText(b.title), [...b.numbers].sort((x, y) => x - y)])
  return { ok: true, key: JSON.stringify(['packing', d.date, ...buyerKey(d.buyer), broadcasts, d.subtotal]) }
}

function buyerKey(buyer: LabelBuyer): string[] {
  return buyer.kind === 'sms' ? ['sms'] : ['youtube', trimLabelText(buyer.name)]
}
