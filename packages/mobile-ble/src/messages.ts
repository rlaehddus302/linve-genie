// 앱 블루투스 문장·설정 값 (SPEC APP-01 권한 설명, D-APP-11) — 글자 그대로.

/** 블루투스 권한 설명 (iOS NSBluetoothAlwaysUsageDescription, 안드로이드 권한 창 앞 안내) */
export const BLUETOOTH_PERMISSION_MESSAGE = '라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.'

/** 안드로이드 12+에서 앱이 실행 중에 물어야 하는 권한 (react-native-ble-plx는 묻지 않는다 — 앱이 PermissionsAndroid로) */
export const ANDROID_BLE_RUNTIME_PERMISSIONS = Object.freeze(['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'] as const)

/**
 * 앱 설정(app.json)의 react-native-ble-plx 플러그인 줄 — 아이폰 백그라운드 BLE(bluetooth-central)·권한 문장·안드로이드 "위치에 쓰지 않음".
 * 이 패키지는 설정 플러그인을 따로 두지 않는다(ble-plx 것이 같은 일을 한다).
 */
export const BLE_PLX_PLUGIN_CONFIG = Object.freeze([
  'react-native-ble-plx',
  Object.freeze({
    isBackgroundEnabled: true,
    neverForLocation: true,
    modes: Object.freeze(['central'] as const),
    bluetoothAlwaysPermission: BLUETOOTH_PERMISSION_MESSAGE,
  }),
] as const)

/** 블루투스 장치 상태 문장 (쉬운 한국어) */
export const BLE_RADIO_MESSAGES = Object.freeze({
  off: '블루투스가 꺼져 있어요. 켜고 다시 연결해 주세요.',
  unauthorized: '블루투스 사용이 막혀 있어요. 설정에서 라이브지니의 블루투스를 허용해 주세요.',
  unsupported: '이 기기에서는 블루투스 프린터를 쓸 수 없어요. 라벨은 그림 파일로 저장해 프린터 앱에서 찍어 주세요.',
})
