// 같은 유튜브 라이브에 이어진 계정 사이의 상품 동기화 (2026-11-12 복기 G절, D-RETRO-10~15).
// - 처음 맞출 때 덮어쓰지 않기(222번) · 기준 계정 · 늦게 온 옛 고침 건너뛰기 · 실패한 전달 1초 뒤 다시·밀림 표시 ·
//   거의 동시에 넣은 손 등록(313번) · 이미 찜한 손님에게도 적용한 금액 고침을 같은 범위로 옮기기.
// 포트를 열지 않는다. 대기열은 시험이 직접 돌린다(world.server.catalog.drain — 주기 타이머 없이).
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { planFirstSync, type Held, type Party, type Prov } from '../src/screen/catalog.ts'
import type { ServerOptions } from '../src/server.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import type { CommittedRecord } from '../src/writer.ts'
import { chat } from './print-support.ts'
import { client, createBroadcast, expectOk, writeEvent, type Seller } from './support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'
const OPS = 'operations-test-token-32-characters'

interface Shop {
  readonly seller: Seller
  readonly b: { readonly id: string; readonly date: string }
}

/** 운영과 같은 기본값(감사 채팅 끔) — 기준 계정이 없는 상태에서 시작한다 */
const newWorld = (overrides: Partial<ServerOptions> = {}) => youtubeWorld({ overrides: { screenWorkerToken: TOKEN, sellerDefaults: SELLER_DEFAULTS, ...overrides } })

/** 첫 계정: 라이브를 만들고 잇는다 */
async function host(world: YoutubeWorld): Promise<{ shop: Shop; videoId: string }> {
  const connected = await connectSeller(world)
  const { b, live } = await linkedBroadcast(world, connected)
  return { shop: { seller: connected.seller, b }, videoId: live.videoId }
}

/** 다른 계정: 방송을 만든다(아직 잇지 않음) */
async function shopOf(world: YoutubeWorld, title: string): Promise<Shop> {
  const connected = await connectSeller(world, { channelTitle: title })
  return { seller: connected.seller, b: await createBroadcast(world, connected.seller) }
}

/** 같은 라이브에 잇는다 (D-LV1-15 초대받은 방송) */
async function link(world: YoutubeWorld, shop: Shop, videoId: string): Promise<void> {
  const linked = await client(world, shop.seller.cookie).post(`/api/broadcasts/${shop.b.id}/youtube`, { requestId: `link-${shop.b.id}`, video: `https://www.youtube.com/watch?v=${videoId}`, confirmInvited: true })
  expect(linked.status, JSON.stringify(linked.body)).toBe(200)
}

async function join(world: YoutubeWorld, title: string, videoId: string): Promise<Shop> {
  const shop = await shopOf(world, title)
  await link(world, shop, videoId)
  return shop
}

async function product(world: YoutubeWorld, shop: Shop, no: number): Promise<{ no: number; name: string; price: number; status: string } | undefined> {
  const day = await client(world, shop.seller.cookie).get(`/api/days/${shop.b.date}`)
  expect(day.status, day.text).toBe(200)
  return ((day.body.products ?? []) as { no: number; name: string; price: number; status: string }[]).find((p) => p.no === no)
}

/** 화면 일꾼이 그 계정 하나에만 넣은 등록 — 일꾼 입구와 같은 길(서버 조치·요청 번호 screen-). 계정마다 값이 달랐던 때를 만든다 */
async function workerRegister(world: YoutubeWorld, shop: Shop, no: number, name: string, price: number): Promise<void> {
  const outcome = await world.server.service.writeEvent(shop.seller.sellerId, { kind: 'server' }, `screen-t-${String(no)}`, { type: 'product.register', b: shop.b.id, no, name, price }, undefined)
  expect(outcome.kind).toBe('ok')
}

async function workerPost(world: YoutubeWorld, path: 'register' | 'reprice', body: unknown) {
  const response = await world.server.app.request(`/internal/screen/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

interface Row {
  id: number
  done: boolean
  problem: string | null
  body: Record<string, unknown>
}
async function deliveries(world: YoutubeWorld, shop: Shop): Promise<Row[]> {
  const result = await world.database.pglite?.query<Row>(`select id::int as id, done, problem, body from live_catalog_delivery where seller_id = $1 order by id`, [shop.seller.sellerId])
  return result?.rows ?? []
}

/** 동기화가 처음 켜지는 때 (2026-11-12 12:09:50의 마이그레이션 0051과 같은 표시)를 만들고 대기열을 돌린다 */
async function firstSync(world: YoutubeWorld, videoId: string): Promise<void> {
  await world.database.db.execute(sql`insert into live_catalog_backfill(video_id) values (${videoId}) on conflict do nothing`)
  await world.server.catalog.resync()
}

describe('D-RETRO-10 처음 맞출 때 덮어쓰지 않기', () => {
  it('계정이 새로 이어질 때: 일꾼 값끼리 금액이 다르면 각 계정 값을 그대로 두고, 판매자가 고친 품종만 옮긴다 (222번)', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    // 일꾼의 틀린 첫 등록 3만원이 두 계정에 들어가 있다
    expect((await workerPost(world, 'register', { videoId, no: 222, price: 30000, requestId: 'screen-v-222' })).body).toMatchObject({ changed: true })
    // 세 번째 계정: 일꾼 등록 130만원 + 판매자가 품종만 고침. 그 뒤에 같은 라이브에 잇는다
    const c = await shopOf(world, '세 번째 가게')
    await workerRegister(world, c, 222, '', 1_300_000)
    await expectOk(writeEvent(world, c.seller, { type: 'product.update', b: c.b.id, no: 222, name: '녹금' }))
    await link(world, c, videoId)
    await world.server.catalog.drain()

    // 130만원이 3만원으로 덮이지 않는다. 다른 두 계정의 3만원도 그대로다(어느 쪽도 사람이 고친 금액이 아니다)
    expect(await product(world, c, 222)).toMatchObject({ name: '녹금', price: 1_300_000 })
    expect(await product(world, a, 222)).toMatchObject({ name: '녹금', price: 30000 })
    expect(await product(world, b, 222)).toMatchObject({ name: '녹금', price: 30000 })
    // 덮어쓰지 않은 금액 차이는 계정마다 끝난 행으로 남는다 (화면이 두 값을 보여 물을 때 읽는다)
    for (const [shop, mine] of [[a, 30000], [b, 30000], [c, 1_300_000]] as const) {
      const conflict = (await deliveries(world, shop)).find((row) => row.body.type === 'conflict')
      expect(conflict, shop.seller.loginId).toMatchObject({ done: true, body: { no: 222, mine, prices: [30000, 1_300_000] } })
    }
    expect(world.logs.find((record) => record.code === 'CATALOG_SYNC_CONFLICT')).toMatchObject({ count: 1 })
    // 세 번째 계정에 금액을 바꾸는 기록은 하나도 없다
    const priced = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1 and type = 'product.update' and body::jsonb ? 'price'`, [c.seller.sellerId])
    expect(priced?.rows[0]?.n).toBe(0)
  })

  it('한 계정에만 있는 번호는 새로 이은 계정에 넣고, 사람이 고친 금액은 일꾼 금액을 이긴다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    expect((await workerPost(world, 'register', { videoId, no: 407, price: 70000, name: '칠복', requestId: 'screen-v-407' })).status).toBe(200)
    // 판매자가 70만원으로 바로잡음
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 407, price: 700_000 }))
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 376, name: '기존 상품', price: 10000 }))
    // 새 계정은 잇기 전에 일꾼의 틀린 값 7만원을 가지고 있었다
    const b = await shopOf(world, '두 번째 가게')
    await workerRegister(world, b, 407, '칠복', 70000)
    await link(world, b, videoId)
    await world.server.catalog.drain()
    expect(await product(world, b, 407)).toMatchObject({ price: 700_000 })
    expect(await product(world, b, 376)).toMatchObject({ name: '기존 상품', price: 10000 })
    expect(await product(world, a, 407)).toMatchObject({ price: 700_000 })
  })
})

describe('D-RETRO-10·14 처음 맞추기 계획 (순수 함수)', () => {
  const human = (at: number): Prov => ({ by: 'human', at, ord: at })
  const worker = (at: number): Prov => ({ by: 'worker', at, ord: at })
  const held = (name: string, price: number, p: Prov, more: Partial<Held> = {}): Held => ({ name, price, closed: false, nameP: p, priceP: p, stateP: p, ...more })
  const party = (id: string, items: Record<number, Held>): Party => ({ id, seller_id: id, broadcast_id: `b-${id}`, date: '2026-11-12', scope_id: `s-${id}`, held: new Map(Object.entries(items).map(([no, item]) => [Number(no), item])) })
  const brief = (plan: ReturnType<typeof planFirstSync>) => plan.map(({ to, body }) => (body.type === 'conflict' ? [to.id, 'conflict', body.no] : [to.id, body.type, body.no, body.setName ? body.name : null, body.setPrice ? body.price : null]))

  it('사람끼리는 나중에 고친 값이 앞서고, 기준 계정이어도 사람이 나중에 고친 값을 되돌리지 않는다', () => {
    const a = party('a', { 1: held('옛 이름', 10000, human(100)) })
    const b = party('b', { 1: held('새 이름', 30000, human(200)) })
    expect(brief(planFirstSync([a, b], a, 0))).toEqual([['a', 'product.update', 1, '새 이름', 30000]])
  })

  it('일꾼 값끼리 다르면 기준 계정의 값, 사람이 고친 값이 있으면 기준 계정의 일꾼 값보다 앞선다', () => {
    const a = party('a', { 1: held('', 30000, worker(100)), 2: held('칠복', 70000, worker(100)) })
    const b = party('b', { 1: held('금', 1_300_000, worker(200)), 2: held('칠복', 70000, worker(100), { price: 700_000, priceP: human(300) }) })
    // 기준 a: 1번은 a의 금액(일꾼끼리)·b의 이름(빈 이름은 진다), 2번은 사람이 고친 b의 금액
    expect(brief(planFirstSync([a, b], a, 0))).toEqual([['a', 'product.update', 1, '금', null], ['b', 'product.update', 1, null, 30000], ['a', 'product.update', 2, null, 700_000]])
    // 기준 없음: 1번 금액은 덮지 않는다(양쪽에 차이만 남긴다)
    expect(brief(planFirstSync([a, b], null, 0))).toEqual([['a', 'conflict', 1], ['a', 'product.update', 1, '금', null], ['b', 'conflict', 1], ['a', 'product.update', 2, null, 700_000]])
  })

  it('판매자가 지운 번호가 가장 새 일이면 다른 계정도 판매 종료하고, 그 뒤 일꾼이 다른 계정에 넣은 등록은 지운 계정을 다시 열지 않는다', () => {
    const closed = held('리마인드', 50000, worker(100), { closed: true, stateP: human(300) })
    // 지운 것이 가장 새 일
    expect(brief(planFirstSync([party('a', { 394: closed }), party('b', { 394: held('리마인드', 50000, worker(100)) }), party('c', {})], null, 0))).toEqual([['b', 'product.close', 394, null, null]])
    // 지운 뒤 일꾼이 다른 계정에 새로 넣음: 지운 계정은 그대로, 없는 계정에는 넣는다
    expect(brief(planFirstSync([party('a', { 394: closed }), party('b', { 394: held('로라클론', 70000, worker(400)) }), party('c', {})], null, 0))).toEqual([['c', 'product.register', 394, '로라클론', 70000]])
    // 지운 뒤 판매자가 다른 계정에서 손으로 다시 넣음: 지운 계정도 다시 연다
    expect(brief(planFirstSync([party('a', { 394: closed }), party('b', { 394: held('로라클론', 70000, human(400)) })], null, 0))).toEqual([['a', 'product.open', 394, '로라클론', 70000]])
  })
})

describe('D-RETRO-14 기준 계정', () => {
  it('동기화가 처음 켜질 때: 기준 계정이 없으면 금액을 덮지 않고, 감사 채팅이 켜진 계정이 하나면 그 계정의 금액으로 맞춘다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    const c = await join(world, '세 번째 가게', videoId)
    // 동기화가 없던 때처럼 계정마다 일꾼 값이 다르다: 두 계정 3만원(틀린 첫 등록), 한 계정 130만원
    await workerRegister(world, a, 222, '', 30000)
    await workerRegister(world, b, 222, '', 30000)
    await workerRegister(world, c, 222, '', 1_300_000)

    await firstSync(world, videoId)
    expect(await product(world, c, 222)).toMatchObject({ price: 1_300_000 })
    expect(await product(world, a, 222)).toMatchObject({ price: 30000 })
    expect(await product(world, b, 222)).toMatchObject({ price: 30000 })

    // 감사 채팅을 켠 계정이 하나 → 그 계정이 기준
    await expectOk(writeEvent(world, c.seller, { type: 'broadcast.thanks', b: c.b.id, liveChat: true }))
    await firstSync(world, videoId)
    expect(await product(world, c, 222)).toMatchObject({ price: 1_300_000 })
    expect(await product(world, a, 222)).toMatchObject({ price: 1_300_000 })
    expect(await product(world, b, 222)).toMatchObject({ price: 1_300_000 })

    // 옮겨 온 금액은 일꾼 값이다 — 일꾼의 금액 고치기가 세 계정 모두에 듣는다(판매자 고침으로 굳지 않는다)
    const repriced = await workerPost(world, 'reprice', { videoId, no: 222, price: 1_200_000, requestId: 'screen-v-price-222' })
    expect(repriced.body.broadcasts).toEqual([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: true }), expect.objectContaining({ changed: true })])

    // 기준 계정이 둘이면 다시 1번 규칙만: 금액을 덮지 않는다
    await workerRegister(world, a, 328, '', 50000)
    await workerRegister(world, c, 328, '', 80000)
    await expectOk(writeEvent(world, a.seller, { type: 'broadcast.thanks', b: a.b.id, liveChat: true }))
    await firstSync(world, videoId)
    expect(await product(world, a, 328)).toMatchObject({ price: 50000 })
    expect(await product(world, c, 328)).toMatchObject({ price: 80000 })
    // 금액을 정하지 못한 번호는 없는 계정에 새로 넣지 않는다
    expect(await product(world, b, 328)).toBeUndefined()
  })
})

describe('D-RETRO-11 고침 차례', () => {
  it('늦게 도착한 옛 금액 고침은 그 계정이 그 뒤에 스스로 고친 금액을 덮지 못한다', async () => {
    const world = await newWorld({ opsToken: OPS })
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 5, name: '녹금', price: 10000 }))
    await world.server.catalog.drain()
    expect(await product(world, b, 5)).toMatchObject({ price: 10000 })

    // 다른 계정의 옛 고침(15,000원)이 임대에 걸려 아직 들어오지 못했다 — 1분 전에 넣은 것
    await world.database.db.execute(sql`insert into live_catalog_delivery(seller_id,broadcast_id,scope_date,body,lease_until)
      values (${b.seller.sellerId},${b.b.id},${b.b.date},${JSON.stringify({ type: 'product.update', no: 5, name: '녹금', price: 15000, setName: false, setPrice: true, srcSeller: a.seller.sellerId, srcB: a.b.id, srcSeq: 1, srcAt: world.timer.now() - 60_000, queuedAt: world.timer.now() - 60_000 })}::text::jsonb, now() + interval '1 hour')`)

    // 5초 넘게 밀린 전달은 운영 상태에 보인다
    expect(await world.server.catalog.status()).toMatchObject({ pending: 1, late: true, oldestSeconds: 60 })
    const ops = await world.server.app.request('/ops/status', { headers: { Authorization: `Bearer ${OPS}` } })
    expect(((await ops.json()) as { catalogSync: unknown }).catalogSync).toEqual({ pending: 1, oldestSeconds: 60, late: true, merges: 0 })

    // 막힌 전달이 있어도 그 계정의 쓰기는 서지 않는다 — 판매자가 2만원으로 고친다
    const started = Date.now()
    await expectOk(writeEvent(world, b.seller, { type: 'product.update', b: b.b.id, no: 5, price: 20000 }))
    expect(Date.now() - started).toBeLessThan(4000)
    expect(world.logs.some((record) => record.code === 'CATALOG_SYNC_LATE' && record.seller === b.seller.sellerId)).toBe(true)

    // 옛 고침이 이제 도착한다: 뒤에 스스로 고친 값이 있어 건너뛴다
    await world.database.db.execute(sql`update live_catalog_delivery set lease_until = null where not done`)
    await world.server.catalog.drain()
    expect(await product(world, b, 5)).toMatchObject({ price: 20000 })
    expect(await product(world, a, 5)).toMatchObject({ price: 20000 })
    const rows = await deliveries(world, b)
    expect(rows.every((row) => row.done)).toBe(true)
    expect(rows.find((row) => row.body.price === 15000)?.body).toMatchObject({ result: 'stale' })
    expect(await world.server.catalog.status()).toMatchObject({ pending: 0, late: false })
    // 보낸 고침에는 원천 방송·순번·시각이 실린다
    expect(rows.find((row) => row.body.price === 20000)?.body).toMatchObject({ srcSeller: b.seller.sellerId, srcB: b.b.id, srcAt: world.timer.now() })
    expect(typeof rows.find((row) => row.body.price === 20000)?.body.srcSeq).toBe('number')
  })
})

describe('D-RETRO-12 느린 꼬리', () => {
  it('넣지 못한 전달은 1초 뒤 다시 넣고, 그동안 뒤에 온 고침은 차례를 기다렸다가 이어서 들어간다', async () => {
    const failing = { times: 0, target: '' }
    const world = await newWorld({
      hooks: {
        beforeCommit: (records: readonly CommittedRecord[]) => {
          if (failing.times > 0 && records.some((record) => record.type === 'product.update' && 'b' in record.event && record.event.b === failing.target)) {
            failing.times -= 1
            throw new Error('저장 실패 주입')
          }
        },
      },
    })
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 9, name: '처음', price: 10000 }))
    await world.server.catalog.drain()
    expect(await product(world, b, 9)).toMatchObject({ name: '처음' })

    // 받는 계정의 저장이 한 번 실패한다
    failing.target = b.b.id
    failing.times = 1
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 9, name: '둘째' }))
    await world.server.catalog.drain()
    expect(await product(world, b, 9)).toMatchObject({ name: '처음' })
    const stuck = (await deliveries(world, b)).filter((row) => !row.done)
    expect(stuck).toHaveLength(1)
    expect(stuck[0]?.body).toMatchObject({ name: '둘째', attempts: 1 })
    expect(world.logs.find((record) => record.code === 'CATALOG_SYNC_FAILED')).toMatchObject({ reason: 'RETRY', seller: b.seller.sellerId, count: 1 })

    // 그사이 한 번 더 고친다 — 앞 전달이 끝나야 들어간다
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 9, name: '셋째' }))
    // 1초 뒤 다시 넣는다 (운영에서는 1초 주기가, 여기서는 시험이 대기열을 돌린다)
    const began = Date.now()
    await vi.waitFor(
      async () => {
        await world.server.catalog.drain()
        expect(await product(world, b, 9)).toMatchObject({ name: '셋째' })
      },
      { timeout: 5000, interval: 100 },
    )
    expect(Date.now() - began).toBeLessThan(3000)
    const rows = await deliveries(world, b)
    expect(rows.every((row) => row.done && row.problem === null)).toBe(true)
    // 차례대로: 둘째 다음에 셋째
    const applied = await world.database.pglite?.query<{ name: string }>(`select body::jsonb->>'name' as name from events where seller_id = $1 and type = 'product.update' and request_id like 'catalog-%' order by seq`, [b.seller.sellerId])
    expect(applied?.rows.map((row) => row.name)).toEqual(['둘째', '셋째'])
    // 끝난 행에는 결과와 끝난 시각이 남는다
    expect(rows.at(-1)?.body).toMatchObject({ result: 'applied', doneAt: world.timer.now() })
  })

  it('전달이 5초 넘게 밀리면 로그에 남기고, 다 들어가면 풀렸다고 남긴다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await world.database.db.execute(sql`insert into live_catalog_delivery(seller_id,broadcast_id,scope_date,body,lease_until)
      values (${b.seller.sellerId},${b.b.id},${b.b.date},${JSON.stringify({ type: 'product.register', no: 12, name: '늦은 상품', price: 10000, setName: true, setPrice: true, srcSeller: a.seller.sellerId, srcB: a.b.id, queuedAt: world.timer.now() })}::text::jsonb, now() + interval '1 hour')`)
    expect(await world.server.catalog.status()).toMatchObject({ pending: 1, late: false })
    await world.timer.advance(6000)
    // 밀림 확인은 1초에 한 번까지다
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await world.server.catalog.drain()
    expect(world.logs.find((record) => record.code === 'CATALOG_SYNC_LATE')).toMatchObject({ level: 'warn', count: 6 })
    // 로그에는 정해진 코드·수·판매자 ID만 — 상품 이름·금액은 없다
    expect(JSON.stringify(world.logs.filter((record) => record.code.startsWith('CATALOG_')))).not.toContain('늦은 상품')

    await world.database.db.execute(sql`update live_catalog_delivery set lease_until = null where not done`)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await world.server.catalog.drain()
    expect(await product(world, b, 12)).toMatchObject({ name: '늦은 상품' })
    expect(world.logs.some((record) => record.code === 'CATALOG_SYNC_CAUGHT_UP')).toBe(true)
  })
})

describe('D-RETRO-13 거의 동시에 넣은 손 등록', () => {
  it('313번: 다른 계정의 등록이 2초 안에 먼저 들어와 내 손 등록이 버려지면 응답에 그 사실과 지금 값을 싣고, 값은 바꾸지 않는다', async () => {
    const world = await newWorld()
    const { shop: test, videoId } = await host(world)
    const main = await join(world, '비트다육', videoId)
    // 기다리던 찜
    await chat(world, main.seller, main.b.id, 'UC_WAIT', '손님', '313')
    // 테스트 계정이 1만원으로 손 등록 → 동기화로 들어온다
    await expectOk(writeEvent(world, test.seller, { type: 'product.register', b: test.b.id, no: 313, name: '빅뱅', price: 10000 }))
    await world.server.catalog.drain()
    expect(await product(world, main, 313)).toMatchObject({ name: '빅뱅', price: 10000 })

    // 1초 뒤 이 계정에서 친 3만원 손 등록은 이미 있는 번호라 아무 일도 없다
    await world.timer.advance(1000)
    const mine = { requestId: 'manual-313', type: 'product.register', b: main.b.id, no: 313, name: '빅뱅', price: 30000 }
    const dropped = await client(world, main.seller.cookie).post('/api/events', mine)
    expect(dropped.status, dropped.text).toBe(200)
    const shopName = (await world.database.pglite?.query<{ name: string }>(`select name from sellers where id = $1`, [test.seller.sellerId]))?.rows[0]?.name
    expect(dropped.body).toMatchObject({
      type: 'product.register',
      changed: false,
      syncClash: { no: 313, tried: { name: '빅뱅', price: 30000 }, current: { name: '빅뱅', price: 10000, from: shopName }, agoMs: 1000 },
    })
    expect(await product(world, main, 313)).toMatchObject({ price: 10000 })
    // 같은 요청을 다시 보내도 같은 답
    expect((await client(world, main.seller.cookie).post('/api/events', mine)).body).toMatchObject({ changed: false, syncClash: { no: 313, current: { price: 10000 } } })
  })

  it('2초가 지났거나, 값이 같거나, 이 계정이 스스로 넣은 번호면 싣지 않는다', async () => {
    const world = await newWorld()
    const { shop: test, videoId } = await host(world)
    const main = await join(world, '비트다육', videoId)
    await expectOk(writeEvent(world, test.seller, { type: 'product.register', b: test.b.id, no: 314, name: '창', price: 10000 }))
    await expectOk(writeEvent(world, test.seller, { type: 'product.register', b: test.b.id, no: 315, name: '수박', price: 20000 }))
    await world.server.catalog.drain()
    // 값이 같다
    await world.timer.advance(500)
    const same = await expectOk(writeEvent(world, main.seller, { type: 'product.register', b: main.b.id, no: 315, name: '수박', price: 20000 }))
    expect(same.body).toMatchObject({ changed: false })
    expect(same.body).not.toHaveProperty('syncClash')
    // 2초가 지났다
    await world.timer.advance(2000)
    const late = await expectOk(writeEvent(world, main.seller, { type: 'product.register', b: main.b.id, no: 314, name: '창', price: 30000 }))
    expect(late.body).toMatchObject({ changed: false })
    expect(late.body).not.toHaveProperty('syncClash')
    // 이 계정이 스스로 넣은 번호를 다시 넣었다
    await expectOk(writeEvent(world, main.seller, { type: 'product.register', b: main.b.id, no: 316, name: '직접', price: 10000 }))
    const own = await expectOk(writeEvent(world, main.seller, { type: 'product.register', b: main.b.id, no: 316, name: '직접', price: 50000 }))
    expect(own.body).not.toHaveProperty('syncClash')
  })
})

describe('D-RETRO-15 찜에 적용할지도 같이 전달', () => {
  it("한 계정이 금액을 '이미 찜한 손님에게도' 적용해 고치면 다른 계정의 입금 전 찜도 같은 금액이 되고, 새 찜부터로 고치면 찜 금액은 그대로다", async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 393, name: '손톱', price: 20000 }))
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 425, name: '창수박금', price: 80000 }))
    await world.server.catalog.drain()
    // 다른 계정에서 손님이 두 번호를 찜해 확정됐다
    await chat(world, b.seller, b.b.id, 'UC_B1', '손님', '393')
    await chat(world, b.seller, b.b.id, 'UC_B1', '손님', '425')
    const claims = async () => {
      const day = await expectOk(client(world, b.seller.cookie).get(`/api/days/${b.b.date}`))
      return (day.body.claims as { no: number; status: string; price: number | null }[]).map((claim) => [claim.no, claim.status, claim.price]).sort((x, y) => Number(x[0]) - Number(y[0]))
    }
    expect(await claims()).toEqual([[393, 'CONFIRMED', 20000], [425, 'CONFIRMED', 80000]])

    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 393, price: 10000, applyTo: 'UNPAID_CLAIMS' }))
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 425, price: 60000 }))
    await world.server.catalog.drain()
    expect(await product(world, b, 393)).toMatchObject({ price: 10000 })
    expect(await product(world, b, 425)).toMatchObject({ price: 60000 })
    expect(await claims()).toEqual([[393, 'CONFIRMED', 10000], [425, 'CONFIRMED', 80000]])
  })
})
