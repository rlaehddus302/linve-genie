// 화면 낱말(AC-S05-70, D-088)과 한국 시각 표시(NFR-07, AC-S05-92). 시험은 TZ=Pacific/Honolulu에서 돈다(verify test 단계).
import { formatWon } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { broadcastWords, dateLong, dateWords, dateYear, kstDate, kstStamp, kstTime, kstToday } from '../src/lib/kst.ts'
import {
  ALERT_WORD,
  CHAT_WORD,
  LABEL_WORD,
  ORIGIN_WORD,
  PRODUCT_STATUS_WORD,
  QUICK_REASONS,
  REJECT_REASON_WORD,
  actionWord,
  actorWord,
  claimStatusWord,
  stopReasonWord,
} from '../src/lib/words.ts'

describe('화면 낱말 (D-088)', () => {
  it('상품 상태', () => {
    expect(PRODUCT_STATUS_WORD).toEqual({ READY: '공개 전', OPEN: '판매 중', SOLD: '판매 완료', HOLD: '일시 중지', CLOSED: '판매 종료' })
  })

  it('찜 상태: 1등 · 대기 n번 · 보류 · 충돌 · 취소됨 · 중복', () => {
    expect(claimStatusWord('CONFIRMED', null, null)).toBe('1등')
    expect(claimStatusWord('WAITLISTED', null, 2)).toBe('대기 2번')
    expect(claimStatusWord('PENDING', 'UNOPENED', null)).toBe('보류')
    expect(claimStatusWord('CONFLICT', null, null)).toBe('충돌')
    expect(claimStatusWord('CANCELLED', null, null)).toBe('취소됨')
    expect(claimStatusWord('DUPLICATE', null, null)).toBe('중복')
  })

  it('거절 사유: 차단 · 판매 중 아님 · 품절 · 만료 · 대기 정리 · 무효 · 번호 바뀜', () => {
    const words = (['BLOCKED', 'NOT_ON_SALE', 'SOLD_OUT', 'EXPIRED', 'WAITLIST_CLEARED', 'BY_HOST', 'RENUMBERED'] as const).map((reason) =>
      claimStatusWord('REJECTED', reason, null),
    )
    expect(words).toEqual(['차단', '판매 중 아님', '품절', '만료', '대기 정리', '무효', '번호 바뀜'])
    expect(REJECT_REASON_WORD.EXPIRED).toBe('만료')
  })

  it('알림·라벨·채팅·조치자 낱말', () => {
    expect(Object.values(ALERT_WORD)).toEqual(['충돌', '취소 요청', '승계 결정 필요', '보류 찜', '확인 필요'])
    expect(Object.values(LABEL_WORD)).toEqual(['라벨 대기', '라벨 출력됨', '재출력 필요'])
    expect(Object.values(CHAT_WORD)).toEqual(['주문', '취소', '언급', '방송자'])
    expect(actorWord({ kind: 'account', loginId: 'shop1' })).toBe('shop1')
    expect(actorWord({ kind: 'server', loginId: null })).toBe('서버')
    expect(actorWord({ kind: 'collector', loginId: null })).toBe('수집기')
  })

  it('화면 낱말에 영어(로마자)가 없다', () => {
    const all = [
      ...Object.values(PRODUCT_STATUS_WORD),
      ...Object.values(REJECT_REASON_WORD),
      ...Object.values(ORIGIN_WORD),
      ...Object.values(ALERT_WORD),
      ...Object.values(LABEL_WORD),
      ...Object.values(CHAT_WORD),
      ...QUICK_REASONS,
      ...(['completed', 'stopped', 'ended', 'shutdown', null] as const).map(stopReasonWord),
      ...[
        'product.register',
        'product.open',
        'product.hold',
        'product.close',
        'product.update',
        'product.renumber',
        'host.cancel',
        'host.reject',
        'host.promote',
        'host.confirm',
        'host.approveCancel',
        'host.dismissCancel',
        'host.assign',
        'host.reopen',
        'host.resolveConflict',
        'host.convertMessage',
        'host.blockBuyer',
        'host.unblockBuyer',
      ].map((type) => actionWord(type, {})),
      ...(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT', 'CANCELLED', 'DUPLICATE'] as const).map((status) => claimStatusWord(status, null, 1)),
    ]
    for (const word of all) expect(word, word).not.toMatch(/[A-Za-z]/)
  })

  it('조치 기록 낱말 (AC-S05-35)', () => {
    expect(actionWord('host.cancel', {})).toBe('취소')
    expect(actionWord('host.reject', {})).toBe('무효')
    expect(actionWord('host.assign', {})).toBe('직접 배정')
    expect(actionWord('host.assign', { replace: 'c1' })).toBe('직접 배정(교체)')
    expect(actionWord('product.hold', {})).toBe('일시 중지')
    expect(actionWord('host.resolveConflict', { decision: 'SWITCH' })).toBe('충돌 결정: 바꾸기')
  })

  it('금액은 코어 formatWon 모양', () => {
    expect(formatWon(10000)).toBe('10,000원')
  })
})

describe('KST 시각 (Asia/Seoul 명시, 실행 환경 시간대와 무관)', () => {
  it('시험 환경은 KST가 아니다 (이 시험이 뜻이 있도록)', () => {
    expect(new Date('2026-10-19T00:00:00.000Z').getTimezoneOffset()).not.toBe(-540)
  })

  it('UTC ISO → KST HH:MM:SS', () => {
    expect(kstTime('2026-10-19T00:00:05.000Z')).toBe('09:00:05')
    expect(kstTime('2026-10-18T15:30:00.000Z')).toBe('00:30:00')
    expect(kstTime(Date.parse('2026-10-19T14:59:59.000Z'))).toBe('23:59:59')
    expect(kstTime('읽을 수 없는 값')).toBe('')
  })

  it('UTC → KST 날짜, 오늘', () => {
    expect(kstDate('2026-10-18T15:00:00.000Z')).toBe('2026-10-19')
    expect(kstDate('2026-10-18T14:59:59.999Z')).toBe('2026-10-18')
    expect(kstToday(Date.parse('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01')
  })

  it('날짜 낱말', () => {
    expect(dateWords('2026-10-09')).toBe('10월 9일')
  })
})

describe('날짜는 연도·요일까지, 받은 시각은 날짜와 함께 (AC-S06b-22·31, D-101·D-102) — TZ=Pacific/Honolulu에서도 같은 글자', () => {
  it('"2026년 10월 18일(일)" — 해를 넘긴 같은 날짜도 다른 글자', () => {
    expect(dateLong('2026-10-18')).toBe('2026년 10월 18일(일)')
    expect(dateLong('2025-10-18')).toBe('2025년 10월 18일(토)')
    expect(dateLong('2026-01-05')).toBe('2026년 1월 5일(월)')
    expect(dateYear('2026-10-18')).toBe('2026년 10월 18일')
    expect(broadcastWords('1부', '2026-10-18')).toBe('1부 · 2026년 10월 18일(일)')
    expect(dateLong('잘못')).toBe('잘못')
  })

  it('받은 시각 "10/18 20:01:05", 분까지면 "10/18 20:01" (KST, 실행 환경 시간대와 상관없다)', () => {
    expect(kstStamp('2026-10-18T11:01:05.000Z')).toBe('10/18 20:01:05')
    expect(kstStamp('2026-10-18T11:01:00.000Z', true)).toBe('10/18 20:01')
    // KST 자정 직전 = UTC 14:59 — 날짜는 KST로
    expect(kstStamp('2026-10-17T14:59:00.000Z', true)).toBe('10/17 23:59')
    expect(kstStamp('2026-01-04T15:00:01.000Z')).toBe('1/5 00:00:01')
    expect(kstStamp('읽을 수 없음')).toBe('')
  })
})
