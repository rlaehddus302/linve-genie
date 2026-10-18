// S01 적대 테스트 (test-domain): 금액 해석 R-14 · 한글 수사 R-15 · 빠른 입력 R-16 (AC-S01-20~22·30·40~44).
// 잘못된 가격이 숫자로 나오는 경우를 찾는다: 단위 경계(999/1000), 소수 자릿수, 큰 수, 원 위치, 이상한 쉼표, 다른 글자 섞기.
// 회귀 테스트: 지금 구현은 통과한다. 스펙이 정하지 않은(분쟁 중인) 입력(만오·천사·1.000 등)은 고정하지 않는다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAmount, parseKoreanNumber, parseQuickInput, type SettingsOverride } from '@livejjim/core'

const WON: SettingsOverride = { 'price.unit': 'WON' }
const THOUSAND: SettingsOverride = { 'price.unit': 'THOUSAND' }

describe('금액 오해석 회귀 (AC-S01-20~22)', () => {
  // [입력, THOUSAND 결과, WON 결과]
  const CASES: readonly [string, number | null, number | null][] = [
    // THOUSAND 단위 경계 (D-007): 값이 1000 미만이면 ×1000
    ['999', 999_000, 999],
    ['1000', 1000, 1000],
    ['999.9', 999_900, null],
    ['999.999', 999_999, null],
    ['999.9999', null, null], // ×1000 해도 원 단위 소수가 남는다
    ['0.1', 100, null],
    ['0.001', 1, null],
    ['0.0001', null, null],
    ['1000.5', null, null],
    ['1,000.0', 1000, 1000],
    ['999.0', 999_000, 999],
    ['0', 0, 0],
    ['0.0', 0, 0],
    // 숫자 형식 오류
    ['0.', null, null],
    ['.5', null, null],
    ['5.', null, null],
    ['1.2.3', null, null],
    ['00', null, null],
    ['0,000', null, null],
    ['1,,000', null, null],
    [',000', null, null],
    ['1,000,', null, null],
    ['1,5', null, null],
    ['1 0', null, null],
    ['1e3', null, null],
    ['0x10', null, null],
    ['Infinity', null, null],
    ['NaN', null, null],
    ['1_000', null, null],
    ['1，000', null, null], // 전각 쉼표는 정규화 대상이 아니다
    ['١٠', null, null], // 아라비아-인도 숫자
    ['+5', null, null],
    ['-5', null, null],
    ['5-', null, null],
    // 원 위치
    ['5000원원', null, null],
    ['원5000', null, null],
    ['50원00', null, null],
    ['원', null, null],
    ['1만원원', null, null],
    // 큰 수
    ['9007199254740991', 9_007_199_254_740_991, 9_007_199_254_740_991],
    ['9,007,199,254,740,991', 9_007_199_254_740_991, 9_007_199_254_740_991],
    ['9007199254740992', null, null],
    ['99999999999999999999', null, null],
    ['900719925474099.1', null, null],
    // 한글 단위
    ['1 만', null, null], // 만의 계수 안에는 공백이 없다
    ['1.5 만', null, null],
    ['이 천', null, null], // 계수는 단위에 붙여 쓴다
    ['10000만', null, null], // 만의 계수는 1~4자리
    ['12천', null, null], // 천의 계수는 한 자리
    ['0천', null, null],
    ['0십', null, null],
    ['01.5만', null, null],
    ['12345.5만', null, null],
    ['1.5555천', null, null],
    ['1.05십', null, null], // 10.5원
    ['1.5천만', null, null], // 소수 계수는 단위 하나뿐일 때만
    ['1만 2,50', null, null],
    ['1만 25000', null, null],
    ['1만 2500.5', null, null],
    ['1천 2500', null, null], // 네 자리 예외는 만 뒤에만
    ['2천 500', null, null],
    ['만만', null, null],
    ['천천', null, null],
    ['십백', null, null],
    ['일오', null, null],
    ['9999만 9999원', 99_999_999, 99_999_999],
    ['구천구백구십구만 구천구백구십구', 99_999_999, 99_999_999],
    ['1천2백만 3천', 12_003_000, 12_003_000],
    ['만 천 백 십 오 원', 11_115, 11_115],
    ['1.5십', 15, 15],
    ['5백', 500, 500], // 한글 단위가 있으면 단위 설정 무시
  ]
  for (const [text, thousand, won] of CASES) {
    it(JSON.stringify(text), () => {
      expect(parseAmount(text, THOUSAND), 'THOUSAND').toBe(thousand)
      expect(parseAmount(text, WON), 'WON').toBe(won)
    })
  }

  // 금액 형식에 들어올 수 있는 글자: 숫자, 쉼표, 점, 공백, 십·백·천·만, 일~구, 원
  const ALLOWED = new Set([...'0123456789,. 십백천만일이삼사오육칠팔구원'])
  const VALID = ['10000', '10,000', '7.5', '1만', '만원', '1만 2500원', '이만 오천 원', '1.5만', '2천5백', '1천2백만', '0']
  // 공백류·폭 없는 글자는 넣지 않는다(정규화 방식에 따라 답이 달라질 수 있다)
  // (폭 없는 서식 글자·이형 선택자·한글 채움 글자·전각 숫자)
  const QUIET_RANGES: readonly (readonly [number, number])[] = [
    [0x200b, 0x200f],
    [0x2060, 0x2064],
    [0xfeff, 0xfeff],
    [0xfe00, 0xfe0f],
    [0x00ad, 0x00ad],
    [0x180e, 0x180e],
    [0x034f, 0x034f],
    [0x3164, 0x3164],
    [0x115f, 0x1160],
    [0xffa0, 0xffa0],
    [0xff10, 0xff19],
  ]
  const isQuiet = (codePoint: number): boolean => QUIET_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
  const intruder = fc
    .oneof(fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 }), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }), fc.constantFrom('억', '조', '-', '+', '공', '영', '?', '٣', '१', '요'))
    .filter((s) => /\S/u.test(s) && ![...s].some((c) => ALLOWED.has(c) || /\s/u.test(c) || isQuiet(c.codePointAt(0) ?? 0)))

  it('속성: 금액 문자열 어디에든 그 밖의 글자가 섞이면 null (R-14 5)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID), intruder, fc.nat(), fc.constantFrom(WON, THOUSAND), (valid, extra, at, settings) => {
        const pos = at % (valid.length + 1)
        const text = valid.slice(0, pos) + extra + valid.slice(pos)
        expect(parseAmount(text, settings), JSON.stringify(text)).toBeNull()
      }),
      { numRuns: 3000 },
    )
  })

  it('속성: 한글 수사 문자열에 그 밖의 글자가 섞이면 null (R-15)', () => {
    const numbers = ['십오', '열다섯', '구천구백구십구', '스물다섯', '15', '015번', '백이']
    fc.assert(
      fc.property(fc.constantFrom(...numbers), intruder, fc.nat(), (valid, extra, at) => {
        const pos = at % (valid.length + 1)
        const text = valid.slice(0, pos) + extra + valid.slice(pos)
        expect(parseKoreanNumber(text), JSON.stringify(text)).toBeNull()
      }),
      { numRuns: 2000 },
    )
  })
})

describe('빠른 입력 분해 회귀 (AC-S01-40~44)', () => {
  const CASES: readonly [string, SettingsOverride, unknown][] = [
    ['00015 핑크 10', THOUSAND, { error: 'NUMBER_INVALID' }],
    ['15,000 핑크 10', THOUSAND, { error: 'NUMBER_INVALID' }],
    ['15, 핑크 10', THOUSAND, { error: 'NUMBER_INVALID' }],
    ['15ㄱ 핑크 10', THOUSAND, { error: 'NUMBER_INVALID' }],
    ['15번번 핑크 10', THOUSAND, { error: 'NUMBER_INVALID' }],
    ['-15 핑크 10', THOUSAND, { error: 'NUMBER_MISSING' }],
    ['/15 핑크 10', THOUSAND, { error: 'NUMBER_MISSING' }],
    ['٣ 핑크 10', THOUSAND, { error: 'NUMBER_MISSING' }],
    ['１５ 핑크 １０', THOUSAND, { no: 15, name: '핑크', price: 10_000 }],
    ['15 핑크 ١٠', THOUSAND, { error: 'PRICE_MISSING', no: 15, name: '핑크 ١٠' }],
    ['15 핑크 1억', THOUSAND, { error: 'PRICE_MISSING', no: 15, name: '핑크 1억' }],
    ['15 핑크 9007199254740992', WON, { error: 'PRICE_MISSING', no: 15, name: '핑크 9007199254740992' }],
    ['15 핑크프릴 1.5만5천', THOUSAND, { error: 'PRICE_MISSING', no: 15, name: '핑크프릴 1.5만5천' }],
    ['15 핑크프릴 99.9', WON, { error: 'PRICE_MISSING', no: 15, name: '핑크프릴 99.9' }], // WON에서 원 단위 소수
    ['15 핑크프릴 99.9', THOUSAND, { no: 15, name: '핑크프릴', price: 99_900 }],
    ['15 핑크프릴 0.1', THOUSAND, { no: 15, name: '핑크프릴', price: 100 }], // 하한 정확히 100원
    ['15 핑크프릴 0.099', THOUSAND, { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
    ['15 핑크프릴 99원', THOUSAND, { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }],
    ['15 핑크프릴 100원', THOUSAND, { no: 15, name: '핑크프릴', price: 100 }],
    ['15 핑크프릴 10 원', THOUSAND, { error: 'PRICE_TOO_LOW', no: 15, name: '핑크프릴' }], // '원' 앞 공백 허용 → 10원
    ['15 999', THOUSAND, { no: 15, name: '', price: 999_000 }],
    ['15 1000', THOUSAND, { no: 15, name: '', price: 1000 }],
    ['15 원숭이 10', THOUSAND, { no: 15, name: '원숭이', price: 10_000 }],
    ['15 핑크 10원 20', THOUSAND, { no: 15, name: '핑크 10원', price: 20_000 }],
    ['15 레티지아 2호 1만 5천 원', THOUSAND, { no: 15, name: '레티지아 2호', price: 15_000 }],
    ['15 만 천 백 십 오 원', WON, { no: 15, name: '', price: 11_115 }],
    ['15 a 만 천 백 십 오 원', WON, { no: 15, name: 'a', price: 11_115 }],
    ['15/핑크/블루/10', THOUSAND, { no: 15, name: '핑크 블루', price: 10_000 }],
    ['15번/핑크프릴/10', THOUSAND, { no: 15, name: '핑크프릴', price: 10_000 }],
    ['15//10', THOUSAND, { no: 15, name: '', price: 10_000 }],
    ['15/', THOUSAND, { error: 'PRICE_MISSING', no: 15, name: '' }],
    ['15 /핑크프릴/10', THOUSAND, { error: 'PRICE_MISSING', no: 15, name: '/핑크프릴/10' }], // 번호 바로 뒤가 아니면 /도 품종 글자
    ['15 번 10', THOUSAND, { no: 15, name: '', price: 10_000 }],
    ['15번 번 10', THOUSAND, { no: 15, name: '번', price: 10_000 }], // 번은 한 번만 붙는다
    ['15\t핑크\n프릴   10', THOUSAND, { no: 15, name: '핑크 프릴', price: 10_000 }],
    ['15 <script>alert(1)</script> 10', THOUSAND, { no: 15, name: '<script>alert(1)</script>', price: 10_000 }],
  ]
  for (const [text, settings, expected] of CASES) {
    it(`${JSON.stringify(settings)} ${JSON.stringify(text)}`, () => {
      expect(parseQuickInput(text, settings)).toStrictEqual(expected)
    })
  }

  it('maxNumber 경계 1·9999 (D-030)', () => {
    expect(parseQuickInput('1 핑크 10', { 'claim.maxNumber': 1 })).toStrictEqual({ no: 1, name: '핑크', price: 10_000 })
    expect(parseQuickInput('2 핑크 10', { 'claim.maxNumber': 1 })).toStrictEqual({ error: 'NUMBER_INVALID' })
    expect(parseQuickInput('9999 핑크 10', { 'claim.maxNumber': 9999 })).toStrictEqual({ no: 9999, name: '핑크', price: 10_000 })
    expect(parseQuickInput('10000 핑크 10', { 'claim.maxNumber': 9999 })).toStrictEqual({ error: 'NUMBER_INVALID' })
  })

  it('속성: 아무 줄에도 결과 키는 R-16 6의 세 모양 중 하나, 성공이면 가격 ≥ 100·번호 범위 안·품종 공백 정리, 가격은 품종 뒤 토큰 묶음의 R-14 값', () => {
    const word = fc.constantFrom('핑크', '프릴', '1', '2호', '만', '천', '오', '1만', '5천', '원', '10', '1,000', '1.5', '/', '번', '?', '😍', ' ', '\t')
    const line = fc.array(word, { minLength: 0, maxLength: 8 }).map((parts) => parts.join(' '))
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1200 }), line, fc.constantFrom(WON, THOUSAND), fc.constantFrom(50, 999), (no, rest, settings, maxNumber) => {
        const config = { ...settings, 'claim.maxNumber': maxNumber }
        const result = parseQuickInput(`${String(no)} ${rest}`, config) as Record<string, unknown>
        const keys = Object.keys(result).sort().join(',')
        expect(['error', 'error,name,no', 'name,no,price']).toContain(keys)
        if (keys === 'error') expect(['NUMBER_INVALID', 'NUMBER_MISSING', 'EMPTY']).toContain(result['error'])
        if (keys === 'error,name,no') expect(['PRICE_MISSING', 'PRICE_TOO_LOW']).toContain(result['error'])
        if (keys === 'name,no,price') {
          const { name, price } = result as { name: string; price: number }
          expect(price).toBeGreaterThanOrEqual(100)
          expect(no).toBeGreaterThanOrEqual(1)
          expect(no).toBeLessThanOrEqual(maxNumber)
          expect(name).toBe(name.trim())
          expect(name).not.toMatch(/\s\s/u)
          // 가격 토큰 묶음 = 정규화한 줄에서 번호·품종을 뺀 나머지. 그 묶음의 R-14 값이 가격이다.
          const normalized = `${String(no)} ${rest}`.replace(/\s+/gu, ' ').trim()
          const afterNumber = normalized.slice(String(no).length).trim().replace(/^번( |$)/u, '')
          const priceText = afterNumber.slice(name.length).trim()
          expect(parseAmount(priceText, config)).toBe(price)
        }
      }),
      { numRuns: 3000 },
    )
  })
})
