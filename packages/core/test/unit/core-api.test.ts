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

describe('S00 시점의 코어 API는 모두 미구현을 알린다', () => {
  const calls: ReadonlyArray<readonly [string, () => unknown]> = [
    ['parseChat', () => parseChat('15')],
    ['parseChat(설정)', () => parseChat('15', { 'claim.parseMode': 'STRICT' })],
    ['parseAmount', () => parseAmount('1만')],
    ['parseAmount(설정)', () => parseAmount('10', { 'price.unit': 'THOUSAND' })],
    ['parseKoreanNumber', () => parseKoreanNumber('십오')],
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
