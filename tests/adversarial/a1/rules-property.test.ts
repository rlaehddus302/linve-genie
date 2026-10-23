// A1 적대 시험 (test-domain, AC-A1-30): 서버의 순수 함수(가리기·응답 검사)를 무작위 입력으로 공격한다. 통과한 공격은 회귀로 남긴다.
// - 가리기(R-20 10 "가리기"): 어떤 글에도 예외 없음, 200글자 이하, '@'가 든 덩어리 없음, 두 번 가려도 같음.
//   스펙의 구분자(공백·'-'·'.' 하나씩, 정규화가 한 칸으로 줄이는 공백 — 탭·줄바꿈·NBSP·전각 공백)와 전각 숫자로 적은 휴대폰 번호는
//   보낼 글에 "이어진 숫자 7개 이상"(같은 기준)으로 남지 않는다.
// - 응답 검사(R-20 10 "응답 검사"): 아무 JSON·아무 글에도 예외 없음, 나온 제안은 늘 목록의 상품·읽은 번호·모든 항목의 선택지 이름·수량 1~최대.
//   깊은 중첩·큰 글·__proto__·constructor·1e1·NaN 모양 글은 제안 없음.
import { compareChars, normalizeText, type OptionCatalogEntry } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { redact, validateResponse, type SentItem } from '../../../apps/server/src/assist/rules.ts'

/** 스펙 기준의 이어진 숫자: 숫자 사이에 공백·'-'·'.'이 하나씩 끼어도 이어진 것으로 보고 가장 긴 숫자 수 */
function longestDigitRun(text: string): number {
  let best = 0
  let digits = 0
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c >= '0' && c <= '9') {
      digits++
      best = Math.max(best, digits)
      i++
      continue
    }
    const next = text[i + 1]
    if ((c === ' ' || c === '-' || c === '.') && digits > 0 && next !== undefined && next >= '0' && next <= '9') {
      i++
      continue
    }
    digits = 0
    i++
  }
  return best
}

const FULLWIDTH = (digit: string) => String.fromCharCode(digit.charCodeAt(0) - 0x30 + 0xff10)

/** 스펙이 이어진 숫자로 보는 구분자(정규화 앞 모양) — 정규화가 한 칸으로 줄이는 공백 포함 */
const SPEC_SEPARATOR = fc.constantFrom('', ' ', '-', '.', '\t', '\n', ' ', '　', '  ', ' \n ')
const KOREAN_WORD = fc.constantFrom('반바지', '엠사이즈', '미디엄', '번호', '연락주세요', '입금자', '주문', '요', '')
const ATTACH = fc.constantFrom(' ', '', '　')

const phoneText = fc
  .record({
    prefix: KOREAN_WORD,
    before: ATTACH,
    head: fc.constantFrom('010', '011', '016', '017', '019'),
    mid: fc.stringMatching(/^[0-9]{3,4}$/),
    tail: fc.stringMatching(/^[0-9]{4}$/),
    sep1: SPEC_SEPARATOR,
    sep2: SPEC_SEPARATOR,
    wide: fc.array(fc.boolean(), { minLength: 11, maxLength: 11 }),
    after: ATTACH,
    suffix: KOREAN_WORD,
  })
  .map((parts) => {
    let at = 0
    const widen = (digits: string) =>
      Array.from(digits)
        .map((digit) => (parts.wide[at++] === true ? FULLWIDTH(digit) : digit))
        .join('')
    const phone = `${widen(parts.head)}${parts.sep1}${widen(parts.mid)}${parts.sep2}${widen(parts.tail)}`
    return { text: `${parts.prefix}${parts.before}${phone}${parts.after}${parts.suffix}`, digits: `${parts.head}${parts.mid}${parts.tail}` }
  })

describe('가리기 — 아무 글 (R-20 10, AC-A1-30)', () => {
  it('예외 없음 · 코드 포인트 200개 이하 · @가 든 덩어리 없음 · 두 번 가려도 같음 · 정규화된 글', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary', maxLength: 400 }), fc.string({ unit: fc.constantFrom('0', '1', '5', ' ', '-', '.', '@', '반', '\u200b', '\uff10', '　'), maxLength: 300 })), (text) => {
        const out = redact(text)
        expect(Array.from(out).length).toBeLessThanOrEqual(200)
        expect(out.split(' ').some((chunk) => chunk.includes('@'))).toBe(false)
        expect(redact(out)).toBe(out)
        expect(normalizeText(out)).toBe(out)
        expect(longestDigitRun(out)).toBeLessThan(7)
      }),
      { numRuns: 500 },
    )
  })

  it('신뢰할 수 없는 값(문자열이 아님)도 예외 없이 빈 글', () => {
    for (const value of [null, undefined, 1, {}, [], Symbol('x')]) expect(redact(value as unknown as string)).toBe('')
  })
})

describe('가리기 — 스펙 구분자·전각 숫자로 적은 휴대폰 번호 (R-20 10, AC-A1-30)', () => {
  it('보낼 글에 이어진 숫자 7개 이상이 남지 않고, 번호 원문(숫자만 모은 것)이 없다', () => {
    fc.assert(
      fc.property(phoneText, ({ text, digits }) => {
        const out = redact(text)
        expect(longestDigitRun(out), `${JSON.stringify(text)} → ${JSON.stringify(out)}`).toBeLessThan(7)
        expect(out.replace(/[^0-9]/g, '')).not.toContain(digits.slice(-7))
      }),
      { numRuns: 400 },
    )
  })

  it('대표 사례: 탭·줄바꿈·NBSP·전각 공백·두 칸·전각 숫자·한글에 붙음·여러 번호', () => {
    const cases = [
      '반바지 엠사이즈\t010\t1234\t5678',
      '반바지\n010\n1234\n5678\n입금자',
      '반바지 010 1234 5678',
      '반바지 \uff10１\uff10　１２３４　５６７８',
      '반바지 010  1234  5678',
      '입금자010-1234-5678반바지',
      '반바지 010-1234-5678 010.9876.5432 01011112222',
      '반바지 엠사이즈 연락처는 010 - 1234-5678',
    ]
    for (const text of cases) {
      const out = redact(text)
      expect(longestDigitRun(out), `${text} → ${out}`).toBeLessThan(7)
      expect(out).not.toContain('5678')
    }
  })

  it('@ 부르기·이메일 덩어리는 어느 자리에 있어도 빠진다 (탭·줄바꿈으로 나눠도)', () => {
    expect(redact('반바지\t@홍길동\n미디엄')).toBe('반바지 미디엄')
    expect(redact('홍길동@naver.com 반바지')).toBe('반바지')
    expect(redact('반바지 미디엄 @@')).toBe('반바지 미디엄')
    expect(redact('@a @b @c')).toBe('')
  })
})

// ── 응답 검사 ─────────────────────────────────────────────────────────

const CATALOG: OptionCatalogEntry[] = [
  { no: 11, name: '초코 과자' },
  { no: 21, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }] }] },
  {
    no: 31,
    name: '수건',
    options: [
      { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정' }] },
      { name: '크기', choices: [{ label: '대형' }] },
    ],
  },
]

/** 나온 제안이 스펙을 지키는지 */
function expectValid(sent: SentItem, suggestion: unknown, maxQuantity: number): void {
  if (suggestion === null) return
  const s = suggestion as { no: number; options?: Record<string, string>; qty: number }
  expect(Object.keys(s).every((key) => ['no', 'options', 'qty'].includes(key))).toBe(true)
  const product = CATALOG.find((entry) => entry.no === s.no)
  expect(product).toBeDefined()
  if (sent.no !== undefined) expect(s.no).toBe(sent.no)
  expect(Number.isSafeInteger(s.qty) && s.qty >= 1 && s.qty <= maxQuantity).toBe(true)
  const items = product?.options ?? []
  if (items.length === 0) {
    expect(s.options).toBeUndefined()
    return
  }
  expect(Object.getPrototypeOf(s.options)).toBe(Object.prototype)
  expect(Object.keys(s.options ?? {})).toEqual(items.map((item) => item.name))
  for (const item of items) expect(item.choices.map((choice) => choice.label)).toContain(s.options?.[item.name])
}

const SENT: SentItem[] = [{ id: '1', no: 21 }, { id: '2' }, { id: '3', no: 31 }]

const lineArb = fc.record(
  {
    id: fc.oneof(fc.constantFrom('1', '2', '3', '4', '__proto__', 'constructor'), fc.integer(), fc.string()),
    no: fc.oneof(fc.constantFrom(11, 21, 31, 99, 0, -21, 21.5), fc.string(), fc.constant(null)),
    options: fc.oneof(
      fc.dictionary(fc.constantFrom('사이즈', '색상', '크기', '__proto__', 'constructor', 'toString', '사 이 즈'), fc.oneof(fc.constantFrom('S', 'M', 'm', '미디움', ' M ', '화이트', '흰색', '검정', '대형', 'XL', ''), fc.integer(), fc.constant(null))),
      fc.constant([]),
      fc.string(),
    ),
    qty: fc.oneof(fc.integer({ min: -3, max: 15 }), fc.constantFrom(1.5, Number.MAX_SAFE_INTEGER + 2), fc.constantFrom('2', 'NaN', '1e1', 'Infinity')),
    extra: fc.anything(),
  },
  { requiredKeys: [] },
)

describe('응답 검사 — 무작위 답 (R-20 10, AC-A1-06·30)', () => {
  it('제안 줄 모양의 무작위 답: 예외 없음, 나온 제안은 늘 목록·읽은 번호·모든 항목 선택지 이름·수량 범위', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 6 }), fc.integer({ min: 1, max: 99 }), fc.boolean(), (lines, maxQuantity, pretty) => {
        const text = JSON.stringify({ suggestions: lines }, null, pretty ? 2 : undefined)
        const out = validateResponse(SENT, text, CATALOG, maxQuantity)
        expect(Object.keys(out).sort()).toEqual(['1', '2', '3'])
        for (const sent of SENT) expectValid(sent, out[sent.id], maxQuantity)
      }),
      { numRuns: 600 },
    )
  })

  it('아무 JSON·아무 글: 예외 없음, 보낸 id마다 null 또는 올바른 제안', () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue().map((value) => JSON.stringify(value)), fc.string(), fc.jsonValue().map((value) => JSON.stringify({ suggestions: value }))), (text) => {
        const out = validateResponse(SENT, text, CATALOG, 10)
        for (const sent of SENT) expectValid(sent, out[sent.id], 10)
      }),
      { numRuns: 400 },
    )
  })

  it('깊은 중첩(배열·객체 수만 겹)·64KB 가까운 글에도 예외 없이 모두 제안 없음', () => {
    const depth = 30_000
    const texts = [
      `{"suggestions":[${'['.repeat(depth)}${']'.repeat(depth)}]}`,
      `{"suggestions":[{"id":"1","no":21,"options":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)},"qty":1}]}`,
      `{"suggestions":[{"id":"1","no":21,"options":{"사이즈":"M"},"qty":1,"x":${'['.repeat(depth)}${']'.repeat(depth)}}]}`,
      `{"suggestions":[{"id":"1","no":21,"options":{"사이즈":"${'M'.repeat(60_000)}"},"qty":1}]}`,
    ]
    for (const text of texts) {
      const out = validateResponse(SENT, text, CATALOG, 10)
      expect(out).toEqual({ '1': null, '2': null, '3': null })
    }
  })

  it('__proto__·constructor·1e1·10.0·-0·NaN 모양·문자 숫자는 그 항목 제안 없음, 다른 항목은 그대로', () => {
    const good = '{"id":"3","no":31,"options":{"색상":"화이트"},"qty":2}'
    const bads = [
      '{"id":"1","no":21,"options":{"사이즈":"M"},"qty":1e1}',
      '{"id":"1","no":21,"options":{"사이즈":"M"},"qty":10.0}',
      '{"id":"1","no":21,"options":{"사이즈":"M"},"qty":-0}',
      '{"id":"1","no":21,"options":{"사이즈":"M"},"qty":"NaN"}',
      '{"id":"1","no":"21","options":{"사이즈":"M"},"qty":1}',
      '{"id":"1","no":21,"options":{"사이즈":"M","__proto__":{"x":1}},"qty":1}',
      '{"id":"1","no":21,"options":{"사이즈":"M"},"qty":1,"constructor":{"prototype":{}}}',
      '{"id":"1","no":21,"options":{"constructor":"M"},"qty":1}',
      '{"id":"1","no":21,"options":{"사이즈":"toString"},"qty":1}',
      '{"id":"1","no":21,"options":{"사이즈":"__proto__"},"qty":1}',
      '{"id":"1","no":21,"__proto__":{"qty":1},"options":{"사이즈":"M"}}',
    ]
    for (const bad of bads) {
      const out = validateResponse(SENT, `{"suggestions":[${bad},${good}]}`, CATALOG, 10)
      expect(out['1'], bad).toBeNull()
      expect(out['3'], bad).toEqual({ no: 31, options: { 색상: '흰색', 크기: '대형' }, qty: 2 })
      expect(({} as Record<string, unknown>).x).toBeUndefined()
      expect(({} as Record<string, unknown>).qty).toBeUndefined()
    }
  })

  it('별칭·대소문자·공백으로 답해도 선택지 이름(label)으로 바뀐다 — 비교 글자 기준', () => {
    const out = validateResponse([{ id: '1', no: 21 }], '{"suggestions":[{"id":"1","no":21,"options":{"사이즈":" 미 디 움 "},"qty":3}]}', CATALOG, 10)
    expect(out['1']).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 3 })
    expect(compareChars(' 미 디 움 ')).toBe('미디움')
    const lower = validateResponse([{ id: '1', no: 21 }], '{"suggestions":[{"id":"1","no":21,"options":{"사이즈":"m"},"qty":1}]}', CATALOG, 10)
    expect(lower['1']).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 1 })
  })
})
