// 문자찜 카드 (SPEC VOC-04 "문자찜 카드"·VOC-01 "문자찜도 듣기", ORD-08 AC9, V1 — D-V1-05·D-V1-06·D-V1-07·D-V1-09).
// R-21이 문자찜 문장이라고 읽은 결과를 상품 등록 카드와 다른 모양의 카드로 보인다. 손대지 않은 카드는 기다림(기본 3초) 뒤 저절로 넣는다.
// 모든 함수는 순수하다: 넘긴 카드·목록을 바꾸지 않고 새 값을 돌려주며, 시계를 읽지 않는다(만든 시각·지금은 부르는 쪽이 넘긴다).
// 쓰기(서버 `sms` 이벤트)·받은 시각 읽기(ORD-08 AC6 — 손 입력과 같은 함수)·화면은 apps/web이 한다.
import { closeCard, MAX_OPEN_CARDS, type SuggestionCard } from './card.ts'
import { extractVoice, type ExtractOptions, type VoiceExtraction } from './extract.ts'
import { readSmsSentence, type SmsOrder, type SmsProblem, type SmsReading, type SmsReadOptions } from './sms.ts'

// ── 설정 (그 기기에 저장 — 판매 규칙 설정표 밖) ─────────────────────────

export interface SmsVoiceSettings {
  /** "문자찜도 듣기" (기본 켬, D-V1-09). 끄면 문자찜 문장은 어떤 카드도 만들지 않는다 */
  readonly 'voice.smsListen': boolean
  /** "문자찜 자동으로 넣기까지(초)" (정수 0~10, 기본 3, 0이면 바로, D-V1-05) */
  readonly 'voice.smsAutoSec': number
}

export const DEFAULT_SMS_SETTINGS: Readonly<SmsVoiceSettings> = Object.freeze({ 'voice.smsListen': true, 'voice.smsAutoSec': 3 })
export const SMS_AUTO_SEC_MIN = 0
export const SMS_AUTO_SEC_MAX = 10
const SMS_KEYS: readonly string[] = Object.freeze(Object.keys(DEFAULT_SMS_SETTINGS))

const isAutoSec = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= SMS_AUTO_SEC_MIN && value <= SMS_AUTO_SEC_MAX

function readKey(record: unknown, key: string): unknown {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return undefined
  try {
    return Object.hasOwn(record, key) ? (record as Record<string, unknown>)[key] : undefined
  } catch {
    return undefined
  }
}

/** 문자찜 설정 검사 (문제가 없으면 빈 목록). 쉬운 한국어 이유 */
export function checkSmsSettings(value: unknown): { readonly key: string | null; readonly message: string }[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ key: null, message: '문자찜 설정은 키와 값을 짝지은 객체여야 해요' }]
  const problems: { key: string | null; message: string }[] = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !SMS_KEYS.includes(key)) {
      problems.push({ key: String(key), message: '모르는 문자찜 설정이에요' })
      continue
    }
    const setting = readKey(value, key)
    if (key === 'voice.smsListen' && typeof setting !== 'boolean') problems.push({ key, message: '문자찜도 듣기는 켬이나 끔으로만 정할 수 있어요' })
    if (key === 'voice.smsAutoSec' && !isAutoSec(setting)) {
      problems.push({ key, message: `문자찜 자동으로 넣기까지는 ${String(SMS_AUTO_SEC_MIN)}초부터 ${String(SMS_AUTO_SEC_MAX)}초까지의 정수로 적어 주세요` })
    }
  }
  return problems
}

/** 기본값 위에 덮어쓴 새 설정. 못 읽거나 범위 밖인 값은 기본값(듣기 켬·3초) — 넘긴 객체는 바꾸지 않는다 */
export function resolveSmsSettings(override?: unknown): SmsVoiceSettings {
  const listen = readKey(override, 'voice.smsListen')
  const sec = readKey(override, 'voice.smsAutoSec')
  return {
    'voice.smsListen': typeof listen === 'boolean' ? listen : DEFAULT_SMS_SETTINGS['voice.smsListen'],
    'voice.smsAutoSec': isAutoSec(sec) ? sec : DEFAULT_SMS_SETTINGS['voice.smsAutoSec'],
  }
}

// ── 문장 → 상품 카드 또는 문자찜 카드 (VOC-02, AC-V1-02) ─────────────────

export type VoiceSentence =
  | { readonly kind: 'sms'; readonly reading: SmsReading }
  | { readonly kind: 'product'; readonly extraction: VoiceExtraction }
  /** 문자찜 문장인데 "문자찜도 듣기"가 꺼져 있다 — 어떤 카드도 만들지 않는다 */
  | { readonly kind: 'none' }

export interface VoiceSentenceOptions {
  /** R-17 상품 등록 추출 설정 (번호 범위·품종 사전) */
  readonly extract?: ExtractOptions
  /** R-21 설정 (판매 방식·번호 범위·옵션 방식의 상품 목록·지금 상품) */
  readonly sms?: SmsReadOptions
  /** 문자찜 설정 (못 읽으면 기본 — 듣기 켬) */
  readonly smsSettings?: unknown
}

/**
 * 음성 카드 입구: 문장 하나 → 문자찜(R-21) 또는 상품 등록(R-17) 중 하나만 (같은 말이 두 카드를 만들지 않게, R-21 2).
 * 문자찜 표시가 있으면 R-17을 부르지 않는다. "문자찜도 듣기"가 꺼져 있으면 그런 문장은 none(상품 카드도 아님).
 */
export function readVoiceSentence(text: unknown, options: VoiceSentenceOptions = {}): VoiceSentence {
  const reading = readSmsSentence(text, options.sms ?? {})
  if (reading !== null) return resolveSmsSettings(options.smsSettings)['voice.smsListen'] ? { kind: 'sms', reading } : { kind: 'none' }
  return { kind: 'product', extraction: extractVoice(text, options.extract ?? {}) }
}

// ── 카드 ─────────────────────────────────────────────────────────────────

/** 409 BUYER_AMBIGUOUS의 후보 하나 (서버 응답 그대로) */
export interface SmsBuyerCandidate {
  readonly buyer: string
  readonly display: string
  readonly phoneLast4: string | null
}

/** OPEN = 화면에 열림(기다림·누르기·이유·고르기), SENT = 넣기를 넘겼다(결과 카드), CLOSED = 닫힘 */
export type SmsCardStatus = 'OPEN' | 'SENT' | 'CLOSED'

export interface SmsCard {
  readonly kind: 'sms'
  readonly id: string
  /** 원래 문장 (탭 메모리에만 — 서버로 보내지 않는다, D-V1-10) */
  readonly text: string
  readonly reading: SmsReading
  /** 만든 시각 (UTC 밀리초, 부르는 쪽이 넘긴다) */
  readonly createdAt: number
  readonly status: SmsCardStatus
  /** "넣지 않기"·"지금 넣기" 밖의 조작을 했다 — 저절로 넣지 않는다, 넘쳐도 닫지 않는다 */
  readonly touched: boolean
  /** 저절로 넣는 시각 (만든 시각 + 기다림). 주문 하나·문제 없음일 때만, 손대거나 시각 확인·고르기가 되면 null */
  readonly autoAt: number | null
  /** 구매자를 골라야 한다 (409 BUYER_AMBIGUOUS 후보, 처음 생긴 순서) — 고르기 전에는 넣지 않는다 */
  readonly candidates: readonly SmsBuyerCandidate[] | null
  /** 10초 안에 같은 말을 더 들은 횟수 (D-V1-06) */
  readonly repeats: number
}

/** 상품 카드 또는 문자찜 카드 — 열린 카드 수 규칙(D-204·D-I4-02)은 함께 센다 */
export type VoiceCard = SuggestionCard | SmsCard

export const isSmsCard = (card: VoiceCard): card is SmsCard => (card as { kind?: unknown }).kind === 'sms'

export interface CreateSmsCardInput {
  readonly id: string
  readonly reading: SmsReading
  readonly text: string
  /** 만든 시각 (UTC 밀리초) */
  readonly createdAt: number
  /** 문자찜 설정 (못 읽으면 기본 3초) */
  readonly settings?: unknown
}

const isSafeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

/** 저절로 넣을 수 있는 읽기인가 — 주문 하나·문제 없음 (상품·시각·창·음성은 넣기 직전에 checkSmsAuto가 본다) */
export const isAutoReading = (reading: SmsReading): boolean => reading.problem === null && reading.orders.length === 1

const copyOrder = (order: SmsOrder): SmsOrder => (order.options === undefined ? { no: order.no, qty: order.qty } : { no: order.no, options: { ...order.options }, qty: order.qty })

/** R-21 결과 → 문자찜 카드. 기다림 = 그때의 설정 (0이면 만든 시각 그대로 — 바로) */
export function createSmsCard(input: CreateSmsCardInput): SmsCard {
  if (typeof input.id !== 'string' || input.id === '') throw new TypeError('카드 ID는 빈 문자열이 아닌 문자열이어야 한다')
  if (!isSafeTime(input.createdAt)) throw new TypeError(`만든 시각은 UTC 밀리초 정수여야 한다 (값: ${String(input.createdAt)})`)
  const { reading } = input
  const sec = resolveSmsSettings(input.settings)['voice.smsAutoSec']
  return {
    kind: 'sms',
    id: input.id,
    text: typeof input.text === 'string' ? input.text : '',
    reading: { orders: reading.orders.map(copyOrder), last4: reading.last4, name: reading.name, time: reading.time, problem: reading.problem },
    createdAt: input.createdAt,
    status: 'OPEN',
    touched: false,
    autoAt: isAutoReading(reading) ? input.createdAt + sec * 1000 : null,
    candidates: null,
    repeats: 0,
  }
}

// ── 상품 상태 (D-V1-07) ──────────────────────────────────────────────────

/** 부르는 쪽이 넘기는 상품 모습 (엔진 스냅샷에서). 없는 번호는 null */
export interface SmsProductView {
  /** 상품 상태 (R-2) */
  readonly state: 'READY' | 'OPEN' | 'HOLD' | 'SOLD' | 'CLOSED'
  /** 대기가 꽉 찼다 (waitlist.max) — SOLD일 때만 본다 */
  readonly waitlistFull: boolean
}

export type SmsProductLookup = (no: number) => SmsProductView | null | undefined

/** 넣을 수 없는 상품의 이유 */
export type SmsProductBlock = 'NO_PRODUCT' | 'NOT_SELLING' | 'WAITLIST_FULL'

/** 받을 수 있는 상품 = OPEN, 또는 SOLD이고 대기 자리 있음 (1등이 찼으면 대기로 넣는다) */
export function smsProductBlock(view: SmsProductView | null | undefined): SmsProductBlock | null {
  if (view === null || view === undefined) return 'NO_PRODUCT'
  if (view.state === 'OPEN') return null
  if (view.state === 'SOLD') return view.waitlistFull ? 'WAITLIST_FULL' : null
  return 'NOT_SELLING'
}

/** 카드의 주문 가운데 처음으로 넣을 수 없는 상품 (없으면 null) */
export function findSmsBlock(card: SmsCard, lookup: SmsProductLookup): { readonly no: number; readonly block: SmsProductBlock } | null {
  for (const order of card.reading.orders) {
    let view: SmsProductView | null | undefined
    try {
      view = lookup(order.no)
    } catch {
      view = null
    }
    const block = smsProductBlock(view)
    if (block !== null) return { no: order.no, block }
  }
  return null
}

// ── 화면 문장 (UX-01 — 영어 상태값을 보이지 않는다. 따옴표 문장은 acceptance 그대로) ──

export const SMS_PROBLEM_MESSAGES: Readonly<Record<SmsProblem, string>> = Object.freeze({
  NUMBER_UNCLEAR: '번호를 못 알아들었어요. 다시 말하거나 문자찜 입력에 넣어 주세요.',
  LAST4_UNCLEAR: '끝자리를 못 알아들었어요. 숫자 네 개로 다시 말해 주세요.',
  NAME_UNCLEAR: '이름이 둘이에요. 한 분씩 말해 주세요.',
  TIME_UNCLEAR: '받은 시각을 못 알아들었어요. 시각 없이 다시 말해 주세요.',
  OPTION_UNCLEAR: "상품·옵션을 못 알아들었어요. '반바지 M 2개 문자찜'처럼 다시 말해 주세요.",
  CANCEL: '음성으로는 찜을 취소하지 않아요. 찜 취소는 화면에서 해 주세요.',
})

export function smsBlockMessage(no: number, block: SmsProductBlock): string {
  if (block === 'NO_PRODUCT') return `${String(no)}번 상품이 없어요.`
  if (block === 'NOT_SELLING') return `${String(no)}번은 지금 판매 중이 아니에요.`
  return `${String(no)}번은 대기까지 다 찼어요.`
}

export const SMS_REPEAT_NOTE = '같은 말을 한 번 더 들었어요'
export const SMS_TIME_CHECK = '받은 시각이 지금보다 늦어요. 그래도 넣을까요?'
export const SMS_LISTENING = '문자찜도 듣는 중'
export const SMS_LABELS = Object.freeze({
  listen: '문자찜도 듣기',
  autoSec: '문자찜 자동으로 넣기까지(초)',
  skip: '넣지 않기',
  sendNow: '지금 넣기',
  send: '넣기',
  close: '닫기',
  cancelClaim: '찜 취소하기',
})

export const smsChooseMessage = (last4: string | null): string =>
  last4 === null ? '같은 끝자리 손님이 여러 명이에요. 누구인지 골라 주세요.' : `끝자리 ${last4} 손님이 여러 명이에요. 누구인지 골라 주세요.`

/** "N초 뒤 넣어요" (남은 초를 올림 — 0초 남으면 "곧 넣어요") */
export function smsCountdownText(card: SmsCard, now: number): string | null {
  if (card.status !== 'OPEN' || card.autoAt === null || !isSafeTime(now)) return null
  const left = Math.ceil((card.autoAt - now) / 1000)
  return left <= 0 ? '곧 넣어요' : `${String(left)}초 뒤 넣어요`
}

export interface DescribeSmsOptions {
  /** 옵션 방식에서 상품 이름 (번호 → 이름). 번호 방식은 넘기지 않는다 — 카드에 품종을 보이지 않는다 */
  readonly productName?: (no: number) => string | null | undefined
}

function describeOrder(order: SmsOrder, options: DescribeSmsOptions): string {
  const parts = [`${String(order.no)}번`]
  let name: string | null | undefined
  try {
    name = options.productName?.(order.no)
  } catch {
    name = null
  }
  if (typeof name === 'string' && name !== '') parts.push(name)
  if (order.options !== undefined) parts.push(...Object.values(order.options))
  if (order.options !== undefined || order.qty !== 1) parts.push(`${String(order.qty)}개`)
  return parts.join(' ')
}

/**
 * 카드 문장 (VOC-04): "165번 · 끝자리 1234 · 문자찜", "165번 · 김민지님 · 문자찜", "165번 · 손님 확인 필요 · 문자찜",
 * "21번 반바지 M 2개 · 끝자리 1234 · 문자찜", "… · 문자찜 · 받은 시각 2:15", 번호가 둘 이상이면 끝에 " — 넣을까요?".
 * 문제 카드(problem)는 SMS_PROBLEM_MESSAGES를 쓴다(이 문장은 주문이 없어 "번호 없음").
 * 카드 글은 글자로만 그린다 — 이름은 말한 그대로라 화면이 이스케이프해야 한다.
 */
export function describeSmsCard(card: SmsCard, options: DescribeSmsOptions = {}): string {
  const { reading } = card
  const parts: string[] = reading.orders.length === 0 ? ['번호 없음'] : reading.orders.map((order) => describeOrder(order, options))
  if (reading.last4 !== null) parts.push(`끝자리 ${reading.last4}`)
  if (reading.name !== null) parts.push(`${reading.name}님`)
  if (reading.last4 === null && reading.name === null) parts.push('손님 확인 필요')
  parts.push('문자찜')
  if (reading.time !== null) parts.push(`받은 시각 ${reading.time}`)
  const text = parts.join(' · ')
  return reading.orders.length > 1 ? `${text} — 넣을까요?` : text
}

// ── 넣기 ─────────────────────────────────────────────────────────────────

/** `sms` 쓰기 하나의 칸 (주문마다 하나 — 요청 번호·방송·받은 시각 변환은 부르는 쪽) */
export interface SmsWrite {
  readonly no: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty: number
  /** 메모: 이름, 없으면 null(비움), 뒤 4자리도 이름도 없고 고른 구매자도 없으면 `확인 필요` */
  readonly memo: string | null
  /** 뒤 4자리 (고른 구매자가 있으면 보내지 않는다 — 서버는 last4·buyer 중 하나만 받는다) */
  readonly last4?: string
  /** 고른 구매자 (409 후보 중 하나) */
  readonly buyer?: string
  /** 말한 받은 시각 `H:MM[:SS]` (null = 비움 → 서버 도착 시각). 부르는 쪽이 ORD-08 AC6 읽기로 바꿔 보낸다 */
  readonly time: string | null
}

export type SmsSendProblem = 'NOT_OPEN' | 'PROBLEM' | 'PRODUCT' | 'CHOOSE_BUYER' | 'UNKNOWN_BUYER'

export type SmsSendResult =
  | { readonly ok: true; readonly card: SmsCard; readonly writes: readonly SmsWrite[] }
  | { readonly ok: false; readonly reason: SmsSendProblem; readonly message: string; readonly card: SmsCard }

export interface SmsSendContext {
  /** 지금 상품 모습 (넣기 직전에 한 번 더 본다, D-V1-07) */
  readonly product: SmsProductLookup
  /** 고르기 카드에서 누른 후보의 구매자 ID */
  readonly buyer?: string
}

/** 확인 필요 메모 (R-21 넣기) */
export const SMS_MEMO_UNKNOWN = '확인 필요'

/**
 * 넣기 ("지금 넣기"·"넣기"·후보 누르기·저절로). 문제 카드·넣을 수 없는 상품은 넣지 않는다(누르기로도).
 * 고르기 카드는 후보 중 하나를 골라야 한다. 성공하면 카드는 SENT — 같은 카드를 두 번 넘기지 않는다.
 */
export function sendSmsCard(card: SmsCard, context: SmsSendContext): SmsSendResult {
  const fail = (reason: SmsSendProblem, message: string): SmsSendResult => ({ ok: false, reason, message, card })
  if (card.status !== 'OPEN') return fail('NOT_OPEN', '이미 넣었거나 닫은 카드예요.')
  const { reading } = card
  if (reading.problem !== null) return fail('PROBLEM', SMS_PROBLEM_MESSAGES[reading.problem])
  if (reading.orders.length === 0) return fail('PROBLEM', SMS_PROBLEM_MESSAGES.NUMBER_UNCLEAR)
  const blocked = findSmsBlock(card, context.product)
  if (blocked !== null) return fail('PRODUCT', smsBlockMessage(blocked.no, blocked.block))
  let buyer: string | undefined
  if (card.candidates !== null) {
    if (context.buyer === undefined) return fail('CHOOSE_BUYER', smsChooseMessage(reading.last4))
    if (!card.candidates.some((candidate) => candidate.buyer === context.buyer)) return fail('UNKNOWN_BUYER', '고른 손님을 찾지 못했어요. 다시 골라 주세요.')
    buyer = context.buyer
  } else if (context.buyer !== undefined) return fail('UNKNOWN_BUYER', '고를 손님이 없는 카드예요.')
  const memo = reading.name ?? (reading.last4 === null && buyer === undefined ? SMS_MEMO_UNKNOWN : null)
  const writes = reading.orders.map((order): SmsWrite => {
    const base = { ...copyOrder(order), memo, time: reading.time }
    if (buyer !== undefined) return { ...base, buyer }
    return reading.last4 === null ? base : { ...base, last4: reading.last4 }
  })
  return { ok: true, card: { ...card, status: 'SENT', autoAt: null }, writes }
}

/** 서버가 409 BUYER_AMBIGUOUS로 답했다 — 고르기 카드로 (저절로 넣지 않는다). 후보가 없으면 카드 그대로 */
export function chooseSmsBuyer(card: SmsCard, candidates: readonly SmsBuyerCandidate[]): SmsCard {
  if (card.status === 'CLOSED' || !Array.isArray(candidates) || candidates.length === 0) return { ...card }
  return { ...card, status: 'OPEN', autoAt: null, candidates: candidates.map((candidate) => ({ ...candidate })) }
}

/** 보내기가 실패했다(연결 등) — 다시 열되 저절로 넣지 않는다(누르면 넣는다) */
export function reopenSmsCard(card: SmsCard): SmsCard {
  return card.status === 'CLOSED' ? { ...card } : { ...card, status: 'OPEN', touched: true, autoAt: null }
}

/** "넣지 않기"·"닫기": 아무것도 보내지 않고 닫는다 */
export function closeSmsCard(card: SmsCard): SmsCard {
  return card.status === 'OPEN' ? { ...card, status: 'CLOSED', autoAt: null } : { ...card }
}

/** 손대기 ("넣지 않기"·"지금 넣기" 밖의 조작) — 저절로 넣지 않는다(다시 켜지지 않는다) */
export function touchSmsCard(card: SmsCard): SmsCard {
  return { ...card, touched: true, autoAt: null }
}

/** 음성을 껐다 — 기다리던 카드는 남고 저절로 넣지 않는다(누르면 넣는다) */
export function stopSmsAuto(card: SmsCard): SmsCard {
  return card.autoAt === null ? card : { ...card, autoAt: null }
}

// ── 저절로 넣기 (D-V1-05) ────────────────────────────────────────────────

export interface SmsAutoContext {
  /** 지금 (UTC 밀리초) */
  readonly now: number
  /** 음성이 켜져 듣는 중이다 */
  readonly voiceOn: boolean
  /** 창(찜 취소 사유 등)이 열려 있다 — 닫힌 뒤 다시 본다 */
  readonly dialogOpen: boolean
  /** 지금 상품 모습 */
  readonly product: SmsProductLookup
  /** 말한 받은 시각을 ORD-08 AC6로 읽은 값이 지금보다 늦다 (시각을 말하지 않았으면 false) */
  readonly timeAfterNow: boolean
}

export type SmsAutoDecision =
  /** 지금 넣는다 (sendSmsCard로) */
  | { readonly due: true; readonly card: SmsCard }
  /** 아직 아님 — block이 있으면 넣을 수 없는 상품이라 이유 카드로 바꿔 보인다 */
  | { readonly due: false; readonly card: SmsCard; readonly block: { readonly no: number; readonly block: SmsProductBlock } | null }

/**
 * 저절로 넣을 때인가. due ⇔ 열린 카드 ∧ 주문 하나 ∧ 문제 없음 ∧ 손대지 않음 ∧ 고르기 아님 ∧ 받을 수 있는 상품 ∧ 말한 시각이 지금보다 늦지 않음
 *   ∧ 창 없음 ∧ 음성 켜짐 ∧ 지금 ≥ 만든 시각 + 기다림.
 * 말한 시각이 지금보다 늦으면 그 카드는 누르기 카드가 되고(autoAt null — "받은 시각이 지금보다 늦어요. 그래도 넣을까요?"),
 * 음성이 꺼져 있으면 기다림을 멈춘다(다시 켜지지 않는다). 창이 열려 있으면 기다림은 그대로 두고 닫힌 뒤 다시 본다.
 */
export function checkSmsAuto(card: SmsCard, context: SmsAutoContext): SmsAutoDecision {
  const wait = (next: SmsCard = card, block: { no: number; block: SmsProductBlock } | null = null): SmsAutoDecision => ({ due: false, card: next, block })
  if (card.status !== 'OPEN' || card.autoAt === null || card.touched || card.candidates !== null || !isAutoReading(card.reading)) return wait()
  if (!context.voiceOn) return wait(stopSmsAuto(card))
  if (context.timeAfterNow) return wait({ ...card, autoAt: null })
  const blocked = findSmsBlock(card, context.product)
  if (blocked !== null) return wait(card, blocked)
  if (context.dialogOpen || !isSafeTime(context.now) || context.now < card.autoAt) return wait()
  return { due: true, card }
}

// ── 같은 말 (D-V1-06) ────────────────────────────────────────────────────

/** "10초 안" = 차이 ≤ 10,000ms (경계 10초 정각은 같은 말 — 새 카드 아님) */
export const SMS_REPEAT_WINDOW_MS = 10_000

function orderKey(order: SmsOrder): string {
  const options = order.options === undefined ? [] : Object.keys(order.options).sort().map((key) => [key, (order.options as Record<string, string>)[key]])
  return JSON.stringify([order.no, options, order.qty])
}

/** 같은 주문(번호 목록·옵션·수량)·같은 구매자 말(뒤 4자리·이름·둘 다 없음)·같은 문제인가 */
export function sameSmsWords(a: SmsReading, b: SmsReading): boolean {
  return (
    a.last4 === b.last4 &&
    a.name === b.name &&
    a.problem === b.problem &&
    a.orders.length === b.orders.length &&
    a.orders.every((order, i) => orderKey(order) === orderKey(b.orders[i] as SmsOrder))
  )
}

/**
 * 10초 안에 같은 말로 만든 문자찜 카드 (넣었거나 닫은 카드도 — 부르는 쪽은 그동안 카드를 들고 있어야 한다). 없으면 null.
 * 있으면 새 카드를 만들지 않고 markSmsRepeat로 그 카드에 "같은 말을 한 번 더 들었어요"를 붙인다.
 */
export function findSmsRepeat(cards: readonly VoiceCard[], reading: SmsReading, now: number): SmsCard | null {
  if (!isSafeTime(now)) return null
  let best: SmsCard | null = null
  for (const card of cards) {
    if (!isSmsCard(card)) continue
    const gap = now - card.createdAt
    if (gap < 0 || gap > SMS_REPEAT_WINDOW_MS || !sameSmsWords(card.reading, reading)) continue
    if (best === null || card.createdAt > best.createdAt) best = card
  }
  return best
}

export function markSmsRepeat(card: SmsCard): SmsCard {
  return { ...card, repeats: card.repeats + 1 }
}

/** 같은 말 검사에 더는 필요 없는(만든 지 10초가 지난) 닫힌·넣은 문자찜 카드를 뺀 목록 — 열린 카드와 상품 카드는 그대로 */
export function pruneSmsCards<T extends VoiceCard>(cards: readonly T[], now: number): T[] {
  return cards.filter((card) => !isSmsCard(card) || card.status === 'OPEN' || !isSafeTime(now) || now - card.createdAt <= SMS_REPEAT_WINDOW_MS)
}

// ── 카드 목록 (D-204·D-I4-02 — 상품 카드와 함께 센다) ───────────────────

/** 열린 카드 수 (상품 카드·문자찜 카드 함께) */
export function openVoiceCardCount(cards: readonly VoiceCard[]): number {
  return cards.filter((card) => card.status === 'OPEN').length
}

/** 넘쳐도 닫지 않는 카드: 손댄 카드, 구매자를 골라야 하는 문자찜 카드(누르려던 찜을 잃지 않게) */
const isProtected = (card: VoiceCard): boolean => card.touched || (isSmsCard(card) && card.candidates !== null)

/**
 * 새 카드를 맨 앞에 넣는다. 열린 카드가 3장을 넘으면 지킬 카드가 아닌 가장 오래된 열린 카드부터 닫는다(addCard와 같은 규칙).
 * 기다리는 문자찜 카드도 손대지 않았으면 닫힐 수 있고, 닫힌 카드는 넣지 않는다.
 */
export function addVoiceCard(cards: readonly VoiceCard[], card: VoiceCard): VoiceCard[] {
  const next = [card, ...cards]
  let open = openVoiceCardCount(next)
  for (let i = next.length - 1; i >= 1 && open > MAX_OPEN_CARDS; i--) {
    const old = next[i] as VoiceCard
    if (old.status !== 'OPEN' || isProtected(old)) continue
    next[i] = isSmsCard(old) ? closeSmsCard(old) : closeCard(old)
    open--
  }
  return next
}
