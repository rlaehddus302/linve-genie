// QS1 실시간 연결 한도 (SPEC §3 실시간 줄, D-QS1-04): AC-QS1-10~13의 서버 몫.
// (1) 연결마다 아직 내보내지 못한 글 1 MiB — 넘으면 그 연결만 닫는다(읽는 중 모인 알림도 같은 한도). (2) 판매자마다 연결 30개(읽는 중 포함) —
// 넘게 되면 가장 먼저 연 것부터(열린 연결이 먼저). (3) 닫힌 연결은 다시 열어 새 ready로 따라잡는다. 닫는 일은 로그에 판매자 ID·까닭 코드만.
import { afterEach, describe, expect, it } from 'vitest'
import { STREAM_BUFFER_MAX_BYTES, STREAM_SELLER_MAX, StreamHub, type ScopeSeq, type StreamNotice } from '../src/hub.ts'
import type { LogRecord } from '../src/log.ts'
import { addSeller, createBroadcast, newWorld, sseReader, writeEvent, expectOk, type TestServer } from './support.ts'

const hubs: StreamHub[] = []
const readers: ReturnType<typeof sseReader>[] = []
const worlds: TestServer[] = []

afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel().catch(() => {})
  for (const hub of hubs.splice(0)) hub.closeAll()
  for (const world of worlds.splice(0)) world.server.close()
})

function newHub(extra: { onDevice?: (sellerId: string, deviceId: string) => void } = {}): { hub: StreamHub; logs: LogRecord[] } {
  const logs: LogRecord[] = []
  const hub = new StreamHub({ heartbeatMs: 30_000, sessionAlive: () => Promise.resolve(true), log: (record) => logs.push(record), ...extra })
  hubs.push(hub)
  return { hub, logs }
}

function read(response: Response) {
  const reader = sseReader(response)
  readers.push(reader)
  return reader
}

function deferredScopes() {
  let resolve: (scopes: readonly ScopeSeq[]) => void = () => {}
  const promise = new Promise<readonly ScopeSeq[]>((res) => {
    resolve = res
  })
  return { read: () => promise, resolve: (scopes: readonly ScopeSeq[]) => resolve(scopes) }
}

const DATE = '2026-10-25'
const notice = (seq: number): StreamNotice => ({ date: DATE, rehearsal: false, seq, type: 'chat' })
const scopesAt = (seq: number) => () => Promise.resolve([{ date: DATE, rehearsal: false, seq }])
const changes = (reader: ReturnType<typeof sseReader>) => reader.events.filter((event) => event.event === 'change').map((event) => (JSON.parse(event.data) as StreamNotice).seq)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AC-QS1-10 연결마다 쌓이는 양 (D-QS1-04 (1)(3))', () => {
  it('읽지 않는 연결 A만 1 MiB를 넘으면 닫히고, 읽는 연결 B는 빠진 seq 없이 다 받는다. 다시 연 A는 지금 기록의 seq로 시작한다. 로그는 판매자 ID와 까닭만', async () => {
    const { hub, logs } = newHub()
    let lastSeq = 0
    const scopes = () => Promise.resolve([{ date: DATE, rehearsal: false, seq: lastSeq }])
    const a = await hub.open('P', 'session-secret-a', scopes)
    const b = read(await hub.open('P', 'session-secret-b', scopes))
    await b.until(() => b.events.length >= 1)
    expect(hub.size).toBe(2)
    // 알림을 묶음으로 보내고 B가 읽을 틈을 준다 — A는 본문을 읽지 않는다
    const batch = 500
    while (hub.size === 2) {
      const notices = Array.from({ length: batch }, () => notice(++lastSeq))
      hub.publish('P', notices)
      // ready 하나 + change lastSeq개 (매번 전체를 훑지 않게 개수로 기다린다)
      await b.until(() => b.events.length === 1 + lastSeq)
      if (lastSeq > 40_000) throw new Error('A가 닫히지 않았다')
    }
    // 한도 바로 넘을 때 닫혔다 — 대략 1 MiB / 알림 하나 크기
    const sentBytes = lastSeq * new TextEncoder().encode(`id: ${String(lastSeq)}\nevent: change\ndata: ${JSON.stringify(notice(lastSeq))}\n\n`).byteLength
    expect(sentBytes).toBeGreaterThan(STREAM_BUFFER_MAX_BYTES)
    // A의 본문은 끝났다(쌓인 글은 버렸다)
    const reader = (a.body as ReadableStream<Uint8Array>).getReader()
    await expect(reader.read()).rejects.toBeDefined()
    // B는 그 뒤 알림도 모두 받는다
    hub.publish('P', [notice(++lastSeq), notice(++lastSeq)])
    await b.until(() => changes(b).at(-1) === lastSeq)
    expect(changes(b)).toEqual(Array.from({ length: lastSeq }, (_, i) => i + 1))
    expect(b.closed).toBe(false)
    expect(hub.size).toBe(1)
    // 다시 연 A: ready의 seq가 지금 기록의 seq (닫히기 전 알림이 반영됨)
    const again = read(await hub.open('P', 'session-secret-a', scopes))
    await again.until(() => again.events.length >= 1)
    expect(JSON.parse(again.events[0]?.data ?? '{}')).toEqual({ scopes: [{ date: DATE, rehearsal: false, seq: lastSeq }] })
    hub.publish('P', [notice(++lastSeq)])
    await again.until(() => changes(again).length === 1)
    expect(changes(again)).toEqual([lastSeq])
    // 로그 한 줄: 판매자 ID와 까닭 코드만
    expect(logs).toEqual([{ level: 'info', code: 'STREAM_CLOSED', seller: 'P', reason: 'BUFFER_FULL' }])
    expect(JSON.stringify(logs)).not.toContain('session-secret')
  }, 30_000)

  it('이름 붙은 알림(유튜브·출력 등)도 같은 한도로 센다', async () => {
    const { hub } = newHub()
    const a = await hub.open('P', 'h', scopesAt(0))
    expect(a.status).toBe(200)
    expect(hub.size).toBe(1)
    const data = { kind: 'collector', filler: 'ㄱ'.repeat(10_000) }
    for (let i = 0; i < 40 && hub.size === 1; i += 1) hub.publishYoutube('P', data)
    expect(hub.size).toBe(0)
  })
})

describe('AC-QS1-11 ready 전 모인 알림도 같은 한도', () => {
  it('범위 읽기를 붙잡아 둔 새 연결에 1 MiB가 넘게 모이면, 읽기가 끝난 뒤 ready 없이 닫힌 응답이고 모은 것이 남지 않는다. 다른 연결은 그대로', async () => {
    const { hub, logs } = newHub()
    const other = read(await hub.open('P', 'h2', scopesAt(0)))
    await other.until(() => other.events.length >= 1)
    const scopes = deferredScopes()
    const opening = hub.open('P', 'h1', scopes.read)
    expect(hub.pendingSize).toBe(1)
    let seq = 0
    while (logs.length === 0) {
      hub.publish('P', Array.from({ length: 500 }, () => notice(++seq)))
      await other.until(() => other.events.length === 1 + seq)
      if (seq > 40_000) throw new Error('읽는 중 연결이 닫히지 않았다')
    }
    expect(logs).toEqual([{ level: 'info', code: 'STREAM_CLOSED', seller: 'P', reason: 'BUFFER_FULL' }])
    // 닫힌 뒤엔 더 모으지 않는다
    hub.publish('P', [notice(++seq)])
    scopes.resolve([{ date: DATE, rehearsal: false, seq: 0 }])
    const response = await opening
    expect(hub.pendingSize).toBe(0)
    const text = await response.text()
    expect(text).toBe('')
    await other.until(() => changes(other).at(-1) === seq)
    expect(other.closed).toBe(false)
    expect(hub.size).toBe(1)
  }, 30_000)
})

describe('AC-QS1-12 판매자마다 30개, 넘으면 가장 오래된 것부터 (D-QS1-04 (2)(4))', () => {
  it('P의 31번째 연결에 P의 1번(기기 ID 없음)이 닫히고 31번째가 ready를 받는다. Q의 30개는 그대로. 출력 기기 ID를 밝힌 2번은 열린 채', async () => {
    const deviceEvents: string[] = []
    const { hub, logs } = newHub({ onDevice: (sellerId, deviceId) => deviceEvents.push(`${sellerId}:${deviceId}`) })
    expect(STREAM_SELLER_MAX).toBe(30)
    const p: ReturnType<typeof sseReader>[] = []
    // 1번이 가장 먼저 연 것이고 기기 ID 없음, 2번이 출력 기기 ID를 밝힘 (AC-QS1-12 Given, D-QS1-13)
    for (let i = 1; i <= 30; i += 1) p.push(read(await hub.open('P', `p${String(i)}`, scopesAt(0), i === 2 ? { deviceId: 'dev-1' } : {})))
    const q: ReturnType<typeof sseReader>[] = []
    for (let i = 1; i <= 30; i += 1) q.push(read(await hub.open('Q', `q${String(i)}`, scopesAt(0))))
    await Promise.all([...p, ...q].map((reader) => reader.until(() => reader.events.length >= 1)))
    expect(hub.size).toBe(60)
    expect(hub.deviceLive('P', 'dev-1')).toBe(true)
    deviceEvents.length = 0
    const p31 = read(await hub.open('P', 'p31', scopesAt(0)))
    await p31.until(() => p31.events.length >= 1)
    expect(p31.events[0]?.event).toBe('ready')
    await p[0]?.until(() => p[0]?.closed === true)
    expect(p[0]?.closed).toBe(true)
    expect(hub.size).toBe(60)
    expect(deviceEvents).toEqual([])
    expect(hub.deviceLive('P', 'dev-1')).toBe(true)
    expect(logs).toEqual([{ level: 'info', code: 'STREAM_CLOSED', seller: 'P', reason: 'SELLER_LIMIT' }])
    // Q는 하나도 닫히지 않고 알림을 받는다. P의 2~31번도 받는다
    hub.publish('Q', [notice(1)])
    hub.publish('P', [notice(1)])
    await Promise.all([...q, ...p.slice(1), p31].map((reader) => reader.until(() => changes(reader).length === 1)))
    for (const reader of q) expect(reader.closed).toBe(false)
    expect(p[1]?.closed).toBe(false)
  })

  it('범위를 읽는 중인 연결도 30개에 센다 — 열린 연결이 먼저 닫히고, 그다음 읽는 중인 것 중 가장 오래된 것', async () => {
    const { hub } = newHub()
    const live: ReturnType<typeof sseReader>[] = []
    for (let i = 0; i < 28; i += 1) live.push(read(await hub.open('P', `l${String(i)}`, scopesAt(0))))
    await Promise.all(live.map((reader) => reader.until(() => reader.events.length >= 1)))
    const slow1 = deferredScopes()
    const slow2 = deferredScopes()
    const opening1 = hub.open('P', 's1', slow1.read)
    const opening2 = hub.open('P', 's2', slow2.read)
    expect(hub.size + hub.pendingSize).toBe(30)
    // 31·32·33번째: 열린 연결 l0·l1·l2가 닫힌다
    const extra: ReturnType<typeof sseReader>[] = []
    for (let i = 0; i < 3; i += 1) extra.push(read(await hub.open('P', `x${String(i)}`, scopesAt(0))))
    await Promise.all(live.slice(0, 3).map((reader) => reader.until(() => reader.closed)))
    expect(live.slice(3).every((reader) => !reader.closed)).toBe(true)
    // 열린 연결을 모두 읽는 중인 것보다 먼저: 남은 열린 연결 25 + 새로 연 3 = 28, 읽는 중 2
    expect(hub.size).toBe(28)
    expect(hub.pendingSize).toBe(2)
    await Promise.all(extra.map((reader) => reader.until(() => reader.events.length >= 1)))
    slow1.resolve([{ date: DATE, rehearsal: false, seq: 0 }])
    slow2.resolve([{ date: DATE, rehearsal: false, seq: 0 }])
    const r1 = read(await opening1)
    const r2 = read(await opening2)
    await Promise.all([r1, r2].map((reader) => reader.until(() => reader.events.length >= 1)))
    expect(hub.size).toBe(30)
  })

  it('열린 연결이 없고 모두 읽는 중이면 가장 먼저 시작한 읽는 중 연결이 ready 없이 닫힌다', async () => {
    const { hub } = newHub()
    const slow = Array.from({ length: 31 }, () => deferredScopes())
    const openings = slow.map((item, i) => hub.open('P', `s${String(i)}`, item.read))
    expect(hub.pendingSize).toBe(31)
    for (const item of slow) item.resolve([{ date: DATE, rehearsal: false, seq: 0 }])
    const responses = await Promise.all(openings)
    expect(await responses[0]?.text()).toBe('')
    const second = read(responses[1] as Response)
    await second.until(() => second.events.length >= 1)
    expect(second.events[0]?.event).toBe('ready')
    expect(hub.size).toBe(30)
    for (const response of responses.slice(2)) read(response)
  })

  it('한 판매자가 연결을 수백 번 열어도 열린 연결은 30개 이하, 다른 판매자 연결은 닫히지 않는다', async () => {
    const { hub } = newHub()
    const q = read(await hub.open('Q', 'q', scopesAt(0)))
    await q.until(() => q.events.length >= 1)
    for (let i = 0; i < 300; i += 1) {
      const response = await hub.open('P', `p${String(i)}`, scopesAt(0))
      if (i % 3 === 0) await response.body?.cancel()
      expect(hub.size - 1).toBeLessThanOrEqual(30)
    }
    await tick()
    expect(q.closed).toBe(false)
    hub.publish('Q', [notice(1)])
    await q.until(() => changes(q).length === 1)
  })
})

describe('AC-QS1-46 30개를 넘을 때 출력 기기 연결은 마지막에 닫음 (D-QS1-13)', () => {
  it('1번이 출력 기기(dev-1)이고 2~30번은 기기 ID 없음 — 31번째에 2번이 닫히고 1번은 열린 채, onDevice 알림 없음, deviceLive true', async () => {
    const deviceEvents: string[] = []
    const { hub, logs } = newHub({ onDevice: (sellerId, deviceId) => deviceEvents.push(`${sellerId}:${deviceId}`) })
    const p: ReturnType<typeof sseReader>[] = []
    for (let i = 1; i <= 30; i += 1) p.push(read(await hub.open('P', `p${String(i)}`, scopesAt(0), i === 1 ? { deviceId: 'dev-1' } : {})))
    await Promise.all(p.map((reader) => reader.until(() => reader.events.length >= 1)))
    deviceEvents.length = 0
    const p31 = read(await hub.open('P', 'p31', scopesAt(0)))
    await p31.until(() => p31.events.length >= 1)
    expect(p31.events[0]?.event).toBe('ready')
    await p[1]?.until(() => p[1]?.closed === true)
    expect(p[0]?.closed).toBe(false)
    expect(p.slice(2).every((reader) => !reader.closed)).toBe(true)
    expect(hub.size).toBe(30)
    expect(deviceEvents).toEqual([])
    expect(hub.deviceLive('P', 'dev-1')).toBe(true)
    expect(logs).toEqual([{ level: 'info', code: 'STREAM_CLOSED', seller: 'P', reason: 'SELLER_LIMIT' }])
    hub.publish('P', [notice(1)])
    await p[0]?.until(() => changes(p[0] as ReturnType<typeof sseReader>).length === 1)
  })

  it('기기 ID를 밝힌 연결이 1·2번이고 나머지는 없음 — 31·32번째에 3번, 그다음 4번이 닫힌다', async () => {
    const deviceEvents: string[] = []
    const { hub } = newHub({ onDevice: (sellerId, deviceId) => deviceEvents.push(`${sellerId}:${deviceId}`) })
    const p: ReturnType<typeof sseReader>[] = []
    for (let i = 1; i <= 30; i += 1) p.push(read(await hub.open('P', `p${String(i)}`, scopesAt(0), i <= 2 ? { deviceId: `dev-${String(i)}` } : {})))
    await Promise.all(p.map((reader) => reader.until(() => reader.events.length >= 1)))
    deviceEvents.length = 0
    const p31 = read(await hub.open('P', 'p31', scopesAt(0)))
    await p[2]?.until(() => p[2]?.closed === true)
    expect(p[3]?.closed).toBe(false)
    const p32 = read(await hub.open('P', 'p32', scopesAt(0)))
    await p[3]?.until(() => p[3]?.closed === true)
    await Promise.all([p31, p32].map((reader) => reader.until(() => reader.events.length >= 1)))
    expect(p[0]?.closed).toBe(false)
    expect(p[1]?.closed).toBe(false)
    expect(p.slice(4).every((reader) => !reader.closed)).toBe(true)
    expect(hub.size).toBe(30)
    expect(deviceEvents).toEqual([])
    expect(hub.deviceLive('P', 'dev-1')).toBe(true)
    expect(hub.deviceLive('P', 'dev-2')).toBe(true)
  })

  it('30개 모두 기기 ID를 밝힘 — 31번째에 그중 가장 오래된 것이 닫히고 그때만 onDevice로 알린다(다시 열면 deviceLive true). 새 연결은 닫지 않는다', async () => {
    const deviceEvents: string[] = []
    const { hub } = newHub({ onDevice: (sellerId, deviceId) => deviceEvents.push(`${sellerId}:${deviceId}`) })
    const p: ReturnType<typeof sseReader>[] = []
    for (let i = 1; i <= 30; i += 1) p.push(read(await hub.open('P', `p${String(i)}`, scopesAt(0), { deviceId: `dev-${String(i)}` })))
    await Promise.all(p.map((reader) => reader.until(() => reader.events.length >= 1)))
    deviceEvents.length = 0
    // 31번째는 기기 ID 없음 — 기기 ID 없는 연결이 이것뿐이어도 새 연결이라 닫지 않는다
    const p31 = read(await hub.open('P', 'p31', scopesAt(0)))
    await p31.until(() => p31.events.length >= 1)
    expect(p31.events[0]?.event).toBe('ready')
    await p[0]?.until(() => p[0]?.closed === true)
    expect(p.slice(1).every((reader) => !reader.closed)).toBe(true)
    expect(hub.size).toBe(30)
    expect(deviceEvents).toEqual(['P:dev-1'])
    expect(hub.deviceLive('P', 'dev-1')).toBe(false)
    const back = read(await hub.open('P', 'p-dev', scopesAt(1), { deviceId: 'dev-1' }))
    await back.until(() => back.events.length >= 1)
    expect(hub.deviceLive('P', 'dev-1')).toBe(true)
    // 다시 연 dev-1 연결로 31개가 넘어 기기 ID 없는 31번째가 닫힌다
    await p31.until(() => p31.closed)
    expect(hub.size).toBe(30)
  })
})

describe('AC-QS1-13 정상 쓰임은 닫히지 않음', () => {
  it('본문을 바로바로 읽는 연결은 알림 10,000개(합 1 MiB 넘음)를 차례로 보내도 닫히지 않고 순서대로 받는다', async () => {
    const { hub, logs } = newHub()
    const reader = read(await hub.open('P', 'h', scopesAt(0)))
    await reader.until(() => reader.events.length >= 1)
    let seq = 0
    let bytes = 0
    for (let i = 0; i < 10_000; i += 1) {
      const item = { date: DATE, rehearsal: false, seq: ++seq, type: 'claim.accepted.with.long.type.name' }
      bytes += JSON.stringify(item).length + 30
      hub.publish('P', [item])
      if (seq % 500 === 0) await reader.until(() => reader.events.length === 1 + seq)
    }
    await reader.until(() => reader.events.length === 1 + seq)
    expect(bytes).toBeGreaterThan(STREAM_BUFFER_MAX_BYTES)
    expect(changes(reader)).toEqual(Array.from({ length: 10_000 }, (_, i) => i + 1))
    expect(reader.closed).toBe(false)
    expect(logs).toEqual([])
  }, 30_000)
})

describe('서버에 이어 붙임 (/api/stream)', () => {
  it('한 판매자가 실시간 연결을 31개 열면 가장 오래된 것이 닫히고 서버 로그에 판매자 ID와 까닭만 남는다 — 다른 판매자는 그대로', async () => {
    const w = await newWorld()
    worlds.push(w)
    const p = await addSeller(w)
    const q = await addSeller(w)
    const broadcast = await createBroadcast(w, q, { date: '2026-10-19' })
    const qReader = read(await w.server.app.request('/api/stream', { headers: { Cookie: q.cookie } }))
    const pReaders: ReturnType<typeof sseReader>[] = []
    for (let i = 0; i < 31; i += 1) pReaders.push(read(await w.server.app.request('/api/stream', { headers: { Cookie: p.cookie } })))
    await pReaders[0]?.until(() => pReaders[0]?.closed === true)
    expect(pReaders.slice(1).every((reader) => !reader.closed)).toBe(true)
    const closed = w.logs.filter((record) => record.code === 'STREAM_CLOSED')
    expect(closed).toEqual([{ level: 'info', code: 'STREAM_CLOSED', seller: p.sellerId, reason: 'SELLER_LIMIT' }])
    expect(JSON.stringify(closed)).not.toContain(p.cookie.split('=')[1]?.split(';')[0] ?? '###')
    await expectOk(writeEvent(w, q, { type: 'product.register', b: broadcast.id, no: 1, name: 'a', price: 1 }))
    await qReader.until(() => qReader.events.some((event) => event.event === 'change'))
    expect(qReader.closed).toBe(false)
  })
})
