// 라벨 칸 스냅 (D-LABEL-SNAP-01, 사용자 지시 2026-11-23 "각 항목 박스 눌러서 위치 이동 시킬 때 주변 박스들의 위치에 맞춰 스냅 …
// 파워포인트에서처럼 … 사이즈 조절할 때도 주변 박스와 스냅").
// 옮기는 칸의 왼·가운데·오른쪽 선(가로 축)과 위·가운데·아래 선(세로 축)을 다른 칸과 라벨 틀의 같은 선에 맞춘다.
// 축마다 가장 가까운 선 하나에, threshold(점) 안일 때만 붙는다. 맞은 선에는 안내선을 돌려준다 — 파워포인트 스마트 가이드처럼.
// 좌표는 모두 템플릿 점(라벨 그림 전체 기준)이고 결과는 정수다(L-5). 순수 함수 — 시계·입출력 없음.

/** 템플릿 점 좌표의 네모 (라벨 그림 전체 기준) */
export interface SnapRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 화면에 그릴 안내선: axis 'x' = 세로선(x=at, y from~to), 'y' = 가로선(y=at, x from~to) */
export interface SnapGuide {
  readonly axis: 'x' | 'y'
  readonly at: number
  readonly from: number
  readonly to: number
}

export interface SnapResult {
  readonly rect: SnapRect
  readonly guides: readonly SnapGuide[]
}

type Axis = 'x' | 'y'

/** 반올림으로 생기는 반 점 차이(가운데 선)까지는 맞은 것으로 본다 */
const SAME = 0.5

const start = (r: SnapRect, axis: Axis) => (axis === 'x' ? r.x : r.y)
const size = (r: SnapRect, axis: Axis) => (axis === 'x' ? r.width : r.height)
/** 한 축의 세 선: 시작·가운데·끝 */
const lines = (r: SnapRect, axis: Axis): readonly number[] => [start(r, axis), start(r, axis) + size(r, axis) / 2, start(r, axis) + size(r, axis)]
/** 다른 축 */
const across = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')

/** 붙을 수 있는 칸들: 다른 칸 + 라벨 틀 */
const sourcesOf = (others: readonly SnapRect[], frame: SnapRect): readonly SnapRect[] => [...others, frame]

/** movingLines 중 하나를 sources 의 선에 맞추는 가장 작은 이동 거리 (threshold 안, accept 를 통과한 것만). 없으면 null */
function nearestShift(movingLines: readonly number[], sources: readonly SnapRect[], axis: Axis, threshold: number, accept: (shift: number) => boolean = () => true): number | null {
  let best: number | null = null
  for (const line of movingLines) {
    for (const source of sources) {
      for (const target of lines(source, axis)) {
        const shift = target - line
        if (Math.abs(shift) > threshold || !accept(shift)) continue
        if (best === null || Math.abs(shift) < Math.abs(best)) best = shift
      }
    }
  }
  return best
}

/** 결과 칸의 선(checkLines)과 딱 맞은 칸들마다 안내선 — 같은 자리의 안내선은 하나로 합쳐 둘 다 덮는 길이로 */
function guidesFor(rect: SnapRect, checkLines: readonly number[], sources: readonly SnapRect[], axis: Axis): SnapGuide[] {
  const other = across(axis)
  const byAt = new Map<number, { from: number; to: number }>()
  for (const line of checkLines) {
    for (const source of sources) {
      for (const target of lines(source, axis)) {
        if (Math.abs(target - line) > SAME) continue
        const from = Math.min(start(rect, other), start(source, other))
        const to = Math.max(start(rect, other) + size(rect, other), start(source, other) + size(source, other))
        const now = byAt.get(target)
        byAt.set(target, now === undefined ? { from, to } : { from: Math.min(now.from, from), to: Math.max(now.to, to) })
      }
    }
  }
  return [...byAt.entries()].map(([at, { from, to }]) => ({ axis, at, from, to }))
}

/** 시작 자리를 틀 안으로 (칸이 틀보다 크면 틀 시작에 붙인다) */
const clampStart = (value: number, length: number, frameStart: number, frameLength: number) => Math.max(frameStart, Math.min(value, frameStart + frameLength - length))

/** 옮기기: moving 의 왼·가운데·오른 / 위·가운데·아래를 others 와 frame 의 같은 선들에 가장 가까운 것 하나씩(축마다) 맞춘다. threshold(점) 안일 때만. 결과는 frame 안으로 clamp */
export function snapMove(moving: SnapRect, others: readonly SnapRect[], frame: SnapRect, threshold: number): SnapResult {
  const sources = sourcesOf(others, frame)
  const width = Math.round(moving.width)
  const height = Math.round(moving.height)
  const shiftX = nearestShift(lines(moving, 'x'), sources, 'x', threshold) ?? 0
  const shiftY = nearestShift(lines(moving, 'y'), sources, 'y', threshold) ?? 0
  const x = clampStart(Math.round(moving.x + shiftX), width, Math.round(frame.x), Math.round(frame.width))
  const y = clampStart(Math.round(moving.y + shiftY), height, Math.round(frame.y), Math.round(frame.height))
  const rect = { x, y, width, height }
  return { rect, guides: [...guidesFor(rect, lines(rect, 'x'), sources, 'x'), ...guidesFor(rect, lines(rect, 'y'), sources, 'y')] }
}

/**
 * 크기 바꾸기: 움직이는 모서리(right·bottom 중 켜진 것)만 others·frame 의 선(왼·가운데·오른/위·가운데·아래)에 맞춘다.
 * x·y(왼쪽 위)는 고정. min 아래로 줄이지 않는다 — 틀과 다투면 min 이 이긴다(칸이 좁아 라벨을 못 만드는 것보다 낫다). 그 밖에는 frame 밖으로 안 나간다.
 */
export function snapResize(moving: SnapRect, edges: { readonly right: boolean; readonly bottom: boolean }, others: readonly SnapRect[], frame: SnapRect, threshold: number, min: { readonly width: number; readonly height: number }): SnapResult {
  const sources = sourcesOf(others, frame)
  const x = Math.round(moving.x)
  const y = Math.round(moving.y)
  /** 한 축의 끝 모서리를 맞추고 min·틀로 자른 길이 */
  const fit = (axis: Axis, on: boolean, minLength: number): number => {
    const length = size(moving, axis)
    const begin = axis === 'x' ? x : y
    const frameEnd = start(frame, axis) + size(frame, axis)
    const room = Math.max(minLength, Math.round(frameEnd) - begin)
    const shift = on ? nearestShift([begin + length], sources, axis, threshold, (s) => length + s >= minLength && length + s <= room) ?? 0 : 0
    return Math.max(Math.ceil(minLength), Math.min(Math.round(length + shift), room))
  }
  const width = fit('x', edges.right, min.width)
  const height = fit('y', edges.bottom, min.height)
  const rect = { x, y, width, height }
  return {
    rect,
    guides: [
      ...(edges.right ? guidesFor(rect, [x + width], sources, 'x') : []),
      ...(edges.bottom ? guidesFor(rect, [y + height], sources, 'y') : []),
    ],
  }
}
