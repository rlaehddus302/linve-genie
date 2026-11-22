// 프린터 고르기 상태 한 곳 (APP-03): 블루투스 고르기(createPrinterPicker의 pickDevice)가 찾은 기기 목록을 내놓고, 판매자가 고르면 돌려준다.
// 보이는 곳은 둘 — 화면이 목록을 직접 그리면(라벨 단계 연결 화면, D-UX4-04) 그 화면에, 아니면 앱 위 고르기 창(PrinterDevicePicker).
// 앱 위 창은 판매자가 단추를 눌러 부른 고르기(withPickWindow)에서만 — 그 밖의 고르기는 창 없이 바로 그만둔다 (D-NOPICK-02).
// 기기 이름은 블루투스로 받은 글이라 그리는 쪽이 글자로만 보인다.
import type { BleDeviceInfo, DevicePicker, PickEntry } from '@livejjim/mobile-ble'
import { useEffect, useSyncExternalStore } from 'react'

let entries: readonly PickEntry[] | null = null
let finish: ((device: BleDeviceInfo | null) => void) | null = null
let toEntries: (devices: readonly BleDeviceInfo[]) => readonly PickEntry[] = () => []
/** 목록을 직접 그리는 화면 수 — 0보다 크면 고르기 창을 띄우지 않는다 */
let inline = 0
/** 판매자가 누른 [프린터 연결]·[다시 연결] 등이 진행 중인 수 — 이때만 앱 위 고르기 창을 띄운다 (D-NOPICK-02) */
let windowWanted = 0
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const listener of listeners) listener()
}
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 찾은 기기 → 고르기 줄 (계열 표가 정한다 — 가까운 것이 위, 이름 없는 기기는 뺌) */
export function setPickEntries(map: (devices: readonly BleDeviceInfo[]) => readonly PickEntry[]): void {
  toEntries = map
}

/** createPrinterPicker에 넘기는 고르기: 찾는 동안 목록을 내놓고, 고르거나 그만두면 끝낸다 */
export const pickDevice: DevicePicker = async (scan) =>
  new Promise((resolve) => {
    finish?.(null)
    // 목록을 그리는 화면도 없고 판매자가 고르기를 부른 것도 아니면(화면을 떠난 뒤 늦게 끝난 찾기 등) 창을 띄우지 않고 그만둔다 (D-NOPICK-02)
    if (inline === 0 && windowWanted === 0) {
      resolve(null)
      return
    }
    entries = []
    emit()
    const off = scan.onDevices((next) => {
      entries = toEntries(next)
      emit()
    })
    finish = (device) => {
      off()
      entries = null
      finish = null
      emit()
      resolve(device)
    }
  })

/** 마지막으로 고른 줄 — 연결 화면을 나갔다 다시 들어와도 고를 때 본 그 줄(이름 · 기종·신호 · ✓)로 보인다 (D-CHECK-01). 앱을 다시 켜면 없다 */
let lastPicked: PickEntry | null = null

/** 판매자가 누른 연결 — 기억한 프린터가 안 보이거나 없으면 앱 위 고르기 창을 띄워도 된다 (D-NOPICK-02) */
export async function withPickWindow<T>(run: () => Promise<T>): Promise<T> {
  windowWanted += 1
  try {
    return await run()
  } finally {
    windowWanted -= 1
  }
}

/** 이 기기로 잇기 */
export function pickPrinter(device: BleDeviceInfo): void {
  lastPicked = entries?.find((entry) => entry.device.id === device.id) ?? null
  finish?.(device)
}

/** 마지막으로 고른 줄 (이 앱이 켜진 뒤 고른 것이 없으면 null) */
export function lastPickedEntry(): PickEntry | null {
  return lastPicked
}

/** 고르기 그만두기 (찾기도 멈춘다) */
export function cancelPrinterPick(): void {
  finish?.(null)
}

/** 찾는 중이면 목록(처음엔 빈 목록), 아니면 null */
export function usePrinterPickEntries(): readonly PickEntry[] | null {
  return useSyncExternalStore(subscribe, () => entries)
}

/** 고르기 창을 띄울지 (목록을 직접 그리는 화면이 없을 때만) */
export function usePickWindowShown(): readonly PickEntry[] | null {
  return useSyncExternalStore(subscribe, () => (inline > 0 ? null : entries))
}

/** 이 화면이 목록을 직접 그린다 — 떠 있는 동안 고르기 창을 띄우지 않고, 닫히면 찾기를 멈춘다 */
export function useInlinePrinterPick(): readonly PickEntry[] | null {
  useEffect(() => {
    inline += 1
    emit()
    return () => {
      inline -= 1
      cancelPrinterPick()
      emit()
    }
  }, [])
  return usePrinterPickEntries()
}
