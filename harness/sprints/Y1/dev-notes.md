# Y1 개발 노트

## dev-server

### 화면(I3)에게 — 새 API·실시간 알림·오류 코드·가짜 서버 사용법

S04~S06 계약은 그대로이고 아래가 더해진다. 모든 경로는 세션이 필요하고(401), 상태를 바꾸는 요청(POST·PUT)은 `Origin` = 앱 주소·JSON 본문만(403·415·400), 모르는 필드는 400 `UNKNOWN_FIELD`, 모든 응답은 `Cache-Control: no-store`. 오류 본문은 기존과 같은 `{ error: { code, message, problems? } }`이고 **`message`는 판매자에게 그대로 보여 줄 문장**이다(아래 표의 문장 — 수용 기준이 따옴표로 정한 것). 시각은 모두 UTC ISO(화면이 KST로 보인다). 유튜브 설정이 없는 서버는 유튜브 API가 503 `YOUTUBE_NOT_CONFIGURED` "유튜브 연동을 준비하지 않은 서버예요."(발송함·알림 조회는 빈 목록).

#### 1. 구글 연결 (AC-Y1-01~06·31)
| 요청 | 응답 |
|---|---|
| `GET /api/youtube/connection` | `{ connection }` |
| `POST /api/youtube/connection/start` `{}` | `{ authorizeUrl }` — 화면은 이 주소로 **최상위 이동**(새 창 아님)한다 |
| `GET /api/youtube/oauth/callback?code&state[&error]` | 구글이 돌려보내는 주소(화면이 부르지 않는다). 302 → `<returnUrl>?youtube=<결과>` |
| `POST /api/youtube/connection/disconnect` `{}` | `{ connection }` (NOT_CONNECTED) |
| `PUT /api/youtube/consent` `{ target: 'LIVE_CHAT'｜'VIDEO_COMMENT', enabled: boolean }` | 켜졌으면 `{ connection }`, 게시 권한이 없으면 `{ authorizeUrl }`(최상위 이동 → 돌아오면 켜져 있다), 연결이 없으면 409 `YOUTUBE_NOT_CONNECTED` |

- `connection` = `{ status: 'NOT_CONNECTED'｜'CONNECTED'｜'RECONNECT_NEEDED', channel: { id, title } | null, permissions: { read, publish }, consent: { liveChat: { enabled, at }, videoComment: { enabled, at } } }`. 토큰·만료 시각은 없다.
- 돌아오기 결과 `?youtube=` 코드와 문장(서버 상수 `CALLBACK_MESSAGES`):
  `connected` "유튜브 채널을 연결했어요." · `STATE_INVALID` "연결 시간이 지났어요. 다시 시도해 주세요." · `ACCESS_DENIED` "구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요." · `NO_CHANNEL` "이 구글 계정에는 유튜브 채널이 없어요." · `CHANNEL_TAKEN` "이 채널은 연결할 수 없어요. 운영자에게 문의해 주세요." · `CHANNEL_MISMATCH` "처음 연결한 채널과 달라요. 바꾸려면 먼저 연결을 끊어 주세요." · `GOOGLE_FAILED` "구글에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요."
- `returnUrl` 기본값은 `<앱 주소>/settings/youtube`(운영 `LIVEJJIM_YOUTUBE_RETURN_URL`로 바꿀 수 있다). 돌아오는 주소(`LIVEJJIM_GOOGLE_REDIRECT_URI`)는 **화면과 같은 출처의 `/api/youtube/oauth/callback`**이어야 세션 쿠키가 실린다(화면이 `/api`를 서버로 넘긴다).
- 동의를 끄면 `{ connection }`(그 대상의 기다리던 행은 "자동 게시에 동의하기 전의 감사예요."가 된다). 끊으면 동의도 꺼진다.

#### 2. 방송 잇기 (AC-Y1-10~13)
| 요청 | 응답 |
|---|---|
| `GET /api/youtube/live-broadcasts` | `{ broadcasts: [{ videoId, title, status: 'LIVE'｜'UPCOMING', scheduledStartTime, actualStartTime, linkedBroadcast }] }` (`linkedBroadcast` = 이미 이어진 이 판매자의 회차 ID 또는 null) |
| `POST /api/youtube/parse-video` `{ video }` | `{ videoId }` 또는 400 `INVALID_VIDEO_URL` (유튜브를 부르지 않는다 — 붙여넣기 칸 즉시 확인용) |
| `GET /api/broadcasts/:id/youtube` | `{ link: { videoId, channelId, linkedAt, chatEnded } | null, collector: CollectorView | null }` |
| `POST /api/broadcasts/:id/youtube` `{ requestId, video }` (`video` = 주소 또는 영상 ID) | 위와 같은 모양. 같은 `requestId`면 처음 결과 |
| `POST /api/broadcasts/:id/youtube/unlink` `{}` | `{ link: null, collector: null }` |
| `POST /api/broadcasts/:id/youtube/collector/restart` `{}` | 위와 같은 모양 (멈춘 수집기 다시 시작 — `collector.restartable`일 때만) |

오류 코드·문장(`LINK_MESSAGES`): 남의·없는 회차 404 · `INVALID_VIDEO_URL` 400 "유튜브 방송 주소를 확인해 주세요." · `REHEARSAL_LINK` "리허설 방송에는 유튜브 방송을 이을 수 없어요." · `BROADCAST_ENDED` "끝난 방송에는 유튜브 방송을 이을 수 없어요." · `ALREADY_LINKED` "이 방송에는 이미 유튜브 방송이 이어져 있어요. 먼저 연결을 끊어 주세요." · `NOT_MY_CHANNEL` "내 채널의 방송만 연결할 수 있어요." · `NO_LIVE_CHAT` "채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요." · `VIDEO_IN_USE` "이미 다른 방송에 이어진 유튜브 방송이에요." · `NOT_LINKED` "이어진 유튜브 방송이 없어요." · `YOUTUBE_NOT_CONNECTED` "유튜브 채널을 먼저 연결해 주세요." · `YOUTUBE_RECONNECT_NEEDED` "유튜브 연결을 다시 해 주세요." · `YOUTUBE_UNAVAILABLE` 502 "유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." · `COLLECTOR_NOT_RESTARTABLE` "다시 시작할 수 없는 수집이에요." · `SEALED` (아래 5). 409가 기본(표에 적은 것 밖).

#### 3. 수집 상태 (AC-Y1-24·25·28)
`CollectorView` = `{ status, statusMessage, reason, reasonMessage, mode: 'STREAM'｜'POLL', lastMessageAt, recorded, skippedBeforeLink, gap, gapMessage, restartable }`
- `status`: `STARTING` "시작하는 중" · `LIVE` "채팅을 받는 중" · `RETRYING` "다시 연결하는 중" · `STOPPED`(이유 문장이 `statusMessage`) · `FINISHED` "방송을 끝내 수집을 마쳤어요." · `CHAT_ENDED` "유튜브 채팅이 끝났어요."
- 멈춘 이유 `reason`: `RECONNECT` "유튜브 연결을 다시 해 주세요." · `NOT_CONNECTED` "유튜브 연결이 끊겨 수집을 멈췄어요." · `NOT_MY_CHANNEL` "내 채널의 방송이 아니에요." · `QUOTA` "오늘 유튜브 사용량을 다 썼어요."(태평양 자정 뒤 저절로) · `CHAT_DISABLED` "채팅이 꺼져 있어요." · `FORBIDDEN` "채팅을 읽을 권한이 없어요." · `CHAT_NOT_FOUND` "채팅을 찾을 수 없어요." · `UNLINKED` "유튜브 방송 연결을 끊었어요." · `SEALED` "30일이 지나 봉인한 방송이에요."
- `RECONNECT`·`NOT_CONNECTED`·`NOT_MY_CHANNEL`·`QUOTA`는 조건이 풀리면 저절로 이어받는다. `CHAT_DISABLED`·`FORBIDDEN`·`CHAT_NOT_FOUND`는 판매자가 다시 시작(`restartable: true`).
- `gap: true`면 `gapMessage` "끊긴 동안의 채팅 일부를 받지 못했을 수 있어요." `skippedBeforeLink` = 잇기 전에 게시돼 기록하지 않은 수. `recorded` = 그 방송에 기록된 유튜브 채팅 수.

#### 4. 발송함 (AC-Y1-32·38·39)
| 요청 | 응답 |
|---|---|
| `GET /api/days/:date/outbox[?rehearsal=true]` | `{ date, rehearsal, rows: OutboxRowView[] }` — 실제 범위만, 리허설은 늘 빈 목록 |
| `POST /api/outbox/:id/resend` `{ requestId }` | `{ row }` 또는 409 (아래) |

- `OutboxRowView` = `{ id, target: 'LIVE_CHAT'｜'VIDEO_COMMENT'｜'SUMMARY', broadcast, product, buyer, text(게시할 글), state, stateMessage, reason, reasonMessage, attempts, nextAt, postedAt, messageId, manual, groupWith: [같은 메시지의 다른 행 ID] }`
- `state`: `WAITING` 기다림 · `SENDING` 보내는 중 · `SENT` 게시됨 · `SKIPPED` 건너뜀 · `FAILED` 보내지 못함.
- `reason`과 `reasonMessage`(`OUTBOX_REASON_MESSAGES`): 보내지 못함 — `NO_CONSENT` "자동 게시에 동의하기 전의 감사예요." · `NO_LINK` "이어진 유튜브 방송이 없어요." · `CHAT_ENDED` "유튜브 채팅이 끝났어요." · `NO_PERMISSION` "게시 권한이 없어요." · `EXPIRED` "너무 늦어 보내지 않았어요." · `GAVE_UP` "여러 번 보내지 못했어요." · `REJECTED` "유튜브가 받지 않았어요." · `SEALED` "30일이 지나 보내지 않았어요." / 건너뜀 — `CANCELLED` "확정이 풀린 판매라 보내지 않아요." / 기다림 — `WINDOW` "묶어서 보내려고 기다리는 중이에요." · `RETRY` "다시 보내려고 기다리는 중이에요." · `RECONNECT` "유튜브 연결을 다시 해 주세요." · `QUOTA` "오늘 유튜브 사용량이 얼마 남지 않아 기다리는 중이에요." / 보내는 중 — `CONFIRM`·`CONFIRM_LISTED` "올라갔는지 확인하는 중이에요."
- 재전송 409 코드: `RESEND_NOT_ALLOWED` "다시 보낼 수 없는 감사예요."(FAILED가 아님) · `EFFECT_CANCELLED` "확정이 풀린 판매라 보내지 않아요."(행은 SKIPPED가 된다) · `ALREADY_SENT` "이미 게시된 감사예요." · `NO_PERMISSION` "게시 권한이 없어요." + `authorizeUrl`(게시 권한을 받으러 최상위 이동) · `NOT_LINKED` · `CHAT_ENDED` · `YOUTUBE_RECONNECT_NEEDED` "유튜브 연결을 다시 해 주세요." · `QUOTA_PAUSED` "오늘 유튜브 사용량이 얼마 남지 않아 채팅 수집에 남겨 둬요." · `SEALED`. 남의·없는 행 404. 요청 번호 필수(400 `INVALID_REQUEST_ID`).
- 화면의 "감사 실패" 알림 띠는 `state: 'FAILED'` 행을 보인다(SPEC §7 화면 2).

#### 5. 지운 메시지·차단 알림, 할당량, 봉인 (AC-Y1-27·53·62)
- `GET /api/days/:date/youtube-notices` → `{ date, notices: [{ id, kind: 'DELETED'｜'BANNED', broadcast, messageId, channel, nick, wasOrder, wasCancel, banType: 'PERMANENT'｜'TEMPORARY'｜null, banSeconds, at, message }] }` — `message` "시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요." / "유튜브에서 차단된 시청자예요. 라이브찜에서도 막으려면 차단해 주세요." (`nick`은 시청자 입력 — 이스케이프)
- `GET /api/youtube/quota` → `{ quota: { day(태평양 날짜), used, remaining, budget, resetsAt(UTC ISO), mode: 'NORMAL'｜'BATCH'｜'PAUSED', methods: [{ method, calls, units }] } }` — 그 판매자 것만(프로젝트 전체 숫자 없음).
- 범위 목록 `GET /api/days`의 행에 `sealAt`(유튜브 채팅이 있는 실제 범위만, 아니면 null)·`sealed`(boolean)가 늘 붙는다. **화면은 `sealAt` 전에 미리 알린다**(I3).
- 봉인한 날짜: `GET /api/days/:date` = 같은 모양 + `sealed: true`·`sealedAt`(상품·판매(`claims` = 확정 판매만)·구매자·정산·방송은 봉인한 장부, `pending`·`effects`·`cancelRequests`·`attention`은 빈 목록). `GET /api/days/:date/messages` = `{ messages: [], more: false, sealed: true, sealedMessage: '30일이 지나 채팅 내용을 지웠어요.' }`. `GET /api/days/:date/changes`는 410 `RESYNC_REQUIRED`(전체를 다시). 그 범위에 쓰는 모든 요청은 409 `SEALED` "30일이 지난 방송 기록은 봉인되어 고칠 수 없어요."

#### 6. 실시간 알림 (SSE `GET /api/stream`)
새 이벤트 이름 `youtube` 하나, `data.kind`로 나눈다(그 판매자 연결에만, 커밋된 뒤 1초 안).
- `{ kind: 'connection', connection }` — 연결 상태·권한·동의가 바뀜
- `{ kind: 'collector', broadcast, date, collector }` — 수집 상태가 바뀜(상태·이유·방식·gap)
- `{ kind: 'outbox', date, ids, state, reason }` — 발송함 행 상태가 바뀜(화면은 목록을 다시 받는다). 요약 댓글을 만들면 `{ kind: 'outbox', date, summary: <회차 ID> }`
- `{ kind: 'quota', mode }` — 할당량 모드가 바뀜
- `{ kind: 'notice', date, notice }` — 지운 메시지·차단 알림이 새로 생김
- `{ kind: 'sealed', date }` — 그 날짜를 봉인함

#### 7. 화면이 지켜야 할 것
- 권한 안내 문장(읽기만·게시 권한 추가가 무엇인지)은 화면 몫이다. 서버는 승인 주소만 준다.
- 토큰·`code`·`state`는 화면에 없다(서버가 응답에 넣지 않는다). `authorizeUrl`은 최상위 이동으로만 쓰고 저장·로그하지 않는다.
- 닉네임·채팅 본문·알림의 `nick`은 신뢰할 수 없는 입력 — 늘 이스케이프.
- 봉인 예고(`sealAt`)를 보인다. 봉인 뒤 쓰기 버튼은 막는다(서버도 409).

#### 8. 가짜 구글·유튜브 서버로 E2E 돌리기 (AC-Y1-81)
- 기동: `pnpm --filter @livejjim/server e2e --port <api> --origin <화면 주소> --youtube fake --youtube-port <port>` (`--youtube-port 0`이면 빈 포트). 시작 줄에 `· 가짜 유튜브 http://127.0.0.1:<port>`가 붙는다. 워커(수집기 1초 순회·발송함 1초·봉인)가 함께 돈다.
  - Playwright 설정(`apps/web/playwright.config.ts` — I3/dev-web 몫)에서 쓸 때 포트 예: `--youtube-port ${4100 + offset}` (`E2E_PORT_OFFSET` 따름). 이 저장소에서 지금 그 설정은 바꾸지 않았다(화면 몫).
- 돌아오는 주소는 `<화면 주소>/api/youtube/oauth/callback`(화면이 `/api`를 넘긴다), 연결 뒤 `<화면 주소>/settings/youtube?youtube=<결과>`.
- 조작(다른 프로세스, JSON POST, 응답 JSON):
  - `POST /_fake/accounts` → `{ account }` · `POST /_fake/channels { account?, title?, channelId? }` → `{ id, title, account }`
  - `POST /_fake/approval { account?, channel?, deny?, grant? }` — 다음 승인 화면의 선택(채널 고르기·거절·일부 권한만)
  - `POST /_fake/broadcasts { channelId, title?, status: 'live'｜'upcoming'｜'complete', chat?: false }` → `{ videoId, liveChatId, … }`
  - `POST /_fake/messages { liveChatId, author, name, text?, type?, userComment?, publishedAt? }` → `{ id }` (`type`: textMessageEvent·superChatEvent·memberMilestoneChatEvent·superStickerEvent·newSponsorEvent …)
  - `POST /_fake/delete { liveChatId, messageId }` · `POST /_fake/ban { liveChatId, channelId, name, seconds? }` · `POST /_fake/end-chat { liveChatId }`
  - `POST /_fake/fail { method, fault, times? }` — `method`: `liveChatMessages.streamList`·`liveChatMessages.list`·`liveChatMessages.insert`·`commentThreads.insert`·`liveBroadcasts.list`·`videos.list`·`channels.list`·`oauth.token`·`oauth.refresh`·`oauth.revoke` … / `fault`: `{ status, reason? }`(예 `{ status: 403, reason: 'quotaExceeded' }`·`{ status: 400, reason: 'invalid_grant' }`) · `{ kind: 'hang' }`(응답 없음) · `{ kind: 'acceptHang' }`(게시는 받고 응답 없음) · `{ kind: 'cut' }`(스트림 묶음 중간 끊김) · `{ kind: 'reset' }`
  - `POST /_fake/clear-faults` · `POST /_fake/revoke-all`(사용자가 권한을 거둠) · `POST /_fake/drop-streams`(네트워크 끊김)
  - `GET /_fake/state[?liveChatId=]` → `{ posted: [{ liveChatId, id, text, authorChannelId }], comments: [...], calls: { 메서드: 횟수 }, messages? }`
- 우리 채널이 게시한 메시지는 그 채팅에 작성자 = 우리 채널로 다시 나온다(수집기는 그것을 기록하지 않는다).

### 테스터(test-domain)에게 — 프로그램 API로 시험하기
`@livejjim/server`에서 가져온다(포트 없이):
```ts
const timer = new ManualTimer(Date.parse('2026-10-19T11:00:00Z'))
const fake = await FakeGoogle.start({ now: () => timer.now() })          // 127.0.0.1 빈 포트
const server = createServer({ database, masterKey, appOrigin, clock: timer, timer, instanceName: 'A',
  youtube: { clientId: fake.clientId, clientSecret: fake.clientSecret, redirectUri: 'https://api.test/api/youtube/oauth/callback',
             returnUrl: 'https://app.test/settings/youtube', endpoints: fake.endpoints(), allowInsecure: true } })
installGoogleBlock()   // 실제 구글 주소로 나가는 요청을 막는다 (blockedRequests.count)
```
- 워커는 시험이 돌린다: `server.youtube.collectors.start()`(또는 `.scan()`) · `server.youtube.outbox.runOnce()` · `server.sealer.runOnce()`. 시계는 `timer.advance(ms)`/`timer.set(ms)`(그 사이 `sleep`이 시각 순으로 풀린다). 서버가 죽은 흉내: `collectors.kill()`·`outbox.kill()`(임대를 놓지 않는다). 같은 DB로 서버를 하나 더 만들 때 `instanceName`을 다르게.
- 주입점: `collectorHooks.beforeSaveToken`(묶음 기록 뒤·지점 저장 전), `outboxHooks.afterPost`(게시 응답 뒤·SENT 적기 전), `sealHooks.beforeCommit`, 기존 `hooks.beforeCommit`(게시 보고 기록 실패).
- 승인 흐름: `POST /api/youtube/connection/start` → `fetch(authorizeUrl, { redirect: 'manual' })`의 `Location` 쿼리를 `GET /api/youtube/oauth/callback<쿼리>`(세션 쿠키)로.
- 서버 시험의 도우미는 `apps/server/test/youtube-support.ts`(같은 모양).

### 만든 것
- **표**(마이그레이션 `0003_y1_youtube.sql`): `youtube_connections`(토큰은 마스터 키 AES-GCM 암호화, 채널 유일) · `youtube_oauth_states`(state 해시·검증 값 암호화·세션 해시·10분) · `youtube_links`(잇기 — 누가·언제, 회차마다 끊지 않은 연결 하나는 부분 유일 색인) · `youtube_collectors`(이어받기 지점·방식·상태·임대) · `youtube_own_messages`(우리 채널 메시지 — 게시 확인) · `youtube_notices` · `youtube_quota`(판매자·태평양 날짜·호출 종류) · `chat_raw`(채팅 본문·이름) / `events.chat_source`·`events.raw` / `scopes.youtube_chat`·`sealed_at`·`ledger`·`ledger_digest` / `outbox` 실행기 칸(state·reason·target·group_id·attempts·next_at·deadline_at·post_text·sent_text·attempt_at·confirm_until·remote_id·posted_at·reported·manual·resend_request_id·lease).
- **원문 분리 (AC-Y1-60)** `writer.ts`: 모든 `chat` 이벤트의 `text`·`nick`을 떼어 `chat_raw`에 같은 트랜잭션으로 둔다. 요약값 = SHA-256(범위·seq·종류·본문·실패 표시·이름·본문). 재생·조회(`store.ts` `eventsAfter`·`historyRows`·`chatRows`)는 합쳐서 Y1 전과 같은 모양. `raw = false`(Y1 전) 이벤트는 그대로 재생.
- **봉인 (AC-Y1-61·62)** `youtube/seal.ts`(`Sealer`): 범위 락 안 한 트랜잭션. 장부 = 방송·상품(가격 이력)·확정 판매(확정 시각 = 재생으로 그 찜이 확정 목록에 들어간 이벤트의 `at`)·구매자(품목이나 정산 기록이 있는 구매자만)·정산 묶음. 기록 경로는 봉인한 범위에 409 `SEALED`, 범위 상태는 봉인한 범위를 다시 불러오지 않는다, 재생 검사는 "봉인됨"·장부 요약값만.
- **구글 어댑터** `youtube/google.ts`: 승인 주소·코드 교환·새로 고침·폐기·Data API(시간 제한 15초, 게시 10초)·streamList(시간 제한 없음, 배열/이어 붙인 JSON 둘 다 받는 `JsonObjectSplitter`). Data API는 보내기 직전 할당량에 센다.
- **연결** `youtube/connect.ts`, **잇기·조립** `youtube/system.ts`, **수집기** `youtube/collector.ts`(`CollectorManager` — 임대 20초·5초마다 늘림·5초 순회), **발송함** `youtube/outbox.ts`(+ 실행기 전용 질의 `youtube/outbox-store.ts`), **할당량** `youtube/quota.ts`, **글 다루기** `youtube/texts.ts`, **시계·태평양 날짜** `youtube/timer.ts`, **API** `youtube/routes.ts`, **가짜 서버** `youtube/fake-google.ts`, **시험의 구글 주소 막기** `youtube/network-guard.ts`(서버 시험 `setupFiles`).
- **수집 경로 이름 정리 (AC-Y1-22)**: `Service.#recordChat`(시청자로 보내기·생성기·`ingestChat`)과 `ingestYoutubeBatch`(수집기의 한 응답을 한 트랜잭션으로)가 `sanitizeNick`으로 정리해 기록한다.
- **설정·기동**: `readYoutubeSetting`(`LIVEJJIM_GOOGLE_*`, https만 — `.env.example`에 키 목록), `main.ts`가 `livejjim.start()`로 워커(수집기·발송함·봉인)를 돌린다. E2E 기동 `--youtube fake`.
- **골든 러너 합계 (AC-Y1-90)**: `packages/core/test/golden/core-adapter.test.ts` 파일 22 · 파서 385 · 엔진 121 · 통과 506(이름의 AC 번호 AC-Y1-90). 그 밖의 코어·골든·러너는 손대지 않았다.

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **실제 범위에 기록되는 채팅은 유튜브 채팅으로 본다** — `ingestChat`을 실제 방송에 부르는 길도 수집 경로이므로 `chat_source = 'youtube'`(봉인 대상)이다. 리허설은 `rehearsal`, E2E 채우기(기록 경로 직접)는 `other`(봉인 예정 없음).
- **게시 요청의 연결 끊김(응답을 모름)도 타임아웃처럼 확인부터 한다** (AC-Y1-35 "네트워크 오류"는 다시 시도 대상이지만, 보낸 뒤 끊겼을 수 있어 바로 다시 보내면 두 번 게시될 수 있다). 확인으로 못 찾으면 실패 한 번으로 세고 2·4·8…초 다시 시도 — 결과는 같은 다시 시도이고 두 번 게시만 막는다. 5xx로 실패한 시도도 다시 보내기 직전에 수집기가 본 우리 메시지에 그 글이 있으면 SENT로 본다(API 호출 없음).
- **같은 방송·대상의 메시지는 효과 순서대로 하나씩** 보낸다(채팅에 순서가 뒤바뀌지 않게). 서로 다른 방송·대상끼리는 함께.
- **할당량 멈춤 모드에서도 실시간 채팅 감사의 창은 max(설정, 60)초로 잡는다**(BATCH와 같이 — 어차피 멈춤이 풀릴 때까지 기다린다).
- **"오늘 구글이 할당량 초과를 알렸음"은 프로젝트 전체에 적용**한다(구글 할당량은 프로젝트 하나). 판매자 데이터가 없는 표를 만들지 않으려고 알린 판매자의 할당량 행에 표시(`method = '#quotaExceeded'`)를 두고 그날 행을 모아 본다. 표시 API에서는 뺀다.
- **state는 해시만 두고, 쓰면 지운다**(같은 문장으로 꺼내며 지워 두 번 처리 없음). 다른 세션이 보낸 state는 지우지 않는다(그 세션의 연결을 망치지 않게). 로그인 없이 돌아오면 `STATE_INVALID`로 화면에 돌려보낸다(돌아오는 주소는 공개 경로).
- **승인 주소에 `prompt=consent`**를 붙인다 — 다시 연결할 때도 새로 고침 토큰을 받게(구글은 처음 동의 때만 주는 일이 있다). 새로 고침 토큰이 오지 않으면 이전 것을 그대로 둔다.
- **영상이 없으면(videos.list 빈 목록) `NOT_MY_CHANNEL`** — 비공개 등 다른 채널의 영상은 우리 토큰으로 보이지 않는다.
- **끊기 = 연결 행 삭제**. 잇기 행은 그때의 채널을 기억해, 다른 채널을 연결하면 그 회차 수집은 `NOT_MY_CHANNEL`, 같은 채널로 다시 연결하면 저장한 지점부터 이어 간다.
- **수집 상태의 `recorded`는 그 방송에 기록된 유튜브 채팅 수**(DB에서 센다) — 묶음 기록 뒤 지점 저장 전에 죽어도 정확하다.
- **요약 댓글 행**: 종류 `SUMMARY_COMMENT`, 효과 ID `summary:<회차>:<n>`(같은 회차에 두 번 만들지 않는다), 재생 검사의 발송함 대조에서 뺀다(엔진 효과가 아니다).
- **봉인 때 발송함 행의 효과 본문에서도 감사 문구를 지운다** — 확정이 풀린 시청자(산 적 없음)의 이름이 문구에 남지 않게.
- **범위 목록의 `sealAt`·`sealed`는 늘 붙인다**(없으면 null·false) — 화면이 한 모양으로 읽게.
- **가짜 서버의 지점은 `p<위치>`**, 지점 없이 부르면 처음부터 준다(시험이 첫 응답을 정하기 쉽게). 스트림은 응답을 `[`…`,`…로 조금씩 보낸다.

### 바꾼 기존 테스트 (약화 아님 — 계약이 바뀌었다)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| 범위 목록 `{ date, rehearsal, seq }` (`api.test.ts`·`e2e.test.ts`·`scope-seq.test.ts`·`rehearsal.test.ts`) | 행마다 `sealAt`·`sealed`가 붙는다 | AC-Y1-62 |
| DB 로그를 직접 재생하는 시험의 본문 읽기 (`write-path.test.ts`·`concurrency.test.ts`·`product-history.test.ts`) | `chat_raw`를 합친 본문(`support.ts` `MERGED_BODY`·`RAW_JOIN`) | AC-Y1-60 (채팅 `text`·`nick`이 본문에서 빠졌다) |
| 재생 검사 변조 "이벤트 본문 `"text":"1"` 바꾸기" (`check-replay.test.ts`·`rehearsal.test.ts`) | 이벤트 본문(채널) 바꾸기 + 따로 둔 본문·이름 바꾸기·지우기 (각각 불일치) | AC-Y1-60 |
| "표시 없는 재생 오류" 흉내의 본문·요약값 (`check-replay.test.ts`) | 채널을 숫자로 바꾸고 따로 둔 값까지 묶은 요약값 | AC-Y1-60 |
| 마이그레이션 명령 뒤 표 수 9 (`commands.test.ts`) | 17 (스키마 표 목록과 같다는 검사는 그대로) | Y1 표 |
| 손상 값 시험 `sealed.slice(0, -2) + 'AA'` (`secrets.test.ts`) | 끝이 이미 `AA`면 `BA` — 256번에 한 번 꼴로 바꾼 것이 없어 실패하던 것을 고정 | 시험 안정화(검사 내용 같음) |
| 골든 합계 (`packages/core/test/golden/core-adapter.test.ts`) | 파일 22 · 파서 385 · 엔진 121 · 통과 506 | AC-Y1-90 |

적대 시험(`tests/adversarial/**`)은 손대지 않았다. DB의 채팅 본문(`events.body`의 `text`·`nick`)을 직접 읽는 적대 시험은 지금 없다(찾아봄) — 앞으로 쓸 때는 `chat_raw`를 합쳐야 한다.

### 시험 (내 영역, `apps/server/test/youtube-*.test.ts` 9개 파일 · 137개)
- `youtube-texts` 주소 읽기 표·이름 정리 표(무작위 500)·게시 문구·묶음 분할·요약·태평양 날짜(한 해 내내 Intl과 같음)·KST 봉인 시각·스트림 나누기·주입 시계
- `youtube-connect` AC-01~06 (state 만료·재사용·다른 세션·동시 두 번, PKCE, 토큰 DB 전체 검색 0건, 마스터 키 바뀜, 새로 고침 1번, 401, invalid_grant → 수집기 멈춤 → 같은 채널 다시 연결 → 이어서 수집, SSE, 끊기)
- `youtube-link` AC-10~13 · `youtube-collector` AC-20~29 (2,000건·끊김 5번·지점 저장 직전 죽음 → 다른 서버가 이어받음, 1만 건·재생 = 상태) · `youtube-outbox` AC-30~46 · `youtube-quota` AC-50~53 · `youtube-seal` AC-60~62 · `youtube-security` AC-70~72 · `youtube-fake` AC-80·81(실제 HTTP로 연결 → 잇기 → 채팅 → 판정 → 감사 게시)
- 모든 서버 시험은 `TZ=Pacific/Honolulu`에서 돌고, 실제 구글 주소로 나가는 요청이 생기면 그 파일이 실패한다.

### 남은 것·사용자 몫
- 화면 전부(I3): 위 계약으로. Playwright 설정에 `--youtube fake --youtube-port` 넣기도 I3/dev-web 몫.
- HG-3(실제 유튜브 테스트 방송)·구글 클라우드 프로젝트·OAuth 검증(D-019)·법률 검토(D-012): 사용자.
- 실제 streamList의 통신 모양(HTTP/1.1 JSON 스트림)은 공식 문서의 응답 필드로 맞췄다. 실제 구글이 다른 줄 나눔으로 보내도 `JsonObjectSplitter`가 객체 단위로 읽는다 — HG-3에서 확인.
