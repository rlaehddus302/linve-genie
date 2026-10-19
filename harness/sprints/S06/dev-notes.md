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
