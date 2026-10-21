// 동시 송출 — 플랫폼 공통 연결과 여러 플랫폼 회차의 감사 (N2b-2, AC-N2b-2-01~06·10~12·70·71·73, D-N2b-2-01·02·09·10).
// 가짜 구글(유튜브)·가짜 메타(인스타그램)·가짜 웹캐스트(틱톡)를 한 서버에 함께 붙인다 — 바깥 연결 없음.
import { listClaims, listEffects, listProducts } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeMeta, type FakeAccount } from '../src/instagram/fake-meta.ts'
import { readInstagramConfig } from '../src/instagram/config.ts'
import { productionServerOptions } from '../src/production.ts'
import { createServer } from '../src/server.ts'
import { FakeTikTokClock, FakeWebcast, readTikTokSettings } from '../src/tiktok/index.ts'
import { ManualTimer } from '../src/youtube/timer.ts'
import { summaryLines } from '../src/youtube/outbox.ts'
import { connectInstagram, REDIRECT_URI, sendComments, TEST_TIMEOUTS, type IgWorld } from './instagram-support.ts'
import { ORIGIN, T0, addSeller, client, createBroadcast, openTestDb, rid, waitFor, type Seller } from './support.ts'
import { consentOn, linkTiktok, msgId } from './tiktok-live-support.ts'
import { connectSeller, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'
import { generateMasterKey } from '../src/secrets.ts'

interface All {
  readonly yt: YoutubeWorld
  readonly ig: IgWorld
  readonly meta: FakeMeta
  readonly webcast: FakeWebcast
  readonly tclock: FakeTikTokClock
  close(): Promise<void>
}

const opened: All[] = []
afterEach(async () => {
  for (const all of opened.splice(0)) await all.close()
})

async function allWorld(): Promise<All> {
  const timer = new ManualTimer(T0)
  const meta = await FakeMeta.start({ now: () => timer.now() })
  const tclock = new FakeTikTokClock(T0)
  const webcast = new FakeWebcast()
  const yt = await youtubeWorld({
    timer,
    overrides: {
      instagram: meta.settings({ redirectUri: REDIRECT_URI, login: 'FACEBOOK', timeouts: TEST_TIMEOUTS }),
      dmAutoRun: false,
      collectionIntervalMs: 25,
      tiktok: { settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }), webcast: webcast.factory, clock: tclock },
    },
  })
  const ig = { ...yt, fake: meta, clock: yt.clock, published: [], close: async () => undefined } as unknown as IgWorld
  const all: All = {
    yt,
    ig,
    meta,
    webcast,
    tclock,
    close: async () => {
      yt.server.close()
      await yt.server.tiktok.idle()
      await new Promise((resolve) => setTimeout(resolve, 30))
      await yt.fake.close()
      await meta.close()
      await yt.database.close()
    },
  }
  opened.push(all)
  return all
}

interface Shop {
  readonly connected: Connected
  readonly seller: Seller
  readonly account: FakeAccount
  readonly tiktokId: string
}

/** 판매자 하나: 유튜브(게시 동의)·인스타그램(DM 동의)·틱톡(동의·아이디) 모두 준비 */
async function shop(all: All): Promise<Shop> {
  const connected = await connectSeller(all.yt, { publish: true })
  const seller = connected.seller
  const account = all.meta.addAccount({ username: `shop.${seller.loginId}`, type: 'BUSINESS' })
  expect(await connectInstagram(all.ig, seller, { accounts: [account.id] })).toBe('CONNECTED')
  expect((await client(all.yt, seller.cookie).post('/api/instagram/consent', { on: true })).status).toBe(200)
  const tiktokId = `tt_${seller.loginId}`
  expect((await consentOn(all.yt, seller)).status).toBe(200)
  expect((await client(all.yt, seller.cookie).put('/api/tiktok/account', { tiktokId: `@${tiktokId}` })).status).toBe(200)
  all.webcast.account(tiktokId, 'LIVE')
  return { connected, seller, account, tiktokId }
}

const linkYoutube = async (all: All, s: Shop, b: string, requestId = rid('yl')) => {
  const live = all.yt.fake.addBroadcast(s.connected.channel.id, { title: '라이브', status: 'live' })
  const response = await client(all.yt, s.seller.cookie).post(`/api/broadcasts/${b}/youtube`, { requestId, video: `https://www.youtube.com/watch?v=${live.videoId}` })
  return { response, live }
}
const waitInstagram = (all: All, s: Shop, b: string) => client(all.yt, s.seller.cookie).post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('iw'), platform: 'INSTAGRAM' })
const linkInstagram = (all: All, s: Shop, b: string, liveId: string) => client(all.yt, s.seller.cookie).post(`/api/broadcasts/${b}/live/link`, { requestId: rid('il'), platform: 'INSTAGRAM', liveId })
const register = async (all: All, s: Shop, b: string, no: number, name: string, price: number) =>
  expect((await client(all.yt, s.seller.cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name, price })).status).toBe(200)

const DATE = '2026-10-19'

describe('AC-N2b-2-01 회차 하나에 플랫폼마다 연결 하나', () => {
  it('셋 다 받고, 같은 플랫폼으로 다시 잇기·기다리기는 ALREADY_LINKED(플랫폼 이름), 한 플랫폼을 끊어도 다른 플랫폼 그대로', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const api = client(all.yt, s.seller.cookie)
    const b = (await createBroadcast(all.yt, s.seller)).id
    const seqBefore = (await api.get(`/api/days/${DATE}`)).body.seq
    expect((await linkYoutube(all, s, b)).response.status).toBe(200)
    expect((await waitInstagram(all, s, b)).status).toBe(200)
    expect((await linkTiktok(all.yt, s.seller, b)).status).toBe(200)
    expect((await linkYoutube(all, s, b)).response.body.error).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 유튜브 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    expect((await waitInstagram(all, s, b)).body.error).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 인스타그램 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    expect((await linkTiktok(all.yt, s.seller, b)).body.error).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 틱톡 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    expect((await api.get(`/api/days/${DATE}`)).body.seq).toBe(seqBefore)
    // 연결 조회: 플랫폼마다 하나씩
    const live = await api.get(`/api/broadcasts/${b}/live`)
    expect((live.body.links as { platform: string }[]).map((link) => link.platform)).toEqual(['YOUTUBE', 'INSTAGRAM', 'TIKTOK'])
    expect((live.body.links as Record<string, unknown>[])[0]).toMatchObject({ platform: 'YOUTUBE', state: 'LINKED', linkedAt: expect.any(String) })
    expect((live.body.links as Record<string, unknown>[])[1]).toMatchObject({ platform: 'INSTAGRAM', state: 'WAITING', collection: expect.any(Object), moved: null })
    expect(((await api.get('/api/live')).body.links as { platform: string }[]).map((link) => link.platform).sort()).toEqual(['INSTAGRAM', 'TIKTOK', 'YOUTUBE'])
    // 인스타그램만 끊는다 — 플랫폼을 적지 않으면(둘 이상) 400
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })).status).toBe(400)
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u'), platform: 'INSTAGRAM' })).status).toBe(200)
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.links as { platform: string }[]).map((link) => link.platform)).toEqual(['YOUTUBE', 'TIKTOK'])
    expect((await waitInstagram(all, s, b)).status).toBe(200)
  })
})

describe('AC-N2b-2-02 동시 요청과 잠금 — 플랫폼 사이 틈 없음', () => {
  it('(가) 같은 플랫폼 둘 → 하나만 (나) 다른 플랫폼 셋 → 셋 다 (다) 같은 인스타 라이브 두 회차 → LIVE_TAKEN (라) 두 회차 틱톡 → TIKTOK_IN_USE. DB를 세어 확인', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const b1 = (await createBroadcast(all.yt, s.seller)).id
    const b2 = (await createBroadcast(all.yt, s.seller)).id
    const b3 = (await createBroadcast(all.yt, s.seller)).id
    // (가)
    const same = await Promise.all([linkTiktok(all.yt, s.seller, b1), linkTiktok(all.yt, s.seller, b1)])
    expect(same.map((r) => r.status).sort()).toEqual([200, 409])
    expect(same.find((r) => r.status === 409)?.body.error).toMatchObject({ code: 'ALREADY_LINKED' })
    // (나) b2에 다른 플랫폼 셋 — 틱톡은 b1에 이어져 있어 b3로
    await client(all.yt, s.seller.cookie).post(`/api/broadcasts/${b1}/live/unlink`, { requestId: rid('u'), platform: 'TIKTOK' })
    const liveId = all.meta.startLive(s.account.id)
    const three = await Promise.all([linkYoutube(all, s, b2).then((r) => r.response), linkInstagram(all, s, b2, liveId), linkTiktok(all.yt, s.seller, b2)])
    expect(three.map((r) => r.status)).toEqual([200, 200, 200])
    // (다)
    const live2 = all.meta.startLive(s.account.id)
    const taken = await Promise.all([linkInstagram(all, s, b1, live2), linkInstagram(all, s, b3, live2)])
    expect(taken.map((r) => r.status).sort()).toEqual([200, 409])
    expect(taken.find((r) => r.status === 409)?.body.error).toMatchObject({ code: 'LIVE_TAKEN' })
    // (라)
    await client(all.yt, s.seller.cookie).post(`/api/broadcasts/${b2}/live/unlink`, { requestId: rid('u'), platform: 'TIKTOK' })
    const inUse = await Promise.all([linkTiktok(all.yt, s.seller, b1), linkTiktok(all.yt, s.seller, b3)])
    expect(inUse.map((r) => r.status).sort()).toEqual([200, 409])
    expect(inUse.find((r) => r.status === 409)?.body.error).toMatchObject({ code: 'TIKTOK_IN_USE' })
    const pg = all.yt.database.pglite
    expect((await pg?.query<{ n: number }>(`select count(*)::int as n from tiktok_links where seller_id = $1 and state = 'LINKED'`, [s.seller.sellerId]))?.rows[0]?.n).toBe(1)
    const ig = await pg?.query<{ broadcast_id: string; n: number }>(`select broadcast_id, count(*)::int as n from live_links where seller_id = $1 and state <> 'UNLINKED' group by broadcast_id`, [s.seller.sellerId])
    expect(ig?.rows.every((row) => row.n === 1)).toBe(true)
    const yt = await pg?.query<{ n: number }>(`select count(*)::int as n from youtube_links where seller_id = $1 and broadcast_id = $2 and unlinked_at is null`, [s.seller.sellerId, b2])
    expect(yt?.rows[0]?.n).toBe(1)
    // DB 유일 제약: 같은 회차·플랫폼 끊지 않은 인스타 연결 둘, 판매자의 이어진 틱톡 연결 둘은 직접 넣어도 막힌다
    await expect(
      pg?.query(`insert into live_links (seller_id, broadcast_id, platform, state, actor, linked_at, created_at) values ($1, $2, 'INSTAGRAM', 'WAITING', 'server', now(), now())`, [s.seller.sellerId, b2]),
    ).rejects.toMatchObject({ code: '23505' })
    const scope = (await pg?.query<{ scope_id: string }>(`select scope_id from broadcasts where id = $1`, [b2]))?.rows[0]?.scope_id
    await expect(
      pg?.query(`insert into tiktok_links (seller_id, broadcast_id, scope_id, state, tiktok_id, linked_at, started_at, created_at) values ($1, $2, $3, 'LINKED', 'x', now(), now(), now())`, [s.seller.sellerId, b2, scope]),
    ).rejects.toMatchObject({ code: '23505' })
  })
})

describe('AC-N2b-2-03 둘 이상의 플랫폼 = 접수순', () => {
  it('실제 시각순 회차: 틱톡 RECEIVED_TIME_NOT_ALLOWED(인스타 그대로), 유튜브만은 받는다', async () => {
    const all = await allWorld()
    const s = await shop(all)
    expect((await client(all.yt, s.seller.cookie).patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } })).status).toBe(200)
    const b = (await createBroadcast(all.yt, s.seller)).id
    expect((await linkTiktok(all.yt, s.seller, b)).body.error).toMatchObject({ code: 'RECEIVED_TIME_NOT_ALLOWED', message: "틱톡 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요." })
    expect((await waitInstagram(all, s, b)).body.error).toMatchObject({ code: 'RECEIVED_TIME_NOT_ALLOWED' })
    expect((await linkYoutube(all, s, b)).response.status).toBe(200)
  })

  it('틱톡 "15"(먼저 도착) → 유튜브 "15번"(게시 시각이 더 이르나 늦게 도착) → 인스타 "16": 15번 1등 틱톡·대기 1순위 유튜브, 16번 1등 인스타 (G-ENG-N2b-2-01을 서버 경로로)', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const b = (await createBroadcast(all.yt, s.seller)).id
    await register(all, s, b, 15, '핑크프릴', 10_000)
    await register(all, s, b, 16, '라울', 5000)
    const { live } = await linkYoutube(all, s, b)
    const liveId = all.meta.startLive(s.account.id)
    expect((await linkInstagram(all, s, b, liveId)).status).toBe(200)
    expect((await linkTiktok(all.yt, s.seller, b)).status).toBe(200)
    await waitFor(async () => {
      await all.tclock.advance(0)
      return all.webcast.openHandles(s.tiktokId).length === 1
    })
    // 이은 뒤에 게시된 유튜브 채팅이어야 받는다 — 10초 뒤 틱톡이 먼저 도착, 유튜브 채팅은 그 5초 전에 게시됐지만 늦게 도착
    await all.yt.timer.advance(10_000)
    const published = all.yt.timer.now() - 5000
    all.webcast.broadcast(s.tiktokId, { msgId: msgId(), userId: '7101000000000000001', uniqueId: 'tt_buyer', nickname: '틱톡손님', comment: '15' })
    await all.yt.server.tiktok.idle()
    all.yt.server.youtube?.collectors.start()
    all.yt.fake.addMessage(live.liveChatId as string, { id: 'yt1', author: 'UCyoutubeBuyer', name: '유튜브손님', text: '15번', publishedAt: new Date(published).toISOString() })
    await until(all.yt, async () => listClaims((await all.yt.server.writer.read(s.seller.sellerId, DATE)).state).length === 2, { step: 100 })
    expect((await sendComments(all.ig, s.account, liveId, [{ id: '9001', igsid: '6024400000000001', username: 'ig.buyer', text: '16' }])).status).toBe(200)
    const state = (await all.yt.server.writer.read(s.seller.sellerId, DATE)).state
    const claims = listClaims(state)
    const product = (no: number) => listProducts(state).find((p) => p.no === no)
    const buyerOf = (id: string | undefined) => claims.find((c) => c.id === id)?.buyer
    expect(buyerOf(product(15)?.winnerClaims[0])).toBe('tt:7101000000000000001')
    expect(buyerOf(product(15)?.waitlistClaims[0])).toBe('UCyoutubeBuyer')
    expect(buyerOf(product(16)?.winnerClaims[0])).toBe('ig:6024400000000001')
  })
})

describe('AC-N2b-2-06 인스타 동작은 다른 플랫폼과 함께여도 그대로', () => {
  it('유튜브·틱톡이 이어진 회차를 인스타 기다리기로 두고 웹훅 첫 댓글 → 저절로 이음(LINKED, 조치자 서버), 그 댓글이 그 회차의 chat', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const b = (await createBroadcast(all.yt, s.seller)).id
    await linkYoutube(all, s, b)
    await linkTiktok(all.yt, s.seller, b)
    expect((await waitInstagram(all, s, b)).status).toBe(200)
    const liveId = all.meta.startLive(s.account.id)
    expect((await sendComments(all.ig, s.account, liveId, [{ id: '9101', igsid: '6024400000000001', username: 'ig.buyer', text: '안녕' }])).status).toBe(200)
    const link = (await client(all.yt, s.seller.cookie).get(`/api/broadcasts/${b}/live`)).body.link
    expect(link).toMatchObject({ platform: 'INSTAGRAM', state: 'LINKED', liveId, actor: { kind: 'server' } })
    const chat = await all.yt.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where seller_id = $1 and chat_broadcast = $2`, [s.seller.sellerId, b])
    expect(chat?.rows.map((r) => r.id)).toEqual(['ig:9101'])
  })
})

describe('AC-N2b-2-10~12 여러 플랫폼 회차의 감사 — 찜의 구매자 자신의 플랫폼으로', () => {
  it('유튜브 채팅 → 유튜브 게시, 인스타 댓글 → DM, 틱톡 → 건너뜀(NOT_SUPPORTED), 문자찜 → 유튜브("문자찜님"), 직접 배정 틱톡·인스타 → 건너뜀. 가짜 구글 게시에 인스타·틱톡 이름 0번', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const api = client(all.yt, s.seller.cookie)
    const b = (await createBroadcast(all.yt, s.seller)).id
    for (const [no, name] of [
      [1, '가'],
      [2, '나'],
      [3, '다'],
      [4, '라'],
      [5, '마'],
      [6, '바'],
    ] as const)
      await register(all, s, b, no, name, 1000)
    const { live } = await linkYoutube(all, s, b)
    const liveId = all.meta.startLive(s.account.id)
    await linkInstagram(all, s, b, liveId)
    await linkTiktok(all.yt, s.seller, b)
    await waitFor(async () => {
      await all.tclock.advance(0)
      return all.webcast.openHandles(s.tiktokId).length === 1
    })
    all.yt.server.youtube?.collectors.start()
    all.yt.fake.addMessage(live.liveChatId as string, { id: 'yt1', author: 'UCyoutubeBuyer', name: '유튜브손님', text: '1', publishedAt: new Date(all.yt.timer.now()).toISOString() })
    await until(all.yt, async () => listClaims((await all.yt.server.writer.read(s.seller.sellerId, DATE)).state).length === 1, { step: 100 })
    await sendComments(all.ig, s.account, liveId, [{ id: '9201', igsid: '6024400000000001', username: 'ig.buyer', text: '2' }])
    all.webcast.broadcast(s.tiktokId, { msgId: msgId(), userId: '7101000000000000001', uniqueId: 'tt_buyer', nickname: '틱톡손님', comment: '3' })
    await all.yt.server.tiktok.idle()
    expect((await api.post('/api/events', { requestId: rid('sms'), type: 'sms', b, no: 4, received: '12:00' })).status).toBe(200)
    expect((await api.post('/api/events', { requestId: rid('as'), type: 'host.assign', b, no: 5, buyer: 'tt:7101000000000000001', reason: '확인' })).status).toBe(200)
    expect((await api.post('/api/events', { requestId: rid('as'), type: 'host.assign', b, no: 6, buyer: 'ig:6024400000000001', reason: '확인' })).status).toBe(200)
    const rows = await all.yt.database.pglite?.query<{ product: string; state: string | null; reason: string | null; dm: string | null }>(
      `select o.body::jsonb->>'product' as product, o.state, o.reason, d.status as dm from outbox o left join ig_dm_rows d on d.outbox_id = o.id where o.seller_id = $1 and o.kind = 'POST_THANKS' order by o.id`,
      [s.seller.sellerId],
    )
    const byNo = new Map(rows?.rows.map((row) => [row.product.split('/')[1], row]))
    expect(byNo.get('3')).toMatchObject({ state: 'SKIPPED', reason: 'NOT_SUPPORTED', dm: null })
    expect(byNo.get('5')).toMatchObject({ state: 'SKIPPED', reason: 'NOT_SUPPORTED', dm: null })
    expect(byNo.get('2')?.dm).toBe('WAITING')
    expect(byNo.get('6')?.dm).toBe('SKIPPED')
    // 실행기들
    await all.yt.server.youtube?.outbox.runOnce()
    await all.yt.server.youtube?.outbox.runOnce()
    await all.yt.server.instagram.dms.drain()
    const posted = all.yt.fake.posted.map((post) => post.text).join('\n')
    expect(posted).toContain('유튜브손님님 구매 감사합니다')
    expect(posted).toContain('문자찜님 구매 감사합니다')
    for (const name of ['ig.buyer', '틱톡손님']) expect(posted).not.toContain(name)
    expect(all.meta.dms.map((dm) => dm.commentId)).toEqual(['9201'])
    // 건너뛴 감사는 게시 보고가 없다 — 엔진 효과는 PENDING 그대로
    const effects = listEffects((await all.yt.server.writer.read(s.seller.sellerId, DATE)).state).filter((e) => e.kind === 'POST_THANKS')
    expect(effects.find((e) => e.product.endsWith('/3'))?.status).toBe('PENDING')
    expect(effects.find((e) => e.product.endsWith('/1'))?.status).toBe('DONE')
    // 방송 후 요약(AC-N2b-2-12): 유튜브로 가는 감사의 판매만 — 유튜브 채팅 1번·문자찜 4번
    expect(summaryLines((await all.yt.server.writer.read(s.seller.sellerId, DATE)).state, b).map((line) => line.no)).toEqual([1, 4])
    // 발송함 보기: 건너뜀 문장
    const outbox = (await api.get(`/api/days/${DATE}/outbox`)).body
    expect(JSON.stringify(outbox)).toContain('틱톡에는 감사 메시지를 보내지 않아요.')
  })

  it('유튜브를 이은 적 없는 회차(인스타·틱톡만)의 문자찜 감사는 NO_RECIPIENT — 가짜 구글 호출 0. 유튜브를 이었다 끊은 회차는 유튜브 규칙 그대로. 아무 것도 이은 적 없는 회차도 그대로', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const api = client(all.yt, s.seller.cookie)
    const noYoutube = (await createBroadcast(all.yt, s.seller)).id
    const youtubeOnce = (await createBroadcast(all.yt, s.seller)).id
    const nothing = (await createBroadcast(all.yt, s.seller)).id
    for (const b of [noYoutube, youtubeOnce, nothing]) await register(all, s, b, 1, '가', 1000)
    await linkTiktok(all.yt, s.seller, noYoutube)
    await linkYoutube(all, s, youtubeOnce)
    expect((await client(all.yt, s.seller.cookie).post(`/api/broadcasts/${youtubeOnce}/youtube/unlink`, {})).status).toBe(200)
    for (const b of [noYoutube, youtubeOnce, nothing]) expect((await api.post('/api/events', { requestId: rid('sms'), type: 'sms', b, no: 1, received: '12:00' })).status).toBe(200)
    const rows = await all.yt.database.pglite?.query<{ b: string; state: string | null; reason: string | null }>(
      `select o.body::jsonb->>'broadcast' as b, o.state, o.reason from outbox o where o.seller_id = $1 and o.kind = 'POST_THANKS'`,
      [s.seller.sellerId],
    )
    const of = (b: string) => rows?.rows.find((row) => row.b === b)
    expect(of(noYoutube)).toMatchObject({ state: 'SKIPPED', reason: 'NO_RECIPIENT' })
    expect(of(youtubeOnce)?.state).toBeNull()
    expect(of(nothing)?.state).toBeNull()
    const calls = all.yt.fake.calls('liveChatMessages.insert')
    await all.yt.server.youtube?.outbox.runOnce()
    expect(all.yt.fake.calls('liveChatMessages.insert')).toBe(calls)
  })
})

describe('AC-N2b-2-70 운영 상태의 발송함 수', () => {
  it('인스타 회차 감사 3건 → 유튜브 NEW 0, 인스타 DM 행은 상태별로 따로, 틱톡 연결 수, 판매자 정보 없음', async () => {
    const all = await allWorld()
    const s = await shop(all)
    const b = (await createBroadcast(all.yt, s.seller)).id
    for (const no of [1, 2, 3]) await register(all, s, b, no, '가', 1000)
    const liveId = all.meta.startLive(s.account.id)
    await linkInstagram(all, s, b, liveId)
    await linkTiktok(all.yt, s.seller, b)
    await sendComments(all.ig, s.account, liveId, [
      { id: '9301', igsid: '6024400000000001', username: 'a.a', text: '1' },
      { id: '9302', igsid: '6024400000000002', username: 'b.b', text: '2' },
      { id: '9303', igsid: '6024400000000003', username: 'c.c', text: '3' },
    ])
    const token = 'x'.repeat(40)
    const ops = createServer({ database: all.yt.database, masterKey: all.yt.masterKey, appOrigin: ORIGIN, opsToken: token, log: () => undefined, clock: all.yt.timer })
    const response = await ops.app.request('/ops/status', { headers: { Authorization: `Bearer ${token}` } })
    const body = (await response.json()) as { outbox: { byState: Record<string, unknown> }; instagramDm: Record<string, number>; tiktok: Record<string, unknown> }
    expect(body.outbox.byState['NEW']).toBeUndefined()
    expect(body.instagramDm).toEqual({ WAITING: 3 })
    expect(body.tiktok).toMatchObject({ links: { LINKED: 1 } })
    const text = JSON.stringify(body)
    for (const value of [s.seller.sellerId, s.tiktokId, 'a.a', s.seller.loginId]) expect(text).not.toContain(value)
    ops.close()
  })
})

describe('AC-N2b-2-71 인스타 주소는 https만', () => {
  const base = { LIVEJJIM_IG_APP_ID: '1', LIVEJJIM_IG_APP_SECRET: 's', LIVEJJIM_IG_VERIFY_TOKEN: 'v' }
  it('http://shop.example → 설정 없음 + 경고 코드(값 없이), http://localhost:4000 → 준비됨, 서버는 정상으로 시작', async () => {
    expect(readInstagramConfig({ ...base, LIVEJJIM_IG_REDIRECT_URI: 'http://shop.example/api/instagram/callback' })).toEqual({ ok: true, settings: null, warning: 'INSTAGRAM_CONFIG_INSECURE' })
    expect(readInstagramConfig({ ...base, LIVEJJIM_IG_REDIRECT_URI: 'http://localhost:4000/api/instagram/callback' }).ok).toBe(true)
    expect((readInstagramConfig({ ...base, LIVEJJIM_IG_REDIRECT_URI: 'http://localhost:4000/api/instagram/callback' }) as { settings: unknown }).settings).not.toBeNull()
    expect((readInstagramConfig({ ...base, LIVEJJIM_IG_REDIRECT_URI: 'https://a.example/cb', LIVEJJIM_IG_GRAPH_URL: 'http://graph.example' }) as { warning?: string }).warning).toBe('INSTAGRAM_CONFIG_INSECURE')
    const database = await openTestDb()
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: ORIGIN, ...base, LIVEJJIM_IG_REDIRECT_URI: 'http://shop.example/api/instagram/callback' }
    const assembled = productionServerOptions(env, database)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.instagram).toBeNull()
    const logs: { code: string }[] = []
    const server = createServer({ ...assembled.options, log: (record) => logs.push(record) })
    expect(logs.map((l) => l.code)).toContain('INSTAGRAM_CONFIG_INSECURE')
    expect(JSON.stringify(logs)).not.toContain('shop.example')
    const seller = await addSeller({ server, database, masterKey: env.LIVEJJIM_MASTER_KEY, clock: { now: () => Date.now(), set: () => undefined, advance: () => undefined }, logs: [] })
    const platforms = (await client({ server, database, masterKey: env.LIVEJJIM_MASTER_KEY, clock: { now: () => Date.now(), set: () => undefined, advance: () => undefined }, logs: [] }, seller.cookie).get('/api/platforms')).body
      .platforms as { platform: string; ready: boolean }[]
    expect(platforms.find((p) => p.platform === 'INSTAGRAM')?.ready).toBe(false)
    server.close()
    await database.close()
  })
})

describe('AC-N2b-2-73·38 운영 시작 경로', () => {
  it('운영 설정으로 띄운 서버에 시험용 틱톡 조작 경로가 없다(404), 운영자 스위치·라이브러리 변수를 읽는다', async () => {
    const database = await openTestDb()
    const masterKey = generateMasterKey()
    const assembled = productionServerOptions({ LIVEJJIM_MASTER_KEY: masterKey, LIVEJJIM_APP_ORIGIN: 'https://app.example', LIVEJJIM_TIKTOK_BETA: 'on', SIGN_API_URL: 'planted-sign-url' }, database)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.tiktok?.libraryEnv).toEqual(['SIGN_API_URL'])
    expect(assembled.options.tiktok?.webcast).toBeUndefined()
    const logs: unknown[] = []
    const server = createServer({ ...assembled.options, log: (record) => logs.push(record) })
    expect(server.tiktok.operatorOn).toBe(false)
    expect(JSON.stringify(logs)).not.toContain('planted-sign-url')
    for (const path of ['/_e2e/tiktok/comment', '/_e2e/tiktok/drop', '/_e2e/tiktok/block']) {
      const response = await server.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(response.status, path).toBe(404)
    }
    server.close()
    await database.close()
  })
})
