// FB1 적대 시험 (test-domain): 프린터 오류의 "자세히"에 원래 예외 글이 없다 (AC-FB1-37, AC-FB1-35·36, D-FB1-09, 절대 규칙 7·8).
// 무작위 영어·숫자·전화번호·시간 초과 낱말이 섞인 예외 1,000개로 B1(블루투스·USB·첫 확인 다시 잇기·출력)과 Marklife(고르기·GATT·알림·출력)의
// 연결·출력 실패를 내고, 결과의 detail이 정해진 글 셋(없음·시간 초과·한 번 더 해 봄, WRONG_MODEL은 "모델: …")뿐인지 본다.
// 원래 예외 글이 detail·message 어디에도 새지 않는지(전화번호 포함)도 본다. 실패는 늘 PrinterResult로 끝난다(예외로 새지 않음).
import {
  MARKLIFE_MESSAGES,
  PRINTER_MESSAGES,
  RETRIED_TIMEOUT_DETAIL,
  TIMEOUT_DETAIL,
  createB1Adapter,
  createFakeBluetooth,
  createFakeNiimbotBluetooth,
  createMarklifeAdapter,
  describeCause,
  type BluetoothDeviceLike,
  type BluetoothEnvironment,
  type GattCharacteristicLike,
  type GattServerLike,
  type NiimbotClientLike,
  type NiimbotPrintTaskLike,
  type PrinterEnvironment,
  type PrinterResult,
  type PrinterTimer,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PacedTimer, flush, sampleImage } from '../../../packages/printer/test/fakes.ts'

const CONNECT_FAILED = '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.'

/** 바로 돌리는 타이머 (다시 잇기 쉼 1초를 기다리지 않는다) */
const instant: PrinterTimer = {
  setTimeout: (fn) => {
    queueMicrotask(fn)
    return 0
  },
  clearTimeout: () => undefined,
}

// ── 무작위 예외 ─────────────────────────────────────────────
const WORDS = ['Unable', 'to', 'perform', 'initial', 'negotiate', 'Error:', 'Timeout', 'waiting', 'response', '(waited', 'for', 'c2)', 'GATT', 'operation', 'failed', 'characteristic', 'not', 'found', 'NetworkError', 'device', 'disconnected', 'timed', 'out', 'busy', 'open', 'port', 'access', 'denied', 'undefined', 'null', '<script>alert(1)</script>', 'printer', 'status', '0x1f', 'B1-H123', 'code', 'unknown']
const PHONES = ['010-1234-5678', '01098765432', '+82 10 5555 1234', '010 2222 3333']
const NAMES = ['Error', 'NetworkError', 'TypeError', 'DOMException', 'NotSupportedError', 'InvalidStateError', 'TimeoutError', 'OperationError', 'UnknownError', 'NotFoundError', 'SecurityError', 'AbortError', 'NotAllowedError', 'PrintError', '']

const messageArb = fc
  .array(fc.oneof(fc.constantFrom(...WORDS), fc.constantFrom(...PHONES), fc.integer({ min: 0, max: 99_999_999 }).map(String), fc.string({ maxLength: 12 })), { minLength: 0, maxLength: 12 })
  .map((parts) => parts.join(' '))

/** 던질 값: Error(이름 바꿈 포함)·DOMException 꼴 객체·글·숫자 */
const thrownArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: fc.tuple(fc.constantFrom(...NAMES), messageArb).map(([name, message]) => Object.assign(new Error(message), name === '' ? {} : { name })) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...NAMES), messageArb).map(([name, message]) => ({ name, message })) },
  { weight: 1, arbitrary: messageArb },
  { weight: 1, arbitrary: fc.integer() },
)

/** 예외 글에 든 원래 낱말 (detail·message에 새면 안 된다) — 3글자 이상, 고정 문장·L-7 표에 원래 있는 낱말은 뺀다 */
function leakyTokens(thrown: unknown): string[] {
  const text = thrown instanceof Error ? `${thrown.name} ${thrown.message}` : typeof thrown === 'object' && thrown !== null ? `${String((thrown as { name: unknown }).name)} ${String((thrown as { message: unknown }).message)}` : String(thrown)
  const safe = new Set(['B1', 'NIIMBOT', 'USB', 'Marklife'])
  return text.split(/\s+/).filter((t) => t.length >= 3 && !safe.has(t))
}

const ALLOWED = new Set([undefined, TIMEOUT_DETAIL, RETRIED_TIMEOUT_DETAIL])

function checkResult(result: PrinterResult, thrown: readonly unknown[], context: string): void {
  if (result.ok) return
  const { code, message, detail } = result.error
  if (code === 'WRONG_MODEL') expect(detail === undefined || /^모델: /.test(detail), context).toBe(true)
  else expect(ALLOWED.has(detail), `${context}: ${code} detail=${String(detail)}`).toBe(true)
  // 문장은 표 그대로 (어떤 예외 글도 섞이지 않는다)
  const table = Object.values(PRINTER_MESSAGES).concat(Object.values(MARKLIFE_MESSAGES))
  expect(table.includes(message) || /이 브라우저에서는/.test(message), `${context}: ${message}`).toBe(true)
  const shown = `${message} ${detail ?? ''}`
  for (const value of thrown) for (const token of leakyTokens(value)) if (!/^\d{1,2}$/.test(token)) expect(shown.includes(token) && !CONNECT_FAILED.includes(token) && !String(detail).startsWith('모델: '), `${context}: "${token}"가 보인다`).toBe(false)
  if (code === 'DISCONNECTED' || code === 'CONNECT_FAILED') expect(result.error.action, context).toBe('다시 연결')
}

// ── B1 ────────────────────────────────────────────────────
class ScriptedClient implements NiimbotClientLike {
  connected = false
  readonly connectErrors: (unknown | undefined)[]
  printError: unknown
  printStep: 'init' | 'page' | 'wait'
  model: string
  private readonly listeners = new Set<() => void>()
  constructor(connectErrors: (unknown | undefined)[], printError: unknown = undefined, printStep: 'init' | 'page' | 'wait' = 'init', model = 'B1') {
    this.connectErrors = [...connectErrors]
    this.printError = printError
    this.printStep = printStep
    this.model = model
  }
  connect(): Promise<unknown> {
    const error = this.connectErrors.shift()
    if (error !== undefined) {
      this.connected = false
      return Promise.reject(error)
    }
    this.connected = true
    return Promise.resolve({ result: 1 })
  }
  disconnect(): Promise<void> {
    this.connected = false
    for (const l of [...this.listeners]) l()
    return Promise.resolve()
  }
  isConnected(): boolean {
    return this.connected
  }
  getModelMetadata(): { model: string } | undefined {
    return this.connected ? { model: this.model } : undefined
  }
  on(_e: 'disconnect', l: () => void): unknown {
    this.listeners.add(l)
    return this
  }
  off(_e: 'disconnect', l: () => void): unknown {
    this.listeners.delete(l)
    return this
  }
  readonly protocol = {
    newPrintTask: (): NiimbotPrintTaskLike => {
      const step = (name: 'init' | 'page' | 'wait'): Promise<void> => (this.printError !== undefined && this.printStep === name ? Promise.reject(this.printError) : Promise.resolve())
      return { printInit: () => step('init'), printPage: () => step('page'), waitForFinished: () => step('wait'), printEnd: () => Promise.resolve(true) }
    },
  }
}

const deviceEnv = (pick: () => Promise<unknown>, serial = false): PrinterEnvironment => ({
  bluetooth: { requestDevice: pick },
  ...(serial ? { serial: { requestPort: () => undefined } } : {}),
})

type B1Case =
  | { kind: 'bt'; first: unknown; second: unknown | undefined }
  | { kind: 'pick'; error: unknown }
  | { kind: 'serial'; error: unknown }
  | { kind: 'make'; error: unknown }
  | { kind: 'print'; error: unknown; step: 'init' | 'page' | 'wait'; dropFirst: boolean }
  | { kind: 'model'; model: string }

const b1CaseArb: fc.Arbitrary<B1Case> = fc.oneof(
  fc.record({ kind: fc.constant('bt' as const), first: thrownArb, second: fc.option(thrownArb, { nil: undefined }) }),
  fc.record({ kind: fc.constant('pick' as const), error: thrownArb }),
  fc.record({ kind: fc.constant('serial' as const), error: thrownArb }),
  fc.record({ kind: fc.constant('make' as const), error: thrownArb }),
  fc.record({ kind: fc.constant('print' as const), error: thrownArb, step: fc.constantFrom('init' as const, 'page' as const, 'wait' as const), dropFirst: fc.boolean() }),
  fc.record({ kind: fc.constant('model' as const), model: fc.constantFrom('D110', 'D11', 'B21', 'B3S', 'D101') }),
)

async function runB1(c: B1Case): Promise<{ result: PrinterResult; thrown: unknown[] }> {
  const picked = { name: 'B1-H123456789' }
  switch (c.kind) {
    case 'bt': {
      const client = new ScriptedClient([c.first, c.second])
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve(picked)), createClient: () => client, timer: instant })
      return { result: await adapter.connect('bluetooth'), thrown: [c.first, c.second] }
    }
    case 'pick': {
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.reject(c.error)), createClient: () => new ScriptedClient([]), timer: instant })
      return { result: await adapter.connect('bluetooth'), thrown: [c.error] }
    }
    case 'serial': {
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve(picked), true), createClient: () => new ScriptedClient([c.error]), timer: instant })
      return { result: await adapter.connect('serial'), thrown: [c.error] }
    }
    case 'make': {
      const adapter = createB1Adapter({
        environment: () => deviceEnv(() => Promise.resolve(picked)),
        createClient: () => {
          throw c.error
        },
        timer: instant,
      })
      return { result: await adapter.connect('bluetooth'), thrown: [c.error] }
    }
    case 'print': {
      const client = new ScriptedClient([], c.error, c.step)
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve(picked)), createClient: () => client, timer: new PacedTimer() })
      expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
      // 예외보다 끊김이 먼저인 경우(isConnected 거짓)도 섞는다
      if (c.dropFirst) client.connected = false
      return { result: await adapter.print(sampleImage(1, 384, 40)), thrown: [c.error] }
    }
    case 'model': {
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve(picked)), createClient: () => new ScriptedClient([], undefined, 'init', c.model), timer: instant })
      return { result: await adapter.connect('bluetooth'), thrown: [] }
    }
  }
}

// ── Marklife ───────────────────────────────────────────────
type MlCase = { kind: 'pick' | 'gatt' | 'notify' | 'write'; error: unknown }
const mlCaseArb: fc.Arbitrary<MlCase> = fc.record({ kind: fc.constantFrom('pick' as const, 'gatt' as const, 'notify' as const, 'write' as const), error: thrownArb })

/** 가짜 블루투스의 한 곳에서 c.error를 던지게 감싼다 */
function wrapped(c: MlCase, timer: PrinterTimer): BluetoothEnvironment {
  const fake = createFakeBluetooth({ name: 'S2_FAKE01', timer })
  const wrapChar = (ch: GattCharacteristicLike): GattCharacteristicLike =>
    new Proxy(ch, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown
        if (c.kind === 'notify' && key === 'startNotifications') return () => Promise.reject(c.error)
        if (c.kind === 'write' && (key === 'writeValueWithoutResponse' || key === 'writeValue') && typeof value === 'function') return () => Promise.reject(c.error)
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    })
  const wrapServer = (server: GattServerLike): GattServerLike =>
    new Proxy(server, {
      get(target, key, receiver) {
        if (key === 'getPrimaryService')
          return async (uuid: string) => {
            const service = await target.getPrimaryService(uuid)
            return { getCharacteristic: async (id: string) => wrapChar(await service.getCharacteristic(id)) }
          }
        const value = Reflect.get(target, key, receiver) as unknown
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    })
  const device = fake.device
  const gatt = device.gatt as GattServerLike
  const wrappedDevice: BluetoothDeviceLike = {
    name: device.name,
    gatt: new Proxy(gatt, {
      get(target, key, receiver) {
        if (key === 'connect') return c.kind === 'gatt' ? () => Promise.reject(c.error) : async () => wrapServer(await target.connect())
        if (key === 'getPrimaryService') return wrapServer(target).getPrimaryService
        const value = Reflect.get(target, key, receiver) as unknown
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    }),
    addEventListener: (t, l) => device.addEventListener(t, l),
    removeEventListener: (t, l) => device.removeEventListener(t, l),
  }
  return {
    ...fake.environment,
    bluetooth: {
      getAvailability: () => Promise.resolve(true),
      requestDevice: c.kind === 'pick' ? () => Promise.reject(c.error) : () => Promise.resolve(wrappedDevice),
    },
  }
}

async function runMarklife(c: MlCase): Promise<PrinterResult> {
  const timer = new PacedTimer()
  const env = wrapped(c, timer)
  const adapter = createMarklifeAdapter({ environment: () => env, timer })
  const connected = await adapter.connect('bluetooth')
  if (c.kind !== 'write') return connected
  expect(connected, JSON.stringify(connected)).toEqual({ ok: true })
  const printing = adapter.print(sampleImage(1, 384, 40))
  // 긴 기다림(크레딧·시간 초과)이 있으면 돌린다
  for (let i = 0; i < 50 && timer.pending > 0; i++) await timer.advance(25_000)
  await flush()
  return printing
}

describe('AC-FB1-37 자세히에 원래 예외 글이 없다 — 무작위 예외 1,000개 (B1 600 · Marklife 400)', () => {
  it('B1: 블루투스 연결(첫 확인 다시 잇기 포함)·고르기·USB·클라이언트 만들기·출력·다른 모델 — detail은 정해진 글뿐', async () => {
    await fc.assert(
      fc.asyncProperty(b1CaseArb, async (c) => {
        const { result, thrown } = await runB1(c)
        checkResult(result, thrown, JSON.stringify({ kind: c.kind }))
        if (c.kind === 'model') expect(result).toEqual({ ok: false, error: { code: 'WRONG_MODEL', message: PRINTER_MESSAGES.WRONG_MODEL, detail: `모델: ${c.model}` } })
      }),
      { numRuns: 600, seed: 20261024 },
    )
  })

  it('Marklife: 고르기 창·GATT 연결·알림 켜기·출력 쓰기 실패 — detail은 정해진 글뿐, 연결 중 예외는 CONNECT_FAILED 또는 고르기 코드', async () => {
    await fc.assert(
      fc.asyncProperty(mlCaseArb, async (c) => {
        const result = await runMarklife(c)
        checkResult(result, [c.error], c.kind)
        if (!result.ok && (c.kind === 'gatt' || c.kind === 'notify')) {
          expect(result.error.code, c.kind).toBe('CONNECT_FAILED')
          expect(result.error.message).toBe(CONNECT_FAILED)
        }
      }),
      { numRuns: 400, seed: 20261025 },
    )
  })
})

describe('AC-FB1-35·36 B1 블루투스 연결 실패의 코드와 다시 잇기 (고정 사례)', () => {
  const negotiate = () => new Error('Unable to perform initial negotiate: Error: Timeout waiting response (waited for c2)')
  it('첫 확인 시간 초과 두 번 → CONNECT_FAILED + 한 번 더 해 봄 상세, 시간 초과 뒤 다른 실패(NetworkError)여도 상세에 원문 없음', async () => {
    for (const second of [negotiate(), Object.assign(new Error('GATT Server is disconnected. Cannot perform GATT operations. (Re)connect first with `device.gatt.connect`.'), { name: 'NetworkError' })]) {
      const client = new ScriptedClient([negotiate(), second])
      const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve({ name: 'B1-1' })), createClient: () => client, timer: instant })
      const r = await adapter.connect('bluetooth')
      expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED, action: '다시 연결', detail: RETRIED_TIMEOUT_DETAIL } })
      expect(adapter.state).toBe('DISCONNECTED')
    }
  })

  it('(a) 첫 확인 시간 초과를 다시 잇지 않는 경우(USB, 고르기 창이 기기를 돌려주지 않음) → CONNECT_FAILED + 첫 문장 상세, 연결 시도 한 번', async () => {
    const usb = new ScriptedClient([negotiate(), undefined])
    const viaUsb = await createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve({ name: 'B1-1' }), true), createClient: () => usb, timer: instant }).connect('serial')
    expect(viaUsb).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED, action: '다시 연결', detail: TIMEOUT_DETAIL } })
    expect(usb.connectErrors).toEqual([undefined])
    const noDevice = new ScriptedClient([negotiate(), undefined])
    const r = await createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve(undefined)), createClient: () => noDevice, timer: instant }).connect('bluetooth')
    expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED, action: '다시 연결', detail: TIMEOUT_DETAIL } })
    expect(noDevice.connectErrors).toEqual([undefined])
  })

  it('시간 초과 뒤 두 번째가 고르기 취소 꼴(NotFoundError)이면 그 코드 — 상세 없음 (원문 안 샘)', async () => {
    const client = new ScriptedClient([negotiate(), Object.assign(new Error('User cancelled 010-1234-5678'), { name: 'NotFoundError' })])
    const adapter = createB1Adapter({ environment: () => deviceEnv(() => Promise.resolve({ name: 'B1-1' })), createClient: () => client, timer: instant })
    const r = await adapter.connect('bluetooth')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_SELECTED')
      expect(r.error.detail).toBeUndefined()
    }
  })

  it('가짜 B1 블루투스 기기: 처음 1번만 답하지 않으면 저절로 이어지고, 2번이면 한 번 더 해 봄 상세 — 고르기 창은 한 번', async () => {
    for (const [n, ok] of [
      [1, true],
      [2, false],
    ] as const) {
      const fake = createFakeNiimbotBluetooth({ unansweredNegotiations: n, timer: instant })
      const adapter = createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient, timer: instant })
      const r = await adapter.connect('bluetooth')
      if (ok) expect(r).toEqual({ ok: true })
      else expect(r).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED, action: '다시 연결', detail: RETRIED_TIMEOUT_DETAIL } })
      expect(fake.requests).toBe(1)
      expect(fake.connectAttempts).toBe(2)
    }
  })

  it('describeCause는 어떤 값에도 원래 글을 돌려주지 않는다 (시간 초과면 고정 문장)', () => {
    fc.assert(
      fc.property(thrownArb, (thrown) => {
        const d = describeCause(thrown)
        expect(d === undefined || d === TIMEOUT_DETAIL).toBe(true)
      }),
      { numRuns: 300, seed: 7 },
    )
  })
})
