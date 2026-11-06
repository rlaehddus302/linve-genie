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
/** 이만큼 오른쪽으로 밀면 뒤로 밀기로 본다 */
const EDGE_SWIPE_START = 12

/**
 * 뒤로 밀기인가: 화면 왼쪽 끝 24 안에서 손이 닿아 오른쪽으로 12 넘게, 세로보다 확실히 가로로 밀었을 때만
 * (D-UX3-57, 사용자 지시 2026-11-07 "왼쪽 끄트머리에서 스와이프 했을 때만 뒤로가기로 읽어야 하는데" — 옛: 화면 어디서 밀어도 뒤로)
 */
export function isEdgeSwipe(startX: number, dx: number, dy: number): boolean {
  return startX <= EDGE_SWIPE_WIDTH && dx > EDGE_SWIPE_START && Math.abs(dx) > Math.abs(dy) * 1.5
}

/**
 * 왼쪽 가장자리에서 오른쪽으로 밀면 뒤로 (D-UX3-55, 사용자 지시 2026-11-07 "스와이프로 뒤로 가기가 안 됨").
 * 쌓인 화면(expo-router Stack)은 원래 되지만, 한 화면 안에서 넘기는 곳(SlideSwitch — 번호 확인)은 이것으로 한다.
 * 밀기가 잡히는 순간(손을 떼기 전) 바로 onBack 한 번 — 화면은 따라 움직이지 않는다. 나가기 전에 묻는 팝업을 곧바로 띄우려고
 * (D-UX3-56, 사용자 지시 2026-11-07 "경고 팝업 띄우기 전까지 슬라이드 애니메이션이 되면 안 됨 … 손 떼지 않아도 제스처 작동하면 바로 팝업 띄우기" — 옛 D-UX3-55 화면이 손가락을 따라오고 30% 넘게 밀고 놓으면).
 */
export function EdgeSwipeBack({ onBack, children }: { readonly onBack: () => void; readonly children: ReactNode }) {
  const latest = useRef(onBack)
  useEffect(() => {
    latest.current = onBack
  })
  // 손이 처음 닿은 자리 — PanResponder의 x0은 잡기 전에는 0이라 쓸 수 없다(그래서 어디서 밀어도 뒤로가 됐다, D-UX3-57)
  const startX = useRef(Number.POSITIVE_INFINITY)
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event) => {
          startX.current = event.nativeEvent.touches.length > 1 ? Number.POSITIVE_INFINITY : event.nativeEvent.pageX
          return false
        },
        onMoveShouldSetPanResponderCapture: (_, g) => isEdgeSwipe(startX.current, g.dx, g.dy),
        onPanResponderGrant: () => {
          startX.current = Number.POSITIVE_INFINITY
          latest.current()
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  )
  return (
    <View style={{ flex: 1 }} {...responder.panHandlers}>
      {children}
    </View>
  )
}
