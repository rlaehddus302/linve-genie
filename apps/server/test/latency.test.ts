// AC-S04-70 지연 (NFR-01): 상품 100개·채팅 3,000건이 있는 범위(PGlite), 실시간 연결 3개에서 입력 200건을 차례로 쓴다(앞 20건은 준비 구간).
// 요청 도착 → 커밋 → 응답의 p99 ≤ 300ms, 커밋 → 세 연결 모두 알림 수신의 p99 ≤ 1초 (최댓값이 아니라 p99).
import { afterAll, describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, sseReader, writeEvent, type TestServer } from './support.ts'

const WARMUP = 20
const MEASURED = 180
const PRODUCTS = 100
const CHATS = 3000

/** p99: 정렬한 표본에서 99% 위치의 값 (최댓값이 아니다) */
export function p99(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? Number.NaN
}

let world: TestServer | null = null
afterAll(() => world?.server.close())

describe('AC-S04-70 지연 (NFR-01)', () => {
  it('p99 계산은 최댓값이 아니다', () => {
    const samples = Array.from({ length: 180 }, (_, i) => i)
    samples.push(10_000, 20_000)
    expect(p99(samples)).toBe(10_000)
    expect(p99(Array.from({ length: 180 }, (_, i) => (i === 179 ? 99_999 : 1)))).toBe(1)
  })

  it('상품 100개·채팅 3,000건 범위, 연결 3개, 입력 200건: 응답 p99 ≤ 300ms, 알림 p99 ≤ 1초', async () => {
    const committedAt = new Map<number, number>()
    world = await newWorld({
      hooks: {
        afterCommit: (records) => {
          const now = performance.now()
          for (const record of records) committedAt.set(record.seq, now)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    for (let no = 1; no <= PRODUCTS; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: `품종${String(no)}`, price: 1000 * no, stock: 2 }))
    for (let i = 0; i < CHATS; i++) {
      const result = await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i % 400)}`, nick: `시청자${String(i % 400)}`, text: String((i % PRODUCTS) + 1) })
      expect(result.status).toBe('recorded')
    }
    const readers: ReturnType<typeof sseReader>[] = []
    for (let i = 0; i < 3; i++) {
      const response = await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } })
      const reader = sseReader(response)
      await reader.until(() => reader.events.length >= 1)
      readers.push(reader)
    }
    const api = client(world, seller.cookie)
    const responseMs: number[] = []
    const seqs: number[] = []
    for (let i = 0; i < WARMUP + MEASURED; i++) {
      const kind = i % 4
      const body =
        kind === 0
          ? { requestId: rid('lat'), type: 'sms', b: b.id, no: (i % PRODUCTS) + 1, received: '12:00', phone: `010-1000-${String(1000 + (i % 50))}` }
          : kind === 1
            ? { requestId: rid('lat'), type: 'product.update', b: b.id, no: (i % PRODUCTS) + 1, price: 2000 + i }
            : kind === 2
              ? { requestId: rid('lat'), type: 'host.cancel', b: b.id, no: (i % PRODUCTS) + 1, buyer: `UC${String(i % 400)}`, reason: '방송자 취소' }
              : { requestId: rid('lat'), type: 'host.confirm', b: b.id, no: (i % PRODUCTS) + 1, buyer: `UC${String(i % 400)}` }
      const started = performance.now()
      const response = await api.post('/api/events', body)
      const finished = performance.now()
      expect(response.status, response.text).toBe(200)
      if (i >= WARMUP) {
        responseMs.push(finished - started)
        seqs.push(response.body.seq as number)
      }
    }
    for (const reader of readers) await reader.until(() => reader.events.some((event) => event.event === 'change' && (JSON.parse(event.data) as { seq: number }).seq === seqs.at(-1)), 5000)
    const notifyMs = seqs.map((seq) => {
      const commit = committedAt.get(seq) as number
      const received = readers.map((reader) => reader.events.find((event) => event.event === 'change' && (JSON.parse(event.data) as { seq: number }).seq === seq)?.receivedAt ?? Number.POSITIVE_INFINITY)
      return Math.max(...received) - commit
    })
    for (const reader of readers) await reader.cancel()
    expect(responseMs).toHaveLength(MEASURED)
    expect(p99(responseMs), '응답 p99 (ms)').toBeLessThanOrEqual(300)
    expect(p99(notifyMs), '알림 p99 (ms)').toBeLessThanOrEqual(1000)
    // 범위가 커도 쓰기 경로는 상태 전체를 매번 쓰지 않는다: 스냅샷은 500건마다라 측정 구간(200건)에 많아야 한 번
    const snapshots = (await world.database.pglite?.query<{ seq: number }>(`select seq from snapshots order by seq`))?.rows.map((row) => row.seq) ?? []
    expect(snapshots.filter((seq) => seq > PRODUCTS + CHATS + 1).length).toBeLessThanOrEqual(1)
  }, 180_000)
})
