// 라이브 연결 정보 화면 (D-UX4-95, 사용자 지시 2026-11-10 "관리화면과 마찬가지로 섹션 없애고 배경 흰색하고, 연결 정보를 나열하자. 플랫폼(아이콘 왼쪽에 배치하기),
// 라이브 제목, 채널명(왼쪽에 채널 프로필 사진). 메뉴에는 라이브로 바로가기(누르면 해당 링크 타고 바로가기)와 라이브 연결 끊기 2개를 배치."):
// 이은 라이브면 흰 바탕 큰 제목 + 줄(묶음·카드 없음) — 플랫폼(아이콘 · 이름) · 라이브 제목 · 채널(사진 · 이름), [라이브로 바로가기] · [라이브 연결 끊기](빨강, 팝업).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectorView, LinkView } from '@livejjim/web/src/api/types.ts'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { broadcastTitle } from '../src/screens/BroadcastList.tsx'
import { END_LINK_BODY, END_LINK_LABEL, END_LINK_QUESTION } from '../src/screens/console/EndBroadcast.tsx'
import { LINK_INFO_ROWS, LINK_INFO_TITLE, LinkInfo, liveWatchUrl } from '../src/screens/console/LinkInfo.tsx'
import type { MobileYoutube } from '../src/screens/console/YoutubeSection.tsx'
import { setWebOpener } from '../src/lib/open-web.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST } from './support.ts'

const AVATAR = 'https://yt3.example/avatar-k.png'
const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, mode: 'WEB', lastMessageAt: null, recorded: 3, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false, ...patch,
})
const linked = (patch: Partial<CollectorView> = {}): LinkView => ({
  link: { videoId: 'VIDEOKNOWN1', channelId: 'UC_K', broadcastChannelId: 'UC_K', broadcastChannelTitle: '다육이네', invited: false, linkedAt: '2026-10-29T10:00:00.000Z', chatEnded: false },
  collector: collector(patch),
})

function linkWorld(options: { link?: LinkView; preview?: 'ok' | 'none' } = {}) {
  const world = makeWorld({ products: [] })
  const state = { link: options.link ?? linked() }
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: state.link }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: [] } }))
  world.server.on('GET', /^\/api\/youtube\/channels\/UC_K\/avatar$/, () => ({ body: { avatar: AVATAR } }))
  world.server.on('POST', /^\/api\/youtube\/preview$/, () => (options.preview === 'none' ? { status: 404, body: { error: { code: 'PREVIEW_UNAVAILABLE', message: '찾을 수 없어요.' } } } : { body: { title: '오늘 저녁 다육이 경매', channelTitle: '다육이네' } }))
  return { world, state }
}

/** a가 b보다 앞(왼쪽)에 그려지는가 — 같은 줄 안에서 문서 순서 = 왼쪽부터 */
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('라이브 연결 정보 (D-UX4-95)', () => {
  afterEach(() => setWebOpener(async () => {}))

  it('흰 바탕 큰 제목 + 줄만: 플랫폼(아이콘 → 유튜브) · 라이브 제목 · 채널(사진 → 이름) — 회색 카드·묶음 이름 없음', async () => {
    const { world } = linkWorld()
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} onEnded={() => {}} />))
    const page = await screen.findByTestId('link-info-page')
    expect(within(page).getByRole('heading', { name: LINK_INFO_TITLE })).toBeTruthy()
    // 흰 바탕 — 유튜브 카드(회색 바탕 묶음)는 없다
    expect(getComputedStyle(page).backgroundColor).toBe('rgb(255, 255, 255)')
    expect(screen.queryByRole('group', { name: '유튜브' })).toBeNull()
    expect(screen.queryByText('유튜브 라이브 · 다육이네')).toBeNull()

    const platform = screen.getByTestId('link-info-platform')
    expect(platform.textContent).toBe(`${LINK_INFO_ROWS.platform}유튜브`)
    const logo = within(platform).getByTestId('link-info-icon')
    expect(logo.children).toHaveLength(1)
    expect(before(logo, within(platform).getByText('유튜브'))).toBe(true)
    // 플랫폼 이름과 라벨 사이에 아이콘 — 라벨은 왼쪽 끝
    expect(before(within(platform).getByText(LINK_INFO_ROWS.platform), logo)).toBe(true)

    await waitFor(() => expect(screen.getByTestId('link-info-title').textContent).toBe(`${LINK_INFO_ROWS.title}오늘 저녁 다육이 경매`))
    expect(world.server.callsTo('POST', /\/api\/youtube\/preview$/).map((call) => call.body)).toEqual([{ video: 'VIDEOKNOWN1' }])

    const channel = screen.getByTestId('link-info-channel')
    expect(channel.textContent).toBe(`${LINK_INFO_ROWS.channel}다육이네`)
    const avatar = within(channel).getByTestId('link-info-avatar')
    expect(before(avatar, within(channel).getByText('다육이네'))).toBe(true)
    // 채널 사진 (홈 "지금 라이브 중"과 같은 경로)
    await waitFor(() => expect(within(channel).getByTestId('link-info-avatar').outerHTML).toContain(AVATAR))

    // D-UX4-107 (사용자 지시 2026-11-10 "채널과 라이브제목 자리 바꾸기"): 옛 순서 플랫폼 · 라이브 제목 · 채널 → 플랫폼 · 채널 · 라이브 제목
    const order = ['link-info-platform', 'link-info-channel', 'link-info-title'].map((id) => screen.getByTestId(id))
    expect(before(order[0]!, order[1]!)).toBe(true)
    expect(before(order[1]!, order[2]!)).toBe(true)
    // 옛 이름 "라이브로 바로가기" → "라이브 바로가기" → "바로가기"(D-MANAGE-01, 2026-11-23), "라이브 제목" → "제목"
    expect(LINK_INFO_ROWS.open).toBe('바로가기')
    expect(LINK_INFO_ROWS.title).toBe('제목')
    // 정보 줄은 누를 수 없다(› 없음), 메뉴는 바로가기 · 연결 끊기 둘
    expect(within(platform).queryByRole('button')).toBeNull()
    expect(within(page).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['뒤로', LINK_INFO_ROWS.open, END_LINK_LABEL])
  })

  it('[라이브 바로가기] → 그 라이브 주소를 기기에서 연다 (유튜브 앱, 없으면 브라우저)', async () => {
    const { world } = linkWorld()
    const opened: string[] = []
    setWebOpener(async (url) => {
      opened.push(url)
    })
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} onEnded={() => {}} />))
    fireEvent.click(within(await screen.findByTestId('link-info-page')).getByRole('button', { name: LINK_INFO_ROWS.open }))
    expect(opened).toEqual([liveWatchUrl('VIDEOKNOWN1')])
    expect(opened[0]).toBe('https://www.youtube.com/watch?v=VIDEOKNOWN1')
  })

  it('[라이브 연결 끊기](빨간 이름) → 가운데 팝업 [취소] · [끊기] → 끝내고 홈으로', async () => {
    const { world } = linkWorld()
    const ended: string[] = []
    world.server.on('POST', /^\/api\/broadcasts\/b1\/end$/, (call) => {
      ended.push(call.path)
      return { body: { seq: world.seq } }
    })
    const onEnded = vi.fn()
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} onEnded={onEnded} />))
    const row = within(await screen.findByTestId('link-info-page')).getByRole('button', { name: END_LINK_LABEL })
    const label = within(row).getByText(END_LINK_LABEL)
    const info = within(screen.getByTestId('link-info-platform')).getByText(LINK_INFO_ROWS.platform)
    expect(getComputedStyle(label).color).not.toBe(getComputedStyle(info).color)
    fireEvent.click(row)
    const popup = await screen.findByRole('alertdialog', { name: END_LINK_QUESTION })
    expect(popup.textContent).toContain(END_LINK_BODY)
    expect(within(popup).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['취소', '끊기'])
    fireEvent.click(within(popup).getByRole('button', { name: '끊기' }))
    await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1))
    expect(ended).toEqual(['/api/broadcasts/b1/end'])
  })

  it('미리 보기를 못 읽으면(끝난 라이브 등) 라이브 제목은 앱의 라이브 이름', async () => {
    const { world } = linkWorld({ preview: 'none' })
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} onEnded={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('link-info-title').textContent).toBe(`${LINK_INFO_ROWS.title}${broadcastTitle(BROADCAST)}`))
  })

  it('끝난 라이브: 정보와 바로가기만 — 연결 끊기·채팅 다시 받기 없음', async () => {
    const { world } = linkWorld({ link: linked({ status: 'CHAT_ENDED', restartable: true }) })
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed onBack={() => {}} onEnded={() => {}} />))
    const page = await screen.findByTestId('link-info-page')
    await waitFor(() => expect(within(page).getByRole('button', { name: LINK_INFO_ROWS.open })).toBeTruthy())
    expect(within(page).queryByRole('button', { name: END_LINK_LABEL })).toBeNull()
    expect(within(page).queryByRole('button', { name: LINK_INFO_ROWS.restart })).toBeNull()
  })

  it('잇지 않은 라이브는 전처럼 링크 넣는 화면 — 연결 끊기도 그대로', async () => {
    const { world } = linkWorld({ link: { link: null, collector: null } })
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} onEnded={() => {}} />))
    expect(await screen.findByRole('textbox', { name: '라이브 링크' })).toBeTruthy()
    expect(screen.queryByTestId('link-info')).toBeNull()
    expect(screen.getByRole('button', { name: END_LINK_LABEL })).toBeTruthy()
  })

  it('LinkInfo 부품만(라이브 화면 판에 넣는 것): 판매자가 아니면(onEnded 없음) 연결 끊기 없음, 멈춘 채팅은 [채팅 다시 받기]', async () => {
    const { world } = linkWorld()
    world.server.on('POST', /^\/api\/broadcasts\/b1\/youtube\/collector\/restart$/, () => ({ body: linked() }))
    const setLink = vi.fn()
    const yt: MobileYoutube = {
      phase: 'ready', webChat: { on: true } as MobileYoutube['webChat'], connection: null, link: linked({ status: 'STOPPED' as CollectorView['status'], restartable: true }), resumed: false, retryingLong: false, broadcastId: 'b1',
      dismissResumed: () => {}, setLink, reloadLink: async () => {}, reload: async () => {},
    }
    render(world.wrap(<LinkInfo broadcastId="b1" yt={yt} closed={false} bleed />))
    const info = screen.getByTestId('link-info')
    expect(within(info).queryByRole('button', { name: END_LINK_LABEL })).toBeNull()
    fireEvent.click(within(info).getByRole('button', { name: LINK_INFO_ROWS.restart }))
    await waitFor(() => expect(setLink).toHaveBeenCalledTimes(1))
  })
})
