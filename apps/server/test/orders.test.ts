// 주문 탭 목록·주문 상세 (D-UX4-125, 사용자 지시 2026-11-11): GET /api/orders(최근 날짜부터, 같은 날짜 안에서는 첫 예약이 늦은 손님부터, 날짜 단위 쪽)와
// GET /api/days/:date/order?buyer=(상품 줄·예약 시각·그날 배송비 규칙·다른 날짜 거래). 읽기만 한다.
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { at, chat, kst, ok } from './i2-support.ts'
import { A, B, X, scenario, sealA, tempDirs } from './pl1a-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, rid, type Seller, type TestServer } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const D1 = '2026-10-18'
const D2 = '2026-10-19'
const ADDRESS = { name: '김받는', phone: '010-2222-3333', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '' }

interface OrderRow {
  date: string
  buyer: string
  name: string | null
  nickname: string
  platform: string | null
  total: number
  itemCount: number
  firstClaimAt: string | null
}
interface OrdersView {
  today: string
  orders: OrderRow[]
  more: boolean
  next: string | null
}

async function world0(): Promise<{ world: TestServer; seller: Seller }> {
  const world = await newWorld({ clock: fakeClock(kst(D1, '09:00:00')) })
  const seller = await addSeller(world)
  return { world, seller }
}

const list = async (world: TestServer, seller: Seller, before?: string): Promise<OrdersView> =>
  (await expectOk(client(world, seller.cookie).get(`/api/orders${before === undefined ? '' : `?before=${before}`}`))).body as unknown as OrdersView
const detail = (world: TestServer, seller: Seller, date: string, buyer: string, query = '') => client(world, seller.cookie).get(`/api/days/${date}/order?buyer=${encodeURIComponent(buyer)}${query}`)
const putAddress = async (world: TestServer, seller: Seller, date: string, buyer: string) =>
  expectOk(client(world, seller.cookie).put(`/api/parcels/days/${date}/address`, { requestId: rid('pa'), buyer, address: ADDRESS }))
const settlementOf = async (world: TestServer, seller: Seller, date: string, buyer: string) => {
  const view = await expectOk(client(world, seller.cookie).get(`/api/days/${date}`))
  return (view.body.settlements as { buyer: string; total: number; subtotal: number; shipping: number }[]).find((item) => item.buyer === buyer)
}

/**
 * D1: 유튜브 홍길동(UC_A) 1번 20:00:05 · 문자찜 손님 2번 20:01:00 · 유튜브 나래(UC_B) 3번 20:02:00
 * D2(무료 기준 30,000원·기본 3,000원): 홍길동 5번 20:00:10 · 2번 20:00:20(합 31,000원 → 배송비 0) · 나래 1번 20:05:00(직접 수령)
 */
async function sell(world: TestServer, seller: Seller): Promise<{ sms: string }> {
  at(world, D1, '19:00:00')
  const b1 = (await createBroadcast(world, seller, { date: D1, title: '1부' })).id
  await ok(world, seller, { type: 'product.register', b: b1, no: 1, name: '핑크프릴', price: 10000 })
  await ok(world, seller, { type: 'product.register', b: b1, no: 2, name: '라울', price: 5000 })
  await ok(world, seller, { type: 'product.register', b: b1, no: 3, name: '블루엘프', price: 8000 })
  at(world, D1, '20:00:05')
  await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '1')
  at(world, D1, '20:01:00')
  const sms = String((await ok(world, seller, { type: 'sms', b: b1, no: 2, phone: '010-1234-5678' })).body.buyer)
  at(world, D1, '20:02:00')
  await chat(world, seller, b1, 'm2', 'UC_B', '나래', '3')

  at(world, D2, '19:00:00')
  await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'shipping.baseFee': 3000, 'shipping.freeThreshold': 30_000 } }))
  const b2 = (await createBroadcast(world, seller, { date: D2, title: '1부' })).id
  // 첫 방송 뒤에 설정을 바꾸고 두 번째 방송을 열어도 그날 규칙은 첫 방송의 스냅샷
  await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'shipping.baseFee': 5000, 'shipping.freeThreshold': null } }))
  const b3 = (await createBroadcast(world, seller, { date: D2, title: '2부' })).id
  await ok(world, seller, { type: 'product.register', b: b2, no: 5, name: '방울복랑 금', price: 21000 })
  await ok(world, seller, { type: 'product.register', b: b2, no: 2, name: '라울', price: 10000 })
  await ok(world, seller, { type: 'product.register', b: b3, no: 1, name: '황금사', price: 6000 })
  at(world, D2, '20:00:10')
  await chat(world, seller, b2, 'm3', 'UC_A', '홍길동', '5')
  at(world, D2, '20:00:20')
  await chat(world, seller, b2, 'm4', 'UC_A', '홍길동', '2')
  at(world, D2, '20:05:00')
  await chat(world, seller, b3, 'm5', 'UC_B', '나래', '1')
  await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_B', date: D2, mode: 'PICKUP' }, D2)
  return { sms }
}

describe('D-UX4-125 주문 목록', () => {
  it('최근 날짜부터, 같은 날짜 안에서는 첫 예약이 늦은 손님부터. 성함은 배송지 받는 분(없으면 null), 문자 손님은 SMS', async () => {
    const { world, seller } = await world0()
    const { sms } = await sell(world, seller)
    await putAddress(world, seller, D2, 'UC_A')
    const view = await list(world, seller)
    expect(view.today).toBe(D2)
    expect(view.orders.map((row) => [row.date, row.buyer])).toEqual([
      [D2, 'UC_B'],
      [D2, 'UC_A'],
      [D1, 'UC_B'],
      [D1, sms],
      [D1, 'UC_A'],
    ])
    const a2 = view.orders[1] as OrderRow
    expect(a2).toEqual({ date: D2, buyer: 'UC_A', name: '김받는', nickname: '홍길동', platform: 'YOUTUBE', total: 31_000, itemCount: 2, firstClaimAt: new Date(kst(D2, '20:00:10')).toISOString() })
    expect(view.orders[0]).toMatchObject({ name: null, nickname: '나래', platform: 'YOUTUBE', total: 6000, itemCount: 1 })
    const smsRow = view.orders[3] as OrderRow
    expect(smsRow).toMatchObject({ name: null, platform: 'SMS', total: 5000 + 4000, itemCount: 1, firstClaimAt: new Date(kst(D1, '20:01:00')).toISOString() })
    // 닉네임 = 그날 화면의 구매자 이름 그대로
    const day = await expectOk(client(world, seller.cookie).get(`/api/days/${D1}`))
    expect(smsRow.nickname).toBe((day.body.buyers as { id: string; display: string }[]).find((item) => item.id === sms)?.display)
    // 금액은 그날 정산 묶음 그대로
    for (const row of view.orders) expect(row.total).toBe((await settlementOf(world, seller, row.date, row.buyer))?.total)
    expect(view.more).toBe(false)
    expect(view.next).toBeNull()
    // before: 그 날짜보다 앞선 날짜만
    expect((await list(world, seller, D2)).orders.map((row) => row.date)).toEqual([D1, D1, D1])
    expect((await list(world, seller, D1)).orders).toEqual([])
  })

  it('리허설 날짜는 넣지 않고, 바뀐 판매는 다시 센다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    const rb = (await createBroadcast(world, seller, { date: '2026-10-20', title: '연습', rehearsal: true })).id
    expect(rb).not.toBe('')
    const before = await list(world, seller)
    expect(before.orders.some((row) => row.date === '2026-10-20')).toBe(false)
    const total = before.orders.find((row) => row.date === D1 && row.buyer === 'UC_A')?.total
    await ok(world, seller, { type: 'settlement.adjust', buyer: 'UC_A', date: D1, amount: -1000, reason: '할인' }, D1)
    const after = await list(world, seller)
    expect(after.orders.find((row) => row.date === D1 && row.buyer === 'UC_A')?.total).toBe((total ?? 0) - 1000)
  })

  it('쪽은 날짜 단위: 40줄 이상이면 그 날짜까지, more·next로 이어 받는다', async () => {
    const { world, seller } = await world0()
    const dates = ['2026-10-16', '2026-10-17', '2026-10-18']
    const counts = [1, 20, 25]
    for (const [i, date] of dates.entries()) {
      at(world, date, '19:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      for (let n = 1; n <= (counts[i] as number); n += 1) {
        await ok(world, seller, { type: 'product.register', b, no: n, name: `품종${String(n)}`, price: 1000 })
        await chat(world, seller, b, `m${date}-${String(n)}`, `UC_${String(n)}`, `손님${String(n)}`, String(n))
      }
    }
    const first = await list(world, seller)
    expect(first.orders).toHaveLength(45)
    expect([...new Set(first.orders.map((row) => row.date))]).toEqual(['2026-10-18', '2026-10-17'])
    expect(first.more).toBe(true)
    expect(first.next).toBe('2026-10-17')
    const second = await list(world, seller, first.next ?? '')
    expect(second.orders.map((row) => row.date)).toEqual(['2026-10-16'])
    expect(second.more).toBe(false)
    expect(second.next).toBeNull()
  })

  it('쪽은 14날짜까지', async () => {
    const { world, seller } = await world0()
    const dates = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    for (const date of dates) {
      at(world, date, '19:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await ok(world, seller, { type: 'product.register', b, no: 1, name: '핑크프릴', price: 1000 })
      await chat(world, seller, b, `m${date}`, 'UC_A', '홍길동', '1')
    }
    // 품목 없는 날짜(방송만 연 가장 최근 날짜)는 줄도 날짜 수도 아니다
    at(world, '2026-10-20', '19:00:00')
    await createBroadcast(world, seller, { date: '2026-10-20' })
    const first = await list(world, seller)
    expect(first.orders.map((row) => row.date)).toEqual(dates.slice(1).reverse())
    expect(first.more).toBe(true)
    expect(first.next).toBe('2026-10-02')
    const second = await list(world, seller, '2026-10-02')
    expect(second.orders.map((row) => row.date)).toEqual(['2026-10-01'])
    expect(second.more).toBe(false)
  })

  it('틀린 before는 400, 로그인 없으면 401', async () => {
    const { world, seller } = await world0()
    const bad = await client(world, seller.cookie).get('/api/orders?before=2026-13-01')
    expect(bad.status).toBe(400)
    expect((bad.body.error as { problems: { field: string; message: string }[] }).problems).toEqual([{ field: 'before', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    expect((await client(world, null).get('/api/orders')).status).toBe(401)
    expect(await list(world, seller)).toEqual({ today: D1, orders: [], more: false, next: null })
  })
})

describe('D-UX4-125 주문 상세', () => {
  it('상품 줄(번호 순)·예약 시각·배송지·그날 배송비 규칙(첫 방송 스냅샷)·금액·다른 날짜 거래(이 날짜 빼고)', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    await putAddress(world, seller, D2, 'UC_A')
    const response = await detail(world, seller, D2, 'UC_A')
    expect(response.status, response.text).toBe(200)
    const d1Total = (await settlementOf(world, seller, D1, 'UC_A'))?.total
    expect(d1Total).toBe(14_000)
    expect(response.body).toEqual({
      date: D2,
      buyer: 'UC_A',
      name: '김받는',
      nickname: '홍길동',
      platform: 'YOUTUBE',
      phone: '01022223333',
      address: { address: ADDRESS.address, detail: ADDRESS.detail, zip: ADDRESS.zip },
      items: [
        { no: 2, name: '라울', price: 10000, qty: 1 },
        { no: 5, name: '방울복랑 금', price: 21000, qty: 1 },
      ],
      claimedAt: new Date(kst(D2, '20:00:10')).toISOString(),
      itemCount: 2,
      subtotal: 31_000,
      shipping: 0,
      shippingRule: { baseFee: 3000, freeThreshold: 30_000, mode: 'DEFAULT' },
      adjustments: 0,
      total: 31_000,
      received: 0,
      refundDue: 0,
      payment: 'UNPAID',
      history: { count: 1, total: 14_000, lines: [{ date: D1, buyer: 'UC_A', total: 14_000, itemCount: 1, openable: true }] },
    })
    // 직접 수령 묶음은 그 예외가 규칙 모드로
    const pickup = await expectOk(detail(world, seller, D2, 'UC_B'))
    expect(pickup.body).toMatchObject({ name: null, phone: null, address: null, shipping: 0, total: 6000, shippingRule: { baseFee: 3000, freeThreshold: 30_000, mode: 'PICKUP' } })
    expect((pickup.body.history as { count: number }).count).toBe(1)
    // 지난 날짜 상세의 거래는 뒤 날짜를 담는다 (이 날짜는 빼고)
    const past = await expectOk(detail(world, seller, D1, 'UC_A'))
    expect(past.body.history).toEqual({ count: 1, total: 31_000, lines: [{ date: D2, buyer: 'UC_A', total: 31_000, itemCount: 2, openable: true }] })
    expect(past.body.shippingRule).toEqual({ baseFee: 4000, freeThreshold: null, mode: 'DEFAULT' })
  })

  it('문자 손님: 배송지가 없으면 기억한 번호, 다른 날짜가 없으면 거래 0', async () => {
    const { world, seller } = await world0()
    const { sms } = await sell(world, seller)
    const response = await expectOk(detail(world, seller, D1, sms))
    expect(response.body).toMatchObject({
      buyer: sms,
      platform: 'SMS',
      name: null,
      phone: '01012345678',
      address: null,
      items: [{ no: 2, name: '라울', price: 5000, qty: 1 }],
      claimedAt: new Date(kst(D1, '20:01:00')).toISOString(),
      history: { count: 0, total: 0, lines: [] },
    })
  })

  it('없는 날짜·모르는 구매자·리허설은 404, 구매자를 적지 않으면 400', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    expect((await detail(world, seller, '2026-10-01', 'UC_A')).status).toBe(404)
    expect((await detail(world, seller, D1, 'UC_NOBODY')).status).toBe(404)
    expect((await detail(world, seller, D1, 'UC_A', '&rehearsal=true')).status).toBe(404)
    expect((await detail(world, seller, D1, 'UC_A', '&rehearsal=yes')).status).toBe(400)
    expect((await detail(world, seller, '2026-13-40', 'UC_A')).status).toBe(404)
    expect((await client(world, seller.cookie).get(`/api/days/${D1}/order`)).status).toBe(400)
    // 다른 판매자의 날짜는 없는 것과 같다
    const other = await addSeller(world)
    expect((await detail(world, other, D1, 'UC_A')).status).toBe(404)
    expect((await list(world, other)).orders).toEqual([])
  })
})

describe('D-UX4-125 봉인 날짜 (D-PL1-03·D-PL1-04)', () => {
  it('봉인 장부로 같은 금액·상품 줄을 보이고, 장부에 없는 예약 시각은 null', async () => {
    const { world, seller } = await scenario()
    const beforeList = await list(world, seller)
    const beforeDetail = await expectOk(detail(world, seller, A, X))
    expect(beforeDetail.body.claimedAt).not.toBeNull()
    await sealA(world)
    const afterList = await list(world, seller)
    const strip = (rows: OrderRow[]) => rows.map(({ firstClaimAt: _first, ...rest }) => rest)
    expect(strip(afterList.orders)).toEqual(expect.arrayContaining(strip(beforeList.orders)))
    expect(afterList.orders).toHaveLength(beforeList.orders.length)
    for (const row of afterList.orders) if (row.date === A) expect(row.firstClaimAt).toBeNull()
    expect(afterList.orders.filter((row) => row.date === B).every((row) => row.firstClaimAt !== null)).toBe(true)
    const afterDetail = await expectOk(detail(world, seller, A, X))
    expect({ ...afterDetail.body, claimedAt: 'x' }).toEqual({ ...beforeDetail.body, claimedAt: 'x' })
    expect(afterDetail.body.claimedAt).toBeNull()
    // 뒤 날짜 상세의 거래 줄도 봉인 장부 금액 그대로
    const later = await expectOk(detail(world, seller, B, X))
    expect((later.body.history as { lines: { date: string; total: number }[] }).lines).toEqual([expect.objectContaining({ date: A, total: beforeDetail.body.total, openable: true })])
  })
})
