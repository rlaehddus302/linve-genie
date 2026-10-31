# PAY2 dev-notes

## server (dev-server)

### 웹이 쓰는 입구
- **공개 요금 안내**: `GET /api/pricing` — 로그인 없음(세션·쿠키·검색값을 보지 않는다, `Set-Cookie` 없음, `Cache-Control: no-store`). 요금 기능이 꺼져 있어도 경로는 있다.
  - 응답: `{ ready: boolean, items: { id, name, kind: 'FLAT_30D'|'DAYS'|'ORDERS'|'LABELS', quantity: number|null, price: number }[] }`
  - `ready` = 요금 기능 켜짐 + 요금 표가 자리 표시 아님. 아니면 `items: []`. `items`는 판매 중 항목만, 요금 표 순서.
- 기존 `/api/billing/**` 계약은 그대로다(응답 모양 변화 없음).

### 시험 설정 (e2e)
- 확정 요금 표: `startE2eServer({ billing: true, billingPrices: 'final' })` · 명령 `pnpm --filter @livejjim/server e2e --billing yes --billing-prices final`.
  표는 `TEST_FINAL_PRICE_TABLE`(apps/server/src/billing/fake.ts): 정액제 30일 29,000원(판매) · 방송 일권 1일 4,900원(판매) · 주문 건권 100건 9,900원(**판매 중 아님**) · 라벨 장권 100장 1,900원(판매). 기본(`placeholder`)은 지금 그대로 자리 표시 표 → `ready: false`.
- 자동 재확인 한 번 돌리기: `POST /api/billing/test/recheck` 본문 `{ requestId, laterMs? }` (시험 결제일 때만 있는 경로). 로그인한 판매자의 결제 대기 주문만, 서버 시계 + `laterMs`(0~8일, 기본 0)를 기준으로 칸을 정해 한 차례 돈다. 응답 `{ checked: n }`(조회까지 간 주문 수).
  AC-PAY2-15 (3): 주문 → `POST /api/billing/test/payments/:id {action:'PAID'}`(확인 요청 없이) → `POST /api/billing/test/recheck {laterMs: 60000}` → 요금 화면 "결제 완료".
- E2E 서버는 `server.start()`로 자동 재확인 차례(20초마다)도 돈다 — 실제 1분이 지나면 시험 경로 없이도 부여된다.

### 자동 재확인 (BL-6 9, D-PAY-08)
- 칸: 만든 시각 + 1분·5분·30분·3시간·24시간 (`RECHECK_SLOTS_MS`). 차례 `BillingRechecker`(src/billing/recheck.ts)가 서버 시작 때 한 번, 그 뒤 20초마다 `BillingService.recheckDue()`.
- 어디까지 했는지: `billing_orders.recheck_done`(0~5, 마이그레이션 `0029_pay2_billing_recheck.sql`). 칸은 조회 **전에** 조건부 UPDATE(상태 PENDING·쓴 칸 수 그대로)로 잡는다 → 조회가 실패해도 쓴 칸, 다시 켜도 두 번 하지 않음, 지난 칸 여럿은 한 번에(쓴 칸 수 = 지금까지 지난 칸 수).
- 판단·기록은 결제 확인과 같은 `#confirm`(조회는 락 밖, 적을 때만 판매자 요금 락). 자동 확인은 PENDING이 아니면 조회하지 않는다.
- 판매자마다 차례로(한 판매자의 주문은 하나씩), 판매자 여럿은 4개까지 함께.

### 운영자 목록 기준 바뀜 (AC-PAY2-16 — 기존 시험 고침)
- `operatorLists().stalePending` = **자동 재확인을 모두 마친(recheck_done = 5) PENDING 주문**. 옛 "만든 지 1시간 넘게"를 대체(`STALE_PENDING_MS`는 이제 24시간 — 표시용 상수).
- 고친 시험: `apps/server/test/billing-ops.test.ts` "목록: 확인 필요·…결제 대기…" — 1시간 넘긴 뒤 목록이 비어 있음을 확인하고, 24시간 칸까지 `recheckDue()`를 돌린 뒤 그 주문이 목록에 있음을 본다(기대값 [pending]은 그대로). 삭제·skip 없음.
- `billing-list` 출력 줄: "자동 재확인을 마친 결제 대기 n건 (…)".

- 고친 시험 2: `apps/server/test/i3-accounts.test.ts` 보조자 경로 전수 시험의 공개 경로 목록(PUBLIC)에 `GET /api/pricing`을 더함 — BL-12 1·2로 세션을 보지 않는 공개 입구라 보조자 쿠키여도 403이 아니라 같은 답이어야 한다. 다른 경로 기대값은 그대로.

- 고친 시험 3: `apps/server/test/fb1-parcel-settings.test.ts` 0019 다시 적용 시험의 되돌리기 목록에 0029(`billing_orders.recheck_done`) 되돌리기 한 줄 — 새 마이그레이션마다 더해 온 같은 방식.

### 포트원 시간 한도·멱등 키 (BL-6 10, D-PAY-09)
- 결제 조회 10초(`PORTONE_TIMEOUT_MS`), 결제 취소·현금영수증 발급·취소 60초(`PORTONE_MUTATE_TIMEOUT_MS`). 시간 한도는 setTimeout+AbortController(신호를 지키지 않는 fetch도 끊는다).
- `REFUND_HOLD_MS` = 2분.
- 머리말 `Idempotency-Key`: `idempotencyKey(kind, …)` = 접두어 + sha256 앞 40자(비밀값·사업자등록번호 없음).
  - 환불: `ljr-…` ← (판매자, 환불 요청 번호) · 금액 불일치 취소: `ljm-…` ← (판매자, 결제 ID) · 현금영수증 발급: `ljc-…` ← (판매자, 결제 ID, 증빙 요청 ID) · 현금영수증 취소: `ljx-…` ← (판매자, 결제 ID, 증빙 요청 ID — 증빙마다 취소 요청은 하나).
- `PaymentGateway.cancel(paymentId, reason, idempotencyKey?)` — 세 번째 인자는 선택(기존 감싸개 시험 호환).

### 포트원 현금영수증 어댑터 (BL-8 5, D-PAY-10) — 쓴 경로·필드
- `PortOneCashReceiptIssuer`(src/billing/cash-receipt.ts). 가짜 포트원(fake.ts)에 같은 모양.
  - 조회 `GET /payments/{paymentId}/cash-receipt?storeId=` → 200 `{ status: ISSUED|CANCELLED|ISSUE_FAILED, storeId, paymentId, type: CORPORATE|PERSONAL, issueNumber, … }`, 404 `{ type: 'CASH_RECEIPT_NOT_FOUND' }`.
  - 발급 `POST /cash-receipts` 본문 `{ storeId, paymentId, channelKey, type: 'CORPORATE', orderName, currency: 'KRW', amount: { total }, customer: { identityNumber } }` → 200 `{ cashReceipt: { issueNumber, … } }`.
  - 취소 `POST /payments/{paymentId}/cash-receipt/cancel` 본문 `{ storeId }` → 200.
- 판단: 조회 없음 → 발급 / ISSUED+CORPORATE(+같은 상점·결제, 승인 번호 형식) → 발행됨(그 번호) / 그 밖(소득공제·취소됨·발급 실패·모르는 상태·다른 상점·다른 결제·빈 본문·조회 실패) → 발행 실패, 발급 0. 발급 실패·시간 초과 → 발행 실패.
  취소: 조회 CANCELLED → 취소됨(요청 0) / ISSUED → 취소 요청 → 성공 취소됨 / 그 밖 → 취소 요청(운영자 목록).
- **금액 칸**: `amount.total`만 보낸다(공급가액·세액 칸 `vat` 등은 보내지 않음) — 세무 확인 대기(BL-8 5 6). 정해지면 cash-receipt.ts 발급 본문만 고치면 된다.
- 고르기: 환경변수 `LIVEJJIM_RECEIPT_ISSUER` = 비움·`none`(운영 기본, 없음) · `portone`(포트원 현금영수증, 포트원 상점 ID·채널 키·API 비밀값 필요) · 그 밖은 기동 거부. 시험 모드 기본은 가짜 발행기 그대로(`testBilling({ issuer: 'portone' })`일 때만 어댑터). `docs/DEPLOY.md`·`.env.example`에 적음.
- 발행기는 로그를 남기지 않는다(사업자등록번호가 로그·오류에 나가지 않음).

### 남의 몫·메모
- 웹(`/pricing`)은 `GET /api/pricing`만 부르면 된다. 금액 표시는 코어 `formatWon`.
- 마이그레이션 번호 0029는 다른 스프린트와 겹칠 수 있다 — 합칠 때 번호만 다시 매기면 된다(ALTER 한 줄).
