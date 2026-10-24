// FB1 — 연결 실패 CONNECT_FAILED·자세히는 쉬운 말 고정 문장만·B1 첫 확인 시간 초과 한 번 다시 잇기 (AC-FB1-35~37, L-7, D-FB1-09).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MARKLIFE_MESSAGES,
  NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE,
  PRINTER_ERROR_CODES,
  PRINTER_MESSAGES,
  RETRIED_TIMEOUT_DETAIL,
  TIMEOUT_DETAIL,
  createB1Adapter,
  createFakeBluetooth,
  createFakeNiimbotBluetooth,
  createMarklifeAdapter,
  describeCause,
  isTimeoutCause,
  niimbotRequestOptions,
  type ConnectionState,
  type PrinterAdapter,
  type PrinterEnvironment,
  type PrinterResult,
} from '../src/index.ts'
import { FakeNiimbotClient, ManualTimer, flush, sampleImage } from './fakes.ts'

const CONNECT_FAILED_MESSAGE = '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.'
const NEGOTIATE_TIMEOUT = () => new Error('Unable to perform initial negotiate: Error: Timeout waiting response (waited for c2)')
const domError = (name: string, message = name) => Object.assign(new Error(message), { name })

/** 고른 기기를 돌려주는 환경 (requestDevice 부른 횟수를 센다) */
function deviceEnv(options: { serial?: boolean } = {}) {
  const picked = { name: 'B1-H123456789' }
  const calls: unknown[] = []
  const env: PrinterEnvironment = {
    bluetooth: {
      requestDevice: (request: unknown) => {
        calls.push(request)
        return Promise.resolve(picked)
      },
    },
    ...(options.serial ? { serial: { requestPort: () => undefined } } : {}),
  }
  return { env, picked, calls }
}

/** connect()를 부를 때마다 차례로 errors를 던지는 클라이언트 (undefined면 연결 성공) */
class SequenceClient extends FakeNiimbotClient {
  readonly seen: (unknown | undefined)[] = []
  private readonly errors: unknown[]
  constructor(errors: unknown[]) {
    super()
    this.errors = [...errors]
  }

  override async connect(options?: { readonly authorizedDevice?: unknown }): Promise<unknown> {
    this.seen.push(options?.authorizedDevice)
    const error = this.errors.shift()
    if (error !== undefined) {
      this.connected = false
      throw error
    }
    return super.connect()
  }
}

function setupB1(client: FakeNiimbotClient, env: PrinterEnvironment = deviceEnv().env) {
  const timer = new ManualTimer()
  const made: string[] = []
  const adapter = createB1Adapter({
    environment: () => env,
    createClient: (method) => {
      made.push(method)
      return client
    },
    timer,
  })
  const states: ConnectionState[] = []
  adapter.onStateChange((s) => states.push(s))
  return { adapter, timer, made, states }
}

/** 상세로 올 수 있는 글 (L-7 자세히) */
function allowedDetail(detail: string | undefined): boolean {
  return detail === undefined || detail === TIMEOUT_DETAIL || detail === RETRIED_TIMEOUT_DETAIL || /^모델: /.test(detail)
}

describe('CONNECT_FAILED 코드와 문장 (AC-FB1-35)', () => {
  it('PRINTER_ERROR_CODES·PRINTER_MESSAGES·MARKLIFE_MESSAGES에 CONNECT_FAILED — L-7 표와 글자까지 같다', () => {
    expect(PRINTER_ERROR_CODES).toContain('CONNECT_FAILED')
    expect(PRINTER_MESSAGES.CONNECT_FAILED).toBe(CONNECT_FAILED_MESSAGE)
    expect(MARKLIFE_MESSAGES.CONNECT_FAILED).toBe(CONNECT_FAILED_MESSAGE)
    expect(TIMEOUT_DETAIL).toBe('프린터가 답하지 않아 기다리는 시간이 지났어요.')
    expect(RETRIED_TIMEOUT_DETAIL).toBe('프린터가 답하지 않아 기다리는 시간이 지났어요. 한 번 더 해 봤지만 안 됐어요.')
  })

  it('B1 블루투스: (b) 특성 없음 (c) NetworkError → CONNECT_FAILED + 다시 연결, 상태 DISCONNECTED, 상세 없음, 다시 잇지 않는다', async () => {
    for (const error of [new Error('Suitable device characteristic not found'), domError('NetworkError', 'Connection failed for unknown reason.')]) {
      const client = new SequenceClient([error])
      const { adapter, states } = setupB1(client)
      const r = await adapter.connect('bluetooth')
      expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결' } })
      expect(adapter.state).toBe('DISCONNECTED')
      expect(states).toEqual(['CONNECTING', 'DISCONNECTED'])
      expect(client.seen).toHaveLength(1)
    }
  })

  it('(d) 고르기 취소 NOT_SELECTED (e) 블루투스 꺼짐 BLUETOOTH_OFF (f) USB InvalidStateError PORT_BUSY — 지금 그대로', async () => {
    const cancelEnv: PrinterEnvironment = { bluetooth: { requestDevice: () => Promise.reject(domError('NotFoundError', 'User cancelled the requestDevice() chooser.')) } }
    const cancelled = await setupB1(new FakeNiimbotClient(), cancelEnv).adapter.connect('bluetooth')
    expect(cancelled).toEqual({ ok: false, error: { code: 'NOT_SELECTED', message: PRINTER_MESSAGES.NOT_SELECTED } })

    const offEnv: PrinterEnvironment = { bluetooth: { requestDevice: () => Promise.reject(new Error('Bluetooth adapter not available.')) } }
    const off = await setupB1(new FakeNiimbotClient(), offEnv).adapter.connect('bluetooth')
    expect(off).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })

    const usb = new SequenceClient([domError('InvalidStateError', 'The port is already open.')])
    const busy = await setupB1(usb, deviceEnv({ serial: true }).env).adapter.connect('serial')
    expect(busy).toEqual({ ok: false, error: { code: 'PORT_BUSY', message: PRINTER_MESSAGES.PORT_BUSY } })
  })

  it('USB(시리얼)의 그 밖의 연결 실패도 CONNECT_FAILED, 다시 잇지 않는다 (시간 초과여도)', async () => {
    const client = new SequenceClient([NEGOTIATE_TIMEOUT()])
    const { adapter, timer } = setupB1(client, deviceEnv({ serial: true }).env)
    const r = await adapter.connect('serial')
    expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결', detail: TIMEOUT_DETAIL } })
    expect(client.seen).toHaveLength(1)
    expect(timer.pending).toBe(0)
  })

  it('연결된 뒤 끊김은 지금처럼 DISCONNECTED (출력 중 끊김)', async () => {
    const client = new SequenceClient([])
    const { adapter } = setupB1(client)
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    client.autoFinish = false
    const pending = adapter.print(sampleImage())
    await flush()
    client.emitDisconnect()
    expect(await pending).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: PRINTER_MESSAGES.DISCONNECTED, action: '다시 연결' } })
  })

  it('연결하는 동안 끊기를 누르면 지금처럼 DISCONNECTED (그 뒤 연결 예외가 와도)', async () => {
    let reject!: (error: unknown) => void
    const client = new FakeNiimbotClient()
    client.connect = () =>
      new Promise((_resolve, rej) => {
        reject = rej
      })
    const { adapter } = setupB1(client)
    const pending = adapter.connect('bluetooth')
    await flush()
    await adapter.disconnect()
    reject(new Error('GATT Server is disconnected. Cannot perform GATT operations.'))
    expect(await pending).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: PRINTER_MESSAGES.DISCONNECTED, action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('Marklife·바우아토: 고르기 창 예외(그 밖)·GATT 연결 실패·알림 켜기 실패 → CONNECT_FAILED, 상세 없음', async () => {
    const timer = new ManualTimer()
    const gattFails = createFakeBluetooth({ timer, connectFails: true })
    const a = createMarklifeAdapter({ environment: () => gattFails.environment, timer })
    expect(await a.connect('bluetooth')).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결' } })
    expect(a.state).toBe('DISCONNECTED')

    const weird = createFakeBluetooth({ timer })
    const env = { ...weird.environment, bluetooth: { ...weird.bluetooth, requestDevice: () => Promise.reject(domError('NetworkError', 'Bluetooth GATT error 0x85 at 010-1234-5678')) } }
    const b = createMarklifeAdapter({ environment: () => env, timer })
    expect(await b.connect('bluetooth')).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결' } })
  })

  it('Marklife: 시간 초과 예외면 상세는 TIMEOUT_DETAIL, 다시 잇지 않는다', async () => {
    const timer = new ManualTimer()
    const fake = createFakeBluetooth({ timer })
    let calls = 0
    const env = {
      ...fake.environment,
      bluetooth: {
        ...fake.bluetooth,
        requestDevice: () => {
          calls++
          return Promise.reject(new Error('Connection attempt timed out'))
        },
      },
    }
    const adapter = createMarklifeAdapter({ environment: () => env, timer })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결', detail: TIMEOUT_DETAIL } })
    expect(calls).toBe(1)
  })
})

describe('B1 첫 확인 시간 초과 — 같은 기기로 한 번 다시 잇기 (AC-FB1-36)', () => {
  it('고르기 창은 한 번, 1초 쉰 뒤 같은 기기로 다시 잇는다 — 그동안 CONNECTING, 두 번째 성공이면 CONNECTED·오류 없음', async () => {
    const { env, picked, calls } = deviceEnv()
    const client = new SequenceClient([NEGOTIATE_TIMEOUT()])
    const { adapter, timer, states } = setupB1(client, env)
    let result: PrinterResult | undefined
    void adapter.connect('bluetooth').then((r) => {
      result = r
    })
    await flush()
    expect(client.seen).toEqual([picked])
    expect(adapter.state).toBe('CONNECTING')
    await timer.advance(999)
    expect(client.seen).toHaveLength(1)
    expect(result).toBeUndefined()
    await timer.advance(1)
    expect(client.seen).toEqual([picked, picked])
    expect(result).toEqual({ ok: true })
    expect(adapter.state).toBe('CONNECTED')
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
    expect(calls).toHaveLength(1)
    // 이어진 뒤 출력도 된다
    expect((await adapter.print(sampleImage())).ok).toBe(true)
  })

  it('고르기 창 거르기는 niimbluelib과 같다 (모델 이름 첫 글자들 + 서비스)', async () => {
    const { env, calls } = deviceEnv()
    await setupB1(new SequenceClient([]), env).adapter.connect('bluetooth')
    expect(calls).toEqual([niimbotRequestOptions()])
    const filters = niimbotRequestOptions().filters
    expect(filters).toContainEqual({ namePrefix: 'B' })
    expect(filters.at(-1)).toEqual({ services: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2'] })
  })

  it('두 번째도 실패하면 CONNECT_FAILED, 상세 "… 한 번 더 해 봤지만 안 됐어요." — 다시 잇기는 많아야 한 번', async () => {
    const { env, calls } = deviceEnv()
    const client = new SequenceClient([NEGOTIATE_TIMEOUT(), NEGOTIATE_TIMEOUT(), NEGOTIATE_TIMEOUT(), NEGOTIATE_TIMEOUT()])
    const { adapter, timer, states } = setupB1(client, env)
    const pending = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect(await pending).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결', detail: RETRIED_TIMEOUT_DETAIL } })
    expect(client.seen).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(states).toEqual(['CONNECTING', 'DISCONNECTED'])
    expect(timer.pending).toBe(0)
    // 판매자가 다시 연결을 누르면 고르기부터 (그 누름에서도 많아야 한 번 다시 잇는다)
    const again = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect((await again).ok).toBe(false)
    expect(calls).toHaveLength(2)
    expect(client.seen).toHaveLength(4)
  })

  it('첫 실패가 시간 초과면 상세는 시간 초과 문장, 두 번째 실패가 다른 까닭이어도 CONNECT_FAILED면 다시 해 봤다는 상세', async () => {
    const client = new SequenceClient([NEGOTIATE_TIMEOUT(), new Error('Suitable device characteristic not found')])
    const { adapter, timer } = setupB1(client)
    const pending = adapter.connect('bluetooth')
    await timer.advance(1_000)
    const r = await pending
    expect(!r.ok && r.error).toMatchObject({ code: 'CONNECT_FAILED', detail: RETRIED_TIMEOUT_DETAIL })
  })

  it('시간 초과가 아닌 첫 실패((b)·(c))는 다시 잇지 않는다', async () => {
    for (const error of [new Error('Suitable device characteristic not found'), domError('NetworkError', 'Connection failed.')]) {
      const client = new SequenceClient([error])
      const { adapter, timer } = setupB1(client)
      expect((await adapter.connect('bluetooth')).ok).toBe(false)
      expect(timer.pending).toBe(0)
      expect(client.seen).toHaveLength(1)
    }
  })

  it('쉬는 동안 "연결 끊기"를 누르면 다시 잇지 않고 DISCONNECTED (원인 없음)', async () => {
    const client = new SequenceClient([NEGOTIATE_TIMEOUT()])
    const { adapter, timer } = setupB1(client)
    const pending = adapter.connect('bluetooth')
    await flush()
    expect(timer.pending).toBe(1)
    await adapter.disconnect()
    expect(await pending).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: PRINTER_MESSAGES.DISCONNECTED, action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(timer.pending).toBe(0)
    await timer.advance(5_000)
    expect(client.seen).toHaveLength(1)
  })

  it('쉬는 동안 연결을 또 누르면 같은 연결을 기다린다 (다시 잇기 한 번, 고르기 창 한 번)', async () => {
    const { env, calls } = deviceEnv()
    const client = new SequenceClient([NEGOTIATE_TIMEOUT()])
    const { adapter, timer } = setupB1(client, env)
    const a = adapter.connect('bluetooth')
    await flush()
    const b = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect(await a).toEqual({ ok: true })
    expect(await b).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(client.seen).toHaveLength(2)
  })

  it('다시 이은 기기가 B1이 아니면 WRONG_MODEL — 상세는 "모델: …"', async () => {
    const client = new SequenceClient([NEGOTIATE_TIMEOUT()])
    client.model = 'D110'
    const { adapter, timer } = setupB1(client)
    const pending = adapter.connect('bluetooth')
    await timer.advance(1_000)
    const r = await pending
    expect(!r.ok && r.error).toMatchObject({ code: 'WRONG_MODEL', detail: '모델: D110' })
  })
})

describe('가짜 NIIMBOT 블루투스 기기 — 처음 N번 협상에 답하지 않기 (AC-FB1-36·40)', () => {
  function withFake(n: number) {
    const timer = new ManualTimer()
    const fake = createFakeNiimbotBluetooth({ unansweredNegotiations: n, timer })
    const adapter: PrinterAdapter = createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient, timer })
    return { fake, adapter, timer }
  }

  it('처음 한 번만 답하지 않으면 저절로 다시 이어져 연결됨, 고르기 창 한 번, 같은 기기 두 번', async () => {
    const { fake, adapter, timer } = withFake(1)
    const pending = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect(await pending).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(fake.connectAttempts).toBe(2)
    expect(fake.authorizedDevices).toEqual([fake.device, fake.device])
    expect(fake.connected).toBe(true)
    expect((await adapter.print(sampleImage())).ok).toBe(true)
    expect(fake.printed).toHaveLength(1)
    expect(fake.printed[0]?.image.rows).toBe(241)
  })

  it('처음 두 번 답하지 않으면 CONNECT_FAILED와 다시 해 봤다는 상세 — 영어 글 없음. "다시 연결"은 고르기부터, 그때는 이어진다', async () => {
    const { fake, adapter, timer } = withFake(2)
    const pending = adapter.connect('bluetooth')
    await timer.advance(1_000)
    const r = await pending
    expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결', detail: RETRIED_TIMEOUT_DETAIL } })
    expect(JSON.stringify(r)).not.toMatch(/Error|negotiate|Timeout|waited/)
    expect(fake.unansweredNegotiations).toBe(0)
    const again = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect(await again).toEqual({ ok: true })
    expect(fake.requests).toBe(2)
  })

  it('답하지 않을 때의 예외 글은 niimbluelib과 같다 (시간 초과로 알아본다)', () => {
    expect(NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE).toBe(NEGOTIATE_TIMEOUT().message)
    expect(isTimeoutCause(new Error(NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE))).toBe(true)
  })

  it('프린터 쪽에서 끊기면 DISCONNECTED 상태, 고르기 창 닫기는 NOT_SELECTED', async () => {
    const { fake, adapter, timer } = withFake(0)
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    fake.disconnect()
    expect(adapter.state).toBe('DISCONNECTED')
    fake.setChooser('cancel')
    const pending = adapter.connect('bluetooth')
    await timer.advance(0)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
  })
})

describe('자세히에 원문 없음 (AC-FB1-37)', () => {
  it('describeCause는 원래 예외 글을 돌려주지 않는다 — 시간 초과만 고정 문장', () => {
    expect(describeCause(new Error('Suitable device characteristic not found'))).toBeUndefined()
    expect(describeCause(domError('NetworkError', 'GATT operation failed 010-1234-5678'))).toBeUndefined()
    expect(describeCause('timed out after 5s')).toBe(TIMEOUT_DETAIL)
    expect(describeCause(new Error('TIMEOUT'))).toBe(TIMEOUT_DETAIL)
    expect(describeCause(undefined)).toBeUndefined()
    expect(describeCause(null)).toBeUndefined()
  })

  it('무작위 예외로 연결·출력이 실패해도 상세는 정해진 글뿐 (B1·Marklife)', async () => {
    const word = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.stringMatching(/^0\d{1,2}-\d{3,4}-\d{4}$/),
      fc.constantFrom('Timeout', 'timed out', 'NetworkError', 'GATT', 'negotiate', 'waited for c2'),
    )
    const cause = fc.oneof(
      fc.tuple(fc.constantFrom('Error', 'NetworkError', 'NotSupportedError', 'InvalidStateError', 'PrintError', 'TypeError'), fc.array(word, { maxLength: 5 })).map(
        ([name, words]) => domError(name, words.join(' ')),
      ),
      fc.array(word, { maxLength: 4 }).map((words) => words.join(' ')),
    )
    await fc.assert(
      fc.asyncProperty(cause, cause, fc.constantFrom('bluetooth' as const, 'serial' as const), async (first, second, method) => {
        // 연결 실패
        const client = new SequenceClient([first, second])
        const { adapter, timer } = setupB1(client, deviceEnv({ serial: true }).env)
        const pending = adapter.connect(method)
        await timer.advance(1_000)
        const r = await pending
        if (!r.ok) expect(allowedDetail(r.error.detail), String(r.error.detail)).toBe(true)
        // 출력 실패
        const printing = new SequenceClient([])
        const p = setupB1(printing, deviceEnv().env)
        await p.adapter.connect('bluetooth')
        printing.failOn = 'page'
        const originalPage = printing.protocol.newPrintTask
        printing.protocol.newPrintTask = (name, options) => {
          const task = originalPage(name, options)
          task.printPage = () => Promise.reject(first)
          return task
        }
        const pr = await p.adapter.print(sampleImage())
        if (!pr.ok) expect(allowedDetail(pr.error.detail), String(pr.error.detail)).toBe(true)
        // Marklife 고르기 창 예외
        const mtimer = new ManualTimer()
        const fake = createFakeBluetooth({ timer: mtimer })
        const env = { ...fake.environment, bluetooth: { ...fake.bluetooth, requestDevice: () => Promise.reject(first) } }
        const m = await createMarklifeAdapter({ environment: () => env, timer: mtimer }).connect('bluetooth')
        if (!m.ok) expect(allowedDetail(m.error.detail), String(m.error.detail)).toBe(true)
      }),
      { numRuns: 200, seed: 20261024 },
    )
  })
})
