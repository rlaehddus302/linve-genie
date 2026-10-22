// N5 포트원 V2 어댑터 (AC-N5-40·02): 로컬 가짜 HTTP 서버로 요청 모양(주소·Authorization·본문)을 확인하고, 응답 칸을 G-BIL payment 입력으로 옮긴다.
// 웹훅 서명(Standard Webhooks)의 시험 벡터도 여기서 고정한다(dev-notes "웹훅 서명").
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PortOneGateway, checkWebhook, mapPortOnePayment, signWebhook, webhookKey } from '../src/billing/portone.ts'
import { judgePayment } from '../src/billing/rules.ts'

interface Seen {
  method: string
  url: string
  authorization: string | undefined
  contentType: string | undefined
  body: string
}

let server: Server
let base = ''
const seen: Seen[] = []
let reply: (request: Seen) => { status: number; body: string } = () => ({ status: 500, body: '' })

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      const entry = { method: request.method ?? '', url: request.url ?? '', authorization: request.headers.authorization, contentType: request.headers['content-type'], body }
      seen.push(entry)
      const out = reply(entry)
      response.writeHead(out.status, { 'Content-Type': 'application/json' })
      response.end(out.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('주소 없음')
  base = `http://127.0.0.1:${String(address.port)}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const PAYMENT_ID = 'lj0123456789abcdef0123456789abcdef'
const gateway = () => new PortOneGateway({ storeId: 'store-abc', apiSecret: 'secret-xyz', baseUrl: base })

const paid = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    status: 'PAID',
    id: PAYMENT_ID,
    storeId: 'store-abc',
    amount: { total: 30000, taxFree: 0, vat: 2727, supply: 27273, discount: 0, paid: 30000, cancelled: 0, cancelledTaxFree: 0 },
    currency: 'KRW',
    method: { type: 'PaymentMethodTransfer', bank: 'SHINHAN' },
    ...overrides,
  })

describe('AC-N5-40 포트원 V2 결제 조회', () => {
  it('GET /payments/{결제 ID}?storeId=… · Authorization: PortOne {API 비밀값} — 응답 칸(상태·금액·통화·상점·수단)을 판단 입력으로', async () => {
    reply = () => ({ status: 200, body: paid() })
    const result = await gateway().lookup(PAYMENT_ID)
    const request = seen.at(-1) as Seen
    expect(request).toMatchObject({ method: 'GET', url: `/payments/${PAYMENT_ID}?storeId=store-abc`, authorization: 'PortOne secret-xyz', body: '' })
    expect(result).toEqual({ kind: 'found', payment: { status: 'PAID', amount: 30000, currency: 'KRW', storeId: 'store-abc', method: 'TRANSFER' } })
    if (result.kind !== 'found') return
    expect(judgePayment({ order: { amount: 30000, state: 'PENDING' }, payment: result.payment, storeId: 'store-abc' })).toEqual({ action: 'GRANT', document: true })
  })

  it('수단 type을 옮기고 모르는 상태·수단은 그대로 넘겨 확인 필요가 되게', async () => {
    expect(mapPortOnePayment(JSON.parse(paid({ method: { type: 'PaymentMethodCard' } })))).toMatchObject({ method: 'CARD' })
    expect(mapPortOnePayment(JSON.parse(paid({ method: { type: 'PaymentMethodEasyPay' } })))).toMatchObject({ method: 'EASY_PAY' })
    expect(mapPortOnePayment(JSON.parse(paid({ method: { type: 'PaymentMethodSomethingNew' } })))).toMatchObject({ method: 'PaymentMethodSomethingNew' })
    const unknown = mapPortOnePayment(JSON.parse(paid({ status: 'SOMETHING_NEW' })))
    expect(unknown).toMatchObject({ status: 'SOMETHING_NEW' })
    expect(judgePayment({ order: { amount: 30000, state: 'PENDING' }, payment: unknown, storeId: 'store-abc' }).action).toBe('REVIEW')
    // 결제 전(READY)은 금액·수단이 없어도 된다
    expect(mapPortOnePayment({ status: 'READY', storeId: 'store-abc' })).toEqual({ status: 'READY', amount: null, currency: null, storeId: 'store-abc', method: null })
  })

  it('404 PAYMENT_NOT_FOUND = 없음(기다림), 5xx·401·이상한 응답 = 조회 실패 (판단을 짐작하지 않는다)', async () => {
    reply = () => ({ status: 404, body: JSON.stringify({ type: 'PAYMENT_NOT_FOUND', message: '없음' }) })
    expect(await gateway().lookup(PAYMENT_ID)).toEqual({ kind: 'missing' })
    for (const [status, body] of [
      [500, JSON.stringify({ type: 'INTERNAL' })],
      [503, ''],
      [401, JSON.stringify({ type: 'UNAUTHORIZED' })],
      [404, JSON.stringify({ type: 'STORE_NOT_FOUND' })],
      [200, 'not json'],
      [200, JSON.stringify([1, 2])],
      [200, JSON.stringify({ status: 7 })],
      [200, paid({ amount: { total: 1.5 } })],
      [200, paid({ amount: null })],
      [200, paid({ currency: undefined })],
    ] as const) {
      reply = () => ({ status, body })
      expect(await gateway().lookup(PAYMENT_ID), `${String(status)} ${body}`).toEqual({ kind: 'error' })
    }
    // 결제 ID 형식이 틀리면 부르지 않는다
    const count = seen.length
    expect(await gateway().lookup('../stores')).toEqual({ kind: 'error' })
    expect(seen.length).toBe(count)
  })
})

describe('AC-N5-40 포트원 V2 전액 취소', () => {
  it('POST /payments/{결제 ID}/cancel · 본문 { storeId, reason } (금액 없음 = 전액)', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ cancellation: { status: 'SUCCEEDED', id: 'c1', totalAmount: 30000 } }) })
    expect(await gateway().cancel(PAYMENT_ID, '7일 환불')).toEqual({ kind: 'ok' })
    const request = seen.at(-1) as Seen
    expect(request).toMatchObject({ method: 'POST', url: `/payments/${PAYMENT_ID}/cancel`, authorization: 'PortOne secret-xyz', contentType: 'application/json' })
    expect(JSON.parse(request.body)).toEqual({ storeId: 'store-abc', reason: '7일 환불' })
    reply = () => ({ status: 200, body: JSON.stringify({ cancellation: { status: 'REQUESTED' } }) })
    expect(await gateway().cancel(PAYMENT_ID, '7일 환불')).toEqual({ kind: 'ok' })
    reply = () => ({ status: 200, body: JSON.stringify({ cancellation: { status: 'FAILED' } }) })
    expect(await gateway().cancel(PAYMENT_ID, '7일 환불')).toEqual({ kind: 'error' })
    reply = () => ({ status: 409, body: JSON.stringify({ type: 'PAYMENT_ALREADY_CANCELLED' }) })
    expect(await gateway().cancel(PAYMENT_ID, '7일 환불')).toEqual({ kind: 'already' })
    reply = () => ({ status: 502, body: JSON.stringify({ type: 'PG_PROVIDER' }) })
    expect(await gateway().cancel(PAYMENT_ID, '7일 환불')).toEqual({ kind: 'error' })
  })
})

describe('AC-N5-32 웹훅 서명 (Standard Webhooks — 포트원 V2)', () => {
  const secret = `whsec_${Buffer.from('test-secret-for-vector').toString('base64')}`
  const body = '{"type":"Transaction.Paid","timestamp":"2026-10-20T11:00:00.000Z","data":{"paymentId":"lj0123456789abcdef0123456789abcdef","storeId":"store-abc","transactionId":"tx1"}}'
  const id = 'msg_vector_1'
  const timestamp = 1792494000 // 2026-10-20T11:00:00Z
  const headers = (signature: string, ts = String(timestamp)) => new Headers({ 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': signature })

  it('시험 벡터: 서명 = base64(HMAC-SHA256(whsec_ 뒤 base64를 푼 키, "id.timestamp.본문"))', () => {
    expect(webhookKey(secret)?.toString('utf8')).toBe('test-secret-for-vector')
    const signature = signWebhook(secret, id, timestamp, body)
    expect(signature).toBe('v1,W5T5soFGUpxF7X5f0OGPH9G48t3J09Tu78kS7XCHyaM=')
    expect(checkWebhook(secret, headers(signature), body, timestamp * 1000)).toEqual({ ok: true, paymentId: 'lj0123456789abcdef0123456789abcdef' })
    // 서명 여럿(띄어쓰기) 중 하나가 맞으면 된다
    expect(checkWebhook(secret, headers(`v1,AAAA ${signature}`), body, timestamp * 1000).ok).toBe(true)
  })

  it('±5분 밖·다른 비밀값·본문 바꿈·서명 없음은 거절', () => {
    const signature = signWebhook(secret, id, timestamp, body)
    expect(checkWebhook(secret, headers(signature), body, timestamp * 1000 + 5 * 60 * 1000).ok).toBe(true)
    expect(checkWebhook(secret, headers(signature), body, timestamp * 1000 + 5 * 60 * 1000 + 1000).ok).toBe(false)
    expect(checkWebhook(secret, headers(signature), body, timestamp * 1000 - 5 * 60 * 1000 - 1000).ok).toBe(false)
    expect(checkWebhook(`whsec_${Buffer.from('other').toString('base64')}`, headers(signature), body, timestamp * 1000).ok).toBe(false)
    expect(checkWebhook(secret, headers(signature), body.replace('tx1', 'tx2'), timestamp * 1000).ok).toBe(false)
    expect(checkWebhook(secret, new Headers({ 'webhook-id': id, 'webhook-timestamp': String(timestamp) }), body, timestamp * 1000).ok).toBe(false)
    expect(checkWebhook('', headers(signature), body, timestamp * 1000).ok).toBe(false)
  })

  it('빌링키 알림처럼 결제 ID가 없는 종류는 결제 ID 없음으로 받는다', () => {
    const other = '{"type":"BillingKey.Issued","timestamp":"2026-10-20T11:00:00.000Z","data":{"billingKey":"bk"}}'
    expect(checkWebhook(secret, headers(signWebhook(secret, id, timestamp, other)), other, timestamp * 1000)).toEqual({ ok: true, paymentId: null })
  })
})
