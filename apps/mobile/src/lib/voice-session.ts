// 앱 전체의 음성 세션 (VOC-06 기기 쪽, APP-02, D-APP-05·08·12, D-V3-52 켠 채 유지).
// - 네이티브 마이크 모듈(src/native/audio.ts)이 소리를 보내고 서버가 읽은 결과(APP-05)를 돌려준다. 앱은 추출하지 않는다 — 카드·바로 등록 요청·되돌리기만.
// - 처음 켤 때 안내 창 세 줄(D-APP-08). 켜진 동안 상태 줄 "음성은 라이브지니 받아쓰기 서버로 보내져요."
// - 바로 등록(VOC-04): 서버가 "바로 등록 가능"이라 한 결과만, 이 기기의 "번호와 가격이 들리면 바로 등록" 설정이 켜져 있을 때, 말 끝에서 10초 안에
//   처리할 때 등록 요청을 보낸다. 10초 넘게 늦은 글은 카드로만(D-APP-12). 등록한 번호는 5초 동안 되돌리기(판매 종료).
// - 끊김(D-APP-05): 네이티브가 "다시 잇는 중"을 알린다. 최종 결과 없이 60초 안에 여섯 번째 끊김이면 멈추고 큰 빨간 글(듣기 멈춤)과 [다시 켜기].
// - 앱이 뒤에 있어도 JS가 돌아 결과를 바로 처리한다(APP-02) — 모아 두는 규칙은 없다.
import type { AudioResult, AudioState, NativeAudio, VoiceReading } from '../native/audio.ts'
import { fetchVoiceTicket, VoiceRefused } from '../api/voice.ts'
import { realTimer, type Timer } from './live.ts'
import { SERVICE_NAME, VOICE_STOPPED_BODY } from './words.ts'

/** 말 끝에서 이보다 늦게 처리하는 글은 카드로만 (D-APP-12) */
export const LATE_MS = 10_000
/** 바로 등록 되돌리기 시간 (D-V3-01) */
export const UNDO_MS = 5000
/** 60초 안에 이 횟수째 끊김이면 멈춤 (D-APP-05) */
export const STOP_AFTER_DISCONNECTS = 6
export const DISCONNECT_WINDOW_MS = 60_000

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
  readonly cards: readonly VoiceCard[]
  /** 바로 등록한 번호의 되돌리기 (5초) */
  readonly undo: { readonly no: number; readonly until: number } | null
  /** 서버가 거절했거나 켜지 못한 문장 */
  readonly problem: string | null
  readonly log: readonly string[]
}

export interface VoiceSessionOptions {
  readonly audio: NativeAudio
  /** 바로 등록 요청 (화면이 넘긴다 — product.register를 보내고 되돌리기용 번호를 돌려준다) */
  readonly register: (broadcastId: string, reading: VoiceReading) => Promise<void>
  /** 등록 되돌리기 (product.close) */
  readonly undoRegister: (broadcastId: string, no: number) => Promise<void>
  readonly ticket?: (broadcastId: string) => Promise<{ wsUrl: string; token: string }>
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
  #view: VoiceView = { on: false, broadcastId: null, title: '', state: OFF, askConsent: false, instant: true, heard: null, cards: [], undo: null, problem: null, log: [] }
  #consented = false
  #cardId = 1
  #disconnects: number[] = []
  #undoTimer: unknown = undefined
  #pendingOn: { readonly broadcastId: string; readonly title: string } | null = null
  #unsub: (() => void)[] = []

  constructor(options: VoiceSessionOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#timer = options.timer ?? realTimer
    this.#unsub.push(options.audio.onState((state) => this.#onState(state)))
    this.#unsub.push(options.audio.onResult((result) => void this.#onResult(result)))
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
    this.#set({ instant: on })
  }

  /** "음성 켜기" — 처음이면 안내 창을 먼저 보인다 (D-APP-08) */
  async turnOn(broadcastId: string, title: string): Promise<void> {
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

  async #start(broadcastId: string, title: string): Promise<void> {
    this.#disconnects = []
    this.#set({ on: true, broadcastId, title, problem: null, state: { kind: 'starting' } })
    try {
      const ticket = await (this.#options.ticket ?? fetchVoiceTicket)(broadcastId)
      await this.#options.audio.startListening({ wsUrl: ticket.wsUrl, token: ticket.token, notificationTitle: `${SERVICE_NAME} · 음성 듣는 중`, notificationBody: '눌러서 돌아가기' })
    } catch (error) {
      const message = error instanceof VoiceRefused ? error.message : VOICE_STOPPED_BODY
      this.#set({ on: false, state: OFF, problem: message })
    }
  }

  /** "음성 끄기" · 방송 끝 · 로그아웃 — 네이티브 마이크와 알림도 바로 멈춘다 */
  async turnOff(): Promise<void> {
    this.#pendingOn = null
    if (!this.#view.on && this.#view.state.kind === 'off') return
    this.#set({ on: false, state: OFF, askConsent: false })
    await this.#options.audio.stopListening()
  }

  /** 듣기 멈춤 뒤 [다시 켜기] */
  async retry(): Promise<void> {
    const b = this.#view.broadcastId
    if (b === null) return
    await this.#start(b, this.#view.title)
  }

  #onState(state: AudioState): void {
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
        this.#log('듣기 멈춤 — 받아쓰기 서버에 연결하지 못했어요')
        return
      }
    }
    if (state.kind === 'stopped') {
      this.#set({ on: false, state })
      return
    }
    this.#set({ state })
  }

  async #onResult(result: AudioResult): Promise<void> {
    if (!this.#view.on || this.#view.broadcastId === null) return
    // 최종 결과가 왔다: 끊김 횟수를 새로 센다 (D-APP-05 "최종 결과 없이 … 여섯 번째")
    this.#disconnects = []
    this.#options.onProcessed?.()
    const now = this.#now()
    const late = now - result.endMs > LATE_MS
    this.#set({ heard: result.text })
    const reading = result.reading
    if (reading !== null && reading.instant && this.#view.instant && !late && reading.no !== null && reading.price !== null) {
      const b = this.#view.broadcastId
      try {
        await this.#options.register(b, reading)
        this.#log(`${reading.readout} — 번호와 가격이 들려 바로 등록했어요`)
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

  /** 시험·정리 */
  dispose(): void {
    for (const off of this.#unsub) off()
    this.#unsub = []
    if (this.#undoTimer !== undefined) this.#timer.clear(this.#undoTimer)
  }
}
