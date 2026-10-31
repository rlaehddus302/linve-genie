// 정산 금액 칸 (AC-S06-36, R-14(D-029), STL-03, D-092): 금액은 원 단위(WON)로 읽는다 — 판매자 설정의 천원 단위를 쓰지 않는다
// (돈 기록은 늘 원: `14` → 14원). `14000`·`14,000`·`1만 4천`·`만 사천 원` → 14,000원. 읽은 값은 칸 옆에 "14,000원"으로 보인다.
// SRV1 (D-APP-23·24): 칸 글을 금액으로 읽는 일은 서버가 한다(서버 읽기 입구 kind `money`). 화면은 서버가 읽은 금액으로
// 칸 범위만 막고(서버가 다시 검사한다) 보이는 글을 만든다. 보내는 본문은 친 글 원문이다.
import { formatWon } from '@livejjim/core'
import { readProblem, readText, useServerRead, type ReadOf } from './read.ts'

type MoneyReading = ReadOf<'money'>

export const AMOUNT_UNREADABLE = '금액을 14000처럼 적어 주세요.'

export interface AmountRange {
  readonly min: number
  readonly max: number
  /** 범위 밖일 때 문장 */
  readonly message: string
  /** 최소보다 작을 때의 문장 (없으면 message) */
  readonly low?: string
}

export type AmountRead =
  | { readonly kind: 'empty' }
  /** 서버 답을 기다린다(또는 연결이 없다) — 미리 보기는 비운다 */
  | { readonly kind: 'pending' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ok'; readonly amount: number; readonly words: string }

/** 칸 글자 + 서버가 읽은 금액 → 칸 상태. 범위 밖이면 그 칸의 범위 문장 */
export function amountRead(text: string, reading: MoneyReading | null, range: AmountRange): AmountRead {
  if (text.trim() === '') return { kind: 'empty' }
  if (reading === null) return { kind: 'pending' }
  const amount = reading.amount
  if (amount === null) return { kind: 'invalid', message: reading.message ?? AMOUNT_UNREADABLE }
  if (amount < range.min) return { kind: 'invalid', message: range.low ?? range.message }
  if (amount > range.max) return { kind: 'invalid', message: range.message }
  return { kind: 'ok', amount, words: formatWon(amount) }
}

/** 치는 동안의 칸 상태 (서버 답 — 150ms 뒤) */
export function useAmount(text: string, range: AmountRange): AmountRead {
  return amountRead(text, useServerRead(null, 'money', text), range)
}

/** 보내기를 누른 때: 미리 보기 답이 아직이면 지금 서버에 읽힌다. 읽지 못하면(연결 없음) 그 문장 */
export async function amountNow(text: string, current: AmountRead, range: AmountRange): Promise<AmountRead> {
  if (current.kind !== 'pending') return current
  try {
    return amountRead(text, await readText(null, 'money', text), range)
  } catch (error) {
    return { kind: 'invalid', message: readProblem(error).message }
  }
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

/** 세 자리마다 쉼표 (개수·사용량 — 실행 환경의 언어 설정과 무관하게) */
export function groupDigits(value: number): string {
  return formatWon(Math.trunc(value)).replace(/원$/, '')
}
