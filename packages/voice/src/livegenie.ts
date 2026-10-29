// 라이브지니 받아쓰기 엔진 (VOC-06 기기 쪽, D-APP-04·D-APP-05·D-APP-12, D-APP1-01·D-APP1-03·D-APP1-08) — cloud.ts 골격 위 새 공급자.
// 기기는 라이브지니 서버의 음성 웹소켓 하나만 안다: 부르는 쪽(화면)이 넘긴 연결 함수로만 연다(주소·인증은 화면과 로그인 세션 몫).
// 이 파일에는 받아쓰기 서버 주소·일꾼 쪽 경로·비밀값이 없고 그런 것을 받는 옵션도 없다(VOC-06 AC3). 만들기만 해서는 연결하지 않는다(VOC-05).
//
// 약속 (acceptance "약속" 절): 기기 → 서버 이진 틀 = PCM16 LE 16kHz 모노(보통 3,200바이트).
// 서버 → 기기 글 틀: {"type":"ready"} · {"type":"result","text","startMs","endMs"} · {"type":"closing","reason"} 뒤 닫음.
//  - ready 전에는 소리를 보내지 않는다(서버도 버린다). 결과는 최종만 — 중간 결과 없음.
//  - 처음 켜고 한 번도 ready를 받지 못한 채 온 BUSY·NO_WORKER = 그 문장으로 멈춤. ready를 받은 뒤의 끊김·WORKER_LOST·RATE·BUSY·NO_WORKER·모르는 까닭
//    ·까닭 없는 닫힘 = 다시 잇기(1·2·4·8초, 최종 결과 없이 60초 안 여섯 번째면 "듣기 멈춤"). 첫 켜기의 연결 실패(서버에 닿지 않음)도 다시 잇기.
//  - OTHER_DEVICE·AUTH = 언제든 멈춤(다시 잇지 않음). ENDED = 음성 끔(새 문장 없음, D-V3-52).
//  - 끊긴 동안 넣은 소리는 보내지 않고 버린다. 다시 이은 흐름의 시각은 그 흐름의 첫 소리부터 다시 잰다.
// 말 끝 시각 = 그 흐름(연결)에서 보낸 첫 소리를 잡은 기기 시각 + 결과의 endMs. 처리 시각이 말 끝보다 10,000ms 넘게 뒤면 늦은 글(isLateSpeech).
import { BaseSpeechEngine, Listeners, RestartLimiter, type SpeechResult, type SpeechState } from './speech.ts'
import type { RelayConnect, RelayConnection, RelayHandlers } from './cloud.ts'
import type { SpeechTimers } from './web-speech.ts'
import { PCM_BYTES_PER_MS } from './pcm16.ts'

/** 기기 음성 웹소켓 경로 (라이브지니 서버) */
export const VOICE_STREAM_PATH = '/api/voice/stream'
/** 기기 표지: 영숫자 8~64자 (켤 때 화면이 만든 무작위 글, 메모리에만 — D-APP1-04) */
export const DEVICE_TAG_PATTERN = /^[A-Za-z0-9]{8,64}$/
/** 서버가 받는 이진 틀 하나·1초 창 한도 (D-APP1-05) */
export const VOICE_FRAME_MAX_BYTES = 65_536
/** 서버가 받는 글 틀 한도 */
export const VOICE_TEXT_FRAME_MAX_BYTES = 1_024
/** 서버가 넘기는 결과 글 한도 (D-APP1-14) */
export const VOICE_RESULT_TEXT_MAX = 2_000
/** 늦은 글 문턱 (D-APP-12): 말 끝에서 이보다 "넘게" 지나 처리하면 바로 등록하지 않고 카드로 */
export const LATE_TEXT_MS = 10_000
/** 말 끝이 처리 시각보다 이만큼 넘게 앞(미래)이면 셈할 수 없음 = 늦은 글로 본다 (시계·값이 이상함) */
export const FUTURE_TEXT_SLACK_MS = 2_000
/** 다시 잇기 간격 (D-APP-05): 1·2·4·8초, 가장 길게 8초 */
export const RECONNECT_DELAYS_MS: readonly number[] = Object.freeze([1_000, 2_000, 4_000, 8_000])

export const LIVEGENIE_CLOSE_REASONS = Object.freeze(['OTHER_DEVICE', 'BUSY', 'NO_WORKER', 'ENDED', 'AUTH', 'RATE', 'WORKER_LOST'] as const)
export type LiveGenieCloseReason = (typeof LIVEGENIE_CLOSE_REASONS)[number]

/** 상태 줄 이름 (라이브지니 받아쓰기) */
export const LIVEGENIE_STATE_LABELS: Readonly<Record<SpeechState, string>> = Object.freeze({
  OFF: '꺼짐',
  LISTENING: '듣는 중',
  RESTARTING: '다시 잇는 중',
  HALTED: '듣기 멈춤',
})
/** 켜져 있는 동안 상태 줄 (VOC-06 고지) */
export const LIVEGENIE_NOTICE = '음성은 라이브지니 받아쓰기 서버로 보내져요.'
/** 결과가 오기 전 큰 글자 칸 (VOC-06 결과) */
export const LIVEGENIE_LISTENING_TEXT = '듣는 중…'
/** 다시 잇기 한도에 걸려 멈춤 (D-APP-05) — 까닭 종류는 CONNECTION_FAILED, 문장은 이것 */
export const LIVEGENIE_CONNECTION_FAILED_MESSAGE = '듣기 멈춤 · 받아쓰기 서버에 연결하지 못했어요. 상품은 빠른 입력으로 넣어 주세요.'
/** 음성이 안 되는 기기 (D-APP-18) — 까닭 종류는 UNSUPPORTED, PC·크롬으로 보내는 말 없음 */
export const LIVEGENIE_UNSUPPORTED_MESSAGE = '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.'
/** 첫 안내 창 세 줄 (D-APP-08·D-APP-11) — 글자 그대로 */
export const LIVEGENIE_CONSENT_LINES: readonly string[] = Object.freeze([
  '음성 듣기를 켜면 이 기기 마이크 소리를 라이브지니 받아쓰기 서버로 보내 글로 바꿔요. 소리는 저장하지 않아요.',
  '와이파이에서 쓰세요. 휴대폰 데이터로는 1시간에 약 120MB를 써요.',
  '방송 동안 충전기를 꽂아 두세요.',
])

export type LiveGenieMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'result'; readonly text: string; readonly startMs: number; readonly endMs: number }
  | { readonly type: 'closing'; readonly reason: LiveGenieCloseReason | 'UNKNOWN' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * 서버 글 틀 하나 → 약속의 틀 (모르는 것·깨진 것은 null, 예외 없음).
 * result의 시각이 틀리면(정수 아님·음수·start > end) startMs·endMs를 NaN으로 둔다 — 글은 보이되 늦은 글로 다룬다(AC-APP1-54).
 * closing의 모르는 까닭은 'UNKNOWN'(다시 잇기 셈).
 */
export function parseLiveGenieMessage(data: unknown): LiveGenieMessage | null {
  let message: unknown = data
  if (typeof data === 'string') {
    if (data.length > VOICE_RESULT_TEXT_MAX * 4 + 1_024) return null
    try {
      message = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!isRecord(message)) return null
  switch (message.type) {
    case 'ready':
      return { type: 'ready' }
    case 'result': {
      if (typeof message.text !== 'string') return null
      const text = message.text.trim()
      if (text === '' || text.length > VOICE_RESULT_TEXT_MAX) return null
      const ok = isTime(message.startMs) && isTime(message.endMs) && message.startMs <= message.endMs
      return { type: 'result', text, startMs: ok ? (message.startMs as number) : Number.NaN, endMs: ok ? (message.endMs as number) : Number.NaN }
    }
    case 'closing': {
      const reason = message.reason
      const known = LIVEGENIE_CLOSE_REASONS.find((item) => item === reason)
      return { type: 'closing', reason: known ?? 'UNKNOWN' }
    }
    default:
      return null
  }
}

/** 음성 웹소켓 주소: 화면 주소(origin)의 http→ws, https→wss + 경로 + 방송 ID·기기 표지 */
export function voiceStreamUrl(pageOrigin: string, broadcastId: string, device: string): string {
  const url = new URL(VOICE_STREAM_PATH, pageOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = ''
  url.hash = ''
  url.searchParams.set('broadcastId', broadcastId)
  url.searchParams.set('device', device)
  return url.toString()
}

export const isDeviceTag = (value: unknown): value is string => typeof value === 'string' && DEVICE_TAG_PATTERN.test(value)

/** 이 결과의 말 끝 시각 (없으면 undefined — 라이브지니 받아쓰기 결과가 아님) */
export const spokenEndAt = (result: SpeechResult): number | undefined => result.spokenEndAt

/**
 * 늦은 글인가 (VOC-06 늦은 글, D-APP-12, D-APP1-08): 처리 시각이 말 끝 시각보다 10,000ms "넘게" 뒤면 참(10,000 정확히는 거짓).
 * 말 끝 시각이 없는 결과(다른 엔진)는 거짓. 셈할 수 없으면(NaN·처리 시각 이상·말 끝이 2초 넘게 미래) 참 — 등록 쪽으로 틀리지 않게.
 */
export function isLateSpeech(result: SpeechResult, processedAt: number): boolean {
  const end = result.spokenEndAt
  if (end === undefined) return false
  if (!Number.isFinite(end) || !Number.isFinite(processedAt)) return true
  const delay = processedAt - end
  return delay > LATE_TEXT_MS || delay < -FUTURE_TEXT_SLACK_MS
}

/** 이 기기에서 라이브지니 받아쓰기 소리를 받을 수 있는가 (getUserMedia·AudioWorklet 있음, D-APP-18). 아무것도 만들지 않고 보기만 한다 */
export function canCaptureAudio(scope: object = globalThis): boolean {
  const holder = scope as {
    readonly navigator?: { readonly mediaDevices?: { readonly getUserMedia?: unknown } }
    readonly AudioWorkletNode?: unknown
    readonly AudioContext?: unknown
    readonly webkitAudioContext?: unknown
  }
  const media = holder.navigator?.mediaDevices
  return (
    typeof media?.getUserMedia === 'function' &&
    typeof holder.AudioWorkletNode === 'function' &&
    (typeof holder.AudioContext === 'function' || typeof holder.webkitAudioContext === 'function')
  )
}

export interface LiveGenieOptions {
  /** 음성 웹소켓을 여는 함수 (화면이 voiceStreamUrl로 열고, 받은 틀을 handlers.onMessage로 넘긴다 — 이진 틀은 넘기지 않아도 된다) */
  readonly connect: RelayConnect
  /** 지금 (기기 시계, UTC 밀리초). 다시 잇기 한도·말 끝 시각을 잰다 */
  readonly now: () => number
  /** 타이머 (생략하면 globalThis.setTimeout·clearTimeout). 다시 잇기 기다림에 쓴다 */
  readonly timers?: SpeechTimers
  /** 이 기기에서 소리를 받을 수 있는가 (생략하면 canCaptureAudio()). 거짓이면 start()가 UNSUPPORTED로 멈춘다 */
  readonly isSupported?: () => boolean
}

const defaultTimers: SpeechTimers = {
  set: (run, ms) => globalThis.setTimeout(run, ms),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const byteLength = (chunk: ArrayBuffer | ArrayBufferView): number => chunk.byteLength

export class LiveGenieSpeechEngine extends BaseSpeechEngine {
  readonly kind = 'livegenie' as const
  private readonly connectRelay: RelayConnect
  private readonly now: () => number
  private readonly timers: SpeechTimers
  private readonly supported: () => boolean
  private readonly limiter: RestartLimiter
  private readonly closings = new Listeners<LiveGenieCloseReason | 'UNKNOWN'>()
  private wanted = false
  /** 이번 켜기에서 ready를 한 번이라도 받았는가 (D-APP1-03 처음 거절과 듣는 중 끊김 나눔) */
  private everReady = false
  /** 마지막 최종 결과 뒤 끊긴 횟수 — 다시 잇기 간격을 고른다 */
  private drops = 0
  private connection: RelayConnection | null = null
  /** 연결마다 늘어나는 번호 — 지난 연결의 늦은 알림은 무시한다 */
  private session = 0
  private timer: unknown = null
  private streaming = false
  private readyAt: number | null = null
  /** 이 흐름에서 보낸 첫 소리를 잡은 기기 시각 */
  private firstCaptureAt: number | null = null
  private sentBytes = 0

  constructor(options: LiveGenieOptions) {
    super()
    if (typeof options.connect !== 'function') throw new TypeError('음성 웹소켓 연결 함수(connect)가 필요하다')
    if (typeof options.now !== 'function') throw new TypeError('시계 함수(now)가 필요하다')
    this.connectRelay = options.connect
    this.now = options.now
    this.timers = options.timers ?? defaultTimers
    this.supported = options.isSupported ?? (() => canCaptureAudio())
    this.limiter = new RestartLimiter(options.now)
  }

  isSupported(): boolean {
    try {
      return this.supported()
    } catch {
      return false
    }
  }

  /** ready를 받은 흐름이 있어 소리를 보내는 중인가 */
  isStreaming(): boolean {
    return this.streaming
  }

  /** 서버가 closing으로 알린 까닭 (ENDED로 꺼질 때 화면이 알 수 있게) */
  onClosing(listener: (reason: LiveGenieCloseReason | 'UNKNOWN') => void): () => void {
    return this.closings.add(listener)
  }

  start(): void {
    if (this.wanted) return
    if (!this.isSupported()) {
      this.errorsEmit('UNSUPPORTED', LIVEGENIE_UNSUPPORTED_MESSAGE)
      return
    }
    this.wanted = true
    this.everReady = false
    this.drops = 0
    this.limiter.reset()
    this.setState('LISTENING')
    this.open()
  }

  stop(): void {
    this.wanted = false
    this.cancelTimer()
    this.dropConnection()
    this.setState('OFF')
  }

  /**
   * 소리 조각 하나 보내기 (PCM16 LE 16kHz 모노, 보통 3,200바이트). capturedAt = 이 조각 첫 표본을 잡은 기기 시각(생략하면 지금 − 조각 길이).
   * ready를 받은 흐름이 없으면(켜는 중·다시 잇는 중) 버린다. ready 전에 잡은 소리(capturedAt < ready 시각)도 버린다. 보냈으면 참
   */
  sendAudio(chunk: ArrayBuffer | ArrayBufferView, capturedAt?: number): boolean {
    const connection = this.connection
    if (connection === null || !this.streaming) return false
    const bytes = byteLength(chunk)
    if (bytes === 0 || bytes % 2 !== 0 || bytes > VOICE_FRAME_MAX_BYTES) return false
    const readyAt = this.readyAt ?? this.now()
    if (capturedAt !== undefined && Number.isFinite(capturedAt) && capturedAt < readyAt) return false
    if (this.firstCaptureAt === null) {
      const at = capturedAt !== undefined && Number.isFinite(capturedAt) ? capturedAt : Math.max(readyAt, this.now() - bytes / PCM_BYTES_PER_MS)
      this.firstCaptureAt = at
    }
    try {
      connection.send(chunk)
    } catch {
      // 보내다 실패하면 이어서 오는 닫힘 알림에서 다시 잇는다
      return false
    }
    this.sentBytes += bytes
    return true
  }

  private open(): void {
    this.timer = null
    const session = ++this.session
    this.streaming = false
    this.readyAt = null
    this.firstCaptureAt = null
    this.sentBytes = 0
    const handlers: RelayHandlers = {
      onMessage: (data) => this.handleMessage(session, data),
      onClose: () => this.handleDrop(session),
      onError: () => this.handleDrop(session),
    }
    let connection: RelayConnection
    try {
      connection = this.connectRelay(handlers)
    } catch {
      this.handleDrop(session)
      return
    }
    if (session !== this.session) {
      // 연결 함수 안에서 이미 닫힘·오류를 알렸다 — 돌려받은 연결은 쓰지 않는다
      safeClose(connection)
      return
    }
    this.connection = connection
  }

  private handleMessage(session: number, data: unknown): void {
    if (session !== this.session) return
    const message = parseLiveGenieMessage(data)
    if (message === null) return
    if (message.type === 'ready') {
      if (this.streaming) return
      this.streaming = true
      this.everReady = true
      this.readyAt = this.now()
      this.setState('LISTENING')
      return
    }
    if (message.type === 'closing') {
      this.handleClosing(session, message.reason)
      return
    }
    if (!this.streaming) return
    const first = this.firstCaptureAt
    const end = first === null ? Number.NaN : first + message.endMs
    const result: SpeechResult = { text: message.text, final: true }
    Object.defineProperty(result, 'spokenEndAt', { value: Number.isFinite(end) ? end : Number.NaN, enumerable: false })
    this.limiter.reset()
    this.drops = 0
    this.emitResult(result)
  }

  private handleClosing(session: number, reason: LiveGenieCloseReason | 'UNKNOWN'): void {
    if (session !== this.session) return
    this.session++
    this.dropConnection()
    this.closings.emit(reason)
    switch (reason) {
      case 'OTHER_DEVICE':
        this.haltWith('OTHER_DEVICE')
        return
      case 'AUTH':
        this.haltWith('LOGIN_ENDED')
        return
      case 'ENDED':
        this.wanted = false
        this.cancelTimer()
        this.setState('OFF')
        return
      case 'BUSY':
      case 'NO_WORKER':
        if (!this.everReady) {
          this.haltWith(reason === 'BUSY' ? 'TRANSCRIBE_BUSY' : 'TRANSCRIBE_OFF')
          return
        }
        this.reconnect()
        return
      default:
        this.reconnect()
    }
  }

  private handleDrop(session: number): void {
    if (session !== this.session) return
    // 이 연결의 닫힘·오류는 한 번만 센다
    this.session++
    this.dropConnection()
    this.reconnect()
  }

  private reconnect(): void {
    if (!this.wanted) {
      this.setState('OFF')
      return
    }
    if (!this.limiter.recordEnd()) {
      this.wanted = false
      this.cancelTimer()
      this.errorsEmit('CONNECTION_FAILED', LIVEGENIE_CONNECTION_FAILED_MESSAGE)
      this.setState('HALTED')
      return
    }
    this.drops++
    const delay = RECONNECT_DELAYS_MS[Math.min(this.drops, RECONNECT_DELAYS_MS.length) - 1] ?? 8_000
    this.setState('RESTARTING')
    this.cancelTimer()
    this.timer = this.timers.set(() => {
      this.timer = null
      if (this.wanted) this.open()
    }, delay)
  }

  private haltWith(kind: 'OTHER_DEVICE' | 'LOGIN_ENDED' | 'TRANSCRIBE_BUSY' | 'TRANSCRIBE_OFF'): void {
    this.wanted = false
    this.cancelTimer()
    this.halt(kind)
  }

  private errorsEmit(kind: 'CONNECTION_FAILED' | 'UNSUPPORTED', message: string): void {
    // 같은 종류(CONNECTION_FAILED·UNSUPPORTED)에 라이브지니 받아쓰기 문장을 싣는다
    this.emitError({ kind, message })
    this.setState('HALTED')
  }

  private dropConnection(): void {
    this.streaming = false
    const connection = this.connection
    this.connection = null
    if (connection !== null) safeClose(connection)
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    const timer = this.timer
    this.timer = null
    try {
      this.timers.clear(timer)
    } catch {
      // 무시
    }
  }
}

function safeClose(connection: RelayConnection): void {
  try {
    connection.close()
  } catch {
    // 이미 닫힌 연결 — 무시
  }
}

/** 라이브지니 받아쓰기 엔진 (연결은 start()에서만) */
export function createLiveGenieEngine(options: LiveGenieOptions): LiveGenieSpeechEngine {
  return new LiveGenieSpeechEngine(options)
}
