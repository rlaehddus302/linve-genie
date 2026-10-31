// QS1 적대 시험 도구 (test-domain): 화면의 출력 기기(PrinterStation)를 Node에서 돌린다.
// - 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 경로를 값으로 불러온다(s05 console-store-race와 같은 방법).
// - 저장소(localStorage·sessionStorage)는 메모리 저장소, 서버는 가짜 fetch(받기·결과), 출력 기록 자료층은 가짜 store다.
// - 저절로 다시 잇기의 시간은 손으로 돌리는 타이머(진짜로 기다리지 않는다). 시각·난수를 쓰지 않는다.
import { createBitmap, defaultTemplate, type LabelBitmap } from '@livejjim/label'
import type { PrinterAdapter, PrinterTimer } from '@livejjim/printer'
import { vi } from 'vitest'

export const STATION_MODULE = '../../../apps/web/src/lib/printer-station.ts'
export const ME = 'device-me-qs1-0001'
export const DATE = '2026-10-25'
const IMAGE: LabelBitmap = createBitmap(384, 240)

/** 한 틱 넘기기 (마이크로태스크·setTimeout 0) */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** 손으로 돌리는 타이머 — 시각은 0부터, advance가 그 사이에 올 일을 차례로 부른다 */
export class ManualTimer implements PrinterTimer {
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

class MemoryStorage {
  readonly #map = new Map<string, string>()
  get length(): number {
    return this.#map.size
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  clear(): void {
    this.#map.clear()
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }
}

export interface Queue {
  rev: number
  device: { id: string; name: string; live: boolean; printerConnected: boolean; releasing: boolean } | null
  pause: null
  waiting: number
  printing: number
  discard: number
  labelsEnabled: boolean
}

export const queueOf = (mine: boolean, labelsEnabled = true, rev = 1): Queue => ({
  rev,
  device: mine ? { id: ME, name: '휴대폰', live: true, printerConnected: true, releasing: false } : null,
  pause: null,
  waiting: 0,
  printing: 0,
  discard: 0,
  labelsEnabled,
})

/** 출력 기록 자료층 대신 (station이 쓰는 부분만) */
export class FakeStore {
  #queue: Queue
  readonly #listeners = new Set<() => void>()
  readonly states: { connected: boolean }[] = []
  constructor(queue: Queue) {
    this.#queue = queue
  }
  get queue(): Queue {
    return this.#queue
  }
  getSnapshot(): { config: { testPrinter: boolean; hostActionDelayMs: number }; overview: { queue: Queue } } {
    return { config: { testPrinter: true, hostActionDelayMs: 5000 }, overview: { queue: this.#queue } }
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  setQueue(queue: Queue): void {
    this.#queue = queue
    for (const listener of [...this.#listeners]) listener()
  }
  async act(path: string, body: Record<string, unknown>): Promise<{ queue: Queue }> {
    if (path === '/api/print/device/state') this.states.push({ connected: body['connected'] === true })
    return { queue: this.#queue }
  }
  async reload(): Promise<void> {}
  noteLabelsOff(): void {}
}

export interface StationLike {
  start(): void
  stop(): void
  connect(method: 'bluetooth' | 'serial' | 'test'): Promise<boolean>
  reconnect(): Promise<boolean>
  disconnect(): Promise<void>
  pump(): Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): { connection: string; connecting: boolean; connectError: { code: string; message: string; detail?: string } | null; method: string | null }
}

interface StationModule {
  PrinterStation: new (options: Record<string, unknown>) => StationLike
  AUTO_RECONNECT_DELAYS_MS: readonly number[]
}

/** 가짜 서버: 받기(claim)는 jobs에서 하나씩, 결과(result)는 모은다 */
export class FakeServer {
  readonly jobs: string[] = []
  readonly claims: string[] = []
  readonly results: { attempt: string; ok: boolean; code: string | null }[] = []
  readonly bodies: string[] = []
  fetch = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const path = String(input)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    this.bodies.push(typeof init.body === 'string' ? init.body : '')
    if (path === '/api/print/claim') {
      const id = this.jobs.shift()
      this.claims.push(id ?? '')
      if (id === undefined) return json({ job: null, reason: 'EMPTY' })
      return json({
        job: {
          id,
          date: DATE,
          kind: 'product',
          reason: 'auto',
          attempt: `attempt-${id}`,
          data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
          // 실제 서버는 늘 L-5 템플릿 전체(저장한 적이 없으면 50×30 기본 — L-11 13)를 준다. PRN2부터 출력 기기가 template.size를
          // 이은 프린터 프로필의 크기 목록과 견주므로(D-PRN2-07) 크기 없는 {}는 라벨 오류가 된다 — 서버가 실제로 주는 모양으로 둔다
          template: defaultTemplate('product'),
          page: null,
          pages: null,
          label: { key: `c-${id}@1`, claim: `c-${id}`, version: 1, broadcast: 'b1', no: 15, buyerId: null, buyer: { kind: 'youtube', name: '우주천사' } },
        },
      })
    }
    if (path === '/api/print/result') {
      const error = body['error'] as { code?: string } | undefined
      this.results.push({ attempt: String(body['attempt']), ok: body['ok'] === true, code: error?.code ?? null })
      return json({ recorded: true })
    }
    return json({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } }, 404)
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** 시험 손잡이에서 쓰는 부분 */
export interface HandleLike {
  autoReconnectAttempts(): number
  autoReconnectWaiting(): boolean
}

export interface Rig {
  readonly station: StationLike
  /** 시험 손잡이 (가짜 store가 시험 모드라 늘 있다) */
  readonly handle: () => HandleLike
  readonly store: FakeStore
  readonly server: FakeServer
  readonly timer: ManualTimer
  readonly delays: readonly number[]
}

/** 메모리 저장소·가짜 fetch를 꽂고 station 하나를 만든다 (끝나면 teardown) */
export async function rig(options: {
  readonly adapter?: () => PrinterAdapter
  readonly testPrinter?: () => PrinterAdapter
  readonly methods?: readonly string[]
  readonly mine?: boolean
  readonly timer?: ManualTimer
  readonly local?: MemoryStorage
}): Promise<Rig> {
  const local = options.local ?? new MemoryStorage()
  vi.stubGlobal('window', { localStorage: local, sessionStorage: new MemoryStorage() })
  const server = new FakeServer()
  vi.stubGlobal('fetch', server.fetch)
  const mod = (await import(/* @vite-ignore */ STATION_MODULE)) as StationModule
  const timer = options.timer ?? new ManualTimer()
  const store = new FakeStore(queueOf(options.mine ?? true))
  let handle: HandleLike | null = null
  const station = new mod.PrinterStation({
    store,
    deviceId: ME,
    ...(options.adapter === undefined ? {} : { createAdapter: options.adapter }),
    ...(options.testPrinter === undefined ? {} : { createTestPrinter: options.testPrinter }),
    detect: () => [...(options.methods ?? [])],
    render: async () => ({ ok: true, image: IMAGE }),
    renderTest: async () => ({ ok: true, image: IMAGE }),
    requestWakeLock: null,
    today: () => DATE,
    timer,
    exposeTestHandle: (value: HandleLike | null) => {
      if (value !== null) handle = value
    },
  })
  station.start()
  await flush()
  const getHandle = (): HandleLike => {
    if (handle === null) throw new Error('시험 손잡이가 없다')
    return handle
  }
  return { station, handle: getHandle, store, server, timer, delays: mod.AUTO_RECONNECT_DELAYS_MS }
}

export function newStorage(): MemoryStorage {
  return new MemoryStorage()
}
