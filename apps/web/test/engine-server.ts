// 화면 단위 시험 도우미: 실제 코어 엔진으로 도는 가짜 서버 (한 날짜·실제 범위, 방송 b1·b2).
// 서버 계약(harness/sprints/S04·S05·S06 dev-notes)의 모양대로 범위 조회·증분 조회·쓰기를 흉내 낸다 — 쓰기마다 SSE change 알림.
// 문자찜: ref는 서버가 만들고, phone은 정규화해 phoneKey·phoneLast4만 엔진에 넣는다(원문은 버린다), received를 비우면 '10:00:00'.
import { applyEvent, containsPhoneRun, isValidReceivedTime, normalizePhone, phoneLast4, type EngineState, type SettingsOverride } from '@livejjim/core'
import type { Changes, WriteResult } from '../src/api/types.ts'
import { settlementKey } from '../src/lib/scope-data.ts'
import { T0, run, viewOf } from './engine.ts'
import { DATE, FakeEventSource, FakeServer, apiError, type Reply } from './support.ts'

export const PHONE_SENTENCE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

type Lists = Record<string, Record<string, unknown>[]>
const KEY: Record<string, (item: Record<string, unknown>) => string> = {
  broadcasts: (item) => String(item.id),
  products: (item) => String(item.key),
  claims: (item) => String(item.id),
  pending: (item) => String(item.product),
  buyers: (item) => String(item.id),
  settlements: (item) => settlementKey(item as { buyer: string; date: string }),
  effects: (item) => String(item.id),
  cancelRequests: (item) => String(item.claim),
}

function lists(state: EngineState): Lists {
  const view = viewOf(state, 0) as unknown as Record<string, unknown>
  const out: Lists = {}
  for (const name of Object.keys(KEY)) out[name] = view[name] as Record<string, unknown>[]
  return out
}

export interface EngineServerOptions {
  readonly settings?: SettingsOverride
  readonly ended?: readonly string[]
  readonly delayMs?: number
}

export class EngineServer {
  readonly server = new FakeServer()
  /** 받아 기록한 쓰기 (요청 본문) */
  readonly posts: Record<string, unknown>[] = []
  readonly #states: EngineState[]
  readonly #results = new Map<string, WriteResult & { phoneLast4?: string | null }>()
  #refs = 0
  /** 다음 쓰기를 이 응답으로 대신한다 (한 번) */
  failNext: Reply | null = null
  /** 쓰기가 서버에 닿지 않는다 (네트워크 오류) */
  down = false

  constructor(events: readonly Record<string, unknown>[] = [], options: EngineServerOptions = {}) {
    const first = run([], options.settings ?? {})
    this.#states = [first.state]
    for (const event of events) this.#apply(event)
    const ended = new Set(options.ended ?? [])
    this.server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
      .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: options.delayMs ?? 60 } }))
      .on('GET', /^\/api\/broadcasts$/, () => ({
        body: {
          broadcasts: [
            { id: 'b1', date: DATE, title: '1부', rehearsal: false, ended: ended.has('b1'), endedAt: null },
            { id: 'b2', date: DATE, title: '2부', rehearsal: false, ended: ended.has('b2'), endedAt: null },
          ],
        },
      }))
      .on('GET', /^\/api\/days(\?rehearsal=true)?$/, (_call, match) => ({ body: { days: match[1] === undefined ? [{ date: DATE, rehearsal: false, seq: this.seq }] : [] } }))
      .on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: viewOf(this.state, this.seq) }))
      .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => ({ body: this.changes(Number(match[1])) }))
      .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), () => ({ body: { date: DATE, rehearsal: false, events: [] } }))
      .on('GET', /^\/api\/broadcasts\/[^/]+\/rehearsal\/generator$/, () => ({
        body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } },
      }))
      .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: this.seq, messages: [], more: false } }))
      .on('POST', /^\/api\/events/, (call) => this.#post(call.body ?? {}))
  }

  get state(): EngineState {
    return this.#states.at(-1) as EngineState
  }

  get seq(): number {
    return this.#states.length - 1
  }

  /** 다른 기기의 쓰기 (알림과 함께) */
  write(event: Record<string, unknown>): void {
    this.#apply(event)
    this.#notify(String(event.type))
  }

  /** 다른 기기의 쓰기 — 알림 없이 (화면이 아직 모른다) */
  writeQuietly(event: Record<string, unknown>): void {
    this.#apply(event)
  }

  #apply(event: Record<string, unknown>): boolean {
    const before = JSON.stringify(lists(this.state))
    const seq = this.#states.length
    const next = applyEvent(this.state, { ...event, seq, at: T0 + seq * 1000 } as never).state
    this.#states.push(next)
    return JSON.stringify(lists(next)) !== before
  }

  #notify(type: string): void {
    const stream = FakeEventSource.instances.at(-1)
    stream?.emit('change', { date: DATE, rehearsal: false, seq: this.seq, type })
  }

  #post(body: Record<string, unknown>): Reply {
    if (this.down) return { network: true }
    const { requestId, ...input } = body
    const prior = this.#results.get(String(requestId))
    if (prior !== undefined) return { body: prior }
    if (this.failNext !== null) {
      const reply = this.failNext
      this.failNext = null
      return reply
    }
    this.posts.push(body)
    let event: Record<string, unknown> = input
    let last4: string | null | undefined
    if (input.type === 'sms') {
      if (typeof input.memo === 'string' && containsPhoneRun(input.memo)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'memo', message: PHONE_SENTENCE }])
      if (input.received !== undefined && !isValidReceivedTime(input.received)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'received', message: '받은 시각을 확인해 주세요.' }])
      const { phone, ...rest } = input
      const normalized = typeof phone === 'string' ? normalizePhone(phone) : null
      last4 = normalized === null ? null : phoneLast4(normalized)
      this.#refs++
      event = {
        ...rest,
        ref: `r${String(this.#refs)}`,
        received: input.received ?? '10:00:00',
        ...(normalized === null ? {} : { phoneKey: `phonekey-${normalized}`, phoneLast4: last4 }),
      }
    }
    for (const field of ['reason', 'memo'] as const) {
      if (typeof event[field] === 'string' && containsPhoneRun(event[field])) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message: PHONE_SENTENCE }])
    }
    const changed = this.#apply(event)
    const result = { date: DATE, rehearsal: false, seq: this.seq, type: String(input.type), changed, effects: [], ...(last4 === undefined ? {} : { phoneLast4: last4 }) }
    this.#results.set(String(requestId), result)
    queueMicrotask(() => this.#notify(String(input.type)))
    return { body: result }
  }

  /** 서버 증분 조회와 같은 방식 (키로 비교, 값이 같은 항목은 빼고, 사라진 키) */
  changes(since: number): Changes {
    const a = lists(this.#states[since] as EngineState)
    const b = lists(this.state)
    const out: Record<string, unknown> = { date: DATE, rehearsal: false, since, seq: this.seq, attention: [], messages: [], messagesMore: false }
    const removed: Record<string, unknown[]> = {}
    for (const name of Object.keys(KEY)) {
      const key = KEY[name] as (item: Record<string, unknown>) => string
      const old = new Map((a[name] ?? []).map((item) => [key(item), JSON.stringify(item)]))
      const now = new Map((b[name] ?? []).map((item) => [key(item), item]))
      out[name] = [...now.entries()].filter(([k, item]) => old.get(k) !== JSON.stringify(item)).map(([, item]) => item)
      removed[name] =
        name === 'settlements'
          ? (a[name] ?? []).filter((item) => !now.has(key(item))).map((item) => ({ buyer: item.buyer, date: item.date }))
          : [...old.keys()].filter((k) => !now.has(k))
    }
    out.removed = removed
    return out as unknown as Changes
  }
}
