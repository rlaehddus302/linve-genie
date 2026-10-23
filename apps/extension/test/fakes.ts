// 시험용 가짜: 서버 응답·타이머·크롬 API
import type { Api, ApiResult } from '../src/api.ts'
import type { ChromeLike } from '../src/chrome.ts'
import type { Timers } from '../src/outbox.ts'
import type { ChatMessage } from '../src/reader.ts'

export const ok = (body: Record<string, unknown> = {}): ApiResult => ({ status: 200, code: null, message: null, body, retryAfterMs: null })
export const fail = (status: number, code: string | null, message: string | null = null, retryAfterMs: number | null = null): ApiResult => ({ status, code, message, body: null, retryAfterMs })

export interface Call {
  readonly method: string
  readonly path: string
  readonly body: Record<string, unknown> | undefined
}

export class FakeApi implements Api {
  readonly calls: Call[] = []
  readonly replies: ApiResult[] = []
  fallback: ApiResult = ok({ recorded: 0, skipped: 0 })
  call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<ApiResult> {
    this.calls.push({ method, path, body })
    return Promise.resolve(this.replies.shift() ?? this.fallback)
  }
  chatBatches(): ChatMessage[][] {
    return this.calls.filter((c) => c.path === '/ext/chats').map((c) => c.body?.['messages'] as ChatMessage[])
  }
}

/** 손으로 돌리는 타이머 */
export class FakeTimers implements Timers {
  #next = 1
  readonly pending = new Map<number, { fn: () => void; ms: number }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.pending.set(id, { fn, ms })
    return id
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number)
  }
  /** 걸린 타이머를 모두 부른다 (그 안에서 새로 건 것은 다음 번에) */
  async fire(): Promise<number[]> {
    const due = [...this.pending.entries()]
    this.pending.clear()
    for (const [, timer] of due) timer.fn()
    await settle()
    return due.map(([, timer]) => timer.ms)
  }
  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.ms)
  }
}

export const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

export function message(n: number): ChatMessage {
  return { id: `ChwKGkmsg${String(n)}`, ch: 'UCaaaaaaaaaaaaaaaaaaaaaa', nick: '초록손님', text: `${String(n)}번`, at: 1_761_200_000_000 + n }
}

export function fakeChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial }
  const badge = { text: '', color: '', title: '' }
  const chrome: ChromeLike = {
    runtime: { id: 'ext', sendMessage: () => Promise.resolve(undefined), onMessage: { addListener: () => undefined } },
    storage: {
      local: {
        get: (keys) => Promise.resolve(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
        set: (items) => {
          Object.assign(store, items)
          return Promise.resolve()
        },
        remove: (keys) => {
          for (const k of keys) Reflect.deleteProperty(store, k)
          return Promise.resolve()
        },
      },
    },
    action: {
      setBadgeText: ({ text }) => {
        badge.text = text
        return Promise.resolve()
      },
      setBadgeBackgroundColor: ({ color }) => {
        badge.color = color
        return Promise.resolve()
      },
      setTitle: ({ title }) => {
        badge.title = title
        return Promise.resolve()
      },
    },
  }
  return { chrome, store, badge }
}
