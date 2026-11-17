// AC-CRM1-03~10·12·16·18 손님 기록 모으기 (PGlite, 서버 쓰기 경로 그대로): 표지로 날짜를 넘어 한 번만, 플랫폼이 다르면 다른 손님, 전화번호 없는 문자 손님은 그날만,
// 리허설 제외, 30일 봉인 날짜, '입금 안 함' 사유 읽기, 입금·되돌리기, 오늘 = 서버 시각의 KST 날짜, 설정을 바꾸면 바로 다시 셈, "모든 손님" 쪽·정렬·찾기, 조회는 아무것도 쓰지 않는다.
import { describe, expect, it } from 'vitest'
import { factsBuildCount } from '../src/customers/facts.ts'
import { depositApi, depositWorld, pasteText } from './deposit-support.ts'
import { at, buy, chat, countOf, crm, crmWorld, kst, ok, payAll, type Row } from './crm1-support.ts'
import { addSeller, client, createBroadcast, expectOk, login } from './support.ts'

describe('AC-CRM1-03 표지로 날짜를 넘어 한 번만 따라간다', () => {
  it('10-15 UC_A(sms:r1 합침)의 기록 = 채널로 10-01·10-08·10-15 + 전화번호 키로 10-20(sms:r9) — 10-20 묶음의 다른 구성원으로 넓히지 않는다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    for (const [date, price] of [['2026-10-01', 30_000], ['2026-10-08', 15_000]] as const) {
      await buy(world, seller, date, 'UC_A', '다육이맘', price)
      await payAll(world, seller, date, 'UC_A')
    }
    const d15 = await buy(world, seller, '2026-10-15', 'UC_A', '다육이맘', 12_000)
    await ok(world, seller, { type: 'product.register', b: d15.b, no: 500, name: '문자 품종', price: 8000 })
    const r1 = (await ok(world, seller, { type: 'sms', b: d15.b, no: 500, received: '20:00', phone: '010-5555-1234' })).body.buyer as string
    await ok(world, seller, { type: 'buyer.merge', from: r1, into: 'UC_A', reason: '같은 사람' }, '2026-10-15')
    await payAll(world, seller, '2026-10-15', 'UC_A')
    // 10-20: 같은 전화번호의 문자 구매자 r9(입금 완료 10,000) + 그날 r9 아래 합친 유튜브 UC_Q
    at(world, '2026-10-20', '20:00:00')
    const d20 = (await createBroadcast(world, seller, { date: '2026-10-20' })).id
    await ok(world, seller, { type: 'product.register', b: d20, no: 1, name: '하나', price: 10_000 })
    const r9 = (await ok(world, seller, { type: 'sms', b: d20, no: 1, received: '20:00', phone: '010-5555-1234' })).body.buyer as string
    await chat(world, seller, d20, 'q0', 'UC_Q', '큐', '안녕')
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_Q', into: r9, reason: '같은 사람' }, '2026-10-20')
    await payAll(world, seller, '2026-10-20', r9)
    // 10-22: UC_Q 혼자 산 날 (10-20 묶음의 다른 구성원 표지 — 따라가지 않는다)
    await buy(world, seller, '2026-10-22', 'UC_Q', '큐', 50_000)
    await payAll(world, seller, '2026-10-22', 'UC_Q')
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-15', 'UC_A')).toEqual({ purchaseDays: 4, purchaseTotal: 75_000, lastPurchase: '2026-10-20', unpaidDays: 0, lastUnpaid: null, cancels: 0, passes: 0, regular: true, caution: false, passWarning: false })
    // 합쳐진 구매자 ID로 물어도 지금의 구매자로 푼다
    expect((await expectOk(c.day('2026-10-15', r1))).body.buyer).toBe('UC_A')
    // 10-20의 r9 기록 = 그날(UC_Q 포함 묶음 10,000) + 전화번호 키로 10-15 UC_A 묶음(20,000) + UC_Q 채널로 10-22(50,000)
    expect((await c.summary('2026-10-20', r9)).purchaseTotal).toBe(80_000)
  })
})

describe('AC-CRM1-04 플랫폼이 다르면 다른 손님', () => {
  it('같은 닉네임 유튜브 UC_A·인스타 ig:777은 섞이지 않고 "모든 손님"에 두 줄', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await payAll(world, seller, '2026-10-01', 'UC_A')
    await buy(world, seller, '2026-10-08', 'ig:777', '다육이맘', 20_000)
    await payAll(world, seller, '2026-10-08', 'ig:777')
    expect((await c.summary('2026-10-01', 'UC_A')).purchaseTotal).toBe(10_000)
    expect((await c.summary('2026-10-08', 'ig:777')).purchaseTotal).toBe(20_000)
    const rows = await c.rows()
    expect(rows.map((row) => [row.name, row.kindLabel, row.platform, row.purchaseTotal])).toEqual([
      ['다육이맘', '인스타그램', 'INSTAGRAM', 20_000],
      ['다육이맘', '유튜브', 'YOUTUBE', 10_000],
    ])
  })
})

describe('AC-CRM1-05 전화번호 없는 문자 구매자는 그날만', () => {
  it('메모 "김씨" 문자 구매자 10-01·10-08 — 10-08 기록은 1번, "모든 손님"에 없음, 메모 칸 대신 손님 ID 없음', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const buyers: string[] = []
    for (const date of ['2026-10-01', '2026-10-08']) {
      at(world, date, '20:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 10_000 })
      const buyer = (await ok(world, seller, { type: 'sms', b, no: 1, received: '20:00', memo: '김씨' })).body.buyer as string
      await payAll(world, seller, date, buyer)
      buyers.push(buyer)
    }
    expect((await c.summary('2026-10-08', buyers[1] as string)).purchaseDays).toBe(1)
    expect(await c.rows()).toEqual([])
    const members = await c.members('2026-10-08', buyers[1] as string)
    expect(members).toEqual([expect.objectContaining({ buyer: buyers[1], kindLabel: '문자', phoneLast4: null, customer: null, memo: null })])
  })
})

describe('AC-CRM1-06 리허설은 넣지 않는다', () => {
  it('리허설 10-01 입금은 실제 10-08 기록에 없다. 리허설 날짜 조회는 404', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    at(world, '2026-10-01', '20:00:00')
    const r = (await createBroadcast(world, seller, { date: '2026-10-01', rehearsal: true })).id
    await ok(world, seller, { type: 'product.register', b: r, no: 1, name: '연습', price: 5000 })
    await chat(world, seller, r, 'r1', 'UC_A', '다육이맘', '1')
    await expectOk(client(world, seller.cookie).post('/api/events?rehearsal=true&date=2026-10-01', { requestId: 'rh-pay-1', type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-01', amount: 9000 }))
    await buy(world, seller, '2026-10-08', 'UC_A', '다육이맘', 10_000)
    await payAll(world, seller, '2026-10-08', 'UC_A')
    expect((await c.summary('2026-10-08', 'UC_A')).purchaseDays).toBe(1)
    expect((await c.rows()).map((row) => row.purchaseDays)).toEqual([1])
    for (const response of [await c.day('2026-10-01', 'UC_A', true), await c.dayList('2026-10-01', true)]) {
      expect(response.status).toBe(404)
      expect(response.text).not.toMatch(/purchase|unpaid/)
    }
    // 리허설만 있는 날짜의 실제 범위 조회도 없다
    expect((await c.dayList('2026-10-01')).status).toBe(404)
  })
})

describe('AC-CRM1-07 30일 봉인 날짜도 센다', () => {
  it('40일 전(봉인) UC_A 입금 완료 12,000 → 오늘 날짜의 기록에 구매 1번·12,000원, 봉인 날짜엔 아무것도 쓰지 않는다', async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-16', '09:00:00'))
    await buy(world, first, '2026-09-16', 'UC_A', '다육이맘', 12_000)
    await payAll(world, first, '2026-09-16', 'UC_A')
    at(world, '2026-10-26', '12:00:00')
    // 40일 뒤라 세션(30일)이 끝났다 — 다시 로그인
    const seller = { ...first, cookie: await login(world, first.loginId, first.password) }
    const c = crm(world, seller)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const sealed = await world.database.pglite?.query<{ sealed_at: Date | null; seq: number }>(`select sealed_at, seq from scopes where date = '2026-09-16'`)
    expect(sealed?.rows[0]?.sealed_at).not.toBeNull()
    const events = await countOf(world, 'events')
    await buy(world, seller, '2026-10-26', 'UC_A', '다육이맘', 3000)
    const after = await countOf(world, 'events')
    expect(await c.summary('2026-10-26', 'UC_A')).toMatchObject({ purchaseDays: 1, purchaseTotal: 12_000, lastPurchase: '2026-09-16' })
    expect((await c.rows())[0]).toMatchObject({ purchaseDays: 1, purchaseTotal: 12_000 })
    expect(await countOf(world, 'events')).toBe(after)
    expect(after).toBeGreaterThan(events)
    const again = await world.database.pglite?.query<{ seq: number }>(`select seq from scopes where date = '2026-09-16'`)
    expect(again?.rows[0]?.seq).toBe(sealed?.rows[0]?.seq)
  })
})

describe("AC-CRM1-08 '입금 안 함' 사유 읽기", () => {
  it('1등 취소 셋(사유 변형)·대기 취소·교체 취소 → 미입금 10-01·10-02·10-05 = 3번, 취소 4번', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const reasons: [string, string][] = [['2026-10-01', '입금 안 함'], ['2026-10-02', ' 입금안함 '], ['2026-10-03', '입금 안 함 (연락 없음)']]
    for (const [date, reason] of reasons) {
      const { b, no } = await buy(world, seller, date, 'UC_A', '다육이맘', 10_000)
      await ok(world, seller, { type: 'host.cancel', b, no, buyer: 'UC_A', reason })
    }
    // 10-04: UC_Z가 1등, UC_A는 대기 → 대기 찜을 '입금 안 함'으로 취소 (1등이 아니었다)
    const d4 = await buy(world, seller, '2026-10-04', 'UC_Z', '제트', 10_000)
    await chat(world, seller, d4.b, 'w4', 'UC_A', '다육이맘', String(d4.no))
    await ok(world, seller, { type: 'host.cancel', b: d4.b, no: d4.no, buyer: 'UC_A', reason: '입금 안 함' })
    // 10-05: UC_A 1등을 직접 배정 교체(replaceTo=CANCEL)로 밀어냄
    const d5 = await buy(world, seller, '2026-10-05', 'UC_A', '다육이맘', 10_000)
    await chat(world, seller, d5.b, 'z5', 'UC_Z', '제트', '안녕')
    await ok(world, seller, { type: 'host.assign', b: d5.b, no: d5.no, buyer: 'UC_Z', reason: '입금 안 함', replace: 'UC_A', replaceTo: 'CANCEL' })
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-05', 'UC_A')).toEqual({ purchaseDays: 0, purchaseTotal: 0, lastPurchase: null, unpaidDays: 3, lastUnpaid: '2026-10-05', cancels: 4, passes: 0, regular: false, caution: true, passWarning: false })
    // 10-04 UC_Z(1등, 미입금 기한 지남)는 미입금 1번
    expect((await c.summary('2026-10-04', 'UC_Z')).unpaidDays).toBe(2)
  })
})

describe('D-PASS-01 손님 패스 횟수·패스 잦음 주의', () => {
  it('채팅 취소(승인)·사유 "손님 패스"·"시청자 요청"은 패스, 판매자 착오·찜 삭제는 패스가 아니다 → 취소 5번 중 패스 3번, 패스 잦음 주의', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    // 10-01: 손님이 채팅으로 거둠 (요청이면 승인)
    const d1 = await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await chat(world, seller, d1.b, 'x1', 'UC_A', '다육이맘', `${String(d1.no)} 패스`)
    await ok(world, seller, { type: 'host.approveCancel', b: d1.b, no: d1.no, buyer: 'UC_A' })
    // 10-02: 정산서 보낸 뒤 카톡으로 부분 패스 — 주문 상세 [상품 빼기] "손님이 패스했어요"
    const d2 = await buy(world, seller, '2026-10-02', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.cancel', b: d2.b, no: d2.no, buyer: 'UC_A', reason: '손님 패스' })
    // 10-03: 판매자가 잘못 넣은 찜 — 패스가 아니다
    const d3 = await buy(world, seller, '2026-10-03', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.cancel', b: d3.b, no: d3.no, buyer: 'UC_A', reason: '판매자 착오' })
    // 10-04: 콘솔 찜 삭제(까닭을 모른다) — 패스로 세지 않는다
    const d4 = await buy(world, seller, '2026-10-04', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.cancel', b: d4.b, no: d4.no, buyer: 'UC_A', reason: '판매자가 찜을 삭제했어요' })
    // 10-05: 빠른 선택 "시청자 요청"(공백 무시)
    const d5 = await buy(world, seller, '2026-10-05', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.reject', b: d5.b, no: d5.no, buyer: 'UC_A', reason: ' 시청자 요청 ' })
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-05', 'UC_A')).toMatchObject({ cancels: 5, passes: 3, passWarning: true, caution: false })
    // 패스 둘까지는 꼬리표가 없다 (다른 손님 UC_B)
    const e1 = await buy(world, seller, '2026-10-06', 'UC_B', '나래', 10_000)
    await ok(world, seller, { type: 'host.cancel', b: e1.b, no: e1.no, buyer: 'UC_B', reason: '손님 패스' })
    const e2 = await buy(world, seller, '2026-10-07', 'UC_B', '나래', 10_000)
    await ok(world, seller, { type: 'host.cancel', b: e2.b, no: e2.no, buyer: 'UC_B', reason: '손님패스' })
    expect(await c.summary('2026-10-07', 'UC_B')).toMatchObject({ cancels: 2, passes: 2, passWarning: false })
    // "모든 손님" 거르기 "패스 잦음 주의만"
    expect((await c.rows('filter=pass')).map((row) => row.name)).toEqual(['다육이맘'])
  })
})

describe('AC-CRM1-09 입금을 적으면 바로 빠지고, 되돌리면 다시 든다', () => {
  it('입금 확인(N3) 확정 → 미입금 0·구매 1번·15,000원(상품 합계), 되돌리기 → 미입금 1·구매 0. 손으로 적은 입금도 같다', async () => {
    const world = await depositWorld({ clock: (await import('./support.ts')).fakeClock(kst('2026-10-20', '09:00:00')) })
    const seller = await addSeller(world)
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-20', 'UC_A', '다육이맘', 15_000)
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-20', 'UC_A')).toMatchObject({ unpaidDays: 1, lastUnpaid: '2026-10-20', purchaseDays: 0 })
    const view = await expectOk(client(world, seller.cookie).get('/api/days/2026-10-20'))
    const total = (view.body.settlements as { buyer: string; total: number }[]).find((item) => item.buyer === 'UC_A')?.total as number
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-26 11:00:00', name: '모르는이름', amount: total }])))
    await expectOk(api.confirm(1, { date: '2026-10-20', buyer: 'UC_A', remaining: total }))
    expect(await c.summary('2026-10-20', 'UC_A')).toMatchObject({ unpaidDays: 0, purchaseDays: 1, purchaseTotal: 15_000 })
    await expectOk(api.revert(1))
    expect(await c.summary('2026-10-20', 'UC_A')).toMatchObject({ unpaidDays: 1, purchaseDays: 0, purchaseTotal: 0 })
    await payAll(world, seller, '2026-10-20', 'UC_A')
    expect(await c.summary('2026-10-20', 'UC_A')).toMatchObject({ unpaidDays: 0, purchaseDays: 1, purchaseTotal: 15_000 })
  })
})

describe('AC-CRM1-10 오늘 날짜는 서버 시각의 KST', () => {
  it('2026-10-25T15:30:00Z(KST 10-26 00:30) → 10-22 미입금 1번, 14:59:59Z(KST 10-25 23:59:59) → 0번', async () => {
    const { world, seller } = await crmWorld(kst('2026-10-22', '09:00:00'))
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-22', 'UC_A', '다육이맘', 10_000)
    world.clock.set(Date.parse('2026-10-25T15:30:00Z'))
    expect(await c.summary('2026-10-22', 'UC_A')).toMatchObject({ unpaidDays: 1, caution: true })
    expect((await expectOk(c.dayList('2026-10-22'))).body.today).toBe('2026-10-26')
    world.clock.set(Date.parse('2026-10-25T14:59:59Z'))
    expect(await c.summary('2026-10-22', 'UC_A')).toMatchObject({ unpaidDays: 0, caution: false })
  })
})

describe('AC-CRM1-11·12 설정 "손님 관리"', () => {
  it('기본값 3번·100,000원·3일, 틀린 값은 칸마다 문장으로 거절, 비운 금액 = 금액 기준 안 씀', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    expect((await expectOk(c.settings())).body).toEqual({ settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 } })
    const bad: [Record<string, unknown>, string, string][] = [
      [{ regularCount: 1, regularAmount: 100_000, waitDays: 3 }, 'regularCount', '단골 횟수는 2~99번으로 적어 주세요.'],
      [{ regularCount: 100, regularAmount: 100_000, waitDays: 3 }, 'regularCount', '단골 횟수는 2~99번으로 적어 주세요.'],
      [{ regularCount: 3, regularAmount: 999, waitDays: 3 }, 'regularAmount', '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'],
      [{ regularCount: 3, regularAmount: 100_000_001, waitDays: 3 }, 'regularAmount', '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'],
      [{ regularCount: 3, regularAmount: '10.5', waitDays: 3 }, 'regularAmount', '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'],
      [{ regularCount: 3, regularAmount: 10.5, waitDays: 3 }, 'regularAmount', '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'],
      [{ regularCount: 3, regularAmount: 100_000, waitDays: 0 }, 'waitDays', '입금 기다리는 날은 1~30일로 적어 주세요.'],
      [{ regularCount: 3, regularAmount: 100_000, waitDays: 31 }, 'waitDays', '입금 기다리는 날은 1~30일로 적어 주세요.'],
      [{ regularCount: 3, waitDays: 3 }, 'regularAmount', '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'],
    ]
    for (const [body, field, message] of bad) {
      const response = await c.saveSettings(body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field, message }] } })
    }
    expect((await c.saveSettings({ regularCount: 3, regularAmount: null, waitDays: 3, extra: 1 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await expectOk(c.settings())).body.settings).toEqual({ regularCount: 3, regularAmount: 100_000, waitDays: 3 })
    expect((await expectOk(c.saveSettings({ regularCount: 2, regularAmount: null, waitDays: 30 }))).body).toEqual({ settings: { regularCount: 2, regularAmount: null, waitDays: 30 } })
    expect((await expectOk(c.settings())).body.settings).toEqual({ regularCount: 2, regularAmount: null, waitDays: 30 })
    expect((await expectOk(c.saveSettings({ regularCount: 99, regularAmount: 1000, waitDays: 1 }))).body.settings).toEqual({ regularCount: 99, regularAmount: 1000, waitDays: 1 })
    expect((await expectOk(c.saveSettings({ regularCount: 2, regularAmount: 100_000_000, waitDays: 3 }))).body.settings).toEqual({ regularCount: 2, regularAmount: 100_000_000, waitDays: 3 })
  })

  it('단골 횟수를 2로 저장하면 다음 조회에서 바로 단골 — 이벤트 로그·판매 규칙 설정은 그대로', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 30_000)
    await payAll(world, seller, '2026-10-01', 'UC_A')
    await buy(world, seller, '2026-10-08', 'UC_A', '다육이맘', 15_000)
    await payAll(world, seller, '2026-10-08', 'UC_A')
    const before = (await expectOk(c.dayList('2026-10-08'))).body.customers as { buyer: string; regular: boolean; purchaseTotal: number }[]
    expect(before).toEqual([expect.objectContaining({ buyer: 'UC_A', regular: false, purchaseTotal: 45_000, purchaseDays: 2 })])
    const events = await countOf(world, 'events')
    const sale = (await expectOk(client(world, seller.cookie).get('/api/settings'))).body
    await expectOk(c.saveSettings({ regularCount: 2, regularAmount: 100_000, waitDays: 3 }))
    expect(((await expectOk(c.dayList('2026-10-08'))).body.customers as { regular: boolean }[])[0]?.regular).toBe(true)
    expect(await countOf(world, 'events')).toBe(events)
    expect((await expectOk(client(world, seller.cookie).get('/api/settings'))).body).toEqual(sale)
  })
})

describe('AC-CRM1-16 "모든 손님" 보기 목록', () => {
  it('기록 있는 표지 25개(+채팅만 5개) → 20줄 + 더 보기 → 5줄, 정렬·거르기·찾기(지난 닉네임·끝자리), 응답에 전화번호 키·번호 없음', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    at(world, '2026-10-10', '20:00:00')
    const b = (await createBroadcast(world, seller, { date: '2026-10-10' })).id
    for (let i = 1; i <= 24; i++) {
      await ok(world, seller, { type: 'product.register', b, no: i, name: `품종${String(i)}`, price: 1000 * i })
      await chat(world, seller, b, `p${String(i)}`, `UC_${String(i).padStart(2, '0')}`, `손님${String(i).padStart(2, '0')}`, String(i))
    }
    for (let i = 1; i <= 5; i++) await chat(world, seller, b, `look${String(i)}`, `UC_LOOK${String(i)}`, `구경${String(i)}`, '안녕하세요')
    await ok(world, seller, { type: 'product.register', b, no: 50, name: '문자 품종', price: 7000 })
    const smsBuyer = (await ok(world, seller, { type: 'sms', b, no: 50, received: '20:00', phone: '010-7777-4321', memo: '문자손님' })).body.buyer as string
    for (const id of ['UC_01', 'UC_02', 'UC_24']) await payAll(world, seller, '2026-10-10', id)
    // 10-12: UC_01이 이름을 바꿔 또 산다 (지난 날짜에만 쓴 닉네임으로 찾기)
    await buy(world, seller, '2026-10-12', 'UC_01', '새이름', 2000)
    await payAll(world, seller, '2026-10-12', 'UC_01')
    at(world, '2026-10-26', '12:00:00')
    const first = await expectOk(c.list())
    expect(first.body).toMatchObject({ count: 25, more: true, next: 20 })
    const page1 = first.body.customers as Row[]
    expect(page1).toHaveLength(20)
    const page2 = (await expectOk(c.list('offset=20'))).body
    expect(page2).toMatchObject({ more: false, next: null })
    const all = [...page1, ...(page2.customers as Row[])]
    expect(new Set(all.map((row) => row.id)).size).toBe(25)
    expect(all.some((row) => row.name.startsWith('구경'))).toBe(false)
    // 기본 누적 큰 순 (입금 완료만 누적): UC_24 24,000 → UC_01 3,000(1,000 + 2,000) → UC_02 2,000 → 나머지 0은 이름 순
    expect(all.slice(0, 4).map((row) => [row.name, row.purchaseTotal, row.purchaseDays])).toEqual([['손님24', 24_000, 1], ['새이름', 3000, 2], ['손님02', 2000, 1], ['문자찜(문자손님)', 0, 0]])
    const sms = all.find((row) => row.latestBuyer === smsBuyer) as Row
    expect(sms).toMatchObject({ kindLabel: '문자 · 끝자리 4321', platform: null, phoneLast4: '4321' })
    // 최근 산 순: 10-12(UC_01) → 10-10(UC_02·UC_24 이름 순) → 구매 없는 손님은 맨 뒤
    expect((await c.rows('sort=recent')).slice(0, 4).map((row) => row.name)).toEqual(['새이름', '손님02', '손님24', '문자찜(문자손님)'])
    // 미입금 많은 순 = 10-10 미입금(기한 지남) 1번씩, 같으면 누적 큰 순(모두 0) → 이름 순 — 미입금 없는 셋은 맨 뒤
    const unpaid = (await c.rows('sort=unpaid')).map((row) => [row.name, row.unpaidDays])
    expect(unpaid[0]).toEqual(['문자찜(문자손님)', 1])
    expect(unpaid[1]).toEqual(['손님03', 1])
    expect((await expectOk(c.list('sort=unpaid&offset=20'))).body.customers).toEqual(expect.arrayContaining([expect.objectContaining({ name: '손님24', unpaidDays: 0 })]))
    // 거르기
    await expectOk(c.saveSettings({ regularCount: 2, regularAmount: null, waitDays: 3 }))
    expect((await c.rows('filter=regular')).map((row) => row.name)).toEqual(['새이름'])
    expect((await expectOk(c.list('filter=caution'))).body.count).toBe(22)
    // 찾기: 지난 날짜에만 쓴 닉네임·끝자리 4개
    expect((await c.rows(`q=${encodeURIComponent('손님01')}`)).map((row) => row.name)).toEqual(['새이름'])
    expect((await c.rows('q=4321')).map((row) => row.latestBuyer)).toEqual([smsBuyer])
    expect((await c.list(`q=${encodeURIComponent('010-7777-4321')}`)).status).toBe(400)
    for (const query of ['sort=big', 'filter=x', 'offset=-1', 'offset=abc', `q=${'가'.repeat(41)}`]) expect((await c.list(query)).status, query).toBe(400)
    const keys = await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms'`)
    const phoneKey = (JSON.parse(keys?.rows[0]?.body ?? '{}') as { phoneKey?: string }).phoneKey as string
    expect(phoneKey.length).toBeGreaterThan(8)
    for (const text of [first.text, JSON.stringify(page2), (await expectOk(c.customer(sms.id))).text, (await expectOk(c.day('2026-10-10', smsBuyer))).text]) {
      expect(text).not.toContain(phoneKey)
      expect(text).not.toContain('010-7777-4321')
      expect(text).not.toContain('01077774321')
    }
  })

  it('손님 자세히: 날짜 줄(최근부터 — 그날 이름·상품 합계·입금 상태·미입금), 20개씩 before로 다음 쪽, 모르는 ID는 404', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const dates = Array.from({ length: 22 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    for (const [i, date] of dates.entries()) {
      await buy(world, seller, date, 'UC_A', `이름${String(i + 1)}`, 1000)
      if (i % 2 === 0) await payAll(world, seller, date, 'UC_A')
    }
    at(world, '2026-10-26', '12:00:00')
    const [row] = await c.rows()
    const detail = await expectOk(c.customer(row?.id as string))
    expect(detail.body).toMatchObject({ customer: { name: '이름22', purchaseDays: 11, unpaidDays: 11 }, memo: null, more: true, next: '2026-09-03' })
    const days = detail.body.days as { date: string; name: string; subtotal: number; payment: string; unpaid: boolean; buyer: string; openable: boolean }[]
    expect(days).toHaveLength(20)
    // CRM1 D-CRM1-12: 날짜 줄에 openable(그날 자세히를 열 수 있는지)을 더해 같은 단언에 함께 적음 — 약화 아님(봉인 날짜 보관 행 줄은 false, crm1-archive.test.ts)
    expect(days[0]).toEqual({ date: '2026-09-22', buyer: 'UC_A', name: '이름22', subtotal: 1000, payment: 'UNPAID', unpaid: true, openable: true })
    expect(days[1]).toEqual({ date: '2026-09-21', buyer: 'UC_A', name: '이름21', subtotal: 1000, payment: 'PAID', unpaid: false, openable: true })
    const next = await expectOk(c.customer(row?.id as string, '2026-09-03'))
    expect((next.body.days as { date: string }[]).map((day) => day.date)).toEqual(['2026-09-02', '2026-09-01'])
    expect(next.body).toMatchObject({ more: false, next: null })
    expect((await c.customer('0'.repeat(32))).status).toBe(404)
    expect((await c.customer('not-an-id')).status).toBe(404)
    expect((await c.customer(row?.id as string, '20261001')).status).toBe(400)
  })
})

describe('AC-CRM1-18·30 조회는 아무것도 쓰지 않고, 캐시를 써도 처음부터 센 것과 같다', () => {
  it('손님 기록 조회 전후로 이벤트·발송함·범위 seq가 같다. 같은 상태를 다시 보면 날짜 재료를 다시 만들지 않고, 입금이 들어오면 그 날짜만 다시 만든다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-01', 'UC_B', '비', 10_000)
    await buy(world, seller, '2026-10-08', 'UC_B', '비', 20_000)
    at(world, '2026-10-26', '12:00:00')
    const counts = async () => [await countOf(world, 'events'), await countOf(world, 'outbox'), JSON.stringify((await world.database.pglite?.query('select id, seq from scopes order by id'))?.rows)]
    const before = await counts()
    const first = await c.summary('2026-10-08', 'UC_B')
    expect(first).toMatchObject({ unpaidDays: 2, caution: true })
    await expectOk(c.dayList('2026-10-08'))
    await expectOk(c.list())
    expect(await counts()).toEqual(before)
    const builds = factsBuildCount()
    expect(await c.summary('2026-10-08', 'UC_B')).toEqual(first)
    expect(factsBuildCount()).toBe(builds)
    await payAll(world, seller, '2026-10-01', 'UC_B')
    expect(await c.summary('2026-10-08', 'UC_B')).toMatchObject({ unpaidDays: 1, purchaseDays: 1, purchaseTotal: 10_000 })
    expect(factsBuildCount()).toBe(builds + 1)
  })

  it('다른 판매자의 기록·캐시가 섞이지 않는다 (같은 채널·같은 날짜)', async () => {
    const { world, seller } = await crmWorld()
    const other = await addSeller(world)
    await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await payAll(world, seller, '2026-10-01', 'UC_A')
    await buy(world, other, '2026-10-01', 'UC_A', '다육이맘', 50_000)
    expect((await crm(world, seller).summary('2026-10-01', 'UC_A')).purchaseTotal).toBe(10_000)
    expect(await crm(world, other).summary('2026-10-01', 'UC_A')).toMatchObject({ purchaseTotal: 0, purchaseDays: 0 })
    const [mine] = await crm(world, seller).rows()
    const [theirs] = await crm(world, other).rows()
    expect(mine?.id).not.toBe(theirs?.id)
    expect((await crm(world, other).customer(mine?.id as string)).status).toBe(404)
  })
})
