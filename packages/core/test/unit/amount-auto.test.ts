// V3 AC-V3-74 (a) [core] — price.unit 자동 AUTO (R-14 3, D-V3-70). 골든 amount.yaml·quick-input.yaml 끝 AUTO 문서가 정답 사례이고,
// 여기서는 규칙 문장(정수부 1~2자리 ×10000, 3자리 ×1000, 1000 이상 원 그대로, 원·한글 단위는 설정 무시, 원 단위 소수는 실패)을 넓게 확인한다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, checkSettings, isPriceUnit, parseAmount, parseQuickInput, resolveSettings } from '@livejjim/core'

const AUTO = { 'price.unit': 'AUTO' } as const
const THOUSAND = { 'price.unit': 'THOUSAND' } as const
const TEN_THOUSAND = { 'price.unit': 'TEN_THOUSAND' } as const

describe('price.unit AUTO 설정 (D-V3-70)', () => {
  it('AUTO를 받고 기본값은 THOUSAND 그대로', () => {
    expect(isPriceUnit('AUTO')).toBe(true)
    expect(isPriceUnit('auto')).toBe(false)
    expect(checkSettings(AUTO)).toEqual([])
    expect(resolveSettings(AUTO)['price.unit']).toBe('AUTO')
    expect(DEFAULT_SETTINGS['price.unit']).toBe('THOUSAND')
  })
})

describe('R-14 3 AUTO 숫자 형식', () => {
  it('정해진 사례', () => {
    const cases: ReadonlyArray<readonly [string, number | null]> = [
      ['0', 0],
      ['1', 10000],
      ['25', 250000],
      ['99', 990000],
      ['1.5', 15000],
      ['0.5', 5000],
      ['99.5', 995000],
      ['100', 100000],
      ['180', 180000],
      ['999', 999000],
      ['180.5', 180500],
      ['999.9999', null],
      ['1.23456', null],
      ['1000', 1000],
      ['1,000', 1000],
      ['15000', 15000],
      ['15,000', 15000],
      ['1000.5', null],
      ['25원', 25],
      ['180 원', 180],
      ['18만', 180000],
      ['5천', 5000],
      ['2만5천', 25000],
      ['이만오천원', 25000],
      ['0500', null],
      ['025', null],
      ['10 000', null],
      ['10,00', null],
      ['', null],
    ]
    for (const [input, expected] of cases) expect(parseAmount(input, AUTO), JSON.stringify(input)).toBe(expected)
  })

  it('모든 정수 0~1999: 1~2자리 ×10000(= 만원), 3자리 ×1000(= 천원), 4자리 그대로', () => {
    for (let n = 0; n < 2000; n++) {
      const expected = n < 100 ? n * 10000 : n < 1000 ? n * 1000 : n
      expect(parseAmount(String(n), AUTO), String(n)).toBe(expected)
      if (n < 100) expect(parseAmount(String(n), AUTO)).toBe(parseAmount(String(n), TEN_THOUSAND))
      else expect(parseAmount(String(n), AUTO)).toBe(parseAmount(String(n), THOUSAND))
    }
  })

  it('속성: 원이 붙은 수와 한글 단위는 설정과 상관없이 같다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999 }), (n) => {
        expect(parseAmount(`${n}원`, AUTO)).toBe(n)
        expect(parseAmount(`${n}원`, AUTO)).toBe(parseAmount(`${n}원`, THOUSAND))
      }),
    )
    for (const text of ['만원', '6만', '18만 원', '천오백원', '3만 5천']) {
      expect(parseAmount(text, AUTO), text).toBe(parseAmount(text, THOUSAND))
    }
  })

  it('속성: 결과는 언제나 정수 원 또는 null', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{1,5}(\.[0-9]{0,5})?$/), (text) => {
        const won = parseAmount(text, AUTO)
        if (won !== null) expect(Number.isSafeInteger(won)).toBe(true)
      }),
    )
  })
})

describe('R-16 빠른 입력 AUTO', () => {
  it('골든과 같은 사례', () => {
    expect(parseQuickInput('15 핑크프릴 25', AUTO)).toStrictEqual({ no: 15, name: '핑크프릴', price: 250000 })
    expect(parseQuickInput('15 핑크프릴 180', AUTO)).toStrictEqual({ no: 15, name: '핑크프릴', price: 180000 })
    expect(parseQuickInput('15 핑크프릴 15000', AUTO)).toStrictEqual({ no: 15, name: '핑크프릴', price: 15000 })
    expect(parseQuickInput('15 핑크프릴 2만', AUTO)).toStrictEqual({ no: 15, name: '핑크프릴', price: 20000 })
    expect(parseQuickInput('150 180', AUTO)).toStrictEqual({ no: 150, name: '', price: 180000 })
    expect(parseQuickInput('15 핑크프릴 0', AUTO)).toStrictEqual({ error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' })
  })
})
