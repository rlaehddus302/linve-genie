// 이 기기의 프린터 (AC-I1-06·07·10·21~23·50, L-11 4·6·8·10): 출력 기기이고 멈추지 않았고 프린터가 이어져 있을 때만 한 장씩 받아 찍고 결과를 알린다.
// 끊기면 끊김으로 알리고 다시 연결하면 이어서. 테스트 인쇄는 서버를 거치지 않는다. 시험용 프린터 손잡이는 시험 모드에서만.
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import { createFakePrinter, type FakePrinter } from '@livejjim/printer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedJob, PrintOverview } from '../src/api/print-types.ts'
import { saveAttempt, savedAttempt } from '../src/lib/device.ts'
import { PrintStore } from '../src/lib/print-store.ts'
import { PrinterStation, type TestPrinterHandle } from '../src/lib/printer-station.ts'
import { device, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const ME = 'device-me-1234'
let server: FakeServer
let current: PrintOverview
let claims: ClaimedJob[]
let results: Record<string, unknown>[]
let states: Record<string, unknown>[]
let printer: FakePrinter
let handle: TestPrinterHandle | null
let testMode: boolean
let store: PrintStore | null = null
let station: PrinterStation | null = null

const IMAGE: LabelBitmap = createBitmap(384, 240)

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
  handle = null
  testMode = true
  printer = createFakePrinter({ methods: ['bluetooth'] })
  server
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: testMode } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('POST', /^\/api\/print\/claim$/, () => {
      const next = claims.shift()
      return { body: next === undefined ? { job: null, reason: 'EMPTY' } : { job: next } }
    })
    .on('POST', /^\/api\/print\/result$/, (call) => {
      results.push(call.body ?? {})
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
  station?.stop()
  store?.stop()
  station = null
  store = null
  vi.unstubAllGlobals()
})

async function start(options: { render?: () => Promise<{ ok: true; image: LabelBitmap } | { ok: false; error: { code: 'DOES_NOT_FIT'; message: string; item: string } }> } = {}): Promise<PrinterStation> {
  store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  station = new PrinterStation({
    store,
    deviceId: ME,
    createTestPrinter: () => printer,
    detect: () => [],
    render: options.render ?? (async () => ({ ok: true, image: IMAGE })),
    renderTest: async () => ({ ok: true, image: IMAGE }),
    requestWakeLock: null,
    today: () => DATE,
    exposeTestHandle: (value) => {
      handle = value
    },
  })
  store.start()
  station.start()
  await flush()
  return station
}

const claimCalls = () => server.callsTo('POST', /^\/api\/print\/claim$/).length

describe('받기·찍기·결과 (L-11 4·6)', () => {
  it('출력 기기이고 프린터가 이어지면 대기열에서 한 장씩 받아 찍고 출력함을 알린다', async () => {
    claims = [claimed('j1'), claimed('j2')]
    const s = await start()
    expect(claimCalls()).toBe(0) // 프린터를 잇기 전에는 받지 않는다 (페이지를 열 때 스스로 잇지 않는다)
    expect(printer.state).toBe('DISCONNECTED')
    await s.connect('test')
    await vi.waitFor(() => expect(results).toHaveLength(2))
    expect(printer.printed).toHaveLength(2)
    expect(results).toEqual([
      { deviceId: ME, attempt: 'attempt-j1-0000', ok: true },
      { deviceId: ME, attempt: 'attempt-j2-0000', ok: true },
    ])
    expect(printer.printed[0]?.density).toBe(3)
    // 열 때: 서버는 이 기기를 출력 기기로 알지만 프린터는 아직 이어지지 않았다 → 끊김, 이은 뒤 → 연결됨
    expect(states).toEqual([
      { deviceId: ME, connected: false },
      { deviceId: ME, connected: true },
    ])
    expect(savedAttempt()).toBeNull()
  })

  it('출력 기기가 아니거나 멈춰 있으면 받지 않는다', async () => {
    current = overview({ queue: queue({ device: device('someone-else-1') }) })
    claims = [claimed('j1')]
    const s = await start()
    await s.connect('test')
    await flush()
    expect(claimCalls()).toBe(0)
    current = overview({ queue: queue({ rev: 2, device: device(ME), pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } }) })
    await store?.reload()
    await flush()
    expect(claimCalls()).toBe(0)
    // 출력 시작 → 알림 → 받는다
    FakeEventSource.last.emit('print', { rev: 3, queue: queue({ rev: 3, device: device(ME) }), jobs: [], labels: [] })
    await vi.waitFor(() => expect(results).toHaveLength(1))
  })

  it('끊기면 그 장은 끊김으로 알리고(대기 맨 앞은 서버가) 프린터 연결 끊김도 알린다 — 다시 연결하면 연결됨을 알리고 이어서 받는다', async () => {
    claims = [claimed('j1'), claimed('j2')]
    printer.setBehavior(2, 'disconnect')
    const s = await start()
    await s.connect('test')
    await vi.waitFor(() => expect(results).toHaveLength(2))
    expect(results[1]).toEqual({ deviceId: ME, attempt: 'attempt-j2-0000', ok: false, error: { code: 'DISCONNECTED' } })
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ deviceId: ME, connected: false }))
    expect(s.getSnapshot().lastError).toBe('프린터 연결이 끊겼어요.')
    // 서버가 끊김 멈춤 → 다시 연결 → 멈춤 풀림 알림 → 다시 받는다
    current = overview({ queue: queue({ rev: 5, device: device(ME, { printerConnected: false }), pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } }) })
    await store?.reload()
    claims = [claimed('j2b')]
    expect(s.canReconnect).toBe(true)
    await s.reconnect()
    expect(states.at(-1)).toEqual({ deviceId: ME, connected: true })
    FakeEventSource.last.emit('print', { rev: 6, queue: queue({ rev: 6, device: device(ME) }), jobs: [], labels: [] })
    await vi.waitFor(() => expect(results).toHaveLength(3))
    expect(printer.printed).toHaveLength(2)
  })

  it('라벨을 그리지 못하면 라벨 오류 코드(항목과 함께)를 알린다 — 프린터로 보내지 않는다', async () => {
    claims = [claimed('j1')]
    const s = await start({ render: async () => ({ ok: false, error: { code: 'DOES_NOT_FIT', message: '가격 칸이 좁아 라벨을 만들 수 없어요.', item: 'price' } }) })
    await s.connect('test')
    await vi.waitFor(() => expect(results).toHaveLength(1))
    expect(results[0]).toEqual({ deviceId: ME, attempt: 'attempt-j1-0000', ok: false, error: { code: 'DOES_NOT_FIT', item: 'price' } })
    expect(printer.printCalls).toBe(0)
  })

  it('앱이 출력 중에 닫혔던 시도는 다음에 열 때 끊김으로 알린다(찍혔는지 모른다 — 대기 맨 앞으로)', async () => {
    saveAttempt({ deviceId: ME, attempt: 'attempt-lost-0000' })
    await start()
    await vi.waitFor(() => expect(results).toHaveLength(1))
    expect(results[0]).toEqual({ deviceId: ME, attempt: 'attempt-lost-0000', ok: false, error: { code: 'DISCONNECTED' } })
    expect(savedAttempt()).toBeNull()
    // 이 기기가 출력 기기인데 프린터가 이어져 있지 않다 → 끊김을 알린다
    await vi.waitFor(() => expect(states).toEqual([{ deviceId: ME, connected: false }]))
  })
})

describe('테스트 인쇄·농도 (AC-I1-22)', () => {
  it('서버를 거치지 않고 그 프린터로 찍는다 — 대기열 작업을 찍는 중이면 하지 않는다', async () => {
    current = overview({ queue: queue({ device: null }) })
    const s = await start()
    await s.connect('test')
    s.setDensity(5)
    s.setDensity(9)
    expect(s.getSnapshot().density).toBe(5)
    await s.testPrint({ shopName: '다육농장', size: '50x30' })
    expect(s.getSnapshot().testPrinted).toBe(true)
    expect(printer.printed).toHaveLength(1)
    expect(printer.printed[0]?.density).toBe(5)
    expect(results).toHaveLength(0)
    expect(claimCalls()).toBe(0)
  })
})

describe('시험용 프린터 (AC-I1-50)', () => {
  it('시험 모드에서만 손잡이가 생긴다', async () => {
    testMode = false
    await start()
    expect(handle).toBeNull()
    station?.stop()
    store?.stop()
    testMode = true
    await start()
    expect(handle).not.toBeNull()
    handle?.setBehavior(1, 'fail')
    expect(handle?.printedCount()).toBe(0)
  })
})

describe('출력 기기 되기 (AC-I1-10·23)', () => {
  it('다른 기기가 출력 기기면 바꾸기를 묻게 그 이름을 돌려준다', async () => {
    server.on('POST', /^\/api\/print\/device$/, () => ({ status: 409, body: { error: { code: 'PRINT_DEVICE_TAKEN', message: '다른 기기에서 출력하고 있어요. 이 기기로 바꾸려면 바꾸기를 눌러 주세요.' }, device: { name: 'PC' } } }))
    const s = await start()
    expect(await s.become('휴대폰', false)).toEqual({ kind: 'taken', name: 'PC' })
  })
})
