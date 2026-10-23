// V1 적대 시험 (test-domain, AC-V1-01·AC-V1-50 (1)): R-21 음성 문자찜 문장 읽기(readSmsSentence)를 임의·악의 문장으로 공격한다.
// - 어떤 문장·설정에도 예외 없음, 결과는 null 또는 정확히 다섯 키, problem이 있으면 orders []·나머지 null
// - 300글자(정규화 뒤 코드 포인트)를 넘으면 null, 문자찜 표시가 없으면 null
// - 번호 방식 orders의 no는 늘 1..maxNumber, 서로 다르고 5개 이하, qty 1
// - 넘긴 설정·상품 목록을 바꾸지 않고 같은 입력이면 같은 결과
// - 실제 시청자 문자를 보며 판매자가 말할 법한 변형(끝말·붙여 씀·전각·이모지·제어 글자)
import { readSmsSentence, readVoiceSentence, type SmsReading } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const KEYS = ['last4', 'name', 'orders', 'problem', 'time']
const PROBLEMS = new Set(['CANCEL', 'LAST4_UNCLEAR', 'NAME_UNCLEAR', 'TIME_UNCLEAR', 'NUMBER_UNCLEAR', 'OPTION_UNCLEAR'])

/** 결과 모양 검사 (R-21 "결과") */
function expectShape(result: SmsReading | null, maxNumber: number | null): void {
  if (result === null) return
  expect(Object.keys(result).sort()).toEqual(KEYS)
  if (result.problem !== null) {
    expect(PROBLEMS.has(result.problem)).toBe(true)
    expect(result).toEqual({ orders: [], last4: null, name: null, time: null, problem: result.problem })
    return
  }
  expect(result.orders.length).toBeGreaterThan(0)
  expect(result.last4 === null || /^[0-9]{4}$/.test(result.last4)).toBe(true)
  expect(result.name === null || /^[가-힣]{1,10}$/.test(result.name)).toBe(true)
  expect(result.time === null || /^([0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(result.time)).toBe(true)
  if (maxNumber !== null) {
    // 번호 방식
    expect(result.orders.length).toBeLessThanOrEqual(5)
    expect(new Set(result.orders.map((order) => order.no)).size).toBe(result.orders.length)
    for (const order of result.orders) {
      expect(Object.keys(order).sort()).toEqual(['no', 'qty'])
      expect(order.qty).toBe(1)
      expect(Number.isSafeInteger(order.no) && order.no >= 1 && order.no <= maxNumber).toBe(true)
    }
  }
}

/** 판매자가 말할 법한 토큰 조각 */
const PIECES = [
  '문자찜',
  '문자찜이요',
  '문자찜했어요',
  '문자',
  '찜',
  '찜이요',
  '되었습니다',
  '끝자리',
  '뒷자리',
  '끝번호',
  '뒷번호',
  '1234',
  '5678',
  '1234번',
  '12345',
  '123',
  '１２３４',
  '165번',
  '15번',
  '28번',
  '0번',
  '1000번',
  '백육십오번',
  '일번',
  '이번',
  '김민지님',
  '민지님이요',
  '님',
  '손님',
  '고객님',
  '2시',
  '15분',
  '30초',
  '반',
  '25시',
  '취소',
  '취소요',
  '아니',
  '핑크프릴',
  '만원',
  '😀',
  '<b>',
  '​',
  '\u0000',
  '\t',
  '\n',
  '，',
  '.',
  '~',
]
const sentence = fc.array(fc.constantFrom(...PIECES), { minLength: 0, maxLength: 14 }).map((parts) => parts.join(' '))
const anyText = fc.oneof(sentence, fc.string({ maxLength: 80 }), fc.string({ unit: 'grapheme', maxLength: 80 }), fc.string({ unit: 'binary', maxLength: 80 }))
const maxNumberArb = fc.oneof(fc.integer({ min: 1, max: 9999 }), fc.constant(999))

describe('TD-V1-R21 속성: 예외 없음·결과 모양·번호 범위 (AC-V1-01, AC-V1-50 (1))', () => {
  it('임의 문장 × 임의 maxNumber → 예외 없음, null 또는 다섯 키, problem이면 비움, orders.no ∈ 1..maxNumber', () => {
    fc.assert(
      fc.property(anyText, maxNumberArb, (text, maxNumber) => {
        const result = readSmsSentence(text, { maxNumber })
        expectShape(result, maxNumber)
      }),
      { numRuns: 1500 },
    )
  })

  it('표시가 없으면(문자찜으로 시작하는 토큰도, 문자+찜… 짝도 없음) 늘 null', () => {
    const noMark = fc.array(fc.constantFrom(...PIECES.filter((piece) => !piece.startsWith('문자'))), { maxLength: 14 }).map((parts) => parts.join(' '))
    fc.assert(
      fc.property(noMark, (text) => {
        expect(readSmsSentence(text, { maxNumber: 999 })).toBeNull()
      }),
      { numRuns: 800 },
    )
  })

  it('같은 입력이면 같은 결과, 넘긴 설정 객체는 바뀌지 않는다', () => {
    fc.assert(
      fc.property(sentence, maxNumberArb, (text, maxNumber) => {
        const options = Object.freeze({ parseMode: 'STRICT', maxNumber })
        const a = readSmsSentence(text, options)
        const b = readSmsSentence(text, options)
        expect(a).toEqual(b)
        expect(options).toEqual({ parseMode: 'STRICT', maxNumber })
      }),
      { numRuns: 400 },
    )
  })
})

describe('TD-V1-R21 악의 문장 (AC-V1-50 (1))', () => {
  it('300글자를 넘으면 null — 문자찜 수천 번·긴 이름·이모지 (공백은 정규화로 줄어 세지 않는다)', () => {
    for (const text of [
      '문자찜 '.repeat(3000),
      `165번 문자찜 끝자리 1234 ${'가'.repeat(300)}`,
      `165번 문자찜 ${'😀'.repeat(400)}`,
      `${'김'.repeat(299)} 165번 문자찜`,
    ]) {
      expect(readSmsSentence(text, { maxNumber: 999 }), text.slice(0, 20)).toBeNull()
    }
    // 긴 공백은 정규화(R-17 1)로 하나가 되어 300글자 안 — 읽는다
    expect(readSmsSentence(`${' '.repeat(10_000)}165번 문자찜`, { maxNumber: 999 })?.orders).toEqual([{ no: 165, qty: 1 }])
  })

  it('정확히 300글자 안이면 읽는다 (경계)', () => {
    const head = '165번 문자찜 끝자리 1234'
    const text = `${head} ${'가'.repeat(300 - head.length - 1)}`
    expect([...text].length).toBe(300)
    expect(readSmsSentence(text, { maxNumber: 999 })).toEqual({ orders: [{ no: 165, qty: 1 }], last4: '1234', name: null, time: null, problem: null })
  })

  it('제어 글자·전각·이모지·태그가 섞여도 예외 없고, 끝자리는 반각 숫자 4개만 맞는다', () => {
    const cases = [
      '165번\t문자찜\n끝자리 1234',
      '１６５번 문자찜 끝자리 １２３４',
      '165번 문자찜 끝자리 1234😀',
      '165번 문자찜 끝자리 ①②③④',
      '165번 문자찜 끝자리 ١٢٣٤',
      '165번 문자찜 끝자리 𝟏𝟐𝟑𝟒',
      '165번 문자찜 <script>alert(1)</script>님',
      '165번 문자찜 \u0000\u0007\u001b[31m',
      '\ud800 165번 문자찜',
      '165번 문자찜 ‮4321 끝자리 1234',
    ]
    for (const text of cases) {
      const result = readSmsSentence(text, { maxNumber: 999 })
      expectShape(result, 999)
      if (result !== null && result.last4 !== null) expect(result.last4).toMatch(/^[0-9]{4}$/)
      if (result !== null && result.name !== null) expect(result.name).toMatch(/^[가-힣]+$/)
    }
    // 이모지가 붙은 숫자는 숫자 4개가 아니다 → 넣지 않는다
    expect(readSmsSentence('165번 문자찜 끝자리 1234😀', { maxNumber: 999 })?.problem).toBe('LAST4_UNCLEAR')
    // 태그는 이름이 아니다 (한글만)
    expect(readSmsSentence('165번 문자찜 <b>김</b>님', { maxNumber: 999 })?.name).toBeNull()
  })

  it('설정이 이상한 값이어도 예외 없음 (getter가 던짐·Proxy·숫자 아님)', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('boom')
        },
        has() {
          throw new Error('boom')
        },
      },
    )
    const odd: unknown[] = [
      throwing,
      { maxNumber: Number.NaN },
      { maxNumber: -5 },
      { maxNumber: 1e9 },
      { parseMode: 'OPTIONS', catalog: throwing, focus: throwing },
      { parseMode: 'OPTIONS', catalog: [throwing, null, 3] },
      { parseMode: 'OPTIONS', catalog: 'x' },
      Object.defineProperty({}, 'maxNumber', {
        get() {
          throw new Error('getter')
        },
      }),
    ]
    for (const options of odd) {
      for (const text of ['165번 문자찜 끝자리 1234', '반바지 M 2개 문자찜', '문자찜']) {
        expect(() => readSmsSentence(text, options as never)).not.toThrow()
      }
    }
    for (const text of [null, undefined, 165, {}, [], Symbol('x'), () => '문자찜']) {
      expect(() => readSmsSentence(text as never, { maxNumber: 999 })).not.toThrow()
      expect(readSmsSentence(text as never, { maxNumber: 999 })).toBeNull()
    }
  })

  it('옵션 방식: 상품 목록·지금 상품을 바꾸지 않는다 (얼린 값으로)', () => {
    const SIZES = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }]
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        for (const inner of Object.values(value)) deepFreeze(inner)
        Object.freeze(value)
      }
      return value
    }
    const catalog = deepFreeze([{ no: 21, name: '반바지', options: SIZES }, { no: 22, name: '수건' }])
    const focus = deepFreeze({ no: 21, ageSec: 5 })
    const before = JSON.stringify({ catalog, focus })
    for (const text of ['반바지 M 2개 문자찜 끝자리 1234', '엠 문자찜', '수건 문자찜', '반바지 문자찜', '반바지 M 수건 문자찜']) {
      expect(() => readSmsSentence(text, { parseMode: 'OPTIONS', maxNumber: 999, catalog, focus })).not.toThrow()
    }
    expect(JSON.stringify({ catalog, focus })).toBe(before)
  })
})

describe('TD-V1-R21 실제 말 변형 (회귀)', () => {
  const read = (text: string) => readSmsSentence(text, { maxNumber: 999 })
  const plain = (no: number, last4: string | null = null, name: string | null = null) => ({ orders: [{ no, qty: 1 }], last4, name, time: null, problem: null })

  it('끝말·붙여 씀·두 토큰 표시는 같은 문자찜', () => {
    expect(read('165번 문자찜했어요 끝자리 1234')).toEqual(plain(165, '1234'))
    expect(read('165번 문자 찜이요 끝자리는 1234번이요')).toEqual(plain(165, '1234'))
    expect(read('끝자리 1234 165번 문자찜')).toEqual(plain(165, '1234'))
    expect(read('민지님이요 165번 문자찜')).toEqual(plain(165, null, '민지'))
    expect(read('백육십오 번 문자찜')).toEqual(plain(165))
  })

  it('애매하면 넣지 않는다 — 끝자리 둘·이름 둘·시각 둘·번호 6개·범위 밖', () => {
    expect(read('165번 문자찜 끝자리 1234 끝번호 5678')?.problem).toBe('LAST4_UNCLEAR')
    expect(read('165번 문자찜 끝자리 1 2 3 4')?.problem).toBe('LAST4_UNCLEAR')
    expect(read('165번 문자찜 끝자리 일이삼사')?.problem).toBe('LAST4_UNCLEAR')
    expect(read('165번 문자찜 김민지 님 민지님')?.problem).toBe('NAME_UNCLEAR')
    expect(read('165번 문자찜 2시 반 3시')?.problem).toBe('TIME_UNCLEAR')
    expect(read('1번 2번 3번 4번 5번 6번 문자찜')?.problem).toBe('NUMBER_UNCLEAR')
    expect(read('1000번 문자찜')?.problem).toBe('NUMBER_UNCLEAR')
    expect(read('0번 문자찜')?.problem).toBe('NUMBER_UNCLEAR')
    expect(read('165번 문자찜 취소요')?.problem).toBe('CANCEL')
  })

  it('제로폭 글자가 표시 가운데 끼면 문자찜이 아니다(넣지 않음) — 상품 카드도 문자찜 카드도 저절로 넣지 않는다', () => {
    expect(read('165번 문자​찜 끝자리 1234')).toBeNull()
    const voice = readVoiceSentence('165번 문자​찜 끝자리 1234', { extract: { maxNumber: 999 } })
    expect(voice.kind).toBe('product')
  })

  it('"문자찜도 듣기"를 끄면 문자찜 문장은 none (상품 카드도 아님), 표시 없는 말은 R-17 그대로', () => {
    expect(readVoiceSentence('15번 핑크프릴 만원 문자찜', { smsSettings: { 'voice.smsListen': false } })).toEqual({ kind: 'none' })
    expect(readVoiceSentence('15번 핑크프릴 만원 문자찜', {}).kind).toBe('sms')
    expect(readVoiceSentence('15번 핑크프릴 만오천 원', { smsSettings: { 'voice.smsListen': false } }).kind).toBe('product')
    // 깨진 설정은 기본(켬)
    expect(readVoiceSentence('15번 문자찜', { smsSettings: { 'voice.smsListen': 'false' } }).kind).toBe('sms')
  })
})
