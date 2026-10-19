# S03 리포트 — 코어 III: 문자찜·경합·충돌, 상품 수정, 구매자·정산 계산

**결과: PASS** (수정 라운드 0, 남은 blocker/major 0, minor 8 · nit 1)

## 영역별로 만든 것

### core (dev-core) — `pnpm verify` 6단계 통과
- `applyEvent`가 S03 이벤트를 모두 받는다: 문자찜(`sms`), `product.update`·`product.renumber`, `host.convertMessage`, `host.resolveConflict`, `buyer.merge`/`unmerge`, 정산 기록 네 가지(`shippingOverride` `DEFAULT` 포함). RECEIVED_TIME 설정으로도 시작한다.
- 남은 미구현: `broadcast.start`·`broadcast.end`, `effect.failed`, `settlement.groupBy=MANUAL`.
- 형식 오류 이벤트는 `InvalidEventError`를 던지고, 같은 검사를 하는 `checkEvent`를 내보낸다(D-050).
- 상태 형식 2: 상품 ID 도입(번호 변경 시 찜이 상품을 따라감), 구매자 합치기 나무 연결, 정산 기록은 적힌 구매자에 붙고 조회 때 합산.
- 성능(AC-S03-05): 영속 맵 잎을 [키, 값] 배열로 바꾸고 트라이를 3단계로. 보류 찜 5천→2만 약 4.4배, 한 구매자 찜 2천→8천 약 2.4배, `checkInvariants` 한 번 순회 3.4~4.7배(기준 8배 이하). 섞은 로그 약 1만 3천 건 약 60ms, p99 0.01ms.
- 골든: 파일 16 · 파서 379 · 엔진 95 · 통과 474, 불일치·미구현·읽기 오류 0. 커버리지 라인 100%, 분기 99.69%. 코어 테스트 1046개, 적대 560개 통과.
- S02 테스트 교체(약화 아님): 형식 오류 → AC-S03-02, "S03 미구현" → AC-S03-01, AC-S02-05 → AC-S03-05.

### domain 테스트 (test-domain)
- `tests/adversarial/s03/helpers.ts` — S03 이벤트 생성 도구
- `engine-model-s03.test.ts` — ARRIVAL·RECEIVED_TIME 참조 모델 대조, 시드 고정 300회
- `engine-s03-chains.test.ts` — 번호 변경 뒤 늦은 보고, 문자찜·합치기 DUPLICATE, 합치기·입금·환불 순서, UNPAID_CLAIMS, 여러 방송 정산 묶음, 변환 충돌, RECEIVED_TIME 재고 2 역전 사슬, 개인정보, 처리 비용

## 남은 blocker/major

없음.

## 자율 결정 · 사용자 확인 필요 사항

| ID | 결정 | 비고 |
|---|---|---|
| D-050 | 형식 오류는 입력 오류를 던지고, 상태에 맞지 않는 명령은 아무 일도 없음 | |
| D-051 | 문자찜 구매자: 지정 → 휴대폰 번호(01로 시작 10~11자리) → 새 문자 구매자. 뒤 4자리만 노출 | TD-S03-001 관련 |
| D-052 | RECEIVED_TIME 정렬 키 (T, r, seq) | |
| D-053 | 역전 비교 대상·대기 자리·잠금·상품당 충돌 하나 | |
| D-054 | 이미 찜을 만든 메시지 변환은 아무 일도 없음 | SA-S03-001과 어긋남 |
| D-055 | 상품 수정은 원자 적용, 재고 늘린 수만큼 대기 1순위부터 확정 | |
| D-056 | 번호 변경: 상품 기록 있으면 거부, 확정버전 이어 세기 | |
| D-057 | 합치기에서 확정 둘이면 거부, 나머지 중복은 DUPLICATE | |
| D-058 | `DEFAULT` 추가, 최종 금액 0 하한, 받은 금액 초과 환불은 무시 | |
| D-059 | MANUAL 묶기는 정산 화면과 함께 | **확인 필요**: S04 이후 core 스프린트가 없음. S06에 core를 더하거나 따로 코어 작업 필요(D-008은 사용자 확정 결정) |
| D-060 | S02 남은 질문 정리, outbox 키 (판매자, 엔진 범위, 효과 ID) | |

dev-core 자체 결정: 문자 구매자 ID `sms:<ref>`(`sms:` 채팅 채널 ID는 입력 오류), 표에 없는 필드 무시, 공백뿐인 사유는 빈 사유, `host.assign` replace·replaceTo 한쪽만은 아무 일도 없음(SA-S03-004).

**사용자/spec-keeper 확인 필요**
1. RA-S03-001: 휴대폰 번호 평문이 엔진 상태에 저장됨. S04는 server만이라 core 변경 불가 → S04 전에 (a) 엔진이 HMAC 키+뒤 4자리를 받는 방식으로 바꾸거나 (b) S04에 core 추가.
2. D-059: MANUAL 묶기를 맡을 core 스프린트 배정.
3. 충돌 중 교체 배정(SA-S03-003·RA-S03-002), 변환 막기 범위(SA-S03-001), 채팅 취소 대상(SA-S03-002), assign 한쪽 필드(SA-S03-004), 문자찜 ref 기록(TD-S03-001), 충돌 해제 시 대기 넘침(TD-S03-002), 확정버전 순서(SA-S03-005)의 규칙 문장 판정.

## minor / nit 백로그

| ID | 심각도 | 제목 | 위치 |
|---|---|---|---|
| SA-S03-001 | minor | 주문이었지만 찜을 만들지 않은 메시지 변환 시 취소된 구매자가 옛 순위로 돌아와 충돌 | reducer.ts:482 |
| SA-S03-002 | minor | 시청자 채팅 취소를 지금의 구매자로 찾아 합친 상대 찜에 걸림 | reducer.ts:314 |
| SA-S03-003 | minor | 충돌 중 교체 배정 뒤 충돌이 남음 | reducer.ts:418 |
| SA-S03-004 | minor | assign replace·replaceTo 한쪽만 적혀도 입력 오류 아님 | validate.ts:90 |
| SA-S03-005 | nit | 재고 늘림 확정버전이 대기 순번 순서 | reducer.ts:244 |
| RA-S03-001 | minor | 휴대폰 번호 전체 평문이 엔진 상태에 저장 | reducer.ts:344 |
| RA-S03-002 | minor | 충돌 중 교체 배정 뒤 SWITCH가 방금 배정한 1등을 밀어냄 | reducer.ts:418 |
| TD-S03-001 | minor | 모르는 지정 구매자 문자찜이 ref를 남기지 않아 사본 재입력 결과가 달라짐 | reducer.ts:334 |
| TD-S03-002 | minor | 대기 가득 찬 상태에서 충돌 자동 해제 시 대기 맨 끝이 SOLD_OUT | rules.ts:393 |

모두 `harness/backlog.yaml` techDebt에 추가했다.

## 추적성

| 기준 | 구현 | 테스트 |
|---|---|---|
| AC-S03-01 엔진 API 확장 | reducer.ts:655-701, validate.ts:30-34, views.ts:54-339 | engine-s03-api.test.ts, engine-api.test.ts |
| AC-S03-02 입력 오류 | validate.ts:11-157, reducer.ts:691-696 | engine-api.test.ts, engine-properties-s03.test.ts |
| AC-S03-03 순수·결정성·TZ | time.ts, draft.ts | engine-s03-api.test.ts, engine-sms.test.ts:299 |
| AC-S03-04 맞지 않는 명령 | reducer.ts 여러 곳 | 골든 G-ENG-100·119·120·131·132·141·145 |
| AC-S03-05 처리 비용 | pmap.ts, invariants.ts:78-149, views.ts:272-303 | engine-timing.test.ts, engine-s03-chains.test.ts |
| AC-S03-10~13 문자찜 | reducer.ts:325-359, phone.ts, time.ts:41-52 | engine-sms.test.ts; 골든 G-ENG-030·055·060·071·072·100~102·142 |
| AC-S03-20~25 정렬·대기·역전·잠금·충돌·보류 | rank.ts:20-42, rules.ts:194-418 | engine-contention.test.ts; 골든 G-ENG-031~037·110~123 |
| AC-S03-26 메시지 변환 | reducer.ts:479-497 | engine-contention.test.ts; 골든 G-ENG-037·120 (SA-S03-001) |
| AC-S03-30~33 상품 수정·재고·재출력·번호 변경 | reducer.ts:204-280 | engine-product-edit.test.ts; 골든 G-ENG-040~042·130~133 |
| AC-S03-40~42 구매자 보기·합치기·이름 | views.ts:148-196, reducer.ts:521-602 | engine-buyers-settlement.test.ts; 골든 G-ENG-050·051·054·140~142 |
| AC-S03-50~53 정산 | ledger.ts, views.ts:221-303, reducer.ts:607-633 | engine-buyers-settlement.test.ts; 골든 G-ENG-051~056·070·073·143~145 |
| AC-S03-60 확정버전·효과 경로 | rules.ts:122-189, reducer.ts:275 | engine-properties-s03.test.ts |
| AC-S03-90 골든 결과 | known-unimplemented.yaml (빈 목록) | pnpm verify golden 474 통과 |
| AC-S03-91 러너·어댑터 | contract.ts:205, core-adapter.ts | core-adapter.test.ts, read-errors.test.ts |
| AC-S03-92 불변식 속성 | invariants.ts:30-149 | engine-properties-s03.test.ts, engine-model-s03.test.ts |
| ORD-08·09·10, PRD-02, BUY-01~04, STL-01·02·03·07·09 | 위 AC 참조 | 위 AC 참조 |

## 다음 스프린트 제안

1. **S04 착수 전**: RA-S03-001(번호 평문) 결정. 엔진 이벤트 모양을 바꾼다면 S04에 core를 더하거나 짧은 코어 작업을 먼저 잡는다. `ref`는 서버가 만든 무작위·일련 ID라는 문장을 DAT-06/R-1에 넣는다.
2. spec-keeper 일괄 판정: 충돌 중 교체 배정(SA-S03-003·RA-S03-002), SA-S03-001·002·004·005, TD-S03-001·002. 판정 뒤 골든·단위 테스트로 고정.
3. D-059 MANUAL 묶기를 맡을 core 작업을 S06 등에 배정.
