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

export type SpeechErrorKind =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'SERVICE_OFF'
  | 'RESTART_BLOCKED'
  | 'NO_MICROPHONE'
  | 'CONNECTION_FAILED'
  | 'KEEPS_STOPPING'
  | 'OTHER'

/**
 * 오류 문장 (D-205 표, I5에서 D-I5-03으로 바꿈 — 영어 상태값·개발 용어 없음, UX-01·UX-03).
 * 기기 이름(UA)으로 가르지 않고 모든 기기에 맞는 한 문장을 쓴다(D-036).
 */
export const SPEECH_ERROR_MESSAGES: Readonly<Record<SpeechErrorKind, string>> = Object.freeze({
  UNSUPPORTED: '이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.',
  PERMISSION_DENIED: '마이크 사용이 막혀 있어요. PC·안드로이드 크롬은 주소창 왼쪽 자물쇠에서, 아이폰은 설정 > 사파리 > 마이크에서 허용해 주세요.',
  SERVICE_OFF: '이 기기에서 음성 인식이 꺼져 있어요. 아이폰은 설정에서 Siri와 받아쓰기를 켜 주세요. 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.',
  RESTART_BLOCKED: "이 기기는 음성이 저절로 다시 켜지지 않아요. 말하기 전에 '음성 켜기'를 다시 눌러 주세요.",
  NO_MICROPHONE: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.',
  CONNECTION_FAILED: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  KEEPS_STOPPING: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.',
  OTHER: '음성 인식이 멈췄어요. 다시 켜 주세요.',
})

/** 인식 결과. 중간 결과(final: false)는 자막용, 추출은 최종 결과만 한다 */
export interface SpeechResult {
  readonly text: string
  readonly final: boolean
  /**
   * 끝에서 넘김 (D-I5-02): 인식이 저절로 끝날 때 최종이 되지 못한 마지막 중간 결과를 최종으로 넘긴 것.
   * 그런 결과에만 true로 붙고 보통 결과에는 없다(없음 = 거짓). 이 문장으로 만든 카드는 자동 확정하지 않는다.
   */
  readonly flushedAtEnd?: boolean
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
/** 빨리 끝남 (D-I5-01): 인식 객체를 연 뒤 이 시간 안에 저절로 끝난 것만 한도에 센다. 이보다 오래 들은 뒤 끝난 것은 조용함이라 세지 않는다 */
export const FAST_END_MS = 2_000

/**
 * 다시 시작 한도: 최종 결과 없이 60초 안에 저절로 끝난 것이 6번째가 되면 더는 다시 시작하지 않는다. 최종 결과가 오면 센 것을 비운다.
 * 연 시각(openedAt)을 주면 빨리 끝남(연 뒤 FAST_END_MS 안, D-I5-01)만 센다 — 시계가 이상하면(NaN·뒤로 감) 빨리 끝남으로 센다.
 */
export class RestartLimiter {
  private ends: number[] = []
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  reset(): void {
    this.ends = []
  }

  /** 저절로 끝남을 기록한다. 다시 시작해도 되면 true. openedAt = 그 인식 객체를 연 시각(주면 빨리 끝남만 센다) */
  recordEnd(openedAt?: number): boolean {
    const at = this.now()
    if (openedAt !== undefined) {
      const heard = at - openedAt
      // 2초 넘게 들은 뒤 끝남 = 조용함 → 세지 않고 다시 시작 (NaN·음수는 이 조건을 못 넘어 센다)
      if (Number.isFinite(heard) && heard >= FAST_END_MS) return true
    }
    // 시계가 이상하면(NaN·뒤로 감) 지난 끝을 버리지 않는다 — 고장 난 시계로 무한히 다시 시작하지 않게
    this.ends = this.ends.filter((end) => !(at - end >= RESTART_WINDOW_MS))
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
