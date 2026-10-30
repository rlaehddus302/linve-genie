// 화면 단위 시험 도우미: 가짜 서버(fetch)와 가짜 실시간 연결(EventSource).
// 서버 응답 모양은 harness/sprints/S05/dev-notes.md "화면(dev-web)에게 — API 계약"을 따른다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { vi } from 'vitest'
import type { BroadcastItem, BroadcastView, ChatMessage, FullView, OutboxRow, Product, YoutubeConnection } from '../src/api/types.ts'
import {
  AMOUNT_UNREADABLE,
  BROADCAST_READ_KINDS,
  READ_KINDS,
  READ_TEXT_MAX,
  RECEIVED_INVALID,
  decideFixForm,
  decideQuickInput,
  editQuestion,
  quickErrorMessage,
  quickRead,
  readMoney,
  readNumberField,
  readReceived,
  readText,
  type FixText,
  type QuickSettings,
  type ReadKind,
  type ReadProduct,
} from '../../../packages/voice-session/src/read/index.ts'

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

type ReadSettings = QuickSettings

const isPriceUnit = (unit: unknown): unit is ReadSettings['price.unit'] => unit === 'WON' || unit === 'THOUSAND' || unit === 'TEN_THOUSAND' || unit === 'AUTO'

/** 응답 본문에서 방송 설정·상품을 줍는다 (가짜 읽기 입구가 화면과 같은 방송 설정·상품으로 읽게) — 깊이 3까지 `broadcasts`·`products` 목록 */
function learn(body: unknown, settings: Map<string, ReadSettings>, products: Map<string, ReadProduct & { readonly broadcast: string }>, depth = 0): void {
  if (typeof body !== 'object' || body === null || depth > 3) return
  if (Array.isArray(body)) return
  const record = body as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === 'broadcasts' && Array.isArray(value)) {
      for (const item of value as unknown[]) {
        if (typeof item !== 'object' || item === null) continue
        const { id, settings: own } = item as { id?: unknown; settings?: Record<string, unknown> }
        if (typeof id !== 'string' || typeof own !== 'object' || own === null) continue
        const unit = own['price.unit']
        const max = own['claim.maxNumber']
        if (isPriceUnit(unit) && typeof max === 'number') settings.set(id, { 'price.unit': unit, 'claim.maxNumber': max })
      }
    } else if (key === 'products' && Array.isArray(value)) {
      for (const item of value as unknown[]) {
        if (typeof item !== 'object' || item === null) continue
        const p = item as Record<string, unknown>
        if (typeof p.broadcast !== 'string' || typeof p.no !== 'number' || typeof p.name !== 'string' || typeof p.price !== 'number') continue
        const id = typeof p.id === 'string' ? p.id : `${p.broadcast}/${String(p.no)}`
        products.set(`${p.broadcast}/${String(p.no)}`, { id, broadcast: p.broadcast, no: p.no, name: p.name, price: p.price, closed: p.status === 'CLOSED' })
      }
    } else if (typeof value === 'object' && value !== null) learn(value, settings, products, depth + 1)
  }
}

/** 원문 쓰기 칸 이름 (서버 raw-input.ts RAW_FIELDS) */
const RAW_NAMES = ['text', 'noText', 'priceText', 'receivedText', 'amountText', 'amountSign']

/** 화면이 아직 방송 설정을 받지 못했을 때 (코어 기본값) */
const DEFAULT_READ: ReadSettings = { 'price.unit': DEFAULT_SETTINGS['price.unit'], 'claim.maxNumber': DEFAULT_SETTINGS['claim.maxNumber'] }

/**
 * 가짜 서버 읽기 입구 (SRV1 약속 1, 서버 apps/server/src/read-routes.ts와 같은 약속): `POST /api/broadcasts/:id/read`·`POST /api/read`
 * `{ kind, text }` → `{ read }` — 서버와 같은 읽기 함수(packages/voice-session/src/read readText)의 결과. fix만 text가 세 칸.
 * 방송 설정·상품은 화면이 받은 응답에서 줍고, 모르면 기본값. `/api/read`는 방송과 무관한 칸(money·received·phone)만.
 */
export function fakeRead(call: Call, broadcast: string | null, settings: ReadonlyMap<string, ReadSettings>, findProduct: (b: string, no: number) => ReadProduct | undefined, now: number = Date.now()): Reply {
  const kind = call.body?.kind
  const text = call.body?.text
  if (typeof kind !== 'string' || !(READ_KINDS as readonly string[]).includes(kind)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.')
  const readKind = kind as ReadKind
  if (broadcast === null && BROADCAST_READ_KINDS.includes(readKind)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.')
  let input: string | FixText
  if (readKind === 'fix') {
    if (typeof text !== 'object' || text === null) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.')
    const form = text as Record<string, unknown>
    input = { no: String(form.no ?? ''), name: String(form.name ?? ''), price: String(form.price ?? '') }
  } else {
    if (typeof text !== 'string' || text.length > READ_TEXT_MAX) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.')
    input = text
  }
  const use = broadcast === null ? undefined : (settings.get(broadcast) ?? DEFAULT_READ)
  const read = readText(readKind, input, { ...(use === undefined ? {} : { settings: use }), ...(broadcast === null ? {} : { findProduct: (no: number) => findProduct(broadcast, no) }), now })
  return { body: { read } }
}

/**
 * 원문 칸을 서버처럼 읽어 엔진 필드로 (SRV1 약속 2, 서버 raw-input.ts와 같은 약속): product.register·update의 `text`·`noText`·`priceText`,
 * sms의 `noText`·`receivedText`, 정산의 `amountText`(+ `amountSign`). 읽지 못하면 서버 문장으로 400, 이미 있는 번호는 409 QUICK_EXISTS
 */
export function readRawWrite(input: Record<string, unknown>, settingsOf: (b: unknown) => QuickSettings, findProduct: (b: string, no: number) => ReadProduct | undefined, now: number = Date.now()): { event: Record<string, unknown> } | Reply {
  const bad = (field: string, message: string, extra: Record<string, unknown> = {}): Reply => ({ status: 400, body: { ...extra, error: { code: field === 'text' || field === 'noText' || field === 'priceText' ? 'QUICK_FIX' : 'INVALID_INPUT', message, problems: [{ field, message }] } } })
  const { text, noText, priceText, receivedText, amountText, amountSign, ...event } = input
  const type = String(input.type)
  if (type === 'product.register' || type === 'product.update') {
    const settings = settingsOf(input.b)
    const b = String(input.b)
    const find = (no: number) => findProduct(b, no)
    const decision = typeof text === 'string' ? decideQuickInput(text, settings, find) : typeof noText === 'string' && typeof priceText === 'string' ? decideFixForm({ no: noText, name: typeof input.name === 'string' ? input.name : '', price: priceText }, settings, find) : null
    if (decision !== null) {
      const read = quickRead(decision)
      if (decision.kind === 'fix') return bad(typeof text === 'string' ? 'text' : decision.focus === 'price' ? 'priceText' : 'noText', decision.message, { read })
      if (decision.kind === 'open') return { status: 409, body: { read, error: { code: 'QUICK_OPEN', message: `${String(decision.product.no)}번 상품이 이미 있어요.`, problems: [] } } }
      if (decision.kind === 'none') return bad('text', quickErrorMessage('NUMBER_MISSING', 0))
      if (decision.kind === 'edit' && type === 'product.register') return { status: 409, body: { read, error: { code: 'QUICK_EXISTS', message: editQuestion(decision.no, decision.product.closed), problems: [] } } }
      event.no = decision.no
      event.price = decision.price
      if (typeof text === 'string' && (type === 'product.register' || decision.name !== '')) event.name = decision.name
    }
  }
  if (type === 'sms') {
    if (typeof noText === 'string') {
      const settings = settingsOf(input.b)
      const no = readNumberField(noText, settings)
      if (no === 'empty') return bad('noText', '상품 번호를 적어 주세요.')
      if (no === null) return bad('noText', quickErrorMessage('NUMBER_INVALID', settings['claim.maxNumber']))
      event.no = no
    }
    if (typeof receivedText === 'string') {
      const read = readReceived(receivedText, now)
      if (read.kind === 'invalid') return bad('receivedText', RECEIVED_INVALID)
      if (read.kind === 'ok') event.received = read.value
    }
  }
  if (type.startsWith('settlement.') && typeof amountText === 'string') {
    const read = readMoney(amountText)
    if (read.amount === null) return bad('amountText', AMOUNT_UNREADABLE)
    event.amount = amountSign === 'MINUS' ? -read.amount : read.amount
  }
  return { event }
}


/** 경로·메서드로 고르는 가짜 서버. 맞는 처리기가 없으면 404 (읽기 입구는 따로 처리기를 달지 않으면 서버와 같은 읽기로 답한다) */
export class FakeServer {
  readonly calls: Call[] = []
  readonly #routes: { method: string; pattern: RegExp; handler: Handler }[] = []
  /** 응답에서 주운 방송 설정·상품 (가짜 읽기 입구용) */
  readonly readSettings = new Map<string, ReadSettings>()
  readonly readProducts = new Map<string, ReadProduct & { readonly broadcast: string }>()
  /** 가짜 읽기 입구가 상품을 찾는 곳 (EngineServer는 엔진 상태로 바꾼다) */
  findProduct: (b: string, no: number) => ReadProduct | undefined = (b, no) => this.readProducts.get(`${b}/${String(no)}`)
  /** 원문 쓰기를 처리기 앞에서 읽는다 (EngineServer는 같은 요청 번호 확인 뒤 스스로 읽으므로 끈다) */
  decodeRawWrites = true
  /** 받은 읽기 요청 본문 */
  get reads(): Call[] {
    return this.calls.filter((call) => call.method === 'POST' && /^\/api\/(?:broadcasts\/[^/?]+\/)?read$/.test(call.path))
  }
  /** 읽기 입구가 답하지 않는다 (AC-SRV1-06) */
  readDown = false

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
      // 원문 쓰기 (SRV1 약속 2): 서버처럼 먼저 읽어 엔진 필드로 바꿔 처리기에 넘긴다 — 받은 원문 본문은 calls에 그대로 남는다
      let handed = call
      if (this.decodeRawWrites && method === 'POST' && /^\/api\/events$/.test(path) && body !== null && RAW_NAMES.some((name) => body[name] !== undefined)) {
        const decoded = readRawWrite(body, (b) => (typeof b === 'string' ? this.readSettings.get(b) : undefined) ?? DEFAULT_READ, this.findProduct)
        if (!('event' in decoded)) return new Response(JSON.stringify(decoded.body ?? {}), { status: decoded.status ?? 200, headers: { 'Content-Type': 'application/json' } })
        handed = { ...call, body: decoded.event }
      }
      const reply = await route.handler(handed, match)
      if (reply.network === true) throw new TypeError('Failed to fetch')
      learn(reply.body, this.readSettings, this.readProducts)
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }
    const read = method === 'POST' ? /^\/api\/(?:broadcasts\/([^/?]+)\/)?read$/.exec(path) : null
    if (read !== null) {
      if (this.readDown) throw new TypeError('Failed to fetch')
      const reply = fakeRead(call, read[1] === undefined ? null : decodeURIComponent(read[1]), this.readSettings, this.findProduct)
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } }), { status: 404 })
  }
}

export const apiError = (status: number, code: string, message: string, problems: unknown[] = []): Reply => ({ status, body: { error: { code, message, problems } } })

/**
 * 다음 쓰기(POST /api/events) n번에 이 응답을 준다(쓰기 오류 시험, AC-S06-82). 그 뒤로는 server가 받는다.
 * 그동안 보낸 쓰기의 요청 번호를 모두 모아 돌려준다(같은 요청 번호로 다시 보냈는지).
 */
export function failWrites(server: FakeServer, n: number, reply: Reply): string[] {
  const sent: string[] = []
  let left = n
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && path.startsWith('/api/events')) {
      sent.push(String((JSON.parse(String(init?.body)) as { requestId?: unknown }).requestId))
      if (left > 0) {
        left -= 1
        return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return server.fetch(input, init)
  })
  return sent
}

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
  return { id: 'b1', date: DATE, title: '1부', ended: false, endedAt: null, settings: { ...DEFAULT_SETTINGS }, focus: null, ...patch }
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
    // O1: 옵션 상품 칸 (옵션 없는 상품)
    aliases: [],
    options: [],
    hasOptions: false,
    confirmedUnits: 0,
    variants: [],
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

/** 감사 메시지 발송함 한 줄 (I3) */
export function outboxRow(id: number, patch: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id,
    target: 'LIVE_CHAT',
    broadcast: 'b1',
    product: `b1/${String(id)}`,
    buyer: 'UC_A',
    text: `${String(id)}번 핑크프릴 10,000원 홍길동님 구매 감사합니다`,
    state: 'SENT',
    stateMessage: '게시됨',
    reason: null,
    reasonMessage: null,
    attempts: 1,
    nextAt: null,
    postedAt: '2026-10-19T11:00:00.000Z',
    messageId: 'm1',
    manual: false,
    groupWith: [],
    confirmedBySeller: false,
    dismissed: false,
    dismissedAt: null,
    ...patch,
  }
}

/** 유튜브 연결 (I3) */
export function connection(patch: Partial<YoutubeConnection> = {}): YoutubeConnection {
  return {
    status: 'CONNECTED',
    channel: { id: 'UC_ME', title: '구피 채널' },
    permissions: { read: true, publish: false },
    consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } },
    ...patch,
  }
}

/** 유튜브 연동을 준비하지 않은 서버 (503) */
export const youtubeNotConfigured: Reply = { status: 503, body: { error: { code: 'YOUTUBE_NOT_CONFIGURED', message: '유튜브 연동을 준비하지 않은 서버예요.' } } }

/**
 * 글자 찾기: 문장 안에 링크가 끼어 글자가 여러 조각이어도(예: "라벨 쓰지 않음 — [설정]에서 켤 수 있어요.", U-PL1B-06) 그 문장 전체를 담은 가장 안쪽 요소를 찾는다.
 * 글자는 한 글자도 다르지 않아야 한다(공백 정리 없음).
 */
export function fullText(text: string): (content: string, element: Element | null) => boolean {
  return (_content, element) => element !== null && element.textContent === text && !Array.from(element.children).some((child) => child.textContent === text)
}

/**
 * MOB2 D-MOB2-06: 화면 시계를 시험 엔진의 찜 시각(engine.ts T0 부근)에 맞춘다 — 그 고정 시각의 보류 찜이 실제 오늘 시각과 견줘
 * "시간 지남"으로 알림 수에서 빠지지 않게(시험의 뜻은 보류 찜이 막 들어온 방송). Date만 바꾸고 흐르게 둔다(타이머는 진짜).
 * 끝나면 vi.useRealTimers()
 */
export function fixtureClock(now: number): void {
  vi.useFakeTimers({ toFake: ['Date'], now, shouldAdvanceTime: true })
}
