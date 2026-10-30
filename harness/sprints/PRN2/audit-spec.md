# PRN2 스펙 감사 (spec-auditor)

- 범위: `d605751c..HEAD`(45b218e5), BASE `6024ea1b`. 수용 기준 AC-PRN2-01~11, D-PRN2-01~26, LABEL_RULES L-1·L-7·L-11 10·13·17·L-12, SPEC PRT-01·PRT-02, 골든 `tests/golden/printer/*`.
- 전체 `pnpm verify`는 돌리지 않음(오케스트레이터 몫). 부하 6.2에서 아래만 돌림.

## 1. 게이트

| 검사 | 결과 |
|---|---|
| `node scripts/harness/check-protected.mjs d605751c` | **실패 2건**: `9988f420 [spec] 권한 밖 수정: harness/sprints/PRN2/decisions-for-dev.md`, 커밋 안 된 변경(`tests/e2e/i1/attacks.spec.ts`, `tests/e2e/prn2/` — test-e2e 작업 중) |
| `check-protected.mjs $(cat BASE)` | 실패 5건: 위 2건 + `3ac9eead [spec] harness/backlog.yaml`, `74ff8727`·`0f45bf2a [dev:web] harness/sprints/INV1/dev-notes-web.md`(INV1 합치기에서 들어온 것, PRN2 밖) |
| 커밋 접두어 | d605751c 뒤 19개 모두 `[spec]`·`[dev:device|server|web]`·`[test:domain]` 형식 맞음 |
| 골든 무결성 | `tests/golden/printer/*` 변경은 `0baef045 [spec]`(PRN2 WIP) 하나뿐, D-PRN2-01~05 근거. dev·test 커밋의 골든 변경 없음 |
| 미구현 허용 목록 | `known-unimplemented.yaml`에 프린터 골든 없음(프린터 골든은 패키지 단위 시험이 전부 돌림) |
| 실행한 시험 | `vitest --config vitest.adversarial.config.ts tests/adversarial/prn2` 4파일 237 통과 · `packages/printer test/prn2+golden` 163 통과 · `packages/mobile-ble test/prn2+families` 41 통과 |

## 2. 추적성

| 기준 | 구현 | 시험 | 판정 |
|---|---|---|---|
| AC-PRN2-01 프로필 표·단계 | `packages/printer/src/profiles.ts`(PRINTER_PROFILES, `printerSupportStage` :256) | `packages/printer/test/golden.test.ts:303-312`(사례 130·B1만 확인됨), `tests/adversarial/prn2/golden-both.test.ts:140-160` | 충족 |
| AC-PRN2-02 바우아토 Luck Jingle 바이트 | `packages/printer/src/job.ts:164-169` | golden job 36건(웹·앱 두 어댑터 바이트 비교 `golden-both.test.ts:295`), `n1/timeout-progress` 19,236바이트 | 충족 |
| AC-PRN2-03 끝 알림 | `job.ts` `EXTRA_END_NOTICES`·`isEndNotice`, `marklife.ts`·`mobile-ble/src/marklife.ts` | golden end 14건 두 길(`golden-both.test.ts:315`), `device-bounds.test.ts`(ff03 없는 꾸러미 A, 쪼개진 4F/4B) | 충족 (TD-PRN2-001은 스펙 질문) |
| AC-PRN2-04 고르기 목록·같은 함수 | 판정 `profiles.ts` `pickListTarget`/`pickListFilter` 하나. 웹 `one-list.ts:33-44,186-188`, 앱 `mobile-ble/src/families.ts:77,123` | golden list 24건 웹·앱(`golden-both.test.ts:85,113`), 이름 경계 속성 1,500회 | 충족 — 판정 코드 중복 없음 |
| AC-PRN2-05 WRONG_MODEL | `niimbot.ts`, `mobile-ble/src/adapter.ts`, 문장 `errors.ts:33`(L-7 표 197줄과 글자 같음) | `fb1/printer-detail`(B1_PRO·B21_PRO·B21S·D110_M), `device-bounds` | 충족 |
| AC-PRN2-06 실험 표시·"예" 뒤 출력 | 웹 `LabelsPage.tsx:240-310`, `printer-station.ts:120,920,988`; 문장 `profiles.ts:283`(L-7 글자 그대로) | `apps/web/test/prn2-printer.test.tsx:153,179,243,506,534,572` | 충족 (E2E는 아직 미커밋) |
| AC-PRN2-07 숨김 스위치 없음 | `apps/mobile/src/native/production.tsx`(스위치 삭제, `createPrinterPicker` 기본 표) | `apps/mobile/test/prn2-printer.test.tsx:35,42` | 충족 — 흔적은 SA-PRN2-004 |
| AC-PRN2-08 프로필 ID·크기 목록·LABEL_ERROR | 서버 `print-api.ts` `profileIdOf`, `print.ts` `knownProfileId`·`labelSizes`(:611)·`deviceState`(:870), 마이그레이션 0030; 웹 `LabelSettings.tsx:165-172,340`, `printer-station.ts:1069-1075`; 앱 `label-queue.ts:449-454` | `apps/server/test/prn2-printer.test.ts`, `tests/adversarial/prn2/server-print.test.ts:145-151`(로그에 프로필 글 없음), 웹 `:300,330,461,489`, 앱 `:96,124` | 충족 (앱·웹 차이 SA-PRN2-005) |
| AC-PRN2-09 PNG 입구 | `print-api.ts` `pngResponse`·`jobImage`(비트맵과 같은 검사·같은 오류), `encodeLabelPng` | `server-print.test.ts`(PNG = encode(비트맵), 오류 상태·본문 같음), 서버 `prn2-printer.test.ts:122-140` | 충족 |
| AC-PRN2-10 기본 대체 | 웹 LBL-07 그대로, 앱 `api/labels.ts` `fetchTestPng`·`LabelsScreen.tsx:120`(테스트 라벨만) | 앱 `prn2-printer.test.tsx:142` | **부분** — SA-PRN2-002 |
| AC-PRN2-11 시험 | 도메인 `tests/adversarial/prn2/*`(골든 두 길·표 한 줄 추가 `table-row.test.ts`) | — | 도메인 충족, E2E 진행 중(미커밋) |
| D-PRN2-09 "예" | 웹·앱 단추 "예", 스펙 L-7 "예" | 웹·앱 시험 | 충족 |
| D-PRN2-10·15 "예" 전 받기 멈춤·연결 단위 | 웹 `printer-station.ts:797,920,957,988`, 앱 `label-queue.ts:161,344,366,402` | 웹 `:534,572`, 앱 `:228,254` | 충족 |
| D-PRN2-11 `?size=` | 서버 `print.ts:1071-1075`, 웹 `printer-station.ts:1168-1170`, 앱 `api/labels.ts` | 서버 `prn2-printer.test.ts:122`, 웹 `:621` | 충족 |
| D-PRN2-12·13·14 | `print-api.ts` profileIdOf(글 아님만 400), `deviceState` 덮어쓰기, `queue.labelSizes` | `server-print.test.ts` | 충족 |
| D-PRN2-16·17·19 | `pickListTarget`, `pick-list.ts` NAMELESS_TITLE | `device-bounds`(p50_lower), golden G-PRT-PRN2-25 | 충족 |
| D-PRN2-18 | `one-list.ts` `forgetNiimbot`·`connectRemembered` | `apps/web/test`·qs1 | 충족 |
| D-PRN2-20 | `one-list.ts:42` | `golden-both`(optionalServices) | 충족 |
| D-PRN2-21·22 | `niimbot.ts` IMAGE_TOO_WIDE, `fake.ts` 농도 0 | `device-bounds` | 충족 |
| D-PRN2-23 | 웹 `printer-station.ts:1116-1120`(범위 밖이면 보내지 않음) | 없음(test-domain이 e2e 몫으로 미룸) | 부분 — SA-PRN2-006 |
| D-PRN2-24 | `LabelSettings.tsx:340` | 웹 시험 | 충족 |
| D-PRN2-25·26 | 문장 `print-words.ts:48`, 작업 라벨 PNG 공유 없음 | — | 결정대로 |

## 3. 지적

### SA-PRN2-001 · 높음(게이트) · harness/spec
- 보호 경로 게이트 실패: `9988f420 [spec]`이 `harness/sprints/PRN2/decisions-for-dev.md`를 썼다. `scripts/harness/check-protected.mjs:23`은 spec에 `acceptance.md`·`BASE`만 허용한다. 게이트 실패는 그 자체로 막힘(HARNESS).
- 고칠 쪽: 오케스트레이터가 `[harness]`로 허용 목록에 `decisions-for-dev.md`를 더하거나, 그 파일을 `[orch]` 커밋으로 다시 들이고 판단을 남긴다. 커밋 안 된 `tests/e2e/i1/attacks.spec.ts`·`tests/e2e/prn2/`는 test-e2e가 커밋하면 사라진다(`i1/attacks.spec.ts` 수정이 PRN2 근거 있는 변경인지 커밋 때 확인 필요).

### SA-PRN2-002 · 보통 · spec(또는 web)
- 스펙과 결정이 어긋남: L-7 "기본 대체"(LABEL_RULES 177줄)·L-11 17(281줄)·AC-PRN2-10은 "앱은 서버가 준 PNG를 기기의 공유 창으로 넘긴다"(라벨 그림). D-PRN2-26은 "테스트 라벨 공유까지만, 작업 라벨은 후속"으로 줄였는데 스펙·acceptance 문장은 그대로다. 구현은 `apps/mobile/src/screens/LabelsScreen.tsx:120`(테스트 라벨만), `fetchJobPng`(`apps/mobile/src/api/labels.ts`)는 화면에서 쓰지 않음.
- 영향: 앱만 쓰는 판매자가 그림 파일로만 기종(B1 Pro 등)이나 실험 기종이 안 찍힐 때 실제 라벨을 제조사 앱으로 넘길 길이 앱에 없다(웹으로 가야 함). 기본 B1에는 영향 없음.
- 고칠 쪽: spec-keeper가 L-7·L-11 17·AC-PRN2-10에 "PRN2는 테스트 라벨만, 작업 라벨은 후속" 단서를 넣거나, 범위로 두려면 web(앱) 구현.

### SA-PRN2-003 · 낮음 · web(앱)
- 앱 고르기 목록에 "실험"이 두 번 보인다: `packages/mobile-ble/src/pick-list.ts:75`가 `detail`에 "실험"을 넣고, `apps/mobile/src/screens/PrinterPickList.tsx:25-26`이 꼬리표 "실험" + `detail`을 같이 그린다("[실험] Marklife P50 · 실험 · 신호 강함"). L-7은 줄에 "실험" 하나.

### SA-PRN2-004 · 낮음 · device
- 숨김 스위치 흔적: `packages/mobile-ble/src/families.ts:161` `enabledFamilies(families, _showExperimental?)`가 아무것도 안 하는 함수로 남아 `index.ts:25`에서 내보내지고 `packages/mobile-ble/test/families.test.ts:78-79`가 시험한다. 앱 시험(`apps/mobile/test/prn2-printer.test.tsx:35`)은 apps/mobile만 훑어 이 흔적을 못 잡는다. D-PRN2-08 "스위치 없음"의 뜻에 맞게 지우는 편이 안전(다시 쓰일 여지 차단).

### SA-PRN2-005 · 낮음 · web
- 같은 규칙의 앱·웹 차이(코드 중복): 받은 작업의 템플릿에 `size`가 없을 때 웹은 `profileSupportsSize(profileId, undefined)` → 라벨 오류로 멈추고(`apps/web/src/lib/printer-station.ts:1071`), 앱은 `typeof size === 'string'`일 때만 검사해 그대로 찍는다(`apps/mobile/src/lib/label-queue.ts:452`). 실제 서버는 늘 크기를 주므로 영향은 작지만 "앱·웹 같은 기준"을 어긴다. 문장 상수(`EXPERIMENTAL_WAIT_TEST` 등)도 `apps/web/src/lib/print-words.ts:46-55`와 `apps/mobile/src/lib/words.ts:169-178`에 따로 있다 — 한쪽만 고치면 갈라진다(지금은 글자 같음).

### SA-PRN2-006 · 낮음 · web
- D-PRN2-23 처리의 앱·웹 차이와 화면 표시: 웹은 범위 밖 농도면 농도를 보내지 않는데(`printer-station.ts:1116-1120`) 설정 칸은 프로필 기본값을 보여(`LabelsPage.tsx:385`) 화면 값과 실제(프린터에 저장된 농도)가 다르다. 앱은 프로필이 바뀌면 농도를 프로필 기본으로 바꿔 보낸다(`label-queue.ts:162,196`) — 결정 ②("보내지 않고 프린터 기본값")와 다르다. D-PRN2-23의 안내 한 줄("이 프린터는 농도 {최소}~{최대}만 돼요")은 어디에도 없다(선택이라 기록만). 이 결정을 검증하는 시험 없음.

## 4. 시험 약화 검토
- `211cfb2c [test:domain]` n1·fb1·qs1 수정 6파일: 모두 D-PRN2-01·02·05·07 근거(없어진 `EXPERIMENTAL_PROFILES` → 같은 내용 `[BAUATO_PPA2L]`, 바우아토 19,233→19,236바이트 = 머리 4+12+3·꼬리 2+3+4 계산 맞음, WRONG_MODEL 무작위 모델에서 켠 D110·B21 제거, `template: {}` → 실제 서버 모양). 시간 수치·거절 성질은 그대로 유지. 약화 아님.
- dev 커밋의 기존 시험 수정(`apps/web/test/*`, `apps/mobile/test/*`, `packages/printer/test/*`, `packages/mobile-ble/test/*`): 지운 기대는 모두 스펙이 바뀐 곳(B1 하나 → 켠 표 B1·B1 SE·B21·D110, NOT_SELECTED·WRONG_MODEL 문장 L-7 표 194·197줄, 첫 글자 거르기 제거, 실험 목록·숨김 스위치 제거, 바우아토 L11 → Luck Jingle, `?size=`·`profileId` 추가). 삭제한 `matchesNiimbotName` 대소문자 무시 시험은 D-PRN2-04 "글자 그대로"로 바뀐 규칙이라 근거 있음. `.only`·`.skip`·`todo` 없음.
- 웹 시험 이름 `apps/web/test/prn2-printer.test.tsx:108`이 "optionalServices ff00·fd00"이라 D-PRN2-20 전 문장이다(단언은 `printerRequestOptions()`와 비교라 맞음) — 기록만.

## 5. 기록만 (범위 밖·스펙 질문)
- TD-PRN2-001(Luck Jingle 첫 명령이 `OK`로 답하면 안 찍힌 라벨을 출력함으로 기록할 수 있음)은 스펙 질문으로 HG-5까지 열림.
- 서버 `?size=`(빈 값)은 422 — D-PRN2-11 "없으면 50×30"이 빈 값을 정하지 않음. 화면은 늘 값을 넘겨 영향 없음.
