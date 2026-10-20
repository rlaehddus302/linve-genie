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
| 입금 목록 | `GET /api/deposits?status=REVIEW&before=<번호>&limit=1~200` | status 기본 `REVIEW`, limit 기본 50 | `{ deposits: DepositView[], more, review }` (번호 내림차순, 다음 쪽은 `before=마지막 번호`) |
| 확인 필요 수 | `GET /api/deposits/count` | — | `{ review }` (메뉴 "입금 확인 3") |
| 입금 하나 | `GET /api/deposits/:no` | — | `{ deposit: DepositView + actions }` — `actions: [{ action: RECEIVED·AUTO·CONFIRM·IGNORE·REOPEN·REVERT, actor: { kind: 'account'\|'auto', loginId }, at, date, buyer, buyerName, seq }]` 시간 순. `auto`는 "입금 자동 확인" |
| 붙여넣기 미리 보기 | `POST /api/deposits/paste/preview` | `{ text }` | `{ rows: [{ line, at(KST +09:00), precision, amount, name, balance, state: NEW·EXISTING·OLD·FUTURE }], skipped: [{ line, why: 'NOT_DEPOSIT' }], unreadable: [{ line, why: BAD_AMOUNT·BAD_TIME }] }` — 아무것도 기록하지 않음 |
| 붙여넣기 넣기 | `POST /api/deposits/paste` | `{ requestId, text }` | `{ read, skipped, unreadable: [{ line, why }], new, existing, old, future, auto, review }` → "새 입금 {new}건 — 자동 확인 {auto}건, 확인 필요 {review}건 (이미 있던 입금 {existing}건)" |
| 확정 | `POST /api/deposits/:no/confirm` | `{ requestId, date, buyer, remaining, remember? }` (`remaining` = 화면이 본 남은 금액) | `{ deposit: { no, status: 'APPLIED', applied: { date, buyer, buyerName, seq } } }` |
| 무시 · 다시 확인 필요로 | `POST /api/deposits/:no/ignore` · `/reopen` | `{ requestId }` | `{ deposit: { no, status, applied: null } }` |
| 되돌리기 | `POST /api/deposits/:no/revert` | `{ requestId }` | `{ deposit: { no, status: 'REVIEW', applied: null }, refund: { date, seq } }` |
| 한꺼번에 | `POST /api/deposits/bulk` | `{ requestId, items: [{ no, action: 'confirm'\|'ignore', date?, buyer?, remaining?, remember? }] }` (1~100) | `{ results: [{ no, ok: true, deposit } \| { no, ok: false, status, error: { code, message } }] }` 항목 순서 |
| 묶음 찾기 | `GET /api/deposits/:no/bundles?q=<찾을 말>&date=<YYYY-MM-DD>` | q 40자까지(비면 전부), date 선택 | `{ bundles: BundleView[] }` 50개까지 — 남은 금액 있는 것 먼저 → 날짜 늦은 것 → 구매자 ID |
| 원천 목록 | `GET /api/deposits/sources` | — | `{ sources: SourceView[], popbill: boolean, testMode: boolean }` — `popbill: false`면 계좌조회 추가 대신 "계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요." |
| 원천 만들기 | `POST /api/deposits/sources` | `{ kind: 'POPBILL', label(1~20자), corpNum(숫자 10자리, '-' 허용), bank(팝빌 은행 코드 4자리), accountNumber(숫자 6~20자리, '-' 허용), intervalMin?(1~5) }` · 시험 모드만 `{ kind: 'FAKE', label? }` | `SourceView` |
| 원천 고치기 | `PATCH /api/deposits/sources/:id` | `{ label?, intervalMin?(1~5), enabled? }` (붙여넣기 원천은 label만) | `SourceView` — 주기는 바로 적용 |
| 지금 받아 오기 | `POST /api/deposits/sources/:id/fetch` | `{}` | `{ source: SourceView }` (받아 오기가 끝난 뒤) |
| 계좌 관리 주소 | `POST /api/deposits/popbill/manage-url` | `{ corpNum }` 또는 `{ source }` | `{ url }` — 새 창으로 연다(서버는 저장하지 않음) |
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

원천 오류 문장(`lastError`): "팝빌 연결을 확인해 주세요." · "팝빌 계좌조회 권한을 확인해 주세요." · "팝빌에 등록되지 않은 계좌예요. 팝빌 계좌 관리에서 등록해 주세요." · "팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요." · "은행에서 내역을 받아 오는 데 시간이 오래 걸려요. 잠시 뒤에 다시 받아 올게요." · "은행에서 내역을 받아 오지 못했어요. 잠시 뒤에 다시 받아 올게요." · "팝빌에서 받은 내역을 읽지 못했어요. 잠시 뒤에 다시 받아 올게요." · "읽지 못한 내역이 있어요" · "받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요."

#### 실시간 (`GET /api/stream`)
- 새 이벤트 종류 `event: deposit`, `data: { deposits: number[], review: number, sources: string[] }` — 입금이 저장·처리되었거나(바뀐 입금 번호), 확인 필요 수가 바뀌었거나, 원천 상태가 바뀌었을 때(새 입금·오류 문장 변화·판매자가 누른 받아 오기). 입금자명은 담지 않는다. 주기 받아 오기에서 아무것도 바뀌지 않으면 알리지 않는다.
- 엔진에 적은 입금·환불은 기존 `change` 알림(범위 seq)으로 온다 — 정산 화면은 지금처럼 증분 조회.

#### 정산 조회의 입금 연결 (AC-N3-32)
- `GET /api/days/:date`와 `GET /api/days/:date/changes`의 응답에 `depositLinks: DepositLinkView[]`가 붙는다(전체 목록 — 증분이 아니다). 리허설 범위는 늘 `[]`.
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
9. 묶음 찾기 말은 대소문자를 가리지 않는 부분 포함이다: 묶음 이름 표기, 구성원(합친 구매자 포함)의 표시 이름·이름 이력(문자찜 메모 포함), 전화번호 뒤 4자리, 유튜브 채널 ID 끝 4자리. 말이 비면 날짜(또는 전체)의 묶음 전부.
10. 실제 팝빌 전송(`popbillHttpTransport`)은 링크허브 인증(v2.0 서명)·EasyFinBank REST로 만들었지만 **실계약으로 확인하지 않았다**(D-N3-09 사용자 확인). 오류는 HTTP 401 → 인증, 403 → 권한, 그 밖 → 응답 형식 오류로만 나눈다. 시험은 가짜 전송으로만 한다.
11. 원천 상태 알림은 새 입금·오류 문장 변화·판매자가 누른 받아 오기일 때만 보낸다(1초 주기의 E2E에서 알림이 넘치지 않게). "마지막으로 받아 온 때"는 원천 목록을 다시 받을 때 최신이 된다.

### 교체한 기존 시험 (약화 아님)
- `packages/core/test/golden/core-adapter.test.ts`: 실제 골든 합계 "파일 26 · 파서 460 · 엔진 129 · 통과 589" → "파일 27 · 파서 460 · 엔진 131 · 통과 591" (G-ENG-N3-01·02가 늘어서, AC-N3-04).
- `packages/core/test/golden/validate.ts`: 시나리오 ID 형식 오류 문장의 괄호 안내에 `G-ENG-<스프린트>-두 자리`를 더함(읽기 오류 판정은 `contract.ts` `SCENARIO_ID_RE`).
- `apps/server/test/api.test.ts`: 범위 조회 응답 기대값에 `depositLinks: []`를 더함(AC-N3-32 계약 변경).
- `apps/server/test/commands.test.ts`: 마이그레이션 뒤 표 수 15 → 21(입금 표 6개).

### 검증 게이트 변경 요청
- 없음.

### 남의 영역을 고친 것
- 없음. (`packages/core/test/golden/**`는 AC-N3-04가 dev-server에게 맡긴 러너 ID 형식·자체 시험 합계만.)
