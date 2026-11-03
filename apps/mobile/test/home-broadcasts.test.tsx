// 홈 '내 방송' (D-UX3-18, 사용자 지시 2026-11-03): 서버 목록(오래된 순)을 뒤집어 최근 것이 위, 돌아갈 방송은 가장 최근의 열린 방송,
// 홈 카드는 최근 4개(플랫폼 아이콘·날짜·지난 시간) + [모두보기], 모두 보기 화면은 날짜마다 흰 카드.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { AllBroadcastsScreen, agoWords, byDate, liveBroadcast } from '../src/screens/BroadcastList.tsx'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const NOW = Date.parse('2026-11-03T05:30:00.000Z')
const item = (id: string, date: string, extra: Partial<BroadcastItem> = {}): BroadcastItem => ({ id, date, title: `${id} 방송`, rehearsal: false, ended: true, endedAt: null, createdAt: null, platforms: [], ...extra })
// 서버 순서 그대로: 날짜 오름차순
const LIST: BroadcastItem[] = [
  item('a', '2026-10-30'),
  item('b', '2026-11-01'),
  item('y', '2026-11-02', { ended: false, platforms: ['youtube'], createdAt: '2026-11-02T10:00:00.000Z' }),
  item('c', '2026-11-03', { createdAt: '2026-11-03T01:00:00.000Z' }),
  item('t', '2026-11-03', { ended: false, platforms: ['tiktok'], createdAt: '2026-11-03T03:30:00.000Z' }),
]
const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn(), openAllBroadcasts: vi.fn() })

describe('내 방송 (D-UX3-18)', () => {
  it('돌아갈 방송은 가장 최근의 열린 방송 — 어제 열어 둔 유튜브가 아니라 오늘 틱톡 (옛 동작은 가장 오래된 열린 방송)', () => {
    expect(liveBroadcast(LIST)?.id).toBe('t')
    expect(liveBroadcast([item('r', '2026-11-03', { ended: false, rehearsal: true }), item('x', '2026-11-01', { ended: false })])?.id).toBe('x')
  })

  it('지난 시간은 짧은 한국어', () => {
    expect(agoWords(null, NOW)).toBeNull()
    expect(agoWords('2026-11-03T05:29:40.000Z', NOW)).toBe('방금 전')
    expect(agoWords('2026-11-03T05:18:00.000Z', NOW)).toBe('12분 전')
    expect(agoWords('2026-11-03T03:30:00.000Z', NOW)).toBe('2시간 전')
    expect(agoWords('2026-11-02T05:00:00.000Z', NOW)).toBe('어제')
    expect(agoWords('2026-10-30T05:00:00.000Z', NOW)).toBe('4일 전')
  })

  it('홈 카드: 최근 4개만, 최근 것이 위, 진행 중 표시, [모두보기]는 쌓인 화면을 연다. 큰 단추는 오늘 틱톡 방송으로', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: LIST } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    const group = await screen.findByRole('group', { name: '내 방송' })
    const rows = within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== '방송 모두 보기')
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-t', 'broadcast-c', 'broadcast-y', 'broadcast-b'])
    expect(rows[0]?.getAttribute('aria-label')).toMatch(/^t 방송 — 11월 3일 · \d+시간 전 · 진행 중$/)
    fireEvent.click(within(group).getByRole('button', { name: '방송 모두 보기' }))
    expect(navigation.openAllBroadcasts).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /^방송으로 돌아가기 — t 방송/ }))
    expect(navigation.openConsole).toHaveBeenCalledWith('t')
  })

  it('모두 보기: 날짜마다 흰 카드(최근 날짜가 위), 누르면 그 방송', async () => {
    expect(byDate(LIST).map((group) => [group.date, group.items.map((one) => one.id)])).toEqual([
      ['2026-11-03', ['t', 'c']],
      ['2026-11-02', ['y']],
      ['2026-11-01', ['b']],
      ['2026-10-30', ['a']],
    ])
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: LIST } }))
    const onOpen = vi.fn()
    render(world.wrap(<AllBroadcastsScreen onOpen={onOpen} onBack={vi.fn()} now={NOW} />))
    const today = await screen.findByRole('group', { name: '11월 3일 화요일' })
    expect(within(today).getAllByRole('button').map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-t', 'broadcast-c'])
    expect(screen.getAllByRole('group').map((one) => one.getAttribute('aria-label'))).toEqual(['11월 3일 화요일', '11월 2일 월요일', '11월 1일 일요일', '10월 30일 금요일'])
    fireEvent.click(within(today).getByRole('button', { name: 't 방송 — 11월 3일 · 2시간 전 · 진행 중' }))
    expect(onOpen).toHaveBeenCalledWith('t')
  })
})
