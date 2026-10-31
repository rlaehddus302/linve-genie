# REL1 개발 메모

## server
- 모의 받아쓰기 일꾼(E2E 기동만): 흐름 수를 64(`E2E_MOCK_WORKER_STREAMS`, 중계 hello 상한)로 알린다. 여러 E2E worker의 판매자·방송이 각자 흐름을 받는다. 운영 기본값(`startMockWorker` maxStreams 1, 실제 일꾼)은 그대로다.
- 서버 시계 조작(E2E 기동만, 서버 앱·운영 main에는 없다 — `server.app`에 요청하면 404):
  - `POST /_e2e/clock { at: "2026-03-01T01:02:03Z" }` 또는 `{ at: <UTC 밀리초> }` → `{ now: ISO, offsetMs }` — 그 시각부터 실제 시계와 같은 빠르기로 흐른다.
  - `POST /_e2e/clock { reset: true }` → `{ now, offsetMs: 0 }` — 실제 시계로 되돌린다.
  - `GET /_e2e/clock` → `{ now, offsetMs }`. 잘못된 본문(at 없음·읽을 수 없는 시각)은 400 `{ error: 'input' }`.
  - 주의: 시계는 서버 하나에 하나다. 바꾸면 같은 서버를 쓰는 다른 시험에도 닿으니, 시계를 바꾸는 시험(s06/sms-12 등)은 직렬로 돌리고 끝에 반드시 `reset`한다.
