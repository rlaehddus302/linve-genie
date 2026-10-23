# PL1B dev-notes

## dev-server (server 몫: AC-PL1B-01~04·20~22)

### 바뀐 공개 모양 — 사업자 정보 `receiptKind` (D-PL1-07) ← dev-web·test-domain·test-e2e 먼저 읽기

`PUT /api/billing/business` (본문 `{ requestId, businessNumber, name, ceo, email?, receiptKind? }` — 경로·본문 그대로)

| 보낸 `receiptKind` | 결과 |
|---|---|
| 없음 | 200, 응답·조회 `receiptKind: 'CASH_RECEIPT'` |
| `'CASH_RECEIPT'` | 200, 같음 |
| `'TAX_INVOICE'` (정확히 이 글자) | **422** `{ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'receiptKind', message: '세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.' }] } }` — 저장 없음 |
| 그 밖 모든 값(`'cash_receipt'`·`1`·`null`·`' TAX_INVOICE'`·`'TAX_INVOICE\u0000'`·`'Tax_Invoice'`·배열·객체·긴 글 …) | **422** 같은 모양, 문장 `'계좌이체 증빙은 세금계산서나 현금영수증 중에서 골라 주세요.'`(N5 기존 문장) — 저장 없음 |

- 다른 칸(번호·상호·대표자·이메일)만 틀리면 **지금처럼 400** `INVALID_INPUT`. 증빙 종류 칸이 함께 틀리면 422이고 `problems`에 모든 칸 문장이 다 든다.
- `GET /api/billing`의 `business.receiptKind`는 **늘 `'CASH_RECEIPT'`** — DB에 옛 `TAX_INVOICE`가 있어도(저장값은 고쳐 쓰지 않는다).
- 새 증빙 요청(계좌이체 부여)의 `kind`는 늘 `CASH_RECEIPT`. 이미 있는 `TAX_INVOICE` 증빙 기록은 그대로라 결제 내역 `document.kind`에 `'TAX_INVOICE'`가 올 수 있다 — 웹의 증빙 낱말 표(`세금계산서`)는 지우지 않는다(AC-PL1B-06).
- 운영자 계정 명령(`create-account --bizno`)이 만드는 사업자 정보 행도 `CASH_RECEIPT`.
- **dev-web 주의**: 지금 `BusinessSection.tsx`는 기본값 `TAX_INVOICE`로 `receiptKind`를 보낸다 → 이 서버에선 422. 라디오를 없애고 `receiptKind`를 보내지 않거나 `'CASH_RECEIPT'`로 보내야 한다(AC-PL1B-05).
- 상수: `ISSUED_RECEIPT_KIND`(`apps/server/src/billing/documents.ts`), 문장 `BUSINESS_TAX_INVOICE_MESSAGE`·`BUSINESS_RECEIPT_KIND_MESSAGE`(`billing/service.ts`).

### 판단 (AUTO)
- AC-PL1B-01 (d)는 "지금처럼 422"라고 적었지만 BASE 코드는 400이었다. AC (d)와 AC-PL1B-91 (a)("모두 422")를 글자대로 따라 **증빙 종류 칸 문제는 422**로 했다(다른 칸은 400 그대로). 판매자 화면은 이 칸을 보내지 않게 되므로 판매자에게 보이는 차이는 없다.

### AC-PL1B-20 요금 골든 `granted` — **spec-keeper 확인 필요 (disputesWithSpec)**
- `apps/server/test/billing-golden.test.ts`가 종류 `granted`를 읽어 `judgeGranted`로 돌린다(파일 5·사례 82 고정값, D-PL1-08 주석, TZ 결정성에 포함). `judgeGranted` 코드는 그대로이고 **15개 모두 `out`과 같다**.
- 그러나 **`granted.json`의 ID G-BIL-301~315가 `bizno.json`의 G-BIL-301~313과 겹친다.** README "id … 이 폴더 전체에서 유일"·AC "중복 ID는 지금처럼 읽기 오류"대로 시험이 읽기 오류 13건으로 실패한다(`읽기 오류가 없다`·`결정성` 두 시험). 시험을 약하게 하지 않았다. → spec-keeper가 `tests/golden/billing/granted.json`의 ID를 겹치지 않는 번호(예: G-BIL-401~415)로 바꾸고 DECISIONS D-PL1-08·README·AC-PL1B-00/20의 "G-BIL-301~315"도 맞추면 통과한다(서버 시험은 ID 번호를 고정하지 않는다).

### AC-PL1B-21 결과를 모르는 환불 — 기존 시험과 더한 칸
- 기존(`apps/server/test/billing-refund-settle.test.ts`, RA-N5-01): "재현: 취소 반영 뒤 응답이 시간 제한보다 늦으면 …"(시간 초과·조회 됨 → 바로 200 환불함), "취소가 정말 안 됐으면(결제 그대로) …"(5xx·조회 됨 → 바로 502, 환불 중 풀림), "취소 응답도 결제 조회도 안 되면 환불 중 그대로 …"(502 응답 끊김 + 조회 실패 → 409, 맞추면 환불함), "마무리 기록 전에 멈춘 환불" 묶음(맡은 기한 `REFUND_HOLD_MS` 전에는 그대로, 기한 뒤 결제 내역 열기·다시 환불로 맞춤·결제 그대로면 환불 중만 풂).
- 더함(`apps/server/test/pl1b-billing.test.ts`): (a) 시간 초과(실제 취소) + 조회 실패 → 409, **정액 미리 보기 `start: NO_PASS`**·시작 422, 두 번째 환불 409·취소 한 번 → 조회가 돌아오면 결제 내역 열기로 회수·환불함. (b) 5xx(취소 안 됨) + 조회 실패 → 409, 잔량 0·시작 422, 조회 실패 동안 결제 내역은 환불 중 그대로, 두 번째 환불 409·취소 한 번 → 조회가 돌아오면 환불 중만 풀리고 잔량·시작 돌아옴(회수 없음).
- 지금 코드 동작(바꾸지 않음): 환불 요청 자신이 결제 조회로 결과를 알면 바로 끝난다(취소됨 200 / 그대로 502). "환불 직후 409"는 조회도 안 될 때다. 맡은 요청이 조회 실패로 끝나면 기한을 지금으로 당겨 다음 맞추기가 바로 한다 — "기한 전에는 그대로"는 요청이 결과를 남기지 못하고 멈춘 경우(위 기존 묶음)에 해당한다.

### AC-PL1B-22 밖에서 취소된 결제
- 기존: "부여된 결제가 취소됐다는 웹훅 → … 확인 필요(운영자 목록). 이용권은 막지 않는다". 더함: 카드 결제를 다시 확인으로 맞춤 → `NEEDS_REVIEW`, `PAYMENT_REVIEW` warn 한 번(결제 ID·금액·상호·로그인 아이디 없음), 운영자 목록, 회수 0, **바로 실제 방송 시작 200**, 다시 확인·결제 내역 열기 뒤에도 로그 한 번·목록 한 줄.
- 지금 코드: 결제 내역 열기는 **환불 중이고 기한이 지난 주문만** 결제 조회로 맞춘다. 환불 중이 아닌 부여된 결제의 밖 취소는 웹훅·다시 확인이 맞춘다(결제 내역을 열 때마다 모든 결제를 조회하지 않는다 — 동작 변경 없음).

### 운영자 목록·문서 (AC-PL1B-04)
- `billing-list`의 종류 낱말은 저장된 종류 그대로(옛 `세금계산서`, 새 `현금영수증(지출증빙)`) — 코드는 이미 그랬고 시험을 더했다.
- `docs/OWNER-GUIDE.md` 8절(제목·3)·9-6절·순서도 [8]을 "지금은 현금영수증(지출증빙)만 — 간이과세자라 세금계산서를 발급하지 않음, 일반과세자로 바꾸면 다시 연다(세무사·세무서 확인)"로.

### 바꾼 기존 시험 (근거 주석 붙임)
- `billing-ops.test.ts`: 계정 명령 조회·저장 응답의 `receiptKind` `TAX_INVOICE` → `CASH_RECEIPT`, 'BOTH' 422 단언 더함 (D-PL1-07)
- `billing-payment.test.ts` AC-N5-38: `TAX_INVOICE` 저장 422 → 상호만 바꾸고 다음 증빙 `CASH_RECEIPT` (D-PL1-07)
- `billing-golden.test.ts`: 종류·수 고정값 (D-PL1-08)

### 범위 밖에 남긴 것
- `apps/server/src/db/schema.ts`의 `receipt_kind` 주석(`TAX_INVOICE · CASH_RECEIPT`)은 파일 경계상 PL1A 쪽 파일이라 그대로 — 옛 기록에 두 값이 다 있을 수 있어 틀린 주석도 아니다.
