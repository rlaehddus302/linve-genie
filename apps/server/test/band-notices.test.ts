// 밴드 지운·고친 댓글 알림·실패·다시 시도·호출 한도·늦게 읽음·다시 연결 (BND1, AC-BND1-40·41·50~55).
import { afterEach, describe, expect, it } from 'vitest'
import { BAND_TIMING } from '../src/band/service.ts'
import { client, rid, writeEvent, type Seller } from './support.ts'
import { DATE, bandSeller, bandView, bandWorld, chats, connectBand, guestComment, linkBand, realBroadcast, tick, unlinkBand, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

async function opened(w: BandWorld, options: { readonly seller?: Seller; readonly name?: string } = {}) {
  const shop = await bandSeller(w, { ...(options.seller === undefined ? {} : { seller: options.seller }), ...(options.name === undefined ? {} : { name: options.name }) })
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

type Notices = { items: { id: number; kind: string; message: string; seen: boolean }[]; total: number; seenUpTo: number; unseen: number; unseenEdits: number }
const noticesOf = async (w: BandWorld, seller: Seller, b: string): Promise<Notices> => (await bandView(w, seller, b)).notices as Notices
/** 다음 전체 읽기까지 (60초 차례) */
const fullRead = (w: BandWorld) => tick(w, BAND_TIMING.fullMs)

describe('AC-BND1-40 지운 댓글·고친 댓글 — 끝까지 읽은 목록에서만', () => {
  it('기록한 댓글이 없으면 지운 댓글 하나, 본문이 다르면 고친 댓글 (새 본문마다 하나) — 찜은 그대로', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    expect((await writeEvent(w, seller, { type: 'product.register', b, no: 1, name: '핑크', price: 10_000, stock: 2, status: 'OPEN' })).status).toBe(200)
    const a = guestComment(w, postKey, '1번 주세요', { name: '김다육' })
    const c = guestComment(w, postKey, `1번 ${'가'.repeat(70)}`, { name: '이선인' })
    await tick(w, 10_000)
    const before = (await client(w, seller.cookie).get(`/api/days/${DATE}`)).body
    w.fake.dropComment(postKey, a)
    w.fake.editComment(postKey, c, '2번으로 바꿀게요')
    // 빠른 읽기에서는 보지 않는다
    await tick(w, 10_000)
    expect((await noticesOf(w, seller, b)).total).toBe(0)
    await fullRead(w)
    const notices = await noticesOf(w, seller, b)
    expect(notices.items.map((item) => item.message).sort()).toEqual(
      [
        "밴드에서 지운 댓글이에요 — 김다육: '1번 주세요'. 찜은 그대로예요. 취소하려면 찜에서 직접 취소해 주세요.",
        `밴드에서 고친 댓글이에요 — 이선인: '1번 ${'가'.repeat(57)}…' → '2번으로 바꿀게요'. 찜은 처음 글대로예요.`,
      ].sort(),
    )
    expect(notices).toMatchObject({ total: 2, unseen: 2, unseenEdits: 2, seenUpTo: 0 })
    // 엔진에는 아무 이벤트도 없다 — 찜·정산 그대로
    const after = (await client(w, seller.cookie).get(`/api/days/${DATE}`)).body
    expect(after.products).toEqual(before.products)
    expect(after.settlements).toEqual(before.settlements)
    // 같은 고친 글이 다시 보여도 · 지운 댓글이 다시 보여도 아무 일도 없다
    await fullRead(w)
    expect((await noticesOf(w, seller, b)).total).toBe(2)
    w.fake.addComment(postKey, { commentKey: a, content: '1번 주세요', userKey: 'X', name: '김다육' })
    await fullRead(w)
    expect((await noticesOf(w, seller, b)).total).toBe(2)
    // 또 고치면 새 알림
    w.fake.editComment(postKey, c, '3번이요')
    await fullRead(w)
    expect((await noticesOf(w, seller, b)).items[0]?.message).toBe("밴드에서 고친 댓글이에요 — 이선인: '1번 " + '가'.repeat(57) + "…' → '3번이요'. 찜은 처음 글대로예요.")
    expect(await chats(w, seller.sellerId)).toHaveLength(2)
    expect(w.published.some((item) => item.data['kind'] === 'LINK')).toBe(true)
  })

  it('기준선·건너뛴 댓글은 보지 않는다 · 쪽 중간 실패·1,000개에서 멈춘 읽기에서는 보지 않는다', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const old = guestComment(w, postKey, '예전 댓글')
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const mine = guestComment(w, postKey, '마감이에요', { userKey })
    const kept = guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    w.fake.dropComment(postKey, old)
    w.fake.dropComment(postKey, mine)
    await fullRead(w)
    expect((await noticesOf(w, seller, b)).total).toBe(0)
    // 쪽 중간 실패: 쪽 크기 1, 전체 읽기의 두 번째 쪽에서 실패
    w.fake.pageSize = 1
    w.fake.dropComment(postKey, kept)
    guestComment(w, postKey, '2번')
    guestComment(w, postKey, '3번')
    await tick(w, 10_000 * 4)
    const sinceFull = BAND_TIMING.fullMs - 10_000 * 4
    w.fake.fail('comments', { http: 500 }, 1, 1)
    await tick(w, sinceFull + 10_000)
    expect((await noticesOf(w, seller, b)).total).toBe(0)
  })

  it('1,000개에서 멈춘 전체 읽기: 지운 댓글을 보지 않는다 (그 뒤 새 댓글은 같은 차례에 빠른 읽기로)', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    for (let i = 0; i < 990; i += 1) w.fake.addComment(postKey, { content: '예전', userKey: 'OLD', createdAt: i + 1 })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    const first = guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    for (let i = 0; i < 20; i += 1) guestComment(w, postKey, `${String(i)}번 더`)
    await tick(w, 10_000)
    w.fake.dropComment(postKey, first)
    guestComment(w, postKey, '마지막')
    await tick(w, BAND_TIMING.fullMs)
    expect((await noticesOf(w, seller, b)).total).toBe(0)
    expect((await chats(w, seller.sellerId)).map((chat) => chat.text)).toContain('마지막')
  })
})

describe('AC-BND1-41 알림 쌓기·확인', () => {
  it('최근 20개(새것 위)·전체 수·확인한 수 — upTo까지 확인, 그 뒤 생긴 알림은 꺼지지 않는다, 같은 upTo 두 번 = 같다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const keys = Array.from({ length: 22 }, (_, i) => guestComment(w, postKey, `${String(i)}번`))
    await tick(w, 10_000)
    for (const key of keys) w.fake.dropComment(postKey, key)
    await fullRead(w)
    const notices = await noticesOf(w, seller, b)
    expect(notices.items).toHaveLength(20)
    expect(notices.total).toBe(22)
    const ids = notices.items.map((item) => item.id)
    expect(ids).toEqual([...ids].sort((x, y) => y - x))
    const upTo = ids[5] as number
    const api = client(w, seller.cookie)
    const seen = await api.post(`/api/broadcasts/${b}/band/notices-seen`, { upTo })
    expect(seen.status, seen.text).toBe(200)
    expect((seen.body.link as { notices: Notices }).notices).toMatchObject({ seenUpTo: upTo, unseen: 5, unseenEdits: 5 })
    expect(await api.post(`/api/broadcasts/${b}/band/notices-seen`, { upTo })).toMatchObject({ status: 200, body: seen.body })
    expect((await api.post(`/api/broadcasts/${b}/band/notices-seen`, { upTo: 1 })).body.link).toMatchObject({ notices: { seenUpTo: upTo } })
    const bad = await api.post(`/api/broadcasts/${b}/band/notices-seen`, { upTo: -1 })
    expect(bad.status).toBe(400)
    const all = await api.post(`/api/broadcasts/${b}/band/notices-seen`, { upTo: Number.MAX_SAFE_INTEGER })
    expect((all.body.link as { notices: Notices }).notices).toMatchObject({ seenUpTo: ids[0], unseen: 0 })
    expect((all.body.link as { notices: Notices }).notices.items.every((item) => item.seen)).toBe(true)
  })

  it('보관 기간이 지나면 알림의 손님 글을 지운다 — 문장이 바뀐다(닉네임·글 없음)', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const key = guestComment(w, postKey, 'PLANTED-BAND-TEXT-15', { name: 'PLANTED-BAND-NICK' })
    await tick(w, 10_000)
    w.fake.dropComment(postKey, key)
    await fullRead(w)
    expect((await noticesOf(w, seller, b)).items[0]?.message).toContain('PLANTED-BAND-NICK')
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b}/band/unlink`, { requestId: rid('u') })).status).toBe(200)
    w.bclock.jump(31 * 24 * 60 * 60 * 1000)
    // 31일 뒤라 로그인 세션은 끝났다 — 서비스로 바로 본다
    expect((await w.server.band.view(seller.sellerId, b))?.notices.items[0]?.message).toBe('밴드에서 지우거나 고친 댓글이 있었어요. 글은 보관 기간이 지나 지웠어요.')
    expect(await w.server.band.eraseOld()).toBe(1)
    const rows = JSON.stringify((await w.database.pglite?.query(`select * from band_notices`))?.rows) + JSON.stringify((await w.database.pglite?.query(`select nick, text from band_seen`))?.rows)
    expect(rows).not.toContain('PLANTED-BAND')
  })
})

describe('AC-BND1-50·51 연결 상태와 실패 나누기', () => {
  it('다시 시도 갈래: 2300·3000·211·212·60000·모르는 코드·HTTP 5xx·JSON 아님·모양 틀림·10초 넘김 → RETRYING, 성공하면 READING', async () => {
    const w = await world({ timeoutMs: 200 })
    const { seller, postKey, b } = await opened(w)
    const faults = [{ resultCode: 2300 }, { resultCode: 3000 }, { resultCode: 211 }, { resultCode: 212 }, { resultCode: 60000 }, { resultCode: 77777 }, { http: 502 }, 'NOT_JSON', 'BAD_SHAPE', 'HANG'] as const
    for (const fault of faults) {
      w.fake.fail('comments', fault)
      await tick(w, 10_000)
      const view = await bandView(w, seller, b)
      expect(view, JSON.stringify(fault)).toMatchObject({ state: 'RETRYING', message: '밴드 댓글을 읽지 못해 다시 시도하고 있어요.', failures: 1 })
      w.fake.releaseHanging()
      guestComment(w, postKey, `${JSON.stringify(fault)} 뒤`)
      await tick(w, 10_000)
      expect(await bandView(w, seller, b), JSON.stringify(fault)).toMatchObject({ state: 'READING', message: '밴드 댓글을 읽고 있어요.', failures: 0, retryAt: null })
    }
    expect(await chats(w, seller.sellerId)).toHaveLength(faults.length)
  })

  it('NO_ACCESS 갈래: 10403·60102·60200·60203·60204 → 그 연결만 멈춤(다시 이어야 함) · 다른 글 잇기', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    for (const code of [10403, 60102, 60200, 60203, 60204]) {
      const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
      const b = await realBroadcast(w, seller)
      expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
      w.fake.fail('comments', { resultCode: code })
      await tick(w, 10_000)
      expect(await bandView(w, seller, b), String(code)).toMatchObject({ state: 'NO_ACCESS', message: '이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.' })
      const before = w.fake.calls('comments').length
      await tick(w, 120_000)
      expect(w.fake.calls('comments').length).toBe(before)
      expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'CONNECTED' })
      // 다른 글 잇기 = 끊고 다시 고르기
      expect((await unlinkBand(w, seller, b)).status).toBe(200)
    }
  })

  it('RECONNECT_NEEDED 갈래: 10401 → 그 판매자의 밴드 읽기 모두 멈춤·계정 상태도', async () => {
    const w = await world()
    const { seller, b } = await opened(w)
    w.fake.fail('comments', { resultCode: 10401 })
    await tick(w, 10_000)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'RECONNECT_NEEDED', message: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.' })
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'RECONNECT_NEEDED' })
  })
})

describe('AC-BND1-52 다시 시도 시간표', () => {
  it('첫 실패 뒤 10·20·40·80·160초, 그 뒤 300초마다 · 한 번 성공하면 처음으로', async () => {
    const w = await world()
    const { seller, b } = await opened(w)
    w.fake.fail('comments', { http: 500 }, 8)
    const waits: number[] = []
    let at = w.bclock.now() + 10_000
    for (let i = 0; i < 8; i += 1) {
      await w.bclock.advance(at - w.bclock.now())
      const view = await bandView(w, seller, b)
      expect(view.state).toBe('RETRYING')
      const retryAt = Date.parse(view.retryAt as string)
      waits.push(retryAt - w.bclock.now())
      at = retryAt
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000])
    await w.bclock.advance(at - w.bclock.now())
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'READING', failures: 0 })
    w.fake.fail('comments', { http: 500 })
    await tick(w, 10_000)
    const view = await bandView(w, seller, b)
    expect(Date.parse(view.retryAt as string) - w.bclock.now()).toBe(10_000)
  })
})

describe('AC-BND1-53 호출 한도', () => {
  it('1002·1003: 그 판매자만 30초부터 두 배씩 300초까지 — 문장의 N = 남은 초', async () => {
    const w = await world()
    const { seller, b } = await opened(w)
    w.fake.fail('comments', { resultCode: 1002 }, 3)
    w.fake.fail('comments', { resultCode: 1003 }, 3)
    const waits: number[] = []
    let at = w.bclock.now() + 10_000
    for (let i = 0; i < 6; i += 1) {
      await w.bclock.advance(at - w.bclock.now())
      const view = await bandView(w, seller, b)
      const retryAt = Date.parse(view.retryAt as string)
      waits.push(retryAt - w.bclock.now())
      expect(view).toMatchObject({ state: 'RETRYING', rateLimited: true, message: `밴드가 잠시 쉬어 달라고 해서 ${String((retryAt - w.bclock.now()) / 1000)}초 뒤에 다시 읽어요.` })
      at = retryAt
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
    w.bclock.jump(1500)
    expect((await bandView(w, seller, b)).message).toBe('밴드가 잠시 쉬어 달라고 해서 299초 뒤에 다시 읽어요.')
  })

  it('1001: 서버의 모든 판매자 밴드 읽기를 60초부터 두 배씩 함께 쉰다 — 쉬는 동안 밴드로 나가는 요청 0, 성공하면 처음으로', async () => {
    const w = await world()
    const a = await opened(w)
    const b2 = await opened(w, { name: '둘째 가게' })
    w.fake.fail('comments', { resultCode: 1001 })
    await tick(w, 10_000)
    const requests = w.fake.requests.length
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'RETRYING', rateLimited: true })
    expect(await bandView(w, b2.seller, b2.b)).toMatchObject({ state: 'RETRYING', rateLimited: true })
    expect((await client(w, a.seller.cookie).get('/api/band/bands')).status).toBe(503)
    await tick(w, 59_000)
    expect(w.fake.requests.length).toBe(requests)
    await tick(w, 1_000)
    expect(w.fake.requests.length).toBeGreaterThan(requests)
    expect(await bandView(w, a.seller, a.b)).toMatchObject({ state: 'READING' })
    expect(await bandView(w, b2.seller, b2.b)).toMatchObject({ state: 'READING' })
    // 성공했으니 다음 1001은 다시 60초
    w.fake.fail('comments', { resultCode: 1001 })
    await tick(w, 10_000)
    const status = (await w.server.band.opsStatus()) as { appPause: { remainingSeconds: number } }
    expect(status.appPause.remainingSeconds).toBe(60)
  })
})

describe('AC-BND1-54 오래 못 읽다가 다시 읽음', () => {
  it('60초 넘게 실패하다가 새 댓글 N개를 넣으면 알림, N = 0이면 없다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    // 10초에 마지막 성공 → 실패 다섯 번(10·20·40·80초)
    await tick(w, 10_000)
    w.fake.fail('comments', { http: 500 }, 4)
    await tick(w, 10_000 + 10_000 + 20_000 + 40_000)
    expect((await bandView(w, seller, b)).state).toBe('RETRYING')
    await tick(w, 80_000)
    expect((await noticesOf(w, seller, b)).total).toBe(0)
    w.fake.fail('comments', { http: 500 }, 3)
    await tick(w, 10_000 + 10_000 + 20_000)
    guestComment(w, postKey, '1번')
    guestComment(w, postKey, '2번')
    await tick(w, 40_000)
    expect((await noticesOf(w, seller, b)).items.map((item) => item.message)).toEqual(['밴드 댓글을 2분 동안 읽지 못했어요. 그 사이 달린 댓글 2개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.'])
  })
})

describe('AC-BND1-55 토큰 만료 → 다시 연결 → 이어 읽기', () => {
  it('10401 → RECONNECT_NEEDED, 그 뒤 요청 0 → 댓글 3개 → 같은 user_key로 다시 연결 → READING, 새 댓글 3개(기준선 아님)·늦게 읽음 알림', async () => {
    const w = await world()
    const { seller, userKey, postKey, b } = await opened(w)
    w.fake.revoke(userKey)
    await tick(w, 10_000)
    expect(await bandView(w, seller, b)).toMatchObject({ state: 'RECONNECT_NEEDED' })
    const before = w.fake.requests.length
    for (const text of ['1번', '2번', '3번']) guestComment(w, postKey, text)
    await tick(w, 120_000)
    expect(w.fake.requests.length).toBe(before)
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await connectBand(w, seller)).toBe('connected')
    await tick(w, 0)
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({ state: 'READING', received: 3, baseline: 0 })
    expect((view.notices as Notices).items[0]?.message).toBe('밴드 댓글을 3분 동안 읽지 못했어요. 그 사이 달린 댓글 3개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.')
  })
})
