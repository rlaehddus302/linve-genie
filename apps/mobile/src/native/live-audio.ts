// 얇은 네이티브 전송: PCM과 전체 서버 상태만 전달하며 상품·주문을 해석하지 않는다.
import { AUDIO_HALT_MESSAGES, createRelayConnect, type AudioCapture, type RelayConnection, type WebSocketFactory } from '@livejjim/mobile-audio'
import type { AudioResult, AudioState, NativeAudio, StartListeningInput } from './audio.ts'

export class LiveNativeAudio implements NativeAudio {
  state: AudioState = { kind: 'off' }
  readonly #states = new Set<(state: AudioState) => void>()
  readonly #messages = new Set<(message: unknown) => void>()
  #connection: RelayConnection | null = null
  #input: StartListeningInput | null = null
  #timer: ReturnType<typeof setTimeout> | undefined
  #readyTimer: ReturnType<typeof setTimeout> | undefined
  #off: (() => void)[] = []
  #generation = 0
  #everReady = false
  #ready = false
  #first = true
  #failures: number[] = []
  #hello: unknown = null
  readonly capture: () => AudioCapture
  readonly factory: WebSocketFactory | undefined
  constructor(capture: () => AudioCapture, factory?: WebSocketFactory) { this.capture = capture; this.factory = factory }
  async canResume(): Promise<boolean> { try { return (await this.capture().getPermission()).granted } catch { return false } }
  onResult(_cb: (result: AudioResult) => void): () => void { return () => undefined }
  onState(cb: (state: AudioState) => void): () => void { this.#states.add(cb); return () => this.#states.delete(cb) }
  onSession(cb: (message: unknown) => void): () => void { this.#messages.add(cb); return () => this.#messages.delete(cb) }
  #state(state: AudioState): void { this.state = state; for (const cb of this.#states) cb(state) }
  updateSessionContext(patch: Readonly<Record<string, unknown>>): void {
    if (this.#hello === null || typeof this.#hello !== 'object') return
    const hello = this.#hello as { context: Record<string, unknown> }
    this.#hello = { ...hello, context: { ...hello.context, ...patch } }
  }
  sendSession(message: unknown): void {
    if (typeof message === 'object' && message !== null && 'op' in message && message.op === 'hello') this.#hello = message
    if (this.#ready) this.#connection?.send(JSON.stringify(message))
  }
  async startListening(input: StartListeningInput): Promise<void> {
    await this.stopListening()
    this.#input = input
    this.#failures = []
    this.#everReady = false
    const born = this.#generation
    this.#state({ kind: 'starting' })
    try {
      if (input.capture === false) { this.#connect(born); return }
      const capture = this.capture()
      this.#off.push(capture.addFrameListener((pcm, at) => {
        if (!this.#ready || born !== this.#generation) return
        if (this.#first) { this.#first = false; this.#connection?.send(JSON.stringify({ type: 'voice.session', op: 'capture', at })) }
        this.#connection?.send(pcm)
      }))
      this.#off.push(capture.addStateListener((state, reason) => {
        if (born !== this.#generation) return
        if (state === 'HALTED') void this.#halt(AUDIO_HALT_MESSAGES[reason ?? 'DEVICE_ERROR'])
        else if (state === 'INTERRUPTED') this.#state({ kind: 'starting' })
        else if (state === 'LISTENING' && this.#ready) this.#state({ kind: 'listening' })
      }))
      await capture.start({ sampleRate: 16000 })
      if (born !== this.#generation || capture.getState() === 'HALTED') return
      this.#connect(born)
    } catch { await this.#halt('이 빌드에서는 마이크를 쓸 수 없어요. 네이티브 앱 설치를 확인해 주세요.') }
  }
  #connect(born: number): void {
    const input = this.#input
    if (input === null || born !== this.#generation) return
    this.#ready = false
    this.#first = true
    const reconnect = (): void => {
      if (born !== this.#generation) return
      clearTimeout(this.#readyTimer)
      this.#connection?.close()
      this.#connection = null
      this.#ready = false
      const now = Date.now()
      this.#failures = [...this.#failures.filter((at) => now - at < 60000), now]
      if (this.#failures.length >= 6) { void this.#halt('듣기 멈춤 — 받아쓰기 서버에 연결하지 못했어요. 다시 켜 주세요.'); return }
      this.#state({ kind: 'reconnecting', attempt: this.#failures.length })
      this.#timer = setTimeout(() => this.#connect(born), Math.min(8000, 1000 * 2 ** (this.#failures.length - 1)))
    }
    try {
      this.#connection = createRelayConnect({ url: input.wsUrl, ...(input.origin === undefined ? {} : { headers: { Origin: input.origin } }), ...(this.factory === undefined ? {} : { factory: this.factory }) })({
        onMessage: (raw) => {
          if (born !== this.#generation || typeof raw !== 'string') return
          let message: Record<string, unknown>
          try { message = JSON.parse(raw) as Record<string, unknown> } catch { return }
          if (message === null || typeof message !== 'object') return
          if (message.type === 'ready') {
            clearTimeout(this.#readyTimer)
            this.#ready = true
            this.#everReady = true
            if (this.#hello !== null) {
              const hello = this.#hello as { context: Record<string, unknown> }
              this.#connection?.send(JSON.stringify({ ...hello, context: { ...hello.context, now: Date.now() } }))
            }
            this.#state({ kind: 'listening' })
          } else if (message.type === 'result' && message.final !== false) this.#failures = []
          else if (message.type === 'error') {
            void this.#halt(typeof message.message === 'string' ? message.message : '음성을 시작하지 못했어요. 로그인과 서버 연결을 확인해 주세요.')
          } else if (message.type === 'closing') {
            if (message.reason === 'ENDED') void this.stopListening()
            else if (message.reason === 'AUTH') void this.#halt('로그인이 끝나 음성 듣기를 멈췄어요. 다시 로그인해 주세요.')
            else if (message.reason === 'OTHER_DEVICE') void this.#halt('음성은 다른 기기에서 듣는 중이에요.')
            else if (!this.#everReady && message.reason === 'BUSY') void this.#halt('지금 받아쓰기가 바빠요. 상품은 빠른 입력으로 넣어 주세요.')
            else if (!this.#everReady && message.reason === 'NO_WORKER') void this.#halt('받아쓰기 서버가 꺼져 있어요. 상품은 빠른 입력으로 넣어 주세요.')
            else reconnect()
          }
          for (const cb of this.#messages) cb(message)
        }, onClose: reconnect, onError: reconnect,
      })
      this.#readyTimer = setTimeout(reconnect, 10000)
    } catch { reconnect() }
  }
  async #halt(message: string): Promise<void> { await this.stopListening(); this.#state({ kind: 'stopped', message }) }
  async stopListening(): Promise<void> {
    this.#generation++
    clearTimeout(this.#timer); clearTimeout(this.#readyTimer)
    this.#connection?.close(); this.#connection = null; this.#ready = false; this.#input = null
    for (const off of this.#off) off()
    this.#off = []
    try { await this.capture().stop() } catch { /* 없는 네이티브 모듈도 안전하게 끈다 */ }
    this.#state({ kind: 'off' })
  }
}
