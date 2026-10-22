# L1 개발 노트

## dev-server

### 만든 것 (파일)
- 마이그레이션 `apps/server/drizzle/0014_l1_social_login.sql` (하나) — 새 표 `login_links`(공급자 연결)·`login_states`(간편 로그인 state), 세션 표에 `method` 칸(`PASSWORD`·`GOOGLE`·`KAKAO`·`NAVER`, 기존 세션은 기본값 `PASSWORD`). 기존 표의 칸 뜻은 그대로.
  - `login_links`: `seller_id`·`account_id`·`provider`·`provider_user_id`·`label`(가린 이름, 빈 값 가능)·`linked_at`·`last_login_at`. 유일 제약 `login_links_provider_user_uq`(provider, provider_user_id)·`login_links_account_provider_uq`(account_id, provider).
  - `login_states`: `state_hash`(PK)·`browser_hash`·`provider`·`purpose`(`LOGIN`·`LINK`)·`seller_id`·`account_id`·`session_hash`(연결일 때만 — 로그인은 로그인 전이라 비어 있다)·`verifier_enc`(구글·카카오 PKCE 검증 값, 마스터 키 AES-GCM)·`created_at`·`expires_at`(10분)·`used_at`. 시작할 때 끝난 행을 지운다.
  - 토큰·인가 코드·이메일 원문·닉네임 원문 칸은 어디에도 없다. 복구(I2)는 두 표를 그대로 둔다(`RESTORE_KEPT_TABLES`).
- `apps/server/src/social/` — `providers.ts`(공급자 고정 주소·환경 변수 읽기·승인 주소·코드 교환·사용자 정보, 10초 제한), `masked.ts`(가린 이름 — 순수 함수), `service.ts`(시작·돌아오는 주소·목록·끊기), `routes.ts`(경로), `fake-oauth.ts`(가짜 OAuth 서버).
- `Auth.takeLoginAttempt(address)`(로그인 IP 한도를 함께 쓴다)·`Auth.createSession(account, method)`.
- 실시간 알림 `event: login` `{ kind: 'methods' }` — 연결·끊기 뒤 그 판매자의 판매자 화면 연결 전부(보조자 연결은 받지 않는다). 화면은 목록을 새로 읽는다.
- 로그 코드 `SOCIAL_LOGIN` — `provider`(google·kakao·naver)·`reason`(결과 코드 또는 `LOGGED_IN`·`UNLINKED`)·`errorKind`(`Provider_<token|userinfo>_<http|timeout|network|shape|invalid_grant>`)·`status`만.

### 환경 변수 (AC-L1-01·13)
| 공급자 | 변수 | 필수 |
|---|---|---|
| 구글 | `LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID`, `LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET` | 둘 다 (유튜브 연결의 `LIVEJJIM_GOOGLE_*`와 다른 이름, 값은 같아도 된다) |
| 카카오 | `LIVEJJIM_LOGIN_KAKAO_REST_API_KEY` (필수), `LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET` (선택 — 카카오 앱에서 켰을 때만) | REST API 키 |
| 네이버 | `LIVEJJIM_LOGIN_NAVER_CLIENT_ID`, `LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET` | 둘 다 |

- 값이 모두 있는 공급자만 켜진다. 일부만 있으면 운영 시작이 멈추고 "구글 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요."(공급자 이름만 바뀜, 카카오는 시크릿만 있을 때). 값은 출력하지 않는다.
- **공급자 주소를 바꾸는 환경 변수는 없다**(AC-L1-01 — "설정 자체가 없음"). 운영은 `providers.ts`의 고정 https 주소. 주소 바꾸기는 `ServerOptions.socialLogin.endpoints`(코드)로만 되고, 그것을 쓰는 곳은 E2E 기동·연습 모드·시험뿐이다. http 주소는 `allowInsecure: true`일 때만 받는다(아니면 서버를 만들지 않는다).

### 화면에게 (dev-web)
모든 경로는 기존 `/api` 규칙(D-074 — 상태를 바꾸는 요청의 `Origin`·JSON·64KB, `Cache-Control: no-store`, 모르는 항목 400 `UNKNOWN_FIELD`)을 탄다. **켜진 공급자가 하나도 없으면 `/api/auth/**` 전부 404**이고 `client-config`에 `loginProviders` 항목이 없다(L1 전과 같은 응답).

| 뜻 | 경로 | 세션 | 본문 | 응답 |
|---|---|---|---|---|
| 화면 설정 | `GET /api/client-config` | 없음 | | 더함: `loginProviders: ('kakao'|'naver'|'google')[]` — 켜진 공급자만, 카카오·네이버·구글 순. 하나도 없으면 항목 자체가 없다 |
| 간편 로그인 시작 | `POST /api/auth/start` | 없음 | `{ provider }` | 200 `{ authorizeUrl }` + `Set-Cookie: lj_oauth=…; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`. 꺼진·모르는 공급자 404, 시작 요청이 너무 많으면 429 `LOGIN_RATE_LIMITED` |
| 연결 시작 | `POST /api/auth/link` | 판매자 | `{ provider }` | 같음. 세션 없음 401, 보조자 403 `ASSISTANT_FORBIDDEN` |
| 돌아오는 주소 | `GET /api/auth/<provider>/callback` | (state·쿠키로 판단) | | 302 — 아래 표 |
| 로그인 방법 목록 | `GET /api/auth/methods` | 판매자 | | `{ loginId, providers: [{ provider, enabled, linked, label, linkedAt }] }` — 켜진 공급자 전부 + 꺼졌지만 연결이 남은 공급자(`enabled: false`), 카카오·네이버·구글 순. `label`은 가린 이름(빈 값이면 화면은 "카카오 계정"), `linkedAt`은 UTC ISO 또는 null. 공급자 계정 ID는 없다. 보조자 403 |
| 연결 끊기 | `POST /api/auth/unlink` | 판매자 | `{ provider }` | 200 새 목록(위와 같은 모양). 연결이 없거나 모르는 공급자 404, 남는 로그인 수단이 없으면 409 `LOGIN_METHOD_LAST`("마지막 로그인 방법은 끊을 수 없어요." — 지금은 비밀번호가 늘 있어 생기지 않는다). 보조자 403. 꺼진 공급자에 남은 연결도 끊을 수 있다 |

- 시작 응답의 `authorizeUrl`로 같은 탭에서 이동(`location.assign`)한다. 시작 실패 응답의 `error.message`는 그대로 보여도 되는 문장이다.
- 돌아오는 주소의 302 `Location`은 늘 `<앱 주소>/` 또는 `<앱 주소>/settings` + `login`·`provider` 두 매개변수뿐이다:

| 경우 | Location |
|---|---|
| 간편 로그인 성공 | `<앱 주소>/` (매개변수 없음 — 새 `lj_session` 쿠키가 함께 온다) |
| 로그인 쪽 결과 (`CANCELLED`·`EXPIRED`·`NOT_LINKED`·`PROVIDER_ERROR`) | `<앱 주소>/?login=<코드>&provider=<p>` |
| `RATE_LIMITED` (state를 보기 전) | `<앱 주소>/?login=RATE_LIMITED&provider=<p>` |
| 연결 쪽 결과 (`LINKED`·`LINKED_ELSEWHERE`·`ALREADY_LINKED`·`CANCELLED`·`EXPIRED`·`PROVIDER_ERROR`) | `<앱 주소>/settings?login=<코드>&provider=<p>` |
| `SESSION_GONE` | `<앱 주소>/?login=SESSION_GONE&provider=<p>` |

  - `EXPIRED`·`CANCELLED`·`PROVIDER_ERROR`가 로그인 화면인지 설정 화면인지는 그 state 행의 목적으로 정한다(state를 모르면 로그인 화면 `/`).
  - 문장은 acceptance "결과 문장" 표 그대로(화면이 코드로 고른다). 공급자 이름: `google` 구글 · `kakao` 카카오 · `naver` 네이버.
- 연결·끊기 뒤 실시간 알림 `event: login` `data: {"kind":"methods"}` — 설정 화면이 열려 있으면 `GET /api/auth/methods`를 다시 부른다.
- 끊으면 그 계정에서 그 공급자로 만든 다른 세션이 지워지고 그 실시간 연결은 닫힌다 — 그 기기의 다음 요청은 401(기존 "로그인이 풀렸어요" 처리). 끊기를 누른 지금 세션은 그 공급자로 만든 것이어도 남는다.
- 보조자: `link`·`methods`·`unlink`는 보조자 허용 목록 밖이라 403이다. 화면은 보조자에게 칸을 숨기고 부르지 않는다(AC-L1-23). `POST /api/auth/start`는 누구나(로그인 전).

### 시험에게 (test-domain·test-e2e)

#### E2E 기동 (AC-L1-12)
```
pnpm --filter @livejjim/server e2e --port <포트> --origin <화면 주소> --social fake [--social-port <포트, 기본 0>] [--social-providers kakao,naver,google]
```
- 시작 줄에 `· 가짜 OAuth http://127.0.0.1:<포트>`가 붙는다. 기본(`--social` 없음)은 꺼짐 — 기존 E2E는 그대로다.
- 서버는 `<화면 주소>/api/auth/<p>/callback`을 돌아오는 주소로 보내고, 가짜 서버에도 그 주소를 등록해 둔다.
- 판매자 둘은 기존 `POST /_e2e/sellers`, 보조자는 기존 `POST /api/assistants`.
- 프로그램으로: `startE2eServer({ social: { port?, providers? } })` → `e2e.fakeOAuth`.

#### 가짜 OAuth 서버 (`apps/server/src/social/fake-oauth.ts`, `FakeOAuth`)
공급자 경로(`<p>` = google·kakao·naver): `GET /<p>/authorize`(승인 화면) · `POST /<p>/authorize`(화면의 동의·취소 버튼) · `POST /<p>/token` · `GET /<p>/userinfo`.
- 승인 화면: 위에 `<h1>가짜 카카오 로그인</h1>`, 가짜 사용자 라디오(첫째가 골라져 있음, `input[data-user="<id>"]`, 글 "<닉네임 또는 '닉네임 없음'> · <이메일 또는 '이메일 없음'> · 번호 <id>"), 버튼 **"동의하고 계속하기"**·**"취소"**(취소 → `error=access_denied`). 클라이언트 ID·`redirect_uri`가 등록과 글자까지 같지 않으면 돌려보내지 않고 400 오류 화면(`p[role=alert][data-error="redirect_uri_mismatch"]` 등).
- 토큰 교환: `application/x-www-form-urlencoded`, 같은 `redirect_uri`·클라이언트 비밀값·(구글·카카오) `code_verifier`(S256) 검사, 코드는 한 번만·60초 — 어기면 `invalid_grant`(네이버는 200 + `{ error }`).
- 기본 등록 클라이언트: `fake-<p>-client`(카카오 `fake-kakao-rest-key`) / `fake-<p>-secret`. `new FakeOAuth({ clients, redirectUris, codePrefix, tokenPrefix, codeTtlMs })`로 바꾼다(표시 값 `CODE-SENTINEL-`·`TOKEN-SENTINEL-` 등).
- 조작 (JSON, 그 서버 주소):

| 경로 | 본문 | 뜻 |
|---|---|---|
| `POST /_fake/users` | `{ provider, id?, email?, nickname? }` | 가짜 사용자 만들기(같은 id면 바꾼다) → `{ user: { provider, id, email, nickname } }`. id 기본: 구글·카카오 숫자, 네이버 영문·숫자 |
| `GET /_fake/users?provider=` | | `{ users }` |
| `POST /_fake/fail` | `{ provider, step: 'token'|'userinfo', status?, delayMs?, error?: 'invalid_grant', shape?: 'not_json'|'missing_id', times? }` | 다음 times번(기본 1) 호출에 실패·지연 |
| `POST /_fake/redirect` | `{ provider, redirectUri }` | 등록한 돌아오는 주소 바꾸기(AC-L1-30 7) |
| `GET /_fake/requests?provider=` | | `{ requests: [{ provider, kind: 'authorize'|'token'|'userinfo', at, params }], exchanges: { google, kakao, naver } }` — authorize의 `params`는 받은 질의 그대로(`redirect_uri`·`scope`·`code_challenge`·`code_challenge_method`·`state`·`prompt`…), token은 `{ contentType, grant_type, client_id, redirect_uri, clientSecretSent, clientSecretOk, codeVerifierSent, codeVerifierOk, stateSent }`(비밀값·코드 원문은 없음), userinfo는 `{ bearer }`. `exchanges` = 토큰 교환을 받은 수 |
| `POST /_fake/approve` | `{ url: <authorizeUrl>, user: <id>, action?: 'approve'|'cancel' }` | 화면 없이 동의·취소 → `{ location }`(돌아오는 주소 — 쿠키를 가진 쪽이 연다) 또는 400 `{ error }` |
| `POST /_fake/reset` | | 받은 요청·넣은 실패·교환 수를 지운다(사용자·등록은 그대로) |

- 같은 프로세스(적대 시험)에서는 `FakeOAuth.start({ redirectUris })` → `createServer({ socialLogin: fake.setup({ providers?, timeoutMs? }) })`, `fake.addUser`·`fake.decide(url, { approve: true, user })`·`fake.failNext`·`fake.registerRedirect`·`fake.requests`·`fake.exchanges`. 서버 단위 시험의 도우미는 `apps/server/test/l1-support.ts`(`newSocialWorld`·`startFlow`·`approve`·`openCallback`·`runFlow`).

#### state·쿠키 방식 (AC-L1-03 "두 탭")
- 브라우저 쿠키 `lj_oauth`(무작위 32바이트 base64url 43자, `Path=/api/auth`). 시작 요청에 그 브라우저의 `lj_oauth`가 있으면 **같은 값을 다시 쓰고**(Max-Age만 다시 10분), 없으면 새로 만든다. 그래서 한 브라우저의 두 탭은 쿠키 하나를 함께 쓰고 각 state는 따로 살아 있다. 다른 브라우저(다른 쿠키·쿠키 없음)로 연 돌아오는 주소는 `EXPIRED`.
- 돌아오는 주소 응답은 `lj_oauth`를 지운다(`Max-Age=0`) — 같은 브라우저의 다른 탭에서 아직 돌아오지 않은 시작은 그 뒤 `EXPIRED`가 된다(acceptance가 허용).
- 검사 순서(AC-L1-04): ① 로그인 IP 한도(비밀번호 로그인과 같은 10분 20번을 함께 센다) ② `error`(`access_denied` = `CANCELLED`, 그 밖 `PROVIDER_ERROR`, state가 맞으면 쓴 것으로 표시) ③④ state·쿠키·공급자·10분·안 썼음을 **한 UPDATE 문**으로 확인하며 쓴 것으로 표시(동시에 20번 와도 하나만) ⑤ 연결이면 그 세션이 살아 있고 state의 세션·계정과 같아야(`SESSION_GONE`) ⑥ 코드 교환·사용자 정보(각 10초) ⑦ 연결 표.
- 시작 요청도 IP마다 따로 센다(로그인 IP 한도의 5배 = 10분 100번, 넘으면 429) — 로그인 전 공개 경로라 state 표를 채우는 요청을 막는다. 로그인 IP 한도와는 따로 세므로 "비밀번호 15 + 돌아옴 6"은 시작 수와 상관없다.

#### 이메일·가린 이름
- 이메일·닉네임이 없어도 연결·로그인이 된다. 저장은 가린 이름(`masked.ts` `maskedLabel`)만. 다시 로그인할 때 새로 고친다.
- 공급자 계정 ID 모양: 영문·숫자·`.`·`_`·`-`·`~` 1~255자(카카오 숫자 id는 문자열로). 그 밖이면 `PROVIDER_ERROR`.

### 연습 모드 (AC-L1-24)
- `pnpm try`가 가짜 OAuth 서버를 연습 서버 안 경로 `/_try/oauth/<p>/…`에 붙여 세 공급자를 켠다(운영 기동에는 이 경로가 없다). 승인 화면 위 "연습용 가짜 화면이에요. 실제 카카오가 아니에요.", 연습 계정 둘(이메일 있음·없음). 연습 모드의 가짜 서버는 `/_fake/*` 조작 경로가 없다.
- 휴대폰(https 넘기기)에서는 넘기는 쪽이 `Location`·시작 응답의 승인 주소 앞(`http://localhost:<포트>`)을 휴대폰 주소로 바꿔 준다 — 돌아오는 주소(`redirect_uri`)는 그대로 `http://localhost:<포트>/api/auth/<p>/callback`(등록과 같아야 하므로).
