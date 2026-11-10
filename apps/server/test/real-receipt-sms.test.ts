// 영수증 문자 (D-REAL-03 → D-REAL-05): 우리 서버는 보내지 않고, 받는 번호·글을 판매자 앱에 준다(판매자 휴대폰 문자 앱이 판매자 번호로 보낸다).
// 문자찜 손님은 기억한 번호로, 모르는 손님은 판매자가 넣은 번호로. 보냄 표시는 요청 번호로 한 번만. 리허설·번호 없음, DB에 번호 원문 없음.
// D-REAL-05로 바뀐 기대: 옛 "서버가 솔라피로 보냄·1분 안 다시 보내기 429·문자 키 없는 서버 503·smsReady false·보내기 실패 502"
// → 새 "준비가 번호·글을 돌려줌·보냄 표시는 따로·문자 키와 상관없이 smsReady true·발송 상한 없음(판매자 요금제)".
// D-REAL-13(사용자 지시 2026-11-11 "사진으로 바꿔줘")으로 바뀐 기대: 옛 "글 = 가게 이름 + 확인서 링크, 같은 손님은 같은 링크"
// → 새 "글 = 가게 이름 + 최종 결제 금액 + 입금 계좌, 링크 없음(사진은 앱이 receipt.jpg로 붙인다)".
import { describe, expect, it } from 'vitest'
import { RECEIPT_SMS_MESSAGES, receiptSmsText } from '../src/receipt-sms.ts'
import { chat, ok, putShop } from './i2-support.ts'
import { addSeller, client, createBroadcast, dumpAllTables, newWorld, rid, type Seller, type TestServer } from './support.ts'

const DATE = '2026-10-19'

async function setup(world: TestServer, seller: Seller): Promise<string> {
  const b = (await createBroadcast(world, seller, { date: DATE })).id
  await ok(world, seller, { type: 'product.register', b, no: 1, name: '핑크프릴', price: 10000 })
  await ok(world, seller, { type: 'product.register', b, no: 2, name: '라울', price: 12000 })
  // 1번은 문자찜 손님(번호 있음), 2번은 유튜브 손님(번호 모름)
  const sms = await ok(world, seller, { type: 'sms', b, no: 1, phone: '010-1234-5678' })
  await chat(world, seller, b, 'm2', 'UC_B', '나래', '2')
  return String(sms.body.buyer)
}

const buyersOf = async (world: TestServer, seller: Seller) => {
  const response = await client(world, seller.cookie).get(`/api/days/${DATE}/receipt-buyers`)
  expect(response.status, response.text).toBe(200)
  return response.body as { smsReady: boolean; buyers: { buyer: string; sms: { last4: string | null; sentAt: string | null } | null }[] }
}

const prepare = (world: TestServer, cookie: string, body: Record<string, unknown>, query = '') => client(world, cookie).post(`/api/days/${DATE}/receipt-sms/prepare${query}`, { requestId: rid('rs'), ...body })
const markSent = (world: TestServer, cookie: string, body: Record<string, unknown>, query = '') => client(world, cookie).post(`/api/days/${DATE}/receipt-sms/sent${query}`, { requestId: rid('rs'), ...body })

describe('D-REAL-05 영수증 문자 (판매자 휴대폰으로)', () => {
  it('문자찜 손님은 기억한 번호와 가게 이름·최종 금액·입금 계좌 글(링크 없음)을 돌려준다. 보냄 표시는 요청 번호로 한 번만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    const before = await buyersOf(world, seller)
    expect(before.smsReady).toBe(true)
    expect(before.buyers.find((row) => row.buyer === smsBuyer)?.sms).toEqual({ last4: '5678', sentAt: null })
    expect(before.buyers.find((row) => row.buyer === 'UC_B')?.sms).toEqual({ last4: null, sentAt: null })

    expect((await putShop(world, seller)).status).toBe(200)
    const first = await prepare(world, seller.cookie, { buyer: smsBuyer })
    expect(first.status, first.text).toBe(200)
    const draft = first.body.sms as { buyer: string; phone: string; last4: string; text: string }
    expect(draft).toMatchObject({ buyer: smsBuyer, phone: '01012345678', last4: '5678' })
    expect(draft.text).toBe('[초록다육] 주문 확인서예요.\n최종 결제 금액 14,000원\n입금 계좌 농협 302-9988-7766-11 김판매')
    // 상품 10,000원 + 기본 배송비 4,000원 (DOMAIN_RULES shipping.baseFee)
    expect(draft.text).not.toContain('http')
    // 준비만으로는 보냄이 아니다 (판매자가 문자 앱에서 닫을 수 있다)
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === smsBuyer)?.sms?.sentAt).toBeNull()
    // 다시 준비해도 같은 글
    expect(((await prepare(world, seller.cookie, { buyer: smsBuyer })).body.sms as { text: string }).text).toBe(draft.text)

    const requestId = rid('rs')
    const sent = await markSent(world, seller.cookie, { requestId, buyer: smsBuyer })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body.sms).toMatchObject({ buyer: smsBuyer, last4: '5678' })
    const again = await markSent(world, seller.cookie, { requestId, buyer: smsBuyer })
    expect(again.body).toEqual(sent.body)
    // 다른 손님에 같은 요청 번호 → 막음
    expect((await markSent(world, seller.cookie, { requestId, buyer: 'UC_B' })).status).toBe(409)
    // 판매자 요금제로 나가므로 바로 다시 보내도 된다
    expect((await markSent(world, seller.cookie, { buyer: smsBuyer })).status).toBe(200)
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === smsBuyer)?.sms?.sentAt).toBe(sent.body.sms && (sent.body.sms as { sentAt: string }).sentAt)
    // DB 어디에도 번호 원문이 없다
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('01012345678')
    expect(dump).not.toContain('010-1234-5678')
  })

  it('번호를 모르는 손님은 409 NO_PHONE, 판매자가 넣은 번호를 기억해 돌려준다. 틀린 번호는 400. 번호 모르는 손님 보냄 표시도 409', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await setup(world, seller)
    const none = await prepare(world, seller.cookie, { buyer: 'UC_B' })
    expect(none.status).toBe(409)
    expect((none.body.error as { code: string }).code).toBe('NO_PHONE')
    expect((none.body.error as { message: string }).message).toBe(RECEIPT_SMS_MESSAGES.noPhone)
    expect((await markSent(world, seller.cookie, { buyer: 'UC_B' })).status).toBe(409)
    expect((await prepare(world, seller.cookie, { buyer: 'UC_B', phone: '02-123-4567' })).status).toBe(400)
    const typed = await prepare(world, seller.cookie, { buyer: 'UC_B', phone: '010 9876 5432' })
    expect(typed.status, typed.text).toBe(200)
    expect(typed.body.sms).toMatchObject({ phone: '01098765432', last4: '5432' })
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === 'UC_B')?.sms?.last4).toBe('5432')
    // 다음에는 번호 없이도
    expect(((await prepare(world, seller.cookie, { buyer: 'UC_B' })).body.sms as { phone: string }).phone).toBe('01098765432')
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('리허설 409', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    expect((await prepare(world, seller.cookie, { buyer: smsBuyer }, '?rehearsal=true')).status).toBe(409)
    expect((await markSent(world, seller.cookie, { buyer: smsBuyer }, '?rehearsal=true')).status).toBe(409)
  })

  it('보내는 글 모양 (D-REAL-13 — 링크 없음, 입금 상태마다)', () => {
    const shop = { name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매' }
    expect(receiptSmsText(shop, { total: 32000, remaining: null, payment: 'UNPAID' })).toBe('[초록다육] 주문 확인서예요.\n최종 결제 금액 32,000원\n입금 계좌 농협 302-9988-7766-11 김판매')
    expect(receiptSmsText(shop, { total: 32000, remaining: 12000, payment: 'PARTIAL' })).toBe('[초록다육] 주문 확인서예요.\n최종 결제 금액 32,000원\n남은 금액 12,000원\n입금 계좌 농협 302-9988-7766-11 김판매')
    expect(receiptSmsText(shop, { total: 32000, remaining: null, payment: 'PAID' })).toBe('[초록다육] 주문 확인서예요.\n최종 결제 금액 32,000원\n입금 확인됐어요. 감사합니다.')
    // 가게 이름·계좌가 비면 그 줄이 없다, 줄바꿈은 한 칸으로
    expect(receiptSmsText({ name: '  ', bank: '', accountNumber: '', accountHolder: '' }, { total: 800, remaining: null, payment: 'UNPAID' })).toBe('주문 확인서예요.\n최종 결제 금액 800원')
    expect(receiptSmsText({ ...shop, name: '초록\n다육' }, { total: 800, remaining: null, payment: 'OVERPAID' })).toBe('[초록 다육] 주문 확인서예요.\n최종 결제 금액 800원\n입금 확인됐어요. 감사합니다.')
  })
})
