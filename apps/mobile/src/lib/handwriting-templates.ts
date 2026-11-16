// 손글씨 숫자 기본 모양 (D-HANDWRITE-01): 0~9를 흔히 쓰는 꼴 몇 가지씩, 100 × 100 칸(아래로 갈수록 y가 크다)에 선·호로 그린다.
// 획 차례·방향은 상관없다($P). 한국에서 흔한 꼴: 꼬리 없는 1, 머리 꺾인 7(ㄱ), 위가 열린 4, 두 획 5.
import { makeTemplate, type DigitTemplate, type InkPoint, type InkStroke } from './handwriting.ts'

type Pt = readonly [number, number]

/** 꺾은선 */
export const line = (...pts: readonly Pt[]): InkPoint[] => pts.map(([x, y]) => ({ x, y }))

/** 타원 호: 각도는 도(0 = 오른쪽, 90 = 아래 — 화면 y가 아래로), from → to로 */
export function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 24): InkPoint[] {
  const out: InkPoint[] = []
  for (let i = 0; i <= steps; i += 1) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
  }
  return out
}

/** 조각을 이어 한 획으로 */
export const join = (...parts: readonly (readonly InkPoint[])[]): InkPoint[] => parts.flat()

/** 세로 8자: 위 고리가 조금 작다 */
function eight(top: number, bottom: number, width: number): InkPoint[] {
  const out: InkPoint[] = []
  for (let i = 0; i <= 48; i += 1) {
    const t = (i / 48) * Math.PI * 2
    const y = 50 - 45 * Math.cos(t)
    const upper = y < 50
    const x = 50 - width * Math.sin(2 * t) * (upper ? top : bottom)
    out.push({ x, y })
  }
  return out
}

/** 숫자마다 기본 모양 (획 목록들) */
export const DIGIT_SHAPES: Readonly<Record<string, readonly (readonly InkStroke[])[]>> = {
  '0': [[arc(50, 50, 30, 45, -90, 270)], [arc(50, 50, 20, 45, -100, 260)], [arc(50, 50, 38, 45, -60, 300)]],
  '1': [[line([50, 5], [50, 95])], [line([33, 22], [52, 5], [50, 95])], [line([52, 5], [46, 95])]],
  '2': [
    [join(arc(50, 30, 28, 25, 195, 400), line([20, 95], [82, 95]))],
    [line([20, 25], [50, 6], [80, 25], [20, 95], [82, 95])],
    [join(arc(50, 30, 27, 25, 200, 380), line([77, 30], [22, 95], [80, 92]))],
  ],
  '3': [
    [join(arc(50, 28, 26, 23, 200, 450), arc(50, 72, 28, 23, 270, 520))],
    [join(line([20, 5], [78, 5], [45, 45]), arc(50, 70, 28, 25, 250, 520))],
    [join(arc(48, 27, 24, 22, 210, 440), line([48, 49]), arc(48, 72, 30, 23, 270, 510))],
  ],
  '4': [
    [line([60, 5], [15, 65], [85, 65]), line([65, 30], [65, 95])],
    [line([25, 5], [20, 60], [85, 60]), line([65, 10], [65, 95])],
    [line([65, 95], [65, 5], [15, 65], [85, 65])],
  ],
  '5': [
    [join(line([30, 5], [25, 45]), arc(48, 67, 27, 26, 235, 500)), line([30, 5], [80, 5])],
    [join(line([80, 5], [30, 5], [25, 45]), arc(48, 67, 27, 26, 235, 500))],
    [join(line([28, 5], [24, 42]), arc(46, 66, 30, 28, 240, 510)), line([28, 5], [76, 3])],
  ],
  '6': [
    [join(arc(75, 55, 50, 50, 260, 180), arc(50, 70, 25, 25, 180, -180))],
    [join(line([65, 5], [28, 55]), arc(50, 70, 23, 24, 200, -160))],
    [join(arc(70, 60, 42, 55, 255, 180), arc(52, 72, 24, 22, 180, -180))],
  ],
  '7': [
    [line([15, 8], [85, 8], [40, 95])],
    [line([15, 25], [15, 8], [85, 8], [45, 95])],
    [line([15, 8], [85, 8], [40, 95]), line([40, 50], [78, 50])],
    [line([18, 8], [82, 6], [62, 50], [55, 95])],
  ],
  '8': [[eight(0.85, 1, 32)], [arc(50, 28, 22, 23, 0, 360), arc(50, 72, 27, 23, -90, 270)], [eight(1, 1, 30)]],
  '9': [
    [join(arc(48, 30, 25, 25, 0, -360), line([73, 30], [70, 95]))],
    [join(arc(48, 30, 25, 25, 0, -360), line([73, 30], [72, 75], [55, 95]))],
    [arc(48, 30, 25, 25, 0, 360), line([73, 30], [70, 95])],
    [join(arc(45, 28, 25, 23, 10, -350), line([70, 32], [60, 95]))],
  ],
}

/** 기본 모양 (정규화한 점 구름) — 한 번 만들어 둔다 */
let base: DigitTemplate[] | null = null
export function baseTemplates(): readonly DigitTemplate[] {
  base ??= Object.entries(DIGIT_SHAPES).flatMap(([digit, shapes]) => shapes.map((strokes) => makeTemplate(digit, strokes)))
  return base
}
