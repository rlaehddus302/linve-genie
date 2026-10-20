// 음성 등록 화면의 판단 (VOC-01~05, D-I4-03·05·06, AC-I4-13·21·31·40). 순수 함수다 — 시계·저장소·네트워크를 읽지 않는다(시각·조회 결과는 부르는 쪽이 넘긴다).
// 음성 패키지(@livejjim/voice)의 값은 여기서 부르지 않는다(타입만 — AC-I4-04, D-I4-09). 음성 함수(checkAutoConfirm·normalizeDictionary)가
// 필요한 판단은 그 함수를 인자로 받는다 — 콘솔은 "음성 켜기"로 불러온 모듈의 함수를 넘기고, 시험은 패키지의 함수를 넘긴다.
import { formatWon } from '@livejjim/core'
import type { AutoConfirmContext, SuggestionCard, VoiceSettings } from '@livejjim/voice'

/** 맨 앞 카드가 된 뒤 Enter로 등록할 수 있을 때까지 (D-I4-03) */
export const ENTER_READY_MS = 1000
/** 이 폭(px) 이상이면 PC: 카드가 빠른 입력칸과 함께 고정 영역에 있고 Enter로 등록한다. 미만(휴대폰)은 누르기만 (D-I4-03) */
export const WIDE_MIN_WIDTH = 768
/** "들린 말 기록"에 남기는 최종 문장 수 (D-I4-09) */
export const HEARD_LIMIT = 20
/** 판매 이력으로 받는 지난 실제 범위 수 (D-I4-06) */
export const HISTORY_DAYS = 10
/** 정리한 판매 이력 이름 최대 수 (D-I4-06) */
export const HISTORY_NAME_LIMIT = 2000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── 맨 앞 카드·Enter (D-I4-03, AC-I4-21) ──────────────────────────────

/** 맨 앞 열린 카드와 그 카드가 맨 앞이 된 시각 (UTC 밀리초) */
export interface FrontMark {
  readonly id: string
  readonly since: number
}

/** 맨 앞(새 것이 앞) 열린 카드. 없으면 null */
export function frontCard(cards: readonly SuggestionCard[]): SuggestionCard | null {
  return cards.find((card) => card.status === 'OPEN') ?? null
}

/**
 * 목록이 바뀐 뒤의 맨 앞 표시. 맨 앞 카드가 그대로면 앞 표시 그대로, 바뀌었으면(새 카드가 나왔거나 앞 카드가 확정·닫혀 올라옴) 그 시각부터 —
 * 나온 시각과 올라온 시각 중 늦은 것(D-I4-03). 시계가 거꾸로 가도 카드가 나온 시각보다 앞서지 않는다.
 */
export function nextFront(previous: FrontMark | null, cards: readonly SuggestionCard[], now: number): FrontMark | null {
  const front = frontCard(cards)
  if (front === null) return null
  if (previous !== null && previous.id === front.id) return previous
  const since = Number.isFinite(now) ? Math.max(now, front.createdAt) : front.createdAt
  return { id: front.id, since }
}

/** 맨 앞이 된 지 1초가 지났나 (시계가 거꾸로 갔거나 같은 밀리초면 아직) */
export function enterReady(front: FrontMark | null, now: number): boolean {
  return front !== null && Number.isFinite(now) && now - front.since >= ENTER_READY_MS
}

export interface VoiceEnterInput {
  /** 빠른 입력칸의 글자 */
  readonly line: string
  /** 카드 목록 (새 것이 앞) */
  readonly cards: readonly SuggestionCard[]
  readonly front: FrontMark | null
  readonly now: number
  /** 폭 768px 이상 (PC) */
  readonly wide: boolean
  /** 창이 열려 있다 */
  readonly dialogOpen: boolean
  /** 글자 조합 중 */
  readonly composing?: boolean
  /** 고치기 칸이 열린 카드 ID */
  readonly editing: ReadonlySet<string>
}

export type VoiceEnterDecision =
  /** 카드와 상관없다 — 빠른 입력 그대로 (빈 칸이면 아무 일도 없다) */
  | { readonly kind: 'quick' }
  /** 맨 앞 카드를 등록한다 */
  | { readonly kind: 'register'; readonly card: SuggestionCard }
  /** 맨 앞이 된 지 1초가 안 됐다 — 등록하지 않고 "새 카드가 방금 나왔어요…" */
  | { readonly kind: 'tooSoon'; readonly card: SuggestionCard }

/**
 * 빠른 입력칸의 Enter가 카드를 등록하는가 (D-I4-03): 칸이 비어 있고(공백만도 빔) 글자 조합 중이 아니고 창이 없고 PC 폭이고
 * 맨 앞 열린 카드가 있고 그 카드의 고치기 칸이 닫혀 있을 때만 카드 쪽이다. 그 카드가 맨 앞이 된 지 1초가 지났으면 등록, 아니면 tooSoon.
 */
export function decideVoiceEnter(input: VoiceEnterInput): VoiceEnterDecision {
  const quick = { kind: 'quick' } as const
  if (input.line.trim() !== '' || input.composing === true || input.dialogOpen || !input.wide) return quick
  const card = frontCard(input.cards)
  if (card === null || input.editing.has(card.id)) return quick
  if (input.front === null || input.front.id !== card.id || !enterReady(input.front, input.now)) return { kind: 'tooSoon', card }
  return { kind: 'register', card }
}

/** "Enter 등록" 표시를 붙일 카드: 지금 빠른 입력칸에서 Enter를 누르면 등록될 카드뿐 (없으면 null) */
export function enterBadgeCard(input: VoiceEnterInput): string | null {
  const decision = decideVoiceEnter(input)
  return decision.kind === 'register' ? decision.card.id : null
}

// ── 자동 확정 (D-204, D-I4-05, AC-I4-31) ─────────────────────────────

/** P2 checkAutoConfirm 모양 (음성 모듈에서 받아 넘긴다) */
export type CheckAutoConfirm = (card: SuggestionCard, context: AutoConfirmContext) => { readonly due: boolean; readonly card: SuggestionCard }

export interface AutoConfirmInput {
  readonly cards: readonly SuggestionCard[]
  /** 그 기기의 음성 설정 (지금 값) */
  readonly settings: VoiceSettings
  readonly now: number
  /** 그 순간 그 방송에 있는 상품 번호 (판매 종료 포함) */
  readonly existingNumbers: ReadonlySet<number>
  /** 음성이 켜져 있다 (끈 뒤에는 자동 확정하지 않는다) */
  readonly voiceOn: boolean
  /** 창이 열려 있다 (열린 동안 미룬다) */
  readonly dialogOpen: boolean
}

export interface AutoConfirmDecision {
  /** 지금 등록할 카드 (기다림이 가장 먼저 끝난 것 하나 — 나머지는 그 등록 뒤에 다시 본다), 없으면 null */
  readonly due: SuggestionCard | null
  /** 기다림이 끝난 순간 그 번호가 이미 있어 자동 확정을 끈 카드 (카드에 "고칠까요?"를 보이고 창은 띄우지 않는다) */
  readonly blocked: readonly SuggestionCard[]
  /** blocked 카드를 바꿔 넣은 목록 (바뀐 것이 없으면 넘긴 목록 그대로) */
  readonly cards: readonly SuggestionCard[]
  /** 창이 열려 있어 미룬 카드가 있다 (창이 닫히면 다시 본다) */
  readonly deferred: boolean
}

/**
 * 자동 확정할 카드를 고른다. 기다림이 끝난(지금 ≥ 자동 확정 시각) 열린 카드만 본다 — "그 순간 그 번호가 있으면"은 그때 판단한다.
 * 음성이 꺼졌으면 아무것도 하지 않고, 창이 열려 있으면 미룬다(deferred). 판단은 P2 checkAutoConfirm(설정 켬·HIGH·손대지 않음·번호 없음).
 */
export function decideAutoConfirm(input: AutoConfirmInput, check: CheckAutoConfirm): AutoConfirmDecision {
  const none: AutoConfirmDecision = { due: null, blocked: [], cards: input.cards, deferred: false }
  if (!input.voiceOn || !Number.isFinite(input.now)) return none
  const ripe = input.cards
    .filter((card) => card.status === 'OPEN' && card.autoConfirmAt !== null && input.now >= card.autoConfirmAt)
    .sort((a, b) => (a.autoConfirmAt as number) - (b.autoConfirmAt as number) || a.createdAt - b.createdAt)
  if (ripe.length === 0) return none
  if (input.dialogOpen) return { ...none, deferred: true }
  let due: SuggestionCard | null = null
  const blocked: SuggestionCard[] = []
  const changed = new Map<string, SuggestionCard>()
  for (const card of ripe) {
    const result = check(card, { settings: input.settings, now: input.now, existingNumbers: input.existingNumbers })
    if (result.card !== card && result.card.autoConfirmAt === null && result.card.no !== null && input.existingNumbers.has(result.card.no)) {
      blocked.push(result.card)
      changed.set(card.id, result.card)
      continue
    }
    if (result.due && due === null) due = card
  }
  const cards = changed.size === 0 ? input.cards : input.cards.map((card) => changed.get(card.id) ?? card)
  return { due, blocked, cards, deferred: false }
}

/** 카드에 남은 초를 보이는가: 열림 ∧ 손대지 않음 ∧ HIGH ∧ 자동 확정 시각 있음 ∧ 설정 켬 ∧ 음성 켬 */
export function showsAutoCountdown(card: SuggestionCard, settings: VoiceSettings | null, voiceOn: boolean): boolean {
  return (
    voiceOn &&
    settings !== null &&
    settings['voice.autoConfirm'] &&
    card.status === 'OPEN' &&
    !card.touched &&
    card.confidence === 'HIGH' &&
    card.autoConfirmAt !== null
  )
}

/** "N초 뒤 자동 등록"의 N (1초마다 줄어든다, 1 아래로 내려가지 않는다) */
export function autoSecondsLeft(autoConfirmAt: number, now: number): number {
  return Math.max(1, Math.ceil((autoConfirmAt - now) / 1000))
}

/**
 * 다음에 화면을 다시 볼 때까지(밀리초): 맨 앞 카드의 "Enter 등록"이 보일 때, 자동 확정 시각, 남은 초 글자가 바뀌는 때 중 가장 이른 것.
 * 볼 것이 없으면 null.
 */
export function nextWake(cards: readonly SuggestionCard[], front: FrontMark | null, now: number): number | null {
  if (!Number.isFinite(now)) return null
  let next = Number.POSITIVE_INFINITY
  if (front !== null && front.since + ENTER_READY_MS > now) next = front.since + ENTER_READY_MS
  for (const card of cards) {
    const at = card.autoConfirmAt
    if (card.status !== 'OPEN' || at === null || at <= now) continue
    // 남은 초 = ceil((at - now)/1000) — 그 값이 하나 줄어드는 때
    const left = Math.ceil((at - now) / 1000)
    next = Math.min(next, at - (left - 1) * 1000)
  }
  return Number.isFinite(next) ? Math.max(0, next - now) : null
}

// ── 판매 이력 사전 (VOC-03, R-17 5, D-203, D-I4-06, AC-I4-40) ─────────

export interface DayRef {
  readonly date: string
  readonly rehearsal?: boolean
}

/**
 * 받아 올 지난 범위 날짜: 지금 범위를 뺀 실제(리허설 아님) 범위 중 날짜가 가장 늦은 10개(늦은 날짜 먼저). 형식이 틀린 날짜·같은 날짜는 한 번만.
 * 지금 범위가 리허설이면 같은 날짜의 실제 범위는 다른 범위다(넣는다).
 */
export function pickHistoryDays(days: readonly DayRef[], current: { readonly date: string; readonly rehearsal: boolean }, limit: number = HISTORY_DAYS): string[] {
  const dates = new Set<string>()
  for (const day of Array.isArray(days) ? days : []) {
    if (typeof day !== 'object' || day === null || typeof day.date !== 'string' || !DATE_RE.test(day.date)) continue
    if (day.rehearsal === true) continue
    if (!current.rehearsal && day.date === current.date) continue
    dates.add(day.date)
  }
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, Math.max(0, Math.floor(limit)))
}

/** 이름 목록을 R-17 5 사전 규칙으로 정리하는 함수 (음성 모듈의 normalizeDictionary) */
export type NormalizeNames = (names: readonly unknown[]) => string[]

/**
 * 판매 이력 이름 (D-I4-06): 지금 범위의 상품 이름 → 지난 범위의 상품 이름(늦은 날짜 먼저) 순서로 이어 R-17 5대로 정리하고(공백만 다른 이름은 앞의 것,
 * 이름이 빈 상품은 빠진다) 앞에서 2,000개. 기본 사전은 부르는 쪽이 뒤에 붙인다(buildDictionary).
 */
export function historyNames(
  current: readonly string[],
  past: readonly { readonly date: string; readonly names: readonly string[] }[],
  normalize: NormalizeNames,
  limit: number = HISTORY_NAME_LIMIT,
): string[] {
  const ordered = [...past].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const names: string[] = [...current]
  for (const day of ordered) names.push(...day.names)
  return normalize(names).slice(0, Math.max(0, Math.floor(limit)))
}

// ── 들린 말·설정 글자 ────────────────────────────────────────────────

export interface HeardLine {
  readonly id: number
  readonly text: string
}

/** 최종 문장을 기록 맨 앞에 넣는다 (최근 20개) */
export function pushHeard(list: readonly HeardLine[], line: HeardLine, limit: number = HEARD_LIMIT): HeardLine[] {
  return [line, ...list].slice(0, Math.max(0, Math.floor(limit)))
}

/** "기다리는 시간(초)" 칸 글자 → 수 (정수·소수 글자만 수, 그 밖은 NaN — 검사는 checkVoiceSettings가 한다) */
export function parseSecondsText(text: string): number {
  const trimmed = text.trim()
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/** 카드 등록의 줄 (빠른 입력 한 줄과 같은 모양 — 저장 실패·"고칠까요?"에 보이고, 칸으로 옮겨도 같은 상품으로 읽힌다): "15 핑크프릴 15,000원" */
export function cardLine(no: number, name: string, price: number): string {
  return name === '' ? `${String(no)} ${formatWon(price)}` : `${String(no)} ${name} ${formatWon(price)}`
}
