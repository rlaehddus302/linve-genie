# KP1 리포트 — 단골 만들기 (손님 장부·방송 리포트·방송 일정·문자 규칙)

**결과: PASS (조건부)** — 전체 `pnpm verify` 1회는 실패(KP1 원인 typecheck·lint·단위 2·e2e 다수 + 작업자 강제 종료 1)했고, 원인을 고친 뒤 실패한 단계·파일만 다시 돌려 모두 통과했다. 전체 verify를 처음부터 다시 돌리지는 않았다. 보호 경로 게이트는 이력 1건(a6f71c33)으로 실패.

- 브랜치 `sprint/KP1` (int/next f4b04dd7 + spec/retention-1 a621a720 합침), BASE `harness/sprints/KP1/BASE`(3b403c44)
- 개발: device · server(갈래 A 장부 / B 리포트·일정·메시지) · web(갈래 C 장부 화면 / D 리포트·일정 화면) — 공용 계약서 `contract.md`를 먼저 정하고 넷을 동시에
- 테스트: domain(`tests/adversarial/kp1/**`) · e2e(`tests/e2e/kp1/**`) · 감사: spec · risk(2라운드) · 사용성 1회
- 판정 엔진(`packages/core`)·엔진 골든 변경 없음. 문자·알림톡을 보내는 코드 경로 없음(바깥 연결 0번 시험). 유튜브 쓰기 없음.

## 영역별로 만든 것

- **device**: `packages/documents` `buildCustomersXlsx` — 손님 엑셀(CR-6 기본 9열, 고를 때만 연락처 열, 누적 큰 순, 수식 글 앞 `'`, 제어 글자 제거).
- **server A (손님 장부)**: 마이그레이션 0031(장부 표 6개)·0033(손님 표시 "안 정함"), `customers/ledger-*.ts` — 확인서 링크 동의 칸(CR-CONSENT-2)·장부 줄(표지·AES-GCM 암호화·합치기)·동의 기록, 다음 주문 "확인 전"(PC-3 예외·PC-4 `UNCONFIRMED`, [배송지 확인] 출처 `LEDGER`), 연결 코드(48낱말·24시간·한 번·손님 확인, 다른 줄 표지는 안 옮김), 콘솔 손님 표시 묶음 조회(50명), 손님 엑셀(work pool)과 받은 기록, 보관 기간 정리 `LedgerSweeper`(시작 때·1시간마다, 100줄 묶음, 봉인 못 읽은 판매자 건너뜀), 보관 기간 줄이기 미리 보기, 판매자 로그인 쿠키가 오면 대신 동의 거절.
- **server B**: `messaging/rules.ts`(`messageBytes`·`composeMessage`·`canSendAt`·`consentStatus`, I/O 없음), `report/`(RPT-01~08, 실제 날짜 단위·볼 때 계산·봉인 날짜·회차 이름), 마이그레이션 0032(일정·알림 표), `schedule/`(일정 10개, 공개 `/s/<토큰>` 서버 HTML — noindex·no-referrer·스크립트 없음, 접속 주소(IPv6 /64)마다 한도, 알림 신청·그만 받기 모두 PENDING·번호 암호화, 처리 결과 서명), `sweepSchedule`.
- **골든**: customers 4·44, message 4·57, report 5·36 — 137사례, 파일·사례 수 고정값, TZ 세 가지.
- **web C**: `lib/ledger.ts`·`useChatBadges`(4초·50명·실패 조용히), 설정 "손님 관리"(보관 기간·줄이면 N명 확인 창), 묶음 "지난 주문 배송지예요", 손님 자세히 "저장한 배송지"·이은 계정·지우기, 콘솔 꼬리표와 처음 한 번 묻는 띠, 엑셀 받기 창.
- **web D**: 리포트 화면 `/report?date=`(RPT-07 순서, 375px), 정산·콘솔 볼 곳, 설정 "방송 일정"·"방송 알림"(수만).

## 시험

- 서버 KP1 단위·골든, 웹 KP1 단위, documents 손님 엑셀 — 통과(마지막 측정: 서버 kp1 103개+, 웹 kp1·관련 151~209개).
- 적대(domain) 31개 통과, 실패로 남긴 버그 0. 봉인 날짜·두 가게 섞임·새는 곳·운영자 복구·코드 훔치기·판정 영향 없음·리포트=판매대장(fast-check) 포함.
- E2E 46개 통과(크로미움, PC 1280·375). AC-KP1-29 한 바퀴 포함. TE-KP1-001(`/s/` 프록시) 해결.
- `pnpm verify`(1회, E2E_PORT_OFFSET=700, 부하 높음 — e2e 8,088초): typecheck·lint·test·adversarial·e2e 실패, golden(964 통과)·coverage(라인 99.78%) 통과. 원인과 고침:
  - typecheck·적대 verify-gates: `apps/web/src/api/parcel-types.ts`가 KP1 `lib/ledger.ts`를 불러 DOM 없는 설정이 웹 파일을 끌어옴 → 타입을 parcel-types.ts 안으로(f2d18bd0).
  - lint: kp1-ux.test.ts 안 쓰는 import(5f85f789). test: styles.node `.badge-mark nowrap`(f2d18bd0), commands.test 표 수 80→90(KP1 표 10개, 5f85f789).
  - e2e: D-KP1-43이 CRM1의 1등 옆 "입금 늦음 주의"까지 숨김 → D-KP1-50(안 정함이면 CRM1 주의는 보임), 콘솔 첫 물음 띠를 채팅 칸으로·보통 버튼, 설정 "일정 적기" 보통 버튼, 동의 칸 접근 이름이 "받는 분"과 겹침(56264b1a).
  - adversarial: 작업자 프로세스의 V8 강제 종료("Check failed: end > addr")로 CRM1 시험 3개 pending — KP1과 무관, 다시 돌리면 통과.
- 고친 뒤 다시 돌림(부하 낮을 때): typecheck·lint·test(503파일·9,348개)·adversarial(177파일·2,966개) 통과, 실패했던 e2e 9파일 100개(크로미움·웹킷) 통과, kp1 e2e 46개 통과.
- 보호 경로 게이트: `check-protected.mjs f4b04dd7`(이 스프린트 범위) 실패 1건 — a6f71c33 `[dev:server]`가 `harness/sprints/KP1/contract.md`를 올림(아래 "남은 것"). `3b403c44`(BASE) 기준은 int/next의 INV1 커밋 74ff8727·0f45bf2a까지 더해 3건. 그 밖의 커밋 접두어·금지 패턴·커밋 안 된 변경 문제 없음.

## 감사와 고침

- **위험 1라운드**: major 1(RA-KP1-001 공개 일정 한도가 토큰 전체 기준) + minor 9 → 모두 고침(D-KP1-22~28). **2라운드**: blocker·major 0, minor 4 + nit 1(IPv6 /64, 코드로 든 표지, 정리 양보, 신청 한도 칸, 실패 때 알림) → 고침. RA-KP1-103은 양보만 넣고 나머지 techDebt.
- **스펙 감사**: AC 28/29 충족·1 부분(SA-KP1-001 접수 직전 `NO_ADDRESS`) → 고침. SA-KP1-002(코드에만 있던 가정) → D-KP1-29~42로 기록, 그중 37·39·40 코드 반영. SA-003(주소 질의만으로 결과 문장)·004(봉인 날짜 시험)·005(리포트 문구) 고침.
- **사용성**: blocker 0, major 6, minor 9, nit 1 → major 전부와 minor 대부분 고침(D-KP1-43~48). 주요 변경: 콘솔 손님 표시는 처음엔 숨기고 한 번 물음(방송 송출로 손님 누적 금액이 새는 위험), 장부 확인 출처 문구, 보관 기간 줄이기 확인 창, 글자 18px·버튼 52px, "장부" → "저장한 배송지". UX-KP1-008(되돌리기)·015·016은 techDebt(D-KP1-49).

## 자율 결정

D-KP1-22~49 모두 AUTO(판매자에게 안전한 쪽). 사용자 확인 필요는 spec 단계 그대로: 법률(손님 동의 문구·보관 기간·광고성 알림), 동의 문구 최종본, 솔라피 계정·발송(다음 스프린트, D-KP1-20).

## 남은 것 · 오케스트레이터 몫

- **게이트 위반 1건(이력)**: 커밋 a6f71c33이 `[dev:server]`로 `harness/sprints/KP1/contract.md`를 올렸다. 커밋 제목을 `[orch]`로 고치려면 `sprint/KP1` 강제 push가 필요한데 자동 권한 분류기가 막았다. 합칠 때 오케스트레이터가 이력을 고치거나(squash 등) 예외로 판단해야 한다.
- BASE(3b403c44) 기준 게이트는 int/next에서 들어온 INV1 커밋(74ff8727·0f45bf2a)도 잡는다 — 이 스프린트 범위는 f4b04dd7 기준으로 본다.
- techDebt 7줄(backlog.yaml): UX-KP1-008·015·016, RA-KP1-103·009, TE-KP1-003, 게이트 건.
- 개발 중 한 에이전트가 부하 50에서 마이그레이션 시험을 돌렸다(규칙 위반, 결과는 통과).
- 실물 확인 없음: 실제 유튜브 방송·실제 손님 휴대폰·실제 문자 발송은 하지 않았다.
