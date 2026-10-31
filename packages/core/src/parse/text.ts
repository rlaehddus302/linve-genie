// 파서 공용 글자 도구. 채팅·금액·빠른 입력은 같은 정규화를 쓴다 (R-3 정규화, R-14 1, R-16 1).
// 정규식은 모두 겹치는 반복이 없는 모양만 쓴다. 적대 입력에서도 길이에 비례하는 시간만 든다 (AC-S01-03).

/** 신뢰할 수 없는 입력: 문자열이 아니면 빈 문자열로 본다(예외를 던지지 않는다). */
export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// R-3 정규화는 ../text.ts에 있다(파서 밖 — 옵션 비교 글자도 쓴다). 파서는 여기서 그대로 다시 내보낸다
export { normalizeText } from '../text.ts'

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
