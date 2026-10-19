// AC-S04-25 같은 입력은 한 번만(외부 ID 유일 제약), AC-S04-26 범위별 직렬 처리와 동시 입력
import { applyEvent, checkInvariants, getProduct, getSettlement, initEngine, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { uniqueViolation } from '../src/writer.ts'
import { addSeller, client, countRows, createBroadcast, expectOk, newWorld, rid, startServer, writeEvent, type TestServer } from './support.ts'

async function replay(world: TestServer, date: string): Promise<{ state: EngineState; seqs: number[] }> {
  const result = await world.database.pglite?.query<{ seq: number; body: string; failed: boolean }>(
    `select e.seq, e.body, e.failed from events e join scopes s on s.id = e.scope_id where s.date = $1 order by e.seq`,
    [date],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of result?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return { state, seqs: (result?.rows ?? []).map((row) => row.seq) }
}

describe('AC-S04-25 같은 요청 번호는 한 번만', () => {
  it('차례로 두 번(내용이 달라도): 이벤트 행 하나, 두 응답 모두 처음 결과', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const first = await expectOk(api.post('/api/events', { requestId: 'same-1', type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const second = await expectOk(api.post('/api/events', { requestId: 'same-1', type: 'product.register', b: b.id, no: 2, name: 'b', price: 2000 }))
    const third = await expectOk(api.post('/api/events', { requestId: 'same-1', type: 'host.blockBuyer', buyer: 'x', reason: 'y', extra: 1 }))
    expect(second.body).toEqual(first.body)
    expect(third.body).toEqual(first.body)
    expect(await countRows(world.database, 'events')).toBe(2)
  })

  it('동시에 여러 번: 이벤트 행 하나, 모든 응답이 같은 처음 결과', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api.post('/api/events', { requestId: 'burst-1', type: 'product.register', b: b.id, no: 1 + i, name: 'a', price: 1000 })),
    )
    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(response.body).toEqual(responses[0]?.body)
    }
    expect(await countRows(world.database, 'events')).toBe(2)
  })

  it('입금을 같은 요청 번호로 두 번(동시에도): 받은 금액은 한 번만 는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'hello', ch: 'UC1', nick: '영희', text: '안녕하세요' })
    const api = client(world, seller.cookie)
    const pay = { requestId: 'pay-77', type: 'settlement.payment', buyer: 'UC1', date: b.date, amount: 15000 }
    await Promise.all([api.post(`/api/events?date=${b.date}`, pay), api.post(`/api/events?date=${b.date}`, pay)])
    await api.post(`/api/events?date=${b.date}`, pay)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(getSettlement(state, 'UC1', b.date).received).toBe(15000)
    expect(await countRows(world.database, 'events')).toBe(3)
  })

  it('방송 만들기를 같은 요청 번호로 두 번: 방송은 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const [a, b] = await Promise.all([api.post('/api/broadcasts', { requestId: 'bc-1' }), api.post('/api/broadcasts', { requestId: 'bc-1' })])
    const c = await api.post('/api/broadcasts', { requestId: 'bc-1', title: '다른 제목' })
    expect(a?.status).toBe(200)
    expect(b?.body).toEqual(a?.body)
    expect(c.body).toEqual(a?.body)
    expect((await api.get('/api/broadcasts')).body.broadcasts).toHaveLength(1)
    expect(await countRows(world.database, 'broadcasts')).toBe(1)
  })

  it('같은 채팅 메시지 ID를 여러 번(동시에도): 행 하나, 상태 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const chat = { b: b.id, id: 'msg-1', ch: 'UC1', nick: '영희', text: '1' }
    const results = await Promise.all([world.server.ingestChat(seller.sellerId, chat), world.server.ingestChat(seller.sellerId, chat), world.server.ingestChat(seller.sellerId, { ...chat, text: '2' })])
    expect(results.filter((result) => result.status === 'recorded')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(2)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(await world.server.ingestChat(seller.sellerId, chat)).toEqual({ status: 'duplicate' })
    expect((await world.server.writer.read(seller.sellerId, b.date)).state).toBe(state)
    expect(await countRows(world.database, 'events')).toBe(3)
  })

  it('같은 요청 번호를 서로 다른 범위로 동시에 보내도 이벤트 행은 하나, 두 응답은 처음 결과', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b18 = await createBroadcast(world, seller, { date: '2026-10-18' })
    const b19 = await createBroadcast(world, seller, { date: '2026-10-19' })
    const api = client(world, seller.cookie)
    const [first, second] = await Promise.all([
      api.post('/api/events', { requestId: 'cross-1', type: 'product.register', b: b18.id, no: 1, name: 'a', price: 1 }),
      api.post('/api/events', { requestId: 'cross-1', type: 'product.register', b: b19.id, no: 1, name: 'b', price: 1 }),
    ])
    expect(first?.status).toBe(200)
    expect(second?.body).toEqual(first?.body)
    expect(await countRows(world.database, 'events')).toBe(3)
  })

  it('DB 유일 제약 위반을 제약 이름으로 알아본다 (PGlite·postgres 드라이버 오류 모양)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller)
    let thrown: unknown = null
    try {
      await world.database.db.execute(sql`insert into events (seller_id, scope_id, seq, type, body, at, received_at, actor, changed, digest) select seller_id, scope_id, 1, 'x', '{}', 0, now(), 'server', true, 'd' from events limit 1`)
    } catch (error) {
      thrown = error
    }
    expect(uniqueViolation(thrown)).toBe('events_scope_seq_uq')
    expect(uniqueViolation({ code: '23505', constraint_name: 'events_request_uq' })).toBe('events_request_uq')
    expect(uniqueViolation(new Error('x', { cause: { code: '23505', constraint: 'events_chat_uq' } }))).toBe('events_chat_uq')
    expect(uniqueViolation(new Error('다른 오류'))).toBeNull()
    expect(uniqueViolation({ code: '23503' })).toBeNull()
    expect(uniqueViolation(null)).toBeNull()
  })

  it('이벤트를 남기는 쓰기 요청마다 요청 번호가 필수 (없거나 형식이 틀리면 400, 기록 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    for (const requestId of [undefined, '', 'a b', 'a/b', '한글', 'x'.repeat(65), 12, null]) {
      const event = { ...(requestId === undefined ? {} : { requestId }), type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }
      const response = await api.post('/api/events', event)
      expect(response.status, String(requestId)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_REQUEST_ID' } })
      expect((await api.post(`/api/broadcasts/${b.id}/end`, requestId === undefined ? {} : { requestId })).status).toBe(400)
    }
    expect(await countRows(world.database, 'events')).toBe(1)
    expect((await api.post('/api/events', { requestId: 'A_b-9', type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })).status).toBe(200)
    expect((await api.post('/api/events', { requestId: 'x'.repeat(64), type: 'product.register', b: b.id, no: 2, name: 'a', price: 1 })).status).toBe(200)
  })
})

describe('AC-S04-26 범위별 직렬 처리와 동시 입력', () => {
  it('같은 상품에 채널 50개 채팅 + 문자찜 + 방송자 조치를 한꺼번에: seq 빈틈없음, 1등 1명, 불변식, 메모리 = 재생, 5xx 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    const api = client(world, seller.cookie)
    const tasks: Promise<{ status: number } | { status: string }>[] = []
    for (let i = 0; i < 50; i++) tasks.push(world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i)}`, nick: `시청자${String(i)}`, text: '15' }))
    for (let i = 0; i < 5; i++) tasks.push(api.post('/api/events', { requestId: rid('sms'), type: 'sms', b: b.id, no: 15, received: '12:00:00' }))
    tasks.push(api.post('/api/events', { requestId: rid('h'), type: 'host.cancel', b: b.id, no: 15, buyer: 'UC3', reason: '중복 주문' }))
    tasks.push(api.post('/api/events', { requestId: rid('h'), type: 'product.update', b: b.id, no: 15, price: 12000 }))
    tasks.push(api.post(`/api/events?date=${b.date}`, { requestId: rid('h'), type: 'host.blockBuyer', buyer: 'UC7', reason: '욕설' }))
    const results = await Promise.all(tasks)
    for (const result of results) {
      if (typeof result.status === 'number') expect(result.status).toBeLessThan(500)
      else expect(result.status).toBe('recorded')
    }
    const { state, seqs } = await replay(world, b.date)
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1))
    expect(seqs.length).toBe(2 + 50 + 5 + 3)
    expect(getProduct(state, b.id, 15)?.winners).toHaveLength(1)
    const memory = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(checkInvariants(memory)).toEqual([])
    expect(memory).toEqual(state)
  })

  it('서버 인스턴스 둘이 같은 DB의 같은 범위에 동시에 써도 seq가 겹치지 않고, 최신 로그를 읽은 뒤 두 상태 = 재생 결과', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000, stock: 3 }))
    const other = startServer(world.database, world.masterKey)
    const tasks = []
    for (let i = 0; i < 20; i++) {
      const server = i % 2 === 0 ? world : other
      tasks.push(server.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i)}`, nick: 'n', text: '1' }))
      tasks.push(client(server, seller.cookie).post('/api/events', { requestId: rid('two'), type: 'sms', b: b.id, no: 1, received: '12:00' }))
    }
    const results = await Promise.all(tasks)
    for (const result of results) expect(['recorded', 200]).toContain(result.status)
    const { state, seqs } = await replay(world, b.date)
    expect(seqs).toEqual(Array.from({ length: 42 }, (_, i) => i + 1))
    expect((await world.server.writer.read(seller.sellerId, b.date)).state).toEqual(state)
    expect((await other.server.writer.read(seller.sellerId, b.date)).state).toEqual(state)
    expect(getProduct(state, b.id, 1)?.winners).toHaveLength(3)
  })
})
