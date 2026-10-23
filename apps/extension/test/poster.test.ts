// 감사 채팅 올리기 (AC-X1-27·29·30·31·32, YT-10 AC12~AC16) — 가짜 채팅 페이지(입력 칸·보내기 단추)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetOwner, handleWho, installBridge } from '../src/page-bridge.ts'
import { askIdentity, BUSY_MS, CONFIRM_MS, GAP_MS, IDLE_MS, ThanksPoster, TYPING_IDLE_MS } from '../src/poster.ts'
import { BRIDGE_EVENT, INPUT_FIELD, SEND_BUTTON, WHO_EVENT } from '../src/selectors.ts'
import { handleBridge } from '../src/page-bridge.ts'
import { FakeTimers, settle } from './fakes.ts'
import { gateSendButton, loadFakeChat, OWNER_BADGES, setInputOwner } from './fake-chat.ts'

const V = 'abcdEFGH123'
const ME = 'UCsellerchannel000000001'

interface Asked {
  readonly type: string
  readonly [key: string]: unknown
}

let asked: Asked[]
let replies: unknown[]
let timers: FakeTimers
let clock: number
let poster: ThanksPoster
let sent: string[]

const field = () => document.querySelector(INPUT_FIELD) as HTMLElement
const button = () => document.querySelector(SEND_BUTTON) as HTMLButtonElement
const takes = () => asked.filter((a) => a.type === 'thanksTake')
const results = () => asked.filter((a) => a.type === 'thanksResult').map((a) => ({ ids: a['ids'], result: a['result'] }))

function postReply(ids: number[], text: string) {
  return { state: 'POST', post: { ids, text, until: '2026-10-23T05:01:00.000Z' }, afterMs: null, message: null }
}

function make(identity = () => ({ meIsOwner: true, owner: ME as string | null })) {
  poster = new ThanksPoster({
    document,
    video: V,
    ask: (message) => {
      asked.push(message as Asked)
      const m = message as Asked
      if (m.type === 'thanksResult') return Promise.resolve({ ok: true })
      return Promise.resolve(replies.shift() ?? { state: 'NONE', post: null, afterMs: 3000, message: null })
    },
    timers,
    now: () => clock,
    identity,
  })
  begin()
}

/** 켜고, 처음 건 타이머는 치운다 (시험이 tick을 직접 부른다) */
function begin() {
  poster.start()
  timers.pending.clear()
}

beforeEach(() => {
  loadFakeChat()
  asked = []
  replies = []
  sent = []
  timers = new FakeTimers()
  clock = 1_000_000
  // 보내기를 누르면 입력 칸 글을 보내고 비운다 (실제 유튜브처럼)
  button().addEventListener('click', () => {
    sent.push(field().textContent ?? '')
    field().textContent = ''
  })
  make()
})

afterEach(() => poster.stop())

describe('AC-X1-29·31: 서버가 준 글을 글자로만 넣고 보내고, 내 글이 뜨면 게시됨', () => {
  it('글 하나 → 입력 칸에 그대로 → 보내기 → 내 채널의 같은 글이 뜨면 POSTED 한 번', async () => {
    replies.push(postReply([11, 12], '첫손님님 3번 1등 확정 축하드려요! 감사합니다'))
    await poster.tick()
    expect(takes()[0]).toMatchObject({ v: V, meIsOwner: true, owner: ME })
    expect(sent).toEqual(['첫손님님 3번 1등 확정 축하드려요! 감사합니다'])
    expect(poster.waiting).toBe(true)
    // 남의 글·다른 글은 확인이 아니다
    poster.onMessages([{ id: 'a', ch: 'UCother00000000000000001', nick: 'x', text: '첫손님님 3번 1등 확정 축하드려요! 감사합니다', at: 1 }])
    poster.onMessages([{ id: 'b', ch: ME, nick: 'x', text: '잠시만요', at: 1 }])
    await settle()
    expect(results()).toEqual([])
    poster.onMessages([{ id: 'c', ch: ME, nick: '판매자', text: '첫손님님  3번 1등 확정 축하드려요!\n감사합니다', at: 1 }])
    poster.onMessages([{ id: 'd', ch: ME, nick: '판매자', text: '첫손님님 3번 1등 확정 축하드려요! 감사합니다', at: 1 }])
    await settle()
    expect(results()).toEqual([{ ids: [11, 12], result: 'POSTED' }])
    // 다음 글은 3초 뒤에 묻는다
    expect(timers.delays()).toEqual([GAP_MS])
  })

  it('닉네임에 태그 모양 글자가 있어도 요소가 생기지 않고 글자 그대로 들어간다', async () => {
    const text = '<b>홍 길동</b>님 3번 1등 확정 축하드려요!'
    replies.push(postReply([5], text))
    let inserted = ''
    button().addEventListener('click', () => undefined, { once: true })
    field().addEventListener('input', () => {
      inserted = field().innerHTML
    })
    await poster.tick()
    expect(sent).toEqual([text])
    expect(inserted).not.toContain('<b>')
    expect(document.querySelector(`${INPUT_FIELD} b`)).toBeNull()
  })

  it('15초 안에 내 글이 안 뜨면 확인 필요(UNCONFIRMED) — 다시 올리지 않는다', async () => {
    replies.push(postReply([7], '감사합니다'))
    await poster.tick()
    expect(timers.delays()).toContain(CONFIRM_MS)
    await timers.fire()
    expect(results()).toEqual([{ ids: [7], result: 'UNCONFIRMED' }])
    expect(sent).toHaveLength(1)
  })
})

describe('AC-X1-30: 판매자가 쓰는 중이면 기다린다', () => {
  it('입력 칸에 "잠시만요"가 있으면 묻지도 넣지도 않고, 글은 그대로', async () => {
    field().textContent = '잠시만요'
    await poster.tick()
    expect(takes()).toHaveLength(0)
    expect(field().textContent).toBe('잠시만요')
    expect(timers.delays()).toEqual([BUSY_MS])
  })

  it('마지막 키 입력 3초 뒤엔 기다리고, 5초 지나고 비어 있으면 올린다', async () => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    clock += 3000
    await poster.tick()
    expect(takes()).toHaveLength(0)
    clock += TYPING_IDLE_MS - 3000
    replies.push(postReply([1], '감사합니다'))
    await poster.tick()
    expect(sent).toEqual(['감사합니다'])
  })

  it('가져간 사이 판매자가 쓰기 시작하면 넣지 않고 NOT_POSTED로 돌려준다', async () => {
    poster.stop()
    poster = new ThanksPoster({
      document,
      video: V,
      ask: (message) => {
        const m = message as Asked
        asked.push(m)
        if (m.type === 'thanksResult') return Promise.resolve({ ok: true })
        field().textContent = '잠깐'
        return Promise.resolve(postReply([3], '감사합니다'))
      },
      timers,
      now: () => clock,
      identity: () => ({ meIsOwner: true, owner: ME }),
    })
    begin()
    await poster.tick()
    expect(field().textContent).toBe('잠깐')
    expect(sent).toEqual([])
    expect(results()).toEqual([{ ids: [3], result: 'NOT_POSTED' }])
  })
})

describe('AC-X1-27: 채널 주인 확인', () => {
  it('입력 칸이 없으면(로그인 안 함) 채널을 모른다고 묻고 아무것도 넣지 않는다', async () => {
    document.querySelector('yt-live-chat-message-input-renderer')?.remove()
    replies.push({ state: 'NOT_OWNER', post: null, afterMs: null, message: '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요' })
    await poster.tick()
    expect(takes()[0]).toMatchObject({ meIsOwner: false, owner: null })
    expect(timers.delays()).toEqual([IDLE_MS])
  })

  it('서버가 주인 아님이라 하면 넣지 않는다 (다른 계정)', async () => {
    poster.stop()
    make(() => ({ meIsOwner: false, owner: ME }))
    replies.push({ state: 'NOT_OWNER', post: null, afterMs: null, message: '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요' })
    await poster.tick()
    expect(takes()[0]).toMatchObject({ meIsOwner: false, owner: ME })
    expect(sent).toEqual([])
    expect(field().textContent).toBe('')
  })

  it('주인 배지를 못 읽었는데 서버가 글을 줘도 넣지 않고 돌려준다 (대신 쓰는 값 없음, RA-X1-08)', async () => {
    poster.stop()
    make(() => ({ meIsOwner: false, owner: ME }))
    replies.push(postReply([7], '감사합니다'))
    await poster.tick()
    expect(sent).toEqual([])
    expect(results()).toEqual([{ ids: [7], result: 'NOT_POSTED' }])
  })

  it('빈 칸이면 보내기 단추가 꺼져 있다 — 글을 넣어 단추가 켜지면 누른다 (HG-X1 실물)', async () => {
    expect(button().disabled).toBe(true)
    replies.push(postReply([11], '감사합니다'))
    await poster.tick()
    expect(sent).toEqual(['감사합니다'])
    expect(poster.waiting).toBe(true)
  })

  it('글을 넣은 뒤 단추가 조금 늦게 켜지면 기다렸다가 누른다', async () => {
    loadFakeChat()
    gateSendButton(document, true)
    button().addEventListener('click', () => {
      sent.push(field().textContent ?? '')
      field().textContent = ''
    })
    replies.push(postReply([12], '감사합니다'))
    const run = poster.tick()
    await Promise.resolve()
    await timers.fire()
    button().disabled = false
    for (let i = 0; i < 5 && sent.length === 0; i++) await timers.fire()
    await run
    expect(sent).toEqual(['감사합니다'])
  })

  it('글을 넣어도 단추가 끝내 켜지지 않으면 우리 글만 지우고 NOT_POSTED', async () => {
    loadFakeChat()
    gateSendButton(document, true)
    replies.push(postReply([13], '감사합니다'))
    const run = poster.tick()
    for (let i = 0; i < 40; i++) await timers.fire()
    await run
    expect(sent).toEqual([])
    expect(field().textContent).toBe('')
    expect(results()).toEqual([{ ids: [13], result: 'NOT_POSTED' }])
  })

  it('보내기 단추가 없으면 넣지 않고 NOT_POSTED', async () => {
    button().remove()
    replies.push(postReply([9], '감사합니다'))
    await poster.tick()
    expect(field().textContent).toBe('')
    expect(results()).toEqual([{ ids: [9], result: 'NOT_POSTED' }])
  })

  it('꺼짐·멈춤이면 넣지 않고 천천히 다시 묻는다', async () => {
    replies.push({ state: 'OFF', post: null, afterMs: null, message: null })
    await poster.tick()
    replies.push({ state: 'PAUSED', post: null, afterMs: null, message: '확장으로 감사 글을 올리지 못하고 있어요' })
    await poster.tick()
    expect(sent).toEqual([])
    expect(timers.delays()).toEqual([IDLE_MS])
  })
})

describe('페이지 쪽 스크립트: 로그인 채널·방송 채널', () => {
  beforeEach(() => {
    forgetOwner()
    installBridge(document)
  })
  afterEach(() => {
    document.removeEventListener(BRIDGE_EVENT, handleBridge, true)
    document.removeEventListener(WHO_EVENT, handleWho, true)
  })

  it('입력 칸 data의 주인 배지(채널 ID 없음 — 실물 모양)와 주인 배지 메시지의 채널 ID를 읽고, 붙였던 속성은 지운다', () => {
    setInputOwner(document, false)
    expect(askIdentity(document)).toEqual({ meIsOwner: false, owner: null })
    setInputOwner(document, true)
    const owned = document.createElement('yt-live-chat-text-message-renderer') as HTMLElement & { data?: unknown }
    owned.data = { authorExternalChannelId: ME, authorBadges: OWNER_BADGES }
    document.querySelector('#items')?.append(owned)
    expect(askIdentity(document)).toEqual({ meIsOwner: true, owner: ME })
    expect(document.documentElement.hasAttribute('data-livegenie-me-owner')).toBe(false)
    expect(document.documentElement.hasAttribute('data-livegenie-owner')).toBe(false)
    // 다른 배지(관리자)는 주인이 아니다
    ;(document.querySelector('yt-live-chat-message-input-renderer') as unknown as { data: unknown }).data = {
      authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' } } }],
    }
    expect(askIdentity(document).meIsOwner).toBe(false)
  })
})
