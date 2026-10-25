# BND1 dev-notes

## dev-server (BND1) — 한 일

- 밴드 모듈 `apps/server/src/band/**` (밴드로 보내는 읽기 요청만 있는 곳)
  - `comment.ts` 순수 함수: `bandText`(D-BND1-04), `bandComment`(골든 kind comment), `bandBatch`(골든 kind batch), `bandFirstLine`(글 첫 줄 40자). 실제 읽기 경로(`service.ts #ingest`)와 골든 시험이 같은 함수를 부른다(AC-BND1-90).
  - `endpoints.ts` 주소 표 하나(GET 일곱 개). 표에 없는 이름·GET이 아닌 방식은 보내기 전에 `BandRequestRefused`(AC-BND1-60).
  - `client.ts` 읽기 클라이언트: 10초 시간 제한, `result_code`·HTTP 상태 나누기(AC-BND1-51), `next_params`의 `access_token`·`band_key`·`post_key` 버리기, 앱 전체 한도(1001) 쉼 60→600초(쉬는 동안 보내지 않음).
  - `config.ts`(`LIVEJJIM_BAND_*` 다섯, https만·내 컴퓨터 http 허용), `crypto.ts`(토큰 AES-256-GCM, 판매자 ID AAD), `messages.ts`(판매자 문장 전부), `store.ts`(저장 — 모든 쿼리에 판매자 ID), `fake.ts`(가짜 밴드 서버), `service.ts`(묶음 본체).
- 밴드 모듈 밖(플랫폼 공통·조립): `platform.ts`(`BAND`·`band:`·"밴드"), `thanks-route.ts`(`band:` → `SKIP_NOT_SUPPORTED`, 밴드 연결 기록 = 다른 플랫폼), `backup.ts`(출처 `band:` → `other`, 복구 때 열린 밴드 글 연결 FINISHED(RESTORED), 본 댓글 표 지움, 토큰 남김), `platform-record.ts`(댓글 묶음 기록 — 수집 경로·조치자 collector·출처 other·한 트랜잭션), `band-routes.ts`(API 경로), `server.ts`·`api.ts`·`instagram/routes.ts`(플랫폼 능력·연결 목록·공통 끊기 `platform: 'BAND'`), `hub.ts`(SSE `band`), `roles.ts`(보조자: 회차 밴드 연결 보기만), `log.ts`(BAND_* 코드), `production.ts`(설정 읽기·경고 `BAND_CONFIG_INVALID`), `e2e.ts`·`commands/e2e-server.ts`(가짜 밴드·조종 경로·`--band fake`).
- DB: `apps/server/drizzle/0020_bnd1_band.sql` — `band_accounts`·`band_oauth_states`·`band_links`·`band_seen`·`band_notices`. **밴드 글 연결은 회차·범위를 외래 키로 잇지 않는다**(복구가 범위를 다시 만들어도 행이 남아 FINISHED가 된다). 다른 트랙(ttx·ql3·mob2 등)이 같은 번호 0020을 쓰면 합칠 때 번호만 바꾼다.
- 문서: `.env.example`·`docs/DEPLOY.md`(환경변수 표 다섯 줄, 4-6절 "네이버 밴드", 로그에 남기지 않는 것).
- 서버 시험(`apps/server/test/band-*.test.ts`, 단위·통합): 골든 43(합계 고정), 플랫폼·설정·주소·운영 상태, 계정 연결, 잇기·읽기·기록, 알림·실패·다시 시도·호출 한도, 개인정보. `test/setup-band-guard.ts`가 서버 시험 전체에서 `band.us` 연결을 막는다(AC-BND1-63).

## 화면에게 (dev-web) — 경로·필드 계약

모든 문장은 서버가 준 글자 그대로 쓴다. 영문 값(`status`·`state`·`code`·`kind`)은 프로그램만 읽는다.

### 설정 "네이버 밴드" (AC-BND1-70)
- `GET /api/band` → `{ band: { status, message, profileName, connectedAt, chosenBand } }`
  - `status`: `NOT_CONFIGURED` · `NOT_CONNECTED` · `CONNECTED` · `RECONNECT_NEEDED`. `message`는 연결됨이 아니면 그 문장(설정 없음 "밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요." · 연결 안 함 "설정에서 밴드를 먼저 연결해 주세요." · 다시 연결 "밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요."), 연결됨이면 `null`.
  - 연결됨 문장 "연결됨 — {profileName}"은 화면이 만든다(`profileName`이 null이면 "연결됨"만 — 프로필을 못 받은 경우).
- `POST /api/band/connect` `{}` → `200 { url }` — 화면은 그 주소로 이동한다(다시 연결도 같은 단추). `409 NOT_CONFIGURED`면 `error.message`.
- 밴드가 돌려보내면 서버가 `302 <앱 주소>/settings/band?band=<결과>`로 보낸다. 결과 → 문장(서버 `BAND_CALLBACK_RESULTS`와 같다):
  `connected` "밴드를 연결했어요." · `denied` "밴드 연결을 취소했어요." · `expired` "연결 시간이 지났어요. 다시 해 주세요." · `scope` "밴드 앱 권한이 모자라요. 운영자에게 문의해 주세요." · `failed` "밴드 연결에 실패했어요. 잠시 뒤 다시 해 주세요." — 한 번 보이고 주소에서 지운다.
- `POST /api/band/disconnect` `{ requestId }` → `200 { band }` (같은 요청 번호는 같은 응답).
- 보조자: 위 경로는 모두 403 — 칸을 그리지 않는다.

### 콘솔 "밴드" 칸 (AC-BND1-71~74)
- `GET /api/broadcasts/:id/band` → `{ link: BandLinkView }` (보조자도 200). 다른 판매자·없는 회차 404.
- `BandLinkView`:
  - `state`: `NONE`(이은 적 없음) · `READING` · `RETRYING` · `RECONNECT_NEEDED` · `NO_ACCESS` · `YOUTUBE_LINKED` · `FINISHED`. `message`: 상태 문장(AC-BND1-50 표 — 호출 한도면 "밴드가 잠시 쉬어 달라고 해서 {N}초 뒤에 다시 읽어요."가 이미 채워져 있다), NONE이면 null.
  - `canLink`·`blockCode`·`blockMessage`: **지금 새로 이을 수 있는지와 막는 까닭** — `NOT_CONFIGURED`·`NOT_CONNECTED`·`RECONNECT_NEEDED`(→ 문장 + "설정으로"), `REHEARSAL` "리허설 방송에는 라이브를 이을 수 없어요.", `ENDED`, `YOUTUBE_LINKED` "유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.", `RECEIVED_TIME_NOT_ALLOWED`, `BAND_IN_USE`, `ALREADY_LINKED`(이 회차에 이미 이어짐). NONE·FINISHED·NO_ACCESS 칸의 "밴드 글 잇기"/"다른 글 잇기"는 `canLink`로 정한다(NO_ACCESS는 먼저 끊어야 `canLink`가 true).
  - `linkedAt`, `actor { kind:'account', loginId }`, `post { bandKey, postKey, firstLine }`, `lastReadAt`(ISO — "HH:MM:SS에 읽었어요"는 화면이 KST로), `received`(받은 댓글 수), `baseline`, `baselineMessage`(N=0이면 null), `skipped { SELLER, NO_AUTHOR, BAD_COMMENT_KEY, BAD_TIME, NO_TEXT, TEXT_TOO_LONG, DUPLICATE }`, `skipMessages`(작성자 모름·너무 긺 문장 — 0~2개), `failures`, `retryAt`, `rateLimited`, `finishReason`(`UNLINKED`·`ENDED`·`ACCOUNT_CHANGED`·`DISCONNECTED`·`RESTORED`).
  - `notices { items: [{ id, kind(DELETED·EDITED·LATE), message, at, seen }] (최근 20개, 새것 먼저), total, seenUpTo, unseen, unseenEdits }` — 알림 띠 "밴드에서 지우거나 고친 댓글이 {N}개 있어요."의 N = `unseenEdits`. "새 알림" 글자는 `seen === false`. 늦게 읽음(LATE)도 같은 목록.
- 잇기 흐름 (AC-BND1-72):
  - `GET /api/band/bands` → `{ bands: [{ bandKey, name, memberCount|null }], chosenBand, message }` — 기억한 밴드가 맨 앞, 없으면 `message` "가입한 밴드가 없어요. 밴드 앱에서 먼저 밴드를 만들어 주세요."
  - `GET /api/band/posts?band=<bandKey>[&cursor=<cursor>]` → `{ posts: [{ postKey, createdAt|null, firstLine, commentCount|null }], page, more, cursor }` — 내 글만. "더 보기" = 받은 `cursor`로 다시. 내 글이 없으면 `posts: []`(문장 "이 밴드에 내가 쓴 글이 없어요. 밴드 앱에서 공지 글을 먼저 올려 주세요."는 화면이 — 수용 기준 문장). 6쪽째는 `400 MORE_LIMIT` "글은 다섯 쪽까지만 볼 수 있어요. 최근 글을 이어 주세요." · 고른 밴드가 목록에 없으면 `400 UNKNOWN_BAND` · 오래된 cursor `400 CURSOR_EXPIRED` "목록이 오래됐어요. 글 목록을 다시 불러와 주세요." (이 세 문장은 수용 기준에 없어 dev-server가 정했다 — spec-keeper 확인).
  - `POST /api/broadcasts/:id/band/link` `{ requestId, bandKey, postKey }` → `200 { link }` / 거절은 `{ error: { code, message } }` 그대로 보인다(AC-BND1-22 표 + 읽기 실패 `NO_ACCESS`(409)·`RATE_LIMITED`(503)·`UNAVAILABLE`(503 "밴드 댓글을 읽지 못해 다시 시도하고 있어요.")). 응답이 늦어 다시 보내도 같은 `requestId`면 연결 하나·기준선 읽기 한 번.
  - 끊기 `POST /api/broadcasts/:id/band/unlink` `{ requestId }` → `200 { link }`(FINISHED "끊었어요.") · `409 NOT_LINKED` "이어진 밴드 글이 없어요.". 공통 `POST /api/broadcasts/:id/live/unlink` `{ requestId, platform: 'BAND' }`도 같다(플랫폼을 적지 않으면 끊지 않은 연결이 하나뿐일 때 그것 — 밴드도 센다).
  - "확인했어요" `POST /api/broadcasts/:id/band/notices-seen` `{ upTo: <본 마지막 notices.items[].id> }` → `200 { link }`.
  - 공통 `POST /api/broadcasts/:id/live/link`·`/live/wait`에 `platform: 'BAND'`를 보내면 400(밴드는 위 잇기 경로).
- SSE `event: band` — `data.kind`: `ACCOUNT { band }`(계정 보기) · `LINK { broadcast, link }`(회차 연결 보기 — 읽을 때마다·상태가 바뀔 때마다). 보조자 연결도 받는다.
- `GET /api/platforms`에 `BAND` 항목(AC-BND1-02). `GET /api/live`·`GET /api/broadcasts/:id/live`의 `links`에 끝나지 않은 밴드 연결(BandLinkView)이 더해진다.
- 플랫폼 글자(AC-BND1-75): 구매자 키·메시지 ID가 `band:`로 시작하면 "밴드"(서버 `platformOfKey`와 같은 규칙 — 대문자 `BAND:`·쌍점 없는 `bandX`는 유튜브).

### E2E 기동 (test-e2e·dev-web)
- `node apps/server/src/commands/e2e-server.ts ... --band fake [--band-port <N>]` — 가짜 밴드 서버를 127.0.0.1에 띄우고 밴드 연동을 그 주소로 둔다. 읽기 간격 **1초(빠른)·3초(전체)** (`E2E_BAND_FAST_MS`·`E2E_BAND_FULL_MS`). 돌아오는 주소 = `<origin>/api/band/callback`(화면 개발 서버의 /api 넘기기를 탄다). 가짜 승인 창은 화면 없이 바로 돌아오는 주소로 보낸다(`/_e2e/band/login`으로 허락·거부를 정한다).
- 유튜브를 이은 회차(시나리오 8)는 가짜 구글과 같은 서버여야 한다 — `--youtube fake ... --band fake`를 함께.
- 조종 경로(이 기동에서만, JSON POST · 조회는 GET) — `apps/server/src/e2e.ts` `registerBandControl` 주석에 전부:
  `/_e2e/band/user {name,userKey?}→{userKey}`(처음 사용자가 승인 창 기본 사용자) · `/_e2e/band/login {decision,userKey?,scope?,omitUserKey?,expiresIn?}` · `/_e2e/band/band {name,members}→{bandKey}` · `/_e2e/band/post {bandKey,authorUserKey|null,content?,createdAt?}→{postKey}` · `/_e2e/band/comment {postKey,content,name?,userKey?|null,createdAt?,commentKey?}→{commentKey}` · `/_e2e/band/comments {postKey,items}`(한 번에 여러 개) · `/_e2e/band/drop`·`/_e2e/band/edit` · `/_e2e/band/fail {op,resultCode?|http?|kind?,times?}` · `/_e2e/band/clear` · `/_e2e/band/revoke {userKey}`(토큰 풀기 — 다음 요청 10401) · `/_e2e/band/delay {op,ms}` · `GET /_e2e/band/requests → {requests,onlyAllowed}`(AC-BND1-60 마지막 단언).
- `createdAt`을 주지 않으면 가짜 서버 시계(실제 시각)다. 같은 시각 두 댓글(시나리오 4)은 `createdAt`을 같게 준다.

## 테스트에게

- test-domain(`tests/adversarial/bnd1/**`): 순수 함수 `apps/server/src/band/comment.ts`(`bandComment`·`bandBatch`·`bandText`·`bandFirstLine`), 주소 표 `endpoints.ts`, `client.ts`(`classifyBandCode`·`pagingParams`). 통합은 `apps/server/test/band-support.ts`의 `bandWorld`·`StepClock`(타이머를 하나씩 부르고 읽기가 끝날 때까지 기다린다 — `tick(w, ms)`)·`FakeBand`(오류 넣기 `fail(op, fault, times, after)` — `after`로 쪽 중간 실패, `pagingOverride`, `nextToken`·`nextCode`로 심은 값, `maxInflight` 토큰별 동시 요청 수). 본 댓글 표 적기 실패 주입은 서버 옵션 `band.hooks.beforeSeen`.
- 코드 검사(AC-BND1-60)는 `band/**` 안에 `write`·`remove`·`create_comment`·`/comment'`·`'POST'`·`'DELETE'` 글자가 없게 했다 — 그래서 API 경로(`band-routes.ts`)와 기록 도우미(`platform-record.ts`, 서버 기록기 `writer.write`를 부른다)는 밴드 모듈 밖에 있다. 글자 `POST`는 코드 값 `NOT_MY_POST`·`READ_POST`에만, `DELETE`는 알림 종류 `DELETED`에만 들어 있다(따옴표로 둘러싼 방식 이름이 아니다).
- E2E 서버의 밴드 칸: 위 "E2E 기동".

## 바꾼 기존 시험 (AC-BND1-91 — 이 문서 기준에 따른 교체)

1. `apps/server/test/live-links.test.ts` AC-N2-02 "플랫폼 능력 조회": 항목 셋 → 넷(밴드 설정이 없는 서버의 `BAND` 항목을 더함, AC-BND1-02). 시험 이름도 "…·BAND".
2. `apps/server/test/i3-accounts.test.ts` AC-I3-61 "보조자 허용 목록": `GET /api/broadcasts/x1/band`를 허용 목록에 더함(AC-BND1-15 "보조자는 회차의 밴드 연결 상태 조회만 된다").

3. `apps/server/test/i3-deploy.test.ts` AC-I3-81 "/ops/status 키 목록": `band`를 더함(AC-BND1-64).
4. `apps/server/test/commands.test.ts` AC-S04-20 "마이그레이션 명령" 표 수 69 → 74(밴드 표 다섯 — 표 이름 목록 전부를 스키마와 대조하는 줄은 그대로).
5. `apps/server/test/fb1-parcel-settings.test.ts` AC-FB1-16 "0019를 다시 적용": 마지막 마이그레이션 기록 하나만 지우던 것을 0019 뒤 기록 모두(밴드 0020 포함)와 0020의 표를 되돌리도록 — 마이그레이션이 하나 늘어 생긴 시험 준비의 교체(단언은 그대로).

감사 경로 표·백업 출처 표의 기존 시험은 그대로 통과한다(새 갈래는 밴드 시험이 본다).
서버 시험(`server`·`server-youtube`·`server-i2`, 성능 시험 제외)은 모두 통과(2,176 + 332). `test/time.test.ts`는 시험 시간대(TZ) 환경이 있어야 통과하는 시험이라 TZ 없이 돌리면 실패한다 — 밴드와 상관없다(`TZ=Pacific/Honolulu`로 통과).

## 맥북 쪽에 넘김 (금지 경로 — 유튜브)

- `apps/server/src/youtube/outbox.ts` `summaryLines`의 거르기에 `band:`를 더하면(또는 `platformOfKey(claim.buyer) === 'YOUTUBE'`이거나 문자인 판매만 남기면) 유튜브와 밴드를 한 회차에 함께 잇는 막기(D-BND1-12)를 풀 수 있다.
- AC-BND1-24의 두 갈래 중 **"다음 읽기 전에 멈춤"만 했다**: 유튜브 잇기 경로(`youtube/**`)는 이번에 손대지 않았다 — 유튜브를 이을 때 밴드가 이어져 있으면 409로 막는 쪽은 맥북 쪽이 `band_links`(state <> 'FINISHED')를 보고 하면 된다(문장 "이 방송에는 밴드 글이 이어져 있어 유튜브 라이브를 이을 수 없어요."). 지금은 유튜브가 이어지면 밴드 읽기가 다음 차례 전에 `YOUTUBE_LINKED`로 멈추고 그 뒤 밴드 댓글은 기록하지 않는다(기록 트랜잭션 안에서도 다시 본다).

## 정한 것·확인할 것 (spec-keeper — disputesWithSpec 후보)

1. 전체 읽기가 1,000개에서 멈추면(넘침) 같은 차례에 빠른 읽기를 한 번 더 한다 — 아니면 그 차례에 달린 새 댓글이 한 차례(10초) 늦게 들어간다. 판정·차례 규칙은 그대로(그 읽기로는 지움·고침을 보지 않는다).
2. 댓글이 **정확히 1,000개**인 글은 잇는다(문장이 "1,000개 넘는 글은"이라). 끝까지 읽은 목록이 1,000개 이하일 때만 "끝까지 된 읽기".
3. 서버 다시 켜기·같은 계정으로 다시 연결 뒤의 첫 읽기는 10초를 기다리지 않고 **바로, 전체 읽기**로 한다(꺼진 동안의 댓글을 빨리, 빠짐 없이). 다시 시도 중(RETRYING)이던 연결은 빠른 읽기.
4. 키 없는 댓글 수(`BAD_COMMENT_KEY`)는 "지금 읽은 목록에 있는 수"를 **전체 읽기(와 잇기 때 기준선 읽기)마다** 바꾼다 — 빠른 읽기는 목록 일부라 바꾸지 않는다. 읽기에서는 너무 긴 댓글 키(메시지 ID 256자 넘음)도 이 수에 든다(잇기 때 기준선 수는 키가 없는 것만).
5. 보관 기간: 알림의 손님 글·본 댓글 표의 처음 글은 "그 범위가 봉인됐거나 범위 날짜 ≤ 오늘(KST) − 30일"이면 지운다(서버 시작 때·1시간마다, 보기는 그 전에도 지운 문장). **확인 필요**: 지금 30일 봉인(`youtube/seal.ts`)은 유튜브 채팅이 있는 범위만 해서, 밴드 댓글만 있는 범위의 채팅 원문(`chat_raw`)은 봉인되지 않는다(인스타그램·틱톡과 같은 처지). D-BND1-14 "밴드 원본은 다른 플랫폼 채팅과 같은 보관 규칙"을 그대로 따랐다 — 밴드 실명이 많아 30일 지우기를 플랫폼 채팅 전체로 넓힐지는 결정 필요.
6. 수용 기준에 없어 정한 문장: `UNKNOWN_BAND`·`MORE_LIMIT`·`CURSOR_EXPIRED`·`NOT_LINKED`(위), 공통 잇기에 밴드를 보낼 때 "밴드는 밴드 글 잇기로 이어요.", 잇기 중 일시 실패는 상태 표의 "밴드 댓글을 읽지 못해 다시 시도하고 있어요."(503 `UNAVAILABLE`).
7. `ALREADY_LINKED` 문장은 `alreadyLinkedMessage`의 "라이브"를 "글"로 바꾸면 "글가"가 되어 수용 기준 문장 그대로 "이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요."로 적었다.
8. 돌아오기에서 다른 판매자 세션·로그인 안 함이면 표를 **쓰지 않은 채** `expired`(인스타그램과 같은 방식 — 남의 세션이 표를 태워 없애지 못하게). 그 판매자가 쓰면 성공·실패와 상관없이 한 번에 끝난다.
9. 밴드 목록의 밴드 키는 밴드가 준 값 그대로 내보낸다(불투명 값으로 바꾸지 않음 — 화면이 되돌려 보내는 값). 로그·오류 응답에는 없다.
10. `/ops/status`의 `band`: `{ configured, links: {READING,RETRYING,RECONNECT_NEEDED,NO_ACCESS,YOUTUBE_LINKED}, appPause: { active, remainingSeconds }, readers }`.

## 사람 확인 (HG-BND1) — 코드에서 기댄 곳

- 경로를 붙인 `redirect_uri`(`<등록 주소>/<표>`)가 받아들여지는지 · 거부 때 `code` 없이 돌아오는지(가짜 서버는 `error=access_denied`) · 토큰 응답의 `scope` 이름·`user_key`·`expires_in` · 글·댓글의 `author.user_key`가 실제로 오는지(안 오면 "내가 쓴 글만 이을 수 있어요."·"작성자를 알 수 없는 밴드 댓글 {N}개…") · `created_at` 밀리초 · 쪽 크기 · 오류 코드(10401·60102…). 수용 기준 HG-BND1 목록 그대로.
