// PAY2 서버 (AC-PAY2-06~12·16): 결제 대기 자동 재확인, 포트원 요청 시간 한도·멱등 키, 포트원 현금영수증 발행기, 공개 요금 안내.
// 시간이 드는 일(칸·60초 한도)은 주입한 시계와 줄인 시간 한도(또는 가짜 타이머)로 흉내 낸다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortOneCashReceiptIssuer, readCashReceipt } from '../src/billing/cash-receipt.ts'
import { RECEIPT_ISSUER_PORTONE_REFUSAL, RECEIPT_ISSUER_REFUSAL, readReceiptIssuerEnv, type PriceTable } from '../src/billing/config.ts'
import { FakeIssuer, noneIssuer } from '../src/billing/documents.ts'
import { FAKE_PORTONE_BASE, FakePortOne, TEST_API_SECRET, TEST_CHANNEL_KEY, TEST_FINAL_PRICE_TABLE, TEST_STORE_ID, TEST_WEBHOOK_SECRET, signedWebhook, testBilling } from '../src/billing/fake.ts'
import { STALE_PENDING_MS, operatorLists } from '../src/billing/operator.ts'
import { PORTONE_MUTATE_TIMEOUT_MS, PORTONE_TIMEOUT_MS, PortOneGateway, type PaymentGateway } from '../src/billing/portone.ts'
import { DAY_MS, HOUR_MS } from '../src/billing/rules.ts'
import { RECHECK_SLOTS_MS, REFUND_HOLD_MS, idempotencyKey, slotsPassed, type BillingSetup } from '../src/billing/service.ts'
import { productionServerOptions } from '../src/production.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { BIZNO, billingWorld, buy, confirm, fake, grant, order, query, saveBusiness, type BillingWorld } from './billing-support.ts'
import { FAST_COST, addSeller, client, fakeClock, openTestDb, rid, startServer, type Seller } from './support.ts'

const T0 = Date.UTC(2026, 9, 31, 1, 0, 0)
const MIN = 60_000

const operator = (world: BillingWorld) => operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), world.clock.now())
const lookups = (world: BillingWorld, paymentId: string) => fake(world).portone.lookupCalls.get(paymentId) ?? 0
const orderState = async (world: BillingWorld, paymentId: string) => (await query<{ state: string }>(world, `select state from billing_orders where payment_id = '${paymentId}'`))[0]?.state
const grantsOf = async (world: BillingWorld, paymentId: string) => (await query<{ id: string }>(world, `select id from billing_grants where payment_id = '${paymentId}'`)).length
const docsOf = async (world: BillingWorld, paymentId: string) =>
  query<{ id: number; status: string; approval: string | null; cancel: string | null }>(world, `select id, status, approval, cancel from billing_documents where payment_id = '${paymentId}'`)
const refund = (world: BillingWorld, seller: Seller, paymentId: string, requestId = rid('rf')) => client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/refund`, { requestId })
const webhook = (world: BillingWorld, paymentId: string) => {
  const signed = signedWebhook(TEST_WEBHOOK_SECRET, paymentId, world.clock.now())
  return world.server.app.request('/api/billing/webhook', { method: 'POST', headers: signed.headers, body: signed.body })
}

/** 결제 대기 주문 하나를 T0에 만든다 (가짜 포트원에는 아직 없음) */
async function pendingWorld(options: { method?: 'CARD' | 'TRANSFER'; setup?: BillingSetup } = {}): Promise<{ world: BillingWorld; seller: Seller; paymentId: string; amount: number }> {
  const clock = fakeClock(T0)
  const world = await billingWorld({ clock, ...(options.setup === undefined ? {} : { billing: options.setup }) })
  const seller = await addSeller(world)
  await saveBusiness(world, seller)
  const created = await order(world, seller, 'flat-30', options.method ?? 'CARD')
  expect(created.status, created.text).toBe(200)
  return { world, seller, paymentId: created.body.paymentId as string, amount: created.body.amount as number }
}

const at = (world: BillingWorld, ms: number) => world.clock.set(T0 + ms)

describe('AC-PAY2-06 자동 재확인 일정', () => {
  it('칸: 1분·5분·30분·3시간·24시간 — 조회 수 0·1·2·3·4·5·5, 내내 PENDING, 운영자 목록은 24시간 칸 뒤에만, 다시 확인은 7일 뒤에도', async () => {
    expect(RECHECK_SLOTS_MS).toEqual([MIN, 5 * MIN, 30 * MIN, 3 * HOUR_MS, 24 * HOUR_MS])
    const { world, seller, paymentId } = await pendingWorld()
    const steps: [number, number][] = [
      [59_000, 0],
      [MIN, 1],
      [5 * MIN, 2],
      [30 * MIN, 3],
      [2 * HOUR_MS, 3],
      [3 * HOUR_MS, 4],
      [24 * HOUR_MS - 1, 4],
      [24 * HOUR_MS, 5],
      [7 * DAY_MS, 5],
    ]
    for (const [offset, expected] of steps) {
      at(world, offset)
      await world.server.billing.recheckDue()
      await world.server.billing.recheckDue()
      expect(lookups(world, paymentId), `T0+${String(offset)}`).toBe(expected)
      expect(await orderState(world, paymentId)).toBe('PENDING')
      const listed = (await operator(world)).stalePending.map((row) => row.paymentId)
      // 옛 "1시간 넘게" 기준이 아니다 — T0+2시간에도 없다
      expect(listed, `T0+${String(offset)}`).toEqual(offset >= 24 * HOUR_MS ? [paymentId] : [])
    }
    expect(STALE_PENDING_MS).toBe(24 * HOUR_MS)
    const again = await confirm(world, seller, paymentId)
    expect(again.status).toBe(200)
    expect(again.body.state).toBe('PENDING')
    expect(lookups(world, paymentId)).toBe(6)
  })

  it('지난 칸 수 계산', () => {
    expect(slotsPassed(0, 59_999)).toBe(0)
    expect(slotsPassed(0, MIN)).toBe(1)
    expect(slotsPassed(0, 4 * HOUR_MS)).toBe(4)
    expect(slotsPassed(0, 30 * DAY_MS)).toBe(5)
  })
})

describe('AC-PAY2-07 자동 재확인으로 부여', () => {
  it('(1) T0+3분에 카드 결제 → 5분 칸에서 부여, 그 뒤 칸은 조회 0', async () => {
    const { world, paymentId, amount } = await pendingWorld()
    at(world, MIN)
    await world.server.billing.recheckDue()
    at(world, 3 * MIN)
    fake(world).portone.pay(paymentId, amount, 'CARD')
    at(world, 5 * MIN)
    expect((await world.server.billing.recheckDue()).checked).toBe(1)
    expect(await orderState(world, paymentId)).toBe('GRANTED')
    expect(await grantsOf(world, paymentId)).toBe(1)
    expect(await docsOf(world, paymentId)).toEqual([])
    for (const offset of [30 * MIN, 3 * HOUR_MS, 24 * HOUR_MS]) {
      at(world, offset)
      await world.server.billing.recheckDue()
    }
    expect(lookups(world, paymentId)).toBe(2)
  })

  it('(2) 계좌이체면 증빙 요청 1', async () => {
    const { world, paymentId, amount } = await pendingWorld({ method: 'TRANSFER' })
    fake(world).portone.pay(paymentId, amount, 'TRANSFER')
    at(world, 5 * MIN)
    await world.server.billing.recheckDue()
    expect(await grantsOf(world, paymentId)).toBe(1)
    expect((await docsOf(world, paymentId)).length).toBe(1)
  })

  it('(3) 자동 확인·웹훅·다시 확인을 함께 보내도 이용권 1·증빙 요청 ≤1', async () => {
    const { world, seller, paymentId, amount } = await pendingWorld({ method: 'TRANSFER' })
    fake(world).portone.pay(paymentId, amount, 'TRANSFER')
    at(world, MIN)
    await Promise.all([world.server.billing.recheckDue(), webhook(world, paymentId), confirm(world, seller, paymentId), world.server.billing.recheckDue(), confirm(world, seller, paymentId)])
    expect(await grantsOf(world, paymentId)).toBe(1)
    expect((await docsOf(world, paymentId)).length).toBe(1)
    expect(fake(world).issuer.issued.length).toBe(1)
  })

  it('(4) 실패·부여됨·확인 필요·환불 중인 주문은 어떤 칸에서도 조회 0', async () => {
    const { world, seller, paymentId: failed, amount } = await pendingWorld()
    fake(world).portone.fail(failed, amount)
    expect((await confirm(world, seller, failed)).body.state).toBe('FAILED')
    const review = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.setStatus(review, 'PARTIAL_CANCELLED', 5000)
    expect((await confirm(world, seller, review)).body.state).toBe('NEEDS_REVIEW')
    const granted = await buy(world, seller, 'days-10')
    const refunding = await buy(world, seller, 'days-1')
    await query(world, `update billing_orders set refund_hold_until = '${new Date(T0 + 3 * DAY_MS).toISOString()}' where payment_id = '${refunding}'`)
    const before = new Map([failed, review, granted, refunding].map((id) => [id, lookups(world, id)]))
    for (const offset of [MIN, 5 * MIN, 30 * MIN, 3 * HOUR_MS, 24 * HOUR_MS, 2 * DAY_MS]) {
      at(world, offset)
      expect((await world.server.billing.recheckDue()).checked).toBe(0)
    }
    for (const [id, count] of before) expect(lookups(world, id)).toBe(count)
  })
})

describe('AC-PAY2-08 다시 켜기·실패한 칸·락', () => {
  it('(1) 1분 칸 뒤 멈췄다가 T0+4시간에 다시 켜면 한 번, 그다음 24시간 칸 한 번 — 모두 3번', async () => {
    const { world, paymentId } = await pendingWorld()
    at(world, MIN)
    await world.server.billing.recheckDue()
    world.server.close()
    at(world, 4 * HOUR_MS)
    const restarted = startServer(world.database, world.masterKey, { clock: world.clock, billing: world.setup, passwordCost: FAST_COST })
    await restarted.server.billingRechecker.runOnce()
    await restarted.server.billingRechecker.runOnce()
    expect(lookups(world, paymentId)).toBe(2)
    at(world, 20 * HOUR_MS)
    await restarted.server.billing.recheckDue()
    expect(lookups(world, paymentId)).toBe(2)
    at(world, 24 * HOUR_MS)
    await restarted.server.billing.recheckDue()
    at(world, 3 * DAY_MS)
    await restarted.server.billing.recheckDue()
    expect(lookups(world, paymentId)).toBe(3)
    restarted.server.close()
  })

  it('(2) 503·시간 초과도 쓴 칸 — 다음 칸에서 다시. 24시간 칸까지 실패하면 멈추고 운영자 목록에 있다', async () => {
    const { world, paymentId } = await pendingWorld({ setup: testBilling({ timeoutMs: { lookupTimeoutMs: 80 } }) })
    const portone = fake(world).portone
    at(world, MIN)
    await world.server.billing.recheckDue()
    portone.lookupFailure = true
    at(world, 5 * MIN)
    await world.server.billing.recheckDue()
    portone.lookupFailure = false
    portone.lookupDelayMs = 200
    at(world, 30 * MIN)
    await world.server.billing.recheckDue()
    portone.lookupDelayMs = 0
    expect(lookups(world, paymentId)).toBe(3)
    expect((await query<{ recheck_done: number }>(world, `select recheck_done from billing_orders where payment_id = '${paymentId}'`))[0]?.recheck_done).toBe(3)
    portone.lookupFailure = true
    for (const offset of [3 * HOUR_MS, 24 * HOUR_MS, 3 * DAY_MS]) {
      at(world, offset)
      await world.server.billing.recheckDue()
    }
    expect(lookups(world, paymentId)).toBe(5)
    expect((await operator(world)).stalePending.map((row) => row.paymentId)).toEqual([paymentId])
    expect(await orderState(world, paymentId)).toBe('PENDING')
  })

  it('(3) 자동 확인이 포트원 응답을 기다리는 동안 같은 판매자의 실제 방송 시작은 기다리지 않는다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let waiting = false
    const base = testBilling()
    const slow: PaymentGateway = {
      lookup: async (id) => {
        waiting = true
        await gate
        return base.gateway.lookup(id)
      },
      cancel: (id, reason, key) => base.gateway.cancel(id, reason, key),
    }
    const { world, seller } = await pendingWorld({ setup: { ...base, gateway: slow } })
    await grant(world, seller, 'FLAT_30D')
    at(world, MIN)
    const running = world.server.billing.recheckDue()
    while (!waiting) await new Promise((resolve) => setTimeout(resolve, 5))
    const started = Date.now()
    const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-31' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(response.status, response.text).toBe(200)
    release()
    await running
  })
})

describe('AC-PAY2-09 시간 한도·멱등 키', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const adapter = (portone: FakePortOne) =>
    new PortOneGateway({ storeId: TEST_STORE_ID, apiSecret: TEST_API_SECRET, baseUrl: FAKE_PORTONE_BASE, fetch: (input, init) => Promise.resolve(portone.app.request(input, init)) })

  it('(1)(2) 결제 취소는 60초 — 55초면 성공, 65초면 시간 초과. 결제 조회는 10초 — 11초면 실패', async () => {
    expect(PORTONE_MUTATE_TIMEOUT_MS).toBe(60_000)
    expect(PORTONE_TIMEOUT_MS).toBe(10_000)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const portone = new FakePortOne()
    const gateway = adapter(portone)
    portone.pay('lj0000000000000000000001', 5000, 'CARD')
    portone.cancelDelayMs = 55_000
    const ok = gateway.cancel('lj0000000000000000000001', '7일 환불', 'ljr-a')
    await vi.advanceTimersByTimeAsync(55_000)
    expect(await ok).toEqual({ kind: 'ok' })
    portone.pay('lj0000000000000000000002', 5000, 'CARD')
    portone.cancelDelayMs = 65_000
    const late = gateway.cancel('lj0000000000000000000002', '7일 환불', 'ljr-b')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await late).toEqual({ kind: 'error' })
    await vi.advanceTimersByTimeAsync(5_000)
    // 가짜 포트원은 취소를 반영했다 — 그 뒤 결제 조회로 맞춘다
    expect(portone.status('lj0000000000000000000002')).toBe('CANCELLED')
    portone.lookupDelayMs = 11_000
    const slow = gateway.lookup('lj0000000000000000000001')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await slow).toEqual({ kind: 'error' })
    await vi.advanceTimersByTimeAsync(1_000)
    portone.lookupDelayMs = 9_000
    const inTime = gateway.lookup('lj0000000000000000000001')
    await vi.advanceTimersByTimeAsync(9_000)
    expect((await inTime).kind).toBe('found')
  })

  it('(1) 서버: 늦은 취소 성공은 환불 완료, 한도를 넘긴 취소는 결제 조회로 맞춘다(취소 반영됨 → 환불함) — 줄인 한도', async () => {
    const world = await billingWorld({ clock: fakeClock(T0) }, { timeoutMs: { lookupTimeoutMs: 300, mutateTimeoutMs: 600 } })
    const seller = await addSeller(world)
    const first = await buy(world, seller, 'days-1')
    fake(world).portone.cancelDelayMs = 550
    const done = await refund(world, seller, first)
    expect(done.body).toEqual({ paymentId: first, state: 'REFUNDED', message: '환불했어요. 결제 수단으로 돌려드려요.' })
    const second = await buy(world, seller, 'days-10')
    fake(world).portone.cancelDelayMs = 700
    const late = await refund(world, seller, second)
    expect(late.body).toMatchObject({ state: 'REFUNDED' })
    expect(await orderState(world, second)).toBe('REFUNDED')
  })

  it('(3) 결제 취소마다 Idempotency-Key — 같은 환불 요청은 같은 키, 다른 요청은 다른 키, 금액 불일치는 결제마다 하나. 비밀값·사업자등록번호 없음', async () => {
    const world = await billingWorld({ clock: fakeClock(T0) })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    const portone = fake(world).portone
    portone.cancelFailure = true
    const requestId = rid('rf')
    expect((await refund(world, seller, paymentId, requestId)).body).toMatchObject({ error: { code: 'REFUND_FAILED' } })
    expect((await refund(world, seller, paymentId, requestId)).body).toMatchObject({ error: { code: 'REFUND_FAILED' } })
    expect((await refund(world, seller, paymentId)).body).toMatchObject({ error: { code: 'REFUND_FAILED' } })
    const keys = portone.requests.filter((r) => r.path.endsWith('/cancel')).map((r) => r.idempotencyKey)
    expect(keys).toHaveLength(3)
    expect(keys[0]).toBe(idempotencyKey('refund', seller.sellerId, requestId))
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    portone.cancelFailure = false
    const mismatch = (await order(world, seller, 'days-10')).body
    portone.pay(mismatch.paymentId as string, (mismatch.amount as number) - 1000, 'CARD')
    await Promise.all([confirm(world, seller, mismatch.paymentId as string), confirm(world, seller, mismatch.paymentId as string)])
    const mismatchKeys = portone.requests.filter((r) => r.path === `/payments/${mismatch.paymentId as string}/cancel`).map((r) => r.idempotencyKey)
    expect(mismatchKeys).toEqual([idempotencyKey('mismatch', seller.sellerId, mismatch.paymentId as string)])
    for (const key of [...keys, ...mismatchKeys]) {
      expect(key).toMatch(/^[A-Za-z0-9-]{1,64}$/)
      expect(key).not.toMatch(/1234567891|67891|test-portone-api-secret/)
    }
  })

  it('(4) 환불을 맡은 기한은 2분 — 55초 걸린 취소 중의 다른 환불은 "처리하는 중", 늦게 온 성공은 환불 완료', async () => {
    expect(REFUND_HOLD_MS).toBe(120_000)
    let release: () => void = () => {}
    let waiting = false
    const base = testBilling()
    const slow: PaymentGateway = {
      lookup: (id) => base.gateway.lookup(id),
      cancel: async (id, reason, key) => {
        waiting = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return base.gateway.cancel(id, reason, key)
      },
    }
    const world = await billingWorld({ clock: fakeClock(T0), billing: { ...base, gateway: slow } })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    const first = refund(world, seller, paymentId)
    while (!waiting) await new Promise((resolve) => setTimeout(resolve, 5))
    world.clock.advance(55_000)
    const other = await refund(world, seller, paymentId)
    expect(other.body).toMatchObject({ error: { code: 'REFUND_IN_PROGRESS' } })
    // 결제 내역을 열어도 환불 중을 풀지 않는다 (기한 안)
    await client(world, seller.cookie).get('/api/billing/payments')
    release()
    expect((await first).body).toMatchObject({ state: 'REFUNDED' })
    expect(await orderState(world, paymentId)).toBe('REFUNDED')
  })
})

const PRICES_33: PriceTable = { placeholder: false, items: [{ id: 'flat-33', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 33_000, onSale: true }] }

/** 포트원 현금영수증 발행기로 계좌이체 33,000원 결제 G (prepare = 부여 전에 가짜 포트원을 만진다) */
async function receiptWorld(options: { method?: 'CARD' | 'TRANSFER'; prepare?: (portone: FakePortOne, paymentId: string) => void; timeouts?: { lookupTimeoutMs?: number; mutateTimeoutMs?: number } } = {}) {
  const world = await billingWorld({ clock: fakeClock(T0) }, { prices: PRICES_33, issuer: 'portone', ...(options.timeouts === undefined ? {} : { timeoutMs: options.timeouts }) })
  const seller = await addSeller(world)
  expect((await saveBusiness(world, seller)).status).toBe(200)
  const method = options.method ?? 'TRANSFER'
  const created = await order(world, seller, 'flat-33', method)
  const paymentId = created.body.paymentId as string
  const portone = fake(world).portone
  portone.pay(paymentId, 33_000, method)
  options.prepare?.(portone, paymentId)
  const confirmed = await confirm(world, seller, paymentId)
  expect(confirmed.body.result).toBe('GRANT')
  return { world, seller, paymentId, portone }
}

describe('AC-PAY2-10 포트원 현금영수증 발급', () => {
  it('(a) 조회 결과 없음 → 먼저 조회한 뒤 지출증빙 발급 1 → 발행됨 + 승인 번호', async () => {
    const { world, seller, paymentId, portone } = await receiptWorld()
    const issueAt = portone.requests.findIndex((r) => r.path === '/cash-receipts')
    const lookupAt = portone.requests.findIndex((r) => r.path === `/payments/${paymentId}/cash-receipt`)
    expect(lookupAt).toBeGreaterThanOrEqual(0)
    expect(lookupAt).toBeLessThan(issueAt)
    expect(portone.cashReceiptIssues).toHaveLength(1)
    const [docs] = [await docsOf(world, paymentId)]
    expect(portone.cashReceiptIssues[0]?.body).toEqual({
      storeId: TEST_STORE_ID,
      paymentId,
      channelKey: TEST_CHANNEL_KEY,
      type: 'CORPORATE',
      orderName: '정액제 30일',
      currency: 'KRW',
      amount: { total: 33_000 },
      customer: { identityNumber: '1234567891' },
    })
    expect(portone.cashReceiptIssues[0]?.idempotencyKey).toBe(idempotencyKey('receipt-issue', seller.sellerId, paymentId, String(docs[0]?.id)))
    expect(docs).toMatchObject([{ status: 'ISSUED', approval: 'FAKE00000001', cancel: null }])
    expect(await orderState(world, paymentId)).toBe('GRANTED')
    expect(await grantsOf(world, paymentId)).toBe(1)
    expect(JSON.stringify(world.logs)).not.toMatch(/1234567891|123-45-67891/)
  })

  it('(b) 지출증빙으로 이미 발급됨(PG 자동) → 발급 0, 그 승인 번호로 발행됨', async () => {
    const { world, paymentId, portone } = await receiptWorld({ prepare: (p, id) => p.setCashReceipt(id, { status: 'ISSUED', type: 'CORPORATE', issueNumber: 'PG-AUTO-77' }) })
    expect(portone.cashReceiptIssues).toHaveLength(0)
    expect(await docsOf(world, paymentId)).toMatchObject([{ status: 'ISSUED', approval: 'PG-AUTO-77' }])
  })

  it.each([
    ['소득공제로 발급됨', { status: 'ISSUED', type: 'PERSONAL', issueNumber: 'PG-P-1' }],
    ['취소됨', { status: 'CANCELLED', type: 'CORPORATE', issueNumber: 'PG-C-1' }],
    ['발급 실패', { status: 'ISSUE_FAILED' }],
    ['모르는 상태', { status: 'SOMETHING_NEW', type: 'CORPORATE', issueNumber: 'X1' }],
    ['빈 본문', { raw: undefined }],
    ['모르는 종류', { raw: { status: 'ISSUED', storeId: TEST_STORE_ID, paymentId: 'SAME', type: 'MYSTERY', issueNumber: 'X2' } }],
    ['다른 상점', { raw: { status: 'ISSUED', storeId: 'store-other', paymentId: 'SAME', type: 'CORPORATE', issueNumber: 'X3' } }],
    ['다른 결제', { raw: { status: 'ISSUED', storeId: TEST_STORE_ID, paymentId: 'lj9999999999999999999999', type: 'CORPORATE', issueNumber: 'X4' } }],
  ] as const)('(c) %s → 발급 0, 발행 실패', async (_name, receipt) => {
    const { world, paymentId, portone } = await receiptWorld({
      prepare: (p, id) => p.setCashReceipt(id, 'raw' in receipt && receipt.raw !== undefined ? { raw: { ...receipt.raw, paymentId: receipt.raw.paymentId === 'SAME' ? id : receipt.raw.paymentId } } : (receipt as never)),
    })
    expect(portone.cashReceiptIssues).toHaveLength(0)
    expect(await docsOf(world, paymentId)).toMatchObject([{ status: 'FAILED' }])
    expect(await orderState(world, paymentId)).toBe('GRANTED')
    expect(await grantsOf(world, paymentId)).toBe(1)
    expect((await operator(world)).documents.map((doc) => doc.document.paymentId)).toEqual([paymentId])
  })

  it('(d) 조회 503·시간 초과 → 발급 0. 발급 503·시간 초과 → 발급 1. 모두 발행 실패, 주문·이용권 그대로', async () => {
    const cases: [string, (p: FakePortOne) => void, number][] = [
      ['조회 503', (p) => (p.cashReceiptLookupFailure = true), 0],
      ['조회 시간 초과', (p) => (p.cashReceiptLookupDelayMs = 300), 0],
      ['발급 503', (p) => (p.cashReceiptIssueFailure = true), 1],
      ['발급 시간 초과', (p) => (p.cashReceiptIssueDelayMs = 700), 1],
    ]
    for (const [name, prepare, issues] of cases) {
      const { world, paymentId, portone } = await receiptWorld({ prepare: (p) => prepare(p), timeouts: { lookupTimeoutMs: 150, mutateTimeoutMs: 400 } })
      expect(portone.cashReceiptIssues.length, name).toBe(issues)
      expect(await docsOf(world, paymentId), name).toMatchObject([{ status: 'FAILED' }])
      expect(await orderState(world, paymentId)).toBe('GRANTED')
      expect(await grantsOf(world, paymentId)).toBe(1)
    }
  })

  it('(f) 카드 결제는 조회·발급 0', async () => {
    const { world, paymentId, portone } = await receiptWorld({ method: 'CARD' })
    expect(portone.cashReceiptLookups.get(paymentId) ?? 0).toBe(0)
    expect(portone.cashReceiptIssues).toHaveLength(0)
    expect(await docsOf(world, paymentId)).toEqual([])
  })

  it('조회 본문 판단 (순수)', () => {
    const body = (extra: Record<string, unknown>) => ({ status: 'ISSUED', storeId: 's', paymentId: 'p', type: 'CORPORATE', issueNumber: 'N1', ...extra })
    expect(readCashReceipt(body({}), 's', 'p')).toEqual({ kind: 'proof', issueNumber: 'N1' })
    expect(readCashReceipt(body({ type: 'PERSONAL' }), 's', 'p')).toEqual({ kind: 'issued_other' })
    expect(readCashReceipt(body({ status: 'CANCELLED' }), 's', 'p')).toEqual({ kind: 'cancelled' })
    expect(readCashReceipt(body({ storeId: undefined }), 's', 'p')).toEqual({ kind: 'unknown' })
    expect(readCashReceipt(body({ issueNumber: 7 }), 's', 'p')).toEqual({ kind: 'unknown' })
    expect(readCashReceipt(null, 's', 'p')).toEqual({ kind: 'unknown' })
  })
})

describe('AC-PAY2-11 포트원 현금영수증 취소·고르기·로그', () => {
  it('(1) PG가 결제 취소와 함께 취소 → 취소 요청 0, 취소됨', async () => {
    const { world, seller, paymentId, portone } = await receiptWorld()
    portone.cancelCashReceiptWithPayment = true
    expect((await refund(world, seller, paymentId)).body).toMatchObject({ state: 'REFUNDED' })
    expect(portone.cashReceiptCancels).toHaveLength(0)
    expect(await docsOf(world, paymentId)).toMatchObject([{ cancel: 'CANCELLED' }])
  })

  it('(1) 발급된 그대로 → 취소 요청 1(키 = 그 취소 요청) → 취소됨', async () => {
    const { world, seller, paymentId, portone } = await receiptWorld()
    expect((await refund(world, seller, paymentId)).body).toMatchObject({ state: 'REFUNDED' })
    const docs = await docsOf(world, paymentId)
    expect(portone.cashReceiptCancels).toEqual([{ paymentId, idempotencyKey: idempotencyKey('receipt-cancel', seller.sellerId, paymentId, String(docs[0]?.id)) }])
    expect(docs).toMatchObject([{ cancel: 'CANCELLED' }])
  })

  it('(1) 취소 실패·조회 실패 → 취소 요청(운영자 목록). 환불은 된다', async () => {
    for (const prepare of [(p: FakePortOne) => (p.cashReceiptCancelFailure = true), (p: FakePortOne) => (p.cashReceiptLookupFailure = true)]) {
      const { world, seller, paymentId, portone } = await receiptWorld()
      prepare(portone)
      expect((await refund(world, seller, paymentId)).body).toMatchObject({ state: 'REFUNDED' })
      expect(await orderState(world, paymentId)).toBe('REFUNDED')
      expect(await docsOf(world, paymentId)).toMatchObject([{ status: 'ISSUED', cancel: 'REQUESTED' }])
      expect((await operator(world)).documents.map((doc) => doc.document.paymentId)).toEqual([paymentId])
    }
  })

  it('(2) 고르기: 비었거나 none = 없음, portone = 포트원 현금영수증, 모르는 값이면 기동하지 않는다. 시험 기본은 가짜', async () => {
    const portone = { PORTONE_STORE_ID: 'store-live', PORTONE_CHANNEL_KEY: 'channel-live', PORTONE_API_SECRET: 'api-secret-live-77', PORTONE_WEBHOOK_SECRET: `whsec_${Buffer.from('hook').toString('base64')}` }
    expect(readReceiptIssuerEnv({})).toEqual({ ok: true, issuer: 'none' })
    expect(readReceiptIssuerEnv({ LIVEJJIM_RECEIPT_ISSUER: 'none' })).toEqual({ ok: true, issuer: 'none' })
    expect(readReceiptIssuerEnv({ LIVEJJIM_RECEIPT_ISSUER: 'popbill' })).toEqual({ ok: false, message: RECEIPT_ISSUER_REFUSAL })
    expect(readReceiptIssuerEnv({ LIVEJJIM_RECEIPT_ISSUER: 'portone' })).toEqual({ ok: false, message: RECEIPT_ISSUER_PORTONE_REFUSAL })
    const database = await openTestDb()
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'https://app.livejjim.test', ...portone }
    const none = productionServerOptions(env, database)
    expect(none.ok && none.options.billing?.issuer).toBe(noneIssuer)
    const chosen = productionServerOptions({ ...env, LIVEJJIM_RECEIPT_ISSUER: 'portone' }, database)
    expect(chosen.ok && chosen.options.billing?.issuer).toBeInstanceOf(PortOneCashReceiptIssuer)
    expect(productionServerOptions({ ...env, LIVEJJIM_RECEIPT_ISSUER: 'something' }, database)).toEqual({ ok: false, message: RECEIPT_ISSUER_REFUSAL })
    expect(RECEIPT_ISSUER_REFUSAL).not.toMatch(/something/)
    expect(testBilling().issuer).toBeInstanceOf(FakeIssuer)
  })

  it('(3) 로그·오류에 사업자등록번호가 없다 (발급 실패·취소 실패를 거쳐도)', async () => {
    const { world, seller, paymentId, portone } = await receiptWorld({ prepare: (p) => (p.cashReceiptIssueFailure = true) })
    portone.cashReceiptCancelFailure = true
    await refund(world, seller, paymentId)
    expect(JSON.stringify(world.logs)).not.toMatch(/1234567891|123-45-67891/)
    expect(BIZNO).toBe('123-45-67891')
  })
})

describe('AC-PAY2-12 공개 요금 안내', () => {
  const table: PriceTable = {
    placeholder: false,
    items: [
      { id: 'item-a', name: '항목 A', kind: 'FLAT_30D', quantity: null, price: 29_000, onSale: true },
      { id: 'item-b', name: '항목 B', kind: 'DAYS', quantity: 1, price: 4_900, onSale: false },
      { id: 'item-c', name: '항목 C', kind: 'LABELS', quantity: 100, price: 1_900, onSale: true },
    ],
  }
  const pricing = async (world: BillingWorld, cookie: string | null, path = '/api/pricing') => {
    const response = await world.server.app.request(path, { headers: cookie === null ? {} : { Cookie: cookie } })
    return { status: response.status, text: await response.text(), cookie: response.headers.get('set-cookie') }
  }

  it('(1)(4) 확정 요금 표 → ready, 판매 중만 요금 표 순서로. 세션·다른 판매자·검색값과 상관없이 바이트까지 같다', async () => {
    const world = await billingWorld({}, { prices: table })
    const a = await addSeller(world)
    const b = await addSeller(world)
    await saveBusiness(world, a)
    await grant(world, a, 'DAYS', 3)
    const anonymous = await pricing(world, null)
    expect(anonymous.status).toBe(200)
    expect(JSON.parse(anonymous.text)).toEqual({
      ready: true,
      items: [
        { id: 'item-a', name: '항목 A', kind: 'FLAT_30D', quantity: null, price: 29_000 },
        { id: 'item-c', name: '항목 C', kind: 'LABELS', quantity: 100, price: 1_900 },
      ],
    })
    for (const other of [await pricing(world, a.cookie), await pricing(world, b.cookie), await pricing(world, a.cookie, '/api/pricing?ready=false&seller=x'), await pricing(world, 'livejjim_session=bogus')]) {
      expect(other.text).toBe(anonymous.text)
      expect(other.cookie).toBeNull()
    }
    expect(anonymous.text).not.toMatch(new RegExp([TEST_STORE_ID, TEST_CHANNEL_KEY, a.sellerId, b.sellerId, '67891', '항목 B', 'test-portone'].join('|')))
  })

  it('(2) 자리 표시 요금 표 → ready false, 가격 숫자 없음', async () => {
    const world = await billingWorld()
    const response = await pricing(world, null)
    expect(JSON.parse(response.text)).toEqual({ ready: false, items: [] })
    expect(response.text).not.toMatch(/30000|5000|40000|10000|2000|8000/)
  })

  it('(3) 요금 기능 꺼짐 → ready false (경로는 있다)', async () => {
    const world = await billingWorld({}, { enabled: false, prices: table })
    expect(JSON.parse((await pricing(world, null)).text)).toEqual({ ready: false, items: [] })
    const plain = startServer(await openTestDb(), generateMasterKey(), { passwordCost: FAST_COST })
    const response = await plain.server.app.request('/api/pricing')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ready: false, items: [] })
    plain.server.close()
  })

  it('시험용 확정 요금 표(E2E)는 자리 표시가 아니고 판매 중이 아닌 항목이 있다', () => {
    expect(TEST_FINAL_PRICE_TABLE.placeholder).toBe(false)
    expect(TEST_FINAL_PRICE_TABLE.items.some((item) => !item.onSale)).toBe(true)
  })
})

describe('AC-PAY2-15 시험 경로: 자동 재확인 한 번', () => {
  it('결제 창을 닫아 확인이 가지 않은 결제 → 시험 경로 laterMs 1분 → 결제 완료. 다른 판매자는 건드리지 않는다', async () => {
    const { world, seller, paymentId, amount } = await pendingWorld()
    const other = await addSeller(world)
    await saveBusiness(world, other)
    const theirs = (await order(world, other, 'days-1')).body.paymentId as string
    fake(world).portone.pay(paymentId, amount, 'CARD')
    const ran = await client(world, seller.cookie).post('/api/billing/test/recheck', { requestId: rid('rc'), laterMs: MIN })
    expect(ran.body).toEqual({ checked: 1 })
    expect(await orderState(world, paymentId)).toBe('GRANTED')
    expect(lookups(world, theirs)).toBe(0)
    expect((await client(world, seller.cookie).post('/api/billing/test/recheck', { requestId: rid('rc'), laterMs: -1 })).status).toBe(400)
  })
})

// 가짜 포트원 현금영수증 발행기를 직접 (시간 한도 60초 — 가짜 타이머)
describe('현금영수증 발급 시간 한도 60초', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it('발급 55초는 발행됨, 65초는 발행 실패', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const portone = new FakePortOne()
    const issuer = portone.cashReceiptIssuer()
    const request = (paymentId: string) => ({
      paymentId,
      kind: 'CASH_RECEIPT' as const,
      amount: 33_000,
      supply: 30_000,
      vat: 3_000,
      recipient: { businessNumber: BIZNO, name: '가게', ceo: '대표', email: null },
      orderName: '정액제 30일',
      idempotencyKey: `ljc-${paymentId.slice(-4)}`,
    })
    portone.cashReceiptIssueDelayMs = 55_000
    const ok = issuer.issue(request('lj0000000000000000000011'))
    await vi.advanceTimersByTimeAsync(55_000)
    expect(await ok).toEqual({ status: 'ISSUED', approval: 'FAKE00000001' })
    portone.cashReceiptIssueDelayMs = 65_000
    const late = issuer.issue(request('lj0000000000000000000012'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await late).toEqual({ status: 'FAILED' })
    await vi.advanceTimersByTimeAsync(5_000)
  })
})
