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

## dev-web (BND1) — 한 일

- 낱말·판단: `apps/web/src/lib/platforms.ts`(`band:` → `BAND`, "밴드" — 대문자 `BAND:`·쌍점 없는 `bandX`는 유튜브), `apps/web/src/lib/band.ts`(돌아온 결과 문장·확인 창·단추·알림 띠 문장, `bandNotComing`·`bandUnseenEdits`·`bandSeenUpTo` 등). 타입 `api/types.ts`(`BandAccount`·`BandLinkView`·`BandEvent` …, `PlatformName`에 `BAND`). SSE `band`를 받는다(`stream.ts`·`live-events.ts`·`console-store.ts` — `PLATFORM_STREAM_TYPES`).
- 설정 `components/BandSettings.tsx` + `SettingsPage.tsx`: 칸 이름 "네이버 밴드"(틱톡 칸 뒤, 보조자에게는 칸도 요청도 없음). 주소 `/settings/band`, 돌아온 결과 `?band=` → 한 번 보이고 주소에서 지움(`router.ts` `bandResult`). 모르는 결과 값은 "밴드 연결 결과를 확인하지 못했어요. 아래 연결 상태를 확인해 주세요."(수용 기준에 없어 정함 — 인스타그램과 같은 방식).
- 콘솔 `components/ConsoleBand.tsx` + `ConsolePlatforms.tsx`: 틱톡 칸 뒤 "밴드" 칸(영역 이름 `밴드`, id `band-panel`), 알림 목록(목록 이름 `밴드 알림`, id `band-notices`). 고르기 창 제목 "밴드 고르기"·"내 글 고르기"·"이 글 잇기", 끊기 창 "밴드 연결 끊기"(설정 끊기 창도 같은 제목). 밴드 목록 이름 `가입한 밴드`, 글 목록 이름 `내가 쓴 글`.
  - "다른 글 잇기": `NO_ACCESS`면 끊기 → 고르기, `FINISHED`이고 `canLink`면 바로 고르기.
  - 다시 시도 60초: 마지막으로 읽은 때(`lastReadAt`, 없으면 `linkedAt`)부터 60초가 넘으면 알림 띠. 화면이 그때 맞춰 다시 그린다(타이머).
  - 휴대폰 폭에서 그리지 않는 칸: 이은 연결이 없고 `canLink`가 거짓이며 막는 까닭이 설정 쪽(`NOT_CONFIGURED`·`NOT_CONNECTED`·`RECONNECT_NEEDED`)·`ENDED`·`REHEARSAL`이고 알림·오류가 없을 때. `YOUTUBE_LINKED`·`BAND_IN_USE`·`RECEIVED_TIME_NOT_ALLOWED` 막힘은 휴대폰에서도 문장을 보인다.
  - 리허설 회차: 지금의 "인스타그램·틱톡" 한 줄("리허설 방송에는 라이브를 이을 수 없어요.")을 그대로 두고 밴드 칸·밴드 요청은 없다(같은 문장이 두 번 나오면 기존 E2E `getByText`가 깨진다).
- 개인정보처리방침: 1번 목록에 `BAND_ITEM` 한 줄(시청자 정보 다음).
- E2E 설정 `apps/web/playwright.config.ts`: `chromium-multi`(가짜 유튜브·메타와 같은 서버) `--band fake --band-port 4107+오프셋`, `webkit-iphone` `--band fake --band-port 4108+오프셋`. `fakeBandUrl(project)`. 조작은 `e2eServerUrl(project)` + `/_e2e/band/*`.
- 단위 시험 `apps/web/test/bnd1-band.test.tsx`(32개), `e2e-config.node.test.ts`에 밴드 묶음 1개. 웹 단위 시험 전체 통과(105파일). 타입 검사·lint 통과.
- 실제 브라우저 확인(임시, 커밋 안 함): `chromium-multi` 서버로 375폭 연결 → 밴드 둘 중 고르기 → 내 글만 → 잇기(기준선 3) → 새 댓글 → 지움 알림 → 확인했어요 → 토큰 풀림 문장까지 통과, 가로 넘침 없음, 가짜 밴드가 받은 요청 `onlyAllowed: true`. 띄운 서버는 꺼짐.

- U-BND1-01(사용성 지적, 휴대폰 알림 띠 "밴드…" 잘림): 밴드 두 줄("들어오지 않아요"·"지우거나 고친 댓글")은 `AlertLead.full` — "알림" 영역 안 첫 목록(`ul.alerts-full`), 나머지 알림은 둘째 목록(`ul.alerts-rest`). 휴대폰 접힌 띠는 두 칸 격자(subgrid): 첫 줄은 화면 폭 전체에 문장 끝까지(줄바꿈), 둘째 줄은 나머지 알림 한 줄 + "알림 n 펼치기"(영역 밖 그대로). 접힌 동안 옆 "확인했어요"는 숨긴다(무슨 알림인지 보기 전 누르지 않게) — 펼친 띠·PC·밴드 칸에는 그대로. 임시 측정(커밋 안 함, 크로미움·WebKit 375·412 × 100·150%): 문장 잘림 0·가로 넘침 0·단추 44px 이상, 고정 영역은 100%에서 약 65px, 150%에서 약 140px 늘어난다(밴드 알림이 있는 동안만). 밴드 줄이 없으면 띠는 예전과 같다.

### 화면 → test-e2e
- 보조자는 콘솔·설정을 열 수 없다(앱이 문자찜 입력 화면만 연다 — `AssistantBlocked`). 그래서 AC-BND1-71 "보조자는 상태·수·알림만"·E2E 10번 "콘솔 상태만"은 더 강하게 막혀 있다: 보조자로 콘솔 주소를 열면 "문자찜 입력만 쓸 수 있어요" 안내이고 밴드 요청은 0이다. 이 차이는 spec-keeper 확인 후보(disputesWithSpec).
- 판매대장·확인서(`packages/documents`)에는 플랫폼 이름을 적는 곳이 없다(인스타그램·틱톡도 없음). 플랫폼 글자를 쓰는 화면은 채팅 줄(`ChatPanel`)·구매자 목록·표·상세·찾기·합치기 창(`BuyersPage`)·문자찜 입력의 구매자 찾기(`SmsPage`) — 모두 `platformOfKey`/`buyerPlatformWord`를 거쳐 "밴드"로 나온다(AC-BND1-75).
- 알림 띠 줄 이름: "밴드 댓글이 들어오지 않아요."(누르면 밴드 칸에 포커스), "밴드에서 지우거나 고친 댓글이 {N}개 있어요."(누르면 알림 목록에 포커스) + 옆 단추 "확인했어요". 밴드 칸에도 "확인했어요"(늦게 읽음만 남았을 때도).
- "잇기"를 누르면 단추가 잠기고 "글을 읽는 중이에요…"(창 안 상태 문장). 응답이 늦을 때 다시 보내기는 네트워크 실패만 같은 요청 번호로 자동(`withRetry`) — 잠긴 동안 또 누를 수 없다.

## dev-server (BND1 수정 라운드) — TD-BND1-001~003 · RA-BND1-01·02

- **읽기 줄**: 판매자마다 밴드 댓글 읽기 줄(`#reads`, 메모리) 하나 — 빠른·전체 읽기 한 차례 전체와 잇기의 글 상세·기준선 읽기가 이 줄로 차례로 돈다(AC-BND1-30). 끊기·회차 끝·다시 연결(`#retire`)은 진행 중인 밴드 요청을 `AbortSignal`로 바로 닫는다(클라이언트 `api(..., signal)`, 실패 코드 `ABORTED`) — 다른 회차 잇기는 10초 시간 제한을 기다리지 않는다.
- **잠금 밖 잇기 (RA-BND1-01)**: 잇기는 거절 검사·글 상세·기준선 읽기를 판매자 공통 잠금(인스타그램 웹훅 기록·틱톡·인스타그램 잇기와 같은 잠금) **밖에서** 한다. 잠금은 그 뒤 짧은 DB 단계(요청 번호 다시 보기 → 어드바이저리 락 트랜잭션 안 다시 확인 → 연결)에만. 같은 요청 번호가 겹쳐 오면 메모리 약속(`#linking`)을 같이 기다린다(밴드에 한 번). 겹친 다른 잇기는 다시 확인·부분 유일 색인이 막는다(`BAND_IN_USE`/`ALREADY_LINKED`).
- **전체 읽기 쪽 수 상한 (TD-BND1-002)**: ⌈1,000 ÷ 본 가장 큰 쪽 크기⌉ + 10쪽(`BAND_TIMING.fullSparePages`). 쪽이 모두 비면 쪽 크기 20으로 본다 → 60쪽. 넘으면 '끝까지 되지 않음'(잇기 = 503 `UNAVAILABLE` "다시 시도", 60초 읽기 = 지움·고침을 보지 않고 넣을 것만 넣음), 로그 `BAND_PAGING_LIMIT`(수만).
- **다음 읽기 보장 (RA-BND1-02)**: 다시 시도는 타이머를 먼저 걸고 상태를 쓴다. 상태 읽기·쓰기가 던지면 메모리의 실패 수(`entry.failures`)로 같은 시간표(10·20·40·80·160초, 그 뒤 300초)를 건다(로그 `BAND_RETRY_STATE_FAILED`). 한 차례가 무엇으로 끝나든, 연결이 살아 있는데 걸린 타이머가 없으면 `finally`에서 건다.
- **고친 글 해시 모두 (TD-BND1-001)**: `band_seen.edited_hash`에 알린 고친 글 해시를 공백으로 나눠 모두 둔다(최근 200개, 해시는 base64url이라 공백 없음). 마이그레이션 없음 — 예전 값(해시 하나)도 그대로 읽힌다.
- 시험: `apps/server/test/band-overlap.test.ts`(8개 — 잇기 중 연결 끊기가 바로 끝남·같은 요청 번호 한 번·빈 쪽 60쪽에서 끝·쪽 크기 1이면 120개 끝까지·60초 읽기 상한 뒤 계속 읽기·끊기 뒤 다른 회차 잇기 겹침 없음·저장 실패 + DB 읽기 두 번 실패 뒤 계속 읽기·A→B→C→B→C 알림 둘). 옛 코드에서는 6개가 실패함을 확인. 적대 시험 `tests/adversarial/bnd1` 20개 통과(TD-BND1-001~003 포함).

### 화면·spec-keeper에게 (RA-BND1-02 화면 몫)
- 지적의 화면 제안("READING이어도 lastReadAt이 60초 넘게 지났으면 '밴드 댓글이 들어오지 않아요.'")은 AC-BND1-73 "`READING`이고 확인하지 않은 알림이 없으면 밴드 줄은 없다"와 부딪혀 하지 않았다(dev-web 영역이기도 함). 서버는 이제 DB가 돌아오면 바로 RETRYING/READING을 다시 쓰므로 '읽고 있어요'인 채 멈추는 일은 없다 — DB가 계속 안 되면 상태도 못 쓴다. READING인데 오래 못 읽은 경우를 띠에 올릴지는 spec-keeper 결정 후보.

## dev-server (BND1 감사 2회차 수정) — RA-BND1-03·04 · TD-BND1-001·002 · D-BND1-16~19
- **RA-BND1-03 (D-BND1-16)**: `fastPages: 5`를 없앴다. 빠른 읽기 상한 = 전체 읽기와 같음(1,000개를 넘으면 멈춤·쪽 수 ⌈1000÷쪽 크기⌉+10·고리). 본 댓글이 있는 쪽이나 마지막 쪽에 **닿았을 때만** 기록한다. 못 닿으면 기록 0·로그 `BAND_FAST_UNREACHED`, 같은 차례에 전체 읽기(그 차례를 60초 차례로 셈). 전체 읽기가 끝까지 되지 않으면(1,000개 넘음뿐 아니라 쪽 수 상한·고리도) 같은 차례에 빠른 읽기 한 번 더 — 그마저 못 닿으면 막다른 경우: 기록 0, 알림 종류 `STUCK` "밴드 댓글이 너무 많이 한꺼번에 달려 차례대로 읽지 못하고 있어요. 밴드 글에서 직접 확인해 주세요."를 같은 알림 목록에 한 번(로그 `BAND_STUCK`), 다음 차례에 다시 읽는다.
  - 한 번만: 마지막으로 닿은 읽기(`lastReadAt`) 뒤에 `STUCK` 알림이 이미 있으면 다시 쌓지 않는다(서버를 다시 켜도 같다 — 마이그레이션 없음, `kind`는 글자 칸).
  - **바뀐 뜻**: 연결의 `lastReadAt`(마지막으로 읽은 시각)은 이제 **닿은 읽기가 있던 차례에만** 바뀐다(막다른 경우·닿지 못한 차례는 그대로). 늦게 읽음 알림(AC-BND1-54)은 차례마다 한 번, 그 차례에 기록한 수를 모두 더해 낸다(전체 1,000개 + 빠른 1개가 알림 둘이 되지 않게).
- **TD-BND1-002**: 쪽 수 상한은 빠른·전체 읽기 모두. 막다른 경우의 비용: 끝나지 않는 쪽 넘기기가 이어지면 차례마다 빠른 60 + 전체 60 + 빠른 60 = 180번 요청(10초마다). D-BND1-16대로이고 호출 한도 위험은 RA-BND1-05(범위 밖, HG-BND1 11 뒤)에 남긴다.
- **TD-BND1-001 (D-BND1-18)**: `EDITED_KEEP = 200` 자르기를 없앴다 — 처음 글(`text_hash`)과 알린 고친 글 해시(`edited_hash`)를 모두 기억한다.
- **RA-BND1-04**: (1) 읽기 차례를 시작할 때 회차 표에 끝 시각이 있으면 바로 `FINISHED`(ENDED, "방송을 끝내서 밴드 댓글을 그만 받았어요.") (2) 기록이 거절됐는데 연결이 그대로(끊기·유튜브가 아님)면 엔진의 회차 끝으로 보고 바로 `FINISHED`(ENDED)·로그 `BAND_ENDED_STOPPED` — 간격 0으로 다시 읽는 고리가 없다.
- **D-BND1-19**: 잇기 중 일시 실패(HTTP 5xx·연결 실패·모양 틀림·호출 한도 `1001`~`1003`·끝까지 되지 않은 기준선 읽기)는 모두 503 `UNAVAILABLE` "밴드 글을 읽지 못해 잇지 못했어요. 잠시 뒤 다시 눌러 주세요."(AC-BND1-22 "RETRYING으로 나뉘는 일시 실패(… 호출 한도)" — 그래서 잇기의 `RATE_LIMITED`도 이 문장으로 바뀜). 밴드·글 목록의 실패 문장은 그대로.
- 바꾼 서버 시험(새 스펙대로 더 정확히): `band-reading.test.ts` 130개(빠른 한 번에 130개·7쪽·`seq` = 작성 시각 순·전체 읽기 새 기록 0), 잇기 실패 문장, 고리 시험(빠른 2 → 전체 2 → 빠른 2 순서·기록 0), `band-overlap.test.ts` 쪽 수 상한(읽기마다 60쪽·`STUCK` 하나·풀리면 이어 읽음), 1등 단언(`band-flow.test.ts` "1번이요" → `winners` = `band:UKEY_A`, "1번 2개요"는 언급만 / `band-reading.test.ts` `winners` = [A, B]).
- 새 서버 시험: AC-BND1-30 1,001개 한 번에(빠른 51쪽 → 전체 51쪽 → 빠른 1쪽, 1,001개 작성 시각 순) · 막다른 경우(990+20에 1,001개 → chat 0·알림 1이 세 차례 그대로·`lastReadAt` 그대로) · AC-BND1-31 1,000개는 끝까지 된 읽기(지움 알림 1, 전체 50쪽) / 1,001개는 아님(지움 0, 51쪽) · AC-BND1-23 끝난 회차 연결(그 뒤 요청 0·타이머 남지 않음) · AC-BND1-40 A→B→C→B→A 알림 2개 · 300번 고친 뒤 돌아가도 300 · AC-BND1-52 5xx 10·20·40·80·160초 사이 150개 → chat 150 작성 시각 순·늦게 읽음 N=150.

### 화면에게 (dev-web)
- 알림 `kind`에 `'STUCK'`이 더해졌다(`BandNoticeView.kind`). 문장은 서버의 `message` 그대로 쓰면 된다. `apps/web/src/api/types.ts`의 `'DELETED' | 'EDITED' | 'LATE'`에 더해 주세요.
- 알림 띠는 D-BND1-17대로 `notices.unseen`(종류 상관없이)을 쓴다. `unseenEdits`는 E2E(`tests/e2e/bnd1/attacks.spec.ts`)가 아직 읽어서 남겨 두었다.

### 테스트에게
- E2E: 잇기 일시 실패 문장이 바뀌었다(위 D-BND1-19). 막다른 경우 알림은 띠의 N에 들어간다(D-BND1-17).
- 적대 `tests/adversarial/bnd1` 20개 녹색(TD-BND1-001~003 포함).

## dev-server (BND1 감사 3회차 수정) — RA-BND1-09·05·08·07 · D-BND1-22~24
- RA-BND1-09 (D-BND1-22): `platform-record.ts`의 거절 결과에 거절 코드(`{ kind: 'rejected', code }` — writer·엔진 코드, 범위 없음은 `NOT_FOUND`). `service.ts #ingest`는 연결 상태가 바뀌었으면 다음 차례에 멈추고, `BROADCAST_ENDED`·`SEALED`이거나 회차 표에 끝난 시각이 있을 때만 `FINISHED`(회차 끝). 그 밖은 본 댓글 표에 적지 않고 `#retryLater`(RETRYING·10·20·40·80·160·300초), 로그 `BAND_RECORD_REJECTED` + `reason`=거절 코드만.
- RA-BND1-05 (D-BND1-23): (가) 닿는 읽기가 없던 차례 뒤 다음 차례는 `timing.stuckMs`(60초), 닿으면 10초로. (나) `BandClient` `onRateSignal` — 1002·1003은 그 판매자, 1001은 모든 판매자, 받은 때부터 `timing.rateFullPauseMs`(600초) 동안 `#cycle`이 전체 읽기를 하지 않는다(빠른 읽기가 닿지 못하면 기록 0 → 막다른 경우). 이미 쉬는 중이라 보내지 않은 요청(PAUSED)은 신호로 치지 않는다.
- RA-BND1-08 (D-BND1-24): `#publishLink(…, onlyIfChanged)` — 차례 끝(`#endCycle`)만 `bandLinkSignature`(시각 칸·쉬는 남은 초를 뺀 보기)가 앞서 보낸 것과 같으면 보내지 않는다. 다른 알림(조작·다시 시도·상태 바뀜)은 늘 보내고 그 값도 기억한다. 기억은 메모리라 서버를 다시 켠 뒤 첫 차례는 보낸다. 잇기 때 이미 마지막으로 읽은 때를 적으므로(기준선 읽기) 화면의 "…에 읽었어요"는 잇기 응답부터 보인다.
- RA-BND1-07: `comment.ts` 머리 주석의 'reader.ts' → 'service.ts BandService #ingest'. `sanitizeNick` 옮기기는 그대로 맥북 쪽.
- 시험용 고리 `hooks.record`(기록 가로채기 — 회차 끝이 아닌 거절 주입). 새 시험 `apps/server/test/band-pace.test.ts` 11개.
- 바꾼 기존 시험(새 스펙대로 더 정확히): `band-reading.test.ts` 막다른 경우 세 차례·쪽 넘기기 고리, `band-overlap.test.ts` 끝나지 않는 쪽 넘기기 — 막다른 경우 뒤 "10초 뒤 다음 차례"를 "59초 동안 요청 0·60초에 다음 차례(전체 → 빠른)"로. 회복 차례가 4분 뒤가 되어 늦게 읽음 알림(AC-BND1-54)이 하나 더 생기는 것을 글자 그대로 단언.

### 테스트에게
- test-domain: `tests/adversarial/bnd1/fast-read-attacks.test.ts:131` "빈 쪽과 늘 새 after … 세 차례 뒤에도"가 막다른 경우 뒤 10초 차례를 가정해 실패한다(`used` 0). D-BND1-23 (가)대로 둘째 차례부터 60초로 바꿔야 한다.
- test-e2e: D-BND1-24로 READING 동안 조용한 차례는 연결 알림을 보내지 않는다 — 밴드 칸의 "HH:MM:SS에 읽었어요"는 새 댓글·상태 바뀜·새로 고침 때만 바뀐다. 이 문장이 10초마다 바뀐다고 기대하는 E2E가 있으면 새 스펙과 어긋난다.
