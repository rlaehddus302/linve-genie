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
- `POST /_e2e/dates { loginId, kind: 'sealed'｜'sealSoon'｜'youtube', date? }` → `{ date, broadcast }` — 그 판매자의 실제 방송(제목 "지난 방송")을 그 날짜에 만들고 유튜브 채팅 하나를 받아(봉인 대상) 둔다. `sealed`면 바로 봉인, `sealSoon`이면 날짜 기본값 = 오늘(KST) − 24일(봉인 7일 전 안), `youtube`면 날짜 기본값 = 오늘 − 3일(봉인 예정만 보임).
- `POST /_e2e/seal { loginId, date }` → `{ sealed: boolean }` — 그 날짜(실제 범위)를 지금 봉인한다(열린 화면이 봉인되는 시험 — SSE `sealed`).
