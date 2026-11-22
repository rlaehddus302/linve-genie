// 라벨 칸 스냅 계산 (D-LABEL-SNAP-01, 사용자 지시 2026-11-23 "주변 박스들의 위치에 맞춰 스냅 … 파워포인트에서처럼 … 사이즈 조절할 때도 주변 박스와 스냅")
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { snapMove, snapResize, type SnapRect } from '../src/lib/label-snap.ts'

/** 50×30mm 라벨 그림 (384×240점) */
const FRAME: SnapRect = { x: 0, y: 0, width: 384, height: 240 }
/** 기준 칸: 왼 100 · 가운데 150 · 오른 200 / 위 100 · 가운데 120 · 아래 140 */
const OTHER: SnapRect = { x: 100, y: 100, width: 100, height: 40 }
const NO_MIN = { width: 1, height: 1 }

describe('옮기기 (snapMove)', () => {
  it('왼쪽 선을 다른 칸 왼쪽에 맞춘다', () => {
    const { rect, guides } = snapMove({ x: 104, y: 20, width: 60, height: 30 }, [OTHER], FRAME, 6)
    expect(rect).toEqual({ x: 100, y: 20, width: 60, height: 30 })
    expect(guides).toContainEqual({ axis: 'x', at: 100, from: 20, to: 140 })
  })

  it('가운데 선을 다른 칸 가운데에 맞춘다', () => {
    // 가운데 = 133 + 20 = 153 → 150
    const { rect, guides } = snapMove({ x: 133, y: 10, width: 40, height: 30 }, [OTHER], FRAME, 6)
    expect(rect.x).toBe(130)
    expect(guides.some((g) => g.axis === 'x' && g.at === 150)).toBe(true)
  })

  it('오른쪽 선을 다른 칸 오른쪽에 맞춘다', () => {
    const { rect } = snapMove({ x: 143, y: 10, width: 60, height: 30 }, [OTHER], FRAME, 6)
    expect(rect.x + rect.width).toBe(200)
  })

  it('두 축을 함께 맞춘다 — 다른 칸 오른쪽 옆에 위를 맞춰 붙이기', () => {
    const { rect, guides } = snapMove({ x: 203, y: 97, width: 50, height: 40 }, [OTHER], FRAME, 6)
    expect(rect).toEqual({ x: 200, y: 100, width: 50, height: 40 })
    expect(guides.filter((g) => g.axis === 'x').map((g) => g.at)).toContain(200)
    expect(guides.filter((g) => g.axis === 'y').map((g) => g.at)).toContain(100)
  })

  it('threshold 밖이면 맞추지 않고 안내선도 없다', () => {
    const moving = { x: 20, y: 30, width: 30, height: 20 }
    const { rect, guides } = snapMove(moving, [OTHER], { x: -500, y: -500, width: 2000, height: 2000 }, 6)
    expect(rect).toEqual(moving)
    expect(guides).toEqual([])
  })

  it('후보가 여럿이면 가장 가까운 것에 맞춘다', () => {
    const near: SnapRect = { x: 108, y: 180, width: 60, height: 20 }
    // 선 105·125·145: OTHER 왼쪽 100(5)·오른쪽 200, near 왼쪽 108(3)·가운데 138·오른쪽 168 — 3 차이인 near 왼쪽이 가장 가깝다
    const { rect } = snapMove({ x: 105, y: 20, width: 40, height: 20 }, [OTHER, near], FRAME, 6)
    expect(rect.x).toBe(108)
  })

  it('라벨 틀의 가장자리와 가운데에도 맞춘다', () => {
    expect(snapMove({ x: 4, y: 50, width: 40, height: 20 }, [], FRAME, 6).rect.x).toBe(0)
    expect(snapMove({ x: 340, y: 50, width: 40, height: 20 }, [], FRAME, 6).rect.x).toBe(344)
    const centered = snapMove({ x: 170, y: 107, width: 40, height: 20 }, [], FRAME, 6)
    expect(centered.rect).toEqual({ x: 172, y: 110, width: 40, height: 20 })
    // 틀에 맞은 안내선은 틀 전체 길이
    expect(centered.guides).toContainEqual({ axis: 'x', at: 192, from: 0, to: 240 })
    expect(centered.guides).toContainEqual({ axis: 'y', at: 120, from: 0, to: 384 })
  })

  it('틀 밖으로 나가지 않는다', () => {
    expect(snapMove({ x: -50, y: 230, width: 60, height: 30 }, [], FRAME, 6).rect).toEqual({ x: 0, y: 210, width: 60, height: 30 })
    expect(snapMove({ x: 400, y: -9, width: 60, height: 30 }, [], FRAME, 6).rect).toEqual({ x: 324, y: 0, width: 60, height: 30 })
  })

  it('같은 자리의 안내선은 하나로 합쳐 맞은 칸 모두를 덮는다', () => {
    const below: SnapRect = { x: 100, y: 200, width: 30, height: 20 }
    const { guides } = snapMove({ x: 102, y: 20, width: 50, height: 30 }, [OTHER, below], FRAME, 6)
    expect(guides.filter((g) => g.axis === 'x' && g.at === 100)).toEqual([{ axis: 'x', at: 100, from: 20, to: 220 }])
  })

  it('결과는 늘 정수다', () => {
    const { rect, guides } = snapMove({ x: 31.4, y: 70.6, width: 33.2, height: 21.7 }, [{ x: 0.5, y: 0.5, width: 10.3, height: 10.1 }], { x: 0, y: 0, width: 383.6, height: 240 }, 2)
    for (const value of Object.values(rect)) expect(Number.isInteger(value)).toBe(true)
    for (const guide of guides) expect(Number.isFinite(guide.at)).toBe(true)
  })
})

describe('크기 바꾸기 (snapResize)', () => {
  it('오른쪽 모서리를 다른 칸 오른쪽에 맞추고 왼쪽 위는 그대로', () => {
    const { rect, guides } = snapResize({ x: 20, y: 20, width: 176, height: 30 }, { right: true, bottom: false }, [OTHER], FRAME, 6, NO_MIN)
    expect(rect).toEqual({ x: 20, y: 20, width: 180, height: 30 })
    expect(guides).toEqual([{ axis: 'x', at: 200, from: 20, to: 140 }])
  })

  it('아래 모서리를 다른 칸 가운데·아래에 맞춘다', () => {
    expect(snapResize({ x: 10, y: 60, width: 40, height: 57 }, { right: false, bottom: true }, [OTHER], FRAME, 6, NO_MIN).rect.height).toBe(60)
    expect(snapResize({ x: 10, y: 60, width: 40, height: 83 }, { right: false, bottom: true }, [OTHER], FRAME, 6, NO_MIN).rect.height).toBe(80)
  })

  it('켜지지 않은 모서리는 맞추지 않고 안내선도 없다', () => {
    const { rect, guides } = snapResize({ x: 20, y: 20, width: 176, height: 78 }, { right: false, bottom: false }, [OTHER], FRAME, 6, NO_MIN)
    expect(rect).toEqual({ x: 20, y: 20, width: 176, height: 78 })
    expect(guides).toEqual([])
  })

  it('min 아래로 줄이지 않는다 — min 아래가 되는 선에는 붙지 않는다', () => {
    const min = { width: 60, height: 24 }
    expect(snapResize({ x: 95, y: 10, width: 20, height: 10 }, { right: true, bottom: true }, [OTHER], FRAME, 6, min).rect).toEqual({ x: 95, y: 10, width: 60, height: 24 })
    // 오른쪽 100 에 붙으면 폭 5 → min 60 아래라 붙지 않는다
    const { rect, guides } = snapResize({ x: 95, y: 10, width: 61, height: 30 }, { right: true, bottom: false }, [OTHER], FRAME, 6, min)
    expect(rect.width).toBe(61)
    expect(guides).toEqual([])
  })

  it('틀 밖으로 늘어나지 않는다', () => {
    const { rect } = snapResize({ x: 300, y: 200, width: 200, height: 90 }, { right: true, bottom: true }, [], FRAME, 6, NO_MIN)
    expect(rect).toEqual({ x: 300, y: 200, width: 84, height: 40 })
  })

  it('틀 오른쪽·가운데에 맞춘다', () => {
    expect(snapResize({ x: 300, y: 10, width: 80, height: 20 }, { right: true, bottom: false }, [], FRAME, 6, NO_MIN).rect.width).toBe(84)
    expect(snapResize({ x: 100, y: 10, width: 95, height: 20 }, { right: true, bottom: false }, [], FRAME, 6, NO_MIN).rect.width).toBe(92)
  })

  it('threshold 밖이면 그대로(정수로)', () => {
    const { rect, guides } = snapResize({ x: 10.2, y: 10.7, width: 30.4, height: 20.6 }, { right: true, bottom: true }, [OTHER], FRAME, 3, NO_MIN)
    expect(rect).toEqual({ x: 10, y: 11, width: 30, height: 21 })
    expect(guides).toEqual([])
  })
})
