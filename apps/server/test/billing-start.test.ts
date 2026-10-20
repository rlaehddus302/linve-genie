// N5 새 실제 방송 시작·쓰기 (AC-N5-11·20·21·22·23·24·25·27). 요금 기능을 켠 서버(시험 결제)로 돈다.
import { describe, expect, it } from 'vitest'
import { testBilling } from '../src/billing/fake.ts'
import { DAY_MS, FLAT_PERIOD_MS } from '../src/billing/rules.ts'
import type { Draft } from '../src/writer.ts'
import { billingWorld, grant, kst, query, status, usageKeys, type BillingWorld } from './billing-support.ts'
import { addSeller, client, countRows, createBroadcast, expectOk, fakeClock, login, newWorld, rid, writeEvent, type Seller } from './support.ts'

const NO_PASS = '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.'

async function start(world: BillingWorld, seller: Seller, input: Record<string, unknown> = {}, requestId = rid('bc')) {
  return client(world, seller.cookie).post('/api/broadcasts', { requestId, ...input })
}

describe('AC-N5-11 스위치 꺼짐 (기본)', () => {
  it('요금 기능이 꺼져 있으면 실제 방송은 지금과 같고 응답에 요금 항목이 없으며 이용 방식·쓴 기록이 없다. 요금 경로(웹훅 포함)는 404', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })
    expect(response.status, response.text).toBe(200)
    expect(response.body).not.toHaveProperty('billing')
    expect(await query(world, 'select * from billing_modes')).toEqual([])
    for (const path of ['/api/billing', '/api/billing/payments', '/api/billing/usage']) expect((await client(world, seller.cookie).get(path)).status).toBe(404)
    // 웹훅도 세션·Origin 없이 404 (로그인 요구 401·Origin 403이 아니다)
    const hook = await world.server.app.request('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(hook.status).toBe(404)
    const order = await client(world, seller.cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'CARD', agreed: true })
    expect(order.status).toBe(404)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toMatchObject({ billing: { enabled: false, testPayment: false } })
    // 시험 경로도 없다
    expect((await client(world, seller.cookie).post('/api/billing/test/grants', { kind: 'DAYS', quantity: 1 })).status).toBe(404)
  })

  it('setup을 주어도 enabled가 false면 꺼짐과 같다', async () => {
    const world = await billingWorld({ billing: testBilling({ enabled: false }) })
    const seller = await addSeller(world)
    expect((await start(world, seller)).status).toBe(200)
    expect((await client(world, seller.cookie).get('/api/billing')).status).toBe(404)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toMatchObject({ billing: { enabled: false } })
  })
})

describe('AC-N5-20 새 실제 방송 시작', () => {
  it('이용권이 없으면 422 NO_PASS이고 아무것도 기록하지 않는다 — 산 뒤 같은 요청 번호로 다시 보내면 시작된다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toMatchObject({ billing: { enabled: true, testPayment: true } })
    const requestId = rid('bc')
    const refused = await start(world, seller, {}, requestId)
    expect(refused.status).toBe(422)
    expect(refused.body).toEqual({ error: { code: 'NO_PASS', message: NO_PASS } })
    expect(await countRows(world.database, 'events')).toBe(0)
    expect(await countRows(world.database, 'broadcasts')).toBe(0)
    expect(await countRows(world.database, 'scopes')).toBe(0)
    expect(await query(world, 'select * from billing_modes')).toEqual([])
    expect(await query(world, 'select * from billing_usage')).toEqual([])
    // 라벨 장권만 있어도 막힌다 (BL-4 2)
    await grant(world, seller, 'LABELS', 100)
    expect((await start(world, seller, {}, requestId)).status).toBe(422)
    await grant(world, seller, 'DAYS', 1)
    const ok = await start(world, seller, {}, requestId)
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.billing).toEqual({ mode: 'DAY', usedDay: true })
    // 같은 요청 번호의 재전송 = 처음 결과, 방송 일을 다시 쓰지 않는다
    const again = await start(world, seller, {}, requestId)
    expect(again.body).toEqual(ok.body)
    expect(await usageKeys(world, 'DAYS')).toHaveLength(1)
  })

  it('정액 → 열린 창 → 방송 일 → 주문 건 순서 (서버 시각만 본다 — 지난 날짜로 열어도)', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock })
    let seller = await addSeller(world)
    await grant(world, seller, 'ORDERS', 40)
    await grant(world, seller, 'DAYS', 3)
    // 방송 일 잔량 3 → DAY + 씀 (지난 날짜여도)
    const first = await start(world, seller, { date: '2026-10-01' })
    expect(first.body.billing).toEqual({ mode: 'DAY', usedDay: true })
    let view = await status(world, seller)
    expect(view.balances).toEqual({ DAYS: 2, ORDERS: 40, LABELS: 0 })
    expect(view.window).toEqual({ from: new Date(kst('2026-10-20', '20:00')).toISOString(), until: new Date(kst('2026-10-21', '20:00')).toISOString() })
    expect(view.start).toEqual({ allowed: true, mode: 'DAY', useDay: false, flatUntil: null, windowUntil: new Date(kst('2026-10-21', '20:00')).toISOString(), days: null, orders: null })
    // 열린 창 → DAY, 쓰지 않음
    clock.set(kst('2026-10-21', '19:59'))
    expect((await start(world, seller)).body.billing).toEqual({ mode: 'DAY', usedDay: false })
    // 창 끝 시각 = 끝남 → 새로 씀
    clock.set(kst('2026-10-21', '20:00'))
    expect((await start(world, seller)).body.billing).toEqual({ mode: 'DAY', usedDay: true })
    view = await status(world, seller)
    expect(view.balances).toMatchObject({ DAYS: 1 })
    // 정액이 생기면 정액 방식
    await grant(world, seller, 'FLAT_30D')
    expect((await start(world, seller)).body.billing).toEqual({ mode: 'FLAT', usedDay: false })
    // 정액이 끝나고 창도 닫히고 방송 일 1 남음 → DAY 씀, 그 뒤 창 닫히면 ORDERS
    clock.advance(FLAT_PERIOD_MS)
    // 30일이 지나 세션이 끝났다 — 다시 로그인
    seller = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const afterFlat = await start(world, seller)
    expect(afterFlat.status, afterFlat.text).toBe(200)
    expect(afterFlat.body.billing).toEqual({ mode: 'DAY', usedDay: true })
    clock.advance(DAY_MS)
    expect((await start(world, seller)).body.billing).toEqual({ mode: 'ORDERS', usedDay: false })
    view = await status(world, seller)
    expect(view.start).toMatchObject({ allowed: true, mode: 'ORDERS', orders: 40 })
  })

  it('미리 보기는 기록하지 않는다 — 여러 번 불러도 쓴 기록·창이 생기지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'DAYS', 3)
    for (let i = 0; i < 3; i++) expect((await status(world, seller)).start).toEqual({ allowed: true, mode: 'DAY', useDay: true, flatUntil: null, windowUntil: null, days: { before: 3, after: 2 }, orders: null })
    expect(await query(world, 'select * from billing_usage')).toEqual([])
  })

  it('한 트랜잭션: 커밋 직전에 실패하면 엔진 기록·방송 행·이용 방식·방송 일 쓴 기록이 모두 없다', async () => {
    let fail = true
    const world = await billingWorld({
      hooks: {
        beforeCommit: () => {
          if (fail) throw new Error('주입한 실패')
        },
      },
    })
    const seller = await addSeller(world)
    await grant(world, seller, 'DAYS', 1)
    const failed = await start(world, seller)
    expect(failed.status).toBe(500)
    expect(await countRows(world.database, 'events')).toBe(0)
    expect(await countRows(world.database, 'broadcasts')).toBe(0)
    expect(await query(world, 'select * from billing_modes')).toEqual([])
    expect(await query(world, 'select * from billing_usage')).toEqual([])
    fail = false
    expect((await start(world, seller)).body.billing).toEqual({ mode: 'DAY', usedDay: true })
  })

  it('동시에 두 실제 방송 만들기 (방송 일 1, 창 없음): 하나가 쓰고 다른 하나는 그 창으로 — 방송 일은 1만 빠지고 창은 하나', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'DAYS', 1)
    const [a, b] = await Promise.all([start(world, seller, { date: '2026-10-19' }), start(world, seller, { date: '2026-10-20' })])
    expect([a.status, b.status]).toEqual([200, 200])
    const used = [a.body.billing, b.body.billing].map((billing) => (billing as { usedDay: boolean }).usedDay).sort()
    expect(used).toEqual([false, true])
    expect(await usageKeys(world, 'DAYS')).toHaveLength(1)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
  })
})

describe('AC-N5-21 리허설·스위치 꺼짐 때 시작한 방송', () => {
  it('리허설은 이용권이 없어도 시작되고 이용 방식이 없고, 1등이 여러 번 나와도 쓴 기록 0', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const rehearsal = await start(world, seller, { rehearsal: true })
    expect(rehearsal.status, rehearsal.text).toBe(200)
    expect(rehearsal.body).not.toHaveProperty('billing')
    const b = (rehearsal.body.broadcast as { id: string }).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 1, name: '핑크프릴', price: 10000 }))
    for (let i = 0; i < 3; i++) {
      await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${b}/rehearsal/chat`, { requestId: rid('rc'), nick: `시청자${String(i)}`, text: '1' }))
    }
    expect(await query(world, 'select * from billing_modes')).toEqual([])
    expect(await query(world, 'select * from billing_usage')).toEqual([])
  })

  it('요금 기능이 꺼져 있을 때 시작한 실제 방송은 켠 뒤에도 이용 방식이 없고 세지 않는다 — 켠 뒤 시작한 방송만 센다', async () => {
    const off = await newWorld()
    const seller = await addSeller(off)
    const before = await createBroadcast(off, seller, { date: '2026-10-19' })
    off.server.close()
    const { startServer } = await import('./support.ts')
    const on = { ...startServer(off.database, off.masterKey, { billing: testBilling() }) }
    const onSeller = { ...seller }
    await grant(on, onSeller, 'ORDERS', 5)
    await expectOk(writeEvent(on, onSeller, { type: 'product.register', b: before.id, no: 1, name: '핑크프릴', price: 10000 }))
    await expectOk(writeEvent(on, onSeller, { type: 'sms', b: before.id, no: 1, phone: '010-1234-5678' }))
    expect(await query(on, 'select * from billing_modes')).toEqual([])
    expect(await query(on, 'select * from billing_usage')).toEqual([])
    const response = await client(on, onSeller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-19' })
    expect(response.body.billing).toEqual({ mode: 'ORDERS', usedDay: false })
    const after = (response.body.broadcast as { id: string }).id
    await expectOk(writeEvent(on, onSeller, { type: 'product.register', b: after, no: 2, name: '라울', price: 5000 }))
    await expectOk(writeEvent(on, onSeller, { type: 'sms', b: after, no: 2, phone: '010-2222-3333' }))
    expect(await usageKeys(on, 'ORDERS')).toHaveLength(1)
    // 그 전 방송의 재전송 응답에는 이용 방식이 없다 (null)
    on.server.close()
  })
})

/** 엔진 골든 G-ENG-N5-01·02의 이벤트를 서버에 차례로 넣는다 (시각 = 그 줄의 at, KST 2026-10-20) */
async function feed(world: BillingWorld, seller: Seller, events: readonly Record<string, unknown>[]): Promise<void> {
  for (const event of events) {
    const { at, ...fields } = event as { at: string } & Record<string, unknown>
    world.clock.set(kst('2026-10-20', at))
    if (fields.type === 'broadcast.start') {
      const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20', title: fields.title })
      expect(response.status, response.text).toBe(200)
      continue
    }
    const draft: Draft = { fields, actor: { kind: 'server' }, ...(fields.type === 'chat' ? { chat: { b: fields.b as string, id: fields.id as string } } : {}), ...(fields.type === 'sms' ? { smsRef: fields.ref as string } : {}) }
    const outcome = await world.server.writer.write({ sellerId: seller.sellerId, date: '2026-10-20', rehearsal: false, createScope: false, requestId: null, build: () => [draft] })
    expect(outcome.kind).toBe('ok')
  }
}

const N5_01: readonly Record<string, unknown>[] = [
  { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
  { at: '20:00:01', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
  { at: '20:00:02', type: 'chat', b: 'b1', id: 'm2', ch: 'UC_B', nick: '김철수', text: '15' },
  { at: '20:01:00', type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_A', reason: '구매자 요청' },
  { at: '20:02:00', type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_B', reason: '구매자 요청' },
  { at: '20:03:00', type: 'product.register', b: 'b1', no: 16, name: '라울', price: 5000 },
  { at: '20:04:00', type: 'product.register', b: 'b1', no: 17, name: '홍미인', price: 8000, stock: 2 },
  { at: '20:04:01', type: 'chat', b: 'b1', id: 'm3', ch: 'UC_C', nick: '이영희', text: '17' },
  { at: '20:04:02', type: 'chat', b: 'b1', id: 'm4', ch: 'UC_D', nick: '박민수', text: '17' },
  { at: '20:05:00', type: 'product.register', b: 'b1', no: 18, name: '정야', price: 3000 },
  { at: '20:05:03', type: 'product.close', b: 'b1', no: 18 },
  { at: '20:06:00', type: 'product.renumber', b: 'b1', from: 15, to: 25 },
  { at: '20:06:10', type: 'product.register', b: 'b1', no: 15, name: '금황', price: 12000 },
  { at: '20:06:11', type: 'chat', b: 'b1', id: 'm5', ch: 'UC_E', nick: '최지우', text: '15' },
  { at: '20:07:00', type: 'product.renumber', b: 'b1', from: 17, to: 27 },
]

const N5_02: readonly Record<string, unknown>[] = [
  { at: '20:00:00', type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
  { at: '20:00:01', type: 'product.register', b: 'b1', no: 16, name: '라울', price: 5000 },
  { at: '20:00:10', type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
  { at: '20:00:40', type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00:05' },
  { at: '20:30:00', type: 'broadcast.end', b: 'b1' },
  { at: '20:40:00', type: 'sms', b: 'b1', ref: 's2', no: 16, received: '20:39' },
  { at: '21:00:00', type: 'broadcast.start', b: 'b2', title: '2부' },
  { at: '21:00:01', type: 'product.register', b: 'b2', no: 15, name: '라울', price: 7000 },
  { at: '21:00:02', type: 'chat', b: 'b2', id: 'm2', ch: 'UC_B', nick: '김철수', text: '15' },
  { at: '21:10:00', type: 'buyer.merge', from: 'sms:s2', into: 'UC_B', reason: '같은 사람' },
]

async function goldenWorld(): Promise<{ world: BillingWorld; seller: Seller }> {
  const ids = ['b1', 'b2']
  const clock = fakeClock(kst('2026-10-20', '19:59'))
  const world = await billingWorld({ clock, ids: { broadcast: () => ids.shift() ?? `b${String(Math.random()).slice(2, 10)}` } })
  const seller = await addSeller(world)
  return { world, seller }
}

describe('AC-N5-23 주문 건 쓰기 (엔진 골든 G-ENG-N5-01·02)', () => {
  it('G-ENG-N5-01을 ORDERS 방식 방송으로 넣으면 주문 건 3 (옛 15번·17번·새 15번) — 재고 2·승계·취소·번호 변경은 새로 쓰지 않는다', async () => {
    const { world, seller } = await goldenWorld()
    await grant(world, seller, 'ORDERS', 1)
    world.clock.set(kst('2026-10-20', '19:59'))
    const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20', title: '1부' })
    expect(response.body.billing).toEqual({ mode: 'ORDERS', usedDay: false })
    await feed(world, seller, N5_01)
    const rows = await query<{ key: string; product_no: number }>(world, `select key, product_no from billing_usage where kind = 'ORDERS' order by product_no`)
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.product_no)).toEqual([15, 15, 17])
    // 잔량 1 − 3 = −2 (초과) — 아무것도 막지 않았다
    expect((await status(world, seller)).balances).toMatchObject({ ORDERS: -2 })
    // 재시작(새 인스턴스·메모리 비움)·재생으로 늘지 않는다
    world.server.writer.forget(seller.sellerId, '2026-10-20')
    await world.server.writer.read(seller.sellerId, '2026-10-20')
    expect(await usageKeys(world, 'ORDERS')).toHaveLength(3)
  })

  it('G-ENG-N5-02를 1부·2부 모두 ORDERS로 넣으면 3 (1부 15·16번 — 끝낸 뒤 늦은 문자찜 포함, 2부 15번)', async () => {
    const { world, seller } = await goldenWorld()
    await grant(world, seller, 'ORDERS', 10)
    expect((await client(world, seller.cookie).patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } })).status).toBe(200)
    expect((await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20', title: '1부' })).body.billing).toEqual({ mode: 'ORDERS', usedDay: false })
    expect((await client(world, seller.cookie).patch('/api/settings', { settings: { 'contention.policy': 'ARRIVAL' } })).status).toBe(200)
    await feed(world, seller, N5_02)
    const rows = await query<{ broadcast_id: string; product_no: number }>(world, `select broadcast_id, product_no from billing_usage where kind = 'ORDERS' order by broadcast_id, product_no`)
    expect(rows).toEqual([
      { broadcast_id: 'b1', product_no: 15 },
      { broadcast_id: 'b1', product_no: 16 },
      { broadcast_id: 'b2', product_no: 15 },
    ])
  })

  it('같은 이벤트를 FLAT·DAY 방식이나 리허설로 넣으면 0', async () => {
    for (const kind of ['FLAT_30D', 'DAYS'] as const) {
      const { world, seller } = await goldenWorld()
      await grant(world, seller, kind, kind === 'DAYS' ? 1 : null)
      await grant(world, seller, 'ORDERS', 5)
      expect(((await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20', title: '1부' })).body.billing as { mode: string }).mode).toBe(kind === 'DAYS' ? 'DAY' : 'FLAT')
      await feed(world, seller, N5_01)
      expect(await usageKeys(world, 'ORDERS')).toEqual([])
    }
  })
})

describe('AC-N5-22 시작한 방송은 끝까지 — 아무것도 막지 않는다', () => {
  it('ORDERS 잔량 1에서 상품 넷이 1등(끝낸 뒤 늦은 문자찜 포함) → 요금 거절 없음, 잔량 −3. 판정은 요금 꺼진 서버와 같다', async () => {
    const run = async (billingOn: boolean) => {
      const clock = fakeClock(kst('2026-10-20', '20:00'))
      let refs = 0
      const ids = { broadcast: () => 'b1', smsRef: () => `ref${'abcdefghij'[refs++ % 10] ?? 'z'}` }
      const world = billingOn ? await billingWorld({ clock, ids }) : { ...(await newWorld({ clock, ids })), setup: testBilling({ enabled: false }) }
      const seller = await addSeller(world)
      if (billingOn) await grant(world, seller, 'ORDERS', 1)
      const created = await client(world, seller.cookie).post('/api/broadcasts', { requestId: 'bc-1', date: '2026-10-20' })
      expect(created.status).toBe(200)
      const responses: number[] = []
      const send = async (event: Record<string, unknown>) => {
        clock.advance(1000)
        const response = await writeEvent(world, seller, event)
        responses.push(response.status)
        return response
      }
      for (const no of [1, 2, 3, 4]) await send({ type: 'product.register', b: 'b1', no, name: `상품${String(no)}`, price: 1000 * no })
      await send({ type: 'sms', b: 'b1', no: 1, phone: '010-1111-0001' })
      await send({ type: 'sms', b: 'b1', no: 2, phone: '010-1111-0002' })
      await send({ type: 'sms', b: 'b1', no: 3, phone: '010-1111-0003' })
      const products = (await client(world, seller.cookie).get('/api/days/2026-10-20')).body.products as { no: number; winners: string[] }[]
      await send({ type: 'host.cancel', b: 'b1', no: 1, buyer: products.find((p) => p.no === 1)?.winners[0], reason: '구매자 요청' })
      clock.advance(1000)
      expect((await client(world, seller.cookie).post('/api/broadcasts/b1/end', { requestId: 'end-1' })).status).toBe(200)
      await send({ type: 'sms', b: 'b1', no: 4, phone: '010-1111-0004' })
      const view = (await client(world, seller.cookie).get('/api/days/2026-10-20')).body
      return { world, seller, responses, view }
    }
    const on = await run(true)
    const off = await run(false)
    expect(on.responses.every((code) => code === 200)).toBe(true)
    expect(on.responses).toEqual(off.responses)
    expect(on.view.products).toEqual(off.view.products)
    expect(on.view.buyers).toEqual(off.view.buyers)
    expect(on.view.settlement).toEqual(off.view.settlement)
    expect(await usageKeys(on.world, 'ORDERS')).toHaveLength(4)
    expect((await status(on.world, on.seller)).balances).toMatchObject({ ORDERS: -3 })
    // 초과 띠
    expect((await status(on.world, on.seller)).banners).toContainEqual({ kind: 'ORDERS_OVER', count: 3 })
    // 같은 이벤트 로그: 엔진 이벤트·발송함에 요금 정보가 없다 (BL-INV-7)
    const bodies = await query<{ body: string }>(on.world, 'select body from events union all select body from outbox')
    for (const { body } of bodies) expect(body).not.toMatch(/ORDERS|FLAT|billing|NO_PASS|usedDay/)
  })

  it('FLAT 방송 중 정액제가 끝나도·DAY 방송 중 창이 닫혀도 쓰기는 그대로, 이용 방식도 그대로', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock })
    const seller = await addSeller(world)
    await grant(world, seller, 'FLAT_30D', null, kst('2026-09-20', '21:00'))
    const flat = await createBroadcast(world, seller, { date: '2026-10-20' })
    expect((await query<{ mode: string }>(world, `select mode from billing_modes where broadcast_id = '${flat.id}'`))[0]?.mode).toBe('FLAT')
    clock.set(kst('2026-10-21', '00:00'))
    expect((await status(world, seller)).flat).toMatchObject({ active: false })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: flat.id, no: 1, name: '핑크프릴', price: 10000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: flat.id, no: 1, phone: '010-1234-0000' }))
    expect((await query<{ mode: string }>(world, `select mode from billing_modes where broadcast_id = '${flat.id}'`))[0]?.mode).toBe('FLAT')
    expect(await usageKeys(world, 'ORDERS')).toEqual([])
  })
})
