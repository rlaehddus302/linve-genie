// S01 적대 테스트 (test-domain): 꼬리 그림 이모지 허용 목록 (R-3 세부 "꼬리 기호"·"꼬리 그림 이모지 허용 목록"·"취소", D-033, AC-S01-11·15·17).
// 골든은 목록 안·밖 이모지 몇 개만 본다. 여기서는 실행 환경의 Extended_Pictographic 글자 전부를 하나씩 꼬리에 붙여
// "목록 83자(+ 기호 목록의 ♥)만 주문 꼬리, 취소 꼬리는 여기에 😢😭🥲"가 정확히 지켜지는지 본다.
// 범위 경계 실수(💔 U+1F494는 💓와 💕 사이, 😅 U+1F605는 😄와 😆 사이, 😇😈😌😏 등)와 "첫·마지막 이모지만 보기", ZWJ 조합 안의 목록 밖 글자를 노린다.
// 이모지는 소스에 그대로 쓰지 않고 코드 포인트로 만든다(규칙 문장의 코드 포인트와 1:1로 대조하기 위해).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, type ChatParseResult, type SettingsOverride } from '@livejjim/core'

const ch = (codePoint: number): string => String.fromCodePoint(codePoint)
const hex = (codePoint: number): string => `U+${codePoint.toString(16).toUpperCase()}`
const LOOSE: SettingsOverride = { 'claim.parseMode': 'LOOSE' }
const EMPTY = { claims: [], cancels: [], mentions: [] }
const claims15 = { ...EMPTY, claims: [15] }
const cancels15 = { ...EMPTY, cancels: [15] }
const mentions15 = { ...EMPTY, mentions: [15] }

/** R-3 세부 "꼬리 그림 이모지 허용 목록" 83자 — DOMAIN_RULES에 적힌 코드 포인트 그대로 */
const ALLOWLIST: readonly number[] = [
  // 하트(22): 💕 U+1F495 ~ 💟 U+1F49F 11자, 💔 U+1F494는 아님
  0x2764, 0x2763, 0x1f48c, 0x1f493, 0x1f495, 0x1f496, 0x1f497, 0x1f498, 0x1f499, 0x1f49a, 0x1f49b, 0x1f49c, 0x1f49d, 0x1f49e, 0x1f49f, 0x1f5a4, 0x1f90d,
  0x1f90e, 0x1f9e1, 0x1fa75, 0x1fa76, 0x1fa77,
  // 웃는·좋아하는 얼굴(23)
  0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f606, 0x1f609, 0x1f60a, 0x1f60b, 0x1f60d, 0x1f60e, 0x1f617, 0x1f618, 0x1f619, 0x1f61a, 0x1f63b, 0x263a,
  0x1f642, 0x1f917, 0x1f923, 0x1f929, 0x1f970, 0x1f973,
  // 손(11)
  0x1f44c, 0x1f44d, 0x1f44f, 0x1f64b, 0x1f64c, 0x1f64f, 0x270b, 0x270c, 0x261d, 0x1f91e, 0x1faf6,
  // 반짝·축하(9)
  0x2728, 0x2b50, 0x1f31f, 0x1f4ab, 0x1f525, 0x1f4af, 0x1f389, 0x1f38a, 0x1f381,
  // 꽃·식물(13)
  0x1f331, 0x1f335, 0x1f337, 0x1f338, 0x1f339, 0x1f33a, 0x1f33b, 0x1f33c, 0x1f33f, 0x1f340, 0x1f490, 0x2618, 0x1fab4,
  // 느낌표(3), 성별 기호(2)
  0x2757, 0x2755, 0x203c, 0x2640, 0x2642,
]
/** 기호 목록(`! ~ . ^ * ♡ ♥ ☆ ★ ㅎ ㅋ`) 중 그림 이모지이기도 한 글자: ♥ U+2665 (R-3 세부) */
const SYMBOL_PICTOGRAPHS: readonly number[] = [0x2665]
/** 취소 꼬리에만 더하는 그림 이모지: 😢 U+1F622 · 😭 U+1F62D · 🥲 U+1F972 (R-3 세부 "취소") */
const CANCEL_ONLY: readonly number[] = [0x1f622, 0x1f62d, 0x1f972]

const CLAIM_TAIL = new Set([...ALLOWLIST, ...SYMBOL_PICTOGRAPHS])
const CANCEL_TAIL = new Set([...CLAIM_TAIL, ...CANCEL_ONLY])

const ZWJ = ch(0x200d)
const VS16 = ch(0xfe0f)
const SKIN = ch(0x1f3fd)
/** 목록 안의 사람 이모지 🙋 U+1F64B — ZWJ 조합의 앞 글자로 쓴다 */
const RAISING_HAND = ch(0x1f64b)
/** 목록 안의 하트 ❤ U+2764 */
const HEART = ch(0x2764)

/** 실행 환경 정규식이 아는 Extended_Pictographic 글자 전부 (서로게이트 반쪽 제외) */
const PICTOGRAPHS: readonly number[] = (() => {
  const pattern = /^\p{Extended_Pictographic}$/u
  const found: number[] = []
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue
    if (pattern.test(ch(codePoint))) found.push(codePoint)
  }
  return found
})()

/**
 * 모든 그림 이모지 글자 c에 대해 make(c)를 파싱한 결과가 expected(c)와 같은지 보고, 다른 것들을 모아 한 번에 보여 준다.
 * 글자 하나하나를 테스트로 나누면 수천 개가 되어 보기 어렵다.
 */
function mismatches(make: (char: string) => string, expected: (codePoint: number) => ChatParseResult, settings: SettingsOverride = {}): string[] {
  const wrong: string[] = []
  for (const codePoint of PICTOGRAPHS) {
    const text = make(ch(codePoint))
    const actual = parseChat(text, settings)
    const want = expected(codePoint)
    if (JSON.stringify(actual) !== JSON.stringify(want)) wrong.push(`${hex(codePoint)} ${JSON.stringify(text)} → ${JSON.stringify(actual)} (기대 ${JSON.stringify(want)})`)
  }
  return wrong
}

const claimOrMention = (codePoint: number): ChatParseResult => (CLAIM_TAIL.has(codePoint) ? claims15 : mentions15)
const cancelOrMention = (codePoint: number): ChatParseResult => (CANCEL_TAIL.has(codePoint) ? cancels15 : mentions15)

describe('TD-S01-013: 꼬리 그림 이모지는 허용 목록 83자(+♥)만 받는다 — Extended_Pictographic 전체 대조 (D-033, AC-S01-11·15·17)', () => {
  it('준비: 허용 목록은 83자이고 모두 실행 환경의 Extended_Pictographic 글자다', () => {
    expect(ALLOWLIST).toHaveLength(83)
    expect(new Set(ALLOWLIST).size).toBe(83)
    const pictographs = new Set(PICTOGRAPHS)
    expect(ALLOWLIST.filter((codePoint) => !pictographs.has(codePoint)).map(hex)).toEqual([])
    expect(PICTOGRAPHS.length).toBeGreaterThan(1000)
  })

  it('STRICT "15"+c: 목록 안이면 주문 [15], 목록 밖이면 언급 [15]', () => {
    expect(mismatches((c) => `15${c}`, claimOrMention).slice(0, 30)).toEqual([])
  })

  it('STRICT "15번 "+c+U+FE0F: 수식 문자가 붙어도 판정은 글자 c가 정한다', () => {
    expect(mismatches((c) => `15번 ${c}${VS16}`, claimOrMention).slice(0, 30)).toEqual([])
  })

  it('STRICT "15 "+c+피부색: 피부색 수식 문자는 목록 밖 글자를 살리지 않는다', () => {
    expect(mismatches((c) => `15 ${c}${SKIN}`, claimOrMention).slice(0, 30)).toEqual([])
  })

  it('STRICT 이모지 두 개: 목록 안 ❤ 뒤에 c, c 뒤에 목록 안 ❤ — 꼬리의 그림 이모지는 하나하나 모두 목록에 있어야 한다', () => {
    expect(mismatches((c) => `15 ${HEART}${c}`, claimOrMention).slice(0, 30)).toEqual([])
    expect(mismatches((c) => `15 ${c} ${HEART}`, claimOrMention).slice(0, 30)).toEqual([])
  })

  it('STRICT ZWJ 조합: 🙋+ZWJ+c+FE0F — 조합 안 글자 하나라도 목록 밖이면 주문 아님 (🙋‍♀️ 받음, 🙅‍♀️·❤️‍🩹 안 받음과 같은 규칙)', () => {
    expect(mismatches((c) => `15 ${RAISING_HAND}${ZWJ}${c}${VS16}`, claimOrMention).slice(0, 30)).toEqual([])
    expect(mismatches((c) => `15 ${c}${ZWJ}${RAISING_HAND}`, claimOrMention).slice(0, 30)).toEqual([])
  })

  it('취소 "15번 취소 "+c: 주문 목록 + 😢😭🥲만 취소 꼬리, 그 밖은 언급 [15]', () => {
    expect(mismatches((c) => `15번 취소 ${c}`, cancelOrMention).slice(0, 30)).toEqual([])
    expect(mismatches((c) => `15 취소요${c}${VS16}`, cancelOrMention, LOOSE).slice(0, 30)).toEqual([])
  })

  it('주문 꼬리에는 😢😭🥲가 없다: "15 😭" 류는 STRICT·LOOSE 모두 주문이 아니다', () => {
    for (const codePoint of CANCEL_ONLY) {
      expect(parseChat(`15번 ${ch(codePoint)}`), hex(codePoint)).toEqual(mentions15)
      expect(parseChat(`15${ch(codePoint)}`, LOOSE), hex(codePoint)).toEqual(mentions15)
    }
  })

  it('LOOSE "15"+c+"예뻐요": 목록 안 꼬리 기호로 끝난 부분만 주문, 목록 밖이면 부분이 끝나지 않아 언급 [15]', () => {
    expect(mismatches((c) => `15${c}예뻐요`, claimOrMention, LOOSE).slice(0, 30)).toEqual([])
  })

  it('LOOSE "15 취소"+c+"죄송해요": 취소 꼬리로 끝나면 취소, 아니면 취소가 들어간 메시지라 언급 [15]', () => {
    expect(mismatches((c) => `15 취소${c}죄송해요`, cancelOrMention, LOOSE).slice(0, 30)).toEqual([])
  })
})

describe('TD-S01-013: STRICT에서 끝에 ?·❓·❔·⁉가 있으면 어떤 경우에도 주문·취소가 아니다 (AC-S01-11, D-033)', () => {
  /** 물음표 이모지 ❓ U+2753 · ❔ U+2754 · ⁉ U+2049 와 ? */
  const QUESTION_MARKS = ['?', ch(0x2753), ch(0x2754), ch(0x2049)]
  const PARTS = ['찜', '15', '28', '015', '１５', '번', ' 번', ' ', ',', '/', '·', '요', '주세요', '찜할게요', '취소', '취소요', '!', '~', 'ㅋ', 'ㅠ', HEART, VS16, ZWJ, SKIN, ch(0x1f970), ch(0x1f62d)]
  const message = fc
    .record({
      body: fc.array(fc.constantFrom(...PARTS), { minLength: 1, maxLength: 8 }),
      space: fc.boolean(),
      mark: fc.constantFrom(...QUESTION_MARKS),
      after: fc.constantFrom('', VS16, `${VS16}${VS16}`, SKIN),
    })
    .map(({ body, space, mark, after }) => body.join('') + (space ? ' ' : '') + mark + after)

  it('속성: 아무 조합 메시지 + 끝의 물음표(이모지) → claims·cancels 빔', () => {
    fc.assert(
      fc.property(message, fc.constantFrom<SettingsOverride>({}, { 'claim.multiNumber': 'FIRST' }, { 'claim.maxNumber': 9999 }), (text, settings) => {
        const result = parseChat(text, settings)
        expect(result.claims, JSON.stringify(text)).toEqual([])
        expect(result.cancels, JSON.stringify(text)).toEqual([])
      }),
      { numRuns: 4000 },
    )
  })

  it('주문·취소 문법 그대로 끝에 물음표 이모지 → 언급 [15]', () => {
    for (const mark of QUESTION_MARKS) {
      for (const text of [`15${mark}`, `15번 ${mark}`, `찜 15 주세요${mark}`, `15 ${HEART}${mark}`, `15 취소${mark}`, `15번 취소요 ㅠㅠ${mark}${VS16}`]) {
        expect(parseChat(text), JSON.stringify(text)).toEqual(mentions15)
      }
    }
  })
})

describe('회귀: 그림 이모지가 아닌 수식·조합 글자 (R-3 세부 "꼬리 기호"는 U+FE0F·U+200D·피부색만 수식 문자로 받는다)', () => {
  const NOT_TAIL: readonly [string, number][] = [
    ['VS15(텍스트 표시 선택자) U+FE0E', 0xfe0e],
    ['키캡 U+20E3', 0x20e3],
    ['지역 표시 문자(국기 반쪽) U+1F1F0', 0x1f1f0],
    ['태그 문자 U+E0067', 0xe0067],
  ]
  for (const [label, codePoint] of NOT_TAIL) {
    it(`${label}가 붙으면 주문이 아니다`, () => {
      expect(parseChat(`15 ${HEART}${ch(codePoint)}`)).toEqual(mentions15)
      expect(parseChat(`15번${ch(codePoint)}`)).toEqual(mentions15)
    })
  }

  it('기호 목록의 ♡ ☆ ★는 그림 이모지가 아니어도 꼬리 기호다', () => {
    expect(parseChat('15 ♡☆★')).toEqual(claims15)
  })
})
