// N2 저절로 이은 회차를 같은 계정의 새 라이브로 옮기기 (AC-N2-25·22·24·33, D-N2-16, 수정 라운드 1 RA-N2-001).
// 한 인스타그램 계정은 라이브를 한 번에 하나만 한다 — 이어지지 않은 새 라이브의 늦지 않은 댓글은 옛 라이브가 끝났다는 증거다.
// 가짜 메타 서버(실제 HTTP)·주입한 시계.
import { afterEach, describe, expect, it } from 'vitest'
import { LIVE_MOVED_MESSAGE, liveMovedMessage } from '../src/instagram/notices.ts'
import { chatEvents, connectedShop, connectInstagram, igWorld, linkLive, liveBroadcast, register, sendComments, webhookTarget, type IgWorld } from './instagram-support.ts'
import { client, rid, type Seller } from './support.ts'

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})
async function world(): Promise<IgWorld> {
  ig = await igWorld()
  return ig
}

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 19, h, m, s)

interface LinkBody {
  readonly state: string
  readonly liveId: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string; readonly loginId: string | null } | null
  readonly accountId: string | null
  readonly collection: { readonly state: string; readonly liveId: string | null; readonly comments: number; readonly late: number; readonly malformed: number } | null
}

async function linkOf(w: IgWorld, seller: Seller, b: string): Promise<LinkBody> {
  const response = await client(w, seller.cookie).get(`/api/broadcasts/${b}/live`)
  expect(response.status).toBe(200)
  return response.body.link as LinkBody
}

async function wait(w: IgWorld, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })
  expect(response.status, response.text).toBe(200)
}

async function end(w: IgWorld, seller: Seller, b: string): Promise<void> {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
  expect(response.status, response.text).toBe(200)
}

async function unlinkedOf(w: IgWorld, seller: Seller): Promise<Record<string, number>> {
  const lives = (await client(w, seller.cookie).get('/api/instagram/unlinked')).body.lives as { liveId: string; count: number }[]
  return Object.fromEntries(lives.map((live) => [live.liveId, live.count]))
}

async function moves(w: IgWorld, sellerId: string): Promise<Record<string, unknown>[]> {
  const rows = await w.database.pglite?.query<{ t: string }>(
    `select json_build_object('broadcast', broadcast_id, 'from', from_live_id, 'to', to_live_id, 'account', account_id, 'actor', actor, 'before', comments_before, 'at', moved_at)::text as t from live_link_moves where seller_id = $1 order by id`,
    [sellerId],
  )
  return (rows?.rows ?? []).map((row) => JSON.parse(row.t) as Record<string, unknown>)
}

async function daySeq(w: IgWorld, seller: Seller): Promise<number> {
  return ((await client(w, seller.cookie).get('/api/days/2026-10-19')).body as { seq: number }).seq
}

async function winners(w: IgWorld, seller: Seller, key: string): Promise<string[]> {
  const view = (await client(w, seller.cookie).get('/api/days/2026-10-19')).body as { products: { key: string; winners: string[] }[] }
  return view.products.find((product) => product.key === key)?.winners ?? []
}

/** 판매자의 회차 b를 기다리기로 두고, 라이브 M의 첫 댓글로 저절로 잇는다 (조치자 서버) */
async function autoLinked(w: IgWorld, options: { readonly consent?: boolean } = {}) {
  const shop = await connectedShop(w, { consent: options.consent ?? false })
  const b = await liveBroadcast(w, shop.seller)
  await wait(w, shop.seller, b)
  const m = w.fake.startLive(shop.account.id)
  expect((await sendComments(w, shop.account, m, [{ igsid: '6024400000000009', username: 'hello.viewer', text: '안녕하세요' }])).status).toBe(200)
  expect(await linkOf(w, shop.seller, b)).toMatchObject({ state: 'LINKED', liveId: m, actor: { kind: 'server' } })
  return { ...shop, b, m }
}

describe('AC-N2-25 저절로 이은 회차를 같은 계정의 새 라이브로 옮기기', () => {
  it('따로 켠 두 라이브로 1부·2부: b2가 옛 라이브 M에 저절로 이어진 뒤 새 라이브 M2의 댓글 "15"에서 M2로 옮겨지고 그 댓글부터 b2에 기록, LIVE_MOVED(N = 2), DM 행 그대로, 그 뒤 M의 댓글은 세기만', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w, { consent: true })
    const api = client(w, seller.cookie)
    const b1 = await liveBroadcast(w, seller)
    const b2 = await liveBroadcast(w, seller)
    await register(w, seller, b2, 15, '라울', 5000)
    await register(w, seller, b2, 20, '핑크프릴', 10000)
    w.clock.set(at(11, 0))
    const m = w.fake.startLive(account.id)
    await linkLive(w, seller, b1, m)
    await wait(w, seller, b2)
    await end(w, seller, b1)

    // b1을 끝낸 뒤 M에 남은 인사 댓글 → b2가 M에 저절로 이어진다 (AC-N2-22, 한 라이브로 1부·2부와 같은 동작)
    w.clock.set(at(11, 30))
    await sendComments(w, account, m, [{ id: '8001', igsid: '6024400000000001', username: 'thanks.viewer', text: '감사합니다' }])
    expect(await linkOf(w, seller, b2)).toMatchObject({ state: 'LINKED', liveId: m, actor: { kind: 'server', loginId: null } })
    w.clock.set(at(11, 31))
    await sendComments(w, account, m, [{ id: '8002', igsid: '6024400000000002', username: 'buyer.twenty', text: '20' }])
    expect(await winners(w, seller, `${b2}/20`)).toEqual(['ig:6024400000000002'])
    const dms = async () => ((await api.get('/api/instagram/dms?date=2026-10-19')).body.rows as { comment: string | null; status: string; reason: string | null }[])
    const before = await dms()
    expect(before.map((row) => row.comment)).toEqual(['ig:8002'])

    // 판매자가 M을 끝내고 새 라이브 M2를 켠다 → M2의 첫 댓글 "15"(entry.time = 받은 시각)
    w.fake.endLive(m)
    w.clock.set(at(11, 40))
    const m2 = w.fake.startLive(account.id)
    const seq = await daySeq(w, seller)
    const published = w.published.length
    expect((await sendComments(w, account, m2, [{ id: '8003', igsid: '6024400000000003', username: 'buyer.fifteen', text: '15' }])).status).toBe(200)

    // 옮겨졌다: LINKED·liveId M2·조치자 서버·이은 시각 = 옮긴 시각·같은 계정, 수집 상태 LIVE·M2, 수는 회차 단위로 이어 센다
    expect(await linkOf(w, seller, b2)).toMatchObject({
      state: 'LINKED',
      liveId: m2,
      linkedAt: new Date(at(11, 40)).toISOString(),
      actor: { kind: 'server', loginId: null },
      accountId: account.id,
      collection: { state: 'LIVE', liveId: m2, comments: 3, late: 0, malformed: 0 },
    })
    expect((await chatEvents(w, seller.sellerId)).map((event) => [event.b, event.id])).toEqual([
      [b2, 'ig:8001'],
      [b2, 'ig:8002'],
      [b2, 'ig:8003'],
    ])
    expect(await winners(w, seller, `${b2}/15`)).toEqual(['ig:6024400000000003'])
    // 엔진 이벤트가 아니다 — 범위의 seq는 그 댓글의 chat 하나만 늘어난다
    expect(await daySeq(w, seller)).toBe(seq + 1)
    // 옮긴 기록 (이전 라이브 ID·옮긴 시각·조치자 서버·옮기기 전 기록한 댓글 수)
    expect(await moves(w, seller.sellerId)).toEqual([{ broadcast: b2, from: m, to: m2, account: account.id, actor: 'server', before: 2, at: expect.any(String) }])
    expect(new Date((await moves(w, seller.sellerId))[0]?.at as string).getTime()).toBe(at(11, 40))
    // 알림: 연결 알림과 LIVE_MOVED(N = 2) 한 번
    const after = w.published.slice(published).map((item) => item.data)
    expect(after.filter((data) => data.code === 'LIVE_MOVED')).toEqual([
      {
        kind: 'NOTICE',
        code: 'LIVE_MOVED',
        message: '인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요. 그 전 라이브에서 이 방송에 기록한 댓글 2개를 확인해 주세요.',
        broadcast: b2,
        liveId: m2,
        count: 2,
      },
    ])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(w.published.slice(published).some((item) => item.data.kind === 'LINK' && (item.data.link as { liveId: string }).liveId === m2)).toBe(true)
    expect(after.filter((data) => data.code === 'UNLINKED_COMMENTS')).toEqual([])
    // 옮기기는 끊기가 아니다 — "20" 댓글의 DM 행은 FAILED(NO_LINK)가 아니다
    const rows = await dms()
    expect(rows.find((row) => row.comment === 'ig:8002')).toMatchObject({ comment: 'ig:8002' })
    expect(rows.filter((row) => row.reason === 'NO_LINK')).toEqual([])
    expect(await unlinkedOf(w, seller)).toEqual({})

    // 그 뒤 도착한 M의 댓글은 b2에 기록하지 않는다 — 이어진 적이 있는 라이브라 다시 옮기지 않고 센다
    w.clock.set(at(11, 41))
    await sendComments(w, account, m, [{ id: '8004', igsid: '6024400000000004', username: 'late.viewer', text: '16' }])
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).toEqual(['ig:8001', 'ig:8002', 'ig:8003'])
    expect(await linkOf(w, seller, b2)).toMatchObject({ state: 'LINKED', liveId: m2 })
    expect(await unlinkedOf(w, seller)).toEqual({ [m]: 1 })
    expect(await moves(w, seller.sellerId)).toHaveLength(1)
  })

  it('라이브를 다시 켜면 또 옮기고(옮긴 연결도 서버가 이은 것), 옛 라이브로는 되돌아가지 않는다', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ id: '9001', igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, actor: { kind: 'server' } })
    const m3 = w.fake.startLive(account.id)
    w.clock.advance(1000)
    await sendComments(w, account, m3, [{ id: '9002', igsid: '6024400000000002', username: 'b', text: '안녕' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3, linkedAt: new Date(w.clock.now()).toISOString(), collection: { state: 'LIVE', liveId: m3, comments: 3 } })
    expect((await moves(w, seller.sellerId)).map((row) => [row.from, row.to, row.before])).toEqual([
      [m, m2, 1],
      [m2, m3, 2],
    ])
    // M·M2의 댓글은 세기만 (되돌아가지 않는다)
    await sendComments(w, account, m, [{ id: '9003', igsid: '6024400000000003', username: 'c', text: '15' }])
    await sendComments(w, account, m2, [{ id: '9004', igsid: '6024400000000004', username: 'd', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m3 })
    expect(await unlinkedOf(w, seller)).toEqual({ [m]: 1, [m2]: 1 })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).toEqual([expect.stringMatching(/^ig:/), 'ig:9001', 'ig:9002'])
    expect(w.published.filter((item) => item.data.code === 'LIVE_MOVED').map((item) => item.data.count)).toEqual([1, 2])
  })

  it('LIVE_MOVED 문장: N이 있으면 두 문장(수 포함), 0이면 첫 문장만', () => {
    expect(liveMovedMessage(3)).toBe('인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요. 그 전 라이브에서 이 방송에 기록한 댓글 3개를 확인해 주세요.')
    expect(liveMovedMessage(0)).toBe(LIVE_MOVED_MESSAGE)
    expect(LIVE_MOVED_MESSAGE).toBe('인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요.')
  })

  it('옮기지 않음 ① 늦게 받은 댓글(entry.time이 61초 이름) ② entry.time 없음 — b는 M에 그대로, M2 댓글은 기록하지 않고 이어지지 않은 수(M2) 1. 늦지 않은 다음 댓글에서 옮긴다', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    w.clock.set(at(12, 0))
    const m2 = w.fake.startLive(account.id)
    // ① 받은 시각보다 61초 이른 entry.time
    await sendComments(w, account, m2, [{ id: '9201', igsid: '6024400000000001', username: 'a', text: '15' }], { time: Math.floor(at(11, 58, 59) / 1000) })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    // ② entry.time 없음
    const change = w.fake.comment({ accountId: account.id, liveId: m2, id: '9202', igsid: '6024400000000002', username: 'b', text: '15' })
    const body = JSON.parse(w.fake.payload([{ accountId: account.id, changes: [change] }])) as { entry: Record<string, unknown>[] }
    for (const entry of body.entry) delete entry.time
    expect((await w.fake.deliver(webhookTarget(w), JSON.stringify(body))).status).toBe(200)
    // entry.time이 숫자가 아님
    const odd = JSON.parse(w.fake.payload([{ accountId: account.id, changes: [w.fake.comment({ accountId: account.id, liveId: m2, id: '9203', igsid: '6024400000000003', username: 'c', text: '15' })] }])) as {
      entry: Record<string, unknown>[]
    }
    for (const entry of odd.entry) entry.time = String(Math.floor(at(12, 0) / 1000))
    expect((await w.fake.deliver(webhookTarget(w), JSON.stringify(odd))).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 3 })
    expect(await moves(w, seller.sellerId)).toEqual([])
    expect(w.published.filter((item) => item.data.code === 'LIVE_MOVED')).toEqual([])
    // 60초 이른 entry.time은 늦은 댓글이 아니다 → 옮긴다
    await sendComments(w, account, m2, [{ id: '9204', igsid: '6024400000000004', username: 'd', text: '15' }], { time: Math.floor(at(11, 59) / 1000) })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, collection: { late: 0 } })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).toEqual([expect.stringMatching(/^ig:/), 'ig:9204'])
  })

  it('옮기지 않음 ③ M2가 전에 이 판매자의 다른 회차(끝난 회차)에 이어졌던 라이브', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b0 = await liveBroadcast(w, seller)
    const m2 = w.fake.startLive(account.id)
    await linkLive(w, seller, b0, m2)
    await end(w, seller, b0)
    const b = await liveBroadcast(w, seller)
    await wait(w, seller, b)
    const m = w.fake.startLive(account.id)
    await sendComments(w, account, m, [{ igsid: '6024400000000001', username: 'a', text: '안녕' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, actor: { kind: 'server' } })
    await sendComments(w, account, m2, [{ igsid: '6024400000000002', username: 'b', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
  })

  it('옮기지 않음 ④ 판매자가 손으로 이은 연결 — M2 댓글은 세고 UNLINKED_COMMENTS로 알린다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const m = w.fake.startLive(account.id)
    await linkLive(w, seller, b, m)
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, actor: { kind: 'account', loginId: seller.loginId } })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(w.published.find((item) => item.data.code === 'UNLINKED_COMMENTS')?.data).toMatchObject({ liveId: m2, count: 1 })
    expect(w.published.filter((item) => item.data.code === 'LIVE_MOVED')).toEqual([])
  })

  it('옮기지 않음 ⑤ 조건에 맞는 회차가 둘', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const c = await liveBroadcast(w, seller)
    await wait(w, seller, c)
    const n = w.fake.startLive(account.id)
    await sendComments(w, account, n, [{ igsid: '6024400000000001', username: 'a', text: '안녕' }])
    expect(await linkOf(w, seller, c)).toMatchObject({ liveId: n, actor: { kind: 'server' } })
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ igsid: '6024400000000002', username: 'b', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await linkOf(w, seller, c)).toMatchObject({ liveId: n })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
  })

  it('옮기지 않음 ⑥ 다른 인스타 계정으로 다시 연결한 뒤 그 계정의 라이브 댓글 (b의 연결 계정 ≠ entry.id)', async () => {
    const w = await world()
    const { seller, b, m } = await autoLinked(w)
    expect((await client(w, seller.cookie).post('/api/instagram/disconnect', {})).status).toBe(200)
    const other = w.fake.addAccount({ username: 'second.shop', type: 'BUSINESS' })
    expect(await connectInstagram(w, seller, { accounts: [other.id] })).toBe('CONNECTED')
    const m2 = w.fake.startLive(other.id)
    await sendComments(w, other, m2, [{ igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
  })

  it('⑦ 기다리는 회차 b3이 있으면 AC-N2-22가 먼저 — b3이 M2에 이어지고 b는 M에 그대로', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const b3 = await liveBroadcast(w, seller)
    await wait(w, seller, b3)
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ id: '9301', igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b3)).toMatchObject({ state: 'LINKED', liveId: m2, actor: { kind: 'server' } })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect((await chatEvents(w, seller.sellerId)).filter((event) => event.b === b3).map((event) => event.id)).toEqual(['ig:9301'])
    expect(await moves(w, seller.sellerId)).toEqual([])
    // 기다리는 회차가 둘이면 MANY_WAITING — 옮기지도 않는다
    const b4 = await liveBroadcast(w, seller)
    const b5 = await liveBroadcast(w, seller)
    await wait(w, seller, b4)
    await wait(w, seller, b5)
    const m3 = w.fake.startLive(account.id)
    await sendComments(w, account, m3, [{ igsid: '6024400000000002', username: 'b', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await linkOf(w, seller, b3)).toMatchObject({ liveId: m2 })
    expect(w.published.some((item) => item.data.code === 'MANY_WAITING')).toBe(true)
    expect(await moves(w, seller.sellerId)).toEqual([])
  })

  it('옮기지 않음 ⑧ 끝나지 않은 다른 실제 회차가 있음(1부를 끝내지 않고 2부를 만듦, 2부는 아직 잇지 않음) — 2부 시청자의 "15"가 1부 15번(다른 상품)의 찜이 되지 않고 세기만, 판매자는 2부를 새 라이브에 이을 수 있다 (SA-N2-004·TD-N2-003)', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    await register(w, seller, b, 15, '1부 핑크프릴', 10000)
    const c = await liveBroadcast(w, seller)
    await register(w, seller, c, 15, '2부 라울', 5000)
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    const published = w.published.length
    expect((await sendComments(w, account, m2, [{ id: '9501', igsid: '6024400000000001', username: 'pink.mom', text: '15' }])).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: m })
    expect(await linkOf(w, seller, c)).toMatchObject({ state: 'NONE' })
    expect(await winners(w, seller, `${b}/15`)).toEqual([])
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain('ig:9501')
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
    const after = w.published.slice(published).map((item) => item.data)
    expect(after.filter((data) => data.code === 'LIVE_MOVED')).toEqual([])
    expect(after.find((data) => data.code === 'UNLINKED_COMMENTS')).toMatchObject({ liveId: m2, count: 1 })
    // 판매자가 2부를 M2에 잇는다 (LIVE_TAKEN 아님) → 그 뒤 M2 댓글은 2부에
    await linkLive(w, seller, c, m2)
    await sendComments(w, account, m2, [{ id: '9502', igsid: '6024400000000002', username: 'raoul.fan', text: '15' }])
    expect(await winners(w, seller, `${c}/15`)).toEqual(['ig:6024400000000002'])
    expect(await winners(w, seller, `${b}/15`)).toEqual([])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
  })

  it('옮기지 않음 ⑧ 다른 회차가 손으로 이은 연결이어도 — 다른 회차를 끝내면 다음 늦지 않은 댓글에서 옮긴다. 리허설 회차는 막지 않는다', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const api = client(w, seller.cookie)
    expect((await api.post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-19', rehearsal: true })).status).toBe(200)
    const c = await liveBroadcast(w, seller)
    const n = w.fake.startLive(account.id)
    await linkLive(w, seller, c, n)
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ id: '9511', igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await linkOf(w, seller, c)).toMatchObject({ liveId: n, actor: { kind: 'account' } })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
    // 다른 실제 회차를 끝냄 (리허설 회차는 끝내지 않은 채) → M2의 늦지 않은 다음 댓글에서 b를 M2로 옮긴다
    await end(w, seller, c)
    w.clock.advance(1000)
    await sendComments(w, account, m2, [{ id: '9512', igsid: '6024400000000002', username: 'b', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: m2, actor: { kind: 'server' } })
    expect((await chatEvents(w, seller.sellerId)).filter((event) => event.b === b).map((event) => event.id)).toEqual([expect.stringMatching(/^ig:/), 'ig:9512'])
    expect((await moves(w, seller.sellerId)).map((row) => [row.broadcast, row.from, row.to])).toEqual([[b, m, m2]])
  })

  it('옮기지 않음 ⑨ 그 회차의 방송 날짜가 댓글을 받은 날(KST)이 아님 — 어제 끝내지 않은 회차가 오늘 라이브로 옮겨 가지 않는다 (SA-N2-004)', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    await register(w, seller, b, 15, '어제 핑크프릴', 10000)
    w.fake.endLive(m)
    // 2026-10-20 00:00:00 KST (b의 방송 날짜는 2026-10-19)
    w.clock.set(Date.UTC(2026, 9, 19, 15, 0, 0))
    const m2 = w.fake.startLive(account.id)
    expect((await sendComments(w, account, m2, [{ id: '9601', igsid: '6024400000000001', username: 'a', text: '15' }])).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ state: 'LINKED', liveId: m })
    expect(await winners(w, seller, `${b}/15`)).toEqual([])
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
    expect(w.published.filter((item) => item.data.code === 'LIVE_MOVED')).toEqual([])
  })

  it('⑨ 경계: 같은 날 23:59:59(KST)에 받은 새 라이브 댓글은 옮긴다', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    w.fake.endLive(m)
    w.clock.set(Date.UTC(2026, 9, 19, 14, 59, 59))
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ id: '9611', igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m2, linkedAt: new Date(Date.UTC(2026, 9, 19, 14, 59, 59)).toISOString() })
    expect(await moves(w, seller.sellerId)).toHaveLength(1)
  })

  it('기록 트랜잭션 안의 다시 확인: 회차를 정한 뒤 옮기기 전에 다른 실제 회차가 생기면 옮기지 않는다(retry)', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const links = w.server.instagram.links
    const m2 = w.fake.startLive(account.id)
    const target = await links.resolveTarget(seller.sellerId, account.id, m2, true)
    expect(target).toMatchObject({ kind: 'move', broadcastId: b, fromLiveId: m, toLiveId: m2 })
    if (target.kind !== 'move') return
    await liveBroadcast(w, seller)
    const outcome = await w.server.service.ingestOpenChat(
      seller.sellerId,
      { b, id: 'ig:9621', ch: 'ig:6024400000000001', nick: 'a', text: '15' },
      { guard: async (tx, scopeId, now) => (await links.applyMove(tx, seller.sellerId, target, scopeId, 'ig:9621', now)) !== null },
    )
    expect(outcome).toEqual({ status: 'retry' })
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await moves(w, seller.sellerId)).toEqual([])
  })

  it('끝난 회차는 옮기지 않는다 — 끝낸 뒤 새 라이브 댓글은 세기만', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    await end(w, seller, b)
    const m2 = w.fake.startLive(account.id)
    await sendComments(w, account, m2, [{ igsid: '6024400000000001', username: 'a', text: '15' }])
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m, collection: { state: 'FINISHED' } })
    expect(await unlinkedOf(w, seller)).toEqual({ [m2]: 1 })
    expect(await moves(w, seller.sellerId)).toEqual([])
  })

  it('이미 기록한 댓글(AC-N2-33)은 옮기기를 일으키지 않는다 — 다른 라이브의 미디어 ID로 다시 배달돼도', async () => {
    const w = await world()
    const { seller, account, b, m } = await autoLinked(w)
    const recorded = (await chatEvents(w, seller.sellerId))[0]?.id as string
    const m2 = w.fake.startLive(account.id)
    const again = w.fake.comment({ accountId: account.id, liveId: m2, id: recorded.slice('ig:'.length), igsid: '6024400000000009', username: 'hello.viewer', text: '안녕하세요' })
    expect((await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: [again] }]))).status).toBe(200)
    expect(await linkOf(w, seller, b)).toMatchObject({ liveId: m })
    expect(await unlinkedOf(w, seller)).toEqual({})
    expect(await moves(w, seller.sellerId)).toEqual([])
    expect(await chatEvents(w, seller.sellerId)).toHaveLength(1)
  })

  it('옮기기와 그 댓글의 기록은 한 트랜잭션 — 기록 트랜잭션 안에서 옮기기를 못 하면 기록도 취소하고 회차를 다시 정한다(retry)', async () => {
    const w = await world()
    const { seller, b } = await autoLinked(w)
    const outcome = await w.server.service.ingestOpenChat(seller.sellerId, { b, id: 'ig:9401', ch: 'ig:6024400000000001', nick: 'a', text: '15' }, { guard: async () => false })
    expect(outcome).toEqual({ status: 'retry' })
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).not.toContain('ig:9401')
    // 기록 경로는 멀쩡하다 — 같은 댓글을 다시 넣으면 기록된다
    expect((await w.server.service.ingestOpenChat(seller.sellerId, { b, id: 'ig:9401', ch: 'ig:6024400000000001', nick: 'a', text: '15' }, { guard: async () => true })).status).toBe('recorded')
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.id)).toContain('ig:9401')
  })
})
