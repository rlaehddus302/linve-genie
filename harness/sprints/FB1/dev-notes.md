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

## web (dev-web)

### 바뀐 공개 모양 — 화면 (`apps/web/**`)

- **설정 저장 막대 하나 (AC-FB1-22~25, D-FB1-06)**: `components/SaveBar.tsx`(`SaveBarArea`)·`lib/save-bar.ts`. 설정 화면 맨 아래 `region "저장"` 하나(`section aria-label="저장"`, `position: sticky; bottom: 0` — 휴대폰은 아래 메뉴 막대 위 `bottom: 3.3125rem`). 가게·판매 규칙·배송비·구매 감사 메시지(만들기)·택배 다섯 칸 안의 "저장" 단추는 없앴다(라벨 켜기/끄기·유튜브·크롬 확장·인스타그램·틱톡·AI 제안·보조자·로그인 방법은 그대로).
  - 막대 글: 바뀐 칸 없음 → "바꾼 칸이 없어요." + 잠긴 보통 버튼 "저장". 있음 → "저장하지 않은 칸: 판매 규칙 · 택배"(화면 순서 `가게`·`판매 규칙`·`배송비`·`구매 감사 메시지`·`택배`) + 주 버튼 "저장". 보내는 동안 버튼 이름이 "저장하는 중…"(잠김).
  - 요청 차례: `PUT /api/shop`(가게가 바뀌었을 때만) → `PATCH /api/settings` **하나**(판매 규칙·배송비·만들기의 바뀐 키만 — 세 칸이 이제 한 `useRuleForm`) → `PUT /api/parcels/settings`(택배가 바뀌었을 때만). 하나가 실패해도 다음 단계는 보낸다.
  - 성공: 막대 안 `role=status` "저장했어요." + (판매 규칙·만들기) " 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요." + (배송비) " 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요." — 바뀐 칸이 다 비워진 뒤에 보인다. 실패: 막대 안 `role=alert` "저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요."(그 칸이 아직 저장하지 않은 채일 때만), 칸 옆 서버 문장, 칸 밖 문장(연결 끊김 등)은 저장하지 못한 첫 칸 아래.
  - 칸마다 저장 문장(`SHOP_SAVED` 상자·`PARCEL_SETTINGS_SAVED` 상자·`SaveRow`)은 설정 화면에서 나오지 않는다. 시작 마법사의 저장 단추·문장은 그대로(`SAVED_SHIPPING_MESSAGE`만 "…오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요."로 — 설정 화면에서 옛 문장이 사라지게).
- **설정 문구 (AC-FB1-01·05~08)**: `lib/settings-fields.ts`에 칸 `lead`(칸 이름 아래 예시)·`hint`(선택지 아래 안내) — 가격 단위 `천원 (10 → 10,000원)`·`원 (10000 → 10,000원)` + 만원 안내, 여러 번호 `lead` "예: 채팅 '15 28'"·선택지 셋, 같은 1분 칸 이름, 배송비 칸 안내 `SHIPPING_HINT`, 판매 규칙 접는 단추 "상세 설정"(펼친 칸 맨 위 "잘 모르면 그대로 두세요."). 접힌 칸에 서버 문장이 있으면 저절로 펼친다.
- **감사 메시지 만들기 (AC-FB1-10·11)**: `ThanksSettings.tsx` `MakeFields` — `group "감사 메시지를 남길 곳"` 안 체크 두 줄(설명 한 줄씩), 영상 댓글 체크가 켜졌을 때만 `radiogroup "영상 댓글 방식"`(`판매마다 댓글`·`방송이 끝나고 요약 댓글 1개`). 끔 = `OFF`, 처음 켜면 `PER_SALE`, 껐다 켜면 마지막 방식. 묶는 시간 칸은 만들기 칸 안 "상세 설정"(접힘) — 늘 보이는 자동 묶음 안내, 저장값 > 0이면 접힘 밖 "지금은 N초 동안의 판매를 한 메시지로 묶어요." 설정 키·서버는 그대로. 두 "상세 설정" 단추는 각 칸(region) 안에서 찾으면 된다.
- **택배 (AC-FB1-19·20)**: `api/parcel-types.ts` — `CarrierCode`(FAKE·EPOST·CJ·HANJIN·LOGEN·LOTTE), `SettingsCarrier = CarrierCode | 'OTHER'`, `BoxKind = '60'|'80'|'100'|'120'|'160'`, 설정 `carrierName`·`carriers[] = { code, name, autoBook }`, 막힘 `NO_AUTO_BOOK`. `lib/parcel-words.ts` `BOX_KINDS`·`BOX_WORDS`·`boxWord`. 택배 설정: 택배사 고르기(잠긴 줄 없음 — 서버 목록 그대로 + 맨 앞 `고르지 않음`), `직접 입력`이면 칸 "택배사 이름", 고른 줄 `autoBook === false`이거나 고르지 않으면 "자동 접수는 아직 준비 중이에요. 지금은 포장 화면에서 송장번호를 직접 적어요.", "기본 택배 크기 (세 변의 합)" 다섯 낱말 + 안내. 택배 화면 줄마다 크기 칸 이름 **"택배 크기"**(전 "상자 크기"), 낱말 `80cm 이하`·값 `80`. `NO_AUTO_BOOK` 막힘은 `NO_CARRIER`와 같은 자리(문장 + "설정으로" 링크 + 접수 잠금 — 서버 문장 그대로).
- **라벨 가게 이름 (AC-FB1-28)**: `StoredTemplate.storedShopName?`. 라벨 설정 칸은 `storedShopName`(없으면 `template.shopName`)으로 채우고 저장 답도 그 값으로 — 서버가 채운 이름이 템플릿에 굳지 않는다. 미리 보기는 칸이 비면 저장된 이름이 빈 쪽의 서버 이름(= 설정 "가게" 이름)으로 그린다. 칸 아래 `SHOP_NAME_HINT`, `items.shop.visible === false`면 `SHOP_ITEM_OFF`. 테스트 인쇄는 서버가 내준(채운) 템플릿 이름을 그대로 쓴다.
- **간편 로그인 이동 (AC-FB1-31~33, D-FB1-08)**: `lib/leave-guard.ts` `ExternalLeaveContext`/`useExternalLeave()` = `{ confirm(): Promise<boolean>, allowUnload(): () => void }`(App이 준다 — 남은 값이 있으면 지금 떠나기 창 "다른 화면으로 갈까요?"를 띄우고 답을 돌려준다). `lib/google-return.ts` `goTopLevelWatched(url, onStuck, ms = LEAVE_STUCK_MS 5000)` — `pagehide`가 오면 그만 지켜본다. `LoginMethods`의 [연결하기]: confirm → (떠나기) `POST /api/auth/link` → `allowUnload` → 이동, 5초 안에 안 떠나면 버튼 되돌림 + `stuckMessage(p)` "카카오로 가지 못했어요. 다시 눌러 주세요."(alert) + 브라우저 확인 다시 켬. 로그인 화면 버튼·유튜브·인스타그램 연결은 바꾸지 않았다(범위 밖 — 유튜브는 맥북 쪽).
- **빠른 입력 (AC-FB1-02·03)**: `lib/quick.ts` `unitLine(unit)`·`registerPreview(text, settings, find)`(= `decideQuickInput`이 `register`일 때만)·`fixPricePreview(text, settings)`(= `parseAmount`). 콘솔 빠른 입력 도움말 아래 `p.quick-unit`(휴대폰에도 보임), 등록으로 읽히면 `p.quick-will-register role=status` "등록하면: 15번 엘레강스 10,000원", 고치기 칸 가격 옆 `span.fix-price` "= 15,000원". 그 방송 스냅샷의 `price.unit`.
- **프린터 연결 실패 (AC-FB1-38·39)**: `LabelsPage.tsx`의 `PrinterErrorView`(내보냄, 시작 마법사 `PrinterStep`도 같은 `PrinterSection`이라 같은 상자)에 `CONNECT_FAILED`·`DISCONNECTED`일 때 `list "해볼 일"`(`ol`, `lib/print-words.ts` `connectTips({ windows, serial, marklife? })` — ③ 윈도우(`isWindows()` = UA에 `Windows`), ④ 이 브라우저 연결 방법에 `serial`). "자세히"는 `detail`이 있을 때만 그대로. 출력 멈춤 띠(`PrintParts`)의 끊김 문장 옆에는 목록을 붙이지 않았다.
- **E2E 손잡이 — 가짜 B1 블루투스 (AC-FB1-40)**: 시험 모드의 `window.livejjimTestPrinter`에 더함 — `useFakeB1()`(이 기기의 실제 B1 어댑터를 `createFakeNiimbotBluetooth`를 꽂은 `createB1Adapter`로 바꾸고 연결 방법에 블루투스를 더한다 — 라벨 화면에 "블루투스로 연결" 단추가 생긴다), `setUnansweredNegotiations(n)`(꽂지 않았으면 꽂고 정한다), `fakeB1()` → `{ requests, connectAttempts, connected } | null`. 다시 잇기 쉼은 실제 1초. 시험 모드 서버(`testPrinter: true`)에서만 손잡이가 생긴다.

### 라벨 가게 이름 원인 (AC-FB1-29, web 쪽)
- 화면 쪽 원인은 혼동이었다: 라벨 설정 "가게 이름" 칸은 템플릿 `shopName`(기본 빈 글)이고, 비면 L-3으로 찍히지 않았다. 칸에 적고 저장한 이름은 BASE에서도 미리 보기·테스트 인쇄·출력 작업에 그대로 실렸다(화면 버그는 찾지 못함). 이번에 서버가 빈 이름을 채워 내주므로, 화면은 칸에 저장된 이름(`storedShopName`)만 넣고 미리 보기는 채운 이름으로 그린다.

### 남은 값이 없는데 묻던 원인 (AC-FB1-31)
- 네 상태(새 판매자·계좌와 보내는 사람과 직접 입력 택배사·옵션 판매와 무료배송 없음과 묶는 시간 30·로그인 정보와 다른 가게 이름) × 설정 화면의 모든 칸 묶음을 화면 시험으로 그려 봤고, 고치기 전 계산 방식 그대로도 "남은 값 있음"이 참이 되는 칸을 찾지 못했다. 시험자가 실제로 칸을 하나 고친 뒤였을 수 있다. 이번 고침으로 남은 값이 있어도 앱이 먼저 묻고, 떠나기로 하면 브라우저 확인은 다시 뜨지 않으며, 이동이 막히면 5초 뒤 버튼이 되돌아온다 — 멈춘 버튼은 생기지 않는다. 실제 윈도우 크롬 확인은 사용자 몫.

### 다음 영역에게

- **e2e**:
  - 설정 저장: `page.getByRole('region', { name: '저장' }).getByRole('button', { name: '저장' })`, 성공 문장은 그 막대 안 `getByText('저장했어요. …')`(위 문장 조합 — 배송비만 바꾸면 "저장했어요. 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요."). 판매 규칙 접는 단추는 판매 규칙 region 안 `button "상세 설정"`, 묶는 시간 칸은 구매 감사 메시지 region 안 `button "상세 설정"`을 편 뒤. 영상 댓글은 `checkbox "영상 댓글에 감사 메시지 남기기"` → `radio "판매마다 댓글"`(`"남기지 않음"` 라디오는 없다).
  - 택배: 설정 `combobox "기본 택배 크기 (세 변의 합)"` 값 `'80'` 등, 택배 화면 줄마다 `combobox "택배 크기"`. 직접 입력은 `combobox "택배사"`에서 `OTHER` → `textbox "택배사 이름"`.
  - 로그인 이동 막힘(AC-FB1-33)은 `page.route`로 승인 주소 요청을 멈춰 두면(응답하지 않음) 페이지가 떠나지 않아 5초 뒤 되돌림이 보인다 — 또는 `beforeunload` 확인에서 머무르기(`page.on('dialog', d => d.dismiss())`).
  - 가짜 B1: 라벨 화면을 연 뒤 `window.livejjimTestPrinter.useFakeB1()` + `setUnansweredNegotiations(2)` → "블루투스로 연결". 이 기기의 연결 방법 단추가 바뀌므로 `useFakeB1()`을 부른 뒤 단추를 찾는다.
- **domain**: 빠른 입력 미리 보기(AC-FB1-03)는 `apps/web/src/lib/quick.ts`의 `registerPreview`가 `decideQuickInput`과 같은 결과다(가격 = `parseQuickInput` 가격, 표시는 `formatWon`).
- **ux**: 막대의 성공 문장은 바뀐 칸이 없어진 뒤에만 보이고, 다음에 칸을 고치면 사라진다. "다시 연결" 단추는 보통 버튼(라벨 화면 주 버튼 하나 규칙 — AC-N4a-21)이다.

## core — 만원 단위 (AC-FB1-04 [core], D-FB1-11, R-14 3)

### 바뀐 공개 모양 (`@livejjim/core`)
- `SaleSettings['price.unit']`: `PriceUnit` = `'WON' | 'THOUSAND' | 'TEN_THOUSAND'`. 기본값 `THOUSAND` 그대로. `checkSettings`가 셋을 받고 다른 값은 지금처럼 `price.unit` 문제로 거절(판매 규칙 저장·백업 복구·방송 스냅샷 공용).
- 새 내보냄: `PRICE_UNITS`(`['WON','THOUSAND','TEN_THOUSAND']` — 화면 선택지 순서 원·천원·만원), `type PriceUnit`, `isPriceUnit(value: unknown): value is PriceUnit`.
- `parseAmount(text, { 'price.unit': 'TEN_THOUSAND' })`: 단위 없는 숫자가 1000 미만이면 ×10000(`15` → 150000, `1.5` → 15000, `0.0001` → 1), 1000 이상은 원 그대로, `원`·한글 단위는 설정 무시, 원 단위 소수가 남으면 `null`(`1.23456`). 자리 계산(`scaleDecimal`) — 부동소수점 곱셈 없음. `parseQuickInput(text, settings)`는 설정을 그대로 넘긴다(규칙 같음).
- 모르는 `price.unit` 값(검사를 건너뛴 값)이면 단위 없는 숫자는 `null`(추측하지 않음 — 예전엔 천원으로 읽었다). `원`·한글 단위 글은 그대로 읽는다. 저장·스냅샷은 `checkSettings`를 거치므로 보통은 생기지 않는다.
- 골든 계약 `price.unit` = `WON / THOUSAND / TEN_THOUSAND`.

### server에게 (남은 몫 — 지금 깨져 있음)
- `apps/server/src/product-import.ts` `ResolvedSettings.unit` 타입이 `'WON' | 'THOUSAND'`라 `pnpm typecheck`가 69행에서 실패하고, `resolve()`(63행)가 `TEN_THOUSAND`를 기본값 천원으로 바꿔 골든 `product-import.yaml` 만원 문서가 불일치 1(15 → 15,000, 1.5 → 1,500 — 10배 틀린 가격). 고칠 모양: `readonly unit: PriceUnit`, `const unit = isPriceUnit(unitValue) ? unitValue : DEFAULT_SETTINGS['price.unit']`. 이것이 들어오면 `pnpm golden` 불일치 0, core 시험 `core-adapter.test.ts`(합계 파일 39 · 파서 633 · 엔진 159 · 통과 792)·`product-import.test.ts`(27사례) 3건도 통과한다.

### web에게
- 단위 낱말·선택지는 `PRICE_UNITS` 순서로. 미리 보기는 지금처럼 `parseQuickInput`·`parseAmount`에 방송 스냅샷 설정을 넘기면 만원도 그대로 나온다(웹에서 따로 곱하지 않는다).

## web 수정 라운드 (TE-FB1-001 · SA-FB1-01 · U-FB1-01 · U-FB1-02)

- **휴대폰 고정 영역(UX-04)**: 휴대폰 폭(useWide 거짓)에서는 가격 단위 한 줄을 고정 영역(`.console-sticky`) 밖, 바로 아래(`QuickUnitLine`, `p.quick-unit.quick-unit-below`)에 그린다. 문장은 그대로(AC-FB1-02 — 문장 변경 없음, spec-keeper 거치지 않음). PC는 지금처럼 빠른 입력칸 아래 고정 영역 안. "등록하면: …"은 두 폭 모두 고정 영역 안(칸 가까이). 한 모양만 그린다(숨긴 사본 없음 — 단위 줄은 화면에 늘 하나).
  - 확인: E2E s06/layout·nav/phone-menu·i4/voice-layout·n2b2/layout·i3/youtube·fb1/console·fb1/settings 60개 통과(기대값 그대로). 단위 시험 `apps/web/test/fb1-quick.test.tsx` "휴대폰 고정 영역" 둘.
- **일부 실패 뒤 고칠 칸으로(U-FB1-02, UX-03)**: 저장 막대가 일부 실패를 받으면 실패한 칸 중 화면에서 첫 블록(`section.settings-section > h2` 이름)의 첫 `aria-invalid="true"` 칸으로 화면을 옮기고 포커스(접힌 "상세 설정" 안이면 편다). 빨간 칸이 없으면(네트워크 실패 등) 그 블록 제목(h2, tabIndex -1)으로. `apps/web/src/components/SaveBar.tsx` `focusFirstFailed`.
  - e2e에게: 일부 실패 뒤 `expect(page.getByLabel('대기 인원 (0이면 대기 없음)')).toBeFocused()`, 네트워크 실패면 `heading "배송비"`가 포커스.

## web 만원 단위·여러 번호 예시 (SA-FB1-02 — AC-FB1-01·02·04 [web], AC-FB1-07 D-FB1-12)

- **가격 단위 고르기**: 선택지는 코어 `PRICE_UNITS` 순서 `원 (15000 → 15,000원)`·`천원 (15 → 15,000원)`·`만원 (15 → 150,000원)`(값 `WON`·`THOUSAND`·`TEN_THOUSAND`, 처음 값은 코어 기본 천원). 안내 `PRICE_UNIT_HINT` = "'2만'·'15000원'처럼 단위를 붙여 적으면 이 설정과 상관없이 적힌 대로 들어가요."(옛 "만원 단위는 '2만'·'1.5만'처럼…" 없앰). 시작 마법사 2단계 요약도 같은 낱말(`valueWords`).
- **바꿀 때 확인 한 줄**: `settings-fields.ts` `fieldChangeNote(field, value, saved)`·`PRICE_UNIT_CHANGE` — 고른 값 ≠ 저장된 값이면 가격 단위 고르기 안 `p.warning role=note` 하나(AC-FB1-01 세 문장 그대로), 같거나 저장하면 없음. 창은 없다. `RuleField`에 `saved` 속성(설정 화면 기본 칸·마법사 칸이 넘김).
- **콘솔 단위 줄**: `unitLine('TEN_THOUSAND')` = "가격 단위: 만원 — 15는 150,000원, 5천은 5,000원"(전에는 천원 줄로 떨어졌다). 해석은 그대로 코어 `parseQuickInput`·`parseAmount`(웹이 곱하지 않음).
- **여러 번호 예시(D-FB1-12)**: `FieldDef.lead`(글 한 줄) → `leadChat { author, text }`. 고르기 바로 아래 `p.chat-example` = "예:" + `span.chat-example-author` "@홍길동"(회색, 1rem) + `span.chat-example-text` "132 475"(1.125rem 굵게). 선택지 `모두 주문 (132번·475번 둘 다 찜)`·`첫 번호만 주문 (132번만 찜)`·`주문으로 보지 않아요 (둘 다 찜 아님)`. 글자 크기는 16px 규칙(styles.node 시험) 때문에 글쓴이를 16px 아래로 내리지 않고 글을 키워 "작은 글씨"를 냈다.
- 시험: `apps/web/test/fb1-settings.test.tsx`(세 낱말·안내·옛 문장 없음·확인 문장 세 가지와 되돌리기/저장 뒤 없음·`TEN_THOUSAND` 저장·마법사 낱말·글쓴이/글 다른 요소), `fb1-quick.test.tsx`(만원 줄·미리 보기 150,000·15,000·5,000·Enter 가격 150000·고치기 칸 "= 140,000원", 무작위 대조 세 단위). 바뀐 낱말 고정값 `i3-lib.test.ts`·`wizard-app.test.tsx`(`// FB1 D-FB1-11`).
- **e2e에게(맞춰야 할 곳)**: `tests/e2e/fb1/support.ts` `UNIT_HINT`, `fb1/settings.spec.ts` 198·199·214·215·222행(옛 낱말·예시), `fb1/console.spec.ts` 112행 `'천원 (10 → 10,000원)'` → `'천원 (15 → 15,000원)'`, `i3/accounts.spec.ts` 112행 마법사 요약 `'가격 단위: 천원 (15 → 15,000원)'`. 예시는 `getByText('@홍길동')`·`getByText('132 475')`. 만원 콘솔·확인 문장 E2E(AC-FB1-90)는 새로.

## dev-server 고침 회차 (D-FB1-16·D-FB1-18 (g))
- 택배사 직접 입력 이름(`carrierName`)은 `apps/server/src/parcel/service.ts`에서 `@livejjim/label`의 `trimLabelText`(L-2)로 다듬는다. 서식 글자(`\p{Cf}`)는 지우고, 제어 글자·줄/문단 구분자는 공백으로. 다듬어 빈 글이면 400 "택배사 이름을 적어 주세요.", 20자는 다듬은 뒤 코드 포인트로 센다. 보내는 사람·고객 번호의 PC-2 `tidyText`는 그대로.
- 범위 문장 기대값만 새 문장으로: `apps/server/test/api.test.ts` 2줄, `apps/server/test/o2-options.test.ts` 1줄(`// FB1 D-FB1-18 (g)`).
