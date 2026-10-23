// 콘솔의 음성 등록 (VOC-01·04·05, D-I4-03~06·09, AC-I4-10~40).
// - "음성 켜기"를 누를 때 음성 모듈을 불러오고(그 전엔 음성 코드·인식 객체·마이크·이력 조회 없음), 그 기기에서 처음이면 안내 창을 거쳐 Web Speech를 시작한다.
// - 중간 결과는 자막 한 줄, 최종 결과는 "들린 말 기록"(최근 20개)과 카드. 인식 문장은 이 객체(탭 메모리)에만 있다 — 서버·저장소·콘솔 로그로 보내지 않는다.
// - 카드 등록은 콘솔이 넘긴 등록 경로(빠른 입력과 같은 product.register)로만 한다. 한 카드는 등록 경로에 한 번만 넘긴다(목록에서 먼저 뺀다).
// - 자동 확정은 켜진 동안·창이 닫힌 동안만, 기다림이 지난 카드를 모두(하나씩 차례로) 등록한다. 끄면 모든 카드의 자동 확정이 멈춘다.
// 시각은 host.now()(콘솔은 Date.now), 기다림은 브라우저 타이머 — 시험이 시계를 당길 수 있다.
// V1 음성 문자찜 (ORD-08 AC9, VOC-01·04, D-V1-03~09, AC-V1-20~28): 문자찜 문장(R-21)은 상품 카드 대신 문자찜 카드가 된다. 손대지 않은 카드는
// 기다림(그 기기 설정, 기본 3초) 뒤 콘솔이 넘긴 쓰기(host.writeSms — 손 입력과 같은 `sms` 이벤트)로 넣는다. 넣은·닫은 카드도 10초 동안은
// 같은 말 막기(D-V1-06)를 위해 들고 있다. 열린 카드 수 규칙은 상품 카드와 함께 센다(addVoiceCard).
import { formatWon } from '@livejjim/core'
import type {
  CardRegistration,
  SmsBuyerCandidate,
  SmsCard,
  SmsProductView,
  SmsReadOptions,
  SmsReading,
  SmsVoiceSettings,
  SmsWrite,
  SpeechEngine,
  SpeechError,
  SpeechResult,
  SpeechState,
  SuggestionCard,
  VarietyDictionary,
  VoiceCard,
  VoiceSettings,
} from '@livejjim/voice'
import { editQuestion } from '../lib/quick.ts'
import {
  decideAutoConfirm,
  decideVoiceEnter,
  enterReady,
  historyNames,
  nextFront,
  nextWake,
  parseSecondsText,
  pushHeard,
  type AutoConfirmDecision,
  type FrontMark,
  type HeardLine,
} from '../lib/voice.ts'
import type { VoiceModule } from './load.ts'

export type VoicePhase = 'off' | 'loading' | 'consent' | 'on'
export type FormField = 'no' | 'name' | 'price'
export type RegisterSource = 'enter' | 'click' | 'auto'

/** 음성 코드를 받지 못했을 때 */
export const VOICE_LOAD_FAILED = '음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.'
/** 판매 이력을 받지 못했을 때 (D-I4-06) */
export const HISTORY_FAILED = '지난 판매 품종을 불러오지 못했어요. 기본 품종 사전으로 알아들어요.'
/** 맨 앞이 된 지 1초 안의 Enter (D-I4-03) */
export const TOO_SOON = '새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.'
/** 켜진 동안 늘 보이는 안내 (D-I4-04) */
export const SENT_NOTICE = '음성은 인식을 위해 구글로 보내져요.'

/** 문자찜 쓰기 하나의 결과 (콘솔이 서버 응답을 바꿔 준다) */
export type SmsWriteOutcome =
  /** 기록됨 — 응답 seq와 그 문자찜이 정한 구매자 자신 (D-099, 정하지 못했으면 null) */
  | { readonly kind: 'ok'; readonly seq: number; readonly buyer: string | null }
  /** 409 BUYER_AMBIGUOUS — 기록되지 않았다, 후보 중에서 고른다 (message = 서버 문장: 여러 명·이름이 달라요, D-V1-14) */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly SmsBuyerChoice[]; readonly message?: string }
  /** 기록되지 않았다 (연결·거절 등) — 쉬운 한국어 문장 */
  | { readonly kind: 'failed'; readonly message: string }

/** 409 후보 하나 + 그 손님의 활성 찜 번호 (D-V1-14 — 서버 `claims`, 처음 찜한 순서) */
export interface SmsBuyerChoice extends SmsBuyerCandidate {
  readonly claims: readonly number[]
}

/** 고르기 카드 후보의 찜 번호 (카드에는 SmsBuyerCandidate로 들어가 펼쳐 복사된다 — 칸이 없거나 깨졌으면 빈 목록) */
export function candidateClaims(candidate: SmsBuyerCandidate): readonly number[] {
  const claims = (candidate as Partial<SmsBuyerChoice>).claims
  return Array.isArray(claims) ? claims.filter((no): no is number => Number.isSafeInteger(no)) : []
}

/**
 * 후보 버튼 글 (AC-V1-25·D-V1-14): "문자찜(김씨) · 끝자리 1234 · 15번·22번" — 3개 넘으면 앞 3개 + " 외 N개", 없으면 "찜 없음".
 * 이름에 끝자리가 이미 있으면 끝자리를 다시 쓰지 않는다
 */
export function smsCandidateLabel(name: string, phoneLast4: string | null, claims: readonly number[]): string {
  const base = phoneLast4 === null || name.includes(phoneLast4) ? name : `${name} · 끝자리 ${phoneLast4}`
  const shown = claims.slice(0, 3).map((no) => `${String(no)}번`).join('·')
  const more = claims.length > 3 ? ` 외 ${String(claims.length - 3)}개` : ''
  return `${base} · ${claims.length === 0 ? '찜 없음' : shown + more}`
}

/** "새 손님으로 넣기" 버튼 (D-V1-14) */
export const SMS_NEW_BUYER = '새 손님으로 넣기'

/** 음성 문자찜 쓰기 하나 — 카드의 쓰기 + "새 손님으로 넣기"면 newBuyer (last4와 함께만, D-V1-14) */
export type VoiceSmsWrite = SmsWrite & { readonly newBuyer?: true }

/** 넣기를 누른 방법: 그대로 · 고른 후보 · 새 손님 */
type SmsChoice = { readonly kind: 'auto' } | { readonly kind: 'buyer'; readonly buyer: string } | { readonly kind: 'new' }

const choiceKey = (choice: SmsChoice): string => (choice.kind === 'buyer' ? `buyer:${choice.buyer}` : choice.kind)

/** 넣은 주문 하나의 결과 줄 */
export interface SmsResultLine {
  readonly no: number
  readonly seq: number
  readonly buyer: string | null
}

/** 문자찜 카드와 화면 상태 */
export interface SmsEntry {
  readonly card: SmsCard
  /** 넣을 수 없는 이유 (R-21 문제·상품 상태·시각) — "닫기"만 */
  readonly reason: string | null
  /** 말한 받은 시각이 지금보다 늦어 묻는다 ("받은 시각이 지금보다 늦어요. 그래도 넣을까요?") */
  readonly timeCheck: boolean
  /** 보내는 중 */
  readonly sending: boolean
  /** 보내지 못한 이유 (다시 "넣기"를 누를 수 있다) */
  readonly error: string | null
  /** 넣은 주문마다의 결과 (주문 차례) */
  readonly results: readonly SmsResultLine[]
  /** 고르기 카드의 문장 (409 서버 문장 — "여러 명이에요"·"이름이 달라요"). 없으면 화면이 기본 문장 */
  readonly choose?: string | null
  /** 결과 카드를 닫았다 (같은 말 검사에는 10초 동안 남는다) */
  readonly hidden: boolean
}

/**
 * 넣지 않은 채 저절로 닫힌 문자찜 카드의 안내 (U-V1-01): 열린 카드 수 규칙(D-204·D-I4-02)이 손대지 않은 문자찜 카드를 닫으면
 * 넣지 않은 주문이 말없이 사라지지 않게 판매자가 "확인"을 누를 때까지 남긴다. 이유 카드("닫기"만)가 닫힐 때는 남기지 않는다.
 */
export interface SmsDropped {
  /** 닫힌 카드 ID */
  readonly id: string
  /** 카드를 가리키는 짧은 글 ("15번 · 28번 · 끝자리 1234 · 문자찜") */
  readonly short: string
  readonly text: string
}

/** 카드를 가리키는 짧은 글: "15번 · 28번 · 끝자리 1234 · 문자찜" (describeSmsCard에서 물음을 뗀 것) */
export function smsShortText(described: string): string {
  return described.replace(/\s*—\s*넣을까요\?$/, '')
}

/** "넣지 않은 문자찜 카드를 닫았어요: 15번 · 28번 · 끝자리 1234 · 문자찜. 넣으려면 …" */
export function smsDroppedText(short: string): string {
  return `넣지 않은 문자찜 카드를 닫았어요: ${short}. 넣으려면 다시 말하거나 문자찜 입력에 넣어 주세요.`
}

/** 문자찜 화면 문장 */
export interface SmsWords {
  readonly labels: VoiceModule['SMS_LABELS']
  readonly listening: string
  readonly repeat: string
  readonly timeCheck: string
  readonly choose: (last4: string | null) => string
}

/** 카드의 고치기 칸 */
export interface CardForm {
  readonly no: string
  readonly name: string
  readonly price: string
  readonly focus: FormField
  readonly message: string | null
  /** 칸을 열거나 다시 오류가 날 때마다 바뀐다 (커서를 다시 보낸다) */
  readonly version: number
}

export interface VoiceSnapshot {
  readonly phase: VoicePhase
  /** 켜진 동안의 상태 글자 ("음성: 듣는 중"·"음성: 다시 시작 중"), 꺼져 있으면 null */
  readonly stateLabel: string | null
  /** 음성 칸의 오류 문장 (D-205), 없으면 null */
  readonly error: string | null
  /** 중간 결과 (자막 한 줄), 없으면 null */
  readonly interim: string | null
  /** 최근 최종 문장 (새 것이 앞, 20개) */
  readonly heard: readonly HeardLine[]
  /** 열린 카드 (새 것이 앞) */
  readonly cards: readonly SuggestionCard[]
  readonly front: FrontMark | null
  /** 고치기 칸이 열린 카드 */
  readonly forms: ReadonlyMap<string, CardForm>
  /** 카드에 붙인 문장 (자동 확정 때 번호가 이미 있음) */
  readonly notes: ReadonlyMap<string, string>
  /** 그 기기의 음성 설정 (음성 모듈을 받기 전엔 null) */
  readonly settings: VoiceSettings | null
  /** "기다리는 시간(초)" 칸 글자 */
  readonly secondsText: string
  /** 기다리는 시간 칸의 문제 (checkVoiceSettings 문장), 없으면 null */
  readonly settingsProblem: string | null
  /** 판매 이력을 받지 못했다 */
  readonly historyFailed: boolean
  /** 1초 안의 Enter를 막았다 ("새 카드가 방금 나왔어요…") */
  readonly tooSoon: boolean
  /** 화면 시각 (남은 초·"Enter 등록" 표시) */
  readonly now: number
  /** 문자찜 카드 (새 것이 앞) — 닫은 카드·닫은 결과 카드는 같은 말 검사를 위해 10초 동안 남고(hidden·CLOSED) 화면엔 보이지 않는다 */
  readonly sms: readonly SmsEntry[]
  /** 그 기기의 문자찜 설정 (음성 모듈을 받기 전엔 null) */
  readonly smsSettings: SmsVoiceSettings | null
  /** "문자찜 자동으로 넣기까지(초)" 칸 글자 */
  readonly smsSecondsText: string
  /** 그 칸의 문제 (checkSmsSettings 문장), 없으면 null */
  readonly smsSettingsProblem: string | null
  /** 넣지 않은 채 저절로 닫힌 문자찜 카드 안내 (새 것이 앞, "확인"을 누를 때까지 남는다 — U-V1-01) */
  readonly smsDropped: readonly SmsDropped[]
}

/** 지난 실제 범위 하나의 상품 이름 */
export interface PastDay {
  readonly date: string
  readonly names: readonly string[]
}

/** 콘솔이 넘기는 것 */
export interface VoiceHost {
  /** 음성 모듈 (동적 import 한 곳) */
  load(): Promise<VoiceModule>
  now(): number
  /** 그 방송 스냅샷의 claim.maxNumber */
  maxNumber(): number
  /** 지금 범위의 상품 이름 — 자료가 같으면 같은 배열 (사전을 다시 만들지 않게) */
  currentNames(): readonly string[]
  /** 그 방송에 지금 있는 상품: 번호 → 판매 종료인가 */
  products(): ReadonlyMap<number, boolean>
  /** 지난 실제 범위의 상품 이름 (음성을 켤 때 한 번) */
  fetchHistory(): Promise<readonly PastDay[]>
  /** 창이 열려 있다 */
  dialogOpen(): boolean
  readConsent(): boolean
  writeConsent(): void
  readSettings(): unknown
  writeSettings(settings: VoiceSettings): void
  /** 카드 등록 — 빠른 입력과 같은 등록 경로 */
  register(card: SuggestionCard, registration: CardRegistration, source: RegisterSource): void
  focusQuick(): void
  // ── 음성 문자찜 (V1) — writeSms가 없으면 문자찜 문장은 카드를 만들지 않는다 ──
  /** R-21 읽기 설정: 그 방송의 판매 방식·번호 범위·수량 상한, 옵션 방식이면 상품 목록·지금 상품 */
  smsReadOptions?(): SmsReadOptions
  /** 번호 → 지금 상품 모습 (없는 번호는 null) */
  smsProduct?(no: number): SmsProductView | null
  /** 카드에 보일 상품 이름 (옵션 방식만 — 번호 방식은 null) */
  smsProductName?(no: number): string | null
  /** 말한 받은 시각 `H:MM[:SS]` → 손 입력 문자찜과 같은 읽기(ORD-08 AC6·D-089)로 보낼 값과 지금보다 늦은지. 읽지 못하면 null */
  readSmsTime?(time: string, now: number): { readonly value: string; readonly late: boolean } | null
  /** 문자찜 쓰기 하나 (손 입력과 같은 `sms` 이벤트). received = 보낼 받은 시각(null이면 비움) */
  writeSms?(write: VoiceSmsWrite, received: string | null, requestId: string): Promise<SmsWriteOutcome>
  newRequestId?(): string
  readSmsSettings?(): unknown
  writeSmsSettings?(settings: SmsVoiceSettings): void
}

/** 컨트롤러가 생기기 전·꺼진 처음 상태 */
export const VOICE_IDLE: VoiceSnapshot = {
  phase: 'off',
  stateLabel: null,
  error: null,
  interim: null,
  heard: [],
  cards: [],
  front: null,
  forms: new Map(),
  notes: new Map(),
  settings: null,
  secondsText: '',
  settingsProblem: null,
  historyFailed: false,
  tooSoon: false,
  now: 0,
  sms: [],
  smsSettings: null,
  smsSecondsText: '',
  smsSettingsProblem: null,
  smsDropped: [],
}

/** 창이 열려 미룬 자동 확정을 다시 보는 간격 */
const DEFERRED_POLL_MS = 250
/**
 * "음성: 다시 시작 중"을 적어도 이만큼 보인다 (AC-I4-12). 엔진은 다시 시작하자마자 같은 순간에 듣는 중을 알리므로 그대로 그리면 한 번도 보이지 않는다.
 * 그 사이 최종 결과가 오면(다시 듣고 있다) 바로 "듣는 중"으로 바꾼다.
 */
export const RESTART_LABEL_MS = 1000
/**
 * 켠 직후 판매 이력(D-I4-06)을 받는 동안 온 최종 문장은 이력을 받을 때까지(켠 때부터 최대 이만큼) 카드 만들기를 미룬다 —
 * 켜자마자 말한 지난 판매 품종도 이력 사전으로 알아듣게. 들린 말 기록에는 바로 남고, 미룬 문장은 온 차례대로 카드가 된다.
 * 받지 못했거나(실패) 이 시간이 지나면 그때의 사전(지금 범위 + 기본 사전)으로 만든다. 끄거나 엔진이 멈추면 바로 만든다.
 */
export const HISTORY_WAIT_MS = 2000

/** 이력을 기다리며 미룬 최종 문장과 그 문장이 온 때의 설정·번호 범위 */
type HeldSentence = {
  readonly text: string
  readonly settings: VoiceSettings
  readonly maxNumber: number
  /** 그 문장이 온 때의 문자찜 설정 (끈 채 말한 문자찜 문장은 카드를 만들지 않는다) */
  readonly smsSettings: SmsVoiceSettings | null
}

/** 카드를 만드는 동안의 목록 (한 번에 #set) */
type CardWork = { cards: readonly SuggestionCard[]; sms: readonly SmsEntry[]; dropped: readonly SmsDropped[] }

/** 같은 말 막기 시간 (D-V1-06 — 패키지 SMS_REPEAT_WINDOW_MS와 같다): 닫은 카드를 이만큼 들고 있는다 */
const SMS_KEEP_MS = 10_000
/** 화면에 남기는 결과 카드 수 (넘으면 오래된 것부터 닫는다 — 찜은 그대로) */
export const SMS_RESULTS_SHOWN = 5

/** 화면에 보이는 문자찜 카드 (열림·보내는 중·결과) */
export const smsShown = (entry: SmsEntry): boolean => !entry.hidden && entry.card.status !== 'CLOSED'

type HistoryState = { readonly state: 'idle' | 'loading' | 'failed'; readonly past: readonly PastDay[] } | { readonly state: 'done'; readonly past: readonly PastDay[] }

const isOpen = (card: SuggestionCard): boolean => card.status === 'OPEN'

function firstEmpty(card: SuggestionCard): FormField {
  if (card.no === null) return 'no'
  if (card.name === null) return 'name'
  if (card.price === null) return 'price'
  return 'no'
}

/** 보내지 못했을 때 (연결이 끊김 등 — 서버 문장이 없을 때) */
export const SMS_SEND_FAILED = '문자찜을 넣지 못했어요. 인터넷 연결을 확인하고 다시 "넣기"를 눌러 주세요.'

/**
 * 같은 말 검사에 더는 필요 없는 문자찜 카드를 뺀다: 닫은 카드·닫은 결과 카드는 만든 지 10초까지만 (D-V1-06).
 * 결과 카드가 SMS_RESULTS_SHOWN개를 넘으면 오래된 것부터 화면에서 닫는다(찜은 그대로).
 */
export function pruneSms(entries: readonly SmsEntry[], now: number): readonly SmsEntry[] {
  let shown = 0
  let changed = false
  const out: SmsEntry[] = []
  for (const entry of entries) {
    let item = entry
    if (item.card.status === 'SENT' && !item.hidden && !item.sending) {
      shown++
      if (shown > SMS_RESULTS_SHOWN) item = { ...item, hidden: true }
    }
    const gone = (item.hidden || item.card.status === 'CLOSED') && !item.sending && Number.isFinite(now) && now - item.card.createdAt > SMS_KEEP_MS
    if (gone || item !== entry) changed = true
    if (!gone) out.push(item)
  }
  return changed ? out : entries
}

export class VoiceController {
  readonly #host: VoiceHost
  #snapshot: VoiceSnapshot
  readonly #listeners = new Set<() => void>()
  #module: VoiceModule | null = null
  #engine: SpeechEngine | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  /** "다시 시작 중"을 보이는 동안 (끝나면 엔진이 듣는 중이면 "듣는 중"으로) */
  #restartTimer: ReturnType<typeof setTimeout> | null = null
  /** 엔진이 마지막으로 알린 상태가 듣는 중이다 */
  #engineListening = false
  #disposed = false
  #nextCard = 1
  #nextHeard = 1
  #history: HistoryState = { state: 'idle', past: [] }
  /** 이력을 받는 동안 미룬 최종 문장 (온 차례) — 온 때의 설정·번호 범위를 함께 담는다 (TE-N3-004: 미룬 사이 자동 등록을 켜도 끈 채 말한 문장은 자동 등록하지 않는다) */
  #held: HeldSentence[] = []
  #heldTimer: ReturnType<typeof setTimeout> | null = null
  /** 이 시각까지만 이력을 기다린다 (host.now 기준) */
  #historyDeadline = 0
  #dictionary: { readonly names: readonly string[]; readonly past: readonly PastDay[]; readonly prepared: VarietyDictionary } | null = null
  /** 문자찜 카드 ID → 주문마다의 요청 번호 (다시 보낼 때 같은 번호 — 찜이 둘 생기지 않게) */
  readonly #smsRequests = new Map<string, string[]>()
  /** 카드마다 요청 번호를 만든 때의 넣기 방법 — 같은 방법으로 다시 보내면 같은 요청 번호(서버 멱등), 바뀌면 새 번호 */
  readonly #smsChoices = new Map<string, string>()

  constructor(host: VoiceHost) {
    this.#host = host
    this.#snapshot = { ...VOICE_IDLE, now: host.now() }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): VoiceSnapshot => this.#snapshot

  // ── 켜기·끄기 (D-I4-04) ─────────────────────────────────────────────

  /** "음성 켜기"/"음성 끄기" */
  toggle(): void {
    if (this.#snapshot.phase === 'on' || this.#snapshot.phase === 'loading') this.turnOff()
    else if (this.#snapshot.phase === 'off') void this.turnOn()
  }

  async turnOn(): Promise<void> {
    if (this.#disposed || this.#snapshot.phase !== 'off') return
    this.#set({ phase: 'loading', error: null })
    let module: VoiceModule
    try {
      module = await this.#host.load()
    } catch {
      if (!this.#disposed && this.#phase() === 'loading') this.#set({ phase: 'off', error: VOICE_LOAD_FAILED })
      return
    }
    if (this.#disposed || this.#phase() !== 'loading') return
    this.#module = module
    if (this.#snapshot.settings === null) {
      const settings = module.resolveVoiceSettings(this.#host.readSettings())
      this.#set({ settings, secondsText: String(settings['voice.autoConfirmSec']) })
    }
    if (this.#snapshot.smsSettings === null) {
      // 못 읽거나 깨진 값은 기본(듣기 켬·3초) — resolveSmsSettings가 고른다
      const smsSettings = module.resolveSmsSettings(this.#host.readSmsSettings?.() ?? null)
      this.#set({ smsSettings, smsSecondsText: String(smsSettings['voice.smsAutoSec']) })
    }
    const engine = this.#ensureEngine(module)
    // 지원하지 않는 브라우저는 안내 창을 띄우기 전에 알린다 (AC-I4-12)
    if (!engine.isSupported()) {
      this.#set({ phase: 'off', error: module.SPEECH_ERROR_MESSAGES.UNSUPPORTED })
      return
    }
    if (!this.#host.readConsent()) {
      this.#set({ phase: 'consent' })
      return
    }
    this.#start()
  }

  /** 안내 창의 "음성 켜기": 그 기기에 확인을 남기고 시작한다 */
  acceptConsent(): void {
    if (this.#disposed || this.#snapshot.phase !== 'consent') return
    this.#host.writeConsent()
    this.#start()
  }

  /** 안내 창의 "닫기"·Esc: 꺼진 그대로 */
  declineConsent(): void {
    if (this.#snapshot.phase !== 'consent') return
    this.#set({ phase: 'off' })
    this.#host.focusQuick()
  }

  /** "음성 끄기": 인식을 멈추고 모든 카드의 자동 확정을 멈춘다(카드는 남는다) */
  turnOff(): void {
    const phase = this.#snapshot.phase
    if (phase === 'consent') {
      this.declineConsent()
      return
    }
    if (phase === 'off') return
    this.#becomeOff()
    this.#engine?.stop()
    this.#host.focusQuick()
  }

  /** 콘솔을 떠날 때: 인식을 멈추고 기다림을 모두 버린다 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#releaseRestart()
    this.#dropHeld()
    this.#engine?.stop()
    this.#listeners.clear()
  }

  /** 지금 단계 (await 뒤에 다시 읽는다) */
  #phase(): VoicePhase {
    return this.#snapshot.phase
  }

  #ensureEngine(module: VoiceModule): SpeechEngine {
    if (this.#engine !== null) return this.#engine
    const engine = module.createWebSpeechEngine({ now: () => this.#host.now() })
    engine.onResult((result) => this.#onResult(result))
    engine.onError((error) => this.#onError(error))
    engine.onState((state) => this.#onState(state))
    this.#engine = engine
    return engine
  }

  #start(): void {
    const engine = this.#engine
    if (engine === null) return
    this.#releaseRestart()
    this.#set({ phase: 'on', error: null, interim: null, stateLabel: this.#label('LISTENING') })
    engine.start()
    if (this.#phase() === 'on') this.#loadHistory()
    // 누른 버튼("음성 켜기")이 사라졌다 — 말하고 바로 Enter를 칠 수 있게 빠른 입력칸으로
    this.#host.focusQuick()
  }

  #becomeOff(): void {
    this.#releaseRestart()
    // 이력을 기다리며 미룬 문장도 카드로 (끈 뒤라 자동 확정은 아래에서 멈춘다)
    this.#flushHeld()
    const cards = this.#snapshot.cards.map((card) => (card.autoConfirmAt === null ? card : { ...card, autoConfirmAt: null }))
    // 기다리던 문자찜 카드는 남고 저절로 넣지 않는다 — 누르면 넣는다 (AC-V1-22, D-V1-05)
    const module = this.#module
    const sms = module === null ? this.#snapshot.sms : this.#snapshot.sms.map((entry) => (entry.card.autoAt === null ? entry : { ...entry, card: module.stopSmsAuto(entry.card) }))
    this.#set({ phase: 'off', stateLabel: null, interim: null, tooSoon: false, cards, sms })
  }

  #label(state: SpeechState): string {
    const word = this.#module?.SPEECH_STATE_LABELS[state] ?? ''
    return `음성: ${word}`
  }

  #onState(state: SpeechState): void {
    this.#engineListening = state === 'LISTENING'
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    if (state === 'RESTARTING') {
      this.#holdRestart()
      this.#set({ stateLabel: this.#label('RESTARTING') })
    } else if (state === 'LISTENING') {
      // "다시 시작 중"을 보이는 동안이면 그 시간이 지난 뒤에 바꾼다
      if (this.#restartTimer === null) this.#set({ stateLabel: this.#label('LISTENING') })
    } else this.#becomeOff()
  }

  /** "다시 시작 중"을 RESTART_LABEL_MS 동안 둔다 (다시 끊기면 그때부터 다시 잰다) */
  #holdRestart(): void {
    this.#releaseRestart()
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      if (!this.#disposed && this.#snapshot.phase === 'on' && this.#engineListening) this.#set({ stateLabel: this.#label('LISTENING') })
    }, RESTART_LABEL_MS)
  }

  #releaseRestart(): void {
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer)
    this.#restartTimer = null
  }

  /** 최종 결과가 왔다 — "다시 시작 중"을 보이는 중이고 엔진이 듣는 중이면 바로 "듣는 중"으로 (그릴 것 없으면 빈 조각) */
  #listeningAgain(): Partial<VoiceSnapshot> {
    if (this.#restartTimer === null || !this.#engineListening) return {}
    this.#releaseRestart()
    return { stateLabel: this.#label('LISTENING') }
  }

  #onError(error: SpeechError): void {
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    this.#set({ error: error.message })
  }

  #onResult(result: SpeechResult): void {
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    if (!result.final) {
      this.#set({ interim: result.text })
      return
    }
    const heard = pushHeard(this.#snapshot.heard, { id: this.#nextHeard++, text: result.text })
    const label = this.#listeningAgain()
    const module = this.#module
    const settings = this.#snapshot.settings
    if (module === null || settings === null) {
      this.#set({ ...label, interim: null, heard })
      return
    }
    const sentence: HeldSentence = { text: result.text, settings, maxNumber: this.#host.maxNumber(), smsSettings: this.#snapshot.smsSettings }
    if (this.#waitingHistory()) {
      this.#held.push(sentence)
      this.#armHeld()
      this.#set({ ...label, interim: null, heard })
      return
    }
    // 기다림이 끝났는데 타이머보다 먼저 온 문장: 미룬 문장을 먼저 카드로 (온 차례)
    const work = this.#heldCards(module)
    this.#addSentence(work, module, sentence)
    this.#set({ ...label, interim: null, heard, ...this.#workPatch(work) })
  }

  /** 바뀐 목록만 담은 조각 */
  #workPatch(work: CardWork): Partial<VoiceSnapshot> {
    return {
      ...(work.cards === this.#snapshot.cards ? {} : { cards: work.cards }),
      ...(work.sms === this.#snapshot.sms ? {} : { sms: work.sms }),
      ...(work.dropped === this.#snapshot.smsDropped ? {} : { smsDropped: work.dropped }),
    }
  }

  /**
   * 목록에 이 문장의 카드를 더한다 (카드를 만들 결과가 아니면 그대로). 문자찜 표시가 있으면 문자찜 카드(R-21), 없으면 상품 카드(R-17) — 하나만(R-21 2).
   * 설정·번호 범위는 문장이 온 때의 값, 사전은 지금 사전(이력을 기다린 까닭), 만든 시각은 카드가 보이는 지금
   * — 자동 등록 기다림을 판매자가 화면에서 다 볼 수 있게 미룬 시간만큼 줄이지 않는다
   */
  #addSentence(work: CardWork, module: VoiceModule, sentence: HeldSentence): void {
    const { text, settings, maxNumber } = sentence
    const smsOn = this.#host.writeSms !== undefined
    const read = module.readVoiceSentence(text, {
      extract: { maxNumber, dictionary: this.#prepared(module) },
      sms: { maxNumber, ...(this.#host.smsReadOptions?.() ?? {}) },
      // 문자찜 쓰기가 없는 화면이면 문자찜 문장은 카드를 만들지 않는다
      smsSettings: smsOn ? sentence.smsSettings : { 'voice.smsListen': false },
    })
    if (read.kind === 'none') return
    if (read.kind === 'sms') {
      this.#addSms(work, module, text, read.reading, sentence.smsSettings)
      return
    }
    const card = module.createCard({ id: `voice-${String(this.#nextCard++)}`, extraction: read.extraction, text, createdAt: this.#host.now(), settings })
    if (card !== null) this.#place(work, module, card)
  }

  /** 새 카드를 맨 앞에 — 열린 카드 수 규칙은 상품 카드·문자찜 카드를 함께 센다 (D-204·D-I4-02, addVoiceCard) */
  #place(work: CardWork, module: VoiceModule, card: VoiceCard, entry?: SmsEntry): void {
    const merged: VoiceCard[] = [...work.cards, ...work.sms.map((item) => item.card)].sort((a, b) => b.createdAt - a.createdAt)
    const next = module.addVoiceCard(merged, card)
    const byId = new Map(next.map((item) => [item.id, item]))
    work.cards = next.filter((item): item is SuggestionCard => !module.isSmsCard(item) && isOpen(item))
    const dropped: SmsDropped[] = []
    const rest = work.sms.map((item) => {
      const changed = byId.get(item.card.id)
      if (changed === undefined || changed === item.card || !module.isSmsCard(changed)) return item
      // 넣을 수 있던(이유 없는) 카드가 넣지 않은 채 닫혔다 — 안내를 남긴다 (U-V1-01)
      if (item.card.status === 'OPEN' && changed.status === 'CLOSED' && item.reason === null && item.results.length === 0) {
        const short = smsShortText(this.describeSms(item.card))
        dropped.push({ id: item.card.id, short, text: smsDroppedText(short) })
      }
      return { ...item, card: changed }
    })
    work.sms = entry === undefined ? rest : [entry, ...rest]
    if (dropped.length > 0) work.dropped = [...dropped, ...work.dropped]
  }

  /** 문자찜 문장 → 같은 말이면 앞 카드에 표시, 아니면 새 문자찜 카드 (D-V1-06·07) */
  #addSms(work: CardWork, module: VoiceModule, text: string, reading: SmsReading, smsSettings: SmsVoiceSettings | null): void {
    const now = this.#host.now()
    const repeat = module.findSmsRepeat(
      work.sms.map((item) => item.card),
      reading,
      now,
    )
    if (repeat !== null) {
      work.sms = work.sms.map((item) => (item.card.id === repeat.id ? { ...item, card: module.markSmsRepeat(item.card) } : item))
      return
    }
    let card = module.createSmsCard({ id: `voice-${String(this.#nextCard++)}`, reading, text, createdAt: now, settings: smsSettings })
    let reason: string | null = reading.problem === null ? null : module.SMS_PROBLEM_MESSAGES[reading.problem]
    let timeCheck = false
    if (reason === null && reading.time !== null) {
      const time = this.#readTime(reading.time, now)
      if (time === null) reason = module.SMS_PROBLEM_MESSAGES.TIME_UNCLEAR
      else if (time.late) {
        // 지금보다 늦은 받은 시각: 저절로 넣지 않고 묻는다 (AC-V1-26)
        timeCheck = true
        card = module.stopSmsAuto(card)
      }
    }
    if (reason === null) {
      const blocked = module.findSmsBlock(card, (no) => this.#smsProduct(no))
      if (blocked !== null) reason = module.smsBlockMessage(blocked.no, blocked.block)
    }
    if (reason !== null) card = module.stopSmsAuto(card)
    this.#place(work, module, card, { card, reason, timeCheck, sending: false, error: null, results: [], hidden: false })
  }

  // ── 이력을 기다리며 미룬 문장 (HISTORY_WAIT_MS) ─────────────────────

  #waitingHistory(): boolean {
    return this.#history.state === 'loading' && this.#host.now() < this.#historyDeadline
  }

  #armHeld(): void {
    if (this.#heldTimer !== null) return
    this.#heldTimer = setTimeout(
      () => {
        this.#heldTimer = null
        this.#flushHeld()
      },
      Math.max(0, this.#historyDeadline - this.#host.now()),
    )
  }

  /** 미룬 문장을 지금 사전으로 카드로 만든 목록 (미룬 것이 없으면 지금 목록) — 미룬 목록은 비운다 */
  #heldCards(module: VoiceModule): CardWork {
    if (this.#heldTimer !== null) clearTimeout(this.#heldTimer)
    this.#heldTimer = null
    const held = this.#held
    this.#held = []
    const work: CardWork = { cards: this.#snapshot.cards, sms: this.#snapshot.sms, dropped: this.#snapshot.smsDropped }
    for (const sentence of held) this.#addSentence(work, module, sentence)
    return work
  }

  #flushHeld(): void {
    if (this.#held.length === 0) {
      this.#dropHeld()
      return
    }
    const module = this.#module
    if (this.#disposed || module === null) {
      this.#dropHeld()
      return
    }
    const patch = this.#workPatch(this.#heldCards(module))
    if (Object.keys(patch).length > 0) this.#set(patch)
  }

  #dropHeld(): void {
    if (this.#heldTimer !== null) clearTimeout(this.#heldTimer)
    this.#heldTimer = null
    this.#held = []
  }

  // ── 판매 이력 사전 (D-I4-06) ────────────────────────────────────────

  #loadHistory(): void {
    if (this.#history.state === 'loading' || this.#history.state === 'done') return
    this.#history = { state: 'loading', past: [] }
    this.#historyDeadline = this.#host.now() + HISTORY_WAIT_MS
    this.#host.fetchHistory().then(
      (past) => {
        if (this.#disposed) return
        this.#history = { state: 'done', past }
        this.#set({ historyFailed: false })
        this.#flushHeld()
      },
      () => {
        if (this.#disposed) return
        this.#history = { state: 'failed', past: [] }
        this.#set({ historyFailed: true })
        this.#flushHeld()
      },
    )
  }

  /** 지금 범위 이름 → 지난 범위 이름 → 기본 사전 (지금 범위 상품이 바뀌면 다음 문장부터) */
  #prepared(module: VoiceModule): VarietyDictionary {
    const names = this.#host.currentNames()
    const past = this.#history.state === 'done' ? this.#history.past : []
    const cached = this.#dictionary
    if (cached !== null && cached.names === names && cached.past === past) return cached.prepared
    const history = historyNames(names, past, module.normalizeDictionary)
    const prepared = module.prepareDictionary(module.buildDictionary(history, module.DEFAULT_DICTIONARY))
    this.#dictionary = { names, past, prepared }
    return prepared
  }

  // ── 카드 (D-204, D-I4-02·03) ───────────────────────────────────────

  /** 카드 글 (describeCard — "15번 핑크프릴 15,000원 — 등록할까요?") */
  describe(card: SuggestionCard): string {
    return this.#module?.describeCard(card) ?? ''
  }

  #find(id: string): SuggestionCard | undefined {
    return this.#snapshot.cards.find((card) => card.id === id && isOpen(card))
  }

  #replace(card: SuggestionCard): void {
    this.#set({ cards: this.#snapshot.cards.map((item) => (item.id === card.id ? card : item)) })
  }

  /** 빠른 입력칸의 Enter (칸이 비었을 때 맨 앞 카드). 카드 쪽이 처리했으면 true — 아니면 빠른 입력 그대로 */
  enter(line: string, context: { readonly wide: boolean; readonly dialogOpen: boolean; readonly composing?: boolean }): boolean {
    const snapshot = this.#snapshot
    const decision = decideVoiceEnter({
      line,
      cards: snapshot.cards,
      front: snapshot.front,
      now: this.#host.now(),
      wide: context.wide,
      dialogOpen: context.dialogOpen,
      ...(context.composing === undefined ? {} : { composing: context.composing }),
      editing: new Set(snapshot.forms.keys()),
    })
    if (decision.kind === 'quick') return false
    if (decision.kind === 'tooSoon') {
      this.#set({ tooSoon: true })
      return true
    }
    this.confirm(decision.card.id, 'enter')
    return true
  }

  /**
   * 카드 등록 (Enter·"등록"·자동 확정). 번호·가격이 없으면 등록하지 않고 그 카드의 고치기 칸을 연다(빈 칸에 커서).
   * 있으면 목록에서 빼고 등록 경로로 넘긴다 — 그 방송에 같은 번호가 있는지는 등록 경로가 차례 안에서 본다("고칠까요?").
   */
  confirm(id: string, source: RegisterSource): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    const result = module.confirmCard(card, { maxNumber: this.#host.maxNumber(), existingNumbers: [] })
    if (!result.ok) {
      if (source === 'auto') {
        // 자동 확정은 칸을 열지 않는다 — 그 카드의 자동 확정만 끈다 (등록하지 못한 카드를 다시 자동 확정하려고 하지 않는다)
        this.#replace({ ...card, autoConfirmAt: null })
        return
      }
      if (result.reason === 'NOT_OPEN' || result.reason === 'NUMBER_EXISTS') return
      this.openForm(id, { focus: result.reason === 'PRICE_MISSING' || result.reason === 'PRICE_TOO_LOW' ? 'price' : 'no', message: result.message })
      return
    }
    this.take(id)
    this.#set({ tooSoon: false })
    this.#host.register(card, result.registration, source)
  }

  /** 목록에서 뺀다 (등록 경로·"고칠까요?"로 넘길 때) */
  take(id: string): SuggestionCard | undefined {
    const card = this.#find(id)
    if (card === undefined) return undefined
    this.#set({ cards: this.#snapshot.cards.filter((item) => item.id !== id) })
    return card
  }

  /** "닫기": 등록 없이 사라진다 */
  close(id: string): void {
    if (this.take(id) !== undefined) this.#host.focusQuick()
  }

  /** "자동 등록 멈추기" (= 손댐) */
  stopAuto(id: string): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    this.#replace(module.touchCard(card))
  }

  /** "고치기": 카드 안에 번호·품종·가격 칸 (손댐 — 자동 확정이 꺼진다). 이미 열려 있으면 친 값은 두고 커서·문장만 */
  openForm(id: string, options: { readonly focus?: FormField; readonly message?: string } = {}): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    const touched = card.touched && card.autoConfirmAt === null ? card : module.touchCard(card)
    const current = this.#snapshot.forms.get(id)
    const focus = options.focus ?? firstEmpty(card)
    const form: CardForm =
      current === undefined
        ? {
            no: card.no === null ? '' : String(card.no),
            name: card.name ?? '',
            price: card.price === null ? '' : formatWon(card.price),
            focus,
            message: options.message ?? null,
            version: 1,
          }
        : { ...current, focus, message: options.message ?? current.message, version: current.version + 1 }
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, form)
    this.#set({ forms, cards: this.#snapshot.cards.map((item) => (item.id === id ? touched : item)) })
  }

  editForm(id: string, patch: Partial<Pick<CardForm, 'no' | 'name' | 'price'>>): void {
    const current = this.#snapshot.forms.get(id)
    if (current === undefined) return
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, { ...current, ...patch })
    this.#set({ forms })
  }

  /** 고치기 칸의 Enter가 오류: 문장을 보이고 그 칸에 커서 */
  formProblem(id: string, message: string, focus: FormField): void {
    const current = this.#snapshot.forms.get(id)
    if (current === undefined) return
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, { ...current, message, focus, version: current.version + 1 })
    this.#set({ forms })
  }

  /** 고치기 칸의 Esc: 칸만 닫는다 (카드는 남고 손댐 그대로) */
  closeForm(id: string): void {
    if (!this.#snapshot.forms.has(id)) return
    const forms = new Map(this.#snapshot.forms)
    forms.delete(id)
    this.#set({ forms })
    this.#host.focusQuick()
  }

  /**
   * 등록 경로에서 돌아온 카드를 다시 넣는다 (자동 확정인데 차례에서 같은 번호가 생김·저장하지 못함). 자동 확정은 끄고, 만든 순서 자리에 넣는다.
   */
  restore(card: SuggestionCard, options: { readonly note?: string; readonly touched?: boolean } = {}): void {
    if (this.#disposed || this.#snapshot.cards.some((item) => item.id === card.id)) return
    const back: SuggestionCard = { ...card, status: 'OPEN', autoConfirmAt: null, touched: card.touched || options.touched === true }
    const cards = [...this.#snapshot.cards]
    const at = cards.findIndex((item) => item.createdAt < back.createdAt)
    cards.splice(at === -1 ? cards.length : at, 0, back)
    const notes = new Map(this.#snapshot.notes)
    if (options.note !== undefined) notes.set(card.id, options.note)
    this.#set({ cards, notes })
  }

  // ── 자동 확정 설정 (D-I4-05) ───────────────────────────────────────

  setAutoConfirm(on: boolean): void {
    const current = this.#snapshot.settings
    if (current === null) return
    const settings: VoiceSettings = { ...current, 'voice.autoConfirm': on }
    this.#host.writeSettings(settings)
    // 끄면 기다리던 카드도 멈춘다 (다시 켜도 그 카드는 자동 확정하지 않는다)
    const cards = on ? this.#snapshot.cards : this.#snapshot.cards.map((card) => (card.autoConfirmAt === null ? card : { ...card, autoConfirmAt: null }))
    // 이력을 기다리며 미룬 문장도 마찬가지 — 켠 채 말했어도 끄면 자동 등록하지 않는다 (다시 켜도)
    if (!on) this.#held = this.#held.map((held) => ({ ...held, settings: { ...held.settings, 'voice.autoConfirm': false } }))
    this.#set({ settings, cards })
  }

  /** "기다리는 시간(초)": 3~30 정수만 받는다 — 아니면 checkVoiceSettings 문장을 보이고 값은 그대로 */
  setSeconds(text: string): void {
    const module = this.#module
    const current = this.#snapshot.settings
    if (module === null || current === null) return
    const value = parseSecondsText(text)
    const problems = module.checkVoiceSettings({ 'voice.autoConfirmSec': value })
    if (problems.length > 0) {
      this.#set({ secondsText: text, settingsProblem: problems[0]?.message ?? null })
      return
    }
    const settings: VoiceSettings = { ...current, 'voice.autoConfirmSec': value }
    this.#host.writeSettings(settings)
    this.#set({ settings, secondsText: text, settingsProblem: null })
  }

  // ── 시각·자동 확정 (D-204, D-I4-05) ────────────────────────────────

  /** 창이 닫혔거나 상품이 바뀌었을 때·기다림이 끝났을 때: 자동 확정을 다시 본다 */
  refresh(): void {
    if (this.#disposed) return
    this.#autoConfirm()
    this.#smsAuto()
    // 맨 앞 카드의 "Enter 등록"이 보이면 "새 카드가 방금 나왔어요…"는 할 일을 다 했다
    const tooSoon = this.#snapshot.tooSoon && !enterReady(this.#snapshot.front, this.#host.now())
    this.#set({ tooSoon })
  }

  /**
   * 기다림이 끝난 카드를 모두 등록한다. decideAutoConfirm은 한 번에 하나(기다림이 가장 먼저 끝난 것)를 고르므로 등록한 뒤 남은 카드를 다시 본다 —
   * 기다림이 같은 순간에 끝난 카드 둘도 그 순간에 함께 등록된다(AC-I4-31). 한 카드는 등록 경로에 한 번만 넘긴다(confirm이 목록에서 빼거나 자동 확정을 끈다).
   */
  #autoConfirm(): void {
    const tried = new Set<string>()
    for (;;) {
      const auto = this.#decideAuto()
      if (auto === null) return
      const { decision, products } = auto
      if (decision.blocked.length > 0) {
        // 그 순간 번호가 있으면 등록하지 않고 카드에 "고칠까요?" — 창은 띄우지 않는다 (D-I4-05)
        const notes = new Map(this.#snapshot.notes)
        for (const card of decision.blocked) if (card.no !== null) notes.set(card.id, editQuestion(card.no, products.get(card.no) === true))
        this.#set({ cards: decision.cards, notes })
      }
      const due = decision.due
      if (due === null || tried.has(due.id)) return
      tried.add(due.id)
      this.confirm(due.id, 'auto')
    }
  }

  /** 지금 자동 확정 판단 (음성 모듈·설정·카드가 없으면 null) */
  #decideAuto(): { readonly decision: AutoConfirmDecision; readonly products: ReadonlyMap<number, boolean> } | null {
    const module = this.#module
    const snapshot = this.#snapshot
    if (module === null || snapshot.settings === null || snapshot.cards.length === 0) return null
    const products = this.#host.products()
    const decision = decideAutoConfirm(
      {
        cards: snapshot.cards,
        settings: snapshot.settings,
        now: this.#host.now(),
        existingNumbers: new Set(products.keys()),
        voiceOn: snapshot.phase === 'on',
        dialogOpen: this.#host.dialogOpen(),
      },
      module.checkAutoConfirm,
    )
    return { decision, products }
  }

  /**
   * 기다림이 이미 끝난 카드가 있으면 그 판단: 'now' = 바로 다시 볼 것(등록하거나 "고칠까요?"), 'deferred' = 창이 열려 미룸, 없으면 null.
   * nextWake는 앞으로 올 시각만 보므로, 다시 보기 전에 다른 일(인식 결과 등)로 타이머를 다시 잡아도 기다림이 끝난 카드를 놓치지 않게 따로 본다.
   */
  #ripeAuto(): 'now' | 'deferred' | null {
    const now = this.#snapshot.now
    if (!this.#snapshot.cards.some((card) => isOpen(card) && card.autoConfirmAt !== null && card.autoConfirmAt <= now)) return null
    const decision = this.#decideAuto()?.decision
    if (decision === undefined) return null
    if (decision.deferred) return 'deferred'
    return decision.due !== null || decision.blocked.length > 0 ? 'now' : null
  }

  // ── 문자찜 카드 (VOC-04 문자찜 카드, ORD-08 AC9, D-V1-03~07) ───────────

  /** 카드 글 (describeSmsCard — 옵션 방식이면 상품 이름 포함) */
  describeSms(card: SmsCard): string {
    const module = this.#module
    if (module === null) return ''
    const name = this.#host.smsProductName
    return module.describeSmsCard(card, name === undefined ? {} : { productName: (no) => name(no) })
  }

  /** 문자찜 화면 문장 (음성 패키지의 따옴표 문장 그대로 — 화면 파일은 패키지 값을 직접 부르지 않는다, AC-I4-04). 받기 전엔 null */
  smsWords(): SmsWords | null {
    const module = this.#module
    if (module === null) return null
    return { labels: module.SMS_LABELS, listening: module.SMS_LISTENING, repeat: module.SMS_REPEAT_NOTE, timeCheck: module.SMS_TIME_CHECK, choose: module.smsChooseMessage }
  }

  /** 남은 초 글 ("3초 뒤 넣어요"), 기다리지 않으면 null */
  smsCountdown(entry: SmsEntry): string | null {
    if (entry.reason !== null || entry.sending || this.#snapshot.phase !== 'on') return null
    return this.#module?.smsCountdownText(entry.card, this.#snapshot.now) ?? null
  }

  #readTime(time: string, now: number): { readonly value: string; readonly late: boolean } | null {
    const read = this.#host.readSmsTime
    if (read === undefined) return null
    try {
      return read(time, now)
    } catch {
      return null
    }
  }

  #smsProduct(no: number): SmsProductView | null {
    try {
      return this.#host.smsProduct?.(no) ?? null
    } catch {
      return null
    }
  }

  #findSms(id: string): SmsEntry | undefined {
    return this.#snapshot.sms.find((entry) => entry.card.id === id)
  }

  #replaceSms(id: string, change: (entry: SmsEntry) => SmsEntry): void {
    this.#set({ sms: this.#snapshot.sms.map((entry) => (entry.card.id === id ? change(entry) : entry)) })
  }

  /** "넣지 않기"·이유 카드의 "닫기": 아무것도 보내지 않고 닫는다 (같은 말 검사에는 10초 남는다) */
  smsSkip(id: string): void {
    const module = this.#module
    const entry = this.#findSms(id)
    if (module === null || entry === undefined || entry.sending || entry.card.status !== 'OPEN') return
    this.#replaceSms(id, (item) => ({ ...item, card: module.closeSmsCard(item.card) }))
    this.#host.focusQuick()
  }

  /** 저절로 닫힌 문자찜 카드 안내의 "확인": 안내만 지운다 */
  smsDroppedSeen(id: string): void {
    if (!this.#snapshot.smsDropped.some((item) => item.id === id)) return
    this.#set({ smsDropped: this.#snapshot.smsDropped.filter((item) => item.id !== id) })
  }

  /** 결과 카드의 "닫기": 화면에서만 뺀다 (찜은 그대로) */
  smsDismiss(id: string): void {
    const entry = this.#findSms(id)
    if (entry === undefined || entry.sending || entry.card.status !== 'SENT') return
    this.#replaceSms(id, (item) => ({ ...item, hidden: true }))
    this.#host.focusQuick()
  }

  /** "지금 넣기"·"넣기" */
  smsSend(id: string): void {
    void this.#sendSms(id, { kind: 'auto' })
  }

  /** 고르기 카드의 후보 누르기 → 그 구매자로 넣기 (AC-V1-25) */
  smsChoose(id: string, buyer: string): void {
    void this.#sendSms(id, { kind: 'buyer', buyer })
  }

  /**
   * 고르기 카드의 "새 손님으로 넣기" (D-V1-14, AC-V1-25): 끝자리 + newBuyer로 넣는다(후보를 찾지 않고 새 문자 구매자).
   * 주문이 여럿이면 첫 주문이 만든 구매자로 나머지를 넣는다 — 주문마다 새 손님이 생기지 않게
   */
  smsNewBuyer(id: string): void {
    void this.#sendSms(id, { kind: 'new' })
  }

  /** 넣기: 주문마다 `sms` 쓰기 한 번 (요청 번호는 주문마다 다르고, 다시 보낼 때는 같다). 409면 고르기, 실패면 다시 열기(저절로 넣지 않음) */
  async #sendSms(id: string, choice: SmsChoice): Promise<void> {
    const module = this.#module
    const entry = this.#findSms(id)
    const write = this.#host.writeSms
    if (module === null || entry === undefined || write === undefined || entry.sending || entry.reason !== null) return
    const fresh = choice.kind === 'new'
    // 새 손님: 고르기 카드에서 끝자리가 있을 때만. 카드 규칙(sendSmsCard)은 후보 없이 끝자리로 넣는 쓰기를 만들고, 후보는 카드에 남긴다(실패하면 다시 고른다)
    if (fresh && (entry.card.candidates === null || entry.card.reading.last4 === null)) return
    const sent = module.sendSmsCard(fresh ? { ...entry.card, candidates: null } : entry.card, {
      product: (no) => this.#smsProduct(no),
      ...(choice.kind === 'buyer' ? { buyer: choice.buyer } : {}),
    })
    const result = fresh && sent.ok ? { ...sent, card: { ...sent.card, candidates: entry.card.candidates } } : sent
    if (!result.ok) {
      if (result.reason === 'NOT_OPEN') return
      // 문제·넣을 수 없는 상품(넣기 직전에 판매 종료 등)은 이유 카드로, 고르기 문제는 카드에 문장만 (D-V1-07)
      if (result.reason === 'PROBLEM' || result.reason === 'PRODUCT') this.#replaceSms(id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: result.message, error: null }))
      else this.#replaceSms(id, (item) => ({ ...item, error: result.message }))
      return
    }
    // 받은 시각: 손 입력과 같은 읽기로 지금 다시 읽는다 (보내는 때의 지금 기준)
    const writes = result.writes
    const received: (string | null)[] = []
    for (const one of writes) {
      if (one.time === null) {
        received.push(null)
        continue
      }
      const time = this.#readTime(one.time, this.#host.now())
      if (time === null) {
        this.#replaceSms(id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: module.SMS_PROBLEM_MESSAGES.TIME_UNCLEAR }))
        return
      }
      received.push(time.value)
    }
    // 넣기 방법(그대로·고른 구매자·새 손님)이 바뀌면 새 요청 번호 (본문이 달라졌다). 같은 방법으로 다시 보내면 같은 번호 — 응답만 잃은 쓰기가 두 번 기록되지 않는다
    if (!this.#smsRequests.has(id) || this.#smsChoices.get(id) !== choiceKey(choice)) {
      this.#smsRequests.set(id, writes.map(() => this.#requestId()))
      this.#smsChoices.set(id, choiceKey(choice))
    }
    const requests = this.#smsRequests.get(id) as string[]
    this.#replaceSms(id, (item) => ({ ...item, card: result.card, sending: true, error: null }))
    this.#host.focusQuick()
    const done = new Set(entry.results.map((line) => line.no))
    // 새 손님: 이미 넣은 주문이 정한 구매자가 있으면 그 구매자로 (첫 주문만 newBuyer)
    let made: string | null = fresh ? (entry.results.find((line) => line.buyer !== null)?.buyer ?? null) : null
    for (const [index, card] of writes.entries()) {
      if (done.has(card.no)) continue
      let one: VoiceSmsWrite = card
      if (fresh) {
        const { last4, ...rest } = card
        one = made !== null ? { ...rest, buyer: made } : last4 === undefined ? card : { ...rest, last4, newBuyer: true }
      }
      let outcome: SmsWriteOutcome
      try {
        outcome = await write(one, received[index] ?? null, requests[index] ?? this.#requestId())
      } catch {
        outcome = { kind: 'failed', message: SMS_SEND_FAILED }
      }
      if (this.#disposed) return
      if (outcome.kind === 'ok') {
        if (fresh && made === null) made = outcome.buyer
        const line: SmsResultLine = { no: one.no, seq: outcome.seq, buyer: outcome.buyer }
        this.#replaceSms(id, (item) => ({ ...item, results: [...item.results, line] }))
        continue
      }
      if (outcome.kind === 'ambiguous') {
        this.#replaceSms(id, (item) => ({ ...item, card: module.chooseSmsBuyer(item.card, outcome.candidates), sending: false, choose: outcome.message ?? null }))
        return
      }
      this.#replaceSms(id, (item) => ({ ...item, card: module.reopenSmsCard(item.card), sending: false, error: outcome.message }))
      return
    }
    this.#smsRequests.delete(id)
    this.#smsChoices.delete(id)
    this.#replaceSms(id, (item) => ({ ...item, sending: false }))
  }

  #requestId(): string {
    const make = this.#host.newRequestId
    if (make !== undefined) return make()
    return `voice-sms-${String(this.#host.now())}-${String(this.#nextCard++)}`
  }

  /**
   * 기다림이 끝난 문자찜 카드를 넣는다 (D-V1-05): 열림·주문 하나·문제 없음·손대지 않음·고르기 아님·받을 수 있는 상품·말한 시각이 늦지 않음·창 없음·음성 켜짐.
   * 넣을 수 없는 상품이 되었으면 이유 카드로 바꾼다. 창이 열려 있으면 그대로 두고 닫힌 뒤 다시 본다.
   */
  #smsAuto(): void {
    const module = this.#module
    if (module === null) return
    const now = this.#host.now()
    const voiceOn = this.#snapshot.phase === 'on'
    let dialogOpen: boolean | null = null
    for (const entry of this.#snapshot.sms) {
      if (entry.card.status !== 'OPEN' || entry.card.autoAt === null || entry.reason !== null || entry.sending) continue
      if (voiceOn && entry.card.autoAt > now) continue
      dialogOpen ??= this.#host.dialogOpen()
      const time = entry.card.reading.time
      const read = time === null ? null : this.#readTime(time, now)
      const decision = module.checkSmsAuto(entry.card, {
        now,
        voiceOn,
        dialogOpen,
        product: (no) => this.#smsProduct(no),
        timeAfterNow: read !== null && read.late,
      })
      if (decision.due) {
        void this.#sendSms(entry.card.id, { kind: 'auto' })
        continue
      }
      const block = decision.block
      if (block !== null) {
        this.#replaceSms(entry.card.id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: module.smsBlockMessage(block.no, block.block) }))
        continue
      }
      if (decision.card !== entry.card) {
        const timeCheck = time !== null && read !== null && read.late
        this.#replaceSms(entry.card.id, (item) => ({ ...item, card: decision.card, timeCheck: item.timeCheck || timeCheck }))
      }
    }
  }

  /** 기다림이 끝난 문자찜 카드가 있으면 'now'(창이 없음)·'deferred'(창이 열림), 없으면 null */
  #ripeSms(): 'now' | 'deferred' | null {
    const now = this.#snapshot.now
    const ripe = this.#snapshot.sms.some((entry) => entry.card.status === 'OPEN' && entry.card.autoAt !== null && entry.card.autoAt <= now && entry.reason === null && !entry.sending)
    if (!ripe) return null
    return this.#snapshot.phase === 'on' && this.#host.dialogOpen() ? 'deferred' : 'now'
  }

  /** 다음 남은 초 글자가 바뀌는 때까지 (기다리는 문자찜 카드가 없으면 null) */
  #smsWake(): number | null {
    const now = this.#snapshot.now
    let next = Number.POSITIVE_INFINITY
    for (const entry of this.#snapshot.sms) {
      const at = entry.card.autoAt
      if (entry.card.status !== 'OPEN' || at === null || at <= now || entry.reason !== null || entry.sending) continue
      const left = Math.ceil((at - now) / 1000)
      next = Math.min(next, at - (left - 1) * 1000)
    }
    return Number.isFinite(next) ? Math.max(0, next - now) : null
  }

  // ── 문자찜 설정 (D-V1-05·09 — 그 기기에 저장) ─────────────────────────

  /** "문자찜도 듣기" — 끄면 다음 문장부터 문자찜 카드를 만들지 않는다 (있던 카드는 그대로) */
  setSmsListen(on: boolean): void {
    const current = this.#snapshot.smsSettings
    if (current === null) return
    const smsSettings: SmsVoiceSettings = { ...current, 'voice.smsListen': on }
    this.#host.writeSmsSettings?.(smsSettings)
    this.#held = this.#held.map((held) => ({ ...held, smsSettings: held.smsSettings === null ? null : { ...held.smsSettings, 'voice.smsListen': on && held.smsSettings['voice.smsListen'] } }))
    this.#set({ smsSettings })
  }

  /** "문자찜 자동으로 넣기까지(초)": 0~10 정수만 받는다 — 아니면 checkSmsSettings 문장을 보이고 값은 그대로 */
  setSmsSeconds(text: string): void {
    const module = this.#module
    const current = this.#snapshot.smsSettings
    if (module === null || current === null) return
    const value = parseSecondsText(text)
    const problems = module.checkSmsSettings({ 'voice.smsAutoSec': value })
    if (problems.length > 0) {
      this.#set({ smsSecondsText: text, smsSettingsProblem: problems[0]?.message ?? null })
      return
    }
    const smsSettings: SmsVoiceSettings = { ...current, 'voice.smsAutoSec': value }
    this.#host.writeSmsSettings?.(smsSettings)
    this.#set({ smsSettings, smsSecondsText: text, smsSettingsProblem: null })
  }

  #set(patch: Partial<VoiceSnapshot>): void {
    if (this.#disposed) return
    const now = this.#host.now()
    let next: VoiceSnapshot = { ...this.#snapshot, ...patch, now }
    if (patch.cards !== undefined) {
      const front = nextFront(this.#snapshot.front, next.cards, now)
      // 사라진 카드의 칸·문장은 버린다
      const ids = new Set(next.cards.map((card) => card.id))
      const forms = [...next.forms.keys()].some((id) => !ids.has(id)) ? new Map([...next.forms].filter(([id]) => ids.has(id))) : next.forms
      const notes = [...next.notes.keys()].some((id) => !ids.has(id)) ? new Map([...next.notes].filter(([id]) => ids.has(id))) : next.notes
      const tooSoon = next.tooSoon && front !== null && front.id === this.#snapshot.front?.id
      next = { ...next, front, forms, notes, tooSoon }
    }
    if (patch.sms !== undefined) next = { ...next, sms: pruneSms(next.sms, now) }
    this.#snapshot = next
    this.#schedule()
    for (const listener of [...this.#listeners]) listener()
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    if (this.#disposed) return
    const wakes = [nextWake(this.#snapshot.cards, this.#snapshot.front, this.#snapshot.now), this.#smsWake()].filter((value): value is number => value !== null)
    const wake = wakes.length === 0 ? null : Math.min(...wakes)
    const ripeCard = this.#ripeAuto()
    const ripeSms = this.#ripeSms()
    const ripe = ripeCard === 'now' || ripeSms === 'now' ? 'now' : ripeCard ?? ripeSms
    const delay = ripe === 'now' ? 0 : ripe === 'deferred' ? Math.min(wake ?? DEFERRED_POLL_MS, DEFERRED_POLL_MS) : wake
    if (delay === null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.refresh()
    }, delay)
  }
}
