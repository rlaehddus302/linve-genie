// 확인 중(임시 등록) 상품 — 서버 (2026-11-12 복기 A2·A5·A6·B2·C·G6, D-RETRO-80~85, 계약 문서 docs/retro/tentative-contract.md).
// - 화면 일꾼 입구: 임시 등록 선택지 · 확정 · 거두기 · 옛 일꾼(임시 선택지를 모르는) 호환 · 지금 볼 라이브의 가격 단위
// - 판매자 확정 길: POST /api/events의 product.confirm·product.withdraw, 방송 상태(상품 목록)의 확인 중 표시·까닭·후보
// - 계정 동기화: 기다리는 찜이 있는 번호에 들어오는 등록은 확인 중으로 (313번 재현), 확정·거두기 전달
// 포트를 열지 않는다. 대기열은 시험이 직접 돌린다(world.server.catalog.drain).
import { describe, expect, it } from 'vitest'
import { productOwners } from '../src/product-history.ts'
import { planFirstSync, type Held, type Party, type Prov } from '../src/screen/catalog.ts'
import type { ServerOptions } from '../src/server.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { chat } from './print-support.ts'
import { client, createBroadcast, expectOk, writeEvent, type Seller } from './support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'

interface Shop {
  readonly seller: Seller
  readonly b: { readonly id: string; readonly date: string }
}
interface ProductRow {
  no: number
  name: string
  price: number
  status: string
  winners: string[]
  waitlist: string[]
  tentative?: { by: string; reasons: string[]; candidates: { no: number[]; price: number[]; name: string[] }; seq: number; at: string }
}
interface Day {
  products: ProductRow[]
  claims: { no: number; buyer: string; status: string; price: number | null }[]
  pending: { no: number; buyers: string[] }[]
  effects: { kind: string; text: string | null; status: string }[]
}

/** 운영과 같은 기본값 (등록 전 찜 만료 끔 · 감사 채팅은 판매자가 켠 뒤에만) */
const newWorld = (overrides: Partial<ServerOptions> = {}) => youtubeWorld({ overrides: { screenWorkerToken: TOKEN, sellerDefaults: SELLER_DEFAULTS, ...overrides } })

async function host(world: YoutubeWorld, settings?: Record<string, unknown>): Promise<{ shop: Shop; videoId: string }> {
  const connected = await connectSeller(world)
  const { b, live } = await linkedBroadcast(world, connected, settings === undefined ? {} : { settings })
  return { shop: { seller: connected.seller, b }, videoId: live.videoId }
}

async function join(world: YoutubeWorld, title: string, videoId: string, settings?: Record<string, unknown>): Promise<Shop> {
  const connected = await connectSeller(world, { channelTitle: title })
  if (settings !== undefined) expect((await client(world, connected.seller.cookie).patch('/api/settings', { settings })).status).toBe(200)
  const shop = { seller: connected.seller, b: await createBroadcast(world, connected.seller) }
  const linked = await client(world, shop.seller.cookie).post(`/api/broadcasts/${shop.b.id}/youtube`, { requestId: `link-${shop.b.id}`, video: `https://www.youtube.com/watch?v=${videoId}`, confirmInvited: true })
  expect(linked.status, JSON.stringify(linked.body)).toBe(200)
  return shop
}

async function day(world: YoutubeWorld, shop: Shop): Promise<Day> {
  const response = await client(world, shop.seller.cookie).get(`/api/days/${shop.b.date}`)
  expect(response.status, response.text).toBe(200)
  return response.body as unknown as Day
}
const product = async (world: YoutubeWorld, shop: Shop, no: number) => (await day(world, shop)).products.find((p) => p.no === no)
const claimsOf = async (world: YoutubeWorld, shop: Shop, no: number) => (await day(world, shop)).claims.filter((c) => c.no === no).map((c) => [c.buyer, c.status, c.price])

async function worker(world: YoutubeWorld, path: 'register' | 'confirm' | 'withdraw' | 'reprice', body: unknown) {
  const response = await world.server.app.request(`/internal/screen/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}
async function outboxCount(world: YoutubeWorld): Promise<number> {
  return (await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from outbox`))?.rows[0]?.n ?? 0
}

describe('D-RETRO-82 화면 일꾼 입구 — 임시 등록·확정·거두기', () => {
  it('임시 등록은 확인 중으로 올라가 찜은 보류로 받고 효과(감사 채팅·라벨)가 나오지 않는다. 확정하면 먼저 온 순서대로 확정하는 값으로 판정되고 그때 효과가 나온다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world, { 'thanks.liveChat': true })
    await chat(world, shop.seller, shop.b.id, 'UC_A', '손님가', '313')
    const made = await worker(world, 'register', { videoId, no: 313, price: 10000, name: '빅뱅', requestId: 'screen-v-313-1', tentative: { reasons: ['PRICE_DISAGREE', 'NUMBER_SINGLE_SOURCE'], candidates: { price: [10000, 30000], name: ['빅뱅', '빅방'] } } })
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    expect(made.body).toMatchObject({ ok: true, changed: true, tentative: true, broadcasts: [{ changed: true, tentative: true }] })
    await chat(world, shop.seller, shop.b.id, 'UC_B', '손님나', '313')

    let view = await day(world, shop)
    expect(view.products.find((p) => p.no === 313)).toMatchObject({
      status: 'READY',
      name: '빅뱅',
      price: 10000,
      winners: [],
      tentative: { by: 'WORKER', reasons: ['PRICE_DISAGREE', 'NUMBER_SINGLE_SOURCE'], candidates: { no: [], price: [10000, 30000], name: ['빅뱅', '빅방'] } },
    })
    expect(view.pending).toEqual([expect.objectContaining({ no: 313, buyers: ['UC_A', 'UC_B'] })])
    expect(view.effects).toEqual([])
    expect(await outboxCount(world)).toBe(0)
    // 확인 중 표시에는 닉네임·채팅 글이 없다
    expect(JSON.stringify(view.products.find((p) => p.no === 313)?.tentative)).not.toMatch(/손님|UC_/)

    // 근거가 둘 모였다: 3만 원으로 확정
    const confirmed = await worker(world, 'confirm', { videoId, no: 313, registerRequestId: 'screen-v-313-1', requestId: 'screen-v-ok-313-1', price: 30000 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body).toMatchObject({ ok: true, changed: true, no: 313, broadcasts: [{ changed: true }] })
    view = await day(world, shop)
    const after = view.products.find((p) => p.no === 313)
    expect(after).toMatchObject({ status: 'SOLD', price: 30000, winners: ['UC_A'], waitlist: ['UC_B'] })
    expect(after).not.toHaveProperty('tentative')
    expect(view.claims.filter((c) => c.no === 313).map((c) => [c.buyer, c.status, c.price])).toEqual([['UC_A', 'CONFIRMED', 30000], ['UC_B', 'WAITLISTED', null]])
    expect(view.effects.filter((e) => e.kind === 'POST_THANKS').map((e) => e.text)).toEqual(['313번 빅뱅 30,000원 손님가님 구매 감사합니다'])
    expect(await outboxCount(world)).toBeGreaterThan(0)
    // 같은 확정을 다시 보내도 한 번만
    expect((await worker(world, 'confirm', { videoId, no: 313, registerRequestId: 'screen-v-313-1', requestId: 'screen-v-ok-313-1', price: 30000 })).body).toMatchObject({ changed: false })
    // 이미 확정한 뒤의 다른 확정은 값을 덮지 않는다
    expect((await worker(world, 'confirm', { videoId, no: 313, registerRequestId: 'screen-v-313-1', requestId: 'screen-v-ok-313-2', price: 10000 })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NOT_TENTATIVE' }] })
    expect((await product(world, shop, 313))?.price).toBe(30000)
  })

  it('틀린 번호로 임시 등록했다가 옳은 번호로 확정하면(to) 옳은 번호로 기다리던 찜이 살아난다. 옮길 번호에 상품이 있으면 확정하지 않는다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '333')
    await worker(world, 'register', { videoId, no: 334, price: 20000, name: '색금', requestId: 'screen-v-334-1', tentative: { reasons: ['NUMBER_MISMATCH'], candidates: { no: [334, 333] } } })
    await chat(world, shop.seller, shop.b.id, 'UC_B', '나', '334')
    await expectOk(writeEvent(world, shop.seller, { type: 'product.register', b: shop.b.id, no: 335, name: '다른 상품', price: 5000 }))
    expect((await worker(world, 'confirm', { videoId, no: 334, to: 335, registerRequestId: 'screen-v-334-1', requestId: 'screen-v-ok-334-a' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'TARGET_EXISTS' }] })
    expect(await product(world, shop, 334)).toMatchObject({ status: 'READY', tentative: { candidates: { no: [334, 333] } } })

    const moved = await worker(world, 'confirm', { videoId, no: 334, to: 333, registerRequestId: 'screen-v-334-1', requestId: 'screen-v-ok-334-b' })
    expect(moved.body).toMatchObject({ changed: true, no: 334, to: 333 })
    const view = await day(world, shop)
    expect(view.products.find((p) => p.no === 334)).toBeUndefined()
    expect(view.products.find((p) => p.no === 333)).toMatchObject({ status: 'SOLD', price: 20000, winners: ['UC_A'] })
    // 없는 번호(334)를 쓴 찜은 그 번호의 보류 찜으로 남는다 (R-10 1)
    expect(view.pending).toEqual([expect.objectContaining({ no: 334, buyers: ['UC_B'] })])
  })

  it('일꾼이 올린 그 등록만 확정·거둔다: 다른 등록 번호·손 등록·판매자가 이미 확정한 상품은 건드리지 않는다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await worker(world, 'register', { videoId, no: 50, price: 10000, requestId: 'screen-v-50-1', tentative: { reasons: ['PRICE_SINGLE_SOURCE'] } })
    for (const path of ['confirm', 'withdraw'] as const) {
      expect((await worker(world, path, { videoId, no: 50, registerRequestId: 'screen-v-50-other', requestId: `screen-v-x-50-${path}` })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'OTHER_REGISTER' }] })
      expect((await worker(world, path, { videoId, no: 51, registerRequestId: 'screen-v-50-1', requestId: `screen-v-x-51-${path}` })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NO_PRODUCT' }] })
    }
    // 판매자의 손 등록(바로 판매 중)은 확인 중이 아니다
    await expectOk(writeEvent(world, shop.seller, { type: 'product.register', b: shop.b.id, no: 52, name: '손 등록', price: 7000 }))
    expect(await product(world, shop, 52)).toMatchObject({ status: 'OPEN' })
    expect(await product(world, shop, 52)).not.toHaveProperty('tentative')
    expect((await worker(world, 'withdraw', { videoId, no: 52, registerRequestId: 'screen-v-50-1', requestId: 'screen-v-x-52' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NOT_TENTATIVE' }] })
    // 판매자가 먼저 확정했다 → 일꾼의 확정·거두기는 아무 일도 없다
    await expectOk(writeEvent(world, shop.seller, { type: 'product.confirm', b: shop.b.id, no: 50, price: 15000 }))
    expect((await worker(world, 'confirm', { videoId, no: 50, registerRequestId: 'screen-v-50-1', requestId: 'screen-v-ok-50', price: 10000 })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NOT_TENTATIVE' }] })
    expect((await worker(world, 'withdraw', { videoId, no: 50, registerRequestId: 'screen-v-50-1', requestId: 'screen-v-no-50' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'NOT_TENTATIVE' }] })
    expect(await product(world, shop, 50)).toMatchObject({ status: 'OPEN', price: 15000 })
  })

  it('판매자가 그사이 고친 칸은 판매자 값 그대로 확정하고(kept), 판매자가 손댄 임시 등록은 거두지 않는다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await worker(world, 'register', { videoId, no: 60, price: 3000, name: '세검', requestId: 'screen-v-60-1', tentative: { reasons: ['PRICE_DISAGREE', 'NAME_UNSURE'] } })
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '60')
    // 판매자가 금액만 3만 원으로 고쳤다(아직 확정하지 않음)
    await expectOk(writeEvent(world, shop.seller, { type: 'product.update', b: shop.b.id, no: 60, price: 30000 }))
    expect(await product(world, shop, 60)).toMatchObject({ status: 'READY', price: 30000, tentative: { by: 'WORKER' } })
    expect((await worker(world, 'withdraw', { videoId, no: 60, registerRequestId: 'screen-v-60-1', requestId: 'screen-v-no-60' })).body).toMatchObject({ changed: false, broadcasts: [{ skip: 'SELLER_EDITED' }] })
    // 일꾼의 확정: 품종은 일꾼 값(색금)으로, 금액은 판매자 값(3만 원) 그대로
    const confirmed = await worker(world, 'confirm', { videoId, no: 60, registerRequestId: 'screen-v-60-1', requestId: 'screen-v-ok-60', price: 5000, name: '색금' })
    expect(confirmed.body).toMatchObject({ changed: true, broadcasts: [{ changed: true, kept: ['price'] }] })
    expect(await product(world, shop, 60)).toMatchObject({ status: 'SOLD', name: '색금', price: 30000, winners: ['UC_A'] })
    expect(await claimsOf(world, shop, 60)).toEqual([['UC_A', 'CONFIRMED', 30000]])
  })

  it('거두면 상품이 없어지고 그 번호의 보류 찜은 그대로 보류다 — 뒤의 등록이 그 찜을 판정한다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '40')
    await worker(world, 'register', { videoId, no: 40, price: 3000, name: '세검', requestId: 'screen-v-40-1', tentative: { reasons: ['NUMBER_SINGLE_SOURCE'] } })
    const gone = await worker(world, 'withdraw', { videoId, no: 40, registerRequestId: 'screen-v-40-1', requestId: 'screen-v-no-40' })
    expect(gone.status, JSON.stringify(gone.body)).toBe(200)
    expect(gone.body).toMatchObject({ ok: true, changed: true })
    let view = await day(world, shop)
    expect(view.products.find((p) => p.no === 40)).toBeUndefined()
    expect(view.pending).toEqual([expect.objectContaining({ no: 40, buyers: ['UC_A'] })])
    expect(view.effects).toEqual([])
    // 옛 모양의 등록(임시 칸 없음)이 뒤에 오면 그 값으로 바로 판매 중 — 기다리던 찜이 확정된다
    expect((await worker(world, 'register', { videoId, no: 40, price: 30000, name: '색금', requestId: 'screen-v-40-2' })).body).toMatchObject({ changed: true })
    view = await day(world, shop)
    expect(view.products.find((p) => p.no === 40)).toMatchObject({ status: 'SOLD', price: 30000, winners: ['UC_A'] })
  })

  it('옛 일꾼(임시 선택지를 모르는)이 보내는 지금 모양의 등록은 지금처럼 바로 판매 중이고 기다리던 찜이 그 값으로 확정된다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '237')
    const made = await worker(world, 'register', { videoId, no: 237, price: 10000, name: '녹색금', heard: '자 237 만원에 드릴게요', conf: 0.9, requestId: 'screen-v-237-1' })
    expect(made.body).toMatchObject({ ok: true, changed: true })
    expect(made.body).not.toHaveProperty('tentative')
    const row = await product(world, shop, 237)
    expect(row).toMatchObject({ status: 'SOLD', price: 10000, winners: ['UC_A'] })
    expect(row).not.toHaveProperty('tentative')
  })

  it('요청 모양: 임시 칸이 틀리면 400이고 아무것도 쓰지 않는다. 확정·거두기도 토큰·모양을 본다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    const ok = { videoId, no: 70, price: 10000, requestId: 'screen-v-70-1' }
    for (const tentative of [null, 'yes', [], {}, { reasons: 'A' }, { reasons: ['A'], by: 'WORKER' }, { reasons: ['A'], candidates: [] }, { reasons: [] }, { reasons: ['소문자'] }, { reasons: ['A'], candidates: { no: [1, 2, 3, 4, 5] } }, { reasons: ['A'], candidates: { name: ['010-1234-5678'] } }]) {
      expect((await worker(world, 'register', { ...ok, tentative })).status, JSON.stringify(tentative)).toBe(400)
    }
    expect(await product(world, shop, 70)).toBeUndefined()
    const base = { videoId, no: 70, registerRequestId: 'screen-v-70-1', requestId: 'screen-v-ok-70' }
    for (const body of [{ ...base, extra: 1 }, { ...base, no: 0 }, { ...base, requestId: 'x' }, { ...base, registerRequestId: undefined }, { ...base, to: 0 }, { ...base, price: 1.5 }, { ...base, name: 'ㄱ'.repeat(61) }]) {
      expect((await worker(world, 'confirm', body)).status, JSON.stringify(body)).toBe(400)
    }
    // 거두기는 최종 값을 받지 않는다
    expect((await worker(world, 'withdraw', { ...base, price: 1000 })).status).toBe(400)
    for (const path of ['confirm', 'withdraw']) {
      const noToken = await world.server.app.request(`/internal/screen/${path}`, { method: 'POST', body: '{}' })
      expect(noToken.status).toBe(401)
      expect((await world.server.app.request(`/internal/screen/${path}`, { method: 'GET', headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
    }
    expect((await worker(world, 'confirm', { ...base, videoId: 'zzzzzzzzzzz' })).status).toBe(404)
  })

  it('임시 등록은 판매자가 지운 번호를 다시 열지 않는다 (다시 열면 확인 없이 바로 판매 중이 된다)', async () => {
    const world = await newWorld({ screenReopenGraceMs: 0 })
    const { shop, videoId } = await host(world)
    await worker(world, 'register', { videoId, no: 394, name: '리마인드', price: 20000, requestId: 'screen-v-394-1' })
    await expectOk(writeEvent(world, shop.seller, { b: shop.b.id, type: 'product.close', no: 394 }))
    const again = await worker(world, 'register', { videoId, no: 394, name: '로라클론', price: 70000, requestId: 'screen-v-394-2', observedAt: Date.now(), tentative: { reasons: ['PRICE_SINGLE_SOURCE'] } })
    expect(again.body).toMatchObject({ changed: false, broadcasts: [{ changed: false, skip: 'CLOSED' }] })
    expect(await product(world, shop, 394)).toMatchObject({ status: 'CLOSED', name: '리마인드', price: 20000 })
  })

  it('같은 영상에 이어진 계정 모두에 임시로 올리고, 일꾼의 확정도 계정마다 한다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await chat(world, b.seller, b.b.id, 'UC_B', '나', '17')
    const made = await worker(world, 'register', { videoId, no: 17, price: 70000, name: '녹금', requestId: 'screen-v-17-1', tentative: { reasons: ['NUMBER_SINGLE_SOURCE'] } })
    expect(made.body.broadcasts).toHaveLength(2)
    for (const shop of [a, b]) expect(await product(world, shop, 17)).toMatchObject({ status: 'READY', tentative: { by: 'WORKER' } })
    expect((await day(world, b)).effects).toEqual([])
    const confirmed = await worker(world, 'confirm', { videoId, no: 17, registerRequestId: 'screen-v-17-1', requestId: 'screen-v-ok-17' })
    expect(confirmed.body.broadcasts).toEqual([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: true })])
    expect(await product(world, a, 17)).toMatchObject({ status: 'OPEN', price: 70000 })
    expect(await product(world, b, 17)).toMatchObject({ status: 'SOLD', price: 70000, winners: ['UC_B'] })
  })
})

describe('D-RETRO-84 지금 볼 라이브의 가격 단위', () => {
  const live = async (world: YoutubeWorld) => {
    const response = await world.server.app.request('/internal/screen/live', { headers: { Authorization: `Bearer ${TOKEN}` } })
    return (await response.json()) as { videos: { videoId: string; priceUnit: string | null }[] }
  }

  it('그 방송의 설정 스냅샷 price.unit을 싣는다. 판매자가 만 원 단위를 골랐으면 TEN_THOUSAND, 같은 영상의 계정끼리 다르면 null', async () => {
    const world = await newWorld()
    const { videoId } = await host(world, { 'price.unit': 'TEN_THOUSAND' })
    expect(await live(world)).toEqual({ videos: [{ videoId, priceUnit: 'TEN_THOUSAND' }] })
    // 다른 계정이 기본 단위(천 원)로 같은 라이브를 이었다 → 서로 달라 일꾼에게 정해 주지 않는다
    await join(world, '두 번째 가게', videoId)
    expect(await live(world)).toEqual({ videos: [{ videoId, priceUnit: null }] })
  })

  it('설정 API는 가격 단위를 받는다 (PATCH /api/settings — 다음에 만드는 방송부터), 기본값은 그대로 THOUSAND', async () => {
    const world = await newWorld()
    const connected = await connectSeller(world)
    const api = client(world, connected.seller.cookie)
    expect((await api.get('/api/settings')).body).toMatchObject({ settings: { 'price.unit': 'THOUSAND' } })
    const saved = await api.patch('/api/settings', { settings: { 'price.unit': 'TEN_THOUSAND' } })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body).toMatchObject({ settings: { 'price.unit': 'TEN_THOUSAND' } })
    const { live: linked } = await linkedBroadcast(world, connected)
    expect(await live(world)).toEqual({ videos: [{ videoId: linked.videoId, priceUnit: 'TEN_THOUSAND' }] })
    expect((await api.patch('/api/settings', { settings: { 'price.unit': 'MILLION' } })).status).toBe(400)
  })
})

describe('D-RETRO-82 판매자 확정 길 — POST /api/events', () => {
  it('판매자는 확인 중 상품을 후보에서 골라(번호·금액·품종) 한 번에 확정하거나, 거둔다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    const api = client(world, shop.seller.cookie)
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '389')
    await worker(world, 'register', { videoId, no: 383, price: 3000, name: '녹음에지는', requestId: 'screen-v-383-1', tentative: { reasons: ['NUMBER_MISMATCH', 'PRICE_DISAGREE'], candidates: { no: [383, 389], price: [3000, 30000], name: ['녹금'] } } })
    await worker(world, 'register', { videoId, no: 90, price: 1000, requestId: 'screen-v-90-1', tentative: { reasons: ['NUMBER_OUT_OF_RANGE'] } })

    // 좌우 단추의 한 번 탭: 번호 389·3만 원·녹금
    const confirmed = await api.post('/api/events', { requestId: 'confirm-383', type: 'product.confirm', b: shop.b.id, no: 383, to: 389, price: 30000, name: '녹금' })
    expect(confirmed.status, confirmed.text).toBe(200)
    expect(confirmed.body).toMatchObject({ type: 'product.confirm', changed: true })
    const row = await product(world, shop, 389)
    expect(row).toMatchObject({ status: 'SOLD', name: '녹금', price: 30000, winners: ['UC_A'] })
    expect(row).not.toHaveProperty('tentative')
    // 같은 요청을 다시 보내도 처음 결과
    expect((await api.post('/api/events', { requestId: 'confirm-383', type: 'product.confirm', b: shop.b.id, no: 383, to: 389 })).body).toMatchObject({ changed: true })
    // 이미 확정한 상품의 확정은 아무 일도 없다
    expect((await api.post('/api/events', { requestId: 'confirm-389-again', type: 'product.confirm', b: shop.b.id, no: 389, price: 1 })).body).toMatchObject({ changed: false })

    const withdrawn = await api.post('/api/events', { requestId: 'withdraw-90', type: 'product.withdraw', b: shop.b.id, no: 90 })
    expect(withdrawn.status, withdrawn.text).toBe(200)
    expect(withdrawn.body).toMatchObject({ type: 'product.withdraw', changed: true })
    expect(await product(world, shop, 90)).toBeUndefined()
  })

  it('화면은 확인 중으로 올리지 못한다(손 등록은 바로 판매 중) — 임시 칸·확정에 없는 칸은 400, 형식이 틀린 값도 400', async () => {
    const world = await newWorld()
    const { shop } = await host(world)
    const api = client(world, shop.seller.cookie)
    const refused = await api.post('/api/events', { requestId: 'reg-t', type: 'product.register', b: shop.b.id, no: 5, name: '', price: 1000, tentative: { by: 'WORKER', reasons: ['A'] } })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await api.post('/api/events', { requestId: 'c-1', type: 'product.confirm', b: shop.b.id, no: 5, stock: 2 })).status).toBe(400)
    expect((await api.post('/api/events', { requestId: 'c-2', type: 'product.confirm', b: shop.b.id, no: 5, price: -1 })).status).toBe(400)
    expect((await api.post('/api/events', { requestId: 'c-3', type: 'product.confirm', b: shop.b.id, no: 5, name: '010-1234-5678' })).status).toBe(400)
    expect((await api.post('/api/events', { requestId: 'w-1', type: 'product.withdraw', b: shop.b.id, no: 5, reason: 'x' })).status).toBe(400)
    // 없는 번호의 확정·거두기는 기록은 하되 아무 일도 없다 (맞지 않는 명령, D-039)
    expect((await api.post('/api/events', { requestId: 'c-4', type: 'product.confirm', b: shop.b.id, no: 5 })).body).toMatchObject({ changed: false })
    expect((await api.post('/api/events', { requestId: 'w-2', type: 'product.withdraw', b: shop.b.id, no: 5 })).body).toMatchObject({ changed: false })
  })

  it('옛 앱의 [공개]도 확정이다: 확인 중에 금액을 고치고 공개하면 그 값으로 기다리던 찜이 확정된다', async () => {
    const world = await newWorld()
    const { shop, videoId } = await host(world)
    await chat(world, shop.seller, shop.b.id, 'UC_A', '가', '21')
    await worker(world, 'register', { videoId, no: 21, price: 2000, name: '리마인드', requestId: 'screen-v-21-1', tentative: { reasons: ['PRICE_SINGLE_SOURCE'] } })
    await expectOk(writeEvent(world, shop.seller, { type: 'product.update', b: shop.b.id, no: 21, price: 20000 }))
    await expectOk(writeEvent(world, shop.seller, { type: 'product.open', b: shop.b.id, no: 21 }))
    const row = await product(world, shop, 21)
    expect(row).toMatchObject({ status: 'SOLD', price: 20000, winners: ['UC_A'] })
    expect(row).not.toHaveProperty('tentative')
  })
})

describe('D-RETRO-83 계정 동기화 — 기다리는 찜은 확인 뒤 확정', () => {
  it('313번 재현: 다른 계정의 1만 원 손 등록이 동기화로 먼저 들어와도 기다리던 찜은 확정되지 않는다 — 확인 중으로 들어오고, 이 계정 판매자가 3만 원으로 확정한다', async () => {
    const world = await newWorld()
    const { shop: test, videoId } = await host(world)
    const main = await join(world, '비트다육', videoId, { 'thanks.liveChat': true })
    // 13:18:28 손님의 찜이 상품보다 먼저 왔다 (복기 6.3)
    await chat(world, main.seller, main.b.id, 'UC_WAIT', '기다린손님', '313')
    // 13:19:21 테스트 계정이 1만 원으로 손 등록 → 그 계정에서는 바로 판매 중, 같은 초에 동기화로 비트다육 계정에 들어온다
    await expectOk(writeEvent(world, test.seller, { type: 'product.register', b: test.b.id, no: 313, name: '빅뱅', price: 10000 }))
    expect(await product(world, test, 313)).toMatchObject({ status: 'OPEN', price: 10000 })
    await world.server.catalog.drain()

    let view = await day(world, main)
    expect(view.products.find((p) => p.no === 313)).toMatchObject({ status: 'READY', name: '빅뱅', price: 10000, winners: [], tentative: { by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'] } })
    // 2026-11-12에는 여기서 1만 원으로 확정돼 2초 안에 감사 채팅과 라벨이 나갔다
    expect(view.claims.filter((c) => c.no === 313).map((c) => [c.buyer, c.status, c.price])).toEqual([['UC_WAIT', 'PENDING', null]])
    expect(view.effects).toEqual([])
    expect(await outboxCount(world)).toBe(0)

    // 1초 뒤 이 계정 판매자가 3만 원으로 확정
    await world.timer.advance(1000)
    const confirmed = await client(world, main.seller.cookie).post('/api/events', { requestId: 'confirm-313', type: 'product.confirm', b: main.b.id, no: 313, price: 30000 })
    expect(confirmed.status, confirmed.text).toBe(200)
    view = await day(world, main)
    expect(view.products.find((p) => p.no === 313)).toMatchObject({ status: 'SOLD', price: 30000, winners: ['UC_WAIT'] })
    expect(view.claims.filter((c) => c.no === 313).map((c) => [c.buyer, c.status, c.price])).toEqual([['UC_WAIT', 'CONFIRMED', 30000]])
    expect(view.effects.filter((e) => e.kind === 'POST_THANKS').map((e) => e.text)).toEqual(['313번 빅뱅 30,000원 기다린손님님 구매 감사합니다'])
    // 확정한 값은 사람이 고친 값으로 다른 계정에도 간다 (이미 판매 중인 계정에는 금액 고침으로)
    await world.server.catalog.drain()
    expect(await product(world, test, 313)).toMatchObject({ status: 'OPEN', price: 30000 })
  })

  it('기다리는 찜이 없는 번호는 지금처럼 바로 판매 중으로 들어온다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await chat(world, b.seller, b.b.id, 'UC_X', '다른번호', '400')
    await expectOk(writeEvent(world, a.seller, { type: 'product.register', b: a.b.id, no: 377, name: '녹금', price: 50000 }))
    await world.server.catalog.drain()
    const row = await product(world, b, 377)
    expect(row).toMatchObject({ status: 'OPEN', name: '녹금', price: 50000 })
    expect(row).not.toHaveProperty('tentative')
  })

  it('한 계정에서 사람이 확정하면 다른 계정의 확인 중 상품도 같은 값으로 확정된다. 옮긴 번호도 따라간다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    await chat(world, b.seller, b.b.id, 'UC_B', '나', '333')
    await worker(world, 'register', { videoId, no: 334, price: 2000, name: '색금', requestId: 'screen-v-334-1', tentative: { reasons: ['NUMBER_MISMATCH', 'PRICE_DISAGREE'], candidates: { no: [334, 333], price: [2000, 20000] } } })
    for (const shop of [a, b]) expect(await product(world, shop, 334)).toMatchObject({ status: 'READY', tentative: { by: 'WORKER' } })
    // 첫 계정 판매자가 [333]·[2만 원]을 골라 확정
    await expectOk(writeEvent(world, a.seller, { type: 'product.confirm', b: a.b.id, no: 334, to: 333, price: 20000 }))
    await world.server.catalog.drain()
    const view = await day(world, b)
    expect(view.products.find((p) => p.no === 334)).toBeUndefined()
    const row = view.products.find((p) => p.no === 333)
    expect(row).toMatchObject({ status: 'SOLD', name: '색금', price: 20000, winners: ['UC_B'] })
    expect(row).not.toHaveProperty('tentative')
  })

  it('옛 앱의 [공개]로 한 확정과 거두기도 다른 계정에 전달된다. 다른 계정이 이미 확정한 상품은 거두지 않는다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    const b = await join(world, '두 번째 가게', videoId)
    for (const no of [1, 2, 3]) await worker(world, 'register', { videoId, no, price: 10000 * no, name: `상품${String(no)}`, requestId: `screen-v-${String(no)}-1`, tentative: { reasons: ['NUMBER_SINGLE_SOURCE'] } })
    // 1번: 첫 계정이 금액을 고치고 공개
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 1, price: 15000 }))
    await expectOk(writeEvent(world, a.seller, { type: 'product.open', b: a.b.id, no: 1 }))
    // 2번: 첫 계정이 거둠
    await expectOk(writeEvent(world, a.seller, { type: 'product.withdraw', b: a.b.id, no: 2 }))
    // 3번: 둘째 계정이 먼저 확정, 그 뒤 첫 계정이 거둠
    await expectOk(writeEvent(world, b.seller, { type: 'product.confirm', b: b.b.id, no: 3 }))
    await world.server.catalog.drain()
    await expectOk(writeEvent(world, a.seller, { type: 'product.withdraw', b: a.b.id, no: 3 }))
    await world.server.catalog.drain()
    const first = await product(world, b, 1)
    expect(first).toMatchObject({ status: 'OPEN', price: 15000 })
    expect(first).not.toHaveProperty('tentative')
    expect(await product(world, b, 2)).toBeUndefined()
    // 둘째 계정의 확정이 먼저 전달돼 첫 계정의 3번도 확정됐다 → 거두기는 아무 일도 없다
    expect(await product(world, a, 3)).toMatchObject({ status: 'OPEN', price: 30000 })
    expect(await product(world, b, 3)).toMatchObject({ status: 'OPEN', price: 30000 })
  })

  it('확인 중인 상품을 사람이 고치면(확정 전) 그 번호가 없는 계정에도 확인 중으로 들어간다', async () => {
    const world = await newWorld()
    const { shop: a, videoId } = await host(world)
    await worker(world, 'register', { videoId, no: 88, price: 8000, name: '', requestId: 'screen-v-88-1', tentative: { reasons: ['NAME_UNSURE'], candidates: { name: ['삼광', '상광'] } } })
    const b = await join(world, '두 번째 가게', videoId)
    await world.server.catalog.drain()
    // 처음 맞추기: 가진 계정이 모두 확인 중이면 새 계정에도 확인 중으로
    expect(await product(world, b, 88)).toMatchObject({ status: 'READY', price: 8000, tentative: { by: 'SYNC', reasons: ['OTHER_ACCOUNT'] } })
    await expectOk(writeEvent(world, a.seller, { type: 'product.update', b: a.b.id, no: 88, name: '삼광' }))
    await world.server.catalog.drain()
    expect(await product(world, b, 88)).toMatchObject({ status: 'READY', name: '삼광', tentative: { by: 'SYNC' } })
    // 처음 맞추기로 옮겨 온 일꾼의 임시 등록은 그 계정에서도 일꾼이 확정한다 (D-RETRO-10과 같은 길)
    const confirmed = await worker(world, 'confirm', { videoId, no: 88, registerRequestId: 'screen-v-88-1', requestId: 'screen-v-ok-88', price: 80000 })
    expect(confirmed.body.broadcasts).toEqual([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: true })])
    // 사람이 고친 품종은 그대로, 금액은 일꾼 값으로
    for (const shop of [a, b]) expect(await product(world, shop, 88)).toMatchObject({ status: 'OPEN', name: '삼광', price: 80000 })
  })

  it('다른 계정의 손 등록으로 들어온 확인 중 상품은 일꾼이 확정·거두지 못한다 (그 계정 판매자가 확정한다)', async () => {
    const world = await newWorld()
    const { shop: test, videoId } = await host(world)
    const main = await join(world, '비트다육', videoId)
    await chat(world, main.seller, main.b.id, 'UC_WAIT', '손님', '313')
    await expectOk(writeEvent(world, test.seller, { type: 'product.register', b: test.b.id, no: 313, name: '빅뱅', price: 10000 }))
    await world.server.catalog.drain()
    // 일꾼의 같은 번호 등록은 이미 있는 번호라 아무 일도 없다(R-2)
    expect((await worker(world, 'register', { videoId, no: 313, price: 10000, requestId: 'screen-v-313-9' })).body).toMatchObject({ changed: false })
    for (const path of ['confirm', 'withdraw'] as const) {
      const tried = await worker(world, path, { videoId, no: 313, registerRequestId: 'screen-v-313-9', requestId: `screen-v-${path}-313` })
      expect((tried.body.broadcasts as { skip?: string }[]).map((r) => r.skip).sort()).toEqual(['NOT_SCREEN', 'NOT_TENTATIVE'])
    }
    expect(await product(world, main, 313)).toMatchObject({ status: 'READY', tentative: { by: 'SYNC' } })
    expect(await claimsOf(world, main, 313)).toEqual([['UC_WAIT', 'PENDING', null]])
  })
})

describe('처음 맞추기 계획 — 확인 중 (planFirstSync, D-RETRO-83)', () => {
  const prov = (by: Prov['by'], at: number): Prov => ({ by, at, ord: at })
  const held = (name: string, price: number, by: Prov['by'], at: number, tentative = false): Held => ({ name, price, closed: false, nameP: prov(by, at), priceP: prov(by, at), stateP: prov(by, at), ...(tentative ? { tentative: true } : {}) })
  const party = (id: string, entries: [number, Held][]): Party => ({ id, seller_id: id, broadcast_id: `b-${id}`, date: '2026-11-12', scope_id: `s-${id}`, held: new Map(entries) })

  it('가진 계정이 모두 확인 중인 번호는 없는 계정에 확인 중으로, 하나라도 확정했으면 평소 등록으로 넣는다', () => {
    const a = party('a', [[1, held('가', 1000, 'worker', 10, true)], [2, held('나', 2000, 'worker', 10, true)]])
    const b = party('b', [[2, held('나', 2000, 'human', 20)]])
    const c = party('c', [])
    const plan = planFirstSync([a, b, c], null, 99).filter((item) => item.to === c).map((item) => item.body)
    expect(plan).toEqual([
      expect.objectContaining({ type: 'product.register', no: 1, tentative: { reasons: ['OTHER_ACCOUNT'] } }),
      expect.objectContaining({ type: 'product.register', no: 2 }),
    ])
    expect(plan[1]).not.toHaveProperty('tentative')
  })
})

describe('상품별 조치 기록 — 확정으로 옮긴 번호·거둔 상품 (productOwners, D-RETRO-80)', () => {
  const row = (type: string, event: Record<string, unknown>, changed = true) => ({ type, event: { b: 'b', ...event }, changed, failed: false })

  it('번호를 옮겨 확정한 상품의 줄은 그 상품으로, 거둔 상품의 줄은 어느 상품에도 넣지 않는다', () => {
    const rows = [
      row('host.reject', { no: 2 }), // 0: 2번에 상품이 생기기 전 — 그 뒤 2번에 처음 생긴 상품(p1)
      row('product.register', { no: 1 }), // 1: p1 (1번에 임시 등록)
      row('product.update', { no: 1 }), // 2: p1
      row('product.confirm', { no: 1, to: 2 }), // 3: p1이 2번으로
      row('product.update', { no: 2 }), // 4: p1
      row('product.register', { no: 1 }), // 5: 1번에 다른 임시 등록 (p2 — 거둠)
      row('product.update', { no: 1 }), // 6: 거둔 상품
      row('product.withdraw', { no: 1 }), // 7: 거둔 상품
      row('product.withdraw', { no: 1 }, false), // 8: 아무 일도 없던 거두기 — 그 뒤 1번에 생긴 상품(p3)
      row('product.register', { no: 1 }), // 9: p3
      row('product.confirm', { no: 1 }), // 10: p3 (번호 그대로)
    ]
    const current = [
      { id: 'p1', broadcast: 'b', no: 2 },
      { id: 'p3', broadcast: 'b', no: 1 },
    ]
    expect(productOwners(rows, current)).toEqual(['p1', 'p1', 'p1', 'p1', 'p1', null, null, null, 'p3', 'p3', 'p3'])
  })
})
