// 앱의 라벨 대기열 (APP-03·APP-04, LABEL_RULES L-11, 웹 lib/printer-station.ts와 같은 규칙 — 서버 대기열에서 한 장씩 받아 찍고 결과를 알린다).
// - 연결은 판매자가 누른 동작 안에서만(BLE 모듈). 이 기기가 출력 기기이고 대기열이 멈추지 않았고 프린터가 연결돼 있으면 한 번에 한 장씩 받는다(claim).
// - 그림은 서버가 만든다(APP-05) — 받은 그림을 BLE 모듈에 그대로 넘긴다. 결과는 같은 시도 번호로 알린다(네트워크 오류면 다시 보낸다).
// - 프린터 연결이 바뀌면 서버에 알린다(끊김 → 끊김 멈춤, 다시 연결 → 풀림).
// - 앱이 뒤에 있어도 연결은 끊지 않는다. 앞으로 돌아오면(resume) 대기열 요약을 다시 받고 쌓인 라벨을 이어 찍는다.
import type { ClaimedJob, PrintNotice, PrintOverview, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { blankBitmap, fetchJobBitmap } from '../api/labels.ts'
import { get, isApiError, post, withRetry, type ApiError } from '../api/client.ts'
import type { EventSourceLike, SseMessage } from '../api/sse.ts'
import type { ConnectionState, NativeBlePrinter, PrinterError } from '../native/ble.ts'
import { realTimer, type Timer } from './live.ts'

export interface LabelQueueSnapshot {
  readonly queue: QueueSummary | null
  /** 이 기기가 출력 기기인가 */
  readonly mine: boolean
  readonly printer: ConnectionState
  /** 지금 찍는 장 */
  readonly job: ClaimedJob | null
  readonly busy: boolean
  /** 마지막 프린터 오류 (쉬운 문장) */
  readonly printerError: PrinterError | null
  /** 불러오지 못함 */
  readonly loadError: ApiError | null
  /** 이 앱이 켜진 뒤 찍은 장 수 */
  readonly printed: number
  readonly density: number
}

export interface LabelQueueOptions {
  readonly ble: NativeBlePrinter
  readonly deviceId: string
  readonly openStream: () => EventSourceLike
  readonly timer?: Timer
}

const RETRY_MS = 2000
const LABELS_OFF = 'LABELS_OFF'

export class LabelQueue {
  readonly #options: LabelQueueOptions
  readonly #timer: Timer
  readonly #listeners = new Set<() => void>()
  #snapshot: LabelQueueSnapshot
  #stream: EventSourceLike | null = null
  #pumping = false
  #again = false
  #retry: unknown = undefined
  #reported: boolean | null = null
  #stopped = false
  #readyCount = 0
  #unsubState: (() => void) | null = null

  constructor(options: LabelQueueOptions) {
    this.#options = options
    this.#timer = options.timer ?? realTimer
    this.#snapshot = { queue: null, mine: false, printer: options.ble.state, job: null, busy: false, printerError: null, loadError: null, printed: 0, density: options.ble.profile.density?.default ?? 3 }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): LabelQueueSnapshot => this.#snapshot

  #set(patch: Partial<LabelQueueSnapshot>): void {
    if (this.#stopped) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) listener()
  }

  start(): void {
    this.#unsubState = this.#options.ble.onStateChange((state) => {
      this.#set({ printer: state })
      if (state === 'CONNECTED') {
        void this.#report(true)
        void this.pump()
      } else if (state === 'DISCONNECTED') void this.#report(false)
    })
    this.#connect()
    void this.reload()
  }

  stop(): void {
    this.#stopped = true
    this.#stream?.close()
    this.#stream = null
    this.#unsubState?.()
    if (this.#retry !== undefined) this.#timer.clear(this.#retry)
  }

  #connect(): void {
    const stream = this.#options.openStream()
    this.#stream = stream
    stream.addEventListener('ready', () => {
      this.#readyCount++
      // 다시 붙었다: 놓친 알림이 있을 수 있다 — 요약을 다시 받고 쌓인 라벨을 이어 찍는다 (APP-04)
      if (this.#readyCount > 1) void this.reload()
    })
    stream.addEventListener('print', (event: SseMessage) => {
      let data: PrintNotice | null
      try {
        data = JSON.parse(event.data) as PrintNotice
      } catch {
        data = null
      }
      if (data === null || !('queue' in data)) return
      const current = this.#snapshot.queue
      if (current !== null && data.rev < current.rev) return
      this.#applyQueue(data.queue)
    })
    stream.addEventListener('labels', () => void this.reload())
  }

  #applyQueue(queue: QueueSummary): void {
    this.#set({ queue, mine: queue.device?.id === this.#options.deviceId })
    void this.pump()
  }

  /** 대기열 요약 다시 받기 (GET /api/print) */
  async reload(): Promise<void> {
    if (this.#stopped) return
    try {
      const overview = await get<PrintOverview>('/api/print')
      this.#set({ loadError: null })
      this.#applyQueue(overview.queue)
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#set({ loadError: error })
    }
  }

  /** 앱이 앞으로 돌아왔다 (APP-04): 요약을 다시 받고 이어 찍는다 */
  resume(): void {
    void this.reload()
  }

  /** 지금 서버에 남은 장 수 (대기 + 출력 중) — "자리를 비운 동안 라벨 n장" */
  get backlog(): number {
    const queue = this.#snapshot.queue
    return queue === null ? 0 : queue.waiting + queue.printing
  }

  setDensity(density: number): void {
    const range = this.#options.ble.profile.density
    if (range === null || !Number.isInteger(density) || density < range.min || density > range.max) return
    this.#set({ density })
  }

  // ── 프린터 연결 (판매자 동작 안에서만) ──

  async connect(): Promise<void> {
    this.#set({ printerError: null })
    const result = this.#options.ble.hasRemembered ? await this.#options.ble.reconnect('bluetooth') : await this.#options.ble.connect('bluetooth')
    if (!result.ok) this.#set({ printerError: result.error })
  }

  async disconnect(): Promise<void> {
    await this.#options.ble.disconnect()
  }

  /** 테스트 인쇄 — 서버를 거치지 않는다. TODO(APP2 server): 테스트 라벨 그림도 서버가 준다(`GET /api/print/test-bitmap`); 지금은 빈 그림 */
  async printTest(): Promise<boolean> {
    if (this.#snapshot.job !== null) return false
    const result = await this.#options.ble.print(blankBitmap(), { density: this.#snapshot.density })
    if (!result.ok) this.#set({ printerError: result.error })
    return result.ok
  }

  async #report(connected: boolean): Promise<void> {
    if (!this.#snapshot.mine || this.#reported === connected) return
    this.#reported = connected
    try {
      await post('/api/print/device/state', { deviceId: this.#options.deviceId, connected })
    } catch (error) {
      if (!isApiError(error)) throw error
      this.#reported = null
      if (error.code === 'PRINT_NOT_DEVICE') void this.reload()
    }
  }

  // ── 출력 기기 (L-11 10) ──

  async become(name: string, replace = false): Promise<{ kind: 'ok' } | { kind: 'taken'; name: string } | { kind: 'error'; error: ApiError }> {
    try {
      await post('/api/print/device', { deviceId: this.#options.deviceId, name, ...(replace ? { replace: true } : {}) })
      this.#reported = true
      this.#set({ mine: true })
      if (this.#options.ble.state !== 'CONNECTED') {
        this.#reported = null
        await this.#report(false)
      }
      await this.reload()
      return { kind: 'ok' }
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.code === 'PRINT_DEVICE_TAKEN') {
        const device = error.details['device'] as { name?: unknown } | undefined
        return { kind: 'taken', name: typeof device?.name === 'string' ? device.name : '' }
      }
      return { kind: 'error', error }
    }
  }

  async release(): Promise<void> {
    await post('/api/print/device/release', {})
    this.#set({ mine: false })
    await this.reload()
  }

  async pause(): Promise<void> {
    await post('/api/print/pause', {})
    await this.reload()
  }

  async restart(): Promise<void> {
    await post('/api/print/restart', {})
    await this.reload()
  }

  // ── 받기·찍기·결과 (L-11 4·6) ──

  #canClaim(): boolean {
    const queue = this.#snapshot.queue
    return !this.#stopped && queue !== null && queue.labelsEnabled && this.#snapshot.mine && queue.pause === null && queue.device?.releasing !== true && this.#options.ble.state === 'CONNECTED' && this.#snapshot.job === null
  }

  #retryLater(): void {
    if (this.#retry !== undefined) return
    this.#retry = this.#timer.set(() => {
      this.#retry = undefined
      void this.pump()
    }, RETRY_MS)
  }

  async pump(): Promise<void> {
    if (this.#pumping) {
      this.#again = true
      return
    }
    this.#pumping = true
    try {
      do {
        this.#again = false
        if (!this.#canClaim()) continue
        let claimed: { job: ClaimedJob | null; reason?: string }
        this.#set({ busy: true })
        try {
          claimed = await post<{ job: ClaimedJob | null; reason?: string }>('/api/print/claim', { deviceId: this.#options.deviceId })
        } catch (error) {
          this.#set({ busy: false })
          if (!isApiError(error)) throw error
          if (error.code === 'PRINT_NOT_DEVICE' || error.code === LABELS_OFF) void this.reload()
          else if (error.transient) this.#retryLater()
          break
        }
        if (claimed.job === null) {
          this.#set({ busy: false })
          continue
        }
        await this.#printJob(claimed.job)
      } while (this.#again && !this.#stopped)
    } finally {
      this.#pumping = false
    }
  }

  async #printJob(job: ClaimedJob): Promise<void> {
    this.#set({ job, busy: true })
    let ok = false
    let error: { code: string } | null = null
    try {
      const bitmap = await fetchJobBitmap(job, this.#options.deviceId)
      const result = await this.#options.ble.print(bitmap, { density: this.#snapshot.density })
      ok = result.ok
      if (!result.ok) {
        error = { code: result.error.code }
        this.#set({ printerError: result.error })
      }
    } catch (caught) {
      error = { code: isApiError(caught) ? caught.code : 'LABEL_ERROR' }
    }
    const body = { deviceId: this.#options.deviceId, attempt: job.attempt, ok, ...(error === null ? {} : { error }) }
    try {
      await withRetry(() => post<{ recorded: boolean }>('/api/print/result', body))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 결과를 알리지 못했다: 서버는 시도 시간이 지나면 끊김으로 본다 — 요약을 다시 받는다
    }
    this.#set({ job: null, busy: false, ...(ok ? { printed: this.#snapshot.printed + 1, printerError: null } : {}) })
    if (!ok) this.#retryLater()
    else this.#again = true
  }
}
