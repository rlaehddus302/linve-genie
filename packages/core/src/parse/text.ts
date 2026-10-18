// 파서 공용 글자 도구. 채팅·금액·빠른 입력은 같은 정규화를 쓴다 (R-3 정규화, R-14 1, R-16 1).
// 정규식은 모두 겹치는 반복이 없는 모양만 쓴다. 적대 입력에서도 길이에 비례하는 시간만 든다 (AC-S01-03).

// 공백 = JavaScript `\s`에서 U+FEFF를 뺀 것(탭·줄바꿈·NBSP·U+2028·U+3000 등).
// `\s`는 역사적 이유로 U+FEFF(폭 없는 비분리 공백, BOM)를 포함하지만, 이 글자는 유니코드 White_Space가 아니고(일반 분류 Cf)
// 화면에 보이지 않는다. 공백으로 바꾸면 화면의 "15"가 "1 5"(1번·5번)로, 가격 "1500"이 "1 500"으로 갈라진다(TD-S01-001).
const WHITESPACE_RUN = /[^\S\uFEFF]+/gu
const FULLWIDTH_DIGIT = /[\uFF10-\uFF19]/g
const FULLWIDTH_OFFSET = 0xff10 - 0x30

/** 신뢰할 수 없는 입력: 문자열이 아니면 빈 문자열로 본다(예외를 던지지 않는다). */
export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * R-3 정규화: 연속 공백(탭·줄바꿈·NBSP 등 유니코드 공백 포함) → 한 칸, 앞뒤 공백 제거, 전각 숫자 → 반각.
 * 제로폭 공백(U+200B)·방향 표시(U+200E)·U+FEFF 같은 보이지 않는 글자는 공백이 아니므로 어디에 있든 그대로 둔다(문법에 맞지 않게 된다).
 * 앞뒤 자르기도 같은 공백 집합만 쓴다. `String.prototype.trim`은 U+FEFF까지 지워서 쓰지 않는다.
 */
export function normalizeText(text: string): string {
  const collapsed = text.replace(WHITESPACE_RUN, ' ')
  const start = collapsed.startsWith(' ') ? 1 : 0
  const end = collapsed.endsWith(' ') ? collapsed.length - 1 : collapsed.length
  return collapsed.slice(start, end).replace(FULLWIDTH_DIGIT, (digit) => String.fromCharCode(digit.charCodeAt(0) - FULLWIDTH_OFFSET))
}

/** s[i]가 ASCII 숫자인가. 다른 문자 체계의 숫자(아라비아·데바나가리 등)는 숫자로 보지 않는다. */
export function isDigitAt(s: string, i: number): boolean {
  const code = s.charCodeAt(i)
  return code >= 0x30 && code <= 0x39
}

/** i부터 이어지는 ASCII 숫자의 끝 위치 */
export function digitRunEnd(s: string, i: number): number {
  let end = i
  while (isDigitAt(s, end)) end++
  return end
}

/** 문자열 전체가 ASCII 숫자(1자 이상)인가 */
export function isAllDigits(s: string): boolean {
  return s.length > 0 && digitRunEnd(s, 0) === s.length
}

/** 끝의 '0'을 뗀다. 정규식(`0+$`)은 0이 길게 이어진 입력에서 제곱 시간이 들어 쓰지 않는다. */
export function trimTrailingZeros(digits: string): string {
  let end = digits.length
  while (end > 0 && digits.charCodeAt(end - 1) === 0x30) end--
  return digits.slice(0, end)
}

/** s의 i 위치에서 시작하는 단어 중 가장 긴 것. 없으면 undefined. words는 길이 내림차순이어야 한다. */
export function longestWordAt(s: string, i: number, words: readonly string[]): string | undefined {
  return words.find((word) => s.startsWith(word, i))
}

/** 길이 내림차순으로 정렬한 새 배열 (longestWordAt 용) */
export function byLengthDesc(words: readonly string[]): readonly string[] {
  return Object.freeze([...words].sort((a, b) => b.length - a.length))
}

/** 같은 값은 처음 나온 자리 하나만 남긴다(나온 순서 유지). */
export function uniqueInOrder(values: readonly number[]): number[] {
  return [...new Set(values)]
}
