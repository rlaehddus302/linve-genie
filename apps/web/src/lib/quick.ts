// 빠른 입력칸 한 줄의 할 일 (PRD-01, PRD-03 AC3, R-16, D-084, AC-S05-10~13).
// SRV1 (D-APP-23·24): 친 줄을 번호·품종·가격으로 읽는 일은 서버 읽기 입구가 한다(lib/read.ts). 이 파일은 서버가 읽은 결과와
// 그 방송의 상품 목록(번호로 찾기)으로 할 일(등록·"고칠까요?"·자세히·고치기 칸)만 정하고, 보이는 문장을 만든다 — 글을 읽지 않는다.
import { formatWon, type QuickInputError, type SaleSettings } from '@livejjim/core'
import type { Product } from '../api/types.ts'
import type { FixNumberReading, PriceReading, QuickReading } from './read.ts'

/** 고치기 칸의 커서 (AC-S05-11 표) */
export type FixField = 'no' | 'name' | 'price'

export type QuickDecision =
  /** 빈 줄: 아무 일도 없다 */
  | { readonly kind: 'none' }
  /** 그 번호의 상품이 없다: 등록 */
  | { readonly kind: 'register'; readonly no: number; readonly name: string; readonly price: number }
  /** 그 번호의 상품 기록이 있다: "고칠까요?" */
  | { readonly kind: 'edit'; readonly product: Product; readonly no: number; readonly name: string; readonly price: number }
  /** 번호만 쳤고 그 상품이 있다: 상품 자세히 */
  | { readonly kind: 'open'; readonly product: Product }
  /** 오류: 등록하지 않고 고치기 칸을 연다 */
  | {
      readonly kind: 'fix'
      readonly error: Exclude<QuickInputError, 'EMPTY'>
      readonly no: number | null
      readonly name: string | null
      readonly focus: FixField
      readonly message: string
      /** 번호 칸에 그대로 둘 글자 (범위 밖 번호 — 친 첫 토큰, AC-S06-65) */
      readonly noText?: string
      /** 가격 칸에 채울 글자 (번호 오류 때 나머지에서 읽은 가격, AC-S06-65) */
      readonly priceText?: string
    }

function focusOf(error: Exclude<QuickInputError, 'EMPTY'>): FixField {
  return error === 'PRICE_MISSING' || error === 'PRICE_TOO_LOW' ? 'price' : 'no'
}

/** 서버가 읽은 빠른 입력 한 줄 → 할 일 (D-084 가~라) */
export function decideQuick(reading: QuickReading, findProduct: (no: number) => Product | undefined): QuickDecision {
  if (reading.error !== null) {
    if (reading.error === 'EMPTY') return { kind: 'none' }
    const error = reading.error
    // (다) 번호만 쳤고 그 번호의 상품이 있으면 그 상품 자세히
    if (error === 'PRICE_MISSING' && reading.no !== null && (reading.name ?? '') === '') {
      const product = findProduct(reading.no)
      if (product !== undefined) return { kind: 'open', product }
    }
    return {
      kind: 'fix',
      error,
      no: reading.no,
      name: reading.name,
      focus: focusOf(error),
      message: reading.message ?? '',
      ...(reading.noText === undefined ? {} : { noText: reading.noText }),
      ...(reading.priceText === undefined ? {} : { priceText: reading.priceText }),
    }
  }
  if (reading.no === null || reading.price === null) return { kind: 'none' }
  const name = reading.name ?? ''
  const product = findProduct(reading.no)
  if (product !== undefined) return { kind: 'edit', product, no: reading.no, name, price: reading.price }
  return { kind: 'register', no: reading.no, name, price: reading.price }
}

/** 고치기 칸(번호·품종·가격) → 할 일. 번호 칸·가격 칸은 서버가 읽은 결과(빠른 입력과 같은 번호 읽기·같은 금액 읽기) */
export function decideFix(
  input: { readonly name: string },
  readings: { readonly no: FixNumberReading; readonly price: PriceReading },
  findProduct: (no: number) => Product | undefined,
): QuickDecision {
  const name = input.name.trim()
  if (readings.no.no === null) {
    const error = readings.no.error ?? 'NUMBER_INVALID'
    return { kind: 'fix', error, no: null, name, focus: 'no', message: readings.no.message ?? '' }
  }
  const no = readings.no.no
  if (readings.price.error !== null || readings.price.amount === null) {
    const error = readings.price.error ?? 'PRICE_MISSING'
    return { kind: 'fix', error, no, name, focus: 'price', message: readings.price.message ?? '' }
  }
  const price = readings.price.amount
  const product = findProduct(no)
  if (product !== undefined) return { kind: 'edit', product, no, name, price }
  return { kind: 'register', no, name, price }
}

/**
 * "고칠까요?"에서 바뀐 칸 (품종·가격, 개수 칸이 1이 아니면 개수도 — 바뀐 것만). 친 줄에 품종이 없으면(`15 12000`) 품종은 그대로 둔다 —
 * 가격만 고치려던 줄이 품종을 지우지 않게.
 */
export function changedFields(product: Product, name: string, price: number, stock?: number): { name?: string; price?: number; stock?: number } {
  return {
    ...(name !== '' && name !== product.name ? { name } : {}),
    ...(price !== product.price ? { price } : {}),
    // 개수 칸(옵션 없는 상품만, AC-ORD11-08): 칸이 1이면 넘기지 않는다 — 재고는 그대로
    ...(stock !== undefined && !product.hasOptions && stock !== product.stock ? { stock } : {}),
  }
}

/** 같은 번호를 다시 쳤을 때의 물음 (AC-S05-13): 판매 종료된 상품이면 다시 팔지를 묻는다 */
export function editQuestion(no: number, closed: boolean): string {
  return closed ? `${String(no)}번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?` : `${String(no)}번이 이미 있어요. 고칠까요?`
}

// ── 가격 단위 한 줄·등록 전 미리 보기 (FB1 D-FB1-01, AC-FB1-02·03) ─────────────
// 미리 보기는 서버가 읽은 결과다(Enter로 보내면 서버가 같은 함수로 다시 읽는다 — 미리 보기 가격 = 등록 가격).

/** 빠른 입력칸 아래 그 방송의 가격 단위 한 줄 */
export function unitLine(unit: SaleSettings['price.unit']): string {
  // 모르는 값은 없다(코어 checkSettings가 스냅샷을 거른다) — 그래도 천원으로 추측해 보이지 않게 셋을 따로 (SA-FB1-02)
  if (unit === 'WON') return '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원'
  if (unit === 'TEN_THOUSAND') return '가격 단위: 만원 — 15는 150,000원, 5천은 5,000원'
  // D-V3-70: 두 자리 이하는 만원, 세 자리는 천원, 1000 이상은 원 그대로
  if (unit === 'AUTO') return '가격 단위: 자동 — 25는 250,000원, 180은 180,000원, 15000은 15,000원'
  return '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원'
}

/** 서버가 읽은 줄이 새 상품 등록이면 "등록하면: 15번 엘레강스 10,000원"(품종이 없으면 "등록하면: 15번 10,000원"), 아니면(답 없음 포함) null */
export function registerPreview(reading: QuickReading | null, findProduct: (no: number) => Product | undefined): string | null {
  if (reading === null) return null
  const decision = decideQuick(reading, findProduct)
  if (decision.kind !== 'register') return null
  return `등록하면: ${String(decision.no)}번 ${decision.name === '' ? '' : `${decision.name} `}${formatWon(decision.price)}`
}

/** 고치기 칸 가격 옆 "= 15,000원" (서버가 읽지 못했거나 답이 없으면 null) */
export function fixPricePreview(reading: PriceReading | null): string | null {
  return reading === null || reading.amount === null ? null : `= ${formatWon(reading.amount)}`
}
