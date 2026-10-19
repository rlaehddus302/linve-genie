// AC-P2-01~05 추출 함수 (R-17). 골든(parser/voice-extract.yaml 69사례)은 골든 러너가 돌린다(AC-P2-08) — 여기서는 규칙 문장별 단위 시험과 속성 시험.
import { normalizeText, parseAmount, parseKoreanNumber } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractVoice, prepareDictionary, readingForms, tokenize, type VoiceExtraction } from '../src/index.ts'

const DICT = ['핑크프릴', '핑크프릴 금', '방울복랑 금', '라울', '왕비뇌신금', '블루엘프', '레티지아', '십이지권', '천사의눈물', '벨루가', '로라']
const x = (text: unknown, options: Parameters<typeof extractVoice>[1] = { dictionary: DICT }): VoiceExtraction => extractVoice(text, options)
const out = (fields: Partial<VoiceExtraction>): VoiceExtraction => ({ no: null, name: null, price: null, confidence: 'LOW', ...fields })

describe('AC-P2-01 결과 모양·순수성', () => {
  it('정확히 네 키 { no, name, price, confidence }', () => {
    const result = x('15번 핑크프릴 만오천 원')
    expect(Object.keys(result)).toEqual(['no', 'name', 'price', 'confidence'])
    expect(result).toEqual({ no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH' })
  })

  it.each([
    ['빈 문자열', ''],
    ['공백만', ' \t\n '],
    ['문자열이 아닌 값', 15],
    ['null', null],
    ['undefined', undefined],
    ['객체', { text: '15번' }],
    ['제어 글자', '15번\u0000핑크\u0007프릴'],
    ['HTML', '<script>alert(1)</script> 15번 <b>만원</b>'],
    ['서로게이트 반쪽', '\uD800 15번 \uDC00'],
  ])('%s → 예외 없이 네 키', (_label, input) => {
    const result = x(input)
    expect(Object.keys(result)).toEqual(['no', 'name', 'price', 'confidence'])
    expect(['HIGH', 'LOW']).toContain(result.confidence)
  })

  it('1만 글자 → 300글자를 넘어 전부 null·LOW, 빠르게', () => {
    const started = performance.now()
    expect(x(`15번 핑크프릴 만원 ${'자'.repeat(10_000)}`)).toEqual(out({}))
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('정규화한 문장 300글자는 평소대로, 301글자는 전부 null (앞뒤·연속 공백은 정규화 뒤 길이로 센다)', () => {
    const head = '15번 핑크프릴 만오천 원 '
    expect(x(head + '자'.repeat(300 - 15), { dictionary: ['핑크프릴'] })).toEqual({ no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH' })
    expect(x(head + '자'.repeat(301 - 15), { dictionary: ['핑크프릴'] })).toEqual(out({}))
    // 연속 공백은 한 칸으로 줄어든 뒤 센다
    expect(x(`   ${head.replace(/ /g, '    ')}${'자'.repeat(285)}   `, { dictionary: ['핑크프릴'] }).no).toBe(15)
    // 코드 포인트로 센다: 이모지 하나 = 1글자
    expect(x(head + '🌵'.repeat(285), { dictionary: ['핑크프릴'] }).no).toBe(15)
    expect(x(head + '🌵'.repeat(286), { dictionary: ['핑크프릴'] }).no).toBe(null)
  })

  it('넘긴 사전·설정을 바꾸지 않는다', () => {
    const dictionary = Object.freeze(['핑크 프릴', '라울'])
    const options = Object.freeze({ maxNumber: 50, dictionary })
    expect(() => extractVoice('15번 핑크 프릴 만원', options)).not.toThrow()
    expect(dictionary).toEqual(['핑크 프릴', '라울'])
  })

  it('maxNumber 생략·잘못된 값은 999', () => {
    expect(x('999번 라울 만원').no).toBe(999)
    expect(x('1000번 라울 만원').no).toBe(null)
    for (const maxNumber of [0, -1, 1.5, Number.NaN, '50' as unknown as number]) expect(x('999번 라울 만원', { dictionary: DICT, maxNumber }).no).toBe(999)
  })

  it('사전을 넘기지 않으면 빈 사전 — 품종 없음, 늘 LOW', () => {
    expect(extractVoice('15번 핑크프릴 만원')).toEqual(out({ no: 15, price: 10000 }))
  })

  it('준비한 사전(prepareDictionary)과 이름 목록은 결과가 같다', () => {
    const prepared = prepareDictionary(DICT)
    for (const text of ['15번 핑크프릴 만원', '15번 핑크푸릴 만원', '15번 나울 오천 원', '15번 핑크프릴 금이에요 만원']) {
      expect(extractVoice(text, { dictionary: prepared })).toEqual(x(text))
    }
  })
})

describe('R-17 1·2 토큰과 읽는 모양', () => {
  it('정규화(전각 숫자·연속 공백) → 끝 문장 부호 지우기 → 빈 토큰 버리기', () => {
    expect(tokenize('  １５번,,  핑크프릴~!  ...  만원?. ')).toEqual(['15번', '핑크프릴', '만원'])
    expect(tokenize('15,000원 1.5만')).toEqual(['15,000원', '1.5만'])
    expect(tokenize('')).toEqual([])
    expect(tokenize(42)).toEqual([])
  })

  it('읽는 모양 = 그대로, 그다음 끝말 하나를 뗀 모양(짧은 끝말부터, 남는 글자가 있을 때만)', () => {
    expect(readingForms('핑크프릴이에요')).toEqual(['핑크프릴이에요', '핑크프릴이에', '핑크프릴이', '핑크프릴'])
    expect(readingForms('만원이요')).toEqual(['만원이요', '만원이', '만원'])
    expect(readingForms('이')).toEqual(['이'])
    expect(readingForms('요요')).toEqual(['요요', '요'])
    expect(readingForms('라울')).toEqual(['라울'])
  })
})

describe('AC-P2-02 번호 (R-17 3)', () => {
  it.each([
    ['15번 라울 만원', 15],
    ['15 번 라울 만원', 15],
    ['15번이요 라울 만원', 15],
    ['15번엔 라울 만원', 15],
    ['15 번에 라울 만원', 15],
    ['십오번 라울 만원', 15],
    ['백오번 라울 만원', 105],
    ['일번 라울 만원', 1],
    ['이십 번 라울 만원', 20],
    ['구백구십구번 라울', 999],
    ['구천구백구십구번 라울', null],
    ['15번이요 15번 라울', 15],
  ])('%s → %s', (text, no) => {
    expect(x(text).no).toBe(no)
  })

  it.each([
    '한 번 더 보여 드릴게요',
    '두 번 라울 만원',
    '열다섯 번 라울 만원',
    '이번 상품은 진짜 예뻐요',
    '이번에 라울 만원',
    '이 번 라울 만원',
    '15번째 라울 만원',
    '세 번째 상품 만원',
    '15번 16번 만원',
    '1000번 라울 만원',
    '0번 라울 만원',
    '12345번 라울 만원',
    '1,000번 라울',
    '번 라울 만원',
    '<b>15번</b> 만원',
  ])('%s → 번호 없음', (text) => {
    expect(x(text).no).toBe(null)
  })

  it('maxNumber 50: 50번 → 50, 51번 → null', () => {
    expect(x('50번 라울 만원', { dictionary: ['라울'], maxNumber: 50 })).toEqual({ no: 50, name: '라울', price: 10000, confidence: 'HIGH' })
    expect(x('51번 라울 만원', { dictionary: ['라울'], maxNumber: 50 })).toEqual(out({ name: '라울', price: 10000 }))
  })

  it('번호 값은 코어 R-15(parseKoreanNumber)와 같다 — 숫자·한자어 수사 X에서', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: 1, max: 9999 }).map(String), fc.stringMatching(/^[일이삼사오육칠팔구십백천]{1,6}$/)),
        (numeral) => {
          fc.pre(numeral !== '이')
          const want = parseKoreanNumber(numeral)
          const got = extractVoice(`${numeral}번 만원`, { maxNumber: 9999 }).no
          expect(got).toBe(want)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('AC-P2-03 가격 (R-17 4)', () => {
  it.each([
    ['15번 만오천 원', 15000],
    ['15번 만 오천 원', 15000],
    ['15번 1만 5천 원', 15000],
    ['15번 15,000원', 15000],
    ['15번 만오천원에', 15000],
    ['15번 만원이요', 10000],
    ['15번 오천원짜리', 5000],
    ['15번 백 원', 100],
    ['15번 1.5만 원', 15000],
    ['15번 만이천오백 원', 12500],
    ['15번 만원 이 가격에 드려요', 10000],
    ['15번 만원 만원', 10000],
    ['15번 오천 원 오천 원', 5000],
    ['15번 삼만 원 3개 남았어요', 30000],
    ['15번 오천 원 하나 남았어요', 5000],
  ])('%s → %s원', (text, price) => {
    expect(x(text).price).toBe(price)
  })

  it.each([
    '15번 10000',
    '15번 10',
    '15번 십',
    '15번 99원',
    '15번 0원',
    '15번 공짜',
    '15번 만오',
    '15번 만 원 하던 거 오천 원에',
    '15번 1만 500',
    '15번 이 만원짜리',
    '15번 2 만원',
    '15번 오 천 원',
    '15번 만원 오천원',
  ])('%s → 가격 없음', (text) => {
    expect(x(text).price).toBe(null)
  })

  it('price.unit 설정은 결과를 바꾸지 않는다 — 추출 함수가 그 설정을 받지 않는다(원 단위)', () => {
    const options = { dictionary: DICT, 'price.unit': 'THOUSAND' } as unknown as Parameters<typeof extractVoice>[1]
    expect(extractVoice('15번 핑크프릴 10', options)).toEqual(extractVoice('15번 핑크프릴 10', { dictionary: DICT }))
    expect(extractVoice('15번 핑크프릴 10', options).price).toBe(null)
  })

  it('가격 묶음 하나짜리 문장의 값은 코어 R-14(원 단위)와 같다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (thousands) => {
        const spoken = `${String(thousands)}천 원`
        const want = parseAmount(spoken, { 'price.unit': 'WON' })
        expect(extractVoice(`7번 ${spoken}`).price).toBe(want !== null && want >= 100 ? want : null)
      }),
      { numRuns: 200 },
    )
  })
})

describe('AC-P2-04 품종 (R-17 5)', () => {
  it.each([
    ['15번 핑크 프릴 만원', '핑크프릴', 'HIGH'],
    ['15번 핑크푸릴 만원', '핑크프릴', 'LOW'],
    ['15번 나울 오천 원', '라울', 'LOW'],
    ['15번 라울이랑 만원', '라울', 'HIGH'],
    ['15번 벨루가 만원', '벨루가', 'HIGH'],
    ['15번 십이 지권 만원', '십이지권', 'HIGH'],
    ['15번 핑크프릴 금 만원', '핑크프릴 금', 'HIGH'],
    ['15번 핑크프릴 금이에요 만원', '핑크프릴 금', 'HIGH'],
    ['15번 방울 복랑 금 만원', '방울복랑 금', 'HIGH'],
  ])('%s → %s (%s)', (text, name, confidence) => {
    expect(x(text)).toEqual({ no: 15, name, price: text.includes('오천') ? 5000 : 10000, confidence })
  })

  it.each(['15번 벨루 만원', '15번 로나 만원', '15번 핑크프릴 라울 만원', '15번 안녕하세요 만원', '15번 자 이거 진짜 만원'])('%s → 품종 없음', (text) => {
    expect(x(text).name).toBe(null)
  })

  it('사전 [핑크프릴, 핑크프린]에서 핑크프리 → 동률이라 null', () => {
    expect(x('15번 핑크프리 만원', { dictionary: ['핑크프릴', '핑크프린'] })).toEqual(out({ no: 15, price: 10000 }))
  })

  it('사전에 적힌 모양(R-3 정규화)으로 돌려준다', () => {
    expect(x('15번 핑크프릴 만원', { dictionary: ['  핑크   프릴 '] }).name).toBe('핑크 프릴')
  })

  it('영문·숫자 섞인 이름도 자모(코드 포인트) 거리로 맞춘다', () => {
    expect(x('15번 GT-2 만원', { dictionary: ['GT-2'] }).name).toBe('GT-2')
    expect(x('15번 핑크Frill 만원', { dictionary: ['핑크Frill'] })).toEqual({ no: 15, name: '핑크Frill', price: 10000, confidence: 'HIGH' })
    // 10자모 중 1개 다름 → 0.9, 후보
    expect(x('15번 핑크Frll 만원', { dictionary: ['핑크Frill'] }).name).toBe('핑크Frill')
  })
})

describe('AC-P2-05 신뢰도 (R-17 6)', () => {
  it('HIGH ⇔ 번호·품종·가격이 모두 있고 품종 유사도가 1', () => {
    expect(x('핑크프릴 만오천 원')).toEqual(out({ name: '핑크프릴', price: 15000 }))
    expect(x('15번 핑크푸릴 만원').confidence).toBe('LOW')
    expect(x('15번 핑크프릴').confidence).toBe('LOW')
    expect(x('15번 핑크프릴 만원').confidence).toBe('HIGH')
  })

  const sentence = fc
    .array(
      fc.oneof(
        fc.constantFrom('15번', '십오번', '이번', '한', '번', '만원', '오천', '원', '이', '만', '1만', '500', '핑크', '프릴', '라울이랑', '금', '자', '이거', '진짜', '15', '번째', '~', '.', '１５번'),
        fc.string({ maxLength: 4 }),
      ),
      { maxLength: 12 },
    )
    .map((tokens) => tokens.join(' '))
  const dictionary = fc.array(fc.oneof(fc.constantFrom(...DICT, '핑크 프릴', '금', ''), fc.string({ maxLength: 6 })), { maxLength: 8 })

  it('속성: 임의 문장·사전 → 예외 없음·네 키·결정성·사전을 바꾸지 않음', () => {
    fc.assert(
      fc.property(sentence, dictionary, fc.integer({ min: 1, max: 9999 }), (text, names, maxNumber) => {
        const copy = [...names]
        const first = extractVoice(text, { dictionary: names, maxNumber })
        const second = extractVoice(text, { dictionary: names, maxNumber })
        expect(Object.keys(first)).toEqual(['no', 'name', 'price', 'confidence'])
        expect(second).toEqual(first)
        expect(names).toEqual(copy)
        if (first.no !== null) expect(first.no >= 1 && first.no <= maxNumber).toBe(true)
        if (first.price !== null) expect(Number.isSafeInteger(first.price) && first.price >= 100).toBe(true)
      }),
      { numRuns: 400 },
    )
  })

  it('속성: HIGH면 번호·가격·품종이 모두 있고 품종은 넘긴 사전의 이름(정규화한 모양) 중 하나, 사전이 비면 늘 LOW', () => {
    fc.assert(
      fc.property(sentence, dictionary, (text, names) => {
        const result = extractVoice(text, { dictionary: names })
        if (result.confidence === 'HIGH') {
          expect(result.no).not.toBe(null)
          expect(result.price).not.toBe(null)
          expect(names.map(normalizeText)).toContain(result.name)
        }
        if (result.name !== null) expect(names.map(normalizeText)).toContain(result.name)
        expect(extractVoice(text, { dictionary: [] }).confidence).toBe('LOW')
      }),
      { numRuns: 400 },
    )
  })

  it('속성: 아무 글자열(유니코드 전체)에도 예외 없이 네 키', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => {
        const result = extractVoice(text, { dictionary: DICT })
        expect(Object.keys(result)).toEqual(['no', 'name', 'price', 'confidence'])
      }),
      { numRuns: 500 },
    )
  })
})
