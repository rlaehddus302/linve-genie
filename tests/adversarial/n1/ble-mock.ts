// N1 적대 테스트 도우미: 손으로 조종하는 Web Bluetooth 기기와 손으로 돌리는 타이머.
// 제품의 가짜 기기(createFakeBluetooth)를 쓰지 않는다 — 알림 시각·쓰기 결과·끊김을 시험이 한 걸음씩 정한다.
import { GATT_BUNDLES, type BluetoothDeviceLike, type BluetoothEnvironment, type BluetoothRequestOptions, type GattCharacteristicLike, type GattServerLike, type PrinterTimer } from '@livejjim/printer'

type CharacteristicValueEvent = { readonly target?: unknown }

export class StepTimer implements PrinterTimer {
  now = 0
  private id = 1
  private tasks: { id: number; at: number; fn: () => void; mock: boolean }[] = []
  /** 어댑터가 동시에 걸어 둔 타이머 수의 최댓값 (관찰용) */
  maxPending = 0
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.id++
    this.tasks.push({ id, at: this.now + Math.max(0, ms), fn, mock: false })
    this.maxPending = Math.max(this.maxPending, this.pending)
    return id
  }
  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle || t.mock)
  }
  /** 가짜 기기 쪽 일정(쓰기 끝·알림) — 어댑터의 타이머가 아니므로 pending에 세지 않는다 */
  schedule(fn: () => void, ms: number): number {
    const id = this.id++
    this.tasks.push({ id, at: this.now + Math.max(0, ms), fn, mock: true })
    return id
  }
  cancelScheduled(id: number): void {
    this.tasks = this.tasks.filter((t) => t.id !== id || !t.mock)
  }
  /** 어댑터가 걸어 둔 타이머 수 */
  get pending(): number {
    return this.tasks.filter((t) => !t.mock).length
  }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms
    for (;;) {
      await flush()
      let due: { id: number; at: number; fn: () => void; mock: boolean } | undefined
      for (const t of this.tasks) if (t.at <= target && (!due || t.at < due.at || (t.at === due.at && t.id < due.id))) due = t
      if (!due) break
      const picked = due
      this.tasks = this.tasks.filter((t) => t !== picked)
      this.now = picked.at
      picked.fn()
    }
    this.now = target
    await flush()
  }
}

export async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

export interface Write {
  /** 쓰기를 부른 시각 */
  readonly at: number
  readonly bytes: Uint8Array
  /** 쓰기가 끝난(약속이 풀린) 시각 — 아직이거나 거절됐으면 undefined */
  endAt: number | undefined
  /** 끊겨 거절됐다 */
  rejected: boolean
}

/** 쓰기 하나가 끝나는 때: undefined·0 = 바로 · n = n ms 뒤 · 'stall' = 끝나지 않음(release로 푼다, 끊기면 거절) */
export type WriteLatency = number | 'stall' | undefined

type Listener = (event: CharacteristicValueEvent) => void

class Char implements GattCharacteristicLike {
  value: DataView | null = null
  readonly properties = { write: true, writeWithoutResponse: true, notify: true }
  private readonly listeners = new Set<Listener>()
  notifying = false
  readonly uuid: string
  private readonly owner: ManualBle
  constructor(uuid: string, owner: ManualBle) {
    this.uuid = uuid
    this.owner = owner
  }
  writeValueWithoutResponse(value: Uint8Array): Promise<void> {
    return this.owner.onWrite(this, value)
  }
  startNotifications(): Promise<unknown> {
    if (!this.owner.connected) return Promise.reject(Object.assign(new Error('끊김'), { name: 'NetworkError' }))
    this.notifying = true
    this.owner.onStartNotifications(this)
    return Promise.resolve(this)
  }
  addEventListener(_t: 'characteristicvaluechanged', l: Listener): void {
    this.listeners.add(l)
  }
  removeEventListener(_t: 'characteristicvaluechanged', l: Listener): void {
    this.listeners.delete(l)
  }
  emit(bytes: readonly number[]): void {
    if (!this.owner.connected || !this.notifying) return
    this.value = new DataView(new Uint8Array(bytes).buffer)
    for (const l of [...this.listeners]) l({ target: this })
  }
}

export interface ManualBleOptions {
  readonly name: string
  readonly bundle?: 'A' | 'C'
  /** 흐름 제어 알림을 켜는 순간 보낼 바이트들 */
  readonly onFlowStart?: readonly (readonly number[])[]
  readonly timer: StepTimer
  readonly userAgent?: string
  /** n번째(0부터) 쓰기가 끝나는 때 (기본: 바로) */
  readonly writeLatency?: (index: number, write: Write) => WriteLatency
  /** 쓰기가 끝난 직후(약속을 푼 같은 순간) — 크레딧 보충·끝 알림 일정에 쓴다 */
  readonly onWriteEnd?: (index: number, write: Write) => void
}

/** 시험이 알림·끊김을 직접 보내는 기기. 쓰기는 기본으로 바로 성공한다(기록만 한다) — writeLatency로 늦추거나 멈출 수 있다 */
export class ManualBle {
  connected = false
  readonly writes: Write[] = []
  readonly requests: BluetoothRequestOptions[] = []
  private readonly deviceListeners = new Set<() => void>()
  readonly write: Char
  readonly notify: Char
  readonly flow: Char | undefined
  readonly environment: BluetoothEnvironment
  readonly device: BluetoothDeviceLike
  private readonly service: string

  private readonly options: ManualBleOptions
  constructor(options: ManualBleOptions) {
    this.options = options
    const spec = GATT_BUNDLES[options.bundle ?? 'A']
    this.service = spec.service
    this.write = new Char(spec.write, this)
    this.notify = new Char(spec.notify, this)
    this.flow = spec.flow === null ? undefined : new Char(spec.flow, this)
    const chars = new Map<string, Char>([[spec.write, this.write], [spec.notify, this.notify], ...(this.flow ? [[spec.flow as string, this.flow] as [string, Char]] : [])])
    const service = { getCharacteristic: (u: string) => (chars.has(u) ? Promise.resolve(chars.get(u) as Char) : Promise.reject(Object.assign(new Error('없음'), { name: 'NotFoundError' }))) }
    const isConnected = (): boolean => this.connected
    const server: GattServerLike = {
      get connected() {
        return isConnected()
      },
      connect: () => {
        this.connected = true
        return Promise.resolve(server)
      },
      disconnect: () => this.drop(),
      getPrimaryService: (u: string) => (u === this.service && this.connected ? Promise.resolve(service) : Promise.reject(Object.assign(new Error('없음'), { name: 'NotFoundError' }))),
    }
    this.device = {
      name: options.name,
      gatt: server,
      addEventListener: (_t, l) => this.deviceListeners.add(l),
      removeEventListener: (_t, l) => this.deviceListeners.delete(l),
    }
    this.environment = {
      bluetooth: {
        requestDevice: (req) => {
          this.requests.push(req)
          return Promise.resolve(this.device)
        },
        getAvailability: () => Promise.resolve(true),
      },
      userAgent: options.userAgent ?? 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
    }
  }

  /** 끝나지 않은 쓰기 (끊기면 거절한다 — 진짜 Web Bluetooth처럼) */
  private readonly inflight = new Map<Write, { resolve: () => void; reject: (e: Error) => void; task: number | undefined }>()

  onWrite(_c: Char, value: Uint8Array): Promise<void> {
    if (!this.connected) return Promise.reject(Object.assign(new Error('끊김'), { name: 'NetworkError' }))
    const timer = this.options.timer
    const write: Write = { at: timer.now, bytes: value.slice(), endAt: undefined, rejected: false }
    const index = this.writes.length
    this.writes.push(write)
    const latency = this.options.writeLatency?.(index, write)
    if (latency === undefined || latency === 0) {
      write.endAt = timer.now
      this.options.onWriteEnd?.(index, write)
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, task: undefined as number | undefined }
      this.inflight.set(write, entry)
      const end = (): void => {
        if (!this.inflight.delete(write)) return
        write.endAt = timer.now
        resolve()
        this.options.onWriteEnd?.(index, write)
      }
      entry.resolve = end
      if (latency !== 'stall') entry.task = timer.schedule(end, latency)
    })
  }

  /** 끝나지 않은(멈춘) 쓰기를 지금 끝낸다 */
  release(): void {
    for (const [, entry] of [...this.inflight]) {
      if (entry.task !== undefined) this.options.timer.cancelScheduled(entry.task)
      entry.resolve()
    }
  }

  /** 아직 끝나지 않은 쓰기 수 */
  get inflightCount(): number {
    return this.inflight.size
  }

  onStartNotifications(c: Char): void {
    if (c === this.flow) for (const b of this.options.onFlowStart ?? []) c.emit(b)
  }

  drop(): void {
    if (!this.connected) return
    this.connected = false
    for (const [write, entry] of [...this.inflight]) {
      this.inflight.delete(write)
      if (entry.task !== undefined) this.options.timer.cancelScheduled(entry.task)
      write.rejected = true
      entry.reject(Object.assign(new Error('끊김'), { name: 'NetworkError' }))
    }
    this.write.notifying = false
    this.notify.notifying = false
    if (this.flow) this.flow.notifying = false
    for (const l of [...this.deviceListeners]) l()
  }

  sendFlow(bytes: readonly number[]): void {
    this.flow?.emit(bytes)
  }

  sendNotify(bytes: readonly number[]): void {
    this.notify.emit(bytes)
  }

  joined(from = 0): Uint8Array {
    const parts = this.writes.slice(from).map((w) => w.bytes)
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}
