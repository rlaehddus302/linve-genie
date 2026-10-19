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
