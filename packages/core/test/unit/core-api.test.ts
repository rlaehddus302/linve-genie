import { describe, expect, it } from 'vitest'
import {
  NotImplementedError,
  applyEvent,
  checkInvariants,
  formatThanksText,
  formatWon,
  getBuyer,
  getProduct,
  getSettlement,
  initEngine,
  isNotImplemented,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  parseAmount,
  parseChat,
  parseKoreanNumber,
  parseQuickInput,
  type EngineEvent,
} from '@livejjim/core'

describe('NotImplementedError — 코어가 미구현을 알리는 유일한 방법', () => {
  it('기능 이름과 한국어 메시지를 담는다', () => {
    const error = new NotImplementedError('채팅 주문 인식')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('NotImplementedError')
    expect(error.feature).toBe('채팅 주문 인식')
    expect(error.message).toBe('아직 구현하지 않은 기능: 채팅 주문 인식')
  })

  it('isNotImplemented는 NotImplementedError만 참으로 본다', () => {
    expect(isNotImplemented(new NotImplementedError('x'))).toBe(true)
    expect(isNotImplemented(new Error('아직 구현하지 않은 기능: x'))).toBe(false)
    const lookalike = Object.assign(new Error('x'), { name: 'NotImplementedError', feature: 'x' })
    expect(isNotImplemented(lookalike)).toBe(false)
    expect(isNotImplemented('NotImplementedError')).toBe(false)
    expect(isNotImplemented(undefined)).toBe(false)
  })
})

// S01: 파서 4종을 구현했다. S00의 "미구현을 알린다" 항목 중 파서 4개는 AC-S01-01 기준의 테스트로 바꿨다(스펙 변경에 따른 교체).
describe('AC-S01-01 파서 4종 — S00에서 정한 이름·모양 그대로, 미구현을 알리지 않는다', () => {
  const calls: ReadonlyArray<readonly [string, () => unknown, unknown]> = [
    ['parseChat', () => parseChat('15'), { claims: [15], cancels: [], mentions: [] }],
    ['parseChat(설정)', () => parseChat('15', { 'claim.parseMode': 'STRICT' }), { claims: [15], cancels: [], mentions: [] }],
    ['parseAmount', () => parseAmount('1만'), 10000],
    ['parseAmount(설정)', () => parseAmount('10', { 'price.unit': 'THOUSAND' }), 10000],
    ['parseKoreanNumber', () => parseKoreanNumber('십오'), 15],
    ['parseQuickInput', () => parseQuickInput('15 핑크프릴 10'), { no: 15, name: '핑크프릴', price: 10000 }],
    ['parseQuickInput(설정)', () => parseQuickInput('15 핑크프릴 10', { 'price.unit': 'WON' }), { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
  ]

  it.each(calls)('%s → 예외 없이 결과', (_name, call, expected) => {
    let thrown: unknown
    let actual: unknown
    try {
      actual = call()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeUndefined()
    expect(actual).toStrictEqual(expected)
  })

  it('parseChat 결과는 항상 claims·cancels·mentions 세 배열', () => {
    for (const text of ['', '안녕하세요', '15', '15 취소', '15번 예뻐요']) {
      const result = parseChat(text)
      expect(Object.keys(result).sort()).toEqual(['cancels', 'claims', 'mentions'])
      for (const list of Object.values(result)) expect(Array.isArray(list)).toBe(true)
    }
  })

  it('parseAmount는 0 이상 정수 또는 null, parseKoreanNumber는 1..9999 또는 null', () => {
    expect(parseAmount('0원')).toBe(0)
    expect(parseAmount('공짜')).toBeNull()
    expect(parseKoreanNumber('구천구백구십구')).toBe(9999)
    expect(parseKoreanNumber('만')).toBeNull()
  })
})

// S02: 판정 엔진을 구현했다. S00의 "엔진 API는 미구현을 알린다" 항목은 AC-S02-01 기준의 테스트로 바꿨다(스펙 변경에 따른 교체).
describe('AC-S02-01 엔진 공개 API — S02 범위 입력에서 미구현을 알리지 않는다', () => {
  const B1 = { id: 'b1', date: '2026-10-18', title: '1부' }

  it('initEngine·applyEvent·조회 함수·checkInvariants를 export한다', () => {
    for (const fn of [
      initEngine,
      applyEvent,
      checkInvariants,
      getProduct,
      listProducts,
      listClaims,
      listPending,
      getBuyer,
      listBuyers,
      getSettlement,
      listSettlements,
      listEffects,
      listCancelRequests,
      formatWon,
      formatThanksText,
    ]) {
      expect(fn).toBeTypeOf('function')
    }
  })

  it('S02 범위의 모든 이벤트 종류를 예외 없이 처리한다 (맞지 않는 대상 포함)', () => {
    let state = initEngine({ broadcasts: [B1], settings: {} })
    const events: EngineEvent[] = [
      { seq: 1, at: 0, type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 },
      { seq: 2, at: 1, type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' },
      { seq: 3, at: 2, type: 'product.hold', b: 'b1', no: 15 },
      { seq: 4, at: 3, type: 'product.open', b: 'b1', no: 15 },
      { seq: 5, at: 4, type: 'product.close', b: 'b1', no: 15 },
      { seq: 6, at: 5, type: 'host.confirm', b: 'b1', no: 15, buyer: 'UC_A' },
      { seq: 7, at: 6, type: 'host.promote', b: 'b1', no: 15, buyer: 'UC_A', reason: '단골' },
      { seq: 8, at: 7, type: 'host.reopen', b: 'b1', no: 15, reason: '다시' },
      { seq: 9, at: 8, type: 'host.assign', b: 'b1', no: 15, buyer: 'UC_A', reason: '배정' },
      { seq: 10, at: 9, type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'UC_A' },
      { seq: 11, at: 10, type: 'host.dismissCancel', b: 'b1', no: 15, buyer: 'UC_A' },
      { seq: 12, at: 11, type: 'host.blockBuyer', buyer: 'UC_A', reason: '장난' },
      { seq: 13, at: 12, type: 'host.unblockBuyer', buyer: 'UC_A', reason: '오해' },
      { seq: 14, at: 13, type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1' },
      { seq: 15, at: 14, type: 'effect.thanksSent', effectId: 'c1:POST_THANKS:LIVE_CHAT:1' },
      { seq: 16, at: 15, type: 'host.reject', b: 'b1', no: 15, buyer: 'UC_A', reason: '장난' },
      { seq: 17, at: 16, type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_A', reason: '요청' },
    ]
    for (const event of events) {
      let thrown: unknown
      try {
        state = applyEvent(state, event).state
      } catch (error) {
        thrown = error
      }
      expect(thrown, event.type).toBeUndefined()
    }
    expect(isNotImplemented(undefined)).toBe(false)
    expect(listClaims(state).map((claim) => [claim.buyer, claim.status, claim.reason])).toEqual([['UC_A', 'REJECTED', 'BY_HOST']])
  })
})
