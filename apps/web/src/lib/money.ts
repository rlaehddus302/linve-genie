// 정산 금액 칸 (AC-S06-36, R-14(D-029), STL-03, D-092): 코어 parseAmount를 원 단위(WON)로 쓴다 — 판매자 설정의 천원 단위를 쓰지 않는다
// (돈 기록은 늘 원: `14` → 14원). `14000`·`14,000`·`1만 4천`·`만 사천 원` → 14,000원. 읽은 값은 칸 옆에 "14,000원"으로 바로 보인다.
import { formatWon, parseAmount } from '@livejjim/core'

export const AMOUNT_UNREADABLE = '금액을 14000처럼 적어 주세요.'

export interface AmountRange {
  readonly min: number
  readonly max: number
  /** 범위 밖일 때 문장 */
  readonly message: string
  /** 최소보다 작을 때의 문장 (없으면 message) */
  readonly low?: string
}

export type AmountRead = { readonly kind: 'empty' } | { readonly kind: 'invalid'; readonly message: string } | { readonly kind: 'ok'; readonly amount: number; readonly words: string }

/** 칸 글자 → 금액(정수 원). 범위 밖이면 그 칸의 범위 문장 */
export function readAmount(text: string, range: AmountRange): AmountRead {
  if (text.trim() === '') return { kind: 'empty' }
  const amount = parseAmount(text, { 'price.unit': 'WON' })
  if (amount === null) return { kind: 'invalid', message: AMOUNT_UNREADABLE }
  if (amount < range.min) return { kind: 'invalid', message: range.low ?? range.message }
  if (amount > range.max) return { kind: 'invalid', message: range.message }
  return { kind: 'ok', amount, words: formatWon(amount) }
}

/** 칸마다 범위 (D-092) */
export const PAYMENT_RANGE: AmountRange = { min: 1, max: 100_000_000, message: '입금은 1원~100,000,000원으로 적어 주세요.' }
export const SHIPPING_RANGE: AmountRange = { min: 0, max: 1_000_000, message: '배송비는 0원~1,000,000원으로 적어 주세요.' }
export const ADJUST_RANGE: AmountRange = { min: 1, max: 10_000_000, message: '할인·추가는 1원~10,000,000원으로 적어 주세요.' }

/** 환불: 1원 ~ 받은 금액 (STL-09 — 받은 금액을 넘을 수 없다) */
export function refundRange(received: number): AmountRange {
  return received < 1
    ? { min: 1, max: 0, message: '받은 금액이 없어서 환불할 수 없어요.' }
    : { min: 1, max: received, message: `받은 금액(${formatWon(received)})보다 많이 환불할 수 없어요.`, low: '환불은 1원 이상으로 적어 주세요.' }
}
