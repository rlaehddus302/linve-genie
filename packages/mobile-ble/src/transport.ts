// 네이티브 BLE 전송 계약 (APP-03, D-APP-19) — react-native-ble-plx가 하는 일 중 프린터에 필요한 부분만.
// 프린터 프로토콜(B1 패킷·인쇄 작업)은 @mmote/niimbluelib·@livejjim/printer가 그대로 하고, 이 계약은 "바이트를 쓰고 알림을 받는 길"만 바꾼다.
// 시험은 이 계약의 가짜(fake.ts)로 돈다. 실제 묶기는 plx.ts.

/** 블루투스 장치 상태 — 켜짐·꺼짐·권한 없음·이 기기에 BLE 없음·아직 모름 */
export type BleRadioState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown'

export interface BleDeviceInfo {
  /** 안드로이드는 MAC, 아이폰은 식별자 — 기억한 프린터(RememberedPrinter.deviceId)에 그대로 둔다 */
  readonly id: string
  readonly name: string | null
  /** 찾을 때 받은 신호 세기 (dBm, 클수록 가깝다). 모르면 없다 — 고르기 목록의 차례에만 쓴다 */
  readonly rssi?: number
  /** 광고한 서비스 UUID (모르면 없다) — 고르기 목록 판정(pickListTarget, L-7)에 쓴다. 아이폰은 대문자로 준다 */
  readonly serviceUuids?: readonly string[]
}

export interface BleCharacteristicInfo {
  readonly serviceUuid: string
  readonly uuid: string
  readonly notify: boolean
  readonly writeWithoutResponse: boolean
  /** 응답 있는 쓰기를 받는지 (없으면 모름 — 받는 것으로 본다) */
  readonly writeWithResponse?: boolean
}

/** 이어진 장치 하나 */
export interface BleLink {
  readonly id: string
  /** 협상된 ATT MTU (기본 23 — 한 번에 쓸 수 있는 바이트는 mtu − 3) */
  readonly mtu: number
  /** 이은 기기가 알린 이름 (모르면 null) — 기억한 기기로 이을 때 기종을 정하는 데 쓴다 */
  readonly name?: string | null
  characteristics(): Promise<readonly BleCharacteristicInfo[]>
  /** 알림 켜기 — 돌려준 함수로 끈다 */
  monitor(serviceUuid: string, characteristicUuid: string, onValue: (bytes: Uint8Array) => void): Promise<() => void>
  writeWithoutResponse(serviceUuid: string, characteristicUuid: string, bytes: Uint8Array): Promise<void>
  /** 응답 있는 쓰기 — 프린터가 받았다고 답한 뒤에 끝난다 (응답 없는 쓰기를 받지 않는 특성에 쓴다) */
  writeWithResponse(serviceUuid: string, characteristicUuid: string, bytes: Uint8Array): Promise<void>
  disconnect(): Promise<void>
}

export interface BleScanFilter {
  readonly serviceUuids?: readonly string[]
  /** 이름 앞자리 (기본: 대소문자 가리지 않음). 비면 모든 장치 */
  readonly namePrefixes?: readonly string[]
  /**
   * true면 이름 앞자리를 대소문자까지 그대로 본다 — Web Bluetooth `namePrefix`·LABEL_RULES L-12 3의 이름으로 고르기와 같은 판단
   * (Marklife `P12_`는 `p12_`를 받지 않는다). 목록에 보인 기기가 이름 때문에 거절되지 않게 한다
   */
  readonly matchCase?: boolean
}

export interface BleConnectOptions {
  /** 안드로이드에서 요청할 MTU (아이폰은 시스템이 정한다) */
  readonly requestMtu?: number
  readonly timeoutMs?: number
  /** 장치 쪽에서 끊겼을 때 */
  readonly onDisconnect: () => void
}

export interface BleTransport {
  state(): Promise<BleRadioState>
  /** 상태가 바뀔 때마다. 돌려준 함수로 그만 듣는다 */
  onStateChange(listener: (state: BleRadioState) => void): () => void
  /** 찾기 시작 — 돌려준 함수로 멈춘다. 같은 장치는 한 번만 알린다 */
  scan(filter: BleScanFilter, onFound: (device: BleDeviceInfo) => void): () => void
  connect(id: string, options: BleConnectOptions): Promise<BleLink>
}

/** ATT MTU 기본값과 쓰기 머리 3바이트 */
export const BLE_DEFAULT_MTU = 23
export const BLE_ATT_HEADER = 3
/** 안드로이드에서 요청하는 MTU (BLE 4.2+ 최대) */
export const BLE_REQUEST_MTU = 247
