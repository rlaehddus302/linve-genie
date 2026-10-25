// 틱톡 보내기·대기열·팝업 줄 (AC-TTX-10·22·23, D-TTX-08) — 가짜 서버·가짜 타이머
import { describe, expect, it } from 'vitest'
import { Hub, QUEUE_KEY, TOKEN_KEY, type HubView } from '../src/hub.ts'
import { TT_QUEUE_KEY } from '../src/tiktok-hub.ts'
import { TikTokOutbox, TT_BATCH_MAX, TT_FLUSH_MS, TT_HOLD_MAX, type TikTokOutboxEvent } from '../src/tiktok-outbox.ts'
import type { TikTokItem } from '../src/tiktok-reader.ts'
import { TT_WORDS } from '../src/words.ts'
import { fail, FakeApi, FakeTimers, fakeChrome, message, ok, settle } from './fakes.ts'

const ORIGIN = 'http://localhost:5173'
const TAB = 7
const tiktokSender = (url = 'https://www.tiktok.com/@seller_kim/live', tab = TAB) => ({ id: 'ext', tab: { id: tab }, url })

function item(n: number): TikTokItem {
  return { commentId: `73010000000${String(n).padStart(8, '0')}`, userId: `71010000000${String(n).padStart(8, '0')}`, uniqueId: `buyer_${String(n)}`, nickname: '홍길동', text: `${String(n)}` }
}
const items = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i))

function outbox(api = new FakeApi()) {
  const timers = new FakeTimers()
  const events: TikTokOutboxEvent[] = []
  const box = new TikTokOutbox(api, timers, (event) => events.push(event))
  const sent = () => api.calls.filter((c) => c.path === '/ext/tiktok/chats').map((c) => (c.body?.['items'] as TikTokItem[]).map((i) => i.text))
  return { api, timers, events, box, sent }
}

describe('AC-TTX-10: 틱톡 묶음 보내기', () => {
  it('(1) 1초마다 묶음 하나, 50개가 차면 바로, 요청당 50개까지', async () => {
    const { api, timers, box, sent } = outbox()
    api.fallback = ok({ result: 'recorded', recorded: 1 })
    box.add(TAB, 'seller_kim', [item(1)])
    expect(timers.delays()).toEqual([TT_FLUSH_MS])
    await timers.fire()
    expect(sent()).toEqual([['1']])
    expect(api.calls[0]?.body).toEqual({ pageId: 'seller_kim', items: [item(1)] })
    box.add(TAB, 'seller_kim', items(1, 120))
    expect(timers.delays()).toEqual([0])
    await timers.fire()
    await timers.fire()
    await timers.fire()
    expect(sent().slice(1).map((batch) => batch.length)).toEqual([TT_BATCH_MAX, TT_BATCH_MAX, 20])
  })

  it('(2) 한 번에 하나만 — 앞 응답 전엔 다음을 보내지 않고, 서버가 받은 순서 = 붙은 순서', async () => {
    let release: (() => void) | null = null
    const api = new FakeApi()
    const calls: string[][] = []
    api.call = (_method, path, body) => {
      calls.push((body?.['items'] as TikTokItem[]).map((i) => i.text))
      api.calls.push({ method: 'POST', path, body })
      return new Promise((resolve) => {
        release = () => resolve(ok({ result: 'recorded' }))
      })
    }
    const { timers, box } = outbox(api)
    box.add(TAB, 'seller_kim', [item(1)])
    const first = box.flush()
    box.add(TAB, 'seller_kim', [item(2)])
    await box.flush()
    await timers.fire()
    expect(calls).toEqual([['1']])
    ;(release as unknown as () => void)()
    await first
    await timers.fire()
    expect(calls).toEqual([['1'], ['2']])
  })

  it('(3) 429·네트워크 오류·500이면 기다렸다 같은 순서로 다시, (4) standby는 성공으로 보고 다시 보내지 않는다', async () => {
    const { api, timers, box, sent, events } = outbox()
    api.replies.push(fail(429, 'EXT_RATE_LIMITED', null, 3000), fail(0, 'NETWORK'), fail(500, 'SAVE_FAILED'), ok({ result: 'standby', standby: 3 }))
    box.add(TAB, 'seller_kim', items(1, 3))
    await timers.fire()
    expect(timers.delays()).toEqual([3000])
    await timers.fire()
    expect(timers.delays()).toEqual([1000])
    await timers.fire()
    expect(timers.delays()).toEqual([2000])
    await timers.fire()
    expect(sent()).toEqual([['1', '2', '3'], ['1', '2', '3'], ['1', '2', '3'], ['1', '2', '3']])
    expect(box.size).toBe(0)
    expect(events.at(-1)).toEqual({ kind: 'sent', result: 'standby' })
    await timers.fire()
    expect(sent()).toHaveLength(4)
  })

  it('남의 방송(403)·연결 회차 없음·동의 꺼짐·운영자 꺼짐(409)·모양 틀림(400)은 그 묶음을 버린다', async () => {
    const { api, timers, box, events } = outbox()
    api.replies.push(fail(403, 'NOT_OWN_LIVE'), fail(409, 'NOT_LINKED'), fail(409, 'NO_CONSENT'), fail(409, 'PLATFORM_NOT_READY'), fail(400, 'UNKNOWN_FIELD'))
    for (const n of [1, 2, 3, 4, 5]) {
      box.add(TAB, 'seller_kim', [item(n)])
      await timers.fire()
      expect(box.size).toBe(0)
    }
    expect(events).toEqual([
      { kind: 'blocked', code: 'NOT_OWN_LIVE' },
      { kind: 'blocked', code: 'NOT_LINKED' },
      { kind: 'blocked', code: 'NO_CONSENT' },
      { kind: 'blocked', code: 'PLATFORM_NOT_READY' },
    ])
  })

  it('(5) 500개까지 붙들고, 넘으면 오래된 것부터 버리고 센다', async () => {
    const { api, box } = outbox()
    api.fallback = fail(500, 'SAVE_FAILED')
    box.add(TAB, 'seller_kim', items(1, TT_HOLD_MAX + 7))
    expect(box.size).toBe(TT_HOLD_MAX)
    expect(box.dropped).toBe(7)
    expect(box.snapshot().items[0]?.item.text).toBe('8')
  })

  it('화면을 떠난 탭의 아직 보내지 않은 댓글은 버린다 (다른 탭 것은 그대로)', () => {
    const { box } = outbox()
    box.add(TAB, 'seller_kim', items(1, 3))
    box.add(9, 'seller_kim', items(4, 5))
    box.dropTab(TAB)
    expect(box.snapshot().items.map((held) => held.item.text)).toEqual(['4', '5'])
  })

  it('TD-TTX-001: 다시 보내기를 기다리는 동안 화면을 떠나 대기열이 비어도, 돌아와 붙은 댓글은 보낸다 (429·500·닿지 못함)', async () => {
    for (const failure of [fail(429, 'RATE_LIMITED', null, 2000), fail(500, 'SAVE_FAILED'), fail(0, 'NETWORK')]) {
      const { api, timers, box, sent } = outbox()
      api.replies.push(failure)
      api.fallback = ok({ result: 'recorded', recorded: 1 })
      box.add(TAB, 'seller_kim', [item(1)])
      await timers.fire()
      expect(sent(), String(failure.status)).toEqual([['1']])
      box.dropTab(TAB)
      expect(box.size).toBe(0)
      // 다시 보내기 타이머가 빈 대기열에서 돈다
      await timers.fire()
      expect(timers.delays()).toEqual([])
      // 다시 내 방송 화면: 새 댓글
      box.add(TAB, 'seller_kim', [item(2)])
      expect(timers.delays(), String(failure.status)).toEqual([TT_FLUSH_MS])
      await timers.fire()
      expect(sent(), String(failure.status)).toEqual([['1'], ['2']])
      expect(box.size).toBe(0)
    }
  })

  it('TD-TTX-001: 기다리는 시간 안에 돌아와 붙은 댓글은 그 시간(Retry-After)을 지키고 그 타이머에 보낸다', async () => {
    const { api, timers, box, sent } = outbox()
    api.replies.push(fail(429, 'RATE_LIMITED', null, 5000))
    api.fallback = ok({ result: 'recorded', recorded: 1 })
    box.add(TAB, 'seller_kim', [item(1)])
    await timers.fire()
    box.dropTab(TAB)
    box.add(TAB, 'seller_kim', [item(2)])
    expect(timers.delays()).toEqual([5000])
    await timers.fire()
    expect(sent()).toEqual([['1'], ['2']])
  })
})

/** 가짜 서버 (fetch 모양) — 경로마다 답을 정한다 */
type Reply = { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }

function server(replies: Record<string, Reply[]> = {}) {
  const calls: { key: string; body: unknown }[] = []
  const fetcher = (url: string, init: RequestInit) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    calls.push({ key, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const info = { tiktokId: 'seller_kim', mode: 'recording', code: null, message: TT_WORDS.RECORDING, broadcast: 'b1' }
    const fallback: Reply =
      key === 'POST /ext/tiktok/chats'
        ? { status: 200, body: { result: 'recorded', recorded: 1, standby: 0, dropped: 0, duplicates: 0, broadcast: 'b1', message: TT_WORDS.RECORDING } }
        : key === 'GET /ext/tiktok' || key === 'POST /ext/tiktok/status'
          ? { status: 200, body: info }
          : { status: 200, body: { recorded: 0, skipped: 0 } }
    const reply = replies[key]?.shift() ?? fallback
    return Promise.resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } }))
  }
  return { calls, fetcher, ttChats: () => calls.filter((c) => c.key === 'POST /ext/tiktok/chats') }
}

const status = (screen: string, extra: Record<string, unknown> = {}) => ({ type: 'ttStatus', screen, hidden: false, read: 0, unread: 0, ...extra })

describe('서비스 워커의 틱톡 몫', () => {
  it('틱톡 화면이 물으면 판매자 아이디를 서버에서 받아 알려 준다, 연결 전이면 알려 주지 않는다', async () => {
    const before = fakeChrome()
    const none = new Hub(before.chrome, ORIGIN, server().fetcher, new FakeTimers())
    expect(await none.handle({ type: 'ttInfo' }, tiktokSender())).toEqual({ connected: false, tiktokId: null })
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    expect(await hub.handle({ type: 'ttInfo' }, tiktokSender())).toEqual({ connected: true, tiktokId: 'seller_kim' })
    expect(s.calls.map((c) => c.key)).toEqual(['GET /ext/tiktok'])
    // 10초 안에는 다시 묻지 않는다
    await hub.handle({ type: 'ttInfo' }, tiktokSender())
    expect(s.calls).toHaveLength(1)
  })

  it('틱톡 메시지는 www.tiktok.com 탭에서 온 것만, 유튜브 메시지는 틱톡 탭에서 받지 않는다', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    expect(await hub.handle({ type: 'ttInfo' }, { id: 'ext', tab: { id: 1 }, url: 'https://evil.example/@seller_kim/live' })).toBeUndefined()
    expect(await hub.handle({ type: 'ttInfo' }, { id: 'ext', url: 'chrome-extension://ext/popup.html' })).toBeUndefined()
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: [item(1)] }, { id: 'ext', tab: { id: 1 }, url: 'https://www.youtube.com/live_chat?v=abcdEFGH123' })
    expect(hub.tiktok.outbox.size).toBe(0)
    await hub.handle({ type: 'chats', v: 'abcdEFGH123', messages: [message(1)] }, tiktokSender())
    expect(hub.outbox.size).toBe(0)
    expect(s.calls).toHaveLength(0)
  })

  it('보내는 항목은 서버가 받는 다섯 칸만 (시각·owner 같은 칸은 빼고)', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const timers = new FakeTimers()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, timers)
    await hub.handle({ type: 'ttChats', pageId: 'Seller_Kim', items: [{ ...item(1), owner: true, postedAt: 1 }] }, tiktokSender())
    await timers.fire()
    await settle()
    expect(s.ttChats()[0]?.body).toEqual({ pageId: 'Seller_Kim', items: [item(1)] })
  })

  it('(6) 서비스 워커가 멈췄다 다시 떠도 이어 보낸다(중복 없이), (7) storage.local엔 댓글이 없다, (8) 끊기면 틱톡 대기열이 빈다', async () => {
    const { chrome, store, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const down = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }] })
    const first = new Hub(chrome, ORIGIN, down.fetcher, timers)
    await first.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 12) }, tiktokSender())
    await timers.fire()
    await first.saved()
    expect((session[TT_QUEUE_KEY] as { items: unknown[] }).items).toHaveLength(12)
    expect(session[QUEUE_KEY]).toBeUndefined()
    expect(JSON.stringify(store)).not.toMatch(/홍길동|buyer_|seller_kim|7301/)
    const up = server()
    const second = new Hub(chrome, ORIGIN, up.fetcher, new FakeTimers())
    await second.handle({ type: 'view' })
    expect(second.tiktok.outbox.size).toBe(12)
    await second.tiktok.outbox.flush()
    await second.saved()
    expect(up.ttChats().map((c) => (c.body as { items: TikTokItem[] }).items.map((i) => i.text))).toEqual([items(1, 12).map((i) => i.text)])
    expect(session[TT_QUEUE_KEY]).toBeUndefined()
    // 다시 붙들었다가 "연결 지우기" → 틱톡 대기열 비움
    const stuck = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }] })
    const third = new Hub(chrome, ORIGIN, stuck.fetcher, timers)
    await third.handle({ type: 'ttChats', pageId: 'seller_kim', items: [item(1)] }, tiktokSender())
    await third.saved()
    expect(session[TT_QUEUE_KEY]).toBeDefined()
    await third.handle({ type: 'forget' })
    expect(session[TT_QUEUE_KEY]).toBeUndefined()
    expect(third.tiktok.outbox.size).toBe(0)
  })

  it('(8) 401(끊김)이면 틱톡 대기열도 비우고 토큰을 지운다', async () => {
    const { chrome, store, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const s = server({ 'POST /ext/tiktok/chats': [{ status: 401, body: { error: { code: 'EXT_DISCONNECTED', message: '연결이 끊겼어요.' } } }] })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, timers)
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 3) }, tiktokSender())
    await timers.fire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await hub.saved()
    expect(store[TOKEN_KEY]).toBeUndefined()
    expect(session[TT_QUEUE_KEY]).toBeUndefined()
    expect(hub.tiktok.outbox.size).toBe(0)
  })

  it('(9) 유튜브 대기열이 500개로 차 있어도 틱톡 댓글은 버려지지 않는다 (그 반대도)', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const s = server({})
    const hub = new Hub(chrome, ORIGIN, s.fetcher, timers)
    await hub.handle({ type: 'chats', v: 'abcdEFGH123', messages: Array.from({ length: 520 }, (_, i) => message(i + 1)) }, { id: 'ext', tab: { id: 1 }, url: 'https://www.youtube.com/live_chat?v=abcdEFGH123' })
    expect(hub.outbox.size).toBe(500)
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 30) }, tiktokSender())
    expect(hub.tiktok.outbox.size).toBe(30)
    expect(hub.tiktok.outbox.dropped).toBe(0)
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(31, 600) }, tiktokSender())
    expect(hub.tiktok.outbox.size).toBe(500)
    expect(hub.outbox.size).toBe(500)
    expect(hub.outbox.dropped).toBe(20)
  })

  it('상태는 유튜브 /ext/status와 따로 /ext/tiktok/status로, 틱톡 탭이 여럿이면 내 방송 탭의 것을', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await hub.handle(status('OWN', { read: 4, unread: 1 }), tiktokSender())
    await hub.handle(status('ELSEWHERE'), tiktokSender('https://www.tiktok.com/foryou', 9))
    const posted = s.calls.filter((c) => c.key === 'POST /ext/tiktok/status').map((c) => c.body)
    expect(posted).toEqual([
      { screen: 'OWN', hidden: false, read: 4, unread: 1 },
      { screen: 'OWN', hidden: false, read: 4, unread: 1 },
    ])
    expect(s.calls.some((c) => c.key === 'POST /ext/status')).toBe(false)
  })

  it('닫힌 탭(25초 넘게 상태 없음)은 빼고 본다', async () => {
    let now = 1_000_000
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers(), () => now)
    await hub.handle(status('OWN'), tiktokSender())
    now += 30_000
    await hub.handle(status('ELSEWHERE'), tiktokSender('https://www.tiktok.com/foryou', 9))
    expect(s.calls.filter((c) => c.key === 'POST /ext/tiktok/status').at(-1)?.body).toMatchObject({ screen: 'ELSEWHERE' })
  })
})

describe('AC-TTX-22: 팝업 틱톡 줄', () => {
  async function viewAfter(replies: Parameters<typeof server>[0], steps: (hub: Hub, timers: FakeTimers) => Promise<void>): Promise<HubView> {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const hub = new Hub(chrome, ORIGIN, server(replies).fetcher, timers)
    await steps(hub, timers)
    return (await hub.handle({ type: 'view' })) as HubView
  }
  type Step = (hub: Hub, timers: FakeTimers) => Promise<void>
  const on =
    (message: Record<string, unknown>, sender: ReturnType<typeof tiktokSender>): Step =>
    async (hub) => {
      await hub.handle(message, sender)
    }
  const info = (body: Record<string, unknown>) => [{ status: 200, body: { tiktokId: 'seller_kim', mode: 'recording', code: null, message: 'x', broadcast: 'b1', ...body } }]
  const send = async (hub: Hub, timers: FakeTimers) => {
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: [item(1)] }, tiktokSender())
    await timers.fire()
    await settle()
  }

  it('틱톡 화면을 본 적 없으면 틱톡 줄이 없다', async () => {
    expect((await viewAfter({}, () => Promise.resolve())).tiktok).toBeNull()
  })

  it.each([
    ['보내는 중', {}, on(status('OWN'), tiktokSender()), TT_WORDS.RECORDING, 'ok'],
    ['대기 (상태 응답)', { 'POST /ext/tiktok/status': info({ mode: 'standby' }) }, on(status('OWN'), tiktokSender()), TT_WORDS.STANDBY, 'ok'],
    ['남의 방송', {}, on(status('OTHER'), tiktokSender('https://www.tiktok.com/@other_seller/live')), TT_WORDS.NOT_OWN_LIVE, 'warn'],
    ['다른 틱톡 화면', {}, on(status('ELSEWHERE'), tiktokSender('https://www.tiktok.com/foryou')), TT_WORDS.ELSEWHERE_PAGE, 'off'],
    ['아이디 없음', { 'POST /ext/tiktok/status': info({ tiktokId: null, mode: 'blocked', code: 'NO_TIKTOK_ID' }) }, on(status('OTHER'), tiktokSender()), TT_WORDS.NO_TIKTOK_ID, 'warn'],
    ['연결 회차 없음', { 'POST /ext/tiktok/status': info({ mode: 'blocked', code: 'NOT_LINKED' }) }, on(status('OWN'), tiktokSender()), TT_WORDS.NOT_LINKED, 'warn'],
    ['동의 꺼짐', { 'POST /ext/tiktok/status': info({ mode: 'blocked', code: 'NO_CONSENT' }) }, on(status('OWN'), tiktokSender()), TT_WORDS.NO_CONSENT, 'warn'],
    ['운영자 꺼짐', { 'POST /ext/tiktok/status': info({ mode: 'blocked', code: 'PLATFORM_NOT_READY' }) }, on(status('OWN'), tiktokSender()), TT_WORDS.PLATFORM_NOT_READY, 'warn'],
    ['뒤로 감', {}, on(status('OWN', { hidden: true }), tiktokSender()), TT_WORDS.HIDDEN, 'warn'],
  ] as const)('%s', async (_name, replies, steps, words, light) => {
    const view = await viewAfter({ ...replies }, steps)
    expect(view.tiktok).toEqual({ message: words, light, overflow: null })
  })

  it('보낸 묶음의 응답 코드(대기·연결 회차 없음)에 맞는 문장', async () => {
    const standby = await viewAfter({ 'POST /ext/tiktok/chats': [{ status: 200, body: { result: 'standby', recorded: 0, standby: 1 } }] }, async (hub, timers) => {
      await hub.handle(status('OWN'), tiktokSender())
      await send(hub, timers)
    })
    expect(standby.tiktok?.message).toBe(TT_WORDS.STANDBY)
    const blocked = await viewAfter({ 'POST /ext/tiktok/chats': [{ status: 409, body: { error: { code: 'NOT_LINKED', message: TT_WORDS.NOT_LINKED } } }] }, async (hub, timers) => {
      await hub.handle(status('OWN'), tiktokSender())
      await send(hub, timers)
    })
    expect(blocked.tiktok?.message).toBe(TT_WORDS.NOT_LINKED)
  })

  it('놓친 댓글 (대기열 넘침)', async () => {
    const view = await viewAfter({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }] }, async (hub) => {
      await hub.handle(status('OWN'), tiktokSender())
      await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 501) }, tiktokSender())
    })
    expect(view.tiktok?.overflow).toBe(TT_WORDS.OVERFLOW)
  })

  it('AC-TTX-31: 팝업 틱톡 문장에 영어 코드·개발 낱말이 없다', () => {
    for (const words of Object.values(TT_WORDS)) {
      expect(words).not.toMatch(/[A-Z]{3,}|standby|DOM|토큰|API/)
    }
  })
})
