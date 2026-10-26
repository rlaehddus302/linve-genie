// R-14 금액 해석 (빠른 입력·음성 공용, D-029). 애매한 금액은 추측하지 않고 null(다시 입력)로 돌려준다.
// 결과는 0 이상의 안전한 정수 원(CLAUDE.md 규칙 2). 소수는 문자열 자리 계산으로만 다루고 부동소수점 곱셈을 쓰지 않는다.
import { isPriceUnit, resolveSettings, type PriceUnit, type SettingsOverride } from '../settings.ts'
import { asText, isAllDigits, isDigitAt, normalizeText, trimTrailingZeros } from './text.ts'

/** 한자어 숫자 일~구 (R-14 4, R-15) */
export const SINO_DIGITS: ReadonlyMap<string, number> = new Map([
  ['일', 1],
  ['이', 2],
  ['삼', 3],
  ['사', 4],
  ['오', 5],
  ['육', 6],
  ['칠', 7],
  ['팔', 8],
  ['구', 9],
])

/** 만 아래 단위 → 10의 거듭제곱 */
const SMALL_UNITS: ReadonlyMap<string, number> = new Map([
  ['천', 3],
  ['백', 2],
  ['십', 1],
])
const MAN = '만'
const MAN_EXPONENT = 4
const WON = '원'

/** 한글 단위 글자(십·백·천·만)인가 */
export function isUnitChar(char: string): boolean {
  return char === MAN || SMALL_UNITS.has(char)
}

/**
 * R-14로 해석되는 문자열이 가질 수 있는 공백 구분 토큰의 최대 개수.
 * `[계수]만` + 천·백·십·일의 자리 묶음 4개 + `원` = 6 (만의 계수 안에는 공백이 없고, 계수는 단위에 붙여 쓴다).
 * 빠른 입력(R-16)은 끝에서 이 개수까지만 가격 후보로 본다. 단위 테스트가 무제한 탐색과 결과가 같은지 확인한다.
 */
export const AMOUNT_MAX_TOKENS = 6

/** 소수점 아래 자릿수 k의 값 `int.frac`에 10^exponent를 곱한 정수. 정수가 아니면 null. */
function scaleDecimal(intDigits: string, fracDigits: string, exponent: number): number | null {
  const frac = trimTrailingZeros(fracDigits)
  if (frac.length > exponent) return null
  const value = Number(intDigits) * 10 ** exponent + Number(frac.padEnd(exponent, '0') || '0')
  return Number.isSafeInteger(value) ? value : null
}

// ── 숫자 형식 (R-14 3) ───────────────────────────────────────────────────

/** `10000` · `10,000` · `7.5` → 정수부 숫자열과 소수부 숫자열. 형식이 틀리면 null. */
function readNumeral(s: string): { intDigits: string; fracDigits: string } | null {
  const dot = s.indexOf('.')
  const intPart = dot < 0 ? s : s.slice(0, dot)
  const fracDigits = dot < 0 ? '' : s.slice(dot + 1)
  if (dot >= 0 && !isAllDigits(fracDigits)) return null
  const groups = intPart.split(',')
  const [head, ...rest] = groups
  if (head === undefined || !isAllDigits(head)) return null
  if (rest.length > 0 && (head.length > 3 || !rest.every((group) => group.length === 3 && isAllDigits(group)))) return null
  const intDigits = groups.join('')
  // 0이 아닌데 0으로 시작하면 실패 (`0500`, `0,500`)
  if (intDigits.length > 1 && intDigits.startsWith('0')) return null
  return { intDigits, fracDigits }
}

/**
 * 단위 없는 숫자가 1000 미만일 때 곱하는 10의 거듭제곱 (R-14 3): 원 0, 천원 3(D-007), 만원 4(D-FB1-11).
 * 자동(AUTO, D-V3-70)은 정수부 자릿수로 정한다: 1~2자리 4(만원), 3자리 3(천원).
 * 정수부가 1000 이상이면 어느 단위든 0(원 그대로).
 */
type SmallExponent = (intDigits: string) => number

const fixedExponent = (exponent: number): SmallExponent => (intDigits) => (Number(intDigits) < 1000 ? exponent : 0)

/** readNumeral이 앞 0을 막으므로 자릿수 = 값의 자릿수다(`0`만 예외로 1자리). */
const autoExponent: SmallExponent = (intDigits) => (intDigits.length <= 2 ? 4 : intDigits.length === 3 ? 3 : 0)

const SMALL_NUMBER_EXPONENT: Readonly<Record<PriceUnit, SmallExponent>> = Object.freeze({
  WON: fixedExponent(0),
  THOUSAND: fixedExponent(3),
  TEN_THOUSAND: fixedExponent(4),
  AUTO: autoExponent,
})

/** 설정의 price.unit → 곱하는 지수 규칙. 모르는 값은 null(추측하지 않는다 — 10배 틀린 가격보다 읽지 못함이 안전하다). */
function smallNumberExponent(unit: unknown): SmallExponent | null {
  return isPriceUnit(unit) ? SMALL_NUMBER_EXPONENT[unit] : null
}

function parseNumeral(s: string, smallExponent: SmallExponent): number | null {
  const numeral = readNumeral(s)
  if (numeral === null) return null
  const { intDigits, fracDigits } = numeral
  // Number.MAX_SAFE_INTEGER는 16자리. 그보다 긴 정수부는 볼 필요 없이 범위 밖이다.
  if (intDigits.length > 16) return null
  return scaleDecimal(intDigits, fracDigits, smallExponent(intDigits))
}

// ── 한글 단위 형식 (R-14 4) ──────────────────────────────────────────────

export interface BelowManOptions {
  /** 단위 묶음 사이 공백 허용 */
  readonly spaces: boolean
  /** 천·백·십의 계수로 숫자 1~9 허용 (R-15 한글 수사는 한글만) */
  readonly digitCoefficients: boolean
  /**
   * 금액(R-14 4, D-032): 한글 일의 자리는 앞에 단위가 없거나 바로 앞 단위가 십일 때만 받는다.
   * 바로 앞이 만·천·백이면(묶음 사이 공백이 있어도) null. `만오`·`천오`·`백오`는 줄임말(15,000·1,500·150)인지 글자 그대로인지 애매하다.
   * 한글 수사(R-15 번호)는 글자 그대로 읽으므로 끈다(`백오` → 105).
   */
  readonly onesOnlyAfterTen: boolean
  /** 만 뒤의 나머지를 읽는다: 첫 묶음의 바로 앞 단위는 만이다(`만 오`의 `오`). onesOnlyAfterTen과 함께 쓴다. */
  readonly afterMan: boolean
}

/** R-14 금액: 만이 없는 만 미만 표현 */
const AMOUNT_BELOW_MAN: BelowManOptions = { spaces: true, digitCoefficients: true, onesOnlyAfterTen: true, afterMan: false }
/** R-14 금액: 만의 한글 계수 (공백 없음) */
const AMOUNT_MAN_COEFFICIENT: BelowManOptions = { spaces: false, digitCoefficients: true, onesOnlyAfterTen: true, afterMan: false }
/** R-14 금액: 만 뒤의 한글 나머지 */
const AMOUNT_MAN_REMAINDER: BelowManOptions = { spaces: true, digitCoefficients: true, onesOnlyAfterTen: true, afterMan: true }

/**
 * 만 미만 표현 `[계수]천 [계수]백 [계수]십 [일의 자리]` → 1..9999. 틀리면 null(빈 문자열 포함).
 * - 큰 단위부터 한 번씩, 계수 생략은 1. 계수는 숫자 1~9(허용 시) 또는 한글 일~구, 단위에 붙여 쓴다.
 * - 일의 자리는 한글 일~구만, 맨 끝에만. 단위 뒤의 단위 없는 숫자(`2천500`)는 실패.
 * - onesOnlyAfterTen이면 일의 자리의 바로 앞 단위가 없거나 십이어야 한다 (D-032).
 */
export function parseBelowMan(s: string, options: BelowManOptions): number | null {
  let total = 0
  // 마지막으로 읽은 단위의 지수. 아직 없으면 만(4): 다음 단위는 이보다 작아야 한다.
  let lastExponent = MAN_EXPONENT
  let groups = 0
  let i = 0
  while (i < s.length) {
    if (groups > 0 && options.spaces && s[i] === ' ') i++
    const char = s.charAt(i)
    const sino = SINO_DIGITS.get(char)
    const digit = options.digitCoefficients && isDigitAt(s, i) && char !== '0' ? Number(char) : undefined
    const coefficient = sino ?? digit
    if (coefficient !== undefined) i++
    const exponent = SMALL_UNITS.get(s.charAt(i))
    if (exponent !== undefined) {
      if (exponent >= lastExponent) return null
      lastExponent = exponent
      total += (coefficient ?? 1) * 10 ** exponent
      groups++
      i++
      continue
    }
    // 단위가 없으면 한글 일의 자리여야 하고, 거기서 끝나야 한다
    if (sino === undefined || i !== s.length) return null
    // D-032: 바로 앞 단위(앞 묶음의 단위, 첫 묶음이면 만 뒤 나머지의 만)가 있는데 십이 아니면 애매하다
    const unitBefore = groups > 0 || options.afterMan
    if (options.onesOnlyAfterTen && unitBefore && lastExponent !== 1) return null
    total += sino
    groups++
  }
  return groups > 0 ? total : null
}

/**
 * 만의 계수: 숫자 1~4자리(선행 0 없음) 또는 공백 없는 만 미만 한글 단위 표현. 생략은 1.
 * 한글 계수 안에서도 D-032를 적용한다(`백오만` null, `십오만` 15). 숫자 계수(`105만`)에는 한글 일의 자리가 없다.
 */
function parseManCoefficient(s: string): number | null {
  if (s === '') return 1
  if (isAllDigits(s)) return s.length <= 4 && !s.startsWith('0') ? Number(s) : null
  return parseBelowMan(s, AMOUNT_MAN_COEFFICIENT)
}

/**
 * 만 뒤의 나머지: 정확히 네 자리 숫자(`2500`, `2,500`, 선행 0 없음) 또는 만 미만 한글 단위 표현.
 * 한글 표현의 첫 묶음 바로 앞 단위는 만이다(`만오`·`만 오` null, `만십오` 10,015). 네 자리 숫자에는 한글 일의 자리가 없다(`1만 1005`).
 */
function parseManRemainder(s: string): number | null {
  const grouped = s.length === 5 && s[1] === ','
  const digits = grouped ? `${s[0]}${s.slice(2)}` : s
  if (isAllDigits(digits)) return digits.length === 4 && !digits.startsWith('0') ? Number(digits) : null
  return parseBelowMan(s, AMOUNT_MAN_REMAINDER)
}

/** 소수 계수 + 단위 하나 (`1.5만`, `1.25만`, `1.5천`, `0.5만`) */
function parseDecimalUnit(s: string): number | null {
  const unit = s.slice(-1)
  const exponent = unit === MAN ? MAN_EXPONENT : SMALL_UNITS.get(unit)
  if (exponent === undefined) return null
  const body = s.slice(0, -1)
  const dot = body.indexOf('.')
  const intDigits = body.slice(0, dot)
  const fracDigits = body.slice(dot + 1)
  if (!isAllDigits(intDigits) || !isAllDigits(fracDigits)) return null
  // 정수부: 만은 0 또는 선행 0 없는 1~4자리, 천·백·십은 한 자리
  const intOk = exponent === MAN_EXPONENT ? intDigits.length <= 4 && (intDigits === '0' || !intDigits.startsWith('0')) : intDigits.length === 1
  if (!intOk) return null
  const value = scaleDecimal(intDigits, fracDigits, exponent)
  return value === 0 ? null : value
}

function parseKoreanUnits(s: string): number | null {
  if (s.includes('.')) return parseDecimalUnit(s)
  const parts = s.split(MAN)
  if (parts.length > 2) return null
  const [before, after] = parts as [string, string | undefined]
  if (after === undefined) return parseBelowMan(s, AMOUNT_BELOW_MAN)
  const coefficient = parseManCoefficient(before)
  if (coefficient === null) return null
  const remainderText = after.startsWith(' ') ? after.slice(1) : after
  if (remainderText === '') return coefficient * 10 ** MAN_EXPONENT
  const remainder = parseManRemainder(remainderText)
  return remainder === null ? null : coefficient * 10 ** MAN_EXPONENT + remainder
}

// ── 공개 함수 ────────────────────────────────────────────────────────────

/** 숫자·쉼표·점만으로 된 문자열인가 (숫자 형식 후보) */
function isNumeralShape(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (!isDigitAt(s, i) && s[i] !== ',' && s[i] !== '.') return false
  }
  return true
}

/** 한글·숫자 금액 → 정수 원 (R-14). 해석 실패는 null. 어떤 문자열에도 예외를 던지지 않는다. */
export function parseAmount(text: string, settings: SettingsOverride = {}): number | null {
  const smallExponent = smallNumberExponent(resolveSettings(settings)['price.unit'])
  let s = normalizeText(asText(text))
  // '원'은 맨 끝에 한 번만(앞 공백 허용). 원이 붙으면 단위 설정과 상관없이 원이다.
  const won = s.endsWith(WON)
  if (won) s = s.slice(0, s.endsWith(` ${WON}`) ? -2 : -1)
  if (s === '' || s.includes(WON)) return null
  if (isNumeralShape(s)) {
    if (won) return parseNumeral(s, SMALL_NUMBER_EXPONENT.WON)
    return smallExponent === null ? null : parseNumeral(s, smallExponent)
  }
  // 한글 단위가 있으면 단위 설정을 무시한다
  return parseKoreanUnits(s)
}
