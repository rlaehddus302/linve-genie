# SMS2 dev-notes

## dev-server (완료)

- 코드: `apps/server/src/try/sms-test.ts` (상자 `createSmsTestBox`, http 받는 곳 `createSmsTestHttpServer`는 그대로 상자에 넘김). 단위: `apps/server/test/sms2-sms-test.test.ts`(28개, AC-SMS2-01~18·40·41·50), 옛 `smst-sms-test.test.ts` 그대로 통과.
- 문서: `docs/TRY-IT.md` "문자 자동 수신 시험하기" — 준비 → (가) → (나) → (다) 시험 순서 → (라) 결과 읽기 → 끄기 (AC-SMS2-50~53).
- `scripts/try/try.mjs`는 고치지 않았다(쓰는 함수 이름·인자 그대로).

### 시험 쪽이 알아 둘 것 (domain·e2e)

- 새로 내보낸 함수: `parsePhoneAt(value, serverAt)`, `readSerial(body)`, `delayLabel(delayMs | null)`, `summarizeDevice(arrived)`. `SmsTestEntry`에 `serial`, `count`(온 횟수)가 더해졌다. `entries()`는 복사본(새것이 앞).
- 받기 응답: 새 줄 `{ ok, seq, last4, serial, duplicate: false }`, 겹침 `{ ok, seq: 처음 줄, last4, serial, duplicate: true }`.
- 주소 규칙 (`/_try/sms-test`)
  - `POST` + `do` 없음 → 받기(머리글 `X-Try-Token`).
  - `POST ?t=토큰&do=reset` → 지우고 303, `location`은 **상대 주소** `/_try/sms-test?t=토큰`(http 받는 곳에서도 같은 http 주소로 풀린다). `t`가 없거나 틀리면 401(머리글 토큰으로는 지우지 않는다).
  - `POST`에 `do`가 `reset`이 아닌 값 → 400(받기도 안 함). 토큰 검사보다 먼저.
  - `GET ?t=토큰&do=reset-ask` → 확인 화면(새로고침 없음). `GET ?t=토큰&do=reset`이나 다른 `do` → 그냥 보기 화면(지우지 않음).
- 화면 구조(고를 때 쓸 것): `<main>`(최대 720px) 안에 `<h1>`, 안내 한 줄, `<section>` 요약(`<h2>요약</h2>`, 기기마다 `<div class="group">`, 제목 `<h3>`), `<section>` 시험 순서(`<ol>` 세 줄), `<a class="btn">처음부터 다시 세기</a>`, `<section>` 카드(`<div class="card">`, 첫 줄 `<p class="top">`, 내용 `<div class="b">`). 확인 화면 단추: `<form method="post">` 안 `<button class="btn danger">`, 돌아가기 `<a class="btn">`. 단추 최소 높이 48px, 본문 1.125rem(18px).
- 화면의 고정 문장은 따옴표(`'`)를 이스케이프하지 않고 글 그대로 둔다(태그 밖이라 안전). 받은 글(본문·기기 이름·요약 제목의 기기 이름)은 `& < > " '` 모두 이스케이프.
- 시각 판단은 UTC 함수만 써서 `TZ`와 상관없다. 24시간 경계는 "넘게"만 버린다(정확히 24시간 차이는 읽는다).
- 숫자 시각: 정수 부분이 13자리 이상이면 밀리초, 10~12자리면 초, 그 밖·음수·무한은 없음. 글로 온 시각은 64자 넘으면 바로 없음(아주 긴 글 대비).
- 겹침 열쇠는 `[기기, 보낸 사람 종류, 끝 4자리, 내용]` JSON 글 — 원문 번호·이름은 들어가지 않는다. 비교 범위는 지금 들고 있는 50줄.
- 평균은 정수 밀리초 합에서 `floor((합 + 50·n) / (100·n))`로 100ms 단위 반올림.

### 사용자 확인 필요 (만들지 않음)

- 실제 아이폰 단축어의 "현재 날짜"·"날짜 형식 ISO 8601" 메뉴 이름, MacroDroid의 밀리초 시스템 시간 마법의 글자 이름, 실제 지연 — 실물 시험 몫.
- 문자 자동 수집 방식 선택(운영 기능화) — 사용자 결정 대기(D-SMS2-01).

## dev-web (할 일 없음)

- 수용 기준 범위(D-SMS2-01)대로 `apps/web/**`는 고치지 않았다. 시험 화면은 서버가 만드는 HTML(`apps/server/src/try/sms-test.ts`)이고, 웹 앱·Playwright 설정(`apps/web/playwright.config.ts`)도 그대로다.
- e2e 쪽: `tests/e2e/sms2/**`는 기존 설정으로 돈다(`CI=1 E2E_PORT_OFFSET=4400 pnpm exec playwright test --config apps/web/playwright.config.ts tests/e2e/sms2`). 서버 시험 화면을 열 때 웹 앱 화면이나 웹 쪽 이름(aria-label)에 기대지 말고 위 dev-server의 화면 구조(`.group`·`.card`·`.btn`·`form button.btn.danger`)를 쓴다. WebKit(아이폰) 시험은 제목에 `@webkit` 꼬리표를 달면 기존 `webkit-iphone` 프로젝트(iPhone 15, 393×852)에서 돈다. Chromium 375×812·412×915·1280×800은 시험 파일 안에서 `test.use({ viewport })`나 `page.setViewportSize`로 맞추면 되고, 새 프로젝트는 만들지 않았다.
