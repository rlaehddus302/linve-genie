// 실방송 경성다육 재생 시험 (D-V3-96·97·98): 한 글자 다른 이름의 풀이말 끝 그대로 모양, 앞 이름과 겹친 '금', 품종 창의 '입니다요'
import { describe, expect, it } from 'vitest'
import { extractVoice, prepareVoiceDictionary, readSegments, varietyFromContext } from '../src/index.ts'

const picks = (text: string, dictionary: readonly string[]) => readSegments(text, { dictionary, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])

describe('AC-V3-88 한 글자 다른 이름 — 풀이말 끝으로 끝나는 그대로 모양은 쓰지 않는다 (D-V3-96)', () => {
  const DICT = ['수박금', '불꽃수박금', '야래향']
  it.each([
    ['238번 불꽃 수박요 아이는 15만 원', null],
    ['238번 수박요 15만 원', null],
    ['238번 야래양 15만 원', '야래향'],
    ['238번 야래양이 15만 원', '야래향'],
    ['238번 수박금이요 15만 원', '수박금'],
  ])('%s', (text, name) => {
    expect(picks(text, DICT)).toEqual([[238, 150_000, name]])
  })
})

describe('AC-V3-89 앞 이름과 겹친 금 (D-V3-97)', () => {
  const DICT = ['수박금', '로제수박', '불꽃수박금']
  const cases: [string, string | null][] = [
    ['89번 로제 수박금 3만 원', null],
    ['89번 로제 수박 금 3만 원', null],
    ['89번 로제수박 금 3만 원', '로제수박금'],
    ['89번 불꽃 수박금 3만 원', '불꽃수박금'],
    ['89번 수박금 3만 원', '수박금'],
    ['89번 자 수박금 3만 원', '수박금'],
  ]
  it.each(cases)('readSegments: %s', (text, name) => {
    expect(picks(text, DICT)).toEqual([[89, 30_000, name]])
  })
  it.each(cases)('extract: %s', (text, name) => {
    const result = extractVoice(text, { dictionary: DICT })
    expect([result.no, result.price, result.name]).toEqual([89, 30_000, name])
  })
  it('사전에 로제수박금을 더하면 로제 수박금 → 로제수박금', () => {
    const more = [...DICT, '로제수박금']
    expect(picks('89번 로제 수박금 3만 원', more)).toEqual([[89, 30_000, '로제수박금']])
    expect(extractVoice('89번 로제 수박금 3만 원', { dictionary: more }).name).toBe('로제수박금')
  })
  it('색금으로 끝나는 이름도 같다 — 로제 수박색금은 비움', () => {
    expect(extractVoice('89번 로제 수박색금 3만 원', { dictionary: ['수박색금', '로제수박'] }).name).toBeNull()
  })
})

describe('AC-V3-90 품종 창에서만 입니다요를 뗀다 (D-V3-98)', () => {
  const DICT = ['보카치노', '라울']
  it.each([
    ['57번 보카 치노입니다요 4만 원', '보카치노'],
    ['57번 보카치노입니다요 4만 원', '보카치노'],
    ['57번 보카 치너입니다요 4만 원', null],
  ])('%s', (text, name) => {
    expect(picks(text, DICT)).toEqual([[57, 40_000, name]])
    expect(extractVoice(text, { dictionary: DICT }).name).toBe(name)
  })
  it('뗀 모양이 정확히 맞으면 신뢰도 HIGH', () => {
    expect(extractVoice('57번 보카치노입니다요 4만 원', { dictionary: DICT }).confidence).toBe('HIGH')
  })
  it('57번입니다요 4만 원 — 번호 표시 아님(지금 그대로)', () => {
    expect(extractVoice('57번입니다요 4만 원', { dictionary: DICT }).no).toBeNull()
  })
  it('입니다요 뗀 모양은 유사도 맞추기에 쓰지 않는다 — 기본 사전', () => {
    expect(extractVoice('57번 보카 치너입니다요 4만 원', { dictionary: prepareVoiceDictionary() }).name).not.toBe('보카치노')
  })
})

describe('AC-V3-90 입니다요 뗀 모양은 맥락 점수에 쓰지 않는다 (R-17 8 1b)', () => {
  it('앞 말 "보카 치노입니다요" 두 번 — 맥락 품종 없음, 붙여 쓴 "보카치노예요" 두 번은 보카치노', () => {
    const dictionary = ['보카치노', '라울']
    expect(varietyFromContext({ name: null, context: ['보카 치노입니다요', '보카 치노입니다요'], dictionary })).toBeNull()
    expect(varietyFromContext({ name: null, context: ['보카치노예요', '보카치노예요'], dictionary })).toBe('보카치노')
  })
})
