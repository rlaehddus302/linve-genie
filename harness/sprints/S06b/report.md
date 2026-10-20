# S06b 리포트 — 1단계 화면 다듬기 (S06 감사 지적 정리)

**결과: PASS** — 수정 2라운드, 남은 blocker/major 0. `pnpm verify`(TZ=Pacific/Honolulu) 7단계 모두 통과, e2e 169 통과, 커버리지 라인 100%·분기 99.66%.

스펙 커밋 801c91c, BASE 41356ad. 새 기능 없이 S06의 minor 지적을 닫았다.

## 영역별로 만든 것

### core
- `previewMerge(state, from, into)`: 상태를 바꾸지 않는 순수 조회. 막힘 사유(UNKNOWN_BUYER→SAME_BUYER→FROM_MERGED→CYCLE→BOTH_CONFIRMED), bothConfirmed, moving, after, duplicates를 돌려준다.
- R-11 합치기 규칙을 `packages/core/src/engine/merge.ts`(planMerge/applyMerge)로 모았고, 리듀서와 조회가 같은 계획 함수를 쓴다. 막히지 않으면 결과가 `applyEvent(buyer.merge)`와 같다(fast-check로 검증).
- 골든 러너에 expect 키 `mergePreviews`와 읽기 오류 범주 20, 스냅샷 키 `buyerSelf`를 더했다. runner-s06b.test.ts 52개.
- core-adapter 고정 합계 교체: 파일 23 · 파서 379 · 엔진 123 · 통과 502.

### server
- `GET /api/days/:date/merge-preview?from=&into=[&rehearsal=true]` → `{date, rehearsal, seq, preview}`. seq와 상태를 같은 시점에서 읽는다. 입력 검사 400, 휴대폰 번호 모양 ID는 hint와 함께 거부하고 값을 남기지 않는다. 404/401/no-store는 날짜 조회와 같다.
- 문자찜 쓰기 응답에 `buyer`(코어 buyerOfRef, 정하지 못하면 null). 재전송 세 경로 모두 같은 값.
- `ViewCacheBudget`: 판매자마다 4범위, 서버 전체 32범위, 마지막 조회 10분 뒤 비움(주입 시계로 시험). 상한 1,536 → 384 항목.
- 새 시험: merge-preview 10, sms-buyer 6, view-budget 10.

### web
- 모든 화면이 한 이름 함수(`buyerLabels`) 사용: "· 끝 1234" / "· 뒤 4자리 5678" / "· 문자 20:01:05", 그래도 겹치면 생성 순서로 " · 2"부터. 라운드 2에서 합쳐진 구매자 포함 모든 최종 라벨을 화면상 모양(sameLook: NFKC, 서식 문자·한글 채움 문자 제거, 공백 정리)으로 비교해 항상 서로 다르게 했다(SA-S06b-002).
- 48rem 이상에서 구매자·정산 목록은 표. 라운드 1에서 태블릿·큰 금액 꺾임을 고쳤다(TE-S06b-001, `.table-scroll`).
- 날짜는 연도·요일 포함, 받은 시각은 "10/18 20:01:05".
- 정산 입력 창 머리에 이름·묶음 날짜·최종/받은/남은 금액, 네 창 모두 입금 상태 변화 미리 보기, 입금 상한 1억 원.
- 화면당 주요 버튼 최대 하나.
- 문자찜 결과는 응답 `buyer` 사용, smsHolder 제거. 고른 방송은 "✓ 고름".
- 합치기 미리 보기는 서버에서 받고, 오래된 미리 보기로는 보낼 수 없다. 상품을 다녀온 뒤 URL(merge/into)로 합치기 창 복원.
- 색은 data-tone 네 가지 + 글자. 폰 조치 기록은 목록. 충돌 창 표기를 " · "로(TE-S06b-003).
- 떠나기 창 닫은 뒤 5초 다시 시작, beforeunload returnValue, 첫 기록에서 뒤로 가기는 묻는다.

### 시험(domain·e2e)
- previewMerge 예측=실제 속성 시험, 엔드포인트·buyer·캐시 적대 시험, tests/e2e/s06b 전 웹 기준.
- 골든 19-s06b-merge-preview(G-ENG-174·175), 20-s06b-sms-buyer-payment(G-ENG-176·177).

## 남은 blocker/major

없음. 사용자 에스컬레이션도 없음.

## 자율 결정 · 사용자 확인 필요

모두 AUTO, 막지 않음.

| ID | 질문 | 적용 |
|---|---|---|
| D-098 | 같은 이름 구매자 구분 | 공용 이름 함수, " · " + 태그 하나, 겹치면 " · 2"~, 괄호 추가 안 함 |
| D-099 | 새 찜이 없을 때 어느 구매자인지 | sms 응답에 `buyer`, smsHolder 제거 |
| D-100 | 합치기 미리 보기 계산 위치 | 코어 previewMerge + 서버 엔드포인트, 오래되면 전송 막음 |
| D-101 | 정산·구매자 화면 다듬기 | 48rem 표, 입금 상한(화면만), 창 머리, 상태 미리 보기, 주요 버튼 규칙, 연도 표시 |
| D-102 | 색·조치 기록·합치기 복귀·시각 날짜·선택 표시 | data-tone 4종+글자, 목록, URL 유지, 날짜 포함, "✓ 고름"+aria-pressed |
| D-103 | 떠나기 창·첫 기록 뒤로 가기·앱 닫기 | 닫기 뒤 5초 재시작, returnValue, 가드 기록. 막을 수 없는 닫기는 보내지 않음(D-083 유지) |
| D-104 | 보기 캐시 전체 상한 | 판매자 4·서버 32범위, 10분 비움 |

**사용자 확인 필요**
- D-103: 앱을 쓸어 닫으면 대기 중 조치가 보내지지 않는다는 판매자 안내 문구.
- TE-S06b-002: 이름이 유일한 문자 구매자 행에 뒤 4자리 표시를 둘지(스펙 판단).
- TE-S06b-005: 합치기 창 "남는 이름" 표기 형식(스펙 판단).
- SA-S06b-001: D-901(적대 시험 전역 60초 제한) 결정 기록 여부.

## minor/nit 백로그 (techDebt에 추가)

- **SA-S06b-003** (minor, CONFIRMED): 단위 시간·속성 시험에 제한 조정이 없어 병렬 트랙 부하(load 8 이상)에서 test 단계가 실패할 수 있음. 이번 라운드는 load 12.48에서 통과. 제안: 여러 트랙 동시 full verify 중단 또는 긴 속성 시험 별도 제한을 결정으로 기록(임계값은 유지). 담당: 파이프라인(D-027).
- **SA-S06b-001** (minor, CONFIRMED): `vitest.adversarial.config.ts:14-17`의 60초 제한이 기록되지 않은 D-901을 근거로 듦. AC-S06b-51·범위 밖 목록과 어긋남. 제안: DECISIONS에 D-901 기록 후 AC 문구 정리.
- **TE-S06b-002** (minor, PLAUSIBLE): 이름이 유일한 문자 구매자는 뒤 4자리가 목록에 없음(`BuyersPage.tsx:238`, AC-S06-20 관련).
- **TE-S06b-005** (nit, PLAUSIBLE): 합치기 창 "남는 이름: 문자찜(김씨)(문자)" 괄호 추가(`BuyersPage.tsx:661`). 제안: "문자찜(김씨) · 문자".

## 추적성

| 기준 | 구현 | 시험 |
|---|---|---|
| AC-S06b-01 | packages/core/src/engine.ts (previewMerge, planMerge 공유) | packages/core/test/unit/engine-merge-preview.test.ts |
| AC-S06b-02 | 골든 러너 mergePreviews | packages/core/test/golden/runner-s06b.test.ts, tests/golden/engine/19-s06b-merge-preview.yaml |
| AC-S06b-03 | packages/core/src/engine.ts | tests/adversarial/s06b/merge-preview-property.test.ts |
| AC-S06b-10 | apps/server/src/api.ts, service.ts | apps/server/test/merge-preview.test.ts, tests/adversarial/s06b/server-s06b.test.ts |
| AC-S06b-11 | apps/server/src/api.ts, writer.ts | tests/adversarial/s06b/server-s06b.test.ts, tests/e2e/s06b/sms.spec.ts, G-ENG-176 |
| AC-S06b-12 | apps/server/src/views.ts, state-cache.ts | apps/server/test/view-budget.test.ts, tests/adversarial/s06b/server-s06b.test.ts |
| AC-S06b-20 / D-098 / BUY-01 AC2 | apps/web/src/lib/derive.ts:87-123 | apps/web/test/buyers.test.ts, tests/e2e/s06b/names.spec.ts |
| AC-S06b-21 | BuyersPage.tsx, SettlementsPage.tsx, lib/use-wide.ts | tests/e2e/s06b/settle.spec.ts, tests/e2e/s06/navigation.spec.ts |
| AC-S06b-22 | ScopePicker.tsx, SmsPage.tsx | tests/e2e/s06b/sms.spec.ts, leave.spec.ts |
| AC-S06b-23 | SettlementsPage.tsx, lib/settlement.ts | apps/web/test/settlements-page.test.tsx, tests/e2e/s06b/settle.spec.ts, G-ENG-177 |
| AC-S06b-24 | BuyersPage.tsx, SettlementsPage.tsx | tests/e2e/s06b/settle.spec.ts |
| AC-S06b-30 | SmsPage.tsx | tests/e2e/s06b/sms.spec.ts, apps/web/test/code-checks.node.test.ts |
| AC-S06b-31 | lib/kst.ts | tests/e2e/s06b/sms.spec.ts, tests/e2e/s06/sms.spec.ts |
| AC-S06b-32 | SmsPage.tsx, styles.css | apps/web/test/sms-page.test.tsx |
| AC-S06b-33 | BuyersPage.tsx, lib/merge-preview.ts | tests/e2e/s06b/merge.spec.ts, tests/e2e/s06/phase1.spec.ts |
| AC-S06b-34 | BuyersPage.tsx, lib/router.ts | tests/e2e/s06b/merge.spec.ts, tests/e2e/s06/buyers.spec.ts |
| AC-S06b-40 | styles.css (data-tone) | apps/web/test/sms-page.test.tsx |
| AC-S06b-41 | ProductDetail.tsx, styles.css | apps/web/test/console-s06.test.tsx, tests/e2e/s06b/leave.spec.ts |
| AC-S06b-42 | App.tsx, lib/undo-queue.ts | apps/web/test/undo-queue.test.ts, tests/e2e/s06b/leave.spec.ts |
| AC-S06b-43 | App.tsx, lib/router.ts | apps/web/test/console-s06.test.tsx, tests/e2e/s06b/leave.spec.ts |
| AC-S06b-50 | tests/golden (23파일) | pnpm golden 502 통과, 오류 0; core-adapter.test.ts |
| AC-S06b-51 | merge-preview-property.test.ts:281,305 (개별 60s); vitest.adversarial.config.ts:14-17 (SA-S06b-001) | pnpm adversarial 32파일 654 통과 |
| AC-S06b-52 | 파이프라인 전체 | pnpm verify 7/7 통과 |

## 다음 스프린트 제안

1. **파이프라인 정리(작게)**: D-901 기록과 AC-S06b-51 문구 정리(SA-S06b-001), 병렬 트랙 동시 verify 정책 또는 긴 속성 시험 제한 결정(SA-S06b-003). 다른 트랙 게이트 흔들림을 먼저 막는다.
2. **spec-keeper 판단**: TE-S06b-002(뒤 4자리 표시), TE-S06b-005(합치기 창 표기), D-103 안내 문구를 사용자 확인 후 다음 화면 스프린트에 반영.
3. 이후 진행 중인 병렬 트랙(P1 등)과 화면 통합으로 넘어간다.
