// 음성 엔진 공용 모양 (VOC-01·VOC-05, D-205, TECH_REVIEW §3).
// 엔진을 만들기만 해서는 인식 객체·연결·마이크를 열지 않는다. start()를 부를 때만 연다(VOC-05).

export type SpeechEngineKind = 'web-speech' | 'deepgram' | 'returnzero'

/** 엔진 상태: 꺼짐(시작 전·판매자가 멈춤) · 듣는 중 · 다시 시작 중 · 멈춤(오류로 멈춤) */
export type SpeechState = 'OFF' | 'LISTENING' | 'RESTARTING' | 'HALTED'

export const SPEECH_STATE_LABELS: Readonly<Record<SpeechState, string>> = Object.freeze({
  OFF: '꺼짐',
  LISTENING: '듣는 중',
  RESTARTING: '다시 시작 중',
  HALTED: '멈춤',
})

export type SpeechErrorKind = 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'NO_MICROPHONE' | 'CONNECTION_FAILED' | 'KEEPS_STOPPING' | 'OTHER'

/** 오류 문장 (D-205 표 그대로 — 영어 상태값·개발 용어 없음, UX-01·UX-03) */
export const SPEECH_ERROR_MESSAGES: Readonly<Record<SpeechErrorKind, string>> = Object.freeze({
  UNSUPPORTED: '이 브라우저는 음성 인식을 지원하지 않아요. 크롬에서 열어 주세요.',
  PERMISSION_DENIED: '마이크 사용이 막혀 있어요. 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.',
  NO_MICROPHONE: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.',
  CONNECTION_FAILED: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  KEEPS_STOPPING: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요.',
  OTHER: '음성 인식이 멈췄어요. 다시 켜 주세요.',
})

/** 인식 결과. 중간 결과(final: false)는 자막용, 추출은 최종 결과만 한다 */
export interface SpeechResult {
  readonly text: string
  readonly final: boolean
}

export interface SpeechError {
  readonly kind: SpeechErrorKind
  readonly message: string
}

export const speechError = (kind: SpeechErrorKind): SpeechError => ({ kind, message: SPEECH_ERROR_MESSAGES[kind] })

export interface SpeechEngine {
  readonly kind: SpeechEngineKind
  /** 이 환경에서 쓸 수 있는가 (인식 객체·연결을 만들지 않고 확인만 한다) */
  isSupported(): boolean
  /** 듣기 시작 (판매자가 켰을 때만 부른다). 이미 듣는 중이면 아무 일도 없다 */
  start(): void
  /** 판매자가 멈춤. 그 뒤엔 다시 시작하지 않는다 */
  stop(): void
  getState(): SpeechState
  onResult(listener: (result: SpeechResult) => void): () => void
  onError(listener: (error: SpeechError) => void): () => void
  onState(listener: (state: SpeechState) => void): () => void
}

/** 저절로 끝난 것을 세는 창과 한도 (D-205: 최종 결과 없이 60초 안에 6번째가 되면 멈춘다) */
export const RESTART_WINDOW_MS = 60_000
export const MAX_AUTO_ENDS = 6

/** 다시 시작 한도: 최종 결과 없이 60초 안에 저절로 끝난 것이 6번째가 되면 더는 다시 시작하지 않는다. 최종 결과가 오면 센 것을 비운다 */
export class RestartLimiter {
  private ends: number[] = []
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  reset(): void {
    this.ends = []
  }

  /** 저절로 끝남을 기록한다. 다시 시작해도 되면 true */
  recordEnd(): boolean {
    const at = this.now()
    this.ends = this.ends.filter((end) => at - end < RESTART_WINDOW_MS)
    this.ends.push(at)
    return this.ends.length < MAX_AUTO_ENDS
  }
}

/** 듣는 쪽 목록. 듣는 쪽이 예외를 던져도 엔진 상태(다시 시작 판단)가 깨지지 않게 다른 듣는 쪽은 계속 부른다 */
export class Listeners<T> {
  private readonly set = new Set<(value: T) => void>()

  add(listener: (value: T) => void): () => void {
    this.set.add(listener)
    return () => {
      this.set.delete(listener)
    }
  }

  emit(value: T): void {
    for (const listener of [...this.set]) {
      try {
        listener(value)
      } catch {
        // 듣는 쪽의 문제는 듣는 쪽 몫이다 — 엔진은 계속 돈다
      }
    }
  }
}

/** 엔진 공용 뼈대: 상태·듣는 쪽 */
export abstract class BaseSpeechEngine implements SpeechEngine {
  abstract readonly kind: SpeechEngineKind
  protected state: SpeechState = 'OFF'
  private readonly results = new Listeners<SpeechResult>()
  private readonly errors = new Listeners<SpeechError>()
  private readonly states = new Listeners<SpeechState>()

  abstract isSupported(): boolean
  abstract start(): void
  abstract stop(): void

  getState(): SpeechState {
    return this.state
  }

  onResult(listener: (result: SpeechResult) => void): () => void {
    return this.results.add(listener)
  }

  onError(listener: (error: SpeechError) => void): () => void {
    return this.errors.add(listener)
  }

  onState(listener: (state: SpeechState) => void): () => void {
    return this.states.add(listener)
  }

  protected setState(state: SpeechState): void {
    if (this.state === state) return
    this.state = state
    this.states.emit(state)
  }

  protected emitResult(result: SpeechResult): void {
    this.results.emit(result)
  }

  /** 오류로 멈춘다: 오류를 알리고 상태를 멈춤으로 */
  protected halt(kind: SpeechErrorKind): void {
    this.errors.emit(speechError(kind))
    this.setState('HALTED')
  }
}
