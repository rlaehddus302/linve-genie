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
