// R-26 문자 읽기 parseSmsText (SMS3): 규칙 단위 시험과 AC-SMS3-02 예외 없음·결정성·memo 모양 속성 시험.
// 사례별 정답은 골든 tests/golden/parser/sms-text.yaml이 맡는다 — 여기선 골든이 덜 다루는 경계와 성질을 본다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseSmsText, SMS_EXCLUDED_WORDS, type SmsTextOptions, type SmsTextResult } from '@livejjim/core'

const PHONE = '010-1234-5678'
const read = (text: string, from: string | null = PHONE, options: SmsTextOptions = {}): SmsTextResult => parseSmsText({ from, text }, options)

const MEMO_RE = /^[가-힣]{2,10}$/u
const SHAPES: Readonly<Record<string, readonly string[]>> = {
  claims: ['claims', 'memo'],
  cancels: ['cancels', 'memo'],
  review: ['memo', 'review', 'why'],
  skip: ['skip'],
}

/** 다섯 모양 중 하나인지 (README sms-text 줄) — 키·값 모양까지 본다 */
function expectShape(result: unknown): void {
  expect(result).toBeTypeOf('object')
  expect(result).not.toBeNull()
  const record = result as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const shape = Object.keys(SHAPES).find((key) => keys.includes(key))
  if (shape === undefined) {
    expect(keys).toEqual([])
    return
  }
  for (const key of keys) expect(SHAPES[shape]).toContain(key)
  for (const key of ['claims', 'cancels', 'review']) {
    if (!(key in record)) continue
    const list = record[key] as unknown[]
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)
    expect(new Set(list).size).toBe(list.length)
    for (const n of list) expect(Number.isInteger(n) && (n as number) >= 1).toBe(true)
  }
  if ('why' in record) expect(['UNCLEAR', 'NO_NUMBER', 'OPTIONS']).toContain(record.why)
  if ('skip' in record) expect(['NOT_MOBILE', 'EXCLUDED']).toContain(record.skip)
  if (shape === 'review') expect('why' in record).toBe(true)
  if ('memo' in record) {
    expect(record.memo).toMatch(MEMO_RE)
    expect(record.memo as string).not.toMatch(/\d/u)
  }
}

describe('R-26 1 보낸 곳', () => {
  it.each([
    ['01012345678', { claims: [775] }],
    ['  +82 10-1234-5678', { claims: [775] }], // 앞 공백 뒤 +82
    ['+82-11-123-4567', { claims: [775] }], // 82 뗌 → 111234567(9자리) → 0 붙임 → 0111234567 (R-11 01로 시작 10자리)
    ['(010) 1234.5678', { claims: [775] }],
    ['+82', { skip: 'NOT_MOBILE' }], // 숫자를 담았고 숫자·+뿐 — 정리 뒤 빈 글이어도 휴대폰 아님
    ['+82 1588-9999', { skip: 'NOT_MOBILE' }], // 15889999(8자리)는 0을 붙이지 않는다
    ['82 10-1234-5678', { skip: 'NOT_MOBILE' }], // + 없이 82로 시작하면 떼지 않는다
    ['1'.repeat(40), { skip: 'NOT_MOBILE' }],
    ['*1004#', { skip: 'NOT_MOBILE' }],
    ['010\t1234\n5678', { claims: [775] }],
    ['010–1234–5678', { claims: [775] }], // en dash는 휴대폰 아님 목록 밖 글자지만 normalizePhone은 숫자만 본다
    ['010–1234', { review: [775], why: 'NO_NUMBER' }], // en dash가 섞여 숫자 모양이 아님 → 이름만
    ['٠١٠١٢٣٤٥٦٧٨', { review: [775], why: 'NO_NUMBER' }], // 아라비아 숫자는 숫자가 아니다 → 이름만
  ] as const)('from %j', (from, expected) => {
    expect(read('775', from)).toEqual(expected)
  })

  it('휴대폰 아님은 본문을 보지 않는다 (거를 낱말보다 먼저)', () => {
    expect(read('(광고) 775', '1588-9999')).toEqual({ skip: 'NOT_MOBILE' })
  })

  it('from이 문자열이 아니면 이름만 (번호를 모름)', () => {
    for (const from of [undefined, 1012345678, {}, []]) {
      expect(parseSmsText({ from, text: '775' } as unknown as { from: string; text: string })).toEqual({ review: [775], why: 'NO_NUMBER' })
    }
  })

  it('이름만이어도 취소 요청·확인 필요는 그대로', () => {
    expect(read('775 취소 홍길동', '홍길동')).toEqual({ cancels: [775], memo: '홍길동' })
    expect(read('775 예뻐요', null)).toEqual({ review: [775], why: 'UNCLEAR' })
  })
})

describe('R-26 3 거를 낱말', () => {
  it.each(SMS_EXCLUDED_WORDS.map((word) => [word]))('%s가 들어 있으면 거름', (word) => {
    expect(read(`775 ${word}`)).toEqual({ skip: 'EXCLUDED' })
    expect(read(`${word.toUpperCase()}775`)).toEqual({ skip: 'EXCLUDED' })
  })

  it('정규화 뒤에 본다 (줄바꿈·연속 공백은 한 칸 — 낱말 안의 공백은 그대로)', () => {
    expect(read('[WEB발신]\n\n775')).toEqual({ skip: 'EXCLUDED' })
    expect(read('인 증 775')).toEqual({ review: [775], why: 'UNCLEAR' })
  })
})

describe('R-26 4 이름', () => {
  it.each([
    ['775 홍길동...', '홍길동'],
    ['775 홍길동~^♡♥ㅋㅎ', '홍길동'],
    ['775 홍길동입니다!', '홍길동'],
    ['775 홍길동이에요ㅎㅎ', '홍길동'],
    ['775 가나다라마바사아자차', '가나다라마바사아자차'], // 10자
    ['775 아이', '아이'], // '아니'가 아니다
  ])('%s → memo %s', (text, memo) => {
    expect(read(text)).toEqual({ claims: [775], memo })
  })

  it.each([
    '775 가나다라마바사아자차카', // 11자
    '775 홍', // 한 글자
    '775 홍길동입니다입니다', // 하나만 뗀다 → '홍길동입니다' → 다로 끝남
    '775 아니에요',
    '775 아닌데',
    '775 않음',
    '775 못사',
    '775 말고',
    '775 언제와',
    '775 어디로',
    '775 뭐임',
    '775 몇개',
    '775 있음',
    '775 없음',
    '775 찜콩이',
    '775 취소각',
    '775 그래까',
    '775 Hong길동',
  ])('%s → 이름 아님 → 확인 필요', (text) => {
    expect(read(text)).toEqual({ review: [775], why: 'UNCLEAR' })
  })

  it('숫자가 섞인 토큰은 이름이 아니다 (그 숫자는 R-3 언급)', () => {
    expect(read('775 홍길동2')).toEqual({ review: [775, 2], why: 'UNCLEAR' })
  })

  it('마지막 토큰이 이름이어도 남은 글이 주문이 아니면 첫 토큰을 본다', () => {
    expect(read('홍길동 775 김영희요')).toEqual({ review: [775], why: 'UNCLEAR' })
    expect(read('홍길동 775번 주세요')).toEqual({ claims: [775], memo: '홍길동' })
  })

  it('토큰이 하나면 이름을 떼 보지 않는다', () => {
    expect(read('홍길동')).toEqual({})
  })
})

describe('R-26 5·6 확인 필요와 바꾸기', () => {
  it('OPTIONS는 NO_NUMBER보다 먼저, memo는 그대로', () => {
    expect(read('775 홍길동', null, { parseMode: 'OPTIONS' })).toEqual({ review: [775], why: 'OPTIONS', memo: '홍길동' })
    expect(read('775 취소 홍길동', PHONE, { parseMode: 'OPTIONS' })).toEqual({ review: [775], why: 'OPTIONS', memo: '홍길동' })
  })

  it('이름만 + 문자찜 → NO_NUMBER (memo 그대로)', () => {
    expect(read('775 776 김영희', '김철수')).toEqual({ review: [775, 776], why: 'NO_NUMBER', memo: '김영희' })
  })

  it('LOOSE 방송도 STRICT로 읽는다', () => {
    expect(read('775 너무 예뻐요', PHONE, { parseMode: 'LOOSE' })).toEqual({ review: [775], why: 'UNCLEAR' })
  })

  it('설정이 빠지거나 틀리면 기본값(ALL·999)으로 읽는다 — 예외 없음', () => {
    const bad = [undefined, null, {}, { maxNumber: 0 }, { maxNumber: 1.5 }, { maxNumber: 10000 }, { maxNumber: '99' }, { multiNumber: 'ALL!' }, { parseMode: 'options' }, 'STRICT', 7]
    for (const options of bad) {
      expect(parseSmsText({ from: PHONE, text: '775 776' }, options as unknown as SmsTextOptions)).toEqual({ claims: [775, 776] })
    }
    expect(read('775 776', PHONE, { multiNumber: 'FIRST', maxNumber: 9999 })).toEqual({ claims: [775] })
  })

  it('입력이 맵이 아니거나 text가 문자열이 아니어도 예외 없이 찜 아님', () => {
    for (const input of [null, undefined, 7, '775', { from: PHONE }, { from: PHONE, text: 775 }]) {
      expect(parseSmsText(input as unknown as { from: string; text: string })).toEqual({})
    }
  })

  it('넘긴 입력·설정을 바꾸지 않는다', () => {
    const input = Object.freeze({ from: PHONE, text: '775 홍길동' })
    const options = Object.freeze({ parseMode: 'STRICT', multiNumber: 'ALL', maxNumber: 999 } as const)
    expect(parseSmsText(input, options)).toEqual({ claims: [775], memo: '홍길동' })
  })

  it('결과 배열은 호출마다 새것 (고쳐도 다음 결과에 번지지 않는다)', () => {
    const first = read('775 776') as { claims: number[] }
    first.claims.push(1)
    expect(read('775 776')).toEqual({ claims: [775, 776] })
  })
})

describe('AC-SMS3-02 예외 없음·결정성 (속성)', () => {
  /** 짝 없는 서로게이트까지 포함한 아무 UTF-16 문자열 */
  const utf16 = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 }).map((codes) => String.fromCharCode(...codes))
  const piece = fc.oneof(
    fc.constantFrom('775', '776', '1', '15', '0', '1000', '12,000원', '취소', '찜', '번', '요', '홍길동', '김영희요', '아님', '입니다', '이요', 'ㅎ', '!', '?', '♥', '💕', '💔', '❤️', '\u0000', '\u001b', '\uD800', '\uDFFF', '\u200B', '\uFEFF', '\n', ' ', '\u3000', '７７５', '(광고)', 'Web발신', '-', ',', '/'),
    fc.string({ maxLength: 6 }),
    fc.string({ unit: 'grapheme', maxLength: 4 }),
  )
  const text = fc.oneof(
    fc.array(piece, { maxLength: 12 }).chain((parts) => fc.constantFrom(parts.join(' '), parts.join(''))),
    fc.string({ unit: 'binary', maxLength: 40 }),
    utf16,
    fc.constantFrom('', '\u0000\u0007\u001b', '\uD83D'.repeat(50), '💕'.repeat(5000), '🌱 '.repeat(3000), '775 '.repeat(25000), 'x'.repeat(100000)),
  )
  const from = fc.oneof(
    fc.constant(null),
    fc.constantFrom('', '+82', '+82 ', ' +82', '1'.repeat(40), '0'.repeat(40), PHONE, '+82 10-1234-5678', '홍길동', '1588-9999', '\uD800', '０１０１２３４５６７８'),
    fc.string({ maxLength: 20 }),
    fc.string({ unit: 'binary', maxLength: 20 }),
    fc.array(fc.constantFrom('0', '1', '8', '2', '+', '-', ' ', '(', ')', '.', '#', '*', '가'), { maxLength: 20 }).map((chars) => chars.join('')),
  )
  const options = fc.record(
    {
      parseMode: fc.constantFrom('STRICT' as const, 'LOOSE' as const, 'OPTIONS' as const),
      multiNumber: fc.constantFrom('ALL' as const, 'FIRST' as const, 'IGNORE' as const),
      maxNumber: fc.integer({ min: 1, max: 9999 }),
    },
    { requiredKeys: [] },
  )

  it('어떤 입력에도 예외 없이 다섯 모양 중 하나, 같은 입력은 같은 결과, memo는 한글 음절 2~10자·숫자 없음', () => {
    fc.assert(
      fc.property(from, text, options, (f, t, o) => {
        const result = parseSmsText({ from: f, text: t }, o)
        expectShape(result)
        expect(parseSmsText({ from: f, text: t }, { ...o })).toEqual(result)
      }),
      { numRuns: 400 },
    )
  })

  it('번호는 1..maxNumber 안이고 메시지 순서·같은 번호 하나', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1200 }), { minLength: 1, maxLength: 7 }), fc.integer({ min: 1, max: 999 }), (numbers, max) => {
        const result = read(numbers.join(' '), PHONE, { maxNumber: max }) as Record<string, unknown>
        expectShape(result)
        for (const key of ['claims', 'cancels', 'review']) {
          if (!(key in result)) continue
          const list = result[key] as number[]
          for (const n of list) expect(n <= max).toBe(true)
          const order = list.map((n) => numbers.findIndex((m) => m === n))
          expect([...order].sort((a, b) => a - b)).toEqual(order)
        }
      }),
    )
  })
})
