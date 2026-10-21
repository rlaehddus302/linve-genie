// 무거운 파일 작업은 판정과 다른 스레드에서 (RA-I2-003): 작업 풀의 시간·메모리 상한·판매자마다 동시 작업·줄·끊김·조각, 그리고
// 전원 확인서 PDF·판매대장 엑셀을 만드는 동안에도 같은 서버의 다른 판매자 채팅 판정 응답이 늦어지지 않는다.
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { threadId } from 'node:worker_threads'
import { renderBatchPdf } from '@livejjim/documents'
import { afterAll, describe, expect, it } from 'vitest'
import { documentFont } from '../src/files.ts'
import { WorkBusy, WorkFailed, WorkPool, type WorkKind } from '../src/work-pool.ts'
import { getFile } from './i2-support.ts'
import { addSeller, createBroadcast, newWorld } from './support.ts'

const TEST_WORKER = new URL('./work-test-worker.ts', import.meta.url)
const pools: WorkPool[] = []
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()))
})
function testPool(options: Partial<ConstructorParameters<typeof WorkPool>[0]> = {}): WorkPool {
  const pool = new WorkPool({ name: 'test', size: 1, timeoutMs: 10_000, memoryMb: 64, perOwner: 4, maxQueue: 8, entry: TEST_WORKER, ...options })
  pools.push(pool)
  return pool
}
const kind = (name: string) => name as WorkKind

describe('작업 풀 (work-pool.ts)', () => {
  it('작업은 다른 스레드에서 돈다 — 값이 오가고, 조각으로 보낸 입력을 이어 받는다', async () => {
    const pool = testPool()
    const echoed = await pool.run<{ threadId: number; input: unknown }>('s1', kind('echo'), { a: [1, '둘'] })
    expect(echoed.input).toEqual({ a: [1, '둘'] })
    expect(echoed.threadId).not.toBe(threadId)
    async function* parts() {
      for (const n of [1, 2, 3, 4]) yield n
    }
    expect(await pool.run('s1', kind('sum'), null, { chunks: parts() })).toBe(10)
    expect(pool.stats()).toMatchObject({ workers: 1, running: 0, queued: 0, completed: 2 })
  })

  it('시간 상한을 넘으면 그 워커를 끝내고(timeout), 다음 작업은 새 워커가 한다', async () => {
    const pool = testPool({ timeoutMs: 300 })
    const first = await pool.run<number>('s1', kind('spin'), 1)
    await expect(pool.run('s1', kind('spin'), 5_000)).rejects.toMatchObject({ name: 'WorkFailed', reason: 'timeout' })
    const next = await pool.run<number>('s1', kind('spin'), 1)
    expect(next).not.toBe(first)
  })

  it('메모리 상한을 넘으면 그 워커만 죽고(crashed) 서버 스레드는 그대로, 다음 작업은 새 워커가 한다', async () => {
    const pool = testPool({ memoryMb: 32 })
    await expect(pool.run('s1', kind('oom'), null)).rejects.toMatchObject({ name: 'WorkFailed', reason: 'crashed' })
    expect(await pool.run<{ input: unknown }>('s1', kind('echo'), 7)).toMatchObject({ input: 7 })
  })

  it('작업 안 오류는 error, 판매자마다 동시 작업 상한·줄 길이 상한을 넘으면 바로 WorkBusy (다른 판매자는 줄을 선다)', async () => {
    const pool = testPool({ perOwner: 1, maxQueue: 2 })
    await expect(pool.run('s1', kind('boom'), null)).rejects.toBeInstanceOf(WorkFailed)
    const slow = pool.run('s1', kind('spin'), 300)
    await expect(pool.run('s1', kind('echo'), 1)).rejects.toBeInstanceOf(WorkBusy)
    const other = pool.run<{ input: unknown }>('s2', kind('echo'), 2)
    const third = pool.run<{ input: unknown }>('s3', kind('echo'), 3)
    await expect(pool.run('s4', kind('echo'), 4)).rejects.toBeInstanceOf(WorkBusy)
    await slow
    expect((await other).input).toBe(2)
    expect((await third).input).toBe(3)
    // 끝나면 같은 판매자도 다시 맡긴다
    expect((await pool.run<{ input: unknown }>('s1', kind('echo'), 5)).input).toBe(5)
  })

  it('요청이 끊기면 아직 시작하지 않은 작업은 줄에서 빠진다(aborted) — 워커는 그 일을 하지 않는다', async () => {
    const pool = testPool()
    const busy = pool.run('s1', kind('spin'), 300)
    const controller = new AbortController()
    const waiting = pool.run('s2', kind('echo'), 1, { signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ reason: 'aborted' })
    await busy
    expect(pool.stats().completed).toBe(1)
    const gone = new AbortController()
    gone.abort()
    await expect(pool.run('s2', kind('echo'), 1, { signal: gone.signal })).rejects.toMatchObject({ reason: 'aborted' })
  })
})

describe('문서를 만드는 동안 판정이 멈추지 않는다 (RA-I2-003)', () => {
  it('구매자 100명 날짜의 전원 확인서 PDF·판매대장을 연달아 만드는 동안 이벤트 루프 지연이 짧다 — 그리기는 작업 워커가 한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    await world.server.writer.write({
      sellerId: seller.sellerId,
      date: '2026-10-19',
      rehearsal: false,
      createScope: false,
      requestId: null,
      build: () => {
        const drafts = []
        for (let no = 1; no <= 500; no++) {
          drafts.push({ fields: { type: 'product.register', b: b.id, no, name: `품종${String(no % 37)}`, price: 1000 + no * 10 }, actor: { kind: 'server' } as const })
          drafts.push({ fields: { type: 'chat', b: b.id, id: `p${String(no)}`, ch: `UC_${String(Math.floor((no - 1) / 5)).padStart(3, '0')}`, nick: `구매자${String(Math.floor((no - 1) / 5))}`, text: String(no) }, actor: { kind: 'collector' } as const, chat: { b: b.id, id: `p${String(no)}` } })
        }
        return drafts
      },
    })
    // 같은 일을 서버 스레드에서 하면 그만큼 루프가 멈춘다 (비교 기준)
    const runtime = await world.server.writer.read(seller.sellerId, '2026-10-19', false)
    const inline = performance.now()
    const direct = await renderBatchPdf({ state: runtime.state, date: '2026-10-19', shop: null, rehearsal: false, createdAt: 0 }, documentFont())
    const inlineMs = performance.now() - inline
    expect(direct.ok).toBe(true)
    // 워커를 띄워 둔다 (처음 띄우는 비용은 재지 않는다)
    expect((await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')).status).toBe(200)
    const before = world.server.work.documents.stats().completed
    const delay = monitorEventLoopDelay({ resolution: 5 })
    delay.enable()
    const started = performance.now()
    for (let i = 0; i < 3; i++) {
      const [pdf, ledger] = await Promise.all([getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf'), getFile(world, seller.cookie, '/api/ledger.xlsx?from=2026-10-19&to=2026-10-19')])
      expect([pdf.status, ledger.status]).toEqual([200, 200])
    }
    const totalMs = performance.now() - started
    delay.disable()
    const maxLagMs = delay.max / 1e6
    expect(world.server.work.documents.stats().completed - before).toBe(6)
    // 서버 스레드가 멈춘 가장 긴 시간이 한 번 그리는 시간보다 훨씬 짧다 (서버 스레드에는 확인서 데이터·대장 행 만들기만 남는다)
    expect(maxLagMs, `가장 긴 멈춤 ${maxLagMs.toFixed(0)}ms · 서버 스레드에서 그리기 ${inlineMs.toFixed(0)}ms · 전체 ${totalMs.toFixed(0)}ms`).toBeLessThan(Math.max(250, inlineMs / 2))
  }, 180_000)
})
