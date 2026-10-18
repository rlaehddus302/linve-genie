// 파서 4종의 공통 성질: 순수·전체 함수(AC-S01-02), 적대 입력에도 시간이 폭주하지 않음(AC-S01-03).
import { performance } from 'node:perf_hooks'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAmount, parseChat, parseKoreanNumber, parseQuickInput, type SettingsOverride } from '@livejjim/core'

/** 짝 없는 서로게이트까지 포함한 아무 UTF-16 문자열 */
const utf16 = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 }).map((codes) => String.fromCharCode(...codes))
const anyText = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 20 }),
  utf16,
  fc.constantFrom('', ' ', '\t\n\r', '\u0000\u0007\u001b', '\uD800', '\uDFFF15', '15\uD83D', '\u200B\u200E\u00A0', '👨\u200D👩\u200D👧\u200D👦', '1\uFE0F\u20E35\uFE0F\u20E3', 'x'.repeat(10000)),
)
const settings = fc.record(
  {
    'claim.parseMode': fc.constantFrom('STRICT' as const, 'LOOSE' as const),
    'claim.multiNumber': fc.constantFrom('ALL' as const, 'FIRST' as const, 'IGNORE' as const),
    'claim.maxNumber': fc.integer({ min: 1, max: 9999 }),
    'price.unit': fc.constantFrom('WON' as const, 'THOUSAND' as const),
  },
  { requiredKeys: [] },
)

function expectChatShape(result: unknown): void {
  expect(result).toBeTypeOf('object')
  const record = result as Record<string, unknown>
  expect(Object.keys(record).sort()).toEqual(['cancels', 'claims', 'mentions'])
  for (const list of Object.values(record)) {
    expect(Array.isArray(list)).toBe(true)
    for (const n of list as unknown[]) expect(Number.isInteger(n)).toBe(true)
  }
}

function expectAmountShape(result: unknown): void {
  if (result !== null) {
    expect(Number.isSafeInteger(result)).toBe(true)
    expect(result as number).toBeGreaterThanOrEqual(0)
  }
}

function expectKoreanNumberShape(result: unknown): void {
  if (result !== null) {
    expect(Number.isInteger(result)).toBe(true)
    expect(result as number).toBeGreaterThanOrEqual(1)
    expect(result as number).toBeLessThanOrEqual(9999)
  }
}

describe('AC-S01-02 순수·전체 함수', () => {
  it('아무 문자열에도 예외 없이 정해진 결과 모양, 같은 입력·설정이면 같은 결과, 설정 객체를 바꾸지 않는다', () => {
    fc.assert(
      fc.property(anyText, settings, (text, raw) => {
        // 얼린 설정: 파서가 설정을 바꾸려 하면 (ESM은 엄격 모드라) 예외가 난다
        const config: SettingsOverride = Object.freeze({ ...raw })
        const before = JSON.stringify(config)
        const chat = parseChat(text, config)
        const amount = parseAmount(text, config)
        const korean = parseKoreanNumber(text)
        const quick = parseQuickInput(text, config)
        expectChatShape(chat)
        expectAmountShape(amount)
        expectKoreanNumberShape(korean)
        expect(quick).toBeTypeOf('object')
        // 같은 입력 → 같은 결과 (다른 입력을 사이에 넣어도 남는 상태가 없다)
        parseChat('15 28', config)
        parseQuickInput('15 핑크 10', config)
        expect(parseChat(text, config)).toStrictEqual(chat)
        expect(parseAmount(text, config)).toBe(amount)
        expect(parseKoreanNumber(text)).toBe(korean)
        expect(parseQuickInput(text, config)).toStrictEqual(quick)
        expect(JSON.stringify(config)).toBe(before)
      }),
      { numRuns: 3000 },
    )
  })

  it('결과 배열·객체는 호출마다 새것이다 (호출한 쪽이 바꿔도 다음 결과에 번지지 않는다)', () => {
    const first = parseChat('15 28') as unknown as { claims: number[] }
    first.claims.push(99)
    expect(parseChat('15 28').claims).toEqual([15, 28])
    const quick = parseQuickInput('15 핑크 10') as unknown as { name: string }
    quick.name = '바뀜'
    expect(parseQuickInput('15 핑크 10')).toStrictEqual({ no: 15, name: '핑크', price: 10000 })
  })

  it('문자열이 아닌 값·이상한 설정이 와도 예외를 던지지 않는다 (신뢰할 수 없는 입력)', () => {
    const weird: unknown[] = [undefined, null, 15, {}, [], Symbol('x'), () => '15']
    for (const value of weird) {
      const text = value as string
      expect(parseChat(text)).toStrictEqual({ claims: [], cancels: [], mentions: [] })
      expect(parseAmount(text)).toBeNull()
      expect(parseKoreanNumber(text)).toBeNull()
      expect(parseQuickInput(text)).toStrictEqual({ error: 'EMPTY' })
    }
    const odd = [null, 'LOOSE', 1, { 'claim.maxNumber': Number.NaN }, { 'claim.parseMode': 'X', 'claim.multiNumber': 'Y', 'price.unit': 'Z' }]
    for (const config of odd) {
      const settingsValue = config as SettingsOverride
      expectChatShape(parseChat('15 28', settingsValue))
      expectAmountShape(parseAmount('10', settingsValue))
      expect(parseQuickInput('15 핑크 10', settingsValue)).toBeTypeOf('object')
    }
  })
})

describe('AC-S01-03 적대 입력에도 시간이 폭주하지 않는다', () => {
  const LIMIT_MS = 1000
  const fill = (unit: string, length = 10000): string => unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
  const adversarial: ReadonlyArray<readonly [string, string]> = [
    ['"1 " 반복', fill('1 ')],
    ['"1," 반복', fill('1,')],
    ['"15"+"!" 반복', `15${fill('!')}`],
    ['"❤\uFE0F" 반복', fill('❤\uFE0F')],
    ['"찜 " 반복 뒤 "15"', `${fill('찜 ')}15`],
    ['"1번 " 반복 뒤 "?"', `${fill('1번 ')}?`],
    ['"만" 반복', fill('만')],
    ['"십" 반복', fill('십')],
    ['"15 "+"핑크 " 반복 뒤 "10"', `15 ${fill('핑크 ')}10`],
    ['"0" 반복 뒤 "1"', `${fill('0')}1`],
    ['"1." 반복', fill('1.')],
    ['"1.0" 뒤 "0" 반복 뒤 "1"', `1.${fill('0')}1`],
    ['"1," 반복 뒤 "000"', `${fill('1,')}000`],
    ['"123," 반복', fill('123,')],
    ['"15 " 반복 뒤 "취소"', `${fill('15 ')}취소`],
    ['"15번 " 반복 뒤 "ㅋ" 반복', `${fill('15번 ', 5000)}${fill('ㅋ', 5000)}`],
    ['"\\u200D" 반복', `15${fill('\u200D')}`],
    ['"만 " 반복 뒤 "원"', `${fill('만 ')}원`],
    ['"1만 " 반복', fill('1만 ')],
    ['숫자 10000자', fill('7')],
    ['"15 1만 " 반복', `15 ${fill('1만 ')}`],
  ]

  const callers: ReadonlyArray<readonly [string, (text: string) => unknown]> = [
    ['parseChat STRICT', (text) => parseChat(text, { 'claim.parseMode': 'STRICT' })],
    ['parseChat LOOSE', (text) => parseChat(text, { 'claim.parseMode': 'LOOSE' })],
    ['parseAmount', (text) => parseAmount(text)],
    ['parseKoreanNumber', (text) => parseKoreanNumber(text)],
    ['parseQuickInput', (text) => parseQuickInput(text)],
  ]

  it.each(adversarial)('%s: 네 함수 각각 1초 안', (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(10000)
    for (const [label, call] of callers) {
      const started = performance.now()
      call(text)
      const elapsed = performance.now() - started
      expect(elapsed, `${label} ${Math.round(elapsed)}ms`).toBeLessThan(LIMIT_MS)
    }
  })

  it('200자 이하 보통 채팅 10,000건: STRICT·LOOSE 각각 1초 안', () => {
    const samples = ['15', '15번 찜할게요', '15번 너무 예뻐요 살게요', '15,28,31', '15 취소', '3개 남았나요?', '12,500원이요?', '안녕하세요 오늘도 예쁜 아이들 많네요 ❤\uFE0F']
    const chats = Array.from({ length: 10000 }, (_, i) => `${samples[i % samples.length] ?? ''} ${i % 997}`.slice(0, 200))
    for (const parseMode of ['STRICT', 'LOOSE'] as const) {
      const started = performance.now()
      for (const chat of chats) parseChat(chat, { 'claim.parseMode': parseMode })
      const elapsed = performance.now() - started
      expect(elapsed, `${parseMode} ${Math.round(elapsed)}ms`).toBeLessThan(LIMIT_MS)
    }
  })
})
