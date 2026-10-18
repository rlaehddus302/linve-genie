import { describe, expect, it } from 'vitest'
import {
  NotImplementedError,
  applyEvent,
  initEngine,
  isNotImplemented,
  parseAmount,
  parseChat,
  parseKoreanNumber,
  parseQuickInput,
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

// S01: 파서를 구현하는 대로 S00의 "미구현을 알린다" 항목을 AC-S01-01 기준의 테스트로 바꾼다(스펙 변경에 따른 교체).
describe('AC-S01-01 파서 — S00에서 정한 이름·모양 그대로, 미구현을 알리지 않는다', () => {
  const calls: ReadonlyArray<readonly [string, () => unknown, unknown]> = [
    ['parseAmount', () => parseAmount('1만'), 10000],
    ['parseAmount(설정)', () => parseAmount('10', { 'price.unit': 'THOUSAND' }), 10000],
    ['parseKoreanNumber', () => parseKoreanNumber('십오'), 15],
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

  it('parseAmount는 0 이상 정수 또는 null, parseKoreanNumber는 1..9999 또는 null', () => {
    expect(parseAmount('0원')).toBe(0)
    expect(parseAmount('공짜')).toBeNull()
    expect(parseKoreanNumber('구천구백구십구')).toBe(9999)
    expect(parseKoreanNumber('만')).toBeNull()
  })
})

describe('아직 구현하지 않은 코어 API는 미구현을 알린다', () => {
  const calls: ReadonlyArray<readonly [string, () => unknown]> = [
    ['parseChat', () => parseChat('15')],
    ['parseChat(설정)', () => parseChat('15', { 'claim.parseMode': 'STRICT' })],
    ['parseQuickInput', () => parseQuickInput('15 핑크프릴 10')],
    ['parseQuickInput(설정)', () => parseQuickInput('15 핑크프릴 10', { 'price.unit': 'WON' })],
    ['initEngine', () => initEngine({ broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }], settings: {} })],
    ['applyEvent', () => applyEvent({}, { seq: 1, at: 0, type: 'product.register' })],
  ]

  it.each(calls)('%s → NotImplementedError', (_name, call) => {
    let thrown: unknown
    try {
      call()
    } catch (error) {
      thrown = error
    }
    expect(isNotImplemented(thrown)).toBe(true)
  })
})
