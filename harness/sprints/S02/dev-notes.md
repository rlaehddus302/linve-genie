# S02 개발 노트

## dev-core

### 만든 것
- `@livejjim/core` 판정 엔진 (`packages/core/src/engine/**`, 재수출 `src/engine.ts`·`src/index.ts`)
  - `initEngine({ broadcasts, settings })` → `EngineState`. 설정은 `resolveSettings`로 기본값 위에 덮어쓴다. S03 설정(`contention.policy=RECEIVED_TIME`, `settlement.groupBy=MANUAL`)이면 `NotImplementedError`, 방송 ID가 비었거나 겹치면 `TypeError`.
  - `applyEvent(state, event)` → `{ state, effects }`. `effects`는 이 이벤트로 새로 나온 효과(`EngineEffect`: `id`·`kind`·`target`·`claim`·`product`·`broadcast`·`no`·`buyer`·`text`·`confirmVersion`).
  - 조회 함수: `getProduct`·`listProducts`·`listClaims`·`listPending`·`getBuyer`·`listBuyers`·`getSettlement`·`listSettlements`·`listEffects`·`listCancelRequests`·`activeClaimId`·`productStatus`.
  - `checkInvariants(state)` → INV-1·2·5·6·7·9 위반 목록.
  - 표시용 포맷: `formatWon`(세 자리 쉼표 + 원, `Intl` 없음), `formatThanksText`(R-13 감사 문구).
  - `CorruptStateError`: 서로 가리키는 기록이 없는 손상된 상태(엔진이 만든 상태에서는 생기지 않음)에서 판정을 이어 가지 않고 멈춘다. S04 재생 무결성 검사용.
- 이벤트·상태 타입은 판별 유니온(`EngineEvent`, `type`별 필드). 필드 이름은 골든 README와 같다(`b`·`no`·`buyer`·`id`·`ch`·`nick`·`text`·`replace`·`replaceTo`…). 효과 보고만 `effectId`로 가리킨다.
- 골든 러너: 계약에 `host.assign`·`host.reopen`·`host.dismissCancel`(AC-S02-92), 어댑터 `observe`·`invariants`·효과 ID 연결(AC-S02-91), 입력 상태 변경 감지·시작 스냅샷 결정성·관찰 스냅샷 형식 검사(`snapshot-check.ts`).
- 테스트(`packages/core/test/`): `unit/engine-{api,rules,effects,views,invariants,properties,timing}.test.ts`, `golden/{runner-s02,core-adapter}.test.ts`, 읽기 오류 픽스처 `05-event-fields-host.yaml`. 공용 도구 `unit/engine-helpers.ts`.

### 상태 모양 (AC-S02-02·05)
- 순수 JSON 데이터: `{ format, broadcasts, settings, counters, messages, buyers, blocked, slots, claims, effects }`. 모음 6개는 평범한 객체로 된 두 단계 해시 트라이(`PMap`, `engine/pmap.ts`)다. 값을 하나 바꾸면 지나가는 마디 세 개만 새로 만들고 나머지는 이전 상태와 공유하므로, 상태가 커져도 이벤트마다 전체를 복사하지 않는다. 처리 시간: 상품 500·채팅 1만·조치 100건에 전체 50~70ms, 가장 느린 이벤트 약 2ms(로컬).
- `slots`는 "방송의 번호 하나"(상품이 아직 없어도 보류 찜이 있으면 생김): `winners`(확정 순서)·`waitlist`(1순위부터)·`pending`(판정 순위)·`active`(구매자 → 활성 찜 ID, INV-2 색인)·`awaiting`(승계 결정 필요)·`version`(확정버전).
- 찜 ID는 생성 순서 `c1, c2, …`(같은 로그면 같다, 사본을 끼워 넣어도 바뀌지 않는다). 효과 ID는 `{찜ID}:{효과종류}:{대상}:{확정버전}`, 대상이 없는 라벨 효과는 대상 자리에 `-`.
- 상태 안에서 처리 순서·표시 순서는 모두 명시적인 키(생성 순서 `n`, 방송 선언 순서·번호)로 정렬한다.
- 엔진은 넘겨받은 상태를 바꾸지 않는다: 이벤트 하나를 작업 사본(`engine/draft.ts`)에서 처리하고 바뀐 기록만 영속 맵에 넣는다. 바뀐 것이 없으면 넘겨받은 상태 객체를 그대로 돌려준다.

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **모르는 이벤트 종류·형식이 틀린 필드는 아무것도 바꾸지 않는다**(D-039와 같은 이유: 입력 우선 기록이라 엔진까지 오고, 예외는 재생을 멈춘다). 필드 검사: 번호 1 이상 정수, 가격 0 이상 정수, 재고 1 이상 정수, `seq` 정수·`at` 유한한 수, 선언한 방송 등. 사유(`reason`) 내용은 보지 않는다(조치 이력은 이벤트 로그가 갖는다).
- **R-1에 있지만 처음 쓰는 스프린트에서 정할 이벤트**(`broadcast.start`·`broadcast.end` → S04, `effect.failed` → S11)는 조용히 무시하지 않고 `NotImplementedError`로 알린다. 골든 계약 밖이라 골든에는 영향이 없다.
- **무시하는 방송자 메시지도 "받은 메시지"로 기록**한다(재수신 판단용). 구매자로는 기록하지 않는다(R-11).
- **차단·판매 아님·품절로 거절된 새 찜은 번호 기록(slot)을 만들지 않는다.** 찜 자체는 생기고 `claimCount`에 들어간다.
- **보류 찜의 사유는 `UNOPENED`**로 보인다(R-4 2번 줄 `PENDING(UNOPENED)`).
- **차단은 엔진이 아직 모르는 채널에도 걸 수 있다**(차단 목록은 구매자 기록과 따로). 구매자 기록은 만들지 않는다.
- **`host.promote`는 상품이 일시 중지(HOLD)여도 된다**(R-2 "HOLD는 새 찜만 막는다"). 빈 자리와 대기 찜이 조건이다.
- **취소된 효과의 늦은 보고는 상태를 `DONE`으로** 기록한다(R-13 "실행 완료로 기록"). 잠금은 걸지 않고, 라벨이면 `VOID_LABEL`. 같은 늦은 보고가 또 오면 이미 완료라 아무 일도 없다.
- **`effect.labelPrinted`가 `VOID_LABEL` 효과를 가리키면 아무 일도 없다**(종류가 다른 보고). `VOID_LABEL` 완료 보고는 S08에서 정한다.
- **`checkInvariants`의 INV-5는 구매자 기록의 누적 합계(`subtotal`, 확정·해제 때 더하고 뺌)와 확정 찜 가격 스냅샷의 합을 대조**한다. 조회 함수의 합계는 찜에서 다시 계산하므로, 누적 합계가 어긋나면 INV-5가 잡는다.
- **골든 러너 기존 테스트 2개 수정**(약화 아님): 시작 상태 관찰이 생겨 ① "두 실행이 멈춘 지점이 다르면 결정성 위반"의 가짜 코어가 시작 관찰부터 달라지지 않게 픽스처를 고쳤다(멈춘 지점 비교 단언은 그대로). ② 형식이 틀린 스냅샷은 이제 비교 중 예외가 아니라 형식 검사(`관찰 스냅샷 형식 오류`)로 더 이른 위치(시작 상태)에서 러너 오류가 된다.
- **S00 단위 테스트 "엔진 API는 S02까지 미구현을 알린다"는 AC-S02-01 테스트로 교체**했다(AC-S02-01이 지시한 스펙 변경에 따른 교체).

### spec-keeper에게: 규칙 문장이 정하지 않았거나 글자 그대로 따랐을 때 판매자에게 어색할 수 있는 것 (disputesWithSpec)
1. **교체(대기로) + `waitlist.max` 0.** R-9 "대기가 `waitlist.max`를 넘으면 맨 끝 대기자부터 `REJECTED(SOLD_OUT)`"을 글자 그대로 따라, 대기 한도 0에서 `replaceTo: WAITLIST`로 밀려난 1등은 대기 1순위에 들어가자마자 품절이 된다(사실상 `CANCEL`과 같은데 상태는 `REJECTED(SOLD_OUT)`). 화면(S05)이 한도 0일 때 `WAITLIST`를 막거나, 규칙에 "한도 0이면 WAITLIST는 CANCEL과 같다"를 적을지 판단 부탁. 지금은 규칙 문장 그대로다.
2. **빈 자리가 있는데 교체를 적은 경우.** "빈 자리가 있어도 교체를 적었으면 교체한다"(D-042)를 따르면, 재고 2에 1등 1명일 때 그 1등을 대기로 교체하면 대기 1순위가 빈 자리를 두고 기다린다. 다음 새 찜은 R-4 6번 줄(확정 < 재고)이 7번 줄보다 앞서 확정되고, 대기자는 다음 승계를 기다린다. 승계(R-8)는 "1등 취소 시"에만 일어나므로 지금은 이대로 두었다. 교체 직후 빈 자리를 대기 1순위로 채울지 판단 부탁.
3. **R-4 4번 줄 "메시지는 DUPLICATE로 기록".** 엔진 상태에는 메시지별 판정 기록을 두지 않았다(찜을 만들지 않는다는 점만 지킨다, `claimCount`). 메시지 원문과 순서는 서버의 이벤트 로그(입력 우선 기록)가 갖는다. 콘솔이 "이 메시지는 같은 사람 반복이라 무시됨"을 보여 줘야 하면 S05에서 메시지 → 판정 색인을 더할 수 있다.
4. **효과 ID의 `{대상}` 자리.** R-13 형식은 대상이 없는 효과(라벨·폐기)를 말하지 않는다. `-`를 넣었다(`c1:PRINT_PRODUCT_LABEL:-:1`). outbox(S11)가 이 ID로 한 번만 실행하므로 바꾸려면 그 전에 정해 달라.

### 남은 범위 (S03 이후, 엔진은 미구현을 알린다)
- 이벤트: `sms`, `product.update`, `product.renumber`, `host.convertMessage`, `host.resolveConflict`, `buyer.merge`, `buyer.unmerge`, `settlement.*`(S03), `broadcast.start`·`broadcast.end`(S04), `effect.failed`(S11).
- 설정: `contention.policy=RECEIVED_TIME`, `settlement.groupBy=MANUAL`.
- 조회 결과의 `conflict`는 항상 false, `priceHistory`는 항상 빈 목록, 정산의 조정·환불 0·`UNPAID`(S03이 채운다).

### 검증
- `pnpm verify` 6단계 통과(결과 보고에 그대로).
- 골든: 파일 12 · 파서 사례 379 · 엔진 시나리오 66 · 통과 425 · 불일치 0 · 미구현(허용) 20 · 미구현(불허) 0 · 읽기 오류 0 · 결정성 위반 0 · 러너 오류 0.
- 코어 커버리지: 라인 100% · 분기 98%대.
- 속성 테스트를 로컬에서 4,000회씩 돌려 통과. 엔진 규칙을 일부러 틀리게 바꾼 8가지(AUTO 취소의 잠금 무시, 대기 취소 때 목록 정리 누락, 확정버전 건너뜀, 확정 해제 때 합계 누락, 승계 표시 정리 누락, 4번 줄 순서, 완료 효과 재보고, 차단이 확정 찜 거절)를 속성 테스트가 모두 잡는 것을 확인.

### 수정 라운드 1

#### TD-S02-001 — DISPUTED (규칙 문장대로 동작함, 규칙이 정하지 않은 빈틈이라 spec-keeper 판정 요청)
- 재현 확인: 지적의 순서(기본 설정, 대기 한도 2: 등록 15 → A `15` → B `15` → A 차단 → B에게 배정, A를 `WAITLIST`로 교체 → B 취소)에서 A(`c1`)가 다시 확정되고 `c1:PRINT_PRODUCT_LABEL:-:3`, `c1:POST_THANKS:LIVE_CHAT:3`(`15번 핑크프릴 10,000원 A님 구매 감사합니다`)가 나온다.
- 추가로 찾은 피해: 대기가 꽉 찬 상태에서 차단된 1등을 `WAITLIST`로 교체하면, 차단된 사람이 대기 1순위를 차지하고 **죄 없는 맨 끝 대기자가 `REJECTED(SOLD_OUT)`**가 된다. 재현: 대기 한도 2, A `15`(확정) → B `15`·C `15`(대기) → D가 주문 아닌 채팅 → A 차단 → D에게 배정, A를 `WAITLIST`로 교체 ⇒ A 대기 1순위, B 대기 2순위, C 품절.
- 왜 고치지 않았나: 엔진은 규칙 문장을 그대로 따른다. 규칙을 바꾸는 선택이라 개발자가 정하지 않는다(dev-common "스펙과 다르게 해야 할 것 같을 때", HARNESS §1 "모호하면 DISPUTED").
  - R-9 `host.assign` 세부(D-042): "`WAITLIST`면 그 1등을 대기 1순위로 넣고, 대기가 `waitlist.max`를 넘으면 맨 끝 대기자부터 `REJECTED(SOLD_OUT)`." 교체 대상이 차단됐을 때의 예외가 없다.
  - R-9 `host.blockBuyer`(D-040): "**차단하는 순간** 그 구매자의 대기·보류 찜은 모두 `REJECTED(BLOCKED)`이고 … 확정 찜은 그대로 둔다." 차단 뒤 확정 찜이 대기로 옮겨지는 경우는 말하지 않는다.
  - R-4 1번 줄은 "차단 후 **들어오는** 찜"(새 찜)에만 적용된다. 교체는 새 찜이 아니라 기존 찜의 상태 변경이다.
  - R-8 `AUTO`: "대기 1순위가 `CONFIRMED`가 되고 새 효과(라벨·감사)가 나간다." 차단 여부를 보는 문장이 없다.
- spec-keeper에게 권하는 안: **지적의 (a) 변형 — 교체 대상이 차단된 구매자이고 `replaceTo=WAITLIST`면 그 찜은 대기에 넣지 않고 `REJECTED(BLOCKED)`로 끝낸다(대기 넘침 정리도 일어나지 않음).**
  - D-040의 뜻(차단된 사람은 대기에 없다)을 "차단하는 순간"뿐 아니라 "그 뒤에 대기로 가야 할 때"까지 넓힌 것이라, 그 찜의 결과가 "교체한 뒤에 차단했을 때"와 같아진다(`REJECTED(BLOCKED)`, 차단과 교체의 순서가 달라도 같은 결과).
  - 대기 넘침으로 죄 없는 대기자가 품절되는 피해도 함께 막는다. (b)(승계 때 건너뛰기)는 교체 순간의 넘침 피해를 못 막고, 대기→확정으로 가는 다른 자동 경로(S03 재고 늘림 R-10 "대기 1순위부터 확정")마다 같은 예외를 다시 적어야 한다.
  - (c)(화면에서만 막기)는 엔진이 서버 API·재생으로 같은 이벤트를 받을 수 있어 단독으로는 부족하다. (a)를 정한 뒤 화면이 차단된 1등의 교체 옵션 기본값을 `CANCEL`로 두는 것은 S05에서 덧붙이면 된다.
  - 같은 빈틈이 S03 R-7(역전 "w → 대기 1순위", 충돌 `SWITCH` "w는 대기 1순위로")에도 있다. 문장을 "차단된 구매자의 확정 찜이 대기로 가야 할 때(교체 `WAITLIST`, 역전, `SWITCH`)는 `REJECTED(BLOCKED)`"처럼 일반화하면 S03에서 다시 묻지 않아도 된다.
- 판정이 (a)로 나면 구현은 `packages/core/src/engine/reducer.ts`의 `replaceWinner`에서 `cancel`이 아니고 `d.isBlocked(target.buyer)`이면 `finish(target, slot, 'REJECTED', 'BLOCKED')`로 끝내는 한 갈래와 단위 테스트(두 재현 순서)다. 확정이 풀릴 때 규칙(R-13: 미실행 효과 취소, 출력된 라벨 `VOID_LABEL`)은 `unconfirm`이 이미 처리한다.

#### TD-S02-001 — FIXED (spec-keeper 판정 UPHOLD, D-049 반영)
- 판정: D-049 "차단 중인 구매자의 찜은 대기에 들어가지 않는다"(DOMAIN_RULES v0.1.6 R-9), 골든 G-ENG-088·089.
- 구현: `packages/core/src/engine/reducer.ts` `replaceWinner` — `replaceTo=WAITLIST`인데 밀려나는 1등이 차단 중이면 대기에 넣지 않고 `REJECTED(BLOCKED)`. 대기가 늘지 않으므로 `assign`의 넘침 정리(맨 끝 `SOLD_OUT`)도 일어나지 않는다. 확정이 풀릴 때 규칙(미실행 효과 취소, 출력된 라벨 `VOID_LABEL`)은 `unconfirm`이 그대로 처리한다. 배정받는 구매자의 차단 여부는 계속 보지 않는다(D-042).
- 단위 테스트(`engine-rules.test.ts` "차단 중인 구매자의 찜은 대기에 들어가지 않는다"): 두 재현 순서, 대기 한도 0(품절 아닌 차단 거절), 배정받는 사람의 대기 찜이 빠질 때, 차단·교체 순서가 바뀌어도 같은 결과, `CANCEL`·차단 해제 뒤 교체·차단된 사람에게 배정.
- 속성 테스트(`engine-properties.test.ts`): 매 이벤트 뒤 "차단 중인 구매자에게는 대기·보류 찜이 없다"를 검사. 수정 전 코어로 돌리면 무작위 로그 두 종류와 고정 시드 회귀가 모두 이 검사로 실패하는 것을 확인했다(새 단위 테스트 5개, 골든 합계 테스트도 실패).
- 골든 합계(`core-adapter.test.ts`, AC-S02-90): 엔진 시나리오 68 · 통과 427.
- S03 메모: R-7 역전·충돌 `SWITCH`로 확정 찜이 대기로 갈 때도 같은 문장을 따른다(D-049). 그때 대기로 보내는 곳을 `replaceWinner`의 갈래와 같은 도우미로 묶는다.
