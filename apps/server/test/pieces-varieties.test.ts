// 상품 개수 ("채홍 3개", D-PIECES-01)와 품종 후보 입구 (D-VARIETY-01) — 사용자 메모 2026-11-13, 개선 계획 E1·E6·B7.
// - 개수: 앱 쓰기(등록·고치기·확정)와 화면 일꾼 입구(등록·확정)가 받는다. 판정·찜 금액과 상관없고(가격은 묶음 하나의 값) 라벨·포장·지난 구매에 "채홍 3개"로 보인다.
// - 품종 후보: GET /api/broadcasts/:id/varieties → { recent(이 방송 최근 등록), frequent(최근 실제 방송들에서 많이 쓴 것) }. 읽기만, 다른 판매자 방송은 404.
import { listClaims } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { buildClaimIndex, productLabelData } from '../src/label-data.ts'
import { lookupOf } from '../src/packing.ts'
import { SCREEN_ENDPOINTS } from '../src/screen/routes.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { VarietyCache, rankTally } from '../src/varieties.ts'
import { chat } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent } from './support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld } from './youtube-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'

interface ProductRow {
  readonly no: number
  readonly name: string
  readonly price: number
  readonly pieces?: number
  readonly winners: string[]
}

describe('D-PIECES-01 상품 개수 — 앱 쓰기', () => {
  it('등록·고치기에 개수를 실으면 상품 조회에 보이고, 찜 금액은 가격 그대로이며, 상품 라벨·포장 품목은 "채홍 3개"로 적는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 66, name: '채홍', price: 20000, pieces: 3 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 67, name: '라울', price: 10000 }))
    await chat(world, seller, b.id, 'UC_A', '손님가', '66')
    const view = await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}`))
    const products = view.body.products as ProductRow[]
    expect(products.find((p) => p.no === 66)).toMatchObject({ name: '채홍', price: 20000, pieces: 3, winners: ['UC_A'] })
    expect(products.find((p) => p.no === 67)).not.toHaveProperty('pieces')
    const claims = view.body.claims as { no: number; status: string; price: number; amount: number }[]
    expect(claims.find((c) => c.no === 66)).toMatchObject({ status: 'CONFIRMED', price: 20000, amount: 20000 })

    const { state } = await world.server.writer.read(seller.sellerId, b.date)
    const claim = listClaims(state).find((c) => c.no === 66)
    expect(claim).toBeDefined()
    const label = productLabelData(state, buildClaimIndex(state), { claim: claim?.id ?? '', version: claim?.confirmVersion ?? 0, buyer: { kind: 'youtube', name: '손님가' } })
    expect(label).toMatchObject({ no: 66, name: '채홍 3개', price: 20000 })
    expect(lookupOf(state).names.get(`${b.id}/66`)).toBe('채홍 3개')

    // 고치기: 1로 고치면 개수 표시가 없어진다. 숫자가 아닌 값·100은 받지 않는다
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 66, pieces: 1 }))
    const after = (await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}`))).body.products as ProductRow[]
    expect(after.find((p) => p.no === 66)).not.toHaveProperty('pieces')
    for (const pieces of [0, 100, '3']) {
      const bad = await writeEvent(world, seller, { type: 'product.update', b: b.id, no: 66, pieces })
      expect(bad.status, JSON.stringify(pieces)).toBe(400)
    }
    // 원문 칸(번호·가격 글)과 함께 보내도 개수가 들어간다 (앱의 고치기 길)
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, noText: '67', priceText: '12000원', name: '라울', pieces: 2 }))
    const raw = (await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}`))).body.products as ProductRow[]
    expect(raw.find((p) => p.no === 67)).toMatchObject({ name: '라울', price: 12000, pieces: 2 })
  })
})

describe('D-PIECES-01 상품 개수 — 화면 일꾼 입구', () => {
  it('등록·확정 입구가 개수를 받고(능력 표에도 있다), 틀린 개수는 400', async () => {
    expect(SCREEN_ENDPOINTS.register.fields).toContain('pieces')
    expect(SCREEN_ENDPOINTS.confirm.fields).toContain('pieces')
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN, sellerDefaults: SELLER_DEFAULTS } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const post = async (path: string, body: unknown) => {
      const response = await world.server.app.request(`/internal/screen/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    const caps = await world.server.app.request('/internal/screen/capabilities', { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(((await caps.json()) as { endpoints: Record<string, { fields: string[] }> }).endpoints.register?.fields).toContain('pieces')
    expect((await post('register', { videoId: live.videoId, no: 66, price: 20000, name: '채홍', pieces: 3, requestId: 'screen-v-66' })).status).toBe(200)
    expect((await post('register', { videoId: live.videoId, no: 68, price: 20000, name: '채홍', pieces: 0, requestId: 'screen-v-68' })).status).toBe(400)
    expect((await post('register', { videoId: live.videoId, no: 69, price: 15000, name: '라울', requestId: 'screen-v-69', tentative: { reasons: ['NAME_UNSURE'] } })).status).toBe(200)
    const confirmed = await post('confirm', { videoId: live.videoId, no: 69, requestId: 'screen-v-69-ok', registerRequestId: 'screen-v-69', name: '라울', pieces: 2 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body).toMatchObject({ changed: true })
    const products = (await expectOk(client(world, connected.seller.cookie).get(`/api/days/${b.date}`))).body.products as ProductRow[]
    expect(products.find((p) => p.no === 66)).toMatchObject({ name: '채홍', pieces: 3 })
    expect(products.find((p) => p.no === 69)).toMatchObject({ name: '라울', pieces: 2 })
  })
})

describe('D-VARIETY-01 품종 후보', () => {
  it('이 방송 최근 등록 품종(최근 것부터)과 최근 실제 방송들에서 많이 쓴 품종(많은 것부터) — 리허설·다른 판매자는 세지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const past1 = await createBroadcast(world, seller, { date: '2026-10-17' })
    const past2 = await createBroadcast(world, seller, { date: '2026-10-18' })
    const rehearsal = await createBroadcast(world, seller, { date: '2026-10-18', rehearsal: true })
    const today = await createBroadcast(world, seller)
    const theirs = await createBroadcast(world, other, { date: '2026-10-18' })
    const add = (s: typeof seller, b: { id: string; date: string; rehearsal: boolean }, no: number, name: string) =>
      expectOk(writeEvent(world, s, { type: 'product.register', b: b.id, no, name, price: 10000 }))
    await add(seller, past1, 1, '채홍')
    await add(seller, past1, 2, '라울')
    await add(seller, past1, 3, '채홍')
    await add(seller, past2, 1, '채홍')
    await add(seller, past2, 2, '빅뱅')
    // 고친 품종은 마지막 이름으로 센다
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: past2.id, no: 2, name: '라울' }))
    for (let no = 1; no <= 5; no++) await add(seller, rehearsal, no, '리허설품종')
    for (let no = 1; no <= 5; no++) await add(other, theirs, no, '남의품종')
    await add(seller, today, 10, '라울')
    await add(seller, today, 11, '핑크프릴')
    await add(seller, today, 12, '라울')

    const view = await expectOk(client(world, seller.cookie).get(`/api/broadcasts/${today.id}/varieties`))
    expect(view.body).toEqual({ recent: ['라울', '핑크프릴'], frequent: ['라울', '채홍', '핑크프릴'] })
    expect((await client(world, other.cookie).get(`/api/broadcasts/${today.id}/varieties`)).status).toBe(404)
    expect((await client(world, seller.cookie).get(`/api/broadcasts/nope/varieties`)).status).toBe(404)
    expect((await client(world, null).get(`/api/broadcasts/${today.id}/varieties`)).status).toBe(401)
  })

  it('지난 날짜의 셈은 잠깐 두었다가 시간이 지나면 다시 센다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const past = await createBroadcast(world, seller, { date: '2026-10-18' })
    const today = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: past.id, no: 1, name: '채홍', price: 10000 }))
    let now = 0
    const cache = new VarietyCache({ now: () => now })
    const read = async () => cache.suggestions(world.database.db, seller.sellerId, today.date, null, today.id)
    expect(await read()).toEqual({ recent: [], frequent: ['채홍'] })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: past.id, no: 2, name: '라울', price: 10000 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: past.id, no: 3, name: '라울', price: 10000 }))
    expect((await read()).frequent).toEqual(['채홍'])
    now += 11 * 60_000
    expect((await read()).frequent).toEqual(['라울', '채홍'])
  })

  it('많이 쓴 차례: 쓴 수 → 최근에 쓴 것', () => {
    expect(rankTally(new Map([['a', [1, 5]], ['b', [2, 1]], ['c', [1, 9]]]))).toEqual(['b', 'c', 'a'])
  })
})
