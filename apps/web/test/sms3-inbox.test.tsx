// 휴대폰 알림 받기 화면 (SMS3 AC-SMS3-28·30·31·32, D-SMS3-14). 가짜 서버로 설정 칸·콘솔 "문자 확인" 칸·받기 멈춤 알림·입금 확인 화면 은행 알림 줄을 그린다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { DepositView } from '../src/api/deposit-types.ts'
import type { BankAlertView, InboxCardView, InboxSettingsView } from '../src/api/inbox-types.ts'
import type { Claim } from '../src/api/types.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { DepositProvider } from '../src/components/deposit-context.tsx'
import { DepositsPage } from '../src/components/DepositsPage.tsx'
import { PhoneInboxSettings, useInboxSettings } from '../src/components/PhoneInboxSettings.tsx'
import {
  BANK_UNREADABLE,
  INBOX_CANCEL_NAME_ONLY,
  INBOX_FROM_SMS,
  INBOX_NAME_ONLY,
  INBOX_RENEW_QUESTION,
  INBOX_STALL,
  INBOX_STALL_MS,
  INBOX_SHORTCUT_STEPS,
  INBOX_TOKEN_ONCE,
  bankNoticeMeta,
  bankNoticeWords,
  cancelMatches,
  cancelNeedsBoard,
  closeStall,
  inboxClaimIds,
  inboxReasonWords,
  inboxSenderWords,
  inboxStalled,
  orderCards,
  parseInboxEvent,
  readInboxCards,
  shortcutStepParts,
  stallClosed,
} from '../src/lib/inbox.ts'
import type { Navigate } from '../src/lib/router.ts'
import { DATE, FakeEventSource, FakeServer, apiError, broadcastItem, broadcastView, connection, emptyChanges, flush, fullView, product, type Reply } from './support.ts'

let server: FakeServer
let navigate: Navigate
let inbox: InboxSettingsView
let cards: InboxCardView[]
let claimIds: string[]
let startedAt: string | null

const settingsView = (patch: Partial<InboxSettingsView> = {}): InboxSettingsView => ({ enabled: false, hasToken: false, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null, ...patch })

const card = (patch: Partial<InboxCardView> = {}): InboxCardView => ({
  id: 'c1',
  b: 'b1',
  kind: 'REVIEW',
  why: 'UNCLEAR',
  numbers: [15],
  memo: null,
  last4: '5678',
  sender: null,
  text: '15 있나요?',
  receivedAt: '2026-10-19T11:01:05.000Z',
  message: '번호는 있는데 확실하지 않아요',
  ...patch,
})

function setupConsole() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: fullView().broadcasts[0]?.settings ?? {} } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem()] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: fullView({ seq: 1, broadcasts: [broadcastView()], products: [product(15), product(16)] }) }))
    .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: 1, messages: [], more: false } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply => ({ body: emptyChanges(Number(match[1]), 1) }))
    .on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: connection({ status: 'NOT_CONNECTED', channel: null }) } }))
    .on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: null, collector: null } }))
    .on('GET', /^\/api\/platforms$/, () => ({ body: { platforms: [] } }))
    .on('GET', /^\/api\/inbox\/settings$/, () => ({ body: { inbox } }))
    .on('GET', /^\/api\/inbox\/cards\?b=b1$/, () => ({ body: { cards, inboxClaimIds: claimIds, startedAt } }))
}

beforeEach(() => {
  server = new FakeServer()
  navigate = vi.fn()
  inbox = settingsView()
  cards = []
  claimIds = []
  startedAt = null
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

// ── 낱말·순수 함수 ─────────────────────────────────────────────────────────

describe('낱말 (ORD-13 화면 문구, DP-8)', () => {
  it('확인 필요 사유·취소 요청 문장', () => {
    expect(inboxReasonWords(card({ why: 'UNCLEAR' }))).toBe('번호는 있는데 확실하지 않아요')
    expect(inboxReasonWords(card({ why: 'NO_NUMBER', last4: null }))).toBe('이름만 와서 누가 보냈는지 몰라요')
    expect(inboxReasonWords(card({ why: 'OPTIONS' }))).toBe('옵션 방송이라 직접 골라 주세요')
    expect(inboxReasonWords(card({ why: 'NOT_ON_SALE', numbers: [15] }))).toBe('15번은 지금 판매 중이 아니에요')
    expect(inboxReasonWords(card({ kind: 'CANCEL', why: null, numbers: [15] }))).toBe('15번 취소를 원해요')
    // 모르는 사유는 서버 문장
    expect(inboxReasonWords(card({ why: 'NEW_THING' as never, message: '새 사유예요' }))).toBe('새 사유예요')
  })

  it('보낸 사람: 뒤 4자리 또는 이름만', () => {
    expect(inboxSenderWords(card({ last4: '5678' }))).toBe('뒤 4자리 5678')
    expect(inboxSenderWords(card({ last4: null }))).toBe(INBOX_NAME_ONLY)
  })

  it('받은 순서(오래된 것 먼저, 새것 아래)', () => {
    const a = card({ id: 'a', receivedAt: '2026-10-19T11:02:00.000Z' })
    const b = card({ id: 'b', receivedAt: '2026-10-19T11:01:00.000Z' })
    const c = card({ id: 'c', receivedAt: '2026-10-19T11:02:00.000Z' })
    expect(orderCards([a, b, c]).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('은행 알림 줄 문장 (DP-8)', () => {
    const cancel: BankAlertView = { id: 1, kind: 'CANCEL', bank: 'SHINHAN', bankName: '신한', amount: 14000, name: '홍길동', at: null, receivedAt: '2026-10-31T11:05:00.000Z', message: '' }
    expect(bankNoticeWords(cancel)).toBe('입금 취소 알림이 왔어요: 14,000원 홍길동. 이 입금을 확인했다면 되돌려 주세요')
    expect(bankNoticeWords({ ...cancel, kind: 'UNREADABLE', amount: null, name: null })).toBe(BANK_UNREADABLE)
    expect(BANK_UNREADABLE).toBe('읽지 못한 은행 알림이에요. 은행 앱에서 확인하고 필요하면 정산에서 손으로 적어 주세요')
    expect(bankNoticeMeta(cancel)).toBe('신한 · 10/31 20:05:00')
  })

  it('입금 취소 알림과 같은 금액·같은 이름의 확인한 입금만 고른다 (이름 없으면 아무것도)', () => {
    const cancel: BankAlertView = { id: 1, kind: 'CANCEL', bank: 'KB', bankName: 'KB국민', amount: 14000, name: '홍 길동', at: null, receivedAt: '2026-10-31T11:05:00.000Z', message: '' }
    const deposits = [
      { no: 1, amount: 14000, name: '홍길동', applied: { date: DATE } },
      { no: 2, amount: 14000, name: '홍길동', applied: null },
      { no: 3, amount: 15000, name: '홍길동', applied: { date: DATE } },
      { no: 4, amount: 14000, name: '김영희', applied: { date: DATE } },
    ]
    expect(cancelMatches(cancel, deposits).map((deposit) => deposit.no)).toEqual([1])
    expect(cancelMatches({ ...cancel, name: null }, deposits)).toEqual([])
    expect(cancelMatches({ ...cancel, kind: 'UNREADABLE' }, deposits)).toEqual([])
  })

  it('실시간 알림 읽기', () => {
    expect(parseInboxEvent(JSON.stringify({ kind: 'cards', b: 'b1' }))).toEqual({ kind: 'cards', b: 'b1' })
    expect(parseInboxEvent(JSON.stringify({ kind: 'received', lastReceivedAt: '2026-10-19T11:00:00.000Z', lastDevice: null }))).toEqual({ kind: 'received', lastReceivedAt: '2026-10-19T11:00:00.000Z', lastDevice: null })
    expect(parseInboxEvent(JSON.stringify({ kind: 'settings' }))).toEqual({ kind: 'settings' })
    expect(parseInboxEvent(JSON.stringify({ kind: 'other' }))).toBeNull()
    expect(parseInboxEvent('{')).toBeNull()
  })

  it('"문자로 받음": 엔진 ref가 ibx_로 시작하는 문자찜만', () => {
    const ids = inboxClaimIds([
      { id: 'c1', origin: 'sms', ref: 'ibx_abc' } as never,
      { id: 'c2', origin: 'sms', ref: 'sms_1' } as never,
      { id: 'c3', origin: 'chat', ref: 'ibx_x' } as never,
      { id: 'c4', origin: 'sms' },
    ])
    expect([...ids]).toEqual(['c1'])
  })

  it('"문자로 받음": 서버 cards 응답의 inboxClaimIds에 있는 문자찜 (TE-SMS3-001 — 찜 보기에 ref가 없어도)', () => {
    const ids = inboxClaimIds(
      [
        { id: 'k1', origin: 'sms' },
        { id: 'k2', origin: 'sms' },
        { id: 'k3', origin: 'chat' },
      ],
      new Set(['k1', 'k3', 'k9']),
    )
    expect([...ids]).toEqual(['k1'])
  })

  it('cards 응답 읽기: 카드·찜 ID·방송 시작 시각, 모양이 다르면 빈 것', () => {
    const read = readInboxCards({ cards: [card()], inboxClaimIds: ['k1', 3, 'k2'], startedAt: '2026-10-19T11:00:00.000Z' })
    expect(read.cards).toHaveLength(1)
    expect([...read.claimIds]).toEqual(['k1', 'k2'])
    expect(read.startedAt).toBe('2026-10-19T11:00:00.000Z')
    const old = readInboxCards({ cards: [] })
    expect(old.claimIds.size).toBe(0)
    expect(old.startedAt).toBeNull()
    expect(readInboxCards({ cards: [], startedAt: '아님' }).startedAt).toBeNull()
  })

  it('이름만 온 문자의 취소 요청은 승인할 수 없다 (D-SMS3-19)', () => {
    expect(cancelNeedsBoard({ kind: 'CANCEL', last4: null })).toBe(true)
    expect(cancelNeedsBoard({ kind: 'CANCEL', last4: '5678' })).toBe(false)
    expect(cancelNeedsBoard({ kind: 'CANCEL', last4: '5678', approvable: false })).toBe(true)
    expect(cancelNeedsBoard({ kind: 'REVIEW', last4: null })).toBe(false)
    expect(INBOX_CANCEL_NAME_ONLY).toBe('이름만 와서 누가 보냈는지 몰라요. 보드에서 직접 취소해 주세요')
  })
})

describe('받기 멈춤 판단 (AC-SMS3-31)', () => {
  const start = Date.parse('2026-10-19T11:00:00.000Z')
  const live = { rehearsal: false, ended: false }
  const receiving = { enabled: true, lastReceivedAt: null, startedAt: '2026-10-19T11:00:00.000Z' }
  it('방송 시작 뒤 10분 넘게 받은 것이 없으면', () => {
    expect(inboxStalled(receiving, live, start + INBOX_STALL_MS)).toBe(false)
    expect(inboxStalled(receiving, live, start + INBOX_STALL_MS + 1)).toBe(true)
  })
  it('무엇이든 받으면 그때부터 다시 잰다 (방송 전에 받은 것은 세지 않는다)', () => {
    expect(inboxStalled({ ...receiving, lastReceivedAt: '2026-10-19T11:05:00.000Z' }, live, start + INBOX_STALL_MS + 1)).toBe(false)
    expect(inboxStalled({ ...receiving, lastReceivedAt: '2026-10-19T10:59:00.000Z' }, live, start + INBOX_STALL_MS + 1)).toBe(true)
  })
  it('꺼짐·리허설·끝난 방송·설정 모름이면 없음', () => {
    const late = start + 60 * 60 * 1000
    expect(inboxStalled({ ...receiving, enabled: false }, live, late)).toBe(false)
    expect(inboxStalled(receiving, { rehearsal: true, ended: false }, late)).toBe(false)
    expect(inboxStalled(receiving, { rehearsal: false, ended: true }, late)).toBe(false)
    expect(inboxStalled(null, live, late)).toBe(false)
  })
  it('닫으면 그 방송에서만 다시 안 보인다', () => {
    expect(stallClosed('b1')).toBe(false)
    closeStall('b1')
    expect(stallClosed('b1')).toBe(true)
    expect(stallClosed('b2')).toBe(false)
  })
})

// ── 설정 (AC-SMS3-28) ─────────────────────────────────────────────────────

function SettingsHarness() {
  const handle = useInboxSettings()
  return <PhoneInboxSettings handle={handle} />
}

describe('설정 "휴대폰 알림 받기" (AC-SMS3-28)', () => {
  beforeEach(() => {
    server.on('GET', /^\/api\/inbox\/settings$/, () => ({ body: { inbox } }))
  })

  it('켜고 토큰 만들기 → 토큰은 한 번만 보이고 "복사하기", 화면을 다시 열면 없다', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    server.on('POST', /^\/api\/inbox\/token$/, () => {
      inbox = settingsView({ enabled: true, hasToken: true, tokenCreatedAt: '2026-10-19T11:00:00.000Z' })
      return { body: { token: 'tok_SECRET_123', inbox } }
    })
    const view = render(<SettingsHarness />)
    fireEvent.click(await screen.findByRole('button', { name: '켜고 토큰 만들기' }))
    const token = await screen.findByLabelText('받기 토큰')
    expect((token as HTMLInputElement).value).toBe('tok_SECRET_123')
    expect(screen.getByText(`! ${INBOX_TOKEN_ONCE}`)).toBeDefined()
    expect(screen.getByText(/켜져 있어요/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '복사하기' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tok_SECRET_123'))
    expect(await screen.findByText('복사했어요. 휴대폰 앱이나 단축어에 붙여 넣어 주세요.')).toBeDefined()
    // 토큰 원문은 저장소에 남기지 않는다
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('tok_SECRET_123')
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('tok_SECRET_123')
    view.unmount()
    render(<SettingsHarness />)
    await screen.findByRole('button', { name: '토큰 다시 만들기' })
    expect(screen.queryByLabelText('받기 토큰')).toBeNull()
    expect(document.body.textContent).not.toContain('tok_SECRET_123')
  })

  it('다시 만들기는 확인 창("전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요")을 거친다', async () => {
    inbox = settingsView({ enabled: true, hasToken: true })
    server.on('POST', /^\/api\/inbox\/token$/, () => ({ body: { token: 'tok_NEW', inbox } }))
    render(<SettingsHarness />)
    fireEvent.click(await screen.findByRole('button', { name: '토큰 다시 만들기' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(INBOX_RENEW_QUESTION)).toBeDefined()
    expect(INBOX_RENEW_QUESTION.startsWith('전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요')).toBe(true)
    expect(server.callsTo('POST', /inbox\/token/)).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '새로 만들기' }))
    expect(((await screen.findByLabelText('받기 토큰')) as HTMLInputElement).value).toBe('tok_NEW')
    expect(server.callsTo('POST', /inbox\/token/)).toHaveLength(1)
  })

  it('마지막으로 받은 시각·기기 이름(이스케이프), 끄기·다시 켜기', async () => {
    inbox = settingsView({ enabled: true, hasToken: true, lastReceivedAt: '2026-10-19T11:01:00.000Z', lastDevice: '<b>김사장</b> 폰' })
    server.on('PUT', /^\/api\/inbox\/settings$/, (call) => {
      inbox = { ...inbox, enabled: call.body?.enabled === true }
      return { body: { inbox } }
    })
    render(<SettingsHarness />)
    expect(await screen.findByText('마지막으로 받은 시각 10월 19일 오후 8:01 · <b>김사장</b> 폰')).toBeDefined()
    expect(document.querySelector('b')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '끄기' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '끌게요' }))
    await screen.findByRole('button', { name: '다시 켜기' })
    expect(server.callsTo('PUT', /inbox\/settings/)[0]?.body).toEqual({ enabled: false })
    fireEvent.click(screen.getByRole('button', { name: '다시 켜기' }))
    await screen.findByRole('button', { name: '끄기' })
    expect(server.callsTo('PUT', /inbox\/settings/)[1]?.body).toEqual({ enabled: true })
  })

  it('아이폰 단축어 안내는 접어 두고 펼치면 받는 주소가 보인다', async () => {
    render(<SettingsHarness />)
    const toggle = await screen.findByRole('button', { name: /아이폰 단축어 만들기 안내/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/\/api\/inbox\/messages$/)).toBeDefined()
  })

  it('단축어 안내는 기기 입구 JSON 모양 그대로 칸 이름·값을 적고, 값은 코드 글꼴로 (SA-SMS3-004·D-SMS3-23)', async () => {
    const all = INBOX_SHORTCUT_STEPS.join('\n')
    for (const value of ['URL 콘텐츠 가져오기', '`POST`', '`Authorization`', '`Bearer`', '`JSON`', '`device`', '`messages`', '"사전"', '`id`', '`channel`', '`SMS`', '`from`', '`text`', '`receivedAt`']) expect(all).toContain(value)
    expect(all).not.toContain('문자 보내기')
    expect(shortcutStepParts('키는 `Authorization`, 값')).toEqual([
      { text: '키는 ', value: false },
      { text: 'Authorization', value: true },
      { text: ', 값', value: false },
    ])
    render(<SettingsHarness />)
    fireEvent.click(await screen.findByRole('button', { name: /아이폰 단축어 만들기 안내/ }))
    const codes = [...document.querySelectorAll('.inbox-shortcut code')].map((node) => node.textContent)
    expect(codes).toEqual(expect.arrayContaining(['POST', 'Authorization', 'JSON', 'device', 'messages', 'id', 'channel', 'SMS', 'from', 'text', 'receivedAt']))
    expect(document.querySelector('.inbox-shortcut')?.textContent).not.toContain('`')
  })
})

// ── 콘솔 (AC-SMS3-30·31) ──────────────────────────────────────────────────

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={navigate} />)
  await screen.findByRole('region', { name: '상품 보드' })
  await flush(15)
}

describe('콘솔 "문자 확인" 칸 (AC-SMS3-30)', () => {
  beforeEach(() => setupConsole())

  it('카드가 없으면 칸이 없다', async () => {
    await openConsole()
    expect(screen.queryByRole('region', { name: '문자 확인' })).toBeNull()
  })

  it('받은 순서·시각·뒤 4자리·본문(이스케이프)·사유·번호 단추, "15번에 넣기"는 요청 번호와 번호를 보낸다', async () => {
    cards = [
      card({ id: 'c2', receivedAt: '2026-10-19T11:03:00.000Z', text: '<img src=x onerror=alert(1)> 15 있나요?' }),
      card({ id: 'c1', kind: 'CANCEL', why: null, numbers: [16], receivedAt: '2026-10-19T11:01:05.000Z', text: '16 취소', message: '16번 취소를 원해요' }),
    ]
    server.on('POST', /^\/api\/inbox\/cards\/c2\/insert$/, () => {
      cards = cards.filter((item) => item.id !== 'c2')
      return { body: { ok: true, card: 'c2' } }
    })
    await openConsole()
    const panel = await screen.findByRole('region', { name: '문자 확인' })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('취소 요청')
    expect(items[0]?.textContent).toContain('오후 8:01:05')
    expect(items[0]?.textContent).toContain('16번 취소를 원해요')
    expect(items[1]?.textContent).toContain('뒤 4자리 5678')
    expect(items[1]?.textContent).toContain('번호는 있는데 확실하지 않아요')
    expect(within(items[1] as HTMLElement).getByText('<img src=x onerror=alert(1)> 15 있나요?')).toBeDefined()
    expect(panel.querySelector('img')).toBeNull()
    fireEvent.click(within(items[1] as HTMLElement).getByRole('button', { name: '15번에 넣기' }))
    await waitFor(() => expect(screen.getAllByRole('listitem').filter((item) => item.classList.contains('inbox-card'))).toHaveLength(1))
    const sent = server.callsTo('POST', /cards\/c2\/insert/)[0]?.body
    expect(sent).toEqual({ requestId: expect.any(String), no: 15 })
  })

  it('이름만 온 문자: "이름만 와서 누가 보냈는지 몰라요" 한 번, 연락처 이름', async () => {
    cards = [card({ why: 'NO_NUMBER', last4: null, sender: '홍길동', text: '15', message: '이름만 와서 누가 보냈는지 몰라요' })]
    await openConsole()
    const panel = await screen.findByRole('region', { name: '문자 확인' })
    expect(within(panel).getAllByText(INBOX_NAME_ONLY)).toHaveLength(1)
    expect(within(panel).getByText('연락처 이름: 홍길동')).toBeDefined()
  })

  it('취소 요청 승인 — 찜이 없으면 "취소할 찜이 없어요"', async () => {
    cards = [card({ kind: 'CANCEL', why: null, numbers: [15], text: '15 취소', message: '15번 취소를 원해요' })]
    server.on('POST', /^\/api\/inbox\/cards\/c1\/approve$/, () => apiError(409, 'NO_CLAIM', '취소할 찜이 없어요'))
    await openConsole()
    const panel = await screen.findByRole('region', { name: '문자 확인' })
    fireEvent.click(within(panel).getByRole('button', { name: '승인' }))
    expect(await within(panel).findByText('! 취소할 찜이 없어요')).toBeDefined()
    expect(server.callsTo('POST', /approve/)[0]?.body).toEqual({ requestId: expect.any(String) })
  })

  it('이름만 온 문자의 취소 요청: "승인" 없이 안내와 "무시"만, 이름만 문구는 한 번 (D-SMS3-19·16)', async () => {
    cards = [card({ kind: 'CANCEL', why: null, numbers: [15], last4: null, sender: '홍길동', text: '15 취소', message: '15번 취소를 원해요' })]
    await openConsole()
    const panel = await screen.findByRole('region', { name: '문자 확인' })
    expect(within(panel).getByText('15번 취소를 원해요')).toBeDefined()
    expect(within(panel).getByText(`! ${INBOX_CANCEL_NAME_ONLY}`)).toBeDefined()
    expect(within(panel).queryByRole('button', { name: '승인' })).toBeNull()
    expect(within(panel).getByRole('button', { name: '무시' })).toBeDefined()
    expect(panel.textContent?.split(INBOX_NAME_ONLY).length).toBe(2)
  })

  it('바로 넣은 문자찜에 "문자로 받음" — cards 응답의 찜 ID, 실시간으로 새 문자찜이 오면 다시 읽는다 (TE-SMS3-001)', async () => {
    const view = fullView({
      seq: 1,
      broadcasts: [broadcastView()],
      products: [product(15, { winners: ['u1'], winnerClaims: ['k1'] }), product(16, { winners: ['u2'], winnerClaims: ['k2'] })],
      claims: [smsClaim('k1', 'u1', 15)],
    })
    server.on('GET', new RegExp(`^/api/days/${DATE}(\\?rehearsal=true)?$`), () => ({ body: view }))
    claimIds = ['k1']
    await openConsole()
    const board = screen.getByRole('region', { name: '상품 보드' })
    await waitFor(() => expect(within(board).getAllByText(INBOX_FROM_SMS)).toHaveLength(1))
    // 16번에 문자찜이 새로 들어온다 (변경분) — 화면이 cards를 다시 읽는다
    const before = server.callsTo('GET', /inbox\/cards/).length
    claimIds = ['k1', 'k2']
    server.on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match): Reply =>
      Number(match[1]) < 2
        ? { body: { ...emptyChanges(Number(match[1]), 2), products: [product(16, { winners: ['u2'], winnerClaims: ['k2'] })], claims: [smsClaim('k2', 'u2', 16)] } }
        : { body: emptyChanges(Number(match[1]), 2) },
    )
    act(() => {
      for (const source of FakeEventSource.instances) source.emit('change', { date: DATE, rehearsal: false, seq: 2, type: 'sms' })
    })
    await waitFor(() => expect(server.callsTo('GET', /inbox\/cards/).length).toBeGreaterThan(before), { timeout: 3000 })
    await waitFor(() => expect(within(board).getAllByText(INBOX_FROM_SMS)).toHaveLength(2), { timeout: 3000 })
  })

  it('무시 → 카드가 사라진다, 실시간 알림 cards에 다시 읽는다', async () => {
    cards = [card()]
    server.on('POST', /^\/api\/inbox\/cards\/c1\/ignore$/, () => {
      cards = []
      return { body: { ok: true, card: 'c1' } }
    })
    await openConsole()
    const panel = await screen.findByRole('region', { name: '문자 확인' })
    fireEvent.click(within(panel).getByRole('button', { name: '무시' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '문자 확인' })).toBeNull())
    expect(server.callsTo('POST', /ignore/)[0]?.body).toEqual({})
    cards = [card({ id: 'c9', numbers: [15, 16] })]
    act(() => {
      for (const source of FakeEventSource.instances) source.emit('inbox', { kind: 'cards', b: 'b1' })
    })
    const again = await screen.findByRole('region', { name: '문자 확인' })
    // 후보가 둘이면 먼저 고르게 한다
    fireEvent.click(within(again).getByRole('button', { name: '넣기' }))
    expect(await within(again).findByText('! 넣을 번호를 먼저 골라 주세요.')).toBeDefined()
    expect(server.callsTo('POST', /insert/)).toHaveLength(0)
  })
})

describe('받기 멈춤 알림 (AC-SMS3-31)', () => {
  beforeEach(() => setupConsole())

  it('켜진 판매자, 방송 중 10분 넘게 받은 것이 없으면 → 닫으면 그 방송에서 다시 안 보인다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] })
    inbox = settingsView({ enabled: true, hasToken: true })
    await openConsole()
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(INBOX_STALL_MS + 31_000)
    })
    const bar = await screen.findByText(`! ${INBOX_STALL}`)
    expect(INBOX_STALL).toBe('휴대폰에서 문자가 오지 않고 있어요. 앱의 알림 읽기가 켜져 있는지 확인해 주세요.')
    // 무엇이든 받으면 사라진다
    act(() => {
      for (const source of FakeEventSource.instances) source.emit('inbox', { kind: 'received', lastReceivedAt: new Date().toISOString(), lastDevice: '폰' })
    })
    await waitFor(() => expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull())
    await act(async () => {
      vi.advanceTimersByTime(INBOX_STALL_MS + 31_000)
    })
    const again = await screen.findByText(`! ${INBOX_STALL}`)
    expect(bar).toBeDefined()
    fireEvent.click(within(again.parentElement as HTMLElement).getByRole('button', { name: '닫기' }))
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
    expect(stallClosed('b1')).toBe(true)
  })

  it('콘솔을 새로고침해도 서버가 준 방송 시작 시각부터 잰다 (TE-SMS3-002)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] })
    inbox = settingsView({ enabled: true, hasToken: true })
    // 방송은 9분 전에 시작했다 — 이 콘솔을 지금 열었어도 1분 남짓 뒤에 보여야 한다
    startedAt = new Date(Date.now() - 9 * 60 * 1000).toISOString()
    await openConsole()
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(61_000 + 31_000)
    })
    expect(await screen.findByText(`! ${INBOX_STALL}`)).toBeDefined()
  })

  it('방송 시작 뒤에 받은 것이 있으면 그 시각부터 잰다 (늦은 쪽)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] })
    startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    inbox = settingsView({ enabled: true, hasToken: true, lastReceivedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    await openConsole()
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(4 * 60 * 1000)
    })
    await flush(5)
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(60_000 + 31_000)
    })
    expect(await screen.findByText(`! ${INBOX_STALL}`)).toBeDefined()
  })

  it('꺼져 있으면 보이지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] })
    await openConsole()
    await act(async () => {
      vi.advanceTimersByTime(INBOX_STALL_MS * 3)
    })
    await flush(5)
    expect(screen.queryByText(`! ${INBOX_STALL}`)).toBeNull()
  })
})

function smsClaim(id: string, buyer: string, no: number): Claim {
  return {
    id,
    product: `b1/${String(no)}`,
    productId: `p${String(no)}`,
    broadcast: 'b1',
    no,
    buyer,
    currentBuyer: buyer,
    status: 'CONFIRMED',
    reason: null,
    origin: 'sms',
    seq: 1,
    rankTime: '2026-10-19T01:00:00.000Z',
    rankMinute: false,
    received: null,
    at: '2026-10-19T01:00:00.000Z',
    price: 10000,
    confirmVersion: 1,
    locked: false,
    cancelRequested: false,
    reprintNeeded: false,
    priceHistory: [],
    key: `b1/${String(no)}`,
    qty: 1,
    variant: null,
    options: null,
    amount: 10000,
  }
}

// ── 입금 확인 화면 (AC-SMS3-32) ────────────────────────────────────────────

const appliedDeposit = (patch: Partial<DepositView> = {}): DepositView => ({
  no: 7,
  source: { id: 's1', kind: 'PHONE', label: '휴대폰 알림' },
  at: '2026-10-31T11:05:00.000Z',
  precision: 'minute',
  amount: 14000,
  name: '홍길동',
  status: 'AUTO_APPLIED',
  applied: { date: '2026-10-31', buyer: 'u1', buyerName: '홍길동', seq: 3, auto: true },
  receivedAt: '2026-10-31T11:05:00.000Z',
  handledAt: null,
  ...patch,
})

describe('입금 확인 화면 은행 알림 줄 (AC-SMS3-32)', () => {
  let alerts: BankAlertView[]
  beforeEach(() => {
    alerts = [
      { id: 1, kind: 'CANCEL', bank: 'SHINHAN', bankName: '신한', amount: 14000, name: '홍길동', at: null, receivedAt: '2026-10-31T11:06:00.000Z', message: '입금 취소 알림이 왔어요: 14,000원 홍길동. 이 입금을 확인했다면 되돌려 주세요' },
      { id: 2, kind: 'UNREADABLE', bank: 'KB', bankName: 'KB국민', amount: null, name: null, at: null, receivedAt: '2026-10-31T11:07:00.000Z', message: BANK_UNREADABLE },
    ]
    server
      .on('GET', /^\/api\/deposits\/alerts$/, () => ({ body: { alerts } }))
      .on('GET', /^\/api\/deposits\?/, (call) => {
        if (call.path.includes('AUTO_APPLIED')) return { body: { deposits: [appliedDeposit()], more: false, review: 1 } }
        return {
          body: {
            deposits: [appliedDeposit({ no: 8, status: 'REVIEW', applied: null, review: { reason: 'UNTRUSTED_SOURCE', twin: null, suggestions: [], preselect: null } })],
            more: false,
            review: 1,
          },
        }
      })
      .on('GET', /^\/api\/deposits\/count$/, () => ({ body: { review: 1 } }))
      .on('POST', /^\/api\/deposits\/alerts\/2\/close$/, () => {
        alerts = alerts.filter((alert) => alert.id !== 2)
        return { body: { ok: true } }
      })
  })

  it('입금 취소 줄 → 같은 금액·이름 입금의 되돌리기 창(저절로 되돌리지 않음), 읽지 못함 줄은 "확인했어요"로 닫는다', async () => {
    render(<DepositsPage route={{ name: 'deposits', tab: 'review' }} navigate={navigate} />)
    const region = await screen.findByRole('region', { name: '은행 알림' })
    expect(await within(region).findByText('! 입금 취소 알림이 왔어요: 14,000원 홍길동. 이 입금을 확인했다면 되돌려 주세요')).toBeDefined()
    expect(within(region).getByText(`! ${BANK_UNREADABLE}`)).toBeDefined()
    expect(within(region).getByText('KB국민 · 10/31 20:07:00')).toBeDefined()
    const revert = await within(region).findByRole('button', { name: '입금 번호 7 (14,000원) 되돌리기' })
    fireEvent.click(revert)
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(server.callsTo('POST', /revert/)).toHaveLength(0)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    const closeButtons = within(region).getAllByRole('button', { name: '확인했어요' })
    fireEvent.click(closeButtons[1] as HTMLElement)
    await waitFor(() => expect(within(region).queryByText(`! ${BANK_UNREADABLE}`)).toBeNull())
    expect(server.callsTo('POST', /alerts\/2\/close/)).toHaveLength(1)
  })

  it('확인 필요 사유 UNTRUSTED_SOURCE 문장과 원천 "휴대폰 알림"', async () => {
    render(
      <DepositProvider>
        <DepositsPage route={{ name: 'deposits', tab: 'review' }} navigate={navigate} />
      </DepositProvider>,
    )
    expect(await screen.findByText(/은행 앱이나 은행 대표번호가 아닌 곳에서 온 입금 알림이에요/)).toBeDefined()
    expect(screen.getAllByText(/휴대폰 알림/).length).toBeGreaterThan(0)
  })
})
