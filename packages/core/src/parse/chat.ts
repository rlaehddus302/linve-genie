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
/** 메시지당 서로 다른 주문 번호의 상한 (R-3 세부 "번호 개수 상한", D-034). 설정 키가 아니라 고정값이다. */
const MAX_CLAIM_NUMBERS = 5
/** 기호 꼬리 (R-3 세부 "꼬리 기호"). ♥ U+2665는 그림 이모지이기도 하다. */
const TAIL_SYMBOLS = ['!', '~', '.', '^', '*', '♡', '♥', '☆', '★', 'ㅎ', 'ㅋ']
/** 취소에만 더 허용하는 꼬리 (R-3 세부 "취소"): ㅠ ㅜ와 😢 U+1F622 · 😭 U+1F62D · 🥲 U+1F972 */
const CANCEL_ONLY_TAIL_SYMBOLS = ['ㅠ', 'ㅜ']
const CANCEL_ONLY_TAIL_EMOJI = [0x1f622, 0x1f62d, 0x1f972]

/**
 * 꼬리 그림 이모지 허용 목록 (R-3 세부, D-033) 83자: 주문 의사·호감·응원만. DOMAIN_RULES에 적힌 코드 포인트 그대로다.
 * 목록 밖의 그림 이모지(❓ ❔ ⁉ 질문, ❌ 🚫 부정, 😭 🤔 💔 아쉬움·고민, 👀 등)는 "그 밖의 문자"라 주문이 아니다(언급).
 * 목록을 넓히려면 DECISIONS를 거친다. 단위 테스트가 DOMAIN_RULES의 목록과 대조한다.
 */
export const CLAIM_TAIL_EMOJI: ReadonlySet<number> = new Set([
  // 하트(22): 💕 U+1F495 ~ 💟 U+1F49F 11자, 💔 U+1F494는 아님
  0x2764, 0x2763, 0x1f48c, 0x1f493, 0x1f495, 0x1f496, 0x1f497, 0x1f498, 0x1f499, 0x1f49a, 0x1f49b, 0x1f49c, 0x1f49d, 0x1f49e, 0x1f49f, 0x1f5a4, 0x1f90d,
  0x1f90e, 0x1f9e1, 0x1fa75, 0x1fa76, 0x1fa77,
  // 웃는·좋아하는 얼굴(23): 😅 U+1F605 · 😇 U+1F607 · 😈 U+1F608 · 😌 · 😏 등은 아님
  0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f606, 0x1f609, 0x1f60a, 0x1f60b, 0x1f60d, 0x1f60e, 0x1f617, 0x1f618, 0x1f619, 0x1f61a, 0x1f63b, 0x263a,
  0x1f642, 0x1f917, 0x1f923, 0x1f929, 0x1f970, 0x1f973,
  // 손(11)
  0x1f44c, 0x1f44d, 0x1f44f, 0x1f64b, 0x1f64c, 0x1f64f, 0x270b, 0x270c, 0x261d, 0x1f91e, 0x1faf6,
  // 반짝·축하(9)
  0x2728, 0x2b50, 0x1f31f, 0x1f4ab, 0x1f525, 0x1f4af, 0x1f389, 0x1f38a, 0x1f381,
  // 꽃·식물(13)
  0x1f331, 0x1f335, 0x1f337, 0x1f338, 0x1f339, 0x1f33a, 0x1f33b, 0x1f33c, 0x1f33f, 0x1f340, 0x1f490, 0x2618, 0x1fab4,
  // 느낌표(3, '!'와 같다)
  0x2757, 0x2755, 0x203c,
  // 성별 기호(2, 사람 이모지 조합용: 🙋‍♀️)
  0x2640, 0x2642,
])

const codePointsOf = (chars: readonly string[]): number[] => chars.map((char) => char.codePointAt(0) as number)
/** 주문 꼬리의 보이는 글자: 기호 + 허용 목록 그림 이모지 */
const CLAIM_TAIL: ReadonlySet<number> = new Set([...codePointsOf(TAIL_SYMBOLS), ...CLAIM_TAIL_EMOJI])
/** 취소 꼬리의 보이는 글자: 주문 꼬리 + ㅠ ㅜ 😢 😭 🥲 */
const CANCEL_TAIL: ReadonlySet<number> = new Set([...CLAIM_TAIL, ...codePointsOf(CANCEL_ONLY_TAIL_SYMBOLS), ...CANCEL_ONLY_TAIL_EMOJI])

/** 그림 이모지의 수식 문자: U+FE0F, U+200D, 피부색 U+1F3FB~U+1F3FF. 혼자서는 보이지 않는다. */
function isEmojiModifier(codePoint: number): boolean {
  return codePoint === 0xfe0f || codePoint === 0x200d || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
}

/** 주문 꼬리의 보이는 글자인가. ZWJ 조합도 글자 하나씩 이 판정을 거친다(scanTail): 조합 안 글자 하나라도 목록 밖이면 꼬리가 끊긴다. */
function isVisibleClaimTail(codePoint: number): boolean {
  return CLAIM_TAIL.has(codePoint)
}

function isVisibleCancelTail(codePoint: number): boolean {
  return CANCEL_TAIL.has(codePoint)
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
 * 고른 부분 뒤의 끝 신호(D-035)는 endsWithSignal이 따로 본다.
 */
function pickPart(s: string, parts: readonly PartEnd[], loose: boolean): PartEnd | undefined {
  let best: PartEnd | undefined
  for (const part of parts) {
    const ok = part.end === s.length || (loose && (s[part.end] === ' ' || part.endsVisibly))
    if (ok && (best === undefined || part.end > best.end)) best = part
  }
  return best
}

// ── LOOSE 끝 신호 (R-3 LOOSE 세부 "끝 신호", D-035) ────────────────────────

/** 끝 신호 1: 질문 기호 ? ？ ❓ ❔ ⁉ */
const QUESTION_MARKS: ReadonlySet<number> = new Set([0x3f, 0xff1f, 0x2753, 0x2754, 0x2049])
/** 끝 신호 4: '번' U+BC88 */
const BEON = 0xbc88
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u

/** 끝 신호 자리에서 건너뛰는 보이지 않는 글자: 피부색 수식 문자 U+1F3FB~U+1F3FF, Default_Ignorable_Code_Point(U+FE0F·U+200D·U+200B·U+FEFF·U+3164 등) */
function isInvisible(codePoint: number): boolean {
  return (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) || DEFAULT_IGNORABLE.test(String.fromCodePoint(codePoint))
}

/**
 * 맨 앞 부분이 at에서 끝났을 때, 공백·보이지 않는 글자를 건너뛴 첫 글자가 끝 신호인가 (D-035).
 * 첫 글자만 본다. 건너뛰고 나서 메시지가 끝나면 신호가 아니다. 2·3의 "꼬리 기호"는 isVisibleTail(주문 꼬리 / 취소 꼬리)로 정한다.
 */
function hasEndSignal(s: string, at: number, isVisibleTail: (codePoint: number) => boolean): boolean {
  let i = at
  let spaced = false
  for (;;) {
    const codePoint = s.codePointAt(i)
    if (codePoint === undefined) return false
    if (codePoint === 0x20) spaced = true
    else if (!isInvisible(codePoint)) {
      if (QUESTION_MARKS.has(codePoint)) return true // 1 질문 기호
      if (codePoint >= 0x3131 && codePoint <= 0x318e) return !isVisibleTail(codePoint) // 2 꼬리 기호(ㅎ ㅋ, 취소는 ㅠ ㅜ도)가 아닌 한글 호환 자모
      if (PICTOGRAPHIC.test(String.fromCodePoint(codePoint))) return !isVisibleTail(codePoint) // 3 꼬리 기호가 아닌 그림 이모지
      if (codePoint === BEON) return true // 4 번호 부분에 들어가지 못하고 남은 '번'
      return !spaced && isDigitAt(s, i) // 5 공백 없이 붙은 숫자(보이지 않는 글자만 사이에 있어도 붙은 것)
    }
    i += codePoint > 0xffff ? 2 : 1
  }
}

/**
 * LOOSE 끝 신호 검사(D-035): 두 자리 — (가) 고른(가장 긴) 부분 바로 뒤, (나) 끝 경계와 상관없이 문법에 맞는 가장 긴 맨 앞 부분 바로 뒤.
 * (나)가 더 길면 고른 부분 뒤에 이어진 번호·꼬리말에 붙은 신호도 잡는다(`15 28❓`). 걸리면 더 짧은 부분으로 물러나지 않는다.
 * STRICT는 고른 부분이 메시지 끝까지라 두 자리 모두 볼 글자가 없다.
 */
function endsWithSignal(s: string, picked: PartEnd, parts: readonly PartEnd[], isVisibleTail: (codePoint: number) => boolean): boolean {
  let longest = picked.end
  for (const part of parts) if (part.end > longest) longest = part.end
  return hasEndSignal(s, picked.end, isVisibleTail) || (longest !== picked.end && hasEndSignal(s, longest, isVisibleTail))
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
  // 메시지의 번호 후보: 금액 덩어리가 아닌 1~4자리 숫자 덩어리 (언급·범위 판정 공용)
  const numberValues = runs.filter((run) => !run.amount && run.end - run.start <= MAX_NUMBER_DIGITS).map((run) => Number(s.slice(run.start, run.end)))

  // 금액 덩어리가 있는 메시지는 주문·취소가 아니다.
  // 범위(R-3 세부): 주문·취소가 될 "메시지에" 범위 밖 번호가 하나라도 있으면 주문·취소가 아니다. LOOSE도 주문 부분 뒤까지 메시지 전체로 본다
  // (TD-S01-002: '15 1000원이에요'가 '15 1000'과 같이 언급). STRICT는 메시지 전체가 주문 부분이라 결과가 같다.
  // 주문·취소 부분의 번호는 모두 이 후보 안에 있으므로 부분 번호를 따로 검사하지 않는다.
  if (!runs.some((run) => run.amount) && numberValues.every(inRange)) {
    // 취소가 먼저: 끝 경계·끝 신호(취소 꼬리 기준) 조건이 같다. 끝 신호에 걸리면 취소가 아니고, LOOSE라 '취소'가 들어 있어 주문도 아니다.
    const cancel = scanCancel(s)
    if (cancel !== undefined) {
      const part = pickPart(s, cancel.parts, loose)
      if (part !== undefined && !endsWithSignal(s, part, cancel.parts, isVisibleCancelTail)) return result([], [cancel.value], [])
    }

    // LOOSE: '취소'가 들어간 메시지는 주문으로 보지 않는다. STRICT에서는 문법상 주문이 될 수 없다.
    if (!(loose && s.includes('취소'))) {
      const claim = scanClaim(s)
      const part = pickPart(s, claim.parts, loose)
      // 끝 신호(D-035)는 번호 개수 상한·multiNumber보다 먼저 본다. 걸리면 더 짧은 부분으로 물러나지 않고 주문이 아니다(아래 언급으로).
      const numbers = part === undefined || endsWithSignal(s, part, claim.parts, isVisibleClaimTail) ? [] : claim.numbers.slice(0, part.count)
      const unique = uniqueInOrder(numbers)
      // 번호 개수 상한(D-034): 서로 다른 번호(값으로 센다: 015 = 15)가 6개 이상이면 주문이 아니다(아래 언급으로).
      // multiNumber보다 먼저 본다(FIRST·IGNORE도 같다). LOOSE도 고른 부분 하나에만 적용하고 더 짧은 부분으로 물러나지 않는다.
      if (unique.length > 0 && unique.length <= MAX_CLAIM_NUMBERS) {
        if (multi === 'FIRST') return result(unique.slice(0, 1), [], [])
        if (multi !== 'IGNORE' || unique.length === 1) return result(unique, [], [])
      }
    }
  }

  // 언급: 금액 덩어리가 아닌 1~4자리 숫자 덩어리 중 범위 안의 값
  return result([], [], uniqueInOrder(numberValues.filter(inRange)))
}
