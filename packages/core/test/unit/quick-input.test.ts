// R-16 빠른 입력 한 줄 (AC-S01-40~44). 골든 quick-input.yaml이 정답 사례이고, 여기서는 규칙 문장과 속성을 넓게 확인한다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAmount, parseQuickInput, type QuickInputResult, type SettingsOverride } from '@livejjim/core'
import { findPrice } from '../../src/parse/quick-input.ts'

const WON = { 'price.unit': 'WON' } as const
const THOUSAND = { 'price.unit': 'THOUSAND' } as const

function check(cases: ReadonlyArray<readonly [string, QuickInputResult]>, settings: SettingsOverride = {}): void {
  for (const [input, expected] of cases) {
    const actual = parseQuickInput(input, settings)
    expect(actual, `${JSON.stringify(input)} ${JSON.stringify(settings)}`).toStrictEqual(expected)
    // 값이 undefined인 키도 없어야 한다 (AC-S01-41)
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
  }
}

describe('AC-S01-40 한 줄 등록 형식', () => {
  it('PRD-01 AC1의 네 줄', () => {
    const ok = { no: 15, name: '핑크프릴', price: 10000 }
    check([
      ['15 핑크프릴 10000', ok],
      ['15 핑크프릴 1만', ok],
      ['15번 핑크프릴 만원', ok],
      ['15/핑크프릴/10', ok],
    ])
  })

  it('여러 단어 품종, 가장 긴 가격 묶음, 슬래시 형식, 떨어진 번', () => {
    check([
      ['31 방울복랑 금 15000', { no: 31, name: '방울복랑 금', price: 15000 }],
      ['31  방울복랑   금  15000', { no: 31, name: '방울복랑 금', price: 15000 }],
      ['15 핑크프릴 1만 5천', { no: 15, name: '핑크프릴', price: 15000 }],
      ['15 핑크프릴 만 원', { no: 15, name: '핑크프릴', price: 10000 }],
      ['15 핑크프릴 만 이천 오백 십 오 원', { no: 15, name: '핑크프릴', price: 12515 }],
      ['15 레티지아 2호 10', { no: 15, name: '레티지아 2호', price: 10000 }],
      ['15/방울복랑 금/15', { no: 15, name: '방울복랑 금', price: 15000 }],
      ['15번/핑크/10', { no: 15, name: '핑크', price: 10000 }],
      ['15 핑크/블루 10', { no: 15, name: '핑크/블루', price: 10000 }],
      ['15 번 핑크프릴 10', { no: 15, name: '핑크프릴', price: 10000 }],
      ['15번 번 핑크 10', { no: 15, name: '번 핑크', price: 10000 }],
      ['15 <b>핑크</b> 10', { no: 15, name: '<b>핑크</b>', price: 10000 }],
      ['15 천사 5천', { no: 15, name: '천사', price: 5000 }],
      ['15 핑크 오 10', { no: 15, name: '핑크 오', price: 10000 }],
      ['１５ 핑크프릴 １０', { no: 15, name: '핑크프릴', price: 10000 }],
      ['015 핑크프릴 10', { no: 15, name: '핑크프릴', price: 10000 }],
      ['15\t핑크프릴\n10', { no: 15, name: '핑크프릴', price: 10000 }],
      ['15 10000', { no: 15, name: '', price: 10000 }],
      ['15 1만', { no: 15, name: '', price: 10000 }],
    ])
  })
})

describe('AC-S01-41 오류 결과', () => {
  it('가격 없음 → PRICE_MISSING + no·name', () => {
    check([
      ['15 핑크프릴', { error: 'PRICE_MISSING', no: 15, name: '핑크프릴' }],
      ['15', { error: 'PRICE_MISSING', no: 15, name: '' }],
      ['15번', { error: 'PRICE_MISSING', no: 15, name: '' }],
      ['15 번', { error: 'PRICE_MISSING', no: 15, name: '' }],
      ['15/', { error: 'PRICE_MISSING', no: 15, name: '' }],
      ['15 핑크프릴 공짜', { error: 'PRICE_MISSING', no: 15, name: '핑크프릴 공짜' }],
      ['15 핑크프릴 1만5', { error: 'PRICE_MISSING', no: 15, name: '핑크프릴 1만5' }],
      ['15 핑크프릴 1.23456만', { error: 'PRICE_MISSING', no: 15, name: '핑크프릴 1.23456만' }],
      ['15 /핑크/10', { error: 'PRICE_MISSING', no: 15, name: '/핑크/10' }],
    ])
  })

  it('가격 묶음 바로 앞 토큰과 이어진 한 금액일 수 있으면 PRICE_MISSING — 금액 조각만 가격으로 등록하지 않는다 (RA-S01-001·TD-S01-003)', () => {
    const missing = (name: string): QuickInputResult => ({ error: 'PRICE_MISSING', no: 15, name })
    for (const settings of [THOUSAND, WON]) {
      check(
        [
          // R-14가 애매하다고 거부한 금액의 꼬리만 가격이 되던 경우 (뜻한 값 → 예전 결과)
          ['15 핑크프릴 1만 500', missing('핑크프릴 1만 500')], // 10,500 → 500,000(THOUSAND)
          ['15 핑크프릴 1만 5', missing('핑크프릴 1만 5')], // → 5,000
          ['15 핑크프릴 1.5만 5천', missing('핑크프릴 1.5만 5천')], // → 5,000
          ['15 핑크프릴 5천 1만', missing('핑크프릴 5천 1만')], // 순서 거꾸로 → 10,000
          ['15 핑크프릴 1만5 천', missing('핑크프릴 1만5 천')], // → 1,000
          // 계수와 단위를 띄어 씀 (뜻한 값 → 예전 결과)
          ['15 핑크프릴 5 만', missing('핑크프릴 5 만')], // 50,000 → 10,000
          ['15 핑크프릴 2 천', missing('핑크프릴 2 천')], // 2,000 → 1,000
          ['15 핑크프릴 2 만 5천', missing('핑크프릴 2 만 5천')], // 25,000 → 15,000
          ['15 핑크프릴 2 만원', missing('핑크프릴 2 만원')], // 20,000 → 10,000
          ['15 핑크 오 천', missing('핑크 오 천')], // 5,000 → 1,000
          ['15 핑크 이만오 천', missing('핑크 이만오 천')], // 25,000 → 1,000
          ['15 핑크 십오 만', missing('핑크 십오 만')], // 150,000 → 10,000
          // 숫자 사이를 띄어 씀
          ['15 핑크프릴 1 500', missing('핑크프릴 1 500')], // 1,500 → 500,000(THOUSAND)
          ['15 핑크프릴 1, 500', missing('핑크프릴 1, 500')],
          ['15 1 10', missing('1 10')],
          ['15 레티지아 2 10', missing('레티지아 2 10')], // 품종 '레티지아 2'인지 가격의 일부인지 애매
        ],
        settings,
      )
    }
  })

  it('앞 토큰이 금액 조각이 아니면 그대로 등록한다', () => {
    check(
      [
        ['15 천사 5천', { no: 15, name: '천사', price: 5000 }], // 한글 숫자로 끝나고 가격이 숫자로 시작 → 한 금액으로 이을 수 없음
        ['15 천사 10', { no: 15, name: '천사', price: 10000 }],
        ['15 핑크 오 10', { no: 15, name: '핑크 오', price: 10000 }],
        ['15 핑크 오 오천', { no: 15, name: '핑크 오', price: 5000 }],
        ['15 핑크 10원 20', { no: 15, name: '핑크 10원', price: 20000 }], // '원'은 금액의 끝
        ['15 레티지아 2호 10', { no: 15, name: '레티지아 2호', price: 10000 }],
        ['15 레드-1 10', { no: 15, name: '레드-1', price: 10000 }],
        ['15 홍천 10', { no: 15, name: '홍천', price: 10000 }], // 금액 글자 아닌 글자가 섞임
        ['15 . 10', { no: 15, name: '.', price: 10000 }], // 금액 글자가 하나도 없음
        ['15 핑크프릴 1만 5천', { no: 15, name: '핑크프릴', price: 15000 }], // 한 묶음 전체가 가격
        ['15 1만', { no: 15, name: '', price: 10000 }],
      ],
      THOUSAND,
    )
  })

  it('U+FEFF가 숫자 사이에 끼면 번호·가격으로 읽지 않는다 (TD-S01-001)', () => {
    const zwnbsp = String.fromCodePoint(0xfeff)
    for (const settings of [THOUSAND, WON]) {
      check(
        [
          [`1${zwnbsp}5 핑크프릴 10`, { error: 'NUMBER_INVALID' }],
          [`15 핑크프릴 1${zwnbsp}500`, { error: 'PRICE_MISSING', no: 15, name: `핑크프릴 1${zwnbsp}500` }],
          [`${zwnbsp}15 핑크프릴 10`, { error: 'NUMBER_MISSING' }],
        ],
        settings,
      )
    }
  })

  it('번호 오류·빈 줄 → error만', () => {
    check([
      ['핑크프릴 10000', { error: 'NUMBER_MISSING' }],
      ['번 15 핑크 10', { error: 'NUMBER_MISSING' }],
      ['/15/핑크/10', { error: 'NUMBER_MISSING' }],
      ['0 핑크프릴 10000', { error: 'NUMBER_INVALID' }],
      ['0000 핑크프릴 10000', { error: 'NUMBER_INVALID' }],
      ['15.5 핑크프릴 10', { error: 'NUMBER_INVALID' }],
      ['15핑크 10', { error: 'NUMBER_INVALID' }],
      ['00015 핑크 10', { error: 'NUMBER_INVALID' }],
      ['1,5 핑크 10', { error: 'NUMBER_INVALID' }],
      ['15번째 핑크 10', { error: 'NUMBER_INVALID' }],
      ['', { error: 'EMPTY' }],
      ['   ', { error: 'EMPTY' }],
      ['\n\t', { error: 'EMPTY' }],
    ])
  })
})

describe('AC-S01-42 번호 범위는 claim.maxNumber', () => {
  it('기본 999', () => {
    check([
      ['999 핑크프릴 10', { no: 999, name: '핑크프릴', price: 10000 }],
      ['1000 핑크프릴 10', { error: 'NUMBER_INVALID' }],
    ])
  })

  it('maxNumber 50', () => {
    const settings = { 'claim.maxNumber': 50 } as const
    check(
      [
        ['50 핑크프릴 10', { no: 50, name: '핑크프릴', price: 10000 }],
        ['51 핑크프릴 10', { error: 'NUMBER_INVALID' }],
        ['1 핑크프릴 10', { no: 1, name: '핑크프릴', price: 10000 }],
      ],
      settings,
    )
  })
})

describe('AC-S01-43 가격 하한 100원', () => {
  it('단위 설정과 상관없이 100원 미만은 PRICE_TOO_LOW', () => {
    check(
      [
        ['15 핑크프릴 99', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 핑크프릴 10', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 핑크프릴 100', { no: 15, name: '핑크프릴', price: 100 }],
        ['15 핑크프릴 0', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 오', { error: 'PRICE_TOO_LOW', no: 15, name: '' }],
      ],
      WON,
    )
    check(
      [
        ['15 핑크프릴 0', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 핑크프릴 10원', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 핑크프릴 0.05', { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
        ['15 핑크프릴 0.1', { no: 15, name: '핑크프릴', price: 100 }],
        ['15 핑크프릴 1500', { no: 15, name: '핑크프릴', price: 1500 }],
      ],
      THOUSAND,
    )
  })
})

describe('AC-S01-44 빠른 입력 속성', () => {
  const nameToken = fc.constantFrom('핑크프릴', '방울복랑', '금', '레티지아', '2호', '<b>x</b>', '핑크/블루', '라울', '왕비뇌신금', 'A', '레드-1')
  const name = fc.array(nameToken, { maxLength: 3 }).map((tokens) => tokens.join(' '))

  it('1 ≤ no ≤ 999, 100 ≤ price ≤ 10^7, 금액으로 끝나지 않는 품종 → WON에서 "{no} {name} {price}" = { no, name, price }', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), name, fc.integer({ min: 100, max: 10 ** 7 }), (no, itemName, price) => {
        expect(parseQuickInput(`${no} ${itemName} ${price}`, WON)).toStrictEqual({ no, name: itemName, price })
      }),
      { numRuns: 3000 },
    )
  })

  it('임의 문자열: 결과 모양 중 하나, 성공이면 price ≥ 100, 1 ≤ no ≤ maxNumber, 품종에 앞뒤·연속 공백 없음', () => {
    const settings = fc.record(
      { 'claim.maxNumber': fc.constantFrom(1, 50, 999, 9999), 'price.unit': fc.constantFrom('WON' as const, 'THOUSAND' as const) },
      { requiredKeys: [] },
    )
    const piece = fc.constantFrom('15', '0', '999', '1000', '번', ' ', '/', '핑크', '금', '만', '천', '오', '원', '1만', '5천', '10', '100', '2,500', '1.5', '-', '\t', '１')
    const line = fc.oneof(
      fc.array(piece, { maxLength: 10 }).map((pieces) => pieces.join('')),
      fc.string({ maxLength: 40 }),
      fc.string({ unit: 'binary', maxLength: 40 }),
    )
    fc.assert(
      fc.property(line, settings, (text, config) => {
        const result = parseQuickInput(text, config)
        const maxNumber = config['claim.maxNumber'] ?? 999
        if ('error' in result) {
          const keys = Object.keys(result)
          if (result.error === 'PRICE_MISSING' || result.error === 'PRICE_TOO_LOW') expect(keys).toEqual(['error', 'no', 'name'])
          else expect(keys).toEqual(['error'])
        } else {
          expect(Object.keys(result)).toEqual(['no', 'name', 'price'])
          expect(result.price).toBeGreaterThanOrEqual(100)
          expect(Number.isSafeInteger(result.price)).toBe(true)
        }
        if ('no' in result && result.no !== undefined) {
          expect(Number.isInteger(result.no)).toBe(true)
          expect(result.no).toBeGreaterThanOrEqual(1)
          expect(result.no).toBeLessThanOrEqual(maxNumber)
        }
        if ('name' in result && result.name !== undefined) {
          // 공백 = R-3 정규화의 공백(U+FEFF는 공백이 아니다, TD-S01-001)
          expect(/^[^\S\uFEFF]|[^\S\uFEFF]$/u.test(result.name)).toBe(false)
          expect(/[^\S\uFEFF]{2}/u.test(result.name)).toBe(false)
        }
      }),
      { numRuns: 5000 },
    )
  })

  const priceToken = fc.constantFrom('핑크', '만', '이천', '오백', '십', '오', '원', '2500', '1만', '5천', '10', '천', '1.5만', '공짜', '2호', '구', '천사', '1,000', '10원')

  it('끝에서 AMOUNT_MAX_TOKENS개까지만 보는 가격 찾기 = 모든 묶음을 보는 찾기', () => {
    fc.assert(
      fc.property(fc.array(priceToken, { maxLength: 14 }), fc.constantFrom(WON, THOUSAND), (tokens, settings) => {
        // 규칙 문장 그대로: 끝에서부터 해석되는 가장 긴 연속 토큰 묶음
        let expected: { at: number; price: number } | null = null
        for (let at = 0; at < tokens.length && expected === null; at++) {
          const price = parseAmount(tokens.slice(at).join(' '), settings)
          if (price !== null) expected = { at, price }
        }
        expect(findPrice(tokens, settings)).toStrictEqual(expected)
        expect(findPrice(tokens, settings, Number.POSITIVE_INFINITY)).toStrictEqual(expected)
      }),
      { numRuns: 5000 },
    )
  })

  it('속성: 가격은 끝에서부터 가장 긴 묶음이고, 그 앞 토큰이 묶음과 이어질 수 있는 금액 조각이면 PRICE_MISSING (규칙 문장대로 따로 계산)', () => {
    const KOREAN_DIGITS = new Set([...'일이삼사오육칠팔구'])
    const UNITS = new Set([...'십백천만'])
    const NUMERALS = new Set([...'0123456789', ...KOREAN_DIGITS, ...UNITS])
    /** 금액 글자·쉼표·점으로만 되어 있고(금액 글자 하나 이상), 한글 숫자로 끝나면 가격이 단위로 시작한다 */
    const isFragment = (previous: string, priceStart: string): boolean => {
      const chars = [...previous]
      if (!chars.every((c) => NUMERALS.has(c) || c === ',' || c === '.') || !chars.some((c) => NUMERALS.has(c))) return false
      return !KOREAN_DIGITS.has(chars[chars.length - 1] as string) || UNITS.has(priceStart)
    }
    fc.assert(
      fc.property(fc.array(priceToken, { maxLength: 10 }), fc.constantFrom(WON, THOUSAND), (tokens, settings) => {
        const found = findPrice(tokens, settings)
        const missing: QuickInputResult = { error: 'PRICE_MISSING', no: 15, name: tokens.join(' ') }
        let expected: QuickInputResult = missing
        if (found !== null && !(found.at > 0 && isFragment(tokens[found.at - 1] as string, (tokens[found.at] as string).charAt(0)))) {
          const name = tokens.slice(0, found.at).join(' ')
          expected = found.price < 100 ? { error: 'PRICE_TOO_LOW', no: 15, name } : { no: 15, name, price: found.price }
        }
        expect(parseQuickInput(['15', ...tokens].join(' '), settings)).toStrictEqual(expected)
      }),
      { numRuns: 5000 },
    )
  })
})
