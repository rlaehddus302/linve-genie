// AC-I3-85~88 Y1 남은 minor — 발송함 (YT-06, R-13 "응답 유실 대비", D-Y1-02·03·06, D-I3-17).
// (85) 게시·조회 토큰은 그 방송을 이은 채널의 연결에서만 — 꺼내는 순간 채널이 다르면 보내지 않는다(주입점에서 채널을 바꿔도 다른 채널 이름의 글 0).
// (86) 조회는 다음 쪽을 따라 그 시도 뒤의 글을 모두 본다(5쪽까지 — 다 못 보면 실패한 조회, 실시간 채팅은 지점 없는 첫 쪽이 그 시도 전까지 거슬러 가야 — RA-I3-001). (87) 이른 조회 1 + 끝 조회 3·간격 10초 이상(미룸도 셈).
// (88) 기다리는 중(다시 시도·묶음 창·할당량·다시 연결)에 채널이 바뀐 행.
import { afterEach, describe, expect, it } from 'vitest'
import { insertOwnMessage } from '../src/youtube/store.ts'
import { client, expectOk, writeEvent } from './support.ts'
import { approve, callback, connectSeller, drive, enableConsent, linkedBroadcast, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const NO_LABEL = { 'print.autoOnConfirm': false }
const TEXT = '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'

interface Row {
  id: number
  target: string
  state: string
  reason: string | null
}

function youtubeOf(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube
}
const run = (w: YoutubeWorld) => drive(w, youtubeOf(w).outbox.runOnce())

async function runUntil(w: YoutubeWorld, predicate: () => Promise<boolean>, step = 2000, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await predicate()) return
    await w.timer.advance(step)
    await run(w)
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function sale(w: YoutubeWorld, connected: Connected, b: string, id: string, nick = '홍길동') {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch: `UC${id}`, nick, text: '15', publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

/** 연결을 끊고 다른(또는 같은) 채널로 다시 잇고 게시 동의까지 */
async function reconnectTo(w: YoutubeWorld, connected: Connected, approval: { account: string; channel: string }, consent: readonly ('LIVE_CHAT' | 'VIDEO_COMMENT')[] = ['LIVE_CHAT']): Promise<void> {
  const api = client(w, connected.seller.cookie)
  expect((await api.post('/api/youtube/connection/disconnect', {})).status).toBe(200)
  w.fake.approval = approval
  const started = await api.post('/api/youtube/connection/start', {})
  expect(await callback(w, connected.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  for (const target of consent) await enableConsent(w, connected.seller, target)
}

/** 주입점이 한 번 부를 일 */
function oneShot() {
  let task: (() => Promise<void>) | null = null
  return {
    set: (next: () => Promise<void>) => {
      task = next
    },
    run: async () => {
      const current = task
      task = null
      await current?.()
    },
  }
}

async function oneSale(w: YoutubeWorld, options: { target?: 'LIVE_CHAT' | 'VIDEO_COMMENT'; settings?: Record<string, unknown> } = {}) {
  const target = options.target ?? 'LIVE_CHAT'
  const connected = await connectSeller(w, { publish: target })
  const settings = target === 'LIVE_CHAT' ? { ...NO_LABEL, 'thanks.batchWindowSec': 0, ...options.settings } : { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE', ...options.settings }
  const linked = await linkedBroadcast(w, connected, { settings })
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: linked.b.id, no: 15, name: '핑크프릴', price: 10000, stock: 5 }))
  return { connected, ...linked }
}

describe('AC-I3-85 게시·조회 토큰은 그 방송을 이은 채널의 것', () => {
  it('직전 확인과 게시 사이(주입점)에서 연결을 끊고 채널 C(게시 권한·동의 있음)를 이으면 그 시도의 게시 0번 — 어느 채팅·영상에도 C 이름의 글 0, 행 NOT_MY_CHANNEL', async () => {
    const hook = oneShot()
    const w = await world({ overrides: { outboxHooks: { beforePost: () => hook.run() } } })
    const { connected, b } = await oneSale(w)
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '다른 채널')
    hook.set(() => reconnectTo(w, connected, { account: accountC, channel: channelC.id }, ['LIVE_CHAT', 'VIDEO_COMMENT']))
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect(w.fake.posted).toEqual([])
    expect(w.fake.comments).toEqual([])
    expect(w.fake.calls('liveChatMessages.insert')).toBe(0)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(30_000)
      await run(w)
    }
    expect(w.fake.posted).toEqual([])
  })

  it('첫 게시가 401 → 새로 고치기 사이에 채널이 C로 바뀌면 다시 보내지 않는다(게시 0번)', async () => {
    const hook = oneShot()
    const w = await world({ overrides: { outboxHooks: { beforeRetryToken: () => hook.run() } } })
    const { connected, b } = await oneSale(w)
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '다른 채널')
    hook.set(() => reconnectTo(w, connected, { account: accountC, channel: channelC.id }))
    w.fake.fail('liveChatMessages.insert', { status: 401 })
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
  })

  it('영상 댓글도 같다 — 주입점에서 C로 바꾸면 댓글 0', async () => {
    const hook = oneShot()
    const w = await world({ overrides: { outboxHooks: { beforePost: () => hook.run() } } })
    const { connected, b } = await oneSale(w, { target: 'VIDEO_COMMENT' })
    const accountC = w.fake.addAccount()
    const channelC = w.fake.addChannel(accountC, '다른 채널')
    hook.set(() => reconnectTo(w, connected, { account: accountC, channel: channelC.id }, ['VIDEO_COMMENT']))
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect(w.fake.comments).toEqual([])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ target: 'VIDEO_COMMENT', state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
  })

  it('같은 채널로 다시 연결한 경우는 평소대로 게시 1번 (회귀)', async () => {
    const hook = oneShot()
    const w = await world({ overrides: { outboxHooks: { beforePost: () => hook.run() } } })
    const { connected, b, liveChatId } = await oneSale(w)
    hook.set(() => reconnectTo(w, connected, { account: connected.account, channel: connected.channel.id }))
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect(w.fake.posted.map((post) => [post.liveChatId, post.authorChannelId, post.text])).toEqual([[liveChatId, connected.channel.id, TEXT]])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
  })
})

describe('AC-I3-86 조회는 그 시도 뒤의 글을 모두 본다', () => {
  it('(가) 우리 글 앞에 시청자 채팅이 많아 첫 쪽에 없음 → 다음 쪽에서 찾아 SENT, 그 글 1개(다시 게시 없음)', async () => {
    const w = await world({ overrides: { outboxTiming: { liveChatLookupPage: 100 } } })
    const { connected, b, liveChatId } = await oneSale(w)
    for (let i = 0; i < 150; i++) w.fake.addMessage(liveChatId, { author: `UCv${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}` })
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await sale(w, connected, b.id, 'c1')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    // 첫 쪽(꽉 참) → 다음 쪽(덜 참 — 끝까지 봄)
    expect(w.fake.calls('liveChatMessages.list')).toBe(2)
  })

  it('(나) 5쪽을 넘게 꽉 찬 채팅에서 우리 글을 못 찾음 → 실패한 조회 → 끝 조회 3번 → UNCONFIRMED, 다시 게시 0, 쪽마다 할당량', async () => {
    const w = await world({ overrides: { outboxTiming: { liveChatLookupPage: 100 } } })
    const { connected, b, liveChatId } = await oneSale(w)
    for (let i = 0; i < 600; i++) w.fake.addMessage(liveChatId, { author: `UCv${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}` })
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await sale(w, connected, b.id, 'c1')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    // 이른 조회 1 + 끝 조회 3, 조회마다 5쪽
    expect(w.fake.calls('liveChatMessages.list')).toBe(20)
    const quota = (await client(w, connected.seller.cookie).get('/api/youtube/quota')).body.quota as { methods: { method: string; calls: number; units: number }[] }
    expect(quota.methods.find((item) => item.method === 'liveChatMessages.list')).toEqual({ method: 'liveChatMessages.list', calls: 20, units: 100 })
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
  })

  it('(다) 영상 댓글 — 우리 댓글 뒤로 댓글 60개(최신순 첫 쪽 50개) → 다음 쪽에서 찾아 SENT, 댓글 1개', async () => {
    const w = await world()
    const { connected, b, live } = await oneSale(w, { target: 'VIDEO_COMMENT' })
    w.fake.fail('commentThreads.insert', { kind: 'acceptHang' })
    // 이른 조회는 실패 — 끝 조회 전에 다른 시청자의 댓글 60개가 우리 댓글 뒤로 쌓인다
    w.fake.fail('commentThreads.list', { status: 503 })
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect(w.fake.comments).toHaveLength(1)
    expect((await rows(w, connected, b.date))[0]?.state).toBe('SENDING')
    for (let i = 0; i < 60; i++) {
      ;(w.fake.comments as { id: string; videoId: string; authorChannelId: string; text: string; publishedAt: string }[]).push({
        id: `cmt_other_${String(i)}`,
        videoId: live.videoId,
        authorChannelId: `UCo${String(i)}`,
        text: `좋아요 ${String(i)}`,
        publishedAt: new Date(w.timer.now() + 1000 + i).toISOString(),
      })
    }
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.comments.filter((comment) => comment.text === TEXT)).toHaveLength(1)
    expect(w.fake.calls('commentThreads.insert')).toBe(1)
    // 이른 조회 1(실패) + 끝 조회 1(첫 쪽 50개 → 다음 쪽)
    expect(w.fake.calls('commentThreads.list')).toBe(3)
  })

  it('(라) 수집기 표에만 있는 글(조회 응답엔 없음) → SENT, 다시 게시 없음', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.postsHiddenForMs = 10 * 60 * 1000
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await sale(w, connected, b.id, 'c1')
    await run(w)
    expect((await rows(w, connected, b.date))[0]?.state).toBe('SENDING')
    const posted = w.fake.messages(liveChatId).find((message) => message.text === TEXT)
    expect(posted).toBeDefined()
    const scope = await w.database.pglite?.query<{ id: string }>(`select id from scopes where seller_id = $1 and date = $2 and rehearsal = false`, [connected.seller.sellerId, b.date])
    await insertOwnMessage(w.database.db, { sellerId: connected.seller.sellerId, scopeId: scope?.rows[0]?.id ?? '', liveChatId, messageId: posted?.id ?? '', text: TEXT, publishedAt: new Date(w.timer.now()) })
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
  })
})

describe('RA-I3-001 실시간 채팅 조회 — 지점 없는 첫 쪽은 최근 메시지뿐(실제 API)', () => {
  it('우리 글이 올라간 뒤 시청자 채팅 200개가 몰려 첫 쪽(최근 50개)에 우리 글이 없고 그 쪽이 그 시도 전까지 거슬러 가지 못함 → "못 찾음"이 아니라 실패한 조회 → 끝 조회 3번 → UNCONFIRMED, 다시 게시 0', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.backlogSize = 50
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await sale(w, connected, b.id, 'c1')
    // 게시는 받아져 채팅에 올라갔다(응답 없음 — 10초 타임아웃). 그 사이 시청자 채팅 200개가 몰린다. 수집기는 돌지 않는다
    const running = youtubeOf(w).outbox.runOnce()
    await until(w, () => w.fake.calls('liveChatMessages.insert') >= 1)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
    for (let i = 0; i < 200; i++) w.fake.addMessage(liveChatId, { author: `UCv${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}` })
    await drive(w, running)
    expect((await rows(w, connected, b.date))[0]?.state).toBe('SENDING')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED')
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
  })

  it('첫 쪽이 그 시도 전 채팅까지 거슬러 가면 모두 본 조회 — 받지 않은 글은 실패 한 번 → 다시 시도로 1번 게시 (회귀)', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.backlogSize = 50
    for (let i = 0; i < 100; i++) w.fake.addMessage(liveChatId, { author: `UCv${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}`, publishedAt: w.timer.now() - 60_000 + i })
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await sale(w, connected, b.id, 'c1')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
  })

  it('채팅에 메시지가 하나도 없을 때(첫 쪽이 빔) 받지 않은 글은 모두 본 조회로 실패 한 번 → 다시 시도 (회귀)', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await oneSale(w)
    w.fake.backlogSize = 50
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await sale(w, connected, b.id, 'c1')
    await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'SENT')
    expect(w.fake.calls('liveChatMessages.insert')).toBe(2)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === TEXT)).toHaveLength(1)
  })
})

describe('AC-I3-87 조회 간격·횟수', () => {
  /**
   * 이름이 같은 두 시청자의 감사(글이 같다) — 둘째 묶음은 다른 서버가 같은 글을 지금 게시하는 중(이유 없음·임대 3분)인 것처럼 실행기가 보기 전에 적는다.
   * 첫째 묶음은 게시가 받아지고 응답이 없어(acceptHang) 확인을 하는데, 짝짓기는 둘째의 응답을 기다리며 미뤄진다
   */
  async function deferredPair(w: YoutubeWorld, target: 'LIVE_CHAT' | 'VIDEO_COMMENT') {
    const { connected, b } = await oneSale(w, { target })
    w.fake.fail(target === 'LIVE_CHAT' ? 'liveChatMessages.insert' : 'commentThreads.insert', { kind: 'acceptHang' })
    await sale(w, connected, b.id, 'c1')
    await sale(w, connected, b.id, 'c2')
    const pg = w.database.pglite
    const ids = ((await pg?.query<{ id: number }>(`select id from outbox where kind = 'POST_THANKS' order by id`))?.rows ?? []).map((row) => row.id)
    expect(ids).toHaveLength(2)
    await pg?.query(
      `update outbox set state = 'SENDING', reason = null, target = $6, broadcast_id = $5, sent_text = $1, post_text = $1, attempt_at = $2, lease_owner = 'other-server', lease_until = $3, group_id = 'g-other' where id = $4`,
      [TEXT, new Date(w.timer.now()).toISOString(), new Date(w.timer.now() + 3 * 60 * 1000).toISOString(), ids[1], b.id, target],
    )
    return { connected, b, ids }
  }

  /** 2분 동안 1초씩 실행기를 돌린다 */
  async function twoMinutes(w: YoutubeWorld) {
    const start = w.timer.now()
    for (let i = 0; i < 130 && w.timer.now() - start < 2 * 60 * 1000; i++) {
      await w.timer.advance(1000)
      await run(w)
    }
  }

  const spacing = (times: readonly number[]) => times.slice(1).map((at, i) => at - (times[i] as number))

  it('실시간 채팅: 같은 글을 게시하는 중인 다른 묶음 때문에 짝짓기가 미뤄져도 2분 동안 그 묶음 때문에 나간 liveChatMessages.list ≤ 4번(≤ 20단위), 간격 ≥ 10초, 다시 게시 없음', async () => {
    const w = await world()
    const { connected } = await deferredPair(w, 'LIVE_CHAT')
    await twoMinutes(w)
    const times = w.fake.callTimes.filter((call) => call.method === 'liveChatMessages.list').map((call) => call.at)
    expect(times.length).toBeLessThanOrEqual(4)
    for (const gap of spacing(times)) expect(gap).toBeGreaterThanOrEqual(10_000)
    const quota = (await client(w, connected.seller.cookie).get('/api/youtube/quota')).body.quota as { methods: { method: string; units: number }[] }
    expect(quota.methods.find((item) => item.method === 'liveChatMessages.list')?.units ?? 0).toBeLessThanOrEqual(20)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
  })

  it('영상 댓글: 미뤄진 조회도 한 번으로 센다 — 이른 조회 1 + 끝 조회 3(간격 ≥ 10초) 안에 정하지 못하면 UNCONFIRMED, 다시 게시·게시 보고 없음', async () => {
    const w = await world()
    const { connected, b, ids } = await deferredPair(w, 'VIDEO_COMMENT')
    await twoMinutes(w)
    const times = w.fake.callTimes.filter((call) => call.method === 'commentThreads.list').map((call) => call.at)
    expect(times).toHaveLength(4)
    for (const gap of spacing(times)) expect(gap).toBeGreaterThanOrEqual(10_000)
    const first = (await rows(w, connected, b.date)).find((row) => row.id === ids[0])
    expect(first).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.calls('commentThreads.insert')).toBe(1)
    const reports = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'effect.thanksSent'`)
    expect(reports?.rows[0]?.n).toBe(0)
  })

  /**
   * SA-I3-009: 확인 조회가 유튜브에 닿기 전(임대 늘리기·수집기 확인·할당량·토큰 DB 읽기·요청이 도는 사이)에 시계가 앞으로 가는 경우.
   * 정한 번째 조회(1부터)의 요청만 유튜브에 닿기 전에 시계를 옮긴다 — 그 조회는 늦게, 다음 조회는 늦지 않게 닿아 간격이 줄어드는 경우를 그대로 만든다.
   * 시계는 이 지연과 시험의 1초 걸음으로만 간다(drive 없이 — 같은 결과가 매번 나온다)
   */
  function lagBeforeLookup(lags: Readonly<Record<number, number>>) {
    let target: YoutubeWorld | null = null
    let seen = 0
    const applied: number[] = []
    const youtubeFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const lookup = (init?.method ?? 'GET') === 'GET' && (url.pathname.endsWith('/liveChat/messages') || url.pathname.endsWith('/commentThreads'))
      if (lookup && target !== null) {
        seen += 1
        const lag = lags[seen]
        if (lag !== undefined) {
          await target.timer.advance(lag)
          applied.push(seen)
        }
      }
      return fetch(input, init)
    }
    return {
      youtubeFetch,
      attach: (w: YoutubeWorld) => {
        target = w
      },
      applied,
    }
  }

  /** 2분 동안 1초씩 실행기를 돌린다 (drive 없이 — 한 바퀴 안에서는 넣은 지연 말고는 시계가 가지 않는다) */
  async function twoMinutesStepwise(w: YoutubeWorld) {
    const start = w.timer.now()
    while (w.timer.now() - start < 2 * 60 * 1000) {
      await w.timer.advance(1000)
      await youtubeOf(w).outbox.runOnce()
    }
  }

  const listOf = (target: 'LIVE_CHAT' | 'VIDEO_COMMENT') => (target === 'LIVE_CHAT' ? 'liveChatMessages.list' : 'commentThreads.list')
  const insertOf = (target: 'LIVE_CHAT' | 'VIDEO_COMMENT') => (target === 'LIVE_CHAT' ? 'liveChatMessages.insert' : 'commentThreads.insert')

  /** 게시 연결이 끊겨(올라갔는지 모름) 바로 확인으로 가고, 조회는 모두 503 — 이른 조회 1 + 끝 조회 3이 모두 실패한다. 첫 바퀴도 시계를 옮기지 않는다 */
  async function unknownPost(w: YoutubeWorld, target: 'LIVE_CHAT' | 'VIDEO_COMMENT') {
    const { connected, b } = await oneSale(w, { target })
    w.fake.fail(insertOf(target), { kind: 'reset' })
    w.fake.fail(listOf(target), { status: 503 }, 10)
    await sale(w, connected, b.id, 'c1')
    await youtubeOf(w).outbox.runOnce()
    expect(w.fake.calls(insertOf(target))).toBe(1)
    return { connected, b }
  }

  const lagCases = [
    { name: '끝 조회', lags: { 2: 4000 }, timing: {} },
    { name: '이른 조회(확인 시간 5초)', lags: { 1: 4000 }, timing: { confirmWindowMs: 5000 } },
  ] as const
  for (const target of ['LIVE_CHAT', 'VIDEO_COMMENT'] as const) {
    for (const item of lagCases) {
      it(`${target}: ${item.name}가 유튜브에 닿기 전에 시계가 4초 가도 그 조회와 다음 조회 사이는 유튜브가 받은 시각으로 10초 이상 — 실패한 조회 4번(이른 1 + 끝 3) 뒤 UNCONFIRMED, 다시 게시 없음 (SA-I3-009)`, async () => {
        const lag = lagBeforeLookup(item.lags)
        const w = await world({ overrides: { youtubeFetch: lag.youtubeFetch, outboxTiming: item.timing } })
        lag.attach(w)
        const { connected, b } = await unknownPost(w, target)
        await twoMinutesStepwise(w)
        expect(lag.applied).toEqual(Object.keys(item.lags).map(Number))
        const times = w.fake.callTimes.filter((call) => call.method === listOf(target)).map((call) => call.at)
        expect(times).toHaveLength(4)
        for (const gap of spacing(times)) expect(gap).toBeGreaterThanOrEqual(10_000)
        expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
        expect(w.fake.calls(insertOf(target))).toBe(1)
      })
    }
  }

  it('영상 댓글: 짝짓기가 미뤄진 끝 조회가 유튜브에 닿기 전에 시계가 4초 가도 다음 끝 조회는 유튜브가 받은 시각으로 10초 뒤 — 이른 1 + 끝 3 뒤 UNCONFIRMED (SA-I3-009)', async () => {
    const lag = lagBeforeLookup({ 2: 4000 })
    const w = await world({ overrides: { youtubeFetch: lag.youtubeFetch } })
    lag.attach(w)
    const { connected, b, ids } = await deferredPair(w, 'VIDEO_COMMENT')
    // 첫 게시는 받아들여지고 응답이 없다 — 그 시도의 시간 제한(10초)까지 시계를 옮겨 이른 조회까지 한 바퀴를 끝낸다
    const pass = youtubeOf(w).outbox.runOnce()
    await until(w, () => w.fake.calls('commentThreads.insert') === 1, { max: 4000 })
    await w.timer.advance(10_000)
    await pass
    await twoMinutesStepwise(w)
    expect(lag.applied).toEqual([2])
    const times = w.fake.callTimes.filter((call) => call.method === 'commentThreads.list').map((call) => call.at)
    expect(times).toHaveLength(4)
    for (const gap of spacing(times)) expect(gap).toBeGreaterThanOrEqual(10_000)
    expect((await rows(w, connected, b.date)).find((row) => row.id === ids[0])).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    expect(w.fake.calls('commentThreads.insert')).toBe(1)
  })
})

describe('AC-I3-88 기다리는 중에 채널이 바뀐 행', () => {
  /** 다른 서버가 연결을 다른 채널로 바꾼 것처럼 연결 행의 채널만 바꾼다 (끊기의 정리를 거치지 않은 경합 — 직전 확인이 막아야 한다) */
  async function swapChannel(w: YoutubeWorld, sellerId: string, channelId: string) {
    await w.database.pglite?.query(`update youtube_connections set channel_id = $1, status = 'CONNECTED' where seller_id = $2`, [channelId, sellerId])
  }

  const cases: { name: string; setup: (w: YoutubeWorld, connected: Connected) => Promise<void>; settings?: Record<string, unknown>; reason: string }[] = [
    {
      name: '다시 시도 대기(RETRY)',
      reason: 'RETRY',
      setup: async (w) => {
        w.fake.fail('liveChatMessages.insert', { status: 503 })
      },
    },
    { name: '묶음 창(WINDOW)', reason: 'WINDOW', settings: { 'thanks.batchWindowSec': 60 }, setup: async () => {} },
    {
      name: '할당량 기다림(QUOTA)',
      reason: 'QUOTA',
      setup: async (w, connected) => {
        await youtubeOf(w).quota.markExceeded(connected.seller.sellerId)
      },
    },
    {
      name: '다시 연결 기다림(RECONNECT)',
      reason: 'RECONNECT',
      setup: async (w, connected) => {
        await youtubeOf(w).connections.markReconnect(connected.seller.sellerId)
      },
    },
  ]

  for (const item of cases) {
    it(`${item.name}: 채널을 바꾸면 다음 차례에 게시 0번·FAILED(NOT_MY_CHANNEL)`, async () => {
      const w = await world()
      const { connected, b } = await oneSale(w, item.settings === undefined ? {} : { settings: item.settings })
      await item.setup(w, connected)
      await sale(w, connected, b.id, 'c1')
      await run(w)
      await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.reason === item.reason, 5000)
      expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: item.reason })
      const posts = w.fake.posted.length
      const accountC = w.fake.addAccount()
      const channelC = w.fake.addChannel(accountC, '다른 채널')
      await swapChannel(w, connected.seller.sellerId, channelC.id)
      w.fake.clearFaults()
      await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.state === 'FAILED', 5000)
      expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NOT_MY_CHANNEL' })
      expect(w.fake.posted.length).toBe(posts)
      expect(w.fake.posted.filter((post) => post.authorChannelId === channelC.id)).toEqual([])
    })

    it(`${item.name}: 실제로 채널을 바꾸는 길(끊기 → C 연결·동의)은 끊을 때 이미 보내지 않음(NO_CONSENT)으로 멈춘다 — 게시 0번`, async () => {
      const w = await world()
      const { connected, b } = await oneSale(w, item.settings === undefined ? {} : { settings: item.settings })
      await item.setup(w, connected)
      await sale(w, connected, b.id, 'c1')
      await run(w)
      await runUntil(w, async () => (await rows(w, connected, b.date))[0]?.reason === item.reason, 5000)
      expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: item.reason })
      const posts = w.fake.posted.length
      const accountC = w.fake.addAccount()
      const channelC = w.fake.addChannel(accountC, '다른 채널')
      w.fake.clearFaults()
      await reconnectTo(w, connected, { account: accountC, channel: channelC.id })
      for (let i = 0; i < 5; i++) {
        await w.timer.advance(30_000)
        await run(w)
      }
      expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
      expect(w.fake.posted.length).toBe(posts)
      expect(w.fake.posted.filter((post) => post.authorChannelId === channelC.id)).toEqual([])
    })
  }
})
