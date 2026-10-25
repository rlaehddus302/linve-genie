# CRM1 dev-notes

## dev-server (손님 기록·메모·설정 "손님 관리")

### 만든 것
- `apps/server/src/customers/summary.ts` — 요약 순수 함수 `customerSummary(today, settings, bundles)` (골든 G-CRM-001~013), `addDays`(달력 날짜, TZ 무관), `isNoPayReason`(공백 모두 뺀 글 = `입금안함`), `isUnpaid`·`isPurchase`.
- `apps/server/src/customers/facts.ts` — 날짜(실제 범위)마다 재료: 구매자(표지 `c:<채팅 키>`·`p:<전화번호 키>`), 지금의 구매자 묶음(items·subtotal·payment·cancels·noPay·record). 캐시 키 = (판매자, 범위 ID, 범위 seq, 봉인 여부) — D-CRM1-11.
  - `noPay`: 사유는 엔진 상태에 없어서, 그 범위에 '입금 안 함' 후보 조치(host.cancel·host.reject·host.assign replaceTo=CANCEL)가 있을 때만 이벤트 기록을 코어 `applyEvent`로 처음부터 다시 적용해 그 조치 앞뒤로 CONFIRMED → 취소·무효가 된 찜을 찾는다(판정 복제 아님 — 코어 상태 비교).
  - `cancels`: 가격 스냅샷이 있는(= 1등이었던) 찜 중 지금 `CANCELLED` 또는 `REJECTED(BY_HOST)`.
  - 기록 묶음 = items ≥ 1 또는 입금·환불 기록 있음 또는 cancels ≥ 1.
- `apps/server/src/customers/service.ts`·`api.ts`·`rules.ts` — 경로·검사. `server.ts`·`api.ts`에 연결(`LivejjimServer.customers`).
- DB: `customer_settings`(판매자마다 한 줄), `customer_memos`(덧붙이기, 표지마다 마지막 줄이 보임). 마이그레이션 `0020_crm1_customers.sql`. 복구·가져오기는 그대로 둔다(`RESTORE_KEPT_TABLES`) — 백업 파일엔 없다.
- 시험: `apps/server/test/crm1-golden.test.ts`(AC-01·02), `crm1-records.test.ts`(AC-03~12·16·18·30 일부), `crm1-memo-access.test.ts`(AC-21~23·25~27), 성능 `crm1-customers.perf.test.ts`(AC-31, 게이트 밖 — 90일×200명 p95 2초, 이 기계에서 한 번 통과 12초).
- 기존 시험 손봄(약화 아님, 주석 남김): `commands.test.ts` 표 수 69 → 71, `fb1-parcel-settings.test.ts` "마지막 마이그레이션 기록 지우기" → "0019(저널 when) 이후 기록 지우기 + 0020 표 지우기"(0020이 생겨 0019가 마지막이 아니게 됨).

### API (판매자 계정만 — 보조자 403 `ASSISTANT_FORBIDDEN`, 로그인 없음 401, 다른 판매자 404, 모두 `Cache-Control: no-store`, 엔진 이벤트·발송함 안 씀)

| 경로 | 뜻 |
|---|---|
| `GET /api/customer-settings` | `{ settings: { regularCount, regularAmount, waitDays } }` (기본 3·100000·3) |
| `PUT /api/customer-settings` | 본문 `{ regularCount, regularAmount, waitDays }` 셋 다(금액 비우기 = `null`). 정수(JSON 숫자)만. 틀리면 400 `INVALID_INPUT` `problems[{ field, message }]` — 문장은 D-CRM1-05 그대로. 모르는 키 400 `UNKNOWN_FIELD`. 응답 `{ settings }` |
| `GET /api/days/:date/customers` | 그날 지금의 구매자마다 `{ date, today, settings, customers: [{ buyer, purchaseDays, purchaseTotal, lastPurchase, unpaidDays, lastUnpaid, cancels, regular, caution }] }` (buyer 순). 구매자 목록 꼬리표·"누적 큰 순"·거르기와 **콘솔 1등 옆 "입금 늦음 주의"**가 이 하나를 쓴다. `?rehearsal=true`·리허설만 있는 날짜·없는 날짜 = 404 |
| `GET /api/days/:date/customer?buyer=` | 자세히 "손님 기록" 칸: `{ date, buyer(지금의 구매자로 푼 값), summary, members: [{ buyer, name, platform, kindLabel, phoneLast4, customer, memo }] }`. `members` = 묶음 구성원(지금의 구매자 → 합친 순서). `customer` = 불투명 손님 ID(32자 hex) — **null이면 전화번호 없는 문자 손님**: 메모 칸 대신 "전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요." `memo` = `{ text, savedAt(UTC ISO) }` 또는 null |
| `GET /api/customers?sort=total\|recent\|unpaid&filter=all\|regular\|caution&q=&offset=0` | "모든 손님": `{ today, settings, customers: CustomerRow[20], count, more, next(다음 offset 또는 null) }`. 틀린 값 400. `q` 40자까지, 번호 모양이면 400(D-079 ⑥ 문장 + hint) |
| `GET /api/customers/:id?before=YYYY-MM-DD` | 손님 자세히 `{ customer: CustomerRow, memo, days: [{ date, buyer, name, subtotal, payment, unpaid }], more, next(다음 before 날짜) }` — 날짜 최근부터 20개. 모르는 ID 404 |
| `PUT /api/customers/:id/memo` | 본문 `{ text }`. 바로 저장(5초 대기 아님). `\r\n`→`\n`, 앞뒤 공백 뺌, 빈 글 = 지움. 응답 `{ memo: { text, savedAt } \| null }`. 거절 400 `problems[{ field: 'text', message }]`: "메모는 200자까지 적을 수 있어요." · D-079 ⑥ 문장 · "메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요."(줄 나눔 밖 제어 글자·탭·짝 없는 서로게이트) · "메모는 글자로 보내 주세요." |

`CustomerRow` = `{ id, name(가장 최근 실제 날짜의 표시 이름), platform('YOUTUBE'|'INSTAGRAM'|'TIKTOK'|null), kindLabel("유튜브"·"인스타그램"·"틱톡"·"문자 · 끝자리 1234"), phoneLast4, blocked(가장 최근 날짜의 그 구매자 차단), latestDate, latestBuyer(그 날짜 구매자 ID — D-CRM1-09 "가장 최근 날짜(…)의 구매자 화면에서 차단할 수 있어요" 길), …요약 8칸 }`.

정렬: `total` = 누적 큰 순 → 이름 → ID / `recent` = 마지막 구매일 늦은 순(없으면 맨 뒤) → 이름 → ID / `unpaid` = 미입금 많은 순 → 누적 큰 순 → 이름 → ID. 이름 비교는 코드 포인트 순(한글 가나다와 같음). 찾기 = 날짜마다의 표시 이름·이름 이력(대소문자 무시) 또는 끝자리 숫자.

### dev-web에게
- 구매자 목록 "누적 큰 순"(같으면 이름 → 구매자 ID)·거르기는 `GET /api/days/:date/customers`의 `purchaseTotal`·`regular`·`caution`으로 화면에서 정렬·거른다(서버는 buyer 순으로만 준다). 리허설 날짜는 이 경로를 부르지 않는다(404).
- 콘솔: 실제 방송만, 1등의 지금의 구매자 `buyer`가 `caution: true`면 꼬리표. 단골은 콘솔에 안 쓴다. 실패(4xx·5xx·네트워크)면 꼬리표 없이 그대로, 오류 띠 없음. 다시 받기 10초에 한 번까지(D-CRM1-07).
- 날짜 문장("10월 15일(목)", 올해가 아니면 연도)·"N월 N일(요일) 저장"은 화면이 KST로 만든다(`savedAt`은 UTC ISO). 기준 연도는 응답의 `today`(서버 KST 날짜)로 보면 화면 기기 시계와 상관없다.
- `payment`는 `UNPAID`·`PARTIAL`·`PAID`·`OVERPAID` 그대로 오니 지금 정산 화면의 낱말로 바꿔 보인다(영어 노출 금지).
- 메모 칸 아래 "연락처·주소는 적지 마세요."는 화면 문구. 메모·이름은 늘 글자로(이스케이프).
- 설정 "손님 관리" 저장은 저장 막대 하나(D-FB1-06) — 이 칸만 바뀌었으면 `PUT /api/customer-settings` 하나. 금액 칸을 비우면 `regularAmount: null`. "10.5"처럼 정수가 아닌 글은 화면에서 숫자로 바꾸지 말고 그대로(문자열) 보내도 서버가 거절 문장을 준다.

### test-domain에게 (tests/adversarial/crm1)
- 모형 대조 기준: 표지 = `c:<채팅 구매자 키>`·`p:<전화번호 키>`(서버 안), 기록 = 그날 묶음 + 구성원 표지로 다른 실제 날짜의 그 표지 구매자의 지금의 구매자 묶음(한 번, 같은 (날짜, 묶음) 한 번), 기록 묶음만. 캐시 무효화 키는 범위 seq — 입금·취소·설정·시계 변경을 끼워도 처음부터 센 값과 같아야 한다.
- 시험용 진입점: `world.server.customers`(CustomerService), 날짜 재료를 새로 만든 횟수 `factsBuildCount()`(`src/customers/facts.ts`).
- 봉인 날짜: 봉인 장부엔 끝난 찜·조치 사유가 없어 그 날짜의 `cancels`·`noPay`(사유 (나))는 0, 구매·(가) 미입금은 장부의 정산 묶음으로 센다("봉인 장부 기준", D-CRM1-02). 모형도 그렇게 맞춰 주세요.

### test-e2e에게
- 위 API 그대로. 시계는 E2E 서버의 주입 시계가 오늘 날짜를 정한다.

### 범위 밖·주의 (disputesWithSpec 없음)
- 봉인 날짜의 취소·'입금 안 함' 취소 횟수는 0(장부에 없는 값을 지어내지 않음). spec-keeper가 다르게 원하면 봉인 장부 형식(youtube/seal.ts — 금지 경로)을 바꿔야 하므로 맥북 쪽 작업이 된다.
- 메모 글은 평문으로 저장한다(번호는 거절). 암호화·보관 기간은 "사용자 확인 필요"(DECISIONS).
