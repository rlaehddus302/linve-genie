// R-26 문자 읽기 (SPEC ORD-13, SMS3 — D-SMS3-09·D-SMS3-10).
// 판매자 휴대폰이 받은 문자 하나(보낸 곳 + 본문) → 문자찜 · 취소 요청 · 확인 필요 · 거름 · 찜 아님.
// 순수·전체 함수다: 어떤 입력에도 예외를 던지지 않고, 같은 입력이면 같은 결과, 넘긴 값을 바꾸지 않는다 (AC-SMS3-02).
// 번호 읽기는 R-3 STRICT(parseChat) 그대로 쓴다 — 판정 엔진 규칙은 바꾸지 않는다.
import { normalizePhone } from '../engine/phone.ts'
import { checkSettings, type SaleSettings, type SettingsOverride } from '../settings.ts'
import { parseChat, type ChatParseResult } from './chat.ts'
import { asText, normalizeText } from './text.ts'

/** 확인 필요의 까닭 (R-26 결과) */
export type SmsReviewWhy = 'UNCLEAR' | 'NO_NUMBER' | 'OPTIONS'
/** 거름의 까닭 (R-26 1·3) */
export type SmsSkipWhy = 'NOT_MOBILE' | 'EXCLUDED'

/** 문자 읽기 결과 — 다섯 모양 중 하나. `memo`는 읽은 이름이 있을 때만 있다(한글 음절 2~10자). */
export type SmsTextResult =
  | { readonly claims: readonly number[]; readonly memo?: string }
  | { readonly cancels: readonly number[]; readonly memo?: string }
  | { readonly review: readonly number[]; readonly why: SmsReviewWhy; readonly memo?: string }
  | { readonly skip: SmsSkipWhy }
  | { readonly [key: string]: never }

/** 읽을 문자 — `from`은 휴대폰이 알려 준 보낸 곳 그대로(번호나 이름 글), 모르면 null */
export interface SmsTextInput {
  readonly from: string | null
  readonly text: string
}

/** 그 방송 스냅샷의 설정 (`claim.parseMode`·`claim.multiNumber`·`claim.maxNumber`). 빠지거나 틀린 값은 DOMAIN_RULES 기본값 */
export interface SmsTextOptions {
  readonly parseMode?: SaleSettings['claim.parseMode']
  readonly multiNumber?: SaleSettings['claim.multiNumber']
  readonly maxNumber?: number
}

/**
 * 거를 낱말 (R-3 정규화 뒤 영문 소문자로 바꾼 글에 들어 있으면 거름 EXCLUDED, R-26 3).
 * 서버가 기기에 주는 "보내지 않기" 목록과 같다(D-SMS3-11). 넓히려면 DECISIONS를 거친다.
 */
export const SMS_EXCLUDED_WORDS: readonly string[] = Object.freeze(['(광고)', '[광고]', 'web발신', '국제발신', '해외발신', '인증', '승인', '결제', '택배'])

/** 이름 후보 끝에서 모두 떼는 글자 (R-26 4 "이름") */
const NAME_TAIL_CHARS = new Set(['.', '!', '~', '^', 'ㅎ', 'ㅋ', '♡', '♥'])
/** 이름 후보 끝에서 하나만 떼는 말 — 긴 것 먼저 */
const NAME_SUFFIXES = ['입니다', '이에요', '예요', '이요']
/** 이름이 아닌 시작 — 아니라는 말·묻는 말 (R-21 3a와 같은 결) */
const NOT_NAME_PREFIXES = ['아니', '아닌', '아님', '안', '않', '못', '말고', '패스', '얼마', '언제', '어디', '뭐', '몇', '있', '없']
/** 이름 안에 있으면 이름이 아닌 말 */
const NOT_NAME_WORDS = ['취소', '찜']
/** 한글 음절(가~힣)만 2~10자 */
const NAME_RE = /^[가-힣]{2,10}$/u
/** 문장 끝 (요·다·까로 끝나면 이름이 아니다) */
const SENTENCE_ENDINGS = ['요', '다', '까']

/** 휴대폰 아님으로 보는 보낸 곳의 글자: 숫자 밖에는 공백·+·-·(·)·.·#·* 만 (R-26 1) */
const NUMBER_ONLY_PUNCT = new Set(['+', '-', '(', ')', '.', '#', '*'])
/** 공백 — R-3 정규화와 같은 집합(JavaScript `\s`에서 U+FEFF를 뺀 것) */
const SPACE_RE = /^[^\S\uFEFF]$/u
const LEADING_SPACE_RE = /^[^\S\uFEFF]+/u

const FULLWIDTH_ZERO = 0xff10
const FULLWIDTH_NINE = 0xff19
const ZERO = 0x30
const NINE = 0x39

type Sender = 'MOBILE' | 'NOT_MOBILE' | 'NAME_ONLY'

/** 반각·전각 숫자면 반각 숫자 한 글자, 아니면 null */
function digitOf(char: string): string | null {
  const code = char.codePointAt(0) as number
  if (code >= ZERO && code <= NINE) return char
  if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) return String.fromCharCode(code - FULLWIDTH_ZERO + ZERO)
  return null
}

/**
 * R-26 1 보낸 곳: 휴대폰 · 휴대폰 아님 · 이름만.
 * 보낸 번호 정리(전각 → 반각, ASCII 숫자만, `+82`로 시작하면 맨 앞 82를 떼고 0 붙이기)는 여기에만 쓴다 — R-11 normalizePhone은 그대로다.
 */
function classifySender(from: unknown): Sender {
  if (typeof from !== 'string') return 'NAME_ONLY'
  let digits = ''
  let numberShaped = true
  for (const char of from) {
    const digit = digitOf(char)
    if (digit !== null) digits += digit
    else if (!NUMBER_ONLY_PUNCT.has(char) && !SPACE_RE.test(char)) numberShaped = false
  }
  // 숫자를 하나 이상 담았는지는 정리 전 from으로 본다 (`+82`만 → 휴대폰 아님)
  const hasDigit = digits.length > 0
  if (from.replace(LEADING_SPACE_RE, '').startsWith('+82')) {
    digits = digits.slice(2)
    if (!digits.startsWith('0') && digits.length >= 9) digits = `0${digits}`
  }
  if (normalizePhone(digits) !== null) return 'MOBILE'
  return numberShaped && hasDigit ? 'NOT_MOBILE' : 'NAME_ONLY'
}

/** R-26 4 "이름": 이름이면 뗀 뒤의 글(memo), 아니면 null */
function nameOf(token: string): string | null {
  const chars = Array.from(token)
  let end = chars.length
  while (end > 0 && NAME_TAIL_CHARS.has(chars[end - 1] as string)) end -= 1
  let n = chars.slice(0, end).join('')
  const suffix = NAME_SUFFIXES.find((word) => n.endsWith(word))
  if (suffix !== undefined) n = n.slice(0, n.length - suffix.length)
  if (!NAME_RE.test(n)) return null
  if (SENTENCE_ENDINGS.some((ending) => n.endsWith(ending))) return null
  if (NOT_NAME_PREFIXES.some((prefix) => n.startsWith(prefix))) return null
  if (NOT_NAME_WORDS.some((word) => n.includes(word))) return null
  return n
}

type Reading =
  | { readonly kind: 'claims'; readonly numbers: readonly number[]; readonly memo?: string }
  | { readonly kind: 'cancels'; readonly numbers: readonly number[]; readonly memo?: string }
  | { readonly kind: 'review'; readonly numbers: readonly number[] }
  | { readonly kind: 'none' }

/** R-3 STRICT 결과의 주문·취소 (없으면 undefined) */
function sureOf(result: ChatParseResult, memo?: string): Reading | undefined {
  const withMemo = memo === undefined ? {} : { memo }
  if (result.claims.length > 0) return { kind: 'claims', numbers: result.claims, ...withMemo }
  if (result.cancels.length > 0) return { kind: 'cancels', numbers: result.cancels, ...withMemo }
  return undefined
}

/** R-26 4·5: 확실한 모양(전체 → 마지막 토큰 이름 → 첫 토큰 이름), 아니면 언급 → 확인 필요, 없으면 찜 아님 */
function readBody(s: string, strict: SettingsOverride): Reading {
  const whole = parseChat(s, strict)
  const sure = sureOf(whole)
  if (sure !== undefined) return sure
  const tokens = s.split(' ')
  if (tokens.length >= 2) {
    const candidates: ReadonlyArray<readonly [string, string]> = [
      [tokens[tokens.length - 1] as string, tokens.slice(0, -1).join(' ')],
      [tokens[0] as string, tokens.slice(1).join(' ')],
    ]
    for (const [candidate, rest] of candidates) {
      const memo = nameOf(candidate)
      if (memo === null) continue
      const named = sureOf(parseChat(rest, strict), memo)
      if (named !== undefined) return named
    }
  }
  return whole.mentions.length > 0 ? { kind: 'review', numbers: whole.mentions } : { kind: 'none' }
}

/**
 * 넘긴 설정에서 쓸 값만 고른다 — 설정표 범위 밖 값은 버리고 기본값을 쓴다(checkSettings와 같은 판정, 예외를 던지지 않는다).
 * claim.parseMode는 넘기지 않는다: R-3 기본값 STRICT로 읽는다 — LOOSE 방송도 문자는 STRICT (R-26). OPTIONS는 6 바꾸기만 쓴다.
 */
function strictSettings(options: unknown): { readonly strict: SettingsOverride; readonly optionsMode: boolean } {
  const record: Record<string, unknown> = options !== null && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  const strict: Record<string, unknown> = {}
  for (const [key, setting] of [
    ['claim.multiNumber', record.multiNumber],
    ['claim.maxNumber', record.maxNumber],
  ] as const) {
    if (setting !== undefined && checkSettings({ [key]: setting }).length === 0) strict[key] = setting
  }
  return { strict: strict as SettingsOverride, optionsMode: record.parseMode === 'OPTIONS' }
}

/**
 * 휴대폰이 받은 문자 하나 → 문자찜 `{ claims, memo? }` · 취소 요청 `{ cancels, memo? }` · 확인 필요 `{ review, why, memo? }` ·
 * 거름 `{ skip }` · 찜 아님 `{}` (DOMAIN_RULES R-26). 어떤 입력에도 예외를 던지지 않는다.
 */
export function parseSmsText(input: SmsTextInput, options: SmsTextOptions = {}): SmsTextResult {
  const record: Record<string, unknown> = input !== null && typeof input === 'object' ? (input as unknown as Record<string, unknown>) : {}
  // ① 보낸 곳 — 휴대폰 아님이면 본문을 보지 않는다
  const sender = classifySender(record.from)
  if (sender === 'NOT_MOBILE') return { skip: 'NOT_MOBILE' }
  // ② R-3 정규화 ③ 거를 낱말
  const s = normalizeText(asText(record.text))
  const lower = s.toLowerCase()
  if (SMS_EXCLUDED_WORDS.some((word) => lower.includes(word))) return { skip: 'EXCLUDED' }
  // ④ 확실한 모양 ⑤ 언급
  const { strict, optionsMode } = strictSettings(options)
  const reading = readBody(s, strict)
  if (reading.kind === 'none') return {}
  const numbers = [...reading.numbers]
  const memo = reading.kind === 'review' || reading.memo === undefined ? {} : { memo: reading.memo }
  // ⑥ 바꾸기 (처음 맞는 것 하나): 옵션 방송 → OPTIONS, 이름만 + 문자찜 → NO_NUMBER
  if (optionsMode) return { review: numbers, why: 'OPTIONS', ...memo }
  if (reading.kind === 'review') return { review: numbers, why: 'UNCLEAR' }
  if (reading.kind === 'claims') return sender === 'NAME_ONLY' ? { review: numbers, why: 'NO_NUMBER', ...memo } : { claims: numbers, ...memo }
  return { cancels: numbers, ...memo }
}
