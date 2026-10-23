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

## dev-web > 확장(apps/extension)·화면 — 무엇을 어떻게

이번 X1은 dev-web이 확장(원래 제안 영역 device)과 화면을 함께 만들었다(오케스트레이터 지시, 커밋 접두어 `[dev:web]`).

### 확장 `apps/extension` (MV3)
- 빌드: `pnpm --filter @livejjim/extension build` → `apps/extension/dist/` (크롬 "압축해제된 확장 프로그램 로드"). 라이브지니 주소는 `LIVEGENIE_ORIGIN`(기본 `http://localhost:5173`) — 매니페스트 host 권한과 서버 부르는 주소 둘 다. 운영 주소는 https만. 출력 폴더는 `LIVEGENIE_EXT_OUT`로 바꿀 수 있다(E2E용).
- 권한: `storage` 하나 + host `https://www.youtube.com/*`·라이브지니 주소. content script는 `https://www.youtube.com/live_chat*`(all_frames), `live_chat_replay*`는 뺌.
- 유튜브 DOM 선택자는 `src/selectors.ts` 한 곳. 일반 채팅 = `yt-live-chat-text-message-renderer`(id 속성 = 메시지 ID).
- 채널 ID·게시 시각: 페이지 쪽 스크립트(`page.js`, world MAIN)가 요청 이벤트 `livegenie-read`를 받을 때만 요소 `data.authorExternalChannelId`·`data.timestampUsec`를 속성으로 잠깐 붙이고, content script가 읽은 뒤 지운다(D-X1-03).
- 보내기: 서비스 워커 `Outbox` — 1초/50개 묶음, 500개 붙들기(넘으면 오래된 것 버리고 `dropped`), 429 Retry-After, 네트워크·500 1→2→4…30초 다시, 401 토큰 지우고 멈춤, 409 NOT_BOUND·ENDED는 그 묶음 버림.
- 상태: content script가 10초마다·탭 숨김/보임 때 `{v, hidden, read, unread}` → 서비스 워커가 `dropped`를 붙여 `/ext/status`. 배지 ON(초록)/!(주황: 숨은 탭·회차 고르기)/!(빨강: 끊김·읽지 못함·오지 않음).
- 팝업: 코드 넣기(공백·`-` 허용) · 상태 한 줄 · 회차가 안 이어졌으면 목록에서 고르기 · "이 컴퓨터에서 연결 지우기".
- E2E(test-e2e) 손잡이: 가짜 채팅 페이지는 `context.route('https://www.youtube.com/live_chat*', …)`로 내고, 메시지 요소에 `el.id = 메시지 ID`, `el.data = { authorExternalChannelId, timestampUsec }`를 붙여 `#items`에 append하면 실제 크롬에서 읽힌다(이 방식으로 수동 확인함 — 이전 메시지·슈퍼챗·다시 보기 페이지는 안 읽힘). 확장은 `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=<dist>', '--load-extension=<dist>'] })`. 팝업은 `chrome-extension://<id>/popup.html`(id는 서비스 워커 URL에서).

### 화면 `apps/web`
- 설정 "크롬 확장으로 채팅 받기" 칸(판매자만, `/settings/extension`): "확장 연결" → 코드 `1234 5678` + "(오후 h:mm까지)", 시간이 지나면 "코드 시간이 지났어요" + "새 코드 받기". 연결되면(SSE `extension`) 코드를 내리고 "확장이 연결됐어요." · "다시 만들기"(묻고 새 코드) · "끊기"(묻고 끊음).
- 콘솔: 고정 영역 경고(role=alert) "! {message} — 주문은 손으로 넣어 주세요" + 링크 "손으로 넣기"(→ /sms) — 이 방송에 이어진 확장이 경고 상태일 때만. 유튜브 칸 제목 아래 그룹 "채팅 받는 길": "● 공식 연결로 받는 중 / 확장으로 받는 중 / 공식 연결·확장 둘 다로 받는 중"(공식 = 수집 상태 LIVE).
- Vite 개발·미리 보기 서버가 `/ext/`도 서버로 넘긴다(확장은 화면 주소 하나만 안다).
