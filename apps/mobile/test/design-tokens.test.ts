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
  // 옛 약속(D-UX2-01): 본문 18·최소 16·누름 52·버튼 60·키 64. 새 약속(D-UX3-07, 사용자 지시 "토스 치수 그대로"): 본문 16·최소 14·줄 48·버튼 54·키 60
  // D-UX3-51로 바뀐 기대 (사용자 지시 2026-11-07 토스 사진 비교): 옛 "탭 12 말고는 14 이상" → 새 "탭 12, 입력 칸 위 라벨·칸 아래 문장 13(토스 재기), 나머지 14 이상"
  // D-UX3-74로 바뀐 기대 (사용자 지시 2026-11-09 "글자 크기 다 줄이셈"): 모든 단계를 약 10% 줄임 — 본문 15, 가장 작은 글자 13, 탭 11, 입력 칸 라벨·문장 12
  it('본문 15 이상, 가장 작은 글자 13(아래 탭 11, 입력 칸 라벨·문장 12 — D-UX3-74), 누르는 줄 48·큰 버튼 54·숫자판 키 60 이상', () => {
    expect(TYPE.body).toBeGreaterThanOrEqual(15)
    const { tab, note, ...rest } = TYPE
    expect(Math.min(...Object.values(rest))).toBeGreaterThanOrEqual(13)
    expect(tab).toBe(11)
    expect(note).toBe(12)
    expect(TOUCH.min).toBeGreaterThanOrEqual(48)
    expect(TOUCH.button).toBeGreaterThanOrEqual(54)
    expect(TOUCH.key).toBeGreaterThanOrEqual(60)
    expect(TOUCH.gap).toBeGreaterThanOrEqual(8)
  })
})
