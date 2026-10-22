# T1 dev-notes

## [device] 운송장 (packages/documents, PC-7)

- 새 파일 `packages/documents/src/waybill.ts`, 공개 이름은 `@livejjim/documents`에서 내보낸다.
  - 순수 함수(골든 `tests/golden/waybill`): `code128Codes(invoice)` → `{ codes }` | `{ error: 'FORMAT' }`, `maskPhone(phone)`, `formatInvoiceNumber(invoice)`, `isInvoiceNumber(value)`.
  - `layoutWaybill(data, font)` → `{ ok: true, layout }` | `{ ok: false, error: { code: 'TOO_LONG' | 'FORMAT', message } }`. PDF는 이 배치를 그대로 그린다.
  - `renderWaybillsPdf(list, font)` → `{ pdf: Uint8Array | null, outcomes: [{ index, invoice, ok, error? }] }`. 준 순서대로 쪽마다 하나. 넘치는 것(TOO_LONG)·모양이 틀린 것(FORMAT)은 그것만 빠지고, 다 빠지면 `pdf: null`.
  - `WaybillData` = `{ carrier: 'FAKE' | 'EPOST', invoice, receiver: { name, phone, address, detail, zip, memo }, sender: { name, phone, address, detail? }, itemCount, box: '극소'|'소'|'중'|'대', bookedDate: 'YYYY-MM-DD' }`. 받는 분은 PC-2가 다듬은 값(연락처는 숫자만)을 넘긴다. 구매자 ID·닉네임·가격 자리는 없다.
  - 오류 문장 `WAYBILL_TOO_LONG_MESSAGE` = "주소가 길어 운송장에 다 들어가지 않아요."
- 배치: 막대 한 칸 1.2pt(≈0.423mm, 300dpi에서 5화소), 높이 17mm, 앞뒤 빈칸 10칸. 받는 분·보내는 사람 글은 12pt부터 0.5pt씩 7pt까지 줄인다.
- 시험: `packages/documents/test/waybill.test.ts`. PDF를 pdfjs + `@napi-rs/canvas`(문서 패키지 devDependency로 추가, 라벨 패키지와 같은 1.0.11)로 300dpi 그림으로 바꾸고, 시험 안의 해독기가 가로줄을 읽어 송장번호·검사값·한 칸·높이·빈칸을 확인한다.
- Code 128 무늬 표는 기억으로 적은 표준 표다. 시험은 표 전체의 성질(107개가 서로 다름, 11칸/끝 13칸, 막대 칸 합 짝수)과 잘 알려진 무늬 7개만 확인한다. 실제 바코드 스캐너·택배 기사 단말기로 읽히는지는 HG-T1(사용자 실물 확인) 몫이다.
- AC-T1-44 문서·라벨 쪽: 문서 패키지는 라벨·프린터 패키지에 기대지 않는다(시험), 라벨 크기 목록은 그대로다(`packages/label/test/t1.test.ts`). 서버 쪽(출력 기록 표에 운송장 행 없음)은 dev-server 몫이다.

## [server] 택배 자동 접수 (apps/server, PC-1~PC-8)

새 폴더 `apps/server/src/parcel/`: `rules.ts`(순수 함수·문장), `carrier.ts`(어댑터), `fake-carrier.ts`(가짜 택배사), `store.ts`(DB), `service.ts`(`ParcelService`), `api.ts`(경로).
표 넷(마이그레이션 `0014_t1_parcels.sql`): `parcel_addresses`(암호문만) · `parcels`(접수 시도 — 부분 고유 색인 `parcels_live_uq`) · `parcel_requests`(화면 요청 번호) · `parcel_settings`.

### 순수 함수 (골든 `tests/golden/parcel`, 시험 `apps/server/test/t1-parcel-golden.test.ts`)
- `readAddress({ name, phone, address, detail, zip, memo })` → `{ ok }` | `{ errors }` (PC-2). `parcelEligibility(facts)` → `{ ready: true }` | `{ reason }` (PC-4).
- 칸 문장 `ADDRESS_ERROR_MESSAGES`, 이유 문장 `ELIGIBILITY_MESSAGES`, 실패 문장 `FAILURE_MESSAGES`, 그 밖 `PARCEL_MESSAGES`.

### API (판매자 세션만 — 보조자는 모두 403(roles.ts 기본 거부), 다른 판매자의 날짜·구매자는 404, 모든 답 no-store)
- `GET /api/parcels/settings` → `{ settings: { carrier: 'FAKE'|'EPOST'|null, carriers: [{ code, name, available, note }], customerNoLast4, sender: { name, phone, address, detail, zip } | null, shopName, box, boxes } }`
  - `carriers`: 가짜 택배는 시험 모드(E2E 기동·서버 시험)에서만 목록에 있다(이름 "가짜 택배(시험용)"). 우체국은 `available: false, note: '준비 중'`.
  - 보내는 사람 이름이 비면 화면이 `shopName`을 기본값으로 채운다.
- `PUT /api/parcels/settings` `{ carrier?, customerNo?, sender?, box? }` — 적지 않은 칸은 그대로. `customerNo: ''`는 지움, `sender: null`은 지움, `carrier: null`은 끊음. `EPOST`·운영의 `FAKE`는 400.
  틀린 보내는 사람은 400 `{ error: { problems: [{ field: 'sender.phone', message }] }, codes: ['PHONE_INVALID', …] }`(PC-2와 같은 칸 코드).
- `GET /api/parcels/days` → `{ dates: [{ date, ready, booked }], selected }` — 실제 범위 날짜만(리허설·봉인 없음, 최근 먼저), `selected` = 고를 수 있는 묶음이 있는 가장 최근 날짜(없으면 가장 최근).
- `GET /api/parcels/days/:date` → `{ date, seq, blocked: { code: 'NO_SENDER'|'NO_CARRIER', message } | null, carrier: { code, name } | null, box, ready: Row[], excluded: Row[], booked: Row[] }`. 없는·봉인한·리허설(`?rehearsal=true`) 날짜는 404.
  - `Row` = `{ buyer, name, phoneLast4, itemCount, qty, total, payment('UNPAID'…— 화면이 D-092 말로), packing(포장 상태 말), shipping('NONE'|'FIXED'|'PICKUP'|'COMBINED'), address('NONE'|'UNCONFIRMED'|'CONFIRMED'), ready, reason, message, box, parcel }` — 순서는 확인서 일괄 순서(D-I2-04).
  - `parcel`(ParcelBrief) = `{ state('PENDING'|'UNKNOWN'|'BOOKED'|'FAILED'|'CANCELLED' — 2분 넘은 PENDING은 UNKNOWN), carrier, carrierName, invoice, invoiceText('9000-0000-0001'), status('접수됨'|'집하'|'배송 중'|'도착'|'접수 취소됨'|null), checkedAt(ISO|null), trackUrl, reason('ADDRESS'|'REJECTED'|'UNAVAILABLE'|null), message(화면 문장|null), box, qty, bookedAt, cancellable }` | null.
  - 영어 값(state·reason·payment·address·shipping)은 화면에 그대로 내지 않는다 — `message`·`status`·`packing`을 쓴다.
- `GET /api/parcels/days/:date/bundle?buyer=` → `{ bundle: { date, buyer, address: { name, phone(숫자만), address, detail, zip, memo, source: 'BUYER'|'SELLER', confirmed, updatedAt(ISO) } | null, locked, expired, row: Row } }` — 묶음 자세히의 배송지 칸.
- `PUT /api/parcels/days/:date/address` `{ requestId, buyer, address: { 여섯 칸 } }` → `{ bundle }` (판매자가 적으면 "확인함"). 틀리면 400 `problems[].field = 'address.phone'…` + `codes`.
- `POST /api/parcels/days/:date/address/confirm` `{ requestId, buyer, updatedAt }` → `{ bundle }`. 그 사이 구매자가 고쳤으면 409 `ADDRESS_CHANGED` "구매자가 배송지를 바꿨어요. 다시 확인해 주세요."
- `POST /api/parcels/days/:date/address/delete` `{ requestId, buyer }` → `{ bundle }`.
  - 셋 다 살아 있는 접수가 있으면 409 `PARCEL_LOCKED` "택배 접수를 먼저 취소해 주세요.", 리허설 409 `REHEARSAL_PARCEL`, 봉인 409 `SEALED`. 같은 요청 번호면 처음 결과(그 묶음의 지금 모습).
- `POST /api/parcels/days/:date/book` `{ requestId, items: [{ buyer, box? }] }`(1~200, 201개는 400 `TOO_MANY`) → `{ date, results: [{ buyer, ok: true, invoice, invoiceText } | { buyer, ok: false, reason, message }] }`
  - **"다시 확인"·"실패한 것만 다시"도 이 경로**: `UNKNOWN`(또는 2분 넘은 `PENDING`)인 묶음은 다시 판단하지 않고 같은 택배사 요청 번호로 다시 묻는다. `FAILED`·`CANCELLED`는 다시 판단 뒤 새 요청 번호. 이미 접수한 묶음은 `reason: 'BOOKED'`(택배사에 아무것도 가지 않음).
  - `reason` ∈ PC-4 이유 · `ADDRESS`·`REJECTED`·`UNAVAILABLE`(택배사) · `BUYER`(합쳐진 구매자) · `SEALED` · `ADDRESS_EXPIRED`. 화면은 `message`를 그대로 보인다.
  - 보내는 사람·택배사가 없으면 409 `PARCEL_BLOCKED`(그 문장). 같은 화면 요청 번호면 택배사에 새로 보내지 않고 처음 결과. 모르는 구매자가 섞이면 404(아무것도 안 함).
- `POST /api/parcels/days/:date/cancel` `{ requestId, buyer }` → `{ bundle }`. 집하 뒤·택배사 거절 409 `PICKED_UP`, 접수 없음 409 `NO_PARCELS`, 택배사 응답 없음 503 `CARRIER_UNAVAILABLE` "취소됐는지 아직 몰라요. 잠시 뒤 다시 해 주세요."(BOOKED 그대로 — 다시 눌러도 된다).
- `GET /api/parcels/days/:date/waybill.pdf?buyer=` · `GET /api/parcels/days/:date/waybills.pdf` → PDF(`운송장-YYYY-MM-DD-<이름>.pdf`·`운송장-YYYY-MM-DD-전부.pdf`), 머리글 `X-Waybill-Count`·`X-Waybill-Skipped`.
  접수함 없음 409 `NO_PARCELS` "접수한 택배가 없어요.", 배송지 지움 409 `ADDRESS_EXPIRED`, 넘침(하나짜리) 422 `WAYBILL_TOO_LONG`, 바쁨 429 `BUSY`.
- 기존 경로에 더한 것 (AC-T1-52): `GET /api/days/:date`의 `packing[]`, `GET /api/days/:date/packing`의 `entries[]`에 `parcel`(ParcelBrief, 실패한 시도·없음이면 null).
- 포장 명령(`POST /api/days/:date/packing`): 살아 있는 접수가 있으면 `unpack`·`unship`·`ship`이 409 `PACKING_STATE` "택배 접수를 먼저 취소해 주세요."
- 실시간: `event: parcel` `{ date, buyer }`(배송지·접수·취소·조회가 바뀐 묶음) · `{ settings: true }`. 접수·취소 뒤에는 `event: packing`도 온다. 값(주소·송장)은 담지 않는다 — 화면은 다시 읽는다.

### 구매자 링크 (`/r/<토큰>`, receipt-page.ts)
- 확인서 아래 `<section id="address">`(양식·받았어요·한 문장) 또는 `<section id="parcel">`(택배를 보냈어요). 양식은 `POST /r/<토큰>/address`(application/x-www-form-urlencoded, 여섯 칸 `name·phone·address·detail·zip·memo`, Origin = 앱 주소).
  저장 303 → 같은 링크. 틀림 400(칸 문장 `<p class="error" data-code="PHONE_INVALID">`, 입력 `aria-invalid`). 잠금·직접 수령·합배송·30일 지남 409(위 문장 `role="alert"`). Origin 다름 403. 한도 429(문서·그림·PDF·양식 합 1분 60번).
- 다시 적기 = `/r/<토큰>?edit=1#address`(빈 양식). CSP `form-action 'self'`(스크립트는 여전히 없음).

### 시험·E2E
- E2E 기동은 기본으로 가짜 택배사를 띄운다(`--parcel no`로 끈다, `--parcel-port`, `--parcel-track-ms`(기본 5000)). 시작 줄에 `가짜 택배 http://127.0.0.1:<포트>`.
- 조작(E2E 서버 주소, JSON POST, 세션 없음): `/_e2e/parcel/status { invoice, status: ACCEPTED|PICKED_UP|IN_TRANSIT|DELIVERED }` · `/_e2e/parcel/fail { op: book|cancel|track, kind: ADDRESS|REJECTED|TIMEOUT|TIMEOUT_AFTER_BOOK|ERROR_500|BAD_INVOICE|REFUSED, times? }` · `/_e2e/parcel/track {}`(지금 조회 한 바퀴) · `/_e2e/parcel/sweep {}`(지금 30일 정리) · `GET /_e2e/parcel/requests`(받은 요청 — 본문 포함) · `/_e2e/parcel/reset {}`.
- 받는 분 주소에 `[주소거절]`·`[접수거절]`·`[응답없음]`·`[접수후응답없음]`·`[서버오류]`·`[송장이상]`을 넣어도 그 실패가 난다. 가짜 송장번호는 `900000000001`부터 차례로.
- 서버 시험 도우미 `apps/server/test/t1-support.ts`(`parcelWorld`·`parcelSeller`·`makeReady`·`parcelApi`). 적대 시험은 `FakeCarrier`(`apps/server/src/parcel/fake-carrier.ts`)를 `createServer({ parcel: { carriers: { FAKE: fake.adapter({ timeoutMs }) } } })`로 붙인다.

### 정한 것 (스펙 문장 해석 — 판매자 안전 쪽)
- 합치기의 배송지 옮기기는 그 합치기 기록의 날짜(범위)에서만 한다 — 엔진의 합치기는 범위(날짜)마다라, 다른 날짜의 X는 그대로 다른 구매자다(아래 disputes).
- 떼어 낼 구매자가 붙은 묶음에 접수 결과를 기다리는 시도(PENDING·UNKNOWN)가 있으면 떼어 내기를 409로 막는다(BOOKED은 지금 규칙대로 배송 완료 기록이 막는다).
- 판매자 백업 파일(형식 번호 2)에 접수 시도 표를 더하지 않았다 — 접수는 포장 기록 "배송 완료 — 송장번호"(날짜·구매자·송장·시각)로 파일에 들어간다. 복구는 배송지·화면 요청 번호를 지우고 접수 시도·설정은 둔다(같은 묶음을 택배사에 다시 접수하지 않게).
- 운영 기동의 `LIVEJJIM_EPOST_API_KEY`는 값이 있는지만 보고 경고 `PARCEL_CARRIER_NOT_READY`를 남긴다(.env.example·DEPLOY의 키 목록 = 코드가 읽는 키 시험 때문).

### 남은 것 (다른 영역)
- [web] `/privacy` 개인정보처리방침 초안 문장(AC-T1-80 — `apps/web/src/components/PolicyPages.tsx`): 수집 항목(받는 분·연락처·주소·배송 메모)·목적(배송)·제공(택배사)·보관(주문 날짜 + 30일), 초안 표시.
