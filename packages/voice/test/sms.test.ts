// AC-V1-01·02 문자찜 문장 읽기(R-21)의 규칙 문장별 단위 시험·속성 시험과, 상품 등록 추출(R-17)과 겹치지 않음.
// 골든 67사례는 sms-golden.test.ts가 돌린다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { extractVoice, findSmsMarker, readSmsSentence, readVoiceSentence, tokenize, type SmsReading } from '../src/index.ts'

const r = (text: unknown, options?: Parameters<typeof readSmsSentence>[1]): SmsReading | null => readSmsSentence(text, options)
const ok = (fields: Partial<SmsReading>): SmsReading => ({ orders: [], last4: null, name: null, time: null, problem: null, ...fields })
const bad = (problem: SmsReading['problem']): SmsReading => ok({ problem })
const KEYS = ['orders', 'last4', 'name', 'time', 'problem']

describe('AC-V1-01 결과 모양·순수성', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백만', ' \t\n '],
    ['문자열이 아닌 값', 15],
    ['null', null],
    ['undefined', undefined],
    ['객체', { text: '15번 문자찜' }],
    ['제어 글자', '15번\u0000문자찜\u0007'],
    ['HTML', '<script>alert(1)</script> 15번 문자찜'],
    ['서로게이트 반쪽', '\uD800 15번 문자찜 \uDC00'],
    ['이모지', '🌵 15번 문자찜 🌵'],
  ])('%s → 예외 없음', (_label, input) => {
    expect(() => r(input)).not.toThrow()
    const result = r(input)
    if (result !== null) expect(Object.keys(result)).toEqual(KEYS)
  })

  it('300글자를 넘으면 null, 300글자는 평소대로 (R-17 1과 같다)', () => {
    const head = '15번 문자찜 '
    expect(r(head + '자'.repeat(300 - 8))).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    expect(r(head + '자'.repeat(301 - 8))).toBeNull()
    expect(r('문자찜 '.repeat(5000))).toBeNull()
  })

  it('이상한 설정·상품 목록에도 예외 없음 (번호 범위는 999로)', () => {
    expect(r('999번 문자찜', { maxNumber: -1 })).toEqual(ok({ orders: [{ no: 999, qty: 1 }] }))
    expect(r('999번 문자찜', { maxNumber: 1.5 })).toEqual(ok({ orders: [{ no: 999, qty: 1 }] }))
    expect(r('1000번 문자찜', { maxNumber: Number.NaN })).toEqual(bad('NUMBER_UNCLEAR'))
    expect(() => r('반바지 M 문자찜', { parseMode: 'OPTIONS', catalog: [{ no: 1 } as never, null as never] })).not.toThrow()
    expect(r('반바지 M 문자찜', { parseMode: 'OPTIONS', catalog: 'x' as never })).toEqual(bad('OPTION_UNCLEAR'))
    expect(() => r('15번 문자찜', null as never)).not.toThrow()
  })

  it('넘긴 설정·상품 목록을 바꾸지 않는다, 같은 입력 같은 결과', () => {
    const catalog = Object.freeze([Object.freeze({ no: 21, name: '반바지', options: Object.freeze([Object.freeze({ name: '사이즈', choices: Object.freeze([{ label: 'S' }, { label: 'M' }]) })]) })])
    const options = Object.freeze({ parseMode: 'OPTIONS', catalog, focus: null, maxQuantity: 10 })
    const first = r('반바지 M 2개 문자찜', options as never)
    expect(first).toEqual(ok({ orders: [{ no: 21, options: { 사이즈: 'M' }, qty: 2 }] }))
    expect(r('반바지 M 2개 문자찜', options as never)).toEqual(first)
  })
})

describe('AC-V1-01 R-21 2 문자찜 표시', () => {
  it.each([
    ['15번 문자찜', 0 + 1],
    ['15번 문자찜이요', 1],
    ['15번 문자찜했어요', 1],
    ['15번 문자 찜', 1],
    ['15번 문자 찜이요', 1],
  ])('%s → 표시 위치 %s', (text, at) => {
    expect(findSmsMarker(tokenize(text) ?? [])).toBe(at)
  })

  it.each(['15번 문자 왔어요', '15번 찜', '15번 문자메시지 찜', '15번 핑크프릴 만원', '문자', '찜 문자'])('표시 없음: %s → null', (text) => {
    expect(r(text)).toBeNull()
  })

  it('"문자"는 토큰 그대로만 (끝말이 붙은 "문자가 찜"은 표시가 아님)', () => {
    expect(r('15번 문자가 찜했어요')).toBeNull()
  })
})

describe('AC-V1-01 R-21 3~6 취소·뒤 4자리·이름·시각', () => {
  it('취소로 시작하는 토큰 → CANCEL (다른 문제보다 먼저)', () => {
    expect(r('15번 문자찜 취소요')).toEqual(bad('CANCEL'))
    expect(r('취소 문자찜 김민지님 이수진님')).toEqual(bad('CANCEL'))
  })

  it('뒤 4자리 낱말 넷과 끝말·번', () => {
    for (const word of ['끝자리', '뒷자리', '뒷번호', '끝번호', '끝자리가', '뒷번호는']) {
      expect(r(`15번 문자찜 ${word} 0042`)).toEqual(ok({ orders: [{ no: 15, qty: 1 }], last4: '0042' }))
    }
    expect(r('15번 문자찜 끝자리 1234번이요')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], last4: '1234' }))
    expect(r('15번 문자찜 끝자리 1234 끝번호 1234')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], last4: '1234' }))
  })

  it.each(['15번 문자찜 끝자리', '15번 문자찜 끝자리 일이삼사', '15번 문자찜 끝자리 123', '15번 문자찜 끝자리 12345', '15번 문자찜 끝자리 12a4', '15번 문자찜 끝자리 김민지님'])(
    '뒤 4자리를 못 읽음: %s → LAST4_UNCLEAR',
    (text) => {
      expect(r(text)).toEqual(bad('LAST4_UNCLEAR'))
    },
  )

  it('이름: 님 붙임·띄움, 이름이 아닌 말은 무시, 같은 이름 둘은 하나', () => {
    expect(r('김민지님이요 15번 문자찜')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], name: '김민지' }))
    expect(r('15번 문자찜 김민지님 김민지님')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], name: '김민지' }))
    for (const word of ['고객님', '손님', '회원님', '사장님', '구매자님', '시청자님', '선생님']) {
      expect(r(`15번 문자찜 ${word}`)).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    }
    expect(r('15번 문자찜 가나다라마바사아자차카님')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    expect(r('15번 문자찜 김<b>님')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
  })

  it('이름과 뒤 4자리를 함께', () => {
    expect(r('김민지님 끝자리 1234 15번 문자찜')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], last4: '1234', name: '김민지' }))
  })

  it('시각: 시만 → H:00, 분·반·초, 앞 0 없는 시', () => {
    expect(r('15번 문자찜 9시')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '9:00' }))
    expect(r('15번 문자찜 09시 5분에')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '9:05' }))
    expect(r('15번 문자찜 0시 0분 0초')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '0:00:00' }))
    expect(r('15번 문자찜 23시 59분 59초')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '23:59:59' }))
    expect(r('15번 문자찜 2시 30초')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '2:00' }))
    expect(r('15번 문자찜 2시 15분 2시 15분')).toEqual(ok({ orders: [{ no: 15, qty: 1 }], time: '2:15' }))
  })

  it.each(['15번 문자찜 24시', '15번 문자찜 2시 60분', '15번 문자찜 2시 5분 60초', '15번 문자찜 2시 3시'])('시각을 못 읽음: %s → TIME_UNCLEAR', (text) => {
    expect(r(text)).toEqual(bad('TIME_UNCLEAR'))
  })

  it('문제 순서: 뒤 4자리 → 이름 → 시각 → 번호', () => {
    expect(r('문자찜 끝자리 12 김민지님 이수진님 25시')).toEqual(bad('LAST4_UNCLEAR'))
    expect(r('문자찜 김민지님 이수진님 25시')).toEqual(bad('NAME_UNCLEAR'))
    expect(r('문자찜 25시')).toEqual(bad('TIME_UNCLEAR'))
    expect(r('문자찜')).toEqual(bad('NUMBER_UNCLEAR'))
  })
})

describe('AC-V1-06 R-21 3a 아니라는 말·묻는 말 → NOT_SURE (D-V1-12, TD-V1-001)', () => {
  it.each([
    '165번은 문자찜 아니에요',
    '165번 문자찜 되나요?',
    '165번 문자찜 되나요',
    '165번은 문자찜 안 돼요',
    '165번 문자찜 끝자리 1234 아니 5678',
    '165번 말고 166번 문자찜',
  ])('AC-V1-06 문장 %s → NOT_SURE', (text) => {
    expect(r(text)).toEqual(bad('NOT_SURE'))
  })

  it('시작 낱말 여섯(아니·아닌·안·않·못·말고)과 끝 낱말 둘(나요·까요)', () => {
    for (const word of ['아니요', '아닌데', '안', '않아요', '못해요', '말고']) expect(r(`15번 문자찜 ${word}`)).toEqual(bad('NOT_SURE'))
    for (const word of ['되나요', '될까요', '하나요', '할까요']) expect(r(`15번 문자찜 ${word}`)).toEqual(bad('NOT_SURE'))
    // 시작·끝이 아니라 가운데에 있으면 걸리지 않는다
    expect(r('15번 문자찜 되었습니다')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    expect(r('15번 문자찜 들어갑니다요')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
  })

  it('물음표는 정규화한 문장 어디에 있어도(끝 문장 부호를 지우기 전) — 반각·전각', () => {
    expect(r('15번 문자찜?')).toEqual(bad('NOT_SURE'))
    expect(r('15번? 문자찜')).toEqual(bad('NOT_SURE'))
    expect(r('15번 문자찜 끝자리 1234？')).toEqual(bad('NOT_SURE'))
    expect(r('15번 문자찜!')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
  })

  it('표시 토큰은 표시 낱말 뒤 나머지만 본다 (문자찜안돼요·문자 찜될까요), 나머지가 없으면 보지 않는다', () => {
    expect(r('165번 문자찜안돼요')).toEqual(bad('NOT_SURE'))
    expect(r('165번 문자 찜안돼요')).toEqual(bad('NOT_SURE'))
    expect(r('165번 문자 찜될까요')).toEqual(bad('NOT_SURE'))
    expect(r('165번 문자 찜이요')).toEqual(ok({ orders: [{ no: 165, qty: 1 }] }))
    expect(r('165번 문자찜이요')).toEqual(ok({ orders: [{ no: 165, qty: 1 }] }))
  })

  it('맡은 토큰(이름·끝자리·시각)은 살피지 않는다', () => {
    expect(r('166번 문자찜 안지민님')).toEqual(ok({ orders: [{ no: 166, qty: 1 }], name: '안지민' }))
    expect(r('166번 문자찜 안지민 님')).toEqual(ok({ orders: [{ no: 166, qty: 1 }], name: '안지민' }))
    expect(r('166번 문자찜 못난이님 끝자리 1234')).toEqual(ok({ orders: [{ no: 166, qty: 1 }], last4: '1234', name: '못난이' }))
    // 이름이 아닌 님 말(손님)은 맡은 토큰이 아니지만 `안`·`아니`로 시작하지 않으니 상관없다
    expect(r('166번 문자찜 손님')).toEqual(ok({ orders: [{ no: 166, qty: 1 }] }))
  })

  it('문제 순서: CANCEL → NOT_SURE → LAST4_UNCLEAR·NAME_UNCLEAR·TIME_UNCLEAR·NUMBER_UNCLEAR', () => {
    expect(r('15번 문자찜 취소 안 돼요')).toEqual(bad('CANCEL'))
    expect(r('15번 문자찜 끝자리 12 안')).toEqual(bad('NOT_SURE'))
    expect(r('15번 문자찜 김민지님 이수진님 아니에요')).toEqual(bad('NOT_SURE'))
    expect(r('15번 문자찜 25시 아니')).toEqual(bad('NOT_SURE'))
    expect(r('문자찜 안 돼요')).toEqual(bad('NOT_SURE'))
  })

  it('옵션 방식도 옵션을 읽기 전에 NOT_SURE', () => {
    expect(r('반바지 M 문자찜 아니에요', { parseMode: 'OPTIONS', catalog: [], focus: null })).toEqual(bad('NOT_SURE'))
  })

  it('속성: 문제 없는 문자찜 문장에 맡은 토큰이 아닌 토큰 하나(아니에요·안·되나요)를 덧붙이면 늘 NOT_SURE 또는 CANCEL', () => {
    const base = fc.constantFrom(
      '165번 문자찜',
      '165번 문자찜 끝자리 1234',
      '165번 문자찜 김민지님',
      '15번 16번 문자찜 2시 15분',
      '백오번 문자 찜이요 뒷번호 0042',
      '21번 문자찜 되었습니다',
    )
    const extra = fc.constantFrom('아니에요', '안', '되나요', '아닌데요', '못', '말고', '될까요', '취소', '안녕하세요')
    fc.assert(
      fc.property(base, extra, fc.nat(), (text, word, at) => {
        expect(r(text)?.problem).toBeNull()
        const tokens = text.split(' ')
        const position = at % (tokens.length + 1)
        const changed = [...tokens.slice(0, position), word, ...tokens.slice(position)].join(' ')
        const result = r(changed)
        // `문자`와 `찜…` 사이에 끼우면 표시가 깨져 문자찜 문장이 아니다(상품 등록 추출로) — 그때도 찜이 되지 않는다
        if (findSmsMarker(tokenize(changed) ?? []) === -1) {
          expect(result).toBeNull()
          return
        }
        expect(result).not.toBeNull()
        expect(['NOT_SURE', 'CANCEL']).toContain(result?.problem)
        expect(result).toEqual(bad(result?.problem ?? null))
      }),
      { numRuns: 500 },
    )
  })
})

describe('AC-V1-01 R-21 7 번호 방식 (R-17 3의 같은 코드)', () => {
  it('끊어 말한 번호·이번·한자어', () => {
    expect(r('십 오번 문자찜')).toEqual(bad('NUMBER_UNCLEAR'))
    expect(r('이번 15번 문자찜')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    expect(r('15 번 문자찜')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
    expect(r('십오번 문자찜')).toEqual(ok({ orders: [{ no: 15, qty: 1 }] }))
  })

  it('맡은 토큰은 번호 표시가 아니다 (끝자리 1234번), 끊김 검사의 앞 토큰은 맡은 토큰도 본다', () => {
    expect(r('끝자리 1234번 문자찜')).toEqual(bad('NUMBER_UNCLEAR'))
    // 시각 토큰 '2시' + '5' = '2시5' → 수가 아님 / 숫자 앞 토큰이 맡은 토큰이어도 '1' + '5' 같은 꼴이면 끊김
    expect(r('2시 5번 문자찜')).toEqual(ok({ orders: [{ no: 5, qty: 1 }], time: '2:00' }))
    expect(r('끝자리 1234 5번 문자찜')).toEqual(ok({ orders: [{ no: 5, qty: 1 }], last4: '1234' }))
  })

  it('다섯 개까지, 처음 나온 순서', () => {
    expect(r('5번 4번 3번 2번 1번 4번 문자찜')?.orders.map((order) => order.no)).toEqual([5, 4, 3, 2, 1])
    expect(r('5번 4번 3번 2번 1번 6번 문자찜')).toEqual(bad('NUMBER_UNCLEAR'))
  })

  it('번호 하나라도 범위 밖이면 NUMBER_UNCLEAR', () => {
    expect(r('15번 1000번 문자찜')).toEqual(bad('NUMBER_UNCLEAR'))
    expect(r('50번 문자찜', { maxNumber: 50 })).toEqual(ok({ orders: [{ no: 50, qty: 1 }] }))
    expect(r('51번 문자찜', { maxNumber: 50 })).toEqual(bad('NUMBER_UNCLEAR'))
  })
})

describe('AC-V1-01 R-21 4 띄어 쓴 끝자리 낱말 (D-V1-19)', () => {
  it.each([
    ['165번 문자찜 끝 자리 1234', '1234'],
    ['165번 문자찜 뒷 자리 1234', '1234'],
    ['165번 문자찜 끝 번호 1234번', '1234'],
    ['뒷 번호 5678 165번 문자찜', '5678'],
    ['165번 문자찜 끝 자리 1234 끝자리 1234', '1234'],
  ])('%s → 뒤 4자리 %s', (text, last4) => {
    expect(r(text)).toEqual(ok({ orders: [{ no: 165, qty: 1 }], last4 }))
  })

  it('낱말 다음 숫자가 갈리거나 없으면 LAST4_UNCLEAR, 서로 다른 둘도 LAST4_UNCLEAR', () => {
    expect(r('165번 문자찜 끝 자리 12 34')).toEqual(bad('LAST4_UNCLEAR'))
    expect(r('165번 문자찜 끝 자리')).toEqual(bad('LAST4_UNCLEAR'))
    expect(r('165번 문자찜 끝 자리 1234 뒷번호 5678')).toEqual(bad('LAST4_UNCLEAR'))
  })

  it("'끝' 하나·'뒤 4자리'는 낱말이 아니다", () => {
    expect(r('165번 문자찜 끝 1234')).toEqual(ok({ orders: [{ no: 165, qty: 1 }] }))
    expect(r('165번 문자찜 뒤 자리 1234')).toEqual(ok({ orders: [{ no: 165, qty: 1 }] }))
  })
})

describe('AC-V1-01 R-21 8 옵션 방식 (코어 parseOptionComment 그대로)', () => {
  const catalog = [
    { no: 12, name: '감자칩' },
    { no: 21, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] },
  ]
  const opt = { parseMode: 'OPTIONS', maxNumber: 999, maxQuantity: 10, catalog, focus: null }

  it('표시 앞 말만 읽고, 뒤 4자리·이름·시각 토큰은 뺀다 (문장 어디든)', () => {
    expect(r('김민지님 반바지 L 문자찜 끝자리 1234 2시', opt)).toEqual(ok({ orders: [{ no: 21, options: { 사이즈: 'L' }, qty: 1 }], last4: '1234', name: '김민지', time: '2:00' }))
    expect(r('감자칩 3개 문자찜 되었습니다', opt)).toEqual(ok({ orders: [{ no: 12, qty: 3 }] }))
  })

  it('수량 범위 밖·두 상품·빈 글 → OPTION_UNCLEAR', () => {
    expect(r('감자칩 11개 문자찜', opt)).toEqual(bad('OPTION_UNCLEAR'))
    expect(r('12번 21번 문자찜', opt)).toEqual(bad('OPTION_UNCLEAR'))
    expect(r('끝자리 1234 문자찜', opt)).toEqual(bad('OPTION_UNCLEAR'))
  })

  it('옵션 방식 번호는 넘긴 상품 목록 그대로 — maxNumber로 다시 거르지 않는다 (D-V1-16)', () => {
    const wide = [{ no: 1500, name: '반바지', options: [{ name: '사이즈', choices: [{ label: 'M' }] }] }]
    const reading = r('반바지 M 2개 문자찜', { parseMode: 'OPTIONS', maxNumber: 999, catalog: wide, focus: null })
    expect(reading).toEqual(ok({ orders: [{ no: 1500, options: { 사이즈: 'M' }, qty: 2 }] }))
    for (const order of reading?.orders ?? []) expect(wide.map((item) => item.no)).toContain(order.no)
  })

  it('번호 방식(STRICT·LOOSE·생략)은 옵션을 읽지 않는다', () => {
    expect(r('반바지 M 문자찜', { parseMode: 'LOOSE', catalog })).toEqual(bad('NUMBER_UNCLEAR'))
  })
})

describe('AC-V1-01 속성 시험', () => {
  const words = ['15번', '문자찜', '문자', '찜', '끝자리', '1234', '김민지님', '님', '2시', '15분', '반', '취소', '이번', '1', '5번', '백', '오번', '되었습니다', '만원', '핑크프릴', '１６', '🌵', ' ', '\u0000', '문자찜이요', '12 34', '300번']
  const sentence = fc.oneof(fc.string({ maxLength: 60 }), fc.array(fc.constantFrom(...words), { maxLength: 12 }).map((parts) => parts.join(' ')))
  const settings = fc.record({ maxNumber: fc.oneof(fc.integer({ min: -5, max: 10_000 }), fc.constant(undefined)) }, { requiredKeys: [] })

  it('예외 없음·결과 모양·문제가 있으면 주문이 빔·번호는 1..maxNumber', () => {
    fc.assert(
      fc.property(sentence, settings, (text, options) => {
        const result = readSmsSentence(text, options)
        if (result === null) return
        expect(Object.keys(result)).toEqual(KEYS)
        const max = typeof options.maxNumber === 'number' && options.maxNumber >= 1 && options.maxNumber <= 9999 ? options.maxNumber : 999
        if (result.problem !== null) {
          expect(result).toEqual(bad(result.problem))
        } else {
          expect(result.orders.length).toBeGreaterThanOrEqual(1)
          expect(result.orders.length).toBeLessThanOrEqual(5)
          for (const order of result.orders) {
            expect(order.no).toBeGreaterThanOrEqual(1)
            expect(order.no).toBeLessThanOrEqual(max)
            expect(order.qty).toBe(1)
          }
          if (result.last4 !== null) expect(result.last4).toMatch(/^[0-9]{4}$/)
          if (result.time !== null) expect(result.time).toMatch(/^[0-9]{1,2}:[0-5][0-9](?::[0-5][0-9])?$/)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('문자찜으로 시작하는 토큰도 문자+찜… 짝도 없으면 늘 null', () => {
    fc.assert(
      fc.property(sentence, (text) => {
        const tokens = tokenize(text)
        const marked = tokens !== null && tokens.some((token, i) => token.startsWith('문자찜') || (token === '문자' && (tokens[i + 1] ?? '').startsWith('찜')))
        if (!marked) expect(readSmsSentence(text)).toBeNull()
      }),
      { numRuns: 2000 },
    )
  })
})

// ── AC-V1-02 상품 등록 추출과 겹치지 않음 ────────────────────────────────

interface ExtractDoc {
  readonly settings?: { readonly dictionary?: string[]; readonly maxNumber?: number }
  readonly cases: { readonly in: string; readonly out: unknown }[]
}

const EXTRACT_GOLDEN = fileURLToPath(new URL('../../../tests/golden/parser/voice-extract.yaml', import.meta.url))
const extractDocs = parseAllDocuments(readFileSync(EXTRACT_GOLDEN, 'utf8')).map((doc) => doc.toJS() as ExtractDoc)
const extractCases = extractDocs.flatMap((doc) => doc.cases.map((item) => ({ ...item, dictionary: doc.settings?.dictionary ?? [], maxNumber: doc.settings?.maxNumber })))

// V3(D-V3-22 (c)·D-V3-24 (3)): 골든이 81 → 162사례로 늘어 정확한 값으로 교체 (골든이 늘어서 하는 교체 — 약화 아님)
describe('AC-V1-02 문장 → 상품 카드 또는 문자찜 카드 (readVoiceSentence)', () => {
  it('voice-extract.yaml 162사례는 문자찜 문장이 아니고, 입구의 결과가 골든 out과 같다 (R-17 그대로)', () => {
    expect(extractCases).toHaveLength(162)
    for (const item of extractCases) {
      expect(readSmsSentence(item.in)).toBeNull()
      const extract = { dictionary: item.dictionary, ...(item.maxNumber === undefined ? {} : { maxNumber: item.maxNumber }) }
      const sentence = readVoiceSentence(item.in, { extract })
      expect(sentence).toEqual({ kind: 'product', extraction: extractVoice(item.in, extract) })
      // README: out에 적지 않은 no·name·price = null
      expect(sentence.kind === 'product' && sentence.extraction).toEqual({ no: null, name: null, price: null, ...(item.out as object) })
    }
  })

  it('문자찜 표시가 있으면 상품 카드 없이 문자찜만', () => {
    expect(readVoiceSentence('15번 핑크프릴 만원 문자찜', { extract: { dictionary: ['핑크프릴'] } })).toEqual({ kind: 'sms', reading: ok({ orders: [{ no: 15, qty: 1 }] }) })
    expect(readVoiceSentence('15번 핑크프릴 만오천 원', { extract: { dictionary: ['핑크프릴'] } })).toEqual({
      kind: 'product',
      extraction: { no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH' },
    })
  })

  it('"문자찜도 듣기"가 꺼져 있으면 문자찜 문장은 어떤 카드도 아님, 못 읽는 설정은 기본(켬)', () => {
    expect(readVoiceSentence('15번 핑크프릴 만원 문자찜', { smsSettings: { 'voice.smsListen': false } })).toEqual({ kind: 'none' })
    expect(readVoiceSentence('15번 문자찜', { smsSettings: { 'voice.smsListen': 'no' } }).kind).toBe('sms')
    expect(readVoiceSentence('15번 문자찜', { smsSettings: 'broken' }).kind).toBe('sms')
    // 끄더라도 문자찜이 아닌 문장은 지금처럼 상품 등록
    expect(readVoiceSentence('15번 라울 만원', { smsSettings: { 'voice.smsListen': false }, extract: { dictionary: ['라울'] } }).kind).toBe('product')
  })

  it('문자찜 문장의 번호 범위·판매 방식은 sms 설정으로', () => {
    expect(readVoiceSentence('201번 문자찜', { sms: { maxNumber: 200 } })).toEqual({ kind: 'sms', reading: bad('NUMBER_UNCLEAR') })
  })
})
