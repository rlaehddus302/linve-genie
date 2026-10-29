// 실시간 연결 하나를 앱 전체가 함께 쓴다 (웹 lib/stream.ts와 같은 규칙, D-075·D-085).
// - 연결은 하나(GET /api/stream?device=<기기 ID>)이고 보는 쪽(view)마다 EventSourceLike 모양을 준다. 늦게 붙은 쪽에는 지금까지 아는 범위별 seq로
//   ready를 한 번 다시 준다(새 연결의 ready와 같은 성질).
// - 끊기면(readyState CLOSED) 보는 쪽에 onerror를 주고, 보는 쪽이 있으면 2초 뒤 새로 연다(새 ready → 저장소가 놓친 변경을 따라잡는다).
// - 앱이 앞으로 돌아오면(APP-04) 끊긴 연결을 바로 새로 연다 — 기다리지 않는다.
import type { ScopeSeq } from '@livejjim/web/src/api/types.ts'
import { absoluteUrl, apiConfig } from '../api/config.ts'
import { CLOSED, OPEN, openEventSource, type EventSourceLike, type SseMessage } from '../api/sse.ts'

/** 받는 알림 종류 (웹 STREAM_EVENTS와 같다) */
export const STREAM_EVENTS = ['ready', 'change', 'generator', 'print', 'youtube', 'instagram', 'packing', 'shop', 'labels', 'tiktok', 'deposit', 'billing', 'login', 'parcel', 'extension', 'band'] as const

/** 끊긴 뒤 다시 열기까지 */
export const REOPEN_MS = 2000

const scopeKey = (scope: { readonly date: string; readonly rehearsal: boolean }): string => `${scope.date}|${scope.rehearsal ? 'r' : 'l'}`

function parse(event: SseMessage): unknown {
  try {
    return JSON.parse(event.data)
  } catch {
    return null
  }
}

export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

class StreamView implements EventSourceLike {
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly #owner: LiveStream
  readonly #listeners = new Map<string, ((event: SseMessage) => void)[]>()
  #closed = false

  constructor(owner: LiveStream) {
    this.#owner = owner
  }

  get readyState(): number {
    return this.#closed ? CLOSED : this.#owner.readyState
  }

  addEventListener(type: string, listener: (event: SseMessage) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#owner.detach(this)
  }

  dispatch(type: string, event: SseMessage): void {
    if (this.#closed) return
    for (const listener of this.#listeners.get(type) ?? []) listener(event)
  }
}

export interface LiveStreamOptions {
  /** 연결 주소 (새로 열 때마다 읽는다) */
  readonly url: () => string
  readonly create?: (url: string) => EventSourceLike
  readonly timer?: Timer
}

export class LiveStream {
  readonly #options: LiveStreamOptions
  readonly #views = new Set<StreamView>()
  readonly #timer: Timer
  #source: EventSourceLike | null = null
  #seqs: Map<string, ScopeSeq> | null = null
  #reopen: unknown = undefined
  readonly #connectionListeners = new Set<(open: boolean) => void>()

  constructor(options: LiveStreamOptions) {
    this.#options = options
    this.#timer = options.timer ?? realTimer
  }

  get readyState(): number {
    return this.#source?.readyState ?? CLOSED
  }

  get connected(): boolean {
    return this.readyState === OPEN && this.#seqs !== null
  }

  /** 연결됨/끊김이 바뀔 때 */
  onConnection(listener: (open: boolean) => void): () => void {
    this.#connectionListeners.add(listener)
    return () => this.#connectionListeners.delete(listener)
  }

  open(): EventSourceLike {
    const view = new StreamView(this)
    this.#views.add(view)
    if (this.#source === null || this.#source.readyState === CLOSED) {
      this.#connect()
    } else if (this.#source.readyState === OPEN && this.#seqs !== null) {
      const scopes = [...this.#seqs.values()]
      void Promise.resolve().then(() => view.dispatch('ready', { type: 'ready', data: JSON.stringify({ scopes }), lastEventId: '' }))
    }
    return view
  }

  /** 앱이 앞으로 돌아왔다 (APP-04): 끊긴 연결이면 기다리지 않고 바로 새로 연다 */
  resume(): void {
    if (this.#views.size === 0) return
    if (this.#source === null || this.#source.readyState === CLOSED) this.#connect()
  }

  /** 모두 닫는다 (로그아웃) */
  shutdown(): void {
    this.#closeSource()
    for (const view of [...this.#views]) view.close()
  }

  detach(view: StreamView): void {
    this.#views.delete(view)
    if (this.#views.size === 0) this.#closeSource()
  }

  #closeSource(): void {
    if (this.#reopen !== undefined) {
      this.#timer.clear(this.#reopen)
      this.#reopen = undefined
    }
    const wasOpen = this.connected
    this.#source?.close()
    this.#source = null
    this.#seqs = null
    if (wasOpen) this.#announce(false)
  }

  #announce(open: boolean): void {
    for (const listener of [...this.#connectionListeners]) listener(open)
  }

  #connect(): void {
    this.#closeSource()
    const create = this.#options.create ?? ((url: string) => openEventSource(url, { fetch: apiConfig().fetch }))
    const source = create(this.#options.url())
    this.#source = source
    const views = () => [...this.#views]
    source.onopen = (event) => {
      if (this.#source !== source) return
      for (const view of views()) view.onopen?.(event)
    }
    source.onerror = (event) => {
      if (this.#source !== source) return
      const wasOpen = this.#seqs !== null
      this.#source = null
      this.#seqs = null
      if (wasOpen) this.#announce(false)
      for (const view of views()) view.onerror?.(event)
      if (this.#views.size > 0 && this.#reopen === undefined) {
        this.#reopen = this.#timer.set(() => {
          this.#reopen = undefined
          if (this.#views.size > 0 && this.#source === null) this.#connect()
        }, REOPEN_MS)
      }
    }
    source.addEventListener('ready', (event) => {
      if (this.#source !== source) return
      const data = parse(event) as { scopes?: ScopeSeq[] } | null
      const seqs = new Map<string, ScopeSeq>()
      for (const scope of data?.scopes ?? []) seqs.set(scopeKey(scope), { date: scope.date, rehearsal: scope.rehearsal, seq: scope.seq })
      this.#seqs = seqs
      this.#announce(true)
      for (const view of views()) view.dispatch('ready', event)
    })
    source.addEventListener('change', (event) => {
      if (this.#source !== source) return
      const data = parse(event) as ScopeSeq | null
      if (data !== null && this.#seqs !== null && typeof data.seq === 'number') {
        const key = scopeKey(data)
        const known = this.#seqs.get(key)
        if (known === undefined || data.seq > known.seq) this.#seqs.set(key, { date: data.date, rehearsal: data.rehearsal, seq: data.seq })
      }
      for (const view of views()) view.dispatch('change', event)
    })
    for (const type of STREAM_EVENTS) {
      if (type === 'ready' || type === 'change') continue
      source.addEventListener(type, (event) => {
        if (this.#source !== source) return
        for (const view of views()) view.dispatch(type, event)
      })
    }
  }
}

/** 이 앱의 실시간 연결 (기기 ID를 밝힌다 — 이 기기가 출력 기기면 다른 기기에 "연결됨/끊김"이 이것으로 보인다) */
export function createLiveStream(deviceId: () => string, options: Partial<LiveStreamOptions> = {}): LiveStream {
  return new LiveStream({ url: () => absoluteUrl(`/api/stream?device=${encodeURIComponent(deviceId())}`), ...options })
}
