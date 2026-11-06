// 아래 탭 아이콘 (D-UX3-12, 사용자 지시 2026-11-03 "가운데 셋이 다 네모라 헷갈림"): 24 칸 SVG, 가로세로가 거의 같다(1:1).
// 홈 = 토스식 둥근 집(가운데 문), 라벨 = 프린터, 정산 = 영수증(아래 톱니), 포장 = 상자 + 가운데 박스테이프 한 줄, 전체 = 세 줄.
// 고른 탭은 같은 치수에서 속을 채우고 안쪽 선(종이·글줄·테이프)은 놓인 바탕 색으로 뚫는다 — 선 모양과 겉 크기가 같다.
// D-UX3-13: 집 문은 바닥 선을 끊고 그 자리를 비운 홈(문 아래 선 없음), 프린터 몸통 아래 선은 종이 앞에서 끊고(겹치는 선 없음), 고른 상자는 테이프 자리의 윗선까지 뚫는다.
import Svg, { Circle, Line, Path } from 'react-native-svg'
import { View } from 'react-native'

export type TabIconName = 'home' | 'printer' | 'receipt' | 'box' | 'truck' | 'menu'

const STROKE = 1.9

// 아이폰 모서리 곡률 (D-UX3-15, 사용자 지시 2026-11-03 "모든 아이콘·상자·터치 영역의 곡률을 아이폰 곡률로"): 원호 대신 연속 곡률 모서리.
// 반지름 r 모서리가 변을 따라 1.528r에서 시작해 세 개의 3차 곡선으로 돈다(UIKit 연속 모서리 근사 계수). u = 들어오는 변을 거슬러 간 거리, v = 나가는 변을 따라간 거리(r 배)
const SMOOTH: readonly (readonly [number, number])[] = [
  [1.52866483, 0],
  [1.08849296, 0],
  [0.86840694, 0],
  [0.63149399, 0.074911],
  [0.37282392, 0.1690541],
  [0.1690541, 0.37282392],
  [0.074911, 0.63149399],
  [0, 0.86840694],
  [0, 1.08849296],
  [0, 1.52866483],
]
const num = (value: number) => String(Number(value.toFixed(3)))
type Dir = readonly [number, number]
/** 꼭짓점 (px,py)의 연속 곡률 모서리: 시작점(그 앞까지 L로 잇는다)과 세 곡선 */
export function smoothCorner(px: number, py: number, into: Dir, out: Dir, r: number): { readonly start: string; readonly curve: string } {
  const at = ([u, v]: readonly [number, number]) => `${num(px - u * r * into[0] + v * r * out[0])} ${num(py - u * r * into[1] + v * r * out[1])}`
  const pts = SMOOTH.map(at)
  return { start: pts[0] as string, curve: `C${pts[1]} ${pts[2]} ${pts[3]} C${pts[4]} ${pts[5]} ${pts[6]} C${pts[7]} ${pts[8]} ${pts[9]}` }
}
/** 연속 곡률 둥근 네모 (시계 방향) */
export function smoothRect(x: number, y: number, w: number, h: number, r: number): string {
  const corners = [smoothCorner(x + w, y, [1, 0], [0, 1], r), smoothCorner(x + w, y + h, [0, 1], [-1, 0], r), smoothCorner(x, y + h, [-1, 0], [0, -1], r), smoothCorner(x, y, [0, -1], [1, 0], r)]
  return `M${corners.map((corner) => `${corner.start} ${corner.curve}`).join(' L')} Z`
}

const HOUSE = (() => {
  const right = smoothCorner(20.4, 20.8, [0, 1], [-1, 0], 2.2)
  const left = smoothCorner(3.6, 20.8, [-1, 0], [0, -1], 2.2)
  return `M3.6 10.4 L12 3.4 L20.4 10.4 L${right.start} ${right.curve} H14.1 V16.2 A2.1 2.1 0 0 0 9.9 16.2 V20.8 L${left.start} ${left.curve} Z`
})()
const PRINTER_BODY = (() => {
  const c = [smoothCorner(3.2, 17.4, [-1, 0], [0, -1], 2.4), smoothCorner(3.2, 8.4, [0, -1], [1, 0], 2.4), smoothCorner(20.8, 8.4, [1, 0], [0, 1], 2.4), smoothCorner(20.8, 17.4, [0, 1], [-1, 0], 2.4)]
  return `M7 17.4 ${c.map((corner) => `L${corner.start} ${corner.curve}`).join(' ')} H17`
})()
const PRINTER_PAPER = (() => {
  const left = smoothCorner(7, 20.6, [0, 1], [1, 0], 1.2)
  const right = smoothCorner(17, 20.6, [1, 0], [0, -1], 1.2)
  return `M7 13.6 L${left.start} ${left.curve} L${right.start} ${right.curve} L17 13.6 Z`
})()
const PRINTER_TRAY = smoothRect(7, 3.4, 10, 5, 1.2)
const BOX = smoothRect(3.4, 3.8, 17.2, 16.6, 2.6)
/** 택배 트럭 (D-UX3-39): 짐칸 + 운전석 + 바퀴 둘 — 상자와 같은 모서리 곡률, 겉 크기는 다른 아이콘과 같다 */
const TRUCK_CARGO = smoothRect(2.4, 5.4, 12.2, 11, 2)
const TRUCK_CAB = (() => {
  const corner = smoothCorner(21.6, 13.2, [0.6, 0.8], [0, 1], 1.4)
  return `M14.6 9.2 H18.2 L${corner.start} ${corner.curve} V16.4 H14.6 Z`
})()
/** 박스테이프 (위에서 가운데까지, 아래 두 모서리 둥글게). top: 시작 높이 — 고른 때는 윗선 위(2.4)부터 뚫는다, closed: 칠할 모양 */
function tape(top: number, closed: boolean): string {
  const left = smoothCorner(10.2, 11.4, [0, 1], [1, 0], 0.8)
  const right = smoothCorner(13.8, 11.4, [1, 0], [0, -1], 0.8)
  return `M10.2 ${num(top)} L${left.start} ${left.curve} L${right.start} ${right.curve} L13.8 ${num(top)}${closed ? ' Z' : ''}`
}
const TAPE_LINE = tape(3.8, false)
const TAPE_CUT = tape(2.4, true)

export function TabIcon({ name, color, size = 26, filled = false, cut }: { readonly name: TabIconName; readonly color: string; readonly size?: number; readonly filled?: boolean; readonly cut: string }) {
  const line = { stroke: color, strokeWidth: STROKE, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const body = { ...line, fill: filled ? color : 'none' }
  // 찬 모양 안쪽: 바탕 색으로 채우고(뚫기) 가장자리는 같은 색 선
  const inner = filled ? { ...line, fill: cut, stroke: cut } : { ...line, fill: 'none' }
  const shape = (() => {
    switch (name) {
      case 'home':
        return (
          <>
            {/* 바닥 선은 문 자리에서 끊기고 문은 위로 둥근 홈 */}
            <Path d={HOUSE} {...body} />
          </>
        )
      case 'printer':
        return (
          <>
            <Path d={PRINTER_TRAY} {...body} />
            {/* 몸통 아래 선은 종이 앞에서 끊는다 */}
            <Path d={PRINTER_BODY} {...body} />
            <Path d={PRINTER_PAPER} {...line} fill={filled ? cut : 'none'} stroke={color} />
          </>
        )
      case 'receipt':
        return (
          <>
            <Path d="M5 3.4 H19 V20.6 L16.67 19.1 L14.33 20.6 L12 19.1 L9.67 20.6 L7.33 19.1 L5 20.6 Z" {...body} />
            <Line x1={8.6} y1={8.6} x2={15.4} y2={8.6} {...inner} />
            <Line x1={8.6} y1={12.6} x2={13.2} y2={12.6} {...inner} />
          </>
        )
      case 'box':
        return (
          <>
            <Path d={BOX} {...body} />
            {/* 가운데 박스테이프 한 줄 (위에서 가운데까지) */}
            {/* 고른 때는 테이프 자리 윗선까지 뚫는다 */}
            <Path d={filled ? TAPE_CUT : TAPE_LINE} {...inner} />
          </>
        )
      case 'truck':
        return (
          <>
            <Path d={TRUCK_CARGO} {...body} />
            <Path d={TRUCK_CAB} {...body} />
            <Circle cx={7.2} cy={18.4} r={2} {...body} fill={filled ? cut : 'none'} stroke={color} />
            <Circle cx={17.4} cy={18.4} r={2} {...body} fill={filled ? cut : 'none'} stroke={color} />
          </>
        )
      case 'menu':
        return (
          <>
            <Line x1={4.2} y1={6} x2={19.8} y2={6} {...line} strokeWidth={filled ? STROKE + 0.5 : STROKE} />
            <Line x1={4.2} y1={12} x2={19.8} y2={12} {...line} strokeWidth={filled ? STROKE + 0.5 : STROKE} />
            <Line x1={4.2} y1={18} x2={19.8} y2={18} {...line} strokeWidth={filled ? STROKE + 0.5 : STROKE} />
          </>
        )
    }
  })()
  return (
    <View aria-hidden pointerEvents="none" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {shape}
      </Svg>
    </View>
  )
}
