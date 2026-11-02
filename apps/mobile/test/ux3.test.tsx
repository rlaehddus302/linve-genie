// 앱 화면 다듬기 (D-UX3-01~06, 사용자 지시 2026-11-03 "토스처럼"): 아래 탭 5개와 좌우 밀림 방향, 누르면 바탕이 진해짐,
// 전체 탭 묶음, 새 방송 쌓인 화면(판매 종류 → 주소 → 만들고 바로 잇기, D-UX3-09·10), 토스 뜬 라벨 입력 칸(D-UX3-08).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClipboardReader } from '../src/lib/clipboard.ts'
import { LIVE_PLATFORMS, setPlatformOpener } from '../src/lib/open-app.ts'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen, SALE_CATEGORIES, categoryBroadcastTitle } from '../src/screens/NewBroadcastScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { tabEnterSide } from '../src/screens/TabFrame.tsx'
import { BACK_ICON, FIELD_ROW, PALETTE, TabBar, UnderlineField, pressedFill } from '../src/ui/kit/index.ts'
import { TYPE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'

describe('아래 탭 (D-UX3-01)', () => {
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

  it('주소 단계: 주소를 넣기 전엔 [이 방송에 잇기]가 없고, 넣으면 종류 제목으로 방송을 만들고 바로 잇는다', async () => {
    const world = linkableWorld()
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    expect(within(page).getByRole('heading', { name: '방송 주소를 넣어 주세요' })).toBeTruthy()
    const address = await within(page).findByLabelText('방송 주소')
    expect(within(page).queryByLabelText('방송 제목')).toBeNull()
    expect(within(page).queryByRole('button', { name: '이 방송에 잇기' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '주소 없이 시작' })).toBeNull()
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '이 방송에 잇기' }))
    await waitFor(() => expect(nav.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 다육이 방송$/)
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40' })
  })

  it('[방송 주소를 모르겠어요] → 유튜브·틱톡·밴드. 유튜브는 앱(없으면 앱 안 브라우저)을 열고, 돌아오면 복사한 주소가 칸에 들어간다', async () => {
    const world = linkableWorld()
    const opened: string[] = []
    let clipboard = ''
    setClipboardReader(async () => clipboard)
    setPlatformOpener(async (target) => {
      opened.push(target.key)
      // 앱 안 브라우저에서 내 방송 → 공유 → 링크 복사 → 닫기
      clipboard = 'https://youtube.com/live/LIVENOW0001?si=x'
      return 'browser'
    })
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={newNav()} />))
    const field = (await screen.findByLabelText('방송 주소')) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '방송 주소를 모르겠어요' }))
    const platforms = within(screen.getByRole('group', { name: '방송 플랫폼' })).getAllByRole('button')
    expect(platforms.map((button) => button.getAttribute('aria-label'))).toEqual(['유튜브', '틱톡', '밴드'])
    expect(LIVE_PLATFORMS.map((target) => target.web)).toEqual(['https://m.youtube.com/', 'https://www.tiktok.com/', 'https://band.us/'])
    fireEvent.click(screen.getByRole('button', { name: '유튜브' }))
    await waitFor(() => expect(field.value).toBe('https://youtube.com/live/LIVENOW0001?si=x'))
    expect(opened).toEqual(['youtube'])
    expect(screen.getByRole('button', { name: '이 방송에 잇기' })).toBeTruthy()
  })

  it('틱톡·밴드는 주소로 잇지 않는다 — 계정으로 잇는다는 안내와 [이 방송 만들기](앱을 열지 않는다)', async () => {
    const world = linkableWorld()
    const opened: string[] = []
    setPlatformOpener(async (target) => {
      opened.push(target.key)
      return 'app'
    })
    const nav = newNav()
    render(world.wrap(<NewBroadcastAddressScreen category="pot" nav={nav} />))
    await screen.findByLabelText('방송 주소')
    fireEvent.click(screen.getByRole('button', { name: '방송 주소를 모르겠어요' }))
    fireEvent.click(screen.getByRole('button', { name: '틱톡' }))
    expect(screen.getByText(/틱톡 방송은 주소가 아니라 가게 계정으로 이어요/)).toBeTruthy()
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
  it('비어 있고 초점이 없으면 라벨이 칸 안 회색 글자, 누르거나 값이 있으면 위 작은 라벨 — 값 줄 높이는 그대로', () => {
    const world = makeWorld()
    function Box() {
      const [value, setValue] = useState('')
      return <UnderlineField label="방송 주소" value={value} onChangeText={setValue} />
    }
    render(world.wrap(<Box />))
    const input = screen.getByLabelText('방송 주소') as HTMLInputElement
    expect(input.getAttribute('placeholder')).toBe('방송 주소')
    // 위 작은 라벨 자리는 비워 둔 채(높이 그대로) 숨긴다
    const small = () => screen.getByText('방송 주소').closest('[aria-hidden="true"]')
    expect(small()).not.toBeNull()
    fireEvent.focus(input)
    expect(input.getAttribute('placeholder')).toBe('')
    expect(small()).toBeNull()
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(input.getAttribute('placeholder')).toBe('')
    expect(small()).toBeNull()
    // 지우기는 줄 안에 겹쳐 놓는다 — 값을 넣어도 줄 높이가 같다
    expect(FIELD_ROW).toBe(52)
    fireEvent.click(screen.getByRole('button', { name: '방송 주소 지우기' }))
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBe('방송 주소')
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
