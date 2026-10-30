// KP1 손님 장부 순수 함수 중 골든 밖의 것 (CR-2·CR-3·CR-5·CR-7): 낱말·코드 고르기·이름 가리기·화면 읽기 글·개월 낱말·문구.
import { describe, expect, it } from 'vitest'
import {
  CR_CONSENT_1,
  LINK_CODE_WORDS,
  addMonths,
  badgeSpoken,
  isLedgerMonths,
  ledgerDeleteOn,
  ledgerMonthsWord,
  maskRecipient,
  matchLinkCode,
  pickLinkCode,
  wonText,
} from '../src/customers/ledger-rules.ts'

describe('연결 코드 낱말·고르기 (CR-5, AC-KP1-09)', () => {
  it('낱말 48개, 서로 다르고 숫자가 없다', () => {
    expect(LINK_CODE_WORDS).toHaveLength(48)
    expect(new Set(LINK_CODE_WORDS).size).toBe(48)
    for (const word of LINK_CODE_WORDS) expect(word).toMatch(/^[가-힣]{2}$/)
    expect(LINK_CODE_WORDS.slice(0, 3)).toEqual(['하늘', '바다', '구름'])
    expect(LINK_CODE_WORDS.at(-1)).toBe('돌담')
  })

  it('서로 다른 두 낱말·공백 하나, 살아 있는 코드와 겹치지 않는다', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 300; i += 1) {
      const code = pickLinkCode(taken, (n) => (i * 7919) % n)
      expect(code).not.toBeNull()
      const [a, b, ...rest] = (code as string).split(' ')
      expect(rest).toEqual([])
      expect(a).not.toBe(b)
      expect(LINK_CODE_WORDS).toContain(a)
      expect(LINK_CODE_WORDS).toContain(b)
      expect(taken.has(code as string)).toBe(false)
      taken.add(code as string)
    }
  })

  it('남은 짝이 없으면 null, 난수가 범위 밖이면 던진다', () => {
    const all = new Set<string>()
    for (const a of LINK_CODE_WORDS) for (const b of LINK_CODE_WORDS) if (a !== b) all.add(`${a} ${b}`)
    expect(all.size).toBe(48 * 47)
    expect(pickLinkCode(all, () => 0)).toBeNull()
    expect(() => pickLinkCode(new Set(), (n) => n)).toThrow(RangeError)
  })

  it('고른 코드는 그 글 그대로 채팅에서 읽힌다', () => {
    const code = pickLinkCode(new Set(), () => 5) as string
    expect(matchLinkCode({ text: code.replace(' ', ''), codes: [code] })).toEqual({ code })
    expect(matchLinkCode({ text: '', codes: [code] })).toEqual({ code: null })
  })
})

describe('이름 가리기·끝자리 (CR-2 가정)', () => {
  it('코드 포인트로 가운데를 *', () => {
    expect(maskRecipient('홍길동')).toBe('홍*동')
    expect(maskRecipient('남궁민수')).toBe('남**수')
    expect(maskRecipient('홍길')).toBe('홍*')
    expect(maskRecipient('홍')).toBe('*')
    expect(maskRecipient('')).toBe('')
    expect(maskRecipient('😀가나')).toBe('😀*나')
  })
})

describe('손님 표시 글·금액 (CR-7)', () => {
  it('화면 읽기 글', () => {
    expect(badgeSpoken('단골 · 누적 125,000원')).toBe('손님: 단골, 누적 125,000원')
    expect(badgeSpoken('처음')).toBe('손님: 처음')
    expect(badgeSpoken('입금 늦음 주의')).toBe('손님: 입금 늦음 주의')
  })

  it('세 자리 쉼표 (정수 원)', () => {
    expect(wonText(0)).toBe('0')
    expect(wonText(999)).toBe('999')
    expect(wonText(1000)).toBe('1,000')
    expect(wonText(1234567)).toBe('1,234,567')
  })
})

describe('보관 기간 (CR-3, AC-KP1-06)', () => {
  it('개월 낱말·검사', () => {
    expect([6, 12, 24, 36].map((m) => ledgerMonthsWord(m as 6 | 12 | 24 | 36))).toEqual(['6개월', '1년', '2년', '3년'])
    expect(isLedgerMonths(12)).toBe(true)
    for (const bad of [0, 1, 18, '12', null, 12.5]) expect(isLedgerMonths(bad)).toBe(false)
  })

  it('AC-KP1-06: 마지막 주문 2026-01-31, 동의 24, 설정 12 → 2027-01-31 · 설정 6 → 2026-07-31', () => {
    expect(ledgerDeleteOn({ lastOrder: '2026-01-31', consentOrder: '2026-01-31', consentMonths: 24, settingMonths: 12 })).toEqual({ deleteOn: '2027-01-31' })
    expect(ledgerDeleteOn({ lastOrder: '2026-01-31', consentOrder: '2026-01-31', consentMonths: 24, settingMonths: 6 })).toEqual({ deleteOn: '2026-07-31' })
  })

  it('달 더하기는 말일로 자른다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 6)).toBe('2026-09-30')
    expect(() => addMonths('2026/01/01', 1)).toThrow(RangeError)
  })
})

describe('동의 문구 판 (CR-2)', () => {
  it('글 그대로, {가게}·{기간} 자리', () => {
    expect(CR_CONSENT_1.id).toBe('CR-CONSENT-1')
    expect(CR_CONSENT_1.title).toBe('다음 주문에도 이 배송지 쓰기 (선택)')
    expect(CR_CONSENT_1.body('초록가게', '1년')).toBe(
      '초록가게가 받는 분·연락처·주소를 다음 주문 배송지로 쓰려고 마지막 주문 뒤 1년 동안 보관해요. 그 뒤엔 지워요. 언제든 이 링크나 판매자에게 지워 달라고 할 수 있어요. 고르지 않아도 이번 주문은 그대로 보내요.',
    )
  })
})
