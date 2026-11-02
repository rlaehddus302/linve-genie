// AI 제안 낱말·제안 맞춰 보기 (A1 CMT-06, D-A1-01·07·13·14) — React·실시간 알림 없이 쓰는 조각(앱 확인 필요 화면도 같이 쓴다, D-APPX-03).
import type { Product, ReviewSuggestion } from '../api/types.ts'

export const ASSIST_READING = 'AI가 읽는 중이에요…'
export const ASSIST_FAILED = 'AI 제안을 지금 받지 못했어요. 직접 골라 주세요.'
export const ASSIST_LIMIT = (limit: number): string => `오늘 AI 제안을 다 썼어요(하루 ${String(limit)}번). 비슷한 글자로 찾은 제안만 보여요.`
/** 설정을 읽지 못해 상한을 모를 때 — "하루 0번"처럼 틀린 숫자를 보이지 않는다 (D-A1-17) */
export const ASSIST_LIMIT_UNKNOWN = '오늘 AI 제안을 다 썼어요. 비슷한 글자로 찾은 제안만 보여요.'
export const ASSIST_OFFER = '설정에서 AI 제안을 켤 수 있어요.'
/** 제안 출처 (RULE·AI는 화면에 보이지 않는다) */
export const SUGGESTION_SOURCE_WORD: Readonly<Record<ReviewSuggestion['source'], string>> = {
  RULE: '비슷한 글자로 찾음',
  AI: 'AI가 읽음',
}
/** 설정 칸 */
export const ASSIST_TITLE = 'AI 제안'
export const ASSIST_SWITCH = 'AI 제안 받기'
/** 설정 고지 (A1 → QL2 D-QL2-05 ②: 유튜브 채팅은 보내지 않음) — 이미 켠 판매자에게 다시 동의를 받지 않는다 */
export const ASSIST_NOTICE = '확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 유튜브 채팅은 보내지 않아요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.'
/** 확인 필요 화면 목록 위 한 줄 (QL2 D-QL2-05 ①): AI 제안이 켜져 있고 보이는 항목 가운데 유튜브로 뺀 것이 있을 때만 */
export const ASSIST_YOUTUBE_EXCLUDED = '유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요.'
export const ASSIST_CONSENT = '위 내용을 읽었고 동의해요'
export const ASSIST_UNAVAILABLE = '지금은 쓸 수 없어요.'
export const ASSIST_ON = (used: number, limit: number): string => `켜져 있어요 · 오늘 ${String(used)}번 썼어요 (하루 ${String(limit)}번까지)`
export const ASSIST_OFF_BUTTON = '끄기'
/** 꺼져 있을 때: 상태 글과 스위치의 보이는 글(누르면 될 일) — 접근성 이름은 ASSIST_SWITCH 그대로 (D-A1-18) */
export const ASSIST_OFF_STATE = '꺼져 있어요'
export const ASSIST_ON_BUTTON = '켜기'
/** 진행 중인 요청이 있을 때(BUSY) 목록을 다시 읽는 간격과 횟수 — 2초 × 8번 = 16초(서버 호출 시간 제한 15초를 덮는다, D-A1-16) */
export const ASSIST_BUSY_RELOAD_MS = 2_000
export const ASSIST_BUSY_RELOADS = 8

const productName = (product: Product): string => (product.name.trim() === '' ? '품종 미입력' : product.name)

export interface SuggestionView {
  /** "제안: 21번 반바지 M 1개" */
  readonly words: string
  /** "21번 반바지 M 1개" — [이대로 주문] 뒤 띠·결과 끝에 붙인다 (D-A1-14) */
  readonly choice: string
  readonly source: string
  readonly product: Product
  readonly options: Readonly<Record<string, string>>
  readonly qty: number
}

/**
 * 화면에 보일 제안 (그 방송의 지금 상품으로 다시 맞춰 본다 — 어긋나면 null: 보이지 않는 쪽이 안전하다).
 * 글: "제안: 21번 반바지 M 1개" (옵션은 상품의 항목 순서로).
 */
export function suggestionView(suggestion: ReviewSuggestion | null | undefined, broadcast: string, products: ReadonlyMap<string, Product>, maxQty: number): SuggestionView | null {
  if (suggestion === null || suggestion === undefined) return null
  const product = products.get(`${broadcast}/${String(suggestion.no)}`)
  if (product === undefined || product.broadcast !== broadcast) return null
  if (!Number.isInteger(suggestion.qty) || suggestion.qty < 1 || suggestion.qty > maxQty) return null
  const given = suggestion.options ?? {}
  if (Object.keys(given).length !== product.options.length) return null
  const options: Record<string, string> = {}
  for (const item of product.options) {
    const label = Object.hasOwn(given, item.name) ? given[item.name] : undefined
    if (label === undefined || !item.choices.some((choice) => choice.label === label)) return null
    options[item.name] = label
  }
  const parts = [`${String(product.no)}번`, productName(product), ...product.options.map((item) => options[item.name] ?? ''), `${String(suggestion.qty)}개`]
  const choice = parts.join(' ')
  return { words: `제안: ${choice}`, choice, source: SUGGESTION_SOURCE_WORD[suggestion.source], product, options, qty: suggestion.qty }
}

/** 확인 필요 목록 위 "유튜브 채팅은 AI에 보내지 않아요…"를 보이나 (QL2 D-QL2-05 ①, 순수 함수) */
export function showsYoutubeExcluded(on: boolean, items: readonly { readonly excluded?: string | null }[]): boolean {
  return on && items.some((item) => item.excluded === 'YOUTUBE_POLICY')
}
