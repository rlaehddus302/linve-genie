# N4b dev-notes

## dev-server

### 만든 것 (AC-N4b-01~03·10~14·20~25)

- 확인서 JPG: `apps/server/src/jpeg.ts`(기본 JPEG 직접 구현 — SOF0, Y·Cb·Cr 3채널 4:4:4, 품질 90, JFIF APP0만, EXIF·주석 없음) + `receipt-jpg.ts`(공유 PNG와 같은 `layoutReceipt('image')`·`rasterizePage` 화소). 작업 워커 종류 `receiptJpg`·`receiptJpgZip`.
- 전원 이미지 ZIP: `zip.ts`(저장 방식 0, 일반 목적 비트 11 = UTF-8 이름, 폴더 없음, 수정 시각 = 확인서 만든 시각 KST). 이름 겹침은 순서상 뒤의 것에 `-2`·`-3`(대소문자 무시로 비교 — 윈도에서 겹치는 이름도 피한다).
- 공유 링크: 표 `receipt_links`·`receipt_link_requests`(마이그레이션 `0009_n4b_receipt_links.sql`), `receipt-links.ts`(만들기·전부 만들기·목록·끊기·열기), 공개 화면 `receipt-page.ts`(`/r`·`/r/*`).
- 복구·가져오기(D-I2-11)는 두 표를 `RESTORE_REPLACED_TABLES`로 지운다. 백업 파일에는 넣지 않는다(백업은 정해진 표만 읽는다 — 형식 번호 그대로).

### API (화면 dev-web에게)

모두 로그인한 판매자만(없으면 401), 보조자는 403 `ASSISTANT_FORBIDDEN`(roles.ts 기본 거부), 응답은 `Cache-Control: no-store`. 날짜 경로의 `?rehearsal=true`는 리허설 범위.

| 경로 | 답 |
|---|---|
| `GET /api/days/:date/receipt.jpg?buyer=<ID>` | 한 사람 JPG. 이름 `확인서-YYYY-MM-DD-<이름>.jpg`(리허설 `리허설-`). 오류는 PNG와 같다(품목 없음 422 `NO_ITEMS`) |
| `GET /api/days/:date/receipts.zip` | 전원 이미지 ZIP `확인서-YYYY-MM-DD-전원-이미지.zip`. 묶음 없음 422 `NO_ITEMS`(전원 PDF와 같은 문장), 바쁨 429 `BUSY` |
| `GET /api/days/:date/receipt-buyers` | `{ date, rehearsal, buyers: [{ buyer, name, phoneLast4, itemCount, total, payment, received, remaining, link }] }` — 품목 있는 묶음, 일괄 순서(D-I2-04). `name` = 확인서에 찍힌 이름, `payment` = `UNPAID`·`PARTIAL`·`PAID`·`OVERPAID`(화면 말은 정산 화면과 같게), `link` = 아래 링크 한 줄(리허설이면 `null`) |
| `GET /api/days/:date/receipt-links` | `{ date, rehearsal, links: [링크 줄] }` — 리허설이면 빈 목록 |
| `POST /api/days/:date/receipt-links` `{ requestId, buyer }` | `{ date, created, link }` — 쓸 수 있는 링크가 있으면 그것(`created: false`) |
| `POST /api/days/:date/receipt-links/all` `{ requestId }` | `{ date, created: <새로 만든 수>, links: [링크 줄] }` |
| `POST /api/days/:date/receipt-links/revoke` `{ requestId, buyer }` | `{ date, revoked, link }` — 쓸 수 있는 링크가 없으면 `revoked: false`(성공) |

- 링크 줄: `{ buyer, status, url, expiresAt, revokedAt }`. `status` = `NONE`(없음)·`ACTIVE`(있음 — `url` 있음)·`EXPIRED`(기간 지남)·`REVOKED`(끊김). 시각은 ISO(UTC) — 화면이 KST로 보인다(`11월 4일 (화) 20:31까지`).
- 오류: 리허설 범위의 만들기·전부 만들기·끊기 → 409 `REHEARSAL_RECEIPT_LINK` "리허설 방송은 공유 링크를 만들지 않아요." / 품목 없는 묶음·합쳐진 구매자·없는 구매자 → 409 `NO_ITEMS` "확인서를 만들 상품이 없어요." / 같은 요청 번호를 다른 일·다른 날짜에 → 409 `REQUEST_ERROR` / 다른 칸 400 `UNKNOWN_FIELD`, 구매자 없음·형식 틀림 400 `INVALID_INPUT`, 요청 번호 없음 400 `INVALID_REQUEST_ID` / 다른 판매자·없는 날짜 404.
- 같은 요청 번호 재전송은 처음 답을 그대로 돌려준다(새 기록 없음).
- 링크 상태는 실시간 알림을 보내지 않는다 — 화면을 열 때·조치한 뒤 다시 받는다(AC-N4b-32). 금액·입금 상태는 기존 범위 알림(stream의 scope 변경)을 받으면 `receipt-buyers`를 다시 받으면 된다.

### 구매자 링크 화면 `/r/<토큰>` (서버가 그린다)

- `GET|HEAD /r/<토큰>` 문서, `/r/<토큰>/receipt.jpg`(문서 안 그림, inline), `/r/<토큰>/image.jpg`(그림 저장, attachment), `/r/<토큰>/receipt.pdf`(PDF로 받기). 그 밖의 `/r…`는 404 같은 문서. 다른 메서드 405.
- 열 수 없음: 404 "이 링크는 열 수 없어요. 판매자에게 새 링크를 받아 주세요." / 1분 60번 넘음 429, 파일 작업 바쁨 503 "잠시 뒤 다시 열어 주세요.".
- 셈은 메모리(링크 토큰 해시마다 이동하는 1분 창) — 서버를 다시 켜면 처음부터다. 서버를 여럿 띄우면 서버마다 따로 센다.
- 문서 CSP: `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`(스크립트 없음).

### 남의 영역을 고친 것

- `apps/web/vite.config.ts`(dev-web 영역): 개발·미리 보기 서버의 프록시에 `^/r(/|$)`를 더했다 — E2E 묶음(Vite 미리 보기 + E2E 서버)에서 링크 주소 `<화면 주소>/r/<토큰>`이 서버 문서로 가야 한다(AC-N4b-25 "운영 서버·E2E 서버 둘 다"). `/receipts` 같은 화면 주소는 넘기지 않는다.

### dev-web이 할 것 (서버 몫 밖)

- 서비스 워커(`apps/web/pwa/service-worker.ts`)는 지금 `/api/`만 비켜 간다. 페이지 이동(`navigate`)을 네트워크 먼저 → 끊기면 저장한 `index.html`로 주므로, `/r`·`/r/`도 `/api/`처럼 가로채지 않게 해야 한다(AC-N4b-25).
