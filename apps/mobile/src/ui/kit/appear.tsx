// 늦게 오는 것은 부드럽게 (D-UX4-112, 사용자 지시 2026-11-10 "서버에서 불러오느라 늦는거면 늦게 뜰 때 부드럽게 페이드인 되면서 위로 올라오는 애니메이션 넣고
// (이건 다른 항목에도 전역으로 똑같이 적용해줘)"): 서버에서 받은 뒤에야 생기는 묶음·줄을 이것으로 감싸면, 처음 그려질 때 옅게 나타나며 조금 아래에서 제자리로 올라온다.
// 처음부터(기억해 둔 자료로) 바로 그릴 수 있는 것은 감싸지 않거나 instant로 — 화면을 열 때마다 움직이지 않게. 웹(시험)·움직임 줄이기는 바로.
import { useEffect, useRef, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native'

/** 나타나는 시간과 올라오는 거리 */
export const APPEAR_MS = 260
export const APPEAR_RISE = 10

export function Appear({ children, instant = false, distance = APPEAR_RISE, style, testID }: { readonly children: ReactNode; readonly instant?: boolean; readonly distance?: number; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }) {
  const still = instant || Platform.OS === 'web'
  const show = useRef(new Animated.Value(still ? 1 : 0)).current
  useEffect(() => {
    if (still) return
    let alive = true
    const go = (reduce: boolean) => {
      if (!alive) return
      Animated.timing(show, { toValue: 1, duration: reduce ? 0 : APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
    AccessibilityInfo.isReduceMotionEnabled().then(go, () => go(false))
    return () => {
      alive = false
    }
  }, [still, show])
  const rise = show.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] })
  return (
    <Animated.View testID={testID} style={[style, { opacity: show, transform: [{ translateY: rise }] }]}>
      {children}
    </Animated.View>
  )
}
