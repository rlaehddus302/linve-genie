// AC-S04-60 실시간 푸시 (SSE)
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_TTL_MS } from '../src/auth.ts'
import { addSeller, client, createBroadcast, expectOk, login, newWorld, rid, sseReader, writeEvent, type Seller, type TestServer } from './support.ts'

const open: { cancel: () => Promise<void> }[] = []
const worlds: TestServer[] = []

afterEach(async () => {
  for (const reader of open.splice(0)) await reader.cancel().catch(() => {})
  for (const world of worlds.splice(0)) world.server.close()
})

async function connect(world: TestServer, cookie: string) {
  const response = await world.server.app.request('/api/stream', { headers: { Cookie: cookie } })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const reader = sseReader(response)
  open.push(reader)
  return reader
}

async function world(options: Parameters<typeof newWorld>[0] = {}): Promise<TestServer> {
  const created = await newWorld(options)
  worlds.push(created)
  return created
}

const changes = (reader: ReturnType<typeof sseReader>) => reader.events.filter((event) => event.event === 'change').map((event) => ({ id: event.id, ...(JSON.parse(event.data) as object) }))

describe('AC-S04-60 실시간 푸시', () => {
  it('세션 없이 연결하면 401', async () => {
    const w = await world()
    const response = await w.server.app.request('/api/stream')
    expect(response.status).toBe(401)
  })

  it('연결 직후 판매자의 범위별 지금 seq, 커밋된 입력마다 (범위 날짜, seq, 종류) 알림을 이어지는 id와 함께', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b18 = await createBroadcast(w, seller, { date: '2026-10-18' })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b18.id, no: 1, name: 'a', price: 1 }))
    const reader = await connect(w, seller.cookie)
    await reader.until(() => reader.events.length >= 1)
    expect(reader.events[0]).toMatchObject({ event: 'ready', id: null })
    expect(JSON.parse(reader.events[0]?.data ?? '{}')).toEqual({ scopes: [{ date: '2026-10-18', rehearsal: false, seq: 2 }] })
    const b19 = await createBroadcast(w, seller, { date: '2026-10-19' })
    await w.server.ingestChat(seller.sellerId, { b: b19.id, id: 'm1', ch: 'UC1', nick: 'n', text: '안녕' })
    await reader.until(() => changes(reader).length >= 2)
    expect(changes(reader)).toEqual([
      { id: '1', date: '2026-10-19', rehearsal: false, seq: 1, type: 'broadcast.start' },
      { id: '2', date: '2026-10-19', rehearsal: false, seq: 2, type: 'chat' },
    ])
  })

  it('그 판매자의 모든 연결이 받고, 다른 판매자의 연결은 아무것도 받지 않는다', async () => {
    const w = await world()
    const a = await addSeller(w)
    const b = await addSeller(w)
    const a2 = await login(w, a.loginId, a.password)
    const readers = [await connect(w, a.cookie), await connect(w, a2)]
    const other = await connect(w, b.cookie)
    const broadcast = await createBroadcast(w, a)
    await expectOk(writeEvent(w, a, { type: 'product.register', b: broadcast.id, no: 1, name: 'a', price: 1 }))
    for (const reader of readers) await reader.until(() => changes(reader).length >= 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(other.events.map((event) => event.event)).toEqual(['ready'])
    expect(JSON.parse(other.events[0]?.data ?? '{}')).toEqual({ scopes: [] })
  })

  it('커밋 전·거른 입력·중복 입력은 알림이 없다 (저장 실패 주입 포함)', async () => {
    let fail = false
    const w = await world({
      hooks: {
        beforeCommit: () => {
          if (fail) throw new Error('x')
        },
      },
    })
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    const reader = await connect(w, seller.cookie)
    await reader.until(() => reader.events.length >= 1)
    fail = true
    expect((await writeEvent(w, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 })).status).toBe(500)
    fail = false
    expect((await writeEvent(w, seller, { type: 'product.register', b: b.id, no: 0, name: 'a', price: 1 })).status).toBe(400)
    const body = { requestId: rid(), type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }
    await expectOk(client(w, seller.cookie).post('/api/events', body))
    await expectOk(client(w, seller.cookie).post('/api/events', body))
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    await reader.until(() => changes(reader).length >= 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(changes(reader)).toEqual([
      { id: '1', date: b.date, rehearsal: false, seq: 2, type: 'product.register' },
      { id: '2', date: b.date, rehearsal: false, seq: 3, type: 'chat' },
    ])
  })

  it('30초 이내 간격으로 하트비트를 보낸다', async () => {
    const w = await world({ heartbeatMs: 30 })
    const seller = await addSeller(w)
    const reader = await connect(w, seller.cookie)
    await reader.until(() => reader.comments.length >= 2, 2000)
    expect(reader.comments[0]).toBe(': ping')
    await expect(newWorld({ heartbeatMs: 30_001 })).rejects.toThrow(/30초/)
  })

  it('로그아웃하면 그 세션의 연결이 닫힌다 (다른 세션의 연결은 그대로)', async () => {
    const w = await world()
    const seller: Seller = await addSeller(w)
    const second = await login(w, seller.loginId, seller.password)
    const mine = await connect(w, seller.cookie)
    const theirs = await connect(w, second)
    await mine.until(() => mine.events.length >= 1)
    await expectOk(client(w, seller.cookie).post('/api/logout', {}))
    await mine.until(() => mine.closed)
    expect(mine.closed).toBe(true)
    expect(theirs.closed).toBe(false)
    expect(w.server.hub.size).toBe(1)
  })

  it('세션이 만료되면 다음 하트비트에서 연결을 닫는다', async () => {
    const w = await world({ heartbeatMs: 20 })
    const seller = await addSeller(w)
    const reader = await connect(w, seller.cookie)
    await reader.until(() => reader.comments.length >= 1)
    w.clock.advance(SESSION_TTL_MS + 1)
    await reader.until(() => reader.closed, 2000)
    expect(w.server.hub.size).toBe(0)
  })
})
