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

## dev-web (구매자 화면 꼬리표·손님 기록·모든 손님·메모·설정 "손님 관리"·콘솔 주의 꼬리표)

### 만든 것
- `apps/web/src/lib/customers.ts` — 서버 응답 타입, 낱말(`customerDate` 올해면 "10월 15일(목)"·아니면 "2025년 12월 29일(월)", 기준 연도 = 응답 `today`), `memoSavedWords`(UTC → KST "10월 26일(월) 저장"), `summaryLines`, 정렬 `byCumulative`(누적 → 이름 `localeCompare('ko')` → ID), 거르기 `passesFilter`, 받기 훅 `useDayCustomers(date, enabled, refresh, minGapMs)`(refresh가 바뀌면 다시 받되 minGap에 한 번, 실패면 받은 값 그대로).
- `components/CustomerParts.tsx` — `CustomerTags`("단골" `.tag-regular`·"입금 늦음 주의" `.tag-caution`·"차단"), `CustomerRecord`(구매자 자세히 "손님 기록" 칸, `GET /api/days/:date/customer?buyer=`, 404면 칸 없음), `MemoEditor`(바로 저장 `PUT /api/customers/:id/memo`, 200자 넘으면 보내지 않고 "메모는 200자까지 적을 수 있어요.", 서버 거절 문장은 칸 아래, 저장하지 않은 글은 떠나기 확인).
- `components/AllCustomers.tsx` — "모든 손님" 목록·손님 자세히.
- `components/CustomerSettings.tsx` — 설정 "손님 관리" 칸(저장 막대 단계 `customers`, 칸 이름 `손님 관리` — `lib/save-bar.ts`의 `SAVE_BLOCKS`·`SAVE_STEPS` 끝에 더함, 택배 다음 차례). 숫자(쉼표 묶음 허용)는 정수로, 아닌 글("10.5"·빈 칸)은 글 그대로 보내 서버 문장을 받는다. 금액 칸을 비우면 `null`. 보조자 화면엔 칸이 없다.
- `components/caution.tsx` — 콘솔 `CautionContext`·`useConsoleCaution`(실제 방송만, 1등 집합 `winnersKey`가 바뀌면 다시 받기 — 10초에 한 번, 첫 변화는 바로), `CautionMark`(누를 수 없는 `span`, 보이는 글 "입금 늦음 주의"/"주의"는 `aria-hidden`, 읽기 프로그램엔 `.sr-only` "입금 늦음 주의 손님"), `WinnerNames`.
- 콘솔: `ProductBoard.tsx`(현재 상품 카드 "1등: …", 상품 보드 줄, 번호 찾기 요약, 변형 줄, 휴대폰 요약 줄), `ProductDetail.tsx`(1등 목록 줄 — `CONFIRMED`만), `ConsolePage.tsx`(Provider 하나·훅 하나만). 주의 손님이 없으면 1등 글은 예전처럼 한 덩어리 글(기존 시험·E2E 글자 그대로).
- 휴대폰 요약 줄(`SummaryFit`): 긴 꼬리표를 넣어 줄 높이가 꼬리표 없을 때보다 커지면 "주의" 한 낱말. 잴 때만 줄 안에 보이지 않는 두 벌(`.summary-measure`, `aria-hidden`)을 두고 그림 전에 재고 뺀다 — 다 그린 뒤 DOM 글자엔 남지 않는다. 폭이 바뀌면(ResizeObserver) 다시 잰다. **"주의"도 한 줄을 늘리는 경우(꼬리표 없는 줄이 거의 꽉 찬 경우)는 그대로 "주의"로 둔다** — D-CRM1-07이 준 줄임은 "주의"까지라서. test-e2e가 AC-CRM1-20 측정에서 높이가 늘면 알려 주세요(그때는 1등 글 자르기 6글자 꼴 D-QL2-11 (3)을 꼬리표 있을 때만 쓰는 쪽을 검토).
- 주소(`lib/router.ts`): `/buyers?view=customers[&sort=recent|unpaid][&filter=regular|caution][&customer=<32자 ID>]` — 기본 `total`·`all`은 적지 않는다. 찾는 말은 주소에 넣지 않는다(끝자리 숫자일 수 있어서). 날짜 `date`는 그대로 남겨 "날짜별"로 돌아갈 때 쓴다.
- 스타일: `.tag-regular`(초록)·`.tag-caution`(갈색 글·노란 바탕, 굵게), `.memo-text`(`white-space: break-spaces` — 375px 규칙 시험이 `pre-wrap`을 막아서), `.memo-input`, `.summary-measure`, `.current-summary { position: relative }`.
- 단위 시험 `apps/web/test/crm1-customers.test.tsx`(17건): 낱말·정렬·거르기·주소, 설정 저장 막대(PUT 본문·거절 문장), 구매자 목록 꼬리표·누적 큰 순·거르기·실패·리허설, 자세히 손님 기록·메모(이스케이프·저장·200자·이벤트 안 씀), 모든 손님(20줄·더 보기·정렬 주소·자세히 날짜 줄·차단 길), 콘솔 꼬리표(글·읽기 글, 10초 간격·실패·리허설). 웹 단위 시험 전체 105파일 1620건 통과, `tsc`·`eslint` 통과. 전체 `pnpm verify`는 규칙대로 돌리지 않았다.

### 화면 계약 (test-e2e에게 — 역할·이름)
- 구매자 화면 맨 위 `group "보기"`: 버튼 "날짜별"·"모든 손님"(`aria-pressed`).
- 날짜별 목록(실제 날짜만): `group "정렬"`에 "이름 순"·"합계 큰 순"·"누적 큰 순", `group "거르기"`에 "모두"·"단골만"·"입금 늦음 주의만"(모두 `aria-pressed`). 목록 `list "구매자"`(휴대폰) / `table "구매자"`(48rem 이상) — 꼬리표는 줄 안 글자 "단골"·"입금 늦음 주의"·"차단". 손님 기록을 못 받으면(404 밖) 누적 정렬·거르기 없이 "손님 기록을 불러오지 못했어요." + "다시 불러오기". 리허설은 손님 기록 조회를 아예 부르지 않는다.
- 구매자 자세히: `region "손님 기록"`(지난 구매 `region "지난 구매"` 위). 메모 칸마다 제목 `heading "메모 · 유튜브 · 다육이맘"`/"메모 · 문자 · 끝자리 1234", 글 칸 이름 "메모 — {같은 이름}", 버튼 이름 "메모 저장 — {같은 이름}"(보이는 글 "메모 저장"), 저장 뒤 `status` "메모를 저장했어요."/"메모를 지웠어요.", 저장 날짜 "10월 ○일(○) 저장". 전화번호 없는 문자 손님은 글 칸 없이 "전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요.".
- 모든 손님: `region "모든 손님"`, 찾기 칸 이름 "손님 찾기"(0.3초 뒤 묻는다), `group "정렬"`("누적 큰 순"·"최근 산 순"·"미입금 많은 순"), `group "거르기"`, `status` "손님 n명", 목록 `list "손님"`/`table "손님"`, "더 보기 (n명 더)". 손님 자세히 `region "손님 자세히"`: 버튼 "모든 손님 목록으로", 링크 "가장 최근 날짜(10월 22일)의 구매자 화면에서 차단할 수 있어요", `region "날짜별 기록"`의 링크(날짜·"그날 이름 …"·"상품 합계 …"·입금 낱말·미입금 날 "미입금" — 입금 상태가 미입금인 미입금 날은 "미입금" 한 번만).
- 뒤로 가기: 손님 자세히 → 목록은 같은 정렬·거르기(주소)·찾는 말·불러온 줄(화면 기억)·스크롤 자리. 돌아오면 받아 둔 줄을 바로 보이고 같은 줄 수만큼 뒤에서 새로 받아 바꾼다(차단 꼬리표 반영).
- 콘솔: 꼬리표 요소 `.caution-mark`(누를 수 없음), 보이는 글 "입금 늦음 주의"(요약 줄은 넘치면 "주의"), 읽기 글 "입금 늦음 주의 손님". 가짜 500이면 꼬리표 없음·오류 띠 없음. 다시 받기는 1등 집합이 바뀔 때만, 10초에 한 번까지.

### 다음 영역에게
- **test-e2e**: 위 계약으로. 콘솔 꼬리표는 이벤트를 쓰지 않으니 "꼬리표 끈 같은 시나리오"는 `/api/days/:date/customers`를 가짜 500으로 막은 쪽과 비교하면 된다. 설정 칸 제목은 `heading "손님 관리"`, 칸 이름 "단골 횟수"·"단골 금액"·"입금 기다리는 날".
- **ux**: 날짜별 목록 도구 막대에 정렬 3·거르기 3 단추가 더해져 휴대폰에서 두세 줄로 감싼다(가로 스크롤 없음). 손님 자세히의 차단 길은 링크 모양(버튼 아님 — D-CRM1-09 "차단 버튼 없음").
- **dev-server**: 구매자 자세히 응답(`/api/days/:date/customer`)에 `today`가 없어 화면은 같은 날짜의 `/customers` 응답 `today`를 쓴다(아직 없으면 기기 KST 날짜). 넣어 주면 그쪽을 쓰게 바꾸겠다(필수 아님).
