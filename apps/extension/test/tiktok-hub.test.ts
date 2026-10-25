// 틱톡 보내기·대기열·팝업 줄 (AC-TTX-10·22·23, D-TTX-08) — 가짜 서버·가짜 타이머
import { describe, expect, it } from 'vitest'
import { Hub, QUEUE_KEY, TOKEN_KEY, type HubView } from '../src/hub.ts'
import { TT_QUEUE_KEY } from '../src/tiktok-hub.ts'
import { TT_DROPPED_REPORT_MAX } from '../src/tiktok-outbox.ts'
import { TikTokOutbox, TT_BATCH_MAX, TT_FLUSH_MS, TT_HOLD_MAX, type TikTokOutboxEvent } from '../src/tiktok-outbox.ts'
import type { TikTokItem } from '../src/tiktok-reader.ts'
import { TT_WORDS } from '../src/words.ts'
import type { Api, ApiResult } from '../src/api.ts'
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
      { screen: 'OWN', hidden: false, read: 4, unread: 1, dropped: 0 },
      { screen: 'OWN', hidden: false, read: 4, unread: 1, dropped: 0 },
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

describe('AC-TTX-32 (D-TTX-16): 확장이 버린 틱톡 댓글 수를 다음 상태에 싣는다', () => {
  const statusBodies = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.key === 'POST /ext/tiktok/status').map((c) => (c.body as { dropped: unknown }).dropped)

  it('(1) 대기열이 넘쳐 3개 버림 → 다음 상태에 dropped 3, 서버가 받은 뒤에는 0', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }] })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_HOLD_MAX + 3) }, tiktokSender())
    expect(hub.tiktok.outbox.unreported).toBe(3)
    await hub.handle(status('OWN'), tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([3, 0])
    expect(hub.tiktok.outbox.unreported).toBe(0)
    // 팝업의 "놓친 틱톡 댓글" 표시는 그대로 (켠 뒤 누적)
    expect(hub.tiktok.outbox.dropped).toBe(3)
  })

  it('(2) 상태 요청이 실패하면(500·429·닿지 못함·400) 버린 수가 남아 다음 상태에 더해 실린다', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server({
      'POST /ext/tiktok/chats': [{ status: 500, body: {} }],
      'POST /ext/tiktok/status': [{ status: 500, body: {} }, { status: 429, body: {}, headers: { 'Retry-After': '1' } }, { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'x' } } }],
    })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_HOLD_MAX + 2) }, tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(600, 600) }, tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    await hub.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([2, 3, 3, 3, 0])
  })

  it('(9) 워커가 상태 알림 도중 멈췄다 다시 뜨면 그 알림의 수는 다시 싣지 않고, 아직 떼어 두지 않은 수만 다시 싣는다 (D-TTX-21 (2))', async () => {
    const { chrome, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    let hang = true
    const s = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }] })
    const fetcher = (url: string, init: RequestInit) => (hang && new URL(url).pathname === '/ext/tiktok/status' ? new Promise<Response>(() => undefined) : s.fetcher(url, init))
    const first = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
    await first.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_HOLD_MAX + 4) }, tiktokSender())
    void first.handle(status('OWN'), tiktokSender())
    await settle()
    await first.saved()
    // 알리는 중인 4개는 세션에 두지 않는다 — 서버가 받았을 수 있다(두 번 세면 붙여넣기 이중 찜)
    expect((session[TT_QUEUE_KEY] as { unreported: number }).unreported).toBe(0)
    // 알리는 동안 새로 넘친 2개는 아직 떼어 두지 않았으니 세션에 남는다(잃지 않음)
    await first.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(2000, 2001) }, tiktokSender())
    await first.saved()
    expect((session[TT_QUEUE_KEY] as { unreported: number }).unreported).toBe(2)
    hang = false
    const second = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await second.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([2])
    expect(second.tiktok.outbox.unreported).toBe(0)
  })

  it('(2) 살아 있는 워커가 받은 상태 실패는 세션에도 다시 남는다 (워커가 그 뒤 다시 떠도 잃지 않음)', async () => {
    const { chrome, session } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }], 'POST /ext/tiktok/status': [{ status: 500, body: {} }] })
    const first = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await first.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_HOLD_MAX + 4) }, tiktokSender())
    await first.handle(status('OWN'), tiktokSender())
    await first.saved()
    expect((session[TT_QUEUE_KEY] as { unreported: number }).unreported).toBe(4)
    const second = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await second.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([4, 4])
  })

  it('(3) 내 방송 주소를 벗어나 아직 보내지 않은 댓글 2개를 버림 → dropped 2', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 2) }, tiktokSender())
    await hub.handle({ type: 'ttLeave' }, tiktokSender())
    expect(hub.tiktok.outbox.size).toBe(0)
    await hub.handle(status('ELSEWHERE'), tiktokSender('https://www.tiktok.com/foryou'))
    expect(statusBodies(s)).toEqual([2])
  })

  it('(4) 세지 않음: 409로 거절된 묶음, standby, 서버에 닿지 못해 다시 보내는 중', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const timers = new FakeTimers()
    const s = server({
      'POST /ext/tiktok/chats': [
        { status: 409, body: { error: { code: 'NOT_LINKED', message: TT_WORDS.NOT_LINKED } } },
        { status: 200, body: { result: 'standby', recorded: 0, standby: 1 } },
        { status: 500, body: {} },
      ],
    })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, timers)
    for (const n of [1, 2, 3]) {
      await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: [item(n)] }, tiktokSender())
      await timers.fire()
      await settle()
    }
    await hub.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([0])
    expect(hub.tiktok.outbox.size).toBe(1)
  })

  it('(4) "끊기"(연결 지우기)로 지운 대기열과 버린 수는 세지 않는다 — 다시 이어도 0', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server({ 'POST /ext/tiktok/chats': [{ status: 500, body: {} }], 'POST /ext/connect': [{ status: 200, body: { token: 'tok2' } }] })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_HOLD_MAX + 5) }, tiktokSender())
    await hub.handle({ type: 'forget' })
    expect(hub.tiktok.outbox.unreported).toBe(0)
    await hub.handle({ type: 'connect', code: '12345678' })
    await hub.handle(status('OWN'), tiktokSender())
    expect(statusBodies(s)).toEqual([0])
  })

  describe('(8) 날아가는 묶음 (D-TTX-21 (1)): 떠남·넘침 때 세지 않고 답으로 정한다', () => {
    const replies: Record<string, ApiResult> = {
      recorded: ok({ result: 'recorded' }),
      standby: ok({ result: 'standby' }),
      '409': fail(409, 'NOT_LINKED'),
      '400': fail(400, 'INVALID_INPUT'),
      '429': fail(429, 'EXT_RATE_LIMITED', 'x', 1000),
      '500': fail(500, 'SAVE_FAILED', 'x'),
      '503': fail(503, null, 'x'),
      '408': fail(408, null, 'x'),
      net: fail(0, 'NETWORK', 'x'),
    }
    const counted: Record<string, number> = { recorded: 0, standby: 0, '409': 0, '400': 0, '429': 1, '500': 1, '503': 1, '408': 1, net: 1 }
    const hanging = () => {
      const calls: TikTokItem[][] = []
      let answer: ((r: ApiResult) => void) | null = null
      const api: Api = {
        call: (_m, path, body) => {
          if (path === '/ext/tiktok/chats') calls.push(body?.['items'] as TikTokItem[])
          return new Promise<ApiResult>((resolve) => (answer = resolve))
        },
      }
      const snapshots: (number | undefined)[] = []
      const box = new TikTokOutbox(api, new FakeTimers(), () => undefined, (snap) => snapshots.push(snap.unreported))
      return { box, calls, snapshots, reply: async (r: ApiResult) => { (answer as ((r: ApiResult) => void) | null)?.(r); await settle() } }
    }

    for (const [name, reply] of Object.entries(replies)) {
      it(`화면 떠남 → 답 ${name} → dropped ${String(counted[name])}, 다시 보내지 않음`, async () => {
        const { box, calls, snapshots, reply: answer } = hanging()
        box.add(TAB, 'seller_kim', items(1, 1))
        void box.flush()
        box.dropTab(TAB)
        expect(box.size).toBe(0)
        expect(box.unreported, '답 전에는 세지 않음').toBe(0)
        await answer(reply)
        expect(box.unreported).toBe(counted[name])
        expect(snapshots.at(-1), '세션 저장 수').toBe(counted[name])
        expect(box.takeDropped().count).toBe(counted[name])
        await box.flush()
        expect(calls.length, '떠난 묶음을 다시 보냄').toBe(1)
      })

      it(`넘침으로 날아가는 묶음이 잘림 → 답 ${name} → dropped ${String(counted[name])}`, async () => {
        const { box, calls, reply: answer } = hanging()
        box.add(TAB, 'seller_kim', items(1, 1))
        void box.flush()
        box.add(TAB, 'seller_kim', items(100, 100 + TT_HOLD_MAX - 1))
        expect(box.size).toBe(TT_HOLD_MAX)
        expect(box.unreported, '답 전에는 세지 않음').toBe(0)
        expect(box.dropped, '팝업 "놓친 틱톡 댓글" 누적도 답 전에는 세지 않음 (D-TTX-21 (3))').toBe(0)
        await answer(reply)
        expect(box.unreported).toBe(counted[name])
        expect(box.dropped, '팝업 누적 = 답이 실패일 때만 1').toBe(counted[name])
        expect(calls[0]?.map((i) => i.commentId)).toEqual([item(1).commentId])
        expect(box.snapshot().items.some((held) => held.item.commentId === item(1).commentId), '잘린 묶음이 대기열에 돌아옴').toBe(false)
      })
    }

    it('떠나지 않은 묶음의 429·5xx·닿지 못함은 다시 보내고 세지 않는다', async () => {
      for (const name of ['429', '500', 'net'] as const) {
        const { box, calls, reply: answer } = hanging()
        box.add(TAB, 'seller_kim', items(1, 1))
        void box.flush()
        await answer(replies[name] as ApiResult)
        expect(box.unreported, name).toBe(0)
        expect(box.size, name).toBe(1)
        void box.flush()
        expect(calls.length, name).toBe(2)
      }
    })

    it('묶음 일부만 떠난 탭의 것이면 그 수만 센다 · 남은 것은 다시 보낸다', async () => {
      const { box, calls, reply: answer } = hanging()
      box.add(TAB, 'seller_kim', items(1, 2))
      box.add(TAB + 1, 'seller_kim', items(3, 5))
      void box.flush()
      expect(calls[0]?.length).toBe(5)
      box.dropTab(TAB)
      await answer(replies['500'] as ApiResult)
      expect(box.unreported).toBe(2)
      expect(box.size).toBe(3)
    })

    it('날아가는 동안 "끊기" → 늦은 실패 답이 수를 되살리지 않는다', async () => {
      const { box, reply: answer } = hanging()
      box.add(TAB, 'seller_kim', items(1, 1))
      void box.flush()
      box.dropTab(TAB)
      box.stop()
      box.resume()
      await answer(replies['500'] as ApiResult)
      expect(box.unreported).toBe(0)
    })

    it('워커가 멈출 때 날아가던 떠난 묶음은 세션에 없다 → 다시 떠도 세지 않는다', () => {
      const { box, snapshots } = hanging()
      box.add(TAB, 'seller_kim', items(1, 1))
      void box.flush()
      box.dropTab(TAB)
      const saved = box.snapshot()
      expect(saved.items).toEqual([])
      expect(snapshots.at(-1)).toBe(0)
      const next = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
      next.restore(saved)
      expect(next.takeDropped().count).toBe(0)
    })
  })

  describe('(10) 팝업 수 (D-TTX-21 (3)): 날아가는 묶음이 넘침으로 잘리면 팝업 수도 답으로 정한다', () => {
    const PHRASE = '놓친 틱톡 댓글이 있어요. 라이브지니에서 댓글을 붙여 넣어 주세요.'
    // 첫 틱톡 묶음 요청만 붙잡아 두는 가짜 서버 — 나머지는 server()의 기본 답
    function heldWorld() {
      const s = server()
      let release: ((reply: Reply) => void) | null = null
      let held = false
      const fetcher = (url: string, init: RequestInit) => {
        if (!held && `${init.method ?? 'GET'} ${new URL(url).pathname}` === 'POST /ext/tiktok/chats') {
          held = true
          s.calls.push({ key: 'POST /ext/tiktok/chats', body: JSON.parse(String(init.body)) })
          return new Promise<Response>((resolve) => {
            release = (reply) => resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } }))
          })
        }
        return s.fetcher(url, init)
      }
      const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
      const hub = new Hub(chrome, ORIGIN, fetcher, new FakeTimers())
      const answer = async (reply: Reply) => {
        ;(release as ((reply: Reply) => void) | null)?.(reply)
        for (let i = 0; i < 4; i++) await settle()
      }
      const popup = async () => ((await hub.handle({ type: 'view' })) as HubView).tiktok?.overflow ?? null
      return { hub, s, answer, popup }
    }
    const replies: Record<string, Reply> = {
      '200': { status: 200, body: { result: 'recorded', recorded: 50, standby: 0, dropped: 0, duplicates: 0, broadcast: 'b1', message: TT_WORDS.RECORDING } },
      standby: { status: 200, body: { result: 'standby', recorded: 0, standby: 50 } },
      '409': { status: 409, body: { error: { code: 'NOT_LINKED', message: TT_WORDS.NOT_LINKED } } },
      '400': { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'x' } } },
      '429': { status: 429, body: { error: { code: 'EXT_RATE_LIMITED', message: 'x' } }, headers: { 'Retry-After': '1' } },
      '500': { status: 500, body: {} },
      '503': { status: 503, body: {} },
    }
    const failed = new Set(['429', '500', '503'])
    const K = 3

    for (const [name, reply] of Object.entries(replies)) {
      it(`50개 묶음이 날아가는 동안 500 + ${String(K)}개 → 잘린 ${String(K)}개는 모두 날아가던 것 → 답 ${name} → 팝업 수 ${failed.has(name) ? String(K) : '0'}`, async () => {
        const { hub, s, answer, popup } = heldWorld()
        await hub.handle(status('OWN'), tiktokSender())
        await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_BATCH_MAX) }, tiktokSender())
        void hub.tiktok.outbox.flush()
        await settle()
        expect(s.ttChats().length).toBe(1)
        await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1000, 1000 + TT_HOLD_MAX - TT_BATCH_MAX + K - 1) }, tiktokSender())
        expect(hub.tiktok.outbox.size).toBe(TT_HOLD_MAX)
        expect(hub.tiktok.outbox.dropped, '답 전에는 팝업 수에 넣지 않음').toBe(0)
        expect(await popup(), '답 전에는 붙여 넣으라고 하지 않음').toBeNull()
        await answer(reply)
        expect(hub.tiktok.outbox.dropped).toBe(failed.has(name) ? K : 0)
        expect(await popup()).toBe(failed.has(name) ? PHRASE : null)
      })
    }

    it('날아가지 않던 댓글이 잘린 몫 j는 잘릴 때 바로 팝업 수에 든다 — 합계 = j + 실패일 때 k', async () => {
      const J = 4
      for (const [name, total] of [['200', J], ['503', J + TT_BATCH_MAX]] as const) {
        const { hub, answer, popup } = heldWorld()
        await hub.handle(status('OWN'), tiktokSender())
        await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, TT_BATCH_MAX) }, tiktokSender())
        void hub.tiktok.outbox.flush()
        await settle()
        // 날아가는 50개 전부(k = 50)와 그 뒤의 j개가 잘린다
        await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1000, 1000 + TT_HOLD_MAX + J - 1) }, tiktokSender())
        expect(hub.tiktok.outbox.dropped, `${name}: 잘릴 때 바로 j`).toBe(J)
        expect(await popup(), name).toBe(PHRASE)
        await answer(replies[name] as Reply)
        expect(hub.tiktok.outbox.dropped, name).toBe(total)
        expect(await popup(), name).toBe(PHRASE)
      }
    })

    it('화면 떠남(dropTab)으로 뺀 날아가던 댓글은 실패 답에도 팝업 수에 들지 않는다 (서버에 알릴 수에만 듦)', async () => {
      const { hub, answer, popup } = heldWorld()
      await hub.handle(status('OWN'), tiktokSender())
      await hub.handle({ type: 'ttChats', pageId: 'seller_kim', items: items(1, 2) }, tiktokSender())
      void hub.tiktok.outbox.flush()
      await settle()
      hub.tiktok.outbox.dropTab(TAB)
      await answer(replies['503'] as Reply)
      expect(hub.tiktok.outbox.dropped).toBe(0)
      expect(hub.tiktok.outbox.unreported).toBe(2)
      expect(await popup()).toBeNull()
    })

    it('워커가 답을 받기 전에 멈췄다 다시 뜨면 날아가다 잘린 몫은 팝업 수에 들지 않는다', () => {
      const snaps: ReturnType<TikTokOutbox['snapshot']>[] = []
      const api: Api = { call: () => new Promise<ApiResult>(() => undefined) }
      const box = new TikTokOutbox(api, new FakeTimers(), () => undefined, (snap) => snaps.push(snap))
      box.add(TAB, 'seller_kim', items(1, TT_BATCH_MAX))
      void box.flush()
      box.add(TAB, 'seller_kim', items(1000, 1000 + TT_HOLD_MAX - TT_BATCH_MAX + K - 1))
      const saved = snaps.at(-1)
      expect(saved?.dropped).toBe(0)
      const next = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
      if (saved !== undefined) next.restore(saved)
      expect(next.dropped).toBe(0)
      expect(next.size).toBe(TT_HOLD_MAX)
    })
  })

  it('끊기 직전 떼어 둔 수는 끊은 뒤 실패해도 되돌아오지 않는다', () => {
    const box = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
    box.add(TAB, 'seller_kim', items(1, TT_HOLD_MAX + 6))
    const report = box.takeDropped()
    expect(report.count).toBe(6)
    box.stop()
    box.resume()
    box.settleDropped(report, false)
    expect(box.unreported).toBe(0)
    expect(box.takeDropped().count).toBe(0)
  })

  it('두 상태가 동시에 가도 같은 수를 두 번 싣지 않는다', () => {
    const box = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
    box.add(TAB, 'seller_kim', items(1, TT_HOLD_MAX + 5))
    const a = box.takeDropped()
    const b = box.takeDropped()
    expect([a.count, b.count]).toEqual([5, 0])
    expect(box.unreported).toBe(5)
    box.settleDropped(a, true)
    box.settleDropped(b, true)
    expect(box.unreported).toBe(0)
  })

  it('한 번에 10,000개까지만 싣고 나머지는 다음 상태에 (서버 상한)', () => {
    const box = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
    box.restore({ items: [], dropped: 0, unreported: TT_DROPPED_REPORT_MAX + 7 })
    const first = box.takeDropped()
    expect(first.count).toBe(TT_DROPPED_REPORT_MAX)
    box.settleDropped(first, true)
    expect(box.takeDropped().count).toBe(7)
  })

  it('세션에서 읽은 이상한 값(음수·소수·글자)은 0으로', () => {
    for (const bad of [-3, 1.5, '4', Number.NaN] as unknown[]) {
      const box = new TikTokOutbox(new FakeApi(), new FakeTimers(), () => undefined)
      box.restore({ items: [], dropped: 0, unreported: bad as number })
      expect(box.unreported, String(bad)).toBe(0)
    }
  })
})

describe('AC-TTX-33 (2) (D-TTX-17): 연결 직후 팝업 틱톡 줄', () => {
  it('틱톡 화면을 연 적 없어도 서버의 판매자 틱톡 아이디가 있으면 "내 틱톡 방송 화면을 열면 댓글을 보내요."', async () => {
    const { chrome } = fakeChrome()
    const s = server({ 'POST /ext/connect': [{ status: 200, body: { token: 'tok' } }] })
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    expect(((await hub.handle({ type: 'view' })) as HubView).tiktok).toBeNull()
    const result = (await hub.handle({ type: 'connect', code: '12345678' })) as { ok: boolean; view: HubView }
    expect(result.ok).toBe(true)
    expect(result.view.tiktok).toEqual({ message: TT_WORDS.ELSEWHERE_PAGE, light: 'off', overflow: null })
    expect(s.calls.map((c) => c.key)).toEqual(['POST /ext/connect', 'GET /ext/tiktok'])
    // 연결을 지우면 줄이 없어진다
    expect(((await hub.handle({ type: 'forget' })) as HubView).tiktok).toBeNull()
  })

  it('판매자 틱톡 아이디가 없으면(유튜브만) 틱톡 줄이 없다, 물어보지 못해도 없다', async () => {
    for (const reply of [{ status: 200, body: { tiktokId: null, mode: 'blocked', code: 'NO_TIKTOK_ID' } }, { status: 500, body: {} }]) {
      const { chrome } = fakeChrome()
      const s = server({ 'POST /ext/connect': [{ status: 200, body: { token: 'tok' } }], 'GET /ext/tiktok': [reply] })
      const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
      const result = (await hub.handle({ type: 'connect', code: '12345678' })) as { view: HubView }
      expect(result.view.tiktok, String(reply.status)).toBeNull()
    }
  })

  it('워커가 다시 뜨면(연결 직후가 아님) 틱톡 화면을 볼 때까지 줄이 없다 — 지금 동작 그대로', async () => {
    const { chrome } = fakeChrome({ [TOKEN_KEY]: 'tok' })
    const s = server()
    const hub = new Hub(chrome, ORIGIN, s.fetcher, new FakeTimers())
    expect(((await hub.handle({ type: 'view' })) as HubView).tiktok).toBeNull()
    expect(s.calls).toHaveLength(0)
  })
})
