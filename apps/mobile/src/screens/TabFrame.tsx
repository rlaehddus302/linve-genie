// 아래 탭이 붙는 화면 틀 (D-UX2-02 → D-UX3-01 → D-UX3-39): 홈 · 주문 · 포장 · 택배 · 전체.
// 탭을 바꾸면 내용이 부드럽게(260ms) 밀려 들어오고 아래 막대의 고른 칸 바탕이 옆으로 미끄러진다(D-UX3-12) — 오른쪽 탭으로 가면 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서(토스식). 아래 막대는 움직이지 않는다.
// 아래 막대는 따로 바탕 띠를 차지하지 않고 내용 위에 반투명하게 뜬다(D-UX3-13) — 내용은 화면 끝까지 그려지고, 스크롤 끝 여백은 막대 높이(useTabBarRoom)만큼 더 둔다.
// 탭끼리는 화면 전환 없이(animation 'none') 바꿔 끼우고, 움직임은 여기서만 낸다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, View } from 'react-native'
import { SPACE, TAB_CELL, TabBar, tabBarBottom, TabBarRoomProvider, tabIndex, useBottomInset, useKit, type TabKey } from '../ui/kit/index.ts'

/** 밀려 들어오는 거리 (화면 너비가 아니라 살짝) */
export const TAB_SHIFT = 48
export const TAB_SHIFT_MS = 260

let lastTab: TabKey | null = null

/** 이 탭이 어느 쪽에서 들어오는지: 1 = 오른쪽에서(오른쪽 탭으로 감), -1 = 왼쪽에서, 0 = 그대로(처음·같은 탭) */
export function tabEnterSide(from: TabKey | null, to: TabKey): -1 | 0 | 1 {
  if (from === null || from === to) return 0
  return tabIndex(to) > tabIndex(from) ? 1 : -1
}

export function TabFrame({ active, go, children }: { readonly active: TabKey; readonly go: (key: TabKey) => void; readonly children: ReactNode }) {
  const { p } = useKit()
  const inset = useBottomInset()
  // 재기 전 짐작: 칸 높이 + 안쪽 여백·테두리 + 위 여백 + 홈 막대
  const [room, setRoom] = useState(TAB_CELL + SPACE.xs * 3 + 2 + tabBarBottom(inset))
  const from = useRef(lastTab).current
  const side = useRef(tabEnterSide(from, active)).current
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
      Animated.timing(shift, { toValue: 0, duration: TAB_SHIFT_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }).start()
    }
    // 움직임 줄이기를 켠 휴대폰은 밀지 않는다
    AccessibilityInfo.isReduceMotionEnabled().then(run, () => run(false))
    return () => {
      alive = false
    }
  }, [side, shift])
  const translateX = shift.interpolate({ inputRange: [-1, 0, 1], outputRange: [-TAB_SHIFT, 0, TAB_SHIFT] })
  const opacity = shift.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] })
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <TabBarRoomProvider room={room}>
        <Animated.View style={{ flex: 1, transform: [{ translateX }], opacity }}>{children}</Animated.View>
      </TabBarRoomProvider>
      <TabBar
        active={active}
        from={from}
        onHeight={(height) => setRoom((old) => (Math.abs(old - height) < 0.5 ? old : height))}
        onSelect={(key) => {
          if (key === active) return
          go(key)
        }}
      />
    </View>
  )
}
