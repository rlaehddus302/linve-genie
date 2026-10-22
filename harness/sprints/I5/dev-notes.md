# I5 dev-notes

## dev-device — `@livejjim/voice` 공개 모양 변경 (dev-web·test-e2e가 쓰는 것)

### 오류 종류 (D-I5-03, AC-I5-05·06)
- `SpeechErrorKind`에 새 값 2개: `SERVICE_OFF`, `RESTART_BLOCKED`.
  - `PERMISSION_DENIED` = 판매자가 누른 `start()`가 연 인식 객체에서 온 `not-allowed`
  - `SERVICE_OFF` = 같은 객체에서 온 `service-not-allowed`
  - `RESTART_BLOCKED` = 저절로 끝난 뒤 엔진이 다시 연 객체에서 온 `not-allowed`·`service-not-allowed`
  - 모두 새 객체를 열지 않고 `HALTED`. 다시 `start()`하면 그 객체는 다시 "처음 켤 때".
- `SPEECH_ERROR_MESSAGES`의 `UNSUPPORTED`·`PERMISSION_DENIED`·`SERVICE_OFF`·`RESTART_BLOCKED`·`KEEPS_STOPPING` 문장은 AC-I5-06 글자 그대로. 화면은 `error.message`를 그대로 보이면 된다.
- 화면 쪽 `Record<SpeechErrorKind, …>`가 있다면 두 값을 더해야 타입 검사가 통과한다(지금 apps/web엔 없음).

### 끝에서 넘김 (D-I5-02, AC-I5-03·04)
- `SpeechResult`에 선택 속성 `flushedAtEnd?: boolean`. **끝에서 넘긴 결과에만 `true`로 붙고, 보통 결과에는 속성이 없다**(없음 = 거짓). 넘긴 결과는 `final: true`.
- 넘기는 때: 인식 객체가 저절로 끝났고(판매자 `stop()`·멈추는 오류가 아님) 그 객체에서 마지막으로 받은 결과가 글자 있는 중간 결과이며 그 위치가 아직 최종으로 오지 않았을 때 한 번. 그 뒤 다시 시작한다. 넘긴 결과도 다시 시작 한도의 센 것을 비운다(최종 결과와 같이).
- 카드: `createCard({ …, flushedAtEnd: true })`로 만들면 카드에 `flushedAtEnd: true`가 붙고 `autoConfirmAt`은 `null`, `checkAutoConfirm`은 늘 `due: false`. 카드의 `touched`는 바꾸지 않는다(3장 넘침 닫기 규칙은 보통 카드와 같다). `confirmCard`(등록 누르기·Enter)는 그대로 된다.
- dev-web 할 일: `controller.ts`의 `#onResult` → `#cardsWith`(그리고 이력 기다림에 미루는 `#held`)에 `result.flushedAtEnd === true`를 실어 `createCard`에 넘긴다.

### 다시 시작 한도 (D-I5-01, AC-I5-01·02)
- 새 상수 `FAST_END_MS = 2000` (index에서 내보냄). `RESTART_WINDOW_MS = 60_000`, `MAX_AUTO_ENDS = 6`은 그대로.
- `WebSpeechEngine`은 인식 객체 `start()` 직전 `now()`를 연 시각으로 잡고, 저절로 끝날 때 `연 시각부터 < 2000ms`(또는 시계가 NaN·뒤로 감)인 끝만 센다. 2000ms 이상 들은 뒤 끝난 것은 세지 않고 늘 다시 시작한다.
- `RestartLimiter.recordEnd(openedAt?: number)` — `openedAt`을 주면 빨리 끝남만 센다. 주지 않으면 예전처럼 모든 끝을 센다(클라우드 골격 `CloudSpeechEngine`은 그대로 — I5 범위 밖, D-I5-07).

### 그 밖
- `packages/voice/src`에 UA(`navigator.userAgent`·`userAgentData`)를 읽는 코드 없음 — 단위 시험이 소스 글자를 검사한다(AC-I5-06).
- 엔진 시험: `pnpm --filter @livejjim/voice test` (가짜 인식 생성자 + 시계 함수).
