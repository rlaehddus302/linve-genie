// R-15 한글 수사 → 상품 번호 (음성 번호용, D-029). 결과는 1..9999 또는 null.
import { parseBelowMan } from './amount.ts'
import { asText, isAllDigits, normalizeText } from './text.ts'

const MAX_DIGITS = 4

/** 고유어 십의 자리 */
const NATIVE_TENS: ReadonlyArray<readonly [string, number]> = [
  ['열', 10],
  ['스물', 20],
  ['서른', 30],
  ['마흔', 40],
  ['쉰', 50],
  ['예순', 60],
  ['일흔', 70],
  ['여든', 80],
  ['아흔', 90],
]

/** 고유어 일의 자리 (관형형 한·두·세·네 포함) */
const NATIVE_ONES: ReadonlyMap<string, number> = new Map([
  ['하나', 1],
  ['한', 1],
  ['둘', 2],
  ['두', 2],
  ['셋', 3],
  ['세', 3],
  ['넷', 4],
  ['네', 4],
  ['다섯', 5],
  ['여섯', 6],
  ['일곱', 7],
  ['여덟', 8],
  ['아홉', 9],
])

/** `스무`는 단독으로만 20 */
const NATIVE_TWENTY = '스무'

/** 고유어 수사 1~99: [십의 자리][일의 자리] (둘 중 하나 이상) */
function parseNative(s: string): number | null {
  if (s === NATIVE_TWENTY) return 20
  const tens = NATIVE_TENS.find(([word]) => s.startsWith(word))
  if (tens === undefined) return NATIVE_ONES.get(s) ?? null
  const [word, tensValue] = tens
  const rest = s.slice(word.length)
  if (rest === '') return tensValue
  const ones = NATIVE_ONES.get(rest)
  return ones === undefined ? null : tensValue + ones
}

/** 한글 수사 → 1 이상 정수 (R-15). 해석 실패는 null. 어떤 문자열에도 예외를 던지지 않는다. */
export function parseKoreanNumber(text: string): number | null {
  let s = normalizeText(asText(text))
  // 뒤에 '번'(앞 공백 허용)이 붙어도 된다
  if (s.endsWith('번')) s = s.slice(0, s.endsWith(' 번') ? -2 : -1)
  if (s === '') return null
  if (isAllDigits(s)) {
    if (s.length > MAX_DIGITS) return null
    const value = Number(s)
    return value >= 1 ? value : null
  }
  // 한자어(천·백·십 + 일~구, 공백·숫자 계수 없음 → 1..9999) 또는 고유어(1..99).
  // 둘을 섞으면(`백열다섯`) 어느 쪽에도 맞지 않는다. `만` 이상은 지원하지 않는다.
  return parseBelowMan(s, { spaces: false, digitCoefficients: false }) ?? parseNative(s)
}
