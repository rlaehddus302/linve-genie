// 이 기기의 프린터와 출력 기기 역할 (I1, LABEL_RULES L-7·L-8·L-11 4·6·8·10, D-I1-01·03·06, AC-I1-21~23·70).
// - 연결은 판매자가 누른 동작 안에서만 한다(블루투스·USB 선 — 이 브라우저에 있는 것만, 시험 모드면 시험용 프린터). 페이지를 열 때 스스로 잇지 않는다.
// - 이 기기가 출력 기기이고 대기열이 멈추지 않았고 프린터가 연결돼 있으면 서버 대기열에서 한 번에 한 장씩 받아(claim) 그리고 찍고 결과를 알린다.
//   받은 작업이 없으면(멈춤·대기 없음) 다음 print 알림을 기다린다. 앱 안에서 화면을 옮겨도 이어진다(앱 전체에 하나).
// - 프린터 연결이 바뀌면 서버에 알린다(끊김 → 끊김 멈춤, 다시 연결 → 끊김 멈춤 풀림, L-8 3).
// - 출력 중에 앱이 닫히면 그 시도는 다음에 열 때 끊김으로 알린다(찍혔는지 모른다 — 한 장 더 나오는 편이 빠지는 것보다 낫다, D-P1-09).
// - 테스트 인쇄는 서버를 거치지 않는다(기록 없음). 그 기기가 대기열 작업을 출력하는 중이면 할 수 없다.
// - 출력 기기는 화면 꺼짐 막기를 요청한다(지원할 때). 안 되면 화면이 안내한다.
import type { LabelBitmap } from '@livejjim/label'
import {
  PRINTER_MESSAGES,
  browserEnvironment,
  createB1Adapter,
  createFakePrinter,
  detectMethods,
  type ConnectionMethod,
  type ConnectionState,
  type FakePrintBehavior,
  type FakePrinter,
  type PrinterAdapter,
  type PrinterError,
  type PrinterErrorCode,
} from '@livejjim/printer'
import { isApiError, post, withRetry, type ApiError } from '../api/client.ts'
import type { ClaimedJob, QueueSummary } from '../api/print-types.ts'
import { DENSITY_MAX, DENSITY_MIN, saveAttempt, saveDensity, saveDeviceName, savedAttempt, savedDensity } from './device.ts'
import type { RenderOutcome } from './label-render.ts'
import type { PrintStore } from './print-store.ts'

/** 연결 방법: 브라우저(블루투스·USB 선) 또는 시험용 프린터 */
export type PrinterMethod = ConnectionMethod | 'test'

const METHOD_KEY = 'livejjim.printMethod'

export interface StationSnapshot {
  /** 이 브라우저에 있는 연결 방법 (블루투스가 앞) */
  readonly methods: readonly ConnectionMethod[]
  /** 마지막으로 고른 연결 방법 */
  readonly method: PrinterMethod | null
  readonly connection: ConnectionState
  readonly connecting: boolean
  readonly connectError: PrinterError | null
  readonly density: number
  /** 이 기기가 지금 찍고 있는 대기열 작업 */
  readonly job: { readonly id: string; readonly date: string } | null
  readonly testing: boolean
  /** 테스트 인쇄가 나왔다 ("또렷하게 보이나요?"를 묻는다) */
  readonly testPrinted: boolean
  readonly testError: string | null
  /** 이 기기에서 마지막으로 실패한 출력의 문장 */
  readonly lastError: string | null
  /** 화면 꺼짐 막기: 켬 · 지원 안 함/실패 · 쓰지 않음(출력 기기가 아님) */
  readonly wake: 'on' | 'unsupported' | 'off'
  /** 라벨 글꼴을 불러오지 못했다 (출력하지 않고 기다린다) */
  readonly fontError: boolean
}

export type BecomeOutcome =
  | { readonly kind: 'ok'; readonly backlog: boolean; readonly waiting: number }
  | { readonly kind: 'taken'; readonly name: string }
  | { readonly kind: 'error'; readonly error: ApiError }

interface WakeSentinel {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

export interface StationOptions {
  readonly store: PrintStore
  readonly deviceId: string
  /** 실제 프린터 어댑터 (기본: B1) */
  readonly createAdapter?: () => PrinterAdapter
  /** 시험용 프린터 (기본: 가짜 프린터) */
  readonly createTestPrinter?: () => FakePrinter
  /** 이 브라우저의 연결 방법 (기본: navigator.bluetooth·serial 감지) */
  readonly detect?: () => ConnectionMethod[]
  /** 작업 그리기 (기본: 내장 글꼴 렌더러) */
  readonly render: (job: ClaimedJob) => Promise<RenderOutcome>
  /** 테스트 라벨 그리기 */
  readonly renderTest: (input: { shopName: string; date: string; size: ClaimedJob['template']['size'] }) => Promise<RenderOutcome>
  /** 그리기 준비 (내장 글꼴 불러오기) — 실패하면 받지 않고 기다린다 */
  readonly prepare?: () => Promise<void>
  /** 화면 꺼짐 막기 (없으면 지원 안 함) */
  readonly requestWakeLock?: (() => Promise<WakeSentinel>) | null
  readonly today: () => string
  /** 시험용 프린터 손잡이를 놓을 곳 (시험 모드에서만) */
  readonly exposeTestHandle?: (handle: TestPrinterHandle | null) => void
}

/** E2E가 쓰는 시험용 프린터 손잡이 (서버가 시험 모드일 때만 생긴다, AC-I1-50) */
export interface TestPrinterHandle {
  /** 끝까지 출력한 그림 (받은 순서) */
  printed(): { width: number; height: number; data: number[] }[]
  printedCount(): number
  printCalls(): number
  /** n번째 출력(1부터)에서 낼 일: 'disconnect' · 'fail' · { delayMs } · null(지우기) */
  setBehavior(n: number, behavior: FakePrintBehavior | null): void
  simulateDisconnect(): void
  /** 다음 연결 시도에서 낼 오류 (null이면 성공) */
  setConnectError(code: PrinterErrorCode | null): void
}

function readMethod(): PrinterMethod | null {
  try {
    const value = window.localStorage.getItem(METHOD_KEY)
    return value === 'bluetooth' || value === 'serial' || value === 'test' ? value : null
  } catch {
    return null
  }
}

function writeMethod(method: PrinterMethod): void {
  try {
    window.localStorage.setItem(METHOD_KEY, method)
  } catch {
    // 이 페이지 동안만
  }
}

const bitmapOut = (image: LabelBitmap) => ({ width: image.width, height: image.height, data: [...image.data] })

export class PrinterStation {
  readonly #options: StationOptions
  readonly #listeners = new Set<() => void>()
  #snapshot: StationSnapshot
  #adapter: PrinterAdapter | null = null
  #adapterMethod: PrinterMethod | null = null
  #unlistenAdapter: (() => void) | null = null
  #real: PrinterAdapter | null = null
  #test: FakePrinter | null = null
  #unsubscribeStore: (() => void) | null = null
  #stopped = false
  #pumping = false
  #again = false
  /** 마지막으로 서버에 알린 프린터 연결 (같은 값은 다시 알리지 않는다) */
  #reported: boolean | null = null
  /** 보내지 못한 결과 (같은 시도 표로 다시 보낸다 — 서버는 한 번만 기록) */
  #pendingResult: { readonly attempt: string; readonly body: Record<string, unknown> } | null = null
  #recovered = false
  #wake: WakeSentinel | null = null
  #wakeAsking = false
  #retryTimer: ReturnType<typeof setTimeout> | undefined = undefined
  #mine = false

  constructor(options: StationOptions) {
    this.#options = options
    this.#snapshot = {
      methods: (options.detect ?? (() => detectMethods(browserEnvironment())))(),
      method: readMethod(),
      connection: 'DISCONNECTED',
      connecting: false,
      connectError: null,
      density: savedDensity(),
      job: null,
      testing: false,
      testPrinted: false,
      testError: null,
      lastError: null,
      wake: 'off',
      fontError: false,
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): StationSnapshot => this.#snapshot

  #set(patch: Partial<StationSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  get deviceId(): string {
    return this.#options.deviceId
  }

  /** 이 기기가 지금 출력 기기인지 */
  isMine(queue: QueueSummary | null = this.#options.store.queue): boolean {
    return queue?.device?.id === this.#options.deviceId
  }

  start(): void {
    this.#unsubscribeStore = this.#options.store.subscribe(() => this.#onStore())
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.#onVisible)
    this.#onStore()
  }

  stop(): void {
    this.#stopped = true
    this.#unsubscribeStore?.()
    this.#unlistenAdapter?.()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.#onVisible)
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer)
    void this.#releaseWake()
    void this.#adapter?.disconnect()
    this.#options.exposeTestHandle?.(null)
    this.#listeners.clear()
  }

  #onVisible = (): void => {
    if (document.visibilityState === 'visible') this.#syncWake()
  }

  #onStore(): void {
    const snapshot = this.#options.store.getSnapshot()
    if (snapshot.config?.testPrinter === true && this.#test === null) this.#ensureTestPrinter()
    const queue = snapshot.overview?.queue ?? null
    if (queue === null) return
    const mine = this.isMine(queue)
    if (mine !== this.#mine) {
      this.#mine = mine
      if (!mine) this.#reported = null
    }
    if (!this.#recovered) {
      this.#recovered = true
      void this.#recover(queue)
    }
    this.#syncWake()
    void this.pump()
  }

  /** 처음: 앱이 출력 중에 닫혔던 시도를 끊김으로 알리고, 이 기기가 출력 기기인데 프린터가 이어져 있지 않으면 알린다 */
  async #recover(queue: QueueSummary): Promise<void> {
    const saved = savedAttempt()
    if (saved !== null && saved.deviceId === this.#options.deviceId) {
      try {
        await post('/api/print/result', { deviceId: saved.deviceId, attempt: saved.attempt, ok: false, error: { code: 'DISCONNECTED' } })
        saveAttempt(null)
      } catch (error) {
        if (isApiError(error) && (error.status === 404 || error.status === 400 || error.status === 409)) saveAttempt(null)
      }
    } else if (saved !== null) saveAttempt(null)
    if (this.isMine(queue) && queue.device?.printerConnected === true && this.#adapter?.state !== 'CONNECTED') await this.#report(false, true)
  }

  // ── 연결 (판매자가 누른 동작 안에서만, L-7) ─────────────────────────────

  #ensureTestPrinter(): FakePrinter {
    if (this.#test === null) {
      this.#test = this.#options.createTestPrinter?.() ?? createFakePrinter({ methods: ['bluetooth'] })
      const test = this.#test
      this.#options.exposeTestHandle?.({
        printed: () => test.printed.map((record) => bitmapOut(record.image)),
        printedCount: () => test.printed.length,
        printCalls: () => test.printCalls,
        setBehavior: (n, behavior) => test.setBehavior(n, behavior ?? undefined),
        simulateDisconnect: () => test.simulateDisconnect(),
        setConnectError: (code) => test.setConnectError(code ?? undefined),
      })
    }
    return this.#test
  }

  #adapterFor(method: PrinterMethod): PrinterAdapter {
    if (method === 'test') return this.#ensureTestPrinter()
    this.#real ??= this.#options.createAdapter?.() ?? createB1Adapter()
    return this.#real
  }

  /** 연결 (판매자가 누른 동작 안에서 부른다). 다른 방법으로 이어져 있었으면 먼저 끊는다 */
  async connect(method: PrinterMethod): Promise<boolean> {
    if (this.#snapshot.connecting) return false
    const adapter = this.#adapterFor(method)
    if (this.#adapter !== null && this.#adapter !== adapter) {
      const previous = this.#adapter
      this.#unlistenAdapter?.()
      this.#unlistenAdapter = null
      await previous.disconnect()
    }
    if (this.#adapter !== adapter) {
      this.#adapter = adapter
      this.#unlistenAdapter = adapter.onStateChange((state) => this.#onAdapterState(state))
    }
    this.#adapterMethod = method
    writeMethod(method)
    this.#set({ method, connecting: true, connectError: null, connection: adapter.state })
    const result = await adapter.connect(method === 'test' ? (adapter.availableMethods()[0] ?? 'bluetooth') : method)
    this.#set({ connecting: false, connection: adapter.state, connectError: result.ok ? null : result.error, ...(result.ok ? { lastError: null } : {}) })
    if (result.ok) {
      if (this.isMine()) await this.#report(true)
      void this.pump()
    }
    return result.ok
  }

  /** "다시 연결": 마지막으로 쓴 방법으로 */
  async reconnect(): Promise<boolean> {
    const method = this.#adapterMethod ?? this.#snapshot.method
    if (method === null) return false
    if (method === 'test' && this.#options.store.getSnapshot().config?.testPrinter !== true) return false
    if (method !== 'test' && !this.#snapshot.methods.includes(method)) return false
    return this.connect(method)
  }

  /** 다시 연결할 수 있는 방법이 있는지 */
  get canReconnect(): boolean {
    const method = this.#adapterMethod ?? this.#snapshot.method
    if (method === null) return false
    if (method === 'test') return this.#options.store.getSnapshot().config?.testPrinter === true
    return this.#snapshot.methods.includes(method)
  }

  async disconnect(): Promise<void> {
    await this.#adapter?.disconnect()
  }

  #onAdapterState(state: ConnectionState): void {
    this.#set({ connection: state })
    if (!this.isMine()) return
    if (state === 'DISCONNECTED') void this.#report(false)
    else if (state === 'CONNECTED') {
      void this.#report(true)
      void this.pump()
    }
  }

  /** 서버에 프린터 연결 상태를 알린다 (같은 값이면 다시 알리지 않는다) */
  async #report(connected: boolean, force = false): Promise<void> {
    if (!force && this.#reported === connected) return
    this.#reported = connected
    try {
      await this.#options.store.act('/api/print/device/state', { deviceId: this.#options.deviceId, connected })
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#reported = null
      if (error.code === 'PRINT_NOT_DEVICE') void this.#options.store.reload()
    }
  }

  setDensity(density: number): void {
    if (!Number.isInteger(density) || density < DENSITY_MIN || density > DENSITY_MAX) return
    saveDensity(density)
    this.#set({ density })
  }

  // ── 출력 기기 (L-11 10) ─────────────────────────────────────────────────

  /** "이 기기에서 출력" (다른 기기가 출력 기기면 replace 없이는 taken) */
  async become(name: string, replace: boolean): Promise<BecomeOutcome> {
    try {
      const result = await this.#options.store.act<{ queue: QueueSummary; waiting: number; backlog: boolean }>('/api/print/device', {
        deviceId: this.#options.deviceId,
        name,
        ...(replace ? { replace: true } : {}),
      })
      saveDeviceName(name)
      this.#mine = true
      this.#reported = true
      // 프린터가 그사이 끊겼으면 바로 알린다 (출력 기기가 되는 기기는 연결된 것으로 서버가 본다)
      if (this.#adapter?.state !== 'CONNECTED') await this.#report(false, true)
      void this.#options.store.reload()
      void this.pump()
      return { kind: 'ok', backlog: result.backlog, waiting: result.waiting }
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.code === 'PRINT_DEVICE_TAKEN') {
        const device = error.details['device'] as { name?: unknown } | undefined
        return { kind: 'taken', name: typeof device?.name === 'string' ? device.name : '' }
      }
      return { kind: 'error', error }
    }
  }

  // ── 받기·찍기·결과 (L-11 4·6) ───────────────────────────────────────────

  #canClaim(): boolean {
    const queue = this.#options.store.queue
    return (
      !this.#stopped &&
      queue !== null &&
      this.isMine(queue) &&
      queue.pause === null &&
      queue.device?.releasing !== true &&
      this.#adapter !== null &&
      this.#adapter.state === 'CONNECTED' &&
      !this.#snapshot.testing
    )
  }

  /** 받을 수 있으면 한 장씩 받아 찍는다. 이미 도는 중이면 끝난 뒤 한 번 더 본다 */
  async pump(): Promise<void> {
    if (this.#pumping) {
      this.#again = true
      return
    }
    this.#pumping = true
    try {
      do {
        this.#again = false
        if (this.#pendingResult !== null && !(await this.#flushResult())) break
        if (!this.#canClaim()) continue
        try {
          await this.#options.prepare?.()
          if (this.#snapshot.fontError) this.#set({ fontError: false })
        } catch {
          this.#set({ fontError: true })
          this.#retryLater()
          break
        }
        if (!this.#canClaim()) continue
        let claimed: { job: ClaimedJob | null }
        try {
          claimed = await post<{ job: ClaimedJob | null }>('/api/print/claim', { deviceId: this.#options.deviceId })
        } catch (error) {
          if (!isApiError(error)) throw error
          if (error.code === 'PRINT_NOT_DEVICE') void this.#options.store.reload()
          else if (error.transient) this.#retryLater()
          break
        }
        if (claimed.job === null) continue
        await this.#printJob(claimed.job)
        // 한 장 끝: 다음 장을 본다
        this.#again = true
      } while (this.#again && !this.#stopped)
    } finally {
      this.#pumping = false
    }
  }

  #retryLater(): void {
    if (this.#retryTimer !== undefined || this.#stopped) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      void this.pump()
    }, 3000)
  }

  async #printJob(job: ClaimedJob): Promise<void> {
    saveAttempt({ deviceId: this.#options.deviceId, attempt: job.attempt })
    this.#set({ job: { id: job.id, date: job.date } })
    let body: Record<string, unknown>
    try {
      const rendered = await this.#options.render(job)
      if (!rendered.ok) {
        body = { ok: false, error: { code: rendered.error.code, ...(rendered.error.item === undefined ? {} : { item: rendered.error.item }) } }
        this.#set({ lastError: rendered.error.message })
      } else {
        const adapter = this.#adapter
        const result = adapter === null ? { ok: false as const, error: { code: 'NOT_CONNECTED' as const, message: PRINTER_MESSAGES.NOT_CONNECTED } } : await adapter.print(rendered.image, { density: this.#snapshot.density })
        if (result.ok) {
          body = { ok: true }
          this.#set({ lastError: null })
        } else {
          body = { ok: false, error: { code: result.error.code } }
          this.#set({ lastError: result.error.message })
        }
      }
    } catch {
      // 그리기·출력 중 예상하지 못한 실패: 찍혔는지 모른다 — 끊김으로 알린다(그 장은 대기 맨 앞)
      body = { ok: false, error: { code: 'DISCONNECTED' } }
    }
    this.#pendingResult = { attempt: job.attempt, body: { deviceId: this.#options.deviceId, attempt: job.attempt, ...body } }
    await this.#flushResult()
    this.#set({ job: null })
  }

  /** 보내지 못한 결과 보내기. 보냈거나 버려도 되면 true */
  async #flushResult(): Promise<boolean> {
    const pending = this.#pendingResult
    if (pending === null) return true
    try {
      await withRetry(() => post<{ recorded: boolean }>('/api/print/result', pending.body))
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.transient) {
        this.#retryLater()
        return false
      }
      // 모르는 시도(404) 등: 서버가 받지 않는다 — 버린다
    }
    if (this.#pendingResult === pending) this.#pendingResult = null
    if (savedAttempt()?.attempt === pending.attempt) saveAttempt(null)
    return true
  }

  // ── 테스트 인쇄 (서버 기록 없음, L-7 테스트 라벨) ───────────────────────

  /** 테스트 인쇄. 그 기기가 대기열 작업을 찍는 중이면 하지 않는다 */
  async testPrint(input: { shopName: string; size: ClaimedJob['template']['size'] }): Promise<void> {
    const adapter = this.#adapter
    if (adapter === null || adapter.state !== 'CONNECTED' || this.#snapshot.job !== null || this.#snapshot.testing) return
    this.#set({ testing: true, testPrinted: false, testError: null })
    try {
      const rendered = await this.#options.renderTest({ shopName: input.shopName, date: this.#options.today(), size: input.size })
      if (!rendered.ok) {
        this.#set({ testError: rendered.error.message })
        return
      }
      const result = await adapter.print(rendered.image, { density: this.#snapshot.density })
      this.#set(result.ok ? { testPrinted: true } : { testError: result.error.message })
    } catch {
      this.#set({ testError: PRINTER_MESSAGES.PRINT_FAILED })
    } finally {
      this.#set({ testing: false })
      void this.pump()
    }
  }

  dismissTest(): void {
    this.#set({ testPrinted: false, testError: null })
  }

  // ── 화면 꺼짐 막기 (D-I1-03) ───────────────────────────────────────────

  #syncWake(): void {
    if (this.#mine) {
      if (this.#wake !== null || this.#wakeAsking) return
      const request = this.#options.requestWakeLock
      if (request === undefined || request === null) {
        if (this.#snapshot.wake !== 'unsupported') this.#set({ wake: 'unsupported' })
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      this.#wakeAsking = true
      request().then(
        (sentinel) => {
          this.#wakeAsking = false
          if (!this.#mine || this.#stopped) {
            void sentinel.release()
            return
          }
          this.#wake = sentinel
          this.#set({ wake: 'on' })
          sentinel.addEventListener('release', () => {
            if (this.#wake === sentinel) this.#wake = null
            if (this.#mine) this.#set({ wake: 'unsupported' })
          })
        },
        () => {
          this.#wakeAsking = false
          this.#set({ wake: 'unsupported' })
        },
      )
    } else {
      void this.#releaseWake()
      if (this.#snapshot.wake !== 'off') this.#set({ wake: 'off' })
    }
  }

  async #releaseWake(): Promise<void> {
    const sentinel = this.#wake
    this.#wake = null
    try {
      await sentinel?.release()
    } catch {
      // 이미 풀렸다
    }
  }
}

/** 브라우저의 화면 꺼짐 막기 (없으면 null) */
export function browserWakeLock(): (() => Promise<WakeSentinel>) | null {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }
  if (nav.wakeLock === undefined || typeof nav.wakeLock.request !== 'function') return null
  const lock = nav.wakeLock
  return () => lock.request('screen')
}
