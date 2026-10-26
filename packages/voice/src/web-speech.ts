// Web Speech 어댑터 (VOC-01 기본 엔진, D-205, TECH_REVIEW §3 — 크롬 SpeechRecognition은 저절로 멈추므로 다시 시작이 필요하다).
// SpeechRecognition 또는 webkitSpeechRecognition을 찾아 쓴다(기능 감지). 시험은 가짜 생성자를 넣는다.
// 만들기만 해서는 인식 객체를 만들지 않는다 — start()에서만 만든다(VOC-05). 시각은 넣은 시계 함수로 잰다.
//
// V3 실방송 보강 (인식 끊김):
// - 끊김 재기: 인식 객체가 끝나 소리를 못 듣기 시작한 때 → 다음 객체가 다시 소리를 듣기 시작한 때(onaudiostart, 없으면 첫 결과)를 넣은 시계로 재어
//   onGap으로 알린다(끝난 까닭: network·no-speech·aborted·end·planned·stall). 들은 글은 담지 않는다.
// - 쉬는 틈 다시 열기: 연 지 PLANNED_RESTART_AFTER_MS가 넘은 객체에서 최종 결과가 오고 남은 중간 결과가 없으면(판매자가 쉼)
//   엔진이 먼저 닫고 다시 연다 — 크롬이 문장 한가운데서 끊는 일을 줄인다. 이 다시 열기는 한도에 세지 않고 "다시 시작 중"을 알리지 않는다.
// - 빠른 다시 열기: 끝(onend)에서 바로 새 객체를 만들어 start()한다. 새 객체의 start()가 InvalidStateError면 START_RETRY_MS 뒤 몇 번 더 해 본다.
// - 겹쳐 열기(실험, OVERLAP_PLANNED_RESTART — 기본 끔): 쉬는 틈 다시 열기 때 새 객체를 먼저 열고 옛 객체를 닫는다.
// - 기기 안 인식(processLocally) 확인만 한다 — 엔진을 바꾸거나 켜지 않는다.
// - 멈춤 지킴이: 실방송에서 크롬이 "듣는 중"인 채 결과·끝·오류를 하나도 내지 않고 약 10초 귀를 막는 일이 있다.
//   소리를 받는 중(onstart·onaudiostart 뒤)인 지금 객체에서 STALL_MS 동안 결과 이벤트(중간·최종)가 없으면 abort하고 바로 새 객체를 연다
//   (한도에 세지 않음, "다시 시작 중" 없음, 새 객체 start()는 abort와 같은 순간). 결과 없는 멈춤 다시 열기가 STALL_BACKOFF_AFTER번 이어지면
//   기다림을 두 배로 늦춘다(진짜 조용함에서 너무 자주 열지 않게). 멈춤 다시 열기는 그 시간에 한 번까지. STALL_MS는 선택값 stallMs(설정 voice.stallMs)로 바꾼다. 소리 받기 멈춤(onaudioend) 뒤 END_WAIT_MS 안에 끝(onend)이 없거나,
//   말 끝(onspeechend) 뒤 END_WAIT_MS 안에 결과·끝이 없어도 같은 다시 열기를 한다. 멈춰 닫은 객체에서 늦게 온 결과는 버리지 않고 받는다
//   (크롬이 모아 뒀다 줄 수 있다). 기록: onDiagnostic(멈춤 · 다시 켠 뒤 첫 결과까지 · 늦은 결과).
import { BaseSpeechEngine, Listeners, RestartLimiter, type SpeechErrorKind } from './speech.ts'

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
  /** 인식이 시작됨 (없는 브라우저도 있다 — 끊김 재기·멈춤 지킴이에만 쓴다) */
  onstart?: (() => void) | null
  /** 마이크 소리를 받기 시작함 (끊김이 끝난 때) */
  onaudiostart?: (() => void) | null
  /** 마이크 소리 받기를 멈춤 (끊김이 시작된 때) */
  onaudioend?: (() => void) | null
  /** 말소리가 끝남 (멈춤 지킴이) */
  onspeechend?: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type RecognitionConstructor = new () => RecognitionLike

/** 타이머 (시험에서 바꾼다). 돌려준 값을 clear에 넘긴다 */
export interface SpeechTimers {
  readonly set: (run: () => void, ms: number) => unknown
  readonly clear: (handle: unknown) => void
}

export interface WebSpeechOptions {
  /** 지금 (UTC 밀리초). 다시 시작 한도·끊김을 잰다 (시험에서 고정) */
  readonly now: () => number
  /** SpeechRecognition·webkitSpeechRecognition을 찾을 곳 (생략하면 globalThis — start()·isSupported()에서만 본다) */
  readonly scope?: object
  /**
   * 모든 끝남 세기 (D-I5-18): true면 연 시간과 상관없이 저절로 끝난 것을 모두 다시 시작 한도에 센다(D-205 한도).
   * 화면이 홈 화면 앱(navigator.standalone === true)일 때 켠다. 기본(생략·false)은 D-I5-01 — 빨리 끝남과 network 뒤 끝남만 센다
   */
  readonly countAllEnds?: boolean
  /** 타이머 (생략하면 globalThis.setTimeout·clearTimeout). 다시 열기 기다림·start() 다시 해 보기·멈춤 지킴이에 쓴다 */
  readonly timers?: SpeechTimers
  /** 쉬는 틈 다시 열기 (생략하면 켬). false면 V3 전처럼 크롬이 끝낼 때만 다시 연다 */
  readonly plannedRestart?: boolean
  /** 겹쳐 열기 실험 (생략하면 OVERLAP_PLANNED_RESTART) */
  readonly overlap?: boolean
  /**
   * 멈춤 지킴이 (생략하면 켬, 단 모든 끝남 세기(홈 화면 앱)를 켰으면 끔 — 저절로 다시 여는 일이 잦아지면 권한 창이 뜰 수 있다, D-I5-18)
   */
  readonly stallRestart?: boolean
  /** 멈춤 지킴이 시간 (생략하면 STALL_MS, STALL_MIN_MS보다 짧으면 STALL_MIN_MS — readStallMs) */
  readonly stallMs?: number
}

/** 쉬는 틈 다시 열기: 인식 객체를 연 지 이만큼 지났으면 쉬는 틈(최종 결과 뒤 남은 중간 결과 없음)에 먼저 닫고 다시 연다 */
export const PLANNED_RESTART_AFTER_MS = 45_000
/** 쉬는 틈에 닫은(stop) 객체가 이 안에 끝(onend)을 알리지 않으면 abort하고 바로 새 객체를 연다 */
export const PLANNED_END_WAIT_MS = 1_000
/** 새 객체 start()가 InvalidStateError면 이만큼 뒤 다시 해 본다 */
export const START_RETRY_MS = 50
/** start() 다시 해 보기 횟수 (그래도 안 되면 OTHER로 멈춘다) */
export const START_RETRY_MAX = 5
/**
 * 겹쳐 열기 실험 — 기본 끔. 크롬은 한 페이지에서 인식 객체를 하나만 듣게 하는 것으로 알려져 있어(새 객체 start()가 옛 객체를 aborted로 끝내거나
 * 새 객체가 InvalidStateError) 가짜 객체 시험만으로는 안전하다고 볼 수 없다. 실기기에서 끊김 기록으로 확인한 뒤에만 켠다
 */
export const OVERLAP_PLANNED_RESTART = false
/** 멈춤 지킴이 기본값: 소리를 받는 중인데 결과 이벤트(중간·최종)가 이만큼 없으면 다시 연다 (실방송 멈춤은 약 10초 — 그보다 훨씬 빨리). 설정 voice.stallMs */
export const STALL_MS = 2_000
/** 멈춤 지킴이 가장 짧은 값 (이보다 짧게 주면 이 값) */
export const STALL_MIN_MS = 1_000
/** 결과 없는 멈춤 다시 열기가 이만큼 이어지면 기다림을 두 배로 (결과가 한 번 오면 돌아간다) */
export const STALL_BACKOFF_AFTER = 3

/** 멈춤 지킴이 시간 고르기: 정수 밀리초만, STALL_MIN_MS보다 짧으면 STALL_MIN_MS, 숫자가 아니면 STALL_MS */
export function readStallMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return STALL_MS
  return Math.max(STALL_MIN_MS, value)
}
/** 소리 받기 멈춤 뒤 끝(onend)이, 말 끝 뒤 결과·끝이 이 안에 없으면 다시 연다 */
export const END_WAIT_MS = 2_000

/** 끊김의 까닭: 인식 오류 코드(network·no-speech·aborted), 오류 없이 끝남(end), 엔진이 쉬는 틈에 다시 엶(planned), 멈춤 지킴이가 다시 엶(stall) */
export type SpeechGapReason = 'network' | 'no-speech' | 'aborted' | 'end' | 'planned' | 'stall'

/** 인식 끊김 한 번 (들은 글은 담지 않는다) */
export interface SpeechGap {
  /** 소리를 못 듣기 시작한 때 (UTC 밀리초) */
  readonly from: number
  /** 다시 듣기 시작한 때 (UTC 밀리초) */
  readonly to: number
  /** 끊긴 시간 (밀리초, 0 이상 정수) */
  readonly ms: number
  readonly reason: SpeechGapReason
  /** 그 사이 start()를 다시 해 본 횟수 (InvalidStateError) */
  readonly retries: number
}

/** 멈춤 지킴이가 본 까닭: 결과 없음 · 소리 받기 멈춤 뒤 끝 없음 · 말 끝 뒤 결과·끝 없음 */
export type SpeechStallCause = 'no-result' | 'audio-end' | 'speech-end'

/**
 * 진단 한 번 (들은 글은 담지 않는다):
 * - stall: 멈춤 지킴이가 다시 엶. ms = 마지막 결과(없으면 소리 받기 시작)부터 다시 열 때까지, streak = 결과 없이 이어진 멈춤 다시 열기 수
 * - first-result: 엔진이 다시 연 객체가 연 뒤(옛 객체 abort·끝과 같은 순간) 첫 결과까지 ms, startMs = 연 뒤 onstart(없으면 onaudiostart)까지(못 받았으면 null),
 *   after = 그 다시 열기의 까닭
 * - late-result: 멈춰 닫은 객체에서 결과가 늦게 옴. ms = 닫은 뒤 몇 ms
 */
export type SpeechDiagnostic =
  | { readonly kind: 'stall'; readonly at: number; readonly ms: number; readonly cause: SpeechStallCause; readonly streak: number }
  | { readonly kind: 'first-result'; readonly at: number; readonly ms: number; readonly startMs: number | null; readonly after: SpeechGapReason }
  | { readonly kind: 'late-result'; readonly at: number; readonly ms: number }

/** 기기 안 인식(processLocally) 확인 결과. unsupported = 브라우저가 확인 방법을 주지 않음 */
export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'

/** 밀리초 → "0.8초" (소수 한 자리, 0 미만·NaN은 0) */
function seconds(ms: number): string {
  const tenths = Math.round(Number.isFinite(ms) && ms > 0 ? ms / 100 : 0)
  return `${Math.floor(tenths / 10)}.${tenths % 10}초`
}

/** 끊김 한 줄 ("인식 끊김 0.8초 (network)") — 들은 말 기록에 남기는 글 */
export function formatSpeechGap(gap: Pick<SpeechGap, 'ms' | 'reason'>): string {
  return `인식 끊김 ${seconds(gap.ms)} (${gap.reason})`
}

/** 진단 한 줄 ("인식 멈춤 3.0초 → 다시 켬" · "다시 켠 뒤 첫 결과 0.9초 (stall)" · "멈춘 인식에서 늦은 결과 1.2초 뒤") */
export function formatSpeechDiagnostic(diagnostic: SpeechDiagnostic): string {
  if (diagnostic.kind === 'stall') return `인식 멈춤 ${seconds(diagnostic.ms)} → 다시 켬${diagnostic.cause === 'no-result' ? '' : ` (${diagnostic.cause})`}`
  if (diagnostic.kind === 'first-result') {
    const start = diagnostic.startMs === null ? '' : `시작 ${seconds(diagnostic.startMs)} · `
    return `다시 켠 뒤 ${start}첫 결과 ${seconds(diagnostic.ms)} (${diagnostic.after})`
  }
  return `멈춘 인식에서 늦은 결과 ${seconds(diagnostic.ms)} 뒤`
}

/** 권한 거부·마이크 없음은 다시 시작하지 않는다. network·no-speech·aborted는 다시 시작한다(한도 안에서). 그 밖은 멈춘다.
 * 그중 network 뒤 끝남만 연 시간과 상관없이 한도에 센다(D-I5-17) — no-speech는 조용함, aborted는 언제 오는지 모른다 */
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

const isInvalidState = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { readonly name?: unknown }).name === 'InvalidStateError'

const elapsed = (from: number, to: number): number => {
  const raw = to - from
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
}

const defaultTimers: SpeechTimers = {
  set: (run, ms) => globalThis.setTimeout(run, ms),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** 인식 객체 하나의 상태 */
interface Session {
  readonly recognition: RecognitionLike
  /** 판매자의 start()가 열었는가 (false = 엔진이 다시 열었다, D-I5-03) */
  readonly byUser: boolean
  /** 연 시각 (start() 직전 now() — 빨리 끝남 판단, D-I5-01) */
  readonly openedAt: number
  /** 이미 알린 최종 결과 위치 */
  readonly reported: Set<number>
  /** 마지막으로 받은 결과가 글자 있는 중간 결과면 그 위치와 글 (끝에서 넘김, D-I5-02) */
  pending: { readonly index: number; readonly text: string } | null
  /** network 오류가 왔는가 (그 끝남은 연 시간과 상관없이 센다, D-I5-17) */
  networkFailed: boolean
  /** 마지막 다시 시작하는 오류 코드 (끊김 까닭) */
  lastError: string | null
  /** 엔진이 닫았다(쉬는 틈·멈춤) — 한도에 세지 않는다 */
  planned: boolean
  /** 다시 듣기 시작했는가 (끊김을 이미 알렸다) */
  heard: boolean
  /** 소리를 받기 시작했다 (onstart·onaudiostart) — 멈춤 지킴이·쉬는 틈 다시 열기는 이 뒤에만 */
  live: boolean
  /** 마지막 결과 이벤트 시각 (없으면 소리 받기 시작 시각) */
  lastActivity: number
  /** 엔진이 다시 열었다면 그 까닭 (첫 결과까지 시간 기록) — 첫 결과 뒤 null */
  reopenedFor: SpeechGapReason | null
  /** 멈춤 지킴이가 닫은 시각 (늦은 결과 기록, 한 번 기록하면 null) */
  stalledAt: number | null
  /** onstart(없으면 onaudiostart)를 받은 시각 */
  startedAt: number | null
}

export class WebSpeechEngine extends BaseSpeechEngine {
  readonly kind = 'web-speech' as const
  private readonly scope: object | undefined
  private readonly limiter: RestartLimiter
  private readonly now: () => number
  private readonly countAllEnds: boolean
  private readonly timers: SpeechTimers
  private readonly plannedRestart: boolean
  private readonly overlap: boolean
  private readonly stallRestart: boolean
  private readonly stallMs: number
  private readonly gaps = new Listeners<SpeechGap>()
  private readonly diagnostics = new Listeners<SpeechDiagnostic>()
  /** 판매자가 켜 둔 상태인가 (멈춤·오류로 멈춤이면 false) */
  private wanted = false
  /** 지금 쓰는 인식 객체. 지난 객체의 늦은 이벤트는 무시한다 */
  private session: Session | null = null
  /** 겹쳐 열기 때 닫는 중인 옛 객체 (결과는 받고, 끝·오류는 새 객체에 영향이 없다) */
  private draining: Session | null = null
  /** 멈춤 지킴이가 닫은 옛 객체들 (늦은 결과는 받는다, 끝·오류는 새 객체에 영향이 없다) */
  private readonly stalled = new Set<Session>()
  /** 지금 이어지는 끊김의 시작 (없으면 null) */
  private gapFrom: { readonly at: number; reason: SpeechGapReason | null; retries: number } | null = null
  /** 쉬는 틈에 닫은 객체의 끝 기다림 */
  private plannedTimer: unknown = null
  /** start() 다시 해 보기 기다림 */
  private retryTimer: unknown = null
  /** 멈춤 지킴이 (지금 객체) */
  private stallTimer: unknown = null
  /** 소리 받기 멈춤·말 끝 뒤 기다림 (지금 객체) */
  private endWaitTimer: unknown = null
  /** 결과 없이 이어진 멈춤 다시 열기 수 (결과가 오면 0) */
  private stallStreak = 0
  /** 마지막 멈춤 다시 열기 시각 */
  private lastStallAt = Number.NEGATIVE_INFINITY

  constructor(options: WebSpeechOptions) {
    super()
    if (typeof options.now !== 'function') throw new TypeError('시계 함수(now)가 필요하다')
    this.scope = options.scope
    this.now = options.now
    this.countAllEnds = options.countAllEnds === true
    this.timers = options.timers ?? defaultTimers
    this.plannedRestart = options.plannedRestart !== false
    this.overlap = options.overlap ?? OVERLAP_PLANNED_RESTART
    this.stallRestart = options.stallRestart ?? !this.countAllEnds
    this.stallMs = readStallMs(options.stallMs)
    this.limiter = new RestartLimiter(options.now)
  }

  private lookup(): RecognitionConstructor | null {
    return findConstructor(this.scope ?? globalThis)
  }

  isSupported(): boolean {
    return this.lookup() !== null
  }

  /** 인식 끊김을 듣는다 (끊김이 끝나 다시 들을 때 한 번씩) */
  onGap(listener: (gap: SpeechGap) => void): () => void {
    return this.gaps.add(listener)
  }

  /** 진단(멈춤 다시 열기 · 다시 켠 뒤 첫 결과까지 · 늦은 결과)을 듣는다 */
  onDiagnostic(listener: (diagnostic: SpeechDiagnostic) => void): () => void {
    return this.diagnostics.add(listener)
  }

  /**
   * 기기 안 인식(processLocally)을 이 브라우저가 한국어로 줄 수 있는지 확인만 한다 (인식 객체·마이크를 열지 않는다).
   * 크롬의 SpeechRecognition.available({ langs, processLocally: true }) — 없으면 'unsupported'. 엔진은 이 값으로 아무것도 바꾸지 않는다
   */
  async onDeviceStatus(lang = 'ko-KR'): Promise<OnDeviceStatus> {
    const constructor = this.lookup() as unknown as { readonly available?: unknown; readonly availableOnDevice?: unknown } | null
    if (constructor === null) return 'unsupported'
    try {
      let answer: unknown
      if (typeof constructor.available === 'function') answer = await (constructor.available as (options: unknown) => unknown).call(constructor, { langs: [lang], processLocally: true })
      else if (typeof constructor.availableOnDevice === 'function') answer = await (constructor.availableOnDevice as (lang: string) => unknown).call(constructor, lang)
      else return 'unsupported'
      return answer === 'available' || answer === 'downloadable' || answer === 'downloading' || answer === 'unavailable' ? answer : 'unsupported'
    } catch {
      return 'unsupported'
    }
  }

  start(): void {
    if (this.wanted) return
    const constructor = this.lookup()
    if (constructor === null) {
      this.halt('UNSUPPORTED')
      return
    }
    this.wanted = true
    this.gapFrom = null
    this.stallStreak = 0
    this.limiter.reset()
    this.open(constructor, true, 0, null)
  }

  stop(): void {
    this.wanted = false
    this.gapFrom = null
    this.clearTimers()
    const sessions = [this.session, this.draining]
    this.session = null
    this.draining = null
    this.stalled.clear()
    for (const session of sessions) {
      if (session === null) continue
      try {
        session.recognition.stop()
      } catch {
        // 이미 끝난 인식 객체 — 무시
      }
    }
    this.setState('OFF')
  }

  private clearTimers(): void {
    if (this.plannedTimer !== null) this.timers.clear(this.plannedTimer)
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer)
    this.plannedTimer = null
    this.retryTimer = null
    this.clearWatch()
  }

  /** 지금 객체의 멈춤 지킴이·끝 기다림을 거둔다 */
  private clearWatch(): void {
    if (this.stallTimer !== null) this.timers.clear(this.stallTimer)
    if (this.endWaitTimer !== null) this.timers.clear(this.endWaitTimer)
    this.stallTimer = null
    this.endWaitTimer = null
  }

  /** 멈춤 지킴이를 (다시) 건다: 지금부터 stallMs(결과 없는 다시 열기가 이어졌으면 두 배), 멈춤 다시 열기는 stallMs에 한 번까지 */
  private armStall(session: Session): void {
    if (!this.stallRestart || !this.wanted || session !== this.session || !session.live || session.planned) return
    if (this.stallTimer !== null) this.timers.clear(this.stallTimer)
    const wait = this.stallStreak >= STALL_BACKOFF_AFTER ? this.stallMs * 2 : this.stallMs
    const sinceLast = this.now() - this.lastStallAt
    const spacing = Number.isFinite(sinceLast) && sinceLast >= 0 && sinceLast < this.stallMs ? this.stallMs - sinceLast : 0
    this.stallTimer = this.timers.set(() => {
      this.stallTimer = null
      if (session !== this.session || !this.wanted) return
      this.restartStalled(session, 'no-result')
    }, Math.max(wait, spacing))
  }

  /** 소리 받기 멈춤·말 끝 뒤 END_WAIT_MS 안에 끝이 없으면 다시 연다 (말 끝은 결과가 오면 거둔다) */
  private armEndWait(session: Session, cause: SpeechStallCause): void {
    if (!this.stallRestart || !this.wanted || session !== this.session || session.planned) return
    if (this.endWaitTimer !== null) this.timers.clear(this.endWaitTimer)
    this.endWaitTimer = this.timers.set(() => {
      this.endWaitTimer = null
      if (session !== this.session || !this.wanted) return
      this.restartStalled(session, cause)
    }, END_WAIT_MS)
  }

  /** 멈춘 객체를 abort하고 바로 새 객체를 연다 (한도에 세지 않는다, "다시 시작 중" 없음). 그 객체의 늦은 결과는 받는다 */
  private restartStalled(session: Session, cause: SpeechStallCause): void {
    const constructor = this.lookup()
    if (constructor === null) return
    const at = this.now()
    this.stallStreak++
    this.lastStallAt = at
    this.clearWatch()
    if (this.plannedTimer !== null) this.timers.clear(this.plannedTimer)
    this.plannedTimer = null
    session.planned = true
    session.stalledAt = at
    this.session = null
    this.stalled.add(session)
    // 끊김은 마지막 결과부터가 아니라 다시 열 때부터 잰다(멈춘 시간은 진단에)
    this.gapStarts('stall')
    if (this.gapFrom !== null) this.gapFrom.reason = 'stall'
    try {
      session.recognition.abort()
    } catch {
      // 무시
    }
    this.diagnostics.emit({ kind: 'stall', at, ms: elapsed(session.lastActivity, at), cause, streak: this.stallStreak })
    // 듣는 쪽이 진단을 받다가 stop()했으면 열지 않는다
    if (!this.wanted || this.session !== null) return
    this.open(constructor, false, 0, 'stall')
  }

  /** 끊김이 시작됐다 (이미 이어지는 끊김이면 그 시작을 둔다) */
  private gapStarts(reason: SpeechGapReason | null): void {
    if (!this.wanted) return
    if (this.gapFrom === null) this.gapFrom = { at: this.now(), reason, retries: 0 }
    else if (this.gapFrom.reason === null) this.gapFrom.reason = reason
  }

  /** 지금 객체가 다시 소리를 듣는다 — 끊김을 알린다 */
  private gapEnds(session: Session): void {
    if (session.heard) return
    session.heard = true
    const gap = this.gapFrom
    if (gap === null || session !== this.session) return
    this.gapFrom = null
    const to = this.now()
    this.gaps.emit({ from: gap.at, to, ms: elapsed(gap.at, to), reason: gap.reason ?? 'end', retries: gap.retries })
  }

  private open(constructor: RecognitionConstructor, byUser: boolean, attempt: number, reopenedFor: SpeechGapReason | null): void {
    let session: Session
    try {
      const recognition = new constructor()
      recognition.lang = 'ko-KR'
      recognition.continuous = true
      recognition.interimResults = true
      const openedAt = this.now()
      session = {
        recognition,
        byUser,
        openedAt,
        reported: new Set(),
        pending: null,
        networkFailed: false,
        lastError: null,
        planned: false,
        heard: false,
        live: false,
        lastActivity: openedAt,
        reopenedFor: byUser ? null : (reopenedFor ?? 'end'),
        stalledAt: null,
        startedAt: null,
      }
      recognition.onresult = (event) => this.handleResult(session, event)
      recognition.onerror = (event) => this.handleError(session, event)
      recognition.onend = () => this.handleEnd(session)
      recognition.onstart = () => this.goLive(session)
      recognition.onaudiostart = () => {
        if (session !== this.session) return
        this.gapEnds(session)
        this.goLive(session)
      }
      recognition.onaudioend = () => {
        if (session !== this.session) return
        // 지금 객체가 소리를 멈췄다 — 이 뒤 끝(onend)까지도 끊김이다 (까닭은 끝에서 정한다)
        if (session.heard) this.gapStarts(session.planned ? 'planned' : null)
        // 소리를 안 받으니 결과 지킴이는 거두고, 끝이 END_WAIT_MS 안에 오지 않으면 다시 연다
        if (this.stallTimer !== null) this.timers.clear(this.stallTimer)
        this.stallTimer = null
        this.armEndWait(session, 'audio-end')
      }
      recognition.onspeechend = () => {
        if (session === this.session) this.armEndWait(session, 'speech-end')
      }
      this.session = session
      recognition.start()
    } catch (error) {
      this.session = null
      // 엔진이 다시 연 새 객체의 start()가 InvalidStateError — 크롬이 앞 객체를 아직 놓지 않았다. 조금 뒤 새 객체로 다시 해 본다
      if (!byUser && isInvalidState(error) && attempt < START_RETRY_MAX && this.wanted) {
        if (this.gapFrom !== null) this.gapFrom.retries++
        this.retryTimer = this.timers.set(() => {
          this.retryTimer = null
          if (!this.wanted || this.session !== null) return
          const again = this.lookup()
          if (again === null) {
            this.wanted = false
            this.gapFrom = null
            this.halt('UNSUPPORTED')
            return
          }
          this.open(again, false, attempt + 1, reopenedFor)
        }, START_RETRY_MS)
        return
      }
      this.wanted = false
      this.gapFrom = null
      this.clearTimers()
      this.halt('OTHER')
      return
    }
    this.setState('LISTENING')
  }

  /** 소리를 받기 시작했다 — 멈춤 지킴이를 건다 */
  private goLive(session: Session): void {
    if (session !== this.session || session.live) return
    session.live = true
    session.startedAt = this.now()
    session.lastActivity = this.now()
    this.armStall(session)
  }

  private handleResult(session: Session, event: RecognitionResultEventLike): void {
    const current = session === this.session
    const late = this.stalled.has(session)
    if (!current && session !== this.draining && !late) return
    const results = event?.results
    if (results === undefined || results === null) return
    if (late && session.stalledAt !== null) {
      // 멈춰 닫은 객체에서 결과가 늦게 왔다 — 버리지 않는다 (객체마다 한 번 기록)
      this.diagnostics.emit({ kind: 'late-result', at: this.now(), ms: elapsed(session.stalledAt, this.now()) })
      session.stalledAt = null
    }
    if (current) {
      // 소리 받기 시작 알림이 없는 브라우저: 첫 결과를 다시 듣기 시작한 때로 본다
      this.gapEnds(session)
      session.lastActivity = this.now()
      this.stallStreak = 0
      if (session.reopenedFor !== null) {
        const startMs = session.startedAt === null ? null : elapsed(session.openedAt, session.startedAt)
        this.diagnostics.emit({ kind: 'first-result', at: this.now(), ms: elapsed(session.openedAt, this.now()), startMs, after: session.reopenedFor })
        session.reopenedFor = null
      }
      // 결과가 왔다: 말 끝 기다림은 거두고 멈춤 지킴이를 다시 건다
      if (this.endWaitTimer !== null) this.timers.clear(this.endWaitTimer)
      this.endWaitTimer = null
      this.armStall(session)
      // 진단을 받던 듣는 쪽이 stop()했을 수 있다
      if (session !== this.session) return
    }
    const from = Number.isSafeInteger(event.resultIndex) && event.resultIndex >= 0 ? event.resultIndex : 0
    let finalHeard = false
    for (let i = from; i < results.length; i++) {
      const result = results[i]
      if (result === undefined || result === null) continue
      const transcript = result[0]?.transcript
      const text = typeof transcript === 'string' ? transcript.trim() : ''
      const final = result.isFinal === true
      // 끝에서 넘길 후보: 마지막으로 받은 결과가 글자 있는 중간 결과일 때만 (최종·빈 글이 오면 비운다)
      session.pending = !final && text !== '' ? { index: i, text } : null
      if (final) {
        // 같은 최종 결과를 두 번 알리지 않는다 (같은 위치가 다시 오는 경우)
        if (session.reported.has(i)) continue
        session.reported.add(i)
      }
      if (text === '') continue
      if (final) {
        this.limiter.reset()
        finalHeard = true
      }
      this.emitResult({ text, final })
    }
    // 쉬는 틈 다시 열기: 소리를 받는 오래 연 객체에서 최종 결과가 왔고 남은 중간 결과가 없다(판매자가 쉼)
    if (finalHeard && this.plannedRestart && this.wanted && session === this.session && session.live && session.pending === null && !session.planned) {
      const age = this.now() - session.openedAt
      if (Number.isFinite(age) && age >= PLANNED_RESTART_AFTER_MS) this.restartAtPause(session)
    }
  }

  /** 쉬는 틈에 먼저 닫고 다시 연다 (한도에 세지 않는다, "다시 시작 중" 없음) */
  private restartAtPause(session: Session): void {
    session.planned = true
    this.clearWatch()
    if (this.overlap) {
      const constructor = this.lookup()
      if (constructor === null) return
      // 겹쳐 열기(실험): 새 객체를 먼저 열고 옛 객체는 닫는 중으로 둔다
      this.draining = session
      this.gapStarts('planned')
      this.open(constructor, false, 0, 'planned')
      try {
        session.recognition.stop()
      } catch {
        if (this.draining === session) this.draining = null
      }
      return
    }
    this.gapStarts('planned')
    try {
      session.recognition.stop()
    } catch {
      // 이미 끝났다 — 바로 다시 연다
      this.handleEnd(session)
      return
    }
    // 끝(onend)이 늦으면 버리고 바로 새 객체를 연다
    this.plannedTimer = this.timers.set(() => {
      this.plannedTimer = null
      if (session !== this.session || !this.wanted) return
      try {
        session.recognition.abort()
      } catch {
        // 무시
      }
      this.handleEnd(session)
    }, PLANNED_END_WAIT_MS)
  }

  private handleError(session: Session, event: RecognitionErrorEventLike): void {
    if (session === this.draining || this.stalled.has(session)) return
    if (session !== this.session) return
    const code = typeof event?.error === 'string' ? event.error : ''
    if (RESTARTABLE_ERRORS.has(code)) {
      // 이어서 오는 끝(onend)에서 한도 안에서 다시 시작한다. network는 그 끝남을 센다(D-I5-17)
      if (code === 'network') session.networkFailed = true
      // 엔진이 닫은 객체의 aborted는 끊김 까닭을 바꾸지 않는다
      if (!(session.planned && code === 'aborted')) session.lastError = code
      return
    }
    const kind: SpeechErrorKind =
      !session.byUser && BLOCKED_ON_RESTART.has(code)
        ? 'RESTART_BLOCKED'
        : Object.hasOwn(FATAL_ERRORS, code)
          ? (FATAL_ERRORS[code] as SpeechErrorKind)
          : 'OTHER'
    // 다시 시작하지 않는 오류: 바로 멈춘다(이 객체의 늦은 끝 이벤트는 무시, 남은 중간 결과도 넘기지 않는다)
    this.session = null
    session.pending = null
    this.wanted = false
    this.gapFrom = null
    this.clearTimers()
    try {
      session.recognition.abort()
    } catch {
      // 무시
    }
    this.halt(kind)
  }

  /** 엔진이 닫은 옛 객체(겹쳐 열기·멈춤)가 끝났다: 남은 중간 결과만 넘긴다 (새 객체는 이미 듣는다) */
  private endRetired(session: Session): void {
    const pending = session.pending
    session.pending = null
    if (this.wanted && pending !== null && !session.reported.has(pending.index)) {
      session.reported.add(pending.index)
      this.emitResult({ text: pending.text, final: true, flushedAtEnd: true })
    }
  }

  private handleEnd(session: Session): void {
    if (session === this.draining) {
      this.draining = null
      this.endRetired(session)
      return
    }
    if (this.stalled.delete(session)) {
      this.endRetired(session)
      return
    }
    if (session !== this.session) return
    this.session = null
    this.clearWatch()
    if (this.plannedTimer !== null) this.timers.clear(this.plannedTimer)
    this.plannedTimer = null
    if (!this.wanted) {
      session.pending = null
      this.setState('OFF')
      return
    }
    const planned = session.planned
    // 끊김 시작 (소리 멈춤 알림이 없었으면 지금부터). 까닭: 엔진이 닫음 > 마지막 오류 > 그냥 끝남
    this.gapStarts(planned ? 'planned' : ((session.lastError as SpeechGapReason | null) ?? 'end'))
    // 저절로 끝났다: 최종이 되지 못한 마지막 중간 결과를 최종으로 한 번 넘긴다 (D-I5-02)
    const pending = session.pending
    session.pending = null
    if (pending !== null && !session.reported.has(pending.index)) {
      session.reported.add(pending.index)
      this.limiter.reset()
      this.emitResult({ text: pending.text, final: true, flushedAtEnd: true })
      // 듣는 쪽이 넘긴 결과를 받다가 stop()했으면 다시 시작하지 않는다
      if (!this.wanted || this.session !== null) return
    }
    // 판매자가 멈추지 않았는데 끝났다 → 한도 안에서 다시 시작.
    // 세는 끝남: 빨리 끝남(D-I5-01), network 뒤 끝남(D-I5-17), 모든 끝남 세기를 켰으면 모두(D-I5-18).
    // 엔진이 쉬는 틈에 닫은 것은 세지 않는다(network 뒤면 센다)
    const afterNetwork = session.networkFailed
    const counted = afterNetwork || (!planned && (this.countAllEnds || !this.limiter.isQuiet(session.openedAt)))
    if (counted && !this.limiter.recordEnd()) {
      this.wanted = false
      this.gapFrom = null
      // 한도에 걸린 끝남 바로 앞이 network면 연결 실패, 아니면 자꾸 끊김 (D-I5-17)
      this.halt(afterNetwork ? 'CONNECTION_FAILED' : 'KEEPS_STOPPING')
      return
    }
    const constructor = this.lookup()
    if (constructor === null) {
      this.wanted = false
      this.gapFrom = null
      this.halt('UNSUPPORTED')
      return
    }
    // 센 끝남 뒤에만 "다시 시작 중"을 알린다. 세지 않은 끝남(조용함·쉬는 틈 다시 열기)은 듣는 중 그대로 새 객체를 연다 (D-I5-14)
    if (counted) this.setState('RESTARTING')
    // 기다리지 않고 바로 새 객체를 연다 (끝 이벤트 안에서 start())
    this.open(constructor, false, 0, this.gapFrom?.reason ?? (planned ? 'planned' : 'end'))
  }
}

/** Web Speech 엔진을 만든다 (인식 객체는 start()에서만 만든다) */
export function createWebSpeechEngine(options: WebSpeechOptions): WebSpeechEngine {
  return new WebSpeechEngine(options)
}
