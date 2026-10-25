// P2 적대 테스트 (test-domain): 실제 방송 말투에서 엉뚱한 번호·가격이 HIGH가 되는 길 (AC-P2-01~05, R-17). 통과한 공격을 회귀로 남긴다.
// 기본 사전(DEFAULT_DICTIONARY)으로 부른다 — 방송 중 실제로 쓰는 사전 모양.
import { describe, expect, it } from 'vitest'
import { DEFAULT_DICTIONARY, buildDictionary, extractVoice, prepareDictionary } from '@livejjim/voice'

const dictionary = prepareDictionary(buildDictionary([]))

const run = (text: string) => extractVoice(text, { dictionary })

describe('방송 말투 — 맞게 뽑는 문장', () => {
  it.each([
    ['자 이번엔 15번 핑크프릴 만오천 원', 15, '핑크프릴', 15000],
    ['다음 거 16번 라울 오천 원이요', 16, '라울', 5000],
    ['15번은 라울이고 가격은 오천 원입니다', 15, '라울', 5000],
    ['라울 15번 오천 원', 15, '라울', 5000],
    ['15번 라울 1만5천원', 15, '라울', 15000],
    ['15번 라울 만 이천 원', 15, '라울', 12000],
    ['15번 라울 사천구백 원', 15, '라울', 4900],
    ['15번 라울 만원 2개', 15, '라울', 10000],
    ['15번 라울 칠천원 칠천원', 15, '라울', 7000],
    ['15번 블루엘프 블루 엘프 만원', 15, '블루엘프', 10000],
  ])('%s', (text, no, name, price) => {
    expect(run(text)).toEqual({ no, name, price, confidence: 'HIGH' })
  })
})

// D-V3-03(V3 원 가격 줄): '원'으로 끝나는 띄어 쓴 금액은 이어진 수 전체를 한 가격으로 읽는다 — `2 만 원` = 이만원 = 20,000원 (P2의 '비움' 기대를 바꿈)
describe('방송 말투 — V3 원 가격 줄 (D-V3-03)', () => {
  it('15번 라울 2 만 원 → 20,000원', () => {
    expect(run('15번 라울 2 만 원')).toEqual({ no: 15, name: '라울', price: 20000, confidence: 'HIGH' })
  })
})

describe('방송 말투 — 애매하면 비우고 HIGH가 아니다', () => {
  it.each([
    ['15번 라울 만원 아니 만오천 원', 'price'],
    ['15번 라울 칠천 원에서 오천 원으로 내려요', 'price'],
    ['15번 라울 칠천 원인데 오천 원', 'price'],
    ['15번 라울 만 원 천 원 빼서', 'price'],
    ['15번 라울 이 만 원', 'price'],
    ['15번 라울 5천 500원', 'price'],
    ['15번 라울 만원ㅎㅎ', 'price'],
    ['15번 라울 오십원', 'price'],
    ['15번 라울 10,000', 'price'],
    ['15번 라울 만원 다음은 16번', 'no'],
    ['15번, 16번 라울 만원', 'no'],
    ['열 번 라울 만원', 'no'],
    ['공번 라울 만원', 'no'],
    ['0번 라울 만원', 'no'],
    ['천번 라울 만원', 'no'],
  ] as const)('%s → %s 비움', (text, field) => {
    const result = run(text)
    expect(result[field]).toBeNull()
    expect(result.confidence).toBe('LOW')
  })

  it('기본 사전은 그대로다 (추출이 넘긴 사전을 바꾸지 않는다)', () => {
    const before = [...DEFAULT_DICTIONARY]
    run('15번 핑크 프릴 만원')
    expect(DEFAULT_DICTIONARY).toEqual(before)
  })
})
