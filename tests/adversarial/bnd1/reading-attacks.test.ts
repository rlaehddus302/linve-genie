// BND1 적대 시험 (test-domain): 밴드 글 댓글 읽기·기록·알림을 서버 경로로 공격한다 — 가짜 밴드 서버(127.0.0.1)·주입한 시계.
// - 접두어·휴대폰 번호 모양 user_key·판매자와 대소문자만 다른 손님 → 늘 band: 구매자, 합치기 막히지 않음 (D-BND1-02·05, D-079)
// - 한 묶음 안 시각이 뒤섞인 50개 → seq = 작성 시각 순, 다음 읽기에서 찾은 이른 댓글은 뒤(1등 그대로) (D-BND1-06)
// - 쪽 경계에 같은 댓글 키 두 번 → chat 하나·DUPLICATE 1 (늘지 않음) (D-BND1-07)
// - 같은 댓글을 여러 번 고침(A→B→C→B) → 고친 글마다 알림 하나 (AC-BND1-40 "같은 고친 글이 다시 보여도 다시 알리지 않음")
// - 쪽 넘기기가 끝나지 않는 응답(빈 쪽 + 늘 새 after) → 읽기가 끝나야 한다 (AC-BND1-32·D-BND1-08)
// - 끊고 바로 다른 회차에 이을 때 늦은 읽기와 겹침 (AC-BND1-30 "한 판매자의 읽기는 겹치지 않는다")
import { afterEach, describe, expect, it } from 'vitest'
import '../../../apps/server/test/setup-band-guard.ts'
import { BAND_TIMING } from '../../../apps/server/src/band/service.ts'
import { client, rid, writeEvent, type Seller } from '../../../apps/server/test/support.ts'
import { DATE, bandSeller, bandView, bandWorld, chats, guestComment, linkBand, realBroadcast, tick, unlinkBand, type BandWorld } from '../../../apps/server/test/band-support.ts'

const worlds: BandWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  const w = await bandWorld(options)
  worlds.push(w)
  return w
}

async function opened(w: BandWorld, options: { readonly userKey?: string } = {}) {
  const shop = await bandSeller(w, options.userKey === undefined ? {} : { userKey: options.userKey })
  const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey, content: '공구 글' })
  const b = await realBroadcast(w, shop.seller)
  const linked = await linkBand(w, shop.seller, b, shop.bandKey, postKey)
  expect(linked.status, linked.text).toBe(200)
  return { ...shop, postKey, b }
}

type Notices = { items: { id: number; kind: string; message: string; seen: boolean }[]; total: number }
const noticesOf = async (w: BandWorld, seller: Seller, b: string): Promise<Notices> => (await bandView(w, seller, b)).notices as Notices
const fullRead = (w: BandWorld) => tick(w, BAND_TIMING.fullMs)
const day = async (w: BandWorld, seller: Seller) => (await client(w, seller.cookie).get(`/api/days/${DATE}`)).body as Record<string, unknown>
const register = async (w: BandWorld, seller: Seller, b: string, no: number, stock = 1) =>
  expect((await writeEvent(w, seller, { type: 'product.register', b, no, name: `상품${String(no)}`, price: 10_000, stock, status: 'OPEN' })).status).toBe(200)

/** 그 상품의 찜 차례 (구매자 키) — 날짜 보기의 claims에서 */
function claimOrder(body: Record<string, unknown>, no: number): string[] {
  const claims = (body['claims'] ?? []) as { no: number; buyer: string; status?: string; rank?: number }[]
  return claims.filter((claim) => claim.no === no).map((claim) => claim.buyer)
}

describe('TD-BND1 접두어·판매자 판단 — 서버 경로', () => {
  it('휴대폰 번호 모양·ig:·sms: 모양 user_key는 band: 구매자로 기록되고 찜이 되며, 판매자가 합치기·취소로 다룰 수 있다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    await register(w, seller, b, 1, 3)
    guestComment(w, postKey, '1번', { userKey: '01012345678', name: '폰번호' })
    guestComment(w, postKey, '1번', { userKey: 'ig:IG_A', name: '인스타같음' })
    guestComment(w, postKey, '1번', { userKey: 'sms:s1', name: '문자같음' })
    await tick(w, 10_000)
    const rows = await chats(w, seller.sellerId)
    expect(rows.map((row) => row.ch)).toEqual(['band:01012345678', 'band:ig:IG_A', 'band:sms:s1'])
    const body = await day(w, seller)
    expect(JSON.stringify(body)).toContain('band:01012345678')
    // D-079: 휴대폰 번호 모양 ID 검사에 걸리지 않는다 — 판매자가 그 구매자를 합칠 수 있다
    const merged = await writeEvent(w, seller, { type: 'buyer.merge', from: 'band:01012345678', into: 'band:ig:IG_A', reason: '같은 사람' }, DATE)
    expect(merged.status, merged.text).toBe(200)
    expect((await bandView(w, seller, b)).received).toBe(3)
  })

  it('판매자 user_key와 대소문자만 다른 손님 댓글은 판매자 댓글이 아니다 (찜이 된다)', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w, { userKey: 'ShopOwner01' })
    await register(w, seller, b, 1)
    guestComment(w, postKey, '1번 마감', { userKey: 'ShopOwner01', name: '다육가게' })
    guestComment(w, postKey, '1번', { userKey: 'shopowner01', name: '다육가게' })
    await tick(w, 10_000)
    expect((await chats(w, seller.sellerId)).map((row) => row.ch)).toEqual(['band:shopowner01'])
    expect((await bandView(w, seller, b)).skipped).toMatchObject({ SELLER: 1 })
  })
})

describe('TD-BND1 순서 — 묶음 안 작성 시각 순, 다음 읽기는 뒤', () => {
  it('시각이 뒤섞인 50개가 한 번에 → seq = 작성 시각 순(같으면 단 차례). 다음 읽기의 이른 댓글은 뒤, 1등 그대로', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    await register(w, seller, b, 1)
    const t = w.bclock.now() - 60_000
    const offsets = Array.from({ length: 50 }, (_, i) => (i * 17) % 13)
    offsets.forEach((s, i) => guestComment(w, postKey, i === 0 ? '1번' : `잡담 ${String(i)}`, { userKey: `G${String(i)}`, createdAt: t + 10_000 + s * 1000 }))
    await tick(w, 10_000)
    const rows = await chats(w, seller.sellerId)
    expect(rows).toHaveLength(50)
    const expected = offsets.map((s, i) => ({ i, at: s })).sort((x, y) => x.at - y.at || x.i - y.i).map((entry) => `band:G${String(entry.i)}`)
    expect(rows.map((row) => row.ch)).toEqual(expected)
    for (let i = 1; i < rows.length; i += 1) expect((rows[i] as { seq: number }).seq).toBeGreaterThan((rows[i - 1] as { seq: number }).seq)
    const winner = claimOrder(await day(w, seller), 1)[0]
    expect(winner).toBe('band:G0')
    // 다음 읽기에서 찾은 더 이른 시각의 "1번" — 접수순이라 뒤
    guestComment(w, postKey, '1번', { userKey: 'EARLY', createdAt: t })
    await tick(w, 10_000)
    expect(claimOrder(await day(w, seller), 1)).toEqual(['band:G0', 'band:EARLY'])
  })
})

describe('TD-BND1 두 번 넣지 않기 — 쪽 경계', () => {
  it('같은 댓글 키가 두 쪽에 걸쳐 두 번 오면 chat 하나, DUPLICATE 1 — 다음 읽기들에서 늘지 않는다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    w.fake.pageSize = 5
    for (let i = 0; i < 4; i += 1) guestComment(w, postKey, `${String(i)}번`)
    w.fake.addComment(postKey, { commentKey: 'DUPKEY', content: '9번', userKey: 'GD', name: '겹침' })
    w.fake.addComment(postKey, { commentKey: 'DUPKEY', content: '9번', userKey: 'GD', name: '겹침' })
    for (let i = 0; i < 3; i += 1) guestComment(w, postKey, `${String(10 + i)}번`)
    await tick(w, 10_000)
    await fullRead(w)
    await fullRead(w)
    const rows = await chats(w, seller.sellerId)
    expect(rows.filter((row) => row.id.endsWith(':DUPKEY'))).toHaveLength(1)
    expect(rows).toHaveLength(8)
    expect((await bandView(w, seller, b)).skipped).toMatchObject({ DUPLICATE: 1 })
  })
})

describe('TD-BND1 고친 댓글 — 같은 고친 글이 다시 보여도 다시 알리지 않는다 (AC-BND1-40)', () => {
  it('TD-BND1-001: A→B→C→B로 고치면 고친 글 B·C 알림 둘 — B가 다시 보여도 세 번째 알림이 없다', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    const key = guestComment(w, postKey, '1번 주세요', { name: '김다육' })
    await tick(w, 10_000)
    w.fake.editComment(postKey, key, '2번으로 바꿀게요')
    await fullRead(w)
    w.fake.editComment(postKey, key, '3번이요')
    await fullRead(w)
    w.fake.editComment(postKey, key, '2번으로 바꿀게요')
    await fullRead(w)
    const notices = await noticesOf(w, seller, b)
    expect(notices.items.filter((item) => item.kind === 'EDITED').map((item) => item.message)).toEqual([
      "밴드에서 고친 댓글이에요 — 김다육: '1번 주세요' → '3번이요'. 찜은 처음 글대로예요.",
      "밴드에서 고친 댓글이에요 — 김다육: '1번 주세요' → '2번으로 바꿀게요'. 찜은 처음 글대로예요.",
    ])
  })

  it('지웠다 다시 보이고 다시 지워도 지운 알림은 하나 · 찜·채팅 수 그대로', async () => {
    const w = await world()
    const { seller, postKey, b } = await opened(w)
    await register(w, seller, b, 1)
    const key = guestComment(w, postKey, '1번', { userKey: 'GA', name: '김다육' })
    await tick(w, 10_000)
    const before = claimOrder(await day(w, seller), 1)
    for (let i = 0; i < 3; i += 1) {
      w.fake.dropComment(postKey, key)
      await fullRead(w)
      w.fake.addComment(postKey, { commentKey: key, content: '1번', userKey: 'GA', name: '김다육' })
      await fullRead(w)
    }
    const notices = await noticesOf(w, seller, b)
    expect(notices.items.filter((item) => item.kind === 'DELETED')).toHaveLength(1)
    expect(notices.total).toBe(1)
    expect(claimOrder(await day(w, seller), 1)).toEqual(before)
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
  })
})

describe('TD-BND1 쪽 넘기기가 끝나지 않는 응답', () => {
  it('TD-BND1-002: 빈 쪽과 늘 새 after를 주는 응답에도 잇기(기준선 읽기)는 끝나고, 밴드로 보내는 요청 수에 상한이 있다', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    const b = await realBroadcast(w, shop.seller)
    let n = 100
    // 쪽은 비어 있고(after가 목록 밖) next_params의 after는 늘 새 값 — 같은 after 고리 검사에 걸리지 않는다
    w.fake.pagingOverride = (op, next) => (op === 'comments' ? { ...(next ?? {}), after: String((n += 1)) } : next)
    const pending = linkBand(w, shop.seller, b, shop.bandKey, postKey)
    const settled = await Promise.race([pending.then(() => 'done' as const), new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 4_000))])
    const calls = w.fake.calls('comments').length
    w.fake.pagingOverride = (_op, _next) => null
    await pending.catch(() => undefined)
    expect(settled).toBe('done')
    // 1,000개 상한이 있는 읽기라면 쪽 수도 그만큼에서 끝나야 한다 (쪽 크기 20 → 50쪽, 넉넉히 100)
    expect(calls).toBeLessThanOrEqual(100)
  }, 30_000)
})

describe('TD-BND1 끊고 바로 다른 회차에 잇기 — 읽기 겹침', () => {
  it('TD-BND1-003: 늦어진 읽기가 끝나기 전에 끊고 다른 회차에 이어도 그 판매자 토큰의 동시 요청은 1', async () => {
    const w = await world()
    const { seller, userKey, bandKey, postKey, b } = await opened(w)
    guestComment(w, postKey, '1번')
    // 다음 빠른 읽기의 답이 오지 않는다 (밴드가 늦음) — 그 요청이 밴드에 닿을 때까지 기다린다
    w.fake.fail('comments', 'HANG')
    const before = w.fake.calls('comments').length
    w.bclock.fire(10_000)
    for (let i = 0; i < 200 && w.fake.calls('comments').length === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(w.fake.calls('comments').length).toBe(before + 1)
    expect((await unlinkBand(w, seller, b)).status).toBe(200)
    const other = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b2 = await realBroadcast(w, seller)
    const linked = await linkBand(w, seller, b2, bandKey, other)
    w.fake.releaseHanging()
    await w.server.band.idle()
    expect(linked.status, linked.text).toBe(200)
    for (const token of new Set(w.fake.callsOfUser(userKey).map((call) => call.token))) expect(w.fake.maxInflight.get(token as string) ?? 0).toBeLessThanOrEqual(1)
  }, 30_000)
})

describe('TD-BND1 잇기 동시 — 다른 회차·다른 글', () => {
  it('한 판매자가 두 회차에 동시에 다른 글을 이으면 하나만 이어지고 다른 하나는 BAND_IN_USE', async () => {
    const w = await world()
    const shop = await bandSeller(w)
    const p1 = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    const p2 = w.fake.addPost({ bandKey: shop.bandKey, authorUserKey: shop.userKey })
    const b1 = await realBroadcast(w, shop.seller)
    const b2 = await realBroadcast(w, shop.seller)
    const [r1, r2] = await Promise.all([linkBand(w, shop.seller, b1, shop.bandKey, p1, rid('x')), linkBand(w, shop.seller, b2, shop.bandKey, p2, rid('y'))])
    expect([r1.status, r2.status].sort()).toEqual([200, 409])
    const loser = r1.status === 409 ? r1 : r2
    expect((loser.body.error as { code: string }).code).toBe('BAND_IN_USE')
    const rows = (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from band_links where state <> 'FINISHED'`))?.rows ?? []
    expect(rows[0]?.n).toBe(1)
  })
})
