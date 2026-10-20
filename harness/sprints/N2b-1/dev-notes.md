# N2b-1 개발 노트 — dev-server (틱톡 연결 모듈)

작업 폴더 `/Users/unhoyeo/livejjim-wt/n2b1`, 브랜치 `track/n2b1-tiktok`. 스펙 커밋 a99a0a1, BASE b25a265.
이번 스프린트는 앱 재시작으로 한 번 끊겼다. 앞선 실행이 커밋한 것(의존성·모듈·막기 장치)은 그대로 두고, 커밋 안 된 시험 8개를 읽어 형 오류 4개를 고친 뒤 커밋했고, 라이선스 시험 2개와 이 노트를 더했다.

## 만든 것

### `apps/server/src/tiktok/**` (새 독립 모듈)
| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `target.ts` | `parseTikTokTarget(input)` → 골든 모양 `{ uniqueId }`·`{ error }`, `checkTikTokTarget(input)` → `{ ok: true, target }` 또는 `{ ok: false, error, message }`, `isTikTokTarget`(실행 중 확인), `TIKTOK_TARGET_MESSAGES`. 정규식은 글자 범위 하나(`^[a-z0-9._]{2,24}$`)와 앞부분 떼기뿐 — 중첩 반복 없음. 길이 2,000(UTF-16) 넘으면 먼저 `INVALID` | AC-N2b-1-10·11 |
| `comment.ts` | `createCommentFilter(target)` → `accept(raw, receivedAt)`·`counts()`·`memorySize`. 검사 순서 댓글 ID → 사용자 ID → 본문 → 중복. 내보낸 ID만 고리 버퍼(2만 칸)+집합으로 기억. `decimalId`, `int64Value`, `chatEventFields` | AC-N2b-1-20~23·51 |
| `failure.ts` | `classifyWebcastFailure(error)` → 실패 종류 5개 (아래 대응표). 라이브러리를 import하지 않고 형 이름·칸으로 가른다. 어떤 값에도 예외 없음(읽기 오류·순환·깊이 4·마디 32 상한) | AC-N2b-1-35 |
| `connection.ts` | `createTikTokConnection(options)` → `{ start, stop, status }`(얼린 객체). 상태 7개, 다시 시도 시간표, 60초 유지, 연결 20초 시간 초과, 동의 20초 시간 초과, 열린 연결 하나, missed, 상태 알림. `tiktokConnectionMemorySize(conn)`(시험용 조회) | AC-N2b-1-23·24·30~38·40·41·50 |
| `messages.ts` | `TIKTOK_STATUS_MESSAGES`, `TIKTOK_MISSED_MESSAGE`, `tiktokStatusMessage(state, reason)`, `TIKTOK_STATES` | AC-N2b-1-30·37 |
| `settings.ts` | `readTikTokSettings(env)` → `{ beta, warning, signKey }`, `TikTokSignKey`(가린 상자 — 문자열·JSON·검사 출력이 `[가림]`), `libraryOptions(settings)`, `TIKTOK_LIBRARY_OPTION_KEYS`, `TIKTOK_SETTINGS_OFF` | AC-N2b-1-03·40·42 |
| `consent.ts` | `TikTokConsentCheck = (sellerId) => Promise<boolean>`, `denyAllTikTokConsent`(모두 거절) | AC-N2b-1-41 |
| `webcast.ts` | 웹캐스트 클라이언트 경계 `WebcastClient { connect, disconnect, on }`, `WebcastFactory = (uniqueId, options) => WebcastClient`, `WEBCAST_EVENTS`(chat·disconnected·streamEnd·error) | AC-N2b-1-60 |
| `library.ts` | `libraryWebcast({ Connection? })` — **`tiktok-live-connector`를 import하는 유일한 파일**. 연결 시도마다 `new TikTokLiveConnection(uniqueId, options)`. 라이브러리는 연결 시도 중에 닫을 수 없어서(`disconnect`는 연결된 뒤에만 닫는다) 닫은 뒤 늦게 성공하면 바로 닫고, 닫은 뒤의 이벤트는 넘기지 않는다 | AC-N2b-1-01~03 |
| `fake.ts` | `FakeWebcast`, `FakeWebcastHandle`, `FakeTikTokClock`, `fakeChatEvent`, `fakeLibraryError`, `flushTikTokTasks`. 네트워크·포트를 쓰지 않는다 | AC-N2b-1-60 |
| `clock.ts` | `TikTokClock { now, setTimer }`, `systemTikTokClock`(타이머 unref) | — |
| `index.ts` | 위 공개 이름 모음 (N2b-2는 여기서만 가져다 쓴다) | AC-N2b-1-62 |

### 모듈 밖에서 바꾼 것 (AC-N2b-1-01 목록 안)
| 파일 | 바꾼 것 | 이유 |
|---|---|---|
| `apps/server/src/log.ts` | `LogCode`에 `TIKTOK_*` 10개와 정해진 문장만 더함 (기존 코드·형·함수 그대로) | AC-N2b-1-50 |
| `apps/server/package.json`·`pnpm-lock.yaml` | `dependencies`에 `"tiktok-live-connector": "2.1.0"` | AC-N2b-1-02 |
| `pnpm-workspace.yaml` | `allowBuilds: { protobufjs: false }` | 하위 의존성 `protobufjs@6.11.6`에 `postinstall`이 있다(`cli/` 아래 폴더를 만들고 판 표기 경고를 내는 일 — 실행에 필요 없음). 이 저장소의 pnpm 12는 허용·거절을 적지 않은 설치 스크립트가 있으면 `ERR_PNPM_IGNORED_BUILDS`로 설치를 실패시킨다. 새 의존성의 설치 스크립트는 허용하지 않는 쪽(AC-N2b-1-01)이라 **거절**을 적었다. 없으면 `pnpm install`이 실패한다 |
| `apps/server/vitest.config.ts` | `setupFiles: ['test/setup-outbound-guard.ts']` 한 줄 | AC-N2b-1-04 |
| `apps/server/test/**` | 새 시험·준비 파일만 (아래). **기존 시험은 하나도 바꾸지 않았다** | AC-N2b-1-92 |

`packages/**`·`apps/web/**`·DB 스키마·마이그레이션·API·서버 시작 파일은 바꾸지 않았다(`tiktok-boundary.test.ts`가 import로, `git diff --stat b25a265..HEAD -- apps packages`로 확인).

### 시험 (`apps/server/test/`)
| 파일 | 본 것 |
|---|---|
| `outbound-guard.ts`·`setup-outbound-guard.ts`·`outbound-guard.test.ts` | 바깥 연결 막기 장치와 자체 시험 (AC-N2b-1-04) |
| `tiktok-golden.test.ts` | 골든 형식 계약·합계(파일 2·사례 58·댓글 65)·사례 전부 (AC-N2b-1-10·20·90) |
| `tiktok-target.test.ts` | 길이 상한·결정성·문장·해석 실패로 연결 객체 못 만듦 (AC-N2b-1-10·11) |
| `tiktok-comment.test.ts` | 64비트 ID 모양·chat 자료 꺼내기·틀린 모양·2만 개 기억·일곱 칸 (AC-N2b-1-21~23·51) |
| `tiktok-connection.test.ts` | 상태·문장·다시 시도·유지·흔들림·멈춤·시간 초과·start/stop·missed·상태 알림 (AC-N2b-1-30~38). 파일 전체에서 처리되지 않은 거부·예외 0을 프로세스 이벤트로 본다 |
| `tiktok-flow.test.ts` | 조작 목록·옵션·중복·도착 시각·버린 연결·스위치·동의(가~바)·서명 키·로그·가짜 웹캐스트·1만 개 (AC-N2b-1-03·23·24·40~42·50·51·60·61) |
| `tiktok-library.test.ts` | 판·라이선스(직접·실행 의존성), 생성자 바꿔 끼우기, 2.1.0 실제 디코더 자료, 오류 대응표 행마다, 실제 라이브러리가 막기 장치에 걸림 (AC-N2b-1-02~04·21·22·35) |
| `tiktok-boundary.test.ts` | import 경계·`sendMessage` 없음·보내는 함수 없음·입력 형에 세션 칸 없음 (AC-N2b-1-01·03) |
| `tiktok-support.ts` | 시험 도우미 `rig()` |

## 라이브러리 판·출처 (AC-N2b-1-02, D-N2b-1-01)
- `tiktok-live-connector@2.1.0` (npm, license `MIT`). 2.4.0(2026-06)부터 `AGPL-3.0-only`라 쓰지 않는다. 판을 올리려면 spec-keeper 결정, 2.4.0 이상은 사용자 법률 판단.
- **AGPL 판의 코드는 읽거나 옮겨 적지 않았다.** 이 모듈의 코드는 2.1.0의 공개 형 정의(`dist/types/*.d.ts`)·`dist/lib/client.js`의 동작(오류 형·이벤트 이름)을 보고 새로 썼다. 가짜 오류·가짜 자료의 문구는 2.1.0이 내는 문구를 흉내 낸 것이다.
- 실행 의존성(2.1.0이 끌고 오는 것): `@bufbuild/protobuf`(Apache-2.0 AND BSD-3-Clause), `@eulerstream/euler-api-sdk@0.1.5`·`axios`·`ws`·`typed-emitter`·`callable-instance` 등(MIT), `protobufjs@6.11.6`·`@protobufjs/*`(BSD-3-Clause), `long@4.0.0`(Apache-2.0). GPL 계열 없음 — 시험이 의존성 나무를 따라가며 확인한다.
- 새 직접 의존성은 이것 하나다(시험: BASE의 직접 의존성 목록 밖은 `tiktok-live-connector`뿐, 고정 판·허용 라이선스).

## 라이브러리 옵션 (AC-N2b-1-03·42)
`libraryOptions(settings)`가 연결 시도마다 새로 만든다. 키는 정확히 이것뿐이다.

| 키 | 값 | 이유 |
|---|---|---|
| `processInitialData` | `false` | 연결 때 받는 최근 댓글 묶음을 처리하지 않는다 (D-N2b-1-04) |
| `fetchRoomInfoOnConnect` | `true` | 방 정보의 `status === 4`(방송 아님) → 라이브러리가 `UserOfflineError` → `NOT_LIVE` |
| `enableExtendedGiftInfo` | `false` | 선물 정보는 받지 않는다 |
| `signApiKey` | 설정했을 때만 | `LIVEJJIM_TIKTOK_SIGN_API_KEY`(다듬어 빈 값이면 없음) |

연결 객체를 만드는 입력 형에는 쿠키·세션·로그인 칸이 없고, 입력 객체에 `sessionId`·`cookie`·`authenticateWs`·`useMobile`·`wsClientHeaders`를 섞어 넣어도 옵션에 닿지 않는다(설정 객체에서 `signKey` 말고는 읽지 않는다). 라이브러리 안에서도 `sessionId: null`·`authenticateWs: false`·머리글 `{}` 기본값 그대로임을 시험이 본다.

**라이브러리가 스스로 읽는 환경 변수** (2.1.0 `dist/lib/config.js`·`web/lib/http-client.js`·`web/routes/fetch-signed-websocket-euler.js`): `SIGN_API_KEY`(서명 키 기본값), `SIGN_API_URL`(서명 서비스 주소, 기본 `https://tiktok.eulerstream.com`), `TIKTOK_CLIENT_TIMEOUT`(HTTP 시간 제한, 기본 10초), `RANDOMIZE_TIKTOK_DEVICE`·`RANDOMIZE_TIKTOK_LOCATION`·`RANDOMIZE_TIKTOK_SCREEN`, `WHITELIST_AUTHENTICATED_SESSION_ID_HOST`. 우리 모듈은 이 이름들을 쓰지 않는다 — **운영 환경에 이 이름들을 두지 않는다**(특히 `SIGN_API_KEY`를 두면 옵션 없이도 그 키가 쓰이고, `SIGN_API_URL`을 두면 서명 요청이 다른 곳으로 간다). N2b-2가 운영 안내에 적는다.

## 64비트 정수 모양 (AC-N2b-1-21)
- 2.1.0의 protobuf 디코더(`dist/types/tiktok-schema.js`, ts-proto 생성)는 int64·uint64를 `reader.int64().toString()`으로 **10진 문자열**로 준다(`long@4` 설정). 형 정의도 `CommonMessageData.msgId: string`, `User.userId: string`이다. 시험이 실제 인코더·디코더로 `9223372036854775807`이 글자 그대로 오는 것을 확인한다.
- 감싸개(`int64Value`)는 다른 모양도 받는다: `bigint`는 그대로, protobuf 정수 객체 `{ low, high, unsigned }`는 `BigInt`로 묶어 10진 문자열로(부호 있는 경우 `BigInt.asIntN(64, …)`). 숫자(`number`)는 그대로 두어 거르개가 안전 정수인지 본다(안전 범위 밖이면 버림). `number`로 바꾸는 경로는 없다.

## chat 이벤트 자료 모양과 출처 (AC-N2b-1-22)
- 출처: 2.1.0 `dist/types/tiktok-schema.d.ts`의 `WebcastChatMessage`(이벤트 `chat` = `ClientEventMap[WebcastEvent.CHAT]: EventHandler<WebcastChatMessage>`, `dist/types/events.d.ts`).
- 꺼내는 칸: `common.msgId`(댓글 ID), `common.createTime`(꺼내지만 쓰지 않음), `user.userId`, `user.uniqueId`, `user.nickname`, `comment`. 그 밖(`user.profilePicture`·`badges`·`secUid`·`followInfo`·`bioDescription`·`emotes` 등)은 꺼내지 않는다.
- `fakeChatEvent(fields)`가 같은 모양(그리고 레코드에 새지 않는지 보려고 `secUid`·프로필 사진·배지·팔로우 정보도 싣는다)을 만든다. 실제 라이브러리 경로는 `tiktok-library.test.ts`가 실제 인코더로 만든 `ProtoMessageFetchResult`를 라이브러리의 `processProtoMessageFetchResult`(이벤트 내보내기 코드 그대로)에 넣어 확인한다.
- 듣는 라이브러리 이벤트는 `chat`·`disconnected`(`ControlEvent.DISCONNECTED`)·`streamEnd`(`WebcastEvent.STREAM_END` — 제어 메시지 action 3·4)·`error`뿐이다.

## 실패 종류 대응표 (AC-N2b-1-35)
연결 시도(`connect()`)의 거부 값을 `classifyWebcastFailure`가 가른다. 위에서부터 먼저 걸린 것. 오류 안쪽은 `FetchIsLiveError.errors[]`·`InvalidResponseError.requestErr`·표준 `cause`를 깊이 4·마디 32까지 따라간다.

| 순서 | 라이브러리 2.1.0의 오류 (형 이름·칸) | 어디서 | 실패 종류 |
|---|---|---|---|
| 1 | `InvalidUniqueIdError` | 아이디 형식이 틀림 | `USER_NOT_FOUND` |
| 1 | `InvalidResponseError` + 메시지에 `19881007` 또는 `user_not_found` (`API Error 19881007 (user_not_found)`) | `fetch-room-info-api-live` — 틱톡 API의 없는 사용자 | `USER_NOT_FOUND` |
| 2 | `UserOfflineError` | 방 정보 `status === 4` | `NOT_LIVE` |
| 3 | `SignAPIError`와 그 하위 형 `SignatureRateLimitError`·`SignatureMissingTokensError`·`PremiumFeatureError`·`AuthenticatedWebSocketConnectionError` (생성자 이름 사슬로 봄) | 서명 서비스(Euler) 연결 실패·상태 오류·한도·토큰 없음·유료 기능 | `SIGN_FAILED` |
| 4 | 칸 `response.status`가 403·429 (axios 오류) | 틱톡의 거부·요청 한도 | `BLOCKED` |
| 4 | 메시지에 `captcha` 또는 `blocked by TikTok` | `fetch-room-info-html` — 확인 문자·차단 | `BLOCKED` |
| 5 | 그 밖: 네트워크(`ECONNRESET`·`ETIMEDOUT`), 웹소켓 실패·시간 초과(문자열 거부 `Websocket connection failed…`·`Websocket not responding`), `MissingRoomIdError`, `InvalidResponseError('Missing cursor…')`, `AlreadyConnectingError`·`AlreadyConnectedError`, `FetchSignedWebSocketIdentityParameterError`(우리 옵션으로는 생기지 않는 매개변수 오류), `SchemaDecodeError`, 500 등 다른 HTTP 상태, 모르는 오류, 오류가 아닌 값(`undefined`·`null`·숫자·객체), 읽으면 오류가 나는 값 | | `NETWORK` |
| — | 연결 객체의 20초 시간 초과, 클라이언트 만들기·`connect()`의 동기 예외 | 연결 객체 | `NETWORK` |

- 연결된 뒤의 `error` 이벤트는 상태를 바꾸지 않고 로그 코드 `TIKTOK_LIBRARY_ERROR`만 남긴다. 실제로 끊기면 라이브러리가 `disconnected`를 내고 그것을 `NETWORK` 실패로 센다.
- 가짜 웹캐스트의 `fakeLibraryError(kind)`도 같은 형 이름·칸을 흉내 내어 같은 함수로 같은 종류가 된다(시험).
- **실물 확인 필요**: 실제 틱톡에서 방송 중이 아닌 사용자는 방 ID를 못 찾아 `FetchIsLiveError`(→ `NETWORK`)로 끝날 수도 있다(라이브러리는 방 ID를 먼저 찾고 그다음 방 정보를 본다). 그러면 문장이 "방송이 아직 시작되지 않았어요" 대신 "연결이 끊겨 다시 연결하는 중이에요"로 나온다. 시간표는 같아 판매자 손해는 없다. 실제 연결 확인은 사용자 몫(DECISIONS "사용자 확인 필요").

## 바깥 연결 막기 장치 (AC-N2b-1-04)
- `test/outbound-guard.ts`의 `installOutboundGuard(name, domains)`. 막는 곳: `net.Socket.prototype.connect`(TCP·TLS·웹소켓·fetch의 바닥 — DNS 조회 전에 막는다), `http(s).request·get`(URL·옵션·`Host` 머리글·프록시용 절대 경로까지 본다), 전역 `fetch`. 막은 시도는 `ECONNREFUSED` 오류로 끝나고 호스트를 센다.
- 이름마다 따로 세고, 감싸기는 프로세스에 한 번(`Symbol.for('livejjim.test.outbound-guard')` 등록부)이다. Y1의 구글 막기 장치가 같은 등록부를 쓰면 함께 돌고, 다른 구현이어도 지금 함수를 감싸 부르므로 서로를 지우지 않는다. **합칠 때 오케스트레이터가 `setup-outbound-guard.ts`에 구글 장치 줄을 더하면 된다.**
- `setup-outbound-guard.ts`가 서버 시험 파일마다 깔고, 그 파일에서 막힌 시도가 있으면 `afterAll`에서 파일을 실패시킨다.

## 결정과 이유 (규칙 문장으로 정해지지 않은 구현 선택)
1. **동의 확인 중의 상태는 `CONNECTING`이다.** 표에 "동의 확인 중" 상태가 없어서 "틱톡에 연결하는 중이에요"를 보인다. 동의 시간 초과(20초)는 동의 확인에만 걸고, 동의를 얻은 뒤 연결 시간 초과(20초)를 새로 건다 — 둘 다 늦으면 최대 40초 뒤에 실패로 본다. 동의 확인 중 `start()`는 아무 일도 없다(같은 순간 두 번 → 시도 하나).
2. **방송 끝(`streamEnd`)**: `CONNECTED`에서 오면 `ENDED`이고 AC-N2b-1-37 문장 그대로("`stop()`이 아닌 이유로 끊기면") `missed`도 `true`로 둔다. `CONNECTING` 중에 오면 `ENDED`(`missed` 그대로). 화면에서 `ENDED`일 때 끊김 안내를 보일지는 N2b-2가 정한다.
3. **`USER_NOT_FOUND`도 실패 하나로 센다**(`failures` 1, `lastFailure` `USER_NOT_FOUND`).
4. **`start()`는 `failures`·`lastFailure`·`missed`를 모두 비운다.** 판매자가 새로 켠 것이라 지난 실패를 이어 세지 않는다(AC-N2b-1-36 "연속 실패 0").
5. **`counts.dropped`**는 `DUPLICATE` 말고의 모든 버림(`BAD_COMMENT_ID`·`BAD_USER_ID`·`NO_TEXT`·`TEXT_TOO_LONG`)이다. 지금 연결이 아닌 손잡이·`CONNECTED` 전·`stop()` 뒤의 댓글은 거르개에 넣지 않으므로 어느 수에도 들지 않는다.
6. **운영자 스위치는 연결 객체를 만들 때 받은 설정 값으로 매 시도 확인한다**(설정 읽기는 서버 시작 때 한 번 — 바꾸면 다시 시작). 동의는 매 시도 새로 묻는다.
7. **버린 시도의 라이브러리 HTTP 요청은 끝까지 간다.** 라이브러리 2.1.0은 연결 시도를 중간에 멈출 수 없다. 감싸개는 닫은 표시를 해 두고, 늦게 성공하면 바로 닫으며(`TIKTOK_LATE_CLOSED`), 그동안의 이벤트를 넘기지 않는다.
8. **콜백(`onRecord`·`onStatus`)은 기다리지 않는다.** 들어온 순서대로 동기적으로 부르고, 돌려준 약속이 거부되면 로그 코드만 남긴다. 저장 순서를 지키는 것은 받는 쪽 몫이다(아래 N2b-2에게).
9. **로그 코드**(값 없이 `errorKind`·`count`만): `TIKTOK_CONNECT_FAILED`(실패 종류·몇 번째), `TIKTOK_DISCONNECTED`, `TIKTOK_GAVE_UP`, `TIKTOK_CONSENT_FAILED`(표준 오류 이름 또는 `Timeout`), `TIKTOK_LIBRARY_ERROR`, `TIKTOK_LATE_CLOSED`, `TIKTOK_RECORD_FAILED`·`TIKTOK_STATUS_FAILED`·`TIKTOK_EVENT_FAILED`(표준 오류 이름만 — 이름에 값을 심어도 `Error`로 남긴다), `TIKTOK_BETA_INVALID`(N2b-2가 서버 시작 때 남길 코드).

## 바꾼 기존 시험
없다. 기존 서버·적대·E2E 시험은 그대로다. `vitest.config.ts`에 시험 준비 파일 한 줄만 더했다.

---

## N2b-2에게 (AC-N2b-1-62)

### 가져다 쓰는 곳
`apps/server/src/tiktok/index.ts` 하나에서만 가져다 쓴다. 라이브러리(`tiktok-live-connector`)를 직접 import하지 않는다(경계 시험이 `src/tiktok/library.ts` 하나만 허용한다 — 다른 곳에서 부르면 시험이 깨진다).

### 내보내는 함수·형
| 이름 | 모양 | 쓰임 |
|---|---|---|
| `checkTikTokTarget(input: unknown)` | `{ ok: true, target: TikTokTarget }` \| `{ ok: false, error: 'EMPTY'\|'INVALID'\|'SHORT_LINK', message }` | 판매자 입력 한 줄 → 연결 대상. `message`는 화면에 그대로 |
| `parseTikTokTarget(input)` | `{ uniqueId }` \| `{ error }` | 골든 모양 (화면에는 `checkTikTokTarget`) |
| `TIKTOK_TARGET_MESSAGES` | 코드 → 문장 | |
| `createTikTokConnection(options)` | `TikTokConnection { start(): void; stop(): void; status(): TikTokConnectionStatus }` | 판매자 하나의 틱톡 연결 하나. `target`이 해석을 거친 값이 아니면 `TypeError` |
| `TikTokConnectionOptions` | `{ sellerId: string; target: TikTokTarget; webcast: WebcastFactory; onRecord(record); onStatus?(status); settings?; consent?; clock?; log? }` | `settings` 없으면 꺼짐, `consent` 없으면 모두 거절, `clock` 없으면 실제 시계, `log` 없으면 표준 오류 출력 |
| `libraryWebcast()` | `WebcastFactory` | 실제 연결기 (운영) |
| `FakeWebcast#factory` | `WebcastFactory` | 가짜 (시험·E2E) |
| `readTikTokSettings(process.env)` | `{ beta: boolean; warning: 'TIKTOK_BETA_INVALID' \| null; signKey: TikTokSignKey \| null }` | 서버 시작 때 한 번. 값·키는 결과 어디에도 보이지 않는다 |
| `TikTokConsentCheck`, `denyAllTikTokConsent` | `(sellerId) => Promise<boolean>` — 정확히 `true`만 허용 | 동의 기록을 읽는 구현으로 바꿔 끼운다 |
| `createCommentFilter`, `chatEventFields`, `decimalId`, `int64Value` | | 수동 입력·재생 시험 등에서 같은 규칙이 필요하면 |
| `classifyWebcastFailure`, `TIKTOK_FAILURE_KINDS` | | |
| 상수 | `TIKTOK_RETRY_DELAYS_MS`(5·10·20·40·60·60·60·60초), `TIKTOK_GIVE_UP_AFTER`(9), `TIKTOK_STABLE_MS`(60초), `TIKTOK_CONNECT_TIMEOUT_MS`·`TIKTOK_CONSENT_TIMEOUT_MS`(20초), `TIKTOK_COMMENT_MEMORY`(2만), `TIKTOK_NICKNAME_MAX`(64), `TIKTOK_TEXT_MAX`(500), `TIKTOK_TARGET_INPUT_MAX`(2,000) | |

### 공통 댓글 레코드 (`onRecord`로 받는 것, 얼린 객체)
`{ platform: 'TIKTOK', commentId: string, userId: string, nickname: string, text: string, receivedAt: string, owner: boolean }` — 정확히 일곱 칸.
- `commentId`·`userId`: 0으로 시작하지 않는 양의 10진 문자열(1~32자리). **숫자로 바꾸지 않는다**(2^53 넘음). 구매자 키 = `userId`.
- `nickname`: 다듬고, 비면 다듬은 아이디(`uniqueId`), 64 코드 포인트까지. **D-Y05 닉네임 정리·화면 이스케이프는 N2b-2 몫**(신뢰할 수 없는 입력).
- `text`: 받은 그대로(다듬지 않음). 파서가 읽는다.
- `receivedAt`: 연결 객체 시계로 잰 서버 도착 시각(UTC ISO 밀리초). `createTime`(틱톡 쪽 시각)은 쓰지 않는다.
- `owner`: 댓글 쓴 사람의 아이디가 연결한 아이디와 같으면 `true` → 엔진 `claim.ignoreOwner`로 잇는 것은 N2b-2.
- `onRecord`는 들어온 순서대로 **동기적으로** 불리고 **기다리지 않는다**. 저장이 비동기면 받는 쪽이 부른 순서대로 방송별 직렬 큐에 넣어야 판정 순서(서버 도착순)가 지켜진다. 콜백이 던져도 연결은 계속된다.

### 상태 (`status()`, `onStatus`)
`{ state, reason, message, failures, nextAttemptAt, lastFailure, missed, counts: { received, duplicates, dropped } }`
- `onStatus`는 `state`·`reason`·`failures`·`missed` 중 하나라도 바뀔 때만 한 번씩. 댓글 수(`counts`)는 `status()`로 본다.
- `message`는 화면에 글자 그대로. `missed === true`면 `TIKTOK_MISSED_MESSAGE`("끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.")를 함께 보인다.

| state | reason | message (`TIKTOK_STATUS_MESSAGES`) |
|---|---|---|
| `IDLE` | `null` | 틱톡에 아직 연결하지 않았어요. |
| `CONNECTING` | `null` | 틱톡에 연결하는 중이에요. (동의 확인 중 포함) |
| `CONNECTED` | `null` | 틱톡 댓글을 받고 있어요. |
| `RETRYING` | `NETWORK`·`NOT_LIVE`·`BLOCKED`·`SIGN_FAILED` | acceptance AC-N2b-1-30 표 그대로 |
| `STOPPED` | `USER_NOT_FOUND`·`GAVE_UP`·`BY_SELLER` | 〃 |
| `ENDED` | `null` | 틱톡 방송이 끝났어요. |
| `OFF` | `OPERATOR_OFF`·`NO_CONSENT` | 〃 |

### 가짜 웹캐스트 쓰는 법 (시험·E2E)
```ts
const fake = new FakeWebcast().account('seller_kim', 'LIVE')   // 'LIVE' | 'OFFLINE'(→NOT_LIVE) | 'MISSING'(→USER_NOT_FOUND, 계정을 안 만든 아이디도)
const clock = new FakeTikTokClock(Date.UTC(2026, 9, 20, 11))      // 또는 systemTikTokClock
const conn = createTikTokConnection({ sellerId, target, webcast: fake.factory, onRecord, onStatus,
  settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }), consent: async () => true, clock })
conn.start(); await flushTikTokTasks()                           // → CONNECTED
fake.last?.chat({ msgId: '7301000000000000001', userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15' })
fake.broadcast('seller_kim', fields)                             // 그 방송에 열린 모든 연결로 같은 댓글
```
- 조작: `failNext(kind, times)`(다음 시도들을 그 종류로 실패), `hold()`·`hold(false)`(시도에 답하지 않기 — 손잡이 `succeed()`·`fail(kind)`로 나중에 끝냄), `recentComments([...])`(연결 때 최근 댓글 묶음 — `processInitialData`가 `false`라 레코드가 되지 않음), 손잡이 `chat(fields)`·`emit(event, data)`(댓글이 아닌 이벤트 등)·`drop()`(끊김)·`endStream()`(방송 끝).
- 관찰: `attempts`, `created`, `openCount`, `maxOpen`, `closes`, `handles`, `last`, `openHandles(id)`, 손잡이 `options`·`uniqueId`·`state`·`closed`·`disconnectCalls`.
- 시계: `clock.advance(ms)`·`advanceTo(at)`가 그 사이 타이머를 시각 순서대로 돌리고 약속 이어 붙이기까지 끝낸다. `pendingTimers`로 남은 타이머를 본다.
- E2E에서 실제 서버로 띄울 때는 서버 시작 코드(`commands/e2e-server.ts` 등)에서 `libraryWebcast()` 대신 `fake.factory`를 넘기고, 시험이 댓글을 넣을 길(예: E2E 전용 경로)을 N2b-2가 만든다. 이 모듈은 포트를 열지 않는다.

### N2b-2가 할 일 (이 스프린트가 하지 않은 것)
1. 방송(회차)에 틱톡 잇기 — 레코드 → `chat` 이벤트 기록(입력 우선 기록, 방송별 직렬 처리, `(판매자, 방송, 출처, 외부 ID)` 유일 제약으로 2만 개 밖으로 밀려난 중복의 2차 방어), 구매자 키 모양, `owner` → `claim.ignoreOwner`, 닉네임 정리(D-Y05)·화면 이스케이프.
2. 동의 기록·위험 고지 문구·켜고 끄는 화면·판매자별 끄기 저장, 그것을 읽는 `TikTokConsentCheck` 구현. **판매자가 동의를 끄면 `stop()`을 부른다** — 모듈은 연결 중에는 동의를 다시 묻지 않는다.
3. 서버 시작에 `readTikTokSettings(process.env)` 잇기, `warning`이 있으면 로그 코드 `TIKTOK_BETA_INVALID`(값 없이) 남기기, 서명 키 전달. 운영 안내에 라이브러리가 스스로 읽는 환경 변수(`SIGN_API_KEY`·`SIGN_API_URL` 등)를 두지 말라고 적기.
4. 연결이 막혔을 때(`RETRYING`/`BLOCKED`·`SIGN_FAILED`, `STOPPED`/`GAVE_UP`, `OFF`) 수동 입력(댓글 붙여넣기) 대체 경로, "다시 연결" 단추(`start()`).
5. API·DB·실시간 알림(SSE)·화면·E2E, 서버 재시작 뒤 이어받기(NFR-03), 서버 여러 대에서 연결 하나, 동시 송출·구매자 합치기.

## 검증
- `pnpm typecheck`·`pnpm lint` 통과. 서버 틱톡 시험 9파일(막기 장치 포함) 통과 — 서버 시험 전체에서 막힌 바깥 연결 0.
- `E2E_PORT_OFFSET=1500 pnpm verify` (2026-10-20, 다른 작업 폴더 여럿이 함께 돌아 부하 평균 30~77 / 12코어):
  typecheck 통과 · lint 통과 · golden 통과(파일 26 · 파서 460 · 엔진 129 · 통과 589, AC-N2b-1-91) · coverage 통과(라인 100% · 분기 99.66%),
  test 실패 1 / 3287 · adversarial 실패 1 / 823 · e2e 실패 1 / 265. **세 실패 모두 걸린 시간 탓이고 이 스프린트가 바꾸지 않은 영역이다** — 따로 다시 돌린 결과:
  | 실패 | 원인 | 따로 다시 돌림 |
  |---|---|---|
  | `packages/voice/test/perf.test.ts` "사전 3,000개 → p99 50ms 이하" (134.9ms) | 부하 아래 시간 측정. 이 파일 이름은 `*.perf.test.ts`가 아니라 `perf.test.ts`라 D-902의 게이트 밖 규칙에 걸리지 않고 `pnpm test`에서 돈다(dev-device 영역, P2) | 부하 40에서도 74ms로 실패 — 부하에 따라 값이 바뀐다. `packages/**`는 BASE와 같다 |
  | `tests/adversarial/s00/verify-gates.test.ts` TD-S00-015 "임시 저장소 복사본은 typecheck 단계를 통과한다" | 임시 복사본의 타입 검사 15개가 90초 안에 끝나지 않아 SIGKILL(`code: null`) — 적대 단계가 병렬로 도는 중 | 그 파일만 다시: 29개 모두 통과 |
  | `tests/e2e/i4/attacks.spec.ts:89` "한 결과 이벤트에 최종 문장 둘 → 카드 둘" | 빠른 입력 칸 초점 10초 시간 초과 | 그 파일만 다시(`E2E_PORT_OFFSET=1500`): 14개 모두 통과 |
- 서버 타입 검사 시간: 틱톡 파일을 뺀 설정과 넣은 설정의 사용자 CPU 시간이 8.4초·7.4초로 비슷하다(라이브러리 형 정의 17만 자를 더해도 서버 검사 시간이 눈에 띄게 늘지 않음).
