// Web Bluetooth 모양 (LABEL_RULES L-12 3) — 이 패키지가 쓰는 부분만 구조로 적는다(DOM 타입에 Web Bluetooth가 없다).
// 진짜 navigator.bluetooth와 가짜 기기(fake-bluetooth.ts)가 모두 이 모양에 맞는다. import만으로는 navigator를 건드리지 않는다.

/** 16비트 UUID의 128비트 꼴 (Web Bluetooth는 소문자 128비트 글을 받는다) */
export const uuid16 = (short: number): string => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`

/** GATT 꾸러미 (L-12 3): A = ff00(쓰기 ff02 · 알림 ff01 · 흐름 제어 ff03), C = fd00(쓰기 fd01 · 알림 fd02 · 흐름 제어 없음) */
export const GATT_BUNDLES = Object.freeze({
  A: Object.freeze({ service: uuid16(0xff00), write: uuid16(0xff02), notify: uuid16(0xff01), flow: uuid16(0xff03) as string | null }),
  C: Object.freeze({ service: uuid16(0xfd00), write: uuid16(0xfd01), notify: uuid16(0xfd02), flow: null as string | null }),
})
export type GattBundleId = keyof typeof GATT_BUNDLES

/** 기기 고르기 창에 적는 함께 쓸 서비스 */
export const MARKLIFE_OPTIONAL_SERVICES: readonly string[] = Object.freeze([GATT_BUNDLES.A.service, GATT_BUNDLES.C.service])

export interface CharacteristicValueEvent {
  readonly target?: unknown
}

export interface GattCharacteristicLike {
  readonly uuid?: string
  /** 마지막 알림 값 */
  readonly value?: DataView | null
  readonly properties?: { readonly write?: boolean; readonly writeWithoutResponse?: boolean; readonly notify?: boolean }
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>
  writeValue?(value: Uint8Array): Promise<void>
  startNotifications(): Promise<unknown>
  addEventListener(type: 'characteristicvaluechanged', listener: (event: CharacteristicValueEvent) => void): void
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: CharacteristicValueEvent) => void): void
}

export interface GattServiceLike {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>
}

export interface GattServerLike {
  readonly connected: boolean
  connect(): Promise<GattServerLike>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<GattServiceLike>
}

export interface BluetoothDeviceLike {
  readonly name?: string | null
  readonly gatt?: GattServerLike | null
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

/** requestDevice 인자 (거르기는 이름 앞자리만, acceptAllDevices는 쓰지 않는다) */
export interface BluetoothRequestOptions {
  readonly filters: readonly { readonly namePrefix: string }[]
  readonly optionalServices: readonly string[]
}

export interface BluetoothLike {
  requestDevice(options: BluetoothRequestOptions): Promise<BluetoothDeviceLike>
  getAvailability?(): Promise<boolean>
}

/** 기능 감지에 쓰는 환경 (브라우저의 navigator.bluetooth·userAgent·maxTouchPoints) */
export interface BluetoothEnvironment {
  readonly bluetooth?: Partial<BluetoothLike> | null
  readonly userAgent?: string
  readonly maxTouchPoints?: number
}

/** 지금 브라우저의 환경 (부를 때 읽는다 — import만으로는 navigator를 건드리지 않는다) */
export function bluetoothEnvironment(): BluetoothEnvironment {
  const nav = (globalThis as { navigator?: { bluetooth?: Partial<BluetoothLike>; userAgent?: string; maxTouchPoints?: number } }).navigator
  return { bluetooth: nav?.bluetooth, userAgent: nav?.userAgent, maxTouchPoints: nav?.maxTouchPoints }
}

/** 알림 값을 바이트로 (받은 값을 복사한다) */
export function notificationBytes(event: CharacteristicValueEvent | undefined, characteristic: GattCharacteristicLike): Uint8Array {
  const target = event?.target as GattCharacteristicLike | undefined
  const view = target?.value ?? characteristic.value
  if (!view) return new Uint8Array(0)
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
}
