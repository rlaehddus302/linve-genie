// S01 적대 테스트 (test-domain): 메시지당 번호 개수 상한 (R-3 세부 "번호 개수 상한", D-034, AC-S01-19·14·17).
// 서로 다른 번호가 6개 이상이면 주문이 아니다(언급). 같은 번호 반복은 하나로 센다 — "같은 번호"는 값으로 본다(015 = 15, １５ = 15).
// 검사는 multiNumber 적용 전이고 STRICT·LOOSE 모두 같다. LOOSE는 고른(가장 긴) 주문 부분에 적용하고 더 짧은 앞부분으로 물러나지 않는다.
// 골든은 "1 2 3 4 5 6" 류 몇 개만 본다. 여기서는 문법으로 만든 메시지(선행 0·전각 숫자·번·찜·꼬리말·꼬리 기호·공백 잡음)를 넓게 본다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, type SettingsOverride } from '@livejjim/core'

const ch = (codePoint: number): string => String.fromCodePoint(codePoint)
const EMPTY = { claims: [], cancels: [], mentions: [] }
const claims = (...values: number[]) => ({ ...EMPTY, claims: values })
const mentions = (...values: number[]) => ({ ...EMPTY, mentions: values })
const unique = (values: readonly number[]): number[] => [...new Set(values)]

const MODES = ['STRICT', 'LOOSE'] as const
const MULTI = ['ALL', 'FIRST', 'IGNORE'] as const
type Multi = (typeof MULTI)[number]

/** R-3 세부대로의 정답: 서로 다른 번호 6개 이상이면 언급, 아니면 multiNumber */
function expected(values: readonly number[], multi: Multi) {
  const distinct = unique(values)
  if (distinct.length >= 6) return mentions(...distinct)
  if (multi === 'FIRST') return claims(distinct[0] as number)
  if (multi === 'IGNORE' && distinct.length > 1) return mentions(...distinct)
  return claims(...distinct)
}

const toFullWidth = (digits: string): string => [...digits].map((d) => ch(0xff10 + Number(d))).join('')
const CLAIM_WORDS = ['이요', '요', '여', '찜', '찜이요', '찜할게요', '주세요', '할게요', '구매', '구매요', '구매합니다']
/** 꼬리 기호: 기호 목록과 허용 목록 안 그림 이모지만 (D-033) */
const TAIL_UNITS = ['!', '~', '.', '^', '*', '♡', '♥', 'ㅎ', 'ㅋ', '❤️', '👍🏻', '😍', '🙏', '🔥', '🥰']
const SPACES = [' ', '  ', '\t', '\n', ch(0xa0), ch(0x3000)]

/** 번호 하나: 값(작은 풀에서 뽑아 중복이 잘 생기게), 선행 0, 전각, 번 */
const numberToken = fc
  .record({
    value: fc.oneof(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 999 })),
    zeros: fc.integer({ min: 0, max: 3 }),
    fullWidth: fc.boolean(),
    beon: fc.constantFrom('', '', '번', ' 번'),
  })
  .map(({ value, zeros, fullWidth, beon }) => {
    const plain = String(value)
    const digits = plain.padStart(Math.min(4, plain.length + zeros), '0')
    return { value, plain: digits + beon, text: (fullWidth ? toFullWidth(digits) : digits) + beon }
  })

const separator = fc.array(fc.constantFrom(' ', ',', '/', '·'), { minLength: 1, maxLength: 2 }).map((units) => units.join(''))

/** 주문 문법 `[찜] 번호목록 [꼬리말] [꼬리 기호]` — 번호 1~12개 */
const orderMessage = fc
  .record({
    prefix: fc.constantFrom('', '찜', '찜 '),
    tokens: fc.array(numberToken, { minLength: 1, maxLength: 12 }),
    separators: fc.array(separator, { minLength: 11, maxLength: 11 }),
    word: fc.option(fc.tuple(fc.boolean(), fc.constantFrom(...CLAIM_WORDS)), { nil: undefined }),
    tail: fc.array(fc.tuple(fc.boolean(), fc.constantFrom(...TAIL_UNITS)), { maxLength: 2 }),
    spaces: fc.array(fc.nat(), { maxLength: 30 }),
  })
  .map(({ prefix, tokens, separators, word, tail, spaces }) => {
    const join = (pick: (token: (typeof tokens)[number]) => string): string => tokens.map((token, k) => (k === 0 ? '' : (separators[k - 1] as string)) + pick(token)).join('')
    const wordText = word === undefined ? '' : (word[0] ? ' ' : '') + word[1]
    const tailText = tail.map(([space, unit]) => (space ? ' ' : '') + unit).join('')
    const raw = prefix + join((token) => token.text) + wordText + tailText
    let k = 0
    const text = raw.replace(/ /g, () => SPACES[(spaces[k++] ?? 0) % SPACES.length] as string)
    return { text, plain: prefix + join((token) => token.plain) + wordText + tailText, values: tokens.map((token) => token.value) }
  })
  // 천 단위 쉼표 묶음(예: 1,005)이 생기면 금액 덩어리라 주문이 아니다(AC-S01-13). 그런 메시지는 넘긴다.
  .filter(({ plain }) => !/\d,\d{3}(?!\d)/.test(plain))

describe('TD-S01-014: 서로 다른 번호 6개 이상이면 주문이 아니다 — multiNumber 적용 전, STRICT·LOOSE 같음 (D-034, AC-S01-19·14·17)', () => {
  it('속성: 문법으로 만든 메시지 — 서로 다른 번호 ≤ 5면 multiNumber대로 주문, ≥ 6이면 세 설정 모두 언급(서로 다른 번호, 나온 순서)', () => {
    fc.assert(
      fc.property(orderMessage, fc.constantFrom(...MODES), fc.constantFrom(...MULTI), ({ text, values }, parseMode, multi) => {
        const settings: SettingsOverride = { 'claim.parseMode': parseMode, 'claim.multiNumber': multi }
        expect(parseChat(text, settings), `${JSON.stringify(text)} ${parseMode} ${multi}`).toEqual(expected(values, multi))
      }),
      { numRuns: 4000 },
    )
  })

  it('속성: LOOSE에서 주문 부분 뒤에 말이 이어져도 같다 — 가장 긴 부분이 6개 이상이면 짧은 앞부분으로 물러나지 않는다', () => {
    fc.assert(
      fc.property(orderMessage, fc.constantFrom(' 다 주세요', ' 예뻐요 ㅎㅎ', ' 전부요'), fc.constantFrom(...MULTI), ({ text, values }, rest, multi) => {
        const message = text.trimEnd() + rest
        const settings: SettingsOverride = { 'claim.parseMode': 'LOOSE', 'claim.multiNumber': multi }
        expect(parseChat(message, settings), `${JSON.stringify(message)} ${multi}`).toEqual(expected(values, multi))
      }),
      { numRuns: 3000 },
    )
  })

  const CASES: readonly [string, SettingsOverride, unknown][] = [
    // 같은 번호는 값으로 센다: 1·01·001·0001은 번호 하나, １ = 1
    ['1 01 001 0001 2 3 4 5', {}, claims(1, 2, 3, 4, 5)],
    ['1 01 001 0001 2 3 4 5', { 'claim.multiNumber': 'FIRST' }, claims(1)],
    ['15 015 0015 １５ 15번', {}, claims(15)],
    ['15 015 0015 １５ 15번', { 'claim.multiNumber': 'IGNORE' }, claims(15)],
    ['1 1 2 2 3 3 4 4 5 5', {}, claims(1, 2, 3, 4, 5)],
    ['１ ２ ３ ４ ５ ６', {}, mentions(1, 2, 3, 4, 5, 6)],
    // 구분자·번·찜·꼬리말·꼬리 기호를 써도 6개면 주문 아님
    ['1/2/3/4/5/6', {}, mentions(1, 2, 3, 4, 5, 6)],
    ['1·2·3·4·5·6번 찜할게요!!', {}, mentions(1, 2, 3, 4, 5, 6)],
    ['찜 1번 2번 3번 4번 5번 6번', { 'claim.multiNumber': 'FIRST' }, mentions(1, 2, 3, 4, 5, 6)],
    ['1 2 3 4 5 6 1 2', { 'claim.multiNumber': 'FIRST' }, mentions(1, 2, 3, 4, 5, 6)],
    ['1000 2000 3000 4000 5000 6000', { 'claim.maxNumber': 9999 }, mentions(1000, 2000, 3000, 4000, 5000, 6000)],
    ['1000 2000 3000 4000 5000', { 'claim.maxNumber': 9999 }, claims(1000, 2000, 3000, 4000, 5000)],
    // LOOSE: 고른 부분('1 2 3 4 5 6!!')이 6개 → 공백 앞에서 끝나는 '1 2 3 4 5'로 물러나지 않는다
    ['1 2 3 4 5 6!! 다 주세요', { 'claim.parseMode': 'LOOSE' }, mentions(1, 2, 3, 4, 5, 6)],
    ['1 2 3 4 5 6 7 8 9 10 예뻐요', { 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'FIRST' }, mentions(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)],
    ['찜 1,2,3,4,5,6 할게요', { 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'IGNORE' }, mentions(1, 2, 3, 4, 5, 6)],
    // 취소는 번호 하나라 영향 없음
    ['6 취소', {}, { ...EMPTY, cancels: [6] }],
  ]
  for (const [text, settings, want] of CASES) {
    it(`${JSON.stringify(settings)} ${JSON.stringify(text)}`, () => {
      expect(parseChat(text, settings)).toEqual(want)
    })
  }

  it('속성: 어떤 메시지·설정에서도 주문 번호는 5개를 넘지 않고, ALL이 비면 FIRST도 비며 아니면 FIRST = [ALL의 첫 번호] (AC-S01-14)', () => {
    // 앞부분은 번호 나열(번호가 많이 나오게), 뒷부분은 위험한 글자 아무거나
    const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '015', '１']
    const JOINERS = [' ', ',', '/', '·', '번 ', ' 번 ', ', ']
    const JUNK = [...NUMBERS, ' ', ',', '번', '찜', '!', '❤️', '😭', '예뻐요', '?', '취소', '.', '~', '개']
    const message = fc
      .record({
        prefix: fc.constantFrom('', '찜', '찜 '),
        numbers: fc.array(fc.tuple(fc.constantFrom(...NUMBERS), fc.constantFrom(...JOINERS)), { minLength: 1, maxLength: 10 }),
        junk: fc.array(fc.constantFrom(...JUNK), { maxLength: 6 }),
      })
      .map(({ prefix, numbers, junk }) => prefix + numbers.map(([n, joiner], k) => (k === 0 ? '' : joiner) + n).join('') + junk.join(''))
    fc.assert(
      fc.property(message, fc.constantFrom(...MODES), fc.constantFrom(50, 999, 9999), (text, parseMode, maxNumber) => {
        const base = { 'claim.parseMode': parseMode, 'claim.maxNumber': maxNumber } as const
        const all = parseChat(text, { ...base, 'claim.multiNumber': 'ALL' })
        const first = parseChat(text, { ...base, 'claim.multiNumber': 'FIRST' })
        const ignore = parseChat(text, { ...base, 'claim.multiNumber': 'IGNORE' })
        for (const result of [all, first, ignore]) expect(result.claims.length, JSON.stringify(text)).toBeLessThanOrEqual(5)
        if (all.claims.length === 0) expect(first.claims, JSON.stringify(text)).toEqual([])
        else expect(first.claims, JSON.stringify(text)).toEqual([all.claims[0]])
      }),
      { numRuns: 5000 },
    )
  })
})
