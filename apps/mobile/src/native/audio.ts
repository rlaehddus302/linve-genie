// 실제 모듈은 live-audio.ts에서 연결하고, FakeNativeAudio는 명시적인 시험 주입에서만 쓴다.
/** 연결 상태 (D-APP-05): 꺼짐 · 켜는 중 · 듣는 중 · 다시 잇는 중(n번째) · 멈춤(까닭 문장) */
export type AudioState =
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'listening' }
  | { readonly kind: 'reconnecting'; readonly attempt: number }
  | { readonly kind: 'stopped'; readonly message: string }

/** 명시적인 모의 전송 시험용 결과. 실제 연결은 voice-session 전체 상태/효과를 쓴다. */
export interface VoiceReading {
  /** 읽은 상품 번호 (없으면 null) */
  readonly no: number | null
  /** 읽은 품종 (없으면 '') */
  readonly name: string
  /** 읽은 가격 (정수 원, 없으면 null) */
  readonly price: number | null
  /** 바로 등록해도 되는가 (번호·가격이 다 들렸고 없는 번호 — VOC-04 바로 등록 조건) */
  readonly instant: boolean
  /** 이미 있는 번호의 고침인가 */
  readonly correction: boolean
  /** 되읽기 글 ("15번 핑크프릴 20,000원") */
  readonly readout: string
}

export interface AudioResult {
  /** 받아쓴 글 */
  readonly text: string
  /** 조각의 말 시작·끝 (기기 시계 기준 밀리초 — 늦은 글 판단 D-APP-12) */
  readonly startMs: number
  readonly endMs: number
  /** 서버가 읽은 결과 (읽지 못했으면 null) */
  readonly reading: VoiceReading | null
}

export interface StartListeningInput {
  /** 라이브지니 음성 웹소켓 주소 (wss://…/api/voice/stream) */
  readonly wsUrl: string
  /** 예전 명시적 시험 어댑터 호환용. 실제 연결은 세션 쿠키만 쓴다. */
  readonly token?: string
  readonly origin?: string
  /** false면 마이크 없이 기존 카드 조작용 세션만 연다. */
  readonly capture?: boolean
  /** 안드로이드 고정 알림 글 */
  readonly notificationTitle?: string
  readonly notificationBody?: string
}

export interface NativeAudio {
  canResume?(): Promise<boolean>
  /** 지난번 마이크를 켜다가 앱이 꺼졌는지. 참이면 저절로 다시 켜지 않는다. */
  startWasCut?(): Promise<boolean>
  startListening(input: StartListeningInput): Promise<void>
  stopListening(): Promise<void>
  onResult(cb: (result: AudioResult) => void): () => void
  onState(cb: (state: AudioState) => void): () => void
  /** 전체 서버 읽기 세션. 가짜 legacy 결과와 별개로 실제 연결이 제공한다. */
  onSession?(cb: (message: unknown) => void): () => void
  sendSession?(message: unknown): void
  /** 재연결 hello에만 쓰는 메모리 문맥. 전송·저장하지 않는다. */
  updateSessionContext?(patch: Readonly<Record<string, unknown>>): void
  /** 지금 상태 */
  readonly state: AudioState
}

/** 가짜 마이크 모듈 — 개발·시험용. emit으로 서버 결과를, setState로 연결 상태를 흉내 낸다 */
export class FakeNativeAudio implements NativeAudio {
  state: AudioState = { kind: 'off' }
  readonly starts: StartListeningInput[] = []
  stops = 0
  readonly #results = new Set<(result: AudioResult) => void>()
  readonly #states = new Set<(state: AudioState) => void>()

  async startListening(input: StartListeningInput): Promise<void> {
    this.starts.push(input)
    this.setState({ kind: 'starting' })
    this.setState({ kind: 'listening' })
  }

  async stopListening(): Promise<void> {
    this.stops++
    this.setState({ kind: 'off' })
  }

  onResult(cb: (result: AudioResult) => void): () => void {
    this.#results.add(cb)
    return () => this.#results.delete(cb)
  }

  onState(cb: (state: AudioState) => void): () => void {
    this.#states.add(cb)
    return () => this.#states.delete(cb)
  }

  setState(state: AudioState): void {
    this.state = state
    for (const cb of [...this.#states]) cb(state)
  }

  emit(result: AudioResult): void {
    for (const cb of [...this.#results]) cb(result)
  }
}
