// 정산 금액 칸 (AC-S06-36, R-14, D-092): 코어 parseAmount를 원 단위(WON)로 — 판매자의 천원 단위 설정을 쓰지 않는다.
// SRV1 (D-APP-23·24): 읽기 함수는 서버 전용 자리(packages/voice-session/src/read)로 옮겼다 — 기대값은 그대로, 서버 읽기 함수를 본다.
import { describe, expect, it } from 'vitest'
import { ADJUST_RANGE, AMOUNT_UNREADABLE, PAYMENT_RANGE, SHIPPING_RANGE, amountRead, refundRange, type AmountRange } from '../src/lib/money.ts'
import { readText } from '../../../packages/voice-session/src/read/index.ts'

/** 서버가 금액 칸을 읽고(kind money) 화면이 그 칸의 범위로 막는다 — 옮기기 전 readAmount와 같은 길 */
const readAmount = (text: string, range: AmountRange) => {
  const read = readText('money', text, { now: 0 })
  return amountRead(text, read.kind === 'money' ? read : null, range)
}

describe('원 단위 금액 칸', () => {
  it.each(['14000', '14,000', '1만 4천', '1만4천', '만 사천 원', '14000원'])('%s → 14,000원', (text) => {
    expect(readAmount(text, PAYMENT_RANGE)).toEqual({ kind: 'ok', amount: 14000, words: '14,000원' })
  })

  it('천원 단위를 쓰지 않는다: 14 → 14원', () => {
    expect(readAmount('14', PAYMENT_RANGE)).toEqual({ kind: 'ok', amount: 14, words: '14원' })
  })

  it('읽지 못하면 "금액을 14000처럼 적어 주세요."', () => {
    for (const text of ['만원쯤', 'abc', '1.5', '-1000']) expect(readAmount(text, PAYMENT_RANGE)).toEqual({ kind: 'invalid', message: AMOUNT_UNREADABLE })
    expect(AMOUNT_UNREADABLE).toBe('금액을 14000처럼 적어 주세요.')
  })

  it('빈칸은 비움', () => {
    expect(readAmount('  ', PAYMENT_RANGE)).toEqual({ kind: 'empty' })
  })

  it('칸마다 범위 문장', () => {
    expect(readAmount('0', PAYMENT_RANGE)).toEqual({ kind: 'invalid', message: '입금은 1원~100,000,000원으로 적어 주세요.' })
    expect(readAmount('0', SHIPPING_RANGE)).toMatchObject({ kind: 'ok', amount: 0 })
    expect(readAmount('1000001', SHIPPING_RANGE)).toEqual({ kind: 'invalid', message: '배송비는 0원~1,000,000원으로 적어 주세요.' })
    expect(readAmount('10000001', ADJUST_RANGE)).toEqual({ kind: 'invalid', message: '할인·추가는 1원~10,000,000원으로 적어 주세요.' })
  })

  it('환불은 1원 ~ 받은 금액: 넘으면 "받은 금액(14,000원)보다 많이 환불할 수 없어요."', () => {
    const range = refundRange(14000)
    expect(readAmount('14000', range)).toMatchObject({ kind: 'ok', amount: 14000 })
    expect(readAmount('14001', range)).toEqual({ kind: 'invalid', message: '받은 금액(14,000원)보다 많이 환불할 수 없어요.' })
    expect(readAmount('0', range)).toEqual({ kind: 'invalid', message: '환불은 1원 이상으로 적어 주세요.' })
    expect(readAmount('1', refundRange(0))).toEqual({ kind: 'invalid', message: '받은 금액이 없어서 환불할 수 없어요.' })
  })
})
