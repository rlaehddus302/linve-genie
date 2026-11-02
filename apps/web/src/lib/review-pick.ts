// 확인 필요 줄의 고르기·결과 (D-O1-08, D-O2-07, AC-O2-35·36·38) — 코어 전체 없이 쓰는 조각(앱 확인 필요 화면도 같이 쓴다, D-APPX-03).
import type { Product } from '../api/types.ts'

/** 한 줄의 고르기 칸 */
export interface ReviewPick {
  /** 상품 키 (없으면 '') */
  readonly product: string
  /** 항목 이름 → 선택지 label (고르지 않은 항목은 없다) */
  readonly options: Readonly<Record<string, string>>
  /** 수량 칸 글자 (읽지 않았으면 '' — 1로 채우지 않는다, D-O1-08) */
  readonly qty: string
}

/**
 * 미리 채움 = 엔진이 읽은 것만 (D-O2-07): 읽은 번호(없으면 항목의 지금 상품), 읽은 옵션, 읽은 수량. 선택지가 하나뿐인 항목은 그 값.
 */
export function prefillOf(
  review: { readonly broadcast: string; readonly product: string | null; readonly no: number | null; readonly options: readonly (readonly string[])[] | null; readonly qty: number | null },
  products: ReadonlyMap<string, Pick<Product, 'key' | 'options'>>,
): ReviewPick {
  const key = review.product ?? (review.no === null ? null : `${review.broadcast}/${String(review.no)}`)
  const product = key === null ? undefined : products.get(key)
  return { product: product?.key ?? '', options: pickFor(product, review.options ?? []), qty: review.qty === null ? '' : String(review.qty) }
}

/** 그 상품의 고르기: 주어진 옵션 중 그 상품에 있는 것 + 선택지가 하나뿐인 항목 */
export function pickFor(product: Pick<Product, 'options'> | undefined, given: readonly (readonly string[])[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (product === undefined) return out
  for (const item of product.options) {
    const found = given.find(([name, label]) => name === item.name && item.choices.some((choice) => choice.label === label))
    if (found?.[1] !== undefined) out[item.name] = found[1]
    else if (item.choices.length === 1 && item.choices[0] !== undefined) out[item.name] = item.choices[0].label
  }
  return out
}

/** 고른 옵션 → 옵션 글 (항목 순서, 모든 항목을 골랐을 때만) */
export function variantTextOf(product: Pick<Product, 'options'>, options: Readonly<Record<string, string>>): string | null {
  const labels: string[] = []
  for (const item of product.options) {
    const label = options[item.name]
    if (label === undefined) return null
    labels.push(label)
  }
  return labels.join('/')
}

/** 수량 칸 → 1~max 정수 (아니면 null) */
export function readQty(text: string, max: number): number | null {
  const compact = text.trim()
  if (!/^\d{1,3}$/.test(compact)) return null
  const value = Number(compact)
  return value >= 1 && value <= max ? value : null
}

export const qtyProblemWords = (max: number): string => `수량은 1부터 ${String(max)}까지예요.`

// ── 바로잡기 결과 (D-O2-07, AC-O2-35·36·38) ───────────────────────────────

export const KEPT_WORDS = {
  stock: '그대로 두었어요 — 남은 수량이 모자라요',
  notOnSale: '그대로 두었어요 — 판매 중인 상품이 아니에요',
  already: '그대로 두었어요 — 이 구매자가 같은 옵션을 이미 찜했어요',
  other: '그대로 두었어요 — 지금 상태를 확인해 주세요',
} as const

export type LineOutcome = { readonly kind: 'claimed'; readonly word: string } | { readonly kind: 'kept'; readonly word: string }

/** 보낸 한 줄 (그 상품·변형·수량·지금의 구매자) */
export interface SentLine {
  readonly product: string
  /** 옵션 글 (옵션 없는 상품이면 null) */
  readonly variant: string | null
  readonly qty: number
  readonly buyer: string
}

/** 상품·변형의 1등·대기·남은 수량 (옵션 없는 상품은 상품 자신) */
function slotOf(product: Product, variant: string | null): { winners: readonly string[]; waitlist: readonly string[]; remaining: number; status: Product['status'] } | null {
  if (variant === null) return { winners: product.winners, waitlist: product.waitlist, remaining: product.stock - product.confirmedUnits, status: product.status }
  const found = product.variants.find((item) => item.text === variant)
  return found === undefined ? null : { winners: found.winners, waitlist: found.waitlist, remaining: found.remaining, status: product.status }
}

/**
 * 응답 changed와 보낸 뒤의 상품으로 줄의 결과를 정한다 (화면이 상태로 판단 — 서버 계약 3).
 * 찜이 생겼으면 "1등"·"대기 n번"·"품절", 아무 일도 없었으면 까닭(판매 중 아님 → 같은 옵션 이미 찜 → 남은 수량 부족 순).
 */
export function outcomeOf(changed: boolean, line: SentLine, product: Product | undefined): LineOutcome {
  const slot = product === undefined ? null : slotOf(product, line.variant)
  if (changed) {
    if (slot === null) return { kind: 'claimed', word: '찜이 생겼어요' }
    if (slot.winners.includes(line.buyer)) return { kind: 'claimed', word: '1등' }
    const index = slot.waitlist.indexOf(line.buyer)
    if (index >= 0) return { kind: 'claimed', word: `대기 ${String(index + 1)}번` }
    return { kind: 'claimed', word: '품절' }
  }
  if (product === undefined || slot === null) return { kind: 'kept', word: KEPT_WORDS.other }
  if (slot.status !== 'OPEN' && slot.status !== 'SOLD') return { kind: 'kept', word: KEPT_WORDS.notOnSale }
  if (slot.winners.includes(line.buyer) || slot.waitlist.includes(line.buyer)) return { kind: 'kept', word: KEPT_WORDS.already }
  if (line.qty > slot.remaining) return { kind: 'kept', word: KEPT_WORDS.stock }
  return { kind: 'kept', word: KEPT_WORDS.other }
}

/** 고른 변형의 남은 수량 (모두 고르지 않았으면 null) */
export function remainingOf(product: Product | undefined, options: Readonly<Record<string, string>>): number | null {
  if (product === undefined) return null
  if (product.options.length === 0) return product.stock - product.confirmedUnits
  const text = variantTextOf(product, options)
  if (text === null) return null
  return product.variants.find((variant) => variant.text === text)?.remaining ?? null
}
