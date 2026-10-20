// 클라우드 음성 엔진 골격 — Deepgram·리턴제로 (VOC-01, D-205).
// 부르는 쪽이 넘긴 연결 함수(서버 중계로 여는 소켓 비슷한 객체)로만 연결한다. 이 패키지에는 API 키·토큰·공급자 주소가 없고,
// 키를 받는 옵션도 없다 — 키는 서버 중계가 갖는다(I4). 만들기만 해서는 연결하지 않는다(VOC-05).
// 시작 = 연결, 음성 조각 보내기 = 그대로 전달, 멈춤 = 닫기. 공급자 응답 → { text, final }.
// 연결 실패·끊김은 Web Speech와 같은 한도(최종 결과 없이 60초 안에 6번째) 안에서만 다시 연결하고, 넘으면 "연결 실패"로 멈춘다.
import { BaseSpeechEngine, RestartLimiter, type SpeechEngineKind, type SpeechResult } from './speech.ts'

/** 연결이 엔진에 알리는 일 */
export interface RelayHandlers {
  /** 공급자 응답 메시지 하나 (문자열 JSON 또는 이미 푼 객체) */
  onMessage(data: unknown): void
  /** 연결이 닫혔다 (판매자가 멈춘 것이 아니면 다시 연결 대상) */
  onClose(): void
  /** 연결 오류 */
  onError(): void
}

/** 서버 중계 연결 (WebSocket 비슷한 것) */
export interface RelayConnection {
  send(data: ArrayBuffer | ArrayBufferView | Blob | string): void
  close(): void
}

/** 연결 함수: 서버 중계로 연결을 연다. 부르는 쪽(I4)이 주소·인증을 정한다 */
export type RelayConnect = (handlers: RelayHandlers) => RelayConnection

export interface CloudSpeechOptions {
  readonly connect: RelayConnect
  /** 지금 (UTC 밀리초). 다시 연결 한도를 잰다 */
  readonly now: () => number
}

/** 공급자 응답 하나 → 결과 (알릴 것이 없으면 null). 예외를 던지지 않는다 */
export type ProviderParser = (data: unknown) => SpeechResult | null

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 문자열이면 JSON으로 풀어 본다. 객체면 그대로. 그 밖(바이너리 등)은 null */
function asMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(data) ? data : null
}

function firstAlternative(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null
  const first: unknown = value[0]
  return isRecord(first) ? first : null
}

function result(text: unknown, final: unknown): SpeechResult | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed === '' ? null : { text: trimmed, final: final === true }
}

/**
 * Deepgram 실시간 응답 (Live Streaming API의 `Results` 메시지):
 * `{ "type": "Results", "is_final": true, "speech_final": true, "channel": { "alternatives": [{ "transcript": "...", "confidence": 0.98 }] }, ... }`.
 * `Metadata`·`SpeechStarted`·`UtteranceEnd` 같은 다른 종류는 알리지 않는다. final = is_final.
 */
export const parseDeepgramMessage: ProviderParser = (data) => {
  const message = asMessage(data)
  if (message === null || message.type !== 'Results') return null
  const channel = message.channel
  const alternative = isRecord(channel) ? firstAlternative(channel.alternatives) : null
  return alternative === null ? null : result(alternative.transcript, message.is_final)
}

/**
 * 리턴제로(RTZR) 스트리밍 STT 웹소켓 응답:
 * `{ "seq": 0, "start_at": 0, "duration": 1500, "final": true, "alternatives": [{ "text": "...", "confidence": 0.95 }] }`. final = final.
 */
export const parseReturnZeroMessage: ProviderParser = (data) => {
  const message = asMessage(data)
  if (message === null) return null
  const alternative = firstAlternative(message.alternatives)
  return alternative === null ? null : result(alternative.text, message.final)
}

export class CloudSpeechEngine extends BaseSpeechEngine {
  readonly kind: SpeechEngineKind
  private readonly connectRelay: RelayConnect
  private readonly parse: ProviderParser
  private readonly limiter: RestartLimiter
  private wanted = false
  private connection: RelayConnection | null = null
  /** 연결마다 늘어나는 번호 — 지난 연결의 늦은 알림은 무시한다 */
  private session = 0

  constructor(kind: SpeechEngineKind, parse: ProviderParser, options: CloudSpeechOptions) {
    super()
    if (typeof options.connect !== 'function') throw new TypeError('서버 중계 연결 함수(connect)가 필요하다')
    if (typeof options.now !== 'function') throw new TypeError('시계 함수(now)가 필요하다')
    this.kind = kind
    this.parse = parse
    this.connectRelay = options.connect
    this.limiter = new RestartLimiter(options.now)
  }

  isSupported(): boolean {
    return true
  }

  start(): void {
    if (this.wanted) return
    this.wanted = true
    this.limiter.reset()
    this.open()
  }

  /** 음성 조각 보내기: 연결이 있으면 그대로 전달한다 (없거나 닫혔으면 버린다) */
  sendAudio(chunk: ArrayBuffer | ArrayBufferView | Blob): void {
    const connection = this.connection
    if (connection === null || this.state !== 'LISTENING') return
    try {
      connection.send(chunk)
    } catch {
      // 보내다 실패하면 이어서 오는 닫힘 알림에서 다시 연결한다
    }
  }

  stop(): void {
    this.wanted = false
    this.session++
    const connection = this.connection
    this.connection = null
    if (connection !== null) {
      try {
        connection.close()
      } catch {
        // 이미 닫힌 연결 — 무시
      }
    }
    this.setState('OFF')
  }

  private open(): void {
    const session = ++this.session
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
      try {
        connection.close()
      } catch {
        // 무시
      }
      return
    }
    this.connection = connection
    this.setState('LISTENING')
  }

  private handleMessage(session: number, data: unknown): void {
    if (session !== this.session) return
    let parsed: SpeechResult | null
    try {
      parsed = this.parse(data)
    } catch {
      parsed = null
    }
    if (parsed === null) return
    if (parsed.final) this.limiter.reset()
    this.emitResult(parsed)
  }

  private handleDrop(session: number): void {
    if (session !== this.session) return
    // 이 연결의 닫힘·오류는 한 번만 센다
    this.session++
    const connection = this.connection
    this.connection = null
    if (connection !== null) {
      try {
        connection.close()
      } catch {
        // 무시
      }
    }
    if (!this.wanted) {
      this.setState('OFF')
      return
    }
    if (!this.limiter.recordEnd()) {
      this.wanted = false
      this.halt('CONNECTION_FAILED')
      return
    }
    this.setState('RESTARTING')
    this.open()
  }
}

/** Deepgram 엔진 골격 (연결은 start()에서만) */
export function createDeepgramEngine(options: CloudSpeechOptions): CloudSpeechEngine {
  return new CloudSpeechEngine('deepgram', parseDeepgramMessage, options)
}

/** 리턴제로 엔진 골격 (연결은 start()에서만) */
export function createReturnZeroEngine(options: CloudSpeechOptions): CloudSpeechEngine {
  return new CloudSpeechEngine('returnzero', parseReturnZeroMessage, options)
}
