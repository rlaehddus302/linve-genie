// 서비스 워커: 연결·끊김·상태·배지·회차 고르기 (YT-10 AC4·AC6·AC7, AC-X1-18)
import { describe, expect, it } from 'vitest'
import { ASK_STATUS } from '../src/chrome.ts'
import { ASK_WAIT_MS, badgeFor, FRAME_GONE_MS, FRAMES_KEY, FRAMES_SAVE_MS, HIDDEN_WARN_MS, Hub, QUEUE_KEY, TOKEN_KEY, type HubView } from '../src/hub.ts'
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

  it('AC-X1-18: 탭이 숨은 채 30초(HIDDEN_WARN_MS) 이어지면 배지가 바뀌고 상태 hidden을 보낸다 — 잠깐 숨김은 그대로', async () => {
    const { chrome, badge } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const { calls, fetcher } = server({})
    const clock = { t: 1_000_000 }
    const timers = new FakeTimers()
    const hub = new Hub(chrome, ORIGIN, fetcher, timers, () => clock.t)
    await hub.handle({ type: 'status', v: V, hidden: false, read: 3, unread: 0 })
    expect(badge.text).toBe('ON')
    clock.t += 1_000
    let view = (await hub.handle({ type: 'status', v: V, hidden: true, read: 3, unread: 0 })) as HubView
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ v: V, hidden: false, read: 3, unread: 0, dropped: 0 })
    expect(view.message).toBe(WORDS.RECEIVING)
    expect(timers.delays()).toContain(HIDDEN_WARN_MS - 1_000)
    clock.t += HIDDEN_WARN_MS - 1_000
    await timers.fire()
    expect(badge).toMatchObject({ text: '!', color: badgeFor('warn').color })
    expect(badge.title).toContain(WORDS.HIDDEN)
    view = (await hub.handle({ type: 'status', v: V, hidden: true, read: 3, unread: 0 })) as HubView
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ v: V, hidden: true, read: 3, unread: 0, dropped: 0 })
    expect(view.message).toBe(WORDS.HIDDEN)
    // 다시 보이면 바로 받는 중
    view = (await hub.handle({ type: 'status', v: V, hidden: false, read: 3, unread: 0 })) as HubView
    expect(view.message).toBe(WORDS.RECEIVING)
    expect(badge.text).toBe('ON')
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

  describe('X1 상태 흔들림: 프레임 여럿·끝난 다른 방송 창·숨김 전환 (dev-notes V3)', () => {
    const LIVE = 'kkNQY46VpXU'
    const OLD = 'JbBfRCRKtE8'
    const WATCH = { id: 'ext', url: `https://www.youtube.com/live_chat?is_popout=0&v=${LIVE}`, tab: { id: 1 }, frameId: 7 }
    const POPOUT = { id: 'ext', url: `https://www.youtube.com/live_chat?is_popout=1&v=${LIVE}`, tab: { id: 2 }, frameId: 0 }
    const OLD_POPOUT = { id: 'ext', url: `https://www.youtube.com/live_chat?is_popout=1&v=${OLD}`, tab: { id: 3 }, frameId: 0 }

    function setup() {
      const { chrome, badge } = fakeChrome({ [TOKEN_KEY]: 'tok' })
      const unbound = { status: 200, body: { bound: null, broadcasts: [] } }
      const { calls, fetcher } = server({})
      const routed = (url: string, init: RequestInit) => {
        if (url.includes(`v=${OLD}`)) {
          calls.push({ url, init })
          return Promise.resolve(new Response(JSON.stringify(unbound.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        return fetcher(url, init)
      }
      const clock = { t: 2_000_000 }
      const timers = new FakeTimers()
      const hub = new Hub(chrome, ORIGIN, routed, timers, () => clock.t)
      const statusBodies = () => calls.filter((c) => c.url.endsWith('/ext/status')).map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>)
      return { hub, badge, clock, timers, statusBodies }
    }

    it('같은 영상의 시청 페이지 안 채팅(보임)과 팝아웃(숨음)이 번갈아 보고해도 계속 받는 중이고, 서버에 숨음을 보내지 않는다', async () => {
      const { hub, badge, clock, statusBodies } = setup()
      const seen: string[] = []
      for (let i = 0; i < 12; i++) {
        clock.t += 5_000
        const view = (await hub.handle({ type: 'status', v: LIVE, hidden: i % 2 === 1, read: i, unread: 0 }, i % 2 === 0 ? WATCH : POPOUT)) as HubView
        seen.push(view.message, badge.text)
      }
      expect(new Set(seen)).toEqual(new Set([WORDS.RECEIVING, 'ON']))
      expect(statusBodies().every((body) => body['hidden'] === false && body['v'] === LIVE)).toBe(true)
    })

    it('회차에 이어지지 않은 끝난 다른 방송의 팝아웃 보고는 지금 상태를 바꾸지 않고 서버로 보내지 않는다', async () => {
      const { hub, badge, clock, statusBodies } = setup()
      await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
      for (let i = 0; i < 6; i++) {
        clock.t += 5_000
        const view = (await hub.handle({ type: 'status', v: OLD, hidden: true, read: 0, unread: 0 }, OLD_POPOUT)) as HubView
        expect(view).toMatchObject({ video: LIVE, message: WORDS.RECEIVING, notBound: false })
        expect(badge.text).toBe('ON')
        clock.t += 5_000
        await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
      }
      expect(statusBodies().some((body) => body['v'] === OLD)).toBe(false)
    })

    it('지금 영상의 창이 모두 닫혀(90초 보고 없음) 끝난 방송 창만 남으면 그 창 기준으로 알린다', async () => {
      const { hub, clock } = setup()
      await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
      clock.t += FRAME_GONE_MS + 1
      const view = (await hub.handle({ type: 'status', v: OLD, hidden: false, read: 0, unread: 0 }, OLD_POPOUT)) as HubView
      expect(view).toMatchObject({ video: OLD, message: WORDS.NOT_BOUND, light: 'warn' })
    })

    it('두 창이 모두 숨으면 30초 뒤에만 경고하고, 하나라도 다시 보이면 바로 받는 중', async () => {
      const { hub, badge, clock } = setup()
      await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
      for (let i = 0; i < 2; i++) {
        clock.t += 10_000
        await hub.handle({ type: 'status', v: LIVE, hidden: true, read: 1, unread: 0 }, WATCH)
        await hub.handle({ type: 'status', v: LIVE, hidden: true, read: 1, unread: 0 }, POPOUT)
        expect(badge.text).toBe('ON')
      }
      clock.t += 10_000
      const warned = (await hub.handle({ type: 'status', v: LIVE, hidden: true, read: 1, unread: 0 }, POPOUT)) as HubView
      expect(warned.message).toBe(WORDS.HIDDEN)
      const back = (await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, POPOUT)) as HubView
      expect(back.message).toBe(WORDS.RECEIVING)
    })

    it('401(진짜 끊김)은 기다리지 않고 바로 알린다', async () => {
      const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
      const { fetcher } = server({ 'POST /ext/status': [{ status: 401, body: { error: { code: 'EXT_DISCONNECTED', message: '연결이 끊겼어요.' } } }] })
      const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers(), () => 5_000_000)
      const view = (await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 0, unread: 0 }, WATCH)) as HubView
      expect(view).toMatchObject({ connected: false, message: WORDS.DISCONNECTED, light: 'bad' })
    })
  
    describe('워커가 쉬었다 깨어나도 (MV3 — 메모리가 비어도)', () => {
      function restartable(bound: boolean) {
        const { chrome, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
        const reply = bound ? { status: 200, body: { bound: { id: 'b1', date: '2026-10-25', title: '저녁 방송' }, broadcasts: [] } } : { status: 200, body: { bound: null, broadcasts: [{ id: 'b1', date: '2026-10-25', title: '저녁 방송' }] } }
        const fetcher = () => {
          const { fetcher: f } = server({ 'GET /ext/broadcasts': [reply] })
          return f
        }
        const clock = { t: 3_000_000 }
        const make = (extra: Partial<typeof chrome> = {}) => new Hub({ ...chrome, ...extra }, ORIGIN, (url, init) => fetcher()(url, init), new FakeTimers(), () => clock.t)
        return { chrome, session, clock, make }
      }

      it('회차에 이어진 영상: 새 워커의 팝업이 "채팅 창 없음"이 아니라 받는 중', async () => {
        const { make, clock } = restartable(true)
        const first = make()
        await first.handle({ type: 'status', v: LIVE, hidden: false, read: 2, unread: 0 }, WATCH)
        await first.saved()
        // 워커가 쉬고(보고 사이) 팝업을 열어 새 워커가 뜬다
        clock.t += 5_000
        const second = make()
        const view = (await second.handle({ type: 'view' })) as HubView
        expect(view).toMatchObject({ video: LIVE, message: WORDS.RECEIVING, light: 'ok' })
      })

      it('이어지지 않은 영상: 새 워커의 팝업이 회차 고르기를 보인다', async () => {
        const { make, clock } = restartable(false)
        const first = make()
        await first.handle({ type: 'status', v: LIVE, hidden: false, read: 0, unread: 0 }, WATCH)
        await first.saved()
        clock.t += 5_000
        const view = (await make().handle({ type: 'view' })) as HubView
        expect(view).toMatchObject({ video: LIVE, message: WORDS.NOT_BOUND, notBound: true })
      })

      it('세션에 둔 마지막 보고가 90초보다 오래면 닫힌 것으로 보고, 표가 비면 유튜브 탭에 물어 채운다', async () => {
        const { make, clock } = restartable(true)
        const first = make()
        await first.handle({ type: 'status', v: OLD, hidden: false, read: 0, unread: 0 }, OLD_POPOUT)
        await first.saved()
        clock.t += FRAME_GONE_MS + 1
        const asked: unknown[] = []
        let second: Hub | null = null
        second = make({
          tabs: {
            query: () => Promise.resolve([{ id: 1 }]),
            sendMessage: (tabId: number, message: unknown) => {
              asked.push([tabId, message])
              // 시청 페이지 안 채팅 iframe의 content script가 지금 상태를 보낸다
              setTimeout(() => void second?.handle({ type: 'status', v: LIVE, hidden: false, read: 0, unread: 0 }, WATCH), 0)
              return Promise.resolve(undefined)
            },
          },
        })
        const view = (await second.handle({ type: 'view' })) as HubView
        expect(asked).toEqual([[1, { type: ASK_STATUS }]])
        expect(view).toMatchObject({ video: LIVE, message: WORDS.RECEIVING })
      })

      it('물어도 답이 없으면 기다림(ASK_WAIT_MS) 뒤 "채팅 창 없음"', async () => {
        const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
        const timers = new FakeTimers()
        const hub = new Hub({ ...chrome, tabs: { query: () => Promise.resolve([{ id: 4 }]), sendMessage: () => Promise.resolve(undefined) } }, ORIGIN, server({}).fetcher, timers, () => 1)
        const pending = hub.handle({ type: 'view' })
        await settle()
        expect(timers.delays()).toEqual([ASK_WAIT_MS])
        await timers.fire()
        expect(((await pending) as HubView).message).toBe(WORDS.NO_CHAT)
      })

      it('시청 페이지 안 채팅이 영상 ID를 못 꺼내 v 없이 보고하면, 보낸 탭(시청 페이지) 주소에서 정하고 content script에 알려 준다', async () => {
        const { make } = restartable(true)
        const hub = make()
        const iframe = { id: 'ext', url: 'https://www.youtube.com/live_chat?continuation=0ofMyANqGlhDaWtxSndvWVZVTjRPVGd3', tab: { id: 1, url: `https://www.youtube.com/watch?v=${LIVE}` }, frameId: 7 }
        const reply = (await hub.handle({ type: 'status', v: null, hidden: false, read: 0, unread: 0 }, iframe)) as HubView & { frameVideo: string | null }
        expect(reply).toMatchObject({ frameVideo: LIVE, video: LIVE, message: WORDS.RECEIVING })
        expect(((await hub.handle({ type: 'view' })) as HubView).message).toBe(WORDS.RECEIVING)
      })

      it('보고 시각만 바뀌면 세션에 FRAMES_SAVE_MS에 한 번만 쓴다', async () => {
        const { make, clock, session } = restartable(true)
        const hub = make()
        await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
        await hub.saved()
        const firstSaved = JSON.stringify(session[FRAMES_KEY])
        clock.t += 5_000
        await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
        await hub.saved()
        expect(JSON.stringify(session[FRAMES_KEY])).toBe(firstSaved)
        clock.t += FRAMES_SAVE_MS
        await hub.handle({ type: 'status', v: LIVE, hidden: false, read: 1, unread: 0 }, WATCH)
        await hub.saved()
        expect(JSON.stringify(session[FRAMES_KEY])).not.toBe(firstSaved)
        // 모양이 바뀌면(숨음) 바로 쓴다
        const before = JSON.stringify(session[FRAMES_KEY])
        clock.t += 1_000
        await hub.handle({ type: 'status', v: LIVE, hidden: true, read: 1, unread: 0 }, WATCH)
        await hub.saved()
        expect(JSON.stringify(session[FRAMES_KEY])).not.toBe(before)
      })
    })
  })
})
