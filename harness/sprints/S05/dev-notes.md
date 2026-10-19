# S05 개발 노트

## dev-server

### 만든 것
- **코어 조회 함수 둘 (D-086, `packages/core` 최소 변경 — dev-core 영역, 이번 스프린트는 dev-core 없음)**
  - `listBlocked(state)`: 차단 중인 구매자 ID 전부(구매자로 기록된 적 없는 미리 차단한 채널 포함), UTF-16 코드 단위 사전 순. 풀면 맵에서 지우므로 키가 곧 차단 중인 ID다.
  - `listMessages(state)`: 받은 메시지마다 `{ broadcast, id, channel, seq, at, publishedAt, ignored, order, cancel, converted }`, seq 순. 본문·닉네임은 상태에 없다.
  - 타입 `MessageInfo`(types.ts), `engine.ts`에서 내보냄. 판정·상태 형식·기존 조회는 바꾸지 않았다. 시험 `packages/core/test/unit/engine-views-s05.test.ts`(모델 비교·parseChat 일치 성질 포함).
- **리허설 범위 (AC-S05-50, D-081)**: 엔진 범위 = (판매자, 날짜, 리허설인지).
  - 마이그레이션 `0002_s05_rehearsal_scope_seq.sql`: `scopes.rehearsal`(기본 false)·`scopes.seq`(기본 0, 기존 범위는 이벤트 기록의 마지막 seq로 채움), 유일 키 `scopes_seller_date_rehearsal_uq (seller_id, date, rehearsal)`, `outbox.rehearsal`(기본 false), 인덱스 `events_chat_seq_idx (scope_id, chat_broadcast, seq)`.
  - 범위별 직렬 처리(대기열 키·어드바이저리 락 키·메모리 상태 키)에 리허설인지를 넣었다. 실제 범위의 락 키는 S04와 같다.
  - 리허설 범위의 발송함 행은 `rehearsal = true`(S08·S11 실행기가 건너뛴다). 이번 스프린트에 실행기는 없다.
  - 차단 이어받기: 실제 범위는 이전 **실제** 범위에서만(코어 `listBlocked`만 쓴다 — `state.blocked.root`를 읽지 않는다, AC-S05-80). 리허설 범위는 이어받지도 넘겨주지도 않는다.
  - 재생 무결성 검사는 리허설 범위도 검사하고 한 줄에 "리허설"을 붙인다.
- **범위 행의 지금 seq (AC-S05-60, D-085)**: 이벤트를 커밋하는 트랜잭션 안에서 `scopes.seq`를 그 요청의 마지막 seq로 고친다(실패 표시·차단 이어받기 포함). SSE `ready`·`GET /api/days`·차단 이어받기의 "이전 범위" 고르기는 이 칸을 읽는다(이벤트 표 `max(seq)` 집계 없음). 재생 검사 명령은 범위 행 seq와 기록의 마지막 seq를 대조한다(부분 이름 `범위 seq` — S04 dev-notes의 "마지막 이벤트를 지우면 모를 수 있음" 한계를 닫는다).
- **증분 조회 (AC-S05-61, D-085)**: 범위마다 최근 seq의 엔진 상태를 기준점으로 둔다(기본 1000개, 영속 자료라 앞뒤 상태가 마디를 공유). since의 상태와 지금 상태를 **같은 코어 조회 함수**로 보고 항목 키로 비교한다 — 규칙별로 무엇이 바뀌는지 따로 계산하지 않으므로 "덮으면 같다"가 만드는 방식 그대로 성립한다. 상태 하나의 조회 결과는 작은 캐시(최근 8개 상태)에 둔다.
- **메시지 조회 (AC-S05-20)**: 채팅 이벤트 행(본문·닉네임)에 엔진 기록(`listMessages` — 주문·취소·무시·바꾼 번호)과 그 방송 스냅샷 설정의 `parseChat`(언급, 주문·취소 번호)을 붙인다. 서버는 주문·취소를 다시 판단하지 않는다(주문·취소 번호는 엔진 기록이 주문·취소일 때만 채운다).
- **가짜 채팅 생성기·시청자로 보내기 (AC-S05-51·52, D-082)**: `src/generator.ts`. 시드(mulberry32) + 그 시점의 리허설 범위 상태(그 방송 상품 번호·상태, 설정 스냅샷)로만 다음 메시지를 정하고, 수집 함수(`ingestChat`, 조치자 collector)로만 쓴다. 종류: 판매 중 번호 주문(`15`·`15번`·`15번이요`·`찜15`·`15번 찜`), 없는 번호 주문(보류), 언급·질문(`15번 예뻐요`·`3개 남았나요?`…), 시청자 취소(그 채널이 주문했던 번호), 일반 대화, 닉네임 바꾸기, 같은 닉네임·다른 채널, 방송자(`owner: true`), 같은 메시지 ID 다시 보내기. 글은 그 방송 설정의 `parseChat`으로 의도대로 해석되는 후보만 쓴다(LOOSE 등). 메시지 ID `sim-<시드>-<시작 seq>-<순번>`, 채널 `sim_c<n>`·`sim_owner`(실제 `UC…` 24자와 겹치지 않음), 닉네임·본문에 숫자 덩어리는 번호 1~4자리뿐.
- **상품별 조치 기록 (AC-S05-35)**: 이력 조회에 `b`·`no` 거르기. 본문이 JSON 문자열이라(jsonb 아님 — NUL 등) DB에서 거르지 않고 `product.*`·`host.*` 행을 1,000개씩 차례로 읽어 거른다.
- **E2E 서버 기동 (AC-S05-91)**: `src/e2e.ts`(`startE2eServer`·`fillScope`·`readE2eAccount`) + 명령 `src/commands/e2e-server.ts` + 픽스처 `apps/server/e2e/account.json`.
- **화면 설정 `GET /api/client-config`**: `{ hostActionDelayMs }` — 운영 5000(`HOST_ACTION_DELAY_MS`), E2E 기동만 줄인다(D-083, AC-S05-41).

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **`GET /api/days`는 기본이 실제 범위만, `?rehearsal=true`면 리허설 범위만.** "날짜로 범위를 고르는 조회는 리허설을 명시해야" 원칙을 목록에도 같게 적용했다(실제 날짜 목록에 리허설 날짜가 섞이지 않게). SSE `ready`는 두 쪽 모두를 리허설 표시와 함께 준다(리허설 콘솔도 같은 연결을 쓴다).
- **`b`가 있는 이벤트에 `?rehearsal=`을 적으면 400** (`?date=`와 같은 이유 — 범위를 두 가지로 정하는 길을 없앤다).
- **메시지 조회는 범위 경로(`/api/days/:date/messages`) + `b` 거르기.** 리허설 방송은 `rehearsal=true`를 적어야 그 범위에서 보인다(적지 않으면 실제 범위에 그 방송이 없어 404). 조회가 본 범위 상태의 seq까지만 준다(다른 인스턴스가 그 뒤 쓴 행은 다음 조회에).
- **증분 조회 응답에 since 뒤의 새 메시지(최대 200개)도 담는다.** D-085 "그 뒤의 새 채팅 메시지" + AC-S05-62 "알림마다 증분과 새 메시지만" — 알림 하나에 요청 하나로 따라잡게. 그날 전체를 한 번에 주는 길은 여전히 없다(200개 상한, 넘으면 `messagesMore` → `/messages?after=`). 전체 조회(`/api/days/:date`)에는 메시지가 없으므로 "덮으면 같다"는 메시지 밖의 목록에 대한 성질이다.
- **줄 수 없는 since는 410 `RESYNC_REQUIRED`.** 기준점 창(최근 1000 seq) 밖, 지금보다 큰 seq, 서버를 다시 시작해 불러온 스냅샷보다 앞선 seq.
- **생성기 `sent`는 다시 보낸 사본을 포함한 보낸 수**, `total`도 같은 기준이다(다 보내면 `sent == total`). 기록된 메시지 = `sent − duplicates − failed`.
- **생성기 시작 시 요청 번호는 선택**: 같은 요청 번호로 다시 보낸 시작은 그 생성기 상태(200)를 돌려준다(네트워크 재시도 안전). 끝난 리허설 방송은 시작 409 `BROADCAST_ENDED`(끝내면 멈추는 규칙과 같은 결과). 시청자로 보내기는 끝난 방송에도 된다(R-1 — 끝난 뒤의 입력도 평소대로).
- **방송 끝내기는 생성기를 먼저 멈춘 뒤(보내던 메시지가 끝나기를 기다림) `broadcast.end`를 기록한다** — 끝낸 방송에 생성기가 쓴 채팅이 남지 않게. 다른 인스턴스가 끝내면 다음 메시지 전에 범위 상태를 보고 멈춘다.
- **멈춤 요청은 보내던 메시지가 끝날 때까지 기다렸다가 응답한다** — 응답 뒤에는 생성기가 쓰지 않는다.
- **서버를 다시 시작하면 생성기 상태는 메모리에 없다**(이어서 하지 않음, 상태 `running: false, sent: 0, stopReason: null`). 같은 프로세스 안에서 `close()`면 `stopReason: 'shutdown'`.
- **시청자로 보내기 채널**: 없으면 닉네임의 FNV-1a 해시로 `sim_n_<36진수>`(닉네임마다 같은 가짜 채널), `"new"`면 `sim_v_<무작위>`, `sim_…`이면 그대로(생성기 채널 포함), 그 밖은 400. 닉네임은 제어 문자 없이 1~30자, 본문은 1~200자(코드 포인트로 셈 — 이모지 한 글자, 줄바꿈 허용). 휴대폰 번호 검사 없음(시청자 값, R-1).
- **E2E 채우기의 채팅은 생성기 메시지를 한 트랜잭션에 250개씩** 기록 경로로 쓴다(같은 ID 사본은 뺀다). 상품은 `product.register`(조치자 서버, 가격 10,000~19,000원). 상품 500·채팅 1만 건 채우기가 이 PC에서 약 3초.

### 바꾼 기존 테스트 (약화 아님 — 계약에 리허설인지가 더해졌다)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| `GET /api/days` `{ date, seq }` (`api.test.ts`) | `{ date, rehearsal: false, seq }` | AC-S05-50 범위 = 날짜·리허설인지 |
| 방송 목록 `{ id, date, title, ended, endedAt }` (`api.test.ts`, `write-path.test.ts`) | `rehearsal` 더함 | AC-S05-50 "방송 목록은 리허설인지를 함께" |
| 쓰기 결과 `{ date, seq, type, changed, effects }` (`api.test.ts`) | `rehearsal` 더함 | 같은 이유 |
| 범위 조회·이력 응답 (`api.test.ts`) | `rehearsal` 더함 | 같은 이유 |
| SSE `ready` `{ scopes: [{ date, seq }] }`, `change` `{ date, seq, type }` (`stream.test.ts`, `hub.test.ts`, `write-path.test.ts`의 알림) | `rehearsal` 더함 | AC-S05-50 "실시간 알림은 범위를 날짜와 리허설인지로" |
| 유일 제약 `scopes_seller_date_uq (seller_id, date)` (`schema.test.ts`) | `scopes_seller_date_rehearsal_uq (seller_id, date, rehearsal)` | D-081 |
| 재생 검사 "마지막 이벤트 지우기" → 부분 `발송함` (`check-replay.test.ts`) | 부분 `범위 seq`(같은 seq) + 새 사례 "범위 행의 seq만 바꾸기/줄이기" | AC-S05-60 — 범위 seq 대조가 먼저 잡는다(더 엄격) |
| `ScopeWriter.write({...})` 시험 작업 (`inherit-restart.test.ts`) | `rehearsal: false` 더함 | 기록 작업에 범위의 리허설인지가 필수 |
| 코어 러너 자체 시험 합계 (`packages/core/test/golden/core-adapter.test.ts`) | 파일 20 · 엔진 114 · 통과 493, 이름의 AC 번호 AC-S05-90 | AC-S05-90 (골든 G-ENG-167·168이 늘어서 하는 교체) |

### 화면(dev-web)에게 — API 계약 (AC-S05-53)
S04 계약(`harness/sprints/S04/dev-notes.md` "웹(S05)에게")은 그대로이고, 아래가 더해지거나 바뀌었다.

- **범위 = (날짜, 리허설인지)**
  - 날짜로 범위를 고르는 경로는 `?rehearsal=true`를 적어야 리허설 범위, 적지 않거나 `rehearsal=false`면 실제 범위. 다른 값은 400 `INVALID_INPUT`(`field: 'rehearsal'`).
  - `b`가 있는 이벤트 쓰기는 그 방송의 범위로 간다 — `?rehearsal=`·`?date=`를 적으면 400.
  - 응답의 범위 표시: 쓰기 결과·범위 조회·증분·메시지·이력 모두 `date`와 `rehearsal`.
- **방송**
  | 메서드·경로 | 요청 | 응답 200 |
  |---|---|---|
  | `POST /api/broadcasts` | `{ requestId, date?, title?, rehearsal?: boolean }` (기본 실제) | 쓰기 결과 + `broadcast: { id, date, title, rehearsal }` |
  | `GET /api/broadcasts` | — | `{ broadcasts: [{ id, date, title, rehearsal, ended, endedAt }] }` (날짜 오름차순, 같은 날은 실제 먼저·선언 순 — 화면이 최근 순으로 정렬) |
  - 리허설 방송은 실제와 범위가 따로라 같은 날 둘 다 `seq 1`부터, 기본 제목도 각각 `1부`.
  - 방송의 설정 스냅샷은 범위 조회 `broadcasts[].settings`(18개 키: `price.unit`·`claim.maxNumber`·`claim.preOpenWindowSec`·`cancel.succession`·`print.autoOnConfirm`…).
- **쓰기 결과** (모든 쓰기 공통): `{ date, rehearsal, seq, type, changed, effects }` (+ 방송 만들기 `broadcast`, 문자찜 `phoneLast4`, 시청자로 보내기 `message: { id, channel }`).
- **화면 설정** `GET /api/client-config` → `{ hostActionDelayMs }` (운영 5000, E2E 기동에서만 줄인다). 세션 필요.
- **범위 목록** `GET /api/days[?rehearsal=true]` → `{ days: [{ date, rehearsal, seq }] }` (적지 않으면 실제 범위만, `rehearsal=true`면 리허설 범위만, 이벤트가 있는 범위, 날짜 순).
- **범위 전체 조회** `GET /api/days/:date[?rehearsal=true]` → `{ date, rehearsal, seq, broadcasts, products, claims, pending, buyers, settlements, effects, cancelRequests, attention }` (S04와 같음 + `rehearsal`). 처음 열 때·`RESYNC_REQUIRED` 때만 쓴다.
- **증분 조회** `GET /api/days/:date/changes?since=N[&rehearsal=true]`
  - 200: `{ date, rehearsal, since, seq, broadcasts, products, claims, pending, buyers, settlements, effects, cancelRequests, attention, removed, messages, messagesMore }`
    - 각 목록 = since와 지금 사이에 값이 달라진 항목(새로 생긴 것 포함, 값이 같은 항목은 없다). 항목 모양은 전체 조회와 같다.
    - 항목 키: `broadcasts` id · `products` key(`<방송>/<번호>`) · `claims` id · `pending` product · `buyers` id · `settlements` (buyer, date) · `effects` id · `cancelRequests` claim.
    - `removed`: `{ broadcasts, products, claims, pending, buyers, effects, cancelRequests: [키…], settlements: [{ buyer, date }…] }` — since에는 있었는데 지금은 없는 항목(번호 변경의 이전 번호, 풀린 보류, 처리된 취소 요청, 합친 구매자의 정산 묶음 등).
    - `attention`: since 뒤에 생긴 확인 필요 항목(덧붙이기만 한다).
    - **덮으면 같다**: since의 전체 조회 결과에 목록마다 키로 덮고 `removed`의 키를 지우고 `attention`을 덧붙이면 지금(`seq`)의 전체 조회 결과와 같다(목록 순서는 화면이 정한다 — 전체 조회의 순서는 코어 조회 함수 순서).
    - `messages`: since 뒤의 새 채팅 메시지(seq 순, 최대 200개) + since 이전 메시지 중 기록이 바뀐 것(메시지 변환으로 `converted`·`claims`가 늘었다). 메시지 항목 모양은 아래 메시지 조회와 같다. 방송·메시지 ID(또는 seq)로 덮는다. `messagesMore: true`면 나머지는 `/messages?after=<마지막 메시지 seq>`.
  - 410 `RESYNC_REQUIRED` "바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요." — since가 지금보다 크거나 서버가 둔 기준점(최근 1000 seq) 밖. 전체 조회를 다시 한다.
  - 400 since 없음·형식 틀림, 404 없는 범위.
  - 권장 흐름: 전체 조회로 `seq`를 알고 → SSE `change`(그 범위, 알고 있는 seq보다 큼)를 받으면 `changes?since=<알고 있는 seq>` 한 번 → 응답 `seq`로 갱신. 요청이 진행 중일 때 온 알림은 모아서 끝난 뒤 한 번 더(알림마다 요청을 겹쳐 보내지 않는다).
- **메시지 조회** `GET /api/days/:date/messages[?rehearsal=true][&b=<방송>][&after=N | &before=N][&limit=1~500(기본 100)]`
  - after: 그 seq 뒤 limit개 · before: 그 seq 앞의 가장 최근 limit개 · 둘 다 없으면 가장 최근 limit개. 늘 seq 오름차순. after·before를 같이 쓰면 400.
  - 200: `{ date, rehearsal, seq, messages: [...], more }` — `seq`는 이 조회가 본 범위 seq, `more`는 그 방향(after면 뒤, 아니면 앞)으로 더 있는지. "이전 메시지 보기" = `before=<가장 오래된 메시지 seq>`.
  - 메시지 항목: `{ id, broadcast, channel, nick, text, owner, seq, at, publishedAt, ignored, order, cancel, orders, cancels, mentions, converted, claims, failed }`
    - `at` 서버 도착 시각, `publishedAt` 게시 시각(없었으면 도착 시각) — UTC ISO. 화면은 KST로 보인다.
    - `owner` 방송자 본인 메시지, `ignored` 무시한 방송자 메시지, `order`·`cancel` 주문·취소였던 메시지(엔진 기록), `orders`·`cancels` 그 번호(주문·취소였을 때만), `mentions` 언급 번호(`parseChat` — 주문인 메시지는 언급이 비어 있다), `converted` 이미 찜으로 바꾼 번호, `claims` 그 메시지로 생긴 찜 ID(채팅 찜·메시지 변환 찜 — 지금 상태는 범위 조회의 `claims`에서), `failed` 엔진이 처리하지 못한 입력(확인 필요).
    - **"찜으로 바꾸기" 버튼**: `!order && !cancel && !ignored`인 메시지에만(D-076). `converted`의 번호는 "바꿈"으로 고를 수 없게.
  - `b`가 그 범위의 방송이 아니면 404(리허설 방송은 `rehearsal=true`를 적어야 보인다). 본문·닉네임은 신뢰할 수 없는 글이다 — 글자로만 보인다.
- **이력(조치 기록)** `GET /api/days/:date/history?after=0&limit=100[&rehearsal=true][&b=<방송>&no=<번호>]`
  - `b`·`no`를 함께 주면 그 방송·번호를 대상으로 한 `product.*`·`host.*` 이벤트만(번호 변경은 이전·새 번호 모두), seq 순. 한쪽만·번호가 1 미만이면 400. 응답 `{ date, rehearsal, events }`, 항목 모양은 S04 이력과 같다(`actor.kind` account·server·collector → 화면 낱말 로그인 아이디·서버·수집기). 맞지 않아 아무 일도 없었던 조치도 기록에 있다.
- **리허설 가짜 채팅 생성기** (리허설 방송만 — 실제 방송·다른 판매자·없는 방송은 404이고 아무것도 기록하지 않는다)
  | 메서드·경로 | 요청 | 응답 200 |
  |---|---|---|
  | `POST /api/broadcasts/:id/rehearsal/generator/start` | `{ total?: 1~10000(기본 300), perSecond?: 1~50(기본 1), seed?: 0~2147483647, requestId? }` | `{ generator: 상태 }` |
  | `POST /api/broadcasts/:id/rehearsal/generator/stop` | `{}` | `{ generator: 상태 }` (보내던 메시지가 끝난 뒤 응답, 돌고 있지 않으면 그대로) |
  | `GET /api/broadcasts/:id/rehearsal/generator` | — | `{ generator: 상태 }` |
  - 상태: `{ b, running, sent, total, perSecond, seed, duplicates, failed, stopReason }` — `sent`는 다시 보낸 사본 포함 보낸 수, `duplicates` 다시 보낸 사본 수(기록되지 않음), `failed` 저장하지 못한 수, `stopReason`: `completed`(다 보냄) · `stopped`(멈춤 요청) · `ended`(방송 끝냄) · `shutdown`(서버 종료) · `null`(돌고 있음·시작한 적 없음). 화면 낱말 예: "다 보냈어요" · "멈췄어요" · "방송을 끝내서 멈췄어요" · "서버가 다시 시작해서 멈췄어요".
  - 시작한 적 없으면 `{ running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null }`. 서버를 다시 시작하면 이 상태로 돌아간다(이어서 하지 않는다).
  - 첫 메시지는 시작하자마자 보내고, 그 뒤 `1000/perSecond`ms 간격.
  - 오류: 400 `INVALID_INPUT`(`problems[].field` = total·perSecond·seed·requestId, 문장 "총 개수는 1부터 10,000까지의 정수로 적어 주세요." · "초당 개수는 1부터 50까지의 정수로 적어 주세요." · "시드는 0부터 2,147,483,647까지의 정수로 적어 주세요."), 400 `UNKNOWN_FIELD`, 409 `GENERATOR_RUNNING` "이미 가짜 채팅을 보내는 중이에요. 멈춘 뒤 다시 시작해 주세요.", 409 `BROADCAST_ENDED` "끝난 방송이라 가짜 채팅을 보낼 수 없어요.". 같은 `requestId`로 다시 보낸 시작은 그 생성기 상태 200.
  - 다른 기기의 시작·멈춤·진행은 SSE `generator` 알림으로 온다(아래).
- **시청자로 보내기** `POST /api/broadcasts/:id/rehearsal/chat` `{ requestId, nick (1~30자), text (1~200자), channel? }` → 쓰기 결과 + `message: { id, channel }`
  - 서버가 메시지 ID(`simv-…`)를 만들고 수집기 경로로 기록한다(이력 조치자 `collector`). 주문·언급 판정은 다른 채팅과 같다.
  - `channel`: 없으면 닉네임마다 같은 가짜 채널, `"new"`면 새 가짜 채널, 생성기가 쓴 채널(`sim_…`)이면 그 채널. 그 밖은 400(`field: 'channel'`).
  - 같은 `requestId`는 한 번만 기록하고 처음 결과를 돌려준다. 400 문장: "닉네임은 1~30자로 적어 주세요." · "채팅은 1~200자로 적어 주세요." · "채널은 가짜 채널(sim_로 시작)이나 'new'로 골라 주세요.".
- **SSE `GET /api/stream`**
  ```
  event: ready
  data: {"scopes":[{"date":"2026-10-19","rehearsal":false,"seq":12},{"date":"2026-10-19","rehearsal":true,"seq":40}]}

  id: 1
  event: change
  data: {"date":"2026-10-19","rehearsal":true,"seq":41,"type":"chat"}

  event: generator
  data: {"date":"2026-10-19","rehearsal":true,"b":"b_…","running":true,"sent":3,"total":1000,"perSecond":10,"seed":42,"duplicates":0,"failed":0,"stopReason":null}
  ```
  - `ready`의 범위 목록은 실제·리허설 모두. 알림의 범위 = (date, rehearsal) — 보는 콘솔의 범위와 둘 다 같은 알림만 쓴다. ready seq 이하 알림을 서버가 거르는 규칙(S04)은 범위마다.
  - `generator` 알림은 기록이 아니라 seq·id가 없다. 시작·메시지마다·멈춤에 온다.
- **새 오류 코드**: 410 `RESYNC_REQUIRED`, 409 `GENERATOR_RUNNING`, 409 `BROADCAST_ENDED`. 그 밖은 S04 표 그대로.

### E2E용 서버 기동 (AC-S05-91) — test-e2e·dev-web
- 명령: `pnpm --filter @livejjim/server e2e [--port 3100] [--origin http://localhost:5173] [--fill yes] [--fill-products 500] [--fill-chats 10000] [--host-delay-ms 5000] [--chat-speed 1]`
  - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 마스터 키. 끄면(SIGINT·SIGTERM) 데이터는 사라진다. `.env`를 읽지 않는다. 환경변수 `PORT`·`LIVEJJIM_APP_ORIGIN`도 읽는다(인자가 우선). `--port 0`이면 빈 포트.
  - 시험 계정: `apps/server/e2e/account.json` (`loginId` `e2e-shop`, `password` `e2e-pass-1234`, 가게 이름 `시험 가게`) — 저장소의 시험 값이다.
  - `--fill yes`: 오늘(KST) 실제 범위에 방송 "채운 방송" 하나, 상품 1~N(`상품<n>`, 판매 중), 채팅(생성기 메시지, 시드 20261019, 조치자 수집기)을 채운 뒤에 포트를 연다(상품 500·채팅 1만 건 약 3초). AC-S05-64용.
  - `--host-delay-ms`: `GET /api/client-config`의 `hostActionDelayMs`(운영 5000). E2E에서 5초 대기를 줄일 때.
  - `--chat-speed`: 리허설 생성기 간격을 나누는 값(1~1000) — 예: `--chat-speed 20`이면 초당 50 설정이 초당 1,000.
  - 포트를 열면 표준 출력에 `E2E 서버를 시작했어요. http://localhost:<포트> · …` 한 줄(Playwright `webServer`가 이 줄이나 `GET /api/health`로 기다리면 된다). 비밀번호·마스터 키는 출력하지 않는다.
  - CORS를 내지 않으므로 화면은 같은 출처(Vite 프록시 `/api` → 이 서버)로 띄우고 `--origin`을 화면 주소로 준다.
- 프로그램: `startE2eServer({ appOrigin?, fill?, hostActionDelayMs?, generatorSpeed?, passwordCost? })` → `{ server, database, account, sellerId, fill, http, close() }`, `fillScope(server, sellerId, { date?, products?, chats?, seed? })`.
- **이력으로 코어 재생하기** (리허설 끝까지 E2E): `GET /api/days/:date/history?rehearsal=true&after=…&limit=500`을 끝까지 받아 이벤트마다 `{ type, seq, at: Date.parse(at), ...fields, ...(reason === null ? {} : { reason }) }`를 `initEngine({ broadcasts: [], settings: {} })`부터 `applyEvent`로 차례로 적용한다(`failed: true` 행은 건너뛴다 — 서버 재생과 같다). 이력은 문자찜의 `phoneKey`를 빼고 주므로(S04 개인정보), 같은 전화번호 문자찜을 쓴 시험이면 문자 구매자가 하나로 묶이지 않아 다르게 재생된다 — 리허설 E2E에서는 문자찜을 쓰지 않거나 전화번호 없이 쓴다. 정산 묶음 비교는 범위 조회 `settlements`(구매자별 `total`)와 코어 `listSettlements`.

### 시험용 기동과 주입점 (test-domain·다음 개발자)
- S04 주입점은 그대로. 더한 것: `createServer({ changesWindow, generatorTimer, generatorSpeed, hostActionDelayMs })`.
  - `generatorTimer: { schedule(ms, fn): () => void }` — 시험은 `setImmediate` 타이머(기다리지 않음)나 손으로 돌리는 타이머를 넣는다(`apps/server/test/support.ts`의 `immediateTimer`·`manualTimer`). 시계는 기존 `clock`.
  - `changesWindow`(기본 1000): 증분 조회 기준점 수 — 작게 하면 410을 쉽게 만든다.
- 범위 상태: `server.writer.read(sellerId, date, rehearsal = false)` — 세 번째 인자를 적지 않으면 실제 범위.
- 생성기: `server.service.generators.status(sellerId, b)`·`.running`(도는 수). 순수 메시지 만들기 `new ChatMaker(b, seed, startSeq).next(generatorView(state, b))`.
- 기록 작업을 직접 쓸 때 `writer.write({ ..., rehearsal: boolean })`가 필수다.
- DB 확인: `scopes.rehearsal`·`scopes.seq`, `outbox.rehearsal`. `checkReplay(db, { sellerId?, date?, rehearsal? })`, 결과에 `rehearsal`, 불일치 부분에 `범위 seq`.
- `@livejjim/server`에서 내보내는 것: `ChatMaker`·`SeededRandom`·`generatorView`·`ChatGenerators`·생성기 상수, `VIEW_LISTS`, `startE2eServer`·`fillScope`·`readE2eAccount`, `HOST_ACTION_DELAY_MS`, `CHANGES_MESSAGES_LIMIT`·`MESSAGES_LIMIT_MAX`·`FAKE_CHANNEL_RE`, `scopeKey`.

### 시험 (내 영역)
- 새 서버 시험: `rehearsal.test.ts`(범위 분리·배송비 스냅샷·발송함 표시·이어받기·알림·검사 명령·격리), `scope-seq.test.ts`(실패 표시·이어받기·롤백·두 인스턴스·ready/목록이 범위 행을 읽음·마이그레이션 채움), `changes.test.ts`(무작위 이벤트 순서 25회 "덮으면 같다" + 값이 같은 항목 없음, 410, 재시작, 리허설, 메시지 갱신, 새 메시지 200개 상한, 상품 500·채팅 1만 건 크기·p99), `chat-messages.test.ts`(무작위 채팅 로그 = listMessages·parseChat, 모양, 이어 받기, b·리허설, 실패 표시, 상품별 조치 기록), `generator.test.ts`(1,000건·재현·순수성·404·400·409·간격·멈춤·끝냄·다른 인스턴스·종료·저장 실패·seq·SSE·시청자로 보내기), `e2e.test.ts`(프로그램·명령), `inherit-restart.test.ts` "서버 소스에 blocked.root 없음".
- "덮으면 같다" 시험은 일부러 구현을 틀리게(바뀐 값 빠뜨림·사라진 키 빠뜨림) 바꾸면 실패하는 것을 확인했다.
- 이 PC 측정(상품 500·채팅 1만 건): 증분 조회 응답 p99 수십 ms(시험 기준 300ms), 전체 조회 약 60ms·2.8MB.

### spec-keeper에게 (규칙 문장대로 만들었지만 확인이 필요한 것)
1. **`GET /api/days`의 기본이 실제 범위만**이다(리허설은 `?rehearsal=true`). AC-S05-50 "날짜로 범위를 고르는 모든 조회"를 목록에도 같은 원칙으로 적용했다 — 목록에 둘 다 섞어 주는 쪽을 원하면 알려 달라.
2. **증분 조회 응답에 새 메시지(최대 200개)를 함께 담았다**(D-085 첫 문장). AC-S05-61 "채팅 메시지는 AC-S05-20의 이어 받기로"와 함께 쓸 수 있게 메시지 조회 API도 그대로 있다.
3. **생성기의 "보낸 수"·"총 개수"는 다시 보낸 사본을 포함**한다(사본도 보낸 메시지다). 기록된 메시지 수 = 보낸 수 − 사본 − 실패.

### 남의 몫 (test-domain·dev-web)
- 계약이 바뀌어 고쳐야 할 기존 적대 시험은 없었다(S04 적대 시험 81개가 그대로 통과 — `s04/**`, `s00/server.test.ts`).
- E2E 단계를 `pnpm verify`에 넣는 일은 오케스트레이터 몫(D-027). E2E 서버 명령은 위에 있다.
