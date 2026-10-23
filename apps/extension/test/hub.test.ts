// 서비스 워커: 연결·끊김·상태·배지·회차 고르기 (YT-10 AC4·AC6·AC7, AC-X1-18)
import { describe, expect, it } from 'vitest'
import { badgeFor, Hub, QUEUE_KEY, TOKEN_KEY, type HubView } from '../src/hub.ts'
import { WORDS } from '../src/words.ts'
import { FakeTimers, fakeChrome, message, settle } from './fakes.ts'

const V = 'abcdEFGH123'

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

function server(replies: Record<string, Reply[]>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    // 따로 정하지 않으면: 회차는 이어져 있고, 나머지는 잘 받음
    const fallback: Reply = key === 'GET /ext/broadcasts' ? { status: 200, body: { bound: { id: 'b1', date: '2026-10-23', title: '저녁 방송' }, broadcasts: [] } } : { status: 200, body: { recorded: 0, skipped: 0, state: 'RECEIVING', message: '확장으로 받는 중' } }
    const reply = replies[key]?.shift() ?? fallback
    return Promise.resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } }))
  }
  return { calls, fetcher }
}

const ORIGIN = 'http://localhost:5173'

describe('Hub', () => {
  it('코드로 연결하면 토큰을 저장하고, 토큰은 Authorization 머리글로만 보낸다', async () => {
    const { chrome, store } = fakeChrome()
    const { calls, fetcher } = server({ 'POST /ext/connect': [{ status: 200, body: { token: 'tok-secret' } }] })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    expect(((await hub.handle({ type: 'view' })) as HubView).message).toBe(WORDS.NOT_CONNECTED)
    const bad = (await hub.handle({ type: 'connect', code: '1234' })) as { ok: boolean; message: string }
    expect(bad).toMatchObject({ ok: false, message: WORDS.CODE_FORMAT })
    expect(calls).toHaveLength(0)
    const result = (await hub.handle({ type: 'connect', code: '1234 5678' })) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(calls[0]?.url).toBe(`${ORIGIN}/ext/connect`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ code: '12345678' })
    expect(store[TOKEN_KEY]).toBe('tok-secret')
    await hub.handle({ type: 'status', v: V, hidden: false, read: 0, unread: 0 })
    const statusCall = calls.at(-1)
    expect((statusCall?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-secret')
    expect(String(statusCall?.init.body)).not.toContain('tok-secret')
    expect(statusCall?.init.credentials).toBe('omit')
  })

  it('틀린 코드면 서버 문장을 보인다', async () => {
    const { chrome } = fakeChrome()
    const { fetcher } = server({ 'POST /ext/connect': [{ status: 400, body: { error: { code: 'EXT_CODE_INVALID', message: '연결 코드가 맞지 않거나 시간이 지났어요.' } } }] })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    expect(await hub.handle({ type: 'connect', code: '12345678' })).toMatchObject({ ok: false, message: '연결 코드가 맞지 않거나 시간이 지났어요.' })
  })

  it('AC-X1-18: 탭이 숨으면 배지가 바뀌고 상태 hidden을 보낸다', async () => {
    const { chrome, badge } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const { calls, fetcher } = server({})
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    await hub.handle({ type: 'status', v: V, hidden: false, read: 3, unread: 0 })
    expect(badge.text).toBe('ON')
    const view = (await hub.handle({ type: 'status', v: V, hidden: true, read: 3, unread: 0 })) as HubView
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ v: V, hidden: true, read: 3, unread: 0, dropped: 0 })
    expect(view.message).toBe(WORDS.HIDDEN)
    expect(badge).toMatchObject({ text: '!', color: badgeFor('warn').color })
    expect(badge.title).toContain(WORDS.HIDDEN)
  })

  it('401이면 토큰을 지우고 "연결이 끊겼어요"', async () => {
    const { chrome, store, badge } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const { fetcher } = server({ 'POST /ext/status': [{ status: 401, body: { error: { code: 'EXT_DISCONNECTED', message: '연결이 끊겼어요.' } } }] })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    const view = (await hub.handle({ type: 'status', v: V, hidden: false, read: 0, unread: 0 })) as HubView
    expect(view).toMatchObject({ connected: false, message: WORDS.DISCONNECTED, light: 'bad' })
    expect(store[TOKEN_KEY]).toBeUndefined()
    expect(badge.text).toBe('!')
  })

  it('회차를 골라야 하면 팝업에 목록을 주고, 고르면 잇는다', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const { calls, fetcher } = server({
      'POST /ext/chats': [{ status: 409, body: { error: { code: 'EXT_NOT_BOUND', message: '골라 주세요' } } }],
      'GET /ext/broadcasts': [{ status: 200, body: { bound: null, broadcasts: [{ id: 'b1', date: '2026-10-23', title: '저녁 방송' }] } }],
      'POST /ext/bind': [{ status: 200, body: { broadcast: 'b1' } }],
    })
    const hub = new Hub(chrome, ORIGIN, fetcher, timers)
    await hub.handle({ type: 'chats', v: V, messages: [message(1)] })
    await timers.fire()
    await settle()
    expect(((await hub.handle({ type: 'view' })) as HubView)).toMatchObject({ notBound: true, message: WORDS.NOT_BOUND, light: 'warn' })
    const list = await hub.handle({ type: 'broadcasts' })
    expect(list).toEqual({ bound: null, broadcasts: [{ id: 'b1', date: '2026-10-23', title: '저녁 방송' }], message: null })
    expect(calls.at(-1)?.url).toBe(`${ORIGIN}/ext/broadcasts?v=${V}`)
    expect(await hub.handle({ type: 'bind', broadcast: 'b1' })).toEqual({ ok: true, message: null })
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ v: V, broadcast: 'b1' })
    expect(((await hub.handle({ type: 'view' })) as HubView).notBound).toBe(false)
  })

  it('잇기를 거절하면 서버 이유를 보인다', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const { fetcher } = server({ 'POST /ext/bind': [{ status: 409, body: { reason: 'VIDEO_TAKEN', error: { code: 'EXT_BIND_REJECTED', message: '이 유튜브 방송은 이미 다른 회차에 이어져 있어요.' } } }] })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    await hub.handle({ type: 'status', v: V, hidden: false, read: 0, unread: 0 })
    expect(await hub.handle({ type: 'bind', broadcast: 'b1' })).toEqual({ ok: false, message: '이 유튜브 방송은 이미 다른 회차에 이어져 있어요.' })
  })

  it('연결 전에는 채팅을 붙들지 않는다 (보낼 곳이 없다)', async () => {
    const { chrome } = fakeChrome()
    const hub = new Hub(chrome, ORIGIN, server({}).fetcher, new FakeTimers())
    await hub.handle({ type: 'chats', v: V, messages: [message(1)] })
    expect(hub.outbox.size).toBe(0)
  })

  it('배지는 색과 글자 둘 다', () => {
    expect(badgeFor('ok').text).toBe('ON')
    expect(badgeFor('warn').text).toBe('!')
    expect(badgeFor('bad').text).toBe('!')
    expect(badgeFor('warn').color).not.toBe(badgeFor('bad').color)
    expect(badgeFor('off').text).toBe('')
  })

  it('TE-X1-003: 연결했지만 회차를 아직 고르지 않았으면 "받는 중"이 아니고 "골라 주세요"', async () => {
    const { chrome, badge } = fakeChrome()
    const { fetcher } = server({
      'POST /ext/connect': [{ status: 200, body: { token: 'tok' } }],
      'GET /ext/broadcasts': [{ status: 200, body: { bound: null, broadcasts: [{ id: 'b1', date: '2026-10-23', title: '저녁 방송' }] } }],
    })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    await hub.handle({ type: 'status', v: V, hidden: false, read: 0, unread: 0 })
    const result = (await hub.handle({ type: 'connect', code: '12345678' })) as { ok: boolean; view: HubView }
    expect(result.ok).toBe(true)
    expect(result.view).toMatchObject({ notBound: true, message: WORDS.NOT_BOUND, light: 'warn' })
    expect(badge.text).toBe('!')
    expect(badge.title).not.toContain(WORDS.RECEIVING)
  })

  it('AC-X1-23: 서버가 안 받아 붙든 12개는 세션에 두고, 워커가 다시 떠도 이어 보낸다. 디스크에는 채팅이 없다. 끊으면 세션도 비운다', async () => {
    const { chrome, store, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const down = server({ 'POST /ext/chats': [{ status: 500, body: {} }] })
    const first = new Hub(chrome, ORIGIN, down.fetcher, timers)
    await first.handle({ type: 'chats', v: V, messages: Array.from({ length: 12 }, (_, i) => message(i + 1)) })
    await timers.fire()
    await first.saved()
    expect(first.outbox.size).toBe(12)
    expect((session[QUEUE_KEY] as { items: unknown[] }).items).toHaveLength(12)
    expect(JSON.stringify(store)).not.toContain('초록손님')
    // 워커 종료 → 다시 뜸 (메모리는 비었고 세션만 남음)
    const up = server({})
    const second = new Hub(chrome, ORIGIN, up.fetcher, new FakeTimers())
    await second.handle({ type: 'view' })
    expect(second.outbox.size).toBe(12)
    await second.outbox.flush()
    await second.saved()
    const sent = up.calls.filter((c) => c.url.endsWith('/ext/chats')).flatMap((c) => (JSON.parse(String(c.init.body)) as { messages: { id: string }[] }).messages.map((m) => m.id))
    expect(sent).toEqual(Array.from({ length: 12 }, (_, i) => message(i + 1).id))
    expect(session[QUEUE_KEY]).toBeUndefined()
    // 다시 붙들었다가 "연결 지우기" → 세션 비움
    const stuck = server({ 'POST /ext/chats': [{ status: 500, body: {} }] })
    const third = new Hub(chrome, ORIGIN, stuck.fetcher, timers)
    await third.handle({ type: 'chats', v: V, messages: [message(1)] })
    await third.saved()
    expect(session[QUEUE_KEY]).toBeDefined()
    await third.handle({ type: 'forget' })
    expect(session[QUEUE_KEY]).toBeUndefined()
  })

  it('AC-X1-23: 토큰 없이 세션에 남은 채팅은 다시 뜰 때 지운다', async () => {
    const { chrome, session } = fakeChrome({}, { [QUEUE_KEY]: { items: [{ v: V, message: message(1) }], dropped: 0 } })
    const hub = new Hub(chrome, ORIGIN, server({}).fetcher, new FakeTimers())
    await hub.handle({ type: 'view' })
    expect(hub.outbox.size).toBe(0)
    expect(session[QUEUE_KEY]).toBeUndefined()
  })

  it('AC-X1-33: 팝업 전용 메시지는 확장 페이지에서만, 채팅·상태·감사는 유튜브 채팅 페이지에서만', async () => {
    const { chrome, store } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const { calls, fetcher } = server({})
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    const page = { id: 'ext', tab: { id: 3 }, url: `https://www.youtube.com/live_chat?v=${V}` }
    const popup = { id: 'ext', url: 'chrome-extension://ext/popup.html' }
    expect(await hub.handle({ type: 'forget' }, page)).toBeUndefined()
    expect(await hub.handle({ type: 'connect', code: '12345678' }, page)).toBeUndefined()
    expect(await hub.handle({ type: 'bind', broadcast: 'b1' }, page)).toBeUndefined()
    expect(store[TOKEN_KEY]).toBe('tok')
    expect(calls).toHaveLength(0)
    expect(await hub.handle({ type: 'thanksTake', v: V, meIsOwner: false, owner: null }, popup)).toBeUndefined()
    expect(await hub.handle({ type: 'chats', v: V, messages: [message(1)] }, { id: 'ext', tab: { id: 3 }, url: 'https://www.youtube.com/watch?v=x' })).toBeUndefined()
    expect(hub.outbox.size).toBe(0)
    expect(await hub.handle({ type: 'view' }, popup)).toMatchObject({ connected: true })
  })

  it('감사 가져가기·결과를 서버로 넘기고, 주인 아님은 팝업·배지 경고', async () => {
    const { chrome, badge } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const owner = '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요'
    const { calls, fetcher } = server({
      'POST /ext/thanks/take': [
        { status: 200, body: { state: 'NOT_OWNER', post: null, afterMs: null, message: owner } },
        { status: 200, body: { state: 'POST', post: { ids: [4, 5], text: '감사합니다', until: '2026-10-23T05:01:00.000Z' }, afterMs: null, message: null } },
      ],
      'POST /ext/thanks/result': [{ status: 200, body: { rows: [] } }],
    })
    const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    await hub.handle({ type: 'status', v: V, hidden: false, read: 0, unread: 0 })
    expect(await hub.handle({ type: 'thanksTake', v: V, meIsOwner: false, owner: null })).toMatchObject({ state: 'NOT_OWNER', post: null })
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ v: V, meIsOwner: false, owner: null })
    expect(((await hub.handle({ type: 'view' })) as HubView).thanks).toBe(owner)
    expect(badge.text).toBe('!')
    expect(await hub.handle({ type: 'thanksTake', v: V, meIsOwner: true, owner: 'UCa' })).toEqual({ state: 'POST', post: { ids: [4, 5], text: '감사합니다', until: '2026-10-23T05:01:00.000Z' }, afterMs: null, message: null })
    expect(((await hub.handle({ type: 'view' })) as HubView).thanks).toBeNull()
    expect(await hub.handle({ type: 'thanksResult', ids: [4, 5], result: 'POSTED' })).toEqual({ ok: true })
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ ids: [4, 5], result: 'POSTED' })
  })
})
