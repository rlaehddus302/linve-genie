// S02 적대 테스트 (test-domain): 판정 엔진의 사슬·경계 회귀 (AC-S02-02·11·40·54·60·70~73).
// 라운드 0에서 공격했고 스펙대로 동작한 것 중 다시 깨지기 쉬운 것만 남긴다(통과하는 회귀 테스트).
import { describe, expect, it } from 'vitest'
import { block, buyer, chat, checkInvariants, host, labelPrinted, listCancelRequests, listClaims, listEffects, listSettlements, observe, play, product, reg, thanksSent } from './helpers.ts'

const statusOf = (p: ReturnType<typeof play>) => listEffects(p.state).map((e) => [e.id, e.status])

describe('S02 회귀: 신뢰할 수 없는 ID', () => {
  it('채널·메시지 ID가 __proto__·constructor여도 판정·합계·정산·JSON 왕복이 같다', () => {
    const p = play([reg(15), chat('__proto__', '15', { id: '__proto__' }), chat('constructor', '15', { id: 'constructor' }), chat('toString', '안녕'), host('host.cancel', 15, '__proto__')])
    expect(product(p.state, 15)?.winners).toEqual(['constructor'])
    expect(buyer(p.state, '__proto__')?.items).toEqual([])
    expect(listSettlements(p.state).map((s) => [s.buyer, s.total])).toEqual([['constructor', 14000]])
    expect(checkInvariants(p.state)).toEqual([])
    expect(observe(JSON.parse(JSON.stringify(p.state)))).toEqual(observe(p.state))
  })
})

describe('S02 회귀: 보류 찜', () => {
  it('유효 시간 0초: 공개 시각과 같은 밀리초의 보류 찜은 판정, 1ms 앞은 만료', () => {
    const p = play([chat('A', '15', { at: 1999 }), chat('B', '15', { at: 2000 }), reg(15, { at: 2000, stock: 2 })], { 'claim.preOpenWindowSec': 0 })
    expect(listClaims(p.state).map((c) => [c.buyer, c.status, c.reason])).toEqual([
      ['A', 'REJECTED', 'EXPIRED'],
      ['B', 'CONFIRMED', null],
    ])
  })

  it('보류 중 취소 요청 → 공개로 확정돼도 요청은 남고, 승인하면 그 찜을 취소하고 승계한다', () => {
    const p = play([chat('A', '15'), chat('A', '15 취소'), reg(15), chat('B', '15'), host('host.approveCancel', 15, 'A')])
    expect(product(p.state, 15)?.winners).toEqual(['B'])
    expect(listCancelRequests(p.state)).toEqual([])
  })
})

describe('S02 회귀: 잠금과 효과 보고', () => {
  it('AUTO: 감사 게시 보고로 잠긴 1등의 시청자 취소는 요청이 되고 판정은 그대로', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), thanksSent('c1:POST_THANKS:LIVE_CHAT:1'), chat('A', '15 취소')], { 'cancel.buyerChat': 'AUTO' })
    expect(product(p.state, 15)?.winners).toEqual(['A'])
    expect(listCancelRequests(p.state).map((r) => r.buyer)).toEqual(['A'])
  })

  it('취소 뒤 늦은 보고: 감사는 완료만, 라벨은 완료 + VOID_LABEL 한 번, 같은 늦은 보고 반복은 아무 일도 없다', () => {
    const p = play([reg(15), chat('A', '15'), host('host.cancel', 15, 'A'), thanksSent('c1:POST_THANKS:LIVE_CHAT:1'), labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1'), labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1')])
    expect(statusOf(p)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'DONE'],
      ['c1:VOID_LABEL:-:1', 'PENDING'],
    ])
    expect(p.emitted.at(-1)).toEqual([])
  })

  it('출력된 1등을 대기로 교체 → VOID_LABEL, 다시 승계로 확정되면 새 확정버전의 효과가 나가고 잠금은 풀려 있다', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1'), host('host.assign', 15, 'B', { replace: 'A', replaceTo: 'WAITLIST' }), host('host.cancel', 15, 'B')])
    expect(statusOf(p)).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'CANCELLED'],
      ['c1:VOID_LABEL:-:1', 'PENDING'],
      ['c2:PRINT_PRODUCT_LABEL:-:2', 'CANCELLED'],
      ['c2:POST_THANKS:LIVE_CHAT:2', 'CANCELLED'],
      ['c1:PRINT_PRODUCT_LABEL:-:3', 'PENDING'],
      ['c1:POST_THANKS:LIVE_CHAT:3', 'PENDING'],
    ])
    const a = listClaims(p.state).find((c) => c.buyer === 'A')
    expect([a?.status, a?.confirmVersion, a?.locked]).toEqual(['CONFIRMED', 3, false])
    expect(checkInvariants(p.state)).toEqual([])
  })
})

describe('S02 회귀: 감사 문구', () => {
  it('승계 직전에 닉네임이 바뀌면 새 닉네임, 1조 원·공백 품종', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), chat('B', '안녕', { nick: '비비' }), host('host.cancel', 15, 'A'), reg(16, { price: 1_000_000_000_000, name: '   ' }), chat('C', '16')])
    expect(p.allEffects.flatMap((e) => (e.text === null ? [] : [e.text]))).toEqual([
      '15번 핑크프릴 10,000원 A님 구매 감사합니다',
      '15번 핑크프릴 10,000원 비비님 구매 감사합니다',
      '16번 1,000,000,000,000원 C님 구매 감사합니다',
    ])
  })
})

describe('S02 회귀: 묻기(ASK)', () => {
  it('승계 결정 필요 중 새 찜은 대기, 2순위를 promote하면 표시가 사라지고 나머지 대기 순서는 그대로', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), host('host.cancel', 15, 'A'), chat('D', '15'), host('host.promote', 15, 'C')], { 'cancel.succession': 'ASK' })
    const info = product(p.state, 15)
    expect([info?.winners, info?.waitlist, info?.awaitingSuccession, info?.confirmVersion]).toEqual([['C'], ['B', 'D'], false, 2])
  })

  it('차단 → 대기에서 빠진 뒤 대기가 비면 표시도 사라진다', () => {
    const p = play([reg(15), chat('A', '15'), chat('B', '15'), host('host.cancel', 15, 'A'), block('B'), chat('C', '15')], { 'cancel.succession': 'ASK' })
    expect(product(p.state, 15)?.winners).toEqual(['C'])
    expect(product(p.state, 15)?.awaitingSuccession).toBe(false)
  })
})

describe('S02 회귀: 차단 중인 1등 교체 (D-049, TD-S02-001 재공격)', () => {
  it('출력·취소 요청이 있는 차단된 1등을 대기로 교체 → REJECTED(BLOCKED)·요청 사라짐·VOID_LABEL, 해제 뒤 새 찜은 맨 뒤 대기', () => {
    const q = play(
      [
        reg(15),
        chat('A', '15'),
        chat('B', '15'),
        chat('C', '안녕'),
        labelPrinted('c1:PRINT_PRODUCT_LABEL:-:1'),
        chat('A', '15 취소'),
        block('A'),
        host('host.assign', 15, 'C', { replace: 'A', replaceTo: 'WAITLIST' }),
        host('host.cancel', 15, 'C'),
        { type: 'host.unblockBuyer', buyer: 'A', reason: '사유' },
        chat('A', '15'),
      ],
      { 'waitlist.max': 2 },
    )
    expect(listClaims(q.state).map((c) => [c.id, c.buyer, c.status, c.reason])).toEqual([
      ['c1', 'A', 'REJECTED', 'BLOCKED'],
      ['c2', 'B', 'CONFIRMED', null],
      ['c3', 'C', 'CANCELLED', null],
      ['c4', 'A', 'WAITLISTED', null],
    ])
    expect(listCancelRequests(q.state)).toEqual([])
    expect(listEffects(q.state).filter((e) => e.buyer === 'A').map((e) => [e.id, e.status])).toEqual([
      ['c1:PRINT_PRODUCT_LABEL:-:1', 'DONE'],
      ['c1:POST_THANKS:LIVE_CHAT:1', 'CANCELLED'],
      ['c1:VOID_LABEL:-:1', 'PENDING'],
    ])
    expect(product(q.state, 15)?.waitlist).toEqual(['A'])
    expect(checkInvariants(q.state)).toEqual([])
  })
})
