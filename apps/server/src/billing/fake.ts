// 시험 결제 (AC-N5-40, D-N5-08): 포트원 V2 모양의 가짜 결제 서버. 요금 기능을 켠 E2E 기동·서버 시험만 쓴다 — 운영 기동(productionServerOptions)에는 없다.
// - 결제 조회 GET /payments/:id·전액 취소 POST /payments/:id/cancel을 포트원 V2와 같은 모양(Authorization 머리말·응답 칸)으로 한다.
//   서버의 결제 어댑터(PortOneGateway)가 이 가짜 서버를 HTTP 모양 그대로 부른다(프로세스 안 요청 — 네트워크 없음).
// - 시험 조작: 그 결제를 완료(카드·계좌이체)·실패·금액 바꿔 완료, 조회 실패 켜고 끄기, 취소 실패 켜고 끄기,
//   취소는 반영하고 응답만 실패(cancelLost)·늦게(cancelDelayMs — 어댑터 시간 제한을 넘기면 시간 초과), 서명한 웹훅 만들기.
// - PAY2: 조회 지연(lookupDelayMs), 받은 Idempotency-Key 기록, 포트원 V2 현금영수증 API 같은 모양
//   (GET /payments/:id/cash-receipt · POST /cash-receipts · POST /payments/:id/cash-receipt/cancel — cash-receipt.ts 머리 주석).
// - 어댑터의 시간 제한(AbortSignal)을 지킨다: 응답이 늦으면 어댑터는 시간 초과('error')를 받고, 가짜 서버 쪽 처리(취소 반영)는 그대로 남는다.
import { Hono } from 'hono'
import { DEFAULT_PRICE_TABLE, type PriceTable } from './config.ts'
import { PortOneCashReceiptIssuer } from './cash-receipt.ts'
import { FakeIssuer, type DocumentIssuer } from './documents.ts'
import { PortOneGateway, signWebhook, type PaymentGateway } from './portone.ts'
import type { BillingSetup } from './service.ts'

export const TEST_STORE_ID = 'store-test-livejjim'
export const TEST_CHANNEL_KEY = 'channel-key-test-livejjim'
/** 시험 결제의 API 비밀값·웹훅 비밀값 (실제 비밀값이 아니다 — 프로세스 안 가짜 서버만 받는다) */
export const TEST_API_SECRET = 'test-portone-api-secret'
export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from('livejjim-test-webhook-secret-0001').toString('base64')}`
/** 가짜 서버 주소 (프로세스 안 요청이라 실제로 열지 않는다) */
export const FAKE_PORTONE_BASE = 'http://portone.fake.invalid'

export type FakeMethod = 'CARD' | 'TRANSFER'

interface FakePayment {
  status: string
  amount: number
  method: FakeMethod
}

/** 가짜 현금영수증 (raw = 조회 응답 본문을 그대로 — 시험이 이상한 본문을 준다) */
export type FakeCashReceipt =
  | { readonly status: string; readonly type?: string; readonly issueNumber?: string }
  | { readonly raw: unknown }

const METHOD_TYPE: Readonly<Record<FakeMethod, string>> = { CARD: 'PaymentMethodCard', TRANSFER: 'PaymentMethodTransfer' }

/** 포트원 V2 모양 가짜 결제 서버 */
export class FakePortOne {
  readonly app = new Hono()
  readonly #payments = new Map<string, FakePayment>()
  lookupFailure = false
  /** 취소하지 않고 502 */
  cancelFailure = false
  /** 취소는 반영하고 응답은 502 — 포트원은 취소했는데 우리 쪽 응답이 끊긴 경우 (RA-N5-01) */
  cancelLost = false
  /** 취소를 반영한 뒤 응답까지 기다리는 밀리초 (어댑터 시간 제한보다 길면 시간 초과) */
  cancelDelayMs = 0
  /** 받은 취소 요청 수 (결제 ID마다 — 시험이 "취소를 한 번만 요청"을 센다) */
  readonly cancelCalls = new Map<string, number>()
  /** 받은 조회 요청 수 */
  lookups = 0
  /** 결제 ID마다 받은 조회 요청 수 */
  readonly lookupCalls = new Map<string, number>()
  /** 조회 응답까지 기다리는 밀리초 (어댑터 시간 제한보다 길면 시간 초과) */
  lookupDelayMs = 0
  /** 결제 취소 때 PG가 현금영수증도 함께 취소하는지 */
  cancelCashReceiptWithPayment = false
  /** 현금영수증 조회: 503 */
  cashReceiptLookupFailure = false
  cashReceiptLookupDelayMs = 0
  /** 현금영수증 발급: 503 (발급하지 않음) */
  cashReceiptIssueFailure = false
  /** 현금영수증 발급: 반영한 뒤 응답까지 기다리는 밀리초 */
  cashReceiptIssueDelayMs = 0
  /** 현금영수증 취소: 502 (취소하지 않음) */
  cashReceiptCancelFailure = false
  cashReceiptCancelDelayMs = 0
  /** 결제 ID → 현금영수증 */
  readonly cashReceipts = new Map<string, FakeCashReceipt>()
  /** 받은 현금영수증 조회 요청 수 (결제 ID마다) */
  readonly cashReceiptLookups = new Map<string, number>()
  /** 받은 현금영수증 발급·취소 요청 */
  readonly cashReceiptIssues: { paymentId: string; body: Record<string, unknown>; idempotencyKey: string | null }[] = []
  readonly cashReceiptCancels: { paymentId: string; idempotencyKey: string | null }[] = []
  /** 마지막으로 받은 요청 (시험이 모양을 본다) */
  readonly requests: { method: string; path: string; query: string; authorization: string | null; body: string; idempotencyKey: string | null }[] = []
  #issueSeq = 0

  readonly storeId: string
  readonly apiSecret: string

  constructor(storeId: string = TEST_STORE_ID, apiSecret: string = TEST_API_SECRET) {
    this.storeId = storeId
    this.apiSecret = apiSecret
    this.app.use(async (c, next) => {
      const body = c.req.method === 'GET' ? '' : await c.req.text()
      const url = new URL(c.req.url)
      this.requests.push({ method: c.req.method, path: url.pathname, query: url.search, authorization: c.req.header('authorization') ?? null, body, idempotencyKey: c.req.header('idempotency-key') ?? null })
      if (c.req.header('authorization') !== `PortOne ${this.apiSecret}`) return c.json({ type: 'UNAUTHORIZED', message: '인증 실패' }, 401)
      return next()
    })
    this.app.get('/payments/:id/cash-receipt', async (c) => {
      const id = c.req.param('id')
      this.cashReceiptLookups.set(id, (this.cashReceiptLookups.get(id) ?? 0) + 1)
      if (this.cashReceiptLookupDelayMs > 0) await sleep(this.cashReceiptLookupDelayMs)
      if (this.cashReceiptLookupFailure) return c.json({ type: 'INTERNAL', message: '시험용 현금영수증 조회 실패' }, 503)
      const receipt = this.cashReceipts.get(id)
      if (receipt === undefined) return c.json({ type: 'CASH_RECEIPT_NOT_FOUND', message: '현금영수증이 존재하지 않습니다.' }, 404)
      if ('raw' in receipt) return c.body(receipt.raw === undefined ? '' : JSON.stringify(receipt.raw), 200, { 'Content-Type': 'application/json' })
      const payment = this.#payments.get(id)
      return c.json({
        status: receipt.status,
        merchantId: 'merchant-test',
        storeId: this.storeId,
        paymentId: id,
        channel: { type: 'TEST', pgProvider: 'TOSSPAYMENTS' },
        amount: payment?.amount ?? 0,
        currency: 'KRW',
        orderName: '시험 결제',
        isManual: false,
        ...(receipt.type === undefined ? {} : { type: receipt.type }),
        ...(receipt.issueNumber === undefined ? {} : { issueNumber: receipt.issueNumber }),
        issuedAt: '2026-10-31T00:00:00Z',
      })
    })
    this.app.post('/cash-receipts', async (c) => {
      let body: Record<string, unknown>
      try {
        body = (await c.req.json()) as Record<string, unknown>
      } catch {
        return c.json({ type: 'INVALID_REQUEST', message: '본문' }, 400)
      }
      const paymentId = typeof body['paymentId'] === 'string' ? body['paymentId'] : ''
      this.cashReceiptIssues.push({ paymentId, body, idempotencyKey: c.req.header('idempotency-key') ?? null })
      if (this.cashReceiptIssueFailure) return c.json({ type: 'PG_PROVIDER', message: '시험용 발급 실패' }, 503)
      if (body['storeId'] !== this.storeId) return c.json({ type: 'FORBIDDEN', message: '상점' }, 403)
      const existing = this.cashReceipts.get(paymentId)
      if (existing !== undefined && !('raw' in existing) && existing.status === 'ISSUED') return c.json({ type: 'CASH_RECEIPT_ALREADY_ISSUED', message: '이미 발급됨' }, 409)
      this.#issueSeq += 1
      const issueNumber = `FAKE${String(this.#issueSeq).padStart(8, '0')}`
      this.cashReceipts.set(paymentId, { status: 'ISSUED', type: body['type'] === 'PERSONAL' ? 'PERSONAL' : 'CORPORATE', issueNumber })
      if (this.cashReceiptIssueDelayMs > 0) await sleep(this.cashReceiptIssueDelayMs)
      return c.json({ cashReceipt: { type: body['type'], pgReceiptId: `pg-${issueNumber}`, issueNumber, url: 'https://receipt.fake.invalid/', issuedAt: '2026-10-31T00:00:00Z' } })
    })
    this.app.post('/payments/:id/cash-receipt/cancel', async (c) => {
      const id = c.req.param('id')
      this.cashReceiptCancels.push({ paymentId: id, idempotencyKey: c.req.header('idempotency-key') ?? null })
      if (this.cashReceiptCancelFailure) return c.json({ type: 'PG_PROVIDER', message: '시험용 취소 실패' }, 502)
      const receipt = this.cashReceipts.get(id)
      if (receipt === undefined || 'raw' in receipt) return c.json({ type: 'CASH_RECEIPT_NOT_FOUND', message: '없음' }, 404)
      if (receipt.status !== 'ISSUED') return c.json({ type: 'CASH_RECEIPT_NOT_ISSUED', message: '발급 상태 아님' }, 409)
      this.cashReceipts.set(id, { ...receipt, status: 'CANCELLED' })
      if (this.cashReceiptCancelDelayMs > 0) await sleep(this.cashReceiptCancelDelayMs)
      return c.json({ cancelledAmount: this.#payments.get(id)?.amount ?? 0, cancelledAt: '2026-10-31T00:00:00Z' })
    })
    this.app.get('/payments/:id', async (c) => {
      this.lookups += 1
      this.lookupCalls.set(c.req.param('id'), (this.lookupCalls.get(c.req.param('id')) ?? 0) + 1)
      if (this.lookupDelayMs > 0) await sleep(this.lookupDelayMs)
      if (this.lookupFailure) return c.json({ type: 'INTERNAL', message: '시험용 조회 실패' }, 503)
      const id = c.req.param('id')
      const payment = this.#payments.get(id)
      if (payment === undefined) return c.json({ type: 'PAYMENT_NOT_FOUND', message: '결제 건이 존재하지 않습니다.' }, 404)
      return c.json({
        status: payment.status,
        id,
        storeId: this.storeId,
        channel: { type: 'TEST', pgProvider: 'TOSSPAYMENTS' },
        orderName: '시험 결제',
        amount: { total: payment.amount, taxFree: 0, vat: 0, supply: payment.amount, discount: 0, paid: payment.status === 'PAID' ? payment.amount : 0, cancelled: 0, cancelledTaxFree: 0 },
        currency: 'KRW',
        method: { type: METHOD_TYPE[payment.method] },
      })
    })
    this.app.post('/payments/:id/cancel', async (c) => {
      const id = c.req.param('id')
      this.cancelCalls.set(id, (this.cancelCalls.get(id) ?? 0) + 1)
      if (this.cancelFailure) return c.json({ type: 'PG_PROVIDER', message: '시험용 취소 실패' }, 502)
      const payment = this.#payments.get(id)
      if (payment === undefined) return c.json({ type: 'PAYMENT_NOT_FOUND', message: '결제 건이 존재하지 않습니다.' }, 404)
      if (payment.status === 'CANCELLED') return c.json({ type: 'PAYMENT_ALREADY_CANCELLED', message: '이미 취소된 결제입니다.' }, 409)
      if (payment.status !== 'PAID') return c.json({ type: 'PAYMENT_NOT_PAID', message: '결제 완료 상태가 아닙니다.' }, 409)
      payment.status = 'CANCELLED'
      const receipt = this.cashReceipts.get(id)
      if (this.cancelCashReceiptWithPayment && receipt !== undefined && !('raw' in receipt) && receipt.status === 'ISSUED') this.cashReceipts.set(id, { ...receipt, status: 'CANCELLED' })
      if (this.cancelDelayMs > 0) await sleep(this.cancelDelayMs)
      if (this.cancelLost) return c.json({ type: 'INTERNAL', message: '시험용 응답 끊김(취소는 반영됨)' }, 502)
      return c.json({ cancellation: { status: 'SUCCEEDED', id: `cancel-${id}`, totalAmount: payment.amount } })
    })
  }

  /** 그 결제를 완료로 (amount = 결제된 금액 — 주문과 다르게 줄 수 있다) */
  pay(paymentId: string, amount: number, method: FakeMethod): void {
    this.#payments.set(paymentId, { status: 'PAID', amount, method })
  }

  /** 그 결제를 실패로 */
  fail(paymentId: string, amount: number, method: FakeMethod = 'CARD'): void {
    this.#payments.set(paymentId, { status: 'FAILED', amount, method })
  }

  /** 그 결제를 아무 상태로 (시험용 — 예: PAY_PENDING·PARTIAL_CANCELLED·모르는 상태) */
  setStatus(paymentId: string, status: string, amount: number, method: FakeMethod = 'CARD'): void {
    this.#payments.set(paymentId, { status, amount, method })
  }

  status(paymentId: string): string | null {
    return this.#payments.get(paymentId)?.status ?? null
  }

  /** 그 결제의 현금영수증을 정한다 (PG가 결제 창에서 발급한 경우 등). null이면 지운다 */
  setCashReceipt(paymentId: string, receipt: FakeCashReceipt | null): void {
    if (receipt === null) this.cashReceipts.delete(paymentId)
    else this.cashReceipts.set(paymentId, receipt)
  }

  readonly #fetch = (input: string, init: RequestInit): Promise<Response> => withAbort(Promise.resolve(this.app.request(input, init)), init.signal ?? null)

  /** 이 가짜 서버를 HTTP 모양 그대로 부르는 결제 어댑터 (timeouts: 숫자면 조회·상태 바꾸기 모두) */
  gateway(timeouts?: number | FakeTimeouts): PaymentGateway {
    return new PortOneGateway({ storeId: this.storeId, apiSecret: this.apiSecret, baseUrl: FAKE_PORTONE_BASE, fetch: this.#fetch, ...timeoutOptions(timeouts) })
  }

  /** 이 가짜 서버를 부르는 포트원 현금영수증 발행기 */
  cashReceiptIssuer(timeouts?: number | FakeTimeouts): PortOneCashReceiptIssuer {
    return new PortOneCashReceiptIssuer({ storeId: this.storeId, apiSecret: this.apiSecret, channelKey: TEST_CHANNEL_KEY, baseUrl: FAKE_PORTONE_BASE, fetch: this.#fetch, ...timeoutOptions(timeouts) })
  }
}

/** 조회·상태를 바꾸는 요청의 시간 한도 (시험이 줄인다) */
export interface FakeTimeouts {
  readonly lookupTimeoutMs?: number
  readonly mutateTimeoutMs?: number
}

function timeoutOptions(timeouts: number | FakeTimeouts | undefined): { timeoutMs?: number; lookupTimeoutMs?: number; mutateTimeoutMs?: number } {
  if (timeouts === undefined) return {}
  if (typeof timeouts === 'number') return { timeoutMs: timeouts }
  return { ...(timeouts.lookupTimeoutMs === undefined ? {} : { lookupTimeoutMs: timeouts.lookupTimeoutMs }), ...(timeouts.mutateTimeoutMs === undefined ? {} : { mutateTimeoutMs: timeouts.mutateTimeoutMs }) }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 어댑터의 시간 제한을 지킨다 — 신호가 먼저 끝나면 실제 fetch처럼 거절한다(가짜 서버 쪽 처리는 그대로 끝까지 간다) */
function withAbort(response: Promise<Response>, signal: AbortSignal | null): Promise<Response> {
  if (signal === null) return response
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    response.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error instanceof Error ? error : new Error('fetch failed'))
      },
    )
  })
}

/** 서명한 포트원 V2 웹훅 (본문·머리말) — 시험 웹훅 보내기 */
export function signedWebhook(secret: string, paymentId: string, now: number, type = 'Transaction.Paid'): { body: string; headers: Record<string, string> } {
  const id = `msg_${String(now)}_${paymentId.slice(0, 8)}`
  const timestamp = Math.floor(now / 1000)
  const body = JSON.stringify({ type, timestamp: new Date(now).toISOString(), data: { storeId: TEST_STORE_ID, paymentId, transactionId: `tx-${paymentId}` } })
  return { body, headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signWebhook(secret, id, timestamp, body) } }
}

/** 시험 결제 묶음: 가짜 결제 서버·가짜 발행기 */
export interface TestPayment {
  readonly portone: FakePortOne
  /** 가짜 발행기 (발행기가 포트원 현금영수증이어도 있다 — 쓰이지 않을 뿐) */
  readonly issuer: FakeIssuer
  readonly webhookSecret: string
}

export interface TestBillingOptions {
  readonly enabled?: boolean
  readonly prices?: PriceTable
  /** 결제 조회·취소 시간 제한 (시험은 줄인다) — 숫자면 둘 다 */
  readonly timeoutMs?: number | FakeTimeouts
  /** 증빙 발행기: 가짜(기본) · 포트원 현금영수증(가짜 포트원 서버로) */
  readonly issuer?: 'fake' | 'portone'
}

/**
 * 확정 요금 표 (시험용 — 자리 표시가 아니다). E2E 서버의 공개 요금 안내·요금 화면 시험이 쓴다(AC-PAY2-12·15).
 * 값은 시험용이다 — 운영 가격은 D-014에서 사용자가 정한다
 */
export const TEST_FINAL_PRICE_TABLE: PriceTable = {
  placeholder: false,
  items: [
    { id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 29_000, onSale: true },
    { id: 'days-1', name: '방송 일권 1일', kind: 'DAYS', quantity: 1, price: 4_900, onSale: true },
    { id: 'orders-100', name: '주문 건권 100건', kind: 'ORDERS', quantity: 100, price: 9_900, onSale: false },
    { id: 'labels-100', name: '라벨 장권 100장', kind: 'LABELS', quantity: 100, price: 1_900, onSale: true },
  ],
}

/** 시험용 요금 설정 (가짜 결제 서버·가짜 발행기·기본 요금 표). 서버 시험·E2E 기동만 쓴다 */
export function testBilling(options: TestBillingOptions = {}): BillingSetup {
  const portone = new FakePortOne()
  const issuer = new FakeIssuer()
  const used: DocumentIssuer = options.issuer === 'portone' ? portone.cashReceiptIssuer(options.timeoutMs) : issuer
  return {
    enabled: options.enabled ?? true,
    prices: options.prices ?? DEFAULT_PRICE_TABLE,
    storeId: TEST_STORE_ID,
    gateway: portone.gateway(options.timeoutMs),
    issuer: used,
    webhookSecret: TEST_WEBHOOK_SECRET,
    publicKeys: null,
    test: { portone, issuer, webhookSecret: TEST_WEBHOOK_SECRET },
  }
}
