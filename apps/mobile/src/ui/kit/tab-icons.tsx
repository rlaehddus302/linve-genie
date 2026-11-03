// 아래 탭 아이콘 (D-UX3-12, 사용자 지시 2026-11-03 "가운데 셋이 다 네모라 헷갈림"): 24 칸 SVG, 가로세로가 거의 같다(1:1).
// 홈 = 토스식 둥근 집(가운데 문), 라벨 = 프린터, 정산 = 영수증(아래 톱니), 포장 = 상자 + 가운데 박스테이프 한 줄, 전체 = 세 줄.
// 고른 탭은 같은 치수에서 속을 채우고 안쪽 선(종이·글줄·테이프)은 놓인 바탕 색으로 뚫는다 — 선 모양과 겉 크기가 같다.
// D-UX3-13: 집 문은 바닥 선을 끊고 그 자리를 비운 홈(문 아래 선 없음), 프린터 몸통 아래 선은 종이 앞에서 끊고(겹치는 선 없음), 고른 상자는 테이프 자리의 윗선까지 뚫는다.
import Svg, { Line, Path, Rect } from 'react-native-svg'
import { View } from 'react-native'

export type TabIconName = 'home' | 'printer' | 'receipt' | 'box' | 'menu'

const STROKE = 1.9

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
            <Path d="M3.6 10.4 L12 3.4 L20.4 10.4 V18.6 A2.2 2.2 0 0 1 18.2 20.8 H14.1 V16.2 A2.1 2.1 0 0 0 9.9 16.2 V20.8 H5.8 A2.2 2.2 0 0 1 3.6 18.6 Z" {...body} />
          </>
        )
      case 'printer':
        return (
          <>
            <Rect x={7} y={3.4} width={10} height={5} rx={1.2} {...body} />
            {/* 몸통 아래 선은 종이 앞에서 끊는다 */}
            <Path d="M7 17.4 H5.6 A2.4 2.4 0 0 1 3.2 15 V10.8 A2.4 2.4 0 0 1 5.6 8.4 H18.4 A2.4 2.4 0 0 1 20.8 10.8 V15 A2.4 2.4 0 0 1 18.4 17.4 H17" {...body} />
            <Path d="M7 13.6 V19.4 A1.2 1.2 0 0 0 8.2 20.6 H15.8 A1.2 1.2 0 0 0 17 19.4 V13.6 Z" {...line} fill={filled ? cut : 'none'} stroke={color} />
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
            <Rect x={3.4} y={3.8} width={17.2} height={16.6} rx={2.6} {...body} />
            {/* 가운데 박스테이프 한 줄 (위에서 가운데까지) */}
            {/* 고른 때는 테이프 자리 윗선까지 뚫는다 */}
            {filled ? <Path d="M10.2 2.4 V10.6 A0.8 0.8 0 0 0 11 11.4 H13 A0.8 0.8 0 0 0 13.8 10.6 V2.4 Z" {...inner} /> : <Path d="M10.2 3.8 V10.6 A0.8 0.8 0 0 0 11 11.4 H13 A0.8 0.8 0 0 0 13.8 10.6 V3.8" {...inner} />}
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
