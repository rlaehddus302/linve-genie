// S03 적대 테스트 (test-domain): 라운드 0에서 공격했고 스펙대로 동작한 사슬 중 다시 깨지기 쉬운 것 (통과하는 회귀 테스트).
// 문자찜·번호 변경 뒤 늦은 보고·메시지 변환·합치기와 입금·환불 순서·UNPAID_CLAIMS·역전 사슬·여러 방송 정산·개인정보·처리 비용.
import { applyEvent, initEngine, isInvalidEvent, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import {
  B1,
  T0,
  buyer,
  chat,
  checkInvariants,
  convert,
  host,
  kst,
  labelPrinted,
  listCancelRequests,
  listClaims,
  listEffects,
  listSettlements,
  merge,
  pay,
  play,
  product,
  reg,
  refund,
  renumber,
  resolve,
  RECEIVED_TIME,
  sms,
  smsPhoneFields,
  thanksSent,
  unmerge,
  update,
} from './helpers.ts'

const claimRows = (state: EngineState) => listClaims(state).map((c) => [c.id, c.product, c.buyer, c.currentBuyer, c.status, c.reason])
const effectRows = (state: EngineState) => listEffects(state).map((e) => [e.id, e.product, e.status])

describe('번호 변경 뒤 늦은 효과 보고 (AC-S03-33·60, R-13)', () => {
  it('출력된 라벨은 번호 변경 때 이전 번호 키로 VOID_LABEL, 그 뒤 같은 출력 보고·감사 게시 보고는 폐기를 더 내지 않는다', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1'), renumber(15, 16), labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1'), thanksSent('c1:POST_THANKS:LIVE_CHAT:1'), chat('C', '16'), chat('A', '16')])
    expect(effectRows(p.state)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'b1/15', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'b1/15', 'DONE'],
      ['c1:VOID_LABEL:-:1', 'b1/15', 'PENDING'],
      ['c3:PRINT_PRODUCT_LABEL:-:2', 'b1/16', 'PENDING'],
      ['c3:POST_THANKS:LIVE_CHAT:2', 'b1/16', 'PENDING'],
    ])
    expect(claimRows(p.state)).toEqual([
      ['c1', 'b1/16', 'A', 'A', 'REJECTED', 'RENUMBERED'],
      ['c2', 'b1/16', 'B', 'B', 'REJECTED', 'RENUMBERED'],
      ['c3', 'b1/16', 'C', 'C', 'CONFIRMED', null],
      ['c4', 'b1/16', 'A', 'A', 'WAITLISTED', null],
    ])
    expect(product(p.state, 15)).toBeNull()
    expect(checkInvariants(p.state)).toEqual([])
  })
})

describe('문자찜 구매자와 합치기 (AC-S03-11·41)', () => {
  it('형식이 다른 같은 번호는 한 구매자, 합친 유튜브 채널의 대기 찜(취소 요청 포함)은 DUPLICATE가 되고 요청도 사라진다', () => {
    const p = play([reg(15), chat('A', '15'), sms('r1', 15, '20:00:01', { phone: '010-1234-5678', memo: '김' }), chat('B', '15'), sms('r2', 15, '20:00:03', { phone: '01012345678' }), chat('B', '15 취소'), merge('B', 'sms:r1')])
    expect(product(p.state, 15)?.waitlist).toEqual(['sms:r1'])
    expect(claimRows(p.state).slice(1)).toEqual([
      ['c2', 'b1/15', 'sms:r1', 'sms:r1', 'WAITLISTED', null],
      ['c3', 'b1/15', 'B', 'sms:r1', 'DUPLICATE', null],
    ])
    expect(listCancelRequests(p.state)).toEqual([])
    expect(buyer(p.state, 'sms:r1')?.phoneLast4).toBe('5678')
    expect(checkInvariants(p.state)).toEqual([])
  })
})

describe('합치기와 입금·환불 순서 (AC-S03-41·50·53)', () => {
  it('문자 구매자가 입금하고 합친 채널 쪽에 환불을 적은 뒤에는 떼어 내기가 거절된다(한쪽 받은 금액이 음수), 묶음은 과입금 그대로', () => {
    const p = play([reg(15), reg(16), chat('A', '15'), sms('r1', 16, '20:00:01'), merge('sms:r1', 'A'), pay('sms:r1', 28000), host('host.cancel', 15, 'A'), refund('A', 10000), unmerge('sms:r1')])
    expect(buyer(p.state, 'sms:r1')?.current).toBe('A')
    expect(listSettlements(p.state).map((s) => [s.buyer, s.items, s.total, s.received, s.refundDue, s.payment])).toEqual([['A', ['b1/16'], 14000, 18000, 4000, 'OVERPAID']])
    expect(checkInvariants(p.state)).toEqual([])
  })

  it('UNPAID_CLAIMS: 합친 묶음에 입금이 있으면 합쳐진 문자 구매자의 확정 찜도 입금 전이 아니다(스냅샷 그대로)', () => {
    const p = play([reg(15), reg(16), chat('A', '15'), sms('r1', 16, '20:00:01'), pay('A', 1000), merge('sms:r1', 'A'), update(16, { price: 20000, applyTo: 'UNPAID_CLAIMS' }), update(15, { price: 30000, applyTo: 'UNPAID_CLAIMS' })])
    expect(listClaims(p.state).map((c) => [c.id, c.price, c.locked, c.priceHistory.length])).toEqual([
      ['c1', 10000, true, 0],
      ['c2', 10000, true, 0],
    ])
    expect(listSettlements(p.state).map((s) => [s.subtotal, s.received, s.payment])).toEqual([[20000, 1000, 'PARTIAL']])
  })

  it('같은 날짜의 두 방송은 한 묶음, 다른 날짜의 입금은 그 날짜 묶음만 잠근다', () => {
    const broadcasts = [B1, { id: 'b2', date: '2026-10-18', title: '2부' }, { id: 'b3', date: '2026-10-19', title: '19일' }]
    const p = play([reg(15), reg(15, { b: 'b2' }), reg(15, { b: 'b3' }), chat('A', '15'), chat('A', '15', { b: 'b2', id: 'x2' }), chat('A', '15', { b: 'b3', id: 'x3' }), pay('A', 10000, '2026-10-19')], {}, broadcasts)
    expect(listSettlements(p.state).map((s) => [s.date, s.items, s.total, s.received, s.payment])).toEqual([
      ['2026-10-18', ['b1/15', 'b2/15'], 24000, 0, 'UNPAID'],
      ['2026-10-19', ['b3/15'], 14000, 10000, 'PARTIAL'],
    ])
    expect(listClaims(p.state).map((c) => c.locked)).toEqual([false, false, true])
  })
})

describe('메시지 변환 (AC-S03-26, ARRIVAL)', () => {
  it('1등보다 먼저 받은 메시지 → 잠금과 상관없이 충돌, SWITCH면 그 사람 확정·전 1등은 대기 1순위', () => {
    const p = play([reg(15), chat('X', '십오번이요', { id: 'mX' }), chat('A', '15'), chat('B', '15'), convert('mX', 15), resolve(15, 'SWITCH')])
    expect([product(p.state, 15)?.winners, product(p.state, 15)?.waitlist]).toEqual([['X'], ['A', 'B']])
    expect(effectRows(p.state).map(([id, , status]) => [id, status])).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'CANCELLED'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'CANCELLED'],
      ['c3:PRINT_PRODUCT_LABEL:-:2', 'PENDING'],
      ['c3:POST_THANKS:LIVE_CHAT:2', 'PENDING'],
    ])
  })

  it('1등보다 늦은 메시지는 순위 자리(자기보다 앞서는 대기자 바로 뒤)에 들어간다, 취소된 주문 메시지는 되살아나지 않는다', () => {
    const p = play([reg(15, { status: 'READY' }), chat('A', '15'), chat('X', '십오번이요', { id: 'mX' }), { type: 'product.open', b: 'b1', no: 15 }, chat('B', '15'), convert('mX', 15)])
    expect(product(p.state, 15)?.waitlist).toEqual(['X', 'B'])
    const q = play([reg(15), chat('A', '15', { id: 'mA' }), chat('B', '15'), chat('A', '15 취소'), host('host.approveCancel', 15, 'A'), convert('mA', 15)])
    expect([product(q.state, 15)?.winners, listClaims(q.state).length]).toEqual([['B'], 2])
  })
})

describe('실제 시각순 재고 2 역전 사슬 (AC-S03-21·22·24)', () => {
  it('앞선 문자찜 둘이 차례로 가장 뒤 1등을 밀어내고, HOST 동률 충돌 중 1등 취소 → 충돌이 먼저 대기 자리로, 승계는 대기 1순위', () => {
    const p = play(
      [
        reg(15, { stock: 2, at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        chat('B', '15', { at: kst(20, 0, 20) }),
        chat('C', '15', { at: kst(20, 0, 30) }),
        sms('s1', 15, '20:00:15', { at: kst(20, 1) }),
        sms('s2', 15, '20:00:05', { at: kst(20, 1, 10) }),
        sms('s3', 15, '20:00', { at: kst(20, 1, 20) }),
        host('host.cancel', 15, 'A', { at: kst(20, 2) }),
        resolve(15, 'SWITCH'),
      ],
      RECEIVED_TIME,
    )
    expect([product(p.state, 15)?.winners, product(p.state, 15)?.waitlist, product(p.state, 15)?.conflict, product(p.state, 15)?.confirmVersion]).toEqual([['sms:s2', 'sms:s1'], ['B', 'C', 'sms:s3'], false, 5])
    expect(effectRows(p.state).filter(([, , status]) => status === 'PENDING').map(([id]) => id)).toEqual(['c5:PRINT_PRODUCT_LABEL:-:4', 'c5:POST_THANKS:LIVE_CHAT:4', 'c4:PRINT_PRODUCT_LABEL:-:5', 'c4:POST_THANKS:LIVE_CHAT:5'])
    expect(checkInvariants(p.state)).toEqual([])
  })
})

describe('개인정보 (AC-S03-12·42)', () => {
  const SECRET_PHONE = ['01055557777', '5555-7777', '55557777']
  const SECRET_MEMO = '박순자 이모'

  it('메모·전화번호는 지정 구매자·합치기·변환·승계를 거쳐도 효과·효과 ID·찜 ID·조회 결과(뒤 4자리 밖)에 나오지 않는다', () => {
    const p = play([
      reg(15),
      reg(16),
      chat('A', '안녕', { id: 'mA' }),
      sms('r1', 15, '20:00', { phone: '010-5555-7777', memo: SECRET_MEMO }),
      sms('r2', 16, '20:00', { buyer: 'A', memo: SECRET_MEMO, phone: '010 5555 7777' }),
      merge('A', 'sms:r1'),
      chat('B', '15'),
      host('host.cancel', 15, 'sms:r1'),
      convert('mA', 15),
      host('host.cancel', 15, 'B'),
    ])
    const published = JSON.stringify([listEffects(p.state), listClaims(p.state).map((c) => c.id)])
    for (const secret of [...SECRET_PHONE, SECRET_MEMO, '박순자']) expect(published).not.toContain(secret)
    expect(listEffects(p.state).flatMap((e) => (e.text === null ? [] : [e.text]))).toEqual([
      '15번 핑크프릴 10,000원 문자찜님 구매 감사합니다',
      '16번 핑크프릴 10,000원 문자찜님 구매 감사합니다',
      '15번 핑크프릴 10,000원 B님 구매 감사합니다',
      '15번 핑크프릴 10,000원 A님 구매 감사합니다',
    ])
    const views = JSON.stringify([listClaims(p.state), listSettlements(p.state), buyer(p.state, 'sms:r1'), buyer(p.state, 'A')].map((v) => JSON.parse(JSON.stringify(v, (k, val: unknown) => (k === 'display' || k === 'nameHistory' ? undefined : val)))))
    for (const secret of SECRET_PHONE) expect(views).not.toContain(secret)
  })

  it('입력 오류 메시지에 전화번호·메모 값이 들어가지 않는다', () => {
    const state = initEngine({ broadcasts: [B1], settings: {} })
    const bad = [
      { type: 'sms', b: 'b1', ref: 'r1', no: 15, received: '20:00', phone: 1055557777, memo: SECRET_MEMO },
      { type: 'sms', b: 'b1', ref: 'r1', no: '15', received: '8:01', phone: '010-5555-7777', memo: 7 },
      { type: 'sms', b: 'b9', ref: '', no: 0, received: '24:00', phone: ['010-5555-7777'], memo: SECRET_MEMO },
    ]
    for (const event of bad) {
      let error: unknown
      try {
        applyEvent(state, { seq: 1, at: T0, ...event } as unknown as EngineEvent)
      } catch (e) {
        error = e
      }
      expect(isInvalidEvent(error)).toBe(true)
      const text = JSON.stringify([(error as Error).message, (error as { problems: unknown }).problems])
      for (const secret of [...SECRET_PHONE, '010-5555-7777', SECRET_MEMO]) expect(text).not.toContain(secret)
    }
  })
})

describe('처리 비용 (AC-S03-05, NFR-01 예산 300ms)', () => {
  const time = (fn: () => void): number => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }

  it('한 번호에 보류 찜 2천 개(채팅·문자찜 반반)가 몰린 뒤 공개·차단·취소 이벤트 하나가 예산 안이다', () => {
    // S04 (D-071): 공개 전 찜 유효 시간은 0~300초 — 최댓값 300으로, 2천 개를 300초 안(10ms 간격 = 20초)에 넣는다
    let state = initEngine({ broadcasts: [B1], settings: { 'claim.preOpenWindowSec': 300 } })
    let seq = 0
    const step = (event: Record<string, unknown>): number => time(() => (state = applyEvent(state, { seq: ++seq, at: T0 + seq * 10, ...event } as unknown as EngineEvent).state))
    for (let i = 0; i < 2000; i++) step(i % 2 === 0 ? { type: 'chat', b: 'b1', id: `m${String(i)}`, ch: `U${String(i)}`, nick: 'n', text: '15' } : { type: 'sms', b: 'b1', ref: `r${String(i)}`, no: 15, received: '20:00', ...smsPhoneFields(`010${String(10_000_000 + i)}`) })
    expect(step({ type: 'host.blockBuyer', buyer: 'U2', reason: '사유' })).toBeLessThan(300)
    expect(step({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'U4', reason: '사유' })).toBeLessThan(300)
    expect(step({ type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000, stock: 3 })).toBeLessThan(300)
    expect(product(state, 15)?.winners).toHaveLength(3)
    expect(checkInvariants(state)).toEqual([])
  })

  it('한 전화번호로 찜 2천 개를 가진 문자 구매자의 합치기·차단·떼어 내기 이벤트 하나가 예산 안이다', () => {
    let state = initEngine({ broadcasts: [B1], settings: {} })
    let seq = 0
    const step = (event: Record<string, unknown>): number => time(() => (state = applyEvent(state, { seq: ++seq, at: T0 + seq * 10, ...event } as unknown as EngineEvent).state))
    step({ type: 'chat', b: 'b1', id: 'hello', ch: 'A', nick: 'a', text: '안녕' })
    for (let i = 1; i <= 2000; i++) {
      step({ type: 'product.register', b: 'b1', no: i, name: '', price: 1000 })
      step({ type: 'sms', b: 'b1', ref: `r${String(i)}`, no: i, received: '20:00', ...smsPhoneFields('010-1234-5678') })
    }
    expect(step({ type: 'buyer.merge', from: 'sms:r1', into: 'A', reason: '사유' })).toBeLessThan(300)
    expect(step({ type: 'host.blockBuyer', buyer: 'sms:r1', reason: '사유' })).toBeLessThan(300)
    expect(step({ type: 'buyer.unmerge', from: 'sms:r1', reason: '사유' })).toBeLessThan(300)
    expect(buyer(state, 'sms:r1')?.subtotal).toBe(2_000_000)
  })
})
