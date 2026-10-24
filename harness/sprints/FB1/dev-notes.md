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

## server (dev-server)

### 바뀐 공개 모양 — 택배 (`apps/server/src/parcel/**`, AC-FB1-15·16·17)

- **`GET/PUT /api/parcels/settings` 응답 `settings`**:
  - `carrier`: `'EPOST' | 'CJ' | 'HANJIN' | 'LOGEN' | 'LOTTE' | 'OTHER' | 'FAKE' | null` (쓰는 택배사 — 모두 고를 수 있음, `FAKE`는 시험 모드만).
  - 새 칸 `carrierName: string | null` — 고른 택배사의 화면 이름(`우체국택배`·`CJ대한통운`·`한진택배`·`로젠택배`·`롯데택배`·`가짜 택배(시험용)`, `OTHER`면 판매자가 적은 이름, 고르지 않았으면 `null`).
  - `carriers`: 줄 모양이 **`{ code, name, autoBook }`** 로 바뀜(전 `available`·`note` 없어짐). 차례 `EPOST`·`CJ`·`HANJIN`·`LOGEN`·`LOTTE`·`OTHER`(`name` = `직접 입력`) + 시험 모드면 끝에 `FAKE`. `autoBook` = 이 서버에 그 택배사의 자동 접수 어댑터가 있음(지금은 시험 모드 `FAKE`만 `true`). `고르지 않음`은 화면 몫.
  - `box`: 새 코드 `'60' | '80' | '100' | '120' | '160'`(기본 `'80'`), `boxes` = `['60','80','100','120','160']`. 화면 낱말("80cm 이하")은 화면 몫(문서 패키지 `BOX_SIZE_NAMES`와 같은 낱말).
- **PUT 본문**: 새 키 `carrierName`. `carrier: 'OTHER'`면 `carrierName` 필요(다듬기 = `tidyText` — 앞뒤 공백 지우고 이어진 공백·전각 공백·제어 글자는 공백 하나, 코드 포인트 1~20자). 비거나 공백만·없음·글이 아님 → 400 `problems: [{ field: 'carrierName', message: '택배사 이름을 적어 주세요.' }]`, 21자 이상 → "택배사 이름은 20자까지 적어 주세요." — 그 요청은 아무것도 저장하지 않는다. 이미 `OTHER`면 `carrierName`만 보내도 이름만 바뀐다. `OTHER`가 아닌 코드와 온 `carrierName`은 버린다(저장·응답에 없음). 다른 택배사로 바꾸면 직접 입력 이름은 지운다. 그 밖의 `carrier` 값 → "택배사를 골라 주세요."(전처럼), `FAKE`는 시험 모드 밖에서 "가짜 택배는 시험 모드에서만 고를 수 있어요."(전처럼). `EPOST` "준비 중" 거절은 없어졌다(`PARCEL_MESSAGES.epostNotReady` 지움).
- **`box`(설정 저장·접수 `items[].box`)** 는 골든 `parcel/box.json` 함수 `readBox`로 읽는다(문서 패키지 `boxSizeOf`를 그대로 씀 — 한 벌). 새 코드 다섯 그대로, 옛 낱말 `극소`·`소`·`중`·`대` → `60`·`80`·`100`·`120`으로 옮겨 저장·접수, 그 밖은 400 "상자 크기를 골라 주세요."(접수는 아무것도 접수하지 않음). 응답·저장·택배사 어댑터가 받는 값은 늘 새 코드. 저장된 값에 옛 낱말이 남아 있으면 읽을 때 옮긴다(`storedBox`).
- **택배 화면 `GET /api/parcels/days/:date`의 `blocked.code`**: 새 코드 **`NO_AUTO_BOOK`** — 고른 택배사에 자동 접수 어댑터가 없음(`EPOST`·`CJ`·`HANJIN`·`LOGEN`·`LOTTE`·`OTHER`, 운영은 모두). 문장 "고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요." 접수 요청은 409 `PARCEL_BLOCKED`(같은 문장) — 택배사에 아무것도 보내지 않는다. 고르지 않았으면(또는 시험 모드 밖에 남은 `FAKE`) 전처럼 `NO_CARRIER` "택배사를 먼저 이어 주세요.". 차례: 택배사 없음 → 자동 접수 없음 → 보내는 사람 없음.
- **택배 화면 `carrier`**: `{ code: SettingsCarrier, name }` — `OTHER`면 `name`이 적은 이름.
- **택배사 이름 표**: `CARRIER_LABELS.EPOST` = `우체국택배`(전 "우체국 택배"), `CJ`·`HANJIN`·`LOGEN`·`LOTTE` 더함 — 운송장 `CARRIER_NAMES`와 같다. `CARRIER_CODES`(접수 기록에 오는 코드)는 어댑터를 둘 수 있는 여섯(`FAKE`·`EPOST`·`CJ`·`HANJIN`·`LOGEN`·`LOTTE`), 설정 쪽 타입은 `SettingsCarrier = CarrierCode | 'OTHER'`.
- **DB**: 마이그레이션 `0019_fb1_parcel_box_carrier.sql` — `parcel_settings.box`·`parcels.box`의 옛 낱말을 하나씩 옮김, `parcel_settings.box` 기본값 `'80'`, `parcel_settings.carrier_name text`(null 허용, `OTHER`일 때만 값). 지우는 것 없음. 직접 입력 이름은 로그에 남기지 않는다.
- 확인: `apps/server/test/fb1-parcel-settings.test.ts`(10개 — BASE 모양 DB에 0019 다시 적용, 0018까지 만든 빈 DB에 적용 포함), `t1-parcel-golden.test.ts`(box 종류·`G-PCL-FB1-` ID·파일 4·사례 74), 바뀐 기대값만 `t1-address`·`t1-book`·`t1-resume`(줄마다 `// FB1 D-FB1-0x`). `t1-book`의 "운영 기동" 시험은 D-FB1-04로 뜻이 바뀌어(우체국 고를 수 있음) 이름과 단언을 바꿨다.

### 바뀐 공개 모양 — 라벨 가게 이름 (`apps/server/src/print.ts`, AC-FB1-27)

- 서버가 템플릿을 내주는 곳(`servedTemplate` 한 곳)에서 템플릿 `shopName`을 L-2(`trimLabelText`)로 다듬어 빈 글이면 **그 판매자의 가게 이름**(설정 "가게", `sellers.name`)을 채운다(`fillShopName`). DB 본문·판(version)은 그대로.
  - `GET /api/print/templates`: `{ product|packing: { template(채운 것), version, storedShopName } }` — **새 칸 `storedShopName`** = 저장된 본문의 가게 이름 그대로(저장한 적 없으면 `''`).
  - `PUT /api/print/templates/:kind` 답: `template`은 조회와 같은 채운 모양, 새 칸 `storedShopName` = 방금 저장한 본문의 이름.
  - 출력 기기 `POST /api/print/claim`의 `job.template`도 채운 것(상품·포장). 포장 라벨 장 수 계산도 같은 템플릿.
  - 서버가 그리는 포장 라벨 그림(`/api/days/:date/packing-label.png`·`.pdf` — `closing.ts`)의 가게 이름 = 저장된 **포장** 템플릿 가게 이름, 비면 가게 이름(전에는 늘 가게 이름). `closing.ts`는 파일 경계 밖이지만 AC-FB1-27 "서버가 그리는 라벨 그림"이 이 한 줄이라 고쳤다(dev-server 영역 안).
  - `packages/label`·라벨 골든 diff 0줄. 확인: `apps/server/test/fb1-label-shop.test.ts`(7개 — (a)~(d) × 조회·작업·PNG, 가게 이름 바꾸기, 두 판매자), 바뀐 기대값만 `print-rules.test.ts`(AC-I1-14 기본 템플릿 조회 — `// FB1 D-FB1-07`).
- **라벨 가게 이름 원인(AC-FB1-29)**: 서버 쪽 원인은 혼동이었다 — 라벨 가게 이름은 템플릿 `shopName`(기본 빈 글, L-3 비면 안 찍음)이고 설정 "가게" 이름과 다른 값이라, 라벨 설정에 적지 않았거나 저장하지 않았으면 비어 찍히지 않았다. 템플릿에 적어 저장한 이름은 BASE에서도 조회·작업에 그대로 실려 나갔다(서버 버그는 찾지 못함). 단 BASE의 포장 라벨 PNG(서버 그림)는 템플릿 이름을 보지 않고 늘 설정 가게 이름이었다 — 이번에 템플릿 이름을 먼저 보게 했다. E2E가 실패하면 web의 미리 보기·저장 쪽을 먼저 본다.

### 다음 영역에게

- **web**:
  - `api/parcel-types.ts`: `CarrierCode`에 `CJ`·`HANJIN`·`LOGEN`·`LOTTE`·`OTHER`, `BoxKind` = `'60'|'80'|'100'|'120'|'160'`, 설정 `carrierName`, `carriers[]` = `{ code, name, autoBook }`, `blocked.code`에 `NO_AUTO_BOOK`.
  - 택배 설정: `직접 입력`이면 `{ carrier: 'OTHER', carrierName }`을 보낸다. 칸 문제는 `field: 'carrierName'`. 안내 "자동 접수는 아직 준비 중이에요…"는 고른 줄의 `autoBook === false`이거나 고르지 않았을 때.
  - 택배 화면: `blocked.code === 'NO_AUTO_BOOK'`이면 그 문장 + 설정 링크 + 접수 잠금(`NO_CARRIER`와 같은 자리).
  - 라벨 설정의 가게 이름 칸은 **`storedShopName`** 으로 채워야 한다(`template.shopName`은 채운 이름이라 그대로 칸에 넣고 저장하면 가게 이름이 템플릿에 굳는다). 저장 답도 `storedShopName`을 쓴다. 미리 보기는 `template`(채운 것) 그대로 그리면 출력과 같다. 저장할 때 보내는 `template.shopName`은 칸 값(빈 글 그대로).
- **domain**: 택배 크기 `readBox`(rules.ts)가 골든 함수 — 무작위 값은 이것과 같아야 한다. 마이그레이션 시험은 `fb1-parcel-settings.test.ts`의 "0018까지 만든 빈 DB" 방식(임시 폴더에 0000~0018만 두고 `migrate` → 행 넣고 `openPglite(pg)`)을 쓰면 된다. 어댑터 없는 택배사 접수 → `world.carrier.requests`에 `book` 0개. 라벨 두 판매자는 `/api/print/templates`·`/api/print/claim`·`packing-label.png`.
- **e2e**: 시험 모드 서버의 택배사 목록 끝에 `가짜 택배(시험용)`이 있다(전에는 맨 앞). `t1/flow.spec.ts`의 기본 상자 크기 낱말·값은 새 코드(`'80'` 등)로.
