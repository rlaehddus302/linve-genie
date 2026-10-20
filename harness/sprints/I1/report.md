# I1 리포트 — 라벨·출력 화면 통합

**결과: FAIL** — I1 제품 코드 때문에 생긴 게이트 실패는 없다. 막는 것은 두 가지다. 시계에 의존하는 S06 E2E 3개(SA-I1-010)가 12:00 KST 뒤에 늘 실패하고, coverage 단계가 부하에서 흔들린다(SA-I1-012). 그래서 AC-I1-81을 만족하지 못한다. (영역 server·web, 시험 domain·e2e, 수정 라운드 2)

브랜치 track/i1-print-ui, BASE d5efaaf, 스펙 커밋 a030b18. 수용 기준은 45개(AC-I1-01~81)다.

## 영역별로 만든 것

### server (라운드 0 + 수정 라운드 1, aa1599d)
- 마이그레이션 0003으로 표 6개를 더했다: print_queues·print_labels·print_jobs·print_attempts·label_templates·print_requests. outbox는 그대로 두었다.
- 자동 작업: txHook이 PRINT_PRODUCT_LABEL 효과를 같은 트랜잭션에서 작업으로 만든다. 작업 ID는 효과 ID, 라벨 키는 찜@확정버전이다. 구매자 이름은 첫 작업 때 고정한다. 조회는 rehearsal=false로 고정했다(RA-S05-002).
- 폐기는 상태로 정한다: 1등이 아니게 되거나 VOID_LABEL이 오면 폐기한다. 이미 출력한 라벨은 '버릴 라벨'이 되고, "버렸어요"를 누르면 한 번만 기록한다.
- 출력 기기는 판매자마다 하나다. 바꿀 때 확인을 받고, 쌓인 라벨이 있으면 멈춘 채 '출력 시작'을 기다린다. 출력 그만하기도 있다. 한 번에 한 장씩 받고, 라벨 데이터는 받을 때 만든다. 늦은 결과는 버린다. 멈춤 까닭은 4가지다.
- effect.labelPrinted는 효과마다 한 번만 쓴다. 늦은 보고면 엔진이 VOID_LABEL을 낸다.
- 판매자 조치: 손으로 출력, 다시 출력, 빼기, 모두 빼기, 포장 라벨(쪽마다 작업 하나). 같은 요청 번호로는 한 번만 만든다.
- 재출력 필요는 L-10 내용 키로 정한다. 그 밖에 템플릿 저장, 실시간 print 알림, 시험 모드 testPrinter가 있다.
- AC-I1-80: 합계를 22/123/502로 맞췄다.
- 수정 라운드 1:
  - 받기 때 1등을 먼저 확인한다. 데이터를 만들 수 없으면 조용히 폐기하지 않고 LABEL_ERROR로 멈춘다.
  - 같은 기기가 다시 등록하면 releasing을 해제한다.
  - 같은 기기가 2초 뒤 다시 받으면 같은 작업을 새 토큰으로 준다(그 시도는 끊김으로 센다).
- 단위 시험은 27개에 수정 라운드 1에서 5개를 더했다.

### web (라운드 0~2, 0145459..a7af4ea, a52406e 등)
- SharedStream: 실시간 연결을 페이지마다 하나만 연다. 기기 ID는 탭마다 따로 두고 sessionStorage와 Web Locks로 정한다.
- PrintStore: rev로 순서를 맞춘다. 느린 응답이 새 알림을 덮지 않게 했다(TE-I1-001). 지금 1등의 라벨 키가 없으면 ensureLabels로 한 번 다시 받는다(SA-I1-009).
- PrinterStation이 받기 → 그리기 → 인쇄 → 보고를 맡는다. 화면 꺼짐을 막는다. 잃어버린 받기 응답은 #lostClaim으로 복구하고 releasing 중에도 받는다(SA-I1-008).
- /labels 화면: 연결 마법사, 테스트 인쇄, 농도, 출력 기기, 대기열·이력·버릴 라벨, 템플릿 편집·미리보기·최악값 검사, 자동 출력, 내보내기(A4·PNG·공유).
- 콘솔: 보드 라벨 상태, 상품 자세히, 알림 띠의 출력 멈춤·버릴 라벨(Alt+1 순서), Alt+P, 프린터 상태를 표시한다.
- 정산 자세히에 포장 라벨을 두었다. 리허설에서는 안내 문장만 보인다.
- 단위 시험 51개 이상을 더했다. Playwright에 chromium-no-test-printer 프로젝트를 더했다.

### 시험 (domain·e2e)
- tests/adversarial/i1: 무작위 열, 불변식, 두 기기, 리허설 고정, 개인정보.
- tests/e2e/i1: 42/42 통과. 30장 끊김 복구, 승계, 버릴 라벨, Alt+P, 쌓인 라벨, 출력 기기 바꾸기, 리허설을 본다. TE-I1-004·005가 이제 통과한다.

## 남은 blocker/major

| ID | 심각도 | 내용 | 담당 |
|---|---|---|---|
| GATE-I1-VERIFY | blocker | pnpm verify FAIL. e2e 172 통과·3 실패(전부 S06). coverage는 부하 때문에 실패했고, 단독으로 다시 돌리면 통과한다(100% / 99.65%). 나머지 단계(typecheck·lint·test 2405·golden 502·adversarial 766)와 보호 경로 게이트는 통과했다. | — |
| SA-I1-010 | blocker | tests/e2e/s06 sms.spec.ts:181과 attacks-r1.spec.ts:172(×2)가 받은 시각 '00:00:01'을 입력한다. 12:00 KST가 지나면 '내일'로 해석돼 확인 창이 뜨고 실패한다. 제품은 D-023대로 동작한다. | test-e2e (보호 경로): page.clock.setFixedTime으로 시계를 고정 |

## 자율 결정·사용자 확인 필요 사항

자율 결정(전부 blocking=false):
- D-I1-01: 대기열의 원본은 서버이고 판매자 단위다. 출력 기기는 하나이고 한 번에 한 장씩 출력한다.
- D-I1-02: 효과와 같은 트랜잭션에서 작업을 만든다. 폐기는 상태로 정한다. labelPrinted는 효과마다 한 번 쓴다. VOID_LABEL 보고와 effect.failed는 없다.
- D-I1-03: 출력 기기를 바꿀 때 확인을 받는다. 시간이 지나도 작업을 다른 기기로 넘기지 않는다. 쌓인 라벨은 '출력 시작'을 눌러야 나온다.
- D-I1-04: 재출력은 지금도 1등일 때만 된다. 구매자 이름은 첫 작업 때 고정한다. 재출력 필요는 L-10 키로 정한다. 단축키는 Alt+P다.
- D-I1-05: 템플릿은 서버에 저장한다(16KB, 판 충돌이면 거절). 가격 표기는 priceStyle을 따른다. 자동 출력 설정은 다음 방송부터 적용한다.
- D-I1-06: 연결 마법사와 테스트 인쇄를 두고, 결과를 확인하는 질문을 한다. 농도는 1~5다. 시험용 프린터는 시험 모드에서만 나온다.
- D-I1-07: PNG·PDF·A4로 내보낸다. 내보내기는 출력함으로 치지 않는다. 파일 이름에는 날짜·번호·쪽만 넣는다.
- D-I1-08: 리허설에서는 출력하지 않는다. Alt+1 순서는 충돌→취소 요청→승계→출력 멈춤→버릴 라벨→확인 필요다.
- D-I1-09: P1이 남긴 질문(SA-P1-006·TD-P1-004·TD-P1-005)은 지금 동작대로 LABEL_RULES에 적었다.
- D-I1-10: 포장 라벨은 요청할 때 쪽마다 작업 하나를 만든다. 포장 모드는 I2에서 한다.

에스컬레이션된 결정은 없다. 사용자 확인이 필요한 것:
- **UX-I1-008**: 문자찜 구매자의 라벨에 '문자찜'만 찍혀 상자를 구분할 수 없다. 규칙(LBL-02·L-9)을 정해 주어야 한다.
- **SA-I1-011**: 받기 되찾기 규칙을 L-11에 넣을지 승인해야 한다(spec-keeper).
- **RA-I1-003**: 표시 이름을 30일 정리 대상에 넣을지, 구매자 ID만 남길지 정해야 한다.
- **AC-I1-73 (HG-2)**: 실제 B1 프린터로 사람이 확인해야 한다.

## minor/nit 백로그 (backlog.yaml techDebt에 추가함)

minor:
- SA-I1-012: 부하에서 coverage가 코어 시간 시험 때문에 실패한다. pendingPile 비율에도 D-901 반복 측정을 적용해야 한다.
- SA-I1-011: 받기 되찾기 규칙이 스펙에 없다.
- RA-I1-006: 받기 요청에 시간 제한이 없다. 5xx·NOT_JSON 응답은 다시 시도하지 않는다.
- RA-I1-002: txHook이 라벨 전체를 조회한다(성능).
- RA-I1-003: 표시 이름에 보관 기한이 없다.
- UX-I1-001~008: 라벨이 쌓여도 알림이 없음, 그만하기에 확인이 없음, 상태 문장이 모순됨, 새 탭이 출력 기기를 바꿀지 물음, 버릴 라벨 줄이 반복됨, 미리보기가 너무 큼, 375px에서 미리보기가 맨 아래에 있음, 문자찜 라벨 구분 불가.

nit:
- SA-I1-013: ensureLabels가 실패한 키를 다시 묻지 않는다.
- SA-I1-007 / TD-I1-003: 기기 이름에서 ZWJ를 지워 이모지가 깨진다.
- RA-I1-004: 출력 기기 ID가 다른 화면에 노출된다.
- RA-I1-005: queueCounts가 지나치게 넓게 스캔한다.
- UX-I1-009~013: 출력한 적 없는 라벨에 '다시 출력'이 보임, 대화상자 버튼에 '1'이 없음, 처음 화면이 '끊김'으로 보임, 가게 이름이 비어 있음, 저장하지 않은 설정이 경고 없이 사라짐.

## 추적성 표

| 기준 | 구현 | 시험 |
|---|---|---|
| AC-I1-01 | apps/server/src/print-api.ts, print.ts | print-rules.test.ts, adversarial/i1/print-attacks |
| AC-I1-02 | print.ts createAutoJobs/txHook | print-rules.test.ts, adversarial/i1/print-random |
| AC-I1-03 | print.ts (리허설 라벨 없음) | print-rules.test.ts, print-attacks |
| AC-I1-04 | print.ts productLabelData | print-rules.test.ts |
| AC-I1-05 | print.ts voidLabels/succession | print.test.ts, e2e/i1/succession |
| AC-I1-06 | print.ts:835-930 claim (되찾기 850-866) | print.test.ts, print-attacks, e2e/i1/probes:134 |
| AC-I1-07 | print.ts result/#applyResult | print.test.ts |
| AC-I1-08 | print.ts | print-rules.test.ts, print-attacks |
| AC-I1-09 | print.ts:71 | labels-page.test.tsx, e2e/i1/attacks |
| AC-I1-10 | print.ts:777-792; printer-station.ts:146-152,393-394,425-451 | printer-station.test.ts, e2e/i1/probes:11, attacks |
| AC-I1-11 | print.ts:1022 | print-rules.test.ts |
| AC-I1-12 | print.ts:653 | print-store.test.ts |
| AC-I1-13 | print.ts | print-rules.test.ts, e2e/i1/screens |
| AC-I1-14 | print.ts templates | print-rules.test.ts, e2e/i1/settings |
| AC-I1-15 | print.ts:459, print-store.ts:50-57 | print-rules.test.ts, e2e/i1/station |
| AC-I1-16 | production.ts | print-rules.test.ts |
| AC-I1-17 | print-api.ts | print-attacks, e2e/i1/races |
| AC-I1-20 | App.tsx | labels-page.test.tsx, e2e/i1/screens |
| AC-I1-21 | LabelsPage.tsx:22 | e2e/i1/settings, attacks |
| AC-I1-22 | LabelsPage.tsx:201 | e2e/i1/probes:92, labels-page.test.tsx |
| AC-I1-23 | LabelsPage.tsx, printer-station.ts | e2e/i1/screens, station |
| AC-I1-24 | PrintParts.tsx | e2e/i1/screens, attacks |
| AC-I1-25 | LabelSettings.tsx | e2e/i1/files, label-render.node.test.ts |
| AC-I1-26 | LabelSettings.tsx:205 | e2e/i1/attacks, label-render.node.test.ts |
| AC-I1-27 | LabelsPage.tsx:457,525 | e2e/i1/backlog:87, probes:41 |
| AC-I1-30 | print.ts:117-131, ConsolePage.tsx | console-labels.test.tsx, e2e/i1/screens |
| AC-I1-31 | LabelParts.tsx:99-114, print-store.ts:470-486 | console-labels.test.tsx, print-store.test.ts, e2e/i1/probes:41, files:51 |
| AC-I1-32 | PrintParts.tsx:230 | e2e/i1/screens, succession |
| AC-I1-33 | ConsolePage.tsx:542 | console-labels.test.tsx, e2e/i1/screens |
| AC-I1-34 | print-words.ts:106 | stream-words.test.ts, e2e/i1/screens |
| AC-I1-35 | print.ts:683 | e2e/i1/screens |
| AC-I1-36 | SettlementsPage.tsx | e2e/i1/screens |
| AC-I1-40 | LabelParts.tsx:80 | e2e/i1/files, label-render.node.test.ts |
| AC-I1-41 | LabelsPage.tsx (내보내기) | e2e/i1/files |
| AC-I1-42 | apps/web/src/lib (파일 이름) | e2e/i1/files:51,78,85 |
| AC-I1-50 | commands/e2e-server.ts:7 | e2e/i1/settings:45 @no-test-printer, printer-station.test.ts |
| AC-I1-60 | print-words.ts | e2e/i1/screens:181, attacks:133 |
| AC-I1-61 | print-words.ts | stream-words.test.ts, e2e/i1/attacks:121 |
| AC-I1-62 | LabelsPage.tsx | e2e/i1/screens |
| AC-I1-70 | printer-station.ts | e2e/i1/station |
| AC-I1-71 | print.ts voidLabels | e2e/i1/succession |
| AC-I1-72 | print.ts, print-store.ts | e2e/i1/backlog, probes:41 |
| AC-I1-73 | (사람 확인) | 해당 없음 (HG-2) |
| AC-I1-80 | core-adapter.test.ts 합계 22/379/123/502 | pnpm golden 502 통과 |
| AC-I1-81 | verify 전 단계 | **FAIL**: e2e S06 3개(SA-I1-010), coverage 부하(SA-I1-012) |
| L-11 4·6 | print.ts:835-930, printer-station.ts:415-455 | e2e/i1/probes:11,134, printer-station.test.ts |
| L-11 10 | print.ts:777-792,863-865,1017 | e2e/i1/probes:11, print-attacks |

## 다음 스프린트 제안

1. **I1 게이트 마무리 (짧은 수정 스프린트, 우선)**
   - test-e2e가 S06 시험 3개의 브라우저 시계를 고정한다(SA-I1-010).
   - 오케스트레이터나 코어 담당이 engine-timing.test.ts:59에 D-901 반복 측정을 적용하고, AC-S03-92의 시간 제한을 늘린다(SA-I1-012).
   - 두 가지를 마치면 verify를 다시 돌려 I1을 pass로 올린다. 제품 코드는 바꿀 필요가 없다.
2. **스펙 정리 (spec-keeper)**: SA-I1-011의 L-11 문장을 반영하고, UX-I1-008 문자찜 라벨 규칙을 정한다. RA-I1-003은 S10 carryOver에 넣거나 보관 결정을 기록한다.
3. **I1 후속 품질**: RA-I1-006(받기 시간 제한과 5xx를 일시 오류로 처리)과 UX-I1-001~004(출력 상태 알림·확인 흐름)를 I2 carryOver로 넘긴다.
4. **HG-2**: 실제 B1으로 사람이 확인한다(AC-I1-73).
5. 그다음 계획대로 I2(포장 모드)를 진행한다.
