// 누르면 꾸욱 들어가는 손맛 (D-UX4-43, 사용자 지시 2026-11-09 "눌렀을 때 우리가 만든 키보드처럼 꾸욱 누른 느낌"·"키보드 눌렀을 때 햅틱"):
// 누르는 동안 조금 작아지고 옅은 바탕이 생기며, 누른 순간 가벼운 햅틱. 앱 숫자판 키·회색 칩 단추가 같이 쓴다 — 새 곳도 이것만 쓴다.
// D-UX4-202 (사용자 지시 2026-11-16 "버튼 꾹 눌렀을 때와 놓았을 때 애니메이션 더 부드럽게 하고 눌리는 정도를 사진 2, 3의 검색버튼 크기 차이로 유추해서 전역 적용하라"):
// 토스 머리 돋보기가 눌리면 43 → 39px(가운데 그대로) = 0.91배. 작은 단추(40pt 안팎)는 0.91배, 큰 것은 크기를 재서 양쪽 합쳐 8pt까지만 줄인다
// (pressScaleFor — 40pt 0.91 · 100pt 0.92 · 200pt 0.96 · 400pt 0.98; 재기 전에는 0.97). 들어갈 때 120ms·나올 때 260ms, 부드럽게 멈추는 곡선.
import { useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, type GestureResponderEvent, type LayoutChangeEvent, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native'
import { tapHaptic } from '../../native/haptics.ts'
import { RADIUS, SPACE } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'

/** 눌림 움직임 시간: 들어갈 때는 조금 빠르게, 나올 때는 천천히 풀린다 (D-UX4-202 — 옛 70·160ms는 딱딱 끊겼다) */
export const PRESS_IN_MS = 120
export const PRESS_OUT_MS = 260
/** 눌림 곡선: 빨리 출발해 아주 부드럽게 멈춘다(튀지 않음). 누르다 떼도 지금 자리에서 이어서 돌아온다 */
export const PRESS_EASING = Easing.bezier(0.2, 0, 0, 1)

/** 누르면 작아지는 비율 기본값 — 크기를 아직 모를 때 (D-UX4-202 전에는 모든 Tap이 이 값) */
export const TAP_SCALE = 0.97
/** 가장 깊이 눌린 비율: 토스 머리 돋보기 43 → 39px (D-UX4-202) */
export const PRESS_SCALE_MIN = 0.91
/** 큰 것이 눌릴 때 줄어드는 길이 한도(양쪽 합친 pt) — 화면 폭 줄이 0.91배면 양쪽이 18pt씩 튄다 */
export const PRESS_SHRINK_PT = 8

/** 크기(가로·세로 중 긴 쪽, pt)에 맞춘 눌림 비율: max(0.91, 1 − 8/크기). 크기를 모르면 0.97 */
export function pressScaleFor(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size) || size <= 0) return TAP_SCALE
  return Math.max(PRESS_SCALE_MIN, 1 - PRESS_SHRINK_PT / size)
}

/** 눌림 깊이: 직접 준 값이 있으면 그것, 없으면 그려진 크기를 재서 pressScaleFor */
function usePressDepth(explicit: number | undefined, onLayout?: (event: LayoutChangeEvent) => void): { readonly scale: number; readonly onLayout: (event: LayoutChangeEvent) => void } {
  const [size, setSize] = useState<number | undefined>(undefined)
  return {
    scale: explicit ?? pressScaleFor(size),
    onLayout: (event) => {
      if (explicit === undefined) {
        const { width, height } = event.nativeEvent.layout
        const next = Math.round(Math.max(width, height))
        if (next !== size) setSize(next)
      }
      onLayout?.(event)
    },
  }
}

/** 누르는 동안 0 → 1 (웹·시험은 움직이지 않는다) */
export function usePressMotion(): { readonly value: Animated.Value; readonly pressIn: () => void; readonly pressOut: () => void } {
  const value = useRef(new Animated.Value(0)).current
  const to = (target: number) => {
    if (Platform.OS === 'web') return
    Animated.timing(value, { toValue: target, duration: target === 1 ? PRESS_IN_MS : PRESS_OUT_MS, easing: PRESS_EASING, useNativeDriver: true }).start()
  }
  return { value, pressIn: () => to(1), pressOut: () => to(0) }
}

/**
 * 꾸욱 눌리는 단추 틀. scale: 줄어드는 비율(없으면 크기에 맞춰 pressScaleFor, D-UX4-202 — 옛 기본 0.94). pad: 누르는 동안 뒤에 생기는 옅은 둥근 바탕의 안쪽 여백(없으면 바탕 없음). haptic: 누른 순간 햅틱(기본 켬).
 * 이름(ariaLabel)은 꼭 준다.
 */
export function PressScale({ ariaLabel, onPress, children, scale, pad, radius = RADIUS.lg, haptic = true, disabled, style, testID }: { readonly ariaLabel: string; readonly onPress: () => void; readonly children: ReactNode; readonly scale?: number; readonly pad?: { readonly x: number; readonly y: number }; readonly radius?: number; readonly haptic?: boolean; readonly disabled?: boolean; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }) {
  const { p } = useKit()
  const press = usePressMotion()
  const depth = usePressDepth(scale)
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, depth.scale] })
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
      onLayout={depth.onLayout}
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
  const depth = usePressDepth(undefined)
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, depth.scale] })
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
      onLayout={depth.onLayout}
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

export type TapProps = PressableProps & {
  /** 누르는 동안 줄어드는 비율 (기본: 크기에 맞춰 pressScaleFor — 작은 단추 0.91 ~ 화면 폭 줄 0.98, D-UX4-202) */
  readonly pressScale?: number
  /** 누른 순간 가벼운 햅틱 (기본 끔) */
  readonly haptic?: boolean
}

/**
 * 누를 수 있는 모든 것의 틀 (D-UX4-72, 사용자 지시 2026-11-10 "클릭할 수 있는 모든 버튼들을 꾹 눌렀을 때 꾹 눌리는 경험… 앞으로도"):
 * react-native Pressable과 같은 모양으로 쓰되, 누르는 동안 조금 작아졌다가(크기에 맞춰 0.91~0.98배, D-UX4-202) 떼면 돌아온다. 뒤로 가기 단추만 쓰지 않는다.
 * style·children이 함수면 { pressed }를 그대로 넘긴다. 이 파일 밖에서 react-native의 Pressable을 직접 쓰지 않는다(시험이 본다).
 */
export function Tap({ style, children, onPressIn, onPressOut, onLayout, pressScale, haptic = false, disabled, ...rest }: TapProps) {
  const press = usePressMotion()
  const depth = usePressDepth(pressScale, onLayout ?? undefined)
  const [pressed, setPressed] = useState(false)
  const state: PressableStateCallbackType = { pressed, hovered: false } as PressableStateCallbackType
  const resolved = typeof style === 'function' ? style(state) : style
  const flat = (StyleSheet.flatten(resolved) ?? {}) as ViewStyle
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, depth.scale] })
  const transform = [...((flat.transform as readonly object[] | undefined) ?? []), { scale: size }]
  const off = disabled === true
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onLayout={depth.onLayout}
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
