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
/** 번호 목록의 구분자: 공백 , / · . & + (R-3 문법, D-CHAT-JOIN-01 — `.` `&` `+` 추가) */
const SEPARATORS = new Set([' ', ',', '/', '·', '.', '&', '+'])
/** 번호 사이의 이음말 (R-3 문법, D-CHAT-JOIN-01 — "418. 하고94. 번주세요"). 뒤에 번호가 이어질 때만 구분자다. 같은 자리에서 가장 긴 말을 쓴다. */
const JOIN_WORDS = byLengthDesc(['하고', '하구', '그리고', '이랑', '랑', '와', '과', '및'])
/** "저요" 말 (R-3 문법, D-CHAT-ME-01 — 손님 "2번 저요"·"ㅈㅇ"를 놓쳤다): 꼬리말이면서 번호 앞에도 온다("저요 2번") */
const ME_WORDS = ['저요', '저여', '저용', '제가요', '제꺼요', 'ㅈㅇ', 'ㅈㅅㅇ']
/** 주문 꼬리말 (R-3 문법). 같은 자리에서 가장 긴 말을 쓴다. */
const CLAIM_WORDS = byLengthDesc(['이요', '요', '여', '찜', '찜이요', '찜할게요', '주세요', '주세여', '주세용', '할게요', '구매', '구매요', '구매합니다', ...ME_WORDS])
/** 번호 앞에 오는 "저요" 말 (R-3 문법 `[앞말]`, skipLead). 길이 내림차순 */
const LEAD_ME_WORDS = byLengthDesc(ME_WORDS)
/**
 * 덧붙인 말 주문(D-CHAT-ME-01)의 "또렷한 주문 말": 번호 바로 뒤 꼬리말 중 `이요`·`요`·`여`와 이름씨 `찜`·`구매`를 뺀 것.
 * `요`·`여` 하나는 수다 속에서 주문 뜻이 약하고("그거 15번요 예뻐요"), `찜`·`구매`는 남의 찜 이야기에도 쓴다("26번 찜 축하해요").
 */
const CLEAR_CLAIM_WORDS = byLengthDesc(CLAIM_WORDS.filter((word) => !['이요', '요', '여', '찜', '구매'].includes(word)))
/**
 * 덧붙인 말 주문을 막는 말(D-CHAT-ME-01): 메시지 어디든 들어 있으면 주문이 아니다(언급). 오인 주문이 놓친 주문보다 위험하다(D-006).
 * 부정·취소, 질문, 지난 일(산 뒤 이야기), 나중·바꾸기, 수량·다른 것.
 */
const CHATTER_BLOCK_WORDS = [
  // 부정·취소
  '취소', '패스', '아니', '아닌', '아님', '아뇨', '말고', '대신', '빼고', '제외', '포기', '못', '없', '놓쳤', '늦었',
  '안 사', '안사', '안 살', '안살', '안 할', '안할', '안 해', '안해', '안 돼', '안돼', '안 되', '안되',
  // 질문
  '얼마', '가격', '몇', '뭐', '무슨', '어떤', '어떻', '어때', '언제', '어디', '누구', '누가', '혹시', '있나', '있을까', '되나', '될까', '가능', '맞나', '맞죠',
  '인가', '인지', '나요', '까요', '는지', '건가', '거죠', '냐',
  // 지난 일
  '샀', '받았', '했', '었', '았', '였', '셨',
  // 남 이야기·남에게 하는 말·옮긴 말
  '하시', '하신', '하세요', '계세', '계신', '축하', '부러', '부럽', '하는', '하면', '하라', '라고', '래요', '대요', '돼',
  // 나중·바꾸기
  '다음', '나중', '이따', '내일', '바꿔', '바꿀', '바꾸', '변경', '교환', '환불', '반품',
  // 수량·다른 것·값 (`원`은 값 이야기, `개`는 수량)
  '하나 더', '하나더', '한개', '한 개', '두개', '두 개', '세개', '세 개', '네개', '네 개', '둘', '셋', '더 주세요', '더주세요', '다른', '째', '개', '원',
]
/** 덧붙인 말 주문에서 막지 않는 문장 부호: , . · … " ' ( ) */
const CHATTER_PUNCTUATION: ReadonlySet<number> = new Set([...',.·…"\'()'].map((char) => char.codePointAt(0) as number))
/** 덧붙인 말 주문에서 막지 않는 한글 호환 자모: 꼬리 기호 ㅎ ㅋ와 "저요" 말 ㅈㅇ·ㅈㅅㅇ (그 밖의 ㅠ ㅜ ㄴ ㅇ 등은 막는다) */
const CHATTER_JAMO_WORDS = byLengthDesc(['ㅈㅅㅇ', 'ㅈㅇ'])
/** 패스 말 (R-3 "패스", D-RETRO-113): 손님이 자기 찜을 거두는 말. 번호와 함께면 취소 말과 같고, 혼자면 isBarePass */
const PASS_WORDS = ['패스', '패스요', '패스할게요', '패스합니다', '패스해요', '패스 할게요', '패스 합니다', '패스 해요']
/** 취소 말 (R-3 취소 문법) */
const PLAIN_CANCEL_WORDS = ['취소', '취소요', '취소할게요', '취소해주세요']
/** 채팅의 취소 말 — "패스" 말도 같다 (D-RETRO-113). 손님 문자 읽기(R-26)는 PLAIN만 — "775 패스" 문자는 지금처럼 확인 필요 */
const CANCEL_WORDS = byLengthDesc([...PLAIN_CANCEL_WORDS, ...PASS_WORDS])
const SMS_CANCEL_WORDS = byLengthDesc(PLAIN_CANCEL_WORDS)
const BARE_PASS_WORDS = byLengthDesc(PASS_WORDS)
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

/** i에서 시작하는 번호: 숫자 1~4자리 [.] [공백 하나] [번]. `.`은 뒤에 `번`이 올 때만 번호에 든다(`94. 번`, D-CHAT-JOIN-01). 숫자가 5자리 이상 이어지면 번호가 아니다. */
function readNumber(s: string, i: number): NumberToken | undefined {
  if (!isDigitAt(s, i)) return undefined
  const digitsEnd = digitRunEnd(s, i)
  if (digitsEnd - i > MAX_NUMBER_DIGITS) return undefined
  const value = Number(s.slice(i, digitsEnd))
  const at = s[digitsEnd] === '.' ? digitsEnd + 1 : digitsEnd
  let end = digitsEnd
  if (s[at] === '번') end = at + 1
  else if (s[at] === ' ' && s[at + 1] === '번') end = at + 2
  return { value, digitsEnd, end }
}

/** i부터 번호 목록의 구분자(기호·이음말, D-CHAT-JOIN-01)를 건너뛴 자리. 구분자가 없으면 i 그대로 */
function skipSeparators(s: string, i: number): number {
  let next = i
  for (;;) {
    if (next < s.length && SEPARATORS.has(s[next] as string)) {
      next++
      continue
    }
    const word = longestWordAt(s, next, JOIN_WORDS)
    if (word === undefined) return next
    next += word.length
  }
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

/** i부터 꼬리 기호(주문 꼬리)를 가장 길게 건너뛴 자리. 없으면 i 그대로 */
function skipClaimTail(s: string, i: number): number {
  let end = i
  scanTail(s, i, isVisibleClaimTail, (tailEnd) => {
    end = tailEnd
  })
  return end
}

/**
 * i부터 번호 앞 말 `[찜] ("저요" 말)*`을 건너뛴 자리(D-CHAT-ME-01). `찜`은 맨 앞 한 번만("찜찜"은 다른 뜻)이고 뒤에 공백 하나만 와도 된다(`찜 15`).
 * "저요" 말은 여러 번 와도 되고 말마다 뒤에 꼬리 기호와 공백 하나가 와도 된다(`저요! 2번`, `저요저요 2`). 앞 말이 없으면 i 그대로
 */
function skipLead(s: string, i: number, jjim = true): number {
  const after = (at: number): number => {
    const end = skipClaimTail(s, at)
    return s[end] === ' ' ? end + 1 : end
  }
  let at = i
  if (jjim && s.startsWith('찜', i)) at = s[i + 1] === ' ' ? i + 2 : i + 1
  for (;;) {
    const word = longestWordAt(s, at, LEAD_ME_WORDS)
    if (word === undefined) return at
    at = after(at + word.length)
  }
}

/** 주문 문법 `[앞말] 번호목록 [꼬리말] [꼬리 기호]`에 맞는 맨 앞 부분들. 번호 목록은 parts의 count로 자른다. */
function scanClaim(s: string): { numbers: number[]; parts: PartEnd[] } {
  const numbers: number[] = []
  const parts: PartEnd[] = []
  let i = skipLead(s, 0)
  for (;;) {
    const token = readNumber(s, i)
    if (token === undefined) break
    numbers.push(token.value)
    parts.push({ end: token.digitsEnd, count: numbers.length, endsVisibly: false })
    if (token.end !== token.digitsEnd) parts.push({ end: token.end, count: numbers.length, endsVisibly: false })
    i = token.end
    const next = skipSeparators(s, i)
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

/** 취소 문법 `번호 [번] (취소|취소요|취소할게요|취소해주세요|패스|패스요|패스할게요|패스합니다|패스해요) [꼬리 기호·ㅠ·ㅜ]`에 맞는 맨 앞 부분들 */
function scanCancel(s: string, words: readonly string[] = CANCEL_WORDS): { value: number; parts: PartEnd[] } | undefined {
  const token = readNumber(s, 0)
  if (token === undefined) return undefined
  const wordAt = s[token.end] === ' ' ? token.end + 1 : token.end
  const word = longestWordAt(s, wordAt, words)
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

// ── 덧붙인 말 주문 (R-3 세부 "덧붙인 말", D-CHAT-ME-01) ───────────────────

const isHangulSyllable = (s: string, i: number): boolean => {
  const code = s.charCodeAt(i)
  return code >= 0xac00 && code <= 0xd7a3
}
const isAsciiLetter = (s: string, i: number): boolean => {
  const code = s.charCodeAt(i) | 0x20
  return code >= 0x61 && code <= 0x7a
}

/** 낱말이 i에서 끝났다고 볼 수 있는가: 메시지 끝이거나 다음 글자가 한글 음절·숫자·로마자가 아니다 */
function wordEndsAt(s: string, i: number): boolean {
  return i >= s.length || !(isHangulSyllable(s, i) || isDigitAt(s, i) || isAsciiLetter(s, i))
}

/** i에서 끝난 주문 말 뒤에 이어지는 꼬리 기호·꼬리말(`저요저요`, `주세요 ㅈㅇ`)을 건너뛴 자리 */
function skipClaimRest(s: string, i: number): number {
  let at = i
  for (;;) {
    const tailEnd = skipClaimTail(s, at)
    const wordAt = s[tailEnd] === ' ' ? tailEnd + 1 : tailEnd
    const word = longestWordAt(s, wordAt, CLAIM_WORDS)
    if (word === undefined) return tailEnd
    at = wordAt + word.length
  }
}

/**
 * 메시지 어딘가에 또렷한 주문 부분이 있는가 (D-CHAT-ME-01):
 * (가) 번호 + [공백 하나] + 또렷한 주문 말(`26번 저요`, `26 주세요`) 또는 (나) 낱말 첫머리의 "저요" 말 + 번호(`저요 26번`, `ㅈㅇ 26` — `찜 26`은 아님).
 * 어느 쪽이든 그 부분(뒤따르는 꼬리말·꼬리 기호 포함)이 낱말 끝에서 끝나야 한다(`26번 주세요오`·`저요 2개` → 아님).
 * 앞에서부터 한 번 훑는다 — 자리마다 짧은 말 맞추기만 해서 길이에 비례하는 시간이다.
 */
function hasClearClaimPart(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (isDigitAt(s, i) && !isDigitAt(s, i - 1)) {
      const token = readNumber(s, i)
      if (token === undefined) continue
      const wordAt = s[token.end] === ' ' ? token.end + 1 : token.end
      const word = longestWordAt(s, wordAt, CLEAR_CLAIM_WORDS)
      if (word !== undefined && wordEndsAt(s, skipClaimRest(s, wordAt + word.length))) return true
      continue
    }
    if (i > 0 && isHangulSyllable(s, i - 1)) continue
    const at = skipLead(s, i, false)
    if (at === i) continue
    const token = readNumber(s, at)
    if (token !== undefined && wordEndsAt(s, skipClaimRest(s, token.end))) return true
    // 앞말 사슬 안의 뒷자리에서 다시 시작해도 같은 자리에서 끝난다 — 건너뛰어 길이에 비례하는 시간을 지킨다(놓치는 쪽으로만 틀린다)
    i = at - 1
  }
  return false
}

/**
 * 덧붙인 말 주문을 막는 것이 메시지 어디든 있는가 (D-CHAT-ME-01). 막는 말이 있거나, 아래 밖의 글자가 하나라도 있으면 막는다:
 * 한글 음절, 숫자, 공백, 주문 꼬리 기호(허용 목록 그림 이모지·수식 문자 포함), ㅈㅇ·ㅈㅅㅇ, 문장 부호 `,` `.` `·` `…` `"` `'` `(` `)`.
 * 그래서 질문 기호·`@`(남 부르기)·ㅠ ㅜ ㄴㄴ ㅇㅇ 같은 자모·목록 밖 그림 이모지(❌ 😭 🤔)·로마자·`%` `#` `=`·보이지 않는 글자는 모두 막는다.
 * 보이지 않는 글자·수식 문자로 쪼갠 숫자도 막는다.
 */
function hasChatterBlock(s: string): boolean {
  if (CHATTER_BLOCK_WORDS.some((word) => s.includes(word))) return true
  for (let i = 0; i < s.length; ) {
    const codePoint = s.codePointAt(i) as number
    if (codePoint >= 0x3131 && codePoint <= 0x318e) {
      const word = longestWordAt(s, i, CHATTER_JAMO_WORDS)
      if (word !== undefined) {
        i += word.length
        continue
      }
    }
    if (isDigitAt(s, i)) {
      // 보이지 않는 글자·수식 문자로 쪼갠 숫자(`2`·U+FE0F·`2 주세요`)는 같은 번호 되풀이가 아니라 번호 하나다 — 막는다
      let at = i + 1
      while (at < s.length && isInvisible(s.codePointAt(at) as number)) at += (s.codePointAt(at) as number) > 0xffff ? 2 : 1
      if (at > i + 1 && isDigitAt(s, at)) return true
    }
    const ok = isDigitAt(s, i) || isHangulSyllable(s, i) || codePoint === 0x20 || CHATTER_PUNCTUATION.has(codePoint) || isClaimTailChar(codePoint)
    if (!ok) return true
    i += codePoint > 0xffff ? 2 : 1
  }
  return false
}

// ── 옵션 방송 인식(R-20)이 함께 쓰는 도구 ─────────────────────────────────

/** 주문 꼬리말 (R-3 문법) — 길이 내림차순. 옵션 댓글 인식(R-20 4-3)의 끝 꼬리말 */
export const CLAIM_TAIL_WORDS: readonly string[] = CLAIM_WORDS

/** 주문 꼬리의 글자인가: 기호·허용 목록 그림 이모지·그림 이모지 수식 문자 (R-3 세부 "꼬리 기호", D-033) */
export function isClaimTailChar(codePoint: number): boolean {
  return isEmojiModifier(codePoint) || isVisibleClaimTail(codePoint)
}

/** 정규화한 글에 금액 덩어리(천 단위 쉼표 묶음 전체·숫자.숫자, R-3 세부 "금액 모양")가 있는가 */
export function hasAmountChunk(normalized: string): boolean {
  return scanDigitRuns(normalized).some((run) => run.amount)
}

/** 질문 기호 ? ？ ❓ ❔ ⁉ 가 어디에든 있는가 (R-20 9) */
export function hasQuestionMark(text: string): boolean {
  for (const char of text) if (QUESTION_MARKS.has(char.codePointAt(0) as number)) return true
  return false
}

// ── 공개 함수 ────────────────────────────────────────────────────────────

const result = (claims: number[], cancels: number[], mentions: number[]): ChatParseResult => ({ claims, cancels, mentions })

/** 채팅 메시지 → 주문·취소·언급 (R-3, D-028). 어떤 문자열에도 예외를 던지지 않는다. */
export function parseChat(text: string, settings: SettingsOverride = {}): ChatParseResult {
  return readChat(text, settings, true, true)
}

/** 손님 문자 읽기(R-26, sms-text)가 쓰는 R-3 — "패스" 말을 취소로 보지 않는다(문자의 "775 패스"는 지금처럼 확인 필요, D-RETRO-113). 덧붙인 말 주문(D-CHAT-ME-01)도 없다 */
export function parseChatWithoutPass(text: string, settings: SettingsOverride = {}): ChatParseResult {
  return readChat(text, settings, false, false)
}

function readChat(text: string, settings: SettingsOverride, pass: boolean, chatter: boolean): ChatParseResult {
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
    const cancel = scanCancel(s, pass ? CANCEL_WORDS : SMS_CANCEL_WORDS)
    if (cancel !== undefined) {
      const part = pickPart(s, cancel.parts, loose)
      if (part !== undefined && !endsWithSignal(s, part, cancel.parts, isVisibleCancelTail)) return result([], [cancel.value], [])
    }

    // LOOSE: '취소'·'패스'가 들어간 메시지는 주문으로 보지 않는다(D-RETRO-113 — 옛: '15 패스?'가 15번 주문이었다). STRICT에서는 문법상 주문이 될 수 없다.
    if (!(loose && (pass ? hasCancelWord(s) : s.includes('취소')))) {
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

    // 덧붙인 말 주문 (D-CHAT-ME-01 — "26번 저요, 예쁘네요 26번"을 놓쳤다): 문법 밖 메시지라도 번호가 한 가지뿐이고(5자리 이상 숫자도 없음)
    // 또렷한 주문 부분이 있고 막는 것이 없으면 그 번호 주문이다. 채팅만(옵션 방송 R-20 2도 이 결과를 먼저 쓴다) — 손님 문자 읽기(R-26)는 지금처럼 확인 필요.
    const single = uniqueInOrder(numberValues)
    if (chatter && single.length === 1 && runs.every((run) => run.end - run.start <= MAX_NUMBER_DIGITS) && hasClearClaimPart(s) && !hasChatterBlock(s)) return result(single, [], [])
  }

  // 언급: 금액 덩어리가 아닌 1~4자리 숫자 덩어리 중 범위 안의 값
  return result([], [], uniqueInOrder(numberValues.filter(inRange)))
}

/**
 * 메시지 전체가 주문·취소 번호 문법인가 — 번호 개수 상한·claim.multiNumber·번호 범위로 주문·취소가 되지 않은 경우도 문법이다.
 * 금액 덩어리가 있거나 끝 신호(D-035)에 걸리면 문법이 아니다(parseChat과 같은 경계). 옵션 방송 R-20 2가 쓴다:
 * 문법이면 parseChat 결과(언급 포함)를 그대로 쓰고, 옵션 해석으로 넘어가지 않는다.
 */
export function matchesNumberGrammar(text: string, settings: SettingsOverride = {}): boolean {
  const loose = resolveSettings(settings)['claim.parseMode'] === 'LOOSE'
  const s = normalizeText(asText(text))
  if (scanDigitRuns(s).some((run) => run.amount)) return false
  const cancel = scanCancel(s)
  if (cancel !== undefined) {
    const part = pickPart(s, cancel.parts, loose)
    if (part !== undefined && !endsWithSignal(s, part, cancel.parts, isVisibleCancelTail)) return true
  }
  if (loose && hasCancelWord(s)) return false
  const claim = scanClaim(s)
  const part = pickPart(s, claim.parts, loose)
  return part !== undefined && part.count > 0 && !endsWithSignal(s, part, claim.parts, isVisibleClaimTail)
}

/** LOOSE에서 주문으로 보지 않는 말이 들어 있는가: '취소' 또는 '패스' (D-RETRO-113) */
function hasCancelWord(s: string): boolean {
  return s.includes('취소') || s.includes('패스')
}

/**
 * 번호 없는 "패스" (R-3 "패스", D-RETRO-103·113): 메시지 전체가 `(패스|패스요|패스할게요|패스합니다|패스해요) [취소 꼬리]`인가.
 * 모드(STRICT·LOOSE)와 상관없이 메시지 전체가 이 모양일 때만이다 — "패스트", "이건 패스하고 15번", "@누구 패스"처럼 다른 말이 붙으면 아니다(오인 취소가 놓친 취소보다 위험하다).
 * 번호가 함께 있는 "15 패스"는 parseChat의 취소다. 어느 찜인지는 엔진이 정한다(살아 있는 찜이 하나면 그 찜, 아니면 판매자에게 묻는다).
 */
export function isBarePass(text: string): boolean {
  const s = normalizeText(asText(text))
  const word = longestWordAt(s, 0, BARE_PASS_WORDS)
  if (word === undefined) return false
  if (word.length === s.length) return true
  let whole = false
  scanTail(s, word.length, isVisibleCancelTail, (end) => {
    if (end === s.length) whole = true
  })
  return whole
}
