// 시험 도우미 — 가짜 BleManager 위의 가짜 Marklife 프린터 (react-native-ble-plx 모양). 웹 가짜 기기(@livejjim/printer createFakeBluetooth)와 같은 일을 한다:
// 꾸러미 A(ff00: 쓰기 ff02 · 알림 ff01 · 흐름 제어 ff03) · C(fd00: 쓰기 fd01 · 알림 fd02), 흐름 제어 알림을 켜면 첫 크레딧 `01 04`(+ MTU 알림 `02 lo hi`),
// 조각마다 `01 01`, 작업을 다 받으면 알림으로 `AA`. 받은 조각을 복사해 기록한다. 장치 여럿을 둘 수 있다(찾기 목록 시험).
import type { BleError, Characteristic, Device, Service, State } from 'react-native-ble-plx'
import { fakeJobLength, uuid16, type LabelProtocol } from '@livejjim/printer'
import { decodeBase64, encodeBase64, type BleManagerLike, type BleTransport } from '../src/index.ts'

type ScanListener = (error: BleError | null, device: Device | null) => void
type MonitorListener = (error: BleError | null, characteristic: Characteristic | null) => void

export interface FakeMarklifeDeviceOptions {
  readonly id: string
  /** 광고의 이름 (localName) */
  readonly localName?: string | null
  /** 기기가 들고 있는 이름 (name) */
  readonly name?: string | null
  /** 이을 수 있는 Marklife 프린터인지 (아니면 찾기 목록에만 보이는 장치) */
  readonly printer?: {
    readonly protocol: LabelProtocol
    readonly bundle: 'A' | 'C'
    /** 첫 크레딧 (기본 4). null이면 보내지 않는다 */
    readonly initialCredits?: number | null
    readonly creditsPerPacket?: number
    /** MTU 알림 (기본 없음) */
    readonly mtuNotice?: number | null
    /** 쓰기 특성이 응답 없는 쓰기를 받는지 (기본 true) */
    readonly writeWithoutResponse?: boolean
  }
  /** 광고하는 서비스 UUID */
  readonly serviceUUIDs?: readonly string[] | null
  /** 연결 MTU (기본 247) */
  readonly mtu?: number
}

export interface FakeMarklifeManager extends BleManagerLike {
  /** 받은 조각 (기기 ID별, 받은 순서) */
  packets(id: string): readonly Uint8Array[]
  /** 끝까지 받고 `AA`를 보낸 작업의 바이트 */
  printed(id: string): readonly Uint8Array[]
  /** 응답 있는 쓰기로 받은 조각 수 */
  withResponseWrites(id: string): number
  connectCount(id: string): number
  readonly log: string[]
  /** 지금 찾는 중이면 장치들을 알린다 */
  announce(): void
  /** 프린터 쪽 끊김 */
  drop(id: string): void
  connected(id: string): boolean
  setRadio(state: State): void
}

const A = { service: uuid16(0xff00), write: uuid16(0xff02), notify: uuid16(0xff01), flow: uuid16(0xff03) }
const C = { service: uuid16(0xfd00), write: uuid16(0xfd01), notify: uuid16(0xfd02), flow: null }

export function createFakeMarklifeManager(devices: readonly FakeMarklifeDeviceOptions[]): FakeMarklifeManager {
  const log: string[] = []
  let radio: State = 'PoweredOn' as State
  let scanListener: ScanListener | null = null
  const stateListeners = new Set<(state: State) => void>()
  const byId = new Map(devices.map((d) => [d.id, d]))
  const runtime = new Map<
    string,
    {
      connected: boolean
      connectCount: number
      packets: Uint8Array[]
      printed: Uint8Array[]
      withResponse: number
      buffer: Uint8Array
      monitors: Map<string, MonitorListener>
      lost: Set<() => void>
    }
  >()
  for (const d of devices) {
    runtime.set(d.id, { connected: false, connectCount: 0, packets: [], printed: [], withResponse: 0, buffer: new Uint8Array(0), monitors: new Map(), lost: new Set() })
  }
  const rt = (id: string) => {
    const r = runtime.get(id)
    if (!r) throw new Error(`Device ${id} was not found`)
    return r
  }
  const bundleOf = (id: string) => (byId.get(id)?.printer?.bundle === 'C' ? C : A)
  const deviceObject = (d: FakeMarklifeDeviceOptions): Device =>
    ({ id: d.id, name: d.name ?? null, localName: d.localName ?? null, serviceUUIDs: d.serviceUUIDs ?? null, mtu: d.mtu ?? 247 }) as unknown as Device

  const emit = (id: string, characteristic: string, bytes: readonly number[]): void => {
    const listener = rt(id).monitors.get(characteristic)
    listener?.(null, { value: encodeBase64(Uint8Array.from(bytes)) } as Characteristic)
  }

  const receive = (id: string, bytes: Uint8Array, withResponse: boolean): void => {
    const r = rt(id)
    const printer = byId.get(id)?.printer
    if (!r.connected || !printer) throw new Error('Device is not connected')
    if (withResponse) r.withResponse++
    r.packets.push(bytes.slice())
    const joined = new Uint8Array(r.buffer.length + bytes.length)
    joined.set(r.buffer)
    joined.set(bytes, r.buffer.length)
    r.buffer = joined
    const bundle = bundleOf(id)
    const perPacket = printer.creditsPerPacket ?? 1
    if (bundle.flow !== null && perPacket > 0) queueMicrotask(() => emit(id, bundle.flow as string, [0x01, perPacket]))
    const length = fakeJobLength(printer.protocol, r.buffer)
    if (length !== undefined && r.buffer.length >= length) {
      r.printed.push(r.buffer.slice(0, length))
      r.buffer = new Uint8Array(0)
      queueMicrotask(() => emit(id, bundle.notify, [0xaa]))
    }
  }

  const disconnect = (id: string): void => {
    const r = rt(id)
    if (!r.connected) return
    r.connected = false
    r.monitors.clear()
    r.buffer = new Uint8Array(0)
    for (const l of [...r.lost]) l()
  }

  const manager: FakeMarklifeManager = {
    log,
    state: async () => radio,
    onStateChange(listener) {
      stateListeners.add(listener)
      return { remove: () => stateListeners.delete(listener) }
    },
    async startDeviceScan(_uuids, _options, listener) {
      log.push('scan')
      scanListener = listener
      queueMicrotask(() => manager.announce())
    },
    async stopDeviceScan() {
      log.push('stopScan')
      scanListener = null
    },
    async connectToDevice(id, options) {
      log.push(`connect:${id}:${JSON.stringify(options ?? {})}`)
      const d = byId.get(id)
      if (!d || !d.printer || radio !== 'PoweredOn') throw Object.assign(new Error(`Device ${id} was disconnected`), { name: 'BleError' })
      const r = rt(id)
      r.connected = true
      r.connectCount++
      return deviceObject(d)
    },
    async cancelDeviceConnection(id) {
      log.push(`cancel:${id}`)
      const r = rt(id)
      r.connected = false
      r.monitors.clear()
      r.buffer = new Uint8Array(0)
      return { id } as Device
    },
    onDeviceDisconnected(id, listener) {
      const r = rt(id)
      const fn = (): void => listener(null, null)
      r.lost.add(fn)
      return { remove: () => r.lost.delete(fn) }
    },
    async discoverAllServicesAndCharacteristicsForDevice(id) {
      return { id } as Device
    },
    async servicesForDevice(id) {
      return [{ uuid: uuid16(0x1800) } as Service, { uuid: bundleOf(id).service } as Service]
    },
    async characteristicsForDevice(id, serviceUUID) {
      const bundle = bundleOf(id)
      if (serviceUUID !== bundle.service) return [{ uuid: uuid16(0x2a00), isNotifiable: false, isWritableWithoutResponse: false, isWritableWithResponse: false } as Characteristic]
      const noResponse = byId.get(id)?.printer?.writeWithoutResponse ?? true
      const list = [
        { uuid: bundle.write, isNotifiable: false, isWritableWithoutResponse: noResponse, isWritableWithResponse: true },
        { uuid: bundle.notify, isNotifiable: true, isWritableWithoutResponse: false, isWritableWithResponse: false },
      ]
      if (bundle.flow !== null) list.push({ uuid: bundle.flow, isNotifiable: true, isWritableWithoutResponse: false, isWritableWithResponse: false })
      return list as Characteristic[]
    },
    monitorCharacteristicForDevice(id, _service, characteristic, listener) {
      const r = rt(id)
      r.monitors.set(characteristic, listener)
      const printer = byId.get(id)?.printer
      if (printer && characteristic === bundleOf(id).flow) {
        queueMicrotask(() => {
          const initial = printer.initialCredits === undefined ? 4 : printer.initialCredits
          if (initial !== null) emit(id, characteristic, [0x01, initial])
          if (printer.mtuNotice != null) emit(id, characteristic, [0x02, printer.mtuNotice & 0xff, printer.mtuNotice >> 8])
        })
      }
      return { remove: () => r.monitors.delete(characteristic) }
    },
    async writeCharacteristicWithoutResponseForDevice(id, _service, characteristic, value) {
      if (characteristic !== bundleOf(id).write) throw new Error('not writable')
      receive(id, decodeBase64(value) as Uint8Array, false)
      return {} as Characteristic
    },
    async writeCharacteristicWithResponseForDevice(id, _service, characteristic, value) {
      if (characteristic !== bundleOf(id).write) throw new Error('not writable')
      receive(id, decodeBase64(value) as Uint8Array, true)
      return {} as Characteristic
    },
    packets: (id) => rt(id).packets,
    printed: (id) => rt(id).printed,
    withResponseWrites: (id) => rt(id).withResponse,
    connectCount: (id) => rt(id).connectCount,
    announce() {
      for (const d of devices) scanListener?.(null, deviceObject(d))
    },
    drop: disconnect,
    connected: (id) => rt(id).connected,
    setRadio(state) {
      radio = state
      for (const l of [...stateListeners]) l(state)
    },
  }
  return manager
}

/** createFakeBleTransport의 기본 B1 ID */
export const NIIMBOT_FAKE_DEFAULT_ID = 'FA:KE:B1:00:00:01'

/** 두 전송을 하나로 — 찾기는 둘 다, 연결은 ID로 갈라 보낸다(B1 가짜는 자기 ID만 받는다) */
export function combineTransports(niimbot: BleTransport, other: BleTransport, niimbotIds: readonly string[] = [NIIMBOT_FAKE_DEFAULT_ID]): BleTransport {
  return {
    state: () => other.state(),
    onStateChange(listener) {
      const a = niimbot.onStateChange(listener)
      const b = other.onStateChange(listener)
      return () => {
        a()
        b()
      }
    },
    scan(filter, onFound) {
      const a = niimbot.scan(filter, onFound)
      const b = other.scan(filter, onFound)
      return () => {
        a()
        b()
      }
    },
    connect: (id, options) => (niimbotIds.includes(id) ? niimbot : other).connect(id, options),
  }
}
