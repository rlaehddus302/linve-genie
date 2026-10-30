// 기기 고르기 (APP-03, LABEL_RULES L-7·L-12 3) — 찾기 → 판매자가 목록에서 고름 → 찾기 멈춤. B1·Marklife·한 목록 고르기가 함께 쓴다.
// printer 어댑터가 오류 코드로 읽는 예외(고르기 창 닫음 = NotFoundError, 블루투스 꺼짐 = "Bluetooth adapter not available.")도 여기 둔다.
import type { BleDeviceInfo, BleScanFilter, BleTransport } from './transport.ts'

/** 고르기 창 — 앱 화면이 구현한다. 찾은 장치 목록이 늘 때마다 onDevices가 불리고, 판매자가 고르면 그 장치, 닫으면 null */
export interface DevicePicker {
  (scan: { onDevices(listener: (devices: readonly BleDeviceInfo[]) => void): () => void }): Promise<BleDeviceInfo | null>
}

/** 고르기 창을 닫음 — printer 어댑터가 NOT_SELECTED로 읽는 예외 */
export class PickCancelledError extends Error {
  override readonly name = 'NotFoundError'
  constructor() {
    super('고르기 창을 닫았다')
  }
}

/** 블루투스 꺼짐 — printer 어댑터가 BLUETOOTH_OFF로 읽는 문장 */
export class RadioOffError extends Error {
  override readonly name = 'NotFoundError'
  constructor() {
    super('Bluetooth adapter not available.')
  }
}

/**
 * 찾기 → 판매자가 고름 → 찾기 멈춤. accept가 거짓인 장치는 목록에 넣지 않는다(목록에 보인 기기가 연결에서 이름 때문에 거절되지 않게).
 * 닫으면 null
 */
export async function pickFromScan(
  transport: BleTransport,
  filter: BleScanFilter,
  pickDevice: DevicePicker,
  accept: (device: BleDeviceInfo) => boolean = () => true,
): Promise<BleDeviceInfo | null> {
  const found: BleDeviceInfo[] = []
  const listeners = new Set<(devices: readonly BleDeviceInfo[]) => void>()
  const stop = transport.scan(filter, (device) => {
    if (found.some((d) => d.id === device.id) || !accept(device)) return
    found.push(device)
    for (const l of [...listeners]) l([...found])
  })
  try {
    return await pickDevice({
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
}
