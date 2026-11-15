// D-UX4-160~162 (사용자 지시 2026-11-16 "라이브 링크 넣는 화면에서 링크를 모르겠어요 누르면 해당 플랫폼 앱이나 웹으로 넘어가는데, 그냥 우리 앱 안에서
// 브라우저 띄워서 해당 라이브 들어간 다음에, 밑에 [이 라이브에요] 버튼을 누르면 자동으로 그 라이브로 연결되도록"):
// - 플랫폼을 고르면 앱 안 전체 화면 브라우저. 시작 주소는 아는 채널·계정의 라이브 쪽, 모르면 모바일 웹 첫 화면.
// - 아래 한 줄 왼쪽 [닫기] · 오른쪽 [이 라이브예요]. 지금 주소가 라이브 한 편일 때만 켜지고, 아니면 꺼진 채 그 위에 안내.
// - [이 라이브예요] → 브라우저를 닫고 링크 칸에 넣고 [다음]과 똑같이 진행(이미 있는 잇기 요청). 못 이으면 칸 아래 오류 그대로.
// - SPA 주소 변화는 쪽 안 스크립트가 알려 준다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_MESSAGE, LOCATION_WATCH_SCRIPT, browserHost, browserLiveLink, browserStart, canOpenInBrowser, readLocationMessage } from '../src/lib/live-browser.ts'
import { liveLinkOf } from '../src/lib/live-link.ts'
import { BROWSER_HINT, LiveBrowser, setLiveBrowserView, type LiveBrowserViewHandle, type LiveBrowserViewProps } from '../src/screens/LiveBrowser.tsx'
import { NewBroadcastAddressScreen } from '../src/screens/NewBroadcastScreen.tsx'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const CHANNEL = 'UCabcdefghijklmnopqrstuv'

describe('라이브 주소 판정 (D-UX4-161)', () => {
  it('라이브 한 편을 가리키는 주소만 링크로 읽고, 서버가 읽는 모양으로 다듬는다', () => {
    const cases: [string, string | null][] = [
      // 유튜브: watch?v= · live/ · youtu.be/ · shorts/
      ['https://m.youtube.com/watch?v=LIVENOW0001&pp=ygU', 'https://www.youtube.com/watch?v=LIVENOW0001'],
      ['https://www.youtube.com/watch?feature=share&v=LIVENOW0001', 'https://www.youtube.com/watch?v=LIVENOW0001'],
      ['https://m.youtube.com/live/LIVENOW0001?si=abc', 'https://www.youtube.com/watch?v=LIVENOW0001'],
      ['https://youtu.be/LIVENOW0001', 'https://www.youtube.com/watch?v=LIVENOW0001'],
      ['https://m.youtube.com/shorts/LIVENOW0001', 'https://www.youtube.com/watch?v=LIVENOW0001'],
      // 유튜브 첫 화면·채널·채널 라이브 쪽(라이브 중이 아니면 채널에 머문다)·검색은 아니다
      ['https://m.youtube.com/', null],
      [`https://m.youtube.com/channel/${CHANNEL}/live`, null],
      ['https://m.youtube.com/@dayuk/live', null],
      ['https://m.youtube.com/results?search_query=다육', null],
      ['https://m.youtube.com/watch?v=short', null],
      // 틱톡: @아이디/live
      ['https://www.tiktok.com/@shop.two/live?enter_from=x', 'https://www.tiktok.com/@shop.two/live'],
      ['https://m.tiktok.com/@shop_two/live/', 'https://www.tiktok.com/@shop_two/live'],
      ['https://www.tiktok.com/', null],
      ['https://www.tiktok.com/@shop_two', null],
      ['https://www.tiktok.com/@shop_two/video/123', null],
      // 밴드: band/번호/post·live/번호
      ['https://band.us/band/12345678/post/42', 'https://band.us/band/12345678/post/42'],
      ['https://www.band.us/band/12345678/live/7?x=1', 'https://band.us/band/12345678/live/7'],
      ['https://band.us/', null],
      ['https://band.us/band/12345678', null],
      // 다른 곳·이상한 주소
      ['https://example.com/watch?v=LIVENOW0001', null],
      ['https://user@m.youtube.com/watch?v=LIVENOW0001', null],
      ['youtube://watch?v=LIVENOW0001', null],
      ['', null],
    ]
    for (const [url, expected] of cases) expect(browserLiveLink(url)?.url ?? null, url).toBe(expected)
    // 넣는 링크는 링크 칸 해석기가 같은 플랫폼으로 읽는다
    expect(browserLiveLink('https://m.youtube.com/live/LIVENOW0001')?.platform).toBe('youtube')
    expect(browserLiveLink('https://www.tiktok.com/@shop/live')).toEqual(liveLinkOf('https://www.tiktok.com/@shop/live'))
    expect(browserLiveLink('https://band.us/band/1/post/2')?.platform).toBe('band')
  })

  it('시작 주소: 채널·틱톡 아이디를 알면 그 라이브 쪽, 모르면 첫 화면', () => {
    expect(browserStart('youtube')).toBe('https://m.youtube.com/')
    expect(browserStart('youtube', { youtubeChannel: CHANNEL })).toBe(`https://m.youtube.com/channel/${CHANNEL}/live`)
    expect(browserStart('youtube', { youtubeChannel: '../evil' })).toBe('https://m.youtube.com/')
    expect(browserStart('tiktok')).toBe('https://www.tiktok.com/')
    expect(browserStart('tiktok', { tiktokId: '@shop.two' })).toBe('https://www.tiktok.com/@shop.two/live')
    expect(browserStart('tiktok', { tiktokId: 'a b' })).toBe('https://www.tiktok.com/')
    expect(browserStart('band', { youtubeChannel: CHANNEL, tiktokId: 'shop' })).toBe('https://band.us/')
  })

  it('머리 주소는 도메인만, 앱 열기 주소는 막고, 쪽 안 알림만 받는다', () => {
    expect(browserHost('https://m.youtube.com/watch?v=LIVENOW0001')).toBe('youtube.com')
    expect(browserHost('https://www.tiktok.com/@a/live')).toBe('tiktok.com')
    expect(browserHost('https://band.us/band/1')).toBe('band.us')
    expect(canOpenInBrowser('https://m.youtube.com/')).toBe(true)
    expect(canOpenInBrowser('about:blank')).toBe(true)
    for (const url of ['youtube://watch?v=1', 'intent://x#Intent;end', 'snssdk1233://live', 'bandapp://', 'tel:010', 'file:///etc/passwd']) expect(canOpenInBrowser(url), url).toBe(false)
    expect(readLocationMessage(JSON.stringify({ type: LOCATION_MESSAGE, url: 'https://m.youtube.com/live/LIVENOW0001' }))).toBe('https://m.youtube.com/live/LIVENOW0001')
    expect(readLocationMessage(JSON.stringify({ type: 'other', url: 'https://m.youtube.com/' }))).toBeNull()
    expect(readLocationMessage(JSON.stringify({ type: LOCATION_MESSAGE, url: 'javascript:alert(1)' }))).toBeNull()
    expect(readLocationMessage('not json')).toBeNull()
  })

  it('쪽 안 스크립트는 history 바뀜(SPA)·뒤로·해시를 듣고 주소를 보낸다', () => {
    expect(LOCATION_WATCH_SCRIPT).toContain("wrap('pushState')")
    expect(LOCATION_WATCH_SCRIPT).toContain("wrap('replaceState')")
    expect(LOCATION_WATCH_SCRIPT).toContain("addEventListener('popstate'")
    expect(LOCATION_WATCH_SCRIPT).toContain("addEventListener('hashchange'")
    expect(LOCATION_WATCH_SCRIPT).toContain('ReactNativeWebView.postMessage')
    // 스크립트를 실제로 돌려 SPA 이동을 알리는지 본다
    const sent: string[] = []
    const win = window as unknown as { ReactNativeWebView?: { postMessage: (data: string) => void }; __livegenieWatch?: boolean }
    win.ReactNativeWebView = { postMessage: (data) => sent.push(data) }
    vi.useFakeTimers()
    try {
      new Function(LOCATION_WATCH_SCRIPT)()
      history.pushState({}, '', '/watch?v=LIVENOW0001')
      vi.advanceTimersByTime(10)
      expect(sent.map(readLocationMessage).at(-1)).toMatch(/\/watch\?v=LIVENOW0001$/)
    } finally {
      vi.useRealTimers()
      delete win.ReactNativeWebView
      delete win.__livegenieWatch
      history.replaceState({}, '', '/')
    }
  })
})

/** 가짜 웹 화면: 받은 처음 주소를 모으고, 시험이 주소·뒤로 갈 수 있음을 바꾼다 */
const fake = vi.hoisted(() => ({
  starts: [] as string[],
  props: null as LiveBrowserViewProps | null,
  backs: 0,
  forwards: 0,
}))
const FakeView = forwardRef<LiveBrowserViewHandle, LiveBrowserViewProps>(function FakeView(props, ref) {
  if (fake.props?.url !== props.url) fake.starts.push(props.url)
  fake.props = props
  useImperativeHandle(ref, () => ({ goBack: () => (fake.backs += 1), goForward: () => (fake.forwards += 1) }))
  return <div data-testid={props.testID} />
})

describe('앱 안 브라우저 화면 (D-UX4-161)', () => {
  afterEach(() => {
    fake.starts = []
    fake.props = null
    fake.backs = 0
    fake.forwards = 0
  })

  it('라이브 화면이 아니면 [이 라이브예요]가 꺼져 있고 안내가 보인다 — SPA로 라이브에 들어가면 켜지고 누르면 그 링크', async () => {
    const before = setLiveBrowserView(FakeView)
    try {
      const onPick = vi.fn()
      const onClose = vi.fn()
      render(makeWorld().wrap(<LiveBrowser open={{ id: 1, url: 'https://m.youtube.com/' }} onClose={onClose} onPick={onPick} />))
      const browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
      expect(fake.starts).toEqual(['https://m.youtube.com/'])
      expect(within(browser).getByTestId('live-browser-host').textContent).toBe('youtube.com')
      const pick = within(browser).getByRole('button', { name: '이 라이브예요' })
      expect(pick.getAttribute('aria-disabled')).toBe('true')
      expect(browser.textContent).toContain(BROWSER_HINT)
      fireEvent.click(pick)
      expect(onPick).not.toHaveBeenCalled()
      // 뒤로·앞으로: 갈 곳이 없으면 꺼짐
      expect(within(browser).getByRole('button', { name: '뒤로' }).getAttribute('aria-disabled')).toBe('true')
      act(() => {
        fake.props?.onHistory({ canGoBack: true, canGoForward: true })
        fake.props?.onLocation('https://m.youtube.com/live/LIVENOW0001?si=x')
      })
      expect(within(browser).getByRole('button', { name: '이 라이브예요' }).getAttribute('aria-disabled')).not.toBe('true')
      expect(browser.textContent).not.toContain(BROWSER_HINT)
      fireEvent.click(within(browser).getByRole('button', { name: '뒤로' }))
      fireEvent.click(within(browser).getByRole('button', { name: '앞으로' }))
      expect([fake.backs, fake.forwards]).toEqual([1, 1])
      fireEvent.click(within(browser).getByRole('button', { name: '이 라이브예요' }))
      expect(onPick).toHaveBeenCalledWith('https://www.youtube.com/watch?v=LIVENOW0001')
      // 채널 쪽으로 돌아가면 다시 꺼진다
      act(() => fake.props?.onLocation(`https://m.youtube.com/channel/${CHANNEL}`))
      expect(within(browser).getByRole('button', { name: '이 라이브예요' }).getAttribute('aria-disabled')).toBe('true')
      // 닫기: 아래 [닫기]·위 [닫기] 모두
      fireEvent.click(within(browser).getByTestId('live-browser-close'))
      fireEvent.click(within(browser).getByRole('button', { name: '브라우저 닫기' }))
      expect(onClose).toHaveBeenCalledTimes(2)
    } finally {
      setLiveBrowserView(before)
    }
  })

  it('아래 단추는 한 줄 — 왼쪽 [닫기], 오른쪽 [이 라이브예요] (규칙 8)', async () => {
    render(makeWorld().wrap(<LiveBrowser open={{ id: 1, url: 'https://m.youtube.com/' }} onClose={() => {}} onPick={() => {}} />))
    const browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
    const close = within(browser).getByTestId('live-browser-close')
    const pick = within(browser).getByTestId('live-browser-pick')
    // 같은 줄(ButtonRow)의 이웃 칸: 닫기가 먼저(왼쪽)
    const row = close.parentElement?.parentElement
    expect(row).toBe(pick.parentElement?.parentElement)
    expect(getComputedStyle(row as Element).flexDirection).toBe('row')
    expect(close.compareDocumentPosition(pick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

function newWorld() {
  const world = makeWorld()
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
  world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-11-16', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-16', title: String(call.body?.title ?? ''), rehearsal: false } } }))
  world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, () => ({ body: { link: null, collector: null } }))
  world.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: '오늘의 다육이', channelTitle: '다육이네' } }))
  return world
}
const newNav = () => ({ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() })

async function openBrowser(platform: string) {
  fireEvent.click(await screen.findByRole('button', { name: '링크를 모르겠어요' }))
  fireEvent.click(screen.getByRole('button', { name: platform }))
  return screen.findByRole('dialog', { name: '라이브 찾기' })
}
const visit = (browser: HTMLElement, url: string) => fireEvent.change(within(browser).getByRole('textbox', { name: '주소' }), { target: { value: url } })

describe('[이 라이브예요] → 링크 칸 제출 경로 (D-UX4-162)', () => {
  it('새 라이브: 유튜브 라이브를 고르면 [다음]과 같이 확인 화면 → [연결하기]로 그 링크를 잇는다', async () => {
    const world = newWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const browser = await openBrowser('유튜브')
    expect((within(browser).getByRole('textbox', { name: '주소' }) as HTMLInputElement).value).toBe('https://m.youtube.com/')
    visit(browser, 'https://m.youtube.com/watch?v=tWnNGwvdN40&pp=x')
    fireEvent.click(within(browser).getByRole('button', { name: '이 라이브예요' }))
    const confirmPage = await screen.findByTestId('link-confirm')
    expect((await within(confirmPage).findByTestId('live-check-title')).textContent).toBe('오늘의 다육이')
    fireEvent.click(within(confirmPage).getByRole('button', { name: '연결하기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40', confirmInvited: true })
  })

  it('못 이으면 링크 화면으로 돌아와 칸에 링크가 있고 칸 아래 오류 안내가 그대로 보인다', async () => {
    const world = newWorld()
    world.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ status: 409, body: { error: { code: 'NO_LIVE_CHAT', message: '채팅 없음' } } }))
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    const browser = await openBrowser('유튜브')
    visit(browser, 'https://m.youtube.com/live/tWnNGwvdN40')
    fireEvent.click(within(browser).getByRole('button', { name: '이 라이브예요' }))
    expect(await screen.findByText('라이브 채팅을 받을 수 없는 라이브예요.')).toBeTruthy()
    expect(((await screen.findByLabelText('라이브 링크')) as HTMLInputElement).value).toBe('https://www.youtube.com/watch?v=tWnNGwvdN40')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('[닫기]는 브라우저만 닫고 칸·서버는 그대로', async () => {
    const world = newWorld()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    const browser = await openBrowser('유튜브')
    visit(browser, 'https://m.youtube.com/live/tWnNGwvdN40')
    fireEvent.click(within(browser).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '라이브 찾기' })).toBeNull())
    expect(((await screen.findByLabelText('라이브 링크')) as HTMLInputElement).value).toBe('')
    expect(world.server.callsTo('POST', /^\/api\/youtube\/preview$/)).toHaveLength(0)
  })

  it('최근 연결한 채널을 알면 유튜브는 그 채널의 라이브 쪽에서 시작한다', async () => {
    const world = newWorld()
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [{ videoId: 'UPCOMING001', title: '다음 라이브', status: 'UPCOMING', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: CHANNEL, channelTitle: '다육이네' }] } }))
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    await screen.findByTestId('recent-live')
    const browser = await openBrowser('유튜브')
    expect((within(browser).getByRole('textbox', { name: '주소' }) as HTMLInputElement).value).toBe(`https://m.youtube.com/channel/${CHANNEL}/live`)
  })

  it('라이브 연결 화면: 틱톡은 가게의 틱톡 아이디 라이브 쪽에서 시작하고, 고르면 그 링크로 틱톡을 잇는다', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok: { tiktokId: 'shop_two' } } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/tiktok\/link-url$/, () => ({ body: { link: { state: 'LINKED' } } }))
    const onBack = vi.fn()
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={onBack} />))
    await screen.findByRole('dialog', { name: '라이브 연결' })
    fireEvent.click(await screen.findByRole('button', { name: '링크를 모르겠어요' }))
    await waitFor(() => expect(world.server.callsTo('GET', /^\/api\/tiktok$/)).toHaveLength(1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByRole('button', { name: '틱톡' }))
    const browser = await screen.findByRole('dialog', { name: '라이브 찾기' })
    expect((within(browser).getByRole('textbox', { name: '주소' }) as HTMLInputElement).value).toBe('https://www.tiktok.com/@shop_two/live')
    fireEvent.click(within(browser).getByRole('button', { name: '이 라이브예요' }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(world.server.callsTo('POST', /tiktok\/link-url$/)[0]?.body).toEqual({ requestId: expect.any(String), url: 'https://www.tiktok.com/@shop_two/live' })
  })
})
