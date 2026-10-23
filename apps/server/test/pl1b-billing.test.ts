// PL1B 서버 몫 (AC-PL1B-01~04·21·22).
// - 간이과세자 증빙(BL-8 1·3·6, D-PL1-07): 계좌이체 증빙은 현금영수증(지출증빙) 하나. `TAX_INVOICE` 저장은 422, 옛 저장값은 현금영수증으로 읽는다,
//   이미 만든 증빙 기록은 그대로, 운영자 계정 명령도 현금영수증.
// - BL-7 5·6(D-PL1-08): 결과를 모르는 환불·밖에서 취소된 결제 — 기존 RA-N5-01 시험(billing-refund-settle.test.ts)이 덮지 않는 칸만 더한다.
import { describe, expect, it } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { formatOperatorLists, operatorLists } from '../src/billing/operator.ts'
import { HOUR_MS } from '../src/billing/rules.ts'
import { billingWorld, BIZNO, buy, confirm, fake, query, saveBusiness, status, type BillingWorld } from './billing-support.ts'
import { addSeller, client, FAST_COST, login, rid, type Seller } from './support.ts'

const TAX_INVOICE_MESSAGE = '세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.'
const RECEIPT_KIND_MESSAGE = '계좌이체 증빙은 세금계산서나 현금영수증 중에서 골라 주세요.'
const REFUND_BUSY = '환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요.'

const businessRow = async (world: BillingWorld, sellerId: string) =>
  (await query<{ sealed: string; masked: string; receipt_kind: string; updated_at: Date }>(world, `select sealed, masked, receipt_kind, updated_at from billing_business where seller_id = '${sellerId}'`))[0]
const documents = async (world: BillingWorld) =>
  query<{ id: number; payment_id: string; kind: string; amount: number; supply: number; vat: number; status: string; approval: string | null; recipient_sealed: string; updated_at: Date }>(
    world,
    'select id, payment_id, kind, amount, supply, vat, status, approval, recipient_sealed, updated_at from billing_documents order by id',
  )
const refund = (world: BillingWorld, seller: Seller, paymentId: string, requestId = rid('rf')) => client(world, seller.cookie).post(`/api/billing/orders/${paymentId}/refund`, { requestId })
const payments = async (world: BillingWorld, seller: Seller) => (await client(world, seller.cookie).get('/api/billing/payments')).body.items as Record<string, unknown>[]
const start = (world: BillingWorld, seller: Seller) => client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc') })
const revocations = async (world: BillingWorld) => (await query<{ grant_id: string }>(world, 'select grant_id from billing_revocations')).length

describe('AC-PL1B-01 사업자 정보의 증빙 종류 (BL-8 1·6, D-PL1-07)', () => {
  it('(a) receiptKind 없이 (b) CASH_RECEIPT → 저장, 응답·조회 모두 CASH_RECEIPT', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const none = await saveBusiness(world, seller)
    expect(none.status, none.text).toBe(200)
    expect(none.body).toMatchObject({ receiptKind: 'CASH_RECEIPT', complete: true })
    expect((await status(world, seller)).business).toMatchObject({ receiptKind: 'CASH_RECEIPT' })
    expect((await businessRow(world, seller.sellerId))?.receipt_kind).toBe('CASH_RECEIPT')
    const cash = await saveBusiness(world, seller, { name: '현금 상회', receiptKind: 'CASH_RECEIPT' })
    expect(cash.status, cash.text).toBe(200)
    expect(cash.body).toMatchObject({ name: '현금 상회', receiptKind: 'CASH_RECEIPT' })
    expect((await status(world, seller)).business).toMatchObject({ name: '현금 상회', receiptKind: 'CASH_RECEIPT' })
  })

  it('(c) TAX_INVOICE → 422 · 칸 receiptKind · "세금계산서는 지금은 발급할 수 없어요…" · 이미 있던 사업자 정보 그대로', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    expect((await saveBusiness(world, seller, { name: '처음 상회' })).status).toBe(200)
    const before = await businessRow(world, seller.sellerId)
    const refused = await saveBusiness(world, seller, { name: '바뀐 상회', receiptKind: 'TAX_INVOICE' })
    expect(refused.status).toBe(422)
    expect(refused.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'receiptKind', message: TAX_INVOICE_MESSAGE }] } })
    expect(await businessRow(world, seller.sellerId)).toEqual(before)
    expect((await status(world, seller)).business).toMatchObject({ name: '처음 상회', receiptKind: 'CASH_RECEIPT' })
    // 사업자 정보가 아직 없던 판매자도 아무것도 저장하지 않는다
    const fresh = await addSeller(world)
    expect((await saveBusiness(world, fresh, { receiptKind: 'TAX_INVOICE' })).status).toBe(422)
    expect(await businessRow(world, fresh.sellerId)).toBeUndefined()
    expect((await status(world, fresh)).business).toBeNull()
  })

  it("(d) 'cash_receipt'·1·null → 422 · 기존 문장 '계좌이체 증빙은 …' · 저장 없음", async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    for (const value of ['cash_receipt', 1, null]) {
      const refused = await saveBusiness(world, seller, { receiptKind: value })
      expect(refused.status, JSON.stringify(value)).toBe(422)
      expect(refused.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'receiptKind', message: RECEIPT_KIND_MESSAGE }] } })
    }
    expect(await businessRow(world, seller.sellerId)).toBeUndefined()
    // 다른 칸만 틀리면 지금처럼 400 (증빙 종류가 함께 틀리면 422 — 모든 칸의 문장을 함께 준다)
    expect((await saveBusiness(world, seller, { name: '' })).status).toBe(400)
    const both = await saveBusiness(world, seller, { name: '', receiptKind: 'TAX_INVOICE' })
    expect(both.status).toBe(422)
    expect((both.body as { error: { problems: { field: string }[] } }).error.problems.map((problem) => problem.field)).toEqual(['name', 'receiptKind'])
    expect(await businessRow(world, seller.sellerId)).toBeUndefined()
  })
})

describe('AC-PL1B-02 옛 저장값과 증빙 요청 (BL-8 3·6, D-PL1-07)', () => {
  it('DB의 receipt_kind = TAX_INVOICE → 조회·새 증빙 요청은 CASH_RECEIPT(공급가액·세액 BL-8 4), 옛 TAX_INVOICE 증빙 기록은 그대로, 카드는 증빙 없음', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    expect((await saveBusiness(world, seller, { email: 'mail@shop.kr' })).status).toBe(200)
    // BASE 코드가 만든 것과 같은 옛 기록: 사업자 정보 행의 종류 TAX_INVOICE + 그 종류로 발행된 증빙 하나
    const old = await buy(world, seller, 'days-1', 'TRANSFER')
    await query(world, `update billing_business set receipt_kind = 'TAX_INVOICE' where seller_id = '${seller.sellerId}'`)
    await query(world, `update billing_documents set kind = 'TAX_INVOICE' where payment_id = '${old}'`)
    const oldBefore = (await documents(world)).find((doc) => doc.payment_id === old)
    expect(oldBefore).toMatchObject({ kind: 'TAX_INVOICE', status: 'ISSUED' })

    expect((await status(world, seller)).business).toEqual({ masked: '123-45-*****', name: '다육 상회', ceo: '김대표', email: 'mail@shop.kr', receiptKind: 'CASH_RECEIPT', complete: true })
    // 저장값은 고쳐 쓰지 않는다
    expect((await businessRow(world, seller.sellerId))?.receipt_kind).toBe('TAX_INVOICE')

    const card = await buy(world, seller, 'days-10', 'CARD')
    const transfer = await buy(world, seller, 'flat-30', 'TRANSFER')
    const docs = await documents(world)
    expect(docs.map((doc) => doc.payment_id)).toEqual([old, transfer])
    expect(docs.find((doc) => doc.payment_id === card)).toBeUndefined()
    // G-BIL-201~207과 같은 나누기: 30,000원 → 27,273 + 2,727
    expect(docs[1]).toMatchObject({ kind: 'CASH_RECEIPT', amount: 30000, supply: 27273, vat: 2727, status: 'ISSUED' })
    expect(fake(world).issuer.issued.at(-1)).toMatchObject({ paymentId: transfer, kind: 'CASH_RECEIPT', amount: 30000, supply: 27273, vat: 2727 })
    expect(docs[0]).toEqual(oldBefore)

    const list = await payments(world, seller)
    expect(list.find((item) => item.paymentId === transfer)).toMatchObject({ document: { kind: 'CASH_RECEIPT', status: 'ISSUED' } })
    expect(list.find((item) => item.paymentId === old)).toMatchObject({ document: { kind: 'TAX_INVOICE', status: 'ISSUED' } })
    expect(list.find((item) => item.paymentId === card)).toMatchObject({ document: null })
  })
})

describe('AC-PL1B-03 운영자 계정 명령 (BL-8 1, D-PL1-07)', () => {
  it('사업자등록번호와 함께 만든 판매자 → 조회와 DB 행 모두 CASH_RECEIPT', async () => {
    const world = await billingWorld()
    const created = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), { shopName: '가게', loginId: 'pl1b-biz', password: 'password-1', businessNumber: BIZNO }, { passwordCost: FAST_COST })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect((await businessRow(world, created.sellerId))?.receipt_kind).toBe('CASH_RECEIPT')
    const cookie = await login(world, 'pl1b-biz', 'password-1')
    expect((await client(world, cookie).get('/api/billing')).body.business).toEqual({ masked: '123-45-*****', name: null, ceo: null, email: null, receiptKind: 'CASH_RECEIPT', complete: false })
  })
})

describe('AC-PL1B-04 운영자 증빙 목록 (D-PL1-07)', () => {
  it('종류 낱말은 저장된 종류 그대로 — 새 요청 "현금영수증(지출증빙)", 옛 기록 "세금계산서"', async () => {
    const { noneIssuer } = await import('../src/billing/documents.ts')
    const { testBilling } = await import('../src/billing/fake.ts')
    const world = await billingWorld({ billing: { ...testBilling(), issuer: noneIssuer } })
    const seller = await addSeller(world)
    const old = await buy(world, seller, 'days-1', 'TRANSFER')
    await query(world, `update billing_documents set kind = 'TAX_INVOICE' where payment_id = '${old}'`)
    const fresh = await buy(world, seller, 'days-10', 'TRANSFER')
    world.clock.advance(HOUR_MS)
    const lists = await operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), world.clock.now())
    expect(lists.documents.map((doc) => [doc.document.paymentId, doc.document.kind])).toEqual([
      [old, 'TAX_INVOICE'],
      [fresh, 'CASH_RECEIPT'],
    ])
    const lines = formatOperatorLists(lists)
    expect(lines.find((line) => line.includes(`결제 ${old}`))).toContain(' · 세금계산서 · 발행 대기')
    expect(lines.find((line) => line.includes(`결제 ${fresh}`))).toContain(' · 현금영수증(지출증빙) · 발행 대기')
  })
})

describe('AC-PL1B-21 결과를 모르는 환불 (BL-7 5, D-PL1-08)', () => {
  // 환불 요청 자신이 결제 조회로 결과를 알면 바로 끝난다(취소됨 → 200 환불함 · 결제 그대로 → 502 — billing-refund-settle.test.ts
  // "재현: 취소 반영 뒤 응답이 시간 제한보다 늦으면 …"·"취소가 정말 안 됐으면(결제 그대로) …"). 결과를 모르는 것은 결제 조회도 안 될 때다.
  it('(a) 시간 초과(실제로는 취소함) + 조회 실패 → 409 "처리하는 중", 정액 미리 보기·잔량에 쓰지 않음, 두 번째 환불도 409·취소 한 번 → 맞추면 회수·환불함', async () => {
    const world = await billingWorld({}, { timeoutMs: 100 })
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'flat-30')
    expect((await status(world, seller)).start).toMatchObject({ allowed: true, mode: 'FLAT' })
    fake(world).portone.cancelDelayMs = 400
    fake(world).portone.lookupFailure = true
    const unknown = await refund(world, seller, paymentId)
    expect(unknown.status).toBe(409)
    expect(unknown.body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: REFUND_BUSY } })
    expect(fake(world).portone.status(paymentId)).toBe('CANCELLED')
    // 환불 중: 그 정액 이용권으로 시작하지 않는다
    const during = await status(world, seller)
    expect(during.start).toEqual({ allowed: false, reason: 'NO_PASS' })
    expect(during.flat).toMatchObject({ active: false })
    expect((await start(world, seller)).status).toBe(422)
    // 두 번째 환불(다른 요청 번호)도 409 — 결제 취소를 다시 요청하지 않는다
    const second = await refund(world, seller, paymentId)
    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: REFUND_BUSY } })
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect(await revocations(world)).toBe(0)
    // 조회가 돌아온 뒤 결제 내역을 열면 맞춘다 → 회수·환불함
    fake(world).portone.lookupFailure = false
    expect((await payments(world, seller))[0]).toMatchObject({ paymentId, state: 'REFUNDED', refunding: false })
    expect(await revocations(world)).toBe(1)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    expect((await status(world, seller)).start).toEqual({ allowed: false, reason: 'NO_PASS' })
  })

  it('(b) 5xx(실제로는 취소 안 함) + 조회 실패 → 409, 잔량에 쓰지 않음 → 맞추면 환불 중만 풀리고 다시 쓸 수 있다(회수 없음)', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1')
    fake(world).portone.cancelFailure = true
    fake(world).portone.lookupFailure = true
    const unknown = await refund(world, seller, paymentId)
    expect(unknown.status).toBe(409)
    expect(unknown.body).toEqual({ error: { code: 'REFUND_IN_PROGRESS', message: REFUND_BUSY } })
    expect(fake(world).portone.status(paymentId)).toBe('PAID')
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 0 })
    expect((await start(world, seller)).status).toBe(422)
    // 조회가 아직 안 되면 결제 내역을 열어도 그대로 (환불 중)
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refunding: true, refundable: false })
    // 두 번째 환불도 409, 조회가 안 되니 취소를 다시 요청하지 않는다
    expect((await refund(world, seller, paymentId)).status).toBe(409)
    expect(fake(world).portone.cancelCalls.get(paymentId)).toBe(1)
    // 조회가 돌아오면 결제 그대로 → 환불 중만 푼다
    fake(world).portone.lookupFailure = false
    expect((await payments(world, seller))[0]).toMatchObject({ state: 'GRANTED', refunding: false, refundable: true })
    expect(await revocations(world)).toBe(0)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
    expect((await start(world, seller)).status).toBe(200)
  })
})

describe('AC-PL1B-22 밖에서 취소된 결제 (BL-7 6, D-PL1-08)', () => {
  it('부여된 카드 결제가 밖에서 취소 → 다시 확인으로 맞춤 → 확인 필요·PAYMENT_REVIEW 한 번(결제 ID·금액·판매자 이름 없음)·운영자 목록, 이용권 그대로라 바로 실제 방송 시작', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paymentId = await buy(world, seller, 'days-1', 'CARD')
    fake(world).portone.setStatus(paymentId, 'CANCELLED', 5000, 'CARD')
    const first = await confirm(world, seller, paymentId)
    expect(first.status, first.text).toBe(200)
    expect(first.body).toMatchObject({ state: 'NEEDS_REVIEW' })
    expect((await payments(world, seller))[0]).toMatchObject({ paymentId, state: 'NEEDS_REVIEW', refundable: false, refunding: false })
    const reviews = world.logs.filter((record) => record.code === 'PAYMENT_REVIEW')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.level).toBe('warn')
    const logs = JSON.stringify(world.logs)
    for (const secret of [paymentId, '5000', '5,000', '다육 상회', seller.loginId]) expect(logs).not.toContain(secret)
    const lists = await operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), world.clock.now())
    expect(lists.review.map((row) => row.paymentId)).toEqual([paymentId])
    // 회수하지 않는다 — 바로 새 실제 방송을 시작할 수 있다
    expect(await revocations(world)).toBe(0)
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 1 })
    expect((await start(world, seller)).status).toBe(200)
    // 다시 맞춰도 같은 상태 — 두 번 올리지 않는다
    expect((await confirm(world, seller, paymentId)).body).toMatchObject({ state: 'NEEDS_REVIEW' })
    await payments(world, seller)
    expect(world.logs.filter((record) => record.code === 'PAYMENT_REVIEW')).toHaveLength(1)
    expect((await operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), world.clock.now())).review).toHaveLength(1)
  })
})
