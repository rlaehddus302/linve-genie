// 콘솔의 음성 등록 (VOC-01·04·05, D-I4-03~06·09, AC-I4-10~40).
// - "음성 켜기"를 누를 때 음성 모듈을 불러오고(그 전엔 음성 코드·인식 객체·마이크·이력 조회 없음), 그 기기에서 처음이면 안내 창을 거쳐 Web Speech를 시작한다.
// - 중간 결과는 자막 한 줄, 최종 결과는 "들린 말 기록"(최근 20개)과 카드. 인식 문장은 이 객체(탭 메모리)에만 있다 — 서버·저장소·콘솔 로그로 보내지 않는다.
// - 카드 등록은 콘솔이 넘긴 등록 경로(빠른 입력과 같은 product.register)로만 한다. 한 카드는 등록 경로에 한 번만 넘긴다(목록에서 먼저 뺀다).
// - 자동 확정은 켜진 동안·창이 닫힌 동안만, 기다림이 지난 카드를 모두(하나씩 차례로) 등록한다. 끄면 모든 카드의 자동 확정이 멈춘다.
// 시각은 host.now()(콘솔은 Date.now), 기다림은 브라우저 타이머 — 시험이 시계를 당길 수 있다.
import { formatWon } from '@livejjim/core'
import type { CardRegistration, SpeechEngine, SpeechError, SpeechResult, SpeechState, SuggestionCard, VarietyDictionary, VoiceSettings } from '@livejjim/voice'
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
}

/** 창이 열려 미룬 자동 확정을 다시 보는 간격 */
const DEFERRED_POLL_MS = 250
/**
 * "음성: 다시 시작 중"을 적어도 이만큼 보인다 (AC-I4-12). 엔진은 다시 시작하자마자 같은 순간에 듣는 중을 알리므로 그대로 그리면 한 번도 보이지 않는다.
 * 그 사이 최종 결과가 오면(다시 듣고 있다) 바로 "듣는 중"으로 바꾼다.
 */
export const RESTART_LABEL_MS = 1000

type HistoryState = { readonly state: 'idle' | 'loading' | 'failed'; readonly past: readonly PastDay[] } | { readonly state: 'done'; readonly past: readonly PastDay[] }

const isOpen = (card: SuggestionCard): boolean => card.status === 'OPEN'

function firstEmpty(card: SuggestionCard): FormField {
  if (card.no === null) return 'no'
  if (card.name === null) return 'name'
  if (card.price === null) return 'price'
  return 'no'
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
  #dictionary: { readonly names: readonly string[]; readonly past: readonly PastDay[]; readonly prepared: VarietyDictionary } | null = null

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
    const cards = this.#snapshot.cards.map((card) => (card.autoConfirmAt === null ? card : { ...card, autoConfirmAt: null }))
    this.#set({ phase: 'off', stateLabel: null, interim: null, tooSoon: false, cards })
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
    const extraction = module.extractVoice(result.text, { maxNumber: this.#host.maxNumber(), dictionary: this.#prepared(module) })
    const card = module.createCard({ id: `voice-${String(this.#nextCard++)}`, extraction, text: result.text, createdAt: this.#host.now(), settings })
    if (card === null) {
      this.#set({ ...label, interim: null, heard })
      return
    }
    this.#set({ ...label, interim: null, heard, cards: module.addCard(this.#snapshot.cards, card).filter(isOpen) })
  }

  // ── 판매 이력 사전 (D-I4-06) ────────────────────────────────────────

  #loadHistory(): void {
    if (this.#history.state === 'loading' || this.#history.state === 'done') return
    this.#history = { state: 'loading', past: [] }
    this.#host.fetchHistory().then(
      (past) => {
        if (this.#disposed) return
        this.#history = { state: 'done', past }
        this.#set({ historyFailed: false })
      },
      () => {
        if (this.#disposed) return
        this.#history = { state: 'failed', past: [] }
        this.#set({ historyFailed: true })
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
    this.#snapshot = next
    this.#schedule()
    for (const listener of [...this.#listeners]) listener()
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    if (this.#disposed) return
    const wake = nextWake(this.#snapshot.cards, this.#snapshot.front, this.#snapshot.now)
    const ripe = this.#ripeAuto()
    const delay = ripe === 'now' ? 0 : ripe === 'deferred' ? Math.min(wake ?? DEFERRED_POLL_MS, DEFERRED_POLL_MS) : wake
    if (delay === null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.refresh()
    }, delay)
  }
}
