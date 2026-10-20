// AC-P2-04 자모 수·거리 계산, AC-P2-06 품종 사전 만들기 (R-17 5, D-203)
import { normalizeText } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BIT_PATTERN_MAX, DEFAULT_DICTIONARY, JamoPattern, bitParallelDistance, buildDictionary, compact, compareSimilarity, editDistance, extractVoice, isCandidate, jamoOf, normalizeDictionary, prepareDictionary } from '../src/index.ts'

describe('자모 = 공백을 지우고 NFD로 푼 코드 포인트', () => {
  it.each([
    ['핑크프릴', 10],
    ['핑크 프릴', 10],
    ['라울', 5],
    ['벨루가', 7],
    ['로라', 4],
    ['닭', 3], // 겹받침(ㄺ)은 종성 코드 포인트 하나
    ['읽기', 5],
    ['왜', 2], // 복모음(ㅙ)은 중성 코드 포인트 하나
    ['뷁', 3],
    ['GT-2', 4], // 영문·숫자·기호는 한 글자 = 한 자모
    ['핑크Frill', 10],
    ['A1 B2', 4],
    ['', 0],
  ])('%s → %s자모', (text, count) => {
    expect(jamoOf(text)).toHaveLength(count)
  })

  it('편집 거리: 넣기·지우기·바꾸기 각 1', () => {
    const d = (a: string, b: string): number => editDistance(jamoOf(a), jamoOf(b))
    expect(d('핑크푸릴', '핑크프릴')).toBe(1) // 중성 하나
    expect(d('나울', '라울')).toBe(1) // 초성 하나
    expect(d('벨루', '벨루가')).toBe(2)
    expect(d('로나', '로라')).toBe(1)
    expect(d('닭', '달')).toBe(1) // 겹받침 ㄺ → ㄹ (코드 포인트 하나 바꾸기)
    expect(d('왜', '외')).toBe(1)
    expect(d('', '라울')).toBe(5)
    expect(d('핑크프리', '핑크프릴')).toBe(1)
  })

  it('비트 병렬 계산(JamoPattern)은 기준 구현과 같다 — 31자모 넘는 패턴은 기준 구현으로', () => {
    const jamoText = fc.string({ unit: fc.constantFrom(...'가각갂나닭라울핑크프릴ab1 '), maxLength: 30 })
    fc.assert(
      fc.property(jamoText, jamoText, (a, b) => {
        const ja = jamoOf(a)
        const jb = jamoOf(b)
        expect(new JamoPattern(ja).distanceTo(jb)).toBe(editDistance(ja, jb))
      }),
      { numRuns: 1000 },
    )
    // 사전 전용 빠른 길(기호 번호·한도)도 같다: 한도 안이면 같은 값, 한도를 넘으면 한도보다 큰 값
    fc.assert(
      fc.property(jamoText, jamoText, fc.integer({ min: 0, max: 8 }), (a, b, limit) => {
        const ja = jamoOf(a)
        const jb = jamoOf(b)
        fc.pre(ja.length >= 1 && ja.length <= BIT_PATTERN_MAX)
        const symbols = new Map<number, number>()
        const ids = Int32Array.from(jb, (code) => {
          if (!symbols.has(code)) symbols.set(code, symbols.size)
          return symbols.get(code) as number
        })
        const peq = new Int32Array(symbols.size)
        ja.forEach((code, i) => {
          const id = symbols.get(code)
          if (id !== undefined) peq[id] = (peq[id] as number) | (1 << i)
        })
        const exact = editDistance(ja, jb)
        const fast = bitParallelDistance(ja.length, peq, ids, limit)
        if (exact <= limit) expect(fast).toBe(exact)
        else expect(fast).toBeGreaterThan(limit)
      }),
      { numRuns: 1000 },
    )
    const long = jamoOf('핑크프릴'.repeat(5)) // 50자모
    expect(new JamoPattern(long).distanceTo(jamoOf('핑크프릴'.repeat(4)))).toBe(10)
  })

  it('후보 = 거리 × 5 ≤ 긴 쪽 자모 수, 비교는 분수로', () => {
    expect(isCandidate({ distance: 1, length: 5 })).toBe(true) // 0.8 경계
    expect(isCandidate({ distance: 1, length: 4 })).toBe(false) // 4자모 이하는 정확히 같아야
    expect(isCandidate({ distance: 2, length: 7 })).toBe(false) // 0.71
    expect(isCandidate({ distance: 2, length: 10 })).toBe(true)
    expect(isCandidate({ distance: 0, length: 0 })).toBe(false)
    // 9/10 = 0.9 > 4/5 = 0.8, 8/10 = 4/5 (같음)
    expect(compareSimilarity({ distance: 1, length: 10 }, { distance: 1, length: 5 })).toBeGreaterThan(0)
    expect(compareSimilarity({ distance: 2, length: 10 }, { distance: 1, length: 5 })).toBe(0)
  })
})

describe('AC-P2-06 품종 사전 만들기 (VOC-03, D-203)', () => {
  it('판매 이력 다음 기본 사전, R-3 정규화, 공백만 다른 이름은 앞의 것, 공백 뺀 1글자·빈 이름은 뺀다', () => {
    const history = ['핑크 프릴', '  라울 ', '금', '', '   ', '라 울', '블루\t엘프']
    const base = ['핑크프릴', '레티지아', '로라', '블루엘프']
    expect(buildDictionary(history, base)).toEqual(['핑크 프릴', '라울', '블루 엘프', '레티지아', '로라'])
  })

  it('넘긴 목록을 바꾸지 않는다, 문자열이 아닌 항목은 건너뛴다', () => {
    const history = Object.freeze(['핑크 프릴', 15 as unknown as string, null as unknown as string])
    const base = Object.freeze(['핑크프릴'])
    expect(buildDictionary(history, base)).toEqual(['핑크 프릴'])
    expect(history).toHaveLength(3)
    expect(normalizeDictionary('핑크프릴' as unknown as string[])).toEqual([])
  })

  it('기본 사전을 생략하면 packages/voice의 기본 사전을 쓴다', () => {
    expect(buildDictionary([])).toEqual(normalizeDictionary(DEFAULT_DICTIONARY))
    expect(buildDictionary(['핑크 프릴'])[0]).toBe('핑크 프릴')
    expect(buildDictionary(['핑크 프릴'])).not.toContain('핑크프릴')
  })

  it('기본 사전: 50개 이상, SPEC 예시 이름이 있고, 공백 뺀 모양 중복·1글자 이름이 없고, 이미 정규화되어 있다', () => {
    expect(DEFAULT_DICTIONARY.length).toBeGreaterThanOrEqual(50)
    for (const name of ['핑크프릴', '방울복랑 금', '라울', '왕비뇌신금', '블루엘프']) expect(DEFAULT_DICTIONARY).toContain(name)
    // 골든·엔진 골든에 나온 이름도 들어 있다 (D-203)
    for (const name of ['핑크프릴 금', '레티지아', '십이지권', '천사의눈물', '벨루가', '로라', '황금사', '블랙프린스', '자보']) expect(DEFAULT_DICTIONARY).toContain(name)
    const keys = DEFAULT_DICTIONARY.map(compact)
    expect(new Set(keys).size).toBe(keys.length)
    for (const name of DEFAULT_DICTIONARY) {
      expect([...compact(name)].length).toBeGreaterThanOrEqual(2)
      expect(normalizeText(name)).toBe(name)
    }
    expect(Object.isFrozen(DEFAULT_DICTIONARY)).toBe(true)
  })

  it('추출 함수도 사전 규칙을 스스로 적용한다 (골든은 정리하지 않은 목록을 넘긴다)', () => {
    const raw = ['핑크 프릴', '핑크프릴', '금', '라울']
    expect(extractVoice('15번 핑크프릴 만원', { dictionary: raw })).toEqual({ no: 15, name: '핑크 프릴', price: 10000, confidence: 'HIGH' })
    expect(extractVoice('15번 금 만원', { dictionary: raw })).toEqual({ no: 15, name: null, price: 10000, confidence: 'LOW' })
  })

  it('준비한 사전은 만든 뒤 넘긴 목록이 바뀌어도 그대로다', () => {
    const names = ['라울']
    const prepared = prepareDictionary(names)
    names.push('핑크프릴')
    expect(prepared.size).toBe(1)
    expect(extractVoice('15번 핑크프릴 만원', { dictionary: prepared }).name).toBe(null)
    expect(Object.isFrozen(prepared)).toBe(true)
  })

  it('기본 사전으로 실제 방송 말투의 흔한 말이 품종이 되지 않는다', () => {
    const dictionary = prepareDictionary(buildDictionary([]))
    for (const text of ['자 이번엔 다음 거 보여 드릴게요', '이거 진짜 예뻐요 당연하죠', '안녕하세요 여러분 반가워요', '은행 계좌로 입금해 주세요', '오늘 방송 시작합니다']) {
      expect(extractVoice(text, { dictionary }).name, text).toBe(null)
    }
  })
})
