// R-3 채팅 주문 인식 (AC-S01-10~18). 골든 chat.yaml이 정답 사례이고, 여기서는 규칙 문장과 속성을 넓게 확인한다.
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseChat, type ChatParseResult, type SettingsOverride } from '@livejjim/core'
import { CLAIM_TAIL_EMOJI } from '../../src/parse/chat.ts'

type Expected = Partial<Record<keyof ChatParseResult, number[]>>

const STRICT = { 'claim.parseMode': 'STRICT' } as const
const LOOSE = { 'claim.parseMode': 'LOOSE' } as const

function check(cases: ReadonlyArray<readonly [string, Expected]>, settings: SettingsOverride = {}): void {
  for (const [input, expected] of cases) {
    expect(parseChat(input, settings), `${JSON.stringify(input)} ${JSON.stringify(settings)}`).toEqual({ claims: [], cancels: [], mentions: [], ...expected })
  }
}

/**
 * DOMAIN_RULES R-3 세부 "꼬리 그림 이모지 허용 목록"의 분류 줄(`  - 하트(22): …`)에 적힌 코드 포인트(오름차순).
 * `U+A ~ … U+B`는 범위, `U+X는 아님`은 뺀다. 분류마다 괄호 안 개수와 같은지도 본다. 구현과 따로 규칙 문서에서 읽는다.
 */
function allowlistFromDomainRules(): number[] {
  const text = readFileSync(new URL('../../../../docs/spec/DOMAIN_RULES.md', import.meta.url), 'utf8')
  const start = text.indexOf('**꼬리 그림 이모지 허용 목록**')
  expect(start, '허용 목록 문단').toBeGreaterThan(0)
  const all: number[] = []
  for (const line of text.slice(start).split('\n').slice(1)) {
    const category = /^\s+- [^(:]+\((\d+)[,)][^:]*:(.*)$/.exec(line)
    if (category === null) break
    const [, count, body] = category as unknown as [string, string, string]
    const codes = [...body.matchAll(/U\+([0-9A-F]{4,6})(는 아님)?/g)]
    const found: number[] = []
    const excluded: number[] = []
    codes.forEach((code, k) => {
      const codePoint = Number.parseInt(code[1] as string, 16)
      if (code[2] !== undefined) return void excluded.push(codePoint)
      const previous = codes[k - 1]
      const between = previous === undefined ? '' : body.slice((previous.index) + previous[0].length, code.index)
      const from = found.at(-1)
      if (between.includes('~') && from !== undefined) for (let c = from + 1; c <= codePoint; c++) found.push(c)
      else found.push(codePoint)
    })
    const kept = found.filter((codePoint) => !excluded.includes(codePoint))
    expect(kept, line).toHaveLength(Number(count))
    all.push(...kept)
  }
  expect(all, '분류 합계').toHaveLength(83)
  return all.sort((a, b) => a - b)
}

/** 채팅 같은 조각을 이어 붙인 메시지 (속성 테스트용) */
const PIECES = [
  '15', '28', '3', '0', '1000', '015', '0015', '00015', '９', '１５', '번', ' ', '  ', '\t', '\n', ',', '/', '·', '찜', '요', '이요', '주세요', '할게요', '구매',
  '취소', '취소요', '취소할게요', '!', '?', '~', '.', '^', '*', '♡', '★', 'ㅋ', 'ㅎ', 'ㅠ', 'ㅜ', '❤\uFE0F', '👍🏻', '😍', '\uFE0F', '\u200D', '\u200B', '\u00A0',
  '12,500', '1.5', '만원', '예뻐요', '개', '살게요', '%', '<b>', '1\uFE0F\u20E3', '-', ':',
]
const chatMessage = fc.array(fc.constantFrom(...PIECES), { maxLength: 10 }).map((pieces) => pieces.join(''))
const anyText = fc.oneof(chatMessage, fc.string({ maxLength: 30 }), fc.string({ unit: 'binary', maxLength: 30 }))
const chatSettings = fc.record(
  {
    'claim.parseMode': fc.constantFrom('STRICT' as const, 'LOOSE' as const),
    'claim.multiNumber': fc.constantFrom('ALL' as const, 'FIRST' as const, 'IGNORE' as const),
    'claim.maxNumber': fc.constantFrom(1, 9, 50, 999, 9999),
  },
  { requiredKeys: [] },
)

describe('AC-S01-10 STRICT 주문', () => {
  it('메시지 전체가 [찜] 번호목록 [꼬리말] [꼬리 기호]이면 주문', () => {
    check([
      ['15', { claims: [15] }],
      ['15번', { claims: [15] }],
      ['  15  번 ', { claims: [15] }],
      ['찜15', { claims: [15] }],
      ['찜 15', { claims: [15] }],
      ['15찜', { claims: [15] }],
      ['15 찜', { claims: [15] }],
      ['15번 찜할게요', { claims: [15] }],
      ['15찜이요', { claims: [15] }],
      ['15번여', { claims: [15] }],
      ['15 구매합니다', { claims: [15] }],
      ['15 구매요!', { claims: [15] }],
      ['015', { claims: [15] }],
      ['0015', { claims: [15] }],
      ['１５', { claims: [15] }],
      ['15,28,31', { claims: [15, 28, 31] }],
      ['15,,28', { claims: [15, 28] }],
      ['15 , 28', { claims: [15, 28] }],
      ['28 15', { claims: [28, 15] }],
      ['15 28 15', { claims: [15, 28] }],
      ['15번,28번', { claims: [15, 28] }],
      ['찜 15 28', { claims: [15, 28] }],
      ['15 번 28 번 주세요', { claims: [15, 28] }],
      ['찜 15 찜', { claims: [15] }],
    ])
  })

  it('꼬리말은 R-3 목록에 있는 말만, 하나만', () => {
    check([
      ['15번 살게요', { mentions: [15] }],
      ['15 찜 할게요', { mentions: [15] }],
      ['15요요', { mentions: [15] }],
      ['15번번', { mentions: [15] }],
      ['찜', {}],
      ['찜 찜 15', { mentions: [15] }],
      ['15, 찜', { mentions: [15] }],
      ['15,', { mentions: [15] }],
    ])
  })
})

describe('AC-S01-11 꼬리 기호와 질문', () => {
  it('꼬리 기호: ! ~ . ^ * ♡ ♥ ☆ ★ ㅎ ㅋ, 허용 목록 그림 이모지와 수식 문자', () => {
    check([
      ['15 ❤\uFE0F', { claims: [15] }],
      ['15 👍🏻', { claims: [15] }],
      ['15번^^', { claims: [15] }],
      ['15번 ㅋㅋㅋ', { claims: [15] }],
      ['15!~.^*♡♥☆★ㅎㅋ', { claims: [15] }],
      ['15 ! ~ ♡', { claims: [15] }],
      ['15 ❤\uFE0F\u200D🔥', { claims: [15] }],
      ['15 🙋\u200D♀\uFE0F', { claims: [15] }], // 🙋+ZWJ+♀+FE0F: 모두 목록·수식 문자
      ['15번 ‼', { claims: [15] }],
      ['15\uFE0F', { claims: [15] }],
    ])
  })

  it('D-033: 목록 밖 그림 이모지는 그 밖의 문자 — 꼬리의 그림 이모지는 조합 안 글자까지 하나하나 목록에 있어야 한다', () => {
    // LOOSE는 붙여 쓴 것은 꼬리가 끊겨서, 공백 뒤에 오는 것은 끝 신호(R-3 LOOSE 세부 "끝 신호" 3, D-035)로 막는다. 아래 사례는 STRICT·LOOSE 결과가 같다.
    const attached: ReadonlyArray<readonly [string, Expected]> = [
      ['15\u{2753}', { mentions: [15] }],
      ['15\u{1F62D}', { mentions: [15] }],
      ['15\u{1F440}\u{2764}\uFE0F예뻐요', { mentions: [15] }],
      ['15\u{1F645}\u200D\u{2640}\uFE0F 예뻐요', { mentions: [15] }],
      ['15\u{1F64B}\u200D\u{2640}\uFE0F 예뻐요', { claims: [15] }],
    ]
    check(attached, LOOSE)
    for (const settings of [STRICT, LOOSE]) {
      check(
        [
          ['15\u{2753}', { mentions: [15] }], // ❓ 질문
          ['15 \u{2754}', { mentions: [15] }], // ❔
          ['15\u{2049}', { mentions: [15] }], // ⁉
          ['15번 \u{1F62D}', { mentions: [15] }], // 😭 주문 꼬리에는 없다(취소에만)
          ['15 \u{274C}', { mentions: [15] }], // ❌ 부정
          ['15 \u{1F494}', { mentions: [15] }], // 💔 💓와 💕 사이지만 목록 밖
          ['15 \u{1F605}', { mentions: [15] }], // 😅 😄와 😆 사이지만 목록 밖
          ['15 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}', { mentions: [15] }], // 사람 이모지는 목록 밖
          ['15 \u{1F645}\u200D\u{2640}\uFE0F', { mentions: [15] }], // 🙅‍♀️
          ['15 \u{2764}\uFE0F\u200D\u{1FA79}', { mentions: [15] }], // ❤️‍🩹: 🩹가 목록 밖
          ['15 \u{2764}\uFE0F\u{1F440}', { mentions: [15] }], // ❤️👀: 첫 이모지만 보면 안 된다
          ['15 \u{1F440}\u{2764}\uFE0F', { mentions: [15] }], // 👀❤️: 마지막 이모지만 보면 안 된다
          ['15 \u{1F440}\u{1F3FB}', { mentions: [15] }], // 피부색은 목록 밖 글자를 살리지 않는다
        ],
        settings,
      )
    }
  })

  it('D-033: 허용 목록 83자 각각은 주문 꼬리, 목록·기호 밖의 Extended_Pictographic은 주문 꼬리가 아니다', () => {
    expect(CLAIM_TAIL_EMOJI.size).toBe(83)
    const pictographic = /^\p{Extended_Pictographic}$/u
    const wrong: string[] = []
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue
      const char = String.fromCodePoint(codePoint)
      if (!pictographic.test(char)) continue
      // ♥ U+2665는 기호 목록에 있으면서 그림 이모지이기도 하다
      const want = CLAIM_TAIL_EMOJI.has(codePoint) || codePoint === 0x2665 ? { claims: [15] } : { mentions: [15] }
      const actual = parseChat(`15${char}`)
      if (JSON.stringify(actual) !== JSON.stringify({ claims: [], cancels: [], mentions: [], ...want })) wrong.push(codePoint.toString(16))
    }
    expect(wrong).toEqual([])
    for (const codePoint of CLAIM_TAIL_EMOJI) expect(pictographic.test(String.fromCodePoint(codePoint)), codePoint.toString(16)).toBe(true)
  })

  it('D-033: 코어의 허용 목록은 DOMAIN_RULES R-3 세부 "꼬리 그림 이모지 허용 목록"에 적힌 코드 포인트와 같다', () => {
    expect([...CLAIM_TAIL_EMOJI].sort((a, b) => a - b)).toEqual(allowlistFromDomainRules())
  })

  it('그 밖의 문자가 붙으면 주문이 아니다', () => {
    check([
      ['15?', { mentions: [15] }],
      ['15번요?', { mentions: [15] }],
      ['15번 ㅠㅠ', { mentions: [15] }],
      ['15%', { mentions: [15] }],
      ['15 ❤\uFE0E', { mentions: [15] }], // U+FE0E(글자 표시 선택자)는 목록에 없다
      ['15\u200B', { mentions: [15] }],
      ['15\u200E', { mentions: [15] }],
      ['15 #\uFE0F\u20E3', { mentions: [15] }],
      ['15 🇰🇷', { mentions: [15] }],
      ['15!?', { mentions: [15] }],
    ])
  })

  it('속성: STRICT에서 끝에 ?가 있는 메시지는 claims·cancels가 비어 있다', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom('?', ' ?', '??', '？?'), chatSettings, (text, question, settings) => {
        const result = parseChat(`${text}${question}`, { ...settings, ...STRICT })
        expect(result.claims).toEqual([])
        expect(result.cancels).toEqual([])
      }),
      { numRuns: 3000 },
    )
  })
})

describe('AC-S01-12 번호 범위·자릿수', () => {
  it('숫자 1~4자리, 1..maxNumber. 범위 밖이 섞이면 주문·취소가 아니다', () => {
    check([
      ['0', {}],
      ['0000', {}],
      ['1000', {}],
      ['15000', {}],
      ['00015', {}],
      ['15 1000', { mentions: [15] }],
      ['15 0', { mentions: [15] }],
      ['1000 취소', {}],
      ['15 00015', { mentions: [15] }],
    ])
  })

  it('maxNumber 50', () => {
    check(
      [
        ['50', { claims: [50] }],
        ['51', {}],
        ['15 51', { mentions: [15] }],
        ['51 취소', {}],
        ['50 취소', { cancels: [50] }],
      ],
      { 'claim.maxNumber': 50 },
    )
  })

  it('maxNumber 1과 9999 경계', () => {
    check(
      [
        ['1', { claims: [1] }],
        ['2', {}],
      ],
      { 'claim.maxNumber': 1 },
    )
    check(
      [
        ['9999', { claims: [9999] }],
        ['10000', {}],
      ],
      { 'claim.maxNumber': 9999 },
    )
  })

  it('속성: n=1..999 → "n"·"n번"은 claims [n], n=1000..9999 → 세 배열 모두 빔', () => {
    for (let n = 1; n <= 9999; n++) {
      const expected = n <= 999 ? { claims: [n], cancels: [], mentions: [] } : { claims: [], cancels: [], mentions: [] }
      expect(parseChat(String(n))).toEqual(expected)
      expect(parseChat(`${n}번`)).toEqual(expected)
    }
  })
})

describe('AC-S01-13 금액 모양은 번호가 아니다', () => {
  it('천 단위 쉼표 묶음 전체와 숫자.숫자는 금액 덩어리 — 주문·취소·언급 어디에도 없다', () => {
    for (const settings of [STRICT, LOOSE]) {
      check(
        [
          ['12,500', {}],
          ['12,500이요', {}],
          ['15,000원이요?', {}],
          ['1.5만 맞나요?', {}],
          ['1,000,000', {}],
          ['12,500,', {}],
          ['1.5', {}],
          ['15 1.5', { mentions: [15] }],
          ['15번 12,500원', { mentions: [15] }],
          ['15 취소 12,500', { mentions: [15] }],
          ['1,000.5', {}],
          ['15,28.5', { mentions: [15] }],
        ],
        settings,
      )
    }
  })

  it('묶음 모양이 아니면 번호 목록', () => {
    check([
      ['15,28,31', { claims: [15, 28, 31] }],
      ['15, 28', { claims: [15, 28] }],
      ['1,50', { claims: [1, 50] }],
      ['15.', { claims: [15] }],
    ])
  })
})

describe('AC-S01-14 여러 번호 설정', () => {
  it('ALL · FIRST · IGNORE', () => {
    check([['28 15', { claims: [28, 15] }]], { 'claim.multiNumber': 'ALL' })
    check(
      [
        ['28 15', { claims: [28] }],
        ['15 15 28', { claims: [15] }],
        ['15 취소', { cancels: [15] }],
        ['15번 18번 중에 뭐가 나아요?', { mentions: [15, 18] }],
      ],
      { 'claim.multiNumber': 'FIRST' },
    )
    check(
      [
        ['15,28,31', { mentions: [15, 28, 31] }],
        ['15 15', { claims: [15] }],
        ['15', { claims: [15] }],
        ['15 취소', { cancels: [15] }],
      ],
      { 'claim.multiNumber': 'IGNORE' },
    )
    check([['15 28 예뻐요', { mentions: [15, 28] }]], { ...LOOSE, 'claim.multiNumber': 'IGNORE' })
  })

  it('속성: ALL의 claims가 비면 FIRST도 비고, 아니면 FIRST = [ALL의 첫 원소]', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom('STRICT' as const, 'LOOSE' as const), fc.constantFrom(9, 50, 999), (text, mode, maxNumber) => {
        const base = { 'claim.parseMode': mode, 'claim.maxNumber': maxNumber }
        const all = parseChat(text, { ...base, 'claim.multiNumber': 'ALL' })
        const first = parseChat(text, { ...base, 'claim.multiNumber': 'FIRST' })
        expect(first.claims).toEqual(all.claims.slice(0, 1))
        expect(first.cancels).toEqual(all.cancels)
        if (all.claims.length === 0) expect(first.mentions).toEqual(all.mentions)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('AC-S01-19 메시지당 번호 개수 상한 (D-034)', () => {
  const MULTI = ['ALL', 'FIRST', 'IGNORE'] as const

  it('서로 다른 번호 6개 이상이면 주문이 아니고 언급 — ALL·FIRST·IGNORE, STRICT·LOOSE 모두', () => {
    for (const mode of [STRICT, LOOSE]) {
      for (const multi of MULTI) {
        const settings = { ...mode, 'claim.multiNumber': multi }
        check(
          [
            ['1 2 3 4 5 6', { mentions: [1, 2, 3, 4, 5, 6] }],
            ['1,2,3,4,5,6,7,8,9,10', { mentions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
            ['찜 1 2 3 4 5 6번 주세요', { mentions: [1, 2, 3, 4, 5, 6] }],
            ['1 2 3 4 5 6 1 2', { mentions: [1, 2, 3, 4, 5, 6] }],
            ['１ ２ ３ ４ ５ ６', { mentions: [1, 2, 3, 4, 5, 6] }],
            ['15 15 15 15 15 15', { claims: [15] }], // 서로 다른 번호 1개
            ['15 015 0015 １５ 15번', { claims: [15] }], // 값으로 센다
          ],
          settings,
        )
      }
    }
  })

  it('5개까지는 multiNumber대로 주문 (같은 번호 반복은 하나)', () => {
    check([['1 2 3 4 5', { claims: [1, 2, 3, 4, 5] }], ['1 2 3 4 5 5 1', { claims: [1, 2, 3, 4, 5] }], ['1 01 001 0001 2 3 4 5', { claims: [1, 2, 3, 4, 5] }]])
    check([['1 2 3 4 5', { claims: [1] }]], { 'claim.multiNumber': 'FIRST' })
    check([['1 2 3 4 5', { mentions: [1, 2, 3, 4, 5] }]], { 'claim.multiNumber': 'IGNORE' })
  })

  it('LOOSE: 고른(가장 긴) 부분에 적용하고 더 짧은 앞부분으로 물러나지 않는다', () => {
    check(
      [
        ['1 2 3 4 5 6 다 주세요', { mentions: [1, 2, 3, 4, 5, 6] }],
        ['1 2 3 4 5 6!! 다 주세요', { mentions: [1, 2, 3, 4, 5, 6] }],
        ['1 2 3 4 5 다 주세요', { claims: [1, 2, 3, 4, 5] }],
      ],
      LOOSE,
    )
  })

  it('취소는 번호 하나라 상한과 무관하다', () => {
    check([['6 취소', { cancels: [6] }]])
  })

  it('속성: 번호를 k개(1~12) 나열한 메시지 — 서로 다른 번호 ≤ 5면 multiNumber대로, ≥ 6이면 언급(나온 순서). 주문은 언제나 5개 이하', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 12 }),
        fc.constantFrom(' ', ',', '/', '·', '번 '),
        fc.constantFrom(...MULTI),
        fc.constantFrom(STRICT, LOOSE),
        (values, separator, multi, mode) => {
          const text = values.join(separator)
          const distinct = [...new Set(values)]
          const actual = parseChat(text, { ...mode, 'claim.multiNumber': multi })
          expect(actual.claims.length, text).toBeLessThanOrEqual(5)
          const expected =
            distinct.length >= 6 || (multi === 'IGNORE' && distinct.length > 1)
              ? { mentions: distinct }
              : { claims: multi === 'FIRST' ? distinct.slice(0, 1) : distinct }
          expect(actual, text).toEqual({ claims: [], cancels: [], mentions: [], ...expected })
        },
      ),
      { numRuns: 3000 },
    )
  })
})

describe('AC-S01-15 취소', () => {
  it('번호 하나 [번] 취소말 [꼬리 기호·ㅠ·ㅜ]', () => {
    for (const settings of [STRICT, LOOSE]) {
      check(
        [
          ['15 취소', { cancels: [15] }],
          ['15번 취소!!', { cancels: [15] }],
          ['15번 취소요 ㅠㅠ', { cancels: [15] }],
          ['015 취소', { cancels: [15] }],
          ['15 취소할게요', { cancels: [15] }],
          ['15번 취소해주세요 ㅜㅜ', { cancels: [15] }],
          ['15취소', { cancels: [15] }],
          ['15 번 취소 ❤\uFE0F', { cancels: [15] }],
          ['15 28 취소', { mentions: [15, 28] }],
          ['취소 15', { mentions: [15] }],
          ['취소', {}],
          ['찜 15 취소', { mentions: [15] }],
        ],
        settings,
      )
    }
  })

  it('STRICT: 취소 뒤에 다른 말이 오면 취소가 아니다', () => {
    check([
      ['15 취소 28', { mentions: [15, 28] }],
      ['15 취소합니다', { mentions: [15] }],
      ['15 취소?', { mentions: [15] }],
    ])
  })
})

describe('AC-S01-16 언급', () => {
  it('주문도 취소도 아닌 메시지의 1~4자리·범위 안 숫자 덩어리, 나온 순서, 중복 없음', () => {
    check([
      ['15번 2개 가능해요?', { mentions: [15, 2] }],
      ['15번 15번 예뻐요', { mentions: [15] }],
      ['<script>15</script>', { mentions: [15] }],
      ['십오번', {}],
      ['010-1234-5678', { mentions: [10] }],
      ['8:30', { mentions: [8, 30] }],
      ['1\uFE0F\u20E35\uFE0F\u20E3', { mentions: [1, 5] }],
      ['١٥', {}],
      ['१५', {}],
      ['15\u200B28', { mentions: [15, 28] }],
    ])
  })

  it('속성: 비어 있지 않은 배열 ≤ 1, 각 배열 중복 없음, 모든 값 1..maxNumber 정수', () => {
    fc.assert(
      fc.property(anyText, chatSettings, (text, settings) => {
        const result = parseChat(text, settings)
        const maxNumber = settings['claim.maxNumber'] ?? 999
        const lists = [result.claims, result.cancels, result.mentions]
        expect(lists.filter((list) => list.length > 0).length).toBeLessThanOrEqual(1)
        for (const list of lists) {
          expect(new Set(list).size).toBe(list.length)
          for (const n of list) {
            expect(Number.isInteger(n)).toBe(true)
            expect(n).toBeGreaterThanOrEqual(1)
            expect(n).toBeLessThanOrEqual(maxNumber)
          }
        }
        expect(result.cancels.length).toBeLessThanOrEqual(1)
      }),
      { numRuns: 5000 },
    )
  })
})

describe('AC-S01-17 LOOSE', () => {
  it('맨 앞 주문 부분이 끝·공백 앞에서 끝나거나 공백·꼬리 기호로 끝나면 주문 (가장 긴 부분)', () => {
    check(
      [
        ['15번 너무 예뻐요 살게요', { claims: [15] }],
        ['15번 18번 중에 뭐가 나아요?', { claims: [15, 18] }],
        ['15!!예뻐요', { claims: [15] }],
        ['15번 2개 가능해요?', { claims: [15] }],
        ['15번이요 감사합니다', { claims: [15] }],
        ['15 28 예뻐요', { claims: [15, 28] }],
        ['15 28개 주세요', { claims: [15] }],
        ['15❤\uFE0F예뻐요', { claims: [15] }],
        ['찜 15 예뻐요', { claims: [15] }],
        ['15', { claims: [15] }],
        ['3개 남았나요?', { mentions: [3] }],
        ['15개요', { mentions: [15] }],
        ['15?', { mentions: [15] }],
        ['예뻐요 15번', { mentions: [15] }],
        ['15번째', { mentions: [15] }],
        ['15,28개', { mentions: [15, 28] }],
        ['15 1000', { mentions: [15] }], // 범위 밖 번호가 섞임
      ],
      LOOSE,
    )
  })

  it('수식 문자만으로는 "꼬리 기호로 끝남"이 되지 않는다 — 보이는 숫자를 가르는 주문 부분은 없다', () => {
    check(
      [
        ['1\u200D5', { mentions: [1, 5] }],
        ['1\uFE0F5', { mentions: [1, 5] }],
        ['1\uFE0F\u20E35\uFE0F\u20E3', { mentions: [1, 5] }],
        ['1🏻5', { mentions: [1, 5] }],
        ['15\uFE0F예뻐요', { mentions: [15] }],
        ['15 \uFE0F예뻐요', { claims: [15] }],
        ['15❤\uFE0F예뻐요', { claims: [15] }],
      ],
      LOOSE,
    )
  })

  it('취소가 먼저, 취소가 들어간 메시지는 주문이 아니다', () => {
    check(
      [
        ['15 취소할게요 죄송해요', { cancels: [15] }],
        ['15 취소 28', { cancels: [15] }],
        ['15 취소ㅠ죄송', { cancels: [15] }],
        ['15번 사려다 취소', { mentions: [15] }],
        ['15 취소요청', { mentions: [15] }],
        ['15 취소합니다', { mentions: [15] }],
        ['1000 취소할게요', {}],
      ],
      LOOSE,
    )
  })

  it('금액 덩어리·범위·여러 번호·언급 규칙은 STRICT와 같다', () => {
    check(
      [
        ['12,500원이요', {}],
        ['15 1000', { mentions: [15] }],
        ['안녕하세요 15', { mentions: [15] }],
      ],
      LOOSE,
    )
    check([['28 15 예뻐요', { claims: [28] }]], { ...LOOSE, 'claim.multiNumber': 'FIRST' })
  })

  it('범위는 메시지 전체로 본다 — 주문 부분 뒤에 범위 밖 번호가 있어도 주문·취소가 아니다 (R-3 세부 "범위", TD-S01-002)', () => {
    check(
      [
        // 주문 부분('15') 뒤 범위 밖 번호: '원'·'개'가 붙어도 '15 1000'과 같이 언급
        ['15 1000원이에요', { mentions: [15] }],
        ['15 1000원', { mentions: [15] }],
        ['15 2000원 맞죠?', { mentions: [15] }],
        ['15 0개', { mentions: [15] }],
        ['15 0원', { mentions: [15] }],
        ['15번 예뻐요 0번째 사진', { mentions: [15] }],
        ['15 1,000원이에요', { mentions: [15] }], // 금액 덩어리(같은 결과)
        ['15 취소 1000번째', { mentions: [15] }], // 취소도 같다
        ['15 취소할게요 0시에', { mentions: [15] }],
        // 범위 안 번호만 있으면 그대로 (골든 '15번 2개 가능해요?')
        ['15번 2개 가능해요?', { claims: [15] }],
        ['15 28개 주세요', { claims: [15] }],
        ['15 취소 28', { cancels: [15] }],
        // 5자리 이상 숫자는 번호가 아니라 범위 판정에 들어가지 않는다(R-3 세부 "번호")
        ['15 10000원이에요', { claims: [15] }],
      ],
      LOOSE,
    )
    check(
      [
        ['15 예뻐요 51', { mentions: [15] }],
        ['15 51 취소', { mentions: [15] }],
        ['15 예뻐요 50', { claims: [15] }],
      ],
      { ...LOOSE, 'claim.maxNumber': 50 },
    )
  })

  it('속성: LOOSE에서 주문·취소이면 메시지의 1~4자리 숫자 덩어리(금액 덩어리 아님)는 모두 범위 안이다', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom(9, 50, 999), (text, maxNumber) => {
        const result = parseChat(text, { ...LOOSE, 'claim.maxNumber': maxNumber })
        if (result.claims.length === 0 && result.cancels.length === 0) return
        // 금액 덩어리가 있으면 주문이 아니므로, 여기서는 모든 숫자 덩어리가 번호 후보다
        const normalized = text.replace(/[^\S\uFEFF]+/gu, ' ').replace(/[\uFF10-\uFF19]/gu, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30))
        for (const run of normalized.match(/[0-9]+/gu) ?? []) {
          if (run.length <= 4) expect(Number(run), JSON.stringify(text)).toBeGreaterThanOrEqual(1)
          if (run.length <= 4) expect(Number(run), JSON.stringify(text)).toBeLessThanOrEqual(maxNumber)
        }
      }),
      { numRuns: 3000 },
    )
  })

  it('속성: STRICT에서 주문이면 LOOSE에서도 같은 주문', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const strict = parseChat(text, STRICT)
        if (strict.claims.length > 0) expect(parseChat(text, LOOSE).claims).toEqual(strict.claims)
        if (strict.cancels.length > 0) expect(parseChat(text, LOOSE).cancels).toEqual(strict.cancels)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('AC-S01-17 LOOSE 끝 신호 (R-3 LOOSE 세부 "끝 신호", D-035)', () => {
  const FE0F = '️'
  const ZWSP = '​'

  it('1 질문 기호 ? ？ ❓ ❔ ⁉ — 공백을 사이에 두어도 주문이 아니다', () => {
    check(
      [
        ['15 ?', { mentions: [15] }],
        ['15 ？', { mentions: [15] }],
        ['15 \u{2753} 남았나요', { mentions: [15] }],
        ['15 \u{2754}', { mentions: [15] }],
        ['15번 \u{2049}', { mentions: [15] }],
        ['15!\u{2753}', { mentions: [15] }],
        ['15 주세요 ?', { mentions: [15] }],
      ],
      LOOSE,
    )
  })

  it('2 꼬리 기호가 아닌 한글 호환 자모 — ㅎ·ㅋ는 꼬리 기호, U+3164 채움 문자는 건너뛴다', () => {
    check(
      [
        ['15번 ㅠㅠ', { mentions: [15] }],
        ['15 ㄴㄴ', { mentions: [15] }],
        ['15 ㅇㅇ', { mentions: [15] }],
        ['15 ㅡㅡ', { mentions: [15] }],
        ['15!ㄷㄷ', { mentions: [15] }],
        ['15 ㅋㅋ 예뻐요', { claims: [15] }],
        ['15 ㅎ', { claims: [15] }],
        ['15 ㅤ예뻐요', { claims: [15] }],
        ['15 ㅤㅠ', { mentions: [15] }],
      ],
      LOOSE,
    )
  })

  it('3 꼬리 기호가 아닌 그림 이모지 — 허용 목록·♥는 그대로 꼬리', () => {
    check(
      [
        ['15 \u{274C}', { mentions: [15] }],
        ['15번 \u{1F62D}', { mentions: [15] }],
        ['15 \u{1F914} 고민', { mentions: [15] }],
        ['15\u{1F44D}\u{1F44E}', { mentions: [15] }],
        [`15 \u{2764}${FE0F} \u{1F62D}`, { mentions: [15] }], // 더 짧은 부분 '15 ❤️'로 물러나지 않는다
        ['15 \u{1F44D} 예뻐요', { claims: [15] }],
        ['15 \u{2665} 예뻐요', { claims: [15] }],
      ],
      LOOSE,
    )
  })

  it('4 번호 부분에 들어가지 못하고 남은 번 — 숫자와 공백 하나 뒤의 번이 부분에 들어가면 주문', () => {
    check(
      [
        ['15 번째 사진', { mentions: [15] }],
        ['15 번호 맞나요', { mentions: [15] }],
        ['15! 번째', { mentions: [15] }],
        ['15 번 예뻐요', { claims: [15] }],
        ['15번 번개', { mentions: [15] }],
      ],
      LOOSE,
    )
  })

  it('5 공백 없이 붙은 숫자 — 공백 뒤 숫자는 신호가 아니다, 보이지 않는 글자만 사이에 있으면 붙은 것', () => {
    check(
      [
        ['15~28', { mentions: [15, 28] }],
        [`15 \u{2764}${FE0F}28`, { mentions: [15, 28] }],
        ['15 28~3', { mentions: [15, 28, 3] }],
        [`15!${ZWSP}3`, { mentions: [15, 3] }],
        [`15 \u{2764}${FE0F} 28`, { claims: [15] }],
        ['15! 28개', { claims: [15] }],
      ],
      LOOSE,
    )
  })

  it('공백·피부색·보이지 않는 글자를 모두 건너뛴 첫 글자를 본다. 건너뛰고 끝나면 볼 글자가 없다', () => {
    check(
      [
        [`15 ${ZWSP}\u{1F62D}`, { mentions: [15] }],
        ['15 \u{1F3FB}\u{274C}', { mentions: [15] }],
        [`15 ${ZWSP}\u{1F3FB}\u{274C}`, { mentions: [15] }], // 보이지 않는 글자 뒤 피부색도 건너뛴다
        ['15 \u{E0067}\u{E007F}\u{1F62D}', { mentions: [15] }], // 태그 글자(U+E0000대)도 Default_Ignorable
        ['15 \u{E0001}예뻐요', { claims: [15] }],
        ['15 \u{1F3FF}\u{1F3FB} 예뻐요', { claims: [15] }],
        ['15 ﻿?', { mentions: [15] }],
        [`15 ${ZWSP}⁠‎ ㅠ`, { mentions: [15] }],
        [`15 ${ZWSP}예뻐요`, { claims: [15] }],
        [`15 ${ZWSP}`, { claims: [15] }],
        ['15 \u{1F3FB}', { claims: [15] }],
      ],
      LOOSE,
    )
  })

  it('두 자리: (나) 끝 경계와 상관없는 가장 긴 맨 앞 부분 뒤도 본다', () => {
    check(
      [
        ['15 28\u{2753}', { mentions: [15, 28] }], // 고른 부분 '15', 가장 긴 부분 '15 28'
        ['15 찜\u{2753}', { mentions: [15] }],
        ['1 2 3 4 5 6\u{2753}', { mentions: [1, 2, 3, 4, 5, 6] }], // 고른 부분 '1 2 3 4 5'
        ['15 28ㅠ', { mentions: [15, 28] }],
        ['15 28개', { claims: [15] }], // 가장 긴 부분 '15 28' 뒤 '개'는 신호가 아니다
      ],
      LOOSE,
    )
  })

  it('더 짧은 부분으로 물러나지 않고, 번호 개수 상한·multiNumber보다 먼저 본다', () => {
    for (const multi of ['ALL', 'FIRST', 'IGNORE'] as const) {
      check(
        [
          ['15 28 \u{2753}', { mentions: [15, 28] }],
          ['15,28 \u{274C}', { mentions: [15, 28] }],
          ['1 2 3 4 5 6 7 ？', { mentions: [1, 2, 3, 4, 5, 6, 7] }],
        ],
        { ...LOOSE, 'claim.multiNumber': multi },
      )
    }
  })

  it('취소 부분은 취소 꼬리 기준 — ㅠ ㅜ 😢 😭 🥲는 신호가 아니다. 걸리면 취소가 아니고 주문도 아니다', () => {
    check(
      [
        ['15번 취소 \u{1F62D} 죄송해요', { cancels: [15] }],
        ['15 취소 ㅜㅜ 죄송해요', { cancels: [15] }],
        ['15 취소 \u{1F972}', { cancels: [15] }],
        ['15번 취소 \u{2753}', { mentions: [15] }],
        ['15 취소 번복할게요', { mentions: [15] }],
        ['15 취소 ㄴㄴ', { mentions: [15] }],
        ['15 취소!2', { mentions: [15, 2] }],
        ['15 취소 \u{1F440}', { mentions: [15] }],
      ],
      LOOSE,
    )
  })

  it('두 자리의 첫 글자만 본다 — 그 뒤의 말은 보지 않는다', () => {
    check(
      [
        ['15번 너무 예뻐요 \u{2753}', { claims: [15] }],
        ['15 말고 16', { claims: [15] }],
        ['15 28 너무 예뻐요 ?', { claims: [15, 28] }],
        ['15번 2개 가능해요?', { claims: [15] }],
      ],
      LOOSE,
    )
  })

  it('STRICT에는 영향이 없다 — 메시지 전체가 부분이라 뒤에 글자가 없다', () => {
    check(
      [
        ['15', { claims: [15] }],
        ['15 ㅋㅋ', { claims: [15] }],
        ['15 취소 ㅠ', { cancels: [15] }],
        ['15 \u{2753}', { mentions: [15] }],
      ],
      STRICT,
    )
  })

  it('속성: LOOSE 주문 부분 + 건너뛰는 글자 + 끝 신호 1~3번 글자 + 아무 말 → claims·cancels가 빈다', () => {
    const order = fc.constantFrom('15', '15번', '찜 15', '15 28', '15 주세요', '15!!', `15 \u{2764}${FE0F}`, '15 ㅋㅋ', '15/28번')
    const signal = fc.constantFrom('?', '？', '\u{2753}', '\u{2754}', '\u{2049}', 'ㅠ', 'ㅜ', 'ㄴ', 'ㅇ', '\u{274C}', '\u{1F62D}', '\u{1F914}', '\u{1F440}')
    const skip = fc.constantFrom('', ' ', ` ${ZWSP}`, ' \u{1F3FB}', ` ${FE0F}`, ' ㅤ')
    fc.assert(
      fc.property(order, skip, signal, chatMessage, fc.constantFrom('ALL' as const, 'FIRST' as const, 'IGNORE' as const), (head, between, mark, rest, multi) => {
        const text = `${head}${between}${mark}${rest}`
        const actual = parseChat(text, { ...LOOSE, 'claim.multiNumber': multi })
        expect(actual.claims, JSON.stringify(text)).toEqual([])
        expect(actual.cancels, JSON.stringify(text)).toEqual([])
      }),
      { numRuns: 2000 },
    )
  })
})

describe('AC-S01-18 정규화', () => {
  it('앞뒤 공백, 연속 공백(탭·줄바꿈·NBSP·전각 공백), 전각 숫자', () => {
    expect(parseChat('  15  번 ')).toEqual(parseChat('15 번'))
    expect(parseChat('１５ ２８')).toEqual(parseChat('15 28'))
    check([
      ['15\n28', { claims: [15, 28] }],
      ['15\t\t번', { claims: [15] }],
      ['15\u00A0번', { claims: [15] }],
      ['15\u3000찜', { claims: [15] }],
      ['\n\n15\n\n', { claims: [15] }],
    ])
  })

  it('U+FEFF(폭 없는 비분리 공백)는 공백이 아니다 — 화면의 숫자 하나를 가르지 않는다 (TD-S01-001)', () => {
    const zwnbsp = String.fromCodePoint(0xfeff)
    for (const settings of [STRICT, LOOSE, { ...LOOSE, 'claim.maxNumber': 9999 }]) {
      check(
        [
          [`1${zwnbsp}5`, { mentions: [1, 5] }], // 화면엔 '15'. 1번·5번 주문이 아니다
          [`1${zwnbsp}5번 찜할게요`, { mentions: [1, 5] }],
          [`1${zwnbsp}5 취소`, { mentions: [1, 5] }],
          [`12${zwnbsp}34`, { mentions: [12, 34] }],
          [`15${zwnbsp}`, { mentions: [15] }], // 앞뒤의 U+FEFF도 지우지 않는다(U+200B와 같음)
          [`${zwnbsp}15`, { mentions: [15] }],
        ],
        settings,
      )
    }
    // 공백 사이의 U+FEFF는 구분자가 아니다: STRICT는 주문이 아니고, LOOSE는 공백 앞에서 끝난 맨 앞 부분 '15'만 주문
    // (끝 신호 자리에서 공백·U+FEFF를 건너뛴 첫 글자 '2'는 공백 뒤라 "붙은 숫자"가 아니다, D-035 5)
    check([[`15 ${zwnbsp} 28`, { mentions: [15, 28] }]], STRICT)
    check([[`15 ${zwnbsp} 28`, { claims: [15] }]], LOOSE)
  })

  it('속성: 여러 자리 번호의 숫자 사이에 U+FEFF를 끼우면 어떤 설정에서도 주문·취소가 나오지 않는다', () => {
    const zwnbsp = String.fromCodePoint(0xfeff)
    const template = fc.constantFrom((n: string) => n, (n: string) => `${n}번`, (n: string) => `찜 ${n}`, (n: string) => `${n} 주세요`, (n: string) => `${n} 취소`, (n: string) => `${n} 예뻐요`)
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 9999 }), fc.nat(), template, chatSettings, (n, at, wrap, settings) => {
        const digits = String(n)
        const pos = 1 + (at % (digits.length - 1))
        const result = parseChat(wrap(`${digits.slice(0, pos)}${zwnbsp}${digits.slice(pos)}`), settings)
        expect(result.claims).toEqual([])
        expect(result.cancels).toEqual([])
      }),
      { numRuns: 2000 },
    )
  })

  it('속성: 공백을 늘리거나 앞뒤에 붙여도 결과가 같다', () => {
    const spaces = fc.constantFrom(' ', '  ', '\t', '\n', ' \u00A0', '\u3000')
    fc.assert(
      fc.property(chatMessage, spaces, spaces, spaces, chatSettings, (text, before, after, inner, settings) => {
        const widened = `${before}${text.replace(/ /g, ` ${inner}`)}${after}`
        expect(parseChat(widened, settings)).toEqual(parseChat(text, settings))
      }),
      { numRuns: 3000 },
    )
  })
})
