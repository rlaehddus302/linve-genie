// 덩어리 → 할 일 (VOC-04·PRD-06, D-V2-04·D-V2-06). 새 카드·앞 카드 채우기·카드 고침·카드 닫기·고칠까요 카드·버림(+까닭)을 고른다.
// 순수 함수: 카드 목록·최근 등록 목록·지금 시각을 입력으로 받고, 아무것도 바꾸지 않는다(부르는 쪽이 할 일을 실행한다).
import { formatWon } from '@livejjim/core'
import { createCard, isCardWorthy, type SuggestionCard } from './card.ts'
import type { VarietyCandidate } from './candidates.ts'
import type { ChunkField, ChunkReading } from './correction.ts'
import type { Confidence, VoiceExtraction } from './extract.ts'
import { resolveVoiceSettings, type VoiceSettings } from './settings.ts'
import { VOICE_LOG_REASONS } from './voice-log.ts'

/** 이어 채우기: 맨 앞 카드를 만든 때부터 덩어리 모으기 시작까지 (D-V2-04) */
export const FILL_WINDOW_MS = 10_000
/** 등록 뒤 정정을 받는 시간 (D-V2-06 3) */
export const RECENT_WINDOW_MS = 60_000
/** 고칠까요 카드로 고친 뒤 되돌리기 시간 (D-V2-06 3) */
export const OFFER_UNDO_MS = 10_000

export const ASK_NAME_PRICE = '품종·가격을 말해 주세요'
export const ASK_PRICE = '가격을 말해 주세요'
export const NUMBER_FIX_MESSAGE = '번호는 상품 목록에서 고쳐 주세요'
export const UNDO_LATE_MESSAGE = '되돌릴 시간이 지났어요. 상품 목록에서 고쳐 주세요.'

/** 이 콘솔에서 음성 카드로 등록한 상품 (부르는 쪽이 넘긴다 — 새것 먼저가 아니어도 된다) */
export interface RecentRegistration {
  /** 상품을 가리키는 ID (부르는 쪽이 정한다) */
  readonly id: string
  readonly no: number
  /** 품종 ("" = 품종 미입력) */
  readonly name: string
  readonly price: number
  /** 등록 시각 (UTC 밀리초) */
  readonly registeredAt: number
  /** 등록 5초 되돌리기가 되는 마지막 시각 (지났거나 없으면 null) */
  readonly undoUntil?: number | null
}

export interface TargetContext {
  /** 상품 카드 목록 (맨 앞 = 0번, addCard 순서) */
  readonly cards: readonly SuggestionCard[]
  readonly recent?: readonly RecentRegistration[]
  /** 지금 (덩어리를 읽는 시각) */
  readonly now: number
  /** 그 덩어리를 모으기 시작한 시각 (생략하면 now) */
  readonly chunkStartedAt?: number
  /** 덩어리 글이 300글자를 넘었는가 (R-17 1 — "문장이 너무 길어요") */
  readonly tooLong?: boolean
}

export interface ChunkFields {
  readonly no?: number | null
  readonly name?: string | null
  readonly price?: number | null
}

export type VoiceAction =
  | {
      readonly kind: 'create'
      readonly extraction: VoiceExtraction
      readonly nameExact: boolean
      readonly nameNeedsCheck: boolean
      readonly candidates: readonly VarietyCandidate[]
      /** 카드에 보일 안내 ("가격을 말해 주세요" 등) — 없으면 null */
      readonly ask: string | null
    }
  | {
      readonly kind: 'fill'
      readonly cardId: string
      /** 빈 칸에만 쓸 값 */
      readonly changes: { readonly name?: string; readonly price?: number }
      /** 이미 있는 값과 달라 쓰지 않은 칸 */
      readonly skipped: readonly ChunkField[]
      readonly nameExact: boolean
      readonly ask: string | null
    }
  | { readonly kind: 'edit'; readonly cardId: string; readonly changes: ChunkFields; readonly message: string; readonly nameNeedsCheck: boolean }
  /** 정정 표시 앞 값이 카드 값과 달라 바로 고치지 않고 묻는다 (D-V2-19) — 누르기 전엔 카드를 바꾸지 않는다 */
  | { readonly kind: 'confirmEdit'; readonly cardId: string; readonly changes: ChunkFields; readonly message: string; readonly editMessage: string; readonly nameNeedsCheck: boolean }
  | { readonly kind: 'close'; readonly cardId: string }
  | { readonly kind: 'offer'; readonly registrationId: string; readonly changes: { readonly name?: string; readonly price?: number }; readonly message: string }
  | { readonly kind: 'offerNumber'; readonly registrationId: string; readonly message: string }
  | { readonly kind: 'offerUndo'; readonly registrationId: string; readonly canUndo: boolean; readonly message: string }
  | { readonly kind: 'discard'; readonly reason: string | null; readonly cancelled: boolean }

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const discard = (reason: string | null, cancelled = false): VoiceAction => ({ kind: 'discard', reason, cancelled })

/** 카드 안내: 번호만 있으면 "품종·가격을 말해 주세요", 가격만 없으면 "가격을 말해 주세요" (D-V2-04) */
export function askFor(fields: { readonly name: string | null; readonly price: number | null }): string | null {
  if (fields.price !== null) return null
  return fields.name === null ? ASK_NAME_PRICE : ASK_PRICE
}

/** 받침이 있으면 "으로", 없거나 ㄹ 받침이면 "로" */
export function withRo(word: string): string {
  const last = word.codePointAt(word.length - 1) ?? 0
  if (last >= 0xac00 && last <= 0xd7a3) {
    const jong = (last - 0xac00) % 28
    return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`
  }
  return `${word}로`
}

const productLabel = (r: RecentRegistration): string => `${String(r.no)}번${r.name === '' ? '' : ` ${r.name}`}`

/** 로마자 글자 이름·숫자 읽기의 끝 받침 (L 엘·M 엠·N 엔·R 알, 0 영·1 일·3 삼·6 육·7 칠·8 팔) — `bts` → 에스(받침 없음) */
const LATIN_BATCHIM = new Set([...'lmnr'])
const DIGIT_BATCHIM = new Set([...'013678'])

/** 끝 글자에 받침이 있는가 (한글은 종성, 로마자·숫자는 읽는 소리로) */
function endsWithBatchim(word: string): boolean {
  const lastChar = [...word].pop() ?? ''
  const last = lastChar.codePointAt(0) ?? 0
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 !== 0
  if (/[0-9]/.test(lastChar)) return DIGIT_BATCHIM.has(lastChar)
  if (/[a-zA-Z]/.test(lastChar)) return LATIN_BATCHIM.has(lastChar.toLowerCase())
  return true
}

/** 목적격 조사: 받침 있으면 "을", 없으면 "를" (`bts` → "bts를", `핑크문` → "핑크문을") */
export const withObject = (word: string): string => `${word}${endsWithBatchim(word) ? '을' : '를'}`

/** "방금 등록한 15번 핑크문을 18,000원으로 고칠까요?" (품종·가격 둘 다면 "루비 · 18,000원으로") */
export function offerMessage(r: RecentRegistration, changes: { readonly name?: string; readonly price?: number }): string {
  const parts: string[] = []
  if (changes.name !== undefined) parts.push(changes.name)
  if (changes.price !== undefined) parts.push(formatWon(changes.price))
  return `방금 등록한 ${withObject(productLabel(r))} ${withRo(parts.join(' · '))} 고칠까요?`
}

/** "방금 등록한 15번 핑크문을 되돌릴까요?" */
export function undoMessage(r: RecentRegistration): string {
  return `방금 등록한 ${withObject(productLabel(r))} 되돌릴까요?`
}

const fieldValue = (field: ChunkField, value: number | string | null): string => {
  if (value === null || value === '') return '없음'
  if (field === 'price') return formatWon(value as number)
  if (field === 'no') return `${String(value)}번`
  return String(value)
}
const FIELD_LABELS: Readonly<Record<ChunkField, string>> = Object.freeze({ no: '번호', name: '품종', price: '가격' })

/** "고쳤어요: 가격 15,000원 → 18,000원" (칸이 여럿이면 쉼표로) */
export function editMessage(card: SuggestionCard, changes: ChunkFields): string {
  const parts: string[] = []
  for (const field of ['no', 'name', 'price'] as const) {
    if (!Object.hasOwn(changes, field)) continue
    parts.push(`${FIELD_LABELS[field]} ${fieldValue(field, card[field])} → ${fieldValue(field, changes[field] ?? null)}`)
  }
  return `고쳤어요: ${parts.join(', ')}`
}

/** "12,000원을 18,000원으로 고칠까요?" (칸이 여럿이면 " · "로) — D-V2-19 */
export function confirmEditMessage(card: SuggestionCard, changes: ChunkFields): string {
  const before: string[] = []
  const after: string[] = []
  for (const field of ['no', 'name', 'price'] as const) {
    if (!Object.hasOwn(changes, field)) continue
    before.push(fieldValue(field, card[field]))
    after.push(fieldValue(field, changes[field] ?? null))
  }
  return `${withObject(before.join(' · '))} ${withRo(after.join(' · '))} 고칠까요?`
}

/** 정정 표시 앞 조각이 읽은 칸 값이 카드의 그 칸 값과 다른 칸이 있나 (카드 칸이 비었으면 다름으로 보지 않는다 — 덮을 값이 없다) */
function leadDiffers(reading: ChunkReading, card: SuggestionCard): boolean {
  const lead = reading.lead
  if (lead === undefined || lead === null) return false
  return reading.fieldsSet.some((field) => {
    const said = lead[field]
    const now = card[field]
    return said !== null && now !== null && said !== now
  })
}

const frontOpenCard = (cards: readonly SuggestionCard[]): SuggestionCard | null => (Array.isArray(cards) ? cards.find((card) => card?.status === 'OPEN') ?? null : null)

function latestRecent(recent: readonly RecentRegistration[] | undefined, now: number): RecentRegistration | null {
  if (!Array.isArray(recent)) return null
  let best: RecentRegistration | null = null
  for (const r of recent) {
    if (!isTime(r?.registeredAt) || now - r.registeredAt > RECENT_WINDOW_MS || r.registeredAt > now) continue
    if (best === null || r.registeredAt > best.registeredAt) best = r
  }
  return best
}

const pick = (reading: ChunkReading, fields: readonly ChunkField[]): ChunkFields => {
  const out: { no?: number | null; name?: string | null; price?: number | null } = {}
  if (fields.includes('no')) out.no = reading.no
  if (fields.includes('name')) out.name = reading.name
  if (fields.includes('price')) out.price = reading.price
  return out
}

function createAction(reading: ChunkReading): VoiceAction {
  const extraction: VoiceExtraction = { no: reading.no, name: reading.name, price: reading.price, confidence: reading.confidence }
  return {
    kind: 'create',
    extraction,
    nameExact: reading.nameExact,
    nameNeedsCheck: reading.nameNeedsCheck,
    candidates: reading.candidates,
    ask: reading.no !== null ? askFor(reading) : null,
  }
}

/**
 * 이어 채우기 (D-V2-04): 맨 앞 열린 카드가 모으기 시작 10초 안에 만들어졌고 손대지 않았고 빈 칸(품종·가격)이 있으면 빈 칸만 채운다.
 * 결과: 채울 것이 있으면 fill, 다른 값만 있으면 discard("이미 있는 값과 달라 쓰지 않았어요"), 대상이 아니거나 채울 것도 다른 것도 없으면 null.
 */
function tryFill(reading: ChunkReading, context: TargetContext, startedAt: number): VoiceAction | null {
  const card = frontOpenCard(context.cards)
  if (card === null || card.touched || !isTime(card.createdAt) || startedAt - card.createdAt > FILL_WINDOW_MS || startedAt < card.createdAt) return null
  if (card.name !== null && card.price !== null) return null
  const changes: { name?: string; price?: number } = {}
  const skipped: ChunkField[] = []
  if (reading.name !== null) {
    if (card.name === null) changes.name = reading.name
    else if (card.name !== reading.name) skipped.push('name')
  }
  if (reading.price !== null) {
    if (card.price === null) changes.price = reading.price
    else if (card.price !== reading.price) skipped.push('price')
  }
  if (Object.keys(changes).length === 0) return skipped.length > 0 ? discard(VOICE_LOG_REASONS.conflict) : null
  const after = { name: changes.name ?? card.name, price: changes.price ?? card.price }
  return { kind: 'fill', cardId: card.id, changes, skipped, nameExact: changes.name !== undefined ? reading.nameExact : card.nameExact === true, ask: askFor(after) }
}

/**
 * 덩어리 하나를 읽은 결과(readChunk) → 할 일 하나 (D-V2-04·D-V2-06).
 * 정정 없는 덩어리: 번호가 있으면 새 카드, 없으면 앞 카드 이어 채우기 → 안 되면 카드 규칙(품종·가격 둘 다) → 안 되면 버림.
 * 정정 덩어리: (1) 첫 조각에 번호 → 새 카드(취소면 버림) (2) 맨 앞 열린 카드 고침·닫기 (3) 60초 안 등록 상품의 고칠까요·되돌릴까요 카드
 * (4) 대상이 없으면 "고칠 카드가 없어요", 대상은 있는데 칸이 없으면 "번호와 가격이 안 들렸어요".
 */
export function chooseAction(reading: ChunkReading, context: TargetContext): VoiceAction {
  try {
    if (context.tooLong === true) return discard(VOICE_LOG_REASONS.tooLong)
    const now = isTime(context.now) ? context.now : 0
    const startedAt = isTime(context.chunkStartedAt) ? context.chunkStartedAt : now
    if (!reading.correction) {
      if (reading.no !== null) return createAction(reading)
      const fill = tryFill(reading, context, startedAt)
      if (fill !== null) return fill
      if (isCardWorthy(reading)) return createAction(reading)
      return discard(VOICE_LOG_REASONS.noFields)
    }
    // (1) 덩어리 안 정정: 첫 조각(표시 앞)에 번호가 있으면 덮은 결과로 새 카드, 취소면 버림
    if (reading.leadNumber) return reading.cancel ? discard(null, true) : createAction(reading)
    const card = frontOpenCard(context.cards)
    // (2) 맨 앞 열린 카드
    if (card !== null) {
      if (reading.cancel) return { kind: 'close', cardId: card.id }
      if (reading.fieldsSet.length === 0) return discard(VOICE_LOG_REASONS.noFields)
      const changes = pick(reading, reading.fieldsSet)
      if (leadDiffers(reading, card)) {
        return { kind: 'confirmEdit', cardId: card.id, changes, message: confirmEditMessage(card, changes), editMessage: editMessage(card, changes), nameNeedsCheck: reading.nameNeedsCheck }
      }
      return { kind: 'edit', cardId: card.id, changes, message: editMessage(card, changes), nameNeedsCheck: reading.nameNeedsCheck }
    }
    // (3) 방금 음성으로 등록한 상품
    const recent = latestRecent(context.recent, now)
    if (recent !== null) {
      if (reading.cancel) {
        const canUndo = isTime(recent.undoUntil) && now <= recent.undoUntil
        return { kind: 'offerUndo', registrationId: recent.id, canUndo, message: canUndo ? undoMessage(recent) : UNDO_LATE_MESSAGE }
      }
      if (reading.fieldsSet.includes('no')) return { kind: 'offerNumber', registrationId: recent.id, message: NUMBER_FIX_MESSAGE }
      if (reading.fieldsSet.length === 0) return discard(VOICE_LOG_REASONS.noFields)
      const changes: { name?: string; price?: number } = {}
      if (reading.fieldsSet.includes('name') && reading.name !== null) changes.name = reading.name
      if (reading.fieldsSet.includes('price') && reading.price !== null) changes.price = reading.price
      return { kind: 'offer', registrationId: recent.id, changes, message: offerMessage(recent, changes) }
    }
    // 고칠 대상이 없는데 번호까지 들린 말(`아니 16번 핑크문 만원`)은 새 카드로 — 판매자가 한 말을 버리지 않는다
    if (reading.no !== null && !reading.cancel) return createAction(reading)
    return discard(VOICE_LOG_REASONS.noTarget)
  } catch {
    return discard(VOICE_LOG_REASONS.noFields)
  }
}

// ── 할 일 실행을 돕는 순수 함수 ─────────────────────────────────────────

export interface ChunkCardInput {
  readonly id: string
  readonly action: Extract<VoiceAction, { kind: 'create' }>
  /** 덩어리 글 */
  readonly text: string
  readonly createdAt: number
  readonly settings?: Partial<VoiceSettings>
  /** 끝에서 넘긴 결과가 들었거나 음성을 꺼서 끊은 덩어리 (PhraseChunk.noAutoConfirm) */
  readonly noAutoConfirm?: boolean
}

/** create 할 일 → 카드 (createCard 그대로 + 품종 정확도·확인 필요 표시). 카드 규칙에 맞지 않으면 null */
export function createChunkCard(input: ChunkCardInput): SuggestionCard | null {
  const card = createCard({ id: input.id, extraction: input.action.extraction, text: input.text, createdAt: input.createdAt, settings: input.settings, flushedAtEnd: input.noAutoConfirm === true })
  if (card === null) return null
  return { ...card, nameExact: input.action.nameExact, ...(input.action.nameNeedsCheck ? { nameNeedsCheck: true } : {}) }
}

/**
 * fill 할 일 → 채운 카드. 자동 확정 기다림은 채운 때부터 처음부터 센다(D-V2-04, 조건 D-204 그대로):
 * 설정 켬 ∧ 번호·품종·가격 모두 ∧ 품종 정확 ∧ 끝에서 넘긴 카드 아님 ∧ 손대지 않음이면 now + 기다림, 아니면 null.
 */
export function fillCard(card: SuggestionCard, action: Extract<VoiceAction, { kind: 'fill' }>, now: number, settings?: Partial<VoiceSettings>, options: { readonly noAutoConfirm?: boolean } = {}): SuggestionCard {
  const resolved = resolveVoiceSettings(settings)
  const name = action.changes.name ?? card.name
  const price = action.changes.price ?? card.price
  const nameExact = action.nameExact
  const flushed = card.flushedAtEnd === true || options.noAutoConfirm === true
  const confidence: Confidence = card.no !== null && name !== null && price !== null && nameExact ? 'HIGH' : 'LOW'
  const auto = resolved['voice.autoConfirm'] && confidence === 'HIGH' && !flushed && !card.touched && card.status === 'OPEN'
  return {
    ...card,
    name,
    price,
    confidence,
    nameExact,
    autoConfirmAt: auto && isTime(now) ? now + resolved['voice.autoConfirmSec'] * 1000 : null,
    ...(flushed ? { flushedAtEnd: true } : {}),
  }
}

/**
 * 말이 들리는 동안 자동 확정 기다림 멈추기·다시 세기 (D-V2-06): 멈춘 때 남은 ms를 기억하고, 다시 셀 때 now + 남은 ms.
 * pauseAutoConfirm은 카드와 남은 ms(자동 확정이 없으면 null)를 돌려준다.
 */
export function pauseAutoConfirm(card: SuggestionCard, now: number): { readonly card: SuggestionCard; readonly remainingMs: number | null } {
  if (card.autoConfirmAt === null || !isTime(now)) return { card, remainingMs: null }
  return { card: { ...card, autoConfirmAt: null }, remainingMs: Math.max(0, card.autoConfirmAt - now) }
}

export function resumeAutoConfirm(card: SuggestionCard, remainingMs: number | null, now: number): SuggestionCard {
  if (remainingMs === null || !isTime(now) || card.status !== 'OPEN' || card.touched || card.flushedAtEnd === true) return card
  return { ...card, autoConfirmAt: now + remainingMs }
}
