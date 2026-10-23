// 서비스 워커: 연결·끊김·상태·배지·회차 고르기 (YT-10 AC4·AC6·AC7, AC-X1-18)
import { describe, expect, it } from 'vitest'
import { badgeFor, Hub, TOKEN_KEY, type HubView } from '../src/hub.ts'
import { WORDS } from '../src/words.ts'
import { FakeTimers, fakeChrome, message, settle } from './fakes.ts'

const V = 'abcdEFGH123'

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

function server(replies: Record<string, Reply[]>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    const reply = replies[key]?.shift() ?? { status: 200, body: { recorded: 0, skipped: 0, state: 'RECEIVING', message: '확장으로 받는 중' } }
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
})
