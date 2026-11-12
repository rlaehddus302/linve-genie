import { renderHook } from '@testing-library/react'
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native'
import { expect, it, vi } from 'vitest'
import { useFollowScroll } from '../src/lib/use-follow-scroll.ts'

it('지난 말을 조금만 올려도 새 발화를 따라가지 않고 맨 아래로 돌아오면 다시 따라간다', () => {
  const { result } = renderHook(useFollowScroll)
  const follow = result.current
  const scrollToEnd = vi.fn()
  follow.scroll.current = { scrollToEnd } as unknown as ScrollViewInstance
  const at = (y: number) => ({ nativeEvent: { contentOffset: { y }, layoutMeasurement: { height: 200 }, contentSize: { height: 600 } } }) as NativeSyntheticEvent<NativeScrollEvent>
  follow.begin()
  follow.track(at(400))
  follow.contentChanged()
  follow.end(at(390))
  follow.contentChanged()
  expect(scrollToEnd).not.toHaveBeenCalled()
  follow.track(at(400))
  follow.contentChanged()
  expect(scrollToEnd).toHaveBeenCalledOnce()
})
