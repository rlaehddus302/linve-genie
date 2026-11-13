// 정산 정보 (D-RETRO-60·61): 정산서에 찍는 계좌·전화번호·방송 이름과 배송비 규칙의 저장·조회·검사
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sellers } from '../src/db/schema.ts'
import { formatLog } from '../src/log.ts'
import { checkStatementInput, shippingFromSettings, shippingSettings, STATEMENT_SHIPPING_DEFAULT } from '../src/statement-info.ts'
import { statementShipping, statementTotals } from '../../web/src/lib/broadcast-sales.ts'
import { addSeller, client, newWorld } from './support.ts'

const FULL = { bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', phone: '010-1234-5678', hostName: '홍재라이브', shipping: { charge: true, fee: 5000, freeFrom: 50000 } }
const SHOP_NOW = { name: '초록다육', accountNote: '' }

describe('정산서 배송비 계산 (정수 원)', () => {
  it('기본값은 5만 원 미만 5,000원 — 49,999원은 받고 50,000원부터 무료', () => {
    expect(STATEMENT_SHIPPING_DEFAULT).toEqual({ charge: true, fee: 5000, freeFrom: 50000 })
    expect([0, 1, 49999, 50000, 50001].map((subtotal) => statementShipping(subtotal))).toEqual([5000, 5000, 5000, 0, 0])
    expect(statementTotals(49999, STATEMENT_SHIPPING_DEFAULT)).toEqual({ charged: true, shipping: 5000, total: 54999 })
    expect(statementTotals(50000, STATEMENT_SHIPPING_DEFAULT)).toEqual({ charged: true, shipping: 0, total: 50000 })
  })

  it('판매자가 정한 금액·기준을 쓰고, 기준이 없으면 늘 받고, 받지 않으면 0원에 줄도 없다', () => {
    const rule = { charge: true, fee: 3500, freeFrom: 30000 }
    expect([29999, 30000].map((subtotal) => statementShipping(subtotal, rule))).toEqual([3500, 0])
    expect(statementShipping(1_000_000, { charge: true, fee: 4000, freeFrom: null })).toBe(4000)
    expect(statementTotals(10000, { charge: false, fee: 0, freeFrom: null })).toEqual({ charged: false, shipping: 0, total: 10000 })
    // 금액을 모르는 줄이 있으면 합계도 모른다
    expect(statementTotals(null, rule)).toEqual({ charged: true, shipping: null, total: null })
    for (const subtotal of [0, 49999, 50000, 123456]) expect(Number.isInteger(statementTotals(subtotal, STATEMENT_SHIPPING_DEFAULT).total)).toBe(true)
  })

  it('판매 규칙 두 칸과 정산서 규칙은 서로 바뀐다 (받지 않음 = 0원 · 기준 없음)', () => {
    expect(shippingSettings({ charge: true, fee: 5000, freeFrom: 50000 })).toEqual({ 'shipping.baseFee': 5000, 'shipping.freeThreshold': 50000 })
    expect(shippingSettings({ charge: false, fee: 9999, freeFrom: 1 })).toEqual({ 'shipping.baseFee': 0, 'shipping.freeThreshold': null })
    expect(shippingFromSettings({})).toBeNull()
    expect(shippingFromSettings({ 'thanks.liveChat': false })).toBeNull()
    expect(shippingFromSettings({ 'shipping.baseFee': 0, 'shipping.freeThreshold': 50000 })).toEqual({ charge: false, fee: 0, freeFrom: null })
    expect(shippingFromSettings({ 'shipping.baseFee': 3000 })).toEqual({ charge: true, fee: 3000, freeFrom: null })
    // 무료 기준만 고른 판매자: 기본 배송비는 날짜별 정산이 쓰는 엔진 기본값(4,000원)
    expect(shippingFromSettings({ 'shipping.freeThreshold': 50000 })).toEqual({ charge: true, fee: 4000, freeFrom: 50000 })
  })
})

describe('정산 정보 입력 검사', () => {
  const problemsOf = (body: unknown) => {
    const result = checkStatementInput(body, SHOP_NOW)
    return result.ok ? [] : result.rejection.problems.map((problem) => problem.field)
  }

  it('앞뒤 빈칸을 지우고 쉼표가 든 금액 글도 정수 원으로 받는다', () => {
    const result = checkStatementInput({ ...FULL, phone: ' 010-1234-5678 ', hostName: ' 홍재라이브 ', shipping: { charge: true, fee: '5,000', freeFrom: '50000' } }, SHOP_NOW)
    expect(result).toEqual({ ok: true, value: FULL })
    // 다 비워도 저장된다 (정산서에서 그 줄이 빠진다) · 받지 않으면 금액 칸은 보지 않는다
    expect(checkStatementInput({ bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: { charge: false, fee: 'abc', freeFrom: -1 } }, SHOP_NOW)).toEqual({
      ok: true,
      value: { bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: { charge: false, fee: 0, freeFrom: null } },
    })
    expect(checkStatementInput({ ...FULL, shipping: { charge: true, fee: 4000, freeFrom: null } }, SHOP_NOW)).toMatchObject({ ok: true, value: { shipping: { charge: true, fee: 4000, freeFrom: null } } })
  })

  it('계좌 일부만·글자 섞인 전화번호·소수나 0원 배송비·모르는 칸은 받지 않는다', () => {
    expect(problemsOf({ ...FULL, accountHolder: '' })).toEqual(['accountHolder'])
    expect(problemsOf({ ...FULL, accountNumber: '계좌번호' })).toEqual(['accountNumber'])
    for (const phone of ['010-abcd-5678', '1234567', '0'.repeat(21), '010\n1234\n5678', 1012345678]) expect(problemsOf({ ...FULL, phone })).toEqual(['phone'])
    expect(problemsOf({ ...FULL, hostName: '가'.repeat(21) })).toEqual(['hostName'])
    for (const fee of [0, -1, 5000.5, '5000.5', '오천원', 1_000_001, null]) expect(problemsOf({ ...FULL, shipping: { charge: true, fee, freeFrom: 50000 } })).toEqual(['shipping.fee'])
    for (const freeFrom of [0, -5, 49999.5, '5만', 100_000_001]) expect(problemsOf({ ...FULL, shipping: { charge: true, fee: 5000, freeFrom } })).toEqual(['shipping.freeFrom'])
    for (const shipping of [undefined, null, 'yes', { fee: 5000 }, { charge: 'true', fee: 5000 }, { charge: true, fee: 5000, freeFrom: null, extra: 1 }]) expect(problemsOf({ ...FULL, shipping })).toEqual(['shipping'])
    const unknown = checkStatementInput({ ...FULL, name: '다른 가게' }, SHOP_NOW)
    expect(unknown).toMatchObject({ ok: false, rejection: { status: 400, code: 'UNKNOWN_FIELD' } })
    expect(checkStatementInput('글', SHOP_NOW)).toMatchObject({ ok: false, rejection: { code: 'NOT_JSON' } })
  })

  it('거절 문장에 받은 계좌번호·전화번호를 담지 않는다', () => {
    const result = checkStatementInput({ ...FULL, accountNumber: '302-비밀-7766', phone: '010-비밀-5678' }, SHOP_NOW)
    expect(result.ok).toBe(false)
    const text = JSON.stringify(result)
    expect(text).not.toContain('7766')
    expect(text).not.toContain('5678')
  })
})

describe('GET·PUT /api/statement-info', () => {
  it('처음에는 비어 있고 정하지 않음 — 배송비는 5만 원 미만 5,000원으로 보인다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const first = await client(world, seller.cookie).get('/api/statement-info')
    expect(first.status, first.text).toBe(200)
    expect(first.body.info).toEqual({ bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: { charge: true, fee: 5000, freeFrom: 50000 }, decided: false })
    expect((await client(world, null).get('/api/statement-info')).status).toBe(401)
  })

  it('저장하면 계좌는 가게 설정에, 배송비는 판매 규칙에 들어가고 전화번호는 암호화해 둔다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const api = client(world, seller.cookie)
    const saved = await api.put('/api/statement-info', FULL)
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.info).toEqual({ ...FULL, decided: true })
    expect((await api.get('/api/statement-info')).body.info).toEqual({ ...FULL, decided: true })
    expect((await api.get('/api/shop')).body.shop).toMatchObject({ bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매' })
    expect((await api.get('/api/settings')).body.settings).toMatchObject({ 'shipping.baseFee': 5000, 'shipping.freeThreshold': 50000 })
    // DB에는 전화번호가 그대로 남지 않는다
    const [row] = await world.database.db.select({ shop: sellers.shop }).from(sellers).where(eq(sellers.id, seller.sellerId))
    expect(row!.shop).not.toContain('1234')
    expect(row!.shop).not.toContain('5678')
    expect(JSON.parse(row!.shop)).toMatchObject({ statement: { hostName: '홍재라이브', decided: true } })
    // 서버 로그에 계좌번호·전화번호가 없다
    const logged = world.logs.map((entry) => formatLog(entry)).join('\n')
    expect(logged).not.toContain('010-1234-5678')
    expect(logged).not.toContain('302-9988-7766-11')
    // 다른 판매자에게는 보이지 않는다
    expect((await client(world, other.cookie).get('/api/statement-info')).body.info).toMatchObject({ phone: '', bank: '', decided: false })
  })

  it('배송비를 받지 않기로 하면 판매 규칙이 0원이 되고 다시 읽어도 받지 않음이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const saved = await api.put('/api/statement-info', { ...FULL, shipping: { charge: false, fee: 5000, freeFrom: 50000 } })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.info).toMatchObject({ shipping: { charge: false, fee: 0, freeFrom: null } })
    expect((await api.get('/api/settings')).body.settings).toMatchObject({ 'shipping.baseFee': 0, 'shipping.freeThreshold': null })
  })

  it('가게 설정에서 배송비를 이미 고른 판매자는 그 값이 정산서 규칙으로 보인다 (아직 정하지 않음 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.patch('/api/settings', { settings: { 'shipping.baseFee': 3000, 'shipping.freeThreshold': 30000 } })).status).toBe(200)
    expect((await api.get('/api/statement-info')).body.info).toMatchObject({ shipping: { charge: true, fee: 3000, freeFrom: 30000 }, decided: false })
  })

  it('가게 설정을 다시 저장해도 전화번호·방송 이름·정했다 표시가 남고, 가게 설정에서 고친 계좌가 정산 정보에 보인다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.put('/api/statement-info', FULL)).status).toBe(200)
    const shop = (await api.get('/api/shop')).body.shop as Record<string, string>
    expect((await api.put('/api/shop', { ...shop, bank: '국민', accountNote: '입금자명은 닉네임으로' })).status).toBe(200)
    expect((await api.put('/api/shop', { name: '새 가게 이름' })).status).toBe(200)
    expect((await api.get('/api/statement-info')).body.info).toEqual({ ...FULL, bank: '국민', decided: true })
    // 정산 정보를 다시 저장해도 입금 안내 문장은 그대로
    expect((await api.put('/api/statement-info', { ...FULL, phone: '' })).status).toBe(200)
    expect((await api.get('/api/shop')).body.shop).toMatchObject({ name: '새 가게 이름', bank: '농협', accountNote: '입금자명은 닉네임으로' })
    expect((await api.get('/api/statement-info')).body.info).toMatchObject({ phone: '', decided: true })
  })

  it('틀린 값은 저장하지 않고 칸별 문제를 돌려준다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const bad = await api.put('/api/statement-info', { ...FULL, accountHolder: '', shipping: { charge: true, fee: 5000.5, freeFrom: 50000 } })
    expect(bad.status).toBe(400)
    const error = bad.body.error as { code: string; problems: { field: string }[] }
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.problems.map((problem) => problem.field)).toEqual(['accountHolder', 'shipping.fee'])
    expect((await api.get('/api/statement-info')).body.info).toMatchObject({ bank: '', decided: false })
    expect((await api.get('/api/settings')).body.settings).toMatchObject({ 'shipping.baseFee': 4000, 'shipping.freeThreshold': null })
  })
})
