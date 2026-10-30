// 앱 B1 어댑터 (APP-03 AC1·AC3, LABEL_RULES L-7·L-11) — @livejjim/printer createNiimbotAdapter를 그대로 쓰고
// 환경(기능 감지·고르기 창·기억한 기기 찾기)과 클라이언트(NiimbotBleClient)만 네이티브 BLE로 바꾼다.
// 그래서 연결 상태·기억·다시 잇기 한 번·농도·마지막 줄 +1행·시간 초과·출력 결과는 웹과 같은 코드가 정한다. 그림은 받은 그대로 보낸다(점을 다시 그리지 않음).
import {
  EXPERIMENTAL_PROFILES,
  MARKLIFE_PROFILES,
  createNiimbotAdapter,
  niimbotRequestOptions,
  type NiimbotAdapterOptions,
  type PrinterEnvironment,
  type PrinterProfile,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { NiimbotBleClient, type NiimbotBleClientOptions } from './client.ts'
import { PickCancelledError, RadioOffError, pickFromScan, type DevicePicker } from './pick.ts'
import type { BleDeviceInfo, BleRadioState, BleTransport } from './transport.ts'

export type { DevicePicker } from './pick.ts'

export interface NativeB1AdapterOptions {
  readonly transport: BleTransport
  readonly pickDevice: DevicePicker
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
  readonly reconnectDelayMs?: number
  /** 켤 프로필 (기본: B1 하나) */
  readonly profiles?: readonly PrinterProfile[]
  readonly client?: NiimbotBleClientOptions
  /**
   * 찾기·고르기를 대신한다 (한 목록 고르기 createPrinterPicker가 이미 고른 기기를 넘긴다). 있으면 pickDevice는 부르지 않는다. null이면 닫음
   */
  readonly selectDevice?: () => Promise<BleDeviceInfo | null>
}

/** 이름 앞자리 거르기 (niimbotRequestOptions의 namePrefix들) — 이름 없는 장치는 서비스 UUID 거르기가 맡는다 */
export function matchesNiimbotName(name: string | null, prefixes: readonly string[]): boolean {
  if (name === null || name === '') return false
  const upper = name.toUpperCase()
  return prefixes.some((p) => upper.startsWith(p.toUpperCase()))
}

/** Marklife·바우아토의 이름 앞자리 (대소문자 무시로 본다 — 모양만 비슷한 이름도 B1 목록에 넣지 않는다) */
const NON_NIIMBOT_PREFIXES: readonly string[] = [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES].flatMap((p) => (p.namePrefix ? [p.namePrefix.toUpperCase()] : []))

/**
 * Marklife·바우아토 이름 꼴인지 (대소문자 무시). Marklife는 NIIMBOT 서비스 UUID(e7810a71-…)도 알려 B1 찾기 목록에 섞인다 —
 * B1 목록에서 빼서 판매자가 B1 연결에서 Marklife를 고르는 일(이어진 뒤 "다른 프린터")이 없게 한다
 */
export function looksLikeMarklifeName(name: string | null): boolean {
  if (name === null || name === '') return false
  const upper = name.toUpperCase()
  return NON_NIIMBOT_PREFIXES.some((p) => upper.startsWith(p))
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

  /** 고르기 창: 찾기 → 판매자 고름 → 찾기 멈춤 (Marklife 이름 꼴은 목록에 넣지 않는다) */
  const requestDevice = async (): Promise<BleDeviceInfo> => {
    const state = await transport.state()
    radio = state
    if (state === 'off' || state === 'unauthorized') throw new RadioOffError()
    const picked =
      options.selectDevice !== undefined
        ? await options.selectDevice()
        : await pickFromScan(transport, { serviceUuids, namePrefixes }, pickDevice, (device) => !looksLikeMarklifeName(device.name))
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
