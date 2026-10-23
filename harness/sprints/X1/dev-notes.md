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

## dev-server > 감사 채팅 올리기(AC11~AC17, D-X1-17~24) — 확장(device)·화면(web)·E2E에게 계약

서버 코드: `apps/server/src/extension/thanks.ts`(맡김·가져가기·결과·멈춤), 발송함 쪽 `src/youtube/outbox-store.ts`(확장 행 함수), `src/youtube/outbox.ts`(공식 실행기가 맡기는 곳 `#gate`), 표 `drizzle/0017_x1_ext_thanks.sql`. 시험: `apps/server/test/x1-ext-thanks.test.ts`.

### 흐름
1. 감사 효과 → 공식 실행기(기존)가 처음 볼 때 동의(YT-04)·묶음 창을 그대로 본다.
2. 보낼 때 공식으로 올릴 수 없으면(유튜브 연결이 살아 있지 않음·게시 권한 없음·YT-02로 이은 방송 없음) **그리고** 스위치 켬·확장 토큰 살아 있음·그 회차에 확장이 이어짐·그 회차 멈춤 아님 → 스위치를 켠 뒤 생긴 자동 감사만 `via = EXTENSION`, 상태 WAITING(이유 EXTENSION, 화면 문장 "크롬 확장으로 올리려고 기다리는 중이에요.")로 맡긴다. 공식으로 올릴 수 있으면 확장에는 0건.
3. 맡긴 행은 공식 실행기가 보내기·확인 어디서도 집지 않는다. 맡은 뒤 공식 연결이 생겨도 공식이 올리지 않는다. 확인 필요·기한 지남이어도 저절로 다른 경로로 가지 않는다(판매자가 YT-06 "다시 보내기"를 누르면 그때만 공식 경로로 — `via`를 지움).

### 확장 경로 (토큰, 기존 `/ext` 규칙 그대로 — 초당 5요청에 함께 셈)
- `POST /ext/thanks/take` `{ v, me, owner }` — me = 채팅 화면에 로그인한 계정 채널 ID, owner = 방송 채널 ID(못 읽으면 null 또는 빼기). 응답 `{ state, post, afterMs, message }`:
  - `POST` + `post: { ids:[발송함 ID…], text, until }` — 이 글을 **글자로만**(textContent/insertText, HTML 아님) 넣고 보낸다. 글은 서버가 YT-07 묶음으로 만든 것(200자 이하, 닉네임 정리됨). 확장은 고치지 않는다. until(=가져간 뒤 60초)까지 결과를 알려야 한다 — 넘으면 서버가 확인 필요로 끝낸다.
  - `NONE` + afterMs — 지금 줄 글 없음(결과 기다리는 글이 있음·앞 글 결과 뒤 3초 안·기다리는 감사 없음). afterMs 뒤 다시 물어도 된다.
  - `OFF`(스위치 꺼짐) · `NOT_BOUND`(회차 안 이음) · `NOT_OWNER`(message "방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요" — 팝업에도) · `PAUSED`(message "확장으로 감사 글을 올리지 못하고 있어요").
  - 주인 확인: me = owner 이고, 그 회차의 채널(YT-02로 이은 채널, 없으면 판매자 유튜브 연결 채널)과도 같아야 POST. 하나라도 null이면 NOT_OWNER.
  - **가져가기는 넣을 준비가 됐을 때만** 부른다: 입력칸이 있고 비었고 마지막 키 입력 뒤 5초가 지났을 때(D-X1-22). 가져간 뒤 판매자가 쓰기 시작해 넣지 못하면 `NOT_POSTED`로 돌려준다(60초 넘기면 확인 필요가 된다).
- `POST /ext/thanks/result` `{ ids, result }` — ids는 take가 준 그대로 모두, result:
  - `POSTED` — 보낸 뒤 15초 안에 자기 채널 ID의 같은 글이 목록에 뜬 것을 봤을 때만. 묶인 모든 행이 게시됨, 게시 보고는 공식 실행기가 1초 안에 한 번 기록.
  - `UNCONFIRMED` — 15초 안에 못 봄. 다시 올리지 않는다.
  - `NOT_POSTED` — 입력칸에 넣기 전에 멈춤(쓰는 중·주인 아님). 다시 맡을 수 있게 돌아간다.
  - 응답 `{ rows: [{ id, state }] }`. 같은 결과를 두 번 보내도 한 번만 반영(이미 바뀐 행은 그대로). 다른 판매자·확장에 맡기지 않은 ID가 섞이면 404.
- 연달아 3번 확인 필요(60초 무응답 포함) → 그 회차 멈춤(take가 PAUSED). 게시됨이 끼면 셈을 처음부터. 안 올림은 실패로 세지 않는다.
- 확장이 읽어 `/ext/chats`로 보낸 채팅 중 판매자 채널(YT-02 채널·확인한 주인 채널·연결 채널)이 올린 우리 감사 글(10분 안에 보내려 한 글과 같음)은 채팅으로 기록하지 않는다 — 공식 수집기(AC-Y1-26)와 같다. 그래서 확장은 자기 글을 그대로 `/ext/chats`에 보내도 된다.

### 판매자 화면 (세션, 판매자만 — 보조자 403)
- `POST /api/extension/thanks` `{ enabled: true, agreed: true }` 켜기("켤게요" 뒤에만 — agreed 없으면 400) / `{ enabled: false }` 끄기(확장에 맡겨 기다리던 감사 → 보내지 못함 EXT_OFF "확장으로 감사 올리기를 꺼서 보내지 않았어요."). 응답 `{ extension: View }`.
- `POST /api/extension/thanks/resume` `{ broadcast }` "다시 켜기" → `{ extension: View }`.
- View(`GET /api/extension`, SSE `event: extension`)에 `thanks: { enabled, enabledAt, warnings: [{ broadcast, kind: PAUSED|OWNER, message }] }`가 더해졌다. 콘솔 고정 영역은 그 방송의 warnings를 보이고 PAUSED면 "다시 켜기" 버튼. kind는 화면에 보이지 말 것 — message를 쓴다.
- 발송함 목록 행에 `viaExtension`(확장에 맡긴 행) 필드가 더해졌다. 상태·이유 문장은 기존 reasonMessage 그대로.

### 서버 결정(스펙 범위 안)
- 주인 확인의 "방송 채널"은 YT-02 이은 채널이 없으면 판매자의 유튜브 연결 채널로 본다(애매하면 안 올림, D-X1-20 방향. 동의가 유튜브 연결에 있어 연결 없는 판매자는 어차피 맡김이 없다).
- 글 사이 3초는 서버도 지킨다: 앞 글의 결과(게시됨·확인 필요) 뒤 3초가 지나야 다음 글을 주고, 결과를 기다리는 글이 있으면 주지 않는다(한 번에 하나).
- 가져갈 때 다시 본다: 10분 기한(EXPIRED), YT-04 동의 시각, 스위치 켠 시각, 채팅 끝남, 지금 엔진 상태(확정 풀림 → 건너뜀 CANCELLED, 이미 완료 → 게시됨).
- 늦게 온 POSTED(이미 확인 필요가 된 뒤)는 반영하지 않는다 — 판매자가 YT-06 "유튜브에 올라가 있어요"로 적는다.
- 같은 판매자·회차의 가져가기·결과는 서버 프로세스 안에서 하나씩 한다. 서버 여러 대면 드물게 3초 간격이 겹칠 수 있다(이중 게시는 아님 — 행 상태를 한 문장으로 바꾼다).
- 복구(D-I2-11): `ext_post_lanes`(회차별 상태)는 지우고 `ext_post_settings`(스위치)는 둔다.
- AC-X1-25: 다른 경로 보조 중복 규칙에 서버 도착 시각 차 10초 이하를 더했다(`SAME_CHAT_ARRIVAL_MS`, D-X1-28).
- 기존 시험 기대 갱신(약화 아님): `test/commands.test.ts` 표 수 60→66(X1 표 6개), `test/instagram-dm.test.ts` 발송함 열에 `via`, `test/youtube-outbox.test.ts` 목록 행에 `viaExtension: false`.

## dev-web > 감사 채팅 올리기 — 확장(apps/extension)·화면(apps/web) (AC-X1-21~34)

### 확장
- `src/poster.ts`(content script): 서버 글만 넣는다. 입력 칸(`selectors.ts` `INPUT_FIELD`)이 비었고 마지막 키 입력(keydown·input·조합·붙여넣기) 뒤 5초가 지났을 때만 `/ext/thanks/take`. 받은 뒤 다시 보고 쓰는 중이면 넣지 않고 `NOT_POSTED`. 넣기는 `execCommand('insertText')`(안 되면 textContent + input 이벤트, 둘 다 글자만), 보내기 단추(`SEND_BUTTON`)를 누른다. 단추가 없거나 꺼져 있으면 넣지 않고 `NOT_POSTED`.
  - 확인: reader가 읽은 새 채팅 중 **내 채널 ID + 같은 글(공백만 다른 것 같게 봄)** 이 15초 안에 뜨면 `POSTED`, 아니면 `UNCONFIRMED`(입력 칸에 우리 글이 그대로 남아 있으면 지움). 결과 뒤 3초 지나 다음을 묻는다. 결과 알리기는 실패하면 2초마다 5번까지(서버가 한 번만 반영).
  - 입력 칸이 없으면(로그인 안 함) `me: null, owner: null`로 물어 서버가 주인 아님 경고를 남기게 한다. OFF·NOT_BOUND·NOT_OWNER·PAUSED면 15초마다 다시 묻는다(초당 5요청 제한 안).
- 채널 읽기(`page-bridge.ts`, 이벤트 `livegenie-who` → 문서 맨 바깥 요소 `data-livegenie-me`·`data-livegenie-owner`, content가 읽고 바로 지움):
  - 로그인 채널 = `yt-live-chat-message-input-renderer` 요소 `data.authorExternalChannelId`(또는 `data.channelId`).
  - 방송 채널 = 주인 배지(`data.authorBadges[].liveChatAuthorBadgeRenderer.icon.iconType === 'OWNER'`)가 붙은 메시지 작성자(한 번 보면 기억), 없으면 `window.ytInitialData.continuationContents.liveChatContinuation.ownerChannelId`.
  - **HG-X1 확인 필요**: 실제 유튜브에서 이 두 경로가 맞는지 모른다(못 읽으면 안 올림 — 안전한 쪽). 경로는 `selectors.ts` 한 곳.
- **E2E(test-e2e) 가짜 페이지 손잡이**: 입력 칸 `<yt-live-chat-message-input-renderer><div id="input" contenteditable="true"></div><button id="send-button">보내기</button></yt-live-chat-message-input-renderer>`, 그 요소에 `el.data = { authorExternalChannelId: <내 채널> }`. 방송 채널은 주인 배지 메시지 하나(`data = { authorExternalChannelId, timestampUsec, authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }] }`)를 페이지에 두거나 `window.ytInitialData` 경로. "자기 글 뜨기 흉내"는 보내기 단추 click 때 입력 칸 글로 내 채널의 일반 채팅 요소(id·data 포함)를 `#items`에 붙이고 입력 칸을 비우면 된다. 확장은 시작 3초 뒤 첫 가져가기.
- 못 보낸 채팅: `chrome.storage.session`의 `queue`(바뀔 때마다 순서대로 씀, 비면 지움). 워커가 다시 뜨면 토큰이 있을 때만 이어 보내고, 토큰이 없으면 지움. 끊김(401)·"연결 지우기"도 지움. `storage.local`엔 토큰만.
- 게시 시각(`timestampUsec`)이 없으면 지금 시각으로 채우지 않고 "읽지 못함"(D-X1-28). 기존 단위 시험 하나("게시 시각이 없으면 읽은 시각")를 스펙 변경대로 바꿨다(약화 아님 — 기대가 더 엄격해짐).
- 회차: 영상마다 이어졌는지 서버(`GET /ext/broadcasts`)에 물어 알기 전에는 "받는 중"이라 하지 않는다(TE-X1-003). 연결 직후에도 바로 묻는다.
- 팝업: `[hidden]{display:none !important}`로 숨김이 `display:flex`에 덮이던 것 고침(TE-X1-002). 감사 경고 한 줄(`#thanks`, role=alert).
- 보낸 곳 검사(RA-X1-04): 팝업 전용(view·connect·forget·broadcasts·bind)은 보낸 곳 주소가 `chrome-extension://<내 id>/`일 때만, 채팅·상태·감사는 탭이 있고 주소가 live_chat일 때만.
- 배포 빌드: `build.mjs --prod`(또는 `LIVEGENIE_PROD=1`)는 https가 아니면 실패(localhost도).
- 소스 검사 시험: 누르기·입력(`click`·`execCommand`·`InputEvent`)은 `poster.ts`만, `send-button`·`contenteditable`은 `selectors.ts`만 허용으로 바꿨다(D-X1-25). 가로채기·내부 API 금지는 모든 파일 그대로.

### 화면
- 설정 "크롬 확장으로 채팅 받기" 칸 안 그룹 "확장으로 감사 채팅 올리기": 태그 "켜짐/꺼짐" + 버튼 "확장으로 감사 채팅 올리기 켜기/끄기"(유튜브 자동 게시 동의와 같은 모양). 켜기 → 창 "확장으로 감사 채팅 올리기를 켤까요?"(SPEC 문장 + 규칙 4줄) → "켤게요"(`{enabled:true, agreed:true}`) / "그대로 두기". 끄기는 바로 `{enabled:false}`.
- 콘솔 고정 영역(role=alert): 그 방송의 경고 — 멈춤 "! 확장으로 감사 글을 올리지 못하고 있어요 — 못 올린 감사는 … 확인해 주세요…" + 버튼 "다시 켜기", 주인 아님 "! 방송 채널 계정으로 로그인해야 … — 유튜브 채팅 창에서 방송 채널 계정으로 로그인해 주세요."(버튼 없음). 스위치 꺼짐·끝난 방송·리허설이면 없음.
- 유튜브 칸 감사 목록: 확장에 맡긴 행에 태그 "크롬 확장으로".

### disputesWithSpec (dev-web)
- AC-X1-33 "팝업 전용 메시지는 `sender.tab`이 있으면 거절": 팝업을 탭으로 열면(E2E가 그렇게 연다) 확장 페이지도 `sender.tab`이 있다. 그래서 "보낸 곳 주소가 이 확장 페이지인가"로 본다 — content script는 주소가 유튜브라 늘 거절되고(뜻은 같다), 팝업을 탭으로 연 경우도 쓸 수 있다.
