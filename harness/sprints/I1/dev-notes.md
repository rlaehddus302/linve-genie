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
| `POST /api/print/claim` | `{ deviceId }` | `{ job: ClaimedJob }` 또는 `{ job: null, reason: 'PAUSED'\|'BUSY'\|'EMPTY' }` · 409 `PRINT_NOT_DEVICE` |
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
- **출력 기기가 되는 기기는 프린터가 연결된 것으로 본다**(화면은 연결한 뒤에만 "이 기기에서 출력"을 보인다). 바꾸기(replace)·새로 정하기는 끊김 멈춤을 푼다. 같은 기기가 다시 알리면 이름만 고치고 멈춤·프린터 연결 상태를 바꾸지 않는다.
- **새로 정하기 = 출력 기기가 없을 때**. 대기 작업이 있으면 판매자 멈춤 + `backlog: true`. 바꾸기(다른 기기가 출력 기기)는 멈추지 않고 이어서 출력한다(AC-I1-72 "휴대폰이 이어서 출력한다").
- **멈춤 우선**: 프린터 오류·라벨 오류는 지금 멈춤을 덮어쓴다(판매자 멈춤 포함). 끊김은 멈추지 않았을 때만 끊김 멈춤이 된다(손으로 푸는 멈춤 중에 끊겼다 이어져도 그대로). "다시 시작" 때 출력 기기의 프린터가 끊겨 있으면 끊김 멈춤으로 바뀐다. 출력 그만하기로 출력 기기가 비면 끊김 멈춤은 풀린다(다시 연결할 기기가 없다). 출력 멈추기는 이미 손으로 푸는 멈춤이면 그대로다.
- **받을 때 라벨 데이터를 만들 수 없으면**(일어나지 않아야 한다) 작업은 대기 맨 앞 그대로, 시도 +1, 마지막 오류 `INVALID_DATA`, 라벨 오류 멈춤.
- **결과 기록 후 출력함 작업의 마지막 오류는 지운다**(시도 수는 남는다).
- **손으로 출력의 거절**(규칙에 문장이 없다): 1등이 아니면 `PRINT_NOT_WINNER` "지금 1등이 아니라 라벨을 출력할 수 없어요.", 그 라벨 키에 작업이 있으면 `PRINT_LABEL_EXISTS` "이미 만든 라벨이에요. 다시 출력을 눌러 주세요." — 화면은 `canPrint`·`canReprint`로 단추를 고르므로 보통은 보이지 않는다.
- **다시 출력의 확인 순서**: 라벨 키 없음 → 아직 출력한 적 없음, 폐기 → 폐기, 대기·출력 중 → 기다리는 중, 작업 0개 → 아직 출력한 적 없음, 1등 아님 → 그 자리에서 폐기하고 "1등이 바뀐 라벨…". `version`이 없으면 그 찜의 가장 큰 확정버전 라벨 키.
- **포장 라벨**: 쪽 수는 요청 때의 포장 템플릿 `perPage`로 `computePackingText`가 나눈 쪽 수, 작업마다 그 `perPage`를 남기고 받을 때 템플릿의 `perPage`를 그 값으로 바꿔 준다(쪽 수가 받을 때 바뀌어 `1/2`·`2/3`이 섞이지 않게 — D-I1-10). 그 라벨 키에 대기·출력 중 작업이 있으면 `PRINT_IN_PROGRESS`. 라벨 키의 구매자 표시는 마지막 요청 때의 것.
- **템플릿**: 판 번호는 저장마다 +1(처음 0). 가게 이름 길이는 `trimLabelText` 뒤 `splitGraphemes` 글자 수. JSON 크기는 받은 템플릿 값의 `JSON.stringify` UTF-8 바이트. 받은 칸 이름은 영문 칸 이름(점으로 5단까지)일 때만 `problems[].field`에 되돌린다.
- **시도 표**는 18바이트 무작위(base64url), 서버가 만든 작업 ID는 `m-`(손으로)·`r-`(다시 출력)·`p-…-<쪽>`(포장) + 영문 소문자 20자(숫자가 없어 번호 모양이 될 수 없다).

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
