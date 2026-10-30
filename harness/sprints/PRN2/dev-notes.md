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
