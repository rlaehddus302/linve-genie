// R-14 금액 해석 (AC-S01-20~22). 골든 amount.yaml이 정답 사례이고, 여기서는 규칙 문장과 속성을 넓게 확인한다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAmount } from '@livejjim/core'
import { AMOUNT_MAX_TOKENS, parseBelowMan } from '../../src/parse/amount.ts'
import { sinoReading, withCommas } from './readings.ts'

const WON = { 'price.unit': 'WON' } as const
const THOUSAND = { 'price.unit': 'THOUSAND' } as const

const table = (cases: ReadonlyArray<readonly [string, number | null]>, settings: typeof WON | typeof THOUSAND) => {
  for (const [input, expected] of cases) expect(parseAmount(input, settings), `${JSON.stringify(input)} (${settings['price.unit']})`).toBe(expected)
}

describe('AC-S01-20 숫자 형식과 단위 설정', () => {
  it('WON: 숫자·쉼표 묶음·원', () => {
    table(
      [
        ['10000', 10000],
        ['10,000', 10000],
        ['10000원', 10000],
        ['10000 원', 10000],
        ['1,000,000', 1000000],
        ['0', 0],
        ['10', 10],
        ['1.0', 1],
        ['10.00', 10],
        ['9007199254740991', Number.MAX_SAFE_INTEGER],
      ],
      WON,
    )
  })

  it('THOUSAND: 1000 미만은 ×1000(소수 포함), 1000 이상은 원 그대로, 원이 붙으면 원', () => {
    table(
      [
        ['10', 10000],
        ['7.5', 7500],
        ['0', 0],
        ['0.1', 100],
        ['999', 999000],
        ['999.9', 999900],
        ['999.999', 999999],
        ['1000', 1000],
        ['1,500', 1500],
        ['10원', 10],
        ['7.5원', null],
        ['10 원', 10],
      ],
      THOUSAND,
    )
  })

  it('쉼표 묶음 오류·숫자 사이 공백·선행 0·점 위치 오류는 null', () => {
    for (const settings of [WON, THOUSAND]) {
      table(
        [
          ['10,00', null],
          ['1,0000', null],
          ['1000,000', null],
          [',100', null],
          ['100,', null],
          ['10 000', null],
          ['0500', null],
          ['00', null],
          ['0,500', null],
          ['.5', null],
          ['5.', null],
          ['1..5', null],
          ['1.5.5', null],
          [',', null],
          ['.', null],
          ['1,5.5', null],
        ],
        settings,
      )
    }
  })

  it('속성: 0 ≤ n ≤ 10^12 — WON에서 "n"·쉼표 묶음·"n원" → n, THOUSAND에서 "n" → n < 1000이면 1000n 아니면 n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), (n) => {
        expect(parseAmount(String(n), WON)).toBe(n)
        expect(parseAmount(withCommas(n), WON)).toBe(n)
        expect(parseAmount(`${n}원`, WON)).toBe(n)
        expect(parseAmount(`${n}원`, THOUSAND)).toBe(n)
        expect(parseAmount(String(n), THOUSAND)).toBe(n < 1000 ? n * 1000 : n)
      }),
      { numRuns: 2000 },
    )
  })

  it('속성: 1000 미만 정수 경계를 모두 확인 (THOUSAND)', () => {
    for (let n = 0; n < 1000; n++) expect(parseAmount(String(n), THOUSAND)).toBe(n * 1000)
  })
})

describe('AC-S01-21 한글 단위', () => {
  it('계수 생략은 1, 큰 단위부터 한 번씩, 묶음 사이 공백 허용', () => {
    table(
      [
        ['만원', 10000],
        ['만 원', 10000],
        ['만오천원', 15000],
        ['이만 오천 원', 25000],
        ['십이만원', 120000],
        ['천만원', 10000000],
        ['2만5천5백원', 25500],
        ['1천2백만', 12000000],
        ['2십만', 200000],
        ['만 이천 오백 십 오 원', 12515],
        ['오', 5],
        ['만오', 10005],
        ['천오', 1005],
        ['구천구백구십구만 구천구백구십구', 99999999],
        ['9999만', 99990000],
      ],
      WON,
    )
  })

  it('소수 계수는 단위 하나뿐일 때만', () => {
    table(
      [
        ['1.5만', 15000],
        ['1.25만', 12500],
        ['1.5천', 1500],
        ['0.5만', 5000],
        ['2.5백', 250],
        ['1.5십', 15],
        ['1234.5만', 12345000],
        ['1.5만 원', 15000],
        ['1.5만5천', null],
        ['1.23456만', null],
        ['1.555백', null],
        ['12.5천', null],
        ['01.5만', null],
        ['12345.5만', null],
        ['0.0만', null],
        ['1.5 만', null],
        ['.5만', null],
        ['1.만', null],
        ['1.5억', null],
      ],
      WON,
    )
  })

  it('숫자는 단위 바로 앞에만 — 예외: 만 뒤 정확히 네 자리', () => {
    table(
      [
        ['1만 2500원', 12500],
        ['1만2500', 12500],
        ['1만 2,500원', 12500],
        ['만 2500', 12500],
        ['1만5', null],
        ['1만 500', null],
        ['1만 0500', null],
        ['1만 0,500', null],
        ['1만 25000', null],
        ['1만 2,5000', null],
        ['2천500', null],
        ['1만 2천 2500', null],
        ['12천', null],
        ['0천', null],
        ['이 천', null],
        ['2 만', null],
        ['1,000만', null],
        ['0만', null],
        ['012만', null],
        ['12345만', null],
        ['십 이만', null],
      ],
      WON,
    )
  })

  it('한글 단위가 있으면 단위 설정을 무시한다', () => {
    table(
      [
        ['5백', 500],
        ['1만', 10000],
        ['오', 5],
        ['1.5천', 1500],
      ],
      THOUSAND,
    )
  })

  it('속성: 1 ≤ n ≤ 99,999,999의 표준 한자어 읽기(+원) → n (WON·THOUSAND)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), fc.boolean(), (n, won) => {
        const text = `${sinoReading(n)}${won ? '원' : ''}`
        expect(parseAmount(text, WON), text).toBe(n)
        expect(parseAmount(text, THOUSAND), text).toBe(n)
      }),
      { numRuns: 3000 },
    )
  })

  it('속성: 1..20000의 표준 한자어 읽기를 모두 확인', () => {
    for (let n = 1; n <= 20000; n++) expect(parseAmount(sinoReading(n), WON)).toBe(n)
  })
})

describe('AC-S01-22 거부', () => {
  it('규칙 문장의 거부 사례는 모두 null (WON·THOUSAND)', () => {
    const rejected = [
      '5천 1만',
      '1만 1만',
      '1억',
      '-5000',
      '+5000',
      '원5000',
      '5000원원',
      '원',
      ' 원 ',
      '공짜',
      '만원이요',
      '1.23456만',
      '9007199254740993',
      '9007199254740992',
      '12345678901234567890',
      '',
      '   ',
      '십십',
      '천천',
      '오오',
      '영',
      '일오',
      '만만',
      '백천',
      '십백',
      '오천 만',
      '1만 원 2천',
      '５천 원원',
    ]
    for (const settings of [WON, THOUSAND]) table(rejected.map((input) => [input, null] as const), settings)
    table(
      [
        ['1.5', null],
        ['7.5', null],
      ],
      WON,
    )
    table(
      [
        ['7.2555', null],
        ['1000.5', null],
      ],
      THOUSAND,
    )
  })

  it('정규화: 앞뒤 공백·전각 숫자·연속 공백', () => {
    table(
      [
        [' 2만원 ', 20000],
        ['１만', 10000],
        ['１０，０００', null],
        ['이만\t\t오천\n원', 25000],
      ],
      WON,
    )
  })

  it('U+FEFF는 공백이 아니다 — 숫자 사이·단위 사이에 끼면 null (TD-S01-001)', () => {
    const zwnbsp = String.fromCodePoint(0xfeff)
    for (const settings of [WON, THOUSAND]) {
      table(
        [
          [`1${zwnbsp}500`, null], // 화면엔 1500. 500·500,000이 아니다
          [`1만${zwnbsp}2500`, null],
          [`이만${zwnbsp}오천`, null],
          [`${zwnbsp}10000`, null],
          [`10000${zwnbsp}`, null],
        ],
        settings,
      )
    }
  })
})

describe('빠른 입력이 기대는 성질: 해석되는 금액의 토큰 수는 AMOUNT_MAX_TOKENS 이하', () => {
  it('가장 긴 경우가 정확히 AMOUNT_MAX_TOKENS개다', () => {
    const longest = '만 이천 오백 십 오 원'
    expect(longest.split(' ')).toHaveLength(AMOUNT_MAX_TOKENS)
    expect(parseAmount(longest, WON)).toBe(12515)
  })

  it('속성: 금액 같은 토큰을 아무렇게나 이어도, 해석되면 토큰 수 ≤ AMOUNT_MAX_TOKENS', () => {
    const token = fc.constantFrom('1만', '만', '2천', '천', '이천', '오백', '백', '십', '오', '삼', '원', '2500', '2,500', '1.5만', '10', '5천', '구', '9999만', '1', '십오')
    fc.assert(
      fc.property(fc.array(token, { minLength: 1, maxLength: 12 }), (tokens) => {
        const text = tokens.join(' ')
        if (parseAmount(text, WON) !== null) expect(tokens.length, text).toBeLessThanOrEqual(AMOUNT_MAX_TOKENS)
      }),
      { numRuns: 5000 },
    )
  })
})

describe('parseBelowMan — 금액(R-14)·한글 수사(R-15) 공용 만 미만 해석', () => {
  const both = [
    { spaces: true, digitCoefficients: true },
    { spaces: false, digitCoefficients: false },
  ]
  it('빈 문자열·끝 공백·앞 공백은 null', () => {
    for (const options of both) {
      expect(parseBelowMan('', options)).toBeNull()
      expect(parseBelowMan('천 ', options)).toBeNull()
      expect(parseBelowMan(' 천', options)).toBeNull()
    }
  })

  it('옵션: 공백·숫자 계수', () => {
    expect(parseBelowMan('이천 오백', { spaces: true, digitCoefficients: false })).toBe(2500)
    expect(parseBelowMan('이천 오백', { spaces: false, digitCoefficients: true })).toBeNull()
    expect(parseBelowMan('2천5백', { spaces: false, digitCoefficients: true })).toBe(2500)
    expect(parseBelowMan('2천5백', { spaces: true, digitCoefficients: false })).toBeNull()
  })
})
