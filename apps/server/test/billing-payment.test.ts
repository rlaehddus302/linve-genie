// N5 결제·웹훅·금액 불일치·한 번만·조회 실패·7일 환불·증빙 (AC-N5-10·30~36·38). 시험 결제(가짜 결제 서버 — 포트원 V2 모양)로 돈다.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICE_TABLE } from '../src/billing/config.ts'
import { FakePortOne, TEST_WEBHOOK_SECRET, signedWebhook, testBilling } from '../src/billing/fake.ts'
import { DAY_MS, FLAT_PERIOD_MS } from '../src/billing/rules.ts'
import type { BillingSetup } from '../src/billing/service.ts'
import { BIZNO, billingWorld, buy, confirm, fake, grant, kst, order, query, saveBusiness, status, type BillingWorld } from './billing-support.ts'
import { addSeller, client, fakeClock, rid, sseReader, startServer, type Seller } from './support.ts'

const MESSAGES = {
  wait: "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.",
  failed: '결제가 되지 않았어요. 돈은 나가지 않았어요.',
  mismatch: '결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요.',
  review: '결제를 자동으로 확인하지 못했어요. 운영자가 확인해요.',
  lookupFailed: "결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.",
  business: '결제 전에 사업자 정보를 적어 주세요.',
  item: '지금 살 수 없는 이용권이에요.',
  terms: '이용권 약관과 환불 규정을 읽었다고 체크해 주세요.',
  refunded: '환불했어요. 결제 수단으로 돌려드려요.',
  refundRefused: '이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요.',
  refundFailed: '환불하지 못했어요. 잠시 뒤 다시 해 주세요.',
}

const refund = (world: BillingWorld, seller: Seller, paymentId: string, requestId = rid('rf')) => client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/refund`, { requestId })
const payments = async (world: BillingWorld, seller: Seller) => (await client(world, seller.cookie).get('/api/billing/payments')).body.items as Record<string, unknown>[]
const webhook = (world: BillingWorld, signed: { body: string; headers: Record<string, string> }) => world.server.app.request('/api/billing/webhook', { method: 'POST', headers: signed.headers, body: signed.body })

describe('AC-N5-30 결제 주문 만들기', () => {
  it('사업자 정보 없음·약관 동의 없음·살 수 없는 항목·다른 수단은 만들지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const noBusiness = await order(world, seller, 'days-1')
    expect(noBusiness.status).toBe(409)
    expect(noBusiness.body).toEqual({ error: { code: 'BUSINESS_REQUIRED', message: MESSAGES.business } })
    expect((await saveBusiness(world, seller)).status).toBe(200)
    const noTerms = await client(world, seller.cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'CARD' })
    expect(noTerms.status).toBe(400)
    expect(noTerms.body).toMatchObject({ error: { code: 'TERMS_REQUIRED', message: MESSAGES.terms } })
    expect((await client(world, seller.cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'CARD', agreed: 'yes' })).status).toBe(400)
    const unknown = await order(world, seller, 'nothing-here')
    expect(unknown.status).toBe(409)
    expect(unknown.body).toEqual({ error: { code: 'ITEM_UNAVAILABLE', message: MESSAGES.item } })
    const other = await client(world, seller.cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'VIRTUAL_ACCOUNT', agreed: true })
    expect(other.status).toBe(400)
    expect(other.body).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    expect((await client(world, seller.cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'CARD', agreed: true, amount: 1 })).body).toMatchObject({
      error: { code: 'UNKNOWN_FIELD' },
    })
    expect(await query(world, 'select * from billing_orders')).toEqual([])
  })

  it('주문: 서버가 만든 결제 ID(영문·숫자 20~64자)·금액 스냅샷·PENDING. 같은 요청 번호는 같은 주문. 가격을 바꿔도 그 주문 금액은 그대로', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const requestId = rid('o')
    const first = await order(world, seller, 'orders-100', 'TRANSFER', requestId)
    expect(first.status, first.text).toBe(200)
    expect(first.body).toMatchObject({ orderName: '주문 건권 100건', amount: 10000, currency: 'KRW', method: 'TRANSFER', kind: 'ORDERS', quantity: 100, testPayment: true, storeId: null, channelKey: null })
    expect(first.body.paymentId).toMatch(/^[A-Za-z0-9]{20,64}$/)
    expect((await order(world, seller, 'orders-100', 'TRANSFER', requestId)).body).toEqual(first.body)
    expect(await query(world, 'select payment_id from billing_orders')).toHaveLength(1)
    // 다른 판매자는 다른 결제 ID
    const other = await addSeller(world)
    await saveBusiness(world, other)
    expect((await order(world, other, 'orders-100')).body.paymentId).not.toBe(first.body.paymentId)
    // 가격을 바꾼 서버로 다시 켠다 → 그 주문의 금액은 10,000원 그대로, 그 금액으로 결제하면 부여
    world.server.close()
    const changed: BillingSetup = { ...world.setup, prices: { placeholder: false, items: DEFAULT_PRICE_TABLE.items.map((item) => ({ ...item, price: item.price * 2 })) } }
    const restarted = { ...startServer(world.database, world.masterKey, { billing: changed, clock: world.clock }), setup: changed }
    fake(restarted).portone.pay(first.body.paymentId as string, 10000, 'TRANSFER')
    const confirmed = await confirm(restarted, seller, first.body.paymentId as string)
    expect(confirmed.body).toMatchObject({ result: 'GRANT', state: 'GRANTED', amount: 10000 })
    expect((await status(restarted, seller)).items).toContainEqual({ id: 'orders-100', name: '주문 건권 100건', kind: 'ORDERS', quantity: 100, price: 20000 })
  })
})

describe('AC-N5-31 결제 확인 — 조회 API·대조·부여', () => {
  it('결제 완료 → 부여(결제 ID당 하나), 문장 "결제했어요. <항목>을 받았어요.", 실시간 요금 알림. 확인 본문에 금액을 끼우면 UNKNOWN_FIELD', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const created = await order(world, seller, 'days-1')
    const paymentId = created.body.paymentId as string
    const sse = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    await sse.until(() => sse.events.some((e) => e.event === 'ready'))
    // 결제 창을 열기 전: 기다림
    const waiting = await confirm(world, seller, paymentId)
    expect(waiting.body).toMatchObject({ result: 'WAIT', state: 'PENDING', message: MESSAGES.wait })
    const injected = await client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/confirm`, { requestId: rid('cf'), amount: 5000, status: 'PAID' })
    expect(injected.status).toBe(400)
    expect(injected.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    fake(world).portone.pay(paymentId, 5000, 'CARD')
    const granted = await confirm(world, seller, paymentId)
    expect(granted.body).toEqual({ paymentId, result: 'GRANT', state: 'GRANTED', message: '결제했어요. 방송 일권 1일을 받았어요.', itemName: '방송 일권 1일', amount: 5000 })
    await sse.until(() => sse.events.some((e) => e.event === 'billing' && JSON.parse(e.data).reason === 'grant'))
    // 다시 확인해도 하나
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'NONE', state: 'GRANTED' })
    expect(await query(world, 'select id from billing_grants')).toHaveLength(1)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
    // 실시간 알림에는 까닭만 (결제 ID·금액 없음)
    for (const e of sse.events.filter((item) => item.event === 'billing')) expect(e.data).not.toContain(paymentId)
    await sse.cancel()
  })

  it('정액 결제는 이용 중이면 남은 기간 뒤에 이어 붙는다', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:31'))
    const world = await billingWorld({ clock })
    const seller = await addSeller(world)
    await grant(world, seller, 'FLAT_30D', null, kst('2026-10-17', '20:31'))
    expect((await status(world, seller)).flat).toMatchObject({ active: true, until: new Date(kst('2026-11-16', '20:31')).toISOString() })
    await buy(world, seller, 'flat-30')
    expect((await status(world, seller)).flat).toMatchObject({ active: true, until: new Date(kst('2026-11-16', '20:31') + FLAT_PERIOD_MS).toISOString() })
  })

  it('실패 → 결제 안 됨, 나중에 결제 완료로 바뀌면 부여. 부분 취소·모르는 상태 → 확인 필요(그 뒤 자동 확인은 건드리지 않음)', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const a = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.fail(a, 5000)
    expect((await confirm(world, seller, a)).body).toMatchObject({ result: 'FAIL', state: 'FAILED', message: MESSAGES.failed })
    fake(world).portone.pay(a, 5000, 'CARD')
    expect((await confirm(world, seller, a)).body).toMatchObject({ result: 'GRANT', state: 'GRANTED' })
    const b = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.setStatus(b, 'PARTIAL_CANCELLED', 5000)
    expect((await confirm(world, seller, b)).body).toMatchObject({ result: 'REVIEW', state: 'NEEDS_REVIEW', message: MESSAGES.review })
    fake(world).portone.pay(b, 5000, 'CARD')
    expect((await confirm(world, seller, b)).body).toMatchObject({ result: 'NONE', state: 'NEEDS_REVIEW' })
    expect(await query(world, 'select id from billing_grants')).toHaveLength(1)
  })
})

describe('AC-N5-33 금액이 다르면 전액 취소', () => {
  it('금액을 바꿔 결제 → 이용권 없이 전액 취소 → 금액이 달라 취소함. 다시 확인해도 취소를 두 번 요청하지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'flat-30')).body.paymentId as string
    fake(world).portone.pay(paymentId, 100, 'CARD')
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'CANCEL_MISMATCH', state: 'MISMATCH_CANCELLED', message: MESSAGES.mismatch })
    expect(fake(world).portone.status(paymentId)).toBe('CANCELLED')
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'NONE', state: 'MISMATCH_CANCELLED' })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await query(world, 'select id from billing_grants')).toEqual([])
    expect(fake(world).portone.requests.filter((r) => r.path.endsWith('/cancel'))[0]?.body).toBe(JSON.stringify({ storeId: 'store-test-livejjim', reason: '결제 금액 불일치' }))
  })

  it('취소가 실패하면 확인 필요로 두고 운영자가 본다 — 다시 확인해도 취소를 다시 요청하지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'days-10')).body.paymentId as string
    fake(world).portone.pay(paymentId, 39000, 'TRANSFER')
    fake(world).portone.cancelFailure = true
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'CANCEL_MISMATCH', state: 'NEEDS_REVIEW', message: MESSAGES.review })
    fake(world).portone.cancelFailure = false
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'NONE', state: 'NEEDS_REVIEW' })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await query(world, 'select * from billing_documents')).toEqual([])
  })
})

describe('AC-N5-34 한 번만', () => {
  it('같은 결제의 확인·웹훅 열 개가 동시에 와도 이용권 하나·증빙 요청 하나', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'orders-500', 'TRANSFER')).body.paymentId as string
    fake(world).portone.pay(paymentId, 40000, 'TRANSFER')
    const signed = signedWebhook(TEST_WEBHOOK_SECRET, paymentId, world.clock.now())
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => confirm(world, seller, paymentId)),
      ...Array.from({ length: 5 }, () => webhook(world, signed)),
    ])
    expect(results.filter((r) => 'body' in r && (r.body as { result?: string }).result === 'GRANT')).toHaveLength(1)
    expect(await query(world, 'select id from billing_grants')).toHaveLength(1)
    expect(await query(world, 'select id from billing_documents')).toHaveLength(1)
    expect((await status(world, seller)).balances).toMatchObject({ ORDERS: 500 })
  })
})

describe('AC-N5-32 웹훅', () => {
  it('서명·시각이 맞으면 결제 ID로 확인(본문의 금액·상태는 쓰지 않는다). 세션·Origin 없이 받고 응답에 내부 상태가 없다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'labels-100')).body.paymentId as string
    fake(world).portone.pay(paymentId, 2000, 'CARD')
    const signed = signedWebhook(TEST_WEBHOOK_SECRET, paymentId, world.clock.now())
    const response = await webhook(world, signed)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect((await status(world, seller)).balances).toMatchObject({ LABELS: 100 })
  })

  it('서명 틀림·없음·다른 비밀값·본문 바꿈·시각 밖·본문 형식 오류는 400, 아무것도 기록하지 않고 조회도 하지 않는다. 모르는 결제 ID는 200', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.pay(paymentId, 5000, 'CARD')
    const now = world.clock.now()
    const good = signedWebhook(TEST_WEBHOOK_SECRET, paymentId, now)
    const otherSecret = signedWebhook(`whsec_${Buffer.from('other-secret').toString('base64')}`, paymentId, now)
    const lookups = fake(world).portone.lookups
    const bad = [
      { ...good, headers: { ...good.headers, 'webhook-signature': 'v1,AAAA' } },
      { ...good, headers: { 'Content-Type': 'application/json', 'webhook-id': good.headers['webhook-id'] ?? '', 'webhook-timestamp': good.headers['webhook-timestamp'] ?? '' } },
      otherSecret,
      { ...good, body: good.body.replace(paymentId, `${paymentId.slice(0, -1)}x`) },
      signedWebhook(TEST_WEBHOOK_SECRET, paymentId, now - 6 * 60 * 1000),
      signedWebhook(TEST_WEBHOOK_SECRET, paymentId, now + 6 * 60 * 1000),
    ]
    for (const attempt of bad) expect((await webhook(world, attempt)).status).toBe(400)
    // 형식 오류 본문 (서명은 맞음)
    const { signWebhook } = await import('../src/billing/portone.ts')
    const ts = Math.floor(now / 1000)
    const malformed = 'not json'
    expect((await webhook(world, { body: malformed, headers: { 'Content-Type': 'application/json', 'webhook-id': 'x1', 'webhook-timestamp': String(ts), 'webhook-signature': signWebhook(TEST_WEBHOOK_SECRET, 'x1', ts, malformed) } })).status).toBe(400)
    expect(fake(world).portone.lookups).toBe(lookups)
    expect(await query(world, 'select id from billing_grants')).toEqual([])
    // 모르는 결제 ID → 200, 아무 일 없음
    expect((await webhook(world, signedWebhook(TEST_WEBHOOK_SECRET, 'lj00000000000000000000000000000000', now))).status).toBe(200)
    expect(fake(world).portone.lookups).toBe(lookups)
    // 64KB 넘는 본문
    const huge = await world.server.app.request('/api/billing/webhook', { method: 'POST', headers: good.headers, body: 'x'.repeat(70 * 1024) })
    expect(huge.status).toBe(413)
  })

  it('조회 실패면 503 (포트원이 다시 보낸다), 주문은 그대로', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.pay(paymentId, 5000, 'CARD')
    fake(world).portone.lookupFailure = true
    const response = await webhook(world, signedWebhook(TEST_WEBHOOK_SECRET, paymentId, world.clock.now()))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(/PENDING|GRANT|seller|sel_/)
    expect(await query<{ state: string }>(world, 'select state from billing_orders')).toEqual([{ state: 'PENDING' }])
  })
})

describe('AC-N5-35 조회 실패', () => {
  it('시간 초과·5xx·이상한 응답이면 주문은 그대로, "결제를 확인하지 못했어요…"', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    const paymentId = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.pay(paymentId, 5000, 'CARD')
    fake(world).portone.lookupFailure = true
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'LOOKUP_FAILED', state: 'PENDING', message: MESSAGES.lookupFailed })
    fake(world).portone.lookupFailure = false
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ result: 'GRANT' })
  })

  it('결제 조회가 멈춰 있는 동안에도 같은 판매자의 방송 시작·문자찜은 늦지 않는다', async () => {
    let release: () => void = () => {}
    const stuck = new Promise<void>((resolve) => {
      release = resolve
    })
    const portone = new FakePortOne()
    const base = testBilling()
    const hanging: BillingSetup = {
      ...base,
      gateway: {
        lookup: async (id) => {
          await stuck
          return portone.gateway().lookup(id)
        },
        cancel: (id, reason) => portone.gateway().cancel(id, reason),
      },
    }
    const world = await billingWorld({ billing: hanging })
    const seller = await addSeller(world)
    await saveBusiness(world, seller)
    await grant(world, seller, 'DAYS', 1)
    const paymentId = (await order(world, seller, 'days-1')).body.paymentId as string
    const pending = confirm(world, seller, paymentId)
    const started = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })
    expect(started.status).toBe(200)
    const b = (started.body.broadcast as { id: string }).id
    expect((await client(world, seller.cookie).post('/api/events', { requestId: rid('ev'), type: 'product.register', b, no: 1, name: '핑크프릴', price: 1000 })).status).toBe(200)
    release()
    expect((await pending).body).toMatchObject({ result: 'WAIT' })
  })

  it('포트원 어댑터의 시간 제한: 응답이 없으면 정해진 시간 뒤 조회 실패', async () => {
    const { PortOneGateway } = await import('../src/billing/portone.ts')
    const gateway = new PortOneGateway({ storeId: 's', apiSecret: 'k', timeoutMs: 50, fetch: (_input, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))) })
    expect(await gateway.lookup('lj0123456789012345678901')).toEqual({ kind: 'error' })
  })
})

describe('AC-N5-36 7일 환불', () => {
  it('쓰지 않은 결제 이용권: 전액 취소 → 회수·환불함, 같은 요청 번호 재전송은 처음 결과(취소는 한 번)', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-10')
    let list = await payments(world, seller)
    expect(list[0]).toMatchObject({ type: 'order', paymentId, state: 'GRANTED', refundable: true })
    const requestId = rid('rf')
    const done = await refund(world, seller, paymentId, requestId)
    expect(done.status, done.text).toBe(200)
    expect(done.body).toEqual({ paymentId, state: 'REFUNDED', message: MESSAGES.refunded })
    expect((await refund(world, seller, paymentId, requestId)).body).toEqual(done.body)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
    list = await payments(world, seller)
    expect(list[0]).toMatchObject({ state: 'REFUNDED', refundable: false })
    expect(await query(world, 'select grant_id from billing_revocations')).toHaveLength(1)
    // 이미 환불한 것은 거절
    expect((await refund(world, seller, paymentId)).body).toEqual({ error: { code: 'REFUND_NOT_ALLOWED', message: MESSAGES.refundRefused } })
  })

  it('쓰기 시작했거나 7일이 지났거나 운영자 이용권·결제 완료가 아닌 주문은 같은 문장으로 거절', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock })
    let seller = await addSeller(world)
    const used = await buy(world, seller, 'days-1')
    expect((await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })).body.billing).toEqual({ mode: 'DAY', usedDay: true })
    expect((await refund(world, seller, used)).body).toMatchObject({ error: { code: 'REFUND_NOT_ALLOWED', message: MESSAGES.refundRefused } })
    const late = await buy(world, seller, 'orders-100')
    clock.advance(7 * DAY_MS)
    seller = { ...seller, cookie: (await import('./support.ts').then((m) => m.login(world, seller.loginId, seller.password))) }
    expect((await refund(world, seller, late)).status).toBe(409)
    await saveBusiness(world, seller)
    const pending = (await order(world, seller, 'days-1')).body.paymentId as string
    expect((await refund(world, seller, pending)).status).toBe(409)
    expect(fake(world).portone.cancelCalls.size).toBe(0)
  })

  it('취소가 실패하면 아무것도 바꾸지 않는다 — "환불하지 못했어요…"', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'flat-30')
    fake(world).portone.cancelFailure = true
    const failed = await refund(world, seller, paymentId)
    expect(failed.status).toBe(502)
    expect(failed.body).toEqual({ error: { code: 'REFUND_FAILED', message: MESSAGES.refundFailed } })
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refundable: true, refunding: false })
    expect((await status(world, seller)).flat).toMatchObject({ active: true })
    fake(world).portone.cancelFailure = false
    expect((await refund(world, seller, paymentId)).status).toBe(200)
  })

  it('동시에 두 번(다른 요청 번호) → 취소 요청은 한 번, 회수 하나. 환불과 방송 시작이 동시면 환불한 이용권으로 시작하지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    const [a, b, start] = await Promise.all([refund(world, seller, paymentId), refund(world, seller, paymentId), client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })])
    expect(fake(world).portone.cancelCalls.get(paymentId) ?? 0).toBeLessThanOrEqual(1)
    const refunded = [a, b].filter((r) => r.status === 200)
    const revocations = await query(world, 'select grant_id from billing_revocations')
    if (start.status === 200) {
      // 시작이 먼저 → 방송 일을 썼으니 환불은 거절
      expect(refunded).toHaveLength(0)
      expect(revocations).toHaveLength(0)
    } else {
      expect(start.status).toBe(422)
      expect(refunded).toHaveLength(1)
      expect(revocations).toHaveLength(1)
    }
  })

  it('회수한 정액 이용권은 사슬에서 빠지고 뒤 이용권이 다시 계산된다 (G-BIL-024)', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock })
    const seller = await addSeller(world)
    const first = await buy(world, seller, 'flat-30')
    clock.advance(60_000)
    await buy(world, seller, 'flat-30')
    const before = (await status(world, seller)).flat as { chain: { from: string }[] }
    expect(before.chain).toHaveLength(2)
    expect((await refund(world, seller, first)).status).toBe(200)
    const after = (await status(world, seller)).flat as { chain: { from: string; until: string }[]; until: string }
    expect(after.chain).toHaveLength(1)
    expect(after.chain[0]?.from).toBe(new Date(kst('2026-10-20', '20:01')).toISOString())
  })
})

describe('AC-N5-38 증빙 요청 (팝빌 자리)', () => {
  it('계좌이체 부여마다 증빙 하나(부가세 나누기) → 가짜 발행기 발행됨 TEST-… / 카드는 없음 / 환불하면 취소됨', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller, { receiptKind: 'CASH_RECEIPT' })
    const card = await buy(world, seller, 'days-1', 'CARD')
    const transfer = await buy(world, seller, 'flat-30', 'TRANSFER')
    const docs = await query<{ payment_id: string; kind: string; amount: number; supply: number; vat: number; status: string; approval: string; recipient_sealed: string }>(world, 'select * from billing_documents')
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ payment_id: transfer, kind: 'CASH_RECEIPT', amount: 30000, supply: 27273, vat: 2727, status: 'ISSUED' })
    expect(docs[0]?.approval).toMatch(/^TEST-/)
    expect(docs[0]?.recipient_sealed).not.toContain('6789')
    const list = await payments(world, seller)
    expect(list.find((item) => item.paymentId === card)).toMatchObject({ document: null })
    expect(list.find((item) => item.paymentId === transfer)).toMatchObject({ document: { kind: 'CASH_RECEIPT', status: 'ISSUED', cancel: null } })
    expect((await refund(world, seller, transfer)).status).toBe(200)
    expect((await payments(world, seller)).find((item) => item.paymentId === transfer)).toMatchObject({ state: 'REFUNDED', document: { status: 'ISSUED', cancel: 'CANCELLED' } })
    // 사업자 정보를 바꿔도 이미 만든 증빙의 받는 쪽은 그대로, 다음 결제는 새 정보
    const sealedBefore = docs[0]?.recipient_sealed
    await saveBusiness(world, seller, { name: '새 상호', receiptKind: 'TAX_INVOICE' })
    const next = await buy(world, seller, 'labels-100', 'TRANSFER')
    const after = await query<{ payment_id: string; kind: string; recipient_sealed: string }>(world, 'select payment_id, kind, recipient_sealed from billing_documents order by id')
    expect(after[0]?.recipient_sealed).toBe(sealedBefore)
    expect(after.find((doc) => doc.payment_id === next)?.kind).toBe('TAX_INVOICE')
    expect(fake(world).issuer.issued.at(-1)?.recipient).toMatchObject({ businessNumber: BIZNO, name: '새 상호' })
  })

  it('발행기 실패는 발행 실패로 남고 결제·이용권은 그대로 / 운영 기본(없음)은 발행 대기·취소 요청으로 둔다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    fake(world).issuer.fail = true
    await buy(world, seller, 'days-1', 'TRANSFER')
    expect(await query(world, 'select status from billing_documents')).toEqual([{ status: 'FAILED' }])
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
    const { noneIssuer } = await import('../src/billing/documents.ts')
    const none = await billingWorld({ billing: { ...testBilling(), issuer: noneIssuer } })
    const s2 = await addSeller(none)
    const paid = await buy(none, s2, 'days-1', 'TRANSFER')
    expect(await query(none, 'select status, cancel from billing_documents')).toEqual([{ status: 'PENDING', cancel: null }])
    expect((await refund(none, s2, paid)).status).toBe(200)
    expect(await query(none, 'select status, cancel from billing_documents')).toEqual([{ status: 'PENDING', cancel: 'REQUESTED' }])
  })
})

describe('AC-N5-10 격리', () => {
  it('다른 판매자의 결제 ID로 확인·환불·시험 조작하면 없는 결제와 같은 404, 내역·상태에 보이지 않는다', async () => {
    const world = await billingWorld()
    const owner = await addSeller(world)
    const intruder = await addSeller(world)
    const paymentId = await buy(world, owner, 'days-10')
    expect((await confirm(world, intruder, paymentId)).status).toBe(404)
    expect((await refund(world, intruder, paymentId)).status).toBe(404)
    expect((await client(world, intruder.cookie).post(`/api/billing/test/payments/${paymentId}`, { action: 'PAID' })).status).toBe(404)
    expect((await client(world, intruder.cookie).post(`/api/billing/test/payments/${paymentId}/webhook`, {})).status).toBe(404)
    expect((await confirm(world, intruder, 'lj00000000000000000000000000000000')).status).toBe(404)
    expect(await payments(world, intruder)).toEqual([])
    expect((await status(world, intruder)).balances).toEqual({ DAYS: 0, ORDERS: 0, LABELS: 0 })
    expect((await status(world, intruder)).business).toBeNull()
    expect((await status(world, owner)).balances).toMatchObject({ DAYS: 10 })
  })
})
