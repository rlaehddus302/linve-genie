# X1 dev-notes

## dev-server > 확장(device)·화면(web)·E2E에게 — 계약

서버 코드: `apps/server/src/extension/{service,routes,store}.ts`, 시험: `apps/server/test/x1-extension.test.ts`.

### 판매자 화면 경로 (세션 쿠키, 보조자 403, 상태 바꾸기는 Origin·JSON 검사 그대로)
- `POST /api/extension/code` `{}` → `{ code: "12345678", expiresAt }` (10분, 한 번만. 새 코드를 받으면 앞 코드는 못 씀)
- `POST /api/extension/renew` `{}` → 지금 토큰을 바로 끊고 `{ code, expiresAt }` ("다시 만들기")
- `POST /api/extension/disconnect` `{}` → `{ extension: View }` ("끊기")
- `GET /api/extension` → `{ extension: View }`
- 실시간: SSE `event: extension`, data = View (상태가 바뀔 때만 — 30초 상태 없음·1분 읽지 못함은 서버가 스스로 알린다)
- View: `{ connected, connectedAt, lastUsedAt, state: NONE|RECEIVING|STALE|HIDDEN|UNREADABLE, message, manual, broadcasts: [회차 ID], statusAt, lastChatAt, dropped }`
  - message: "확장으로 받는 중" / "확장에서 채팅이 오지 않아요" / "유튜브 채팅 창을 앞으로 꺼내 두세요" / "유튜브 화면이 바뀌어 채팅을 읽지 못해요"
  - manual: 경고 상태면 "주문은 손으로 넣어 주세요", 아니면 null. state 값(영어)은 화면에 보이지 말 것 — message를 쓴다.
  - 콘솔 문구(AC8)의 "공식 연결로 받는 중 / 확장으로 받는 중 / 둘 다로": 공식은 기존 `GET /api/broadcasts/:b/youtube`의 collector, 확장은 `state === RECEIVING && broadcasts.includes(b)`로 화면이 고른다.

### 확장 경로 `/ext/**` (쿠키·Origin 안 봄, `Authorization: Bearer <토큰>`, JSON 객체·64KB, 모르는 필드 400, no-store)
- `POST /ext/connect` `{ code }` → `{ token }` (토큰 없이. 틀리면 400 EXT_CODE_INVALID, 주소마다 10분 20번 넘으면 429 EXT_CODE_LIMITED). 공백·`-`는 빼고 본다
- `GET /ext/broadcasts?v=<영상 ID 11자>` → `{ bound: {id,date,title}|null, broadcasts: [{id,date,title}] }` (bound는 YT-02로 이어진 회차면 자동으로 잇고 돌려줌. broadcasts = 오늘(KST) 끝나지 않은 실제 회차)
- `POST /ext/bind` `{ v, broadcast }` → `{ broadcast }` / 409 EXT_BIND_REJECTED `{ reason: OTHER_VIDEO|VIDEO_TAKEN|NOT_OPEN, error.message }` / 404
- `POST /ext/chats` `{ v, messages: [{ id, ch, nick, text, at }] }` (50개까지, at = 게시 시각 UTC 밀리초 정수) → `{ recorded, skipped, broadcast }`
  - 409 EXT_NOT_BOUND(회차를 골라야 함 — 기록 0), 409 EXT_ENDED(끝낸 뒤 10분 지남 — 그 묶음은 버려도 됨), 500 SAVE_FAILED(다시 보내기), 429 EXT_RATE_LIMITED(`Retry-After` 초 뒤 다시)
  - 다시 보내도 안전(같은 메시지 ID는 한 번만). id는 `[A-Za-z0-9_\-.%=+/:]{1,256}`, ch는 `[A-Za-z0-9_-]{1,64}`, nick ≤200자, text ≤2000자(서버가 200자로 자름)
- `POST /ext/status` `{ v?, hidden, read?, unread?, dropped? }` (10초마다. read·unread·dropped는 확장을 켠 뒤 누적 수 — 줄면 새로 켠 것으로 봄) → `{ state, message }`
- 401 EXT_DISCONNECTED("연결이 끊겼어요…") = 끊기·다시 만들기·30일 미사용. 확장은 토큰을 지우고 연결 화면으로.
- 속도: 토큰마다 초당 5요청(모든 /ext), 분당 600메시지(이 서버 프로세스 안에서 셈).

### 서버 결정 (스펙 범위 안에서 고른 것)
- 확장 채팅은 공식 수집기와 같은 `ingestYoutubeBatch` → 같은 `chat` 이벤트·조치자 collector, `events.chat_source = 'extension'`만 다르다. 봉인 대상 표시(youtube_chat)도 같다.
- 다른 경로 중복(D-X1-06)은 두 방향 모두(공식 수집기도 확장 기록을 본다) 범위 락 안에서 본다. 받은 지 30분 안의 기록만 견준다.
- 잇기 전 기준 시각: AUTO = YT-02 이은 시각(예정 방송은 실제 시작 시각), PICK = YT-02 연결이 있으면 그 시각, 없으면 고른 시각.
- 게시 시각이 서버 시각보다 늦으면 서버 시각으로 자른다.
- 복구(D-I2-11): ext_bindings·ext_status는 지우고, ext_codes·ext_tokens는 그대로 둔다. 복구한 채팅의 경로 표시는 기존처럼 youtube로 다시 만든다(판정 영향 없음).
- 알려 둘 한계: 속도 제한 수는 서버 프로세스마다 센다(서버 여러 대면 그 배까지).
