# N2b-2 dev-notes (dev-server)

## 만든 것 (서버)

| 묶음 | 파일 |
|---|---|
| 틱톡 서버 연결 (동의·아이디·잇기·끊기·다시 연결·이어받기·댓글 → `chat`) | `apps/server/src/tiktok-live/live.ts`, `store.ts`, `notice.ts`, `chat.ts`, `routes.ts` |
| 댓글 붙여넣기 (줄 읽기·미리 보기·넣기) | `apps/server/src/tiktok-live/paste.ts`(순수 — 골든), `paste-service.ts` |
| 연결 모듈 보강 (N2b-1 넘김) | `apps/server/src/tiktok/connection.ts`·`limiter.ts`(새)·`library.ts`·`failure.ts`·`fake.ts`·`webcast.ts` |
| 동시 송출 (플랫폼마다 연결 하나, 판매자 잠금 하나) | `live-links.ts`, `seller-locks.ts`(`sellerLinkLockKey`), `youtube/system.ts`, `instagram/routes.ts`, `platform.ts` |
| 감사 경로 (구매자 자신의 플랫폼) | `thanks-route.ts`(새), `instagram/dm.ts`, `youtube/outbox.ts`(요약·이유 문장) |
| 운영 상태·인스타 https | `ops-store.ts`, `server.ts`, `instagram/config.ts`, `production.ts` |
| DB | `drizzle/0007_n2b2_tiktok.sql` — `tiktok_links`·`tiktok_consents`·`tiktok_accounts`·`paste_requests`, `live_links_open_uq` = (판매자, 회차, 플랫폼) |
| E2E | `e2e.ts`(`tiktok: true` → 가짜 웹캐스트 + `/_e2e/tiktok/*`), `commands/e2e-server.ts`(`--tiktok yes`) |
| 골든 러너 (코어, AC-N2b-2-90) | `packages/core/test/golden/contract.ts` ID 정규식 한 줄, 러너 자체 시험 합계 |

## 구현으로 정한 것 (스펙이 열어 둔 자리)

1. **틱톡 연결 표는 따로** (`tiktok_links`) — `live_links`에 섞으면 인스타 쿼리(기다리기·옮기기·저절로 잇기)가 틱톡 행을 집을 위험이 있어 표를 나눴다. 유일 제약: (판매자, 회차) `state='LINKED'` 하나, 판매자 `state='LINKED'` 하나(=`TIKTOK_IN_USE`). `live_links_open_uq`도 (판매자, 회차, 플랫폼)으로 바꿨다.
2. **회차를 끝내면 틱톡 연결 상태 `ENDED`** — AC-33 "연결 보기는 남는다"를 지키면서 `TIKTOK_IN_USE`가 끝난 회차 때문에 다음 회차를 막지 않게(판매자 안전). `broadcast.end`와 같은 트랜잭션(txHook)에서 바꾸고, 커밋 뒤·응답 전에 `stop()`. `ENDED` 연결은 끊기(`unlink`)로 지울 수 있다.
3. **판매자 잠금 하나** — 인프로세스 `SellerLocks` 하나를 인스타·틱톡이 나누고, DB 어드바이저리 키 `live-link/<판매자>`를 유튜브 잇기·끊기도 쓴다. 끊기(유튜브·틱톡)는 기록 트랜잭션과 같은 순서(범위 락 → 판매자 잠금)로 잡는다.
4. **감사 건너뜀은 발송함 행에 적는다** — 틱톡 구매자 `SKIPPED/NOT_SUPPORTED`, 보낼 곳 없음 `SKIPPED/NO_RECIPIENT`(유튜브를 이은 적 없고 인스타·틱톡을 이은 적 있는 회차의 유튜브·문자 구매자). 효과가 기록되는 같은 트랜잭션. 유튜브 실행기는 `state is null`만 집으므로 집지 않는다. 인스타 구매자(`ig:`)는 DM 행(전과 같음 — 기준만 "회차의 마지막 연결"에서 "구매자 키"로).
5. **붙여넣기 ref** = `pst` + (sha256(판매자·요청 번호) → 영문 소문자 16자) + `-줄-순서`. 숫자는 줄·순서뿐이라 휴대폰 번호 판단에 걸리지 않는다. 같은 요청 번호 재전송은 `paste_requests`(글 요약값만)로 처음 응답을 돌려주고, 글이 다르면 `REQUEST_REUSED`.
6. **붙여넣기 닉네임 휴대폰 번호**: 정리한 값과 정리 전 값 둘 다 본다(골든은 정리한 값만 다룬다 — 더 엄격한 쪽).
7. **늦게 열린 라이브러리 연결**(AC-41): `libraryWebcast()`가 아이디마다 앞 시도의 `connect()`가 끝날 때까지(최대 20초) 새 시도를 열지 않는다 — 판매자 하나의 열린 라이브러리 연결이 어떤 순서에서도 많아야 하나. 버린 시도가 늦게 열리면 감싸개가 한 번 닫는다(그 시점 끊기 호출 1).
8. **멈춘 연결 보기의 "자료"** = 라이브러리 2.1.0 `websocketData`(ControlEvent.WEBSOCKET_DATA — 웹소켓으로 받은 모든 메시지, 하트비트 응답 포함)와 `chat`. 가짜 웹캐스트는 제어 이벤트(connected·disconnected·error 등)가 아닌 `emit`마다 `websocketData`를 먼저 낸다.
9. **방 ID 없음 대응표**(AC-45): `FetchIsLiveError`(맨 바깥)의 `errors`가 정확히 셋이고 모두 일반 `Error`, 메시지가 `Failed to extract Room ID from HTML.`·`… API.`·`… Euler.`이면 `NOT_LIVE`. 하나라도 다르면(없는 사용자·막힘·네트워크·Euler 권한) 이 판단을 하지 않는다.
10. **로그 넘친 수** — `LogRecord.suppressed`(정해진 칸), 출력 `suppressed=N`.
11. 라이브러리 환경 변수 경고는 `TIKTOK_LIBRARY_ENV` + `reason=<변수 이름>`(이름만).
12. 다시 연결 30초 한도는 `tiktok_links.started_at`(잇기·다시 연결 때 적음)으로 본다 — 서버가 둘이어도·다시 켜져도 같다.

## 바꾼 기존 시험 (스펙 변경에 따른 교체 — 약화 아님)

| 시험 | 바뀐 것 | 근거 |
|---|---|---|
| `packages/core/test/golden/core-adapter.test.ts` 실제 골든 합계 | 파일 29·엔진 135·통과 609 → 30·137·611 | AC-N2b-2-90 |
| `packages/core/test/golden/scenario-id.test.ts` | 받는 ID에 `G-ENG-N2b-2-01` 등, 거르는 ID에 `G-ENG-N2b-2-1`·`G-ENG-N2b-2-3-01` 등을 더함 | AC-N2b-2-90, D-N2b-2-12 |
| `test/tiktok-golden.test.ts` | 파일 2→4, 사례 58→90, `kind` chat·paste | AC-N2b-2-91 |
| `test/tiktok-connection.test.ts` AC-N2b-1-31 | `NOT_LIVE`를 같은 시간표 시험에서 뺌(새 시간표는 `tiktok-n2b2-connection.test.ts`) | AC-N2b-2-43, D-N2b-2-11 (라) |
| `test/tiktok-flow.test.ts` 연결 객체 조작 | `start·stop·status` → `start·resume·stop·off·status` (틱톡에 보내는 조작은 여전히 없음) | AC-N2b-2-23·35 |
| `test/tiktok-flow.test.ts` 동의 한 번 | 1시간 받는 동안 100초마다 방 정보 자료를 보낸다(120초 멈춤 보기 때문) | AC-N2b-2-40 |
| `test/tiktok-boundary.test.ts` | "모듈 밖은 틱톡 모듈을 잇지 않는다" → "`tiktok/index.ts`로만 잇는다" | AC-N2b-1-62, N2b-2 |
| `test/live-links.test.ts` 플랫폼 능력 | 틱톡 이유 문장 4개 | AC-N2b-2-04 |
| `test/live-links.test.ts` AC-N2-03 | `ALREADY_LINKED` 문장에 "인스타그램" | AC-N2b-2-01 |
| `test/live-links.test.ts` AC-N2-04 틱톡 자리 | `PLATFORM_NOT_SUPPORTED` → 기다리기 400·잇기 `PLATFORM_NOT_READY`(운영자 꺼짐) | AC-N2b-2-30 |
| `test/live-links.test.ts` 어댑터 모양 | 틱톡 파일 위치에 `src/tiktok-live/**`를 더함 | N2b-2 |
| `test/live-move.test.ts` ⑧ | `ALREADY_LINKED` 문장 | AC-N2b-2-01 |
| `test/youtube-link.test.ts` | 유튜브 `ALREADY_LINKED` 문장 "유튜브 방송이" → "유튜브 라이브가" | AC-N2b-2-01 |
| `test/instagram-dm.test.ts` AC-N2-42 | 인스타만 이은 회차의 문자찜 감사: DM 행 `SKIPPED(NO_RECIPIENT)` → 유튜브 발송함 행 `SKIPPED(NO_RECIPIENT)` | AC-N2b-2-10·11, D-N2b-2-09 |
| `test/i3-accounts.test.ts` 보조자 허용 목록 | 붙여넣기 두 경로를 더함 | AC-N2b-2-59 |
| `test/i3-deploy.test.ts` 운영 상태 키 | `instagramDm`·`tiktok`을 더함 | AC-N2b-2-70 |
| `test/commands.test.ts` 표 수 | 31 → 35 | 새 표 넷 |

## 화면에게 (dev-web)

모든 경로는 `/api` 공통 규칙(로그인·Origin·JSON·64KB). 오류 본문 `{ error: { code, message, problems? } }` — `message`를 글자 그대로 보인다.

### 1. 플랫폼 능력 `GET /api/platforms`
`{ platforms: [YOUTUBE, INSTAGRAM, TIKTOK] }`. `TIKTOK.ready` = 운영자 스위치. `reasons.ready`(꺼짐) = "지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요."

### 2. 틱톡 설정 (판매자만 — 보조자 403)
- `GET /api/tiktok` → `{ tiktok: { operator, operatorMessage, notice: { version, title, lines[8], checkbox, button }, consent: { on, at, version } | null, tiktokId } }`
  - `operator` 거짓이면 `operatorMessage` "지금은 틱톡 연결을 쓸 수 없어요."만 보인다(AC-25).
  - 켜져 있음 = `consent?.on === true && consent.version === notice.version`.
- `POST /api/tiktok/consent { requestId, on: true, version: notice.version }` · 끄기 `{ requestId, on: false }` → `{ tiktok }`. 판이 다르면 409 `NOTICE_CHANGED`.
- `PUT /api/tiktok/account { tiktokId: "@아이디" | 방송 주소 | null }` → `{ tiktok }`. 해석 실패 400 `INVALID_TIKTOK_ID`(`message`·`problems[0].message` = 칸 아래 문장). 이어진 동안 409 `TIKTOK_LINKED` "먼저 틱톡 연결을 끊어 주세요."

### 3. 회차 연결 (플랫폼 공통)
- `GET /api/broadcasts/:id/live` → `{ link, links }` — `link` = 인스타그램 `LinkView`(N2 그대로), `links` = 끊지 않은 연결 플랫폼마다 하나(유튜브 `{ broadcast, platform:'YOUTUBE', state:'LINKED', linkedAt, videoId }` · 인스타그램 `LinkView` · 틱톡 `TikTokLinkView`). **`links.length >= 2`면 도착순 안내**(AC-61).
- `GET /api/live` → `{ links: [...] }` 판매자의 모든 끊지 않은 연결(같은 모양).
- 틱톡 잇기 `POST /api/broadcasts/:id/live/link { requestId, platform: 'TIKTOK' }`(라이브 ID 없음) → `{ link: TikTokLinkView }`. 오류 코드 `REHEARSAL`·`ENDED`·`ALREADY_LINKED`·`PLATFORM_NOT_READY`·`NO_CONSENT`·`NO_TIKTOK_ID`·`TIKTOK_IN_USE`·`RECEIVED_TIME_NOT_ALLOWED`.
- 끊기 `POST /api/broadcasts/:id/live/unlink { requestId, platform: 'INSTAGRAM' | 'TIKTOK' }` — **플랫폼을 늘 적어 주세요**(적지 않으면 끊지 않은 연결이 하나뿐일 때만 그것). 유튜브는 지금처럼 `/broadcasts/:id/youtube/unlink`.
- 틱톡 기다리기는 없다(`/live/wait` + TIKTOK → 400).
- 틱톡 보기 `GET /api/broadcasts/:id/tiktok` → `{ link: TikTokLinkView }`:
  ```
  { broadcast, platform:'TIKTOK', state:'NONE'|'LINKED', linkedAt, actor:{kind:'account',loginId}, tiktokId,
    collection: { state, reason, message, failures, nextAttemptAt, missed, missedMessage, comments, lastCommentAt, notRecorded, saveFailed } | null }
  ```
  `collection.state` = `IDLE`·`CONNECTING`·`CONNECTED`·`RETRYING`·`STOPPED`·`ENDED`·`OFF`, 회차를 끝냈으면 `FINISHED`. `message`를 글자 그대로, `missed`면 `missedMessage`도.
  - 알림 띠·주 단추 "댓글 붙여넣기" 조건(AC-62): `RETRYING`의 `BLOCKED`·`SIGN_FAILED`, `STOPPED`, `OFF`, `missed`.
  - "다시 연결" 보이기: `RETRYING`·`STOPPED`·`ENDED`·`OFF`.
- 다시 연결 `POST /api/broadcasts/:id/tiktok/reconnect {}` → `{ link }`, 409 `TOO_SOON` "잠시 뒤 다시 눌러 주세요."·`NOT_LINKED`·`ENDED`.
- SSE `event: tiktok` `data: { kind: 'LINK', broadcast, link: TikTokLinkView }` — 상태가 바뀔 때·잇기·끊기·끝내기. 댓글 수는 알림마다 오지 않는다 — 필요하면 보기 조회.
- 인스타그램 보내지 못한 DM 수(AC-63): `GET /api/instagram/dms?date=` 행 중 `status` `FAILED`(이유 무엇이든)인 그 회차 행을 센다 (`UNCONFIRMED`·`EXPIRED`·`GAVE_UP`·`LIVE_ENDED`는 `FAILED`의 `reason`).

### 4. 댓글 붙여넣기 (판매자·보조자 — 보조자는 실제 회차만)
- 미리 보기 `POST /api/broadcasts/:id/paste/preview { text }` → `{ rows, groups, total }`
  - `rows[]`: `{ line, nickname?, text?, result, numbers, message }` — `result` ∈ `ORDER`·`CANCEL_NOT_SUPPORTED`·`NOT_ORDER`·`NO_NICKNAME`·`PHONE_NUMBER`·`NO_TEXT`·`TEXT_TOO_LONG`. `message` 글자 그대로. 휴대폰 번호 줄은 닉네임이 없다.
  - `groups[]`: `{ nickname, lines, claims, message }` — `lines.length > 1`이면 "같은 닉네임 {N}줄은 한 구매자로 넣어요"(화면 문장, N = `lines.length`).
  - `total` = 넣을 찜 수 → 주 단추 "찜 {total}개 넣기"(0이면 누를 수 없음).
  - 전체 거절 400 `TOO_LONG`·`TOO_MANY_LINES`.
- 넣기 `POST /api/broadcasts/:id/paste { requestId, text }` → `{ rows, groups, total, added }` — "찜 {added}개를 넣었어요." 같은 요청 번호로 다시 보내면 같은 응답(찜 둘 없음). 409 `NOTHING_TO_ADD` "넣을 찜이 없어요."·`REQUEST_REUSED`(글을 고쳤으면 새 요청 번호로).
  - **글을 고치면 미리 보기를 다시 하고 새 요청 번호를 만든다.**

### 5. 채팅·구매자 플랫폼 표시
키 접두어로 안다(`platform.ts platformOfKey`): `ig:` 인스타그램 · `tt:` 틱톡 · `sms:` 문자 · 그 밖 유튜브. 채팅 메시지 `id`, 구매자 `id`.

### 6. E2E
`pnpm --filter @livejjim/server e2e ... --tiktok yes [--instagram yes] [--youtube fake]` — 운영자 스위치 켬 + 가짜 웹캐스트. 조작(서버 주소, JSON POST, 세션 없음):
- `/_e2e/tiktok/account { uniqueId, state: LIVE|OFFLINE|MISSING }` — 판매자가 저장한 아이디(소문자)의 방송 상태(처음 MISSING — 잇기 전에 LIVE로)
- `/_e2e/tiktok/comment { uniqueId, userId, nickname, comment, viewer?, msgId? }` — `viewer` = 쓴 사람 아이디(방송자 댓글이면 `uniqueId`와 같게)
- `/_e2e/tiktok/data { uniqueId }` · `/_e2e/tiktok/drop { uniqueId }` · `/_e2e/tiktok/block { uniqueId, times? }`(끊고 다음 시도들을 BLOCKED) · `/_e2e/tiktok/fail { kind, times? }` · `/_e2e/tiktok/end { uniqueId }` · `GET /_e2e/tiktok/state`
- 플레이라이트 묶음(`apps/web/playwright.config.ts`)에 `--tiktok yes --instagram yes --youtube fake` 묶음을 더해야 한다(화면 몫).

## 테스터에게
- 서버 시험: `apps/server/test/tiktok-live.test.ts`(C·D·F), `paste.test.ts`(G·72), `multi-platform.test.ts`(A·B·70·71·73), `tiktok-n2b2-connection.test.ts`(E). 도우미 `test/tiktok-live-support.ts`(`ttWorld`·`tiktokSeller`·`linkTiktok`·`connected`·`tiktokComment`).
- 시험 서버 옵션: `createServer({ tiktok: { settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }), webcast: fake.factory, clock: new FakeTikTokClock(t), libraryEnv?, limiter?, noticeVersion? } })`. 댓글 기록이 끝나기를 기다리려면 `server.tiktok.idle()`, 재시작 이어받기는 `server.tiktok.resume()`(운영 `start()`가 부른다).
- PGlite: 틱톡 연결의 동의 확인 질의가 도는 중에 DB를 닫으면 멈춘다 — `server.close()` 뒤 `server.tiktok.idle()`과 잠깐 기다린 뒤 닫는다(`ttWorld.close`).
