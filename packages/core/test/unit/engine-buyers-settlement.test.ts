// 구매자 보기·합치기·떼어 내기·이벤트의 구매자 (AC-S03-40~42), 정산 묶음·배송비·조정·입금·환불 (AC-S03-50~53).
import {
  applyEvent,
  currentBuyerOf,
  getBuyer,
  getProduct,
  getSettlement,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listSettlements,
  settle,
  DEFAULT_SETTINGS,
  type EngineEvent,
  type SettlementEntry,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { T0, chat, host, play, register, sms, type EventInput } from './engine-helpers.ts'

const D = '2026-10-18'
const merge = (from: string, into: string): EventInput => ({ type: 'buyer.merge', from, into, reason: '같은 사람' })
const unmerge = (from: string): EventInput => ({ type: 'buyer.unmerge', from, reason: '잘못 합침' })
const pay = (buyer: string, amount: number, date = D): EventInput => ({ type: 'settlement.payment', buyer, date, amount, memo: '입금' })
const refund = (buyer: string, amount: number, date = D): EventInput => ({ type: 'settlement.refund', buyer, date, amount, reason: '환불' })
const adjust = (buyer: string, amount: number, date = D): EventInput => ({ type: 'settlement.adjust', buyer, date, amount, reason: '조정' })
const shipping = (buyer: string, mode: 'PICKUP' | 'COMBINED' | 'FIXED' | 'DEFAULT', amount?: number): EventInput =>
  ({ type: 'settlement.shippingOverride', buyer, date: D, mode, ...(amount === undefined ? {} : { amount }) }) as EventInput

describe('AC-S03-40·41 구매자 보기와 합치기', () => {
  it('합친 결과는 지금의 구매자 기준: 품목·합계는 아래쪽 전부, 표시 이름은 자신의 것, 합쳐진 구매자 목록', () => {
    const { state } = play([register(1), register(2), register(3), chat('H', '1', { nick: '홍' }), sms('s1', 2, '20:00', { memo: '길동' }), chat('K', '3', { nick: '케이' }), merge('sms:s1', 'H'), merge('K', 'sms:s1')])
    expect(getBuyer(state, 'H')).toMatchObject({ current: 'H', mergedInto: null, merged: ['sms:s1', 'K'], display: '홍', items: ['b1/1', 'b1/2', 'b1/3'], subtotal: 30000 })
    expect(getBuyer(state, 'sms:s1')).toMatchObject({ current: 'H', mergedInto: 'H', merged: ['K'], display: '문자찜(길동)', items: ['b1/2', 'b1/3'], subtotal: 20000 })
    expect(getBuyer(state, 'K')).toMatchObject({ current: 'H', mergedInto: 'sms:s1', merged: [], items: ['b1/3'] })
    expect(getProduct(state, 'b1', 3)?.winners).toEqual(['H'])
    expect(listSettlements(state).map((s) => [s.buyer, s.subtotal, s.shipping, s.total])).toEqual([['H', 30000, 4000, 34000]])
    expect(getSettlement(state, 'K', D)).toMatchObject({ buyer: 'H', subtotal: 30000 })
    expect(currentBuyerOf(state, 'K')).toBe('H')
    expect(currentBuyerOf(state, 'Z')).toBeNull()
  })

  it('받지 않는 합치기는 아무 일도 없다: 모르는 구매자·자기 자신·이미 합쳐진 from·고리·확정 둘', () => {
    const { state } = play([register(1, { stock: 2 }), chat('A', '1'), chat('B', '1'), chat('C', '안녕'), chat('D', '안녕'), merge('C', 'D')])
    for (const event of [merge('Z', 'A'), merge('A', 'Z'), merge('A', 'A'), merge('C', 'A'), merge('D', 'C'), merge('A', 'B'), unmerge('A'), unmerge('Z')]) {
      const result = applyEvent(state, { seq: 20, at: T0 + 20_000, ...event } as EngineEvent)
      expect(result.state, JSON.stringify(event)).toBe(state)
    }
  })

  it('고리 금지는 나무 전체를 본다: into의 지금의 구매자가 from이면 아무 일도 없다', () => {
    const { state } = play([chat('A', '안녕'), chat('B', '안녕'), chat('C', '안녕'), merge('B', 'A'), merge('C', 'B')])
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...merge('A', 'C') } as EngineEvent).state).toBe(state)
    expect(currentBuyerOf(state, 'C')).toBe('A')
  })

  it('중복은 확정 > 충돌 > 대기(앞 순번) > 보류(판정 순위)로 하나만 남긴다. 대기 순번 당김, 취소 요청 사라짐, 효과 없음', () => {
    const { state, emitted } = play([
      register(1),
      register(2),
      register(3, { status: 'READY' }),
      chat('Z', '1 2'),
      chat('A', '1'),
      chat('B', '1 2 3'),
      chat('A', '2 3'),
      chat('B', '1 취소'),
      merge('B', 'A'),
    ])
    // 1번: A 대기 1(c3)·B 대기 2(c4) → B 중복, 2번: B 대기 1(c5)·A 대기 2(c7) → A 중복, 3번: B 보류(c6)·A 보류(c8) → A 중복
    expect(listClaims(state).map((c) => [c.id, c.buyer, c.no, c.status])).toEqual([
      ['c1', 'Z', 1, 'CONFIRMED'],
      ['c2', 'Z', 2, 'CONFIRMED'],
      ['c3', 'A', 1, 'WAITLISTED'],
      ['c4', 'B', 1, 'DUPLICATE'],
      ['c5', 'B', 2, 'WAITLISTED'],
      ['c6', 'B', 3, 'PENDING'],
      ['c7', 'A', 2, 'DUPLICATE'],
      ['c8', 'A', 3, 'DUPLICATE'],
    ])
    expect(listCancelRequests(state)).toEqual([])
    expect(emitted.at(-1)).toEqual([])
    expect(getProduct(state, 'b1', 2)?.waitlist).toEqual(['A'])
    expect(listPending(state).map((p) => p.claims)).toEqual([['c6']])
  })

  it('충돌 찜과 확정 찜이 겹치면 충돌 찜이 중복 — 충돌 표시가 사라진다. 떼어 내도 중복은 돌아오지 않는다', () => {
    const { state } = play(
      [
        register(15, { at: T0 }),
        chat('A', '15', { at: T0 + 10_000 }),
        { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: T0 + 11_000 } as EventInput,
        chat('B', '15', { at: T0 + 20_000, publishedAt: T0 + 5000 }),
        merge('B', 'A'),
        unmerge('B'),
      ],
      { 'contention.policy': 'RECEIVED_TIME' },
    )
    expect(listClaims(state).map((c) => [c.buyer, c.status])).toEqual([
      ['A', 'CONFIRMED'],
      ['B', 'DUPLICATE'],
    ])
    expect(getProduct(state, 'b1', 15)?.conflict).toBe(false)
  })

  it('떼어 내기는 연결만 끊는다 — 아래쪽은 함께 떨어지고, 확정은 풀리지 않는다', () => {
    const { state, emitted } = play([register(1), register(2), register(3), chat('A', '1'), chat('B', '2'), chat('C', '3'), merge('C', 'B'), merge('B', 'A'), unmerge('B')])
    expect(getBuyer(state, 'A')).toMatchObject({ merged: [], items: ['b1/1'] })
    expect(getBuyer(state, 'B')).toMatchObject({ current: 'B', merged: ['C'], items: ['b1/2', 'b1/3'] })
    expect(emitted.slice(-3)).toEqual([[], [], []])
    expect(listClaims(state).every((c) => c.status === 'CONFIRMED')).toBe(true)
  })

  it('떼어 낸 결과 어느 묶음의 받은 금액이 음수가 되면 떼어 내지 않는다', () => {
    const { state } = play([register(1), register(2), chat('A', '1'), chat('B', '2'), merge('B', 'A'), pay('A', 1000), refund('B', 1000)])
    // 합친 동안: A 입금 1,000 − B 환불 1,000 = 0. 떼어 내면 B 묶음 −1,000 → 거부
    expect(getSettlement(state, 'A', D).received).toBe(0)
    expect(applyEvent(state, { seq: 20, at: T0 + 20_000, ...unmerge('B') } as EngineEvent).state).toBe(state)
    // 다른 날짜의 기록은 그 날짜끼리만 본다: 같은 날 입금을 더하면 받는다
    const ok = play([register(1), register(2), chat('A', '1'), chat('B', '2'), merge('B', 'A'), pay('A', 1000), refund('B', 1000), pay('B', 1000), unmerge('B')])
    expect([getSettlement(ok.state, 'A', D).received, getSettlement(ok.state, 'B', D).received]).toEqual([1000, 0])
  })
})

describe('AC-S03-42 이벤트의 구매자와 감사 문구 이름', () => {
  it('방송자 조치는 지금의 구매자로 찾는다 — 합쳐진 다른 구매자의 키로 조치해도 같은 찜', () => {
    const { state } = play([register(15), sms('s1', 15, '20:00'), chat('H', '안녕'), merge('H', 'sms:s1'), host('host.cancel', 15, 'H')])
    expect(listClaims(state).map((c) => [c.buyer, c.status])).toEqual([['sms:s1', 'CANCELLED']])
  })

  it('차단은 구매자 하나에만 — 합친 다른 구매자의 대기 찜은 그대로', () => {
    const { state } = play([register(15), register(16), chat('Z', '15 16'), chat('A', '15'), chat('B', '16'), merge('B', 'A'), { type: 'host.blockBuyer', buyer: 'A', reason: '장난' }])
    expect(listClaims(state).map((c) => [c.buyer, c.no, c.status, c.reason])).toEqual([
      ['Z', 15, 'CONFIRMED', null],
      ['Z', 16, 'CONFIRMED', null],
      ['A', 15, 'REJECTED', 'BLOCKED'],
      ['B', 16, 'WAITLISTED', null],
    ])
  })

  it('감사 이름은 찜의 구매자 자신 기준: 유튜브 채널의 찜은 그 닉네임(합친 쪽이 문자 구매자여도), 문자 구매자에게 배정한 찜은 문자찜', () => {
    const { state } = play([register(1), register(2), sms('s1', 9, '20:00', { memo: '김영희 이모' }), chat('A', '안녕', { nick: '영희네' }), merge('A', 'sms:s1'), chat('A', '1', { nick: '영희네' }), { type: 'host.assign', b: 'b1', no: 2, buyer: 'sms:s1', reason: '전화' }])
    expect(listEffects(state).filter((e) => e.kind === 'POST_THANKS').map((e) => [e.buyer, e.currentBuyer, e.text])).toEqual([
      ['A', 'sms:s1', '1번 핑크프릴 10,000원 영희네님 구매 감사합니다'],
      ['sms:s1', 'sms:s1', '2번 핑크프릴 10,000원 문자찜님 구매 감사합니다'],
    ])
  })
})

describe('AC-S03-50 정산 묶음과 기록', () => {
  it('기록은 적힌 (구매자, 날짜)에 붙고 묶음은 합친 구매자들의 그 날짜 기록을 모두 더한다. 기록 목록은 적힌 순서와 적힌 구매자', () => {
    const { state } = play([register(1), register(2), chat('A', '1'), chat('B', '2'), pay('B', 3000), merge('B', 'A'), pay('A', 2000), adjust('A', -500)])
    const group = getSettlement(state, 'B', D)
    expect(group).toMatchObject({ buyer: 'A', subtotal: 20000, received: 5000, adjustments: -500, payment: 'PARTIAL' })
    expect(group.records.map((r) => [r.kind, r.buyer, r.amount, r.memo, r.reason])).toEqual([
      ['payment', 'B', 3000, '입금', null],
      ['payment', 'A', 2000, '입금', null],
      ['adjust', 'A', -500, null, '조정'],
    ])
  })

  it('품목이 없어도 받은 금액이 있으면 묶음이 보인다 (최종 0, 과입금). 기록만 있는 날짜도 목록에 있다', () => {
    const { state } = play([chat('A', '안녕'), pay('A', 7000, '2026-10-20'), adjust('A', 100, '2026-10-21')])
    expect(listSettlements(state).map((s) => [s.date, s.total, s.received, s.refundDue, s.payment])).toEqual([
      ['2026-10-20', 0, 7000, 7000, 'OVERPAID'],
      ['2026-10-21', 0, 0, 0, 'UNPAID'],
    ])
  })

  it('엔진이 모르는 구매자의 정산 기록은 아무 일도 없다 (차단만 된 채널 포함)', () => {
    const { state } = play([{ type: 'host.blockBuyer', buyer: 'Z', reason: 'r' }])
    for (const event of [pay('Z', 1), refund('Z', 1), adjust('Z', 1), shipping('Z', 'PICKUP')]) {
      expect(applyEvent(state, { seq: 5, at: T0 + 5000, ...event } as EngineEvent).state).toBe(state)
    }
  })
})

describe('AC-S03-51·52·53 배송비·조정·입금', () => {
  const entries = (...list: Partial<SettlementEntry>[]): SettlementEntry[] => list.map((entry, i) => ({ seq: i + 1, at: 0, ...entry }) as SettlementEntry)
  const settings = { ...DEFAULT_SETTINGS, 'shipping.baseFee': 4000, 'shipping.freeThreshold': 30000 }

  it('배송비 순서: 품목 없음 0 → 가장 나중 예외(PICKUP·COMBINED 0, FIXED 금액, DEFAULT면 예외 없음) → 무료 기준(상품 합계만) → 기본', () => {
    expect(settle(settings, 50000, 0, entries({ kind: 'shipping', mode: 'FIXED', amount: 9000 })).shipping).toBe(0)
    expect(settle(settings, 50000, 1, entries({ kind: 'shipping', mode: 'FIXED', amount: 9000 })).shipping).toBe(9000)
    expect(settle(settings, 1000, 1, entries({ kind: 'shipping', mode: 'COMBINED', amount: null }))).toMatchObject({ shipping: 0, shippingOverride: 'COMBINED' })
    expect(settle(settings, 1000, 1, entries({ kind: 'shipping', mode: 'PICKUP', amount: null }, { kind: 'shipping', mode: 'DEFAULT', amount: null }))).toMatchObject({ shipping: 4000, shippingOverride: null })
    expect(settle(settings, 30000, 1, entries({ kind: 'adjust', amount: -5000, reason: 'r' })).shipping).toBe(0)
    expect(settle(settings, 29999, 1, entries({ kind: 'adjust', amount: 5000, reason: 'r' })).shipping).toBe(4000)
    // 기록이 적힌 순서와 상관없이 seq가 가장 큰 예외
    const late = [{ kind: 'shipping', mode: 'FIXED', amount: 1, seq: 9, at: 0 }, { kind: 'shipping', mode: 'PICKUP', amount: null, seq: 3, at: 0 }] as SettlementEntry[]
    expect(settle(settings, 1000, 1, late).shipping).toBe(1)
  })

  it('조정은 항목 합(음수 가능). 품목이 없으면 조정 0으로 보고 최종 0, 품목이 있어도 합이 음수면 최종 0', () => {
    expect(settle(settings, 3000, 1, entries({ kind: 'adjust', amount: -8000, reason: 'r' }))).toMatchObject({ shipping: 4000, adjustments: -8000, total: 0 })
    expect(settle(settings, 3000, 1, entries({ kind: 'adjust', amount: -7000, reason: 'r' }))).toMatchObject({ total: 0 })
    expect(settle(settings, 3000, 1, entries({ kind: 'adjust', amount: -6999, reason: 'r' }))).toMatchObject({ total: 1 })
    expect(settle(settings, 0, 0, entries({ kind: 'adjust', amount: -1000, reason: 'r' }))).toMatchObject({ adjustments: 0, total: 0, payment: 'UNPAID' })
    expect(settle(settings, 0, 0, entries({ kind: 'adjust', amount: 1000, reason: 'r' }))).toMatchObject({ adjustments: 0, total: 0 })
  })

  it('입금 상태: 0 → UNPAID(최종 0이어도), 모자람 → PARTIAL, 같음 → PAID, 큼 → OVERPAID·환불 필요 = 차액', () => {
    expect(settle(settings, 0, 0, []).payment).toBe('UNPAID')
    expect(settle(settings, 10000, 1, entries({ kind: 'payment', amount: 13999, memo: null }))).toMatchObject({ total: 14000, payment: 'PARTIAL', refundDue: 0 })
    expect(settle(settings, 10000, 1, entries({ kind: 'payment', amount: 14000, memo: null }))).toMatchObject({ payment: 'PAID', refundDue: 0 })
    expect(settle(settings, 10000, 1, entries({ kind: 'payment', amount: 20000, memo: null }, { kind: 'refund', amount: 1000, reason: 'r' }))).toMatchObject({ received: 19000, payment: 'OVERPAID', refundDue: 5000 })
  })

  it('받은 금액보다 큰 환불은 아무 일도 없다 — 묶음(합친 구매자 포함) 받은 금액으로 본다', () => {
    const { state } = play([register(1), chat('A', '1'), chat('B', '안녕'), pay('A', 5000), merge('B', 'A')])
    expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...refund('B', 5001) } as EngineEvent).state).toBe(state)
    const ok = applyEvent(state, { seq: 9, at: T0 + 9000, ...refund('B', 5000) } as EngineEvent).state
    expect(getSettlement(ok, 'A', D)).toMatchObject({ received: 0, payment: 'UNPAID' })
  })

  it('입금 후 취소로 품목이 줄면 과입금, 환불 기록으로 맞춘다 (게시된 감사·라벨과 상관없이)', () => {
    const { state } = play([register(1), register(2, { price: 5000 }), chat('A', '1 2'), pay('A', 19000), host('host.cancel', 2, 'A'), refund('A', 5000)])
    expect(getSettlement(state, 'A', D)).toMatchObject({ subtotal: 10000, total: 14000, received: 14000, refundDue: 0, payment: 'PAID' })
  })

  it('배송비 예외 지우기(DEFAULT)와 금액 지정은 이벤트로도 같다', () => {
    const { state } = play([register(1, { price: 40000 }), chat('A', '1'), shipping('A', 'FIXED', 7000), shipping('A', 'DEFAULT')], { 'shipping.freeThreshold': 30000 })
    expect(getSettlement(state, 'A', D)).toMatchObject({ shipping: 0, shippingOverride: null, total: 40000 })
    expect(getSettlement(state, 'A', D).records.map((r) => [r.mode, r.amount])).toEqual([
      ['FIXED', 7000],
      ['DEFAULT', null],
    ])
  })
})
