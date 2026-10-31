// 디자인 토큰 시험: 밝은·어두운 모드 모든 글자-바탕 쌍이 대비 기준을 넘고, 크기 약속을 지킨다.
import { describe, expect, it } from 'vitest'
import { contrastRatio, passesAA } from '../src/ui/kit/contrast.ts'
import { contrastPairs, PALETTE, TONES, TOUCH, TYPE, type Scheme } from '../src/ui/kit/tokens.ts'

const SCHEMES: readonly Scheme[] = ['light', 'dark']

describe('대비 계산', () => {
  it('검정/흰색은 21:1, 같은 색은 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
    expect(passesAA('#757575', '#ffffff')).toBe(true)
    expect(passesAA('#999999', '#ffffff')).toBe(false)
  })
})

describe.each(SCHEMES)('색 쌍 대비 (%s)', (scheme) => {
  for (const pair of contrastPairs(scheme)) {
    it(`${pair.name} ${String(pair.min)}:1 이상`, () => {
      expect(contrastRatio(pair.fg, pair.bg), `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min)
    })
  }
  it('상태 5가지가 모두 쌍에 들어 있다', () => {
    expect(Object.keys(TONES[scheme]).sort()).toEqual(['danger', 'info', 'neutral', 'success', 'warning'])
    expect(Object.keys(PALETTE[scheme]).length).toBeGreaterThan(15)
  })
})

describe('크기 약속', () => {
  it('본문 18 이상, 가장 작은 글자 16, 누르는 곳 52 이상', () => {
    expect(TYPE.body).toBeGreaterThanOrEqual(18)
    expect(Math.min(...Object.values(TYPE))).toBeGreaterThanOrEqual(16)
    expect(TOUCH.min).toBeGreaterThanOrEqual(52)
    expect(TOUCH.button).toBeGreaterThanOrEqual(60)
    expect(TOUCH.key).toBeGreaterThanOrEqual(64)
    expect(TOUCH.gap).toBeGreaterThanOrEqual(8)
  })
})
