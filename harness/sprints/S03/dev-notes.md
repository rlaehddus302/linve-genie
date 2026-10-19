# S03 개발 노트

## dev-core

### 만든 것
- `@livejjim/core` 판정 엔진 S03 (`packages/core/src/engine/**`, 재수출 `src/engine.ts`)
  - `applyEvent`가 S03 이벤트를 받는다: `sms`, `product.update`, `product.renumber`, `host.convertMessage`, `host.resolveConflict`, `buyer.merge`, `buyer.unmerge`, `settlement.shippingOverride`(`DEFAULT` 포함)·`adjust`·`payment`·`refund`. `contention.policy=RECEIVED_TIME`(동률 처리 셋)도 시작한다.
  - 미구현(`NotImplementedError`)이 남는 곳: `broadcast.start`·`broadcast.end`(S04), `effect.failed`(S11), `settlement.groupBy=MANUAL`(D-059, `initEngine`).
  - 입력 오류(D-050): `InvalidEventError`(`problems: { field, message }[]`, `eventType`), 판별 `isInvalidEvent`, 같은 검사 `checkEvent(state, event) → EventProblem[]`(빈 목록이면 통과). `applyEvent`는 입력 오류면 상태를 바꾸지 않고 던진다. `EVENT_TYPES` = 엔진이 처리하는 종류.
  - 순수 도우미: `normalizePhone`(D-051), `phoneLast4`, `resolveReceivedTime(received, at) → { time, minute } | null`(D-023), `isValidReceivedTime`, `isValidDate`, `rankKey`·`compareRank`·`isSameMinuteTie`(D-052), `settle`(R-12 금액 계산).
  - 조회: `currentBuyerOf`(지금의 구매자), `buyerOfRef`(문자찜 ref → 그 문자찜이 정한 구매자 자신), `listSmsRefs`. 기존 조회 결과에 더한 것:
    - 상품: `id`(상품 ID, 번호를 바꿔도 그대로), `winnerClaims`·`waitlistClaims`, `conflict`·`conflictClaim`·`conflictBuyer`, `priceHistory`(`{ from, to, at }`), `nameHistory`. `winners`·`waitlist`는 지금의 구매자.
    - 찜: `productId`, `currentBuyer`, `origin`(`chat`·`sms`·`assign`·`convert`), 순위 재료 `seq`·`rankTime`·`rankMinute`(분 단위 문자는 구간 시작), `received`(문자 원문 수신 시각), `reprintNeeded`, `priceHistory`(찜별, UNPAID_CLAIMS). `product`는 지금의 상품 키. `locked`는 입금 기록 잠금 포함.
    - 구매자: `kind`(`youtube`·`sms`), `current`, `mergedInto`, `merged`(아래쪽 전부), `phoneLast4`(전체 번호는 보이지 않는다). `items`·`subtotal`·`byBroadcast`는 자신과 아래쪽 전부, 표시 이름은 자신의 것.
    - 정산: `buyer`는 지금의 구매자(넘긴 구매자를 풀어 준다), `shippingOverride`, `received`, `records`(적힌 구매자·종류·금액·사유·메모, 적힌 순서). 품목 없이 기록만 있는 묶음도 목록에 있다.
    - 효과·취소 요청: `currentBuyer`. 효과의 `buyer`·`product`는 나온 때의 것(구매자 자신, 그때의 상품 키).
- 골든 러너: 계약에 `mode: DEFAULT`, 읽기 오류 픽스처 `05-event-fields-settlement.yaml`(DEFAULT에 amount). 어댑터는 이벤트 구매자 키(`buyer`·`replace`·`from`·`into`)를 `buyerOfRef`로 구매자 자신의 ID로, 관찰은 `currentBuyer`·`listSmsRefs`로 지금의 구매자로 바꾼다(값은 다시 계산하지 않는다).
- 테스트(`packages/core/test/`): `unit/engine-{sms,contention,product-edit,buyers-settlement,s03-api,properties-s03}.test.ts` 새로, `engine-{api,views,invariants,properties,timing}.test.ts`·`golden/{core-adapter,read-errors}.test.ts` 갱신.

### 상태 모양 (형식 2)
- `{ format: 2, broadcasts, settings, counters{claims,effects,buyers,products}, messages, refs, phones, buyers, blocked, slots, products, claims, effects, ledger }`. 모음은 모두 영속 맵(`PMap`).
- `PMap`을 바꿨다: 세 단계 32칸 트라이, 잎은 `[키, 값]` 쌍의 배열. 잎을 키가 제각각인 객체로 두면 넣을 때마다 실행 엔진이 새 숨은 클래스를 만들어 맵이 커질수록 넣는 비용이 늘었다(측정: 한 번호 보류 찜 5천 → 2만에서 7.4배, 바꾼 뒤 3.9배).
- 번호(`slots`)의 `pending`(보류 찜 집합)·`active`(지금의 구매자 → 활성 찜)와 구매자의 `claims`는 레코드 안에서도 영속 맵이라 복사할 때 통째로 복사하지 않는다. 통째로 복사하는 배열은 설정으로 크기가 정해지는 `winners`(≤ 재고)·`waitlist`(≤ 대기 한도)와 작은 이력뿐(TD-S02-002).
- 상품 레코드에 `id`(`p1`부터). 찜은 판정받은 상품의 `pid`를 갖고, 조회 때 `products`(상품 ID → 지금 키)로 지금의 상품 키를 보인다. 번호를 바꿔도 찜 기록을 고치지 않는다.
- 구매자: `kind`, `phone`(숫자만), `parent`(바로 위), `children`, `dates`(정산 기록 날짜). 문자 구매자 ID = `sms:<그 구매자를 만든 ref>`.
- 메시지: `{ ch, seq, at, publishedAt, ignored, claimed }` — 메시지 변환의 대상과 "이미 그 번호의 찜을 만든 메시지" 판단(D-054).
- 정산 기록(`ledger`): (구매자 자신, 날짜) → 기록 목록. 묶음은 볼 때 합친 구매자들 것을 더한다(D-057). 잠금·입금 전 판단도 같은 함수(`ledger.ts`).
- `checkInvariants`는 찜·번호·구매자·정산 기록을 한 번씩만 돈다. 영속 맵은 키마다 찾지 않고 한 번에 훑어 맞춰 보고, 목록이 찜 상태와 같으면 끝난 찜 검사(INV-9)를 건너뛴다(RA-S02-001). 검사 항목: INV-1·2(지금의 구매자, 충돌 포함)·5·6(받은 금액·환불 필요 포함, 조정은 정수만)·7·9, `R-9`(차단 중인 구매자의 대기·보류·충돌 찜), `R-7`(충돌 하나·표시 ⇔ 찜·확정 수 = 재고).

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **문자 구매자 ID는 `sms:<ref>`이고, `sms:`로 시작하는 채팅 채널 ID는 입력 오류**다. README 이벤트 계약("채널 ID는 'sms:'로 시작할 수 없다 — 문자찜 구매자 키와 겹친다")을 따른 것으로, 유튜브 채널 ID와 문자 구매자 ID가 구조적으로 겹치지 않는다. ref가 구매자 ID와 효과의 `buyer` 칸에 들어가므로 **서버는 ref에 전화번호·이름 같은 개인정보를 넣으면 안 된다**(S04 인계).
- **모르는 지정 구매자의 문자찜은 ref도 받지 않는다**(이벤트 전체가 아무 일도 없음). 그래서 고쳐서 다시 보내면 받는다.
- **메모가 있는 새 문자 구매자는 처음 이름부터 `문자찜(메모)`**(골든 G-ENG-100 이름 이력). 공백뿐인 메모는 메모가 없는 것과 같다.
- **"이미 그 번호의 찜을 만든 메시지"는 글자 그대로** 그 메시지가 그 번호의 찜 기록을 만든 경우다(주문이 거절·취소됐어도 해당). 주문이었지만 같은 사람 반복(4번 줄)이라 찜을 만들지 않은 메시지는 나중에 변환할 수 있다(그때도 4번 줄을 먼저 본다).
- **찜의 상품 키가 상품을 따라가는 범위**: 상품이 있는 번호에서 판정받은 찜(확정·대기·충돌·거절·만료·판매 종료 거절)은 그 상품의 찜이다. 상품이 없을 때 생긴 보류 찜·차단 거절은 번호에 남는다.
- **시청자 채팅 취소도 지금의 구매자로 찾는다**: 합쳐진 유튜브 채널의 "15 취소"는 묶음의 15번 활성 찜에 걸린다(R-4 "같은 구매자는 지금의 구매자"와 같게).
- **대기 넣는 자리의 비교는 판정 순위 키 그대로**(접수순이면 seq — 변환 찜은 원래 메시지 seq라 가운데로 들어갈 수 있다). 접수순의 새 찜은 늘 맨 끝이라 S02 동작 그대로다.
- **SWITCH의 w는 c를 뺀 확정 찜 중 가장 뒤**다(c를 넣고 고르면 HOST 동률에서 c 자신이 될 수 있다).
- **처리 순서**: 역전·SWITCH는 w 확정 해제(효과 취소·폐기) → c 확정 → w 대기 1순위(차단이면 거절) → 넘침 정리. 1등이 빠질 때 충돌이 있으면 충돌을 KEEP처럼 넣은 뒤 승계(REOPEN이면 넣은 충돌 찜도 대기 정리).
- **충돌 중 다른 구매자에게 교체 배정(`host.assign` + `replace`)은 받는다**: 확정 수가 그대로라 충돌은 남고, 그 뒤 SWITCH는 그때 순위가 가장 뒤인 1등과 바꾼다(규칙 문장에 막는 말이 없다). 아래 질문 2.
- **입력 오류가 아닌 것**(D-050 목록 밖, S02 동작·적대 테스트 유지): 이벤트 표에 없는 필드는 무시한다. `host.assign`의 `replace`·`replaceTo` 한쪽만은 맞지 않는 명령(아무 일도 없음). 닉네임 빈 문자열은 받는다. 사유는 공백뿐이면 빈 사유로 본다(골든 계약 `nonEmptyStr`와 같게).
- **처음 쓰는 스프린트가 따로 있는 종류**(`broadcast.*`·`effect.failed`)의 `checkEvent`는 seq·at만 보고, `applyEvent`가 `NotImplementedError`를 던진다.
- **S02 테스트 교체(약화 아님, 스펙 변경)**: "형식이 틀린 이벤트는 아무것도 바꾸지 않는다" 항목을 AC-S03-02 입력 오류 테스트로, "S03 기능은 미구현" 블록을 AC-S03-01 경계 테스트로, AC-S02-05 처리 시간(이벤트 하나 50ms)을 AC-S03-05(p99·준비 구간 제외)로 옮겼다. 맞지 않는 명령 항목은 그대로 두었다.

### spec-keeper에게 (규칙 문장이 정하지 않았거나 판매자에게 어색할 수 있는 것)
1. **`host.assign`의 `replace`·`replaceTo` 한쪽만**: 골든 계약은 읽기 오류, D-050 입력 오류 목록에는 없다. S02 동작(맞지 않는 명령)과 S02 적대 모델을 지키려고 입력 오류로 올리지 않았다. 입력 오류로 할지 정해 달라(서버가 S04에서 기록 전에 거를지가 달라진다).
2. **충돌 중 교체 배정**: D-053의 이유("방송자가 고르는 동안 1등이 바뀌면 화면의 질문이 낡는다")와 달리, 방송자가 직접 다른 구매자에게 교체 배정하면 1등이 바뀐 채 충돌이 남는다. 규칙 문장에 막는 말이 없어 받았다. 충돌 중에는 교체 배정을 막을지(맞지 않는 명령), 받되 화면이 다시 묻게 할지 판단 부탁.
3. **ref와 개인정보**: 문자 구매자 ID에 ref가 들어간다. R-1은 ref를 "문자찜 입력 ID"라고만 한다. 서버가 만드는 ID(무작위·일련번호)여야 한다는 문장을 DAT-06/S04에 넣어 두기를 권한다.

### 검증
- `pnpm verify` 6단계 통과(결과 보고에 그대로).
- 골든: 파일 16 · 파서 사례 379 · 엔진 시나리오 95 · 통과 474 · 불일치 0 · 미구현 0 · 읽기 오류 0 · 결정성 위반 0 · 러너 오류 0.
- 코어 커버리지: 라인 100% · 분기 99.7%.
- 속성 테스트(S03 생성기)를 로컬에서 시나리오 1,500개·변형 이벤트 3,000개씩 두 번 돌려 통과.
- 처리 비용(로컬): 보류 찜 5천 → 2만 4.4배, 한 구매자 찜 2천 → 8천 2.4배, `checkInvariants` 크기 4배 3.4~4.7배. S03 로그(이벤트 약 1만 3천) 전체 약 60ms, 준비 구간을 뺀 p99 0.01ms, 가장 느린 이벤트 약 3ms. 커버리지 계측 아래에서도 같은 비율.
- 러너 자체 확인: S03 골든에서 기대값을 1원 틀리게 바꾸거나, 전화번호로 잇지 않는 코어·지금의 구매자로 풀지 않는 관찰을 넣으면 해당 시나리오가 불일치로 실패한다(`core-adapter.test.ts`).
