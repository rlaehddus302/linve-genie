// 라이브 화면 탭 바 반고정 숨김 (D-UX4-155 — D-UX4-109의 휴대폰 붙는 머리 숨김 stickyHeaderHiddenOnScroll을 바꿈).
// 사용자 "채팅·문자 탭을 누르면 탭 바가 사라진다": 휴대폰 숨김은 굴린 거리를 손·프로그램 가리지 않고 세서, 채팅·문자·음성 인식 탭이 맨 아래로
// 바로 굴러갈 때(scrollToEnd)와 새 줄을 따라 내려갈 때마다 탭 바를 숨겼다. 이제 손으로 굴린 거리(끌기·끌고 놓은 뒤 미끄러짐)만 센다:
// 손으로 내려가면(목록을 올리면) 숨고 올라가면 다시 보인다(D-UX4-93~110 그대로). 탭을 바꾸면 늘 보이고, 앱이 굴린 것은 숨김을 바꾸지 않는다.
// 탭 바는 여전히 휴대폰 붙는 머리(stickyHeaderIndices)로 맨 위에 붙고, 숨김만 그 안쪽 칸을 위로 미는 것으로 한다.
import { useCallback, useMemo, useRef } from 'react'
import { Animated, Platform, type LayoutChangeEvent } from 'react-native'

export interface TabHideState {
  /** 위로 민 만큼 (0 = 다 보임, 탭 바 높이 = 다 숨음) */
  readonly hidden: number
  /** 마지막으로 본 목록 굴림 자리 */
  readonly lastY: number
}

export const TAB_HIDE_START: TabHideState = { hidden: 0, lastY: 0 }

/**
 * 다음 숨김 (순수 함수). y: 목록 굴림 자리 · top: 목록 안 탭 바 자리(이 자리를 넘어야 맨 위에 붙는다) · height: 탭 바 높이 ·
 * byHand: 손으로 굴리는 중(끌기·미끄러짐)인지. 탭 바가 아직 제자리(붙기 전)면 늘 다 보인다.
 */
export function nextTabHide(state: TabHideState, y: number, top: number, height: number, byHand: boolean): TabHideState {
  const past = Math.max(0, y - top)
  if (past === 0 || height <= 0) return { hidden: 0, lastY: y }
  if (!byHand) return { hidden: state.hidden, lastY: y }
  const moved = past - Math.max(0, state.lastY - top)
  return { hidden: Math.min(height, Math.max(0, state.hidden + moved)), lastY: y }
}

/** 탭 바 숨김 손잡이 — 목록의 끌기·미끄러짐·굴림 신호를 받아 탭 바 칸을 위로 미는 값(offset)을 낸다 */
export function useTabBarHide() {
  const offset = useRef(new Animated.Value(0)).current
  const state = useRef<TabHideState>(TAB_HIDE_START)
  const place = useRef({ top: 0, height: 0 })
  const dragging = useRef(false)
  const gliding = useRef(false)
  const apply = useCallback((next: TabHideState) => {
    const was = state.current.hidden
    state.current = next
    if (next.hidden !== was) offset.setValue(-next.hidden)
  }, [offset])
  return useMemo(() => ({
    offset,
    /** 붙는 머리 칸의 자리·높이 (목록 안) */
    onLayout(event: LayoutChangeEvent) {
      place.current = { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }
    },
    drag(on: boolean) { dragging.current = on },
    glide(on: boolean) { gliding.current = on },
    track(y: number) {
      // 웹은 끌기 신호가 없다 — 숨기지 않는다
      const byHand = Platform.OS !== 'web' && (dragging.current || gliding.current)
      apply(nextTabHide(state.current, y, place.current.top, place.current.height, byHand))
    },
    /** 탭을 바꿨다 — 다 보이게 */
    show() {
      dragging.current = false
      gliding.current = false
      apply({ hidden: 0, lastY: state.current.lastY })
    },
  }), [offset, apply])
}
