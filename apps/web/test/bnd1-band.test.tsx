// 네이버 밴드 화면 (BND1 AC-BND1-01·70~78). 가짜 서버로 설정·콘솔의 밴드 칸과 잇기 흐름·알림 띠를 그린다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { BandAccount, BandLinkView, BandNotice, ChatMessage } from '../src/api/types.ts'
import { AlertStrip } from '../src/components/AlertStrip.tsx'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { BAND_ITEM, PrivacyPage } from '../src/components/PolicyPages.tsx'
import {
  BAND_CALLBACK,
  BAND_CALLBACK_UNKNOWN,
  BAND_DISCONNECT_HINT,
  BAND_DISCONNECT_QUESTION,
  BAND_LINK_BUSY,
  BAND_LINK_CONFIRM,
  BAND_NEW_NOTICE,
  BAND_NO_LINK,
  BAND_NO_POSTS,
  BAND_NOT_COMING,
  BAND_RETRY_ALERT_MS,
  BAND_UNLINK_QUESTION,
  bandAccountWords,
  bandCallbackMessage,
  bandEditsMessage,
  bandNotComing,
  bandReadWords,
  bandSeenUpTo,
  bandUnseenEdits,
} from '../src/lib/band.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { MULTI_PLATFORM_NOTICE, PLATFORM_WORD, buyerPlatformWord, chatPlatformTags, platformOfKey } from '../src/lib/platforms.ts'
import { parseRoute, routePath, type Navigate } from '../src/lib/router.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, connection, emptyChanges, flush, fullView, message, type Reply } from './support.ts'

const NOT_CONFIGURED = '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.'
const NOT_CONNECTED = '설정에서 밴드를 먼저 연결해 주세요.'
const RECONNECT = '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.'

const account = (patch: Partial<BandAccount> = {}): BandAccount => ({ status: 'CONNECTED', message: null, profileName: '김다육', connectedAt: '2026-10-26T01:00:00.000Z', chosenBand: null, ...patch })

const noNotices = { items: [], total: 0, seenUpTo: 0, unseen: 0, unseenEdits: 0 }
const skipped = { SELLER: 0, NO_AUTHOR: 0, BAD_COMMENT_KEY: 0, BAD_TIME: 0, NO_TEXT: 0, TEXT_TOO_LONG: 0, DUPLICATE: 0 }

const bandNone = (patch: Partial<BandLinkView> = {}): BandLinkView => ({
  broadcast: 'b1',
  platform: 'BAND',
  state: 'NONE',
  message: null,
  canLink: true,
  blockCode: null,
  blockMessage: null,
  linkedAt: null,
  actor: null,
  post: null,
  lastReadAt: null,
  received: 0,
  baseline: 0,
  baselineMessage: null,
  skipped,
  skipMessages: [],
  failures: 0,
  retryAt: null,
  rateLimited: false,
  finishReason: null,
  notices: noNotices,
  ...patch,
})

const bandReading = (patch: Partial<BandLinkView> = {}): BandLinkView =>
  bandNone({
    state: 'READING',
    message: '밴드 댓글을 읽고 있어요.',
    canLink: false,
    blockCode: 'ALREADY_LINKED',
    blockMessage: '이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요.',
    linkedAt: '2026-10-19T10:00:00.000Z',
    actor: { kind: 'account', loginId: 'shop1' },
    post: { bandKey: 'BK1', postKey: 'PK1', firstLine: '오늘 다육 공구 시작해요' },
    lastReadAt: '2026-10-19T10:00:05.000Z',
    received: 12,
    baseline: 3,
    baselineMessage: '이을 때 이미 달려 있던 댓글 3개는 넣지 않았어요.',
    ...patch,
  })

const notice = (id: number, patch: Partial<BandNotice> = {}): BandNotice => ({ id, kind: 'DELETED', message: `밴드에서 지운 댓글이에요 — 손님${String(id)}: '1번요'. 찜은 그대로예요. 취소하려면 찜에서 직접 취소해 주세요.`, at: '2026-10-19T10:01:00.000Z', seen: false, ...patch })

let server: FakeServer
let band: BandAccount
let bandLink: BandLinkView
let rehearsal: boolean
let messages: ChatMessage[]
let navigate: Navigate
let assigned: string[]
let role: 'SELLER' | 'ASSISTANT'

function setup() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role, assistant: role === 'ASSISTANT' ? { name: '보조' } : null } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: fullView().broadcasts[0]?.settings ?? {} } }))
    .on('GET', /^\/api\/assistants$/, () => ({ body: { assistants: [], limit: 5 } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ rehearsal })] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({
      body: fullView({
        seq: 1,
        rehearsal,
        broadcasts: [broadcastView()],
        buyers: [
          { id: 'band:UKEY_A1', kind: 'youtube', current: 'band:UKEY_A1', mergedInto: null, merged: [], display: '밴드손님', nameHistory: [], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false },
        ],
      }),
    }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal, seq: 1, messages, more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply => ({ body: emptyChanges(Number(match[1]), 1) }))
    .on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: connection({ status: 'NOT_CONNECTED', channel: null }) } }))
    .on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
    .on('GET', /^\/api\/platforms$/, () => ({ body: { platforms: [] } }))
    .on('GET', /^\/api\/instagram$/, () => ({ body: { connection: { configured: false, status: 'NOT_CONNECTED', login: null, account: null, permissions: { comments: false, messages: false }, consent: { on: false, by: null, at: null } } } }))
    .on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok: { operator: false, operatorMessage: '지금은 틱톡 연결을 쓸 수 없어요.', notice: { version: 'v', title: 't', lines: [], checkbox: 'c', button: 'b' }, consent: null, tiktokId: null } } }))
    .on('GET', /^\/api\/broadcasts\/b1\/live$/, () => ({ body: { link: { broadcast: 'b1', platform: null, state: 'NONE', liveId: null, linkedAt: null, actor: null, accountId: null, collection: null, moved: null }, links: [] } }))
    .on('GET', /^\/api\/broadcasts\/b1\/tiktok$/, () => ({ body: { link: { broadcast: 'b1', platform: 'TIKTOK', state: 'NONE', linkedAt: null, actor: null, tiktokId: null, collection: null } } }))
    .on('GET', /^\/api\/instagram\/dms\?/, () => ({ body: { date: DATE, rehearsal: false, rows: [] } }))
    .on('GET', /^\/api\/band$/, () => ({ body: { band } }))
    .on('GET', /^\/api\/broadcasts\/b1\/band$/, () => ({ body: { link: bandLink } }))
}

beforeEach(() => {
  server = new FakeServer()
  band = account()
  bandLink = bandNone()
  rehearsal = false
  messages = []
  navigate = vi.fn()
  assigned = []
  role = 'SELLER'
  setTopLevelNavigation((url) => assigned.push(url))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  setup()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

/** PC 폭 (휴대폰 폭은 쓸 수 없는 칸을 그리지 않는다 — D-MOB1-09) */
const wideScreen = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))

describe('플랫폼 접두어 (AC-BND1-01·75)', () => {
  it('band:로 시작하는 키만 밴드 — 대문자·쌍점 없음은 유튜브, 다른 접두어는 그대로', () => {
    const table: [string, string][] = [
      ['band:UKEY_A1', 'BAND'],
      ['band:', 'BAND'],
      ['bandUKEY', 'YOUTUBE'],
      ['BAND:UKEY', 'YOUTUBE'],
      ['ig:1', 'INSTAGRAM'],
      ['tt:1', 'TIKTOK'],
      ['sms:s1', 'SMS'],
      ['UC_A', 'YOUTUBE'],
      ['sim_a1', 'YOUTUBE'],
    ]
    for (const [key, platform] of table) expect(platformOfKey(key), key).toBe(platform)
    expect(PLATFORM_WORD.BAND).toBe('밴드')
    expect(buyerPlatformWord({ id: 'band:UKEY_A1', kind: 'youtube' })).toBe('밴드')
    expect(buyerPlatformWord({ id: 'BAND:UKEY', kind: 'youtube' })).toBe('유튜브')
  })

  it('채팅 줄 플랫폼 글자: 밴드 채팅이 있거나 밴드가 이어져 있으면 모든 줄에', () => {
    expect(chatPlatformTags([{ channel: 'UC_A' }, { channel: 'band:K1' }], false)).toBe(true)
    expect(chatPlatformTags([{ channel: 'UC_A' }], true)).toBe(true)
    expect(chatPlatformTags([{ channel: 'UC_A' }, { channel: 'BAND:K1' }], false)).toBe(false)
  })
})

describe('밴드 낱말·판단 (lib/band.ts)', () => {
  it('돌아온 결과 다섯 갈래 문장, 모르는 값은 안내 문장 (주소를 손으로 고쳐도 다른 글이 나오지 않는다)', () => {
    expect(bandCallbackMessage('connected')).toBe('밴드를 연결했어요.')
    expect(bandCallbackMessage('denied')).toBe('밴드 연결을 취소했어요.')
    expect(bandCallbackMessage('expired')).toBe('연결 시간이 지났어요. 다시 해 주세요.')
    expect(bandCallbackMessage('scope')).toBe('밴드 앱 권한이 모자라요. 운영자에게 문의해 주세요.')
    expect(bandCallbackMessage('failed')).toBe('밴드 연결에 실패했어요. 잠시 뒤 다시 해 주세요.')
    for (const code of ['toString', '__proto__', 'CONNECTED', '<b>x</b>']) expect(bandCallbackMessage(code)).toBe(BAND_CALLBACK_UNKNOWN)
  })

  it('계정 한 줄: "연결됨 — 이름"(이름 없으면 "연결됨")·"연결 안 됨"·서버 문장', () => {
    expect(bandAccountWords(account())).toBe('연결됨 — 김다육')
    expect(bandAccountWords(account({ profileName: null }))).toBe('연결됨')
    expect(bandAccountWords(account({ status: 'NOT_CONNECTED', message: NOT_CONNECTED, profileName: null }))).toBe('연결 안 됨')
    expect(bandAccountWords(account({ status: 'RECONNECT_NEEDED', message: RECONNECT }))).toBe(RECONNECT)
  })

  it('알림 띠 판단: 다시 시도 60초 넘음·다시 연결·읽을 수 없음·유튜브 — 읽는 중·끝남은 아니다', () => {
    const at = Date.parse('2026-10-19T10:00:05.000Z')
    const retrying = bandReading({ state: 'RETRYING', message: '밴드 댓글을 읽지 못해 다시 시도하고 있어요.' })
    expect(bandNotComing(retrying, at + BAND_RETRY_ALERT_MS)).toBe(false)
    expect(bandNotComing(retrying, at + BAND_RETRY_ALERT_MS + 1)).toBe(true)
    // 읽은 적이 없으면 이은 때부터
    expect(bandNotComing(bandReading({ state: 'RETRYING', lastReadAt: null }), Date.parse('2026-10-19T10:01:01.000Z'))).toBe(true)
    for (const state of ['RECONNECT_NEEDED', 'NO_ACCESS', 'YOUTUBE_LINKED'] as const) expect(bandNotComing(bandReading({ state }), at)).toBe(true)
    for (const state of ['READING', 'FINISHED', 'NONE'] as const) expect(bandNotComing(bandReading({ state }), at + 10 * BAND_RETRY_ALERT_MS)).toBe(false)
    expect(bandNotComing(null, at)).toBe(false)
  })

  it('지운·고친 댓글 수는 끝난 연결에서 세지 않는다, 확인 번호는 본 것 가운데 가장 큰 번호', () => {
    const notices = { items: [notice(7), notice(5, { seen: true }), notice(6, { kind: 'LATE' })], total: 7, seenUpTo: 5, unseen: 2, unseenEdits: 1 }
    expect(bandUnseenEdits(bandReading({ notices }))).toBe(1)
    expect(bandUnseenEdits(bandReading({ state: 'FINISHED', notices }))).toBe(0)
    expect(bandSeenUpTo(bandReading({ notices }))).toBe(7)
    expect(bandSeenUpTo(bandReading())).toBeNull()
    expect(bandEditsMessage(2)).toBe('밴드에서 지우거나 고친 댓글이 2개 있어요.')
    expect(bandReadWords('2026-10-19T10:00:05.000Z')).toBe('19:00:05에 읽었어요')
  })

  it('화면 문장에 영문 글자·개발 용어가 없다 (AC-BND1-77)', () => {
    const texts = [...Object.values(BAND_CALLBACK), BAND_CALLBACK_UNKNOWN, BAND_DISCONNECT_QUESTION, BAND_DISCONNECT_HINT, BAND_UNLINK_QUESTION, BAND_LINK_CONFIRM, BAND_LINK_BUSY, BAND_NO_POSTS, BAND_NOT_COMING, BAND_NO_LINK, BAND_NEW_NOTICE, bandEditsMessage(3), BAND_ITEM.replace('[검토 필요]', '')]
    for (const text of texts) {
      expect(text).not.toMatch(/[A-Za-z]/)
      expect(text).not.toMatch(/토큰|폴링|키\b/)
    }
  })
})

describe('주소 (설정의 밴드 칸)', () => {
  it('/settings/band?band=<결과>는 밴드 칸 + 결과, 왕복한다', () => {
    expect(parseRoute('/settings/band', '?band=connected')).toEqual({ name: 'settings', section: 'band', bandResult: 'connected' })
    expect(parseRoute('/settings/band')).toEqual({ name: 'settings', section: 'band' })
    expect(parseRoute('/settings/band', '?band=')).toEqual({ name: 'settings', section: 'band' })
    expect(routePath({ name: 'settings', section: 'band' })).toBe('/settings/band')
    expect(routePath({ name: 'settings', section: 'band', bandResult: 'denied' })).toBe('/settings/band?band=denied')
  })
})

async function openSettings(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
  await screen.findByRole('heading', { name: '설정', level: 1 })
  await flush(10)
}
const bandRegion = () => screen.getByRole('region', { name: '네이버 밴드' })

describe('설정 — 네이버 밴드 (AC-BND1-70)', () => {
  it('설정 없음: 서버 문장만 — 단추 없음', async () => {
    band = account({ status: 'NOT_CONFIGURED', message: NOT_CONFIGURED, profileName: null })
    await openSettings('/settings/band')
    expect(within(bandRegion()).getByText(NOT_CONFIGURED)).toBeDefined()
    expect(within(bandRegion()).queryAllByRole('button')).toEqual([])
  })

  it('연결 안 됨: "연결 안 됨" + "밴드 연결하기" → 서버가 준 주소로 이동 (끊기 없음)', async () => {
    band = account({ status: 'NOT_CONNECTED', message: NOT_CONNECTED, profileName: null })
    server.on('POST', /^\/api\/band\/connect$/, () => ({ body: { url: 'https://auth.band.example/oauth2/authorize?x=1' } }))
    await openSettings('/settings/band')
    expect(within(bandRegion()).getByText('연결 안 됨')).toBeDefined()
    expect(within(bandRegion()).queryByRole('button', { name: '연결 끊기' })).toBeNull()
    fireEvent.click(within(bandRegion()).getByRole('button', { name: '밴드 연결하기' }))
    await waitFor(() => expect(assigned).toEqual(['https://auth.band.example/oauth2/authorize?x=1']))
    expect(server.callsTo('POST', /^\/api\/band\/connect$/).map((call) => call.body)).toEqual([{}])
  })

  it('설정이 없어 연결 시작이 거절되면 서버 문장', async () => {
    band = account({ status: 'NOT_CONNECTED', message: NOT_CONNECTED, profileName: null })
    server.on('POST', /^\/api\/band\/connect$/, () => apiError(409, 'NOT_CONFIGURED', NOT_CONFIGURED))
    await openSettings('/settings/band')
    fireEvent.click(within(bandRegion()).getByRole('button', { name: '밴드 연결하기' }))
    expect(await within(bandRegion()).findByText(NOT_CONFIGURED)).toBeDefined()
    expect(assigned).toEqual([])
  })

  it('연결됨: "연결됨 — 이름", 끊기 확인 창 두 문장 → 같은 요청 번호로 끊기(다시 보내기) → 연결 안 됨', async () => {
    let attempt = 0
    const bodies: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/band\/disconnect$/, (call) => {
      bodies.push(call.body ?? {})
      attempt++
      if (attempt === 1) return { network: true }
      return { body: { band: account({ status: 'NOT_CONNECTED', message: NOT_CONNECTED, profileName: null, connectedAt: null }) } }
    })
    await openSettings('/settings/band')
    expect(within(bandRegion()).getByText('연결됨 — 김다육')).toBeDefined()
    fireEvent.click(within(bandRegion()).getByRole('button', { name: '연결 끊기' }))
    const dialog = screen.getByRole('dialog', { name: '밴드 연결 끊기' })
    expect(within(dialog).getByText(BAND_DISCONNECT_QUESTION)).toBeDefined()
    expect(within(dialog).getByText(BAND_DISCONNECT_HINT)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '끊기' }))
    expect(await within(bandRegion()).findByText('연결 안 됨', {}, { timeout: 3000 })).toBeDefined()
    expect(bodies).toHaveLength(2)
    expect(typeof bodies[0]?.requestId).toBe('string')
    expect(bodies[1]?.requestId).toBe(bodies[0]?.requestId)
    expect(screen.queryByRole('dialog', { name: '밴드 연결 끊기' })).toBeNull()
  })

  it('돌아온 결과는 한 번 보이고 주소에서 지운다 — 기록을 늘리지 않는다', async () => {
    await openSettings('/settings/band?band=connected')
    expect(within(bandRegion()).getByText('밴드를 연결했어요.')).toBeDefined()
    expect(window.location.pathname).toBe('/settings/band')
    expect(window.location.search).toBe('')
  })

  it('거부 결과는 경고 문장', async () => {
    band = account({ status: 'NOT_CONNECTED', message: NOT_CONNECTED, profileName: null })
    await openSettings('/settings/band?band=denied')
    const text = within(bandRegion()).getByText('밴드 연결을 취소했어요.')
    expect(text.className).toContain('warning')
  })

  it('계정 알림(SSE band ACCOUNT)으로 바로 바뀐다, 이름은 글자로만', async () => {
    await openSettings('/settings/band')
    act(() => FakeEventSource.last.emit('band', { kind: 'ACCOUNT', band: account({ status: 'RECONNECT_NEEDED', message: RECONNECT }) }))
    expect(within(bandRegion()).getByText(RECONNECT)).toBeDefined()
    act(() => FakeEventSource.last.emit('band', { kind: 'ACCOUNT', band: account({ profileName: '<img src=x onerror=alert(1)>' }) }))
    expect(within(bandRegion()).getByText('연결됨 — <img src=x onerror=alert(1)>')).toBeDefined()
    expect(bandRegion().querySelector('img')).toBeNull()
  })

  it('보조자: 밴드 칸도, 밴드 요청도 없다', async () => {
    role = 'ASSISTANT'
    window.history.replaceState(null, '', '/settings/band?band=connected')
    render(<App />)
    await flush(20)
    expect(screen.queryByRole('region', { name: '네이버 밴드' })).toBeNull()
    expect(server.calls.filter((call) => call.path.startsWith('/api/band'))).toEqual([])
  })
})

describe('개인정보처리방침 (AC-BND1-78)', () => {
  it('수집 항목에 밴드 한 줄', () => {
    render(<PrivacyPage />)
    expect(screen.getByText(BAND_ITEM)).toBeDefined()
    expect(BAND_ITEM).toBe('네이버 밴드를 연결하면: 밴드 이름, 내가 쓴 글 목록, 이은 글의 댓글(작성자 이름·작성자 구분 값·글·작성 시각). 밴드에 글이나 댓글을 쓰지 않아요. [검토 필요]')
  })
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={navigate} />)
  await screen.findByRole('region', { name: '상품 보드' })
  await flush(15)
}
const bandPanel = () => screen.getByRole('region', { name: '밴드' })
const strip = () => document.getElementById('alerts') as HTMLElement

describe('콘솔 — 밴드 칸 (AC-BND1-71)', () => {
  it('리허설: 밴드 요청을 보내지 않고 밴드 칸도 없다 (위 한 줄 그대로)', async () => {
    rehearsal = true
    await openConsole()
    expect(screen.queryByRole('region', { name: '밴드' })).toBeNull()
    expect(screen.getByText('리허설 방송에는 라이브를 이을 수 없어요.')).toBeDefined()
    expect(server.calls.filter((call) => /band/.test(call.path))).toEqual([])
  })

  it('연결 안 함: 서버 문장 + "설정으로"(밴드 칸으로) — PC만, 휴대폰은 그리지 않는다', async () => {
    bandLink = bandNone({ canLink: false, blockCode: 'NOT_CONNECTED', blockMessage: NOT_CONNECTED })
    await openConsole()
    expect(screen.queryByRole('region', { name: '밴드' })).toBeNull()
    cleanup()
    wideScreen()
    await openConsole()
    expect(within(bandPanel()).getByText(NOT_CONNECTED)).toBeDefined()
    const settings = within(bandPanel()).getByRole('link', { name: '설정으로' })
    expect(settings.getAttribute('href')).toBe('/settings/band')
    expect(within(bandPanel()).queryAllByRole('button')).toEqual([])
    fireEvent.click(settings)
    expect(navigate).toHaveBeenCalledWith({ name: 'settings', section: 'band' })
  })

  it('유튜브를 이은 회차: 서버 문장, 잇기 단추 없음 (휴대폰에서도 보인다)', async () => {
    bandLink = bandNone({ canLink: false, blockCode: 'YOUTUBE_LINKED', blockMessage: '유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.' })
    await openConsole()
    expect(within(bandPanel()).getByText('유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.')).toBeDefined()
    expect(within(bandPanel()).queryByRole('button', { name: '밴드 글 잇기' })).toBeNull()
  })

  it('이어짐: 글 첫 줄·상태·읽은 시각·받은 수·넣지 못한 수·기준선, 이을 수 있는 칸은 휴대폰에서도 그린다', async () => {
    bandLink = bandReading({ skipMessages: ['작성자를 알 수 없는 밴드 댓글 2개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.'] })
    await openConsole()
    const panel = bandPanel()
    expect(within(panel).getByText('오늘 다육 공구 시작해요')).toBeDefined()
    expect(within(panel).getByText('밴드 댓글을 읽고 있어요.')).toBeDefined()
    expect(within(panel).getByText('19:00:05에 읽었어요')).toBeDefined()
    expect(within(panel).getByText('받은 댓글 12개')).toBeDefined()
    expect(within(panel).getByText('작성자를 알 수 없는 밴드 댓글 2개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.')).toBeDefined()
    expect(within(panel).getByText('이을 때 이미 달려 있던 댓글 3개는 넣지 않았어요.')).toBeDefined()
    expect(within(panel).queryByText('이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요.')).toBeNull()
    expect(within(panel).getByRole('button', { name: '끊기' })).toBeDefined()
    expect(screen.queryByRole('button', { name: BAND_NOT_COMING })).toBeNull()
  })

  it('끊기 확인 창 → 끊으면 끝난 문장, 잇기 경로에 요청 번호', async () => {
    bandLink = bandReading()
    const bodies: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/broadcasts\/b1\/band\/unlink$/, (call) => {
      bodies.push(call.body ?? {})
      return { body: { link: bandReading({ state: 'FINISHED', message: '끊었어요.', canLink: true, blockCode: null, blockMessage: null, finishReason: 'UNLINKED' }) } }
    })
    await openConsole()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '끊기' }))
    const dialog = screen.getByRole('dialog', { name: '밴드 연결 끊기' })
    expect(within(dialog).getByText(BAND_UNLINK_QUESTION)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '끊기' }))
    expect(await within(bandPanel()).findByText('끊었어요.')).toBeDefined()
    expect(screen.queryByRole('dialog', { name: '밴드 연결 끊기' })).toBeNull()
    expect(bodies).toHaveLength(1)
    expect(typeof bodies[0]?.requestId).toBe('string')
    // 끝난 연결 + 이을 수 있음 → "다른 글 잇기"
    expect(within(bandPanel()).getByRole('button', { name: '다른 글 잇기' })).toBeDefined()
  })

  it('SSE로 상태가 바뀐다 — 토큰 풀림이면 칸 문장 + "설정으로" + 알림 띠 한 줄(누르면 밴드 칸으로)', async () => {
    bandLink = bandReading()
    await openConsole()
    act(() => FakeEventSource.last.emit('band', { kind: 'LINK', broadcast: 'b1', link: bandReading({ state: 'RECONNECT_NEEDED', message: RECONNECT }) }))
    expect(within(bandPanel()).getByText(RECONNECT)).toBeDefined()
    expect(within(bandPanel()).getByRole('link', { name: '설정으로' })).toBeDefined()
    const lead = within(strip()).getByRole('button', { name: BAND_NOT_COMING })
    fireEvent.click(lead)
    expect(document.activeElement).toBe(bandPanel())
    // 다른 방송의 알림은 이 콘솔을 바꾸지 않는다
    act(() => FakeEventSource.last.emit('band', { kind: 'LINK', broadcast: 'b2', link: bandReading({ broadcast: 'b2' }) }))
    expect(within(bandPanel()).getByText(RECONNECT)).toBeDefined()
    act(() => FakeEventSource.last.emit('band', { kind: 'LINK', broadcast: 'b1', link: bandReading() }))
    expect(within(strip()).queryByRole('button', { name: BAND_NOT_COMING })).toBeNull()
  })

  it('다시 시도 중인 채 60초가 넘으면 그때 알림 띠에 올린다', async () => {
    const now = Date.now()
    bandLink = bandReading({ state: 'RETRYING', message: '밴드 댓글을 읽지 못해 다시 시도하고 있어요.', lastReadAt: new Date(now - BAND_RETRY_ALERT_MS + 300).toISOString() })
    await openConsole()
    expect(within(bandPanel()).getByText('밴드 댓글을 읽지 못해 다시 시도하고 있어요.')).toBeDefined()
    expect(within(strip()).queryByRole('button', { name: BAND_NOT_COMING })).toBeNull()
    expect(await within(strip()).findByRole('button', { name: BAND_NOT_COMING }, { timeout: 3000 })).toBeDefined()
  })

  it('읽을 수 없는 글: 문장 + "다른 글 잇기" → 먼저 끊고 고르기를 연다', async () => {
    bandLink = bandReading({ state: 'NO_ACCESS', message: '이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.' })
    server.on('POST', /^\/api\/broadcasts\/b1\/band\/unlink$/, () => ({ body: { link: bandReading({ state: 'FINISHED', message: '끊었어요.', canLink: true, blockCode: null, blockMessage: null }) } }))
    server.on('GET', /^\/api\/band\/bands$/, () => ({ body: { bands: [{ bandKey: 'BK1', name: '다육 공구방', memberCount: 120 }], chosenBand: 'BK1', message: null } }))
    server.on('GET', /^\/api\/band\/posts\?/, () => ({ body: { posts: [], page: 1, more: false, cursor: null } }))
    await openConsole()
    expect(within(bandPanel()).getByText('이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.')).toBeDefined()
    expect(screen.getByRole('button', { name: BAND_NOT_COMING })).toBeDefined()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '다른 글 잇기' }))
    const dialog = await screen.findByRole('dialog', { name: '내 글 고르기' })
    expect(within(dialog).getByText(BAND_NO_POSTS)).toBeDefined()
    expect(server.callsTo('POST', /\/band\/unlink$/)).toHaveLength(1)
  })
})

describe('콘솔 — 잇기 흐름 (AC-BND1-72)', () => {
  const twoBands = { bands: [{ bandKey: 'BK2', name: '기억한 밴드', memberCount: 30 }, { bandKey: 'BK1', name: '다육 공구방', memberCount: 120 }], chosenBand: 'BK2', message: null }

  it('밴드 둘 → 고르기(서버 차례 그대로) → 내 글(날짜·첫 줄·댓글 수, 더 보기) → 확인 창 → 잇기: 잠기고 "글을 읽는 중이에요…", 다시 보내도 같은 요청 번호', async () => {
    wideScreen()
    server.on('GET', /^\/api\/band\/bands$/, () => ({ body: twoBands }))
    server.on('GET', /^\/api\/band\/posts\?band=BK1$/, () => ({ body: { posts: [{ postKey: 'P1', createdAt: '2026-10-19T09:00:00.000Z', firstLine: '<img src=x onerror=alert(1)> 공구', commentCount: 3 }], page: 1, more: true, cursor: 'CURSOR_0001' } }))
    server.on('GET', /^\/api\/band\/posts\?band=BK1&cursor=CURSOR_0001$/, () => ({ body: { posts: [{ postKey: 'P2', createdAt: null, firstLine: '어제 글', commentCount: null }], page: 2, more: false, cursor: null } }))
    const bodies: Record<string, unknown>[] = []
    let release: (() => void) | null = null
    let attempt = 0
    server.on('POST', /^\/api\/broadcasts\/b1\/band\/link$/, async (call) => {
      bodies.push(call.body ?? {})
      attempt++
      if (attempt === 1) return { network: true }
      await new Promise<void>((resolve) => (release = resolve))
      return { body: { link: bandReading({ baseline: 3 }) } }
    })
    await openConsole()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '밴드 글 잇기' }))
    const bandsDialog = await screen.findByRole('dialog', { name: '밴드 고르기' })
    const names = within(within(bandsDialog).getByRole('list', { name: '가입한 밴드' })).getAllByRole('button').map((item) => item.textContent)
    expect(names).toEqual(['기억한 밴드 멤버 30명', '다육 공구방 멤버 120명'])
    fireEvent.click(within(bandsDialog).getByRole('button', { name: /다육 공구방/ }))
    const postsDialog = await screen.findByRole('dialog', { name: '내 글 고르기' })
    await within(postsDialog).findByText('<img src=x onerror=alert(1)> 공구')
    expect(postsDialog.querySelector('img')).toBeNull()
    expect(within(postsDialog).getByText('댓글 3개')).toBeDefined()
    expect(within(postsDialog).getByText('10월 19일 오후 6:00')).toBeDefined()
    fireEvent.click(within(postsDialog).getByRole('button', { name: '더 보기' }))
    await within(postsDialog).findByText('어제 글')
    expect(within(postsDialog).queryByRole('button', { name: '더 보기' })).toBeNull()
    expect(within(postsDialog).getByRole('button', { name: '밴드 다시 고르기' })).toBeDefined()
    fireEvent.click(within(postsDialog).getByRole('button', { name: /공구/ }))
    const confirm = await screen.findByRole('dialog', { name: '이 글 잇기' })
    expect(within(confirm).getByText(BAND_LINK_CONFIRM)).toBeDefined()
    const link = within(confirm).getByRole('button', { name: '잇기' }) as HTMLButtonElement
    fireEvent.click(link)
    expect(await within(confirm).findByText(BAND_LINK_BUSY)).toBeDefined()
    expect(link.disabled).toBe(true)
    fireEvent.click(link)
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 3000 })
    expect(bodies[0]).toMatchObject({ bandKey: 'BK1', postKey: 'P1' })
    expect(bodies[1]?.requestId).toBe(bodies[0]?.requestId)
    act(() => release?.())
    expect(await within(bandPanel()).findByText('이을 때 이미 달려 있던 댓글 3개는 넣지 않았어요.')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('밴드가 하나뿐이면 고르기를 건너뛴다, 내 글이 없으면 안내 문장, 거절은 서버 문장 그대로', async () => {
    server.on('GET', /^\/api\/band\/bands$/, () => ({ body: { bands: [{ bandKey: 'BK1', name: '다육 공구방', memberCount: null }], chosenBand: null, message: null } }))
    server.on('GET', /^\/api\/band\/posts\?band=BK1$/, () => ({ body: { posts: [{ postKey: 'P1', createdAt: null, firstLine: '공구', commentCount: 1200 }], page: 1, more: false, cursor: null } }))
    server.on('POST', /^\/api\/broadcasts\/b1\/band\/link$/, () => apiError(409, 'TOO_MANY_COMMENTS', '댓글이 1,000개 넘는 글은 이을 수 없어요. 새 글을 올려 이어 주세요.'))
    await openConsole()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '밴드 글 잇기' }))
    const postsDialog = await screen.findByRole('dialog', { name: '내 글 고르기' })
    expect(screen.queryByRole('dialog', { name: '밴드 고르기' })).toBeNull()
    expect(within(postsDialog).queryByRole('button', { name: '밴드 다시 고르기' })).toBeNull()
    expect(within(postsDialog).getByText('댓글 1,200개')).toBeDefined()
    fireEvent.click(within(postsDialog).getByRole('button', { name: /공구/ }))
    const confirm = await screen.findByRole('dialog', { name: '이 글 잇기' })
    fireEvent.click(within(confirm).getByRole('button', { name: '잇기' }))
    expect(await within(confirm).findByText('댓글이 1,000개 넘는 글은 이을 수 없어요. 새 글을 올려 이어 주세요.')).toBeDefined()
    // 글 다시 고르기
    fireEvent.click(within(confirm).getByRole('button', { name: '글 다시 고르기' }))
    expect(await screen.findByRole('dialog', { name: '내 글 고르기' })).toBeDefined()
  })

  it('가입한 밴드가 없으면 서버 문장', async () => {
    server.on('GET', /^\/api\/band\/bands$/, () => ({ body: { bands: [], chosenBand: null, message: '가입한 밴드가 없어요. 밴드 앱에서 먼저 밴드를 만들어 주세요.' } }))
    await openConsole()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '밴드 글 잇기' }))
    const dialog = await screen.findByRole('dialog', { name: '밴드 고르기' })
    expect(await within(dialog).findByText('가입한 밴드가 없어요. 밴드 앱에서 먼저 밴드를 만들어 주세요.')).toBeDefined()
  })
})

describe('콘솔 — 알림 띠·알림 목록 (AC-BND1-73·74)', () => {
  it('확인하지 않은 지운·고친 댓글: 띠 한 줄 + "확인했어요" → 본 마지막 번호를 보내고 줄이 사라진다, 새 알림이 오면 다시 뜬다', async () => {
    const items = [
      notice(3, { kind: 'EDITED', message: "밴드에서 고친 댓글이에요 — <b>손님</b>: '1번' → '2번'. 찜은 처음 글대로예요." }),
      notice(2),
      notice(1, { kind: 'LATE', message: '밴드 댓글을 2분 동안 읽지 못했어요. 그 사이 달린 댓글 4개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.', seen: true }),
    ]
    bandLink = bandReading({ notices: { items, total: 3, seenUpTo: 1, unseen: 2, unseenEdits: 2 } })
    const seen: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/broadcasts\/b1\/band\/notices-seen$/, (call) => {
      seen.push(call.body ?? {})
      return { body: { link: bandReading({ notices: { items: items.map((item) => ({ ...item, seen: true })), total: 3, seenUpTo: 3, unseen: 0, unseenEdits: 0 } }) } }
    })
    await openConsole()
    const lead = within(strip()).getByRole('button', { name: '밴드에서 지우거나 고친 댓글이 2개 있어요.' })
    expect(lead).toBeDefined()
    // 목록: 새것 위, 확인하지 않은 것은 "새 알림" 글자, 글은 글자로만
    const list = within(bandPanel()).getByRole('list', { name: '밴드 알림' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain(BAND_NEW_NOTICE)
    expect(rows[0]?.textContent).toContain("<b>손님</b>: '1번' → '2번'")
    expect(rows[0]?.querySelector('b')).toBeNull()
    expect(rows[2]?.textContent).not.toContain(BAND_NEW_NOTICE)
    fireEvent.click(within(strip()).getByRole('button', { name: '확인했어요' }))
    await waitFor(() => expect(within(strip()).queryByRole('button', { name: '밴드에서 지우거나 고친 댓글이 2개 있어요.' })).toBeNull())
    expect(seen).toEqual([{ upTo: 3 }])
    expect(within(bandPanel()).queryByRole('button', { name: '확인했어요' })).toBeNull()
    expect(within(bandPanel()).queryByText(BAND_NEW_NOTICE)).toBeNull()
    act(() =>
      FakeEventSource.last.emit('band', {
        kind: 'LINK',
        broadcast: 'b1',
        link: bandReading({ notices: { items: [notice(4), ...items.map((item) => ({ ...item, seen: true }))], total: 4, seenUpTo: 3, unseen: 1, unseenEdits: 1 } }),
      }),
    )
    expect(within(strip()).getByRole('button', { name: '밴드에서 지우거나 고친 댓글이 1개 있어요.' })).toBeDefined()
    fireEvent.click(within(bandPanel()).getByRole('button', { name: '확인했어요' }))
    await waitFor(() => expect(seen).toEqual([{ upTo: 3 }, { upTo: 4 }]))
  })

  it('늦게 읽음 알림만 확인하지 않았으면 띠 줄은 없고 칸에 "확인했어요"', async () => {
    bandLink = bandReading({ notices: { items: [notice(1, { kind: 'LATE', message: '밴드 댓글을 1분 동안 읽지 못했어요. 그 사이 달린 댓글 1개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.' })], total: 1, seenUpTo: 0, unseen: 1, unseenEdits: 0 } })
    await openConsole()
    expect(within(strip()).queryByRole('button', { name: /밴드에서 지우거나/ })).toBeNull()
    expect(within(bandPanel()).getByRole('button', { name: '확인했어요' })).toBeDefined()
  })

  it('끝난 연결은 알림 띠에 띄우지 않는다', async () => {
    bandLink = bandReading({ state: 'FINISHED', message: '방송을 끝내서 밴드 댓글을 그만 받았어요.', notices: { items: [notice(1)], total: 1, seenUpTo: 0, unseen: 1, unseenEdits: 1 } })
    await openConsole()
    expect(within(strip()).queryByRole('button', { name: /밴드/ })).toBeNull()
  })

  it('밴드와 인스타그램을 함께 이으면 도착순 안내, 채팅 줄마다 "밴드" 글자', async () => {
    bandLink = bandReading()
    messages = [message(1, { channel: 'band:UKEY_A1', nick: '<img src=x onerror=alert(1)>', text: '&lt;script&gt;alert(1)&lt;/script&gt; 1번' })]
    await openConsole()
    expect(screen.queryByText(MULTI_PLATFORM_NOTICE)).toBeNull()
    act(() =>
      FakeEventSource.last.emit('instagram', {
        kind: 'LINK',
        broadcast: 'b1',
        link: { broadcast: 'b1', platform: 'INSTAGRAM', state: 'LINKED', liveId: '1', linkedAt: null, actor: null, accountId: null, collection: { platform: 'INSTAGRAM', state: 'LIVE', message: '댓글을 받는 중', liveId: '1', lastCommentAt: null, comments: 0, late: 0, malformed: 0 }, moved: null },
      }),
    )
    expect(screen.getByText(MULTI_PLATFORM_NOTICE)).toBeDefined()
    const chat = screen.getByRole('region', { name: '채팅' })
    expect(within(chat).getAllByText('밴드').length).toBeGreaterThan(0)
    expect(within(chat).getByText('&lt;script&gt;alert(1)&lt;/script&gt; 1번', { exact: false })).toBeDefined()
    expect(chat.querySelector('img')).toBeNull()
    expect(chat.querySelector('script')).toBeNull()
  })
})

describe('알림 띠 — 밴드 줄은 휴대폰에서도 문장 끝까지 (U-BND1-01, AC-BND1-76)', () => {
  const COUNTS = { conflict: 0, cancelRequest: 0, succession: 0, pending: 0, attention: 0 }

  it('밴드 줄(full)은 "알림" 영역 안의 첫 목록 — 나머지 알림은 둘째 목록, "확인했어요"는 그 줄 옆에 남는다(접힌 동안만 화면에서 숨김)', () => {
    render(
      <AlertStrip
        leads={[
          { key: 'tiktok', text: '틱톡 댓글을 붙여 넣어 주세요.', onClick: () => {} },
          { key: 'band-notices', text: bandEditsMessage(1), onClick: () => {}, full: true, action: { label: '확인했어요', onClick: () => {} } },
        ]}
        counts={{ ...COUNTS, conflict: 1 }}
        onOpen={() => {}}
        onToggle={() => {}}
      />,
    )
    const region = screen.getByRole('region', { name: '알림' })
    const lists = region.querySelectorAll('ul')
    expect(lists).toHaveLength(2)
    expect(lists[0]?.className).toContain('alerts-full')
    expect(within(lists[0] as HTMLElement).getByRole('button', { name: bandEditsMessage(1) })).toBeDefined()
    expect(within(lists[0] as HTMLElement).getByRole('button', { name: '확인했어요' }).className).toContain('alert-lead-action')
    expect(within(lists[1] as HTMLElement).queryByText(bandEditsMessage(1))).toBeNull()
    expect(within(lists[1] as HTMLElement).getByRole('button', { name: '틱톡 댓글을 붙여 넣어 주세요.' })).toBeDefined()
    // 띠는 나눠 그리는 모양(휴대폰 두 줄), 펼치기 단추는 영역 밖
    const bar = region.parentElement as HTMLElement
    expect(bar.className).toContain('alert-bar-split')
    expect(region.contains(screen.getByRole('button', { name: '알림 3 펼치기' }))).toBe(false)
  })

  it('밴드 줄만 있으면 둘째 목록·"알림 없음" 없이 첫 목록 하나 + "알림 1 펼치기"', () => {
    render(<AlertStrip leads={[{ key: 'band', text: BAND_NOT_COMING, onClick: () => {}, full: true }]} counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />)
    const region = screen.getByRole('region', { name: '알림' })
    expect(region.querySelectorAll('ul')).toHaveLength(1)
    expect(screen.queryByText('알림 없음')).toBeNull()
    expect(within(region).getByRole('button', { name: BAND_NOT_COMING })).toBeDefined()
    expect(screen.getByRole('button', { name: '알림 1 펼치기' })).toBeDefined()
  })

  it('밴드 줄이 없으면 지금 띠 그대로 (목록 하나, 나눠 그리지 않음)', () => {
    render(<AlertStrip leads={[{ key: 'tiktok', text: '틱톡 댓글을 붙여 넣어 주세요.', onClick: () => {} }]} counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />)
    const region = screen.getByRole('region', { name: '알림' })
    expect(region.querySelectorAll('ul')).toHaveLength(1)
    expect((region.parentElement as HTMLElement).className).not.toContain('alert-bar-split')
  })

  it('콘솔: 지운 댓글 줄·들어오지 않음 줄은 첫 목록(끝까지 보일 줄)에 있다', async () => {
    bandLink = bandReading({ notices: { items: [notice(1)], total: 1, seenUpTo: 0, unseen: 1, unseenEdits: 1 } })
    await openConsole()
    const full = strip().querySelector('ul.alerts-full') as HTMLElement
    expect(full).not.toBeNull()
    expect(within(full).getByRole('button', { name: bandEditsMessage(1) })).toBeDefined()
    expect(within(full).getByRole('button', { name: '확인했어요' })).toBeDefined()
  })
})
