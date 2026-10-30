// AC-Y1-92~98 게시 안전·할당량 후속 (Y1 감사 minor 정리 — D-Y1-02~D-Y1-08): 지금 연결한 채널에만 게시(RA-Y1-003), 게시 확인 짝짓기(RA-Y1-004),
// 수집 호출 간격·예정 방송(RA-Y1-005), 이미 켠 동의의 시각(RA-Y1-007), 확인하지 못하면 다시 게시하지 않음(RA-Y1-008), 할당량 모드 알림(SA-Y1-006),
// 한 영상은 한 회차에만 — 동시에도(RA-Y1-006). 게시·호출은 가짜 서버가 받은 것으로 센다.
import { afterEach, describe, expect, it } from 'vitest'
import { client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { approve, callback, connectSeller, drive, enableConsent, linkedBroadcast, sibling, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
const extras: { server: { close(): void; stop(): Promise<void> } }[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
function extra(w: YoutubeWorld, name: string, overrides: Parameters<typeof sibling>[2] = {}): YoutubeWorld {
  const created = sibling(w, name, overrides)
  extras.push(created)
  return created
}
afterEach(async () => {
  for (const item of extras.splice(0)) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const NO_LABEL = { 'print.autoOnConfirm': false }
const NOT_MY_CHANNEL = '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.'
const UNCONFIRMED = '올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.'

function youtubeOf(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube
}
const runner = (w: YoutubeWorld) => youtubeOf(w).outbox
/** 한 바퀴 (보내는 동안 시계를 1초씩 옮긴다 — 응답 없음·타임아웃) */
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())

interface Row {
  id: number
  target: string
  state: string
  reason: string | null
  reasonMessage: string | null
  text: string
  attempts: number
  messageId: string | null
  buyer: string | null
}

async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function eventTypes(w: YoutubeWorld): Promise<string[]> {
  return ((await w.database.pglite?.query<{ type: string }>(`select type from events order by id`))?.rows ?? []).map((row) => row.type)
}

async function chat(w: YoutubeWorld, connected: Connected, b: string, id: string, ch: string, nick: string, text: string) {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number, stock?: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price, ...(stock === undefined ? {} : { stock }) }))
}

/** 연결을 끊고 (새 계정의) 다른 채널 또는 정한 채널로 다시 연결한다 */
async function reconnectTo(w: YoutubeWorld, connected: Connected, approval: { account: string; channel: string }): Promise<void> {
  const api = client(w, connected.seller.cookie)
  expect((await api.post('/api/youtube/connection/disconnect', {})).status).toBe(200)
  w.fake.approval = approval
  const started = await api.post('/api/youtube/connection/start', {})
  expect(await callback(w, connected.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
}

/** 조건이 될 때까지 시계를 옮기며 실행기를 돌린다 */
async function runUntil(w: YoutubeWorld, predicate: () => Promise<boolean>, step = 2000, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await predicate()) return
    await w.timer.advance(step)
    await run(w)
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

/** SSE를 읽어 모은다 */
function sse(w: YoutubeWorld, cookie: string): { text: () => string; close: () => Promise<void> } {
  let text = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const decoder = new TextDecoder()
  const pump = (async () => {
    const response = await client(w, cookie).raw('/api/stream', {})
    reader = response.body?.getReader()
    for (;;) {
      const chunk = await reader?.read()
      if (chunk === undefined || chunk.done) break
      text += decoder.decode(chunk.value)
    }
  })()
  return {
    text: () => text,
    close: async () => {
      await reader?.cancel()
      await pump
    },
  }
}

const realPause = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

// ── AC-Y1-92 ─────────────────────────────────────────────────────────────

describe('AC-Y1-92 지금 연결한 채널의 방송에만 게시 (RA-Y1-003)', () => {
  it('채널 A로 이은 회차: 끊고 채널 C를 연결·동의 → 새 판매의 감사·영상 댓글은 어디에도 게시 0번(NOT_MY_CHANNEL), 재전송도 거절. A로 다시 연결하면 재전송으로 A에 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.videoComment': 'PER_SALE', 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '다른 채널')
    await reconnectTo(w, connected, { account: accountC, channel: channelC.id })
    await enableConsent(w, connected.seller, 'LIVE_CHAT')
    await enableConsent(w, connected.seller, 'VIDEO_COMMENT')
    await w.timer.advance(1000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    await w.timer.advance(5000)
    await run(w)
    expect(w.fake.posted).toEqual([])
    expect(w.fake.comments).toEqual([])
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => [row.target, row.state, row.reason, row.reasonMessage]).sort()).toEqual([
      ['LIVE_CHAT', 'FAILED', 'NOT_MY_CHANNEL', NOT_MY_CHANNEL],
      ['VIDEO_COMMENT', 'FAILED', 'NOT_MY_CHANNEL', NOT_MY_CHANNEL],
    ])
    // 수동 재전송도 받지 않는다 (행은 그대로 FAILED)
    const api = client(w, connected.seller.cookie)
    const liveRow = list.find((row) => row.target === 'LIVE_CHAT') as Row
    const refused = await api.post(`/api/outbox/${String(liveRow.id)}/resend`, { requestId: 'nm-1' })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: { code: 'NOT_MY_CHANNEL', message: NOT_MY_CHANNEL } })
    expect((await rows(w, connected, b.date)).find((row) => row.id === liveRow.id)).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
    await run(w)
    expect(w.fake.posted).toEqual([])
    // 채널 A로 다시 연결 → 재전송하면 A의 채팅에 1번
    await reconnectTo(w, connected, { account: connected.account, channel: connected.channel.id })
    await enableConsent(w, connected.seller, 'LIVE_CHAT')
    const resent = await api.post(`/api/outbox/${String(liveRow.id)}/resend`, { requestId: 'nm-2' })
    expect(resent.status, JSON.stringify(resent.body)).toBe(200)
    await run(w)
    expect(w.fake.posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[liveChatId, connected.channel.id, '15번 핑크프릴 10,000원 가님 구매 감사합니다']])
    expect(w.fake.comments).toEqual([])
  })

  it('확인 중(SENDING)에 채널이 바뀐 감사는 이은 채널로 조회할 수 없어 확인하지 못함(UNCONFIRMED, I3 AC-I3-85), 방송 후 요약 댓글은 NOT_MY_CHANNEL — 게시 0번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.videoComment': 'SUMMARY', 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    // 유튜브가 받지 않고 응답도 없다 → 확인 중
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-92' })).status).toBe(200)
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '다른 채널')
    await reconnectTo(w, connected, { account: accountC, channel: channelC.id })
    await enableConsent(w, connected.seller, 'LIVE_CHAT')
    await enableConsent(w, connected.seller, 'VIDEO_COMMENT')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
    // I3 (AC-I3-85·D-I3-17 (1)·(2)): 확인 조회도 그 방송을 이은 채널(A)의 토큰으로만 한다 — 채널이 C로 바뀌면 조회할 수 없어(실패한 조회) 끝 조회 3번 뒤
    // 확인하지 못함(UNCONFIRMED)이다. 다시 시도로 가지 않으니 다시 게시도 없다(전에는 C의 토큰으로 조회해 "못 찾음" → 다시 시도 → NOT_MY_CHANNEL)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ target: 'LIVE_CHAT', state: 'FAILED', reason: 'UNCONFIRMED' })
    // 끝내고 10분 뒤 요약 댓글
    await w.timer.advance(11 * 60 * 1000)
    await run(w)
    await run(w)
    const summary = (await rows(w, connected, b.date)).find((row) => row.target === 'SUMMARY')
    expect(summary).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL', reasonMessage: NOT_MY_CHANNEL })
    expect(w.fake.posted).toEqual([])
    expect(w.fake.comments).toEqual([])
  })
})

// ── AC-Y1-93 ─────────────────────────────────────────────────────────────

const SAME = '15번 핑크프릴 10,000원 시청자님 구매 감사합니다'

/** 재고 2인 15번을 이름이 비어 `시청자`인 두 시청자가 1등 — 감사 둘의 글이 같다 (묶음 창 0초) */
async function namelessPair(w: YoutubeWorld) {
  const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
  const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
  await product(w, connected, b.id, 15, '핑크프릴', 10000, 2)
  // 방송 채팅에는 감사 시도 전부터 올라온 시청자 채팅이 있다 — 지점 없는 조회의 첫 쪽이 그 시도 전까지 거슬러 가야 "모두 본" 조회다 (RA-I3-001)
  w.fake.addMessage(liveChatId, { author: 'UCearly', name: '먼저 온 시청자', text: '안녕하세요', publishedAt: w.timer.now() - 60_000 })
  const second = () => chat(w, connected, b.id, 'v2', 'UCv2', 'ㅤㅤ', '15')
  await chat(w, connected, b.id, 'v1', 'UCv1', '​', '15')
  return { connected, b, liveChatId, second }
}

async function expectPaired(w: YoutubeWorld, connected: Connected, date: string, liveChatId: string): Promise<Row[]> {
  const list = await rows(w, connected, date)
  expect(list.map((row) => [row.text, row.state])).toEqual([
    [SAME, 'SENT'],
    [SAME, 'SENT'],
  ])
  const posted = w.fake.messages(liveChatId).filter((message) => message.text === SAME)
  expect(posted).toHaveLength(2)
  expect(list[0]?.messageId).not.toBe(list[1]?.messageId)
  expect(new Set(list.map((row) => row.messageId))).toEqual(new Set(posted.map((message) => message.id)))
  expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(2)
  return list
}

/**
 * 서버 수집기가 그 회차에서 우리 글을 본 것처럼 (D-YT-SRV-17 — 실시간 채팅 게시 확인은 공식 조회 없이 수집기가 본 우리 글로만).
 * 가짜 채팅에 글 올리는 계정이 올린 글을 우리 글 표(youtube_own_messages)에 그 회차로 적는다. 수집기의 시간 흐름과 상관없이 짝짓기 규칙만 본다
 */
async function seeOwn(w: YoutubeWorld, connected: Connected, liveChatId: string): Promise<void> {
  const link = (await w.database.pglite?.query<{ id: string; scope_id: string }>(`select id, scope_id from youtube_links where seller_id = $1 and unlinked_at is null`, [connected.seller.sellerId]))?.rows[0]
  if (link === undefined) throw new Error('이은 기록이 없다')
  for (const message of w.fake.messages(liveChatId)) {
    if (message.authorChannelId !== connected.channel.id || message.text === null) continue
    await w.database.pglite?.query(
      `insert into youtube_own_messages (seller_id, scope_id, link_id, live_chat_id, author_channel_id, message_id, text, published_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
      [connected.seller.sellerId, link.scope_id, link.id, liveChatId, message.authorChannelId, message.id, message.text, message.publishedAt],
    )
  }
}

/** runUntil + 바퀴마다 수집기가 본 우리 글 (seeOwn) */
async function runSeeing(w: YoutubeWorld, connected: Connected, liveChatId: string, predicate: () => Promise<boolean>, step = 2000, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await seeOwn(w, connected, liveChatId)
    if (await predicate()) return
    await w.timer.advance(step)
    await run(w)
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

/** 게시된 같은 글의 메시지 ID — 게시 시각 순, 같으면 메시지 ID 순 (AC-Y1-93의 짝짓기 순서) */
function postedOrder(w: YoutubeWorld, liveChatId: string): string[] {
  return w.fake
    .messages(liveChatId)
    .filter((message) => message.text === SAME)
    .map((message) => ({ id: message.id, at: Date.parse(message.publishedAt) }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .map((message) => message.id)
}

describe('AC-Y1-93 게시 확인 짝짓기 — 이미 짝지은 메시지는 고르지 않는다 (RA-Y1-004)', () => {
  // D-YT-SRV-17: 실시간 채팅은 수집기가 본 우리 글로만 확인한다(시험은 seeOwn으로 수집기가 본 글을 적는다). 못 보면 다시 게시하지 않고 UNCONFIRMED
  it('(가) 첫 게시 성공(m1), 둘째는 받지 않고 응답 없음 → 둘째는 수집기가 본 m1을 고르지 않고 UNCONFIRMED(다시 게시 없음)', async () => {
    const w = await world()
    const { connected, b, liveChatId, second } = await namelessPair(w)
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
    await second()
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await run(w)
    await runSeeing(w, connected, liveChatId, async () => (await rows(w, connected, b.date))[1]?.state === 'FAILED')
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => [row.state, row.reason])).toEqual([
      ['SENT', null],
      ['FAILED', 'UNCONFIRMED'],
    ])
    expect(list[0]?.messageId).toBe(w.fake.posted[0]?.id)
    expect(list[1]?.messageId).toBeNull()
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
  })

  it('(나) 둘 다 게시는 받고 응답 없음 → 먼저 난 효과의 행 = 먼저 게시된 메시지, 다시 게시 없음', async () => {
    const w = await world()
    const { connected, b, liveChatId, second } = await namelessPair(w)
    await second()
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' }, 2)
    await run(w)
    await runSeeing(w, connected, liveChatId, async () => (await rows(w, connected, b.date)).every((row) => row.state === 'SENT'))
    const list = await expectPaired(w, connected, b.date, liveChatId)
    expect(list.map((row) => row.messageId)).toEqual(postedOrder(w, liveChatId))
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
  })

  it('(다) (나)를 실행기 둘(같은 데이터베이스)로 돌려도 같다', async () => {
    const w = await world()
    const { connected, b, liveChatId, second } = await namelessPair(w)
    await second()
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' }, 2)
    const other = youtubeOf(extra(w, 'B')).outbox
    for (let i = 0; i < 60 && !(await rows(w, connected, b.date)).every((row) => row.state === 'SENT'); i++) {
      await Promise.all([drive(w, runner(w).runOnce()), drive(w, other.runOnce())])
      await seeOwn(w, connected, liveChatId)
      await w.timer.advance(1000)
    }
    const list = await expectPaired(w, connected, b.date, liveChatId)
    // 먼저 난 효과의 행 = 먼저 게시된 메시지 (게시 시각이 같으면 메시지 ID 순)
    expect(list.map((row) => row.messageId)).toEqual(postedOrder(w, liveChatId))
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
  })

  it('(라) 첫 게시는 받고 응답 없음, 둘째 게시는 성공(m2) → 첫째는 수집기가 본 글 중 m2를 고르지 않고 자기 m1을 찾는다', async () => {
    const w = await world()
    const { connected, b, liveChatId, second } = await namelessPair(w)
    await second()
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    const now = await rows(w, connected, b.date)
    expect(now.map((row) => row.state)).toEqual(['SENDING', 'SENT'])
    expect(now[1]?.messageId).toBe(w.fake.posted[1]?.id)
    await runSeeing(w, connected, liveChatId, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    const list = await expectPaired(w, connected, b.date, liveChatId)
    expect(list.map((row) => row.messageId)).toEqual(w.fake.posted.map((post) => post.id))
  })
})

// ── AC-Y1-94 ─────────────────────────────────────────────────────────────

const CHAT_CALLS = new Set(['liveChatMessages.streamList', 'liveChatMessages.list'])

async function chatIds(w: YoutubeWorld): Promise<string[]> {
  const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' order by seq`)
  return (rows?.rows ?? []).map((row) => row.id)
}

async function collector(w: YoutubeWorld, cookie: string, b: string): Promise<Record<string, unknown>> {
  return (await client(w, cookie).get(`/api/broadcasts/${b}/youtube`)).body.collector as Record<string, unknown>
}

/** 시계를 step씩 옮긴다 (실제 I/O가 돌 틈을 준다) */
async function advanceBy(w: YoutubeWorld, total: number, step: number): Promise<void> {
  for (let moved = 0; moved < total; moved += step) {
    await realPause()
    await w.timer.advance(step)
  }
}

const gaps = (times: readonly number[]) => times.slice(1).map((at, index) => at - (times[index] as number))

describe('AC-Y1-94 수집 호출 간격·예정 방송 (RA-Y1-005)', () => {
  it('(가) pollingIntervalMillis 0인 폴링 → 호출 사이 2초 이상, 1분 동안 list ≤ 31번', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    await linkedBroadcast(w, connected)
    w.fake.pollingIntervalMillis = 0
    await w.database.pglite?.query(`update youtube_collectors set mode = 'POLL'`)
    const t0 = w.timer.now()
    youtubeOf(w).collectors.start()
    await advanceBy(w, 60_000, 500)
    await youtubeOf(w).collectors.stop()
    const lists = w.fake.callTimes.filter((call) => call.method === 'liveChatMessages.list' && call.at <= t0 + 60_000).map((call) => call.at)
    expect(lists.length).toBeGreaterThanOrEqual(5)
    expect(lists.length).toBeLessThanOrEqual(31)
    expect(Math.min(...gaps(lists))).toBeGreaterThanOrEqual(2000)
    expect(w.fake.calls('liveChatMessages.streamList')).toBe(0)
  })

  it('(나) 스트림이 응답 하나를 주고 바로 정상으로 닫히기를 반복 → 다시 열기는 5초 간격(1분 ≤ 13번), 채팅은 빠짐·중복 없이 기록', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { liveChatId } = await linkedBroadcast(w, connected)
    w.fake.streamOnce = true
    const t0 = w.timer.now()
    youtubeOf(w).collectors.start()
    const sent: string[] = []
    for (let second = 0; second < 60; second++) {
      if (second % 3 === 0) {
        const id = `once${String(second).padStart(2, '0')}`
        sent.push(id)
        w.fake.addMessage(liveChatId, { id, author: `UC${String(second)}`, name: `시청자${String(second)}`, text: '안녕하세요', publishedAt: w.timer.now() + 1 })
      }
      await advanceBy(w, 1000, 500)
    }
    const opens = w.fake.callTimes.filter((call) => call.method === 'liveChatMessages.streamList' && call.at <= t0 + 60_000).map((call) => call.at)
    expect(opens.length).toBeGreaterThanOrEqual(3)
    expect(opens.length).toBeLessThanOrEqual(13)
    expect(Math.min(...gaps(opens))).toBeGreaterThanOrEqual(5000)
    await until(w, async () => (await chatIds(w)).length === sent.length, { step: 1000, max: 100 })
    expect(await chatIds(w)).toEqual(sent)
    await youtubeOf(w).collectors.stop()
  })

  it('(다) 스트림 열기가 계속 5xx(세 번 뒤 폴링도 5xx) → 시도 간격 5·10·20·30·30초, 받으면 5초로 되돌린다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.fake.fail('liveChatMessages.streamList', { status: 503 }, 3)
    w.fake.fail('liveChatMessages.list', { status: 503 }, 3)
    w.fake.addMessage(liveChatId, { id: 'ok1', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    youtubeOf(w).collectors.start()
    await until(w, async () => (await chatIds(w)).length === 1, { step: 250, max: 1000 })
    const times = w.fake.callTimes.filter((call) => CHAT_CALLS.has(call.method)).map((call) => call.at)
    const observed = gaps(times).slice(0, 6)
    const expected = [5000, 10_000, 20_000, 30_000, 30_000, 30_000]
    for (let i = 0; i < expected.length; i++) {
      // 아래 한도는 정확히, 위로는 시험 시계가 처리 중에 더 간 만큼(부하에 따라 최대 몇 초)만 넉넉히 — 5·10·20·30이 서로 구별되는 범위
      expect(observed[i], `간격 ${String(i + 1)}`).toBeGreaterThanOrEqual(expected[i] as number)
      expect(observed[i], `간격 ${String(i + 1)}`).toBeLessThan((expected[i] as number) + 4000)
    }
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', mode: 'POLL' })
    // 받은 뒤 다음 폴링은 max(pollingIntervalMillis 1초, 2초) 뒤
    const before = w.fake.calls('liveChatMessages.list')
    await advanceBy(w, 10_000, 250)
    const after = w.fake.callTimes.filter((call) => call.method === 'liveChatMessages.list').slice(before - 1)
    expect(Math.min(...gaps(after.map((call) => call.at)))).toBeGreaterThanOrEqual(2000)
    await youtubeOf(w).collectors.stop()
  }, 60_000)

  it('(라) 예정 방송: 10분 동안 채팅 호출 0, videos.list ≤ 21번(상태 STARTING·NOT_STARTED) → 시작하면 30초 안에 수집, 실제 시작 전 채팅은 기록 0(건너뜀에 셈). (마) 기다리는 중 서버를 다시 시작해도 채팅 호출 0', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const b = await createBroadcast(w, connected.seller)
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'upcoming' })
    const liveChatId = live.liveChatId as string
    const api = client(w, connected.seller.cookie)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'up-1', video: live.videoId })).status).toBe(200)
    const t0 = w.timer.now()
    youtubeOf(w).collectors.start()
    // 대기실 채팅 (이은 뒤·시작 전)
    w.fake.addMessage(liveChatId, { id: 'wait1', author: 'UCa', name: '가', text: '15', publishedAt: t0 + 60_000 })
    await advanceBy(w, 5 * 60 * 1000, 5000)
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED', reasonMessage: '유튜브 방송이 시작되면 채팅을 받아요.' })
    // (마) 서버를 다시 시작한다 (A가 죽고 B가 이어받는다)
    await youtubeOf(w).collectors.kill()
    const revived = extra(w, 'B')
    youtubeOf(revived).collectors.start()
    await advanceBy(w, 5 * 60 * 1000, 5000)
    expect(w.timer.now() - t0).toBe(10 * 60 * 1000)
    expect(w.fake.callTimes.filter((call) => CHAT_CALLS.has(call.method))).toEqual([])
    expect(w.fake.calls('videos.list')).toBeLessThanOrEqual(21)
    const quota = (await api.get('/api/youtube/quota')).body.quota as { methods: { method: string; calls: number; units: number }[] }
    expect(quota.methods.find((method) => method.method === 'videos.list')?.units ?? 0).toBeLessThanOrEqual(21)
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED' })
    // 방송 시작 (실제 시작 시각 S). 이 뒤에 가짜 서버가 받은 상태 확인은 시작을 본다
    const S = w.timer.now()
    w.fake.startBroadcast(live.videoId, S)
    const mark = w.fake.callTimes.length
    w.fake.addMessage(liveChatId, { id: 'pre', author: 'UCb', name: '나', text: '16', publishedAt: S - 500 })
    w.fake.addMessage(liveChatId, { id: 'post1', author: 'UCc', name: '다', text: '안녕', publishedAt: S + 500 })
    await until(w, async () => (await chatIds(w)).length >= 1, { step: 250, max: 240 })
    // 시작을 확인한 바퀴에서 바로 스트림을 연다 — 시작 뒤 30초 안 (시험 시계가 처리 중에 조금 더 갈 수 있다)
    const after = w.fake.callTimes.slice(mark)
    const startCheck = after.find((call) => call.method === 'videos.list')?.at ?? Number.POSITIVE_INFINITY
    const firstOpen = after.find((call) => call.method === 'liveChatMessages.streamList')?.at ?? Number.POSITIVE_INFINITY
    expect(startCheck - S).toBeLessThanOrEqual(30_000 + 2000)
    expect(firstOpen - startCheck).toBeLessThan(5000)
    w.fake.addMessage(liveChatId, { id: 'post2', author: 'UCd', name: '라', text: '반가워요', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length >= 2, { step: 1000, max: 60 })
    expect(await chatIds(w)).toEqual(['post1', 'post2'])
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', skippedBeforeLink: 2 })
    await youtubeOf(revived).collectors.stop()
  }, 60_000)

  it('예정이던 방송이 이미 끝났으면 CHAT_ENDED, 영상이 없으면 "채팅을 찾을 수 없어요."', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const b = await createBroadcast(w, connected.seller)
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'upcoming' })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'up-2', video: live.videoId })).status).toBe(200)
    youtubeOf(w).collectors.start()
    w.fake.endChat(live.liveChatId as string)
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'CHAT_ENDED', { step: 5000, max: 40 })
    expect(w.fake.callTimes.filter((call) => CHAT_CALLS.has(call.method))).toEqual([])
    await youtubeOf(w).collectors.stop()
    // 영상이 없다 (videos.list 빈 목록)
    const b2 = await createBroadcast(w, connected.seller)
    const gone = w.fake.addBroadcast(connected.channel.id, { status: 'upcoming' })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'up-3', video: gone.videoId })).status).toBe(200)
    w.fake.fail('videos.list', { status: 404, reason: 'videoNotFound' })
    youtubeOf(w).collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b2.id)).status === 'STOPPED', { step: 5000, max: 40 })
    expect(await collector(w, connected.seller.cookie, b2.id)).toMatchObject({ status: 'STOPPED', reason: 'CHAT_NOT_FOUND', statusMessage: '채팅을 찾을 수 없어요.' })
    await youtubeOf(w).collectors.stop()
  }, 60_000)
})

// ── AC-Y1-95 ─────────────────────────────────────────────────────────────

describe('AC-Y1-95 이미 켠 동의는 시각을 바꾸지 않는다 (RA-Y1-007)', () => {
  it('T0 켬 → T1 확정 → 다시 연결 필요 → 동의 켜기를 다시 눌러 승인을 거쳐 T2에 돌아옴 → 동의 시각 = T0, 기다리던 감사는 게시 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const api = client(w, connected.seller.cookie)
    const consentAt = async () => ((await api.get('/api/youtube/connection')).body.connection as { consent: { liveChat: { at: string | null } } }).consent.liveChat.at
    const T0 = await consentAt()
    expect(T0).toBe(new Date(w.timer.now()).toISOString())
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await w.timer.advance(60_000)
    // 사용자가 구글에서 권한을 거둠 → 게시 401 → 새로 고침 invalid_grant → 다시 연결 필요
    w.fake.revokeAll()
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'RECONNECT' })
    expect(((await api.get('/api/youtube/connection')).body.connection as { status: string }).status).toBe('RECONNECT_NEEDED')
    // 판매자가 동의 켜기를 다시 누른다 → 승인 주소 → T2에 돌아옴
    const again = await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })
    expect(typeof again.body.authorizeUrl).toBe('string')
    await w.timer.advance(60_000)
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    expect(await callback(w, connected.seller.cookie, await approve(again.body.authorizeUrl as string))).toBe('connected')
    expect(await consentAt()).toBe(T0)
    // 연결됨에서 바로 다시 켜도 그대로
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })).status).toBe(200)
    expect(await consentAt()).toBe(T0)
    await w.timer.advance(5000)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 가님 구매 감사합니다'])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
  })

  it('대조: T0 켬 → T1 확정(기다림) → 끔 → 켬 → 그 행은 NO_CONSENT, 게시 0번 (새 시각)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const api = client(w, connected.seller.cookie)
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 60 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await w.timer.advance(1000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: false })).status).toBe(200)
    await w.timer.advance(1000)
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })).status).toBe(200)
    const at = ((await api.get('/api/youtube/connection')).body.connection as { consent: { liveChat: { at: string } } }).consent.liveChat.at
    expect(at).toBe(new Date(w.timer.now()).toISOString())
    await w.timer.advance(120_000)
    await run(w)
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
  })
})

// ── AC-Y1-96 ─────────────────────────────────────────────────────────────

async function oneSale(w: YoutubeWorld, target: 'LIVE_CHAT' | 'VIDEO_COMMENT' = 'LIVE_CHAT') {
  const connected = await connectSeller(w, { publish: target })
  const settings = target === 'LIVE_CHAT' ? { ...NO_LABEL, 'thanks.batchWindowSec': 0 } : { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE' }
  const linked = await linkedBroadcast(w, connected, { settings })
  await product(w, connected, linked.b.id, 15, '핑크프릴', 10000)
  await chat(w, connected, linked.b.id, 'c1', 'UCa', '가', '15')
  return { connected, ...linked }
}
const TEXT = '15번 핑크프릴 10,000원 가님 구매 감사합니다'

describe('AC-Y1-96 확인하지 못하면 다시 게시하지 않는다 (RA-Y1-008)', () => {
  // D-YT-SRV-17: 실시간 채팅은 공식 조회를 부르지 않는다 — 수집기가 본 우리 글로만 확인
  it('(가) 게시는 받고 응답 없음 + 수집기가 확인 시간 안에 우리 글을 봄 → SENT, 게시 1번, 공식 조회 0', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    await runSeeing(w, connected, liveChatId, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(1)
  })

  for (const [label, fault] of [
    ['5xx', { status: 503 }],
    ['quotaExceeded', { status: 403, reason: 'quotaExceeded' }],
  ] as const) {
    it(`(나) 게시는 받고 응답 없음 + 모든 조회 실패(${label}) → FAILED(UNCONFIRMED), 그 글 1개(다시 게시 없음), 게시 보고 0`, async () => {
      const w = await world()
      const { connected, b, liveChatId } = await oneSale(w)
      w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
      w.fake.fail('liveChatMessages.list', fault, 20)
      await run(w)
      await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
      expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED', reasonMessage: UNCONFIRMED })
      expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
      expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(0)
      // 자동으로 다시 보내지 않는다
      for (let i = 0; i < 5; i++) {
        await w.timer.advance(60_000)
        await run(w)
      }
      expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    })
  }

  it('(다) 게시를 받지 않고 응답 없음 + 모든 조회 실패 → UNCONFIRMED, 게시 0번 → 수동 재전송 → 게시 1번', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    w.fake.fail('liveChatMessages.list', { status: 500 }, 20)
    await run(w)
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
    const [row] = await rows(w, connected, b.date)
    expect(row).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(0)
    w.fake.clearFaults()
    const resent = await client(w, connected.seller.cookie).post(`/api/outbox/${String(row?.id)}/resend`, { requestId: 'uc-1' })
    expect(resent.status, JSON.stringify(resent.body)).toBe(200)
    await run(w)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
  })

  it('(라) 수집기가 우리 글을 늦게 봄(확인 시간이 끝나기 전) → SENT, 그 글 1개 / 확인 시간이 끝난 뒤에 보면 이미 UNCONFIRMED', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING', reason: 'CONFIRM' })
    // 확인 시간(타임아웃 뒤 30초) 안 20초 동안 수집기가 못 봄
    for (let i = 0; i < 10; i++) {
      await w.timer.advance(2000)
      await run(w)
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    await runSeeing(w, connected, liveChatId, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
  })

  it('(마) 영상 댓글로 (나) → UNCONFIRMED, 댓글 1개', async () => {
    const w = await world()
    const { connected, b } = await oneSale(w, 'VIDEO_COMMENT')
    w.fake.fail('commentThreads.insert', { kind: 'acceptHang' })
    w.fake.fail('commentThreads.list', { status: 503 }, 20)
    await run(w)
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ target: 'VIDEO_COMMENT', state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.comments.filter((comment) => comment.text === TEXT)).toHaveLength(1)
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(w.fake.calls('commentThreads.insert')).toBe(1)
  })

  it('(바) (나)에서 확인 중에 서버를 죽였다 살림 → 다른 서버가 이어서 확인 — 그 글 1개, UNCONFIRMED, 공식 조회 0', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    for (let i = 0; i < 10; i++) {
      await w.timer.advance(1000)
      await run(w)
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    await runner(w).kill()
    const revived = youtubeOf(extra(w, 'B')).outbox
    for (let i = 0; i < 120 && (await rows(w, connected, b.date))[0]?.state !== 'FAILED'; i++) {
      await w.timer.advance(1000)
      await drive(w, revived.runOnce())
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
  })
})

// ── AC-Y1-97 ─────────────────────────────────────────────────────────────

describe('AC-Y1-97 할당량 모드는 바뀔 때마다 알린다 (SA-Y1-006)', () => {
  it('(가) S1 NORMAL → S2의 호출로 프로젝트 남은 양이 S1 예산의 20% 아래 → S1이 호출하지 않아도 10초 안에 BATCH, 알림에 숫자 없음', async () => {
    const v = await world()
    const w = extra(v, 'Q', { youtube: { ...v.config, quota: { limit: 1000, sellerBudget: 1000 } } })
    const s1 = await connectSeller(w)
    const s2 = await connectSeller(w)
    const meter = youtubeOf(w).quota
    await youtubeOf(w).outbox.runOnce()
    expect(await meter.mode(s1.seller.sellerId)).toBe('NORMAL')
    const stream = sse(w, s1.seller.cookie)
    await realPause(20)
    for (let i = 0; i < 40; i++) await meter.count(s2.seller.sellerId, 'liveChatMessages.insert')
    expect(await meter.mode(s1.seller.sellerId)).toBe('BATCH')
    const changedAt = w.timer.now()
    for (let i = 0; i < 10 && !stream.text().includes('"mode":"BATCH"'); i++) {
      await w.timer.advance(1000)
      await youtubeOf(w).outbox.runOnce()
      await realPause(10)
    }
    await stream.close()
    expect(stream.text()).toContain('"kind":"quota","mode":"BATCH"')
    expect(w.timer.now() - changedAt).toBeLessThanOrEqual(10_000)
    const quotaEvents = stream.text().split('\n').filter((line) => line.includes('"kind":"quota"'))
    for (const line of quotaEvents) expect(line).not.toMatch(/\d{2,}/)
  })

  it('(나) 오늘 S1 사용이 예산의 85%인 채 서버를 다시 시작 → 10초 안에 S1에게 BATCH', async () => {
    const v = await world()
    const quota = { limit: 100_000, sellerBudget: 1000 }
    const w = extra(v, 'Q', { youtube: { ...v.config, quota } })
    const s1 = await connectSeller(w)
    for (let i = 0; i < 849; i++) await youtubeOf(w).quota.count(s1.seller.sellerId, 'channels.list')
    expect(await youtubeOf(w).quota.mode(s1.seller.sellerId)).toBe('BATCH')
    const restarted = extra(v, 'R', { youtube: { ...v.config, quota } })
    const stream = sse(restarted, s1.seller.cookie)
    await realPause(20)
    const startedAt = v.timer.now()
    for (let i = 0; i < 10 && !stream.text().includes('"mode":"BATCH"'); i++) {
      await youtubeOf(restarted).outbox.runOnce()
      await realPause(10)
      await v.timer.advance(1000)
    }
    await stream.close()
    expect(stream.text()).toContain('"kind":"quota","mode":"BATCH"')
    expect(v.timer.now() - startedAt).toBeLessThanOrEqual(10_000)
  })

  it('(다) 오늘 quotaExceeded로 PAUSED인 채 태평양 자정이 지남 → 호출 없이도 10초 안에 NORMAL', async () => {
    const w = await world({ start: Date.parse('2026-10-20T06:59:30Z') })
    const connected = await connectSeller(w)
    await youtubeOf(w).quota.markExceeded(connected.seller.sellerId)
    // 다시 시작한 서버: 그 판매자의 호출이 없다 — 자정 전 판정(PAUSED)도 자정 뒤 판정(NORMAL)도 바퀴가 알린다
    const restarted = extra(w, 'R')
    const stream = sse(restarted, connected.seller.cookie)
    await realPause(20)
    for (let i = 0; i < 10 && !stream.text().includes('"mode":"PAUSED"'); i++) {
      await youtubeOf(restarted).outbox.runOnce()
      await realPause(10)
      await w.timer.advance(1000)
    }
    expect(stream.text()).toContain('"kind":"quota","mode":"PAUSED"')
    await w.timer.set(Date.parse('2026-10-20T07:00:00Z'))
    for (let i = 0; i < 10 && !stream.text().includes('"mode":"NORMAL"'); i++) {
      await youtubeOf(restarted).outbox.runOnce()
      await realPause(10)
      await w.timer.advance(1000)
    }
    await stream.close()
    expect(stream.text()).toContain('"kind":"quota","mode":"NORMAL"')
    expect(w.timer.now() - Date.parse('2026-10-20T07:00:00Z')).toBeLessThanOrEqual(10_000)
  })
})

// ── AC-Y1-98 ─────────────────────────────────────────────────────────────

describe('AC-Y1-98 한 영상은 한 회차에만 — 동시에도 (RA-Y1-006)', () => {
  it('같은 영상을 두 회차에 동시에 잇는 요청 둘(서버 둘) × 20번 → 매번 하나만 이어지고 다른 하나는 409 VIDEO_IN_USE. 끝난 회차의 영상은 새 회차에 다시 이을 수 있다', async () => {
    // 확인을 마친 뒤 넣기 직전에 잠깐 쉰다(실제 20ms) — 두 서버의 확인·넣기가 겹치게
    const linkHooks = { beforeInsert: async () => void (await realPause(20)) }
    const w = await world({ overrides: { linkHooks } })
    const connected = await connectSeller(w)
    const other = extra(w, 'B', { linkHooks })
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    const apiA = client(w, connected.seller.cookie)
    const apiB = client(other, connected.seller.cookie)
    const openLinks = async () =>
      Number(
        (
          await w.database.pglite?.query<{ n: number }>(
            `select count(*)::int as n from youtube_links l join broadcasts b on b.id = l.broadcast_id where l.video_id = $1 and l.unlinked_at is null and b.ended_at is null`,
            [live.videoId],
          )
        )?.rows[0]?.n ?? 0,
      )
    for (let round = 0; round < 20; round++) {
      const b1 = await createBroadcast(w, connected.seller)
      const b2 = await createBroadcast(w, connected.seller)
      // 두 요청의 영상 확인 응답이 함께 돌아오게 한다 (확인과 넣기 사이가 겹치게)
      w.fake.hold('videos.list', 2)
      const [r1, r2] = await Promise.all([
        apiA.post(`/api/broadcasts/${b1.id}/youtube`, { requestId: `race-${String(round)}-1`, video: live.videoId }),
        apiB.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: `race-${String(round)}-2`, video: live.videoId }),
      ])
      const statuses = [r1.status, r2.status].sort()
      expect(statuses, `round ${String(round)}`).toEqual([200, 409])
      const loser = r1.status === 409 ? r1 : r2
      expect(loser.body).toEqual({ error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } })
      expect(await openLinks()).toBe(1)
      // 다음 판을 위해 이긴 쪽을 끝낸다 (끝난 회차의 영상은 다시 이을 수 있다)
      const winner = r1.status === 200 ? b1 : b2
      expect((await apiA.post(`/api/broadcasts/${winner.id}/end`, { requestId: `race-end-${String(round)}` })).status).toBe(200)
      expect(await openLinks()).toBe(0)
    }
    const b3 = await createBroadcast(w, connected.seller)
    expect((await apiA.post(`/api/broadcasts/${b3.id}/youtube`, { requestId: 'race-final', video: live.videoId })).status).toBe(200)
  }, 60_000)
})
