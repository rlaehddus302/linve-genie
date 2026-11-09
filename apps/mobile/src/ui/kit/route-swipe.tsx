// 밀어서 뒤로 가기 (D-UX4-50, 사용자 지시 2026-11-09 "스와이프로 뒤로가기 하면 이전 화면이 아니라 홈화면으로 나가는 문제"):
// 한 경로 안에 겹쳐 그린 화면(방송 화면의 상품 추가·방송 관리처럼)이 열려 있으면, 아이폰 왼쪽 가장자리 밀기가 그 경로 자체를 닫아
// 한 단계 더 뒤(홈)로 나갔다. 겹친 화면이 열려 있는 동안 그 경로의 기본 밀기를 끄고(useHoldRouteSwipe), 겹친 화면은 스스로 밀려 닫힌다(useEdgeSwipeBack).
// 경로 뼈대(app/_layout의 screenLayout)가 경로마다 RouteSwipeProvider를 둔다 — 시험·웹에서는 없어서 아무것도 하지 않는다.
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Animated, Easing, PanResponder, type GestureResponderHandlers } from 'react-native'

type Gate = { readonly hold: () => () => void }
const RouteSwipeContext = createContext<Gate | null>(null)

/** 경로 하나의 기본 밀기 스위치. 겹친 화면이 하나라도 붙잡고 있으면 끈다 */
export function RouteSwipeProvider({ setEnabled, children }: { readonly setEnabled: (enabled: boolean) => void; readonly children: ReactNode }) {
  const latest = useRef(setEnabled)
  latest.current = setEnabled
  const count = useRef(0)
  const gate = useMemo<Gate>(
    () => ({
      hold: () => {
        count.current += 1
        if (count.current === 1) latest.current(false)
        let released = false
        return () => {
          if (released) return
          released = true
          count.current -= 1
          if (count.current === 0) latest.current(true)
        }
      },
    }),
    [],
  )
  return <RouteSwipeContext.Provider value={gate}>{children}</RouteSwipeContext.Provider>
}

/** active인 동안 이 경로의 기본 밀어 뒤로 가기를 끈다 (겹친 화면이 열려 있는 동안) */
export function useHoldRouteSwipe(active: boolean): void {
  const gate = useContext(RouteSwipeContext)
  useEffect(() => {
    if (!active || gate === null) return
    return gate.hold()
  }, [active, gate])
}

/** 왼쪽 가장자리에서 이만큼 안에서 시작한 밀기만 뒤로 가기 (D-UX3-24 — 화면 가운데 가로 밀기는 뒤로 가지 않는다) */
export const EDGE_SWIPE_START = 28

/** 가로로 밀기 시작했는지: 가장자리에서 시작했고, 오른쪽으로 6 넘게, 세로보다 가로가 확실히 크게 */
export function startsEdgeSwipe(x0: number, dx: number, dy: number): boolean {
  return x0 <= EDGE_SWIPE_START && dx > 6 && dx > Math.abs(dy) * 1.5
}

/** 손을 뗐을 때 닫을지: 화면 너비의 1/3 넘게 밀었거나, 빠르게 튕겼으면 닫는다 */
export function edgeSwipeCloses(dx: number, vx: number, width: number): boolean {
  return dx > width / 3 || (vx > 0.4 && dx > 24)
}

/**
 * 겹친 화면을 손가락으로 밀어 닫는다. progress: 1 = 다 열림, 0 = 오른쪽으로 다 나감(겹친 화면이 이미 쓰는 값).
 * 손가락을 따라 움직이고, 덜 밀면 제자리로 돌아온다. 닫힐 때는 onClose — 남은 움직임은 겹친 화면의 닫힘 움직임이 이어 낸다.
 */
export function useEdgeSwipeBack({ progress, width, onClose, enabled }: { readonly progress: Animated.Value; readonly width: number; readonly onClose: () => void; readonly enabled: boolean }): GestureResponderHandlers {
  const close = useRef(onClose)
  close.current = onClose
  const on = useRef(enabled)
  on.current = enabled
  const size = useRef(width)
  size.current = width
  return useMemo(() => {
    const back = () => Animated.timing(progress, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => on.current && startsEdgeSwipe(g.x0, g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => progress.setValue(1 - Math.min(Math.max(g.dx / size.current, 0), 1)),
      onPanResponderRelease: (_, g) => {
        if (edgeSwipeCloses(g.dx, g.vx, size.current)) close.current()
        else back()
      },
      onPanResponderTerminate: back,
    }).panHandlers
  }, [progress])
}
