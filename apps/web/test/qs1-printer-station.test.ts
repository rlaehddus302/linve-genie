// QS1 이 기기의 프린터 — 마지막 프린터 기억·"다시 연결"·저절로 다시 잇기 (AC-QS1-20~25, D-QS1-01·02·05, L-7·L-11 8).
// 가짜 B1 블루투스(실제 B1 어댑터 + 가짜 기기)·가짜 USB 포트·시험용 프린터, 저절로 다시 잇기의 시간은 손으로 돌리는 타이머로 본다(진짜로 기다리지 않는다).
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import {
  FAKE_B1_USB_PRODUCT_ID,
  FAKE_B1_USB_VENDOR_ID,
  combineNiimbotFakes,
  createB1Adapter,
  createFakeNiimbotBluetooth,
  createFakeNiimbotSerial,
  createFakePrinter,
  type ConnectionMethod,
  type FakeNiimbotBluetooth,
  type FakePrinter,
  type PrinterAdapter,
  type PrinterTimer,
} from '@livejjim/printer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedJob, PrintOverview } from '../src/api/print-types.ts'
import { PrintStore } from '../src/lib/print-store.ts'
import {
  AUTO_RECONNECT_DELAYS_MS,
  FAKE_DEVICES_KEY,
  PrinterStation,
  REMEMBERED_KEY,
  REMEMBERED_TEST_KEY,
  type TestPrinterHandle,
} from '../src/lib/printer-station.ts'
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
let handle: TestPrinterHandle | null
const made: { store: PrintStore; station: PrinterStation }[] = []

function claimed(id: string): ClaimedJob {
  return {
    id,
    date: DATE,
    kind: 'product',
    reason: 'auto',
    attempt: `attempt-${id}-0000`,
    data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
    template: templates().product.template,
    page: null,
    pages: null,
    label: { key: `c-${id}@1`, claim: `c-${id}`, version: 1, broadcast: 'b1', no: 15, buyerId: null, buyer: { kind: 'youtube', name: '우주천사' } },
  }
}

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
  handle = null
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
    exposeTestHandle: (value) => {
      handle = value
    },
  })
  made.push({ store, station })
  store.start()
  station.start()
  await flush()
  return station
}

/** 새로고침: 앞 station을 닫는다 (저장소 localStorage·sessionStorage는 그대로) */
function reload(): void {
  for (const m of made.splice(0)) {
    m.station.stop()
    m.store.stop()
  }
  FakeEventSource.reset()
}

const b1With = (fake: FakeNiimbotBluetooth) => () => createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient })
const notMine = () => overview({ queue: queue({ rev: 1, device: device('someone-else-1') }) })
const claimCalls = () => server.callsTo('POST', /^\/api\/print\/claim$/).length
const serverBodies = () => JSON.stringify(server.calls.map((call) => call.body ?? null))
const stored = (key: string): unknown => {
  const raw = window.localStorage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

describe('"다시 연결"은 기억한 기기로 (AC-QS1-20)', () => {
  it('가짜 B1로 한 번 연결한 뒤 끊김 → station.reconnect()는 고르기 창 없이 연결, 연결 방법 단추는 고르기 창', async () => {
    current = notMine()
    const fake = createFakeNiimbotBluetooth()
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    expect(await s.connect('bluetooth')).toBe(true)
    expect(fake.requests).toBe(1)
    fake.disconnect()
    await vi.waitFor(() => expect(s.getSnapshot().connection).toBe('DISCONNECTED'))
    expect(s.canReconnect).toBe(true)
    expect(await s.reconnect()).toBe(true)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
    expect(fake.requests).toBe(1)
    await s.disconnect()
    expect(await s.connect('bluetooth')).toBe(true)
    expect(fake.requests).toBe(2)
  })

  it('시험용 프린터도 같다: "다시 연결"은 기억한 기기 길, 연결 방법 단추는 고르기 창 길', async () => {
    current = notMine()
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await start({ printer })
    await s.connect('test')
    printer.simulateDisconnect()
    expect(await s.reconnect()).toBe(true)
    expect(printer.pickerCount).toBe(1)
    expect(printer.rememberedAttempts).toBe(1)
    await s.disconnect()
    await s.connect('test')
    expect(printer.pickerCount).toBe(2)
  })
})

describe('새로고침 뒤 기억 (AC-QS1-21)', () => {
  it('연결에 성공하면 연결 방법과 기기 ID만 저장하고, 그 값은 서버로 가는 요청 본문에 없다', async () => {
    const fake = createFakeNiimbotBluetooth({ id: 'b1-id-xyz' })
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    expect(stored(REMEMBERED_KEY)).toBeNull()
    await s.connect('bluetooth')
    expect(stored(REMEMBERED_KEY)).toEqual({ method: 'bluetooth', deviceId: 'b1-id-xyz' })
    expect(serverBodies()).not.toContain('b1-id-xyz')
    // 시험용 프린터의 기억은 따로 둔다 (실제 프린터 기억과 섞이지 않는다)
    expect(stored(REMEMBERED_TEST_KEY)).toBeNull()
  })

  it('저장된 값이 있으면(새 station) 페이지를 열 때 잇지 않고, "다시 연결"에 getDevices로 찾아 고르기 창 없이 연결', async () => {
    window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ method: 'bluetooth', deviceId: 'fake-b1-01' }))
    window.localStorage.setItem('livejjim.printMethod', 'bluetooth')
    const fake = createFakeNiimbotBluetooth({ getDevices: true, permitted: true })
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    await flush(5)
    expect(fake.connectAttempts).toBe(0)
    expect(fake.getDevicesCalls).toBe(0)
    expect(s.getSnapshot().connection).toBe('DISCONNECTED')
    expect(s.canReconnect).toBe(true)
    expect(await s.reconnect()).toBe(true)
    expect(fake.requests).toBe(0)
    expect(fake.connectAttempts).toBe(1)
  })

  it('getDevices가 없으면 "다시 연결"에 고르기 창이 한 번', async () => {
    window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ method: 'bluetooth', deviceId: 'fake-b1-01' }))
    window.localStorage.setItem('livejjim.printMethod', 'bluetooth')
    const fake = createFakeNiimbotBluetooth({ getDevices: false, permitted: true })
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    expect(await s.reconnect()).toBe(true)
    expect(fake.requests).toBe(1)
  })

  it('깨진 값(형식 밖)은 없는 것으로 본다 — 고르기 창', async () => {
    for (const broken of ['{bad', JSON.stringify({ method: 'bluetooth', deviceId: '' }), JSON.stringify({ method: 'serial', usbVendorId: -1, usbProductId: 2 }), '42']) {
      window.localStorage.setItem(REMEMBERED_KEY, broken)
      window.localStorage.setItem('livejjim.printMethod', 'bluetooth')
      const fake = createFakeNiimbotBluetooth({ getDevices: true, permitted: true })
      const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
      expect(await s.reconnect()).toBe(true)
      expect(fake.requests).toBe(1)
      reload()
    }
  })

  it('기억한 기기로 이은 시도가 실패하면 저장된 값도 지운다 (다음 "다시 연결"은 고르기 창)', async () => {
    current = notMine()
    const fake = createFakeNiimbotBluetooth()
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    await s.connect('bluetooth')
    expect(stored(REMEMBERED_KEY)).not.toBeNull()
    fake.setPowered(false)
    await vi.waitFor(() => expect(s.getSnapshot().connection).toBe('DISCONNECTED'))
    expect(await s.reconnect()).toBe(false)
    expect(s.getSnapshot().connectError?.code).toBe('CONNECT_FAILED')
    expect(stored(REMEMBERED_KEY)).toBeNull()
    fake.setPowered(true)
    expect(await s.reconnect()).toBe(true)
    expect(fake.requests).toBe(2)
  })

  it('USB: 저장된 제조사·제품 번호와 같은 허락된 포트가 하나면 새로고침 뒤 "다시 연결"에 고르기 창 없음', async () => {
    const bt = createFakeNiimbotBluetooth()
    const usb = createFakeNiimbotSerial()
    const both = combineNiimbotFakes(bt, usb)
    const s = await start({ adapter: () => createB1Adapter({ environment: () => both.environment, createClient: both.createClient }), methods: ['bluetooth', 'serial'] })
    await s.connect('serial')
    expect(stored(REMEMBERED_KEY)).toEqual({ method: 'serial', usbVendorId: FAKE_B1_USB_VENDOR_ID, usbProductId: FAKE_B1_USB_PRODUCT_ID })
    expect(usb.requests).toBe(1)
    reload()
    const usb2 = createFakeNiimbotSerial({ ports: [{ permitted: true }] })
    const both2 = combineNiimbotFakes(createFakeNiimbotBluetooth(), usb2)
    const s2 = await start({ adapter: () => createB1Adapter({ environment: () => both2.environment, createClient: both2.createClient }), methods: ['bluetooth', 'serial'] })
    expect(usb2.connectAttempts).toBe(0)
    expect(await s2.reconnect()).toBe(true)
    expect(usb2.requests).toBe(0)
  })
})

describe('저절로 다시 잇기 (AC-QS1-22·24)', () => {
  async function connectedTest(printer: FakePrinter): Promise<PrinterStation> {
    const s = await start({ printer })
    expect(await s.connect('test')).toBe(true)
    await flush()
    return s
  }

  it('출력 기기에서 기기 쪽 끊김 → 1·2·4·8·16·30초 뒤 기억한 기기로만, 다 실패하면 7번째 없음', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await flush()
    expect(AUTO_RECONNECT_DELAYS_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000])
    const seen: number[] = []
    for (const delay of AUTO_RECONNECT_DELAYS_MS) {
      await timer.advance(delay - 1)
      expect(printer.rememberedAttempts).toBe(seen.length)
      await timer.advance(1)
      seen.push(timer.now)
      expect(printer.rememberedAttempts).toBe(seen.length)
    }
    expect(seen).toEqual([1000, 3000, 7000, 15000, 31000, 61000])
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(6)
    expect(printer.pickerCount).toBe(1)
    expect(handle?.autoReconnectAttempts()).toBe(6)
    expect(handle?.autoReconnectWaiting()).toBe(false)
  })

  it('이어지면 그친다. 60초 안에 끊기면 남은 횟수로, 60초가 지나 끊기면 1초부터 새로', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000)
    await timer.advance(2000)
    printer.setConnectError(undefined)
    await timer.advance(4000) // 3번째로 이어짐
    expect(printer.rememberedAttempts).toBe(3)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
    await timer.advance(30_000) // 그친다 — 더 시도하지 않는다
    expect(printer.rememberedAttempts).toBe(3)
  })

  it('3번째로 이어진 뒤 30초 만에 끊김 → 다음은 4번째 간격 8초, 남은 4~6번째만', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(3000)
    printer.setConnectError(undefined)
    await timer.advance(4000)
    expect(printer.rememberedAttempts).toBe(3)
    await timer.advance(30_000)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(7999)
    expect(printer.rememberedAttempts).toBe(3)
    await timer.advance(1)
    expect(printer.rememberedAttempts).toBe(4)
    await timer.advance(16_000 + 30_000)
    expect(printer.rememberedAttempts).toBe(6)
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(6)
  })

  it('이어진 뒤 60초가 지나 끊기면 1초부터 새로 센다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(3000)
    printer.setConnectError(undefined)
    await timer.advance(4000)
    await timer.advance(60_000)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(printer.rememberedAttempts).toBe(4)
    await timer.advance(2000 + 4000 + 8000 + 16000 + 30000)
    expect(printer.rememberedAttempts).toBe(9)
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(9)
  })

  it('이었다 끊겼다를 60초 안에 되풀이해도 끊김 묶음 하나에 합 6번', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    await connectedTest(printer)
    printer.simulateDisconnect()
    for (let i = 0; i < 20; i++) {
      await timer.advance(30_000)
      if (printer.state === 'CONNECTED') printer.simulateDisconnect()
    }
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(6)
  })

  it('기다리는 동안 "다시 연결" → 기다림이 없어지고 바로 한 번. 이어지면 그 연결부터 새로 센다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000 + 2000 + 4000 + 8000 + 16000) // 5번 씀
    expect(printer.rememberedAttempts).toBe(5)
    printer.setConnectError(undefined)
    expect(await s.reconnect()).toBe(true)
    expect(printer.rememberedAttempts).toBe(6)
    expect(timer.pending).toBe(0)
    await timer.advance(10_000) // 60초 전에 끊겨도 판매자가 이은 연결이라 6번 모두
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(61_000)
    expect(printer.rememberedAttempts).toBe(12)
  })

  it('기다리는 동안 "다시 연결"이 실패하면 오류 상자로 끝나고 저절로 잇기도 그친다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(printer.rememberedAttempts).toBe(1)
    expect(s.getSnapshot().connectError).toBeNull() // 저절로 잇기의 실패는 오류 상자가 아니다
    expect(await s.reconnect()).toBe(false)
    expect(s.getSnapshot().connectError?.code).toBe('CONNECT_FAILED')
    const after = printer.connectAttempts
    await timer.advance(600_000)
    expect(printer.connectAttempts).toBe(after)
  })

  it('그치는 때: "연결 끊기" · 다른 연결 방법 · 출력 기기에서 내려옴 · 라벨 기능 꺼짐 — 그 뒤 기다리던 시도 없음', async () => {
    const cases: ((s: PrinterStation) => Promise<void>)[] = [
      async (s) => {
        await s.disconnect()
      },
      async (s) => {
        await s.connect('bluetooth')
      },
      async () => {
        FakeEventSource.last.emit('print', { rev: 5, queue: queue({ rev: 5, device: device('someone-else-1') }), jobs: [], labels: [] })
        await flush()
      },
      async () => {
        FakeEventSource.last.emit('labels', { rev: 5, enabled: false, entry: { enabled: false, at: '2026-10-20T11:31:00.000Z', loginId: 'shop1' } })
        await flush()
      },
    ]
    for (const [i, stopIt] of cases.entries()) {
      current = overview({ queue: queue({ rev: 1, device: device(ME, { name: '휴대폰' }) }) })
      const printer = createFakePrinter({ methods: ['bluetooth'] })
      const fake = createFakeNiimbotBluetooth()
      const s = await start({ printer, adapter: b1With(fake), methods: ['bluetooth'] })
      await s.connect('test')
      printer.setConnectError('CONNECT_FAILED')
      printer.simulateDisconnect()
      await timer.advance(1000)
      expect(printer.rememberedAttempts, `경우 ${String(i)}`).toBe(1)
      await stopIt(s)
      await timer.advance(600_000)
      expect(printer.rememberedAttempts, `경우 ${String(i)}`).toBe(1)
      expect(timer.pending, `경우 ${String(i)}`).toBe(0)
      reload()
    }
  })

  it('"연결 끊기"를 누르면 저절로 잇지 않는다 (시도 0번)', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    await s.disconnect()
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(0)
  })

  it('출력 기기가 아니면 끊겨도 저절로 잇지 않는다 — 시험용 프린터·가짜 B1 모두', async () => {
    current = notMine()
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    await connectedTest(printer)
    printer.simulateDisconnect()
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(0)
    reload()
    const fake = createFakeNiimbotBluetooth()
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    await s.connect('bluetooth')
    fake.disconnect()
    await timer.advance(600_000)
    expect(fake.connectAttempts).toBe(1)
    expect(handle?.autoReconnectAttempts()).toBe(0)
  })

  it('가짜 B1: 전원 꺼짐(다시 잇기 거절)이면 6번 시도 뒤 그치고, 고르기 창은 처음 한 번뿐 — 전원을 켜고 "다시 연결"하면 고르기 창 없이', async () => {
    const fake = createFakeNiimbotBluetooth()
    const s = await start({ adapter: b1With(fake), methods: ['bluetooth'] })
    await s.connect('bluetooth')
    expect(fake.requests).toBe(1)
    fake.setPowered(false)
    await timer.advance(61_000)
    await vi.waitFor(() => expect(handle?.autoReconnectAttempts()).toBe(6))
    await timer.advance(600_000)
    expect(handle?.autoReconnectAttempts()).toBe(6)
    expect(fake.connectAttempts).toBe(7)
    expect(fake.requests).toBe(1)
    expect(s.getSnapshot().connection).toBe('DISCONNECTED')
    fake.setPowered(true)
    expect(await s.reconnect()).toBe(true)
    expect(fake.requests).toBe(1)
  })

  it('기다리는 동안은 끊김(connecting 아님), 시도하는 동안은 connecting — 상태 칸은 그대로 (새 문장 칸 없음)', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await connectedTest(printer)
    const keys = Object.keys(s.getSnapshot()).sort()
    const seen: { connection: string; connecting: boolean }[] = []
    s.subscribe(() => seen.push({ connection: s.getSnapshot().connection, connecting: s.getSnapshot().connecting }))
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(500)
    expect(s.getSnapshot().connection).toBe('DISCONNECTED')
    expect(s.getSnapshot().connecting).toBe(false)
    expect(seen.some((x) => x.connecting)).toBe(false)
    await timer.advance(500)
    expect(seen.some((x) => x.connecting)).toBe(true)
    expect(s.getSnapshot().connecting).toBe(false)
    expect(s.getSnapshot().connection).toBe('DISCONNECTED')
    expect(Object.keys(s.getSnapshot()).sort()).toEqual(keys)
  })
})

describe('한 번에 하나, 다시 보내지 않음 (AC-QS1-23)', () => {
  it('1장째 결과를 알린 뒤 2장째를 받기 전에 끊김 → 저절로 다시 이어져 2·3장째를 한 장씩, 1장째는 다시 찍지 않는다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    claims = [claimed('j1'), claimed('j2'), claimed('j3')]
    onResult = (body) => {
      if (body['attempt'] === 'attempt-j1-0000') printer.simulateDisconnect()
    }
    const s = await start({ printer })
    await s.connect('test')
    await vi.waitFor(() => expect(results).toHaveLength(1))
    await flush()
    const before = states.length
    expect(claimCalls()).toBe(1)
    // 기다리는 동안 받지 않는다
    await timer.advance(999)
    expect(claimCalls()).toBe(1)
    await timer.advance(1)
    await vi.waitFor(() => expect(results).toHaveLength(3))
    expect(results.map((r) => [r['attempt'], r['ok']])).toEqual([
      ['attempt-j1-0000', true],
      ['attempt-j2-0000', true],
      ['attempt-j3-0000', true],
    ])
    expect(printer.printed).toHaveLength(3)
    // 끊김 한 번, 이어짐 한 번
    expect(states.slice(before - 1)).toEqual([
      { deviceId: ME, connected: false },
      { deviceId: ME, connected: true },
    ])
    expect(printer.pickerCount).toBe(1)
    expect(printer.rememberedAttempts).toBe(1)
  })

  it('2장째를 찍는 중에 끊김 → 2장째는 끊김으로 알리고, 이어진 뒤 서버가 대기 맨 앞으로 돌린 2장째를 한 번 더 받는다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    printer.setBehavior(2, 'disconnect')
    claims = [claimed('j1'), claimed('j2')]
    const s = await start({ printer })
    await s.connect('test')
    await vi.waitFor(() => expect(results).toHaveLength(2))
    expect(results[1]).toEqual({ deviceId: ME, attempt: 'attempt-j2-0000', ok: false, error: { code: 'DISCONNECTED' } })
    claims = [{ ...claimed('j2'), attempt: 'attempt-j2-0001' }, claimed('j3')]
    await timer.advance(1000)
    await vi.waitFor(() => expect(results).toHaveLength(4))
    expect(results.slice(2).map((r) => [r['attempt'], r['ok']])).toEqual([
      ['attempt-j2-0001', true],
      ['attempt-j3-0000', true],
    ])
    expect(printer.printed).toHaveLength(3)
  })

  it('연결 시도는 언제나 많아야 하나 — 시도하는 중의 "다시 연결"은 그 시도를 함께 기다린다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await start({ printer })
    await s.connect('test')
    printer.simulateDisconnect()
    // 타이머를 부른 바로 그 순간(시도가 막 시작됨)에 "다시 연결"
    const pending = timer.advance(1000)
    const again = s.reconnect()
    await pending
    expect(await again).toBe(true)
    expect(printer.connectAttempts).toBe(2)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
  })
})

describe('시험 손잡이 (AC-QS1-25)', () => {
  it('시험 모드가 아니면 손잡이가 없다', async () => {
    testMode = false
    await start()
    expect(handle).toBeNull()
  })

  it('가짜 B1 조작: getDevices·허락됨·전원·끊기, 상태 읽기, 저절로 다시 잇기 시도 수', async () => {
    const s = await start()
    expect(handle?.fakeB1State()).toBeNull()
    handle?.setFakeB1({ getDevices: true })
    expect(s.getSnapshot().methods).toEqual(['bluetooth'])
    await s.connect('bluetooth')
    expect(handle?.fakeB1State()).toEqual({ requests: 1, connectAttempts: 1, connected: true, powered: true, permitted: true, getDevicesCalls: 0 })
    handle?.setFakeB1({ powered: false })
    await timer.advance(61_000)
    await vi.waitFor(() => expect(handle?.autoReconnectAttempts()).toBe(6))
    handle?.setFakeB1({ powered: true })
    expect(await s.reconnect()).toBe(true)
    expect(handle?.fakeB1()).toEqual({ requests: 1, connectAttempts: 8, connected: true })
    handle?.fakeB1Disconnect()
    await vi.waitFor(() => expect(s.getSnapshot().connection).toBe('DISCONNECTED'))
    expect(handle?.autoReconnectWaiting()).toBe(true)
    await timer.advance(1000)
    await vi.waitFor(() => expect(s.getSnapshot().connection).toBe('CONNECTED'))
  })

  it('getAvailability 오판(꺼짐이라 답하지만 이어짐)이면 연결됨, 정말 꺼짐이면 블루투스 꺼짐', async () => {
    const s = await start()
    handle?.setFakeB1({ available: false, adapterOff: false })
    expect(await s.connect('bluetooth')).toBe(true)
    await s.disconnect()
    handle?.setFakeB1({ adapterOff: true })
    expect(await s.connect('bluetooth')).toBe(false)
    expect(s.getSnapshot().connectError?.code).toBe('BLUETOOTH_OFF')
  })

  it('허락된 가짜 B1은 시험 모드에서 sessionStorage로 새로고침을 넘는다 — 새로고침 뒤 "다시 연결"은 고르기 창 없이', async () => {
    const s = await start()
    handle?.setFakeB1({ getDevices: true })
    await s.connect('bluetooth')
    expect(window.sessionStorage.getItem(FAKE_DEVICES_KEY)).not.toBeNull()
    reload()
    handle = null as TestPrinterHandle | null
    const s2 = await start()
    await vi.waitFor(() => expect(handle).not.toBeNull())
    expect(s2.getSnapshot().methods).toEqual(['bluetooth'])
    expect(handle?.fakeB1State()).toMatchObject({ requests: 0, connectAttempts: 0, permitted: true })
    expect(await s2.reconnect()).toBe(true)
    expect(handle?.fakeB1State()).toMatchObject({ requests: 0, connectAttempts: 1, connected: true })
  })

  it('가짜 USB 포트: 꽂으면 USB 선이 생기고, 새로고침 뒤 같은 제품 포트 하나면 "다시 연결"에 고르기 창 없음 · 뽑으면 끊김', async () => {
    const s = await start()
    handle?.useFakeUsb()
    expect(s.getSnapshot().methods).toEqual(['bluetooth', 'serial'])
    await s.connect('serial')
    expect(handle?.fakeUsb()).toMatchObject({ requests: 1, connected: true })
    reload()
    handle = null as TestPrinterHandle | null
    const s2 = await start()
    await vi.waitFor(() => expect(handle).not.toBeNull())
    expect(await s2.reconnect()).toBe(true)
    expect(handle?.fakeUsb()).toMatchObject({ requests: 0, connected: true })
    handle?.unplugFakeUsb(0)
    await vi.waitFor(() => expect(s2.getSnapshot().connection).toBe('DISCONNECTED'))
  })

  it('sessionStorage가 없으면(시험 모드 아님·처음) 가짜 기기를 꽂지 않는다 — 깨진 값도 같다', async () => {
    window.sessionStorage.setItem(FAKE_DEVICES_KEY, '{bad')
    const s = await start()
    expect(s.getSnapshot().methods).toEqual([])
    expect(handle?.fakeB1()).toBeNull()
  })
})

describe('시험 손잡이 — 저절로 다시 잇기 켬/끔 (시험 모드만, 기본 켬)', () => {
  it('끄면 기다리던 시도도 그치고 끊김이 그대로, 다시 켜면 다음 끊김부터 잇는다', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth'] })
    const s = await start({ printer })
    await s.connect('test')
    printer.simulateDisconnect()
    await flush()
    expect(handle?.autoReconnectWaiting()).toBe(true)
    handle?.setAutoReconnect(false)
    expect(handle?.autoReconnectWaiting()).toBe(false)
    await timer.advance(600_000)
    expect(printer.rememberedAttempts).toBe(0)
    expect(s.getSnapshot().connection).toBe('DISCONNECTED')
    handle?.setAutoReconnect(true)
    expect(await s.reconnect()).toBe(true)
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(s.getSnapshot().connection).toBe('CONNECTED')
  })
})
