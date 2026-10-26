// QL2 SA-QL2-01 — 휴대폰 알림 띠를 펼친 그 그리기 안에서 빠른 입력 묶음을 막대 위로 올린다(U-MOB1-01의 올리기를 다음 그리기로 미루지 않음).
// 미루면 펼친 목록이 한 번 제자리에 그려진 뒤 화면이 뛰어 올라가, 그 사이에 잰 항목 위치가 서로 겹쳐 보였다(375×812 150% 실측: 펼친 뒤 스크롤 0 → 231)
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { T0, chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, fixtureClock, flush } from './support.ts'

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 375, width: 375, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

let scrollBy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
  const engine = new EngineServer([register(15, '핑크프릴', 10000), chat('m1', 'c1', '가', '20'), chat('m2', 'c2', '나', '21')])
  vi.stubGlobal('fetch', engine.server.fetch)
  fixtureClock(T0) // MOB2 D-MOB2-06 — 보류 찜이 막 들어온 방송(알림 띠에 보류 찜 2)
  // 아래에 붙은 메뉴 막대(위 끝 733) · 고정 영역은 위에서 231 · 빠른 입력 묶음 아래 끝 1000 · 입력칸 위 끝 600
  const bar = document.createElement('nav')
  bar.className = 'menu'
  bar.style.position = 'fixed'
  document.body.append(bar)
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === bar) return rect(733, 812)
    if (this.classList.contains('console-sticky')) return rect(231, 1000)
    if (this.classList.contains('console-sticky-quick')) return rect(260, 1000)
    if (this instanceof HTMLInputElement && this.closest('.console-sticky-quick') !== null) return rect(600, 666)
    return original.call(this)
  })
  scrollBy = vi.fn()
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy
})

afterEach(() => {
  vi.useRealTimers() // MOB2 D-MOB2-06
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  document.body.replaceChildren()
})

describe('알림 띠 펼치기와 화면 올리기 (SA-QL2-01, AC-QL2-44)', () => {
  it('펼치기를 누른 그 그리기 안에서(다음 그리기 전) 올린다 — 고정 영역이 위에 닿을 때까지(231)', async () => {
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    const toggle = screen.getByRole('button', { name: '알림 2 펼치기' })
    toggle.focus()
    // 포커스로 생긴 다음 그리기의 올리기는 지나가게 둔다
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    scrollBy.mockClear()
    act(() => {
      fireEvent.click(toggle)
    })
    // 기다리지 않고 바로 — 같은 그리기 안
    expect(screen.getByRole('button', { name: '알림 2 접기' }).getAttribute('aria-expanded')).toBe('true')
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy.mock.calls[0]![0]).toMatchObject({ top: 231 })
  })

  it('포커스가 빠른 입력 묶음 밖이면 펼쳐도 올리지 않는다', async () => {
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    scrollBy.mockClear()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '알림 2 펼치기' }))
    })
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
