// 화면 단위 시험 도우미: 가짜 서버(fetch)와 가짜 실시간 연결(EventSource).
// 서버 응답 모양은 harness/sprints/S05/dev-notes.md "화면(dev-web)에게 — API 계약"을 따른다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import type { BroadcastItem, BroadcastView, ChatMessage, FullView, Product } from '../src/api/types.ts'

export interface Call {
  readonly method: string
  readonly path: string
  readonly body: Record<string, unknown> | null
  readonly credentials: RequestCredentials | undefined
}

export interface Reply {
  readonly status?: number
  readonly body?: unknown
  /** 네트워크 오류 (서버에 닿지 못함) */
  readonly network?: boolean
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

  /** 그 경로로 온 요청 (질의 포함 경로에 정규식) */
  callsTo(method: string, pattern: RegExp): Call[] {
    return this.calls.filter((call) => call.method === method && pattern.test(call.path))
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const call: Call = { method, path, body, credentials: init?.credentials }
    this.calls.push(call)
    for (const route of this.#routes) {
      if (route.method !== method) continue
      const match = route.pattern.exec(path)
      if (match === null) continue
      const reply = await route.handler(call, match)
      if (reply.network === true) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } }), { status: 404 })
  }
}

export const apiError = (status: number, code: string, message: string, problems: unknown[] = []): Reply => ({ status, body: { error: { code, message, problems } } })

/** 가짜 실시간 연결 */
export class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  readonly url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>()
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data: unknown): void {
    this.readyState = 1
    for (const listener of this.#listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }))
  }

  fail(closed = false): void {
    if (closed) this.readyState = 2
    this.onerror?.(new Event('error'))
  }

  static reset(): void {
    FakeEventSource.instances.length = 0
  }

  static get last(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1)
    if (last === undefined) throw new Error('연결이 없다')
    return last
  }
}

export const DATE = '2026-10-19'

export function broadcastItem(patch: Partial<BroadcastItem> = {}): BroadcastItem {
  return { id: 'b1', date: DATE, title: '1부', rehearsal: false, ended: false, endedAt: null, ...patch }
}

export function broadcastView(patch: Partial<BroadcastView> = {}): BroadcastView {
  return { id: 'b1', date: DATE, title: '1부', ended: false, endedAt: null, settings: { ...DEFAULT_SETTINGS }, ...patch }
}

export function product(no: number, patch: Partial<Product> = {}): Product {
  return {
    key: `b1/${String(no)}`,
    id: `p${String(no)}`,
    broadcast: 'b1',
    no,
    name: '핑크프릴',
    price: 10000,
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
    ...patch,
  }
}

export function fullView(patch: Partial<FullView> = {}): FullView {
  return {
    date: DATE,
    rehearsal: false,
    seq: 1,
    broadcasts: [broadcastView()],
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

export function message(seq: number, patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${String(seq)}`,
    broadcast: 'b1',
    channel: 'sim_c1',
    nick: '시청자',
    text: '안녕하세요',
    owner: false,
    seq,
    at: '2026-10-19T01:02:03.000Z',
    publishedAt: '2026-10-19T01:02:03.000Z',
    ignored: false,
    order: false,
    cancel: false,
    orders: [],
    cancels: [],
    mentions: [],
    converted: [],
    claims: [],
    failed: false,
    ...patch,
  }
}

/** 빈 증분 응답 */
export function emptyChanges(since: number, seq: number) {
  return {
    date: DATE,
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
    attention: [],
    removed: { broadcasts: [], products: [], claims: [], pending: [], buyers: [], settlements: [], effects: [], cancelRequests: [] },
    messages: [],
    messagesMore: false,
  }
}

/** 처리할 약속을 다 돌린다 */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
