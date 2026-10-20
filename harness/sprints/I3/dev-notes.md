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
