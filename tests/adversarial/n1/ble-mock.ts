// N1 적대 테스트 도우미: 손으로 조종하는 Web Bluetooth 기기와 손으로 돌리는 타이머.
// 제품의 가짜 기기(createFakeBluetooth)를 쓰지 않는다 — 알림 시각·쓰기 결과·끊김을 시험이 한 걸음씩 정한다.
import { GATT_BUNDLES, type BluetoothDeviceLike, type BluetoothEnvironment, type BluetoothRequestOptions, type GattCharacteristicLike, type GattServerLike, type PrinterTimer } from '@livejjim/printer'

type CharacteristicValueEvent = { readonly target?: unknown }

export class StepTimer implements PrinterTimer {
  now = 0
  private id = 1
  private tasks: { id: number; at: number; fn: () => void }[] = []
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.id++
    this.tasks.push({ id, at: this.now + Math.max(0, ms), fn })
    return id
  }
  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle)
  }
  get pending(): number {
    return this.tasks.length
  }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms
    for (;;) {
      await flush()
      const due = this.tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.tasks = this.tasks.filter((t) => t !== due)
      this.now = due.at
      due.fn()
    }
    this.now = target
    await flush()
  }
}

export async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

export interface Write {
  readonly at: number
  readonly bytes: Uint8Array
}

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
}

/** 시험이 알림·끊김을 직접 보내는 기기. 쓰기는 바로 성공한다(기록만 한다) */
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

  onWrite(_c: Char, value: Uint8Array): Promise<void> {
    if (!this.connected) return Promise.reject(Object.assign(new Error('끊김'), { name: 'NetworkError' }))
    this.writes.push({ at: this.options.timer.now, bytes: value.slice() })
    return Promise.resolve()
  }

  onStartNotifications(c: Char): void {
    if (c === this.flow) for (const b of this.options.onFlowStart ?? []) c.emit(b)
  }

  drop(): void {
    if (!this.connected) return
    this.connected = false
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
