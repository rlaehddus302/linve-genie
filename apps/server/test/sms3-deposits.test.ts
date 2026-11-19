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
  // D-DEP2-13: 앞선 신한 잔액(1,014,000 — 20:01 알림)이 있어 이어짐이 확인될 때만 자동 확인 (예전 시험은 앞선 잔액 없이 자동 확인을 기대했다)
  it('신한 대표번호 입금(앞선 신한 잔액 1,014,000) → 휴대폰 알림 입금이 자동 확인되고 메모는 DP-6 그대로', async () => {
    const { world, seller, token, buyer } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
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

describe('AC-SMS3-19·21 잔액 이어짐이 확인될 때만 자동 (D-DEP2-13)', () => {
  it('앞선 신한 잔액 없음 → BALANCE_GAP(자동 아님), 그 잔액이 다음 이어짐의 앞 잔액이 되어 다음 신한 입금은 자동 확인', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('first', SHINHAN, notice('20:05', '14,000', '1,028,000', '이몽룡'))])).toEqual(['SAVED'])
    const [first] = await list(world, seller)
    expect(first?.review?.reason).toBe('BALANCE_GAP')
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect(await settlementEvents(world, seller, SMS3_DAY)).toEqual([])
    await statuses(world, token, [sms('next', SHINHAN, notice('20:06', '14,000', '1,042,000'))])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })

  it('잔액이 없는 믿을 입금 알림 → BALANCE_GAP, 자동으로 적지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    expect(await statuses(world, token, [sms('nobal', SHINHAN, '신한10/31 20:05 입금 14,000 김영희')])).toEqual(['SAVED'])
    const [item] = await list(world, seller)
    expect(item?.review?.reason).toBe('BALANCE_GAP')
    expect(await settlementEvents(world, seller, SMS3_DAY)).toEqual([])
  })
})

describe('AC-SMS3-20 믿지 않는 곳', () => {
  it('[국제발신]·[해외 발신]·[국외발신]이 붙은 신한 대표번호 입금 → UNTRUSTED_SOURCE (D-DEP2-12)', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    expect(await statuses(world, token, [sms('o1', SHINHAN, `[국제발신]${notice('20:05', '14,000', '1,028,000')}`), sms('o2', SHINHAN, `[해외 발신] ${notice('20:06', '14,000', '1,042,000')}`), app('o3', 'com.shinhan.sbanking', '[국외발신]', '신한 10/31 20:04 입금 14,000 잔액 1,056,000 김영희')])).toEqual(['SAVED', 'SAVED', 'SAVED'])
    const items = await list(world, seller)
    expect(items.map((item) => item.review?.reason)).toEqual(['UNTRUSTED_SOURCE', 'UNTRUSTED_SOURCE', 'UNTRUSTED_SOURCE'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
  })

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
  // D-DEP2-14: 키의 시각은 분까지 — 문자 20:05(분)와 앱 알림 20:05:15(초)가 같은 입금. D-DEP2-13: 앞선 신한 잔액이 있어야 자동 확인이라 20:01 알림을 먼저 둔다
  it('같은 입금을 문자(20:05)와 앱 알림(20:05:15)으로 → 입금 하나(bal: 키 — 시각은 분까지), 두 번째도 SAVED', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    expect(await statuses(world, token, [sms('s', SHINHAN, notice('20:05', '14,000', '1,028,000')), app('a', 'com.shinhan.sbanking', '신한 10/31 20:05:15', '입금 14,000 잔액 1,028,000 김영희')])).toEqual(['SAVED', 'SAVED'])
    const pg = world.database.pglite as PGlite
    const rows = await pg.query<{ external_key: string }>('select external_key from deposits')
    expect(rows.rows.map((row) => row.external_key)).toEqual(['bal:SHINHAN:2026-10-31T20:05:14000:1028000'])
    expect(await list(world, seller)).toEqual([])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })

  // D-DEP2-18: 은행 앱 알림은 잔액이 없어도 표시하지 않는다 — 첫째는 자동 확인, 같은 내용의 둘째는 DP-5 쌍둥이로 확인 필요.
  // (D-DEP2-13 때는 둘 다 BALANCE_GAP을 기대했다 — 카카오뱅크·토스 앱 알림 입금이 늘 확인 필요로 남아 "입금 인식이 안 됨"의 원인)
  it('잔액 없는 같은 내용 앱 알림 둘(다른 id) → 입금 둘, 첫째 자동 확인·둘째는 쌍둥이라 확인 필요', async () => {
    const { world, seller, token } = await soldToYounghee()
    world.clock.advance(5 * 60_000)
    await statuses(world, token, [app('k1', 'com.kakaobank.channel', '입금 14,000원', '김영희', '2026-10-31T20:05:00+09:00'), app('k2', 'com.kakaobank.channel', '입금 14,000원', '김영희', '2026-10-31T20:05:00+09:00')])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
    const review = await list(world, seller)
    expect(review).toHaveLength(1)
    expect(review[0]?.review?.reason).not.toBe('BALANCE_GAP')
    expect(await settlementEvents(world, seller, SMS3_DAY)).toHaveLength(1)
  })
})

describe('D-DEP2-18 은행 앱 알림 입금 (잔액이 없는 카카오뱅크·토스 알림)', () => {
  it('카카오뱅크 앱 알림(잔액 없음, 앞선 잔액 없음) → 바로 자동 확인, 정산에 입금 완료', async () => {
    const { world, seller, token, buyer } = await soldToYounghee()
    expect(await statuses(world, token, [app('k', 'com.kakaobank.channel', '입금 14,000원', '김영희 → 내 입출금통장(1234)')])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toMatchObject([{ name: '김영희', amount: 14_000, source: { kind: 'PHONE' } }])
    const state = (await world.server.writer.read(seller.sellerId, SMS3_DAY)).state
    expect(getSettlement(state, buyer, SMS3_DAY)).toMatchObject({ payment: 'PAID' })
  })

  it('토스 문장 "…님이 …원을 입금하셨습니다" → 이름을 읽어 자동 확인', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('t', 'viva.republica.toss', null, '김영희님이 14,000원을 입금하셨습니다.')])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })

  it('NH올원뱅크 앱도 믿는 은행 앱 — 자동 확인', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('n', 'com.nonghyup.nhallonebank', 'NH농협 입금', '14,000원 김영희')])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })

  it('앱 알림이라도 잔액이 앞선 잔액과 이어지지 않으면 BALANCE_GAP (빠진 알림)', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [app('w', 'com.shinhan.sbanking', null, '신한 10/31 20:01 출금 1,000 잔액 1,014,000')])
    expect(await statuses(world, token, [app('d', 'com.shinhan.sbanking', '신한 10/31 20:05', '입금 14,000 잔액 1,030,000 김영희')])).toEqual(['SAVED'])
    expect((await list(world, seller))[0]?.review?.reason).toBe('BALANCE_GAP')
  })

  it('잔액 없는 은행 문자(대표번호)는 그대로 BALANCE_GAP — 문자는 흉내 낼 수 있다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('s', SHINHAN, '신한10/31 20:05 입금 14,000 김영희')])).toEqual(['SAVED'])
    expect((await list(world, seller))[0]?.review?.reason).toBe('BALANCE_GAP')
  })

  it('표 밖 앱(메신저 등)의 입금 모양 알림은 그대로 UNTRUSTED_SOURCE', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('x', 'com.example.fakebank', '입금 14,000원', '김영희')])).toEqual(['SAVED'])
    expect((await list(world, seller))[0]?.review?.reason).toBe('UNTRUSTED_SOURCE')
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

  it('입금자명이 빈 글인 입금 취소 → 은행 알림 줄에 "이름 모름"(D-DEP2-15), name은 null', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('c', 'com.kakaobank.channel', '입금취소 14,000원', '')])).toEqual(['SAVED'])
    const alerts = (await expectOk(client(world, seller.cookie).get('/api/deposits/alerts'))).body.alerts as { name: string | null; message: string }[]
    expect(alerts.map((alert) => [alert.name, alert.message])).toEqual([[null, '입금 취소 알림이 왔어요: 14,000원 이름 모름. 이 입금을 확인했다면 되돌려 주세요']])
  })
})
