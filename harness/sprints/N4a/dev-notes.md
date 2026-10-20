# N4a 개발 노트

## dev-server

### 바뀐 계약 (화면·E2E가 먼저 알아야 할 것)
I1 계약(`harness/sprints/I1/dev-notes.md` "dev-server > 바뀐 계약")은 그대로이고 아래가 더해진다. **라벨 기능이 켜진 판매자(기본)에게는 응답·알림 모양이 `labelsEnabled: true` 한 칸 더해진 것 말고는 I1과 같다**(AC-N4a-40). 새 경로도 로그인·`Origin`·JSON·64KB 검사(`/api` 공통)를 그대로 받는다. 오류 본문은 기존과 같은 `{ error: { code, message, problems? } }`이고 받은 값을 되돌려 보내지 않는다.

#### 1. 켬/끔 조회·바꾸기 (AC-N4a-01·02·41)
| 경로 | 본문 | 응답 |
|---|---|---|
| `GET /api/settings/labels` | | `LabelSettings` |
| `PUT /api/settings/labels` | `{ enabled: boolean }` | `LabelSettings & { changed: boolean }` — `changed: false`면 지금과 같은 값이라 아무것도 바뀌지 않았다(이력 없음·알림 없음) |

```ts
LabelSettings = {
  enabled: boolean,          // 라벨 기능 켬(true)/끔(false). 기록이 없는 판매자는 true
  history: LabelSwitchEntry[], // 바꾼 기록 최근 20줄, 새것 먼저. 없으면 []
  waiting: number,           // 지금 대기 작업 장 수 — 끄기 확인 창의 "출력 대기 중인 라벨 N장은…"(N ≥ 1일 때만 그 문장)
  rev: number,               // 출력 기록 판 (I1 queue.rev와 같은 수) — 이 값을 읽은 때
}
LabelSwitchEntry = { enabled: boolean /* 바뀐 값 */, at: string /* UTC ISO — 화면이 KST로 "2026-10-20 (화) 20:31" */, loginId: string /* 바꾼 계정의 로그인 아이디 */ }
```
- 본문은 `enabled` 하나만: 불리언이 아니거나 없으면 400 `INVALID_INPUT`(problems `[{ field: 'enabled', message: '라벨 기능은 켜기나 끄기로만 정할 수 있어요.' }]`), 다른 칸이 있으면 400 `UNKNOWN_FIELD`(I1 출력 API와 같은 형식). 판매자를 고르는 칸은 없다 — 로그인한 판매자 자기 것만.
- 응답은 저장(커밋)된 뒤에만 200이다. 값이 실제로 바뀐 요청만 이력 한 줄을 남긴다. 이력을 지우는 경로는 없다.
- `/api/settings`(판매 규칙 설정)는 그대로다: 응답에 켬/끔 키가 없고, `PATCH /api/settings`로 켬/끔 키를 보내면 지금처럼 모르는 키로 거절된다. 방송 시작 스냅샷(`broadcast.start`)에도 들어가지 않는다.

#### 2. 출력 개요·알림에 켬/끔 (AC-N4a-02 "처음 화면을 열 때 한 번의 조회로")
- `QueueSummary`에 **`labelsEnabled: boolean`** 한 칸이 더해진다. `GET /api/print`의 `queue`, 모든 `event: print` 알림의 `queue`, 출력 기기·멈추기·다시 시작·출력 그만하기·모두 빼기 응답의 `queue`에 들어 있다. 화면은 처음에 `GET /api/print` 한 번(또는 `GET /api/settings/labels`)으로 켬/끔을 안다.
- 켬/끔이 실제로 바뀌면 그 판매자의 모든 실시간 연결에 두 알림이 간다:
  1. 새 이벤트 **`event: labels`** `data: { rev, enabled, entry: LabelSwitchEntry }` — 커밋 직후 바로. `rev`는 바뀐 때의 출력 기록 판. 같은 화면이 이미 이보다 큰 `rev`의 `queue.labelsEnabled`를 받았으면 버려도 된다.
  2. 이어서 I1과 같은 `event: print` `{ rev, queue, jobs: [], labels: [] }` — `queue.labelsEnabled`가 바뀐 값이고, 켤 때 대기열이 판매자 멈춤(쌓인 라벨)으로 바뀌었으면 그것도 들어 있다.
- 다른 판매자의 연결은 아무것도 받지 않는다.

#### 3. 꺼져 있을 때 거절 — `LABELS_OFF` (AC-N4a-05·20, L-12 5)
- 409 `{ error: { code: 'LABELS_OFF', message: '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.' } }`
- 거절하는 경로: `POST /api/print/labels/print`(라벨 출력), `POST /api/print/labels/reprint`(다시 출력), `POST /api/print/packing`(포장 라벨 출력), `POST /api/print/device`(이 기기에서 출력 — 같은 기기의 다시 알림·바꾸기 포함), `POST /api/print/claim`(출력 기기의 작업 받기), `POST /api/print/restart`(다시 시작·출력 시작 — 멈춰 있지 않아도), `PUT /api/print/templates/:kind`(라벨 설정 저장).
- 거절하면 작업·시도·요청 번호·대기열·출력 기기·템플릿 어느 것도 바뀌지 않는다. 거절된 요청 번호는 기억하지 않는다 — 켠 뒤 같은 요청 번호로 다시 보내면 처음 보낸 것처럼 처리된다.
- 순서: 본문 형식 검사(400) → (출력·다시 출력·포장) 켜 있을 때 이미 처리한 같은 요청 번호면 I1처럼 처음 결과 → 리허설(422 `PRINT_REHEARSAL` — 리허설 거절이 먼저)·없는 방송(404) → `LABELS_OFF`. `claim`은 출력 기기가 아니어도 꺼져 있으면 `LABELS_OFF`다.
- 꺼져 있어도 받는 것(I1 그대로): `POST /api/print/jobs/discard`(버렸어요), `POST /api/print/result`(이미 받은 시도의 결과 — 출력함이면 엔진 보고), `POST /api/print/jobs/cancel`·`cancel-all`(빼기), `POST /api/print/pause`(출력 멈추기), `POST /api/print/device/release`(출력 그만하기), `POST /api/print/device/state`(프린터 연결 알림), 모든 `GET`, `PUT /api/settings/labels`.

#### 4. 끌 때·켤 때 서버가 하는 일 (AC-N4a-03·04·06·07)
- 끈 동안 기록된 이벤트의 `PRINT_PRODUCT_LABEL` 효과는 출력 작업이 되지 않는다(라벨 키도 만들지 않는다). 나중에 켜도 그 효과로 작업을 만들지 않는다. 엔진·효과·발송함 행·감사 메시지는 켬/끔과 상관없이 같다.
- 폐기(1등이 아니게 됨·`VOID_LABEL`)와 버릴 라벨은 꺼져 있어도 그대로다.
- 끌 때: 대기 작업·출력 중인 한 장·출력 기기 지정·멈춤을 바꾸지 않는다. 출력 기기의 받기는 `LABELS_OFF`, 이미 받은 시도의 결과는 받는다.
- 켤 때: 대기 작업이 있고 대기열이 멈추지 않았거나 끊김 멈춤이면 `queue.pause = { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true }`(화면: "대기 중인 라벨 N장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요." + "출력 시작" = `POST /api/print/restart`). 판매자·프린터 오류·라벨 오류 멈춤이면 그대로, 대기 작업이 없으면 대기열을 바꾸지 않는다.
- 켠 뒤 "라벨 출력"(손으로): 그 라벨 키(찜, 확정버전)에 끈 동안 나온 `PRINT_PRODUCT_LABEL` 효과가 있으면 라벨 키를 그 효과와 묶는다 — 작업 `reason`은 `manual`이고, 출력함이 되면 서버가 그 효과의 `effect.labelPrinted`를 한 번 기록한다(잠금). 끈 동안 1등이 된 상품은 켠 뒤 `GET /api/print/labels`에서 `state: 'NONE'`, `canPrint: true`다.

#### 5. 화면(dev-web)·E2E에게
- 화면은 `labelsEnabled`(또는 `GET /api/settings/labels`의 `enabled`)를 **알기 전에는 라벨 조작을 숨긴다**. 출력 기기도 켬/끔을 알기 전에는 받지 않는다(서버도 꺼져 있으면 받기를 거절한다).
- 출력 기기 화면: `labels` 알림(`enabled: false`) 또는 `queue.labelsEnabled: false`를 받으면 새 받기를 멈추고, 이미 받은 한 장은 마저 출력해 `POST /api/print/result`를 보낸다. `claim`이 409 `LABELS_OFF`를 받아도 같다(늦게 안 경우).
- 오래된 화면이 라벨 요청을 보내 409 `LABELS_OFF`를 받으면 그 문장을 보이고 켬/끔을 다시 불러온다(저절로 다시 보내지 않는다).
- E2E가 켬/끔을 바꿀 때는 `PUT /api/settings/labels`를 쓰면 된다(`Origin`은 앱 주소, JSON).

### 만든 것 (apps/server)
- 마이그레이션 `drizzle/0004_n4a_label_switch.sql`(새 파일 하나): `print_queues.labels_enabled boolean not null default true`(지금 값 — 이 칸이 생기기 전의 줄도 켬), 새 표 `label_switches`(바꾼 기록: 판매자·바뀐 값·바꾼 계정·시각, 지우지 않는다). `src/db/schema.ts`와 같다(`test/schema.test.ts`). `sellers.settings`·`outbox`는 바꾸지 않았다.
- `print-store.ts`: `createAutoJobs`가 잠근 대기열 줄의 `labelsEnabled`가 끔이면 라벨 키·작업을 만들지 않는다(이벤트 기록 트랜잭션 안 — txHook은 미리 읽은 값을 받지 않는다). `labelsOff`(미리 거르기용 읽기), `bindLabelEffect`, `insertLabelSwitch`, `labelSwitchHistory`.
- `print.ts`: `QueueSummary.labelsEnabled`, `labelSettings`·`setLabels`(켜기·끄기·이력·알림, 켤 때 쌓인 라벨 멈춤), 7가지 요청의 `LABELS_OFF` 거절(미리 거르기 + 잠근 트랜잭션 안에서 다시 확인), 손으로 출력의 효과 묶기.
- `print-api.ts`: `GET·PUT /api/settings/labels`, `claim`의 `LABELS_OFF`. `hub.ts`: `publishLabels`(event `labels`). `errors.ts`: `LABELS_OFF`.

### 규칙 문장 안에서 정한 것 (구현 선택)
- **지금 값을 판매자 대기열 줄의 칸에 둔다**: 출력 기록을 바꾸는 트랜잭션(효과 → 작업, 손으로 출력·다시 출력·포장, 받기, 결과, 출력 기기, 다시 시작, 템플릿 저장)이 모두 이 줄을 먼저 `FOR UPDATE`로 잠근다. 켜기·끄기도 같은 줄을 잠그므로 "바꾸기 응답 뒤에 기록된 이벤트는 바뀐 값을 따른다"(L-12 3)가 잠금 하나로 지켜지고, 잠금 순서가 늘 같아 교착이 없다. 따로 표를 두면 두 줄을 잠가야 해 순서를 맞춰야 한다.
- **꺼져 있으면 라벨 키도 만들지 않는다**: 끈 동안 1등이 된 상품은 라벨 키가 없어 `GET /api/print/labels`가 I1처럼 "작업 없는 지금 1등"(`state: 'NONE'`, `canPrint: true`)으로 보인다. 켠 뒤 "라벨 출력"이 처음 라벨 키를 만들고 구매자는 그 순간의 L-9 구매자다(L-11 3).
- **손으로 출력의 효과 묶기**는 그 범위의 엔진 상태에서 `listEffects`로 (찜, 확정버전)의 `PRINT_PRODUCT_LABEL`을 찾는다(코어 조회 함수 — 서버가 판정하지 않는다). L-11 3 문장대로 켬/끔 이력과 상관없이 묶는다 — 켜 둔 채 자동 출력하는 판매자는 그 라벨 키에 자동 작업이 이미 있어 "라벨 출력"이 `PRINT_LABEL_EXISTS`이므로 I1 동작은 바뀌지 않는다. 라벨 키가 이미 있고 효과가 묶이지 않았으면 그때 묶는다.
- **거절의 차례**: 같은 요청 번호의 처음 결과(I1) → 리허설·없는 방송 → `LABELS_OFF` → 그 밖 I1 거절(1등 아님 등). 템플릿 저장은 형식 검사보다 `LABELS_OFF`가 먼저, `claim`은 출력 기기가 아니어도 `LABELS_OFF`, `restart`는 멈춰 있지 않아도 `LABELS_OFF`.
- **같은 값 끄기/켜기**: 대기열 줄이 없는 판매자의 "켜기"는 줄도 만들지 않는다(조회·같은 값 요청이 아무것도 쓰지 않는다). 응답 `changed: false`.
- **켤 때 쌓인 라벨**: 대기 작업이 있고 멈추지 않았거나 끊김 멈춤이면 `paused = SELLER, backlog = true`(출력 기기가 없어도). 출력 시작(`restart`)은 I1 그대로 — 출력 기기의 프린터가 끊겨 있으면 끊김 멈춤으로 바뀐다.
- **끈 동안 받기 응답을 잃은 장**: 꺼져 있으면 받기를 거절하므로 I1의 "같은 기기가 2초 뒤 다시 받기 = 같은 장을 새 표로"가 켜질 때까지 일어나지 않는다. 그 장은 켤 때까지 출력 중으로 남고, 켠 뒤 같은 기기의 받기에서 I1대로 되돌아 다시 나온다(빠지지 않는다). 같은 까닭으로 끈 동안 "출력 그만하기"를 누른 출력 기기는 그 장의 결과가 올 때까지 "그만하는 중"이다.

### 바꾼 기존 시험 (교체 — 약화 아님)
- `test/commands.test.ts`: 마이그레이션 명령 뒤 표 수 15 → 16(새 표 `label_switches`). 표 이름 목록은 여전히 스키마 전체와 대조한다.
- `test/print-support.ts`: 출력 개요 타입에 `labelsEnabled` 칸.

### 시험 (내 영역)
- `test/label-switch.test.ts` 22개 — AC-N4a-01(기본 켬·I1 판매자·마이그레이션 기본값·`/api/settings`에 없음·`broadcast.start` 키 같음·재시작·격리), 02(바뀔 때만 이력·20줄·지우는 경로 없음·본문 검사·공통 검사·동시 12번·실시간 두 연결·다른 판매자 없음·로그), 03(결정적 ID 두 세계에 같은 순서 — 첫 판정·문자찜·직접 배정·승계·재고 늘림 — 엔진 상태·이벤트·발송함 같고 작업만 다름, 알림 없음, 켬→끔→켬→끔 바꾼 때부터, 재전송, 트랜잭션 안 읽기 — 소스 검사 + 같은 트랜잭션에서 끈 값 + 기록 도중 끄기), 04(폐기·버릴 라벨·승계자 작업 없음·꺼진 채 버렸어요), 05(거절 11가지·표 그대로·리허설 먼저·켠 뒤 같은 요청 번호·켜 있을 때 처리한 요청 번호·받는 요청), 06(끌 때 대기 그대로·받기 거절·출력함 보고·켤 때 쌓인 라벨·출력 순서·실패·끊김·판매자 멈춤·대기 없음), 07(켠 뒤 손으로 출력 보고 한 번·재전송·다시 출력·재시작·잠금/비교: 자동 출력을 끈 방송은 보고 없음/취소·승계된 찜 거절), 41(격리).

### test-e2e에게
- 켜기·끄기: `PUT /api/settings/labels {enabled}` (`Origin` 앱 주소). 지금 값·이력: `GET /api/settings/labels`, 또는 `GET /api/print`의 `queue.labelsEnabled`.
- **시험 계정 하나를 모든 E2E가 함께 쓴다** — 끈 채로 끝내면 뒤 시험(I1·S05·S06)의 라벨 화면·출력이 모두 사라진다. 시험 끝에 I1 정리(출력 그만하기 → 모두 빼기 → 버렸어요 → 다시 시작)에 더해 **`PUT /api/settings/labels {enabled:true}`** 를 하고, 켜면서 대기 작업이 있으면 판매자 멈춤(쌓인 라벨)이 되므로 그 뒤 모두 빼기·다시 시작 순서로 정리해 주세요(켜기 → 모두 빼기 → 다시 시작).
- 켬/끔 조회를 늦추는 시험(AC-N4a-18·32)은 서버에 손잡이가 없다 — Playwright `page.route('**/api/settings/labels', …)`·`'**/api/print'`로 응답을 늦춘다. 화면이 켬/끔을 어느 조회로 아는지는 dev-web 절을 본다.
- 끈 동안 효과는 발송함(`outbox`)·엔진 효과로만 남는다 — 감사 메시지 효과 확인은 `GET /api/days/:date`의 `effects`(종류 `POST_THANKS`)로.
