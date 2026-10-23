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
- 본문 한도 16KB(`ADDRESS_FORM_MAX_BYTES`): Content-Length가 넘으면 바로 400, 길이를 밝히지 않은(chunked) 본문은 `readCapped`가 한도를 넘는 순간 읽기를 취소하고 400(9af06b7).
- 다시 적기 = `/r/<토큰>?edit=1#address`(빈 양식). CSP `form-action 'self'`(스크립트는 여전히 없음).

### 시험·E2E
- E2E 기동은 기본으로 가짜 택배사를 띄운다(`--parcel no`로 끈다, `--parcel-port`, `--parcel-track-ms`(기본 5000)). 시작 줄에 `가짜 택배 http://127.0.0.1:<포트>`.
- 조작(E2E 서버 주소, JSON POST, 세션 없음): `/_e2e/parcel/status { invoice, status: ACCEPTED|PICKED_UP|IN_TRANSIT|DELIVERED }` · `/_e2e/parcel/fail { op: book|cancel|track, kind: ADDRESS|REJECTED|TIMEOUT|TIMEOUT_AFTER_BOOK|ERROR_500|BAD_INVOICE|REFUSED, times? }` · `/_e2e/parcel/track {}`(지금 조회 한 바퀴) · `/_e2e/parcel/sweep {}`(지금 30일 정리) · `GET /_e2e/parcel/requests`(받은 요청 — 본문 포함) · `/_e2e/parcel/reset {}`.
- 가짜 택배사는 접수를 요청 번호로 멱등하게 다룬다(PC-1): 이미 받은 요청 번호에는 주입한 거절(`ADDRESS`·`REJECTED` — failNext·`/_e2e/parcel/fail`)이 듣지 않고 처음 송장을 준다. 응답 없음·500·송장 이상은 이미 받은 요청 번호에도 그대로 난다.
- 받는 분 주소에 `[주소거절]`·`[접수거절]`·`[응답없음]`·`[접수후응답없음]`·`[서버오류]`·`[송장이상]`을 넣어도 그 실패가 난다. 가짜 송장번호는 `900000000001`부터 차례로.
- 서버 시험 도우미 `apps/server/test/t1-support.ts`(`parcelWorld`·`parcelSeller`·`makeReady`·`parcelApi`). 적대 시험은 `FakeCarrier`(`apps/server/src/parcel/fake-carrier.ts`)를 `createServer({ parcel: { carriers: { FAKE: fake.adapter({ timeoutMs }) } } })`로 붙인다.

### 정한 것 (스펙 문장 해석 — 판매자 안전 쪽)
- 합치기의 배송지 옮기기는 그 합치기 기록의 날짜(범위)에서만 한다 — 엔진의 합치기는 범위(날짜)마다라, 다른 날짜의 X는 그대로 다른 구매자다(아래 disputes).
- 떼어 낼 구매자가 붙은 묶음에 접수 결과를 기다리는 시도(PENDING·UNKNOWN)가 있으면 떼어 내기를 409로 막는다(BOOKED은 지금 규칙대로 배송 완료 기록이 막는다). — SA-T1-01: 스펙에 없는 결정이라 spec-keeper에게 DECISIONS(AUTO)·PARCEL_RULES PC-3에 올려 주기를 요청. 막는 까닭: 택배사가 이미 그 묶음(X 품목 포함)을 접수했을 수 있는데 결과를 모르는 채 떼어 내면, 접수된 상자와 정산 묶음이 어긋나 X의 품목이 두 번 보내지거나 빠진다. 결과가 정해지면(다시 확인 → BOOKED/FAILED) 지금 규칙대로 된다.
- (SA-T1-01로 고침) 판매자 백업·전체 기록(형식 번호 2 그대로)에 `parcels` 칸을 packing 뒤·digest 앞에 더했다 — 접수 시도마다 `{ date, buyer, carrier, invoice, state, at }`만(D-T1-07 "택배사·송장번호·상태", AC-T1-06 여섯 칸; `at` = 상태를 바꾼 시각 UTC). 요약값은 `["parcel", 기록]`을 더하고 끝 조각이 `["end", 범위 수, 포장 수, 접수 수]` — 칸이 없는 옛 파일은 예전 요약값 그대로 읽는다. 검사는 여섯 칸 밖의 칸이 있으면 거절(배송지가 섞여 들어오지 않게). 복구는 파일의 접수 기록을 넣지 않는다 — 배송지·화면 요청 번호를 지우고 DB의 접수 시도·설정은 둔다(같은 묶음을 택배사에 다시 접수하지 않게).
- 구매자 링크 양식의 Origin (TE-T1-003): 링크 화면은 `Referrer-Policy: no-referrer`(D-N4b-02 그대로)라 브라우저가 같은 출처 양식 POST에 `Origin: null`을 보낸다. `Origin`이 앱 주소이거나, `Origin: null`이면서 `Sec-Fetch-Site: same-origin`(브라우저만 붙이는 머리글)일 때만 받는다(`formFromApp`). 정책을 same-origin으로 바꾸는 쪽은 D-N4b-02 문장과 어긋나 고르지 않았다. spec-keeper에게: PC-3 "Origin이 앱 주소일 때만"에 이 해석을 DECISIONS(AUTO)로 올려 주세요. Sec-Fetch-Site를 보내지 않는 옛 브라우저(사파리 16.4 전)는 여전히 거절된다 — 거절 문장은 "다른 곳에서 보낸 양식이라 받지 않았어요. 받은 링크를 다시 열어 그 화면에서 보내 주세요. 그래도 안 되면 판매자에게 알려 주세요."(판매자가 손으로 적는다).
- 운영 기동의 `LIVEJJIM_EPOST_API_KEY`는 값이 있는지만 보고 경고 `PARCEL_CARRIER_NOT_READY`를 남긴다(.env.example·DEPLOY의 키 목록 = 코드가 읽는 키 시험 때문).

### 남은 것 (다른 영역)
- [web] `/privacy` 개인정보처리방침 초안 문장(AC-T1-80 — `apps/web/src/components/PolicyPages.tsx`): 수집 항목(받는 분·연락처·주소·배송 메모)·목적(배송)·제공(택배사)·보관(주문 날짜 + 30일), 초안 표시.

## [web] 택배 화면 (apps/web, AC-T1-60~66·80)

### 화면·주소
- 메뉴 "택배"는 `lib/menu.ts`의 `moreItems` 맨 뒤 — PC는 "설정" 바로 앞, 휴대폰은 "더보기" 목록의 "설정" 바로 앞(요금이 켜져 있으면 "요금" 다음). 보조자에겐 없다. 실제 날짜(정산·구매자·포장·택배에서 보던)가 있으면 `/parcels?date=` 로 잇는다.
  - 순서: `입금 확인 · 포장 · 라벨(켜짐) · 요금(켜짐) · 택배 · 설정`. **기존 E2E의 메뉴 목록 단언(tests/e2e/nav/phone-menu.spec.ts `LIST_ON`/`LIST_OFF`·185행, tests/e2e/n3/round1.spec.ts 246행, tests/e2e/n5/billing.spec.ts 480행)은 "택배"가 빠져 있어 test-e2e가 고쳐야 한다**(AC-T1-60 — AC-NAV-01·02 다시 확인).
- `/parcels?date=YYYY-MM-DD` (`components/ParcelsPage.tsx`) — 날짜가 없으면 `GET /api/parcels/days`의 `selected`를 기록 없이 주소에 적는다. 서버가 404면 "그 날짜는 택배를 접수할 수 없어요. 다른 날짜를 골라 주세요."
- `/settings/parcel` = 설정 화면의 "택배" 칸으로 스크롤·포커스 (목록 위 "설정으로" 링크가 여기로).

### 택배 접수 화면 (E2E가 잡는 이름)
- 제목 h1 "택배 접수", 날짜 고르기 `combobox "날짜"`(글: `2026년 10월 22일(목) · 보낼 수 있어요 1 · 접수 0`).
- 세 무리 = `region` 이름 정확히 **"보낼 수 있어요"·"아직 못 보내요"·"접수했어요"**(수는 제목 밖 "n개").
  - 보낼 수 있어요: 줄마다 `checkbox` 이름 = 구매자 표시 이름(기본 체크), `combobox "상자 크기"`(극소·소·중·대 — 기본 = 줄의 box). 주 버튼 `button "N개 택배 접수하기"`(0개·blocked·보내는 중이면 잠김).
  - 확인 창 `dialog "택배 접수"`: "N개를 택배로 접수할까요?", 처음 포커스 "닫기", 버튼 "접수하기". 보내는 동안 "택배사에 접수하는 중이에요…". 끝나면 `status` "2개 접수했어요." / "1개 접수했어요. 1개는 접수하지 못했어요 — 줄마다 이유를 확인해 주세요."
  - 아직 못 보내요: 서버 excluded + **ready 중 FAILED 시도가 있는 줄**(실패 문장 — 서버 `ready`에 있지만 화면은 여기로). 줄마다 이유 문장(`parcel.message` 먼저, 없으면 `row.message`). 모름(UNKNOWN) 줄엔 "다시 확인", 배송지 이유(NO_ADDRESS·ADDRESS_UNCONFIRMED·주소 거절)엔 링크 "배송지 보기"(→ `/settlements?date=&buyer=`). 실패·모름이 있으면 `button "실패한 것만 다시"`(FAILED+UNKNOWN만, PENDING은 뺀다 — 같은 book 경로).
  - 접수했어요: "송장 9000-0000-0001", "택배: 접수됨 · 9000-0000-0001", "마지막 확인 10/22 14:30", 줄의 `group "<이름> 택배"` 안 "운송장 PDF"·"접수 취소", 무리 위 "운송장 전부 PDF"와 안내 "운송장은 일반 프린터나 100×150 라벨 프린터로 찍어요. 라벨 프린터(B1)로는 찍을 수 없어요."
  - 접수 취소: `dialog "접수 취소"`(처음 포커스 "닫기") → "취소하기". 거절은 그 줄에 서버 문장(`role=alert`).
  - blocked: 목록 위 서버 문장 + 링크 "설정으로".
- 다시 읽기: 같은 페이지 실시간 연결의 `parcel`(그 날짜·설정)·`packing`(그 날짜)·`change`(그 실제 날짜)·다시 붙음 → `GET /api/parcels/days/:date`·`/days` 다시. (두 브라우저 문맥 E2E — 다른 쪽은 알림으로 바뀐다.)
- 화면 요청 번호: 같은 고른 묶음·상자 = 같은 요청 번호(연결 끊김 다시 보내기), 다르면 새 번호. 보내는 중엔 두 번 눌러도 요청 하나.

### 묶음 자세히의 배송지 칸 (정산 → 묶음, 실제 범위만)
- `region "배송지"`: 택배 줄(있으면) → 없음: "배송지가 없어요" + "배송지 적기" + "구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요." / 있음: 여섯 칸(연락처는 010-1234-5678 모양)·"구매자가 적었어요"/"판매자가 적었어요"·꼬리표 "확인 전"/"확인함"·"배송지 확인"(확인 전만)·"고치기"·"지우기"(확인 창 `dialog "배송지 지우기"`). 잠김(locked)이면 버튼 없이 "택배 접수를 먼저 취소해 주세요.". 직접 수령 "직접 수령이에요", 합배송 "합배송이에요", 30일 지남 "주문 날짜로부터 30일이 지나 배송지를 지웠어요."
- 양식 창 `dialog "배송지 적기"`/`"배송지 고치기"`, 칸 이름표 `받는 분`·`연락처`·`주소`·`상세 주소`·`우편번호(몰라도 돼요)`·`배송 메모`, 버튼 "저장". 틀리면 칸 아래 서버 문장(`address.<칸>`), `aria-invalid`.
- 정산 목록·자세히 꼬리표와 포장 목록·체크리스트에 `택배: <상태> · <송장번호>`(포장·배송 꼬리표 옆). 포장 체크리스트는 살아 있는 접수면 "배송 완료로 적기"·"송장번호 고치기"·"포장 완료 취소"·"배송 완료 취소"를 숨기고 "택배 접수를 먼저 취소해 주세요. 택배 화면으로".

### 설정 "택배" (`components/ParcelSettings.tsx`)
- `region "택배"`: `combobox "택배사"`(고르지 않음 · 가짜 택배(시험용) · "우체국 택배 — 준비 중"(disabled)), "택배사 고객 번호"(비우면 그대로 — 저장 뒤 "저장한 번호 끝 5678"), `group "보내는 사람"`의 "보내는 사람 이름"(비면 가게 이름)·"보내는 사람 연락처"·"보내는 주소"·"보내는 상세 주소"·"보내는 우편번호(몰라도 돼요)", `combobox "기본 상자 크기"`, "저장" → "택배 설정을 저장했어요.". 틀리면 칸 아래 서버 문장(`sender.<칸>`).
- 저장한 보내는 사람이 없고 이름 말고 아무것도 적지 않았으면 sender를 보내지 않는다(택배사만 바꿀 때 빈 칸 오류가 나지 않게).

### 그 밖
- `/privacy` "13. 택배 배송지" 문단(수집 항목·목적·택배사 제공·주문 날짜로부터 30일·초안 표시 — 위 초안 안내와 다른 문장), "5. 제3자 제공"에 택배사 한 줄, 시행일은 14번.
- 공용 실시간 연결(`lib/stream.ts` STREAM_EVENTS)에 `parcel`을 더했다(빠지면 화면이 알림을 받지 못한다). 범위 저장소에 `parcelVersion`.
- `apps/web/test/sms-page.test.tsx` AC-SMS-01: 받은 시각 "9:58"을 지금에 가까운 때로 읽어(D-023) 실행 시각이 저녁이면 21:58이 되던 흔들림 — 지금 시각만 오전으로 고정했다(기대값 그대로). 서버 개발자 보고의 "sms-page 2건 실패"가 이것이다.

### 수정 라운드 (web)
- TE-T1-001·U-T1-04: 택배 화면 줄 이름은 다른 화면과 같은 이름 규칙(D-098). 그날 범위 자료(`useScopeStore("parcels|날짜")`)를 함께 열어 `BuyerNames`로 정하고, 그 전(불러오는 중·못 읽음)엔 `parcelNames`(lib/parcel-words.ts)로 목록 줄끼리 " · 뒤 4자리 5678", 그래도 겹치면 " · 2". 고르는 칸·`group "<이름> 택배"`·취소 창 문장 모두 이 이름.
- TE-T1-002·U-T1-02: 날짜 고르기 칸은 화면 폭까지만(min-inline-size 0·max 100%·말줄임). 고르기 목록 안 글(" · 보낼 수 있어요 n · 접수 n")은 E2E 단언(`toContainText('접수 1')`)대로 그대로 둔다 — 휴대폰에서 칸 안 글이 잘려도 무리마다 "n개"가 보인다.
- U-T1-03(spec-keeper 판단 요청, 구현 안 함): 택배 접수만 했는데 포장 꼬리표 "배송 완료"가 "택배: 접수됨"과 함께 보인다. D-T1-01·PARCEL_RULES "접수가 되면 STL-08 '배송 완료 — 송장번호' 기록"과 AC-T1-30·173("포장 상태 = 배송 완료")이 정한 화면 낱말이라 웹이 혼자 바꾸지 않았다. 제안(판매자 안전 쪽): 기록은 그대로 두고, 살아 있는 접수가 있는 묶음의 포장 꼬리표만 화면에서 "택배로 보냄"(또는 꼬리표를 숨기고 "택배: 접수됨 · 송장"만)으로 보이기 — 택배 화면 접수한 줄·포장 목록·정산 꼬리표 세 곳. 판매대장 배송 칸(`배송 완료 · 송장 …`)은 파일 형식이라 그대로. 정해 주면 web이 바꾼다.
