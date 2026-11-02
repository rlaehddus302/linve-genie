// 앱 화면 다듬기 (D-UX3-01~06, 사용자 지시 2026-11-03 "토스처럼"): 아래 탭 5개와 좌우 밀림 방향, 누르면 바탕이 진해짐,
// 전체 탭 묶음, 새 방송 쌓인 화면(판매 종류 → 주소 → 만들고 바로 잇기, D-UX3-09·10), 토스 뜬 라벨 입력 칸(D-UX3-08).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { shortLinkError } from '../src/screens/console/YoutubeSection.tsx'
import { LIVE_PLATFORMS, setPlatformOpener } from '../src/lib/open-app.ts'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen, SALE_CATEGORIES, categoryBroadcastTitle } from '../src/screens/NewBroadcastScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { tabEnterSide } from '../src/screens/TabFrame.tsx'
import { BACK_ICON, FIELD_LABEL_MS, FIELD_ROW, PALETTE, TABS, TabBar, UnderlineField, pressedFill } from '../src/ui/kit/index.ts'
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

  it('링크 단계: 링크를 넣기 전엔 [이 방송에 잇기]가 없고, 넣으면 종류 제목으로 방송을 만들고 바로 잇는다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    expect(within(page).getByRole('heading', { name: '방송 링크를 넣어 주세요' })).toBeTruthy()
    const address = await within(page).findByLabelText('방송 링크')
    expect(within(page).queryByLabelText('방송 제목')).toBeNull()
    expect(within(page).queryByRole('button', { name: '이 방송에 잇기' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '주소 없이 시작' })).toBeNull()
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '이 방송에 잇기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 다육이 방송$/)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40' })
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
    await waitFor(() => expect(field.value).toBe('https://youtube.com/live/LIVENOW0001?si=x'))
    expect(reads).toBe(1)
    expect(opened).toEqual(['youtube'])
    expect(screen.getByRole('status').textContent).toBe('복사한 링크를 넣었어요')
    // 칸 아래에 계속 남는 문장은 없다
    expect(screen.queryByText('복사해 둔 주소를 넣었어요.')).toBeNull()
    expect(screen.getByRole('button', { name: '이 방송에 잇기' })).toBeTruthy()
  })

  it('틱톡·밴드는 링크로 잇지 않는다 — 계정으로 잇는다는 안내와 [이 방송 만들기](앱을 열지 않는다)', async () => {
    const world = linkableWorld()
    const opened: string[] = []
    setPlatformOpener(async (target) => {
      opened.push(target.key)
      return 'app'
    })
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    await screen.findByLabelText('방송 링크')
    fireEvent.click(screen.getByRole('button', { name: '링크를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '틱톡' }))
    expect(screen.getByText('틱톡 방송은 링크 대신 가게 계정으로 이어요.')).toBeTruthy()
    expect(opened).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '이 방송 만들기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/ 화분 방송$/)
    expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(0)
  })

  it('유튜브를 주소로 잇지 않는 서버면 종류를 누르는 대로 방송을 만들고 방송 화면으로', async () => {
    const world = linkableWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: false }, oauth: true } }))
    const nav = newNav()
    render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    fireEvent.click(screen.getByRole('button', { name: '기타' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(nav.openAddress).not.toHaveBeenCalled()
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 방송$/)
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
    fireEvent.click(screen.getByRole('button', { name: '이 방송에 잇기' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('라이브 채팅을 받을 수 없는 방송이에요.')
    expect(alert.querySelector('[aria-hidden="true"]')).not.toBeNull()
    fireEvent.change(field, { target: { value: 'https://youtu.be/NOCHAT0000' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '이 방송에 잇기' }))
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
