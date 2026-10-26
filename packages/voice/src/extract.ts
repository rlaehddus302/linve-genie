// 음성 문장 추출 (VOC-02·VOC-03, DOMAIN_RULES R-17, D-202·D-203, 끊어 말한 번호 D-I4-01). 사례: tests/golden/parser/voice-extract.yaml.
// 방송자가 말한 문장 하나 → 정확히 { no, name, price, confidence }. 애매하면 그 칸을 비운다(null).
// 순수 함수: 같은 입력이면 같은 결과, 넘긴 사전·설정을 바꾸지 않고, 시계·난수·네트워크를 쓰지 않으며, 어떤 입력에도 예외를 던지지 않는다.
// 정규화(R-3)·금액(R-14)·수사(R-15)는 코어 함수를 그대로 다시 쓴다 — 코어와 결과가 갈라지지 않게.
import { normalizeText, parseAmount, parseKoreanNumber } from '@livejjim/core'
import { VarietyDictionary, type DictionaryEntry } from './dictionary.ts'
import { isWindowFiller, looksLikePredicate } from './words.ts'
import { DEFAULT_COMMON_ALIASES, DEFAULT_EXACT_ONLY } from './default-dictionary.ts'
import { BIT_PATTERN_MAX, JamoPattern, bitParallelDistance, candidateLengthRange, compareSimilarity, isCandidate, jamoKey, jamoOf, type Similarity } from './jamo.ts'
import { isPastPriceLine } from './past-price.ts'

export type Confidence = 'HIGH' | 'LOW'

/** 추출 결과 — 정확히 네 키 */
export interface VoiceExtraction {
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly confidence: Confidence
}

export interface ExtractOptions {
  /** claim.maxNumber (생략하거나 1 이상 정수가 아니면 999) */
  readonly maxNumber?: number
  /** 품종 사전: 이름 목록(사전 규칙을 여기서도 적용한다) 또는 prepareDictionary로 준비한 사전. 생략하면 빈 사전 */
  readonly dictionary?: readonly string[] | VarietyDictionary
}

/** 정규화한 문장의 최대 길이(코드 포인트). 넘으면 아무것도 뽑지 않는다 (R-17 1) */
export const SENTENCE_MAX_CODE_POINTS = 300
/** claim.maxNumber 기본값 (DOMAIN_RULES 설정표) */
const DEFAULT_MAX_NUMBER = 999
/** 끝말 23개 (R-17 2 — V3에서 `까지`·`인데`를 더했다, D-V3-04). 읽는 모양은 짧은 끝말부터 뗀다 */
export const ENDINGS: readonly string[] = Object.freeze([
  '이에요',
  '예요',
  '에요',
  '입니다',
  '이요',
  '이고',
  '이랑',
  '하고',
  '짜리',
  '에는',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '엔',
  '도',
  '요',
  '랑',
  '까지',
  '인데',
])
const ENDINGS_SHORT_FIRST: readonly string[] = [...ENDINGS].sort((a, b) => a.length - b.length)
/** 읽는 모양에만 더 떼는 끝말 (`이고요`·`이구요` — 말끝 "~이고요") */
export const FORM_EXTRA_ENDINGS: readonly string[] = Object.freeze(['이고요', '이구요'])
/** 토큰 끝에서 지우는 문장 부호 (R-17 1 — V3: 유니코드 늘임표 `…`도, TD-V3-007) */
const TRAILING_PUNCTUATION = new Set(['.', ',', '?', '!', '~', '…'])
/** 한자어 수사 글자 (R-17 3) */
const SINO_NUMERAL = new Set([...'일이삼사오육칠팔구십백천'])
/** 한글 수·단위 (R-17 4: 가격 묶음의 글에 있어야 하는 글자, `원`과 함께) */
const KOREAN_AMOUNT = new Set([...'일이삼사오육칠팔구십백천만'])
/** 금액 글자 토큰을 이루는 글자 (R-17 4 금액 조각) */
const AMOUNT_TOKEN_CHARS = new Set([...'0123456789,.일이삼사오육칠팔구십백천만'])
/** 단위로 시작하는 묶음 (R-17 4 금액 조각) */
const UNIT_START = new Set([...'십백천만'])
const WON = '원'
const BEON = '번'
/** 가격 묶음 최대 토큰 수 (R-17 4) */
const PRICE_MAX_TOKENS = 6
/** 품종 창 최대 토큰 수 (R-17 5) */
const WINDOW_MAX_TOKENS = 4
/** 말 금액은 원 단위로 읽는다 (price.unit과 상관없다, D-202) */
const WON_UNIT = { 'price.unit': 'WON' } as const

const EMPTY: VoiceExtraction = Object.freeze({ no: null, name: null, price: null, confidence: 'LOW' })

// ── 1·2. 토큰과 읽는 모양 ────────────────────────────────────────────────

function codePointCount(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

/** 토큰 끝의 문장 부호를 모두 지운다 */
function stripTrailingPunctuation(token: string): string {
  let end = token.length
  while (end > 0 && TRAILING_PUNCTUATION.has(token.charAt(end - 1))) end--
  return token.slice(0, end)
}

/** R-17 1: 정규화 → 공백으로 나누기 → 끝 문장 부호 지우기 → 빈 토큰 버리기. 300글자를 넘으면 null */
export function tokenize(text: unknown): string[] | null {
  const normalized = normalizeText(typeof text === 'string' ? text : '')
  if (codePointCount(normalized) > SENTENCE_MAX_CODE_POINTS) return null
  if (normalized === '') return []
  return normalized
    .split(' ')
    .map(stripTrailingPunctuation)
    .filter((token) => token !== '')
}

/** 토큰마다 끝 문장 부호를 지웠는가 (tokenize와 같은 토큰 순서) — D-V3-54 "문장 부호가 없으면" */
export function punctuatedTokens(text: unknown): boolean[] {
  const normalized = normalizeText(typeof text === 'string' ? text : '')
  if (normalized === '' || codePointCount(normalized) > SENTENCE_MAX_CODE_POINTS) return []
  return normalized
    .split(' ')
    .map((token) => ({ stripped: stripTrailingPunctuation(token), had: stripTrailingPunctuation(token) !== token }))
    .filter((item) => item.stripped !== '')
    .map((item) => item.had)
}

/** R-17 2: 토큰 그대로, 그다음 끝말 하나를 뗀 모양(남는 글자가 있을 때만, 짧은 끝말부터) */
export function readingForms(token: string): string[] {
  const forms = [token]
  for (const ending of ENDINGS_SHORT_FIRST) {
    if (token.length > ending.length && token.endsWith(ending)) forms.push(token.slice(0, -ending.length))
  }
  // 실방송 V3: "색금이고요"·"309번이고요" — R-17 2 목록(ENDINGS, 가리기·서버가 같은 목록을 씀)은 그대로 두고 읽는 모양에만 더한다
  for (const ending of FORM_EXTRA_ENDINGS) {
    if (token.length > ending.length && token.endsWith(ending)) {
      const form = token.slice(0, -ending.length)
      if (!forms.includes(form)) forms.push(form)
    }
  }
  return forms
}

// ── 3. 번호 ──────────────────────────────────────────────────────────────

const isDigitString = (text: string): boolean => /^[0-9]{1,4}$/.test(text)
const isSinoOnly = (text: string): boolean => text !== '' && [...text].every((char) => SINO_NUMERAL.has(char))

/** 번호 표시의 X → 값 (R-17 3). X는 숫자 1~4자리 또는 한자어 수사 글자만, `이` 한 글자는 아니다. 값은 R-15 */
function numberValue(x: string): number | null {
  if (x === '이') return null
  if (!isDigitString(x) && !isSinoOnly(x)) return null
  return parseKoreanNumber(x)
}

/**
 * 앞 수와 합치기 (R-17 3, D-V3-54 — 상품 등록만): 번호 표시의 X(위치 xAt의 글 x) 바로 앞 토큰이 수 토큰(숫자 1~4자리·R-15 한글 수, `이` 제외)이고 문장 부호가 없으면
 * 둘 다 숫자 한 개면 두 자리(`6 3번` 63), 아니면 자리가 내려갈 때만 더하고(`오십 삼번` 53·`60 3번` 63) 왼쪽으로 이어 더한다(`백 이십 삼번` 123).
 * 결과: 합친 값과 첫 토큰 위치 | 'overlap'(겹침 — 번호·가격 비움) | null(앞 토큰이 수가 아님 — D-I4-01 검사로)
 */
/** 0이 아닌 가장 낮은 자리 (50 → 1, 100 → 2, 3 → 0) */
function lowestPlace(n: number): number {
  let place = 0
  for (let v = n; v % 10 === 0 && v > 0; v /= 10) place++
  return place
}

function mergeLeft(tokens: readonly string[], punct: readonly boolean[], xAt: number, x: string): { value: number; first: number } | 'overlap' | null {
  const isNumberToken = (i: number): boolean => {
    const token = tokens[i]
    return token !== undefined && token !== '이' && punct[i] !== true && (isDigitString(token) || isSinoOnly(token)) && parseKoreanNumber(token) !== null
  }
  const xValue = parseKoreanNumber(x)
  if (xValue === null || !isNumberToken(xAt - 1)) return null
  let value = xValue
  let first = xAt
  let text = x
  for (let i = xAt - 1; i >= 0 && isNumberToken(i); i--) {
    const left = tokens[i] as string
    const leftValue = parseKoreanNumber(left) as number
    if (/^[0-9]$/.test(left) && /^[0-9]$/.test(text) && i === xAt - 1) value = leftValue * 10 + value
    else if (lowestPlace(leftValue) > String(value).length - 1) value = leftValue + value
    // 이어 더하다 겹쳐도 문장 전체 번호·가격을 비운다(D-V3-66 — `1 이십 오번`)
    else return 'overlap'
    first = i
    text = String(value)
  }
  return { value, first }
}

export interface NumberMarkers {
  /** 번호 표시에 속한 토큰 위치 */
  readonly tokens: ReadonlySet<number>
  /** 번호 표시 값 (나온 것 전부) */
  readonly values: readonly number[]
  /** 끊어 말한 번호가 하나라도 있는가 (R-17 3, D-I4-01) */
  readonly split: boolean
  /** 번호 표시 바로 뒤에 한 자리 수만 왔는가 (`60번 3` — 번호만 비움, D-V3-54) */
  readonly trailing?: boolean
}

/**
 * 끊어 말한 번호 (R-17 3, D-I4-01, TD-P2-002): 번호 표시의 X 바로 앞 토큰(그대로 — 끝말을 떼지 않는다)을 X 앞에 공백 없이 붙인 글이
 * R-15로 읽히면 번호를 끊어 말했거나 인식이 번호를 갈랐을 수 있다(`1 5번` → `15`, `십 오번` → `십오`, `이 십 번` → `이십`, `백 오번` → `백오`).
 * 앞 토큰이 없거나 붙인 글이 수가 아니면 해당 없다(`이 15번` → `이15`, `네 15번` → `네15`).
 */
/** 0 토큰(`0`·`영`·`공`)은 합치기와 끊어 말한 번호 검사 둘 다에서 보지 않는다 (D-V3-66 — `0 5번` = 5번) */
const isZeroToken = (token: string | undefined): boolean => token !== undefined && /^(0+|영|공)$/.test(token)

function isSplitNumber(previous: string | undefined, x: string): boolean {
  return previous !== undefined && !isZeroToken(previous) && parseKoreanNumber(previous + x) !== null
}

/**
 * `번` 바로 뒤에만 더 받는 끝말 (실방송 V3: "309번이고요"). R-17 2 끝말 목록(ENDINGS)은 그대로 두고 붙여 쓴 번호 표시에서만 더 뗀다.
 * `번으로`·`번부터`(옮기기·범위 말)는 넣지 않는다.
 */
export const BEON_EXTRA_ENDINGS: readonly string[] = Object.freeze(['이고요', '이구요'])

/** 번호 표시를 찾을 읽는 모양: 읽는 모양 + 토큰 그대로에서 `번` 뒤 더 받는 끝말을 뗀 모양 */
function markerForms(forms: readonly string[]): readonly string[] {
  const token = forms[0]
  if (token === undefined) return forms
  const extra = BEON_EXTRA_ENDINGS.filter((ending) => token.endsWith(BEON + ending)).map((ending) => token.slice(0, -ending.length))
  return extra.length === 0 ? forms : [...forms, ...extra.filter((form) => !forms.includes(form))]
}

/**
 * 번호 표시 찾기 (R-17 3). R-21 7(V1)도 같은 코드를 쓴다: `skip`이 참인 토큰(맡은 토큰)은 표시 토큰이 될 수 없다.
 * 끊어 말한 번호 검사의 앞 토큰은 맡은 토큰이어도 그대로 본다(R-21 7).
 */
export function findNumberMarkers(
  tokens: readonly string[],
  forms: readonly (readonly string[])[],
  skip: (i: number) => boolean = () => false,
  wideSplit = false,
  punct: readonly boolean[] = [],
): NumberMarkers {
  const marked = new Set<number>()
  const values: number[] = []
  let split = false
  /** 앞 수와 합치기(상품 등록만, D-V3-54) 또는 끊어 말한 번호 검사(D-I4-01) */
  const take = (xAt: number, x: string, own: readonly number[]): void => {
    const previous = xAt > 0 ? tokens[xAt - 1] : undefined
    const merged = wideSplit ? mergeLeft(tokens, punct, xAt, x) : null
    if (merged === 'overlap') split = true
    else if (merged !== null) {
      for (let j = merged.first; j < xAt; j++) marked.add(j)
      values.push(merged.value)
      for (const j of own) marked.add(j)
      return
    } else if (isSplitNumber(previous, x)) split = true
    const value = numberValue(x)
    if (value === null) return
    values.push(value)
    for (const j of own) marked.add(j)
  }
  tokens.forEach((token, i) => {
    if (skip(i)) return
    // 붙여 씀: 읽는 모양 하나가 `X번` (앞 토큰 = 표시 토큰의 앞 토큰)
    for (const form of markerForms(forms[i] ?? [])) {
      if (form.length < 2 || !form.endsWith(BEON)) continue
      const x = form.slice(0, -BEON.length)
      if (numberValue(x) === null) continue
      take(i, x, [i])
    }
    // 띄어 씀: 토큰 X(그대로) 바로 다음 토큰의 읽는 모양 하나가 `번` (앞 토큰 = X 토큰의 앞 토큰)
    const next = forms[i + 1]
    if (next !== undefined && next.includes(BEON) && !skip(i + 1) && numberValue(token) !== null) take(i, token, [i, i + 1])
  })
  // 번호 표시 바로 뒤 한 자리 수(`60번 3 …`)는 번호만 비운다(가격은 그대로, D-V3-54)
  let trailing = false
  if (wideSplit) {
    for (const i of marked) if (!marked.has(i + 1) && trailingDigit(tokens, i)) trailing = true
  }
  return { tokens: marked, values, split, trailing }
}

/**
 * 번호 표시 바로 뒤에 한 자리 수 토큰만 오고 그다음이 단위가 아니면(`60번 3 라울 만원`) 63번인지 60번인지 애매하다 (실방송 8차 "63번을 60번으로").
 * `이`는 '이것'이라 보지 않는다. last = 번호 표시의 마지막 토큰
 */
function trailingDigit(tokens: readonly string[], last: number): boolean {
  const next = tokens[last + 1]
  if (next === undefined || !(/^[0-9]$/.test(next) || (next.length === 1 && '일삼사오육칠팔구'.includes(next)))) return false
  const after = tokens[last + 2]
  // 다음이 단위(`3 개`)나 금액 단위로 시작하는 토큰(`2 만원` — 가격의 앞자리)이면 번호 조각이 아니다
  return !isUnitToken(after) && !(after !== undefined && /^[십백천만원]/.test(after))
}

// ── 3b. 자리 읽기 번호 (V3, D-V3-11) ─────────────────────────────────────

/** 한글 자리 글자 (값 = 위치) */
const HANGUL_DIGITS = '공일이삼사오육칠팔구'
const isHangulDigit = (char: string): boolean => char.length === 1 && HANGUL_DIGITS.includes(char)
const digitValue = (char: string): number => (/^[0-9]$/.test(char) ? Number(char) : HANGUL_DIGITS.indexOf(char))
/** 자리 글자 하나로 된 토큰 (`일`·`8`) */
const isDigitToken = (token: string | undefined): boolean => token !== undefined && token.length === 1 && (isHangulDigit(token) || /^[0-9]$/.test(token))
const isThreeHangulDigits = (text: string): boolean => text.length === 3 && [...text].every(isHangulDigit)
/** 자리 셋 → 값 (첫 자리가 0이면 null) */
function digitsValue(chars: readonly string[]): number | null {
  if (chars.length !== 3 || digitValue(chars[0] as string) === 0) return null
  return chars.reduce((sum, char) => sum * 10 + digitValue(char), 0)
}

export interface DigitReading {
  /** 자리 읽기에 든 토큰 위치 (`번` 토큰 포함) */
  readonly tokens: readonly number[]
  readonly value: number
  /** `번`이 붙었는가 (번호 표시) */
  readonly beon: boolean
}

/** R-17 3 자리 읽기: ⓐ 토큰 하나가 한글 자리 글자 셋, ⓑ 이어진 토큰 셋이 저마다 자리 글자 하나 (`번`이 붙으면 번호 표시) */
export function findDigitReadings(tokens: readonly string[], forms: readonly (readonly string[])[]): DigitReading[] {
  const readings: DigitReading[] = []
  const used = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue
    const add = (indices: number[], value: number | null, beon: boolean): boolean => {
      if (value === null) return false
      readings.push({ tokens: indices, value, beon })
      for (const j of indices) used.add(j)
      return true
    }
    const own = forms[i] ?? []
    // ⓐ + 번 (붙여 씀)
    const attached = own.find((form) => form.endsWith(BEON) && isThreeHangulDigits(form.slice(0, -BEON.length)))
    if (attached !== undefined && add([i], digitsValue([...attached.slice(0, -BEON.length)]), true)) continue
    const bare = own.find(isThreeHangulDigits)
    if (bare !== undefined) {
      // ⓐ + 번 (띄어 씀): 토큰 그대로가 자리 글자 셋이고 다음 토큰의 읽는 모양 하나가 `번`
      if (isThreeHangulDigits(tokens[i] as string) && (forms[i + 1] ?? []).includes(BEON) && add([i, i + 1], digitsValue([...(tokens[i] as string)]), true)) {
        i++
        continue
      }
      if (add([i], digitsValue([...bare]), false)) continue
    }
    // ⓑ 토큰 셋 (앞 토큰은 자리 글자 하나가 아니다)
    if (isDigitToken(tokens[i]) && isDigitToken(tokens[i + 1]) && !isDigitToken(tokens[i - 1]) && i + 2 < tokens.length && !isDigitToken(tokens[i + 3])) {
      const third = tokens[i + 2] as string
      const head = [tokens[i] as string, tokens[i + 1] as string]
      if (isDigitToken(third)) {
        // 한글 한 글자가 든 셋(`일 육 팔`·`이 삼 일`)은 '번'이 붙을 때만 자리 읽기다 (D-V3-27). 숫자 셋 `1 6 8`은 '번' 없이도
        if ([...head, third].every((token) => /^[0-9]$/.test(token)) && add([i, i + 1, i + 2], digitsValue([...head, third]), false)) i += 2
        continue
      }
      // `이번`(이번에)은 번호가 아니다 — X가 `이` 한 글자인 표시는 받지 않는다(R-17 3)
      const beonForm = (forms[i + 2] ?? []).find((form) => form.length === 2 && form.endsWith(BEON) && isDigitToken(form.charAt(0)) && form.charAt(0) !== '이')
      if (beonForm !== undefined && add([i, i + 1, i + 2], digitsValue([...head, beonForm.charAt(0)]), true)) i += 2
    }
  }
  return readings
}

// ── 4. 가격 ──────────────────────────────────────────────────────────────

interface PriceBundle {
  readonly start: number
  readonly end: number
  readonly value: number
  /** 읽은 글 (마지막 토큰은 처음 읽힌 읽는 모양) */
  readonly text: string
}

const hasWonOrKoreanAmount = (text: string): boolean => text.includes(WON) || [...text].some((char) => KOREAN_AMOUNT.has(char))
const isAmountToken = (token: string): boolean => token !== '' && [...token].every((char) => AMOUNT_TOKEN_CHARS.has(char))
const isAmountText = (text: string): boolean => [...text].every((char) => AMOUNT_TOKEN_CHARS.has(char))

/** 한 시작 토큰에서 잡을 수 있는 가장 긴 묶음 (없으면 null) */
function longestBundleAt(tokens: readonly string[], forms: readonly (readonly string[])[], start: number, isMarker: (i: number) => boolean): PriceBundle | null {
  let best: PriceBundle | null = null
  for (let length = 1; length <= PRICE_MAX_TOKENS; length++) {
    const end = start + length - 1
    if (end >= tokens.length || isMarker(end)) break
    const prefix = tokens.slice(start, end).join(' ')
    for (const form of forms[end] ?? []) {
      const text = prefix === '' ? form : `${prefix} ${form}`
      const value = parseAmount(text, WON_UNIT)
      if (value === null) continue
      // 처음 읽히는 값이 조건에 맞아야 묶음이다 (뒤의 읽는 모양은 보지 않는다)
      if (value >= 100 && hasWonOrKoreanAmount(text)) best = { start, end, value, text }
      break
    }
  }
  return best
}

const SINO_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const SINO_PLACES: readonly (readonly [string, number])[] = [
  ['천', 1000],
  ['백', 100],
  ['십', 10],
]

/** 1..9999 → 한자어 읽기 (10 `십`, 174 `백칠십사`) */
function sinoBelowMan(n: number): string {
  let text = ''
  for (const [unit, place] of SINO_PLACES) {
    const digit = Math.floor(n / place) % 10
    if (digit !== 0) text += (digit === 1 ? '' : SINO_DIGITS[digit]) + unit
  }
  return text + (SINO_DIGITS[n % 10] as string)
}

/** 1..9999만 → 한자어 읽기 (R-15를 거꾸로 — 30 `삼십`, 35000 `삼만오천`). 범위 밖이면 null */
export function numberToSino(n: number): string | null {
  if (!Number.isSafeInteger(n) || n < 1 || n > 99_999_999) return null
  const man = Math.floor(n / 10000)
  const rest = n % 10000
  return (man === 0 ? '' : `${man === 1 ? '' : sinoBelowMan(man)}만`) + (rest === 0 ? '' : sinoBelowMan(rest))
}

/** 토큰의 숫자 부분을 한자어로 바꾼 글 (`5만` → `오만`). `,`·`.`가 있거나 바꿀 수 없으면 null */
function tokenToSino(token: string): string | null {
  if (/[,.]/.test(token)) return null
  let failed = false
  const text = token.replace(/[0-9]+/g, (digits) => {
    const sino = numberToSino(Number(digits))
    if (sino === null) failed = true
    return sino ?? ''
  })
  return failed ? null : text
}

/** 원 가격 줄 (R-17 4, D-V3-03): `원`으로 끝나는 토큰 T와 그 왼쪽으로 이어진 금액 글자 토큰 */
interface WonLine {
  readonly start: number
  readonly end: number
  /** 읽은 값 — 애매하면 null */
  readonly value: number | null
}

/**
 * `원` 바로 뒤에만 더 받는 끝말 (실방송 V3: "5만 원으로"·"5만 원부터"·"5만 원이고요"). R-17 2 끝말 목록(ENDINGS)은 그대로 두고
 * 원 가격 줄의 `원` 토큰에서만 한 번 더 뗀다 — 다른 토큰의 읽는 모양·품종 창은 바뀌지 않는다.
 */
export const WON_EXTRA_ENDINGS: readonly string[] = Object.freeze(['으로', '부터', '이고요', '이구요'])

/** 토큰의 읽는 모양 가운데 `원`으로 끝나고 `원` 앞 글이 비었거나 금액 글자뿐인 첫 모양 */
function wonForm(forms: readonly string[]): string | null {
  const isWon = (form: string): boolean => form.endsWith(WON) && isAmountText(form.slice(0, -WON.length))
  const found = forms.find(isWon)
  if (found !== undefined) return found
  const token = forms[0]
  if (token === undefined) return null
  for (const ending of WON_EXTRA_ENDINGS) {
    if (token.length > ending.length && token.endsWith(ending) && isWon(token.slice(0, -ending.length))) return token.slice(0, -ending.length)
  }
  return null
}

/** 줄 글을 읽은 값: 공백으로 이어 R-14, 안 되면(토큰 둘 이상) 숫자를 한자어로 바꿔 붙여 R-14. 100원 미만·안 읽힘은 null */
function readLine(parts: readonly string[]): number | null {
  let value = parseAmount(parts.join(' '), WON_UNIT)
  if (value === null && parts.length >= 2) {
    const converted = parts.map(tokenToSino)
    if (converted.some((text) => text === null)) return null
    // 앞 수와 뒤 토큰의 자리가 겹치면 붙여 읽지 않는다 — `108 12만` → `백팔십이만`(182만)으로 잘못 읽히지 않게 (D-V3-25)
    for (let i = 0; i + 1 < parts.length; i++) {
      const left = parseKoreanNumber(parts[i] as string)
      if (left !== null && placesOverlap(left, parts[i + 1] as string)) return null
    }
    value = parseAmount(converted.join(''), WON_UNIT)
  }
  return value !== null && value >= 100 ? value : null
}

/** '번' 없는 번호로 읽을 수 있는 토큰 그대로의 값 (숫자 1~4자리 또는 한자어 수사 2글자 이상, 1..max) — 아니면 null */
export function plainNumberValue(text: string, maxNumber: number): number | null {
  if (!isDigitString(text) && !(isSinoOnly(text) && text.length >= 2)) return null
  const value = parseKoreanNumber(text)
  return value !== null && value >= 1 && value <= maxNumber ? value : null
}

/**
 * 원 가격 줄 찾기 (D-V3-03, V3 사용자 추가 요구): '원' 앞 금액 글자 토큰을 왼쪽 끝부터 붙여 읽어 보고, 읽히는 가장 긴 줄을 쓴다.
 * 자리가 겹치거나 올라가 함께 읽히지 않는 왼쪽 토큰(`170 25만 원`의 170, `3 5만 원`의 3)은 줄에서 빠진다 — 빠진 토큰이
 * '번' 없는 번호로 읽히는 수가 아니면(`1.5`·범위 밖) 줄이 애매하다. 'N번'이 있어 '번' 없는 번호를 보지 않는 문장에서는 빠진 토큰을
 * 설명할 수 없으니 애매하다(`15번 라울 174 28만 원`·`15번 3 5만 원` — 골든 그대로). 읽힌 줄의 첫 토큰이 `이` 한 글자면 애매하다.
 */
function findWonLines(tokens: readonly string[], forms: readonly (readonly string[])[], isMarker: (i: number) => boolean, maxNumber: number, allowDrop: boolean): WonLine[] {
  const lines: WonLine[] = []
  for (let end = 0; end < tokens.length; end++) {
    if (isMarker(end)) continue
    const form = wonForm(forms[end] ?? [])
    if (form === null) continue
    let start = end
    while (start - 1 >= 0 && !isMarker(start - 1) && isAmountToken(tokens[start - 1] as string)) start--
    let line: WonLine = { start, end, value: null }
    for (let from = start; from <= end; from++) {
      const value = readLine([...tokens.slice(from, end), form])
      if (value === null) continue
      const dropped = tokens.slice(start, from)
      if (tokens[from] === '이' || (dropped.length > 0 && (!allowDrop || isUnitOnly(tokens[from] as string) || readingForms(tokens[from] as string).some(isUnitOnly))) || dropped.some((token) => plainNumberValue(token, maxNumber) === null) || (dropped.length > 0 && !placesOverlap(plainNumberValue(dropped[dropped.length - 1] as string, maxNumber) as number, tokens[from] as string))) break
      line = { start: from, end, value }
      break
    }
    lines.push(line)
  }
  return lines
}

interface PriceReading {
  readonly price: number | null
  /** 가격 묶음·원 가격 줄 토큰 */
  readonly tokens: ReadonlySet<number>
  /** 원 가격 줄이 하나 이상 있는가 */
  readonly wonLines: number
  /** 원 가격 줄의 끝 토큰 위치 (나온 차례) */
  readonly wonLineEnds: readonly number[]
  /** 원 가격 줄의 읽힌 값 (애매한 줄은 빼고) */
  readonly wonLineValues: readonly number[]
  /** 읽힌 값 전부 (나온 차례) */
  readonly values: readonly number[]
  /** '번' 없는 번호 후보 (토큰 위치 → 값) */
  readonly bare: ReadonlyMap<number, number>
  /** '번' 없는 번호를 끊어 말했는가 */
  readonly bareSplit: boolean
}

/** '번' 없는 번호 바로 다음 토큰(그대로 또는 끝말 뗀 모양)이 이 낱말이면 후보가 아니다 (R-17 3 단위 낱말, D-V3-23) */
export const BARE_NUMBER_UNITS: readonly string[] = Object.freeze(['원', '만', '천', '백', 'cm', '센치', '센티', 'mm', '미리', '개', '마리', '살', '년', '월', '일', '시', '분', '초', '키로', 'kg', '그램', '프로', '등', '위', '번째'])
/** '번' 없는 번호 뒤에 붙어도 되는 끝말 (`168은`) */
const BARE_NUMBER_ENDINGS: readonly string[] = ['은', '는', '이', '가', '요']

const isUnitToken = (token: string | undefined): boolean => token !== undefined && readingForms(token).some((form) => BARE_NUMBER_UNITS.includes(form) || BARE_NUMBER_UNITS.includes(form.toLowerCase()))

/** 값을 묻는 말 (실방송 V3: "요거 얼마 드릴까 50" — 50은 번호가 아니라 가격을 생각하는 말). 이 낱말로 시작하는 토큰이 */
export const PRICE_ASK_PREFIX = '얼마'
/** 바로 앞 몇 토큰 안에 있으면 '번' 없는 번호 후보가 아니다 */
const PRICE_ASK_REACH = 3
const afterPriceAsk = (tokens: readonly string[], i: number): boolean => tokens.slice(Math.max(0, i - PRICE_ASK_REACH), i).some((token) => token.startsWith(PRICE_ASK_PREFIX))

/** 같은 조각 뒤쪽(사이에 다른 수 없이)에 그 수를 계수로 한 금액 토큰(`25만`·`25만원`·`이십오만`·`5천`)이 있는가 — '번' 없는 수가 가격을 되풀이한 것 */
function repeatsPrice(tokens: readonly string[], i: number, value: number): boolean {
  // 같은 조각 안에서 뒤로 끝까지 본다 — 사이에 다른 수(숫자로 시작하는 토큰·'N번')가 오면 멈춘다 (실방송 "15 응 이모 … 자 15만 원")
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j] as string
    if (/[만천]/.test(token) && priceCoefficient(token) === value) return true
    if (/^[0-9]/.test(token) || readingForms(token).some((form) => form.endsWith(BEON) && form.length > 1)) return false
  }
  return false
}

export interface BareNumbers {
  /** 후보 토큰 위치 → 값 */
  readonly values: ReadonlyMap<number, number>
  /** 끊어 말한 번호가 있는가 (`백 육십팔`·`1 68`) — 있으면 no = null */
  readonly split: boolean
}

/** '번' 없는 번호 후보 (R-17 3, D-V3-23): 따로 선 수 낱말(끝말 은·는·이·가·요 허용)이고 바로 다음 토큰이 단위 낱말이 아니고 바로 앞 3토큰 안에 `얼마…`가 없는 것 */
export function findBareNumbers(tokens: readonly string[], blocked: (i: number) => boolean, maxNumber: number): BareNumbers {
  const values = new Map<number, number>()
  let split = false
  let repeated = false
  tokens.forEach((token, i) => {
    if (blocked(i) || isUnitToken(tokens[i + 1]) || afterPriceAsk(tokens, i)) return
    for (const form of [token, ...BARE_NUMBER_ENDINGS.filter((ending) => token.length > ending.length && token.endsWith(ending)).map((ending) => token.slice(0, -ending.length))]) {
      const value = plainNumberValue(form, maxNumber)
      if (value === null) continue
      // 가격을 두 번 말한 것 (실방송 V3: "너무예쁜데 25 자 25만 원" — 25는 번호가 아니다)
      if (repeatsPrice(tokens, i, value)) {
        repeated = true
        return
      }
      values.set(i, value)
      const previous = tokens[i - 1]
      if (previous !== undefined && parseKoreanNumber(previous + form) !== null) split = true
      return
    }
  })
  // 가격 되풀이로 뺀 수가 있는데 다른 수가 남으면 애매하다 (`25 1 25만 원` — 1번으로 정하지 않는다)
  if (repeated && values.size > 0) split = true
  return { values, split }
}

/** 자리 읽기('번' 없음)가 번호 후보 조건(R-17 3)에 맞는가 */
function isBareDigitCandidate(tokens: readonly string[], reading: DigitReading): boolean {
  const last = reading.tokens[reading.tokens.length - 1] as number
  if (isUnitToken(tokens[last + 1]) || afterPriceAsk(tokens, reading.tokens[0] as number)) return false
  if (reading.tokens.length !== 1) return true
  const token = tokens[last] as string
  return isThreeHangulDigits(token) || BARE_NUMBER_ENDINGS.some((ending) => token.endsWith(ending) && isThreeHangulDigits(token.slice(0, -ending.length)))
}

/** 줄 꼬리 첫 토큰의 수 부분 (`25만` → 25, `오만` → 5, `5천` → 5). 못 읽으면 null */
function leadingCoefficient(token: string): number | null {
  const digits = /^[0-9]+/.exec(token)
  if (digits !== null) return Number(digits[0])
  // 단위만인 토큰(`백`·`천`·`만원`)은 계수가 없다 — 앞 수가 그 단위의 계수다 (`5 백` = 오백)
  if ([...token].every((char) => '십백천만원'.includes(char))) return null
  const head = token.split(/[만천원]/)[0] ?? ''
  return head === '' ? null : parseKoreanNumber(head)
}

/**
 * 가격 되풀이(repeatsPrice)에서 보는 금액 토큰의 계수: leadingCoefficient와 같되, 단위 글자만인 한글 금액(`십만`·`백만원`)은
 * 만 앞의 단위 글자를 수로 읽는다(`십만` → 10, `백만` → 100) — "10 자 십만 원"을 "10 자 10만 원"과 같게 (TD-V3-014).
 * 단위 하나만인 토큰(`만`·`천`·`만원`)은 여전히 계수 없음.
 */
function priceCoefficient(token: string): number | null {
  const unitOnly = /^([십백천]+)만원?$/.exec(token)
  if (unitOnly !== null) return parseKoreanNumber(unitOnly[1] as string)
  return leadingCoefficient(token)
}

/**
 * 뗀 수와 꼬리 첫 토큰이 '자리 겹침'으로만 함께 읽히지 않는가 (TD-V3-002): 뗀 수의 가장 낮은 0 아닌 자리 ≤ 꼬리 수의 가장 높은 자리.
 * `170 25만`(십의 자리 겹침) → 참. `100 5만`(백오만 — 자리는 안 겹치고 다른 까닭으로 안 읽힘) → 거짓(줄이 애매).
 */
function placesOverlap(dropped: number, tail: string): boolean {
  const coefficient = leadingCoefficient(tail)
  if (coefficient === null || coefficient < 1) return false
  let lowest = 0
  for (let n = dropped; n % 10 === 0 && n > 0; n /= 10) lowest++
  return lowest <= String(coefficient).length - 1
}

/** 십·백·천·만·원으로만 된 토큰 (`만원`·`천`·`원`) — 줄 꼬리의 첫 토큰이면 앞 토큰을 떼지 않는다 */
const isUnitOnly = (text: string): boolean => text !== '' && [...text].every((char) => '십백천만원'.includes(char))

function findPrice(
  tokens: readonly string[],
  forms: readonly (readonly string[])[],
  isMarker: (i: number) => boolean,
  options: { readonly maxNumber: number; readonly bareNumbers: boolean },
): PriceReading {
  const allLines = findWonLines(tokens, forms, isMarker, options.maxNumber, options.bareNumbers)
  const inLine = new Set<number>()
  // 지난 일로 말한 가격(`120만 원까지 팔아 본 적 있어요`)은 가격으로 쓰지 않는다 — 토큰은 줄로 남겨 묶음·품종 창이 되지 않게
  for (const line of allLines) for (let j = line.start; j <= line.end; j++) inLine.add(j)
  const lines = allLines.filter((line) => !isPastPriceLine(tokens, line.end))
  // '번' 없는 번호는 원 가격 줄 다음, 가격 묶음 전에 잡는다 — `백육십팔`이 168원 묶음이 되지 않게
  const bareNumbers = options.bareNumbers ? findBareNumbers(tokens, (i) => isMarker(i) || inLine.has(i), options.maxNumber) : { values: new Map<number, number>(), split: false }
  const bare = bareNumbers.values
  const blocked = (i: number): boolean => isMarker(i) || inLine.has(i) || bare.has(i)
  const bundles: PriceBundle[] = []
  let i = 0
  while (i < tokens.length) {
    if (blocked(i)) {
      i++
      continue
    }
    const bundle = longestBundleAt(tokens, forms, i, blocked)
    if (bundle === null) {
      i++
      continue
    }
    bundles.push(bundle)
    i = bundle.end + 1
  }
  const inBundle = new Set<number>(inLine)
  for (const bundle of bundles) for (let j = bundle.start; j <= bundle.end; j++) inBundle.add(j)
  // 금액 조각: 이웃 토큰이 번호 표시나 다른 묶음(원 가격 줄 포함)에 속하면 보지 않는다
  const fragmentNeighbour = (j: number): boolean => j >= 0 && j < tokens.length && !isMarker(j) && !bare.has(j) && !inBundle.has(j) && isAmountToken(tokens[j] as string)
  const ambiguous =
    lines.some((line) => line.value === null) ||
    bundles.some(
      (bundle) =>
        (UNIT_START.has(bundle.text.charAt(0)) && fragmentNeighbour(bundle.start - 1)) || (!bundle.text.endsWith(WON) && fragmentNeighbour(bundle.end + 1)),
    )
  const ordered = [...lines.map((line) => ({ at: line.start, value: line.value })), ...bundles.map((bundle) => ({ at: bundle.start, value: bundle.value as number | null }))].sort((a, b) => a.at - b.at)
  const values = ordered.map((item) => item.value).filter((value): value is number => value !== null)
  const distinct = new Set(values)
  const price = !ambiguous && distinct.size === 1 ? (values[0] as number) : null
  return { price, tokens: inBundle, wonLines: lines.length, wonLineEnds: lines.map((line) => line.end), wonLineValues: lines.map((line) => line.value).filter((value): value is number => value !== null), values, bare, bareSplit: bareNumbers.split }
}

// ── 5. 품종 ──────────────────────────────────────────────────────────────

/** 숫자 하나가 붙은 토큰 (R-17 5, D-V3-12): `3강` → `삼강`. 해당 없으면 null */
export function oneDigitReading(text: string): string | null {
  if (!/^[0-9][가-힣]/.test(text)) return null
  return (SINO_DIGITS[Number(text.charAt(0))] || '영') + text.slice(1)
}

/** 창에서 쓰는 읽는 모양: 읽는 모양마다 숫자 하나가 붙은 모양도 더한다 */
export function windowForms(token: string): string[] {
  const forms = readingForms(token)
  const extra = forms.map(oneDigitReading).filter((form): form is string => form !== null)
  return [...forms, ...extra.filter((form) => !forms.includes(form))]
}

/** 창의 글(공백 없이 이은 것, 마지막 토큰은 읽는 모양마다 — 앞 토큰은 그대로·숫자 하나 바꾼 모양) 전부 */
export function windowTexts(tokens: readonly string[], forms: readonly (readonly string[])[], excluded: (i: number) => boolean): Set<string> {
  const texts = new Set<string>()
  const variants = (j: number): string[] => {
    const token = tokens[j] as string
    const converted = oneDigitReading(token)
    return converted === null ? [token] : [token, converted]
  }
  let segmentStart = 0
  for (let i = 0; i <= tokens.length; i++) {
    if (i < tokens.length && !excluded(i)) continue
    // [segmentStart, i) = 뺀 토큰에서 끊긴 덩어리
    for (let start = segmentStart; start < i; start++) {
      let prefixes = ['']
      for (let end = start; end < i && end < start + WINDOW_MAX_TOKENS; end++) {
        for (const prefix of prefixes) for (const form of forms[end] ?? []) texts.add(prefix + form)
        prefixes = prefixes.flatMap((prefix) => variants(end).map((variant) => prefix + variant))
      }
    }
    segmentStart = i + 1
  }
  return texts
}
/** 창 하나와 사전 이름의 거리 함수 (limit을 넘으면 limit보다 큰 값) */
function distanceFrom(jamo: readonly number[], dictionary: VarietyDictionary): (entry: DictionaryEntry, limit: number) => number {
  if (jamo.length > BIT_PATTERN_MAX) {
    const pattern = new JamoPattern(jamo)
    return (entry) => pattern.distanceTo(entry.jamo)
  }
  // 사전 기호 번호로 일치 비트를 만든다 — 사전에 없는 자모는 어떤 이름과도 맞지 않는다
  const peq = new Int32Array(dictionary.symbols.size)
  jamo.forEach((code, i) => {
    const id = dictionary.symbols.get(code)
    if (id !== undefined) peq[id] = (peq[id] as number) | (1 << i)
  })
  return (entry, limit) => bitParallelDistance(jamo.length, peq, entry.ids, limit)
}

export interface VarietyMatch {
  readonly name: string | null
  readonly exact: boolean
  /** 그 이름을 낸 창 글 (공백 없이) — 이름이 없으면 null */
  readonly window: string | null
}

const SAEKGEUP = '색급'
const SAEKGEUM = '색금'

export function findVariety(texts: ReadonlySet<string>, dictionary: VarietyDictionary): VarietyMatch {
  const top: { similarity: Similarity | null; readonly entries: Map<string, DictionaryEntry>; readonly windows: Map<string, string> } = { similarity: null, entries: new Map(), windows: new Map() }
  const consider = (similarity: Similarity, entry: DictionaryEntry, text: string): void => {
    const order = top.similarity === null ? 1 : compareSimilarity(similarity, top.similarity)
    if (order > 0) {
      top.similarity = similarity
      top.entries.clear()
      top.windows.clear()
    }
    if (order >= 0) {
      top.entries.set(entry.key, entry)
      if (!top.windows.has(entry.key)) top.windows.set(entry.key, text)
    }
  }
  // 유사도 1(공백만 다름)이 하나라도 있으면 그보다 높은 유사도는 없다 — 거리 계산을 건너뛴다
  for (const text of texts) {
    const jamo = jamoOf(text)
    for (const entry of dictionary.byJamo.get(jamoKey(jamo)) ?? []) consider({ distance: 0, length: jamo.length }, entry, text)
    // 크롬이 이름 끝 '색금'을 '색급'으로 자주 적는다 — 끝의 '색급'은 '색금'으로도 맞춘다(같은 이름으로 봄). 사전에 그 이름이 없으면 그대로(`몰디브 색급` → 몰디브)
    if (text.length > SAEKGEUP.length && text.endsWith(SAEKGEUP)) {
      const fixed = jamoOf(text.slice(0, -SAEKGEUP.length) + SAEKGEUM)
      for (const entry of dictionary.byJamo.get(jamoKey(fixed)) ?? []) consider({ distance: 0, length: fixed.length }, entry, text)
    }
  }
  if (top.similarity === null) {
    for (const text of texts) {
      const jamo = jamoOf(text)
      // 풀이말 끝 모양 창(D-V3-30·38)은 비슷함으로 사전 이름에 맞추지 않는다 — `보니까` → 보니타가 되지 않게(AC-V3-50). 공백만 다른 맞춤은 그대로
      // 흔한 말 별칭(`녹음` → 녹금, D-V3-54)은 비슷함으로도 맞추지 않는다 — 'N번' 조각 안에서만(segments.ts)
      if (jamo.length === 0 || looksLikePredicate(text) || DEFAULT_COMMON_ALIASES.has(text)) continue
      const distance = distanceFrom(jamo, dictionary)
      const range = candidateLengthRange(jamo.length)
      for (let length = range.min; length <= range.max; length++) {
        const longer = Math.max(jamo.length, length)
        // 길이 차만으로도 지금 가장 높은 유사도에 못 미치면 그 길이의 이름은 보지 않는다 (같은 유사도는 봐야 한다 — 동률 판단)
        if (top.similarity !== null && compareSimilarity({ distance: Math.abs(jamo.length - length), length: longer }, top.similarity) < 0) continue
        const limit = Math.floor(longer / 5)
        for (const entry of dictionary.byLength.get(length) ?? []) {
          // 적은 모양으로만 맞추는 짧은 이름(콜리·퍼플·창금·황소)은 비슷함으로 맞추지 않는다
          if (DEFAULT_EXACT_ONLY.has(entry.name)) continue
          const similarity = { distance: distance(entry, limit), length: longer }
          if (isCandidate(similarity)) consider(similarity, entry, text)
        }
      }
    }
  }
  if (top.similarity === null) return { name: null, exact: false, window: null }
  const entries = [...top.entries.values()]
  // 가장 높은 유사도의 이름이 여럿이면 나머지를 모두 품는(공백 뺀 글자로 부분 문자열) 이름만
  // 같은 이름의 다른 모양(이름·별칭 — `상관세금`·`삼강색급`이 모두 삼광색금)만 맞았으면 그 이름이다
  const container = entries.find((entry) => entries.every((other) => other.name === entry.name || entry.key.includes(other.key)))
  if (container === undefined) return { name: null, exact: false, window: null }
  return { name: container.name, exact: top.similarity.distance === 0, window: top.windows.get(container.key) ?? null }
}

// ── 추출 ─────────────────────────────────────────────────────────────────

function resolveMaxNumber(options: unknown): number {
  const value = typeof options === 'object' && options !== null ? (options as { maxNumber?: unknown }).maxNumber : undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_MAX_NUMBER
}

function resolveDictionary(options: unknown): VarietyDictionary {
  const value = typeof options === 'object' && options !== null ? (options as { dictionary?: unknown }).dictionary : undefined
  if (value instanceof VarietyDictionary) return value
  return new VarietyDictionary(Array.isArray(value) ? value : [])
}

/**
 * 문장 하나 → { no, name, price, confidence } (R-17).
 * - no: 번호 표시(`X번`·`X 번`, X = 숫자 1~4자리 또는 한자어 수사, `이` 제외, V3 자리 읽기 + `번`) 값이 모두 같고 1..maxNumber 안이고 끊어 말한 번호가 없으면 그 값.
 *   번호 표시가 없으면 `번` 없는 자리 읽기(`일육팔`·`1 6 8`, D-V3-11) 값
 * - price: 원 가격 줄(D-V3-03)과 가격 묶음 값이 모두 같고 애매한 줄·금액 조각·끊어 말한 번호가 없으면 그 값
 * - 끊어 말한 번호(D-I4-01): 번호 표시의 X 바로 앞 토큰 + X가 R-15로 읽히는 표시가 하나라도 있으면 no·price 모두 null
 * - name: 사전에서 자모 유사도 0.8 이상으로 가장 가까운 이름(여럿이면 나머지를 모두 품는 이름) — 사전에 없는 말은 넣지 않는다
 * - confidence: 셋이 모두 있고 품종이 사전 이름과 공백만 다르면 HIGH
 */
export function extractVoice(text: unknown, options: ExtractOptions = {}): VoiceExtraction {
  return { ...readSentence(text, options).extraction }
}

/** 한 문장을 R-17로 읽은 자세한 결과 (V2 정정·후보 층이 쓴다 — extractVoice 결과는 `extraction` 그대로) */
export interface SentenceReading {
  readonly extraction: VoiceExtraction
  /** 품종이 사전 이름·별칭과 공백만 다른가 */
  readonly nameExact: boolean
  /** 품종을 낸 창 글(공백 없이) — 품종이 없으면 null */
  readonly nameWindow: string | null
  /** 품종 창 글 전부 (번호 표시·가격 묶음 토큰을 뺀 R-17 5의 창) */
  readonly windows: ReadonlySet<string>
  /** 번호 표시·가격 묶음 토큰을 뺀 나머지 글 (공백 하나로 이음, D-V2-18 칸 이름 품종) */
  readonly rest: string
}

/** V3 읽기의 속 (품종 추측 R-17 7·확정 읽기 R-17 8이 쓴다) */
export interface SentenceAnalysis {
  readonly reading: SentenceReading
  readonly tokens: readonly string[]
  /** 번호 토큰 묶음(첫 번호 표시, 없으면 첫 자리 읽기)의 첫·마지막 토큰 위치 — 번호 표시·자리 읽기가 없으면 null */
  readonly numberSpan: { readonly first: number; readonly last: number } | null
  /** 번호 표시·자리 읽기·가격 묶음·원 가격 줄 토큰 */
  readonly claimedTokens: ReadonlySet<number>
  /** 원 가격 줄 수 (R-17 8: 하나 이상이어야 가격 확정) */
  readonly wonLines: number
  /** 들린 번호 값 전부 (번호 표시가 있으면 그 값들, 없으면 `번` 없는 자리 읽기 값들 — 겹친 값은 한 번) */
  readonly heardNumbers: readonly number[]
  /** 읽힌 가격 값 전부 (겹친 값은 한 번) */
  readonly heardPrices: readonly number[]
  /** 원 가격 줄에서 읽힌 값 (겹친 값은 한 번) — 정정 덩어리의 덮은 가격이 '원'으로 들렸는지 본다(D-V3-44) */
  readonly wonPrices: readonly number[]
  /** no가 '번' 없는 번호이고 그 후보 토큰 하나가 글의 마지막 토큰인가 (R-17 8, D-V3-26) */
  readonly bareNumberAtEnd: boolean
  /** no를 낸 것: 'N번'(자리 읽기 + 번 포함) = marker, '번' 없는 번호 = bare, no가 없으면 null */
  readonly numberFrom: 'marker' | 'bare' | null
  /** no가 '번' 없는 번호이고 그 후보 토큰(처음 나온 것)이 첫 원 가격 줄보다 뒤에 있는가 (D-V3-34) (다음 상품 번호를 부르기 시작한 것일 수 있다) */
  readonly bareNumberAfterPrice: boolean
}

const EMPTY_READING: SentenceReading = Object.freeze({ extraction: EMPTY, nameExact: false, nameWindow: null, windows: Object.freeze(new Set<string>()), rest: '' })
const EMPTY_ANALYSIS: SentenceAnalysis = Object.freeze({
  reading: EMPTY_READING,
  tokens: Object.freeze([]),
  numberSpan: null,
  claimedTokens: Object.freeze(new Set<number>()),
  wonLines: 0,
  heardNumbers: Object.freeze([]),
  heardPrices: Object.freeze([]),
  wonPrices: Object.freeze([]),
  bareNumberAtEnd: false,
  numberFrom: null,
  bareNumberAfterPrice: false,
})

/** 이어진 위치들의 첫 묶음 (위치 집합에서 가장 앞의 이어진 덩어리) */
function firstSpan(indices: Iterable<number>): { first: number; last: number } | null {
  const sorted = [...indices].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const first = sorted[0] as number
  let last = first
  for (const i of sorted.slice(1)) {
    if (i !== last + 1) break
    last = i
  }
  return { first, last }
}

/** R-17 한 문장 읽기 (extractVoice와 같은 계산, 창·정확도까지) */
export function readSentence(text: unknown, options: ExtractOptions = {}): SentenceReading {
  return analyzeSentence(text, options).reading
}

/** R-17 1~6 읽기 + V3 속 결과 */
export function analyzeSentence(text: unknown, options: ExtractOptions = {}): SentenceAnalysis {
  const tokens = tokenize(text)
  if (tokens === null || tokens.length === 0) return EMPTY_ANALYSIS
  const maxNumber = resolveMaxNumber(options)
  const dictionary = resolveDictionary(options)
  const forms = tokens.map(readingForms)

  // 자리 읽기(D-V3-11): `번`이 붙은 것은 번호 표시 — 끊어 말한 번호 검사를 하지 않으므로 지금 번호 표시 찾기에서 뺀다
  const digits = findDigitReadings(tokens, forms)
  const digitTokens = new Set(digits.flatMap((reading) => reading.tokens))
  const beonDigitTokens = new Set(digits.filter((reading) => reading.beon).flatMap((reading) => reading.tokens))
  // R-17(상품 등록)은 넓은 끊김 검사(실방송 8차 — '오 13번'·'오십 13번'), 음성 문자찜(R-21)은 그대로
  const markers = findNumberMarkers(tokens, forms, (i) => beonDigitTokens.has(i), true, punctuatedTokens(text))
  const beonValues = [...markers.values, ...digits.filter((reading) => reading.beon).map((reading) => reading.value)]
  const isMarker = (i: number): boolean => markers.tokens.has(i) || digitTokens.has(i)
  // '번' 없는 번호(자리 읽기·따로 선 수)는 번호 표시가 하나도 없을 때만 본다 (V3: 'N번' > '번' 없는 번호)
  const bundles = findPrice(tokens, forms, isMarker, { maxNumber, bareNumbers: beonValues.length === 0 })
  const bareCandidates = [
    // 자리 읽기도 '번' 없는 번호 후보 조건을 따른다(TD-V3-001): 끝말은 은·는·이·가·요만, 다음 토큰이 단위 낱말이면 아님
    ...digits.filter((reading) => !reading.beon && isBareDigitCandidate(tokens, reading)).map((reading) => ({ tokens: reading.tokens, value: reading.value })),
    ...[...bundles.bare].map(([i, value]) => ({ tokens: [i] as readonly number[], value })),
  ].sort((a, b) => (a.tokens[0] as number) - (b.tokens[0] as number))
  const heard = beonValues.length > 0 ? beonValues : bareCandidates.map((candidate) => candidate.value)
  const distinctNumbers = new Set(heard)
  const onlyNumber = distinctNumbers.size === 1 ? (heard[0] as number) : null
  // 끊어 말한 번호가 있으면 번호·가격을 모두 비운다 — 앞 조각이 가격으로도 읽힐 수 있다(`백 오번`의 `백` = 100원, D-I4-01)
  const no = !markers.split && markers.trailing !== true && !(beonValues.length === 0 && bundles.bareSplit) && onlyNumber !== null && onlyNumber >= 1 && onlyNumber <= maxNumber ? onlyNumber : null

  const price = markers.split ? null : bundles.price
  // 가격을 비워도 묶음 토큰은 품종 창에서 뺀다 (R-17 4·5)
  const excluded = (i: number): boolean => isMarker(i) || bundles.tokens.has(i) || bundles.bare.has(i)
  // 군말 토큰(`자`·`요`·`얘는`·`요거` 등)은 품종 창에서 뺀다 — 군말이 끼거나 군말로 시작한 창이 사전 이름에 맞지 않게(실방송: `자`+`보…` → 자보)
  const windows = windowTexts(tokens, tokens.map(windowForms), (i) => excluded(i) || isWindowFiller(tokens[i] as string))
  const variety = findVariety(windows, dictionary)

  const confidence: Confidence = no !== null && price !== null && variety.name !== null && variety.exact ? 'HIGH' : 'LOW'
  const reading: SentenceReading = {
    extraction: { no, name: variety.name, price, confidence },
    nameExact: variety.name !== null && variety.exact,
    nameWindow: variety.window,
    windows,
    rest: tokens.filter((_, i) => !excluded(i)).join(' '),
  }
  const beonTokens = new Set<number>([...markers.tokens, ...beonDigitTokens])
  const claimed = new Set<number>([...markers.tokens, ...digitTokens, ...bundles.tokens, ...bundles.bare.keys()])
  // 품종 추측의 번호 토큰: 첫 번호 표시, 없으면 no와 같은 값의 첫 번호 후보 (R-17 7)
  const bareChosen = bareCandidates.find((candidate) => candidate.value === no)
  const bareSpan = bareChosen === undefined ? null : { first: bareChosen.tokens[0] as number, last: bareChosen.tokens[bareChosen.tokens.length - 1] as number }
  return {
    reading,
    tokens,
    numberSpan: beonTokens.size > 0 ? firstSpan(beonTokens) : bareSpan,
    claimedTokens: claimed,
    wonLines: bundles.wonLines,
    heardNumbers: [...distinctNumbers],
    heardPrices: [...new Set(bundles.values)],
    wonPrices: [...new Set(bundles.wonLineValues)],
    bareNumberAtEnd: beonValues.length === 0 && no !== null && bareCandidates.some((candidate) => candidate.tokens.includes(tokens.length - 1)),
    numberFrom: no === null ? null : beonValues.length > 0 ? 'marker' : 'bare',
    bareNumberAfterPrice:
      beonValues.length === 0 && no !== null && bareChosen !== undefined && bundles.wonLineEnds.length > 0 && (bundles.wonLineEnds[0] as number) < (bareChosen.tokens[0] as number),
  }
}

// ── V3 조각 읽기용 (D-V3-46) ─────────────────────────────────────────────

/** 번호 표시 하나 (`N번`·`N 번`·자리 읽기 + 번) — 토큰 위치와 값 */
export interface NumberMarker {
  readonly start: number
  readonly last: number
  readonly value: number
}

/** 덩어리 토큰의 번호 표시 목록 (앞에서부터, 상품 등록 규칙 — 앞 수와 합치기 D-V3-54 포함). 끊어 말한(겹쳐 합칠 수 없는) 표시·뒤에 한 자리 수가 오는 표시는 split 참 */
export function listNumberMarkers(tokens: readonly string[], punct: readonly boolean[] = []): (NumberMarker & { readonly split: boolean })[] {
  const forms = tokens.map(readingForms)
  const digits = findDigitReadings(tokens, forms).filter((reading) => reading.beon)
  const digitTokens = new Set(digits.flatMap((reading) => reading.tokens))
  const out: (NumberMarker & { split: boolean })[] = digits.map((reading) => ({ start: reading.tokens[0] as number, last: reading.tokens[reading.tokens.length - 1] as number, value: reading.value, split: false }))
  const bySplit = new Set<number>()
  const take = (xAt: number, x: string, last: number): void => {
    const merged = mergeLeft(tokens, punct, xAt, x)
    if (merged !== null && merged !== 'overlap') {
      out.push({ start: merged.first, last, value: merged.value, split: trailingDigit(tokens, last) })
      return
    }
    const hard = merged === 'overlap' || isSplitNumber(xAt > 0 ? tokens[xAt - 1] : undefined, x)
    if (hard) bySplit.add(xAt)
    out.push({ start: xAt, last, value: numberValue(x) as number, split: hard || trailingDigit(tokens, last) })
  }
  const isSplitByMerge = (marker: NumberMarker): boolean => bySplit.has(marker.start)
  for (let i = 0; i < tokens.length; i++) {
    if (digitTokens.has(i)) continue
    const attached = markerForms(forms[i] ?? []).find((form) => form.length >= 2 && form.endsWith(BEON) && numberValue(form.slice(0, -BEON.length)) !== null)
    if (attached !== undefined) {
      take(i, attached.slice(0, -BEON.length), i)
      continue
    }
    const token = tokens[i] as string
    if (!digitTokens.has(i + 1) && (forms[i + 1] ?? []).includes(BEON) && numberValue(token) !== null) {
      take(i, token, i + 1)
      i++
    }
  }
  // 번호 뒤 한 자리 수가 다음 번호 표시의 앞 조각이면(`6 5번은 6 1번`) 애매하지 않다
  const covered = new Set(out.flatMap((marker) => Array.from({ length: marker.last - marker.start + 1 }, (_, k) => marker.start + k)))
  return out
    .map((marker) => (marker.split && covered.has(marker.last + 1) && !isSplitByMerge(marker) ? { ...marker, split: false } : marker))
    .sort((a, b) => a.start - b.start)
}

/** 원 가격 줄 목록 (토큰 위치·값, 애매하면 value null). 번호 표시·자리 읽기 토큰에서 멈춘다. bareNumbers = '번' 없는 번호로 앞 수를 뗄 수 있나 */
export function listWonLines(
  tokens: readonly string[],
  options: { readonly maxNumber?: number; readonly bareNumbers?: boolean; readonly punct?: readonly boolean[]; readonly final?: boolean } = {},
): { readonly start: number; readonly end: number; readonly value: number | null }[] {
  const forms = tokens.map(readingForms)
  const digits = findDigitReadings(tokens, forms)
  const marked = new Set<number>()
  for (const marker of listNumberMarkers(tokens, options.punct ?? [])) for (let j = marker.start; j <= marker.last; j++) marked.add(j)
  for (const reading of digits) for (const j of reading.tokens) marked.add(j)
  // 지난 일로 말한 가격(`120만 원까지 팔아 본 적 있어요`)은 줄에서 뺀다 — 번호에 붙이지도, 있는 가격을 고치지도 않는다
  const final = options.final !== false
  return findWonLines(tokens, forms, (i) => marked.has(i), resolveMaxNumber(options), options.bareNumbers === true).filter((line) => !isPastPriceLine(tokens, line.end, final))
}
