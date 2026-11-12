// 프린터 연결 단계 기록 (D-PRN-DIAG) — 판매자 휴대폰에서 첫 연결이 안 될 때 서버 로그로 원인을 본다.
// 블루투스 관리자(BleManager)를 감싸 찾기·연결·서비스 찾기·알림·쓰기의 결과와 오류 번호만 모은다.
// 연결 시도가 끝나면(성공·실패 모두) 한 번에 /api/printer-diag로 보낸다. 보내기 실패는 무시한다(연결에 영향 없음).
// 남기는 것: 정해진 단계 이름, 오류 번호(ble-plx errorCode·안드로이드 GATT 번호), 걸린 밀리초, 찾은 기기 이름의 앞 글자(모델, 예: B1).
// 남기지 않는 것: 기기 주소(MAC)·이름 전체(일련번호)·오류 문장.
import type { BleError, BleManager, Characteristic, Device } from 'react-native-ble-plx'
import type { BleManagerLike } from '@livejjim/mobile-ble'
import { post } from '../api/client.ts'

interface DiagEvent {
  readonly step: string
  readonly ms: number
  readonly code?: number
}

const MAX_EVENTS = 80
let events: DiagEvent[] = []
let startedAt = Date.now()
let seenModels = new Set<string>()
let seenCount = 0
let namelessCount = 0

const clean = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 24)

/** 기기 이름의 모델 부분만 — 처음 '-'·'_'·빈칸 앞 (B1-H123… → B1). 일련번호는 남기지 않는다 */
const modelOf = (name: string): string => clean(name.split(/[-_\s]/)[0] ?? '').slice(0, 12) || 'x'

export function diag(step: string, code?: number): void {
  if (events.length >= MAX_EVENTS) return
  const safe = clean(step)
  if (!/^[A-Za-z]/.test(safe)) return
  events.push({ step: safe, ms: Date.now() - startedAt, ...(typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {}) })
}

/** 새 시도 시작 — 모은 것을 비운다 */
export function diagBegin(step: string, code?: number): void {
  events = []
  startedAt = Date.now()
  seenModels = new Set()
  seenCount = 0
  namelessCount = 0
  diag(step, code)
}

/** 모은 기록을 서버로 보낸다 (로그인 안 됨·네트워크 오류는 무시) */
export function diagFlush(step: string, code?: number): void {
  diag('scan_total', seenCount)
  diag('scan_nameless', namelessCount)
  diag(step, code)
  const batch = events
  events = []
  void post('/api/printer-diag', { events: batch }).catch(() => undefined)
}

const bleError = (where: string, error: unknown): void => {
  const e = error as Partial<BleError> | null
  diag(`${where}_err`, typeof e?.errorCode === 'number' ? e.errorCode : -1)
  if (typeof e?.androidErrorCode === 'number') diag(`${where}_android`, e.androidErrorCode)
  if (typeof e?.attErrorCode === 'number') diag(`${where}_att`, e.attErrorCode)
  if (typeof e?.reason === 'string' && /status\s*(\d+)/i.test(e.reason)) diag(`${where}_status`, Number(/status\s*(\d+)/i.exec(e.reason)?.[1]))
  if (error instanceof Error && /^[A-Za-z]+$/.test(error.name)) diag(`${where}_kind_${error.name}`)
}

async function watch<T>(where: string, run: () => Promise<T>): Promise<T> {
  diag(`${where}_start`)
  try {
    const value = await run()
    diag(`${where}_ok`)
    return value
  } catch (error) {
    bleError(where, error)
    throw error
  }
}

/** BleManager를 감싸 단계를 기록한다 (동작은 그대로) */
export function diagManager(manager: BleManager): BleManagerLike {
  return {
    state: async () => {
      const state = await manager.state()
      diag(`radio_${state}`)
      return state
    },
    onStateChange: (listener, emit) =>
      manager.onStateChange((state) => {
        diag(`radio_change_${state}`)
        listener(state)
      }, emit),
    startDeviceScan: (uuids, options, listener) => {
      diag('scan_start')
      return manager
        .startDeviceScan(uuids, options, (error: BleError | null, device: Device | null) => {
          if (error !== null) bleError('scan', error)
          if (device !== null) {
            seenCount++
            const name = device.localName ?? device.name ?? null
            if (name === null || name === '') namelessCount++
            else {
              const model = modelOf(name)
              if (!seenModels.has(model) && seenModels.size < 20) {
                seenModels.add(model)
                diag(`seen_${model}`, typeof device.rssi === 'number' ? device.rssi : undefined)
              }
            }
          }
          listener(error, device)
        })
        .catch((error: unknown) => {
          bleError('scan_call', error)
          throw error
        })
    },
    stopDeviceScan: () => {
      diag('scan_stop', seenCount)
      return manager.stopDeviceScan()
    },
    connectToDevice: (id, options) =>
      watch('connect', async () => {
        const device = await manager.connectToDevice(id, options)
        diag('connect_mtu', device.mtu)
        return device
      }),
    cancelDeviceConnection: (id) => {
      diag('cancel')
      return manager.cancelDeviceConnection(id)
    },
    onDeviceDisconnected: (id, listener) =>
      manager.onDeviceDisconnected(id, (error, device) => {
        if (error !== null) bleError('lost', error)
        else diag('lost')
        diagFlush('link_closed')
        listener(error, device)
      }),
    discoverAllServicesAndCharacteristicsForDevice: (id, transactionId) => watch('discover', () => manager.discoverAllServicesAndCharacteristicsForDevice(id, transactionId)),
    servicesForDevice: async (id) => {
      const list = await manager.servicesForDevice(id)
      diag('services', list.length)
      for (const service of list.slice(0, 8)) diag(`svc_${clean(service.uuid.slice(0, 8))}`)
      return list
    },
    characteristicsForDevice: (id, service) => manager.characteristicsForDevice(id, service),
    monitorCharacteristicForDevice: (id, service, characteristic, listener, transactionId) => {
      diag(`monitor_${clean(characteristic.slice(0, 8))}`)
      return manager.monitorCharacteristicForDevice(
        id,
        service,
        characteristic,
        (error: BleError | null, value: Characteristic | null) => {
          if (error !== null) bleError('monitor', error)
          else if (value !== null && events.length < MAX_EVENTS - 10 && !events.some((e) => e.step === 'notify_first')) diag('notify_first')
          listener(error, value)
        },
        transactionId,
      )
    },
    writeCharacteristicWithoutResponseForDevice: (id, service, characteristic, value, transactionId) =>
      manager.writeCharacteristicWithoutResponseForDevice(id, service, characteristic, value, transactionId).catch((error: unknown) => {
        bleError('write', error)
        throw error
      }),
    writeCharacteristicWithResponseForDevice: (id, service, characteristic, value, transactionId) =>
      manager.writeCharacteristicWithResponseForDevice(id, service, characteristic, value, transactionId).catch((error: unknown) => {
        bleError('write_resp', error)
        throw error
      }),
  }
}
