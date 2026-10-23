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

## dev-web (web 몫: AC-PL1B-05~07·10~13·16~18·23~25·27)

### 사업자 정보·증빙 (D-PL1-07) — `BusinessSection.tsx`, `lib/billing-words.ts`
- 고치는 칸: 사업자등록번호·상호·대표자 이름·"증빙 받을 이메일 (선택)". 라디오·`fieldset "계좌이체 증빙"` 없음. 칸 아래 `<p>계좌이체 증빙: 현금영수증(지출증빙)</p>`와 `<p class="hint">세금계산서는 지금은 발급할 수 없어요. 카드로 결제하면 카드 매출전표가 증빙이에요.</p>`. 서버가 `receiptKind` 칸 문제(422)를 주면 그 문장이 이 두 줄 아래에 보인다.
- 저장 본문: `{ requestId, businessNumber, name, ceo, email, receiptKind: 'CASH_RECEIPT' }`(늘 현금영수증을 적어 보낸다).
- 보기 칸(dl.facts): "증빙 받을 이메일"·"계좌이체 증빙" → "현금영수증(지출증빙)" — 조회값이 옛 `TAX_INVOICE`여도 화면은 늘 현금영수증(서버도 CASH로 준다).
- 결제 전 계좌이체 안내 `TRANSFER_RECEIPT_NOTE` = "현금영수증(지출증빙)을 발행해요." 증빙 낱말 표(세금계산서·현금영수증)는 옛 기록 표시용으로 그대로.
- 약관 `TERMS` "증빙" = BL-10 8(메모 빼고). `apps/web/test/pl1b-terms.node.test.ts`가 BILLING_RULES BL-10 1~9를 읽어 아홉 항목 모두 글자 맞대기 — **spec-keeper가 BL-10 글을 바꾸면 이 시험이 깨진다(화면 글도 같이 바꿔야 한다는 뜻)**.
- 바꾼 기존 시험(D-PL1-07 주석): `billing-page.test.tsx` 결제 전 안내 문장 두 곳, 사업자 정보 시험의 라디오 누르기 → 라디오 0개 단언.

### 포장 모드 "포장 라벨 출력" (D-PL1-05) — 새 파일 `components/PackingPrint.tsx`, `PackingPage.tsx`는 `PackingLabelSection`과 import 세 줄만
- 라벨 켜짐(`useLabelsEnabled() === true`)이고 품목이 있으면 `region "포장 라벨"`의 "라벨 PDF"와 같은 `.row`에 보통 버튼(`class="button"`) "포장 라벨 출력". 누르면 `POST /api/print/packing { requestId, date, buyer }`(누를 때마다 새 번호, 끊기면 withRetry로 같은 번호), 보내는 동안 disabled, 성공 `<p role="status">포장 라벨 N장 출력을 접수했어요.</p>`(칸 맨 아래), 거절은 `ErrorNote`(서버 문장). 미리 보기를 받는 중에도 누를 수 있다.
- 라벨 꺼짐(`false`): 칸 전체가 제목 + `LabelsOffNote`("라벨 쓰지 않음 — 설정에서 켤 수 있어요.") — 그림·저장·PDF·출력 없음, `packing-label`·`.png` 요청 없음. 켜짐 알림이 오면 다시 그림을 받는다. `LABELS_OFF` 거절이면 출력 기록 저장소가 꺼짐으로 덮어 같은 안내 + 서버 문장.
- 켬/끔 모름(`null` — 불러오는 중·실패·PrintProvider 밖): 출력 버튼만 없다. 미리 보기·그림 저장·라벨 PDF는 BASE처럼 그대로 받는다(BASE 동작 유지 — I2 시험이 PrintProvider 없이 이 칸을 그린다).
- U-PL1B-01(사용성 지적 — 결과 문장이 화면 밖·휴대폰 메뉴 막대 뒤): 결과(성공 `role=status`·거절 `ErrorNote`)를 `<div class="packing-print-result">`로 감싸 **버튼 줄 바로 다음**(라벨 PDF 오류보다 위)에 두고, 문장이 새로 생길 때마다(같은 거절이 다시 생겨도) `scrollIntoView({ block: 'nearest' })` — 이미 보이면 움직이지 않는다. `scroll-margin-bottom` 넓은 화면 1rem, 휴대폰(47.99rem 이하) `calc(5rem + env(safe-area-inset-bottom))`(메뉴 막대 약 55px보다 큼). 버튼 글자는 그대로 "포장 라벨 출력"(이름으로 찾는 시험 유지). 시험: `pl1b-packing.test.tsx` "결과 문장이 보이게"·`styles.node.test.ts` 여백. `tests/e2e/pl1b/packing-print.spec.ts` 6개 통과(크로뮴).
- **AC-PL1B-14(봉인 날짜 숨김)는 하지 않았다** — 뒤에 합치는 트랙 몫. 합칠 때: `PackingLabelSection`에 `sealed`를 넘겨 `{labels === true && !sealed ? <PackingPrintButton …/> : null}`로 바꾸면 된다(그림 저장·라벨 PDF는 그대로).

### 마법사 4/5 "라벨을 쓰지 않아요" (D-PL1-06) — `wizard/PrinterStep.tsx`, `WizardPage.tsx`는 프린터 단계 블록만
- 라벨 켜짐일 때만, 연결 칸(`PrinterSection inWizard`) 아래 보통 버튼 "라벨을 쓰지 않아요"와 `<p class="hint">라벨 없이 팔아요. 설정에서 언제든 다시 켤 수 있어요.</p>`. 모름: "불러오는 중…"만, 꺼짐: 안내만.
- 누르면 확인 창 없이 `PrintStore.saveLabelsEnabled(false)` = `PUT /api/settings/labels { enabled: false }` 하나(설정 화면 끄기와 같은 저장 — 바꾼 기록·알림 같음). 보내는 동안 이 버튼과 "다음" 잠금(StepButtons `nextBusy`). 성공 → `go(5)`(제목 포커스·`PUT /api/wizard {IN_PROGRESS, 5}`), 꺼졌으니 5/5 "이전"은 3/5(기존 skipPrinter 규칙). 실패 → 4/5에 머묾, `RequestError`(서버 문장, 네트워크는 "인터넷 연결을 확인하고 다시 눌러 주세요."), 버튼 다시 눌림.
- `PrinterStep`은 이제 단계 버튼을 `buttons(busy)`로 받아 직접 그린다(잠금 때문에). `WizardPage`의 유튜브 블록·import는 손대지 않았다.

### 음성 시험 (동작 변경 없음)
- AC-PL1B-23·24·25: `apps/web/test/pl1b-voice-flush.test.tsx` — 끝 넘김(`sayCut` = 중간 결과 뒤 최종 없이 onend) 문자찜 카드는 `autoAt null`·"N초 뒤 넣어요" 없음·30초 쓰기 0, "넣기" 1·"넣지 않기" 0, 대조군(보통 최종 → 3초 뒤 1), 같은 말·열린 카드 수 규칙 (a)=(b), 밀려 닫힘 알림은 넘긴 상품 카드만(넘긴 문자찜 카드는 D-V1-18로 닫히지 않음), 375px 내리기(`scrollBy`) 한 번·PC/고치는 중 0번.
- AC-PL1B-27: `voice-controller.test.ts`의 N3 미룸 시험 8개 위에 `// D-PL1-09` 주석. D-PL1-09 항목 중 **덮지 않던 것 셋을 더함**: 문자찜 문장도 카드만 미룸(보인 때부터 3초), 기다리는 중 엔진이 멈추면(오류) 바로 카드·자동 확정 없음, 자막·상태 글자는 미루지 않음. `HISTORY_WAIT_MS`·`controller.ts`는 그대로.

### 확인한 범위
- 웹 단위 시험 전체(`vitest --project web`) 76파일·1284개 통과, `tsc`(웹·노드 설정)·`eslint apps/web` 통과. 전체 `pnpm verify`·E2E는 돌리지 않았다(지시). 띄운 서버·브라우저 없음.

### 다음 영역에게
- **test-e2e**:
  - `tests/e2e/n5/billing.spec.ts`: 결제 전 안내는 "현금영수증(지출증빙)을 발행해요.", 사업자 정보 칸에 라디오가 없다(라디오 누르기가 있으면 실패한다). 이메일 칸 이름은 "증빙 받을 이메일 (선택)". 결제 내역 "현금영수증 발행됨 · TEST-…".
  - `tests/e2e/i2/packing.spec.ts` "B1 버튼 없음" → 라벨 켜짐이면 `region "포장 라벨"` 안에 `button "포장 라벨 출력"`이 있다(D-PL1-05).
  - AC-PL1B-15: 버튼을 누른 뒤 `role=status` "포장 라벨 2장 출력을 접수했어요."(12품목 2쪽). 라벨을 끄면 칸 안 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."·버튼 0개.
  - U-PL1B-01(원하면): 버튼을 화면 아래 끝까지만 내려 누른 뒤 결과 문장의 `boundingBox` 아래 끝이 뷰포트 안이고 375px에선 `.menu` 위인지(`elementFromPoint`가 문장 쪽).
  - AC-PL1B-19: 4/5에서 `button "라벨을 쓰지 않아요"` → `heading level 2 "5/5 리허설 해 보기"`.
  - AC-PL1B-26: 화면은 단위 시험과 같은 동작 — 카드의 "넣기"·"넣지 않기" 버튼, 카운트다운 글 없음.
- **ux**: 포장 모드 출력 버튼은 "라벨 PDF" 옆 보통 버튼, 접수·거절 문장은 버튼 줄 바로 아래 — 생기면 보이게 내리고 휴대폰은 메뉴 막대 위에 멈춘다(U-PL1B-01; mo-16·mo-13·pc-16 다시 찍어 확인 부탁). 마법사 버튼은 연결 칸 아래·단계 버튼 위, "나중에 할게요"는 단계 버튼 줄에 따로.
- **합치는 트랙(AC-PL1B-14)**: 위 "포장 모드" 마지막 줄.
