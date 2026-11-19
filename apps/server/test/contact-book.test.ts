// 판매자가 적은 손님 연락처 (D-CONTACT-01, 사용자 지시 2026-11-20 "전화기록부처럼 같은 번호면 같은 사람 … 같은 사람 정보 입력 두 번 안 하게"):
// 판매자가 한 번 적은 성함·번호·주소는 같은 계정·같은 번호의 다음 주문에 이어진다(보이기만 — 택배는 [배송지 확인]), 번호 전체가 같을 때만, 판매자가 적은 값은 덮지 않는다.
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { onlyKey } from '../src/customers/contact-book.ts'
import { at, chat, kst, ok } from './i2-support.ts'
import { tempDirs } from './pl1a-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, rid, type Seller, type TestServer } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const D1 = '2026-10-18'
const D2 = '2026-10-19'
const KIM = { name: '김받는', phone: '010-2222-3333', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '' }

interface Bundle {
  address: { name: string } | null
  ledger: { ledgerId: string; updatedAt: string; name: string; phone: string; address: string; detail: string; zip: string } | null
}

async function world0(): Promise<{ world: TestServer; seller: Seller }> {
  const world = await newWorld({ clock: fakeClock(kst(D1, '09:00:00')) })
  return { world, seller: await addSeller(world) }
}

const detail = async (world: TestServer, seller: Seller, date: string, buyer: string) => (await expectOk(client(world, seller.cookie).get(`/api/days/${date}/order?buyer=${encodeURIComponent(buyer)}`))).body
const rows = async (world: TestServer, seller: Seller) => (await expectOk(client(world, seller.cookie).get('/api/orders'))).body.orders as { date: string; buyer: string; name: string | null; missing: string[] }[]
const bundle = async (world: TestServer, seller: Seller, date: string, buyer: string) =>
  (await expectOk(client(world, seller.cookie).get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`))).body.bundle as unknown as Bundle
const write = async (world: TestServer, seller: Seller, date: string, buyer: string, address = KIM) =>
  expectOk(client(world, seller.cookie).put(`/api/parcels/days/${date}/address`, { requestId: rid('pa'), buyer, address }))
const lookup = (world: TestServer, seller: Seller, phone: unknown) => client(world, seller.cookie).post('/api/contacts/lookup', { phone })

/** D1: 유튜브 홍길동(UC_A)·문자찜 손님(010-1234-5678) · D2: 홍길동·같은 번호의 문자찜·유튜브 나래(UC_B) */
async function sell(world: TestServer, seller: Seller): Promise<{ sms1: string; sms2: string }> {
  at(world, D1, '19:00:00')
  const b1 = (await createBroadcast(world, seller, { date: D1, title: '1부' })).id
  await ok(world, seller, { type: 'product.register', b: b1, no: 1, name: '핑크프릴', price: 10000 })
  await ok(world, seller, { type: 'product.register', b: b1, no: 2, name: '라울', price: 5000 })
  at(world, D1, '20:00:05')
  await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '1')
  const sms1 = String((await ok(world, seller, { type: 'sms', b: b1, no: 2, phone: '010-1234-5678' })).body.buyer)
  at(world, D2, '19:00:00')
  const b2 = (await createBroadcast(world, seller, { date: D2, title: '1부' })).id
  await ok(world, seller, { type: 'product.register', b: b2, no: 1, name: '황금사', price: 6000 })
  await ok(world, seller, { type: 'product.register', b: b2, no: 2, name: '라울', price: 5000 })
  await ok(world, seller, { type: 'product.register', b: b2, no: 3, name: '블루엘프', price: 8000 })
  at(world, D2, '20:00:05')
  await chat(world, seller, b2, 'm2', 'UC_A', '홍길동', '1')
  const sms2 = String((await ok(world, seller, { type: 'sms', b: b2, no: 2, phone: '010-1234-5678' })).body.buyer)
  await chat(world, seller, b2, 'm3', 'UC_B', '나래', '3')
  return { sms1, sms2 }
}

describe('D-CONTACT-01 같은 손님 연락처', () => {
  it('판매자가 적은 성함·번호·주소가 같은 계정의 다음 주문에 이어진다 — 보이기만, [배송지 확인]으로 저장하면 그 날짜 배송지가 앞선다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    // 아직 아무것도 모른다
    expect((await rows(world, seller)).find((row) => row.date === D2 && row.buyer === 'UC_A')?.missing).toEqual(['name', 'phone', 'address'])
    await write(world, seller, D1, 'UC_A')
    const before = await detail(world, seller, D2, 'UC_A')
    expect(before).toMatchObject({ name: '김받는', phone: '01022223333', address: { address: KIM.address, detail: KIM.detail, zip: KIM.zip }, remembered: true })
    const row = (await rows(world, seller)).find((item) => item.date === D2 && item.buyer === 'UC_A')
    expect(row).toMatchObject({ name: '김받는', missing: [] })
    // 다른 손님(나래)에게는 붙지 않는다
    expect(await detail(world, seller, D2, 'UC_B')).toMatchObject({ name: null, phone: null, address: null, remembered: false })
    // 택배 묶음: 저장한 배송지는 없고 "확인 전"(지난 주문 배송지)으로 보인다 — 연락처 ID만, 번호 키는 없다
    const shown = await bundle(world, seller, D2, 'UC_A')
    expect(shown.address).toBeNull()
    expect(shown.ledger).toMatchObject({ name: '김받는', phone: '01022223333', address: KIM.address })
    expect(shown.ledger?.ledgerId).toMatch(/^bk_[0-9a-f]{32}$/)
    expect(JSON.stringify(shown)).not.toContain('phoneKey')
    // [배송지 확인] → 그 날짜 배송지(판매자가 적음·확인함)
    const confirm = await expectOk(client(world, seller.cookie).post(`/api/parcels/days/${D2}/address/ledger`, { requestId: rid('lg'), buyer: 'UC_A', ledgerId: shown.ledger?.ledgerId, updatedAt: shown.ledger?.updatedAt }))
    expect((confirm.body.bundle as Bundle).address?.name).toBe('김받는')
    expect(await detail(world, seller, D2, 'UC_A')).toMatchObject({ name: '김받는', remembered: false })
  })

  it('판매자가 그 날짜에 적은 값은 덮지 않는다 — 새로 적으면 그 번호의 연락처가 새 값으로 바뀐다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    await write(world, seller, D1, 'UC_A')
    await write(world, seller, D2, 'UC_A', { ...KIM, address: '부산광역시 해운대구 센텀중앙로 79', detail: '', zip: '' })
    expect(await detail(world, seller, D2, 'UC_A')).toMatchObject({ address: { address: '부산광역시 해운대구 센텀중앙로 79' }, remembered: false })
    // D1은 그날 적은 그대로
    expect(await detail(world, seller, D1, 'UC_A')).toMatchObject({ address: { address: KIM.address }, remembered: false })
    // 같은 번호 찾기는 마지막에 적은 값
    expect((await expectOk(lookup(world, seller, '010-2222-3333'))).body.contact).toEqual({ name: '김받는', address: '부산광역시 해운대구 센텀중앙로 79', detail: '', zip: '' })
  })

  it('문자찜 손님은 같은 휴대폰 번호면 다른 날짜에도 같은 손님', async () => {
    const { world, seller } = await world0()
    const { sms1, sms2 } = await sell(world, seller)
    expect(sms1).not.toBe(sms2)
    await write(world, seller, D1, sms1, { ...KIM, name: '박문자', phone: '010-1234-5678' })
    expect(await detail(world, seller, D2, sms2)).toMatchObject({ name: '박문자', phone: '01012345678', address: { address: KIM.address }, remembered: true })
    expect((await bundle(world, seller, D2, sms2)).ledger).toMatchObject({ name: '박문자' })
  })

  it('번호로 찾기: 번호 전체가 같을 때만 — 끝자리만 같은 번호·휴대폰 번호가 아닌 것은 없음, 틀린 본문은 400', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    await write(world, seller, D1, 'UC_A')
    expect((await expectOk(lookup(world, seller, '01022223333'))).body.contact).toEqual({ name: '김받는', address: KIM.address, detail: KIM.detail, zip: KIM.zip })
    expect((await expectOk(lookup(world, seller, '010-9999-3333'))).body.contact).toBeNull()
    expect((await expectOk(lookup(world, seller, '02-123-4567'))).body.contact).toBeNull()
    expect((await lookup(world, seller, 1234)).status).toBe(400)
    expect((await client(world, seller.cookie).post('/api/contacts/lookup', { phone: '01022223333', more: 1 })).status).toBe(400)
    // 다른 가게에는 없다
    const other = await addSeller(world)
    expect((await expectOk(lookup(world, other, '01022223333'))).body.contact).toBeNull()
    expect((await client(world, null).post('/api/contacts/lookup', { phone: '01022223333' })).status).toBe(401)
  })

  it('새 계정에 같은 번호를 적으면 그 계정도 그 번호에 이어진다', async () => {
    const { world, seller } = await world0()
    await sell(world, seller)
    await write(world, seller, D1, 'UC_A')
    // 나래(UC_B)가 같은 사람이라 판매자가 같은 번호로 적었다 — 다음 날짜에 나래도 이어진다
    await write(world, seller, D2, 'UC_B')
    at(world, '2026-10-20', '19:00:00')
    const b3 = (await createBroadcast(world, seller, { date: '2026-10-20' })).id
    await ok(world, seller, { type: 'product.register', b: b3, no: 1, name: '핑크프릴', price: 10000 })
    await chat(world, seller, b3, 'm9', 'UC_B', '나래', '1')
    expect(await detail(world, seller, '2026-10-20', 'UC_B')).toMatchObject({ name: '김받는', phone: '01022223333', remembered: true })
  })
})

describe('D-CONTACT-01 하나로 정해질 때만', () => {
  it('연락처가 있는 번호가 정확히 하나일 때만 그 번호', () => {
    const has = (key: string) => key === 'a' || key === 'b'
    expect(onlyKey(['a'], has)).toBe('a')
    expect(onlyKey(['a', 'a', 'x'], has)).toBe('a')
    expect(onlyKey(['a', 'b'], has)).toBeNull()
    expect(onlyKey(['x'], has)).toBeNull()
    expect(onlyKey([], has)).toBeNull()
  })
})
