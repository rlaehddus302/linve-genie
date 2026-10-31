# LV1 dev-notes

## server

**최종: 웹이 정한 REST 모양(아래 `## web`)에 서버를 맞췄다.** 처음 적었던 방송 소리 웹소켓 안은 버림. 구현 `apps/server/src/voice/stream-audio.ts`·`stream-service.ts`·`stream-routes.ts`·`relay.ts`.

- `GET /api/settings/stream-audio` → `{ available, enabled }` · `PUT { enabled: boolean }`(아니면 400 `INVALID_INPUT`). 끄면 그 판매자 소리 흐름을 바로 닫는다. 기본 `enabled: true`(sellers.stream_audio, 마이그레이션 0035).
- `GET /api/broadcasts/:id/stream-audio` → `{ phase, lagMs? }` (`lagMs`·`late`는 `listening`일 때만, 조각 도착 기준. `late` = lagMs가 30,000을 넘음 — D-LV1-10). 남의 방송 404, 끝난 방송 `ended`, 운영자 끔·ffmpeg 없음 `hidden`, 판매자 끔 `off`.
- `POST .../stream-audio/watch {}` → 같은 모양. 25초 안에 다시 오지 않으면 콘솔이 닫힌 것으로 보고 소리 흐름을 닫는다. 이은 유튜브 링크가 없으면 `idle`로 기다리다(3초마다 확인) 이으면 스스로 시작.
- `POST .../stream-audio/restart {}` → `stopped`·`unsupported`를 지우고 다시 시작.
- 끊김 `reconnecting`(1·2·4·8초), 60초 안 여섯 번째면 `stopped`. 휴대폰 마이크(기본 음성 흐름)가 켜지면 `mic`, 끄면 다시 `listening`. 판매자 하나에 방송 소리 하나 — 다른 방송 콘솔이 열려 있는 동안 두 번째 방송은 `idle`.
- **[web에게 요청] 받아쓴 글을 콘솔이 받으려면, 방송 소리를 듣는 동안(phase `listening`) 그 콘솔이 기존 음성 웹소켓을 조작 전용으로 열어 두어야 한다** — `/api/voice/stream?broadcastId=..&device=..&capture=false`(지금 `remote.ts`의 `start(true)`와 같음, hello 보냄). 서버는 그 판매자의 열린 흐름이 그 방송의 조작 흐름일 때만 글(`{type:'result'}` + 읽기 효과 `voice.effect`)을 넘긴다. 열린 콘솔 흐름이 없으면 글은 버리고 등록하지 않는다(아무도 못 보는 바로 등록 없음, D-LV1-03). 조작 흐름으로 받은 자동 효과의 `source`는 `control`/`chrome`으로 온다.
- 늦은 글(10초) 규칙은 서버가 조각을 받은 시각에서 잰다. 상품 등록 시각은 콘솔이 효과를 실행해 서버가 기록한 시각(앞당기지 않음, D-LV1-04).
- 연습(`pnpm try`): 가짜 방송 소리(유튜브 이은 회차면 소리 있음, 처음 열면 2초 뒤 표지 소리 한 번) + 내장 모의 일꾼(표지 소리에만 "15번 핑크프릴 이만 원"). 다시 말하기 `POST /_try/stream-audio {op:'say'}`(같은 출처), 그 밖 op `cut|restore|delay{ms}|unsupported|supported`.
- E2E: `pnpm --filter server e2e-server ... --stream-audio fake`(가짜 소리 + 모의 일꾼, 일꾼 토큰은 그 명령 값) 또는 `--stream-audio off`(운영자 끔과 같음). 조작 `POST /_e2e/stream-audio { op, ms? }` 위와 같은 op.

## web
웹이 기대하는 서버 모양(서버 메모가 오면 맞춘다):
- `GET /api/broadcasts/:id/stream-audio` → `{ phase, lagMs? }`, phase는 `hidden`(운영자 끔·ffmpeg 없음) `off`(판매자 끔) `idle` `listening` `reconnecting` `stopped` `unsupported` `mic` `ended`. 콘솔이 1초마다 읽는다. 모르는 값은 숨김.
- `POST /api/broadcasts/:id/stream-audio/watch` `{}` — 첫 안내 창 확인 뒤 콘솔이 열려 있는 동안 10초마다(D-LV1-03 "콘솔 열림" 신호). `POST .../stream-audio/restart` `{}` — [다시 켜기].
- `GET /api/settings/stream-audio` → `{ available, enabled }`, `PUT` `{ enabled }` → 같은 모양. available false면 설정 칸 없음.
- [휴대폰으로 듣기]는 이 기기의 음성(마이크) 켜기를 부른다. 마이크가 켜지면 서버 응답과 상관없이 "휴대폰 마이크로 듣는 중".
- apps/mobile은 고치지 않음: 앱 콘솔은 그 자체가 휴대폰 마이크라 지금 상태 줄로 충분.
