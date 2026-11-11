// 누르면 꾸욱 들어가는 손맛 (D-UX4-43, 사용자 지시 2026-11-09 "눌렀을 때 우리가 만든 키보드처럼 꾸욱 누른 느낌"·"키보드 눌렀을 때 햅틱"):
// 누르는 동안 조금 작아지고(기본 0.94배) 옅은 바탕이 생기며, 누른 순간 가벼운 햅틱. 앱 숫자판 키·회색 칩 단추가 같이 쓴다 — 새 곳도 이것만 쓴다.
import { useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, type GestureResponderEvent, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native'
import { tapHaptic } from '../../native/haptics.ts'
import { RADIUS, SPACE } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'

/** 눌림 움직임 시간: 들어갈 때는 빠르게, 나올 때는 천천히 */
export const PRESS_IN_MS = 70
export const PRESS_OUT_MS = 160

/** 누르는 동안 0 → 1 (웹·시험은 움직이지 않는다) */
export function usePressMotion(): { readonly value: Animated.Value; readonly pressIn: () => void; readonly pressOut: () => void } {
  const value = useRef(new Animated.Value(0)).current
  const to = (target: number) => {
    if (Platform.OS === 'web') return
    Animated.timing(value, { toValue: target, duration: target === 1 ? PRESS_IN_MS : PRESS_OUT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }
  return { value, pressIn: () => to(1), pressOut: () => to(0) }
}

/**
 * 꾸욱 눌리는 단추 틀. pad: 누르는 동안 뒤에 생기는 옅은 둥근 바탕의 안쪽 여백(없으면 바탕 없음). haptic: 누른 순간 햅틱(기본 켬).
 * 이름(ariaLabel)은 꼭 준다.
 */
export function PressScale({ ariaLabel, onPress, children, scale = 0.94, pad, radius = RADIUS.lg, haptic = true, disabled, style, testID }: { readonly ariaLabel: string; readonly onPress: () => void; readonly children: ReactNode; readonly scale?: number; readonly pad?: { readonly x: number; readonly y: number }; readonly radius?: number; readonly haptic?: boolean; readonly disabled?: boolean; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }) {
  const { p } = useKit()
  const press = usePressMotion()
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, scale] })
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel}
      aria-disabled={disabled === true}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      onPressIn={() => {
        if (haptic) tapHaptic()
        press.pressIn()
      }}
      onPressOut={press.pressOut}
      style={style}
    >
      {pad === undefined ? null : <Animated.View aria-hidden style={{ position: 'absolute', top: pad.y, bottom: pad.y, left: pad.x, right: pad.x, borderRadius: radius, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, opacity: press.value, transform: [{ scale: size }] }} />}
      <Animated.View style={{ transform: [{ scale: size }], alignItems: 'center', justifyContent: 'center' }}>{children}</Animated.View>
    </Pressable>
  )
}

/** 회색 칩 단추 (토스 "잔액 · 159,952원 입력"): 옅은 회색 둥근 네모, 진한 회색 중간 굵기 글자, 꾸욱 눌림 */
/** center: 가운데 놓기 — 기본은 왼쪽 붙임(alignSelf flex-start)이라 부모가 가운데 정렬이어도 왼쪽에 선다 (D-UX4-132) */
export function SoftChip({ label, ariaLabel, onPress, testID, center = false }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly testID?: string; readonly center?: boolean }) {
  const { p } = useKit()
  const press = usePressMotion()
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] })
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel ?? label}
      testID={testID}
      hitSlop={6}
      onPress={onPress}
      onPressIn={() => {
        tapHaptic()
        press.pressIn()
      }}
      onPressOut={press.pressOut}
      style={{ alignSelf: center ? 'center' : 'flex-start' }}
    >
      {({ pressed }) => (
        <Animated.View style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surfaceAlt, transform: [{ scale: size }] }}>
          <Txt step="body" weight="book" ink={p.tabInk}>
            {label}
          </Txt>
        </Animated.View>
      )}
    </Pressable>
  )
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** 누르면 작아지는 비율 기본값 (줄·큰 단추). 작은 칩·키는 PressScale(0.94) */
export const TAP_SCALE = 0.97

export type TapProps = PressableProps & {
  /** 누르는 동안 줄어드는 비율 (기본 0.97) */
  readonly pressScale?: number
  /** 누른 순간 가벼운 햅틱 (기본 끔) */
  readonly haptic?: boolean
}

/**
 * 누를 수 있는 모든 것의 틀 (D-UX4-72, 사용자 지시 2026-11-10 "클릭할 수 있는 모든 버튼들을 꾹 눌렀을 때 꾹 눌리는 경험… 앞으로도"):
 * react-native Pressable과 같은 모양으로 쓰되, 누르는 동안 조금 작아졌다가(0.97배) 떼면 돌아온다. 뒤로 가기 단추만 쓰지 않는다.
 * style·children이 함수면 { pressed }를 그대로 넘긴다. 이 파일 밖에서 react-native의 Pressable을 직접 쓰지 않는다(시험이 본다).
 */
export function Tap({ style, children, onPressIn, onPressOut, pressScale = TAP_SCALE, haptic = false, disabled, ...rest }: TapProps) {
  const press = usePressMotion()
  const [pressed, setPressed] = useState(false)
  const state: PressableStateCallbackType = { pressed, hovered: false } as PressableStateCallbackType
  const resolved = typeof style === 'function' ? style(state) : style
  const flat = (StyleSheet.flatten(resolved) ?? {}) as ViewStyle
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, pressScale] })
  const transform = [...((flat.transform as readonly object[] | undefined) ?? []), { scale: size }]
  const off = disabled === true
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true)
        if (!off) {
          if (haptic) tapHaptic()
          press.pressIn()
        }
        onPressIn?.(event)
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false)
        press.pressOut()
        onPressOut?.(event)
      }}
      style={{ ...flat, transform } as never}
    >
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  )
}
