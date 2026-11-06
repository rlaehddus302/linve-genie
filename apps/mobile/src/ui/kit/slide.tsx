// 화면 넘김 (D-UX3-49, 사용자 지시 2026-11-07 "모든 페이지는 전환 애니메이션(슬라이드)"):
// id가 바뀌면 새 화면이 오른쪽에서 밀려 들어오고 옛 화면은 왼쪽으로 밀려 나간다. back이면 반대 방향.
// 옛 화면은 바뀌기 직전 모습 그대로 잠깐 그린 뒤 없앤다(같은 열쇠(id)로 그려 다시 만들지 않는다 — 상태·초점이 튀지 않게).
// 휴대폰 '동작 줄이기'가 켜져 있거나 웹(시험)이면 넘김 없이 바로 바꾼다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native'

/** 넘김 시간 (토스 쌓인 화면과 비슷하게) */
export const SLIDE_MS = 300
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1)

interface Leaving {
  readonly id: string
  readonly node: ReactNode
  readonly dir: 1 | -1
}

export function SlideSwitch({ id, back = false, children, testID }: { readonly id: string; readonly back?: boolean; readonly children: ReactNode; readonly testID?: string }) {
  const { width } = useWindowDimensions()
  const progress = useRef(new Animated.Value(1)).current
  const still = useRef(Platform.OS === 'web')
  /** 마지막으로 그린 모습 — 다음 넘김에서 "옛 화면"이 된다 */
  const lastNode = useRef<ReactNode>(children)
  const [shown, setShown] = useState<{ id: string; leaving: Leaving | null }>({ id, leaving: null })

  // 그리는 중에 바로 바꿔 옛 화면이 한 번도 빠지지 않게 한다(빠지면 다시 만들어진다)
  if (shown.id !== id) {
    setShown({ id, leaving: still.current ? null : { id: shown.id, node: lastNode.current, dir: back ? -1 : 1 } })
  }

  useEffect(() => {
    if (Platform.OS === 'web') return
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) still.current = on
    })
    return () => {
      alive = false
    }
  }, [])

  const leaving = shown.id === id ? shown.leaving : null
  useLayoutEffect(() => {
    if (leaving === null) return
    progress.setValue(0)
    const run = Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, easing: EASE, useNativeDriver: Platform.OS !== 'web' })
    run.start(({ finished }) => {
      if (finished) setShown((now) => (now.leaving === leaving ? { id: now.id, leaving: null } : now))
    })
    return () => run.stop()
  }, [leaving, progress])

  useEffect(() => {
    lastNode.current = children
  })

  const dir = leaving?.dir ?? 1
  const enter = leaving === null ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [dir * width, 0] })
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} testID={testID}>
      {leaving === null ? null : (
        <Animated.View
          key={leaving.id}
          aria-hidden
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -dir * width] }) }] }]}
        >
          {leaving.node}
        </Animated.View>
      )}
      <Animated.View key={id} style={{ flex: 1, transform: [{ translateX: enter }] }}>
        {children}
      </Animated.View>
    </View>
  )
}

/** 왼쪽 가장자리 폭 — 여기서 시작해 오른쪽으로 밀어야 뒤로 (D-UX3-24와 같다: 화면 가운데 가로 밀기는 뒤로가 아니다) */
export const EDGE_SWIPE_WIDTH = 24

/**
 * 왼쪽 가장자리에서 오른쪽으로 밀면 뒤로 (D-UX3-55, 사용자 지시 2026-11-07 "스와이프로 뒤로 가기가 안 됨").
 * 쌓인 화면(expo-router Stack)은 원래 되지만, 한 화면 안에서 넘기는 곳(SlideSwitch — 로그인·번호 확인)은 이것으로 한다.
 * 미는 동안 화면이 손가락을 따라오고, 화면 폭 30% 넘게(또는 빠르게) 밀고 놓으면 onBack — 덜 밀면 제자리로 돌아간다.
 * onBack이 확인 팝업을 띄우면 화면은 제자리로 돌아가며 팝업이 뜬다.
 */
export function EdgeSwipeBack({ onBack, children }: { readonly onBack: () => void; readonly children: ReactNode }) {
  const { width } = useWindowDimensions()
  const x = useRef(new Animated.Value(0)).current
  const latest = useRef(onBack)
  useEffect(() => {
    latest.current = onBack
  })
  const responder = useMemo(() => {
    const settle = (go: boolean) => {
      Animated.timing(x, { toValue: 0, duration: go ? SLIDE_MS : 200, easing: EASE, useNativeDriver: Platform.OS !== 'web' }).start()
      if (go) latest.current()
    }
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => g.x0 <= EDGE_SWIPE_WIDTH && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_, g) => settle(g.dx > width * 0.3 || (g.vx > 0.5 && g.dx > 30)),
      onPanResponderTerminate: () => settle(false),
    })
  }, [width, x])
  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: x }] }} {...responder.panHandlers}>
      {children}
    </Animated.View>
  )
}
