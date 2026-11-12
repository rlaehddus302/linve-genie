import { act, renderHook } from '@testing-library/react'
import { AccessibilityInfo, Animated, Platform } from 'react-native'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSheetMotion } from '../src/ui/kit/sheets.tsx'

const platform = Platform.OS
beforeEach(() => {
  Platform.OS = 'ios'
  vi.useFakeTimers()
  vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
})
afterEach(() => {
  Platform.OS = platform
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(['interrupted', 'missing'] as const)('닫기 애니메이션 응답이 %s여도 터치를 가로채는 창을 내린다', async mode => {
  vi.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: callback => { if (mode === 'interrupted') callback?.({finished:false}) },
    stop: vi.fn(), reset: vi.fn(),
  }))
  const hook = renderHook(({visible}) => useSheetMotion(visible), { initialProps: { visible:true } })
  hook.rerender({visible:false})
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(hook.result.current.mounted).toBe(false)
  hook.unmount()
})

it('닫다가 다시 열면 이전 닫기 타이머가 열린 창을 내리지 않는다', async () => {
  vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise(() => {}))
  const hook = renderHook(({visible}) => useSheetMotion(visible), { initialProps: { visible:true } })
  hook.rerender({visible:false})
  hook.rerender({visible:true})
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(hook.result.current.mounted).toBe(true)
  hook.rerender({visible:false})
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(hook.result.current.mounted).toBe(false)
  hook.unmount()
})
