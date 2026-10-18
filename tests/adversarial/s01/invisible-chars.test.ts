// S01 적대 테스트 (test-domain): 보이지 않는 글자가 화면에 보이는 숫자를 갈라 다른 번호·가격으로 읽히는 경우.
// 근거: R-3 정규화("연속 공백 1칸"), R-14 1, R-16 1, AC-S01-10·18·40, D-006(오인 주문이 놓친 주문보다 위험), CLAUDE.md 규칙 7(채팅은 신뢰할 수 없는 입력).
// 판매자가 화면에서 보는 글자(예: "15")와 파서가 읽는 번호·가격이 달라지면 오인 주문·잘못된 가격 등록이다.
// 보이지 않는 글자는 소스에 그대로 쓰지 않고 코드 포인트로 만든다(눈에 안 보이는 테스트 데이터를 피한다).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, parseQuickInput, type SettingsOverride } from '@livejjim/core'

const ch = (codePoint: number): string => String.fromCodePoint(codePoint)

/**
 * U+FEFF ZERO WIDTH NO-BREAK SPACE(BOM). 폭이 0이라 화면에 보이지 않고, 유니코드 White_Space 속성이 없다(일반 분류 Cf).
 * JavaScript 정규식 `\s`는 역사적 이유로 이 글자를 포함한다.
 */
const ZWNBSP = ch(0xfeff)

/** 폭이 0이거나 혼자서는 보이지 않는 서식·채움 글자들. 모두 유니코드 White_Space가 아니다. */
const OTHER_INVISIBLE = [
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZWNJ
  0x200d, // ZWJ
  0x2060, // WORD JOINER
  0x200e, // LRM
  0x200f, // RLM
  0x00ad, // SOFT HYPHEN
  0x180e, // MONGOLIAN VOWEL SEPARATOR (예전 JS에선 \s였다)
  0x2061, // FUNCTION APPLICATION
  0x2062, // INVISIBLE TIMES
  0x2063, // INVISIBLE SEPARATOR
  0x2064, // INVISIBLE PLUS
  0x061c, // ARABIC LETTER MARK
  0x034f, // COMBINING GRAPHEME JOINER
  0xfe0e, // VS15
  0xfe0f, // VS16
  0x202a, // LRE
  0x202c, // PDF
  0x2066, // LRI
  0x2069, // PDI
  0x3164, // HANGUL FILLER
  0x115f, // HANGUL CHOSEONG FILLER
  0x1160, // HANGUL JUNGSEONG FILLER
  0xffa0, // HALFWIDTH HANGUL FILLER
].map(ch)

const MODES: readonly SettingsOverride[] = [
  {},
  { 'claim.parseMode': 'LOOSE' },
  { 'claim.multiNumber': 'FIRST' },
  { 'claim.multiNumber': 'IGNORE' },
  { 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'FIRST' },
  { 'claim.maxNumber': 9999 },
  { 'claim.parseMode': 'LOOSE', 'claim.maxNumber': 9999 },
]

/** 주문·취소 문법의 여러 자리에 번호를 넣는 틀 */
const TEMPLATES: readonly ((n: string) => string)[] = [
  (n) => n,
  (n) => `${n}번`,
  (n) => `찜 ${n}`,
  (n) => `${n} 주세요`,
  (n) => `${n}번 찜할게요!!`,
  (n) => `${n} 취소`,
  (n) => `${n}번 취소요`,
  (n) => `${n} 예뻐요`,
]

/** 숫자 문자열의 안쪽 자리(첫 글자 뒤 ~ 마지막 글자 앞) 하나에 글자를 끼운다 */
function insertInside(digits: string, at: number, char: string): string {
  const pos = 1 + (at % (digits.length - 1))
  return `${digits.slice(0, pos)}${char}${digits.slice(pos)}`
}

/** 주문·취소로 나온 번호는 화면에 보이는 번호 n 하나뿐이어야 한다(갈라진 조각 번호가 나오면 안 된다). */
function expectOnlyVisibleNumber(text: string, n: number, settings: SettingsOverride): void {
  const result = parseChat(text, settings)
  for (const value of [...result.claims, ...result.cancels]) {
    expect(value, `${JSON.stringify(text)} ${JSON.stringify(settings)} → ${JSON.stringify(result)}`).toBe(n)
  }
}

describe('TD-S01-001: U+FEFF(폭 없는 비분리 공백)를 공백으로 바꿔, 보이는 숫자 하나가 다른 번호·가격으로 갈라진다', () => {
  it('채팅: 화면에 "15"로 보이는 "1⟨U+FEFF⟩5"가 1번·5번 주문이 되면 안 된다 (STRICT·LOOSE)', () => {
    const text = `1${ZWNBSP}5`
    for (const settings of MODES) {
      const result = parseChat(text, settings)
      // 안전한 답은 "주문 아님"(U+200B와 같은 처리) 또는 보이는 그대로 15번 하나. 1번·5번 두 주문은 오인 주문이다.
      expect([[], [15]], JSON.stringify({ settings, result })).toContainEqual([...result.claims])
      expect(result.cancels).toEqual([])
    }
    expect(parseChat(`1${ZWNBSP}5번 찜할게요`).claims).not.toEqual([1, 5])
  })

  it('채팅 속성: 여러 자리 번호 n의 숫자 사이에 U+FEFF를 끼워도 주문·취소 번호는 n뿐이다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 9999 }),
        fc.nat(),
        fc.constantFrom(...TEMPLATES),
        fc.constantFrom(...MODES),
        (n, at, template, settings) => {
          expectOnlyVisibleNumber(template(insertInside(String(n), at, ZWNBSP)), n, settings)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('빠른 입력: 화면에 "15 핑크프릴 10"으로 보이는 줄이 1번 상품("5 핑크프릴")으로 등록되면 안 된다', () => {
    const result = parseQuickInput(`1${ZWNBSP}5 핑크프릴 10`)
    if ('price' in result) expect(result).toEqual({ no: 15, name: '핑크프릴', price: 10000 })
    else expect(result).toEqual({ error: 'NUMBER_INVALID' })
  })

  it('빠른 입력: 화면에 "1500"으로 보이는 가격이 500,000원(THOUSAND)·500원(WON)으로 등록되면 안 된다', () => {
    const text = `15 핑크프릴 1${ZWNBSP}500`
    for (const settings of [{}, { 'price.unit': 'WON' }] as const) {
      const result = parseQuickInput(text, settings)
      // 안전한 답: 보이는 그대로 1500원, 또는 금액으로 읽지 않음(PRICE_MISSING)
      if ('price' in result) expect(result, JSON.stringify(settings)).toEqual({ no: 15, name: '핑크프릴', price: 1500 })
      else expect(result, JSON.stringify(settings)).toMatchObject({ error: 'PRICE_MISSING', no: 15 })
    }
  })

  it('빠른 입력 속성: 번호·가격 숫자 사이에 U+FEFF를 끼워도 보이는 것과 다른 번호·가격으로 등록되지 않는다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 999 }),
        fc.integer({ min: 1000, max: 10_000_000 }),
        fc.nat(),
        fc.boolean(),
        fc.constantFrom('WON' as const, 'THOUSAND' as const),
        (no, price, at, inNumber, unit) => {
          const noText = inNumber ? insertInside(String(no), at, ZWNBSP) : String(no)
          const priceText = inNumber ? String(price) : insertInside(String(price), at, ZWNBSP)
          const result = parseQuickInput(`${noText} 핑크프릴 ${priceText}`, { 'price.unit': unit })
          if ('price' in result) expect(result).toEqual({ no, name: '핑크프릴', price })
          if ('no' in result && result.no !== undefined) expect(result.no).toBe(no)
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe('회귀: 다른 보이지 않는 글자는 보이는 숫자를 가르지 않는다 (U+200B·U+200E 등은 공백이 아님 — dev-notes)', () => {
  it('채팅 속성: 숫자 사이에 끼운 서식·채움 글자로 조각 번호의 주문·취소가 나오지 않는다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 9999 }),
        fc.nat(),
        fc.constantFrom(...OTHER_INVISIBLE),
        fc.constantFrom(...TEMPLATES),
        fc.constantFrom(...MODES),
        (n, at, char, template, settings) => {
          expectOnlyVisibleNumber(template(insertInside(String(n), at, char)), n, settings)
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('빠른 입력 속성: 번호·가격 숫자 사이의 서식·채움 글자로 다른 번호·가격이 등록되지 않는다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 999 }),
        fc.integer({ min: 1000, max: 10_000_000 }),
        fc.nat(),
        fc.constantFrom(...OTHER_INVISIBLE),
        fc.boolean(),
        (no, price, at, char, inNumber) => {
          const noText = inNumber ? insertInside(String(no), at, char) : String(no)
          const priceText = inNumber ? String(price) : insertInside(String(price), at, char)
          const result = parseQuickInput(`${noText} 핑크프릴 ${priceText}`, { 'price.unit': 'WON' })
          if ('price' in result) expect(result).toEqual({ no, name: '핑크프릴', price })
          if ('no' in result && result.no !== undefined) expect(result.no).toBe(no)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('보이는 공백(NBSP U+00A0, 전각 공백 U+3000, 탭·줄바꿈)은 공백이다 (R-3 정규화)', () => {
    expect(parseChat(`15${ch(0xa0)}번`)).toEqual({ claims: [15], cancels: [], mentions: [] })
    expect(parseChat(`１５${ch(0x3000)}２８`)).toEqual({ claims: [15, 28], cancels: [], mentions: [] })
    expect(parseChat('15\t\n28')).toEqual({ claims: [15, 28], cancels: [], mentions: [] })
    expect(parseQuickInput(`15${ch(0x3000)}핑크프릴${ch(0xa0)}10`)).toEqual({ no: 15, name: '핑크프릴', price: 10000 })
  })
})
