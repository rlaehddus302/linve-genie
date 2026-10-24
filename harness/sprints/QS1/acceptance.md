# QS1 수용 기준 — 프린터 다시 잇기 보완 · 서버 한도 두 가지 · 스펙 정리

- 스프린트: QS1 (6단계, 조사·위험 지적 정리 — **새 화면 문장 없음**) · spec ID: **LBL-06**(B1 직접 출력 — 다시 잇기), **LBL-08**(출력 기기·대기열), **SYS-02**(판매자 격리 — 실시간 연결), **YT-10**(확장 연결 코드), **NFR-01**(실시간 1초)
- 근거 결정: **D-QS1-01~D-QS1-09**(AUTO 2026-10-25), RL1 기록 **D-RL1-01~D-RL1-03**(done). 규칙 문장: LABEL_RULES v0.2.7 L-7("블루투스 켜짐 확인"·"마지막 프린터 기억")·L-11 8("저절로 다시 잇기")·L-12 3, SPEC v0.1.40 §3 실시간 줄·LBL-06 "다시 잇기"·YT-10 AC4 "코드 넣기 한도".
- 개발 영역(순서, D-QS1-09): **device → server → web**(web은 `apps/web/src/lib/printer-station.ts` 한 파일). 시험: **domain**, **e2e**(프린터 연결은 시험용 프린터·가짜 B1 블루투스·가짜 USB 포트로).
- 태그: `[device]` = dev-device, `[server]` = dev-server, `[web]` = dev-web, `[domain]` = test-domain, `[e2e]` = test-e2e, `[spec]` = spec-keeper.

## 금지 경로

이 스프린트의 어떤 커밋도 아래를 **고치지 않는다**(읽기·기존 export의 import는 된다). 고쳐야만 할 것 같으면 고치지 말고 `harness/sprints/QS1/dev-notes.md`와 `disputesWithSpec`으로 올린다.

1. **MOB1 작업 중인 화면 파일** (다른 작업 폴더가 같은 시각에 고친다 — D-QS1-09): `apps/web/src/**` 가운데 `apps/web/src/lib/printer-station.ts`를 뺀 **모든 파일**. 특히 `apps/web/src/styles.css`, `apps/web/src/lib/print-words.ts`, `apps/web/src/components/PrintParts.tsx`, `apps/web/src/components/LabelsPage.tsx`, `apps/web/src/components/wizard/PrinterStep.tsx`, `apps/web/src/components/WizardPage.tsx`, `apps/web/src/components/TopBar*`, `apps/web/src/components/ConsolePage*`.
2. **유튜브** (맥북 쪽 작업): `apps/server/src/youtube/**`, 이름에 `youtube`·`Youtube`가 든 `apps/web/src/**` 파일, `tests/e2e/y1/**`.
3. **기존 E2E 폴더**: `tests/e2e/qs1/**` 밖의 E2E 파일은 고치지 않는다(MOB1이 화면 낱말을 바꾸며 손댈 수 있다).
4. `packages/core/**`, `tests/golden/**`(이번 스프린트는 판정·정산·파서 규칙 변경이 없다 — 골든 없음).

## 모호한 점 → 결정 → 수용 기준

| 조사·지적 | 결정 | 수용 기준 |
|---|---|---|
| A(1) 마지막 기기 기억·"다시 연결"에 고르기 창 없이 | D-QS1-01 | AC-QS1-01~03·05·20·21·41·42 |
| A(1) 끊기면 간격을 늘려 저절로 다시 잇기(상한)·이중 출력 없음 | D-QS1-02 | AC-QS1-22~24·30·40·41·44 |
| A(2) USB `getPorts()` 새로고침 뒤 다시 열기, 블루투스 `getDevices()`는 있을 때만 | D-QS1-01 (3) | AC-QS1-04·05·42 |
| A(3) 윈도우 크롬 `getAvailability()` 오판 | D-QS1-03 | AC-QS1-06·43 |
| 새 화면 문장 | D-QS1-05 (이번엔 없음, MOB1 뒤 후속) | AC-QS1-24 |
| B RA-QL-02 실시간 연결 쌓이는 양·연결 수 | D-QS1-04 | AC-QS1-10~13·31 |
| B RA-QL-03 확장 연결 코드 서버 전체 한도 | D-QS1-06 | AC-QS1-14·15·32 |
| C RL1 기록 | D-RL1-01~03 | (스펙·백로그 — 아래 표) |
| C techDebt 정리 | D-QS1-08 | (백로그 — 아래 표) |
| C AC-FB1-39 웹 단위 시험 누락 | D-QS1-07 | AC-QS1-26 |

## 이번 스프린트의 스펙·골든 변경 (spec-keeper)

| 파일 | 변경 |
|---|---|
| `docs/DECISIONS.md` | 새 절 "진짜 로그인 시험 모드·윈도우 연습 모드 (RL1 기록)" D-RL1-01~03(done), "프린터 다시 잇기·서버 한도·정리 (QS1 자율 결정)" D-QS1-01~09. AUTO 검토 목록, "사용자 확인 필요" 표에 프린터 다시 잇기·실시간 연결·확장 코드 한도·진짜 로그인 시험 모드 세 줄, 막힌 항목 없음 줄(QS1) |
| `docs/spec/LABEL_RULES.md` | v0.2.7 — L-7 연결 예외 문장, "블루투스 켜짐 확인", "마지막 프린터 기억"; L-11 8 "저절로 다시 잇기"; L-12 3 `getAvailability()` 문장 |
| `docs/spec/SPEC.md` | v0.1.40 — §3 실시간 연결 한도, LBL-06 "다시 잇기", YT-10 AC4 "코드 넣기 한도" |
| `harness/backlog.yaml` ([harness] 커밋 따로) | RL1(done) 기록, QS1(doing), `techDebt`에서 해결된 항목을 `techDebtResolved`로 옮김(D-QS1-08) |
| `tests/golden/**` | 변경 없음 — 판정·정산·파서·라벨 글 규칙이 바뀌지 않는다(연결·다시 잇기·서버 한도는 골든 대상이 아니라 단위·적대·E2E로 고정) |

## 공통 전제

- 이미 합쳐진 모든 결과가 그대로 유지된다. 외부 계정·실기기 없이 돈다(가짜 B1 블루투스 기기·가짜 niimbluelib 클라이언트·가짜 USB 포트·시험용 프린터, 가짜 시계·주입한 타이머).
- **새 화면 문장이 없다**(D-QS1-05). 화면에 보이는 글은 지금 있는 문장(L-7 오류 표, "다시 연결", 연결 상태 낱말)뿐이다.
- 기존 시험의 기대값 교체는 이 스프린트가 바꾼 동작에 한한다 — 바꾼 곳마다 근거 결정 번호를 주석으로(`// QS1 D-QS1-0x`). 알려진 곳: `packages/printer/test/b1.test.ts`("getAvailability false면 BLUETOOTH_OFF, 클라이언트를 만들지 않는다"), `packages/printer/test/fb1-connect.test.ts` (e), `packages/printer/test/marklife.test.ts`(블루투스 꺼짐 줄) — "정말 꺼짐"(시도도 실패)은 `BLUETOOTH_OFF`로 계속 확인하고, "false인데 시도는 됨"을 새로 확인한다. 그 밖의 기존 시험은 바꾸지 않는다.
- 각 dev는 바뀐 공개 모양(어댑터 계약에 더한 것·가짜 기기 옵션·시험 손잡이·서버 오류 코드·로그 코드)을 `harness/sprints/QS1/dev-notes.md`에 먼저 적고 시작한다.
- 시간을 기다리는 동작(다시 잇기 간격·60초·10분)은 주입한 타이머·가짜 시계로 시험한다(진짜로 기다리지 않는다). 성능 시험은 만들지 않는다.

## 파일 경계 (개발 순서 device → server → web)

| 영역 | 고치는 곳 | 고치지 않는 곳 |
|---|---|---|
| device | `packages/printer/src/**`(`niimbot.ts`·`bluetooth.ts`·`adapter.ts`·`marklife.ts`·`fake.ts`·`fake-bluetooth.ts`·`index.ts`, 필요하면 새 `fake-serial.ts`), `packages/printer/test/**` | 다른 패키지 |
| server | `apps/server/src/hub.ts`, `apps/server/src/extension/**`(`routes.ts`, 필요하면 `service.ts`), 필요할 때만 한 줄: `apps/server/src/api.ts`(실시간 열기)·`apps/server/src/login-limit.ts`(도움 함수), `apps/server/test/qs1-*.test.ts` | `apps/server/src/youtube/**`, DB 스키마·마이그레이션(필요 없음 — 믿는 주소는 메모리) |
| web | `apps/web/src/lib/printer-station.ts` **한 파일**, `apps/web/test/printer-station.test.ts`, 새 `apps/web/test/qs1-*.test.ts(x)` | 금지 경로 1의 모든 화면 파일 |
| domain | `tests/adversarial/qs1/**` | 기존 적대 시험 |
| e2e | `tests/e2e/qs1/**` | 기존 E2E 폴더 |

## 수용 기준

### A. 프린터 어댑터 (device)

**AC-QS1-01** [device] · LBL-06 · D-QS1-01 — 마지막 프린터로 다시 잇기 (블루투스)
- Given 가짜 B1 블루투스 기기로 B1 어댑터가 고르기 창을 거쳐 연결에 성공함(고르기 창 1번) · When 기기 쪽에서 연결이 끊긴 뒤(상태 `DISCONNECTED`) 어댑터의 "다시 연결"(기억 우선 잇기)을 부름
- Then 고르기 창(`requestDevice`)은 여전히 1번이고, niimbluelib 클라이언트의 `connect`가 첫 연결 때 고른 **같은 기기 객체**를 `authorizedDevice`로 받으며, 상태가 `CONNECTING` → `CONNECTED`
- Then 연결 방법 연결(`connect('bluetooth')` — 화면의 "블루투스로 연결")을 부르면 기억이 있어도 고르기 창이 한 번 더 뜬다(2번)
- 확인: 단위 시험(`packages/printer/test/`)

**AC-QS1-02** [device] · LBL-06 · D-QS1-01 (1)(4) — 기억하는 것과 잊는 것
- (a) Given 첫 연결이 실패함(`CONNECT_FAILED` — 첫 확인이 두 번 답하지 않음, `NOT_SELECTED`, `PORT_BUSY` 각각) · When "다시 연결" · Then 고르기 창이 뜬다(기억 없음 — AC-FB1-40 그대로)
- (b) Given `WRONG_MODEL`로 끝난 연결 · When "다시 연결" · Then 고르기 창이 뜬다
- (c) Given 기억한 기기가 있음 · When 기억한 기기로 이은 시도가 실패(첫 확인 시간 초과 → 1초 뒤 한 번 다시 → 또 실패, 즉 FB1 다시 잇기 포함 1번의 시도로 센다) · Then 결과는 지금과 같은 `CONNECT_FAILED`(자세히 "프린터가 답하지 않아 기다리는 시간이 지났어요. 한 번 더 해 봤지만 안 됐어요.")이고, 다음 "다시 연결"은 고르기 창부터
- (d) 연결에 성공할 때마다 기억은 그 기기로 바뀐다(다른 B1을 고르면 그 B1)
- 확인: 단위 시험

**AC-QS1-03** [device] · LBL-06 · D-QS1-01, L-7 — 기억한 기기로만 잇기 (고르기 창 없음)
- Given 기억한 기기가 없음 · When "기억한 기기로만 잇기"(저절로 다시 잇기가 쓰는 길)를 부름 · Then `requestDevice`·`requestPort`를 부르지 않고 실패(`DISCONNECTED`), 상태 `DISCONNECTED`
- Given 기억한 기기가 있음 · When 같은 길 · Then 고르기 창 없이 그 기기로 잇는다(AC-QS1-01과 같은 결과)
- 연결 중에 같은 길·"다시 연결"·연결 방법 연결을 또 부르면 같은 시도를 기다린다(시도는 하나 — 지금 `connect` 규칙 그대로). 쉬는 동안·잇는 동안 "연결 끊기"를 부르면 그 시도는 붙지 않고 `DISCONNECTED`(지금 `generation` 규칙 그대로)
- 시험용 프린터(`createFakePrinter`)도 같은 계약을 지킨다 — 한 번 연결한 뒤엔 기억한 기기로만 잇기가 성공하고, 한 번도 연결하지 않았으면 실패
- 확인: 단위 시험

**AC-QS1-04** [device] · LBL-06 · D-QS1-01 (2)(3) — USB(Web Serial)
- Given USB로 연결에 성공함(가짜 포트 — 제조사 번호·제품 번호가 있음) · When 포트가 끊긴 뒤 "다시 연결" · Then `requestPort`를 부르지 않고 niimbluelib 시리얼 클라이언트의 `connect`가 같은 포트 객체를 `authorizedPort`로 받는다
- Given 새로고침 뒤(어댑터를 새로 만들고, 기억한 값 = 연결 방법 `serial` + 제조사·제품 번호를 넘김) · When "다시 연결"
  - `getPorts()`에 같은 번호의 포트가 **정확히 하나** → `requestPort` 없이 그 포트로
  - 같은 번호가 0개 또는 2개 이상 → `requestPort`(고르기 창). "기억한 기기로만 잇기"는 `requestPort` 없이 실패(`DISCONNECTED`)
  - `getPorts`가 없거나 예외 → 고르기 창(기억한 기기로만 잇기는 실패)
- 어댑터는 연결에 성공하면 기억할 값(연결 방법, USB 제조사·제품 번호 / 블루투스 기기 ID)을 부르는 쪽이 읽을 수 있게 내준다(이름은 dev-notes). 그 값에 기기 이름·판매자 정보는 없다
- 확인: 단위 시험(가짜 `navigator.serial` — `getPorts`·`requestPort`·포트 `getInfo`·끊김)

**AC-QS1-05** [device] · LBL-06 · D-QS1-01 (3) — 블루투스 `getDevices()`는 있을 때만
- Given 새로고침 뒤 기억한 블루투스 기기 ID가 있음 · When "다시 연결"
  - 환경에 `getDevices`가 있고 같은 ID의 기기를 돌려줌 → `requestDevice` 없이 그 기기를 `authorizedDevice`로
  - `getDevices`가 없음·예외·같은 ID 없음 → `requestDevice`(고르기 창). "기억한 기기로만 잇기"는 시도 없이 실패
- 확인: 단위 시험

**AC-QS1-06** [device] · LBL-06 · D-QS1-03, L-7·L-12 3 — `getAvailability()`가 false여도 한 번 시도
- (a) Given `getAvailability()` false, 고르기 창에서 B1을 고르면 이어지는 가짜(윈도우 오판) · When `connect('bluetooth')` · Then `CONNECTED`(오류 없음)
- (b) Given false, 시도도 실패(가짜 블루투스 장치가 꺼짐 — `requestDevice`가 `NotFoundError`, 또는 고르기 창을 닫음, 또는 GATT 연결 실패) · Then `BLUETOOTH_OFF`와 그 문장(L-7 표 그대로), 상태 `DISCONNECTED`
- (c) Given false, 첫 확인 시간 초과 → FB1 다시 잇기 한 번도 실패 · Then `BLUETOOTH_OFF`
- (d) `getAvailability()` true·예외·없음이면 지금과 같은 코드(`NOT_SELECTED`·`CONNECT_FAILED` 등)
- (e) Marklife·바우아토 어댑터(`createMarklifeAdapter`)도 (a)(b)와 같다
- 확인: 단위 시험. 기존 시험의 "false면 BLUETOOTH_OFF, 클라이언트를 만들지 않는다"는 (b)로 바꾸고 `// QS1 D-QS1-03` 주석

**AC-QS1-07** [device] · D-QS1-01~03 — 가짜 기기 (시험·개발용)
- 가짜 B1 블루투스(`createFakeNiimbotBluetooth`)에: 기기 쪽 끊김 일으키기, 다시 잇기를 거절/허락하기(전원 꺼짐 흉내), `getDevices` 있음/없음과 이미 허락된 기기, 블루투스 장치 꺼짐(시도도 실패)과 `getAvailability()` false 오판을 따로 고르기. 고르기 창 횟수·연결 시도 수·이어져 있는지를 지금처럼 센다
- 가짜 USB 포트: `getPorts`·`requestPort`·제조사·제품 번호·끊김·다시 꽂음
- 가짜 Web Bluetooth(`createFakeBluetooth`, Marklife)에 `getAvailability()` false 오판과 장치 꺼짐을 따로 고르기
- 시각·난수를 쓰지 않는다. 제품 목록·운영 기동에 나오지 않는다(지금 가짜 기기 규칙 그대로)
- 확인: 단위 시험(가짜 기기 자체 시험), 옵션 이름은 dev-notes

### B. 서버 한도 (server)

**AC-QS1-10** [server] · SYS-02·NFR-01 · D-QS1-04 (1)(3) — 연결마다 쌓이는 양
- Given 같은 판매자의 실시간 연결 A(응답 본문을 읽지 않음)와 B(읽음) · When 알림을 계속 보내 A에 아직 내보내지 못한 글이 1 MiB(1,048,576바이트)를 넘음
- Then A만 닫히고(본문 끝) 허브의 연결 수에서 빠진다. B는 닫히지 않고 그 뒤 알림도 모두 받는다(빠진 seq 없음)
- Then A의 판매자가 새로 연결하면 ready의 범위별 seq는 지금 기록의 seq다(닫히기 전 알림이 반영됨 — 따라잡기)
- Then 서버 로그에 그 판매자 ID와 까닭 코드 한 줄(알림 내용·세션·쿠키 없음)
- 확인: 서버 시험(`apps/server/test/qs1-*.test.ts`)

**AC-QS1-11** [server] · D-QS1-04 (1) — ready 전 모인 알림도 같은 한도
- Given 범위 seq 읽기를 붙잡아 둔 새 연결 · When 그동안 같은 판매자에게 1 MiB가 넘는 알림이 모임 · Then 읽기가 끝나면 그 연결은 ready 없이 닫힌 응답이고, 모아 둔 알림이 메모리에 남지 않는다(`pendingSize` 0). 같은 판매자의 다른 연결은 그대로
- 확인: 서버 시험

**AC-QS1-12** [server] · SYS-02 · D-QS1-04 (2)(4) — 판매자마다 30개, 넘으면 가장 오래된 것부터
- Given 판매자 P의 연결 30개(1번이 가장 먼저 연 것, 그중 하나는 출력 기기 ID를 밝힘), 판매자 Q의 연결 30개 · When P가 31번째 연결을 엶
- Then P의 1번 연결이 닫히고 31번째가 ready를 받는다. P의 연결 수는 30. Q의 30개는 하나도 닫히지 않는다
- Then 범위를 읽는 중인 연결도 30개에 센다(읽는 중 31번째가 생기면 가장 오래된 것부터 닫는다 — 열린 연결이 먼저)
- Then 닫힌 연결이 출력 기기 ID를 밝힌 것이면 지금처럼 `onDevice`로 닫힘을 알리고 `deviceLive`가 false(다시 열면 true)
- 확인: 서버 시험

**AC-QS1-13** [server] · NFR-01 · D-QS1-04 — 정상 쓰임은 닫히지 않음
- Given 본문을 바로바로 읽는 연결 · When 알림 10,000개(합 1 MiB가 넘는 양)를 차례로 보냄 · Then 닫히지 않고 모두 순서대로 받는다(한도는 "안 읽고 쌓인 양"이지 보낸 양이 아니다)
- 기존 실시간 시험(ready·change·이름 붙은 알림·로그아웃 닫기·하트비트)은 그대로 통과한다
- 확인: 서버 시험

**AC-QS1-14** [server] · YT-10 · D-QS1-06 — 확장 연결 코드 넣기 한도
- (a) 주소마다 10분에 20번 — 21번째는 429 `EXT_CODE_LIMITED`(지금 문장). 10분이 지나면(가짜 시계) 다시 받는다 — 지금 그대로
- (b) 서버 전체 10분에 3,000번 — 믿는 주소가 아닌 주소들의 3,001번째는 429
- (c) Given 판매자 S가 주소 A에서 로그인해 "확장 연결" 코드를 만듦, 다른 주소 150개 이상이 서버 전체 3,000번을 다 씀 · When 주소 A에서 S의 맞는 코드로 `POST /ext/connect` · Then 200과 토큰. 같은 때 믿는 주소가 아닌 주소 B에서는 맞는 코드여도 429
- (d) 주소 A에서의 시도도 주소 A의 20번에는 센다. 믿는 주소의 시도는 전체 3,000번에 세지 않는다
- (e) 믿는 주소는 그 코드 만들기(또는 다시 만들기) 뒤 10분 동안만이다(10분 1초 뒤엔 보통 주소). 판매자마다 최근 3개 — 4번째 다른 주소에서 만들면 가장 오래된 주소가 빠진다. 다른 판매자의 믿는 주소와 섞이지 않는다
- (f) 앞단 프록시를 믿는 수(`trustedProxies`) 밖의 `X-Forwarded-For` 값으로는 믿는 주소가 되지 않는다(주소 읽기 규칙 그대로 — 만들 때와 넣을 때 같은 함수)
- (g) 연결 주소를 모르면(null) 주소 한도 없이 전체 한도만 — 지금 그대로
- 확인: 서버 시험

**AC-QS1-15** [server] · D-QS1-06, 절대 규칙 7 — 기록하지 않는 것
- 믿는 주소는 메모리에만 둔다(DB·로그 없음). 서버 로그에 코드·토큰·IP를 남기지 않는다(지금 그대로)
- 확인: 서버 시험(로그 수집기로 코드·토큰·주소 문자열이 없는지)

### C. 화면의 출력 기기 (web — `printer-station.ts`만)

**AC-QS1-20** [web] · LBL-06 · D-QS1-01 (2)(5) — "다시 연결"은 기억한 기기로
- Given 이 기기가 블루투스(가짜 B1)로 한 번 연결에 성공한 뒤 끊김 · When 화면의 "다시 연결"(`station.reconnect()`) · Then 고르기 창 횟수가 늘지 않고 연결됨
- When 연결 방법 단추 경로(`station.connect('bluetooth')`) · Then 고르기 창이 뜬다
- 확인: 웹 단위 시험(`apps/web/test/printer-station.test.ts` 또는 `qs1-*`)

**AC-QS1-21** [web] · D-QS1-01 (6) — 새로고침 뒤 기억
- 연결에 성공하면 브라우저 저장소(localStorage)에 연결 방법과 기기를 알아보는 값(블루투스 기기 ID, USB 제조사·제품 번호)만 저장한다. 그 값은 서버로 가는 어떤 요청 본문에도 없다
- Given 저장된 값이 있음(새 station) · When "다시 연결" · Then 그 값을 어댑터에 넘겨 AC-QS1-04·05대로(찾으면 고르기 창 없음, 못 찾으면 고르기 창)
- 기억한 시도가 실패하면(AC-QS1-02 (c)) 저장된 값도 지운다. 저장된 값이 깨졌으면(형식 밖) 없는 것으로 본다
- 페이지를 열 때(station을 만들 때) 스스로 잇지 않는다 — 연결 시도 0번(L-7 그대로)
- 확인: 웹 단위 시험

**AC-QS1-22** [web] · LBL-08 · D-QS1-02 (1)~(4), L-11 8 — 저절로 다시 잇기
- Given 이 기기가 출력 기기이고 프린터가 연결됨 · When 기기 쪽에서 끊김(판매자 조작 아님) · Then 주입한 타이머로 끊긴 때부터 1초·2초·4초·8초·16초·30초 뒤에 "기억한 기기로만 잇기"를 부른다(누적 1·3·7·15·31·61초). 다 실패하면 7번째는 없다(더 기다려도 0번)
- 다시 이어지면 그친다. 이어진 뒤 60초가 지나 끊기면 1초부터 새로 센다. 60초 안에 끊기면 남은 횟수로(예: 3번째 시도로 이어진 뒤 30초 만에 끊김 → 다음은 4번째 간격 8초, 남은 4번째~6번째)
- 기다리는 동안 "다시 연결"을 누르면 기다림이 없어지고 바로 한 번 잇는다(같은 때 두 번 잇지 않는다). 이어지면 그 연결부터 새로 센다. 그 시도가 실패하면 저절로 잇기도 그친다 — 판매자 조작의 실패는 지금처럼 오류 상자로 끝난다(그 뒤 기다리던 시도 없음)
- 그치는 때: "연결 끊기"(`station.disconnect()`), 다른 연결 방법으로 연결, 출력 기기에서 내려옴(출력 그만하기·다른 기기가 출력 기기가 됨), 라벨 기능 꺼짐. 그 뒤 기다리던 시도는 일어나지 않는다
- 출력 기기가 아닌 기기에서 끊기면 저절로 잇지 않는다(시도 0번). 시험용 프린터도 같은 규칙
- 확인: 웹 단위 시험(주입한 타이머)

**AC-QS1-23** [web] · LBL-08 · D-QS1-02 (5)(6), L-8 3·L-11 4·6 — 한 번에 하나, 다시 보내지 않음
- Given 출력 기기, 대기 3장 · When 1장째 결과(출력함)를 알린 뒤 2장째를 받기 전에 끊김 → 저절로 다시 이어짐 · Then 서버에 끊김(`connected: false`) 한 번, 이어짐(`connected: true`) 한 번을 알리고, 이어진 뒤 2장째·3장째를 한 장씩 받아 찍는다 — 1장째는 다시 찍지 않는다(찍은 횟수 각 1)
- Given 2장째를 찍는 중에 끊김 · Then 2장째 결과는 지금처럼 `DISCONNECTED`로 알리고, 다시 이어진 뒤 서버가 대기 맨 앞으로 돌린 2장째를 한 번 더 받는다(D-P1-09 그대로 — 그 밖의 장은 늘지 않는다)
- 다시 잇는 동안(기다림·시도) 받기(`claim`)를 하지 않는다. 연결 시도는 언제나 많아야 하나다
- 확인: 웹 단위 시험

**AC-QS1-24** [web] · D-QS1-05 — 새 문장 없음
- 기다리는 동안 station 상태는 `connection: 'DISCONNECTED'`(화면은 지금의 "프린터 연결이 끊겼어요."·해볼 일·"다시 연결"), 시도하는 동안은 `connecting: true`(지금의 "연결 중"). station 상태에 새 화면 문장 칸을 더하지 않는다(필요한 숫자 — 남은 횟수 등 — 는 더해도 되고, 화면은 이번에 쓰지 않는다)
- 확인: 웹 단위 시험

**AC-QS1-25** [web] · L-11 15 · D-QS1-01·02 — 시험 손잡이 (시험 모드만)
- E2E가 쓰는 시험용 프린터 손잡이(`TestPrinterHandle`)에 AC-QS1-07의 가짜 조작(가짜 B1 끊기·다시 잇기 거절/허락·`getDevices` 있음/없음과 허락된 기기·`getAvailability` 오판·장치 꺼짐, 가짜 USB 포트 꽂기)과 저절로 다시 잇기 시도 수를 더한다. 서버가 시험 모드가 아니면 손잡이가 없다(지금 규칙 그대로)
- 새로고침을 넘는 시험(AC-QS1-42)을 위해 "허락된 가짜 기기"는 시험 모드에서만 sessionStorage 등으로 이어 갈 수 있다(운영 코드 경로에는 없음)
- 확인: 웹 단위 시험, 이름은 dev-notes

**AC-QS1-26** [web] · UX-02 · D-QS1-07, AC-FB1-39 — 시작 마법사 프린터 단계 연결 실패 상자 (빠졌던 시험)
- Given 시작 마법사 프린터 단계(`PrinterStep`)를 그리고 연결 결과가 `CONNECT_FAILED`(윈도우 사용자 에이전트, USB 있음) · Then AC-FB1-38과 같다: 문장 "프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.", `list "해볼 일"`에 ①②③④⑤ 차례, 그 아래 "다시 연결" 하나, "자세히"에 쉬운 말만, 상자 안에 허용 밖 라틴 낱말 없음. 맥·USB 없음이면 ③④ 없음, 안드로이드면 ⑤ 없음. `DISCONNECTED`도 같은 목록
- 새 시험 파일(`apps/web/test/qs1-*.test.tsx`)만 쓴다. 화면 파일은 고치지 않는다. 지금 코드가 통과하지 못하면 고치지 않고 dev-notes·`disputesWithSpec`에 적는다(MOB1 뒤 후속 — D-QS1-07)
- 확인: 웹 단위 시험

### D. 적대 시험 (domain — `tests/adversarial/qs1/**`)

**AC-QS1-30** [domain] · D-QS1-01~03 — 어댑터·출력 기기 공격
- 끊김·다시 잇기·"다시 연결"·"연결 끊기"·연결 방법 연결·출력을 아무 순서·아무 때(쉬는 1초 안, 각 간격 안)에 섞어도: (1) 같은 때 연결 시도는 둘이 아니다, (2) 기억한 기기로만 잇기는 `requestDevice`·`requestPort`를 한 번도 부르지 않는다, (3) 끊김 한 번당 저절로 잇는 시도는 6번 이하이고 끝없이 되풀이하지 않는다(이었다 끊겼다를 60초 안에 계속해도 합 6번), (4) "연결 끊기" 뒤엔 저절로 이어지지 않는다, (5) 결과를 알린 장은 다시 찍지 않는다
- `getAvailability()` false·예외·느림(끝나지 않음은 아님)과 고르기 창 닫기를 섞어도 원래 예외 글이 오류 상세에 나오지 않는다(L-7 "자세히" 그대로)
- 확인: 적대 시험(속성 시험 가능, 주입한 타이머)

**AC-QS1-31** [domain] · D-QS1-04 — 실시간 연결 공격
- 한 판매자가 연결을 수백 번 열고 닫거나 읽지 않는 연결을 많이 열어도: 그 판매자의 열린 연결은 30개 이하, 연결마다 안 보낸 글은 한도 + 알림 하나 크기 이하, 다른 판매자의 연결은 닫히지 않고 알림을 하나도 놓치지 않는다(seq가 이어짐)
- 닫힌 뒤 다시 연 연결의 ready seq + 그 뒤 change로 서버 기록의 마지막 seq까지 빠짐없이 따라잡는다
- 확인: 적대 시험

**AC-QS1-32** [domain] · D-QS1-06 — 연결 코드 한도 공격
- 위조 `X-Forwarded-For`(믿는 수 밖)·IPv6 같은 /64 안 여러 주소·IPv4를 담은 IPv6 표기로 주소 한도를 피하지 못한다(같은 키). 보조자 계정·로그인하지 않은 요청은 코드를 만들 수 없어 믿는 주소를 만들 수 없다(지금 그대로). 한 판매자가 코드를 수십 번 다시 만들어도 믿는 주소는 3개 이하
- 믿는 주소에서 틀린 코드를 맞혀 보면 주소 한도 20번에 막힌다
- 확인: 적대 시험

### E. E2E (`tests/e2e/qs1/**`, `@printer`)

**AC-QS1-40** [e2e] · LBL-08 · D-QS1-02 — 시험용 프린터: 끊겨도 저절로 이어서 출력
- Given 시험용 프린터로 연결하고 "이 기기에서 출력", 라벨 2장 출력함 · When 시험 손잡이로 끊김(`simulateDisconnect`) → 그동안 1등 찜 2개가 더 생김
- Then 아무것도 누르지 않아도 약 1초 뒤(시계를 당겨도 됨) 다시 이어져 새 2장이 찍힌다. 찍은 그림 수 = 4(앞 2장이 다시 나오지 않음)
- 확인: E2E

**AC-QS1-41** [e2e] · LBL-06 · D-QS1-01·02 — 가짜 B1: 고르기 창 없이 다시 잇기, 6번 뒤 그침
- Given 가짜 B1로 "블루투스로 연결"(고르기 창 1번) → 출력 기기 · When 기기 쪽 끊김, 다시 잇기 거절(전원 꺼짐) · Then 저절로 잇기 시도가 6번 있고 그친다(시계를 61초 넘게 당긴 뒤 더 당겨도 7번째 없음). 화면에 "프린터 연결이 끊겼어요."와 "다시 연결"
- When 다시 잇기를 허락하고 "다시 연결"을 누름 · Then 연결됨, 고르기 창은 여전히 1번
- 확인: E2E

**AC-QS1-42** [e2e] · LBL-06 · D-QS1-01 (3) — 새로고침 뒤 "다시 연결"
- Given 가짜 B1(허락된 기기·`getDevices` 있음)로 연결해 출력 기기가 됨 · When 페이지를 새로고침 · Then 저절로 연결하지 않는다(연결 시도 0). "다시 연결"을 누르면 고르기 창 없이 연결됨
- Given `getDevices` 없음 · When 같은 흐름 · Then "다시 연결"에 고르기 창이 한 번 뜬다
- (USB 가짜 포트가 시험 손잡이로 있으면) Given 같은 제품 포트 하나 · Then 새로고침 뒤 "다시 연결"에 고르기 창 없음
- 확인: E2E

**AC-QS1-43** [e2e] · LBL-06 · D-QS1-03 — 윈도우 블루투스 오판
- Given 가짜 B1에 `getAvailability()` false 오판(실제로는 이어짐) · When "블루투스로 연결"하고 B1을 고름 · Then 연결됨, "블루투스가 꺼져 있어요" 문장이 없다
- Given 블루투스 장치 꺼짐(시도도 실패) · Then "블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요."
- 확인: E2E

**AC-QS1-44** [e2e] · L-11 8 · D-QS1-02 (1) — 출력 기기가 아니면 저절로 잇지 않음
- Given 가짜 B1(또는 시험용 프린터)로 연결했지만 "이 기기에서 출력"을 누르지 않음 · When 끊김 → 시계를 61초 넘게 당김 · Then 저절로 잇는 시도 0번, 화면은 끊김과 "다시 연결"
- 확인: E2E

## 이번 스프린트에서 하지 않는 것 (범위 밖)

- **새 화면 문장**(저절로 다시 잇는 중·그쳤음 안내) — D-QS1-05, MOB1 합친 뒤 후속. 화면 파일(금지 경로 1)은 고치지 않는다.
- 페이지를 열 때 스스로 프린터에 잇기(L-7 그대로 — 판매자가 "다시 연결"을 한 번 누른다).
- Marklife·바우아토 어댑터의 기기 기억·저절로 다시 잇기(화면에 아직 연결 단추가 없다). 그 어댑터는 D-QS1-03만.
- 출력 기기가 아닌 기기의 저절로 다시 잇기, 끊긴 출력 기기의 작업을 다른 기기로 넘기기(L-11 10 그대로).
- 서버 전체(모든 판매자 합) 실시간 연결 수 상한, 여러 서버 인스턴스 사이 공유(컨테이너 1개 — hub.ts 머리말 그대로).
- 확장 팝업·확장 코드 형식(8자리·10분·한 번만) 변경, 믿는 주소의 DB 저장.
- 판정·정산·파서·라벨 글 규칙과 골든 변경, `packages/core/**`.
- 실제 B1·실제 윈도우 노트북 확인(HG-2, 사용자 확인 필요 표 "프린터 다시 잇기 (QS1)").
- 유튜브 관련 모든 파일(금지 경로 2).
