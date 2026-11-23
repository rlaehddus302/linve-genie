// react-native-ble-plx 묶기 (APP-03, D-APP-19 "검증된 기성 모듈") — BleTransport 계약을 BleManager 위에서 구현한다.
// 이 파일만 react-native-ble-plx를 부른다. 시험·Node에서는 createPlxTransport에 가짜 BleManagerLike를 넣는다.
// 아이폰 백그라운드 BLE: BleManager({ restoreStateIdentifier })로 만들고 앱 설정에 UIBackgroundModes bluetooth-central(ble-plx 플러그인)을 둔다.
import type { BleError, BleManager, Characteristic, Device, State, Subscription } from 'react-native-ble-plx'
import { decodeBase64, encodeBase64 } from './base64.ts'
import type { BleCharacteristicInfo, BleConnectOptions, BleDeviceInfo, BleLink, BleRadioState, BleScanFilter, BleTransport } from './transport.ts'
import { BLE_DEFAULT_MTU } from './transport.ts'

/** BleManager에서 쓰는 부분 (가짜를 넣기 쉽게) */
export type BleManagerLike = Pick<
  BleManager,
  | 'state'
  | 'onStateChange'
  | 'startDeviceScan'
  | 'stopDeviceScan'
  | 'connectToDevice'
  | 'cancelDeviceConnection'
  | 'onDeviceDisconnected'
  | 'discoverAllServicesAndCharacteristicsForDevice'
  | 'servicesForDevice'
  | 'characteristicsForDevice'
  | 'monitorCharacteristicForDevice'
  | 'writeCharacteristicWithoutResponseForDevice'
  | 'writeCharacteristicWithResponseForDevice'
> &
  Partial<Pick<BleManager, 'requestConnectionPriorityForDevice'>>

/**
 * 빠른 연결 우선순위 (ble-plx ConnectionPriority.High). 안드로이드 기본(보통)은 연결 간격이 30~50ms라
 * 응답 없는 쓰기가 연결 이벤트마다 하나씩 끝나 라벨 한 장(조각 수백 개)이 아이폰의 두 배(7초 넘게) 걸렸다 —
 * 높음(7.5~15ms)이면 아이폰과 비슷하다. 아이폰은 아무 일도 하지 않는다 (D-PRINT-FAST-01)
 */
export const BLE_CONNECTION_PRIORITY_HIGH = 1

export function radioStateOf(state: State | string): BleRadioState {
  switch (state) {
    case 'PoweredOn':
      return 'on'
    case 'PoweredOff':
      return 'off'
    case 'Unauthorized':
      return 'unauthorized'
    case 'Unsupported':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

/** 앱 전체가 나눠 쓰는 BleManager 식별자 (아이폰 상태 되살리기) */
export const BLE_RESTORE_IDENTIFIER = 'livejjim-printer'

/**
 * 기기 이름 — 광고의 이름(localName)을 먼저, 없으면 기기 이름(name).
 * 프린터가 지금 알리는 이름이 광고의 이름이다. name은 안드로이드·아이폰이 전에 본 이름을 들고 있는 값이라 이름이 바뀐 기기에서 옛 이름일 수 있다.
 * LABEL_RULES L-12 3은 목록에 보인 이름 그대로 기종을 고르므로(대소문자·앞자리), 목록과 고르기가 같은 값 — 지금 알리는 이름 — 을 쓴다.
 * 빈 글은 없는 것으로 본다.
 */
const nameOf = (device: Pick<Device, 'name' | 'localName'>): string | null => {
  const local = device.localName ?? null
  if (local !== null && local !== '') return local
  const name = device.name ?? null
  return name !== null && name !== '' ? name : null
}

/** 광고한 서비스 UUID — 글 목록일 때만 (고르기 목록 판정, L-7 PRN2) */
const servicesOf = (device: Pick<Device, 'serviceUUIDs'>): { serviceUuids?: readonly string[] } => {
  const list = device.serviceUUIDs
  return Array.isArray(list) && list.length > 0 ? { serviceUuids: list.filter((u): u is string => typeof u === 'string') } : {}
}

/** 신호 세기 — 수가 아니면(모름·127 같은 '없음' 값) 넣지 않는다 */
const rssiOf = (device: Pick<Device, 'rssi'>): { rssi?: number } =>
  typeof device.rssi === 'number' && Number.isFinite(device.rssi) && device.rssi < 0 ? { rssi: device.rssi } : {}

export function createPlxTransport(manager: BleManagerLike): BleTransport {
  return {
    async state() {
      try {
        return radioStateOf(await manager.state())
      } catch {
        return 'unknown'
      }
    },
    onStateChange(listener) {
      const sub: Subscription = manager.onStateChange((state) => listener(radioStateOf(state)), false)
      return () => sub.remove()
    },
    scan(filter: BleScanFilter, onFound) {
      const seen = new Set<string>()
      const matchCase = filter.matchCase === true
      const prefixes = (filter.namePrefixes ?? []).map((p) => (matchCase ? p : p.toUpperCase()))
      const uuids = filter.serviceUuids ?? []
      const matches = (device: Device): boolean => {
        const name = nameOf(device)
        const seenName = name === null ? null : matchCase ? name : name.toUpperCase()
        if (prefixes.length > 0 && seenName !== null && prefixes.some((p) => seenName.startsWith(p))) return true
        const advertised = (device.serviceUUIDs ?? []).map((u) => u.toLowerCase())
        if (uuids.some((u) => advertised.includes(u.toLowerCase()))) return true
        // 이름도 서비스도 없는 장치는 거른다
        return prefixes.length === 0 && uuids.length === 0
      }
      // 서비스 UUID로만 거르면 이름만 알리는 NIIMBOT을 놓친다 — 모두 받아 JS에서 거른다
      void manager.startDeviceScan(null, { allowDuplicates: false }, (error: BleError | null, device: Device | null) => {
        if (error !== null || device === null) return
        if (seen.has(device.id) || !matches(device)) return
        seen.add(device.id)
        onFound({ id: device.id, name: nameOf(device), ...rssiOf(device), ...servicesOf(device) })
      })
      return () => {
        void manager.stopDeviceScan().catch(() => undefined)
      }
    },
    async connect(id, options: BleConnectOptions): Promise<BleLink> {
      const device = await manager.connectToDevice(id, {
        ...(options.requestMtu === undefined ? {} : { requestMTU: options.requestMtu }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      })
      let alive = true
      const lost: Subscription = manager.onDeviceDisconnected(id, () => {
        if (!alive) return
        alive = false
        lost.remove()
        options.onDisconnect()
      })
      await manager.discoverAllServicesAndCharacteristicsForDevice(id)
      // 빠른 연결 간격을 청한다 — 못 바꾸는 기기·옛 판이면 보통 간격 그대로 쓴다(연결은 그대로 둔다)
      await manager.requestConnectionPriorityForDevice?.(id, BLE_CONNECTION_PRIORITY_HIGH).catch(() => undefined)
      const link: BleLink = {
        id,
        mtu: Number.isInteger(device.mtu) && device.mtu >= BLE_DEFAULT_MTU ? device.mtu : BLE_DEFAULT_MTU,
        name: nameOf(device),
        async characteristics() {
          const out: BleCharacteristicInfo[] = []
          for (const service of await manager.servicesForDevice(id)) {
            const list = await manager.characteristicsForDevice(id, service.uuid)
            for (const c of list) {
              out.push({
                serviceUuid: service.uuid,
                uuid: c.uuid,
                notify: c.isNotifiable,
                writeWithoutResponse: c.isWritableWithoutResponse,
                writeWithResponse: c.isWritableWithResponse,
              })
            }
          }
          return out
        },
        monitor(serviceUuid, characteristicUuid, onValue) {
          const sub = manager.monitorCharacteristicForDevice(id, serviceUuid, characteristicUuid, (error: BleError | null, characteristic: Characteristic | null) => {
            if (error !== null || characteristic === null || characteristic.value === null) return
            const bytes = decodeBase64(characteristic.value)
            if (bytes !== null) onValue(bytes)
          })
          return Promise.resolve(() => sub.remove())
        },
        async writeWithoutResponse(serviceUuid, characteristicUuid, bytes) {
          await manager.writeCharacteristicWithoutResponseForDevice(id, serviceUuid, characteristicUuid, encodeBase64(bytes))
        },
        async writeWithResponse(serviceUuid, characteristicUuid, bytes) {
          await manager.writeCharacteristicWithResponseForDevice(id, serviceUuid, characteristicUuid, encodeBase64(bytes))
        },
        async disconnect() {
          alive = false
          lost.remove()
          await manager.cancelDeviceConnection(id).catch(() => undefined)
        },
      }
      return link
    },
  }
}

/** 기억한 기기 정보에서 보기용 */
export const deviceInfoOf = (device: Pick<Device, 'id' | 'name' | 'localName'>): BleDeviceInfo => ({ id: device.id, name: nameOf(device) })
