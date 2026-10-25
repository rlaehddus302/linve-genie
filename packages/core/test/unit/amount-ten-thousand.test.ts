// FB1 AC-FB1-04 [core] — price.unit 만원 단위 TEN_THOUSAND (R-14 3, D-FB1-11). 골든 amount.yaml·quick-input.yaml 끝 문서가 정답 사례이고,
// 여기서는 규칙 문장(1000 미만 ×10000, 원·한글 단위는 설정 무시, 원 단위 소수는 실패)과 WON·THOUSAND 불변을 넓게 확인한다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, PRICE_UNITS, checkSettings, isPriceUnit, parseAmount, parseQuickInput, resolveSettings } from '@livejjim/core'

const WON = { 'price.unit': 'WON' } as const
const THOUSAND = { 'price.unit': 'THOUSAND' } as const
const TEN_THOUSAND = { 'price.unit': 'TEN_THOUSAND' } as const

describe('price.unit 선택지 (D-FB1-11)', () => {
  it('선택지는 원·천원·만원 순서, 기본값은 THOUSAND 그대로', () => {
    expect(PRICE_UNITS).toEqual(['WON', 'THOUSAND', 'TEN_THOUSAND', 'AUTO']) // V3 D-V3-70 넷째 단위
    expect(DEFAULT_SETTINGS['price.unit']).toBe('THOUSAND')
    expect(resolveSettings({})['price.unit']).toBe('THOUSAND')
    expect(resolveSettings(TEN_THOUSAND)['price.unit']).toBe('TEN_THOUSAND')
  })

  it('checkSettings는 셋을 받고 다른 값은 거절한다', () => {
    for (const unit of PRICE_UNITS) expect(checkSettings({ 'price.unit': unit })).toEqual([])
    for (const bad of ['MAN', 'ten_thousand', 'TENTHOUSAND', '', 10000, null, true]) {
      expect(checkSettings({ 'price.unit': bad }).map((p) => p.key), String(bad)).toEqual(['price.unit'])
    }
  })

  it('isPriceUnit', () => {
    for (const unit of PRICE_UNITS) expect(isPriceUnit(unit)).toBe(true)
    for (const bad of ['YEN', 'won', undefined, null, 1000, {}]) expect(isPriceUnit(bad)).toBe(false)
  })
})

describe('R-14 3 TEN_THOUSAND 숫자 형식', () => {
  it('규칙 문장 사례', () => {
    const cases: ReadonlyArray<readonly [string, number | null]> = [
      ['14', 140000],
      ['15', 150000],
      ['1', 10000],
      ['0', 0],
      ['1.5', 15000],
      ['0.5', 5000],
      ['1.25', 12500],
      ['0.0001', 1],
      ['1.50000', 15000], // 끝 0은 자리 계산에서 지운다
      ['999', 9990000],
      ['999.9999', 9999999],
      ['1000', 1000],
      ['1,000', 1000],
      ['15000', 15000],
      ['15,000', 15000],
      ['15000원', 15000],
      ['15원', 15],
      ['15 원', 15],
      ['1.5원', null], // 원이면 소수가 원 단위로 남는다
      ['2만', 20000],
      ['만오천원', 15000],
      ['5천', 5000],
      ['1.5만', 15000],
      ['1.23456', null], // 12345.6원
      ['0.00001', null],
      ['10 000', null],
      ['0500', null],
      ['-5', null],
      ['1.', null],
      ['.5', null],
    ]
    for (const [input, expected] of cases) expect(parseAmount(input, TEN_THOUSAND), JSON.stringify(input)).toBe(expected)
  })

  it('경계: 0~999 모든 정수는 ×10000, 1000~1999는 그대로', () => {
    for (let n = 0; n < 1000; n++) expect(parseAmount(String(n), TEN_THOUSAND)).toBe(n * 10000)
    for (let n = 1000; n < 2000; n++) expect(parseAmount(String(n), TEN_THOUSAND)).toBe(n)
  })

  it('속성: 정수부 < 1000, 소수 네 자리 이하 → 정수부×10000 + 소수 자리값 (부동소수점 곱셈과 상관없이 정확)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 1, max: 4 }), (int, fracValue, width) => {
        const digits = String(fracValue).padStart(4, '0').slice(0, width)
        const expected = int * 10000 + Number(digits.padEnd(4, '0'))
        expect(parseAmount(`${int}.${digits}`, TEN_THOUSAND)).toBe(expected)
      }),
    )
  })

  it('속성: 다섯째 자리 이하에 0이 아닌 숫자가 있으면 null', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 1, max: 9 }), (int, head, tail) => {
        expect(parseAmount(`${int}.${String(head).padStart(4, '0')}${tail}`, TEN_THOUSAND)).toBeNull()
      }),
    )
  })

  it('속성: 0 ≤ n ≤ 10^12 — "n" → n < 1000이면 10000n 아니면 n, "n원" → n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), (n) => {
        expect(parseAmount(String(n), TEN_THOUSAND)).toBe(n < 1000 ? n * 10000 : n)
        expect(parseAmount(`${n}원`, TEN_THOUSAND)).toBe(n)
      }),
    )
  })

  it('속성: 숫자 형식이 아닌 글(한글 단위 등)은 세 단위 모두 결과가 같다', () => {
    const samples = ['2만', '1.5만', '만원', '오천', '칠천오백원', '1만 2500원', '십이만', '백오만', '1만5', '공짜', '', '2천500']
    for (const text of samples) {
      const won = parseAmount(text, WON)
      expect(parseAmount(text, THOUSAND), text).toBe(won)
      expect(parseAmount(text, TEN_THOUSAND), text).toBe(won)
    }
  })

  it('속성: 단위 없는 숫자에서 TEN_THOUSAND = THOUSAND × 10 (1000 미만), 같음 (1000 이상)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), (n) => {
        const thousand = parseAmount(String(n), THOUSAND)
        expect(parseAmount(String(n), TEN_THOUSAND)).toBe(n < 1000 ? (thousand as number) * 10 : thousand)
      }),
    )
  })

  it('모르는 단위 값이면 단위 없는 숫자는 추측하지 않고 null — 원·한글 단위는 그대로 읽는다', () => {
    const unknown = { 'price.unit': 'YEN' } as unknown as typeof WON
    expect(parseAmount('15', unknown)).toBeNull()
    expect(parseAmount('15000', unknown)).toBeNull()
    expect(parseAmount('15000원', unknown)).toBe(15000)
    expect(parseAmount('2만', unknown)).toBe(20000)
  })
})

describe('R-16 빠른 입력은 받은 단위를 그대로 넘긴다', () => {
  it('만원 방송', () => {
    expect(parseQuickInput('15 엘레강스 15', TEN_THOUSAND)).toStrictEqual({ no: 15, name: '엘레강스', price: 150000 })
    expect(parseQuickInput('15 엘레강스 15000', TEN_THOUSAND)).toStrictEqual({ no: 15, name: '엘레강스', price: 15000 })
    expect(parseQuickInput('15 엘레강스 2만', TEN_THOUSAND)).toStrictEqual({ no: 15, name: '엘레강스', price: 20000 })
    expect(parseQuickInput('15 엘레강스 1.5', TEN_THOUSAND)).toStrictEqual({ no: 15, name: '엘레강스', price: 15000 })
    expect(parseQuickInput('15 10', TEN_THOUSAND)).toStrictEqual({ no: 15, name: '', price: 100000 })
    expect(parseQuickInput('15 엘레강스 0.001', TEN_THOUSAND)).toStrictEqual({ error: 'PRICE_TOO_LOW', no: 15, name: '엘레강스' })
  })

  it('같은 줄을 세 단위로 — 천원·원 결과는 그대로', () => {
    expect(parseQuickInput('15 엘레강스 15', THOUSAND)).toStrictEqual({ no: 15, name: '엘레강스', price: 15000 })
    expect(parseQuickInput('15 엘레강스 15000', WON)).toStrictEqual({ no: 15, name: '엘레강스', price: 15000 })
    expect(parseQuickInput('15 엘레강스 15')).toStrictEqual(parseQuickInput('15 엘레강스 15', THOUSAND))
  })
})
