// 휴대폰 메뉴 (D-NAV-01, AC-NAV-01~06·08): 막대 한 줄 다섯 칸(앞 네 칸 링크 + "더보기" 버튼), 나머지는 "더보기" 목록.
// jsdom에는 matchMedia가 없어 휴대폰 모양이다(폭을 모르면 휴대폰 — use-wide.ts).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Navigate, Route } from '../src/lib/router.ts'
import { menuNav } from './menu-support.ts'
import { overview, queue } from './print-support.ts'
import { FakeEventSource } from './support.ts'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function phoneTopBar(route: Route, { labels = true, assistant = false, navigate = vi.fn<Navigate>() }: { labels?: boolean | null; assistant?: boolean; navigate?: Navigate } = {}) {
  const { TopBar } = await import('../src/components/TopBar.tsx')
  const { PrintContext } = await import('../src/components/print-context.tsx')
  const { PrintStore } = await import('../src/lib/print-store.ts')
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  if (labels !== null) {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(overview({ queue: queue({ labelsEnabled: labels }) })), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await store.reload()
  }
  const view = (to: Route) => (
    <PrintContext.Provider value={{ store, station: {} as never }}>
      <TopBar shopName="구피 가게" assistant={assistant} onLogout={() => {}} route={to} navigate={navigate} />
    </PrintContext.Provider>
  )
  const result = render(view(route))
  return { navigate, rerender: (to: Route) => result.rerender(view(to)) }
}

const more = () => within(menuNav()).getByRole('button', { name: '더보기' })
const list = () => within(menuNav()).queryByRole('list')
/** 막대 칸: 목록 밖의 링크·버튼 (DOM 순서) */
const barCells = () => [...menuNav().children].filter((el) => el.matches('a, button'))

describe('휴대폰 메뉴 막대 (AC-NAV-01·02)', () => {
  it('막대는 "방송"·"문자찜 입력"·"구매자"·"정산" 링크와 "더보기" 버튼 다섯 칸 — 라벨 켬·끔·모름 모두 같다', async () => {
    for (const labels of [true, false, null]) {
      await phoneTopBar({ name: 'home' }, { labels })
      expect(barCells().map((cell) => [cell.tagName, cell.textContent])).toEqual([
        ['A', '방송'],
        ['A', '문자찜 입력'],
        ['A', '구매자'],
        ['A', '정산'],
        ['BUTTON', '더보기'],
      ])
      cleanup()
      vi.resetModules()
    }
  })

  it('닫혀 있으면 aria-expanded="false", 목록은 그리지 않는다 — 메뉴 안 링크는 넷, "설정"·"입금 확인"은 화면 읽기에도 없다', async () => {
    await phoneTopBar({ name: 'home' })
    expect(more().getAttribute('aria-expanded')).toBe('false')
    expect(list()).toBeNull()
    expect(within(menuNav()).getAllByRole('link')).toHaveLength(4)
    expect(screen.queryByRole('link', { name: '설정' })).toBeNull()
    expect(document.body.textContent).not.toContain('입금 확인')
  })

  it('"더보기"를 누르면 막대 위 목록 — "입금 확인"·"포장"·"라벨"·"설정" 순서(주소 있는 링크), 라벨이 꺼져 있으면 "라벨"은 만들지 않는다', async () => {
    await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    expect(more().getAttribute('aria-expanded')).toBe('true')
    const opened = list() as HTMLElement
    expect(more().getAttribute('aria-controls')).toBe(opened.id)
    const links = within(opened).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['입금 확인', '/deposits'],
      ['포장', '/packing'],
      ['라벨', '/labels'],
      ['설정', '/settings'],
    ])
    expect(within(opened).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getAllByRole('link', { name: '설정' })).toHaveLength(1)
    // 키보드 차례: "더보기" 다음이 목록 항목 (DOM 순서 = Tab 순서)
    expect(more().compareDocumentPosition(links[0] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    vi.resetModules()
    await phoneTopBar({ name: 'home' }, { labels: false })
    fireEvent.click(more())
    expect(within(list() as HTMLElement).getAllByRole('link').map((link) => link.textContent)).toEqual(['입금 확인', '포장', '설정'])
  })
})

describe('열고 닫기 (AC-NAV-03)', () => {
  it('다시 누르면 닫힌다', async () => {
    await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    fireEvent.click(more())
    expect(more().getAttribute('aria-expanded')).toBe('false')
    expect(list()).toBeNull()
  })

  it('Esc는 목록을 닫고 포커스를 "더보기"로 돌린다 — 다른 Esc 동작으로 넘기지 않는다', async () => {
    await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    const link = within(list() as HTMLElement).getByRole('link', { name: '포장' })
    link.focus()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    fireEvent.keyDown(link, { key: 'Escape' })
    document.removeEventListener('keydown', outer)
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(more())
    expect(outer).not.toHaveBeenCalled()
  })

  it('목록 밖(덮개)을 누르면 아무 데도 가지 않고 닫힌다', async () => {
    const { navigate } = await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    const cover = document.querySelector('.menu-more-backdrop') as HTMLElement
    expect(cover.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(cover)
    expect(list()).toBeNull()
    expect(document.querySelector('.menu-more-backdrop')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('항목을 고르면 그 화면으로(앱 안 이동) 가고 닫힌다', async () => {
    const { navigate } = await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    const settings = within(list() as HTMLElement).getByRole('link', { name: '설정' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    act(() => {
      settings.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ name: 'settings' })
    expect(list()).toBeNull()
  })

  it('화면이 바뀌면(뒤로 가기 포함) 닫힌다 — 막대 칸으로 옮겨도', async () => {
    const { rerender } = await phoneTopBar({ name: 'home' })
    fireEvent.click(more())
    rerender({ name: 'sms' })
    expect(list()).toBeNull()
    expect(more().getAttribute('aria-expanded')).toBe('false')
    // 돌아와도 닫힌 채
    rerender({ name: 'home' })
    expect(list()).toBeNull()
  })
})

describe('지금 위치·수 (AC-NAV-04·05)', () => {
  it('목록 안 화면(/deposits·/packing·/labels·/settings·/settings/youtube)이면 "더보기"와 그 항목이 aria-current="page"', async () => {
    const cases: readonly [Route, string][] = [
      [{ name: 'deposits', tab: 'review' }, '입금 확인'],
      [{ name: 'packing' }, '포장'],
      [{ name: 'labels' }, '라벨'],
      [{ name: 'settings' }, '설정'],
      [{ name: 'settings', section: 'youtube' }, '설정'],
    ]
    for (const [route, name] of cases) {
      await phoneTopBar(route)
      expect(more().getAttribute('aria-current')).toBe('page')
      expect(barCells().filter((cell) => cell.getAttribute('aria-current') === 'page')).toHaveLength(1)
      fireEvent.click(more())
      const current = within(list() as HTMLElement).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
      expect(current.map((link) => link.textContent)).toEqual([name])
      cleanup()
      vi.resetModules()
    }
  })

  it('앞 네 칸의 화면이면 그 칸이 aria-current="page"이고 "더보기"에는 없다', async () => {
    const cases: readonly [Route, string][] = [
      [{ name: 'home' }, '방송'],
      [{ name: 'console', id: 'b1' }, '방송'],
      [{ name: 'sms' }, '문자찜 입력'],
      [{ name: 'buyers', rehearsal: false }, '구매자'],
      [{ name: 'settlements', rehearsal: false }, '정산'],
    ]
    for (const [route, name] of cases) {
      await phoneTopBar(route)
      expect(more().hasAttribute('aria-current')).toBe(false)
      expect(barCells().filter((cell) => cell.getAttribute('aria-current') === 'page').map((cell) => cell.textContent)).toEqual([name])
      cleanup()
      vi.resetModules()
    }
  })
})

describe('보조자 (AC-NAV-08)', () => {
  it('"문자찜 입력" 한 칸, "더보기" 없음', async () => {
    await phoneTopBar({ name: 'sms' }, { assistant: true })
    expect(barCells().map((cell) => cell.textContent)).toEqual(['문자찜 입력'])
    expect(within(menuNav()).queryByRole('button', { name: '더보기' })).toBeNull()
  })
})
