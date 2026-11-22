// D-LINK-ASYNC-01 (사용자 "연결하기 버튼 누르면 딜레이 있는데 … 어차피 다음에 프린터 연결 화면으로 넘어가는데 비동기로 불러오면 안 돼?"):
// 새 라이브의 [연결하기]는 서버 답을 기다리지 않고 프린터 화면을 연다 — 못 이으면 링크 화면이 까닭을 보인다.
// D-RECENT-PREFETCH-01 (사용자 "최근 연결한 채널 불러오는것도 느린데, 그 전 어떤 라이브인가요? 페이지에서 미리 불러오고 있으면 안 돼?"):
// 판매 종류 화면이 최근 연결한 채널 목록을 미리 받아 두고 링크 화면이 그것을 쓴다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { markNewLiveStarted, newLinkSettled, trackNewLink } from '../src/lib/new-link.ts'
import { JoinedLive, RECENT_PREFETCH_MS, prefetchRecentLives } from '../src/screens/console/YoutubeSection.tsx'
import { NewBroadcastAddressScreen, NewBroadcastCategoryScreen } from '../src/screens/NewBroadcastScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const LIVES = /^\/api\/youtube\/live-broadcasts$/

function linkableWorld(link: () => Promise<{ status?: number; body?: unknown }> | { status?: number; body?: unknown } = () => ({ body: { link: null, collector: null } })) {
  const world = makeWorld()
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: null, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', LIVES, () => ({ body: { broadcasts: [{ videoId: 'LIVE0000001', title: '지금 라이브', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_A', channelTitle: '가게A' }], channels: [{ channelId: 'UC_A', channelTitle: '가게A', videoId: 'LIVE0000001', linkedAt: '2026-11-22T10:00:00.000Z' }], tiktok: [] } }))
  world.server.on('POST', /^\/api\/broadcasts$/, (call) => ({ body: { date: '2026-11-23', rehearsal: false, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'b9', date: '2026-11-23', title: String(call.body?.title ?? ''), rehearsal: false } } }))
  world.server.on('POST', /^\/api\/broadcasts\/b9\/youtube$/, link)
  world.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: '오늘의 다육이', channelTitle: '다육이네' } }))
  return world
}

async function pasteAndConnect() {
  const page = screen.getByRole('dialog', { name: '새 라이브' })
  fireEvent.change(await within(page).findByLabelText('라이브 링크'), { target: { value: 'https://www.youtube.com/watch?v=tWnNGwvdN40' } })
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  const confirm = await screen.findByTestId('link-confirm')
  await within(confirm).findByTestId('live-check-title')
  fireEvent.click(within(confirm).getByRole('button', { name: '연결하기' }))
}

describe('새 라이브 [연결하기]는 기다리지 않고 프린터 화면으로 (D-LINK-ASYNC-01)', () => {
  it('서버가 답하기 전에 프린터 화면을 열고, 이으면 잇기 결과가 ok', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const world = linkableWorld(async () => {
      await held
      return { body: { link: null, collector: null } }
    })
    const nav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    // 아직 서버가 답하지 않았다
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b9\/youtube$/)).toHaveLength(1)
    let settled: string | null = null
    void newLinkSettled('b9').then((result) => {
      settled = result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBeNull()
    release()
    await waitFor(() => expect(settled).toBe('ok'))
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('못 이으면(다른 회차에 이어짐) 잇기 결과가 failed이고 링크 화면에 옮길지 묻는 창이 뜬다', async () => {
    const world = linkableWorld(() => ({ status: 409, body: { error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } } }))
    const nav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn(), openLabelSetup: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(await newLinkSettled('b9')).toBe('failed')
    expect(await screen.findByRole('button', { name: '옮기기' })).toBeTruthy()
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('라벨 단계가 없으면(바로 라이브 화면) 옛처럼 이은 뒤에 간다', async () => {
    const world = linkableWorld(() => ({ status: 409, body: { error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } } }))
    const nav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    expect(await screen.findByRole('button', { name: '옮기기' })).toBeTruthy()
    expect(nav.openConsole).not.toHaveBeenCalled()
  })

  it('맡긴 것이 없으면 ok, 같이 보는 라이브에 들어갔으면 joined', async () => {
    expect(await newLinkSettled('none')).toBe('ok')
    trackNewLink('j1', Promise.reject(new JoinedLive({} as ConstructorParameters<typeof JoinedLive>[0])))
    expect(await newLinkSettled('j1')).toBe('joined')
    trackNewLink('f1', Promise.reject(new Error('x')))
    expect(await newLinkSettled('f1')).toBe('failed')
  })
})

// D-DRAFT-02 (사용자 "연결하기 눌렀다가 뒤로 돌아가면 홈 화면에 연결 안 된걸로 나오던데 그건 왜 그런건데? 그래서 유령 연결이 생기는거잖아")
describe('새 라이브를 그만두면 어떻게 나가든 만드는 중에 이은 연결을 끊는다 (D-DRAFT-02)', () => {
  const UNLINK = /^\/api\/broadcasts\/b9\/youtube\/unlink$/
  const labelsNav = () => ({ back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn(), openLabelSetup: vi.fn() })

  it('밀어서 뒤로·뒤로 키처럼 화면이 그냥 사라져도(단추 없이) 끊는다', async () => {
    const world = linkableWorld()
    world.server.on('POST', UNLINK, () => ({ body: {} }))
    const nav = labelsNav()
    const view = render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(await newLinkSettled('b9')).toBe('ok')
    view.unmount()
    await waitFor(() => expect(world.server.callsTo('POST', UNLINK)).toHaveLength(1))
  })

  it('잇는 중에 나가면 잇기가 끝나기를 기다렸다가 끊는다 (D-LINK-ASYNC-01)', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const world = linkableWorld(async () => {
      await held
      return { body: { link: null, collector: null } }
    })
    world.server.on('POST', UNLINK, () => ({ body: {} }))
    const nav = labelsNav()
    const view = render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    view.unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(world.server.callsTo('POST', UNLINK)).toHaveLength(0)
    release()
    await waitFor(() => expect(world.server.callsTo('POST', UNLINK)).toHaveLength(1))
  })

  it('라이브 화면으로 들어간 새 라이브는 끊지 않는다 — 프린터 화면 마침 · 라벨 단계 없이 바로 열기', async () => {
    const world = linkableWorld()
    world.server.on('POST', UNLINK, () => ({ body: {} }))
    const nav = labelsNav()
    const view = render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(await newLinkSettled('b9')).toBe('ok')
    markNewLiveStarted('b9')
    view.unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(world.server.callsTo('POST', UNLINK)).toHaveLength(0)
  })

  it('못 이었으면 끊을 것이 없다', async () => {
    const world = linkableWorld(() => ({ status: 409, body: { error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } } }))
    const nav = labelsNav()
    const view = render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    await pasteAndConnect()
    await waitFor(() => expect(nav.openLabelSetup).toHaveBeenCalledWith('b9'))
    expect(await newLinkSettled('b9')).toBe('failed')
    view.unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(world.server.callsTo('POST', /unlink$/)).toHaveLength(0)
  })
})

describe('최근 연결한 채널을 판매 종류 화면에서 미리 받는다 (D-RECENT-PREFETCH-01)', () => {
  it('판매 종류 화면이 열리면 받기 시작하고, 링크 화면은 다시 묻지 않고 그것을 쓴다', async () => {
    const world = linkableWorld()
    const nav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    const view = render(world.wrap(<NewBroadcastCategoryScreen nav={nav} />))
    await waitFor(() => expect(world.server.callsTo('GET', LIVES)).toHaveLength(1))
    view.unmount()
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    expect((await screen.findAllByTestId('recent-live')).length).toBe(1)
    expect(world.server.callsTo('GET', LIVES)).toHaveLength(1)
  })

  it('미리 받은 지 오래됐으면(1분) 새로 받는다', async () => {
    const world = linkableWorld()
    prefetchRecentLives(Date.now() - RECENT_PREFETCH_MS - 1)
    const nav = { back: vi.fn(), openAddress: vi.fn(), openConsole: vi.fn() }
    render(world.wrap(<NewBroadcastAddressScreen category="succulent" nav={nav} />))
    expect((await screen.findAllByTestId('recent-live')).length).toBe(1)
    expect(world.server.callsTo('GET', LIVES)).toHaveLength(2)
  })
})
