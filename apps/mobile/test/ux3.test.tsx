// 앱 화면 다듬기 (D-UX3-01~06, 사용자 지시 2026-11-03 "토스처럼"): 아래 탭 5개와 좌우 밀림 방향, 누르면 바탕이 진해짐,
// 전체 탭 묶음, 새 방송 전체 화면(제목 → 주소 → 만들고 바로 잇기).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { tabEnterSide } from '../src/screens/TabFrame.tsx'
import { PALETTE, TabBar, pressedFill } from '../src/ui/kit/index.ts'
import { makeWorld } from './screen-support.tsx'

const nav = () => ({ openConsole: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })

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

describe('새 방송 전체 화면 (D-UX3-06)', () => {
  const linkableWorld = () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
    world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
    world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-11-03', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-03', title: String(call.body?.title ?? ''), rehearsal: false } } }))
    world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, () => ({ body: { link: null, collector: null } }))
    return world
  }

  it('처음엔 빈 제목 칸만(오늘 날짜 제목은 예시 글), [다음]을 누르면 그 아래 "방송 주소" 칸 — 아직 방송을 만들지 않고 [이 방송에 잇기]도 없다. 주소를 넣으면 단추가 나타나 방송을 만들고 바로 잇는다 (D-UX3-07)', async () => {
    const world = linkableWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '방송 시작하기' }))
    const page = screen.getByRole('dialog', { name: '새 방송' })
    const titleField = within(page).getByLabelText('방송 제목') as HTMLInputElement
    expect(titleField.value).toBe('')
    expect(titleField.getAttribute('placeholder')).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 방송$/)
    expect(within(page).queryByLabelText('방송 주소')).toBeNull()
    fireEvent.change(titleField, { target: { value: '화요일 저녁' } })
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    const address = await within(page).findByLabelText('방송 주소')
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)).toHaveLength(0)
    expect(within(page).queryByRole('button', { name: '이 방송에 잇기' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '주소 없이 시작' })).toBeNull()
    expect((within(page).getByLabelText('방송 제목') as HTMLInputElement).value).toBe('화요일 저녁')
    fireEvent.change(address, { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
    fireEvent.click(within(page).getByRole('button', { name: '이 방송에 잇기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('b9'))
    expect(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body).toEqual({ requestId: expect.any(String), title: '화요일 저녁' })
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)[0]?.body).toEqual({ requestId: expect.any(String), video: 'https://www.youtube.com/watch?v=tWnNGwvdN40' })
  })

  it('제목을 비워 두면 오늘 날짜 제목으로 만든다', async () => {
    const world = linkableWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '방송 시작하기' }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.change(await screen.findByLabelText('방송 주소'), { target: { value: 'https://youtu.be/tWnNGwvdN40' } })
    fireEvent.click(await screen.findByRole('button', { name: '이 방송에 잇기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('b9'))
    expect(String(world.server.callsTo('POST', /^\/api\/broadcasts$/)[0]?.body?.title)).toMatch(/^\d{4}-\d{2}-\d{2} [일월화수목금토]요일 방송$/)
  })
})

function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
