// 휴대폰 콘솔 고정 영역 맨 끝의 현재 상품 한 줄 요약 (QL2 D-QL2-11 (1), AC-QL2-01, UX-04).
// 문장: "{번호}번 {이름} · {상태} · 1등 {1등} · 대기 {n}명" — 값은 현재 상품 카드와 같다(낱말로만 바꾼다).
// 이름·1등은 낱자(Array.from) 수로 자르고 앞부분 + "…". 닉네임은 글로만 들어간다(React 기본 이스케이프, 절대 규칙 7).
import type { ProductStatus } from '@livejjim/core'
import { PRODUCT_STATUS_WORD } from './words.ts'

/** 화면에서 이름·1등을 몇 글자까지 그대로 두는가 (D-QL2-11 (1)) */
export const SUMMARY_LIMIT = 10
/** 현재 상품이 없을 때 */
export const NO_CURRENT_SUMMARY = '현재 상품: 아직 없어요'

/** 낱자 수가 max를 넘으면 앞 max글자 + "…" (이모지·결합 없는 한글은 한 글자) */
export function clipWords(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

export interface SummaryInput {
  readonly no: number
  /** 화면에 쓰는 이름 (빈 이름은 카드와 같은 "품종 미입력") */
  readonly name: string
  readonly status: ProductStatus
  /** 카드의 "1등: …"과 같은 값 — "아직 없음"·", "로 이은 여럿·"변형별" */
  readonly winners: string
  readonly waiting: number
}

/** 요약 문장. 상품이 없으면 "현재 상품: 아직 없어요" */
export function currentSummaryWords(input: SummaryInput | undefined, max: number = SUMMARY_LIMIT): string {
  if (input === undefined) return NO_CURRENT_SUMMARY
  return `${String(input.no)}번 ${clipWords(input.name, max)} · ${PRODUCT_STATUS_WORD[input.status]} · 1등 ${clipWords(input.winners, max)} · 대기 ${String(input.waiting)}명`
}
