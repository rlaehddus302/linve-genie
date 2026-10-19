# S06 리포트 — 문자찜 입력(휴대폰) + 구매자·정산 화면

**결과: PASS** (수정 1라운드, 열린 blocker/major 0건, `CI=1 pnpm verify` 7단계 통과, e2e 21파일 114개 통과)

- 스펙 커밋 5b7fc94 ([spec] S06), BASE=23f621e
- 결과물: `harness/sprints/S06/acceptance.md`(AC-S06-01~96, 45개), `tests/golden/engine/18-s06-sms-buyers-settlement.yaml`(G-ENG-169~173), DECISIONS D-089~D-096, SPEC v0.1.7, DOMAIN_RULES v0.1.12(R-6 설명만 보탬)
- 골든: 파일 21 · 파서 379 · 엔진 119 · 통과 498 · 그 밖 0. 허용 목록은 비어 있음

## 영역별로 만든 것

### server
- 이력 조회 상품 ID 거르기 `GET /api/days/:date/history?product=<id>`. 번호 변경·등록 결과를 거슬러 따라가 그때 번호를 가졌던 상품에 붙인다. `b`/`no`와 함께 쓰면 400 (AC-S06-70, TD-S05-004)
- 가짜 채팅 생성기는 판매자당 하나. 다른 방송에서 시작하면 409 `GENERATOR_RUNNING_ELSEWHERE`. 끝난 기록은 방송당 1개, 판매자당 20개까지 (AC-S06-71, RA-S05-003)
- 보기 캐시(색인 8·메시지 4)를 범위 실행 상태마다 두고, 판매자 사이 공유 캐시를 없앴다 (AC-S06-72, RA-S05-001)
- E2E 서버는 127.0.0.1에서만 듣는다 (AC-S06-73, RA-S05-006)
- 리허설 기본 제목 "리허설 N", 실제 방송은 "N부" (AC-S06-66)
- 문자찜 쓰기 계약 확인 시험 추가(시간대 4개에서 받은 시각 비움 → KST HH:MM:SS). 코드 변경 없음 (AC-S06-16)
- `core-adapter.test.ts` 골든 합계 고정값을 21·379·119·498로 교체 (AC-S06-95)

### web
- 메뉴(방송·문자찜 입력·구매자·정산)와 주소 `/sms`·`/buyers`·`/settlements`. 휴대폰에서는 아래 고정 막대 (AC-S06-01·02)
- 떠나기 확인: 메뉴·링크·화면 안 이동·브라우저 뒤로/앞으로(popstate)·새로고침(beforeunload) 모두에서 묻는다. 창이 열린 동안 대기 시계가 멈춘다 (라운드 1)
- 실시간 저장소를 방송 단위·날짜 범위 단위로 열고, 410 뒤 다시 받기는 1초부터 두 배씩 최대 30초로 계속 시도 (AC-S06-40·41, RA-S05-004)
- 문자찜 입력 `/sms`: 방송 기본값, 번호 미리 보기, 받은 시각 읽기·늦은 시각 확인, 전화번호·메모 검사, 구매자 고르기, 바로 보내기·결과 카드·찜 취소하기·같은 사람 하나 더, 최근 10개 (AC-S06-10~15). 전화번호로 이은 구매자도 '이미 찜한 구매자라…'가 나오게 고침 (라운드 1)
- 구매자 `/buyers`: 날짜 고르기, 목록·찾기·자세히, 합치기(방향·미리 보기·막힘 이유·막히면 합계 숨김)·떼어 내기·차단. 미리 보기를 실제 엔진과 비교하는 단위 시험 (AC-S06-20~24)
- 정산 `/settlements`: 요약·거르기·목록·자세히·계산 줄, 입금(기본값 남은 금액, 다르면 확인)·배송비 예외·할인/추가·환불, 원 단위 금액 칸 (AC-S06-30~36)
- PWA: 매니페스트·아이콘, 빌드마다 만드는 `sw.js`(앱 껍데기만, `/api/` 가로채지 않음), 새 버전 '지금 새로고침', 설치·iOS 안내 (AC-S06-50~52)
- S05 UX 정리: 동사 버튼, 사유 숫자 키 1~4, 1등 취소 키 7번, 휴대폰 고정 영역 267px, PC 채팅 10개(1:1:1.5), 리허설 시작 버튼 첫 화면, 조치 기록 `?product=`, 남겨 둔 '고칠까요?' 다시 비교, 생성기 409 안내 (AC-S06-60~67·70·71)
- 문자찜 결과 카드를 번호 칸 위로, 보내기 막대를 아래 고정으로 옮김 (라운드 1)
- 쓰기 실패 화면 시험: SAVE_FAILED 같은 요청 번호, PROCESSING_FAILED '확인 필요', 401 세션 끝 (AC-S06-82)

### e2e
- `tests/e2e/s06/**`: 1단계 끝까지 시험(`phase1.spec.ts`: 리허설 1,000건·상품 30·휴대폰 문자찜·합치기·입금을 코어 재생과 비교)과 AC별 흐름
- `attacks-r1.spec.ts` 17개 회귀(뒤로 가기·창 연 채 기다림·새로고침·503/500/401·휴대폰 합치기→PC 1초·@fill 등). TE-S06-001·003·004는 회귀 시험으로 이름만 바꿈(기대값 그대로)

## 남은 blocker / major

없음.

## 자율 결정 · 사용자 확인 필요 사항

| ID | 질문 | 적용한 결정 |
|---|---|---|
| D-089 | 문자찜 입력 기본값·시각·보내기 | 끝나지 않은 최근 실제 방송 기본, 받은 시각 비우면 서버가 KST 초까지, 1~12시는 가까운 쪽, 늦은 시각 확인, 5초 대기 없이 바로 보냄, 보낸 뒤 칸 비움 + '같은 사람 하나 더' |
| D-090 | 구매자 목록 범위 | 날짜 범위 하나, 기본은 확정 찜 있는 구매자, 찾기는 전체, 전화번호 뒤 4자리만 |
| D-091 | 합치기 규칙 | 유튜브 쪽이 남음, 미리 보기·중복 정리 보임, 둘 다 1등·이미 합침·고리면 막음, 확인 뒤 바로 보냄 |
| D-092 | 정산 화면 범위 | 입금·배송비 예외·할인/추가·환불 모두 S06, 잘못 적은 입금은 환불로 바로잡음, 입금 날짜는 기록 시각(실제 날짜는 메모), 원 단위 |
| D-093 | PWA 저장 범위 | 앱 껍데기만, API·쓰기 대기열 없음, 새 버전은 다음 열 때 |
| D-094 | 휴대폰 기준·S05 UX 정리 | 375×812 가로 스크롤 없음·16px·44px, 고정 영역 35% 이하 등 숫자 기준 |
| D-095 | 번호 변경 뒤 조치 기록 | 상품 ID 기준으로 따라감, '고칠까요?'는 다시 비교 |
| D-096 | 서버 자원 정리 | 생성기 판매자당 하나, 다시 받기 최대 30초 간격, 범위별 캐시, 127.0.0.1 |

**사용자 확인 필요**
- **HG-1 판매자 리허설 1회**: 자율 진행이라 AC-S06-90 E2E로 대신했다. 실제 판매자가 휴대폰으로 리허설 방송·문자찜·합치기·입금을 해 보는 확인이 남아 있다(목록은 acceptance.md 끝, DECISIONS '사용자 확인 필요' 표).
- **spec-keeper 판정 대기**: SA-S06-008(드문 경우의 일반 문장 허용 또는 쓰기 응답에 구매자 ID 추가), SA-S06-006(PC 목록을 표로 할지), SA-S06-007(입금 상한 1억 원 승인 여부), TE-S06-005(날짜 표기에 연도).
- 아이폰 홈 화면 앱에서는 5초 안에 앱을 끄면 대기 조치가 묻지 않고 버려진다(RA-S06-005). 판매자 안내에 넣을지 정해야 한다.

## minor / nit 백로그

| ID | 심각도 | 영역 | 제목 |
|---|---|---|---|
| SA-S06-008 | minor | server/web | 뒤 4자리만 같은 두 문자 구매자가 모두 찜했으면 '이미 찜한 구매자라…'·'같은 사람 하나 더'가 안 나옴 |
| SA-S06-006 | minor | web | PC(1440)에서도 정산·구매자 목록이 카드 격자 |
| SA-S06-007 | minor | web | 입금 상한 100,000,000원이 스펙에 없음 |
| RA-S06-002 | minor | server | 범위별 보기 캐시로 메모리 상한이 범위 128개 × 12로 커짐 (PLAUSIBLE) |
| RA-S06-004 | minor | web | 떠나기 창을 오래 연 뒤 '닫기'하면 오래된 조치가 되돌릴 틈 없이 나감 (PLAUSIBLE) |
| UX-S06-004 | minor | web | 구매자 목록의 같은 메모 문자 구매자가 구분 안 되고 이름 표기가 다름 |
| UX-S06-005 | minor | web | 정산 입력 창에 묶음 주인 이름이 없음 |
| UX-S06-006 | minor | web | 배송비·할인 미리 보기가 과입금·환불 필요를 알려 주지 않음 |
| UX-S06-007 | minor | web | 결과·안내 색이 뜻과 반대 |
| RA-S06-003 | nit | web | 합치기 미리 보기·smsHolder가 R-11을 화면에서 다시 구현 |
| RA-S06-005 | nit | web | iOS·안드로이드 PWA 첫 기록에서 앱 닫기가 묻지 않고 대기 조치를 버림 (PLAUSIBLE) |
| UX-S06-008 | nit | web | 휴대폰 조치 기록 표가 한 글자씩 꺾임 |
| UX-S06-009 | nit | web | 막힌 합치기에서 찜 취소 후 합치기 흐름이 끊김 |
| UX-S06-010 | nit | web | 최근 문자찜·결과 카드 받은 시각에 날짜 없음 |
| UX-S06-011 | nit | web | 주 버튼이 지금 할 일과 맞지 않음 |
| UX-S06-012 | nit | web | 방송 고르기 창의 고른 방송이 테두리로만 표시 |
| UX-S06-013 | nit | web | 이름 구분 표기 어색함 |
| TE-S06-005 | nit | web | 날짜 고르기에 연도 없음 (스펙 확인 필요) |
| SA-S06-009 | nit | test | adversarial 골든 러너 시험이 5초 제한에 가까워 게이트가 흔들릴 수 있음 |

모두 `harness/backlog.yaml` techDebt에 올렸다.

## 추적성

| AC | 구현 | 시험 |
|---|---|---|
| AC-S06-01 | App.tsx:36-147, lib/leave-guard.ts, lib/router.ts:94-115, lib/undo-queue.ts:351-407 | navigation.spec.ts:52, attacks-r1.spec.ts, console-s06.test.tsx, undo-queue.test.ts |
| AC-S06-02 | styles.css:299~ | layout.spec.ts, fixes.spec.ts |
| AC-S06-10 | SmsPage.tsx:1-200 | sms.spec.ts |
| AC-S06-11 | SmsPage.tsx:211 | sms.spec.ts |
| AC-S06-12 | lib/received.ts | sms.spec.ts, received*.test.ts |
| AC-S06-13 | SmsPage.tsx:290-330 | sms.spec.ts |
| AC-S06-14 | SmsPage.tsx ResultCard, lib/buyers.ts:51-94, host-actions.tsx:61-72 | sms.spec.ts:251, attacks-r1.spec.ts, sms-page.test.tsx, buyers.test.ts |
| AC-S06-15 | SmsPage.tsx:635 | sms.spec.ts |
| AC-S06-16 | 서버 S04 계약 그대로 | S04 서버 시험, sms.spec.ts |
| AC-S06-20~22 | BuyersPage.tsx, lib/buyers.ts:30 | buyers.spec.ts, attacks-r1.spec.ts:324 |
| AC-S06-23 | lib/buyers.ts:217-268, BuyersPage.tsx:541-551 | buyers.spec.ts:178, buyers.test.ts(엔진 비교), buyers-page.test.tsx |
| AC-S06-24 | BuyersPage.tsx:638 | buyers.spec.ts |
| AC-S06-30~35 | SettlementsPage.tsx | settlements.spec.ts, attacks-r1.spec.ts |
| AC-S06-36 | forms.tsx:129, lib/money.ts:29-31 | settlements-page.test.tsx, money 단위 시험 |
| AC-S06-40 | lib/console-store.ts | devices.spec.ts:49, attacks-r1.spec.ts:284 |
| AC-S06-41 | styles.css:390, AlertStrip.tsx | attacks-r1.spec.ts:432 |
| AC-S06-50~52 | src/pwa/ | pwa.spec.ts |
| AC-S06-60~67 | actions.ts, AlertStrip.tsx, styles.css, ReasonField.tsx, quick.ts, ConsolePage.tsx, apps/server | fixes.spec.ts, layout.spec.ts |
| AC-S06-70 | ProductDetail.tsx:320, apps/server | fixes.spec.ts |
| AC-S06-71 | apps/server | fixes.spec.ts, 서버 단위 시험 |
| AC-S06-72 | server runtime.ts:79, views.ts:91 | 서버 단위 시험 (RA-S06-002 열림) |
| AC-S06-73 | server commands/e2e-server.ts | e2e WebServer 127.0.0.1:3100 |
| AC-S06-80 | lib/derive.ts:39 | s06/*.spec.ts |
| AC-S06-81 | lib/router.ts:4, SmsPage.tsx:318-323 | sms.spec.ts |
| AC-S06-82 | forms.tsx:22-64 | attacks-r1.spec.ts:189·222·257, sms.spec.ts, 화면 단위 시험 |
| AC-S06-90 | 전 화면 | phase1.spec.ts |
| AC-S06-91 | 사람 확인 (HG-1) | 해당 없음 |
| AC-S06-95 | core-adapter.test.ts 합계 | golden 21 / 498 / 미구현 0 |
| AC-S06-96 | pnpm verify | 7단계 통과 |

## 다음 스프린트 제안

1. **spec-keeper 판정 먼저**: SA-S06-008·006·007, TE-S06-005를 결정해 다음 스펙에 넣는다. SA-S06-008을 (b)로 고르면 문자찜 쓰기 응답에 정한 구매자 ID를 더하고 smsHolder 추정을 없앤다(RA-S06-003도 함께 줄어듦).
2. **대기 조치 안전성**: RA-S06-004(오래 멈춘 뒤 다시 흐를 때 최소 대기 시간 다시 주기)를 다음 web 작업 carryOver로 넣는다. RA-S06-005는 beforeunload `returnValue` 설정과 안드로이드 sentinel 항목만 같이 처리한다.
3. **서버 캐시 전체 상한**: RA-S06-002를 실측(heapUsed) 후 전체 LRU 상한을 둔다.
4. **정산·구매자 UX 묶음**: UX-S06-004~007을 S09 명세서·판매대장 작업과 함께 정리한다.
5. **게이트 안정**: SA-S06-009 시험 제한 시간을 늘려 거짓 실패를 막는다.
6. **HG-1 사람 확인**을 1단계 마감 전에 실제 판매자와 진행한다.
