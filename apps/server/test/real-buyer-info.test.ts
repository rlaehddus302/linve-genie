// 방송 뒤 손님 정보 문자 (ORD-14, D-REAL-11): 닉네임·성함·주소 문자를 읽어 7일 안 실제 방송 손님과 맞추고,
// 하나면 번호·"확인 전" 손님 배송지로 바로 넣고, 아니면 카드로 판매자가 고른다. 본문·번호·주소는 DB에 원문으로 없다.
import { describe, expect, it } from 'vitest'
import { BUYER_INFO_MESSAGES, type BuyerInfoCardView } from '../src/inbox/buyer-info-service.ts'
import { readBuyerInfo } from '../src/inbox/buyer-info.ts'
import { chat } from './i2-support.ts'
import { SMS3_DAY, inboxWorld, liveSale, sms, statuses } from './sms3-support.ts'
import { client, dumpAllTables, expectOk, rid, writeEvent, type Seller, type TestServer } from './support.ts'

describe('ORD-14 손님 정보 문자 읽기', () => {
  it('꼬리표 있는 문자', () => {
    expect(readBuyerInfo('닉네임: 길동이\n성함: 홍길동\n주소: 서울시 강남구 테헤란로 12 3층\n연락처 010-1234-5678')).toEqual({
      nickname: '길동이',
      name: '홍길동',
      words: [],
      phone: '01012345678',
      address: '서울시 강남구 테헤란로 12',
      detail: '3층',
    })
  })

  it('꼬리표 없는 문자: 주소 앞 조각은 닉네임·이름 후보, 번지 뒤는 상세 주소', () => {
    const read = readBuyerInfo('나래 / 김나래 / 부산 해운대구 우동 1408-3 101동 1203호')
    expect(read).toMatchObject({ nickname: null, name: null, phone: null, address: '부산 해운대구 우동 1408-3', detail: '101동 1203호' })
    expect(read?.words).toEqual(['나래', '김나래'])
    const oneLine = readBuyerInfo('초록이 이영희입니다 경기도 수원시 팔달구 효원로 299, 102호')
    expect(oneLine).toMatchObject({ address: '경기도 수원시 팔달구 효원로 299', detail: '102호' })
    expect(oneLine?.words).toContain('이영희')
    expect(readBuyerInfo('주소\n충청남도 공주시 우성면 증산리 1034\n받는분 박민수')).toMatchObject({ name: '박민수', address: '충청남도 공주시 우성면 증산리 1034', detail: '' })
  })

  it('주소가 없으면 손님 정보 문자가 아니다 (찜·잡담·번호만)', () => {
    for (const text of ['15번 주세요', '역삼동 5번 주세요', '감사합니다 사장님', '홍길동 010-1234-5678', '강남구 사는 길동이에요']) expect(readBuyerInfo(text), text).toBeNull()
  })
})

async function setup(world: TestServer, seller: Seller): Promise<{ b: string; smsBuyer: string }> {
  const sale = await liveSale(world, seller, [1, 2, 3, 4])
  const smsClaim = await expectOk(writeEvent(world, seller, { type: 'sms', b: sale.id, no: 1, phone: '010-1234-5678' }))
  await chat(world, seller, sale.id, 'm2', 'UC_NARAE', '나래', '2')
  await chat(world, seller, sale.id, 'm3', 'UC_GREEN1', '초록이', '3')
  await chat(world, seller, sale.id, 'm4', 'UC_GREEN2', '초록이', '4')
  return { b: sale.id, smsBuyer: String(smsClaim.body.buyer) }
}

const list = async (world: TestServer, seller: Seller) => (await expectOk(client(world, seller.cookie).get('/api/buyer-info'))).body as { cards: BuyerInfoCardView[]; buyers: { date: string; buyer: string; label: string }[] }
const bundle = async (world: TestServer, seller: Seller, buyer: string) => {
  const outcome = await world.server.parcels.bundle(seller.sellerId, SMS3_DAY, buyer)
  if (outcome.kind !== 'ok') throw new Error(outcome.kind)
  return outcome.value
}

describe('ORD-14 손님 정보 문자 받기', () => {
  it('방송이 끝난 뒤: 닉네임으로 하나면 바로 넣는다 — 번호 기억, 배송지는 "확인 전" 손님 배송지. 원문은 DB에 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    const { b } = await setup(world, seller)
    await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') }))
    world.clock.advance(60 * 60_000)
    expect(await statuses(world, token, [sms('i1', '010-5555-7777', '닉네임 나래\n성함 김나래\n주소 부산 해운대구 우동 1408-3 101동 1203호')])).toEqual(['SAVED'])
    const { cards } = await list(world, seller)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ status: 'APPLIED', auto: true, last4: '7777', name: '김나래', applied: { date: SMS3_DAY, buyer: 'UC_NARAE' }, message: BUYER_INFO_MESSAGES.SAVED })
    const view = await bundle(world, seller, 'UC_NARAE')
    expect(view.address).toMatchObject({ name: '김나래', phone: '01055557777', address: '부산 해운대구 우동 1408-3', detail: '101동 1203호', source: 'BUYER', confirmed: false })
    // 영수증 문자에 쓸 번호
    const prepared = await expectOk(client(world, seller.cookie).post(`/api/days/${SMS3_DAY}/receipt-sms/prepare`, { requestId: rid('rs'), buyer: 'UC_NARAE' }))
    expect(prepared.body.sms).toMatchObject({ phone: '01055557777' })
    const dump = await dumpAllTables(world.database)
    for (const raw of ['01055557777', '010-5555-7777', '김나래', '해운대구']) expect(dump).not.toContain(raw)
  })

  it('방송 중이어도 주소 문자는 "확인 필요" 카드가 아니라 손님 정보로. 보낸 번호가 문자찜 손님이면 그 손님(이름은 닉네임 아닌 한글 이름)', async () => {
    const { world, seller, token } = await inboxWorld()
    const { b, smsBuyer } = await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-1234-5678', '홍길동 / 서울시 강남구 테헤란로 12 3층')])).toEqual(['SAVED'])
    expect((await expectOk(client(world, seller.cookie).get(`/api/inbox/cards?b=${b}`))).body.cards).toEqual([])
    const { cards } = await list(world, seller)
    expect(cards[0]).toMatchObject({ status: 'APPLIED', applied: { buyer: smsBuyer } })
    expect((await bundle(world, seller, smsBuyer)).address).toMatchObject({ name: '홍길동', phone: '01012345678', address: '서울시 강남구 테헤란로 12', detail: '3층', confirmed: false })
    // 문자찜은 그대로 찜
    expect(await statuses(world, token, [sms('i2', '010-1234-5678', '2번 주세요')])).toEqual(['SAVED'])
  })

  it('닉네임이 같은 손님이 여럿이면 카드: 판매자가 골라 넣기. 판매자가 적은 배송지는 덮지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-2222-3333', '초록이 / 이영희 / 경기도 수원시 팔달구 효원로 299, 102호')])).toEqual(['SAVED'])
    const { cards, buyers } = await list(world, seller)
    expect(cards[0]).toMatchObject({ status: 'OPEN', auto: false, message: BUYER_INFO_MESSAGES.MANY })
    expect(cards[0]?.candidates.map((c) => c.buyer).sort()).toEqual(['UC_GREEN1', 'UC_GREEN2'])
    expect(buyers.map((row) => row.buyer)).toContain('UC_GREEN2')
    const id = cards[0]?.id as string
    // 칸이 틀리면 400, 카드 그대로
    const bad = await client(world, seller.cookie).post(`/api/buyer-info/${id}/apply`, { date: SMS3_DAY, buyer: 'UC_GREEN2', name: '', phone: '01022223333', address: '경기도 수원시 팔달구 효원로 299', detail: '102호' })
    expect(bad.status).toBe(400)
    const applied = await expectOk(client(world, seller.cookie).post(`/api/buyer-info/${id}/apply`, { date: SMS3_DAY, buyer: 'UC_GREEN2', name: '이영희', phone: '01022223333', address: '경기도 수원시 팔달구 효원로 299', detail: '102호' }))
    expect(applied.body.card).toMatchObject({ status: 'APPLIED', applied: { buyer: 'UC_GREEN2' } })
    expect((await client(world, seller.cookie).post(`/api/buyer-info/${id}/apply`, { date: SMS3_DAY, buyer: 'UC_GREEN2', name: '이영희', phone: '01022223333', address: '경기도 수원시 팔달구 효원로 299', detail: '' })).status).toBe(409)
    // 판매자가 이미 적은 배송지(UC_GREEN1)는 손님 정보 문자로 덮지 않는다 (번호만 기억)
    const typed = { name: '정판매', phone: '01044445555', address: '서울 종로구 종로 1', detail: '', zip: '', memo: '' }
    expect((await world.server.parcels.writeAddress(seller.sellerId, seller.accountId, SMS3_DAY, rid('pa'), 'UC_GREEN1', typed)).kind).toBe('ok')
    expect(await statuses(world, token, [sms('i2', '010-6666-7777', '닉네임 초록이\n성함 최초록\n주소 서울 마포구 월드컵로 10')])).toEqual(['SAVED'])
    const second = (await list(world, seller)).cards.find((card) => card.last4 === '7777')
    expect(second?.status).toBe('OPEN')
    const kept = await expectOk(client(world, seller.cookie).post(`/api/buyer-info/${second?.id as string}/apply`, { date: SMS3_DAY, buyer: 'UC_GREEN1', name: '최초록', phone: '01066667777', address: '서울 마포구 월드컵로 10', detail: '' }))
    expect(kept.body.card).toMatchObject({ status: 'APPLIED', message: BUYER_INFO_MESSAGES.KEPT })
    expect((await bundle(world, seller, 'UC_GREEN1')).address).toMatchObject({ name: '정판매', source: 'SELLER' })
  })

  it('맞는 손님이 없으면 카드(손님 없음), 닫으면 목록에서 빠진다. 7일 뒤 지운다', async () => {
    const { world, seller, token } = await inboxWorld()
    await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-8888-9999', '모르는사람 / 대전 유성구 대학로 99')])).toEqual(['SAVED'])
    const { cards } = await list(world, seller)
    expect(cards[0]).toMatchObject({ status: 'OPEN', candidates: [], message: BUYER_INFO_MESSAGES.NO_MATCH })
    await expectOk(client(world, seller.cookie).post(`/api/buyer-info/${cards[0]?.id as string}/dismiss`, {}))
    expect((await list(world, seller)).cards).toEqual([])
    expect(await statuses(world, token, [sms('i2', '010-8888-9999', '또다른 / 대전 유성구 대학로 100')])).toEqual(['SAVED'])
    world.clock.advance(7 * 24 * 60 * 60_000 + 1)
    expect(await world.server.buyerInfo.sweep()).toBe(2)
  })

  it('방송이 없을 때 주소 없는 문자는 지금처럼 IGNORED', async () => {
    const { world, seller, token } = await inboxWorld()
    await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-8888-9999', '사장님 감사합니다')])).toEqual(['IGNORED'])
  })
})
