# @livejjim/mobile-ble — 앱 블루투스 라벨 프린터 (APP-03)

`@livejjim/printer`의 프린터 어댑터 계약(`RememberingPrinterAdapter`)을 네이티브 BLE 전송으로 구현한다. B1 패킷·협상·인쇄 작업은 `@mmote/niimbluelib`, 연결 상태·기억·다시 잇기 한 번·농도·마지막 줄 +1행·시간 초과는 `createNiimbotAdapter` 그대로 — 바뀐 것은 **바이트를 쓰고 알림을 받는 길**(Web Bluetooth → `react-native-ble-plx`)뿐이다. 그래서 웹 Web Bluetooth와 **같은 바이트**를 보낸다(APP-03 AC1, `test/adapter.test.ts`가 두 길을 같은 가짜 B1에 흘려 비교한다).

근거: SPEC §5.14 APP-03, LABEL_RULES L-7·L-11, D-APP-19·20, D-QS1-01·02.

## 설계 선택 — react-native-ble-plx 전송 + 프린터 어댑터 재사용

- 직접 Expo BLE 모듈을 쓰지 않고 검증된 `react-native-ble-plx`(3.5.1)를 전송으로 쓴다(D-APP-19 "얇은 기성 모듈만"). 아이폰 백그라운드 BLE(`bluetooth-central`)·상태 되살리기(`restoreStateIdentifier`)·안드로이드 MTU 요청을 그 모듈이 맡는다.
- 전송 계약 `BleTransport`(`src/transport.ts`)는 프린터에 필요한 다섯 가지만(상태·찾기·연결·쓰기·알림). 시험은 이 계약의 가짜(`createFakeBleTransport`) + **바이트 수준 가짜 B1**(`createFakeB1`)으로 돈다 — 실기기·네이티브 빌드 없음.
- 그림은 서버가 준 1비트 그림을 그대로 보낸다(APP-03 AC3). 이 패키지에 래스터·패킷 만들기가 없다(구조 시험이 잠근다).

## JS API

```ts
import { BleManager } from 'react-native-ble-plx'
import { createNativeB1Adapter, createReconnectingAdapter, BLE_RESTORE_IDENTIFIER } from '@livejjim/mobile-ble'
import { createPlxTransport } from '@livejjim/mobile-ble/plx'

const manager = new BleManager({ restoreStateIdentifier: BLE_RESTORE_IDENTIFIER, restoreStateFunction: () => {} })
const adapter = createReconnectingAdapter(
  createNativeB1Adapter({
    transport: createPlxTransport(manager),
    pickDevice: (scan) => showPickerSheet(scan),   // 앱 화면: scan.onDevices(list => …) 로 목록을 보이고 고른 장치 또는 null(닫음)을 돌려준다
  }),
)
adapter.restoreRemembered(saved)          // 앱 저장소의 RememberedPrinter (기기 ID만, 서버로 보내지 않음)
await adapter.connect('bluetooth')        // 연결 마법사 (판매자 동작 안에서) → 찾기 → 고르기 → 협상 → B1 확인
await adapter.print(bitmap, { density: 3 }) // 서버가 준 LabelBitmap — 결과 { ok } | { ok: false, error }
await adapter.disconnect()                // 판매자가 끊음 — 다시 잇지 않는다
```

- `createNativeB1Adapter(options)` → `RememberingPrinterAdapter` (웹과 같은 계약: `state`·`onStateChange`·`availableMethods`·`connect`·`reconnect`·`connectRemembered`·`disconnect`·`print`·`remembered`·`restoreRemembered`·`onRememberedChange`). `availableMethods()`는 BLE가 있으면 `['bluetooth']` — 아이폰 앱도 `UNSUPPORTED`가 아니다.
- `createReconnectingAdapter(adapter, { timer?, delaysMs?, maxAttempts?, onGiveUp? })` → 프린터 쪽 끊김이면 기억한 기기로 고르기 창 없이 1·2·4·8초 간격으로 다시 잇는다. `disconnect()`는 판매자 뜻으로 보고 멈춘다. `dispose()`로 그만.
- 쓰기 조각: 협상된 MTU − 3 바이트씩(`splitForMtu`). 프린터는 이어 붙여 읽으므로 패킷과 조각 경계는 상관없다.
- 라벨 대기열은 앱 몫: 이 패키지는 `print` 결과(성공/실패·까닭 코드)만 정확히 돌려준다(L-11의 대기열·일시정지 규칙은 `@livejjim/printer`의 `queue.ts`를 앱이 쓴다).
- `NiimbotBleClient`(`src/client.ts`)는 `NiimbotAbstractClient`를 잇는 클라이언트 — `createNiimbotAdapter`의 `createClient` 자리에 들어간다.

## Marklife 9종 · 한 목록 고르기

- `createNativeMarklifeAdapter({ transport, pickDevice })` → Marklife 9종(YXQ: P50·S2·X2, L11: P11·P12·P15·L13·LP90·LP15, 바우아토는 `profiles`로 일부러 넘길 때만). `@livejjim/printer`의 `createMarklifeAdapter`를 **그대로** 쓰고 환경만 끼움 장치(`createBleBluetooth` — `BleTransport` → Web Bluetooth 모양)로 바꾼다. 꾸러미 A(ff00)→C(fd00)·조각 90바이트·크레딧·MTU 알림·`AA` 끝·진행 없는 20초는 웹과 같은 코드가 정한다(`test/marklife.test.ts`가 웹 가짜 기기와 바이트·조각 크기를 비교).
- 웹 Marklife에는 없는 **기억**을 더해 `RememberingPrinterAdapter`다 — `createReconnectingAdapter`에 그대로 넣는다. 앱을 다시 켜 이름을 모르면 먼저 이어 기기가 알린 이름으로 기종을 정한다.
- 이름 판단은 L-12 3 그대로(대소문자 가림, `P12_`). 찾기는 `matchCase`로 같은 판단을 쓰고, 이름은 광고의 이름(`localName`)을 먼저 본다 — 목록에 보인 기기가 이름 때문에 거절되지 않는다.
- 이은 MTU − 3보다 큰 조각은 끼움 장치가 나눠 쓴다(이어 붙이면 같은 바이트). 응답 없는 쓰기를 받지 않는 특성은 `writeWithResponse`로 쓴다.
- **앱 화면은 `createPrinterPicker({ transport, pickDevice })` 하나만 쓴다** — 한 목록에 B1·Marklife를 보이고, 고른 기기 이름으로 기종을 갈라(`printerKindOf`) 그 어댑터로 보낸다. Marklife는 NIIMBOT 서비스 UUID를 알려 B1 목록에 섞이므로, `createNativeB1Adapter`만 쓸 때도 Marklife 이름 꼴은 목록에서 뺀다.

## 앱 설정 (apps/mobile)

`package.json`에 `"react-native-ble-plx": "3.5.1"`(peer — 앱이 가진다)과 `"@livejjim/mobile-ble": "workspace:*"`. `app.json` plugins에 `BLE_PLX_PLUGIN_CONFIG` 그대로:

```json
["react-native-ble-plx", { "isBackgroundEnabled": true, "neverForLocation": true, "modes": ["central"], "bluetoothAlwaysPermission": "라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요." }]
```

안드로이드 12+는 실행 중에 `ANDROID_BLE_RUNTIME_PERMISSIONS`(`BLUETOOTH_SCAN`·`BLUETOOTH_CONNECT`)를 앱이 묻는다(ble-plx는 묻지 않는다). 권한 설명 문장은 `BLUETOOTH_PERMISSION_MESSAGE`(D-APP-11).

## 시험

`vitest` — 가짜 B1(바이트 수준)·가짜 전송·가짜 `BleManager`. 웹 길(niimbluelib `NiimbotBluetoothClient` + 가짜 Web Bluetooth 기기)과 같은 바이트, 받은 점 = 보낸 점(384×240 → 241줄), 프린터 골든 `G-PRT-N1-65`의 B1 프로필과 같음, 고르기·기억·다시 잇기·MTU 조각·끊김. 실제 B1 30장 연속(APP-03 AC4)은 HG-APP2.
