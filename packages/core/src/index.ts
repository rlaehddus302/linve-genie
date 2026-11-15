// @livejjim/core — 순수 판정 엔진 (CLAUDE.md 절대 규칙 1, D-024)
export { NotImplementedError, isNotImplemented } from './not-implemented.ts'
export { DEFAULT_SETTINGS, PRICE_UNITS, checkSettings, isPriceUnit, resolveSettings, type PriceUnit, type SaleSettings, type SettingKey, type SettingsOverride, type SettingsProblem } from './settings.ts'
export {
  parseChat,
  isBarePass,
  parseAmount,
  parseKoreanNumber,
  parseQuickInput,
  parseOptionComment,
  parseSmsText,
  SMS_EXCLUDED_WORDS,
  FOCUS_GRACE_SEC,
  type OptionCatalogEntry,
  type OptionCommentResult,
  type OptionFocus,
  type OptionOrder,
  type OptionReview,
  type OptionReviewReason,
  type ChatParseResult,
  type QuickInputError,
  type QuickInputResult,
  type SmsReviewWhy,
  type SmsSkipWhy,
  type SmsTextInput,
  type SmsTextOptions,
  type SmsTextResult,
} from './parser.ts'
export { formatWon, formatThanksHead, formatThanksText, type ThanksHeadInput, type ThanksTextInput } from './format.ts'
export { normalizeText } from './text.ts'
export {
  OPTION_LIMITS,
  compareChars,
  variantTexts,
  variantCount,
  unitPriceOf,
  type OptionChoice,
  type OptionItem,
  type OptionPick,
} from './options.ts'
export * from './engine.ts'
