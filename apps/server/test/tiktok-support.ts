// 틱톡 연결 시험 도우미 (N2b-1). 가짜 웹캐스트·가짜 시계·기록 받이로 연결 객체 하나를 만든다.
import type { LogRecord } from '../src/log.ts'
import {
  checkTikTokTarget,
  createTikTokConnection,
  FakeTikTokClock,
  FakeWebcast,
  flushTikTokTasks,
  readTikTokSettings,
  type FakeAccountState,
  type TikTokCommentRecord,
  type TikTokConnection,
  type TikTokConnectionStatus,
  type TikTokConsentCheck,
  type TikTokTarget,
  type WebcastFactory,
} from '../src/tiktok/index.ts'

export const SEC = 1000

export function targetOf(input: string): TikTokTarget {
  const checked = checkTikTokTarget(input)
  if (!checked.ok) throw new Error(`시험 준비: 해석 실패 ${input}`)
  return checked.target
}

export interface Rig {
  readonly fake: FakeWebcast
  readonly clock: FakeTikTokClock
  readonly records: TikTokCommentRecord[]
  readonly statuses: TikTokConnectionStatus[]
  readonly logs: LogRecord[]
  readonly consentCalls: string[]
  readonly conn: TikTokConnection
  /** 마이크로태스크까지 돌린다 */
  flush(): Promise<void>
  /** 시각(초)까지 시계를 돌린다 */
  at(seconds: number): Promise<void>
}

export interface RigOptions {
  readonly beta?: string | undefined
  readonly signKey?: string
  readonly consent?: TikTokConsentCheck | 'default'
  readonly account?: FakeAccountState
  readonly target?: string
  readonly sellerId?: string
  readonly fake?: FakeWebcast
  readonly clock?: FakeTikTokClock
  readonly webcast?: WebcastFactory
  readonly onRecord?: (record: TikTokCommentRecord) => unknown
  readonly onStatus?: (status: TikTokConnectionStatus) => unknown
  readonly extra?: Record<string, unknown>
}

export function rig(options: RigOptions = {}): Rig {
  const uniqueId = options.target ?? 'seller_kim'
  const fake = options.fake ?? new FakeWebcast().account(uniqueId, options.account ?? 'LIVE')
  const clock = options.clock ?? new FakeTikTokClock(0)
  const records: TikTokCommentRecord[] = []
  const statuses: TikTokConnectionStatus[] = []
  const logs: LogRecord[] = []
  const consentCalls: string[] = []
  const env: Record<string, string | undefined> = { LIVEJJIM_TIKTOK_BETA: 'beta' in options ? options.beta : 'on' }
  if (options.signKey !== undefined) env['LIVEJJIM_TIKTOK_SIGN_API_KEY'] = options.signKey
  const check: TikTokConsentCheck | undefined = options.consent === 'default' ? undefined : (options.consent ?? (async () => true))
  const consent: TikTokConsentCheck | undefined =
    check === undefined
      ? undefined
      : (sellerId) => {
          consentCalls.push(sellerId)
          return check(sellerId)
        }
  const conn = createTikTokConnection({
    sellerId: options.sellerId ?? 'seller-1',
    target: targetOf(uniqueId),
    webcast: options.webcast ?? fake.factory,
    onRecord: (record) => {
      records.push(record)
      return options.onRecord?.(record)
    },
    onStatus: (status) => {
      statuses.push(status)
      return options.onStatus?.(status)
    },
    settings: readTikTokSettings(env),
    ...(consent === undefined ? {} : { consent }),
    clock,
    log: (record) => logs.push(record),
    ...options.extra,
  })
  return {
    fake,
    clock,
    records,
    statuses,
    logs,
    consentCalls,
    conn,
    flush: flushTikTokTasks,
    at: (seconds) => clock.advanceTo(seconds * SEC),
  }
}

/** 상태 조회에서 시험이 자주 보는 칸만 */
export function brief(status: TikTokConnectionStatus): { state: string; reason: string | null; failures: number; nextAttemptAt: string | null } {
  return { state: status.state, reason: status.reason, failures: status.failures, nextAttemptAt: status.nextAttemptAt }
}

export const iso = (seconds: number): string => new Date(seconds * SEC).toISOString()

let nextId = 7_301_000_000_000_000_000n
/** 서로 다른 댓글 ID */
export function freshId(): string {
  nextId += 1n
  return nextId.toString()
}

export function chatFields(msgId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { msgId, userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15', createTime: '1700000000000', ...extra }
}
