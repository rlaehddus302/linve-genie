// 아래 탭 아이콘 (D-UX3-12, 사용자 지시 2026-11-03 "가운데 셋이 다 네모라 헷갈림"): 24 칸 SVG, 가로세로가 거의 같다(1:1).
// 홈 = 토스식 둥근 집(가운데 문), 라벨 = 프린터, 정산 = 영수증(아래 톱니), 포장 = 상자 + 가운데 박스테이프 한 줄, 전체 = 세 줄.
// 고른 탭은 같은 치수에서 속을 채우고 안쪽 선(종이·글줄·테이프)은 놓인 바탕 색으로 뚫는다 — 선 모양과 겉 크기가 같다.
// D-UX3-13: 집 문은 바닥 선을 끊고 그 자리를 비운 홈(문 아래 선 없음), 프린터 몸통 아래 선은 종이 앞에서 끊고(겹치는 선 없음), 고른 상자는 테이프 자리의 윗선까지 뚫는다.
import { useId } from 'react'
import Svg, { Circle, Defs, Line, Mask, Path, Rect } from 'react-native-svg'
import { View } from 'react-native'

export type TabIconName = 'home' | 'printer' | 'receipt' | 'box' | 'truck' | 'person' | 'menu'

// D-UX3-46: 고른 칸 안쪽 선(영수증 글줄·상자 테이프·트럭 칸막이·바퀴 테두리)은 흰색으로 뒤집는다(토스 사진).
// D-UX3-44: 선은 1.8로 가늘게, 모서리·꼭짓점은 더 둥글게. D-UX3-45: 고른 칸은 다시 채운다 — 상자 테이프는 윗선을 남기고 좁게 뚫고, 트럭 바퀴도 같은 색으로 채운다
const STROKE = 1.8

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
  // 지붕 꼭대기·처마 꼭짓점을 둥글게, 문은 너비 5.2(옛 4.2)
  return `M3.6 11.6 Q3.6 10.4 4.5 9.7 L10.8 4.4 Q12 3.4 13.2 4.4 L19.5 9.7 Q20.4 10.4 20.4 11.6 L${right.start} ${right.curve} H14.6 V16.4 A2.6 2.6 0 0 0 9.4 16.4 V20.8 L${left.start} ${left.curve} Z`
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
/** 택배 트럭 (D-UX3-39): 짐칸 + 운전석 + 바퀴 둘 — 상자와 같은 모서리 곡률, 겉 크기는 다른 아이콘과 같다 */
const TRUCK_CARGO = smoothRect(2.4, 5.4, 12.2, 11, 2.6)
const TRUCK_CAB = (() => {
  const corner = smoothCorner(21.6, 13.2, [0.6, 0.8], [0, 1], 1.4)
  return `M14.6 9.2 H18.2 L${corner.start} ${corner.curve} V16.4 H14.6 Z`
})()
/** 꼭짓점마다 반지름 r만큼 둥글린 닫힌 다각형 */
function roundPoly(points: readonly (readonly [number, number])[], r: number): string {
  const n = points.length
  const parts = points.map((point, i) => {
    const prev = points[(i + n - 1) % n] as readonly [number, number]
    const next = points[(i + 1) % n] as readonly [number, number]
    const toward = (to: readonly [number, number]) => {
      const dx = to[0] - point[0]
      const dy = to[1] - point[1]
      const length = Math.hypot(dx, dy)
      return `${num(point[0] + (dx / length) * r)} ${num(point[1] + (dy / length) * r)}`
    }
    return { from: toward(prev), corner: `${num(point[0])} ${num(point[1])}`, to: toward(next) }
  })
  return `M${parts.map((part) => `${part.from} Q${part.corner} ${part.to}`).join(' L')} Z`
}
/** 택배 상자 (D-UX3-63, 좌표를 맞춤): 비스듬히 본 상자. 앞면 = x 3.4~15.4, y 8.4~20.4. 두 깎인 변은 같은 방향(가로 5.2, 세로 4.6) —
 * 왼쪽 위 (3.4,8.4)→(8.6,3.8), 오른쪽 아래 (20.6,15.8)→(15.4,20.4). 꼭짓점은 1.6만큼 둥글게 */
const BOX_LINE = roundPoly([[3.4, 8.4], [8.6, 3.8], [20.6, 3.8], [20.6, 15.8], [15.4, 20.4], [3.4, 20.4]], 1.6)
/** 테이프 선: 앞면 가운데(x 9.4)에서 꺾인다 — 꺾이는 높이는 앞면 윗변(왼쪽 깎인 변 아래 끝)과 같은 8.4, 사선은 깎인 변과 나란히 윗선(14.6,3.8)까지.
 * 꺾임은 둥글게(1.3), 아래 끝은 13 */
const TAPE_BEND = 'L10.374 7.538 Q9.4 8.4 9.4 9.7 V13'
const BOX_TAPE = `M14.6 3.8 ${TAPE_BEND}`
/** 고른 상자에서 비울 테이프 (D-UX3-63, 사용자 지시 "흰색 선을 칠하라는 게 아니라 그 선을 투명하게 비우라"): 같은 사선을 겉선 밖(1.4 더)까지 늘려 윗선까지 끊는다 */
const BOX_TAPE_CUT = `M15.649 2.872 ${TAPE_BEND}`
/** 고객 (D-UX3-61, 사용자 지시 "홈 아이콘처럼 둥글게, 목이랑 몸 붙여서 한 덩어리"): 머리에서 목·어깨로 이어지는 한 줄 모양, 아래 두 모서리는 집과 같은 곡률 */
const PERSON = (() => {
  const right = smoothCorner(19.4, 20.6, [0, 1], [-1, 0], 2.2)
  const left = smoothCorner(4.6, 20.6, [-1, 0], [0, -1], 2.2)
  return `M9.6 11.2 A4 4 0 1 1 14.4 11.2 C15.4 12.6 19.4 13.2 19.4 17 L${right.start} ${right.curve} L${left.start} ${left.curve} L4.6 17 C4.6 13.2 8.6 12.6 9.6 11.2 Z`
})()

export function TabIcon({ name, color, size = 26, filled = false, cut }: { readonly name: TabIconName; readonly color: string; readonly size?: number; readonly filled?: boolean; readonly cut: string }) {
  const maskId = `tape${useId().replace(/[^a-zA-Z0-9]/g, '')}`
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
            <Path d="M7 3.4 H17 Q19 3.4 19 5.4 V20.6 L16.67 19.1 L14.33 20.6 L12 19.1 L9.67 20.6 L7.33 19.1 L5 20.6 V5.4 Q5 3.4 7 3.4 Z" {...body} />
            <Line x1={8.6} y1={8.6} x2={15.4} y2={8.6} {...inner} />
            <Line x1={8.6} y1={12.6} x2={13.2} y2={12.6} {...inner} />
          </>
        )
      case 'box':
        return filled ? (
          <>
            {/* 채운 상자에서 테이프 선 자리를 투명하게 뚫는다(뒤 바탕이 보인다) */}
            <Defs>
              <Mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
                <Rect x={0} y={0} width={24} height={24} fill="#FFFFFF" />
                <Path d={BOX_TAPE_CUT} fill="none" stroke="#000000" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
              </Mask>
            </Defs>
            <Path d={BOX_LINE} {...body} mask={`url(#${maskId})`} />
          </>
        ) : (
          <>
            <Path d={BOX_LINE} {...body} />
            <Path d={BOX_TAPE} {...line} fill="none" />
          </>
        )
      case 'person':
        return <Path d={PERSON} {...body} />
      case 'truck':
        return (
          <>
            <Path d={TRUCK_CARGO} {...body} />
            <Path d={TRUCK_CAB} {...body} />
            {/* 고른 때 (D-UX3-46): 짐칸·운전석 사이 선과 바퀴 테두리는 흰색으로 뒤집어 몸통과 갈라 보이게 */}
            {filled ? <Line x1={14.6} y1={10.6} x2={14.6} y2={15} {...line} stroke={cut} /> : null}
            <Circle cx={7.2} cy={18.4} r={2} {...body} {...(filled ? { stroke: cut, strokeWidth: 1.4 } : {})} />
            <Circle cx={17.4} cy={18.4} r={2} {...body} {...(filled ? { stroke: cut, strokeWidth: 1.4 } : {})} />
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
