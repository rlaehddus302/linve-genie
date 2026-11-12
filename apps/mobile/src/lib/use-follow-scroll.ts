import { useCallback, useRef } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native'

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>

export function useFollowScroll() {
  const scroll = useRef<ScrollViewInstance>(null)
  const following = useRef(true)
  const dragging = useRef(false)
  const track = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) => {
    // 소수점 반올림만 허용한다. 한 줄만 올려도 그 자리를 유지한다.
    following.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 1
  }
  const reset = useCallback(() => {
    following.current = true
    dragging.current = false
  }, [])
  return {
    scroll,
    reset,
    begin() { dragging.current = true },
    track,
    end(event: ScrollEvent) {
      track(event)
      dragging.current = false
    },
    contentChanged() {
      if (following.current && !dragging.current) scroll.current?.scrollToEnd({ animated: false })
    },
  }
}
