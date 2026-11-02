// 아래 탭이 붙는 화면 틀 (D-UX2-02 → D-UX3-01): 홈 · 라벨 · 정산 · 포장 · 전체.
// 탭을 바꾸면 내용이 짧게(180ms) 살짝 밀려 들어온다 — 오른쪽 탭으로 가면 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서(토스식). 아래 막대는 움직이지 않는다.
// 탭끼리는 화면 전환 없이(animation 'none') 바꿔 끼우고, 움직임은 여기서만 낸다.
import { useEffect, useRef, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, View } from 'react-native'
import { TabBar, tabIndex, useKit, type TabKey } from '../ui/kit/index.ts'

/** 밀려 들어오는 거리 (화면 너비가 아니라 살짝) */
export const TAB_SHIFT = 28
export const TAB_SHIFT_MS = 180

let lastTab: TabKey | null = null

/** 이 탭이 어느 쪽에서 들어오는지: 1 = 오른쪽에서(오른쪽 탭으로 감), -1 = 왼쪽에서, 0 = 그대로(처음·같은 탭) */
export function tabEnterSide(from: TabKey | null, to: TabKey): -1 | 0 | 1 {
  if (from === null || from === to) return 0
  return tabIndex(to) > tabIndex(from) ? 1 : -1
}

export function TabFrame({ active, go, children }: { readonly active: TabKey; readonly go: (key: TabKey) => void; readonly children: ReactNode }) {
  const { p } = useKit()
  const side = useRef(tabEnterSide(lastTab, active)).current
  const shift = useRef(new Animated.Value(side)).current
  useEffect(() => {
    lastTab = active
  }, [active])
  useEffect(() => {
    if (side === 0) return
    let alive = true
    const run = (reduce: boolean) => {
      if (!alive) return
      if (reduce) {
        shift.setValue(0)
        return
      }
      Animated.timing(shift, { toValue: 0, duration: TAB_SHIFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start()
    }
    // 움직임 줄이기를 켠 휴대폰은 밀지 않는다
    AccessibilityInfo.isReduceMotionEnabled().then(run, () => run(false))
    return () => {
      alive = false
    }
  }, [side, shift])
  const translateX = shift.interpolate({ inputRange: [-1, 0, 1], outputRange: [-TAB_SHIFT, 0, TAB_SHIFT] })
  const opacity = shift.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.5, 1, 0.5] })
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <Animated.View style={{ flex: 1, transform: [{ translateX }], opacity }}>{children}</Animated.View>
      <TabBar
        active={active}
        onSelect={(key) => {
          if (key === active) return
          go(key)
        }}
      />
    </View>
  )
}
