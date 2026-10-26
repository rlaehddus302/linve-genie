// 번호 없이 가격만 고쳐 말함 (실방송 V3 309번: "309번 … 55만 원" 등록 뒤 "50만 원"). 순수 함수: 시계를 읽지 않고(now를 받는다) 넘긴 값을 바꾸지 않는다.

/** 마지막 음성 등록 뒤 가격만 고쳐 말함을 받는 시간 (밀리초) — 30,000ms면 받고 30,001ms면 받지 않는다 */
export const PRICE_ONLY_FIX_MS = 30_000

export interface PriceOnlyInput {
  /** 이 조각에서 '원'까지 들린 가격 (겹친 값 한 번) */
  readonly wonPrices: readonly number[]
  /** 이 조각에서 들린 번호 (하나라도 있으면 가격만 고쳐 말함이 아니다) */
  readonly heardNumbers: readonly number[]
  /** 정정·취소 낱말이 있는가 (있으면 다른 규칙이 받는다) */
  readonly correction: boolean
  /** 이 콘솔이 마지막으로 음성으로 새로 등록한 번호와 시각 */
  readonly lastRegistered: { readonly no: number; readonly at: number } | null
  /** 마지막으로 들린 번호 (등록·이미 있는 번호·번호만 들린 조각 모두) — 마지막 등록 번호와 같아야 한다 */
  readonly lastHeardNo: number | null
  /** 가격을 기다리는 번호가 있는가 (있으면 그 번호가 가격을 받는다, D-V3-67) */
  readonly waiting: boolean
  /** 그 상품 (없거나 판매 종료면 null) */
  readonly product: { readonly price: number; readonly claimCount: number } | null
  readonly now: number
}

export interface PriceOnlyFix {
  readonly no: number
  readonly price: number
  /** 찜이 없으면 바로 고침(true), 찜이 있으면 묻기(false) */
  readonly auto: boolean
}

const isNo = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * 가격만 들린 조각을 마지막 음성 등록 상품의 가격 고침으로 볼지 (아니면 null):
 * 번호 없음 · '원' 가격 정확히 하나 · 정정·취소 낱말 없음 · 기다리는 번호 없음 ·
 * 마지막 등록 뒤 30초 안 · 그 뒤 다른 번호가 들리지 않음(마지막으로 들린 번호 = 마지막 등록 번호) · 상품이 판매 중이고 가격이 다름.
 * 찜이 없으면 auto(바로 고침, 되돌리기), 찜이 있으면 묻기.
 */
export function priceOnlyFix(input: PriceOnlyInput): PriceOnlyFix | null {
  try {
    if (!Array.isArray(input.heardNumbers) || input.heardNumbers.length > 0) return null
    if (!Array.isArray(input.wonPrices) || input.wonPrices.length !== 1) return null
    const price = input.wonPrices[0]
    if (!isNo(price) || input.correction || input.waiting) return null
    const last = input.lastRegistered
    if (last === null || !isNo(last.no) || !isTime(last.at) || !isTime(input.now)) return null
    if (input.now < last.at || input.now - last.at > PRICE_ONLY_FIX_MS) return null
    if (input.lastHeardNo !== last.no) return null
    const product = input.product
    if (product === null || product.price === price) return null
    return { no: last.no, price, auto: !(product.claimCount > 0) }
  } catch {
    return null
  }
}
