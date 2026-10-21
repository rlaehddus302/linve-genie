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
   - 수정 1(SA/RA-N2b-2-01): `paste_requests.result`에는 닉네임·댓글을 뺀 뼈대(줄 번호·결과 코드·번호·안내 문구, 묶음의 줄 번호·찜 수·문구, 합계·넣은 수)만 둔다. 재전송은 요약값이 같아 같은 글이 오므로 그 글을 다시 읽어 줄 번호로 닉네임·댓글을 채워 처음과 같은 응답을 만든다(`pasteSkeleton`·`pasteRehydrate`).
6. **붙여넣기 닉네임 휴대폰 번호**: 정리한 값과 정리 전 값 둘 다 본다(골든은 정리한 값만 다룬다 — 더 엄격한 쪽).
7. **늦게 열린 라이브러리 연결**(AC-41): `libraryWebcast()`가 아이디마다 앞 시도의 `connect()`가 끝날 때까지(최대 20초) 새 시도를 열지 않는다 — 판매자 하나의 열린 라이브러리 연결이 어떤 순서에서도 많아야 하나. 버린 시도가 늦게 열리면 감싸개가 한 번 닫는다(그 시점 끊기 호출 1).
8. **멈춘 연결 보기의 "자료"** = 라이브러리 2.1.0 `websocketData`(ControlEvent.WEBSOCKET_DATA — 웹소켓으로 받은 모든 메시지, 하트비트 응답 포함)와 `chat`. 가짜 웹캐스트는 제어 이벤트(connected·disconnected·error 등)가 아닌 `emit`마다 `websocketData`를 먼저 낸다.
9. **방 ID 없음 대응표**(AC-45): `FetchIsLiveError`(맨 바깥)의 `errors`가 정확히 셋이고 모두 일반 `Error`, 메시지가 `Failed to extract Room ID from HTML.`·`… API.`·`… Euler.`이면 `NOT_LIVE`. 하나라도 다르면(없는 사용자·막힘·네트워크·Euler 권한) 이 판단을 하지 않는다.
10. **로그 넘친 수** — `LogRecord.suppressed`(정해진 칸), 출력 `suppressed=N`.
11. 라이브러리 환경 변수 경고는 `TIKTOK_LIBRARY_ENV` + `reason=<변수 이름>`(이름만).
12. 다시 연결 30초 한도는 `tiktok_links.started_at`(잇기·다시 연결 때 적음)으로 본다 — 서버가 둘이어도·다시 켜져도 같다.
13. **틱톡 댓글 저장 실패**(수정 1, RA-N2b-2-02): 묶음을 바로 버리지 않고 바로 한 번 + 0.3초·1.5초 뒤 다시 쓴다(`TIKTOK_SAVE_RETRY_MS`, 기다리는 동안 새 댓글은 대기열 뒤라 받은 순서 그대로). 끝내 못 쓰면 `saveFailed`를 세고 SSE `tiktok`(LINK)을 보낸다. 연결 보기는 `saveFailed > 0`이면 `missed: true`, `missedMessage` = "저장하지 못한 틱톡 댓글이 N개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요." — 화면은 지금 그대로 알림 줄·"댓글 붙여넣기" 주 단추를 띄운다(`tiktokNeedsPaste`가 `missed`를 본다).

14. **붙여넣기 겹침**(라운드 1 분쟁 판정, RA-N2b-2-03 → D-N2b-2-14, AC-N2b-2-54): 미리 보기·넣기가 주문 줄의 번호마다 그 회차의 활성 찜(확정·대기·보류·충돌, 번호 = 지금의 상품 키)을 엔진 `listClaims`로 찾고, 그 찜의 `seq`(채팅·변환 = 원래 채팅, 문자찜 = 그 문자찜)로 기록을 읽어 입력 이름을 얻는다(`store.ts inputNamesBySeq` — 채팅은 따로 둔 이름 `chat_raw.nick`, 문자찜은 본문 `memo`, 실패 표시 이벤트 제외, 같은 범위만). 이름은 `cleanNick`으로 정리해 줄의 정리한 닉네임과 글자 그대로 비교한다. 직접 배정(`host.assign`)·봉인으로 이름을 지운 채팅은 이름이 없어 겹치지 않는다.
   - 넣기는 범위 락 안에서 다시 본다: 기록 경로 `guard`가 이제 `(tx, state)`를 받는다(락 안에서 따라잡은 상태 = build가 받는 상태). 붙여넣기는 guard에서 이름을 읽고 build에서 겹침을 반영한다(그 사이 들어온 채팅도 겹침).
   - 응답: 겹친 줄에만 `overlaps`(빠진 번호, 줄 안 순서)·`overlapMessage`("15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요." — 여럿이면 "15번·28번은 …"). `numbers`·`message`("15번 찜")는 그대로. `total`·`groups`는 겹친 번호를 뺀 넣을 찜 수(묶음은 넣을 번호가 남은 줄만). 넣기 응답의 `overlaps`는 실제로 빠진 번호뿐이다 — "그래도 넣기"로 고른 줄에는 없다.
   - `includeOverlaps`(넣기만, 줄 번호 정수 ≥1 목록, 200개까지 — 아니면 400 `INVALID_INPUT` 칸 `includeOverlaps`). 요약값에 정렬·중복 없앤 목록을 더한다(빈 목록이면 예전 요약값 그대로) — 같은 요청 번호에 고르기만 달라도 `REQUEST_REUSED`. 재전송은 처음 응답 그대로(겹침을 다시 보지 않음). 뼈대 저장에 `overlaps`·`overlapMessage`도 둔다(번호뿐 — 닉네임 없음).
   - ref는 줄 안 원래 순서 그대로(`pst…-줄-순서`, 빠진 번호의 순서는 비운다) — 고르기가 달라도 같은 줄·번호는 같은 ref.

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
- 인스타그램 보내지 못한 DM 수(AC-63): `GET /api/instagram/dms?date=` 행 중 `status` `FAILED`인 그 회차 행을 센다 (`UNCONFIRMED`·`EXPIRED`·`GAVE_UP`·`LIVE_ENDED`는 `FAILED`의 `reason`). 단 `reason`이 `NO_CONSENT`(동의하기 전)·`NO_LINK`(잇지 않음)인 행은 세지 않는다 — 판매자가 할 일이 없다(SPEC YT-06 화면, D-I3-05; 수정 1 SA-N2b-2-003으로 고침).

### 4. 댓글 붙여넣기 (판매자·보조자 — 보조자는 실제 회차만)
- 미리 보기 `POST /api/broadcasts/:id/paste/preview { text }` → `{ rows, groups, total }`
  - `rows[]`: `{ line, nickname?, text?, result, numbers, message }` — `result` ∈ `ORDER`·`CANCEL_NOT_SUPPORTED`·`NOT_ORDER`·`NO_NICKNAME`·`PHONE_NUMBER`·`NO_TEXT`·`TEXT_TOO_LONG`. `message` 글자 그대로. 휴대폰 번호 줄은 닉네임이 없다.
  - `groups[]`: `{ nickname, lines, claims, message }` — `lines.length > 1`이면 "같은 닉네임 {N}줄은 한 구매자로 넣어요"(화면 문장, N = `lines.length`).
  - `total` = 넣을 찜 수 → 주 단추 "찜 {total}개 넣기"(0이면 누를 수 없음).
  - 전체 거절 400 `TOO_LONG`·`TOO_MANY_LINES`.
- 넣기 `POST /api/broadcasts/:id/paste { requestId, text, includeOverlaps? }` → `{ rows, groups, total, added }` — "찜 {added}개를 넣었어요." 같은 요청 번호로 다시 보내면 같은 응답(찜 둘 없음). 409 `NOTHING_TO_ADD` "넣을 찜이 없어요."·`REQUEST_REUSED`(글을 고쳤으면 새 요청 번호로).
  - **글을 고치면 미리 보기를 다시 하고 새 요청 번호를 만든다.**
- **겹친 줄 (AC-N2b-2-69, D-N2b-2-14)** — 미리 보기·넣기 응답의 `rows[]`에 겹친 줄만 `overlaps: number[]`·`overlapMessage`가 더 있다. `overlapMessage`를 결과 문장 아래에 글자 그대로, 그 줄에 "그래도 넣기" 체크 상자(기본 꺼짐).
  - 미리 보기 `total`은 겹친 번호를 뺀 수다. 화면의 N = `total` + (고른 줄의 `overlaps.length` 합) — 고르기를 바꿔도 미리 보기를 다시 하지 않는다.
  - 넣기는 고른 줄 번호를 `includeOverlaps: number[]`로 보낸다(없으면 빈 목록과 같다). 처음 넣기를 누른 뒤에는 고르기를 잠그고, 다시 보내는 넣기는 같은 요청 번호·같은 `includeOverlaps`(다르면 409 `REQUEST_REUSED`).
  - 끝 안내: M = 넣기 응답 `rows`의 `overlaps.length` 합(그 사이 들어온 채팅으로 빠진 번호 포함, 고른 줄은 0). M > 0이면 "찜 {added}개를 넣었어요. 이미 있는 찜 {M}개는 넣지 않았어요.", 0이면 앞 문장만.
  - 겹침만 남아 넣을 것이 없으면 넣기가 409 `NOTHING_TO_ADD`다(미리 보기 뒤에 채팅이 들어온 경우).

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

---

# N2b-2 dev-notes (dev-web)

## 만든 것 (화면)

| 묶음 | 파일 |
|---|---|
| 플랫폼 낱말·판단 (키 접두어 → 플랫폼, 틱톡 막힘·다시 연결·붙여넣기 주 단추 조건, 인스타 결과 문장, DM 실패 수) | `apps/web/src/lib/platforms.ts` |
| 콘솔 인스타그램·틱톡 칸, 도착순 안내, 알림 띠 맨 앞 항목(틱톡 알림 줄·인스타그램 알림·붙여넣기 결과) | `apps/web/src/components/ConsolePlatforms.tsx`, `ConsolePage.tsx` |
| 붙여넣기 창 (콘솔·문자찜 화면 같은 창) | `apps/web/src/components/PasteDialog.tsx`, `SmsPage.tsx` |
| 설정 인스타그램·틱톡 라이브(베타) 칸 | `apps/web/src/components/PlatformSettings.tsx`, `SettingsPage.tsx` |
| 채팅 줄·구매자 목록·합치기·문자찜 구매자 고르기의 플랫폼 글자 | `ChatPanel.tsx`, `BuyersPage.tsx`, `SmsPage.tsx` |
| SSE `instagram`·`tiktok` 받기 | `lib/stream.ts`, `lib/console-store.ts`(`onPlatform`), `lib/live-events.ts`(`onPlatform`) |
| 주소 `/settings/instagram`·`/settings/tiktok`, `?instagram=<결과>`(경로 `/`여도 설정 인스타그램 칸) | `lib/router.ts` |
| E2E 묶음 `chromium-multi` (@multi) | `apps/web/playwright.config.ts` (`fakeMetaUrl`·`e2eServerUrl`) |

## 구현으로 정한 것

1. **플랫폼 칸 자리**: 콘솔 왼쪽 열(스크롤 영역) — 현재 상품 아래에 도착순 안내 → 유튜브 칸 → 인스타그램 칸 → 틱톡 칸. 고정 영역에는 줄을 더하지 않는다(수정 1, TE-N2b-2-001 — 기존 고정 영역만으로 254px라 한 줄(58px)도 35% 284px를 넘었다): 붙여넣기 결과 문장(10초)·틱톡 알림 줄(버튼 — 누르면 붙여넣기 창)·인스타그램 알림 최근 하나(문장 그대로, 누르면 인스타그램 칸의 알림 목록으로 포커스)는 기존 알림 띠(`AlertStrip` `leads`)의 맨 앞 항목이다. 휴대폰에서는 띠와 함께 한 줄(44px)로 접히고 긴 문장은 말줄임(단추 이름은 전문, "알림 N 펼치기"로 전문), PC는 문장 그대로. 인스타그램 알림의 "닫기"는 인스타그램 칸 알림 목록(`인스타그램 알림`)의 줄마다 있다.
2. **이어진 플랫폼 수**(도착순 안내): 유튜브 `link !== null` + 인스타그램 `state !== 'NONE'`(기다리기 포함 — 서버 `links`와 같은 기준) + 틱톡 `state === 'LINKED'`. SSE로 바로 바뀐다.
3. **틱톡 칸의 준비 안 됨 문장**: 서버가 조회 응답으로 주지 않아 잇기 거절 문장(AC-30 표)과 같은 글자를 화면 상수로 둔다. 운영자 꺼짐은 `GET /api/platforms`의 `TIKTOK.reasons.ready`를 먼저 쓴다. 이 상태에서는 문장 + "설정으로"만(AC-62 "만 보인다") — 붙여넣기는 문자찜 화면에서 할 수 있다.
4. **"댓글 붙여넣기"**: 틱톡이 이어진 동안 칸에 늘 있고, 막힘 조건(AC-62)일 때만 주 단추(`button-primary`)이고 알림 줄이 보인다. 끝난 방송(`FINISHED`)에서는 알림 줄을 띄우지 않는다.
   - **`missed`는 지금 댓글을 받지 못할 때만 막힘으로 센다**(수정 1, SA-N2b-2-006·TE-N2b-2-004·UX-N2b-2-02): 저절로 다시 붙어 `CONNECTED`이면서 `missed`이면 알림 줄·주 단추를 띄우지 않고, 칸에 서버 `missedMessage`("끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.")만 경고로 남긴다("댓글 붙여넣기"는 보조 단추로 그대로). 댓글이 들어오는데 "들어오지 않아요. 붙여 넣어 주세요"를 띄우면 판매자가 이미 들어온 댓글을 붙여 넣어 같은 시청자가 틱톡·문자 두 구매자로 찜한다(유령 찜). AC-N2b-2-62 글자("`missed`일 때는 … 주 단추·알림 띠")와 다르므로 **spec-keeper 확인 요청**: AC-62의 `missed` 조건을 "`missed`이고 `CONNECTED`가 아닐 때"로 고치고, `CONNECTED`+`missed`의 경고를 끄는 조작("확인했어요" — 서버 API 필요)을 둘지 DECISIONS에 정해 주세요.
5. **인스타그램 돌아오기**: 서버 `LIVEJJIM_IG_RETURN_PATH` 기본이 `/`라 `/?instagram=<코드>`를 설정의 인스타그램 칸으로 연다(결과 문장 한 번, 주소에서 지움). 결과 문장은 N2 `CALLBACK_MESSAGES`와 같은 글자.
6. **칸 상태를 받지 못함**(`/api/instagram`·`/api/tiktok` 실패): 경고 영역(alert)이 아닌 보통 문장 + "다시 불러오기" — 방송 중 급한 일이 아니라서.
7. **보내지 못한 DM 수**: `GET /api/instagram/dms?date=` 중 그 회차·`FAILED` 행 수 — `reason` `NO_CONSENT`·`NO_LINK`는 빼고(YT-06 화면 "동의하지 않음·방송을 잇지 않음은 세지 않는다", 수정 1 SA-N2b-2-003). SSE `instagram` `DM`이 오면 다시 센다.
9. **쓰기 응답과 SSE 순서**(수정 1, TE-N2b-2-003): 잇기·끊기·다시 연결·기다리기 응답은 보내기 직전의 상태 번호(`ttStamp`/`igStamp`)와 비교해, 그사이 SSE·조회로 상태가 바뀌지 않았을 때만 넣는다. 바뀌었으면 응답을 버리고 `GET /api/broadcasts/:id/tiktok`(인스타그램은 `/live`)로 서버 상태를 다시 받는다.
10. **조작 오류 문장**(수정 1, UX-N2b-2-03): 연결 상태(틱톡은 상태·이유까지)가 바뀌면 앞선 조작 오류를 지우고, "끊기" 확인 창을 열 때도 지운다.
11. **붙여넣기 창 키보드**(수정 1, UX-N2b-2-01): 미리 보기를 마치면 포커스가 "찜 N개 넣기"로(넣을 찜이 있을 때). 보는 동안 "미리 보기"는 잠그지 않고 `aria-busy`(잠그면 포커스가 창 밖으로 빠져 "닫기"로 간다). 글 칸 Ctrl+Enter(⌘Enter)는 미리 보기, 미리 본 뒤면 넣기. 붙여 넣던 글은 부른 쪽(콘솔·문자찜 화면 — 문자찜은 그 방송에만)에 남아 창을 닫았다 열어도 그대로이고, 넣기를 마치면 비운다.
8. **서버 영역 최소 변경**(dev-server 영역): E2E 시험이 가짜 메타 `/_fake/*`를 부르려면 포트를 알아야 해서 `e2e-server.ts --instagram-port`, `startE2eServer({ instagramPort })`, `FakeMeta.start({ port })`를 더했다(기본은 전과 같이 빈 포트).

## 테스터(e2e)에게

- 묶음: `chromium-multi` — 시험 제목에 `@multi`. 화면 5179·서버 3107·가짜 유튜브 4102·가짜 메타 4103(+`E2E_PORT_OFFSET`). 서버 인자 `--youtube fake --instagram yes --instagram-port <포트> --tiktok yes`.
- 주소: `import { fakeMetaUrl, fakeYoutubeUrl, e2eServerUrl } from 'apps/web/playwright.config.ts'` — `fakeMetaUrl(project)`로 `/_fake/accounts`·`/_fake/login`·`/_fake/live`·`/_fake/comments`, `e2eServerUrl(project)`로 `/_e2e/tiktok/*`.
- 화면 이름(role·name):
  - 설정: 영역 `인스타그램`·`틱톡 라이브(베타)`. 틱톡: 체크 상자 `안내를 읽었고, 위 내용에 동의해요`, 버튼 `켜기`, 칸 `내 틱톡 아이디`, `저장`, `끄기`(창 `틱톡 연결 끄기` 안의 `끄기`). 인스타그램: `인스타그램 연결하기`(다시 연결은 `인스타그램 다시 연결하기`), `연결 끊기`(창 `인스타그램 연결 끊기`), `감사 DM 자동 발송 켜기`(창 `감사 DM 자동 발송`의 `동의해요`)·`감사 DM 자동 발송 끄기`.
  - 콘솔: 영역 `인스타그램`·`틱톡`(리허설은 `인스타그램·틱톡`). 버튼 `틱톡 잇기`·`다시 연결`·`끊기`(창 `틱톡 연결 끊기`)·`댓글 붙여넣기`, `인스타그램 기다리기`·`진행 중인 라이브 고르기`(목록 `진행 중인 인스타그램 라이브`의 `이 라이브 잇기`)·`끊기`(창 `인스타그램 연결 끊기`), 링크 `설정으로`. 알림 줄 버튼 이름 = "틱톡 댓글이 들어오지 않아요. 댓글을 직접 붙여 넣어 주세요."(영역 `알림` 안, 맨 앞). 인스타그램 알림은 영역 `알림` 안의 단추(이름 = 알림 문장)이고, 닫기 `인스타그램 알림 닫기`는 인스타그램 칸의 목록 `인스타그램 알림` 안에 있다.
  - 붙여넣기 창: 대화 상자 `댓글 붙여넣기`, 글 칸 `붙여 넣을 댓글`, `미리 보기`, 목록 `줄마다 결과`·`같은 닉네임`, 주 단추 `찜 N개 넣기`(넣는 중 `넣는 중…`). 끝나면 창이 닫히고 상태 문장 "찜 N개를 넣었어요."(콘솔은 영역 `알림` 맨 앞, 10초). 글 칸 Ctrl+Enter = 미리 보기/넣기
  - 문자찜 화면: 고른 방송 칸의 `댓글 붙여넣기`.
  - 채팅 줄의 플랫폼 글자는 `.tag-platform`("유튜브"·"인스타그램"·"틱톡"). 구매자 목록 "종류" 칸이 "유튜브"·"인스타그램"·"틱톡"·"문자".
- 직접 띄워 보기: `pnpm --filter @livejjim/server e2e --port 4707 --origin http://localhost:6779 --youtube fake --youtube-port 5702 --instagram yes --instagram-port 5703 --tiktok yes` + `node apps/web/e2e/serve.ts --port 6779 --api http://127.0.0.1:4707`(apps/web에서).
