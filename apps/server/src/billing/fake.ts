// 시험 결제 (AC-N5-40, D-N5-08): 포트원 V2 모양의 가짜 결제 서버. 요금 기능을 켠 E2E 기동·서버 시험만 쓴다 — 운영 기동(productionServerOptions)에는 없다.
// - 결제 조회 GET /payments/:id·전액 취소 POST /payments/:id/cancel을 포트원 V2와 같은 모양(Authorization 머리말·응답 칸)으로 한다.
//   서버의 결제 어댑터(PortOneGateway)가 이 가짜 서버를 HTTP 모양 그대로 부른다(프로세스 안 요청 — 네트워크 없음).
// - 시험 조작: 그 결제를 완료(카드·계좌이체)·실패·금액 바꿔 완료, 조회 실패 켜고 끄기, 취소 실패 켜고 끄기,
//   취소는 반영하고 응답만 실패(cancelLost)·늦게(cancelDelayMs — 어댑터 시간 제한을 넘기면 시간 초과), 서명한 웹훅 만들기.
// - 어댑터의 시간 제한(AbortSignal)을 지킨다: 응답이 늦으면 어댑터는 시간 초과('error')를 받고, 가짜 서버 쪽 처리(취소 반영)는 그대로 남는다.
import { Hono } from 'hono'
import { DEFAULT_PRICE_TABLE, type PriceTable } from './config.ts'
import { FakeIssuer } from './documents.ts'
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
  /** 마지막으로 받은 요청 (시험이 모양을 본다) */
  readonly requests: { method: string; path: string; query: string; authorization: string | null; body: string }[] = []

  readonly storeId: string
  readonly apiSecret: string

  constructor(storeId: string = TEST_STORE_ID, apiSecret: string = TEST_API_SECRET) {
    this.storeId = storeId
    this.apiSecret = apiSecret
    this.app.use(async (c, next) => {
      const body = c.req.method === 'GET' ? '' : await c.req.text()
      const url = new URL(c.req.url)
      this.requests.push({ method: c.req.method, path: url.pathname, query: url.search, authorization: c.req.header('authorization') ?? null, body })
      if (c.req.header('authorization') !== `PortOne ${this.apiSecret}`) return c.json({ type: 'UNAUTHORIZED', message: '인증 실패' }, 401)
      return next()
    })
    this.app.get('/payments/:id', (c) => {
      this.lookups += 1
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
      if (this.cancelDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.cancelDelayMs))
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

  /** 이 가짜 서버를 HTTP 모양 그대로 부르는 결제 어댑터 */
  gateway(timeoutMs?: number): PaymentGateway {
    return new PortOneGateway({
      storeId: this.storeId,
      apiSecret: this.apiSecret,
      baseUrl: FAKE_PORTONE_BASE,
      fetch: (input, init) => withAbort(Promise.resolve(this.app.request(input, init)), init.signal ?? null),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
  }
}

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
  readonly issuer: FakeIssuer
  readonly webhookSecret: string
}

export interface TestBillingOptions {
  readonly enabled?: boolean
  readonly prices?: PriceTable
  /** 결제 조회·취소 시간 제한 (시험은 줄인다) */
  readonly timeoutMs?: number
}

/** 시험용 요금 설정 (가짜 결제 서버·가짜 발행기·기본 요금 표). 서버 시험·E2E 기동만 쓴다 */
export function testBilling(options: TestBillingOptions = {}): BillingSetup {
  const portone = new FakePortOne()
  const issuer = new FakeIssuer()
  return {
    enabled: options.enabled ?? true,
    prices: options.prices ?? DEFAULT_PRICE_TABLE,
    storeId: TEST_STORE_ID,
    gateway: portone.gateway(options.timeoutMs),
    issuer,
    webhookSecret: TEST_WEBHOOK_SECRET,
    publicKeys: null,
    test: { portone, issuer, webhookSecret: TEST_WEBHOOK_SECRET },
  }
}
