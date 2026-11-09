// 서버가 읽는 유튜브 채팅 — 콘솔 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09·11). 가짜 서버로 콘솔 전체를 그린다.
// 연결 응답에 webChat이 있으면 구글 연결 없이 잇기 칸(최근 채널 + 주소 붙여넣기)을 연다. 처음 잇는 채널만 확인 줄, 이은 방송은 늘 "유튜브 방송 · {이름}",
// 막힘·형식 바뀜·운영자 끔은 바로 경고 + 대비 경로, 다시 받으면 유튜브 칸에 한 줄.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { CollectorView, ExtensionView, LinkView, LiveBroadcastItem, YoutubeConnection } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import type { Navigate } from '../src/lib/router.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, connection, emptyChanges, flush, fullView, type Reply } from './support.ts'

const NOT_PUBLIC = '로그인 없이 볼 수 있는 방송만 이을 수 있어요. 공개나 일부공개로 바꿔 주세요.'
const NO_CHAT = '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.'
const OFF = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'
const BLOCKED = '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.'
const FORMAT = '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.'
const RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'

let server: FakeServer
let youtube: YoutubeConnection
let webChat: { on: boolean } | null
let oauth: boolean
let link: LinkView
let recent: LiveBroadcastItem[] | 'off'
let ext: ExtensionView | null
let newTitle: string
let navigate: Navigate

const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE',
  statusMessage: '채팅을 받는 중',
  reason: null,
  reasonMessage: null,
  mode: 'WEB',
  lastMessageAt: '2026-10-19T11:31:05.000Z',
  recorded: 12,
  skippedBeforeLink: 0,
  gap: false,
  gapMessage: null,
  restartable: false,
  ...patch,
})
const webLinked = (title: string | null = '다육이네', patch: Partial<CollectorView> = {}): LinkView => ({
  link: { videoId: 'VIDEOKNOWN1', channelId: 'UC_KNOWN', broadcastChannelId: 'UC_KNOWN', broadcastChannelTitle: title, invited: false, linkedAt: '2026-10-19T10:00:00.000Z', chatEnded: false },
  collector: collector(patch),
})
const item = (videoId: string, patch: Partial<LiveBroadcastItem> = {}): LiveBroadcastItem => ({
  videoId,
  title: '오늘 다육이 경매',
  status: 'LIVE',
  scheduledStartTime: null,
  actualStartTime: '2026-10-19T10:00:00.000Z',
  linkedBroadcast: null,
  channelId: 'UC_KNOWN',
  channelTitle: '다육이네',
  ...patch,
})
const extension = (patch: Partial<ExtensionView> = {}): ExtensionView => ({
  connected: true,
  connectedAt: '2026-10-19T09:00:00.000Z',
  lastUsedAt: null,
  state: 'NONE',
  message: null,
  manual: null,
  broadcasts: [],
  statusAt: null,
  lastChatAt: null,
  dropped: 0,
  ...patch,
})

function setup() {
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem()] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: fullView({ seq: 1, broadcasts: [broadcastView()] }) }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 1, messages: [], more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply => ({ body: emptyChanges(Number(match[1]), 1) }))
    .on('GET', /^\/api\/extension$/, (): Reply => (ext === null ? apiError(404, 'NOT_FOUND', '찾을 수 없어요.') : { body: { extension: ext } }))
    .on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: youtube, webChat, oauth } }))
    .on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: link }))
    .on('GET', /^\/api\/youtube\/live-broadcasts$/, (): Reply => (recent === 'off' ? apiError(409, 'YOUTUBE_WEB_CHAT_OFF', OFF) : { body: { broadcasts: recent } }))
    .on('POST', /^\/api\/youtube\/parse-video$/, (call): Reply => {
      const m = /([A-Za-z0-9_-]{11})$/.exec(String(call.body?.video ?? ''))
      return m === null ? apiError(400, 'INVALID_VIDEO_URL', '유튜브 방송 주소를 확인해 주세요.', [{ field: 'video', message: '유튜브 방송 주소를 확인해 주세요.' }]) : { body: { videoId: m[1] } }
    })
    .on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call): Reply => {
      const video = call.body?.video
      if (video === 'PRIVATE0001') return apiError(409, 'YOUTUBE_NOT_PUBLIC', NOT_PUBLIC)
      if (video === 'NOCHAT00001') return apiError(409, 'NO_LIVE_CHAT', NO_CHAT)
      if (video === 'NEWCHAN0001') {
        // 처음 잇는 채널: 확인 표시(JSON true)가 없으면 잇지 않고 채널 이름을 돌려준다 (D-YT-SRV-03 — 코드는 INV1 그대로, 문장만 다르다)
        if (call.body?.confirmInvited !== true) return { status: 409, body: { error: { code: 'INVITED_CONFIRM_NEEDED', message: '처음 잇는 채널이에요. 이 방송이 맞나요?' }, channel: { id: 'UC_NEW', title: newTitle } } }
        link = { link: { videoId: 'NEWCHAN0001', channelId: 'UC_NEW', broadcastChannelId: 'UC_NEW', broadcastChannelTitle: newTitle, invited: false, linkedAt: '2026-10-19T10:00:00.000Z', chatEnded: false }, collector: collector({ recorded: 0 }) }
        return { body: link }
      }
      link = webLinked()
      return { body: link }
    })
    .on('GET', new RegExp(`^/api/days/${DATE}/outbox$`), () => ({ body: { date: DATE, rehearsal: false, rows: [] } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/youtube-notices$`), () => ({ body: { date: DATE, notices: [] } }))
    .on('GET', /^\/api\/youtube\/quota$/, () => ({ body: { quota: { day: DATE, used: 0, remaining: 10000, budget: 10000, resetsAt: '2026-10-20T07:00:00.000Z', mode: 'NORMAL' } } }))
}

beforeEach(() => {
  server = new FakeServer()
  // 구글 연결 없음 — 서버가 방송 주소만으로 읽는다
  youtube = connection({ status: 'NOT_CONNECTED', channel: null })
  webChat = { on: true }
  oauth = true
  link = { link: null, collector: null }
  recent = []
  ext = null
  newTitle = '처음채널'
  navigate = vi.fn()
  setTopLevelNavigation(() => {})
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={navigate} />)
  await screen.findByRole('region', { name: '상품 보드' })
  await flush(10)
}

const panel = () => screen.getByRole('region', { name: '유튜브' })
const recentCalls = () => server.callsTo('GET', /^\/api\/youtube\/live-broadcasts$/)
const linkPosts = () => server.callsTo('POST', /^\/api\/broadcasts\/b1\/youtube$/)
/** 서버 수집 상태가 바뀐다 — 서버 기록도 같이 바꾸고(화면이 알림 뒤 다시 받는다) 알림을 보낸다 */
const emitCollector = (patch: Partial<CollectorView>) => {
  link = { ...link, collector: collector(patch) }
  act(() => FakeEventSource.last.emit('youtube', { kind: 'collector', broadcast: 'b1', date: DATE, collector: collector(patch) }))
}

async function pasteAndLink(video: string) {
  const field = within(panel()).getByLabelText('주소 붙여넣기')
  fireEvent.change(field, { target: { value: `https://www.youtube.com/watch?v=${video}` } })
  fireEvent.keyDown(field, { key: 'Enter' })
  await within(panel()).findByText(`읽은 영상: ${video}`)
  fireEvent.click(within(panel()).getByRole('button', { name: '이 방송에 잇기' }))
}

describe('구글 연결 없이 잇기 칸 (AC2, D-YT-SRV-03)', () => {
  it('연결 안 됨이어도 잇기 칸이 열린다 — "먼저 연결해 주세요"·"내 라이브 목록"은 없고, 최근 채널 찾기는 칸을 열 때 한 번', async () => {
    recent = [item('LIVENOW0001')]
    await openConsole()
    expect(panel().textContent).not.toContain('유튜브 채널을 먼저 연결해 주세요')
    expect(within(panel()).queryByRole('button', { name: '내 라이브 목록에서 고르기' })).toBeNull()
    expect(within(panel()).getByLabelText('주소 붙여넣기')).toBeDefined()
    const box = within(panel()).getByRole('region', { name: '최근 이은 채널의 라이브' }) // 문구 바뀜 (D-UX4-86)
    expect(within(box).getByText('다육이네 · 오늘 다육이 경매')).toBeDefined()
    expect(box.textContent).toContain('방송 중')
    expect(recentCalls()).toHaveLength(1)
    // 되풀이해 찾지 않는다 — 실시간 알림·시간이 지나도 다시 부르지 않는다
    act(() => FakeEventSource.last.emit('youtube', { kind: 'connection', connection: youtube }))
    await flush(10)
    expect(recentCalls()).toHaveLength(1)
  })

  it('최근 채널의 [잇기]는 확인 줄 없이 그 영상을 잇고 "유튜브 방송 · {채널 이름}"이 늘 보인다, "다시 찾기"만 다시 찾는다', async () => {
    recent = [item('LIVENOW0001'), item('LATER000001', { status: 'UPCOMING', scheduledStartTime: '2026-10-19T12:00:00.000Z', actualStartTime: null, title: '' })]
    await openConsole()
    const box = within(panel()).getByRole('region', { name: '최근 이은 채널의 라이브' }) // 문구 바뀜 (D-UX4-86)
    expect(within(box).getByText('다육이네 · (제목 없음)')).toBeDefined()
    expect(box.textContent).toContain('예정')
    fireEvent.click(within(box).getByRole('button', { name: '다시 찾기' }))
    await waitFor(() => expect(recentCalls()).toHaveLength(2))
    await within(panel()).findByRole('button', { name: '다육이네 · 오늘 다육이 경매 잇기' })
    fireEvent.click(within(panel()).getByRole('button', { name: '다육이네 · 오늘 다육이 경매 잇기' }))
    expect(await within(panel()).findByText('유튜브 라이브 · 다육이네')).toBeDefined() // 문구 바뀜 (D-UX4-86)
    expect(linkPosts()).toHaveLength(1)
    expect(linkPosts()[0]?.body).toMatchObject({ video: 'LIVENOW0001' })
    expect(linkPosts()[0]?.body).not.toHaveProperty('confirmInvited')
    expect(screen.getByRole('group', { name: '채팅 받는 길' }).textContent).toContain('서버 연결로 받는 중')
    expect(panel().textContent).not.toMatch(/WEB|LIVE|STREAM|API/)
  })

  it('다른 회차에 이은 방송은 [잇기]를 누를 수 없고, 찾은 방송이 없으면 붙여넣기 안내', async () => {
    recent = [item('LIVENOW0001', { linkedBroadcast: 'b9' })]
    await openConsole()
    expect((within(panel()).getByRole('button', { name: '다육이네 · 오늘 다육이 경매 잇기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(panel().textContent).toContain('다른 방송에 이어져 있어요')
    cleanup()
    recent = []
    await openConsole()
    expect(within(panel()).getByText('최근 이은 채널에 지금 하는 라이브가 없어요. 라이브 주소를 붙여 넣어 주세요.')).toBeDefined() // 문구 바뀜 (D-UX4-86)
  })

  it('처음 잇는 채널: 확인 줄 [맞아요, 잇기]·[취소] — [취소]면 잇지 않고, [맞아요]면 확인 표시와 새 요청 번호로 잇는다', async () => {
    await openConsole()
    await pasteAndLink('NEWCHAN0001')
    const ask = await within(panel()).findByRole('group', { name: '처음 잇는 채널 확인' })
    expect(ask.textContent).toContain('처음 잇는 채널이에요 (채널: 처음채널). 이 라이브가 맞나요?') // 문구 바뀜 (D-UX4-86)
    expect(panel().textContent).not.toContain('초대받은 방송')
    fireEvent.click(within(ask).getByRole('button', { name: '취소' }))
    expect(within(panel()).queryByRole('group', { name: '처음 잇는 채널 확인' })).toBeNull()
    expect(link.link).toBeNull()
    fireEvent.click(within(panel()).getByRole('button', { name: '이 방송에 잇기' }))
    fireEvent.click(within(await within(panel()).findByRole('group', { name: '처음 잇는 채널 확인' })).getByRole('button', { name: '맞아요, 잇기' }))
    expect(await within(panel()).findByText('유튜브 라이브 · 처음채널')).toBeDefined() // 문구 바뀜 (D-UX4-86)
    const posts = linkPosts()
    expect(posts).toHaveLength(3)
    expect(posts[2]?.body).toMatchObject({ video: 'NEWCHAN0001', confirmInvited: true })
    expect(posts[2]?.body?.requestId).not.toBe(posts[1]?.body?.requestId)
  })

  it('채널 이름은 글자로만 — 확인 줄·콘솔 한 줄 모두 요소가 생기지 않는다, 비면 "(이름 없음)"', async () => {
    newTitle = '<img src=x onerror=alert(1)>'
    await openConsole()
    await pasteAndLink('NEWCHAN0001')
    const ask = await within(panel()).findByRole('group', { name: '처음 잇는 채널 확인' })
    expect(ask.textContent).toContain('(채널: <img src=x onerror=alert(1)>)')
    fireEvent.click(within(ask).getByRole('button', { name: '맞아요, 잇기' }))
    expect(await within(panel()).findByText('유튜브 라이브 · <img src=x onerror=alert(1)>')).toBeDefined() // 문구 바뀜 (D-UX4-86)
    expect(document.querySelector('img[src="x"]')).toBeNull()
    cleanup()
    link = webLinked('   ')
    await openConsole()
    expect(within(panel()).getByText('유튜브 라이브 · (이름 없음)')).toBeDefined() // 문구 바뀜 (D-UX4-86)
  })

  it('비공개·멤버 전용·연령 제한, 채팅을 받을 수 없는 방송은 서버 문장으로 거절', async () => {
    await openConsole()
    await pasteAndLink('PRIVATE0001')
    expect((await within(panel()).findByRole('alert')).textContent).toContain(NOT_PUBLIC)
    await pasteAndLink('NOCHAT00001')
    await waitFor(() => expect(within(panel()).getByRole('alert').textContent).toContain(NO_CHAT))
    expect(link.link).toBeNull()
  })

  it('운영자가 끄면 잇기 칸 대신 안내 한 줄 — 최근 채널을 찾지 않는다', async () => {
    webChat = { on: false }
    await openConsole()
    expect(within(panel()).getByText(OFF)).toBeDefined()
    expect(within(panel()).queryByLabelText('주소 붙여넣기')).toBeNull()
    expect(recentCalls()).toHaveLength(0)
  })

  it('옛 공식 읽기(webChat 없음)는 그대로 — 연결 안 됨이면 연결 안내, 잇기 칸 없음', async () => {
    webChat = null
    await openConsole()
    expect(panel().textContent).toContain('유튜브 채널을 먼저 연결해 주세요.')
    expect(within(panel()).queryByLabelText('주소 붙여넣기')).toBeNull()
    expect(recentCalls()).toHaveLength(0)
  })

  it('구글 연결이 "다시 연결 필요"여도 채팅은 그대로 — 감사 채팅 몫만 알린다', async () => {
    youtube = connection({ status: 'RECONNECT_NEEDED' })
    link = webLinked()
    await openConsole()
    expect(panel().textContent).toContain('감사 채팅을 올리는 구글 연결을 다시 해 주세요. 채팅은 그대로 받아요.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('막힘·형식 바뀜·운영자 끔 (AC5·AC6·AC8, D-YT-SRV-06·07·09)', () => {
  it('막힘은 10초를 기다리지 않고 바로 고정 경고 — 서버 문장 + "댓글 붙여넣기"·"손으로 넣기", 다시 받으면 경고를 내리고 유튜브 칸에 한 줄', async () => {
    link = webLinked()
    await openConsole()
    expect(screen.queryByRole('alert')).toBeNull()
    emitCollector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: BLOCKED })
    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain(BLOCKED)
    expect(warning.closest('.console-sticky')).not.toBeNull()
    expect(within(warning).queryByRole('button', { name: '채팅 다시 받기' })).toBeNull()
    expect(within(warning).queryByRole('link', { name: '다시 연결하기' })).toBeNull()
    const hand = within(warning).getByRole('link', { name: '손으로 넣기' })
    expect(hand.getAttribute('href')).toBe('/sms')
    fireEvent.click(hand)
    expect(navigate).toHaveBeenCalledWith({ name: 'sms' })
    // 확장을 잇지 않은 판매자(휴대폰만)에게는 확장 안내가 없다
    expect(warning.textContent).not.toContain('확장이 대신 받아요')
    fireEvent.click(within(warning).getByRole('button', { name: '댓글 붙여넣기' }))
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    expect(dialog.textContent).toContain("유튜브 채팅 창의 글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요.")
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    emitCollector({ status: 'LIVE' })
    expect(screen.queryByRole('alert')).toBeNull()
    const line = within(panel()).getByText(RESUMED)
    expect(line).toBeDefined()
    fireEvent.click(within(panel()).getByRole('button', { name: '확인했어요' }))
    expect(within(panel()).queryByText(RESUMED)).toBeNull()
  })

  it('형식 바뀜도 바로, 막힌 뒤 연결 오류로 다시 시도하다 받아도 "다시 받고 있어요"', async () => {
    link = webLinked()
    await openConsole()
    emitCollector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'FORMAT', reasonMessage: FORMAT })
    expect(screen.getByRole('alert').textContent).toContain(FORMAT)
    emitCollector({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
    expect(screen.queryByRole('alert')).toBeNull()
    emitCollector({ status: 'LIVE', gap: true, gapMessage: '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.' })
    expect(within(panel()).getByText(RESUMED)).toBeDefined()
    expect(within(panel()).getByText('끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.')).toBeDefined()
  })

  it('처음부터 받는 중이면 "다시 받고 있어요"가 없다 (상태 전환으로만)', async () => {
    link = webLinked()
    await openConsole()
    emitCollector({ status: 'LIVE', recorded: 13 })
    expect(within(panel()).queryByText(RESUMED)).toBeNull()
  })

  it('운영자 끔: 바로 경고, "채팅 다시 받기" 없음 — 확장을 이은 판매자에게는 확장 안내 한 줄', async () => {
    ext = extension()
    link = webLinked('다육이네', { status: 'STOPPED', statusMessage: OFF, reason: 'OPERATOR_OFF', reasonMessage: OFF, restartable: false })
    await openConsole()
    const warning = await screen.findByRole('alert')
    expect(warning.textContent).toContain(OFF)
    expect(warning.textContent).not.toContain('유튜브 채팅을 받지 못하고 있어요 —')
    expect(within(warning).queryByRole('button', { name: '채팅 다시 받기' })).toBeNull()
    expect(warning.textContent).toContain('PC 크롬에서 유튜브 채팅 창을 열어 두면 확장이 대신 받아요.')
  })

  it('확장이 이 방송을 받는 중이면 경고 띠 대신 유튜브 칸에만 — "확장으로 받는 중"과 수집 상태 문장', async () => {
    ext = extension({ state: 'RECEIVING', broadcasts: ['b1'] })
    link = webLinked('다육이네', { status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: BLOCKED })
    await openConsole()
    await waitFor(() => expect(screen.getByRole('group', { name: '채팅 받는 길' }).textContent).toContain('확장으로 받는 중'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(panel()).getByRole('group', { name: '채팅 수집' }).textContent).toContain(BLOCKED)
  })

  it('서버 읽기의 연결 오류는 지금처럼 10초 넘게 이어질 때만 경고 (대비 경로 버튼 포함)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      link = webLinked()
      await openConsole()
      emitCollector({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
      expect(screen.queryByRole('alert')).toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(10_500)
        await flush()
      })
      const warning = screen.getByRole('alert')
      expect(warning.textContent).toContain('유튜브 채팅을 받지 못하고 있어요 — 다시 연결하는 중')
      expect(within(warning).getByRole('button', { name: '댓글 붙여넣기' })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
