# LV1 dev-notes

## server

웹이 쓸 모양 (VOC-08, D-LV1-02~09). 서버 쪽 구현: `apps/server/src/voice/stream-audio.ts`·`relay.ts`.

### 1. 설정 REST (판매자만, 보조자 403)
- `GET /api/voice/stream-audio` → `{ available: boolean, on: boolean }`
  - `available=false`: 운영자 `LIVEJJIM_STREAM_AUDIO=off`이거나 ffmpeg 없음 → 설정 칸·상태 줄을 숨기고 방송 소리 웹소켓을 열지 않는다(D-LV1-08). 마이크는 그대로.
  - `on`: 판매자 설정 "방송 소리로 듣기"(기본 `true`).
- `PUT /api/voice/stream-audio` 본문 `{ on: boolean }` → 같은 모양. 끄면 그 판매자의 듣는 흐름을 바로 닫는다(`closing` `STREAM_OFF`).
- 오류: 400 `INVALID_INPUT`(on이 참/거짓이 아님).

### 2. 방송 소리 웹소켓 (콘솔이 열려 있는 동안만 연다, D-LV1-03)
- `GET ws(s)://<같은 출처>/api/voice/stream?broadcastId=<b>&device=<기기ID>&source=broadcast` — 쿠키 세션·같은 출처, 판매자만(기존 마이크 흐름과 같은 입구).
  - 첫 안내 창("방송 소리를 라이브지니 받아쓰기 서버로 보내 글로 바꿔요. …") 확인은 화면 몫. 확인 전에는 열지 않는다.
  - 방송을 잇지 않았으면(유튜브 이은 기록 없음) 열어도 `stream.audio` `idle`로 기다린다 — 이으면 서버가 스스로 시작(몇 초 안).
- 기기는 **소리를 보내지 않는다**(보낸 이진 조각은 버림). 나머지는 마이크 흐름과 같다: `ready`, `voice.state`·`voice.effect`(읽기·바로 등록·카드, `source:'livegenie'`), 기기→서버 `voice.session` hello/context/command/effectResult 그대로.
  받아쓴 글 결과 `{type:'result'}`도 마이크와 같이 온다.
- 서버 → 기기 새 메시지 `{ type: 'stream.audio', phase, lagMs? }`
  - `idle` 방송 링크 없음·소리 주소 찾는 중 · `listening` 듣는 중(`lagMs` 조각 도착 기준 늦음, 20,000 넘으면 늦음 안내 — 1초마다 다시 보냄)
  - `reconnecting` 끊김, 1·2·4·8초 다시 잇는 중(끊기고 1초 안에 보냄) · `mic` 휴대폰 마이크가 듣는 중(마이크를 끄면 다시 `listening`)
  - `elsewhere` 같은 판매자의 다른 콘솔 화면이 이미 방송 소리를 듣는 중(이 화면엔 효과가 오지 않음 — 그 화면이 닫히면 이 화면이 이어 받음)
  - `stopped` 60초 안 여섯 번째 끊김 → 곧 `closing` `STREAM_STOPPED`로 닫힘. [다시 켜기] = 웹소켓을 새로 연다
  - `unsupported` 소리를 받을 수 없는 방송(회원 전용 등, D-LV1-07) → 곧 `closing` `STREAM_UNSUPPORTED`. 채팅 수집은 계속
- 닫힘 까닭(`{type:'closing', reason}`) 추가: `STREAM_OFF`(운영자 끔·ffmpeg 없음·판매자 설정 끔 — 다시 잇지 말 것), `STREAM_STOPPED`, `STREAM_UNSUPPORTED`. 기존 `ENDED`(방송 끝 — 소리도 닫힘), `AUTH`, `RATE`.
  `NO_WORKER`·`BUSY`·`WORKER_LOST`는 방송 소리 흐름에선 닫지 않고 `reconnecting`으로 서버가 다시 잇는다.
- 흐름 하나(D-LV1-06): 같은 판매자가 휴대폰 마이크(`/api/voice/stream` 기본 흐름)를 켜면 방송 소리 흐름은 닫히지 않고 `mic`로 쉼(소리·일꾼 흐름은 닫힘), 마이크 흐름이 끝나면 `listening`으로 돌아온다. 방송 소리 쪽이 마이크를 `OTHER_DEVICE`로 막지 않는다.

### 3. 시험·연습 (D-LV1-09)
- `pnpm try`: 연습 라이브가 가짜 방송 소리(정해진 말이 든 1초짜리 표지 소리, 12초마다)를 내고, 내장 모의 일꾼이 그 표지 소리에만 "15번 핑크프릴 이만 원"을 돌려준다(진짜 마이크 소리엔 아무 글도 안 돌려줌).
- E2E 기동(`apps/server/src/e2e.ts` 옵션 `streamAudio: true`): 같은 가짜 소리 + 모의 일꾼. 조작 `POST /_e2e/stream-audio { op: 'cut'|'restore'|'delay'|'unsupported'|'say', ms? }`
  - `cut` 소리 끊기(되살릴 때까지 다시 잇기 실패) · `restore` · `delay {ms}` 조각을 그만큼 늦게 만든 것으로(늦음 시험) · `unsupported` 소리 못 받는 방송으로 · `say` 지금 표지 소리 한 번 내기
