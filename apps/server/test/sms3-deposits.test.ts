// AC-SMS3-19~23: 휴대폰 알림 입금 (DEPOSIT_RULES DP-9 8·9, DP-5 "먼저 보는 것", DP-INV-6·7) — 믿을 입금 자동 확인, 믿지 않는 곳, 잔액 이어짐, 외부 키, 출금·입금 취소·읽지 못함.
import type { PGlite } from '@electric-sql/pglite'
import { getSettlement } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { balancesOf } from '../src/deposit/phone-store.ts'
import { settlementEvents } from './deposit-support.ts'
import { client, expectOk, login, type Seller, type TestServer } from './support.ts'
import { SMS3_DAY, app, claimsOf, inboxWorld, liveSale, sms, statuses } from './sms3-support.ts'

interface Item {
  readonly no: number
  readonly status: string
  readonly name: string
  readonly amount: number
  readonly source: { kind: string; label: string }
  readonly review?: { reason: string; preselect: { date: string; buyer: string } | null }
}

async function list(world: TestServer, seller: Seller, status = 'REVIEW'): Promise<Item[]> {
  return (await expectOk(client(world, seller.cookie).get(`/api/deposits?status=${status}`))).body.deposits as Item[]
}

const SHINHAN = '1577-8000'
const notice = (time: string, amount: string, balance: string, name = '김영희') => `[Web발신]\n신한10/31 ${time}\n110-***-123456\n입금 ${amount}\n잔액 ${balance}\n ${name}`

/** 실제 방송 15번을 휴대폰 문자로 김영희(010-2222-3333)가 1등 → 묶음 14,000원 */
async function soldToYounghee() {
  const w = await inboxWorld()
  const sale = await liveSale(w.world, w.seller, [15])
  expect(await statuses(w.world, w.token, [sms('buy', '010-2222-3333', '15 김영희')])).toEqual(['SAVED'])
  w.world.clock.advance(60_000)
  const [claim] = await claimsOf(w.world, w.seller)
  return { ...w, sale, buyer: claim?.currentBuyer as string }
}

describe('AC-SMS3-19 믿을 입금 자동 확인', () => {
  it('신한 대표번호 입금(앞선 잔액 없음) → 휴대폰 알림 입금이 자동 확인되고 메모는 DP-6 그대로', async () => {
    const { world, seller, token, buyer } = await soldToYounghee()
    expect(await statuses(world, token, [sms('dep', SHINHAN, notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED'])
    const [auto] = await list(world, seller, 'AUTO_APPLIED')
    expect(auto).toMatchObject({ no: 1, status: 'AUTO_APPLIED', name: '김영희', amount: 14_000, source: { kind: 'PHONE', label: '휴대폰 알림' } })
    const events = await settlementEvents(world, seller, SMS3_DAY)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'settlement.payment', actor: { kind: 'deposit' }, fields: { buyer, amount: 14_000, memo: '자동 입금 확인 · 입금 #1' } })
    const state = (await world.server.writer.read(seller.sellerId, SMS3_DAY)).state
    expect(getSettlement(state, buyer, SMS3_DAY)).toMatchObject({ payment: 'PAID' })
  })
})

describe('AC-SMS3-20 믿지 않는 곳', () => {
  it('같은 글이 1600-0000에서 → 저장되지만 확인 필요 UNTRUSTED_SOURCE, 미리 고른 후보 = 김영희 묶음, 다시 열어도 ONE_MATCH가 아니다', async () => {
    const { world, seller, token, buyer } = await soldToYounghee()
    expect(await statuses(world, token, [sms('dep', '1600-0000', notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED'])
    for (let round = 0; round < 2; round++) {
      const [item] = await list(world, seller)
      expect(item?.review).toMatchObject({ reason: 'UNTRUSTED_SOURCE', preselect: { date: SMS3_DAY, buyer } })
    }
    expect(await settlementEvents(world, seller, SMS3_DAY)).toEqual([])
  })
})

describe('AC-SMS3-21 잔액 이어짐', () => {
  it('앞 잔액 1,014,000 + 14,000 = 1,028,000이면 이어짐(자동 확인)', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    await statuses(world, token, [sms('dep', SHINHAN, notice('20:05', '14,000', '1,028,000'))])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })

  it('잔액 1,030,000이면 확인 필요 BALANCE_GAP', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    await statuses(world, token, [sms('dep', SHINHAN, notice('20:05', '14,000', '1,030,000'))])
    const [item] = await list(world, seller)
    expect(item?.review?.reason).toBe('BALANCE_GAP')
    expect(await settlementEvents(world, seller, SMS3_DAY)).toEqual([])
  })

  it('사이에 출금(잔액 1,009,000, 20:03)이 있으면 1,028,000은 BALANCE_GAP, 1,023,000이면 이어짐. 다른 은행 잔액은 쓰지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [
      app('w1', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000'),
      sms('w2', SHINHAN, '신한 10/31 20:03 체크카드 승인 5,000 잔액 1,009,000'),
      sms('kb', '1588-9999', '[KB]10/31 20:04 출금 1,000 잔액 5,000,000'),
    ])
    await statuses(world, token, [sms('gap', SHINHAN, notice('20:05', '14,000', '1,028,000', '이몽룡'))])
    expect((await list(world, seller))[0]?.review?.reason).toBe('BALANCE_GAP')
    await statuses(world, token, [sms('ok', SHINHAN, notice('20:06', '14,000', '1,042,000'))])
    // 앞 알림(1,028,000 — 끊겼지만 잔액은 기록됨) + 14,000 = 1,042,000 → 이어짐 → 자동 확인
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })
})

describe('AC-SMS3-22 외부 키', () => {
  it('같은 입금을 문자와 앱 알림으로 → 입금 하나(bal: 키), 두 번째도 SAVED', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('s', SHINHAN, notice('20:05', '14,000', '1,028,000')), app('a', 'com.shinhan.sbanking', '신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희')])).toEqual(['SAVED', 'SAVED'])
    const pg = world.database.pglite as PGlite
    const rows = await pg.query<{ external_key: string }>('select external_key from deposits')
    expect(rows.rows.map((row) => row.external_key)).toEqual(['bal:SHINHAN:2026-10-31T20:05:00+09:00:14000:1028000'])
    expect(await list(world, seller)).toEqual([])
  })

  it('잔액 없는 같은 내용 알림 둘(다른 id) → 입금 둘, 두 번째는 POSSIBLE_DUPLICATE', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('k1', 'com.kakaobank.channel', '입금 14,000원', '김영희', '2026-10-31T20:05:00+09:00'), app('k2', 'com.kakaobank.channel', '입금 14,000원', '김영희', '2026-10-31T20:05:00+09:00')])
    const all = [...(await list(world, seller, 'AUTO_APPLIED')), ...(await list(world, seller))]
    expect(all).toHaveLength(2)
    expect(all.find((item) => item.no === 2)?.review?.reason).toBe('POSSIBLE_DUPLICATE')
  })
})

describe('AC-SMS3-23 출금·입금 취소·읽지 못함', () => {
  it('믿을 출금 → 입금 없음·잔액 기록만, 입금 취소 → 은행 알림 줄(엔진 기록 없음), 읽지 못함 → 은행 알림 줄, 믿지 않는 곳·NONE → IGNORED', async () => {
    const { world, seller, token } = await soldToYounghee()
    const results = await statuses(world, token, [
      sms('w', SHINHAN, '신한 10/31 20:03 출금 5,000원 잔액 1,009,000 편의점'),
      app('c', 'com.kakaobank.channel', '입금취소 14,000원', '홍길동'),
      sms('u', '1588-9999', '[KB] 입금 14,000 출금 14,000'),
      sms('x1', '1600-0000', '출금 5,000 잔액 1,000'),
      sms('x2', '1600-0000', '홍길동 입금취소 14,000'),
      sms('x3', '1600-0000', '[KB] 입금 14,000 출금 14,000'),
      sms('x4', '1588-9999', '[KB] 보안카드 재발급 안내'),
    ])
    expect(results).toEqual(['SAVED', 'SAVED', 'SAVED', 'IGNORED', 'IGNORED', 'IGNORED', 'IGNORED'])
    expect([...(await list(world, seller)), ...(await list(world, seller, 'AUTO_APPLIED'))]).toEqual([])
    expect(await settlementEvents(world, seller, SMS3_DAY)).toEqual([])
    const balances = await balancesOf(world.database.db, seller.sellerId)
    expect(balances.map((row) => [row.bank, row.balance])).toEqual([['SHINHAN', 1_009_000]])
    const pg = world.database.pglite as PGlite
    expect(await pg.query('select * from bank_balances').then((r) => Object.keys(r.rows[0] as object).sort())).toEqual(['at', 'balance', 'bank', 'created_at', 'id', 'seller_id'])
    const api = client(world, seller.cookie)
    const alerts = (await expectOk(api.get('/api/deposits/alerts'))).body.alerts as { id: number; kind: string; bankName: string; message: string; amount: number | null; name: string | null }[]
    expect(alerts.map((alert) => [alert.kind, alert.bankName, alert.message])).toEqual([
      ['UNREADABLE', 'KB국민', '읽지 못한 은행 알림이에요. 은행 앱에서 확인하고 필요하면 정산에서 손으로 적어 주세요'],
      ['CANCEL', '카카오뱅크', '입금 취소 알림이 왔어요: 14,000원 홍길동. 이 입금을 확인했다면 되돌려 주세요'],
    ])
    await expectOk(api.post(`/api/deposits/alerts/${String(alerts[0]?.id)}/close`, {}))
    expect(((await expectOk(api.get('/api/deposits/alerts'))).body.alerts as unknown[]).length).toBe(1)
    world.clock.advance(30 * 86_400_000 + 1)
    const again = client(world, await login(world, seller.loginId, seller.password))
    expect(((await expectOk(again.get('/api/deposits/alerts'))).body.alerts as unknown[]).length).toBe(0)
  })
})
