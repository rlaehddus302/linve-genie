# S06b 개발 노트

## dev-core

### 공개 모양 — `previewMerge` (AC-S06b-01, D-100) — 서버·화면이 먼저 알아야 할 것
`@livejjim/core`에서 함수와 타입을 내보낸다. 이름은 수용 기준의 기본 이름 그대로다.

```ts
import { previewMerge, type MergePreview, type MergeBlockReason, type MergeDuplicate, type MergeItems } from '@livejjim/core'

previewMerge(state: EngineState, from: string, into: string): MergePreview

type MergeBlockReason = 'UNKNOWN_BUYER' | 'SAME_BUYER' | 'FROM_MERGED' | 'CYCLE' | 'BOTH_CONFIRMED'

interface MergePreview {
  from: string                      // 넘긴 그대로 (구매자 자신의 ID — buyer.merge의 from)
  into: string                      // 넘긴 그대로 (buyer.merge의 into)
  blocked: MergeBlockReason | null  // null = 합칠 수 있다. 위에서부터 처음 맞는 것
  target: string | null             // 합친 뒤의 지금의 구매자 = into의 지금의 구매자 (into를 모르면 null — 막혀도 into를 알면 채운다)
  bothConfirmed: string[]           // 상품 키("b1/18"), 방송 선언 순서·번호 순. blocked가 BOTH_CONFIRMED가 아니면 []
  moving: { buyers: string[]; items: string[]; subtotal: number }
                                    // from과 그 아래 합쳐 있던 구매자 전부(from 먼저)와 그 확정 찜(상품 키, 찜 생성 순서 = getBuyer(from).items 순서)·가격 스냅샷 합.
                                    // = getBuyer(from)의 [id, ...merged]·items·subtotal (from이 이미 합쳐져 있어도 from 자신 아래만 — 지금의 구매자가 아니다)
                                    // 모르는 구매자면 { buyers: [], items: [], subtotal: 0 }. 막혀도 from을 알면 채운다
  after: { items: string[]; subtotal: number } | null
                                    // 막히면 null. 아니면 합친 뒤 target의 확정 찜 = applyEvent(buyer.merge) 뒤 getBuyer(target)의 items·subtotal
  duplicates: {                     // 막히면 []. 아니면 합치면 DUPLICATE가 될 찜 전부, 상품 키(방송 선언 순서·번호) 순
    claim: string                   //   그 찜 ID ("c12") — 대기 순번·상태 낱말은 범위 조회의 claims/products에서 이 ID로 찾는다
    product: string                 //   지금의 상품 키
    buyer: string                   //   그 찜의 구매자 자신 (지금의 구매자가 아니다)
    status: 'CONFLICT' | 'WAITLISTED' | 'PENDING'  // 지금 상태 (확정 찜은 중복이 되지 않는다)
    keep: string                    //   그 상품에 남는 찜 ID (R-11 "앞선 쪽" — 방향과 상관없이 같다)
  }[]
}
```

- 상태를 바꾸지 않는다(넘긴 상태를 얼려도 된다). 같은 입력이면 같은 값. 시계·난수·환경을 쓰지 않는다. 결과는 평범한 객체·배열이라 그대로 JSON으로 보낼 수 있다.
- 비용: from 나무의 활성 찜 수에 비례(판정과 같다) + 작업 사본 하나 반영. 범위 전체를 다시 돌지 않는다.
- 막히지 않으면 `applyEvent(state, buyer.merge(from, into))`와 같다: 상태가 바뀌고, DUPLICATE로 바뀐 찜 = `duplicates[].claim`, 그 뒤 `getBuyer(target)`의 `items`·`subtotal` = `after`. 막히면 같은 `buyer.merge`는 아무 일도 없다(`changed: false`).
- 서버는 `from`·`into`(구매자 ID)를 형식만 검사하고 그대로 넘기면 된다 — 범위에 없는 ID는 `blocked: 'UNKNOWN_BUYER'`.

### 만든 것
- `packages/core/src/engine/merge.ts` (새 파일): `planMerge(draft, from, into)`(막힘 이유·옮길 찜마다 남는 찜/중복이 될 찜 — 읽기만 한다)와 `applyMerge(draft, from, into, plan)`(그 계획대로 바꾼다). R-11의 막는 조건과 "앞선 쪽" 순서(확정 > 충돌 > 대기 앞 순번 > 보류 판정 순위)는 이 파일에만 있다.
  - 리듀서의 `buyer.merge` 처리는 `planMerge` → 막히지 않으면 `applyMerge`로 바꿨다. 판정 결과는 이전과 같다(같은 순서로 같은 기록을 바꾼다 — 영속 맵에 넣는 순서도 같다). 확정 둘 검사가 손상된 상태(없는 활성 찜)를 만나는 순서도 이전과 같게 두었다(확정 둘을 먼저 보고 막히면 오류 없이 끝).
  - 조회 `previewMerge`(views.ts)는 같은 `planMerge`로 막힘·중복을 정하고, 막히지 않으면 같은 계획을 새 작업 사본에 실제로 적용해 합친 뒤의 구매자를 읽는다(작업 사본은 넘긴 상태를 바꾸지 않는다).
- 단위 시험 `packages/core/test/unit/engine-merge-preview.test.ts`: 막힘 다섯 가지와 그 순서(둘 다 모름 = 모르는 구매자, 합쳐진 구매자를 자신에게 = 같은 구매자, 합쳐졌고 고리이기도 함 = 이미 합쳐짐), 재고 2, 방송 선언 순서·번호 순, 중복 정리 순서와 방향 무관, 보류끼리 실제 시각순, 합쳐진 구매자 아래 따라감, 합쳐진 구매자에게 합치기, 떼어 낸 뒤, 얼린 상태·직렬화 같음·두 번 같음, 리듀서·조회가 같은 계획 함수를 쓰는지(코드 검사), 작은 무작위 로그(재고 1·2, 채팅·문자찜(뒤 4자리 같은 두 번호)·취소·합치기·떼어 내기·보류·공개, 접수순·실제 시각순·HOST 동률)에서 모든 구매자 쌍 + 모르는 구매자의 "미리 보기 = 실제 합치기".
- 골든 러너 `mergePreviews` (AC-S06b-02) — `packages/core/test/golden/**`
  - 형식 계약(`contract.ts`·`validate.ts`): expect 키 `mergePreviews` = 맵 목록. 항목 키 `from`·`into`(필수)·`blocked`·`bothConfirmed`·`moving`·`after`·`duplicates`, `moving`·`after`는 `items`·`subtotal`(적은 것만), `duplicates[]`는 `product`·`buyer`·`status` 셋 다 필수.
    - 읽기 오류: 맵이 아닌 항목, `from`·`into` 없음·빈 키·휴대폰 번호(ID 칸, `notPhoneId`), 표에 없는 키, 열거값 밖의 `blocked`(다섯 이유 또는 null)·`status`(`CONFLICT`·`WAITLISTED`·`PENDING`), 0 이상 정수가 아닌 `subtotal`, 선언하지 않은 방송의 상품 키, 목록이 아닌 값, 시나리오에 없는 ref의 `duplicates[].buyer`. 픽스처 `fixtures/read-errors/20-merge-previews.yaml`(범주 20).
    - `from`·`into`는 README대로 엔진이 모르는 키도 받는다(이벤트에 나온 적 없는 채널, 시나리오에 없는 ref의 `sms:<ref>` — 키 그대로 넘겨 `UNKNOWN_BUYER`). 다른 expect 키의 구매자 키와 달리 "시나리오에 ref가 없다"를 읽기 오류로 보지 않는다(README `from`/`into` 행 "없는 ref는 키 그대로 넘긴다").
  - 실행(`runner.ts`): 중간 검사·마지막 expect에서 항목마다 그 시점 상태로 `engine.previewMerge(state, from, into)`를 부른다. 부를 때마다 상태 직렬화가 그대로인지 확인하고 바뀌면 러너 오류("합치기 미리 보기(mergePreviews[i])가 넘겨받은 상태를 제자리에서 바꿨다"), 결과 형식(`mergePreviewIssues`)이 틀리면 러너 오류. 결과 목록은 trace 한 단계(`<위치> mergePreviews`)로 넣어 두 번 실행 비교(결정성)에 들어간다. 코어에 `previewMerge`가 없으면 미구현(빈 목록이면 부를 것이 없어 그대로).
  - 키 풀이: 관찰 스냅샷에 선택 키 `buyerSelf`(구매자 키 → 구매자 자신 — 어댑터가 `buyerIdOf`로 채운다)를 더했다. `from`·`into`·`duplicates[].buyer`는 `buyerSelf`로 풀고 없으면 키 그대로(`buyerSelfOf`). `buyerKeys`(지금의 구매자)와 다른 기존 비교는 바뀌지 않는다. `snapshot-check`는 `buyerSelf`를 있어도 되는 키로 받는다(문자열 맵).
  - 비교(`compare.ts`): 적은 필드만. `blocked` 같은 값, `bothConfirmed`·`moving.items`·`after.items` 집합(개수까지), `subtotal` 같은 값, `after: null` ⇔ 실제 null, `duplicates` = `{ product, buyer(자신), status }` 집합(전체와 정확히 같음). 불일치 경로 `mergePreviews[i].blocked`·`.bothConfirmed`·`.moving.items`·`.moving.subtotal`·`.after`·`.after.items`·`.after.subtotal`·`.duplicates`. `compareExpect(expect, snapshot, where?, extras?)` — 넷째 인자(선택)로 미리 보기 결과를 받는다(기존 호출은 그대로).
  - 어댑터(`core-adapter.ts`): `realCore.engine.previewMerge` = 코어 `previewMerge`에서 비교할 필드만 옮긴다(`toMergePreviewView` — 찜 ID·남는 찜·`target`·`moving.buyers`는 뺀다). 가짜 코어(`fake-core.ts`) 선택 `mergePreview`(고정값 또는 `(events, from, into) => view`).
  - 러너 자체 시험: `runner-s06b.test.ts`(필드마다 통과·불일치 28가지, 항목별 경로, 중간 검사 시점, 키 풀이(자신·모르는 채널·없는 ref), 미구현·허용, 상태 변경 러너 오류(중간·마지막), 결과 형식 러너 오류 6가지, 결정성 위반, 실제 골든 19번으로 틀린 코어 8가지 — 언제나 합칠 수 있음·고리 안 막음·합친 뒤에 옮길 쪽 빠짐·옮길 쪽을 지금의 구매자 전체로·중복 구매자를 지금의 구매자로·방향을 따르는 중복·from/into를 지금의 구매자로 푸는 어댑터·상태를 바꾸는 미리 보기·조회 없는 코어), `read-errors.test.ts` 범주 20.
  - 기존 검사 키·비교 규칙·읽기 오류 규칙은 바꾸지 않았다.

### 바꾼 기존 시험 (교체 — 약화 아님)
- `packages/core/test/golden/core-adapter.test.ts` "실제 tests/golden 전체를 실제 코어로": 합계 고정값 파일 21 · 엔진 119 · 통과 498 → **파일 23 · 엔진 123 · 통과 502**(파서 379, 나머지 0 그대로). 이번 스프린트 골든 19·20번 파일(G-ENG-174~177)이 늘어서 하는 교체(AC-S06b-50). 이름의 AC 번호도 AC-S06b-50으로.
- `packages/core/test/golden/read-errors.test.ts` "모든 파일에 기대값이 있다": 범주 1~19 → 1~20(새 픽스처 20번을 더했다).

### 확인한 것
- `pnpm golden`: 파일 23 · 파서 사례 379 · 엔진 시나리오 123 · 통과 502 · 불일치 0 · 미구현(허용) 0 · 미구현(불허) 0 · 읽기 오류 0 · 결정성 위반 0 · 러너 오류 0.
- `pnpm coverage`: `packages/core/src` 라인 100% · 분기 99.66%.
- 기계 부하가 큰 동안(load average 24~41) 코어의 시간 비교 시험(`engine-timing.test.ts`의 "8배를 넘지 않는다")과 무거운 속성 시험이 5초 제한·비율을 넘는 일이 있었다. 따로 돌리면 통과한다(이번 변경과 관계없는 경로 — checkInvariants·보류 찜). 적대 시험 `tests/adversarial/s00/golden-runner.test.ts`의 CLI 여러 번 띄우기도 부하에서 5초를 넘는다 — AC-S06b-51(test-domain 몫).
