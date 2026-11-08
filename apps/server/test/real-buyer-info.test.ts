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

// 손님이 실제로 보낼 법한 여러 모양 (D-REAL-12): 띄어쓰기 없음·줄 가운데 꼬리표·이모지·우편번호·인사말·부탁 말·주소 뒤 이름.
// 새로 못 읽은 모양이 나오면 여기에 더한다 — 고칠 때 전에 읽던 모양이 깨지지 않게.
const SHAPES: readonly (readonly [string, { address: string; detail: string; name?: string | null; nickname?: string | null; word?: string }])[] = [
  ['닉네임 나래 김나래 부산 해운대구 우동 1408-3 101동 1203호', { nickname: '나래', word: '김나래', address: '부산 해운대구 우동 1408-3', detail: '101동 1203호' }],
  ['김나래\n부산광역시 해운대구 센텀중앙로 79\n센텀아이파크 101동 1203호\n010-1234-5678', { word: '김나래', address: '부산광역시 해운대구 센텀중앙로 79', detail: '센텀아이파크 101동 1203호' }],
  ['서울시강남구테헤란로12 3층 홍길동', { word: '홍길동', address: '서울시 강남구 테헤란로12', detail: '3층' }],
  ['서울 강남 테헤란로 12 홍길동', { word: '홍길동', address: '서울 강남 테헤란로 12', detail: '' }],
  ['경기 성남시 분당구 판교로228번길 15 판교세븐벤처밸리 3층', { address: '경기 성남시 분당구 판교로228번길 15', detail: '판교세븐벤처밸리 3층' }],
  ['홍길동 010.1234.5678 경기도 성남시 분당구 판교역로 235', { word: '홍길동', address: '경기도 성남시 분당구 판교역로 235', detail: '' }],
  ['(06234) 서울특별시 강남구 테헤란로 152 강남파이낸스센터 21층 / 이민수 / 닉 민수짱', { nickname: '민수짱', word: '이민수', address: '서울특별시 강남구 테헤란로 152', detail: '강남파이낸스센터 21층' }],
  ['주소는 대전광역시 유성구 대학로 99 이고요 받는분은 박지성입니다', { name: '박지성', address: '대전광역시 유성구 대학로 99', detail: '' }],
  ['충북 청주시 흥덕구 오송읍 오송생명로 187 식약처 정문 경비실 앞에 놔주세요', { address: '충북 청주시 흥덕구 오송읍 오송생명로 187', detail: '식약처 정문 경비실 앞에 놔주세요' }],
  ['제주 제주시 첨단로 242 카카오 스페이스닷원', { address: '제주 제주시 첨단로 242', detail: '카카오 스페이스닷원' }],
  ['세종 한누리대로 2130 정부청사 정민호', { word: '정민호', address: '세종 한누리대로 2130', detail: '정부청사' }],
  ['세종시한누리대로2130 정민호', { word: '정민호', address: '세종시 한누리대로2130', detail: '' }],
  ['충청남도 공주시 우성면 증산리 1034 박민수 01098765432', { word: '박민수', address: '충청남도 공주시 우성면 증산리 1034', detail: '' }],
  ['충청남도공주시우성면증산리1034', { address: '충청남도 공주시 우성면 증산리1034', detail: '' }],
  ['서울 송파구 잠실동 40-1 잠실엘스 112동 802호 최유진', { word: '최유진', address: '서울 송파구 잠실동 40-1', detail: '잠실엘스 112동 802호' }],
  ['인천 연수구 송도동 24-5 송도더샵 101-1502 김하늘', { word: '김하늘', address: '인천 연수구 송도동 24-5', detail: '송도더샵 101-1502' }],
  ['이름 : 김철수\n주소 : 광주 북구 용봉로 77 전남대 기숙사 8동\n폰 : 010 2222 3333', { name: '김철수', address: '광주 북구 용봉로 77', detail: '전남대 기숙사 8동' }],
  ['안녕하세요 사장님~ 아까 3번 찜한 다육맘이에요ㅎㅎ 서울 마포구 월드컵북로 396 누리꿈스퀘어 10층 이수진 앞으로 보내주세요!!', { word: '이수진', address: '서울 마포구 월드컵북로 396', detail: '누리꿈스퀘어 10층' }],
  ['😊닉:초록이😊 경남 창원시 의창구 중앙대로 151 / 010-3333-4444 / 이영희', { nickname: '초록이', word: '이영희', address: '경남 창원시 의창구 중앙대로 151', detail: '' }],
  ['울산 남구 삼산로 274 강민지', { word: '강민지', address: '울산 남구 삼산로 274', detail: '' }],
  ['경북 포항시 남구 지곡로 80 포스텍 학생회관 우편함 김연아', { word: '김연아', address: '경북 포항시 남구 지곡로 80', detail: '포스텍 학생회관 우편함' }],
  ['서울 관악구 관악로 1 서울대학교 301동 1층', { address: '서울 관악구 관악로 1', detail: '서울대학교 301동 1층' }],
  ['받는사람 정우성 서울 종로구 세종대로 209', { name: '정우성', address: '서울 종로구 세종대로 209', detail: '' }],
  ['강원특별자치도 춘천시 중앙로 1 이지은', { word: '이지은', address: '강원특별자치도 춘천시 중앙로 1', detail: '' }],
  ['전북특별자치도 전주시 완산구 효자로 225 박서준', { word: '박서준', address: '전북특별자치도 전주시 완산구 효자로 225', detail: '' }],
  ['경기도 수원시 영통구 매탄동 129 삼성디지털시티', { address: '경기도 수원시 영통구 매탄동 129', detail: '삼성디지털시티' }],
  ['서울특별시 중구 세종대로110 시청', { address: '서울특별시 중구 세종대로110', detail: '시청' }],
  ['부산 사하구 다대로 1 다대포 해수욕장앞 민박', { address: '부산 사하구 다대로 1', detail: '다대포 해수욕장앞 민박' }],
  ['경기 화성시 동탄대로 446-11 동탄호수공원아파트 1001동 1001호', { address: '경기 화성시 동탄대로 446-11', detail: '동탄호수공원아파트 1001동 1001호' }],
  ['gildong / 서울 강서구 공항대로 247 / 홍길동', { word: '홍길동', address: '서울 강서구 공항대로 247', detail: '' }],
  ['대구 수성구 범어동 177-3 범어아이파크 2단지', { address: '대구 수성구 범어동 177-3', detail: '범어아이파크 2단지' }],
  ['대구수성구범어동177-3', { address: '대구 수성구 범어동177-3', detail: '' }],
  ['경기 고양시 일산동구 중앙로 1275번길 38-10', { address: '경기 고양시 일산동구 중앙로 1275번길 38-10', detail: '' }],
  ['제 이름은 홍길동이고 주소는 경기도남양주시화도읍마석로12 입니다', { name: '홍길동', address: '경기도 남양주시 화도읍 마석로12', detail: '' }],
  ['서울 강서구 공항대로 247 우체국 앞 경비실', { address: '서울 강서구 공항대로 247', detail: '우체국 앞 경비실' }],
]

describe('ORD-14 손님 정보 문자 여러 모양 (D-REAL-12)', () => {
  for (const [text, want] of SHAPES) {
    it(text.replace(/\n/g, ' / '), () => {
      const read = readBuyerInfo(text)
      expect(read).not.toBeNull()
      expect(read).toMatchObject({ address: want.address, detail: want.detail, ...(want.name === undefined ? {} : { name: want.name }), ...(want.nickname === undefined ? {} : { nickname: want.nickname }) })
      if (want.word !== undefined) expect(read?.words).toContain(want.word)
    })
  }
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

  it('주소 뒤에 붙인 이름은 받는 분 이름으로, 상세 주소에는 넣지 않는다 (D-REAL-12)', async () => {
    const { world, seller, token } = await inboxWorld()
    await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-5555-7777', '😊닉:나래😊 부산 해운대구 우동 1408-3 101동 1203호 김나래 앞으로 보내주세요~')])).toEqual(['SAVED'])
    expect((await list(world, seller)).cards[0]).toMatchObject({ status: 'APPLIED', applied: { buyer: 'UC_NARAE' } })
    expect((await bundle(world, seller, 'UC_NARAE')).address).toMatchObject({ name: '김나래', address: '부산 해운대구 우동 1408-3', detail: '101동 1203호', confirmed: false })
  })

  it('방송이 없을 때 주소 없는 문자는 지금처럼 IGNORED', async () => {
    const { world, seller, token } = await inboxWorld()
    await setup(world, seller)
    expect(await statuses(world, token, [sms('i1', '010-8888-9999', '사장님 감사합니다')])).toEqual(['IGNORED'])
  })
})
