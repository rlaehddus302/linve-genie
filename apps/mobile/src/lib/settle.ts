// 앱 정산 화면 낱말·셈 (웹 SettlementsPage·lib/words·lib/money와 같은 문구 — 앱은 코어 판정 코드를 싣지 않아 여기 따로 둔다, APP-01 AC3).
// 금액은 서버(엔진)가 준 정수 원 그대로 보이고, 화면은 더하거나 나누지 않는다 — 남은 금액(최종 − 받은 금액)만 뺀다(웹 remainingOf와 같다).
import type { PaymentStatus } from '@livejjim/core'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { formatWon } from './words.ts'

export type InputKind = 'payment' | 'shipping' | 'adjust' | 'refund'
export type ShippingChoice = 'PICKUP' | 'COMBINED' | 'FIXED' | 'DEFAULT'

export const INPUT_TITLE: Readonly<Record<InputKind, string>> = {
  payment: '입금 적기',
  shipping: '배송비 바꾸기',
  adjust: '할인·추가',
  refund: '환불 적기',
}

export const SHIPPING_WORD: Readonly<Record<ShippingChoice, string>> = {
  DEFAULT: '기본 배송비',
  PICKUP: '직접 수령',
  COMBINED: '합배송',
  FIXED: '배송비 직접 정함',
}

export const SHIPPING_CHOICES: readonly ShippingChoice[] = ['DEFAULT', 'PICKUP', 'COMBINED', 'FIXED']
export const ADJUST_REASONS: readonly string[] = ['단골 할인', '포장 추가', '도서산간']
export const REFUND_REASONS: readonly string[] = ['환불함', '입금액 잘못 적음']
export const PAYMENT_DATE_NOTE = '입금 날짜는 적은 때로 남아요. 실제 입금일이 다르면 메모에 적어 주세요.'
export const REFUND_NOTE = '입금을 잘못 적었으면 같은 금액을 환불로 적어 바로잡아요.'
export const NOT_APPLIED_SETTLEMENT = '적용되지 않았어요. 지금 상태를 확인해 주세요.'
export const SEALED_SETTLEMENT = '30일이 지난 날짜라 보기만 할 수 있어요.'
export const PHONE_IN_TEXT = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

export interface AmountRange {
  readonly min: number
  readonly max: number
  readonly message: string
}

export const PAYMENT_RANGE: AmountRange = { min: 1, max: 100_000_000, message: '입금은 1원~100,000,000원으로 적어 주세요.' }
export const SHIPPING_RANGE: AmountRange = { min: 0, max: 1_000_000, message: '배송비는 0원~1,000,000원으로 적어 주세요.' }
export const ADJUST_RANGE: AmountRange = { min: 1, max: 10_000_000, message: '할인·추가는 1원~10,000,000원으로 적어 주세요.' }

/** 환불: 1원 ~ 받은 금액 (STL-09) */
export function refundRange(received: number): AmountRange {
  return received < 1 ? { min: 1, max: 0, message: '받은 금액이 없어서 환불할 수 없어요.' } : { min: 1, max: received, message: `받은 금액(${formatWon(received)})보다 많이 환불할 수 없어요.` }
}

/** 숫자판 글 → 정수 원. 숫자만 받는다(쉼표·"원"은 지운다). 비었거나 범위 밖이면 오류 문장 */
export function readAmount(text: string, range: AmountRange): { readonly ok: true; readonly amount: number } | { readonly ok: false; readonly message: string } {
  const digits = text.replace(/[,\s원]/g, '')
  if (digits === '') return { ok: false, message: '금액을 적어 주세요.' }
  if (!/^\d+$/.test(digits)) return { ok: false, message: '숫자만 적어 주세요.' }
  const amount = Number(digits)
  if (!Number.isSafeInteger(amount) || amount < range.min || amount > range.max) return { ok: false, message: range.message }
  return { ok: true, amount }
}

/** 휴대폰 번호 모양 (메모·사유에 넣지 않는다 — R-1) */
export const looksLikePhone = (text: string): boolean => /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/.test(text)

export const remainingOf = (settlement: Pick<Settlement, 'total' | 'received'>): number => Math.max(0, settlement.total - settlement.received)

export function signedWon(amount: number): string {
  return amount < 0 ? `−${formatWon(-amount)}` : formatWon(amount)
}

/** 정산 기록 종류 낱말 (AC-S06-31) */
export function recordKindWord(kind: 'payment' | 'refund' | 'adjust' | 'shipping', amount: number | null): string {
  if (kind === 'payment') return '입금'
  if (kind === 'refund') return '환불'
  if (kind === 'adjust') return amount !== null && amount < 0 ? '할인' : '추가'
  return '배송비'
}

/** 저장된 "입금 #12"는 보일 때만 "입금 번호 12"로 (D-MOB2-05 ②) */
export function storedMemoWords(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}_#])입금 #(\d+)(?![\p{L}\p{N}_])/gu, (_match, before: string, no: string) => `${before}입금 번호 ${no}`)
}

export type PaymentFilter = 'ALL' | PaymentStatus

/** 목록 위 요약: 손님 수·다 받은 손님·아직 받을 돈 */
export function summaryWords(list: readonly Settlement[]): string {
  const withItems = list.filter((s) => s.items.length > 0)
  const paid = withItems.filter((s) => s.payment === 'PAID' || s.payment === 'OVERPAID').length
  const left = withItems.reduce((sum, s) => sum + remainingOf(s), 0)
  return `손님 ${String(withItems.length)}명 · 다 받음 ${String(paid)}명 · 받을 돈 ${formatWon(left)}`
}
