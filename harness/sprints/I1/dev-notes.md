# I1 개발 노트

## dev-server

### 바뀐 계약 (화면·E2E·적대 시험이 먼저 알아야 할 것)
S04~S06 계약은 그대로이고 아래가 더해지거나 바뀐다. 모든 `/api/print/**`는 로그인·Origin·JSON 검사(기존 `/api` 공통)를 그대로 받는다. 다른 판매자의 작업·시도·방송·범위는 없는 것과 같은 404다. 오류 본문은 기존과 같은 `{ error: { code, message, problems? }, ...extra }`이고 받은 값을 되돌려 보내지 않는다.

#### 1. 화면 설정 — 시험 모드 신호 (AC-I1-16·50)
- `GET /api/client-config` → `{ hostActionDelayMs, testPrinter }`. `testPrinter: true`는 **E2E 서버 기동만**(시험용 프린터 "시험용 프린터 — 실제로 출력되지 않아요"와 시험용 손잡이를 켠다). 운영 기동(`main.ts`)은 `productionServerOptions(env, database)`(`src/production.ts`)로만 옵션을 만들고 늘 `false`다 — 어떤 환경변수로도 켜지 않는다.
- E2E 서버: `pnpm --filter @livejjim/server e2e ... [--test-printer yes|no]` (기본 yes). 시험 모드를 끈 묶음은 `--test-printer no`. 프로그램은 `startE2eServer({ testPrinter?: boolean })`(기본 true).

#### 2. 실시간 (AC-I1-15, `GET /api/stream`)
- `GET /api/stream?device=<기기 ID>` — 기기 ID(영문·숫자·`_`·`-` 8~64자, 형식이 틀리면 400)를 밝힌 연결은 그 기기의 실시간 연결로 센다. **출력 기기 화면은 반드시 `?device=`를 붙인다**(다른 기기의 "연결됨/끊김"이 이것으로 정해진다). 출력 기기가 아닌 기기는 붙이지 않아도 된다.
- 새 이벤트 `event: print` (seq·id 없음 — 기존 `change`와 따로):
  - 출력 기록이 바뀔 때: `data: { rev, queue: QueueSummary, jobs: JobView[], labels: LabelView[] }` — **바뀐 작업·라벨 키만**(대기열 전체가 아니다). 같은 작업·라벨 키는 `(date, id)`·`(date, key)`로 덮는다. `rev`는 판매자의 출력 기록 판(바뀔 때마다 는다) — 처음에 `GET /api/print`의 `queue.rev`를 받고, 알림의 `rev`가 그보다 작거나 같으면 버려도 된다. 빠진 것 같으면(`rev`가 2 이상 뛰면) `GET /api/print`를 다시 받는다.
  - 출력 기기 실시간 연결이 열리고 닫힐 때도 `{ rev, queue, jobs: [], labels: [] }`.
  - 라벨 설정 저장: `data: { template: { kind: 'product'|'packing', version } }` (다른 기기는 `GET /api/print/templates`를 다시 받는다).
- 순서: 스트림을 먼저 연 뒤 `GET /api/print`를 받는다(그 사이 알림을 놓치지 않게 — `rev`로 거른다).
- **"재출력 필요"는 범위 기록(품종·가격 변경, 묶음 변경)으로도 바뀐다** — 이때는 `print` 알림이 없다. 화면은 그 날짜의 `change` 알림을 받으면 `GET /api/print/labels?date=`(·포장은 `/api/print/packing`)를 다시 받는다.

#### 3. 보기 모양
```ts
QueueSummary = {
  rev: number,
  device: { id: string, name: string, live: boolean /* 그 기기의 실시간 연결이 열려 있음 */, printerConnected: boolean, releasing: boolean /* 출력 그만하기 — 출력 중인 장을 기다림 */ } | null,
  pause: { reason: 'DISCONNECTED'|'PRINTER_ERROR'|'SELLER'|'LABEL_ERROR', message: string /* L-8 문장 그대로 */, backlog: boolean /* 새 출력 기기의 쌓인 라벨 — "대기 중인 라벨 N장이 있어요. 출력 시작을 누르면…" + "출력 시작" */ } | null,
  waiting: number, printing: number, discard: number /* 버릴 라벨 장 수 */,
}
LabelRef = { key: string /* 상품 `<찜>@<확정버전>`, 포장 `packing:<구매자>` */, claim, version, broadcast, no /* 상품: 처음 작업 때 */, buyerId /* 포장: 지금의 구매자 */, buyer: { kind:'youtube', name } | { kind:'sms' } }
JobView = {
  id /* 작업 ID — 자동 출력 = 효과 ID, 그 밖 m-/r-/p-… */, date /* 범위 날짜 */, kind: 'product'|'packing', reason: 'auto'|'manual'|'reprint'|'packing',
  status: 'WAITING'|'PRINTING'|'DONE'|'CANCELLED', word /* 작업 대기·출력 중·출력함·출력 안 함·폐기·폐기 — 버려 주세요 */,
  voided, discard /* 버릴 라벨 */, discardedAt, attempts /* 실패한 시도 수 */, lastError: { code, item } | null /* L-7·라벨 오류 코드 — 문장은 화면이 PRINTER_MESSAGES·LABEL_MESSAGES·doesNotFitMessage(item)로 */,
  label: LabelRef, page, pages /* 포장 */, data /* 출력함 = 찍은 데이터, 포장 = 요청 때 데이터, 그 밖 상품 = 지금 데이터(1등이 아니면 null) */,
  device /* 출력한 기기 이름 */, printedAt, createdAt /* UTC ISO */,
}
LabelView = LabelRef & {
  date, kind, state: 'NONE'|'WAITING'|'PRINTING'|'PRINTED'|'REPRINT_NEEDED'|'NOT_PRINTED'|'VOIDED',
  word /* 라벨 대기·출력 중·라벨 출력됨·재출력 필요·출력 안 함·폐기·폐기 — 버려 주세요, NONE은 '' */,
  voided, discard /* 이 라벨 키의 버릴 라벨 장 수 */, reprintNeeded /* L-10 — 서버가 내용 키로 */, printed /* 출력 횟수 */,
  history: [{ at /* UTC ISO */, device }], winner /* 상품: 지금 그 확정버전의 1등 */, data /* 지금 데이터 — 미리 보기·PNG·PDF용, 1등이 아니거나 폐기면 null */,
  canPrint /* "라벨 출력" — 작업이 없는 1등 */, canReprint /* "다시 출력" 조건(L-8 5·L-11 9) */,
}
```
- 상태 우선: 출력 중 > 폐기 > 라벨 대기 > (출력함이 있으면) 재출력 필요/라벨 출력됨 > 출력 안 함 > NONE. 폐기는 `word`가 버릴 라벨이 남았으면 "폐기 — 버려 주세요", 아니면 "폐기".

#### 4. 경로
| 경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/print` | | `{ queue, jobs /* 출력 중 먼저, 대기 순서대로 */, discard /* 버릴 라벨 */ }` |
| `GET /api/print/labels?date=` | | `{ date, labels: LabelView[] }` — 그 실제 범위의 라벨 키 전부 + 작업이 없는 지금 1등(NONE). 상품은 방송 선언·번호·확정버전 순, 포장은 뒤. 없는 범위 404, `rehearsal=true`면 422 `PRINT_REHEARSAL` |
| `GET /api/print/packing?date=&buyer=` | | `{ date, buyer /* 지금의 구매자 */, data /* 지금 묶음의 L-4 데이터, 1등 상품이 없으면 null */, label: LabelView }` |
| `GET /api/print/templates` | | `{ product: { template, version }, packing: { template, version } }` — 저장한 적이 없으면 50×30 기본 템플릿·version 0 |
| `PUT /api/print/templates/:kind` | `{ template, version /* 읽은 판 */ }` | `{ template, version, warnings: [{field,message}] /* 겹침 */, message: '라벨 설정을 저장했어요.' }` · 400 `INVALID_TEMPLATE`(`problems[].field = template.<경로>`, 문장 = validateTemplate 그대로, 가게 이름 40자 초과 "가게 이름은 40자 이하로 적어 주세요.") · 400 `TEMPLATE_TOO_LARGE`(JSON 16KB 초과) · 409 `TEMPLATE_CONFLICT` |
| `POST /api/print/device` | `{ deviceId, name, replace? }` | `{ queue, waiting, backlog }` · 409 `PRINT_DEVICE_TAKEN` + `{ device: { name } }`(바꾸려면 `replace: true`) |
| `POST /api/print/device/state` | `{ deviceId, connected }` | `{ queue }` · 409 `PRINT_NOT_DEVICE` |
| `POST /api/print/device/release` | `{}` | `{ queue }` (출력 그만하기 — 어느 기기에서나) |
| `POST /api/print/pause` | `{}` | `{ queue }` (출력 멈추기) |
| `POST /api/print/restart` | `{}` | `{ queue }` (다시 시작·출력 시작) · 409 `PRINT_RECONNECT_REQUIRED` + `{ device: { name } }`(끊김 멈춤 — 화면 문장 "출력 기기 '<이름>'에서 다시 연결해 주세요.") |
| `POST /api/print/claim` | `{ deviceId }` | `{ job: ClaimedJob }` 또는 `{ job: null, reason: 'PAUSED'\|'BUSY'\|'EMPTY' }` · 409 `PRINT_NOT_DEVICE` — 출력 중인 장의 시도를 준 지 2초(`RECLAIM_AFTER_MS`)가 지난 뒤 같은 기기가 다시 받으면 그 장을 새 시도 표로 다시 준다(받기 응답을 잃음, 수정 라운드 1) |
| `POST /api/print/result` | `{ deviceId, attempt, ok: true }` 또는 `{ deviceId, attempt, ok: false, error: { code, item? } }` | `{ recorded: boolean }` — false = 늦은 결과·이미 결과가 정해진 시도·바뀌기 전 기기(버림, 아무것도 안 바뀜). 모르는 시도 404 |
| `POST /api/print/labels/print` | `{ requestId, b, claim }` | `{ jobs: [JobView] }` (라벨 출력 — 작업이 없는 1등만) |
| `POST /api/print/labels/reprint` | `{ requestId, b, claim, version? }` | `{ jobs: [JobView] }` (다시 출력 — version이 없으면 그 찜의 마지막 라벨 키) |
| `POST /api/print/packing` | `{ requestId, date, buyer, rehearsal? }` | `{ jobs: JobView[] /* 쪽 순서 */ }` |
| `POST /api/print/jobs/cancel` | `{ date, id }` | `{ job }` (빼기) |
| `POST /api/print/jobs/cancel-all` | `{ confirm: true }` | `{ cancelled, queue }` · 400 `PRINT_CONFIRM_REQUIRED` |
| `POST /api/print/jobs/discard` | `{ date, id }` | `{ job }` (버렸어요 — 다시 보내도 한 번, 누른 계정·시각을 남김) |

- `ClaimedJob = { id, date, kind, reason, attempt /* 이 시도의 표 — 결과는 이것으로만 */, data /* 받을 때 지금 상태로 만든 L-3·L-4 데이터 */, template /* 그때의 템플릿 — 포장은 요청 때의 한 장 번호 수 */, page, pages, label }`. 포장 작업은 `renderPackingLabels(env, template, data).pages[page - 1]`을 찍는다.
- 결과 오류 코드는 L-7 표 12개(`UNSUPPORTED`…`INVALID_DENSITY`)와 라벨 패키지 6개(`INVALID_DATA`·`INVALID_TEMPLATE`·`DOES_NOT_FIT`·`MIXED_SIZES`·`NO_LABELS`·`INVALID_IMAGE`)만 받는다(그 밖 400). `DOES_NOT_FIT`은 `item`(템플릿 항목 ID)을 함께. 멈춤: `DISCONNECTED` → 끊김, 라벨 6개 → 라벨 오류, 그 밖 → 프린터 오류.
- 요청 번호(`requestId`)는 출력·다시 출력·포장 라벨만 받는다(같은 번호 = 처음 결과, 작업이 두 번 생기지 않음). 엔진 기록이 아니어서 **5초 대기 없이 바로** 보낸다.

#### 5. 오류 코드·문장 (화면이 그대로 보인다)
| 코드 | 상태 | 문장 |
|---|---|---|
| `PRINT_REHEARSAL` | 422 | 리허설 방송은 라벨을 출력하지 않아요. |
| `PRINT_NOT_DEVICE` | 409 | 이 기기는 출력 기기가 아니에요. |
| `PRINT_DEVICE_TAKEN` | 409 | 다른 기기에서 출력하고 있어요. 이 기기로 바꾸려면 바꾸기를 눌러 주세요. (화면은 AC-I1-23 확인 창 "지금은 '<이름>'에서 출력하고 있어요. 이 기기로 바꿀까요?"를 `device.name`으로) |
| `PRINT_RECONNECT_REQUIRED` | 409 | 출력 기기에서 다시 연결해 주세요. |
| `PRINT_NOT_WINNER` | 409 | 지금 1등이 아니라 라벨을 출력할 수 없어요. |
| `PRINT_LABEL_EXISTS` | 409 | 이미 만든 라벨이에요. 다시 출력을 눌러 주세요. |
| `PRINT_VOIDED` | 409 | 폐기한 라벨은 다시 출력할 수 없어요. |
| `PRINT_IN_PROGRESS` | 409 | 이 라벨은 이미 출력을 기다리고 있어요. |
| `PRINT_NOT_PRINTED` | 409 | 아직 출력한 적이 없는 라벨이에요. |
| `PRINT_WINNER_CHANGED` | 409 | 1등이 바뀐 라벨은 다시 출력할 수 없어요. |
| `PRINT_JOB_PRINTING` | 409 | 출력 중인 라벨은 뺄 수 없어요. |
| `PRINT_NOT_DISCARDABLE` | 409 | 버릴 라벨이 아니에요. |
| `PRINT_NO_ITEMS` | 409 | 이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요. |
| `PRINT_CONFIRM_REQUIRED` | 400 | 대기 중인 라벨을 모두 빼려면 확인이 필요해요. |
| `TEMPLATE_CONFLICT` | 409 | 다른 기기에서 라벨 설정이 바뀌었어요. 새로 불러온 뒤 다시 바꿔 주세요. |
| `TEMPLATE_TOO_LARGE` | 400 | 라벨 설정이 너무 커요. |
| `INVALID_TEMPLATE` | 400 | 라벨 설정에 고칠 곳이 있어요. (+ problems) |

#### 6. 출력 기기 화면이 할 일 (dev-web에게)
1. 연결 마법사에서 프린터를 이은 뒤 "이 기기에서 출력" → `POST /api/print/device { deviceId, name }`(기기 ID는 그 기기에 저장한 무작위 값). 409 `PRINT_DEVICE_TAKEN`이면 확인 창 → `replace: true`. 응답 `backlog: true`면 쌓인 라벨 안내(`queue.waiting`장) + "출력 시작" = `POST /api/print/restart`.
2. 스트림을 `?device=<기기 ID>`로 연다. `queue.device.id === 내 기기 ID`이고 `pause === null`이고 프린터가 연결돼 있으면 `POST /api/print/claim` → 그린 뒤 프린터로 → `POST /api/print/result`. `job: null`이면 `print` 알림(대기가 늘거나 멈춤이 풀림)을 받을 때 다시 받는다. 한 번에 한 장.
3. 프린터 연결 상태가 바뀌면 `POST /api/print/device/state { connected }` — "다시 연결" 성공 뒤 `connected: true`가 끊김 멈춤을 푼다.
4. 테스트 인쇄는 서버를 거치지 않는다(기록 없음).

### 만든 것
- **표 (마이그레이션 `0003_i1_print.sql`, 발송함 표는 그대로)**: `print_queues`(판매자마다 한 줄 — 출력 기기·프린터 연결·멈춤·backlog·순서 번호·rev), `print_labels`(라벨 키 — 상품 `<찜>@<확정버전>`·포장 `packing:<구매자>`, 고정 구매자, 자동 출력 효과 ID, 폐기 시각), `print_jobs`(작업 — 작업 ID·까닭·상태·폐기·시도 수·마지막 오류·출력 시각·기기·찍은 내용 키·찍은 데이터·버렸어요 누가·언제·요청 계정), `print_attempts`(시도 — 표·기기·준 데이터·내용 키·결과), `label_templates`, `print_requests`(요청 번호). 판매자마다 출력 중 작업 하나는 부분 유일 인덱스 `print_jobs_one_printing_uq`. 모든 표에 판매자 ID.
- **잠금 순서**: 출력 기록을 바꾸는 트랜잭션은 모두 `print_queues`의 그 판매자 줄을 먼저 `FOR UPDATE`로 잠근다(이벤트 기록 트랜잭션은 범위 어드바이저리 락 → 대기열 줄 순). 순서 번호(대기 맨 끝 `next_order`, 맨 앞 `front_order`)도 그 줄에서 나눈다.
- **효과 → 작업 (L-11 2)**: `ScopeWriter`에 `txHook`(이벤트·발송함 행과 같은 트랜잭션, `afterInsert` 다음)을 더했다. `PrintService.txHook`이 `createAutoJobs`(`src/print-store.ts`) → `autoLabelEffects`(발송함 행 조회 — **리허설인지를 인자로 받지 않고 `eq(outbox.rehearsal, false)`·`eq(scopes.rehearsal, false)`로 고정**, RA-S05-002)를 부른다. 작업 ID = 효과 ID, 구매자 = 그 효과를 낸 이벤트 직후 상태의 L-9 구매자(찜이 생긴 경로는 코어 `listClaims`의 `origin`, 이름은 `getBuyer(찜의 구매자 자신).display`). 리허설 범위는 훅이 아무것도 하지 않는다.
- **폐기 (L-11 5)**: 같은 훅에서 ① 이 기록의 `VOID_LABEL` 효과의 라벨 키, ② 찜·상품 상태가 바뀐 기록이면(코어 상태의 `claims`·`slots` 참조가 바뀜) 아직 폐기되지 않은 상품 라벨 키 중 그 찜이 1등이 아닌 것 — 한 이벤트 기록은 그 번호의 `getProduct().winnerClaims`로, 여러 이벤트를 한 번에 쓴 기록(채우기)은 찜의 확정버전까지(`listClaims`) 본다. 받을 때(`claim`)·다시 출력 요청 때는 늘 확정버전까지 본다. 대기 → 출력 안 함 + 폐기, 출력 중 → 폐기 표시(결과가 출력함이면 버릴 라벨, 실패면 출력 안 함 + 폐기), 출력함 → 버릴 라벨.
- **엔진 보고 (L-11 7)**: 결과가 출력함이고 라벨 키에 자동 출력 효과가 있으면 `writer.write`로 `effect.labelPrinted`(조치자 server)를 쓰고, 같은 트랜잭션의 `afterInsert`에서 시도·작업을 출력함으로 바꾼다. `build`가 그 범위 상태의 효과가 이미 실행 완료면 쓰지 않는다(효과마다 한 번 — 재출력·재전송·두 기기·재시작). 시도가 이미 끝났으면 `WriteAbort`(새로 내보낸 기록 중단 — 롤백)로 아무것도 남기지 않는다. 효과가 취소됐어도 기록한다(늦은 보고 → 엔진 VOID_LABEL → 훅이 폐기).
- **라벨 데이터 (L-9, `src/label-data.ts`)**: 코어 조회 함수(`listClaims`·`getProduct`·`getBroadcast`·`getBuyer`·`currentBuyerOf`·`getSettlement`·`listBroadcasts`)만 읽는다. 찜 색인은 범위 실행 상태의 보기 캐시(`views.claims`, 최근 상태 4개)에 둔다.
- **출력 기기·받기·결과·멈춤·손으로 출력·다시 출력·빼기·포장·템플릿·실시간**은 `src/print.ts`(`PrintService`)·`src/print-api.ts`.
- **허브**: `open(..., deviceId)`·`deviceLive`·`publishPrint`·`onDevice`(출력 기기 연결이 열리고 닫히면 대기열 요약 알림).
- **코어 러너 자체 시험 합계 교체 (AC-I1-80)**: `packages/core/test/golden/core-adapter.test.ts` "파일 22 · 파서 379 · 엔진 123 · 통과 502, 나머지 0"(이름의 AC 번호 AC-I1-80). 그 밖의 골든·러너·허용 목록·라벨 골든은 손대지 않았다.
- 의존성: `apps/server`에 `@livejjim/label`(`workspace:*` — 순수 함수 `validateTemplate`·`checkProductData`·`checkPackingData`·`labelContentKey`·`defaultTemplate`·`computePackingText`·`templateToJson`·`trimLabelText`·`splitGraphemes`만, 캔버스·Node 진입점은 쓰지 않는다). `packages/label`·`packages/printer`는 바꾸지 않았다.

### 규칙 문장 안에서 정한 것 (구현 선택)
- **출력 기기가 되는 기기는 프린터가 연결된 것으로 본다**(화면은 연결한 뒤에만 "이 기기에서 출력"을 보인다). 바꾸기(replace)·새로 정하기는 끊김 멈춤을 푼다. 같은 기기가 다시 알리면 이름을 고치고 출력 그만하기(releasing)를 거두며, 멈춤·프린터 연결 상태는 바꾸지 않는다(수정 라운드 1, TD-I1-002).
- **새로 정하기 = 출력 기기가 없을 때**. 대기 작업이 있으면 판매자 멈춤 + `backlog: true`. 바꾸기(다른 기기가 출력 기기)는 멈추지 않고 이어서 출력한다(AC-I1-72 "휴대폰이 이어서 출력한다").
- **멈춤 우선**: 프린터 오류·라벨 오류는 지금 멈춤을 덮어쓴다(판매자 멈춤 포함). 끊김은 멈추지 않았을 때만 끊김 멈춤이 된다(손으로 푸는 멈춤 중에 끊겼다 이어져도 그대로). "다시 시작" 때 출력 기기의 프린터가 끊겨 있으면 끊김 멈춤으로 바뀐다. 출력 그만하기로 출력 기기가 비면 끊김 멈춤은 풀린다(다시 연결할 기기가 없다). 출력 멈추기는 이미 손으로 푸는 멈춤이면 그대로다.
- **받을 때 라벨 데이터를 만들 수 없으면**(예: 엔진·API는 받지만 L-3 밖인 번호 10000) 작업은 대기 맨 앞 그대로, 시도 +1, 마지막 오류 `INVALID_DATA`, 라벨 오류 멈춤. **1등인지를 먼저 보고**(`isWinnerOf`) 1등이 아닐 때만 폐기한다 — 1등인데 데이터를 못 만들면 폐기하지 않는다(L-11 5, 수정 라운드 1, TD-I1-001). 판매자가 그 장을 빼면(빼기) 다음 장이 나온다.
- **결과 기록 후 출력함 작업의 마지막 오류는 지운다**(시도 수는 남는다).
- **손으로 출력의 거절**(규칙에 문장이 없다): 1등이 아니면 `PRINT_NOT_WINNER` "지금 1등이 아니라 라벨을 출력할 수 없어요.", 그 라벨 키에 작업이 있으면 `PRINT_LABEL_EXISTS` "이미 만든 라벨이에요. 다시 출력을 눌러 주세요." — 화면은 `canPrint`·`canReprint`로 단추를 고르므로 보통은 보이지 않는다.
- **다시 출력의 확인 순서**: 라벨 키 없음 → 아직 출력한 적 없음, 폐기 → 폐기, 대기·출력 중 → 기다리는 중, 작업 0개 → 아직 출력한 적 없음, 1등 아님 → 그 자리에서 폐기하고 "1등이 바뀐 라벨…". `version`이 없으면 그 찜의 가장 큰 확정버전 라벨 키.
- **포장 라벨**: 쪽 수는 요청 때의 포장 템플릿 `perPage`로 `computePackingText`가 나눈 쪽 수, 작업마다 그 `perPage`를 남기고 받을 때 템플릿의 `perPage`를 그 값으로 바꿔 준다(쪽 수가 받을 때 바뀌어 `1/2`·`2/3`이 섞이지 않게 — D-I1-10). 그 라벨 키에 대기·출력 중 작업이 있으면 `PRINT_IN_PROGRESS`. 라벨 키의 구매자 표시는 마지막 요청 때의 것.
- **템플릿**: 판 번호는 저장마다 +1(처음 0). 가게 이름 길이는 `trimLabelText` 뒤 `splitGraphemes` 글자 수. JSON 크기는 받은 템플릿 값의 `JSON.stringify` UTF-8 바이트. 받은 칸 이름은 영문 칸 이름(점으로 5단까지)일 때만 `problems[].field`에 되돌린다.
- **시도 표**는 18바이트 무작위(base64url), 서버가 만든 작업 ID는 `m-`(손으로)·`r-`(다시 출력)·`p-…-<쪽>`(포장) + 영문 소문자 20자(숫자가 없어 번호 모양이 될 수 없다).

- **받기 응답을 잃은 같은 기기 (수정 라운드 1, TE-I1-002·SA-I1-004·RA-I1-001)**: 받기 트랜잭션에서 출력 중 작업의 열린 시도가 **요청한 기기의 것이고 준 지 `RECLAIM_AFTER_MS`(2초, 서버 시계)가 지났으면** 그 시도를 `DISCONNECTED`로 끝내고(시도 +1, 마지막 오류 `DISCONNECTED` — 기기 바꾸기와 같은 `#returnPrinting`) 그 장을 대기 맨 앞으로 돌린 뒤 같은 요청 안에서 다시 받는다. 그래서 같은 장이 **새 시도 표**로 나가고(앞 표의 결과는 `recorded: false`), 데이터·템플릿·1등 확인은 다시 받는 때의 규칙 그대로다(그사이 1등이 바뀌었으면 그 장은 출력 안 함 + 폐기, 다음 작업). 출력 중 작업은 여전히 하나이고 **다음 작업은 주지 않는다**(AC-I1-06).
  - 2초 안에 겹쳐 온 같은 기기의 받기는 지금처럼 `BUSY` — 동시에 거듭 온 요청이 같은 장을 여러 번 받아 겹쳐 찍지 않게 한다(적대 "같은 기기 받기 10번 → 작업 하나"). 출력 기기 화면은 받기 응답을 잃으면(네트워크 오류) 3초 뒤 다시 받으므로 그때 되찾는다. 화면은 결과를 보내기 전에는 받지 않으므로(`#flushResult` 먼저, 펌프 직렬) 찍는 중인 장을 다시 받는 일은 없다.
  - 출력 그만하기(releasing)를 기다리던 중이면 그 장의 결과가 정해진 것으로 보고 출력 기기를 비운다(응답 409 `PRINT_NOT_DEVICE`, 그 장은 대기 맨 앞) — 결과 실패 때와 같다(L-11 10). 단 화면은 releasing 중에는 받지 않으므로, 그만하기 중 응답을 잃은 기기는 판매자가 같은 기기에서 다시 "이 기기에서 출력"을 누르거나(그만하기를 거둠 → 받기 → 되찾기) 다른 기기로 바꾸면 풀린다.
  - 같은 기기의 `POST /api/print/device`·`device/state`는 열린 시도를 건드리지 않는다(찍는 중에 다시 알릴 수 있다 — TD-I1-002).

### 바꾼 기존 시험 (교체 — 약화 아님)
- `packages/core/test/golden/core-adapter.test.ts`: 합계 파일 21·엔진 119·통과 498 → 파일 22·엔진 123·통과 502 (AC-I1-80, 골든이 늘어서).
- `apps/server/test/commands.test.ts`: 마이그레이션 뒤 테이블 수 9 → 15 (출력 기록 표 6개 — 스키마 정의와의 대조는 그대로).
- `apps/server/test/e2e.test.ts`: `GET /api/client-config` 기대값에 `testPrinter`(E2E 기동 true·운영 기본 false)를 더함.

### 시험 (내 영역)
- `apps/server/test/print.test.ts`·`print-rules.test.ts`(도우미 `print-support.ts`): 자동 작업 = 효과(재생 비교)·리허설 0·받기·결과·엔진 보고 한 번·잠금·버릴 라벨·끊김 → 다시 연결·바꾸기·늦은 결과·손으로·다시 출력·빼기·재출력 필요·L-9 사례 (가)~(마)·리허설 고정 소스 검사·늦은 보고 VOID_LABEL·트랜잭션 경계(효과 기록 실패·출력함/보고 실패)·격리·재시작·기기 이름·그만하기·실시간(`print`·`?device=`)·모두 빼기·라벨 오류·포장(쪽·데이터·재출력 필요)·템플릿·시험 모드 신호(운영 조립 함수)·로그 개인정보.

### test-domain·test-e2e에게
- 서버 직접 부르기: `newWorld()`·`addSeller()`(`apps/server/test/support.ts`)와 `world.server.print`(`PrintService`) — `overview`·`labels`·`claim`·`result`·`registerDevice`·`settled()`(알림이 다 나갈 때까지). 함수: `createAutoJobs`·`autoLabelEffects`(`@livejjim/server`에서도 내보낸다). 엔진 보고 수는 `select body from events where type = 'effect.labelPrinted'`.
- 시험 훅: `createServer({ hooks: { beforeCommit } })`의 `beforeCommit(records)`가 던지면 그 기록 전체(이벤트·발송함·작업·폐기·출력함)가 롤백된다 — 출력함 + 보고 트랜잭션은 records에 `effect.labelPrinted`가 있다.
- E2E 서버의 시험 모드는 기본 켜짐(`--test-printer no`로 끈다).

### 검증 (dev-server, 커밋 3522ab4)
- `E2E_PORT_OFFSET=500 pnpm verify`: typecheck(설정 11·TS 338) · lint(0·0) · test(파일 103·테스트 2343) · golden(파일 22·파서 379·엔진 123·통과 502·나머지 0) · adversarial(파일 33·테스트 757) · coverage(코어 라인 100%·분기 99.65%) 통과, **e2e 실패 2**(통과 131): `s05/attacks-r2.spec.ts:70`(보드에 62번이 10초 안에 안 보임)·`s06/phase1.spec.ts:63`(리허설 범위 구매자 목록). 그때 부하 평균 9 안팎(다른 작업 폴더 verify와 겹침), e2e 단계 825초.
  - 두 시험만 다시 돌리면 7개 모두 통과(2.5분), 이어서 `E2E_PORT_OFFSET=500 pnpm e2e` 단계만 다시 돌리면 **파일 22 · 통과 133**(12.6분). 두 시험은 I1 서버 변경이 닿지 않는 길이다(리허설 범위는 출력 훅이 바로 돌아가고, 상품 등록은 효과가 없다) — 부하 때문의 흔들림으로 본다.
- I1 E2E(`tests/e2e/i1/**`)·적대(`tests/adversarial/i1/**`)는 아직 없다(테스터 몫).

### 수정 라운드 1 (dev-server)
- SA-I1-001·TD-I1-001: 받을 때 1등 확인(`isWinnerOf`)과 데이터 만들기를 나눴다 — 1등이 아니면 폐기, 1등인데 데이터를 못 만들면 라벨 오류 멈춤(위 "규칙 문장 안에서 정한 것").
- SA-I1-002·TD-I1-002: 같은 기기가 다시 출력 기기가 되면 releasing을 거둔다.
- SA-I1-004·RA-I1-001·TE-I1-002: 받기 응답을 잃은 같은 기기가 2초 뒤 다시 받으면 같은 장을 새 시도 표로 다시 준다(위).
- 더한 시험(`apps/server/test/print.test.ts`·`print-rules.test.ts`): 받기 응답을 잃은 같은 기기(2초 안 BUSY → 3초 뒤 같은 장·새 표·다시 받는 때의 품종·앞 표 결과 버림·엔진 보고 하나·다음 장), 그사이 1등 취소(출력 안 함 + 폐기·승계자 라벨), 그만하기 중 되찾기(출력 기기 비움·대기 맨 앞), 그만하기 뒤 같은 기기 다시 정하기(releasing 거둠), 번호 10000 문자찜 1등(라벨 오류 멈춤·폐기 없음·다시 시작해도 같은 장·빼면 다음 장). 다섯 개 모두 고치기 전 코드에서 실패하는 것을 확인했다. 기존 시험은 바꾸지 않았다.

## dev-web

### 만든 것 (apps/web)
- **페이지의 실시간 연결 하나** (`src/lib/stream.ts` `SharedStream`): 범위 저장소(콘솔·정산…)와 출력 기록이 같은 SSE 연결의 알림을 나눠 받는다(같은 주소 연결 수 상한을 실시간 연결이 다 쓰지 않게). 연결은 늘 `?device=<기기 ID>`를 밝힌다(이 탭이 출력 기기가 되면 바로 "연결됨"). 늦게 붙은 쪽에는 지금까지 받은 범위별 seq로 `ready`를 한 번 다시 준다(새 연결의 ready와 같은 성질). 마지막 보는 쪽이 닫히면 연결을 닫고, 오프라인이면 닫았다가 온라인이 되면 새로 연다. `ConsoleStore`의 기본 `openStream`이 이것을 쓴다(주입하는 시험은 그대로).
- **기기 ID는 탭마다** (`src/lib/device.ts`, sessionStorage — 새로고침해도 같다, 탭 복제로 같아지면 Web Locks로 나중 탭이 새 ID). 프린터 연결은 탭 안에 있으므로 같은 PC의 다른 탭이 출력 기기 행세(프린터 없이 끊김 알림·출력 중인 장을 끊김으로 되돌림)를 하지 않게 했다. 기기 이름·인쇄 농도·마지막 연결 방법은 그 브라우저(localStorage).
- **출력 기록 저장소** (`src/lib/print-store.ts` `PrintStore`, 앱 전체에 하나 — `components/print-context.tsx` `PrintProvider`): `GET /api/print`·`/api/print/templates`·`/api/client-config`. `print` 알림은 `rev`가 지금보다 작으면 버리고(같거나 크면 덮는다 — 한 조회 뒤 알림 둘이 같은 요약을 읽을 수 있다), 둘 이상 뛰면 0.25초 뒤 다시 받는다. 처음 조회 전 알림은 모았다가 덮는다. `ready`(다시 붙음)면 다시 받는다. 범위 라벨 상태(`/api/print/labels`)·포장(`/api/print/packing`)은 보는 화면이 있는 동안만 받고, 그 날짜(실제 범위)의 `change`면 다시 받는다 — 단 라벨 상태는 `chat`·`sms`·`effect.labelPrinted` 기록에는 다시 받지 않는다(품종·가격을 바꾸지 않고, 1등이 바뀌면 작업·폐기가 print 알림으로 온다 — 방송 중 채팅마다 조회하지 않게). 포장은 모든 기록에 다시 받는다(묶음이 바뀐다).
- **이 기기의 프린터** (`src/lib/printer-station.ts` `PrinterStation`, 앱 전체에 하나 — 화면을 옮겨도 출력이 이어진다): 연결은 판매자가 누를 때만(B1 어댑터 `createB1Adapter` · 시험 모드면 `createFakePrinter`). 이 탭이 출력 기기이고 멈춤이 없고 출력 그만하기 중이 아니고 프린터가 이어져 있으면 `claim` → 그리기(내장 글꼴을 먼저 불러온다 — 못 불러오면 받지 않고 3초 뒤 다시) → `adapter.print(그림, {농도})` → `result`(네트워크 실패는 같은 시도 표로 다시). 받은 작업이 없으면 다음 print 알림까지 기다린다. 프린터 연결이 바뀌면 `device/state`(같은 값은 다시 보내지 않음). 출력 중 시도 표는 sessionStorage에 두었다가 앱이 출력 중에 닫혔으면 다음에 열 때 끊김(`DISCONNECTED`)으로 알린다. 열 때 서버가 이 탭을 출력 기기로 아는데 프린터가 이어져 있지 않으면 끊김을 알린다(끊김 멈춤 → "다시 연결"). 출력 기기가 되면 화면 꺼짐 막기(`navigator.wakeLock`)를 요청하고 안 되면 안내.
- **화면**: 메뉴 "라벨"(`/labels`), 위 줄 프린터 상태(링크), `LabelsPage`(프린터·출력 대기열·버릴 라벨·출력 이력·라벨 설정·내보내기), `LabelSettings`(편집·미리 보기·저장 전 검사), `PrintParts`(멈춤 띠·대기 작업·버릴 라벨·알림 창), `LabelParts`(상품 자세히 라벨·Alt+P 창·정산 포장 라벨·보드 낱말), `LabelImage`(1비트 그림 → 정수 배 캔버스, 50mm 틀 안 48mm).
- **라벨 그리기·내보내기** (`src/lib/label-render.ts` — DOM 없음, `label-env.ts` 브라우저 글꼴, `label-files.ts` 내려받기·공유): 미리 보기·출력·PNG·PDF가 같은 `renderProductLabel`/`renderPackingLabels` 그림. 저장 전 최악값 검사는 상품 `9999`·`99,999,999원`·`99,999 천원`(+ 긴 품종·닉네임), 포장은 네 자리 번호 998개 + 다른 방송 1개(상품 999개)·`99,999,999원`의 첫 쪽·마지막 쪽만 그린다(가운데 쪽은 첫 쪽과 길이가 같다).
- 의존성: `apps/web`에 `@livejjim/label`·`@livejjim/printer`(`workspace:*`). 패키지는 바꾸지 않았다. 빌드 결과 JS 약 650KB(niimbluelib 포함 — Vite 500KB 경고만), 내장 글꼴 자산 1.58MB(서비스 워커가 함께 저장).

### test-e2e에게 — 화면 이름·조작 (글자로 찾는다)
- 메뉴 `navigation "메뉴"` → `link "라벨"`(`/labels`). 위 줄 프린터 상태는 링크, 글자 그대로: `프린터 <이름> · 연결됨 · 대기 N장` / `프린터 <이름> · 끊김 · 대기 N장` / `출력 기기 없음 · 대기 N장` / `출력 멈춤 · 대기 N장` / 작업이 하나도 없으면 `출력 기기 없음`. 연결됨 = 출력 기기의 실시간 연결 && 프린터 연결.
- 라벨 화면 영역(`region` 이름): `프린터` · `출력 대기열` · `버릴 라벨` · `출력 이력` · `라벨 설정` · `내보내기`. 멈춤 띠는 `region "출력 멈춤"`(출력 대기열 안, 멈췄을 때만).
- 프린터 영역: 연결 방법 단추 `블루투스로 연결` · `USB 선으로 연결` · (시험 모드만) `시험용 프린터 — 실제로 출력되지 않아요` — 이 브라우저에 있는 것만(헤드리스 크로미움은 블루투스·USB가 보일 수 있다). 상태 글 `이 기기의 프린터: 연결됨`(끊김·연결 중·출력 중). 연결되면 `테스트 인쇄` · `연결 끊기` · 선택 칸 `인쇄 농도`(1~5, 기본 3) · 글 칸 `기기 이름`(기본 PC/휴대폰) · `이 기기에서 출력`. 테스트 인쇄 뒤 `테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?` + `예`/`아니요`(아니요 → `list "테스트 인쇄 도움말"`). 출력 중이면 테스트 인쇄가 막히고 `앞 라벨을 출력하는 중이에요. 끝난 뒤 다시 해 주세요.`
- 출력 기기 표시: 이 탭이면 `이 기기가 출력 기기예요` (+ 화면 꺼짐 막기 실패면 `출력하는 동안 이 화면을 켜 두세요.` — 헤드리스는 대개 실패라 이 문장이 보인다), 다른 탭이면 `출력 기기: <이름> · 연결됨|끊김` (+ 끊김이면 `출력 기기 '<이름>'와 연결이 끊겼어요.`). `출력 그만하기`는 출력 기기가 있으면 어느 기기에나. 다른 기기가 출력 기기일 때 `이 기기에서 출력` → `dialog "출력 기기 바꾸기"`(`지금은 '<이름>'에서 출력하고 있어요. 이 기기로 바꿀까요?`, 처음 포커스 `닫기`, 숫자 `1` 또는 `1 바꾸기`).
- 멈춤 띠: 문장(L-8 그대로, 쌓인 라벨이면 `대기 중인 라벨 N장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.`) + 할 일: 끊김이면 출력 기기에서 `다시 연결`(다른 기기는 `출력 기기 '<이름>'에서 다시 연결해 주세요.`), 손으로 푸는 멈춤 `다시 시작`, 쌓인 라벨 `출력 시작`. 멈추지 않았으면 대기열 영역에 `출력 멈추기`.
- 대기 작업 `list "대기 작업"`: 줄마다 `15번 핑크프릴 · 우주천사 · 상품 · 자동 <작업 대기|출력 중> · 시도 N번`, `마지막 오류: <L-7 문장>`, `만든 때 HH:MM`, 대기면 `빼기`. `모두 빼기` → `dialog "모두 빼기"` → `1 모두 빼기`. 포장은 `포장 1/2쪽`.
- 버릴 라벨 `list "버릴 라벨 목록"`: `15번 · <구매자 표시> · 26.10.18 라벨을 버려 주세요` + `버렸어요`. 출력 이력 `list "출력 이력 목록"`: `15번 · <구매자> <낱말>` + `2번 출력 · 20:01 휴대폰 · 20:15 PC`(KST).
- 라벨 설정: `상품 라벨`/`포장 라벨`(누른 상태 aria-pressed), 라디오 `50×30mm` · `50×20mm` · `50×40mm`, 글 칸 `가게 이름`(**exact**로 찾는다 — 항목 단추 이름에 "가게 이름 …"이 들어 있다), 라디오 `천원 단위 (예: 8 천원)` · `원 단위 (예: 8,000원)`, 포장 `한 장 번호 수`, 항목마다 체크 `<항목> 켜기`(끌 수 없는 항목은 잠김 + `끌 수 없어요`), 단추 `<항목> 글자 작게`/`글자 크게`/`위로`/`아래로`/`왼쪽으로`/`오른쪽으로`, `라벨 설정 저장`, `기본으로 되돌리기`, 체크 `가장 긴 값으로 보기`. 미리 보기는 `img "상품 라벨 미리 보기"`(포장 `포장 라벨 미리 보기 N쪽`) 캔버스 — `data-width`·`data-height`(점)·`data-scale`(정수 배). 저장 성공 `라벨 설정을 저장했어요.`, 충돌이면 서버 문장 + `새로 불러오기`, 최악값이 안 들어가면 `<항목> 칸이 좁아 라벨을 만들 수 없어요. …`(저장 안 함), 겹침은 `list "겹침 경고"`.
- 자동 출력: 체크 `1등 확정 때 라벨 자동 출력`(판매 규칙 `print.autoOnConfirm`, PATCH /api/settings), 바꾸면 `다음에 시작하는 방송부터 적용돼요.`, 진행 중 실제 방송이 있으면 `지금 방송: 자동 출력 켜짐|꺼짐`(여럿이면 뒤에 `(제목)`).
- 내보내기: 선택 칸 `방송`(실제 방송, 기본 맨 마지막), `지금 1등 라벨 N장`, `1등 라벨 모두 A4 PDF로 저장`(`라벨-<날짜>-<그날 순번>-A4.pdf`), 접힘 `라벨마다 그림 파일로 저장`(줄마다 `그림 파일로 저장`·`공유`), `대기 중인 라벨 모두 A4 PDF로 저장`(`라벨-대기-<오늘>-A4.pdf`). 라벨이 없으면 막힌다. 바로 연결할 수 없는 브라우저의 `그림 파일로 저장하기` 링크가 이 영역(`#label-export`)으로 간다.
- 콘솔: 보드 줄에 라벨 낱말(서버 LabelView `word` 그대로 — `라벨 대기`·`출력 중`·`라벨 출력됨`·`재출력 필요`·`출력 안 함`, 작업 없으면 없음). 알림 띠(`region "알림"`): `출력 멈춤 · <까닭 문장>`, `버릴 라벨 N` — 누르면 `dialog "출력 멈춤"`(멈춤 띠) / `dialog "버릴 라벨"`(줄마다 `버렸어요`, 숫자 키 1~9). Alt+1 순서 충돌 → 취소 요청 → 승계 결정 필요 → 출력 멈춤 → 버릴 라벨 → 확인 필요. Alt+P(⌥P, `code KeyP`) → `dialog "라벨 다시 출력"`: `15번 라벨을 다시 출력할까요? (1등: <이름>)`(작업 없으면 `출력할까요?`) + `1 다시 출력`/`1 출력`, 재고 2 이상이면 `1 <이름> 다시 출력`…, 1등이 없으면 `1등이 없어 출력할 라벨이 없어요.`, 리허설이면 `리허설 방송은 라벨을 출력하지 않아요.`. 보낸 결과 `다시 출력을 접수했어요.`/`라벨 출력을 접수했어요.` 또는 서버 거절 문장.
- 상품 자세히(`dialog "15번 자세히"`) 안 `region "라벨"`: 1등마다 `group "1등 <이름> 라벨"` — 낱말, 이력, `img "15번 라벨 미리 보기"`, `라벨 출력`(작업 없음) 또는 `다시 출력`, `그림 파일로 저장`(`라벨-<방송 날짜>-15번.png`), `공유`(지원할 때), `PDF로 저장`(`라벨-<날짜>-15번.pdf`). 지난 1등의 폐기 라벨은 `list "폐기한 라벨"`(`지난 1등 라벨 · <구매자> · 폐기|폐기 — 버려 주세요`). 리허설은 `리허설 방송은 라벨을 출력하지 않아요.`만.
- 정산 자세히 `region "포장 라벨"`: 낱말·이력, 쪽마다 `1/2` + `img "포장 라벨 1/2 미리 보기"` + `그림 파일로 저장`(`포장라벨-<날짜>-1쪽.png`), `포장 라벨 출력`(→ `포장 라벨 N장 출력을 접수했어요.`), `PDF로 저장`(`포장라벨-<날짜>.pdf`). 1등 상품이 없으면 단추가 막히고 `이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요.`. 리허설은 문장만.

### 시험용 프린터 손잡이 (시험 모드에서만, AC-I1-50)
- `window.livejjimTestPrinter` (서버 `testPrinter: true`일 때 앱이 열리면 곧 생긴다 — 연결 전에도): `printed()` → 끝까지 출력한 그림 `{ width, height, data: number[] }[]`(받은 순서, 라벨 1비트 바이트 그대로 — `@livejjim/label` 그림과 `bitmapsEqual`로 비교), `printedCount()`, `printCalls()`, `setBehavior(n, 'disconnect' | 'fail' | { delayMs } | null)`(n = 그 탭 프린터의 n번째 출력, 테스트 인쇄 포함), `simulateDisconnect()`, `setConnectError(code | null)`. 라벨 화면 프린터 영역의 접힘 `시험용 프린터 조작`(받은 그림 수·`연결 끊김 흉내`)도 시험 모드에서만.
- **전체 새로고침(`page.goto`·`reload`)은 그 탭의 프린터 연결과 시험용 프린터(받은 그림 기록)를 버린다** — 출력 기기 탭은 앱 안 이동(메뉴 링크·`page.goBack()`)으로 옮겨야 출력이 이어진다. 새로고침한 출력 기기 탭은 끊김 멈춤이 되고 `다시 연결`(마지막 연결 방법 — 시험용 프린터면 새 가짜 프린터)로 이어진다.
- 기기 ID는 탭(브라우저 컨텍스트의 페이지)마다다 — 같은 컨텍스트에 새 페이지를 열면 다른 기기다.
- 시험 모드를 끈 묶음: Playwright 프로젝트 `chromium-no-test-printer`(화면 5176·서버 3103 + E2E_PORT_OFFSET, 서버 `--test-printer no`) — 제목에 `@no-test-printer`인 시험만 돈다.

### 규칙 문장 안에서 정한 것 (구현 선택)
- 프린터 상태는 위 줄(고정 영역이 아님) 안의 링크다 — 휴대폰 고정 영역 35%(D-094)를 늘리지 않는다. 출력 멈춤은 콘솔 알림 띠(고정 영역)에도 보인다.
- 알림 띠의 출력 멈춤 항목 글은 `출력 멈춤 · <까닭 문장>`(다른 항목은 `낱말 N`).
- 테스트 인쇄 결과 "아니요" 도움말 네 줄: `라벨 크기가 50×30mm인지 확인해 주세요.` · `인쇄 농도를 한 단계 올려 보세요.` · `NIIMBOT 정품 라벨인지 확인해 주세요.` · `맨 아래 테두리가 빠지면 알려 주세요.`
- 템플릿 편집: 위치 한 번 4점(0.5mm), 글자 크기 한 번 2점(최소 글자 크기가 더 크면 함께 내린다), 상자는 라벨 밖으로 옮기지 않는다(그 쪽 단추가 막힘). 크기를 바꾸면 그 크기의 기본 상자로(가게 이름·가격 표기·항목 켜기는 그대로, 포장 한 장 번호 수는 그 크기 기본). 기본으로 되돌리기는 가게 이름을 남긴다. 가게 이름 40자 초과는 화면도 막는다(서버와 같은 문장).
- 다시 출력 요청에는 그 찜의 지금 확정버전(`version`)을 보낸다. 라벨 상태를 아직 모르는 1등은 "라벨 출력"으로 본다.
- 출력 중에 프린터가 이미 끊겨 있었으면(받는 사이) 결과는 `DISCONNECTED`(NOT_CONNECTED가 아니라 — 끊김 멈춤 → 다시 연결로 이어서). 그리기·출력 중 예상 못 한 예외도 `DISCONNECTED`(찍혔는지 모른다).
- 대기열 작업을 받는 중·찍는 중에는 테스트 인쇄를 할 수 없다(프린터에 두 장을 겹쳐 보내 `BUSY`가 생기지 않게 — D-I1-06).
- 포장 라벨 파일 이름은 `포장라벨-<날짜>-<쪽>쪽.png`·`포장라벨-<날짜>.pdf`(구매자 없음 — 같은 날 두 묶음이면 브라우저가 이름 뒤에 번호를 붙인다).

### 바꾼 기존 시험 (교체 — 약화 아님)
- `apps/web/test/pwa.test.tsx` 메뉴: 항목 `방송·문자찜 입력·구매자·정산` → `+ 라벨`(href `/labels`), aria-current 목록도 다섯 개. 메뉴가 다섯 개가 되어서다(AC-I1-20).
- 콘솔 보드 라벨 낱말의 출처: 엔진 효과(`derive.ts labelWords`)를 지우고 서버 출력 기록으로(AC-I1-30). 이 낱말을 확인하던 기존 화면 시험은 없었다(`LABEL_WORD` 상수 시험은 그대로).

### 시험 (내 영역)
- `test/print-store.test.ts`(rev·덮기·모으기·다시 받기·라벨 상태·조용한 기록), `test/printer-station.test.ts`(받기·찍기·결과·끊김·다시 연결·라벨 오류·닫혔던 시도·테스트 인쇄·농도·손잡이·바꾸기), `test/labels-page.test.tsx`(메뉴·상태·연결 방법·미지원·멈춤 띠·다른 기기·버릴 라벨·자동 출력·영어 없음), `test/console-labels.test.tsx`(보드 낱말·실시간 연결 하나·리허설·Alt+P·알림 띠·Alt+1 순서), `test/stream-words.test.ts`, `test/label-render.node.test.ts`(미리 보기 = 출력 그림·최악값 검사·파일 이름, Node 캔버스).

### 검증 (dev-web, 커밋 d136633 위)
- `E2E_PORT_OFFSET=500 pnpm verify`: 7단계 모두 통과 — typecheck(설정 11·TS 360) · lint(0·0) · test(파일 109·테스트 2393) · golden(파일 22·파서 379·엔진 123·통과 502·나머지 0) · adversarial(파일 33·테스트 757) · e2e(파일 22·통과 133, 12.6분) · coverage(코어 라인 100%·분기 99.65%). I1 E2E·적대 시험은 아직 없다(테스터 몫).
- 손 점검(시험용 프린터, E2E 서버 + 화면 미리 보기, 크로미움): 두 기기 30장 중 12번째 끊김 → 휴대폰 "다시 연결" → 시험용 프린터가 받은 그림 정확히 30장·`effect.labelPrinted` 30개·PC 보드 30개 "라벨 출력됨". 승계 → 새 1등 라벨 자동 출력·"버릴 라벨 1"(Alt+1 → 1 = 버렸어요), 품종 고침 → "재출력 필요" → Alt+P → 1 → "라벨 출력됨"(2번 출력), 출력 중(지연) 1등 취소 → 나온 뒤 버릴 라벨. 출력 기기 없이 1등 3개 → 새 출력 기기 쌓인 라벨 안내 → 출력 시작 → 3장, 휴대폰 → PC 바꾸기(확인 창) → PC가 이어서. 자동 출력 끔 → 새 방송 대기 0 → 상품 자세히 "라벨 출력" 1장 → 취소하면 버릴 라벨. 리허설 대기 0·자세히/포장 라벨 자리 문장. 375×812 라벨 화면·콘솔 자세히·정산 자세히 가로 스크롤 없음·44px·16px·칸 이름.

### test-e2e에게 — 시험끼리 출력 기록이 섞이지 않게
- 출력 기록은 **판매자 단위**(시험 계정 하나를 모든 E2E가 함께 쓴다)이고 Playwright는 파일 이름 순으로 돈다 — `tests/e2e/i1/**`이 `s05`·`s06`보다 먼저 돈다. I1 시험이 출력 기기·멈춤·버릴 라벨·대기를 남기면 뒤 시험의 콘솔 알림 띠에 "출력 멈춤 · …"·"버릴 라벨 N"이 보이고 Alt+1이 그 창을 먼저 연다(기존 S05·S06 시험이 "알림 없음"·Alt+1 순서를 본다). 시험 끝에 정리해 주세요: `POST /api/print/device/release {}` → `POST /api/print/jobs/cancel-all {confirm:true}` → `GET /api/print`의 `discard`마다 `POST /api/print/jobs/discard {date,id}` → 멈춰 있으면 `POST /api/print/restart {}`(끊김 멈춤은 출력 기기를 비우면 풀린다), 자동 출력을 껐으면 `PATCH /api/settings {settings:{'print.autoOnConfirm':true}}`.
