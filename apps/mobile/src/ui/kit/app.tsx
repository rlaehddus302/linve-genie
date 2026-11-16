// 새 시안 조각 (D-UX2-01): 선 아이콘, 화면 머리(뒤로·제목·오른쪽), 아래 탭 5개(D-UX3-01), 큰 초록 카드, 할 일 줄, 메뉴 줄.
// 누르는 동안은 흐려지지 않고 바탕이 진해진다(D-UX3-03).
// 아이콘은 그림 파일·글꼴 없이 View 선으로 그린다(새 패키지를 넣지 않는다). 아이콘만으로 뜻을 전하지 않고 늘 글자와 함께 둔다.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, View, type ViewStyle } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { PAGE, RADIUS, SPACE, TOUCH } from './tokens.ts'
import { Txt, useBottomInset, useKit } from './theme.tsx'
import { tapHaptic } from '../../native/haptics.ts'
import { TabIcon, type TabIconName } from './tab-icons.tsx'
import { Tap } from './press.tsx'

export type IconName = 'back' | 'chevron' | 'play' | 'home' | 'box' | 'card' | 'more' | 'menu' | 'label' | 'mic' | 'check' | 'plus' | 'down' | 'up' | 'gear' | 'edit' | 'help' | 'search'

/** 톱니 (D-UX4-20, 사용자 지시 2026-11-09 "... 버튼 디자인을 톱니 디자인으로" — 토스 계좌 화면 오른쪽 위 회색 톱니): 이 8개, 가운데 구멍 */
export const GEAR_PATH = (() => {
  const teeth = 8
  const outer = 10.4
  const inner = 7.7
  const parts: string[] = []
  const at = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`
  for (let i = 0; i < teeth; i++) {
    const base = (i / teeth) * Math.PI * 2
    const step = (Math.PI * 2) / teeth
    // 이 하나: 안쪽 → 바깥(조금 좁게) → 바깥 → 안쪽
    parts.push(`${i === 0 ? 'M' : 'L'}${at(inner, base - step * 0.3)}`, `L${at(outer, base - step * 0.17)}`, `L${at(outer, base + step * 0.17)}`, `L${at(inner, base + step * 0.3)}`)
  }
  // 가운데 구멍 (evenodd로 뚫는다)
  return `${parts.join(' ')} Z M15.3 12 A3.3 3.3 0 1 0 8.7 12 A3.3 3.3 0 1 0 15.3 12 Z`
})()

/**
 * 선 아이콘 (24 기준). 보조 기술에는 읽히지 않는다 — 옆 글자가 이름이다.
 * filled: 아래 탭에서 고른 칸처럼 속을 채운 모양(홈·상자·카드·라벨). 채운 모양 안의 선은 cut 색(놓인 바탕 색)으로 뚫는다.
 */
export function Icon({ name, color, size = 24, filled = false, cut }: { readonly name: IconName; readonly color?: string; readonly size?: number; readonly filled?: boolean; readonly cut?: string }) {
  const { p } = useKit()
  const c = color ?? p.text
  const hole = cut ?? p.surface
  const s = size
  const stroke = Math.max(2, Math.round(s / 11))
  // SVG 선 아이콘(마이크·펼치기)의 화면 선 굵기는 크기와 상관없이 1.8 (아래 탭 아이콘과 같은 굵기, D-UX3-44·76)
  const lineWidth = (1.8 * 24) / s
  const box: ViewStyle = { width: s, height: s, alignItems: 'center', justifyContent: 'center' }
  const shape = (() => {
    switch (name) {
      case 'back':
        // 뒤로 ‹는 선 끝과 꺾인 곳을 둥글게, 선은 2.4 (D-UX3-55, 사용자 지시 2026-11-07 "뒤로가기 아이콘 살짝만 더 두껍게, 더 라운드지게" — 옛 각진 2)
        // 크기·자리는 토스 사진(폭 430 휴대폰)과 픽셀로 같게: 높이 37px·폭 21px, 왼쪽 51px·위 155px (D-UX3-56 — 옛 ‹는 16% 컸다)
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d="M12.31 4.95 L6.93 10.33 L12.31 15.71" stroke={c} strokeWidth={(BACK_STROKE * 24) / s} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'chevron': {
        const arm = s * 0.38
        // 화살표는 커져도 선은 가늘게 (토스 ‹와 같은 2, D-UX3-51)
        const line = Math.max(2, Math.round(s / 14))
        return <View style={{ width: arm, height: arm, borderTopWidth: line, borderRightWidth: line, borderColor: c, borderRadius: 1, borderCurve: 'continuous', transform: [{ rotate: '45deg' }], marginLeft: -arm * 0.35 }} />
      }
      case 'play':
        return (
          <View style={{ width: s * 0.9, height: s * 0.9, borderRadius: s, borderCurve: 'continuous', borderWidth: stroke, borderColor: c, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 0, height: 0, marginLeft: s * 0.08, borderTopWidth: s * 0.17, borderBottomWidth: s * 0.17, borderLeftWidth: s * 0.26, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c }} />
          </View>
        )
      case 'home': {
        // 지붕(돌린 네모) + 몸통. 찬 모양도 같은 치수 — 몸통 가운데 아래에 문(놓인 바탕 색)만 뚫는다 (D-UX3-07)
        const roof = s * 0.52
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: roof, height: roof, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 2, borderCurve: 'continuous', transform: [{ rotate: '45deg' }], marginBottom: -s * 0.3 }} />
            <View style={{ width: s * 0.62, height: s * 0.42, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
              {filled ? <View style={{ width: s * 0.16, height: s * 0.2, backgroundColor: hole, borderTopLeftRadius: s, borderTopRightRadius: s }} /> : null}
            </View>
          </View>
        )
      }
      case 'box':
        return (
          <View style={{ width: s * 0.78, height: s * 0.7, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3, borderCurve: 'continuous', alignItems: 'center' }}>
            <View style={{ position: 'absolute', top: s * 0.16, left: 0, right: 0, height: stroke, backgroundColor: filled ? hole : c }} />
            <View style={{ width: stroke, height: s * 0.2, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'card':
        return (
          <View style={{ width: s * 0.8, height: s * 0.6, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3, borderCurve: 'continuous' }}>
            <View style={{ marginTop: s * 0.12, height: stroke, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'label': {
        // 라벨 한 장: 네모 + 글줄 둘 (찬 모양은 네모를 채우고 글줄을 뚫는다)
        const lines = filled ? hole : c
        return (
          <View style={{ width: s * 0.8, height: s * 0.66, borderRadius: 3, borderCurve: 'continuous', borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', justifyContent: 'center', paddingLeft: s * 0.14, gap: s * 0.09 }}>
            <View style={{ width: s * 0.42, height: stroke, backgroundColor: lines }} />
            <View style={{ width: s * 0.26, height: stroke, backgroundColor: lines }} />
          </View>
        )
      }
      case 'menu':
        return (
          <View style={{ gap: s * 0.17 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.72, height: stroke, borderRadius: stroke, borderCurve: 'continuous', backgroundColor: c }} />
            ))}
          </View>
        )
      case 'search':
        // 돋보기 (D-UX4-201 — 라이브 화면 머리 오른쪽, 토스 거래 내역 머리처럼): 선 굵기는 마이크와 같은 SVG 선
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d="M10.6 3.6 A7 7 0 1 1 10.59 3.6 Z M15.7 15.7 L20.4 20.4" stroke={c} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'more':
        return (
          <View style={{ flexDirection: 'row', gap: s * 0.16 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.15, height: s * 0.15, borderRadius: s, borderCurve: 'continuous', backgroundColor: c }} />
            ))}
          </View>
        )
      case 'mic':
        // 마이크 (D-UX3-76, 사용자 지시 2026-11-09 "아이콘 못생겼으니 다시 제대로"): 아래 탭 아이콘처럼 SVG 선 하나 굵기·둥근 끝 — 캡슐 + 받침 호 + 기둥
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d="M12 3.2 A3.1 3.1 0 0 1 15.1 6.3 V11.1 A3.1 3.1 0 0 1 8.9 11.1 V6.3 A3.1 3.1 0 0 1 12 3.2 Z" stroke={c} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Path d="M5.6 10.9 A6.4 6.4 0 0 0 18.4 10.9 M12 17.3 V20.6 M8.9 20.6 H15.1" stroke={c} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'down':
      case 'up':
        // 펼치기 ⌄ / 접기 ⌃ (D-UX3-76): 마이크와 같은 굵기, 끝·꺾인 곳 둥글게
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d={name === 'down' ? 'M6.5 9.4 L12 14.9 L17.5 9.4' : 'M6.5 14.6 L12 9.1 L17.5 14.6'} stroke={c} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'gear':
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d={GEAR_PATH} fill={c} fillRule="evenodd" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
          </Svg>
        )
      case 'help':
        // 동그라미 안 ? (D-UX4-64, 토스 "빠른 로그인 ⓘ" 자리): 설명이 있는 줄 이름 옆
        return (
          // 선은 다른 아이콘보다 가늘게 1.5 (D-UX4-100 — 토스 "빠른 로그인 ⓘ"를 같은 휴대폰 사진으로 견주니 우리 ?가 두꺼웠다)
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Circle cx={12} cy={12} r={9} stroke={c} strokeWidth={(1.5 * 24) / s} fill="none" />
            <Path d="M9.6 9.6 C9.6 8.2 10.7 7.3 12 7.3 C13.4 7.3 14.4 8.2 14.4 9.4 C14.4 10.5 13.7 11 12.9 11.5 C12.3 11.9 12 12.3 12 13.1 L12 13.5" stroke={c} strokeWidth={(1.5 * 24) / s} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Circle cx={12} cy={16.6} r={1.15} fill={c} />
          </Svg>
        )
      case 'edit':
        // 연필 (D-UX4-21): 고칠 수 있는 칸 왼쪽 위 작은 표시
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d="M14.6 5.4 L18.6 9.4 L9 19 L4.6 19.4 L5 15 Z M12.8 7.2 L16.8 11.2" stroke={c} strokeWidth={lineWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'check':
        return <View style={{ width: s * 0.3, height: s * 0.55, borderBottomWidth: stroke + 1, borderRightWidth: stroke + 1, borderColor: c, transform: [{ rotate: '45deg' }], marginTop: -s * 0.12 }} />
      case 'plus':
        return (
          <View style={{ width: s * 0.6, height: s * 0.6, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: s * 0.6, height: stroke, backgroundColor: c }} />
            <View style={{ position: 'absolute', width: stroke, height: s * 0.6, backgroundColor: c }} />
          </View>
        )
    }
  })()
  return (
    <View aria-hidden style={box} pointerEvents="none">
      {shape}
    </View>
  )
}

/** 뒤로 화살표 크기 — 모든 화면 머리·전체 화면 판이 같은 크기·색을 쓴다 (D-UX3-08) */
/** 뒤로 화살표 크기 — 토스 사진을 재어 33(선 두께는 2 그대로, D-UX3-51 — 옛 26) */
export const BACK_ICON = 33
/** 뒤로 ‹ 선 두께 (D-UX3-55) */
export const BACK_STROKE = 2.4

/** 뒤로 단추 하나 (토스 ‹): 48×48 누름 자리, 글자색 화살표 33. 누르면 바탕은 그대로 두고 화살표만 연해진다(D-UX3-51). 어느 화면이든 이것만 쓴다 */
export function BackButton({ label = '뒤로', onPress }: { readonly label?: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    // 누름 예외: 뒤로 가기 — 누르면 화살표만 연해진다 (D-UX4-72)
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={6} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      {({ pressed }) => <Icon name="back" size={BACK_ICON} color={pressed ? p.iconPressed : p.text} />}
    </Pressable>
  )
}

/** 쌓인 화면 머리 치수 (D-UX4-40, 토스 "나라사랑카드" 사진을 기준으로): 줄 높이 48(뒤로 단추와 같다) + 아래 4, 왼쪽 8에 뒤로 ‹ */
export const NAV = { row: 48, below: SPACE.xs, left: PAGE.backLeft, right: SPACE.md, titleLift: -2.5 } as const

/**
 * 쌓인 화면 머리 하나 (D-UX4-40, 사용자 지시 2026-11-09 "모든 화면 … 뒤로가기 버튼과 제목 글자의 위치, 크기, 모양을 통일해. 기준은 사진 1"):
 * 왼쪽 뒤로 ‹ · 가운데 제목(17·중간 굵기, 한 줄) · 오른쪽 조각(글자 단추 "관리"·상태). 뒤로·제목·오른쪽은 늘 같은 줄 높이 48 가운데에 놓인다.
 * 제목은 화면 가운데 — 오른쪽 조각이 넓으면 그만큼 양쪽을 비워 겹치지 않는다. 모든 쌓인 화면·입력 화면 틀·밀려 들어오는 화면이 이것만 쓴다.
 */
export function NavBar({ title, onBack, backLabel = '뒤로', right, testID }: { readonly title?: string; readonly onBack?: () => void; readonly backLabel?: string; readonly right?: ReactNode; readonly testID?: string }) {
  const [rightWidth, setRightWidth] = useState(0)
  // 제목 양쪽 빈자리: 뒤로 단추 자리(8+48)와 오른쪽 조각 중 넓은 쪽 + 8
  const side = Math.max(NAV.left + 48, NAV.right + rightWidth) + SPACE.sm
  return (
    <View testID={testID} style={{ minHeight: NAV.row + NAV.below, paddingBottom: NAV.below, paddingLeft: NAV.left, paddingRight: NAV.right, flexDirection: 'row', alignItems: 'center' }}>
      {onBack === undefined ? <View style={{ width: 48, height: NAV.row }} /> : <BackButton label={backLabel} onPress={onBack} />}
      <View style={{ flex: 1 }} />
      {right === undefined ? null : (
        <View onLayout={(event) => setRightWidth(Math.ceil(event.nativeEvent.layout.width))} style={{ flexDirection: 'row', alignItems: 'center', height: NAV.row }}>
          {right}
        </View>
      )}
      {title === undefined || title === '' ? null : (
        // Pretendard 한글은 줄 높이 안에서 조금 아래에 그려져 뒤로 ‹보다 낮아 보인다 — 2.5 올린다 (D-UX3-88)
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, height: NAV.row, left: side, right: side, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: NAV.titleLift }] }}>
          <Txt step="nav" weight="medium" role="heading" aria-level={1} numberOfLines={1}>
            {title}
          </Txt>
        </View>
      )}
    </View>
  )
}

/**
 * 머리 오른쪽 글자 단추 한 벌 (D-UX4-164, 사용자 지시 2026-11-16 "사진 1,2 참고해서 화면 제목 오른쪽에 있는 버튼 스타일을 수정해 (모듈화해서 전역 적용)"):
 * 제목과 같은 17 · 중간 두께(500) · 진한 회색 글자. 글자 끝은 화면 끝에서 16(캡슐 끝 8 + 안 여백 8).
 * 누르면 둥근 캡슐(높이 34) 회색 바탕이 생기고 단추 전체가 0.9배로 꾹 줄어든다(옛: 네모 바탕 · 0.97배).
 * 모든 화면 머리 오른쪽 글자 단추는 이것만 쓴다.
 */
export const HEADER_BUTTON = { height: 34, padX: SPACE.sm, edge: SPACE.sm, pressScale: 0.9, radius: RADIUS.pill } as const

/** 머리 오른쪽 글자 단추 (토스 "관리", D-UX4-42 → D-UX4-164 모양) */
export function HeaderTextButton({ label, ariaLabel, onPress, testID }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={ariaLabel ?? label}
      onPress={onPress}
      testID={testID}
      hitSlop={{ top: 7, bottom: 7, left: 6, right: 6 }}
      pressScale={HEADER_BUTTON.pressScale}
      // 제목처럼 2.5 올려 뒤로 ‹·가운데 제목과 한 줄에 맞춘다 (D-UX4-55). 글자만이 아니라 캡슐째 올린다 — 글자만 올리면 누를 때 보이는 캡슐이
      // 글자보다 2.5 아래로 처진다 (D-UX4-166, 사용자 "눌렀을때 보이는 영역이 정확히 센터에 맞지 않아"). 글자 자리는 그대로다
      style={({ pressed }) => ({ height: HEADER_BUTTON.height, minWidth: 44, marginRight: HEADER_BUTTON.edge - NAV.right, paddingHorizontal: HEADER_BUTTON.padX, alignItems: 'center', justifyContent: 'center', borderRadius: HEADER_BUTTON.radius, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent', transform: [{ translateY: NAV.titleLift }] })}
    >
      <Txt step="nav" weight="book" ink={p.tabInk} numberOfLines={1}>
        {label}
      </Txt>
    </Tap>
  )
}

/**
 * 화면 머리. 뒤로가 있으면 쌓인 화면 머리(NavBar — 가운데 제목, D-UX4-40), 없으면(탭 첫 화면) 왼쪽에 큰 제목.
 * D-UX4-59 (사용자 지시 2026-11-09 "토스의 상단 영역을 보면 뒤로가기, 제목이 있는 영역과 홈 화면에 위 영역이 다 똑같지"): 탭 첫 화면 머리도
 * 쌓인 화면 머리와 같은 줄(높이 48 + 아래 4, 상태 막대 바로 아래)에 놓는다 — 큰 제목·오른쪽 단추가 뒤로 ‹·가운데 제목과 같은 높이 가운데에 온다.
 * 큰 제목은 왼쪽 20(본문 여백, 뒤로 ‹ 자리와 같은 세로줄), 한글은 2.5 올린다(D-UX3-88). left를 주면 큰 제목 대신 그것(포장·택배 나눔)을 놓는다.
 */
export function AppHeader({ title, onBack, backLabel = '뒤로', right, left, testID }: { readonly title: string; readonly onBack?: () => void; readonly backLabel?: string; readonly right?: ReactNode; readonly left?: ReactNode; readonly testID?: string }) {
  if (onBack !== undefined) return <NavBar title={title} onBack={onBack} backLabel={backLabel} right={right} {...(testID === undefined ? {} : { testID })} />
  return (
    <View testID={testID} style={{ minHeight: NAV.row + NAV.below, paddingBottom: NAV.below, paddingLeft: SPACE.xl, paddingRight: NAV.right, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
      <View style={{ flex: 1, minHeight: NAV.row, justifyContent: 'center' }}>
        {left ?? (
          <View style={{ transform: [{ translateY: NAV.titleLift }] }}>
            <Txt step="title" weight="heavy" role="heading" aria-level={1} numberOfLines={1}>
              {title}
            </Txt>
          </View>
        )}
      </View>
      {right === undefined ? null : <View style={{ flexDirection: 'row', alignItems: 'center', height: NAV.row }}>{right}</View>}
    </View>
  )
}

/** 머리 오른쪽 둥근 아이콘 버튼 (⋯ 등). 이름은 aria-label로 꼭 준다. */
export function HeaderIconButton({ icon, label, onPress, testID, color, size }: { readonly icon: IconName; readonly label: string; readonly onPress: () => void; readonly testID?: string; readonly color?: string; readonly size?: number }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={label} onPress={onPress} testID={testID} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Icon name={icon} {...(color === undefined ? {} : { color })} {...(size === undefined ? {} : { size })} />
    </Tap>
  )
}

export type TabKey = 'home' | 'settle' | 'packing' | 'customers' | 'more'

/**
 * 아래 탭 5개 (D-UX3-01 → D-UX3-39, 사용자 지시 2026-11-06 "우리 서비스 이용 플로우대로"): 방송 뒤 일하는 순서 그대로 —
 * 홈(방송·다음 할 일) · 주문(예약자별 정리 → 손님 정보 받기 → 확인서 보내기 → 입금 확인) · 포장(포장·라벨 부착 + 택배 접수, 위에서 나눔 — D-UX3-60) · 고객 · 전체. 라벨 프린터는 전체 안(장치 설정)
 */
export const TABS: readonly { readonly key: TabKey; readonly word: string; readonly icon: TabIconName }[] = [
  { key: 'home', word: '홈', icon: 'home' },
  { key: 'settle', word: '주문', icon: 'receipt' },
  { key: 'packing', word: '택배', icon: 'box' },
  { key: 'customers', word: '고객', icon: 'person' },
  { key: 'more', word: '전체', icon: 'menu' },
]

/** 탭 순서 (화면 바뀔 때 왼쪽·오른쪽 어느 쪽에서 들어올지 정한다) */
export function tabIndex(key: TabKey): number {
  return TABS.findIndex((tab) => tab.key === key)
}

/** 아래 탭 칸 높이 (D-UX3-41) */
export const TAB_CELL = 55
/** 아래 안전 영역이 이보다 크면 손잡이(아이폰 홈 막대 34·안드로이드 제스처 막대 ~24)가 아니라 안드로이드 단추 막대(◁ ○ ▢, ~48)다 */
export const BUTTON_NAV_MIN_INSET = 40

/**
 * 아래 탭 아래 여백 (토스처럼 홈 막대 자리까지 내려 앉는다, D-UX3-41): 홈 막대가 있으면 그 높이보다 14 작게, 없으면 8.
 * 안드로이드 단추 막대는 눌러야 하는 단추라 겹치면 안 된다 — 그 위로 8 띄운다 (D-UX3-67).
 * 안드로이드 제스처 막대도 아이폰 홈 막대보다 아래 자리가 얕아(~24) 내려 앉으면 막대가 탭에 겹친다 — 안드로이드는 늘 그 위로 8 (D-UX3-68).
 */
export function tabBarBottom(inset: number, os: string = Platform.OS): number {
  if (os === 'android' || inset >= BUTTON_NAV_MIN_INSET) return inset + SPACE.sm
  return Math.max(inset - 14, SPACE.sm)
}

/** 아래 탭 그림자: 위쪽으로 아주 옅게(아이폰에서 쓰던 0,-4 · 흐림 8 · 3%). 두 기기 모두 boxShadow로 같게 그린다 (D-UX3-71) */
export const TAB_BAR_SHADOW = '0px -4px 8px rgba(0, 0, 0, 0.03)'

/** 아래 탭 뒤 흐림 (D-UX3-13): 앱은 시작 때 기기 흐림(expo-blur)을 끼운다. 시험·웹은 없음(반투명 흰색만) */
let Backdrop: ComponentType | null = null
export function setTabBarBackdrop(next: ComponentType | null): void {
  Backdrop = next
}

/**
 * 아래 탭 (토스식, D-UX3-01·12·13): 내용 위에 떠 있는 둥근 막대 — 따로 바탕 띠를 두지 않아 뒤 내용이 흐리게 비친다(반투명 흰색 + 흐림).
 * 고른 칸은 회색 둥근 바탕 + 속이 찬 아이콘 + 굵은 글자, 나머지는 선 아이콘 + 회색 글자. 누르는 동안은 그 칸 바탕이 진해진다.
 * 탭을 바꾸면 회색 바탕이 전 탭 자리에서 새 탭으로 미끄러진다(from). onHeight로 차지하는 높이를 알린다(내용 아래 여백).
 */
export function TabBar({ active, from = null, onSelect, onHeight }: { readonly active: TabKey; readonly from?: TabKey | null; readonly onSelect: (key: TabKey) => void; readonly onHeight?: (height: number) => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  const [width, setWidth] = useState(0)
  const target = tabIndex(active)
  const start = from === null ? target : tabIndex(from)
  const slide = useRef(new Animated.Value(start)).current
  useEffect(() => {
    if (start === target) return
    Animated.timing(slide, { toValue: target, duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }).start()
  }, [slide, start, target])
  const gap = 2
  const cell = width === 0 ? 0 : (width - gap * (TABS.length - 1)) / TABS.length
  return (
    <View pointerEvents="box-none" onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SPACE.xl, paddingTop: SPACE.xs, paddingBottom: tabBarBottom(inset) }}>
      {/* 그림자는 겉에(둥글게 자르면 그림자도 잘린다), 흐림·반투명은 안에서 둥글게 자른다.
          그림자는 boxShadow 하나로 두 기기 같게 (D-UX3-71): 안드로이드 elevation은 늘 아래로 진한 그림자를 그려 탭 밑에 회색 줄이 보였다 */}
      <View style={{ borderRadius: RADIUS.pill, borderCurve: 'continuous', boxShadow: TAB_BAR_SHADOW }}>
        <View role="tablist" aria-label="아래 메뉴" style={{ flexDirection: 'row', borderRadius: RADIUS.pill, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: p.tabLine, padding: SPACE.xs, gap }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            {Backdrop === null ? null : <Backdrop />}
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: Backdrop === null && Platform.OS === 'android' ? p.glassNoBlur : p.glass }} />
          </View>
          {/* 고른 칸 회색 바탕 — 칸들 뒤에서 미끄러진다 */}
          <View pointerEvents="none" style={{ position: 'absolute', left: SPACE.xs, right: SPACE.xs, top: SPACE.xs, bottom: SPACE.xs }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {cell > 0 ? <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: cell, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.soft, transform: [{ translateX: slide.interpolate({ inputRange: [0, TABS.length - 1], outputRange: [0, (cell + gap) * (TABS.length - 1)] }) }] }} /> : null}
          </View>
          {TABS.map((tab) => {
            const on = tab.key === active
            const ink = on ? p.text : p.tabInk
            return (
              <Tap key={tab.key} role="tab" aria-selected={on} aria-label={tab.word} onPress={() => {
                  tapHaptic()
                  onSelect(tab.key)
                }} style={({ pressed }) => ({ flex: 1, minHeight: TAB_CELL, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: pressed ? p.softPressed : on && cell === 0 ? p.soft : 'transparent' })}>
                {() => (
                  <>
                    <TabIcon name={tab.icon} color={ink} size={26} filled={on} cut={p.surface} />
                    <Txt step="tab" weight="medium" ink={ink}>
                      {tab.word}
                    </Txt>
                  </>
                )}
              </Tap>
            )
          })}
        </View>
      </View>
    </View>
  )
}

/** 큰 초록 카드 버튼 (홈 "방송 시작하기"): 제목 크게 + 한 줄 설명. */
export function HeroButton({ title, sub, icon = 'play', onPress, disabled, ariaLabel, testID }: { readonly title: string; readonly sub?: string; readonly icon?: IconName; readonly onPress: () => void; readonly disabled?: boolean; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={ariaLabel ?? title} aria-disabled={disabled === true} disabled={disabled === true} onPress={onPress} testID={testID} style={({ pressed }) => ({ borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: 22, paddingHorizontal: SPACE.xl, gap: 6, backgroundColor: pressed && disabled !== true ? p.primaryPressed : p.primary, opacity: disabled === true ? 0.5 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} color={p.onPrimary} size={26} />
        <Txt step="title" weight="heavy" color="onPrimary">
          {title}
        </Txt>
      </View>
      {sub === undefined ? null : (
        <Txt step="caption" color="onPrimary">
          {sub}
        </Txt>
      )}
    </Tap>
  )
}

export type BadgeTone = 'warn' | 'green' | 'gray'

/** 숫자 배지 (44 정사각, 둥근 14) */
export function CountBadge({ count, tone }: { readonly count: number; readonly tone: BadgeTone }) {
  const { p } = useKit()
  const bg = tone === 'warn' ? p.warnBg : tone === 'green' ? p.freshBg : p.border
  const fg = tone === 'warn' ? p.warnText : tone === 'green' ? p.primaryText : p.text
  return (
    <View aria-hidden style={{ minWidth: 30, height: 30, paddingHorizontal: 5, borderRadius: 9, borderCurve: 'continuous', backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="caption" weight="bold" ink={fg}>
        {String(count)}
      </Txt>
    </View>
  )
}

/** 흰 묶음 카드 (줄들을 담는다. 줄 사이 얇은 선은 RowDivider). title이 있으면 카드 안 맨 위에 묶음 이름(토스 "금융 서비스"처럼, D-UX3-04) */
export function RowGroup({ children, label, title }: { readonly children?: ReactNode; readonly label?: string; readonly title?: string }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    // 토스 "전체" 카드처럼 마지막 줄 아래를 넉넉히 (D-UX3-89)
    <View role={name === undefined ? undefined : 'group'} aria-label={name} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingTop: SPACE.xs, paddingBottom: SPACE.md }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg + 2, paddingBottom: SPACE.sm }}>
          {/* 토스 "전체" 화면처럼 (D-UX3-87): 묶음 이름은 본문 크기·중간 굵기·회색, 줄 이름보다 한 단계 작게 */}
          <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
            {title}
          </Txt>
        </View>
      )}
      {children}
    </View>
  )
}

export function RowDivider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border, marginHorizontal: SPACE.xl }} />
}

/** 할 일 줄: 숫자 배지 · 제목 · 짧은 설명 · 화살표 */
/** right: 화살표 앞 오른쪽 조각 (연동된 계정 로고 등, D-UX4-201) */
export function TodoRow({ count, tone, title, sub, right, onPress, ariaLabel, testID }: { readonly count?: number; readonly tone?: BadgeTone; readonly title: string; readonly sub?: string; readonly right?: ReactNode; readonly onPress: () => void; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  const name = ariaLabel ?? (count === undefined ? title : `${title} ${String(count)}`)
  return (
    <Tap role="button" aria-label={name} onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md + 2, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {count === undefined ? null : <CountBadge count={count} tone={tone ?? 'gray'} />}
      <View style={{ flex: 1, gap: 2 }}>
        {/* 토스 "전체" 줄처럼 (D-UX3-87): 줄 이름은 보통 굵기(중간), 줄 간격은 좁게 */}
        <Txt step="bodyLarge" weight="book">
          {title}
        </Txt>
        {sub === undefined ? null : (
          <Txt step="caption" color="textSub">
            {sub}
          </Txt>
        )}
      </View>
      {right}
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

/** 작은 묶음 이름 ("지난 방송") */
export function GroupLabel({ children }: { readonly children: string }) {
  return (
    <Txt step="caption" weight="bold" color="textSub" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

/**
 * 상태 점 + 글. 세 가지 색 (D-UX4-67, 사용자 지시 2026-11-10 "듣는 중 표시 말고 다른 상태는 연결 끊김(red), 재연결 중(orange)"):
 * on 밝은 초록(듣는 중) · warn 주황(재연결 중) · off 밝은 빨강(연결 끊김). 옛 D-UX4-22는 정상 아니면 모두 빨강.
 * 옅은 바탕 알약 안에 점(밝은 색)과 글자(대비 4.5 이상). 정상일 때 점이 부드럽게 밝아졌다 어두워진다.
 */
export function DotStatus({ word, tone }: { readonly word: string; readonly tone: 'on' | 'off' | 'warn' }) {
  const { p } = useKit()
  const ok = tone === 'on'
  const look = ok ? { ink: p.liveOkText, dot: p.liveOkDot, bg: p.liveOkBg } : tone === 'warn' ? { ink: p.liveWarnText, dot: p.liveWarnDot, bg: p.liveWarnBg } : { ink: p.liveBadText, dot: p.liveBadDot, bg: p.liveBadBg }
  const { ink, dot } = look
  const glow = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!ok) {
      glow.setValue(1)
      return
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 0.3, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [glow, ok])
  return (
    <View role="status" aria-label={word} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACE.sm + 2, paddingVertical: 5, marginRight: SPACE.xs, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: look.bg }}>
      <Animated.View aria-hidden testID="dot-status-dot" style={{ width: 9, height: 9, borderRadius: 5, borderCurve: 'continuous', backgroundColor: dot, opacity: glow }} />
      <Txt step="caption" weight="bold" ink={ink}>
        {word}
      </Txt>
    </View>
  )
}
