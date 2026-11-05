// 영수증 문자 (D-REAL-03 → D-REAL-05): 우리 서버는 보내지 않고, 받는 번호·글을 판매자 앱에 준다(판매자 휴대폰 문자 앱이 판매자 번호로 보낸다).
// 문자찜 손님은 기억한 번호로, 모르는 손님은 판매자가 넣은 번호로. 보냄 표시는 요청 번호로 한 번만. 리허설·보조자·번호 없음, DB에 번호 원문 없음.
// D-REAL-05로 바뀐 기대: 옛 "서버가 솔라피로 보냄·1분 안 다시 보내기 429·문자 키 없는 서버 503·smsReady false·보내기 실패 502"
// → 새 "준비가 번호·글을 돌려줌·보냄 표시는 따로·문자 키와 상관없이 smsReady true·발송 상한 없음(판매자 요금제)".
import { describe, expect, it } from 'vitest'
import { RECEIPT_SMS_MESSAGES, receiptSmsText } from '../src/receipt-sms.ts'
import { chat, ok } from './i2-support.ts'
import { ORIGIN, addSeller, client, createBroadcast, dumpAllTables, login, newWorld, rid, type Seller, type TestServer } from './support.ts'

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
  it('문자찜 손님은 기억한 번호와 가게 이름·확인서 링크 하나를 돌려준다. 보냄 표시는 요청 번호로 한 번만, 같은 손님은 같은 링크', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    const before = await buyersOf(world, seller)
    expect(before.smsReady).toBe(true)
    expect(before.buyers.find((row) => row.buyer === smsBuyer)?.sms).toEqual({ last4: '5678', sentAt: null })
    expect(before.buyers.find((row) => row.buyer === 'UC_B')?.sms).toEqual({ last4: null, sentAt: null })

    const first = await prepare(world, seller.cookie, { buyer: smsBuyer })
    expect(first.status, first.text).toBe(200)
    const draft = first.body.sms as { buyer: string; phone: string; last4: string; text: string }
    expect(draft).toMatchObject({ buyer: smsBuyer, phone: '01012345678', last4: '5678' })
    expect(draft.text.startsWith('[가게 ')).toBe(true)
    expect(draft.text).toMatch(new RegExp(`${ORIGIN}/r/[A-Za-z0-9_-]{43}$`))
    // 준비만으로는 보냄이 아니다 (판매자가 문자 앱에서 닫을 수 있다)
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === smsBuyer)?.sms?.sentAt).toBeNull()
    // 다시 준비해도 같은 링크
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

  it('리허설 409, 보조자 403', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    expect((await prepare(world, seller.cookie, { buyer: smsBuyer }, '?rehearsal=true')).status).toBe(409)
    expect((await markSent(world, seller.cookie, { buyer: smsBuyer }, '?rehearsal=true')).status).toBe(409)
    const created = await client(world, seller.cookie).post('/api/assistants', { name: '엄마' })
    const assistant = await login(world, (created.body.assistant as { loginId: string }).loginId, created.body.password as string)
    expect((await prepare(world, assistant, { buyer: smsBuyer })).status).toBe(403)
    expect((await markSent(world, assistant, { buyer: smsBuyer })).status).toBe(403)
  })

  it('보내는 글 모양', () => {
    expect(receiptSmsText('초록다육', 'https://x/r/abc')).toBe('[초록다육] 주문 확인서예요.\nhttps://x/r/abc')
    expect(receiptSmsText('  ', 'https://x/r/abc')).toBe('주문 확인서예요.\nhttps://x/r/abc')
  })
})
