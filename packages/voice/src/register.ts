// V3 음성 바로 등록 (VOC-03·VOC-04·PRD-06, DOMAIN_RULES R-17 7·8, R-22, D-V3-01~D-V3-12). 골든: tests/golden/voice-register/*.json.
// - 품종 추측(R-17 7): 사전 밖 품종을 말해도 품종 칸이 비지 않게 들은 낱말 하나를 고른다(사전을 쓰지 않는다).
// - 확정 읽기(R-17 8): 'N번'(또는 자리 읽기 번호)과 '…원' 가격이 둘 다 들린 순간 바로 등록할 값.
// - 음성 같은 번호(R-22): 이미 있는 번호를 들었을 때 무시·바로 고침·묻기.
// - 열린 카드 합치기: 같은 번호의 열린 카드를 하나로.
// 모두 순수 함수: 넘긴 값을 바꾸지 않고, 시계·난수·네트워크를 쓰지 않으며, 어떤 입력에도 예외를 던지지 않는다(카드 합치기는 카드 모양만 믿는다).
import { normalizeText } from '@livejjim/core'
import { closeCard, editCard, type SuggestionCard } from './card.ts'
import type { ChunkReading } from './correction.ts'
import { CANCEL_WORDS, CORRECTION_MARKERS, GUESS_WORD_MAX, isFiller, looksLikePredicate } from './words.ts'
export { GUESS_FILLERS, GUESS_WORD_MAX, PREDICATE_END_CHARS, isCommonWord, looksLikePredicate } from './words.ts'
import { ENDINGS, analyzeSentence, readingForms, type ExtractOptions, type SentenceAnalysis, type VoiceExtraction } from './extract.ts'

// ── 품종 추측 (R-17 7, D-V3-09) ──────────────────────────────────────────

const ENDINGS_LONG_FIRST: readonly string[] = [...ENDINGS].sort((a, b) => b.length - a.length)
const codePoints = (text: string): number => [...text].length

/** 낱말: 끝말을 긴 것부터 하나 뗀 모양(남는 글자가 2글자 이상일 때만, 아니면 토큰 그대로) */
export function guessWord(token: string): string {
  for (const ending of ENDINGS_LONG_FIRST) {
    if (token.endsWith(ending) && codePoints(token.slice(0, -ending.length)) >= 2) return token.slice(0, -ending.length)
  }
  return token
}

type TokenKind = 'stop' | 'skip' | 'word'

function tokenKinds(analysis: SentenceAnalysis): TokenKind[] {
  return analysis.tokens.map((token, i) => {
    if (analysis.claimedTokens.has(i) || /[0-9]/.test(token) || /^[0-9,.일이삼사오육칠팔구십백천만]+$/.test(token)) return 'stop'
    const word = guessWord(token)
    const length = codePoints(word)
    if (length <= 1 || length > GUESS_WORD_MAX) return 'skip'
    if (isFiller(token) || isFiller(word) || readingForms(token).some(isFiller)) return 'skip'
    return 'word'
  })
}

function guessFromAnalysis(analysis: SentenceAnalysis): string | null {
  if (analysis.reading.extraction.no === null) return null
  const kinds = tokenKinds(analysis)
  const words = analysis.tokens.map(guessWord)
  const candidate = (i: number): boolean => kinds[i] === 'word' && !looksLikePredicate(words[i] as string)
  // 고르기 (D-V3-30): 두 번 이상 나온 후보 낱말 가운데 처음 나온 것. 한 번만 나온 낱말은 쓰지 않는다
  const counts = new Map<string, number>()
  words.forEach((word, i) => {
    if (candidate(i)) counts.set(word, (counts.get(word) ?? 0) + 1)
  })
  const first = words.findIndex((word, i) => candidate(i) && (counts.get(word) ?? 0) >= 2)
  return first >= 0 ? (words[first] as string) : null
}

/** 사전 밖 품종 추측 (R-17 7). 번호가 없거나 애매하면 null. 사전을 쓰지 않는다 */
export function guessVariety(text: unknown, options: { readonly maxNumber?: number } = {}): string | null {
  const maxNumber = typeof options === 'object' && options !== null ? options.maxNumber : undefined
  return guessFromAnalysis(analyzeSentence(text, maxNumber === undefined ? {} : { maxNumber }))
}

// ── 확정 읽기 (R-17 8, D-V3-02) ──────────────────────────────────────────

/** 바로 등록할 값 */
export interface ReadyRegistration {
  readonly no: number
  readonly price: number
  /** 사전 맞춤 이름, 없으면 null(품종 미입력) — 추측은 넣지 않는다(D-V3-37, RegistrationReading.guess는 후보 단추용) */
  readonly name: string | null
  /** V3 D-V3-37부터 늘 false (추측을 등록 품종에 쓰지 않는다) — 옛 모양을 위해 남김 */
  readonly nameNeedsCheck: boolean
  /** 번호를 낸 것: 'N번'이 들림(marker) · '번' 없는 번호(bare). 이미 있는 번호면 decideForExisting에 그대로 넘긴다 */
  readonly numberFrom: 'marker' | 'bare'
}

/** 바로 등록하지 않는 까닭 (카드만 — 화면 문구는 화면이 정한다) */
export type ReadyBlock = 'PRICE_TOO_HIGH' | 'BARE_NUMBER_AFTER_PRICE'

/** 덩어리 하나를 V3로 읽은 결과 (화면 카드·기록용) */
export interface RegistrationReading {
  /** R-17 1~6 결과 그대로 */
  readonly extraction: VoiceExtraction
  /** 품종 추측 (R-17 7) */
  readonly guess: string | null
  /** 가격이 원 가격 줄에서 나왔는가 (R-17 8 — R-22 priceSure) */
  readonly priceSure: boolean
  /** 정정 표시·취소 낱말이 있는가 (있으면 덩어리가 끝날 때 V2 규칙으로 읽는다) */
  readonly correction: boolean
  /** 들린 번호 전부 (겹친 값 한 번 — 둘 이상이면 "번호 확인 필요 · 들린 번호: 189·139") */
  readonly heardNumbers: readonly number[]
  /** 읽힌 가격 전부 (겹친 값 한 번) */
  readonly heardPrices: readonly number[]
  /** 원 가격 줄에서 읽힌 가격 (겹친 값 한 번) — 정정 덩어리의 덮은 가격이 '원'으로 들렸는지 (D-V3-44, TD-V3-003) */
  readonly wonPrices: readonly number[]
  /** 등록·카드에 쓸 추측 품종 — D-V3-30부터 `guess`와 같다(두 번 이상 나온 낱말만, 풀이말 끝 모양 제외). 예전 이름이라 남겨 둔다 */
  readonly safeGuess: string | null
  /** 번호를 낸 것 (no가 없으면 null) */
  readonly numberFrom: 'marker' | 'bare' | null
  /** 번호·'원' 가격은 확정됐지만 바로 등록하지 않는 까닭 (없으면 null) — 카드로 보여 준다 */
  readonly blocked: ReadyBlock | null
  /** 확정이면 바로 등록할 값, 아니면 null */
  readonly ready: ReadyRegistration | null
}

/** 바로 등록할 수 있는 가격 상한 (원). 넘으면 카드만 — "가격 확인 필요" (크롬이 "육십오만"을 "605만"으로 적는 일이 있다) */
export const AUTO_REGISTER_PRICE_MAX = 3_000_000


const MALGO = '말고'
const hasCorrectionWord = (tokens: readonly string[]): boolean =>
  tokens.some((token) => CORRECTION_MARKERS.includes(token) || CANCEL_WORDS.includes(token) || token.endsWith(MALGO))

/** 확정 읽기 설정 */
export interface RegistrationOptions extends ExtractOptions {
  /**
   * 글이 최종 결과로 끝났는가 (R-17 8, D-V3-26). 생략 = 거짓(중간 결과). 중간 결과에서 `no`가 '번' 없는 번호이고 그 후보 토큰이 글의 마지막 토큰이면
   * 확정하지 않는다 — "25만 원 1" 뒤에 "5번"이, "25만 원 이십" 뒤에 "오번"이 올 수 있다. 'N번'은 글 끝이어도 바로.
   */
  readonly final?: boolean
}

/** 덩어리 글(모은 최종 결과 + 지금 중간 결과)을 V3로 읽는다 */
export function readRegistration(text: unknown, options: RegistrationOptions = {}): RegistrationReading {
  const analysis = analyzeSentence(text, options)
  const { extraction } = analysis.reading
  const guess = guessFromAnalysis(analysis)
  const priceSure = extraction.price !== null && analysis.wonLines > 0
  const correction = hasCorrectionWord(analysis.tokens)
  const safeGuess = guess
  const numberFrom = analysis.numberFrom
  const sure = extraction.no !== null && extraction.price !== null && priceSure && !correction && (options.final === true || !analysis.bareNumberAtEnd)
  const blocked: ReadyBlock | null = !sure
    ? null
    : (extraction.price as number) > AUTO_REGISTER_PRICE_MAX
      ? 'PRICE_TOO_HIGH'
      : analysis.bareNumberAfterPrice
        ? 'BARE_NUMBER_AFTER_PRICE'
        : null
  const ready: ReadyRegistration | null =
    sure && blocked === null && numberFrom !== null
      ? // D-V3-37: 등록 품종은 사전 맞춤(name)뿐 — 추측은 카드 후보 단추(guess)로만
        { no: extraction.no as number, price: extraction.price as number, name: extraction.name, nameNeedsCheck: false, numberFrom }
      : null
  return { extraction, guess, safeGuess, numberFrom, blocked, priceSure, correction, heardNumbers: analysis.heardNumbers, heardPrices: analysis.heardPrices, wonPrices: analysis.wonPrices, ready }
}

/**
 * 확정 읽기 (R-17 8): 'N번'(또는 자리 읽기 번호)과 '…원' 가격이 둘 다 확정됐을 때만 바로 등록할 값, 아니면 null.
 * 번호가 둘 이상 다르면·'원'이 아직 안 들렸으면·정정/취소 낱말이 있으면·중간 결과(final 아님)가 '번' 없는 번호로 끝나면 null. 품종은 기다리지 않는다.
 */
export function readyToRegister(text: string, options: RegistrationOptions = {}): ReadyRegistration | null {
  return readRegistration(text, options).ready
}

// ── 음성 같은 번호 (R-22, D-V3-06·D-V3-07) ───────────────────────────────

export type NameFrom = 'DICTIONARY' | 'GUESS'
export type SameNumberStatus = 'READY' | 'OPEN' | 'SOLD' | 'HOLD' | 'CLOSED'
export type SameNumberAction = 'IGNORE' | 'AUTO_FIX' | 'ASK'
export type SameNumberReason = 'NO_AUTO' | 'NUMBER_BARE' | 'NOT_OPEN' | 'PRICE_NOT_SURE' | 'PRICE_JUMP' | 'CLAIMS'
export type NumberFrom = 'MARKER' | 'BARE'

export interface SameNumberInput {
  readonly heard: {
    readonly price: number | null
    readonly priceSure: boolean
    readonly name: string | null
    readonly nameFrom: NameFrom | null
    /** 번호를 들은 꼴 — 없으면 MARKER (D-V3-32) */
    readonly numberFrom?: NumberFrom
  }
  readonly product: { readonly name: string; readonly price: number; readonly status: SameNumberStatus; readonly liveClaims: number }
  /** 바로 고쳐도 되는 덩어리인가 (자동 등록 켬 ∧ 덩어리 내내 켜짐 ∧ 끝에서 넘긴 덩어리 아님 ∧ 그 번호를 거절하지 않음) */
  readonly auto: boolean
}

export interface SameNumberDecision {
  readonly action: SameNumberAction
  /** 바꿀 칸만 (없으면 {}) */
  readonly changes: { readonly price?: number; readonly name?: string }
  readonly reason: SameNumberReason | null
}

const compactName = (name: string): string => normalizeText(name).split(' ').join('')

/** 바로 고침에서 받는 가격 비율 (D-V3-33): 새 가격이 기존의 3배를 넘거나 1/3 미만이면 묻는다(딱 3배는 받는다) */
export const AUTO_FIX_PRICE_RATIO = 3

/** R-22: 들은 번호의 상품이 이미 있을 때 무엇을 할지 */
export function decideSameNumber(input: SameNumberInput): SameNumberDecision {
  const { heard, product } = input
  const changes: { price?: number; name?: string } = {}
  if (heard.price !== null && heard.price !== product.price) changes.price = heard.price
  let fillOnly = false
  // 추측(GUESS)은 이미 있는 상품의 품종을 채우지도 바꾸지도 않는다 (D-V3-31) — 사전 이름만
  if (heard.nameFrom === 'DICTIONARY' && heard.name !== null && compactName(heard.name) !== '' && compactName(heard.name) !== compactName(product.name)) {
    changes.name = heard.name
    fillOnly = compactName(product.name) === ''
  }
  if (changes.price === undefined && changes.name === undefined) return { action: 'IGNORE', changes: {}, reason: null }
  const ask = (reason: SameNumberReason): SameNumberDecision => ({ action: 'ASK', changes, reason })
  if (!input.auto) return ask('NO_AUTO')
  if (heard.numberFrom === 'BARE') return ask('NUMBER_BARE')
  if (product.status !== 'OPEN' && product.status !== 'SOLD') return ask('NOT_OPEN')
  if (changes.price !== undefined && !heard.priceSure) return ask('PRICE_NOT_SURE')
  if (
    changes.price !== undefined &&
    (changes.price > product.price * AUTO_FIX_PRICE_RATIO || changes.price * AUTO_FIX_PRICE_RATIO < product.price || changes.price > AUTO_REGISTER_PRICE_MAX)
  )
    return ask('PRICE_JUMP')
  if (product.liveClaims > 0 && !(fillOnly && changes.price === undefined)) return ask('CLAIMS')
  return { action: 'AUTO_FIX', changes, reason: null }
}

/** 화면이 쓰는 짧은 모양 — 이미 등록된 상품 */
export interface ExistingProduct {
  readonly no: number
  /** "" = 품종 미입력 */
  readonly name: string
  readonly price: number
  readonly claimCount: number
}

export type ExistingDecision =
  | { readonly kind: 'IGNORE' }
  | { readonly kind: 'AUTO_FIX'; readonly price: number | null; readonly name: string | null }
  | { readonly kind: 'FILL_NAME'; readonly name: string }
  | { readonly kind: 'ASK'; readonly price: number | null; readonly name: string | null }

export interface ExistingHeard {
  readonly name: string | null
  readonly price: number | null
  /** 품종이 추측(사전 밖)인가 — 있는 품종을 덮지 않는다. 생략 = 거짓(사전 이름) */
  readonly nameNeedsCheck?: boolean
  /** 가격이 원 가격 줄에서 나왔는가. 생략 = 참 */
  readonly priceSure?: boolean
  /** 번호를 낸 것. 'bare'('번' 없는 번호)면 바로 고치지 않는다(IGNORE 또는 ASK). 생략 = 'marker' */
  readonly numberFrom?: 'marker' | 'bare'
}


export interface ExistingContext {
  /** 바로 고쳐도 되는 덩어리인가 (R-22 auto). 생략 = 참 */
  readonly auto?: boolean
  /** 상품 상태. 생략 = 판매 중(OPEN) */
  readonly status?: SameNumberStatus
}

/**
 * R-22를 화면용 짧은 모양으로: 바뀌는 칸만 값(그대로면 null).
 * IGNORE = 같음 · AUTO_FIX = 찜 없고 바로 고침 · FILL_NAME = 찜이 있어도 비었던 품종을 사전 이름으로 채움 · ASK = 고칠까요 카드.
 */
export function decideForExisting(existing: ExistingProduct, heard: ExistingHeard, context: ExistingContext = {}): ExistingDecision {
  const decision = decideSameNumber({
    heard: {
      price: heard.price,
      priceSure: heard.priceSure !== false,
      name: heard.name,
      nameFrom: heard.name === null ? null : heard.nameNeedsCheck === true ? 'GUESS' : 'DICTIONARY',
      numberFrom: heard.numberFrom === 'bare' ? 'BARE' : 'MARKER',
    },
    product: { name: existing.name, price: existing.price, status: context.status ?? 'OPEN', liveClaims: existing.claimCount },
    auto: context.auto !== false,
  })
  const price = decision.changes.price ?? null
  const name = decision.changes.name ?? null
  if (decision.action === 'IGNORE') return { kind: 'IGNORE' }
  if (decision.action === 'ASK') return { kind: 'ASK', price, name }
  if (existing.claimCount > 0 && name !== null && price === null) return { kind: 'FILL_NAME', name }
  return { kind: 'AUTO_FIX', price, name }
}

// ── 열린 카드 합치기 (D-V3-06) ───────────────────────────────────────────

/**
 * 같은 번호의 열린 카드를 하나로 합친다. 남는 카드 = 그 번호에서 손댄 카드가 있으면 목록에서 가장 앞의 손댄 카드, 없으면 가장 앞(새) 카드.
 * 남는 카드의 빈 칸(품종·가격)은 다른 카드 값으로 채우고(목록 앞쪽 먼저), 나머지 카드는 닫는다. 번호 없는 카드·확정·닫힌 카드는 그대로.
 */
export function mergeSameNumberCards(cards: readonly SuggestionCard[]): SuggestionCard[] {
  const groups = new Map<number, number[]>()
  cards.forEach((card, i) => {
    if (card.status !== 'OPEN' || card.no === null) return
    groups.set(card.no, [...(groups.get(card.no) ?? []), i])
  })
  const next = [...cards]
  for (const indices of groups.values()) {
    if (indices.length < 2) continue
    const keep = indices.find((i) => (cards[i] as SuggestionCard).touched) ?? (indices[0] as number)
    let merged = cards[keep] as SuggestionCard
    for (const i of indices) {
      if (i === keep) continue
      const other = cards[i] as SuggestionCard
      // 추측 품종(nameNeedsCheck) 카드의 품종은 옮기지 않는다 (D-V3-37)
      if (merged.name === null && other.name !== null && other.nameNeedsCheck !== true) {
        merged = { ...merged, name: other.name, ...(other.nameNeedsCheck === undefined ? {} : { nameNeedsCheck: other.nameNeedsCheck }), ...(other.nameExact === undefined ? {} : { nameExact: other.nameExact }) }
      }
      if (merged.price === null && other.price !== null) merged = { ...merged, price: other.price }
      next[i] = closeCard(other)
    }
    next[keep] = merged
  }
  return next
}

// ── 확정 읽기 짧은 모양 (AC-V3-03·09) ───────────────────────────────────

/** 확정 읽기 결과 (acceptance 이름) */
export interface SureReading {
  /** 바로 등록할 때인가 (R-17 8) */
  readonly sure: boolean
  readonly no: number | null
  readonly price: number | null
  /** 사전 이름 */
  readonly name: string | null
  /** 품종 추측 (R-17 7) */
  readonly guess: string | null
  /** 들린 번호 전부 (D-V3-05 — 189·139) */
  readonly numbers: readonly number[]
  readonly numberFrom: 'marker' | 'bare' | null
  /** 번호·'원' 가격은 확정됐지만 카드로만 보이는 까닭 */
  readonly blocked: ReadyBlock | null
}

/** 확정 읽기 (R-17 8) — readRegistration의 짧은 모양. 어떤 입력에도 예외를 던지지 않는다 */
export function readSure(text: unknown, options: RegistrationOptions = {}): SureReading {
  try {
    const r = readRegistration(text, options)
    return { sure: r.ready !== null, no: r.extraction.no, price: r.extraction.price, name: r.extraction.name, guess: r.guess, numbers: r.heardNumbers, numberFrom: r.numberFrom, blocked: r.blocked }
  } catch {
    return { sure: false, no: null, price: null, name: null, guess: null, numbers: [], numberFrom: null, blocked: null }
  }
}

// ── 같은 번호 열린 카드에 합치기 (AC-V3-06, D-V3-08) ─────────────────────

/** 손댄 카드에 합치지 않은 까닭 (화면 기록 문장과 같다) */
export const MERGE_TOUCHED_REASON = '고치는 중인 카드라 바꾸지 않았어요'

export interface MergeResult {
  /** 합친 카드 (바뀌지 않았으면 넘긴 카드 그대로) */
  readonly card: SuggestionCard
  readonly changed: boolean
  /** 합친 카드가 바로 등록 대상인가: 원 가격(priceSure)·막는 까닭 없음·번호가 음성 'N번'·번호와 가격이 있고 300만 원 이하 */
  readonly autoDue: boolean
  /** 바꾸지 않은 까닭 (손댄 카드·고칠 수 없는 값) — 없으면 null */
  readonly reason: string | null
}

/**
 * 같은 번호의 열린 카드에 새 덩어리를 합친다 (D-V3-08, 화면 apps/web/src/voice/controller.ts #mergeCard와 같은 판단).
 * - 손댄 카드는 바꾸지 않는다(까닭 MERGE_TOUCHED_REASON).
 * - 품종: 덩어리의 사전 이름(또는 칸 이름으로 말한 품종)이 카드 품종과 다르면 그것으로. 추측(R-17 7)은 쓰지 않는다(D-V3-37 — 카드 후보 단추로만).
 * - 가격: 덩어리 가격이 있고 다르면 그것으로.
 * `registration`은 같은 덩어리의 readRegistration 결과(없으면 추측·바로 등록 판단 없이).
 */
export function mergeIntoCard(card: SuggestionCard, reading: ChunkReading, registration: RegistrationReading | null = null, options: { readonly maxNumber?: number } = {}): MergeResult {
  try {
    if (card.touched) return { card, changed: false, autoDue: false, reason: MERGE_TOUCHED_REASON }
    const changes: { name?: string; price?: number } = {}
    // D-V3-37: 합칠 때 추측 품종(R-17 7)은 쓰지 않는다 — 사전 이름(또는 칸 이름으로 말한 품종)만
    if (reading.name !== null && reading.name !== card.name) changes.name = reading.name
    if (reading.price !== null && reading.price !== card.price) changes.price = reading.price
    let next = card
    if (Object.keys(changes).length > 0) {
      const edited = editCard(card, changes, options)
      if (!edited.ok) return { card, changed: false, autoDue: false, reason: edited.message }
      next = changes.name === undefined ? edited.card : { ...edited.card, nameNeedsCheck: reading.nameNeedsCheck }
    }
    const autoDue =
      registration !== null &&
      registration.priceSure &&
      registration.blocked === null &&
      registration.numberFrom === 'marker' &&
      next.no !== null &&
      next.price !== null &&
      next.price <= AUTO_REGISTER_PRICE_MAX
    return { card: next, changed: next !== card, autoDue, reason: null }
  } catch {
    return { card, changed: false, autoDue: false, reason: null }
  }
}

// ── 바로 등록한 덩어리의 끝 — 할 일 고르기 (AC-V3-08, D-V3-05·13·21) ────

export interface InstantContext {
  /** 이 덩어리에서 바로 등록한 번호 (등록한 차례) */
  readonly registered: readonly number[]
  /** 이 덩어리에서 이미 처리한 번호 전부 (바로 등록 + 이미 있던 번호로 처리한 것) — 생략하면 registered */
  readonly handled?: readonly number[]
  /** 같은 덩어리의 readRegistration 결과 (들린 번호) */
  readonly registration: RegistrationReading | null
  /** 바로 등록이 켜져 있는가 (D-V3-44). false면 늘 null(V2 할 일). 생략 = 켬 */
  readonly autoRegister?: boolean
}

export type InstantAction =
  /** 덩어리 안 취소 → 그 바로 등록들을 되돌린다 (D-V3-21) */
  | { readonly kind: 'undoRegistered'; readonly nos: readonly number[] }
  /** 등록한 번호와 다른 'N번'이 섞임 → 알림만 (D-V3-05) */
  | { readonly kind: 'otherNumber'; readonly no: number; readonly others: readonly number[]; readonly message: string }
  /** 등록한(또는 처리한) 번호를 덮은 결과로 다시 본다 → R-22 (D-V3-13) */
  | { readonly kind: 'sameNumber'; readonly no: number }

/** "189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요." (화면 otherNumberMessage와 같다) */
export const otherNumberMessage = (registered: number, others: readonly number[]): string =>
  `${String(registered)}번으로 등록했는데 ${others.map((no) => `${String(no)}번`).join('·')}도 들렸어요. 맞는지 확인해 주세요.`

/**
 * 바로 등록한 덩어리가 끝났을 때의 할 일. null = V2 chooseAction 그대로(번호 없는 정정 덩어리는 offer 등).
 * 차례: 취소 → undoRegistered, 처리 안 한 다른 번호가 들림 → otherNumber, 덩어리 번호가 처리한 번호 → sameNumber(R-22).
 */
export function chooseInstantAction(reading: ChunkReading, context: InstantContext): InstantAction | null {
  try {
    if (context.autoRegister === false) return null
    const registered = Array.isArray(context.registered) ? context.registered : []
    const handled = Array.isArray(context.handled) ? context.handled : registered
    if (registered.length > 0 && reading.cancel) return { kind: 'undoRegistered', nos: [...registered] }
    const first = registered[0]
    if (first !== undefined && context.registration !== null) {
      const others = context.registration.heardNumbers.filter((no) => !handled.includes(no))
      if (others.length > 0) return { kind: 'otherNumber', no: first, others, message: otherNumberMessage(first, others) }
    }
    if (reading.no !== null && handled.includes(reading.no)) return { kind: 'sameNumber', no: reading.no }
    return null
  } catch {
    return null
  }
}
