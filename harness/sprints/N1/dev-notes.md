# N1 개발 노트

## dev-device

### 만든 것
- **`packages/label`** — 새 크기 다섯·작은 템플릿·포장 크기 제한·작은 테스트 라벨·PDF/A4 가운데·크기 오류 문장 (L-1·L-4~L-7, D-N1-03).
  - 크기: `ALL_LABEL_SIZES`(템플릿 검사가 받는 전체 8개 — `50x30`·`50x20`·`50x40`·`50x15`·`50x50`·`tape12x40`·`tape15x30`·`tape15x50`), `LABEL_SIZES`는 B1 목록 그대로(`50x30`·`50x20`·`50x40` — I1 화면). `TAPE_LABEL_SIZES`·`SMALL_LABEL_SIZES`·`PACKING_LABEL_SIZES`, `isTapeSize`·`isSmallLabelSize`·`canMakePackingLabel`·`labelSizeName`(`50×30`·`테이프 12×40`), `TAPE_HEAD_DOTS`(96). `labelSizeInfo`는 `tape`·`small` 칸이 늘었고 테이프의 `widthMm`·`heightMm`는 읽는 방향(길이 × 테이프 폭)이다.
  - 작은 템플릿(작은 크기의 기본 상품 템플릿): 세 줄 — 번호(왼쪽)·가격·닉네임만 켬. 가게 이름(번호 줄)·날짜(번호 줄 오른쪽)·품종(가격 줄)은 끈 채 라벨 안에 상자가 있다(켜면 날짜는 겹치지 않고, 가게 이름·품종은 겹침 경고). 테이프는 줄 높이 30점·글자 24(최소 20), 50×15는 줄 높이 38점·글자 30(최소 20). 번호 9999·`99,999,999원`·`99,999 천원`이 가장 짧은 테이프(240점)에서도 20점 이상.
  - 50×50: 상품(판매자 샘플 배치)·포장(`perPage` 20) 기본 템플릿.
  - 포장은 높이 20mm 이상만: 작은 크기의 포장 템플릿은 `validateTemplate`이 `INVALID_TEMPLATE`(문제 `size` 하나 · `TEMPLATE_MESSAGES.packingSize`). 라벨 밖 검사는 이때도 50×40으로 해 문제가 `size` 하나만 나온다.
  - 크기 오류 문장: "쓸 수 없는 라벨 크기예요. 라벨 크기 목록에서 다시 골라 주세요."(템플릿 검사·테스트 라벨 같음).
  - 작은 테스트 라벨: `한글 확인: 가나다 똠햏`(`TEST_LABEL_SMALL_HANGUL`)·`0123456789 <YY.MM.DD>` 두 줄 + 네 변 테두리, 20점 이상(배치 항목 ID `check`·`digits`).
  - PDF·A4: 쪽·칸은 읽는 방향 크기, 그림은 가로·세로 가운데. 기존 세 크기는 높이가 같아 바이트가 그대로다(SHA-256으로 고정 — `test/sizes-n1.test.ts`).
  - 라벨 골든 테스트: 파일 4·사례 114(상품 68 = 50 + 18 · 포장 34 · 크기 12), ID `G-LBL-\d{3}`·`G-LBL-N1-\d{2}`, `template.size` 덮어쓰기(README 규칙 그대로 — 작은 크기 포장 사례는 50×30 기본 포장 템플릿의 `size`만 바꿈).
  - 이월(AC-N1-15): "렌더 속도 (AC-P1-16)"를 `test/render.perf.test.ts`로 옮겼다(30장 6초 기준 그대로). 같은 이유로 "1만 자 품종·닉네임" 시험의 5초 단언도 그 파일로 옮기고, 정확성 단언(방법 `truncated`·배치 검사)과 "30장이 모두 만들어지고 서로 다르다"는 `render.test.ts`에 남겼다(D-902).
- **`packages/printer`** — Marklife 9종·바우아토(실험적) (L-12, D-N1-02~08).
  - 프로필 표 `PRINTER_PROFILES`(B1 + Marklife 9 + 바우아토), `MARKLIFE_PROFILES`(기본 목록 — 표 순서, 바우아토 없음), `EXPERIMENTAL_PROFILES`(바우아토 하나), 낱개 상수 `MARKLIFE_P50`…`BAUATO_PPA2L`, `printerProfile(id)`, `profileForDeviceName(name, profiles)`, `labelSizesFor(profile)`. B1 프로필에도 열두 칸(`maker`·`protocol`·`rotate`·`sizes`·`fallbackApp`·`namePrefix: null` 등)을 더했다(기존 칸·값 그대로).
  - 작업 바이트 `buildPrintJob(profile, image, { density? })` → `{ ok, bytes }` / `{ ok:false, code }`(순수, 받은 그림을 바꾸지 않음). 방식(`protocol`)·돌림(`rotate`)·농도 표(`DENSITY_BYTES`)가 데이터로 정한다 — 모델 이름 분기 없음. `rotateClockwise`.
  - 압축 `zlibWindow1K`(창 1KiB zlib — CMF `28`, 고정 허프만, 되짚기 ≤ 762 = zlib deflate(windowBits 10)와 같은 범위). 새 의존성 없이 직접 썼다(브라우저·Node 같은 코드).
  - Marklife 어댑터 `createMarklifeAdapter(options)`(Web Bluetooth만), 오류 문장 `MARKLIFE_MESSAGES`, 까닭 `unsupportedReason(ua, maxTouchPoints)`·문장 `unsupportedMessage(reason, app)`, GATT 상수 `GATT_BUNDLES`·`MARKLIFE_OPTIONAL_SERVICES`·`uuid16`, 기본값 `MARKLIFE_DEFAULTS`.
  - 가짜 Web Bluetooth 기기 `createFakeBluetooth(options)`(시험·개발용, 제품 목록에 없음).
  - 프린터 골든 테스트 `test/golden.test.ts`: 파일 4·사례 84(작업 34·이름 24·프로필 11·브라우저 15) 고정, 형식 계약 검사(모르는 키·kind·겹친 id·`G-PRT-N1-\d{2}` 아닌 ID는 읽기 오류). `yxqRaster`는 머리·길이 칸·CMF 28·FLG·사전 비트·`node:zlib` 창 10으로 풀기·L바이트에서 끝남(마지막 한 바이트를 빼면 안 풀림)으로 본다.
  - 어댑터 계약 묶음(`contract.test.ts`)을 Marklife S2(YXQ)·P12(L11)에도 돌린다. 모델마다 다른 입력(맞는 그림·헤드보다 넓은 그림·농도 범위와 문장)만 묶음에 넘기도록 바꿨다 — B1·가짜 프린터의 단언은 그대로다. Marklife 묶음의 타이머는 30ms 같은 짧은 지연을 바로 돌리는 `PacedTimer`(정확한 간격은 `marklife.test.ts`가 `ManualTimer`로 본다).
- `apps/**`·`packages/core`·`documents`·`voice`·검증 파이프라인은 바꾸지 않았다. B1 어댑터 코드(`niimbot.ts`)도 그대로다.

### 통합 스프린트에 넘기는 공개 함수·타입 (AC-N1-63)

**프린터 (`@livejjim/printer`)**

| 하는 일 | 함수·상수 | 타입 |
|---|---|---|
| 프로필 표·목록 | `PRINTER_PROFILES` · `MARKLIFE_PROFILES`(기본) · `EXPERIMENTAL_PROFILES`(바우아토) · `B1_PROFILE`·`ENABLED_PROFILES`(그대로) · `MARKLIFE_P50`…`MARKLIFE_LP15`·`BAUATO_PPA2L` · `printerProfile(id)` · `labelSizesFor(profile)` · `PRINTER_PROTOCOLS` | `ModelProfile`(`id`·`maker`·`displayName`·`protocol`·`dpi`·`headDots`·`rotate`·`sizes`·`defaultSize`·`density: {min,max,default} \| null`·`experimental`·`fallbackApp`·`namePrefix`)·`PrinterProtocol`·`PrinterRotate`·`DensityRange` |
| 작업 바이트 | `buildPrintJob(profile, image, { density? })` → `{ ok:true, bytes }` / `{ ok:false, code: 'IMAGE_TOO_WIDE' \| 'INVALID_DENSITY' \| 'PRINT_FAILED' }` (B1 프로필은 RangeError — B1 바이트는 niimbluelib) · `DENSITY_BYTES` · `rotateClockwise` · `zlibWindow1K` | `JobResult`·`JobErrorCode` |
| 이름으로 고르기 | `profileForDeviceName(name, profiles)` → 프로필 / undefined (앞자리만 본다 — 대소문자 가림, 다듬지 않음, 앞자리 뒤의 끝 공백·길이는 보지 않음, D-N1-11) | |
| Marklife 어댑터 | `createMarklifeAdapter({ profiles?, environment?, timer?, printTimeoutMs?, packetIntervalMs?, maxPacketBytes?, creditWaitMs? })` → `PrinterAdapter` + `profile: ModelProfile`(연결한 기기의 프로필) + `bundle: 'A' \| 'C' \| null` · `bluetoothEnvironment()`(부를 때 navigator 읽음) · `MARKLIFE_DEFAULTS` | `MarklifeAdapter`·`MarklifeAdapterOptions`·`BluetoothEnvironment`·`BluetoothLike` 등 Web Bluetooth 모양 |
| 까닭·문장 | `unsupportedReason(userAgent, maxTouchPoints)` → `'IOS' \| 'IN_APP' \| 'OTHER'` · `unsupportedMessage(reason, app)` · `MARKLIFE_MESSAGES`(코드 → 문장, L-12 6) · `IN_APP_MARKERS` | `UnsupportedReason`·`MarklifeErrorCode` |
| 가짜 기기 | `createFakeBluetooth({ name?, bundle?: 'A' \| 'C' \| 'none', missingCharacteristics?, available?, hasAvailability?, chooser?: 'pick' \| 'cancel', respectFilters?, connectFails?, initialCredits?(기본 4, null = 안 보냄), creditsPerPacket?(기본 1), mtu?, ack?: 'send' \| 'none' \| 'hold' \| { delayMs } \| { bytes }, jobs?: { [n]: { ack?, disconnectAtPacket?, failWriteAtPacket?, stallWriteAtPacket? } }, protocol?, timer?, userAgent? })` → `bluetooth`(navigator.bluetooth 자리)·`environment`(어댑터 environment 자리)·`requests`·`packets`·`attempts`·`printed`·`connected`·`connectCount`·`notifying`·`disconnect({ notice? })`(notice false = 끊김 알림 없이 연결만 없앤다)·`sendNotify(bytes)`·`sendFlow(bytes)`·`releaseAck()`·`releaseStalledWrites()`·`stalledWrites`·`setJob(n, b)`·`setAvailable`·`setChooser`·`setConnectFails` · `fakeJobLength(protocol, bytes)` · `fakeJobStartAt(protocol, bytes, at)`('yes'·'no'·'maybe') | `FakeBluetooth`·`FakeBluetoothOptions`·`FakeAttempt`·`FakeAck`·`FakeJobBehavior` |
| 어댑터 계약 | `PrinterAdapter.profile`의 타입이 `AdapterProfile`(`displayName`·`dpi`·`headDots`·`density \| null`)로 넓어졌다 — B1·가짜 프린터는 그대로 `PrinterProfile`을 돌려준다 | `AdapterProfile` |

**라벨 (`@livejjim/label`)**: `ALL_LABEL_SIZES` · `TAPE_LABEL_SIZES` · `SMALL_LABEL_SIZES` · `PACKING_LABEL_SIZES` · `isTapeSize` · `isSmallLabelSize` · `canMakePackingLabel` · `labelSizeName` · `TAPE_HEAD_DOTS` · `NO_PACKING_TEMPLATE` · `TEMPLATE_MESSAGES.packingSize` · `TEST_LABEL_SMALL_HANGUL`. `LabelSizeId`는 8개 크기 전체로 넓어졌다(`LABEL_SIZES`의 원소 타입은 그대로 세 개). 프로필마다의 크기 목록은 프로필의 `sizes`다.

- **작은 크기의 기본 포장 템플릿은 없다 (AC-N1-12)**: `defaultTemplate('packing', <작은 크기>)`는 템플릿을 만들지 않고 `RangeError`(메시지 = `NO_PACKING_TEMPLATE` "이 크기에는 포장 라벨을 만들 수 없어요. 높이 20mm 이상인 라벨을 골라 주세요.")를 던진다. 부르는 쪽은 `canMakePackingLabel(size)`로 먼저 거르고, 화면은 포장 라벨의 크기 목록에 `PACKING_LABEL_SIZES ∩ 프로필의 sizes`만 보인다. 작은 크기만 쓰는 판매자(테이프·50×15)의 포장 라벨은 50×30 템플릿으로 그림 파일·PDF(L-6 — A4)로 낸다.

### 기본값 (AC-N1-63, `MARKLIFE_DEFAULTS`)
- **시간 초과 20초 = 진행이 멈춘 20초 (감사 뒤 뜻이 바뀜, D-N1-12)**: `printTimeoutMs` 기본 20,000은 그대로지만 "출력 시작부터 `AA`까지"가 아니다. 출력을 시작할 때와 조각 하나의 쓰기가 끝날 때마다(마지막 조각 포함) 20초를 새로 센다 — 보내는 중이면 쓰기가 끝나지 않은 채 20초, 모든 조각을 쓴 뒤면 마지막 쓰기가 끝나고 `AA` 없이 20초에 `TIMEOUT`. 출력 전체 시간의 상한은 없다. 부르는 쪽이 `printTimeoutMs`를 넘기면 그 값이 "진행 없이 기다리는 시간"이다. B1 어댑터·가짜 프린터의 `printTimeoutMs`(L-7)는 그대로 출력 시작부터다.
  - 예(AC-N1-45): 바우아토 50×50·MTU 23·크레딧 있음 → 조각 962개, 마지막 조각 28,830ms, `AA`가 없으면 48,830ms에 `TIMEOUT`. P12 테이프 12×40·크레딧 없음 → 조각 44개, 마지막 45,290ms, `AA`가 없으면 65,290ms.
  - 화면(통합 스프린트): 느린 기기의 큰 라벨은 "출력 중"이 오래 갈 수 있다(크레딧이 전혀 없고 MTU가 작으면 바우아토 50×50 한 장 ≈ 1 + 961 × 1.03 ≈ 991초 — D-N1-12 위험). 실패·두 장은 아니다. HG-5 10에서 모델별로 잰다.
- 조각 사이 30ms · 조각 90바이트 이하(MTU 알림 `02 lo hi`로 min(90, MTU − 3)까지 줄기만 함, MTU 3 이하 무시) · 크레딧 0에서 시작·상한 4 · 크레딧이 0이면 1초 기다린 뒤 하나.
- 크레딧이 전혀 오지 않으면 조각 간격은 30ms 쉼 + 1초 기다림 = 1.03초다(30ms 쉰 뒤 크레딧을 보고, 없으면 그때부터 1초). 첫 조각은 쉬지 않아 출력 시작 1초 뒤다. D-N1-13이 이 구현대로 정했다(코드 변경 없음 — `send()`의 `step`이 30ms 뒤 크레딧을 보고 0이면 `creditWaitMs`를 건다).
- `AA`는 이번 출력의 첫 조각 쓰기를 부르는 순간부터 센다. 끝 알림은 `AA` 한 바이트뿐이다(`55`·`AA 00` 같은 여러 바이트는 아니다).

### 화면이 바꿔야 할 곳 (통합 스프린트)
- 크기 목록: 지금 `LABEL_SIZES`(B1) → 출력 기기 프로필의 `sizes`(상품), 포장은 `sizes ∩ PACKING_LABEL_SIZES`. 크기 이름은 `labelSizeName`(지금 화면의 `size.replace('x','×')`는 테이프 ID에서 `tape12×40`이 된다).
- 농도: 지금 1~5 고정(`apps/web/src/lib/device.ts` DENSITY_MIN·MAX) → 프로필의 `density`(YXQ 1~3 기본 2, `null`이면 농도 고르기를 숨기고 `density`를 넘기지 않음 — 넘겨도 쓰지 않는다). 저장된 농도 4·5를 Marklife에 넘기면 `INVALID_DENSITY`다.
- 오류 문장: 지금 `PRINTER_MESSAGES[code]`로 문장을 찾는 곳(`apps/web/src/lib/print-words.ts` 등)은 어댑터가 돌려준 `error.message`를 써야 한다(Marklife는 `NOT_SELECTED`·`WRONG_MODEL`·`INVALID_DENSITY`·`UNSUPPORTED` 문장이 다르다). 끊김의 `action`(`다시 연결`)은 같다.
- 연결 마법사: 제조사·프로필 고르기 → `createB1Adapter()` 또는 `createMarklifeAdapter({ profiles })`. 바로 연결할 수 없으면(`availableMethods()`가 빈 목록) `unsupportedMessage(unsupportedReason(navigator.userAgent, navigator.maxTouchPoints), profile.fallbackApp)`와 그림 파일 저장 단추.
- **바우아토(실험적, AC-N1-55)**: 화면에 "실험적" 표시. 기본 경로 = 라벨 그림 파일(PNG — `encodeLabelPng`)을 Luck Jingle 앱으로 넘기기(공유·저장). 직접 출력은 판매자가 "실험적 직접 출력"을 고를 때만 `createMarklifeAdapter({ profiles: EXPERIMENTAL_PROFILES })`(또는 Marklife 목록과 합쳐서). HG-5에서 확인되면 프로필의 `experimental`을 끄고 기본 목록으로 옮긴다(표 한 줄).
- 서버: 출력 기기의 프로필 ID(`ModelProfile.id`)를 기록하고, 작업을 그 프로필의 크기 템플릿으로 그린다.
- B1 화면 문장(`PRINTER_MESSAGES`)은 그대로 두었다(I1 화면·E2E가 글자로 찾는다).

### 테스트·개발용 기동 방법
```ts
import { createFakeBluetooth, createMarklifeAdapter, systemTimer } from '@livejjim/printer'
const fake = createFakeBluetooth({ name: 'P12_FAKE01', timer: systemTimer })   // 테이프 프린터 흉내 (S2_… 면 YXQ)
const adapter = createMarklifeAdapter({ environment: () => fake.environment })
await adapter.connect('bluetooth')        // 기기 고르기 창 대신 가짜 기기를 바로 고른다
await adapter.print(image)                // fake.printed에 작업 바이트가 쌓인다
```
- 시험은 `ManualTimer`(packages/printer/test/fakes.ts)를 `timer`로 둘 다에 넣고 `timer.advance(ms)`로 돌린다. `decodeMarklifeJob(bytes, profile)`(같은 파일)이 받은 작업 바이트를 그림으로 되돌린다.
- 단위 시험: `pnpm --filter @livejjim/printer exec vitest run`, `pnpm --filter @livejjim/label exec vitest run --exclude '**/*.perf.test.*'`. 렌더 속도: `pnpm perf`.

### 의존성·라이선스 (AC-N1-61)
- **새 의존성 없음.** 창 1KiB zlib는 `packages/printer/src/deflate.ts`에 직접 썼다(RFC 1950·1951 — fflate·CompressionStream은 창 크기를 정할 수 없다).
- 프로토콜 사실(명령 바이트 순서·농도 값·GATT UUID·크레딧·`AA`·이름 꼴)의 출처: MIT 참고 구현 thermal-label/marklife의 공개 문서 — 스펙(LABEL_RULES L-12)이 옮긴 사실만 썼고 그 코드를 옮기지 않았다(파일 머리의 출처 표시 대상 없음). GPL 코드(LaBLEr·BleWebler)·제조사 SDK(marklife-label-printer-web-kit)는 보지도 쓰지도 않았다(소스 검사 시험 `source.test.ts`).

### 스펙에 올린 것 (disputesWithSpec)
(1·2는 감사 뒤 spec-keeper가 D-N1-11·D-N1-13으로 구현대로 정했다 — 닫힘.)
1. **AC-N1-72 "앞뒤 공백·아주 긴 이름은 어느 프로필도 고르지 않는다"와 L-12 3(이름 앞자리로 시작하면 그 프로필, 이름을 다듬지 않는다)이 갈리는 경우**: 뒤에만 공백이 있는 `P12_ZA15B `나 `P12_` + 아주 긴 글은 L-12 3대로면 P12다. 구현은 규칙 문장(우선순위가 높다)대로 고른다 — 앞 공백(` P12_…`)·앞자리와 다른 긴 이름은 고르지 않는다. 뒤 공백·긴 이름도 막아야 하면 spec-keeper가 L-12 3·골든에 한 줄을 더해 주면 `profileForDeviceName` 한 곳만 고친다.
2. **크레딧 없는 조각 간격**: L-12 4의 "조각 사이 30ms"와 "1초 동안 오지 않으면 하나"를 이어서(30ms 쉰 뒤 1초) 1.03초로 했다. "1초마다"를 정확히 1.00초로 보려면 규칙 문장에 적어 달라.
3. **`LabelSizeId`를 8개 크기로 넓혔다**(AC-N1-10 "크기 목록(템플릿 검사가 받는 전체)"). 이 때문에 P1 적대 시험 `tests/adversarial/p1/export-printer.test.ts` 20행의 `Record<LabelSizeId, number>`(세 크기만 적음)가 `pnpm typecheck`에서 TS2739로 실패한다 — 실행은 그대로 통과한다. 보호 경로라 고치지 않았다. **test-domain 요청**: 그 줄을 `const A4_PER_PAGE: Record<(typeof SIZES)[number], number>`처럼(또는 `Partial<Record<LabelSizeId, number>>`) 바꾸면 된다. `LabelSizeId`를 좁게 두면 대신 `apps/web`(`print-context.tsx`의 `renderTest` — 템플릿 크기를 `LabelSizeId` 인자로 넘김)가 타입 오류가 나 화면을 고쳐야 한다(이 스프린트는 apps 금지).

### 그 밖에 정한 것 (규칙 안에서)
- GATT 꾸러미 A는 `ff02`·`ff01`·`ff03`이 모두 있어야 쓴다. 하나라도 없으면 C를 보고, C도 없으면 끊고 `WRONG_MODEL`(그 사이 연결이 끊겼으면 `DISCONNECTED`). 알림 켜기(`startNotifications`)가 실패하면 연결 실패(`DISCONNECTED`).
- 이름이 켠 프로필과 맞지 않으면 GATT에 연결하지 않고(`gatt.disconnect()`만 부르고) `WRONG_MODEL`. 기술 상세에 기기 이름을 넣지 않는다.
- 쓰기 오류가 났는데 연결이 살아 있으면 `PRINT_FAILED`(상태 연결됨), 끊겨 있으면 `DISCONNECTED`.
- 출력이 끝나지 않았을 때(쓰기 거절·시간 초과) `gatt.connected`가 false면 끊김 알림(`gattserverdisconnected`)이 아직 안 왔어도 끊김으로 본다: 결과 `DISCONNECTED`, 연결을 내려놓고 상태도 `DISCONNECTED`(SA-N1-001). 그래서 `다시 연결`은 고르기 창부터 다시 열고, 다음 출력은 `BUSY`가 아니라 `NOT_CONNECTED`다. 20초가 지났을 때 연결이 이미 없으면 `TIMEOUT`이 아니라 `DISCONNECTED`다(L-12 5 '그 전에 연결이 끊기면').
- 출력 중 판매자가 연결 끊기를 누르면 그 출력은 `DISCONNECTED`.
- 작업 바이트의 거절 순서: 그림 형식(`PRINT_FAILED`) → 헤드 폭(`IMAGE_TOO_WIDE` — 농도와 상관없이 언제나, AC-N1-70) → 농도(`INVALID_DENSITY`). B1 어댑터(농도 → 형식 → 폭)와 순서가 다르다 — 둘 다 틀린 그림은 화면이 크기 목록·농도 범위로 미리 막는다.
- 가짜 기기는 작업을 다 받았는지를 래스터 머리(YXQ 길이 칸·L11 폭×높이)로 계산하고, 다 받은 그 쓰기 안에서 `AA`를 보낸다(마지막 쓰기가 끝나기 전에 오는 경우). 이름표에 없는 기기 이름이면 `protocol`을 알려 줘야 한다.
- 가짜 기기는 작업의 시작을 방식마다의 시작 바이트(머리 명령 전부 + 래스터 명령, 농도 자리는 아무 값 — YXQ 2 10바이트, YXQ 3·8 23바이트, L11 23바이트)로 알아본다(SA-N1-002). 어댑터가 작업 중간에 그만둔 시도는 다음 작업의 시작을 받으면 끝까지 받지 못한 시도로 닫고, 다음 출력은 새 시도로 센다(D-N1-12 뒤로 어댑터의 작업 중간 `TIMEOUT`은 쓰기 멈춤에서만 나고, 가짜 기기는 멈춘 그 자리에서 시도를 닫는다 — 시작 바이트 판단은 그 밖의 경우(직접 쓰기 등)를 위해 그대로 둔다). 어댑터와 따로 신호를 주고받지 않는다. 조각이 시작 바이트보다 짧으면(MTU 알림) 여러 조각에 걸쳐 본다 — 아직 가리지 못한 시작 후보가 작업 끝 안쪽에 있으면 `AA`를 미룬다(앞 작업 길이가 다음 작업 바이트로 채워져 거짓 `AA`가 나가지 않게). 방식마다 끝 바이트가 시작 바이트와 어긋나므로 작업 하나를 끝까지 받으면 후보는 늘 가려진다(단위 시험으로 고정).

### 감사 뒤 스펙 정리 반영 (2e189aa — D-N1-11~13)
- **D-N1-12 시간 초과 = 진행이 멈춘 20초**: `marklife.ts` `send()`가 출력을 시작할 때 진행 없음 타이머를 걸고, 조각 하나의 쓰기가 성공할 때마다(마지막 조각 포함) 앞의 타이머를 지우고 다시 건다. 시간 초과(또는 끊김) 뒤에 끝난 쓰기는 결과를 바꾸지 않고 다음 조각을 쓰지 않는다. 머리 주석·`MARKLIFE_DEFAULTS.printTimeoutMs` 주석을 고쳤다(값 20,000 그대로). B1 어댑터·가짜 프린터는 손대지 않았다.
- **가짜 기기 쓰기 멈춤** (L-12 7, AC-N1-50): `FakeJobBehavior.stallWriteAtPacket` — 그 작업의 n번째 쓰기 promise가 끝나지 않는다(연결은 그대로, 그 조각은 받지 않음, 그 작업은 그 자리에서 끝까지 받지 못한 시도로 닫힘 → 다음 출력은 새 시도). `releaseStalledWrites()`는 멈춘 쓰기를 성공으로 끝내고(조각은 여전히 받지 않은 것), 끊기면 멈춘 쓰기는 `NetworkError`로 거절된다. `stalledWrites`는 멈춰 있는 쓰기 수.
- **D-N1-11**: `profileForDeviceName` 주석만 "앞자리 뒤의 글은 보지 않는다"로 고쳤다(동작 그대로 — `startsWith`). 골든 테스트의 고정 수를 87(이름 27)로 바꿨다(G-PRT-N1-76~78).
- **D-N1-13**: 확인만 했다(위 기본값).
- 단위 시험(스펙 변경 D-N1-12를 따른 기대값 변경 — 약화 아님):
  - `marklife.test.ts`: 크레딧이 없으면 첫 조각 1,000ms, 그 뒤 조각마다 1,029ms엔 안 나가고 1,030ms에 나감 — 마지막 조각이 출력 시작 20초를 넘겨도 작업 끝까지 다 나가고 출력 OK(전에는 "20초에 TIMEOUT"). `AA`가 없으면 마지막 쓰기부터 20초에 TIMEOUT(조각이 많은 작업으로 출력 시작 20초와 갈리게). 미리 와 있던 `AA` 시험도 마지막 쓰기 기준. 작업 중간 TIMEOUT 뒤 새 시도 시험(SA-N1-002)은 크레딧 굶김 대신 5번째 쓰기 멈춤으로 만든다(24,090ms). **AC-N1-45 새 시험**: 바우아토 50×50·MTU 23(28,830ms OK / 48,830ms TIMEOUT, 48,829ms엔 출력 중), 100번째 쓰기 멈춤(22,940ms TIMEOUT, 그 뒤 쓰기가 끝나도 조각 99개 그대로, 다음 출력은 새 시도로 OK), P12 테이프 크레딧 없음(45,290ms 마지막 조각, OK / 65,290ms TIMEOUT). 숫자는 acceptance AC-N1-45와 같다(계산이 어긋난 곳 없음).
  - `contract.test.ts`: 시간 초과 장면에 `untilTimeoutStarts()`를 더했다 — B1·가짜 프린터는 출력 시작(기다릴 것 없음), Marklife는 작업을 끝까지 받은 뒤(마지막 쓰기)부터 `TIMEOUT_MS`를 잰다. 고치기 전에는 P12 묶음이 실패했다(조각이 시계를 돌리는 동안 나가 마지막 쓰기가 시간 초과를 다시 걸었다).
  - 옛 구현(출력 시작부터 20초)으로 되돌려 돌리면 위 marklife 시험 9개가 실패하는 것을 확인했다.
- **test-domain 몫(보호 경로, 손대지 않음)**: 시작부터 20초를 가정한 적대 시험(`tests/adversarial/n1/adapter-scenarios.test.ts`, `round0-findings.test.ts` TD-N1-002의 "크레딧 굶김 → 작업 중간 TIMEOUT")은 D-N1-12대로 새 규칙으로 고쳐야 한다 — 작업 중간 TIMEOUT은 `stallWriteAtPacket`(또는 자체 ble-mock의 쓰기 멈춤)으로 만든다.

### 수정 라운드 1
- SA-N1-001(TD-N1-001): `print()`가 끝나지 않은 출력(쓰기 거절·시간 초과)에서 연결이 없으면(`gatt.connected` false) `drop(link)` 뒤 `DISCONNECTED`를 돌려준다. 쓰기 오류 갈래와 한 갈래로 합쳤다.
- SA-N1-002(TD-N1-002): 가짜 기기가 시작 바이트로 새 작업을 알아본다(위 "그 밖에 정한 것").
- 단위 시험(packages/printer/test/marklife.test.ts): 쓰기 거절이 끊김 알림보다 먼저(결과·상태 DISCONNECTED, 다음 출력 NOT_CONNECTED, 다시 연결은 고르기 창 2번째), 조각을 다 쓴 뒤 조용히 끊긴 채 20초(DISCONNECTED), 작업 중간 TIMEOUT 뒤 다음 출력(새 시도·AA·OK), S2·P50·X2·P12·바우아토 × 조각 1·5·20·90바이트 × 빠진 바이트 1·3·9·40(앞 시도는 AA 없이 닫힘, 뒤 시도는 작업 바이트와 같음), 시작 바이트는 작업 안 다른 자리에서 늘 'no'.
- SA-N1-003(부하로 인한 서버·음성 시간 초과): 서버 두 파일은 이 스프린트가 바꾸지 않은 곳이라 부하가 낮을 때 verify를 다시 돌려 판정한다. 음성 시간 시험은 내 영역(`packages/voice/**`)이라 D-902대로 나눴다 — 걸린 시간만 재는 세 시험(p99 50ms 둘, 300글자 500ms)은 `packages/voice/test/extract.perf.test.ts`(pnpm perf), 같은 재료의 정확성 단언(사전 3,000개, 빨리 거른 결과 = 모두 계산한 결과)은 `extract-filter.test.ts`(게이트 안)에 남겼다. 고정 시드 사전·문장은 `test/sample-dictionary.ts`가 함께 준다. 시험 내용·기준값은 그대로다(부하 속에서 성능 파일만 돌리면 첫 번은 실패, 다시 돌리면 통과 — 거짓 실패를 확인했다).

### 수정 라운드 2
- SA-N1-007·GATE-N1-VERIFY(coverage 단계만 부하로 5초 시간 초과): 원인은 내 영역(`packages/label`·`packages/printer`·`packages/documents`·`packages/voice`) 밖이다. coverage 단계는 `packages/core/test/**`만 돌리고, 시간 제한이 빠진 곳은 루트 `vitest.coverage.config.ts`다. D-902(오케스트레이터 결정 "무거운 속성 시험은 시간 제한만 늘린다(코어 30초…)")가 `packages/core/vitest.config.ts`에만 들어가고 coverage 설정에는 빠졌다. 이 파일은 coverage 게이트의 기준값(라인·분기 95%)을 쥔 검증 게이트 설정이라 D-027대로 오케스트레이터 몫으로 보고 고치지 않았다. 다른 트랙(N2·N3·N5 등)도 같은 설정을 쓰므로 한 트랙 브랜치보다 main에서 한 번 고치는 편이 충돌이 없다.
- **오케스트레이터 요청**: `vitest.coverage.config.ts`의 `test`에 `testTimeout: 30_000`(코어 단위 설정과 같은 값, D-902)을 더한다. 기준값·include는 그대로 둔다 — 시험 내용·커버리지 기준은 약해지지 않고, 걸린 시간은 `pnpm perf`가 따로 잰다.
- 이번 라운드에 바꾼 코드는 없다(d7a3c16과 같은 코드).

### pnpm verify 결과 — 수정 라운드 2 (72291b3, `E2E_PORT_OFFSET=1000 pnpm verify`, load avg 15~72 — 다른 트랙 verify 동시 실행)
- 통과 5: typecheck(설정 15 · 파일 481) · lint(0/0) · golden(589) · adversarial(파일 50 · 테스트 899) · e2e(파일 42 · 265).
- 실패 2 — 모두 부하로 인한 시간 초과, 이 스프린트가 바꾸지 않은 곳:
  - test: `apps/server` 속성 시험 둘(`test/changes.test.ts` AC-S05-61, `test/chat-messages.test.ts` AC-S05-20)이 60초 제한에 걸렸다(load 72 순간). 바로 그 두 파일만 다시 돌리니 load 46~50에서도 통과(파일 2 · 테스트 15, 19초).
  - coverage: 위 "수정 라운드 2"의 원인 — `packages/core` 속성 시험·골든 어댑터 6건이 기본 5초에 걸렸다. `pnpm coverage`만 다시 돌려도 load 47에서 1건이 5초에 걸린다. 같은 설정에 D-902 값(`--testTimeout=30000`)만 붙이면 load 42~46에서 파일 37 · 테스트 1411 모두 통과, 라인 100% · 분기 99.66%.

### pnpm verify 결과 — 수정 라운드 1 (df0f71b, `E2E_PORT_OFFSET=1000 pnpm verify`)
- 통과 6: typecheck(설정 15 · 파일 481) · lint(0/0) · test(파일 137 · 테스트 3339) · golden(589) · adversarial(파일 50 · 테스트 899 — TD-N1-001·002 포함) · e2e(파일 42 · 265).
- 실패 1: coverage — 부하(load avg 30~44, 다른 트랙 동시 실행) 속에서 `packages/core` 속성 시험이 5초 제한에 걸렸다(코어 단위 설정은 D-902대로 30초인데 루트 `vitest.coverage.config.ts`에는 `testTimeout`이 없어 기본 5초). 이 스프린트는 코어·하네스 설정을 바꾸지 않았다. 부하가 내려간 뒤(load 17) `pnpm coverage`만 다시 돌리니 통과(테스트 1403 · 라인 100% · 분기 99.66%).

### pnpm verify 결과 (첫 개발 라운드, 74277ad 기준)
- 통과: lint · test(파일 137 · 테스트 3337) · golden(589) · e2e(파일 42 · 265) · coverage(라인 100% · 분기 99.66%).
- 실패 2 — 모두 같은 뿌리(위 "스펙에 올린 것" 3):
  - typecheck: `tests/adversarial/p1/export-printer.test.ts(20,7) TS2739` — `Record<LabelSizeId, number>`에 세 크기만 적은 P1 적대 시험(보호 경로, test-domain 몫). 한 줄 고치면 통과한다.
  - adversarial 1건: `tests/adversarial/s00/verify-gates.test.ts` TD-S00-015 "전제: 임시 저장소 복사본은 typecheck 단계를 통과한다" — 저장소 복사본(`tests/adversarial` 포함)의 typecheck가 위 오류로 실패하는 시험이다. 이번 실행은 기계 부하(load 20~70)로 90초 제한에 걸려 `code null`이었지만, 부하가 없어도 위 타입 오류 때문에 실패한다. 위 한 줄이 고쳐지면 같이 통과한다.
- 중간에 혼자 돌린 `pnpm test`에서는 기계 부하로 `apps/server` changes·schema 시간 초과와 `packages/voice/test/perf.test.ts` p99가 실패했지만, verify의 test 단계에서는 모두 통과했다(이 스프린트가 바꾸지 않은 곳).
