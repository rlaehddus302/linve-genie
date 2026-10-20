// AC-S06-70 상품별 조치 기록은 상품 기준 (TD-S05-004, ORD-12, DAT-05, R-10 번호 변경, D-095).
// GET /api/days/:date/history?product=<상품 ID>: 그 상품을 대상으로 한 product.*·host.* 이벤트를 seq 순으로. 이벤트마다 그때 그 번호에 있던 상품으로 돌린다.
// - 번호 변경 이벤트는 바뀐 상품의 기록에, 번호 변경 뒤 같은 번호에 새로 등록한 상품의 기록에는 옛 상품의 이벤트가 없다.
// - 그 번호에 상품이 없을 때의 조치(보류 찜 취소 등)는 그 뒤 그 번호에 처음 생긴 상품의 기록에.
// - 다른 판매자·없는 상품 ID는 빈 목록(있는지 알리지 않는다). 이어 받기·개수 상한·응답 모양은 기존 이력 조회와 같다. 방송·번호 거르기는 그대로.
// 정답은 코어로 처음부터 재생한 상태(listProducts)로 손으로 정한 규칙대로 셈한 것과 비교한다(무작위 순서 포함).
import { applyEvent, initEngine, listProducts, type EngineEvent, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { productOwners } from '../src/product-history.ts'
import { MERGED_BODY, RAW_JOIN, addSeller, client, createBroadcast, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'

interface HistoryEvent {
  seq: number
  type: string
  reason: string | null
  fields: Record<string, unknown>
}

async function productHistory(world: TestServer, seller: Seller, productId: string, query = '', date = DAY): Promise<HistoryEvent[]> {
  const response = await expectOk(client(world, seller.cookie).get(`/api/days/${date}/history?product=${encodeURIComponent(productId)}${query}`))
  return response.body.events as HistoryEvent[]
}

async function productsOf(world: TestServer, seller: Seller, date = DAY, rehearsal = false): Promise<{ id: string; broadcast: string; no: number }[]> {
  const view = await expectOk(client(world, seller.cookie).get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`))
  return view.body.products as { id: string; broadcast: string; no: number }[]
}

const idAt = (products: { id: string; broadcast: string; no: number }[], b: string, no: number): string => {
  const found = products.find((product) => product.broadcast === b && product.no === no)
  if (found === undefined) throw new Error(`${b}/${String(no)} 상품이 없다`)
  return found.id
}

describe('AC-S06-70 상품 ID로 거른 조치 기록', () => {
  it('15 → 16 번호 변경 뒤 새 15 등록: 새 15의 기록에 옛 조치가 없고, 16의 기록에 15였을 때의 조치와 번호 변경이 있다. 상품이 없을 때의 조치는 그 뒤 처음 생긴 상품에', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const b = await createBroadcast(world, seller, { date: DAY })
    const other = await createBroadcast(world, seller, { date: DAY })
    const w = async (event: Record<string, unknown>, date?: string) => (await expectOk(writeEvent(world, seller, event, date))).body.seq as number
    const reg15 = await w({ type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 })
    const otherReg = await w({ type: 'product.register', b: other.id, no: 15, name: '다른 방송', price: 1000 })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '15' })
    const cancelOld = await w({ type: 'host.cancel', b: b.id, no: 15, buyer: 'UC1', reason: '시청자 요청' })
    const holdOld = await w({ type: 'product.hold', b: b.id, no: 15 })
    await w({ type: 'host.blockBuyer', buyer: 'UC9', reason: '장난' }, DAY) // 번호 없음 — 어느 상품에도 없다
    const renumber = await w({ type: 'product.renumber', b: b.id, from: 15, to: 16 })
    // 15번이 빈 동안의 문자찜(보류 찜)과 그 보류 찜 취소
    await w({ type: 'sms', b: b.id, no: 15, memo: '김씨' })
    const view = await expectOk(api.get(`/api/days/${DAY}`))
    const pending = (view.body.claims as { buyer: string; no: number; broadcast: string; status: string }[]).find((claim) => claim.broadcast === b.id && claim.no === 15 && claim.status === 'PENDING')
    expect(pending).toBeDefined()
    const cancelPending = await w({ type: 'host.cancel', b: b.id, no: 15, buyer: pending?.buyer, reason: '번호 착오' })
    const reg15New = await w({ type: 'product.register', b: b.id, no: 15, name: '블루', price: 5000 })
    const holdNew = await w({ type: 'product.hold', b: b.id, no: 15 })
    const openOld = await w({ type: 'product.open', b: b.id, no: 16 })

    const products = await productsOf(world, seller)
    const oldId = idAt(products, b.id, 16)
    const newId = idAt(products, b.id, 15)
    const otherId = idAt(products, other.id, 15)
    expect(new Set([oldId, newId, otherId]).size).toBe(3)

    const oldEvents = await productHistory(world, seller, oldId)
    expect(oldEvents.map((event) => [event.seq, event.type])).toEqual([
      [reg15, 'product.register'],
      [cancelOld, 'host.cancel'],
      [holdOld, 'product.hold'],
      [renumber, 'product.renumber'],
      [openOld, 'product.open'],
    ])
    // 번호 변경은 "15번 → 16번"으로 그릴 수 있게 from·to가 있다
    expect(oldEvents[3]?.fields).toMatchObject({ b: b.id, from: 15, to: 16 })
    const newEvents = await productHistory(world, seller, newId)
    expect(newEvents.map((event) => [event.seq, event.type])).toEqual([
      [cancelPending, 'host.cancel'],
      [reg15New, 'product.register'],
      [holdNew, 'product.hold'],
    ])
    expect(newEvents.some((event) => event.seq === cancelOld || event.seq === holdOld)).toBe(false)
    expect((await productHistory(world, seller, otherId)).map((event) => event.seq)).toEqual([otherReg])

    // 응답 모양은 이력 조회와 같다 (phoneKey 없음)
    const all = (await expectOk(api.get(`/api/days/${DAY}/history?limit=500`))).body.events as HistoryEvent[]
    for (const event of [...oldEvents, ...newEvents]) expect(event).toEqual(all.find((item) => item.seq === event.seq))
    const raw = await expectOk(api.get(`/api/days/${DAY}/history?product=${oldId}`))
    expect(Object.keys(raw.body).sort()).toEqual(['date', 'events', 'rehearsal'])
    expect(raw.body).toMatchObject({ date: DAY, rehearsal: false })
    expect(raw.text).not.toContain('phoneKey')

    // 이어 받기·개수
    expect((await productHistory(world, seller, oldId, `&after=${String(cancelOld)}&limit=2`)).map((event) => event.seq)).toEqual([holdOld, renumber])
    expect((await productHistory(world, seller, oldId, '&limit=1')).map((event) => event.seq)).toEqual([reg15])
    expect(await productHistory(world, seller, oldId, `&after=${String(openOld)}`)).toEqual([])

    // 방송·번호 거르기는 계약 그대로 (번호 기준 — 새 15에 옛 조치도 보인다)
    const byNumber = (await expectOk(api.get(`/api/days/${DAY}/history?b=${b.id}&no=15`))).body.events as HistoryEvent[]
    expect(byNumber.map((event) => event.seq)).toEqual([reg15, cancelOld, holdOld, renumber, cancelPending, reg15New, holdNew])
  })

  it('맞지 않은 번호 변경(받는 번호에 이미 상품)은 from의 상품 기록에, 이미 있는 번호의 등록은 그 상품 기록에. 상품이 끝내 생기지 않은 번호의 조치는 어느 상품에도 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const w = async (event: Record<string, unknown>) => (await expectOk(writeEvent(world, seller, event))).body
    const r1 = (await w({ type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 })).seq as number
    const r2 = (await w({ type: 'product.register', b: b.id, no: 2, name: 'b', price: 1000 })).seq as number
    const blocked = await w({ type: 'product.renumber', b: b.id, from: 1, to: 2 })
    expect(blocked.changed).toBe(false)
    const again = await w({ type: 'product.register', b: b.id, no: 1, name: 'c', price: 2000 })
    expect(again.changed).toBe(false)
    const lonely = (await w({ type: 'product.hold', b: b.id, no: 7 })).seq as number
    const products = await productsOf(world, seller)
    expect((await productHistory(world, seller, idAt(products, b.id, 1))).map((event) => event.seq)).toEqual([r1, blocked.seq, again.seq])
    expect((await productHistory(world, seller, idAt(products, b.id, 2))).map((event) => event.seq)).toEqual([r2])
    for (const product of products) expect((await productHistory(world, seller, product.id)).map((event) => event.seq)).not.toContain(lonely)
  })

  it('같은 상품을 여러 번 옮기고(1 → 2 → 1) 빈 번호에 다른 상품이 들어와도 그때의 상품으로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const w = async (event: Record<string, unknown>) => (await expectOk(writeEvent(world, seller, event))).body.seq as number
    const regA = await w({ type: 'product.register', b: b.id, no: 1, name: 'A', price: 1000 })
    const toTwo = await w({ type: 'product.renumber', b: b.id, from: 1, to: 2 })
    const holdEmpty = await w({ type: 'product.hold', b: b.id, no: 1 }) // 1이 빈 동안 — 그 뒤 1에 처음 생기는 상품은 A(다시 옮겨 옴)
    const holdA = await w({ type: 'product.hold', b: b.id, no: 2 })
    const back = await w({ type: 'product.renumber', b: b.id, from: 2, to: 1 })
    const regB = await w({ type: 'product.register', b: b.id, no: 2, name: 'B', price: 1000 })
    const openB = await w({ type: 'product.open', b: b.id, no: 2 })
    const products = await productsOf(world, seller)
    expect((await productHistory(world, seller, idAt(products, b.id, 1))).map((event) => event.seq)).toEqual([regA, toTwo, holdEmpty, holdA, back])
    expect((await productHistory(world, seller, idAt(products, b.id, 2))).map((event) => event.seq)).toEqual([regB, openB])
  })

  it('범위·판매자: 리허설 범위는 rehearsal=true로, 다른 판매자·없는 상품 ID는 빈 목록, 없는 범위는 404, 형식이 틀리거나 b·no와 함께 적으면 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const stranger = await addSeller(world)
    const api = client(world, seller.cookie)
    const real = await createBroadcast(world, seller, { date: DAY })
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const realSeq = (await expectOk(writeEvent(world, seller, { type: 'product.register', b: real.id, no: 1, name: '실제', price: 1000 }))).body.seq as number
    const rehearsalSeq = (await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no: 1, name: '연습', price: 1000 }))).body.seq as number
    const realId = idAt(await productsOf(world, seller), real.id, 1)
    const rehearsalId = idAt(await productsOf(world, seller, DAY, true), rehearsal.id, 1)
    expect((await productHistory(world, seller, realId)).map((event) => [event.seq, event.fields.name])).toEqual([[realSeq, '실제']])
    expect((await productHistory(world, seller, rehearsalId, '&rehearsal=true')).map((event) => [event.seq, event.fields.name])).toEqual([[rehearsalSeq, '연습']])
    // 다른 판매자: 자기 범위가 없으면 404, 있으면 남의 상품 ID는 빈 목록
    const strangerApi = client(world, stranger.cookie)
    expect((await strangerApi.get(`/api/days/${DAY}/history?product=${realId}`)).status).toBe(404)
    await createBroadcast(world, stranger, { date: DAY })
    expect((await expectOk(strangerApi.get(`/api/days/${DAY}/history?product=${realId}`))).body.events).toEqual([])
    expect(await productHistory(world, seller, 'p999')).toEqual([])
    expect((await api.get(`/api/days/2026-01-01/history?product=${realId}`)).status).toBe(404)
    for (const bad of ['?product=', `?product=${'p'.repeat(65)}`, '?product=a%20b', '?product=%ED%95%9C', `?product=${realId}&b=${real.id}&no=1`, `?product=${realId}&no=1`]) {
      const response = await api.get(`/api/days/${DAY}/history${bad}`)
      expect(response.status, bad).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'product' }] } })
    }
  })

  it('조치 이벤트가 많아도(1,000개 넘게) 끝까지 읽어 돌린다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: 'a', price: 1000 }))
    const drafts = Array.from({ length: 1100 }, (_, i) => ({ fields: { type: i % 2 === 0 ? 'product.hold' : 'product.open', b: b.id, no: 2 }, actor: { kind: 'server' as const } }))
    const written = await world.server.writer.write({ sellerId: seller.sellerId, date: DAY, rehearsal: false, createScope: false, requestId: null, build: () => drafts })
    expect(written.kind).toBe('ok')
    const renumber = (await expectOk(writeEvent(world, seller, { type: 'product.renumber', b: b.id, from: 1, to: 3 }))).body.seq as number
    const products = await productsOf(world, seller)
    expect((await productHistory(world, seller, idAt(products, b.id, 3))).map((event) => event.seq)).toEqual([2, renumber])
    const two = await productHistory(world, seller, idAt(products, b.id, 2), '&limit=500')
    expect(two).toHaveLength(500)
    expect(two[0]?.seq).toBe(3)
  })
})

// ── 무작위 순서: 코어 재생으로 손 규칙대로 센 정답과 같다 ─────────────────

type Op =
  | { kind: 'register'; b: number; no: number }
  | { kind: 'renumber'; b: number; from: number; to: number }
  | { kind: 'command'; b: number; no: number; type: 'product.hold' | 'product.open' | 'product.close' }
  | { kind: 'update'; b: number; no: number; price: number }
  | { kind: 'reopen'; b: number; no: number }
  | { kind: 'sms'; b: number; no: number }
  | { kind: 'chat'; b: number; no: number; ch: number }

const NUMBERS = fc.integer({ min: 1, max: 4 })
const BROADCAST = fc.integer({ min: 0, max: 1 })
const OP: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('register' as const), b: BROADCAST, no: NUMBERS }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('renumber' as const), b: BROADCAST, from: NUMBERS, to: NUMBERS }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('command' as const), b: BROADCAST, no: NUMBERS, type: fc.constantFrom('product.hold' as const, 'product.open' as const, 'product.close' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('update' as const), b: BROADCAST, no: NUMBERS, price: fc.integer({ min: 1, max: 9 }).map((n) => n * 1000) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('reopen' as const), b: BROADCAST, no: NUMBERS }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('sms' as const), b: BROADCAST, no: NUMBERS }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('chat' as const), b: BROADCAST, no: NUMBERS, ch: fc.integer({ min: 1, max: 3 }) }) },
)

/** 정답: 기록된 이벤트를 코어로 처음부터 재생하며 이벤트마다 그때의 상품(없으면 그 뒤 그 번호에 처음 생긴 상품)을 센다 */
function expectedOwners(rows: { seq: number; type: string; body: string; failed: boolean }[]): Map<string, number[]> {
  const productAt = (state: EngineState, b: unknown, no: unknown): string | null =>
    listProducts(state).find((product) => product.broadcast === b && product.no === no)?.id ?? null
  let state = initEngine({ broadcasts: [], settings: {} })
  const after: EngineState[] = []
  const before: EngineState[] = []
  const events = rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
  for (const [index, row] of rows.entries()) {
    before.push(state)
    if (!row.failed) state = applyEvent(state, events[index] as unknown as EngineEvent).state
    after.push(state)
  }
  const firstLater = (index: number, b: unknown, no: unknown): string | null => {
    for (let j = index; j < rows.length; j++) {
      const id = productAt(after[j] as EngineState, b, no)
      if (id !== null) return id
    }
    return null
  }
  const owners = new Map<string, number[]>()
  for (const [index, row] of rows.entries()) {
    if (!row.type.startsWith('product.') && !row.type.startsWith('host.')) continue
    const event = events[index] as Record<string, unknown>
    let owner: string | null
    if (row.type === 'product.register') owner = productAt(after[index] as EngineState, event.b, event.no)
    else if (row.type === 'product.renumber') owner = productAt(before[index] as EngineState, event.b, event.from) ?? firstLater(index, event.b, event.from)
    else if (typeof event.b === 'string' && typeof event.no === 'number') owner = productAt(before[index] as EngineState, event.b, event.no) ?? firstLater(index, event.b, event.no)
    else owner = null
    if (owner === null) continue
    owners.set(owner, [...(owners.get(owner) ?? []), row.seq])
  }
  return owners
}

describe('AC-S06-70 무작위 순서 — 코어 재생으로 센 정답과 같다', () => {
  it('등록·번호 변경·상품 명령·다시 판매·문자찜·채팅을 섞어도 상품마다 기록이 정답과 같고, 쪽으로 나눠 받아도 같다', async () => {
    let chatId = 0
    await fc.assert(
      fc.asyncProperty(fc.array(OP, { minLength: 1, maxLength: 24 }), fc.integer({ min: 1, max: 4 }), async (ops, pageSize) => {
        const world = await newWorld()
        const seller = await addSeller(world)
        const broadcasts = [(await createBroadcast(world, seller, { date: DAY })).id, (await createBroadcast(world, seller, { date: DAY })).id]
        for (const op of ops) {
          const b = broadcasts[op.b] as string
          switch (op.kind) {
            case 'register':
              await writeEvent(world, seller, { type: 'product.register', b, no: op.no, name: `상품${String(op.no)}`, price: 1000 })
              break
            case 'renumber':
              await writeEvent(world, seller, { type: 'product.renumber', b, from: op.from, to: op.to })
              break
            case 'command':
              await writeEvent(world, seller, { type: op.type, b, no: op.no })
              break
            case 'update':
              await writeEvent(world, seller, { type: 'product.update', b, no: op.no, price: op.price })
              break
            case 'reopen':
              await writeEvent(world, seller, { type: 'host.reopen', b, no: op.no, reason: '다시' })
              break
            case 'sms':
              await writeEvent(world, seller, { type: 'sms', b, no: op.no })
              break
            case 'chat':
              await world.server.ingestChat(seller.sellerId, { b, id: `c${String(++chatId)}`, ch: `UC${String(op.ch)}`, nick: `시청자${String(op.ch)}`, text: String(op.no) })
              break
          }
          // 대기 찜이 있으면 하나 취소해 보류·승계가 섞이게
          if (op.kind === 'chat' && op.ch === 3) {
            const view = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))
            const waiting = (view.body.claims as { id: string; status: string; broadcast: string; no: number; buyer: string }[]).find((claim) => claim.status === 'PENDING' || claim.status === 'WAITLISTED')
            if (waiting !== undefined) await writeEvent(world, seller, { type: 'host.cancel', b: waiting.broadcast, no: waiting.no, buyer: waiting.buyer, reason: '정리' })
          }
        }
        const rows = ((await world.database.pglite?.query<{ seq: number; type: string; body: string; failed: boolean }>(`select e.seq, e.type, ${MERGED_BODY} as body, e.failed from events e ${RAW_JOIN} order by e.seq`))?.rows ?? []) as {
          seq: number
          type: string
          body: string
          failed: boolean
        }[]
        const expected = expectedOwners(rows)
        const products = await productsOf(world, seller)
        // 지금 상태의 상품 목록은 코어 재생과 같다 (정답의 재료가 맞는지)
        let replayed = initEngine({ broadcasts: [], settings: {} })
        for (const row of rows) if (!row.failed) replayed = applyEvent(replayed, JSON.parse(row.body) as EngineEvent).state
        expect(products.map((product) => product.id).sort()).toEqual(listProducts(replayed).map((product) => product.id).sort())
        for (const product of products) {
          const want = expected.get(product.id) ?? []
          expect((await productHistory(world, seller, product.id, '&limit=500')).map((event) => event.seq), product.id).toEqual(want)
          // 쪽으로 나눠 받아도 같다
          const paged: number[] = []
          for (let afterSeq = 0; ; ) {
            const page = await productHistory(world, seller, product.id, `&after=${String(afterSeq)}&limit=${String(pageSize)}`)
            paged.push(...page.map((event) => event.seq))
            if (page.length < pageSize) break
            afterSeq = page.at(-1)?.seq ?? afterSeq
          }
          expect(paged, product.id).toEqual(want)
        }
      }),
      { numRuns: 25 },
    )
  }, 180_000)

  it('productOwners: 지금 상태와 그 뒤 이벤트만으로 정한다 (앞선 이벤트는 몰라도 된다)', () => {
    const rows = [
      { type: 'product.hold', event: { type: 'product.hold', b: 'b', no: 1 }, changed: false, failed: false },
      { type: 'product.register', event: { type: 'product.register', b: 'b', no: 1 }, changed: true, failed: false },
      { type: 'product.renumber', event: { type: 'product.renumber', b: 'b', from: 1, to: 2 }, changed: true, failed: false },
      { type: 'host.cancel', event: { type: 'host.cancel', b: 'b', no: 1 }, changed: false, failed: false },
      { type: 'host.blockBuyer', event: { type: 'host.blockBuyer', buyer: 'x' }, changed: true, failed: false },
      { type: 'product.register', event: { type: 'product.register', b: 'b', no: 1 }, changed: false, failed: true },
    ]
    expect(productOwners(rows, [{ id: 'p1', broadcast: 'b', no: 2 }])).toEqual(['p1', 'p1', 'p1', null, null, null])
    expect(productOwners(rows.slice(2), [{ id: 'p1', broadcast: 'b', no: 2 }])).toEqual(['p1', null, null, null])
    expect(productOwners([], [])).toEqual([])
  })
})
