# QS1 개발 인계 (dev-notes)

## device (dev-device) — `packages/printer/**`

### 바뀐 공개 모양

**어댑터 계약** (`src/adapter.ts`, `index.ts`에서 내보냄)
- `PrinterAdapter`는 그대로다. 새로 `RememberingPrinterAdapter extends PrinterAdapter`를 더했다. `createB1Adapter`·`createNiimbotAdapter`·`createFakePrinter`가 이 모양을 돌려준다. Marklife·바우아토(`createMarklifeAdapter`)는 기억하지 않는다(범위 밖). 가르는 함수는 `isRememberingAdapter(adapter)`.
  - `connect(method)`: 연결 방법 단추. 기억이 있어도 늘 고르기 창(D-QS1-01 (5))
  - `reconnect(method)`: 화면의 "다시 연결". 그 방법으로 기억한 기기를 지금 얻을 수 있으면 고르기 창 없이 잇고, 아니면 고르기 창. 기억한 기기로 이은 시도가 실패하면(B1 첫 확인 다시 잇기 포함 한 번) **기억을 지운다**. 이때 오류 코드·상세는 지금과 같다(AC-QS1-02 (c))
  - `connectRemembered()`: 기억한 기기로만 잇는다. 저절로 다시 잇기에서 쓴다. `requestDevice`·`requestPort`를 부르지 않는다. 기억이 없거나 지금 얻을 수 없으면 시도 없이 `fail('DISCONNECTED')`를 돌려주고 상태는 `DISCONNECTED`. **실패해도 기억을 지우지 않는다** — 6번 시도 뒤 "다시 연결"이 고르기 창 없이 이어져야 해서다(AC-QS1-41)
  - 세 길은 연결 중인 시도 하나를 함께 기다린다. 연결 중에 또 부르면 같은 promise가 돌아온다. 쉬는 동안이나 잇는 동안 `disconnect()`를 부르면 그 시도는 붙지 않고 `DISCONNECTED`다(generation 규칙 그대로). 판매자의 "연결 끊기"는 기억을 지우지 않는다
  - `hasRemembered: boolean`: 페이지 안의 기기 객체나 되살린 값이 있으면 true
  - `remembered: RememberedPrinter | null`: 저장소에 둘 값. ID가 없는 블루투스 기기나 번호가 없는 포트면 null이고, 그 기기는 페이지 안에서만 기억한다
  - `restoreRemembered(value | null)`: 새로고침 뒤 저장소 값을 넘긴다. 형식 밖이면 없는 것으로 보고, 연결하지 않는다
  - `onRememberedChange(listener)`: 연결에 성공할 때마다 값과 함께, 잊을 때는 `null`로 부른다. web은 여기서 localStorage에 쓰거나 지우면 된다
- `type RememberedPrinter = { method: 'bluetooth'; deviceId: string } | { method: 'serial'; usbVendorId: number; usbProductId: number }`. 기기 이름·판매자 정보는 담지 않는다
- `parseRememberedPrinter(unknown) → RememberedPrinter | null`: localStorage 값을 검사한다. 남는 칸은 버린다. ID는 비지 않은 128자 이하 글, USB 번호는 0~0xffff 정수여야 한다
- `sameRememberedPrinter(a, b)`, `RememberBox`: 내부 도우미이고 내보내기만 해 두었다

**B1 어댑터** (`src/niimbot.ts`)
- 기억 = 마지막으로 연결에 성공한 (연결 방법 + 기기 객체). `WRONG_MODEL`과 실패한 연결은 기억하지 않고, 고르기 창 길이 실패해도 앞 기억은 남긴다. 고른 기기를 모르면(환경의 requestDevice가 undefined를 돌려줌 — 기존 시험) 기억을 지운다
- 새로고침 뒤 찾는 방법
  - 블루투스: `env.bluetooth.getDevices`가 있을 때만 부르고 ID가 같은 기기를 찾는다
  - USB: `env.serial.getPorts()` 가운데 `getInfo()`의 제조사·제품 번호가 같은 포트가 **정확히 하나**일 때만 쓴다
  - 없거나 예외이거나 못 찾으면 → `reconnect`는 고르기 창, `connectRemembered`는 시도 없이 실패
- **USB 고르기 창을 이제 어댑터가 띄운다**(`env.serial.requestPort.call(env.serial)` 뒤 `client.connect({ authorizedPort })`). 고른 포트를 기억하려고 바꿨다. niimbluelib도 거르기 없이 `requestPort()`를 부르므로 고르기 창은 같다. `NiimbotClientLike.connect` 인자에 `authorizedPort`를 더했다
- `PrinterEnvironment`에 `bluetooth.getDevices?()`, `serial.getPorts?()`를 더했다. 도우미 `bluetoothDeviceId(device)`, `serialPortIds(port)`도 있다
- **D-QS1-03**: `getAvailability()`가 false여도 고르기 창이나 기억한 기기 잇기를 한 번 시도한다. 실패하면 이유와 상관없이(창 닫음, GATT 실패, 첫 확인 다시 잇기 실패 포함) `BLUETOOTH_OFF`와 L-7 문장으로 알리고 상세는 붙이지 않는다. **예외는 `WRONG_MODEL`** — 다른 프린터를 고를 수 있었다면 블루투스는 켜져 있으니 그 코드를 그대로 둔다(L-7 문장이 더 정확). Marklife·바우아토(`src/marklife.ts`)도 같다

**가짜 기기**
- `createFakeNiimbotBluetooth` 옵션
  - 새 옵션: `id`(기본 `'fake-b1-01'`), `powered`(기본 true), `getDevices: boolean | 'throws'`(기본 false, 크롬 기본값처럼 없음), `permitted`(기본 false, 고르기 창에서 고르면 true), `adapterOff`
  - `available: false`만 주면 지금처럼 정말 꺼짐이다(`adapterOff`의 기본은 `!available`). **오판은 `{ available: false, adapterOff: false }`**
  - 꺼짐이면 고르기 창이 `NotFoundError 'Bluetooth adapter not available.'`로 끝나고, 기억한 기기 잇기도 실패한다
- `createFakeNiimbotBluetooth` 새 손잡이
  - `setPowered(on)`: 끄면 이어진 연결이 끊기고, 다시 잇기는 `NetworkError FAKE_GATT_CONNECT_FAILED_MESSAGE`(→ `CONNECT_FAILED`, 시간 초과가 아니라 1초 다시 잇기도 없음)로 거절된다. 고르기 창에도 기기가 없어 닫힌다. 켜면 다시 받는다 — "다시 잇기를 거절/허락"이 이것이다
  - `setGetDevices(mode)`, `setPermitted(b)`, `setAdapterOff(b | undefined)`
  - 읽기: `powered`, `permitted`, `getDevicesCalls`, `device.id`
  - `disconnect()`는 그대로 기기 쪽 끊김이고 전원은 켜진 채다
  - 기존 `requests`(고르기 창 횟수), `connectAttempts`, `authorizedDevices`는 그대로 센다
- 새 `createFakeNiimbotSerial(options)` (`src/fake-serial.ts`)
  - 옵션: `ports: [{ usbVendorId?, usbProductId?(기본 FAKE_B1_USB_VENDOR_ID 0x3513 / FAKE_B1_USB_PRODUCT_ID 0x0002 — 시험용 값), plugged?, permitted?, model? }]`, `chooser: 'pick' | 'cancel' | 번호`, `getPorts: boolean | 'throws'`(기본 true), `busy`
  - 손잡이: `unplug(i)`(끊김 알림), `plug(i)`(같은 포트 객체를 다시 꽂음), `addPort`, `setChooser`, `setGetPorts`, `setBusy`
  - 읽기: `ports`, `requests`, `getPortsCalls`, `connectAttempts`, `authorizedPorts`, `connected`, `printed`
- `combineNiimbotFakes(bt, usb) → { environment, createClient }`: 두 가짜를 B1 어댑터 하나에 꽂는다. `environment`는 객체라서 어댑터에는 `() => x.environment`로 넘긴다
- `createFakeBluetooth`(Marklife)
  - `adapterOff` 옵션과 `setAdapterOff`를 더했다. 기본은 `!available`이라 기존 `available: false`는 그대로 정말 꺼짐이다
  - 꺼짐이면 `requestDevice`가 `NotFoundError 'Bluetooth adapter not available.'`, `gatt.connect()`가 실패한다
- `createFakePrinter`(시험용 프린터)
  - 위 계약을 지킨다. 새 읽기는 `connectAttempts`, `pickerCount`(고르기 창 길), `rememberedAttempts`(기억한 기기 길)
  - 기억 값은 `fakePrinterRemembered(method)`: 블루투스는 `{ method: 'bluetooth', deviceId: FAKE_PRINTER_DEVICE_ID('fake-printer') }`, USB는 가짜 B1 번호
  - 되살린 값이 이 값과 같을 때만 고르기 창 없이 잇는다
  - `setConnectError(code)`가 다시 잇기 거절이다. `connectRemembered`가 실패하면 기억이 남고, `reconnect`가 실패하면 기억이 지워진다
  - 연결 때의 기다림은 지금처럼 한 번(마이크로태스크 하나)이다 — 출력 기기 시험이 이 때에 기대고 있다

### 기존 시험의 기대값 교체 (모두 `// QS1 D-QS1-03`)
- `packages/printer/test/b1.test.ts`: 전에는 "getAvailability false면 BLUETOOTH_OFF, 클라이언트를 만들지 않는다"였다. 이제는 "한 번 시도하고, 시도도 실패하면(창 닫음) BLUETOOTH_OFF, 클라이언트를 만든다"이고, 같은 시험에 "false인데 시도는 됨 → CONNECTED"를 더했다
- `packages/printer/test/marklife.test.ts` 블루투스 꺼짐 줄: `requests` 0 → 1. 정말 꺼짐이라 `BLUETOOTH_OFF`는 그대로다
- `fb1-connect.test.ts` (e)는 getAvailability를 쓰지 않아 고치지 않았다(그대로 통과)

### 새 시험
`packages/printer/test/qs1-remember.test.ts`(AC-QS1-01~07, 37개). 확인 결과
- printer 단위 328/328
- 적대 n1·p1·fb1 240/240
- web `printer-station`·`fb1-printer` 28/28
- printer 타입 검사·eslint 통과
- 전체 `pnpm verify`는 부하 규칙대로 돌리지 않았다

### 다음 영역(web — `printer-station.ts`)에게
- `#real`(B1)과 시험용 프린터는 둘 다 `isRememberingAdapter`가 true다. `createAdapter` 주입이 다른 어댑터를 줄 수 있으니 가르는 함수로 확인한다
- "다시 연결"(`station.reconnect()`)에서 쓸 것
  - 지금은 `this.connect(method)` → `adapter.connect`다. 이것을 `adapter.reconnect(method)`로 바꾼다
  - 연결 방법 단추(`station.connect('bluetooth')`)는 그대로 `adapter.connect`를 쓴다
- 저장소(AC-QS1-21)
  - 어댑터를 만든 직후 `restoreRemembered(parseRememberedPrinter(JSON.parse(localStorage값)))`를 부른다
  - `onRememberedChange(v => v ? 쓰기 : 지우기)`로 저장소를 맞춘다
  - 시험용 프린터(방법 `'test'`)는 기억 값이 블루투스 꼴이다. 저장소 열쇠를 방법마다 따로 둘지는 web이 정한다
- 저절로 다시 잇기(AC-QS1-22)
  - `adapter.connectRemembered()`를 주입한 타이머로 1·2·4·8·16·30초 뒤에 부른다
  - 실패 결과의 `DISCONNECTED`(기억 없음, 못 얻음)는 시도하지 않은 것이다. 어댑터는 시도하지 않고 돌려준다. 시도 수를 셀 때는 web 쪽에서 부른 횟수로 센다
  - 가짜 B1의 `connectAttempts`는 FB1 다시 잇기(시간 초과 → 1초 뒤 한 번 더)를 2로 센다
- 손잡이(AC-QS1-25)에 이을 가짜 조작
  - 가짜 B1: `fake.disconnect()`, `setPowered`, `setGetDevices`, `setPermitted`, `setAvailable` + `setAdapterOff`
  - 가짜 USB: `createFakeNiimbotSerial` + `combineNiimbotFakes`
  - 새로고침을 넘는 시험이면 sessionStorage에 `{ getDevices, permitted: true, id }`를 두고, 새 가짜를 그 옵션으로 만들면 된다
- `getAvailability` 오판: 어댑터가 처리한다. web은 바꿀 것이 없다

### 실물 확인이 필요한 것 (HG-2)
- 실제 크롬에서 `getDevices()`로 얻은 B1을 `authorizedDevice`로 넘겼을 때 niimbluelib `gatt.connect()`가 이어지는지(플랫폼에 따라 광고 감지(`watchAdvertisements`)가 먼저 필요할 수 있다)
- 실제 B1의 USB 제조사·제품 번호, 다시 꽂은 뒤 같은 `SerialPort` 객체가 되살아나는지
- 윈도우에서 `getAvailability()` false 오판일 때 고르기 창이 정상으로 뜨는지
