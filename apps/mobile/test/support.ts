// 시험 도우미: 가짜 서버(fetch)·가짜 실시간 연결·표본 자료·가짜 시계. 서버 응답 모양은 웹 시험(apps/web/test/support.ts)과 같은 계약이다.
import type { BroadcastItem, BroadcastView, Buyer, Changes, Claim, FullView, Product } from '@livejjim/web/src/api/types.ts'
import { configureApi } from '../src/api/config.ts'
import { CLOSED, CONNECTING, OPEN, type EventSourceLike, type SseMessage } from '../src/api/sse.ts'
import type { Timer } from '../src/lib/live.ts'

export interface Call {
  readonly method: string
  readonly path: string
  readonly body: Record<string, unknown> | null
}

export interface Reply {
  readonly status?: number
  readonly body?: unknown
  readonly network?: boolean
  /** JSON 대신 이 바이트를 그대로 (그림 파일 등) */
  readonly bytes?: Uint8Array
  readonly contentType?: string
}

type Handler = (call: Call, match: RegExpExecArray) => Reply | Promise<Reply>

/** 경로·메서드로 고르는 가짜 서버. 맞는 처리기가 없으면 404 */
export class FakeServer {
  readonly calls: Call[] = []
  readonly #routes: { method: string; pattern: RegExp; handler: Handler }[] = []

  on(method: string, pattern: RegExp, handler: Handler): this {
    this.#routes.unshift({ method, pattern, handler })
    return this
  }

  callsTo(method: string, pattern: RegExp): Call[] {
    return this.calls.filter((call) => call.method === method && pattern.test(call.path))
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input, 'http://test.local')
    const path = `${url.pathname}${url.search}`
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const call: Call = { method, path, body }
    this.calls.push(call)
    for (const route of this.#routes) {
      if (route.method !== method) continue
      const match = route.pattern.exec(path)
      if (match === null) continue
      const reply = await route.handler(call, match)
      if (reply.network === true) throw new TypeError('Network request failed')
      const status = reply.status ?? 200
      if (reply.bytes !== undefined) return new Response(reply.bytes.slice().buffer, { status, headers: { 'Content-Type': reply.contentType ?? 'application/octet-stream' } })
      return new Response(reply.body === undefined ? '{}' : JSON.stringify(reply.body), { status, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  /** 이 서버를 앱의 서버로 */
  install(): void {
    let n = 0
    configureApi({ baseUrl: 'http://test.local', fetch: this.fetch, newId: () => `req-${String(++n)}` })
  }
}

/** 손으로 알림을 넣는 가짜 실시간 연결 */
export class FakeEventSource implements EventSourceLike {
  readyState = CONNECTING
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly #listeners = new Map<string, ((event: SseMessage) => void)[]>()
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (event: SseMessage) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.readyState = CLOSED
  }

  open(scopes: { date: string; rehearsal: boolean; seq: number }[] = []): void {
    this.readyState = OPEN
    this.onopen?.({ type: 'open' })
    this.emit('ready', { scopes })
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener({ type, data: JSON.stringify(data), lastEventId: '' })
  }

  /** 끊김 */
  fail(): void {
    this.readyState = CLOSED
    this.onerror?.({ type: 'error' })
  }
}

/** 손으로 돌리는 시계·타이머 */
export class FakeClock implements Timer {
  now = 1_700_000_000_000
  #handles: { at: number; fn: () => void; id: number }[] = []
  #next = 1

  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.#handles.push({ at: this.now + ms, fn, id })
    return id
  }

  clear(handle: unknown): void {
    this.#handles = this.#handles.filter((item) => item.id !== handle)
  }

  /** 시간을 흘린다 (그 사이 예약된 것을 순서대로) */
  async advance(ms: number): Promise<void> {
    const until = this.now + ms
    for (;;) {
      const due = this.#handles.filter((item) => item.at <= until).sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      this.now = Math.max(this.now, due.at)
      this.#handles = this.#handles.filter((item) => item.id !== due.id)
      due.fn()
      await flush()
    }
    this.now = until
  }
}

/** 약속이 모두 처리되길 기다린다 */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

// ── 표본 자료 ──

export const BROADCAST: BroadcastItem = { id: 'b1', date: '2026-10-29', title: '저녁 방송', rehearsal: false, ended: false, endedAt: null }

export const SETTINGS = {
  'price.unit': 'THOUSAND',
  'claim.maxNumber': 999,
  'claim.parseMode': 'NUMBERS',
  'print.autoOnConfirm': true,
} as unknown as BroadcastView['settings']

export const BROADCAST_VIEW: BroadcastView = { id: 'b1', date: '2026-10-29', title: '저녁 방송', ended: false, endedAt: null, settings: SETTINGS, focus: null }

export function product(no: number, patch: Partial<Product> = {}): Product {
  return {
    key: `b1/${String(no)}`,
    id: `p${String(no)}`,
    broadcast: 'b1',
    no,
    name: `품종${String(no)}`,
    price: 10_000,
    stock: 1,
    status: 'OPEN',
    winners: [],
    winnerClaims: [],
    waitlist: [],
    waitlistClaims: [],
    awaitingSuccession: false,
    conflict: false,
    conflictClaim: null,
    conflictBuyer: null,
    priceHistory: [],
    nameHistory: [],
    confirmVersion: 0,
    aliases: [],
    options: [],
    hasOptions: false,
    confirmedUnits: 0,
    variants: [],
    ...patch,
  }
}

export function buyer(id: string, display: string, patch: Partial<Buyer> = {}): Buyer {
  return { id, kind: 'youtube', current: id, mergedInto: null, merged: [], display, nameHistory: [display], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false, ...patch }
}

export function claim(id: string, no: number, buyerId: string, patch: Partial<Claim> = {}): Claim {
  return {
    id,
    product: `b1/${String(no)}`,
    productId: `p${String(no)}`,
    broadcast: 'b1',
    no,
    buyer: buyerId,
    currentBuyer: buyerId,
    status: 'CONFIRMED',
    reason: null,
    origin: 'chat',
    seq: 10,
    rankTime: '2026-10-29T11:00:05.000Z',
    rankMinute: false,
    received: null,
    at: '2026-10-29T11:00:05.000Z',
    price: 10_000,
    confirmVersion: 1,
    locked: false,
    cancelRequested: false,
    reprintNeeded: false,
    priceHistory: [],
    key: `b1/${String(no)}`,
    qty: 1,
    variant: null,
    options: null,
    amount: 10_000,
    ...patch,
  }
}

export function fullView(patch: Partial<FullView> = {}): FullView {
  return {
    date: '2026-10-29',
    rehearsal: false,
    seq: 5,
    broadcasts: [BROADCAST_VIEW],
    products: [],
    claims: [],
    pending: [],
    buyers: [],
    settlements: [],
    effects: [],
    cancelRequests: [],
    attention: [],
    ...patch,
  }
}

export function changes(since: number, seq: number, patch: Partial<Changes> = {}): Changes {
  return {
    date: '2026-10-29',
    rehearsal: false,
    since,
    seq,
    broadcasts: [],
    products: [],
    claims: [],
    pending: [],
    buyers: [],
    settlements: [],
    effects: [],
    cancelRequests: [],
    removed: { broadcasts: [], products: [], claims: [], pending: [], buyers: [], settlements: [], effects: [], cancelRequests: [] },
    attention: [],
    messages: [],
    messagesMore: false,
    ...patch,
  } as Changes
}
