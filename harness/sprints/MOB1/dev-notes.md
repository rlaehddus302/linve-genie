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
