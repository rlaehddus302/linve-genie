// S01 적대 테스트 (test-domain): LOOSE 끝 신호 (R-3 LOOSE 세부 "끝 신호", D-035, AC-S01-17) — TD-S01-005·TD-S01-016.
// 골든은 대표 사례 33개만 본다. 여기서는 규칙 문장의 각 항목을 글자 집합 전체로 넓힌다.
// - 건너뛰는 글자: 공백, 피부색 수식 문자, Unicode Default_Ignorable_Code_Point 전부(예시로 적힌 몇 글자만이 아니다)
// - 신호 글자: 질문 기호 5자, 한글 호환 자모 U+3131~U+318E 전부(ㅎ·ㅋ와 U+3164 채움 문자 제외), 꼬리 기호가 아닌 Extended_Pictographic 전부,
//   `번`, 공백 없이 붙은 숫자. 취소 부분은 취소 꼬리(ㅠ ㅜ 😢 😭 🥲) 기준
// - 두 자리: (가) 고른 부분 바로 뒤, (나) 끝 경계와 상관없는 가장 긴 맨 앞 부분 바로 뒤. 더 짧은 앞부분으로 물러나지 않고 multiNumber 전에 본다
// - 신호가 아니면 그대로 주문(첫 글자만 본다): 건너뛰는 글자 뒤의 한글 음절, 허용 목록 이모지 등
// 규칙 문장대로 만든 참조 구현(커밋하지 않음)으로 골든 366/366과 이 파일 전부가 통과함을 확인했다.
import { performance } from 'node:perf_hooks'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, type ChatParseResult, type SettingsOverride } from '@livejjim/core'

const ch = (codePoint: number): string => String.fromCodePoint(codePoint)
const hex = (codePoint: number): string => `U+${codePoint.toString(16).toUpperCase()}`
const LOOSE: SettingsOverride = { 'claim.parseMode': 'LOOSE' }
const EMPTY = { claims: [], cancels: [], mentions: [] }
const claims = (...values: number[]): ChatParseResult => ({ ...EMPTY, claims: values })
const cancels = (...values: number[]): ChatParseResult => ({ ...EMPTY, cancels: values })
const mentions = (...values: number[]): ChatParseResult => ({ ...EMPTY, mentions: values })
const unique = (values: readonly number[]): number[] => [...new Set(values)]

/** R-3 세부 "꼬리 그림 이모지 허용 목록" 83자 — DOMAIN_RULES에 적힌 코드 포인트 그대로 */
const ALLOWLIST: readonly number[] = [
  0x2764, 0x2763, 0x1f48c, 0x1f493, 0x1f495, 0x1f496, 0x1f497, 0x1f498, 0x1f499, 0x1f49a, 0x1f49b, 0x1f49c, 0x1f49d, 0x1f49e, 0x1f49f, 0x1f5a4, 0x1f90d,
  0x1f90e, 0x1f9e1, 0x1fa75, 0x1fa76, 0x1fa77, 0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f606, 0x1f609, 0x1f60a, 0x1f60b, 0x1f60d, 0x1f60e, 0x1f617,
  0x1f618, 0x1f619, 0x1f61a, 0x1f63b, 0x263a, 0x1f642, 0x1f917, 0x1f923, 0x1f929, 0x1f970, 0x1f973, 0x1f44c, 0x1f44d, 0x1f44f, 0x1f64b, 0x1f64c, 0x1f64f,
  0x270b, 0x270c, 0x261d, 0x1f91e, 0x1faf6, 0x2728, 0x2b50, 0x1f31f, 0x1f4ab, 0x1f525, 0x1f4af, 0x1f389, 0x1f38a, 0x1f381, 0x1f331, 0x1f335, 0x1f337,
  0x1f338, 0x1f339, 0x1f33a, 0x1f33b, 0x1f33c, 0x1f33f, 0x1f340, 0x1f490, 0x2618, 0x1fab4, 0x2757, 0x2755, 0x203c, 0x2640, 0x2642,
]
/** 주문 꼬리의 그림 이모지: 허용 목록 + 기호 목록의 ♥ U+2665 */
const CLAIM_TAIL_PICTO = new Set([...ALLOWLIST, 0x2665])
/** 취소 꼬리의 그림 이모지: 주문 꼬리 + 😢 U+1F622 · 😭 U+1F62D · 🥲 U+1F972 */
const CANCEL_TAIL_PICTO = new Set([...CLAIM_TAIL_PICTO, 0x1f622, 0x1f62d, 0x1f972])

const KIEUK = 0x314b // ㅋ
const HIEUH = 0x314e // ㅎ
const YU = 0x3160 // ㅠ
const U = 0x315c // ㅜ
/** 한글 채움 문자 U+3164: 한글 호환 자모 블록 안이지만 Default_Ignorable이라 건너뛴다(R-3 끝 신호가 예로 든 글자) */
const HANGUL_FILLER = 0x3164

/** 실행 환경 정규식이 아는 글자 전부 (서로게이트 반쪽 제외) */
function codePointsMatching(pattern: RegExp): number[] {
  const found: number[] = []
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue
    if (pattern.test(ch(codePoint))) found.push(codePoint)
  }
  return found
}
const PICTOGRAPHS = codePointsMatching(/^\p{Extended_Pictographic}$/u)
const IGNORABLES = codePointsMatching(/^\p{Default_Ignorable_Code_Point}$/u)
/** 한글 호환 자모 U+3131~U+318E (R-3 끝 신호 2) */
const JAMO: readonly number[] = Array.from({ length: 0x318e - 0x3131 + 1 }, (_, k) => 0x3131 + k)
/** 질문 기호: ? U+003F · ？ U+FF1F · ❓ U+2753 · ❔ U+2754 · ⁉ U+2049 (R-3 끝 신호 1) */
const QUESTION_MARKS: readonly string[] = [0x3f, 0xff1f, 0x2753, 0x2754, 0x2049].map(ch)
const SKIN_TONES: readonly string[] = [0x1f3fb, 0x1f3fc, 0x1f3fd, 0x1f3fe, 0x1f3ff].map(ch)

const VS16 = ch(0xfe0f)
const ZWJ = ch(0x200d)
const HEART = `${ch(0x2764)}${VS16}`
const CRY = ch(0x1f62d) // 😭
const CROSS = ch(0x274c) // ❌
const BANDAGE = ch(0x1fa79) // 🩹 (목록 밖)

/** 글자 집합의 각 글자 c로 make(c)를 파싱한 결과가 expected(c)와 다른 것을 모은다(처음 30개) */
function mismatches(codePoints: readonly number[], make: (char: string) => string, expected: (codePoint: number) => ChatParseResult, settings: SettingsOverride = LOOSE): string[] {
  const wrong: string[] = []
  for (const codePoint of codePoints) {
    const text = make(ch(codePoint))
    const actual = parseChat(text, settings)
    const want = expected(codePoint)
    if (JSON.stringify(actual) !== JSON.stringify(want)) wrong.push(`${hex(codePoint)} ${JSON.stringify(text)} → ${JSON.stringify(actual)} (기대 ${JSON.stringify(want)})`)
    if (wrong.length >= 30) break
  }
  return wrong
}

describe('TD-S01-005: LOOSE 끝 신호 — 신호 글자 전수 (R-3 LOOSE 세부 "끝 신호" 1~3, D-035, AC-S01-17)', () => {
  it('준비: 글자 집합이 실행 환경과 맞다', () => {
    expect(ALLOWLIST).toHaveLength(83)
    expect(PICTOGRAPHS.length).toBeGreaterThan(1000)
    expect(IGNORABLES.length).toBeGreaterThan(1000)
    expect(IGNORABLES).toContain(HANGUL_FILLER)
    expect(JAMO).toHaveLength(94)
  })

  it('질문 기호 5자: 주문 부분 뒤에 공백·보이지 않는 글자·피부색을 사이에 두어도 언급 [15]', () => {
    const PREFIXES = ['15 ', '15번 ', '15!', '15 ❤️ ', '찜 15 ', '15 주세요 ', '15 ㅋㅋ ', '15 ', '015 ']
    const BETWEEN = ['', ch(0x200b), VS16, ZWJ, ch(0x2060), ch(0xfeff), ch(0x200e), ch(HANGUL_FILLER), ch(0xad), SKIN_TONES[2] as string, ` ${ch(0x200b)}`]
    const wrong: string[] = []
    for (const mark of QUESTION_MARKS) {
      for (const prefix of PREFIXES) {
        for (const between of BETWEEN) {
          const text = `${prefix}${between}${mark} 남았나요`
          const actual = parseChat(text, LOOSE)
          if (JSON.stringify(actual) !== JSON.stringify(mentions(15))) wrong.push(`${JSON.stringify(text)} → ${JSON.stringify(actual)}`)
        }
      }
    }
    expect(wrong.slice(0, 30)).toEqual([])
  })

  it('그림 이모지 전수 "15 "+c+" 예뻐요": 주문 꼬리(허용 목록·♥)면 주문 [15], 아니면 언급 [15] (3)', () => {
    expect(mismatches(PICTOGRAPHS, (c) => `15 ${c} 예뻐요`, (cp) => (CLAIM_TAIL_PICTO.has(cp) ? claims(15) : mentions(15)))).toEqual([])
  })

  it('그림 이모지 전수 "15 ❤️"+c+" 예뻐요": 목록 밖이면 더 짧은 부분 "15 ❤️"로 물러나지 않는다', () => {
    expect(mismatches(PICTOGRAPHS, (c) => `15 ${HEART}${c} 예뻐요`, (cp) => (CLAIM_TAIL_PICTO.has(cp) ? claims(15) : mentions(15)))).toEqual([])
  })

  it('그림 이모지 전수 "15번 "+피부색+c: 피부색은 건너뛴다', () => {
    expect(mismatches(PICTOGRAPHS, (c) => `15번 ${SKIN_TONES[0]}${c}`, (cp) => (CLAIM_TAIL_PICTO.has(cp) ? claims(15) : mentions(15)))).toEqual([])
  })

  it('그림 이모지 전수, 취소 "15번 취소 "+c+" 죄송해요": 취소 꼬리(+😢😭🥲)면 취소 [15], 아니면 언급 [15]', () => {
    expect(mismatches(PICTOGRAPHS, (c) => `15번 취소 ${c} 죄송해요`, (cp) => (CANCEL_TAIL_PICTO.has(cp) ? cancels(15) : mentions(15)))).toEqual([])
  })

  it('한글 호환 자모 전수 "15 "+j+"예뻐요": ㅎ·ㅋ는 꼬리 기호, U+3164는 건너뜀 → 주문 [15]. 나머지 자모는 언급 [15] (2)', () => {
    const passes = new Set([KIEUK, HIEUH, HANGUL_FILLER])
    expect(mismatches(JAMO, (j) => `15 ${j}예뻐요`, (cp) => (passes.has(cp) ? claims(15) : mentions(15)))).toEqual([])
    expect(mismatches(JAMO, (j) => `15!${j}${j}`, (cp) => (passes.has(cp) ? claims(15) : mentions(15)))).toEqual([])
  })

  it('한글 호환 자모 전수, 취소 "15 취소 "+j+" 죄송해요": ㅎ·ㅋ·ㅠ·ㅜ는 취소 꼬리, U+3164는 건너뜀 → 취소 [15]. 나머지는 언급 [15]', () => {
    const passes = new Set([KIEUK, HIEUH, YU, U, HANGUL_FILLER])
    expect(mismatches(JAMO, (j) => `15 취소 ${j} 죄송해요`, (cp) => (passes.has(cp) ? cancels(15) : mentions(15)))).toEqual([])
  })

  it('보이지 않는 글자(Default_Ignorable_Code_Point) 전수: 건너뛰고 그 뒤 첫 글자를 본다 — 예시로 적힌 몇 글자만이 아니다', () => {
    expect(mismatches(IGNORABLES, (d) => `15 ${d}${CRY}`, () => mentions(15))).toEqual([])
    expect(mismatches(IGNORABLES, (d) => `15!${d}?`, () => mentions(15))).toEqual([])
    expect(mismatches(IGNORABLES, (d) => `15번 ${d}${d}ㅠㅠ`, () => mentions(15))).toEqual([])
    expect(mismatches(IGNORABLES, (d) => `15 취소 ${d}ㄴㄴ`, () => mentions(15))).toEqual([])
  })

  it('보이지 않는 글자 전수(넘치지 않기): 건너뛴 뒤 첫 글자가 한글 음절이면 그대로 주문·취소다', () => {
    expect(mismatches(IGNORABLES, (d) => `15 ${d}예뻐요`, () => claims(15))).toEqual([])
    expect(mismatches(IGNORABLES, (d) => `15 취소 ${d}죄송해요`, () => cancels(15))).toEqual([])
  })

  it('피부색 수식 문자 5개를 건너뛴다: "15 "+피부색+❌ → 언급 [15], "15 "+피부색+" 예뻐요" → 주문 [15]', () => {
    for (const skin of SKIN_TONES) {
      expect(parseChat(`15 ${skin}${CROSS}`, LOOSE), JSON.stringify(skin)).toEqual(mentions(15))
      expect(parseChat(`15 ${skin}${skin} ${CRY} 놓쳤어요`, LOOSE), JSON.stringify(skin)).toEqual(mentions(15))
      expect(parseChat(`15 ${skin} 예뻐요`, LOOSE), JSON.stringify(skin)).toEqual(claims(15))
    }
  })
})

describe('TD-S01-005: `번`·붙은 숫자 (R-3 끝 신호 4·5, D-035)', () => {
  const CASES: ReadonlyArray<readonly [string, ChatParseResult]> = [
    // 4. 번 — 번호 부분에 들어가지 못하고 남은 번
    ['15 번호 맞나요', mentions(15)],
    ['15! 번째 사진', mentions(15)],
    ['15 ❤️ 번째요', mentions(15)],
    ['15!번', mentions(15)],
    ['15 28 번째요', mentions(15, 28)], // 부분 '15 28 번'은 뒤가 '째'라 끝 경계가 아니다 → 고른 부분 '15 28' 뒤 첫 글자 '번'
    ['15번 취소요 번복', mentions(15)],
    ['15 취소!! 번복할게요', mentions(15)],
    ['15 취소 ㅜㅜ 번복할게요', mentions(15)], // 취소 꼬리 'ㅜㅜ'까지가 부분 → 공백 뒤 첫 글자 '번'
    // 5. 공백 없이 붙은 숫자
    ['15!3 예뻐요', mentions(15, 3)],
    ['15 ❤️28', mentions(15, 28)],
    ['15 👍2개요', mentions(15, 2)],
    [`15~${ch(0x200b)}28`, mentions(15, 28)], // U+200B는 공백이 아니라 건너뛰는 글자다 → 붙은 숫자
    ['15 취소!2', mentions(15, 2)],
    // 신호가 아님 — 공백 뒤 숫자, 숫자와 공백 하나 뒤의 번이 부분에 들어감
    ['15 ❤️ 28', claims(15)],
    ['15! 28개', claims(15)],
    ['15 번 예뻐요', claims(15)],
  ]
  for (const [text, want] of CASES) {
    it(`${JSON.stringify(text)} → ${JSON.stringify(want)}`, () => {
      expect(parseChat(text, LOOSE)).toEqual(want)
    })
  }
})

// ── 생성기 ───────────────────────────────────────────────────────────────

const toFullWidth = (digits: string): string => [...digits].map((d) => ch(0xff10 + Number(d))).join('')
const CLAIM_WORDS = ['이요', '요', '여', '찜', '찜이요', '찜할게요', '주세요', '할게요', '구매', '구매요', '구매합니다']
/** 꼬리 기호: 기호 목록과 허용 목록 안 그림 이모지(수식 문자 포함) */
const TAIL_UNITS = ['!', '~', '.', '^', '*', '♡', '♥', '☆', '★', 'ㅎ', 'ㅋ', HEART, '👍🏻', '😍', '🙏', '🔥', '🙋‍♀️', '❤️‍🔥', '🥰']
const SPACES = [' ', ' ', '\t', '\n', ch(0xa0), ch(0x3000)]

/** 끝 신호 1~3 (AC-S01-17 속성): 질문 기호, ㅎ·ㅋ가 아닌 자모(U+3164 제외), 목록 밖 그림 이모지 */
const SIGNAL_JAMO = JAMO.filter((cp) => cp !== KIEUK && cp !== HIEUH && cp !== HANGUL_FILLER)
const SIGNAL_PICTO = PICTOGRAPHS.filter((cp) => !CLAIM_TAIL_PICTO.has(cp))
const signal = fc.oneof(fc.constantFrom(...QUESTION_MARKS), fc.constantFrom(...SIGNAL_JAMO).map(ch), fc.constantFrom(...SIGNAL_PICTO).map(ch))

const syllable = fc.integer({ min: 0xac00, max: 0xd7a3 }).map(ch)
const koreanWords = fc.array(fc.oneof(syllable, syllable, fc.constant(' ')), { maxLength: 10 }).map((units) => units.join(''))

/** 번호 하나: 값, 선행 0, 전각, 번 */
const numberToken = fc
  .record({
    value: fc.integer({ min: 1, max: 999 }),
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

/** 주문 문법 `[찜] 번호목록 [꼬리말] [꼬리 기호]` — 번호 1~7개, 공백 잡음 */
const orderMessage = fc
  .record({
    prefix: fc.constantFrom('', '찜', '찜 '),
    tokens: fc.array(numberToken, { minLength: 1, maxLength: 7 }),
    separators: fc.array(separator, { minLength: 6, maxLength: 6 }),
    word: fc.option(fc.tuple(fc.boolean(), fc.constantFrom(...CLAIM_WORDS)), { nil: undefined }),
    tail: fc.array(fc.tuple(fc.boolean(), fc.constantFrom(...TAIL_UNITS)), { maxLength: 2 }),
    spaces: fc.array(fc.nat(), { maxLength: 20 }),
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
  // 천 단위 쉼표 묶음(예: 1,005)은 금액 덩어리라 주문이 아니다(AC-S01-13). 그런 메시지는 넘긴다.
  .filter(({ plain }) => !/\d,\d{3}(?!\d)/.test(plain))

const MULTI = ['ALL', 'FIRST', 'IGNORE'] as const

describe('TD-S01-005: AC-S01-17 끝 신호 속성 (D-035)', () => {
  it('속성 1: 주문 문법 메시지 + 공백 0~1칸 + 끝 신호 1~3번 글자 하나 + 한글 음절·공백 말 → claims·cancels 빔, 언급 = 서로 다른 번호 전부', () => {
    fc.assert(
      fc.property(orderMessage, fc.boolean(), signal, koreanWords, fc.constantFrom(...MULTI), ({ text, values }, space, mark, words, multi) => {
        const message = `${text}${space ? ' ' : ''}${mark}${words}`
        const settings: SettingsOverride = { ...LOOSE, 'claim.multiNumber': multi }
        expect(parseChat(message, settings), `${JSON.stringify(message)} ${multi}`).toEqual(mentions(...unique(values)))
      }),
      { numRuns: 3000 },
    )
  })

  it('속성 2: 주문 문법 메시지 + 공백 하나 + `번`이 아닌 한글 음절로 시작하는 한글 음절·공백 말(`취소` 없음) → 원래 메시지의 STRICT 결과와 같다', () => {
    const tailWords = fc
      .tuple(syllable, koreanWords)
      .map(([first, rest]) => first + rest)
      .filter((words) => !words.startsWith('번') && !words.includes('취소'))
    fc.assert(
      fc.property(orderMessage, tailWords, fc.constantFrom(...MULTI), ({ text }, words, multi) => {
        const strict = parseChat(text, { 'claim.parseMode': 'STRICT', 'claim.multiNumber': multi })
        const loose = parseChat(`${text} ${words}`, { ...LOOSE, 'claim.multiNumber': multi })
        expect(loose, `${JSON.stringify(text)} + ${JSON.stringify(words)} ${multi}`).toEqual(strict)
      }),
      { numRuns: 3000 },
    )
  })

  it('속성 3 (나): 고른 부분이 더 짧아도 가장 긴 부분 뒤를 본다 — 번호 2~5개를 공백으로 잇고 [공백+꼬리말] 뒤에 신호를 붙이면 언급(서로 다른 번호 전부)', () => {
    const lastPart = fc.option(fc.constantFrom(...CLAIM_WORDS), { nil: undefined })
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 5 }), lastPart, signal, koreanWords, fc.constantFrom(...MULTI), (values, word, mark, words, multi) => {
        const message = `${values.join(' ')}${word === undefined ? '' : ` ${word}`}${mark}${words}`
        expect(parseChat(message, { ...LOOSE, 'claim.multiNumber': multi }), `${JSON.stringify(message)} ${multi}`).toEqual(mentions(...unique(values)))
      }),
      { numRuns: 2000 },
    )
  })

  it('끝 신호는 multiNumber 전에 본다: FIRST·IGNORE에서도 언급 전부', () => {
    for (const multi of ['FIRST', 'IGNORE'] as const) {
      const settings: SettingsOverride = { ...LOOSE, 'claim.multiNumber': multi }
      for (const text of ['15 28 😭 놓쳤어요', '15 28ㅠ', '15,28 ❌', '15 28 주세요❓', '15/28 ？']) {
        expect(parseChat(text, settings), `${JSON.stringify(text)} ${multi}`).toEqual(mentions(15, 28))
      }
    }
  })

  it('회귀 속성: STRICT에서 주문·취소인 메시지는 LOOSE에서도 같은 결과다 (끝 신호는 STRICT에 영향 없음)', () => {
    const PARTS = ['찜', '15', '28', '015', '１５', '번', ' 번', ' ', ',', '/', '요', '주세요', '취소', '취소요', '!', '~', 'ㅋ', 'ㅠ', HEART, VS16, ZWJ, SKIN_TONES[1] as string, CRY, CROSS, '?', ch(0x200b)]
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...PARTS), { minLength: 1, maxLength: 8 }), fc.constantFrom(...MULTI), (units, multi) => {
        const text = units.join('')
        const strict = parseChat(text, { 'claim.multiNumber': multi })
        if (strict.claims.length > 0 || strict.cancels.length > 0) {
          expect(parseChat(text, { ...LOOSE, 'claim.multiNumber': multi }), JSON.stringify(text)).toEqual(strict)
        }
      }),
      { numRuns: 5000 },
    )
  })
})

describe('TD-S01-016: LOOSE가 ZWJ 조합 이모지를 가르지 않는다 — ZWJ 뒤 목록 밖 글자는 끝 신호 (R-3 허용 목록 "❤️‍🩹" 예, 끝 신호 3, D-035)', () => {
  it('"15❤️‍🩹"·"15❤️‍🩹 예뻐요"·"15 ❤️‍🩹" → 언급 [15] (STRICT "15 ❤️‍🩹"와 같다)', () => {
    for (const text of [`15${HEART}${ZWJ}${BANDAGE}`, `15${HEART}${ZWJ}${BANDAGE} 예뻐요`, `15 ${HEART}${ZWJ}${BANDAGE}`, `15번 ${HEART}${ZWJ}${BANDAGE}${VS16} 너무 예뻐요`]) {
      expect(parseChat(text, LOOSE), JSON.stringify(text)).toEqual(mentions(15))
    }
  })

  it('그림 이모지 전수 "15"+❤️+ZWJ+c+" 예뻐요"·"15 🙋"+ZWJ+c: 조합 안 c가 주문 꼬리면 주문 [15], 아니면 언급 [15]', () => {
    const want = (cp: number): ChatParseResult => (CLAIM_TAIL_PICTO.has(cp) ? claims(15) : mentions(15))
    expect(mismatches(PICTOGRAPHS, (c) => `15${HEART}${ZWJ}${c} 예뻐요`, want)).toEqual([])
    expect(mismatches(PICTOGRAPHS, (c) => `15 ${ch(0x1f64b)}${ZWJ}${c}${VS16}`, want)).toEqual([])
  })
})

describe('회귀: 끝 신호가 아닌 첫 글자는 그대로 주문 — 두 자리의 첫 글자만 본다 (D-035)', () => {
  const CASES: ReadonlyArray<readonly [string, ChatParseResult]> = [
    [`15 ${ch(HANGUL_FILLER)}예뻐요`, claims(15)], // U+3164는 자모 블록 안이지만 보이지 않는 글자라 건너뛴다 → '예'
    [`15 ${ch(0x200b)}${HEART} 예뻐요`, claims(15)], // 건너뛴 뒤 첫 글자 ❤는 꼬리 기호
    [`15 ${ch(0x200b)}ㅋㅋ 예뻐요`, claims(15)],
    ['15 ^^ 예뻐요', claims(15)],
    ['15번 ★ 저요', claims(15)],
    ['15 28 너무 예뻐요 ❓', claims(15, 28)],
    ['15번 2개 가능해요?', claims(15)], // 가장 긴 부분 '15번 2' 뒤 '개'
    ['15번 취소 😢 죄송해요', cancels(15)],
    ['15 취소 ㅜㅜ 죄송해요', cancels(15)],
  ]
  for (const [text, want] of CASES) {
    it(`${JSON.stringify(text)} → ${JSON.stringify(want)}`, () => {
      expect(parseChat(text, LOOSE)).toEqual(want)
    })
  }
})

describe('시간 (AC-S01-03): 끝 신호 검사가 붙어도 적대 입력에서 폭주하지 않는다', () => {
  const LIMIT_MS = 1000
  const INPUTS: Readonly<Record<string, string>> = {
    '"15 " 뒤 U+200B 1만 자 뒤 😭': `15 ${ch(0x200b).repeat(10_000)}${CRY}`,
    '"15" 뒤 "!" 1만 자 뒤 ❓': `15${'!'.repeat(10_000)}❓`,
    '"15 " 뒤 피부색 5천 자 뒤 ❌': `15 ${(SKIN_TONES[0] as string).repeat(5_000)}${CROSS}`,
    '"1 " 5천 번 뒤 ❓': `${'1 '.repeat(5_000)}❓`,
    '"1 " 5천 번 뒤 붙은 ㅠ': `${'1 '.repeat(4_999)}1ㅠ`,
    '"15 취소 " 뒤 VS16 1만 자 뒤 ㄴ': `15 취소 ${VS16.repeat(10_000)}ㄴ`,
    '"15" 뒤 ❤️ 3천 번 뒤 😭': `15${HEART.repeat(3_000)}${CRY}`,
    '"15 " 뒤 " ❤️" 3천 번 뒤 " ❓"': `15${` ${HEART}`.repeat(3_000)} ❓`,
    '"15 ~" 반복 뒤 U+E0001 반복': `15${' ~'.repeat(3_000)}${ch(0xe0001).repeat(3_000)}?`,
  }
  for (const [label, text] of Object.entries(INPUTS)) {
    it(label, () => {
      for (const parseMode of ['STRICT', 'LOOSE'] as const) {
        const started = performance.now()
        parseChat(text, { 'claim.parseMode': parseMode })
        expect(performance.now() - started, parseMode).toBeLessThan(LIMIT_MS)
      }
    })
  }
})
