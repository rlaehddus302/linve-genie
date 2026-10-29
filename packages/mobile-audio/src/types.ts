// 앱 마이크 모듈의 공용 모양 (APP-02, D-APP-06·D-APP-11·D-APP-19).
// 네이티브(Kotlin·Swift)는 소리를 잡아 16kHz 모노 PCM16 100ms 틀로만 넘기고, 웹소켓·다시 잇기·결과 처리는 웹과 같은 TS 코드가 한다.
// 이 파일에는 받아쓰기 서버 주소·토큰·비밀값이 없고 그런 것을 받는 옵션도 없다(APP-01 AC2, D-APP-04).

/** 소리 형식 (VOC-06 AC2, D-APP-06): 16kHz 모노 PCM16 little-endian, 100ms = 1,600표본 = 3,200바이트 */
export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_CHANNELS = 1
export const AUDIO_FRAME_MS = 100
export const PCM_BYTES_PER_SAMPLE = 2
/** 1ms에 32바이트 */
export const PCM_BYTES_PER_MS = (AUDIO_SAMPLE_RATE / 1_000) * PCM_BYTES_PER_SAMPLE
/** 틀 하나 = 3,200바이트 */
export const AUDIO_FRAME_BYTES = AUDIO_FRAME_MS * PCM_BYTES_PER_MS

/**
 * 소리 잡기 상태 — 꺼짐 · 켜는 중(권한·장치 준비) · 듣는 중 · 끼어들기(전화·마이크 뺏김 — 네이티브가 저절로 다시 잡는다) · 멈춤(권한 거절·장치 실패).
 * 화면 낱말은 AUDIO_CAPTURE_STATE_NAMES.
 */
export type AudioCaptureState = 'OFF' | 'STARTING' | 'LISTENING' | 'INTERRUPTED' | 'HALTED'
export const AUDIO_CAPTURE_STATES: readonly AudioCaptureState[] = Object.freeze(['OFF', 'STARTING', 'LISTENING', 'INTERRUPTED', 'HALTED'])
export const AUDIO_CAPTURE_STATE_NAMES: Readonly<Record<AudioCaptureState, string>> = Object.freeze({
  OFF: '꺼짐',
  STARTING: '켜는 중',
  LISTENING: '듣는 중',
  INTERRUPTED: '잠시 멈춤',
  HALTED: '멈춤',
})

/** 멈춘 까닭 (HALTED일 때) */
export type AudioHaltReason = 'PERMISSION_DENIED' | 'NO_MICROPHONE' | 'DEVICE_ERROR' | 'UNSUPPORTED'
export const AUDIO_HALT_REASONS: readonly AudioHaltReason[] = Object.freeze(['PERMISSION_DENIED', 'NO_MICROPHONE', 'DEVICE_ERROR', 'UNSUPPORTED'])

/** 멈춤 문장 (쉬운 한국어 — 기기별 설정 길은 앱 화면이 덧붙인다) */
export const AUDIO_HALT_MESSAGES: Readonly<Record<AudioHaltReason, string>> = Object.freeze({
  PERMISSION_DENIED: '마이크 사용이 막혀 있어요.\n설정에서 라이브지니의 마이크를 허용해 주세요.',
  NO_MICROPHONE: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.',
  DEVICE_ERROR: '마이크를 켜지 못했어요. 다시 켜 주세요.',
  UNSUPPORTED: '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.',
})

/** 마이크 권한 (Expo 권한 응답과 같은 모양). canAskAgain이 거짓이면 설정에서 바꿔야 한다 */
export interface AudioPermission {
  readonly status: 'granted' | 'denied' | 'undetermined'
  readonly granted: boolean
  readonly canAskAgain: boolean
}

/** 네이티브 start()에 넘기는 값 — 표본률은 16,000만 받는다(D-APP-06) */
export interface NativeStartOptions {
  readonly sampleRate: number
  readonly frameMs: number
  /** 안드로이드 고정 알림 (D-APP-11) — 아이폰은 쓰지 않는다 */
  readonly notificationTitle: string
  readonly notificationText: string
}

/** 네이티브 → JS 틀 사건. pcm은 base64 글(기본) 또는 Uint8Array. capturedAtMs = 이 틀 첫 표본을 잡은 기기 시각(UTC 밀리초, 벽시계) */
export interface NativeFrameEvent {
  readonly pcm: string | Uint8Array | ArrayBuffer
  readonly capturedAtMs: number
}

/** 네이티브 → JS 상태 사건 */
export interface NativeStateEvent {
  readonly state: 'LISTENING' | 'INTERRUPTED' | 'HALTED' | 'OFF'
  /** HALTED일 때 까닭 (모르는 값은 DEVICE_ERROR로 본다) */
  readonly reason?: string
}

export interface NativeEventSubscription {
  remove(): void
}

/** 네이티브 모듈(Expo Modules API, 이름 LivejjimAudio)이 JS에 보이는 모양 — 시험은 이 모양의 가짜를 넣는다 */
export interface NativeAudioModuleLike {
  start(options: NativeStartOptions): Promise<void>
  stop(): Promise<void>
  getPermission(): Promise<AudioPermission>
  requestPermission(): Promise<AudioPermission>
  addListener(eventName: 'frame', listener: (event: NativeFrameEvent) => void): NativeEventSubscription
  addListener(eventName: 'state', listener: (event: NativeStateEvent) => void): NativeEventSubscription
}

/** JS가 듣는 틀: PCM16 LE 16kHz 모노 바이트와 첫 표본의 기기 시각 */
export type FrameListener = (pcm: ArrayBuffer, capturedAtMs: number) => void
export type StateListener = (state: AudioCaptureState, reason?: AudioHaltReason) => void

export interface StartOptions {
  readonly sampleRate: 16_000
}

/** 앱이 쓰는 마이크 소리 잡기 */
export interface AudioCapture {
  /** 권한을 확인·요청하고 네이티브 소리 잡기를 켠다. 거절이면 HALTED(PERMISSION_DENIED)로 끝나고 예외는 없다. 이미 켜져 있으면 아무 일도 없다 */
  start(options: StartOptions): Promise<void>
  /** 네이티브 마이크·알림을 바로 멈춘다 (APP-02 AC2) */
  stop(): Promise<void>
  getState(): AudioCaptureState
  /** 마지막으로 멈춘 까닭 (HALTED가 아니면 undefined) */
  getHaltReason(): AudioHaltReason | undefined
  getPermission(): Promise<AudioPermission>
  requestPermission(): Promise<AudioPermission>
  addFrameListener(listener: FrameListener): () => void
  addStateListener(listener: StateListener): () => void
}
