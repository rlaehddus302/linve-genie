# I2 개발 노트 — dev-server (정산 마무리: 확인서·판매대장·포장·과거 구매·상품 목록 가져오기·백업)

작업 폴더 `/Users/unhoyeo/livejjim-wt/i2`, 브랜치 `track/i2-settle-docs`. 스펙 커밋 bcba8a7, BASE 9f51ed9. 순서: server(이 노트) → web.

## 만든 것 (`apps/server`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/product-import.ts` | R-18 해석 순수 함수 `parseProductList(text, { unit, maxNumber, existing })`·`.xlsx` 행 입구 `parseProductRows(rows, settings)`·등록 직전 다시 검사 `recheckRows`·`isNormalizedName`·`splitImportLines`·`splitCells`. `@livejjim/core`만 import(정규화·금액·휴대폰 번호 = `normalizeText`·`parseAmount`·`containsPhoneRun`) | AC-I2-50 |
| `src/import-files.ts` | `.csv`·`.txt` → 글(UTF-8, BOM 제거, 올바르지 않으면 EUC-KR), `.xlsx` → 첫 시트 행(수 = `String(n)`, 수식 = 저장된 계산 값, 날짜 = `YYYY-MM-DD`(UTC 칸), 빈 칸 = `''`, 줄 번호 = 행 번호). `.xlsx`는 zip 목록을 직접 읽어 상한 안에서만 연다(`scanXlsxZip`·`readXlsxRowsBounded` — 아래 "수정 라운드 1") | AC-I2-51 |
| `src/shop.ts` | 가게 설정 검사·읽기·쓰기(`sellers.name` + `sellers.shop` JSON), 문서 패키지 모양 `documentShop` | AC-I2-01 |
| `src/files.ts` | 문서 글꼴(Pretendard, 한 번 읽음), 파일 이름 `<이름>` 다듬기 `fileNamePart`, `Content-Disposition`(UTF-8 `filename*` + ASCII 대체), 파일 응답 | AC-I2-10·81 |
| `src/packing.ts` | 포장 기록 재생·상태 말·묶음 보기(`packingEntry`·`packingEntries`·`packingStatusByBuyer`)·명령 판단(`decidePacking`)·송장번호(`readInvoice`)·포장 라벨 데이터(L-9)·렌더 | AC-I2-30~34 |
| `src/past.ts` | 지난 구매(표지 = 채널 ID·전화번호 키, 한 번만 따라감, 20개씩) | AC-I2-40 |
| `src/backup.ts` | 백업 파일 만들기(`createBackupBytes` — 조각 글을 gzip 스트림에)·검사(`checkBackupBytes` — 조각으로 읽기)·재생, 폴더 저장소(`FolderBackupStorage`), 매일 자동 백업(`BackupScheduler`), 복구·가져오기(`restoreSeller`), 복구가 다루는 표 목록(`RESTORE_*_TABLES`), 발송함 실행 대상 수(`executableOutboxCount`) | AC-I2-60~64 |
| `src/json-stream.ts` | JSON 끌어오기 읽개(조각 글에서 키·값 하나씩 — 값 하나 길이 상한) | AC-I2-62 |
| `src/work-pool.ts`·`src/work-worker.ts` | 무거운 파일 작업의 워커 스레드 풀(확인서 그림·PDF·전원 PDF·판매대장 엑셀·`.xlsx` 읽기) | AC-I2-10·11·20·51 |
| `src/closing.ts` | `ClosingService` — 위를 엮는 서비스(가게 설정·확인서·판매대장·포장·라벨·지난 구매·가져오기·백업 상태·전체 내려받기) | 전부 |
| `src/api.ts` | 새 경로(아래 표), 날짜 보기에 `packing` 칸, 가져오기 본문 상한(미리 보기 3MB·등록 6MB 남짓 — 수정 라운드 2) | 전부 |
| `src/hub.ts` | seq 없는 이름 붙은 알림 `publishNamed(seller, 'packing' \| 'shop' \| 'generator', data)` | AC-I2-13·32 |
| `src/writer.ts` | `withScope`(범위 줄 안 덧붙이기 기록 — 포장 명령), `forgetSeller`(복구 뒤 캐시 비우기) | AC-I2-31·62 |
| `src/commands/restore.ts`·`restore-args.ts` | 복구·가져오기 명령 | AC-I2-62 |
| `src/e2e.ts`·`commands/e2e-server.ts` | 백업 폴더·시작 백업·`?at=` | AC-I2-15·65 |
| `test/i2-*.test.ts`·`test/i2-support.ts`·`test/product-import.test.ts` | 서버 시험(PGlite·가짜 시계·임시 폴더): 가게 설정·확인서(G-ENG-201·202를 서버 쓰기 경로로)·전원 PDF·금액 불일치(코어 getSettlement 가짜)·판매대장·포장 흐름 1~7·명령·실시간·라벨·지난 구매·가져오기(EUC-KR·BOM·.xlsx 픽스처는 시험이 만든다)·백업 형식·자동 백업·보관·복구(손상 파일 10종·중간 실패·바꾸기)·리허설·전체 내려받기·격리·로그·복구 명령(자식 프로세스)·E2E 기동. 성능 기준(전원 PDF 30초·대장 31일 20초·지난 구매 2초·가져오기 1초/2초·백업 60초)도 여기서 잰다 | 전부 |
| `drizzle/0006_i2_shop_packing_restore.sql` (합칠 때 I1 0003·Y1 0004·I3 0005 뒤로 번호를 옮김) | `sellers.shop`, `packing_records`, `outbox.restored` (더하기만 — 기존 표의 키·제약은 그대로, RA-I2-002) | — |
| 의존성 | `apps/server`: `@livejjim/documents`·`@livejjim/label`(workspace), `exceljs` 4.4.0(문서 패키지와 같은 판) | — |
| `.env.example` | `LIVEJJIM_BACKUP_DIR` | AC-I2-61 |

## API (web·tester에게 — 모두 세션 필요(401), `Cache-Control: no-store`, 다른 판매자의 자원은 404)

파일을 만드는 경로(확인서 PDF·PNG, 전원 PDF, 판매대장, 전체 판매대장·전체 기록, `.xlsx` 미리 보기)는 작업이 밀리면 429 `BUSY` "지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요.", 워커가 끝내지 못하면 500 `FILE_FAILED` "파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요."(RA-I2-003 — "수정 라운드 1").

`?rehearsal=true`는 날짜 경로의 리허설 범위(적지 않으면 실제 범위). 구매자 ID는 검색값 `buyer`(합쳐진 구매자 ID면 지금의 구매자로 푼다 — 포장 명령만 예외). 휴대폰 번호 모양의 구매자 값은 400(D-079 ⑥ 문장).

| 메서드·경로 | 요청 | 성공 응답 | 오류 |
|---|---|---|---|
| `GET /api/shop` | — | `{ shop: { name, bank, accountNumber, accountHolder, accountNote } }` (빈 칸은 `""`) | — |
| `PUT /api/shop` | `{ name, bank, accountNumber, accountHolder, accountNote }` 다섯 칸 모두 문자열. 가게 이름이 지금 이름과 같으면(앞뒤 공백을 지운 뒤) 길이를 다시 따지지 않는다 — 계정 만들기가 받은 31~50자 이름도 계좌만 적어 저장된다(SA-I2-006) | `{ shop }` + 실시간 `shop` 알림 | 400 `INVALID_INPUT`(칸별 `problems` — 계좌 일부만이면 message = "은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요."), `UNKNOWN_FIELD` |
| `GET /api/days/:date/receipt?buyer=` | (`&rehearsal=true`) | 확인서 데이터(문서 패키지 `ReceiptData` 그대로), 머리 `X-Receipt-Created-At: <UTC ms>` | 422 `NO_ITEMS` "구매 내역이 없어 확인서를 만들 수 없어요.", 500 `AMOUNT_MISMATCH`(문서 패키지 문장 + 서버 경보), 404 |
| `GET /api/days/:date/receipt.pdf?buyer=` · `receipt.png?buyer=` | 같음 | 파일. 이름 `확인서-YYYY-MM-DD-<이름>.pdf/png`(리허설 `리허설-` 앞에), 머리 `X-Receipt-Created-At` | 같음 |
| `GET /api/days/:date/receipts.pdf` | (`?rehearsal=true`) | 전원 PDF `확인서-YYYY-MM-DD-전원.pdf`, 머리 `X-Receipt-Count: n` | 422 `NO_ITEMS` "그 날짜에 구매 내역이 있는 구매자가 없어요.", 500, 404 |
| `GET /api/ledger.xlsx?from=&to=&b=<방송 ID>&b=…` | `b` 없으면 기간 안 모든 실제 방송 | 엑셀 `판매대장-YYYY-MM-DD.xlsx` / `판매대장-<시작>-<끝>.xlsx` | 400 `PERIOD_INVALID`("날짜를 2026-10-19처럼 적어 주세요." · "시작 날짜가 끝 날짜보다 늦어요." · "기간은 366일까지 고를 수 있어요."), 400 `INVALID_INPUT` "고른 방송을 다시 확인해 주세요."(field `b`), 422 `NO_BROADCASTS` "고른 기간에 방송이 없어요." |
| `GET /api/days/:date` (기존) | — | 실제 범위면 칸 하나 더: `packing: [{ buyer, status, invoice }]` (리허설 범위에는 없음) | — |
| `GET /api/days/:date/packing` | 실제 범위만 | `{ date, seq, entries: PackingEntry[] }` | 404(리허설·없는 범위) |
| `POST /api/days/:date/packing` | `{ requestId, buyer, action: 'pack'\|'unpack'\|'ship'\|'unship', items?(pack만 — 상품 키 목록, 중복 없음), invoice?(ship만 — 문자열·null·빈 값 = 송장 없음) }` | `{ date, entry: PackingEntry, recorded: boolean }` (`recorded` = 새 기록을 적었는지. 같은 상태·같은 요청 번호는 false) + 기록했으면 실시간 `packing` 알림 | 409 `ITEMS_CHANGED` "그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요." / 409 `PACKING_STATE`(문장은 아래) — 둘 다 본문에 `entry`(지금 상태), 400 `BUYER_NOT_FOUND` "구매자를 다시 확인해 주세요.", 400 `INVALID_INPUT`(송장 — field `invoice`), 404 |
| `GET /api/days/:date/packing-label?buyer=` | 실제 범위만 | `{ date, buyer(지금의 구매자), data: L-9 PackingLabelData, pages: n }` | 422 `NO_ITEMS` "담을 상품이 없어 포장 라벨을 만들 수 없어요.", 500 `LABEL_INVALID`(+경보), 404 |
| `GET /api/days/:date/packing-label.png?buyer=&page=k` | k = 1부터 | 1비트 PNG(50×30 → 384×240점), 이름 `포장라벨-YYYY-MM-DD-<이름>-<k>of<n>.png` | 400 쪽 번호 |
| `GET /api/days/:date/packing-label.pdf?buyer=` | — | 라벨 크기 PDF(모든 쪽), 이름 `포장라벨-YYYY-MM-DD-<이름>.pdf` | — |
| `GET /api/days/:date/past?buyer=&before=YYYY-MM-DD` | 실제 범위만, `before` = 다음 쪽 | `{ date, buyer, items: PastItem[], more, next }` | 404(다른 판매자·리허설·모르는 구매자) |
| `POST /api/broadcasts/:id/import/preview` | `{ text }` 또는 `{ file: { name, data(base64) } }` 하나 — 본문 상한 3MB(넘으면 413 `PAYLOAD_TOO_LARGE` "보낸 내용이 너무 커요. 파일은 2MB까지, 붙여 넣은 글은 200,000글자까지 가져올 수 있어요.") | `{ broadcast, unit, maxNumber, error: 'EMPTY'\|'TOO_MANY'\|null, header, headerCells, rows: [{ line, no, name, price, text } \| { line, error, text }], register, problems }` | 409 `BROADCAST_ENDED` "끝난 방송에는 상품 목록을 가져올 수 없어요.", 413 `FILE_TOO_LARGE` "파일이 너무 커요(2MB까지).", 413 `FILE_TOO_LARGE` "파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요."(`.xlsx` 칸 글 200,000글자 초과·압축을 푼 크기·시트 수 상한, 파일에서 나온 등록할 줄의 등록 본문이 등록 상한 초과 — SA-I2-007), 413 `FILE_TOO_LARGE` "붙여 넣은 내용이 너무 많아요. 번호·품종·가격 세 칸만 다시 복사해 붙여 넣어 주세요."(붙여 넣은 글 — 200,000글자 안이면 생기지 않는다), 400 `FILE_TYPE` "엑셀(.xlsx)이나 CSV 파일을 골라 주세요.", 400 `FILE_UNREADABLE` "파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.", 413(글 200,000글자 초과), 429 `BUSY`, 404 |
| `POST /api/broadcasts/:id/import` | `{ requestId, rows: [{ no, name, price }] }` 1~500개(미리 보기의 등록할 줄 그대로 — 품종은 정규화한 글) — 본문 상한 `3 × 2MB + 64KB`(2MB 파일에서 나온 품종의 최악 크기 — SA-I2-007, 넘으면 413 `PAYLOAD_TOO_LARGE` "등록할 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.") | `{ registered, seq }` (같은 요청 번호 = 처음 결과) | 409 `IMPORT_CHANGED` "그 사이에 바뀐 것이 있어요. 다시 확인해 주세요."(`problems[].field = rows.<i>`), 409 `BROADCAST_ENDED`, 400 형식, 404 |
| `GET /api/backups` | — | `{ enabled, retentionDays: 30, lastSuccessAt(마지막 자동 백업, UTC ISO\|null), backups: [{ createdAt, size }] }`(최근 것부터) | — |
| `GET /api/export/records.json.gz` | — | 백업과 같은 형식(gzip), 이름 `라이브찜-전체기록-YYYY-MM-DD.json.gz`(KST 오늘) | — |
| `GET /api/export/ledger.xlsx` | — | 실제 범위 전체 기간 판매대장, 이름 `라이브찜-판매대장-전체-YYYY-MM-DD.xlsx` | 422 `NO_RECORDS` "아직 판매 기록이 없어요." |

- **PackingEntry**: `{ buyer, name, phoneLast4, payment(코어 PaymentStatus — 화면이 D-092 말로), items: [{ key, broadcast, title, no, name, price }](방송 선언 순 → 번호 순), status(아래 다섯 말 그대로), invoice, add: [...items 모양](새로 담을 것), remove: [{ key, broadcast, title, no }](뺄 것) }`. `add`·`remove`는 `포장 다시 확인`·`배송 뒤 바뀜`일 때만 차 있다.
- **상태 말**(화면에 그대로): `포장 대기` · `포장 완료` · `포장 다시 확인` · `배송 완료` · `배송 뒤 바뀜`.
- **PACKING_STATE 문장**: 배송 뒤 포장 완료·포장 취소 "이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요." · 포장 대기에서 포장 취소 "포장 완료로 적은 기록이 없어요." · 포장 대기에서 배송 완료 "포장 완료 뒤에 배송 완료로 적을 수 있어요." · 다시 확인·배송 뒤 바뀜에서 배송 완료 "구매 내역이 바뀌었어요. 다시 포장 확인부터 해 주세요." · 배송 취소할 것 없음 "배송 완료로 적은 기록이 없어요." · 품목 0개 포장 "담을 상품이 없어 포장 완료로 적을 수 없어요.". 송장: "송장번호는 숫자 8~20자리로 적어 주세요." · "전화번호처럼 보여요. 송장번호를 확인해 주세요."
- **PastItem**: `{ date, buyer(그날 묶음의 지금의 구매자 — 정산 자세히 링크용), broadcasts(방송 제목들), name, phoneLast4, items: [{ title, no, name, price }], subtotal, shipping, adjustments, total, payment, received, refundDue, packing(상태 말), invoice, reasons: ['같은 유튜브 채널' | '같은 휴대폰 번호(끝자리 2222)'] }`. 같은 날짜 항목은 쪽을 나누지 않는다(20개를 조금 넘을 수 있다). 전화번호 키·전체 번호는 응답 어디에도 없다.
- **실시간**: 기존 `/api/stream`에 이름 붙은 알림 둘 — `event: packing` `data: { date, buyer }`(포장 기록이 커밋된 뒤), `event: shop` `data: {}`(가게 설정 저장 뒤). 값(품목·송장·가게 설정)은 싣지 않는다. 품목을 바꾸는 엔진 이벤트는 지금처럼 `change`로 오므로 화면은 그때 포장 목록·확인서 미리 보기를 다시 받는다.

## 포장 기록 표 (`packing_records`, 덧붙이기만 — 복구 명령만 예외)

| 칸 | 값 |
|---|---|
| `seller_id`·`scope_id`·`date` | 판매자, 실제 범위(리허설 범위에는 쓰지 않는다), 묶음 날짜 |
| `buyer` | 기록할 때의 지금의 구매자 ID (그 ID의 묶음에만 보인다 — 합쳐지면 떼어 낼 때까지 안 보인다) |
| `kind` | `PACKED`(포장 완료) · `UNPACKED`(포장 취소) · `SHIPPED`(배송 완료) · `UNSHIPPED`(배송 취소) |
| `items` | `PACKED`만: 담은 품목 = 상품 키 목록 JSON |
| `invoice` | `SHIPPED`만: 송장번호(숫자만) 또는 null |
| `account_id`·`created_at`·`request_id` | 누가(로그인 계정)·언제(서버 시각 UTC)·요청 번호(판매자 안에서 유일 — `packing_request_uq`) |

명령은 범위 줄(엔진 쓰기와 같은 줄) 안에서 범위 어드바이저리 락을 잡은 트랜잭션으로 검사·기록한다 — 엔진 이벤트·범위 seq·정산 금액은 바뀌지 않는다.

## 백업 파일 형식 (gzip JSON 하나, `format: "livejjim-seller-backup"`, `version: 2` — RA-I2-005)

```
{ format, version: 2, createdAt(UTC ISO), sellerId,
  shop: { name, bank, accountNumber, accountHolder, accountNote },
  settings: { …판매 규칙 설정 덮어쓰기(점 표기) },
  scopes: [ { date, rehearsal,
              events: [ { seq, type, body(엔진 이벤트 JSON 문자열), at, receivedAt(ISO), actor('account'|'server'|'collector'), accountId, requestId, failed, digest } ],
              seq,
              broadcasts: [ { id, date, title, startSeq, endedAt(ISO|null), createdAt(ISO) } ] } ],
  packing: [ { date, buyer, kind, items, invoice, accountId, requestId, createdAt(ISO) } ],
  digest }
```
- **칸의 차례가 정해져 있다(형식 번호 2)**: 맨 위 `format·version·createdAt·sellerId·shop·settings·scopes·packing·digest`, 범위 안 `date·rehearsal·events·seq·broadcasts`. 이벤트·방송·포장 기록 하나 안의 칸 차례는 상관없다. 차례가 다르거나 모르는 칸이 있으면 "백업 파일의 칸이 형식과 달라요." / "범위의 형식이 올바르지 않아요." — 판매자의 전체 역사를 글 하나로 만들지 않고 조각으로 쓰고 읽기 때문이다(V8 문자열 한도 약 512MB).
- 만들기(`createBackupBytes(db, sellerId, now)`): 범위마다 범위 행의 seq를 먼저 읽고 그 seq까지의 이벤트를 2,000건씩(`BACKUP_PAGE`) 읽어 조각 글을 gzip 스트림(스레드 풀)에 이어 쓴다. 묶음 사이에 이벤트 루프에 차례를 넘긴다(긴 트랜잭션 없음 — 쓰기를 막지 않는다). 기록이 없는 범위 행(seq 0)은 넣지 않는다. 가장 긴 조각 = 이벤트 한 묶음.
- 범위 순서 = 날짜 → 실제 먼저, 이벤트 = seq 순, 포장 = 기록 순. 방송 목록은 그 이벤트로 정한다(`broadcast.start`·`end`가 상태를 바꾼 것, 끝난 시각 = end 이벤트의 at) — 방송 표와 같은 규칙.
- 이벤트 `digest` = SHA-256(JSON `[date, rehearsal, seq, type, body, failed]`) (범위 ID에 기대지 않아 다른 서버로도 가져온다).
- 파일 `digest`(형식 번호 2) = 내용을 파일 차례대로 조각으로 나눠 조각마다 정규 JSON(키 정렬)+`\n`을 이어 넣은 SHA-256: `["format", …]`·`["version", 2]`·`["sellerId", …]`·`["shop", …]`·`["settings", …]`·범위마다 `["scope", date, rehearsal]`·이벤트마다 그 이벤트·`["scopeEnd", seq, broadcasts]`·포장 기록마다 `["packing", 기록]`·`["end", 범위 수, 포장 기록 수]`. 만든 시각·digest 칸은 넣지 않는다 — 같은 기록이면 만든 시각과 상관없이 같은 내용·같은 digest(`BackupDigest`, `backupDigest(file)`).
- 읽기(`checkBackupBytes(bytes)` — 비동기): gzip을 조각으로 풀어 JSON 끌어오기 읽개(`json-stream.ts`)로 키·값 하나씩 읽는다. 이벤트는 하나씩 검사·재생한다(범위 하나의 상태만 메모리). 값 하나의 글 길이 상한 64MB. 결과의 `file`은 요약(범위마다 날짜·리허설·seq·이벤트 수·방송 목록, 포장 기록 수) — 이벤트 내용은 담지 않는다.
- 넣지 않는다: 비밀번호 해시·로그인 아이디·세션·로그인 시도 기록·판매자 전화번호 키(암호문)·마스터 키·스냅샷·발송함. `accountId`는 서버가 만든 불투명 ID다(로그인 아이디 아님).
- 형식 번호 1(I2 첫 구현 — 운영에 나간 적 없음)은 읽지 않는다: "이 서버가 읽을 수 없는 형식 번호예요(2만 읽어요)."

## 매일 자동 백업

- 저장소 = 어댑터 `BackupStorage`. 이번에는 폴더 저장소 `LIVEJJIM_BACKUP_DIR/<판매자 ID>/<종류>-<UTC 시각>.json.gz`(종류 `daily`·`safety`). 파일 이름에 판매자 이름·구매자 정보 없음. 임시 이름에 쓰고 바꾼다.
- **확인 주기 5분**(`BACKUP_CHECK_INTERVAL_MS`), 켠 뒤 첫 확인은 3분 뒤(`BACKUP_START_DELAY_MS` — 판매 중에 다시 켜도 켜자마자 모든 판매자 백업을 몰아 만들지 않는다, RA-I2-003). 판매자마다 그날(KST) 04:00이 지났고 그날 04:00 뒤의 `daily`가 없으면 하나 만든다(기록 없는 판매자도). 확인마다 보관 정리: 만든 지 30×24시간이 지난 파일을 지우되 판매자마다 가장 최근 파일 하나는 남긴다(종류와 상관없이).
- 한 판매자가 실패해도 다음 판매자로 간다 — 경보 `BACKUP_FAILED`(판매자 ID·오류 종류만), 다음 확인 때 다시. 저장소가 없으면 시작 경보 `BACKUP_DISABLED` "백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요."(판매는 그대로, `GET /api/backups` → `enabled: false`).
- 시험은 `server.backups.check()`를 가짜 시계로 직접 부른다(`createServer({ backupStorage, clock })`).

## 복구·가져오기 명령 (운영자)

```
LIVEJJIM_PGLITE_DIR=… (또는 DATABASE_URL=…) LIVEJJIM_BACKUP_DIR=… \
  pnpm --filter @livejjim/server restore --seller <판매자 ID> --file <파일.json.gz> [--replace]
```
- 검사(하나라도 어긋나면 아무것도 바꾸지 않음, 종료 코드 1): 형식 이름·번호, gzip·JSON, 파일 요약값, 이벤트마다 요약값, 범위마다 seq 1부터 빈틈없음·범위 seq = 마지막 seq, (날짜, 리허설) 겹침, 범위마다 처음부터 재생(실패 표시는 건너뜀 — 본문과 칸(type·seq·at) 일치, 입력 오류·형식 오류 없음, 불변식), 방송 목록 = 이벤트로 정한 것, 판매 규칙 설정 `checkSettings`(MANUAL 거절), 포장 기록 형식·차례·요청 번호 중복·날짜가 실제 범위.
- 파일의 방송 ID가 **그 서버의 다른 판매자** 방송 ID와 같으면 아무것도 바꾸지 않고 거절(종료 코드 1): "이 서버의 다른 판매자에게 같은 방송 기록이 있어 가져올 수 없어요. 아무것도 바꾸지 않았어요." — 방송 기본 키는 서버 전체에서 유일하다(RA-I2-002). 같은 서버에서 다른 판매자로 옮기는 일은 없고, 다른 서버(I3 이관 등)나 기록을 잃은 같은 판매자에게 가져온다.
- 기록이 없는 판매자면 가져온다. 기록이 있으면 `--replace`가 있을 때만: 먼저 지금 기록의 안전 백업(`safety-…`)을 백업 저장소에 쓰고(저장소가 없거나 실패하면 멈춤) 한 트랜잭션에 그 판매자의 범위·방송·이벤트·스냅샷·발송함·포장 기록·가게 설정(이름 포함)·판매 규칙 설정을 바꾼다. 트랜잭션 안에서 그 판매자의 범위 락을 모두 잡는다. 지우는 표는 `RESTORE_REPLACED_TABLES`(지우는 순서), 그대로 두는 표는 `RESTORE_KEPT_TABLES`(판매자 행·계정·세션) — 아래 "합칠 때".
- 파일은 두 번 읽는다(둘 다 조각으로): 처음은 검사만, 두 번째는 트랜잭션 안에서 검사하며 넣는다(이벤트·발송함 500건씩).
- 재생으로 스냅샷(범위마다 마지막 seq 하나)·발송함을 다시 만들고 발송함은 모두 `restored = true`(실행하지 않음). 실행기(I1·Y1)의 실행 대상 조회는 `executableOutbox`(db/schema.ts — `rehearsal = false AND restored = false`) 조건을 건다. `test/i2-restore-contract.test.ts`가 `apps/server/src`에서 `outbox.rehearsal` 조건을 거는 파일이 `restored`(또는 `executableOutbox`)도 거는지 훑는다 — 합친 뒤 걸리면 그 질의에 조건을 더한다(D-I2-11, RA-I2-001).
- 이벤트의 계정이 그 서버의 그 판매자 계정에 없으면 계정 없이(`accountId = null` → 조치 기록의 `actor = { kind: 'account', loginId: null }` — 화면은 "가져온 기록"으로 보인다). 판매자 ID·계정·세션·전화번호 키는 그대로.
- 끝나면 그 판매자에 재생 무결성 검사를 돌려 출력한다(모두 일치해야 0). **서버가 켜져 있으면 다시 켠다**(메모리의 범위 상태 — 같은 프로세스 안 시험은 `server.writer.forgetSeller(sellerId)`).
- 출력: 쉬운 문장·판매자 ID·날짜·seq·개수·안전 백업 파일 이름뿐(기록 내용·개인정보 없음). 인자·설정 오류는 2.

## E2E 서버 설정 (`pnpm --filter @livejjim/server e2e …`)

- 백업 저장소: `--backup-dir <폴더>`(없으면 임시 폴더를 만들고 끌 때 지운다). **시작할 때 시험 판매자의 자동 백업(`daily`)을 하나 만든다**(시각과 상관없이 — 설정 화면의 "마지막 자동 백업"이 늘 있다. 그 시각 = 서버 시작 시각). 자동 확인도 돈다.
- **AC-I2-15 (공유 그림 = Node 그림)**: 미리 보기 PNG 응답 머리 `X-Receipt-Created-At`(그 그림을 만든 확인서 데이터의 만든 시각, UTC ms). E2E 서버만 `GET /api/days/:date/receipt?buyer=…&at=<그 ms>`가 그 만든 시각의 확인서 데이터를 낸다(`createServer({ receiptAtParam: true })` — 운영 서버는 `at`을 보지 않고 늘 지금 시각). 시험은 그 데이터를 Node에서 `renderReceiptPng(data, Pretendard)`로 그려 공유된 `File` 바이트와 맞댄다. 판매자 화면은 `at`을 보내지 않으므로 동작이 바뀌지 않는다.
- 시계는 실제 시계 그대로다(고정 시계 E2E 설정은 두지 않았다 — 같은 서버를 모든 시험이 함께 쓴다).

## 남의 영역 최소 변경 (dev-common "누구 영역, 왜")

### 코어 시험 영역 (dev-core 영역 — AC-I2-50·90, D-I2-09: D-209와 같은 방식). 코어 `src`는 바꾸지 않았다.
| 파일 | 바꾼 것 |
|---|---|
| `test/golden/contract.ts` | `SUITES`에 `product-import`, 설정 `unit`·`maxNumber`, `PRODUCT_IMPORT_EXISTING_KEY`·오류 값·줄 키 |
| `test/golden/validate.ts` | `settings.existing`(1 이상 정수 목록), `out` 검사(`{ error }` 하나 또는 `{ header?, rows }`, 줄 키 정확히), `ParserSuiteDoc.existing?` |
| `test/golden/types.ts`·`runner.ts`·`fake-core.ts` | `productImport(text, settings, existing)` — 사례마다 `existing` 사본 |
| `test/golden/compare.ts` | `header`(적지 않으면 null)·줄 순서·줄마다 키와 값 정확히 |
| `test/golden/core-adapter.ts` | `../../../../apps/server/src/product-import.ts`의 `parseProductList`를 상대 경로로(워크스페이스 고리 없음) |
| `test/golden/fixtures/read-errors/21-product-import.yaml` (새) | 모르는 settings 키, `existing: "3"`, 모르는 out 키, `rows` 없음, `error`와 `rows` 함께, 모르는 전체·줄 오류 값, `line: 0`, `price: 50`, 줄에 `no`만, `header: 0`, 문제 줄에 `no`, `unit: YEN`·`maxNumber: 10000`·`existing`에 0 |
| `test/golden/product-import.test.ts` (새) | 21사례 통과, 설정·사본 전달, 비교 규칙, 허용 목록 이름, 일부러 틀린 해석기 5종(머리글 둘째 줄까지·같은 번호 첫 줄 등록·칸 둘 = [번호, 가격]·늘 원 단위·큰따옴표 무시)이 각각 불일치 |

### `packages/documents` (device 영역 — AC-I2-12·21·33). 금액·행 규칙(D-206~D-208)은 그대로.
| 파일 | 바꾼 것 | 왜 |
|---|---|---|
| `src/text.ts` | `printedName(text, sanitize)`(찍힌 이름, 비면 "(이름 없음)"), `NO_NAME`, `stripXlsxForbidden` | D-I2-04·D-I2-03 |
| `src/layout.ts` | 구매자 칸이 `printedName`을 쓴다(같은 함수 — 배치와 일괄 순서가 갈라지지 않게). 쓰지 않게 된 지역 상수 `NO_NAME` 지움 | D-I2-04 |
| `src/receipt.ts` | `buildReceipts(scope, font?)` — 순서 키 = 찍힌 이름(글꼴을 넘기지 않으면 제어·서식 글자만 뺀 이름) → 구매자 ID. `NameSanitizer` 타입 | D-I2-04 |
| `src/pdf.ts` | `renderBatchPdf`가 그리는 글꼴을 `buildReceipts`에 넘긴다(글꼴 객체 한 번 만들기) | D-I2-04 |
| `src/xlsx.ts` | 글 칸에 `stripXlsxForbidden`(빼서 비면 빈 칸) | D-I2-03 |
| `src/ledger.ts` | `LedgerInput.shipping?: (buyer, date) => string`, `LedgerRow.shipping: string`(넘기지 않으면 `''`) — 묶음마다 한 번 묻는다 | D-I2-05 |
| `src/index.ts` | 새 이름 내보내기 | — |
| `test/i2.test.ts` (새) | 일괄 순서(가람·🌵가람·나비, G-ENG-202), 금지 글자(특정 글자·속성 시험 — 임의 UTF-16 단위), 배송 칸 입력 | AC-I2-12·21·33 |

### 루트 공용 파일
- `vitest.config.ts`: `projects`에 `apps/server/vitest.i2.config.ts`를 더했다. I2 서버 시험(`apps/server/test/i2-*.test.ts` — 문서 그리기·엑셀·큰 범위 채우기)이 서버 프로젝트(`groupOrder 1`)가 끝난 뒤 `server-i2` 묶음(`groupOrder 2`)으로 돈다. 같이 돌면 서버 프로젝트의 응답 지연 시험(`changes.test.ts`의 덮기·p99 300ms, `latency.test.ts`)이 CPU를 다투다 흔들렸다. `apps/server/vitest.config.ts`는 그 파일들을 `exclude`한다 — 시험 파일은 그대로 한 번씩 돈다(test 단계의 파일 대조와 맞다).
- `pnpm-lock.yaml`: `apps/server`의 새 의존성.

## 바꾼 기존 시험 (교체 — 약화 아님)
| 시험 | 전 | 후 | 이유 |
|---|---|---|---|
| `packages/core/test/golden/core-adapter.test.ts` 실제 골든 합계 | 파일 25 · 파서 448 · 엔진 125 · 통과 573 | 파일 26 · 파서 469 · 엔진 125 · 통과 594 | AC-I2-90 — 골든이 늘었다 |
| `packages/core/test/golden/read-errors.test.ts` | 범주 1~20 | 범주 1~21 (21 = product-import) | 새 suite 형식 계약 픽스처 |
| `packages/documents/test/receipt.test.ts` "순서는 코드 포인트 순…" | 원문 표시 이름 순 `[5,6,2,1,4,3]` | 글꼴을 넘기면 찍힌 이름 순 `[5,6,2,1,3,4]`(🌵가 빠진 '선인장'이 '￠가' 앞), 글꼴 없이 부르면 `[5,6,2,1,4,3]`(제어·서식만 뺌) 둘 다 단언 | AC-I2-12 / D-I2-04 |
| `packages/documents/test/ledger.test.ts` "=·+·-·@로 시작해도 글 칸" | 다시 읽은 구매자 칸 = 행 값 그대로(`\t=cmd\|calc` 포함) | = `stripXlsxForbidden(행 값)`, `=cmd\|calc`가 글 칸으로 있음 | AC-I2-21 — 탭은 글 칸에서 뺀다 |
| `apps/server/test/api.test.ts` "범위 조회: 값은 코어 조회 함수의 결과와 같다" | 칸 11개 정확히 | + `packing`(품목 있는 묶음마다 `포장 대기`, 하나 이상) | AC-I2-33 — 날짜 보기의 포장 상태 |
| `apps/server/test/commands.test.ts` 마이그레이션 | 테이블 9개 | 10개(`packing_records`) — 스키마와 같다는 단언은 그대로 | 포장 기록 표 |

| `apps/server/test/changes.test.ts` "무작위 이벤트 순서 … 전체(a) + 증분 = 전체(지금)" | 시험 시간 한도 30초(프로젝트 기본) | 120초 — 단언·사례 수(25)는 그대로 | 정답 성질 시험이고 시간 기준이 아니다. 혼자 5초쯤인데 같은 기계에서 다른 작업 폴더의 검증 3개가 함께 돌 때 30초를 넘어 시간 초과로만 실패했다(날짜 보기에 더한 `packing` 칸의 몫은 재 보니 약 3%) |

판매대장 "배송 칸 빈칸"을 단언하던 문서 패키지 시험(`ledger.test.ts`의 `cells[10]?.type === 'Null'`·G202 표의 빈 배송 칸)은 그대로 통과한다 — `shipping` 입력을 넘기지 않으면 빈칸이다. 서버 경로의 대장은 `포장 대기` 등으로 채운다.

## 결정과 이유 (규칙 문장으로 정해지지 않은 구현 선택)

1. **가게 설정 PUT은 다섯 칸 모두**: 칸 일부만 보내는 길을 두면 "계좌 셋 다 적거나 셋 다 비움" 판단이 저장된 값과 섞인다. 빠진 칸은 그 칸의 문제다. 길이는 앞뒤 공백을 지운 뒤 코드 포인트(이모지 하나 = 1). 제어 글자는 앞뒤 공백 지우기 전 원문에서 본다(줄바꿈으로 끝나는 값도 거절).
2. **파일 이름 `<이름>`이 비면 `구매자`**: D-I2-01의 "비면 구매자"를 찍힌 이름 기준으로 — 이모지만인 닉네임은 확인서에 "(이름 없음)"으로 찍히지만 파일 이름은 `구매자`다. ASCII 대체 이름은 `receipt-YYYY-MM-DD.pdf`처럼 구매자 이름 없이.
3. **포장 라벨 파일 이름**은 라벨에 찍히는 구매자 글(`문자찜` 또는 닉네임)로 같은 다듬기.
4. **판매대장 오류 코드**: 기간 문제는 400 `PERIOD_INVALID`, 방송 고르기 문제는 400 `INVALID_INPUT`(field `b`), 방송 없음은 422 `NO_BROADCASTS`. 기간 일수는 시작·끝 포함(366일 = 통과, 367일 = 거절). `b=`를 적었는데 빈 목록이면 "고른 방송을 다시 확인해 주세요.".
5. **포장 명령 하나의 경로·`action`** 네 가지. 같은 요청 번호면 그 기록의 묶음의 **지금** 상태(새 기록 없음)를 돌려준다 — 그 사이 품목이 바뀌었으면 지금 모양이다. 다른 날짜로 다시 보낸 같은 요청 번호는 409 `REQUEST_ERROR`.
6. **품목 0개 포장 완료**는 거절(`담을 상품이 없어…`) — AC "품목 1개 이상". 보낸 목록에 같은 키가 두 번이면 400.
7. **배송 완료의 송장 없음 → 송장 없음 다시**는 같은 상태(새 기록 없음). 송장 고치기는 새 `SHIPPED` 기록.
8. **지난 구매 후보 거르기**: 표지마다 DB에서 먼저 후보 날짜를 고른다(채팅 본문 `"ch":"<채널>"`·문자찜 본문 `"phoneKey":"<키>"`를 `strpos`로 — 판매자 ID 조건·실제 범위·보고 있는 날짜 밖). 그다음 그 날짜 범위 상태(코어 조회)로 확인한다: 채널 → 그날의 유튜브 구매자, 전화번호 키 → 그날 그 키의 문자찜이 **만든** 문자 구매자(`sms:<그 ref>`가 그날 구매자로 있을 때만 — 지정 구매자로 간 문자찜은 만든 구매자가 아니다). 같은 날 여러 묶음은 이름 → ID 순.
9. **백업 주기·보관 정리 대상**: 보관 정리는 종류(`daily`·`safety`)와 상관없이 같은 규칙. "마지막 자동 백업" = 가장 최근 `daily`.
10. **복구 스냅샷**: 범위마다 마지막 seq 하나만 쓴다(재생 검사가 그 스냅샷을 재생 상태와 대조한다).
11. ~~방송 표 기본 키를 (판매자, 방송)으로~~ → **되돌림(RA-I2-002)**: 다른 트랙이 `broadcasts(id)`를 외래 키로 참조한다(합친 뒤 마이그레이션이 깨진다). 기본 키는 전역 `(id)` 그대로이고, 같은 서버의 다른 판매자와 방송 ID가 겹치는 가져오기는 복구 명령이 먼저 거절한다. 빈 판매자로 가져오기 시험(AC-I2-64)은 원래 판매자가 없는 다른 서버(다른 DB)로 한다 — 같은 서버로 가져오기는 거절 시험이 따로 있다.
12. **E2E `?at=`**: 위 "E2E 서버 설정". 고정 시계 E2E 묶음을 따로 두는 것보다 화면 동작을 건드리지 않고 같은 데이터를 결정적으로 얻는다.

## 수정 라운드 1 (dev-server — SA-I2-001, RA-I2-001~005)

### SA-I2-001 (TD-I2-001) 가져오기 등록 본문 상한
- `POST /api/broadcasts/:id/import`도 미리 보기와 같은 3MB(`IMPORT_BODY_LIMIT_BYTES`). 다른 쓰기 경로는 64KB 그대로.
- `.xlsx`도 붙여 넣은 글과 같은 200,000글자 상한(행을 탭 글로 이은 길이)을 둔다 — 넘으면 413 `FILE_TOO_LARGE` "파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요." 그래서 미리 보기가 "n개 등록하기"를 보인 목록의 등록 본문은 늘 상한 안이다(글자마다 JSON 6바이트로 잡아도 약 1.3MB).

### RA-I2-002 broadcasts 기본 키
- 마이그레이션 0003은 칸·표를 더하기만 한다(기존 표의 키·제약을 바꾸지 않는다 — `i2-restore-contract.test.ts`가 파일을 훑어 확인, `broadcasts(id)` 참조 표를 만들어 본다).
- **합칠 때(오케스트레이터)**: 마이그레이션 번호 0003은 main의 `0003_i1_print.sql` 등과 겹친다 — 이 파일은 다른 트랙 마이그레이션과 순서가 상관없으니 다음 번호로 다시 매기고 저널을 고친다.

### RA-I2-001 복구가 다루는 표·발송함 실행 조건 (합칠 때 계약)
- `backup.ts`: `RESTORE_REPLACED_TABLES`(지우고 파일로 다시 만드는 표 — 지우는 순서) = packing_records·outbox·snapshots·events·broadcasts·scopes, `RESTORE_KEPT_TABLES` = sellers·accounts·sessions, `RESTORE_UNRELATED_TABLES` = login_limits.
- `test/i2-restore-contract.test.ts`: 마이그레이션을 적용한 실제 DB의 표가 모두 셋 중 하나에만 있는지, 판매자 ID 칸이 있는 표가 앞의 둘 중 하나인지, 바꾸는 표를 참조하는 외래 키가 모두 바꾸는 표에서 오고 지우는 순서가 맞는지 확인한다.
- **합칠 때 이 시험이 실패하면**: main(I1)의 `print_labels`·`print_jobs`(scopes 참조)·`print_attempts`(print_jobs 참조)는 복구가 범위를 지울 때 함께 지워야 하는 표다 → `RESTORE_REPLACED_TABLES` 앞쪽(참조하는 표 먼저: print_attempts → print_jobs → print_labels → … → scopes)에 둔다. `print_queues`·`label_templates`(판매자 설정)는 `RESTORE_KEPT_TABLES`. `print_requests`·N2 `live_links`(broadcasts 참조)·N3 `deposit_links`·`deposit_actions`도 같은 기준(범위·방송·이벤트를 참조하면 바꾸는 표, 판매자 설정이면 그대로 두는 표). 백업 파일에 없는 표를 바꾸는 표에 두면 복구 뒤 그 기록이 비는 것을 받아들이는 결정이다 — 남겨야 하면 백업 형식에 더해야 한다.
- 발송함 실행 조건 `executableOutbox`(db/schema.ts). 같은 시험이 `apps/server/src`에서 `outbox.rehearsal` 조건을 거는 파일이 `outbox.restored`나 `executableOutbox`도 거는지 확인한다. **합칠 때 걸릴 곳**: main `print-store.ts`의 `autoLabelEffects`(`eq(outbox.rehearsal, false)`), I3 `youtube/outbox-store.ts`의 `REAL` — `executableOutbox`를 더한다.

### RA-I2-005 백업 형식 번호 2
- 위 "백업 파일 형식". API: `createBackupBytes(db, sellerId, now)`(바이트), `backupPieces`(조각 글 — 시험용), `checkBackupBytes(bytes)`(비동기, 요약), `backupDigest(file)`(메모리 객체의 요약값 — 시험이 고친 파일을 다시 요약할 때). `buildBackup`·`encodeBackup`은 없앴다.
- 복구도 조각으로 두 번 읽는다(검사 → 트랜잭션 안에서 넣기).

### RA-I2-003 무거운 파일 작업은 워커 스레드로
- `work-pool.ts`: 풀 셋(프로세스에 하나 — `sharedWorkPools()`, 서버 옵션 `work`로 바꿀 수 있다).
  | 풀 | 일 | 워커 | 시간 상한 | 힙 상한 | 판매자마다 동시 | 줄 |
  |---|---|---|---|---|---|---|
  | `receipts` | 확인서 한 장 그림·PDF | 1 | 30초 | 512MB | 8 | 64 |
  | `documents` | 전원 확인서 PDF·판매대장 엑셀(기간·전체) | min(2, CPU-1) | 300초 | 2048MB | 2 | 16 |
  | `sheets` | 상품 목록 `.xlsx` 읽기 | 1 | 15초 | 512MB | 2 | 8 |
- 서버 스레드에 남는 일: 확인서 데이터(`buildReceipt(s)` — 찍힌 이름 순은 그대로), 대장 행(날짜마다 범위 하나로 `buildLedger` — 날짜 순으로 이으면 여러 범위를 한 번에 넘긴 결과와 같다; 날짜마다 조각으로 워커에 보낸다). 그리기·엑셀 쓰기·`.xlsx` 풀기는 워커(`work-worker.ts` — 문서 패키지 함수 그대로라 바이트가 같다, AC-I2-15).
- 판매자마다 동시 작업 상한·줄 상한을 넘으면 **429 `BUSY` "지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요."**. 워커가 시간·메모리 상한에 걸리면 그 워커만 끝나고 **500 `FILE_FAILED` "파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요."**(경보 `DOCUMENT_WORK_FAILED` — 판매자 ID·까닭 종류·날짜만). `.xlsx` 읽기 워커가 상한에 걸리면 "파일을 읽지 못했어요…". 요청이 끊기면(브라우저가 미리 보기 요청을 버리면) 아직 시작하지 않은 작업은 줄에서 뺀다.
- 전체 기록(JSON)은 판매자마다 한 번에 하나(겹치면 429 `BUSY`). 서버 스레드에서 만들지만 이벤트 2,000건마다 차례를 넘기고 gzip은 스레드 풀이다.
- 운영 서버·E2E 서버는 켤 때 `receipts` 워커 하나를 미리 띄운다(`work.receipts.warm()`). 쉬는 워커는 2분 뒤 끝난다.
- 웹(dev-web)에게: 새 오류 코드 `BUSY`(429)·`FILE_FAILED`(500)는 서버 문장을 그대로 보이면 된다(화면 변경 없음).
- 남은 것: 상품 목록 등록 500줄은 R-18 11("한 요청, 한 트랜잭션")이라 그 범위 줄에서 한 번에 기록한다(다른 판매자·다른 날짜 범위는 막지 않는다).

### RA-I2-004 `.xlsx` 상한
- `scanXlsxZip`: zip 끝 디렉터리·중앙 디렉터리·로컬 머리를 직접 읽고 항목마다 `inflateRawSync(maxOutputLength)`로 풀어 본다 — 선언된 크기를 믿지 않는다. 압축을 푼 크기 합 16MB·항목 2,000개·시트 64개(`XLSX_LIMITS`)를 넘으면 413(위 문장), 암호·zip64·모르는 압축·잘린 파일은 "파일을 읽지 못했어요…".
- `readXlsxRowsBounded`: 칸은 32칸까지만 글로 만들고, 그 뒤에 글이 있으면 그중 하나만 붙인다(R-18 2 — 넷째 칸부터 빈 칸을 지우고 칸 수를 보므로 결과가 같다 — 미리 보기의 그 줄 글은 짧아진다). 빈칸이 아닌 행 502개(머리글 1 + 상품 줄 501)를 읽으면 더 읽지 않는다(TOO_MANY가 확실).
- 이 읽기는 `sheets` 워커(15초·512MB)에서 돈다 — 상한을 빠져나간 파일도 서버 스레드를 멈추거나 죽이지 못한다.

### 바꾼 기존 시험 (교체 — 약화 아님)
| 시험 | 전 | 후 | 이유 |
|---|---|---|---|
| `i2-backup.test.ts` 빈 판매자로 가져오기·기록 있는 판매자 바꾸기·중간 실패·AC-I2-64 가져오기 | 같은 서버의 다른 판매자 | 원래 판매자가 없는 다른 서버(같은 시각 가짜 시계)의 판매자 — 단언은 그대로 | RA-I2-002: 같은 서버의 다른 판매자로 가져오기는 이제 거절(새 시험 "같은 서버의 다른 판매자로 가져오기"가 거절·아무것도 안 바뀜·안전 백업 안 씀을 단언) |
| `i2-backup.test.ts` 손상 파일 "형식 번호" | `version = 2` | `version = 1` (지금 형식이 2) | RA-I2-005 형식 번호 2 — 읽을 수 없는 번호라는 뜻은 같다. 칸 차례·모르는 칸·잘린 gzip·뒤에 남은 글 사례를 더했다 |
| `i2-backup.test.ts` 형식 단언 | `version: 1`, `buildBackup` 객체 | `version: 2`, `createBackupBytes` 바이트를 푼 객체(같은 칸·같은 차례) | 서버가 실제로 쓰는 길을 시험 |
| `i2-isolation.test.ts` 복구 명령 | 원래 판매자·대상 판매자가 같은 DB | 원래 판매자는 다른 DB, 대상 DB에 판매자 둘 — 같은 단언 + 둘째 판매자로 같은 파일 → 방송 겹침 거절(종료 코드 1) | RA-I2-002 |

### 검증 (수정 라운드 1, `E2E_PORT_OFFSET=800 pnpm verify`, 커밋 a6bfc06, 같은 기계에서 다른 작업 폴더 검증이 함께 돌아 부하 평균 약 40)
typecheck(TS 파일 439)·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(파일 39 · 804 — TD-I2-001 포함 통과)·coverage 통과.
- test 실패 3: `packages/voice/test/perf.test.ts` p99 50ms, `packages/core/test/unit/engine-timing.test.ts` 둘 — 시간 비교 시험(부하). 서버 시험(server·server-i2 47파일 481개)은 모두 통과.
- e2e 200 통과 · 6 실패: TE-I2-001(웹 포장 라벨 다시 받기), `s06/attacks-r1`:172 둘·`s06/sms`:191·`s06b/names`:50(받은 시각 00:00:0x — KST 정오 뒤), `i2/receipt.spec.ts`:136(첫 그림 응답과 내려받은 그림 비교 — 그 파일만 4번 되풀이하면 28/28 통과. 확인서 만든 시각이 분까지 찍혀 두 번 받은 그림이 분 경계를 넘으면 바이트가 달라지는 시험 경쟁으로 본다). `s05/fill` p99 183ms 통과.

### 새 시험
- `i2-import.test.ts`: SA-I2-001 200,000글자에 가까운 500줄(이모지 품종) 등록·`.xlsx` 200,000글자 상한, RA-I2-004 압축 폭탄·큰 시트·시트 수·잘린 zip·넓은 행(XFD)·1만 행.
- `i2-restore-contract.test.ts`: RA-I2-001·002 계약(위).
- `i2-json-stream.test.ts`: 조각을 어디서 잘라도 같은 값(속성 시험), 잘못된 JSON·상한.
- `i2-backup.test.ts` "RA-I2-005": 범위 둘(이벤트 약 2만 건) — 가장 긴 조각 = 한 묶음, 검사 중 `JSON.parse` 입력은 64KB 밑, 만드는 동안 이벤트 루프 멈춤이 짧다, 다른 서버로 복구·재생 검사 통과.
- `i2-work.test.ts`: 작업 풀(다른 스레드·조각·시간 상한·메모리 상한·오류·판매자마다 동시 작업·줄·끊김 — `test/work-test-worker.ts`), 구매자 100명 전원 PDF·대장을 연달아 만드는 동안 이벤트 루프 멈춤 < max(250ms, 서버 스레드에서 그릴 때의 절반) (재 보니 멈춤 약 110ms · 서버 스레드에서 그리면 약 930ms).

## 수정 라운드 2 (dev-server — SA-I2-006·007·008, TD-I2-008)

### SA-I2-006 (TD-I2-004) 계정의 가게 이름(50자)과 가게 설정(1~30글자)
- `PUT /api/shop`은 지금 저장된 가게 이름을 읽어 `checkShopInput(body, currentName)`에 넘긴다. 받은 이름(앞뒤 공백을 지운 값)이 지금 이름과 같으면 길이를 다시 따지지 않는다. 다른 이름으로 고치면 그대로 1~30글자, 빈 이름·제어 글자는 늘 거절.
- 계정 만들기(`accounts.ts` 50 UTF-16 단위)는 바꾸지 않았다: 적대 시험 TD-I2-004가 33글자 이름의 계정 만들기가 성공한다고 단언하고(그 뒤 설정 저장을 본다), 이미 31~50자 이름으로 만든 판매자가 있을 수 있다. 상한을 하나로 맞추려면(계정 만들기도 30글자) spec-keeper가 그 시험과 함께 정해야 한다 — 지금 판매자에게 생기는 사고(계좌를 못 적어 확인서에 입금 계좌가 안 나옴)는 이 수정으로 없다.

### SA-I2-007 (TD-I2-007) `.csv`·`.txt` 파일에서 나온 목록의 등록 본문
- AC-I2-51은 파일을 2MB로만 묶고 글자 수 상한(200,000)은 붙여 넣은 글에만 둔다. 적대 시험 TD-I2-007도 2MB 안의 EUC-KR CSV(약 104만 글자)가 미리 보기 "500개 등록하기" → 등록 성공이어야 한다고 단언한다. 그래서 `.csv`·`.txt`에 200,000글자 상한을 더하지 않고 **등록 본문 상한을 2MB 파일에서 나올 수 있는 가장 큰 등록 본문보다 크게** 했다.
  - 미리 보기 본문 상한 `IMPORT_PREVIEW_BODY_LIMIT_BYTES` = 3MB(그대로), 등록 본문 상한 `IMPORT_REGISTER_BODY_LIMIT_BYTES` = `3 × 2MB + 64KB`(둘 다 `import-files.ts`, `api.ts`가 경로마다 건다).
  - 근거: 품종 JSON(UTF-8)은 원래 파일 바이트의 3배를 넘지 않는다 — EUC-KR 두 바이트 글자 → 3바이트(1.5배), EUC-KR로 읽지 못한 바이트(예 0xFF) → U+FFFD 3바이트(3배), UTF-8 `\`·`"` → 2바이트, NFC로 풀리는 글자 → 많아야 3배. 줄 머리 500개·요청 번호는 64KB 여유 안.
- 미리 보기는 등록할 줄을 화면이 보내는 모양(`{ requestId(64자), rows: [{ no, name, price }] }`)으로 잰 UTF-8 바이트(`importRegisterBodyBytes`)가 등록 상한을 넘으면 "n개 등록하기"를 보이지 않고 413 `FILE_TOO_LARGE`(파일 "파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요.", 붙여 넣은 글 "붙여 넣은 내용이 너무 많아요. …")로 답한다 — 위 계산으로는 생기지 않지만 "미리 보기가 받은 목록은 늘 등록된다"를 코드로 지킨다.
- 413 문장에서 "(2MB까지)"를 뺐다(본문 상한은 파일 크기가 아니다): 미리 보기 "보낸 내용이 너무 커요. 파일은 2MB까지, 붙여 넣은 글은 200,000글자까지 가져올 수 있어요.", 등록 "등록할 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요."

### SA-I2-008 (TD-I2-008) 여러 날짜 조회가 공용 범위 상태 캐시를 밀어냄
- `ScopeWriter.readDetached(sellerId, date, rehearsal)`: 범위 줄(serial) 안에서, 메모리에 있으면 그 상태를 최신까지 따라잡아 쓰고, 없으면 스냅샷 + 뒤 이벤트로 임시 상태를 만들어 돌려준다 — 공용 상한 캐시(`#keep`)에 넣지 않는다.
- 쓰는 곳: 판매대장(기간·전체 — `#ledgerRows` 날짜마다), 지난 구매의 다른 날짜(`PastDeps.readOther`). 보고 있는 날짜 하나(지난 구매의 기준 날짜, 확인서·포장 등 한 날짜 조회)는 지금처럼 보통 읽기다.
- 그래서 한 판매자의 전체 판매대장이 방송 중인 다른 판매자의 범위 상태를 밀어내지 않고(D-096 원칙), 메모리도 한 번에 날짜 하나만큼만 잡는다(대장 행 생성기는 날짜마다 앞 상태를 놓는다).

### 새 시험 (수정 라운드 2)
- `i2-shop-receipts.test.ts` "SA-I2-006": 33글자 이름 계정 → 이름 그대로 + 계좌 저장(앞뒤 공백 포함), 다른 긴 이름 거절, 30글자 안으로 고친 뒤 긴 이름으로 되돌리기 거절, 빈 이름·제어 글자 거절.
- `i2-import.test.ts` "SA-I2-007": 품종 JSON이 가장 커지는 2MB 파일 둘(EUC-KR로 읽지 못한 0xFF 바이트 = 3배, UTF-8 역슬래시 = 2배) — 미리 보기 500개 → 같은 줄 등록 성공, 잰 크기 = 실제 본문. `importRegisterBodyBytes` = 실제 JSON 바이트(따옴표·역슬래시·이모지·U+2028·조합 글자·큰 가격), 등록·미리 보기 본문 상한 초과의 413 문장.
- `i2-ledger.test.ts` "TD-I2-008": 상한 4인 서버에서 판매자 B(지난 날짜 6일)의 기간 판매대장·전체 판매대장·지난 구매 뒤에도 판매자 A의 범위 상태가 같은 객체이고 캐시 크기가 늘지 않는다(수정 전 코드로 돌리면 실패함을 확인), `readDetached`의 두 경우(메모리에 있음 = 같은 객체, 없음 = 같은 상태의 임시 객체·캐시 그대로, 범위 없는 날짜 = 빈 상태).

### 검증 (수정 라운드 2, `E2E_PORT_OFFSET=800 pnpm verify`, 커밋 1131b1f, 같은 기계에서 다른 작업 폴더(i3·n2·n3·n5 등) 검증이 함께 돌아 부하 평균 약 20)
typecheck(TS 파일 440)·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·coverage 통과.
- test: 파일 138 · 2979 중 실패 1 — `packages/voice/test/perf.test.ts` p99 50ms(86ms, 부하). 부하가 내려간 뒤 혼자 두 번 돌려 둘 다 통과. 서버·server-i2 시험은 모두 통과.
- adversarial: 파일 40 · 808 중 실패 1 — `tests/adversarial/s00/verify-gates.test.ts` TD-S00-017 전제 시험(저장소 복사본에서 typecheck 단계를 90초 안에 끝내지 못해 SIGKILL, 종료 코드 null). 혼자 다시 돌리면 3개 모두 통과(각 약 16초). I2 적대 시험(TD-I2-004·007·008 포함)은 모두 통과.
- e2e: 206 중 202 통과 · 실패 4 — 모두 받은 시각 `00:00:0x`을 적는 기존 S06·S06b 문자찜 시험(`s06/attacks-r1`:172 둘·`s06/sms`:191·`s06b/names`:50, KST 정오 뒤 — SA-I2-003). main의 `ad1bdb8`(test-e2e 고침)을 이 트랙에 합치면 풀린다. I2 E2E는 모두 통과.

## 스펙과 다른 점 (disputesWithSpec)

- **AC-I2-30 흐름 5 "7번을 70번으로 번호 변경 → UC_B 포장 다시 확인(새로 담을 것 70번·뺄 것 7번)"**: DOMAIN_RULES R-10 번호 변경 1(D-056)은 "a에 붙어 있던 찜(확정·대기)은 전부 `REJECTED(RENUMBERED)`"이다 — 번호를 바꾸면 UC_B는 70번을 갖지 않으므로 바로 뒤 상태는 `포장 다시 확인`(뺄 것 7번, 새로 담을 것 없음)이다. 규칙 문장이 우선이라(acceptance 머리말 "정답의 우선순위") 서버 시험은 번호 변경 직후 `포장 다시 확인`·뺄 것 7번을 단언하고, 판매자가 70번을 UC_B에게 다시 배정한 뒤 AC 문장의 모양(새로 담을 것 70번·뺄 것 7번)을 단언한다. spec-keeper가 AC 문장을 고칠지 판정해 주세요.

## 다음 개발자(web)에게

- 날짜 보기(`GET /api/days/:date`)의 `packing` 칸은 증분 조회(`/changes`)에는 없다 — `packing` 알림이나 품목이 바뀌는 `change` 알림 뒤 `GET /api/days/:date/packing`(포장 화면) 또는 날짜 보기를 다시 받는다.
- 확인서 미리 보기: `receipt.png`를 받아 `URL.createObjectURL`로 보이고, 같은 바이트로 `File`(이름 = 응답 `Content-Disposition`의 UTF-8 이름)을 만들어 공유한다. 그림을 받는 동안·새 그림을 받기 전엔 공유·내려받기를 잠근다(`change`·`shop` 알림).
- 상품 목록 가져오기: 미리 보기 응답의 `rows` 중 `error`가 없는 줄의 `{ no, name, price }`를 그대로 등록에 보낸다(요청 번호는 다시 누를 때 같은 값). 거절(409 `IMPORT_CHANGED`)이면 같은 글·파일로 미리 보기를 다시 받는다. 파일은 base64로 싣는다.
- 판매대장 창의 방송 목록은 기존 `GET /api/broadcasts`에서 `rehearsal === false`이고 기간 안인 것.
- 오류는 늘 `{ error: { code, message, problems? } }` — 화면은 `message`를 그대로, 칸 오류는 `problems[].field` 옆에.

## 검증 (`E2E_PORT_OFFSET=800 pnpm verify`, dev-server 마지막 실행)

typecheck·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(799)·coverage 통과. 실패는 이 노트를 쓴 기계에서 다른 작업 폴더(main·i1·i3)의 검증이 함께 돌던 때다(부하 평균 20 넘음).
- test: `apps/server/test/changes.test.ts` 덮기 시험 시간 초과(위 교체로 한도를 늘렸다), `packages/voice/test/perf.test.ts` p99 50ms(부하 — device 영역, 바꾸지 않았다). 앞 실행에서 한 번 `apps/server/test/sms-contract.test.ts`의 "DB 전체에 '5555'가 없다"가 실패했다 — 무작위 ID·요약값(hex)에 '5555'가 우연히 든 경우로 I2 변경과 상관없다(덤프에 새로 든 값은 `sellers.shop` `{}`뿐).
- e2e 4개 실패(`s06/attacks-r1.spec.ts` 결과 카드 2·`s06/sms.spec.ts` AC-S06-14·81·`s06b/names.spec.ts` 받은 시각까지 같은 두 문자찜): 모두 받은 시각 `00:00:0x`을 적는 시험이다. KST 정오가 지나면 그 시각이 "내일"(지금보다 늦음)로 풀려 화면이 "받은 시각(내일 00:00:01)이 지금보다 늦어요. 이대로 넣을까요?"를 묻고 시험이 그 창을 모른 채 결과 카드를 기다린다(error-context 스냅샷으로 확인). 하루 중 시각에 기대는 기존 시험(test-e2e 영역)이고 서버 변경과 상관없다 — BASE 검증은 오전에 돌아 통과했다. `names.spec.ts`의 "채널 끝 4자리까지 같은 두 홍길동"은 한 실행에서 함께 실패했지만 혼자 돌리면 통과한다.

---

# dev-web (I2 [web] — AC-I2-02·13·14·15·22·33·35~39·41·52·55·65·80~82)

## 만든 것 (`apps/web`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/api/client.ts` | `put`, `getFile(path, { signal, fallbackName })`(바이트 그대로 + `Content-Disposition`의 UTF-8 `filename*` 이름 — 실패면 JSON 오류 본문의 문장으로 `ApiError`, 401이면 로그인 화면), `fileNameOf` | 13·14·22·39·65 |
| `src/api/types.ts` | `Shop`·`PackingEntry`·`PackingItem`·`PackingList`·`PackingResult`·`PackingLabelView`·`PastItem`·`PastView`·`ImportPreview`·`BackupStatus` (dev-server API 표 그대로) | — |
| `src/lib/console-store.ts` | SSE `packing`(보는 실제 범위 날짜만) → `snapshot.packingVersion`+1, `shop` → `shopVersion`+1. 다시 붙은 `ready`에서도 둘 다 +1(끊긴 사이 seq 없는 알림을 놓쳤을 수 있다) | 13·32·33 |
| `src/lib/use-packing.ts` | `usePackingList(date, trigger)` — `GET /api/days/:date/packing`을 (그날 묶음·품목·상품 합계·품종·구매자 이름·방송 제목의 모양 `closingSignature` + `packingVersion`)이 바뀔 때만 다시 받는다(채팅만 들어오면 받지 않는다). `receiptSignature(data, settlement)` — 그 묶음만의 모양. `packingLabelSignature(data, buyer)` — 그 묶음 포장 라벨에 찍히는 값(L-9)의 모양 | 33·35·37·39 |
| `src/lib/packing.ts` | 걸러 보기·순서·다음 구매자·바뀐 품목 차이·안내 글·상태 뜻(D-102) | 35~38 |
| `src/lib/files.ts` | `saveFile`(blob: 주소 + `download`), `canShareFiles`, `shareFile`(AbortError = 조용히), `sizeWords`, `fileBase64` | 13·15·39·52·65 |
| `src/components/ReceiptSection.tsx` | 정산 자세히의 "구매 내역 확인서" | 13·15 |
| `src/components/LedgerDialog.tsx` | "판매대장 엑셀" 창 | 22 |
| `src/components/SettlementsPage.tsx` | 날짜 줄의 "정산 문서"(전원 확인서·판매대장 / 리허설 안내), 실제 범위 목록·자세히의 포장·배송 상태, 자세히의 확인서 | 13·14·22·33 |
| `src/components/PackingPage.tsx` | 포장 모드 `/packing` | 35~39·55 |
| `src/components/SettingsPage.tsx` | 설정 `/settings` (가게·백업·전체 기록 내려받기) | 02·65 |
| `src/components/PastPurchases.tsx` | 구매자 자세히의 "지난 구매"(실제 범위만) | 41 |
| `src/components/ImportDialog.tsx` | 콘솔의 "상품 목록 가져오기" 창 (끝나지 않은 방송만) | 52 |
| `src/components/ErrorNote.tsx` | `RequestError` — 새 화면 오류: 끊김이면 "인터넷 연결을 확인하고 다시 눌러 주세요.", 아니면 서버 문장. "자세히"에는 오류 번호(HTTP 상태)만 — 영어 코드는 화면 글자에 없다 | 80·82 |
| `src/components/downloads.tsx` | `useDownload`·`DownloadButton` — 받는 동안 잠금(여러 번 눌러도 요청 하나)·"만드는 중" 글, 이름은 응답 머리의 이름 | 14·22·65 |
| `src/lib/router.ts`·`TopBar.tsx`·`App.tsx` | 주소 `/packing?date=&buyer=`·`/settings`, 메뉴 6개(방송·문자찜 입력·구매자·정산·포장·설정 — 휴대폰 아래 막대 6칸, 높이 그대로), 설정에서 저장하면 위 가게 이름이 바로 바뀐다 | 02·35 |

## 화면 계약 (test-e2e에게 — 역할·이름·글자)

공통: 받은 그림·파일·포장 체크는 브라우저 저장소에 두지 않는다(메모리 blob: 주소만). 주소에는 날짜·방송 ID·구매자 ID만.

**정산 `/settlements?date=…`**
- 날짜 줄(목록에서만): `group "정산 문서"` 안에 버튼 `전원 확인서 PDF (n명)`(n = 그날 품목 있는 묶음 수, 0이면 잠금 + "구매 내역이 있는 구매자가 없어요."), 누르면 같은 이름 그대로 잠기고 옆에 status "확인서 n명을 만드는 중이에요…". 실제 범위면 버튼 `판매대장 엑셀`, 리허설이면 글 "리허설 기록은 판매대장에 넣지 않아요.".
- 실제 범위: 휴대폰 카드 끝에 상태 꼬리표(`포장 대기` 등, 배송 완료는 `배송 완료 · 송장 123456789012`), PC 표는 **포장 목록을 받은 뒤에만** 9번째 열 머리 `포장·배송`(리허설·받지 못함이면 열 8개 그대로 — 기존 시험). 자세히의 입금 상태 꼬리표 옆에도 같은 꼬리표.
- 자세히 `region "구매 내역 확인서"`: `img "구매 내역 확인서 미리 보기"`(= `receipt.png` 응답 바이트), 버튼 `PDF 내려받기`, 공유할 수 있으면(`navigator.canShare({files})`가 참) `이미지 공유`, 아니면 `이미지 저장`(둘 중 하나만). 받는 동안 status "확인서를 만드는 중이에요…"·버튼 잠금. 공유 실패(AbortError 밖) → alert "공유하지 못했어요. '이미지 저장'으로 저장해 주세요."와 그 안의 `이미지 저장`. 리허설이면 꼬리표 "리허설 기록이에요.". 품목 없는 묶음은 "구매 내역이 없어 확인서를 만들 수 없어요."만. 공유하는 `File` = 미리 받은 같은 바이트, 이름 = 응답 머리 이름, `image/png`.
- AC-I2-15 확인법: 미리 보기 응답(`/receipt.png`)의 `X-Receipt-Created-At`으로 `GET /api/days/:date/receipt?buyer=…&at=<ms>`(E2E 서버만) → Node `renderReceiptPng(data, Pretendard)` 바이트 = 공유된 File 바이트. 이 노트를 쓰며 휴대폰 크기·가짜 share로 실제로 맞대어 같음을 확인했다(미리 보기 바이트도 같다).
- 판매대장 창 `dialog "판매대장 엑셀"`: `select "시작 날짜"`·`select "끝 날짜"`(선택지 = 실제 범위 날짜, 값 `YYYY-MM-DD`, 글 "2026년 10월 19일(월)" — `selectOption('2026-10-19')`), `group "방송 고르기"`(legend) 안 버튼 `모두 고르기`·`모두 풀기`, `list "판매대장에 넣을 방송"`의 체크 칸(이름 "2026년 10월 19일(월) · 1부", 기본 모두 고름). 주 버튼 `엑셀 내려받기`. 문제는 alert 글: "방송을 하나 이상 골라 주세요." · "시작 날짜가 끝 날짜보다 늦어요." · "고른 기간에 방송이 없어요." — 그때 버튼 잠금. 서버 거절(366일 넘음 등)은 서버 문장 그대로. 기간 안 방송을 모두 고르면 `b`를 적지 않는다.

**포장 `/packing?date=…&buyer=…`** (실제 범위만, 기본 = 오늘 KST → 가장 최근, 없으면 "아직 판매 기록이 없어요.")
- `select "날짜"`, `region "포장 목록"`: `group "걸러 보기"` 버튼 `포장할 것`(기본)·`포장 완료`·`배송 완료`·`전체`(`aria-pressed`). `list "포장할 구매자"`의 링크 줄 글 = 이름(BUY-01 표기)·`상품 n개`·상태 꼬리표(`data-tone` info/success/warning)·입금 완료가 아니면 `미입금`·`부분 입금`·`과입금`(warning). 빈 문장: "포장할 구매자가 없어요." · "포장 완료한 구매자가 없어요." · "배송 완료한 구매자가 없어요." · "그날 포장할 구매자가 없어요."(전체).
- `region "체크리스트"`(휴대폰은 목록 대신 화면 전체 + 버튼 `포장 목록으로`, 넓으면 목록 옆): 제목 h2 = 이름, 날짜·`상품 n개`·입금 상태·상태 꼬리표. 상품마다 `checkbox "15번 핑크프릴"`(빈 품종 "15번 품종 미입력", 방송이 둘 이상이면 방송마다 `group "<방송 제목>"`), 글 "n/m 담음". 버튼은 `group "포장·배송"` 안(상태별): `포장 완료`(포장 대기·포장 다시 확인 — 모두 체크 전엔 잠금 + "모두 담으면 포장 완료를 누를 수 있어요."), `배송 완료로 적기`(포장 완료), `송장번호 고치기`(배송 완료), `포장 완료 취소`(포장 완료·포장 다시 확인), `배송 완료 취소`(배송 완료·배송 뒤 바뀜). 결과 status "포장 완료로 적었어요."·"포장 완료를 취소했어요."·"배송 완료로 적었어요."·"배송 완료를 취소했어요."는 **상품 줄·"n/m 담음" 아래, `group "포장·배송"` 바로 위**(수정 라운드 1, UX-I2-001), 명령 오류(끊김 등)도 같은 자리. 포장 완료를 저장하면 `group "포장·배송"` 맨 앞에 버튼 `다음 구매자`(상태가 그대로 포장 완료면 주 버튼이고 `배송 완료로 적기`는 보조) — 저장되면 포커스가 `다음 구매자`로, 없으면 결과 안내로 간다(창이 닫힌 뒤). 보낸 사이 품목이 바뀌어 거절되면 그 자리에 status(warning) "그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.". 바뀐 품목 status(warning, 체크리스트 위) "구매 내역이 바뀌었어요 — 새로 담을 것: 31번 · 뺄 것: 28번" / "배송한 뒤 구매 내역이 바뀌었어요 — … . 따로 보내거나 환불해 주세요." — 지금 품목과 새로 담을 것·뺄 것을 합쳐 방송이 둘 이상이면 안내 번호에 방송 제목("뺄 것: 2부 7번")을 붙이고 체크리스트도 방송마다 `group "<방송 제목>"`·h3 제목(TD-I2-002).
- 창: `dialog "배송 완료로 적기"`(송장번호 고치기는 `dialog "송장번호 고치기"`) — 칸 `송장번호`(`inputmode=numeric`, 아래 도움말 "적지 않아도 돼요. 적으면 숫자만 남겨요."), 주 버튼 `배송 완료로 적기`, 서버 칸 문제는 칸 아래 alert. 입금 완료가 아니면 먼저 `dialog "입금 확인"` "아직 입금 완료가 아니에요(미입금). 그래도 배송 완료로 적을까요?" — `닫기`(처음 포커스)/`배송 완료로 적기`. 취소 확인 `dialog "포장 완료 취소"`("포장 완료를 취소할까요? 포장 대기로 돌아가요." — 버튼 `포장 완료 취소하기`), `dialog "배송 완료 취소"`("배송 완료를 취소할까요? 포장 완료로 돌아가요." — `배송 완료 취소하기`), 처음 포커스 `닫기`.
- `region "포장 라벨"`: 쪽마다 `img "포장 라벨 1/2쪽"`·버튼 `그림 저장`, 버튼 `라벨 PDF`. 받는 동안 "포장 라벨을 만드는 중이에요…"·잠금. 다시 받는 때 = 라벨에 찍히는 값(L-9: 품목 키·방송 제목·상품 합계·구매자 종류와 표시 이름)이나 가게 설정 알림이 바뀔 때 — 범위 자료에서 바로 정한다(포장 목록을 다시 받기를 기다리지 않는다, SA-I2-002). 품목 없음 "담을 상품이 없어 포장 라벨을 만들 수 없어요.". B1·프린터 버튼 없음.

**설정 `/settings`**: 칸 `가게 이름`·`은행`·`계좌번호`·`예금주`·`입금 안내 문장`, `region "확인서에 나올 모양"`("농협 302-9988-7766-11 (예금주 김판매)"와 안내 문장 / "확인서에 입금 계좌가 나오지 않아요." / 일부만이면 "은행·계좌번호·예금주가 모두 있어야 확인서에 계좌가 나와요." — 서버 거절 문장과 다른 글), 주 버튼 `저장` → status "저장했어요.". 서버 칸 문제는 그 칸 아래(`aria-describedby`), 문장은 alert 하나. 백업: "마지막 자동 백업: 2026년 10월 20일 (화) 04:00"(없으면 "없음"), "백업은 30일 동안 보관해요.", `list "보관 중인 백업"`("2026년 10월 20일 (화) 04:00 · 1.2MB"), "백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.", 멈춤이면 alert(warning) "자동 백업이 멈췄어요. 운영자에게 알려 주세요.". 전체 기록: 버튼 `전체 기록(JSON)`·`전체 판매대장(엑셀)`(누르면 잠금 + "만드는 중이에요…"), 경고 "구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.".

**구매자 자세히(실제 범위)** `region "지난 구매"`: 항목 링크(→ `/settlements?date=<그날>&buyer=<그날 구매자>`) 글 = 날짜(연도·요일)·방송 제목들·"그날 이름 …"·"상품 n개 (15번 핑크프릴 10,000원 · …)"·"최종 …원"·입금 상태·포장 상태(송장)·까닭. 없으면 "다른 날의 구매 기록이 없어요.", 더 있으면 버튼 `더 보기`.

**콘솔(끝나지 않은 방송)** 버튼 `상품 목록 가져오기` → `dialog "상품 목록 가져오기"`: 안내 문장, `textbox "붙여 넣기"`(처음 포커스), 파일 칸 `파일 고르기`(숨긴 `input[type=file]`의 label — `getByLabel('파일 고르기').setInputFiles(...)`; 고르면 "고른 파일: 목록.xlsx"이고 붙여 넣은 글은 비운다 — 입력은 한 번에 하나, 글을 다시 치면 고른 파일을 버린다; 2MB 넘는 파일은 올리기 전에 alert "파일이 너무 커요(2MB까지)."), 버튼 `미리 보기`·`n개 등록하기`(주, n=0이면 잠금). 미리 보기 `region "미리 보기"`: "등록할 상품 n개 · 빼는 줄 m개", "머리글로 보고 뺀 줄: 1번 줄 (번호, 품종, 가격)", `table "가져올 상품"`(열 줄·번호·품종·가격·문제 — 문제 줄은 번호~가격 칸에 원래 줄 글, 문제 칸에 쉬운 말, 줄 `data-tone=warning`). 목록 문제 "가져올 상품이 없어요." / "한 번에 500개까지 가져올 수 있어요.". 성공 status "n개를 공개 전 상품으로 등록했어요.", 거절(409 IMPORT_CHANGED) → 같은 입력으로 새 미리 보기 + alert "그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.". 닫으면 빠른 입력칸에 포커스.

## 결정 (규칙 문장으로 정해지지 않은 화면 선택)
1. **공유/저장 버튼은 둘 중 하나** (AC-I2-13 "공유할 수 있는 기기면 '이미지 공유', 아니면 '이미지 저장'"): 공유 실패 때만 공유 기기에도 `이미지 저장`이 나온다. "세 버튼이 잠긴다"는 그 부분의 버튼 전부(PDF·공유/저장·실패 안내의 저장)로 읽었다.
2. **확인서 다시 받기 조건**: 그 묶음(품목·금액·기록)·구매자 표시 이름·끝자리·품목 품종·방송 제목·가게 설정 알림이 바뀔 때. 받는 중 다시 바뀌면 앞 요청을 끊는다. 실패하면 이전 그림도 지운다(바뀐 뒤 옛 그림을 공유하지 않게).
3. **판매대장 날짜 고르기 = 실제 범위 날짜의 select**(연도·요일 글): 방송 없는 날을 고를 까닭이 없고 날짜 입력(브라우저 달력)은 요일을 못 보인다. 366일 넘는 기간은 서버 문장 그대로 보인다.
4. **포장 목록 순서의 "이름"** = 표시 이름(구매자 목록 `buyerList`와 같은 `localeCompare('ko')` → ID). 줄 글은 BUY-01 이름 표기(`BuyerNames`).
5. **바뀐 품목 안내의 기준**: 포장 대기면 체크리스트를 연 때(또는 이 화면에서 포장·포장 취소가 저장된 때)의 품목과 지금 품목을 화면이 견주고, 포장 다시 확인·배송 뒤 바뀜이면 서버의 `add`·`remove`를 쓴다. 포장 완료·배송 완료면 안내하지 않는다(서버가 같다고 정한 상태).
6. **포장 명령 요청 번호**: 같은 (구매자, 명령 본문)이면 끊김·SAVE_FAILED 뒤 다시 눌러도 같은 번호(`withRetry` 자동 3번 뒤에도). 409 등 거절이면 다음 누름은 새 번호.
7. **"정산 문서" 버튼 자리 = 날짜 줄**: 거르기 줄에 두면 1440×900에서 줄이 하나 늘어 PC 표가 8줄 아래로 밀렸다(AC-S06b-21 E2E). 날짜 줄은 PC에서 자리가 남는다.
8. **PC 표의 `포장·배송` 열은 포장 목록을 받았을 때만**(실제 범위): 리허설에는 포장이 없고, 받지 못한 동안 빈 열을 두지 않는다.
9. **새 화면 오류의 "자세히"에는 오류 번호만** — AC-I2-80(영어 코드가 화면 글자에 없다)을 접힌 글까지 지킨다. 기존 화면의 `ErrorNote`는 그대로.

## 바꾼 기존 시험 (교체 — 약화 아님)
| 시험 | 전 | 후 | 이유 |
|---|---|---|---|
| `apps/web/test/pwa.test.tsx` "메뉴 (AC-S06-01)" | 링크 4개 `['방송','문자찜 입력','구매자','정산']` | 6개(+`포장`·`설정`), 포장 링크는 리허설 날짜를 잇지 않음(`/packing`), 설정 `/settings` 단언 더함 | AC-I2-02·35 — 메뉴에 포장·설정 |

## 새 웹 시험
- `apps/web/test/closing-lib.test.ts` — 포장 거르기·순서·다음 구매자·바뀐 품목 글, 파일 이름(UTF-8 `filename*`·경로·제어 글자), 크기·KST 시각 글, 계좌 미리 보기·백업 멈춤 판단, 판매대장 주소, 가져오기 문제 말.
- `apps/web/test/closing-pages.test.tsx` — 포장 모드(실제 코어 가짜 서버 + 가짜 포장 기록: 목록·걸러 보기·SSE packing 다시 받기·체크·포장 완료 본문·연 동안 품목 변경·거절 뒤 안내·포장 다시 확인·배송 완료 입금 확인·송장 문제·취소·끊김 뒤 같은 요청 번호), 설정(저장·칸 문제·미리 보기·백업·멈춤), 가져오기(미리 보기 표·거절 뒤 새 미리 보기·등록 본문·목록 문제), 확인서(같은 바이트 File 공유·AbortError·실패 안내·다시 받는 동안 잠금·리허설·품목 없음).

## 테스트용 기동 (화면까지 손으로 볼 때)
```
pnpm --filter @livejjim/server e2e --port 3900 --origin http://localhost:5973 --host-delay-ms 2000   # 서버 (메모리 DB, 시험 계정 e2e-shop / e2e-pass-1234)
cd apps/web && node e2e/serve.ts --port 5973 --api http://127.0.0.1:3900                             # 화면 (운영 빌드 + /api 프록시)
```
실제 범위 판매는 화면/API의 문자찜(`type: 'sms'`, 전화번호 있으면 같은 구매자)과 `product.open`으로 만든다(채팅 찜은 리허설 생성기·시청자로 보내기만). E2E 묶음은 `E2E_PORT_OFFSET=800`이면 chromium 스택이 이 포트(3900·5973)를 쓴다 — 손으로 띄운 서버가 있으면 Playwright가 그대로 다시 쓰니 verify 전에 끈다.

## 수정 라운드 1 (dev-web — SA-I2-002·UX-I2-001·TD-I2-002)
- **SA-I2-002 (TE-I2-001) 포장 라벨 다시 받기**: 라벨 signature를 품목 키·품종·shopVersion에서 `packingLabelSignature(data, buyer)`(그 묶음 `settlement.items`·`subtotal`, 구매자 `kind`·`display`, 방송 제목들) + `shopVersion`으로 바꿨다. L-9 포장 라벨에 찍히는 값(가게 이름·구매자·날짜·번호·상품 합계)을 모두 덮는다 — 입금 전 찜까지 가격을 바꾸거나(UNPAID_CLAIMS) 닉네임이 바뀌어도 새로 받고, 받는 동안 "그림 저장"·"라벨 PDF"를 잠근다. 다른 묶음·채팅·입금만 바뀌면 받지 않는다. `closingSignature`에도 `settlement.subtotal`을 넣어 포장 목록(`items[].price` 가격 스냅샷)도 다시 받는다.
- **UX-I2-001 결과·다음 구매자 자리**: 결과 안내·명령 오류를 상품 줄 아래 버튼 줄 바로 위로, `다음 구매자`를 버튼 줄 맨 앞으로 옮겼다. 포장 완료 직후(상태가 그대로 포장 완료)엔 `다음 구매자`가 주 버튼, `배송 완료로 적기`는 보조. 저장되면 포커스를 `다음 구매자`(없으면 결과 안내 — `tabIndex=-1`)로 옮겨 휴대폰에서도 그 자리가 화면 안으로 온다(창이 열려 있으면 닫힌 뒤). 거절(ITEMS_CHANGED) 때는 위 안내와 겹치지 않는 짧은 결과 "그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요."를 같은 자리에.
- **TD-I2-002 방송이 다른 같은 번호**: 방송 제목을 붙일지(`multi`)를 지금 품목만이 아니라 지금 품목 + 새로 담을 것 + 뺄 것으로 정한다(`checklistSpansBroadcasts`). 안내("뺄 것: 2부 7번")와 체크리스트 방송 제목(h3 "1부") 모두 같은 값을 쓴다.
- 새 웹 시험: `closing-lib.test.ts` — 라벨·포장 목록 signature(가격 UNPAID_CLAIMS·NEW_ONLY, 닉네임, 다른 구매자 입금·채팅, 품목), 방송이 다른 같은 번호. `closing-pages.test.tsx` — 결과·다음 구매자 문서 순서·포커스·주 버튼, 다음 구매자 없음·창 닫힌 뒤 포커스, 거절 결과 자리, 1부 7번·2부 7번(포장 대기·포장 다시 확인), 가격·닉네임 변경 때 라벨 PNG 다시 받기와 상관없는 변경 때 받지 않기. 여섯 시험 모두 고치기 전 코드에서 실패함을 확인했다. 가짜 포장 기록의 `remove`가 방송을 늘 `b1`로 적던 것을 상품 키의 방송·제목으로 고쳤다(시험 도우미).
- 바꾼 기존 시험 없음.
- 검증(`E2E_PORT_OFFSET=800 pnpm verify`, 커밋 59356aa, 다른 작업 폴더 검증이 함께 돌아 부하 평균 약 27~37): typecheck(TS 439)·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(39파일 804)·coverage(라인 100% · 분기 99.66%) 통과. test 실패 3(core engine-timing·server chat-messages 시간 초과·voice perf p99 — 부하, 따로 돌리면 chat-messages·voice 통과, engine-timing은 두 번 중 한 번 통과). e2e 통과 201 · 실패 5: I2 E2E는 TE-I2-001 포함 모두 통과. 실패는 받은 시각 `00:00:0x` 문자찜 넷(SA-I2-003 — main ad1bdb8·ac178c5의 test-e2e 고침이 이 트랙에 없음, KST 정오 뒤 실패)과 `s05/fill` p99(부하, SA-I2-004). 웹 단위 시험 29파일 474개.

## 수정 라운드 2 (dev-web — SA-I2-003·GATE-I2-VERIFY)
- 웹 코드는 바꾸지 않았다. 서버 수정 라운드 2(SA-I2-006·007·008)에 맞춰 화면을 확인했다.
  - 설정 화면은 가게 이름 길이를 따로 따지지 않고 서버 칸 오류만 보인다 — 31~50자 이름의 판매자도 이름 그대로 계좌만 적어 저장된다(서버 `checkShopInput(body, currentName)`).
  - 가져오기 창은 미리 보기 413 `FILE_TOO_LARGE`(파일 "파일 안의 내용이 너무 많아요…"·붙여 넣은 글 "붙여 넣은 내용이 너무 많아요…")와 등록 413의 `message`를 `RequestError`로 그대로 보인다. 같은 문장의 칸 오류는 겹쳐 보이지 않는다. 글을 고치거나 파일을 고르면 지난 미리 보기를 지우므로, 실패한 미리 보기 옆에 다른 입력의 "n개 등록하기"가 남지 않는다. 등록 본문은 서버가 잰 모양 그대로다(`{ requestId, rows: [{ no, name, price }] }`, 요청 번호 36자 ≤ 64).
- **SA-I2-003**은 test-e2e 영역 파일이다(`tests/e2e/s06/support.ts`의 `smsUi`, `s06/attacks-r1.spec.ts`:172, `s06/sms.spec.ts`:191, `s06b/names.spec.ts`:50). 받은 시각을 `00:00:0x`로 고정해 두어, KST 정오 뒤에는 D-023에 따라 "내일"로 읽히고 늦은 시각 확인 창이 뜬다. 제품은 스펙대로 동작하고, 개발자는 `tests/**`를 쓰지 않는다(CLAUDE.md 절대 규칙 4). main의 `ad1bdb8`(`kstTimeAgo`)·`ac178c5`(names.spec)가 고친 것이라 합칠 때 풀린다. I2 웹 변경은 문자찜 화면(QuickInput·받은 시각 풀이)을 건드리지 않았다(`git diff 9f51ed9..HEAD -- apps/web` 확인).
- 검증(`E2E_PORT_OFFSET=800 pnpm verify`, 커밋 7ba8577, KST 22:26 시작, 다른 작업 폴더(n2·n3·n5) 검증이 함께 돌아 부하 평균 10~36): EXIT=1.
  - 통과: typecheck(TS 440)·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(파일 40 · 808 모두 — 라운드 1의 TD-I2-004·007·008 포함)·coverage(라인 100% · 분기 99.66%).
  - test: 2979 중 실패 4. 모두 웹 밖이고 I2가 건드리지 않은 시험이다.
    - core `engine-timing`(8,000/2,000 비율 8.78 > 8)·`engine-properties-s03`(5초 초과): 부하가 내려간 틈에 혼자 다시 돌리니 둘 다 통과.
    - server `chat-messages`(30초 초과)·voice `perf.test.ts` p99(114ms > 50ms): 부하 평균 36에서 혼자 다시 돌려도 실패. main은 voice 시간 시험을 D-902대로 `extract.perf.test.ts`로 게이트 밖에 두었고(df0f71b), 무거운 속성 시험 시간 제한을 올렸다(49ba408). 그래서 합칠 때 풀린다.
  - e2e: 206 중 202 통과 · 실패 4 — SA-I2-003의 넷 그대로다. error-context에 "받은 시각(내일 00:00:01·00:00:07)이 지금보다 늦어요. 이대로 넣을까요?"가 남아 있다. attacks-r1 둘은 그 창 때문에 번호 칸이 비지 않았다("15"). I2 E2E는 모두 통과.

## 검증 (dev-web, `E2E_PORT_OFFSET=800 pnpm verify`)
typecheck·lint·test(파일 135 · 테스트 2940)·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(799)·coverage 통과. e2e 165 통과 · 4 실패 — dev-server가 적은 것과 같은 넷(`s06/attacks-r1` 문자찜 결과 위치 375·1440, `s06/sms` AC-S06-14·81, `s06b/names` 받은 시각까지 같은 두 문자찜)이고 모두 받은 시각 `00:00:0x`를 KST 정오 뒤에 넣어 "받은 시각(내일 00:00:01)이 지금보다 늦어요" 창이 뜬 것(error-context 확인 — 문자찜 화면, 이번 웹 변경과 상관없음, test-e2e 영역). 웹 단위 시험 29파일 464개.
