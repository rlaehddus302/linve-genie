// 정산서 손님 합치기 (D-STMT-JOIN-01): 닉네임은 다르지만 휴대폰 번호가 같은 구매자는 정산서 한 장으로 저절로 묶고, 판매자가 고른 구매자도 묶거나 나눈다.
// 엔진 기록은 바뀌지 않는다. 구매자 한 명 정산서 파일(D-STMT-EACH-01)도 같은 묶음을 따른다
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { events, statementBuyerEvents } from '../src/db/schema.ts'
import { resolveJoins } from '../src/statement-joins.ts'
import { chat, ok, putShop } from './i2-support.ts'
import { addSeller, client, createBroadcast, newWorld, rid, type Seller, type TestServer } from './support.ts'

const DATE = '2026-10-19'

describe('resolveJoins (순수)', () => {
  it('판매자가 묶은 구매자 → 손대지 않은 구매자 가운데 같은 번호. 대표는 번호를 아는 구매자', () => {
    const phones = new Map([['a', '01011112222'], ['b', '01011112222'], ['c', '01033334444'], ['e', '01055556666']])
    expect(resolveJoins(['a', 'b', 'c', 'd'], new Map(), phones)).toEqual([{ buyers: ['a', 'b'], auto: true }])
    // 판매자가 b를 혼자 두면 저절로 묶지 않는다, d·c를 묶으면 번호를 아는 c가 대표
    const links = new Map([['b', 'solo:b'], ['d', 'j1'], ['c', 'j1']])
    expect(resolveJoins(['a', 'b', 'c', 'd'], links, phones)).toEqual([{ buyers: ['c', 'd'], auto: false }])
    // 정산서에 없는 구매자는 빠지고, 한 명만 남은 묶음은 없다
    expect(resolveJoins(['a', 'e'], new Map(), phones)).toEqual([])
  })
})

async function setup(world: TestServer, seller: Seller) {
  const b = (await createBroadcast(world, seller, { date: DATE })).id
  await ok(world, seller, { type: 'product.register', b, no: 1, name: '핑크프릴', price: 20000 })
  await ok(world, seller, { type: 'product.register', b, no: 2, name: '라울', price: 30000 })
  await ok(world, seller, { type: 'product.register', b, no: 3, name: '창금', price: 10000 })
  await chat(world, seller, b, 'm1', 'UC_A', '구제불능', '1')
  await chat(world, seller, b, 'm2', 'UC_B', '구제불능2', '2')
  await chat(world, seller, b, 'm3', 'UC_C', '나래', '3')
  expect((await putShop(world, seller)).status).toBe(200)
  return b
}

const remember = async (world: TestServer, seller: Seller, buyer: string, phone: string) => {
  const response = await client(world, seller.cookie).post(`/api/days/${DATE}/receipt-sms/prepare`, { requestId: rid('rs'), buyer, phone })
  expect(response.status, response.text).toBe(200)
}
const joins = async (world: TestServer, seller: Seller) => {
  const response = await client(world, seller.cookie).get(`/api/days/${DATE}/statement-joins`)
  expect(response.status, response.text).toBe(200)
  return (response.body as { groups: { buyers: string[]; auto: boolean }[] }).groups
}

describe('D-STMT-JOIN-01 정산서 손님 합치기', () => {
  it('같은 번호면 저절로 한 장 — 엑셀/CSV도 한 줄, 배송비는 합친 금액으로 한 번. 엔진 기록은 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const api = client(world, seller.cookie)
    expect(await joins(world, seller)).toEqual([])
    await remember(world, seller, 'UC_A', '010-1111-2222')
    await remember(world, seller, 'UC_B', '01011112222')
    await remember(world, seller, 'UC_C', '010-9999-0000')
    const engineRows = async () => (await world.database.db.select({ id: events.id }).from(events).where(eq(events.sellerId, seller.sellerId))).length
    const before = await engineRows()
    const groups = await joins(world, seller)
    expect(groups).toEqual([{ buyers: ['UC_A', 'UC_B'], auto: true }])
    // 번호 원문은 응답에 없다
    expect(JSON.stringify(groups)).not.toContain('1111')

    const buyers = (await api.get(`/api/broadcasts/${b}/statement/buyers/csv`)).text
    expect(buyers).toContain('구제불능 · 구제불능2,50000,2')
    expect(buyers).toContain('나래,10000,1')
    expect(buyers).toContain('총계,60000,3')
    // 한 사람 정산서 파일: 두 닉네임의 상품이 한 장에, 5만 원 이상이라 배송비 무료(기본 규칙)
    const one = await api.get(`/api/broadcasts/${b}/statement/buyer/csv?buyer=UC_A`)
    expect(one.status, one.text).toBe(200)
    expect(one.text).toContain('구제불능 · 구제불능2 님')
    expect(one.text).toContain('1번,핑크프릴,1,20000')
    expect(one.text).toContain('2번,라울,1,30000')
    expect(one.text).toContain('배송비,,무료')
    expect(one.text).toContain('총액,,2,50000')
    // 묶음에 들어간 다른 구매자 키로는 따로 정산서가 없다
    expect((await api.get(`/api/broadcasts/${b}/statement/buyer/csv?buyer=UC_B`)).status).toBe(404)
    // 혼자인 손님은 5만 원 미만이라 배송비 5,000원
    const solo = (await api.get(`/api/broadcasts/${b}/statement/buyer/csv?buyer=UC_C`)).text
    expect(solo).toContain('배송비,,5000')
    expect(solo).toContain('총액,,1,15000')
    expect((await api.get(`/api/broadcasts/${b}/statement/buyer/xlsx?buyer=UC_C`)).status).toBe(200)
    expect(await engineRows()).toBe(before)
  })

  it('판매자가 고른 구매자를 합치고 나누면 기록대로, 같은 요청 번호는 한 번만. 나눈 손님은 번호가 같아도 저절로 묶지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await setup(world, seller)
    const api = client(world, seller.cookie)
    const requestId = rid()
    const joined = await api.post(`/api/days/${DATE}/statement-joins`, { requestId, kind: 'join', buyers: ['UC_C', 'UC_A'] })
    expect(joined.status, joined.text).toBe(200)
    expect(joined.body).toEqual({ groups: [{ buyers: ['UC_A', 'UC_C'], auto: false }] })
    expect((await api.post(`/api/days/${DATE}/statement-joins`, { requestId, kind: 'join', buyers: ['UC_C', 'UC_A'] })).status).toBe(200)
    expect(await world.database.db.select().from(statementBuyerEvents).where(eq(statementBuyerEvents.sellerId, seller.sellerId))).toHaveLength(1)

    await remember(world, seller, 'UC_A', '010-1111-2222')
    await remember(world, seller, 'UC_B', '010-1111-2222')
    // UC_A는 판매자가 묶어 둬서 UC_B와 저절로 묶이지 않는다
    expect(await joins(world, seller)).toEqual([{ buyers: ['UC_A', 'UC_C'], auto: false }])
    const apart = await api.post(`/api/days/${DATE}/statement-joins`, { requestId: rid(), kind: 'apart', buyers: ['UC_A', 'UC_C'] })
    expect(apart.body).toEqual({ groups: [] })
    // 잘못된 입력
    expect((await api.post(`/api/days/${DATE}/statement-joins`, { requestId: rid(), kind: 'join', buyers: ['UC_A'] })).status).toBe(400)
    expect((await api.post(`/api/days/${DATE}/statement-joins`, { requestId: rid(), kind: 'mix', buyers: ['UC_A', 'UC_B'] })).status).toBe(400)
  })
})
