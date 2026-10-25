// AC-P2-01~05 추출 함수 (R-17). 골든(parser/voice-extract.yaml 69사례)은 골든 러너가 돌린다(AC-P2-08) — 여기서는 규칙 문장별 단위 시험과 속성 시험.
import { normalizeText, parseAmount, parseKoreanNumber } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractVoice, punctuatedTokens, prepareDictionary, readingForms, tokenize, type VoiceExtraction } from '../src/index.ts'

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
          // V3 자리 읽기(D-V3-11): 한글 자리 글자 정확히 셋 + 번은 자리를 이은 값 (아래 별도 시험)
          fc.pre(!/^[일이삼사오육칠팔구]{3}$/.test(numeral))
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

// ── I4 ─────────────────────────────────────────────────────────────────────
// AC-I4-01 끊어 말한 번호 (R-17 3·4, D-I4-01, TD-P2-002). 골든(voice-extract.yaml 마지막 문서 12사례)은 골든 러너가 돌린다.

/** 규칙 문장(R-17 3)을 그대로 옮긴 판단 — 시험 쪽의 독립 구현. 번호 표시의 X마다 바로 앞 토큰(그대로) + X가 R-15로 읽히는가 */
/**
 * 끊어 말한 번호 표시가 있는가 (D-I4-01) — V3 D-V3-54부터 앞 토큰이 합칠 수 있는 수(숫자·한글 수, `이` 제외, 문장 부호 없음,
 * 둘 다 숫자 한 개이거나 자리가 내려감)이면 합쳐 읽으므로 끊어 말한 표시가 아니다.
 */
function hasSplitMarker(text: string): boolean {
  const tokens = tokenize(text) ?? []
  const punct = punctuatedTokens(text)
  const isX = (value: string): boolean => value !== '이' && (/^[0-9]{1,4}$/.test(value) || /^[일이삼사오육칠팔구십백천]+$/.test(value)) && parseKoreanNumber(value) !== null
  const lowest = (n: number): number => {
    let k = 0
    for (let v = n; v % 10 === 0 && v > 0; v /= 10) k++
    return k
  }
  const mergeOk = (prev: string, x: string, i: number): boolean => {
    if (!isX(prev) || punct[i - 1] === true) return false
    if (/^[0-9]$/.test(prev) && /^[0-9]$/.test(x)) return true
    const coefficient = /^[0-9]+/.exec(x)?.[0] ?? String(parseKoreanNumber(x.split(/[만천원]/)[0] ?? '') ?? '')
    return coefficient !== '' && lowest(parseKoreanNumber(prev) as number) > coefficient.length - 1
  }
  return tokens.some((token, i) => {
    const xs = readingForms(token)
      .filter((form) => form.length >= 2 && form.endsWith('번'))
      .map((form) => form.slice(0, -1))
    const next = tokens[i + 1]
    if (next !== undefined && readingForms(next).includes('번')) xs.push(token)
    const previous = tokens[i - 1]
    // V3 자리 읽기 ⓑ + 번(D-V3-11): 자리 글자 하나 토큰 둘 뒤의 `X번`(X도 자리 글자 하나, 앞뒤는 자리 글자 아님)은 세 자리를 이어 읽어 끊어 말한 번호 검사를 하지 않는다
    const one = (value: string | undefined): boolean => value !== undefined && /^([0-9]|[공일이삼사오육칠팔구])$/.test(value)
    const triple = one(tokens[i - 2]) && one(previous) && !one(tokens[i - 3]) && !one(next)
    return (
      previous !== undefined &&
      xs.some((value) => isX(value) && parseKoreanNumber(previous + value) !== null && !(triple && one(value) && token === `${value}번`) && !mergeOk(previous, value, i))
    )
  })
}

describe('AC-I4-01 끊어 말한 번호 (R-17 3·4, D-I4-01)', () => {
  const GOLDEN_DICT = ['핑크프릴', '라울', '블루엘프']
  const g = (text: string): VoiceExtraction => extractVoice(text, { dictionary: GOLDEN_DICT, maxNumber: 999 })

  // V3 D-V3-54로 남은 끊어 말한 꼴 (`이` 앞 토큰·문장 부호·자리 겹침)
  it.each([
    ['1, 5번 라울 만원', '라울'],
    ['이 십 번 블루엘프 칠천 원', '블루엘프'],
    ['이 십오번 핑크프릴 만원', '핑크프릴'],
    ['2 15번 핑크프릴 만원', '핑크프릴'],
  ])('%s → 번호·가격 비움, 품종 %s, LOW', (text, name) => {
    expect(g(text)).toEqual(out({ name }))
    expect(hasSplitMarker(text)).toBe(true)
  })

  // V3 D-V3-54(실방송 8차 "오십삼번을 십삼번으로"): 앞 수와 합치기 — 처음 기대(비움)를 바꿈(약화 아님, 골든도 같이 바뀜)
  it.each([
    ['1 5번 핑크프릴 만오천 원', { no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH' }],
    ['1 5 번 라울 만원', { no: 15, name: '라울', price: 10000, confidence: 'HIGH' }],
    ['십 오번 라울 오천 원', { no: 15, name: '라울', price: 5000, confidence: 'HIGH' }],
    ['백 오번 라울', { no: 105, name: '라울', price: null, confidence: 'LOW' }],
    ['백 이십 삼번 라울 만원', { no: 123, name: '라울', price: 10000, confidence: 'HIGH' }],
    ['15번 1 5번 핑크프릴 만원', { no: 15, name: '핑크프릴', price: 10000, confidence: 'HIGH' }],
    ['１ ５번 라울 만원', { no: 15, name: '라울', price: 10000, confidence: 'HIGH' }],
  ] as const)('앞 수와 합침: %s', (text, want) => {
    expect(g(text)).toEqual(want)
  })

  it.each([
    ['이 15번 핑크프릴 만원', { no: 15, name: '핑크프릴', price: 10000, confidence: 'HIGH' }],
    ['네 15번 라울 오천 원', { no: 15, name: '라울', price: 5000, confidence: 'HIGH' }],
  ] as const)('앞 토큰을 붙인 글이 수가 아니면 해당 없다: %s', (text, want) => {
    expect(g(text)).toEqual(want)
    expect(hasSplitMarker(text)).toBe(false)
  })

  it('끝 문장 부호가 있던 앞 토큰은 합치지 않고 끊어 말한 번호: `1.`·`1~`·`1?!`', () => {
    for (const text of ['1. 5번 라울 만원', '1~ 5번 라울 만원', '1?! 5 번 라울 만원']) expect(g(text)).toEqual(out({ name: '라울' }))
  })

  it('앞 토큰은 끝말을 떼지 않는다 — `십이요 오번`은 `십이요오`(수 아님)라 5번 그대로', () => {
    expect(g('십이요 오번 라울 만원')).toEqual({ no: 5, name: '라울', price: 10000, confidence: 'HIGH' })
  })

  it('번호 표시가 아닌 X(고유어·`이`)에는 판단이 서지 않는다', () => {
    // `다섯번`은 번호 표시가 아니다 — 번호가 없을 뿐 가격은 그대로
    expect(g('스물 다섯번 라울 만원')).toEqual(out({ name: '라울', price: 10000 }))
    // `이번`은 표시가 아니다
    expect(g('십 이번 라울 만원')).toEqual(out({ name: '라울', price: 10000 }))
  })

  // V3 실방송 8차("오십삼번"을 13번으로 넣음): 앞 토큰도 수면 붙여 R-15로 안 읽혀도 끊어 말한 번호로 본다 — 뒤 조각만 번호로 쓰지 않는다(바뀐 규칙, 약화 아님)
  it('앞 토큰이 수면 붙인 글이 R-15 범위(4자리)를 넘어도 끊어 말한 번호: `1 2345번` → 번호·가격 비움', () => {
    expect(extractVoice('1 2345번 라울 만원', { dictionary: GOLDEN_DICT, maxNumber: 9999 })).toEqual({ no: null, name: '라울', price: null, confidence: 'LOW' })
  })

  it('끊어 말한 표시가 뒤에 와도, 같은 번호를 되풀이해도 비운다 (합칠 수 없는 꼴)', () => {
    expect(g('15번 라울 만원 2 15번')).toEqual(out({ name: '라울' }))
    expect(g('2 15번 2 15번 라울 만원')).toEqual(out({ name: '라울' }))
  })

  it('가격을 비워도 묶음 토큰은 품종 창에서 빠진다 — `오천`이 품종 창에 남아 다른 이름에 맞지 않는다', () => {
    // 사전에 '오천라울'이 있어도 '오천 원' 묶음 토큰은 창에서 빠지므로 '라울'
    expect(extractVoice('2 15번 오천 원 라울', { dictionary: ['라울', '오천원라울'] })).toEqual(out({ name: '라울' }))
  })

  const sentence = fc
    .array(
      fc.oneof(
        fc.constantFrom('1', '5', '15', '5번', '15번', '십', '오번', '이', '십오번', '십 번', '백', '이십', '삼번', '번', '네', '이번', '한', '자', '오', '천', '구',
          '1,', '십.', '１', '５번', '오번이요', '번에', '라울', '핑크프릴', '블루엘프', '만원', '오천', '원', '만오천', '칠천 원', '2345번'),
        fc.string({ maxLength: 3 }),
      ),
      { maxLength: 10 },
    )
    .map((tokens) => tokens.join(' '))

  it('속성: 끊어 말한 표시가 있으면 번호·가격 null이고 LOW, HIGH인 결과의 문장엔 끊어 말한 표시가 없다', () => {
    fc.assert(
      fc.property(sentence, fc.integer({ min: 1, max: 9999 }), (text, maxNumber) => {
        const result = extractVoice(text, { dictionary: GOLDEN_DICT, maxNumber })
        if (hasSplitMarker(text)) {
          expect(result.no).toBe(null)
          expect(result.price).toBe(null)
          expect(result.confidence).toBe('LOW')
        }
        if (result.confidence === 'HIGH') expect(hasSplitMarker(text)).toBe(false)
      }),
      { numRuns: 1000 },
    )
  })

  it('속성: 앞 조각 + 번호 표시를 넣은 문장은 어디에 넣어도 번호·가격을 비운다 — 품종은 그대로 고른다', () => {
    const piece = fc.oneof(
      // V3 D-V3-54: 합칠 수 없는 꼴만 (자리 겹침·`이` 앞 토큰) — 합치는 꼴은 아래 시험
      fc.tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 10, max: 99 })).map(([a, b]) => [String(a), `${String(b)}번`] as const),
      fc.constantFrom(['이', '십 번'], ['이', '십오번'], ['구', '십구번']) as fc.Arbitrary<readonly [string, string]>,
    )
    fc.assert(
      fc.property(piece, fc.constantFrom('핑크프릴', '라울', '블루엘프'), fc.constantFrom('만원', '오천 원', '15,000원'), fc.boolean(), ([head, marker], name, price, markerFirst) => {
        const text = markerFirst ? `${head} ${marker} ${name} ${price}` : `${name} ${price} ${head} ${marker}`
        fc.pre(parseKoreanNumber(head + marker.replace(/ ?번$/, '')) !== null)
        expect(extractVoice(text, { dictionary: GOLDEN_DICT })).toEqual(out({ name }))
      }),
      { numRuns: 300 },
    )
  })
})
