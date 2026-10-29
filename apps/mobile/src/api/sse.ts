// 서버 실시간 알림(SSE, GET /api/stream)을 스트리밍 fetch로 받는다 — React Native에는 EventSource가 없다.
// 웹 lib/stream.ts의 EventSourceLike와 같은 모양을 주어 저장소(scope-store·label-queue)가 웹과 같은 프로토콜(ready·change·print…)을 그대로 쓴다.
// 브라우저 EventSource와 달리 스스로 다시 붙지 않는다 — 끊기면 readyState가 CLOSED(2)가 되고 onerror를 부른다. 다시 붙기는 live.ts가 한다.
import type { FetchLike } from './config.ts'

export const CONNECTING = 0
export const OPEN = 1
export const CLOSED = 2

export interface SseMessage {
  readonly type: string
  readonly data: string
  readonly lastEventId: string
}

export interface EventSourceLike {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  addEventListener(type: string, listener: (event: SseMessage) => void): void
  close(): void
}

/** 받은 글자를 SSE 규칙(빈 줄이 메시지 끝, `event:`·`data:`·`id:`·`:` 주석)으로 나눈다 */
export class SseParser {
  #buffer = ''
  #type = ''
  #data: string[] = []
  #id = ''
  readonly #emit: (message: SseMessage) => void

  constructor(emit: (message: SseMessage) => void) {
    this.#emit = emit
  }

  push(text: string): void {
    this.#buffer += text
    for (;;) {
      const at = this.#buffer.search(/\r\n|\n|\r/)
      if (at < 0) return
      const line = this.#buffer.slice(0, at)
      const sep = this.#buffer.slice(at, at + 2) === '\r\n' ? 2 : 1
      this.#buffer = this.#buffer.slice(at + sep)
      this.#line(line)
    }
  }

  #line(line: string): void {
    if (line === '') {
      if (this.#data.length > 0 || this.#type !== '') this.#emit({ type: this.#type === '' ? 'message' : this.#type, data: this.#data.join('\n'), lastEventId: this.#id })
      this.#type = ''
      this.#data = []
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.#type = value
    else if (field === 'data') this.#data.push(value)
    else if (field === 'id') this.#id = value
  }
}

export interface SseOptions {
  readonly fetch: FetchLike
}

class FetchEventSource implements EventSourceLike {
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  #state = CONNECTING
  readonly #listeners = new Map<string, ((event: SseMessage) => void)[]>()
  readonly #abort = new AbortController()

  constructor(url: string, options: SseOptions) {
    void this.#run(url, options)
  }

  get readyState(): number {
    return this.#state
  }

  addEventListener(type: string, listener: (event: SseMessage) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  close(): void {
    if (this.#state === CLOSED) return
    this.#state = CLOSED
    this.#abort.abort()
  }

  #fail(): void {
    if (this.#state === CLOSED) return
    this.#state = CLOSED
    this.onerror?.({ type: 'error' })
  }

  async #run(url: string, options: SseOptions): Promise<void> {
    let response: Response
    try {
      response = await options.fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'text/event-stream' }, signal: this.#abort.signal })
    } catch {
      this.#fail()
      return
    }
    if (this.#state === CLOSED) return
    if (!response.ok || response.body === null) {
      this.#fail()
      return
    }
    this.#state = OPEN
    this.onopen?.({ type: 'open' })
    const parser = new SseParser((message) => {
      if (this.#state !== OPEN) return
      for (const listener of this.#listeners.get(message.type) ?? []) listener(message)
    })
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value !== undefined) parser.push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // 끊김 — 아래에서 닫힌 연결로 알린다
    }
    // 서버가 닫았거나 끊겼다: 보는 쪽이 다시 연다
    if (this.#state === OPEN) this.#fail()
  }
}

export function openEventSource(url: string, options: SseOptions): EventSourceLike {
  return new FetchEventSource(url, options)
}
