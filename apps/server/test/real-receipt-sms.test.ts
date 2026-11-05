// D-REAL-03 영수증 문자 보내기: 문자찜 손님은 기억한 번호로, 모르는 손님은 판매자가 넣은 번호로. 요청 번호로 한 번만, 1분 안 다시 보내기 막기,
// 리허설·보조자·번호 없음·문자 끔, DB에 번호 원문 없음, 확인서 링크가 글에 들어감.
import { describe, expect, it } from 'vitest'
import { RECEIPT_SMS_MESSAGES, receiptSmsText, type ReceiptSmsSender } from '../src/receipt-sms.ts'
import { chat, ok } from './i2-support.ts'
import { ORIGIN, addSeller, client, createBroadcast, dumpAllTables, login, newWorld, rid, type Seller, type TestServer } from './support.ts'

const DATE = '2026-10-19'

class Outbox implements ReceiptSmsSender {
  readonly sent: { to: string; text: string }[] = []
  fail = false
  async send(to: string, text: string): Promise<void> {
    if (this.fail) throw new Error('down')
    this.sent.push({ to, text })
  }
}

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

const send = (world: TestServer, cookie: string, body: Record<string, unknown>, query = '') => client(world, cookie).post(`/api/days/${DATE}/receipt-sms${query}`, { requestId: rid('rs'), ...body })

describe('D-REAL-03 영수증 문자', () => {
  it('문자찜 손님은 기억한 번호로, 글에는 가게 이름과 확인서 링크 하나. 같은 요청 번호는 다시 보내지 않고, 1분 안에는 다시 보내지 않는다', async () => {
    const outbox = new Outbox()
    const world = await newWorld({ smsSender: outbox })
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    const before = await buyersOf(world, seller)
    expect(before.smsReady).toBe(true)
    expect(before.buyers.find((row) => row.buyer === smsBuyer)?.sms).toEqual({ last4: '5678', sentAt: null })
    expect(before.buyers.find((row) => row.buyer === 'UC_B')?.sms).toEqual({ last4: null, sentAt: null })

    const requestId = rid('rs')
    const first = await send(world, seller.cookie, { requestId, buyer: smsBuyer })
    expect(first.status, first.text).toBe(200)
    expect(first.body.sms).toMatchObject({ buyer: smsBuyer, last4: '5678' })
    expect(outbox.sent).toHaveLength(1)
    expect(outbox.sent[0]?.to).toBe('01012345678')
    const text = outbox.sent[0]?.text ?? ''
    expect(text.startsWith('[가게 ')).toBe(true)
    expect(text).toMatch(new RegExp(`${ORIGIN}/r/[A-Za-z0-9_-]{43}$`))
    // 같은 요청 번호 → 처음 결과, 문자는 한 통
    const again = await send(world, seller.cookie, { requestId, buyer: smsBuyer })
    expect(again.body).toEqual(first.body)
    expect(outbox.sent).toHaveLength(1)
    // 1분 안 다른 요청 → 막음
    const soon = await send(world, seller.cookie, { buyer: smsBuyer })
    expect(soon.status).toBe(429)
    expect((soon.body.error as { message: string }).message).toBe(RECEIPT_SMS_MESSAGES.tooSoon)
    world.clock.advance(61_000)
    expect((await send(world, seller.cookie, { buyer: smsBuyer })).status).toBe(200)
    expect(outbox.sent).toHaveLength(2)
    // 같은 손님에게 같은 링크
    expect(outbox.sent[1]?.text).toBe(text)
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === smsBuyer)?.sms?.sentAt).not.toBeNull()
    // DB 어디에도 번호 원문이 없다
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('01012345678')
    expect(dump).not.toContain('010-1234-5678')
  })

  it('번호를 모르는 손님은 409 NO_PHONE, 판매자가 넣은 번호로 보내고 기억한다. 틀린 번호는 400', async () => {
    const outbox = new Outbox()
    const world = await newWorld({ smsSender: outbox })
    const seller = await addSeller(world)
    await setup(world, seller)
    const none = await send(world, seller.cookie, { buyer: 'UC_B' })
    expect(none.status).toBe(409)
    expect((none.body.error as { code: string }).code).toBe('NO_PHONE')
    expect((none.body.error as { message: string }).message).toBe(RECEIPT_SMS_MESSAGES.noPhone)
    expect((await send(world, seller.cookie, { buyer: 'UC_B', phone: '02-123-4567' })).status).toBe(400)
    const typed = await send(world, seller.cookie, { buyer: 'UC_B', phone: '010 9876 5432' })
    expect(typed.status, typed.text).toBe(200)
    expect(outbox.sent.map((item) => item.to)).toEqual(['01098765432'])
    expect((await buyersOf(world, seller)).buyers.find((row) => row.buyer === 'UC_B')?.sms?.last4).toBe('5432')
  })

  it('문자 보내기가 없는 서버는 503·smsReady false, 보내기 실패는 502(다음 요청 번호로 다시 보낼 수 있다), 리허설 409, 보조자 403', async () => {
    const plain = await newWorld()
    const s0 = await addSeller(plain)
    const smsBuyer0 = await setup(plain, s0)
    expect((await buyersOf(plain, s0)).smsReady).toBe(false)
    expect((await send(plain, s0.cookie, { buyer: smsBuyer0 })).status).toBe(503)

    const outbox = new Outbox()
    const world = await newWorld({ smsSender: outbox })
    const seller = await addSeller(world)
    const smsBuyer = await setup(world, seller)
    outbox.fail = true
    const failed = await send(world, seller.cookie, { buyer: smsBuyer })
    expect(failed.status).toBe(502)
    expect((failed.body.error as { message: string }).message).toBe(RECEIPT_SMS_MESSAGES.failed)
    outbox.fail = false
    expect((await send(world, seller.cookie, { buyer: smsBuyer })).status).toBe(200)

    expect((await send(world, seller.cookie, { buyer: smsBuyer }, '?rehearsal=true')).status).toBe(409)

    const created = await client(world, seller.cookie).post('/api/assistants', { name: '엄마' })
    const assistant = await login(world, (created.body.assistant as { loginId: string }).loginId, created.body.password as string)
    expect((await send(world, assistant, { buyer: smsBuyer })).status).toBe(403)
  })

  it('보내는 글 모양', () => {
    expect(receiptSmsText('초록다육', 'https://x/r/abc')).toBe('[초록다육] 주문 확인서예요.\nhttps://x/r/abc')
    expect(receiptSmsText('  ', 'https://x/r/abc')).toBe('주문 확인서예요.\nhttps://x/r/abc')
  })
})
