// 밀어서 뒤로 가기 뒤 이전 화면이 오른쪽으로 넘쳤다 돌아오던 것 (D-UX4-85, 사용자 지시 2026-11-10 "스와이프해서 뒤로가기 하면 이전 화면이 오른쪽으로 오바해서 들썩하는데 이거도 없애"):
// 원인 — 다시 보일 때 뒤에서 받은 자료를 바꾸며 건 LayoutAnimation의 자리 바꿈(update)이 앱 전체 다음 그리기에 걸려 넘김과 겹쳤다.
// 고침 — 자리 바꿈은 움직이지 않고(생김·없어짐만 옅게), 다시 묻기는 넘김이 끝난 뒤(FOCUS_SETTLE_MS)에 한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOCUS_SETTLE_MS, ScreenFocusProvider, useScreenFocusCount } from '../src/lib/cached-get.ts'

afterEach(() => {
  vi.useRealTimers()
})

function Count() {
  return <span data-testid="count">{String(useScreenFocusCount())}</span>
}

describe('뒤로 가기 넘김과 겹치지 않는다 (D-UX4-85)', () => {
  it('LayoutAnimation은 자리 바꿈(update)을 움직이지 않는다', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/lib/cached-get.ts'), 'utf8')
    const config = source.slice(source.indexOf('LayoutAnimation.configureNext('), source.indexOf('})', source.indexOf('LayoutAnimation.configureNext(')))
    expect(config).not.toMatch(/\bupdate\s*:/)
    expect(config).toMatch(/create:/)
  })

  it('다시 보이면 넘김이 끝난 뒤(FOCUS_SETTLE_MS)에야 다시 묻는다', () => {
    vi.useFakeTimers()
    const handlers: Record<string, () => void> = {}
    const navigation = { addListener: (event: 'focus' | 'blur', callback: () => void) => { handlers[event] = callback; return () => undefined } }
    render(<ScreenFocusProvider navigation={navigation}><Count /></ScreenFocusProvider>)
    expect(FOCUS_SETTLE_MS).toBeGreaterThanOrEqual(350)
    act(() => {
      handlers.blur?.()
      handlers.focus?.()
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
    act(() => {
      vi.advanceTimersByTime(FOCUS_SETTLE_MS - 1)
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})
