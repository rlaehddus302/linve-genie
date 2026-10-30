// INV1 초대받은 유튜버 방송 — 서버 (YT-02·YT-04·YT-05·YT-06·YT-10, D-PHN-17~21·24, D-INV1-01~04): AC-INV1-01~04·06~10의 서버 몫.
// 사장님 연결 채널 A(글 올리는 계정), 유튜버 채널 B("다육이유튜버", 방송 채널)의 진행 중 공개 방송을 가짜 구글에 둔다.
import { getProduct, listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { INVITED_WINDOW_SEC } from '../src/youtube/outbox.ts'
import { addSeller, client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { approve, callback, connectSeller, drive, enableConsent, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld()
  worlds.push(created)
  return created
}

const B_TITLE = '다육이유튜버'
const NO_LABEL = { 'print.autoOnConfirm': false }
const CONFIRM_MESSAGE = '내 채널 방송이 아니에요. 초대받은 방송이 맞나요?'
const OLD_MESSAGE = '내 채널의 방송만 연결할 수 있어요.'
const NO_LIVE_CHAT = { error: { code: 'NO_LIVE_CHAT', message: '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.' } }

const youtubeOf = (w: YoutubeWorld) => {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube
}
const run = (w: YoutubeWorld) => drive(w, youtubeOf(w).outbox.runOnce())
/** 초대 방송의 실시간 채팅 감사는 60초 창에 묶인다 (D-YT-SRV-18) — 창이 닫힌 뒤 한 바퀴 더 */
async function runPastInvitedWindow(w: YoutubeWorld) {
  await run(w)
  await w.timer.advance(INVITED_WINDOW_SEC * 1000)
  await run(w)
}

async function count(w: YoutubeWorld, sql: string): Promise<number> {
  return (await w.database.pglite?.query<{ n: number }>(sql))?.rows[0]?.n ?? -1
}

/** 사장님(채널 A 연결) + 유튜버 채널 B의 진행 중 방송 + 오늘 회차 */
async function invitedWorld(options: { publish?: boolean | 'LIVE_CHAT' | 'VIDEO_COMMENT'; settings?: Record<string, unknown> } = {}) {
  const w = await world()
  const connected = await connectSeller(w, { channelTitle: '사장님 가게', ...(options.publish === undefined ? {} : { publish: options.publish }) })
  const api = client(w, connected.seller.cookie)
  if (options.settings !== undefined) {
    const patched = await api.patch('/api/settings', { settings: options.settings })
    expect(patched.status, patched.text).toBe(200)
  }
  const channelB = w.fake.addChannel(w.fake.addAccount(), B_TITLE)
  const liveB = w.fake.addBroadcast(channelB.id, { title: '같이 하는 다육이 방송', status: 'live' })
  const b = await createBroadcast(w, connected.seller)
  const link = (body: Record<string, unknown>, target = b.id) => api.post(`/api/broadcasts/${target}/youtube`, body)
  return { w, connected, api, channelB, liveB, liveChatId: liveB.liveChatId as string, b, link }
}

/** 초대 방송을 확인과 함께 잇는다 */
async function linkInvited(options: Parameters<typeof invitedWorld>[0] = {}) {
  const world = await invitedWorld(options)
  const linked = await world.link({ requestId: 'inv-link', video: `https://www.youtube.com/watch?v=${world.liveB.videoId}`, confirmInvited: true })
  expect(linked.status, linked.text).toBe(200)
  return world
}

async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price }))
}

interface Row {
  id: number
  target: string
  state: string
  reason: string | null
  text: string
  viaExtension?: boolean
}
async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function chatCount(w: YoutubeWorld): Promise<number> {
  return count(w, `select count(*)::int as n from events where type = 'chat'`)
}

describe('AC-INV1-01 확인 표시 없이 남의 채널 방송 → 잇지 않고 확인 필요 코드와 채널 이름', () => {
  it('잇기 기록 0·수집기 0·영상 조회 한 번, 응답에 채널 이름, 옛 문장 없음', async () => {
    const { w, liveB, channelB, link, api, b } = await invitedWorld()
    for (const body of [
      { requestId: 'r1', video: liveB.videoId },
      { requestId: 'r2', video: liveB.videoId, confirmInvited: false },
    ]) {
      const response = await link(body)
      expect(response.status).toBe(409)
      expect(response.body).toEqual({ channel: { id: channelB.id, title: B_TITLE }, error: { code: 'INVITED_CONFIRM_NEEDED', message: CONFIRM_MESSAGE } })
      expect(response.text).not.toContain(OLD_MESSAGE)
    }
    expect(await count(w, 'select count(*)::int as n from youtube_links')).toBe(0)
    expect(await count(w, 'select count(*)::int as n from youtube_collectors')).toBe(0)
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body).toEqual({ link: null, collector: null })
    // 같은 요청 번호로 확인과 함께 다시 보내면 그때 잇는다 (확인 전 요청은 아무것도 남기지 않았다)
    const confirmed = await link({ requestId: 'r1', video: liveB.videoId, confirmInvited: true })
    expect(confirmed.status, confirmed.text).toBe(200)
    expect(w.fake.calls('videos.list')).toBe(3)
  })

  it('채널 이름이 비어도 코드는 그대로 (빈 글 — 화면이 "(이름 없음)"), 태그 이름은 글자 그대로 돌려준다', async () => {
    const { w, link } = await invitedWorld()
    const nameless = w.fake.addBroadcast(w.fake.addChannel(w.fake.addAccount(), '').id, { status: 'live' })
    expect((await link({ requestId: 'n1', video: nameless.videoId })).body).toMatchObject({ channel: { title: '' }, error: { code: 'INVITED_CONFIRM_NEEDED' } })
    const tagged = w.fake.addBroadcast(w.fake.addChannel(w.fake.addAccount(), '<img src=x onerror=alert(1)>').id, { status: 'live' })
    const response = await link({ requestId: 'n2', video: tagged.videoId })
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.body).toMatchObject({ channel: { title: '<img src=x onerror=alert(1)>' } })
  })
})

describe('AC-INV1-02 확인 표시와 함께 → 잇고 글 올리는 계정 A·방송 채널 B 따로 기록, 수집은 A의 토큰', () => {
  it('이은 기록·이은 사람·화면 보기, 수집기가 A의 토큰으로 B 방송 채팅을 읽어 시청자 채팅을 기록한다', async () => {
    const { w, connected, channelB, liveB, liveChatId, b, api } = await linkInvited()
    const view = (await api.get(`/api/broadcasts/${b.id}/youtube`)).body as { link: Record<string, unknown> }
    expect(view.link).toMatchObject({ videoId: liveB.videoId, channelId: connected.channel.id, broadcastChannelId: channelB.id, broadcastChannelTitle: B_TITLE, invited: true })
    const stored = await w.database.pglite?.query<Record<string, unknown>>(`select channel_id, broadcast_channel_id, broadcast_channel_title, linked_by from youtube_links`)
    expect(stored?.rows).toEqual([{ channel_id: connected.channel.id, broadcast_channel_id: channelB.id, broadcast_channel_title: B_TITLE, linked_by: connected.seller.accountId }])
    youtubeOf(w).collectors.start()
    w.fake.addMessage(liveChatId, { id: 'v1', author: 'UCviewer1', name: '시청자', text: '안녕하세요', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatCount(w)) === 1, { step: 100 })
    const reads = w.fake.chatReads.filter((read) => read.liveChatId === liveChatId)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((read) => read.channel === connected.channel.id)).toBe(true)
  })

  it('확인 요청 때 영상을 다시 본다: 그사이 채팅이 꺼졌으면 확인이 있어도 잇지 않는다', async () => {
    const { w, link, liveB, liveChatId } = await invitedWorld()
    expect((await link({ requestId: 'c1', video: liveB.videoId })).status).toBe(409)
    w.fake.endChat(liveChatId)
    expect((await link({ requestId: 'c2', video: liveB.videoId, confirmInvited: true })).body).toEqual(NO_LIVE_CHAT)
    expect(await count(w, 'select count(*)::int as n from youtube_links')).toBe(0)
  })
})

describe('AC-INV1-03 내 방송은 지금처럼 (방송 채널 = 글 올리는 계정)', () => {
  it('주소·목록 잇기 모두 확인 없이, invited 아님. 내 라이브 목록에 B 방송 없음', async () => {
    const { w, connected, api, link } = await invitedWorld()
    const mine = w.fake.addBroadcast(connected.channel.id, { title: '내 방송', status: 'live' })
    const list = (await api.get('/api/youtube/live-broadcasts')).body.broadcasts as { videoId: string; title: string }[]
    expect(list.map((item) => item.title)).toEqual(['내 방송'])
    const linked = await link({ requestId: 'm1', video: mine.videoId })
    expect(linked.status, linked.text).toBe(200)
    expect((linked.body as { link: Record<string, unknown> }).link).toMatchObject({ channelId: connected.channel.id, broadcastChannelId: connected.channel.id, broadcastChannelTitle: '사장님 가게', invited: false })
    // 내 방송에 확인 표시를 붙여 보내도 그냥 내 방송으로 잇는다
    const b2 = await createBroadcast(w, connected.seller)
    const mine2 = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    const again = await link({ requestId: 'm2', video: mine2.videoId, confirmInvited: true }, b2.id)
    expect((again.body as { link: Record<string, unknown> }).link).toMatchObject({ invited: false, broadcastChannelId: connected.channel.id })
  })

  it('INV1 전 기록(방송 채널 칸 빔)은 방송 채널 = 글 올리는 계정으로 읽는다 (D-INV1-01)', async () => {
    const { w, connected, api, link, b } = await invitedWorld()
    const mine = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    expect((await link({ requestId: 'o1', video: mine.videoId })).status).toBe(200)
    await w.database.pglite?.query(`update youtube_links set broadcast_channel_id = null, broadcast_channel_title = null`)
    const view = (await api.get(`/api/broadcasts/${b.id}/youtube`)).body as { link: Record<string, unknown> }
    expect(view.link).toMatchObject({ channelId: connected.channel.id, broadcastChannelId: connected.channel.id, broadcastChannelTitle: null, invited: false })
  })
})

describe('AC-INV1-04 다른 받는 조건은 확인이 있어도 그대로', () => {
  it('끝난 방송·채팅 꺼짐 → NO_LIVE_CHAT, 리허설·끝난 회차는 잇지 않음, 그 판매자의 다른 회차에 이어진 영상은 VIDEO_IN_USE. 다른 판매자는 같은 영상을 이을 수 있다', async () => {
    const { w, connected, channelB, liveB, link, api } = await invitedWorld()
    const confirm = (requestId: string, video: string, target?: string) => link({ requestId, video, confirmInvited: true }, target)
    const ended = w.fake.addBroadcast(channelB.id, { status: 'complete' })
    const noChat = w.fake.addBroadcast(channelB.id, { status: 'live', chat: false })
    expect((await confirm('a1', ended.videoId)).body).toEqual(NO_LIVE_CHAT)
    expect((await confirm('a2', noChat.videoId)).body).toEqual(NO_LIVE_CHAT)
    // 없는 영상(사장님 계정으로 보이지 않음)도 같은 문장 — 옛 "내 채널의 방송만" 문장은 없다
    const missing = await confirm('a3', 'zzzzzzzzzzz')
    expect(missing.body).toEqual(NO_LIVE_CHAT)
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    expect((await confirm('a4', liveB.videoId, rehearsal.id)).body).toMatchObject({ error: { code: 'REHEARSAL_LINK' } })
    const endedB = await createBroadcast(w, connected.seller)
    expect((await api.post(`/api/broadcasts/${endedB.id}/end`, { requestId: 'end-1' })).status).toBe(200)
    expect((await confirm('a5', liveB.videoId, endedB.id)).body).toMatchObject({ error: { code: 'BROADCAST_ENDED' } })
    expect((await confirm('a6', liveB.videoId)).status).toBe(200)
    const other = await createBroadcast(w, connected.seller)
    expect((await confirm('a7', liveB.videoId, other.id)).body).toMatchObject({ error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } })
    expect((await confirm('a8', liveB.videoId, other.id)).status).toBe(409)
    // 다른 판매자(자기 채널 연결)가 같은 영상을 잇는 것은 막지 않는다
    const second = await connectSeller(w, { seller: await addSeller(w), channelTitle: '다른 가게' })
    const secondB = await createBroadcast(w, second.seller)
    const theirs = await client(w, second.seller.cookie).post(`/api/broadcasts/${secondB.id}/youtube`, { requestId: 'x1', video: liveB.videoId, confirmInvited: true })
    expect(theirs.status, theirs.text).toBe(200)
  })
})

describe('AC-INV1-06 초대 방송의 실시간 채팅 감사는 A의 토큰으로 그 방송 채팅에', () => {
  it('동의 있음: 시청자 "15" 확정 → 감사 한 건이 A 이름으로 B 방송 채팅에 (내 방송과 같은 문구)', async () => {
    const { w, connected, b, liveChatId } = await linkInvited({ publish: 'LIVE_CHAT', settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await runPastInvitedWindow(w)
    expect(w.fake.posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[liveChatId, connected.channel.id, '15번 핑크프릴 10,000원 가님 구매 감사합니다']])
    expect((await rows(w, connected, b.date)).map((row) => row.state)).toEqual(['SENT'])
  })

  it('동의 없음: 보내지 않음(NO_CONSENT)', async () => {
    const { w, connected, b } = await linkInvited({ settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await run(w)
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([['FAILED', 'NO_CONSENT']])
  })
})

describe('AC-INV1-07 채널이 바뀌면 보내지 않음 · 우리 글은 채팅으로 기록하지 않음 · 403 거절은 지금 실패 이유', () => {
  it('(1) 잇고 나서 연결을 끊고 채널 C를 연결 → FAILED(NOT_MY_CHANNEL), 게시 0', async () => {
    const { w, connected, b, api } = await linkInvited({ publish: 'LIVE_CHAT', settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    expect((await api.post('/api/youtube/connection/disconnect', {})).status).toBe(200)
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '채널 C')
    w.fake.approval = { account: accountC, channel: channelC.id }
    const started = await api.post('/api/youtube/connection/start', {})
    expect(await callback(w, connected.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    await enableConsent(w, connected.seller, 'LIVE_CHAT')
    await w.timer.advance(1000)
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await runPastInvitedWindow(w)
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([['FAILED', 'NOT_MY_CHANNEL']])
  })

  it('(2) A가 올린 감사 글이 채팅 목록에 다시 와도 시청자 채팅으로 기록하지 않는다 (두 번 게시 0)', async () => {
    const { w, connected, b, liveChatId } = await linkInvited({ publish: 'LIVE_CHAT', settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    const youtube = youtubeOf(w)
    youtube.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCviewer1', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatCount(w)) === 1, { step: 100 })
    await youtube.outbox.runOnce()
    await w.timer.advance(INVITED_WINDOW_SEC * 1000)
    await youtube.outbox.runOnce()
    expect(w.fake.posted).toHaveLength(1)
    await until(w, async () => (await count(w, `select count(*)::int as n from youtube_own_messages`)) === 1, { step: 100 })
    expect(await chatCount(w)).toBe(1)
    await youtube.outbox.runOnce()
    expect(w.fake.posted).toHaveLength(1)
  })

  it('(3) 가짜 구글이 감사 게시를 403으로 거절 → 지금 실패 이유로 남고 찜·확정은 그대로', async () => {
    const { w, connected, b } = await linkInvited({ publish: 'LIVE_CHAT', settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    w.fake.fail('liveChatMessages.insert', { status: 403, reason: 'forbidden' })
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await runPastInvitedWindow(w)
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([['FAILED', 'NO_PERMISSION']])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 15)?.winners).toEqual(['UCviewer1'])
  })
})

describe('AC-INV1-08 유튜버(방송 채널 주인)의 채팅은 방송자 글', () => {
  it('claim.ignoreOwner 예: B의 "15번 2만원"은 찜 0, 시청자 "15"는 찜 1', async () => {
    const { w, connected, b, liveChatId, channelB } = await linkInvited({ settings: { ...NO_LABEL, 'claim.ignoreOwner': true } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    youtubeOf(w).collectors.start()
    w.fake.addMessage(liveChatId, { author: channelB.id, name: B_TITLE, text: '15번 2만원', publishedAt: w.timer.now() + 1 })
    w.fake.addMessage(liveChatId, { author: 'UCviewer1', name: '시청자', text: '15', publishedAt: w.timer.now() + 2 })
    await until(w, async () => (await chatCount(w)) === 2, { step: 100 })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    const claims = listClaims(state).filter((claim) => claim.no === 15)
    expect(claims.map((claim) => claim.buyer)).toEqual(['UCviewer1'])
  })
})

describe('AC-INV1-09 방송 후 요약 댓글은 A의 토큰으로 B의 영상에', () => {
  async function ended(settings: Record<string, unknown>) {
    const world = await linkInvited({ publish: true, settings: { ...NO_LABEL, ...settings } })
    const { w, connected, b, api } = world
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCviewer1', nick: '가', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    await run(w)
    expect((await api.post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-sum' })).status).toBe(200)
    await w.timer.advance(11 * 60 * 1000)
    return world
  }

  it('SUMMARY: 요약 댓글 한 건이 A 이름으로 B의 영상에', async () => {
    const { w, connected, liveB } = await ended({ 'thanks.videoComment': 'SUMMARY' })
    await run(w)
    await run(w)
    expect(w.fake.comments.map((comment) => [comment.videoId, comment.authorChannelId])).toEqual([[liveB.videoId, connected.channel.id]])
  })

  it('OFF(기본)면 0건', async () => {
    const { w } = await ended({})
    await run(w)
    await run(w)
    expect(w.fake.comments).toEqual([])
  })

  it('댓글 막힘으로 거절되면 지금 실패 이유로 남는다', async () => {
    const { w, connected, b } = await ended({ 'thanks.videoComment': 'SUMMARY' })
    w.fake.fail('commentThreads.insert', { status: 403, reason: 'commentsDisabled' })
    await run(w)
    await run(w)
    expect(w.fake.comments).toEqual([])
    const summary = (await rows(w, connected, b.date)).find((row) => row.target === 'SUMMARY')
    expect([summary?.state, summary?.reason]).toEqual(['FAILED', 'REJECTED'])
  })
})

describe('AC-INV1-10 크롬 확장: 방송자 배지 기준은 방송 채널, 초대 방송 감사는 확장에 맡기지 않음', () => {
  async function ext(w: YoutubeWorld, path: string, token: string, body: unknown) {
    await w.timer.advance(250)
    const response = await w.server.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>, text }
  }

  async function extWorld(publish: boolean | 'LIVE_CHAT') {
    const world = await linkInvited({ publish, settings: { ...NO_LABEL, 'claim.ignoreOwner': true, 'thanks.batchWindowSec': 0 } })
    const { w, api, b, liveB } = world
    const issued = await api.post('/api/extension/code', {})
    const exchanged = await w.server.app.request('/ext/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: issued.body.code }) })
    const token = ((await exchanged.json()) as { token: string }).token
    expect((await ext(w, '/ext/bind', token, { v: liveB.videoId, broadcast: b.id })).status).toBe(200)
    const on = await api.post('/api/extension/thanks', { enabled: true, agreed: true })
    expect(on.status, on.text).toBe(200)
    await product(w, world.connected, b.id, 15, '핑크프릴', 10000)
    await product(w, world.connected, b.id, 16, '라울', 10000)
    return { ...world, token }
  }

  it('(1) B의 주인 배지 글은 방송자 글(찜 0), A의 배지라고 우기는 글은 시청자 글', async () => {
    const { w, token, liveB, channelB, connected, b } = await extWorld('LIVE_CHAT')
    const sent = await ext(w, '/ext/chats', token, {
      v: liveB.videoId,
      messages: [
        { id: 'e1', ch: channelB.id, nick: B_TITLE, text: '15', at: w.timer.now(), owner: true },
        { id: 'e2', ch: 'UCviewer0000000000000001', nick: '시청자', text: '16', at: w.timer.now() },
      ],
    })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body).toMatchObject({ recorded: 2, ownerDenied: 0 })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listClaims(state).map((claim) => [claim.no, claim.buyer])).toEqual([[16, 'UCviewer0000000000000001']])
    // 글 올리는 계정(A)의 배지 표시는 이 회차의 방송 채널이 아니다 — 일반 시청자로 센다
    const forged = await ext(w, '/ext/chats', token, { v: liveB.videoId, messages: [{ id: 'e3', ch: connected.channel.id, nick: '사장님 가게', text: '안녕', at: w.timer.now(), owner: true }] })
    expect(forged.body).toMatchObject({ ownerDenied: 1 })
  })

  it('(2)(3) 확장 감사 켜짐이어도 확장 가져가기 0건·공식으로 게시, 방송 채널 로그인 안내 없음', async () => {
    const { w, token, liveB, channelB, connected, b, api, liveChatId } = await extWorld('LIVE_CHAT')
    expect((await ext(w, '/ext/chats', token, { v: liveB.videoId, messages: [{ id: 'e1', ch: 'UCviewer0000000000000001', nick: '가', text: '15', at: w.timer.now() }] })).status).toBe(200)
    // 확장이 B의 방송 화면에서 묻는다 (로그인 계정이 주인 아님·주인 둘 다)
    for (const [meIsOwner, owner] of [
      [false, channelB.id],
      [true, channelB.id],
      [true, connected.channel.id],
    ] as const) {
      const taken = await ext(w, '/ext/thanks/take', token, { v: liveB.videoId, meIsOwner, owner })
      expect(taken.body.state).toBe('NONE')
      expect(taken.body.post).toBeNull()
      expect(taken.text).not.toContain('방송 채널 계정으로 로그인해야')
    }
    await runPastInvitedWindow(w)
    expect(w.fake.posted.map((post) => [post.liveChatId, post.authorChannelId])).toEqual([[liveChatId, connected.channel.id]])
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.viaExtension])).toEqual([['SENT', false]])
    const view = await api.get('/api/extension')
    expect(view.text).not.toContain('방송 채널 계정으로 로그인해야')
    expect((view.body.extension as { thanks: { warnings: unknown[] } }).thanks.warnings).toEqual([])
  })

  it('공식 잇기를 끊어도 확장이 같은 영상을 받으면 방송 채널은 B 그대로: B의 배지 글은 방송자 글, 확장 가져가기 0·로그인 안내 없음 (TD-INV1-009)', async () => {
    const { w, token, liveB, channelB, connected, b, api } = await extWorld('LIVE_CHAT')
    expect((await api.post(`/api/broadcasts/${b.id}/youtube/unlink`, { requestId: 'inv-unlink' })).status).toBe(200)
    const sent = await ext(w, '/ext/chats', token, {
      v: liveB.videoId,
      messages: [
        { id: 'u1', ch: channelB.id, nick: B_TITLE, text: '16', at: w.timer.now(), owner: true },
        { id: 'u2', ch: connected.channel.id, nick: '사장님 가게', text: '15', at: w.timer.now(), owner: true },
      ],
    })
    expect(sent.status, sent.text).toBe(200)
    // B는 방송자, 글 올리는 계정 A의 배지 표시는 여전히 이 회차의 방송 채널이 아니다
    expect(sent.body).toMatchObject({ ownerDenied: 1 })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listClaims(state).filter((claim) => claim.buyer === channelB.id)).toEqual([])
    for (const [meIsOwner, owner] of [
      [false, channelB.id],
      [true, channelB.id],
      [true, connected.channel.id],
    ] as const) {
      const taken = await ext(w, '/ext/thanks/take', token, { v: liveB.videoId, meIsOwner, owner })
      expect(taken.body.state).toBe('NONE')
      expect(taken.text).not.toContain('방송 채널 계정으로 로그인해야')
    }
    const view = await api.get('/api/extension')
    expect((view.body.extension as { thanks: { warnings: unknown[] } }).thanks.warnings).toEqual([])
  })

  it('(2) 공식으로 올릴 수 없어도(게시 권한 없음) 확장에 맡기지 않는다', async () => {
    const { w, token, liveB, connected, b } = await extWorld(false)
    expect((await ext(w, '/ext/chats', token, { v: liveB.videoId, messages: [{ id: 'e1', ch: 'UCviewer0000000000000001', nick: '가', text: '15', at: w.timer.now() }] })).status).toBe(200)
    await run(w)
    await run(w)
    const list = await rows(w, connected, b.date)
    expect(list.every((row) => row.viaExtension !== true && row.reason !== 'EXTENSION')).toBe(true)
    expect((await ext(w, '/ext/thanks/take', token, { v: liveB.videoId, meIsOwner: true, owner: liveB.channelId })).body.state).toBe('NONE')
    expect(w.fake.posted).toEqual([])
  })
})

describe('확인 표시 모양 (D-INV1-02)', () => {
  it('true만 확인. "true"·1·{}·null은 400이고 잇지 않는다', async () => {
    const { w, link, liveB } = await invitedWorld()
    let n = 0
    for (const value of ['true', 1, {}, null]) {
      const response = await link({ requestId: `s${String(++n)}`, video: liveB.videoId, confirmInvited: value })
      expect(response.status, JSON.stringify(value)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'confirmInvited' }] } })
    }
    expect(await count(w, 'select count(*)::int as n from youtube_links')).toBe(0)
  })
})
