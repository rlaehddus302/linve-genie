// 정산서 문자 보내기 묶음 (D-UX4-174): 번호를 아는 구매자만 보낼 수 있고, 못 보내는 구매자는 까닭별로 모은다
import { describe, expect, it } from 'vitest'
import type { ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import type { StatementRow } from '../src/lib/broadcast-sales.ts'
import { BLOCK_TITLE, sendGroups } from '../src/screens/console/statement-send.ts'

const row = (key: string, money: number | null = 10000): StatementRow => ({ key, no: null, label: key, money, qty: 1 })
const receipts = (phones: Record<string, string | null>, smsReady = true): ReceiptBuyers => ({
  date: '2026-11-12', rehearsal: false, smsReady,
  buyers: Object.entries(phones).map(([buyer, last4]) => ({ buyer, name: buyer, phoneLast4: null, itemCount: 1, total: 10000, payment: 'UNPAID', received: 0, remaining: 10000, link: null, sms: { last4, sentAt: null } })) as unknown as ReceiptBuyers['buyers'],
})

describe('sendGroups (D-UX4-174)', () => {
  it('번호를 모르는 구매자와 금액을 모르는 구매자를 까닭별로 나누고, 나머지는 표 순서대로 보낼 수 있다', () => {
    const groups = sendGroups([row('가'), row('나'), row('다', null), row('라')], receipts({ 가: '1111', 나: null, 다: '3333', 라: '4444' }), true)
    expect(groups.sendable.map(r => r.key)).toEqual(['가', '라'])
    expect(groups.blocked.map(group => [group.reason, group.rows.map(r => r.key)])).toEqual([['phone', ['나']], ['amount', ['다']]])
    expect(BLOCK_TITLE.phone).toBe('아직 휴대폰 번호를 몰라요')
  })

  it('번호 상태를 모르면(아직·못 받음·문자 칸 없는 서버·봉인 날짜·줄 없음) 번호로 거르지 않는다', () => {
    const rows = [row('가'), row('나')]
    for (const [data, check] of [[null, true], [receipts({ 가: null, 나: null }, false), true], [receipts({ 가: null, 나: null }), false], [receipts({}), true]] as const) {
      const groups = sendGroups(rows, data, check)
      expect(groups.sendable.map(r => r.key)).toEqual(['가', '나'])
      expect(groups.blocked).toEqual([])
    }
  })
})
