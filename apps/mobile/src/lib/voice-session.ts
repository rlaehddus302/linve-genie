// 앱 전체의 음성 세션 (VOC-06 기기 쪽, APP-02, D-APP-05·08·12, D-V3-52 켠 채 유지).
// - 네이티브 마이크 모듈(src/native/audio.ts)이 소리를 보내고 서버가 읽은 결과(APP-05)를 돌려준다. 앱은 추출하지 않는다 — 카드·바로 등록 요청·되돌리기만.
// - 처음 켤 때 안내 창 세 줄(D-APP-08). 켜진 동안 상태 줄 "음성은 라이브지니 받아쓰기 서버로 보내져요."
// - 바로 등록(VOC-04): 서버가 "바로 등록 가능"이라 한 결과만, 이 기기의 "번호와 가격이 들리면 바로 등록" 설정이 켜져 있을 때, 말 끝에서 10초 안에
//   처리할 때 등록 요청을 보낸다. 10초 넘게 늦은 글은 카드로만(D-APP-12). 등록한 번호는 5초 동안 되돌리기(판매 종료).
// - 끊김(D-APP-05): 네이티브가 "다시 잇는 중"을 알린다. 최종 결과 없이 60초 안에 여섯 번째 끊김이면 멈추고 큰 빨간 글(듣기 멈춤)과 [다시 켜기].
// - 앱이 뒤에 있어도 JS가 돌아 결과를 바로 처리한다(APP-02) — 모아 두는 규칙은 없다.
import { fromWire, isRecord, type VoiceCommand, type VoiceEffectMessage, type VoiceConfirmation } from '@livejjim/voice-session/wire'
import type { VoiceSnapshot } from '@livejjim/web/src/voice/model.ts'
import { readVoicePreferences, writeVoicePreference, writeVoiceSetting, archiveVoice } from './voice-preferences.ts'
import type { AudioResult, AudioState, NativeAudio, VoiceReading } from '../native/audio.ts'
import { newRequestId } from '../api/client.ts'
import { fetchVoiceTicket, VoiceRefused } from '../api/voice.ts'
import { realTimer, type Timer } from './live.ts'
import { MIC_START_CUT_MESSAGE, SERVICE_NAME, VOICE_OTHER_DEVICE, VOICE_STOPPED_BODY } from './words.ts'

/** 말 끝에서 이보다 늦게 처리하는 글은 카드로만 (D-APP-12) */
export const LATE_MS = 10_000
/** 바로 등록 되돌리기 시간 (D-V3-01) */
export const UNDO_MS = 5000
/** 60초 안에 이 횟수째 끊김이면 멈춤 (D-APP-05) */
export const STOP_AFTER_DISCONNECTS = 6
export const DISCONNECT_WINDOW_MS = 60_000
/** 다른 기기가 음성 연결을 쥐고 있을 때 라이브 소리 받아 보기 연결을 다시 해 보는 간격 (D-SHARE-LIVE-01 — 3초마다 두드리지 않게) */
export const OTHER_DEVICE_RETRY_MS = 30_000
/** 화면에 남겨 두는 받아쓴 글 줄 수 — 지우지 않고 방송 내내 남긴다 (D-UX4-53, 사용자 지시 2026-11-09 "이전 문장 다 기록해두란 말임. 지우지 말고"). 휴대폰 메모리를 지키는 끝만 둔다(긴 방송 몇 시간 분량) */
export const TRANSCRIPT_LINES = 3000

export interface VoiceCard {
  readonly id: number
  readonly text: string
  readonly reading: VoiceReading | null
  /** 늦게 들린 글이라 바로 등록하지 않았다 */
  readonly late: boolean
  readonly at: number
}

export interface VoiceView {
  readonly on: boolean
  readonly broadcastId: string | null
  readonly title: string
  readonly state: AudioState
  /** 안내 창을 보여야 한다 (처음 켤 때) */
  readonly askConsent: boolean
  readonly instant: boolean
  /** 마지막으로 들린 글 */
  readonly heard: string | null
  /** 받아쓴 글 그대로 (해석 문장 없이, 오래된 것 위·새것 아래, 최근 TRANSCRIPT_LINES줄) */
  readonly transcript: readonly string[]
  /** transcript 줄마다 들린 시각(밀리초, 같은 순서·같은 길이) — 들린 말 창의 왼쪽 시각 (D-UX4-67) */
  readonly transcriptAt: readonly number[]
  readonly cards: readonly VoiceCard[]
  /** 바로 등록한 번호의 되돌리기 (5초) */
  readonly undo: { readonly no: number; readonly until: number } | null
  /** 서버가 거절했거나 켜지 못한 문장 */
  readonly problem: string | null
  readonly log: readonly string[]
  readonly remote: VoiceSnapshot | null
  readonly display: Readonly<Record<string, unknown>>
  readonly manualRetries: readonly { id: string; label: string; error: string | null; busy: boolean }[]
  readonly openProduct: string | null
  readonly priceChoice: { readonly no: number; readonly price: number } | null
}

export interface VoiceSessionOptions {
  readonly audio: NativeAudio
  /** 바로 등록 요청 (화면이 넘긴다 — product.register를 보내고 되돌리기용 번호를 돌려준다) */
  readonly register: (broadcastId: string, reading: VoiceReading) => Promise<void>
  /** 등록 되돌리기 (product.close) */
  readonly undoRegister: (broadcastId: string, no: number) => Promise<void>
  readonly deviceId?: string
  readonly effect?: (broadcastId: string, method: string, args: readonly unknown[], session: VoiceSession, writeCheck?: (firstAttempt: boolean) => string | null) => Promise<unknown>
  readonly ticket?: (broadcastId: string) => Promise<{ wsUrl: string; token?: string; origin?: string }>
  readonly now?: () => number
  readonly timer?: Timer
  /** 뒤에 있는 동안 결과를 처리했다고 알린다 (자리를 비운 동안 음성 n개) */
  readonly onProcessed?: () => void
}

const OFF: AudioState = { kind: 'off' }

export class VoiceSession {
  readonly #options: VoiceSessionOptions
  readonly #now: () => number
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #view: VoiceView = { on: false, broadcastId: null, title: '', state: OFF, askConsent: false, instant: true, heard: null, transcript: [], transcriptAt: [], cards: [], undo: null, problem: null, log: [], remote: null, display: {}, manualRetries: [], openProduct: null, priceChoice: null }
  #contextTimer: ReturnType<typeof setInterval> | undefined
  #generation = 0
  #connection = 0
  #serverSession: string | null = null
  #resumeToken: string | null = null
  #controlOnly = false
  #readyForCommands = false
  #commandQueue: { method: VoiceCommand; args: readonly unknown[] }[] = []
  #idleTimer: ReturnType<typeof setTimeout> | undefined
  #effectsPending = 0
  #consumed = new Set<string>()
  #pendingCards = new Set<string>()
  #manual = new Map<string, { b: string; cardId: string; args: readonly unknown[]; label: string; busy: boolean; error: string | null; generation: number }>()
  #effects = new Set<number>()
  #effectChain: Promise<void> = Promise.resolve()
  #priceResolve: ((choice: 'NEW_ONLY' | 'UNPAID_CLAIMS' | null) => void) | null = null
  #manualOff = false
  #consented = false
  #cardId = 1
  #disconnects: number[] = []
  #undoTimer: unknown = undefined
  #pendingOn: { readonly broadcastId: string; readonly title: string } | null = null
  #desiredInstant: boolean | null = null
  #settingsRevision = 0
  #settingsWrite: Promise<void> = Promise.resolve()
  #unsub: (() => void)[] = []
  /** 방송 소리로 듣기(D-LV1-03) 중인 방송 — 마이크가 꺼져 있으면 조작 전용 연결을 열어 둔다 */
  #streamHold: { readonly broadcastId: string; readonly title: string } | null = null
  #streamRetry: ReturnType<typeof setTimeout> | undefined

  constructor(options: VoiceSessionOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#timer = options.timer ?? realTimer
    this.#unsub.push(options.audio.onState((state) => this.#onState(state)))
    this.#unsub.push(options.audio.onResult((result) => void this.#onResult(result)))
    if (options.audio.onSession) this.#unsub.push(options.audio.onSession((message) => this.#message(message)))
    if (options.audio.onSession) void readVoicePreferences().then((preferences) => {
      if (this.#settingsRevision === 0 && isRecord(preferences.settings)) this.#set({ instant: preferences.settings['voice.autoRegister'] !== false })
    })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getView = (): VoiceView => this.#view

  #set(patch: Partial<VoiceView>): void {
    this.#view = { ...this.#view, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  #log(line: string): void {
    this.#set({ log: [line, ...this.#view.log].slice(0, 50) })
  }

  setInstant(on: boolean): void {
    this.#settingsRevision++
    this.#desiredInstant = on
    const remote = this.#view.remote
    this.#set({ instant: on, ...(remote === null ? {} : { remote: { ...remote, instant: on, settings: remote.settings === null ? null : { ...remote.settings, 'voice.autoRegister': on } } }) })
    this.#settingsWrite = writeVoiceSetting('voice.autoRegister', on).catch(() => {
      this.#set({ problem: '음성 설정을 기기에 저장하지 못했어요. 다시 눌러 주세요.' })
    })
    if (this.#view.on || this.#controlOnly) this.command('setInstant', [on])
  }

  /** "음성 켜기" — 처음이면 안내 창을 먼저 보인다 (D-APP-08) */
  async resumeIfConsented(broadcastId: string, title: string): Promise<void> {
    if (this.#view.on || this.#manualOff || this.#view.state.kind === 'stopped') return
    const prefs = await readVoicePreferences()
    if (prefs.consent !== true || !await this.#options.audio.canResume?.()) return
    if (await this.#options.audio.startWasCut?.()) { this.#set({ problem: MIC_START_CUT_MESSAGE }); return }
    if (!this.#view.on && !this.#manualOff) await this.turnOn(broadcastId, title)
  }

  /** 마이크 권한이 있는지 — 이 기기 모듈이 알려 주지 않으면 null (소리 듣기 판의 "마이크 권한이 없어", D-RETRO-70) */
  async micAllowed(): Promise<boolean | null> {
    const ask = this.#options.audio.canResume
    if (ask === undefined) return null
    try { return await ask.call(this.#options.audio) } catch { return null }
  }

  /**
   * 소리 듣기가 "휴대폰 마이크"로 바뀌었다 (D-RETRO-70 — 다른 기기에서 바꿨을 때): 라이브 소리로 듣느라 꺼 둔 표시를 지우고,
   * 이 기기가 예전에 안내를 받았고 권한이 있을 때만 켠다. 안내 창은 띄우지 않는다(띄우는 것은 이 기기에서 직접 고른 turnOn)
   */
  async preferMic(broadcastId: string, title: string): Promise<void> {
    this.#manualOff = false
    await this.resumeIfConsented(broadcastId, title)
  }

  async turnOn(broadcastId: string, title: string): Promise<void> {
    this.#manualOff = false
    if (!this.#consented && this.#options.audio.onSession) this.#consented = (await readVoicePreferences()).consent === true
    if (!this.#consented) {
      this.#pendingOn = { broadcastId, title }
      this.#set({ askConsent: true, problem: null })
      return
    }
    await this.#start(broadcastId, title)
  }

  /** 안내 창의 [알겠어요] */
  async acceptConsent(): Promise<void> {
    this.#consented = true
    try { await writeVoicePreference('consent', true) } catch { this.#set({ problem: '동의를 기기에 저장하지 못했어요. 다음에 켤 때 다시 안내할게요.' }) }
    const pending = this.#pendingOn
    this.#pendingOn = null
    this.#set({ askConsent: false })
    if (pending !== null) await this.#start(pending.broadcastId, pending.title)
  }

  /** 안내 창의 [안 켤래요] */
  declineConsent(): void {
    this.#pendingOn = null
    this.#set({ askConsent: false })
  }

  /**
   * 방송 소리로 듣기 (VOC-08, D-LV1-03·06): 서버가 방송 소리를 받아쓴 글은 이 기기의 마이크 없는 조작 전용 연결의 읽기로 온다.
   * 켜져 있는 동안 그 연결을 닫지 않는다(잠깐 쉬기 없음). 마이크를 켜면 마이크 흐름이 대신하고, 끄면 다시 조작 전용으로 연다.
   */
  /** 자동 쓰기를 받아도 되는 듣는 중 — 마이크가 듣거나, 방송 소리로 듣는 조작 전용 연결이 이어져 있다 */
  #hearing(): boolean {
    if (this.#view.on) return this.#view.state.kind === 'listening'
    return this.#controlOnly && this.#streamHold !== null && this.#options.audio.state.kind === 'listening'
  }

  holdStream(broadcastId: string, title: string, on: boolean): void {
    if (!on) {
      if (this.#streamHold === null) return
      this.#streamHold = null
      clearTimeout(this.#streamRetry)
      this.#scheduleIdle()
      return
    }
    this.#streamHold = { broadcastId, title }
    if (this.#view.on || (this.#controlOnly && this.#view.broadcastId === broadcastId)) return
    void this.#start(broadcastId, title, true)
  }

  async #start(broadcastId: string, title: string, commandsOnly = false): Promise<void> {
    clearTimeout(this.#idleTimer)
    clearInterval(this.#contextTimer)
    const sameBroadcast = this.#view.broadcastId === broadcastId
    if (!sameBroadcast) this.#resumeToken = null
    const born = commandsOnly ? this.#generation : ++this.#generation
    this.#controlOnly = commandsOnly
    this.#readyForCommands = false
    this.#effectChain = Promise.resolve()
    this.#serverSession = null
    this.#disconnects = []
    this.#set({ on: !commandsOnly, broadcastId, title, problem: null, ...(sameBroadcast ? {} : { remote: null, display: {} }), state: commandsOnly ? OFF : { kind: 'starting' } })
    try {
      const ticket = await (this.#options.ticket ?? ((b) => fetchVoiceTicket(b, this.#options.deviceId)))(broadcastId)
      await this.#settingsWrite
      const preferences = await readVoicePreferences()
      if (born !== this.#generation) return
      this.#options.audio.sendSession?.({ type: 'voice.session', op: 'hello', context: { ...preferences, now: this.#now(), dialogOpen: false, smsAutoAllowed: !commandsOnly, consent: true, listening: !commandsOnly || this.#streamHold !== null, ...(this.#resumeToken === null ? {} : { resumeToken: this.#resumeToken }) } })
      const url = new URL(ticket.wsUrl)
      if (commandsOnly) url.searchParams.set('capture', 'false')
      await this.#options.audio.startListening({ wsUrl: url.toString(), capture: !commandsOnly, ...(ticket.token === undefined ? {} : { token: ticket.token }), ...(ticket.origin === undefined ? {} : { origin: ticket.origin }), notificationTitle: `${SERVICE_NAME} · 음성 인식 중`, notificationBody: '눌러서 돌아가기' })
      if (born !== this.#generation || this.#options.audio.state.kind === 'stopped') return
      if (this.#options.audio.onSession && !commandsOnly) {
        clearInterval(this.#contextTimer)
        this.#contextTimer = setInterval(() => this.#options.audio.sendSession?.({ type: 'voice.session', op: 'context', context: { now: this.#now(), dialogOpen: this.#view.priceChoice !== null, smsAutoAllowed: !this.#controlOnly } }), 500)
      }
    } catch (error) {
      const message = error instanceof VoiceRefused ? error.message : VOICE_STOPPED_BODY
      this.#set({ on: false, state: OFF, problem: message })
    }
  }

  /** "음성 끄기" · 방송 끝 · 로그아웃 — 네이티브 마이크와 알림도 바로 멈춘다 */
  async turnOff(): Promise<void> {
    this.#manualOff = true
    this.#pendingOn = null
    this.#generation++
    for (const item of this.#manual.values()) item.generation = this.#generation
    this.#controlOnly = false
    this.#readyForCommands = false
    this.#commandQueue = []
    clearTimeout(this.#idleTimer)
    this.#pendingCards.clear()
    clearInterval(this.#contextTimer)
    this.#priceResolve?.(null)
    this.#options.audio.sendSession?.({ type: 'voice.session', op: 'command', method: 'turnOff', args: [] })
    this.#set({ on: false, state: OFF, askConsent: false })
    await this.#options.audio.stopListening()
    const hold = this.#streamHold
    if (hold !== null) void this.#start(hold.broadcastId, hold.title, true)
  }

  /** 듣기 멈춤 뒤 [다시 켜기] */
  async retry(): Promise<void> {
    const b = this.#view.broadcastId
    if (b === null) return
    await this.#start(b, this.#view.title)
  }

  #onState(state: AudioState): void {
    if (state.kind !== 'listening') this.#readyForCommands = false
    // 다른 기기가 이 라이브의 음성 연결을 쥐고 있다 (D-SHARE-LIVE-01 — 마이크는 먼저 켠 기기 하나만): 빨간 멈춤이 아니라 조용히 끈다
    const otherDevice = state.kind === 'stopped' && state.message === VOICE_OTHER_DEVICE
    if (this.#controlOnly) {
      if (state.kind === 'stopped') {
        this.#controlOnly = false; this.#commandQueue = []; clearInterval(this.#contextTimer)
        if (!otherDevice) this.#set({ problem: state.message })
        clearTimeout(this.#streamRetry)
        if (this.#streamHold !== null) this.#streamRetry = setTimeout(() => {
          const hold = this.#streamHold
          if (hold !== null && !this.#view.on && !this.#controlOnly) void this.#start(hold.broadcastId, hold.title, true)
        }, otherDevice ? OTHER_DEVICE_RETRY_MS : 3000)
      }
      return
    }
    if (!this.#view.on) {
      if (state.kind === 'off') this.#set({ state })
      return
    }
    if (state.kind === 'reconnecting') {
      const now = this.#now()
      this.#disconnects = [...this.#disconnects.filter((at) => now - at < DISCONNECT_WINDOW_MS), now]
      if (this.#disconnects.length >= STOP_AFTER_DISCONNECTS) {
        void this.#options.audio.stopListening()
        this.#set({ on: false, state: { kind: 'stopped', message: VOICE_STOPPED_BODY } })
        this.#log('음성 인식 멈춤 — 받아쓰기 서버에 연결하지 못했어요')
        return
      }
    }
    if (state.kind === 'stopped') {
      clearInterval(this.#contextTimer)
      // 다른 기기의 마이크가 듣는 중: 이 기기 마이크는 꺼진 것으로 — 화면은 "다른 기기의 마이크로 듣고 있어요" (D-SHARE-LIVE-01)
      if (otherDevice) { this.#set({ on: false, state: OFF, problem: null }); this.#log(VOICE_OTHER_DEVICE); return }
      this.#set({ on: false, state })
      return
    }
    this.#set({ state })
  }

  /** 받아쓴 한 줄을 들린 시각과 함께 덧붙인다 (최근 TRANSCRIPT_LINES줄) */
  #heardLine(text: string, at: number): Pick<VoiceView, 'transcript' | 'transcriptAt'> {
    return { transcript: [...this.#view.transcript, text].slice(-TRANSCRIPT_LINES), transcriptAt: [...this.#view.transcriptAt, at].slice(-TRANSCRIPT_LINES) }
  }

  async #onResult(result: AudioResult): Promise<void> {
    if (!this.#view.on || this.#view.broadcastId === null) return
    // 최종 결과가 왔다: 끊김 횟수를 새로 센다 (D-APP-05 "최종 결과 없이 … 여섯 번째")
    this.#disconnects = []
    this.#options.onProcessed?.()
    const now = this.#now()
    const late = !Number.isFinite(result.endMs) || result.endMs > now || result.endMs < result.startMs || now - result.endMs > LATE_MS
    this.#set({ heard: result.text, ...this.#heardLine(result.text, now) })
    const reading = result.reading
    if (reading !== null && reading.instant && this.#view.instant && !late && reading.no !== null && reading.price !== null) {
      const b = this.#view.broadcastId
      try {
        await this.#options.register(b, reading)
        this.#log(`${reading.readout} — 번호와 가격을 인식해 바로 등록했어요`)
        this.#setUndo(reading.no)
      } catch {
        this.#addCard(result, false)
      }
      return
    }
    if (reading === null && result.text.trim() === '') return
    this.#addCard(result, late)
  }

  #addCard(result: AudioResult, late: boolean): void {
    const card: VoiceCard = { id: this.#cardId++, text: result.text, reading: result.reading, late, at: this.#now() }
    this.#set({ cards: [card, ...this.#view.cards].slice(0, 20) })
  }

  #setUndo(no: number): void {
    if (this.#undoTimer !== undefined) this.#timer.clear(this.#undoTimer)
    this.#set({ undo: { no, until: this.#now() + UNDO_MS } })
    this.#undoTimer = this.#timer.set(() => {
      this.#undoTimer = undefined
      this.#set({ undo: null })
    }, UNDO_MS)
  }

  /** 바로 등록 되돌리기 (5초 안) */
  async undo(): Promise<void> {
    const undo = this.#view.undo
    const b = this.#view.broadcastId
    if (undo === null || b === null) return
    if (this.#undoTimer !== undefined) this.#timer.clear(this.#undoTimer)
    this.#undoTimer = undefined
    this.#set({ undo: null })
    await this.#options.undoRegister(b, undo.no)
    this.#log(`${String(undo.no)}번 등록을 되돌렸어요`)
  }

  /** 카드의 [등록] */
  async registerCard(id: number): Promise<void> {
    const card = this.#view.cards.find((item) => item.id === id)
    const b = this.#view.broadcastId
    if (card === undefined || card.reading === null || b === null) return
    await this.#options.register(b, card.reading)
    this.dismissCard(id)
    this.#log(`${card.reading.readout} — 카드에서 등록했어요`)
  }

  dismissCard(id: number): void {
    this.#set({ cards: this.#view.cards.filter((card) => card.id !== id) })
  }

  operationKey(): number { return this.#generation }
  isOperationCurrent(key: number, b: string): boolean { return key === this.#generation && this.#view.broadcastId === b }
  command(method: VoiceCommand, args: readonly unknown[] = []): void {
    if (['editForm', 'openForm', 'chooseCandidate', 'fixCardOffer', 'submitMissed'].includes(method) && this.#view.display.confirmations instanceof Map) this.#view.display.confirmations.delete(String(args[0]))
    if (this.#options.audio.onSession && !this.#readyForCommands) {
      if (['turnOff', 'refresh', 'noteRegistered'].includes(method)) return
      if (!this.#view.on && !this.#controlOnly && this.#resumeToken !== null && this.#view.broadcastId !== null) {
        this.#commandQueue.push({ method, args })
        void this.#start(this.#view.broadcastId, this.#view.title, true)
        return
      }
      if (this.#controlOnly || this.#view.on && this.#options.audio.state.kind === 'starting') { this.#commandQueue.push({ method, args }); return }
      if (!['take', 'learnFrom', 'noteVoiceRegistered', 'restore', 'rejectNumber'].includes(method)) this.#set({ problem: '음성 연결을 확인한 뒤 다시 눌러 주세요.' })
      return
    }
    this.#options.audio.sendSession?.({ type: 'voice.session', op: 'command', method, args })
    this.#scheduleIdle()
  }
  /** 서버가 검증한 현재 판의 DTO만 한 번 소비한다. 오프라인 재전송도 같은 요청 번호다. */
  async confirmCard(id: string): Promise<void> {
    const remote = this.#view.remote
    const card = remote?.cards.find((value) => value.id === id)
    if (!remote || !card || this.#pendingCards.has(id) || [...this.#manual.values()].some((item) => item.cardId === id && item.generation === this.#generation)) return
    const dto = this.#view.display.confirmations instanceof Map ? this.#view.display.confirmations.get(id) as VoiceConfirmation | undefined : undefined
    if (!dto || dto.sessionId !== this.#serverSession || dto.broadcastId !== this.#view.broadcastId || dto.device !== this.#options.deviceId || dto.cardId !== id || !Number.isSafeInteger(dto.cardVersion) || remote?.forms.has(id)) {
      if (this.#options.audio.state.kind === 'listening') this.command('confirm', [id, 'click'])
      else this.#set({ problem: '음성 연결을 확인한 뒤 다시 눌러 주세요. 고친 칸은 서버에서 확인해야 해요.' })
      return
    }
    const key = `${dto.sessionId}:${id}:${dto.cardVersion}`
    if (this.#consumed.has(key)) return
    this.#consumed.add(key); this.#pendingCards.add(id)
    this.#set({ remote: { ...remote, cards: remote.cards.filter((value) => value.id !== id) } })
    this.command('take', [id]); this.command('learnFrom', [card, dto.registration.name])
    const masked = this.#view.display.masked instanceof Map ? this.#view.display.masked.get(card.text) : null
    this.#manual.set(key, { b: dto.broadcastId, cardId: id, args: [card, dto.registration, 'click', masked ?? null, newRequestId()], label: `${dto.registration.no}번 ${dto.registration.name}`, busy: false, error: null, generation: this.#generation })
    await this.retryManualRegistration(key)
  }
  async retryManualRegistration(key: string): Promise<void> {
    const pending = this.#manual.get(key)
    if (!pending || pending.busy || pending.generation !== this.#generation) return
    pending.busy = true; pending.error = null; this.#manualView()
    let result: unknown
    try { result = await this.#options.effect?.(pending.b, 'register', pending.args, this) }
    catch { result = { kind: 'failed', message: '보내지 못했어요. 연결을 확인하고 다시 보내 주세요.' } }
    if (pending.generation !== this.#generation) return
    if (isRecord(result) && result.kind === 'failed') { pending.busy = false; pending.error = typeof result.message === 'string' ? result.message : '등록하지 못했어요.' }
    else { this.#manual.delete(key); this.#pendingCards.delete(pending.cardId) }
    this.#manualView()
  }
  #manualView(): void { this.#set({ manualRetries: [...this.#manual].map(([id, item]) => ({ id, label: item.label, error: item.error, busy: item.busy })) }) }
  #scheduleIdle(): void {
    clearTimeout(this.#idleTimer)
    if (!this.#controlOnly || this.#effectsPending > 0 || this.#commandQueue.length > 0 || this.#streamHold !== null) return
    this.#idleTimer = setTimeout(() => {
      if (!this.#controlOnly || this.#effectsPending > 0 || this.#streamHold !== null) return
      this.#controlOnly = false; this.#readyForCommands = false
      clearInterval(this.#contextTimer)
      void this.#options.audio.stopListening()
    }, 1500)
  }
  async shutdown(): Promise<void> {
    this.#streamHold = null
    clearTimeout(this.#streamRetry)
    await this.turnOff()
    this.#resumeToken = null; this.#serverSession = null; this.#options.audio.updateSessionContext?.({ resumeToken: undefined }); this.#manual.clear(); this.#consumed.clear()
    this.#set({ broadcastId: null, remote: null, display: {}, cards: [], log: [], heard: null, transcript: [], transcriptAt: [], undo: null, manualRetries: [] })
  }
  showProduct(key: string): void { this.#set({ openProduct: key }) }
  clearProduct(): void { this.#set({ openProduct: null }) }
  async choosePriceScope(no: number, price: number): Promise<'NEW_ONLY' | 'UNPAID_CLAIMS' | null> {
    this.#priceResolve?.(null)
    this.#set({ priceChoice: { no, price } })
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#priceResolve?.(null), 25000)
      this.#priceResolve = (value) => { clearTimeout(timer); this.#priceResolve = null; this.#set({ priceChoice: null }); resolve(value) }
    })
  }
  resolvePriceScope(value: 'NEW_ONLY' | 'UNPAID_CLAIMS' | null): void { this.#priceResolve?.(value) }
  noteRegistered(no: number): void { this.#setUndo(no); this.#options.onProcessed?.() }
  #message(message: unknown): void {
    if ((!this.#view.on && !this.#controlOnly) || !isRecord(message)) return
    if (message.type === 'result') {
      this.#disconnects = []
      if (typeof message.text === 'string' && message.text.trim() !== '') this.#set(this.#heardLine(message.text.trim(), this.#now()))
      return
    }
    if (message.type === 'ready') { this.#connection++; this.#effects.clear(); this.#readyForCommands = false; this.#serverSession = null; this.#pendingCards.clear(); if (this.#view.display.confirmations instanceof Map) this.#view.display.confirmations.clear(); return }
    if (message.type === 'voice.state') {
      if (typeof message.sessionId !== 'string') return
      if (this.#serverSession !== null && this.#serverSession !== message.sessionId) { this.#connection++; this.#effects.clear(); this.#pendingCards.clear() }
      this.#serverSession = message.sessionId
      if (message.sessionReady === false) return
      if (typeof message.resumeToken === 'string') this.#resumeToken = message.resumeToken === '' ? null : message.resumeToken
      this.#readyForCommands = true
      const snapshot = fromWire(message.snapshot)
      const display = fromWire(message.display)
      if (!isRecord(snapshot) || !Array.isArray(snapshot.cards) || !(snapshot.forms instanceof Map)) return
      const state = snapshot as unknown as VoiceSnapshot
      if (state.instant === this.#desiredInstant) this.#desiredInstant = null
      const instant = this.#desiredInstant ?? state.instant
      this.#options.audio.updateSessionContext?.({ settings: { ...state.settings, 'voice.autoRegister': instant }, smsSettings: state.smsSettings, resumeToken: this.#resumeToken ?? undefined })
      for (const id of this.#pendingCards) if (!state.cards.some((card) => card.id === id) || state.forms.has(id)) this.#pendingCards.delete(id)
      const remote = { ...state, instant, cards: state.cards.filter((card) => !this.#pendingCards.has(card.id)) }
      this.#set({ remote, display: isRecord(display) ? display : {}, instant: remote.instant, heard: remote.readout?.text ?? remote.hearing?.collected ?? remote.interim, problem: message.resumeToken === '' ? '대기 내용이 많아 다시 연결할 수 없어요. 음성을 끄기 전에 남은 카드와 문자찜을 확인해 주세요.' : remote.error })
      for (const item of this.#commandQueue.splice(0)) this.command(item.method, item.args)
      this.#scheduleIdle()
    } else if (message.type === 'voice.error' && typeof message.message === 'string') {
      const hold = this.#streamHold
      if (message.code === 'RESUME_INVALID' && !this.#view.on && hold !== null) {
        // 방송 소리로 듣는 중(마이크 없음): 서버가 다시 켜져 옛 대기 내용을 잇지 못한 것뿐이다 — 새 읽기로 바로 다시 연다.
        // 화면의 카드는 그대로 두고, 듣기 멈춤으로 막지 않는다 (D-LIVETEST-06)
        this.#resumeToken = null
        this.#options.audio.updateSessionContext?.({ resumeToken: undefined })
        void this.#start(hold.broadcastId, hold.title, true)
        return
      }
      this.#set({ problem: message.message })
      if (message.code === 'RESUME_INVALID') {
        this.#resumeToken = null
        this.#options.audio.updateSessionContext?.({ resumeToken: undefined })
        const stopped = this.#generation + 1
        const note = message.message
        // 닫힌 서버 읽기에 마이크를 계속 보내지 않는다. 보이는 대기 카드는
        // 남겨 두고 명시적으로 다시 켤 때 새 세션을 시작한다.
        void this.turnOff().finally(() => {
          if (this.#generation === stopped) this.#set({ state: { kind: 'stopped', message: note }, problem: note })
        })
      }
    }
    else if (message.type === 'voice.effect' && message.sessionId === this.#serverSession && typeof message.id === 'number' && !this.#effects.has(message.id)) {
      this.#effects.add(message.id)
      this.#effectsPending++
      clearTimeout(this.#idleTimer)
      const born = this.#generation; const connection = this.#connection
      this.#effectChain = this.#effectChain.then(async () => {
        if (born !== this.#generation || connection !== this.#connection) return
        await this.#effect(message as unknown as VoiceEffectMessage, born, connection)
      }).catch(() => undefined).finally(() => { this.#effectsPending--; this.#scheduleIdle() })
    } else if (message.type === 'closing' && message.reason === 'ENDED') void this.turnOff()
  }
  async #effect(message: VoiceEffectMessage, born: number, connection: number): Promise<void> {
    const args = fromWire(message.args)
    const b = this.#view.broadcastId
    if (!Array.isArray(args) || b === null) return
    let value: unknown = null
    try {
      if (message.automatic === true && ['register', 'writeSms', 'fixRecent', 'renumber', 'undoRecent'].includes(message.method)) {
        const end = message.spokenEndAt
        if (!Number.isFinite(end) || typeof end !== 'number' || this.#now() - end > LATE_MS || end > this.#now() || (args[2] === 'instant' && !this.#view.instant)) {
          const note = '늦게 인식한 말이에요. 확인하고 다시 눌러 주세요.'
          if (message.method === 'register') this.command('restore', [args[0], { touched: true, note }])
          value = message.method === 'renumber' || message.method === 'undoRecent' ? false : { kind: 'failed', message: note }
          return
        }
      }
      switch (message.method) {
        case 'writeConsent': await writeVoicePreference('consent', true); break
        case 'writeSettings': {
          const settings = isRecord(args[0]) ? args[0] : {}
          await this.#settingsWrite
          await writeVoicePreference('settings', { ...settings, 'voice.autoRegister': this.#view.instant })
          break
        }
        case 'writeSmsSettings': await writeVoicePreference('smsSettings', args[0]); break
        case 'archiveChunk': case 'archiveGap': await archiveVoice(message.method, args[0]); break
        case 'voiceOff': if (!this.#controlOnly) await this.turnOff(); break
        case 'focusQuick': break
        case 'openProduct': this.showProduct(String(args[0])); break
        default: value = await this.#options.effect?.(b, message.method, args, this, (firstAttempt) => {
          if (born !== this.#generation || connection !== this.#connection || (message.automatic === true && (!this.#readyForCommands || !this.#hearing()))) return '음성 연결이 바뀌어 보내지 않았어요. 확인하고 다시 눌러 주세요.'
          if (firstAttempt && message.automatic === true) {
            const end = message.spokenEndAt
            if (typeof end !== 'number' || !Number.isFinite(end) || this.#now() - end > LATE_MS || end > this.#now() || (message.method === 'register' && args[2] === 'instant' && !this.#view.instant)) return '늦게 인식한 말이에요. 확인하고 다시 눌러 주세요.'
          }
          return null
        })
      }
    } catch (error) {
      const problem = error instanceof Error ? error.message : '처리하지 못했어요. 다시 확인해 주세요.'
      if (born === this.#generation && connection === this.#connection) {
        this.#set({ problem })
        if (message.method === 'register') this.command('restore', [args[0], { touched: true, note: problem }])
      }
    }
    finally { if (born === this.#generation && connection === this.#connection) this.#options.audio.sendSession?.({ type: 'voice.session', op: 'effectResult', id: message.id, value: value ?? null }) }
  }

  /** 시험·정리 */
  dispose(): void {
    clearInterval(this.#contextTimer)
    clearTimeout(this.#idleTimer)
    this.#priceResolve?.(null)
    for (const off of this.#unsub) off()
    this.#unsub = []
    if (this.#undoTimer !== undefined) this.#timer.clear(this.#undoTimer)
  }
}
