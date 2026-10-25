// QL2 저절로 다시 잇는 동안·그친 뒤의 스테이션 상태 (AC-QL2-13·14, D-QL2-04, L-11 8) — 차례 1~6, 60초 안 다시 끊김이면 남은 차례부터, 그친 뒤 gaveUp.
// 시간은 손으로 돌리는 타이머로 본다(진짜로 기다리지 않는다). 도우미는 qs1-printer-station.test.ts와 같다.
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import { createFakePrinter, type ConnectionMethod, type FakePrinter, type PrinterAdapter, type PrinterTimer } from '@livejjim/printer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedJob, PrintOverview } from '../src/api/print-types.ts'
import { PrintStore } from '../src/lib/print-store.ts'
import { AUTO_RECONNECT_DELAYS_MS, PrinterStation } from '../src/lib/printer-station.ts'
import { device, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const ME = 'device-me-1234'
const IMAGE: LabelBitmap = createBitmap(384, 240)

/** 손으로 돌리는 타이머 — 시각은 0부터, advance가 그 사이에 올 일을 차례로 부른다 */
class ManualTimer implements PrinterTimer {
  now = 0
  #seq = 0
  readonly #tasks = new Map<number, { at: number; run: () => void }>()

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.#seq
    this.#tasks.set(id, { at: this.now + ms, run: callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.#tasks.delete(handle as number)
  }

  get pending(): number {
    return this.#tasks.size
  }

  async advance(ms: number): Promise<void> {
    const end = this.now + ms
    for (;;) {
      let next: [number, { at: number; run: () => void }] | undefined
      for (const entry of this.#tasks) if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry
      if (next === undefined) break
      this.#tasks.delete(next[0])
      this.now = next[1].at
      next[1].run()
      await flush(3)
    }
    this.now = end
    await flush(3)
  }
}

let server: FakeServer
let current: PrintOverview
let claims: ClaimedJob[]
let results: Record<string, unknown>[]
let states: Record<string, unknown>[]
let onResult: ((body: Record<string, unknown>) => void) | null
let testMode: boolean
let timer: ManualTimer
const made: { store: PrintStore; station: PrinterStation }[] = []

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  server = new FakeServer()
  current = overview({ queue: queue({ rev: 1, device: device(ME, { name: '휴대폰' }) }) })
  claims = []
  results = []
  states = []
  onResult = null
  testMode = true
  timer = new ManualTimer()
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: testMode } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('POST', /^\/api\/print\/claim$/, () => {
      const next = claims.shift()
      return { body: next === undefined ? { job: null, reason: 'EMPTY' } : { job: next } }
    })
    .on('POST', /^\/api\/print\/result$/, (call) => {
      const body = call.body ?? {}
      results.push(body)
      onResult?.(body)
      return { body: { recorded: true } }
    })
    .on('POST', /^\/api\/print\/device\/state$/, (call) => {
      states.push(call.body ?? {})
      return { body: { queue: current.queue } }
    })
  vi.stubGlobal('fetch', server.fetch)
  FakeEventSource.reset()
})

afterEach(() => {
  for (const m of made.splice(0)) {
    m.station.stop()
    m.store.stop()
  }
  vi.unstubAllGlobals()
})

interface StartOptions {
  readonly printer?: FakePrinter
  readonly adapter?: () => PrinterAdapter
  readonly methods?: ConnectionMethod[]
}

async function start(options: StartOptions = {}): Promise<PrinterStation> {
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  const station = new PrinterStation({
    store,
    deviceId: ME,
    createTestPrinter: () => options.printer ?? createFakePrinter({ methods: ['bluetooth'] }),
    ...(options.adapter === undefined ? {} : { createAdapter: options.adapter }),
    detect: () => options.methods ?? [],
    render: async () => ({ ok: true, image: IMAGE }),
    renderTest: async () => ({ ok: true, image: IMAGE }),
    requestWakeLock: null,
    today: () => DATE,
    timer,
  })
  made.push({ store, station })
  store.start()
  station.start()
  await flush()
  return station
}

const notMine = () => overview({ queue: queue({ rev: 1, device: device('someone-else-1') }) })


const auto = (s: PrinterStation) => s.getSnapshot().autoReconnect

describe('저절로 다시 잇기 상태 (AC-QL2-13·14, D-QL2-04)', () => {
  async function connectedTest(printer: FakePrinter): Promise<PrinterStation> {
    const s = await start({ printer })
    expect(await s.connect('test')).toBe(true)
    await flush()
    return s
  }

  it('처음엔 null. 끊긴 직후 (1/6), 시도가 실패할 때마다 다음 차례, 6번째 시도 중 (6/6), 다 실패하면 gaveUp', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    expect(auto(s)).toBeNull()
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await flush()
    const total = AUTO_RECONNECT_DELAYS_MS.length
    expect(total).toBe(6)
    expect(auto(s)).toEqual({ kind: 'trying', attempt: 1, total })
    for (let n = 1; n <= 6; n++) {
      const delay = AUTO_RECONNECT_DELAYS_MS[n - 1] ?? 0
      await timer.advance(delay - 1)
      expect(auto(s)).toEqual({ kind: 'trying', attempt: n, total })
      await timer.advance(1)
      expect(printer.rememberedAttempts).toBe(n)
      if (n < 6) expect(auto(s)).toEqual({ kind: 'trying', attempt: n + 1, total })
    }
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
    await timer.advance(600_000)
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
  })

  it('시도하는 동안(연결 중)에도 그 차례 그대로', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    const seen: string[] = []
    s.subscribe(() => {
      const snap = s.getSnapshot()
      if (snap.connecting) seen.push(JSON.stringify(snap.autoReconnect))
    })
    await timer.advance(1000)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((value) => value === JSON.stringify({ kind: 'trying', attempt: 1, total: 6 }))).toBe(true)
  })

  it('3번째로 이어지면 null, 60초 안에 다시 끊기면 (4/6)부터', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(3000)
    expect(auto(s)).toEqual({ kind: 'trying', attempt: 3, total: 6 })
    printer.setConnectError(undefined)
    await timer.advance(4000)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
    expect(auto(s)).toBeNull()
    await timer.advance(30_000)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await flush()
    expect(auto(s)).toEqual({ kind: 'trying', attempt: 4, total: 6 })
  })

  it('6번째로 이어진 뒤 60초 안에 다시 끊기면 남은 차례가 없어 곧바로 gaveUp', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000 + 2000 + 4000 + 8000 + 16000)
    printer.setConnectError(undefined)
    await timer.advance(30_000)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
    expect(auto(s)).toBeNull()
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await flush()
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
  })

  it('그친 뒤 "다시 연결"을 누르면 null (실패하면 연결 오류 상자), 이어지면 null', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(61_000)
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
    expect(await s.reconnect()).toBe(false)
    expect(auto(s)).toBeNull()
    expect(s.getSnapshot().connectError).not.toBeNull()
    printer.setConnectError(undefined)
    expect(await s.reconnect()).toBe(true)
    expect(auto(s)).toBeNull()
  })

  it('그친 뒤 "연결 끊기"·다른 연결 방법이면 null', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(61_000)
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
    await s.disconnect()
    expect(auto(s)).toBeNull()
  })

  it('그친 뒤 출력 기기에서 내려오면 null', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    const store = made.at(-1)?.store
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(61_000)
    expect(auto(s)).toEqual({ kind: 'gaveUp' })
    current = notMine()
    await store?.reload()
    await flush()
    expect(auto(s)).toBeNull()
  })

  it('출력 기기가 아닌 기기는 끊겨도 저절로 잇지 않고 상태도 null (D-QL2-04 (4))', async () => {
    current = notMine()
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.simulateDisconnect()
    await timer.advance(61_000)
    expect(printer.rememberedAttempts).toBe(0)
    expect(auto(s)).toBeNull()
  })
})
