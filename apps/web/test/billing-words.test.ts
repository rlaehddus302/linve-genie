// 요금 화면 낱말·문장 (N5, BILLING_RULES BL-9·BL-10, AC-N5-51·52·54·55·56·57·59): 따옴표로 정한 문장 그대로, KST 표시는 실행 환경 시간대와 상관없다.
import { describe, expect, it } from 'vitest'
import type { BillingStatus, UsageItem } from '../src/api/billing-types.ts'
import {
  NO_PASS_MESSAGE,
  ORDER_STATE_TONE,
  ORDER_STATE_WORD,
  TERMS,
  balanceWords,
  bannerSentence,
  bannerTone,
  beforePayNotices,
  documentWords,
  flatWords,
  objectParticle,
  orderStateSentence,
  passWords,
  priceLine,
  refundQuestion,
  startSentence,
  usageLine,
  windowWords,
} from '../src/lib/billing-words.ts'

// 2026-11-19 20:31 KST = 11:31 UTC
const UNTIL = '2026-11-19T11:31:00.000Z'
// 2026-10-21 20:00 KST
const WINDOW_UNTIL = '2026-10-21T11:00:00.000Z'

const flat = (patch: Partial<BillingStatus['flat']> = {}): BillingStatus['flat'] => ({ active: false, until: null, endedAt: null, chain: [], ...patch })

describe('알림 띠 문장 (BL-9 1, AC-N5-57)', () => {
  it.each([
    [{ kind: 'FLAT_REMAINING', days: 3, until: UNTIL } as const, '정액제가 3일 남았어요 (11/19 20:31까지). 미리 연장하면 남은 기간 뒤에 30일이 이어져요.', 'warning'],
    [{ kind: 'FLAT_ENDED', at: UNTIL } as const, '정액제가 끝났어요 (11/19 20:31). 새 실제 방송을 시작하려면 이용권이 필요해요.', 'danger'],
    [{ kind: 'NO_PASS' } as const, '이용권이 없어 새 실제 방송을 시작할 수 없어요. 리허설은 할 수 있어요.', 'danger'],
    [{ kind: 'ORDERS_OVER', count: 2 } as const, '주문 건권을 2건 넘게 썼어요. 다음에 사는 주문 건권에서 먼저 빠져요.', 'warning'],
    [{ kind: 'LABELS_OVER', count: 3 } as const, '라벨 장권을 3장 넘게 썼어요. 다음에 사는 라벨 장권에서 먼저 빠져요.', 'warning'],
  ])('%o', (banner, sentence, tone) => {
    expect(bannerSentence(banner)).toBe(sentence)
    expect(bannerTone(banner)).toBe(tone)
  })
})

describe('새 방송 시작 미리 보기 (BL-9 2, AC-N5-56)', () => {
  const allowed = { allowed: true, useDay: false, flatUntil: null, windowUntil: null, days: null, orders: null } as const
  it('정액 · 방송 일 새로 씀 · 열린 창 · 주문 건 · 없음', () => {
    expect(startSentence({ ...allowed, mode: 'FLAT', flatUntil: UNTIL })).toBe('정액제로 시작해요 (11/19 20:31까지).')
    expect(startSentence({ ...allowed, mode: 'DAY', useDay: true, days: { before: 3, after: 2 } })).toBe(
      '방송 일권 1일을 써요 (남은 3일 → 2일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.',
    )
    expect(startSentence({ ...allowed, mode: 'DAY', windowUntil: WINDOW_UNTIL })).toBe('방송 일권 24시간 안이에요 (10/21 20:00까지). 더 빠지지 않아요.')
    expect(startSentence({ ...allowed, mode: 'ORDERS', orders: 40 })).toBe('주문 건권으로 시작해요 (남은 40건). 1등이 나온 상품마다 1건씩 빠져요.')
    expect(startSentence({ allowed: false, reason: 'NO_PASS' })).toBe(NO_PASS_MESSAGE)
    expect(NO_PASS_MESSAGE).toBe('이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.')
  })
})

describe('이용 상태 네 칸 (AC-N5-51)', () => {
  it('정액제: 이용 중 · …까지 / 끝남 (…) / 없음', () => {
    expect(flatWords(flat({ active: true, until: UNTIL }))).toBe('이용 중 · 11/19 20:31까지')
    expect(flatWords(flat({ endedAt: UNTIL }))).toBe('끝남 (11/19 20:31)')
    expect(flatWords(flat())).toBe('없음')
  })

  it('잔량: 남은 N / 음수면 초과 N (낱말로)', () => {
    expect(balanceWords('DAYS', 3)).toBe('남은 3일')
    expect(balanceWords('ORDERS', 40)).toBe('남은 40건')
    expect(balanceWords('ORDERS', -3)).toBe('초과 3건')
    expect(balanceWords('LABELS', 100)).toBe('남은 100장')
    expect(balanceWords('LABELS', -3)).toBe('초과 3장')
    expect(balanceWords('DAYS', 0)).toBe('남은 0일')
    expect(windowWords({ from: '2026-10-20T11:00:00.000Z', until: WINDOW_UNTIL })).toBe('24시간 사용 중 · 10/21 20:00까지')
  })
})

describe('요금 표·결제 전 안내 (AC-N5-52, BL-9 5)', () => {
  it('"이름 · 30,000원 (부가세 포함)"', () => {
    expect(priceLine({ name: '정액제 30일', price: 30000 })).toBe('정액제 30일 · 30,000원 (부가세 포함)')
  })

  it('그 종류가 초과 중이면 초과분, 정액 이용 중이면 이어지는 기간, 아니면 없음', () => {
    const balances = { DAYS: 1, ORDERS: -2, LABELS: -5 }
    expect(beforePayNotices({ kind: 'ORDERS' }, { balances, flat: flat() })).toEqual([
      '지난 초과 2건이 이번 주문 건권에서 먼저 빠져요(이 이용권은 바로 쓴 것이 되어 7일 환불 대상이 아니에요).',
    ])
    expect(beforePayNotices({ kind: 'LABELS' }, { balances, flat: flat() })).toEqual([
      '지난 초과 5장이 이번 라벨 장권에서 먼저 빠져요(이 이용권은 바로 쓴 것이 되어 7일 환불 대상이 아니에요).',
    ])
    expect(beforePayNotices({ kind: 'DAYS' }, { balances, flat: flat() })).toEqual([])
    expect(beforePayNotices({ kind: 'FLAT_30D' }, { balances, flat: flat({ active: true, until: UNTIL }) })).toEqual(['남은 기간(11/19 20:31까지) 뒤에 30일이 이어져요.'])
    expect(beforePayNotices({ kind: 'FLAT_30D' }, { balances, flat: flat({ endedAt: UNTIL }) })).toEqual([])
  })
})

describe('결제 내역 낱말 (AC-N5-54, AC-N5-59)', () => {
  it('상태 낱말과 뜻: 결제 완료·환불함 = 성공, 확인 필요 = 주의, 결제 안 됨·금액이 달라 취소함 = 위험', () => {
    expect(ORDER_STATE_WORD).toEqual({
      PENDING: '결제 대기',
      FAILED: '결제 안 됨',
      GRANTED: '결제 완료',
      MISMATCH_CANCELLED: '금액이 달라 취소함',
      NEEDS_REVIEW: '확인 필요',
      REFUNDED: '환불함',
    })
    expect(ORDER_STATE_TONE.GRANTED).toBe('success')
    expect(ORDER_STATE_TONE.REFUNDED).toBe('success')
    expect(ORDER_STATE_TONE.NEEDS_REVIEW).toBe('warning')
    expect(ORDER_STATE_TONE.FAILED).toBe('danger')
    expect(ORDER_STATE_TONE.MISMATCH_CANCELLED).toBe('danger')
  })

  it('증빙: 발행 대기 / 발행됨 · 승인 번호 / 취소', () => {
    expect(documentWords({ kind: 'TAX_INVOICE', status: 'PENDING', approval: null, cancel: null })).toBe('세금계산서 발행 대기')
    expect(documentWords({ kind: 'TAX_INVOICE', status: 'ISSUED', approval: 'TEST-123', cancel: null })).toBe('세금계산서 발행됨 · TEST-123')
    expect(documentWords({ kind: 'CASH_RECEIPT', status: 'FAILED', approval: null, cancel: null })).toBe('현금영수증 발행 실패')
    expect(documentWords({ kind: 'TAX_INVOICE', status: 'ISSUED', approval: 'TEST-1', cancel: 'CANCELLED' })).toBe('세금계산서 발행됨 · TEST-1 · 취소됨')
    expect(documentWords({ kind: 'TAX_INVOICE', status: 'PENDING', approval: null, cancel: 'REQUESTED' })).toBe('세금계산서 발행 대기 · 취소 요청')
  })

  it('환불 확인 창 문장', () => {
    expect(refundQuestion('방송 일권 1일', 5000)).toBe("'방송 일권 1일' 결제(5,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요.")
  })

  it('운영자가 준 이용권의 이름', () => {
    expect(passWords('FLAT_30D', null)).toBe('정액제 30일')
    expect(passWords('DAYS', 5)).toBe('방송 일권 5일')
    expect(passWords('ORDERS', 100)).toBe('주문 건권 100건')
    expect(passWords('LABELS', 500)).toBe('라벨 장권 500장')
  })

  it('주문 상태 문장은 서버 확인 문장(BL-9 4)과 같다 — 을/를은 받침으로', () => {
    expect(orderStateSentence('GRANTED', '방송 일권 1일')).toBe('결제했어요. 방송 일권 1일을 받았어요.')
    expect(orderStateSentence('GRANTED', '시험 이용권')).toBe('결제했어요. 시험 이용권을 받았어요.')
    expect(orderStateSentence('GRANTED', '라벨 묶음 하나')).toBe('결제했어요. 라벨 묶음 하나를 받았어요.')
    expect(orderStateSentence('PENDING', 'x')).toBe("결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.")
    expect(orderStateSentence('FAILED', 'x')).toBe('결제가 되지 않았어요. 돈은 나가지 않았어요.')
    expect(orderStateSentence('MISMATCH_CANCELLED', 'x')).toBe('결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요.')
    expect(orderStateSentence('NEEDS_REVIEW', 'x')).toBe('결제를 자동으로 확인하지 못했어요. 운영자가 확인해요.')
    expect(orderStateSentence('REFUNDED', 'x')).toBe('환불했어요. 결제 수단으로 돌려드려요.')
    expect(objectParticle('abc')).toBe('을(를)')
    expect(objectParticle('')).toBe('을(를)')
  })
})

describe('쓴 내역 (AC-N5-55)', () => {
  const broadcast = { id: 'b1', title: '1부', date: '2026-10-20' }
  const usage = (patch: Partial<UsageItem>): UsageItem => ({ id: 1, kind: 'DAYS', at: '2026-10-20T11:00:00.000Z', broadcast, productNo: null, productName: null, windowUntil: null, ...patch })
  it('방송 일 · 주문 건 · 라벨 장 한 줄', () => {
    expect(usageLine(usage({ windowUntil: WINDOW_UNTIL }))).toBe('10/20 20:00 · 방송 일권 1일 · 1부(10/20) · 10/21 20:00까지')
    expect(usageLine(usage({ kind: 'ORDERS', at: '2026-10-20T11:05:00.000Z', productNo: 15, productName: '핑크프릴' }))).toBe('10/20 20:05 · 주문 1건 · 1부 15번 핑크프릴')
    expect(usageLine(usage({ kind: 'LABELS', at: '2026-10-20T11:06:00.000Z', productNo: 15 }))).toBe('10/20 20:06 · 라벨 1장 · 1부 15번')
    expect(usageLine(usage({ kind: 'LABELS', broadcast: null, productNo: null }))).toBe('10/20 20:00 · 라벨 1장')
  })
})

describe('약관 초안 (BL-10)', () => {
  it('아홉 조항, 법률 검토 메모는 화면에 없다', () => {
    expect(TERMS).toHaveLength(9)
    for (const clause of TERMS) expect(clause.text).not.toContain('법률 검토')
    expect(TERMS[4]?.text).toContain('결제한 때부터 7일 안에 전혀 쓰지 않은 이용권은 요금 화면에서 전액 환불(결제 취소)할 수 있다.')
  })
})
