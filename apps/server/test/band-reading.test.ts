// 밴드 잇기·끊기·읽기·기록 (BND1, AC-BND1-22·23·24·30~37) — 가짜 밴드 서버·주입한 시계.
import { afterEach, describe, expect, it } from 'vitest'
import { recordPlatformChats } from '../src/platform-record.ts'
import { addSeller, client, rid, writeEvent } from './support.ts'
import { DATE, bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, restartBand, tick, unlinkBand, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

const sql = async <T>(w: BandWorld, text: string, params: unknown[] = []): Promise<T[]> => ((await w.database.pglite?.query<T>(text, params))?.rows ?? []) as T[]
const linkCount = async (w: BandWorld): Promise<number> => (await sql<{ n: number }>(w, `select count(*)::int as n from band_links`))[0]?.n ?? -1
const eventCount = async (w: BandWorld, sellerId: string): Promise<number> => (await sql<{ n: number }>(w, `select count(*)::int as n from events where seller_id = $1`, [sellerId]))[0]?.n ?? -1

/** 그 회차에 유튜브 연결 기록 하나 (시험에서 직접) */
async function youtubeRow(w: BandWorld, sellerId: string, b: string): Promise<void> {
  const scope = (await sql<{ scope_id: string }>(w, `select scope_id from broadcasts where id = $1`, [b]))[0]?.scope_id
  await w.database.pglite?.query(
    `insert into youtube_links (id, seller_id, scope_id, broadcast_id, video_id, live_chat_id, channel_id, linked_at, unlinked_at) values ($1, $2, $3, $4, 'v', 'lc', 'UCx', now(), now())`,
    [`yl-${b}`, sellerId, scope, b],
  )
}

async function opened(w: BandWorld, options: { readonly comments?: number } = {}) {
  const shop = await bandSeller(w)
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
  for (let i = 0; i < (options.comments ?? 0); i += 1) guestComment(w, postKey, `예전 ${String(i)}`, { createdAt: w.bclock.now() - 100_000 + i })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

describe('AC-BND1-22 잇기 — 받지 않는 경우 (아무것도 바꾸지 않는다)', () => {
  it('거절표: 없는 회차·리허설·끝남·실제 시각순·연결 안 함·다시 연결·이미 이어짐·다른 회차에 이어짐·유튜브·남의 글·1,000개 넘음', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const b = await realBroadcast(w, seller)
    const err = async (target: string, bandKey = 'BANDKEY', postKey = 'POSTKEY') => (await linkBand(w, seller, target, bandKey, postKey)).body.error
    expect((await linkBand(w, seller, 'nope', 'B', 'P')).status).toBe(404)
    expect(await err(b)).toEqual({ code: 'NOT_CONNECTED', message: '설정에서 밴드를 먼저 연결해 주세요.' })
    const userKey = w.fake.addUser('가게')
    const bandKey = w.fake.addBand({ name: '방', members: [userKey] })
    const { connectBand } = await import('./band-support.ts')
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await connectBand(w, seller)).toBe('connected')
    const rehearsal = (await api.post('/api/broadcasts', { requestId: rid('bc'), date: DATE, rehearsal: true })).body.broadcast as { id: string }
    expect(await err(rehearsal.id)).toEqual({ code: 'REHEARSAL', message: '리허설 방송에는 라이브를 이을 수 없어요.' })
    const ended = await realBroadcast(w, seller)
    await api.post(`/api/broadcasts/${ended}/end`, { requestId: rid('end') })
    expect(await err(ended)).toEqual({ code: 'ENDED', message: '끝난 방송에는 라이브를 이을 수 없어요.' })
    const received = await realBroadcast(w, seller, { 'contention.policy': 'RECEIVED_TIME' })
    expect(await err(received)).toEqual({ code: 'RECEIVED_TIME_NOT_ALLOWED', message: "밴드 댓글은 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요." })
    expect((await api.patch('/api/settings', { settings: { 'contention.policy': 'ARRIVAL' } })).status).toBe(200)
    const youtube = await realBroadcast(w, seller)
    await youtubeRow(w, seller.sellerId, youtube)
    const mine = w.fake.addPost({ bandKey, authorUserKey: userKey })
    expect(await err(youtube, bandKey, mine)).toEqual({ code: 'YOUTUBE_LINKED', message: '유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.' })
    const others = w.fake.addPost({ bandKey, authorUserKey: 'SOMEONE' })
    const noAuthor = w.fake.addPost({ bandKey, authorUserKey: null })
    const real = await realBroadcast(w, seller)
    expect(await err(real, bandKey, others)).toEqual({ code: 'NOT_MY_POST', message: '내가 쓴 글만 이을 수 있어요.' })
    expect(await err(real, bandKey, noAuthor)).toEqual({ code: 'NOT_MY_POST', message: '내가 쓴 글만 이을 수 있어요.' })
    const big = w.fake.addPost({ bandKey, authorUserKey: userKey })
    for (let i = 0; i < 1001; i += 1) w.fake.addComment(big, { content: `${String(i)}번`, userKey: 'G' })
    expect(await err(real, bandKey, big)).toEqual({ code: 'TOO_MANY_COMMENTS', message: '댓글이 1,000개 넘는 글은 이을 수 없어요. 새 글을 올려 이어 주세요.' })
    expect(await linkCount(w)).toBe(0)
    // 이어진 뒤: 같은 회차·다른 회차
    expect((await linkBand(w, seller, real, bandKey, mine)).status).toBe(200)
    expect(await err(real, bandKey, mine)).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    const second = await realBroadcast(w, seller)
    expect(await err(second, bandKey, mine)).toEqual({ code: 'BAND_IN_USE', message: '이미 다른 방송에 밴드 글이 이어져 있어요. 먼저 그 방송의 밴드 연결을 끊어 주세요.' })
    expect(await linkCount(w)).toBe(1)
    // 받은 값은 오류 응답에 없다
    expect(JSON.stringify(await err(second, 'PLANTEDBANDKEY', 'PLANTEDPOSTKEY'))).not.toContain('PLANTED')
  })

  it('설정 없음 · 글 상세·댓글 읽기 실패 → 그 문장, 연결 없음 · 토큰 풀림(10401) → 다시 연결 필요', async () => {
    const off = await bandWorld({ notConfigured: true })
    const offSeller = await addSeller(off)
    const ob = await realBroadcast(off, offSeller)
    expect((await linkBand(off, offSeller, ob, 'B', 'P')).body.error).toEqual({ code: 'NOT_CONFIGURED', message: '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.' })
    await off.close()
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    w.fake.fail('post', { resultCode: 60102 })
    expect((await linkBand(w, seller, b, bandKey, postKey)).body.error).toEqual({ code: 'NO_ACCESS', message: '이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.' })
    // 잇기 중 일시 실패·호출 한도는 연결 없이 한 문장 (D-BND1-19 — "다시 시도하고 있어요"는 저절로 다시 하는 것처럼 읽힌다)
    const unavailable = { code: 'UNAVAILABLE', message: '밴드 글을 읽지 못해 잇지 못했어요. 잠시 뒤 다시 눌러 주세요.' }
    w.fake.fail('comments', { http: 503 })
    expect((await linkBand(w, seller, b, bandKey, postKey)).body.error).toEqual(unavailable)
    w.fake.fail('comments', { resultCode: 1003 })
    expect((await linkBand(w, seller, b, bandKey, postKey)).body.error).toEqual(unavailable)
    w.fake.fail('post', { http: 500 })
    expect((await linkBand(w, seller, b, bandKey, postKey)).body.error).toEqual(unavailable)
    expect(await linkCount(w)).toBe(0)
    w.fake.revoke(userKey)
    expect((await linkBand(w, seller, b, bandKey, postKey)).body.error).toEqual({ code: 'RECONNECT_NEEDED', message: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.' })
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'RECONNECT_NEEDED' })
    expect(await linkCount(w)).toBe(0)
  })

  it('잇기는 엔진 이벤트가 아니다 · 같은 요청 번호 두 번 = 연결 하나·기준선 읽기 한 번 · 동시 두 요청은 하나만', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    guestComment(w, postKey, '예전 댓글')
    const b = await realBroadcast(w, seller)
    const events = await eventCount(w, seller.sellerId)
    const requestId = rid('same')
    const [one, two] = await Promise.all([linkBand(w, seller, b, bandKey, postKey, requestId), linkBand(w, seller, b, bandKey, postKey, requestId)])
    expect(one.body).toEqual(two.body)
    expect(one.status).toBe(200)
    expect(w.fake.calls('comments')).toHaveLength(1)
    expect(await linkCount(w)).toBe(1)
    expect(await eventCount(w, seller.sellerId)).toBe(events)
    expect(await unlinkBand(w, seller, b)).toMatchObject({ status: 200 })
    const results = await Promise.all([linkBand(w, seller, b, bandKey, postKey), linkBand(w, seller, b, bandKey, postKey)])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect((await sql<{ n: number }>(w, `select count(*)::int as n from band_links where state <> 'FINISHED'`))[0]?.n).toBe(1)
  })

  it('끊었다 다시 이으면 다시 기준선 (끊긴 동안 달린 댓글도 넣지 않는다) · 인스타그램·틱톡 연결 기록이 있어도 잇는다', async () => {
    const w = await world()
    const { seller, userKey, bandKey, postKey, b } = await opened(w, { comments: 2 })
    expect(await unlinkBand(w, seller, b)).toMatchObject({ status: 200, body: { link: { state: 'FINISHED', message: '끊었어요.' } } })
    guestComment(w, postKey, '끊긴 동안 1번')
    guestComment(w, postKey, '끊긴 동안 2번')
    const scope = (await sql<{ scope_id: string }>(w, `select scope_id from broadcasts where id = $1`, [b]))[0]?.scope_id
    await w.database.pglite?.query(`insert into tiktok_links (seller_id, broadcast_id, scope_id, state, tiktok_id, linked_at, started_at, created_at) values ($1, $2, $3, 'LINKED', 'shop', now(), now(), now())`, [seller.sellerId, b, scope])
    const again = await linkBand(w, seller, b, bandKey, postKey)
    expect(again.status, again.text).toBe(200)
    expect(again.body.link).toMatchObject({ baseline: 4, baselineMessage: '이을 때 이미 달려 있던 댓글 4개는 넣지 않았어요.' })
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toEqual([])
    void userKey
  })
})

describe('AC-BND1-23 끊기·회차 끝·서버 다시 시작', () => {
  it('끊기 뒤 요청 없음 · 진행 중이던 읽기가 끊기 뒤에 답을 받아도 기록하지 않는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    w.fake.delay('comments', 300)
    w.bclock.fire(10_000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(w.fake.calls('comments')).toHaveLength(2)
    expect(await unlinkBand(w, seller, b)).toMatchObject({ status: 200 })
    await tick(w, 0)
    w.fake.delay('comments', 0)
    expect(await chats(w, seller.sellerId)).toEqual([])
    const after = w.fake.requests.length
    guestComment(w, postKey, '2번')
    await tick(w, 120_000)
    expect(w.fake.requests.length).toBe(after)
  })

  it('회차를 끝내면 바로 멈춘다 (마지막 읽기 없음) — 끝낸 뒤 댓글은 chat이 되지 않는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    const before = w.fake.requests.length
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', finishReason: 'ENDED', message: '방송을 끝내서 밴드 댓글을 그만 받았어요.' })
    guestComment(w, postKey, '2번')
    await tick(w, 120_000)
    expect(w.fake.requests.length).toBe(before)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
  })

  it('서버가 다시 켜지면 READING·RETRYING 연결을 다시 읽는다 — 꺼진 동안 댓글은 한 번만, 늦게 읽음 알림', async () => {
    const w1 = await world()
    const { seller, postKey, b } = await opened(w1)
    guestComment(w1, postKey, '1번')
    await tick(w1, 10_000)
    expect(await chats(w1, seller.sellerId)).toHaveLength(1)
    // 서버를 끈 동안 5분 지나고 댓글 둘
    w1.server.close()
    await w1.server.band.idle()
    w1.bclock.jump(5 * 60 * 1000)
    guestComment(w1, postKey, '2번')
    guestComment(w1, postKey, '3번')
    const w2 = await restartBand(w1)
    w = w2
    expect(await w2.server.band.resume()).toBe(1)
    await tick(w2, 0)
    const recorded = await chats(w2, seller.sellerId)
    expect(recorded.map((chat) => chat.text)).toEqual(['1번', '2번', '3번'])
    const view = await bandView(w2, seller, b)
    expect(view).toMatchObject({ state: 'READING', received: 3 })
    const notices = (view.notices as { items: { kind: string; message: string }[] }).items
    expect(notices).toEqual([expect.objectContaining({ kind: 'LATE', message: '밴드 댓글을 5분 동안 읽지 못했어요. 그 사이 달린 댓글 2개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.' })])
    // 다시 켜도 두 번 넣지 않는다
    const w3 = await restartBand(w2)
    w = w3
    await w3.server.band.resume()
    await tick(w3, 70_000)
    expect(await chats(w3, seller.sellerId)).toHaveLength(3)
    await w3.close()
    await w1.fake.close()
    await w1.database.close()
    w = null
  })

  it('끝난 회차에 이어진 연결이 남아 기록이 회차 끝으로 거절되면 바로 FINISHED(회차 끝) — 그 뒤 요청 0, 다시 읽는 고리 없음 (RA-BND1-04)', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    // 어떤 까닭으로든 연결이 남았다고 친다: 연결 행을 READING으로 되돌리고(회차 표의 끝 시각도 지움 — 엔진에는 끝이 기록돼 있다) 다시 켠다
    await sql(w, `update band_links set state = 'READING', finish_reason = null, finished_at = null where seller_id = $1`, [seller.sellerId])
    await sql(w, `update broadcasts set ended_at = null where id = $1`, [b])
    guestComment(w, postKey, '1번')
    expect(await w.server.band.resume()).toBe(1)
    await tick(w, 0)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'FINISHED', finishReason: 'ENDED', message: '방송을 끝내서 밴드 댓글을 그만 받았어요.' })
    expect(w.logs.some((log) => log.code === 'BAND_ENDED_STOPPED')).toBe(true)
    const after = w.fake.requests.length
    guestComment(w, postKey, '2번')
    await tick(w, 600_000)
    expect(w.fake.requests.length).toBe(after)
    expect(w.bclock.pendingTimers).toBeLessThanOrEqual(1) // 보관 기간 지우기 타이머만
    expect(await chats(w, seller.sellerId)).toEqual([])
  })
})

describe('AC-BND1-24 유튜브와 한 회차에 함께 잇지 않는다', () => {
  it('이은 뒤 그 회차에 유튜브 연결 기록이 생기면 다음 읽기 전에 멈춘다 — 그 뒤 밴드 댓글은 기록하지 않는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    await youtubeRow(w, seller.sellerId, b)
    guestComment(w, postKey, '1번')
    const before = w.fake.calls('comments').length
    await tick(w, 10_000)
    expect(w.fake.calls('comments').length).toBe(before)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'YOUTUBE_LINKED', message: '유튜브 라이브를 이은 방송이라 밴드 댓글을 그만 받았어요.' })
    await tick(w, 120_000)
    expect(await chats(w, seller.sellerId)).toEqual([])
  })
})

describe('AC-BND1-30 빠른 읽기 — 10초마다', () => {
  it('앞 읽기가 끝난 때부터 10초 뒤, 최신순, 본 댓글이 나온 쪽에서 멈춤', async () => {
    const w = await world()
    const { postKey } = await opened(w, { comments: 45 })
    const base = w.fake.calls('comments').length
    await tick(w, 9_999)
    expect(w.fake.calls('comments').length).toBe(base)
    guestComment(w, postKey, '새 1번')
    await tick(w, 1)
    const fast = w.fake.calls('comments').slice(base)
    expect(fast).toHaveLength(1)
    expect(fast[0]?.query['sort']).toBe('-created_at')
    expect(fast[0]?.query['post_key']).toBe(postKey)
    expect(fast[0]?.query['limit']).toBeUndefined()
  })

  it('한 판매자의 읽기는 겹치지 않는다 — 답을 늦춰도 동시 요청 1', async () => {
    const w = await world()
    const { userKey, postKey } = await opened(w)
    guestComment(w, postKey, '1번')
    w.fake.delay('comments', 400)
    w.bclock.fire(10_000)
    w.bclock.fire(30_000)
    w.bclock.fire(30_000)
    await w.server.band.idle()
    w.fake.delay('comments', 0)
    await tick(w, 60_000)
    const tokens = new Set(w.fake.callsOfUser(userKey).map((call) => call.token))
    for (const token of tokens) expect(w.fake.maxInflight.get(token as string) ?? 0).toBeLessThanOrEqual(1)
  })

  it('기준선 0개 글에 새 댓글 1,001개가 한 번에: 빠른 읽기 기록 0(BAND_FAST_UNREACHED) → 같은 차례 전체 읽기 오래된 1,000개 → 빠른 읽기 한 번 더 마지막 1개 (D-BND1-16)', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const t = w.bclock.now()
    for (let i = 0; i < 1001; i += 1) guestComment(w, postKey, `${String(i)}번`, { createdAt: t + i })
    const before = w.fake.calls('comments').length
    await tick(w, 10_000)
    const sorts = w.fake.calls('comments').slice(before).map((call) => call.query['sort'])
    // 빠른 51쪽(1,001번째에서 멈춤) → 전체 51쪽(1,000개를 넘어 멈춤) → 빠른 1쪽(본 댓글이 있는 쪽)
    expect(sorts).toEqual([...Array<string>(51).fill('-created_at'), ...Array<string>(51).fill('+created_at'), '-created_at'])
    expect(w.logs.filter((log) => log.code === 'BAND_FAST_UNREACHED')).toHaveLength(1)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((chat) => chat.text)).toEqual(Array.from({ length: 1001 }, (_, i) => `${String(i)}번`))
    const seqs = recorded.map((chat) => chat.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    expect(new Set(recorded.map((chat) => chat.id)).size).toBe(1001)
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({ state: 'READING', received: 1001, lastReadAt: new Date(w.bclock.now()).toISOString() })
    expect((view.notices as { total: number }).total).toBe(0)
    // 그 차례를 60초 차례로 셈 — 다음 50초 동안 전체 읽기 없음, 두 번 넣지 않음
    const mark = w.fake.calls('comments').length
    await tick(w, 50_000)
    expect(w.fake.calls('comments').slice(mark).every((call) => call.query['sort'] === '-created_at')).toBe(true)
    expect(await chats(w, seller.sellerId)).toHaveLength(1001)
  })

  it('막다른 경우: 기준선 990 + 기록 20(글 1,010개)에 새 댓글 1,001개 → 그 차례 chat 0·알림 1, 다음 두 차례도 알림 1 그대로 (D-BND1-16)', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    for (let i = 0; i < 990; i += 1) w.fake.addComment(postKey, { content: '예전', userKey: 'OLD', createdAt: i + 1 })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const t = w.bclock.now()
    for (let i = 0; i < 20; i += 1) guestComment(w, postKey, `앞 ${String(i)}`, { createdAt: t + i })
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(20)
    const readAt = (await bandView(w, seller, b)).lastReadAt
    for (let i = 0; i < 1001; i += 1) guestComment(w, postKey, `뒤 ${String(i)}`, { createdAt: t + 100 + i })
    const stuck = '밴드 댓글이 너무 많이 한꺼번에 달려 차례대로 읽지 못하고 있어요. 밴드 글에서 직접 확인해 주세요.'
    for (let round = 0; round < 3; round += 1) {
      const before = w.fake.calls('comments').length
      if (round === 0) await tick(w, 10_000)
      else {
        // 알림이 난 뒤에는 닿을 때까지 60초 간격 — 59초 동안 요청 0 (D-BND1-23 (가))
        await tick(w, 59_000)
        expect(w.fake.calls('comments').length).toBe(before)
        await tick(w, 1_000)
      }
      // 다음 차례에 다시 읽는다 (빠른 → 전체 → 빠른, 60초 차례는 전체 → 빠른)
      expect(w.fake.calls('comments').length).toBeGreaterThan(before)
      expect(await chats(w, seller.sellerId)).toHaveLength(20)
      const view = await bandView(w, seller, b)
      const notices = view.notices as { total: number; unseen: number; items: { kind: string; message: string }[] }
      expect(notices).toMatchObject({ total: 1, unseen: 1 })
      expect(notices.items[0]).toMatchObject({ kind: 'STUCK', message: stuck })
      // 닿지 못한 읽기는 마지막으로 읽은 시각을 바꾸지 않는다
      expect(view).toMatchObject({ state: 'READING', lastReadAt: readAt })
    }
    expect(w.logs.filter((log) => log.code === 'BAND_STUCK')).toHaveLength(1)
  })
})

describe('AC-BND1-31 전체 읽기 — 60초마다', () => {
  it('새 댓글 130개가 한 번에(쪽 크기 20 → 7쪽째에 본 댓글): 빠른 읽기 한 번이 130개를 작성 시각 순으로, 다음 전체 읽기 새 기록 0 (D-BND1-16)', async () => {
    const w = await world()
    const { seller, postKey } = await opened(w, { comments: 5 })
    const t = w.bclock.now()
    for (let i = 0; i < 130; i += 1) guestComment(w, postKey, `${String(i)}번`, { createdAt: t + i })
    const before = w.fake.calls('comments').length
    await tick(w, 10_000)
    const fast = w.fake.calls('comments').slice(before)
    expect(fast).toHaveLength(7)
    expect(fast.every((call) => call.query['sort'] === '-created_at')).toBe(true)
    const first = await chats(w, seller.sellerId)
    expect(first.map((chat) => chat.text)).toEqual(Array.from({ length: 130 }, (_, i) => `${String(i)}번`))
    const seqs = first.map((chat) => chat.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    expect(first[0]?.seq).toBe(Math.min(...seqs))
    await tick(w, 50_000)
    const all = await chats(w, seller.sellerId)
    expect(all).toEqual(first)
    expect(new Set(all.map((chat) => chat.id)).size).toBe(130)
    expect(w.fake.calls('comments').filter((call) => call.query['sort'] === '+created_at').length).toBeGreaterThan(1)
  })

  it('글 1,000개(쪽 크기 20, 마지막 쪽 50)는 끝까지 된 읽기(지움을 본다) · 1,001개는 끝까지 되지 않음(지움을 보지 않는다) (D-BND1-18)', async () => {
    for (const total of [1000, 1001]) {
      const w = await world()
      const { seller, userKey, bandKey } = await bandSeller(w)
      const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
      for (let i = 0; i < 997; i += 1) w.fake.addComment(postKey, { content: '예전', userKey: 'OLD', createdAt: i + 1 })
      const b = await realBroadcast(w, seller)
      expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
      const gone = guestComment(w, postKey, '1번')
      for (let i = 1; i < total - 997; i += 1) guestComment(w, postKey, `${String(i)}번 더`)
      await tick(w, 10_000)
      expect(await chats(w, seller.sellerId)).toHaveLength(total - 997)
      w.fake.dropComment(postKey, gone)
      // 지운 뒤 글은 total - 1개 — 다시 하나 더해 total개로 둔다
      guestComment(w, postKey, '채움')
      const before = w.fake.calls('comments').filter((call) => call.query['sort'] === '+created_at').length
      await tick(w, 50_000)
      const fulls = w.fake.calls('comments').filter((call) => call.query['sort'] === '+created_at').length - before
      expect(fulls).toBe(total === 1000 ? 50 : 51)
      const notices = (await bandView(w, seller, b)).notices as { total: number; items: { kind: string }[] }
      expect(notices.items.filter((item) => item.kind === 'DELETED')).toHaveLength(total === 1000 ? 1 : 0)
      if (total === 1000) await w.close() // 마지막 것은 afterEach가 닫는다
    }
  })

})

describe('AC-BND1-32 쪽 넘기기 — 밴드가 준 값을 그대로 따르지 않는다', () => {
  it('다른 토큰·다른 글 키를 넣어도 다음 요청은 우리 값 · 같은 after가 다시 나오면 끝(BAND_PAGING_LOOP) · 객체가 아니면 마지막 쪽', async () => {
    const w = await world()
    const { seller, userKey, postKey, b } = await opened(w)
    w.fake.pageSize = 2
    for (let i = 0; i < 6; i += 1) guestComment(w, postKey, `${String(i)}번`)
    w.fake.pagingOverride = (_op, next) => (next === null ? null : { ...next, access_token: 'OTHER-TOKEN', post_key: 'OTHERPOST', band_key: 'OTHERBAND' })
    await tick(w, 10_000)
    const calls = w.fake.calls('comments').slice(-3)
    expect(calls).toHaveLength(3)
    const ours = new Set(w.fake.callsOfUser(userKey).map((call) => call.token))
    for (const call of calls) {
      expect(ours.has(call.token)).toBe(true)
      expect(call.query['post_key']).toBe(postKey)
      expect(call.query['band_key']).not.toBe('OTHERBAND')
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(6)
    // 고리: 늘 같은 after
    for (let i = 0; i < 6; i += 1) guestComment(w, postKey, `고리 ${String(i)}`)
    w.fake.pagingOverride = (_op, next) => (next === null ? null : { ...next, after: '2' })
    const before = w.fake.calls('comments').length
    await tick(w, 10_000)
    // 고리: 빠른 읽기 2쪽에서 끝(닿지 못함 — 기록 0) → 같은 차례 전체 읽기 2쪽(끝까지 되지 않음) → 빠른 읽기 한 번 더 2쪽 (D-BND1-16)
    expect(w.fake.calls('comments').slice(before).map((call) => call.query['sort'])).toEqual(['-created_at', '-created_at', '+created_at', '+created_at', '-created_at', '-created_at'])
    expect(w.logs.some((log) => log.code === 'BAND_PAGING_LOOP')).toBe(true)
    expect(w.logs.some((log) => log.code === 'BAND_FAST_UNREACHED')).toBe(true)
    expect((await chats(w, seller.sellerId)).filter((chat) => chat.text.startsWith('고리'))).toEqual([])
    // 객체가 아님 → 마지막 쪽
    w.fake.pagingOverride = (_op, next) => (next === null ? null : 'after=4')
    const before2 = w.fake.calls('comments').length
    // 고리로 닿지 못한 차례(막다른 경우) 뒤에는 60초 간격 (D-BND1-23 (가))
    await tick(w, 59_000)
    expect(w.fake.calls('comments').length - before2).toBe(0)
    await tick(w, 1_000)
    expect(w.fake.calls('comments').length - before2).toBe(1)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING' })
  })
})

describe('AC-BND1-33 기록 = 골든 규칙 + 수집 경로', () => {
  it('한 묶음은 작성 시각 오름차순(같으면 읽은 차례)으로 seq — 조치자 수집기, 다른 기록과 seq가 겹치지 않는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const t = w.bclock.now()
    guestComment(w, postKey, 'A', { createdAt: t + 1000 })
    guestComment(w, postKey, 'B', { createdAt: t + 3000 })
    guestComment(w, postKey, 'C', { createdAt: t + 2000 })
    guestComment(w, postKey, 'D', { createdAt: t + 3000 })
    await tick(w, 10_000)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['A', 'C', 'B', 'D'])
    // 다음 읽기에서 찾은 이른 시각 댓글은 뒤 (접수순)
    expect((await writeEvent(w, seller, { type: 'product.register', b, no: 1, name: '핑크', price: 10_000, stock: 1, status: 'OPEN' })).status).toBe(200)
    guestComment(w, postKey, 'E', { createdAt: t })
    await tick(w, 10_000)
    const rows = await sql<{ seq: number; type: string; actor: string }>(w, `select seq, type, actor from events where seller_id = $1 order by seq`, [seller.sellerId])
    expect(new Set(rows.map((row) => row.seq)).size).toBe(rows.length)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toEqual(['A', 'C', 'B', 'D', 'E'])
    expect(rows.filter((row) => row.type === 'chat').every((row) => row.actor === 'collector')).toBe(true)
  })

  it('엔진: 밴드 chat은 같은 판정 — 1번 1등 = band:UKEY_A, 같은 이름 다른 user_key = 다른 구매자, ig: 구매자와 합치기', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    expect((await writeEvent(w, seller, { type: 'product.register', b, no: 1, name: '핑크', price: 10_000, stock: 2, status: 'OPEN' })).status).toBe(200)
    guestComment(w, postKey, '1번', { userKey: 'UKEY_A', name: '김다육' })
    guestComment(w, postKey, '1번', { userKey: 'UKEY_B', name: '김다육' })
    await tick(w, 10_000)
    const day = (await client(w, seller.cookie).get(`/api/days/${DATE}`)).body
    const buyers = (day.buyers as { id: string }[]).map((buyer) => buyer.id)
    expect(buyers).toEqual(expect.arrayContaining(['band:UKEY_A', 'band:UKEY_B']))
    // 승자를 단언한다 (이름만이 아니라): 1등 = 먼저 단 A, 2등 = 같은 이름 다른 user_key인 B
    const product = (day.products as { key: string; winners: string[] }[]).find((item) => item.key === `${b}/1`)
    expect(product?.winners).toEqual(['band:UKEY_A', 'band:UKEY_B'])
    const ig = await recordPlatformChats(w.server.writer, { sellerId: seller.sellerId, date: DATE, b, chats: [{ id: 'ig:c1', ch: 'ig:IG_A', nick: '인스타 손님', text: '1번', owner: false }], guard: async () => true })
    expect(ig.kind).toBe('ok')
    expect((await writeEvent(w, seller, { type: 'buyer.merge', from: 'ig:IG_A', into: 'band:UKEY_A', reason: '같은 사람' }, DATE)).status).toBe(200)
  })
})

describe('AC-BND1-34 같은 댓글 두 번 넣지 않기', () => {
  it('본 댓글 표에 적기 전에 멈춰도(적기 실패) 다시 읽을 때 메시지 ID 중복 거르기가 막는다 — chat 하나, seq 그대로', async () => {
    let fail = true
    const w = await world({
      hooks: {
        beforeSeen: () => {
          if (fail) {
            fail = false
            throw new Error('적기 실패 주입')
          }
        },
      },
    })
    const { seller, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    const events = await eventCount(w, seller.sellerId)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'RETRYING' })
    await tick(w, 10_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    expect(await eventCount(w, seller.sellerId)).toBe(events)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING' })
    // 빠른 읽기와 전체 읽기가 같은 댓글을 보아도 하나
    await tick(w, 60_000)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
  })

  it('한 글을 b1에 이었다가 끝내고 b2에 다시 이으면 b1 때 본 댓글은 b2 기준선', async () => {
    const w = await world()
    const { seller, bandKey, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })).status).toBe(200)
    const b2 = await realBroadcast(w, seller)
    const linked = await linkBand(w, seller, b2, bandKey, postKey)
    expect(linked.body.link).toMatchObject({ baseline: 1 })
    await tick(w, 70_000)
    expect((await chats(w, seller.sellerId)).filter((chat) => chat.b === b2)).toEqual([])
  })
})

describe('AC-BND1-35 넣지 못한 댓글 수', () => {
  it('사유별 수와 문장 (원문 없음) — 판매자 댓글·빈 글은 문장 없이 수만', async () => {
    const w = await world()
    const { seller, userKey, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번 마감', { userKey })
    guestComment(w, postKey, '2번', { userKey: null })
    guestComment(w, postKey, '3번', { userKey: null })
    guestComment(w, postKey, '가'.repeat(501))
    guestComment(w, postKey, '   ')
    w.fake.addComment(postKey, { content: '시각 없음', userKey: 'G1', createdAt: 'x' })
    w.fake.addComment(postKey, { content: '키 없음', userKey: 'G2', commentKey: null })
    guestComment(w, postKey, '4번')
    await tick(w, 10_000)
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({
      received: 1,
      baseline: 0,
      skipped: { SELLER: 1, NO_AUTHOR: 2, TEXT_TOO_LONG: 1, NO_TEXT: 1, BAD_TIME: 1, DUPLICATE: 0 },
      skipMessages: ['작성자를 알 수 없는 밴드 댓글 2개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.', '너무 긴 밴드 댓글 1개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.'],
    })
    expect(view.lastReadAt).toBe(new Date(w.bclock.now()).toISOString())
    // 다시 읽어도 늘지 않는다 · 키 없는 항목은 전체 읽기마다 "지금 읽은 목록에 있는 수"
    await tick(w, 60_000)
    const again = await bandView(w, seller, b)
    expect(again.skipped).toMatchObject({ SELLER: 1, NO_AUTHOR: 2, BAD_COMMENT_KEY: 1 })
    expect(JSON.stringify(again)).not.toContain('1번 마감')
  })
})

describe('AC-BND1-36 많은 댓글', () => {
  it('기준선 999개는 받고 1,001개는 TOO_MANY_COMMENTS · 이은 뒤 900개를 30개씩: chat 900, 빠짐·두 번 0, 묶음 안 seq = 작성 시각 순', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const t = w.bclock.now()
    for (let i = 0; i < 999; i += 1) w.fake.addComment(postKey, { content: '예전', userKey: 'OLD', createdAt: t - 10_000_000 + i })
    const b = await realBroadcast(w, seller)
    const linked = await linkBand(w, seller, b, bandKey, postKey)
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body.link).toMatchObject({ baseline: 999 })
    for (let round = 0; round < 30; round += 1) {
      const start = w.bclock.now()
      // 묶음 안 차례를 섞는다 (작성 시각이 뒤죽박죽으로 달림)
      for (let i = 0; i < 30; i += 1) guestComment(w, postKey, `${String(round)}-${String(i)}`, { createdAt: start + ((i * 7) % 30) })
      await tick(w, 10_000)
    }
    const recorded = await chats(w, seller.sellerId)
    expect(recorded).toHaveLength(900)
    expect(new Set(recorded.map((chat) => chat.id)).size).toBe(900)
    for (let round = 0; round < 30; round += 1) {
      const batch = recorded.filter((chat) => chat.text.startsWith(`${String(round)}-`))
      const order = batch.map((chat) => (Number(chat.text.split('-')[1]) * 7) % 30)
      expect(order).toEqual([...order].sort((x, y) => x - y))
    }
  })
})

describe('AC-BND1-37 판매자 격리', () => {
  it('각자의 토큰으로만 부르고, A의 댓글은 A의 회차에만. A의 토큰이 풀려도 B는 그대로', async () => {
    const w = await world()
    const a = await opened(w)
    const bShop = await bandSeller(w, { name: '두 번째 가게' })
    const bPost = w.fake.addPost({ bandKey: bShop.bandKey, authorUserKey: bShop.userKey })
    const bb = await realBroadcast(w, bShop.seller)
    expect((await linkBand(w, bShop.seller, bb, bShop.bandKey, bPost)).status).toBe(200)
    guestComment(w, a.postKey, 'A 손님')
    guestComment(w, bPost, 'B 손님')
    await tick(w, 10_000)
    expect((await chats(w, a.seller.sellerId)).map((chat) => chat.text)).toEqual(['A 손님'])
    expect((await chats(w, bShop.seller.sellerId)).map((chat) => chat.text)).toEqual(['B 손님'])
    for (const call of w.fake.callsOfUser(a.userKey)) if (call.op === 'comments') expect(call.query['post_key']).toBe(a.postKey)
    for (const call of w.fake.callsOfUser(bShop.userKey)) if (call.op === 'comments') expect(call.query['post_key']).toBe(bPost)
    w.fake.revoke(a.userKey)
    guestComment(w, bPost, 'B 손님 2')
    await tick(w, 10_000)
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'RECONNECT_NEEDED' })
    expect(await bandView(w, bShop.seller, bb)).toMatchObject({ state: 'READING' })
    expect((await chats(w, bShop.seller.sellerId)).map((chat) => chat.text)).toEqual(['B 손님', 'B 손님 2'])
  })
})
