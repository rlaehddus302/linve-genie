// 콘솔의 유튜브 (AC-I3-20~27·30~35·38·41·92). 가짜 서버로 콘솔 전체를 그린다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { CollectorView, LinkView, LiveBroadcastItem, OutboxRow, QuotaView, YoutubeConnection, YoutubeNotice } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import type { Navigate } from '../src/lib/router.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, connection, emptyChanges, flush, fullView, outboxRow, product, youtubeNotConfigured, type Reply } from './support.ts'

let server: FakeServer
let rehearsal: boolean
let youtube: YoutubeConnection | null
let link: LinkView
let outbox: OutboxRow[]
let notices: YoutubeNotice[]
let quota: QuotaView
let lives: LiveBroadcastItem[] | 'error'
let sealed: boolean
let ended: boolean
let seq: number
let assigned: string[]
let navigate: Navigate

const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE',
  statusMessage: '채팅을 받는 중',
  reason: null,
  reasonMessage: null,
  mode: 'STREAM',
  lastMessageAt: '2026-10-19T11:31:05.000Z',
  recorded: 1234,
  skippedBeforeLink: 0,
  gap: false,
  gapMessage: null,
  restartable: false,
  ...patch,
})
const linked = (patch: Partial<CollectorView> = {}): LinkView => ({
  link: { videoId: 'VID00000001', channelId: 'UC_ME', linkedAt: '2026-10-19T10:00:00.000Z', chatEnded: false },
  collector: collector(patch),
})

function setup() {
  server
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ rehearsal, ended, endedAt: ended ? '2026-10-19T12:00:00.000Z' : null })] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({
      body: sealed
        ? { ...fullView({ seq, rehearsal, products: [product(1, { status: 'SOLD' })], buyers: [] }), broadcasts: [{ id: 'b1', date: DATE, title: '1부', endedAt: '2026-10-19T12:00:00.000Z', ended: true }], sealed: true, sealedAt: '2026-11-19T15:00:00.000Z' }
        : fullView({
            seq,
            rehearsal,
            broadcasts: [broadcastView({ ended, endedAt: ended ? '2026-10-19T12:00:00.000Z' : null })],
            buyers: [
              { id: 'UC_BAD', kind: 'youtube', current: 'UC_BAD', mergedInto: null, merged: [], display: '나쁜시청자', nameHistory: [], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false },
              { id: 'UC_OLD', kind: 'youtube', current: 'UC_OLD', mergedInto: null, merged: [], display: '옛시청자', nameHistory: [], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: true },
              { id: 'UC_A', kind: 'youtube', current: 'UC_A', mergedInto: null, merged: [], display: '홍길동', nameHistory: [], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false },
            ],
          }),
    }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({
      body: sealed ? { date: DATE, rehearsal: false, seq, messages: [], more: false, sealed: true, sealedMessage: '30일이 지나 채팅 내용을 지웠어요.' } : { date: DATE, rehearsal, seq, messages: [], more: false },
    }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply =>
      sealed ? apiError(410, 'RESYNC_REQUIRED', '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.') : { body: emptyChanges(Number(match[1]), seq) },
    )
    .on('GET', /^\/api\/broadcasts\/b1\/rehearsal\/generator$/, () => ({ body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } } }))
    .on('GET', /^\/api\/youtube\/connection$/, (): Reply => (youtube === null ? youtubeNotConfigured : { body: { connection: youtube } }))
    .on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: link }))
    .on('GET', /^\/api\/youtube\/live-broadcasts$/, (): Reply => (lives === 'error' ? apiError(502, 'YOUTUBE_UNAVAILABLE', '유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.') : { body: { broadcasts: lives } }))
    .on('POST', /^\/api\/youtube\/parse-video$/, (call): Reply => {
      const video = String(call.body?.video ?? '')
      const m = /(?:v=|youtu\.be\/|live\/|video\/)?([A-Za-z0-9_-]{11})(?:[?&/].*)?$/.exec(video)
      return m === null || video.includes('잘못') ? apiError(400, 'INVALID_VIDEO_URL', '유튜브 방송 주소를 확인해 주세요.', [{ field: 'video', message: '유튜브 방송 주소를 확인해 주세요.' }]) : { body: { videoId: m[1] } }
    })
    .on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call): Reply => {
      if (call.body?.video === 'OTHERCHANNEL') return apiError(409, 'NOT_MY_CHANNEL', '내 채널의 방송만 연결할 수 있어요.')
      link = linked({ status: 'STARTING', statusMessage: '시작하는 중', reason: 'NOT_STARTED', reasonMessage: '유튜브 방송이 시작되면 채팅을 받아요.', recorded: 0, lastMessageAt: null })
      return { body: link }
    })
    .on('POST', /^\/api\/broadcasts\/b1\/youtube\/unlink$/, () => {
      link = { link: null, collector: null }
      return { body: link }
    })
    .on('POST', /^\/api\/broadcasts\/b1\/youtube\/collector\/restart$/, () => {
      link = linked()
      return { body: link }
    })
    .on('GET', new RegExp(`^/api/days/${DATE}/outbox$`), () => ({ body: { date: DATE, rehearsal: false, rows: outbox } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/youtube-notices$`), () => ({ body: { date: DATE, notices } }))
    .on('GET', /^\/api\/youtube\/quota$/, () => ({ body: { quota } }))
    .on('POST', /^\/api\/outbox\/(\d+)\/resend$/, (_call, match): Reply => {
      const id = Number(match[1])
      if (id === 7) return { status: 409, body: { error: { code: 'NO_PERMISSION', message: '게시 권한이 없어요.' }, authorizeUrl: 'http://127.0.0.1:4100/o/oauth2/v2/auth?state=p' } }
      if (id === 8) return apiError(409, 'NOT_MY_CHANNEL', '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.')
      outbox = outbox.map((row) => (row.id === id ? { ...row, state: 'SENDING', stateMessage: '보내는 중', reason: null, reasonMessage: null, dismissed: false } : row))
      return { body: { row: outbox.find((row) => row.id === id) } }
    })
    .on('POST', /^\/api\/outbox\/(\d+)\/confirm-posted$/, (_call, match) => {
      const id = Number(match[1])
      outbox = outbox.map((row) => (row.id === id ? { ...row, state: 'SENT', stateMessage: '게시됨', reason: null, reasonMessage: null, confirmedBySeller: true } : row))
      return { body: { rows: outbox.filter((row) => row.id === id) } }
    })
    .on('POST', /^\/api\/outbox\/(\d+)\/dismiss$/, (_call, match) => {
      const id = Number(match[1])
      outbox = outbox.map((row) => (row.id === id ? { ...row, dismissed: true, dismissedAt: '2026-10-19T12:00:00.000Z' } : row))
      return { body: { row: outbox.find((row) => row.id === id) } }
    })
    .on('POST', /^\/api\/events/, () => ({ body: { date: DATE, rehearsal: false, seq: ++seq, type: 'x', changed: true, effects: [] } }))
}

beforeEach(() => {
  server = new FakeServer()
  rehearsal = false
  youtube = connection({ permissions: { read: true, publish: true }, consent: { liveChat: { enabled: true, at: '2026-10-19T09:00:00.000Z' }, videoComment: { enabled: false, at: null } } })
  link = { link: null, collector: null }
  outbox = []
  notices = []
  quota = { day: '2026-10-19', used: 100, remaining: 9900, budget: 10000, resetsAt: '2026-10-20T07:00:00.000Z', mode: 'NORMAL' }
  lives = []
  sealed = false
  ended = false
  seq = 1
  assigned = []
  navigate = vi.fn()
  setTopLevelNavigation((url) => assigned.push(url))
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
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return quick
}

const panel = () => screen.getByRole('region', { name: '유튜브' })
const alerts = () => screen.getByRole('region', { name: '알림' })
const ytCalls = () => server.calls.filter((call) => /youtube|outbox/.test(call.path))

describe('유튜브 칸이 보이는 때 (AC-I3-20, AC-I3-96)', () => {
  it('준비 안 된 서버: 한 줄뿐, 다른 유튜브 요청·"감사 실패" 없음', async () => {
    youtube = null
    await openConsole()
    expect(within(panel()).getByText('유튜브 연동을 준비하지 않은 서버예요.')).toBeDefined()
    expect(within(panel()).queryAllByRole('button').map((button) => button.textContent)).toEqual([])
    expect(ytCalls().map((call) => call.path)).toEqual(['/api/youtube/connection'])
    expect(within(alerts()).getByText('알림 없음')).toBeDefined()
  })

  it('리허설 방송: 잇지 않는다는 안내, 유튜브 요청을 보내지 않는다, 감사 메시지 목록은 비어 있고 안내', async () => {
    rehearsal = true
    await openConsole()
    expect(within(panel()).getByText('리허설 방송은 유튜브와 잇지 않아요. 가짜 채팅으로 연습해요.')).toBeDefined()
    fireEvent.click(within(panel()).getByRole('button', { name: '감사 메시지' }))
    expect(within(screen.getByRole('dialog', { name: '감사 메시지' })).getByText('리허설 감사 메시지는 유튜브에 올리지 않아요.')).toBeDefined()
    await flush()
    expect(ytCalls()).toEqual([])
  })

  it('연결 안 됨·다시 연결 필요: 설정 유튜브 칸으로 가는 링크', async () => {
    youtube = connection({ status: 'NOT_CONNECTED', channel: null })
    await openConsole()
    expect(within(panel()).getByText(/유튜브 채널을 먼저 연결해 주세요\./)).toBeDefined()
    const go = within(panel()).getByRole('link', { name: '유튜브 연결하러 가기' })
    expect(go.getAttribute('href')).toBe('/settings/youtube')
    fireEvent.click(go)
    expect(navigate).toHaveBeenCalledWith({ name: 'settings', section: 'youtube' })
    cleanup()
    youtube = connection({ status: 'RECONNECT_NEEDED' })
    await openConsole()
    expect(within(panel()).getByText(/유튜브 연결을 다시 해 주세요\./)).toBeDefined()
  })
})

describe('방송 잇기 (AC-I3-21~23)', () => {
  it('내 라이브 목록: 방송 중·예정(KST)·다른 회차에 이은 방송은 고를 수 없음 → 이 방송에 잇기(요청 번호)', async () => {
    lives = [
      { videoId: 'LIVE0000001', title: '<img src=x onerror=alert(1)>오늘 라이브', status: 'LIVE', scheduledStartTime: null, actualStartTime: '2026-10-19T10:00:00.000Z', linkedBroadcast: null },
      { videoId: 'SOON0000001', title: '내일 방송', status: 'UPCOMING', scheduledStartTime: '2026-10-25T11:00:00.000Z', actualStartTime: null, linkedBroadcast: null },
      { videoId: 'USED0000001', title: '다른 회차', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: 'b9' },
    ]
    await openConsole()
    fireEvent.click(within(panel()).getByRole('button', { name: '내 라이브 목록에서 고르기' }))
    const live = await within(panel()).findByRole('radio', { name: /오늘 라이브/ })
    expect(document.querySelector('img')).toBeNull()
    expect(within(panel()).getByText(/<img src=x onerror=alert\(1\)>오늘 라이브/)).toBeDefined()
    expect(within(panel()).getByText(/예정 10월 25일 오후 8:00/)).toBeDefined()
    expect((within(panel()).getByRole('radio', { name: /다른 회차/ }) as HTMLInputElement).disabled).toBe(true)
    expect(within(panel()).getByText(/다른 방송에 이어져 있어요/)).toBeDefined()
    fireEvent.click(live)
    fireEvent.click(within(panel()).getAllByRole('button', { name: '이 방송에 잇기' })[0] as HTMLElement)
    expect(await within(panel()).findByText('유튜브 방송이 시작되면 채팅을 받아요.', { exact: false })).toBeDefined()
    const posts = server.callsTo('POST', /^\/api\/broadcasts\/b1\/youtube$/)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({ video: 'LIVE0000001' })
    expect(String(posts[0]?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('빈 목록·유튜브 오류(502)는 서버 문장과 "다시 불러오기"', async () => {
    await openConsole()
    fireEvent.click(within(panel()).getByRole('button', { name: '내 라이브 목록에서 고르기' }))
    expect(await within(panel()).findByText('진행 중이거나 예정인 라이브가 없어요. 유튜브 스튜디오에서 라이브를 먼저 만들어 주세요.')).toBeDefined()
    lives = 'error'
    fireEvent.click(within(panel()).getByRole('button', { name: '내 라이브 목록에서 고르기' }))
    expect(await within(panel()).findByText('유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeDefined()
    expect(within(panel()).getByRole('button', { name: '다시 불러오기' })).toBeDefined()
  })

  it('주소 붙여넣기: Enter로 바로 확인 — 틀리면 칸 옆 문장·잇기 잠김, 맞으면 읽은 영상 ID·잇기 열림, 서버 오류 문장 그대로', async () => {
    await openConsole()
    const field = within(panel()).getByLabelText('주소 붙여넣기')
    const linkButton = () => within(panel()).getAllByRole('button', { name: '이 방송에 잇기' }).at(-1) as HTMLButtonElement
    expect(linkButton().disabled).toBe(true)
    fireEvent.change(field, { target: { value: '잘못된 주소' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await within(panel()).findByText('유튜브 방송 주소를 확인해 주세요.')).toBeDefined()
    expect(linkButton().disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'https://youtu.be/ABCDEFGHIJK' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await within(panel()).findByText('읽은 영상: ABCDEFGHIJK')).toBeDefined()
    expect(linkButton().disabled).toBe(false)
    expect(server.callsTo('POST', /parse-video/).map((call) => call.body)).toEqual([{ video: '잘못된 주소' }, { video: 'https://youtu.be/ABCDEFGHIJK' }])
    // 남의 채널: 서버 문장 그대로, 다시 고를 수 있다
    server.on('POST', /^\/api\/youtube\/parse-video$/, () => ({ body: { videoId: 'OTHERCHANNEL' } }))
    fireEvent.change(field, { target: { value: 'OTHER' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await within(panel()).findByText('읽은 영상: OTHERCHANNEL')
    fireEvent.click(linkButton())
    expect(await within(panel()).findByText('내 채널의 방송만 연결할 수 있어요.')).toBeDefined()
    expect(within(panel()).getByLabelText('주소 붙여넣기')).toBeDefined()
  })

  it('응답을 받지 못하면 같은 요청 번호로 다시 보낸다 — 잇기는 한 번', async () => {
    let first = true
    const real = server.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : ''
      if (path === '/api/broadcasts/b1/youtube' && init?.method === 'POST' && first) {
        first = false
        await real(input, init)
        throw new TypeError('Failed to fetch')
      }
      return real(input, init)
    })
    lives = [{ videoId: 'LIVE0000001', title: '오늘 라이브', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null }]
    await openConsole()
    fireEvent.click(within(panel()).getByRole('button', { name: '내 라이브 목록에서 고르기' }))
    fireEvent.click(await within(panel()).findByRole('radio', { name: /오늘 라이브/ }))
    fireEvent.click(within(panel()).getAllByRole('button', { name: '이 방송에 잇기' })[0] as HTMLElement)
    expect(await within(panel()).findByText(/받은 채팅 0개/, {}, { timeout: 4000 })).toBeDefined()
    const posts = server.callsTo('POST', /^\/api\/broadcasts\/b1\/youtube$/)
    expect(posts).toHaveLength(2)
    expect(posts[0]?.body?.requestId).toBe(posts[1]?.body?.requestId)
  })

  it('잇기 해제: 확인 창(처음 포커스 "그대로 두기") → 끊으면 다시 이을 수 있다', async () => {
    link = linked()
    const quick = await openConsole()
    fireEvent.click(within(panel()).getByRole('button', { name: '유튜브 방송 연결 끊기' }))
    const dialog = screen.getByRole('dialog', { name: '유튜브 방송 연결 끊기' })
    expect(within(dialog).getByText('끊으면 이 방송의 채팅을 더 받지 않아요. 이미 받은 찜은 그대로예요.')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('그대로 두기')
    fireEvent.click(within(dialog).getByRole('button', { name: '그대로 두기' }))
    expect(server.callsTo('POST', /unlink/)).toHaveLength(0)
    await waitFor(() => expect(document.activeElement).toBe(quick))
    fireEvent.click(within(panel()).getByRole('button', { name: '유튜브 방송 연결 끊기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '연결 끊기' }))
    expect(await within(panel()).findByRole('button', { name: '내 라이브 목록에서 고르기' })).toBeDefined()
    expect(server.callsTo('POST', /unlink/)).toHaveLength(1)
  })

  it('끝난 방송: 이은 방송과 수집 상태만 — 잇기·해제·다시 받기 버튼 없음', async () => {
    ended = true
    link = linked({ status: 'STOPPED', reason: 'CHAT_DISABLED', statusMessage: '채팅이 꺼져 있어요.', reasonMessage: '채팅이 꺼져 있어요.', restartable: true })
    await openConsole()
    expect(within(panel()).getByText('채팅이 꺼져 있어요.')).toBeDefined()
    expect(within(panel()).queryByRole('button', { name: /연결 끊기|다시 받기|잇기/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('수집 상태·멈춤 경고 (AC-I3-24·25)', () => {
  it('서버 문장·받은 수·마지막 채팅(KST)·잇기 전 채팅·끊긴 동안 — 받는 방식은 보이지 않는다, 알림으로 바뀐다', async () => {
    link = linked({ skippedBeforeLink: 3, gap: true, gapMessage: '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.' })
    await openConsole()
    const box = within(panel()).getByRole('group', { name: '채팅 수집' })
    expect(within(box).getByText('채팅을 받는 중')).toBeDefined()
    expect(within(box).getByText('받은 채팅 1,234개')).toBeDefined()
    expect(within(box).getByText('마지막 채팅 오후 8:31:05')).toBeDefined()
    expect(within(box).getByText('잇기 전에 올라온 채팅 3개는 받지 않았어요.')).toBeDefined()
    expect(within(box).getByText('끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.')).toBeDefined()
    expect(panel().textContent).not.toMatch(/STREAM|POLL|LIVE/)
    act(() => FakeEventSource.last.emit('youtube', { kind: 'collector', broadcast: 'b1', date: DATE, collector: collector({ status: 'CHAT_ENDED', statusMessage: '유튜브 채팅이 끝났어요.' }) }))
    expect(within(panel()).getByText('유튜브 채팅이 끝났어요.')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('멈춤(다시 연결 필요): 고정 영역에 경고 한 줄 + "다시 연결하기", 받는 중이 되면 사라진다, 포커스를 빼앗지 않는다', async () => {
    link = linked()
    const quick = await openConsole()
    expect(screen.queryByRole('alert')).toBeNull()
    act(() =>
      FakeEventSource.last.emit('youtube', {
        kind: 'collector',
        broadcast: 'b1',
        date: DATE,
        collector: collector({ status: 'STOPPED', statusMessage: '유튜브 연결을 다시 해 주세요.', reason: 'RECONNECT', reasonMessage: '유튜브 연결을 다시 해 주세요.', restartable: true }),
      }),
    )
    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('유튜브 채팅을 받지 못하고 있어요 — 유튜브 연결을 다시 해 주세요.')
    expect(warning.closest('.console-sticky')).not.toBeNull()
    expect(within(warning).getByRole('link', { name: '다시 연결하기' }).getAttribute('href')).toBe('/settings/youtube')
    expect(within(warning).queryByRole('button', { name: '채팅 다시 받기' })).toBeNull()
    expect(document.activeElement).toBe(quick)
    act(() => FakeEventSource.last.emit('youtube', { kind: 'collector', broadcast: 'b1', date: DATE, collector: collector() }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('멈춤(채팅 꺼짐): "채팅 다시 받기" → 다시 시작, 다시 연결하는 중은 바로 경고하지 않는다, 판매자가 끊음은 경고 없음', async () => {
    link = linked({ status: 'STOPPED', statusMessage: '채팅이 꺼져 있어요.', reason: 'CHAT_DISABLED', reasonMessage: '채팅이 꺼져 있어요.', restartable: true })
    await openConsole()
    const warning = screen.getByRole('alert')
    fireEvent.click(within(warning).getByRole('button', { name: '채팅 다시 받기' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(server.callsTo('POST', /collector\/restart/)).toHaveLength(1)
    act(() => FakeEventSource.last.emit('youtube', { kind: 'collector', broadcast: 'b1', date: DATE, collector: collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중' }) }))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => FakeEventSource.last.emit('youtube', { kind: 'collector', broadcast: 'b1', date: DATE, collector: collector({ status: 'STOPPED', reason: 'UNLINKED', statusMessage: '유튜브 방송 연결을 끊었어요.' }) }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('감사 실패·감사 메시지 목록 (AC-I3-30~35)', () => {
  beforeEach(() => {
    link = linked()
    outbox = [
      outboxRow(1, { state: 'FAILED', reason: 'REJECTED', stateMessage: '보내지 못함', reasonMessage: '유튜브가 받지 않았어요.' }),
      outboxRow(2, { state: 'FAILED', reason: 'UNCONFIRMED', stateMessage: '보내지 못함', reasonMessage: '올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.', groupWith: [3] }),
      outboxRow(3, { state: 'FAILED', reason: 'UNCONFIRMED', stateMessage: '보내지 못함', reasonMessage: '올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.', buyer: 'UC_BAD', groupWith: [2] }),
      outboxRow(4, { state: 'FAILED', reason: 'NO_CONSENT', stateMessage: '보내지 못함', reasonMessage: '자동 게시에 동의하기 전의 감사예요.' }),
      outboxRow(5, { state: 'WAITING', stateMessage: '기다림', reason: 'WINDOW', reasonMessage: '묶어서 보내려고 기다리는 중이에요.' }),
      outboxRow(6, { target: 'VIDEO_COMMENT' }),
    ]
  })

  it('알림 띠는 할 일이 있는 실패만 센다, 목록은 묶음 넷(보냄은 접힘), 영문 상태값 없음, 닫으면 빠른 입력칸', async () => {
    const quick = await openConsole()
    const button = await within(alerts()).findByRole('button', { name: '감사 실패 3' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    expect(within(dialog).getByRole('heading', { name: '확인이 필요한 감사 3' })).toBeDefined()
    expect(within(dialog).getByRole('heading', { name: '자동으로 보내지 않은 감사 1' })).toBeDefined()
    expect(within(dialog).getByRole('heading', { name: '기다리는 중·보내는 중 1' })).toBeDefined()
    expect(within(dialog).getByRole('heading', { name: '보냄 1' })).toBeDefined()
    expect(within(dialog).queryByText('6번', { exact: false })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '펼치기' }))
    expect(within(dialog).getByText('영상 댓글')).toBeDefined()
    expect(within(dialog).getAllByText('같은 메시지 2개')).toHaveLength(2)
    expect(within(dialog).getAllByText('1부', { exact: false }).length).toBeGreaterThan(0)
    expect(dialog.textContent).not.toMatch(/FAILED|UNCONFIRMED|REJECTED|NO_CONSENT|LIVE_CHAT/)
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(document.activeElement).toBe(quick))
  })

  it('다시 보내기(바로, 요청 번호) · 알림에서 빼기(확인 창 없음) — 알림 띠 숫자가 줄어든다', async () => {
    await openConsole()
    fireEvent.click(await within(alerts()).findByRole('button', { name: '감사 실패 3' }))
    const dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    const rejected = within(dialog).getByText('유튜브가 받지 않았어요.', { exact: false }).closest('li') as HTMLElement
    fireEvent.click(within(rejected).getByRole('button', { name: '알림에서 빼기' }))
    expect(await within(alerts()).findByRole('button', { name: '감사 실패 2' })).toBeDefined()
    expect(server.callsTo('POST', /outbox\/1\/dismiss/).map((call) => call.body)).toEqual([{}])
    const moved = within(screen.getByRole('dialog')).getByRole('region', { name: '자동으로 보내지 않은 감사' })
    expect(within(moved).getByText('알림에서 뺌')).toBeDefined()
    fireEvent.click(within(moved).getAllByRole('button', { name: '다시 보내기' })[0] as HTMLElement)
    await waitFor(() => expect(server.callsTo('POST', /outbox\/\d+\/resend/)).toHaveLength(1))
    expect(String(server.callsTo('POST', /outbox\/\d+\/resend/)[0]?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('확인하지 못한 감사: 늘 경고, "다시 보내기"는 확인 창(처음 포커스 "그만두기") · "유튜브에 올라가 있어요"는 게시됨 확인', async () => {
    await openConsole()
    fireEvent.click(await within(alerts()).findByRole('button', { name: '감사 실패 3' }))
    let dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    const row = within(dialog).getAllByText('이미 올라갔을 수 있어요. 유튜브 채팅에서 먼저 확인해 주세요.')[0]?.closest('li') as HTMLElement
    expect(within(row).getByText('올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.', { exact: false })).toBeDefined()
    expect(within(row).queryByRole('button', { name: '알림에서 빼기' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: '다시 보내기' }))
    let confirm = screen.getByRole('dialog', { name: '유튜브에 이 글이 없는 걸 확인했나요?' })
    expect(within(confirm).getByText('이미 있으면 다시 보내지 마세요.')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('그만두기')
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(server.callsTo('POST', /resend/)).toHaveLength(0)
    dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    const again = within(dialog).getAllByText('이미 올라갔을 수 있어요. 유튜브 채팅에서 먼저 확인해 주세요.')[0]?.closest('li') as HTMLElement
    fireEvent.click(within(again).getByRole('button', { name: '유튜브에 올라가 있어요' }))
    confirm = screen.getByRole('dialog', { name: '유튜브에 이 글이 올라가 있는 걸 확인했나요?' })
    expect(document.activeElement?.textContent).toBe('그만두기')
    fireEvent.click(within(confirm).getByRole('button', { name: '올라가 있어요' }))
    await waitFor(() => expect(server.callsTo('POST', /confirm-posted/)).toHaveLength(1))
    expect(String(server.callsTo('POST', /confirm-posted/)[0]?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(await within(alerts()).findByRole('button', { name: '감사 실패 2' })).toBeDefined()
    dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    fireEvent.click(within(dialog).getByRole('button', { name: '펼치기' }))
    expect(within(dialog).getByText('보냄 — 판매자가 확인함', { exact: false })).toBeDefined()
    // 그 확인 창의 "없어요, 다시 보내기"는 보낸다
    const other = within(dialog).getAllByText('이미 올라갔을 수 있어요. 유튜브 채팅에서 먼저 확인해 주세요.')[0]?.closest('li') as HTMLElement
    fireEvent.click(within(other).getByRole('button', { name: '다시 보내기' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '유튜브에 이 글이 없는 걸 확인했나요?' })).getByRole('button', { name: '없어요, 다시 보내기' }))
    await waitFor(() => expect(server.callsTo('POST', /resend/)).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: '감사 메시지' })).toBeDefined()
  })

  it('채널이 다름: 두 문장, 다시 보내기 409면 같은 두 문장 / 글쓰기 권한 없음: 창 → 구글로 가기(최상위 이동)', async () => {
    outbox = [
      outboxRow(8, { state: 'FAILED', reason: 'NOT_MY_CHANNEL', stateMessage: '보내지 못함', reasonMessage: '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.' }),
      outboxRow(7, { state: 'FAILED', reason: 'GAVE_UP', stateMessage: '보내지 못함', reasonMessage: '여러 번 보내지 못했어요.' }),
    ]
    await openConsole()
    fireEvent.click(await within(alerts()).findByRole('button', { name: '감사 실패 2' }))
    const dialog = screen.getByRole('dialog', { name: '감사 메시지' })
    const mine = within(dialog).getByText('그 방송을 이은 유튜브 채널로 다시 연결하면 보낼 수 있어요.').closest('li') as HTMLElement
    fireEvent.click(within(mine).getByRole('button', { name: '다시 보내기' }))
    const error = await within(mine).findByRole('alert')
    expect(within(error).getByText('지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.')).toBeDefined()
    expect(within(error).getByText('그 방송을 이은 유튜브 채널로 다시 연결하면 보낼 수 있어요.')).toBeDefined()
    const gaveUp = within(dialog).getByText('여러 번 보내지 못했어요.', { exact: false }).closest('li') as HTMLElement
    fireEvent.click(within(gaveUp).getByRole('button', { name: '다시 보내기' }))
    const authorize = await screen.findByRole('dialog', { name: '글쓰기 권한 받기' })
    expect(within(authorize).getByText('글쓰기 권한이 없어요. 구글 화면에서 허락한 뒤 다시 보내 주세요.')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(authorize).getByRole('button', { name: '구글로 가기' }))
    expect(assigned).toEqual(['http://127.0.0.1:4100/o/oauth2/v2/auth?state=p'])
  })

  it('실시간: 발송함 알림이 오면 목록·알림 띠를 다시 받는다, Alt+1은 다른 알림이 없으면 감사 메시지 목록', async () => {
    outbox = [outboxRow(4, { state: 'FAILED', reason: 'NO_CONSENT', stateMessage: '보내지 못함' })]
    const quick = await openConsole()
    expect(within(alerts()).getByText('알림 없음')).toBeDefined()
    outbox = [...outbox, outboxRow(9, { state: 'FAILED', reason: 'EXPIRED', stateMessage: '보내지 못함', reasonMessage: '너무 늦어 보내지 않았어요.' })]
    act(() => FakeEventSource.last.emit('youtube', { kind: 'outbox', date: DATE, ids: [9], state: 'FAILED', reason: 'EXPIRED' }))
    expect(await within(alerts()).findByRole('button', { name: '감사 실패 1' })).toBeDefined()
    fireEvent.keyDown(quick, { key: '1', code: 'Digit1', altKey: true })
    expect(screen.getByRole('dialog', { name: '감사 메시지' })).toBeDefined()
  })
})

describe('사용량·시청자 알림 (AC-I3-27·38)', () => {
  it('묶음·멈춤이면 유튜브 칸에 늘, 모드가 바뀌면 한 번 알림(status) — 같은 모드를 다시 알려도 또 띄우지 않는다', async () => {
    link = linked()
    quota = { ...quota, mode: 'BATCH' }
    const quick = await openConsole()
    expect(within(panel()).getByText('유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요')).toBeDefined()
    act(() => FakeEventSource.last.emit('youtube', { kind: 'quota', mode: 'BATCH' }))
    expect(screen.queryByText('유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요', { selector: '.quota-toast' })).toBeNull()
    quota = { ...quota, mode: 'PAUSED' }
    act(() => FakeEventSource.last.emit('youtube', { kind: 'quota', mode: 'PAUSED' }))
    const toast = screen.getByText('오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요. 채팅은 계속 받아요', { selector: '.quota-toast' })
    expect(toast.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(quick)
    quota = { ...quota, mode: 'NORMAL' }
    act(() => FakeEventSource.last.emit('youtube', { kind: 'quota', mode: 'NORMAL' }))
    expect(screen.getByText('유튜브 사용량이 다시 채워져 감사 메시지를 바로 보내요.')).toBeDefined()
  })

  it('시청자 알림 n: 시각·이름(글자로)·서버 문장·주문이었던·취소였던, 차단이면 "라이브지니에서도 차단" → 차단 창, 이미 차단했으면 "차단함"', async () => {
    link = linked()
    notices = [
      { id: 1, kind: 'DELETED', broadcast: 'b1', messageId: 'm1', channel: 'UC_A', nick: '<script>홍</script>', wasOrder: true, wasCancel: false, banType: null, banSeconds: null, at: '2026-10-19T11:31:05.000Z', message: '시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.' },
      { id: 2, kind: 'BANNED', broadcast: 'b1', messageId: null, channel: 'UC_BAD', nick: '나쁜시청자', wasOrder: false, wasCancel: true, banType: 'PERMANENT', banSeconds: null, at: '2026-10-19T11:32:00.000Z', message: '유튜브에서 차단된 시청자예요. 라이브지니에서도 막으려면 차단해 주세요.' },
    ]
    await openConsole()
    const box = within(panel()).getByRole('region', { name: '시청자 알림' })
    expect(within(box).getByRole('heading', { name: '시청자 알림 2' })).toBeDefined()
    expect(within(box).getByText('<script>홍</script>')).toBeDefined()
    expect(document.querySelector('.viewer-notices script')).toBeNull()
    expect(within(box).getByText('주문이었던 메시지예요')).toBeDefined()
    expect(within(box).getByText('취소 메시지였어요')).toBeDefined()
    expect(within(box).getByText('오후 8:31:05')).toBeDefined()
    act(() =>
      FakeEventSource.last.emit('youtube', {
        kind: 'notice',
        date: DATE,
        notice: { id: 3, kind: 'BANNED', broadcast: 'b1', messageId: null, channel: 'UC_OLD', nick: '옛시청자', wasOrder: false, wasCancel: false, banType: 'TEMPORARY', banSeconds: 300, at: '2026-10-19T11:33:00.000Z', message: '유튜브에서 차단된 시청자예요. 라이브지니에서도 막으려면 차단해 주세요.' },
      }),
    )
    expect(within(box).getByRole('heading', { name: '시청자 알림 3' })).toBeDefined()
    expect(within(box).getByText('차단함')).toBeDefined()
    fireEvent.click(within(box).getByRole('button', { name: '라이브지니에서도 차단' }))
    expect(screen.getByRole('dialog', { name: '나쁜시청자 차단' })).toBeDefined()
  })

  it('실시간 연결이 끊겼다 이어지면 유튜브 상태를 다시 받는다 (AC-I3-92)', async () => {
    link = linked()
    await openConsole()
    const stream = FakeEventSource.last
    act(() => stream.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 1 }] }))
    const before = ytCalls().length
    act(() => stream.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: 1 }] }))
    await waitFor(() => expect(ytCalls().length).toBeGreaterThanOrEqual(before + 4))
    const again = ytCalls().slice(before).map((call) => call.path)
    for (const path of ['/api/youtube/connection', '/api/broadcasts/b1/youtube', `/api/days/${DATE}/outbox`, `/api/days/${DATE}/youtube-notices`]) expect(again).toContain(path)
  })
})

describe('봉인한 날짜 (AC-I3-41)', () => {
  it('볼 수만 있다: 안내, 빠른 입력 잠김(요청 없음), 상품 창의 버튼 잠김, 채팅은 서버 문장, 증분 조회 없음', async () => {
    sealed = true
    await openConsole()
    expect(screen.getByText('30일이 지나 봉인한 날짜예요. 볼 수만 있어요.')).toBeDefined()
    const quick = screen.getByLabelText('빠른 입력') as HTMLInputElement
    expect(quick.matches(':disabled')).toBe(true)
    fireEvent.change(quick, { target: { value: '15 핑크 10000' } })
    fireEvent.keyDown(quick, { key: 'Enter' })
    await flush()
    expect(server.callsTo('POST', /^\/api\/events/)).toHaveLength(0)
    expect(screen.getByText('30일이 지나 채팅 내용을 지웠어요.')).toBeDefined()
    expect(screen.queryByRole('button', { name: '방송 끝내기' })).toBeNull()
    fireEvent.click(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /1번/ }))
    const dialog = await screen.findByRole('dialog', { name: '1번 자세히' })
    const enabled = within(dialog).getAllByRole('button').filter((button) => !(button as HTMLButtonElement).matches(':disabled'))
    expect(enabled.map((button) => button.textContent)).toEqual(['닫기'])
    act(() => FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: 5, type: 'x' }))
    await flush()
    expect(server.callsTo('GET', /\/changes\?/)).toHaveLength(0)
  })

  it('연 채 봉인되면(SSE) 전체를 한 번 다시 받아 봉인 화면 — 증분 410을 되풀이하지 않는다', async () => {
    link = linked()
    await openConsole()
    expect(screen.getByLabelText('빠른 입력').matches(':disabled')).toBe(false)
    sealed = true
    act(() => FakeEventSource.last.emit('youtube', { kind: 'sealed', date: DATE }))
    expect(await screen.findByText('30일이 지나 봉인한 날짜예요. 볼 수만 있어요.')).toBeDefined()
    await waitFor(() => expect(screen.getByLabelText('빠른 입력').matches(':disabled')).toBe(true))
    for (let seqNext = 2; seqNext < 6; seqNext++) act(() => FakeEventSource.last.emit('change', { date: DATE, rehearsal: false, seq: seqNext, type: 'x' }))
    await flush(10)
    expect(server.callsTo('GET', /\/changes\?/).length).toBeLessThanOrEqual(1)
  })
})
