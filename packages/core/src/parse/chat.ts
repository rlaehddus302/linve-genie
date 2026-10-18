// R-3 채팅 주문 인식 (ORD-01, D-028). 오인 주문이 놓친 주문보다 위험하다(D-006): 애매하면 주문으로 보지 않고 언급으로 돌린다.
// 손으로 짠 앞에서부터 한 번 훑는 스캐너다. 되돌아가며 다시 맞춰 보는 정규식을 쓰지 않아 적대 입력에도 길이에 비례하는 시간만 든다.
import { resolveSettings, type SettingsOverride } from '../settings.ts'
import { asText, byLengthDesc, digitRunEnd, isDigitAt, longestWordAt, normalizeText, uniqueInOrder } from './text.ts'

/** R-3 채팅 주문 인식 결과. 번호는 메시지에 나온 순서대로, 같은 번호는 처음 자리 하나. */
export interface ChatParseResult {
  readonly claims: readonly number[]
  readonly cancels: readonly number[]
  readonly mentions: readonly number[]
}

/** 번호의 최대 자릿수 (R-3 세부 "번호") */
const MAX_NUMBER_DIGITS = 4
/** 번호 목록의 구분자: 공백 , / · (R-3 문법) */
const SEPARATORS = new Set([' ', ',', '/', '·'])
/** 주문 꼬리말 (R-3 문법). 같은 자리에서 가장 긴 말을 쓴다. */
const CLAIM_WORDS = byLengthDesc(['이요', '요', '여', '찜', '찜이요', '찜할게요', '주세요', '할게요', '구매', '구매요', '구매합니다'])
/** 취소 말 (R-3 취소 문법) */
const CANCEL_WORDS = byLengthDesc(['취소', '취소요', '취소할게요', '취소해주세요'])
/** 보이는 꼬리 기호 (R-3 세부 "꼬리 기호") */
const TAIL_CHARS = new Set(['!', '~', '.', '^', '*', '♡', '♥', '☆', '★', 'ㅎ', 'ㅋ'])
/** 취소에만 더 허용하는 꼬리 기호 */
const CANCEL_ONLY_TAIL_CHARS = new Set(['ㅠ', 'ㅜ'])
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u

/** 그림 이모지의 수식 문자: U+FE0F, U+200D, 피부색 U+1F3FB~U+1F3FF. 혼자서는 보이지 않는다. */
function isEmojiModifier(codePoint: number): boolean {
  return codePoint === 0xfe0f || codePoint === 0x200d || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
}

function isVisibleClaimTail(codePoint: number): boolean {
  const char = String.fromCodePoint(codePoint)
  return TAIL_CHARS.has(char) || PICTOGRAPHIC.test(char)
}

function isVisibleCancelTail(codePoint: number): boolean {
  return isVisibleClaimTail(codePoint) || CANCEL_ONLY_TAIL_CHARS.has(String.fromCodePoint(codePoint))
}

// ── 숫자 덩어리와 금액 모양 ───────────────────────────────────────────────

interface DigitRun {
  readonly start: number
  readonly end: number
  /** 금액 덩어리(천 단위 쉼표 묶음 전체, 숫자.숫자)의 일부인가 */
  amount: boolean
}

/**
 * 메시지의 숫자 덩어리(이어진 ASCII 숫자)를 모두 찾고 금액 모양을 표시한다 (R-3 세부 "금액 모양").
 * - 숫자`.`숫자: 점 양쪽 덩어리가 금액이다(`1.5`).
 * - 공백 없이 숫자와 쉼표로 이어진 덩어리가 `\d{1,3}(,\d{3})+` 모양 전체이면 그 덩어리 전체가 금액이다(`12,500`).
 *   모양이 아니면(`15,28,31`) 각 숫자 덩어리는 번호 후보로 남는다.
 */
function scanDigitRuns(s: string): DigitRun[] {
  const runs: DigitRun[] = []
  for (let i = 0; i < s.length; ) {
    if (!isDigitAt(s, i)) {
      i++
      continue
    }
    const end = digitRunEnd(s, i)
    runs.push({ start: i, end, amount: false })
    i = end
  }
  const joinedBy = (left: DigitRun, right: DigitRun, joiner: string): boolean => right.start === left.end + 1 && s[left.end] === joiner
  for (let k = 0; k + 1 < runs.length; k++) {
    const left = runs[k] as DigitRun
    const right = runs[k + 1] as DigitRun
    if (joinedBy(left, right, '.')) {
      left.amount = true
      right.amount = true
    }
  }
  for (let k = 0; k < runs.length; ) {
    let last = k
    while (last + 1 < runs.length && joinedBy(runs[last] as DigitRun, runs[last + 1] as DigitRun, ',')) last++
    const chunk = runs.slice(k, last + 1)
    const [head, ...groups] = chunk
    const length = (run: DigitRun): number => run.end - run.start
    if (head !== undefined && groups.length > 0 && length(head) <= 3 && groups.every((run) => length(run) === 3)) {
      for (const run of chunk) run.amount = true
    }
    k = last + 1
  }
  return runs
}

// ── 문법 스캐너 ──────────────────────────────────────────────────────────

/**
 * 문법에 맞는 맨 앞 부분이 끝날 수 있는 자리.
 * - `end`: 부분의 끝(그 앞까지가 부분)
 * - `count`: 그 부분에 들어 있는 번호 개수(앞에서부터)
 * - `endsVisibly`: 부분이 보이는 꼬리 기호나 공백으로 끝나는가(뒤따르는 수식 문자는 건너뛰고 본다). LOOSE 끝 경계에 쓴다.
 */
interface PartEnd {
  readonly end: number
  readonly count: number
  readonly endsVisibly: boolean
}

interface NumberToken {
  readonly value: number
  /** 숫자만의 끝 */
  readonly digitsEnd: number
  /** `번`까지 포함한 끝 */
  readonly end: number
}

/** i에서 시작하는 번호: 숫자 1~4자리 [공백 하나] [번]. 숫자가 5자리 이상 이어지면 번호가 아니다. */
function readNumber(s: string, i: number): NumberToken | undefined {
  if (!isDigitAt(s, i)) return undefined
  const digitsEnd = digitRunEnd(s, i)
  if (digitsEnd - i > MAX_NUMBER_DIGITS) return undefined
  const value = Number(s.slice(i, digitsEnd))
  let end = digitsEnd
  if (s[end] === '번') end += 1
  else if (s[end] === ' ' && s[end + 1] === '번') end += 2
  return { value, digitsEnd, end }
}

/**
 * i부터 꼬리 기호를 읽으며 끝날 수 있는 자리마다 visit을 부른다. 기호 사이 공백 하나는 허용한다.
 * 수식 문자(U+FE0F 등)도 꼬리 기호지만, 부분이 "보이게 끝났는지"는 그 앞의 보이는 기호(또는 공백)로 정한다.
 */
function scanTail(s: string, start: number, isVisibleTail: (codePoint: number) => boolean, visit: (end: number, endsVisibly: boolean) => void): void {
  let i = start
  let endsVisibly = false
  for (;;) {
    const spaced = s[i] === ' '
    const at = spaced ? i + 1 : i
    const codePoint = s.codePointAt(at)
    if (codePoint === undefined) return
    const modifier = isEmojiModifier(codePoint)
    if (!modifier && !isVisibleTail(codePoint)) return
    endsVisibly = modifier ? spaced || endsVisibly : true
    i = at + (codePoint > 0xffff ? 2 : 1)
    visit(i, endsVisibly)
  }
}

/** 주문 문법 `[찜] 번호목록 [꼬리말] [꼬리 기호]`에 맞는 맨 앞 부분들. 번호 목록은 parts의 count로 자른다. */
function scanClaim(s: string): { numbers: number[]; parts: PartEnd[] } {
  const numbers: number[] = []
  const parts: PartEnd[] = []
  let i = 0
  if (s.startsWith('찜')) i = s[1] === ' ' ? 2 : 1
  for (;;) {
    const token = readNumber(s, i)
    if (token === undefined) break
    numbers.push(token.value)
    parts.push({ end: token.digitsEnd, count: numbers.length, endsVisibly: false })
    if (token.end !== token.digitsEnd) parts.push({ end: token.end, count: numbers.length, endsVisibly: false })
    i = token.end
    let next = i
    while (next < s.length && SEPARATORS.has(s[next] as string)) next++
    if (next === i || !isDigitAt(s, next)) break
    i = next
  }
  if (numbers.length === 0) return { numbers, parts }
  const count = numbers.length
  const wordAt = s[i] === ' ' ? i + 1 : i
  const word = longestWordAt(s, wordAt, CLAIM_WORDS)
  if (word !== undefined) {
    i = wordAt + word.length
    parts.push({ end: i, count, endsVisibly: false })
  }
  scanTail(s, i, isVisibleClaimTail, (end, endsVisibly) => parts.push({ end, count, endsVisibly }))
  return { numbers, parts }
}

/** 취소 문법 `번호 [번] (취소|취소요|취소할게요|취소해주세요) [꼬리 기호·ㅠ·ㅜ]`에 맞는 맨 앞 부분들 */
function scanCancel(s: string): { value: number; parts: PartEnd[] } | undefined {
  const token = readNumber(s, 0)
  if (token === undefined) return undefined
  const wordAt = s[token.end] === ' ' ? token.end + 1 : token.end
  const word = longestWordAt(s, wordAt, CANCEL_WORDS)
  if (word === undefined) return undefined
  const end = wordAt + word.length
  const parts: PartEnd[] = [{ end, count: 1, endsVisibly: false }]
  scanTail(s, end, isVisibleCancelTail, (tailEnd, endsVisibly) => parts.push({ end: tailEnd, count: 1, endsVisibly }))
  return { value: token.value, parts }
}

/**
 * 모드에 맞는 부분을 고른다.
 * - STRICT: 메시지 전체가 부분이어야 한다.
 * - LOOSE: 메시지 끝·공백 앞에서 끝나거나, 공백·보이는 꼬리 기호로 끝나는 부분 중 가장 긴 것 (R-3 LOOSE 세부).
 */
function pickPart(s: string, parts: readonly PartEnd[], loose: boolean): PartEnd | undefined {
  let best: PartEnd | undefined
  for (const part of parts) {
    const ok = part.end === s.length || (loose && (s[part.end] === ' ' || part.endsVisibly))
    if (ok && (best === undefined || part.end > best.end)) best = part
  }
  return best
}

// ── 공개 함수 ────────────────────────────────────────────────────────────

const result = (claims: number[], cancels: number[], mentions: number[]): ChatParseResult => ({ claims, cancels, mentions })

/** 채팅 메시지 → 주문·취소·언급 (R-3, D-028). 어떤 문자열에도 예외를 던지지 않는다. */
export function parseChat(text: string, settings: SettingsOverride = {}): ChatParseResult {
  const config = resolveSettings(settings)
  const maxNumber = config['claim.maxNumber']
  const loose = config['claim.parseMode'] === 'LOOSE'
  const multi = config['claim.multiNumber']
  const inRange = (n: number): boolean => n >= 1 && n <= maxNumber

  const s = normalizeText(asText(text))
  const runs = scanDigitRuns(s)

  // 금액 덩어리가 있는 메시지는 주문·취소가 아니다
  if (!runs.some((run) => run.amount)) {
    const cancel = scanCancel(s)
    if (cancel !== undefined && pickPart(s, cancel.parts, loose) !== undefined && inRange(cancel.value)) return result([], [cancel.value], [])

    // LOOSE: '취소'가 들어간 메시지는 주문으로 보지 않는다. STRICT에서는 문법상 주문이 될 수 없다.
    if (!(loose && s.includes('취소'))) {
      const claim = scanClaim(s)
      const part = pickPart(s, claim.parts, loose)
      const numbers = part === undefined ? [] : claim.numbers.slice(0, part.count)
      if (numbers.length > 0 && numbers.every(inRange)) {
        const unique = uniqueInOrder(numbers)
        if (multi === 'FIRST') return result(unique.slice(0, 1), [], [])
        if (multi !== 'IGNORE' || unique.length === 1) return result(unique, [], [])
      }
    }
  }

  // 언급: 금액 덩어리가 아닌 1~4자리 숫자 덩어리 중 범위 안의 값
  const mentions = runs
    .filter((run) => !run.amount && run.end - run.start <= MAX_NUMBER_DIGITS)
    .map((run) => Number(s.slice(run.start, run.end)))
    .filter(inRange)
  return result([], [], uniqueInOrder(mentions))
}
