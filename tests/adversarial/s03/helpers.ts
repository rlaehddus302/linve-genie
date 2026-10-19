// S03 적대 테스트 공용 도구 (test-domain). 엔진을 import만으로 돌린다(외부 계정·기기 없음).
// S02 도구(../s02/helpers.ts)를 그대로 쓰고 S03 이벤트 생성기만 더한다.
import { smsPhoneFields } from '@livejjim/core/golden'
import { T0, type Ev } from '../s02/helpers.ts'

export * from '../s02/helpers.ts'

/** 2026-10-18(방송 날짜)의 KST 시각 → UTC 밀리초 */
export const kst = (hour: number, minute = 0, second = 0, ms = 0): number => Date.UTC(2026, 9, 18, hour - 9, minute, second, ms)

/**
 * 문자찜. S03b(D-061)부터 엔진은 전화번호 원문을 받지 않으므로 f.phone은 서버처럼 정규화·키로 바꿔 넣는다
 * (테스트 전용 키 — @livejjim/core/golden smsPhoneFields). phone을 엔진에 그대로 넣어 보려면 raw 이벤트를 직접 만든다.
 */
export const sms = (ref: string, no: number, received: string, f: Record<string, unknown> = {}): Ev => {
  const { phone, ...rest } = f
  return { type: 'sms', b: 'b1', ref, no, received, ...(phone === undefined ? {} : smsPhoneFields(phone as string)), ...rest }
}
export { smsPhoneFields }
export const update = (no: number, f: Record<string, unknown>): Ev => ({ type: 'product.update', b: 'b1', no, ...f })
export const renumber = (from: number, to: number): Ev => ({ type: 'product.renumber', b: 'b1', from, to })
export const convert = (msg: string, no: number): Ev => ({ type: 'host.convertMessage', b: 'b1', msg, no })
export const resolve = (no: number, decision: 'KEEP' | 'SWITCH'): Ev => ({ type: 'host.resolveConflict', b: 'b1', no, decision })
export const merge = (from: string, into: string): Ev => ({ type: 'buyer.merge', from, into, reason: '같은 사람' })
export const unmerge = (from: string): Ev => ({ type: 'buyer.unmerge', from, reason: '다른 사람' })
export const pay = (buyer: string, amount: number, date = '2026-10-18'): Ev => ({ type: 'settlement.payment', buyer, date, amount })
export const refund = (buyer: string, amount: number, date = '2026-10-18'): Ev => ({ type: 'settlement.refund', buyer, date, amount, reason: '환불' })
export const adjust = (buyer: string, amount: number, date = '2026-10-18'): Ev => ({ type: 'settlement.adjust', buyer, date, amount, reason: '조정' })
export const shipping = (buyer: string, mode: string, f: Record<string, unknown> = {}): Ev => ({ type: 'settlement.shippingOverride', buyer, date: '2026-10-18', mode, ...f })

export const RECEIVED_TIME = { 'contention.policy': 'RECEIVED_TIME' } as const
export { T0 }
