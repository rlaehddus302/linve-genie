# APP2 dev-notes

## dev-web — Expo 앱 (apps/mobile)

### 남의 영역을 고친 것
- `packages/core/package.json` (dev-core): `exports`에 `./quick-input`(src/parse/quick-input.ts)·`./format`(src/format.ts)을 더했다. 왜: 앱 번들에 판정 엔진(코어 전체 index)을 담지 않으면서(APP-01 AC3) 빠른 입력 한 줄의 번호·품종·가격 **읽기**(입력 읽기 — 판정이 아니다)와 금액 표시만 쓰려고. 다른 패키지의 import는 그대로다.
- `pnpm-workspace.yaml`: `expo install`이 적은 `minimumReleaseAgeExclude`(Expo SDK 58 묶음 — 갓 나온 판이라 최소 공개 기간 정책에서 뺌). 지우면 설치가 실패한다.
- `.gitignore`: `/apps/*/.expo/`, `/apps/mobile/android/`, `/apps/mobile/ios/`.

### 서버에 바라는 입구 (TODO 표시 — 지금은 가짜 값으로 돈다)
- `TODO(APP1 server)` `POST /api/voice/ticket { b }` → `{ wsUrl, token }` (src/api/voice.ts). 404면 개발용 가짜 표. 거절(409·403·503)은 서버 문장 그대로 보인다(D-APP-10).
- `TODO(APP1b server)` 음성 웹소켓이 돌려주는 읽은 결과 모양 `VoiceReading { no, name, price, instant, correction, readout }` (src/native/audio.ts) — 서버 모양이 정해지면 맞춘다.
- `TODO(APP2 server)` `GET /api/print/jobs/:id/bitmap?attempt=&device=` → `{ width, height, data(base64 1비트 행 바이트) }` (src/api/labels.ts). 404면 빈 384×240 그림. 테스트 인쇄 그림(`GET /api/print/test-bitmap`)도 같은 모양으로.

### 웹과 나눠 쓰는 것
- 실행 코드: `@livejjim/web/src/api/client.ts`(ApiError·withRetry·withQuery·errorFromBody), `@livejjim/web/src/lib/kst.ts`. `@livejjim/core/quick-input`·`@livejjim/core/format`.
- 타입만: `@livejjim/web/src/api/types.ts`·`print-types.ts`, `@livejjim/printer`(어댑터 계약), `@livejjim/label`(LabelBitmap).
- 웹의 words·derive·scope-data·quick·packing은 코어 전체를 끌어와서 가져오지 않고 앱이 같은 규칙을 따로 든다 — `test/web-sync.test.ts`가 웹 결과와 같은지 본다. 뒤에 DOM 없는 공용 조각을 `packages/`로 올리면 둘 다 그걸 쓰면 된다(후속).

### 스펙과 다르게 둔 것 없음 / 판단한 것
- APP-01 AC3 "판정·금액 계산 코드 없음": 코어의 **입력 읽기**(parseQuickInput·parseAmount)와 `formatWon`은 들어간다. 판정(decide/settle)·추출(@livejjim/voice)·사전은 없다 — `test/thin-client.node.test.ts`가 소스 import와 빌드 결과(dist/*.hbc)를 검사한다. 빠른 입력 줄을 서버가 읽는 입구가 생기면 그쪽으로 옮긴다.
- 기기 ID는 앱이 켜진 동안 하나(저장하지 않음). 출력 기기 역할은 앱을 다시 열면 다시 누른다(웹 탭과 같은 성질).
- 끊김 여섯 번 셈(D-APP-05)은 앱 JS(VoiceSession)가 네이티브 상태 알림으로 센다 — 네이티브 모듈이 스스로 멈춰도(`stopped`) 같은 화면.
- LABEL_RULES L-7 연결 방법 목록에 "앱 BLE"를 더하는 문장은 spec-keeper 몫(APP-03).

### 확인 못 한 것
- 실제 기기·시뮬레이터 실행(Xcode·안드로이드 SDK 없음). Metro 번들(`expo export` iOS·안드로이드)·tsc·lint·vitest까지만.
- Hermes에서 웹 공용 모듈(kst.ts의 Intl 등)·Expo fetch 스트리밍(SSE)의 실제 동작.
