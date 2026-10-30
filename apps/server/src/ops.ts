// 운영 모니터링 (SYS-05, DAT-02, D-073, D-I3-16, AC-I3-80~83): 경보 기록과 워커 건강.
// - 경보: `level: 'alert'` JSON 한 줄(정해진 코드·셈·서버가 만든 판매자 ID·범위 날짜·워커 이름만 — 채팅·닉네임·토큰·전화번호·IP·요청 본문·오류 메시지 없음).
//   같은 코드(같은 판매자·같은 워커)는 10분에 한 번이고, 그 사이 일어난 수는 다음 경보의 count에 담는다.
// - 대부분의 경보는 이미 남기던 로그에서 나온다(observe): 처리 실패 표시(ENGINE_FAILED), 확인하지 못한 감사(OUTBOX_UNCONFIRMED), 다시 시도를 다 쓴 감사
//   (OUTBOX_GAVE_UP), 저절로 이어받지 않는 수집 멈춤(COLLECTOR_STOPPED — 채팅 꺼짐·권한 없음·채팅 없음), 구글 할당량 초과(QUOTA_EXCEEDED), 봉인 실패(SEAL_FAILED).
//   워커가 연속 3번 실패하면 WORKER_FAILING, 준비 확인 실패는 DB_UNAVAILABLE, 백업 실패는 BACKUP_FAILED(운영 백업 명령이 직접 쓴다 — seller 칸 없음).
//   판매자 자동 백업 실패(BackupScheduler의 BACKUP_FAILED 오류 로그 — 판매자 ID·까닭 종류만)도 seller 칸이 있는 BACKUP_FAILED 경보로 낸다(PL1A D-PL1-02 — 같은 판매자는 10분에 한 번).
// - 문서 docs/DEPLOY.md "운영 모니터링"의 경보 코드 목록은 ALERT_CODES와 같아야 한다(시험이 맞댄다).
import type { LogRecord, LogSink } from './log.ts'
import type { Clock } from './time.ts'

export const ALERT_CODES = [
  'TRANSCRIBE_NO_WORKER',
  'WORKER_FAILING',
  'ENGINE_FAILED',
  'OUTBOX_UNCONFIRMED',
  'OUTBOX_GAVE_UP',
  'COLLECTOR_STOPPED',
  'QUOTA_EXCEEDED',
  'SEAL_FAILED',
  'BACKUP_FAILED',
  'DB_UNAVAILABLE',
  // YT-11 서버 웹 읽기 (D-YT-SRV-06): 판매자 정보·응답 본문 없음
  'YT_CHAT_BLOCKED',
  'YT_CHAT_FORMAT',
  'YT_CHAT_NETWORK',
] as const
export type AlertCode = (typeof ALERT_CODES)[number]

/** 같은 경보를 다시 쓰기까지 (10분) */
export const ALERT_THROTTLE_MS = 10 * 60 * 1000
/** 워커가 이만큼 연속 실패하면 경보 */
export const WORKER_ALERT_AFTER = 3
/** 기억하는 경보 키 수 상한 (넘으면 오래된 것부터 잊는다) */
const ALERT_KEYS_MAX = 10_000

export type WorkerName = 'collector' | 'outbox' | 'sealer'
export const WORKER_NAMES: readonly WorkerName[] = ['collector', 'outbox', 'sealer']

/** 저절로 이어받지 않아 판매자가 다시 시작해야 하는 수집 멈춤 이유 */
const MANUAL_STOP_REASONS = new Set(['CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND'])

export interface AlertFields {
  readonly seller?: string
  readonly date?: string
  readonly worker?: WorkerName
}

export class Alerter {
  readonly #sink: LogSink
  readonly #clock: Clock
  readonly #seen = new Map<string, { at: number; suppressed: number }>()

  constructor(sink: LogSink, clock: Clock) {
    this.#sink = sink
    this.#clock = clock
  }

  /** 경보 하나 (10분에 한 번 — 그 사이 수는 다음 경보의 count에) */
  alert(code: AlertCode, fields: AlertFields = {}): void {
    const key = `${code}|${fields.seller ?? ''}|${fields.worker ?? ''}`
    const now = this.#clock.now()
    const seen = this.#seen.get(key)
    if (seen !== undefined && now - seen.at < ALERT_THROTTLE_MS) {
      seen.suppressed += 1
      return
    }
    const count = (seen?.suppressed ?? 0) + 1
    this.#seen.delete(key)
    this.#seen.set(key, { at: now, suppressed: 0 })
    while (this.#seen.size > ALERT_KEYS_MAX) {
      const oldest = this.#seen.keys().next().value
      if (oldest === undefined) break
      this.#seen.delete(oldest)
    }
    this.#sink({
      level: 'alert',
      code,
      count,
      ...(fields.seller === undefined ? {} : { seller: fields.seller }),
      ...(fields.date === undefined ? {} : { date: fields.date }),
      ...(fields.worker === undefined ? {} : { worker: fields.worker }),
    })
  }

  /** 이미 남기던 로그에서 경보를 꺼낸다 (경보 기록 자체는 보지 않는다) */
  observe(record: LogRecord): void {
    if (record.level === 'alert') return
    const fields: AlertFields = { ...(record.seller === undefined ? {} : { seller: record.seller }), ...(record.date === undefined ? {} : { date: record.date }) }
    switch (record.code) {
      case 'ENGINE_FAILED':
      case 'OUTBOX_UNCONFIRMED':
      case 'OUTBOX_GAVE_UP':
      case 'QUOTA_EXCEEDED':
      case 'SEAL_FAILED':
        this.alert(record.code, fields)
        return
      case 'BACKUP_FAILED':
        // 판매자 자동 백업 실패 (D-PL1-02): 판매자 ID가 있는 오류 로그만 — 운영 백업 명령은 경보를 직접 쓴다
        if (record.seller !== undefined) this.alert('BACKUP_FAILED', { seller: record.seller })
        return
      case 'COLLECTOR_STOPPED':
        if (record.reason !== undefined && MANUAL_STOP_REASONS.has(record.reason)) this.alert('COLLECTOR_STOPPED', fields)
        return
      case 'YT_CHAT_BLOCKED':
      case 'YT_CHAT_FORMAT':
      case 'YT_CHAT_NETWORK':
        // 서버 웹 읽기 (D-YT-SRV-06): 판매자 정보 없이 — 같은 코드는 10분에 한 번
        this.alert(record.code)
        return
      default:
        return
    }
  }
}

export interface WorkerStatus {
  /** 마지막으로 성공한 바퀴 (UTC ISO, 없으면 null) */
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
}

/** 워커(수집기·발송함·봉인) 바퀴마다 성공·실패를 센다 — 연속 3번 실패면 경보 */
export class WorkerHealth {
  readonly #alerter: Alerter
  readonly #clock: Clock
  readonly #state = new Map<WorkerName, { lastSuccessAt: number | null; failures: number }>()

  constructor(alerter: Alerter, clock: Clock) {
    this.#alerter = alerter
    this.#clock = clock
    for (const name of WORKER_NAMES) this.#state.set(name, { lastSuccessAt: null, failures: 0 })
  }

  pass(worker: WorkerName, ok: boolean): void {
    const state = this.#state.get(worker) ?? { lastSuccessAt: null, failures: 0 }
    if (ok) {
      state.lastSuccessAt = this.#clock.now()
      state.failures = 0
    } else {
      state.failures += 1
      if (state.failures >= WORKER_ALERT_AFTER) this.#alerter.alert('WORKER_FAILING', { worker })
    }
    this.#state.set(worker, state)
  }

  view(): Record<WorkerName, WorkerStatus> {
    const out = {} as Record<WorkerName, WorkerStatus>
    for (const name of WORKER_NAMES) {
      const state = this.#state.get(name) ?? { lastSuccessAt: null, failures: 0 }
      out[name] = { lastSuccessAt: state.lastSuccessAt === null ? null : new Date(state.lastSuccessAt).toISOString(), consecutiveFailures: state.failures }
    }
    return out
  }
}
