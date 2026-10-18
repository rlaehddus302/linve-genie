// S01 적대 테스트 (test-domain): 금액에서 단위 바로 뒤 한글 일의 자리 (R-14 4, D-032, AC-S01-21)와 한글 수사(R-15)는 그대로인지.
// 골든은 '만오'·'삼천오'·'백오만' 같은 대표 사례만 본다. 여기서는 AC-S01-21 속성의 예외식을 표준 읽기에서 더 넓혀 확인한다:
// - 천·백·십의 계수를 생략(1)·한글(일~구)·숫자(1~9)로 섞어 쓰기, 만의 계수를 숫자(105만)·한글(백오만)로 쓰기
// - 단위 묶음 사이 공백(R-14 4 "공백을 사이에 두어도 실패": '만 오', '삼천 오'), 만 뒤 네 자리 숫자('1만 1005'), '원'·' 원' 붙이기
// 정답: 한글 일의 자리가 있고 그 바로 앞 단위가 만·천·백이면 null, 아니면 값. 숫자 계수(105만)와 R-15 번호에는 적용하지 않는다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAmount, parseKoreanNumber, parseQuickInput, type SettingsOverride } from '@livejjim/core'

const WON: SettingsOverride = { 'price.unit': 'WON' }
const THOUSAND: SettingsOverride = { 'price.unit': 'THOUSAND' }
const SINO = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] as const
const UNITS = [
  [3, '천'],
  [2, '백'],
  [1, '십'],
] as const

/** 계수 쓰는 법: 0 = 표준(1이면 생략, 아니면 한글), 1 = 한글(1도 '일'), 2 = 숫자 */
type CoefficientStyle = 0 | 1 | 2

/**
 * 만 미만 수 v(1..9999)의 읽기. 천·백·십 묶음의 계수는 styles대로, 일의 자리는 한글만(R-14 4).
 * spaced이면 묶음 사이에 공백 한 칸(만의 계수 안에서는 쓰지 않는다).
 */
function readBelowMan(v: number, styles: readonly CoefficientStyle[], spaced: readonly boolean[]): string {
  const groups: string[] = []
  UNITS.forEach(([exponent, unit], k) => {
    const digit = Math.floor(v / 10 ** exponent) % 10
    if (digit === 0) return
    const style = styles[k] ?? 0
    const coefficient = style === 2 ? String(digit) : style === 1 || digit !== 1 ? SINO[digit] : ''
    groups.push(coefficient + unit)
  })
  if (v % 10 !== 0) groups.push(SINO[v % 10] as string)
  return groups.map((group, k) => (k > 0 && spaced[k] === true ? ' ' : '') + group).join('')
}

interface Reading {
  readonly text: string
  /** 정답: null 또는 값 */
  readonly expected: number | null
  readonly n: number
}

const ones = (v: number): boolean => v % 100 >= 1 && v % 100 <= 9

/** 만의 계수 m(0..9999)과 만 미만 b(0..9999)로 만든 읽기와 R-14 4·D-032대로의 정답 */
const reading = (allowSpaces: boolean) =>
  fc
    .record({
      m: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 100, max: 109 }), fc.integer({ min: 1000, max: 1009 }), fc.integer({ min: 1, max: 9999 })),
      b: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 100, max: 109 }), fc.integer({ min: 1000, max: 1009 }), fc.integer({ min: 1, max: 9999 })),
      mDigits: fc.boolean(),
      mOmitOne: fc.boolean(),
      mStyles: fc.array(fc.constantFrom<CoefficientStyle>(0, 1, 2), { minLength: 3, maxLength: 3 }),
      bStyles: fc.array(fc.constantFrom<CoefficientStyle>(0, 1, 2), { minLength: 3, maxLength: 3 }),
      bFourDigits: fc.integer({ min: 0, max: 2 }),
      spaced: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
      afterMan: fc.boolean(),
      won: fc.constantFrom('', '원', ' 원'),
    })
    .filter(({ m, b }) => m + b > 0)
    .map(({ m, b, mDigits, mOmitOne, mStyles, bStyles, bFourDigits, spaced, afterMan, won }): Reading => {
      const space = (on: boolean): string => (allowSpaces && on ? ' ' : '')
      // 만의 계수: 숫자 1~4자리 또는 공백 없는 한글 단위 표현. 1은 생략할 수 있다.
      const mText = m === 0 ? '' : m === 1 && mOmitOne ? '' : mDigits ? String(m) : readBelowMan(m, mStyles, [])
      const mKorean = m >= 1 && !mDigits && !(m === 1 && mOmitOne)
      // 만 미만: 한글 단위 표현, 또는 만 뒤 정확히 네 자리 숫자(쉼표 묶음 가능, 공백 필요)
      const bAsDigits = allowSpaces && m >= 1 && b >= 1000 && bFourDigits > 0
      const bText = b === 0 ? '' : bAsDigits ? (bFourDigits === 1 ? String(b) : `${String(b).slice(0, 1)},${String(b).slice(1)}`) : readBelowMan(b, bStyles, allowSpaces ? spaced : [])
      const head = m >= 1 ? `${mText}만` : ''
      const joiner = m >= 1 && b >= 1 ? (bAsDigits ? ' ' : space(afterMan)) : ''
      const text = head + joiner + bText + won
      // D-032: 만의 계수(한글) 안에서 일의 자리 바로 앞이 백·천, 또는 만 미만에서 일의 자리 바로 앞이 백·천·만
      const manFails = mKorean && m >= 100 && ones(m)
      const belowFails = b >= 1 && !bAsDigits && ones(b) && (b >= 100 || m >= 1)
      const n = m * 10_000 + b
      return { text, expected: manFails || belowFails ? null : n, n }
    })

describe('TD-S01-015: 금액에서 단위 바로 뒤 한글 일의 자리는 null — 계수 섞기·공백·네 자리 숫자까지 (R-14 4, D-032, AC-S01-21)', () => {
  it('속성: 섞어 쓴 읽기(공백 없음) — WON·THOUSAND 모두 정답대로', () => {
    fc.assert(
      fc.property(reading(false), ({ text, expected }) => {
        expect(parseAmount(text, WON), JSON.stringify(text)).toBe(expected)
        expect(parseAmount(text, THOUSAND), JSON.stringify(text)).toBe(expected)
      }),
      { numRuns: 6000 },
    )
  })

  it('속성: 묶음 사이 공백·만 뒤 네 자리 숫자를 넣은 읽기 — 공백을 사이에 둬도 바로 앞 단위로 판정한다', () => {
    fc.assert(
      fc.property(reading(true), ({ text, expected }) => {
        expect(parseAmount(text, WON), JSON.stringify(text)).toBe(expected)
        expect(parseAmount(text, THOUSAND), JSON.stringify(text)).toBe(expected)
      }),
      { numRuns: 6000 },
    )
  })

  const CASES: readonly [string, number | null][] = [
    // 규칙 문장의 예와 같은 모양의 다른 수
    ['천사', null], // 1,004? 1,400?
    ['백일', null],
    ['만일', null],
    ['이천구', null],
    ['구백구', null],
    ['1백오', null], // 숫자 계수여도 '오' 바로 앞은 백
    ['9천9백구', null],
    ['만 천 백 오', null], // 공백을 사이에 둬도 '오' 바로 앞은 백
    ['일만 일', null],
    ['천오만', null], // 만의 계수 '천오' 안에서 '오' 바로 앞이 천
    ['1천오만', null],
    ['이백삼만', null],
    ['구천구백구십구만 구천구백구', null],
    // 받음
    ['이천', 2000],
    ['일천', 1000],
    ['십일', 11],
    ['백십일', 111],
    ['만 십 일', 10_011],
    ['1천5백만', 15_000_000],
    ['1005만', 10_050_000], // 숫자 계수에는 적용하지 않는다
    ['1만 1005', 11_005], // 만 뒤 네 자리 숫자에는 한글 일의 자리가 없다
    ['백오만 1005', null], // 만의 계수 '백오'에서 실패
    ['오만 오천 원', 55_000],
    ['구천구백구십구만 구천구백구십구', 99_999_999],
  ]
  for (const [text, want] of CASES) {
    it(JSON.stringify(text), () => {
      expect(parseAmount(text, WON), 'WON').toBe(want)
      expect(parseAmount(text, THOUSAND), 'THOUSAND').toBe(want)
    })
  }

  it('속성: 빠른 입력 "15 핑크 {공백 없는 읽기}" — 정답이 null이면 PRICE_MISSING(품종 = 번호 뒤 전부), 아니면 그 값으로 등록하거나 100원 미만이면 PRICE_TOO_LOW', () => {
    fc.assert(
      fc.property(reading(false), fc.constantFrom(WON, THOUSAND), ({ text, expected }, settings) => {
        const result = parseQuickInput(`15 핑크 ${text}`, settings)
        const want = expected === null ? { error: 'PRICE_MISSING', no: 15, name: `핑크 ${text}` } : expected < 100 ? { error: 'PRICE_TOO_LOW', no: 15, name: '핑크' } : { no: 15, name: '핑크', price: expected }
        expect(result, JSON.stringify(text)).toStrictEqual(want)
      }),
      { numRuns: 3000 },
    )
  })

  it('빠른 입력: 품종 끝 단어가 이런 한자어 수여도 가격으로 등록하지 않는다 ("15 핑크 천사" → 1004원 등록이던 것, TD-S01-006 일부)', () => {
    expect(parseQuickInput('15 핑크 천사')).toStrictEqual({ error: 'PRICE_MISSING', no: 15, name: '핑크 천사' })
    expect(parseQuickInput('15 블루 백일', WON)).toStrictEqual({ error: 'PRICE_MISSING', no: 15, name: '블루 백일' })
    // 띄어 쓴 '만 오'·'삼천 오': 어느 쪽이든 등록하지 않는다(오류 종류는 묻지 않는다)
    for (const text of ['15 핑크 만 오', '15 핑크 삼천 오', '15 핑크 백 오', '15 핑크 1만 오']) {
      for (const settings of [WON, THOUSAND]) {
        const result = parseQuickInput(text, settings)
        expect('error' in result ? result.error : JSON.stringify(result), JSON.stringify(text)).toMatch(/^PRICE_(MISSING|TOO_LOW)$/)
      }
    }
  })
})

describe('회귀: 한글 수사(번호)는 글자 그대로 — D-032는 R-15에 적용하지 않는다 (R-15, AC-S01-30)', () => {
  it('속성: 만 미만 묶음에서 일의 자리 바로 앞이 백·천인 번호(105, 1005, 2309 …)의 표준 읽기 → 그 번호', () => {
    const number = fc.integer({ min: 100, max: 9999 }).filter((v) => ones(v))
    fc.assert(
      fc.property(number, fc.constantFrom('', '번', ' 번'), (v, beon) => {
        const text = readBelowMan(v, [0, 0, 0], []) + beon
        expect(parseKoreanNumber(text), JSON.stringify(text)).toBe(v)
      }),
      { numRuns: 2000 },
    )
  })

  it('"백오"·"천사"·"백일"·"천오번"은 번호 105·1004·101·1005', () => {
    expect(parseKoreanNumber('백오')).toBe(105)
    expect(parseKoreanNumber('천사')).toBe(1004)
    expect(parseKoreanNumber('백일')).toBe(101)
    expect(parseKoreanNumber('천오번')).toBe(1005)
  })
})
