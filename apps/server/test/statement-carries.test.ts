// 지난 주문 같이 보내기 (D-STMT-CARRY-01) · 정산서 배송비 바꾸기 (D-STMT-SHIP-01):
// 같은 손님의 아직 보내지 않은 지난 주문을 알리고, 같이 보내면 정산서 한 장에 지난 상품 줄 + 합친 금액으로 배송비 + 지난 날짜에 받은 돈을 뺀다(배송비 두 번 받지 않음).
// 같이 보내기는 엔진 기록을 바꾸지 않는다. 손님 배송비는 엔진 정산의 배송비 예외(주문 상세와 같은 기록)를 정산서가 그대로 따른다
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { events, statementCarryEvents } from '../src/db/schema.ts'
import { foldCarries, splitPast } from '../src/statement-carries.ts'
import { chat, ok, pack, putShop } from './i2-support.ts'
import { addSeller, client, createBroadcast, newWorld, rid, type Seller, type TestServer } from './support.ts'

const OLD = '2026-09-10'
const PAST = '2026-10-15'
const DATE = '2026-10-19'

describe('splitPast (순수)', () => {
  it('같이 보내기로 한 것 → carried, 결정 없음·뺐음이고 배송 전 → waiting, 이미 보냈어요·다른 정산서·배송 완료·30일 넘음 → 빠진다', () => {
    const refs = [
      { date: '2026-10-15', buyer: 'A' }, { date: '2026-10-14', buyer: 'A' }, { date: '2026-10-13', buyer: 'A' },
      { date: '2026-10-12', buyer: 'A' }, { date: '2026-10-11', buyer: 'A' }, { date: '2026-09-10', buyer: 'A' }, { date: '2026-10-19', buyer: 'A' },
    ]
    const decisions = foldCarries([
      { kind: 'carry', date: DATE, buyer: 'A', pastDate: '2026-10-15', pastBuyer: 'A' },
      { kind: 'carry', date: DATE, buyer: 'A', pastDate: '2026-10-14', pastBuyer: 'A' },
      { kind: 'drop', date: DATE, buyer: 'A', pastDate: '2026-10-14', pastBuyer: 'A' },
      { kind: 'sent', date: DATE, buyer: 'A', pastDate: '2026-10-13', pastBuyer: 'A' },
      { kind: 'carry', date: '2026-10-18', buyer: 'A', pastDate: '2026-10-12', pastBuyer: 'A' },
    ])
    const out = splitPast(DATE, 'A', refs, decisions, ref => ref.date === '2026-10-11')
    expect(out.carried).toEqual([{ date: '2026-10-15', buyer: 'A' }])
    expect(out.waiting).toEqual([{ date: '2026-10-14', buyer: 'A' }])
  })
})

async function sell(world: TestServer, seller: Seller) {
  const old = (await createBroadcast(world, seller, { date: OLD })).id
  await ok(world, seller, { type: 'product.register', b: old, no: 1, name: '오래된다육', price: 7000 })
  await chat(world, seller, old, 'o1', 'UC_A', '다육맘', '1')
  const past = (await createBroadcast(world, seller, { date: PAST })).id
  await ok(world, seller, { type: 'product.register', b: past, no: 1, name: '핑크프릴', price: 20000 })
  await ok(world, seller, { type: 'product.register', b: past, no: 2, name: '창금', price: 10000 })
  await chat(world, seller, past, 'p1', 'UC_A', '다육맘', '1')
  await chat(world, seller, past, 'p2', 'UC_B', '꽃님', '2')
  // 꽃님의 지난 주문은 이미 보냈다 (포장 → 배송 완료)
  expect((await pack(world, seller, PAST, { buyer: 'UC_B', action: 'pack', items: [`${past}/2`] })).status).toBe(200)
  expect((await pack(world, seller, PAST, { buyer: 'UC_B', action: 'ship' })).status).toBe(200)
  const today = (await createBroadcast(world, seller, { date: DATE })).id
  await ok(world, seller, { type: 'product.register', b: today, no: 1, name: '라울', price: 30000 })
  await ok(world, seller, { type: 'product.register', b: today, no: 2, name: '창금', price: 10000 })
  await chat(world, seller, today, 't1', 'UC_A', '다육맘', '1')
  await chat(world, seller, today, 't2', 'UC_B', '꽃님', '2')
  expect((await putShop(world, seller)).status).toBe(200)
  return today
}

interface Past { date: string; buyer: string; qty: number; subtotal: number | null; received: number; lines: { no: number; name: string; round?: string; amount: number | null }[] }
interface Carry { buyer: string; carried: Past[]; waiting: Past[] }

const carries = async (world: TestServer, seller: Seller): Promise<Carry[]> => {
  const response = await client(world, seller.cookie).get(`/api/days/${DATE}/statement-carries`)
  expect(response.status, response.text).toBe(200)
  return (response.body as { buyers: Carry[] }).buyers
}

describe('D-STMT-CARRY-01 지난 주문 같이 보내기', () => {
  it('아직 안 보낸 지난 주문을 알리고, 같이 보내면 한 장에 — 배송비는 합친 금액으로(5만 원 → 무료), 지난 날짜에 받은 돈은 뺀다. 엔진 기록은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await sell(world, seller)
    const api = client(world, seller.cookie)
    const file = async (buyer: string) => {
      const response = await api.get(`/api/broadcasts/${b}/statement/buyer/csv?buyer=${buyer}`)
      expect(response.status, response.text).toBe(200)
      return response.text
    }

    // 다육맘: 10.15 주문(2만 원)이 아직 안 보냄 — 30일 넘은 9.10 주문은 알리지 않는다. 꽃님은 배송 완료라 없다
    const before = await carries(world, seller)
    expect(before.map(row => row.buyer)).toEqual(['UC_A'])
    expect(before[0]!.carried).toEqual([])
    expect(before[0]!.waiting).toHaveLength(1)
    expect(before[0]!.waiting[0]).toMatchObject({ date: PAST, buyer: 'UC_A', qty: 1, subtotal: 20000, received: 0 })
    expect(before[0]!.waiting[0]!.lines).toMatchObject([{ no: 1, name: '핑크프릴', round: '10.15', amount: 20000 }])
    // 알리기만 — 정산서는 아직 오늘 것만 (3만 원 → 배송비 5,000원)
    expect(await file('UC_A')).toContain('총액,,1,35000')

    // 지난 주문 값 2만 원 + 배송비 5,000원을 이미 받았다
    await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: PAST, amount: 25000 }, PAST)
    const engineRows = async () => (await world.database.db.select({ id: events.id }).from(events).where(eq(events.sellerId, seller.sellerId))).length
    const engineBefore = await engineRows()
    const requestId = rid('carry')
    const carried = await api.post(`/api/days/${DATE}/statement-carries`, { requestId, kind: 'carry', buyer: 'UC_A', past: [{ date: PAST, buyer: 'UC_A' }] })
    expect(carried.status, carried.text).toBe(200)
    // 같은 요청 번호는 한 번만
    expect((await api.post(`/api/days/${DATE}/statement-carries`, { requestId, kind: 'carry', buyer: 'UC_A', past: [{ date: PAST, buyer: 'UC_A' }] })).status).toBe(200)
    expect(await world.database.db.select().from(statementCarryEvents).where(eq(statementCarryEvents.sellerId, seller.sellerId))).toHaveLength(1)
    const after = (carried.body as { buyers: Carry[] }).buyers
    expect(after[0]!.carried[0]).toMatchObject({ date: PAST, received: 25000, subtotal: 20000 })
    expect(after[0]!.waiting).toEqual([])

    const one = await file('UC_A')
    expect(one).toContain('1번,라울,1,30000')
    expect(one).toContain('10.15 1번,핑크프릴,1,20000')
    expect(one).toContain('상품 금액,,50000')
    expect(one).toContain('배송비,,무료')
    expect(one).toContain('지난 주문에서 받은 돈,,−25000')
    expect(one).toContain('총액,,2,25000')
    expect(await engineRows()).toBe(engineBefore)

    // 빼면 다시 알림으로, 이미 보냈어요면 알리지 않는다
    const dropped = await api.post(`/api/days/${DATE}/statement-carries`, { requestId: rid(), kind: 'drop', buyer: 'UC_A', past: [{ date: PAST, buyer: 'UC_A' }] })
    expect((dropped.body as { buyers: Carry[] }).buyers[0]!.waiting).toHaveLength(1)
    expect(await file('UC_A')).toContain('총액,,1,35000')
    const sent = await api.post(`/api/days/${DATE}/statement-carries`, { requestId: rid(), kind: 'sent', buyer: 'UC_A', past: [{ date: PAST, buyer: 'UC_A' }] })
    expect((sent.body as { buyers: Carry[] }).buyers).toEqual([])

    // 잘못된 입력: 오늘 이후 날짜·빈 목록·모르는 종류
    expect((await api.post(`/api/days/${DATE}/statement-carries`, { requestId: rid(), kind: 'carry', buyer: 'UC_A', past: [{ date: DATE, buyer: 'UC_A' }] })).status).toBe(400)
    expect((await api.post(`/api/days/${DATE}/statement-carries`, { requestId: rid(), kind: 'carry', buyer: 'UC_A', past: [] })).status).toBe(400)
    expect((await api.post(`/api/days/${DATE}/statement-carries`, { requestId: rid(), kind: 'mix', buyer: 'UC_A', past: [{ date: PAST, buyer: 'UC_A' }] })).status).toBe(400)
    expect((await api.get(`/api/days/${DATE}/statement-carries?rehearsal=true`)).body).toEqual({ buyers: [] })
  })
})

describe('D-STMT-SHIP-01 정산서 배송비 바꾸기', () => {
  it('손님 배송비를 따로 정하면(엔진 배송비 예외) 정산서 파일도 그 값, 되돌리면 규칙대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await sell(world, seller)
    const api = client(world, seller.cookie)
    const file = async () => (await api.get(`/api/broadcasts/${b}/statement/buyer/csv?buyer=UC_B`)).text
    expect(await file()).toContain('배송비,,5000')
    await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_B', date: DATE, mode: 'FIXED', amountText: '6000' }, DATE)
    expect(await file()).toContain('배송비,,6000')
    expect(await file()).toContain('총액,,1,16000')
    await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_B', date: DATE, mode: 'FIXED', amountText: '0' }, DATE)
    expect(await file()).toContain('배송비,,무료')
    await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_B', date: DATE, mode: 'DEFAULT' }, DATE)
    expect(await file()).toContain('총액,,1,15000')
  })
})
