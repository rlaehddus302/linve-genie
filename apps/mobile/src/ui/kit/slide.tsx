// 화면 넘김 (D-UX3-49, 사용자 지시 2026-11-07 "모든 페이지는 전환 애니메이션(슬라이드)"):
// id가 바뀌면 새 화면이 오른쪽에서 밀려 들어오고 옛 화면은 왼쪽으로 밀려 나간다. back이면 반대 방향.
// 옛 화면은 바뀌기 직전 모습 그대로 잠깐 그린 뒤 없앤다(같은 열쇠(id)로 그려 다시 만들지 않는다 — 상태·초점이 튀지 않게).
// 휴대폰 '동작 줄이기'가 켜져 있거나 웹(시험)이면 넘김 없이 바로 바꾼다.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native'

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
