# KP1 공용 인터페이스 계약서 (dev-server · dev-web · dev-device)

> 근거: `acceptance.md`(AC-KP1-01~29), CUSTOMER_RULES CR-0~CR-9, MESSAGE_RULES MR-0~MR-8, PARCEL_RULES PC-3·PC-4, SPEC BUY-06·BUY-08·RPT-01~08·SCH-01~03·MSG-01, D-KP1-01~21, 골든 `customers/`·`message/`·`report/`.
> 규칙서와 이 계약이 다르면 규칙서가 맞다. **가정**은 스펙에 없는 세부를 판매자에게 안전한 쪽으로 정한 것이다(DECISIONS는 spec-keeper 몫이라 쓰지 않았다 — 끝 "spec-keeper에게" 참고).
> 이미 끝난 몫: dev-device `packages/documents/src/customers.ts`(커밋 9ae91fc7) — §5는 그 코드를 그대로 적었다.

## 0. 공통 약속

- 경로는 모두 `/api` 공통 미들웨어 아래(로그인 401, 상태를 바꾸는 요청은 Origin·JSON 객체·64KB, `Cache-Control: no-store`, 다른 판매자 것 404). **보조자는 `roles.ts` 허용 목록에 넣지 않아 403** — KP1은 `roles.ts`를 고치지 않는다.
- 오류 본문은 기존 `apiError(status, code, message, problems)` 모양 `{ error: { code, message, problems: [{ field, message, hint? }] } }`. 받은 값(번호·이름·코드 글)은 오류·로그에 되돌리지 않는다.
- 날짜 = `YYYY-MM-DD`(KST 달력), 시각 = UTC ISO(`iso()`), 금액 = 정수 원. 서버 "오늘" = `kstDate(clock.now())`.
- **표지(marker)** = CRM1 `facts.ts`와 같은 글: 채팅 구매자 `c:<구매자 키>`(유튜브 채널 ID·`ig:`·`tt:`·`band:`), 전화번호가 있는 문자 구매자 `p:<전화번호 키>`. 표지는 서버 안에서만 쓰고 응답에 내지 않는다.
- 엔진(`packages/core`)은 바꾸지 않는다. 어떤 KP1 경로·작업도 엔진 이벤트·발송함을 쓰지 않는다. 문자·알림톡을 보내는 코드 경로를 만들지 않는다(가짜 솔라피 포함 0번).
- 실시간: `hub.publishNamed(sellerId, 'customers', { what: 'settings' | 'ledger' })`를 더한다(데이터에 ID·표지·이름 없음). 웹 `lib/stream.ts`의 `STREAM_EVENTS`에 `'customers'`를 더한다. 배송지 저장·확인은 기존 `'parcel'` `{ date, buyer }` 그대로.

## 1. 순수 함수 (서버 모듈, I/O 없음) — 골든 `in` → `out` 그대로

골든 시험은 `in`을 그대로 넘기고 반환값을 `out`과 깊은 같음으로 본다. 함수는 시계·난수·DB를 쓰지 않는다(`Date` 생성은 인자 시각 파싱만).

### 1.1 `apps/server/src/customers/ledger-rules.ts` (골든 `customers/`, 4파일·44사례)

| kind | 함수 | 입력 | 출력 |
|---|---|---|---|
| `retention` | `ledgerDeleteOn(input: { lastOrder: string \| null; consentOrder: string; consentMonths: LedgerMonths; settingMonths: LedgerMonths })` | 날짜·개월(6·12·24·36) | `{ deleteOn: string }` |
| `code` | `matchLinkCode(input: { text: string; codes: readonly string[] })` | 채팅 본문·살아 있는 코드 | `{ code: string \| null }` |
| `badge` | `customerBadge(input: { show; rehearsal; known; earlier; regular; caution: boolean; purchaseTotal: number })` | | `{ text: string \| null }` |
| `prefill` | `showLedgerPrefill(input: { items: number; shipping: 'NONE'\|'FIXED'\|'PICKUP'\|'COMBINED'; saved: 'NONE'\|'UNCONFIRMED'\|'CONFIRMED'; lines: number })` | | `{ ledger: boolean }` |

같은 파일에 더 둔다(골든 밖, 단위 시험은 서버 `test/`):
- `export type LedgerMonths = 6 | 12 | 24 | 36`, `LEDGER_MONTHS = [6, 12, 24, 36] as const`, `DEFAULT_LEDGER_MONTHS = 12`, `ledgerMonthsWord(m)` → `"6개월"·"1년"·"2년"·"3년"`.
- `LINK_CODE_WORDS`(CR-5 48낱말, 순서 그대로), `LINK_CODE_TTL_MS = 24h`, `pickLinkCode(taken: ReadonlySet<string>, randomIndex: (n: number) => number): string | null` — 서로 다른 두 낱말 `"구름 바다"`, 남은 짝이 없으면 null(난수는 부르는 쪽이 `crypto.randomInt`로 준다).
- `maskRecipient(name: string): string` — **가정**: 코드 포인트 1자 `*`, 2자 `홍*`, 3자 이상 첫·끝 글자 사이를 `*`로(`홍길동`→`홍*동`, `남궁민수`→`남**수`). `phoneLast4`는 `parcel/rules.ts` 것을 쓴다.
- `badgeSpoken(text: string): string` → `"손님: 단골, 누적 125,000원"`(` · `를 `, `로).
- 문구: `CR_CONSENT_1 = { id: 'CR-CONSENT-1', title: '다음 주문에도 이 배송지 쓰기 (선택)', body(shop, monthsWord) }`(CR-2 글 그대로).

### 1.2 `apps/server/src/messaging/rules.ts` (골든 `message/`, 4파일·57사례) — AC-KP1-25

| kind | 함수 | 출력 |
|---|---|---|
| `bytes` | `messageBytes(text: string): number` | 0 이상 정수 |
| `compose` | `composeMessage(input: { kind: MessageKind; shop: string; body: string; optOut: string; recipients: number }, price: MessagePrice = DEFAULT_MESSAGE_PRICE)` | `{ text, bytes, type: 'SMS'\|'LMS', cost }` 또는 `{ error: 'EMPTY'\|'NO_OPT_OUT'\|'OPT_OUT_INVALID'\|'TOO_LONG' }` |
| `window` | `canSendAt(input: { kind: MessageKind; at: string })` | `{ sendable: true }` 또는 `{ sendable: false, next: 'YYYY-MM-DDTHH:MM:SS+09:00' }` |
| `consent` | `consentStatus(input: { now: string; records: readonly { type: 'AGREE'\|'VERIFY'\|'WITHDRAW'\|'NOTICE'; at: string }[] })` | `{ status: 'NONE'\|'PENDING'\|'ACTIVE'\|'WITHDRAWN'\|'EXPIRED', due: string \| null }` |

- `MessageKind` = MR-1 일곱(`RECEIPT_LINK`·`PAYMENT_DUE`·`SHIPPED`·`CONSENT_RESULT`·`CONSENT_NOTICE`·`BROADCAST_ALERT`·`FREE_TEXT`), `AD_KINDS`, `MessagePrice = { SMS: number; LMS: number }`, `DEFAULT_MESSAGE_PRICE = { SMS: 20, LMS: 50 }`(골든 시험은 파일 머리 `price`를 넘긴다).
- `MR_CONSENT_1 = { id: 'MR-CONSENT-1', body(shop) }`(MR-6 글 그대로).
- 발송 스프린트가 쓰게 `apps/server/src/index.ts`에 한 줄 `export * from './messaging/rules.ts'`. 이 폴더엔 보내기 코드가 없다(SMS3 갈래가 같은 이름을 만들면 이 파일을 쓰게 맞춘다).

### 1.3 `apps/server/src/report/rules.ts` (골든 `report/`, 5파일·36사례)

| kind | 함수 | 입력 → 출력 |
|---|---|---|
| `summary` | `reportSummary({ bundles: { buyer; keys: string[]; items; subtotal; final; received }[]; earlier: string[] })` | `ReportSummary = { sales, qty, received, unpaid, refund, buyers, unpaidBuyers, newBuyers, returningBuyers, unknownBuyers }` |
| `buckets` | `reportBuckets({ claims: { time; qty; amount }[] })` | `{ start: 'YYYY-MM-DD HH:MM'; qty; amount }[]` |
| `varieties` | `reportVarieties({ sales: { name; qty; amount }[] })` | `{ name; qty; amount }[]` |
| `rush` | `reportRush({ products: { b; no; name; stock; opened: string \| null; claims: { time; buyer }[] }[] })` | `{ b; no; name; buyers; waiting }[]` |
| `compare` | `reportCompare({ current: { sales; qty; buyers }; past: { date; sales; qty; buyers }[] })` | `{ last: CompareLast \| null; recent: CompareRecent \| null }` |

`CompareLast = { date, sales, qty, buyers, diff: { sales, qty, buyers } }`, `CompareRecent = { count, sales, qty, buyers, diff: {…} }`. `RUSH_WINDOW_MS = 30_000`, `NO_NAME_VARIETY = '이름 없음'`.

### 1.4 골든 시험 자리 (서버 패키지 안 — `tests/**`는 쓰지 않는다)

`apps/server/test/kp1-customers-golden.test.ts`(파일 4·사례 44), `kp1-message-golden.test.ts`(4·57), `kp1-report-golden.test.ts`(5·36). `crm1-golden.test.ts`와 같은 방식: `../../../tests/golden/<폴더>`의 `*.json` 전부, 파일 키 `kind·about·cases`(compose만 `price` 더), 사례 키 `id·title·refs·note?·in·out`, 모르는 kind·키·중복 ID는 읽기 오류, 파일 수·사례 수 고정값, `TZ`를 `UTC`·`Asia/Seoul`·`America/Los_Angeles`로 바꿔 같음.

## 2. DB 표와 마이그레이션

- 파일 하나: `apps/server/drizzle/00NN_kp1_customer_ledger.sql` + `drizzle/meta/_journal.json` 한 항목. **NN = 합칠 때 다음 빈 번호**(지금 main 마지막 0029, `dev/yt-thanks-official`이 0030을 씀 → 가정 0031. 합치는 쪽이 겹치면 번호만 바꾼다). 표 정의는 `src/db/schema.ts` 끝에 `// KP1` 덩어리로 붙이고 schema 묶음 객체에 더한다.
- 모든 표에 `seller_id → sellers.id`, 모든 쿼리에 판매자 조건. 새 표는 모두 `backup.ts`의 `RESTORE_KEPT_TABLES`에(파일에 없고 복구가 지우지 않는다 — CR-3, 표지 기준). 판매자 백업·"전체 기록 내려받기"에는 넣지 않는다.

| 표 | 칸 (요점) | 비고 |
|---|---|---|
| `ledger_settings` | `seller_id` PK, `months` int(6·12·24·36), `console_badges` bool, `updated_at` | 없으면 `{ months: 12, consoleBadges: true }` |
| `ledger_lines` | `id` text PK(무작위 32 hex), `seller_id`, `contact_enc` text, `consent_date` text(가장 최근 동의 묶음 날짜), `consent_months` int, `created_at`, `updated_at` | 연락처 다섯 칸 JSON(`name·phone·address·detail·zip`, 배송 메모 없음)을 `sealText(masterKey, aad, json)`, AAD = `livejjim/customer-ledger/v1/${JSON.stringify([sellerId, lineId])}` (`parcel/store.ts` `sealAddress`와 같은 방식) |
| `ledger_markers` | `seller_id`, `marker`, `line_id`, `source` `'CONSENT'\|'CODE'`, `label_platform`·`label_name`·`label_last4`(CODE만), `linked_at`; UNIQUE(`seller_id`,`marker`) | 한 표지는 한 줄에만(CR-1) |
| `ledger_consents` | `id` bigserial, `seller_id`, `line_id` text(FK 없음 — 줄이 지워져도 남음), `type` `AGREE·WITHDRAW·EXPIRE·SELLER_DELETE`, `items` text(`받는 분·연락처·주소·상세 주소·우편번호`), `wording` `'CR-CONSENT-1'`, `months` int, `route` `'RECEIPT_LINK'\|null`, `order_date` text\|null, `reason` text\|null(`'표지 옮김'`·`'기간 지남'`·`'줄 합침'`), `account_id`\|null(SELLER_DELETE), `at` | 덧붙이기만. 연락처·표지·토큰·구매자 ID 없음 |
| `ledger_codes` | `id`, `seller_id`, `line_id`, `code` text, `created_at`, `expires_at`, `state` `'LIVE'\|'CLAIMED'\|'DONE'`, `claimed_marker`·`claimed_platform`·`claimed_name`·`claimed_last4`·`claimed_at` | **가정**: 코드 글은 평문(개인정보 아님, 24시간 1회) — 로그에는 남기지 않는다. 줄을 지우면 함께 지움 |
| `customer_exports` | `id`, `seller_id`, `account_id`, `contact` bool, `at` | 파일 내용 없음(CR-6) |
| `schedule_pages` | `seller_id` PK, `enabled` bool, `token_hash` text UNIQUE\|null, `token_enc` text\|null, `channel_url` text\|null, `updated_at` | 토큰 = 32바이트 base64url 43자. 찾기 = `receiptTokenHash`와 같은 SHA-256 base64url, 판매자 화면 주소용 원문 = `sealSellerText(masterKey, 'schedule-page-token', sellerId, token)` |
| `schedule_items` | `id` text, `seller_id`, `starts_at` timestamptz, `title`, `intro`, `created_at`, `updated_at` | 개인정보 없음 |
| `alert_subscribers` | `id` text, `seller_id`, `phone_key` text\|null, `phone_enc` text\|null, `created_at`; 부분 UNIQUE(`seller_id`,`phone_key`) WHERE `phone_key IS NOT NULL` | 원문 = `sealSellerText(masterKey, 'alert-phone', sellerId, normalized)`. **가정**: 키 = `phoneKeyOf(sellerKey, 'alert:' + normalized)` — 손님 표지 `p:` 키와 이어지지 않게(MR-8 "구매를 동의로 보지 않음") |
| `alert_consents` | `id` bigserial, `seller_id`, `subscriber_id`, `type` `AGREE·VERIFY·WITHDRAW·NOTICE`, `wording` `'MR-CONSENT-1'\|null`, `route` `'SCHEDULE_PAGE'\|null`, `at` | 덧붙이기만. 번호 없음 |

암호화 도우미는 기존 `src/secrets.ts`만 쓴다: `sealText`/`openText`(AAD 묶음), `sealSellerText`/`openSellerText`(용도·판매자 묶음), `phoneKeyOf`, `openSellerKey`, `sha256Hex`, `SecretError`(풀리지 않으면 "없음"으로 본다).

## 3. REST 경로

권한 표기: **판매자** = 판매자 세션만(보조자 403·로그인 없음 401·남의 것 404·`no-store`), **링크** = 확인서 링크 토큰(`/r/<토큰>`, 로그인 없음, 서버 HTML), **공개** = `/s/<토큰>`(서버 HTML).

### 3.1 설정 "손님 관리" 더하기 (`customers/ledger-api.ts`)

| 메서드·경로 | 요청 | 응답 200 |
|---|---|---|
| `GET /api/ledger-settings` | — | `{ settings: LedgerSettings }` |
| `PUT /api/ledger-settings` | `{ months: 6\|12\|24\|36, consoleBadges: boolean }`(둘 다) | `{ settings }` + hub `customers {what:'settings'}` |

오류 400 `INVALID_INPUT`: `months` "보관 기간을 다시 골라 주세요.", `consoleBadges` "방송 화면에 손님 표시를 다시 골라 주세요." 모르는 키 400 `UNKNOWN_FIELD`. 기존 `/api/customer-settings`(세 칸)는 그대로 둔다 — 화면은 같은 "손님 관리" 절에서 두 PUT을 보낸다.

### 3.2 콘솔 손님 표시 (CR-7, AC-KP1-14·16)

`GET /api/days/:date/customer-badges?buyer=<id>&buyer=<id>…` — 판매자.
- `buyer` 1~50개(URL 인코딩, 겹치면 하나로). 0개·51개 이상·모양이 틀리면 400 `INVALID_INPUT`("손님을 1~50명씩 물어 주세요."). `?rehearsal=true`는 404(CRM1 `realDate`와 같음), 실제 범위가 없는 날짜 404.
- 응답 `{ show: boolean, badges: { buyer: string; text: string | null; spoken: string | null }[] }` — 물은 순서대로 모두. `show=false`(설정 끔)면 모든 `text=null`.
- 서버: 구매자 → 표지(채팅이면 `c:`+ID, `sms:`면 그날 재료의 표지) → `customerBadge({ show, rehearsal:false, known, earlier, regular, caution, purchaseTotal })`. `earlier` = 이 날짜보다 앞선 실제 날짜에 그 표지의 기록 묶음이 있음, 나머지는 그 표지의 "모든 손님" 줄 요약(`CustomerService`의 index — 오늘 KST·지금 설정).

### 3.3 묶음 배송지 "확인 전" (CR-4, PC-3·PC-4, AC-KP1-08)

- `GET /api/parcels/days/:date/bundle?buyer=` 응답 `bundle`에 칸 하나 더: `ledger: LedgerPrefill | null`.
  `LedgerPrefill = { ledgerId: string; updatedAt: string; name: string; phone: string; address: string; detail: string; zip: string }`(판매자에겐 다섯 칸 전부). `showLedgerPrefill`이 참일 때만(리허설·봉인 날짜는 null).
- `ledger`가 있으면 그 묶음의 `row.address` = `'UNCONFIRMED'`(택배 목록·접수 판단 PC-4 `ADDRESS_UNCONFIRMED`). `bundle.address`는 null 그대로(복사하지 않음).
- `POST /api/parcels/days/:date/address/ledger` — 판매자. `{ requestId, buyer, ledgerId, updatedAt }`(updatedAt = `bundle.ledger.updatedAt` 그대로) → `{ bundle }`. 그때 장부 연락처(+ `memo: ''`)를 `putAddress(source 'SELLER', confirmed true)`로 저장(요청 종류 `'LEDGER'`를 `ParcelRequestKind`에 더함).
  - 409 `NO_LEDGER` "지난 주문 배송지가 없어졌어요. 배송지를 직접 적어 주세요." (줄이 지워졌거나 더 이상 하나가 아님)
  - 409 `LEDGER_CHANGED` "지난 주문 배송지가 바뀌었어요. 다시 확인해 주세요."
  - 409 `ADDRESS_EXISTS` "이미 이 묶음에 배송지가 있어요." · 그 밖 기존 `PARCEL_LOCKED`·`SEALED`·`ADDRESS_EXPIRED`·`REQUEST_ERROR`·404 그대로.
- [고치기] = 기존 `PUT /api/parcels/days/:date/address`(화면이 장부 다섯 칸으로 채운 양식, 메모 빈칸). 판매자 저장은 장부에 아무것도 쓰지 않는다(AC-KP1-04).

### 3.4 손님 자세히 장부·지우기 (AC-KP1-07·11)

- `GET /api/customers/:id` 응답에 `ledger: CustomerLedgerView | null` 더함:
  `{ ledgerId; name: string /* maskRecipient */; phoneLast4: string; keepUntil: string /* deleteOn */; consentDate: string; linked: { label: string /* "유튜브 홍길동(끝 1234)" */; linkedAt: string }[] }`. 그 손님 표지가 든 줄이 없으면 null. **가정**: 손님 자세히엔 가린 이름·끝 4자리만(전체 다섯 칸은 묶음 자세히에서만).
- `POST /api/customers/:id/ledger/delete` — 판매자. `{ ledgerId }` → `{ ledger: null }`. 동의 기록 `SELLER_DELETE`(account_id), 줄·표지·코드 지움, hub `customers {what:'ledger'}`. 줄이 이미 없거나 이 손님 줄이 아니면 409 `NO_LEDGER` "이미 지운 장부예요." 묶음 배송지·동의 기록은 그대로.
- 장부를 만드는 판매자 경로는 없다(AC-KP1-04).

### 3.5 손님 엑셀 (CR-6, AC-KP1-12·13)

`GET /api/customers.xlsx?contact=0|1` — 판매자(경로를 `/customers/:id`와 겹치지 않게 `customers.xlsx`). `contact` 없으면 0, 다른 값 400.
응답: `Content-Type` xlsx, `Content-Disposition: attachment; filename*=UTF-8''손님-YYYY-MM-DD.xlsx`(기존 `files.ts` `contentDisposition`·`fileResponse`). 같은 트랜잭션 아닌 직후에 `customer_exports`에 한 줄(누가·언제·contact). 손님이 0명이어도 머리줄만 있는 파일.

### 3.6 방송 리포트 (RPT, AC-KP1-17~19)

`GET /api/days/:date/report` — 판매자. `?rehearsal=true` 404, 실제 범위 없음 404.
```ts
interface ReportView {
  date: string
  live: boolean            // 그날 끝나지 않은 실제 회차가 있다 → "방송 중이라 숫자가 바뀌고 있어요"
  sealed: boolean          // 30일 봉인 → buckets·rush는 null ("보관 기간이 지나 볼 수 없어요.")
  summary: ReportSummary   // reportSummary 그대로
  compare: { last: CompareLast | null; recent: CompareRecent | null }
  rush: RushRow[] | null   // 많아야 5개(서버가 자른다)
  varieties: VarietyRow[]  // 전부 — 화면이 10개 + "더 보기"
  buckets: BucketRow[] | null
}
```
재료: 정산 묶음·찜은 코어 조회(`getSettlement`·`listClaims`), 봉인 날짜는 `readSealed`. `earlier` = 앞선 실제 날짜에 품목 있는 묶음의 표지(CRM1 index). `compare.past` = 이 날짜보다 앞선 실제 날짜(늦은 순)의 sales·qty·buyers. 손님 이름·연락처·표지는 응답에 없다. 저장하지 않고 볼 때 계산.
**가정**: 앞선 "실제 방송 날짜" = 실제 범위가 있는 날짜(판매 0인 날 포함 — `realScopes`). 공개 시각 `opened` = 그 상품이 처음 OPEN이 된 이벤트의 `at`(범위 이벤트에서 서버가 찾음).

### 3.7 방송 일정 (SCH-01·02, AC-KP1-20·21·23) — `schedule/api.ts`

| 메서드·경로 | 요청 | 응답 200 |
|---|---|---|
| `GET /api/schedule` | — | `ScheduleView` |
| `PUT /api/schedule/page` | `{ enabled: boolean, channelUrl: string \| null }` | `ScheduleView` |
| `POST /api/schedule/page/renew` | `{}` | `ScheduleView`(새 토큰, 옛 주소 404) |
| `POST /api/schedule/items` | `{ date, time: 'HH:MM', title, intro }` | `ScheduleView` |
| `PUT /api/schedule/items/:id` | 같은 본문 | `ScheduleView` |
| `DELETE /api/schedule/items/:id` | `{}` | `ScheduleView` |
| `GET /api/schedule/alerts` | — | `{ pending: number; active: number; withdrawn: number }` |

```ts
interface ScheduleView {
  page: { enabled: boolean; url: string | null /* `${appOrigin}/s/<토큰>` 켜졌을 때만 */; channelUrl: string | null }
  items: { id: string; date: string; time: string; startsAt: string; title: string; intro: string }[] // 다가오는 것만, 시각 순
  max: 10
}
```
- 검사(400 `INVALID_INPUT`, 칸마다): 제목 앞뒤 공백 뺀 1~40자 "제목은 1~40자로 적어 주세요.", 소개 0~100자 "소개는 100자까지 적을 수 있어요.", 날짜·시각 "날짜와 시각을 확인해 주세요.", 제어 글자 "쓸 수 없는 글자가 있어요. 빼고 적어 주세요.", 휴대폰 번호 모양(`containsPhoneRun`) = `PHONE_NUMBER_MESSAGE`(R-1 문장). **가정**: 시작 시각이 지금보다 앞이면 "지난 시각은 적을 수 없어요."
- 11번째 다가오는 일정: 409 `SCHEDULE_FULL` "다가오는 방송은 10개까지 적을 수 있어요."
- `channelUrl` **가정**: `https://`이고 호스트가 `youtube.com`·`www.youtube.com`·`m.youtube.com`, 200자 이하, 아니면 "유튜브 채널 주소를 확인해 주세요." 빈 글은 null.
- 끄면 토큰을 지운다(옛 주소 404). **가정**: 다시 켜면 새 토큰.
- 지난 일정은 공개 페이지·`items`에서 빠지고 정리 작업이 지운다(**가정**).
- `alerts` 수 = 구독자마다 `consentStatus`: `PENDING`·`ACTIVE`·`WITHDRAWN` 셈(번호 목록·내려받기·대신 넣기 경로 없음).

### 3.8 공개 일정 페이지 `/s/<토큰>` (SCH-02·03, MR-6, AC-KP1-21·22) — `schedule/page.ts`, 서버 HTML

- `GET /s/<토큰>` → 200 HTML: 가게 이름·다가오는 일정(`kstDateTimeWithDay`)·채널 주소(있으면, `rel="noopener noreferrer"`)·알림 받기 양식·그만 받기 양식. 일정이 없으면 "다가오는 방송이 아직 없어요."(가정). 손님·판매 정보 없음.
- 헤더: `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` + `<meta name="robots" content="noindex,nofollow">`, `X-Content-Type-Options: nosniff`, CSP = `RECEIPT_PAGE_CSP`(스크립트 없음, `form-action 'self'`).
- 모르는·꺼진·옛 토큰 404 HTML("이 주소는 열 수 없어요."). 토큰마다 1분 60번(GET·POST 합) 넘으면 429 "잠시 뒤 다시 열어 주세요."(기존 `LinkRateLimiter`).
- `POST /s/<토큰>/alert` 양식 `phone`, `agree=on` — Origin 검사 = `formFromApp`(아니면 403 HTML). **알림 신청 한도**: 토큰마다 1분 10번 **그리고** 접속 주소(`clientAddress`)마다 1분 10번(가정 — 둘 다), 넘으면 429.
  - 체크 없음 → 400 "알림 받기에 동의해 주세요." (저장 없음) · `normalizePhone`이 null → 400 "휴대폰 번호를 확인해 주세요." (저장 없음). 오류 쪽에 적은 번호를 다시 채우지 않는다.
  - 저장 → `AGREE`(`MR-CONSENT-1`, `SCHEDULE_PAGE`) → 303 `/s/<토큰>?done=agree&on=YYYY-MM-DD` → "{가게} 방송 알림을 신청했어요 (2026-10-31)."
- `POST /s/<토큰>/stop` 양식 `phone` → 있으면 `WITHDRAW` + `phone_key`·`phone_enc`를 바로 null. 없는 번호도 똑같이 303 `?done=stop&on=…` → "{가게} 방송 알림을 그만 받아요 (2026-10-31)." 번호 모양이 틀리면 400 "휴대폰 번호를 확인해 주세요."
- 그 밖 메서드 405. 번호는 응답·로그에 없다.

### 3.9 확인서 링크 `/r/<토큰>` 더하기 (CR-2·CR-3·CR-4·CR-5, AC-KP1-02·03·05·07·08·09·11) — 서버 HTML(`receipt-page.ts`)

링크 화면은 스크립트 없는 서버 HTML이라 **dev-server 몫**이다(acceptance의 [web] 표시가 붙은 링크 쪽 문장도). 모든 POST는 기존 `formFromApp` 검사·링크 한도(1분 60번)에 함께 센다. 성공은 303 `/r/<토큰>#ledger`(또는 `#address`).

- **동의 칸**: 배송지 양식(`form`) 안, 저장 버튼 위에 `<input type="checkbox" name="keep" value="on">`(처음 빔) + `CR-CONSENT-1` 글(`{기간}` = 지금 설정). 보이는 때 = 양식이 보이고 + 리허설·봉인 아님 + 구성원 표지가 하나 이상. `POST /r/<토큰>/address`가 `keep`을 0개 또는 `on` 1개로 받는다(그 밖은 400). 고르면 `ParcelService.saveFromLink(..., keep: true)`가 같은 트랜잭션에서 `LedgerService.consentInTx(tx, …)`를 부른다(CR-2 합치기: 겹치는 줄 → 가장 먼저 만든 ID, 표지 ∪, 연락처 = 이번 다섯 칸, 합쳐 없어진 줄은 `EXPIRE` 까닭 `'줄 합침'`(가정), `AGREE` 한 줄). 칸이 안 보이는 묶음에서 온 `keep=on`은 무시하고 배송지만 저장.
- **배송지 칸의 "지난번 배송지"**: `LinkSection`에 `{ kind: 'ledger'; name: string /* 가림 */; last4: string }` 더함 — 묶음 배송지가 없고 `showLedgerPrefill` 참일 때. 글 "지난번 배송지로 보낼게요 (받는 분 홍*동 · 연락처 끝 5678). 바뀌었으면 다시 적어 주세요." + [다시 적기](`?edit=1#address`, 빈 양식).
- **장부 칸**(`<section id="ledger">`): 구성원 표지가 든 장부 줄이 **정확히 하나**일 때만(가정 — 둘 이상이면 남의 것일 수 있어 보이지 않음). 리허설·봉인 날짜엔 없음. 주소 원문 없음.
  - "저장해 둔 배송지가 있어요 (받는 분 홍*동 · 연락처 끝 5678)" + [저장한 정보 지우기](`?ledger=delete#ledger`) + [다른 계정도 잇기](POST `/r/<토큰>/ledger/code`).
  - `GET /r/<토큰>?ledger=delete` → 같은 쪽에 "저장한 배송지를 지울까요? 이번 주문 배송지는 그대로예요." + [지우기](POST `/r/<토큰>/ledger/delete`) + [그대로 두기](`/r/<토큰>#ledger`). 지운 뒤 303 `?ledger=deleted` → "지웠어요." (`WITHDRAW`)
  - `POST /r/<토큰>/ledger/code` → 새 코드(전 코드는 `DONE`), 303. 화면: "라이브 방송 채팅에 아래 두 낱말만 쳐 주세요. 24시간 동안 한 번 쓸 수 있어요." + **코드** + "{끝나는 시각}까지". 짝이 없으면 409 HTML "잠시 뒤 다시 받아 주세요."
  - 코드가 `CLAIMED`이고 24시간 안: "{플랫폼} '{이름}'(끝 {끝4})이 코드를 쳤어요. 내 계정이 맞나요?" + `POST /r/<토큰>/ledger/link` 양식 `answer=yes|no` 두 버튼 [네, 제 계정이에요]·[아니에요]. yes → 표지를 이 줄로 옮김(다른 줄에서 빼고 빈 줄은 `EXPIRE` `'표지 옮김'`), `ledger_markers.source='CODE'`·이름표, 303 `?ledger=linked` "계정을 이었어요."(가정). no → 코드 `DONE`, 303 `?ledger=unlinked` "잇지 않았어요. 필요하면 새 코드를 받아 주세요."(가정). 기한이 지났으면 버리고 장부 칸만.
  - 끝 4자리 **가정** = 그 채팅 구매자 키의 끝 4글자(유튜브 채널 ID 끝 4자리와 같음, BUY-01).
- 링크 쪽 405 처리기에 새 POST 경로를 더한다.

### 3.10 채팅에서 연결 코드 읽기 (CR-5, AC-KP1-10)

`server.ts`의 `txHook` 묶음에 `ledger.txHook(tx, ctx)`를 더한다 — 트랜잭션 안에서는 DB를 쓰지 않고, `ctx.rehearsal`이 아니고 `type==='chat'`·`owner!==true`·그 회차 엔진 설정 `claim.parseMode!=='OPTIONS'`인 기록만 골라 **커밋 뒤** 함수로 넘긴다. 커밋 뒤: 그 판매자의 살아 있는 코드(`LIVE`, 기한 안)로 `matchLinkCode`, 맞으면 조건부 UPDATE(`state='LIVE'`일 때만 → `CLAIMED`)로 한 번만. 실패해도 기록·판정에 영향 없음(오류 로그는 코드 이름만, 본문·코드 글 없음). 이벤트를 쓰지 않는다.

### 3.11 정리 작업 (CR-3, MR-6, AC-KP1-06·24)

`customers/ledger-sweep.ts` `LedgerSweeper`(시작 때 + 1시간마다, `CustomerArchiver`와 같은 timer 방식, 시험은 가짜 시계):
1. 장부 줄마다 `ledgerDeleteOn({ lastOrder, consentOrder: consent_date, consentMonths, settingMonths })` → 오늘 KST ≥ deleteOn이면 지움 + `EXPIRE` `'기간 지남'`. `lastOrder` = 줄의 표지 중 품목 있는 묶음을 가진 가장 늦은 실제 날짜(봉인 날짜는 장부로, CRM1 index).
2. 기한 지난 `LIVE` 코드 → `DONE`, 만든 지 24시간 지난 `CLAIMED` → `DONE`.
3. 알림 구독자마다 `consentStatus`가 `EXPIRED`면 번호·키 null.
4. 지난 일정 지움.
지운 것이 있으면 hub `customers {what:'ledger'}`.

## 4. 웹이 쓰는 타입·함수 (dev-web)

웹은 기존 관례대로 `api/client.ts`의 `get`·`put`·`post`·`del`·`getFile`, 요청 번호가 필요한 쓰기는 `command.send`(ParcelParts와 같음)를 쓴다. 타입은 웹 `lib/`에 따로 적는다(서버 모듈을 가져오지 않는다).

- `apps/web/src/lib/ledger.ts`
  - 타입: `LedgerSettings { months: 6|12|24|36; consoleBadges: boolean }`, `CustomerBadge { buyer; text: string|null; spoken: string|null }`, `BadgesView { show; badges }`, `LedgerPrefill`(§3.3), `CustomerLedgerView`(§3.4).
  - 함수: `fetchLedgerSettings()`, `saveLedgerSettings(value)`, `fetchBadges(date, buyers)`(`withQuery`로 `buyer` 여러 개), `deleteCustomerLedger(customerId, ledgerId)`, `customersXlsxPath(contact: boolean)` → `'/api/customers.xlsx?contact=1'`.
  - 문구: `LEDGER_MONTH_WORDS`, `CONSOLE_BADGES_LABEL = '방송 화면에 손님 표시'`, `CONSOLE_BADGES_HELP = '방송 화면을 녹화하거나 송출 화면에 띄운다면 꺼 주세요. 손님에게 보이면 안 되는 표시예요.'`, `LEDGER_MONTHS_LABEL = '손님 장부 보관 기간'`, `PREFILL_TITLE = '지난 주문 배송지예요 — 확인해 주세요'`, `XLSX_CONTACT_LABEL = '연락처·주소도 넣기'`, `XLSX_CONTACT_WARNING = '연락처가 든 파일은 다른 사람에게 보내지 마세요.'`, `LINKED_PREFIX = '이 손님이 직접 이은 계정: '`.
  - 꼬리표 받기 훅 `useChatBadges(date, rehearsal, buyers)`: 새 구매자만 모아 4초 이상 간격(`BADGE_GAP_MS = 4_000`), 한 번에 50명, 받은 구매자는 콘솔을 다시 열 때까지 다시 묻지 않음, 실패는 조용히(오류 띠 없음), 리허설이면 부르지 않음. `show=false`면 꼬리표와 1등 옆 "입금 늦음 주의"를 모두 숨긴다. stream `'customers'` `{what:'settings'}`를 받으면 설정을 다시 받는다.
- `apps/web/src/lib/report.ts`: `ReportView` 등(§3.6), `fetchReport(date)`, 문구 `REPORT_TITLE = '방송 리포트'`, `TODAY_REPORT = '오늘 리포트 보기'`, `LIVE_NOTE = '방송 중이라 숫자가 바뀌고 있어요'`, `SEALED_NOTE = '보관 기간이 지나 볼 수 없어요.'`, `NO_COMPARE = '처음 방송이라 비교할 게 없어요'`, `RECEIVED_HELP = '받은 돈은 배송비를 포함해요'`, `compareWords(diff, unit)` → "지난 방송보다 12,000원 많아요"·"…적어요"·"지난 방송과 같아요"(가정 — 적음·같음 문장).
- `apps/web/src/lib/schedule.ts`: `ScheduleView`·`AlertCounts`, `fetchSchedule()`, `saveSchedulePage(enabled, channelUrl)`, `renewSchedulePage()`, `addScheduleItem(input)`, `editScheduleItem(id, input)`, `removeScheduleItem(id)`, `fetchAlertCounts()`. 화면 낱말: `PENDING` "신청 기다림", `ACTIVE` "받는 중", `WITHDRAWN` "그만 받음"(영어 상태값을 화면에 내지 않는다).
- 화면 자리: 정산(구매자) 화면 날짜의 "방송 리포트" → `/report?date=YYYY-MM-DD`, 방송을 끝낸 콘솔의 "오늘 리포트 보기" → 같은 주소. 설정 `/settings`의 "손님 관리" 절에 보관 기간·손님 표시, 새 절 "방송 일정"·"방송 알림"(수만). 리포트 화면 순서·375px는 RPT-07.

## 5. dev-device 몫 — 손님 엑셀 (끝남, 9ae91fc7)

`packages/documents/src/customers.ts`, `index.ts`에서 내보냄:
```ts
buildCustomersXlsx(input: CustomersXlsxInput): Promise<CustomersXlsxResult>
CustomersXlsxInput = { date: string /* 받는 날 KST */; rows: CustomerXlsxRow[]; includeContact: boolean }
CustomerXlsxRow = { name; kind; totalWon; purchaseCount; lastPurchaseDate?: string|null; unpaidCount; regular; lateWarning; memo?: string|null;
                    contact?: { recipient?; phone?; address?; addressDetail?; zip?; keepUntil? } | null }
CustomersXlsxResult = { fileName: `손님-${date}.xlsx`; bytes: Uint8Array }
```
서버(`GET /api/customers.xlsx`)가 부르는 법: "모든 손님" 줄을 `sort='total'`·거르기 없이 전부 만든 순서 그대로 넘긴다(함수는 `totalWon` 내림차순 안정 정렬). 대응: `name←row.name`, `kind←row.kindLabel`, `totalWon←purchaseTotal`, `purchaseCount←purchaseDays`, `lastPurchaseDate←lastPurchase`, `unpaidCount←unpaidDays`, `regular`, `lateWarning←caution`, `memo←마지막 메모 글`, `contact`(contact=1이고 그 표지의 장부 줄이 있을 때만) `{ recipient←name, phone, address, addressDetail←detail, zip, keepUntil←deleteOn }`. 글자 빼기·`'` 앞붙이기·정수 칸은 함수가 한다 — 서버는 다시 하지 않는다.

## 6. 영역 경계 (겹치지 않게)

동시에 PRN2·SMS3·채팅·음성 갈래가 `apps/server`·`apps/web`을 고친다. **공용 파일은 목록의 자리만, 끝에 붙이는 덩어리(`// KP1` 주석)로, 줄 바꿈·정렬을 바꾸지 않는다.**

**dev-server** (새 파일 — 마음대로)
- `apps/server/src/customers/ledger-rules.ts`·`ledger-store.ts`·`ledger.ts`(LedgerService)·`ledger-api.ts`·`ledger-page.ts`(링크 HTML 조각)·`ledger-sweep.ts`·`badges.ts`
- `apps/server/src/messaging/rules.ts` · `apps/server/src/report/{rules,service,api}.ts` · `apps/server/src/schedule/{rules,service,api,page}.ts`
- `apps/server/drizzle/00NN_kp1_customer_ledger.sql`, `apps/server/test/kp1-*.test.ts`(+ `kp1-support.ts`)

**dev-server** (기존 파일 — KP1에 꼭 필요한 곳만)
- `src/db/schema.ts`(끝에 표), `drizzle/meta/_journal.json`(한 항목), `src/backup.ts`(`RESTORE_KEPT_TABLES` 끝에 새 표)
- `src/server.ts`(서비스 만들기·`txHook` 한 줄·정리 작업 시작/멈춤·`receiptPage` 클로저에 `registerSchedulePage` 한 줄), `src/api.ts`(`ApiDeps`에 `ledger?`·`report?`·`schedule?`, 등록 세 줄), `src/hub.ts`(`'customers'` 종류), `src/index.ts`(메시지 규칙 내보내기 한 줄)
- `src/receipt-page.ts`(동의 칸·`ledger` 배송지 칸·장부 칸·새 POST 경로·405 목록), `src/parcel/service.ts`(`bundle.ledger`·`row.address`·`linkSection` `ledger`·`saveFromLink(keep)`·`confirmFromLedger`), `src/parcel/api.ts`(경로 하나), `src/parcel/store.ts`(`ParcelRequestKind`에 `'LEDGER'`)
- `src/customers/api.ts`·`service.ts`(자세히 `ledger` 칸·`customers.xlsx`·지우기·표지 조회 도우미 `markersOf`)
- `.env.example`은 새 키 없음(마스터 키 그대로).

**dev-web**
- 새: `apps/web/src/lib/{ledger,report,schedule}.ts`, `apps/web/src/components/{CustomerLedger,ChatBadges,CustomersXlsxDialog,ReportPage,ScheduleSettings,AlertCounts}.tsx`, 각 단위 시험(`*.test.ts(x)`, 웹 패키지 안)
- 기존(필요한 곳만): `components/AllCustomers.tsx`(엑셀 버튼·자세히 장부 칸), `components/ParcelParts.tsx`(확인 전 칸·[배송지 확인]·[고치기]), `components/ChatPanel.tsx`(꼬리표), `components/caution.tsx`(끄면 숨김), `components/ConsolePage.tsx`(꼬리표 제공·"오늘 리포트 보기"), `components/SettlementsPage.tsx`(또는 날짜 줄이 있는 `BuyersPage.tsx` — "방송 리포트" 링크 하나), `components/CustomerSettings.tsx`(보관 기간·손님 표시 칸), `components/SettingsPage.tsx`(절 둘 붙이기), `lib/router.ts`(`/report`), `App.tsx`(경로 하나), `lib/stream.ts`(`'customers'`), `api/parcel-types.ts`(`BundleView.ledger`)
- 링크(`/r/…`)·공개 일정(`/s/…`) 화면은 서버 HTML이라 웹이 만들지 않는다.

**dev-device**: `packages/documents/src/customers.ts`(끝남). 바꿀 일이 생기면 서버 호출부와 같이 맞춘다.

**아무도 쓰지 않음**: `packages/core/**`, `docs/spec/**`, `docs/DECISIONS.md`, `tests/**`, `apps/server/src/roles.ts`(기본 거부로 보조자 403).

## 7. spec-keeper에게 (고치지 않고 적어 둠)

1. **이름 가리기 어긋남**: CR-2는 "PC-3처럼 이름 가운데를 `*`로"라 하지만 PC-3 "보이는 것"은 "받는 분 이름 + 연락처 끝 4자리"이고 지금 링크 `saved` 칸도 이름 전체를 보인다. KP1은 장부 쪽만 가리고 기존 `saved` 칸은 그대로 둔다 — PC-3도 가릴지 정해 주세요.
2. **알림 신청 한도 "같은 주소"**: SCH-03·AC-KP1-22의 "같은 주소에서 1분 10번"이 페이지 주소(토큰)인지 접속 IP인지 애매 — 둘 다 세는 쪽으로 했다.
3. **acceptance 태그**: AC-KP1-05·07·11의 링크 쪽 문장은 [web]으로 붙어 있으나 링크 화면은 스크립트 없는 서버 HTML(D-T1-06)이라 dev-server가 만든다.
4. **합친 묶음의 장부 칸**: 구성원 표지가 서로 다른 장부 줄 둘 이상에 걸치면 링크에 장부 칸(지우기·코드)을 보이지 않게 했다(남의 장부 노출 방지). 그 손님은 판매자에게 지워 달라고 해야 한다 — 맞는지 확인.
5. **합쳐 없어진 줄의 동의 기록**: CR-2 합치기에서 사라지는 줄에 남길 기록 종류가 없다 — `EXPIRE` + 까닭 `'줄 합침'`으로 가정.
6. **"끝 1234"의 출처**: 인스타그램·틱톡·밴드 계정의 "끝 4자리"가 무엇인지 없다 — 구매자 키 끝 4글자로 가정.
7. **AC-KP1-23 수**: 신청 기다림·받는 중·그만 받음 셋만 — 기한 지남(`EXPIRED`) 수는 보이지 않는다. 그대로 두는지.
8. **리포트 "앞선 실제 방송 날짜"**: 판매가 0인 실제 날짜를 비교 대상에 넣는지 없다 — 넣는 쪽(실제 범위가 있는 날짜)으로 가정.
9. **일정 지난 시각·다시 켜기**: 지난 시각 일정 적기 거절, 공개 끈 뒤 다시 켜면 새 주소 — 스펙에 없어 가정.
10. **링크 장부 동작 뒤 문장**: 코드 "네"/"아니에요" 뒤 화면 문장이 스펙에 없다 — "계정을 이었어요." / "잇지 않았어요. 필요하면 새 코드를 받아 주세요."로 가정.
