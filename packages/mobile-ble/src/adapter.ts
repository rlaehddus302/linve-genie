// 앱 B1 어댑터 (APP-03 AC1·AC3, LABEL_RULES L-7·L-11) — @livejjim/printer createNiimbotAdapter를 그대로 쓰고
// 환경(기능 감지·고르기 창·기억한 기기 찾기)과 클라이언트(NiimbotBleClient)만 네이티브 BLE로 바꾼다.
// 그래서 연결 상태·기억·다시 잇기 한 번·농도·마지막 줄 +1행·시간 초과·출력 결과는 웹과 같은 코드가 정한다. 그림은 받은 그대로 보낸다(점을 다시 그리지 않음).
import {
  ENABLED_PROFILES,
  LABEL_PROFILES,
  NIIMBOT_SERVICE_UUID,
  NIIMBOT_TARGET,
  createNiimbotAdapter,
  pickListTarget,
  profileForDeviceName,
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
  /** 켤 프로필 (기본: ENABLED_PROFILES — B1·B1 SE·B21·D110) */
  readonly profiles?: readonly PrinterProfile[]
  readonly client?: NiimbotBleClientOptions
  /**
   * 찾기·고르기를 대신한다 (한 목록 고르기 createPrinterPicker가 이미 고른 기기를 넘긴다). 있으면 pickDevice는 부르지 않는다. null이면 닫음
   */
  readonly selectDevice?: () => Promise<BleDeviceInfo | null>
}

/** 이름 앞자리 거르기 — 글자 그대로(대소문자를 가린다, PRN2 D-PRN2-04). 이름 없는 장치는 서비스 UUID 거르기가 맡는다 */
export function matchesNiimbotName(name: string | null, prefixes: readonly string[]): boolean {
  if (name === null || name === '') return false
  return prefixes.some((p) => p !== '' && name.startsWith(p))
}

/**
 * Marklife·바우아토 이름인지 (L-12 앞자리, 글자 그대로 — L-7 고르기 목록 1). Marklife는 NIIMBOT 서비스 UUID(e7810a71-…)도 알려
 * NIIMBOT 찾기에 섞인다 — 이 이름은 NIIMBOT 어댑터로 보내지 않는다(이어진 뒤 "다른 프린터"가 없게)
 */
export function looksLikeMarklifeName(name: string | null): boolean {
  return profileForDeviceName(name, LABEL_PROFILES) !== undefined
}

/** 모델 이름 + `-`·`_` 꼴 (켠 NIIMBOT 프로필에서 — pickListTarget 2와 같은 꼴) */
const nameShapes = (profiles: readonly PrinterProfile[]): string[] => [...new Set(profiles.flatMap((p) => [`${p.model}-`, `${p.model}_`]))]

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
  const namePrefixes = nameShapes(options.profiles ?? ENABLED_PROFILES)
  const serviceUuids = [NIIMBOT_SERVICE_UUID]

  /**
   * 이 기기가 NIIMBOT 목록에 들어가는지 (L-7 고르기 목록 — 웹과 같은 판정 pickListTarget): L-12 이름이 아니고,
   * NIIMBOT 서비스를 광고하거나 켠 모델 이름 꼴로 시작한다
   */
  const isNiimbotDevice = (device: BleDeviceInfo): boolean => {
    const services = device.serviceUuids ?? []
    if (pickListTarget(device.name, services) !== NIIMBOT_TARGET) return false
    return services.some((u) => u.toLowerCase() === NIIMBOT_SERVICE_UUID) || matchesNiimbotName(device.name, namePrefixes)
  }

  /** 고르기 창: 찾기 → 판매자 고름 → 찾기 멈춤 (Marklife 이름·목록 밖 기기는 넣지 않는다) */
  const requestDevice = async (): Promise<BleDeviceInfo> => {
    const state = await transport.state()
    radio = state
    if (state === 'off' || state === 'unauthorized') throw new RadioOffError()
    const picked =
      options.selectDevice !== undefined
        ? await options.selectDevice()
        : await pickFromScan(transport, { serviceUuids, namePrefixes, matchCase: true }, pickDevice, isNiimbotDevice)
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
