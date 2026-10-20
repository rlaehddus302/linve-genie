# N5 개발 노트

## dev-server

### 바뀐 계약 (화면·E2E·적대 시험이 먼저 알아야 할 것)
S04~I4 계약은 그대로이고 아래가 더해진다. **요금 기능은 기본 꺼짐**이다 — 꺼져 있으면 `/api/billing/**`는 웹훅까지 모두 404(세션·Origin 검사보다 먼저), 방송 만들기 응답에 `billing` 항목이 없고, 이용 방식·쓴 기록을 만들지 않는다. 켜진 서버의 `/api/billing/**`는 기존 `/api` 공통 규칙(세션·상태를 바꾸는 요청의 `Origin`·JSON·64KB·`Cache-Control: no-store`·받은 값을 오류에 되돌려 보내지 않음·모르는 항목 400 `UNKNOWN_FIELD`)을 그대로 받는다. 예외는 웹훅(세션·Origin 없음 — 서명). 다른 판매자의 결제 ID는 없는 결제와 같은 404다.

#### 1. 화면 설정 `GET /api/client-config` (AC-N5-11·40)
```ts
{ hostActionDelayMs, testPrinter,
  billing: { enabled: false, testPayment: false }                                   // 꺼짐
         | { enabled: true, testPayment: true }                                     // 시험 결제 (E2E --billing yes)
         | { enabled: true, testPayment: false, storeId: string, channelKey: string } // 운영 (포트원 공개 값)
}
```
- 비밀값(포트원 API 비밀값·웹훅 비밀값)은 어디에도 나가지 않는다.
- **교체**: 기존 시험의 `client-config` 고정값 셋에 `billing: { enabled: false, testPayment: false }`를 더했다 — `apps/server/test/e2e.test.ts` 3곳, `apps/server/test/print-rules.test.ts` 1곳. 계약이 늘어서 하는 교체이고 약화가 아니다.

#### 2. 요금 상태 `GET /api/billing` (AC-N5-13·51·52·56·57)
그 순간 서버 시각으로 `billingStatus`(BL-2~BL-4·BL-7) 하나를 부른 값. 아무것도 기록하지 않는다(여러 번 불러도 쓴 기록·창 없음). 시각은 UTC ISO(화면이 KST로).
```ts
{
  now: string,
  flat: { active: boolean, until: string|null /* 이용 중이면 이어진 마지막 끝 — "…까지" */, endedAt: string|null /* 이용 중이 아니고 사슬이 있으면 마지막 끝 — "끝남 (…)" */,
          chain: { grant, from, until }[] },
  balances: { DAYS: number, ORDERS: number, LABELS: number },   // 음수 = 초과 (초과 N = -값)
  window: { from, until } | null,                                // 열린 방송 일 24시간 창
  start:                                                         // "지금 시작하면" 미리 보기 (BL-4 6, BL-9 2)
    | { allowed: false, reason: 'NO_PASS' }
    | { allowed: true, mode: 'FLAT'|'DAY'|'ORDERS', useDay: boolean,
        flatUntil: string|null   /* FLAT: "정액제로 시작해요 (11/19 20:31까지)." */,
        windowUntil: string|null /* DAY·열린 창: "방송 일권 24시간 안이에요 (10/21 20:00까지)…" */,
        days: { before, after }|null /* DAY·새로 씀: "방송 일권 1일을 써요 (남은 3일 → 2일)…" */,
        orders: number|null      /* ORDERS: "주문 건권으로 시작해요 (남은 40건)…" */ },
  banners: ( { kind: 'FLAT_REMAINING', days: number /* 1~7, 올림 */, until: string }
           | { kind: 'FLAT_ENDED', at: string }
           | { kind: 'NO_PASS' }
           | { kind: 'ORDERS_OVER', count: number }
           | { kind: 'LABELS_OVER', count: number } )[],          // BL-9 1의 다섯 경우 그대로 (문장은 화면이 만든다)
  items: { id, name, kind: 'FLAT_30D'|'DAYS'|'ORDERS'|'LABELS', quantity: number|null, price: number /* 원, 부가세 포함 */ }[], // 판매 중인 것만
  business: { masked: '123-45-*****', name: string|null, ceo: string|null, email: string|null,
              receiptKind: 'TAX_INVOICE'|'CASH_RECEIPT', complete: boolean /* 상호·대표자까지 — false면 결제 주문을 만들지 않는다 */ } | null,
  testPayment: boolean,
}
```
- 결제 전 안내(BL-9 5)는 `balances`(그 종류가 음수면 "지난 초과 N건이…")와 `flat.until`(이용 중이면 "남은 기간(…까지) 뒤에 30일이 이어져요.")로 만든다.

#### 3. 사업자 정보 `PUT /api/billing/business` (AC-N5-37·53)
- 본문 `{ requestId, businessNumber, name, ceo, email?, receiptKind? /* 기본 TAX_INVOICE */ }` → 200 `BusinessView`(위 `business`와 같은 모양, `complete: true`).
- 400 `INVALID_INPUT` + `problems`(칸마다 하나): `businessNumber` "사업자등록번호는 숫자 10자리로 적어 주세요." / "사업자등록번호를 다시 확인해 주세요." · `name` "상호는 1~50자로 적어 주세요." · `ceo` "대표자 이름은 1~30자로 적어 주세요." · `email` "이메일은 이름@도메인 모양으로 100자 이하로 적어 주세요." · `receiptKind` "계좌이체 증빙은 세금계산서나 현금영수증 중에서 골라 주세요." 제어 글자는 그 칸의 문장으로 거절. 휴대폰 번호 검사는 하지 않는다.
- 번호는 띄어쓰기·붙임표만 지우고 읽는다(G-BIL bizno). 번호·상호·대표자·이메일은 마스터 키로 암호화한 JSON 하나로 저장(`billing_business.sealed`), 평문은 가린 번호와 증빙 종류뿐.

#### 4. 결제 주문 `POST /api/billing/orders` (AC-N5-30·52)
- 본문 `{ requestId, itemId, method: 'CARD'|'TRANSFER', agreed: true }` → 200
  `{ paymentId /* 영문·숫자 34자 */, orderName, amount, currency: 'KRW', method, itemId, kind, quantity, testPayment, storeId: string|null, channelKey: string|null /* 운영 결제 창 공개 값, 시험이면 null */ }`
- 같은 요청 번호 = 같은 주문(같은 응답).
- 거절(검사 순서대로): 모르는 칸 400 `UNKNOWN_FIELD` · `itemId`·`method` 형식 400 `INVALID_INPUT`(다른 수단 포함) · 약관 체크 없음 400 `TERMS_REQUIRED` "이용권 약관과 환불 규정을 읽었다고 체크해 주세요." · 판매 중이 아니거나 없는 항목 409 `ITEM_UNAVAILABLE` "지금 살 수 없는 이용권이에요." · 사업자 정보 없음(또는 상호·대표자 없음) 409 `BUSINESS_REQUIRED` "결제 전에 사업자 정보를 적어 주세요."
- 운영 결제 창(포트원 V2 브라우저 SDK `requestPayment`): `storeId`·`channelKey`·`paymentId`·`orderName`·`totalAmount: amount`·`currency: 'KRW'`(SDK 값은 `CURRENCY_KRW`)·`payMethod: method === 'CARD' ? 'CARD' : 'TRANSFER'`, 휴대폰은 `redirectUrl: <앱 주소>/billing` (돌아오면 쿼리의 `paymentId`로 확인 요청 — 쿼리의 다른 값은 쓰지 않는다).

#### 5. 결제 확인·다시 확인 `POST /api/billing/orders/:paymentId/confirm` (AC-N5-31·33·35)
- 본문 `{ requestId }`만 (금액·상태 등 다른 칸은 400 `UNKNOWN_FIELD`). 결제 창이 돌아오면(성공·실패·닫기 모두) 부른다.
- 200 `{ paymentId, result, state, message, itemName, amount }`
  - `result`: `GRANT` · `WAIT` · `FAIL` · `CANCEL_MISMATCH` · `REVIEW` · `NONE`(이미 정해진 주문) · `LOOKUP_FAILED`(결제 조회 실패 — 시간 초과 10초·5xx·이상한 응답)
  - `state`: `PENDING` 결제 대기 · `FAILED` 결제 안 됨 · `GRANTED` 결제 완료 · `MISMATCH_CANCELLED` 금액이 달라 취소함 · `NEEDS_REVIEW` 확인 필요 · `REFUNDED` 환불함
  - `message`: BL-9 4 문장 — 결과가 `LOOKUP_FAILED`면 "결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.", 아니면 **지금 주문 상태**의 문장: GRANTED "결제했어요. <항목 이름>을 받았어요."(을/를은 받침으로) · PENDING "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요." · FAILED "결제가 되지 않았어요. 돈은 나가지 않았어요." · MISMATCH_CANCELLED "결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요." · NEEDS_REVIEW "결제를 자동으로 확인하지 못했어요. 운영자가 확인해요." · REFUNDED "환불했어요. 결제 수단으로 돌려드려요."
  - "다시 확인" 버튼은 `state`가 `PENDING`(기다림·조회 실패)일 때.
- 금액이 다르면 서버가 전액 취소를 요청한다. 취소 요청 전에 주문을 `NEEDS_REVIEW`로 잡아 두므로 다시 확인·웹훅이 취소를 두 번 요청하지 않는다(취소가 성공하면 `MISMATCH_CANCELLED`, 실패하면 `NEEDS_REVIEW` 그대로 — 운영자 목록).

#### 6. 7일 환불 `POST /api/billing/orders/:paymentId/refund` (AC-N5-36·54)
- 본문 `{ requestId }` → 200 `{ paymentId, state: 'REFUNDED', message: '환불했어요. 결제 수단으로 돌려드려요.' }` (같은 요청 번호 재전송 = 처음 결과, 취소는 한 번)
- 409 `REFUND_NOT_ALLOWED` "이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요." (운영자 이용권·이미 환불·결제 완료가 아닌 주문도) · 502 `REFUND_FAILED` "환불하지 못했어요. 잠시 뒤 다시 해 주세요."(아무것도 바뀌지 않음) · 409 `REFUND_IN_PROGRESS` "환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요."(같은 결제의 환불이 진행 중 — **스펙에 없는 문장, 아래 "스펙에 없는 것" 참고**)
- 차례 처리: 환불 판단을 한 순간부터 결제 취소 결과가 날 때까지(최대 60초) 그 이용권은 회수된 것으로 본다(새 방송 시작·미리 보기가 쓰지 않는다). 취소가 실패하면 되돌린다.

#### 7. 결제 내역 `GET /api/billing/payments?cursor=&limit=` (AC-N5-14·54)
- `limit` 1~100(기본 50), `cursor` = 앞 응답의 `next`. 응답 `{ items, next: string|null }`, 최근 것 먼저(주문은 만든 시각, 운영자 이용권은 부여 시각).
```ts
{ type: 'order', paymentId, itemId, itemName, kind, quantity, amount, method: 'CARD'|'TRANSFER', paidMethod: string|null,
  state, createdAt, grantedAt, refundedAt, refundable: boolean /* 그 순간 G-BIL refundable — "환불" 버튼 */, refunding: boolean,
  document: { kind: 'TAX_INVOICE'|'CASH_RECEIPT', status: 'PENDING'|'ISSUED'|'FAILED', approval: string|null /* TEST-… */,
              cancel: null|'REQUESTED'|'CANCELLED'|'FAILED' } | null /* 계좌이체만 */ }
| { type: 'operator', grantId, kind, quantity, reason, at, revoked }   // "운영자가 준 이용권 · 사유"
```
- 낱말: 증빙 `PENDING` 발행 대기 · `ISSUED` 발행됨 · `FAILED` 발행 실패, 취소 `REQUESTED` 취소 요청 · `CANCELLED` 취소됨.

#### 8. 쓴 내역 `GET /api/billing/usage?cursor=&limit=` (AC-N5-14·55)
- 응답 `{ items, next }`, 최근 것 먼저.
```ts
{ id: number, kind: 'DAYS'|'ORDERS'|'LABELS', at,
  broadcast: { id, title, date } | null,
  productNo: number|null   /* ORDERS: 지금 번호(번호를 바꿨으면 바뀐 번호) · LABELS: 라벨의 번호 */,
  productName: string|null /* ORDERS: 지금 품종 */,
  windowUntil: string|null /* DAYS: 24시간 창 끝 */ }
```

#### 9. 방송 만들기 `POST /api/broadcasts` (AC-N5-20·56)
- 요금 기능이 켜져 있고 실제 방송이면 응답에 `billing: { mode: 'FLAT'|'DAY'|'ORDERS', usedDay: boolean } | null`을 더한다(`null` = 요금 기능을 켜기 전에 시작한 방송의 재전송). 리허설·꺼짐이면 항목이 없다.
- 막히면 422 `{ error: { code: 'NO_PASS', message: '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.' } }` — 아무것도 기록하지 않는다(같은 요청 번호로 산 뒤 다시 보내면 시작된다).
- 엔진 `broadcast.start`·방송 행·이용 방식·방송 일 쓴 기록이 한 트랜잭션이다.

#### 10. 실시간 `GET /api/stream` (AC-N5-13)
- 새 이벤트 `event: billing`, `data: { reason: 'grant'|'revoke'|'order'|'start'|'business' }` — 까닭만(결제 ID·금액·사업자 정보 없음). 받으면 `GET /api/billing`(요금 화면이면 내역도)을 다시 받는다. 주문 건·라벨 장 쓰기는 알리지 않는다.

#### 11. 웹훅 `POST /api/billing/webhook` (AC-N5-32)
- 세션·Origin 없이 받는다(64KB 제한). 포트원 V2 웹훅 = Standard Webhooks: 머리말 `webhook-id`·`webhook-timestamp`(초)·`webhook-signature`(`v1,<base64>` 여럿, 띄어쓰기로 나눔). 서명 = base64(HMAC-SHA256(`whsec_` 뒤 base64를 푼 키, `${id}.${timestamp}.${본문}`)). 보낸 시각이 서버 시각 ±5분 밖이면 거절.
- 출처: 포트원 V2 개발자 문서 "웹훅 연동하기"(developers.portone.io/opi/ko/integration/webhook/readme-v2 — 서명 검증은 Standard Webhooks 규격 standardwebhooks.com을 따름). 시험 벡터: 비밀값 `whsec_` + base64(`test-secret-for-vector`), id `msg_vector_1`, timestamp `1792494000`, 본문 `apps/server/test/billing-portone.test.ts`의 `body` → `v1,W5T5soFGUpxF7X5f0OGPH9G48t3J09Tu78kS7XCHyaM=`.
- 서명·시각·본문 형식이 틀리면 400(기록·조회 없음). 맞으면 본문 `data.paymentId`만 꺼내 결제 확인과 같은 일을 한다. 모르는 결제 ID(다른 판매자 것 포함 — 웹훅은 판매자를 모른다) 200 `{ ok: true }`, 조회 실패 503(포트원이 다시 보낸다), 그 밖 200 `{ ok: true }`. 응답에 주문 상태·판매자가 없다.

#### 12. 시험 결제 경로 — 시험 결제일 때만(`client-config.billing.testPayment`), 운영 구성에는 경로 자체가 없다 (AC-N5-40·58)
| 경로 | 본문 | 뜻 |
|---|---|---|
| `POST /api/billing/test/payments/:paymentId` | `{ action: 'PAID'\|'FAILED'\|'CHANGED_AMOUNT', method?: 'CARD'\|'TRANSFER' (기본 CARD), amount? }` | 가짜 결제 서버에서 그 결제를 완료·실패·금액 바꿔 완료(주문 금액 − 1,000원). 시험 결제 창의 "결제 완료(카드)"·"결제 완료(계좌이체)"·"결제 실패"·"금액을 바꿔 결제" → 이 경로 다음에 확인 요청. "창 닫기"는 아무것도 부르지 않고 확인 요청만 |
| `POST /api/billing/test/payments/:paymentId/webhook` | `{}` | 가짜 결제 서버가 서명한 `Transaction.Paid` 웹훅을 이 서버의 웹훅 처리에 넣는다 → `{ status: 200\|400\|503 }`. 먼저 `PAID`로 만들어 둔다 |
| `PUT /api/billing/test/gateway` | `{ lookupFailure?, cancelFailure?, issueFailure? }` (모두 boolean) | 조회 실패·취소 실패·증빙 발행 실패 켜고 끄기 → 지금 값 |
| `POST /api/billing/test/grants` | `{ kind, quantity?, reason?, at? /* ISO, 지금~400일 전 */ }` | 시험용 운영자 이용권 (`at`을 과거로 — 예: 정액이 3일 남게 `at = 지금 − 27일`) → `{ grantId }` |
- 다른 판매자의 결제 ID는 404.

#### 13. 운영 설정·기동 (AC-N5-11)
| 환경변수 | 뜻 |
|---|---|
| `LIVEJJIM_BILLING` | `on`·`off`(기본 off) |
| `LIVEJJIM_BILLING_PRICES` | 요금 표 JSON 파일 경로. 없으면 BL-1 기본 표(자리 표시). 형식: `{ "placeholder"?: boolean, "items": [{ "id", "name", "kind", "quantity"?, "price", "onSale"? }] }` — 틀리면 꺼져 있어도 기동하지 않고 "요금 표를 확인해 주세요. 3번째 항목: 가격은 …" 한 문장 |
| `PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY` | 공개 값(화면 결제 창) |
| `PORTONE_API_SECRET`·`PORTONE_WEBHOOK_SECRET` | 비밀값(서버에만) |
- 켜져 있는데 요금 표가 자리 표시면 "요금 표가 자리 표시 값이에요. 운영 가격을 정한 뒤 켜 주세요.", 포트원 넷 중 하나라도 비면 "결제 설정이 비어 있어 요금 기능을 켤 수 없어요." — 기동하지 않는다(`productionServerOptions`). 운영 구성: 결제 어댑터 = 포트원 V2(`https://api.portone.io`, 요청 시간 제한 10초), 증빙 발행기 = "없음", 시험 결제 없음.
- `.env.example`에 키 목록을 더했다.

#### 14. E2E 서버 (AC-N5-11·40)
- `pnpm --filter @livejjim/server e2e … --billing yes` → 요금 기능 켬 + 시험 결제(가짜 결제 서버·가짜 발행기) + 기본 요금 표. 기본(`--billing no`·생략)은 지금과 똑같다(꺼짐). 프로그램: `startE2eServer({ billing: true })`.
- **dev-web에게**: `apps/web/playwright.config.ts`에 요금 묶음이 필요하다 — 예: `{ name: 'chromium-billing', web: 5177 + offset, api: 3104 + offset, serverArgs: '--billing yes --host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}', grep: /@billing/ }`, 기본 묶음의 `grepInvert`에 `@billing` 추가. 꺼진 서버 시험(메뉴 "요금" 없음)은 기본 묶음에서 돈다. (이 파일은 화면 영역이라 고치지 않았다.)

#### 15. 운영자 명령 (AC-N5-12)
- `pnpm --filter @livejjim/server billing-grant --login 아이디 --kind FLAT_30D|DAYS|ORDERS|LABELS [--quantity 양] --reason "사유"` — OPERATOR 이용권(명령마다 새 장). 정량 1~100,000, 정액은 양 없이, 사유 1~200자·휴대폰 번호 거절. 출력에 사유를 쓰지 않는다.
- `pnpm --filter @livejjim/server billing-list` — 확인 필요 결제, 1시간 넘게 결제 대기, 발행 대기·발행 실패·취소 요청 증빙(복호화한 사업자등록번호·상호·대표자·이메일·종류·공급가액·세액). 표준 출력에만. 마스터 키 필요.
- `create-account … [--bizno 123-45-67890]` — 틀리면 "사업자등록번호를 다시 확인해 주세요."로 계정을 만들지 않는다. 번호만 암호화해 두고(상호·대표자는 화면), `business.complete = false`.
- 재생 무결성 검사 `check-replay`가 요금도 대조한다(아래).

### 요금 원장 (마이그레이션 `0004_n5_billing.sql`)
| 표 | 뜻 | 바뀌는 칸 |
|---|---|---|
| `billing_grants` | 이용권 부여(정액·정량, 출처 PAYMENT·OPERATOR). `payment_id` 유일(결제 ID당 하나) | 없음(덧붙이기만) |
| `billing_revocations` | 회수(환불). `grant_id` 유일 | 없음 |
| `billing_usage` | 쓴 기록. (판매자, 키) 유일. 키: `DAYS:<방송>` · `ORDERS:<범위 날짜>:<상품 ID>` · `LABELS:<범위 날짜>:<작업 ID>` | 없음 |
| `billing_modes` | 방송의 이용 방식(방송 ID가 키) | 없음 |
| `billing_orders` | 결제 주문(금액 스냅샷) | 상태·수단·부여/환불 시각·환불 중 기한 |
| `billing_business` | 사업자 정보(암호화 JSON·가린 번호·증빙 종류) | 다시 저장하면 덮는다 |
| `billing_documents` | 증빙 요청(결제마다 하나, 받는 쪽 암호화) | 상태·승인 번호·취소 |
| `billing_requests` | 요금 요청 번호(환불의 처음 결과) | 없음 |
- 병렬 트랙과 겹치지 않게 번호를 `0004_n5_billing`으로 했다. 합칠 때 다른 트랙의 `0004_*`와 번호·저널 순서만 맞추면 된다(표가 겹치지 않는다).
- 판매자 요금 락: `pg_advisory_xact_lock(hashtextextended('billing/<판매자>', 0))`. 새 실제 방송 시작(범위 락 다음)·결제 확인 부여·환불 판단/결과·운영자 부여·주문 건/라벨 장 쓰기(새로 쓸 때만)·사업자 정보 저장이 잡는다. 결제 조회·취소(외부 호출)는 락·트랜잭션 밖이다.
- 주문 건 쓰기: 기록 경로 `txHook`(출력 기록 다음)에서 상품 칸이 바뀐 기록마다, 그 범위의 ORDERS 방식 방송 상품 중 이전 상태의 확정 횟수 0 → 지금 1 이상인 것. 라벨 장 쓰기: `PrintService` 결과 기록(`#applyResult`)이 상품 작업을 출력함으로 바꾸는 같은 트랜잭션(`onPrinted`), 폐기된 작업·포장은 부르지 않는다.

### 재생 무결성 검사의 요금 대조 (AC-N5-26)
`check-replay`의 범위 결과에 `billing: string[]`(다른 키)과 불일치 부분 `'요금'`을 더했다. 대조: ORDERS 방송의 확정 횟수 ≥ 1 상품 = ORDERS 쓴 기록 / DAY·ORDERS 방송의 상품 라벨 출력함 작업 = LABELS 쓴 기록 / 방송 일을 쓴 시작마다 `DAYS:<방송>`이 있고 그 방송 행이 그 범위에 있고 24시간 창이 겹치지 않음 / 쓴 기록마다 그 방송의 맞는 이용 방식 / 리허설 범위 방송에 이용 방식 없음. 출력 문장 끝에 `· 요금 키 <키>…`(방송·상품·작업 ID만).
- 한계: 출력 중에 폐기된 뒤 출력함이 된 상품 작업은 기록으로 "출력함이 될 때 폐기였는지"를 가릴 수 없어 쓴 기록이 있든 없든 받는다. 요금 기능을 켰다 끄고 다시 켠 경우, 꺼진 동안 처음 1등이 나온 ORDERS 상품은 세지 않았으므로 검사가 그 키를 알린다(운영자가 스위치를 방송 중에 바꾸지 않는다는 전제 — DECISIONS 판단 대상 아님, 운영 안내).

### 자동 갱신으로 바꿀 곳 (AC-N5-15, BL-2 6)
- 더할 것: ① 판매자 동의 기록(정기 결제 동의 화면·표 — 동의 시각·해지), ② 결제 어댑터에 빌링키 발급(포트원 V2 `POST /billing-keys` 또는 SDK `requestIssueBillingKey`)·빌링키 결제(`POST /payments/{id}/billing-key`)·빌링키 삭제, ③ 끝나기 전(예: 남은 1일) 청구 작업(서버 작업 — 같은 결제 ID 규칙·금액 스냅샷), ④ 부여는 지금의 결제 확인(`confirm` → `judgePayment` GRANT → `insertGrant` 출처 PAYMENT)을 그대로 쓴다.
- 바꾸지 않아도 되는 것: 정액 사슬(`flatChain`)·시작 판단·환불 판단(`billingStatus`)·원장 표·쓰기 — 출처를 보지 않는다(환불만 PAYMENT 확인).
- 지금 코드에는 빌링키 경로·설정이 없다(시험이 소스를 검사한다).

### 증빙 발행기 — 팝빌 실제 어댑터를 끼울 자리 (AC-N5-38)
- 인터페이스 `DocumentIssuer`(`apps/server/src/billing/documents.ts`): `issue({ paymentId, kind, amount, supply, vat, recipient }) → { status: 'ISSUED', approval } | { status: 'PENDING' } | { status: 'FAILED' }`, `cancel(...) → { cancel: 'CANCELLED'|'REQUESTED'|'FAILED' }`. 결제 확인 부여가 커밋된 뒤 부르고, 결과로 상태만 바꾼다(결제·이용권은 그대로).
- 붙일 때의 설정 이름(예정, 지금 읽지 않는다): `POPBILL_LINK_ID`·`POPBILL_SECRET_KEY`·`POPBILL_CORP_NUM`(우리 사업자번호)·`POPBILL_IS_TEST`. `productionServerOptions`가 이 값이 있으면 팝빌 어댑터, 없으면 지금처럼 "없음".
- 지금: 시험 = `FakeIssuer`(바로 발행됨 `TEST-…`, 취소됨), 운영 = `noneIssuer`(발행 대기·취소 요청 — 운영자가 `billing-list`로 보고 손으로 발행).

### 시험용 기동과 주입점 (적대·E2E 시험)
- 프로그램: `createServer({ …, billing: testBilling() })` — `testBilling({ enabled?, prices?, timeoutMs? })`가 가짜 결제 서버(`FakePortOne` — 포트원 V2 모양 Hono 앱, 서버의 `PortOneGateway`가 HTTP 모양 그대로 부른다)·가짜 발행기(`FakeIssuer`)·기본 요금 표·시험 웹훅 비밀값(`TEST_WEBHOOK_SECRET`)을 묶는다. `server.billing.setup.test.portone`으로 `pay(paymentId, amount, method)`·`fail`·`setStatus(paymentId, status, amount)`·`lookupFailure`·`cancelFailure`·`cancelCalls`·`lookups`·`requests`, `…test.issuer.fail`.
- 서명한 웹훅: `signedWebhook(TEST_WEBHOOK_SECRET, paymentId, now, type?)` → `{ body, headers }` → `app.request('/api/billing/webhook', { method: 'POST', headers, body })`.
- 운영자·시험 부여: `server.billing.grantByOperator(sellerId, { kind, quantity, reason, at? })`.
- 결제 조회가 멈추는 경우: `BillingSetup.gateway`를 바꿔 끼운다(`apps/server/test/billing-payment.test.ts` "조회가 멈춰 있는 동안").
- 모두 `@livejjim/server`에서 내보낸다(`index.ts` N5 절).

### 교체한 기존 시험 (약화 아님)
- `packages/core/test/golden/core-adapter.test.ts` 합계 고정값 "파일 26 · 파서 460 · 엔진 129 · 통과 589" → "파일 27 · 파서 460 · 엔진 131 · 통과 591"(AC-N5-04, 골든이 늘었다).
- `apps/server/test/e2e.test.ts`·`print-rules.test.ts`의 `client-config` 고정값에 `billing: { enabled: false, testPayment: false }`.
- `apps/server/test/commands.test.ts` 마이그레이션 표 수 15 → 23(요금 표 8개).

### 스펙에 없는 것 (판단 — disputesWithSpec 아님, spec-keeper 확인용)
- 409 `REFUND_IN_PROGRESS` "환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요." — 같은 결제의 환불이 결제 취소를 기다리는 동안 다른 환불 요청이 오면(두 번 누름·두 기기). 스펙 문장이 없어 새 문장을 썼다. 취소를 두 번 요청하지 않는 것이 목적이다.
- 시험 결제 창 "금액을 바꿔 결제" = 주문 금액 − 1,000원(최소 1원).
- 결제 확인 응답의 문장은 결과가 아니라 **확인 뒤 주문 상태**의 문장이다(이미 부여된 주문을 다시 확인하면 "결제했어요…" 그대로).
