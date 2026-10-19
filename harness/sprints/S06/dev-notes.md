# S06 개발 노트

## dev-server

### 바뀐 계약 (화면·E2E가 먼저 알아야 할 것)
S04·S05 계약(`harness/sprints/S04/dev-notes.md` "웹(S05)에게", `harness/sprints/S05/dev-notes.md` "화면(dev-web)에게")은 그대로이고, 아래만 더해지거나 바뀐다.

1. **이력 조회 상품 ID 거르기 (AC-S06-70, D-095)**
   - `GET /api/days/:date/history?product=<상품 ID>[&rehearsal=true][&after=N][&limit=1~500(기본 100)]`
   - 상품 ID = 범위 조회 `products[].id`(코어 `listProducts`의 `id`, 번호를 바꿔도 같다).
   - 응답 모양은 기존 이력 조회와 같다: `{ date, rehearsal, events: [{ seq, type, at, receivedAt, actor, reason, fields, failed }] }` (`phoneKey` 없음). `after`·`limit`도 같다(다음 쪽은 `after=<마지막 seq>`).
   - 담는 것: 그 상품을 대상으로 한 `product.*`·`host.*` 이벤트(방송 `b`와 번호 `no`가 있는 것, 번호 변경은 `from`), `seq` 순. 이벤트마다 **그때 그 번호에 있던 상품**으로 돌린다.
     - 번호 변경(`product.renumber`)은 바뀐 상품(그때 `from`에 있던 상품)의 기록에 들어간다 — 화면은 `fields.from`·`fields.to`로 "15번 → 16번".
     - 번호 변경 뒤 같은 번호에 새로 등록한 상품의 기록에는 옛 상품의 이벤트가 없다.
     - 그 번호에 상품이 없을 때의 조치(보류 찜 취소 등)는 그 뒤 그 번호에 처음 생긴 상품(등록 또는 번호 변경으로 들어온 상품)의 기록에 들어간다.
     - `product.register`는 그 등록 뒤 그 번호에 있는 상품(새로 만든 상품, 이미 있었으면 그 상품)의 기록.
   - `product`와 `b`·`no`를 함께 적으면 400(`field: 'product'`). 상품 ID 형식(영문·숫자·`_`·`-` 1~64자)이 아니면 400.
   - 그 범위에 없는 상품 ID(다른 판매자의 상품 ID 포함 — 범위는 판매자마다 따로다)는 200 빈 목록 `events: []`(있는지 알리지 않는다). 없는 범위는 404(기존과 같다).
   - 기존 `b`·`no` 거르기(AC-S05-35)는 계약 그대로 둔다(번호 기준 — 상품 자세히는 `product`를 쓴다).
2. **리허설 생성기 판매자당 하나 (AC-S06-71, D-096)**
   - 판매자마다 동시에 하나(모든 리허설 방송을 통틀어). 다른 리허설 방송에서 돌고 있으면 `POST /api/broadcasts/:id/rehearsal/generator/start`는
     409 `{ broadcast: "<돌고 있는 방송 ID>", error: { code: 'GENERATOR_RUNNING_ELSEWHERE', message: '다른 리허설 방송에서 가짜 채팅이 돌고 있어요. 그 방송에서 먼저 멈춰 주세요.' } }`이고 아무것도 시작하지 않는다.
   - 같은 방송에서 이미 돌고 있으면 409 `GENERATOR_RUNNING`, 같은 요청 번호 재전송은 그 상태 200 — S05 그대로.
   - 끝난 실행 기록은 방송마다 마지막 하나, 판매자마다 최대 20개(가장 먼저 끝난 것부터 지움). 지워진 방송의 상태 조회는 서버를 다시 시작한 뒤와 같다(`running: false, sent: 0, total: 0, stopReason: null`).
3. **리허설 방송 기본 제목 (AC-S06-66 014)**: 제목을 비우고 리허설 방송을 만들면 "리허설 N"(N = 그 날짜의 리허설 방송 수 + 1). 실제 방송의 "N부"는 실제 방송만 센다(S05와 같음).
4. **E2E 서버 기동 (AC-S06-73, D-096)**: `pnpm --filter @livejjim/server e2e ...`는 `127.0.0.1`에서만 연다(모든 인터페이스가 아니다). 시작 줄은 `E2E 서버를 시작했어요. http://127.0.0.1:<포트> · …`. 헬스체크·프록시 대상은 `http://127.0.0.1:<포트>`로 적는 것이 안전하다(`localhost`가 `::1`을 먼저 고르는 환경). 운영 서버(`main.ts`)의 듣는 주소는 바꾸지 않았다.
5. **문자찜 쓰기 계약 (AC-S06-16)**: 바뀌지 않았다(S04 그대로 확인 시험만 더함).

### 만든 것
- **이력 조회 상품 ID 거르기 (AC-S06-70, D-095)** — `src/product-history.ts`(`productOwners`) + `Service.history(..., { product })` + `GET /api/days/:date/history?product=`.
  - 범위 상태를 먼저 잡고(쓰기와 같이 쓰는 객체라 `state`·`seq`를 잡아 둔다) 코어 `listProducts`의 지금 번호(상품 ID → 방송·번호)에서 시작해, `after` 뒤의 `product.*`·`host.*` 행(그 seq까지만)을 뒤에서 앞으로 보며 **번호를 바꾸는 두 이벤트의 기록된 결과(`changed`)만 되돌린다**: 상태를 바꾼 `product.register` = 그 번호에 상품이 새로 생김, 상태를 바꾼 `product.renumber` = from의 상품이 to로 옮겨 감. 판정은 다시 하지 않는다(엔진이 낸 `changed`와 코어 조회 결과만 쓴다). 상품 기록을 만들거나 옮기는 이벤트는 이 둘뿐이다(코어 reducer 확인 — 상품은 지워지지 않는다).
  - 비용은 그 범위의 조치 이벤트 수에 비례한다(채팅 1만 건은 읽지 않는다). 조치 행은 1,000개씩 읽는다.
  - 저장소: `HistoryRow.changed` 칸을 더하고 `actionRows(..., upTo?)`로 조회가 잡은 seq까지만 읽는다.
- **리허설 생성기 판매자당 하나 (AC-S06-71, D-096)** — `ChatGenerators`가 판매자 → (방송 → 마지막 실행) 맵을 둔다. 시작 확인과 자리 잡기 사이에 기다림이 없어 동시에 두 방송에서 시작해도 하나만 돈다. 멈출 때마다(다 보냄·멈춤·끝냄·서버 종료) 멈춘 차례를 매기고 그 판매자의 끝난 기록이 20개를 넘으면 가장 먼저 끝난 것부터 지운다. 돌고 있는 실행은 지우지 않는다. 시험용 `generators.records(sellerId?)`(남은 기록 수, 돌고 있는 것 포함).
- **보기 캐시는 범위별 (AC-S06-72, D-096)** — `src/state-cache.ts`(`StateCache`, 새로 계산한 횟수 `builds`)를 범위 실행 상태 `ScopeRuntime.views = { index (8), messages (4) }`에 둔다. 모듈 단위로 모두가 함께 쓰던 `indexCache`·`messageCache`를 없앴다. 범위 상태가 writer의 상한·`forget`으로 내려가면 캐시도 함께 사라진다(다시 불러온 상태는 빈 캐시). `messageLookup(runtime, state)`로 서명이 바뀌었다.
- **E2E 서버 127.0.0.1 (AC-S06-73, D-096)** — `E2E_HOST`, `startE2eServer().listen(port)`(열지 못하면 그 오류로 실패). 기동 명령은 이것만 쓴다.
- **리허설 기본 제목 "리허설 N" (AC-S06-66 014)** — 범위가 (날짜, 리허설인지)라 그 범위의 방송 수 + 1이 곧 그 날짜의 리허설 방송 수 + 1이다.
- **문자찜 쓰기 계약 확인 (AC-S06-16)** — 코드 변경 없음, `test/sms-contract.test.ts`.
- **코어 러너 자체 시험 합계 교체 (AC-S06-95)** — `packages/core/test/golden/core-adapter.test.ts` 파일 21 · 파서 379 · 엔진 119 · 통과 498(이름의 AC 번호 AC-S06-95). 그 밖의 골든·러너·허용 목록은 손대지 않았다.

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **상품 ID 거르기의 번호 ↔ 상품은 "지금 상태에서 뒤로 되짚기"로 정한다.** 처음부터 코어로 재생하면 확실하지만 조치 기록을 열 때마다 채팅 1만 건을 다시 적용하게 된다. 되짚기는 엔진이 기록한 결과(`changed`)와 `listProducts`만 쓰므로 판정 복제가 아니고, 무작위 순서 시험(25회)에서 코어 재생으로 센 정답과 같다(일부러 "처음 생긴 상품" 규칙을 빼면 그 시험이 실패하는 것도 확인했다).
- **맞지 않은 번호 변경(받는 번호에 이미 상품)은 from의 상품 기록에**, **이미 있는 번호의 등록은 그 상품 기록에** 넣는다 — 판매자가 그 상품을 두고 한 조치이므로. 상품이 끝내 생기지 않은 번호의 조치는 어느 상품에도 넣지 않는다(방송·번호 거르기로는 보인다).
- **그 범위에 없는 상품 ID는 200 빈 목록**(AC "404 또는 빈 목록"). 범위가 없으면 404는 기존과 같다. 상품 ID는 범위마다 따로 매겨지므로(코어 `p1`…) 다른 판매자·다른 범위의 같은 ID는 그 범위의 상품을 가리킨다 — 범위는 판매자마다 따로라 남의 기록이 섞이지 않는다.
- **409 `GENERATOR_RUNNING_ELSEWHERE`에 돌고 있는 방송 ID(`broadcast`)를 함께 준다** — 화면이 "그 방송에서 먼저 멈춰 주세요"에 그 방송으로 가는 길을 붙일 수 있게. 그 판매자 자신의 방송이라 숨길 것이 없다.
- **같은 방송에서 이미 돌면 `GENERATOR_RUNNING`이 먼저**(S05 그대로), 그다음 다른 방송 확인.
- **끝난 기록의 "오래된 것" = 먼저 멈춘 것**(시작한 차례가 아니다). 같은 방송을 다시 돌리면 그 방송의 앞 기록은 새 실행으로 바뀐다(방송마다 마지막 하나).
- **서버 종료로 멈춘 실행도 끝난 기록**이다(같은 프로세스 안에서만 보인다 — 다시 시작하면 메모리에 없다).
- **메시지 기록 캐시(최근 4개)도 범위에 묶었다** — 같은 이유(판매자 간 공유 제거)로. AC가 적은 "보기 계산 캐시"와 같은 성격이다.
- **E2E 시작 줄의 주소를 `http://127.0.0.1:<포트>`로 바꿨다.** `localhost`로 부르는 기존 설정(Playwright 헬스체크·Vite 프록시)도 Node가 `::1` 다음 `127.0.0.1`을 시도해 닿는 것을 이 PC에서 확인했다(`http.get`·`fetch` 200). 그래도 화면 쪽 설정은 `127.0.0.1`로 적는 편이 안전하다(아래 화면에게).

### 바꾼 기존 테스트 (약화 아님 — 계약이 바뀌었다)
| 원래 (파일) | 바뀐 뒤 | 근거 |
|---|---|---|
| 리허설 방송 기본 제목 `1부` (`rehearsal.test.ts` "리허설 여부를 받고…") | `리허설 1` | AC-S06-66 014 |
| "동시에 둘": b가 도는 중에 다른 방송 b2를 시작해 둘 다 돎(`running` 2) (`generator.test.ts` "이미 도는 방송에 다시 시작하면 409…") | b를 멈춘 뒤 b2에 동시에 두 번 시작 → 200·409 `GENERATOR_RUNNING`, `running` 1. 다른 방송 동시 실행 막힘은 새 시험 | AC-S06-71 (판매자당 하나) |
| E2E 명령 시작 줄 `http://localhost:<포트>` (`e2e.test.ts`) | `http://127.0.0.1:<포트>` | AC-S06-73 |
| 코어 러너 자체 시험 합계 (`packages/core/test/golden/core-adapter.test.ts`) | 파일 21 · 엔진 119 · 통과 498, 이름의 AC 번호 AC-S06-95 | AC-S06-95 (골든 G-ENG-169~173이 늘어서 하는 교체) |

### 시험 (내 영역)
- 새 서버 시험: `product-history.test.ts`(15 → 16 뒤 새 15, 맞지 않은 번호 변경·등록, 1 → 2 → 1, 범위·판매자·400·404, 조치 1,000개 넘게, 무작위 순서 = 코어 재생 정답·쪽 나누기), `view-cache.test.ts`(두 판매자 번갈아 조회 계산 횟수, 날짜·리허설 범위마다 따로, 증분·메시지 캐시, 내려간 범위의 캐시, 모듈 캐시 없음 코드 검사), `sms-contract.test.ts`(시간대 넷에서 비운 받은 시각, 받는 형식 표, 응답 모양·재전송, 지정 구매자, 리허설·404), `generator.test.ts`의 AC-S06-71 묶음(다른 방송·다른 날짜 409·다른 판매자 영향 없음, 동시 시작, 다 보냄·끝냄 뒤 시작, 기록 20개·21번째·같은 방송 다시, 끝냄·종료도 기록), `rehearsal.test.ts`의 AC-S06-66 기본 제목, `e2e.test.ts`의 AC-S06-73 묶음(듣는 주소 127.0.0.1/IPv4, 다른 주소·::1로 닿지 않음, 포트 겹침, 코드 검사).
- 서버 시험 전체 31파일 338개 통과(`TZ=Pacific/Honolulu`).

### 화면(dev-web)에게 — 쓸 것
- **상품 자세히 조치 기록**: `GET /api/days/:date/history?product=<products[].id>[&rehearsal=true]` (번호 변경 이벤트는 `fields.from`·`fields.to` → "15번 → 16번"). 기존 `b`·`no` 대신 이것을 쓴다(AC-S06-70 [web]).
- **리허설 조작판 409**: `GENERATOR_RUNNING_ELSEWHERE`면 `error.message`를 그대로 보이고, 본문 `broadcast`(돌고 있는 방송 ID)로 그 방송 콘솔(`/broadcasts/<ID>`)로 가는 길을 붙일 수 있다(AC-S06-71 [web]).
- **리허설 방송 만들기**: 제목을 비우면 서버가 "리허설 N"을 붙인다(화면이 따로 만들 필요 없음).
- **문자찜**(바뀌지 않음): `POST /api/events` `{ requestId, type: 'sms', b, no, received?, phone?, memo?, buyer? }` → `{ date, rehearsal, seq, type, changed, effects, phoneLast4 }`. `received`를 보내지 않으면 서버가 도착 시각 KST `HH:MM:SS`. 보낼 때는 `HH:MM`·`HH:MM:SS`만(그 밖 400 `field: 'received'`). 결과 카드의 찜 = 범위 조회 `claims`에서 `seq`가 응답 `seq`와 같은 찜(`origin: 'sms'`). 찜이 생기지 않았으면 그런 찜이 없다(`changed`가 true여도 — 구매자·메모만 바뀐 경우). 지정 구매자 문자찜의 구매자 = `buyer`, 그 밖은 범위 조회의 `claims[].buyer`(`sms:<ref>` 또는 전화번호로 이은 구매자).
- **구매자·정산 화면 재료**(바뀌지 않음): 범위 조회 `buyers`(코어 `listBuyers` — `id, kind('youtube'|'sms'), current, mergedInto, merged, display, nameHistory, phoneLast4, items, subtotal, byBroadcast, blocked`), `settlements`(코어 `listSettlements` — `buyer, date, items, subtotal, shipping, shippingOverride, adjustments, total, received, refundDue, payment, records[{ kind, buyer, amount, mode, reason, memo, seq, at(ISO) }]`), `claims[].origin`(`'chat'|'sms'|'assign'|'convert'`). 쓰기: `buyer.merge { from, into, reason }`·`buyer.unmerge { from, reason }`·`settlement.payment { buyer, date, amount, memo? }`·`settlement.refund { buyer, date, amount, reason }`·`settlement.adjust { buyer, date, amount, reason }`·`settlement.shippingOverride { buyer, date, mode, amount? }` — 모두 `POST /api/events?date=<날짜>[&rehearsal=true]`이고 본문 `date`는 그 날짜와 같아야 한다(S04 계약).
- **E2E 설정 (AC-S06-73 [web])**: 서버는 이제 127.0.0.1에서만 연다. `apps/web/playwright.config.ts`의 서버 헬스체크 `url`과 `apps/web/e2e/serve.ts`의 `--api`를 `http://127.0.0.1:<포트>`로, 화면 미리 보기도 `host: '127.0.0.1'`로 바꾸길 권한다. 화면 주소를 바꾸면 서버 `--origin`(상태를 바꾸는 요청의 Origin 검사)도 브라우저가 여는 주소와 똑같이 맞춘다(예 `baseURL http://127.0.0.1:5173` ↔ `--origin http://127.0.0.1:5173`).

### 테스트(test-e2e)에게 — 기동·재생
- 기동: `pnpm --filter @livejjim/server e2e --port 3100 --origin http://localhost:5173 [--host-delay-ms 2000] [--chat-speed 20] [--fill yes]` → 127.0.0.1:3100. 시험 계정 `apps/server/e2e/account.json`.
- 생성기는 판매자마다 하나다: 한 시험이 시작한 생성기는 다 보내거나(`running: false`) 멈추거나(`POST .../rehearsal/generator/stop`) 그 방송을 끝낸 뒤에 다음 시험이 다른 리허설 방송에서 시작할 수 있다(같은 서버를 함께 쓰므로). S05 E2E는 모두 끝까지 기다리거나 방송을 끝내므로 그대로다.
- **1단계 끝까지 재생 (AC-S06-90)**: S05 방법(`harness/sprints/S05/dev-notes.md` "이력으로 코어 재생하기") 그대로에 문자찜 `phoneKey`만 채운다 — 이력 `sms` 이벤트의 `fields.phoneLast4`가 있으면 `phoneKey`를 시험이 넣은 번호마다 같은 값(예 `test-<뒤 4자리>`)으로 넣는다(시험의 번호는 뒤 4자리가 서로 다르게). 문자 구매자 ID는 `sms:<ref>`라(ref는 이력에 있다) 재생 결과의 구매자 ID가 서버와 같다.
- 상품 기준 조치 기록 확인은 `history?product=<id>`.

### 검증 (dev-server 끝)
- `pnpm verify` 7단계 모두 통과: typecheck(설정 8 · TS 250) · lint(오류 0 · 경고 0) · test(파일 78 · 1,865) · golden(파일 21 · 파서 379 · 엔진 119 · 통과 498, 그 밖 0) · adversarial(파일 30 · 642) · e2e(파일 12 · 67 통과, 실패·건너뜀·재시도 없음 — 서버가 127.0.0.1에서만 열린 채로 S05 E2E 그대로 통과) · coverage(코어 라인 100% · 분기 99.65%). `TZ=Pacific/Honolulu`.
- 그 뒤 프로그램 API 내보내기만 더한 커밋에서 typecheck·lint·test를 다시 돌려 통과.
- 남의 몫으로 남은 실패 없음. 화면(dev-web) 몫: AC-S06-70 [web](상품 자세히가 `?product=`를 쓰기), AC-S06-71 [web](409 문장), AC-S06-73 [web](`apps/web/e2e/serve.ts`·`playwright.config.ts`를 127.0.0.1로).
