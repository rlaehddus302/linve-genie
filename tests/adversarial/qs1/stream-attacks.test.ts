// QS1 적대 시험 (test-domain): 실시간 연결 한도 공격 (AC-QS1-31, D-QS1-04, SPEC §3 실시간 줄).
// - 한 판매자가 연결을 수백 번 열고 닫고, 읽지 않는 연결을 많이 열어도: 그 판매자의 열린 연결 30개 이하, 연결마다 안 보낸 글은 한도 + 알림 하나 이하,
//   다른 판매자의 연결은 닫히지 않고 알림을 하나도 놓치지 않는다(seq가 이어진다). 닫힌 뒤 다시 연 연결은 ready + change로 마지막 seq까지 따라잡는다.
// - 실제 Node HTTP 서버(@hono/node-server)에서 읽지 않는 TCP 클라이언트도 한도로 닫힌다(시험 앱의 app.request가 아닌 실제 소켓 — 운영 길).
import { connect, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { STREAM_SELLER_MAX, StreamHub, type StreamNotice } from '../../../apps/server/src/hub.ts'
import { createNodeServer } from '../../../apps/server/src/node-server.ts'
import { sseReader } from '../../../apps/server/test/support.ts'

const DATE = '2026-10-25'
const notice = (seq: number, pad = 0): StreamNotice => ({ date: DATE, rehearsal: false, seq, type: pad > 0 ? `chat${'x'.repeat(pad)}` : 'chat' })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const hubs: StreamHub[] = []
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
  for (const hub of hubs.splice(0)) hub.closeAll()
})

function newHub(bufferMaxBytes?: number): StreamHub {
  const hub = new StreamHub({ heartbeatMs: 30_000, sessionAlive: () => Promise.resolve(true), ...(bufferMaxBytes === undefined ? {} : { bufferMaxBytes }) })
  hubs.push(hub)
  return hub
}

/** 응답 본문에 지금 쌓여 있는(읽지 않은) 바이트를 센다 — 쌓인 것만 읽고(더 기다리지 않는다) 그 연결은 닫는다 */
async function queuedBytes(response: Response): Promise<number> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  let bytes = 0
  for (;;) {
    const next = await Promise.race([
      reader.read().catch(() => ({ done: true as const, value: undefined })),
      new Promise<'wait'>((resolve) => setTimeout(() => resolve('wait'), 0)),
    ])
    if (next === 'wait' || next.done) break
    bytes += next.value.byteLength
  }
  await reader.cancel().catch(() => undefined)
  return bytes
}

const seqsOf = (events: readonly { event: string; data: string }[]) => events.filter((e) => e.event === 'change').map((e) => (JSON.parse(e.data) as StreamNotice).seq)

describe('실시간 연결 공격 (AC-QS1-31)', () => {
  it('판매자 P가 연결을 아무렇게나 열고 닫고 읽지 않아도: P의 열린 연결 ≤ 30, 연결마다 안 읽은 글 ≤ 한도 + 알림 하나, Q의 연결은 닫히지 않고 seq가 이어진다', async () => {
    // Q(읽는 쪽)의 알림은 한 번에 한도보다 작게 — 읽는 쪽도 한 틱 안에 한도를 넘게 받으면 닫히는 것은 정한 대로다(안 읽고 쌓인 양)
    const LIMIT = 16_384
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ k: fc.constant('open' as const), read: fc.boolean() }),
            fc.record({ k: fc.constant('close' as const), i: fc.nat(80) }),
            fc.record({ k: fc.constant('hold' as const) }),
            fc.record({ k: fc.constant('release' as const) }),
            fc.record({ k: fc.constant('publish' as const), n: fc.integer({ min: 1, max: 40 }), pad: fc.constantFrom(0, 0, 100, 900), to: fc.constantFrom('P', 'P', 'Q') }),
          ),
          { minLength: 1, maxLength: 160 },
        ),
        async (ops) => {
          const hub = newHub(LIMIT)
          const seq = { P: 0, Q: 0 }
          const scopes = (who: 'P' | 'Q') => () => Promise.resolve([{ date: DATE, rehearsal: false, seq: seq[who] }])
          // Q: 읽는 연결 하나 (끝까지 닫히면 안 된다)
          const q = sseReader(await hub.open('Q', 'q-session', scopes('Q')))
          await q.until(() => q.events.length >= 1)
          const opened: Response[] = []
          const readers: ReturnType<typeof sseReader>[] = []
          let maxNotice = 0
          /** 범위 seq 읽기를 붙잡아 둔 연결 (ready 전) */
          const held: { release: () => void; response: Promise<Response> }[] = []
          const releaseOne = async (): Promise<void> => {
            const h = held.shift()
            if (h === undefined) return
            h.release()
            opened.push(await h.response)
          }
          for (const op of ops) {
            if (op.k === 'open') {
              const response = await hub.open('P', `p-session-${String(opened.length)}`, scopes('P'))
              opened.push(response)
              if (op.read) readers.push(sseReader(response))
            } else if (op.k === 'hold') {
              let release: () => void = () => undefined
              const gate = new Promise<void>((resolve) => {
                release = resolve
              })
              const response = hub.open('P', `p-held-${String(held.length)}`, async () => {
                await gate
                return [{ date: DATE, rehearsal: false, seq: seq.P }]
              })
              held.push({ release, response })
            } else if (op.k === 'release') {
              await releaseOne()
            } else if (op.k === 'close') {
              const target = opened[op.i % Math.max(1, opened.length)]
              if (target !== undefined && !target.bodyUsed) await target.body?.cancel().catch(() => undefined)
            } else {
              const who = op.to as 'P' | 'Q'
              const batch = Array.from({ length: op.n }, () => notice(++seq[who], who === 'Q' ? 0 : op.pad))
              for (const n of batch) maxNotice = Math.max(maxNotice, new TextEncoder().encode(`id: 99999\nevent: change\ndata: ${JSON.stringify(n)}\n\n`).byteLength)
              hub.publish(who, batch)
            }
            await tick()
            // P의 열린 연결은 언제나 30개 이하 (읽는 중에 한도로 닫힌 것은 범위 읽기가 끝날 때까지 pendingSize에 남지만 알림을 모으지 않는다)
            expect(hub.size - 1).toBeLessThanOrEqual(STREAM_SELLER_MAX)
          }
          while (held.length > 0) await releaseOne()
          await tick()
          expect(hub.pendingSize).toBe(0)
          // Q는 닫히지 않았고 놓친 seq가 없다
          await q.until(() => (seqsOf(q.events).at(-1) ?? 0) === seq.Q || seq.Q === 0)
          expect(q.closed).toBe(false)
          expect(seqsOf(q.events)).toEqual(Array.from({ length: seq.Q }, (_, i) => i + 1))
          // P: 열린 연결 ≤ 30 (Q 하나를 뺀 수)
          expect(hub.size - 1).toBeLessThanOrEqual(STREAM_SELLER_MAX)
          // 읽지 않은 P 연결마다 쌓여 있던 글 ≤ 한도 + 알림 하나 (ready 포함)
          for (const response of opened) {
            if (response.bodyUsed || response.body?.locked === true) continue
            const bytes = await queuedBytes(response)
            expect(bytes).toBeLessThanOrEqual(LIMIT + Math.max(maxNotice, 200))
          }
          for (const r of readers) await r.cancel().catch(() => undefined)
          await q.cancel().catch(() => undefined)
          hub.closeAll()
        },
      ),
      { numRuns: 60 },
    )
  })

  it('P가 연결 300개를 차례로 열고(읽지 않음) 그사이 알림이 계속 와도, 마지막에 다시 연 연결은 ready seq + change로 마지막 seq까지 빠짐없이 따라잡는다', async () => {
    const hub = newHub()
    let last = 0
    const scopes = () => Promise.resolve([{ date: DATE, rehearsal: false, seq: last }])
    const q = sseReader(await hub.open('Q', 'q', () => Promise.resolve([{ date: DATE, rehearsal: false, seq: 0 }])))
    cleanups.push(() => q.cancel().catch(() => undefined))
    let qSeq = 0
    for (let i = 0; i < 300; i++) {
      await hub.open('P', `p-${String(i)}`, scopes)
      hub.publish('P', [notice(++last)])
      if (i % 10 === 0) hub.publish('Q', [notice(++qSeq)])
      expect(hub.size).toBeLessThanOrEqual(STREAM_SELLER_MAX + 1)
    }
    const again = sseReader(await hub.open('P', 'p-final', scopes))
    cleanups.push(() => again.cancel().catch(() => undefined))
    await again.until(() => again.events.length >= 1)
    const ready = JSON.parse(again.events[0]?.data ?? '{}') as { scopes: { seq: number }[] }
    hub.publish('P', [notice(++last), notice(++last)])
    await again.until(() => (seqsOf(again.events).at(-1) ?? 0) === last)
    expect([ready.scopes[0]?.seq ?? -1, ...seqsOf(again.events)]).toEqual(Array.from({ length: last - (ready.scopes[0]?.seq ?? 0) + 1 }, (_, i) => (ready.scopes[0]?.seq ?? 0) + i))
    await q.until(() => (seqsOf(q.events).at(-1) ?? 0) === qSeq)
    expect(q.closed).toBe(false)
    expect(seqsOf(q.events)).toEqual(Array.from({ length: qSeq }, (_, i) => i + 1))
  })

  it('실제 Node HTTP 서버: 응답을 읽지 않는 TCP 클라이언트는 한도로 닫히고(허브에서 빠짐), 읽는 클라이언트는 그대로 다 받는다', async () => {
    const hub = newHub()
    let last = 0
    const scopes = () => Promise.resolve([{ date: DATE, rehearsal: false, seq: last }])
    // 앱 대신 fetch 하나 (/stream/<id> → 허브 연결)
    const app = { fetch: (request: Request) => hub.open('P', `s-${new URL(request.url).pathname.split('/')[2] ?? ''}`, scopes) }
    const server = createNodeServer({ app: app as unknown as Parameters<typeof createNodeServer>[0]['app'] })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    )
    const port = (server.address() as AddressInfo).port
    const open = (id: string, reading: boolean): Promise<{ socket: Socket; received: () => number }> =>
      new Promise((resolve) => {
        let received = 0
        const socket = connect(port, '127.0.0.1', () => {
          socket.write(`GET /stream/${id} HTTP/1.1\r\nHost: localhost\r\n\r\n`)
          resolve({ socket, received: () => received })
        })
        // 읽지 않는 쪽: 첫 조각만 받고 멈춘다(커널 버퍼가 차면 서버 쪽 쓰기가 막힌다)
        socket.on('data', (chunk: Buffer) => {
          received += chunk.byteLength
          if (!reading) socket.pause()
        })
        socket.on('error', () => undefined)
        cleanups.push(() => {
          socket.destroy()
        })
      })
    const slow = await open('slow', false)
    const fast = await open('fast', true)
    for (let i = 0; i < 200 && hub.size < 2; i++) await tick()
    expect(hub.size).toBe(2)
    // 알림을 보낸다 (합 64 MiB까지) — 읽지 않는 연결이 닫힐 때까지
    const pad = 400
    const one = new TextEncoder().encode(`id: 1\nevent: change\ndata: ${JSON.stringify(notice(1, pad))}\n\n`).byteLength
    let sent = 0
    while (hub.size === 2 && sent < 64 * 1024 * 1024) {
      hub.publish('P', Array.from({ length: 500 }, () => notice(++last, pad)))
      sent += 500 * one
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(hub.size, `읽지 않는 연결이 ${String(Math.round(sent / 1024 / 1024))} MiB 뒤에도 닫히지 않았다`).toBe(1)
    // 읽는 연결은 마지막 알림까지 받는다
    const before = fast.received()
    hub.publish('P', [notice(++last, pad)])
    for (let i = 0; i < 2000 && fast.received() <= before; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fast.received()).toBeGreaterThan(before)
    expect(hub.deviceLive('P', 'none')).toBe(false)
    slow.socket.destroy()
  }, 60_000)
})
