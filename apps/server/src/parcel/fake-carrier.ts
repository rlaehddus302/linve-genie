// 가짜 택배사 (PARCEL_RULES PC-1, AC-T1-20) — 서버 시험과 E2E 기동(시험 모드)에서만 127.0.0.1에 뜬다. 운영 기동(main.ts)에는 없다.
// 약속(carrier.ts httpCarrier와 같다):
// - POST /book { requestKey, customerNo, receiver, sender, box, item, count } → 200 { invoice } (같은 요청 번호면 같은 송장번호, 새 요청 번호면 새 12자리 — 9로 시작)
//   · 422 { error: 'ADDRESS' | 'REJECTED', message } · 500 · 응답 없음(시간 초과) · 200 { invoice: 형식 틀림 }
// - POST /cancel { invoice } → 200(상태가 접수됨일 때만 — 이미 취소면 다시 200) · 409 { error: 'PICKED_UP' } · 404(모르는 송장)
// - POST /track { invoices } → 200 { items: [{ invoice, status }] } (상태 ACCEPTED·PICKED_UP·IN_TRANSIT·DELIVERED·CANCELLED)
// - GET /track/<송장번호> → 조회 쪽(HTML 한 장)
// 오류 주입: 받는 분 주소에 표시 글자를 넣거나(ADDRESS_MARKERS) 시험 조작(failNext)으로. 오류 답 본문에는 받은 주소를 그대로 되돌려 준다(echo — 서버가
// 원래 글을 저장·로그하지 않는지 보는 시험용, AC-T1-08). 받은 요청은 시험이 읽을 수 있다(requests — 몇 번·어떤 요청 번호·본문).
// 시험 조작 HTTP 경로(E2E용): POST /_fake/status { invoice, status } · POST /_fake/fail { op, kind, times? } · GET /_fake/requests · POST /_fake/reset
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { httpCarrier, type CarrierAdapter } from './carrier.ts'

export type FakeTrackStatus = 'ACCEPTED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
export const FAKE_TRACK_STATUSES: readonly FakeTrackStatus[] = ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']
/** 주입할 수 있는 실패 */
export type FakeFailure = 'ADDRESS' | 'REJECTED' | 'TIMEOUT' | 'TIMEOUT_AFTER_BOOK' | 'ERROR_500' | 'BAD_INVOICE' | 'REFUSED'
export const FAKE_FAILURES: readonly FakeFailure[] = ['ADDRESS', 'REJECTED', 'TIMEOUT', 'TIMEOUT_AFTER_BOOK', 'ERROR_500', 'BAD_INVOICE', 'REFUSED']
export type FakeOp = 'book' | 'cancel' | 'track'

/** 받는 분 주소에 이 글자가 있으면 그 실패 (시험·E2E에서 화면으로 넣을 수 있게) */
export const ADDRESS_MARKERS: readonly (readonly [string, FakeFailure])[] = [
  ['[주소거절]', 'ADDRESS'],
  ['[접수거절]', 'REJECTED'],
  ['[응답없음]', 'TIMEOUT'],
  ['[접수후응답없음]', 'TIMEOUT_AFTER_BOOK'],
  ['[서버오류]', 'ERROR_500'],
  ['[송장이상]', 'BAD_INVOICE'],
]

export interface FakeRequest {
  readonly op: FakeOp
  readonly requestKey: string | null
  readonly invoices: readonly string[]
  /** 받은 본문 그대로 (시험이 무엇을 보냈는지 본다) */
  readonly body: unknown
}

interface Booking {
  readonly requestKey: string
  readonly invoice: string
  status: FakeTrackStatus
}

export interface FakeCarrierOptions {
  readonly port?: number
  /** 응답 없음일 때 붙잡아 두는 시간 (기본 60초 — 서버 어댑터 시간 제한보다 길게) */
  readonly hangMs?: number
}

export class FakeCarrier {
  readonly #server: Server
  readonly #sockets = new Set<Socket>()
  readonly #bookings = new Map<string, Booking>()
  readonly #byInvoice = new Map<string, Booking>()
  readonly #failures: { op: FakeOp; kind: FakeFailure; left: number }[] = []
  readonly #hangMs: number
  readonly requests: FakeRequest[] = []
  #next = 1
  #url = ''
  /** 오류 답 본문에 받은 주소를 되돌려 준다 (기본 켬) */
  echo = true

  private constructor(options: FakeCarrierOptions) {
    this.#hangMs = options.hangMs ?? 60_000
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end()
      })
    })
    this.#server.on('connection', (socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
  }

  static async start(options: FakeCarrierOptions = {}): Promise<FakeCarrier> {
    const fake = new FakeCarrier(options)
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject)
      fake.#server.listen(options.port ?? 0, '127.0.0.1', () => {
        fake.#server.off('error', reject)
        const address = fake.#server.address()
        if (typeof address === 'object' && address !== null) fake.#url = `http://127.0.0.1:${String(address.port)}`
        resolve()
      })
    })
    return fake
  }

  get url(): string {
    return this.#url
  }

  /** 이 가짜 택배사에 붙는 서버 어댑터 (timeoutMs: 시험이 줄인다) */
  adapter(options: { readonly timeoutMs?: number } = {}): CarrierAdapter {
    return httpCarrier({ code: 'FAKE', base: this.#url, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) })
  }

  // ── 시험 조작 ───────────────────────────────────────────────────────────

  /** 다음 op 요청 times번(기본 1)을 그 실패로 */
  failNext(op: FakeOp, kind: FakeFailure, times = 1): void {
    this.#failures.push({ op, kind, left: times })
  }

  /** 송장의 조회 상태를 넘긴다 (모르는 송장이면 false) */
  setStatus(invoice: string, status: FakeTrackStatus): boolean {
    const booking = this.#byInvoice.get(invoice)
    if (booking === undefined) return false
    booking.status = status
    return true
  }

  statusOf(invoice: string): FakeTrackStatus | null {
    return this.#byInvoice.get(invoice)?.status ?? null
  }

  /** 요청 번호로 받은 접수 (없으면 null) */
  bookingOf(requestKey: string): { invoice: string; status: FakeTrackStatus } | null {
    const booking = this.#bookings.get(requestKey)
    return booking === undefined ? null : { invoice: booking.invoice, status: booking.status }
  }

  /** 받은 접수 수 (요청 번호마다 하나) */
  get bookingCount(): number {
    return this.#bookings.size
  }

  reset(): void {
    this.requests.length = 0
    this.#failures.length = 0
  }

  close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    return new Promise((resolve) => this.#server.close(() => resolve()))
  }

  // ── 처리 ────────────────────────────────────────────────────────────────

  #takeFailure(op: FakeOp): FakeFailure | null {
    const index = this.#failures.findIndex((item) => item.op === op)
    if (index < 0) return null
    const item = this.#failures[index] as { op: FakeOp; kind: FakeFailure; left: number }
    item.left -= 1
    if (item.left <= 0) this.#failures.splice(index, 1)
    return item.kind
  }

  #hang(res: ServerResponse): Promise<void> {
    return new Promise((resolve) => {
      const handle = setTimeout(() => {
        res.socket?.destroy()
        resolve()
      }, this.#hangMs)
      handle.unref()
      res.on('close', () => {
        clearTimeout(handle)
        resolve()
      })
    })
  }

  #book(requestKey: string): Booking {
    const known = this.#bookings.get(requestKey)
    if (known !== undefined) return known
    const invoice = `9${String(this.#next++).padStart(11, '0')}`
    const booking: Booking = { requestKey, invoice, status: 'ACCEPTED' }
    this.#bookings.set(requestKey, booking)
    this.#byInvoice.set(invoice, booking)
    return booking
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    }
    if (req.method === 'GET' && url.pathname.startsWith('/track/')) {
      const invoice = decodeURIComponent(url.pathname.slice('/track/'.length))
      const status = this.#byInvoice.get(invoice)?.status ?? null
      res.writeHead(status === null ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>가짜 택배 조회</title><h1>가짜 택배 조회</h1><p>${status === null ? '모르는 송장번호예요.' : `상태: ${status}`}</p></html>`)
      return
    }
    if (req.method === 'GET' && url.pathname === '/_fake/requests') return json(200, { requests: this.requests, bookings: this.bookingCount })
    if (req.method !== 'POST') return json(405, { error: 'METHOD' })
    let body: Record<string, unknown> = {}
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    } catch {
      return json(400, { error: 'REJECTED' })
    }
    switch (url.pathname) {
      case '/book':
        return this.#onBook(body, res, json)
      case '/cancel':
        return this.#onCancel(body, res, json)
      case '/track':
        return this.#onTrack(body, res, json)
      case '/_fake/status': {
        const ok = typeof body.invoice === 'string' && FAKE_TRACK_STATUSES.includes(body.status as FakeTrackStatus) && this.setStatus(body.invoice, body.status as FakeTrackStatus)
        return json(ok ? 200 : 400, { ok })
      }
      case '/_fake/fail': {
        const op = body.op
        const kind = body.kind
        const times = typeof body.times === 'number' && Number.isInteger(body.times) && body.times >= 1 && body.times <= 100 ? body.times : 1
        if ((op !== 'book' && op !== 'cancel' && op !== 'track') || !FAKE_FAILURES.includes(kind as FakeFailure)) return json(400, { ok: false })
        this.failNext(op, kind as FakeFailure, times)
        return json(200, { ok: true })
      }
      case '/_fake/reset':
        this.reset()
        return json(200, { ok: true })
      default:
        return json(404, { error: 'NOT_FOUND' })
    }
  }

  async #onBook(body: Record<string, unknown>, res: ServerResponse, json: (status: number, body: unknown) => void): Promise<void> {
    const requestKey = typeof body.requestKey === 'string' ? body.requestKey : null
    this.requests.push({ op: 'book', requestKey, invoices: [], body })
    if (requestKey === null) return json(422, { error: 'REJECTED', message: 'requestKey' })
    const receiver = (typeof body.receiver === 'object' && body.receiver !== null ? body.receiver : {}) as Record<string, unknown>
    const address = typeof receiver.address === 'string' ? receiver.address : ''
    const echo = this.echo ? { echo: `받은 주소: ${address} ${typeof receiver.detail === 'string' ? receiver.detail : ''} ${typeof receiver.phone === 'string' ? receiver.phone : ''}` } : {}
    // 이미 받은 요청 번호면 표시 글자와 상관없이 처음 답 (같은 요청 번호 = 같은 송장번호)
    const known = this.#bookings.get(requestKey)
    const failure = this.#takeFailure('book') ?? (known === undefined ? (ADDRESS_MARKERS.find(([marker]) => address.includes(marker))?.[1] ?? null) : null)
    switch (failure) {
      case 'ADDRESS':
        return json(422, { error: 'ADDRESS', ...echo })
      case 'REJECTED':
        return json(422, { error: 'REJECTED', ...echo })
      case 'ERROR_500':
        return json(500, { error: 'SERVER', ...echo })
      case 'TIMEOUT':
        return this.#hang(res)
      case 'TIMEOUT_AFTER_BOOK':
        this.#book(requestKey)
        return this.#hang(res)
      case 'BAD_INVOICE':
        return json(200, { invoice: 'INV-가짜', ...echo })
      default:
        return json(200, { invoice: this.#book(requestKey).invoice })
    }
  }

  async #onCancel(body: Record<string, unknown>, res: ServerResponse, json: (status: number, body: unknown) => void): Promise<void> {
    const invoice = typeof body.invoice === 'string' ? body.invoice : ''
    this.requests.push({ op: 'cancel', requestKey: null, invoices: [invoice], body })
    const failure = this.#takeFailure('cancel')
    if (failure === 'TIMEOUT' || failure === 'TIMEOUT_AFTER_BOOK') return this.#hang(res)
    if (failure === 'ERROR_500') return json(500, { error: 'SERVER' })
    const booking = this.#byInvoice.get(invoice)
    if (booking === undefined) return json(404, { error: 'NOT_FOUND' })
    if (failure === 'REFUSED' || (booking.status !== 'ACCEPTED' && booking.status !== 'CANCELLED')) return json(409, { error: 'PICKED_UP' })
    booking.status = 'CANCELLED'
    return json(200, { ok: true })
  }

  async #onTrack(body: Record<string, unknown>, res: ServerResponse, json: (status: number, body: unknown) => void): Promise<void> {
    const invoices = Array.isArray(body.invoices) ? (body.invoices as unknown[]).filter((item): item is string => typeof item === 'string') : []
    this.requests.push({ op: 'track', requestKey: null, invoices, body })
    const failure = this.#takeFailure('track')
    if (failure === 'TIMEOUT' || failure === 'TIMEOUT_AFTER_BOOK') return this.#hang(res)
    if (failure !== null) return json(500, { error: 'SERVER' })
    const items = invoices.flatMap((invoice) => {
      const booking = this.#byInvoice.get(invoice)
      return booking === undefined ? [] : [{ invoice, status: booking.status }]
    })
    return json(200, { items })
  }
}
