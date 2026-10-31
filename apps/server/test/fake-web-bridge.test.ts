// 가짜 구글 → 가짜 유튜브 웹 다리 (시험 도구, YT-11): 방송·상태·채팅·지움·차단이 웹에 비치는지, /_fake/web/* 조작 경로,
// 서버 웹 읽기(WEB 수집기)가 가짜 구글에 넣은 메시지를 같은 ID로 한 번씩 기록하는지.
import { afterEach, describe, expect, it } from 'vitest'
import { startE2eServer, type E2eServer } from '../src/e2e.ts'
import { bridgeFakeWeb, type FakeWebBridge } from '../src/youtube/fake-web-bridge.ts'
import { FakeGoogle } from '../src/youtube/fake-google.ts'
import { FakeYoutubeWeb } from '../src/youtube/fake-youtube-web.ts'
import { ManualTimer } from '../src/youtube/timer.ts'
import { FAST_COST, T0 } from './support.ts'
import { chatEvents, collectorOfWorld, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

async function fakes(): Promise<{ google: FakeGoogle; web: FakeYoutubeWeb; timer: ManualTimer }> {
  const timer = new ManualTimer(T0)
  const google = await FakeGoogle.start({ now: () => timer.now() })
  const web = await FakeYoutubeWeb.start({ now: () => timer.now() })
  closers.push(() => google.close(), () => web.close())
  return { google, web, timer }
}

function bridge(google: FakeGoogle, web: FakeYoutubeWeb): FakeWebBridge {
  const made = bridgeFakeWeb(google, web)
  closers.push(async () => made.close())
  return made
}

const kindsOf = (actions: readonly Record<string, unknown>[]) => actions.map((action) => Object.keys(action).find((key) => key !== 'clickTrackingParams'))

describe('다리: 방송·상태', () => {
  it('있던 방송은 놓을 때, 새 방송은 생길 때 같은 영상·채널·이름·제목으로 비추고 상태를 따라간다', async () => {
    const { google, web, timer } = await fakes()
    const channel = google.addChannel(google.addAccount(), '<b>구피네</b>')
    const before = google.addBroadcast(channel.id, { title: '먼저 만든 방송' })
    const b = bridge(google, web)
    expect(web.video(before.videoId)).toMatchObject({ videoId: before.videoId, channelId: channel.id, channelTitle: '<b>구피네</b>', title: '먼저 만든 방송', state: 'live' })
    const upcoming = google.addBroadcast(channel.id, { status: 'upcoming', title: '예정' })
    expect(b.video(upcoming.videoId).state).toBe('upcoming')
    await timer.set(T0 + 60_000)
    google.startBroadcast(upcoming.videoId)
    expect(web.video(upcoming.videoId)).toMatchObject({ state: 'live', startedAt: T0 + 60_000 })
    google.endChat(upcoming.liveChatId as string)
    expect(web.video(upcoming.videoId).state).toBe('ended')
    const off = google.addBroadcast(channel.id, { chat: false })
    expect(web.video(off.videoId).state).toBe('chatOff')
    google.disableChat(before.liveChatId as string)
    expect(web.video(before.videoId).state).toBe('chatOff')
    expect(web.video(google.addBroadcast(channel.id, { status: 'complete' }).videoId).state).toBe('ended')
    // 방송 객체를 직접 고친 뒤 sync
    const live = google.addBroadcast(channel.id)
    live.title = '바꾼 제목'
    live.status = 'complete'
    b.sync()
    expect(web.video(live.videoId)).toMatchObject({ title: '바꾼 제목', state: 'ended' })
  })
})

describe('다리: 채팅', () => {
  it('글·슈퍼챗·멤버십·주인 글을 같은 ID·작성자·이름·시각으로, 지움·차단은 웹 동작으로, 들어간 순서대로 넣는다', async () => {
    const { google, web, timer } = await fakes()
    const channel = google.addChannel(google.addAccount(), '내 채널')
    const broadcast = google.addBroadcast(channel.id)
    const chat = broadcast.liveChatId as string
    google.addMessage(chat, { id: 'old', author: 'UCold', name: '먼저', text: '0' })
    bridge(google, web)
    google.addMessage(chat, { id: 'm1', author: 'UCa', name: '핑크맘', text: '15', publishedAt: T0 + 5000 })
    google.addMessage(chat, { id: 'm2', author: 'UCb', name: '후원자', type: 'superChatEvent', userComment: '16번' })
    google.addMessage(chat, { id: 'm3', author: 'UCc', name: '멤버', type: 'memberMilestoneChatEvent', userComment: '17' })
    google.addMessage(chat, { id: 'm4', author: channel.id, name: '주인', text: '안내' })
    google.addMessage(chat, { id: 'p1', author: 'UCp', name: '투표', type: 'pollEvent' })
    google.deleteMessage(chat, 'm1')
    google.banUser(chat, { channelId: 'UCb', name: '후원자' })
    const actions = web.video(broadcast.videoId).actions
    expect(kindsOf(actions)).toEqual(['addChatItemAction', 'addChatItemAction', 'addChatItemAction', 'addChatItemAction', 'addChatItemAction', 'removeChatItemAction', 'markChatItemsByAuthorAsDeletedAction'])
    const item = (index: number) => (actions[index]?.addChatItemAction as { item: Record<string, Record<string, unknown>> }).item
    expect(item(0).liveChatTextMessageRenderer).toMatchObject({ id: 'old', authorExternalChannelId: 'UCold' })
    expect(item(1).liveChatTextMessageRenderer).toMatchObject({ id: 'm1', authorExternalChannelId: 'UCa', authorName: { simpleText: '핑크맘' }, message: { runs: [{ text: '15' }] }, timestampUsec: `${String(T0 + 5000)}000` })
    expect(item(2).liveChatPaidMessageRenderer).toMatchObject({ id: 'm2', message: { runs: [{ text: '16번' }] }, timestampUsec: `${String(timer.now())}000` })
    expect(item(3).liveChatMembershipItemRenderer).toMatchObject({ id: 'm3', message: { runs: [{ text: '17' }] } })
    expect(item(4).liveChatTextMessageRenderer).toMatchObject({ id: 'm4', authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }] })
    expect(actions[5]).toMatchObject({ removeChatItemAction: { targetItemId: 'm1' } })
    expect(actions[6]).toMatchObject({ markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UCb' } })
  })

  it('/_fake/web/* 조작 경로 (가짜 구글 포트): 오류 넣기·호출 수·웹만의 상태, 잘못된 값은 400, 다리를 거두면 404', async () => {
    const { google, web } = await fakes()
    const b = bridge(google, web)
    const broadcast = google.addBroadcast(google.addChannel(google.addAccount()).id)
    const post = (path: string, body: unknown) => fetch(`${google.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post('/_fake/web/fail', { endpoint: 'watch', fault: { status: 503 }, times: 2 })).status).toBe(200)
    expect((await fetch(`${web.url}/watch?v=${broadcast.videoId}`)).status).toBe(503)
    expect((await fetch(`${web.url}/watch?v=${broadcast.videoId}`)).status).toBe(503)
    expect((await fetch(`${web.url}/watch?v=${broadcast.videoId}`)).status).toBe(200)
    expect((await post('/_fake/web/fail', { endpoint: 'poll', fault: { kind: 'bot' } })).status).toBe(200)
    expect((await post('/_fake/web/fail', { endpoint: 'nope', fault: { status: 500 } })).status).toBe(400)
    expect((await post('/_fake/web/fail', { endpoint: 'poll', fault: { kind: 'boom' } })).status).toBe(400)
    expect((await post('/_fake/web/video', { videoId: broadcast.videoId, state: 'private' })).status).toBe(200)
    expect(web.video(broadcast.videoId).state).toBe('private')
    expect((await post('/_fake/web/options', { timeoutMs: 1000 })).status).toBe(200)
    expect(web.timeoutMs).toBe(1000)
    const state = (await (await fetch(`${google.url}/_fake/web/state`)).json()) as { url: string; calls: Record<string, number> }
    expect(state).toEqual({ url: web.url, calls: { watch: 3, chatPage: 0, poll: 0, channelLive: 0 } })
    // 가짜 구글 원래 경로는 그대로
    expect((await fetch(`${google.url}/_fake/state`)).status).toBe(200)
    b.close()
    expect((await fetch(`${google.url}/_fake/web/state`)).status).toBe(404)
  })
})

describe('다리 + 서버 웹 읽기', () => {
  const worlds: WebWorld[] = []
  afterEach(async () => {
    for (const w of worlds.splice(0)) {
      w.server.close()
      await w.server.stop()
      await w.web.close()
      await w.google?.close()
    }
  })

  it('가짜 구글 채팅에 넣은 메시지를 WEB 수집기가 같은 ID로 한 번씩 기록한다 (잇기 전 글은 거른다)', async () => {
    const w = await webWorld({ google: true })
    worlds.push(w)
    const google = w.google as FakeGoogle
    const b = bridgeFakeWeb(google, w.web)
    const channel = google.addChannel(google.addAccount(), '방송 채널')
    const broadcast = google.addBroadcast(channel.id)
    const chat = broadcast.liveChatId as string
    google.addMessage(chat, { id: 'before', author: 'UCold', name: '먼저', text: '1', publishedAt: w.timer.now() - 60_000 })
    const { seller, b: round } = await webLinked(w, { video: b.video(broadcast.videoId) })
    w.server.youtube?.collectors.start()
    const at = w.timer.now() + 1000
    google.addMessage(chat, { id: 'g1', author: 'UCa', name: '핑크맘', text: '15', publishedAt: at })
    google.addMessage(chat, { id: 'g2', author: 'UCb', name: '후원자', type: 'superChatEvent', userComment: '16번 주세요', publishedAt: at })
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, round.id)).recorded === 2)
    google.addMessage(chat, { id: 'g3', author: channel.id, name: '방송 채널', text: '주인 글', publishedAt: at + 1000 })
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, round.id)).recorded === 3)
    await pass(w, 15_000)
    const events = await chatEvents(w)
    expect(events.map((event) => [event.id, event.ch, event.nick, event.text])).toEqual([
      ['g1', 'UCa', '핑크맘', '15'],
      ['g2', 'UCb', '후원자', '16번 주세요'],
      ['g3', channel.id, '방송 채널', '주인 글'],
    ])
    expect(events[2]).toMatchObject({ owner: true, publishedAt: at + 1000 })
    expect(await collectorOfWorld(w, seller.cookie, round.id)).toMatchObject({ mode: 'WEB', status: 'LIVE', gap: false, skippedBeforeLink: 1 })
    // 공식 API로 채팅을 읽지 않는다
    expect(google.calls('liveChatMessages.list') + google.calls('liveChatMessages.streamList')).toBe(0)
    expect(w.web.calls('poll')).toBeGreaterThan(1)
    b.close()
  })
})

describe('E2E 서버 (기본 웹 읽기)', () => {
  let e2e: E2eServer | null = null
  afterEach(async () => {
    await e2e?.close()
    e2e = null
  })

  it('가짜 구글과 가짜 유튜브 웹을 다리로 잇고 webChat으로 읽는다: /_fake/messages로 넣은 채팅을 같은 ID로 기록, /_fake/web/*로 조작', async () => {
    e2e = await startE2eServer({ youtube: { port: 0, pollingIntervalMillis: 1000 }, passwordCost: FAST_COST, appOrigin: 'http://localhost:5999' })
    const fake = e2e.fakeGoogle
    if (fake === null || e2e.fakeWeb === null) throw new Error('가짜 유튜브가 없다')
    expect(new URL(e2e.fakeWeb.url).hostname).toBe('127.0.0.1')
    const opened = await e2e.listen(0)
    const base = `http://${opened.host}:${String(opened.port)}`
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'http://localhost:5999', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: e2e.account.loginId, password: e2e.account.password }) })
    const cookie = /lj_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? ''
    const api = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, Origin: 'http://localhost:5999', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    const control = async (path: string, body?: unknown) =>
      (await fetch(`${fake.url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>
    expect((await api('/api/youtube/connection')).body).toMatchObject({ webChat: { on: true }, oauth: true })
    const channel = await control('/_fake/channels', { title: '시험 채널' })
    const broadcast = await control('/_fake/broadcasts', { channelId: channel.id, status: 'live' })
    const b = ((await api('/api/broadcasts', 'POST', { requestId: 'e2e-b' })).body.broadcast as { id: string }).id
    const linked = await api(`/api/broadcasts/${b}/youtube`, 'POST', { requestId: 'e2e-link', video: broadcast.videoId, confirmInvited: true })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    expect(linked.body).toMatchObject({ collector: { mode: 'WEB' } })
    const sent = await control('/_fake/messages', { liveChatId: broadcast.liveChatId, author: 'UCviewer', name: '홍길동', text: '15', publishedAt: new Date(Date.now() + 1000).toISOString() })
    for (let i = 0; i < 300; i++) {
      const collector = (await api(`/api/broadcasts/${b}/youtube`)).body.collector as { recorded?: number }
      if (collector.recorded === 1) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect((await api(`/api/broadcasts/${b}/youtube`)).body.collector).toMatchObject({ mode: 'WEB', status: 'LIVE', recorded: 1 })
    const rows = await e2e.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat'`)
    expect(rows?.rows.map((row) => row.id)).toEqual([sent.id])
    expect(fake.calls('liveChatMessages.list') + fake.calls('liveChatMessages.streamList')).toBe(0)
    // 웹 조작 경로 (같은 포트)
    expect(await control('/_fake/web/fail', { endpoint: 'poll', fault: { status: 503 }, times: 1 })).toEqual({ ok: true })
    const state = (await control('/_fake/web/state')) as { calls: Record<string, number> }
    expect(state.calls.watch).toBeGreaterThan(0)
    expect(state.calls.poll).toBeGreaterThan(0)
  }, 30_000)

  it('chat: official이면 가짜 유튜브 웹 없이 옛 공식 읽기', async () => {
    e2e = await startE2eServer({ youtube: { port: 0, chat: 'official' }, passwordCost: FAST_COST, appOrigin: 'http://localhost:5999' })
    expect(e2e.fakeWeb).toBeNull()
    expect(e2e.fakeWebBridge).toBeNull()
    expect((await fetch(`${e2e.fakeGoogle?.url ?? ''}/_fake/web/state`)).status).toBe(404)
  })
})
