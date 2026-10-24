# FB1 dev-notes

## device (dev-device)

### 바뀐 공개 모양 — `@livejjim/printer`

- **새 오류 코드 `CONNECT_FAILED`** (`PRINTER_ERROR_CODES`·`PRINTER_MESSAGES`·`MARKLIFE_MESSAGES`): "프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요." + `action: '다시 연결'` (`RECONNECT_ACTION`, `DISCONNECTED`와 같은 단추).
  - B1: 연결 중 예외 가운데 `NOT_SELECTED`·`BLUETOOTH_OFF`·`PORT_BUSY`가 아닌 것 전부 (전에는 `DISCONNECTED`).
  - Marklife·바우아토: 고르기 창의 그 밖의 예외, GATT 연결 실패, 기기에 GATT 없음, 알림 켜기 실패, 연결하는 동안 프린터 쪽에서 끊김 → `CONNECT_FAILED` (전에는 `DISCONNECTED`).
  - 그대로 `DISCONNECTED`: 연결된 뒤 끊김(출력 중 포함), 연결하는 동안 판매자가 "연결 끊기"를 누름(그 뒤 늦게 온 예외도 — 이때는 상세 없음).
  - 연결 결과만 쓰는 코드다. 출력 결과(`/api/print/result`)에는 나오지 않는다 — 서버 `PRINTER_ERROR_CODES`(print.ts)는 바꿀 필요 없음.
- **`PrinterError.detail`은 쉬운 말 고정 문장뿐** (원래 예외 글을 넣지 않는다, 어떤 어댑터·어떤 코드든): 없음 / `TIMEOUT_DETAIL` "프린터가 답하지 않아 기다리는 시간이 지났어요." / `RETRIED_TIMEOUT_DETAIL` "프린터가 답하지 않아 기다리는 시간이 지났어요. 한 번 더 해 봤지만 안 됐어요." / `WRONG_MODEL`(B1)의 "모델: {모델 이름}". Marklife `WRONG_MODEL`은 이제 상세 없음(전에는 개발자 글).
- **`describeCause(cause)`의 뜻이 바뀜**: 전에는 "이름: 메시지"(전화번호 가림)를 돌려줬고, 이제는 시간 초과(`timeout`·`timed out`, 대소문자 무시)면 `TIMEOUT_DETAIL`, 그 밖엔 `undefined`. 새로 `isTimeoutCause(cause)`, 상수 `TIMEOUT_DETAIL`·`RETRIED_DETAIL_SUFFIX`·`RETRIED_TIMEOUT_DETAIL`.
- **B1 첫 확인 다시 잇기**: B1 블루투스 연결은 이제 어댑터가 `navigator.bluetooth.requestDevice(niimbotRequestOptions())`를 직접 부르고(거르기는 niimbluelib 0.47.1과 같음 — 모델 이름 첫 글자들 + 서비스 `e7810a71-…`), 고른 기기를 `client.connect({ authorizedDevice })`로 넘긴다. 첫 확인이 시간 초과로 실패하면 1초(`NIIMBOT_RECONNECT_DELAY_MS`, 어댑터 옵션 `reconnectDelayMs`) 쉰 뒤 같은 기기·같은 클라이언트로 한 번 더 잇는다 — 그동안 상태 `CONNECTING`, 고르기 창은 다시 뜨지 않는다. 두 번째도 실패하면 `CONNECT_FAILED` + `RETRIED_TIMEOUT_DETAIL`. 쉬는 동안 `disconnect()`면 바로 `DISCONNECTED`(다시 잇지 않음). USB·Marklife·바우아토·시간 초과가 아닌 실패는 다시 잇지 않는다. `NiimbotClientLike.connect`는 `connect(options?: { authorizedDevice?: unknown })`.
- **가짜 NIIMBOT B1 블루투스 기기** `createFakeNiimbotBluetooth({ unansweredNegotiations?, negotiationTimeoutMs?, name?, model?, chooser?, available?, timer? })` (fake-bluetooth.ts, index에서 내보냄): `environment`·`createClient`를 `createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient })`에 넣는다. 처음 N번 `connect()`는 niimbluelib과 같은 글(`NIIMBOT_NEGOTIATE_TIMEOUT_MESSAGE` = "Unable to perform initial negotiate: Error: Timeout waiting response (waited for c2)")로 실패한다. 읽기: `requests`(고르기 창 횟수)·`connectAttempts`·`authorizedDevices`·`unansweredNegotiations`·`connected`·`printed`(받은 인쇄 — `image.rows`는 241). 바꾸기: `setUnansweredNegotiations(n)`·`setChooser`·`setAvailable`·`disconnect()`(프린터 쪽 끊김).
- 확인: `packages/printer/test/fb1-connect.test.ts`(22개 — AC-FB1-35·36·37, 무작위 예외 200개로 상세가 정해진 글뿐인지), 바뀐 기대값만 `b1.test.ts`·`marklife.test.ts`(줄마다 `// FB1 D-FB1-09`).

### 바뀐 공개 모양 — `@livejjim/documents` (운송장)

- `BOX_SIZES` = `['60','80','100','120','160']`, 새 `BOX_SIZE_NAMES`(`'80'` → `'80cm 이하'`), `LEGACY_BOX_SIZES`(극소→60·소→80·중→100·대→120), `boxSizeOf(value)`(코드 또는 옛 낱말 → 코드, 그 밖 `undefined` — 다듬기 없이 글자 그대로), 타입 `LegacyBoxWord`.
- `WaybillData.box`는 `BoxSize | LegacyBoxWord` — 옮기지 않은 옛 기록이 와도 새 낱말로 찍는다("상자 크기 80cm 이하"). 표 밖 값은 그 운송장만 `FORMAT`.
- `CARRIER_CODES` = `['FAKE','EPOST','CJ','HANJIN','LOGEN','LOTTE']`, `CARRIER_NAMES`: `EPOST` = `우체국택배`(전 "우체국 택배"), `CJ대한통운`·`한진택배`·`로젠택배`·`롯데택배`, `FAKE`는 그대로. `OTHER`(직접 입력)는 표에 없다(어댑터가 없어 운송장이 생기지 않음 — 오면 `FORMAT`).
- 운송장 골든(`tests/golden/waybill/*.json`)은 그대로. 확인: `packages/documents/test/fb1-waybill.test.ts`, 바뀐 기대값만 `waybill.test.ts`·`rn1.test.ts`(`// FB1 D-FB1-05`).

### 다음 영역에게

- **server**: `apps/server/src/parcel/rules.ts`의 `BOX_KINDS`·`DEFAULT_BOX`(지금 옛 낱말)를 새 코드로 바꿀 때 문서 패키지의 `BOX_SIZES`·`LEGACY_BOX_SIZES`·`boxSizeOf`를 써도 된다(골든 `parcel/box.json`과 같은 규칙 — 글자 그대로 비교, 옛 낱말 넷). 운송장에 넘기는 `box`는 지금 옛 낱말이어도 타입·출력 모두 된다(새 낱말로 찍힘) — 마이그레이션 뒤엔 새 코드. 택배사 이름은 `CARRIER_NAMES`와 같은 낱말(`carrier.ts`의 `CARRIER_LABELS` `EPOST: '우체국 택배'` → `우체국택배`). `CarrierCode`에 CJ·HANJIN·LOGEN·LOTTE가 생기면 운송장 쪽은 이미 받는다. 서버 `print.ts`의 프린터 코드 목록에 `CONNECT_FAILED`는 더하지 않아도 된다(연결 결과는 서버로 가지 않음).
- **web**:
  - 라벨 화면·시작 마법사의 연결 실패: `connectError.code === 'CONNECT_FAILED'`(또는 `DISCONNECTED`)면 "해볼 일" 목록. `error.action`은 두 코드 모두 `다시 연결`. `error.detail`은 있으면 그대로 보이면 된다(이미 쉬운 말). `LabelsPage.tsx`의 "자세히"는 지금처럼 `detail`이 있을 때만.
  - `PrintParts.tsx`가 `pause.reason === 'DISCONNECTED'`일 때만 `station.connectError`를 보이는데, 다시 연결이 `CONNECT_FAILED`로 실패해도 멈춤 까닭은 서버의 `DISCONNECTED` 그대로라 같은 자리에 나온다 — 해볼 일 목록도 그 자리에 붙이면 된다.
  - E2E(AC-FB1-40)용 시험 모드 연결: `createFakeNiimbotBluetooth`를 `createB1Adapter`에 꽂고(`printer-station.ts`의 `createAdapter` 옵션), 창에 `setUnansweredNegotiations(n)` 같은 손잡이를 내면 된다(지금 `window.livejjimTestPrinter`처럼). 실제 쉬는 시간은 1초(타이머 기본 `systemTimer`).
  - 화면의 오류 상자에 라틴 글자가 없게(AC-FB1-38): 이제 어댑터는 영어 상세를 내지 않는다. 남는 라틴 글자는 `B1`·`NIIMBOT`·`USB`·`Marklife`, 그리고 B1 `WRONG_MODEL`의 "모델: D110" 같은 모델 이름뿐.
- **domain**: 기존 적대 시험 `tests/adversarial/n1`·`p1`·`i1`·`pl1b`는 지금 그대로 통과한다(바꿀 기대값 없음 — 돌려 봄). `tests/adversarial/fb1/printer-detail.test.ts`는 `createB1Adapter`에 가짜 클라이언트(`connect`가 무작위 예외)·`createFakeNiimbotBluetooth`, `createMarklifeAdapter`에 `createFakeBluetooth`로 연결·출력 실패를 내면 된다. `detail` 허용: `undefined`·`TIMEOUT_DETAIL`·`RETRIED_TIMEOUT_DETAIL`·`/^모델: /`(B1 WRONG_MODEL만). AC-FB1-35 (a)의 `detail` = 첫 문장은 다시 잇지 않는 경우(USB, 환경의 `requestDevice`가 기기를 돌려주지 않는 시험 환경 — 예: `requestDevice: () => undefined`)다. B1 블루투스에서 기기를 골랐으면 (a)는 다시 잇기로 가고, 계속 시간 초과면 `RETRIED_TIMEOUT_DETAIL`이다(AC-FB1-36).
- **실기기 확인(HG-2)**: 실제 B1 + 윈도우 크롬에서 다시 잇기로 나아지는지, 어댑터가 직접 띄운 고르기 창(niimbluelib과 같은 거르기)에 B1이 그대로 보이는지는 사용자 확인.
