// SMS3 적대 시험 (test-domain): 문자 읽기 R-26 `parseSmsText` 속성 시험 — AC-SMS3-02 [domain].
// 기대는 규칙 문장(DOMAIN_RULES R-26)만으로 이 파일 안에서 정한다(구현을 보지 않는다).
// (1) 어떤 입력에도 예외 없이 다섯 모양 중 하나(키 모양까지) (2) 같은 입력 = 같은 결과, 넘긴 값을 바꾸지 않음
// (3) memo는 늘 한글 음절 2~10자, 숫자 없음 (4) 휴대폰 아님(숫자·기호만, 휴대폰 번호가 아님) → 본문과 상관없이 NOT_MOBILE
// (5) 거를 낱말(대소문자 무시) → EXCLUDED (6) 이름만 온 문자는 바로 넣는 문자찜이 되지 않음 (7) 옵션 방송은 늘 확인 필요
// (8) LOOSE 방송도 STRICT와 같은 결과 (9) 같은 휴대폰 번호의 여러 표기(+82·전각·하이픈)는 같은 결과
// (10) 번호는 1..maxNumber, 같은 번호 하나, 확인 필요 후보는 빈 목록이 아님.
import { parseSmsText, type SmsTextResult } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const RUNS = { numRuns: 400 } as const

const HANGUL_NAME_RE = /^[가-힣]{2,10}$/u
const SKIP_WORDS = ['(광고)', '[광고]', 'web발신', '국제발신', '해외발신', '인증', '승인', '결제', '택배']

/** 결과가 R-26 다섯 모양 중 하나인지 (키 모양까지) — 틀리면 까닭 글 */
function shapeProblem(result: unknown, maxNumber = 999): string | null {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return '객체가 아님'
  const record = result as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const numbersOk = (value: unknown, min: number): boolean =>
    Array.isArray(value) &&
    value.length >= min &&
    value.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= maxNumber) &&
    new Set(value).size === value.length
  const memoOk = (): boolean => !('memo' in record) || (typeof record.memo === 'string' && HANGUL_NAME_RE.test(record.memo) && !/[0-9０-９]/u.test(record.memo))
  if (keys.length === 0) return null
  if ('skip' in record) return keys.length === 1 && (record.skip === 'NOT_MOBILE' || record.skip === 'EXCLUDED') ? null : `거름 모양: ${JSON.stringify(record)}`
  if ('claims' in record) return keys.every((k) => k === 'claims' || k === 'memo') && numbersOk(record.claims, 1) && memoOk() ? null : `문자찜 모양: ${JSON.stringify(record)}`
  if ('cancels' in record) return keys.every((k) => k === 'cancels' || k === 'memo') && numbersOk(record.cancels, 1) && memoOk() ? null : `취소 요청 모양: ${JSON.stringify(record)}`
  if ('review' in record) {
    const whyOk = record.why === 'UNCLEAR' || record.why === 'NO_NUMBER' || record.why === 'OPTIONS'
    // 확인 필요 후보는 R-3 언급 그대로라 전화번호 조각도 들어갈 수 있다 — 범위는 1..maxNumber만 본다
    return keys.every((k) => k === 'review' || k === 'why' || k === 'memo') && whyOk && numbersOk(record.review, 1) && memoOk() ? null : `확인 필요 모양: ${JSON.stringify(record)}`
  }
  return `모르는 모양: ${JSON.stringify(record)}`
}

// ── 생성기 ──────────────────────────────────────────────────────────────

const loneSurrogate = fc.integer({ min: 0xd800, max: 0xdfff }).map((code) => String.fromCharCode(code))
const control = fc.integer({ min: 0, max: 0x1f }).map((code) => String.fromCharCode(code))
const weird = fc.constantFrom('​', '‍', '﻿', '　', ' ', ' ', '‮', '\t', '\n', '\r\n', '😀', '👍🏻', '🌱', '💕', '❓', '♡', '♥', 'ㅋㅋ', 'ㅎ', '~', '^', '!', '.', '?', '<script>', '&amp;', '"', '\\')
const korean = fc.constantFrom('홍길동', '김영희', '다육이맘', '남궁민수', '민지예요', '홍길동입니다', '취소', '찜', '있나요', '아니요', '얼마예요', '감사합니다', '번', '주세요', '택배', '인증', '입금', '신한', '국민은행', '잔액', '원', '이요', '님')
const numberish = fc.oneof(
  fc.integer({ min: 0, max: 12_000 }).map(String),
  fc.constantFrom('７７５', '0775', '15,28,31', '775,776,777', '14,000', '1,028,000', '010-1234-5678', '01012345678', '1588-9999', '+82', '15번', '775번이요', '1 2 3 4 5 6', '-15', '1e3', '1.5', '9999', '10000', '０'),
)
const token = fc.oneof(numberish, korean, weird, control, loneSurrogate, fc.string({ maxLength: 6 }), fc.string({ unit: 'binary', maxLength: 4 }))
const text = fc.oneof(
  fc.array(token, { maxLength: 12 }).chain((parts) => fc.constantFrom(' ', '', '\n', '  ').map((sep) => parts.join(sep))),
  fc.string({ maxLength: 60 }),
  fc.string({ unit: 'binary', maxLength: 60 }),
)

/** 휴대폰 번호 표기 여럿 (R-26 1 보낸 번호 정리로 모두 01012345678) */
const MOBILE_FORMS = ['010-1234-5678', '01012345678', '010 1234 5678', '(010)1234-5678', '+82 10-1234-5678', '+821012345678', '  +82-10-1234-5678', '０１０-１２３４-５６７８', '+82 010-1234-5678']
/** 휴대폰 아님: 숫자를 담고 숫자·공백·+-().#*만 — 휴대폰 번호가 아님 */
const NOT_MOBILE_FORMS = ['1588-9999', '15889999', '02-123-4567', '070-1234-5678', '080-123-4567', '#1234', '*77', '+82', '+82 1588-9999', '+1 (555) 010-1234', '1234', '0000000000000000000000000000000000000000', '01-1234-567', '0101-23']
/** 이름만: 글자가 섞인 보낸 곳, 빈 글, null */
const NAME_FORMS: (string | null)[] = [null, '', '   ', '홍길동', '엄마', 'Kim', '홍길동 010-1234-56', '고객센터', 'KB국민은행', '😀']

const fromArb = fc.oneof(
  fc.constantFrom<string | null>(...MOBILE_FORMS, ...NOT_MOBILE_FORMS, ...NAME_FORMS),
  fc.string({ maxLength: 20 }),
  fc.stringMatching(/^[0-9]{1,40}$/),
  fc.constant(null),
)

const optionsArb = fc.record(
  {
    parseMode: fc.constantFrom('STRICT', 'LOOSE', 'OPTIONS', 'BOGUS' as never),
    multiNumber: fc.constantFrom('ALL', 'FIRST', 'IGNORE', 'nope' as never),
    maxNumber: fc.oneof(fc.integer({ min: 1, max: 9999 }), fc.constantFrom(0, -1, 1.5, 10_000, Number.NaN, Number.POSITIVE_INFINITY)),
  },
  { requiredKeys: [] },
)

/** 넘긴 설정에서 실제로 쓰는 maxNumber (설정표 범위 1~9999 정수가 아니면 기본 999) */
const effectiveMax = (options: { maxNumber?: number }): number => {
  const value = options.maxNumber
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : 999
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

describe('AC-SMS3-02 parseSmsText — 예외 없음·모양·결정성', () => {
  it('임의 글·임의 보낸 곳·임의 설정에도 예외 없이 다섯 모양 중 하나, 같은 입력은 같은 결과, 넘긴 값을 바꾸지 않는다', () => {
    fc.assert(
      fc.property(fromArb, text, optionsArb, (from, body, options) => {
        const input = deepFreeze({ from, text: body })
        const frozenOptions = deepFreeze({ ...options })
        let first: SmsTextResult
        let second: SmsTextResult
        expect(() => {
          first = parseSmsText(input, frozenOptions)
          second = parseSmsText({ from, text: body }, { ...options })
        }).not.toThrow()
        expect(shapeProblem(first!, effectiveMax(options))).toBeNull()
        expect(second!).toEqual(first!)
      }),
      RUNS,
    )
  })

  it('제어 문자·짝 잃은 서로게이트·10만 자·이모지 연속·숫자만 40자리 보낸 곳·+82만·null·글이 아닌 값에도 예외가 없다', () => {
    const bodies = [
      '\u0000\u0001\u0002 775 \u001f',
      '\ud800775\udc00 홍길동',
      '775 \udfff',
      '😀'.repeat(50_000),
      '7'.repeat(100_000),
      `775 ${'홍'.repeat(100_000)}`,
      `${'775 '.repeat(25_000)}`,
      '‮577 동길홍',
      '💕'.repeat(1000) + '775',
    ]
    const froms: unknown[] = ['1'.repeat(40), '+82', null, undefined, 12_345, {}, [], '\ud800', '０'.repeat(40)]
    for (const body of bodies) {
      for (const from of froms) {
        const result = parseSmsText({ from: from as string | null, text: body })
        expect(shapeProblem(result)).toBeNull()
      }
    }
    // 입력 자체가 이상해도 (전체 함수)
    for (const odd of [null, undefined, 1, 'text', [], { text: 775 }, { from: 1, text: null }]) {
      expect(shapeProblem(parseSmsText(odd as never))).toBeNull()
      expect(shapeProblem(parseSmsText({ from: null, text: '775' }, odd as never))).toBeNull()
    }
  })

  it('10만 자 글도 오래 걸리지 않는다 (2초 안 — 기기 입구는 1,000자로 자르지만 함수는 전체 함수다)', () => {
    const started = performance.now()
    parseSmsText({ from: '010-1234-5678', text: `${'775 홍길동 '.repeat(12_000)}` })
    parseSmsText({ from: '010-1234-5678', text: `${'1,'.repeat(50_000)}` })
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('R-26 규칙 문장 속성', () => {
  it('memo는 늘 한글 음절 2~10자이고 숫자를 담지 않는다 (휴대폰 번호를 담을 수 없다)', () => {
    fc.assert(
      fc.property(fromArb, text, (from, body) => {
        const result = parseSmsText({ from, text: body }) as { memo?: unknown }
        if ('memo' in result) {
          expect(typeof result.memo).toBe('string')
          expect(result.memo).toMatch(HANGUL_NAME_RE)
        }
      }),
      RUNS,
    )
  })

  it('휴대폰 아님(숫자·기호만, 휴대폰 번호 아님)에서 온 문자는 본문과 상관없이 NOT_MOBILE', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NOT_MOBILE_FORMS), text, (from, body) => {
        expect(parseSmsText({ from, text: body })).toEqual({ skip: 'NOT_MOBILE' })
      }),
      RUNS,
    )
  })

  it('거를 낱말(영문 대소문자 무시)이 든 손님 문자는 EXCLUDED — 확실한 문자찜 모양이어도', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SKIP_WORDS), fc.constantFrom('775', '775 홍길동', '15 취소', '15 있나요?', ''), fc.boolean(), fc.constantFrom(...MOBILE_FORMS, ...NAME_FORMS), (word, body, upper, from) => {
        const w = upper ? word.toUpperCase() : word
        expect(parseSmsText({ from, text: `${body} ${w}` })).toEqual({ skip: 'EXCLUDED' })
        expect(parseSmsText({ from, text: `${w}${body}` })).toEqual({ skip: 'EXCLUDED' })
      }),
      RUNS,
    )
    // 전각 영문 "ＷＥＢ발신"은 R-3 정규화가 전각 숫자만 바꾸므로 거를 낱말이 아니다 — 규칙 문장 그대로인지만 본다
    expect(parseSmsText({ from: '010-1234-5678', text: '[Web발신] 775' })).toEqual({ skip: 'EXCLUDED' })
    expect(parseSmsText({ from: '010-1234-5678', text: '[WEB발신]\n775' })).toEqual({ skip: 'EXCLUDED' })
  })

  it('이름만 온 문자(null·빈 글·글자 섞인 보낸 곳)는 결코 바로 넣는 문자찜이 되지 않는다 — 문자찜 모양이면 NO_NUMBER 확인 필요', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NAME_FORMS), text, optionsArb, (from, body, options) => {
        const result = parseSmsText({ from, text: body }, options)
        expect('claims' in result).toBe(false)
        const asMobile = parseSmsText({ from: '010-1234-5678', text: body }, options)
        if ('claims' in asMobile) expect(result).toEqual({ review: asMobile.claims, why: 'NO_NUMBER', ...('memo' in asMobile ? { memo: asMobile.memo } : {}) })
      }),
      RUNS,
    )
  })

  it('옵션 방송(parseMode OPTIONS)은 문자찜·취소 요청이 되지 않고 늘 확인 필요 OPTIONS(또는 거름·찜 아님)', () => {
    fc.assert(
      fc.property(fromArb, text, (from, body) => {
        const result = parseSmsText({ from, text: body }, { parseMode: 'OPTIONS' })
        expect('claims' in result || 'cancels' in result).toBe(false)
        if ('review' in result) expect(result.why).toBe('OPTIONS')
      }),
      RUNS,
    )
  })

  it('LOOSE 방송도 STRICT와 같은 결과 (문자는 늘 STRICT)', () => {
    fc.assert(
      fc.property(fromArb, text, fc.constantFrom('ALL', 'FIRST', 'IGNORE' as const), fc.integer({ min: 1, max: 9999 }), (from, body, multiNumber, maxNumber) => {
        expect(parseSmsText({ from, text: body }, { parseMode: 'LOOSE', multiNumber, maxNumber })).toEqual(parseSmsText({ from, text: body }, { parseMode: 'STRICT', multiNumber, maxNumber }))
      }),
      RUNS,
    )
  })

  it('같은 휴대폰 번호의 여러 표기(+82·전각·하이픈·괄호)는 같은 결과', () => {
    fc.assert(
      fc.property(text, (body) => {
        const expected = parseSmsText({ from: '01012345678', text: body })
        for (const from of MOBILE_FORMS) expect(parseSmsText({ from, text: body })).toEqual(expected)
      }),
      RUNS,
    )
  })

  it('번호 범위: 문자찜·취소 요청의 번호는 1..maxNumber, 확실한 문자찜은 서로 다른 번호 5개까지', () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 1, max: 9999 }), (body, maxNumber) => {
        const result = parseSmsText({ from: '010-1234-5678', text: body }, { maxNumber })
        expect(shapeProblem(result, maxNumber)).toBeNull()
        if ('claims' in result) expect(result.claims.length).toBeLessThanOrEqual(5)
      }),
      RUNS,
    )
    expect(parseSmsText({ from: '010-1234-5678', text: '15' }, { maxNumber: 14 })).not.toHaveProperty('claims')
    expect(parseSmsText({ from: '010-1234-5678', text: '15' }, { maxNumber: 15 })).toEqual({ claims: [15] })
  })
})

describe('R-26 적대 사례 (은행 흉내·이름 흉내·취소 흉내)', () => {
  const MOBILE = '010-2222-3333'

  it('휴대폰에서 온 은행 모양 글은 문자찜·취소가 되지 않는다(번호가 금액 모양뿐)', () => {
    for (const body of ['[KB] 홍길동 입금 14,000', '[Web발신] 신한10/31 20:05 110-***-123456 입금 14,000 잔액 1,028,000 김영희', '입금 14,000원 김영희', '신한 입금취소 14,000 홍길동', '1,028,000원 입금되었습니다']) {
      const result = parseSmsText({ from: MOBILE, text: body })
      expect('claims' in result || 'cancels' in result, `${body} → ${JSON.stringify(result)}`).toBe(false)
    }
  })

  it('이름 흉내: 이름 칸에 숫자·영문·이모지·띄어 쓴 이름·한 글자·문장 끝·묻는 말이 오면 memo 없이 확인 필요', () => {
    for (const body of ['775 홍길동1', '775 Kim', '775 홍길동😀', '775 홍 길동', '775 홍', '775 예뻐요', '775 있어요', '775 얼마', '775 아니', '775 몇개']) {
      const result = parseSmsText({ from: MOBILE, text: body }) as Record<string, unknown>
      expect(result.memo, `${body} → ${JSON.stringify(result)}`).toBeUndefined()
      expect('claims' in result, `${body} → ${JSON.stringify(result)}`).toBe(false)
    }
  })

  it('취소 흉내: 취소 요청은 번호 하나 — 여러 번호 취소·취소가 앞에 온 글은 확인 필요(승인 없이 취소되는 길이 없다)', () => {
    expect(parseSmsText({ from: MOBILE, text: '15 16 취소' })).toEqual({ review: [15, 16], why: 'UNCLEAR' })
    expect(parseSmsText({ from: MOBILE, text: '취소 15' })).toEqual({ review: [15], why: 'UNCLEAR' })
    expect(parseSmsText({ from: MOBILE, text: '15 취소' })).toEqual({ cancels: [15] })
    // 이름만 온 취소 요청은 그대로 취소 요청(승인은 늘 판매자 — 서버가 번호를 몰라 승인해도 찜이 없다)
    expect(parseSmsText({ from: '홍길동', text: '15 취소' })).toEqual({ cancels: [15] })
  })

  it('보낸 곳 40자리 숫자·+82만·숫자 없는 기호만', () => {
    expect(parseSmsText({ from: '1'.repeat(40), text: '775' })).toEqual({ skip: 'NOT_MOBILE' })
    expect(parseSmsText({ from: '+82', text: '775' })).toEqual({ skip: 'NOT_MOBILE' })
    // 숫자가 하나도 없으면 휴대폰 아님이 아니다 → 이름만 → 문자찜은 NO_NUMBER
    expect(parseSmsText({ from: '+-()', text: '775' })).toEqual({ review: [775], why: 'NO_NUMBER' })
    expect(parseSmsText({ from: '', text: '775' })).toEqual({ review: [775], why: 'NO_NUMBER' })
  })
})
