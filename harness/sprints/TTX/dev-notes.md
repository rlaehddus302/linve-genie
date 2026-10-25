# TTX 개발 인계

## dev-server (AC-TTX-11~19·23·30·90 서버 몫)

### 바뀐 것
- 확장 틱톡 경로 `apps/server/src/extension/routes.ts`(`registerTiktokExtRoutes`) — 유튜브 `/ext/chats`·`/ext/status`의 모양은 그대로다.
- 받기·상태·보기 계산 `apps/server/src/tiktok-live/extension.ts`(`TikTokExtension`, 순수 함수 `extensionViewOf`, 문구 상수 `EXT_TIKTOK_ROUTES`·`EXT_TIKTOK_WARNINGS`·`EXT_TIKTOK_MESSAGES`).
- 거르개 `apps/server/src/tiktok/comment.ts`의 `createExtensionCommentFilter` — 직접 연결과 같은 거르개에 `NO_AUTHOR`만 더함(골든 `extension.json` 13사례 통과, `test/tiktok-golden.test.ts` 합계 파일 5·사례 103·확장 항목 32로 고정).
- 마이그레이션 `0020_ttx_tiktok_ext.sql`: `tiktok_links`에 `ext_recorded`·`ext_standby`·`ext_status_at`·`ext_screen`·`ext_hidden`·`ext_read`·`ext_unread`·`ext_unread_since`. (`test/fb1-parcel-settings.test.ts`의 "0019 다시 적용" 시험이 마지막 마이그레이션 하나만 지우던 것을 0019 뒤 전부·0020 칸까지 되돌리게 고침 — 단언은 그대로.)
- 속도 제한: `ExtensionService.admit(tokenId, n, lane)` — `/ext/tiktok/**`는 `tiktok` 줄로 따로 센다(토큰마다 초당 5요청·분당 600댓글). 확장 연결 "끊기"면 틱톡 확장 상태를 비운다(`onDisconnected`).

### 확장(dev-web)에게 — 서버 계약
모든 요청 `Authorization: Bearer <확장 토큰>`(유튜브와 같은 토큰), `Content-Type: application/json`. 401 `EXT_DISCONNECTED` = 끊김(대기열 지우기), 429 `EXT_RATE_LIMITED` + `Retry-After`(초) = 기다렸다 같은 순서로 다시.

1. `GET /ext/tiktok` → `{ tiktokId, mode, code, message, broadcast }`
   - `tiktokId`: 판매자 틱톡 아이디(이어진 연결의 것, 없으면 설정의 것, 소문자) 또는 `null`. 주소 `/@<아이디>/live`의 아이디를 ASCII 소문자로 바꿔 이것과 같을 때만 관찰한다(D-TTX-03). `null`이면 관찰하지 않고 팝업 "…내 틱톡 아이디를 먼저 넣어 주세요."
   - `mode`: `recording`(보내면 기록) · `standby`(직접 연결이 받는 중 — 보내도 기록 안 함) · `blocked`(기록 0, `code`가 까닭).
   - `code`: `null` · `PLATFORM_NOT_READY` · `NO_CONSENT` · `NO_TIKTOK_ID` · `NOT_LINKED`. `message`는 acceptance "화면 문구" 팝업 줄 글자 그대로(`EXT_TIKTOK_MESSAGES`) — 그대로 보여도 된다. 영어 `code`는 화면에 쓰지 않는다.
2. `POST /ext/tiktok/chats { pageId, items }` (본문 256KB까지, 다른 확장 경로는 64KB)
   - `pageId`: 지금 주소의 아이디(받은 그대로 — 서버가 다듬고 소문자로 비교). 다르거나 없으면 **403 `NOT_OWN_LIVE`**.
   - `items`: 1~50개(51개·빈 목록 400 `INVALID_INPUT`). 항목 키는 `commentId`·`userId`·`uniqueId`·`nickname`·`text`(+ 받아도 쓰지 않는 `owner`·`postedAt`)만 — 그 밖의 키는 **400 `UNKNOWN_FIELD`**(묶음 전체). ID는 **10진 문자열**로 보낸다(숫자로 보내면 2^53 넘는 값이 버려짐). 못 읽은 항목은 확장이 보내지 않는 것이 원칙이지만, 보내도 서버가 버리고 `dropped`로 센다.
   - 200 `{ result: 'recorded', recorded, standby: 0, dropped, duplicates, broadcast, message }` 또는 `{ result: 'standby', recorded: 0, standby, dropped, duplicates: 0, broadcast, message }`. **둘 다 성공 — 다시 보내지 않는다.** `duplicates` = 이미 기록된 같은 댓글 ID(다시 보낸 묶음).
   - 409 `NOT_LINKED`·`PLATFORM_NOT_READY`·`NO_CONSENT`: 기록 0, 팝업 줄. 이 묶음은 다시 보내지 않아도 된다(안전 쪽: 버리고 팝업에 알림 — 확장 몫으로 정할 것).
   - 500 `SAVE_FAILED`: 기록 0 — **같은 묶음을 같은 순서로 다시** 보낸다(서버가 같은 ID를 한 번만 기록).
   - 순서: 묶음은 한 번에 하나(앞 응답 뒤 다음). 서버는 받은 순서대로 기록한다(시각 칸 안 씀).
3. `POST /ext/tiktok/status { screen, hidden, read, unread }` (10초마다, 유튜브 `/ext/status`와 따로)
   - `screen`: `OWN`(내 방송 화면) · `OTHER`(남의 방송) · `ELSEWHERE`(그 밖의 틱톡 화면). `hidden`: 탭이 뒤로 감. `read`·`unread`: 그 화면에서 지금까지 읽은 수·읽지 못한 수(누적, 0~10억). 수가 줄면 서버가 새로 센다(확장이 다시 뜸).
   - 응답 = `GET /ext/tiktok`과 같은 모양. 이어진 연결이 없으면 상태는 어디에도 두지 않는다.

### 콘솔(dev-web)에게 — 연결 보기 `GET /api/broadcasts/:b/tiktok`의 `link.extension` (SSE `tiktok` `kind: LINK`도 같은 보기)
`extension`은 연결이 없으면(`state: 'NONE'`) `null`, 있으면 항상 객체:
`{ state, active, route, warning, screen, hidden, statusAt, recorded, standby, unread }`
- `state`: `NONE`(이 회차에 확장 상태가 한 번도 없음 → **받는 길 줄 없이 지금 화면 그대로**) · `RECEIVING` · `STANDBY`(직접 연결 받는 중 + 확장 30초 안) · `STALE`(30초 넘게 상태 없음) · `HIDDEN` · `UNREADABLE`(읽지 못함만 1분) · `ELSEWHERE`(남의 방송·다른 화면).
- `route`: 받는 길 한 줄 글자 그대로 또는 `null` — "서버 연결로 받는 중"(직접 받는 중, 확장 조용함) · "서버 연결로 받는 중 · 확장은 대기 중" · "확장으로 받는 중". 상태가 한 번도 없으면 `null`.
- `warning`: 확장 경고 문장 그대로 또는 `null`. **직접 연결이 받는 중이면 `null`**(확장은 대기라 알리지 않음 — 서버의 정함), 동의 끔·운영자 꺼짐이면 `null`(직접 연결 상태 문장이 까닭을 보인다).
- `active`: "확장으로 받는 중"(직접 연결 받는 중 아님 + 확장 30초 안·내 방송·앞에 있음·읽지 못함 아님 + 운영자 스위치·동의 맞음). **`active`인 동안 붙여넣기 알림 띠(직접 연결 `RETRYING`·`STOPPED`·`missed` 때문)를 띄우지 않는다**(AC-TTX-21). 확인하지 않은 저장 실패(`collection.saveFailed > saveFailedSeen`)는 그대로 띠.
- 조용함(30초)·읽지 못함(1분)이 되는 때 서버가 스스로 SSE를 보낸다(새로고침 없이).
- 화면에는 `route`·`warning` 글자만 쓰고 `state` 같은 영어 값은 보이지 않는다.

### 시험(test-domain·test-e2e)에게
- 서버 단위 시험 `apps/server/test/ttx-tiktok-ext.test.ts`(22개) — 가짜 웹캐스트(`failNext('SIGN_FAILED', n)`·`drop()`)·가짜 시계.
- E2E 서버(`pnpm --filter @livejjim/server e2e`, `tiktok: true`)의 기존 조작 `/_e2e/tiktok/fail`·`/block`·`/comment`(같은 `msgId`를 넣으면 같은 댓글 ID)로 AC-TTX-24~28을 만들 수 있다. 서버 시계는 실제 시계 — 30초 조용함은 실제로 기다린다(X1과 같음).
- 다른 판매자 토큰으로 남의 회차: 토큰이 판매자를 정하므로 자기 연결 회차에만 갈 수 있고, 화면 아이디가 남의 것이면 403.

### 남은 것·사용자 확인
- 실제 틱톡 화면 구조(HG-TTX)는 확인하지 못했다 — 서버는 확장이 보낸 값만 본다.
- 직접 연결이 끊긴 줄 모르고 받는 중으로 보이는 동안(최대 120초)의 확장 댓글은 대기로 버려진다(D-TTX-07 그대로).

## dev-web (AC-TTX-01~10·20~23·31 web 몫)

### 바뀐 것
- 확장(`apps/extension`) — 커밋 `bc32aa1d`
  - `src/tiktok-selectors.ts`: 틱톡 선택자·데이터 이름 한 곳(첫 줄 "가짜 페이지 기준 — 실물 확인 필요(HG-TTX)"). `selectors.ts`(유튜브)는 그대로.
  - `src/tiktok-reader.ts`: 주소 판단(`tiktokPageOf`·`screenOf`, 아이디 ASCII 소문자 비교), 댓글 읽기(`TikTokReader` — 새로 붙은 `.tt-comment`만, 시작 전 것과 그 ID는 보내지 않음, 최근 20,000 ID, 필수 값 못 읽으면 `unread`, 선물·입장·좋아요·시스템은 세지 않음). 시각 칸은 보내지 않는다.
  - `src/tiktok-watch.ts`·`src/tiktok-content.ts`: content script(`https://www.tiktok.com/*`, 맨 위 창만). 1초마다 주소를 보고 내 방송일 때만 관찰, 바뀌면 바로 멈추고 `ttLeave`(워커가 그 탭의 아직 안 보낸 댓글을 버림). 관찰 콜백에서도 주소를 다시 봐서 바뀐 뒤 붙은 댓글은 읽지 않는다. 10초마다·탭 숨김/보임·화면 종류가 바뀔 때 `ttStatus`. **페이지 쪽 스크립트(MAIN)는 없다** — 요소의 글자·속성만 읽는다.
  - `src/tiktok-outbox.ts`·`src/tiktok-hub.ts`: 유튜브와 따로 둔 틱톡 대기열(`storage.session` 키 `ttQueue`, 500개), 한 번에 한 묶음·1초/50개, 429 `Retry-After`·0/5xx 점점 길게 같은 순서로 다시, `recorded`·`standby`는 성공, 401은 모두 비우고 토큰 지움, 403 `NOT_OWN_LIVE`·409 코드·400은 그 묶음을 버림. 탭 여럿이면 가장 나은 탭(내 방송 앞 > 내 방송 뒤 > 남의 방송 > 다른 화면, 25초 넘게 소식 없는 탭은 뺌)의 상태 하나를 `/ext/tiktok/status`로.
  - `src/hub.ts`: 틱톡 메시지(`ttInfo`·`ttChats`·`ttStatus`·`ttLeave`)는 `www.tiktok.com` 탭에서 온 것만 받아 `TikTokLane`으로. 끊기·연결 지우기면 틱톡 대기열도 비움. `HubView.tiktok`(팝업 틱톡 줄) 추가. 유튜브 채팅 창이 없고 틱톡 화면만 있으면 배지·제목은 틱톡 줄로.
  - 매니페스트: `host_permissions` = 유튜브·`https://www.tiktok.com/*`·라이브지니 주소, 틱톡 content script `tiktok-content.js` 하나. 권한은 `storage` 그대로. 빌드 출력에 `tiktok-content.js`.
  - 팝업: `<section aria-label="틱톡">` 안 `#tiktok-state`(role=status, 표 "화면 문구" 글자 그대로), `#tiktok-overflow`(놓친 틱톡 댓글).
  - 시험: `test/tiktok-reader.test.ts`(30), `test/tiktok-hub.test.ts`(27), `test/manifest.node.test.ts`(AC-TTX-01·08·09 소스·매니페스트 검사로 고침). 확장 전체 128개 통과.
- 콘솔(`apps/web`) — 커밋 `a2c78cdc`
  - `TikTokLinkView.extension`(`TikTokExtensionView`) 타입. 틱톡 칸에 `route`를 `<p role="status" aria-label="틱톡 댓글 받는 길">`, `warning`을 `<p class="warning">`으로(서버 글자 그대로, `state`가 `NONE`이거나 칸이 없으면 줄 없음).
  - `tiktokNeedsPaste(collection, extension)`: `extension.active`면 저장 실패만 센다 → 알림 띠·주 단추가 사라지고 "댓글 붙여넣기"는 보조 단추, `missed` 문장은 칸 경고로 남음.
  - 시험: `test/n2b2-platforms.test.tsx`에 TTX 12개(AC-TTX-20·21). 틱톡 관련 웹 시험 파일 5개 114개 통과.

### 정한 것 (확인 필요)
- 409(`NOT_LINKED`·`NO_CONSENT`·`PLATFORM_NOT_READY`) 묶음은 붙들지 않고 버린다 — 나중에 기록하면 늦은 댓글이 순서를 앞지른다. 팝업에 까닭 문장.
- 틱톡 탭이 여럿이면 가장 나은 탭 하나의 상태만 보낸다(다른 화면 탭 때문에 경고가 깜빡이지 않게).
- 팝업에도 탭이 뒤로 가면 "틱톡 방송 화면을 앞으로 꺼내 두세요"를 보인다(표의 콘솔 경고 문장을 그대로 씀).
- 본문은 600자(코드 포인트)까지만 보낸다 — 500자를 넘는 글은 서버가 `TEXT_TOO_LONG`으로 버리게 남기고, 잘라서 다른 글로 만들지 않는다.
- 서버의 정함(직접 연결 받는 중이면 `warning: null`)은 그대로 썼다.

### 시험(test-e2e)에게
- 틱톡이 켜진 E2E 묶음은 `chromium-multi`(제목 `@multi`, `--tiktok yes`)뿐이다. 확장 빌드는 X1의 `tests/e2e/x1/support.ts` 방식 그대로(빌드 출력에 `tiktok-content.js`가 생김).
- 가짜 틱톡 페이지: `https://www.tiktok.com/@seller_kim/live`를 `context.route`로 돌려준다. 이름은 `apps/extension/src/tiktok-selectors.ts`의 것만 쓴다 — 목록 `<div class="tt-comment-list">`, 댓글 `<div class="tt-comment" data-comment-id="<10진>" data-user-id="<10진>" data-unique-id="<아이디>"><span class="tt-nickname">닉</span><span class="tt-text">15</span></div>`를 목록 끝에 붙인다. 확장이 시작하기 전에 있던 댓글은 보내지 않으니 확장이 뜬 뒤(페이지 로드 + 1초쯤) 붙인다. 예시는 `apps/extension/test/fixtures/tiktok-live.html`.
- AC-TTX-25(같은 댓글 ID): 가짜 페이지 `data-comment-id` = `/_e2e/tiktok/comment`의 `msgId`, `data-user-id` = `userId`.
- 주소만 바꾸기(한 화면 앱 흉내)는 같은 출처라 페이지에서 `history.pushState`로 하면 된다(1초 안에 멈춤).
- 확장 판매자 아이디는 서버 `GET /ext/tiktok`의 `tiktokId`(설정의 틱톡 아이디) — 관찰은 그 값과 주소 아이디가 같을 때만. 연결 코드로 확장을 잇기 전에는 관찰하지 않는다.
- 팝업: `chrome-extension://<id>/popup.html`의 `region "틱톡"` 안 `status`. 콘솔: `region "틱톡"` 안 `getByRole('status', { name: '틱톡 댓글 받는 길' })`.
- 틱톡 탭을 닫으면 상태가 끊긴다 → 서버 시계 30초 뒤 "확장에서 틱톡 댓글이 오지 않아요"(실제 시간을 기다려야 함).

### 남은 것·사용자 확인
- 실제 틱톡 화면 구조(HG-TTX): 실제 화면이 댓글 ID·숫자 사용자 ID를 요소 속성으로 주지 않고 React 내부 값에만 둔다면 페이지 쪽 스크립트가 필요할 수 있다. AC-TTX-08은 페이지 쪽 스크립트에서도 `dispatchEvent`를 금하므로 그때는 읽는 방법을 새로 정해야 한다(유튜브 다리는 이벤트로 묻는다).
- 이미 깐 확장은 `www.tiktok.com` 권한 때문에 크롬이 다시 허락을 묻는다(압축 해제 판은 다시 읽기).

## dev-web 수정 라운드 1

### 고친 것
- TD-TTX-001·TE-TTX-001·RA-TTX-01(a): `apps/extension/src/tiktok-outbox.ts` `flush()`가 대기열이 비어 있어도 다시 보내기 기다림(`#waitUntilRetry`)을 먼저 푼다. 기다리는 중 화면을 떠나(dropTab) 대기열이 비어도, 돌아와 붙은 댓글을 `add()`가 다시 예약한다. 기다리는 시간 안에 붙은 댓글은 그 타이머(Retry-After)를 지킨다. 시험: `apps/extension/test/tiktok-hub.test.ts` 2개(429·500·닿지 못함), 적대 `tests/adversarial/ttx` 19개 통과, E2E `TE-TTX-001` 통과.
- U-TTX-01·RA-TTX-02: `extension.active`인 동안 틱톡 칸의 굵은 직접 연결 문장(`collection.message`, 예: "…그동안 댓글을 직접 넣어 주세요.")을 보이지 않는다(`tiktokDirectMessage`, `apps/web/src/lib/platforms.ts`). 받는 길 줄 "확장으로 받는 중"만 남는다. 확장이 조용해지면(active 꺼짐) 다시 보인다. 확장 상태가 없던 회차(NONE)는 지금 화면 그대로. 새 문장은 만들지 않았다.
- U-TTX-02(3): 설정 확장 칸 설명(`EXTENSION_INTRO`)에 틱톡 대비책 한 문장을 더했다("틱톡도 같은 확장으로 받아요 — 틱톡 서버 연결이 막혔을 때 같은 크롬에서 내 틱톡 방송 화면을 열어 두면, 확장이 틱톡 댓글을 대신 읽어 보내요.").

### test-e2e에게 (바뀐 동작)
- `tests/e2e/ttx/extension.spec.ts:158`(AC-TTX-25)은 막힘 직후 `BLOCKED_MESSAGE`가 보이기를 기다린다. 이제 확장이 받는 중이 되면 그 문장을 숨기므로(U-TTX-01·RA-TTX-02) 이 줄이 실패한다(실행해 확인함). 받는 길 줄이 "확장으로 받는 중"이 된 뒤에는 칸에 "직접 넣어 주세요"가 **없어야** 한다는 쪽으로 바꿔 주기 바란다. 91줄(확장 탭을 열기 전 SIGN_FAILED 문장)은 그대로 보인다.

### spec-keeper에게 (문구 표에 줄이 필요함 — 만들지 않음)
- U-TTX-01·RA-TTX-02: 확장으로 받는 중 + 직접 연결 다시 시도·멈춤일 때 틱톡 칸에 직접 연결 문장 대신 보일 문장(예: "서버 연결은 다시 시도하는 중이에요. 그동안은 확장으로 받고 있어요."). 지금은 숨기기만 했다.
- U-TTX-02(1): 직접 연결이 다시 시도 중·멈춤이고 확장 상태가 없던 회차(NONE)에 "크롬에서 내 틱톡 방송 화면을 열면 확장이 대신 받아요" 한 줄 — AC-TTX-20 "확장 상태가 한 번도 없던 회차는 지금 화면 그대로"와 부딪혀 만들지 않았다. 웹은 판매자가 확장을 이었는지(연결 여부)를 틱톡 보기에서 알지 못하므로, 넣는다면 조건도 정해야 한다.
- U-TTX-02(2): 연결 직후 팝업 틱톡 줄 — 지금은 틱톡 화면을 본 적 없으면 줄이 없다. 무조건 "내 틱톡 방송 화면을 열면 댓글을 보내요."를 보이면 유튜브만 쓰는 판매자도 보게 된다(틱톡 아이디를 알려면 연결 직후 `/ext/tiktok`을 한 번 물어야 함). 조건을 정해 주면 만든다.
- RA-TTX-01(b)(c): 확장 상태에 마지막 보내기 성공 시각·실패 중·버린 수·대기열 크기를 싣고 서버 active 조건에 넣기, 확장 저장 실패(`TTX_SAVE_FAILED`)·넘침·dropTab으로 버린 수를 콘솔 알림으로 올리기 — 새 화면 문구와 서버(dev-server) 변경이 필요하다. (a)만 고쳤다.

## dev-server 수정 라운드 2 (D-TTX-16·17·18, RA-TTX-03·06)

### 바뀐 것
- `POST /ext/tiktok/status`에 `dropped`(생략하면 0)를 받는다. 0~10,000 정수가 아니면 400 `INVALID_INPUT`(`null`·글자·소수·음수·10,001 포함). 이때 수도 상태도 바꾸지 않는다.
- 그 판매자의 이어진(LINKED) 연결이 있으면 `saveFailed`에 더한다(`addTiktokExtDropped`, 판매자·연결·LINKED 조건). 이어진 연결이 없으면 어디에도 더하지 않는다. 더하면 extension 칸이 그대로여도 연결 보기를 실시간으로 알린다(SSE `tiktok` LINK). 로그 `TTX_EXT_DROPPED`에는 수만 남긴다. `TTX_SAVE_FAILED`(500)·429는 지금처럼 세지 않는다.
- 연결 보기 `link.extension.hint`(글 또는 `null`): "PC 크롬에서 내 틱톡 방송 화면을 열어 두면 확장이 댓글을 대신 받아요." 아래가 모두 맞을 때만 보인다.
  - 끊지 않은 확장 토큰이 있음
  - 직접 연결이 `RETRYING`(사유 `BLOCKED`·`SIGN_FAILED`) 또는 `STOPPED`
  - 이 회차 확장 상태 `NONE`
  - 확장 토큰이 생기거나 끊기거나 다시 만들어지면 연결 보기를 다시 알린다.
- `EXT_TIKTOK_WARNINGS`의 STALE·UNREADABLE를 D-TTX-18 문장으로 바꿨다.
- RA-TTX-03: 서버가 켜질 때 `tiktokExtension.resume()`가 확장 상태가 있는 이어진 연결마다 "조용함"·"읽지 못함" 예약을 다시 건다.
- RA-TTX-06: 같은 판매자의 연결 보기 계산을 한 번에 하나로 모은다. 계산 중에 들어온 요청은 끝난 뒤 한 번만 다시 계산한다. 조건 조회(`#conditions`)는 그대로 둔다.

### 확장(dev-web)에게
- 상태 본문에 `dropped`를 실어 보낸다. 200을 받으면 보낸 만큼 뺀다. 400이면 서버가 받지 않은 것이다. 상한 10,000을 넘으면 나눠 보낸다.
- `GET /ext/tiktok`의 `tiktokId`는 지금도 준다. D-TTX-17 팝업 줄은 이 값으로 정한다.

### 콘솔(dev-web)에게
- `link.extension.hint`는 글자 그대로, 경고 모양이 아니게 보인다.
- `apps/web/test/n2b2-platforms.test.tsx:643-645`의 경고 문장 픽스처는 옛 문장이다(웹 몫).

### 시험에게
- 서버 단위 시험: `apps/server/test/ttx-fix2-dropped-hint.test.ts`(12개).
- E2E `tests/e2e/ttx/support.ts:20-22`의 STALE·UNREADABLE 문장이 옛 글자다. D-TTX-18 문장으로 바꿔야 한다(test-e2e 몫).

## dev-web 수정 라운드 2 (D-TTX-16·17, U-TTX-04·05)

### 바뀐 것 — 확장
- D-TTX-16·AC-TTX-32: `TikTokOutbox`가 서버에 아직 알리지 않은 버린 수(`unreported`)를 따로 센다. 대상은 대기열 넘침(`#trim`)과 내 방송 화면을 떠나 버린 아직 보내지 않은 댓글(`dropTab`, `ttLeave`)뿐이다. 409로 버린 묶음·`standby`·다시 보내는 중(429·5xx·닿지 못함)은 세지 않는다. "끊기"(연결 지우기)·401이면 0으로 되돌린다.
  - 틱톡 상태(`POST /ext/tiktok/status`)에 늘 `dropped`를 싣는다(없으면 0). `takeDropped()`로 떼어 두고 200이면 뺀 채로, 다른 답이면 되돌려 다음 상태에 더한다. 두 상태가 동시에 가도 같은 수를 두 번 싣지 않는다. 한 번에 10,000까지만 싣고 나머지는 다음 상태에 싣는다.
  - 세션 저장소 `ttQueue.unreported`에 둔다(알리는 중인 수 포함). 워커가 다시 떠도 잃지 않는다. 대신 서버가 받은 직후 워커가 멈추면 한 번 더 셀 수 있다(잃는 쪽보다 안전).
  - 팝업의 "놓친 틱톡 댓글이 있어요"(`dropped`, 켠 뒤 누적·넘침만)는 그대로다.
- D-TTX-17·AC-TTX-33(2): 연결 코드로 이은 직후 `GET /ext/tiktok`을 한 번 묻는다(`TikTokLane.afterConnect`). `tiktokId`가 있으면 틱톡 화면을 본 적 없어도 틱톡 줄 "내 틱톡 방송 화면을 열면 댓글을 보내요."(흐린 줄)를 보인다. 아이디가 없거나 묻지 못하면 줄이 없다. 워커가 다시 뜬 뒤(연결 직후가 아님)는 지금처럼 틱톡 화면을 볼 때까지 줄이 없다.
- U-TTX-05: 유튜브 채팅 창 없이 틱톡 줄만 있으면 팝업에서 틱톡 칸을 맨 위(유튜브 상태 줄 앞)로 옮긴다. 유튜브 문장은 바꾸지 않았다.

### 바뀐 것 — 콘솔
- D-TTX-17·AC-TTX-33(1): 틱톡 칸에 `link.extension.hint`를 글자 그대로 `<p class="tiktok-hint">`로 보인다(경고 모양·role 없음). 확장 상태가 `NONE`이어도 보인다(AC-TTX-20 예외). 서버가 `null`로 주거나 칸이 없으면 줄이 없다.
- AC-TTX-33(3): 설정 확장 칸 설명의 틱톡 문장을 표 글자로 바꿨다(`EXTENSION_TIKTOK_LINE`, "서버" 낱말 없음).
- U-TTX-04: 틱톡 칸 단추를 늘 붙여넣기 → 다시 연결 → 끊기 순서로 둔다. 붙여넣기가 필요할 때만 파란 주 단추로 바뀐다. "끊기"는 지금처럼 확인 창을 거친다.
- 단위 시험의 확장 경고 픽스처를 D-TTX-18 문장으로 바꿨다.

### 시험(test-e2e)에게
- 이번 웹 변경 뒤 `tests/e2e/ttx`를 돌리면 14개 중 2개가 실패한다. 둘 다 이미 시험 몫으로 정해진 것이다.
  - `extension.spec.ts:158`: SA-TTX-02(D-TTX-15)
  - `extension.spec.ts:259`: `support.ts`의 STALE 옛 문장(D-TTX-18, AC-TTX-27)
  - `tests/e2e/x1` 14개는 통과했다.
- AC-TTX-33(1) 콘솔: `region "틱톡"` 안 `getByText('PC 크롬에서 내 틱톡 방송 화면을 열어 두면 확장이 댓글을 대신 받아요.', { exact: true })`. 클래스는 `tiktok-hint`이고 `warning`이 아니다. 확장 연결 코드로 이은 뒤 확장 탭을 열지 않은 채 직접 연결을 막으면 된다.
- AC-TTX-33(2) 팝업: 판매자에게 틱톡 아이디가 있으면 연결 직후 `region "틱톡"` 안 `status`가 "내 틱톡 방송 화면을 열면 댓글을 보내요."이다. 이때 유튜브 채팅 창이 없으면 틱톡 칸이 팝업 맨 위에 온다. 그래서 `popup.getByRole('status').first()`는 틱톡 줄이 된다. 유튜브 상태는 `#state`로 잡는다.
- AC-TTX-32 넘침 흉내: 가짜 틱톡 화면에 댓글을 빠르게 붙여 넘치게 하기는 어렵다(500개). 서버 `/ext/tiktok/chats`를 `context.route`로 잠시 500으로 막고 501개 넘게 붙이거나, 붙인 뒤 `history.pushState`로 내 방송 주소를 벗어나면 된다. 그러면 다음 상태(화면이 바뀌면 바로 감)에 `dropped`가 실린다.
