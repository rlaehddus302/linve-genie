// O2 서버: 판매 방식·옵션 입력·지금 상품·확인 필요 조회·쓰기·실시간·재시작 (AC-O2-03·05·11·14·16·17·18·21·24·30·31·32·54)
import { STATE_FORMAT, getBroadcast, getProduct, listReviews } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { OPTION_MESSAGES } from '../src/messages-options.ts'
import { addSeller, client, countRows, expectOk, newWorld, rid, sseReader, startServer, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

const SIZES = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }]

async function broadcast(world: TestServer, seller: Seller, input: Record<string, unknown> = {}): Promise<{ id: string; date: string; rehearsal: boolean; response: JsonResponse }> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), ...input })
  expect(response.status, response.text).toBe(200)
  const created = response.body.broadcast as { id: string; date: string; rehearsal: boolean }
  return { ...created, response }
}

async function eventRows(world: TestServer): Promise<{ seq: number; type: string; body: Record<string, unknown> }[]> {
  const result = await world.database.pglite?.query<{ seq: number; type: string; body: string }>(`select seq, type, body from events order by id`)
  return (result?.rows ?? []).map((row) => ({ seq: row.seq, type: row.type, body: JSON.parse(row.body) as Record<string, unknown> }))
}

const problemsOf = (response: JsonResponse) => ((response.body.error as { problems?: { field: string | null; message: string }[] } | undefined)?.problems ?? [])

/** 옵션 방송 하나와 옵션 상품 21 반바지(S·M·L, 재고 각 1, L 2) */
async function optionWorld(): Promise<{ world: TestServer; seller: Seller; b: { id: string; date: string } }> {
  const world = await newWorld()
  const seller = await addSeller(world)
  const b = await broadcast(world, seller, { saleMode: 'OPTIONS' })
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { S: 1, M: 1, L: 2 } }))
  return { world, seller, b }
}

describe('AC-O2-03 설정 API가 함께 둘 수 없는 값을 막는다', () => {
  it('옵션 방식 + 실제 시각순, 수량 상한 0·100·1.5는 400 쉬운 한국어이고 설정이 바뀌지 않는다. 1~99와 OPTIONS+ARRIVAL은 받는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const before = (await api.get('/api/settings')).body
    const together = await api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'RECEIVED_TIME' } })
    expect(together.status).toBe(400)
    expect(problemsOf(together)).toEqual([{ field: 'settings.contention.policy', message: '상품명·옵션도 받는 방송은 들어온 순서로만 판정해요' }])
    for (const value of [0, 100, 1.5]) {
      const bad = await api.patch('/api/settings', { settings: { 'claim.maxQuantity': value } })
      expect(bad.status).toBe(400)
      expect(problemsOf(bad)).toEqual([{ field: 'settings.claim.maxQuantity', message: '1부터 99까지 숫자로 적어 주세요.' }]) // FB1 D-FB1-18 (g) 범위 문장
    }
    expect((await api.get('/api/settings')).body).toEqual(before)
    for (const value of [1, 99]) expect((await expectOk(api.patch('/api/settings', { settings: { 'claim.maxQuantity': value } }))).body.settings).toMatchObject({ 'claim.maxQuantity': value })
    const options = await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }))
    expect(options.body.settings).toMatchObject({ 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' })
    const back = await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'STRICT' } }))
    expect(back.body.settings).toMatchObject({ 'claim.parseMode': 'STRICT' })
  })

  it('저장된 실제 시각순 위에 옵션 방식만 보내도 합친 값으로 막는다 (그 칸의 문장)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } }))
    const only = await api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS' } })
    expect(only.status).toBe(400)
    expect(problemsOf(only)).toEqual([{ field: 'settings.contention.policy', message: '상품명·옵션도 받는 방송은 들어온 순서로만 판정해요' }])
    expect((await api.get('/api/settings')).body.settings).toMatchObject({ 'claim.parseMode': 'STRICT', 'contention.policy': 'RECEIVED_TIME' })
  })
})

describe('AC-O2-05 방송 시작 창의 판매 방식은 그 방송만', () => {
  it('설정이 번호로만 받기여도 saleMode=OPTIONS면 그 방송 스냅샷만 OPTIONS·ARRIVAL, 다음 방송은 설정 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } }))
    const b1 = await broadcast(world, seller, { saleMode: 'OPTIONS' })
    const b2 = await broadcast(world, seller)
    const b3 = await broadcast(world, seller, { saleMode: 'NUMBERS', rehearsal: true })
    const state = (await world.server.writer.read(seller.sellerId, b1.date)).state
    expect(getBroadcast(state, b1.id)?.settings).toMatchObject({ 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' })
    expect(getBroadcast(state, b2.id)?.settings).toMatchObject({ 'claim.parseMode': 'STRICT', 'contention.policy': 'RECEIVED_TIME' })
    const rehearsal = (await world.server.writer.read(seller.sellerId, b3.date, true)).state
    expect(getBroadcast(rehearsal, b3.id)?.settings).toMatchObject({ 'claim.parseMode': 'STRICT' })
    expect((await api.get('/api/settings')).body.settings).toMatchObject({ 'claim.parseMode': 'STRICT', 'contention.policy': 'RECEIVED_TIME' })
  })

  it('설정이 옵션 방식이면 saleMode=NUMBERS 방송은 STRICT, 적지 않으면 OPTIONS', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS' } }))
    const numbers = await broadcast(world, seller, { saleMode: 'NUMBERS' })
    const plain = await broadcast(world, seller)
    const state = (await world.server.writer.read(seller.sellerId, numbers.date)).state
    expect(getBroadcast(state, numbers.id)?.settings['claim.parseMode']).toBe('STRICT')
    expect(getBroadcast(state, plain.id)?.settings['claim.parseMode']).toBe('OPTIONS')
  })

  it('saleMode에 NUMBERS·OPTIONS 밖의 값은 400이고 아무것도 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    for (const saleMode of ['STRICT', 'options', '', 1, null, ['OPTIONS']]) {
      const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), saleMode })
      expect(response.status).toBe(400)
      expect(problemsOf(response)).toEqual([{ field: 'saleMode', message: '판매 방식은 "번호로만 받기"나 "상품명·옵션도 받기" 중에서 골라 주세요.' }])
    }
    expect(await countRows(world.database, 'events')).toBe(0)
  })
})

describe('AC-O2-11·14·16 옵션·변형 재고·상품 별칭을 붙여 한 번에 등록', () => {
  it('product.register 한 번(옵션 포함) — 엔진 변형 재고가 보낸 stocks와 같고 0은 처음부터 판매 완료, 별칭 둘', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await broadcast(world, seller, { saleMode: 'OPTIONS' })
    const options = [
      { name: '색상', choices: [{ label: '흰색' }, { label: '검정색' }] },
      { name: '크기', choices: [{ label: '대형' }, { label: '소형' }] },
    ]
    const stocks = { '흰색/대형': 3, '흰색/소형': 3, '검정색/대형': 3, '검정색/소형': 0 }
    const response = await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 31, name: '수건', price: 9000, options, stocks, aliases: ['초코과자', '초코'] }))
    expect(response.body.changed).toBe(true)
    const rows = (await eventRows(world)).filter((row) => row.type.startsWith('product.'))
    expect(rows.map((row) => row.type)).toEqual(['product.register'])
    expect(rows[0]?.body).toMatchObject({ options, stocks, aliases: ['초코과자', '초코'] })
    const product = getProduct((await world.server.writer.read(seller.sellerId, b.date)).state, b.id, 31)
    expect(product?.aliases).toEqual(['초코과자', '초코'])
    expect(product?.variants.map((variant) => [variant.text, variant.stock, variant.remaining, variant.status])).toEqual([
      ['흰색/대형', 3, 3, 'OPEN'],
      ['흰색/소형', 3, 3, 'OPEN'],
      ['검정색/대형', 3, 3, 'OPEN'],
      ['검정색/소형', 0, 0, 'SOLD'],
    ])
  })

  it('상품 별칭 11개는 막히고, 휴대폰 번호 모양 별칭은 지금 문장 그대로 거절한다', async () => {
    const { world, seller, b } = await optionWorld()
    const before = await countRows(world.database, 'events')
    const eleven = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 22, name: '과자', price: 1000, aliases: Array.from({ length: 11 }, (_, i) => `별칭${String(i)}`) })
    expect(eleven.status).toBe(400)
    expect(problemsOf(eleven)).toEqual([{ field: 'aliases', message: OPTION_MESSAGES.productAliases }])
    const phone = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 22, name: '과자', price: 1000, aliases: ['01012345678'] })
    expect(phone.status).toBe(400)
    expect(problemsOf(phone)).toEqual([{ field: 'aliases[0]', message: '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.' }])
    expect(await countRows(world.database, 'events')).toBe(before)
  })
})

describe('AC-O2-17 찜이 있는 상품의 옵션 고치기', () => {
  it('선택지 빼기는 기록되지만 changed=false(같은 상태), XL 더하기·L 재고 3은 changed=true', async () => {
    const { world, seller, b } = await optionWorld()
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지 M' })
    const remove = await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 21, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }] }))
    expect(remove.body.changed).toBe(false)
    const add = await expectOk(
      writeEvent(world, seller, { type: 'product.update', b: b.id, no: 21, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }] }], stocks: { L: 3 } }),
    )
    expect(add.body.changed).toBe(true)
    const product = getProduct((await world.server.writer.read(seller.sellerId, b.date)).state, b.id, 21)
    expect(product?.variants.map((variant) => [variant.text, variant.stock])).toEqual([
      ['S', 1],
      ['M', 1],
      ['L', 3],
      ['XL', 1],
    ])
  })
})

describe('AC-O2-18 옵션 입력 오류 문장 (D-O2-13)', () => {
  it('각각 400과 그 문장이고 이벤트 로그·엔진 상태가 바뀌지 않는다. 문장에 영어 칸 이름이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b1 = await broadcast(world, seller)
    const b2 = await broadcast(world, seller, { saleMode: 'OPTIONS' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b2.id, no: 21, name: '반바지', price: 15000, options: SIZES }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b1.id, no: 1, name: '라울', price: 8000 }))
    const before = { rows: await countRows(world.database, 'events'), state: (await world.server.writer.read(seller.sellerId, b1.date)).state }
    const cases: [Record<string, unknown>, { field: string | null; message: string }[]][] = [
      // 번호 방송에 옵션 상품
      [{ type: 'product.register', b: b1.id, no: 2, name: '반바지', price: 1000, options: SIZES }, [{ field: 'options', message: OPTION_MESSAGES.notOptionBroadcast }]],
      // 번호 방송에 모양이 틀린 옵션도 "옵션을 못 쓴다"
      [{ type: 'product.register', b: b1.id, no: 2, name: '반바지', price: 1000, options: [{ name: '', choices: [] }] }, [{ field: 'options', message: OPTION_MESSAGES.notOptionBroadcast }]],
      // 번호 방송에 옵션 이벤트·수량
      [{ type: 'product.focus', b: b1.id, no: 1 }, [{ field: 'type', message: OPTION_MESSAGES.notOptionBroadcast }]],
      [{ type: 'sms', b: b1.id, no: 1, qty: 2 }, [{ field: 'qty', message: OPTION_MESSAGES.notOptionBroadcast }]],
      [{ type: 'host.resolveReview', b: b1.id, no: 1, item: 'm1', qty: 1 }, [{ field: 'type', message: OPTION_MESSAGES.notOptionBroadcast }]],
      // 별칭이 겹치는 옵션 (비교 글자 — 영문 소문자·공백 빼기)
      [
        { type: 'product.register', b: b2.id, no: 22, name: '티', price: 9000, options: [{ name: '사이즈', choices: [{ label: 'M' }, { label: 'L', aliases: ['m '] }] }] },
        [{ field: 'options[0].choices[1].aliases[0]', message: '‘m ’이 두 군데 있어요. 한 상품 안에서 이름은 겹치면 안 돼요.' }],
      ],
      // 없는 변형의 재고
      [{ type: 'product.register', b: b2.id, no: 22, name: '티', price: 9000, options: SIZES, stocks: { XL: 1 } }, [{ field: 'stocks', message: '없는 옵션의 재고가 있어요.' }]],
      // 단가가 0 아래
      [
        { type: 'product.register', b: b2.id, no: 22, name: '티', price: 1000, options: [{ name: '사이즈', choices: [{ label: 'S', price: -2000 }] }] },
        [{ field: 'options', message: '가격 차이 때문에 값이 0원보다 작아지는 옵션이 있어요.' }],
      ],
      // 수량 0·11 (최대 10)
      [{ type: 'sms', b: b2.id, no: 21, qty: 0, options: { 사이즈: 'M' } }, [{ field: 'qty', message: '수량은 1부터 10까지예요.' }]],
      [{ type: 'sms', b: b2.id, no: 21, qty: 11, options: { 사이즈: 'M' } }, [{ field: 'qty', message: '수량은 1부터 10까지예요.' }]],
      // 빠진 항목
      [{ type: 'sms', b: b2.id, no: 21, qty: 1 }, [{ field: 'options', message: '사이즈을(를) 골라 주세요.' }]],
      // 아직 없는 상품의 문자찜에 옵션
      [{ type: 'sms', b: b2.id, no: 30, options: { 사이즈: 'M' } }, [{ field: 'options', message: '상품을 먼저 등록해 주세요.' }]],
      // 그 방송에 없는 번호의 바로잡기
      [{ type: 'host.resolveReview', b: b2.id, no: 40, item: 'm1', qty: 1 }, [{ field: 'no', message: '이 방송에 40번 상품이 없어요.' }]],
    ]
    for (const [event, expected] of cases) {
      const response = await writeEvent(world, seller, event)
      expect(response.status, JSON.stringify(event)).toBe(400)
      expect(problemsOf(response), JSON.stringify(event)).toEqual(expected)
      expect(response.headers.get('content-type')).toMatch(/application\/json/)
      for (const problem of problemsOf(response)) expect(problem.message).not.toMatch(/options\[|choices|stocks|claim\.|[A-Za-z_]+\.[A-Za-z_]+/)
    }
    expect(await countRows(world.database, 'events')).toBe(before.rows)
    expect((await world.server.writer.read(seller.sellerId, b1.date)).state).toBe(before.state)
  })

  it('판매자가 적은 겹친 말은 문장에 그대로 넣되 휴대폰 번호처럼 보이면 넣지 않는다 — 응답은 JSON 글이다', async () => {
    const { world, seller, b } = await optionWorld()
    const html = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 22, name: '티', price: 9000, options: [{ name: '사이즈', choices: [{ label: '<b>굵게' }, { label: '<B>굵게' }] }] })
    expect(problemsOf(html)).toEqual([{ field: 'options[0].choices[1].label', message: '‘<B>굵게’이 두 군데 있어요. 한 상품 안에서 이름은 겹치면 안 돼요.' }])
    expect(html.headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('AC-O2-21 지금 상품 쓰기', () => {
  it('product.focus는 바로 기록되고 방송 조회의 focus가 바뀐다. 일시 중지하면 지금 상품이 없어진다', async () => {
    const { world, seller, b } = await optionWorld()
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 22, name: '티셔츠', price: 9000, status: 'READY' }))
    const focus = await expectOk(writeEvent(world, seller, { type: 'product.focus', b: b.id, no: 22 }))
    expect(focus.body).toMatchObject({ type: 'product.focus', changed: true })
    const view = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body as { broadcasts: { id: string; focus: { no: number } | null }[] }
    expect(view.broadcasts.find((item) => item.id === b.id)?.focus?.no).toBe(22)
    // 일시 중지하면 지금 상품이 없어진다 (CMT-05, R-20 6) — 실시간 알림은 product.hold
    await expectOk(writeEvent(world, seller, { type: 'product.open', b: b.id, no: 22 }))
    await expectOk(writeEvent(world, seller, { type: 'product.hold', b: b.id, no: 22 }))
    const after = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body as { broadcasts: { id: string; focus: unknown }[] }
    expect(after.broadcasts.find((item) => item.id === b.id)?.focus).toBeNull()
    // 판매 종료도 같다
    await expectOk(writeEvent(world, seller, { type: 'product.focus', b: b.id, no: 21 }))
    await expectOk(writeEvent(world, seller, { type: 'product.close', b: b.id, no: 21 }))
    const closed = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body as { broadcasts: { id: string; focus: unknown }[] }
    expect(closed.broadcasts.find((item) => item.id === b.id)?.focus).toBeNull()
  })
})

describe('AC-O2-30 확인 필요 조회 API', () => {
  async function reviewWorld() {
    const { world, seller, b } = await optionWorld()
    const other = await broadcast(world, seller, { saleMode: 'OPTIONS', title: '2부' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: other.id, no: 5, name: '수건', price: 3000, options: SIZES }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '<b>홍길동</b>', text: '반바지' })
    await world.server.ingestChat(seller.sellerId, { b: other.id, id: 'x1', ch: 'UC2', nick: '김철수', text: '수건' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC3', nick: '이영희', text: '반바지 L 3개' })
    // 문자찜 — 남은 수량 부족 (L 2개 남음)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 21, qty: 5, options: { 사이즈: 'L' }, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
    return { world, seller, b, other }
  }

  it('엔진 순서 그대로, 항목마다 엔진 칸 + 댓글 글·구매자 이름·방송 날짜·제목. 문자찜 항목은 전화번호 원문이 없다', async () => {
    const { world, seller, b, other } = await reviewWorld()
    const api = client(world, seller.cookie)
    const all = await expectOk(api.get('/api/reviews'))
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    const engine = listReviews(state)
    const reviews = all.body.reviews as Record<string, unknown>[]
    expect(reviews.map((review) => [review.broadcast, review.item, review.reason, review.no, review.qty])).toEqual(engine.map((review) => [review.broadcast, review.item, review.reason, review.no, review.qty]))
    expect(reviews.map((review) => review.reason)).toEqual(['OPTION_MISSING', 'OPTION_MISSING', 'STOCK_SHORT', 'STOCK_SHORT'])
    expect(reviews[0]).toMatchObject({ broadcast: b.id, item: 'm1', text: '반바지', buyerName: '<b>홍길동</b>', broadcastDate: b.date, broadcastTitle: '1부', date: b.date, rehearsal: false, product: `${b.id}/21`, options: null, qty: null, received: null, phoneLast4: null })
    expect(reviews[1]).toMatchObject({ broadcast: other.id, broadcastTitle: '2부', text: '수건', buyerName: '김철수' })
    expect(reviews[2]).toMatchObject({ item: 'm2', options: [['사이즈', 'L']], qty: 3 })
    const sms = reviews[3] as Record<string, unknown>
    expect(sms).toMatchObject({ origin: 'sms', text: '이모', received: '12:00', phoneLast4: '6666', qty: 5, options: [['사이즈', 'L']] })
    expect(all.text).not.toMatch(/010-?5555|01055556666|phoneKey/)
    expect(typeof sms.at).toBe('string')
    // 상품·방송 재료 (변형 남은 수량)
    const products = all.body.products as { key: string; variants: { text: string; remaining: number }[] }[]
    expect(products.find((product) => product.key === `${b.id}/21`)?.variants.map((variant) => [variant.text, variant.remaining])).toEqual([
      ['S', 1],
      ['M', 1],
      ['L', 2],
    ])
    expect((all.body.broadcasts as { id: string }[]).map((item) => item.id).sort()).toEqual([b.id, other.id].sort())
    // 방송으로 거르기
    const one = await expectOk(api.get(`/api/reviews?broadcast=${b.id}`))
    expect((one.body.reviews as { item: string }[]).map((review) => review.item)).toEqual(['m1', 'm2', expect.stringMatching(/^sms:/) as unknown as string])
    expect((one.body.broadcasts as { id: string }[]).map((item) => item.id)).toEqual([b.id])
  })

  it('다른 판매자의 방송은 404, 다른 판매자의 목록은 비어 있다. 리허설 항목은 리허설 범위에만', async () => {
    const { world, seller, b } = await reviewWorld()
    const stranger = await addSeller(world)
    expect((await client(world, stranger.cookie).get(`/api/reviews?broadcast=${b.id}`)).status).toBe(404)
    expect((await client(world, stranger.cookie).get('/api/reviews')).body.reviews).toEqual([])
    const rehearsal = await broadcast(world, seller, { saleMode: 'OPTIONS', rehearsal: true })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no: 1, name: '모자', price: 5000, options: SIZES }))
    await world.server.ingestChat(seller.sellerId, { b: rehearsal.id, id: 'r1', ch: 'sim_1', nick: '시청자', text: '모자' })
    const api = client(world, seller.cookie)
    expect((await api.get('/api/reviews')).body.reviews as unknown[]).toHaveLength(4)
    const rehearsalList = await expectOk(api.get('/api/reviews?rehearsal=true'))
    expect((rehearsalList.body.reviews as { item: string; rehearsal: boolean }[]).map((review) => [review.item, review.rehearsal])).toEqual([['r1', true]])
    expect((await api.get(`/api/reviews?broadcast=${rehearsal.id}`)).status).toBe(404)
    expect((await api.get(`/api/reviews?broadcast=${rehearsal.id}&rehearsal=true`)).status).toBe(200)
    expect((await api.get('/api/reviews?rehearsal=yes')).status).toBe(400)
  })

  it('번호 방송만 있는 판매자는 빈 목록', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await broadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '라울', price: 8000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '반바지 M' })
    expect((await expectOk(client(world, seller.cookie).get('/api/reviews'))).body).toEqual({ rehearsal: false, reviews: [], products: [], broadcasts: [], scopes: [] })
  })
})

describe('AC-O2-31 바로잡기·지우기 쓰기', () => {
  it('판정 전에 기록되고 changed가 있다. 같은 요청 ID는 같은 결과이고 두 번 기록되지 않는다', async () => {
    const { world, seller, b } = await optionWorld()
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC2', nick: '김철수', text: '반바지 XLL' })
    const api = client(world, seller.cookie)
    const body = { requestId: 'resolve-1', type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } }
    const first = await expectOk(api.post('/api/events', body))
    expect(first.body).toMatchObject({ type: 'host.resolveReview', changed: true })
    const rows = await countRows(world.database, 'events')
    const again = await expectOk(api.post('/api/events', body))
    expect(again.body).toEqual(first.body)
    expect(await countRows(world.database, 'events')).toBe(rows)
    // 이미 바로잡은 항목을 다시(다른 요청 ID): 기록되고 아무 일도 없다
    const stale = await expectOk(api.post('/api/events', { ...body, requestId: 'resolve-2' }))
    expect(stale.body.changed).toBe(false)
    const dismiss = await expectOk(writeEvent(world, seller, { type: 'host.dismissReview', b: b.id, item: 'm2', reason: '주문 아님' }))
    expect(dismiss.body.changed).toBe(true)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(listReviews(state)).toEqual([])
    expect(getProduct(state, b.id, 21)?.variants.find((variant) => variant.text === 'M')?.winners).toEqual(['UC1'])
    // 원래 순위 재료는 원래 메시지 — 기록 순서: 채팅 → 바로잡기
    const types = (await eventRows(world)).map((row) => row.type)
    expect(types.slice(-5)).toEqual(['chat', 'chat', 'host.resolveReview', 'host.resolveReview', 'host.dismissReview'])
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다 — 이 자리의 시험(보조자는 바로잡기·지우기·지금 상품·확인 필요 조회 403, 문자찜으로 생긴 찜만 취소)도 함께 뺐다
})

describe('AC-O2-24 옵션 방송 채팅 항목', () => {
  it('주문은 생긴 찜의 번호·옵션 글·수량, 확인 필요는 사유. 번호 방송의 메시지 항목에는 새 칸이 없다', async () => {
    const { world, seller, b } = await optionWorld()
    const numbers = await broadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: numbers.id, no: 1, name: '라울', price: 8000 }))
    const chats: [string, string][] = [
      ['m1', '반바지 M'],
      ['m2', '반바지 L 2개'],
      ['m3', '반바지'],
      ['m4', '반바지 예뻐요 너무'],
    ]
    for (const [id, text] of chats) await world.server.ingestChat(seller.sellerId, { b: b.id, id, ch: `UC${id}`, nick: id, text })
    await world.server.ingestChat(seller.sellerId, { b: numbers.id, id: 'n1', ch: 'UCn', nick: 'n', text: '1' })
    const messages = (await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}/messages`))).body.messages as Record<string, unknown>[]
    const byId = new Map(messages.map((message) => [message.id, message]))
    expect(byId.get('m1')).toMatchObject({ order: true, orders: [21], optionOrders: [{ no: 21, variant: 'M', qty: 1 }], review: null })
    expect(byId.get('m2')).toMatchObject({ order: true, orders: [21], optionOrders: [{ no: 21, variant: 'L', qty: 2 }], review: null })
    expect(byId.get('m3')).toMatchObject({ order: false, orders: [], optionOrders: [], review: { reason: 'OPTION_MISSING', no: 21, options: null, qty: null } })
    // 상품 이름만 쓴 잡담: 주문·취소·확인 필요가 아니다. 코어 parseOptionComment의 언급은 번호 언급만이라 mentions는 비어 있다(dev-notes "스펙 이의" 1)
    expect(byId.get('m4')).toMatchObject({ order: false, cancel: false, optionOrders: [], review: null, mentions: [] })
    const plain = byId.get('n1') as Record<string, unknown>
    expect(Object.keys(plain)).not.toContain('optionOrders')
    expect(Object.keys(plain)).not.toContain('review')
  })
})

describe('SA-O2-03 바로잡아 찜이 생긴 옵션 방송 메시지는 주문 메시지다 (D-076)', () => {
  it('확인 필요를 M으로 바로잡으면 order=true·orders=[21] — 화면이 찜으로 바꾸기를 다시 보이지 않는다. 지운 항목은 주문이 아니다', async () => {
    const { world, seller, b } = await optionWorld()
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm3', ch: 'UC3', nick: '이영희', text: '반바지' })
    await expectOk(writeEvent(world, seller, { type: 'product.focus', b: b.id, no: 21 }))
    await expectOk(writeEvent(world, seller, { type: 'host.resolveReview', b: b.id, no: 21, item: 'm1', qty: 1, options: { 사이즈: 'M' } }))
    await expectOk(writeEvent(world, seller, { type: 'host.dismissReview', b: b.id, item: 'm3', reason: '주문 아님' }))
    const messages = (await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}/messages`))).body.messages as Record<string, unknown>[]
    const byId = new Map(messages.map((message) => [message.id, message]))
    expect(byId.get('m1')).toMatchObject({ order: true, orders: [21], optionOrders: [{ no: 21, variant: 'M', qty: 1 }], review: null })
    expect(byId.get('m3')).toMatchObject({ order: false, orders: [], optionOrders: [], review: null })
  })
})

describe('RA-O2-01 확인 필요 조회는 채팅 수와 상관없이 방송 표로 옵션 방송만 고른다', () => {
  it('번호 방송·옵션 방송·리허설 옵션 방송이 섞여도 옵션 방송의 범위만, 채팅을 많이 받아도 같은 결과', async () => {
    const { world, seller, b } = await optionWorld()
    const numbers = await broadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: numbers.id, no: 1, name: '라울', price: 8000 }))
    for (let i = 0; i < 30; i++) await world.server.ingestChat(seller.sellerId, { b: numbers.id, id: `n${String(i)}`, ch: `UCn${String(i)}`, nick: 'n', text: '1' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지' })
    const api = client(world, seller.cookie)
    const real = await expectOk(api.get('/api/reviews'))
    expect((real.body.reviews as { item: string }[]).map((review) => review.item)).toEqual(['m1'])
    expect((real.body.scopes as { date: string; rehearsal: boolean }[]).map((scope) => [scope.date, scope.rehearsal])).toEqual([[b.date, false]])
    expect((await expectOk(api.get('/api/reviews?rehearsal=true'))).body.scopes).toEqual([])
  })
})

describe('AC-O2-32 실시간 반영', () => {
  it('확인 필요가 되는 댓글·지우기·지금 상품마다 change 알림이 가고, 증분 조회는 바뀐 메시지를 다시 준다', async () => {
    const { world, seller, b } = await optionWorld()
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 22, name: '티셔츠', price: 9000, status: 'READY' }))
    const response = await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } })
    const reader = sseReader(response)
    const changeTypes = () => reader.events.filter((event) => event.event === 'change').map((event) => (JSON.parse(event.data) as { type: string; date: string }).type)
    await reader.until(() => reader.events.some((event) => event.event === 'ready'))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지' })
    await reader.until(() => changeTypes().includes('chat'))
    const since = (await world.server.writer.read(seller.sellerId, b.date)).seq
    await expectOk(writeEvent(world, seller, { type: 'host.dismissReview', b: b.id, item: 'm1' }))
    await reader.until(() => changeTypes().includes('host.dismissReview'))
    await expectOk(writeEvent(world, seller, { type: 'product.focus', b: b.id, no: 22 }))
    await reader.until(() => changeTypes().includes('product.focus'))
    expect(changeTypes()).toEqual(['chat', 'host.dismissReview', 'product.focus'])
    await reader.cancel()
    const changes = await expectOk(client(world, seller.cookie).get(`/api/days/${b.date}/changes?since=${String(since)}`))
    const touched = (changes.body.messages as { id: string; review: unknown }[]).find((message) => message.id === 'm1')
    expect(touched?.review).toBeNull()
    expect((changes.body.broadcasts as { id: string; focus: { no: number } | null }[]).find((item) => item.id === b.id)?.focus?.no).toBe(22)
  })
})

describe('AC-O2-54 엔진 상태 형식 5와 재시작', () => {
  it('옵션 방송(변형·확인 필요·지금 상품) 기록을 다시 열면 조회가 같다 — 스냅샷에서 이어도, 형식 4 스냅샷이면 재생해서', async () => {
    const world = await newWorld({ snapshotEvery: 3 })
    const seller = await addSeller(world)
    const b = await broadcast(world, seller, { saleMode: 'OPTIONS' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { S: 1, M: 1, L: 2 }, aliases: ['숏팬츠'] }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '반바지 M' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC2', nick: '김철수', text: '반바지' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm3', ch: 'UC3', nick: '이영희', text: '반바지 L 3개' })
    await expectOk(writeEvent(world, seller, { type: 'product.focus', b: b.id, no: 21 }))
    await expectOk(writeEvent(world, seller, { type: 'host.resolveReview', b: b.id, no: 21, item: 'm2', qty: 1, options: { 사이즈: 'S' } }))
    const api = client(world, seller.cookie)
    const snapshot = async (target: ReturnType<typeof client>) => ({
      reviews: (await target.get('/api/reviews')).body,
      view: (await target.get(`/api/days/${b.date}`)).body,
      messages: (await target.get(`/api/days/${b.date}/messages`)).body,
    })
    const before = await snapshot(api)
    expect((before.reviews.reviews as unknown[]).length).toBe(1)
    const formats = await world.database.pglite?.query<{ format: number }>(`select format from snapshots`)
    expect(formats?.rows.length).toBeGreaterThan(0)
    for (const row of formats?.rows ?? []) expect(row.format).toBe(STATE_FORMAT)
    expect(await snapshot(client(startServer(world.database, world.masterKey), seller.cookie))).toEqual(before)
    // 형식 4(옵션 전)로 저장된 스냅샷은 쓰지 않고 로그를 재생해 같은 결과
    await world.database.pglite?.query(`update snapshots set format = 4`)
    const replayed = startServer(world.database, world.masterKey)
    expect(await snapshot(client(replayed, seller.cookie))).toEqual(before)
  })
})
