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
  missing: string[]
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
async function sell(world: TestServer, seller: Seller): Promise<{ sms: string; b1: string; b2: string }> {
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
  return { sms, b1, b2 }
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
    // D-UX4-126: 줄에 모르는 손님 정보(missing)가 더해졌다 — 배송지가 있으면 빈 목록
    expect(a2).toEqual({ date: D2, buyer: 'UC_A', name: '김받는', nickname: '홍길동', platform: 'YOUTUBE', total: 31_000, itemCount: 2, firstClaimAt: new Date(kst(D2, '20:00:10')).toISOString(), missing: [] })
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
    const { b2 } = await sell(world, seller)
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
        { no: 2, name: '라울', price: 10000, qty: 1, b: b2, options: null },
        { no: 5, name: '방울복랑 금', price: 21000, qty: 1, b: b2, options: null },
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

  it('D-PASS-01 [상품 빼기]: 상품 줄의 방송 ID로 방송자 취소(손님 패스)를 보내면 그 줄만 빠지고 합계·배송비가 다시 정해진다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    const before = (await expectOk(detail(world, seller, D2, 'UC_A'))).body as unknown as { items: { no: number; b: string; options: null }[]; total: number }
    const target = before.items.find((item) => item.no === 2)
    expect(target).toBeDefined()
    await ok(world, seller, { type: 'host.cancel', b: target?.b, no: 2, buyer: 'UC_A', reason: '손님 패스' })
    const after = (await expectOk(detail(world, seller, D2, 'UC_A'))).body as unknown as { items: { no: number }[]; subtotal: number; shipping: number; total: number }
    expect(after.items.map((item) => item.no)).toEqual([5])
    // 31,000원(무료) → 21,000원 + 배송비 3,000원
    expect([after.subtotal, after.shipping, after.total]).toEqual([21_000, 3000, 24_000])
  })

  it('문자 손님: 배송지가 없으면 기억한 번호, 다른 날짜가 없으면 거래 0', async () => {
    const { world, seller } = await world0()
    const { sms, b1 } = await sell(world, seller)
    const response = await expectOk(detail(world, seller, D1, sms))
    expect(response.body).toMatchObject({
      buyer: sms,
      platform: 'SMS',
      name: null,
      phone: '01012345678',
      address: null,
      items: [{ no: 2, name: '라울', price: 5000, qty: 1, b: b1, options: null }],
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
    // D-UX4-126: 봉인(30일 뒤)이면 배송지 보관 기간도 지나 missing은 빈 목록이 된다 — 비교에서 빼고 따로 본다
    const strip = (rows: OrderRow[]) => rows.map(({ firstClaimAt: _first, missing: _missing, ...rest }) => rest)
    expect(strip(afterList.orders)).toEqual(expect.arrayContaining(strip(beforeList.orders)))
    expect(afterList.orders).toHaveLength(beforeList.orders.length)
    for (const row of afterList.orders) if (row.date === A) expect(row.firstClaimAt).toBeNull()
    expect(afterList.orders.filter((row) => row.date === A).every((row) => row.missing.length === 0)).toBe(true)
    expect(afterList.orders.filter((row) => row.date === B).every((row) => row.firstClaimAt !== null)).toBe(true)
    const afterDetail = await expectOk(detail(world, seller, A, X))
    expect({ ...afterDetail.body, claimedAt: 'x' }).toEqual({ ...beforeDetail.body, claimedAt: 'x' })
    expect(afterDetail.body.claimedAt).toBeNull()
    // 뒤 날짜 상세의 거래 줄도 봉인 장부 금액 그대로
    const later = await expectOk(detail(world, seller, B, X))
    expect((later.body.history as { lines: { date: string; total: number }[] }).lines).toEqual([expect.objectContaining({ date: A, total: beforeDetail.body.total, openable: true })])
  })
})

describe('D-UX4-126 주문 목록의 모르는 손님 정보', () => {
  it('성함·휴대폰 번호·주소 순: 배송지가 있으면 빈 목록, 문자 손님은 번호를 알아 성함·주소만, 채팅 손님은 셋 다', async () => {
    const { world, seller } = await world0()
    const { sms } = await sell(world, seller)
    await putAddress(world, seller, D1, 'UC_A')
    const rows = (await list(world, seller)).orders
    const row = (date: string, buyer: string) => rows.find((item) => item.date === date && item.buyer === buyer)
    expect(row(D1, 'UC_A')?.missing).toEqual([])
    expect(row(D1, sms)?.missing).toEqual(['name', 'address'])
    expect(row(D1, 'UC_B')?.missing).toEqual(['name', 'phone', 'address'])
    expect(row(D2, 'UC_A')?.missing).toEqual(['name', 'phone', 'address'])
    // 배송지 보관 기간(30일)이 지난 날짜는 더 넣을 수 없으니 묻지 않는다
    at(world, '2026-11-17', '09:00:00')
    const later = (await list(world, seller)).orders
    expect(later.filter((item) => item.date === D1).map((item) => item.missing)).toEqual([[], [], []])
    expect(later.find((item) => item.date === D2 && item.buyer === 'UC_B')?.missing).toEqual(['name', 'phone', 'address'])
  })
})

describe('D-UX4-126 주문 한 건 내보내기', () => {
  const file = (world: TestServer, seller: Seller, ext: 'csv' | 'xlsx', date: string, buyer: string, query = '') =>
    client(world, seller.cookie).raw(`/api/days/${date}/order.${ext}?buyer=${encodeURIComponent(buyer)}${query}`, {})

  it('CSV: BOM·CRLF, 위 묶음·상품 표·금액, 휴대폰 번호·주소는 없다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    await putAddress(world, seller, D2, 'UC_A')
    await ok(world, seller, { type: 'settlement.adjust', buyer: 'UC_A', date: D2, amount: -1000, reason: '할인' }, D2)
    const response = await file(world, seller, 'csv', D2, 'UC_A')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="order-${D2}.csv"; filename*=UTF-8''${encodeURIComponent(`주문-${D2}-홍길동.csv`)}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes.slice(3))
    // D-UX4-127: 표에 개수 칸·총합·총 결제금액 (사용자 지시 2026-11-11)
    expect(text).toBe(
      [
        '닉네임,홍길동',
        '성함,김받는',
        '예약 날짜,2026년 10월 19일 월요일',
        '',
        '번호,상품명,개수,가격',
        '2,라울,1,"10,000원"',
        '5,방울복랑 금,1,"21,000원"',
        '총합,,2개,"31,000원"',
        // D-UX4-128: 규칙 글은 따로 칸이 아니라 이름표 괄호 안 (옛 '배송비,"30,000원 이상 구매 시 무료",,0원')
        '"배송비(30,000원 이상 구매 시 무료배송)",,,0원',
        '할인·추가,,,"−1,000원"',
        '총 결제금액,,,"30,000원"',
        '',
        '입금',
        '받은 금액,,,0원',
        '남은 금액,,,"30,000원"',
        '',
      ].join('\r\n'),
    )
    expect(text).not.toContain('2222')
    expect(text).not.toContain(ADDRESS.address)
    expect(text).not.toContain(ADDRESS.zip)
  })

  it('CSV: 수식으로 읽히는 닉네임·상품명은 앞에 \'를 붙이고, 성함을 모르면 모름', async () => {
    const { world, seller } = await world0()
    at(world, D1, '19:00:00')
    const b = (await createBroadcast(world, seller, { date: D1 })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '=HYPERLINK("x")', price: 1000 })
    at(world, D1, '20:00:00')
    await chat(world, seller, b, 'm1', 'UC_EVIL', '=SUM(1,2)', '1')
    const response = await file(world, seller, 'csv', D1, 'UC_EVIL')
    expect(response.status).toBe(200)
    const lines = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(3)).split('\r\n')
    expect(lines[0]).toBe(`닉네임,"'=SUM(1,2)"`)
    expect(lines[1]).toBe('성함,모름')
    expect(lines[5]).toBe(`1,"'=HYPERLINK(""x"")",1,"1,000원"`)
  })

  it('엑셀: xlsx 형식으로 같은 줄을 글 칸에, 휴대폰 번호·주소는 없다', async () => {
    const { world, seller } = await world0()
    const { sms } = await sell(world, seller)
    const response = await file(world, seller, 'xlsx', D1, sms)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('content-disposition')).toContain(`filename="order-${D1}.xlsx"`)
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ArrayBuffer)
    const sheet = workbook.worksheets[0]
    expect(sheet?.name).toBe('주문')
    const values: string[][] = []
    sheet?.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = []
      for (let i = 1; i <= 4; i += 1) cells.push(row.getCell(i).text)
      values.push(cells)
    })
    expect(values[0]).toEqual(['항목', '내용', '', ''])
    expect(values[1]?.[0]).toBe('닉네임')
    expect(values[2]).toEqual(['성함', '모름', '', ''])
    // D-UX4-127: 표에 개수 칸·총합·총 결제금액 (사용자 지시 2026-11-11)
    expect(values[3]).toEqual(['예약 날짜', '2026년 10월 18일 일요일', '', ''])
    expect(values[5]).toEqual(['번호', '상품명', '개수', '가격'])
    expect(values[6]).toEqual(['2', '라울', '1', '5,000원'])
    expect(values.flat()).toContain('남은 금액')
    expect(values.flat().join(' ')).not.toContain('5678')
  })

  it('D-UX4-127 상품 바로 아래 총합(개수·상품 합계), 배송비는 왼쪽에 그날 규칙 글, 총 결제금액, 빈 줄 뒤 입금 묶음', async () => {
    // D-UX4-127: 표에 개수 칸·총합·총 결제금액 (사용자 지시 2026-11-11)
    const { world, seller } = await world0()
    await sell(world, seller)
    const linesOf = async (date: string, buyer: string) => new TextDecoder().decode(new Uint8Array(await (await file(world, seller, 'csv', date, buyer)).arrayBuffer()).slice(3)).split('\r\n')
    // D2 홍길동: 21,000 + 10,000 = 31,000 ≥ 무료 기준 30,000 → 배송비 0
    const free = await linesOf(D2, 'UC_A')
    expect(free.slice(4)).toEqual([
      '번호,상품명,개수,가격',
      '2,라울,1,"10,000원"',
      '5,방울복랑 금,1,"21,000원"',
      '총합,,2개,"31,000원"',
      // D-UX4-128: 규칙 글은 이름표 괄호 안
      '"배송비(30,000원 이상 구매 시 무료배송)",,,0원',
      '총 결제금액,,,"31,000원"',
      '',
      '입금',
      '받은 금액,,,0원',
      '남은 금액,,,"31,000원"',
      '',
    ])
    expect(free.some((line) => line.startsWith('총 개수') || line.startsWith('총 금액') || line.startsWith('할인·추가'))).toBe(false)
    // D1 홍길동: 무료 기준이 없는 날 → 기본 배송비 4,000원이 붙고 총 결제금액에 더해진다 (D-UX4-128: 이름표는 그냥 "배송비", 옛 규칙 글 칸 "기본 배송비 4,000원" 없음)
    const paid = await linesOf(D1, 'UC_A')
    expect(paid[2]).toBe('예약 날짜,2026년 10월 18일 일요일')
    expect(paid.slice(6, 9)).toEqual(['총합,,1개,"10,000원"', '배송비,,,"4,000원"', '총 결제금액,,,"14,000원"'])
    // D2 나래: 직접 수령이어도 이름표에는 그 말 없이 가게 무료 기준만 (D-UX4-128 '배송비(직접 수령)' → D-UX4-129 "이 주문만 정함 뭐 이런 말은 안 적어도 돼")
    const pickup = await linesOf(D2, 'UC_B')
    expect(pickup).toContain('"배송비(30,000원 이상 구매 시 무료배송)",,,0원')
    expect(pickup).toContain('총 결제금액,,,"6,000원"')
  })

  it('상세와 같은 검사: 모르는 구매자·없는 날짜·리허설은 404, 구매자를 적지 않으면 400, 로그인 없으면 401', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    for (const ext of ['csv', 'xlsx'] as const) {
      expect((await file(world, seller, ext, D1, 'UC_NOBODY')).status).toBe(404)
      expect((await file(world, seller, ext, '2026-10-01', 'UC_A')).status).toBe(404)
      expect((await file(world, seller, ext, '2026-13-40', 'UC_A')).status).toBe(404)
      expect((await file(world, seller, ext, D1, 'UC_A', '&rehearsal=true')).status).toBe(404)
      expect((await client(world, seller.cookie).get(`/api/days/${D1}/order.${ext}`)).status).toBe(400)
      expect((await client(world, null).raw(`/api/days/${D1}/order.${ext}?buyer=UC_A`, {})).status).toBe(401)
    }
    // 상세 경로는 그대로 JSON
    const json = await detail(world, seller, D1, 'UC_A')
    expect(json.status).toBe(200)
    expect(json.body.buyer).toBe('UC_A')
  })
})
