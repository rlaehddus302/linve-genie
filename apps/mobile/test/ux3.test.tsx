// 앱 화면 다듬기 (D-UX3-01~06, 사용자 지시 2026-11-03 "토스처럼"): 아래 탭 5개와 좌우 밀림 방향, 누르면 바탕이 진해짐,
// 전체 탭 묶음, 새 방송 쌓인 화면(판매 종류 → 주소 → 만들고 바로 잇기, D-UX3-09·10), 토스 뜬 라벨 입력 칸(D-UX3-08).
// D-UX3-13: 아래 탭은 내용 위에 반투명하게 뜨고, 링크 잇기 단추 이름은 [이 방송에 잇기] → [확인].
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { shortLinkError } from '../src/screens/console/YoutubeSection.tsx'
import { LIVE_PLATFORMS, setPlatformOpener } from '../src/lib/open-app.ts'
import { liveLinkOf } from '../src/lib/live-link.ts'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen, SALE_CATEGORIES, categoryBroadcastTitle } from '../src/screens/NewBroadcastScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { TabFrame, tabEnterSide } from '../src/screens/TabFrame.tsx'
import { BACK_ICON, FIELD_LABEL_MS, FIELD_ROW, PALETTE, TABS, TabBar, UnderlineField, pressedFill, useTabBarRoom } from '../src/ui/kit/index.ts'
import { TYPE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'

describe('아래 탭 (D-UX3-01·12)', () => {
  it('아이콘은 홈·프린터·영수증·상자·세 줄로 서로 다르고, 모두 가로세로가 같은 칸이다', () => {
    expect(TABS.map((tab) => tab.icon)).toEqual(['home', 'printer', 'receipt', 'box', 'menu'])
    const world = makeWorld()
    const { container } = render(world.wrap(<TabBar active="home" onSelect={() => {}} />))
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs).toHaveLength(5)
    for (const svg of svgs) expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'))
  })

  it('탭은 홈 · 라벨 · 정산 · 포장 · 전체 다섯이고 고른 탭만 골라져 있다', () => {
    const world = makeWorld()
    const onSelect = vi.fn()
    render(world.wrap(<TabBar active="settle" onSelect={onSelect} />))
    const tabs = within(screen.getByRole('tablist', { name: '아래 메뉴' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['홈', '라벨', '정산', '포장', '전체'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false'])
    fireEvent.click(screen.getByRole('tab', { name: '라벨' }))
    expect(onSelect).toHaveBeenCalledWith('labels')
  })

  it('아래 탭은 따로 바탕 띠 없이 내용 위에 뜨고(반투명 흰색), 내용은 탭 높이만큼 아래를 더 비운다 (D-UX3-13)', () => {
    const world = makeWorld()
    function Content() {
      return <span data-testid="room">{String(useTabBarRoom())}</span>
    }
    const { container } = render(world.wrap(
      <TabFrame active="home" go={() => {}}>
        <Content />
      </TabFrame>,
    ))
    expect(Number(screen.getByTestId('room').textContent)).toBeGreaterThan(56)
    const list = screen.getByRole('tablist', { name: '아래 메뉴' })
    const bar = list.parentElement?.parentElement as HTMLElement
    expect(getComputedStyle(bar).position).toBe('absolute')
    expect(PALETTE.light.glass).toMatch(/^rgba\(255, ?255, ?255, ?0\.\d+\)$/)
    // 탭 밖 화면은 더 비우지 않는다
    render(world.wrap(<Content />))
    expect(screen.getAllByTestId('room').at(-1)?.textContent).toBe('0')
    expect(container).toBeTruthy()
  })

  it('집 문 아래·프린터 종이 위로 지나는 선이 없고, 고른 상자는 테이프 자리 윗선까지 뚫린다 (D-UX3-13)', () => {
    const world = makeWorld()
    const { container } = render(world.wrap(<TabBar active="packing" onSelect={() => {}} />))
    const [home, printer, , box] = [...container.querySelectorAll('svg')]
    // 집은 문 홈이 든 한 줄 모양(따로 그린 문 없음)
    expect(home?.querySelectorAll('path')).toHaveLength(1)
    expect(home?.querySelector('path')?.getAttribute('d')).toContain('H14.1 V16.2')
    // 프린터 몸통은 종이 앞(7~17)에서 끊긴 열린 모양 (D-UX3-15: 첫 줄은 위 받침 — 몸통은 둘째)
    const bodyLine = printer?.querySelectorAll('path')[1]?.getAttribute('d') ?? ''
    expect(bodyLine.startsWith('M7 17.4')).toBe(true)
    expect(bodyLine.endsWith('H17')).toBe(true)
    // 고른 상자: 테이프 뚫기가 윗선 위(2.4)부터
    expect([...(box?.querySelectorAll('path') ?? [])].some((path) => path.getAttribute('d')?.startsWith('M10.2 2.4') === true)).toBe(true)
    // 모서리는 원호(A)가 아니라 아이폰 연속 곡률 곡선(C) — 집 문 홈만 원호 (D-UX3-15)
    for (const svg of [printer, box]) for (const path of svg?.querySelectorAll('path') ?? []) expect(path.getAttribute('d')).not.toMatch(/A/)
  })

  it('오른쪽 탭으로 가면 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서 들어온다. 처음·같은 탭은 그대로', () => {
    expect(tabEnterSide('home', 'packing')).toBe(1)
    expect(tabEnterSide('more', 'labels')).toBe(-1)
    expect(tabEnterSide(null, 'home')).toBe(0)
    expect(tabEnterSide('settle', 'settle')).toBe(0)
  })
})

describe('누르는 동안 바탕 (D-UX3-03)', () => {
  it('흐려지지 않고 놓인 바탕보다 진한 색 — 흰 줄·초록 단추·회색 단추·주의 줄 각각', () => {
    const p = PALETTE.light
    expect(pressedFill(p, p.surface)).toBe(p.pressed)
    expect(pressedFill(p, p.primary)).toBe(p.primaryPressed)
    expect(pressedFill(p, p.soft)).toBe(p.softPressed)
    expect(pressedFill(p, p.warnBg)).toBe(p.warnPressed)
    for (const [base, pressed] of [[p.surface, p.pressed], [p.soft, p.softPressed], [p.primary, p.primaryPressed]] as const) expect(luma(pressed)).toBeLessThan(luma(base))
  })
})

describe('전체 탭 (D-UX3-04)', () => {
  it('맨 위에 설정, 화면들은 묶음 이름이 든 카드로, 라벨·프린터 줄은 없다(아래 탭으로 옮김)', () => {
    const world = makeWorld()
    const openSettings = vi.fn()
    const openApp = vi.fn()
    render(world.wrap(<MoreScreen nav={{ openSettings, openApp }} account="김다육 · kim" onLogout={() => {}} />))
    expect(screen.getByRole('heading', { name: '전체' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(openSettings).toHaveBeenCalled()
    for (const group of ['방송', '주문·입금', '배송', '가게', '계정']) expect(screen.getByRole('group', { name: group })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '배송' })).getByRole('button', { name: '택배' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '라벨·프린터' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '입금 확인' }))
    expect(openApp).toHaveBeenCalledWith('/deposits')
  })
})

describe('새 방송: 판매 종류 → 방송 주소 (D-UX3-09·10)', () => {
  const linkableWorld = () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-11-03', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-03', title: String(call.body?.title ?? ''), rehearsal: false } } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, () => ({ body: { link: null, collector: null } }))
    return world
  }
  const newNav = () => ({ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() })
  afterEach(() => {
    setClipboardReader(async () => '')
    setClipboardProbe(null)
    setPlatformOpener(async () => 'browser')
  })

  it('제목은 판매 종류로 짓는다: 다육이·화분은 종류를 넣고 기타는 날짜·요일만', () => {
    expect(SALE_CATEGORIES.map((item) => item.word)).toEqual(['다육이', '화분', '기타'])
    expect(categoryBroadcastTitle('2026-11-03', 'succulent')).toBe('2026-11-03 화요일 다육이 방송')
    expect(categoryBroadcastTitle('2026-11-03', 'pot')).toBe('2026-11-03 화요일 화분 방송')
    expect(categoryBroadcastTitle('2026-11-03', 'other')).toBe('2026-11-03 화요일 방송')
    expect(categoryBroadcastTitle('2026-11-03', 'nope')).toBe('2026-11-03 화요일 방송')
  })

  it('"어떤 방송인가요?"는 판매 종류 단추만 — 제목 칸이 없고, 하나를 누르면 방송을 만들지 않고 주소 단계로 간다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    expect(within(page).getByRole('heading', { name: '어떤 방송인가요?' })).toBeTruthy()
    expect(within(page).queryByRole('textbox')).toBeNull()
    expect(within(screen.getByRole('group', { name: '판매 종류' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['다육이', '화분', '기타'])
    fireEvent.click(within(page).getByRole('button', { name: '화분' }))
    await waitFor(() => expect(nav.openAddress).toHaveBeenCalledWith('pot'))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(nav.back).toHaveBeenCalled()
  })

  it('링크 단계: 링크를 넣기 전엔 [확인]가 없고, 넣으면 종류 제목으로 방송을 만들고 바로 잇는다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    expect(within(page).getByRole('heading', { name: '방송 링크를 넣어 주세요' })).toBeTruthy()
    const address = await within(page).findByLabelText('방송 링크')
    expect(within(page).queryByLabelText('방송 제목')).toBeNull()
    expect(within(page).queryByRole('button', { name: '확인' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '주소 없이 시작' })).toBeNull()
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '확인' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 다육이 방송$/)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40' })
  })

  it('링크를 이으면 방송 화면 전에 라벨 단계로 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고")', async () => {
    const world = linkableWorld()
    const nav = { ...newNav(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    fireEvent.change(await within(page).findByLabelText('방송 링크'), { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '확인' }))
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('라벨 단계에서 뒤로 와도 링크를 다시 이을 수 있다: 같은 링크는 다시 보내지 않고 다음으로, 다른 링크면 먼저 끊고 잇는다 (D-UX3-19 고침)', async () => {
    const world = linkableWorld()
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube\/unlink$/, () => ({ body: {} }))
    const nav = { ...newNav(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    const address = await within(page).findByLabelText('방송 링크')
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '확인' }))
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(1))
    // 뒤로 와서 같은 링크로 [확인] — 방송을 또 만들지 않고, 잇기 요청도 다시 보내지 않는다
    fireEvent.click(within(page).getByRole('button', { name: '확인' }))
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(2))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)).toHaveLength(1)
    // 다른 링크로 바꾸면 먼저 이은 것을 끊고 새 링크를 잇는다
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' } })
    fireEvent.click(within(page).getByRole('button', { name: '확인' }))
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledTimes(3))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube\/unlink$/)).toHaveLength(1)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/).map((call) => (call.body as { video: string }).video)).toEqual(['https://www.youtube.com/watch?v=tWnNGwvdN40', 'https://www.youtube.com/watch?v=AAAAAAAAAAA'])
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('[링크를 모르겠어요] → 유튜브·틱톡·밴드(정식 앱 아이콘). 유튜브는 앱(없으면 앱 안 브라우저)을 열고, 돌아오면 [붙여넣기] 한 번으로 링크가 들어가고 잠깐 알림이 뜬다 (D-UX3-11)', async () => {
    const world = linkableWorld()
    const opened: string[] = []
    let clipboard = ''
    let reads = 0
    setClipboardReader(async () => {
      reads++
      return clipboard
    })
    // 글이 있는지만 보는 확인(아이폰 hasStrings — 허용 창 없음)
    setClipboardProbe(async () => clipboard !== '')
    setPlatformOpener(async (target) => {
      opened.push(target.key)
      // 앱 안 브라우저에서 내 방송 → 공유 → 링크 복사 → 닫기
      clipboard = 'https://youtube.com/live/LIVENOW0001?si=x'
      return 'browser'
    })
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    const field = (await screen.findByLabelText('방송 링크')) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    const platforms = within(screen.getByRole('group', { name: '방송 플랫폼' })).getAllByRole('button')
    expect(platforms.map((button) => button.getAttribute('aria-label'))).toEqual(['유튜브', '틱톡', '밴드'])
    expect(LIVE_PLATFORMS.map((target) => target.web)).toEqual(['https://m.youtube.com/', 'https://www.tiktok.com/', 'https://band.us/'])
    expect(screen.queryByRole('button', { name: '붙여넣기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '유튜브' }))
    // 돌아와도 클립보드를 저절로 읽지 않는다 — [붙여넣기]만 나타난다
    fireEvent.click(await screen.findByRole('button', { name: '붙여넣기' }))
    // 알림은 약 2초 뒤 사라지므로(POP_NOTE_MS) 누른 바로 뒤에 본다 — 느린 시험 기계에서 지나가 버리지 않게
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('복사한 링크를 넣었어요'))
    expect(field.value).toBe('https://youtube.com/live/LIVENOW0001?si=x')
    expect(reads).toBe(1)
    expect(opened).toEqual(['youtube'])
    // 칸 아래에 계속 남는 문장은 없다
    expect(screen.queryByText('복사해 둔 주소를 넣었어요.')).toBeNull()
    expect(screen.getByRole('button', { name: '확인' })).toBeTruthy()
  })

  // D-UX3-14 (사용자 지시 2026-11-03 "왜 틱톡과 밴드는 링크를 통해 못해? 할 수 있게"): 옛 기대 — 틱톡·밴드는 계정 안내와 [이 방송 만들기],
  // 유튜브를 잇지 않는 서버면 종류를 누르는 대로 방송을 만듦. 새 기대 — 세 플랫폼 모두 앱을 열고 링크로 잇는다, 종류는 늘 링크 단계로.
  it('[링크를 모르겠어요]의 틱톡·밴드도 그 앱을 연다 (D-UX3-14)', async () => {
    const world = linkableWorld()
    const opened: string[] = []
    setPlatformOpener(async (target) => {
      opened.push(target.key)
      return 'app'
    })
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={newNav()} />))
    await screen.findByLabelText('방송 링크')
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '틱톡' }))
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '밴드' }))
    await waitFor(() => expect(opened).toEqual(['tiktok', 'band']))
    expect(screen.queryByText(/가게 계정으로/)).toBeNull()
  })

  it('틱톡 공유 글을 붙여 넣으면 링크만 넣고, [확인]은 종류 제목으로 방송을 만든 뒤 그 링크로 틱톡을 잇는다. 동의 전이면 안내 → [동의하고 잇기]', async () => {
    const world = linkableWorld()
    let tries = 0
    world.server.on('POST', /^\/api\/broadcasts\/b9\/tiktok\/link-url$/, () => {
      tries += 1
      return tries === 1 ? { status: 409, body: { error: { code: 'NO_CONSENT', message: '틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.' } } } : { body: { link: { state: 'LINKED' } } }
    })
    world.server.on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok: { notice: { version: 'TT-BETA-1', title: '틱톡 라이브 연결(베타) 안내', lines: ['안내 첫 줄', '안내 둘째 줄'], checkbox: '안내를 읽었고, 위 내용에 동의해요', button: '켜기' } } } }))
    world.server.on('POST', /^\/api\/tiktok\/consent$/, () => ({ body: { tiktok: {} } }))
    setClipboardProbe(async () => true)
    setClipboardReader(async () => '김다육님의 라이브를 보러 오세요! https://vt.tiktok.com/ZSabc123/ 복사해서 틱톡에서 열어 보세요')
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    const field = (await screen.findByLabelText('방송 링크')) as HTMLInputElement
    fireEvent.click(await screen.findByRole('button', { name: '붙여넣기' }))
    await waitFor(() => expect(field.value).toBe('https://vt.tiktok.com/ZSabc123/'))
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('· 안내 첫 줄')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '안내를 읽었고, 위 내용에 동의해요' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /^\/api\/tiktok\/consent$/)[0]?.body).toMatchObject({ on: true, version: 'TT-BETA-1' })
    const links = world.server.callsTo('POST', /tiktok\/link-url$/)
    expect(links.map((call) => call.body?.url)).toEqual(['https://vt.tiktok.com/ZSabc123/', 'https://vt.tiktok.com/ZSabc123/'])
    // 방송은 한 번만, 유튜브로는 보내지 않는다
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/ 화분 방송$/)
    expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(0)
  })

  it('D-UX3-17 다른 방송에 틱톡이 이어져 있으면 옮길지 묻고, [옮기기]면 move로 다시 보내 잇는다', async () => {
    const world = linkableWorld()
    let tries = 0
    world.server.on('POST', /^\/api\/broadcasts\/b9\/tiktok\/link-url$/, () => {
      tries += 1
      return tries === 1 ? { status: 409, body: { error: { code: 'TIKTOK_ELSEWHERE', message: '다른 방송에 틱톡이 이어져 있어요. 이 방송으로 옮길까요?' } } } : { body: { link: { state: 'LINKED' } } }
    })
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    const field = (await screen.findByLabelText('방송 링크')) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'https://www.tiktok.com/@shop_two/live' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('다른 방송에 틱톡이 이어져 있어요. 이 방송으로 옮길까요?')).toBeTruthy()
    expect(nav.openConsole).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '옮기기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    const links = world.server.callsTo('POST', /tiktok\/link-url$/)
    expect(links.map((call) => call.body?.move)).toEqual([undefined, true])
    expect(links[1]?.body?.url).toBe('https://www.tiktok.com/@shop_two/live')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(1)
  })

  it('밴드 링크는 [확인]하면 내 밴드 글을 보이고, 고른 글로 잇는다 (밴드 공식 방법은 링크로 글을 찾지 못한다)', async () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/band$/, () => ({ body: { band: { status: 'CONNECTED', message: null } } }))
    world.server.on('GET', /^\/api\/band\/bands$/, () => ({ body: { bands: [{ bandKey: 'BANDKEY0001', name: '다육 가게', memberCount: 30 }], chosenBand: null, message: null } }))
    world.server.on('GET', /^\/api\/band\/posts/, () => ({ body: { posts: [{ postKey: 'POSTKEY0001', createdAt: '2026-11-03T01:05:00.000Z', firstLine: '오늘 저녁 라이브 찜 받아요', commentCount: 3 }], page: 1, more: false, cursor: null } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/band\/link$/, () => ({ body: { link: {} } }))
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    fireEvent.change(await screen.findByLabelText('방송 링크'), { target: { value: 'https://band.us/band/12345678/post/42' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    fireEvent.click(await screen.findByRole('button', { name: '오늘 저녁 라이브 찜 받아요 · 11/3 10:05 잇기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /band\/link$/)[0]?.body).toMatchObject({ bandKey: 'BANDKEY0001', postKey: 'POSTKEY0001' })
  })

  it('밴드 계정을 잇지 않았으면 서버 문장, 모르는 링크는 "알 수 없는 링크예요."', async () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/band$/, () => ({ body: { band: { status: 'NOT_CONNECTED', message: '설정에서 밴드를 먼저 연결해 주세요.' } } }))
    render(world.wrap(<NewBroadcastAddressScreen category="other" nav={newNav()} />))
    const field = await screen.findByLabelText('방송 링크')
    fireEvent.change(field, { target: { value: 'band.us/band/1/post/2' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('설정에서 밴드를 먼저 연결해 주세요.')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'https://example.com/live/1' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('알 수 없는 링크예요.')).toBeTruthy()
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('유튜브를 주소로 잇지 않는 서버도 종류를 누르면 링크 단계로 (방송은 [확인] 때 만든다)', () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: false }, oauth: true } }))
    const nav = newNav()
    render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    fireEvent.click(screen.getByRole('button', { name: '기타' }))
    expect(nav.openAddress).toHaveBeenCalledWith('other')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('붙여 넣은 글에서 방송 링크 찾기: 유튜브·틱톡(짧은 링크 포함)·밴드, 그 밖은 null', () => {
    expect(liveLinkOf('https://youtu.be/abc')).toEqual({ platform: 'youtube', url: 'https://youtu.be/abc' })
    expect(liveLinkOf('https://www.tiktok.com/@shop/live?x=1')).toEqual({ platform: 'tiktok', url: 'https://www.tiktok.com/@shop/live?x=1' })
    expect(liveLinkOf('라이브 보러 와요 https://vm.tiktok.com/ZS1/.')).toEqual({ platform: 'tiktok', url: 'https://vm.tiktok.com/ZS1/' })
    expect(liveLinkOf('[다육 가게] https://band.us/band/1/post/2')).toEqual({ platform: 'band', url: 'https://band.us/band/1/post/2' })
    expect(liveLinkOf('https://example.com/a')).toBeNull()
    expect(liveLinkOf('그냥 글')).toBeNull()
  })
})

describe('입력 칸 (토스 뜬 라벨, D-UX3-08)', () => {
  it('비어 있고 초점이 없으면 라벨이 칸 안(큰 회색 글자), 누르거나 값이 있으면 위로 작게 — 글자 하나가 움직일 뿐 값 줄 높이는 그대로', () => {
    const world = makeWorld()
    function Box() {
      const [value, setValue] = useState('')
      return <UnderlineField label="방송 링크" value={value} onChangeText={setValue} />
    }
    render(world.wrap(<Box />))
    const input = screen.getByLabelText('방송 링크') as HTMLInputElement
    const state = () => (screen.queryByTestId('field-label-resting') !== null ? 'resting' : screen.queryByTestId('field-label-floating') !== null ? 'floating' : 'none')
    expect(state()).toBe('resting')
    // 라벨은 칸 안 예시 글(placeholder)이 아니라 따로 움직이는 글자 — 칸 안 예시 글은 비어 있다
    expect(input.getAttribute('placeholder')).toBe('')
    fireEvent.focus(input)
    expect(state()).toBe('floating')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(state()).toBe('floating')
    expect(FIELD_ROW).toBe(52)
    expect(FIELD_LABEL_MS).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '방송 링크 지우기' }))
    expect(input.value).toBe('')
    expect(state()).toBe('resting')
  })

  it('잘못일 때는 느낌표와 짧은 문장, 고치기 시작하면 문장이 사라진다 (D-UX3-11)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('POST', /^\/api\/broadcasts$/, () => ({ body: { date: '2026-11-03', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-03', title: 't', rehearsal: false } } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, (call) =>
      call.body?.video === 'https://youtu.be/NOCHAT00001'
        ? { status: 409, body: { error: { code: 'NO_LIVE_CHAT', message: '이 영상에는 실시간 채팅이 없어요. 라이브 방송이 시작됐는지, 채팅이 켜져 있는지 확인해 주세요.' } } }
        : { status: 400, body: { error: { code: 'INVALID_VIDEO_URL', message: '유튜브 영상 주소를 알아볼 수 없어요. 주소를 다시 확인해 주세요.' } } },
    )
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={{ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }} />))
    const field = await screen.findByLabelText('방송 링크')
    fireEvent.change(field, { target: { value: 'https://youtu.be/NOCHAT00001' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('라이브 채팅을 받을 수 없는 방송이에요.')
    expect(alert.querySelector('[aria-hidden="true"]')).not.toBeNull()
    fireEvent.change(field, { target: { value: 'https://youtu.be/NOCHAT0000' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect((await screen.findByRole('alert')).textContent).toBe('알 수 없는 링크예요.')
    expect(shortLinkError({ code: 'YOUTUBE_NOT_PUBLIC', message: '긴 문장' } as never)).toBe('공개 방송만 이을 수 있어요.')
  })

  it('클립보드 글이 유튜브 링크가 아니면 붙여 넣은 뒤 "알 수 없는 링크예요."', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    setClipboardReader(async () => '15 핑크프릴 10')
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={{ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }} />))
    fireEvent.click(await screen.findByRole('button', { name: '붙여넣기' }))
    expect((await screen.findByRole('alert')).textContent).toBe('알 수 없는 링크예요.')
    setClipboardReader(async () => '')
  })

  it('입력 글자는 토스 계좌 입력과 같은 24, 뒤로 화살표는 어느 화면이든 26 하나', () => {
    expect(TYPE.input).toBe(24)
    expect(BACK_ICON).toBe(26)
  })
})

function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}

describe('아이폰 모서리 곡률 (D-UX3-15)', () => {
  it('앱의 모든 둥근 모서리(borderRadius)는 아이폰 연속 곡률(borderCurve continuous)과 함께 쓴다', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []
    })
    const root = join(__dirname, '..')
    const missing: string[] = []
    for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'app'))]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const radii = line.match(/borderRadius:/g)?.length ?? 0
        const curves = line.match(/borderCurve: 'continuous'/g)?.length ?? 0
        if (radii > curves) missing.push(`${file.slice(root.length + 1)}:${String(index + 1)}`)
      })
    }
    expect(missing).toEqual([])
  })
})
