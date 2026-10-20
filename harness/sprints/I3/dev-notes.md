# I3 개발 노트

## dev-server

### 화면에게 — 새·바뀐 계약 (AC-I3-94)

Y1 계약(`harness/sprints/Y1/dev-notes.md` "화면(I3)에게" 1~8)은 그대로이고 아래가 더해진다. 공통 규칙도 같다: 세션이 필요하고(401), 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE)은 `Origin` = 앱 주소·JSON 본문만(403·415·400), 모르는 필드는 400 `UNKNOWN_FIELD`, 모든 `/api` 응답은 `Cache-Control: no-store`, 오류 본문은 `{ error: { code, message, problems? } }`이고 **`message`는 판매자에게 그대로 보이는 문장**이다. 시각은 UTC ISO(화면이 KST로 보인다).

#### 1. 내 정보·역할 (AC-I3-61·63)
| 요청 | 응답 |
|---|---|
| `GET /api/me` | `{ seller: { name }, loginId, role: 'SELLER'｜'ASSISTANT', assistant: { name } ｜ null }` — `seller.name`은 가게 이름(보조자도 그 판매자의 가게 이름), `assistant`는 보조자 계정일 때만 |
| `POST /api/login` `{ loginId, password }` | `{ seller: { name }, loginId, role }` (전과 같고 `role`이 더해짐 — 보조자면 화면이 `/sms`로) |

#### 2. 보조자 계정 (AC-I3-60~62, 판매자 계정만 — 보조자 세션은 403)
| 요청 | 응답 |
|---|---|
| `GET /api/assistants` | `{ assistants: [{ id, name, loginId, createdAt }], limit: 5 }` (만든 순서, 지운 보조자는 없음, 비밀번호·해시 없음) |
| `POST /api/assistants` `{ name }` | `{ assistant: { id, name, loginId, createdAt }, password }` — **비밀번호는 이 응답에만** 있다(다시 볼 수 없다). 아이디는 `bo-` + 8자(영문 소문자·숫자), 비밀번호는 18자(`0 O o 1 l I` 없음) |
| `POST /api/assistants/:id/delete` `{}` | `{ ok: true }` — 그 보조자의 모든 세션이 끝나고(다음 요청 401) 열린 실시간 연결은 바로 닫힌다. 남의·없는·이미 지운 보조자는 404 |

- 오류: 이름이 틀리면(앞뒤 공백을 뺀 1~20자, 줄바꿈·제어·서식 글자 없음) 400 `INVALID_INPUT` "보조자 이름은 1~20자로 적어 주세요."(problems `name`) · 여섯째 409 `ASSISTANT_LIMIT` "보조자는 5명까지 만들 수 있어요."
- 보조자의 실시간 연결(`GET /api/stream`)은 범위 변경 알림(`ready`·`change`)만 받는다 — 유튜브(`youtube`)·리허설 생성기(`generator`) 알림은 판매자 연결에만 간다.
- 보조자 세션이 쓸 수 있는 것(그 밖은 모두 403 `ASSISTANT_FORBIDDEN` "보조자 계정으로는 할 수 없는 일이에요." — 아무것도 기록하지 않는다):
  `GET /api/me` · `GET /api/client-config` · `GET /api/broadcasts` · `GET /api/days`·`GET /api/days/:date`·`GET /api/days/:date/changes`(실제 범위만 — `?rehearsal=true`는 403) · `GET /api/stream` · `POST /api/logout` ·
  `POST /api/events`의 `type: 'sms'`(실제 방송만)와 `type: 'host.cancel'`(그 번호에서 그 구매자의 지금 찜이 문자찜으로 생긴 찜일 때만 — 아니면 403).
  화면은 보조자에게 다른 화면 주소에서 데이터 요청을 보내지 않는다(AC-I3-63). `/api/settings`·`/api/youtube/*`·`/api/days/:date/outbox`·`/messages`·`/history`·`/youtube-notices`도 403이다 — 보조자 화면의 문자찜 입력은 그 데이터 없이 돌아야 한다.

#### 3. 가게 이름 (AC-I3-47, 판매자 계정만)
| 요청 | 응답 |
|---|---|
| `PUT /api/shop` `{ name }` | `{ shop: { name } }` (앞뒤 공백을 뺀 값) — 그 뒤 `GET /api/me`의 `seller.name`이 바뀐다 |

- 오류: 앞뒤 공백을 뺀 1~30자(코드 포인트)가 아니거나 줄바꿈·제어·서식 글자(Cc·Cf)가 있으면 400 `INVALID_INPUT` "가게 이름은 1~30자로 적어 주세요."(problems `name`, 같은 문장). 휴대폰 번호 검사는 하지 않는다.

#### 4. 시작 마법사 상태 (AC-I3-50, 판매자 계정만)
| 요청 | 응답 |
|---|---|
| `GET /api/wizard` | `{ wizard: { status: 'NEW'｜'IN_PROGRESS'｜'DONE'｜'DISMISSED', step: 1~5 ｜ null } }` — 처음 만든 판매자는 `NEW`(`step` null) |
| `PUT /api/wizard` `{ status, step? }` | 같은 모양. `IN_PROGRESS`는 `step`(1~5 정수)이 꼭 있어야 하고, 다른 상태는 `step`을 적지 않는다(또는 null) |

- 모르는 값·틀린 조합은 400 `INVALID_INPUT` "마법사 상태를 확인해 주세요."(problems `status`·`step`). "다시 하기"는 화면이 `IN_PROGRESS`·`step: 1`로 적으면 된다. 서버는 자동으로 여는 조건(실제 방송이 없음)을 판단하지 않는다 — 화면 몫(`GET /api/broadcasts`).

#### 5. 로그인 제한 (AC-I3-66·67)
- 429 `LOGIN_RATE_LIMITED` "로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요." (같은 IP 10분에 21번째부터)
- 429 `LOGIN_BUSY` "지금 로그인 요청이 많아요. 잠시 뒤에 다시 해 주세요." (서버 전체 비밀번호 확인이 몰림)
- 기존 429 `LOGIN_LOCKED`(아이디 잠금)·401 `LOGIN_FAILED`는 그대로. 화면은 `message`를 그대로 보인다.

#### 6. 발송함 정리 (AC-I3-36, 판매자 계정만)
| 요청 | 응답 |
|---|---|
| `POST /api/outbox/:id/confirm-posted` `{ requestId }` | `{ rows: OutboxRowView[] }` — 그 행과 **같은 메시지(묶음)의 행 모두**가 `state: 'SENT'`, `confirmedBySeller: true`, `messageId: null`, `postedAt` = 확인한 시각. 효과마다 게시 보고(`effect.thanksSent`, 조치자 = 그 판매자 계정)를 기록한다(공개 감사가 나간 확정은 잠긴다 — 늦게 온 선순위 문자찜은 자동 역전이 아니라 충돌). 같은 `requestId`로 다시 보내면 처음 결과 |
| `POST /api/outbox/:id/dismiss` `{}` | `{ row: OutboxRowView }` — `FAILED` 행만. 상태·이유는 그대로, `dismissed: true`·`dismissedAt`. 다시 보내도 같은 결과. 그 행을 "다시 보내기"하면 `dismissed`는 지워진다 |

- `OutboxRowView`에 칸 셋이 더해진다: `confirmedBySeller: boolean`(판매자가 "올라가 있어요"로 적은 행) · `dismissed: boolean` · `dismissedAt: string ｜ null`.
- 오류: 남의·없는 행 404 · 리허설 행 409 `REHEARSAL_OUTBOX` "리허설 감사 메시지는 유튜브에 올리지 않아요." · 봉인한 날짜 409 `SEALED` · 게시됨 확인을 `FAILED(UNCONFIRMED)`가 아닌 행(보내는 중 포함)에 보내면 409 `CONFIRM_NOT_ALLOWED` "확인하지 못한 감사만 올라가 있다고 적을 수 있어요." · 알림에서 빼기를 `FAILED`가 아닌 행에 보내면 409 `DISMISS_NOT_ALLOWED` "보내지 못한 감사만 알림에서 뺄 수 있어요." · 요청 번호 없음 400 `INVALID_REQUEST_ID`.
- 둘 다 SSE `youtube` `{ kind: 'outbox', date, ids, state, reason }`를 보낸다(다른 기기의 알림 띠·목록을 다시 받게).
- 알림 띠 "감사 실패"가 세는 행(D-I3-05): `state: 'FAILED'`이고 `reason`이 `UNCONFIRMED`·`GAVE_UP`·`REJECTED`·`NO_PERMISSION`·`NOT_MY_CHANNEL`·`EXPIRED` 중 하나이고 `dismissed: false`. 서버는 셈을 따로 주지 않는다(목록에서 센다).

#### 7. 배포·운영 경로 (AC-I3-70·71·80·81)
- 서버가 화면 빌드를 같은 출처로 낸다(`LIVEJJIM_WEB_DIR`, E2E는 `--web-dir`). `/api/*`·`/health`·`/health/ready`·`/ops/*` 밖의 GET·HEAD: 있는 파일은 그 파일, 확장자 없는 화면 주소는 `index.html`(200), 없는 파일은 404, 그 밖의 메서드는 405.
- 모든 응답에 `X-Content-Type-Options: nosniff`·`Referrer-Policy: no-referrer`·`X-Frame-Options: DENY`(앱 주소가 https면 HSTS), `index.html`에 CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'` — 화면은 인라인 스크립트·다른 출처 스크립트·`eval`을 쓰면 안 된다. 인라인 스타일(`style=`)은 된다. 구글 승인 주소로의 이동은 최상위 이동(`location.assign`)이라 CSP와 상관없다.
- 캐시: `index.html`·`sw.js`·`manifest.webmanifest`·그 밖의 화면 파일은 `no-cache`, `/assets/` 아래는 `public, max-age=31536000, immutable`(해시가 붙은 이름이어야 한다 — Vite 기본).
- `/health/ready`(DB 확인)·`/ops/status`(운영 토큰)는 운영자용이다 — 화면은 부르지 않는다.

#### 8. E2E 서버 시험용 선택 (AC-I3-93) — 운영 시작(`main`)에는 없다
기동: `pnpm --filter @livejjim/server e2e --port <api> --origin <브라우저 주소> [기존 선택] [아래 선택]`

| 선택 | 뜻 |
|---|---|
| `--youtube fake --youtube-port <p>` | (Y1) 가짜 구글·유튜브 서버 |
| `--youtube-quota-budget <n>` | 유튜브 할당량 판매자 예산·프로젝트 한도를 n으로(작게 — 묶음은 남은 양 < 20%, 멈춤은 < 5%. 게시 1번 20, 목록 조회 5, 댓글 50) |
| `--outbox-fast yes` | 발송함 시간 줄이기: 게시 응답 기다림 3초 · 확인 시간 5초 · 끝 조회 간격 2초 · 다시 시도 간격 0.5·1·2…초 — `UNCONFIRMED`가 30초 안에 생긴다 |
| `--web-dir <폴더>` | 서버가 그 화면 빌드를 같은 출처로 낸다(AC-I3-70) |

시험용 조작 경로(E2E 서버에만, JSON POST, 세션 필요 없음 — 127.0.0.1에서만 열린다):
- `POST /_e2e/sellers {}` → `{ loginId, password, shopName }` — 방송이 하나도 없는 새 판매자 계정(마법사·보조자 시험). 비밀번호는 시험 값.
- `POST /_e2e/dates { loginId, kind: 'sealed'｜'sealSoon'｜'youtube', date? }` → `{ date, broadcast, sealed }` — 그 판매자의 실제 방송(제목 "지난 방송")을 그 날짜에 만들고 유튜브 채팅 하나를 받아(봉인 대상) 둔다. `sealed`면 바로 봉인, `sealSoon`이면 날짜 기본값 = 오늘(KST) − 24일(봉인 7일 전 안), `youtube`면 날짜 기본값 = 오늘 − 3일(봉인 예정만 보임).
- `POST /_e2e/seal { loginId, date }` → `{ sealed: boolean }` — 그 날짜(실제 범위)를 지금 봉인한다(열린 화면이 봉인되는 시험 — SSE `sealed`).
- E2E 서버는 로그인 IP 한도를 넓혀 둔다(모든 브라우저 로그인이 127.0.0.1에서 온다). 전체 동시 한도·아이디 잠금은 그대로다.
- `--youtube fake`면 발송함의 확인 조회 한 쪽 크기 = 가짜 서버의 쪽 크기(200)다(꽉 찬 쪽인지 바르게 안다).
- 서버가 화면을 함께 내는 묶음: `--web-dir <apps/web/dist 절대 경로> --origin http://localhost:<그 서버 포트>` — 브라우저가 서버 주소를 바로 연다(화면 서버 없음). 화면 빌드는 묶음을 띄우기 전에 해 둔다.

### 만든 것 (AC별)
| AC | 무엇 | 어디 |
|---|---|---|
| 36 | 게시됨 확인(묶음 모두 SENT·게시 보고 조치자 = 판매자)·알림에서 빼기, `OutboxRowView` 칸 셋, 다시 보내면 뺌 표시 지움 | `youtube/outbox.ts`·`outbox-store.ts`·`routes.ts` |
| 47·50 | 가게 이름 `PUT /api/shop`, 마법사 상태 `GET·PUT /api/wizard` (판매자 표 `wizard_status`·`wizard_step`) | `service.ts`·`api.ts`·`accounts.ts`(`cleanDisplayName`) |
| 60~62 | 보조자 만들기·목록·지우기(행은 남기고 `deleted_at`, 세션·SSE 끊기), 허용 목록(기본 거부) | `accounts.ts`·`auth.ts`·`roles.ts`·`api.ts`·`store.ts` |
| 66·67 | 로그인 IP 한도·전체 동시 한도 | `login-limit.ts`·`auth.ts`·`api.ts` |
| 70·71 | 화면 같은 출처(`LIVEJJIM_WEB_DIR`)·보안 머리글·CSP·HSTS | `web.ts`·`app.ts`·`node-server.ts` |
| 72 | 운영 시작 검사(앱 주소 https·운영 토큰·프록시 수·화면 폴더) | `config.ts`(`readDeploySetting`)·`main.ts` |
| 73·74·83 | `Dockerfile`·`.dockerignore`·`.env.example`·`docs/DEPLOY.md` | 저장소 루트 |
| 75 | 백업 명령 `backup` | `backup.ts`·`commands/backup.ts` |
| 80~82 | `/health/ready`·`/ops/status`·경보 기록·워커 건강 | `ops.ts`·`ops-store.ts`·`server.ts`·`log.ts` |
| 85~88 | 채널에 묶인 토큰(`withChannelToken`)·조회 쪽 따라가기(5쪽)·조회 1+3·간격 10초·가짜 서버 쪽 나누기 | `youtube/connect.ts`·`outbox.ts`·`fake-google.ts` |
| 93 | E2E 시험용 선택·`/_e2e/*` | `e2e.ts`·`commands/e2e-server.ts` |
| 95 | 골든 합계 23·385·122·507 | `packages/core/test/golden/core-adapter.test.ts` (그 밖의 코어는 손대지 않음) |
| 97 | 새 API 격리·공통 규칙 | 시험 `i3-accounts`·`youtube-i3-outbox` |

- **스키마**: 마이그레이션 `0004_i3_ui.sql` — `accounts.role`(기본 `SELLER`)·`name`·`deleted_at`, `sellers.wizard_status`(기본 `NEW`)·`wizard_step`, `outbox.confirmed_by`·`confirm_request_id`(판매자·요청 번호 유일)·`dismissed_at`·`dismissed_by`. 새 표는 없다(표 17개 그대로). 병렬 트랙(i1 `0003_i1_print.sql` 등)과 번호가 겹치면 합칠 때 오케스트레이터가 정리한다.

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
1. **보조자 지우기는 행을 남기고 `deleted_at`만 적는다** — 이벤트의 조치자(`events.account_id`)가 계정 행을 외래 키로 가리켜 지울 수 없고, 남겨야 "같은 아이디는 다시 만들어지지 않는다"(AC-I3-62)가 된다. 지운 계정은 로그인·세션 조회에서 없는 것과 같다. 운영자 명령 `create-account`도 지운 계정의 아이디를 받지 않는다.
2. **보조자의 이벤트 쓰기**: 종류를 요청 번호보다 먼저 본다(허용 밖 종류는 요청 번호가 없어도 403). 같은 요청 번호의 처음 결과는 그 종류가 문자찜·방송자 취소일 때만 돌려준다(판매자의 다른 조치 결과를 요청 번호로 꺼내 보지 못하게). 방송자 취소의 "문자찜으로 생긴 찜"은 기록 트랜잭션 안의 지금 상태에서 코어 `activeClaimId`·`listClaims`로 본다(AC-I3-99). 보조자는 리허설 방송에 쓰지 못한다.
3. **보조자의 실시간 연결은 이름 붙은 알림(유튜브·생성기)을 받지 않는다** — 허용 목록에 유튜브 경로가 없는데 SSE로 채널 이름·시청자 이름이 흘러가지 않게.
4. **로그인 IP 한도**: 받은 시도만 센다(막힌 시도는 세지 않는다 — 가장 오래된 시도가 10분을 넘기면 다시 받는다). 연결 주소를 모르는 요청(프로세스 안 `app.request` — 운영에는 없다)은 IP 한도를 걸지 않는다. 믿는 프록시가 알린 값이 IP가 아니면 연결 주소로 센다.
5. **전체 동시 한도**는 아이디 잠금 확인 + 비밀번호 확인 구간을 감싼다(순서 IP → 전체 → 잠금 → 확인). 막힌 요청은 아이디 실패로 세지 않는다.
6. **게시됨 확인의 게시 보고**: 행에 확인한 계정(`confirmed_by`)을 적고 보고는 실행기의 보고와 같은 요청 번호(`ytsent-<행>`)로 쓴다 — 확인 응답이 쓰든 다음 바퀴의 실행기가 쓰든 조치자는 그 판매자 계정이고 한 번만 기록된다.
7. **알림에서 빼기**는 처음 뺀 시각·계정을 지킨다(다시 빼도 같은 결과). 그 행을 다시 보내면 표시를 지운다 — 또 실패하면 새 실패로 알린다.
8. **보조자 쿠키로 유튜브 돌아오는 주소**(세션을 강제하지 않는 공개 경로)도 403 — "유튜브 모든 경로"(AC-I3-61).
9. **경보는 남기던 로그에서 꺼낸다**(`Alerter.observe`) — 각 모듈이 경보를 따로 부르지 않아 빠질 곳이 적다. 이를 위해 `ENGINE_FAILED` 로그에 서버가 만든 판매자 ID를 붙였고(같은 판매자 묶음), `OUTBOX_GAVE_UP`·`QUOTA_EXCEEDED` 로그를 새로 남긴다. 수집 멈춤 경보는 저절로 이어받지 않는 이유(채팅 꺼짐·권한 없음·채팅 없음)만이다.
10. **워커 실패 = 바퀴 실패**: 발송함은 바퀴 안의 어떤 단계·묶음에서든 오류가 나면, 수집기는 찾기 바퀴가 던지면, 봉인은 한 범위라도 실패하면 그 바퀴를 실패로 센다.
11. **운영 상태의 "오늘 발송함"** = 실제 범위의 감사·요약 행 중 오늘(KST 0시~24시)에 생긴 것의 상태·이유별 수, "남은 일"은 날짜와 상관없는 지금의 WAITING·SENDING 수. 수집 상태는 STARTING·RETRYING·STOPPED를 이유별로(나머지는 수만). 할당량은 프로젝트 합계만(판매자 숫자 없음).
12. **확인 조회의 "모두 봄"(AC-I3-86)**: 실시간 채팅은 받은 쪽이 요청한 최대 수보다 적거나 다음 쪽이 없으면, 댓글은 기준 시각보다 이른 항목이 나오거나 다음 쪽이 없으면 끝까지 본 것이다. 가짜 서버는 이제 `maxResults`를 따른다(서버 쪽 크기 상한과 작은 쪽) — 실제 API처럼. 시험·E2E는 확인 조회 한 쪽 크기를 가짜 서버의 상한 이하로 둔다(`OutboxTiming.liveChatLookupPage`).
13. **조회 횟수(AC-I3-87)**: 바퀴마다 하는 "수집기가 본 우리 메시지" 확인은 유튜브를 부르지 않아 세지 않는다(같은 글을 게시하는 중인 다른 묶음이 있으면 거기서 기다린다 — 그 묶음의 응답은 10초 안에 끝나고 임대는 60초). 이른 조회 1번 + 끝 조회 3번(조회 실패·짝짓기 미룸 모두 1번)이고, 확인 중인 행의 `next_at`을 "다음 조회를 해도 되는 시각"으로 써서 10초 간격을 지킨다(새 칸 없음).
14. **채널에 묶인 토큰(AC-I3-85)**: 토큰을 꺼내는 행 읽기에서 채널을 같이 보고, 새로 고친 토큰도 그 토큰을 만든 연결의 채널을 함께 돌려받아 견준다. 다르면 게시는 `FAILED(NOT_MY_CHANNEL)`(보내는 중인 그 묶음), 조회는 실패한 조회.
15. **배포**: 이미지의 `pg_dump`는 데비안 bookworm의 PostgreSQL 15 클라이언트다 — DB가 16 이상이면 같은 메이저의 `pg_dump`가 있는 곳에서 돌리라고 문서에 적었다. `.env.example`의 `PORT=3000`을 `PORT=`로 비웠다(AC-I3-74 "값이 비어 있다" — 서버는 비우면 3000). 이미지에는 pnpm이 없어 문서의 컨테이너 명령은 `node apps/server/src/commands/<이름>.ts`다.
16. **운영 시작의 화면 폴더 검사**는 `createServer`도 한 번 더 한다(조립을 다른 곳에서 해도 index.html 없는 폴더로 서버가 뜨지 않게). 운영 토큰 32자·프록시 수 0~5도 같다.

### 바꾼 기존 테스트 (약화 아님 — 계약이 바뀌었다)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| 로그인 응답 `{ seller, loginId }`·내 정보 `{ seller, loginId }` (`auth.test.ts` 두 곳) | `role: 'SELLER'`(내 정보는 `assistant: null`도) | AC-I3-61·63 |
| E2E 기동의 내 정보 (`e2e.test.ts`) | 같은 칸 더함 | AC-I3-61 |
| `ENGINE_FAILED` 로그 기록 모양 (`write-path.test.ts`) | `seller`(서버가 만든 판매자 ID) 더함 | AC-I3-82 (경보는 같은 판매자로 묶는다) |
| 발송함 행 모양 (`youtube-outbox.test.ts` AC-Y1-39) | `confirmedBySeller`·`dismissed`·`dismissedAt` 더함 | AC-I3-36 |
| AC-Y1-92 "확인 중(SENDING)에 채널이 바뀐 감사 → 다시 시도에서 NOT_MY_CHANNEL" (`youtube-followup.test.ts`) | → `UNCONFIRMED` (게시 0번·요약 댓글 NOT_MY_CHANNEL은 그대로) | AC-I3-85·86 / D-I3-17 (1)(2): 확인 조회도 이은 채널(A)의 토큰으로만 — C로 바뀌면 조회할 수 없어 "모름"이다. 전에는 C의 토큰으로 조회해 "못 찾음" → 다시 시도로 갔다 |
| 골든 합계 (`core-adapter.test.ts`) | 파일 23 · 파서 385 · 엔진 122 · 통과 507 | AC-I3-95 (G-ENG-701) |

### 시험 (내 영역, 새 파일 9개)
`i3-accounts`(보조자·허용 목록 전 경로 훑기·가게 이름·마법사·공통 규칙) · `i3-login-limit` · `i3-deploy`(화면·머리글·시작 검사·준비 확인·운영 상태·경보) · `i3-deploy-files`(Dockerfile·.dockerignore·.env.example·DEPLOY.md 맞대기) · `i3-backup`(가짜 pg_dump) · `i3-e2e-server` · `youtube-i3-outbox`(게시됨 확인·알림에서 빼기) · `youtube-i3-followup`(AC-I3-85~88) · `youtube-i3-ops`(유튜브 경보·운영 상태).

### disputesWithSpec
- **AC-I3-88 "기다리는 중에 채널을 바꾸면 그 행은 다음 차례에 FAILED(NOT_MY_CHANNEL)"**: 실제로 채널을 바꾸는 길은 "연결 끊기 → 다른 채널 연결"뿐이고(같은 판매자가 다른 채널로 다시 승인하면 `CHANNEL_MISMATCH`), **끊기는 그때 기다리던 행을 모두 `FAILED(NO_CONSENT)`로 바꾼다**(Y1 계약 "끊으면 동의도 꺼진다… 기다리던 행은 '자동 게시에 동의하기 전의 감사예요.'", AC-Y1-06·D-Y12). 그래서 실제 흐름의 결과는 `NO_CONSENT`이고, `NOT_MY_CHANNEL`은 끊기의 정리를 거치지 않고 연결의 채널이 바뀐 경합(다른 서버)에서만 나온다. 시험은 둘 다 넣었다: 연결 행의 채널만 바꾼 경합 → 다음 차례 `NOT_MY_CHANNEL`·게시 0번(네 이유 모두), 실제 흐름(끊기 → C 연결·동의) → `NO_CONSENT`·게시 0번(네 이유 모두). 어느 쪽이든 다른 채널로 게시는 0번이다(안전 조건). 기준 문장을 "끊기의 정리를 거치지 않은 채널 변경"으로 고칠지 spec-keeper 판정을 바란다 — 구현은 끊기의 동작(Y1 계약)을 바꾸지 않았다.
- (참고, 다툼 아님) AC-Y1-92의 "보내는 중 행은 확인을 마치고 확인 실패 뒤 다시 시도할 때 NOT_MY_CHANNEL"은 AC-I3-85·86으로 결과가 `UNCONFIRMED`가 된다(위 표). 게시 0번은 그대로다.

### verify
- `E2E_PORT_OFFSET=700 pnpm verify` (작업 폴더 `livejjim-wt/i3`, 커밋 34b7648 뒤 — 그 뒤 커밋은 시험 하나·문서뿐): **7단계 모두 통과** — typecheck(설정 8 · TS 파일 340) · lint(0·0) · test(파일 109 · 2313) · golden(파일 23 · 파서 385 · 엔진 122 · 통과 507) · adversarial(파일 36 · 660) · e2e(파일 22 · 통과 133) · coverage(라인 100% · 분기 99.65%).
- 보호 경로 게이트 `node scripts/harness/check-protected.mjs f55a18e` 통과.

## dev-web

### 만든 것 (AC별)
| AC | 무엇 | 어디 (`apps/web/src`) |
|---|---|---|
| 01~05·37 | 설정 "유튜브" 칸: 준비 안 된 서버 한 줄 · 연결 안 됨(권한 안내 + "구글로 유튜브 연결하기") · 연결됨(채널 이름·읽기/글쓰기 권한·동의 상태·사용량·"연결 끊기") · 다시 연결 필요("다시 연결하기", 동의가 켜져 있으면 글쓰기 권한 안내). 돌아온 결과 문장은 `role=status` 한 번, 주소의 `?youtube=`는 `replaceState`로 지운다. 끊기 확인 창(처음 포커스 "그대로 두기", 채팅을 받는 실제 방송 제목) | `components/YoutubeConnection.tsx`·`SettingsPage.tsx`·`lib/google-return.ts` |
| 10~14 | "구매 감사 메시지": "만들기"(thanks.* 세 칸·저장) / "자동 게시 동의"(켜기는 설명 창 → "동의해요", 끄기는 바로) / "지금 설정의 결과"(대상마다 한 줄 — 저장된 규칙·지금 동의로만) / "미리 보기"·문자찜 안내 | `components/ThanksSettings.tsx` |
| 20~27 | 콘솔 "유튜브" 칸(스크롤 영역): 리허설 안내(요청 없음) · 준비 안 된 서버 한 줄(연결 조회 하나뿐) · 연결 안 됨/다시 연결 필요 → 설정 유튜브 칸 링크 · 잇기(내 라이브 목록·주소 붙여넣기 Enter 확인 · 같은 요청 번호 재시도) · 수집 상태(서버 문장·받은 수·마지막 채팅 KST·잇기 전 채팅·끊긴 동안) · 잇기 해제 확인 · 시청자 알림("라이브찜에서도 차단" → 기존 차단 창, 이미 차단이면 "차단함") | `components/ConsoleYoutube.tsx` |
| 25·38 | 콘솔 고정 영역: 수집 멈춤 경고 한 줄(`role=alert`, 다시 연결하는 중은 10초 넘을 때만) + "다시 연결하기"/"채팅 다시 받기", 사용량 모드가 바뀌면 알림 한 번(`role=status`, 10초) | `ConsoleYoutube.tsx`(`CollectorWarningBar`·`QuotaToast`)·`lib/youtube.ts` |
| 30~35 | 알림 띠 "감사 실패 n"(할 일이 있는 실패만, Alt+1 마지막) · "감사 메시지" 목록 창(확인이 필요한 감사 → 자동으로 보내지 않은 감사 → 기다리는 중·보내는 중 → 보냄(접힘)) · 다시 보내기·확인하지 못한 감사 경고·확인 창 둘·알림에서 빼기·다른 채널·글쓰기 권한 창 · 봉인·리허설 | `ConsoleYoutube.tsx`(`OutboxDialog`)·`AlertStrip.tsx`·`ConsolePage.tsx` |
| 40·41 | 봉인 예고(방송 목록 줄·구매자·정산, 7일 전부터 경고 상자) · 봉인한 날짜(콘솔·구매자·정산 "볼 수만 있어요", 쓰기 칸·버튼 잠금 + 쓰기 함수도 요청 없음, 채팅 칸 서버 문장, 문자찜 입력의 방송 고르기에서 뺌) · 연 채 봉인되면(SSE) 전체 한 번 다시 받고 증분 조회 없음 | `SealNotice.tsx`·`Lock.tsx`·`lib/read-only.ts`·`lib/console-store.ts`·`lib/scope-data.ts`(봉인 장부 빈 칸 채우기)·`SmsPage.tsx` |
| 44~47 | 메뉴 "설정"(휴대폰 아래 막대 다섯 칸 — 글자 16px·44px 안) · `/settings` 일곱 칸 · 판매 규칙 낱말 표 그대로(더 보기 접힘·경고 한 줄) · 칸마다 저장(바뀐 키만) · 진행 중 방송 안내 · 저장하지 않은 값이 있으면 떠나기 창("저장하지 않은 값이 있어요. 떠나면 저장하지 않아요." / "저장하지 않고 떠나기") · 가게 이름(위 줄이 바로 바뀜) | `SettingsPage.tsx`·`RuleFields.tsx`·`lib/settings-fields.ts`·`lib/leave-guard.ts`·`TopBar.tsx` |
| 50~56 | 시작 마법사 `/start`: 방송 목록(`/`)에 왔을 때만 열림(실제 방송 없음 + 처음·진행 중), 단계 글자 "1/5 가게 이름"…, 이전·다음·나중에 할게요, 단계를 옮기면 `PUT /api/wizard`, 포커스는 단계 제목 | `WizardPage.tsx`·`HomePage.tsx`·`wizard/PrinterStep.tsx`(I1 자리) |
| 63·64 | 보조자 계정: 로그인 → `/sms`, 위 줄 "보조자", 메뉴 문자찜 입력뿐, 다른 주소는 안내 + "문자찜 입력으로 가기"(데이터 요청 없음), 리허설 방송은 고르지 않음 / 설정 보조자 관리(한 번만 보이는 창·복사·5명·지우기 확인) | `App.tsx`·`TopBar.tsx`·`SmsPage.tsx`·`AssistantsSection.tsx` |
| 77·78 | `/privacy`·`/terms` 초안(로그인 없이 — 세션 확인을 기다리지 않는다), 로그인 화면·설정 그 밖·유튜브 권한 안내에서 링크 | `PolicyPages.tsx`·`LoginPage.tsx` |
| 92 | 실시간: 콘솔·구매자·정산은 범위 저장소의 같은 SSE 연결로 `youtube`를 받고(새 연결 없음), 다시 붙으면(두 번째 `ready`) 유튜브 상태를 모두 다시 받는다. 설정·마법사는 `useLiveEvents`(연결 하나) | `lib/console-store.ts`(`onYoutube`·`onReconnect`)·`lib/live-events.ts` |
| 93 | Playwright 묶음 셋 더함(아래 "테스트(test-e2e)에게") | `playwright.config.ts`·`e2e/build.ts` |

### 테스트(test-e2e)에게 — 묶음·선택자·조작
**묶음** (`apps/web/playwright.config.ts` 머리 표, 포트는 모두 `+ E2E_PORT_OFFSET`):

| 프로젝트 | 화면 | 서버 | 가짜 유튜브 | 서버 선택 | 고르는 제목 태그 |
|---|---|---|---|---|---|
| chromium | 5173 | 3100 | — | 유튜브 준비 안 됨(503) | 태그 없음 |
| chromium-youtube | 5176 | 3103 | 4100 | `--youtube fake --outbox-fast yes` | `@youtube` |
| chromium-quota | 5177 | 3104 | 4101 | 위 + `--youtube-quota-budget 400` | `@quota` |
| chromium-served | 3105 | 3105 | — | `--web-dir test-results/e2e-served-web`(띄우기 전에 운영용 빌드) | `@served` |

- 가짜 유튜브 주소: `import { fakeYoutubeUrl } from '../../../apps/web/playwright.config.ts'` → `fakeYoutubeUrl(test.info().project.name)` (= `http://127.0.0.1:<4100+offset>`). 조작은 Y1 dev-notes "화면(I3)에게" 8 (`/_fake/channels`·`/_fake/approval`·`/_fake/broadcasts`·`/_fake/messages`·`/_fake/fail`·`/_fake/revoke-all`·`/_fake/drop-streams`·`GET /_fake/state`). 가짜 승인은 화면 없이 바로 돌려보낸다(302) — `/_fake/approval { account, channel }`을 먼저 적어 둔다.
- E2E 서버 조작(모든 묶음, 그 묶음의 서버 주소 `http://127.0.0.1:<api>`): `POST /_e2e/sellers {}` → 새 판매자(마법사 "처음"·방송 없음), `POST /_e2e/dates { loginId, kind: 'sealed'|'sealSoon'|'youtube' }`, `POST /_e2e/seal { loginId, date }` (서버 dev-notes "화면에게" 8).
- **시험 계정 `e2e-shop`은 마법사 "마침"이다**(아래 "다른 영역 변경"). 마법사가 저절로 열리는 시험은 `/_e2e/sellers`의 새 판매자로 한다.
- 작은 할당량 묶음은 프로젝트 한도도 400이라 그 묶음의 시험이 함께 쓴다(묶음 < 80 남음, 멈춤 < 20 남음). 다른 예산이 필요하면 dev-web에 알려 주면 바꾼다.
- `UNCONFIRMED` 만들기 참고: `acceptHang`만으로는 수집기(스트림)가 우리 글을 봐서 `SENT`가 된다 — 스트림·목록 조회도 막아야 한다(서버 dev-notes AC-I3-86·87).

**선택자** (역할·이름 — 문장은 수용 기준 그대로):
- 설정: `region` 이름 = 칸 제목("가게"·"판매 규칙"·"배송비"·"구매 감사 메시지"·"유튜브"·"보조자"·"그 밖"). 칸마다 버튼 "저장"(칸 안에서 찾기). 선택 칸은 `radiogroup`(이름 = 칸 이름) 안의 `radio`(이름 = 선택지 낱말), 켜기/끄기 칸은 `checkbox`(이름 = 칸 이름), 숫자·돈 칸은 `getByLabel(칸 이름)`. "더 보기 (잘 모르면 그대로 두세요)"는 `aria-expanded` 버튼.
- 감사 메시지: 동의 버튼 "실시간 채팅 자동 게시 켜기/끄기"·"영상 댓글 자동 게시 켜기/끄기", 설명 창 `dialog` 이름 "실시간 채팅 자동 게시"/"영상 댓글 자동 게시"(버튼 "동의해요"·"닫기"), 결과 한 줄은 `region` "지금 설정의 결과"("실시간 채팅 — …", "영상 댓글 (판매마다) — …"), 미리 보기 `region` "미리 보기".
- 유튜브 칸: "구글로 유튜브 연결하기"·"다시 연결하기"·"연결 끊기", 끊기 `dialog` "유튜브 연결을 끊을까요?"(버튼 "연결 끊기"·"그대로 두기"), 사용량 `group` "유튜브 사용량".
- 콘솔: `region` "유튜브"(버튼 "내 라이브 목록에서 고르기" → `radio` 이름 = 제목 + "방송 중"/"예정 …" → 버튼 "이 방송에 잇기"; 칸 "주소 붙여넣기" + Enter(또는 "주소 확인") → "읽은 영상: <ID>" → "이 방송에 잇기"(목록의 것과 이름이 같다 — 마지막 것); `group` "채팅 수집"; "유튜브 방송 연결 끊기" → `dialog` "유튜브 방송 연결 끊기"; "감사 메시지"; `region` "시청자 알림"(제목 "시청자 알림 n")). 멈춤 경고는 고정 영역(`.console-sticky`)의 `alert`. 알림 띠 `region` "알림"의 버튼 "감사 실패 n".
- 감사 메시지 목록 `dialog` "감사 메시지": 묶음은 `region` "확인이 필요한 감사"·"자동으로 보내지 않은 감사"·"기다리는 중·보내는 중"·"보냄"(제목 "… n", 보냄은 "펼치기"). 줄(`li`) 안 버튼 "다시 보내기"·"유튜브에 올라가 있어요"·"알림에서 빼기". 확인 창 `dialog` "유튜브에 이 글이 없는 걸 확인했나요?"("없어요, 다시 보내기"·"그만두기"), "유튜브에 이 글이 올라가 있는 걸 확인했나요?"("올라가 있어요"·"그만두기"), 글쓰기 권한 `dialog` "글쓰기 권한 받기"("구글로 가기"·"닫기"). 창은 하나씩만 보인다(확인 창이 뜨면 목록 창은 그 아래로 — 닫으면 돌아온다).
- 마법사: 단계 제목 `heading` level 2 "n/5 …", 단계 목록 `list` "단계", 2단계 줄마다 "<줄 이름> 바꾸기"(예: "대기 인원 바꾸기").
- 보조자: 이름 칸 "보조자 이름", "보조자 만들기", 만든 창 `dialog` "보조자 <이름>을(를) 만들었어요"(`dd` 둘 = 아이디·비밀번호, "아이디 복사"·"비밀번호 복사"·"다 적었어요"), 지우기 버튼 이름 "<이름> 지우기" → `dialog` "보조자 <이름>을(를) 지울까요?".

### 결정과 이유 (수용 기준 문장 안에서의 구현 선택)
1. **마법사의 "요청을 보내지 않는다"(AC-I3-51·52)는 가게 이름·설정 저장 요청**이다 — 단계를 옮길 때의 `PUT /api/wizard`는 AC-I3-50("단계를 옮길 때 상태(단계)를 서버에 적는다")대로 보낸다. "처음" 상태로 열기만 해서는 적지 않는다(마치거나 닫은 계정이 `/start`를 다시 열어도 다시 켜지지 않게 — "다시 하기"만 1단계 진행 중으로 적는다).
2. **구글에서 돌아오는 주소는 서버가 늘 `/settings/youtube?youtube=`** — 마법사 4단계에서 떠날 때만 이 탭 sessionStorage에 `'wizard'` 표시 하나를 두고(주소가 아니다), 돌아오면 앱이 `/start?youtube=`로 바꿔 4단계에 결과 문장을 보인다(AC-I3-54). 승인 주소는 어디에도 두지 않는다.
3. **실시간**: 콘솔·구매자·정산은 범위 저장소의 SSE 연결 하나로 `youtube`를 받는다(연결을 더 열지 않는다). 연결·동의·사용량·알림은 알림의 값으로 바로 바꾸고, 수집 상태는 알림의 값 + 잇기 상태 다시 받기, 발송함은 날짜가 맞으면 모아서(250ms) 다시 받는다. "받은 채팅 n개"는 수집 알림이 상태가 바뀔 때만 오므로 새 채팅이 들어오면 잇기 상태를 모아서(700ms) 다시 받는다.
4. **멈춤 경고의 할 일 버튼**: 이유가 `RECONNECT`·`NOT_CONNECTED`면 "다시 연결하기" 하나만 보인다. 서버는 이 이유에도 `restartable: true`를 주지만(Y1 계약은 "조건이 풀리면 저절로 이어받는다") 연결을 고치기 전에 다시 받기를 누르면 같은 이유로 다시 멈춰 헷갈린다 — disputes 1.
5. **봉인한 날짜 잠금**은 둘이다: 화면(쓰기 영역·창 안을 `disabled` fieldset으로 — 브라우저가 누름을 보내지 않는다) + 쓰기 함수(콘솔·구매자·정산의 `command`·5초 조치가 봉인이면 요청을 만들지 않는다). 봉인 장부는 조회 결과의 일부 칸만 있어(Y1 계약 5) 화면이 빈 칸(대기·보류·충돌·설정 스냅샷 등)을 "없음"으로 채워 같은 모양으로 그린다 — 판정을 새로 하지 않는다.
6. **알림 띠 "감사 실패"는 서버가 셈을 주지 않으므로** 그 날짜 발송함 목록에서 센다(서버 dev-notes 6). 리허설은 발송함을 부르지 않는다. 준비 안 된 서버는 연결 조회(503) 하나만 부르고 다른 유튜브 요청을 보내지 않는다.
7. **설정 "만들기"·판매 규칙의 숫자 칸**은 적은 글자를 그대로 정수로 읽어 보낸다(쉼표 허용, 돈 칸은 원 단위 `parseAmount`). 숫자로 읽지 못한 글자·범위 밖은 화면이 거르지 않고 보내 서버(코어 `checkSettings`) 문장을 그 칸 옆에 보인다(AC-I3-10 "서버 problems 문장").
8. **다른 기기에서 판매 규칙을 저장한 것**은 알림이 없다(서버가 설정 변경 알림을 내지 않는다) — 설정 화면은 다음에 열 때 바뀐다. 동의·연결·사용량은 1초 안에 바뀐다(AC-I3-04·13의 "다른 기기 SSE"는 이것).
9. **휴대폰 메뉴 다섯 칸**: 메뉴 수만큼 같은 폭(`grid-auto-flow: column`), 글자 1rem·줄 간격 1.2로 "문자찜 입력"이 두 줄이 되어도 44px 안 — 아래 막대 높이(53px)는 그대로다(AC-S06-61 고정 영역 기준 유지).
10. **보조자 계정이 `/`를 열면** 안내를 보인다(AC-I3-63 목록에 `/`가 있다). 로그인 직후에만 `/sms`로 보낸다.

### 다른 영역 변경 (최소)
- **dev-server 영역 `apps/server/src/e2e.ts`**: E2E 시험 계정(`e2e-shop`)의 마법사 상태를 시작할 때 "마침"으로 적는다(+ 시험 `apps/server/test/i3-e2e-server.test.ts`에 한 개). 이유: 화면이 실제 방송 없는 "처음" 계정에 마법사를 저절로 열므로(AC-I3-50), 그대로 두면 기존 E2E(S05·S06 — 로그인 뒤 방송 목록)가 모두 `/start`로 간다. 마법사 시험은 `/_e2e/sellers` 새 판매자로 한다.

### 바꾼 기존 시험 (약화 아님 — 계약이 바뀌었다)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| 로그인 화면에 링크 0개 (`App.test.tsx`) | 링크는 정책 초안 둘(`/privacy`·`/terms`)뿐, "가입" 글자 없음은 그대로 | AC-I3-77 |
| 메뉴 넷 (`pwa.test.tsx`) | 메뉴 다섯("설정" 더함) | AC-I3-44 |
| 웹 서버 수 = 묶음 × 2 (`e2e-config.node.test.ts`) | 서버가 화면을 내는 묶음은 하나(빌드 + 서버), 새 묶음의 가짜 유튜브·태그·포트 겹침 검사 더함 | AC-I3-93 |
| 콘솔 값 모양 (`console-flows.test.tsx`의 `fakeApi`) | `sealed: false` 칸 더함 | AC-I3-41 |

### 시험 (내 영역, 새 파일 5개 · 88개)
`i3-lib`(셈·묶음·경고·모드 알림·봉인 7일·KST 낱말·판매 규칙 칸·주소) · `settings-page`(설정 전체 — 칸·저장·떠나기·동의·유튜브 칸·끊기·실시간·가게 이름·보조자) · `wizard-app`(마법사 열리는 때·단계·구글 갔다 오기·리허설 한 번·보조자 화면 요청 0·정책 페이지) · `console-youtube`(준비 안 됨·리허설 요청 0·잇기·재시도 같은 요청 번호·해제·수집 상태·멈춤 경고·감사 실패·목록·확인 창·다른 채널·권한 창·사용량 알림·시청자 알림·다시 붙음·봉인) · `seal-pages`(봉인 예고·봉인 잠금·문자찜 방송 고르기).
- 손으로 돌려 본 것(가짜 유튜브 E2E 서버 + 크로미움, 시험 파일 아님): 새 판매자 → 마법사 → 4단계에서 연결 → 돌아와 4단계 결과, 설정 동의(글쓰기 권한 승인 → 켜짐), 콘솔 잇기·시청자 채팅·15번 감사 게시 1번·게시 거절 → "감사 실패 1" → 다시 보내기 → 게시·알림 사라짐, 봉인 예고·봉인 잠금·연 채 봉인(증분 조회 0번), 보조자 만들기 → 다른 브라우저 로그인 → `/sms`(요청 7종뿐) → 지우면 로그인 화면, 권한 거두기 → 고정 영역 경고(375×812 고정 영역 153px ≤ 284px), 375px 새 화면 모두 가로 스크롤 0·글자 16px·누르는 곳 44px·금지 낱말 0, 서버가 화면을 내는 모드에서 CSP 위반 0·서비스 워커 등록.

### disputesWithSpec
1. **AC-I3-25 "restartable이면 '채팅 다시 받기'"**: 서버는 멈춤 이유 `RECONNECT`(·`NOT_CONNECTED`)에도 `restartable: true`를 준다(`collectorView`: QUOTA·끝 이유만 뺀다). 그런데 Y1 계약 3은 "RECONNECT·NOT_CONNECTED·NOT_MY_CHANNEL·QUOTA는 조건이 풀리면 저절로 이어받는다. CHAT_DISABLED·FORBIDDEN·CHAT_NOT_FOUND는 판매자가 다시 시작"이다. 화면은 다시 연결해야 하는 이유에는 "다시 연결하기"만 보인다(누르면 같은 이유로 바로 다시 멈춘다). spec-keeper가 (가) 화면 그대로 (나) 서버 `restartable`을 수동 이유 셋으로 좁힘 중 판정해 주면 좋겠다 — 어느 쪽이든 판매자 안전에는 차이가 없다.
2. (참고) AC-I3-51·52 "요청을 보내지 않는다"와 AC-I3-50 "단계를 옮길 때 서버에 적는다"는 위 결정 1로 읽었다(단계 기록은 보낸다).
