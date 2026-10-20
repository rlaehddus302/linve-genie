// 설치 안내·새 버전 안내 (AC-S06-51·52, D-093): 브라우저가 설치를 제안하면 "앱으로 설치"(누르면 브라우저 설치 창), 아이폰 사파리는 "홈 화면에 추가" 안내,
// 이미 앱으로 열렸으면 숨김, 설치했거나 "닫기"를 누르면 이 기기에서 다시 보이지 않는다(저장소가 막혀도 동작).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Navigate, Route } from '../src/lib/router.ts'
import { overview, queue } from './print-support.ts'
import { FakeEventSource } from './support.ts'

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function topBar() {
  const pwa = await import('../src/pwa/pwa.ts')
  const { TopBar } = await import('../src/components/TopBar.tsx')
  pwa.startPwa({ serviceWorker: false })
  render(<TopBar shopName="구피 가게" onLogout={() => {}} route={{ name: 'home' }} navigate={() => {}} />)
  return pwa
}

function offerInstall(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
  const prompt = vi.fn(() => Promise.resolve())
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  act(() => {
    window.dispatchEvent(event)
  })
  return { event, prompt }
}

describe('앱 설치 (AC-S06-52)', () => {
  it('설치 제안이 오면 "앱으로 설치" — 누르면 브라우저 설치 창, 설치하면 이 기기에서 숨긴다', async () => {
    await topBar()
    expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull()
    const { event, prompt } = offerInstall('accepted')
    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: '앱으로 설치' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull())
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('livejjim.installHint')).toBe('hidden')
  })

  it('"닫기"를 누르면 다시 보이지 않는다 (다시 열어도)', async () => {
    await topBar()
    offerInstall('dismissed')
    fireEvent.click(await screen.findByRole('button', { name: '앱 설치 안내 닫기' }))
    expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull()
    cleanup()
    vi.resetModules()
    await topBar()
    offerInstall('dismissed')
    expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull()
  })

  it('이미 앱으로 열렸으면(standalone) 설치 버튼도 안내도 없다', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    await topBar()
    offerInstall('dismissed')
    expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull()
  })

  it('브라우저 저장소가 막혀도 화면은 동작한다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('막힘')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('막힘')
    })
    await topBar()
    offerInstall('dismissed')
    fireEvent.click(await screen.findByRole('button', { name: '앱 설치 안내 닫기' }))
    expect(screen.queryByRole('button', { name: '앱으로 설치' })).toBeNull()
  })

  it('아이폰 사파리 판별 (크롬·파이어폭스 iOS는 아니다)', async () => {
    const { isIosSafari } = await import('../src/pwa/pwa.ts')
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    expect(isIosSafari(safari, 5)).toBe(true)
    expect(isIosSafari(safari.replace('Version/18.0', 'CriOS/130.0'), 5)).toBe(false)
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5)).toBe(true)
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 0)).toBe(false)
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 5)).toBe(false)
  })
})

/**
 * 위 줄을 출력 기록(라벨 기능 켬/끔)과 함께 그린다 (N4a): labelsEnabled가 null이면 아직 모르는 채(조회 전).
 * 메뉴 "라벨"·프린터 상태는 켬/끔을 안 뒤 켜져 있을 때만 보인다 (AC-N4a-13·18)
 */
async function topBarWithLabels(labelsEnabled: boolean | null, route: Route, navigate: Navigate = () => {}) {
  const { TopBar } = await import('../src/components/TopBar.tsx')
  const { PrintContext } = await import('../src/components/print-context.tsx')
  const { PrintStore } = await import('../src/lib/print-store.ts')
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  if (labelsEnabled !== null) {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(overview({ queue: queue({ labelsEnabled }) })), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await store.reload()
  }
  render(
    <PrintContext.Provider value={{ store, station: {} as never }}>
      <TopBar shopName="구피 가게" onLogout={() => {}} route={route} navigate={navigate} />
    </PrintContext.Provider>,
  )
}

describe('메뉴 (AC-S06-01, AC-I1-20, AC-I3-44, AC-N4a-10·13·18)', () => {
  it('"방송"·"문자찜 입력"·"구매자"·"정산"·"라벨"(AC-I1-20)·"설정"(AC-I3-44), 지금 화면은 aria-current="page" — 구매자·정산 사이는 고른 날짜를 이어 간다', async () => {
    const navigate = vi.fn()
    await topBarWithLabels(true, { name: 'buyers', date: '2026-10-18', rehearsal: true }, navigate)
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    const links = [...menu.querySelectorAll('a')]
    expect(links.map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '라벨', '설정'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null, null])
    expect(links[4]?.getAttribute('href')).toBe('/labels')
    expect(links[5]?.getAttribute('href')).toBe('/settings')
    expect(links[3]?.getAttribute('href')).toBe('/settlements?date=2026-10-18&rehearsal=true')
    fireEvent.click(links[1] as HTMLAnchorElement)
    expect(navigate).toHaveBeenCalledWith({ name: 'sms' })
    expect(screen.getByRole('link', { name: '출력 기기 없음' }).getAttribute('href')).toBe('/labels')
  })

  it('"설정"은 메뉴 항목 하나 — 누르면 /settings, 그 화면이면 aria-current="page". 위 줄에 따로 "설정" 링크를 두지 않는다 (AC-I3-44, D-N4a-07)', async () => {
    const navigate = vi.fn()
    await topBarWithLabels(true, { name: 'settings' }, navigate)
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    const settings = within(menu).getByRole('link', { name: '설정' })
    expect(settings.getAttribute('href')).toBe('/settings')
    expect(settings.getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: '설정' })).toHaveLength(1)
    fireEvent.click(settings)
    expect(navigate).toHaveBeenCalledWith({ name: 'settings' })
  })

  it('라벨 기능이 꺼져 있으면 메뉴 "라벨"과 프린터 상태가 없다 — 다른 메뉴와 "설정"은 그대로', async () => {
    await topBarWithLabels(false, { name: 'home' })
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect([...menu.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '설정'])
    expect(screen.queryByRole('link', { name: /출력 기기|프린터|출력 멈춤/ })).toBeNull()
    expect(within(menu).getByRole('link', { name: '설정' }).getAttribute('href')).toBe('/settings')
  })

  it('켬/끔을 아직 모르면(불러오는 중) 메뉴 "라벨"·프린터 상태를 보이지 않는다 (AC-N4a-18)', async () => {
    await topBarWithLabels(null, { name: 'home' })
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect([...menu.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '설정'])
    expect(screen.queryByRole('link', { name: /출력 기기|프린터|출력 멈춤/ })).toBeNull()
  })
})
