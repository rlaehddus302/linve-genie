// 다른 화면에 갔다 와도 처음부터 다시 그리지 않는다 (D-UX4-77, 판매자 요청 2026-11-10): 기억해 둔 자료로 바로 그리고(불러오는 중 없음),
// 뒤에서 조용히 다시 받아 바뀐 것만 바꾼다. 똑같으면 다시 그리지 않고, 다시 받기가 실패해도 보이던 자료는 그대로, 로그아웃·계정 바뀜이면 모두 지운다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { Text } from 'react-native'
import { describe, expect, it } from 'vitest'
import { cachedCount, clearCached, peekCached, ScreenFocusProvider, setCachedAccount, useCachedGet } from '../src/lib/cached-get.ts'
import { AllBroadcastsScreen } from '../src/screens/BroadcastList.tsx'
import { CustomersScreen } from '../src/screens/CustomersScreen.tsx'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { useRealDays } from '../src/ui/day-pills.tsx'
import { SessionProvider, useSession } from '../src/services.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const LOADING = /불러오는 중/
const homeNav = () => ({ openConsole: () => undefined, openNewBroadcast: () => undefined, openPacking: () => undefined, openLabels: () => undefined, openSettings: () => undefined, openAllBroadcasts: () => undefined })
const ended = (channelName: string) => ({ ...BROADCAST, channelName, ended: true, endedAt: '2026-10-29T12:00:00.000Z' })

describe('화면 자료 기억 (D-UX4-77)', () => {
  it('홈 탭에 다시 오면 기억해 둔 방송 목록이 바로 보이고 "불러오는 중"이 없다 — 뒤에서 다시 받은 바뀐 이름으로 바뀐다', async () => {
    const world = makeWorld()
    let channelName = '저녁채널'
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [ended(channelName)] } }))
    const first = render(world.wrap(<HomeScreen nav={homeNav()} />))
    // 옛 기대: 처음엔 "불러오는 중" 글. 새 기대(D-UX4-83): 글·빙글이 없이 빈 바탕만
    expect(screen.getByTestId('loading-blank')).toBeTruthy()
    expect(screen.queryByText(LOADING)).toBeNull()
    expect(await screen.findByText('저녁채널')).toBeTruthy()
    // 다른 탭으로 감 (탭은 바꿔 끼워 화면이 사라진다)
    first.unmount()
    channelName = '아침채널'
    const before = world.server.callsTo('GET', /^\/api\/broadcasts$/).length
    render(world.wrap(<HomeScreen nav={homeNav()} />))
    // 기다리지 않고 바로: 기억해 둔 것이 보이고 불러오는 중은 없다
    expect(screen.getByText('저녁채널')).toBeTruthy()
    expect(screen.queryByText(LOADING)).toBeNull()
    expect(screen.queryByTestId('loading-blank')).toBeNull()
    // 뒤에서 다시 받은 바뀐 것만 바뀐다
    expect(await screen.findByText('아침채널')).toBeTruthy()
    expect(screen.queryByText('저녁채널')).toBeNull()
    expect(world.server.callsTo('GET', /^\/api\/broadcasts$/).length).toBe(before + 1)
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('고객 탭·방송 모두 보기도 다시 열면 바로 보인다', async () => {
    const world = makeWorld()
    const row = { id: 'cu1', name: '다육맘', platform: 'YOUTUBE', kindLabel: '유튜브', phoneLast4: null, blocked: false, latestDate: '2026-10-29', latestBuyer: 'u1', purchaseDays: 4, purchaseTotal: 152_000, lastPurchase: '2026-10-29', unpaidDays: 0, lastUnpaid: null, cancels: 0, regular: false, caution: false }
    world.server.on('GET', /^\/api\/customers\?/, () => ({ body: { today: '2026-11-01', settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 }, customers: [row], count: 1, more: false, next: null } }))
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [ended('저녁채널')] } }))
    const customers = render(world.wrap(<CustomersScreen />))
    expect(await screen.findByRole('button', { name: /^다육맘/ })).toBeTruthy()
    customers.unmount()
    const list = render(world.wrap(<AllBroadcastsScreen onOpen={() => undefined} onBack={() => undefined} />))
    expect(await screen.findByText('저녁채널')).toBeTruthy()
    list.unmount()
    render(world.wrap(<CustomersScreen />))
    expect(screen.getByRole('button', { name: /^다육맘/ })).toBeTruthy()
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('다시 받은 것이 똑같으면 자료를 바꾸지 않고 화면을 다시 그리지 않는다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/thing$/, () => ({ body: { name: '핑크프릴', price: 10_000 } }))
    let renders = 0
    const seen: unknown[] = []
    let reload: () => Promise<void> = async () => undefined
    function Probe() {
      const view = useCachedGet<{ name: string; price: number }>('/api/thing')
      renders += 1
      reload = view.reload
      useEffect(() => {
        seen.push(view.data)
      }, [view.data])
      return <Text>{view.data === null ? '없음' : `${view.data.name} ${String(view.data.price)}`}</Text>
    }
    render(world.wrap(<Probe />))
    expect(await screen.findByText('핑크프릴 10000')).toBeTruthy()
    const after = renders
    await act(async () => {
      await reload()
    })
    await act(async () => {
      await reload()
    })
    expect(world.server.callsTo('GET', /^\/api\/thing$/)).toHaveLength(3)
    expect(renders).toBe(after)
    expect(seen.filter((item) => item !== null)).toHaveLength(1)
  })

  it('뒤에서 다시 받다가 실패하면 보이던 자료를 그대로 두고 오류를 보이지 않는다 — 보일 것이 없을 때만 오류', async () => {
    const world = makeWorld()
    let fail = false
    world.server.on('GET', /^\/api\/broadcasts$/, () => (fail ? { status: 503, body: { error: { code: 'UNAVAILABLE', message: '잠시 뒤에 다시 해 주세요.' } } } : { body: { broadcasts: [ended('저녁채널')] } }))
    const first = render(world.wrap(<AllBroadcastsScreen onOpen={() => undefined} onBack={() => undefined} />))
    expect(await screen.findByText('저녁채널')).toBeTruthy()
    first.unmount()
    fail = true
    const before = world.server.callsTo('GET', /^\/api\/broadcasts$/).length
    render(world.wrap(<AllBroadcastsScreen onOpen={() => undefined} onBack={() => undefined} />))
    await waitFor(() => expect(world.server.callsTo('GET', /^\/api\/broadcasts$/).length).toBe(before + 1))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('저녁채널')).toBeTruthy()
    expect(screen.queryByText('잠시 뒤에 다시 해 주세요.')).toBeNull()
    // 기억이 없으면(처음) 오류를 보인다
    clearCached()
    const none = makeWorld()
    none.server.on('GET', /^\/api\/broadcasts$/, () => ({ status: 503, body: { error: { code: 'UNAVAILABLE', message: '잠시 뒤에 다시 해 주세요.' } } }))
    render(none.wrap(<AllBroadcastsScreen onOpen={() => undefined} onBack={() => undefined} />))
    expect(await screen.findByText('잠시 뒤에 다시 해 주세요.')).toBeTruthy()
  })

  it('쌓인 화면에서 돌아와 다시 보이면 뒤에서 다시 받는다 (처음 보일 때는 한 번만)', async () => {
    const world = makeWorld()
    let price = 10_000
    world.server.on('GET', /^\/api\/thing$/, () => ({ body: { price } }))
    const listeners: Record<string, (() => void)[]> = { focus: [], blur: [] }
    const navigation = {
      addListener: (event: 'focus' | 'blur', callback: () => void) => {
        listeners[event]?.push(callback)
        return () => undefined
      },
    }
    function Probe() {
      const view = useCachedGet<{ price: number }>('/api/thing')
      return <Text>{view.data === null ? '없음' : String(view.data.price)}</Text>
    }
    render(world.wrap(<ScreenFocusProvider navigation={navigation}><Probe /></ScreenFocusProvider>))
    expect(await screen.findByText('10000')).toBeTruthy()
    act(() => {
      for (const listener of listeners['focus'] ?? []) listener()
    })
    expect(world.server.callsTo('GET', /^\/api\/thing$/)).toHaveLength(1)
    price = 12_000
    act(() => {
      for (const listener of listeners['blur'] ?? []) listener()
      for (const listener of listeners['focus'] ?? []) listener()
    })
    expect(await screen.findByText('12000')).toBeTruthy()
    expect(world.server.callsTo('GET', /^\/api\/thing$/)).toHaveLength(2)
  })

  it('늦게 시작한 다시 받기의 답이 먼저 온 뒤 앞선 요청의 옛 답이 와도 덮지 않는다', async () => {
    const world = makeWorld()
    const answers: ((price: number) => void)[] = []
    world.server.on('GET', /^\/api\/thing$/, () => new Promise((resolve) => answers.push((price) => resolve({ body: { price } }))))
    let reload: () => Promise<void> = async () => undefined
    function Probe() {
      const view = useCachedGet<{ price: number }>('/api/thing')
      reload = view.reload
      return <Text>{view.data === null ? '없음' : String(view.data.price)}</Text>
    }
    render(world.wrap(<Probe />))
    await waitFor(() => expect(answers).toHaveLength(1))
    let second: Promise<void> = Promise.resolve()
    act(() => {
      second = reload()
    })
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => {
      answers[1]?.(2)
      await second
    })
    expect(screen.getByText('2')).toBeTruthy()
    await act(async () => {
      answers[0]?.(1)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('로그아웃하면 기억해 둔 자료를 모두 지운다 — 다른 계정으로 들어와도 앞 계정 자료가 보이지 않는다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller-a', seller: { id: 's1', name: '김다육' } } }))
    world.server.on('POST', /^\/api\/logout$/, () => ({ body: {} }))
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [ended('저녁채널')] } }))
    let logout: () => Promise<void> = async () => undefined
    function Body() {
      const session = useSession()
      logout = session.logout
      const [shown, setShown] = useState(true)
      return session.session.state === 'in' && shown ? (
        <>
          <AllBroadcastsScreen onOpen={() => undefined} onBack={() => setShown(false)} />
          <Text>들어옴</Text>
        </>
      ) : <Text>나감</Text>
    }
    render(world.wrap(<SessionProvider services={world.services}><Body /></SessionProvider>))
    expect(await screen.findByText('저녁채널')).toBeTruthy()
    expect(peekCached('/api/broadcasts')).not.toBeNull()
    await act(async () => {
      await logout()
    })
    expect(await screen.findByText('나감')).toBeTruthy()
    expect(peekCached('/api/broadcasts')).toBeNull()
    expect(cachedCount()).toBe(0)
  })

  it('다른 계정으로 바뀌면 지우고, 같은 계정이면 그대로 둔다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    setCachedAccount('seller-a')
    function Probe() {
      const view = useCachedGet<{ broadcasts: unknown[] }>('/api/broadcasts')
      return <Text>{view.data === null ? '없음' : '있음'}</Text>
    }
    const shown = render(world.wrap(<Probe />))
    expect(await screen.findByText('있음')).toBeTruthy()
    shown.unmount()
    setCachedAccount('seller-a')
    expect(peekCached('/api/broadcasts')).not.toBeNull()
    setCachedAccount('seller-b')
    expect(peekCached('/api/broadcasts')).toBeNull()
  })

  it('로그인이 풀려도(401) 지운다', async () => {
    const world = makeWorld()
    let signedIn = true
    world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller-a', seller: { id: 's1', name: '김다육' } } }))
    world.server.on('GET', /^\/api\/broadcasts$/, () => (signedIn ? { body: { broadcasts: [ended('저녁채널')] } } : { status: 401, body: { error: { code: 'UNAUTHORIZED', message: '다시 로그인해 주세요.' } } }))
    function Body() {
      const session = useSession()
      const [round, setRound] = useState(0)
      const view = useCachedGet<{ broadcasts: unknown[] }>(session.session.state === 'in' ? '/api/broadcasts' : null, round)
      return (
        <>
          <Text>{session.session.state === 'in' ? '들어옴' : '나감'}</Text>
          <Text>{view.data === null ? '없음' : '있음'}</Text>
          <Text role="button" onPress={() => setRound((n) => n + 1)}>다시</Text>
        </>
      )
    }
    render(world.wrap(<SessionProvider services={world.services}><Body /></SessionProvider>))
    expect(await screen.findByText('있음')).toBeTruthy()
    signedIn = false
    fireEvent.click(screen.getByRole('button', { name: '다시' }))
    expect(await screen.findByText('나감')).toBeTruthy()
    expect(peekCached('/api/broadcasts')).toBeNull()
  })
  it('기억해 둔 날짜 목록으로 먼저 그려도, 그 사이 새 방송 날이 생겼으면 새로 받은 목록의 가장 최근 날로 정하고 그 뒤로는 고정한다', async () => {
    const world = makeWorld()
    let days = [{ date: '2026-10-29', rehearsal: false }]
    world.server.on('GET', /^\/api\/days$/, () => ({ body: { days } }))
    function Probe() {
      const { date } = useRealDays()
      return <Text>{date ?? '없음'}</Text>
    }
    const first = render(world.wrap(<Probe />))
    expect(await screen.findByText('2026-10-29')).toBeTruthy()
    first.unmount()
    days = [{ date: '2026-11-02', rehearsal: false }, { date: '2026-10-29', rehearsal: false }]
    render(world.wrap(<Probe />))
    expect(screen.getByText('2026-10-29')).toBeTruthy()
    expect(await screen.findByText('2026-11-02')).toBeTruthy()
  })
})
