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

## dev-web — 화면·E2E 설정 (test-e2e가 쓰는 것)

### 화면 동작
- 끝에서 넘긴 결과(`flushedAtEnd: true`)는 `controller.ts`가 `createCard({ …, flushedAtEnd: true })`로 넘긴다 — 이력을 기다리며 미룬 문장(`#held`)에도 실린다. 그 카드는 `autoConfirmAt: null`이라 "N초 뒤 자동 등록"·"자동 등록 멈추기"가 없고, "등록"·Enter로만 등록된다(AC-I5-04·22).
- 지원 안 함(AC-I5-10): I4부터 이미 `engine.isSupported()`를 안내 창 앞에서 본다 — 창·확인 기록(`livejjim.voiceConsent`)·인식 객체·`/api/days` 없이 꺼진 채 음성 칸 알림(role=alert)에 `UNSUPPORTED` 문장. 버튼은 "음성 켜기" 그대로.
- 고지(AC-I5-12): 켜진 동안 `.voice-sent` 한 줄 "음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.", 안내 창 둘째 문장 "음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브찜은 음성을 녹음하거나 저장하지 않아요." (나머지 창 문장 그대로).
- 홈 화면 앱(AC-I5-11): `navigator.standalone === true`이고 (켜짐 또는 음성 칸 오류가 있을 때) 음성 칸(`section[aria-label="음성 등록"]`)에 "홈 화면 앱에서는 음성이 자주 끊길 수 있어요. 안 되면 사파리에서 열어 주세요." (role 없는 글). 값은 그릴 때마다 읽는다 — 시험은 `addInitScript`에서 `Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })`.
- 다시 켜기(AC-I5-14): `RESTART_BLOCKED`로 멈춘 뒤 "음성 켜기"는 같은 엔진으로 새 인식 객체를 열고 오류를 지운다. 카드는 남는다.
- 393px에서 고지 줄은 상태 글자·"음성 끄기" 사이에 끼지 않고 제 줄로 내려간다(`.voice-sent { flex: 1 1 14rem }`). WebKit iPhone 15로 손으로 본 결과 `scrollWidth 393 = innerWidth 393`.

### Playwright 묶음 `webkit-iphone` (AC-I5-90)
- `apps/web/playwright.config.ts`: 화면 5183·서버 3111(+`E2E_PORT_OFFSET`), `devices['iPhone 15']`(WebKit·393×659·터치·isMobile), `grep: /@webkit/`. `chromium`의 `grepInvert`에 `@webkit` 추가. 서버 옵션은 기본 묶음과 같다(시험 계정·메모리 DB).
- WebKit 설치: `cd apps/web && pnpm exec playwright install webkit` (webkit-2336). 없으면 그 묶음은 브라우저를 열지 못해 실패한다(건너뛰지 않음). 이 장비엔 설치해 두었다.
- **Playwright WebKit은 http://localhost에서 Secure 쿠키를 보내지 않는다** — 로그인하자마자 "로그인이 풀렸어요"가 됐다. 그래서 이 묶음의 화면 미리 보기 서버만 `node e2e/serve.ts … --drop-secure-cookie yes`로 /api 응답 Set-Cookie의 `Secure`를 떼어 넘긴다(`apps/web/e2e/cookie.ts`). 서버·운영 쿠키는 그대로 Secure. 쿠키 속성 시험은 이 묶음에 두지 말 것.
- 묶음 하나만 돌리기: `cd /Users/unhoyeo/livejjim-wt/i5/apps/web && E2E_PORT_OFFSET=27900 pnpm exec playwright test --project webkit-iphone`.
- 하단 메뉴(휴대폰 막대)가 아래에 고정되어 있어 카드 버튼이 그 밑에 가릴 수 있다 — `scrollIntoViewIfNeeded` 뒤 누르면 된다(Playwright click이 알아서 스크롤).
