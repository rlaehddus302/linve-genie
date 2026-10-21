// R-20 댓글 옵션 인식 (SPEC CMT-01~CMT-05·CMT-07, D-O-07~D-O-11). 옵션 방송(claim.parseMode=OPTIONS)의 채팅 한 줄을
// 주문 / 취소 / 확인 필요 / 그 밖(언급) 중 하나로 읽는다. 애매하면 주문이 아니다 — 자동 주문은 해석이 하나로 정해지고 모든 항목이 맞을 때만이다.
// 순수 함수다: 시계·난수·I/O를 쓰지 않고, 어떤 문자열에도 예외를 던지지 않으며, 같은 입력이면 같은 결과다(넘긴 값을 바꾸지 않는다).
// 손으로 짠 앞에서부터 훑는 스캐너다. 되돌아가며 다시 맞춰 보는 정규식을 쓰지 않는다.
import { compareChars, variantCount, type OptionItem } from '../options.ts'
import { resolveSettings, type SettingsOverride } from '../settings.ts'
import { CLAIM_TAIL_WORDS, hasAmountChunk, hasQuestionMark, isClaimTailChar, parseChat } from './chat.ts'
import { asText, isAllDigits, isDigitAt, normalizeText } from './text.ts'

/** 인식 함수가 보는 상품 하나 (그 방송의 판매 종료가 아닌 상품 — 공개 전 상품 포함, R-20 머리말) */
export interface OptionCatalogEntry {
  readonly no: number
  /** 상품 이름 (다육에선 품종) */
  readonly name: string
  readonly aliases?: readonly string[]
  readonly options?: readonly OptionItem[]
}

/** 지금 상품과 정해진 뒤 지난 초 (채팅 at − 지금 상품을 정한 이벤트 at, R-20 6) */
export interface OptionFocus {
  readonly no: number
  readonly ageSec: number
}

export type OptionReviewReason =
  | 'OPTION_MISSING'
  | 'OPTION_CONFLICT'
  | 'UNKNOWN_WORD'
  | 'QTY_INVALID'
  | 'NUMBER_AMBIGUOUS'
  | 'PRODUCT_AMBIGUOUS'
  | 'MULTI_PRODUCT'
  | 'FOCUS_CHANGED'

/** 주문 하나: 옵션 상품이면 모든 항목(선택지 하나뿐인 항목 포함), 옵션 없는 상품이면 options 없음 */
export interface OptionOrder {
  readonly no: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty: number
}

/** 확인 필요 — 읽은 것만 담는다(못 읽은 번호·옵션·수량은 없다, D-O1-08) */
export interface OptionReview {
  readonly reason: OptionReviewReason
  readonly no?: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty?: number
}

/** 결과: orders·cancels·mentions·review 중 많아야 하나만 비어 있지 않다 */
export interface OptionCommentResult {
  readonly orders: readonly OptionOrder[]
  readonly cancels: readonly number[]
  readonly mentions: readonly number[]
  readonly review: OptionReview | null
}

/** 지금 상품이 바뀐 뒤 이름 없는 옵션 댓글을 확인 필요로 보내는 시간 (R-20 5-4, D-O-09 — 설정이 아닌 고정값) */
export const FOCUS_GRACE_SEC = 15

/** 수량 단위 (R-20 4-2) — 길이 내림차순 */
const QTY_UNITS = ['박스', '세트', '개', '봉', '팩', '병', '통', '장', '벌']
/** 한글 수 1~5 (R-20 4-2) */
const KOREAN_COUNTS: readonly (readonly [string, number])[] = [
  ['다섯', 5],
  ['한', 1],
  ['두', 2],
  ['세', 3],
  ['네', 4],
]
/** 옵션 사이 구분자 (R-20 4-3) */
const SEPARATORS = new Set([',', '/', '·'])
/** 맨숫자 수량은 1~2자리 (R-20 4-2) */
const MAX_QTY_DIGITS = 2

const EMPTY: OptionCommentResult = Object.freeze({ orders: Object.freeze([]), cancels: Object.freeze([]), mentions: Object.freeze([]), review: null })

const ordersOf = (orders: OptionOrder[]): OptionCommentResult => ({ orders, cancels: [], mentions: [], review: null })
const reviewOf = (review: OptionReview): OptionCommentResult => ({ orders: [], cancels: [], mentions: [], review })
const mentionsOf = (mentions: readonly number[]): OptionCommentResult => (mentions.length === 0 ? EMPTY : { orders: [], cancels: [], mentions: [...mentions], review: null })

// ── 비교 글자 위의 메시지 ────────────────────────────────────────────────

type Kind = 'name' | 'number' | 'option' | 'qty' | 'tail' | 'sep'

/**
 * 정규화한 메시지를 비교 글자(공백 빼기·영문 소문자, R-19)로 옮긴 것. 글자마다 원래 메시지의 위치를 기억해
 * "공백 없이 붙은 숫자"(R-20 4-1)와 남은 말의 덩어리(공백으로 나눈 덩어리, R-20 4-4)를 원래 메시지에서 본다.
 */
class Compact {
  readonly source: string
  readonly text: string
  /** text의 UTF-16 위치 → source의 위치 */
  readonly origin: readonly number[]

  constructor(source: string) {
    this.source = source
    let text = ''
    const origin: number[] = []
    for (let i = 0; i < source.length; i++) {
      const unit = source[i] as string
      if (unit === ' ') continue
      const code = unit.charCodeAt(0)
      text += code >= 0x41 && code <= 0x5a ? unit.toLowerCase() : unit
      origin.push(i)
    }
    this.text = text
    this.origin = origin
  }

  /** text의 [start, end) 부분이 원래 메시지에서 숫자로 시작·끝날 때, 그 앞뒤에 다른 숫자가 공백 없이 붙어 있지 않은가 */
  digitBoundaryOk(start: number, end: number): boolean {
    const first = this.origin[start] as number
    const last = this.origin[end - 1] as number
    if (isDigitAt(this.source, first) && first > 0 && isDigitAt(this.source, first - 1)) return false
    if (isDigitAt(this.source, last) && isDigitAt(this.source, last + 1)) return false
    return true
  }
}

/** 읽는 동안의 표시: 비교 글자마다 무엇으로 읽었는지 */
class Marks {
  readonly kinds: (Kind | null)[]

  constructor(length: number, from?: Marks) {
    this.kinds = from === undefined ? new Array<Kind | null>(length).fill(null) : [...from.kinds]
  }

  free(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.kinds[i] !== null) return false
    return true
  }

  mark(start: number, end: number, kind: Kind): void {
    for (let i = start; i < end; i++) this.kinds[i] = kind
  }
}

interface Entry<V> {
  readonly key: string
  readonly value: V
}

interface Match<V> {
  readonly start: number
  readonly end: number
  readonly value: V
}

/**
 * 사전 단어를 겹치지 않게 왼쪽부터, 자리마다 가장 긴 것으로 찾아 표시한다 (R-20 3 가·4-1).
 * 숫자로 시작하거나 끝나는 단어는 원래 메시지에서 앞뒤에 숫자가 공백 없이 붙어 있으면 맞지 않는다.
 */
function findWords<V>(compact: Compact, marks: Marks, entries: readonly Entry<V>[], kind: Kind): Match<V>[] {
  const sorted = [...entries].sort((a, b) => b.key.length - a.key.length)
  const out: Match<V>[] = []
  const { text } = compact
  for (let i = 0; i < text.length; ) {
    let found: Entry<V> | undefined
    if (marks.kinds[i] === null) {
      found = sorted.find(({ key }) => text.startsWith(key, i) && marks.free(i, i + key.length) && compact.digitBoundaryOk(i, i + key.length))
    }
    if (found === undefined) {
      i++
      continue
    }
    const end = i + found.key.length
    marks.mark(i, end, kind)
    out.push({ start: i, end, value: found.value })
    i = end
  }
  return out
}

// ── 해석 후보 ────────────────────────────────────────────────────────────

interface Candidate {
  readonly entry: OptionCatalogEntry
  /** 'name' = 이름(가), 'number' = 맨 앞 번호(나), 'focus' = 지금 상품(다) */
  readonly source: 'name' | 'number' | 'focus'
  readonly marks: Marks
}

interface Reading {
  readonly candidate: Candidate
  /** 항목 번호 → 읽은 선택지 번호들 (나온 순서, 겹침 없음) */
  readonly picks: ReadonlyMap<number, readonly number[]>
  /** 읽은 수량 (안 썼으면 undefined) */
  readonly qty: number | undefined
  /** 수량을 둘 이상 읽었다 */
  readonly manyQty: boolean
  /** 남은 말 덩어리 수 */
  readonly chunks: number
}

/** 맨 앞 `숫자{1,4}[번]` + 공백 (R-20 3 나) — 비교 글자에서 그 부분의 끝과 번호 */
function leadingNumber(compact: Compact): { readonly value: number; readonly end: number } | undefined {
  const s = compact.source
  let i = 0
  while (isDigitAt(s, i)) i++
  if (i === 0 || i > 4) return undefined
  const value = Number(s.slice(0, i))
  let next = i
  if (s[next] === '번') next++
  else if (s[next] === ' ' && s[next + 1] === '번') next += 2
  if (s[next] !== ' ') return undefined
  // 비교 글자의 끝: 원래 위치가 next보다 앞인 글자 수
  let end = 0
  while (end < compact.origin.length && (compact.origin[end] as number) < next) end++
  return { value, end }
}

/** 원래 메시지에서 위치 o 바로 앞 글자 (없으면 undefined) */
function charBefore(s: string, o: number): string | undefined {
  return o > 0 ? s[o - 1] : undefined
}

/**
 * 후보 하나의 나머지 읽기 (R-20 4): 옵션 값(숫자 먼저) → 수량(단위가 붙은 수, 이름·옵션 바로 뒤의 맨숫자) → 꼬리 → 남은 말.
 * 후보의 표시(상품을 가리킨 부분)는 이미 들어 있다.
 */
function readCandidate(compact: Compact, candidate: Candidate): Reading {
  const marks = candidate.marks
  const { text, source, origin } = compact
  const options = candidate.entry.options ?? []
  const optionEntries: Entry<readonly [number, number]>[] = []
  options.forEach((item, i) =>
    item.choices.forEach((choice, j) => {
      for (const word of [choice.label, ...(choice.aliases ?? [])]) {
        const key = compareChars(word)
        if (key !== '') optionEntries.push({ key, value: [i, j] })
      }
    }),
  )
  const picks = new Map<number, number[]>()
  for (const { value } of findWords(compact, marks, optionEntries, 'option')) {
    const [item, choice] = value
    const list = picks.get(item) ?? []
    if (!list.includes(choice)) list.push(choice)
    picks.set(item, list)
  }

  // 구분자 , / · 는 어디에 있어도 구분자다
  for (let i = 0; i < text.length; i++) if (marks.kinds[i] === null && SEPARATORS.has(text[i] as string)) marks.mark(i, i + 1, 'sep')

  const quantities: number[] = []
  /** 원래 메시지에서 앞뒤에 숫자가 붙지 않은 숫자 덩어리 [start, end) (비교 글자 위치) */
  const digitRun = (i: number): number => {
    let end = i + 1
    while (end < text.length && isDigitAt(text, end) && marks.kinds[end] === null && origin[end] === (origin[end - 1] as number) + 1) end++
    return end
  }
  const unitAt = (i: number): string | undefined => QTY_UNITS.find((unit) => text.startsWith(unit, i) && marks.free(i, i + unit.length))
  // 단위가 붙은 수: 숫자{1,2} 또는 한글 수 + 단위 (메시지 어디에 있어도 된다)
  for (let i = 0; i < text.length; i++) {
    if (marks.kinds[i] !== null) continue
    if (isDigitAt(text, i)) {
      const end = digitRun(i)
      if (end - i <= MAX_QTY_DIGITS && compact.digitBoundaryOk(i, end)) {
        const unit = unitAt(end)
        if (unit !== undefined) {
          quantities.push(Number(text.slice(i, end)))
          marks.mark(i, end + unit.length, 'qty')
          i = end + unit.length - 1
          continue
        }
      }
      i = end - 1
      continue
    }
    const before = charBefore(source, origin[i] as number)
    const boundary = before === undefined || before === ' ' || SEPARATORS.has(before) || (i > 0 && marks.kinds[i - 1] !== null)
    if (!boundary) continue
    for (const [word, value] of KOREAN_COUNTS) {
      if (!text.startsWith(word, i) || !marks.free(i, i + word.length)) continue
      const unit = unitAt(i + word.length)
      if (unit === undefined) continue
      quantities.push(value)
      marks.mark(i, i + word.length + unit.length, 'qty')
      i += word.length + unit.length - 1
      break
    }
  }
  // 맨숫자: 상품 이름이나 옵션 값 바로 뒤(사이에 공백·구분자만)의 숫자{1,2} 덩어리 전체
  for (let i = 0; i < text.length; i++) {
    if (marks.kinds[i] !== null || !isDigitAt(text, i)) continue
    const end = digitRun(i)
    let back = i - 1
    while (back >= 0 && marks.kinds[back] === 'sep') back--
    const after = back >= 0 ? marks.kinds[back] : null
    if (end - i <= MAX_QTY_DIGITS && compact.digitBoundaryOk(i, end) && (after === 'name' || after === 'option')) {
      quantities.push(Number(text.slice(i, end)))
      marks.mark(i, end, 'qty')
    }
    i = end - 1
  }

  // 꼬리: 맨 앞 '찜', 끝의 꼬리 기호와 그 앞의 꼬리말 (R-3)
  if (text.startsWith('찜') && marks.kinds[0] === null) marks.mark(0, 1, 'tail')
  let end = text.length
  for (;;) {
    if (end === 0 || marks.kinds[end - 1] !== null) break
    const low = text.charCodeAt(end - 1)
    const start = low >= 0xdc00 && low <= 0xdfff && end >= 2 ? end - 2 : end - 1
    const codePoint = text.codePointAt(start) as number
    if (!isClaimTailChar(codePoint) || !marks.free(start, end)) break
    marks.mark(start, end, 'tail')
    end = start
  }
  const word = CLAIM_TAIL_WORDS.find((w) => end - w.length >= 0 && text.startsWith(w, end - w.length) && marks.free(end - w.length, end))
  if (word !== undefined) marks.mark(end - word.length, end, 'tail')

  // 남은 말: 표시되지 않은 글자를 원래 메시지에서 이어진 덩어리로 센다
  let chunks = 0
  let previous = -2
  for (let i = 0; i < text.length; i++) {
    if (marks.kinds[i] !== null) continue
    const o = origin[i] as number
    if (o !== previous + 1) chunks++
    previous = o
  }
  return { candidate, picks, qty: quantities[0], manyQty: quantities.length > 1, chunks }
}

/** 고른 옵션 맵 (항목 순서). auto면 선택지가 하나뿐인 항목도 넣는다 */
function pickMap(options: readonly OptionItem[], picks: ReadonlyMap<number, readonly number[]>, auto: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  options.forEach((item, i) => {
    const chosen = picks.get(i)
    const index = chosen !== undefined && chosen.length === 1 ? chosen[0] : auto && item.choices.length === 1 ? 0 : undefined
    if (index !== undefined) Object.defineProperty(out, item.name, { value: (item.choices[index] as { readonly label: string }).label, enumerable: true, writable: true, configurable: true })
  })
  return out
}

/** 확인 필요 결과 (읽은 것만 — 빈 옵션 맵·안 쓴 수량은 넣지 않는다) */
function review(reason: OptionReviewReason, no: number | undefined, options: Record<string, string> | undefined, qty: number | undefined): OptionCommentResult {
  return reviewOf({
    reason,
    ...(no === undefined ? {} : { no }),
    ...(options === undefined || Object.keys(options).length === 0 ? {} : { options }),
    ...(qty === undefined ? {} : { qty }),
  })
}

/** 들어맞은 해석 하나를 검사한다 (R-20 5: 겹침 → 수량 범위 → 빠진 항목 → 지금 상품 15초 → 주문) */
function decideReading(reading: Reading, focus: OptionFocus | null, maxQuantity: number): OptionCommentResult {
  const { entry, source } = reading.candidate
  const options = entry.options ?? []
  if ([...reading.picks.values()].some((list) => list.length > 1)) return review('OPTION_CONFLICT', entry.no, undefined, reading.qty)
  const read = pickMap(options, reading.picks, false)
  if (reading.qty !== undefined && (reading.qty < 1 || reading.qty > maxQuantity)) return review('QTY_INVALID', entry.no, read, reading.qty)
  const missing = options.some((item, i) => item.choices.length > 1 && !reading.picks.has(i))
  if (missing) return review('OPTION_MISSING', entry.no, read, reading.qty)
  if (source === 'focus' && focus !== null && focus.ageSec < FOCUS_GRACE_SEC) return review('FOCUS_CHANGED', entry.no, read, reading.qty)
  const qty = reading.qty ?? 1
  return ordersOf([options.length === 0 ? { no: entry.no, qty } : { no: entry.no, options: pickMap(options, reading.picks, true), qty }])
}

/** 번호 문법 주문의 상품 하나 (옵션 상품이면 변형이 하나뿐이어야 한다 — 부르는 쪽이 먼저 본다) */
function numberOrder(no: number, entry: OptionCatalogEntry | undefined): OptionOrder {
  const options = entry?.options ?? []
  return options.length === 0 ? { no, qty: 1 } : { no, options: pickMap(options, new Map(), true), qty: 1 }
}

/**
 * 옵션 방송의 채팅 한 줄 → 주문·취소·확인 필요·언급 (R-20).
 * @param catalog 그 방송의 판매 종료가 아닌 상품(공개 전 포함) — 번호는 서로 다르다고 본다(같으면 처음 것)
 * @param focus 지금 상품과 지난 초 (없으면 null)
 * @param settings claim.maxNumber·claim.maxQuantity·claim.multiNumber (빠지면 DOMAIN_RULES 기본값)
 */
export function parseOptionComment(text: string, catalog: readonly OptionCatalogEntry[], focus: OptionFocus | null, settings: SettingsOverride = {}): OptionCommentResult {
  const config = resolveSettings(settings)
  const s = normalizeText(asText(text))
  const byNo = new Map<number, OptionCatalogEntry>()
  for (const entry of catalog) if (!byNo.has(entry.no)) byNo.set(entry.no, entry)
  const focusEntry = focus === null ? undefined : byNo.get(focus.no)
  // R-3 STRICT 문법 (판매 방식을 넘기지 않으면 기본값 STRICT — 다육 방식과 같은 댓글은 같은 뜻)
  const strict = parseChat(s, { 'claim.multiNumber': config['claim.multiNumber'], 'claim.maxNumber': config['claim.maxNumber'] })

  // 2. 번호 문법 먼저 (다육 방식과 같은 댓글은 같은 뜻)
  if (strict.claims.length > 0) {
    if (strict.claims.length === 1 && isAllDigits(s) && focusEntry !== undefined) {
      const word = compareChars(s)
      const sameAsChoice = (focusEntry.options ?? []).some((item) => item.choices.some((choice) => [choice.label, ...(choice.aliases ?? [])].some((w) => compareChars(w) === word)))
      if (sameAsChoice) return review('NUMBER_AMBIGUOUS', undefined, undefined, undefined)
    }
    const needs = strict.claims.find((no) => variantCount(byNo.get(no)?.options ?? []) >= 2)
    if (needs !== undefined) return review('OPTION_MISSING', needs, undefined, undefined)
    return ordersOf(strict.claims.map((no) => numberOrder(no, byNo.get(no))))
  }
  if (strict.cancels.length > 0) return { orders: [], cancels: [...strict.cancels], mentions: [], review: null }

  // 9. 늘 주문이 아닌 것: 질문 기호·금액 덩어리, 번호 취소 문법이 아닌 '취소'
  if (hasQuestionMark(s) || hasAmountChunk(s) || s.includes('취소')) return mentionsOf(strict.mentions)

  // 3. 상품 찾기
  const compact = new Compact(s)
  const nameEntries: Entry<number>[] = []
  for (const entry of byNo.values()) {
    for (const word of [entry.name, ...(entry.aliases ?? [])]) {
      const key = compareChars(word)
      if (key !== '') nameEntries.push({ key, value: entry.no })
    }
  }
  // 같은 비교 글자의 이름·별칭은 한 단어로 모아 그 단어가 가리키는 상품들을 본다
  const words = new Map<string, Set<number>>()
  for (const { key, value } of nameEntries) {
    const set = words.get(key) ?? new Set<number>()
    set.add(value)
    words.set(key, set)
  }
  const nameMarks = new Marks(compact.text.length)
  const named = findWords(
    compact,
    nameMarks,
    [...words].map(([key, nos]) => ({ key, value: nos })),
    'name',
  )
  const lead = leadingNumber(compact)
  const candidates: Candidate[] = []
  if (named.length > 0) {
    if (named.some((match) => match.value.size > 1)) return review('PRODUCT_AMBIGUOUS', undefined, undefined, undefined)
    const products = new Set(named.map((match) => [...match.value][0] as number))
    if (products.size > 1) return review('MULTI_PRODUCT', undefined, undefined, undefined)
    const no = [...products][0] as number
    if (lead !== undefined && byNo.has(lead.value) && nameMarks.free(0, lead.end)) {
      if (lead.value !== no) return review('MULTI_PRODUCT', undefined, undefined, undefined)
      nameMarks.mark(0, lead.end, 'number')
    }
    candidates.push({ entry: byNo.get(no) as OptionCatalogEntry, source: 'name', marks: nameMarks })
  } else {
    const leadEntry = lead === undefined ? undefined : byNo.get(lead.value)
    if (lead !== undefined && leadEntry !== undefined) {
      const marks = new Marks(compact.text.length)
      marks.mark(0, lead.end, 'number')
      candidates.push({ entry: leadEntry, source: 'number', marks })
    }
    if (focusEntry !== undefined) candidates.push({ entry: focusEntry, source: 'focus', marks: new Marks(compact.text.length) })
  }
  if (candidates.length === 0) return mentionsOf(strict.mentions)

  // 4·5. 후보마다 나머지를 읽고 들어맞는 해석을 고른다
  const readings = candidates.map((candidate) => readCandidate(compact, candidate))
  const fits = readings.filter((reading) => reading.chunks === 0 && !reading.manyQty && (reading.candidate.source !== 'focus' || reading.picks.size > 0))
  if (fits.length > 1) return review('NUMBER_AMBIGUOUS', undefined, undefined, undefined)
  if (fits.length === 1) return decideReading(fits[0] as Reading, focus, config['claim.maxQuantity'])
  const unknown = readings.find((reading) => reading.candidate.source !== 'focus' && (reading.candidate.entry.options ?? []).length > 0 && reading.chunks === 1)
  if (unknown !== undefined) return review('UNKNOWN_WORD', unknown.candidate.entry.no, undefined, undefined)
  return mentionsOf(strict.mentions)
}
