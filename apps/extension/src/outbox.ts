// 보낼 채팅 붙들기·묶어 보내기 (X1 YT-10 AC5, D-X1-09). 서비스 워커가 쓴다 — 크롬 API 없이 시험한다.
// - 1초마다(또는 50개가 차면) 한 번에 보낸다. 한 번에 한 묶음만 보내는 중이다.
// - 최대 500개까지 붙든다. 넘으면 가장 오래된 것부터 버리고 버린 수를 센다("놓친 채팅이 있어요").
// - 429면 Retry-After만큼, 서버에 닿지 못하거나 500이면 점점 길게 기다렸다 같은 묶음을 다시 보낸다(서버가 같은 메시지 ID는 한 번만 기록한다).
// - 401(끊김)이면 모두 버리고 멈춘다. 409 회차를 골라야 함·회차 끝남, 400이면 그 묶음을 버린다(다시 보내도 기록되지 않는다).
// - 메모리에만 둔다(채팅 내용을 저장하지 않는다 — AC9).
import type { Api } from './api.ts'
import type { ChatMessage } from './reader.ts'

export const BATCH_MAX = 50
export const HOLD_MAX = 500
export const FLUSH_MS = 1000
const BACKOFF_MAX_MS = 30_000

export type OutboxEvent =
  | { readonly kind: 'sent'; readonly v: string; readonly recorded: number }
  | { readonly kind: 'notBound'; readonly v: string }
  | { readonly kind: 'ended'; readonly v: string }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'failing'; readonly message: string }

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

interface Held {
  readonly v: string
  readonly message: ChatMessage
}

export class Outbox {
  readonly #api: Api
  readonly #timers: Timers
  readonly #onEvent: (event: OutboxEvent) => void
  #queue: Held[] = []
  #timer: unknown = null
  #sending = false
  #stopped = false
  #backoff = 0
  #waitUntilRetry = false
  #dropped = 0

  constructor(api: Api, timers: Timers, onEvent: (event: OutboxEvent) => void) {
    this.#api = api
    this.#timers = timers
    this.#onEvent = onEvent
  }

  /** 붙들 수 없어 버린 채팅 수 (켠 뒤 누적) */
  get dropped(): number {
    return this.#dropped
  }

  get size(): number {
    return this.#queue.length
  }

  add(v: string, messages: readonly ChatMessage[]): void {
    if (this.#stopped) return
    for (const message of messages) this.#queue.push({ v, message })
    const over = this.#queue.length - HOLD_MAX
    if (over > 0) {
      this.#queue.splice(0, over)
      this.#dropped += over
    }
    if (this.#waitUntilRetry || this.#sending) return
    if (this.#queue.length >= BATCH_MAX) this.#schedule(0)
    else if (this.#timer === null) this.#schedule(FLUSH_MS)
  }

  /** 끊겼을 때·연결을 지울 때: 모두 버리고 멈춘다 */
  stop(): void {
    this.#stopped = true
    this.#queue = []
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = null
  }

  /** 다시 연결한 뒤 */
  resume(): void {
    this.#stopped = false
    this.#backoff = 0
    this.#waitUntilRetry = false
  }

  #schedule(ms: number): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = this.#timers.set(() => {
      this.#timer = null
      void this.flush()
    }, ms)
  }

  /** 지금 한 묶음 보내기 (맨 앞 메시지와 같은 영상인 것만, 50개까지) */
  async flush(): Promise<void> {
    if (this.#sending || this.#stopped || this.#queue.length === 0) return
    this.#waitUntilRetry = false
    const first = this.#queue[0]
    if (first === undefined) return
    const batch: Held[] = []
    for (const held of this.#queue) {
      if (held.v !== first.v) break
      batch.push(held)
      if (batch.length >= BATCH_MAX) break
    }
    this.#sending = true
    const result = await this.#api.call('POST', '/ext/chats', { v: first.v, messages: batch.map((held) => held.message) })
    this.#sending = false
    if (this.#stopped) return
    const drop = () => {
      const sent = new Set(batch)
      this.#queue = this.#queue.filter((held) => !sent.has(held))
    }
    if (result.status === 200) {
      drop()
      this.#backoff = 0
      const recorded = typeof result.body?.['recorded'] === 'number' ? result.body['recorded'] : 0
      this.#onEvent({ kind: 'sent', v: first.v, recorded })
    } else if (result.status === 401) {
      this.stop()
      this.#onEvent({ kind: 'disconnected' })
      return
    } else if (result.status === 409 && result.code === 'EXT_NOT_BOUND') {
      drop()
      this.#onEvent({ kind: 'notBound', v: first.v })
    } else if (result.status === 409 && result.code === 'EXT_ENDED') {
      drop()
      this.#onEvent({ kind: 'ended', v: first.v })
    } else if (result.status === 429) {
      this.#retry(result.retryAfterMs ?? 1000, result.message)
      return
    } else if (result.status >= 400 && result.status < 500 && result.status !== 408) {
      // 고쳐도 받지 않는 묶음 (모양이 틀림 등) — 버린다
      drop()
    } else {
      this.#backoff = Math.min(BACKOFF_MAX_MS, this.#backoff === 0 ? 1000 : this.#backoff * 2)
      this.#retry(this.#backoff, result.message)
      return
    }
    if (this.#queue.length >= BATCH_MAX) this.#schedule(0)
    else if (this.#queue.length > 0) this.#schedule(FLUSH_MS)
  }

  #retry(ms: number, message: string | null): void {
    this.#waitUntilRetry = true
    if (message !== null) this.#onEvent({ kind: 'failing', message })
    this.#schedule(ms)
  }
}
