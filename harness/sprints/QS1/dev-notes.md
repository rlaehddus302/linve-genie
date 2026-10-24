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

## server (dev-server) — `apps/server/**`

### 바뀐 공개 모양

**실시간 연결 한도** (`src/hub.ts`, D-QS1-04, AC-QS1-10~13)
- 상수 `STREAM_BUFFER_MAX_BYTES = 1_048_576`, `STREAM_SELLER_MAX = 30`, 타입 `StreamCloseReason = 'BUFFER_FULL' | 'SELLER_LIMIT'`
- `HubOptions`에 `log?`(서버 로그), `bufferMaxBytes?`·`sellerMax?`(시험용, 기본값은 위 상수)를 더했다. `server.ts`가 `log`를 넘긴다(한 줄)
- 응답 본문 스트림은 이제 바이트 크기 전략(`highWaterMark: 0`, `size = byteLength`)이다. `-controller.desiredSize`가 받는 쪽이 아직 읽지 않은 바이트다
- 쌓인 양: 글을 하나 넣은 뒤 아직 안 읽은 양이 1 MiB를 **넘으면** 그 연결만 닫는다. 그래서 연결마다 남는 양은 한도 + 알림 하나 이하다
  - 닫는 법: 안 읽은 글이 있으면 `controller.error()`로 끝낸다. 쌓인 글을 버려 메모리를 바로 돌려받기 위해서다. **본문 읽기는 `done`이 아니라 거절(reject)로 끝난다.** 시험 도우미 `sseReader`는 둘 다 `closed`로 본다. 브라우저 EventSource는 오류를 받으면 3초 뒤 다시 연결한다(`retry: 3000`)
  - 안 읽은 글이 없으면 보통으로 닫는다(`controller.close()`, 본문 `done`)
- ready 전(범위 읽는 중): 모인 알림의 크기를 어림해 센다(JSON 길이 + 48바이트). 1 MiB를 넘으면 모은 것을 바로 비우고, 읽기가 끝나면 ready 없이 빈 본문으로 닫는다. 닫힌 읽는 중 연결(로그아웃 포함)에는 그 뒤 알림을 더 모으지 않는다
- 판매자마다 30개: `open()`이 읽는 중 연결을 등록한 직후에 센다. 열린 연결(먼저 연 것부터) → 읽는 중 연결(먼저 시작한 것부터) 순서로 닫아 30개로 맞춘다. 새 연결은 늘 받는다. 다른 판매자 수와는 상관없다. 닫힌 연결이 출력 기기 ID를 밝힌 것이면 지금처럼 `onDevice`를 부르고 `deviceLive`가 false가 된다
- 로그: `{ level: 'info', code: 'STREAM_CLOSED', seller, reason }` 한 줄(`src/log.ts`에 코드를 더함). 세션·쿠키·알림 내용은 남기지 않는다
- 서버 전체 연결 수 상한은 없다(범위 밖)

**확장 연결 코드 넣기 한도** (`src/extension/**`, D-QS1-06, AC-QS1-14·15)
- `routes.ts`
  - `EXT_CODE_GLOBAL_MAX = 3000`(서버 전체 10분, 600에서 바꿈). 주소마다 20번(`IP_MAX_ATTEMPTS`)은 그대로다
  - 순서: 주소 한도(늘 센다) → 믿는 주소가 아니면 전체 한도. 넘으면 지금과 같은 429 `EXT_CODE_LIMITED`와 같은 문장이다
  - `registerExtensionRoutes(api, extension, address?)`: 세 번째 인자로 주소 읽기를 받는다. `api.ts`가 로그인·간편 로그인과 같은 `clientAddress(connectionAddress, X-Forwarded-For, trustedProxies)`를 넘긴다(한 줄). `/api/extension/code`·`/renew`가 성공하면 그 주소의 `ipKey`를 믿는 주소로 기억한다. 주소를 모르면 기억하지 않는다
- 새 `trusted.ts`
  - `TrustedAddresses`(`TRUSTED_TTL_MS` 10분, `TRUSTED_PER_SELLER` 3)
  - 판매자마다 최근 3개를 둔다. 같은 주소로 다시 만들면 새로 만든 때로 옮기고, 넘치면 가장 오래된 것부터 버린다
  - 만든 때부터 10분이 되는 순간 믿지 않는다(`until > now`)
  - 메모리에만 둔다(DB·로그 없음, 서버를 다시 켜면 비워진다)
  - `has(key)`는 어느 판매자의 것이든 살아 있으면 true다
  - `countFor(sellerId)`는 시험·점검용이고 주소 값은 내주지 않는다
- `ExtensionService.trustedAddresses`(읽기 전용 속성): 두 앱(`/api`·`/ext`)이 같은 것을 쓴다

**파일 경계 밖으로 고친 곳** (모두 apps/server, 한 줄씩)
- `src/server.ts`: `new StreamHub({ log, … })`. 이것 없이는 AC-QS1-10의 서버 로그가 남지 않는다
- `src/log.ts`: `STREAM_CLOSED` 코드와 문장

### 시험
- `apps/server/test/qs1-stream-limits.test.ts`(9개): AC-QS1-10~13과 `/api/stream` 31개 연결 이어 붙이기
- `apps/server/test/qs1-ext-code-limit.test.ts`(11개): AC-QS1-14 (a)~(g), IPv6 /64·IPv4를 담은 표기, 다시 만들기 30번에도 3개, AC-QS1-15(로그·DB에 코드·토큰·주소 없음)
  - 믿는 주소 검사를 빼면 4개가 실패하는 것을 확인했다
- 관련 기존 시험도 통과했다
  - 서버 hub·stream·x1·print·api·e2e·i3-login-limit·node-server·lint-guard: 190/190
  - 적대 i1·s04·n5 privacy-switch: 49/49
- 서버 `tsc`·eslint 통과. 전체 `pnpm verify`는 부하 규칙대로 돌리지 않았다

### 지적 처리 — TD-QS1-002 · RA-QS1-02 (주소 기록 밀어내기)
- `/ext/connect` 순서를 바꿨다: `codeLimiter.allows(key)`(보기만 — 막힌 주소는 전체 한도를 쓰지 않음) → 믿는 주소가 아니면 `allCodes.take('*')` → `codeLimiter.take(key)`. 전체 한도에 막힌 요청은 주소 기록에 새 키로 들어가지 않는다.
- 그래서 10분 안에 주소 기록에 새로 들어갈 수 있는 키는 전체 3,000개 + 믿는 주소(판매자마다 3개)뿐이라 1만 개 상한을 넘겨 믿는 주소 A를 밀어낼 수 없다. A는 10분이 지나야 다시 받는다.
- `IpLimiter.allows(key)`를 더했다(세지도 기록하지도 않음). 밀어내기 규칙(1만 개 넘으면 가장 오래 안 쓴 것부터)은 그대로 — 로그인 한도 시험(`i3-login-limit`)의 기대값을 바꾸지 않으려고. 로그인·소셜 시작에는 믿는 주소가 없어 밀어내기로 얻는 것이 없다(밀어내려고 쓴 주소마다 이미 20번이 있음).
- 시험: `apps/server/test/qs1-ext-code-limit.test.ts` "AC-QS1-32 주소 기록 밀어내기…" 3개.

### 다음 영역에게
- web(`printer-station.ts`)
  - 서버 쪽에 바꿀 것이 없다
  - 실시간 연결은 한도로 닫혀도 브라우저가 다시 연결하고 ready로 따라잡는다. 출력 기기의 연결이 닫히면 다른 기기에 끊김이 잠깐 보인다(L-11 10)
- domain(AC-QS1-31·32)
  - 허브는 `new StreamHub({ heartbeatMs, sessionAlive, log, bufferMaxBytes?, sellerMax? })`로 직접 만들 수 있다. 연결 수는 `hub.size`, 읽는 중 수는 `hub.pendingSize`로 본다
  - 한도로 닫힌 본문은 읽기가 거절되거나 `done`이다. 둘 다 "닫힘"으로 본다
  - 안 읽은 양은 응답 본문을 읽지 않으면 그대로 쌓인다(`app.request`로 받은 Response는 노드 소켓이 없다)
  - 코드 한도는 주소를 `app.request(path, init, { incoming: { socket: { remoteAddress } } })`로 넣는다. 형식이 틀린 코드(`'x'`)도 한도에는 세고 DB는 보지 않으니, 3,000번을 빠르게 채울 수 있다(한 세계에 약 0.3초)
  - 믿는 주소 수는 `server.extension.trustedAddresses.countFor(sellerId)`로 본다

## web (dev-web) — `apps/web/src/lib/printer-station.ts`

### 바뀐 공개 모양
- `StationOptions.timer?: PrinterTimer` (기본 `systemTimer` — 부를 때의 전역 `setTimeout`이라 Playwright `page.clock`으로 당길 수 있다). 저절로 다시 잇기 간격과 60초에만 쓴다
- 내보냄: `AUTO_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]`, `AUTO_RECONNECT_STABLE_MS = 60_000`, 저장소 열쇠 `REMEMBERED_KEY = 'livejjim.printer.remembered'`(실제 프린터 — 시험 모드의 가짜 B1·가짜 USB도 이것), `REMEMBERED_TEST_KEY = 'livejjim.printer.rememberedTest'`(시험용 프린터), `FAKE_DEVICES_KEY = 'livejjim.test.fakeDevices'`(sessionStorage, 시험 모드만), 타입 `FakeB1Setup`·`FakeUsbSetup`
- `StationSnapshot`은 그대로다(새 칸 없음, AC-QS1-24). 기다리는 동안 `connection: 'DISCONNECTED'`·`connecting: false`, 시도하는 동안 `connecting: true`. 저절로 잇기의 실패는 `connectError`를 바꾸지 않는다(오류 상자 없음 — 판매자 동작이 아니다)
- `station.connect(method)` = 연결 방법 단추 → `adapter.connect`(늘 고르기 창). `station.reconnect()` = "다시 연결" → 기억하는 어댑터면 `adapter.reconnect(method)`, 아니면 `adapter.connect`
- 저장소: 어댑터를 만들 때 `restoreRemembered(parseRememberedPrinter(localStorage 값))`, `onRememberedChange`로 쓰기·지우기. 깨진 JSON·형식 밖은 없는 것. 페이지를 열 때 잇지 않는다

### 저절로 다시 잇기 (D-QS1-02)
- 시작: 지금 어댑터가 `CONNECTED`/`PRINTING` → `DISCONNECTED`로 바뀌었고, 이 기기가 출력 기기, 라벨 기능 켬, 기억하는 어댑터이고 `hasRemembered`, "연결 끊기" 뒤가 아님. 다른 방법으로 바꿀 땐 앞 어댑터 듣기를 먼저 그만둬서 시작하지 않는다
- 시도: `adapter.connectRemembered()` 한 번씩(웹이 부른 횟수 = 시도 수). 실패하면 다음 간격. 6번을 다 쓰면 그친다
- 횟수: 저절로 이어지면 60초 타이머. 지나면 0으로. 그 안에 끊기면 남은 간격부터. 판매자가 이은 연결(연결 방법 단추·"다시 연결")은 바로 0
- 60초 타이머는 끊김/연결 중 → `CONNECTED`로 처음 바뀔 때만 건다. 출력 한 장마다 오는 `PRINTING` → `CONNECTED`는 다시 걸지 않는다 (TD-QS1-001·RA-QS1-01 고침 — 전엔 60초보다 자주 찍으면 횟수가 영영 0이 되지 않았다)
- 그침: `disconnect()`, `connect()`/`reconnect()`(판매자 동작 — 기다림을 없애고 하는 중인 시도는 함께 기다린다: 그 시도로 이어지면 "다시 연결"의 성공, 아니면 판매자 시도 한 번), 출력 기기에서 내려옴·라벨 꺼짐(`#onStore`·시도 직전에 다시 본다), `stop()`
- 다시 이어지면 `#onAdapterState(CONNECTED)`가 지금처럼 서버에 연결됨을 알리고 `pump()`. 라벨을 다시 보내지 않는다

### 시험 손잡이 (`window.livejjimTestPrinter`, 시험 모드만, AC-QS1-25)
- 그대로: `useFakeB1()`, `setUnansweredNegotiations(n)`, `fakeB1()`(모양 그대로 `{ requests, connectAttempts, connected }` — FB1 시험이 toEqual로 본다)
- 새로 더함
  - `fakeB1State()`: `fakeB1()` + `powered`·`permitted`·`getDevicesCalls`
  - `setFakeB1({ getDevices?, permitted?, available?, adapterOff?, powered? })`: 없으면 가짜 B1을 먼저 꽂는다. 오판은 `{ available: false, adapterOff: false }`, 장치 꺼짐은 `{ available: false }` 또는 `{ adapterOff: true }`, 다시 잇기 거절/허락은 `{ powered: false/true }`
  - `fakeB1Disconnect()`: 프린터 쪽 끊김(전원 그대로)
  - `useFakeUsb({ getPorts?, ports? }?)`: 가짜 B1 USB 포트를 같은 B1 어댑터에 꽂는다(가짜 B1 블루투스도 함께), 연결 방법에 `serial`이 생긴다. `unplugFakeUsb(i?)`·`plugFakeUsb(i?)`, `fakeUsb()` = `{ requests, getPortsCalls, connectAttempts, connected }`
  - `autoReconnectAttempts()`: 이 페이지에서 저절로 잇기를 부른 수. `autoReconnectWaiting()`: 다음 시도가 잡혀 있는지
  - `setAutoReconnect(on)`: 기본 켬(운영과 같다). 끄면 기다리던 시도도 그친다 — 아래 "앞 E2E와 부딪힘"용
- 새로고침을 넘기: 가짜 기기 설정과 허락됨(`permitted`·포트별 `plugged`·`permitted`·번호)을 이 탭의 sessionStorage `FAKE_DEVICES_KEY`에 둔다(손잡이를 부를 때·연결될 때). 새 페이지에서 시험용 프린터를 만들 때(설정 `testPrinter: true`) 그 값이 있으면 같은 설정으로 가짜 B1(·USB)을 다시 꽂는다. 기억 값은 localStorage `REMEMBERED_KEY`. 운영(시험 모드 아님)에는 손잡이도 이 길도 없다

### 시험
- `apps/web/test/qs1-printer-station.test.ts`(30개, 손으로 돌리는 타이머): AC-QS1-20~25
- `apps/web/test/qs1-printer-step.test.tsx`(4개): AC-QS1-26 — 지금 화면 코드로 통과한다(화면 파일은 고치지 않음)
- 일부러 고장 내 보기: 저절로 잇기를 끄면 13개, "다시 연결"을 `adapter.connect`로 되돌리면 10개, "연결 끊기"의 그침을 빼면 2개가 실패한다
- 웹 단위 전체 1474개 중 실패 3개는 시간대(TZ 없이 돌림 — verify는 TZ를 넣는다)·부하 때문이고, 따로 TZ를 넣어 돌리면 통과한다
- E2E: `fb1/printer-connect` 5/5, `n4a/primary` 5/5, `i1/attacks` 앞 두 시험 2/2 통과. **`i1/station.spec.ts` AC-I1-70은 실패**(아래)

### 앞 E2E와 부딪힘 (disputesWithSpec — spec-keeper·test-e2e·오케스트레이터에게)
- D-QS1-02 "시험용 프린터도 같다"대로 하면, 시험용 프린터가 끊긴 뒤 1초 만에 저절로 다시 이어진다. 그런데 `tests/e2e/i1/station.spec.ts` AC-I1-70은 12번째 출력에서 끊긴 뒤 PC 알림에 "출력 멈춤 · 프린터 연결이 끊겼어요."가 뜨고 판매자가 "다시 연결"을 누를 때까지 멈춰 있기를 기다린다. 1초 만에 풀려 알림이 뜨지 않아 실패한다(60초 기다리다 끝남)
- `i1/attacks.spec.ts` AC-I1-09·23, `n4a/primary.spec.ts` AC-N4a-21 (다)는 이번에 통과했지만, 같은 1초 안에 띠·"다시 연결"을 잡아야 하는 시험이라 느린 컴퓨터에서 흔들릴 수 있다
- 금지 경로 3 때문에 이 파일들을 QS1에서 고칠 수 없다. 스펙과 다르게 만들지 않았다(시험용 프린터도 저절로 잇는다)
- **SA-QS1-001 (dev-device, spec-keeper에게)**: L-7 "블루투스 켜짐 확인"(LABEL_RULES 183줄)·L-12 3(290줄)·D-QS1-03은 "false일 때 그 시도가 어떤 이유로든 실패하면 `BLUETOOTH_OFF`"인데, 코드(`packages/printer/src/niimbot.ts` giveUp·`marklife.ts` giveUp)는 **`WRONG_MODEL`만 그대로** 둔다
  - 까닭: `WRONG_MODEL`은 고르기 창에서 기기를 골랐고(이름 다름) 또는 GATT까지 이어졌다(꾸러미 없음·B1 아닌 모델)는 뜻이라 블루투스가 켜져 있음이 확인된 경우다. D-QS1-03의 근거("시도도 안 됐으니 블루투스를 켜 보라")가 맞지 않고, "블루투스를 켜 주세요"를 보이면 켜져 있는 판매자가 할 일이 없다. "B1을 골라 주세요"(L-7 `WRONG_MODEL`)가 판매자가 바로 할 일이다. 기억하지 않는 것(D-QS1-01 (4))도 그대로
  - 코드는 바꾸지 않았다(스펙대로 바꾸면 안내가 틀려진다). 요청: L-7 "블루투스 켜짐 확인"·L-12 3·D-QS1-03에 "단, 다른 프린터를 고른 것(`WRONG_MODEL`)은 그대로 `WRONG_MODEL`" 한 줄을 더해 받아들이기. 받아들이지 않으면 두 `giveUp`의 `code !== 'WRONG_MODEL'` 조건을 빼고 아래 시험 둘을 스펙 결정에 맞게 바꾼다
  - 고정 시험: `packages/printer/test/qs1-remember.test.ts` "false여도 다른 모델을 고른 것은 WRONG_MODEL 그대로"(B1, D110)·"(e) Marklife·바우아토도 false인데 다른 기기를 고른 것…"(이름 `Phomemo P12`·꾸러미 없음 — Marklife 조건을 빼면 실패함을 확인)
- 고치는 길(정할 사람: spec-keeper·오케스트레이터): 그 시험들의 끊기 앞에 `livejjimTestPrinter.setAutoReconnect(false)` 한 줄을 넣도록 허락하거나, 끊기 앞에 `setConnectError('CONNECT_FAILED')`를 두고 "다시 연결" 전에 `setConnectError(null)`

### 다음 영역에게
- test-e2e (`tests/e2e/qs1/**`)
  - AC-QS1-40·41·44: `page.clock.install()`을 로그인 전에 하면 `fastForward`로 1·3·7·15·31·61초를 당길 수 있다(station 타이머는 부를 때의 전역 `setTimeout`)
  - AC-QS1-41: `useFakeB1()` → "블루투스로 연결" → `setFakeB1({ powered: false })`(끊김 + 다시 잇기 거절)
    - 시도 수는 `autoReconnectAttempts()`로 본다. 가짜 B1의 `connectAttempts`는 FB1 다시 잇기를 2로 세니 시도 수로 쓰지 않는다
    - `setFakeB1({ powered: true })` 뒤 출력 멈춤 띠의 "다시 연결"(TopBar·PrintParts는 `station.reconnect()`). `fakeB1().requests`는 그대로 1이다
  - AC-QS1-42: `setFakeB1({ getDevices: true })` → 연결 → 출력 기기 → `page.reload()`
    - 새로고침 뒤 연결 시도 0은 `fakeB1State().connectAttempts === 0`으로 본다
    - "다시 연결"은 띠(끊김 멈춤 — 새 페이지가 열 때 서버에 끊김을 알린다)에서 누른다
    - `getDevices` 없음은 `setFakeB1({ getDevices: false })`. 이 값도 새로고침을 넘는다
    - USB: `useFakeUsb()` → "USB 선으로 연결"
  - AC-QS1-43: 오판 `setFakeB1({ available: false, adapterOff: false })`, 장치 꺼짐 `setFakeB1({ available: false })`
  - 주의: 프린터 칸(`LabelsPage` `PrinterSection`)의 연결 실패 상자 "다시 연결"은 지금 `station.connect(lastMethod)`라 늘 고르기 창이다. 이 화면 파일은 금지 경로 1이라 고치지 않았다(MOB1 뒤 후속 — `api.station.reconnect()`로 바꾸면 된다). 고르기 창 없는 "다시 연결"은 출력 멈춤 띠·윗줄의 단추로 시험한다
- domain (AC-QS1-30)
  - `new PrinterStation({ …, timer })`에 손으로 돌리는 타이머를 넣는다. 예시는 `apps/web/test/qs1-printer-station.test.ts`의 `ManualTimer`
  - 연결 시도가 겹치는지는 시험용 프린터의 `connectAttempts`와 상태로 본다
