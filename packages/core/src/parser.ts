// 파서 4종 (S01): 채팅 주문 인식(R-3) · 금액(R-14) · 한글 수사(R-15) · 빠른 입력(R-16).
// 모두 순수·전체 함수다: 어떤 문자열에도 예외를 던지지 않고, 같은 입력·설정이면 같은 결과, 넘긴 설정을 바꾸지 않는다 (AC-S01-02).
import { NotImplementedError } from './not-implemented.ts'
import type { SettingsOverride } from './settings.ts'

export { parseChat, type ChatParseResult } from './parse/chat.ts'
export { parseAmount } from './parse/amount.ts'
export { parseKoreanNumber } from './parse/korean-number.ts'

export type QuickInputError = 'PRICE_MISSING' | 'NUMBER_MISSING' | 'EMPTY' | 'NUMBER_INVALID' | 'PRICE_TOO_LOW'

/** PRD-01 빠른 입력 한 줄의 해석 결과. */
export type QuickInputResult =
  | { readonly no: number; readonly name: string; readonly price: number }
  | { readonly error: QuickInputError; readonly no?: number; readonly name?: string }

/** 빠른 입력 한 줄 → 번호·품종·가격 (PRD-01). S01에서 구현한다. */
export function parseQuickInput(_text: string, _settings: SettingsOverride = {}): QuickInputResult {
  throw new NotImplementedError('빠른 입력 해석(parseQuickInput)')
}
