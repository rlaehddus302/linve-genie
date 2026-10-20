# I2 개발 노트 — dev-server (정산 마무리: 확인서·판매대장·포장·과거 구매·상품 목록 가져오기·백업)

작업 폴더 `/Users/unhoyeo/livejjim-wt/i2`, 브랜치 `track/i2-settle-docs`. 스펙 커밋 bcba8a7, BASE 9f51ed9. 순서: server(이 노트) → web.

## 만든 것 (`apps/server`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/product-import.ts` | R-18 해석 순수 함수 `parseProductList(text, { unit, maxNumber, existing })`·`.xlsx` 행 입구 `parseProductRows(rows, settings)`·등록 직전 다시 검사 `recheckRows`·`isNormalizedName`·`splitImportLines`·`splitCells`. `@livejjim/core`만 import(정규화·금액·휴대폰 번호 = `normalizeText`·`parseAmount`·`containsPhoneRun`) | AC-I2-50 |
| `src/import-files.ts` | `.csv`·`.txt` → 글(UTF-8, BOM 제거, 올바르지 않으면 EUC-KR), `.xlsx` → 첫 시트 행(수 = `String(n)`, 수식 = 저장된 계산 값, 날짜 = `YYYY-MM-DD`(UTC 칸), 빈 칸 = `''`, 줄 번호 = 행 번호) | AC-I2-51 |
| `src/shop.ts` | 가게 설정 검사·읽기·쓰기(`sellers.name` + `sellers.shop` JSON), 문서 패키지 모양 `documentShop` | AC-I2-01 |
| `src/files.ts` | 문서 글꼴(Pretendard, 한 번 읽음), 파일 이름 `<이름>` 다듬기 `fileNamePart`, `Content-Disposition`(UTF-8 `filename*` + ASCII 대체), 파일 응답 | AC-I2-10·81 |
| `src/packing.ts` | 포장 기록 재생·상태 말·묶음 보기(`packingEntry`·`packingEntries`·`packingStatusByBuyer`)·명령 판단(`decidePacking`)·송장번호(`readInvoice`)·포장 라벨 데이터(L-9)·렌더 | AC-I2-30~34 |
| `src/past.ts` | 지난 구매(표지 = 채널 ID·전화번호 키, 한 번만 따라감, 20개씩) | AC-I2-40 |
| `src/backup.ts` | 백업 파일 만들기·검사·재생, 폴더 저장소(`FolderBackupStorage`), 매일 자동 백업(`BackupScheduler`), 복구·가져오기(`restoreSeller`), 발송함 실행 대상 수(`executableOutboxCount`) | AC-I2-60~64 |
| `src/closing.ts` | `ClosingService` — 위를 엮는 서비스(가게 설정·확인서·판매대장·포장·라벨·지난 구매·가져오기·백업 상태·전체 내려받기) | 전부 |
| `src/api.ts` | 새 경로(아래 표), 날짜 보기에 `packing` 칸, 가져오기 미리 보기만 본문 3MB | 전부 |
| `src/hub.ts` | seq 없는 이름 붙은 알림 `publishNamed(seller, 'packing' \| 'shop' \| 'generator', data)` | AC-I2-13·32 |
| `src/writer.ts` | `withScope`(범위 줄 안 덧붙이기 기록 — 포장 명령), `forgetSeller`(복구 뒤 캐시 비우기) | AC-I2-31·62 |
| `src/commands/restore.ts`·`restore-args.ts` | 복구·가져오기 명령 | AC-I2-62 |
| `src/e2e.ts`·`commands/e2e-server.ts` | 백업 폴더·시작 백업·`?at=` | AC-I2-15·65 |
| `test/i2-*.test.ts`·`test/i2-support.ts`·`test/product-import.test.ts` | 서버 시험(PGlite·가짜 시계·임시 폴더): 가게 설정·확인서(G-ENG-201·202를 서버 쓰기 경로로)·전원 PDF·금액 불일치(코어 getSettlement 가짜)·판매대장·포장 흐름 1~7·명령·실시간·라벨·지난 구매·가져오기(EUC-KR·BOM·.xlsx 픽스처는 시험이 만든다)·백업 형식·자동 백업·보관·복구(손상 파일 10종·중간 실패·바꾸기)·리허설·전체 내려받기·격리·로그·복구 명령(자식 프로세스)·E2E 기동. 성능 기준(전원 PDF 30초·대장 31일 20초·지난 구매 2초·가져오기 1초/2초·백업 60초)도 여기서 잰다 | 전부 |
| `drizzle/0003_i2_shop_packing_restore.sql` | `sellers.shop`, `packing_records`, `outbox.restored`, `broadcasts` 기본 키 (판매자, 방송) | — |
| 의존성 | `apps/server`: `@livejjim/documents`·`@livejjim/label`(workspace), `exceljs` 4.4.0(문서 패키지와 같은 판) | — |
| `.env.example` | `LIVEJJIM_BACKUP_DIR` | AC-I2-61 |

## API (web·tester에게 — 모두 세션 필요(401), `Cache-Control: no-store`, 다른 판매자의 자원은 404)

`?rehearsal=true`는 날짜 경로의 리허설 범위(적지 않으면 실제 범위). 구매자 ID는 검색값 `buyer`(합쳐진 구매자 ID면 지금의 구매자로 푼다 — 포장 명령만 예외). 휴대폰 번호 모양의 구매자 값은 400(D-079 ⑥ 문장).

| 메서드·경로 | 요청 | 성공 응답 | 오류 |
|---|---|---|---|
| `GET /api/shop` | — | `{ shop: { name, bank, accountNumber, accountHolder, accountNote } }` (빈 칸은 `""`) | — |
| `PUT /api/shop` | `{ name, bank, accountNumber, accountHolder, accountNote }` 다섯 칸 모두 문자열 | `{ shop }` + 실시간 `shop` 알림 | 400 `INVALID_INPUT`(칸별 `problems` — 계좌 일부만이면 message = "은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요."), `UNKNOWN_FIELD` |
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
| `POST /api/broadcasts/:id/import/preview` | `{ text }` 또는 `{ file: { name, data(base64) } }` 하나 — 본문 상한 3MB | `{ broadcast, unit, maxNumber, error: 'EMPTY'\|'TOO_MANY'\|null, header, headerCells, rows: [{ line, no, name, price, text } \| { line, error, text }], register, problems }` | 409 `BROADCAST_ENDED` "끝난 방송에는 상품 목록을 가져올 수 없어요.", 413 `FILE_TOO_LARGE` "파일이 너무 커요(2MB까지).", 400 `FILE_TYPE` "엑셀(.xlsx)이나 CSV 파일을 골라 주세요.", 400 `FILE_UNREADABLE` "파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.", 413(글 200,000글자 초과), 404 |
| `POST /api/broadcasts/:id/import` | `{ requestId, rows: [{ no, name, price }] }` 1~500개(미리 보기의 등록할 줄 그대로 — 품종은 정규화한 글) | `{ registered, seq }` (같은 요청 번호 = 처음 결과) | 409 `IMPORT_CHANGED` "그 사이에 바뀐 것이 있어요. 다시 확인해 주세요."(`problems[].field = rows.<i>`), 409 `BROADCAST_ENDED`, 400 형식, 404 |
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

## 백업 파일 형식 (gzip JSON 하나, `format: "livejjim-seller-backup"`, `version: 1`)

```
{ format, version, createdAt(UTC ISO), sellerId,
  shop: { name, bank, accountNumber, accountHolder, accountNote },
  settings: { …판매 규칙 설정 덮어쓰기(점 표기) },
  scopes: [ { date, rehearsal, seq,
              broadcasts: [ { id, date, title, startSeq, endedAt(ISO|null), createdAt(ISO) } ],
              events: [ { seq, type, body(엔진 이벤트 JSON 문자열), at, receivedAt(ISO), actor('account'|'server'|'collector'), accountId, requestId, failed, digest } ] } ],
  packing: [ { date, buyer, kind, items, invoice, accountId, requestId, createdAt(ISO) } ],
  digest }
```
- 범위 순서 = 날짜 → 실제 먼저, 이벤트 = seq 순, 포장 = 기록 순. 범위마다 범위 행의 seq를 먼저 읽고 그 seq까지 담는다(긴 트랜잭션 없음 — 쓰기를 막지 않는다).
- 방송 목록은 그 이벤트로 정한다(`broadcast.start`·`end`가 상태를 바꾼 것, 끝난 시각 = end 이벤트의 at) — 방송 표와 같은 규칙.
- 이벤트 `digest` = SHA-256(JSON `[date, rehearsal, seq, type, body, failed]`) (범위 ID에 기대지 않아 다른 판매자로도 가져온다). 파일 `digest` = SHA-256(만든 시각·digest를 뺀 내용의 키 정렬 JSON) — 같은 기록이면 만든 시각 말고 같은 내용·같은 digest.
- 넣지 않는다: 비밀번호 해시·로그인 아이디·세션·로그인 시도 기록·판매자 전화번호 키(암호문)·마스터 키·스냅샷·발송함. `accountId`는 서버가 만든 불투명 ID다(로그인 아이디 아님).

## 매일 자동 백업

- 저장소 = 어댑터 `BackupStorage`. 이번에는 폴더 저장소 `LIVEJJIM_BACKUP_DIR/<판매자 ID>/<종류>-<UTC 시각>.json.gz`(종류 `daily`·`safety`). 파일 이름에 판매자 이름·구매자 정보 없음. 임시 이름에 쓰고 바꾼다.
- **확인 주기 5분**(`BACKUP_CHECK_INTERVAL_MS`), 켤 때 한 번 바로. 판매자마다 그날(KST) 04:00이 지났고 그날 04:00 뒤의 `daily`가 없으면 하나 만든다(기록 없는 판매자도). 확인마다 보관 정리: 만든 지 30×24시간이 지난 파일을 지우되 판매자마다 가장 최근 파일 하나는 남긴다(종류와 상관없이).
- 한 판매자가 실패해도 다음 판매자로 간다 — 경보 `BACKUP_FAILED`(판매자 ID·오류 종류만), 다음 확인 때 다시. 저장소가 없으면 시작 경보 `BACKUP_DISABLED` "백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요."(판매는 그대로, `GET /api/backups` → `enabled: false`).
- 시험은 `server.backups.check()`를 가짜 시계로 직접 부른다(`createServer({ backupStorage, clock })`).

## 복구·가져오기 명령 (운영자)

```
LIVEJJIM_PGLITE_DIR=… (또는 DATABASE_URL=…) LIVEJJIM_BACKUP_DIR=… \
  pnpm --filter @livejjim/server restore --seller <판매자 ID> --file <파일.json.gz> [--replace]
```
- 검사(하나라도 어긋나면 아무것도 바꾸지 않음, 종료 코드 1): 형식 이름·번호, gzip·JSON, 파일 요약값, 이벤트마다 요약값, 범위마다 seq 1부터 빈틈없음·범위 seq = 마지막 seq, (날짜, 리허설) 겹침, 범위마다 처음부터 재생(실패 표시는 건너뜀 — 본문과 칸(type·seq·at) 일치, 입력 오류·형식 오류 없음, 불변식), 방송 목록 = 이벤트로 정한 것, 판매 규칙 설정 `checkSettings`(MANUAL 거절), 포장 기록 형식·차례·요청 번호 중복·날짜가 실제 범위.
- 기록이 없는 판매자면 가져온다. 기록이 있으면 `--replace`가 있을 때만: 먼저 지금 기록의 안전 백업(`safety-…`)을 백업 저장소에 쓰고(저장소가 없거나 실패하면 멈춤) 한 트랜잭션에 그 판매자의 범위·방송·이벤트·스냅샷·발송함·포장 기록·가게 설정(이름 포함)·판매 규칙 설정을 바꾼다. 트랜잭션 안에서 그 판매자의 범위 락을 모두 잡는다.
- 재생으로 스냅샷(범위마다 마지막 seq 하나)·발송함을 다시 만들고 발송함은 모두 `restored = true`(실행하지 않음). 실행기(I1·Y1)의 실행 대상 조회는 `rehearsal = false AND restored = false`여야 한다 — `executableOutboxCount`가 그 조건이다(합칠 때 오케스트레이터가 지키게 한다, D-I2-11).
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
11. **방송 표 기본 키를 (판매자, 방송)으로**: 같은 서버의 빈 판매자로 가져오기(AC-I2-64)에서 원래 판매자의 방송 ID와 부딪쳤다. 방송 조회는 처음부터 판매자 ID를 함께 건다.
12. **E2E `?at=`**: 위 "E2E 서버 설정". 고정 시계 E2E 묶음을 따로 두는 것보다 화면 동작을 건드리지 않고 같은 데이터를 결정적으로 얻는다.

## 스펙과 다른 점 (disputesWithSpec)

- **AC-I2-30 흐름 5 "7번을 70번으로 번호 변경 → UC_B 포장 다시 확인(새로 담을 것 70번·뺄 것 7번)"**: DOMAIN_RULES R-10 번호 변경 1(D-056)은 "a에 붙어 있던 찜(확정·대기)은 전부 `REJECTED(RENUMBERED)`"이다 — 번호를 바꾸면 UC_B는 70번을 갖지 않으므로 바로 뒤 상태는 `포장 다시 확인`(뺄 것 7번, 새로 담을 것 없음)이다. 규칙 문장이 우선이라(acceptance 머리말 "정답의 우선순위") 서버 시험은 번호 변경 직후 `포장 다시 확인`·뺄 것 7번을 단언하고, 판매자가 70번을 UC_B에게 다시 배정한 뒤 AC 문장의 모양(새로 담을 것 70번·뺄 것 7번)을 단언한다. spec-keeper가 AC 문장을 고칠지 판정해 주세요.

## 다음 개발자(web)에게

- 날짜 보기(`GET /api/days/:date`)의 `packing` 칸은 증분 조회(`/changes`)에는 없다 — `packing` 알림이나 품목이 바뀌는 `change` 알림 뒤 `GET /api/days/:date/packing`(포장 화면) 또는 날짜 보기를 다시 받는다.
- 확인서 미리 보기: `receipt.png`를 받아 `URL.createObjectURL`로 보이고, 같은 바이트로 `File`(이름 = 응답 `Content-Disposition`의 UTF-8 이름)을 만들어 공유한다. 그림을 받는 동안·새 그림을 받기 전엔 공유·내려받기를 잠근다(`change`·`shop` 알림).
- 상품 목록 가져오기: 미리 보기 응답의 `rows` 중 `error`가 없는 줄의 `{ no, name, price }`를 그대로 등록에 보낸다(요청 번호는 다시 누를 때 같은 값). 거절(409 `IMPORT_CHANGED`)이면 같은 글·파일로 미리 보기를 다시 받는다. 파일은 base64로 싣는다.
- 판매대장 창의 방송 목록은 기존 `GET /api/broadcasts`에서 `rehearsal === false`이고 기간 안인 것.
- 오류는 늘 `{ error: { code, message, problems? } }` — 화면은 `message`를 그대로, 칸 오류는 `problems[].field` 옆에.

## 검증 (`E2E_PORT_OFFSET=800 pnpm verify`, 마지막 실행)

typecheck·lint·golden(파일 26 · 파서 469 · 엔진 125 · 통과 594)·adversarial(799)·coverage 통과. 실패는 이 노트를 쓴 기계에서 다른 작업 폴더(main·i1·i3)의 검증이 함께 돌던 때다(부하 평균 20 넘음).
- test: `apps/server/test/changes.test.ts` 덮기 시험 시간 초과(위 교체로 한도를 늘렸다), `packages/voice/test/perf.test.ts` p99 50ms(부하 — device 영역, 바꾸지 않았다). 앞 실행에서 한 번 `apps/server/test/sms-contract.test.ts`의 "DB 전체에 '5555'가 없다"가 실패했다 — 무작위 ID·요약값(hex)에 '5555'가 우연히 든 경우로 I2 변경과 상관없다(덤프에 새로 든 값은 `sellers.shop` `{}`뿐).
- e2e 4개 실패(`s06/attacks-r1.spec.ts` 결과 카드 2·`s06/sms.spec.ts` AC-S06-14·81·`s06b/names.spec.ts` 받은 시각까지 같은 두 문자찜): 모두 받은 시각 `00:00:0x`을 적는 시험이다. KST 정오가 지나면 그 시각이 "내일"(지금보다 늦음)로 풀려 화면이 "받은 시각(내일 00:00:01)이 지금보다 늦어요. 이대로 넣을까요?"를 묻고 시험이 그 창을 모른 채 결과 카드를 기다린다(error-context 스냅샷으로 확인). 하루 중 시각에 기대는 기존 시험(test-e2e 영역)이고 서버 변경과 상관없다 — BASE 검증은 오전에 돌아 통과했다. `names.spec.ts`의 "채널 끝 4자리까지 같은 두 홍길동"은 한 실행에서 함께 실패했지만 혼자 돌리면 통과한다.
