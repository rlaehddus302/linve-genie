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
        ['만오', null], // D-032: 일의 자리 바로 앞이 만 (15,000? 10,005?)
        ['천오', null], // D-032: 일의 자리 바로 앞이 천 (1,500? 1,005?)
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

  it('D-032: 한글 일의 자리는 앞에 단위가 없거나 바로 앞 단위가 십일 때만 — 바로 앞이 만·천·백이면 null (공백·만의 계수 안 포함)', () => {
    const cases: ReadonlyArray<readonly [string, number | null]> = [
      // R-14 4 규칙 문장의 실패 예
      ['만오', null],
      ['만 오', null],
      ['이만오', null],
      ['천오', null],
      ['삼천오', null],
      ['오천오 원', null],
      ['백오', null],
      ['1천오', null],
      ['1만 오', null],
      ['만오천오', null],
      ['백만오', null],
      ['백오만', null],
      // 같은 모양: 일(1)도 일의 자리, 숫자 계수여도 바로 앞 단위로 본다, 공백을 사이에 둬도 같다
      ['만일', null],
      ['백일', null],
      ['천사', null],
      ['1백오', null],
      ['만 천 백 오', null],
      ['일만 일', null],
      ['천오만', null],
      ['1천오만', null],
      ['백오만 1005', null],
      ['구천구백구십구만 구천구백구', null],
      // 받는 예
      ['오', 5],
      ['오원', 5],
      ['십오', 15],
      ['오십오', 55],
      ['백오십', 150],
      ['천오백원', 1500],
      ['십일', 11],
      ['백십일', 111],
      ['만십오', 10015],
      ['만 십 오', 10015],
      ['만오백', 10500],
      ['오만', 50000],
      ['오만오천', 55000],
      ['십오만', 150000],
      ['오십오만 오십오', 550055],
      ['105만', 1050000], // 숫자 계수에는 적용하지 않는다
      ['1005만', 10050000],
      ['1만 1005', 11005], // 만 뒤 네 자리 숫자에는 한글 일의 자리가 없다
    ]
    table(cases, WON)
    table(cases, THOUSAND)
  })

  /** AC-S01-21 속성의 예외식: 만 미만 묶음 b, 만의 계수 m에 대해 표준 읽기에서 일의 자리 한글 숫자 바로 앞이 만·천·백인 수 */
  const ambiguousOnes = (n: number): boolean => {
    const below = n % 10000
    const man = Math.floor(n / 10000)
    const ones = (v: number): boolean => v % 100 >= 1 && v % 100 <= 9
    return (ones(below) && (below >= 100 || man >= 1)) || (ones(man) && man >= 100)
  }

  /** 같은 판정을 읽기 글자에 규칙 문장대로 직접 적용한 것: 한글 일의 자리(만 앞 계수의 끝, 맨 끝) 바로 앞 글자가 만·천·백인가 */
  const ambiguousReading = (text: string): boolean => {
    const SINO = '일이삼사오육칠팔구'
    const endsWithOnesAfterBigUnit = (part: string): boolean => part.length >= 2 && SINO.includes(part.slice(-1)) && '만천백'.includes(part.slice(-2, -1))
    const man = text.indexOf('만')
    return endsWithOnesAfterBigUnit(text) || (man >= 0 && endsWithOnesAfterBigUnit(text.slice(0, man)))
  }

  it('속성: 예외식은 읽기 글자에 규칙 문장을 그대로 적용한 결과와 같다 (1..20000 전부 + 무작위)', () => {
    for (let n = 1; n <= 20000; n++) expect(ambiguousOnes(n), String(n)).toBe(ambiguousReading(sinoReading(n)))
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), (n) => {
        expect(ambiguousOnes(n), String(n)).toBe(ambiguousReading(sinoReading(n)))
      }),
      { numRuns: 5000 },
    )
  })

  it('속성: 1 ≤ n ≤ 99,999,999의 표준 한자어 읽기(+원) → n, 단 D-032 예외식에 드는 n은 null (WON·THOUSAND)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), fc.boolean(), (n, won) => {
        const text = `${sinoReading(n)}${won ? '원' : ''}`
        const expected = ambiguousOnes(n) ? null : n
        expect(parseAmount(text, WON), text).toBe(expected)
        expect(parseAmount(text, THOUSAND), text).toBe(expected)
      }),
      { numRuns: 3000 },
    )
  })

  it('속성: 1..20000의 표준 한자어 읽기를 모두 확인 (D-032 예외식에 드는 n은 null)', () => {
    let rejected = 0
    for (let n = 1; n <= 20000; n++) {
      const expected = ambiguousOnes(n) ? null : n
      if (expected === null) rejected++
      expect(parseAmount(sinoReading(n), WON), sinoReading(n)).toBe(expected)
    }
    // 예외식이 비어 있으면 위 확인이 D-032를 보지 못한다: 만 미만 b = 100..9999 중 b mod 100이 1~9인 수 891개 + 1만대 이상의 b = 1..9 등
    expect(rejected).toBeGreaterThan(1000)
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
  const literal = { onesOnlyAfterTen: false, afterMan: false } as const
  const both = [
    { spaces: true, digitCoefficients: true, onesOnlyAfterTen: true, afterMan: false },
    { spaces: false, digitCoefficients: false, ...literal },
  ]
  it('빈 문자열·끝 공백·앞 공백은 null', () => {
    for (const options of both) {
      expect(parseBelowMan('', options)).toBeNull()
      expect(parseBelowMan('천 ', options)).toBeNull()
      expect(parseBelowMan(' 천', options)).toBeNull()
    }
  })

  it('옵션: 공백·숫자 계수', () => {
    expect(parseBelowMan('이천 오백', { spaces: true, digitCoefficients: false, ...literal })).toBe(2500)
    expect(parseBelowMan('이천 오백', { spaces: false, digitCoefficients: true, ...literal })).toBeNull()
    expect(parseBelowMan('2천5백', { spaces: false, digitCoefficients: true, ...literal })).toBe(2500)
    expect(parseBelowMan('2천5백', { spaces: true, digitCoefficients: false, ...literal })).toBeNull()
  })

  it('옵션: 단위 바로 뒤 한글 일의 자리 (D-032) — 금액은 켜고, R-15 번호는 끈다', () => {
    const amount = { spaces: true, digitCoefficients: true, onesOnlyAfterTen: true, afterMan: false } as const
    const remainder = { ...amount, afterMan: true } as const
    const number = { spaces: false, digitCoefficients: false, ...literal } as const
    // 바로 앞 단위가 천·백 → 금액 null, 번호는 글자 그대로
    expect(parseBelowMan('천오', amount)).toBeNull()
    expect(parseBelowMan('천오', number)).toBe(1005)
    expect(parseBelowMan('백일', amount)).toBeNull()
    expect(parseBelowMan('백일', number)).toBe(101)
    expect(parseBelowMan('천 백 오', amount)).toBeNull()
    // 바로 앞 단위가 십이거나 앞에 단위가 없으면 받는다
    expect(parseBelowMan('백십오', amount)).toBe(115)
    expect(parseBelowMan('오', amount)).toBe(5)
    // 만 뒤 나머지: 첫 묶음의 바로 앞 단위는 만
    expect(parseBelowMan('오', remainder)).toBeNull()
    expect(parseBelowMan('십오', remainder)).toBe(15)
    expect(parseBelowMan('오백', remainder)).toBe(500)
    // afterMan만 켜고 onesOnlyAfterTen을 끄면 글자 그대로
    expect(parseBelowMan('오', { ...remainder, onesOnlyAfterTen: false })).toBe(5)
  })
})
