// 제안 카드 데이터 모델 (VOC-04, D-204, PRD-01 AC3·AC4, UX-06).
// 인식 결과는 바로 등록하지 않고 카드로 확인받는다. 모든 함수는 순수하다: 넘긴 카드·목록을 바꾸지 않고 새 값을 돌려주며, 시계를 읽지 않는다(시각은 부르는 쪽이 넘긴다).
// 화면 배치·단축키·Enter와의 관계는 I4.
import { formatWon, normalizeText } from '@livejjim/core'
import type { Confidence, VoiceExtraction } from './extract.ts'
import { resolveVoiceSettings, type VoiceSettings } from './settings.ts'

export type CardStatus = 'OPEN' | 'CONFIRMED' | 'CLOSED'

/** 화면에 보일 말 (영어 상태값을 보이지 않는다, UX-01) */
export const CARD_STATUS_LABELS: Readonly<Record<CardStatus, string>> = Object.freeze({ OPEN: '열림', CONFIRMED: '확정', CLOSED: '닫힘' })

/** 열린 카드 최대 수 (D-204) */
export const MAX_OPEN_CARDS = 3
/** 가격 하한 (R-16·R-17과 같다) */
export const MIN_PRICE = 100
const DEFAULT_MAX_NUMBER = 999

export interface SuggestionCard {
  /** 부르는 쪽이 정한 카드 ID (목록 안에서 카드를 가리킨다) */
  readonly id: string
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly confidence: Confidence
  /** 원래 문장 (음성 인식 최종 결과) */
  readonly text: string
  /** 만든 시각 (UTC 밀리초, 부르는 쪽이 넘긴다) */
  readonly createdAt: number
  readonly status: CardStatus
  /** 방송자가 칸을 고쳤는지 — 고친 카드는 자동 확정하지 않고, 넘쳐도 닫지 않는다 */
  readonly touched: boolean
  /** 자동 확정 시각 (UTC 밀리초). 만들 때 설정이 꺼져 있었거나 HIGH가 아니거나 끝에서 넘긴 문장이면 null, 고치거나 번호가 이미 있으면 null이 된다 */
  readonly autoConfirmAt: number | null
  /** 끝에서 넘긴 문장(D-I5-02)으로 만든 카드면 true — 신뢰도와 상관없이 자동 확정하지 않는다. 보통 카드에는 없다(없음 = 거짓) */
  readonly flushedAtEnd?: boolean
  /** 품종이 사전 이름·별칭과 공백만 다른가 (V2 이어 채우기 뒤 신뢰도 다시 셈 — 없음 = 모름 → 거짓) */
  readonly nameExact?: boolean
  /** 칸 이름으로 말한 사전 밖 품종 — 카드에 "확인 필요" (V2, D-V2-05) */
  readonly nameNeedsCheck?: boolean
}

/** 등록할 상품 (빠른 입력 등록과 같은 모양 — 품종이 없으면 "" = 품종 미입력) */
export interface CardRegistration {
  readonly no: number
  readonly name: string
  readonly price: number
}

const isSafeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const isNumberIn = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max
const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= MIN_PRICE
const resolveMax = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_MAX_NUMBER)
const hasNumber = (numbers: readonly number[] | ReadonlySet<number>, no: number): boolean =>
  numbers instanceof Set ? numbers.has(no) : (numbers as readonly number[]).includes(no)

// ── 만들기 ───────────────────────────────────────────────────────────────

export interface CreateCardInput {
  readonly id: string
  readonly extraction: VoiceExtraction
  /** 원래 문장 */
  readonly text: string
  /** 만든 시각 (UTC 밀리초) */
  readonly createdAt: number
  /** 음성 설정 (생략하면 기본 — 자동 확정 꺼짐) */
  readonly settings?: Partial<VoiceSettings>
  /** 끝에서 넘긴 문장인가 (SpeechResult.flushedAtEnd, D-I5-02). true면 자동 확정하지 않는 카드가 된다 */
  readonly flushedAtEnd?: boolean
}

/**
 * 카드를 만들 만한 결과인가: 번호가 있을 때만 (V3 D-V3-41 사용자 요구 — "번호 없음 70,000원 등록할까요?" 카드는 만들지 않는다).
 * 품종·가격만 있는 결과, 번호가 둘 이상이라 비운 결과(no = null)는 카드 없음. 인사·잡담도 카드 없음(D-204).
 */
export function isCardWorthy(extraction: VoiceExtraction): boolean {
  return extraction.no !== null
}

/**
 * 추출 결과 → 카드 (카드를 만들 결과가 아니면 null).
 * 자동 확정 시각 = 설정이 켜져 있고 신뢰도 HIGH이고 끝에서 넘긴 문장이 아니면(D-I5-02) 만든 시각 + 기다림, 아니면 null(나중에 설정을 켜도 이 카드는 자동 확정하지 않는다).
 */
export function createCard(input: CreateCardInput): SuggestionCard | null {
  if (typeof input.id !== 'string' || input.id === '') throw new TypeError('카드 ID는 빈 문자열이 아닌 문자열이어야 한다')
  if (!isSafeTime(input.createdAt)) throw new TypeError(`만든 시각은 UTC 밀리초 정수여야 한다 (값: ${String(input.createdAt)})`)
  const { extraction } = input
  if (!isCardWorthy(extraction)) return null
  const settings = resolveVoiceSettings(input.settings)
  const flushed = input.flushedAtEnd === true
  const auto = settings['voice.autoConfirm'] && extraction.confidence === 'HIGH' && !flushed
  return {
    id: input.id,
    no: extraction.no,
    name: extraction.name,
    price: extraction.price,
    confidence: extraction.confidence,
    text: typeof input.text === 'string' ? input.text : '',
    createdAt: input.createdAt,
    status: 'OPEN',
    touched: false,
    autoConfirmAt: auto ? input.createdAt + settings['voice.autoConfirmSec'] * 1000 : null,
    ...(flushed ? { flushedAtEnd: true } : {}),
  }
}

// ── 확정 ─────────────────────────────────────────────────────────────────

export type ConfirmProblem = 'NOT_OPEN' | 'NUMBER_MISSING' | 'NUMBER_OUT_OF_RANGE' | 'PRICE_MISSING' | 'PRICE_TOO_LOW' | 'NUMBER_EXISTS'

export interface ConfirmContext {
  /** claim.maxNumber (생략하면 999) */
  readonly maxNumber?: number
  /** 그 방송에 이미 있는 상품 번호 (부르는 쪽이 넘긴다) */
  readonly existingNumbers: readonly number[] | ReadonlySet<number>
}

export type ConfirmResult =
  | { readonly ok: true; readonly card: SuggestionCard; readonly registration: CardRegistration }
  | { readonly ok: false; readonly reason: ConfirmProblem; readonly message: string; readonly card: SuggestionCard }

/**
 * 확정 (Enter/탭 한 번). 번호(1..maxNumber)와 가격(100원 이상 정수)이 있어야 하고, 품종이 없으면 ""(품종 미입력, PRD-01 AC3).
 * 그 방송에 이미 있는 번호면 등록하지 않고 NUMBER_EXISTS("15번이 이미 있어요. 고칠까요?", PRD-01 AC4) — 카드는 열린 채로 둔다.
 */
export function confirmCard(card: SuggestionCard, context: ConfirmContext): ConfirmResult {
  const fail = (reason: ConfirmProblem, message: string): ConfirmResult => ({ ok: false, reason, message, card })
  if (card.status !== 'OPEN') return fail('NOT_OPEN', '이미 확정했거나 닫은 카드예요.')
  const max = resolveMax(context.maxNumber)
  if (card.no === null) return fail('NUMBER_MISSING', '번호가 없어요. 번호를 넣어 주세요.')
  if (!isNumberIn(card.no, max)) return fail('NUMBER_OUT_OF_RANGE', `번호는 1번부터 ${String(max)}번까지예요.`)
  if (card.price === null) return fail('PRICE_MISSING', '가격이 없어요. 가격을 넣어 주세요.')
  if (!isPrice(card.price)) return fail('PRICE_TOO_LOW', `가격은 ${formatWon(MIN_PRICE)} 이상이어야 해요.`)
  if (hasNumber(context.existingNumbers, card.no)) return fail('NUMBER_EXISTS', `${String(card.no)}번이 이미 있어요. 고칠까요?`)
  return {
    ok: true,
    card: { ...card, status: 'CONFIRMED', autoConfirmAt: null },
    registration: { no: card.no, name: card.name ?? '', price: card.price },
  }
}

// ── 고치기·닫기 ──────────────────────────────────────────────────────────

export interface CardChanges {
  /** 번호 (null = 비우기) */
  readonly no?: number | null
  /** 품종 (null 또는 빈 글 = 품종 미입력) */
  readonly name?: string | null
  /** 가격, 정수 원 (null = 비우기) */
  readonly price?: number | null
}

export type EditProblem = 'NOT_OPEN' | 'NUMBER_INVALID' | 'PRICE_INVALID' | 'NAME_INVALID'

export type EditResult =
  | { readonly ok: true; readonly card: SuggestionCard }
  | { readonly ok: false; readonly reason: EditProblem; readonly message: string; readonly card: SuggestionCard }

/**
 * 고치기: 번호·품종·가격을 바꾼다. 고친 카드는 "손댐"이 되고 자동 확정이 꺼진다(다시 켜지지 않는다).
 * 형식이 틀린 번호(1..maxNumber 정수가 아님)·가격(100원 이상 정수가 아님)·품종(글이 아님)은 받지 않는다 — 카드는 그대로.
 */
export function editCard(card: SuggestionCard, changes: CardChanges, options: { readonly maxNumber?: number } = {}): EditResult {
  const fail = (reason: EditProblem, message: string): EditResult => ({ ok: false, reason, message, card })
  if (card.status !== 'OPEN') return fail('NOT_OPEN', '이미 확정했거나 닫은 카드예요.')
  const max = resolveMax(options.maxNumber)
  let { no, name, price } = card
  if (Object.hasOwn(changes, 'no')) {
    const value: unknown = changes.no
    if (value !== null && !isNumberIn(value, max)) return fail('NUMBER_INVALID', `번호는 1번부터 ${String(max)}번까지의 정수로 적어 주세요.`)
    no = value as number | null
  }
  if (Object.hasOwn(changes, 'price')) {
    const value: unknown = changes.price
    if (value !== null && !isPrice(value)) return fail('PRICE_INVALID', `가격은 ${formatWon(MIN_PRICE)} 이상의 정수(원)로 적어 주세요.`)
    price = value as number | null
  }
  if (Object.hasOwn(changes, 'name')) {
    const value: unknown = changes.name
    if (value !== null && typeof value !== 'string') return fail('NAME_INVALID', '품종은 글로 적어 주세요.')
    const normalized = value === null ? '' : normalizeText(value)
    name = normalized === '' ? null : normalized
  }
  return { ok: true, card: { ...card, no, name, price, touched: true, autoConfirmAt: null } }
}

/** 방송자가 카드를 건드렸다(고치기 칸을 열었다 등) — 값은 그대로, 자동 확정만 끈다 */
export function touchCard(card: SuggestionCard): SuggestionCard {
  return { ...card, touched: true, autoConfirmAt: null }
}

/** 닫기: 등록 없이 닫는다. 열린 카드가 아니면 그대로(새 객체) */
export function closeCard(card: SuggestionCard): SuggestionCard {
  return card.status === 'OPEN' ? { ...card, status: 'CLOSED', autoConfirmAt: null } : { ...card }
}

// ── 자동 확정 (D-204, UX-06) ─────────────────────────────────────────────

export interface AutoConfirmContext {
  readonly settings?: Partial<VoiceSettings>
  /** 지금 (UTC 밀리초) */
  readonly now: number
  /** 그 순간 그 방송에 있는 상품 번호 */
  readonly existingNumbers: readonly number[] | ReadonlySet<number>
}

/**
 * 자동 확정할 때인가. due ⇔ 설정 켬 ∧ 끝에서 넘긴 문장 카드 아님 ∧ 카드 신뢰도 HIGH ∧ 손대지 않음 ∧ 열린 카드 ∧ 지금 ≥ 자동 확정 시각(만든 시각 + 기다림) ∧ 그 번호가 그 방송에 아직 없음.
 * 번호가 이미 있으면 거짓이고 돌려주는 카드의 자동 확정이 꺼진다(그 뒤 번호가 사라져도 다시 켜지지 않는다).
 * due이면 부르는 쪽이 confirmCard로 등록한다(자동 확정한 등록도 보통 등록처럼 5초 되돌리기, UX-06).
 */
export function checkAutoConfirm(card: SuggestionCard, context: AutoConfirmContext): { readonly due: boolean; readonly card: SuggestionCard } {
  const settings = resolveVoiceSettings(context.settings)
  const no = { due: false, card }
  if (!settings['voice.autoConfirm']) return no
  if (card.flushedAtEnd === true) return no // 끝에서 넘긴 문장 카드는 자동 확정하지 않는다 (D-I5-02)
  if (card.status !== 'OPEN' || card.touched || card.confidence !== 'HIGH' || card.autoConfirmAt === null || card.no === null || card.price === null) return no
  if (hasNumber(context.existingNumbers, card.no)) return { due: false, card: { ...card, autoConfirmAt: null } }
  if (!isSafeTime(context.now) || context.now < card.autoConfirmAt) return no
  return { due: true, card }
}

// ── 카드 목록 ────────────────────────────────────────────────────────────

/** 열린 카드 수 (확정·닫힌 카드는 세지 않는다) */
export function openCardCount(cards: readonly SuggestionCard[]): number {
  return cards.filter((card) => card.status === 'OPEN').length
}

/**
 * 새 카드를 맨 앞에 넣는다. 열린 카드가 3장을 넘으면 손대지 않은 가장 오래된(목록에서 가장 뒤) 열린 카드부터 닫는다(D-204).
 * 3장 규칙의 예외(D-I4-02, SPEC VOC-04): 새 카드는 언제나 열린 채로 들어가고(방송자가 막 한 말이 보이지도 않고 사라지지 않게),
 * 손댄 열린 카드는 닫지 않는다(방송자가 고치던 값을 잃지 않게). 그래서 결과의 열린 카드 수 ≤ max(3, 손댄 열린 카드 수 + 1) —
 * 말만으로는 늘지 않고 방송자가 손댄 만큼만 늘어난다.
 */
export function addCard(cards: readonly SuggestionCard[], card: SuggestionCard): SuggestionCard[] {
  const next = [card, ...cards]
  let open = openCardCount(next)
  for (let i = next.length - 1; i >= 1 && open > MAX_OPEN_CARDS; i--) {
    const old = next[i] as SuggestionCard
    if (old.status !== 'OPEN' || old.touched) continue
    next[i] = closeCard(old)
    open--
  }
  return next
}

/** 목록의 카드 하나를 바꾼 새 목록 (같은 ID의 카드를 바꾼다) */
export function replaceCard(cards: readonly SuggestionCard[], card: SuggestionCard): SuggestionCard[] {
  return cards.map((item) => (item.id === card.id ? card : item))
}

/** 카드 문장: "15번 핑크프릴 10,000원 — 등록할까요?" (VOC-04). 빈 칸은 쉬운 말로 */
export function describeCard(card: SuggestionCard): string {
  const no = card.no === null ? '번호 없음' : `${String(card.no)}번`
  const name = card.name ?? '품종 미입력'
  const price = card.price === null ? '가격 없음' : formatWon(card.price)
  return `${no} ${name} ${price} — 등록할까요?`
}
