// S01 적대 테스트 (test-domain): 채팅 주문 인식 R-3 (AC-S01-10~18).
// - 놓친 주문: R-3 문법으로 만든 주문·취소 메시지를 무작위로 만들어(띄어쓰기·전각 숫자·꼬리말·꼬리 기호 조합) 빠짐없이 인식하는지
// - 오인 주문: 문법 밖 글자가 붙은 메시지, 전화번호·시각·키캡·다른 문자 체계 숫자, 설정 조합
// 회귀 테스트: 지금 구현은 통과한다. 스펙이 정하지 않은(분쟁 중인) 입력은 여기서 고정하지 않는다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, type SettingsOverride } from '@livejjim/core'

const ch = (codePoint: number): string => String.fromCodePoint(codePoint)
const LOOSE: SettingsOverride = { 'claim.parseMode': 'LOOSE' }
const EMPTY = { claims: [], cancels: [], mentions: [] }
const claims = (...values: number[]) => ({ ...EMPTY, claims: values })
const cancels = (...values: number[]) => ({ ...EMPTY, cancels: values })
const mentions = (...values: number[]) => ({ ...EMPTY, mentions: values })

/** R-3 세부 "꼬리 기호" (보이는 것) — 그림 이모지는 몇 개만 */
const TAIL_UNITS = ['!', '~', '.', '^', '*', '♡', '♥', '☆', '★', 'ㅎ', 'ㅋ', '❤️', '👍🏻', '😍', '🙏', '🔥']
const CLAIM_WORDS = ['이요', '요', '여', '찜', '찜이요', '찜할게요', '주세요', '할게요', '구매', '구매요', '구매합니다']
const CANCEL_WORDS = ['취소', '취소요', '취소할게요', '취소해주세요']
const SEPARATOR_UNITS = [' ', ',', '/', '·']
/** 정규화에서 공백 한 칸이 되는 것들 (R-3 정규화, AC-S01-18) */
const SPACES = [' ', ' ', '  ', '\t', '\n', ch(0xa0), ch(0x3000), ' \n ']

const toFullWidth = (digits: string): string => [...digits].map((d) => ch(0xff10 + Number(d))).join('')

/** 번호 하나: 숫자(선행 0 포함 최대 4자리, 일부 전각) + [번 | " 번"] */
const numberToken = fc
  .record({
    value: fc.integer({ min: 1, max: 999 }),
    zeros: fc.integer({ min: 0, max: 3 }),
    fullWidth: fc.boolean(),
    beon: fc.constantFrom('', '번', ' 번'),
  })
  .map(({ value, zeros, fullWidth, beon }) => {
    const plain = String(value)
    const digits = plain.padStart(Math.min(4, plain.length + zeros), '0')
    return { value, plain: digits + beon, text: (fullWidth ? toFullWidth(digits) : digits) + beon }
  })

const separator = fc.array(fc.constantFrom(...SEPARATOR_UNITS), { minLength: 1, maxLength: 3 }).map((units) => units.join(''))
const tail = (units: readonly string[]) =>
  fc.array(fc.tuple(fc.boolean(), fc.constantFrom(...units)), { maxLength: 3 }).map((items) => items.map(([space, unit]) => (space ? ' ' : '') + unit).join(''))

/** 공백 한 칸을 다른 공백(탭·줄바꿈·NBSP·전각 공백·여러 칸)으로 바꾸고 앞뒤에 공백을 붙인다 */
const withSpaceNoise = (text: string, picks: readonly number[], lead: number, trail: number): string => {
  let k = 0
  const body = text.replace(/ /g, () => SPACES[(picks[k++] ?? 0) % SPACES.length] as string)
  return `${SPACES[lead % SPACES.length] as string}${body}${SPACES[trail % SPACES.length] as string}`
}
const noise = fc.record({ picks: fc.array(fc.nat(), { maxLength: 20 }), lead: fc.nat(), trail: fc.nat(), on: fc.boolean() })

/** R-3 주문 문법 `[찜] 번호목록 [꼬리말] [꼬리 기호]`에 맞는 메시지 (plain은 전각·공백 잡음 없는 판) */
const orderMessage = fc
  .record({
    prefix: fc.constantFrom('', '찜', '찜 '),
    first: numberToken,
    rest: fc.array(fc.tuple(separator, numberToken), { maxLength: 3 }),
    word: fc.option(fc.tuple(fc.boolean(), fc.constantFrom(...CLAIM_WORDS)), { nil: undefined }),
    tail: tail(TAIL_UNITS),
    noise,
  })
  .map(({ prefix, first, rest, word, tail: tailText, noise: n }) => {
    const wordText = word === undefined ? '' : (word[0] ? ' ' : '') + word[1]
    const plain = prefix + first.plain + rest.map(([sep, token]) => sep + token.plain).join('') + wordText + tailText
    const raw = prefix + first.text + rest.map(([sep, token]) => sep + token.text).join('') + wordText + tailText
    const text = n.on ? withSpaceNoise(raw, n.picks, n.lead, n.trail) : raw
    return { text, plain, values: [first.value, ...rest.map(([, token]) => token.value)] }
  })
  // 천 단위 쉼표 묶음(예: 1,500)이 생기면 금액 덩어리라 주문이 아니다(AC-S01-13). 그런 메시지는 넘긴다.
  .filter(({ plain }) => !/\d,\d{3}(?!\d)/.test(plain))

/** R-3 취소 문법 `번호 [번] (취소|취소요|취소할게요|취소해주세요) [꼬리 기호·ㅠ·ㅜ]` */
const cancelMessage = fc
  .record({ token: numberToken, space: fc.boolean(), word: fc.constantFrom(...CANCEL_WORDS), tail: tail([...TAIL_UNITS, 'ㅠ', 'ㅜ']), noise })
  .map(({ token, space, word, tail: tailText, noise: n }) => {
    const raw = token.text + (space ? ' ' : '') + word + tailText
    return { text: n.on ? withSpaceNoise(raw, n.picks, n.lead, n.trail) : raw, value: token.value }
  })

const unique = (values: readonly number[]): number[] => [...new Set(values)]

describe('놓친 주문 회귀 (AC-S01-10·15·18): 문법으로 만든 메시지는 빠짐없이 주문·취소다', () => {
  it('속성: 주문 문법 메시지 → ALL은 번호 전부(순서·중복 제거), FIRST는 첫 번호, LOOSE도 같은 주문', () => {
    fc.assert(
      fc.property(orderMessage, ({ text, values }) => {
        expect(parseChat(text), JSON.stringify(text)).toEqual(claims(...unique(values)))
        expect(parseChat(text, { 'claim.multiNumber': 'FIRST' }), JSON.stringify(text)).toEqual(claims(values[0] as number))
        expect(parseChat(text, LOOSE), JSON.stringify(text)).toEqual(claims(...unique(values)))
        const ignore = parseChat(text, { 'claim.multiNumber': 'IGNORE' })
        expect(ignore, JSON.stringify(text)).toEqual(unique(values).length === 1 ? claims(values[0] as number) : mentions(...unique(values)))
      }),
      { numRuns: 3000 },
    )
  })

  it('속성: 취소 문법 메시지 → 취소 [번호] (STRICT·LOOSE, 여러 번호 설정과 무관)', () => {
    fc.assert(
      fc.property(cancelMessage, fc.constantFrom<SettingsOverride>({}, LOOSE, { 'claim.multiNumber': 'IGNORE' }, { 'claim.multiNumber': 'FIRST' }), ({ text, value }, settings) => {
        expect(parseChat(text, settings), JSON.stringify(text)).toEqual(cancels(value))
      }),
      { numRuns: 2000 },
    )
  })
})

describe('오인 주문 회귀 (AC-S01-11·15·16): 문법 밖 글자가 붙으면 STRICT에서 주문·취소가 아니다', () => {
  // 꼬리 기호도 꼬리말도 아닌 것들. 앞에 공백이 있어도 없어도 된다.
  // D-CHAT-ME-01: '살게요'는 뺐다 — "1찜이요 살게요"처럼 같은 번호에 주문 뜻 말을 덧붙인 채팅은 이제 주문(덧붙인 말 주문)이다
  const FORBIDDEN = ['?', '??', '%', 'ㅠ', 'ㅜㅜ', '개', '원', '맞나요?', '#', '@', 'a', '=', '요?', '번째']

  it('속성: 주문 문법 메시지 + 문법 밖 글자 → 주문 아님, 번호는 언급', () => {
    fc.assert(
      fc.property(orderMessage, fc.constantFrom(...FORBIDDEN), fc.boolean(), ({ text, values }, suffix, space) => {
        // '번째'는 '번'이 꼬리말처럼 붙지 않게 공백을 둔다
        const message = text.trimEnd() + (space || suffix === '번째' ? ' ' : '') + suffix
        expect(parseChat(message), JSON.stringify(message)).toEqual(mentions(...unique(values)))
      }),
      { numRuns: 2000 },
    )
  })

  it('속성: 취소 문법 메시지 + 문법 밖 글자 → 취소 아님, 번호는 언급', () => {
    const forbidden = FORBIDDEN.filter((suffix) => suffix !== 'ㅠ' && suffix !== 'ㅜㅜ')
    fc.assert(
      fc.property(cancelMessage, fc.constantFrom(...forbidden), fc.boolean(), ({ text, value }, suffix, space) => {
        const message = text.trimEnd() + (space ? ' ' : '') + suffix
        expect(parseChat(message), JSON.stringify(message)).toEqual(mentions(value))
      }),
      { numRuns: 1000 },
    )
  })

  const STRICT_CASES: readonly [string, unknown][] = [
    ['010-1234-5678', mentions(10)], // 전화번호: 범위 안 덩어리만 언급
    ['8:30', mentions(8, 30)], // 시각
    ['15:30', mentions(15, 30)],
    ['1️⃣5️⃣', mentions(1, 5)], // 키캡(U+20E3)은 꼬리 기호가 아니다
    ['١٥', EMPTY], // 아라비아-인도 숫자는 숫자가 아니다
    ['१५', EMPTY], // 데바나가리 숫자
    ['15 2개', mentions(15, 2)], // 수량
    ['15번 2개요', mentions(15, 2)],
    ['15 ㅠㅠ', mentions(15)], // 아쉬움
    ['15\n?', mentions(15)], // 여러 줄 질문
    ['15 🇰🇷', mentions(15)], // 국기(지역 표시 문자)는 Extended_Pictographic이 아니다
    ['<script>alert(15)</script>', mentions(15)],
    ['15,000원', EMPTY],
    ['12,500,000', EMPTY],
    ['1.5', EMPTY],
    ['15.0', EMPTY],
    ['15번 1.5만이요', mentions(15)], // 금액 덩어리가 있는 메시지는 주문이 아니다
    ['15 취소?', mentions(15)],
    ['15 취소요?', mentions(15)],
    ['15 취소 ㅋ', cancels(15)],
    ['15 취 소', mentions(15)],
    ['15번 사려다 취소', mentions(15)],
    ['취소 취소 15', mentions(15)],
    ['15 28 취소요', mentions(15, 28)],
    ['00015 취소', EMPTY],
    ['15 1000원', mentions(15)],
    ['찜, 15', mentions(15)],
    ['15,', mentions(15)],
    ['15/', mentions(15)],
  ]
  for (const [text, expected] of STRICT_CASES) {
    it(`STRICT ${JSON.stringify(text)}`, () => {
      expect(parseChat(text)).toEqual(expected)
    })
  }

  const LOOSE_CASES: readonly [string, SettingsOverride, unknown][] = [
    ['15번 취소 ㅠㅠ 죄송해요', LOOSE, cancels(15)], // 취소가 먼저
    ['15번 사려다 취소했어요', LOOSE, mentions(15)], // '취소'가 들어간 메시지는 주문이 아니다
    ['16 살게요 15 취소요', LOOSE, mentions(16, 15)],
    ['15 1,000원이에요', LOOSE, mentions(15)], // 금액 덩어리는 LOOSE에서도 메시지 전체 기준
    ['010-1234-5678', LOOSE, mentions(10)],
    ['8:30', LOOSE, mentions(8, 30)],
    ['15번 18번 중에 뭐가 나아요?', { ...LOOSE, 'claim.multiNumber': 'FIRST' }, claims(15)],
    ['15번 18번 중에 뭐가 나아요?', { ...LOOSE, 'claim.multiNumber': 'IGNORE' }, mentions(15, 18)],
    ['15 15 예뻐요', { ...LOOSE, 'claim.multiNumber': 'IGNORE' }, claims(15)],
    // TD-S01-002 회귀: LOOSE도 범위는 메시지 전체로 본다 — 범위 밖 번호 뒤에 '원'·'개'가 붙어도 주문이 되지 않는다
    ['15 1000', LOOSE, mentions(15)],
    ['15 1000원', LOOSE, mentions(15)],
    ['15 1000원이에요', LOOSE, mentions(15)],
    ['15 2000원 맞죠?', LOOSE, mentions(15)],
    ['15 0개', LOOSE, mentions(15)],
    ['15 0원', LOOSE, mentions(15)],
    ['15번 너무 예뻐요 9999번째 방송 축하해요', LOOSE, mentions(15)],
    ['15 취소 1000번째', LOOSE, mentions(15)],
    ['15번 예뻐요 51번도요', { ...LOOSE, 'claim.maxNumber': 50 }, mentions(15)],
  ]
  for (const [text, settings, expected] of LOOSE_CASES) {
    it(`${JSON.stringify(settings)} ${JSON.stringify(text)}`, () => {
      expect(parseChat(text, settings)).toEqual(expected)
    })
  }
})

describe('설정 조합 회귀 (AC-S01-12·14): maxNumber 경계 1·50·999·9999, multiNumber × parseMode', () => {
  const CASES: readonly [number, string, unknown][] = [
    [1, '1', claims(1)],
    [1, '2', EMPTY],
    [1, '01', claims(1)],
    [1, '0001번', claims(1)],
    [1, '1 2', mentions(1)],
    [1, '1 취소', cancels(1)],
    [1, '2 취소', EMPTY],
    [50, '50번 찜할게요', claims(50)],
    [50, '15 51 취소', mentions(15)],
    [999, '999 1000', mentions(999)],
    [9999, '9999', claims(9999)],
    [9999, '10000', EMPTY],
    [9999, '1,000', EMPTY], // 금액 덩어리
    [9999, '1000 9999', claims(1000, 9999)],
    [9999, '9999번 취소', cancels(9999)],
    [9999, '010-1234-5678', mentions(10, 1234, 5678)],
  ]
  for (const [maxNumber, text, expected] of CASES) {
    it(`maxNumber ${String(maxNumber)}: ${JSON.stringify(text)}`, () => {
      expect(parseChat(text, { 'claim.maxNumber': maxNumber })).toEqual(expected)
      expect(parseChat(text, { 'claim.maxNumber': maxNumber, 'claim.parseMode': 'LOOSE' })).toEqual(expected)
    })
  }

  // 위험한 글자만 모은 알파벳으로 만든 메시지
  const ALPHABET = ['1', '5', '0', '9', '15', '1000', ' ', ',', '/', '·', '.', '번', '찜', '취소', '요', '주세요', '!', '~', '?', 'ㅠ', 'ㅋ', '❤️', '👍🏻', ch(0x200d), ch(0xfe0f), ch(0x200b), ch(0xfeff), '12,500', '만', '원', '개', '１', '\n', '예뻐요', '%', '-', ':']
  const message = fc.array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 10 }).map((parts) => parts.join(''))
  const mode = fc.constantFrom('STRICT' as const, 'LOOSE' as const)
  const maxNumber = fc.constantFrom(1, 50, 999, 9999)

  it('속성: 비어 있지 않은 배열 ≤ 1, 중복 없음, 값은 1..maxNumber 정수, STRICT에서 ?로 끝나면 주문·취소 없음', () => {
    fc.assert(
      fc.property(message, mode, maxNumber, fc.constantFrom('ALL' as const, 'FIRST' as const, 'IGNORE' as const), (text, parseMode, max, multi) => {
        const result = parseChat(text, { 'claim.parseMode': parseMode, 'claim.maxNumber': max, 'claim.multiNumber': multi })
        const lists = [result.claims, result.cancels, result.mentions]
        expect(lists.filter((list) => list.length > 0).length).toBeLessThanOrEqual(1)
        for (const list of lists) {
          expect(new Set(list).size).toBe(list.length)
          for (const n of list) {
            expect(Number.isInteger(n)).toBe(true)
            expect(n).toBeGreaterThanOrEqual(1)
            expect(n).toBeLessThanOrEqual(max)
          }
        }
        if (parseMode === 'STRICT' && text.trimEnd().endsWith('?')) {
          expect(result.claims).toEqual([])
          expect(result.cancels).toEqual([])
        }
      }),
      { numRuns: 5000 },
    )
  })

  it('속성: 여러 번호 설정은 주문에만 영향 — 취소와 주문 아닌 메시지는 ALL·FIRST·IGNORE 결과가 같다, FIRST·IGNORE는 ALL에서 정해진다', () => {
    fc.assert(
      fc.property(message, mode, maxNumber, (text, parseMode, max) => {
        const base = { 'claim.parseMode': parseMode, 'claim.maxNumber': max } as const
        const all = parseChat(text, { ...base, 'claim.multiNumber': 'ALL' })
        const first = parseChat(text, { ...base, 'claim.multiNumber': 'FIRST' })
        const ignore = parseChat(text, { ...base, 'claim.multiNumber': 'IGNORE' })
        if (all.claims.length === 0) {
          expect(first).toEqual(all)
          expect(ignore).toEqual(all)
        } else {
          expect(first).toEqual(claims(all.claims[0] as number))
          if (all.claims.length === 1) expect(ignore).toEqual(all)
          else {
            // 주문이 아니게 된 메시지의 언급은 메시지 전체의 번호다(LOOSE면 주문 부분 뒤 번호도). 맨 앞은 ALL의 주문 번호들이다.
            expect(ignore.claims).toEqual([])
            expect(ignore.cancels).toEqual([])
            expect(ignore.mentions.slice(0, all.claims.length)).toEqual(all.claims)
          }
        }
      }),
      { numRuns: 5000 },
    )
  })

  it('속성: STRICT에서 주문·취소이면 LOOSE에서도 같은 결과다', () => {
    fc.assert(
      fc.property(message, maxNumber, (text, max) => {
        const strict = parseChat(text, { 'claim.maxNumber': max })
        if (strict.claims.length > 0 || strict.cancels.length > 0) {
          expect(parseChat(text, { 'claim.maxNumber': max, 'claim.parseMode': 'LOOSE' })).toEqual(strict)
        }
      }),
      { numRuns: 5000 },
    )
  })
})
