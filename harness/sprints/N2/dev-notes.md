# N2 개발 노트

## dev-server

### 만든 것 (파일)
- `apps/server/src/platform.ts` — 플랫폼 값(`YOUTUBE`·`INSTAGRAM`·`TIKTOK`)·키 접두어(`ig:`·`tt:`·`sms:`)·`platformOfKey`·`prefixedKey`(256자)·능력 표·공통 어댑터 모양(`LiveSource`·`ThanksSender`).
- `apps/server/src/live-links.ts` — 회차의 라이브 연결(기다리기·잇기·끊기·저절로 잇기·수집 상태). `apps/server/src/seller-locks.ts` — 판매자마다 한 줄 처리(프로세스 안).
- `apps/server/src/instagram/` — `config.ts`(설정)·`meta.ts`(메타 HTTP 어댑터·오류 분류)·`adapters.ts`(공통 어댑터의 인스타그램 구현)·`crypto.ts`(토큰 암호화·state 해시)·`connection.ts`(계정 연결·동의)·`webhook.ts`·`dm.ts`(DM 실행기)·`notices.ts`(SSE)·`routes.ts`·`store.ts`·`text.ts`·`fake-meta.ts`(가짜 메타 서버)·`index.ts`(조립).
- `Service.ingestOpenChat` — `ingestChat`과 같은 기록(허용 필드·조치자 `collector`·같은 메시지 ID 한 번)이고, 그 방송이 이미 끝났으면(같은 범위 줄 안에서 판단) 기록하지 않는다.
- 마이그레이션 `0004_n2_instagram.sql` — `ig_connections`·`ig_oauth_states`·`live_links`·`live_unlinked`·`live_requests`·`ig_dm_sends`·`ig_dm_rows`. **발송함 `outbox` 표는 그대로**(D-N2-01). DM 행은 발송함 POST_THANKS 행이 생기는 같은 트랜잭션(`ScopeWriter.txHook` — 출력 기록과 함께)에서 만든다.
- 골든 러너 `SCENARIO_ID_RE` 한 줄·오류 문장(AC-N2-80), 러너 자체 시험 `scenario-id.test.ts`, 합계 교체(AC-N2-81).

### 화면에게 (AC-N2-71)
모든 `/api/**`는 기존 공통 규칙(로그인·Origin·JSON·64KB·`Cache-Control: no-store`)을 그대로 탄다. 오류 본문은 `{ error: { code, message, problems? } }`이고 `message`는 판매자에게 그대로 보여 줄 문장이다(받은 값은 되돌려 보내지 않는다). 다른 판매자의 회차·DM 행은 404. 시각은 UTC ISO.

#### 1. 플랫폼 공통
| 경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/platforms` | | `{ platforms: PlatformCapability[] }` |
| `GET /api/live` | | `{ links: LinkView[] }` — 이 판매자의 끊지 않은 연결 전부(수집 상태와 함께) |
| `GET /api/broadcasts/:id/live` | | `{ link: LinkView }` |
| `POST /api/broadcasts/:id/live/wait` | `{ requestId, platform }` | `{ link }` — "인스타그램 기다리기" |
| `POST /api/broadcasts/:id/live/link` | `{ requestId, platform, liveId }` | `{ link }` — `liveId`는 `GET /api/instagram/lives`에서 고른 것 |
| `POST /api/broadcasts/:id/live/unlink` | `{ requestId }` | `{ link }` (state `NONE`) |

같은 `requestId`는 처음 응답 그대로(한 번만 한다). 받지 않는 경우(409, 아무것도 바꾸지 않음):

| code | message |
|---|---|
| `PLATFORM_NOT_SUPPORTED` | 틱톡 라이브는 아직 지원하지 않아요. |
| `PLATFORM_NOT_READY` | 유튜브 라이브는 아직 이 서버에서 이을 수 없어요. (이 바탕엔 유튜브 연동이 없다 — Y1과 합칠 때 바뀜) |
| `NOT_CONFIGURED` | 인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요. |
| `REHEARSAL` | 리허설 방송에는 라이브를 이을 수 없어요. |
| `ENDED` | 끝난 방송에는 라이브를 이을 수 없어요. |
| `ALREADY_LINKED` | 이 방송에는 이미 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요. |
| `RECEIVED_TIME_NOT_ALLOWED` | 인스타그램 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요. |
| `NOT_CONNECTED` | 인스타그램 계정을 먼저 연결해 주세요. |
| `RECONNECT_NEEDED` | 인스타그램 연결을 다시 해 주세요. (잇기 — 라이브 목록을 받아야 해서) |
| `NOT_LIVE` | 진행 중인 내 인스타그램 라이브만 이을 수 있어요. |
| `LIVE_TAKEN` | 이미 다른 방송에 이어진 인스타그램 라이브예요. |
| `NOT_LINKED` | 이어진 라이브가 없어요. (끊기) |
| `UNAVAILABLE` (503) | 인스타그램에서 라이브 목록을 받지 못했어요. 잠시 뒤 다시 해 주세요. |

`platform`·`liveId` 형식이 틀리면 400 `INVALID_INPUT`(`problems[].field`).

```ts
PlatformCapability = { platform: 'YOUTUBE'|'INSTAGRAM'|'TIKTOK', ready: boolean, receivedTime: boolean, thanks: 'PUBLIC_CHAT'|'DM_PER_COMMENT'|'NONE', videoComment: boolean,
  reasons: { ready?, receivedTime?, thanks?, videoComment? } /* 쓸 수 없는 것마다 문장 */ }
LinkView = { broadcast, platform: 'INSTAGRAM'|null, state: 'NONE'|'WAITING'|'LINKED', liveId /* LINKED일 때 */, linkedAt /* 이은(기다리기로 정한) 시각 */,
  actor: { kind: 'account'|'server' /* 저절로 이음 */, loginId } | null, accountId /* 이을 때 연결돼 있던 인스타 계정 ID */, collection: CollectionView | null }
CollectionView = { platform: 'INSTAGRAM', state: 'WAITING'|'LIVE'|'FINISHED'|'STOPPED', message /* 아래 문장 */, liveId, lastCommentAt, comments, late, malformed }
```
수집 상태 문장: `WAITING` "인스타그램 라이브를 기다리는 중이에요. 라이브를 시작하면 첫 댓글부터 받아요." · `LIVE` "댓글을 받는 중" · `FINISHED` "방송을 끝내 댓글 기록을 마쳤어요." · `STOPPED` "인스타그램 연결이 끊겨 댓글을 받지 않아요."

#### 2. 인스타그램 계정 연결
| 경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/instagram` | | `{ connection: ConnectionView }` |
| `POST /api/instagram/connect` | `{}` | `{ url }` — 브라우저를 이 주소로 보낸다(연결·다시 연결 같음). 409 `NOT_CONFIGURED` |
| `GET /api/instagram/callback?code&state[&error]` | | **로그인 없이 닿는다**(메타가 돌려보냄). 302 → `LIVEJJIM_APP_ORIGIN + LIVEJJIM_IG_RETURN_PATH(기본 /) + ?instagram=<결과 코드>` |
| `POST /api/instagram/disconnect` | `{}` | `{ connection }` (NOT_CONNECTED) |
| `POST /api/instagram/consent` | `{ on: boolean }` | `{ permissionRequired: false, connection }` 또는 메시지 권한이 없으면 `{ permissionRequired: true, url, connection }`(그 주소로 보내 권한을 받아 오면 그때 켜진다). 409 `NOT_CONFIGURED`·`NOT_CONNECTED` |
| `GET /api/instagram/lives` | | `{ lives: [{ id, startedAt, broadcast /* 이미 이어진 이 판매자의 끝나지 않은 회차 ID 또는 null */ }] }` · 409 `NOT_CONFIGURED`·`NOT_CONNECTED`·`RECONNECT_NEEDED` · 503 `UNAVAILABLE` |
| `GET /api/instagram/unlinked` | | `{ lives: [{ platform, liveId, count, firstAt, lastAt }], malformed /* 형식 틀린 댓글 수(판매자 단위) */ }` |

```ts
ConnectionView = { configured, status: 'NOT_CONNECTED'|'CONNECTED'|'RECONNECT_NEEDED', login: 'FACEBOOK'|'INSTAGRAM'|null,
  account: { id, username, type: 'BUSINESS'|'CREATOR'|null } | null, permissions: { comments, messages },
  consent: { on, by /* 켠 로그인 아이디 */, at } }   // 토큰·만료 시각은 없다
```
돌아오기 결과 코드(`?instagram=`) — 화면 문장은 `CALLBACK_MESSAGES`(`src/instagram/connection.ts`)와 같다:

| 코드 | 문장 |
|---|---|
| `CONNECTED` | 인스타그램 계정을 연결했어요. |
| `CONSENT_ON` | 인스타그램 DM 자동 발송을 켰어요. (동의 켜기에서 권한을 받아 옴) |
| `NO_MESSAGE_PERMISSION` | DM을 보내는 권한을 허락하지 않아 자동 발송을 켜지 못했어요. |
| `STATE_INVALID` | 연결 시간이 지났어요. 다시 시도해 주세요. |
| `DENIED` | 인스타그램 연결을 허락하지 않았어요. 다시 시도해 주세요. |
| `NO_ACCOUNT` | 연결할 수 있는 인스타그램 프로페셔널(비즈니스·크리에이터) 계정이 없어요. |
| `MANY_ACCOUNTS` | 인스타그램 계정을 하나만 골라 다시 연결해 주세요. |
| `NO_COMMENT_PERMISSION` | 댓글을 읽는 권한을 허락해야 연결할 수 있어요. 다시 연결해 주세요. |
| `ACCOUNT_TAKEN` | 이 인스타그램 계정은 연결할 수 없어요. 운영자에게 문의해 주세요. |
| `OTHER_ACCOUNT` | 처음 연결한 계정과 달라요. 바꾸려면 먼저 연결을 끊어 주세요. |
| `SUBSCRIBE_FAILED` | 인스타그램 댓글 받기를 켜지 못했어요. 잠시 뒤 다시 연결해 주세요. |
| `CONNECT_FAILED` | 인스타그램 연결을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요. (메타가 code 교환에 실패 — 수용 기준 목록 밖이라 더함) |
| `NOT_CONFIGURED` | 인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요. |

#### 3. 감사 DM
| 경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/instagram/dms?date=YYYY-MM-DD[&rehearsal=true]` | | `{ date, rehearsal, rows: DmRowView[] }` — 실제 범위만(리허설은 빈 목록) |
| `POST /api/instagram/dms/:id/resend` | `{ requestId }` | `{ result: 'QUEUED'|'SKIPPED'|'ALREADY_SENT'|'ONE_REPLY', message, rows: DmRowView[] /* 바뀐 행 */ }` |

수동 재전송 거절(409): `DM_NOT_RESENDABLE` "다시 보낼 수 없는 DM이에요." · `DM_BUSY` "이 댓글의 DM을 보내는 중이에요. 잠시 뒤 다시 해 주세요." · `RECONNECT_NEEDED` "인스타그램 연결을 다시 해 주세요." · `NO_PERMISSION`·`NO_LINK`·`NOT_MY_ACCOUNT`(아래 이유 문장) · `NOT_CONFIGURED`. `SKIPPED` → message "확정이 풀린 판매라 보내지 않아요.", `ALREADY_SENT` → "이미 보낸 감사예요.", `ONE_REPLY` → 아래 ONE_REPLY 문장, `QUEUED` → message null(곧 보낸다 — 결과는 SSE `DM`).

```ts
DmRowView = { id, broadcast, product /* 효과의 상품 키 */, buyer /* 효과의 구매자 */, comment /* 받는 댓글 ig:… 또는 null */, line /* 이 행의 DM 줄 */,
  status: 'WAITING'|'SENDING'|'SENT'|'SKIPPED'|'FAILED', reason: 이유 코드 | null, message: 이유 문장 | null,
  attempts, nextAt, sentAt, metaMessageId, together: number[] /* 같은 DM의 다른 행 */, createdAt }
```
이유 코드 → 문장(`DM_REASON_MESSAGES`, `src/instagram/dm.ts`). **"감사 실패" 알림 띠는 `FAILED`만**, `SKIPPED`는 알림이 아니다.
- WAITING: `RETRY` 보내지 못해 잠시 뒤 다시 보내요. · `RECONNECT` 인스타그램 연결을 다시 하면 보내요. · `PREVIOUS` 이 댓글의 앞 DM 결과를 기다리는 중이에요. · `null` = 곧 보냄(수용 기준에 없는 경우 — 막 생긴 행)
- SENDING: `CONFIRM` 보내졌는지 확인하는 중이에요. · `null` = 보내는 중
- SKIPPED: `CANCELLED` 확정이 풀린 판매라 보내지 않았어요. · `NO_RECIPIENT` 댓글로 생긴 찜이 아니라 DM을 보낼 곳이 없어요. · `NOT_SUPPORTED` 인스타그램에는 공개 댓글로 감사를 남길 수 없어요.
- FAILED: `NO_CONSENT` · `NO_LINK` · `NOT_MY_ACCOUNT` · `ONE_REPLY` · `LIVE_ENDED` · `NO_PERMISSION` · `EXPIRED` · `GAVE_UP` · `REJECTED` · `UNCONFIRMED` — 문장은 acceptance AC-N2-45 그대로.

#### 4. 실시간 (`GET /api/stream`) — 새 이벤트 `event: instagram` (seq·id 없음)
`data.kind`로 나눈다:
- `{ kind: 'CONNECTION', connection: ConnectionView }` — 연결 상태가 바뀜(연결·다시 연결 필요·끊김·동의)
- `{ kind: 'LINK', broadcast, link: LinkView }` — 잇기·기다리기·끊기·저절로 잇기
- `{ kind: 'COLLECTION', broadcast, link: LinkView }` — 수집 상태·수가 바뀜(묶어서 1초에 한 번까지, 처음은 바로)
- `{ kind: 'NOTICE', code: 'UNLINKED_COMMENTS', message, liveId, count }` · `{ kind: 'NOTICE', code: 'MANY_WAITING', message, liveId, count }` · `{ kind: 'NOTICE', code: 'LATE_COMMENTS', message, broadcast }` — 처음 한 번과 그 뒤 1분에 한 번까지
- `{ kind: 'DM', date, rows: DmRowView[] }` — 행 상태가 바뀜(같은 `id`로 덮는다)

인스타그램 댓글은 기존 `change` 알림(채팅 이벤트)·메시지 조회로 그대로 온다 — `id`·`channel`이 `ig:`로 시작하면 인스타그램(플랫폼 이름은 키 접두어 하나로 정한다, D-N2-15). 기존 구매자·메시지 조회 응답은 바꾸지 않았다.

#### 5. 웹훅 (메타가 부른다 — 화면은 쓰지 않는다)
`GET /webhooks/instagram?hub.mode=subscribe&hub.verify_token=&hub.challenge=` (확인), `POST /webhooks/instagram` (`X-Hub-Signature-256`). `/api` 밖이라 로그인·Origin 검사 밖이다. 메타 앱 대시보드에 이 주소(공개 HTTPS)와 확인 토큰을 넣고 `live_comments`를 구독한다(HG-N2).

#### 6. 설정 (환경변수 — `.env.example`에 키 목록, *는 비밀값: 시작 로그·응답에 나오지 않는다)
`LIVEJJIM_IG_APP_ID`, `LIVEJJIM_IG_APP_SECRET`*, `LIVEJJIM_IG_VERIFY_TOKEN`*, `LIVEJJIM_IG_REDIRECT_URI`(이 서버의 `/api/instagram/callback` 공개 주소) — 넷 중 하나라도 비면 인스타그램 기능은 `NOT_CONFIGURED`, 웹훅은 503, 서버는 정상 시작. 선택: `LIVEJJIM_IG_LOGIN`(FACEBOOK 기본·INSTAGRAM), `LIVEJJIM_IG_SCOPES`(쉼표 목록), `LIVEJJIM_IG_RETURN_PATH`(기본 `/`), 주소 덮어쓰기 `LIVEJJIM_IG_GRAPH_URL`·`LIVEJJIM_IG_IG_GRAPH_URL`·`LIVEJJIM_IG_FB_DIALOG_URL`·`LIVEJJIM_IG_IG_AUTHORIZE_URL`·`LIVEJJIM_IG_IG_TOKEN_URL`.

#### 7. 가짜 메타 서버 조작법 (E2E·화면 시험)
- 띄우기: `pnpm --filter @livejjim/server e2e --instagram yes [--origin http://localhost:5173] [--port 3100]` — 시작 줄에 `가짜 메타 http://127.0.0.1:<포트>`. 프로그램은 `startE2eServer({ instagram: true })` → `e2e.fakeMeta`. 운영 기동에는 없다.
- 서버 설정: 돌아오는 주소 = `<화면 주소>/api/instagram/callback`(화면 개발 서버가 `/api`를 서버로 넘긴다), 메타 주소 = 가짜 서버, 웹훅은 가짜 서버가 이 서버의 `/webhooks/instagram`으로 서명해 보낸다. 앱 ID·시크릿·확인 토큰은 그 자리에서 만든 시험 값.
- 조작 주소 (가짜 서버 주소 기준, JSON):
  - `POST /_fake/accounts { username, type?: 'BUSINESS'|'MEDIA_CREATOR'|'PERSONAL', id?, pageId? }` → `{ account }`
  - `POST /_fake/login { decision?: 'approve'|'deny', accounts: [계정 ID…], declined?: [권한 이름…] }` — 다음 승인 창에서 사용자가 할 일(승인 창은 바로 돌려보낸다)
  - `POST /_fake/live { accountId }` → `{ liveId }` · `POST /_fake/live/<liveId>/end`
  - `POST /_fake/comments { accountId, liveId, comments: [{ igsid, username, text, id? }], time? }` → 서명한 웹훅을 서버로 보내고 `{ status, ids }`
  - `POST /_fake/fault { op, fault, times? }` — `op`: token·permissions·accounts·me·subscribe·unsubscribe·revoke·refresh·liveMedia·send·conversation, `fault`: SERVER_ERROR·TOO_MANY·RATE_LIMIT·TOKEN_INVALID·NO_PERMISSION·LIVE_ENDED·ONE_REPLY·REJECTED·HANG·HANG_AFTER·DROP·`{ delayMs }`
  - `POST /_fake/invalidate { accountId? }` (토큰 무효) · `GET /_fake/state` → `{ accounts, dms, subscriptions, unsubscriptions, revocations, calls }`
- E2E에서 DM 실행기는 스스로 돈다(1초 주기, 보내기 타임아웃 10초).

### 메타 오류 코드 → 분류 (AC-N2-47, `ERROR_TABLE`·`classifyMetaError` in `src/instagram/meta.ts`)
2026-10 메타 문서 기준 **기본값**이고 가짜 서버가 같은 코드로 오류를 낸다. 실제 코드는 HG-N2(실제 라이브)에서 확인해야 한다.

| 메타 응답 | 분류 | DM 행 |
|---|---|---|
| 그래프 오류 code 190·102 | 토큰 무효 | 연결 → 다시 연결 필요, 행 `WAITING(RECONNECT)` (기한까지) |
| error_subcode 2018278 | 라이브 끝남 | `FAILED(LIVE_ENDED)` (시도 1번) |
| error_subcode 2534023 | 이미 답장한 댓글 | `FAILED(ONE_REPLY)` (시도 1번) |
| HTTP 429·5xx, code 4·17·32·613(속도 제한)·1·2(일시 오류), `is_transient: true`, 네트워크 오류 | 다시 시도 | `WAITING(RETRY)` 2·4·8·16·32초, 다섯 번 넘게 실패 → `FAILED(GAVE_UP)` |
| code 3·10·200~299 | 권한 없음 | `FAILED(NO_PERMISSION)` (시도 1번) |
| 그 밖의 400대 | 받지 않음 | `FAILED(REJECTED)` (시도 1번) |
| 보내기 10초 안에 응답 없음·연결 끊김 | 타임아웃 | `SENDING(CONFIRM)` → 대화 한 번 조회(30초): 있으면 `SENT`, 없으면 다시 시도, 조회 실패면 `FAILED(UNCONFIRMED)` |

### 구현으로 정한 세부 (수용 기준 문장에 없는 것 — 스펙과 부딪치지 않는다고 봤다)
- HTTP 상태: 업무 거절은 409(`NOT_CONFIGURED` 포함), 메타 일시 장애 `UNAVAILABLE`은 503, 입력 형식 400, 없음 404.
- `CONNECT_FAILED` 결과 코드(메타 code 교환·계정 조회 실패), `DM_BUSY`·`DM_NOT_RESENDABLE`, `PLATFORM_NOT_READY`(유튜브), `NOT_LINKED`(이어진 것 없이 끊기)를 더했다.
- `DENIED`도 state가 맞을 때만 — state가 틀리면 `STATE_INVALID`. 다른 세션의 state는 쓰지 않은 채 `STATE_INVALID`(그 세션이 나중에 쓸 수 있다).
- 형식 틀린 댓글: 판매자 단위 수(`GET /api/instagram/unlinked`의 `malformed`)는 늘 세고, 그 라이브가 회차에 이어져 있으면 그 회차의 수(`collection.malformed`)도 센다. 엔진 입력 검사에 걸린 댓글도 같은 수로 센다.
- 이어지지 않은 댓글 알림의 "1분에 한 번"은 라이브(미디어)마다. `MANY_WAITING`은 판매자마다.
- 막 생긴 WAITING 행의 이유는 `null`(곧 보냄). 수동 재전송 행은 기한이 없고 동의를 보지 않는다(동의를 꺼도 그대로).
- 동의를 끄면 자동 발송 행만 `FAILED(NO_CONSENT)`, 연결을 끊으면 수동 재전송 행까지 모두.
- 한 댓글의 기다리는 행이 5줄을 넘으면 앞 5줄만 그 DM으로 보낸다(나머지는 그 뒤 `ONE_REPLY`) — 메시지 하나의 번호 상한(D-034)이 5라 정상적인 경우엔 생기지 않는다.

### 바꾼 기존 시험 (AC-N2-82)
- `apps/server/test/commands.test.ts` 마이그레이션 명령의 표 수 15 → 22 (교체 — N2 표 일곱이 더해짐, 같은 줄의 스키마 대조는 그대로).
- `packages/core/test/golden/core-adapter.test.ts` 합계 "파일 26 · 파서 460 · 엔진 129 · 통과 589" → "파일 27 · 파서 468 · 엔진 132 · 통과 600" (AC-N2-81, 교체).
- 코어 시험 코드: `packages/core/test/golden/contract.ts` `SCENARIO_ID_RE` 한 줄, `validate.ts` 오류 문장(두 형식을 말한다). 새 러너 자체 시험 `scenario-id.test.ts`.
- `apps/server/vitest.config.ts`에 `setupFiles: ['test/network-guard.ts']`(네트워크 가드, AC-N2-62).

### 테스터에게
- `@livejjim/server` 진입점이 N2 묶음을 내보낸다: `FakeMeta`·`instagramSettings`·`readInstagramConfig`·`MetaClient`·`classifyMetaError`·`ERROR_TABLE`·`platformOfKey`·`prefixedKey`·`platformCapabilities`·`dmLine`·`dmText`·`instagramNick`·문장 표(`LINK_MESSAGES`·`COLLECTION_MESSAGES`·`CALLBACK_MESSAGES`·`DM_REASON_MESSAGES`·`RESEND_MESSAGES`·`NOTICE_MESSAGES`)·숫자(`RETRY_DELAYS_S`·`DM_DEADLINE_MS`·`SEND_LEASE_MS`·`WEBHOOK_BODY_LIMIT`·`LATE_AFTER_MS`). 서버 옵션: `createServer({ instagram: fake.settings({ redirectUri }), dmAutoRun: false, collectionIntervalMs, liveTimer })` → `server.instagram.dms.drain()`·`server.instagram.connections`·`server.instagram.links`·`server.hub.publishInstagram`.
- 도우미: `apps/server/test/instagram-support.ts` — `igWorld()`(가짜 메타 서버 + 서버, 같은 주입 시계, DM 실행기는 `dmAutoRun: false` — `server.instagram.dms.drain()`으로 돌린다), `connectedShop`·`connectInstagram`·`callback`·`liveBroadcast`·`linkLive`·`register`·`sendComments`·`webhookTarget`·`chatEvents`.
- 네트워크 가드: `apps/server/test/network-guard.ts`의 `installNetworkGuard()`·`blockedConnections`(적대 시험 설정은 오케스트레이터 소유라 직접 걸지 않았다 — 적대 시험 파일이 `import '../../../apps/server/test/network-guard.ts'`로 걸 수 있다).
- 가짜 서버: `FakeMeta.start({ now })` → `addAccount`·`setLogin`·`authorize(url)`·`startLive`·`endLive`·`comment`·`payload`·`sign`·`deliver(target, body, { signature })`·`fail(op, fault, times)`·`invalidateTokens`·`count(op)`·`dms`·`subscriptions`·`issuedTokens`.
- 시간: 보내기·확인 타임아웃은 `igWorld({ timeouts })`로 줄인다(기본 시험값 400ms). 다시 시도·기한·임대는 주입 시계(`clock.advance`).

### 합칠 때 (오케스트레이터 — acceptance "합칠 때 맞출 것"에 더해)
- 기록 경로 `txHook`은 출력 기록(`print.txHook`)과 인스타그램 DM 행(`instagram.txHook`)을 차례로 부른다(`server.ts`). Y1 발송함 실행기를 더할 때 같은 자리에 잇는다.
- `/webhooks` 경로를 `createApp`에 붙였다(`app.ts` `webhooks` 옵션) — Y1에 웹훅이 생기면 같은 Hono에 더한다. `/api` `PUBLIC_PATHS`에 `GET /api/instagram/callback`.
- SSE 알림 종류 `instagram`(`hub.publishInstagram`).

### pnpm verify (dev-server 끝)
`E2E_PORT_OFFSET=1100 pnpm verify` — 통과 7 · 실패 0: typecheck(파일 484) · lint(0) · test(파일 139 · 테스트 3220) · golden(파일 27 · 파서 468 · 엔진 132 · 통과 600) · adversarial(파일 44 · 테스트 823) · e2e(265 통과) · coverage(라인 100% · 분기 99.66%).
