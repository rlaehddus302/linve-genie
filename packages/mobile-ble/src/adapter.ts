// 앱 B1 어댑터 (APP-03 AC1·AC3, LABEL_RULES L-7·L-11) — @livejjim/printer createNiimbotAdapter를 그대로 쓰고
// 환경(기능 감지·고르기 창·기억한 기기 찾기)과 클라이언트(NiimbotBleClient)만 네이티브 BLE로 바꾼다.
// 그래서 연결 상태·기억·다시 잇기 한 번·농도·마지막 줄 +1행·시간 초과·출력 결과는 웹과 같은 코드가 정한다. 그림은 받은 그대로 보낸다(점을 다시 그리지 않음).
import {
  createNiimbotAdapter,
  niimbotRequestOptions,
  type NiimbotAdapterOptions,
  type PrinterEnvironment,
  type PrinterProfile,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { NiimbotBleClient, type NiimbotBleClientOptions } from './client.ts'
import type { BleDeviceInfo, BleRadioState, BleTransport } from './transport.ts'

/** 고르기 창 — 앱 화면이 구현한다. 찾은 장치 목록이 늘 때마다 onDevices가 불리고, 판매자가 고르면 그 장치, 닫으면 null */
export interface DevicePicker {
  (scan: { onDevices(listener: (devices: readonly BleDeviceInfo[]) => void): () => void }): Promise<BleDeviceInfo | null>
}

export interface NativeB1AdapterOptions {
  readonly transport: BleTransport
  readonly pickDevice: DevicePicker
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
  readonly reconnectDelayMs?: number
  /** 켤 프로필 (기본: B1 하나) */
  readonly profiles?: readonly PrinterProfile[]
  readonly client?: NiimbotBleClientOptions
}

/** 고르기 창을 닫음 — printer 어댑터가 NOT_SELECTED로 읽는 예외 */
class PickCancelledError extends Error {
  override readonly name = 'NotFoundError'
  constructor() {
    super('고르기 창을 닫았다')
  }
}
/** 블루투스 꺼짐 — printer 어댑터가 BLUETOOTH_OFF로 읽는 문장 */
class RadioOffError extends Error {
  override readonly name = 'NotFoundError'
  constructor() {
    super('Bluetooth adapter not available.')
  }
}

/** 이름 앞자리 거르기 (niimbotRequestOptions의 namePrefix들) — 이름 없는 장치는 서비스 UUID 거르기가 맡는다 */
export function matchesNiimbotName(name: string | null, prefixes: readonly string[]): boolean {
  if (name === null || name === '') return false
  const upper = name.toUpperCase()
  return prefixes.some((p) => upper.startsWith(p.toUpperCase()))
}

export function createNativeB1Adapter(options: NativeB1AdapterOptions): RememberingPrinterAdapter {
  const { transport, pickDevice } = options
  if (typeof transport?.connect !== 'function' || typeof pickDevice !== 'function') throw new TypeError('BLE 전송과 고르기 창이 필요하다')
  let radio: BleRadioState = 'unknown'
  void transport.state().then(
    (state) => {
      radio = state
    },
    () => undefined,
  )
  transport.onStateChange((state) => {
    radio = state
  })
  const request = niimbotRequestOptions()
  const namePrefixes = request.filters.flatMap((f) => ('namePrefix' in f ? [f.namePrefix] : []))
  const serviceUuids = request.filters.flatMap((f) => ('services' in f ? f.services : []))

  /** 고르기 창: 찾기 → 판매자 고름 → 찾기 멈춤 */
  const requestDevice = async (): Promise<BleDeviceInfo> => {
    const state = await transport.state()
    radio = state
    if (state === 'off' || state === 'unauthorized') throw new RadioOffError()
    const found: BleDeviceInfo[] = []
    const listeners = new Set<(devices: readonly BleDeviceInfo[]) => void>()
    const stop = transport.scan({ serviceUuids, namePrefixes }, (device) => {
      if (found.some((d) => d.id === device.id)) return
      found.push(device)
      for (const l of [...listeners]) l([...found])
    })
    let picked: BleDeviceInfo | null
    try {
      picked = await pickDevice({
        onDevices(listener) {
          listeners.add(listener)
          if (found.length > 0) listener([...found])
          return () => {
            listeners.delete(listener)
          }
        },
      })
    } finally {
      stop()
    }
    if (picked === null) throw new PickCancelledError()
    return picked
  }

  const holder: { adapter?: RememberingPrinterAdapter } = {}
  const environment = (): PrinterEnvironment => {
    if (radio === 'unsupported') return {}
    return {
      bluetooth: {
        requestDevice,
        getAvailability: async () => {
          radio = await transport.state()
          return radio === 'on'
        },
        // 기억한 기기 (D-QS1-01 (3)): 식별자만 있으면 고르기 창 없이 바로 잇는다 — BLE는 ID로 연결할 수 있다
        getDevices: async () => {
          const saved = holder.adapter?.remembered
          return saved?.method === 'bluetooth' ? [{ id: saved.deviceId, name: null }] : []
        },
      },
    }
  }

  const adapterOptions: NiimbotAdapterOptions = {
    environment,
    createClient: () => new NiimbotBleClient(transport, options.client ?? {}),
    ...(options.timer === undefined ? {} : { timer: options.timer }),
    ...(options.printTimeoutMs === undefined ? {} : { printTimeoutMs: options.printTimeoutMs }),
    ...(options.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.reconnectDelayMs }),
    ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
  }
  holder.adapter = createNiimbotAdapter(adapterOptions)
  return holder.adapter
}
