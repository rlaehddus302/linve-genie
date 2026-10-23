# PL1B test-notes (domain)

적대 시험: `tests/adversarial/pl1b/` — 2파일 13개, 모두 통과(제품 버그 재현 없음).

## receipt-kind.test.ts (AC-PL1B-91 a, AC-01·02)
- 처음 저장: `' TAX_INVOICE'`·`'TAX_INVOICE '`·`'TAX_INVOICE\u0000'`·`'TAX_INVOICE​'`·`'Tax_Invoice'`·전각·`'cash_receipt'`·`' CASH_RECEIPT'`·`'BOTH'`·`''`·숫자·참거짓·`null`·배열·객체·긴 글(약 48KB)·태그 → 모두 422, 문장 "계좌이체 증빙은 …", 행 없음, 응답에 보낸 글을 되돌려 주지 않음. 정확히 `'TAX_INVOICE'`만 "세금계산서는 지금은 발급할 수 없어요 …".
- 본문 한도(64KB)를 넘는 글은 읽기 전에 413 `PAYLOAD_TOO_LARGE` — 저장 없음(AC 글자 "아주 긴 글 → 422"와 다르지만 공통 본문 한도라 지적은 nit로만).
- 이미 저장된 정보: 거절(같은 requestId 두 번 포함)은 행을 바꾸지 않는다(봉인값·가린 번호·갱신 시각).
- 다른 칸과 함께 틀리면 422 + 모든 칸 문장, 증빙 칸만 고치면 400.
- 속성(fast-check 60회, 고정 seed): 아무 JSON 값·`TAX_INVOICE`/`CASH_RECEIPT` 앞뒤에 글자 붙인 값 → 없음·`'CASH_RECEIPT'`만 200, 나머지 422, DB 종류는 늘 CASH_RECEIPT.
- 옛 `TAX_INVOICE` 행: 조회 CASH_RECEIPT, 거절은 옛 행을 건드리지 않음, 그 상태의 계좌이체 증빙 요청은 CASH_RECEIPT, 성공한 저장이 행을 CASH_RECEIPT로 덮음.

## packing-print.test.ts (AC-PL1B-91 b·c, AC-10·11)
- 라벨 끔 → 409 `LABELS_OFF`(같은 requestId 두 번), 포장 작업·요청 기록·라벨 0. 다시 켜면 같은 requestId로 새로 만든다(거절은 기록되지 않음).
- `rehearsal: true` → `PRINT_REHEARSAL`(라벨을 꺼도 리허설 거절이 먼저), 리허설 방송만 있는 날짜의 구매자 → 404.
- 다른 판매자의 구매자·진 구매자·없는 구매자·다른 날짜 → 404(진 구매자는 자기 판매자에서 409 `PRINT_NO_ITEMS`), 작업 0.
- 같은 requestId 차례로 2번·동시에 10번 → 같은 작업 묶음 하나. 다른 판매자가 같은 requestId를 써도 남의 작업을 돌려받지 않는다.
- 다른 requestId 동시 10번(마구 누름) → 200 하나, 나머지 409 `PRINT_IN_PROGRESS`; 출력한 뒤 다시 누르면 새 묶음.
- 품목 12개 → 응답 작업 수 = 대기열 포장 작업 수 = 쪽수(≥2), 받는 쪽 번호 1..N.
- 관찰(지금 규칙, 시험 안 함): 라벨을 꺼도 대기 중인 작업은 남고(`waiting` 2), 같은 requestId 재전송은 끈 뒤에도 처음 결과(200)를 돌려준다.

## 확인한 범위
- `vitest --config vitest.adversarial.config.ts tests/adversarial/pl1b/`, eslint, 루트 tsc 통과. 전체 verify·E2E는 돌리지 않음. 띄운 서버·브라우저 없음(모두 프로세스 안 PGlite).
- `apps/server/test/billing-golden.test.ts`는 여전히 2개 실패 — `granted.json` ID가 `bizno.json`과 겹침(spec-keeper 몫, findings 참조).
