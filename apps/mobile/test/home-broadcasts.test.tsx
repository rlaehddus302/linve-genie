// D-UX4-130 (사용자 지시 2026-11-12): 홈 섹션 이름 "내 라이브" → "지난 라이브" — 기대 이름만 바꿨다.
// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 홈 '내 방송' (D-UX3-18, 사용자 지시 2026-11-03): 서버 목록(오래된 순)을 뒤집어 최근 것이 위, 돌아갈 방송은 가장 최근의 열린 방송,
// 홈 카드는 최근 4개(플랫폼 아이콘·날짜·지난 시간) + [모두보기], 모두 보기 화면은 날짜마다 흰 카드.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { AllBroadcastsScreen, agoWords, byDate, liveBroadcast, withShared, type SharedLive } from '../src/screens/BroadcastList.tsx'
import { broadcastLength, historyAgo, HomeScreen, pastBroadcasts } from '../src/screens/HomeScreen.tsx'
import { clearCached, FOCUS_SETTLE_MS, ScreenFocusProvider } from '../src/lib/cached-get.ts'
import { SessionProvider } from '../src/services.tsx'
import { makeWorld } from './screen-support.tsx'

const NOW = Date.parse('2026-11-03T05:30:00.000Z')
const item = (id: string, date: string, extra: Partial<BroadcastItem> = {}): BroadcastItem => ({ id, date, title: `${id} 라이브`, rehearsal: false, ended: true, endedAt: null, createdAt: null, platforms: [], ...extra })
// 서버 순서 그대로: 날짜 오름차순
const LIST: BroadcastItem[] = [
  item('a', '2026-10-30'),
  item('b', '2026-11-01'),
  item('y', '2026-11-02', { ended: false, platforms: ['youtube'], createdAt: '2026-11-02T10:00:00.000Z' }),
  item('c', '2026-11-03', { salesTotal: 350000, salesQty: 20, buyerCount: 8, channelName: '보스삼촌', createdAt: '2026-11-03T01:00:00.000Z' }),
  item('t', '2026-11-03', { ended: false, platforms: ['tiktok'], createdAt: '2026-11-03T03:30:00.000Z' }),
]
const nav = () => ({ openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn(), openAllBroadcasts: vi.fn() })

describe('내 라이브 (D-UX3-18)', () => {
  it('돌아갈 라이브는 가장 최근의 열린 라이브 — 어제 열어 둔 유튜브가 아니라 오늘 틱톡 (옛 동작은 가장 오래된 열린 라이브)', () => {
    expect(liveBroadcast(LIST)?.id).toBe('t')
    expect(liveBroadcast([item('r', '2026-11-03', { ended: false, rehearsal: true }), item('x', '2026-11-01', { ended: false })])?.id).toBe('x')
    // 리허설은 앱에서 뺐다 (D-UX3-86): 열린 리허설만 있으면 돌아갈 방송이 없다
    expect(liveBroadcast([item('r', '2026-11-03', { ended: false, rehearsal: true })])).toBeUndefined()
  })

  it('지난 시간은 짧은 한국어', () => {
    expect(agoWords(null, NOW)).toBeNull()
    expect(agoWords('2026-11-03T05:29:40.000Z', NOW)).toBe('방금 전')
    expect(agoWords('2026-11-03T05:18:00.000Z', NOW)).toBe('12분 전')
    expect(agoWords('2026-11-03T03:30:00.000Z', NOW)).toBe('2시간 전')
    expect(agoWords('2026-11-02T05:00:00.000Z', NOW)).toBe('어제')
    expect(agoWords('2026-10-30T05:00:00.000Z', NOW)).toBe('4일 전')
  })

  // D-UX3-85로 바뀐 기대 (사용자 지시 2026-11-09): "내 방송"(진행 중 포함·날짜·진행 중 표시) → "방송 이력"(지난 방송만 — 길이·지난 시간, 오른쪽 ›), 큰 단추 → 맨 위 "지금 라이브 중"
  it('라이브 이력: 지난 라이브만 최근 것이 위, [모두보기]는 쌓인 화면을 연다. 맨 위 "지금 라이브 중"은 오늘 틱톡 라이브로 (D-UX3-85)', async () => {
    // 지난 시간은 그날 기준 — 실제 시계로 돌면 날이 지나 '2일 전'이 된다. 시계만 NOW로 고정(타이머는 그대로)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: LIST } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    // D-UX3-88로 바뀐 기대: 이름 "방송 이력" → "내 방송", [모두보기]는 목록 아래 오른쪽
    const group = await screen.findByRole('group', { name: '지난 라이브' })
    const rows = within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== '라이브 모두 보기')
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-c', 'broadcast-b', 'broadcast-a'])
    // D-UX4-144로 바뀐 기대 (사용자 2026-11-15 "라이브 제목 자체를 '11.13 보스삼촌 라이브' 이렇게"; 옛: '11.3 보스삼촌 — …'):
    expect(rows[0]?.getAttribute('aria-label')).toBe('11.3 보스삼촌 라이브 — 4시간 전 · 총매출 350,000원 · 20개 · 8명')
    expect(rows[0]?.textContent).toContain('11.3 보스삼촌 라이브')
    // 옛 기대: [모두보기]가 늘 있다. 새 기대(D-UX4-81, 사용자 지시 2026-11-10): 홈 4개를 넘쳐 안 보이는 방송이 있을 때만 — 지난 방송 3개라 없다
    expect(within(group).queryByRole('button', { name: '라이브 모두 보기' })).toBeNull()
    // 라이브 확인은 방송 목록을 받은 뒤 한 번 더 그린다 (D-UX3-91)
    fireEvent.click(await screen.findByRole('button', { name: '지금 라이브 중' }))
    expect(navigation.openConsole).toHaveBeenCalledWith('t')
  })

  it('[모두보기]는 지난 라이브가 홈 4개를 넘칠 때만 — 4개면 없고 5개면 4줄 + [모두보기] (D-UX4-81)', async () => {
    const past = (count: number) => Array.from({ length: count }, (_, index) => item(`p${String(index)}`, `2026-10-${String(20 + index)}`))
    for (const [count, shown] of [[4, false], [5, true]] as const) {
      // 화면 자료 기억(D-UX4-77)을 비워 두 번째 그림이 첫 번째 목록으로 먼저 그려지지 않게
      clearCached()
      const world = makeWorld()
      world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: past(count) } }))
      const navigation = nav()
      const view = render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
      const group = await screen.findByRole('group', { name: '지난 라이브' })
      const rows = within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== '라이브 모두 보기')
      expect(rows).toHaveLength(4)
      const all = within(group).queryByRole('button', { name: '라이브 모두 보기' })
      expect(all !== null).toBe(shown)
      if (all !== null) {
        fireEvent.click(all)
        expect(navigation.openAllBroadcasts).toHaveBeenCalledTimes(1)
      }
      view.unmount()
    }
  })

  it('라이브 이력 낱말: 지난 시간 "59분 전 · 23시간 전 · 13일 전 · 4주 전 · 11개월 전 · 2년 전", 라이브 길이 "2:30:30" (D-UX3-85)', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    const MIN = 60_000
    const DAY = 24 * 60 * MIN
    expect(historyAgo(at(59 * MIN), NOW)).toBe('59분 전')
    expect(historyAgo(at(23 * 60 * MIN), NOW)).toBe('23시간 전')
    expect(historyAgo(at(13 * DAY), NOW)).toBe('13일 전')
    expect(historyAgo(at(29 * DAY), NOW)).toBe('4주 전')
    expect(historyAgo(at(340 * DAY), NOW)).toBe('11개월 전')
    expect(historyAgo(at(800 * DAY), NOW)).toBe('2년 전')
    expect(broadcastLength('2026-11-03T01:00:00.000Z', '2026-11-03T03:30:30.000Z')).toBe('2:30:30')
    // D-UX3-88: 한 시간이 안 되면 앞의 "0:"을 뺀다 — 옛 "0:15:43"
    expect(broadcastLength('2026-11-03T01:00:00.000Z', '2026-11-03T01:15:43.000Z')).toBe('15:43')
    expect(broadcastLength('2026-11-03T01:00:00.000Z', '2026-11-03T01:05:03.000Z')).toBe('5:03')
    expect(broadcastLength(null, '2026-11-03T03:30:30.000Z')).toBeNull()
    expect(pastBroadcasts([item('r', '2026-11-03', { rehearsal: true }), item('x', '2026-11-03', { ended: false }), item('o', '2026-11-02')]).map((one) => one.id)).toEqual(['o'])
  })

  // D-UX3-88로 바뀐 기대 (사용자 지시 2026-11-09 "모두보기 눌렀을 때 뜨는 화면의 목록은 예전 버전이야. 홈화면에서 보이는거처럼"): 날짜마다 흰 카드 → 홈 '내 방송'과 같은 줄로 지난 방송 모두
  it('모두 보기: 홈 "지난 라이브"(D-UX4-130 — 옛 "내 라이브")과 같은 줄 — 지난 라이브만 최근 것이 위, 누르면 그 라이브 (D-UX3-88)', async () => {
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
    const group = await screen.findByRole('group', { name: '지난 라이브' })
    expect(within(group).getAllByRole('button').map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-c', 'broadcast-b', 'broadcast-a'])
    fireEvent.click(within(group).getByRole('button', { name: '11.3 보스삼촌 라이브 — 4시간 전 · 총매출 350,000원 · 20개 · 8명' }))   // D-UX4-144
    expect(onOpen).toHaveBeenCalledWith('c')
  })
})

// D-SHARE-LIVE-02 (사용자 2026-11-19 "어제 라이브 아마 세 계정으로 동시에 보고 있었을텐데 그거랑 상관없이 기록 남아야하는거 아니야?"):
// 다른 가게 라이브에 같이 들어갔던 끝난 라이브도 내 지난 라이브에 "같이 봄 · 가게" 꼬리표로 보이고, 누르면 다시 들어가 연다
describe('같이 본 라이브 (D-SHARE-LIVE-02)', () => {
  const shared: SharedLive = { ...item('s', '2026-11-02', { channelName: 'bit_farm', platforms: ['tiktok'], createdAt: '2026-11-02T10:13:00.000Z', endedAt: '2026-11-02T13:20:00.000Z', salesTotal: 442000, salesQty: 45, buyerCount: 15 }), shopName: '비트다육' }

  it('날짜·만든 시각 순으로 끼운다 — 같이 본 것이 없으면 내 목록 그대로', () => {
    const mine = [item('c', '2026-11-03', { createdAt: '2026-11-03T01:00:00.000Z' }), item('y', '2026-11-02', { createdAt: '2026-11-02T08:00:00.000Z' }), item('b', '2026-11-01')]
    expect(withShared(mine, []).map((one) => one.id)).toEqual(['c', 'y', 'b'])
    expect(withShared(mine, [shared]).map((one) => one.id)).toEqual(['c', 's', 'y', 'b'])
    // 이미 내 목록에 있으면(같이 보는 중) 두 번 넣지 않는다
    expect(withShared([...mine, { ...shared }], [shared]).map((one) => one.id)).toEqual(['c', 'y', 'b', 's'])
  })

  it('홈 지난 라이브에 꼬리표와 함께 보이고, 누르면 다시 들어간 뒤 그 라이브를 연다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => {
      vi.useRealTimers()
    })
    clearCached()
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [item('c', '2026-11-03', { createdAt: '2026-11-03T01:00:00.000Z' })] } }))
    world.server.on('GET', /^\/api\/live-join\/past$/, () => ({ body: { lives: [shared] } }))
    world.server.on('POST', /^\/api\/live-join\/reopen$/, () => ({ body: { live: { broadcastId: 's', shopName: '비트다육' } } }))
    const navigation = nav()
    render(world.wrap(<HomeScreen nav={navigation} sellerName="김다육" />))
    const group = await screen.findByRole('group', { name: '지난 라이브' })
    await waitFor(() => expect(within(group).getByTestId('shared-s').textContent).toBe('같이 봄 · 비트다육'))
    const rows = within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== '라이브 모두 보기')
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-c', 'broadcast-s'])
    fireEvent.click(within(group).getByTestId('broadcast-s'))
    await waitFor(() => expect(navigation.openConsole).toHaveBeenCalledWith('s'))
    expect(world.server.callsTo('POST', /^\/api\/live-join\/reopen$/).map((call) => call.body)).toEqual([{ broadcastId: 's' }])
    // 내 라이브는 그대로 바로 연다
    fireEvent.click(within(group).getByTestId('broadcast-c'))
    expect(navigation.openConsole).toHaveBeenCalledWith('c')
    expect(world.server.callsTo('POST', /^\/api\/live-join\/reopen$/)).toHaveLength(1)
  })

  it('옛 서버(같이 본 라이브 주소 없음)면 내 목록만', async () => {
    clearCached()
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [item('c', '2026-11-03')] } }))
    render(world.wrap(<AllBroadcastsScreen onOpen={vi.fn()} onBack={vi.fn()} now={NOW} />))
    const group = await screen.findByRole('group', { name: '지난 라이브' })
    expect(within(group).getAllByRole('button').map((row) => row.getAttribute('data-testid'))).toEqual(['broadcast-c'])
  })

  // D-SHARE-LIVE-03 (사용자 2026-11-20 "저 위에 저렇게 왜 뜨는거야?" — 지난 라이브에서 연 뒤 홈에 "비트다육 라이브를 같이 보고 있어요 [나가기]"가 남음)
  it('지난 라이브에서 연 같이 본 라이브는 보고 돌아오면 저절로 나간다', async () => {
    clearCached()
    const world = makeWorld()
    let live: { broadcastId: string; shopName: string } | null = null
    world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'mine', seller: { id: 's1', name: live === null ? '내 가게' : '비트다육' }, ...(live === null ? {} : { live }) } }))
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [item('c', '2026-11-03', { createdAt: '2026-11-03T01:00:00.000Z' })] } }))
    world.server.on('GET', /^\/api\/live-join\/past$/, () => ({ body: { lives: live === null ? [shared] : [] } }))
    world.server.on('POST', /^\/api\/live-join\/reopen$/, () => {
      live = { broadcastId: 's', shopName: '비트다육' }
      return { body: { live } }
    })
    world.server.on('POST', /^\/api\/live-join\/leave$/, () => {
      live = null
      return { body: { ok: true } }
    })
    const listeners: Record<string, (() => void)[]> = { focus: [], blur: [] }
    const navigation = { addListener: (event: 'focus' | 'blur', callback: () => void) => { listeners[event]?.push(callback); return () => undefined } }
    const nav0 = nav()
    render(world.wrap(<SessionProvider services={world.services}><ScreenFocusProvider navigation={navigation}><HomeScreen nav={nav0} sellerName="김다육" /></ScreenFocusProvider></SessionProvider>))
    fireEvent.click(await screen.findByTestId('broadcast-s'))
    await waitFor(() => expect(nav0.openConsole).toHaveBeenCalledWith('s'))
    expect(await screen.findByTestId('joined-live')).toBeTruthy()
    // 그 라이브 화면에 갔다가 홈으로 돌아온다
    act(() => {
      for (const listener of listeners['blur'] ?? []) listener()
      for (const listener of listeners['focus'] ?? []) listener()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS + 50))
    })
    await waitFor(() => expect(world.server.callsTo('POST', /^\/api\/live-join\/leave$/)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('joined-live')).toBeNull())
  })
})
