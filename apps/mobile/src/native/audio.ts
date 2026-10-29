// 네이티브 마이크 모듈의 약속 (APP-02, VOC-06). 실제 구현은 packages/mobile-audio(dev-device)가 낸다 — 여기에는 타입과 가짜 구현만 둔다.
// 모듈이 하는 일: 마이크 소리를 16kHz 모노 PCM16 100ms(3,200바이트) 조각으로 바꿔 라이브지니 음성 웹소켓(wsUrl, 세션 표 token)으로 보내고,
// 서버가 돌려준 글·읽은 결과(APP-05)를 onResult로, 연결 상태를 onState로 알린다. 뒤에서도(다른 앱·화면 꺼짐) 계속 돈다.
// 받아쓰기 서버 주소·토큰은 모듈에도 없다 — 라이브지니 서버의 웹소켓 하나만 안다(D-APP-04).

/** 연결 상태 (D-APP-05): 꺼짐 · 켜는 중 · 듣는 중 · 다시 잇는 중(n번째) · 멈춤(까닭 문장) */
export type AudioState =
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'listening' }
  | { readonly kind: 'reconnecting'; readonly attempt: number }
  | { readonly kind: 'stopped'; readonly message: string }

/** 서버가 흐름 안에서 읽어 돌려준 결과 (APP-05 "글과 읽은 결과를 함께") — 모양은 서버(APP1b)가 정한다. TODO(APP1b server): 확정되면 맞춘다 */
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
  /** 짧은 표 (세션으로 받은 값 — 모듈은 저장하지 않는다) */
  readonly token: string
  /** 안드로이드 고정 알림 글 */
  readonly notificationTitle?: string
  readonly notificationBody?: string
}

export interface NativeAudio {
  startListening(input: StartListeningInput): Promise<void>
  stopListening(): Promise<void>
  onResult(cb: (result: AudioResult) => void): () => void
  onState(cb: (state: AudioState) => void): () => void
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
