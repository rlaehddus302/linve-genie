// 여러 플랫폼·인스타그램·틱톡 화면 (N2b-2 AC-N2b-2-20·25·60~68). 가짜 서버로 콘솔·설정·붙여넣기 창을 그린다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { ChatMessage, InstagramConnection, InstagramLinkView, PlatformCapability, TikTokCollection, TikTokLinkView, TikTokSettings } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { PasteDialog } from '../src/components/PasteDialog.tsx'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import {
  MULTI_PLATFORM_NOTICE,
  REHEARSAL_LIVE,
  TIKTOK_NO_CONSENT,
  TIKTOK_NO_ID,
  TIKTOK_PASTE_ALERT,
  buyerPlatformWord,
  chatPlatformTags,
  failedDmCount,
  failedDmMessage,
  instagramCallbackMessage,
  pasteGroupMessage,
  platformOfKey,
  tiktokBlocker,
  tiktokNeedsPaste,
  tiktokReconnectable,
} from '../src/lib/platforms.ts'
import { parseRoute, routePath, type Navigate } from '../src/lib/router.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, connection, emptyChanges, flush, fullView, message, type Reply } from './support.ts'

const NOTICE_LINES = [
  '틱톡은 라이브 댓글을 읽는 공식 방법을 주지 않아요. 라이브찜은 누구나 볼 수 있는 내 라이브의 댓글을 비공식 방법으로 읽어요.',
  '틱톡이 이 방법을 막거나 바꾸면 언제든 댓글이 들어오지 않을 수 있어요. 그때는 댓글을 직접 붙여 넣어 주세요.',
  '틱톡 이용약관은 자동으로 정보를 모으는 것을 막고 있을 수 있어요. 시험 중인 기능이라 문제가 생기면 운영자가 언제든 끌 수 있어요.',
  '라이브찜은 틱톡에 글을 올리지 않아요. 감사 메시지도 틱톡에는 보내지 않아요.',
  '틱톡 비밀번호나 로그인 정보는 묻지도 받지도 않아요.',
  '내 틱톡 계정의 아이디만 넣어 주세요. 다른 사람의 방송 댓글을 모으는 데 쓰면 안 돼요.',
  '연결을 돕는 다른 회사의 서비스를 거치기 때문에, 넣은 틱톡 아이디가 그 회사로 전달돼요.',
  '언제든 설정에서 끌 수 있어요. 끄면 틱톡 댓글을 바로 그만 받아요.',
]

const tiktokSettings = (patch: Partial<TikTokSettings> = {}): TikTokSettings => ({
  operator: true,
  operatorMessage: null,
  notice: { version: 'TT-BETA-1', title: '틱톡 라이브 연결(베타) 안내', lines: NOTICE_LINES, checkbox: '안내를 읽었고, 위 내용에 동의해요', button: '켜기' },
  consent: null,
  tiktokId: null,
  ...patch,
})
const consentOn = { on: true, at: '2026-10-19T01:00:00.000Z', version: 'TT-BETA-1' }

const igConnection = (patch: Partial<InstagramConnection> = {}): InstagramConnection => ({
  configured: true,
  status: 'CONNECTED',
  login: 'FACEBOOK',
  account: { id: '17840001', username: 'shop_ig', type: 'BUSINESS' },
  permissions: { comments: true, messages: true },
  consent: { on: false, by: null, at: null },
  ...patch,
})

const igNone: InstagramLinkView = { broadcast: 'b1', platform: null, state: 'NONE', liveId: null, linkedAt: null, actor: null, accountId: null, collection: null, moved: null }
const igLinked = (patch: Partial<InstagramLinkView> = {}): InstagramLinkView => ({
  broadcast: 'b1',
  platform: 'INSTAGRAM',
  state: 'LINKED',
  liveId: '1790000001',
  linkedAt: '2026-10-19T10:00:00.000Z',
  actor: { kind: 'account', loginId: 'shop1' },
  accountId: '17840001',
  collection: { platform: 'INSTAGRAM', state: 'LIVE', message: '댓글을 받는 중', liveId: '1790000001', lastCommentAt: null, comments: 12, late: 2, malformed: 0 },
  moved: null,
  ...patch,
})

const ttCollection = (patch: Partial<TikTokCollection> = {}): TikTokCollection => ({
  state: 'CONNECTED',
  reason: null,
  message: '틱톡 댓글을 받고 있어요.',
  failures: 0,
  nextAttemptAt: null,
  missed: false,
  missedMessage: null,
  comments: 7,
  lastCommentAt: null,
  notRecorded: 0,
  saveFailed: 0,
  ...patch,
})
const ttNone: TikTokLinkView = { broadcast: 'b1', platform: 'TIKTOK', state: 'NONE', linkedAt: null, actor: null, tiktokId: null, collection: null }
const ttLinked = (patch: Partial<TikTokCollection> = {}): TikTokLinkView => ({
  broadcast: 'b1',
  platform: 'TIKTOK',
  state: 'LINKED',
  linkedAt: '2026-10-19T10:00:00.000Z',
  actor: { kind: 'account', loginId: 'shop1' },
  tiktokId: 'myshop',
  collection: ttCollection(patch),
})

const capabilities: PlatformCapability[] = [
  { platform: 'YOUTUBE', ready: true, receivedTime: true, thanks: 'PUBLIC_CHAT', videoComment: true, reasons: {} },
  { platform: 'INSTAGRAM', ready: true, receivedTime: false, thanks: 'DM_PER_COMMENT', videoComment: false, reasons: {} },
  { platform: 'TIKTOK', ready: true, receivedTime: false, thanks: 'NONE', videoComment: false, reasons: {} },
]

let server: FakeServer
let rehearsal: boolean
let ended: boolean
let tiktok: TikTokSettings
let instagram: InstagramConnection
let igLink: InstagramLinkView
let ttLink: TikTokLinkView
let messages: ChatMessage[]
let dmRows: { id: number; broadcast: string | null; status: string; reason: string | null }[]
let navigate: Navigate
let assigned: string[]
let seq: number

function setup() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: fullView().broadcasts[0]?.settings ?? {} } }))
    .on('GET', /^\/api\/assistants$/, () => ({ body: { assistants: [], limit: 5 } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ rehearsal, ended, endedAt: ended ? '2026-10-19T12:00:00.000Z' : null })] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({
      body: fullView({
        seq,
        rehearsal,
        broadcasts: [broadcastView({ ended, endedAt: ended ? '2026-10-19T12:00:00.000Z' : null })],
        buyers: [
          { id: 'tt:7001', kind: 'youtube', current: 'tt:7001', mergedInto: null, merged: [], display: '철수', nameHistory: [], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false },
        ],
      }),
    }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal, seq, messages, more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply => ({ body: emptyChanges(Number(match[1]), seq) }))
    .on('GET', /^\/api\/broadcasts\/b1\/rehearsal\/generator$/, () => ({ body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } } }))
    .on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: connection({ status: 'NOT_CONNECTED', channel: null }) } }))
    .on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
    .on('GET', /^\/api\/platforms$/, () => ({ body: { platforms: capabilities } }))
    .on('GET', /^\/api\/instagram$/, () => ({ body: { connection: instagram } }))
    .on('GET', /^\/api\/tiktok$/, () => ({ body: { tiktok } }))
    .on('GET', /^\/api\/broadcasts\/b1\/live$/, () => ({ body: { link: igLink, links: [] } }))
    .on('GET', /^\/api\/broadcasts\/b1\/tiktok$/, () => ({ body: { link: ttLink } }))
    .on('GET', /^\/api\/instagram\/dms\?/, () => ({ body: { date: DATE, rehearsal: false, rows: dmRows } }))
}

beforeEach(() => {
  server = new FakeServer()
  rehearsal = false
  ended = false
  tiktok = tiktokSettings({ consent: consentOn, tiktokId: 'myshop' })
  instagram = igConnection()
  igLink = igNone
  ttLink = ttNone
  messages = []
  dmRows = []
  navigate = vi.fn()
  assigned = []
  seq = 1
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
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

describe('플랫폼 낱말·판단 (platforms.ts)', () => {
  it('키 접두어로 플랫폼을 정한다 — 구매자 종류 글자', () => {
    expect(platformOfKey('ig:1')).toBe('INSTAGRAM')
    expect(platformOfKey('tt:1')).toBe('TIKTOK')
    expect(platformOfKey('sms:r1')).toBe('SMS')
    expect(platformOfKey('UC_A')).toBe('YOUTUBE')
    expect(buyerPlatformWord({ id: 'tt:1', kind: 'youtube' })).toBe('틱톡')
    expect(buyerPlatformWord({ id: 'ig:1', kind: 'youtube' })).toBe('인스타그램')
    expect(buyerPlatformWord({ id: 'UC_A', kind: 'youtube' })).toBe('유튜브')
    expect(buyerPlatformWord({ id: 'sms:r1', kind: 'sms' })).toBe('문자')
  })

  it('AC-65: 채팅 플랫폼 글자는 인스타·틱톡 채팅이 있거나 이어져 있을 때만', () => {
    expect(chatPlatformTags([{ channel: 'UC_A' }], false)).toBe(false)
    expect(chatPlatformTags([], false)).toBe(false)
    expect(chatPlatformTags([{ channel: 'UC_A' }], true)).toBe(true)
    expect(chatPlatformTags([{ channel: 'UC_A' }, { channel: 'tt:1' }], false)).toBe(true)
  })

  it('틱톡: 막히는 이유·다시 연결·붙여넣기 주 단추', () => {
    expect(tiktokBlocker(tiktokSettings({ operator: false }), '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.')).toBe('지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.')
    expect(tiktokBlocker(tiktokSettings(), undefined)).toBe(TIKTOK_NO_CONSENT)
    expect(tiktokBlocker(tiktokSettings({ consent: { ...consentOn, version: 'TT-BETA-0' } }), undefined)).toBe(TIKTOK_NO_CONSENT)
    expect(tiktokBlocker(tiktokSettings({ consent: consentOn }), undefined)).toBe(TIKTOK_NO_ID)
    expect(tiktokBlocker(tiktokSettings({ consent: consentOn, tiktokId: 'a' }), undefined)).toBeNull()
    for (const state of ['RETRYING', 'STOPPED', 'ENDED', 'OFF']) expect(tiktokReconnectable(ttCollection({ state }))).toBe(true)
    for (const state of ['CONNECTED', 'CONNECTING', 'IDLE', 'FINISHED']) expect(tiktokReconnectable(ttCollection({ state }))).toBe(false)
    expect(tiktokNeedsPaste(ttCollection({ state: 'RETRYING', reason: 'BLOCKED' }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'RETRYING', reason: 'SIGN_FAILED' }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'RETRYING', reason: 'NETWORK' }))).toBe(false)
    expect(tiktokNeedsPaste(ttCollection({ state: 'STOPPED' }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'OFF' }))).toBe(true)
    // 끊긴 동안 받지 못했을 수 있음: 지금 받지 못하는 동안만 — 저절로 다시 붙어 CONNECTED면 붙여넣기를 띄우지 않는다 (SA-N2b-2-006·TE-N2b-2-004)
    expect(tiktokNeedsPaste(ttCollection({ missed: true }))).toBe(false)
    expect(tiktokNeedsPaste(ttCollection({ state: 'CONNECTING', missed: true }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'IDLE', missed: true }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'RETRYING', reason: 'NETWORK', missed: true }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'FINISHED', missed: true }))).toBe(false)
    expect(tiktokNeedsPaste(null)).toBe(false)
    // 저장하지 못한 댓글(saveFailed > 0)은 받는 중에도 붙여넣기 (SA-N2b-2-009·TE-N2b-2-007 — 그 댓글은 어디에도 기록되지 않았다)
    expect(tiktokNeedsPaste(ttCollection({ saveFailed: 3, missed: true }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ saveFailed: 1 }))).toBe(true)
    expect(tiktokNeedsPaste(ttCollection({ state: 'FINISHED', saveFailed: 3, missed: true }))).toBe(false)
  })

  it('인스타그램: 보내지 못한 DM 수·결과 문장, 붙여넣기 묶음 문장', () => {
    expect(
      failedDmCount(
        [
          { broadcast: 'b1', status: 'FAILED', reason: 'GAVE_UP' },
          { broadcast: 'b2', status: 'FAILED', reason: 'GAVE_UP' },
          { broadcast: 'b1', status: 'SENT', reason: null },
          { broadcast: 'b1', status: 'FAILED', reason: 'UNCONFIRMED' },
          { broadcast: 'b1', status: 'FAILED', reason: null },
          // 판매자가 할 일이 없는 실패는 세지 않는다 (YT-06 화면, TE-N2b-2-002)
          { broadcast: 'b1', status: 'FAILED', reason: 'NO_CONSENT' },
          { broadcast: 'b1', status: 'FAILED', reason: 'NO_LINK' },
          { broadcast: 'b1', status: 'SKIPPED', reason: 'NO_RECIPIENT' },
        ],
        'b1',
      ),
    ).toBe(3)
    expect(failedDmMessage(2)).toBe('감사 DM 2건을 보내지 못했어요. 인스타그램 앱에서 직접 보내 주세요.')
    expect(instagramCallbackMessage('CONNECTED')).toBe('인스타그램 계정을 연결했어요.')
    expect(instagramCallbackMessage('toString')).toBe('인스타그램 연결 결과를 확인하지 못했어요. 아래 연결 상태를 확인해 주세요.')
    expect(pasteGroupMessage(3)).toBe('같은 닉네임 3줄은 한 구매자로 넣어요')
  })

  it('화면 문장에 영문 글자가 없다 (AC-68 — "감사 DM"은 스펙 문장 그대로라 뺀다)', () => {
    for (const text of [MULTI_PLATFORM_NOTICE, REHEARSAL_LIVE, TIKTOK_NO_CONSENT, TIKTOK_NO_ID, TIKTOK_PASTE_ALERT, pasteGroupMessage(2)]) expect(text).not.toMatch(/[A-Za-z]/)
  })
})

describe('주소 (설정의 인스타그램·틱톡 칸)', () => {
  it('인스타그램에서 돌아온 `/?instagram=`은 설정의 인스타그램 칸 + 결과, 칸 주소는 왕복한다', () => {
    expect(parseRoute('/', '?instagram=CONNECTED')).toEqual({ name: 'settings', section: 'instagram', instagramResult: 'CONNECTED' })
    expect(parseRoute('/settings', '?instagram=DENIED')).toEqual({ name: 'settings', section: 'instagram', instagramResult: 'DENIED' })
    expect(parseRoute('/settings/tiktok')).toEqual({ name: 'settings', section: 'tiktok' })
    expect(parseRoute('/settings/instagram')).toEqual({ name: 'settings', section: 'instagram' })
    expect(parseRoute('/sms', '?instagram=CONNECTED')).toEqual({ name: 'sms' })
    expect(routePath({ name: 'settings', section: 'tiktok' })).toBe('/settings/tiktok')
    expect(routePath({ name: 'settings', section: 'instagram', instagramResult: 'CONNECTED' })).toBe('/settings/instagram?instagram=CONNECTED')
    expect(routePath({ name: 'settings', section: 'youtube', youtubeResult: 'CONNECTED' })).toBe('/settings/youtube?youtube=CONNECTED')
  })
})

async function openSettings(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
  await screen.findByRole('heading', { name: '설정', level: 1 })
  await flush(10)
}

describe('설정 — 틱톡 라이브(베타) (AC-20·25)', () => {
  it('운영자 스위치가 꺼져 있으면 한 줄만 — 켜기·아이디 칸 없음', async () => {
    tiktok = tiktokSettings({ operator: false, operatorMessage: '지금은 틱톡 연결을 쓸 수 없어요.' })
    await openSettings('/settings/tiktok')
    const region = screen.getByRole('region', { name: '틱톡 라이브(베타)' })
    expect(within(region).getByText('지금은 틱톡 연결을 쓸 수 없어요.')).toBeDefined()
    expect(within(region).queryAllByRole('button')).toEqual([])
    expect(within(region).queryByRole('textbox')).toBeNull()
  })

  it('켜기 전: 고지 전문(제목·여덟 줄 순서대로), 체크 전에는 "켜기"를 누를 수 없다, 켜면 판을 보낸다 → 켠 날·아이디 칸', async () => {
    tiktok = tiktokSettings()
    const sent: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/tiktok\/consent$/, (call) => {
      sent.push(call.body ?? {})
      tiktok = tiktokSettings({ consent: { on: true, at: '2026-10-20T15:30:00.000Z', version: 'TT-BETA-1' } })
      return { body: { tiktok } }
    })
    await openSettings('/settings/tiktok')
    const region = screen.getByRole('region', { name: '틱톡 라이브(베타)' })
    expect(within(region).getByRole('heading', { name: '틱톡 라이브 연결(베타) 안내' })).toBeDefined()
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual(NOTICE_LINES)
    expect(region.textContent).not.toContain('TT-BETA-1')
    const on = within(region).getByRole('button', { name: '켜기' }) as HTMLButtonElement
    expect(on.disabled).toBe(true)
    expect(within(region).queryByLabelText('내 틱톡 아이디')).toBeNull()
    fireEvent.click(within(region).getByRole('checkbox', { name: '안내를 읽었고, 위 내용에 동의해요' }))
    expect(on.disabled).toBe(false)
    fireEvent.click(on)
    // KST 날짜 (UTC 15:30 → 다음 날)
    await within(region).findByText('켜져 있어요 (2026년 10월 21일 켬)')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ on: true, version: 'TT-BETA-1' })
    expect(typeof sent[0]?.requestId).toBe('string')
    expect(within(region).getByLabelText('내 틱톡 아이디')).toBeDefined()
  })

  it('안내가 바뀌었으면 서버 문장을 보이고 새 안내를 다시 받는다', async () => {
    tiktok = tiktokSettings()
    server.on('POST', /^\/api\/tiktok\/consent$/, () => apiError(409, 'NOTICE_CHANGED', '안내가 바뀌었어요. 새 안내를 읽고 다시 켜 주세요.'))
    await openSettings('/settings/tiktok')
    const region = screen.getByRole('region', { name: '틱톡 라이브(베타)' })
    const before = server.callsTo('GET', /^\/api\/tiktok$/).length
    fireEvent.click(within(region).getByRole('checkbox'))
    fireEvent.click(within(region).getByRole('button', { name: '켜기' }))
    expect(await within(region).findByText('안내가 바뀌었어요. 새 안내를 읽고 다시 켜 주세요.')).toBeDefined()
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/tiktok$/).length).toBe(before + 1))
  })

  it('아이디: 틀리면 칸 아래 서버 문장, 맞으면 저장 · 끄기는 확인 창', async () => {
    tiktok = tiktokSettings({ consent: consentOn })
    server.on('PUT', /^\/api\/tiktok\/account$/, (call) => {
      if (call.body?.tiktokId === 'https://example.com/x') {
        return apiError(400, 'INVALID_TIKTOK_ID', '틱톡 아이디나 방송 주소가 아니에요.', [{ field: 'tiktokId', message: '틱톡 아이디나 방송 주소가 아니에요.' }])
      }
      tiktok = { ...tiktok, tiktokId: 'myshop' }
      return { body: { tiktok } }
    })
    const offs: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/tiktok\/consent$/, (call) => {
      offs.push(call.body ?? {})
      tiktok = tiktokSettings({ consent: { on: false, at: '2026-10-20T01:00:00.000Z', version: null } })
      return { body: { tiktok } }
    })
    await openSettings('/settings/tiktok')
    const region = screen.getByRole('region', { name: '틱톡 라이브(베타)' })
    const field = within(region).getByLabelText('내 틱톡 아이디')
    fireEvent.change(field, { target: { value: 'https://example.com/x' } })
    fireEvent.click(within(region).getByRole('button', { name: '저장' }))
    const error = await within(region).findByRole('alert')
    expect(error.textContent).toBe('틱톡 아이디나 방송 주소가 아니에요.')
    expect(field.getAttribute('aria-describedby')).toBe(error.id)
    fireEvent.change(field, { target: { value: '@MyShop' } })
    fireEvent.click(within(region).getByRole('button', { name: '저장' }))
    await within(region).findByText('저장했어요.')
    expect((field as HTMLInputElement).value).toBe('@myshop')
    fireEvent.click(within(region).getByRole('button', { name: '끄기' }))
    const dialog = screen.getByRole('dialog', { name: '틱톡 연결 끄기' })
    expect(within(dialog).getByText('끄면 틱톡 댓글을 바로 그만 받아요. 끌까요?')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '끄기' }))
    await within(region).findByRole('button', { name: '켜기' })
    expect(offs).toEqual([expect.objectContaining({ on: false })])
  })
})

describe('설정 — 인스타그램 (AC-67)', () => {
  it('설정 없음이면 서버 문장만', async () => {
    instagram = igConnection({ configured: false, status: 'NOT_CONNECTED', account: null })
    await openSettings('/settings/instagram')
    const region = screen.getByRole('region', { name: '인스타그램' })
    expect(within(region).getByText('인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.')).toBeDefined()
    expect(within(region).queryAllByRole('button')).toEqual([])
  })

  it('연결하기는 서버가 준 주소로 이동 · 돌아오면 결과 문장, 주소에서 결과를 지운다', async () => {
    instagram = igConnection({ status: 'NOT_CONNECTED', account: null })
    server.on('POST', /^\/api\/instagram\/connect$/, () => ({ body: { url: 'http://127.0.0.1:4103/dialog/oauth?x=1' } }))
    await openSettings('/settings/instagram')
    const region = screen.getByRole('region', { name: '인스타그램' })
    fireEvent.click(within(region).getByRole('button', { name: '인스타그램 연결하기' }))
    await waitFor(() => expect(assigned).toEqual(['http://127.0.0.1:4103/dialog/oauth?x=1']))
    cleanup()
    instagram = igConnection()
    await openSettings('/?instagram=CONNECTED')
    const back = screen.getByRole('region', { name: '인스타그램' })
    expect(within(back).getByText('인스타그램 계정을 연결했어요.')).toBeDefined()
    expect(within(back).getByText('연결됨 — @shop_ig')).toBeDefined()
    expect(window.location.pathname + window.location.search).toBe('/settings/instagram')
  })

  it('감사 DM 자동 발송: 켜기는 설명 창의 "동의해요", 권한이 없으면 서버 주소로 · 끄기는 바로 · 연결 끊기는 확인 창', async () => {
    const consents: unknown[] = []
    server.on('POST', /^\/api\/instagram\/consent$/, (call) => {
      consents.push(call.body?.on)
      if (call.body?.on === true) return { body: { permissionRequired: true, url: 'http://127.0.0.1:4103/dialog/oauth?perm=1', connection: instagram } }
      instagram = igConnection({ consent: { on: false, by: null, at: null } })
      return { body: { permissionRequired: false, connection: instagram } }
    })
    server.on('POST', /^\/api\/instagram\/disconnect$/, () => {
      instagram = igConnection({ status: 'NOT_CONNECTED', account: null })
      return { body: { connection: instagram } }
    })
    await openSettings('/settings/instagram')
    const region = screen.getByRole('region', { name: '인스타그램' })
    fireEvent.click(within(region).getByRole('button', { name: '감사 DM 자동 발송 켜기' }))
    const dialog = screen.getByRole('dialog', { name: '감사 DM 자동 발송' })
    expect(within(dialog).getByText('동의한 뒤에 확정된 판매부터 DM을 보내고, 그 전 판매는 보내지 않아요.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '동의해요' }))
    await waitFor(() => expect(assigned).toEqual(['http://127.0.0.1:4103/dialog/oauth?perm=1']))
    act(() => FakeEventSource.last.emit('instagram', { kind: 'CONNECTION', connection: igConnection({ consent: { on: true, by: 'shop1', at: '2026-10-19T01:00:00.000Z' } }) }))
    fireEvent.click(await within(region).findByRole('button', { name: '감사 DM 자동 발송 끄기' }))
    await within(region).findByRole('button', { name: '감사 DM 자동 발송 켜기' })
    expect(consents).toEqual([true, false])
    fireEvent.click(within(region).getByRole('button', { name: '연결 끊기' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '인스타그램 연결 끊기' })).getByRole('button', { name: '끊기' }))
    await within(region).findByText('연결된 인스타그램 계정이 없어요.')
  })
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={navigate} />)
  await screen.findByLabelText('빠른 입력')
  await flush(15)
}
const igPanel = () => screen.getByRole('region', { name: '인스타그램' })
const ttPanel = () => screen.getByRole('region', { name: '틱톡' })

describe('콘솔 — 플랫폼 칸 (AC-60·61)', () => {
  it('리허설: 인스타그램·틱톡 칸 대신 한 줄, 인스타그램·틱톡 요청을 보내지 않는다', async () => {
    rehearsal = true
    await openConsole()
    expect(screen.getByRole('region', { name: '인스타그램·틱톡' }).textContent).toContain('리허설 방송에는 라이브를 이을 수 없어요.')
    expect(screen.queryByRole('region', { name: '틱톡' })).toBeNull()
    expect(server.calls.filter((call) => /instagram|tiktok|platforms|\/live/.test(call.path))).toEqual([])
  })

  it('둘 이상 이으면 도착순 안내, 하나면 없다 — SSE로 바뀐다', async () => {
    ttLink = ttLinked()
    await openConsole()
    expect(screen.queryByText(MULTI_PLATFORM_NOTICE)).toBeNull()
    act(() => FakeEventSource.last.emit('instagram', { kind: 'LINK', broadcast: 'b1', link: igLinked() }))
    expect(screen.getByText(MULTI_PLATFORM_NOTICE)).toBeDefined()
    // 다른 방송의 알림은 이 콘솔을 바꾸지 않는다
    act(() => FakeEventSource.last.emit('instagram', { kind: 'LINK', broadcast: 'b2', link: { ...igNone, broadcast: 'b2' } }))
    expect(screen.getByText(MULTI_PLATFORM_NOTICE)).toBeDefined()
    act(() => FakeEventSource.last.emit('tiktok', { kind: 'LINK', broadcast: 'b1', link: ttNone }))
    expect(screen.queryByText(MULTI_PLATFORM_NOTICE)).toBeNull()
  })
})

describe('콘솔 — 틱톡 칸 (AC-62)', () => {
  it('동의 없음·아이디 없음·운영자 꺼짐: 서버 문장 + "설정으로"만', async () => {
    tiktok = tiktokSettings()
    await openConsole()
    expect(within(ttPanel()).getByText(TIKTOK_NO_CONSENT)).toBeDefined()
    expect(within(ttPanel()).getByRole('link', { name: '설정으로' }).getAttribute('href')).toBe('/settings/tiktok')
    expect(within(ttPanel()).queryAllByRole('button')).toEqual([])
    fireEvent.click(within(ttPanel()).getByRole('link', { name: '설정으로' }))
    expect(navigate).toHaveBeenCalledWith({ name: 'settings', section: 'tiktok' })
  })

  it('운영자 꺼짐은 플랫폼 능력의 이유 문장', async () => {
    tiktok = tiktokSettings({ operator: false })
    capabilities[2] = { ...capabilities[2]!, ready: false, reasons: { ready: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.' } }
    try {
      await openConsole()
      expect(within(ttPanel()).getByText('지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.')).toBeDefined()
    } finally {
      capabilities[2] = { ...capabilities[2]!, ready: true, reasons: {} }
    }
  })

  it('준비되면 내 아이디 + "틱톡 잇기" → 플랫폼 TIKTOK·요청 번호로 잇는다, 거절은 서버 문장', async () => {
    let attempt = 0
    const bodies: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/broadcasts\/b1\/live\/link$/, (call) => {
      bodies.push(call.body ?? {})
      attempt++
      if (attempt === 1) return apiError(409, 'TIKTOK_IN_USE', '이미 다른 방송에 틱톡이 이어져 있어요. 먼저 그 방송의 틱톡 연결을 끊어 주세요.')
      return { body: { link: ttLinked({ state: 'CONNECTING', message: '틱톡에 연결하는 중이에요.' }) } }
    })
    await openConsole()
    expect(within(ttPanel()).getByText('내 틱톡 아이디: @myshop')).toBeDefined()
    fireEvent.click(within(ttPanel()).getByRole('button', { name: '틱톡 잇기' }))
    expect(await within(ttPanel()).findByText('이미 다른 방송에 틱톡이 이어져 있어요. 먼저 그 방송의 틱톡 연결을 끊어 주세요.')).toBeDefined()
    fireEvent.click(within(ttPanel()).getByRole('button', { name: '틱톡 잇기' }))
    expect(await within(ttPanel()).findByText('틱톡에 연결하는 중이에요.')).toBeDefined()
    expect(bodies.map((body) => body.platform)).toEqual(['TIKTOK', 'TIKTOK'])
    expect(bodies.every((body) => typeof body.requestId === 'string' && !('liveId' in body))).toBe(true)
  })

  it('이어짐: 상태 문장·받은 수, 막힘이면 알림 줄 + 주 단추 "댓글 붙여넣기"(하나), 다시 연결 TOO_SOON, 끊기 확인 창', async () => {
    ttLink = ttLinked()
    server.on('POST', /^\/api\/broadcasts\/b1\/tiktok\/reconnect$/, () => apiError(409, 'TOO_SOON', '잠시 뒤 다시 눌러 주세요.'))
    const unlinks: Record<string, unknown>[] = []
    server.on('POST', /^\/api\/broadcasts\/b1\/live\/unlink$/, (call) => {
      unlinks.push(call.body ?? {})
      return { body: { link: ttNone } }
    })
    await openConsole()
    expect(within(ttPanel()).getByText('틱톡 댓글을 받고 있어요.')).toBeDefined()
    expect(within(ttPanel()).getByText('받은 댓글 7개')).toBeDefined()
    expect(within(ttPanel()).queryByRole('button', { name: '다시 연결' })).toBeNull()
    expect(screen.queryByRole('button', { name: TIKTOK_PASTE_ALERT })).toBeNull()
    expect(within(ttPanel()).getByRole('button', { name: '댓글 붙여넣기' }).className).not.toContain('button-primary')
    act(() =>
      FakeEventSource.last.emit('tiktok', {
        kind: 'LINK',
        broadcast: 'b1',
        link: ttLinked({ state: 'RETRYING', reason: 'BLOCKED', message: '틱톡이 연결을 막았어요.', missed: true, missedMessage: '끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.' }),
      }),
    )
    expect(within(ttPanel()).getByText('틱톡이 연결을 막았어요.')).toBeDefined()
    expect(within(ttPanel()).getByText('끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.')).toBeDefined()
    expect(within(ttPanel()).getByRole('button', { name: '댓글 붙여넣기' }).className).toContain('button-primary')
    expect(document.querySelectorAll('.button-primary').length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: TIKTOK_PASTE_ALERT }))
    const paste = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.click(within(paste).getByRole('button', { name: '닫기' }))
    fireEvent.click(within(ttPanel()).getByRole('button', { name: '다시 연결' }))
    expect(await within(ttPanel()).findByText('잠시 뒤 다시 눌러 주세요.')).toBeDefined()
    // 상태가 바뀌면 앞선 조작 오류는 지운다 (UX-N2b-2-03)
    act(() => FakeEventSource.last.emit('tiktok', { kind: 'LINK', broadcast: 'b1', link: ttLinked({ state: 'RETRYING', reason: 'NETWORK', message: '틱톡 연결이 끊겨 다시 연결하는 중이에요.' }) }))
    expect(within(ttPanel()).queryByText('잠시 뒤 다시 눌러 주세요.')).toBeNull()
    fireEvent.click(within(ttPanel()).getByRole('button', { name: '다시 연결' }))
    expect(await within(ttPanel()).findByText('잠시 뒤 다시 눌러 주세요.')).toBeDefined()
    fireEvent.click(within(ttPanel()).getByRole('button', { name: '끊기' }))
    const dialog = screen.getByRole('dialog', { name: '틱톡 연결 끊기' })
    expect(within(dialog).getByText('끊으면 이 방송의 틱톡 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.')).toBeDefined()
    // 끊기 확인 창에는 앞선 "다시 연결" 오류가 따라오지 않는다 (UX-N2b-2-03)
    expect(within(dialog).queryByText('잠시 뒤 다시 눌러 주세요.')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '끊기' }))
    await within(ttPanel()).findByRole('button', { name: '틱톡 잇기' })
    expect(unlinks).toEqual([expect.objectContaining({ platform: 'TIKTOK' })])
    expect(screen.queryByRole('button', { name: TIKTOK_PASTE_ALERT })).toBeNull()
  })

  it('저절로 다시 붙음(CONNECTED + missed): 알림 줄·주 단추 없이 칸에 경고 문장만 (SA-N2b-2-006·TE-N2b-2-004)', async () => {
    ttLink = ttLinked({ missed: true, missedMessage: '끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.' })
    await openConsole()
    expect(within(ttPanel()).getByText('끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.')).toBeDefined()
    expect(screen.queryByRole('button', { name: TIKTOK_PASTE_ALERT })).toBeNull()
    expect(within(ttPanel()).getByRole('button', { name: '댓글 붙여넣기' }).className).not.toContain('button-primary')
  })

  it('받는 중에 저장하지 못한 댓글(CONNECTED + saveFailed): 알림 줄 + 주 단추 "댓글 붙여넣기" (SA-N2b-2-009·TE-N2b-2-007)', async () => {
    ttLink = ttLinked({ saveFailed: 3, missed: true, missedMessage: '저장하지 못한 틱톡 댓글이 3개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.' })
    await openConsole()
    expect(within(ttPanel()).getByText('저장하지 못한 틱톡 댓글이 3개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.')).toBeDefined()
    expect(screen.getByRole('button', { name: TIKTOK_PASTE_ALERT })).toBeDefined()
    expect(within(ttPanel()).getByRole('button', { name: '댓글 붙여넣기' }).className).toContain('button-primary')
  })

  it('늦게 도착한 잇기 응답은 그사이 SSE로 온 새 상태를 덮지 않는다 — 서버 상태를 다시 받는다 (TE-N2b-2-003)', async () => {
    tiktok = tiktokSettings({ consent: consentOn, tiktokId: 'myshop' })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.on('POST', /^\/api\/broadcasts\/b1\/live\/link$/, async () => {
      await held
      return { body: { link: ttLinked({ state: 'CONNECTING', message: '틱톡에 연결하는 중이에요.' }) } }
    })
    await openConsole()
    fireEvent.click(await within(ttPanel()).findByRole('button', { name: '틱톡 잇기' }))
    ttLink = ttLinked()
    act(() => FakeEventSource.last.emit('tiktok', { kind: 'LINK', broadcast: 'b1', link: ttLinked() }))
    expect(within(ttPanel()).getByText('틱톡 댓글을 받고 있어요.')).toBeDefined()
    await act(async () => {
      release?.()
      await held
    })
    await waitFor(() => expect(server.calls.filter((call) => call.method === 'GET' && call.path === '/api/broadcasts/b1/tiktok').length).toBeGreaterThan(1))
    await waitFor(() => expect(within(ttPanel()).getByText('틱톡 댓글을 받고 있어요.')).toBeDefined())
    expect(within(ttPanel()).queryByText('틱톡에 연결하는 중이에요.')).toBeNull()
  })

  it('끝난 방송: 잇기·다시 연결 없음', async () => {
    ended = true
    await openConsole()
    expect(within(ttPanel()).getByText('이은 틱톡 라이브가 없어요.')).toBeDefined()
    expect(within(ttPanel()).queryByRole('button', { name: '틱톡 잇기' })).toBeNull()
  })
})

describe('콘솔 — 인스타그램 칸 (AC-63)', () => {
  it('설정 없음·연결 없음·다시 연결 필요: 문장 + "설정으로"', async () => {
    instagram = igConnection({ status: 'RECONNECT_NEEDED' })
    await openConsole()
    expect(within(igPanel()).getByText('인스타그램 연결을 다시 해 주세요.')).toBeDefined()
    expect(within(igPanel()).getByRole('link', { name: '설정으로' }).getAttribute('href')).toBe('/settings/instagram')
  })

  it('기다리기·라이브 고르기 → 잇기, 이어지면 수·늦게 받은 수·옮긴 문장·DM 실패 수·알림, 끊기 확인 창', async () => {
    dmRows = [
      { id: 1, broadcast: 'b1', status: 'FAILED', reason: 'GAVE_UP' },
      { id: 2, broadcast: 'b1', status: 'FAILED', reason: 'LIVE_ENDED' },
      { id: 3, broadcast: 'b1', status: 'SENT', reason: null },
    ]
    const posts: { path: string; body: Record<string, unknown> }[] = []
    server
      .on('POST', /^\/api\/broadcasts\/b1\/live\/wait$/, (call) => {
        posts.push({ path: call.path, body: call.body ?? {} })
        return { body: { link: { ...igLinked(), state: 'WAITING', liveId: null, collection: { ...igLinked().collection!, state: 'WAITING', message: '인스타그램 라이브를 기다리는 중이에요. 라이브를 시작하면 첫 댓글부터 받아요.' } } } }
      })
      .on('GET', /^\/api\/instagram\/lives$/, () => ({ body: { lives: [{ id: '1790000001', startedAt: '2026-10-19T10:00:00.000Z', broadcast: null }, { id: '1790000002', startedAt: null, broadcast: 'b9' }] } }))
      .on('POST', /^\/api\/broadcasts\/b1\/live\/link$/, (call) => {
        posts.push({ path: call.path, body: call.body ?? {} })
        return { body: { link: igLinked({ moved: { fromLiveId: '1', movedAt: '2026-10-19T10:00:00.000Z', comments: 3, message: '인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요.' } }) } }
      })
      .on('POST', /^\/api\/broadcasts\/b1\/live\/unlink$/, (call) => {
        posts.push({ path: call.path, body: call.body ?? {} })
        return { body: { link: igNone } }
      })
    await openConsole()
    expect(within(igPanel()).getByText('감사 DM 2건을 보내지 못했어요. 인스타그램 앱에서 직접 보내 주세요.')).toBeDefined()
    fireEvent.click(within(igPanel()).getByRole('button', { name: '인스타그램 기다리기' }))
    expect(await within(igPanel()).findByText('인스타그램 라이브를 기다리는 중이에요. 라이브를 시작하면 첫 댓글부터 받아요.')).toBeDefined()
    // 서버에서 끊긴 것으로 바뀐다
    act(() => FakeEventSource.last.emit('instagram', { kind: 'LINK', broadcast: 'b1', link: igNone }))
    fireEvent.click(within(igPanel()).getByRole('button', { name: '진행 중인 라이브 고르기' }))
    const list = await within(igPanel()).findByRole('list', { name: '진행 중인 인스타그램 라이브' })
    const buttons = within(list).getAllByRole('button', { name: '이 라이브 잇기' }) as HTMLButtonElement[]
    expect(buttons.map((button) => button.disabled)).toEqual([false, true])
    expect(list.textContent).toContain('다른 방송에 이어져 있어요')
    fireEvent.click(buttons[0]!)
    expect(await within(igPanel()).findByText('받은 댓글 12개')).toBeDefined()
    expect(within(igPanel()).getByText('늦게 받은 댓글 2개')).toBeDefined()
    expect(within(igPanel()).getByText('인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요.')).toBeDefined()
    // 알림은 알림 띠 맨 앞에 문장 그대로(누르면 칸의 알림 목록으로), 칸에서 닫을 수 있다 — 고정 영역에 줄을 더하지 않는다 (TE-N2b-2-001)
    act(() => FakeEventSource.last.emit('instagram', { kind: 'NOTICE', code: 'UNLINKED_COMMENTS', message: '이어지지 않은 인스타그램 라이브에서 댓글 4개가 왔어요.', liveId: 'x', count: 4 }))
    const strip = screen.getByRole('region', { name: '알림' })
    fireEvent.click(within(strip).getByRole('button', { name: '이어지지 않은 인스타그램 라이브에서 댓글 4개가 왔어요.' }))
    expect(document.activeElement).toBe(within(igPanel()).getByRole('list', { name: '인스타그램 알림' }))
    expect(document.querySelector('.platform-alerts')).toBeNull()
    const close = within(igPanel()).getByRole('button', { name: '인스타그램 알림 닫기' })
    expect(close.parentElement?.textContent).toContain('이어지지 않은 인스타그램 라이브에서 댓글 4개가 왔어요.')
    fireEvent.click(close)
    expect(screen.queryByRole('button', { name: '인스타그램 알림 닫기' })).toBeNull()
    expect(within(strip).queryByRole('button', { name: '이어지지 않은 인스타그램 라이브에서 댓글 4개가 왔어요.' })).toBeNull()
    // DM 알림 → 다시 센다
    dmRows = [...dmRows, { id: 4, broadcast: 'b1', status: 'FAILED', reason: 'EXPIRED' }]
    act(() => FakeEventSource.last.emit('instagram', { kind: 'DM', date: DATE, rows: [] }))
    expect(await within(igPanel()).findByText('감사 DM 3건을 보내지 못했어요. 인스타그램 앱에서 직접 보내 주세요.')).toBeDefined()
    fireEvent.click(within(igPanel()).getByRole('button', { name: '끊기' }))
    const dialog = screen.getByRole('dialog', { name: '인스타그램 연결 끊기' })
    expect(within(dialog).getByText('끊으면 이 방송의 인스타그램 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '끊기' }))
    await within(igPanel()).findByRole('button', { name: '인스타그램 기다리기' })
    expect(posts.map((post) => [post.path.split('/').at(-1), post.body.platform, post.body.liveId])).toEqual([
      ['wait', 'INSTAGRAM', undefined],
      ['link', 'INSTAGRAM', '1790000001'],
      ['unlink', 'INSTAGRAM', undefined],
    ])
  })
})

describe('콘솔 — 인스타그램 늦은 응답 (TE-N2b-2-003)', () => {
  it('기다리기 응답보다 SSE가 먼저 오면 응답을 버리고 서버 상태를 다시 받는다', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.on('POST', /^\/api\/broadcasts\/b1\/live\/wait$/, async () => {
      await held
      return { body: { link: { ...igLinked(), state: 'WAITING', liveId: null, collection: { ...igLinked().collection!, state: 'WAITING', message: '인스타그램 라이브를 기다리는 중이에요.' } } } }
    })
    await openConsole()
    fireEvent.click(await within(igPanel()).findByRole('button', { name: '인스타그램 기다리기' }))
    igLink = igLinked()
    act(() => FakeEventSource.last.emit('instagram', { kind: 'LINK', broadcast: 'b1', link: igLinked() }))
    expect(within(igPanel()).getByText('댓글을 받는 중')).toBeDefined()
    await act(async () => {
      release?.()
      await held
    })
    await waitFor(() => expect(server.calls.filter((call) => call.method === 'GET' && call.path === '/api/broadcasts/b1/live').length).toBeGreaterThan(1))
    await waitFor(() => expect(within(igPanel()).getByText('댓글을 받는 중')).toBeDefined())
    expect(within(igPanel()).queryByText('인스타그램 라이브를 기다리는 중이에요.')).toBeNull()
  })
})

describe('콘솔 — 채팅 플랫폼 글자 (AC-65)', () => {
  it('유튜브만이면 글자 없음, 틱톡 채팅이 있으면 모든 줄에 — 닉네임은 글자로만', async () => {
    messages = [message(1, { channel: 'UC_A', nick: '유튜브사람', text: '15' })]
    await openConsole()
    const chat = screen.getByRole('region', { name: '채팅' })
    expect(within(chat).queryByText('유튜브')).toBeNull()
    cleanup()
    messages = [message(1, { channel: 'UC_A', nick: '유튜브사람', text: '15' }), message(2, { id: 'tt:m2', channel: 'tt:7001', nick: '<img src=x onerror=alert(1)>', text: '16' })]
    await openConsole()
    const chat2 = screen.getByRole('region', { name: '채팅' })
    expect(within(chat2).getByText('유튜브')).toBeDefined()
    expect(within(chat2).getByText('틱톡')).toBeDefined()
    expect(within(chat2).getByText('<img src=x onerror=alert(1)>')).toBeDefined()
    expect(chat2.querySelector('img')).toBeNull()
  })
})

describe('붙여넣기 창 (AC-64)', () => {
  const plan = {
    rows: [
      { line: 1, nickname: '철수', text: '15', result: 'ORDER', numbers: [15], message: '15번 찜' },
      { line: 2, nickname: '철수', text: '16', result: 'ORDER', numbers: [16], message: '16번 찜' },
      { line: 3, nickname: '<img src=x onerror=alert(1)>', text: '17', result: 'ORDER', numbers: [17], message: '17번 찜' },
      { line: 4, result: 'NO_NICKNAME', numbers: [], message: "'닉네임: 댓글' 모양이 아니에요." },
    ],
    groups: [
      { nickname: '철수', lines: [1, 2], claims: 2, message: '같은 닉네임 2줄은 한 구매자로 넣어요' },
      { nickname: '<img src=x onerror=alert(1)>', lines: [3], claims: 1, message: null },
    ],
    total: 3,
  }

  it('미리 보기 → 줄 결과·같은 닉네임 묶음·"찜 3개 넣기", 글을 고치면 다시 미리 보기, 넣기는 같은 요청 번호로 다시 보낸다', async () => {
    const previews: unknown[] = []
    const inserts: Record<string, unknown>[] = []
    let failures = 2
    server
      .on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, (call) => {
        previews.push(call.body?.text)
        return { body: plan }
      })
      .on('POST', /^\/api\/broadcasts\/b1\/paste$/, (call): Reply => {
        inserts.push(call.body ?? {})
        if (failures > 0) {
          failures--
          return { network: true }
        }
        return { body: { ...plan, added: 3 } }
      })
    const done = vi.fn()
    render(<PasteDialog broadcastId="b1" onClose={() => {}} onDone={done} />)
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    expect(within(dialog).getByText("틱톡 화면의 댓글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요.")).toBeDefined()
    const area = within(dialog).getByLabelText('붙여 넣을 댓글')
    expect(document.activeElement).toBe(area)
    const insert = () => within(dialog).getByRole('button', { name: /^찜 \d+개 넣기$|넣는 중/ }) as HTMLButtonElement
    expect(insert().disabled).toBe(true)
    fireEvent.change(area, { target: { value: '철수: 15\n철수: 16' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    await within(dialog).findByText('같은 닉네임 2줄은 한 구매자로 넣어요', { exact: false })
    expect(within(dialog).getByText('<img src=x onerror=alert(1)>', { selector: '.paste-nick' })).toBeDefined()
    expect(dialog.querySelector('img')).toBeNull()
    expect(within(dialog).getByRole('list', { name: '줄마다 결과' }).textContent).toContain("4줄 '닉네임: 댓글' 모양이 아니에요.")
    expect(insert().textContent).toBe('찜 3개 넣기')
    expect(insert().disabled).toBe(false)
    // 글을 고치면 넣을 수 없다
    fireEvent.change(area, { target: { value: '철수: 15\n철수: 16\n' } })
    expect(insert().disabled).toBe(true)
    expect(within(dialog).getByText('글을 고쳤어요. 미리 보기를 다시 해 주세요.')).toBeDefined()
    fireEvent.change(area, { target: { value: '철수: 15\n철수: 16' } })
    expect(insert().disabled).toBe(false)
    fireEvent.click(insert())
    expect(insert().disabled).toBe(true)
    fireEvent.click(insert())
    await waitFor(() => expect(done).toHaveBeenCalledWith('찜 3개를 넣었어요.'), { timeout: 5000 })
    expect(inserts).toHaveLength(3)
    expect(new Set(inserts.map((body) => body.requestId)).size).toBe(1)
    expect(inserts[0]?.text).toBe('철수: 15\n철수: 16')
    expect(previews).toEqual(['철수: 15\n철수: 16'])
  })

  it('키보드: 미리 보기 뒤 포커스는 "찜 N개 넣기"(닫기로 빠지지 않는다), Ctrl+Enter로 미리 보기·넣기, 닫았다 열어도 글이 남는다 (UX-N2b-2-01)', async () => {
    const inserts: unknown[] = []
    server
      .on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, () => ({ body: plan }))
      .on('POST', /^\/api\/broadcasts\/b1\/paste$/, (call) => {
        inserts.push(call.body)
        return { body: { ...plan, added: 3 } }
      })
    const done = vi.fn()
    let draft = ''
    const view = render(<PasteDialog broadcastId="b1" draft={draft} onDraftChange={(text) => (draft = text)} onClose={() => {}} onDone={done} />)
    let dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣을 댓글'), { target: { value: '철수: 15' } })
    const previewButton = within(dialog).getByRole('button', { name: '미리 보기' }) as HTMLButtonElement
    fireEvent.click(previewButton)
    // 보는 동안 잠그지 않고 aria-busy (포커스가 창 밖으로 빠지지 않게)
    expect(previewButton.disabled).toBe(false)
    expect(previewButton.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('찜 3개 넣기'))
    // 닫았다 다시 열어도 글이 남는다
    view.unmount()
    expect(draft).toBe('철수: 15')
    render(<PasteDialog broadcastId="b1" draft={draft} onDraftChange={(text) => (draft = text)} onClose={() => {}} onDone={done} />)
    dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    const area = within(dialog).getByLabelText('붙여 넣을 댓글') as HTMLTextAreaElement
    expect(area.value).toBe('철수: 15')
    // Ctrl+Enter: 미리 보기 → 넣기
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true })
    await within(dialog).findByRole('button', { name: '찜 3개 넣기' })
    await waitFor(() => expect((within(dialog).getByRole('button', { name: '찜 3개 넣기' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(done).toHaveBeenCalledWith('찜 3개를 넣었어요.'))
    expect(inserts).toHaveLength(1)
    // 그냥 Enter는 줄 바꿈 (보내지 않는다)
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(inserts).toHaveLength(1)
  })

  it('겹친 줄: 서버 문장 그대로 + "그래도 넣기"(기본 꺼짐), N은 고르면 늘고, includeOverlaps로 보내며 보낸 뒤 고르기 잠금·재전송은 같은 고르기, 끝 안내에 빠진 수 (AC-N2b-2-69)', async () => {
    const overlapPlan = {
      rows: [
        { line: 1, nickname: '홍길동', text: '15 28', result: 'ORDER', numbers: [15, 28], message: '15번·28번 찜', overlaps: [15], overlapMessage: '15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.' },
        { line: 2, nickname: '김철수', text: '16', result: 'ORDER', numbers: [16], message: '16번 찜' },
      ],
      groups: [],
      total: 2,
    }
    const inserts: Record<string, unknown>[] = []
    let failures = 1
    server
      .on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, () => ({ body: overlapPlan }))
      .on('POST', /^\/api\/broadcasts\/b1\/paste$/, (call): Reply => {
        inserts.push(call.body ?? {})
        if (failures > 0) {
          failures--
          return { network: true }
        }
        // 그 사이 김철수 16도 겹쳐 빠졌다 — 고른 1줄은 겹침 없음
        return {
          body: {
            rows: [
              { ...overlapPlan.rows[0], overlaps: undefined, overlapMessage: undefined },
              { ...overlapPlan.rows[1], overlaps: [16], overlapMessage: '16번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.' },
            ],
            groups: [],
            total: 2,
            added: 2,
          },
        }
      })
    const done = vi.fn()
    render(<PasteDialog broadcastId="b1" onClose={() => {}} onDone={done} />)
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣을 댓글'), { target: { value: '홍길동: 15 28\n김철수: 16' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    const first = within((await within(dialog).findByRole('list', { name: '줄마다 결과' })).querySelectorAll('li')[0] as HTMLElement)
    expect(await first.findByText('15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.')).toBeDefined()
    const anyway = first.getByRole('checkbox', { name: '그래도 넣기' }) as HTMLInputElement
    expect(anyway.checked).toBe(false)
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: '찜 2개 넣기' })).toBeDefined()
    fireEvent.click(anyway)
    expect(within(dialog).getByText('넣을 찜 3개')).toBeDefined()
    const insert = within(dialog).getByRole('button', { name: '찜 3개 넣기' }) as HTMLButtonElement
    fireEvent.click(insert)
    // 처음 넣기를 누른 뒤에는 고르기를 바꿀 수 없다
    expect((first.getByRole('checkbox', { name: '그래도 넣기' }) as HTMLInputElement).disabled).toBe(true)
    await waitFor(() => expect(done).toHaveBeenCalledWith('찜 2개를 넣었어요. 이미 있는 찜 1개는 넣지 않았어요.'), { timeout: 5000 })
    expect(inserts).toHaveLength(2)
    expect(inserts.map((body) => body.includeOverlaps)).toEqual([[1], [1]])
    expect(new Set(inserts.map((body) => body.requestId)).size).toBe(1)
  })

  it('겹침만 남아 넣을 찜이 0개면 "그래도 넣기"를 골라야 넣을 수 있다 (AC-N2b-2-69)', async () => {
    server.on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, () => ({
      body: { rows: [{ line: 1, nickname: '홍길동', text: '15', result: 'ORDER', numbers: [15], message: '15번 찜', overlaps: [15], overlapMessage: '15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.' }], groups: [], total: 0 },
    }))
    render(<PasteDialog broadcastId="b1" onClose={() => {}} onDone={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣을 댓글'), { target: { value: '홍길동: 15' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    const anyway = (await within(dialog).findByRole('checkbox', { name: '그래도 넣기' })) as HTMLInputElement
    expect((within(dialog).getByRole('button', { name: '찜 0개 넣기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(anyway)
    expect((within(dialog).getByRole('button', { name: '찜 1개 넣기' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('전체 거절·넣을 찜 없음은 서버 문장', async () => {
    server.on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, () => apiError(400, 'TOO_MANY_LINES', '한 번에 200줄까지 붙여 넣을 수 있어요.'))
    render(<PasteDialog broadcastId="b1" onClose={() => {}} onDone={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣을 댓글'), { target: { value: 'a: 1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    expect(await within(dialog).findByText('한 번에 200줄까지 붙여 넣을 수 있어요.')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '찜 0개 넣기' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('문자찜 화면의 붙여넣기 (AC-64, 보조자 AC-N2b-2-80 7)', () => {
  it('보조자도 고른 실제 방송에 "댓글 붙여넣기" → 같은 창, 넣으면 문장', async () => {
    server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'bo-1', role: 'ASSISTANT', assistant: { name: '도우미' } } }))
      .on('POST', /^\/api\/broadcasts\/b1\/paste\/preview$/, () => ({ body: { rows: [{ line: 1, nickname: '철수', text: '15', result: 'ORDER', numbers: [15], message: '15번 찜' }], groups: [{ nickname: '철수', lines: [1], claims: 1, message: null }], total: 1 } }))
      .on('POST', /^\/api\/broadcasts\/b1\/paste$/, () => ({ body: { rows: [], groups: [], total: 1, added: 1 } }))
    window.history.replaceState(null, '', '/sms')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '댓글 붙여넣기' }))
    const dialog = screen.getByRole('dialog', { name: '댓글 붙여넣기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣을 댓글'), { target: { value: '철수: 15' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '찜 1개 넣기' }))
    expect(await screen.findByText('찜 1개를 넣었어요.')).toBeDefined()
    expect(screen.queryByRole('dialog', { name: '댓글 붙여넣기' })).toBeNull()
    // 보조자 화면은 인스타그램·틱톡 설정 요청을 보내지 않는다
    expect(server.calls.filter((call) => /\/api\/(tiktok|instagram|platforms)/.test(call.path))).toEqual([])
  })
})
