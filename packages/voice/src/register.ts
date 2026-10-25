// V3 음성 바로 등록 (VOC-03·VOC-04·PRD-06, DOMAIN_RULES R-17 7·8, R-22, D-V3-01~D-V3-12). 골든: tests/golden/voice-register/*.json.
// - 품종 추측(R-17 7): 사전 밖 품종을 말해도 품종 칸이 비지 않게 들은 낱말 하나를 고른다(사전을 쓰지 않는다).
// - 확정 읽기(R-17 8): 'N번'(또는 자리 읽기 번호)과 '…원' 가격이 둘 다 들린 순간 바로 등록할 값.
// - 음성 같은 번호(R-22): 이미 있는 번호를 들었을 때 무시·바로 고침·묻기.
// - 열린 카드 합치기: 같은 번호의 열린 카드를 하나로.
// 모두 순수 함수: 넘긴 값을 바꾸지 않고, 시계·난수·네트워크를 쓰지 않으며, 어떤 입력에도 예외를 던지지 않는다(카드 합치기는 카드 모양만 믿는다).
import { normalizeText } from '@livejjim/core'
import { closeCard, type SuggestionCard } from './card.ts'
import { CANCEL_WORDS, CORRECTION_MARKERS, FIELD_NAMES } from './correction.ts'
import { STOP_WORDS } from './default-dictionary.ts'
import { ENDINGS, analyzeSentence, readingForms, type ExtractOptions, type SentenceAnalysis, type VoiceExtraction } from './extract.ts'

// ── 품종 추측 (R-17 7, D-V3-09) ──────────────────────────────────────────

/** 군말 목록 (R-17 7). 실제 군말 = 이 목록 ∪ 기본 사전 stopWords ∪ 정정 표시·취소 낱말·칸 이름 */
export const GUESS_FILLERS: readonly string[] = Object.freeze([
  ...'요거 이거 그거 저거 요것 이것 그것 저것 요건 이건 그건 저건 요게 이게 그게 저게 요놈 이놈 얘 쟤 걔 아이 요아이 유아이'.split(' '),
  ...'그대로 보냅니다 보내요 보내드려요 보내드릴게요 봅니다 봐요 보여요 드려요 드립니다 드릴게요 갑니다 가요 나갑니다 나가요'.split(' '),
  ...'할게요 해요 합니다 있어요 있습니다 있고요 없어요 들었어요 나왔습니다 남았고요 예쁘게 진짜 정말 완전 너무 엄청 아주 되게 많이'.split(' '),
  ...'일단 이제 지금 오늘 여기 거기 저기 이렇게 요렇게 그렇게 그러면 그럼 그리고 그래서 네네 예예 자자 여러분 사장님 언니 고객님'.split(' '),
  ...'다음 다음은 이번 분양 분양합니다'.split(' '),
])
/** 낱말 최대 길이(코드 포인트) */
export const GUESS_WORD_MAX = 20

const lowerAscii = (text: string): string => text.replace(/[A-Z]/g, (char) => char.toLowerCase())
const FILLER_KEYS: ReadonlySet<string> = new Set(
  [...GUESS_FILLERS, ...STOP_WORDS, ...CORRECTION_MARKERS, ...CANCEL_WORDS, ...Object.keys(FIELD_NAMES)].map((word) => lowerAscii(normalizeText(word).split(' ').join(''))),
)
const ENDINGS_LONG_FIRST: readonly string[] = [...ENDINGS].sort((a, b) => b.length - a.length)
const codePoints = (text: string): number => [...text].length

/** 낱말: 끝말을 긴 것부터 하나 뗀 모양(남는 글자가 2글자 이상일 때만, 아니면 토큰 그대로) */
export function guessWord(token: string): string {
  for (const ending of ENDINGS_LONG_FIRST) {
    if (token.endsWith(ending) && codePoints(token.slice(0, -ending.length)) >= 2) return token.slice(0, -ending.length)
  }
  return token
}

/** 군말인가 — 영어 대문자는 소문자로 보고 맞춘다(`UI` = `ui`, 크롬이 "요 아이"를 적은 꼴) */
const isFiller = (text: string): boolean => FILLER_KEYS.has(lowerAscii(text))

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

/** 풀이말 끝 모양 (R-17 7, D-V3-30): 낱말이 이 글자로 끝나면 후보 낱말이 아니다 (`나왔네`·`좋다`·`예쁘고`) */
export const PREDICATE_END_CHARS: readonly string[] = Object.freeze(['다', '요', '죠', '네', '까', '고', '게', '서', '면', '데'])
export const looksLikePredicate = (word: string): boolean => PREDICATE_END_CHARS.some((char) => word.endsWith(char))

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
  /** 사전 이름, 없으면 추측(R-17 7), 없으면 null(품종 미입력) */
  readonly name: string | null
  /** 품종이 추측이다 — 카드·목록에 "품종 확인 필요" */
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
      ? { no: extraction.no as number, price: extraction.price as number, name: extraction.name ?? safeGuess, nameNeedsCheck: extraction.name === null && safeGuess !== null, numberFrom }
      : null
  return { extraction, guess, safeGuess, numberFrom, blocked, priceSure, correction, heardNumbers: analysis.heardNumbers, heardPrices: analysis.heardPrices, ready }
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
      if (merged.name === null && other.name !== null) {
        merged = { ...merged, name: other.name, ...(other.nameNeedsCheck === undefined ? {} : { nameNeedsCheck: other.nameNeedsCheck }), ...(other.nameExact === undefined ? {} : { nameExact: other.nameExact }) }
      }
      if (merged.price === null && other.price !== null) merged = { ...merged, price: other.price }
      next[i] = closeCard(other)
    }
    next[keep] = merged
  }
  return next
}
