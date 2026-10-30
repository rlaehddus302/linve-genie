// YT-SRV 감사만 공식 API (D-YT-SRV-13·15·16·17, SPEC YT-04·YT-06·YT-08·YT-11 AC11, DOMAIN_RULES R-13 YT-SRV 세부).
// 서버로 이은 회차(가짜 유튜브 웹)에 사장님 구글 연결(가짜 구글)로 실시간 채팅 감사를 올린다:
// 글 올리는 계정 칸(연결 없으면 비움 → 처음 올릴 때 적음), 늦은 채팅 ID 받기(videos.list 한 번, 글 올리는 계정 토큰)·실패 표,
// 게시 확인(공식 조회 없이 서버 수집기가 본 우리 글로만, 못 보면 UNCONFIRMED), 우리 감사 거르기(글 올리는 계정·방송 채널 둘 다), 할당량(감사 쓰기만).
import { afterEach, describe, expect, it } from 'vitest'
import type { FakeFault } from '../src/youtube/fake-google.ts'
import type { FakeWebVideo } from '../src/youtube/fake-youtube-web.ts'
import { addSeller, client, expectOk, writeEvent, type Seller } from './support.ts'
import { approve, callback, drive, enableConsent, type YoutubeWorld } from './youtube-support.ts'
import { chatEvents, collectorOfWorld, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
async function world(): Promise<WebWorld> {
  const created = await webWorld({ google: true })
  worlds.push(created)
  return created
}
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    await item.server.youtube?.collectors.stop()
    item.server.close()
    await item.server.stop()
  }
  for (const item of closing) {
    await item.web.close()
    await item.google?.close()
  }
})

const NO_LABEL = { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 0 }
const TEXT = '15번 핑크프릴 10,000원 가님 구매 감사합니다'

function googleOf(w: WebWorld) {
  if (w.google === null) throw new Error('가짜 구글 없음')
  return w.google
}
/** youtube-support 도우미(가짜 구글 = fake)를 그대로 쓴다 */
const asYoutube = (w: WebWorld) => ({ ...w, fake: googleOf(w) }) as unknown as YoutubeWorld
const runner = (w: WebWorld) => {
  const outbox = w.server.youtube?.outbox
  if (outbox === undefined) throw new Error('유튜브가 없다')
  return outbox
}
const run = (w: WebWorld) => drive(asYoutube(w), runner(w).runOnce())

/** 사장님 구글 연결 + 실시간 채팅 게시 동의. 채널 ID를 정할 수 있다(내 채널 방송) */
async function connect(w: WebWorld, seller: Seller, channelId?: string) {
  const google = googleOf(w)
  const account = google.addAccount()
  const channel = google.addChannel(account, '사장님 채널', channelId)
  google.approval = { account, channel: channel.id }
  const started = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  expect(await callback(w, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  await enableConsent(asYoutube(w), seller, 'LIVE_CHAT')
  return channel
}

async function linkRow(w: WebWorld, seller: Seller) {
  const rows = await w.database.pglite?.query<{ id: string; channel_id: string | null; broadcast_channel_id: string | null; live_chat_id: string; chat_ended_at: string | null }>(
    `select id, channel_id, broadcast_channel_id, live_chat_id, chat_ended_at from youtube_links where seller_id = $1 and unlinked_at is null`,
    [seller.sellerId],
  )
  const row = rows?.rows[0]
  if (row === undefined) throw new Error('이은 기록이 없다')
  return row
}

interface Row {
  id: number
  state: string
  reason: string | null
  attempts: number
  messageId: string | null
  text: string
}
async function rows(w: WebWorld, seller: Seller, date: string): Promise<Row[]> {
  const response = await client(w, seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

/** 상품 하나와 시청자 찜 하나 (채팅은 입력 우선 기록으로 바로 넣는다) */
async function sale(w: WebWorld, seller: Seller, b: string, no: number, buyer: { id: string; ch: string; nick: string }) {
  await expectOk(writeEvent(w, seller, { type: 'product.register', b, no, name: no === 15 ? '핑크프릴' : `품종${String(no)}`, price: 10000 }))
  const outcome = await w.server.ingestChat(seller.sellerId, { b, id: buyer.id, ch: buyer.ch, nick: buyer.nick, text: String(no), publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

/** 서버 잇기 + 설정 (구글 연결 전) */
async function linkedWeb(w: WebWorld, options: { video?: FakeWebVideo } = {}) {
  const seller = await addSeller(w)
  expect((await client(w, seller.cookie).patch('/api/settings', { settings: NO_LABEL })).status).toBe(200)
  const linked = await webLinked(w, { seller, ...(options.video === undefined ? {} : { video: options.video }) })
  return linked
}

/** 가짜 구글이 그 웹 방송의 공식 채팅을 안다 (videos.list → activeLiveChatId = chat_{영상}) */
function officialChat(w: WebWorld, video: FakeWebVideo): string {
  return googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId }).liveChatId as string
}

async function quotaMethods(w: WebWorld, seller: Seller) {
  return ((await client(w, seller.cookie).get('/api/youtube/quota')).body.quota as { methods: { method: string; calls: number; units: number }[] }).methods
}

describe('D-YT-SRV-16 글 올리는 계정 칸', () => {
  it('구글 연결 없이 이으면 글 올리는 계정·공식 채팅 ID를 비운다(방송 채널로 채우지 않음), 초대 방송으로 보지 않는다. 공식 API 호출 0', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: null, broadcast_channel_id: video.channelId, live_chat_id: '' })
    const view = (await client(w, seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.link as Record<string, unknown>
    expect(view).toMatchObject({ channelId: null, broadcastChannelId: video.channelId, invited: false })
    expect(googleOf(w).calls()).toBe(0)
  })

  it('구글 연결이 있으면 잇는 때 그 채널을 적는다 — 남의 방송이면 초대 방송. 공식 채팅 ID는 비우고 잇기에서 공식 API를 부르지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const channel = await connect(w, seller)
    const before = googleOf(w).calls()
    const { b, video } = await webLinked(w, { seller })
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: channel.id, broadcast_channel_id: video.channelId, live_chat_id: '' })
    expect(((await client(w, seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.link as Record<string, unknown>).invited).toBe(true)
    expect(googleOf(w).calls()).toBe(before)
  })
})

describe('D-YT-SRV-15 채팅 ID 늦게 받기', () => {
  it('연결 없이 이은 회차에 방송 중 구글을 잇고 동의 → 첫 감사 직전에 글 올리는 계정을 적고 videos.list 한 번으로 채팅 ID를 받아 저장, 둘째 감사는 다시 묻지 않는다. 할당량은 videos.list 1 + insert 20씩', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    const chatId = officialChat(w, video)
    const channel = await connect(w, seller)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    const google = googleOf(w)
    expect(google.calls('videos.list')).toBe(1)
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: channel.id, live_chat_id: chatId, broadcast_channel_id: video.channelId, chat_ended_at: null })
    expect(google.posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[chatId, channel.id, TEXT]])
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect(google.calls('videos.list')).toBe(1)
    expect(google.calls('liveChatMessages.insert')).toBe(2)
    // 실시간 채팅 감사 확인에 공식 조회를 부르지 않고, 읽기 호출도 없다
    expect(google.calls('liveChatMessages.list')).toBe(0)
    expect(google.calls('liveChatMessages.streamList')).toBe(0)
    const methods = await quotaMethods(w, seller)
    expect(methods.find((item) => item.method === 'videos.list')).toEqual({ method: 'videos.list', calls: 1, units: 1 })
    expect(methods.find((item) => item.method === 'liveChatMessages.insert')).toEqual({ method: 'liveChatMessages.insert', calls: 2, units: 40 })
    expect(methods.find((item) => item.method === 'liveChatMessages.list')).toBeUndefined()
  })

  it('이미 채팅 ID가 적힌 회차(먼저 적은 값)는 부르지 않는다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    const chatId = officialChat(w, video)
    await connect(w, seller)
    await w.database.pglite?.query(`update youtube_links set live_chat_id = $1 where seller_id = $2`, [chatId, seller.sellerId])
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(googleOf(w).calls('videos.list')).toBe(0)
    expect(googleOf(w).posted.map((post) => post.liveChatId)).toEqual([chatId])
  })

  it('초대 방송(유튜버 채널) — 사장님 토큰으로 채팅 ID를 받고 사장님 이름으로 올린다. 방송 채널은 그대로', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    const chatId = officialChat(w, video)
    const channel = await connect(w, seller)
    expect(channel.id).not.toBe(video.channelId)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: channel.id, broadcast_channel_id: video.channelId, live_chat_id: chatId })
    expect(googleOf(w).posted.map((post) => post.authorChannelId)).toEqual([channel.id])
  })

  const retryCases: [string, FakeFault][] = [
    ['5xx', { status: 503 }],
    ['429', { status: 429 }],
    ['속도 제한', { status: 403, reason: 'rateLimitExceeded' }],
    ['연결 오류', { kind: 'reset' }],
    ['시간 초과', { kind: 'hang' }],
  ]
  for (const [label, fault] of retryCases) {
    it(`받기 실패(${label}) → 아무것도 올리지 않고 확인 없이 다시 시도(RETRY, 2초 뒤), 저장 없음 → 다음 시도에 받아 게시 1번`, async () => {
      const w = await world()
      const { seller, b, video } = await linkedWeb(w)
      const chatId = officialChat(w, video)
      await connect(w, seller)
      await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
      googleOf(w).fail('videos.list', fault)
      await run(w)
      const [row] = await rows(w, seller, b.date)
      expect(row).toMatchObject({ state: 'WAITING', reason: 'RETRY', attempts: 1 })
      expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: '', chat_ended_at: null })
      expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
      for (let i = 0; i < 10 && (await rows(w, seller, b.date))[0]?.state !== 'SENT'; i++) {
        await w.timer.advance(1000)
        await run(w)
      }
      expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT', attempts: 1 })
      expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: chatId })
      expect(googleOf(w).calls('liveChatMessages.insert')).toBe(1)
    })
  }

  it('5번을 넘게 실패하면 GAVE_UP — 게시 0번, 저장 없음', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    await connect(w, seller)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    googleOf(w).fail('videos.list', { status: 500 }, 6)
    await run(w)
    for (let i = 0; i < 80 && (await rows(w, seller, b.date))[0]?.state !== 'FAILED'; i++) {
      await w.timer.advance(1000)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'GAVE_UP', attempts: 6 })
    expect(googleOf(w).calls('videos.list')).toBe(6)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
    expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: '' })
  })

  it('할당량 초과 → QUOTA 기다림·멈춤 모드(감사만 멈춤) — 채팅 수집은 계속한다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    await connect(w, seller)
    w.server.youtube?.collectors.start()
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    googleOf(w).fail('videos.list', { status: 403, reason: 'quotaExceeded' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'QUOTA', attempts: 0 })
    expect(((await client(w, seller.cookie).get('/api/youtube/quota')).body.quota as { mode: string }).mode).toBe('PAUSED')
    w.web.addMessage(video.videoId, { id: 'later', author: 'UCz', name: '다', text: '안녕하세요', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatEvents(w)).some((event) => event.id === 'later'))
    expect(await collectorOfWorld(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null })
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
  })

  it('권한 없음 → NO_PERMISSION, 토큰을 쓸 수 없음 → RECONNECT 기다림 (게시 0번, 저장 없음)', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    await connect(w, seller)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    googleOf(w).fail('videos.list', { status: 403, reason: 'insufficientPermissions' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NO_PERMISSION' })
    // 둘째 감사: 토큰이 무효이고 새로 고침도 거절 → 다시 연결 필요
    googleOf(w).revokeAll()
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect((await rows(w, seller, b.date))[1]).toMatchObject({ state: 'WAITING', reason: 'RECONNECT' })
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
    expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: '' })
  })

  it('영상이 없거나 채팅 ID가 없으면 REJECTED("유튜브가 받지 않았어요.")·저장 없음·채팅 끝을 적지 않음 — 다음 감사가 다시 한 번 묻는다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    await connect(w, seller)
    // 가짜 구글이 그 영상을 모른다 (사장님 계정에 보이지 않음과 같다)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'REJECTED' })
    expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: '', chat_ended_at: null })
    // 채팅이 꺼진 방송 (activeLiveChatId 없음)
    googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId, chat: false })
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect((await rows(w, seller, b.date))[1]).toMatchObject({ state: 'FAILED', reason: 'REJECTED' })
    expect(googleOf(w).calls('videos.list')).toBe(2)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(0)
    expect(await linkRow(w, seller)).toMatchObject({ live_chat_id: '', chat_ended_at: null })
  })
})

describe('D-YT-SRV-17 게시 확인 — 서버 수집기가 본 우리 글로만', () => {
  async function confirming(w: WebWorld) {
    const { seller, b, video } = await linkedWeb(w)
    const chatId = officialChat(w, video)
    const channel = await connect(w, seller)
    w.server.youtube?.collectors.start()
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    googleOf(w).fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENDING', reason: 'CONFIRM' })
    expect(googleOf(w).messages(chatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    return { seller, b, video, channel }
  }

  it('응답을 모르는 게시 → 수집기가 본 글 올리는 계정의 같은 글로 SENT·게시 보고, 그 글은 채팅으로 기록하지 않는다. 공식 조회 0', async () => {
    const w = await world()
    const { seller, b, video, channel } = await confirming(w)
    // 유튜브 화면에 우리 글이 보인다 (작성자 = 글 올리는 계정, 공식 메시지 ID와 웹 ID는 다르다)
    w.web.addMessage(video.videoId, { id: 'web-own', author: channel.id, name: '사장님 채널', text: TEXT, publishedAt: w.timer.now() })
    for (let i = 0; i < 40 && (await rows(w, seller, b.date))[0]?.state !== 'SENT'; i++) {
      await w.timer.advance(500)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT', messageId: 'web-own' })
    expect((await chatEvents(w)).some((event) => event.id === 'web-own')).toBe(false)
    const own = await w.database.pglite?.query<{ link_id: string; author_channel_id: string }>(`select link_id, author_channel_id from youtube_own_messages where message_id = 'web-own'`)
    expect(own?.rows).toEqual([{ link_id: (await linkRow(w, seller)).id, author_channel_id: channel.id }])
    const reports = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'effect.thanksSent'`)
    expect(reports?.rows[0]?.n).toBe(1)
    expect(googleOf(w).calls('liveChatMessages.list')).toBe(0)
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(1)
  })

  it('확인 시간 안에 못 보면 다시 게시하지 않고 UNCONFIRMED — 방송 채널(유튜버)이 쓴 같은 글은 거르지만 확인에는 쓰지 않는다', async () => {
    const w = await world()
    const { seller, b, video } = await confirming(w)
    // 초대 방송: 방송 채널 주인(확장 감사 등)이 같은 글을 썼다 — 우리 감사 글로 걸러 채팅으로 기록하지 않지만, 글 올리는 계정의 글이 아니다
    w.web.addMessage(video.videoId, { id: 'web-host', author: video.channelId, name: '유튜버', text: TEXT, publishedAt: w.timer.now() })
    for (let i = 0; i < 120 && (await rows(w, seller, b.date))[0]?.state !== 'FAILED'; i++) {
      await w.timer.advance(500)
      await run(w)
    }
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED', messageId: null })
    expect((await chatEvents(w)).some((event) => event.id === 'web-host')).toBe(false)
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(1)
    expect(googleOf(w).calls('liveChatMessages.list')).toBe(0)
    const reports = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'effect.thanksSent'`)
    expect(reports?.rows[0]?.n).toBe(0)
  })

  it('초대 방송: 방송 채널 주인(유튜버)이 쓴 우리 감사 문구는 10분 안이면 거른다, 다른 시청자의 같은 문구는 기록한다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    await connect(w, seller)
    // 감사를 보내려 했지만 게시가 거절됨 (글 올리는 계정·채팅 ID는 적혔다 — 보내려 한 문구가 남는다)
    googleOf(w).fail('liveChatMessages.insert', { status: 400, reason: 'messageTextInvalid' })
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'REJECTED' })
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { id: 'host-same', author: video.channelId, name: '유튜버', text: TEXT, publishedAt: w.timer.now() + 1 })
    w.web.addMessage(video.videoId, { id: 'viewer-same', author: 'UCq', name: '시청자', text: TEXT, publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatEvents(w)).some((event) => event.id === 'viewer-same'))
    expect((await chatEvents(w)).some((event) => event.id === 'host-same')).toBe(false)
  })
})

describe('D-YT-SRV-16 처음 올릴 때 적은 글 올리는 계정은 고정', () => {
  it('글 올리는 계정을 적은 뒤 연결을 끊고 다른 채널을 이으면 감사는 NOT_MY_CHANNEL(게시 0번) — 칸은 바뀌지 않는다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    const first = await connect(w, seller)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: first.id })
    expect((await client(w, seller.cookie).post('/api/youtube/connection/disconnect', {})).status).toBe(200)
    await connect(w, seller)
    await sale(w, seller, b.id, 16, { id: 'c2', ch: 'UCb', nick: '나' })
    await run(w)
    expect((await rows(w, seller, b.date))[1]).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
    expect(googleOf(w).calls('liveChatMessages.insert')).toBe(1)
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: first.id })
  })

  it('수동 재전송: 글 올리는 계정이 비어 있으면 채널 다름으로 막지 않는다', async () => {
    const w = await world()
    const { seller, b, video } = await linkedWeb(w)
    officialChat(w, video)
    // 연결 없이 감사가 생김 → 동의 전(NO_CONSENT)
    await sale(w, seller, b.id, 15, { id: 'c1', ch: 'UCa', nick: '가' })
    await run(w)
    const [row] = await rows(w, seller, b.date)
    expect(row).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
    const channel = await connect(w, seller)
    const resent = await client(w, seller.cookie).post(`/api/outbox/${String(row?.id)}/resend`, { requestId: 'rs-web-1' })
    expect(resent.status, JSON.stringify(resent.body)).toBe(200)
    await run(w)
    expect((await rows(w, seller, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(googleOf(w).posted.map((post) => post.authorChannelId)).toEqual([channel.id])
    expect(await linkRow(w, seller)).toMatchObject({ channel_id: channel.id })
  })
})
