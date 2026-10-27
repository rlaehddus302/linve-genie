// 금화다육 재생 시험 (D-V3-100): 한 글자 다른 이름은 조사 글자로 끝나는 그대로 모양도 쓰지 않는다 — 끝말 뗀 모양은 그대로
import { describe, expect, it } from 'vitest'
import { readSegments } from '../src/index.ts'

const DICT = ['아리엘', '보니타', '야래향', '청개구리']
const picks = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])

describe('AC-V3-91 한 글자 다른 이름 — 조사 글자로 끝나는 그대로 모양 제외 (D-V3-100)', () => {
  it.each([
    ['327번 자 우리 아리가 관심이 없다 보니까 20만 원', null],
    ['327번 아리가 20만 원', null],
    ['327번 아리는 20만 원', null],
    ['327번 아리도 20만 원', null],
    ['327번 야래양이 20만 원', '야래향'],
    ['327번 야래양 20만 원', '야래향'],
    ['327번 야래학 20만 원', '야래향'],
    ['327번 야래양은 20만 원', '야래향'],
    ['327번 야래양도 20만 원', '야래향'],
    ['327번 아리엘이 20만 원', '아리엘'],
    // (8) R-17 5 유사도 0.8 맞추기(자모 거리 1) — 이 규칙과 무관
    ['327번 청개구이 20만 원', '청개구리'],
  ])('%s', (text, name) => {
    expect(picks(text)).toEqual([[327, 200_000, name]])
  })
  it('(9) 잃는 사례: 312번입니다 자 수박이 5만 원 → 품종 빈 칸', () => {
    expect(readSegments('312번입니다 자 수박이 5만 원', { dictionary: ['수박금'], final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])).toEqual([[312, 50_000, null]])
  })
})
