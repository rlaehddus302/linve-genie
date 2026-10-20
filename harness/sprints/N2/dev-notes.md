# N2 개발 노트

## dev-server

### 만든 것 (파일)
- `apps/server/src/platform.ts` — 플랫폼 값(`YOUTUBE`·`INSTAGRAM`·`TIKTOK`)·키 접두어(`ig:`·`tt:`·`sms:`)·`platformOfKey`·`prefixedKey`(256자)·능력 표·공통 어댑터 모양(`LiveSource`·`ThanksSender`).
- `apps/server/src/live-links.ts` — 회차의 라이브 연결(기다리기·잇기·끊기·저절로 잇기·새 라이브로 옮기기·수집 상태). `apps/server/src/seller-locks.ts` — 판매자마다 한 줄 처리(프로세스 안).
- `apps/server/src/instagram/` — `config.ts`(설정)·`meta.ts`(메타 HTTP 어댑터·오류 분류)·`adapters.ts`(공통 어댑터의 인스타그램 구현)·`crypto.ts`(토큰 암호화·state 해시)·`connection.ts`(계정 연결·동의)·`webhook.ts`·`dm.ts`(DM 실행기)·`notices.ts`(SSE)·`routes.ts`·`store.ts`·`text.ts`·`fake-meta.ts`(가짜 메타 서버)·`index.ts`(조립).
- `Service.ingestOpenChat` — `ingestChat`과 같은 기록(허용 필드·조치자 `collector`·같은 메시지 ID 한 번)이고, 그 방송이 이미 끝났으면(같은 범위 줄 안에서 판단) 기록하지 않는다. `guard`를 주면 그 chat을 넣은 같은 트랜잭션에서 부르고, false면 기록을 취소하고 `retry`(라이브 옮기기 — AC-N2-25).
- 마이그레이션 `0004_n2_instagram.sql` — `ig_connections`·`ig_oauth_states`·`live_links`·`live_link_moves`(수정 라운드 2 — 옮긴 기록)·`live_unlinked`·`live_requests`·`ig_dm_sends`·`ig_dm_rows`. **발송함 `outbox` 표는 그대로**(D-N2-01). DM 행은 발송함 POST_THANKS 행이 생기는 같은 트랜잭션(`ScopeWriter.txHook` — 출력 기록과 함께)에서 만든다.
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
  actor: { kind: 'account'|'server' /* 저절로 이음·옮김 */, loginId } | null, accountId /* 이을 때 연결돼 있던 인스타 계정 ID */, collection: CollectionView | null,
  moved: MovedView | null /* 이 연결의 마지막 옮기기 — 옮긴 적 없음·NONE(끊음)·기다리는 중이면 null (D-N2-17, RA-N2-006) */ }
// 서버가 새 라이브로 옮긴 연결(AC-N2-25): liveId = 새 라이브, linkedAt = 옮긴 시각, actor = server. 수집 상태의 수는 옮기기 전 것을 이어 센다
MovedView = { fromLiveId /* 옮기기 전 라이브 ID */, movedAt /* 옮긴 시각 UTC ISO */, comments /* 옮기기 전까지 이 방송에 기록한 인스타 댓글 수 = 그때 LIVE_MOVED의 N */,
  message /* 그때의 LIVE_MOVED 문장 그대로 (liveMovedMessage(comments)) */ }
// moved는 연결(행)마다 따로다: 다시 옮기면 마지막 옮기기(M2 → M3)만, 끊은 뒤 다시 이은 연결에는 이전 연결의 옮기기가 없다(null). 회차를 끝낸 뒤 조회에도 남는다.
// SSE LIVE_MOVED를 놓쳐도(화면을 늦게 열거나 다시 연결) 연결 조회·연결 목록(GET /api/live)·LINK·COLLECTION 알림의 link.moved로 다시 볼 수 있다 — 화면은 이것으로 "옮겼어요, 댓글 N개 확인" 표시를 되살린다
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
- `{ kind: 'LINK', broadcast, link: LinkView }` — 잇기·기다리기·끊기·저절로 잇기·새 라이브로 옮기기
- `{ kind: 'COLLECTION', broadcast, link: LinkView }` — 수집 상태·수가 바뀜(묶어서 1초에 한 번까지, 처음은 바로)
- `{ kind: 'NOTICE', code: 'UNLINKED_COMMENTS', message, liveId, count }` · `{ kind: 'NOTICE', code: 'MANY_WAITING', message, liveId, count }` · `{ kind: 'NOTICE', code: 'LATE_COMMENTS', message, broadcast }` — 처음 한 번과 그 뒤 1분에 한 번까지
- `{ kind: 'NOTICE', code: 'LIVE_MOVED', message, broadcast, liveId /* 새 라이브 */, count /* 옮기기 전 그 방송에 기록한 인스타 댓글 수 */ }` — 옮길 때마다 한 번(묶지 않는다). 문장 "인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요. 그 전 라이브에서 이 방송에 기록한 댓글 N개를 확인해 주세요."(N이 0이면 첫 문장만, `liveMovedMessage`). 판매자가 그 댓글들을 확인·취소하도록 이끈다. 같은 내용이 연결 조회의 `moved`에 남는다(위 `MovedView`)
- `{ kind: 'NOTICE', code: 'LIVE_NOT_MOVED', message, reason: 'GAP'|'OTHER_BROADCAST'|'TOO_SOON', broadcast /* 옮기려던 회차 b — 원래 이어져 있던 라이브에 그대로 이어져 있다 */, liveId /* 다른 라이브 M2 */, count /* M2의 이어지지 않은 댓글 수 */ }` — 저절로 이은 회차 b를 다른 라이브로 옮기려 했는데 (바)·(사)·(아)로만 막혔다(AC-N2-25, D-N2-17·18). M2 댓글은 기록하지 않고 세기만 한다. 그 댓글에는 `UNLINKED_COMMENTS`를 보내지 않는다. 라이브(M2)마다 처음 한 번과 그 뒤 1분에 한 번까지. 이유가 여럿이면 하나만 준다: `GAP` → `OTHER_BROADCAST` → `TOO_SOON` 순서(판매자가 손을 써야 풀리는 이유가 먼저 — `TOO_SOON`은 기다리면 풀린다). `GAP`과 `TOO_SOON`은 함께 걸리지 않는다. 문장(`LIVE_NOT_MOVED_MESSAGES`):
  - `OTHER_BROADCAST` (바 — b 말고 끝나지 않은 실제 회차가 있음, 리허설 제외): "새 인스타그램 라이브 댓글이 오고 있는데, 끝나지 않은 방송이 여럿이라 어느 방송에 이을지 몰라 기록하지 않고 있어요. 쓰지 않는 방송은 끝내고, 이어 갈 방송을 새 라이브에 이어 주세요."
  - `GAP` (사 — b의 마지막 활동에서 60분 넘게 떨어짐): "새 인스타그램 라이브 댓글이 오고 있는데, 방송의 마지막 댓글과 1시간 넘게 떨어져 같은 방송인지 몰라 기록하지 않고 있어요. 이어 갈 방송을 새 라이브에 이어 주세요."
  - `TOO_SOON` (아 — b를 지금 라이브에 이은·옮긴 지 60초 안, 60초 정각 포함, 서버 시계): "방송을 방금 인스타그램 라이브에 이어서, 1분 동안은 다른 라이브에서 온 댓글을 기록하지 않아요. 1분이 지나도 지금 방송 중인 라이브의 댓글이 기록되지 않으면 방송을 그 라이브에 다시 이어 주세요." — 빠르게 두 번 다시 켤 때(M → M2 → M3) 늦게 배달된 끝난 라이브의 댓글이 b를 방송 중인 라이브에서 끝난 라이브로 되돌리지 않게 막은 것이다(TD-N2-005). M2는 끝난 라이브일 수도, 진짜 새 라이브일 수도 있다. 이 이유로 막힌 라이브는 "이어진 적 있는 라이브"가 되지 않는다.
  - **막힌 뒤 고치는 길 — 새 API 없이 지금 있는 잇기·끊기·끝내기로 된다. 화면은 이 순서로 안내한다** (`liveId`는 알림의 M2, `GET /api/instagram/lives`에도 있다):
    1. 이어 갈 방송이 b(알림의 `broadcast`)면: `POST /api/broadcasts/:b/live/unlink` → `POST /api/broadcasts/:b/live/link { platform: 'INSTAGRAM', liveId: M2 }`. 끊지 않고 이으면 `ALREADY_LINKED` "… 먼저 연결을 끊어 주세요."가 순서를 알려 준다. M2는 이어진 적이 없어 `LIVE_TAKEN`이 아니다. 끊으면 b의 기다리던 DM 행은 `FAILED(NO_LINK)`가 된다(옛 라이브 M은 이미 끝나 어차피 보낼 수 없다). 손으로 이었으므로 그 뒤 다시 켜기는 옮기지 않고 `UNLINKED_COMMENTS`로 알린다.
    2. 이어 갈 방송이 다른 회차 c면: c를 M2에 잇거나(`…/c/live/link`) 기다리기로 둔다(`…/c/live/wait`). 기다리기면 M2의 다음 댓글에서 c가 저절로 이어진다(기다리는 회차가 옮기기보다 먼저).
    3. `OTHER_BROADCAST`로만 막혔고 다른 회차가 쓰지 않는 방송이면: 그 회차를 끝낸다(`POST /api/broadcasts/:id/end`). 그러면 M2의 다음 늦지 않은 댓글(b의 마지막 활동에서 60분 안)에서 b를 저절로 옮기고 `LIVE_MOVED`가 온다. `GAP`이면 끝내도 옮겨지지 않으므로 1·2만 안내한다.
    4. `TOO_SOON`((아)로만 막힘)이면: **기다린다** — 방송 중에 손을 쓰지 않아도 된다. M2가 진짜로 방송 중인 새 라이브면 b를 이은·옮긴 시각(b 연결 조회의 `linkedAt`)에서 60초가 지난 뒤 M2의 다음 늦지 않은 댓글에서 b를 저절로 옮기고 `LIVE_MOVED`가 온다. M2가 끝난 라이브면 아무것도 하지 않아도 된다(b는 방송 중인 라이브에 그대로이고 그 라이브의 댓글은 계속 기록된다). 1분이 지나도 방송 중인 라이브의 댓글이 기록되지 않으면 그때 1처럼 b를 끊고 방송 중인 라이브에 잇는다. 화면은 `TOO_SOON`에 1·2를 바로 권하지 말고 "기다리기"를 먼저 보인다(바로 끊고 이으면 손으로 이은 연결이 되어 그 뒤 다시 켜기를 저절로 옮기지 않는다).
    5. 막힌 동안의 M2 댓글은 기록하지 않았고 되살리지 않는다(D-N2-08 — 수·처음·마지막 받은 시각만 `GET /api/instagram/unlinked`에 있다).
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
| HTTP 429·5xx, code 4·17·32·613(속도 제한)·1·2(일시 오류), `is_transient: true`, 요청을 보내기 전의 네트워크 오류(아래) | 다시 시도 | `WAITING(RETRY)` 2·4·8·16·32초, 다섯 번 넘게 실패 → `FAILED(GAVE_UP)` |
| code 3·10·200~299 | 권한 없음 | `FAILED(NO_PERMISSION)` (시도 1번) |
| 그 밖의 400대 | 받지 않음 | `FAILED(REJECTED)` (시도 1번) |
| 보내기 10초 안에 응답 없음·연결 끊김 | 타임아웃 | `SENDING(CONFIRM)` → 대화 한 번 조회(30초): 있으면 `SENT`, 없으면 다시 시도, 조회 실패면 `FAILED(UNCONFIRMED)` |

응답이 없는 실패의 분류(`isUnreached`·`UNREACHED_CODES` in `meta.ts`, TD-N2-002 수정). fetch(undici)의 `TypeError('fetch failed', { cause })`에서 원인(여러 주소를 시도했으면 `AggregateError.errors[]` 모두)을 본다.

| 원인 | 뜻 | 개인 답장 | 그 밖의 호출(대화 조회·라이브 찾기 등) |
|---|---|---|---|
| `ECONNREFUSED`·`ENOTFOUND`·`EAI_AGAIN`·`EAI_FAIL`·`EAI_NONAME`·`EHOSTUNREACH`·`ENETUNREACH`·`ENETDOWN`·`EHOSTDOWN`·`EADDRNOTAVAIL`·`UND_ERR_CONNECT_TIMEOUT`, 또는 시스템 호출이 `connect`·`getaddrinfo`인 오류(원인이 모두 이것일 때만) | 요청을 보내기 전 — 메타에 닿지 않은 것이 확실 | `RETRY` (대화 조회 없이 2·4·8·16·32초) | `RETRY` |
| 시간 제한(`TimeoutError`·`AbortError`) | 보냈을 수 있음 | `TIMEOUT` → 대화 조회로 확인 | 대화 조회는 `TIMEOUT`(→ `UNCONFIRMED`), 나머지 `RETRY` |
| 그 밖(연결된 뒤 끊김 `ECONNRESET`·`EPIPE`·`UND_ERR_SOCKET`, 읽기 중 `ETIMEDOUT`, 원인 없음, 섞인 원인) | 보냈을 수 있음 | `TIMEOUT` → 대화 조회로 확인 | `RETRY` |

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
- `apps/server/test/commands.test.ts` 마이그레이션 명령의 표 수 15 → 22 → 23 (교체 — N2 표 일곱, 수정 라운드 2에 옮긴 기록 표 하나가 더해짐, 같은 줄의 스키마 대조는 그대로).
- `packages/core/test/golden/core-adapter.test.ts` 합계 "파일 26 · 파서 460 · 엔진 129 · 통과 589" → "파일 27 · 파서 468 · 엔진 132 · 통과 600" (AC-N2-81, 교체).
- 코어 시험 코드: `packages/core/test/golden/contract.ts` `SCENARIO_ID_RE` 한 줄, `validate.ts` 오류 문장(두 형식을 말한다). 새 러너 자체 시험 `scenario-id.test.ts`.
- `apps/server/vitest.config.ts`에 `setupFiles: ['test/network-guard.ts']`(네트워크 가드, AC-N2-62).

### 테스터에게
- `@livejjim/server` 진입점이 N2 묶음을 내보낸다: `FakeMeta`·`instagramSettings`·`readInstagramConfig`·`MetaClient`·`classifyMetaError`·`ERROR_TABLE`·`platformOfKey`·`prefixedKey`·`platformCapabilities`·`dmLine`·`dmText`·`instagramNick`·문장 표(`LINK_MESSAGES`·`COLLECTION_MESSAGES`·`CALLBACK_MESSAGES`·`DM_REASON_MESSAGES`·`RESEND_MESSAGES`·`NOTICE_MESSAGES`·`LIVE_MOVED_MESSAGE`·`liveMovedMessage`)·숫자(`RETRY_DELAYS_S`·`DM_DEADLINE_MS`·`SEND_LEASE_MS`·`WEBHOOK_BODY_LIMIT`·`LATE_AFTER_MS`). 서버 옵션: `createServer({ instagram: fake.settings({ redirectUri }), dmAutoRun: false, collectionIntervalMs, liveTimer })` → `server.instagram.dms.drain()`·`server.instagram.connections`·`server.instagram.links`·`server.hub.publishInstagram`.
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


### 수정 라운드 1 (dev-server)
- **SA-N2-001 · TD-N2-001 (FIXED)** 다시 배달된 댓글이 다른 회차에 다시 기록되거나 "이어진 방송 없음"으로 세지던 것. `webhook.ts #change`가 판매자 줄 안에서 회차를 정하기(`resolveTarget` — 저절로 잇기·이어지지 않은 수 세기) **전에** `igChatRecorded`(`store.ts`)로 이 판매자의 `events`에 같은 `ig:<댓글 ID>` 채팅이 어느 회차·날짜든 있는지 본다. 있으면 아무것도 하지 않는다(기록·저절로 잇기·수·알림 없음, 200). 다른 판매자의 같은 ID는 보지 않는다.
  - 조회용 부분 인덱스 `events_ig_chat_idx (seller_id, chat_message_id) WHERE chat_message_id LIKE 'ig:%'` — 유튜브 채팅 쓰기에는 비용이 없다. N2 마이그레이션 `0004_n2_instagram.sql` 끝에 더했다(아직 합치지 않은 N2 전용 마이그레이션이라 새 번호를 만들지 않았다 — 이미 0004를 적용한 개발 DB가 있으면 인덱스만 빠진다, 정확성은 같다). `schema.ts`와 같다(schema.test가 대조).
  - 시험: `live-links.test.ts` "1부에 기록한 댓글이 b1을 끝낸 뒤 다시 배달되면…"(본문을 바꿔 다시 와도 b2는 WAITING 그대로·기록·수·알림 없음, 그 뒤 새 댓글에서 b2가 저절로 이어짐 — AC-N2-22 1부·2부 유지), `instagram-webhook.test.ts` "이미 기록한 댓글을 거르는 것은 판매자 안에서만".
- **SA-N2-002 · TD-N2-002 (FIXED)** 개인 답장의 연결 거절이 `UNCONFIRMED`로 멈추던 것. `MetaClient.#call`이 응답 없는 실패를 `timeout`·`unreached`(보내기 전 연결 오류)·`network`(그 밖)로 나누고, `privateReply`는 `unreached`를 `RETRY`(AC-N2-47 "네트워크 오류")로, 시간 제한·연결된 뒤 끊김만 `TIMEOUT`(AC-N2-48 "답이 없으면(또는 연결이 끊기면)")으로 준다. 표는 위 "응답이 없는 실패의 분류".
  - 시험: `fake-meta.test.ts` 분류 표(연결 거절·DNS·경로 없음·연결 시간 초과·AggregateError / 연결 뒤 끊김·읽기 시간 초과·섞인 원인), `instagram-dm.test.ts` "보내기 연결 거절은 대화 조회 없이 WAITING(RETRY) → 2초 뒤 DM 1", "요청을 받은 뒤 끊기면(DROP) 대화 조회로 확인". 기존 `fake-meta` 오류 주입 시험의 `DROP → TIMEOUT`은 그대로 통과한다.
  - **테스터에게(적대 시험 `dm-attacks.test.ts` TD-N2-002)**: 고친 뒤에도 이 시험 하나는 실패한다. 연결 거절을 **호출 2번**(`refuseConnections(…, 2)`)으로 주입하는데, 고친 흐름은 거절된 보내기 뒤에 대화 조회를 하지 않으므로(메타에 닿지 않은 것이 확실) 첫 drain에서 거절이 1번만 쓰이고, 남은 1번이 2초 뒤 다시 시도에 걸린다(→ `WAITING(RETRY)` 시도 2, 4초 뒤 보냄). 같은 시험을 그대로 따라 한 확인: drain1 뒤 거절 1·`[WAITING, RETRY]`, +2초 drain 뒤 거절 2·`[WAITING, RETRY]`·DM 0, +4초 drain 뒤 `[SENT]`·DM 1 — AC-N2-47의 2·4·8·16·32초 그대로다. 시험의 이야기("네트워크가 돌아오면 2초 뒤 다시 보낸다")와 맞추려면 거절 횟수를 1로 하거나 다시 시도를 4초 더 기다려야 한다. 적대 시험은 test-domain 소유라 고치지 않았다.
- **RA-N2-001 (DISPUTED — 일부 고침, 나머지는 스펙 결정 필요)** 다시 배달된 댓글이 기다리던 2부를 옛 라이브에 잇던 경로는 위 SA-N2-001 수정으로 막혔다(이미 기록한 댓글은 회차를 정하기 전에 거른다). 남는 것 — b1을 끝낸 뒤 옛 라이브 M에 **새로** 달린 댓글이 기다리던 b2를 M에 잇는 것 — 은 스펙이 정한 동작이다: AC-N2-22 "시험(한 라이브로 1부·2부): b1이 M에 이어져 있고 b2가 기다리는 중 → b1을 끝냄 → 그 뒤 M의 댓글에서 b2가 M에 이어지고 그 댓글부터 b2에 기록된다", AC-N2-24 "회차 b를 끝내면 그 뒤 도착한 M의 댓글은 … 기다리는 회차가 있으면 거기에 잇는다". 그 뒤 새 라이브 M2의 댓글을 세기만 하는 것도 AC-N2-24("저절로 잇기도 되지 않으면 기록하지 않는다")다. 감사자가 낸 `entry.time` 조건은 D-N2-04("entry.time은 60초 넘게 늦은 댓글을 알리는 데만 쓴다")와 부딪친다. 그래서 조용히 바꾸지 않고 spec-keeper에게 아래를 제안한다(disputesWithSpec).
  - 제안: "한 계정의 라이브는 한 번에 하나" 규칙으로 저절로 옮기기 — 이어지지 않은 라이브 M2의 댓글이 왔고, 판매자의 끝나지 않은 회차 중 **서버가 저절로 이은**(조치자 server) 회차가 같은 계정의 다른 라이브 M에 이어져 있으면, 그 판매자 줄 밖에서 `live_media`를 한 번 불러 M2가 진행 중이고 M이 진행 중이 아님을 확인한 뒤(실패·불확실하면 지금처럼 세기만) 그 연결을 M2로 옮기고(조치자 서버, 옮긴 시각 남김) 알림을 보낸다. 판매자가 손으로 이은 연결은 옮기지 않는다. 옮기기 전 M2 댓글은 지금처럼 세기만 한다(알림으로 안내). 메타 호출이 들어가므로 실패·지연·호출 횟수 제한을 함께 정해야 한다.
- **pnpm verify (수정 라운드 1 끝, 커밋 b8ab2df)** `E2E_PORT_OFFSET=1100 pnpm verify` — 통과 6 · 실패 1: typecheck(파일 486) · lint(0) · test(파일 139 · 테스트 3227) · golden(파일 27 · 파서 468 · 엔진 132 · 통과 600) · e2e(파일 42 · 통과 265) · coverage(라인 100% · 분기 99.66%) 통과, adversarial(파일 46 · 테스트 831 · 실패 1) 실패. 실패 1건은 위 "테스터에게"의 TD-N2-002 시험 주입 횟수다 — 이 시험의 버그 확인 단언(첫 drain 뒤 `[WAITING, RETRY]`, 68행)은 통과하고 72행(2초 뒤 DM 1)에서 남은 두 번째 거절에 걸린다. TD-N2-001 두 시험은 통과한다. 보호 경로 게이트(`check-protected.mjs 39d9ac6`) 통과.

### 수정 라운드 2 (dev-server — 분쟁 판정 반영, RA-N2-001 UPHOLD → D-N2-16, AC-N2-25·33)
- **RA-N2-001 (FIXED)** 저절로 이은 회차가 옛 라이브에 남아 새 라이브의 2부 첫 주문이 세기만 되던 것. AC-N2-25(새)대로 서버가 저절로 이은 연결을 같은 계정의 새 라이브로 옮긴다. AC-N2-33(이미 기록한 댓글은 어느 회차든 회차를 정하기 전에 거른다)은 수정 라운드 1의 `igChatRecorded` 거르기 그대로이고, 거른 댓글은 옮기기도 일으키지 않는다(시험으로 확인).
  - 회차 정하기(`LiveLinks.resolveTarget(seller, igAccountId, liveId, fresh)`): ① 그 라이브에 이어진 끝나지 않은 회차 ② 기다리는 회차 하나 → 저절로 잇기, 둘 이상 → `MANY_WAITING` ③ **기다리는 회차가 없으면** 옮길 수 있는지(`#movable`): 늦지 않은 댓글(`fresh` = `entry.time`이 있고 숫자이며 받은 시각보다 60초 넘게 이르지 않음 — 웹훅이 정한다), 그 라이브가 이 판매자의 어느 연결에도(끊은 연결·끝난 회차·옮기기 전 라이브 포함 — `live_links.live_id`와 `live_link_moves`의 두 라이브 ID) 없었음, 후보(`movableLinks`: 끝나지 않은 실제 회차·인스타그램·`LINKED`·조치자 `server`·연결 계정 ID = `entry[].id`·다른 라이브)가 정확히 하나 → `move` ④ 아니면 `none`(지금처럼 세고 `UNLINKED_COMMENTS`).
  - 옮기기는 **그 댓글의 기록과 한 트랜잭션**이다: 웹훅이 `Service.ingestOpenChat(…, { guard })`로 넘기고, 기록 트랜잭션(범위 잠금 안, chat을 넣은 뒤 `afterInsert`)에서 `LiveLinks.applyMove`가 판매자 라이브 잠금(`pg_advisory_xact_lock`)을 잡고 조건을 **다시** 본 뒤 `live_links` 행의 `live_id`·`linked_at`(= 옮긴 시각)만 바꾸고(같은 행이라 늦게 받은·형식 틀린 수가 이어진다) `live_link_moves`에 이전·새 라이브 ID·계정 ID·조치자 `server`·옮기기 전 기록한 인스타 댓글 수(그 댓글 뺌)·옮긴 시각을 남긴다. 조건이 깨졌으면(다른 서버 인스턴스가 그사이 바꿈) 기록을 취소하고 `retry` → 회차를 다시 정한다. 그 회차가 그사이 끝났으면 기록 경로가 `ended`를 주므로 옮기지도 않는다(끝난 회차·동시에 끝나는 회차는 옮기지 않는다). 기록이 커밋된 뒤에만 `LINK` 알림·`LIVE_MOVED`(N)·수집 상태 알림을 보낸다.
  - 잠금 순서: 기록 트랜잭션은 범위 잠금 → 판매자 라이브 잠금. 라이브 잠금을 잡은 쪽(잇기·끊기·저절로 잇기)은 범위 잠금을 잡지 않는다 — 교착 없음. 프로세스 안에서는 웹훅·잇기·끊기가 판매자 줄(`SellerLocks`)로 차례를 지킨다.
  - 끊기가 아니다: `onUnlink`를 부르지 않으므로 기다리던 DM 행은 그대로(`FAILED(NO_LINK)` 아님). 엔진 이벤트도 아니다 — 범위 seq는 그 댓글의 chat 하나만 는다. 메타 `live_media`는 다시 부르지 않는다(D-N2-16).
  - 옮기려던 댓글이 엔진 입력 검사에 걸리면(웹훅 경로에서는 사실상 생기지 않는다 — 모양 검사가 먼저 거른다) 옮기지 않고 판매자 단위 형식 틀린 수만 센다. 다음 늦지 않은 댓글에서 옮긴다.
  - 새 표 `live_link_moves`(판매자·연결·회차 외래 키, `(seller_id, from_live_id)`·`(seller_id, to_live_id)` 인덱스) — 아직 합치지 않은 N2 전용 마이그레이션 `0004`에 더했다(수정 라운드 1의 인덱스와 같은 이유). `schema.ts`와 같다(schema.test 대조).
  - 시험 `apps/server/test/live-move.test.ts`(12): 판정 문장의 시나리오(따로 켠 두 라이브 1부·2부 — "감사합니다"로 b2가 M에 저절로 이어짐 → "20" 1등·DM 행 → M2 "15"로 옮김·15번 1등·LIVE_MOVED N = 2·연결 조회·수집 상태·옮긴 기록·seq +1·DM 행이 NO_LINK 아님 → 그 뒤 M "16"은 세기만), 다시 켠 라이브로 또 옮기기·옛 라이브로 되돌아가지 않음, 옮기지 않음 ①61초 늦음(60초는 옮김) ②`entry.time` 없음·숫자 아님 ③이어진 적 있는 라이브(끝난 회차) ④손으로 이은 연결(`UNLINKED_COMMENTS`) ⑤후보 둘 ⑥다른 계정으로 다시 연결 ⑦기다리는 회차가 먼저(둘이면 `MANY_WAITING`), 끝난 회차, 다시 배달된 댓글, `guard` false면 기록 취소·`retry`, 문장.
  - **테스터에게**: 공격 관점(acceptance "옮기기")에 쓸 것 — `sendComments(…, { time })`로 `entry.time`, `fake.payload` JSON에서 `time`을 지워 없는 경우, `live_link_moves` 표(옮긴 기록), SSE `LIVE_MOVED`, `server.service.ingestOpenChat(seller, chat, { guard })`(옮기기 트랜잭션 실패 흉내). 가짜 서버는 한 계정에 라이브 둘을 동시에 켤 수 있다(목록 시험용) — 실제로는 안 된다(HG-N2 7).
- **pnpm verify (수정 라운드 2 끝, 커밋 0c54a60)** `E2E_PORT_OFFSET=1100 pnpm verify` — 통과 5 · 실패 2: typecheck(파일 487) · lint(0) · golden(파일 27 · 파서 468 · 엔진 132 · 통과 600) · e2e(파일 42 · 통과 265) · coverage(라인 100% · 분기 99.66%) 통과. test(파일 140 · 테스트 3239 · 실패 1)는 `changes.test.ts` AC-S05-61 무작위 속성 시험이 60초 시간 제한에 걸린 것(다른 스프린트와 함께 도는 부하 — 그 파일만 다시 돌리면 13초에 통과, 이어서 `pnpm test`를 다시 돌려 파일 140 · 테스트 3239 모두 통과). adversarial(파일 46 · 테스트 831 · 실패 1)은 수정 라운드 1과 같은 `dm-attacks.test.ts` TD-N2-002 시험 주입 횟수(위 "테스터에게" — test-domain 몫). 새 시험 `live-move.test.ts` 12개와 N2 적대 시험의 나머지(TD-N2-001 포함)는 통과.

### 수정 라운드 3 (dev-server — SA-N2-004 · TD-N2-003 · GATE-N2-VERIFY)
- **SA-N2-004 · TD-N2-003 (FIXED — 스펙 문장은 spec-keeper 몫)** 1부 b1(저절로 이음, M)을 끝내지 않은 채 2부 b2를 만들고 새 라이브 M2를 켜면, 판매자가 b2를 M2에 잇기 전에 온 늦지 않은 M2 댓글이 b1을 M2로 옮겨 2부 시청자의 "15"가 1부 15번(다른 상품)의 찜·1등이 되고 b2는 M2에 `LIVE_TAKEN`이던 것. 감사자 제안 (바)·(사)를 옮기지 않는 조건으로 더했다 — 자동 동작은 막는 쪽으로만(D-N2-16과 같은 방향). 막힌 댓글은 지금처럼 세고 `UNLINKED_COMMENTS`로 알리며, 판매자는 고른 회차를 M2에 이을 수 있다(M2는 이어진 적이 없으므로).
  - (바) 그 판매자에게 **옮길 회차 말고 끝나지 않은 실제 회차가 하나라도 있으면** 옮기지 않는다 — 라이브 연결이 없는 회차(기다리기도 잇기도 하지 않은 회차)·손으로 이은 회차·다른 플랫폼 회차 모두 센다. 리허설 회차는 세지 않는다(판매·찜 범위가 따로라 1부·2부 혼동이 없다 — 옮기기 후보도 원래 실제 회차만). 새 질의 `otherOpenBroadcast(db, seller, exceptBroadcastId)`(`src/instagram/store.ts`, `broadcasts.ended_at IS NULL` + `scopes.rehearsal = false`, 판매자 조건).
  - (사) 옮길 회차의 **방송 날짜**(`broadcasts.date`, KST 판매일)가 **그 댓글을 받은 날**(서버 시계 → `kstDate`)과 다르면 옮기지 않는다 — 어제 끝내지 않은 저절로 이은 회차가 오늘 라이브로 옮겨 가지 않게.
  - 두 조건 모두 `LiveLinks.#movable` 안이라 회차를 정할 때(`resolveTarget`, 판매자 라이브 잠금 안)와 기록 트랜잭션 안의 다시 확인(`applyMove`, 범위 잠금 → 판매자 라이브 잠금, 그 댓글을 기록하는 시각 `now`)에서 같이 본다. 정한 뒤 기록 전에 다른 실제 회차가 생기면(같은 날 회차는 범위 잠금으로 차례가 정해진다) 기록을 취소하고 `retry` → 다시 정해 `none`(세기만).
  - 시험 `apps/server/test/live-move.test.ts`(+5, 모두 17): ⑧ 끝나지 않은 다른 실제 회차(연결 없음) — M2 "15"는 1부 15번 찜이 아니고 세기만·`UNLINKED_COMMENTS`·`LIVE_MOVED` 없음, 판매자가 2부를 M2에 이음(200) → 다음 "15"는 2부 15번 1등 ⑧' 다른 회차가 손으로 이은 연결이어도 막고, 그 회차를 끝내면 다음 늦지 않은 댓글에서 옮긴다(끝나지 않은 리허설 회차는 막지 않는다) ⑨ 방송 날짜 2026-10-19 회차에 2026-10-20 00:00:00 KST 댓글 → 옮기지 않음 ⑨' 같은 날 23:59:59 KST는 옮긴다 · 기록 트랜잭션 안의 다시 확인(정한 뒤 다른 회차가 생기면 `retry`). 고치기 전 코드로 돌리면 새 시험 4개가 실패하는 것을 확인했다. 적대 시험 `tests/adversarial/n2/` TD-N2-003 포함 9개 통과.
  - **spec-keeper에게**: acceptance AC-N2-25 "아래를 모두 만족하면" 목록과 "시험(옮기지 않음)"에, D-N2-16 "옮기기" 조건에 (바)·(사)를 더해야 코드와 문장이 맞는다(위 문장 그대로 — 리허설 회차는 세지 않음, 날짜는 `broadcasts.date` 대 받은 날 KST). 이 라운드 시작 때 스펙 커밋이 없어 감사자 제안 문장대로 구현했다.
- **GATE-N2-VERIFY** adversarial 실패(TD-N2-003)는 위 수정으로 해결. `packages/voice` perf(AC-P2-07 p99 61.2ms)는 N2와 상관없는 부하 탓(다른 스프린트와 함께 돎) — 아래 verify 결과 참고.
- **pnpm verify (수정 라운드 3 끝, 커밋 bcdd9cf)** `E2E_PORT_OFFSET=1100 pnpm verify` — 통과 6 · 실패 1: typecheck(파일 487) · lint(0) · test(파일 140 · 테스트 3244 — `packages/voice` perf AC-P2-07 포함 통과) · golden(파일 27 · 파서 468 · 엔진 132 · 통과 600) · adversarial(파일 46 · 테스트 832 — TD-N2-003 포함 모두 통과) · e2e(파일 42 · 통과 265) 통과. coverage는 `packages/core/test/unit/engine-properties-s03.test.ts` AC-S03-92 무작위 속성 시험이 5초 시간 제한에 걸려 실패했다(부하 평균 약 24 — 다른 스프린트와 함께 돎, N2는 `packages/core/src`를 바꾸지 않았다). `pnpm coverage`만 다시 돌려 통과(라인 100% · 분기 99.66%). 보호 경로 게이트(`check-protected.mjs 39d9ac6`) 통과.

### 수정 라운드 4 (dev-server — 분쟁 판정 D-N2-17 반영: SA-N2-005 · SA-N2-006 · TD-N2-004 · RA-N2-006, 그리고 SA-N2-007)
- **SA-N2-005 · SA-N2-006 · TD-N2-004 (FIXED)** 옮기기 (사)의 "방송 날짜 ≠ 받은 날(KST)"을 없애고 60분 간격으로 바꿨다(D-N2-17). 자정을 넘긴 방송에서 라이브를 다시 켜면 옮긴다.
  - `LiveLinks.#movable`(`src/live-links.ts`): 그 밖의 조건(늦지 않은 댓글·이어진 적 없는 라이브·후보 하나)이 맞으면 먼저 (사) — 받은 시각(서버 시계 `now`) − max(`liveChatStats(…, exceptCommentId).lastAt` = b에 기록한 인스타 댓글 중 마지막 것을 받은 시각(어느 라이브든), `only.linkedAt` = 이은·마지막으로 옮긴 시각) > `MOVE_GAP_MS`(3,600,000)이면 `GAP`. 다음 (바) `otherOpenBroadcast`면 `OTHER_BROADCAST`. 그래서 둘 다면 `GAP`. `entry.time`·방송 날짜·달력 날짜는 보지 않는다(`kstDate` import 제거).
  - 기록 트랜잭션 안의 다시 확인(`applyMove`)은 이미 넣은 그 댓글(`commentId`)을 마지막 활동에서 뺀다 — 빼지 않으면 간격이 늘 0이라 회차를 정한 뒤 60분을 넘겨도 옮긴다(시험으로 확인: 빼지 않게 바꾸면 새 시험이 실패한다).
  - `resolveTarget`은 막힌 경우 `{ kind: 'none', blocked: { broadcastId, reason } }`(그 밖의 none은 `blocked: null`). 웹훅 `#unlinked`는 `blocked`가 있으면 `UNLINKED_COMMENTS` 대신 `LiveNotices.notMoved`(`LIVE_NOT_MOVED`, key = 라이브, 1분 간격)를 보낸다. 세는 것은 같다(`countUnlinked`). 기록 트랜잭션 안에서 막혀 `retry`된 댓글도 다시 정할 때 이유가 나와 같은 알림이 간다.
  - `notices.ts`: `NoticeCode`에 `LIVE_NOT_MOVED`, 이유별 문장 `LIVE_NOT_MOVED_MESSAGES`(AC-N2-25 그대로). 1분 간격 판단은 `#due`로 나눠 `notice`·`notMoved`가 같이 쓴다.
- **RA-N2-006 (FIXED)** `LinkView.moved`(`MovedView` — 위 "화면에게"), `store.ts lastMove(db, seller, linkId)`(그 연결 행의 `live_link_moves` 마지막 줄). `#view`는 `#viewIn(this.#deps.db, …)`로 합쳤다(조회·목록·잇기 응답·LINK·COLLECTION 알림이 같은 모양). 표·마이그레이션은 바꾸지 않았다(판매자 조건으로 기존 `(seller_id, …)` 인덱스를 탄다 — 옮기기 기록은 판매자마다 몇 줄).
- **SA-N2-007 (FIXED, minor)** `test/instagram-support.ts`의 기본 시간 제한을 `TEST_TIMEOUTS`(요청·보내기·대화 조회 5초)로 두고, 가짜 서버가 응답하지 않는(HANG·HANG_AFTER) 시험 5개(AC-N2-48 가·나·라, AC-N2-50 UNCONFIRMED, AC-N2-60 로그)만 `SHORT_SEND_TIMEOUT`(보내기 400ms — 대화 조회는 5초 그대로)을 쓴다. 다시 띄운 서버(AC-N2-48 다·AC-N2-51)도 `TEST_TIMEOUTS`. 시간 초과 시험은 그대로이고 기대값은 바꾸지 않았다. 적대 시험(`igWorld()` 기본값)은 HANG을 쓰지 않아 영향이 없다.
- 바꾼 시험(`live-move.test.ts`, 기대값 변경은 D-N2-17에 따른 교체): ⑨ 날짜 시험 둘 → 60분 경계(20:00:00 마지막 댓글, 21:00:01 `GAP`·21:00:00 옮김), ①② 시계를 T0+30분으로(전에는 T0에서 9시간 뒤라 이제 `GAP`), ⑧·⑧' 막힌 알림 `UNLINKED_COMMENTS` → `LIVE_NOT_MOVED(OTHER_BROADCAST)`. ①③④⑤에는 `LIVE_NOT_MOVED`가 아니라 `UNLINKED_COMMENTS`인지 더했다. 새 시험(+11, 모두 28): ⑧ 가·나·다(연결 없음·손으로 이음·전날 회차 — 1분 간격, c를 끝내면 옮김), 고치는 길(끊지 않고 이으면 `ALREADY_LINKED` → 끊고 M2에 잇기), ⑨', ⑩ 사흘 뒤 `GAP`, ⑪ 둘 다면 `GAP`(c를 끝내도 그대로 → 끊고 잇기), 자정을 넘긴 다시 켜기(TD-N2-004 시나리오), `moved`(1부·2부 뒤·다시 옮김·끊음·다시 이음·기다리기·끝낸 뒤·목록), 트랜잭션 안 다시 확인이 지금 댓글을 빼는지(60분 1ms `retry` → 다시 정하면 `blocked GAP`, 60분 정각 옮김). live-links·instagram-webhook 시험에는 (바)·(사)로 막힌 경우가 없어 바꿀 것이 없었다.
- 확인(커밋 de6c762·54a2069, 다른 작업 폴더가 함께 돌아 부하 평균 약 30~40 — 오케스트레이터 지시로 전체 `pnpm verify`는 돌리지 않았다): `pnpm typecheck` 통과(설정 15 · 파일 488) · `pnpm lint` 통과(오류 0 · 경고 0) · 서버 시험(`TZ=Pacific/Honolulu npx vitest run --project server`, perf 제외) 파일 42 · 테스트 539 중 537 통과, 실패 2는 `changes.test.ts` AC-S05-61·`chat-messages.test.ts` AC-S05-20 무작위 속성 시험의 60초 시간 제한(부하) — 두 파일만 다시 돌려 15개 모두 통과(15초). 앞선 한 번은 `instagram-webhook.test.ts` AC-N2-33 500개 시험이 같은 이유로 60초를 넘겼고 따로 돌리면 3초에 통과한다. `live-move.test.ts` 28개 통과. 적대 시험 `npx vitest run --config vitest.adversarial.config.ts tests/adversarial/n2` 파일 3 · 테스트 42 모두 통과(TD-N2-004, test-domain의 새 `live-move-gap-attacks.test.ts` 포함).

### 수정 라운드 5 (dev-server — 분쟁 판정 D-N2-18 반영: TD-N2-005)
- **TD-N2-005 (FIXED)** 옮기기 조건 (아)를 더했다(D-N2-18). 빠르게 두 번 다시 켤 때(M → M2 → M3) 늦게 배달된 끝난 라이브 M2의 댓글이 b를 방송 중인 M3에서 M2로 되돌리던 것.
  - `LiveLinks.#movable`(`src/live-links.ts`): (사) `GAP` → (바) `OTHER_BROADCAST` 검사 **뒤**에 (아) 받은 시각(서버 시계 `now`) − `only.linkedAt`(이은·마지막으로 옮긴 시각) ≤ `MOVE_SETTLE_MS`(60,000 — 새 상수, `index.ts`에서도 내보낸다)이면 `TOO_SOON`. 60초 정각도 막고 60,001ms부터 옮긴다. `entry.time`은 늦은 댓글 판단(`fresh`)에만 쓴다. 검사 순서가 곧 이유 순서다(`GAP` → `OTHER_BROADCAST` → `TOO_SOON`). `MoveBlockReason`에 `TOO_SOON`.
  - 기록 트랜잭션 안의 다시 확인(`applyMove`)도 같은 `#movable`을 거쳐 (아)를 본다(시험으로 확인: 기록하는 시각이 정확히 60초면 `retry`, 다시 정하면 `blocked TOO_SOON`).
  - 막힌 라이브는 아무 기록도 남기지 않는다(`live_links`·`live_link_moves`에 쓰지 않음) — "이어진 적 있는 라이브"가 아니어서 60초가 지나면 그 라이브의 다음 늦지 않은 댓글이 옮긴다(ⓐ).
  - `notices.ts`: `LIVE_NOT_MOVED_MESSAGES.TOO_SOON`(AC-N2-25 문장 그대로). 세기·1분 간격·`UNLINKED_COMMENTS`를 보내지 않는 것은 (바)·(사)와 같다(웹훅 `#unlinked` 그대로 — 주석만 고쳤다).
- 바꾼 시험(`live-move.test.ts`, D-N2-18에 따른 교체 — 같은 것을 시험한다): 이은·옮긴 뒤 60초 안에 옮기던 넷 — 다시 켜기(1초 → 61초씩), ⑧ 손으로 이은 다른 회차를 끝낸 뒤 옮김(1초 → 61초), 옮긴 사실 남기기(`movedAt` T0+1초·2초 → T0+61초·122초), 기록 트랜잭션 다시 확인(다른 실제 회차, 회차를 정하기 전에 61초). 새 시험(+9, 모두 37): `TOO_SOON` 문장, ⑫ TD-N2-005 재현, ⑬ 60초 경계(30초·정각 막힘, 알림 1분에 한 번, 60,001ms 옮김, 막힌 댓글 되살리지 않음), ⑭ 저절로 이은 직후(45초·정각 막힘, 60,001ms 옮김), ⑮ 가·나·다(다른 회차 + 30초 → `OTHER_BROADCAST` / 늦은 댓글 + 30초 → `UNLINKED_COMMENTS` / 손으로 이음 + 30초 → `UNLINKED_COMMENTS`), ⑯ 배달 순서 반대, 다시 확인의 (아). (아) 줄을 빼거나 `<`로 바꾸거나 `OTHER_BROADCAST`보다 앞에 두면 새 시험이 실패하는 것을 확인했다(되돌림). live-links·instagram-webhook 시험에는 저절로 이은 회차가 다른 라이브로 옮겨 가는 경우가 없어 바꿀 것이 없었다.
- 확인(다른 작업 폴더가 함께 돌아 부하 평균 약 25~35, 오케스트레이터 지시로 전체 `pnpm verify`는 돌리지 않았다): `pnpm typecheck` 통과(설정 15 · 파일 488) · `pnpm lint` 통과(오류 0 · 경고 0) · 서버 시험(`TZ=Pacific/Honolulu npx vitest run --project server`) 파일 44 · 테스트 551 모두 통과 · 적대 시험 `npx vitest run --config vitest.adversarial.config.ts tests/adversarial/n2` 파일 4 · 테스트 77 모두 통과(test-domain의 새 `live-move-too-soon-attacks.test.ts` 포함 — 처음 한 번은 그 파일이 쓰이는 중이라 1개가 실패했고, 그 파일만·전체를 두 번 다시 돌려 모두 통과).
