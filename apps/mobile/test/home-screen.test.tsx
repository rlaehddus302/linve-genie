// 방송 목록·시작 (APP-01): 진행 중 방송이 한국어 한 줄로 보이고, 새 방송 시작이 요청 번호와 함께 가며, "웹으로 열기"는 기기 브라우저로 연다 (AC4).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setWebOpener } from '../src/lib/open-web.ts'
import { HomeScreen, broadcastLine } from '../src/screens/HomeScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const nav = () => ({ openConsole: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() })

describe('HomeScreen', () => {
  it('방송 한 줄과 콘솔 열기', async () => {
    const world = makeWorld()
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    expect(broadcastLine(BROADCAST)).toBe('저녁 방송 · 10월 29일 · 진행 중')
    const button = await screen.findByRole('button', { name: `콘솔 열기 — ${broadcastLine(BROADCAST)}` })
    fireEvent.click(button)
    expect(navigation.openConsole).toHaveBeenCalledWith('b1')
  })

  it('새 방송 시작 → 제목 칸 → 이 방송 시작하기가 요청 번호와 함께 가고 콘솔로 간다', async () => {
    const world = makeWorld()
    world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-10-30', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b2', date: '2026-10-30', title: String(call.body?.title ?? ''), rehearsal: false } } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    fireEvent.change(screen.getByLabelText('방송 제목 (비워도 돼요)'), { target: { value: '금요일 방송' } })
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('b2'))
    expect(world.server.callsTo('POST', /broadcasts/)[0]?.body).toEqual({ requestId: expect.any(String), title: '금요일 방송' })
  })

  it('"웹으로 열기"는 앱 안이 아니라 기기 브라우저로 그 서버의 웹 주소를 연다 (APP-01 AC4)', async () => {
    const world = makeWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    render(world.wrap(<HomeScreen nav={nav()} sellerName="김다육" />))
    fireEvent.click(await screen.findByRole('button', { name: '정산 — 웹으로 열기' }))
    expect(opened).toEqual(['http://test.local/settlements'])
  })
})
