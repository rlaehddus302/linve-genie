// O2 적대 시험 (test-domain, AC-O2-63): 서버 API로 옵션 방송의 새 칸·새 이벤트·확인 필요 조회를 공격한다.
// - 판매자 입력 오류는 400 쉬운 한국어이고 로그·상태가 바뀌지 않는다
// - 아무 일도 없는 조치는 changed=false이고 상태가 같다
// - 판매자 경계·방송 경계를 넘지 않는다, 같은 요청 ID는 한 번만 기록된다(동시 요청 포함)
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자는 실제 범위의 확인 필요 조회도 403"을 뺐다
import { listClaims, listProducts, listReviews, type EngineState } from '@livejjim/core'
import { OPTION_MESSAGES, SALE_MODE_MESSAGE, type ReviewsView } from '@livejjim/server'
import { describe, expect, it } from 'vitest'
import { addSeller, client, countRows, expectOk, newWorld, rid, writeEvent, type JsonResponse, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const SIZES = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }]

interface Made {
  id: string
  date: string
}

async function broadcast(world: TestServer, seller: Seller, input: Record<string, unknown> = {}): Promise<Made> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), ...input })
  expect(response.status, response.text).toBe(200)
  return response.body.broadcast as Made
}

const problemsOf = (response: JsonResponse) => (response.body.error as { problems?: { field: string | null; message: string }[] } | undefined)?.problems ?? []

/** 판정 결과만 견준다 (찜·확인 필요·상품) */
const view = (state: EngineState) => JSON.stringify({ claims: listClaims(state), reviews: listReviews(state), products: listProducts(state) })

async function stateOf(world: TestServer, seller: Seller, date: string): Promise<EngineState> {
  return (await world.server.writer.read(seller.sellerId, date)).state
}

/** 옵션 방송 b(상품 21 반바지 S·M·L 재고 각 5) + 번호 방송 n(상품 1 라울), 확인 필요 m1·m2·m3 (옵션 빠짐) */
async function world3() {
  const world = await newWorld()
  const seller = await addSeller(world)
  const b = await broadcast(world, seller, { saleMode: 'OPTIONS' })
  const n = await broadcast(world, seller)
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { S: 5, M: 5, L: 5 } }))
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: n.id, no: 1, name: '라울', price: 8000 }))
  for (const id of ['m1', 'm2', 'm3']) await world.server.ingestChat(seller.sellerId, { b: b.id, id, ch: `UC${id}`, nick: id, text: '반바지' })
  return { world, seller, b, n }
}

describe('번호 방송에 옵션 칸·옵션 이벤트 — 빈 값이라도 400이고 기록하지 않는다 (R-19 "판매 방식", D-O2-13)', () => {
  it('빈 options·aliases·stocks, 수량 1, 빈 고른 옵션, 찜 조치의 options, 새 이벤트 셋', async () => {
    const { world, seller, n } = await world3()
    const before = { rows: await countRows(world.database, 'events'), state: view(await stateOf(world, seller, n.date)) }
    const cases: [Record<string, unknown>, string][] = [
      [{ type: 'product.register', b: n.id, no: 2, name: '하월시아', price: 1000, options: [] }, 'options'],
      [{ type: 'product.register', b: n.id, no: 2, name: '하월시아', price: 1000, aliases: [] }, 'aliases'],
      [{ type: 'product.register', b: n.id, no: 2, name: '하월시아', price: 1000, stocks: {} }, 'stocks'],
      [{ type: 'product.update', b: n.id, no: 1, aliases: ['라울이'] }, 'aliases'],
      [{ type: 'sms', b: n.id, no: 1, qty: 1 }, 'qty'],
      [{ type: 'sms', b: n.id, no: 1, options: {} }, 'options'],
      [{ type: 'host.cancel', b: n.id, no: 1, buyer: 'UCm1', reason: '전화 취소', options: {} }, 'options'],
      [{ type: 'host.assign', b: n.id, no: 1, buyer: 'UCm1', reason: '전화', qty: 1 }, 'qty'],
      [{ type: 'product.focus', b: n.id, no: 1 }, 'type'],
      [{ type: 'host.resolveReview', b: n.id, no: 1, item: 'm1', qty: 1 }, 'type'],
      [{ type: 'host.dismissReview', b: n.id, item: 'm1' }, 'type'],
    ]
    for (const [event, field] of cases) {
      const response = await writeEvent(world, seller, event)
      expect(response.status, JSON.stringify(event)).toBe(400)
      expect(problemsOf(response), JSON.stringify(event)).toEqual([{ field, message: OPTION_MESSAGES.notOptionBroadcast }])
    }
    expect(await countRows(world.database, 'events')).toBe(before.rows)
    expect(view(await stateOf(world, seller, n.date))).toBe(before.state)
  })

  it('설정이 옵션 방식이어도 saleMode=NUMBERS로 연 방송은 번호 방송이다 (방송 스냅샷으로 본다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }))
    const n = await broadcast(world, seller, { saleMode: 'NUMBERS' })
    const rows = await countRows(world.database, 'events')
    const response = await writeEvent(world, seller, { type: 'product.register', b: n.id, no: 2, name: '반바지', price: 1000, options: SIZES })
    expect(problemsOf(response)).toEqual([{ field: 'options', message: OPTION_MESSAGES.notOptionBroadcast }])
    expect(await countRows(world.database, 'events')).toBe(rows)
  })
})

describe('saleMode 이상한 값 (AC-O2-05)', () => {
  it('앞뒤 공백·소문자·숫자·객체·리허설과 함께 — 400 그 문장, 방송이 생기지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    for (const saleMode of ['OPTIONS ', ' NUMBERS', 'Options', 'LOOSE', 'ARRIVAL', 0, true, { mode: 'OPTIONS' }]) {
      for (const rehearsal of [false, true]) {
        const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), saleMode, rehearsal })
        expect(response.status, JSON.stringify(saleMode)).toBe(400)
        expect(problemsOf(response)).toEqual([{ field: 'saleMode', message: SALE_MODE_MESSAGE }])
      }
    }
    expect(await countRows(world.database, 'broadcasts')).toBe(0)
    expect(await countRows(world.database, 'events')).toBe(0)
  })
})

describe('설정 — 합친 값으로 막는다 (AC-O2-03)', () => {
  it('옵션 방식이 저장된 판매자가 겨루기만 "실제 시각순"으로 보내도 400이고 설정이 그대로다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }))
    const before = (await api.get('/api/settings')).body
    const response = await api.patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } })
    expect(response.status).toBe(400)
    expect(problemsOf(response)).toEqual([{ field: 'settings.contention.policy', message: '상품명·옵션도 받는 방송은 들어온 순서로만 판정해요' }])
    expect((await api.get('/api/settings')).body).toEqual(before)
    // 번호로 되돌리면서 실제 시각순은 함께 받는다
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'STRICT', 'contention.policy': 'RECEIVED_TIME' } }))
  })
})

describe('판매자 경계·방송 경계 (AC-O2-30·31·63)', () => {
  it('다른 판매자의 방송을 가리킨 바로잡기·지우기·지금 상품은 404이고 그 판매자의 로그·확인 필요가 그대로다', async () => {
    const { world, seller, b } = await world3()
    const stranger = await addSeller(world)
    const before = { rows: await countRows(world.database, 'events'), state: view(await stateOf(world, seller, b.date)) }
    for (const event of [
      { type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } },
      { type: 'host.dismissReview', b: b.id, item: 'm1' },
      { type: 'product.focus', b: b.id, no: 21 },
    ]) {
      expect((await writeEvent(world, stranger, event)).status).toBe(404)
    }
    expect((await client(world, stranger.cookie).get(`/api/reviews?broadcast=${b.id}`)).status).toBe(404)
    expect(await countRows(world.database, 'events')).toBe(before.rows)
    expect(view(await stateOf(world, seller, b.date))).toBe(before.state)
  })

  it('다른 판매자가 같은 메시지 ID(m1)를 제 방송에서 바로잡아도 원래 판매자의 항목은 남는다', async () => {
    const { world, seller, b } = await world3()
    const other = await addSeller(world)
    const ob = await broadcast(world, other, { saleMode: 'OPTIONS' })
    await expectOk(writeEvent(world, other, { type: 'product.register', b: ob.id, no: 21, name: '반바지', price: 15000, options: SIZES }))
    const response = await expectOk(writeEvent(world, other, { type: 'host.resolveReview', b: ob.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } }))
    expect(response.body.changed).toBe(false)
    expect(listReviews(await stateOf(world, seller, b.date)).map((review) => review.item)).toEqual(['m1', 'm2', 'm3'])
  })

  it('같은 판매자의 다른 옵션 방송(b2)을 적어 b의 항목을 바로잡거나 지우면 아무 일도 없다 (상태가 같다)', async () => {
    const { world, seller, b } = await world3()
    const b2 = await broadcast(world, seller, { saleMode: 'OPTIONS' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b2.id, no: 5, name: '수건', price: 3000, options: SIZES }))
    const before = view(await stateOf(world, seller, b.date))
    expect((await expectOk(writeEvent(world, seller, { type: 'host.resolveReview', b: b2.id, no: 5, item: 'm1', qty: 1, options: { 사이즈: 'M' } }))).body.changed).toBe(false)
    expect((await expectOk(writeEvent(world, seller, { type: 'host.dismissReview', b: b2.id, item: 'm2' }))).body.changed).toBe(false)
    expect(view(await stateOf(world, seller, b.date))).toBe(before)
  })
})

describe('같은 요청 ID·동시 요청 (AC-O2-31)', () => {
  it('같은 요청 ID의 바로잡기 15개를 한꺼번에 보내면 한 번만 기록되고 응답이 모두 같다', async () => {
    const { world, seller, b } = await world3()
    const api = client(world, seller.cookie)
    const rows = await countRows(world.database, 'events')
    const body = { requestId: 'same-resolve', type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } }
    const responses = await Promise.all(Array.from({ length: 15 }, () => api.post('/api/events', body)))
    for (const response of responses) expect(response.status, response.text).toBe(200)
    expect(new Set(responses.map((response) => JSON.stringify(response.body))).size).toBe(1)
    expect(responses[0]?.body.changed).toBe(true)
    expect(await countRows(world.database, 'events')).toBe(rows + 1)
    expect(listClaims(await stateOf(world, seller, b.date)).filter((claim) => claim.buyer === 'UCm1')).toHaveLength(1)
  })

  it('다른 요청 ID로 같은 항목을 동시에 15번(변형도 다르게) 바로잡아도 찜은 하나, 나머지는 changed=false', async () => {
    const { world, seller, b } = await world3()
    const api = client(world, seller.cookie)
    const responses = await Promise.all(
      Array.from({ length: 15 }, (_, i) => api.post('/api/events', { requestId: rid('race'), type: 'host.resolveReview', b: b.id, no: 21, item: 'm2', qty: 1, options: { 사이즈: i % 2 === 0 ? 'S' : 'L' } })),
    )
    expect(responses.map((response) => response.status)).toEqual(Array(15).fill(200))
    expect(responses.filter((response) => response.body.changed === true)).toHaveLength(1)
    const state = await stateOf(world, seller, b.date)
    expect(listClaims(state).filter((claim) => claim.buyer === 'UCm2')).toHaveLength(1)
    expect(listReviews(state).map((review) => review.item)).toEqual(['m1', 'm3'])
  })
})

describe('이미 지운 항목·없는 항목 (AC-O2-63)', () => {
  it('지운 항목 바로잡기·두 번 지우기·없는 항목은 기록되고 changed=false, 상태가 같다', async () => {
    const { world, seller, b } = await world3()
    expect((await expectOk(writeEvent(world, seller, { type: 'host.dismissReview', b: b.id, item: 'm1', reason: '주문 아님' }))).body.changed).toBe(true)
    const before = { rows: await countRows(world.database, 'events'), state: view(await stateOf(world, seller, b.date)) }
    for (const event of [
      { type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } },
      { type: 'host.dismissReview', b: b.id, item: 'm1' },
      { type: 'host.resolveReview', b: b.id, no: 21, item: 'sms:없는항목', qty: 1, options: { 사이즈: 'M' } },
      { type: 'host.dismissReview', b: b.id, item: 'nope' },
    ]) {
      expect((await expectOk(writeEvent(world, seller, event))).body.changed, JSON.stringify(event)).toBe(false)
    }
    expect(await countRows(world.database, 'events')).toBe(before.rows + 4)
    expect(view(await stateOf(world, seller, b.date))).toBe(before.state)
  })
})

describe('신뢰할 수 없는 글 — 닉네임·댓글 HTML (AC-O2-51·63)', () => {
  it('리허설 가짜 채팅의 HTML 닉네임·댓글은 확인 필요 조회에 글자 그대로(JSON) 실린다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const rb = await broadcast(world, seller, { saleMode: 'OPTIONS', rehearsal: true })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: rb.id, no: 1, name: '모자', price: 5000, options: SIZES }))
    const nick = '<img src=x onerror=alert(1)>'
    const text = '모자 "><b>굵게'
    await expectOk(api.post(`/api/broadcasts/${rb.id}/rehearsal/chat`, { requestId: rid('rc'), nick, text, channel: 'sim_1' }))
    const response = await expectOk(api.get(`/api/reviews?broadcast=${rb.id}&rehearsal=true`))
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    const reviews = (response.body as unknown as ReviewsView).reviews
    expect(reviews.map((review) => [review.buyerName, review.text])).toEqual([[nick, text]])
  })
})

describe('TD-O2-001 바로잡은 찜의 채팅 메시지 항목 — orders는 optionOrders의 번호 (dev-notes 계약 7)', () => {
  it('확인 필요(옵션 빠짐)를 M으로 바로잡으면 그 메시지의 optionOrders에 찜이 생기고 orders도 [21]이다', async () => {
    const { world, seller, b } = await world3()
    await expectOk(writeEvent(world, seller, { type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } }))
    const messages = (await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}/messages`))).body.messages as { id: string; orders: number[]; optionOrders: { no: number; variant: string | null }[]; review: unknown }[]
    const m1 = messages.find((message) => message.id === 'm1')
    expect(m1?.optionOrders).toMatchObject([{ no: 21, variant: 'M', qty: 1 }])
    expect(m1?.review).toBeNull()
    // 계약: "orders는 optionOrders의 번호다" — 지금은 받을 때 주문이 아니었다는 이유로 [] (화면은 order=false라 "찜으로 바꾸기"를 보일 수 있다)
    expect(m1?.orders).toEqual([...new Set(m1?.optionOrders.map((item) => item.no))])
  })
})
