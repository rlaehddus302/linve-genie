import { NotImplementedError } from './not-implemented.ts'
import type { SettingsOverride } from './settings.ts'

/** R-3 채팅 주문 인식 결과. 번호는 메시지에 나온 순서대로. */
export interface ChatParseResult {
  readonly claims: readonly number[]
  readonly cancels: readonly number[]
  readonly mentions: readonly number[]
}

export type QuickInputError = 'PRICE_MISSING' | 'NUMBER_MISSING' | 'EMPTY' | 'NUMBER_INVALID' | 'PRICE_TOO_LOW'

/** PRD-01 빠른 입력 한 줄의 해석 결과. */
export type QuickInputResult =
  | { readonly no: number; readonly name: string; readonly price: number }
  | { readonly error: QuickInputError; readonly no?: number; readonly name?: string }

/** 채팅 메시지 → 주문·취소·언급 (R-3). S01에서 구현한다. */
export function parseChat(_text: string, _settings: SettingsOverride = {}): ChatParseResult {
  throw new NotImplementedError('채팅 주문 인식(parseChat)')
}

/** 한글·숫자 금액 → 정수 원. 해석 실패는 null. S01에서 구현한다. */
export function parseAmount(_text: string, _settings: SettingsOverride = {}): number | null {
  throw new NotImplementedError('금액 해석(parseAmount)')
}

/** 한글 수사 → 1 이상 정수. 해석 실패는 null. S01에서 구현한다. */
export function parseKoreanNumber(_text: string): number | null {
  throw new NotImplementedError('한글 수사 해석(parseKoreanNumber)')
}

/** 빠른 입력 한 줄 → 번호·품종·가격 (PRD-01). S01에서 구현한다. */
export function parseQuickInput(_text: string, _settings: SettingsOverride = {}): QuickInputResult {
  throw new NotImplementedError('빠른 입력 해석(parseQuickInput)')
}
