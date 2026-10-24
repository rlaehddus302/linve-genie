# MOB1 dev-notes

## server (dev-server) — 연습 모드 휴대폰 유튜브 잇기 (D-MOB1-06, AC-MOB1-07·08)

`apps/server/src/**`는 고치지 않았다(유튜브 폴더 포함). 바뀐 곳은 연습 모드뿐.

### 바뀐 공개 모양

- **새 모듈 `scripts/try/phone-relay.mjs`** (+ 타입 `phone-relay.d.mts` — TS 시험에서 `import … from '<상대 경로>/scripts/try/phone-relay.mjs'`로 부른다). `try.mjs`의 휴대폰 https 중계 처리기를 여기로 옮겼다(Origin 바꾸기·L1 간편 로그인 바꾸기는 동작 그대로).
  - 상수: `FAKE_GOOGLE_PREFIX = '/_try/google'`, `FAKE_GOOGLE_AUTHORIZE_PATH = '/o/oauth2/v2/auth'`, `TRY_PHONE_YOUTUBE`.
  - 순수 함수
    - `swapOrigin(text, from, to)`: 정확히 `${from}/`로 시작할 때만 앞부분을 바꾼다
    - `relayAuthorizeUrl(text, googleOrigin, here)`: `${googleOrigin}/o/oauth2/v2/auth` 뒤가 끝·`?`·`#`일 때만 `${here}/_try/google/o/oauth2/v2/auth…`. `redirect_uri`는 글자 그대로
    - `fakeGoogleTarget(target)`: 요청 대상이 정확히 `/_try/google/o/oauth2/v2/auth`(+`?…`)일 때만 `/o/oauth2/v2/auth…`, 그 밖은 `null`. 정규화하지 않고 글자 그대로 비교하므로 `..`·`//`·`%2F`·절대 주소·공백·제어 문자는 모두 `null`
    - `authorizeRoute(method, target)`: `'start'`(POST /api/youtube/connection/start)·`'consent'`(PUT /api/youtube/consent)·`'resend'`(POST /api/outbox/<n>/resend)·`null`
    - `rewriteAuthorizeBody(text, change)`: 맨 위 `authorizeUrl`만 바꾼다. 결과는 `{ text, authorizeUrl(바꾸기 전 값 | null) }`
    - `phoneYoutubeMessage(port)`, `phoneYoutubeBody(port)`, `phoneYoutubeNotice(realYoutube)`
  - `createPhoneRelay({ port, appOrigin, httpsOrigins, fakeGoogle: { port } | null, realYoutube, innerHost? })` → `(req, res)` 처리기. `https.createServer({key,cert}, handler)`에 붙인다. 휴대폰 주소 `here`는 `https://<Host 머리글>`이고, `httpsOrigins`에 들어 있을 때만 바꾸기를 한다.
- **가짜 구글(기본)**: 위 세 경로 응답의 `authorizeUrl`을 `https://<휴대폰 주소>/_try/google/o/oauth2/v2/auth?…`로 바꾼다. 그 경로의 GET만 가짜 구글(127.0.0.1:<가짜 포트>)의 같은 경로로 넘긴다. 머리글은 `host`·`accept`만 넘기고 쿠키는 넘기지 않는다. 그 밖의 `/_try/google…`과 POST는 404이고 가짜 구글에 닿지 않는다. 가짜 구글과 서버가 돌려보내는 Location의 `http://localhost:<포트>/`는 휴대폰 주소로 바뀐다. 그래서 승인 → `/api/youtube/oauth/callback` → `/settings/youtube?youtube=connected`가 모두 휴대폰 https 주소로 이어진다.
- **진짜 구글(`--real-youtube`)**
  - 중계로 온 `POST /api/youtube/connection/start`는 안쪽 서버로 넘기지 않고 바로 409 `{ error: { code: 'TRY_PHONE_YOUTUBE', message } }`를 준다. 메시지는 D-MOB1-06 글자 그대로이고, 포트는 실제 숫자다.
  - 동의·다시 보내기는 서버에 넘긴다. 응답에 `authorizeUrl`이 있으면 그 응답 대신 같은 409를 돌려준다. 동의를 끄는 것처럼 승인 주소가 없는 응답은 그대로 둔다.
  - 이 처리는 중계로 온 모든 요청에 같다(Host 머리글을 보지 않는다).
  - 참고: 동의 요청은 서버에 닿으므로 OAuth state 한 줄이 남는다. 이 줄은 기한이 지나면 지워진다.
- **터미널 시작 안내**: "3) 같은 와이파이 휴대폰" 아래에 한 줄을 더했다. 가짜 구글이면 "휴대폰에서도 유튜브 연결을 해 볼 수 있어요.", 진짜 구글이면 "실제 유튜브 연결은 이 컴퓨터에서 먼저 해 주세요."가 나온다.
- `docs/TRY-IT.md` 4장의 "휴대폰에서 하지 않는 것"에 있던 "유튜브 연결은 맥북에서"를 "유튜브 연결" 안내 두 줄로 바꿨다(연습: 휴대폰 가능, 실제: 맥북 먼저).
- 확인: `apps/server/test/mob1-try-relay.test.ts`(12개)
  - 자체 서명 https에 중계를 붙이고, 휴대폰 주소 `https://192.0.2.10:<포트>`를 Host 머리글로 흉내 냈다.
  - 가짜 구글 모드: 시작 → 승인 → 돌아오기 → 설정 화면까지 모든 주소가 휴대폰 주소인지, 연결이 저장되는지(연습 채널), 동의 → 게시 권한까지 본다. 이 컴퓨터 주소는 그대로인지, 연습 경로 404를 본다.
  - 진짜 구글 모드: 시작은 409이고 안쪽 서버 요청이 0개인지, 동의는 409인지, 동의 끄기는 200인지, 이 컴퓨터 주소는 그대로인지 본다.
  - 순수 함수 시험도 있다.

### 다음 영역에게

- **domain (AC-MOB1-09, `tests/adversarial/mob1/try-relay.test.ts`)**
  - 순수 함수는 `scripts/try/phone-relay.mjs`에서 바로 부르면 된다.
  - 처리기 전체를 볼 때는 `apps/server/test/mob1-try-relay.test.ts`의 `tryWorld()`를 따라 하면 된다. 내보내지 않으니 복사해 쓴다. 이렇게 묶는다.
    - 안쪽 서버: `createNodeServer`를 127.0.0.1:0에 연다. 안에 요청 개수를 세는 앱을 둔다.
    - 휴대폰 쪽 서버: `createSelfSignedCertificate`로 `https.createServer`를 열고 `createPhoneRelay`를 붙인다.
    - 요청: `https.request`에 `rejectUnauthorized: false`와 `Host: <휴대폰 IP>:<포트>`를 준다.
  - 가짜 구글에 닿은 요청은 `fake.callCounts()`로 센다(나는 이것으로 404 경로가 가짜에 닿지 않는지 봤다).
  - 구글로 나간 요청은 setup-network-guard가 막고, 막힌 것이 있으면 파일이 실패한다.
- **web**
  - 서버 문장은 그대로다. 진짜 구글 모드에서 휴대폰으로 "구글로 유튜브 연결하기"를 누르면 지금 오류 칸에 `error.message`가 그대로 나온다(유튜브 화면 파일은 고치지 않음).
  - `docs/TRY-IT.md` 4장 4번에 아래 막대가 "방송 · 문자찜 입력 · …"으로 적혀 있다. D-MOB1-04로 막대 이름이 "문자찜"으로 바뀌면 이 문서 줄도 맞춰야 한다. 이번에 나는 고치지 않았다.
- **e2e**: 연습 모드(`pnpm try`) 자체는 E2E 서버가 아니다. 휴대폰 유튜브 한 바퀴는 서버 시험이 확인한다.

## web (dev-web) — 휴대폰 점검 바로 고칠 것 (AC-MOB1-01~06·10~26)

금지 파일(`ConsoleYoutube.tsx`·`YoutubeConnection.tsx`·`lib/youtube.ts`)과 `packages/**`는 고치지 않았다.

### 바뀐 공개 모양 (내보내는 이름·문장 상수)

- `lib/menu.ts`: `SMS_BAR_LABEL = '문자찜'`, `barLabel(item)` — 휴대폰 아래 막대(판매자·보조자)만 "문자찜". `menuLayout`의 `label`은 "문자찜 입력" 그대로(PC 위 줄·`h1`).
- 새 `components/LogoutButton.tsx`: `LogoutButton`, 순수 함수 `logoutRisks({ broadcasts, station })`, 문장 `LOGOUT_TITLE`·`LOGOUT_KEEP`("로그인 유지")·`LOGOUT_LIVE`·`LOGOUT_STATION`·`LOGOUT_UNKNOWN`.
  - 누를 때 `GET /api/broadcasts`를 한 번 받는다(받는 동안 버튼 잠김). 실패하면 "방송 중인지 확인하지 못했어요."로 묻는다. 출력 기기 = 라벨 켜짐 + `station.isMine(queue)`. 보조자는 묻지 않고 목록도 받지 않는다.
  - 휴대폰 판매자: 위 줄에 없음, "더보기" 목록 맨 끝 `<li><button class="menu-link menu-logout">로그아웃</button></li>`(링크 아님). PC·보조자: 위 줄 그대로.
  - 휴대폰에서 확인 창은 목록이 열린 채 그 위에 뜬다(목록 안에서 그린다). "로그인 유지"를 누르면 창만 닫히고 목록은 열린 채다. Esc는 목록의 Esc 처리(창·목록 모두 닫힘, 로그아웃 안 함)가 먼저 받는다.
- `lib/print-words.ts`: `deviceLostMessage(name)` 새 문장, `NO_STATION_PILING`, 순수 함수 `stationLeadText({ labelsOn, rehearsal, ended, queue, mine })`, `isIphone(ua)`, `IPHONE_TEST_PRINTER`.
- `components/AlertStrip.tsx`: `AlertLead.uncounted?: boolean` — 알림 수("알림 n 펼치기")에 넣지 않는다. 콘솔이 플랫폼 줄 다음에 `{ key: 'print-station', soft: true, uncounted: true }` 항목을 붙인다(누르면 `/labels`). Alt+1 순서(`firstAlert`)는 그대로.
- `components/PackingPrint.tsx`: 접수 문장 뒤 끊김 안내 상자(`role=note`, `deviceLostMessage` + "라벨 화면으로"). 출력 기기 없음 문장은 그대로.
- `components/VoicePanel.tsx`: `CONSENT_OTHER_DEVICE`가 `CONSENT_LINES`의 넷째 줄이다(줄 4개).
- 새 `voice/wake.ts`: `ScreenWake`(요청 함수·문서를 넣어 시험), `useScreenWake(active)`, `browserScreenWake()`. 콘솔이 `voice.phase === 'on'`일 때 켠다. 숨으면 잡은 잠금을 잊고, 보이면 다시 1번 요청한다. 출력 기기 잠금(printer-station)과 따로 잡는다.
- `lib/device.ts`: `DEFAULT_DEVICE_NAMES`, 순수 함수 `defaultDeviceName({ userAgent, narrow, otherStation })`, `storedDeviceName()`, `savedDeviceName(otherStation?)`. 라벨 화면 기기 이름 칸은 판매자가 고치기 전까지 지금 출력 기기 이름에 맞춰 " 2"를 다시 계산한다(출력 기록이 늦게 와도 맞음).
- `components/ExtensionConnection.tsx`: `EXTENSION_PHONE_ONLY` — 휴대폰 폭이면 칸 안이 이 한 줄뿐(`<p class="extension-phone">`). 쓰기 요청 없음(`GET /api/extension`은 그대로 받는다).
- `components/QuickInput.tsx`: `closed?: boolean` — 끝난 방송·봉인 날짜(`ended || sealed`, 리허설 포함)에는 빠른 입력 줄 전부가 없다. 오류·"고칠까요?"·고치기 칸은 남는다. 콘솔은 끝나면 치던 글을 비운다. 상품 자세히의 "고치기"는 `EditDialog`라 영향 없다.
- `components/ConsolePlatforms.tsx`: 휴대폰 폭에서 그리지 않는 칸
  - 인스타그램: 서버 준비 안 됨, 또는 `NOT_CONNECTED`이고 이은 것·알림·DM 실패·오류가 없을 때. `RECONNECT_NEEDED` 경고 칸은 그대로 둔다(할 일이 있음).
  - 틱톡: 막힘 문장(`tiktokBlocker`)이 있고 잇지 않았을 때.
  - 단축키 줄(`.shortcuts`)은 PC 폭에서만 그린다.
- 끝난 방송·봉인 날짜에는 "음성 켜기"가 없다(켜져 있던 음성의 끄기는 음성 칸에 남음).
- `index.html` viewport는 `…, interactive-widget=resizes-content`.
- 설정 버튼은 "전체 기록 파일 (옮기기·보관용)"(같은 경로·파일). 받은 시각 칸 `placeholder`는 없다. 작업 줄은 "자동 · 작업 대기".
- 포장 모드에서 "포장 라벨 출력"과 결과 문장은 "포장 라벨" 제목 바로 아래(그림·"라벨 PDF" 위)의 자기 줄이다(`.packing-print-row`).
- 아이폰 사용자 에이전트에서 시험용 프린터가 보이면 연결 방법 버튼 줄 바로 아래에 `p.hint`가 붙는다. 라벨 화면과 마법사 4/5가 같은 `PrinterSection`이다.
- `styles.css`
  - 모든 `:hover`는 파일 끝 `@media (hover: hover)` 안으로 옮겼다. 알림 올림은 `.button.alert-item:hover:not(:disabled)`이다.
  - `select`: `appearance: none`, 화살표는 그라데이션 두 개라 `url()`이 없다. `min-height` 44px, `select.input`의 오른쪽 여백은 2.5rem이다.
  - 휴대폰 폭에서 글 칸·고르기 칸에 `min-width: 0; max-width: 100%`, `.field`는 `minmax(0,1fr)`, `.button`은 줄바꿈이다.
  - `.quick-row`는 container이고, 줄 폭이 17rem 이하이면 입력칸이 한 줄을 다 쓴다(쌓기).
  - `.shop-name`·`.quick-label`은 높이 44px 가운데 정렬이라 위 끝이 맞는다.
  - PC 채팅의 `.chat-convert`는 높이 44px이고 `margin-block: -0.125rem`, 줄 위아래 여백은 0.125rem이다.

### 확인한 것

- 웹 단위 시험 전체: `pnpm exec vitest run --project web` 91파일 1,470개 통과. 새 시험 3파일
  - `test/mob1-menu-logout.test.tsx`
  - `test/mob1-styles.node.test.ts`
  - `test/mob1-print-voice.test.tsx`
- tsc·eslint는 깨끗하다.
- 기존 단위 시험은 바꾼 낱말·자리 줄만 고쳤고, 줄마다 `// MOB1 D-MOB1-0x`를 달았다.
  - 막대 "문자찜": phone-menu·billing-page·wizard-app·console-s06
  - 로그아웃 자리: App·l1-social-login
  - 끊김 문장·" · ": labels-page
  - 버튼 이름: closing-pages
  - viewport: index-html·build.node
  - 끝난 방송·봉인 날짜의 빠른 입력 없음: console-s06·console-youtube·receipts-page·n2b2-platforms. 잠긴 칸이 있던 자리는 "칸이 없음"으로 단언한다.
  - 단축키 줄·휴대폰 숨김 칸·크롬 확장 칸: console-labels-off·n2b2-platforms·x1-extension·x1-ext-thanks. 이 시험들은 PC 폭(matchMedia)으로 열어 지금 단언을 그대로 둔다.
  - 포장 버튼 자리: pl1b-packing
- 임시 Playwright 확인은 작업 폴더 밖(scratchpad)에서 했다. E2E 시험 파일은 쓰지 않았다.
  - 글자 150%, 375·412 크로미움, 393 WebKit: 방송 목록·진행 중 콘솔·리허설 콘솔·문자찜·구매자·정산·포장·라벨·설정·더보기 모두 넘침 0이다.
  - 빠른 입력
    - 100%: 이름·입력·개수의 위 끝이 275/274/275로 한 줄이다.
    - 150%: 세로로 쌓이고, 입력칸 폭은 화면의 87%(375)·88%(412)다.
  - 위 줄 100%: 가게 이름·프린터 위 끝이 8/8이다.
  - 아래 막대 글 상자: 100%는 18 < 29, 150%는 28 < 43이다.
  - 고정 영역 100%: 375에서 109px(13%)다.
  - 412 터치에서 빨간 알림을 누르고 닫은 뒤 `rgb(179,38,30)`/흰 글자다. PC에서 올리면 `rgb(140,29,24)`/흰 글자다.
  - 포장 버튼(품목 1개)은 375에서 687~731(막대 위 759), 412에서 651~695(막대 862)다.
  - `select`는 44px·18px·`appearance:none`·배경 그림 있음이다(크로미움·WebKit).
  - 끊김 항목: 안드로이드 출력 기기 탭을 닫으면 다른 기기 콘솔에 바로 뜬다. 두 번째 안드로이드의 기본 이름은 "안드로이드 폰 2"다.
- 기존 E2E `s06/layout.spec.ts`
  - AC-S06-62·64는 통과했다.
  - AC-S06-61(375)은 로그인 도우미가 위 줄 "로그아웃"을 기다려서 실패한다 — e2e 몫(AC-MOB1-91).
- 규칙대로 전체 `pnpm verify`는 돌리지 않았다.

### 다음 영역에게

- **e2e (AC-MOB1-90·91)**
  - 휴대폰 폭에서 `login()` 도우미(`s05/support.ts:43` 등)가 `button '로그아웃'`을 기다리면 실패한다. 메뉴 `nav[aria-label="메뉴"]`를 기다리게 바꿔야 한다. 로그아웃은 "더보기"를 연 뒤 목록 안 버튼으로 누르고, 방송 중이면 확인 창의 위험 버튼 "로그아웃"까지 누른다.
  - 데스크톱 기본 크기(1280)는 위 줄 그대로다.
  - 기존 E2E에서 바뀌는 것
    - 휴대폰 막대 "문자찜 입력" → "문자찜"
    - 끊김 문장(`i1/screens.spec.ts` AC-I1-23)
    - "전체 기록(JSON)" → "전체 기록 파일 (옮기기·보관용)"
    - 끝난 방송·봉인 날짜에서 "빠른 입력"을 기다리던 줄은 칸이 없으니 "끝난 방송이에요"나 상품 보드로 기다린다.
    - 휴대폰 콘솔의 인스타·틱톡 "쓸 수 없음" 칸·단축키 줄은 없다.
    - 휴대폰 설정의 크롬 확장 칸은 한 줄뿐이다.
    - 포장 "포장 라벨 출력"은 "라벨 PDF"와 같은 줄이 아니다(제목 바로 아래).
    - 작업 줄 글은 "자동 · 작업 대기"다.
  - 끊김 항목을 사라지게 하려면 **같은 탭**을 다시 열어 연결한다(새로고침). 기기 ID가 탭마다라 새 탭은 다른 기기다.
  - 출력 기기 항목은 `region '알림'` 안의 첫 `button`(플랫폼 줄이 없을 때)이고, 이름 = 문장 전체다. "알림 n 펼치기" 수에는 들지 않는다. 이 항목 하나뿐이면 펼치기 버튼이 없다.
  - 가짜 Wake Lock은 `navigator.wakeLock.request('screen')`를 `addInitScript`로 바꾸면 된다. 돌려주는 값에는 `release()`와 (있으면) `addEventListener('release', …)`가 필요하다.
  - 화면이 숨었다 보이는 것은 `document.visibilityState`를 덮고 `visibilitychange`를 보내면 된다. 숨을 때 잠금을 잊으므로 `release` 사건 없이도 보이면 1번 다시 요청한다.
- **ux (AC-MOB1-95)**: 아래 셋을 보면 좋겠다.
  - 휴대폰에서 확인 창이 열린 "더보기" 목록 위에 뜬다.
  - 출력 기기 항목이 접힌 띠에서 한 줄로 말줄임된다(전문은 버튼 이름과 라벨 화면에 있다).
  - 끝난 리허설에도 빠른 입력 줄이 없다.
- **spec-keeper 확인 거리(바꾸지 않았다)**
  - 끝난 방송의 빠른 입력 숨김을 끝난 **리허설**에도 적용했다. AC 글은 "끝난 실제 방송 또는 봉인 날짜"다. 끝난 회차에 새 상품을 넣는 실수를 막는 쪽이 같아서 그렇게 했다.
  - 인스타그램 `RECONNECT_NEEDED`(다시 연결 필요) 칸은 휴대폰에서도 남겼다. 할 일이 있는 경고라서다.

## 웹 수정 라운드 — U-MOB1-01 (글자 150% 휴대폰에서 빠른 입력칸이 아래 막대 뒤)

- 원인 둘
  - 콘솔 위 버튼 넷(방송 목록·상품 목록 가져오기·방송 끝내기·음성 켜기)이 큰 글씨에서 한 줄에 하나씩 쌓여 약 300px을 썼다.
  - 아래 막대는 `position: fixed`라 브라우저는 그 뒤에 깔린 칸도 "보인다"고 여긴다. 포커스·Enter에도 화면이 움직이지 않았다.
- 고친 것
  - `styles.css`: `.console-head`를 폭을 재는 칸(container)으로, 줄 폭 17rem 이하(큰 글씨 휴대폰)면 `.console-actions`가 두 칸 격자. 버튼 글은 버튼 안에서 줄바꿈하고 높이 44px는 그대로다. 100% 휴대폰·PC 모양은 그대로다.
  - `lib/above-bar.ts` `useKeepAboveBar`(콘솔): 빠른 입력 묶음(입력칸~되돌리기 띠) 안에 포커스가 있을 때, 포커스가 들어올 때·묶음/위 줄 크기가 바뀔 때·화면 높이가 바뀔 때 묶음 아래 끝이 막대 위 끝(틈 8px)보다 아래면 그만큼 올린다. 입력칸 위 끝은 화면 위로 넘기지 않고, 고정 영역이 위에 닿으면 더 올리지 않는다. 막대가 붙어 있지 않은 PC에선 아무것도 안 한다.
- 확인
  - 웹 단위 시험: `test/mob1-above-bar.test.tsx`(9), `test/mob1-styles.node.test.ts`에 2개 더함. 콘솔·fb1-quick·mob1·build 단위 시험 224개 통과.
  - 임시 E2E(작업 폴더 밖, 커밋 안 함, 크로미움 묶음만): 375·412 글자 150%에서 콘솔을 열면 입력칸이 막대 위·그 자리의 요소가 입력칸, "2 백도선 8" Enter 뒤 "2번 등록 되돌리기"와 입력칸 모두 막대 위. 375 150% 처음 연 입력칸 y=584~650(막대 733), 100%는 그대로(올리지 않음).
  - 기존 E2E 통과: `mob1/big·small·hide·press`, `s06/layout`(21개), `s05`·`fb1`(109개).
- **e2e에게**: AC-MOB1-03 추가 후보 시험 — 글자 150% 375×812·412×915 진행 중 콘솔: (1) 연 직후 포커스된 빠른 입력칸 아래 끝 ≤ 막대(`nav[aria-label="메뉴"]`) 위 끝, 칸 가운데 `elementFromPoint`가 입력칸, (2) 줄을 치고 Enter 뒤 "n번 등록 되돌리기" 버튼과 입력칸이 막대 위.
- **spec-keeper에게**: AC-MOB1-03에 "글자 150% 휴대폰 콘솔에서 빠른 입력칸·등록 뒤 되돌리기 띠가 아래 막대에 가리지 않는다"를 더하자는 사용성 제안(U-MOB1-01). 위 줄 버튼 두 칸 격자는 D-MOB1-03의 "쌓기·줄바꿈" 방법 안이라 따로 결정이 필요 없다고 봤다(서랍 "방송 관리"는 구조 개편이라 하지 않았다).
