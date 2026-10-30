// 파서 4종 (S01): 채팅 주문 인식(R-3) · 금액(R-14) · 한글 수사(R-15) · 빠른 입력(R-16).
// 모두 순수·전체 함수다: 어떤 문자열에도 예외를 던지지 않고, 같은 입력·설정이면 같은 결과, 넘긴 설정을 바꾸지 않는다 (AC-S01-02).
export { parseChat, type ChatParseResult } from './parse/chat.ts'
export { parseAmount } from './parse/amount.ts'
export { parseKoreanNumber } from './parse/korean-number.ts'
export { parseQuickInput, type QuickInputError, type QuickInputResult } from './parse/quick-input.ts'
// 옵션 방송의 댓글 옵션 인식 (R-20, O1) — 순수·전체 함수
export {
  parseOptionComment,
  FOCUS_GRACE_SEC,
  type OptionCatalogEntry,
  type OptionCommentResult,
  type OptionFocus,
  type OptionOrder,
  type OptionReview,
  type OptionReviewReason,
} from './parse/options.ts'
// 휴대폰이 받은 문자 읽기 (R-26, SMS3) — 순수·전체 함수
export {
  parseSmsText,
  SMS_EXCLUDED_WORDS,
  type SmsReviewWhy,
  type SmsSkipWhy,
  type SmsTextInput,
  type SmsTextOptions,
  type SmsTextResult,
} from './parse/sms-text.ts'
