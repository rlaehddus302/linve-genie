// RA-N5-01: 7일 환불의 결제 취소가 실제로 된 뒤 원장에 남지 않는 경우와 밖에서 취소된 결제.
// - 환불 중 표시는 결제 취소를 요청하기 전에 기록하고, 시간이 지나도 저절로 풀리지 않는다(그동안 그 이용권으로 방송을 시작하지 않는다).
// - 취소 응답이 끊기거나(시간 초과·502) 마무리 기록 전에 멈추면 결제 조회로 맞춘다: 취소됐으면 환불함, 결제가 그대로면 환불 중만 푼다(BL-7 2 "아무것도 바꾸지 않고").
// - 맞추는 곳: 그 환불 요청 자신, 결제 내역 열기(맡은 기한이 지난 것), 웹훅·다시 확인, 다시 환불. 운영자 목록에 결과를 모르는 환불이 보인다.
// - 우리 환불이 아닌데 결제가 취소됐으면 확인 필요(운영자 목록) — 이용권은 막지 않는다(판매자 방송을 갑자기 막지 않는다).
import { describe, expect, it } from 'vitest'
import { signedWebhook, testBilling, TEST_WEBHOOK_SECRET } from '../src/billing/fake.ts'
import { formatOperatorLists, operatorLists } from '../src/billing/operator.ts'
import type { LookupResult, PaymentGateway } from '../src/billing/portone.ts'
import { judgeGranted, type LookedUpPayment } from '../src/billing/rules.ts'
import { REFUND_HOLD_MS, type BillingSetup } from '../src/billing/service.ts'
import { billingWorld, buy, confirm, fake, query, status, type BillingWorld } from './billing-support.ts'
import { addSeller, client, rid, waitFor, type Seller } from './support.ts'

const MESSAGES = {
  refunded: '환불했어요. 결제 수단으로 돌려드려요.',
  refundRefused: '이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요.',
  refundFailed: '환불하지 못했어요. 잠시 뒤 다시 해 주세요.',
  refundBusy: '환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요.',
  noPass: '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.',
}

const refund = (world: BillingWorld, seller: Seller, paymentId: string, requestId = rid('rf')) => client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/refund`, { requestId })
const payments = async (world: BillingWorld, seller: Seller) => (await client(world, seller.cookie).get('/api/billing/payments')).body.items as Record<string, unknown>[]
const start = (world: BillingWorld, seller: Seller) => client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })
const webhook = (world: BillingWorld, paymentId: string, type = 'Transaction.Cancelled') => {
  const signed = signedWebhook(TEST_WEBHOOK_SECRET, paymentId, world.clock.now(), type)
  return world.server.app.request('/api/billing/webhook', { method: 'POST', headers: signed.headers, body: signed.body })
}
const orderRow = async (world: BillingWorld, paymentId: string) =>
  (await query<{ state: string; refund_hold_until: Date | null }>(world, `select state, refund_hold_until from billing_orders where payment_id = '${paymentId}'`))[0]
const revocations = async (world: BillingWorld) => (await query<{ grant_id: string }>(world, 'select grant_id from billing_revocations')).length
const operator = (world: BillingWorld) => operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), world.clock.now())

/** 시험 결제 설정에서 결제 어댑터만 바꾼다 (가짜 결제 서버는 그대로) */
function withGateway(make: (inner: PaymentGateway, base: BillingSetup) => PaymentGateway, options: { timeoutMs?: number } = {}): BillingSetup {
  const base = testBilling(options)
  return { ...base, gateway: make(base.gateway, base) }
}

describe('RA-N5-01 judgeGranted (부여된 결제 다시 맞추기 판단)', () => {
  const STORE = 'store-a'
  const paid = (status: string, storeId = STORE): LookedUpPayment => ({ status, amount: 5000, currency: 'KRW', storeId, method: 'CARD' })
  const cases: [string, Parameters<typeof judgeGranted>[0], ReturnType<typeof judgeGranted>][] = [
    ['환불 중 + 취소됨 → 마무리', { refunding: true, settled: false, payment: paid('CANCELLED'), storeId: STORE }, 'REFUND'],
    ['환불 중 + 취소됨(맡은 요청이 끝남) → 마무리', { refunding: true, settled: true, payment: paid('CANCELLED'), storeId: STORE }, 'REFUND'],
    ['환불 중 + 결제 그대로 + 맡은 요청이 끝남 → 풀기', { refunding: true, settled: true, payment: paid('PAID'), storeId: STORE }, 'RELEASE'],
    ['환불 중 + 결제 그대로 + 맡은 요청이 아직 기다림 → 그대로', { refunding: true, settled: false, payment: paid('PAID'), storeId: STORE }, 'KEEP'],
    ['환불 중 + 결제 없음 → 그대로', { refunding: true, settled: true, payment: null, storeId: STORE }, 'KEEP'],
    ['환불 중 + 다른 상점 → 그대로', { refunding: true, settled: true, payment: paid('CANCELLED', 'store-b'), storeId: STORE }, 'KEEP'],
    ['환불 중 + 부분 취소 → 확인 필요', { refunding: true, settled: true, payment: paid('PARTIAL_CANCELLED'), storeId: STORE }, 'REVIEW'],
    ['환불 아님 + 취소됨(밖에서 취소) → 확인 필요', { refunding: false, settled: false, payment: paid('CANCELLED'), storeId: STORE }, 'REVIEW'],
    ['환불 아님 + 부분 취소 → 확인 필요', { refunding: false, settled: false, payment: paid('PARTIAL_CANCELLED'), storeId: STORE }, 'REVIEW'],
    ['환불 아님 + 모르는 상태 → 확인 필요', { refunding: false, settled: false, payment: paid('SOMETHING_NEW'), storeId: STORE }, 'REVIEW'],
    ['환불 아님 + 결제 그대로 → 없음', { refunding: false, settled: false, payment: paid('PAID'), storeId: STORE }, 'NONE'],
    ['환불 아님 + 결제 없음 → 없음', { refunding: false, settled: false, payment: null, storeId: STORE }, 'NONE'],
    ['환불 아님 + 다른 상점 → 없음', { refunding: false, settled: false, payment: paid('CANCELLED', 'store-b'), storeId: STORE }, 'NONE'],
  ]
  it.each(cases)('%s', (_name, input, expected) => {
    expect(judgeGranted(input)).toBe(expected)
  })
})

describe('RA-N5-01 취소는 됐는데 응답이 끊긴 환불', () => {
  it('재현: 취소 반영 뒤 응답이 시간 제한보다 늦으면 → 결제 조회로 취소됨을 확인해 환불함(502가 아니다). 그 이용권으로 방송을 시작하지 않는다', async () => {
    const world = await billingWorld({}, { timeoutMs: 100 })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.cancelDelayMs = 400
    const done = await refund(world, seller, paymentId)
    expect(done.status, done.text).toBe(200)
    expect(done.body).toEqual({ paymentId, state: 'REFUNDED', message: MESSAGES.refunded })
    expect(fake(world).portone.status(paymentId)).toBe('CANCELLED')
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'REFUNDED', refund_hold_until: null })
    expect(await revocations(world)).toBe(1)
    // 방송 일이 빠지지 않는다 — 이용권이 없으니 시작하지 않는다
    const started = await start(world, seller)
    expect(started.status).toBe(422)
    expect(started.body).toEqual({ error: { code: 'NO_PASS', message: MESSAGES.noPass } })
    expect(await query(world, 'select key from billing_usage')).toEqual([])
    // 다시 환불하면 이미 환불한 것
    expect((await refund(world, seller, paymentId)).body).toEqual({ error: { code: 'REFUND_NOT_ALLOWED', message: MESSAGES.refundRefused } })
  })

  it('취소 반영 뒤 502(응답 끊김) → 환불함, 취소는 한 번', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'flat-30', 'TRANSFER')
    fake(world).portone.cancelLost = true
    const requestId = rid('rf')
    const done = await refund(world, seller, paymentId, requestId)
    expect(done.status, done.text).toBe(200)
    expect(done.body).toEqual({ paymentId, state: 'REFUNDED', message: MESSAGES.refunded })
    expect((await refund(world, seller, paymentId, requestId)).body).toEqual(done.body)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect((await status(world, seller)).flat).toMatchObject({ active: false, chain: [] })
    // 증빙도 취소 요청 → 가짜 발행기 취소됨
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'REFUNDED', refunding: false, document: { cancel: 'CANCELLED' } })
  })

  it('취소가 정말 안 됐으면(결제 그대로) 아무것도 바꾸지 않는다 — 환불 중도 풀린다', async () => {
    const world = await billingWorld({}, { timeoutMs: 100 })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.cancelFailure = true
    const failed = await refund(world, seller, paymentId)
    expect(failed.status).toBe(502)
    expect(failed.body).toEqual({ error: { code: 'REFUND_FAILED', message: MESSAGES.refundFailed } })
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'GRANTED', refund_hold_until: null })
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refundable: true, refunding: false })
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
  })

  it('취소 응답도 결제 조회도 안 되면 환불 중 그대로("처리하는 중") — 시간이 지나도 저절로 풀리지 않고, 조회가 되면 결제 내역을 열 때 환불함으로 맞춘다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.cancelLost = true
    fake(world).portone.lookupFailure = true
    const unknown = await refund(world, seller, paymentId)
    expect(unknown.status).toBe(409)
    expect(unknown.body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: MESSAGES.refundBusy } })
    expect(fake(world).portone.status(paymentId)).toBe('CANCELLED')
    // 환불 중: 이용권을 쓰지 않는다 (몇 시간이 지나도)
    world.clock.advance(3 * 60 * 60 * 1000)
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refundable: false, refunding: true })
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
    expect((await start(world, seller)).status).toBe(422)
    expect(await query(world, 'select key from billing_usage')).toEqual([])
    // 다시 환불을 눌러도 취소를 다시 요청하지 않는다 (조회가 안 되면 그대로)
    expect((await refund(world, seller, paymentId)).body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: MESSAGES.refundBusy } })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    // 운영자 목록에 보인다
    const lists = await operator(world)
    expect(lists.stuckRefunds.map((row) => row.paymentId)).toEqual([paymentId])
    expect(formatOperatorLists(lists).join('\n')).toContain('결과를 모르는 환불 1건')
    // 조회가 돌아오면 결제 내역을 열 때 맞춘다 → 환불함
    fake(world).portone.lookupFailure = false
    const list = await payments(world, seller)
    expect(list[0]).toMatchObject({ state: 'REFUNDED', refunding: false, refundable: false })
    expect(await revocations(world)).toBe(1)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect((await operator(world)).stuckRefunds).toEqual([])
  })
})

describe('RA-N5-01 마무리 기록 전에 멈춘 환불 (서버 재시작·DB 오류)', () => {
  /** 취소 요청을 포트원에 보낸 뒤 응답을 끝내 받지 못하는 어댑터 (요청 처리 중에 서버가 멈춘 것과 같다) */
  const stalled = () => {
    const sent: string[] = []
    const setup = withGateway((inner) => ({
      lookup: (id) => inner.lookup(id),
      cancel: (id, reason) => {
        sent.push(id)
        void inner.cancel(id, reason)
        return new Promise(() => undefined)
      },
    }))
    return { setup, sent }
  }

  it('포트원은 취소했는데 기록 전에 멈춤 → 그동안 그 이용권으로 시작하지 않고, 웹훅(취소 알림)이 오면 환불함으로 마무리', async () => {
    const { setup } = stalled()
    const world = await billingWorld({ billing: setup })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    void refund(world, seller, paymentId)
    await waitFor(() => fake(world).portone.status(paymentId) === 'CANCELLED')
    // 맡은 기한 안: 다른 환불은 '처리하는 중', 시작은 거절
    expect((await refund(world, seller, paymentId)).body).toMatchObject({ error: { code: 'REFUND_IN_PROGRESS' } })
    expect((await start(world, seller)).status).toBe(422)
    // 기한이 지나도 저절로 풀리지 않는다
    world.clock.advance(REFUND_HOLD_MS * 10)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
    expect((await start(world, seller)).status).toBe(422)
    // 포트원의 취소 웹훅 → 결제 조회 → 환불함
    const hook = await webhook(world, paymentId)
    expect(hook.status).toBe(200)
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'REFUNDED', refund_hold_until: null })
    expect(await revocations(world)).toBe(1)
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'REFUNDED', refunding: false })
  })

  it('웹훅이 없어도 기한이 지난 뒤 결제 내역을 열면 맞춘다 / 다시 환불을 눌러도 맞춘다', async () => {
    const { setup } = stalled()
    const world = await billingWorld({ billing: setup })
    const seller = await addSeller(world)
    const a = await buy(world, seller, 'days-1')
    const b = await buy(world, seller, 'orders-100')
    void refund(world, seller, a)
    void refund(world, seller, b)
    await waitFor(() => fake(world).portone.status(a) === 'CANCELLED' && fake(world).portone.status(b) === 'CANCELLED')
    // 기한 안에는 결제 내역이 맞추지 않는다 (맡은 요청이 아직 기다릴 수 있다)
    expect((await payments(world, seller)).map((item) => item.refunding)).toEqual([true, true])
    world.clock.advance(REFUND_HOLD_MS + 1)
    // 다시 환불 → 이 요청이 맡아 결제 조회 → 이미 취소됨 → 환불함 (취소를 다시 요청하지 않는다)
    const again = await refund(world, seller, b)
    expect(again.status, again.text).toBe(200)
    expect(again.body).toEqual({ paymentId: b, state: 'REFUNDED', message: MESSAGES.refunded })
    expect(fake(world).portone.cancelCalls.get(b)).toBe(1)
    // 결제 내역을 열면 나머지도 맞춘다
    const list = await payments(world, seller)
    expect(list.map((item) => [item.paymentId, item.state, item.refunding]).sort()).toEqual(
      [
        [a, 'REFUNDED', false],
        [b, 'REFUNDED', false],
      ].sort(),
    )
    expect(await revocations(world)).toBe(2)
  })

  it('취소 요청이 포트원에 닿지 않고 멈춤(결제 그대로) → 기한 뒤 맞추면 환불 중만 풀리고, 다시 환불하면 새로 취소한다', async () => {
    const sent: string[] = []
    let hang = true
    const setup = withGateway((inner) => ({
      lookup: (id) => inner.lookup(id),
      cancel: (id, reason) => {
        sent.push(id)
        // 처음 요청은 보내지 못하고 멈춘다 (포트원은 모른다)
        if (hang) return new Promise(() => undefined)
        return inner.cancel(id, reason)
      },
    }))
    const world = await billingWorld({ billing: setup })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'labels-100')
    void refund(world, seller, paymentId)
    await waitFor(() => sent.length === 1)
    expect((await status(world, seller)).balances).toMatchObject({ LABELS: 0 })
    world.clock.advance(REFUND_HOLD_MS + 1)
    // 결제 내역을 열면 결제 조회 → 결제 그대로 → 환불 중을 푼다 (아무것도 바뀌지 않음)
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refunding: false, refundable: true })
    expect((await status(world, seller)).balances).toMatchObject({ LABELS: 100 })
    hang = false
    const done = await refund(world, seller, paymentId)
    expect(done.status, done.text).toBe(200)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(sent).toEqual([paymentId, paymentId])
  })

  it('멈춘 환불에 다시 환불을 눌렀는데 결제 그대로면 그 순간 다시 판단해 새로 취소한다', async () => {
    let hang = true
    const setup = withGateway((inner) => ({
      lookup: (id) => inner.lookup(id),
      cancel: (id, reason) => (hang ? new Promise(() => undefined) : inner.cancel(id, reason)),
    }))
    const world = await billingWorld({ billing: setup })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-10')
    void refund(world, seller, paymentId)
    await waitFor(async () => (await orderRow(world, paymentId))?.refund_hold_until !== null)
    world.clock.advance(REFUND_HOLD_MS + 1)
    hang = false
    const done = await refund(world, seller, paymentId)
    expect(done.status, done.text).toBe(200)
    expect(done.body).toEqual({ paymentId, state: 'REFUNDED', message: MESSAGES.refunded })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await revocations(world)).toBe(1)
  })

  it('환불 요청이 취소를 기다리는 동안 취소 웹훅이 먼저 와도 회수는 하나, 그 요청도 환불함', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'flat-30')
    fake(world).portone.cancelDelayMs = 300
    const pending = refund(world, seller, paymentId)
    await waitFor(() => fake(world).portone.status(paymentId) === 'CANCELLED')
    expect((await webhook(world, paymentId)).status).toBe(200)
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'REFUNDED' })
    const done = await pending
    expect(done.status, done.text).toBe(200)
    expect(done.body).toEqual({ paymentId, state: 'REFUNDED', message: MESSAGES.refunded })
    expect(await revocations(world)).toBe(1)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
  })

  it('환불 요청이 취소를 기다리는 동안 웹훅이 부분 취소를 보고 확인 필요로 올리면, 그 요청도 "운영자가 확인해요"이고 이용권은 계속 쓰지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.cancelDelayMs = 300
    const pending = refund(world, seller, paymentId)
    await waitFor(() => fake(world).portone.status(paymentId) === 'CANCELLED')
    fake(world).portone.setStatus(paymentId, 'PARTIAL_CANCELLED', 5000)
    expect((await webhook(world, paymentId)).status).toBe(200)
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'NEEDS_REVIEW' })
    const done = await pending
    expect(done.status, done.text).toBe(409)
    expect(done.body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: '결제를 자동으로 확인하지 못했어요. 운영자가 확인해요.' } })
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'NEEDS_REVIEW' })
    expect(await revocations(world)).toBe(0)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
    expect((await start(world, seller)).status).toBe(422)
    expect((await operator(world)).review.map((row) => row.paymentId)).toEqual([paymentId])
    expect(world.logs.filter((record) => record.code === 'PAYMENT_REVIEW')).toHaveLength(1)
  })
})

describe('RA-N5-01 밖에서 취소된 결제 (포트원 콘솔·PG)', () => {
  it('부여된 결제가 취소됐다는 웹훅 → 결제 조회 → 확인 필요(운영자 목록). 이용권은 막지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.setStatus(paymentId, 'CANCELLED', 5000)
    const hook = await webhook(world, paymentId)
    expect(hook.status).toBe(200)
    expect(await hook.json()).toEqual({ ok: true })
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'NEEDS_REVIEW', refund_hold_until: null })
    expect((await operator(world)).review.map((row) => row.paymentId)).toEqual([paymentId])
    expect(world.logs.some((record) => record.code === 'PAYMENT_REVIEW')).toBe(true)
    expect(JSON.stringify(world.logs)).not.toContain(paymentId)
    // 판매자 화면: 확인 필요, 환불 버튼 없음. 이용권은 그대로(방송을 갑자기 막지 않는다 — 운영자가 정한다)
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'NEEDS_REVIEW', refundable: false, refunding: false })
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
    // 다시 확인·웹훅을 또 받아도 더 건드리지 않는다
    const lookups = fake(world).portone.lookups
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'NONE', state: 'NEEDS_REVIEW' })
    expect((await webhook(world, paymentId)).status).toBe(200)
    expect(fake(world).portone.lookups).toBe(lookups)
  })

  it('부여된 결제의 다시 확인은 결제 조회로 맞춘다 — 결제 그대로면 그대로, 조회 실패면 결제 완료 문장 그대로(웹훅은 503)', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'orders-100')
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'NONE', state: 'GRANTED' })
    fake(world).portone.lookupFailure = true
    const view = await confirm(world, seller, paymentId)
    expect(view.body).toMatchObject({ result: 'NONE', state: 'GRANTED' })
    expect(view.body.message).toMatch(/^결제했어요\./)
    expect((await webhook(world, paymentId, 'Transaction.Paid')).status).toBe(503)
    fake(world).portone.lookupFailure = false
    expect((await webhook(world, paymentId, 'Transaction.Paid')).status).toBe(200)
    expect(await orderRow(world, paymentId)).toMatchObject({ state: 'GRANTED' })
  })
})

describe('RA-N5-01 금액 불일치 취소의 응답이 끊긴 경우', () => {
  it('취소는 반영됐는데 응답이 502 → 결제 조회로 확인해 금액이 달라 취소함', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const { saveBusiness, order } = await import('./billing-support.ts')
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.pay(paymentId, 100, 'CARD')
    fake(world).portone.cancelLost = true
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'CANCEL_MISMATCH', state: 'MISMATCH_CANCELLED' })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await query(world, 'select id from billing_grants')).toEqual([])
  })
})

describe('RA-N5-01 시험 결제 조작', () => {
  it('가짜 결제 서버는 어댑터 시간 제한을 지킨다 — 늦은 취소 응답은 시간 초과, 가짜 서버의 취소는 그대로', async () => {
    const base = testBilling({ timeoutMs: 50 })
    const portone = (base.test as NonNullable<BillingSetup['test']>).portone
    portone.pay('lj0123456789abcdef0123456789abcdef', 5000, 'CARD')
    portone.cancelDelayMs = 200
    const result = await base.gateway.cancel('lj0123456789abcdef0123456789abcdef', '시험')
    expect(result).toEqual({ kind: 'error' })
    expect(portone.status('lj0123456789abcdef0123456789abcdef')).toBe('CANCELLED')
    const looked: LookupResult = await base.gateway.lookup('lj0123456789abcdef0123456789abcdef')
    expect(looked).toMatchObject({ kind: 'found', payment: { status: 'CANCELLED' } })
  })

  it('PUT /api/billing/test/gateway 의 cancelLost', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const response = await client(world, seller.cookie).raw('/api/billing/test/gateway', {
      method: 'PUT',
      headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: rid('gw'), cancelLost: true }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ cancelLost: true, cancelFailure: false })
    expect(fake(world).portone.cancelLost).toBe(true)
  })
})
