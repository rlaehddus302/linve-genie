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
