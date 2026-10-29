// 범위 자료 저장소 (웹과 같은 프로토콜): 처음 전체 조회 → change마다 증분 → 410이면 전체 다시 → 실패하면 stale·간격 늘려 다시 → 다시 붙으면 ready seq로 따라잡기.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ScopeStore, retryDelayMs } from '../src/lib/scope-store.ts'
import { BROADCAST, FakeClock, FakeEventSource, FakeServer, changes, claim, flush, fullView, product } from './support.ts'

function setup() {
  const server = new FakeServer()
  server.install()
  server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [BROADCAST] } }))
  const sources: FakeEventSource[] = []
  const clock = new FakeClock()
  const store = new ScopeStore({
    broadcastId: 'b1',
    openStream: () => {
      const source = new FakeEventSource('/api/stream')
      sources.push(source)
      return source
    },
    timer: clock,
  })
  return { server, sources, clock, store }
}

describe('ScopeStore', () => {
  it('방송을 찾고 전체를 받은 뒤 change 알림마다 증분을 덮는다', async () => {
    const { server, sources, store } = setup()
    server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ products: [product(15)] }) }))
    server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 7, { claims: [claim('c1', 15, 'u1')], products: [product(15, { winners: ['u1'], winnerClaims: ['c1'] })] }) }))
    await store.start()
    expect(store.getSnapshot().phase).toBe('ready')
    expect(store.getSnapshot().data?.products.get('b1/15')?.no).toBe(15)
    const source = sources[0]!
    source.open([{ date: '2026-10-29', rehearsal: false, seq: 5 }])
    expect(store.getSnapshot().connection).toBe('open')
    source.emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
    await flush()
    const data = store.getSnapshot().data!
    expect(data.seq).toBe(7)
    expect(data.claims.get('c1')?.status).toBe('CONFIRMED')
    expect(data.products.get('b1/15')?.winners).toEqual(['u1'])
    // 다른 범위의 알림은 무시한다
    const before = server.calls.length
    source.emit('change', { date: '2026-10-28', rehearsal: false, seq: 99, type: 'chat' })
    await flush()
    expect(server.calls.length).toBe(before)
  })

  it('없는 방송이면 missing', async () => {
    const { store } = setup()
    store.stop()
    const other = new ScopeStore({ broadcastId: 'nope', openStream: () => new FakeEventSource('/api/stream') })
    await other.start()
    expect(other.getSnapshot().phase).toBe('missing')
  })

  it('410 RESYNC_REQUIRED면 전체를 다시 받는다', async () => {
    const { server, sources, store } = setup()
    let full = 0
    server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: full++ === 0 ? 5 : 20, products: [product(15)] }) }))
    server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ status: 410, body: { error: { code: 'RESYNC_REQUIRED', message: '전체를 다시 받으세요.' } } }))
    await store.start()
    sources[0]!.open([{ date: '2026-10-29', rehearsal: false, seq: 9 }])
    await flush()
    expect(store.getSnapshot().data?.seq).toBe(20)
    expect(store.getSnapshot().stale).toBe(false)
  })

  it('증분이 실패하면 stale을 보이고 1초부터 두 배씩 다시 시도한다 — 새 알림이 오면 바로', async () => {
    const { server, sources, store, clock } = setup()
    server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: 5 }) }))
    let fail = true
    server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => (fail ? { network: true } : { body: changes(5, 6) }))
    await store.start()
    sources[0]!.open([{ date: '2026-10-29', rehearsal: false, seq: 6 }])
    await flush()
    expect(store.getSnapshot().stale).toBe(true)
    expect(retryDelayMs(1)).toBe(1000)
    expect(retryDelayMs(6)).toBe(30_000)
    const attempts = () => server.callsTo('GET', /changes/).length
    const n = attempts()
    await clock.advance(999)
    expect(attempts()).toBe(n)
    await clock.advance(1)
    expect(attempts()).toBe(n + 1)
    fail = false
    sources[0]!.emit('change', { date: '2026-10-29', rehearsal: false, seq: 6, type: 'chat' })
    await flush()
    expect(store.getSnapshot().stale).toBe(false)
    expect(store.getSnapshot().data?.seq).toBe(6)
  })

  it('끊겼다 다시 붙으면(두 번째 ready) 그 seq로 놓친 변경을 받고 reconnects가 는다', async () => {
    const { server, sources, store } = setup()
    server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: 5 }) }))
    server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 8, { claims: [claim('c9', 3, 'u1')] }) }))
    await store.start()
    const source = sources[0]!
    source.open([{ date: '2026-10-29', rehearsal: false, seq: 5 }])
    source.fail()
    expect(store.getSnapshot().connection).toBe('lost')
    source.open([{ date: '2026-10-29', rehearsal: false, seq: 8 }])
    await flush()
    expect(store.getSnapshot().connection).toBe('open')
    expect(store.getSnapshot().reconnects).toBe(1)
    expect(store.getSnapshot().data?.claims.has('c9')).toBe(true)
  })

  it('sync는 응답 seq까지 따라잡을 때까지 기다린다', async () => {
    const { server, sources, store } = setup()
    server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: 5 }) }))
    server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6) }))
    await store.start()
    sources[0]!.open([{ date: '2026-10-29', rehearsal: false, seq: 5 }])
    await store.sync(6)
    expect(store.getSnapshot().data?.seq).toBe(6)
  })
})
