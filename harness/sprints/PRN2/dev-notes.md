# PRN2 개발 메모

## dev-device (2026-10-31)

### device → server·web 넘김

모두 `@livejjim/printer`(`packages/printer/src/index.ts`)에서 내보낸다. 순수 함수이고 앱(RN)·웹·서버가 같이 쓸 수 있다.

| 하는 일 | 이름 | 파일 |
|---|---|---|
| 켠 프로필 표 하나 (NIIMBOT 4 + Marklife 9 + 바우아토) | `PRINTER_PROFILES`, `printerProfile(id)` | `profiles.ts` |
| 프로필 ID → 라벨 설정 크기 목록 (모르면 B1 목록) | `labelSizesForProfileId(id)` | `profiles.ts` |
| 그 프로필이 이 크기를 찍는지 | `profileSupportsSize(id, size)` | `profiles.ts` |
| 크기 목록에 없는 템플릿의 `LABEL_ERROR` 문장 (L-11 13) | `sizeNotSupportedMessage(size)` | `profiles.ts` |
| 단계: `CONFIRMED`·`EXPERIMENTAL`·`IMAGE_ONLY` | `printerSupportStage(id)` | `profiles.ts` |
| 실험 안내 한 줄 (L-7 문장 그대로) | `experimentalNotice(profile)` | `profiles.ts` |
| 출력 기기가 서버에 알릴 프로필 ID (연결됨·출력 중일 때만, 아니면 null) | `connectedProfileId(adapter)`, `WebPrinterAdapter.profileId`, `PrinterPicker.profileId`(mobile-ble) | `profiles.ts`·`one-list.ts` |
| 고르기 목록 판정 (앱·웹 공용) | `pickListTarget(name, services)`, `pickListFilter()` | `profiles.ts` |
| 웹 한 목록 어댑터 (requestDevice 하나) | `createWebPrinterAdapter(options)`, `printerRequestOptions()` | `one-list.ts` |
| 끝 알림 판정 | `isEndNotice(protocol, value)` | `job.ts` |

사용 예:

```ts
import { connectedProfileId, labelSizesForProfileId, printerSupportStage, printerProfile, experimentalNotice, profileSupportsSize, sizeNotSupportedMessage } from '@livejjim/printer'

// 서버: 출력 기기 기록의 profileId(문자열 또는 null)로 라벨 설정 크기 목록
const sizes = labelSizesForProfileId(station.profileId) // 모르면 ['50x30','50x20','50x40']

// 웹·앱 출력 기기: 연결이 바뀔 때마다 알릴 값 (이름·기기 ID 없음)
const profileId = connectedProfileId(adapter) // 'NIIMBOT_B1' | 'BAUATO_PPA2L' | … | null

// 화면: 이름 뒤 "(실험)"과 안내 한 줄
if (printerSupportStage(profileId) === 'EXPERIMENTAL') notice = experimentalNotice(printerProfile(profileId)!)

// 출력 기기가 작업을 받았을 때: 템플릿 크기가 그 프로필 목록에 없으면 LABEL_ERROR로 멈춤
if (!profileSupportsSize(profileId, template.size)) stop('LABEL_ERROR', sizeNotSupportedMessage(template.size))
```

### dev-web에게 (apps/web·apps/mobile에서 바꿀 곳 — device는 고치지 않았다)

- **웹 한 목록**: `apps/web/src/lib/printer-station.ts`의 `createB1Adapter()`(635행 근처)를 `createWebPrinterAdapter()`로 바꾸면 requestDevice 하나(filters = NIIMBOT 서비스 + `B1-`·`B1_`… + L-12 앞자리, optionalServices ff00·fd00)로 NIIMBOT·Marklife·바우아토를 고른다. `RememberingPrinterAdapter`라 지금 코드 그대로 붙는다. 이은 프로필 ID는 `adapter.profileId`.
  - `createB1Adapter()`도 이제 켠 NIIMBOT 4종(B1·B1 SE·B21·D110)을 받는다(D-PRN2-05). 웹에서 L-12 프린터를 쓰려면 위 어댑터가 필요하다.
- **문장 바뀜 (D-PRN2-05)**: `PRINTER_MESSAGES.NOT_SELECTED`가 "…목록에서 프린터를 골라 주세요."로, `WRONG_MODEL`이 그림 파일 경로 문장으로 바뀌었다. `apps/web/test/labels-page.test.tsx:262`이 옛 문장을 기대한다.
- **앱 숨김 스위치 없애기 (D-PRN2-08, AC-PRN2-07)**: `apps/mobile/src/native/production.tsx`의 `SHOW_EXPERIMENTAL_PRINTERS`·`enabledFamilies(…)`를 지우고 `createPrinterPicker({ transport, pickDevice })`(기본 계열 = `defaultPrinterFamilies()`)를 쓴다. `enabledFamilies`는 deprecated로 남겨 두었고 이제 모든 계열을 돌려준다(둘째 인자 무시) — 고치기 전에도 앱은 실험 기종을 숨기지 않는다.
- **앱 목록 줄**: `PickEntry.detail`에 L-12 실험 기종이면 "실험"이 들어간다(`Marklife P50 · 실험 · 신호 강함`). `PickEntry.experimental`도 있다. NIIMBOT 줄은 표시 없음(L-7). 이름 없는 NIIMBOT 광고 기기는 `이름 없는 프린터 (끝자리 ABCD)`.
- **시험용 프린터**: `createFakePrinter({ profile: printerProfile('BAUATO_PPA2L') })`처럼 켠 표의 어느 줄이든 흉내 낸다(E2E 실험 표시·크기 목록용).
- 앱 `PrinterPicker.profileId`가 출력 기기가 알릴 값이다.

### test-domain·test-e2e에게

- `EXPERIMENTAL_PROFILES`는 없어졌다(D-PRN2-01). `tests/adversarial/n1/{adapter-scenarios,names-browser,timeout-progress}.test.ts`가 쓴다 — `[BAUATO_PPA2L]` 또는 `LABEL_PROFILES`(Marklife 9 + 바우아토)로. Marklife 어댑터 기본 목록에 PPA2가 들어갔다.
- 바우아토 바이트가 Luck Jingle 순서다(D-PRN2-02) — `tests/adversarial/n1/job-bytes.test.ts`·`timeout-progress.test.ts` 중 L11 모양(19,233바이트 등)을 기대하는 곳.
- `tests/e2e/i1/attacks.spec.ts:131`이 옛 `NOT_SELECTED` 문장을 기대한다.
- 가짜 기기: `createFakeBluetooth({ ack: 'ok' })`(4F 4B 끝 알림), `missingCharacteristics: ['ff03']`(흐름 제어 없는 꾸러미 A). Swift 가짜 프린터 `--mode bauato --ack-ok --no-flow`.

### spec-keeper에게: AUTO 결정 제안

1. **대소문자만 다른 L-12 이름 + NIIMBOT 서비스** (예 `p50_lower`): L-7 고르기 목록 1이 "글자 그대로"라 1에 안 걸리고 2(서비스)로 NIIMBOT 목록에 든다. N1 앱은 이런 이름을 목록에서 뺐다. 스펙대로 구현했다 — 이은 뒤 모델 정보로 `WRONG_MODEL`이 되어 안전하다. 골든 list에 사례 하나 더하기를 제안.
2. **이름 없는 NIIMBOT 광고 기기의 앱 목록 이름**: 골든 G-PRT-PRN2-25대로 목록에 넣고 `이름 없는 프린터 (끝자리 XXXX)`로 보인다(문장 확인 제안).
3. **웹 L-12 프린터의 기억**: 웹 L-12 어댑터는 기억이 없다(L-7 QS1). 한 목록 어댑터에서 L-12 프린터가 마지막으로 이어지면 NIIMBOT 기억을 지운다(기억 = 마지막으로 연결에 성공한 프린터) — 그래서 웹에서 L-12 프린터는 저절로 다시 잇기를 하지 않고 "다시 연결"은 고르기 창부터다. 판매자에게 엉뚱한 프린터로 다시 잇지 않는 쪽.
4. **웹에서 고른 기기의 이름이 L-12도 NIIMBOT 이름 꼴도 아닐 때**(서비스 필터로만 보인 기기): 웹은 고른 기기의 광고 서비스를 모른다 → NIIMBOT 어댑터로 잇는다(모델 확인으로 거른다).
5. **웹 `optionalServices`**: 스펙대로 ff00·fd00만 둔다. NIIMBOT 서비스는 `filters`의 services에 있어 Web Bluetooth 허용 서비스(모든 filter의 services + optionalServices 합)에 든다고 보았다 — 이름으로만 보인 B1(`B1-…`, 서비스 광고 없음)에서 niimbluelib이 서비스를 못 여는지는 실기기 확인(HG-5) 대상. 안 되면 `optionalServices`에 NIIMBOT 서비스를 더하는 것이 안전하다.
6. **D110 폭 검사**: left 방향은 받은 그림의 높이(+ 마지막 흰 줄, D110은 0)를 헤드 96점과 견준다 — 50×30 그림(높이 240)은 `IMAGE_TOO_WIDE`.
7. **시험용 프린터의 농도 기록**: 농도가 없는 프로필(L-12 테이프·바우아토)은 받은 농도를 쓰지 않고 기록 0.

### 실물·외부 (최종 보고에 모을 것)

- HG-5: 바우아토 Luck Jingle 바이트·`OK` 끝 알림, NIIMBOT B1 SE·B21·D110, Marklife 9종 실기기 확인 — 모두 실험으로 둔다.
- 실제 B1이 광고하는 이름 꼴(`B1-…`인지)·서비스 광고 여부는 미확인 — 이름도 서비스도 맞지 않으면 목록에 안 보인다(HG-5에서 확인).

## dev-server (2026-10-31)

### server → web·mobile·test-e2e 넘김 (바뀐 계약)

- **프린터 프로필 알림** (AC-PRN2-08, L-11 10): `POST /api/print/device`·`POST /api/print/device/state`에 `profileId` 칸을 더했다(없어도 된다 — 이전 화면 그대로 동작).
  - 값: `connectedProfileId(adapter)`의 결과(`'NIIMBOT_B1'` 등) 또는 `null`. 칸 없음·`null`·표(`PRINTER_PROFILES`)에 없는 글 → 모름(null)으로 기록, 400이 아니다. 글도 null도 아니면(숫자·배열 등) 400 `INVALID_INPUT` `problems[0].field = 'profileId'`(받은 값은 되돌리지 않음).
  - 알릴 때마다 그 값으로 **덮어쓴다**: 프린터를 이었거나 바꿨으면 `state { connected: true, profileId }`, `"이 기기에서 출력"`도 `profileId`를 같이. 칸을 빼면 모름이 된다(앞 값을 이어 두지 않는다). `connected: false`·출력 그만하기·출력 기기 바꾸기·`DISCONNECTED` 결과면 서버가 지운다.
  - 서버 기록은 `print_queues.printer_profile_id` 하나뿐(프린터 이름·기기 ID·주소 없음). 로그에 남기지 않는다.
- **크기 목록**: `QueueSummary`(`GET /api/print`의 `queue`, 기기 알림·등록 응답의 `queue`, 실시간 푸시의 `queue`)에
  - `queue.device.profileId: string | null`
  - `queue.labelSizes: string[]` — 라벨 설정 크기 고르기 목록(첫째가 기본). 출력 기기·프로필을 모르면 `['50x30','50x20','50x40']`. 서버가 `labelSizesForProfileId`로 정하니 웹은 이 값을 그대로 쓰면 된다.
  - 저장된 템플릿 크기가 이 목록에 없어도 `PUT /api/print/templates/*`·받기는 막지 않는다(D-PRN2-07). 출력 기기가 `INVALID_TEMPLATE`(item `size`)로 알리면 라벨 오류 멈춤이다(지금 웹 코드 그대로 — 서버는 이 코드를 받는다).
- **그림 파일** (AC-PRN2-09, L-11 17): `GET /api/print/jobs/:id/png?device=&attempt=`, `GET /api/print/test-png`.
  - `Content-Type: image/png`, `Cache-Control: no-store`. 바이트 = `encodeLabelPng(같은 비트맵)`(`@livejjim/label` — 웹 `pngBytes`와 같은 인코더).
  - 검사·오류는 `/bitmap`·`/test-bitmap`와 같은 함수: 로그인 없음 401, 다른 판매자·기기·작업·끝난 시도·바뀐 출력 기기 404, `device`·`attempt` 모양이 틀리면 400(같은 본문). 그리기 실패는 422 `LABEL_INVALID`(JSON).
- 서버가 `@livejjim/printer`에 의존한다(프로필 표만 씀). 마이그레이션 `0030_prn2_printer_profile`(빈 칸 하나 더하기 — 되돌리기 쉬움).

### spec-keeper에게: AUTO 결정 제안 (dev-server)

1. **표에 없는 프로필 ID는 거절하지 않고 모름으로 기록**: 연결 알림이 400이면 출력 기기의 끊김 멈춤이 안 풀려 출력이 멈춘다. 새 앱(표가 더 큰)이 이전 서버에 알려도 출력은 이어지고 크기 목록만 B1이 되는 쪽이 안전하다. 글이 아닌 값만 400.
2. **칸이 빠진 알림은 앞 값을 잇지 않고 모름**: 이전 화면과 섞여도 다른 프린터의 크기 목록이 남지 않게(테이프 목록이 남아 B1에 50×30을 못 고르는 일 방지). L-11 10 "끊으면 없음"에 맞춰 끊김·출력 그만하기·출력 기기 바꾸기·`DISCONNECTED` 결과도 지운다.
3. **크기 목록을 서버가 계산해 `queue.labelSizes`로 낸다**: 웹·앱이 표를 따로 들고 있어 판이 다를 때도 같은 목록이 보인다.

## dev-web (2026-10-31)

### 바뀐 것 (웹 apps/web · 앱 apps/mobile)

- 웹 실제 프린터 = `createWebPrinterAdapter()`(requestDevice 하나). 시험 모드 가짜 B1(`useFakeB1`)도 같은 한 목록 어댑터에 꽂는다.
- 웹·앱 모두: 연결 알림 `POST /api/print/device/state`와 `POST /api/print/device`에 `profileId`(이었고 알 때만 — 모르면 칸을 뺀다). 라벨 설정 크기 목록 = `queue.labelSizes`(없으면 `queue.device.profileId`로 `labelSizesForProfileId`, 모르면 B1). 받은 작업의 `template.size`가 이은 프린터 목록에 없으면 그리지·보내지 않고 결과 `{ ok: false, error: { code: 'INVALID_TEMPLATE', item: 'size' } }` + 화면 문장 `sizeNotSupportedMessage`.
- 앱: 숨김 스위치 제거, 고르기 목록 실험 줄 "실험" 꼬리표, "제조사 앱으로 보내기" = `GET /api/print/test-png` 바이트 그대로 공유 창(`fetchJobPng`도 있음).
- 농도: 웹 농도 칸은 이은 프린터 범위(YXQ 1~3, 테이프·바우아토는 칸 없음). 고른 농도가 그 범위 밖이면 보내지 않아 프린터 기본값.

### test-e2e에게 (선택자·문장·가짜 프린터)

- 시험용 프린터가 실험 기종 흉내: 라벨 화면을 연 뒤 `window.livejjimTestPrinter.setTestProfile('BAUATO_PPA2L')`(또는 `MARKLIFE_P50`·`NIIMBOT_D110` 등 켠 표의 ID, `null` = B1) → "시험용 프린터 — 실제로 출력되지 않아요". 표에 없는 ID는 `false`. 이어져 있으면 먼저 끊는다.
- 프린터 칸(region "프린터"): `프린터 이름: ` + 굵은 글 `바우아토 스티코팝 (실험)` / `NIIMBOT B1`(확인됨, "(실험)" 없음). 안내 상자 `role=note` 이름 "실험 중인 프린터 안내" — 글 = `experimentalNotice`(L-7 그대로), 안에 링크 "그림 파일로 저장하기"(#label-export, 마법사 안에서는 없음).
- 실험 기종 연결 뒤 "이 기기에서 출력" 대신 힌트 `실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.` → "테스트 인쇄" → group "테스트 인쇄 결과"의 버튼 **"예"**(스펙 글은 "네" — 아래 제안 1) → "이 기기에서 출력"(주 버튼). 끊었다 다시 이으면 처음부터.
- 연결 전 한 줄(블루투스·USB가 있는 브라우저): `NIIMBOT B1이 아닌 프린터(Marklife·바우아토·NIIMBOT 다른 모델)는 실험 중이에요. 연결한 뒤 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요.` 연결 중 문장은 `연결하는 중… 브라우저 창에서 프린터를 골라 주세요.`(옛 "(B1)" 없앰).
- 라벨 설정 크기: 라디오 이름 `50×30mm`·`테이프 12×40mm` 꼴(테이프는 "테이프 " 붙음). 저장된 크기가 출력 기기 프로필 목록에 없으면 `role=note` "라벨 크기 경고" = L-11 13 문장. 포장 크기가 없으면(테이프 프린터) `이 프린터로는 포장 라벨을 찍을 수 없어요. 포장 라벨은 아래 내보내기에서 그림 파일이나 A4로 내 주세요.`
- `tests/e2e/i1/attacks.spec.ts:131` 옛 NOT_SELECTED 문장 → `프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.` device/state 본문을 정확히 비교하는 E2E가 있으면 `profileId: 'NIIMBOT_B1'`(시험용 B1)이 더해진다.

### dev-server에게

- 테스트 라벨 크기(L-7 "연결 마법사는 이은 프린터 프로필의 기본 크기를 넘긴다"): `/api/print/test-bitmap`·`/test-png`가 크기를 받지 않아 웹·앱은 크기를 보내지 않는다. 테이프·D110에서는 50×30 테스트 그림이 `IMAGE_TOO_WIDE`가 된다. `?size=<프로필 defaultSize>`를 받아 주면 웹·앱이 넘기겠다(지금 웹 단위 시험 몇 개가 경로를 `$`로 끝맺어 질의가 붙으면 같이 고친다).

### spec-keeper에게: AUTO 결정 제안 (dev-web)

1. **테스트 결과 단추 글 "예"**: L-7·SPEC은 "네"라 쓰지만 I1부터 화면·E2E가 "예"다. 판매자 혼란 없게 기존 "예" 그대로 두었다 — 스펙 글을 "예"로 맞추기를 제안.
2. **"예"를 기억하는 단위 = 그 연결**: L-7 "그 연결에서"대로 끊김·다시 잇는 중(저절로 다시 잇기 포함)이면 지운다. 기기·프로필 단위로 오래 기억하는 것보다 안전(용지·전원이 바뀌었을 수 있다). 이미 출력 기기가 된 뒤의 저절로 다시 잇기는 "이 기기에서 출력"을 다시 누르지 않으므로 출력은 그대로 이어진다.
3. **출력 기기가 먼저 된 뒤 실험 프린터를 잇는 경우**: L-7은 "실험 기종이 연결된 기기에서 이 기기에서 출력"만 막는다 — 이미 출력 기기면 테스트 없이 찍힌다. 막을지(예: 테스트 "예" 전 받기 멈춤) 결정 제안. 지금은 스펙 그대로 막지 않았다.
4. **웹 고르기 창 앞 실험 안내 문장**과 **포장 크기가 없는 프린터 안내 문장**(위 test-e2e 절)은 dev-web이 지었다 — 문장 확인 제안.
5. **라벨 설정 크기 경고**: 저장된 크기가 출력 기기 프로필 목록에 없으면 설정 화면에도 L-11 13 문장을 경고로 보인다(출력 기기 프로필을 알 때만 — 모를 때 B1 기준으로 경고하면 틀릴 수 있다).
6. **고른 농도가 프린터 범위 밖**(B1에서 4·5를 고른 뒤 Marklife YXQ 연결): `INVALID_DENSITY`로 멈추지 않고 농도를 보내지 않아 프린터 기본값으로 찍는다(화면은 그 범위 안에서만 고르게 한다 — L-7).
7. **앱의 작업 라벨 그림 파일 공유**: `GET /api/print/jobs/:id/png`는 출력 기기가 받은(claim) 시도에만 열린다. 앱이 작업 라벨을 제조사 앱으로 넘기는 흐름(받기 → PNG 공유 → 결과를 무엇으로 알릴지)은 화면 결정이 필요해 이번엔 테스트 라벨 공유와 받기 함수(`fetchJobPng`)만 두었다. 앱 `src/lib/label-png.ts`(앱이 PNG를 만들던 것)는 이제 쓰지 않는다 — 지울지 결정 제안(그 시험이 남아 있어 두었다).
