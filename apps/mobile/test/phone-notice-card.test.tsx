// 앱 설정 "휴대폰 알림 받기" (SMS3 AC-SMS3-29, D-SMS3-04): 켜기 → 받기 토큰을 받아 기기에 넣고 켠다,
// 안드로이드 알림 읽기 안내 한 장, 권한이 꺼져 있으면 "알림 읽기가 꺼져 있어요", 아이폰은 단축어 안내, 401이면 "받기 토큰을 다시 넣어 주세요".
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setNoticeModule, type PhoneNoticePort, type PhoneNoticeState } from '../src/native/notice.ts'
import {
  PHONE_NOTICE_ACCESS_OFF,
  PHONE_NOTICE_GO,
  PHONE_NOTICE_INBOX_OFF,
  PHONE_NOTICE_IPHONE,
  PHONE_NOTICE_SHORTCUT_GUIDE,
  PHONE_NOTICE_SHORTCUT_STEPS,
  PHONE_NOTICE_VALUE_NOTE,
  phoneNoticeAddress,
  PHONE_NOTICE_RENEW_QUESTION,
  PHONE_NOTICE_SHEET,
  PHONE_NOTICE_TOKEN_AGAIN,
  PHONE_NOTICE_UNAVAILABLE,
  PhoneNoticeCard,
  phoneNoticeDroppedLine,
  phoneNoticeLine,
} from '../src/screens/PhoneNoticeCard.tsx'
import { makeWorld } from './screen-support.tsx'

const base: PhoneNoticeState = { platform: 'android', enabled: false, access: 'needed', hasToken: false, tokenRejected: false, pending: 0, lastSentAtMs: null }

class FakePort implements PhoneNoticePort {
  state: PhoneNoticeState
  granted = false
  tokens: { token: string; serverUrl: string; deviceName: string }[] = []
  opened: string[] = []
  readonly #listeners = new Set<(state: PhoneNoticeState) => void>()
  constructor(state: Partial<PhoneNoticeState> = {}) {
    this.state = { ...base, ...state }
  }
  #set(patch: Partial<PhoneNoticeState>): PhoneNoticeState {
    this.state = { ...this.state, ...patch }
    for (const listener of this.#listeners) listener(this.state)
    return this.state
  }
  start = async () => this.#set({ enabled: true, access: this.state.platform === 'ios' ? 'shortcut' : this.granted ? 'granted' : 'needed' })
  stop = async () => this.#set({ enabled: false })
  getState = async () => this.state
  addStateListener = (listener: (state: PhoneNoticeState) => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  openSettings = async (target?: string) => {
    this.opened.push(target ?? 'app')
    return true
  }
  setToken = async (config: { token: string; serverUrl: string; deviceName: string } | null) => {
    if (config !== null) this.tokens.push(config)
    return this.#set({ hasToken: config !== null, tokenRejected: false })
  }
  grant() {
    this.granted = true
    this.#set({ access: 'granted' })
  }
}

afterEach(() => {
  cleanup()
  setNoticeModule(null)
})

describe('휴대폰 알림 받기 칸 (AC-SMS3-29)', () => {
  it('모듈이 없는 빌드면 쓸 수 없다고만', () => {
    const world = makeWorld()
    render(world.wrap(<PhoneNoticeCard />))
    expect(screen.getByText(PHONE_NOTICE_UNAVAILABLE)).toBeDefined()
  })

  it('처음 켜기: 받기 토큰을 받아 기기에 넣고 켠다 → 안내 한 장 → "알림 읽기 켜러 가기"가 안드로이드 설정을 연다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/inbox\/settings$/, () => ({ body: { inbox: { enabled: false, hasToken: false, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null } } }))
    world.server.on('POST', /^\/api\/inbox\/token$/, () => ({ body: { token: 'tok_APP_1', inbox: { enabled: true, hasToken: true, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null } } }))
    const port = new FakePort()
    setNoticeModule(port)
    render(world.wrap(<PhoneNoticeCard />))
    fireEvent.click(await screen.findByRole('button', { name: '켜기' }))
    expect(await screen.findByText(PHONE_NOTICE_SHEET)).toBeDefined()
    expect(PHONE_NOTICE_SHEET).toBe('문자와 은행 앱 알림만 라이브지니로 보내요. 다른 앱 알림은 읽지 않아요.')
    expect(port.tokens).toEqual([{ token: 'tok_APP_1', serverUrl: 'http://test.local', deviceName: '안드로이드 라이브지니 앱' }])
    // 토큰 원문은 화면에 보이지 않는다
    expect(document.body.textContent).not.toContain('tok_APP_1')
    fireEvent.click(screen.getByRole('button', { name: PHONE_NOTICE_GO }))
    await waitFor(() => expect(port.opened).toEqual(['notificationAccess']))
    await waitFor(() => expect(screen.queryByText(PHONE_NOTICE_SHEET)).toBeNull())
    // 허용하지 않고 돌아오면 칸에 "알림 읽기가 꺼져 있어요"
    expect(screen.getAllByText(PHONE_NOTICE_ACCESS_OFF).length).toBeGreaterThan(0)
    port.grant()
    await waitFor(() => expect(screen.getByText('문자와 은행 앱 알림을 보내고 있어요')).toBeDefined())
    expect(screen.queryByText(PHONE_NOTICE_ACCESS_OFF)).toBeNull()
  })

  it('서버에 이미 켜진 토큰이 있으면 먼저 묻는다 (전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/inbox\/settings$/, () => ({ body: { inbox: { enabled: true, hasToken: true, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null } } }))
    world.server.on('POST', /^\/api\/inbox\/token$/, () => ({ body: { token: 'tok_APP_2', inbox: {} } }))
    const port = new FakePort()
    port.granted = true
    setNoticeModule(port)
    render(world.wrap(<PhoneNoticeCard />))
    await waitFor(() => expect(world.server.callsTo('GET', /inbox\/settings/)).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: '켜기' }))
    expect(await screen.findByText(PHONE_NOTICE_RENEW_QUESTION)).toBeDefined()
    expect(world.server.callsTo('POST', /inbox\/token/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '이 휴대폰으로 받기' }))
    await waitFor(() => expect(port.tokens).toHaveLength(1))
    expect(await screen.findByText('문자와 은행 앱 알림을 보내고 있어요')).toBeDefined()
  })

  it('서버가 토큰을 받지 않으면 "받기 토큰을 다시 넣어 주세요"', async () => {
    const world = makeWorld()
    const port = new FakePort({ enabled: true, hasToken: true, tokenRejected: true, access: 'granted' })
    setNoticeModule(port)
    render(world.wrap(<PhoneNoticeCard />))
    expect((await screen.findAllByText(PHONE_NOTICE_TOKEN_AGAIN)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '토큰 다시 받기' })).toBeDefined()
  })

  it('아이폰: 다른 앱 알림을 읽을 수 없다는 안내와 단축어 앱 열기', async () => {
    const world = makeWorld()
    const port = new FakePort({ platform: 'ios', access: 'shortcut', enabled: true, hasToken: true })
    setNoticeModule(port)
    render(world.wrap(<PhoneNoticeCard />))
    expect(await screen.findByText(PHONE_NOTICE_IPHONE)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '단축어 앱 열기' }))
    await waitFor(() => expect(port.opened).toEqual(['shortcuts']))
  })

  it('아이폰 단축어 안내는 웹 설정의 한 가지("URL 콘텐츠 가져오기"에 토큰)뿐이고, 꺼져 있으면 앱에서 켜지 않는다 (D-SMS3-23)', async () => {
    const world = makeWorld()
    const port = new FakePort({ platform: 'ios', access: 'shortcut', enabled: false, hasToken: false })
    setNoticeModule(port)
    render(world.wrap(<PhoneNoticeCard />))
    expect(await screen.findByText(PHONE_NOTICE_SHORTCUT_GUIDE)).toBeDefined()
    expect(PHONE_NOTICE_SHORTCUT_GUIDE).toContain('URL 콘텐츠 가져오기')
    expect(PHONE_NOTICE_SHORTCUT_GUIDE).not.toContain('문자 보내기')
    // 웹 설정 안내와 같은 순서: 기기 입구 JSON 칸 이름 그대로 (SA-SMS3-004)
    const all = PHONE_NOTICE_SHORTCUT_STEPS.join('\n')
    for (const value of ['`POST`', '`Authorization`', '`Bearer`', '`JSON`', '`device`', '`messages`', '`id`', '`channel`', '`SMS`', '`from`', '`text`', '`receivedAt`']) expect(all).toContain(value)
    // id = "현재 날짜(초까지)" + "보낸 사람" 한 가지, 고정 글을 쓰지 말라는 한 줄 — 웹 안내와 같은 글 (D-SMS3-32)
    expect(all).toContain('"현재 날짜"(날짜 형식 "사용자 지정" `yyyyMMddHHmmss` — 초까지)와 단축어 입력의 "보낸 사람"')
    expect(PHONE_NOTICE_SHORTCUT_STEPS.some((step) => step.includes('고정 글') && step.includes('넣지 마세요'))).toBe(true)
    // 값은 따옴표 없이 회색 상자(길게 눌러 복사) — 따옴표까지 적으면 문자를 하나도 받지 못한다 (UX-SMS3-001)
    expect(screen.getByText(/키는/).textContent).toContain('Authorization')
    expect(screen.getByText(/키는/).textContent).not.toContain('"Authorization"')
    expect(screen.getByText(/^9\. /).textContent).toBe('9. channel(텍스트) = SMS')
    expect(screen.getByText(PHONE_NOTICE_VALUE_NOTE)).toBeDefined()
    // 아이폰 사파리로 웹 설정을 열어 복사해 붙여 넣는다 — 웹 안내와 같은 뜻 (UX-SMS3-002), 받는 주소도 보인다
    expect(PHONE_NOTICE_SHORTCUT_GUIDE.startsWith('아이폰 사파리로')).toBe(true)
    expect(PHONE_NOTICE_SHORTCUT_GUIDE).not.toContain('컴퓨터에서 라이브')
    expect(screen.getByLabelText('받는 주소').textContent).toMatch(/\/api\/inbox\/messages$/)
    expect(phoneNoticeAddress('https://a.example/')).toBe('https://a.example/api/inbox/messages')
    expect(screen.queryByRole('button', { name: '켜기' })).toBeNull()
  })

  it('상태 한 줄', () => {
    expect(phoneNoticeLine(base)).toBe('꺼져 있어요')
    expect(phoneNoticeLine({ ...base, enabled: true, hasToken: true, access: 'needed' })).toBe(PHONE_NOTICE_ACCESS_OFF)
    expect(phoneNoticeLine({ ...base, enabled: true, hasToken: true, access: 'granted', pending: 3 })).toBe('3건을 보내는 중이에요')
    expect(phoneNoticeLine({ ...base, enabled: true, hasToken: true, access: 'shortcut' })).toBe('단축어로 받은 문자를 보내고 있어요')
    // 웹 설정에서 받기가 꺼짐(403 INBOX_OFF) — 토큰은 그대로 (ORD-13 받기 상태, D-SMS3-27)
    expect(PHONE_NOTICE_INBOX_OFF).toBe('웹 설정에서 휴대폰 알림 받기가 꺼져 있어요. 켜면 모아 둔 알림을 보내요')
    expect(phoneNoticeLine({ ...base, enabled: true, hasToken: true, access: 'granted', inboxOff: true, pending: 4 })).toBe(PHONE_NOTICE_INBOX_OFF)
    // 대기열이 넘쳐 버린 알림 (D-SMS3-28)
    expect(phoneNoticeDroppedLine({ dropped: 3 })).toBe('보내지 못하고 버린 알림이 3건 있어요. 은행 앱에서 입금을 확인해 주세요')
    expect(phoneNoticeDroppedLine({ dropped: 0 })).toBeNull()
    expect(phoneNoticeDroppedLine({})).toBeNull()
  })

  it('받기 꺼짐·버린 알림이 칸에 보인다 (D-SMS3-27·28)', async () => {
    const world = makeWorld()
    setNoticeModule(new FakePort({ enabled: true, hasToken: true, access: 'granted', inboxOff: true, dropped: 12 }))
    render(world.wrap(<PhoneNoticeCard />))
    expect(await screen.findByText(PHONE_NOTICE_INBOX_OFF)).toBeDefined()
    expect(screen.getByText('보내지 못하고 버린 알림이 12건 있어요. 은행 앱에서 입금을 확인해 주세요')).toBeDefined()
    expect(screen.queryByText(PHONE_NOTICE_TOKEN_AGAIN)).toBeNull()
  })
})
