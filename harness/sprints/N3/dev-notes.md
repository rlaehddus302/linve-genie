# N3 dev-notes — 입금 확인 (계좌 연동)

## dev-server

### 한 일 (요약)
- 순수 함수 셋: `apps/server/src/deposit/name.ts`(DP-3 `normalizeDepositName`), `paste.ts`(DP-2 `readPaste`), `match.ts`(DP-5 `matchDeposits`·`evaluateDeposits`), 날짜 계산 `calendar.ts`(실행 환경 시간대·Intl 없음). 골든 단위 시험 `apps/server/test/deposit-golden.test.ts`가 파일 3·사례 45(name 10·paste 14·match 21)를 고정값으로 단언한다.
- 새 표 6개 + 마이그레이션 `apps/server/drizzle/0004_n3_deposits.sql` 하나: `deposit_sources`·`deposits`·`deposit_links`·`deposit_actions`·`deposit_names`·`deposit_requests`. 이벤트·발송함·스냅샷·출력 표는 그대로.
- 원천 어댑터 `deposit/popbill.ts`(팝빌 EasyFinBank 흐름·실제 전송 `popbillHttpTransport`), 가짜 팝빌 전송 `deposit/popbill-fake.ts`(`FakePopbillTransport` — 시험용, `@livejjim/server`에서 내보냄), 시험 모드 가짜 원천(서비스 안 메모리).
- 서비스 `deposit/service.ts`(`DepositService`), 경로 `deposit/api.ts`. 서버 조립 `server.ts`(`LivejjimServer.deposits`), 운영 조립 `production.ts`(시험 모드 끔, 연동 키가 있을 때만 실제 팝빌 전송), E2E 기동 `e2e.ts`·`commands/e2e-server.ts`.
- 골든 러너 시나리오 ID 형식 `G-ENG-<스프린트>-<두 자리>`(`packages/core/test/golden/contract.ts`), 자체 시험 `scenario-id.test.ts`, 합계 교체(아래 "교체한 기존 시험").

### dev-server > 화면(dev-web)에게 — 바뀐 계약

모든 경로는 기존 `/api` 규칙(세션·Origin·JSON·64KB·`Cache-Control: no-store`·다른 판매자 자원 404·모르는 항목 400 `UNKNOWN_FIELD`)을 따른다. 상태를 바꾸는 요청은 본문이 JSON 객체여야 한다(DELETE도 `{}`를 보낸다). 시각은 모두 UTC ISO(`…Z`) — 화면이 KST로 적는다(`10/18 21:03`, 정밀도 `second`면 `10/18 21:03:15`).

#### 입금 보기 (`DepositView`)
```
{ no, source: { id, kind: 'POPBILL'|'PASTE'|'FAKE', label }, at, precision: 'second'|'minute', amount, name,
  status: 'REVIEW'|'AUTO_APPLIED'|'APPLIED'|'IGNORED',
  applied: { date, buyer, buyerName, seq, auto } | null,      // 자동 확인됨·확인함일 때만. buyerName = 그 날짜 범위의 BUY-01 이름 표기(묶음의 지금의 구매자)
  receivedAt, handledAt | null,
  review?: { reason, twin: number|null, suggestions: BundleView[], preselect: { date, buyer } | null } }   // 확인 필요만 — 볼 때 다시 계산
```
- `reason` ∈ `POSSIBLE_DUPLICATE`·`SAME_NAME`·`MULTIPLE`·`NAME_MISMATCH`·`AMOUNT_MISMATCH`·`NO_MATCH`·`ONE_MATCH` → 화면 문장은 DEPOSIT_RULES DP-8 그대로(`POSSIBLE_DUPLICATE`는 `twin` 번호로 "같은 입금이 두 번 들어왔을 수 있어요 (입금 #7과 같아요)").
- 원천 낱말: `POPBILL` 계좌조회 · `PASTE` 붙여넣기 · `FAKE` 시험용 입금. 상태 낱말: 확인 필요 · 자동 확인됨 · 확인함 · 무시함. 영어 값은 화면에 내지 않는다.

`BundleView` (제안·묶음 찾기):
```
{ date, buyer, name, total, received, remaining, payment: 'UNPAID'|'PARTIAL'|'PAID'|'OVERPAID', refundDue,
  after: { payment, received, refundDue } | null,   // 이 입금을 확정하면 바뀔 입금 상태 (가정한 settlement.payment를 코어로 적용한 값)
  beforeSale: boolean,                              // true면 "입금 시각이 이 묶음의 판매보다 먼저예요."
  canRemember: boolean }                            // true면 확정 창에 "다음에도 이 입금자명이면 이 구매자로 볼게요"(기본 골라짐), false면 보이지 않음
```
- 바뀔 상태 문장 예: `payment` → `after.payment` ("미입금 → 입금 완료"), `after.payment === 'OVERPAID'`면 주의 색과 "환불 필요 {after.refundDue}원".

#### 경로

| 뜻 | 경로 | 요청 | 응답 |
|---|---|---|---|
| 입금 목록 | `GET /api/deposits?status=REVIEW&before=<번호>&limit=1~200` | status 기본 `REVIEW`, 쉼표로 여럿(예 `AUTO_APPLIED,APPLIED` — 자동 확인됨·확인함 목록), limit 기본 50 | `{ deposits: DepositView[], more, review }` (번호 내림차순, 다음 쪽은 `before=마지막 번호`) |
| 확인 필요 수 | `GET /api/deposits/count` | — | `{ review }` (메뉴 "입금 확인 3") |
| 입금 하나 | `GET /api/deposits/:no` | — | `{ deposit: DepositView + actions }` — `actions: [{ action: RECEIVED·AUTO·CONFIRM·IGNORE·REOPEN·REVERT, actor: { kind: 'account'\|'auto', loginId }, at, date, buyer, buyerName, seq }]` 시간 순. `auto`는 "입금 자동 확인" |
| 붙여넣기 미리 보기 | `POST /api/deposits/paste/preview` | `{ text }` | `{ rows: [{ line, at(KST +09:00), precision, amount, name, balance, state: NEW·EXISTING·OLD·FUTURE }], skipped: [{ line, why: 'NOT_DEPOSIT' }], unreadable: [{ line, why: BAD_AMOUNT·BAD_TIME }] }` — 아무것도 기록하지 않음 |
| 붙여넣기 넣기 | `POST /api/deposits/paste` | `{ requestId, text }` | `{ read, skipped, unreadable: [{ line, why }], new, existing, old, future, auto, review }` → "새 입금 {new}건 — 자동 확인 {auto}건, 확인 필요 {review}건 (이미 있던 입금 {existing}건)" |
| 확정 | `POST /api/deposits/:no/confirm` | `{ requestId, date, buyer, remaining, remember? }` (`remaining` = 화면이 본 남은 금액) | `{ deposit: { no, status: 'APPLIED', applied: { date, buyer, buyerName, seq, beforeSale } } }` — `beforeSale: true`면 판매 전 입금(막지 않음) |
| 무시 · 다시 확인 필요로 | `POST /api/deposits/:no/ignore` · `/reopen` | `{ requestId }` | `{ deposit: { no, status, applied: null } }` |
| 되돌리기 | `POST /api/deposits/:no/revert` | `{ requestId }` | `{ deposit: { no, status: 'REVIEW', applied: null }, refund: { date, seq } }` |
| 한꺼번에 | `POST /api/deposits/bulk` | `{ requestId, items: [{ no, action: 'confirm'\|'ignore', date?, buyer?, remaining?, remember? }] }` (1~100) | `{ results: [{ no, ok: true, deposit } \| { no, ok: false, status, error: { code, message } }] }` 항목 순서 |
| 묶음 찾기 | `GET /api/deposits/:no/bundles?q=<찾을 말>&date=<YYYY-MM-DD>` | q 40자까지(비면 전부), date 선택 — **date가 없으면 입금 날짜 60일 전 ~ 30일 뒤의 실제 범위만**(수정 라운드 1, RA-N3-003. 더 먼 날짜는 date로) | `{ bundles: BundleView[] }` 50개까지 — 남은 금액 있는 것 먼저 → 날짜 늦은 것 → 구매자 ID |
| 원천 목록 | `GET /api/deposits/sources` | — | `{ sources: SourceView[], popbill: boolean, testMode: boolean }` — `popbill: false`면 계좌조회 추가 대신 "계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요." |
| 원천 만들기 | `POST /api/deposits/sources` | `{ kind: 'POPBILL', label(1~20자), corpNum(숫자 10자리, '-' 허용), bank(팝빌 은행 코드 4자리), accountNumber(숫자 6~20자리, '-' 허용), intervalMin?(1~5) }` · 시험 모드만 `{ kind: 'FAKE', label? }` | `SourceView` — 사업자번호가 이 판매자의 것이 아니면 409 `CORP_NOT_ALLOWED`(수정 라운드 1, RA-N3-001) |
| 원천 고치기 | `PATCH /api/deposits/sources/:id` | `{ label?, intervalMin?(1~5), enabled? }` (붙여넣기 원천은 label만) | `SourceView` — 주기는 바로 적용 |
| 지금 받아 오기 | `POST /api/deposits/sources/:id/fetch` | `{}` | `{ source: SourceView }` (받아 오기가 끝난 뒤) |
| 계좌 관리 주소 | `POST /api/deposits/popbill/manage-url` | `{ corpNum }` 또는 `{ source }` | `{ url }` — 새 창으로 연다(서버는 저장하지 않음). 성공하면 그 사업자번호가 이 판매자에게 묶인다. 다른 판매자의 번호·이 판매자에게 묶인 것과 다른 번호면 409 `CORP_NOT_ALLOWED` |
| 기억한 입금자명 | `GET /api/deposits/names` | — | `{ names: [{ id, name, buyerName, createdAt }] }` (buyerName = 그 채널의 가장 최근 표시 이름, 없으면 "유튜브 끝 1234") |
| 기억한 입금자명 지우기 | `DELETE /api/deposits/names/:id` | `{}` | `{ ok: true }` |
| 시험용 입금 넣기 (시험 모드만) | `POST /api/deposits/test/rows` | `{ source: <FAKE 원천 ID>, rows: [{ key, at(오프셋 ISO, 예 2026-10-18T21:03:15+09:00), amount(1~1억 정수), name }] }` (1~1000줄) | `{ added }` — 그 원천의 다음 받아 오기(주기 또는 지금 받아 오기)에서 저장·맞추기 |

`SourceView`: `{ id, kind, label, enabled, intervalMin, bank: string|null, accountLast4: string|null, lastFetchedAt, lastError: string|null, lastErrorAt, lastNew: number|null, fetching, fetchable }` — 사업자번호·계좌번호 전체는 어디에도 나오지 않는다. `fetchable: false`(붙여넣기)면 "지금 받아 오기"·주기·켜기/끄기가 없다.

#### 오류 코드·문장 (화면은 `error.message`를 그대로 한 문장으로)
| 상태 | code | message |
|---|---|---|
| 409 | `BUNDLE_CHANGED` | 묶음 금액이 바뀌었어요. 다시 확인해 주세요. (→ 목록을 새로 받고, 새 제안을 보기 전엔 다시 보내지 않는다) |
| 409 | `DEPOSIT_APPLIED` | 이미 반영한 입금이에요. |
| 409 | `DEPOSIT_IGNORED` | 무시한 입금이에요. 다시 확인 필요로 옮긴 뒤 확정해 주세요. |
| 409 | `DEPOSIT_NOT_REVIEW` · `DEPOSIT_NOT_IGNORED` · `DEPOSIT_NOT_APPLIED` · `DEPOSIT_CHANGED` | 확인 필요인 입금만 무시할 수 있어요. · 무시한 입금만 다시 확인 필요로 옮길 수 있어요. · 반영한 입금만 되돌릴 수 있어요. · 입금 상태가 바뀌었어요. 다시 확인해 주세요. |
| 409 | `REFUND_RECORDED` | 이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요. |
| 409 (한꺼번에 항목) | `DUPLICATE_ITEM` | 같은 입금이 두 번 들어 있어요. |
| 400 | `PASTE_NO_HEADER` | 표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요. |
| 400 | `PASTE_TOO_MANY_ROWS` | 한 번에 2,000줄까지 넣을 수 있어요. 나눠서 넣어 주세요. |
| 413 | `PAYLOAD_TOO_LARGE` | 보낸 내용이 너무 커요. (본문 64KB — 은행 내역 한 줄이 길면 2,000줄보다 먼저 닿는다. 화면은 이 문장도 그대로 보인다) |
| 409 | `POPBILL_NOT_READY` | 계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요. |
| 429 | `FETCH_TOO_SOON` | 방금 받아 왔어요. 잠시 뒤에 다시 눌러 주세요. |
| 409 | `SOURCE_DISABLED` | 꺼진 원천이에요. 켠 뒤 받아 와 주세요. |
| 400 | `SOURCE_NO_FETCH` | 붙여넣기는 받아 오기가 없어요. |
| 503 | `SOURCE_FAILED` | (계좌 관리 주소를 못 받았을 때 — 원천 오류 문장) |
| 409 | `CORP_NOT_ALLOWED` | 이 사업자번호는 이 계정에서 쓸 수 없어요. 사업자번호를 확인해 주세요. (다른 계정에 묶인 번호 — 다른 계정이 쓴다는 것은 밝히지 않는다) · 이 계정에 연결한 사업자번호와 달라요. 사업자번호를 확인해 주세요. (이 계정에 묶인 번호와 다름) |

원천 오류 문장(`lastError`): "팝빌 연결을 확인해 주세요." · "팝빌 계좌조회 권한을 확인해 주세요." · "팝빌에 등록되지 않은 계좌예요. 팝빌 계좌 관리에서 등록해 주세요." · "팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요." · "은행에서 내역을 받아 오는 데 시간이 오래 걸려요. 잠시 뒤에 다시 받아 올게요." · "은행에서 내역을 받아 오지 못했어요. 잠시 뒤에 다시 받아 올게요." · "팝빌에서 받은 내역을 읽지 못했어요. 잠시 뒤에 다시 받아 올게요." · "읽지 못한 내역이 있어요" · "받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요." · (수정 라운드 1) "이 사업자번호는 이 계정에서 쓸 수 없어요. 사업자번호를 확인해 주세요." · "이 계정에 연결한 사업자번호와 달라요. 사업자번호를 확인해 주세요."

#### 실시간 (`GET /api/stream`)
- 새 이벤트 종류 `event: deposit`, `data: { deposits: number[], review: number, sources: string[] }` — 입금이 저장·처리되었거나(바뀐 입금 번호), 확인 필요 수가 바뀌었거나, 원천 상태가 바뀌었을 때(새 입금·오류 문장 변화·판매자가 누른 받아 오기). 입금자명은 담지 않는다. 주기 받아 오기에서 아무것도 바뀌지 않으면 알리지 않는다.
- 엔진에 적은 입금·환불은 기존 `change` 알림(범위 seq)으로 온다 — 정산 화면은 지금처럼 증분 조회.

#### 정산 조회의 입금 연결 (AC-N3-32)
- `GET /api/days/:date` 응답에 늘 `depositLinks: DepositLinkView[]`(그 범위 전체)가 붙는다. `GET /api/days/:date/changes`는 정산 묶음이 바뀐 증분(`settlements`나 `removed.settlements`가 비지 않음)에만 `depositLinks`(그 범위 전체 — 증분이 아니다)를 담는다 — 없으면 화면은 이전 값을 그대로 둔다(입금 확인의 기록·되돌림은 늘 정산 기록을 바꾼다. 매 증분마다 질의하지 않으려고). 리허설 범위는 늘 `[]`.
- `DepositLinkView = { seq, kind: 'payment'|'refund', auto, reverted, deposit: { no, name, at, precision, amount, source(원천 표시 이름), sourceKind } }` — 정산 기록(`settlements[].records[]`)의 `seq`와 같은 것에 붙인다. 메모 글을 읽지 않는다(손으로 같은 메모를 적은 입금에는 없다).
- 표시: `kind: 'payment'` → `auto`면 "자동 입금 확인 · {name} · {at KST}", 아니면 "입금 내역으로 확인 · …". `kind: 'refund'` → "입금 확인 되돌림 · 입금 #{no}". `payment`이고 `reverted: false`면 "입금 확인 되돌리기" — `POST /api/deposits/{no}/revert`.

#### 범위 이력의 "누가"
- 자동 확인이 적은 입금 이벤트의 이력 `actor.kind`는 새 값 `deposit` → 화면 낱말 "입금 자동 확인"(`apps/web/src/lib/words.ts` `actorWord`에 더해야 한다 — 지금은 '서버'로 보인다). 확정·되돌리기는 판매자 계정(`account`).

#### 요청 번호
- 화면 요청(붙여넣기 넣기·확정·무시·다시·되돌리기·한꺼번에)은 `requestId`로 한 번만 처리하고 재전송은 처음 결과다. 거절(4xx)은 기록하지 않으므로 같은 번호로 다시 보내면 다시 판단한다 — `BUNDLE_CHANGED` 뒤에는 새 요청 번호로.
- `/api/events` 등 엔진 쓰기 경로는 `dep-`로 시작하는 요청 번호를 받지 않는다(400 `INVALID_REQUEST_ID`). 화면의 `crypto.randomUUID()`와는 겹치지 않는다.

### 테스트용 기동 (test-e2e·test-domain에게)
- E2E 서버: `pnpm --filter @livejjim/server e2e --port <포트> --origin <화면 주소> [--test-deposits yes|no] [--deposit-poll-ms 100~300000] [--deposit-refetch-ms 0~60000]`.
  - 기본: 시험용 입금 **켬**, 받아 오기 주기 **1초**, "지금 받아 오기" 간격 60초(운영 값 — 429 시험용). 팝빌 연동 키는 없다 → `GET /api/deposits/sources`의 `popbill: false`, 계좌조회 만들기는 409 준비 중 문장.
  - 가짜 원천: `POST /api/deposits/sources { kind: 'FAKE', label? }`(기본 표시 이름 "시험용 입금") → `POST /api/deposits/test/rows`로 줄을 넣으면 다음 주기(1초)나 지금 받아 오기에서 계좌조회와 같은 저장·맞추기 흐름. 넣은 줄은 그 원천이 받아 갈 때마다 다시 보이므로(은행처럼) 같은 `key`는 한 번만 저장된다.
  - 이 트랙은 `E2E_PORT_OFFSET=1200`. Playwright 설정(`apps/web/playwright.config.ts`)은 dev-web·tester 몫이라 손대지 않았다.
- 서버 시험·적대 시험(PGlite): `createServer({ ..., deposits: { testMode: true, popbill: new FakePopbillTransport(), timer, waitTimer, popbillPollMs, callTimeoutMs, refetchGapMs, pollMs, hooks: { beforeAuto } } })`. `FakePopbillTransport`(`register(account)`, `addRows(account, rows)`, `fail(method, kind|'HANG')`, `pollsBeforeDone`, `onPoll`, `jobFails`, `loopPages`, `pageSize`, `calls`). 손으로 돌리는 주기 타이머는 `timer`, 받아 오기 안의 대기·시간 제한은 `waitTimer`(기본 실제 타이머 — 응답하지 않는 원천은 30초 뒤 끊는다). `server.deposits.ingest(seller, sourceId, rows)`·`server.deposits.runSource(seller, sourceId)`로 받아 오기 없이 흐름을 부를 수 있다. 시험 도우미는 `apps/server/test/deposit-support.ts`.
- 운영 기동: `productionServerOptions`가 `deposits: { testMode: false, popbill: 연동 키 ? popbillHttpTransport : null }`를 만든다. 환경 변수 `POPBILL_LINK_ID`·`POPBILL_SECRET_KEY`(둘 다 있어야), 선택 `POPBILL_TEST_BED=true`(`.env.example`).

### 판단한 것 (스펙이 정하지 않은 세부 — 판매자 안전 쪽으로)
1. 붙여넣기 2,000줄 상한은 **빈 줄을 세지 않은** 머리글 아래 줄 수다(DP-2 4 "모든 칸이 빈 줄은 건너뛰고 세지 않는다"와 같은 셈 — 끝 줄바꿈 하나로 2,001이 되지 않게).
2. CSV 칸은 칸 첫 글자(앞 공백 뒤)가 `"`일 때만 따옴표 칸으로 본다. 짝이 안 맞는 따옴표는 줄 끝까지 한 칸(예외를 던지지 않는다).
3. 입금액 칸 값이 금액 모양이고 0이면(`-0`·`+0` 포함) `NOT_DEPOSIT`이 먼저다(DP-2 4.1 첫 문장 순서).
4. 붙여넣기 줄 키는 `sha256([거래 시각, 금액, 정규화 이름, 잔액], 몇 번째)`로 둔다 — 키에 이름이 그대로 남지 않게(DP-0 3의 취지).
5. 자동 확인의 마지막 확인은 "묶음의 지금의 구매자의 그 날짜 묶음에 품목이 있고 남은 금액 = 입금 금액"이다(그 사이 합치기로 지금의 구매자가 바뀌었으면 합친 결과로 다시 본다). 마지막 확인에 걸리면 그 입금은 확인 필요로 두고, 같은 받기의 뒤 입금은 지금 상태로 다시 맞춘다.
6. 엔진 기록·입금 상태·연결·처리 기록·요청 번호는 기록 경로의 같은 트랜잭션(afterInsert)이다 — "엔진 기록과 입금 상태 저장 사이에 멈춤"이 생기지 않고, 응답 전에 멈춘 경우(afterCommit 실패) 같은 요청 번호의 재전송은 처음 결과다.
7. "지금 받아 오기" 1분 제한은 판매자가 누른 것끼리만 센다(주기 받아 오기와는 따로 — 같은 원천의 받아 오기는 겹치지 않고 하나로 합쳐진다).
8. 사업자번호 10자리, 은행은 팝빌 은행 코드 4자리, 계좌번호 숫자 6~20자리('-'·공백은 빼고 받는다). 암호화의 추가 인증 데이터는 판매자 ID와 원천 ID(다른 판매자·다른 원천 행으로 옮기면 풀리지 않는다).
9. 묶음 찾기 말은 대소문자를 가리지 않는 부분 포함이다: 묶음 이름 표기, 구성원(합친 구매자 포함)의 표시 이름·이름 이력(문자찜 메모 포함), 전화번호 뒤 4자리, 유튜브 채널 ID 끝 4자리. 말이 비면 고른 날짜(날짜를 고르지 않으면 입금 날짜 60일 전 ~ 30일 뒤 — 수정 라운드 1)의 묶음 전부.
10. 실제 팝빌 전송(`popbillHttpTransport`)은 링크허브 인증(v2.0 서명)·EasyFinBank REST로 만들었지만 **실계약으로 확인하지 않았다**(D-N3-09 사용자 확인). 오류는 HTTP 401 → 인증, 403 → 권한, 그 밖 → 응답 형식 오류로만 나눈다. 시험은 가짜 전송으로만 한다.
11. 원천 상태 알림은 새 입금·오류 문장 변화·판매자가 누른 받아 오기일 때만 보낸다(1초 주기의 E2E에서 알림이 넘치지 않게). "마지막으로 받아 온 때"는 원천 목록을 다시 받을 때 최신이 된다.

### 교체한 기존 시험 (약화 아님)
- `packages/core/test/golden/core-adapter.test.ts`: 실제 골든 합계 "파일 26 · 파서 460 · 엔진 129 · 통과 589" → "파일 27 · 파서 460 · 엔진 131 · 통과 591" (G-ENG-N3-01·02가 늘어서, AC-N3-04).
- `packages/core/test/golden/validate.ts`: 시나리오 ID 형식 오류 문장의 괄호 안내에 `G-ENG-<스프린트>-두 자리`를 더함(읽기 오류 판정은 `contract.ts` `SCENARIO_ID_RE`).
- `apps/server/test/api.test.ts`: 범위 조회 응답 기대값에 `depositLinks: []`를 더함(AC-N3-32 계약 변경).
- `apps/server/test/commands.test.ts`: 마이그레이션 뒤 표 수 15 → 21(입금 표 6개) → (수정 라운드 1) 22(사업자번호 묶음 표, RA-N3-001).
- (수정 라운드 1) `apps/web/test/deposits-page.test.tsx`: "다른 묶음 지정"의 날짜 고르기 빈 값 낱말 '모든 날짜' → '입금 날짜 앞뒤 (60일 전 ~ 30일 뒤)'(서버가 날짜 없는 찾기를 그 범위로 묶어서 — RA-N3-003. 낱말이 틀린 약속을 하지 않게).

### 검증 게이트 변경 요청
- 없음.

### 남의 영역을 고친 것
- 없음. (`packages/core/test/golden/**`는 AC-N3-04가 dev-server에게 맡긴 러너 ID 형식·자체 시험 합계만.)
- (수정 라운드 1) dev-web 영역 `apps/web/src/components/DepositReview.tsx` 한 줄: "다른 묶음 지정" 날짜 고르기의 빈 값 낱말 '모든 날짜' → '입금 날짜 앞뒤 (60일 전 ~ 30일 뒤)'와 그 단위 시험 기대값. 서버가 날짜 없는 찾기를 그 범위로 묶었기 때문이다(RA-N3-003). 화면 흐름·선택자는 그대로다.

### 수정 라운드 1 (dev-server)
- **TD-N3-001 · SA-N3-01 입금자명의 NUL** — 세 입구(팝빌 줄 옮기기 `mapPopbillRow`, 붙여넣기 읽기 `readPaste`, 시험용 줄 `testRow`)가 함께 쓰는 `cleanDepositName`(paste.ts) 하나로 다듬는다: **U+0000만 빼고** 앞뒤 공백을 뺀 뒤 40자. 판단: PostgreSQL text는 U+0000을 담을 수 없어 DP-1 "받은 글자 그대로"를 지킬 수 없는 글자는 그것뿐이다. 그 줄을 읽지 못한 줄로 돌리면 정상 입금 하나를 확인 필요에서도 못 보게 되므로(판매자가 놓침) 글자만 빼고 저장한다 — 빈 이름이 되면(NUL만) 빈 이름 규칙(DP-5 자동 확인 안 함)대로다. 다른 제어 문자·이모지는 받은 그대로(저장·표시 모두 문제없다). 다듬기가 입구에 있으므로 미리 보기·줄 키·저장·맞추기가 같은 이름을 본다(미리 보기 "새 입금" = 넣기 결과, 다시 넣으면 "이미 있는 입금"). 시험: `deposit-sources.test.ts` TD-N3-001 넷, 적대 `server-n3.test.ts` TD-N3-001 둘 통과.
- **RA-N3-002 붙여넣기 일시 칸 되추적** — `DATE_TIME_RE`를 `splitDateTime`(첫 공백 덩어리 / 둘째 글자부터 첫 `T`로 한 번 훑기)으로 바꿨다. 예전 정규식과 결과가 같음을 무작위 3,000회로 대조(`deposit-paste.test.ts`). 6만 자 칸: 예전 2만 자에 1.2초 → 지금 수 ms(`deposit-paste.perf.test.ts`, pnpm perf). 금액·날짜·시각 정규식과 칸 나누기도 6만 자 칸 16가지로 재 보아 모두 선형이었다(칸 길이 상한은 DP-2에 없어서 두지 않았다).
- **RA-N3-003 입금 화면 조회가 읽는 범위**
  - 확인 필요 목록·자동 확인의 맞추기 재료(`#context`)는 입금 날짜 dd마다 [dd − 30일, dd] 창의 **합집합**만 읽는다(DP-4 E(d) 그대로 — 가장 이른 입금 −30일 ~ 가장 늦은 입금 사이 전부가 아니다). 쌍둥이 후보도 입금 날짜들만 질의한다.
  - 다시 계산은 `evaluateEach`(match.ts)로 묶음 이름 정규화를 한 번만 한다(입금마다 `evaluateDeposits`를 부른 것과 같은 결과 — 무작위 500회 대조).
  - 날짜를 고르지 않은 묶음 찾기는 **입금 날짜 60일 전 ~ 30일 뒤**의 실제 범위만, 늦은 날짜부터, 남은 금액이 있는 묶음이 50개면 멈춘다(그보다 이른 날짜는 순서상 50개 안에 들 수 없다). 판단: AC-N3-33은 날짜를 "선택"으로 두었고 AC-N3-24 "30일 밖 날짜도"는 확정할 수 있는 묶음의 범위다 — 더 먼 날짜는 날짜 고르기(모든 실제 범위 날짜가 목록에 있다)로 찾고 확정할 수 있다. 입금은 받는 날 30일 안의 거래만 저장되므로 E(d)는 늘 이 범위 안이다. 화면 낱말도 그 범위로 바꿨다(위 "남의 영역").
  - 지난 날짜를 훑는 조회(묶음 찾기·기억한 이름 표시)는 새 `ScopeWriter.peek` — 메모리에 있으면 그것을 따라잡아 쓰고, 없으면 DB에서 불러오되 **메모리에 두지 않는다**(방송 중인 범위 상태를 상한 128 밖으로 밀어내지 않게). 확인 필요 목록은 1초마다 다시 받으므로 그대로 `read`(캐시)다 — 창이 좁아져 읽는 범위가 그 판매자가 지금 보는 날짜들이다.
  - 기억한 입금자명의 구매자 표시 이름은 최근 60일을 늦은 날짜부터 보고, 거기 없는 채널은 그 채널에 입금 확인으로 적은 가장 늦은 날짜 하나를 본다(AC-N3-25 "그 채널의 가장 최근 표시 이름" — 전 기간을 거꾸로 읽지 않는다).
  - 시험: `deposit-reads.test.ts`(읽은 날짜를 센다 — 걸린 시간은 재지 않는다), `runtime-cache.test.ts` peek.
- **RA-N3-001 팝빌 사업자번호를 판매자에게 묶는다**
  - 새 표 `deposit_corp_bindings`(판매자 ID 기본 키, `corp_key` 유일) — 판매자마다 사업자번호 하나, 사업자번호마다 판매자 하나. `corp_key` = HMAC(마스터 키에서 나눈 키, 사업자번호)라 DB에서 되돌릴 수 없고 평문은 없다. 마이그레이션은 아직 합치지 않은 N3의 0004에 더했다(병렬 트랙과 번호가 겹치지 않게).
  - 묶는 때: 팝빌이 그 번호로 **처음 답한 때**(받아 오기 성공 또는 계좌 관리 주소 성공). 원천을 만들 때는 묶지 않는다 — 잘못 적은 번호(팝빌이 모르는 번호)가 묶여 판매자가 고칠 수 없게 되지 않게.
  - 막는 곳(모두 팝빌을 부르기 전): 원천 만들기·계좌 관리 주소는 409 `CORP_NOT_ALLOWED`, 받아 오기는 원천 오류 문장. 원천을 만든 뒤 다른 판매자가 먼저 묶었으면 그 원천의 받아 오기는 팝빌을 부르지 않는다. 묶기가 경합에서 지면(같은 순간 다른 판매자가 묶음) 주소를 주지 않고 받은 줄을 버린다(저장하지 않는다).
  - 운영자 명령 `pnpm --filter @livejjim/server popbill-corp --login 아이디 --corp 사업자번호`(미리 묶기)·`--login 아이디 --clear yes`(풀기). 출력에 사업자번호·키가 없다.
  - 남은 틈(사용자 확인 필요): 아무에게도 묶이지 않은 번호는 처음 쓴 판매자에게 묶인다. 팝빌 연동회원은 운영자가 등록하므로(실계약은 사용자 몫, D-N3-09) **연동회원을 등록할 때 이 명령으로 그 판매자에게 미리 묶으면** 그 틈이 없다. 사업자등록증 확인 같은 소유 확인은 서비스가 하지 않는다.
  - 팝빌 토큰 보관(`popbillHttpTransport`)은 256개 상한 — 만료된 것을 치우고, 넘으면 가장 오래 둔 것부터 버린다.
  - 시험: `deposit-sources.test.ts` RA-N3-001 넷, `deposit-popbill.test.ts` 토큰 상한, `commands.test.ts` 명령.
- **dev-web에게**: 계좌 연동 폼·계좌 관리 버튼은 409 `CORP_NOT_ALLOWED`의 `error.message`를 지금처럼 그대로 보이면 된다(문장 하나). 화면 변경은 날짜 고르기 낱말 하나뿐이다.
- **test-domain·test-e2e에게**: 같은 세계에서 두 판매자가 같은 사업자번호로 계좌조회를 만들면 이제 두 번째는 409다(처음 판매자가 받아 오기에 성공한 뒤). E2E 기동에는 팝빌 키가 없어 영향이 없다. `server.writer.peek(seller, date)`은 메모리를 밀어내지 않는 읽기다.

## dev-web

### 한 일 (요약)
- 새 화면 `/deposits` "입금 확인"(`apps/web/src/components/DepositsPage.tsx`) — 목록 다섯(확인 필요 · 자동 확인됨·확인함 · 무시함 · 붙여넣기 · 계좌 연동). 조각: `DepositReview.tsx`(확인 필요·확정 창·다른 묶음 지정·한꺼번에), `DepositPaste.tsx`, `DepositSources.tsx`(원천·계좌 연결·기억한 입금자명), `deposit-parts.tsx`(목록 받기·PC 표/휴대폰 카드·처리 보내기·자세히·되돌리기 창).
- 메뉴 "입금 확인"(정산 다음, 라벨 앞) — 확인 필요가 있으면 "입금 확인 3"(수는 글자, 둥근 바탕은 덧붙인 표시). 확인 필요 수는 앱 전체 신호 `lib/deposit-store.ts`(`DepositProvider` — 출력 기록이 연 페이지 실시간 연결을 함께 쓴다): 처음·다시 붙을 때(ready) `GET /api/deposits/count`, 그 사이엔 `deposit` 알림의 `review`.
- 정산 자세히(`SettlementsPage.tsx`): 범위 자료에 `depositLinks`(seq → 연결, `lib/scope-data.ts` — 증분에 없으면 그대로)를 들고, 연결된 기록은 메모·사유 대신 "자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 #12"(판매자 확정은 "입금 내역으로 확인 · …", 되돌린 것은 끝에 " · 되돌림"), 되돌림 환불은 "입금 확인 되돌림 · 입금 #12". 되돌리지 않은 연결 입금에 "입금 확인 되돌리기"(입금 확인 화면과 같은 확인 창 → `POST /api/deposits/{no}/revert` → 응답 refund.seq까지 따라잡기). 리허설 범위는 "리허설 묶음은 입금 확인에 쓰지 않아요."이고 연결·되돌리기를 그리지 않는다.
- 범위 이력의 `actor.kind: 'deposit'` → "입금 자동 확인"(`lib/words.ts` `actorWord`). 실시간 알림 종류에 `deposit`(`lib/stream.ts`). `api/client.ts`에 `del`(본문 `{}`).
- CSV 파일은 `lib/csv-text.ts`가 UTF-8(fatal)로 읽어 보고 아니면 EUC-KR로 읽어 글 칸에 넣고 바로 "읽어 보기"를 한다.

### 화면(테스트)에게 — 선택자 (test-e2e)
- 메뉴: `navigation "메뉴"`의 링크 `입금 확인 3`(없으면 `입금 확인`), 주소 `/deposits`. 목록은 검색값 `tab`: `/deposits?tab=done|ignored|paste|sources`(확인 필요는 적지 않음). 입금자명·금액은 주소에 없다.
- 목록 고르기: `tablist "입금 확인 목록"`의 `tab` — `확인 필요 3`(수가 있으면 붙음)·`자동 확인됨·확인함`·`무시함`·`붙여넣기`·`계좌 연동`(`aria-selected`).
- 입금 목록: PC(48rem 이상) `table "확인 필요 입금"`/`"자동 확인됨·확인함 입금"`/`"무시한 입금"`의 `row "입금 #12"`, 휴대폰은 같은 이름의 `list`의 `listitem "입금 #12"`. 칸: 입금 시각 · 입금자명 · 금액 · 원천(+ 반영한 묶음 · 상태).
- 확인 필요 줄 안: `checkbox "입금 #12 고르기"`, `radiogroup "입금 #12 묶음"`의 `radio`(글: `다육이맘 · 2026년 10월 18일 묶음 · 남은 금액 14,000원 · 미입금 → 입금 완료`), `group "입금 #12 처리"`의 버튼 `확정`(고른 묶음이 없으면 잠김)·`다른 묶음 지정`·`무시`(바로 보냄)·`자세히`. 위에 `checkbox "모두 고르기"`, 고르면 `group "선택한 입금"`의 `선택한 입금 확정 (N건)`(주 버튼 — 묶음을 고르지 않은 줄이 있으면 잠기고 그 번호를 알림)·`선택한 입금 무시 (N건)`.
- 창(`dialog`, 제목이 이름): `입금 확정`(버튼 `확정`, 줄 목록 `list "확정할 입금"`, 기억 고르기 `checkbox "다음에도 이 입금자명이면 이 구매자로 볼게요"`), `선택한 입금 확정 (N건)`(버튼 `N건 확정`), `선택한 입금 무시 (N건)`(버튼 `N건 무시`), `다른 묶음 지정 · 입금 #12`(칸 `찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)`, `날짜` 고르기 "입금 날짜 앞뒤 (60일 전 ~ 30일 뒤)"(수정 라운드 1, 전에는 "모든 날짜")/"2026년 10월 18일(일)", 결과 `list "찾은 묶음"`의 버튼 — 누르면 바로 확정 창), `입금 확인 되돌리기`(버튼 `되돌리기`), `입금 #12`(자세히 — `region "처리 기록"`).
- 처리 결과 안내: 목록 위 `status`(성공 초록·주의 노랑, `안내 닫기`). 예: `입금 #5: 다육이맘 · 2026년 10월 18일(일) 묶음에 적었어요.`, BUNDLE_CHANGED는 서버 문장 그대로.
- 붙여넣기: 글 칸 `입금 내역`, 파일 `CSV 파일 고르기`(`setInputFiles` — 고르면 글 칸을 채우고 바로 읽어 본다), 버튼 `읽어 보기`·`입금 내역 넣기`(주 버튼 — 읽어 본 글과 지금 글이 같을 때만), `region "읽어 본 결과"`(`list "읽지 못한 줄"`: `6번째 줄: 금액을 읽지 못했어요`, `table`/`list "읽은 입금"`), 결과 `status`: `새 입금 5건 — 자동 확인 3건, 확인 필요 2건 (이미 있던 입금 1건)`. 넣은 뒤 글 칸은 빈다.
- 계좌 연동: `list "원천"`의 `listitem "원천 {표시 이름}"` — 버튼 `지금 받아 오기`·`끄기`/`켜기`, 고르기 `받아 오는 주기`(1~5분마다), 계좌조회만 `팝빌에서 계좌 등록·관리`. 연동 키 없는 서버: `계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.` 시험 모드만 버튼 `시험용 입금 원천 추가`. 연동 키가 있으면 칸 `표시 이름`·`사업자번호`·`은행`·`계좌번호`(번호 칸 `inputmode=numeric`) + 버튼 `계좌 연결`. `list "기억한 입금자명"`의 `listitem "김영희 → 다육이맘"` + `지우기` → 창 `기억한 입금자명 지우기`의 `지우기`.
- 정산 자세히: `region "정산 기록"`의 줄 글(위 "한 일"), 버튼 `입금 확인 되돌리기`.
- 실시간: 다른 기기의 처리 → `deposit` 알림 → 메뉴·탭 수는 바로, 목록은 150ms 뒤 다시 받는다(확인한 시간 약 250ms, 수동 확인). 판매 기록(`change`, 실제 범위)은 1초 뒤 확인 필요를 다시 받는다.
- E2E 시험 자료 주의(확인 필요): 실제 범위에 **유튜브 구매자**를 만드는 화면 API 경로가 E2E에 없어 보인다(`/rehearsal/chat`은 리허설만). 기억한 입금자명(유튜브 구매자만, D-N3-03) 흐름을 E2E로 돌리려면 test-e2e가 길을 정해야 한다 — 화면은 서버의 `canRemember`대로 보인다.

### 판단한 것 (스펙이 정하지 않은 세부 — 판매자 안전 쪽으로)
1. 확인 필요의 "무시"(한 건)는 확인 창 없이 바로 보낸다 — 엔진에 아무것도 적지 않고 "무시함"에서 되돌릴 수 있다. 한꺼번에 무시는 실수로 여럿을 옮기지 않게 확인 창을 거친다.
2. 한꺼번에 확정은 고른 줄이 모두 묶음을 골랐을 때만 누를 수 있다(묶음 없는 줄을 조용히 빼지 않는다 — 그 번호를 알린다).
3. BUNDLE_CHANGED(한 건)면 창을 닫고 서버 문장을 안내로 보이며 목록을 새로 받고, 그 입금의 고른 묶음을 지워 새 제안(미리 고른 묶음)으로 돌아간다 — 같은 값으로 다시 보낼 수 없다. 한꺼번에서 그 거절이 난 항목도 같다.
4. "다른 묶음 지정"에서 묶음을 누르면 바로 확정 창으로 간다(줄에 고른 상태로 남기지 않는다 — 찾은 묶음의 남은 금액이 낡지 않게).
5. 붙여넣기는 "읽어 보기"로 본 글과 지금 글이 같을 때만 넣을 수 있다(본 것과 다른 글을 넣지 않게). 읽은 입금이 하나도 없으면 넣기를 잠근다.
6. 정산 기록의 입금 연결 글은 스펙 예(`자동 입금 확인 · 김영희 · 10/18 21:03`) 뒤에 ` · 입금 #12`와(되돌렸으면) ` · 되돌림`을 덧붙인다 — 입금 기록과 되돌림 환불을 판매자가 짝지을 수 있게. 앞부분은 스펙 글 그대로라 글 포함 검사는 맞다.
7. 휴대폰 아래 메뉴는 여섯 개가 되어 글자를 16px(기본 글자 16px 이상 그대로)로 줄였다 — 375px에 한 줄(측정: 가로 밀림 없음). 처음엔 누르는 곳 폭을 재지 않아 두 글자 항목이 41px이 되었다(TE-N3-001) — 아래 "수정 라운드 1 (dev-web)"에서 칸 바닥 폭 44px으로 고쳤다.
8. 은행 고르기 목록(`lib/deposit-words.ts` `BANKS`)은 팝빌 은행 코드로 흔한 은행만 넣었다 — **실계약에서 팝빌 지원 은행·코드를 확인해야 한다**(D-N3-09 사용자 확인과 함께). 목록에 없는 코드는 "은행 코드 0000"으로 보인다.
9. "팝빌에서 계좌 등록·관리"는 누를 때 빈 창을 먼저 열고(응답을 기다린 뒤 열면 브라우저가 막는다) 서버가 준 https 주소로 옮긴다(opener 끊음). 실제 팝빌 주소로는 확인하지 않았다.
10. 리허설 정산의 "리허설 묶음은 입금 확인에 쓰지 않아요."는 리허설 띠("리허설 — 실제 정산이 아니에요") 옆에 같은 줄로 둔다(휴대폰은 줄을 바꿈) — 따로 한 줄을 더하면 1440×900 PC 표가 밀려 스크롤 없이 보이는 줄이 8 → 7이 되어 AC-S06b-21 E2E가 실패했다.
11. 확인 필요 목록은 입금 알림(`deposit`) 뒤 150ms, 실제 범위의 판매 기록(`change`) 뒤 1초에 한 번 다시 받는다(기다리는 동안 온 알림은 합치고 기다림을 늘리지 않는다) — 방송 중 채팅마다 서버가 맞추기를 다시 계산하지 않게.
12. 원천의 "마지막으로 받아 온 때"는 원천 알림(새 입금·오류 변화·판매자가 누른 받아 오기) 때 원천 목록을 다시 받아 최신이 된다(서버가 주기마다 알리지 않으므로 — dev-server 판단 11).

### 교체한 기존 시험 (약화 아님)
- `apps/web/test/pwa.test.tsx` 메뉴 시험: 메뉴 낱말 `['방송','문자찜 입력','구매자','정산','라벨']` → `[…,'정산','입금 확인','라벨']`, aria-current 목록 칸 하나 더, 라벨 링크 자리 4 → 5, `/deposits` 링크 확인 추가(AC-N3-40 메뉴 추가).

### 검증 게이트 변경 요청
- 없음.

### 남의 영역을 고친 것
- 없음.

### 수정 라운드 1 (dev-web)
- **TE-N3-001 · SA-N3-02 휴대폰 메뉴 두 글자 항목 41px** (`styles.css` 휴대폰 `.menu`·`.menu-link`)
  - 아래 막대를 flex(글자 폭만큼, 바닥 없음)에서 한 줄 격자로 바꿨다: `grid-auto-flow: column; grid-auto-columns: minmax(min(2.75rem, 100% / 6), auto)`. 칸마다 먼저 44px(누르는 곳, UX-04)을 주고, 남는 폭은 한 줄이 될 때까지 긴 항목("문자찜 입력"·"입금 확인 3")에, 그다음은 고르게 나눈다. 바닥 폭은 막대 폭의 1/6을 넘지 않아 어떤 폭에서도 가로로 넘치지 않는다(링크에 `min-width` 고정 폭을 두면 AC-S00-50 스타일 검사 "375px에서 고정 폭 없음"과 부딪혀 격자 칸 최소로 둔다).
  - 휴대폰에는 마우스 올림이 없어 링크의 투명 테두리(2px)를 뺐다(`border-width: 0`) — 그 폭(칸마다 4px)을 글자에 준다. 지금 화면 표시는 파란 바탕·흰 글자 그대로, 키보드 포커스는 전역 `:focus-visible` 윤곽선 그대로.
  - 링크 안에서는 낱말 가운데서 끊지 않는다(`overflow-wrap: normal` — 본문의 `anywhere`를 끔): 좁으면 띄어쓰기에서만 두 줄("문자찜/입력"), "문자/찜"처럼 갈라지지 않는다.
  - 측정(크로미움, 글자 16px 굵게): 375px — 수 없음·"3"·"12"·"123"·"1234" 모두 한 줄(막대 53px, 보내기 막대 자리 3.3125rem 그대로), 가장 좁은 칸 44.7~53.6px. 360px — 수 두 자리까지 한 줄(45.6px 이상). 320px — 수가 없으면 한 줄(44.5px), 수가 있으면 "문자찜 입력"·"입금 확인 N"이 두 줄(막대 68px, 칸은 모두 44px 이상). 남은 한계: 360px에서 확인 필요 100건 이상, 320px에서 확인 필요가 있을 때는 막대가 두 줄 높이가 되어 문자찜 입력 화면의 보내기 막대 아래 15px쯤을 덮는다(누를 수는 있다).
  - 확인: `n3/screens` TE-N3-001, `s05/keyboard-words` AC-S05-72·73, `s06/devices` AC-S06-02·40, `i1/screens` AC-I1-20 통과(n3 시험 뒤에 돌아 메뉴에 "입금 확인 N"이 붙은 상태 포함).
- **SA-N3-04 I4 판매 이력 사전 AC-I4-40** (`voice/controller.ts`)
  - 원인: 시험 기록(trace)으로 보면 "음성 켜기" 뒤 지난 범위 조회 10번이 **보내진** 순간(expect.poll 첫 확인) 1.8ms 뒤에 "21번 펭귄얼음 만원"이 들어왔고, 조회 응답은 서버가 차례로 처리해 마지막 것이 약 29ms 뒤에 왔다. 이력이 오기 전 문장은 지금 범위 + 기본 사전으로 카드가 되어 "품종 미입력"이었다. 날짜 계산·사전 규칙·조회 날짜는 맞았다. N3가 `GET /api/days/:date`에 입금 연결 질의(약 0.5ms)를 더해 응답이 조금 늦어져 경합에서 지는 일이 잦아졌다(BASE 서버로도 4번 중 2번 실패 — dev-server 관찰).
  - 고침(화면): 켠 직후 이력을 받는 동안 온 **최종 문장은 들린 말 기록에 바로 남기고, 카드 만들기만 이력을 받을 때까지(켠 때부터 최대 `HISTORY_WAIT_MS` = 2초) 미룬다** — 받으면 이력 사전으로, 실패하면 지금 범위 + 기본 사전으로, 2초가 지나면 그때 사전으로 온 차례대로 카드가 된다. 끄거나 엔진이 멈추면 미룬 문장을 바로 카드로(자동 확정 없음), 콘솔을 떠나면 버린다. 판단: D-I4-06은 이력을 "켤 때 한 번" 받는다고만 정했고 그 사이 문장은 정하지 않았다 — 켜자마자 말한 단골 품종도 이력으로 알아듣는 쪽이 판매자에게 맞고(느린 휴대폰 망에서 특히), 늦어도 2초라 카드가 사라지지 않는다. 중간 결과 자막·기록·상태 글자는 바로 바뀐다.
  - 시험: `apps/web/test/voice-controller.test.ts` 넷(기다린 뒤 이력 사전·온 차례, 2초 넘으면 그때 사전·늦은 이력은 다음 문장부터, 실패면 바로, 끄면 카드·떠나면 버림 — 미루지 않게 바꾸면 넷 다 실패함을 확인). E2E `i4/` 56개 모두 통과(AC-I4-40 둘 포함).
- **SA-N3-03 기억한 입금자명 E2E가 verify에서 돌지 않음** — 화면 원인이 아니다. 기본 E2E 묶음에 실제 범위 유튜브 구매자를 만드는 길이 없어서(위 "E2E 시험 자료 주의") test-e2e가 `@fill` 묶음에 둔 것이다. 시험 모드 전용 경로(운영 404)를 서버가 두거나 test-e2e가 다른 길을 정해야 한다(오케스트레이터·spec-keeper 판단). 화면은 서버의 `canRemember`대로 보이고, 화면 단위 시험(`deposits-page.test.tsx`)이 기억 고르기 기본 골라짐·목록 지우기를 덮는다.

