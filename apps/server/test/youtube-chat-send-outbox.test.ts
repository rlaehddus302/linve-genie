// 감사 채팅 다른 길 × 발송함·수집기 (D-YT-SEND-05·06). 실제 서버 + 가짜 유튜브 웹(수집) + 가짜 구글(사장님 연결·동의) + 가짜 감사 받는 곳(세 길).
// 유튜브·Nightbot 실제 주소로는 아무것도 보내지 않는다(CLAUDE.md 절대 규칙 7 — 브라우저 길은 127.0.0.1만 열게 막는다).
// - 고른 판매자의 실시간 채팅 감사는 그 길로 한 번만 올리고 liveChatMessages.insert(20단위)를 부르지 않는다. 할당량 멈춤에도 올린다.
// - innertube·browser는 공식 채팅 ID가 필요 없어 videos.list도 부르지 않는다. nightbot은 chatId로 공식 채팅 ID를 넣는다(없으면 1단위로 받는다).
// - 고르지 않은 판매자는 공식 그대로.
// - 봇 계정·Nightbot이 쓴 우리 감사 글은 찜(채팅 기록)으로 읽지 않고 게시 확인에 쓴다. 올라갔는지 모르면(추가 확인 요구) 다시 올리지 않는다.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BrowserChatSender } from '../src/youtube/chat-send/browser-sender.ts'
import { FAKE_BOT_COOKIE, FAKE_BROWSER_SID, FAKE_NIGHTBOT_TOKEN, FAKE_SEND_HOST, FakeChatSend, fakeBotCookie, type FakePost } from '../src/youtube/chat-send/fake-chat-send.ts'
import { InnertubeChatSender } from '../src/youtube/chat-send/innertube-sender.ts'
import { NightbotChatSender } from '../src/youtube/chat-send/nightbot-sender.ts'
import { OfficialBotSender } from '../src/youtube/chat-send/official-sender.ts'
import { ChatSenderPool } from '../src/youtube/chat-send/pool.ts'
import { chatSendRoute, type ChatSender } from '../src/youtube/chat-send/sender.ts'
import { BOT_CALLBACK_MESSAGES, BOT_SELLER_ID } from '../src/youtube/connect.ts'
import { addSeller, client, expectOk, writeEvent, type Seller } from './support.ts'
import { approve, callback, drive, enableConsent, type YoutubeWorld } from './youtube-support.ts'
import { chatEvents, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const BOT = 'UCbot0000000000000000000'
const TEXT = '15번 핑크프릴 10,000원 가님 구매 감사합니다'
const NO_LABEL = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 0 }

let fake: FakeChatSend
let dir: string
let statePath: string
beforeAll(async () => {
  fake = await FakeChatSend.start()
  dir = await mkdtemp(join(tmpdir(), 'livejjim-send-outbox-'))
  statePath = join(dir, 'state.json')
  await writeFile(statePath, JSON.stringify({ cookies: [{ name: 'SID', value: FAKE_BROWSER_SID, domain: FAKE_SEND_HOST, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }))
})
afterAll(async () => {
  await fake.close()
  await rm(dir, { recursive: true, force: true })
})

const worlds: { w: WebWorld; sender: ChatSender }[] = []
afterEach(async () => {
  fake.posts.length = 0
  fake.onPost = null
  const closing = worlds.splice(0)
  for (const { w } of closing) {
    await w.server.youtube?.collectors.stop()
    w.server.close()
    await w.server.stop()
  }
  for (const { w, sender } of closing) {
    await sender.close()
    await w.web.close()
    await w.google?.close()
  }
})

type Route = 'innertube' | 'browser' | 'nightbot'
function makeSender(route: Route, w: () => WebWorld): ChatSender {
  const timer = { now: () => w().timer.now(), sleep: (ms: number, signal?: AbortSignal) => w().timer.sleep(ms, signal) }
  if (route === 'innertube') return new InnertubeChatSender({ cookie: FAKE_BOT_COOKIE, authorChannelId: BOT, timer, fetch: fake.youtubeFetch, gapMs: 0 })
  // 화면 확인은 실제 시간으로 기다린다 — 시험 구동(drive)이 기다리는 실제 시간(약 2초)보다 짧게
  if (route === 'browser') return new BrowserChatSender({ headless: true, storageStatePath: statePath, authorChannelId: BOT, timer, baseUrl: fake.url, allowedHosts: [FAKE_SEND_HOST], gapMs: 0, confirmMs: 800 })
  return new NightbotChatSender({ token: FAKE_NIGHTBOT_TOKEN, authorChannelId: BOT, timer, baseUrl: fake.url, gapMs: 0 })
}

/** 서버 + 그 길 (sellers: 고른 판매자 ID를 나중에 정한다 — 판매자 ID는 서버가 만든다) */
async function world(route: Route, pick: 'all' | 'none' = 'all') {
  let current: WebWorld | null = null
  const sender = makeSender(route, () => current as WebWorld)
  const created = await webWorld({ google: true, chatSend: chatSendRoute(sender, pick === 'all' ? '*' : []) })
  current = created
  worlds.push({ w: created, sender })
  // 받은 글을 가짜 유튜브 웹 채팅에 그대로 붙인다 (작성자 = 그 길의 채널) — 수집기가 보는 화면
  fake.onPost = (post: FakePost) => {
    // 가짜 구글의 공식 채팅 ID는 chat_<영상 ID>
    const video = post.videoId ?? (post.chatId ?? '').replace(/^chat_/, '')
    created.web.addMessage(video, { id: post.id, author: BOT, name: '라이브지니 봇', text: post.text, publishedAt: created.timer.now() })
  }
  return created
}

function googleOf(w: WebWorld) {
  if (w.google === null) throw new Error('가짜 구글 없음')
  return w.google
}
const asYoutube = (w: WebWorld) => ({ ...w, fake: googleOf(w) }) as unknown as YoutubeWorld
const run = (w: WebWorld) => drive(asYoutube(w), (w.server.youtube?.outbox as NonNullable<typeof w.server.youtube>['outbox']).runOnce())

async function connect(w: WebWorld, seller: Seller, title = '사장님 채널', channelId?: string) {
  const google = googleOf(w)
  const account = google.addAccount()
  const channel = google.addChannel(account, title, channelId)
  google.approval = { account, channel: channel.id }
  const started = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  expect(await callback(w, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  await enableConsent(asYoutube(w), seller, 'LIVE_CHAT')
  return channel
}

/** 판매자 + 서버로 이은 방송 + 사장님 구글 연결·동의. 가짜 구글이 그 방송의 공식 채팅을 안다 */
async function ready(w: WebWorld) {
  const seller = await addSeller(w)
  expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
  const { b, video } = await webLinked(w, { seller })
  const chatId = googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId }).liveChatId as string
  await connect(w, seller)
  return { seller, b, video, chatId }
}

async function sale(w: WebWorld, seller: Seller, b: string, no: number, buyer: { id: string; ch: string; nick: string }) {
  await expectOk(writeEvent(w, seller, { type: 'product.register', b, no, name: no === 15 ? '핑크프릴' : `품종${String(no)}`, price: 10000 }))
  const outcome = await w.server.ingestChat(seller.sellerId, { b, id: buyer.id, ch: buyer.ch, nick: buyer.nick, text: String(no), publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

interface Row {
  id: number
  state: string
  reason: string | null
  attempts: number
  messageId: string | null
}
async function rows(w: WebWorld, seller: Seller, date: string): Promise<Row[]> {
  const response = await client(w, seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function quotaUnits(w: WebWorld, seller: Seller, method: string): Promise<number> {
  const methods = ((await client(w, seller.cookie).get('/api/youtube/quota')).body.quota as { methods: { method: string; units: number }[] }).methods
  return methods.find((item) => item.method === method)?.units ?? 0
}

describe('D-YT-SEND-05 세 길 각각 — 발송함이 그 길로 한 번 올린다', () => {
  for (const route of ['innertube', 'browser', 'nightbot'] as const) {
    it(`${route}: 감사 → 그 길로 1번, liveChatMessages.insert 0번·할당량 0단위, 게시됨`, async () => {
      const w = await world(route)
      const { seller, b, video, chatId } = await ready(w)
      await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
      await run(w)
      expect(fake.posts).toHaveLength(1)
      const post = fake.posts[0] as FakePost
      expect(post).toMatchObject({ route, text: TEXT })
      if (route === 'nightbot') expect(post.chatId).toBe(chatId)
      else expect(post.videoId).toBe(video.videoId)
      if (route === 'innertube') expect(post.channelId).toBe(video.channelId)
      const [row] = await rows(w, seller, b.date)
      expect(row).toMatchObject({ state: 'SENT', messageId: route === 'nightbot' ? null : post.id })
      expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
      expect(await quotaUnits(w, seller, 'liveChatMessages.insert')).toBe(0)
      // 공식 채팅 ID: innertube·browser는 받지 않는다, nightbot은 videos.list 1단위로 받는다
      expect(googleOf(w).calls('videos.list')).toBe(route === 'nightbot' ? 1 : 0)
      const reports = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'effect.thanksSent'`)
      expect(reports?.rows[0]?.n).toBe(1)
    })
  }

  it('고르지 않은 판매자는 공식 그대로 (그 길 0번, insert 1번)', async () => {
    const w = await world('innertube', 'none')
    const { seller, b } = await ready(w)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(fake.posts).toHaveLength(0)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(1)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
  })

  it('할당량이 멈춰도(QUOTA) 다른 길 실시간 채팅 감사는 올린다', async () => {
    const w = await world('innertube')
    const { seller, b } = await ready(w)
    await w.server.youtube?.quota.markExceeded(seller.sellerId)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(fake.posts).toHaveLength(1)
  })

  it('D-YT-SEND-11 구글 연결이 없는 판매자도 고른 판매자면 봇 길로 올린다 (앱 감사 스위치 = 동의). 공식 API 0번', async () => {
    const w = await world('innertube')
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
    const { b, video } = await webLinked(w, { seller })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT', messageId: fake.posts[0]?.id })
    expect(fake.posts).toEqual([expect.objectContaining({ route: 'innertube', text: TEXT, videoId: video.videoId, channelId: video.channelId })])
    expect(googleOf(w).calls()).toBe(0)
  })

  it('D-YT-SEND-11 구글 연결이 없고 고르지 않은 판매자는 그대로 NO_CONSENT', async () => {
    const w = await world('innertube', 'none')
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
    const { b } = await webLinked(w, { seller })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
    expect(fake.posts).toHaveLength(0)
  })

  it('D-YT-SEND-18 감사 스위치를 끄면 봇도 올리지 않는다 (감사를 만들지 않는다)', async () => {
    const w = await world('innertube')
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: { ...NO_LABEL, 'thanks.liveChat': false } })).status).toBe(200)
    const { b } = await webLinked(w, { seller })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(await rows(w, seller, b.date)).toEqual([])
    expect(fake.posts).toHaveLength(0)
  })

  it('D-YT-SEND-18 연결 응답의 botThanks — 고른 판매자만 true', async () => {
    const w = await world('innertube')
    const seller = await addSeller(w)
    const response = await client(w, seller.cookie).get('/api/youtube/connection')
    expect(response.body).toMatchObject({ botThanks: true })
    const other = await world('innertube', 'none')
    const plain = await addSeller(other)
    expect((await client(other, plain.cookie).get('/api/youtube/connection')).body).toMatchObject({ botThanks: false })
  })

  // D-YT-SEND-18: 봇 판매자 화면은 감사 스위치 하나 — 구글 연결이 있고 게시 동의가 꺼져 있어도 스위치가 켜져 있으면 봇이 올린다 (D-YT-SEND-11의 "연결 동의를 따른다"를 바꿈)
  it('D-YT-SEND-18 구글 연결이 있고 게시 동의가 꺼져 있어도 봇 길로 올린다 — 동의는 감사 스위치 하나', async () => {
    const w = await world('innertube')
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
    const { b } = await webLinked(w, { seller })
    const google = googleOf(w)
    const account = google.addAccount()
    const channel = google.addChannel(account, '사장님 채널')
    google.approval = { account, channel: channel.id }
    const started = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
    expect(await callback(w, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(fake.posts).toHaveLength(1)
  })

  it('429 → 다시 시도(RETRY) 뒤 게시, 그 길 2번 부름·글 1개', async () => {
    const w = await world('innertube')
    const { seller, b } = await ready(w)
    fake.failInnertube({ status: 429 })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'RETRY', attempts: 1 })
    for (let i = 0; i < 10 && (await rows(w, seller, b.date))[0]?.state !== 'SENT'; i++) {
      await w.timer.advance(1000)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(fake.posts).toHaveLength(1)
  })

  it('로그인 문제(401) → 판매자 다시 연결이 아니라 다시 시도, 5번 넘으면 GAVE_UP', async () => {
    const w = await world('nightbot')
    const { seller, b } = await ready(w)
    fake.failNightbot({ status: 401 }, 6)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'RETRY' })
    for (let i = 0; i < 80 && (await rows(w, seller, b.date))[0]?.state !== 'FAILED'; i++) {
      await w.timer.advance(1000)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'GAVE_UP' })
    expect(fake.posts).toHaveLength(0)
  })
})

describe('D-YT-SEND-06 그 길의 작성자 글 — 찜으로 읽지 않고 게시 확인에 쓴다', () => {
  it('봇이 올린 감사(숫자로 시작)는 채팅 기록에 없고, 다른 시청자의 같은 글은 기록한다', async () => {
    const w = await world('innertube')
    const { seller, b, video } = await ready(w)
    w.server.youtube?.collectors.start()
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    const post = fake.posts[0] as FakePost
    w.web.addMessage(video.videoId, { id: 'viewer-copy', author: 'UCq', name: '시청자', text: TEXT, publishedAt: w.timer.now() + 1 })
    for (let i = 0; i < 40 && !(await chatEvents(w)).some((event) => event.id === 'viewer-copy'); i++) await w.timer.advance(500)
    const events = await chatEvents(w)
    expect(events.some((event) => event.id === 'viewer-copy')).toBe(true)
    expect(events.some((event) => event.id === post.id)).toBe(false)
  })

  it('추가 확인 요구로 올라갔는지 모름 → 다시 올리지 않고, 수집기가 본 봇의 같은 글로 SENT', async () => {
    const w = await world('innertube')
    const { seller, b, video } = await ready(w)
    w.server.youtube?.collectors.start()
    fake.failInnertube({ kind: 'attestation' })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENDING', reason: 'CONFIRM' })
    // 추가 확인을 지나 유튜브 화면에 봇 글이 떴다
    w.web.addMessage(video.videoId, { id: 'web-bot', author: BOT, name: '라이브지니 봇', text: TEXT, publishedAt: w.timer.now() })
    for (let i = 0; i < 40 && (await rows(w, seller, b.date))[0]?.state !== 'SENT'; i++) {
      await w.timer.advance(500)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT', messageId: 'web-bot' })
    expect(fake.calls.innertube).toBeGreaterThan(0)
    expect((await chatEvents(w)).some((event) => event.id === 'web-bot')).toBe(false)
  })

  it('모름인 채 확인 시간 안에 못 보면 UNCONFIRMED — 다시 올리지 않는다', async () => {
    const w = await world('browser')
    const { seller, b } = await ready(w)
    w.server.youtube?.collectors.start()
    fake.failBrowser({ kind: 'drop' })
    fake.onPost = null
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENDING', reason: 'CONFIRM' })
    for (let i = 0; i < 120 && (await rows(w, seller, b.date))[0]?.state !== 'FAILED'; i++) {
      await w.timer.advance(500)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(fake.posts).toHaveLength(1)
  })
})

describe('D-YT-SEND-12·13 봇 계정 여럿 + 공식 API 넘김 — 발송함 끝까지', () => {
  const bot = (n: number) => `UCbot${String(n).padStart(19, '0')}`
  const OFFICIAL_BOT = 'UCofficialbot00000000000'

  /** 봇 계정 둘(innertube) 풀 + (선택) 봇 판매자의 공식 API 넘김 */
  async function poolWorld(withOfficial: boolean) {
    let current: WebWorld | null = null
    const timer = { now: () => (current as WebWorld).timer.now(), sleep: (ms: number, signal?: AbortSignal) => (current as WebWorld).timer.sleep(ms, signal) }
    const pool = new ChatSenderPool(
      [1, 2].map((n) => new InnertubeChatSender({ cookie: fakeBotCookie(n), authorChannelId: bot(n), timer, fetch: fake.youtubeFetch, gapMs: 0, timeoutMs: 400 })),
      timer,
    )
    let fallback: OfficialBotSender | null = null
    // 봇 판매자 ID는 서버가 만든 뒤에 안다 — 넘김 길은 그때 채운다
    const lazy: ChatSender = {
      route: 'official',
      needsLiveChatId: false,
      authorChannelId: OFFICIAL_BOT,
      send: (t, text, signal) => {
        if (fallback === null) throw new Error('넘김 길이 아직 없다')
        return fallback.send(t, text, signal)
      },
      close: async () => {},
    }
    const route = withOfficial ? chatSendRoute(pool, '*').withFallback(lazy) : chatSendRoute(pool, '*')
    const created = await webWorld({ google: true, chatSend: route })
    current = created
    worlds.push({ w: created, sender: pool })
    fake.onPost = (post: FakePost) => {
      if (post.videoId === null) return
      const author = post.account === 'bot-2' ? bot(2) : bot(1)
      created.web.addMessage(post.videoId, { id: post.id, author, name: '라이브지니', text: post.text, publishedAt: created.timer.now() })
    }
    let botSeller: Seller | null = null
    if (withOfficial) {
      botSeller = await addSeller(created)
      await connect(created, botSeller, '라이브지니', OFFICIAL_BOT)
      const youtube = created.server.youtube
      if (youtube === undefined || youtube === null) throw new Error('유튜브 없음')
      fallback = new OfficialBotSender({ google: youtube.google, connections: youtube.connections, sellerId: botSeller.sellerId, channelId: OFFICIAL_BOT, timer, gapMs: 0 })
    }
    return { w: created, pool, botSeller }
  }

  /** 구글 연결 없는 판매자 + 서버로 이은 방송 (가짜 구글도 그 방송의 공식 채팅을 안다 — 넘김용) */
  async function sellerLive(w: WebWorld) {
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
    const { b, video } = await webLinked(w, { seller })
    const chatId = googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId }).liveChatId as string
    return { seller, b, video, chatId }
  }

  async function ownAuthor(w: WebWorld, messageId: string) {
    const own = await w.database.pglite?.query<{ author_channel_id: string }>(`select author_channel_id from youtube_own_messages where message_id = $1`, [messageId])
    return own?.rows[0]?.author_channel_id ?? null
  }

  it('두 판매자 방송을 서로 다른 봇 계정이 맡아 올린다 — 작성자도 그 계정으로 적는다', async () => {
    const { w, pool } = await poolWorld(false)
    const one = await sellerLive(w)
    const two = await sellerLive(w)
    await sale(w, one.seller, one.b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await sale(w, two.seller, two.b.id, 15, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect(fake.posts.map((post) => [post.videoId, post.account])).toEqual(
      expect.arrayContaining([
        [one.video.videoId, expect.stringMatching(/^bot-[12]$/)],
        [two.video.videoId, expect.stringMatching(/^bot-[12]$/)],
      ]),
    )
    expect(new Set(fake.posts.map((post) => post.account)).size).toBe(2)
    for (const { seller, b, video } of [one, two]) {
      const [row] = await rows(w, seller, b.date)
      expect(row).toMatchObject({ state: 'SENT' })
      expect(await ownAuthor(w, row?.messageId ?? '')).toBe(pool.assigned(video.videoId))
    }
  })

  it('계정 1 로그인 풀림(401) → 그 감사는 계정 2로 한 번, 게시됨', async () => {
    const { w } = await poolWorld(false)
    fake.innertubeAccountFaults.set('bot-1', { status: 401 })
    try {
      const { seller, b } = await sellerLive(w)
      await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
      await run(w)
      expect(fake.posts.map((post) => post.account)).toEqual(['bot-2'])
      const [row] = await rows(w, seller, b.date)
      expect(row).toMatchObject({ state: 'SENT' })
      expect(await ownAuthor(w, row?.messageId ?? '')).toBe(bot(2))
    } finally {
      fake.innertubeAccountFaults.clear()
    }
  })

  it('서버 막힘 → 봇 계정 이름(공식 봇 채널)으로 공식 API에 넘겨 게시, 할당량은 봇 판매자 몫. 쉬는 동안 다음 감사도 바로 공식으로', async () => {
    const { w, botSeller } = await poolWorld(true)
    const { seller, b, chatId } = await sellerLive(w)
    fake.failInnertube({ kind: 'blocked' })
    const before = fake.calls.innertube
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(fake.posts).toHaveLength(0)
    expect(googleOf(w).posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[chatId, OFFICIAL_BOT, TEXT]])
    const [row] = await rows(w, seller, b.date)
    expect(row).toMatchObject({ state: 'SENT' })
    expect(await ownAuthor(w, row?.messageId ?? '')).toBe(OFFICIAL_BOT)
    // 쉬는 동안(5분)은 봇 길을 부르지 않는다
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect(fake.calls.innertube - before).toBe(1)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(2)
    expect(await quotaUnits(w, botSeller as Seller, 'liveChatMessages.insert')).toBe(40)
    expect(await quotaUnits(w, seller, 'liveChatMessages.insert')).toBe(0)
  })

  it('응답을 모름(시간 초과) → 공식으로 넘기지 않는다 (두 번 올리지 않음)', async () => {
    const { w } = await poolWorld(true)
    const { seller, b } = await sellerLive(w)
    fake.failInnertube({ kind: 'hang' })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENDING', reason: 'CONFIRM' })
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
  })
})

describe('D-YT-SEND-20·21 공식 API 봇이 기본 길 — 판매자는 아무것도 하지 않고, 봇 연결은 로그인 없는 시스템 판매자', () => {
  const OFFICIAL_BOT = 'UCofficialbot00000000000'

  async function botWorld() {
    const w = await webWorld({ google: true, chatSendOfficial: { channelId: OFFICIAL_BOT, primary: { sellers: '*' } } })
    worlds.push({ w, sender: { route: 'official', needsLiveChatId: false, authorChannelId: OFFICIAL_BOT, send: () => Promise.reject(new Error('unused')), close: async () => {} } })
    return w
  }
  const connections = (w: WebWorld) => {
    const youtube = w.server.youtube
    if (youtube === undefined || youtube === null) throw new Error('유튜브 없음')
    return youtube.connections
  }
  /** 운영자 명령(youtube-bot connect)과 같은 승인 → 세션 없이 돌아오기. 상태와 화면 문장 */
  async function botConnect(w: WebWorld, channelId: string, approval: { grant?: string[] } = {}) {
    const google = googleOf(w)
    const account = google.addAccount()
    const channel = google.addChannel(account, '라이브지니', channelId)
    google.approval = { account, channel: channel.id, ...approval }
    const search = await approve(await connections(w).startBot(OFFICIAL_BOT))
    const response = await w.server.app.request(`/api/youtube/oauth/callback${search}`)
    return { status: response.status, text: await response.text(), search }
  }
  async function botUnits(w: WebWorld, method: string) {
    const result = await w.database.pglite?.query<{ units: number }>(`select coalesce(sum(units), 0)::int as units from youtube_quota where seller_id = $1 and method = $2`, [BOT_SELLER_ID, method])
    return result?.rows[0]?.units ?? -1
  }
  async function sellerLive(w: WebWorld) {
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
    expect((await client(w, seller.cookie).get('/api/youtube/connection')).body).toMatchObject({ botThanks: true })
    const { b, video } = await webLinked(w, { seller })
    const chatId = googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId }).liveChatId as string
    return { seller, b, chatId }
  }

  it('운영자 명령으로 봇 계정을 잇는다(세션 없이 state로) — 로그인 계정 없는 시스템 판매자, 판매자 감사를 봇 이름으로 공식 API에 올리고 할당량은 봇 몫', async () => {
    const w = await botWorld()
    const connected = await botConnect(w, OFFICIAL_BOT)
    expect(connected.status).toBe(200)
    expect(connected.text).toContain(BOT_CALLBACK_MESSAGES.connected)
    expect(await connections(w).status(BOT_SELLER_ID)).toMatchObject({ status: 'CONNECTED', channel: { id: OFFICIAL_BOT }, permissions: { publish: true } })
    // 로그인 계정이 없다 — 아무도 그 판매자로 로그인해 끊거나 바꿀 수 없다
    const accounts = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from accounts where seller_id = $1`, [BOT_SELLER_ID])
    expect(accounts?.rows[0]?.n).toBe(0)
    // 같은 state로 다시 오면 봇 연결이 아니다(한 번만) — 판매자 돌아오기로 넘어가 거절
    const again = await w.server.app.request(`/api/youtube/oauth/callback${connected.search}`)
    expect(again.status).toBe(302)
    const { seller, b, chatId } = await sellerLive(w)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(googleOf(w).posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[chatId, OFFICIAL_BOT, TEXT]])
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(await botUnits(w, 'liveChatMessages.insert')).toBe(20)
    expect(await quotaUnits(w, seller, 'liveChatMessages.insert')).toBe(0)
    // 같은 방송의 둘째 감사는 채팅 ID를 다시 묻지 않는다
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(2)
    expect(googleOf(w).calls('videos.list')).toBe(1)
  })

  it('봇 채널이 아닌 계정·채팅 쓰기 권한을 빼고 허락하면 잇지 않는다', async () => {
    const w = await botWorld()
    const wrong = await botConnect(w, 'UCsomeoneelse00000000000')
    expect(wrong.status).toBe(400)
    expect(wrong.text).toContain(BOT_CALLBACK_MESSAGES.WRONG_CHANNEL)
    const noPublish = await botConnect(w, OFFICIAL_BOT, { grant: [] })
    expect(noPublish.status).toBe(400)
    expect(noPublish.text).toContain(BOT_CALLBACK_MESSAGES.NO_PUBLISH)
    expect(await connections(w).status(BOT_SELLER_ID)).toMatchObject({ status: 'NOT_CONNECTED' })
  })

  it('봇 연결 전에는 올리지 않고 기다린다(로그인 풀림과 같이 다시 시도) — 판매자 화면에 구글 안내 없음', async () => {
    const w = await botWorld()
    const { seller, b } = await sellerLive(w)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
    expect((await rows(w, seller, b.date))[0]?.state).not.toBe('SENT')
  })

  it('판매자 계정에 이어 둔 옛 봇 연결을 시스템 판매자로 옮긴다 — 구글 승인·폐기 없이, 옛 판매자 연결은 지운다', async () => {
    const w = await botWorld()
    const old = await addSeller(w)
    await connect(w, old, '라이브지니', OFFICIAL_BOT)
    const exchanges = googleOf(w).calls('oauth.token')
    expect(await connections(w).moveToBot(old.sellerId, 'UCsomeoneelse00000000000')).toBe('WRONG_CHANNEL')
    expect(await connections(w).moveToBot(old.sellerId, OFFICIAL_BOT)).toBe('moved')
    expect(googleOf(w).calls('oauth.token')).toBe(exchanges)
    expect(googleOf(w).calls('oauth.revoke')).toBe(0)
    expect(await connections(w).status(old.sellerId)).toMatchObject({ status: 'NOT_CONNECTED' })
    expect(await connections(w).status(BOT_SELLER_ID)).toMatchObject({ status: 'CONNECTED', channel: { id: OFFICIAL_BOT } })
    expect(await connections(w).moveToBot(old.sellerId, OFFICIAL_BOT)).toBe('NOT_FOUND')
    const { seller, b, chatId } = await sellerLive(w)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(googleOf(w).posted.map((post) => [post.liveChatId, post.authorChannelId])).toEqual([[chatId, OFFICIAL_BOT]])
    expect(await botUnits(w, 'liveChatMessages.insert')).toBe(20)
  })
})
