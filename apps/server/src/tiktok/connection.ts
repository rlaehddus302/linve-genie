// 틱톡 연결 객체: 연결·다시 연결·시간 초과·멈춤과 쉬운 한국어 상태 (PLT-02, D-N2b-1-04·05·06, AC-N2b-1-23·24·30~38·40·41·50).
// 판매자 하나의 틱톡 연결 하나를 맡는다. 레코드는 콜백으로만 내보낸다 — 저장소·DB·쓰기 경로·실시간 알림을 부르지 않는다(D-N2b-1-08).
// 시계·타이머는 주입한다. 열린 연결은 언제나 많아야 하나다: 새 클라이언트를 만들기 전에 이전 클라이언트를 닫고, 버린 시도의 늦은 성공도 바로 닫는다.
import { type LogCode, type LogLevel, type LogSink, safeSink, stderrLog } from '../log.ts'
import { systemTikTokClock, type TikTokClock } from './clock.ts'
import { chatEventFields, createCommentFilter, type TikTokCommentCounts, type TikTokCommentFilter, type TikTokCommentRecord } from './comment.ts'
import { denyAllTikTokConsent, type TikTokConsentCheck } from './consent.ts'
import { tiktokAvatarUrl } from './avatar.ts'
import { classifyWebcastFailure, type TikTokFailureKind, type TikTokRetryKind } from './failure.ts'
import type { TikTokSignMeter } from './sign-usage.ts'
import { UNLIMITED_TIKTOK_ATTEMPTS, type TikTokAttemptLimiter } from './limiter.ts'
import { tiktokStatusMessage, type TikTokOffReason, type TikTokState, type TikTokStopReason } from './messages.ts'
import { libraryOptions, TIKTOK_SETTINGS_OFF, type TikTokSettings } from './settings.ts'
import { isTikTokTarget, type TikTokTarget } from './target.ts'
import { WEBCAST_EVENTS, type WebcastClient, type WebcastFactory } from './webcast.ts'

/** 다시 시도 간격 — 연속 실패 수 1~8 (D-N2b-1-05) */
export const TIKTOK_RETRY_DELAYS_MS: readonly number[] = Object.freeze([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000])
/** 연속 실패가 이만큼이면 멈춘다 (처음 + 다시 8번) */
export const TIKTOK_GIVE_UP_AFTER = 9
/** 연결이 이만큼 유지되면 연속 실패 수를 0으로 */
export const TIKTOK_STABLE_MS = 60_000
/** 연결 시도가 이 안에 되지 않으면 NETWORK 실패 */
export const TIKTOK_CONNECT_TIMEOUT_MS = 20_000
/** 판매자 동의 확인이 이 안에 끝나지 않으면 동의 없음 */
export const TIKTOK_CONSENT_TIMEOUT_MS = 20_000
/** 받는 중 이만큼 아무 자료(댓글이 아닌 것 포함)도 오지 않으면 끊긴 것으로 본다 (D-N2b-2-11 (가)) */
export const TIKTOK_STALL_MS = 120_000
/** 방송 전(NOT_LIVE)은 이 간격으로 다시 확인한다 — 연속 실패 수에 넣지 않는다 (D-N2b-2-11 (라)) */
export const TIKTOK_NOT_LIVE_RETRY_MS = 60_000
/** 방송 전이 이어진 지 이만큼이 되도록 시작하지 않으면 멈춘다 */
export const TIKTOK_NOT_LIVE_GIVE_UP_MS = 60 * 60 * 1000
/** 연결 객체 하나의 같은 로그 코드는 이 창 안에 이만큼까지 (D-N2b-2-11 (마)) */
export const TIKTOK_LOG_WINDOW_MS = 60_000
export const TIKTOK_LOG_PER_WINDOW = 5

export type TikTokReason = TikTokRetryKind | TikTokStopReason | TikTokOffReason

/** 상태 조회 결과 (AC-N2b-1-30) */
export interface TikTokConnectionStatus {
  readonly state: TikTokState
  readonly reason: TikTokReason | null
  /** 판매자에게 그대로 보이는 문장 */
  readonly message: string
  /** 지금 연속 실패 수 */
  readonly failures: number
  /** 다음 다시 시도 시각 (UTC ISO 밀리초) — RETRYING일 때만 */
  readonly nextAttemptAt: string | null
  /** 마지막 실패 종류 */
  readonly lastFailure: TikTokFailureKind | null
  /** 받던 연결이 판매자가 끊지 않았는데 끊겼다 — start()를 부를 때까지 true (안내 문장 TIKTOK_MISSED_MESSAGE) */
  readonly missed: boolean
  readonly counts: TikTokCommentCounts
}

export interface TikTokConnectionOptions {
  /** 동의를 확인할 판매자 ID */
  readonly sellerId: string
  /** checkTikTokTarget이 돌려준 연결 대상 (해석에 실패한 입력으로는 만들 수 없다) */
  readonly target: TikTokTarget
  /** 웹캐스트 클라이언트를 만드는 곳: 실제 libraryWebcast() 또는 가짜 FakeWebcast.factory */
  readonly webcast: WebcastFactory
  /** 레코드를 받는 쪽. 들어온 순서대로 하나씩 부른다. 오류를 던져도(동기·비동기) 연결과 다음 댓글은 계속된다 */
  readonly onRecord: (record: TikTokCommentRecord) => unknown
  /** state·reason·failures·missed 중 하나라도 바뀔 때마다 한 번 */
  readonly onStatus?: (status: TikTokConnectionStatus) => unknown
  /** readTikTokSettings 결과. 없으면 꺼짐 */
  readonly settings?: TikTokSettings
  /** 판매자 동의 확인. 없으면 모두 거절 */
  readonly consent?: TikTokConsentCheck
  /** 연결될 때 방 정보에서 꺼낸 방송자 프로필 사진 주소 (틱톡 이미지 서버 https만, D-TT-PHOTO-01). 오류를 던져도 연결은 계속된다 */
  readonly onAvatar?: (url: string) => unknown
  readonly clock?: TikTokClock
  readonly log?: LogSink
  /** 서버 전체 연결 시도 한도 (서버 하나의 모든 연결 객체가 같은 것을 나눈다 — 없으면 한도 없음) */
  readonly limiter?: TikTokAttemptLimiter
  /** 서명 서비스 무료 한도 계량 (CH-20 — 없으면 세지 않는다) */
  readonly signMeter?: TikTokSignMeter
}

/** 연결 객체 — 조작은 start·stop·off와 상태 조회뿐이다(틱톡에 무엇을 보내는 조작은 없다) */
export interface TikTokConnection {
  /** IDLE·RETRYING·STOPPED·ENDED·OFF에서 연속 실패 0으로 바로 연결 시도. CONNECTING·CONNECTED에서는 아무 일도 없다 */
  start(): void
  /** start와 같되 "끊긴 동안 받지 못했을 수 있음"(missed)을 켠 채로 시작한다 — 서버가 다시 켜진 뒤 이어받기 (AC-N2b-2-35) */
  resume(): void
  /** 어느 상태에서든 STOPPED(BY_SELLER). 남은 타이머를 지우고 열린 연결을 닫는다. 돌아온 뒤에는 레코드가 가지 않는다 */
  stop(): void
  /** 어느 상태에서든 OFF(그 이유). 남은 타이머를 지우고 열린 연결을 닫는다 — 판매자가 틱톡을 끔·운영자 끔 (AC-N2b-2-23) */
  off(reason: TikTokOffReason): void
  status(): TikTokConnectionStatus
}

interface Attempt {
  client: WebcastClient | null
}

const memories = new WeakMap<TikTokConnection, TikTokCommentFilter>()

/** 연결 객체가 기억하는 댓글 ID 수 (시험용 조회 — 연결 객체의 조작에는 넣지 않는다) */
export function tiktokConnectionMemorySize(connection: TikTokConnection): number {
  return memories.get(connection)?.memorySize ?? 0
}

const STANDARD_ERRORS: ReadonlySet<string> = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError'])

/** 로그에 남길 오류 종류: 표준 오류 이름만 (이름에 값을 심어도 새지 않게) */
function standardKind(error: unknown): string {
  if (error instanceof Error && STANDARD_ERRORS.has(error.name)) return error.name
  return error instanceof Error ? 'Error' : 'NotError'
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function'
}

export function createTikTokConnection(options: TikTokConnectionOptions): TikTokConnection {
  if (!isTikTokTarget(options.target)) throw new TypeError('틱톡 연결 대상은 아이디 해석(checkTikTokTarget)에 성공한 값이어야 한다')
  if (typeof options.sellerId !== 'string' || options.sellerId === '') throw new TypeError('판매자 ID가 필요하다')
  if (typeof options.webcast !== 'function' || typeof options.onRecord !== 'function') throw new TypeError('웹캐스트 클라이언트와 레코드 받는 쪽이 필요하다')

  const sellerId = options.sellerId
  const uniqueId = options.target.uniqueId
  const webcast = options.webcast
  const onRecord = options.onRecord
  const onStatus = options.onStatus
  const settings = options.settings ?? TIKTOK_SETTINGS_OFF
  const consent = options.consent ?? denyAllTikTokConsent
  const clock = options.clock ?? systemTikTokClock
  const sink = safeSink(options.log ?? stderrLog)
  const limiter = options.limiter ?? UNLIMITED_TIKTOK_ATTEMPTS
  const filter = createCommentFilter(uniqueId)

  let state: TikTokState = 'IDLE'
  let reason: TikTokReason | null = null
  let failures = 0
  let nextAttemptAt: number | null = null
  let lastFailure: TikTokFailureKind | null = null
  let missed = false
  /** 지금 시도 (동의 확인부터 연결 성공·실패, 받는 중까지). 바뀌면 이전 시도의 콜백·이벤트는 모두 무시한다 */
  let current: Attempt | null = null
  let cancelRetry: (() => void) | null = null
  let cancelAttemptTimer: (() => void) | null = null
  let cancelStable: (() => void) | null = null
  /** 받는 중 자료가 끊긴 것 보기 (120초) */
  let cancelStall: (() => void) | null = null
  /** 서버 전체 한도로 미룬 연결 시도 */
  let cancelDefer: (() => void) | null = null
  /** 지금 시도를 시작한 시각 (바깥 연결을 부른 때) */
  let attemptStartedAt: number | null = null
  /** 방송 전(NOT_LIVE)이 이어진 기간의 첫 시도 시각 — NOT_LIVE가 아닌 결과나 연결되면 지운다 */
  let notLiveSince: number | null = null

  /** 같은 로그 코드는 60초에 5번까지 — 넘친 수는 세었다가 그 코드를 다음에 남길 때 함께 적는다 (값·문장 없이) */
  const logTimes = new Map<LogCode, number[]>()
  const logSuppressed = new Map<LogCode, number>()
  const log = (level: LogLevel, code: LogCode, extra: { errorKind?: string; count?: number } = {}): void => {
    const now = clock.now()
    const recent = (logTimes.get(code) ?? []).filter((at) => at > now - TIKTOK_LOG_WINDOW_MS)
    if (recent.length >= TIKTOK_LOG_PER_WINDOW) {
      logTimes.set(code, recent)
      logSuppressed.set(code, (logSuppressed.get(code) ?? 0) + 1)
      return
    }
    recent.push(now)
    logTimes.set(code, recent)
    const suppressed = logSuppressed.get(code) ?? 0
    logSuppressed.delete(code)
    sink({ level, code, ...extra, ...(suppressed > 0 ? { suppressed } : {}) })
  }

  /** 콜백 안에서 생긴 뜻밖의 예외가 밖으로 새지 않게 (로그 코드 하나) */
  const guarded =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      try {
        fn(...args)
      } catch (error) {
        log('error', 'TIKTOK_EVENT_FAILED', { errorKind: standardKind(error) })
      }
    }

  const snapshot = (): TikTokConnectionStatus =>
    Object.freeze({
      state,
      reason,
      message: tiktokStatusMessage(state, reason) ?? '',
      failures,
      nextAttemptAt: nextAttemptAt === null ? null : new Date(nextAttemptAt).toISOString(),
      lastFailure,
      missed,
      counts: filter.counts(),
    })

  const notify = (): void => {
    if (onStatus === undefined) return
    try {
      const result = onStatus(snapshot())
      if (isThenable(result)) Promise.resolve(result).catch((error: unknown) => log('error', 'TIKTOK_STATUS_FAILED', { errorKind: standardKind(error) }))
    } catch (error) {
      log('error', 'TIKTOK_STATUS_FAILED', { errorKind: standardKind(error) })
    }
  }

  /** 상태를 바꾸고, state·reason·failures·missed 중 하나라도 바뀌었으면 알림을 정확히 한 번 */
  const change = (mutate: () => void): void => {
    const before = `${state}|${String(reason)}|${String(failures)}|${String(missed)}`
    mutate()
    if (`${state}|${String(reason)}|${String(failures)}|${String(missed)}` !== before) notify()
  }

  const closeClient = (client: WebcastClient): void => {
    try {
      const result = client.disconnect()
      if (isThenable(result)) Promise.resolve(result).catch(() => undefined)
    } catch {
      // 닫다 난 오류는 무시한다 (이미 버린 연결)
    }
  }

  const clearTimers = (): void => {
    cancelRetry?.()
    cancelAttemptTimer?.()
    cancelStable?.()
    cancelStall?.()
    cancelDefer?.()
    cancelRetry = null
    cancelAttemptTimer = null
    cancelStable = null
    cancelStall = null
    cancelDefer = null
  }

  /** 지금 시도를 버린다: 타이머를 지우고, 이벤트를 무시하고, 클라이언트를 닫는다 */
  const abandon = (): void => {
    const attempt = current
    current = null
    clearTimers()
    if (attempt?.client) closeClient(attempt.client)
  }

  /** delay 뒤 다시 시도를 예약한다 (RETRYING). 그때 서버 전체 한도가 차 있으면 자리가 날 때까지 미룬다 — 실패로 세지 않는다 */
  const scheduleRetry = (delay: number): void => {
    nextAttemptAt = clock.now() + delay
    let fired = false
    const cancel = clock.setTimer(
      delay,
      guarded(() => {
        if (fired || cancelRetry !== cancel) return
        fired = true
        cancelRetry = null
        const wait = limiter.wait(clock.now())
        if (wait > 0) {
          scheduleRetry(wait)
          return
        }
        change(begin)
      }),
    )
    cancelRetry = cancel
  }

  /** 실패 하나를 센다 (abandon 뒤에 부른다) */
  const fail = (kind: TikTokFailureKind): void => {
    nextAttemptAt = null
    if (kind === 'NOT_LIVE') {
      // 방송 전: 연속 실패 수에 넣지 않고 1분마다 다시 본다. 이어진 지 60분이 되면 멈춘다 (D-N2b-2-11 (라))
      lastFailure = kind
      const startedAt = attemptStartedAt ?? clock.now()
      if (notLiveSince === null) notLiveSince = startedAt
      if (startedAt - notLiveSince >= TIKTOK_NOT_LIVE_GIVE_UP_MS) {
        state = 'STOPPED'
        reason = 'GAVE_UP'
        log('warn', 'TIKTOK_GAVE_UP', { errorKind: kind, count: failures })
        return
      }
      state = 'RETRYING'
      reason = kind
      scheduleRetry(TIKTOK_NOT_LIVE_RETRY_MS)
      return
    }
    notLiveSince = null
    failures += 1
    lastFailure = kind
    if (kind === 'USER_NOT_FOUND') {
      state = 'STOPPED'
      reason = 'USER_NOT_FOUND'
      return
    }
    if (failures >= TIKTOK_GIVE_UP_AFTER) {
      state = 'STOPPED'
      reason = 'GAVE_UP'
      log('warn', 'TIKTOK_GAVE_UP', { errorKind: kind, count: failures })
      return
    }
    const delay = TIKTOK_RETRY_DELAYS_MS[failures - 1] ?? TIKTOK_STABLE_MS
    state = 'RETRYING'
    reason = kind
    scheduleRetry(delay)
  }

  /** 받는 중 자료가 오면 120초 시계를 다시 잰다. 120초 동안 아무 자료도 없으면 그 연결을 닫고 NETWORK 끊김처럼 다룬다 (AC-N2b-2-40) */
  const watchStall = (attempt: Attempt): void => {
    cancelStall?.()
    const cancel = clock.setTimer(
      TIKTOK_STALL_MS,
      guarded(() => {
        if (current !== attempt || state !== 'CONNECTED' || cancelStall !== cancel) return
        cancelStall = null
        log('warn', 'TIKTOK_STALLED', { count: failures })
        change(() => {
          abandon()
          missed = true
          fail('NETWORK')
        })
      }),
    )
    cancelStall = cancel
  }

  const handleChat = (event: unknown): void => {
    const outcome = filter.accept(chatEventFields(event), new Date(clock.now()))
    if (!('record' in outcome)) return
    try {
      const result = onRecord(outcome.record)
      if (isThenable(result)) Promise.resolve(result).catch((error: unknown) => log('error', 'TIKTOK_RECORD_FAILED', { errorKind: standardKind(error) }))
    } catch (error) {
      log('error', 'TIKTOK_RECORD_FAILED', { errorKind: standardKind(error) })
    }
  }

  const listen = (attempt: Attempt, client: WebcastClient): void => {
    client.on(
      WEBCAST_EVENTS.CHAT,
      guarded((event: unknown) => {
        if (current !== attempt || state !== 'CONNECTED') return
        watchStall(attempt)
        handleChat(event)
      }),
    )
    // 웹캐스트에서 받은 모든 자료 (댓글 아닌 이벤트·방 정보·하트비트 응답 포함) — 멈춘 연결 보기 시계를 되돌린다
    client.on(
      WEBCAST_EVENTS.DATA,
      guarded(() => {
        if (current === attempt && state === 'CONNECTED') watchStall(attempt)
      }),
    )
    client.on(
      WEBCAST_EVENTS.DISCONNECTED,
      guarded(() => {
        if (current !== attempt || state !== 'CONNECTED') return
        log('warn', 'TIKTOK_DISCONNECTED', { count: failures })
        change(() => {
          abandon()
          missed = true
          fail('NETWORK')
        })
      }),
    )
    client.on(
      WEBCAST_EVENTS.STREAM_END,
      guarded(() => {
        if (current !== attempt || (state !== 'CONNECTED' && state !== 'CONNECTING')) return
        change(() => {
          const wasConnected = state === 'CONNECTED'
          abandon()
          if (wasConnected) missed = true
          state = 'ENDED'
          reason = null
          nextAttemptAt = null
        })
      }),
    )
    // 연결된 뒤의 error 이벤트는 그것만으로 상태를 바꾸지 않는다 (실제로 끊기면 disconnected). 듣는 쪽이 있어야 이벤트가 예외로 바뀌지 않는다
    client.on(
      WEBCAST_EVENTS.ERROR,
      guarded(() => {
        if (current === attempt && state === 'CONNECTED') log('warn', 'TIKTOK_LIBRARY_ERROR')
      }),
    )
  }

  const connected = (attempt: Attempt): void => {
    cancelAttemptTimer?.()
    cancelAttemptTimer = null
    state = 'CONNECTED'
    reason = null
    nextAttemptAt = null
    notLiveSince = null
    watchStall(attempt)
    const cancel = clock.setTimer(
      TIKTOK_STABLE_MS,
      guarded(() => {
        if (current !== attempt || state !== 'CONNECTED' || cancelStable !== cancel) return
        cancelStable = null
        change(() => {
          failures = 0
        })
      }),
    )
    cancelStable = cancel
  }

  /** 동의를 얻은 뒤 클라이언트를 만들어 연결한다. 서버 전체 한도가 차 있으면 자리가 날 때까지 미룬다(CONNECTING 그대로, 실패로 세지 않음) */
  const connect = (attempt: Attempt): void => {
    if (current !== attempt || state !== 'CONNECTING') return
    const wait = limiter.reserve(clock.now())
    if (wait > 0) {
      const cancel = clock.setTimer(
        wait,
        guarded(() => {
          if (cancelDefer !== cancel) return
          cancelDefer = null
          connect(attempt)
        }),
      )
      cancelDefer = cancel
      return
    }
    attemptStartedAt = clock.now()
    if (options.signMeter !== undefined) {
      const usage = options.signMeter.record(attemptStartedAt)
      // 수준이 바뀐 때만 한 번 경고한다 (수만 남기고 아이디·키는 남기지 않는다). 연결은 막지 않는다
      if (usage.changed && usage.level !== 'OK') log('warn', usage.level === 'OVER' ? 'TIKTOK_SIGN_OVER_LIMIT' : 'TIKTOK_SIGN_NEAR_LIMIT', { count: usage.used })
    }
    let client: WebcastClient
    let pending: Promise<unknown>
    try {
      client = webcast(uniqueId, libraryOptions(settings))
      attempt.client = client
      listen(attempt, client)
      pending = Promise.resolve(client.connect())
    } catch (error) {
      pending = Promise.reject(error)
    }
    cancelAttemptTimer = clock.setTimer(
      TIKTOK_CONNECT_TIMEOUT_MS,
      guarded(() => {
        if (current !== attempt || state !== 'CONNECTING') return
        log('warn', 'TIKTOK_CONNECT_FAILED', { errorKind: 'NETWORK', count: failures + 1 })
        change(() => {
          abandon()
          fail('NETWORK')
        })
      }),
    )
    pending.then(
      guarded((result: unknown) => {
        if (current !== attempt || state !== 'CONNECTING') {
          // 시간이 지났거나 멈춘 뒤의 늦은 성공: 바로 닫고 쓰지 않는다
          if (attempt.client) closeClient(attempt.client)
          log('info', 'TIKTOK_LATE_CLOSED')
          return
        }
        change(() => connected(attempt))
        // 방 정보의 방송자 프로필 사진 주소 (D-TT-PHOTO-01) — 받는 쪽 오류는 연결에 닿지 않는다
        const avatar = options.onAvatar === undefined ? null : tiktokAvatarUrl(result)
        if (avatar !== null) {
          try {
            const reported = options.onAvatar?.(avatar)
            if (isThenable(reported)) Promise.resolve(reported).catch(() => undefined)
          } catch {
            // 사진은 없어도 된다
          }
        }
      }),
      guarded((error: unknown) => {
        if (current !== attempt || state !== 'CONNECTING') return
        const kind = classifyWebcastFailure(error)
        log('warn', 'TIKTOK_CONNECT_FAILED', { errorKind: kind, count: failures + 1 })
        change(() => {
          abandon()
          fail(kind)
        })
      }),
    )
  }

  const askConsent = async (): Promise<boolean> => {
    try {
      return (await consent(sellerId)) === true
    } catch (error) {
      log('warn', 'TIKTOK_CONSENT_FAILED', { errorKind: standardKind(error) })
      return false
    }
  }

  const denyConsent = (): void => {
    abandon()
    state = 'OFF'
    reason = 'NO_CONSENT'
    nextAttemptAt = null
  }

  /** 연결 시도 하나 (처음·다시 시도): 운영자 스위치 → 동의 → 연결. 상태를 바꾸는 쪽(change 안)에서 부른다 */
  function begin(): void {
    abandon()
    nextAttemptAt = null
    if (settings.beta !== true) {
      state = 'OFF'
      reason = 'OPERATOR_OFF'
      return
    }
    const attempt: Attempt = { client: null }
    current = attempt
    state = 'CONNECTING'
    reason = null
    let decided = false
    cancelAttemptTimer = clock.setTimer(
      TIKTOK_CONSENT_TIMEOUT_MS,
      guarded(() => {
        if (decided || current !== attempt) return
        decided = true
        log('warn', 'TIKTOK_CONSENT_FAILED', { errorKind: 'Timeout' })
        change(denyConsent)
      }),
    )
    void askConsent().then(
      guarded((allowed: boolean) => {
        if (decided || current !== attempt) return
        decided = true
        cancelAttemptTimer?.()
        cancelAttemptTimer = null
        if (allowed) connect(attempt)
        else change(denyConsent)
      }),
    )
  }

  const startWith = (keepMissed: boolean): void => {
    if (state === 'CONNECTING' || state === 'CONNECTED') return
    change(() => {
      failures = 0
      lastFailure = null
      missed = keepMissed
      notLiveSince = null
      begin()
    })
  }

  const connection: TikTokConnection = Object.freeze({
    start: guarded(() => startWith(false)),
    resume: guarded(() => startWith(true)),
    stop: guarded(() => {
      change(() => {
        abandon()
        state = 'STOPPED'
        reason = 'BY_SELLER'
        nextAttemptAt = null
      })
    }),
    off: guarded((why: TikTokOffReason) => {
      change(() => {
        abandon()
        state = 'OFF'
        reason = why
        nextAttemptAt = null
      })
    }),
    status: snapshot,
  })
  memories.set(connection, filter)
  return connection
}
