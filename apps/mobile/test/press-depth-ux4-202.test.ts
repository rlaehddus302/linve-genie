// D-UX4-202 (사용자 지시 2026-11-16 "버튼 꾹 눌렀을 때와 놓았을 때 애니메이션 더 부드럽게 하고 눌리는 정도를 사진 2, 3의 검색버튼 크기 차이로 유추해서 전역 적용하라"):
// 토스 머리 돋보기 43 → 39px = 0.91배. 작은 단추는 0.91배, 큰 것은 양쪽 합쳐 8pt까지만 줄고, 크기를 모르면 0.97배. 움직임은 120ms 들어가고 260ms 풀린다.
import { describe, expect, it } from 'vitest'
import { PRESS_IN_MS, PRESS_OUT_MS, PRESS_SCALE_MIN, PRESS_SHRINK_PT, TAP_SCALE, pressScaleFor } from '../src/ui/kit/press.tsx'

describe('눌림 깊이는 크기에 맞춘다 (D-UX4-202)', () => {
  it('토스 돋보기 비율: 가장 깊이 0.91배, 큰 것은 8pt까지', () => {
    expect(PRESS_SCALE_MIN).toBe(0.91)
    expect(PRESS_SHRINK_PT).toBe(8)
    expect(TAP_SCALE).toBe(0.97)
  })

  it('작은 단추(40·48pt)는 0.91배', () => {
    expect(pressScaleFor(40)).toBe(0.91)
    expect(pressScaleFor(48)).toBe(0.91)
    expect(pressScaleFor(1)).toBe(0.91)
  })

  it('큰 것은 양쪽 합쳐 8pt만 줄어든다', () => {
    expect(pressScaleFor(100)).toBeCloseTo(0.92, 10)
    expect(pressScaleFor(200)).toBeCloseTo(0.96, 10)
    expect(pressScaleFor(400)).toBeCloseTo(0.98, 10)
    for (const size of [89, 120, 250, 390, 430, 800]) expect(size * (1 - pressScaleFor(size))).toBeLessThanOrEqual(PRESS_SHRINK_PT + 1e-9)
  })

  it('크기가 클수록 덜 줄어든다 (뒤집히지 않는다)', () => {
    let last = 0
    for (let size = 1; size <= 1000; size += 1) {
      const scale = pressScaleFor(size)
      expect(scale).toBeGreaterThanOrEqual(last)
      expect(scale).toBeLessThan(1)
      last = scale
    }
  })

  it('크기를 모르면(재기 전·0·이상한 값) 0.97배', () => {
    expect(pressScaleFor(undefined)).toBe(0.97)
    expect(pressScaleFor(0)).toBe(0.97)
    expect(pressScaleFor(-5)).toBe(0.97)
    expect(pressScaleFor(Number.NaN)).toBe(0.97)
    expect(pressScaleFor(Number.POSITIVE_INFINITY)).toBe(0.97)
  })

  it('움직임: 들어갈 때 120ms, 풀릴 때 260ms (옛 70·160ms보다 부드럽게)', () => {
    expect(PRESS_IN_MS).toBe(120)
    expect(PRESS_OUT_MS).toBe(260)
  })
})
