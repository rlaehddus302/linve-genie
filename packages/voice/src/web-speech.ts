// Web Speech 어댑터 (VOC-01 기본 엔진, D-205, TECH_REVIEW §3 — 크롬 SpeechRecognition은 저절로 멈추므로 다시 시작이 필요하다).
// SpeechRecognition 또는 webkitSpeechRecognition을 찾아 쓴다(기능 감지). 시험은 가짜 생성자를 넣는다.
// 만들기만 해서는 인식 객체를 만들지 않는다 — start()에서만 만든다(VOC-05). 시각은 넣은 시계 함수로 잰다.
import { BaseSpeechEngine, RestartLimiter, type SpeechErrorKind } from './speech.ts'

/** 인식 결과 하나 (SpeechRecognitionResult 중 쓰는 부분) */
export interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: { readonly transcript: string } | undefined
}

export interface RecognitionResultEventLike {
  readonly resultIndex: number
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike | undefined }
}

export interface RecognitionErrorEventLike {
  readonly error: string
}

/** SpeechRecognition 중 이 어댑터가 쓰는 부분 */
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionResultEventLike) => void) | null
  onerror: ((event: RecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type RecognitionConstructor = new () => RecognitionLike

export interface WebSpeechOptions {
  /** 지금 (UTC 밀리초). 다시 시작 한도를 잰다 (시험에서 고정) */
  readonly now: () => number
  /** SpeechRecognition·webkitSpeechRecognition을 찾을 곳 (생략하면 globalThis — start()·isSupported()에서만 본다) */
  readonly scope?: object
}

/** 권한 거부·마이크 없음은 다시 시작하지 않는다. network·no-speech·aborted는 다시 시작한다(한도 안에서). 그 밖은 멈춘다 */
const RESTARTABLE_ERRORS = new Set(['network', 'no-speech', 'aborted'])
/** 판매자가 누른 start()가 연 인식 객체에서 온 오류 (D-I5-03) */
const FATAL_ERRORS: Readonly<Record<string, SpeechErrorKind>> = {
  'not-allowed': 'PERMISSION_DENIED',
  'service-not-allowed': 'SERVICE_OFF',
  'audio-capture': 'NO_MICROPHONE',
}
/** 저절로 끝난 뒤 엔진이 연 인식 객체에서 이 오류가 오면 "저절로 다시 켜지지 않음" (사파리는 누르지 않은 다시 시작을 막을 수 있다, D-I5-03) */
const BLOCKED_ON_RESTART = new Set(['not-allowed', 'service-not-allowed'])

function findConstructor(scope: object): RecognitionConstructor | null {
  const holder = scope as { readonly SpeechRecognition?: unknown; readonly webkitSpeechRecognition?: unknown }
  const found = holder.SpeechRecognition ?? holder.webkitSpeechRecognition
  return typeof found === 'function' ? (found as RecognitionConstructor) : null
}

export class WebSpeechEngine extends BaseSpeechEngine {
  readonly kind = 'web-speech' as const
  private readonly scope: object | undefined
  private readonly limiter: RestartLimiter
  private readonly now: () => number
  /** 판매자가 켜 둔 상태인가 (멈춤·오류로 멈춤이면 false) */
  private wanted = false
  /** 지금 쓰는 인식 객체. 지난 객체의 늦은 이벤트는 무시한다 */
  private recognition: RecognitionLike | null = null
  /** 이번 인식 객체에서 이미 알린 최종 결과 위치 */
  private reported = new Set<number>()
  /** 이번 인식 객체를 연 시각 (start() 직전 now() — 빨리 끝남 판단, D-I5-01) */
  private openedAt = 0
  /** 이번 인식 객체를 판매자의 start()가 열었는가 (false = 저절로 끝난 뒤 엔진이 다시 열었다, D-I5-03) */
  private openedByUser = false
  /** 이번 인식 객체에서 마지막으로 받은 결과가 글자 있는 중간 결과면 그 위치와 글 (끝에서 넘김, D-I5-02) */
  private pending: { readonly index: number; readonly text: string } | null = null

  constructor(options: WebSpeechOptions) {
    super()
    if (typeof options.now !== 'function') throw new TypeError('시계 함수(now)가 필요하다')
    this.scope = options.scope
    this.now = options.now
    this.limiter = new RestartLimiter(options.now)
  }

  private lookup(): RecognitionConstructor | null {
    return findConstructor(this.scope ?? globalThis)
  }

  isSupported(): boolean {
    return this.lookup() !== null
  }

  start(): void {
    if (this.wanted) return
    const constructor = this.lookup()
    if (constructor === null) {
      this.halt('UNSUPPORTED')
      return
    }
    this.wanted = true
    this.limiter.reset()
    this.open(constructor, true)
  }

  stop(): void {
    this.wanted = false
    const recognition = this.recognition
    this.recognition = null
    if (recognition !== null) {
      try {
        recognition.stop()
      } catch {
        // 이미 끝난 인식 객체 — 무시
      }
    }
    this.setState('OFF')
  }

  private open(constructor: RecognitionConstructor, byUser: boolean): void {
    let recognition: RecognitionLike
    try {
      recognition = new constructor()
      recognition.lang = 'ko-KR'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (event) => this.handleResult(recognition, event)
      recognition.onerror = (event) => this.handleError(recognition, event)
      recognition.onend = () => this.handleEnd(recognition)
      this.recognition = recognition
      this.reported = new Set()
      this.pending = null
      this.openedByUser = byUser
      this.openedAt = this.now()
      recognition.start()
    } catch {
      this.recognition = null
      this.wanted = false
      this.halt('OTHER')
      return
    }
    this.setState('LISTENING')
  }

  private handleResult(recognition: RecognitionLike, event: RecognitionResultEventLike): void {
    if (recognition !== this.recognition) return
    const results = event?.results
    if (results === undefined || results === null) return
    const from = Number.isSafeInteger(event.resultIndex) && event.resultIndex >= 0 ? event.resultIndex : 0
    for (let i = from; i < results.length; i++) {
      const result = results[i]
      if (result === undefined || result === null) continue
      const transcript = result[0]?.transcript
      const text = typeof transcript === 'string' ? transcript.trim() : ''
      const final = result.isFinal === true
      // 끝에서 넘길 후보: 마지막으로 받은 결과가 글자 있는 중간 결과일 때만 (최종·빈 글이 오면 비운다)
      this.pending = !final && text !== '' ? { index: i, text } : null
      if (final) {
        // 같은 최종 결과를 두 번 알리지 않는다 (같은 위치가 다시 오는 경우)
        if (this.reported.has(i)) continue
        this.reported.add(i)
      }
      if (text === '') continue
      if (final) this.limiter.reset()
      this.emitResult({ text, final })
    }
  }

  private handleError(recognition: RecognitionLike, event: RecognitionErrorEventLike): void {
    if (recognition !== this.recognition) return
    const code = typeof event?.error === 'string' ? event.error : ''
    if (RESTARTABLE_ERRORS.has(code)) return // 이어서 오는 끝(onend)에서 한도 안에서 다시 시작한다
    const kind: SpeechErrorKind =
      !this.openedByUser && BLOCKED_ON_RESTART.has(code)
        ? 'RESTART_BLOCKED'
        : Object.hasOwn(FATAL_ERRORS, code)
          ? (FATAL_ERRORS[code] as SpeechErrorKind)
          : 'OTHER'
    // 다시 시작하지 않는 오류: 바로 멈춘다(이 객체의 늦은 끝 이벤트는 무시, 남은 중간 결과도 넘기지 않는다)
    this.recognition = null
    this.pending = null
    this.wanted = false
    try {
      recognition.abort()
    } catch {
      // 무시
    }
    this.halt(kind)
  }

  private handleEnd(recognition: RecognitionLike): void {
    if (recognition !== this.recognition) return
    this.recognition = null
    if (!this.wanted) {
      this.pending = null
      this.setState('OFF')
      return
    }
    // 저절로 끝났다: 최종이 되지 못한 마지막 중간 결과를 최종으로 한 번 넘긴다 (D-I5-02)
    const pending = this.pending
    this.pending = null
    if (pending !== null && !this.reported.has(pending.index)) {
      this.reported.add(pending.index)
      this.limiter.reset()
      this.emitResult({ text: pending.text, final: true, flushedAtEnd: true })
      // 듣는 쪽이 넘긴 결과를 받다가 stop()했으면 다시 시작하지 않는다
      if (!this.wanted || this.recognition !== null) return
    }
    // 판매자가 멈추지 않았는데 끝났다 → 한도 안에서 다시 시작 (빨리 끝남만 센다, D-I5-01)
    if (!this.limiter.recordEnd(this.openedAt)) {
      this.wanted = false
      this.halt('KEEPS_STOPPING')
      return
    }
    const constructor = this.lookup()
    if (constructor === null) {
      this.wanted = false
      this.halt('UNSUPPORTED')
      return
    }
    this.setState('RESTARTING')
    this.open(constructor, false)
  }
}

/** Web Speech 엔진을 만든다 (인식 객체는 start()에서만 만든다) */
export function createWebSpeechEngine(options: WebSpeechOptions): WebSpeechEngine {
  return new WebSpeechEngine(options)
}
