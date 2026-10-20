// 설치 안내·새 버전 안내 (AC-S06-51·52, D-093): 브라우저가 설치를 제안하면 "앱으로 설치"(누르면 브라우저 설치 창), 아이폰 사파리는 "홈 화면에 추가" 안내,
// 이미 앱으로 열렸으면 숨김, 설치했거나 "닫기"를 누르면 이 기기에서 다시 보이지 않는다(저장소가 막혀도 동작).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('메뉴 (AC-S06-01)', () => {
  it('"방송"·"문자찜 입력"·"구매자"·"정산"·"포장"·"설정"(I2 AC-I2-02·35), 지금 화면은 aria-current="page" — 구매자·정산 사이는 고른 날짜를 이어 간다', async () => {
    const { TopBar } = await import('../src/components/TopBar.tsx')
    const navigate = vi.fn()
    render(<TopBar shopName="구피 가게" onLogout={() => {}} route={{ name: 'buyers', date: '2026-10-18', rehearsal: true }} navigate={navigate} />)
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    const links = [...menu.querySelectorAll('a')]
    expect(links.map((link) => link.textContent)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '포장', '설정'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null, null])
    expect(links[3]?.getAttribute('href')).toBe('/settlements?date=2026-10-18&rehearsal=true')
    // 포장은 실제 범위만 — 리허설 날짜를 보고 있었으면 날짜를 잇지 않는다
    expect(links[4]?.getAttribute('href')).toBe('/packing')
    expect(links[5]?.getAttribute('href')).toBe('/settings')
    fireEvent.click(links[1] as HTMLAnchorElement)
    expect(navigate).toHaveBeenCalledWith({ name: 'sms' })
  })
})
