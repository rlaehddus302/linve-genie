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
- `pnpm verify`(dev-core 끝, 커밋 6568152 기준): 7단계 모두 통과 — typecheck(설정 8개·TS 파일 294개) · lint 오류 0 · test 파일 92·테스트 2121 · golden 아래 합계 · adversarial 파일 30·테스트 642 · e2e 파일 22·통과 133 · coverage 라인 100%·분기 99.66%.
- `pnpm golden`: 파일 23 · 파서 사례 379 · 엔진 시나리오 123 · 통과 502 · 불일치 0 · 미구현(허용) 0 · 미구현(불허) 0 · 읽기 오류 0 · 결정성 위반 0 · 러너 오류 0.
- `pnpm coverage`: `packages/core/src` 라인 100% · 분기 99.66%.
- 기계 부하가 큰 동안(load average 24~41) 코어의 시간 비교 시험(`engine-timing.test.ts`의 "8배를 넘지 않는다")과 무거운 속성 시험이 5초 제한·비율을 넘는 일이 있었다. 따로 돌리면 통과한다(이번 변경과 관계없는 경로 — checkInvariants·보류 찜). 적대 시험 `tests/adversarial/s00/golden-runner.test.ts`의 CLI 여러 번 띄우기도 부하에서 5초를 넘는다 — AC-S06b-51(test-domain 몫).

## dev-server

### 바뀐 계약 (화면·E2E·적대 시험이 먼저 알아야 할 것)

#### 1. 합치기 미리 보기 조회 (AC-S06b-10, D-100) — 새 경로
`GET /api/days/:date/merge-preview?from=<구매자 ID>&into=<구매자 ID>[&rehearsal=true]`
- 200 `{ date, rehearsal, seq, preview }`
  - `seq`: 그 범위의 지금 seq(응답을 만들 때 따라잡은 마지막 seq). `preview`는 바로 그 seq까지 적용한 상태로 코어 `previewMerge(state, from, into)`를 부른 결과 그대로(위 dev-core "공개 모양" — `from`·`into`·`blocked`·`target`·`bothConfirmed`·`moving{buyers,items,subtotal}`·`after`·`duplicates[{claim,product,buyer,status,keep}]`). 서버는 값을 바꾸지도 거르지도 않는다(시각 필드가 없어 ISO 변환도 없다).
  - 범위에 없는 구매자(`__proto__` 같은 문자열 포함)는 `preview.blocked = "UNKNOWN_BUYER"`(200).
- 400 `INVALID_INPUT` — `from`·`into` 각각: 없음·빈 값·128자 넘음·제어 문자 → `problems: [{ field: 'from' | 'into', message }]`(둘 다 틀리면 둘 다). 휴대폰 번호처럼 보이는 ID(코어 `looksLikePhoneId`)면 `message`는 D-079 ⑥ 문장("전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.")이고 `hint`("전화번호 대신 구매자를 골라 주세요." / into는 "전화번호 대신 합칠 구매자를 골라 주세요.")가 붙는다. 받은 값은 응답·로그 어디에도 없다.
  - 잘못된 `rehearsal`은 다른 날짜 조회와 같은 400(`field: 'rehearsal'`).
- 404 `NOT_FOUND` — 날짜 형식이 틀림·없는 범위·다른 판매자의 범위(그 날짜 조회 `GET /api/days/:date`와 같은 응답, 있는지 알리지 않는다). 검사 순서: 날짜(404) → `rehearsal`(400) → `from`·`into`(400) → 범위(404).
- 401 로그인 필요. `Cache-Control: no-store`. 아무것도 기록하지 않는다(이벤트·발송함·범위 seq 그대로).

#### 2. 문자찜 쓰기 응답의 `buyer` (AC-S06b-11, D-099)
`POST /api/events`의 `type: "sms"` 성공 응답(200)에 `buyer`를 더한다. 키 전부: `date`·`rehearsal`·`seq`·`type`·`changed`·`effects`·`phoneLast4`·`buyer`.
- `buyer` = 그 문자찜이 정한 구매자 자신의 ID = 코어 `buyerOfRef(그 이벤트를 적용한 뒤 상태, ref)` — 지정 구매자(`buyer`로 고른 유튜브 채널 ID·문자 구매자 ID), 전화번호 키로 이은 문자 구매자(`sms:<처음 문자찜의 ref>`), 새 문자 구매자(`sms:<이 문자찜의 ref>`). 정하지 못했으면 `null`.
  - 찜이 생기지 않았어도(이미 찜한 구매자 — R-4 4번 줄) 그 구매자다. 지금의 구매자가 아니라 구매자 자신이다(합쳐져 있으면 화면이 범위 조회의 `buyers[].current`로 지금의 구매자를 찾는다).
- 같은 요청 번호의 재전송(처음 결과를 다시 돌려주는 200)도 처음과 같은 `buyer`다. 문자찜 ref → 구매자는 처음 받을 때 한 번만 기록되고 바뀌지 않으므로(R-11, D-067 — 같은 ref는 다시 오면 아무 일도 없다) 재전송 응답은 그 범위의 지금 상태에서 같은 값을 읽는다.
- 전화번호·메모는 담지 않는다(문자 구매자 ID = `sms:<서버가 만든 ref — 영문 소문자만>`).
- 다른 종류의 응답은 그대로(`buyer` 없음). 실패(500 `PROCESSING_FAILED`)·거절 응답도 그대로.

#### 3. 보기 캐시 상한 (AC-S06b-12, D-104) — 응답은 그대로
- 범위마다의 캐시(색인 8·메시지 4)는 그대로. 보기 캐시를 가진 범위: 판매자마다 가장 최근에 조회한 **4개**, 서버 전체 **32개**, 마지막 조회 뒤 **10분**이 지나면 비운다. 범위 실행 상태(writer 128개) 규칙은 그대로.
- "조회" = 범위 조회(`GET /api/days/:date`)·증분 조회(`/changes`)·메시지 조회(`/messages`) — 보기 캐시를 쓰는 조회. 정리는 그 조회 때와 쓰기 커밋 뒤(서버 시계 기준)에 한다. 타이머는 없다.
- 시험용으로 `LivejjimServer.viewCaches`(`ViewCacheBudget`)를 낸다: `size`(캐시를 가진 범위 수), `countOf(sellerId)`, `has(sellerId, date, rehearsal)`. 비운 범위의 `runtime.views.index.size`는 0이고 `builds`(계산 횟수)는 그대로 이어 센다.

### 만든 것 (`apps/server`)
- **합치기 미리 보기 조회** (`api.ts` 경로, `service.ts` `Service.mergePreviewInput`·`mergePreview`, `messages.ts` `phoneIdProblem`): 범위 상태를 따라잡은 뒤 `seq`와 상태를 함께 잡고 동기 함수 `previewMerge`로 계산한다 — 응답 `seq`와 `preview`는 늘 같은 상태의 것이다(쓰기와 동시에 조회해도). 구매자 ID 길이는 코드 포인트로 센다(`MERGE_PREVIEW_ID_MAX = 128`).
- **문자찜 응답 `buyer`** (`writer.ts` 기록 결과 `states`·`WriteResult.smsBuyer`, `service.ts` `#smsOutcome`·`#withSmsBuyer`, `api.ts` `resultBody`): 기록했으면 그 이벤트를 적용한 뒤 상태의 `buyerOfRef(ref)`. 같은 요청 번호의 처음 결과(API 앞 확인 `priorResult`·기록 경로 안 확인·유일 제약 위반 뒤 확인 — 세 경로 모두)는 그 범위의 지금 상태에서 그 결과의 `ref`로 읽는다. 다른 경로(방송 만들기 등)로 문자찜의 요청 번호를 다시 보내도 `priorResult`가 같은 값을 붙인다.
- **보기 캐시 상한** (`view-budget.ts` 새 파일 `ViewCacheBudget`, `state-cache.ts` `clear()`, `views.ts` `clearViewCaches`, `writer.ts` `onDrop`, `server.ts` 조립): 서버마다 하나(모듈 전역 아님). 범위 키 → (판매자, 그 범위의 `views`, 마지막 조회 시각), 넣은 순서 = 마지막으로 조회한 순서. `use`(범위·증분·메시지 조회가 캐시를 쓰기 직전 — 메시지 기록은 채팅 행을 기다린 뒤 한 번 더) → 가장 최근으로 옮김 → 10분 지난 범위 → 그 판매자의 5번째부터 → 전체 33번째부터 비움(지금 범위는 비우지 않음). 쓰기 커밋 뒤 `sweep`(10분만). writer가 범위 실행 상태를 내리면 `release`로 그 범위 항목을 지운다(내려간 실행 상태의 캐시를 붙잡아 두지 않게). 같은 범위를 새 실행 상태로 다시 조회하면 앞 실행 상태의 캐시를 비우고 바꾼다.

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **재전송 응답의 `buyer`를 지금 상태에서 읽는다**: 문자찜 ref → 구매자 사전(`state.refs`)은 그 ref를 처음 받을 때만 쓰이고(엔진 `sms` 처리의 첫 줄 — 같은 ref가 다시 오면 아무 일도 없다, D-067·INV-3) 그 뒤 어떤 이벤트도 바꾸지 않는다. 그래서 `buyerOfRef(지금 상태, ref)` = `buyerOfRef(그 이벤트를 적용한 뒤 상태, ref)`이다. 처음 응답의 구매자를 DB에 따로 적는 칸(마이그레이션)을 두지 않았다. 시험: 합치기·같은 사람 문자찜·범위 실행 상태를 내린 뒤 재전송이 처음과 같다.
- **`buyer`는 구매자 자신**(지금의 구매자가 아니다): D-099·ORD-08 AC7 "그 문자찜이 정한 구매자 자신의 ID". 화면은 범위 조회 `buyers[].current`로 지금의 구매자를 찾는다(합쳐진 지정 구매자로 넣은 경우 시험).
- **휴대폰 번호 모양 검사는 ID 칸 규칙(`looksLikePhoneId`)만**: D-080 "ID 칸은 값 전체가 숫자와 같은 구분자뿐이고 `normalizePhone` 결과가 있을 때만" — 글 칸 규칙(`containsPhoneRun`)을 쓰면 실제 채널 ID가 걸릴 수 있다. 문제에는 쓰기 경로의 ID 칸과 같은 `hint`를 붙인다(`from` = 구매자 칸 안내, `into` = 합칠 구매자 안내).
- **검사 순서** 날짜(404) → `rehearsal`(400) → `from`·`into`(400) → 범위(404): 형식 검사는 DB를 보지 않으므로 범위가 있는지와 상관없이 같은 400이다(다른 판매자의 범위인지 알 수 없다).
- **보기 캐시를 쓰지 않는 조회는 세지 않는다**: 합치기 미리 보기·이력 조회는 보기 캐시를 만들지 않아 "보기 캐시를 가진 범위"를 늘리지 않는다.
- **정리는 조회·쓰기 커밋 뒤, 타이머 없음**: 항목이 많아야 33개라 한 번 도는 비용이 작고, 서버가 아무 조회·쓰기도 받지 않는 동안 남는 캐시는 32범위로 묶여 있다. 타이머를 두면 서버 종료·시험 시계와 맞추는 일이 늘어난다(D-036).

### 보기 색인 크기 실측 (AC-S06b-12 참고 — 게이트 아님)
상품 500(재고 1~3) · 채팅 1만 건(시청자 2,000명, 40%가 주문) 범위를 코어로 만들고 색인 하나·메시지 기록 하나를 만들기 전후의 힙 차이(`node --expose-gc`, 이 기계 1회):
- 범위 조회 JSON 약 2.5MB(찜 2,864 · 구매자 1,930 · 정산 781 · 효과 1,934).
- **보기 색인 하나 ≈ 6.8MB**(항목 객체 + 항목마다의 JSON 문자열 — JSON 크기의 약 2.7배), 메시지 기록 하나 ≈ 3.0MB.
- 이런 범위 하나가 캐시를 꽉 채우면 색인 8 + 메시지 4 ≈ 66MB. 상한 전(범위 128개)에는 이론상 약 8.4GB였고 지금(32개)은 약 2.1GB가 이론상 최대다(모든 범위가 이만큼 크고 저마다 상태 8개를 번갈아 조회할 때). 보통 방송(상품 수십·채팅 수천)은 이보다 한 자릿수 작다.

### 바꾼 기존 시험 (교체 — 약화 아님, 계약이 바뀌었다)
- `apps/server/test/api.test.ts` "응답: seq, changed, 이 입력으로 나온 효과 ID…": 문자찜 응답 전체 비교에 `buyer`(그 찜의 구매자 = `sms:<ref>`)를 더했다(AC-S06b-11).
- `apps/server/test/sms-contract.test.ts` "응답: …": 응답 키 목록에 `buyer`를 더하고 이름에 AC-S06b-11을 적었다. 나머지 확인(재전송 같은 본문·기록 한 번·전화번호 없음)은 그대로.

### 시험 (내 영역)
- `merge-preview.test.ts`(10): 코어 결과와 같음(모든 구매자 쌍 + 모르는 ID·`__proto__`), G-ENG-174 막힘 → 한쪽씩 취소 → 미리 본 대로 합쳐짐(DUPLICATE = `duplicates[].claim`, 합친 뒤 = `after`) → FROM_MERGED·CYCLE, 쓰기와 동시 조회(응답 seq의 상태로 계산), 리허설·실제 범위 섞이지 않음·잘못된 `rehearsal`, 다른 판매자·없는·틀린 날짜 = 날짜 조회와 같은 404, 401, 형식 오류 12가지·128자 경계(코드 포인트), 휴대폰 번호 5가지(응답·로그·DB에 없음), 기록 없음(DB 전체 그대로)·no-store, 상태를 바꾸지 않음.
- `sms-buyer.test.ts`(6): G-ENG-176 흐름, 세 경우(지정·합쳐진 지정·전화번호로 이음·새), 재전송(내용 다름·합치기 뒤·forget 뒤·다른 경로·동시), 정하지 못함 `null`(엔진 호출을 감싸 지정 구매자를 모르는 ID로 적용)·다른 종류에 `buyer` 없음, 리허설 범위, 전화번호·메모 없음.
- `view-budget.test.ts`(10): 상한 값, 한 판매자 5범위(첫 범위만 비움·다른 판매자 그대로·실행 상태 그대로), 실제·리허설 따로, 판매자 9명 × 4범위 → 32, 10분(9분 59.999초 그대로·조회 때·쓰기 커밋 뒤), 비운 뒤 같은 응답·계산 횟수 증가(범위·증분·메시지)·전체 + 증분, 실행 상태를 내리면 항목 삭제, `ViewCacheBudget` 주입 시계 단위 시험.
- 서버 시험 전체 34파일 364개 통과(`TZ=Pacific/Honolulu`).

### 화면(dev-web)에게 — 쓸 것
- **합치기 미리 보기**(AC-S06b-33): `GET /api/days/<날짜>/merge-preview?from=<구매자 ID>&into=<구매자 ID>[&rehearsal=true]` — 값은 `encodeURIComponent`로(`sms:` 콜론 포함). 응답 `preview`를 낱말로만 바꾼다. 중복 문장의 대기 순번·상태 낱말은 `duplicates[].claim`으로 범위 조회 `claims`에서 찾는다. 미리 보기가 낡았는지 = 보는 범위의 `seq`(범위 조회·증분·실시간 알림) > 응답 `seq`. "방향 바꾸기"는 `from`·`into`를 바꿔 다시 받는다. 400(형식)·404(범위 없음)·401은 다른 조회와 같은 모양.
- **문자찜 결과**(AC-S06b-30): 응답 `buyer`(구매자 자신, `null` 가능). 지금의 구매자 = 범위 조회 `buyers`에서 `id === buyer`인 항목의 `current`. 그 지금의 구매자가 그 상품에 가진 활성 찜은 `claims`에서 `buyer`의 `current`가 같은 활성 찜으로 찾는다. "같은 사람 하나 더"는 이 `buyer`를 지정 구매자로 보낸다.
- 보기 캐시 상한은 응답을 바꾸지 않는다.

### 테스트(test-domain·test-e2e)에게
- 서버 시험 기동은 지금과 같다(`apps/server/test/support.ts` `newWorld({ clock })` — `world.clock.advance(ms)`로 10분을 넘긴다). 보기 캐시 상한 점검: `world.server.viewCaches.size`·`countOf(sellerId)`·`has(sellerId, date, rehearsal?)`, 범위의 `(await world.server.writer.read(seller, date, rehearsal)).views.index.size`(비우면 0)·`.builds`(계산 횟수 — 비워도 이어 센다). `@livejjim/server`에서 `ViewCacheBudget`·`VIEW_CACHE_SCOPES_PER_SELLER`(4)·`VIEW_CACHE_SCOPES_MAX`(32)·`VIEW_CACHE_IDLE_MS`(600000)·`MERGE_PREVIEW_ID_MAX`(128)·`MergePreviewView`를 내보낸다.
- E2E 기동은 S06 그대로: `pnpm --filter @livejjim/server e2e --port 3100 --origin http://localhost:5173 [--host-delay-ms 2000] [--chat-speed 20] [--fill yes]` → 127.0.0.1:3100(브라우저 주소는 `http://localhost:5173` — `apps/web/playwright.config.ts`), 계정 `apps/server/e2e/account.json`. 새 경로는 같은 서버에 있다.

### 검증 (dev-server 끝, `pnpm verify`, 커밋 6008800 기준, TZ=Pacific/Honolulu)
- typecheck 통과(설정 8 · TS 298) · lint 통과(오류 0 · 경고 0) · test 통과(파일 95 · 2,147) · golden 통과(파일 23 · 파서 379 · 엔진 123 · 통과 502, 그 밖 0) · e2e 통과(파일 22 · 133, S06 E2E 그대로 — 문자찜 응답에 `buyer`가 더해져도 화면이 그대로 동작) · coverage 통과(코어 라인 100% · 분기 99.66%).
- adversarial **실패 1** — `tests/adversarial/s00/golden-runner.test.ts` "환경변수·작업 폴더·시간대·언어 설정을 바꿔도 출력과 종료 코드가 같다"가 기본 5초 제한을 넘음(5,956ms, "Test timed out in 5000ms"). 골든 CLI를 여러 번 띄우는 시험이라 이번 서버 변경과 관계없고, 따로 돌리면 통과한다(51/51). 이 시험에 제한 시간을 적는 것은 AC-S06b-51(SA-S06-009) test-domain 몫이다(`tests/**`는 보호 경로). 나머지 적대 시험 641개(서버 s04·s05 포함) 통과.

## dev-web

### 만든 것 (`apps/web`)
- **이름 표기 하나** (AC-S06b-20, D-098) — `src/lib/derive.ts` `buyerLabels(buyers, claims)`·`BuyerNames(buyers, claims)`. 콘솔(보드·상품 자세히·알림 창)·문자찜(결과·최근·구매자 고르기)·구매자(목록·자세히·찾기·합치기 창)·정산(목록·자세히·입력 창)이 모두 이 함수다.
  - 같은 표시 이름 수는 그 범위의 **지금의 구매자** 기준. 하나면 표시 이름 그대로, 둘 이상이면 `표시 이름 · 구분 글자`: 유튜브 `끝 1234`, 뒤 4자리가 있는 문자 `뒤 4자리 5678`, 전화번호 없는 문자 `문자 20:01:05`(그 구매자 자신의 찜 중 가장 앞 seq의 문자찜 = 그 구매자를 만든 문자찜의 순위 시각, KST — 분까지면 `문자 20:01`).
  - 그래도 같은 표기면 범위 조회의 구매자 순서(코어 `listBuyers` = 처음 기록된 순서 = 만든 이벤트 seq 순)로 둘째부터 ` · 2`, ` · 3`. 번호는 구분 글자가 붙은 표기끼리만 센다(합쳐진 구매자 포함).
  - 구매자 목록 줄의 "같은 닉네임 n명"은 이름 옆에 그대로(D-090). 줄의 "뒤 4자리 5678" 따로 표시는 없앴다(이름에 있다).
  - 은/는·을/를은 끝 숫자를 읽는 소리로 고른다(`· 2` → 이 → "는").
- **PC 표 / 휴대폰 카드** (AC-S06b-21) — `src/lib/use-wide.ts` `useWide()`(`(min-width: 48rem)`, 한 모양만 그린다 — 숨긴 사본 없음).
  - 구매자: `<table aria-label="구매자">`(찾기 결과는 `aria-label="찾은 구매자"`), 열 이름·종류·상품 수·합계·입금 상태·표시.
  - 정산: `<table aria-label="정산 묶음">`, 열 이름·상품 수·상품 합계·배송비·조정·최종 금액·받은 금액·입금 상태.
  - `<th scope="col">`, 금액 열 `td.num`(오른쪽), 이름 칸 `a.table-link`(min-height 44px — 줄 높이 45.5px).
  - 실제 화면(1440×900, 리허설 띠 포함)에서 정산 표 8줄·구매자 표 10줄이 스크롤 없이 보였다. 48rem 미만은 지금의 카드(`<ul aria-label="구매자">`·`"정산 묶음"`).
- **날짜·받은 시각** (AC-S06b-22·31) — `src/lib/kst.ts`.
  - `dateLong` "2026년 10월 18일(일)": 날짜 고르기 항목·문자찜 방송 이름(`broadcastWords` "1부 · 2026년 10월 18일(일)", 리허설은 날짜 고르기에서 뒤에 " 리허설").
  - `kstStamp` "10/18 20:01:05"·분까지 "10/18 20:01": 결과 카드 "받은 시각 10/19 10:00:00", 최근 문자찜. 날짜는 찜의 `rankTime`(엔진이 R-6으로 정한 날)을 KST로.
  - 콘솔 머리·방송 목록의 "10월 18일"은 그대로(이번 범위 밖).
- **정산 입력 창** (AC-S06b-23)
  - 창 이름(머리) = `입금 적기 · 홍길동 · 2026년 10월 18일 묶음`(배송비 바꾸기·할인·추가·환불 적기도 같은 꼴), 그 아래 `p.input-amounts` "최종 … · 받은 금액 … · 남은 금액 …".
  - 미리 보기 줄 `p.payment-change`(role=status) "입금 상태: 입금 완료 → 과입금(환불 필요 4,000원)" / "입금 상태: 그대로(미입금)" — 코어 `settle`로 입금·환불·배송비·조정 모두. 과입금이 새로 생기거나 환불 필요가 늘면 `data-tone="warning"`, 아니면 `info`.
  - 저장 뒤 자세히 위에 "입금을 적었어요"·"배송비를 바꿨어요"·"할인을 적었어요"/"추가를 적었어요"·"환불을 적었어요"(`data-tone="success"`), 엔진이 받지 않으면 "적용되지 않았어요. 지금 상태를 확인해 주세요."(warning).
  - 입금 칸 1원~100,000,000원(S06 그대로 — 밖이면 칸 아래 "입금은 1원~100,000,000원으로 적어 주세요."이고 보내지 않는다).
- **주 버튼** (AC-S06b-24) — **표시 = 클래스 `button-primary`** (채운 파랑). 위험 버튼은 `button-danger`. E2E는 창 밖(`[role=dialog]` 밖)의 `.button-primary` 수를 세면 된다.
  - 정산 자세히: 미입금·부분 입금 "입금 적기", 과입금 "환불 적기", 입금 완료 없음.
  - 구매자 자세히: 없음("다른 구매자와 합치기"·"떼어 내기" 보통, "차단하기"는 `button-danger`, "차단 풀기"는 보통).
  - 그 밖: 문자찜은 "15번에 문자찜 넣기"만("같은 사람 하나 더"는 보통), 방송 목록은 "새 방송 시작"(칸이 열리면 "이 방송 시작하기"만), 콘솔은 고치기 칸 "등록" > 맨 앞 "고칠까요?"의 버튼 > 리허설 "가짜 채팅 시작" 중 하나. 위 줄 "앱으로 설치"·채팅 "새 메시지 n개"·띠의 "사유 고치기"는 보통 버튼.
- **문자찜 결과** (AC-S06b-30) — 쓰기 응답 `buyer`(구매자 자신)를 쓴다(`WriteResult.buyer`·`phoneLast4`).
  - 찜이 생기지 않았으면 그 구매자의 지금의 구매자가 그 상품에 가진 활성 찜으로 "이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 대기 1번)", 없거나 `buyer`가 null이면 "새 찜이 생기지 않았어요. 지금 상태를 확인해 주세요.".
  - "같은 사람 하나 더"는 응답 `buyer`(null이면 버튼 없음). `smsHolder` 삭제(코드 검사 `test/code-checks.node.test.ts`).
- **고른 방송** (AC-S06b-32): 방송 고르기 창 `button.choice-button[aria-pressed="true"]` 안에 `span.chosen-mark` "✓ 고름", 다른 배경(#e8f0fe)·3px 테두리.
- **합치기 미리 보기** (AC-S06b-33)
  - `src/lib/merge-preview.ts` `useMergePreview` → `GET /api/days/:date/merge-preview?from=&into=[&rehearsal=true]`, `src/lib/buyers.ts` `mergeWords`가 낱말로만 바꾼다.
  - 화면의 `planMerge`·`ahead`·`STATUS_ORDER` 삭제(코드 검사).
  - 보는 범위의 `data.seq` > 응답 `seq`면 다시 받는다: 받는 동안 "미리 보기를 새로 받는 중이에요."(처음은 "미리 보기를 받는 중이에요."), 실패 "미리 보기를 받지 못했어요." + 서버 문장 + "다시 받기". 그동안 "합치기" `disabled`.
  - 사유 칸은 마지막 미리 보기가 막힘이면 없다(새로 받는 동안 친 사유는 그대로).
  - 막힘 상자 `div.error-note[role=alert][data-tone=danger]`, 중복 상자 `div.warning[role=note][data-tone=warning]`.
  - 막힘 문장의 상품 버튼 이름은 "<상품 이름표> 자세히" — 구매자 화면은 방송을 고르지 않아 "1부 18번 자세히"처럼 방송 제목이 붙는다(S06 그대로).
- **합치기 흐름** (AC-S06b-34) — 주소 검색값 `merge`(상대 구매자 ID)·`into`(남는 쪽 ID)·`product`(상품 키 `b1/18`).
  - 상대를 고르면 기록을 남기는 이동(떠나기 확인 없음 — `NavigateOptions.stay`), "방향 바꾸기"·"닫기"는 기록을 바꾼다(replace).
  - 막힘의 "18번 자세히" → `product`가 붙은 주소(stay) → 1등 목록과 "찜 취소하기"(사유, 5초 뒤 — 사유 창이 닫혀도 상품 자세히는 그대로)와 창 아래 **"합치기로 돌아가기"**(보통 이동 — 대기 중이면 떠나기 확인이 묻는다).
  - 브라우저 뒤로 가기도 `product`를 뺀 주소 = 같은 합치기 창이고, 미리 보기를 지금 상태로 새로 받는다.
  - 상품 자세히의 "닫기"는 구매자 자세히로(합치기 창도 닫힌다). 합친 뒤에는 남는 구매자 자세히로(replace) + "합쳤어요".
- **결과·안내의 뜻** (AC-S06b-40) — `data-tone` = `success`|`warning`|`danger`|`info`, 색은 `styles.css` 끝의 `[data-tone=…]`(명암비 4.5:1 이상).
  - 문자찜 결과 `section[aria-label="넣은 결과"]`: 1등 success · 대기/보류 info · 충돌/거절(품절·판매 중 아님·차단) warning · 안 생김 warning.
  - "합쳤어요"·"떼어 냈어요"·"입금을 적었어요" success. 합치기·떼어 내기 막힘/실패 danger.
  - 저장하지 못함(`WriteError`·`ErrorNote`)·처리 실패(확인 필요)·연결 끊김/최신으로 못 맞춤 danger.
  - 경고 문장 `.warning`은 주의(노랑)로 바꿨다.
  - 되돌리기 띠 `li.undo-item`: 보내기 전 warning · 보냄 success · 적용 안 됨 warning · 실패 danger · 그 밖 info.
- **휴대폰 조치 기록** (AC-S06b-41) — 상품 자세히 `region "조치 기록"`.
  - 48rem 미만: `ol.history-list > li.history-entry`(시각 `span.history-time` · 조치 · 대상 · 사유 · 조치자, 낱말 사이 "· "는 CSS). `word-break: keep-all; overflow-wrap: break-word`.
  - 48rem 이상: 지금의 표.
  - 375×812 실제 화면에서 긴 사유가 낱말 단위로만 줄을 바꾸고 가로 스크롤 없음을 확인했다.
- **떠나기 창 닫기 뒤 전체 대기** (AC-S06b-42): `UndoQueue.resume`이 대기 시간 전체로 마감을 다시 잡는다(띠도 처음 값부터).
- **새로고침·처음 연 화면의 뒤로 가기** (AC-S06b-43)
  - beforeunload: `preventDefault()` + `returnValue = "보내기 전인 조치가 있어요. 떠나면 보내지 않아요."`.
  - 앱이 쌓는 기록마다 `history.state.livejjimDepth`(처음 연 기록 0). 깊이 0에 보내기 전인 조치가 생기면 같은 주소의 기록 `{ livejjimGuard: true }`를 하나 더 쌓는다 → 뒤로 가기는 앱 안 popstate라 "다른 화면으로 갈까요?"가 묻는다.
  - "닫기"면 기록을 다시 쌓고 대기 시간 전체를 다시 기다린다. "보내지 않고 떠나기"면 보내지 않고 `history.back()`(앱 밖 이전 기록으로).
  - 조치가 없을 때는 더 쌓은 기록 때문에 뒤로 가기를 한 번 더 눌러야 할 수 있다(D-103 그대로).

### 결정과 이유 (규칙 문장 안에서의 구현 선택)
- **이름의 " · n" 번호는 구분 글자가 붙은 표기끼리만**: D-098 "그래도 같은 표기가 둘 이상이면"을 구분 글자를 붙인 뒤의 충돌로 읽었다.
  - 구분 글자가 없는 이름(지금의 구매자 중 하나뿐)에 번호를 붙이면 "하나뿐이면 표시 이름 그대로"와 어긋난다.
  - 그래서 합쳐진 구매자 X("홍길동")와 다른 지금의 구매자 Y("홍길동")는 둘 다 "홍길동"이다(같은 이름 수는 지금의 구매자 기준 — D-098 문장 그대로).
- **"생긴 순서" = 범위 조회 `buyers` 목록 순서**: 코어 `listBuyers`가 처음 기록된 순서로 주고, 증분은 키로 덮어 순서가 유지된다. 화면에 구매자를 만든 seq 칸이 없어 이 순서를 쓴다.
- **구매자 화면의 "상품 자세히"는 1등 목록 창**(S06 `ProductWinnersDialog`): 콘솔의 상품 자세히는 콘솔 창 묶음(배정·충돌·고치기)에 묶여 있어 구매자 화면에 그대로 둘 수 없다. AC-S06b-34에 필요한 것(1등 찜·찜 취소하기·합치기로 돌아가기)은 다 있다.
- **상대 고르기·상품 자세히 열기는 기록을 남기되 떠나기 확인 없이**(`stay`): 같은 화면 안에서 창을 여는 것이라 "다른 화면으로 갈까요?"를 묻지 않는다. 뒤로 가기는 그 창을 닫는(앞 주소로 가는) 이동이라 대기 중이면 묻는다(AC-S06-01 그대로).
- **처음 연 화면에서 "보내지 않고 떠나기"는 `history.back()`**: 판매자가 뒤로 가기로 떠나려 했으므로 보내지 않고 떠난다. 이전 기록이 없으면(새 탭) 아무 일도 없고 화면에 남는다.
- **입금 상태 미리 보기의 "주의"**: 과입금이 새로 생기거나 환불 필요 금액이 늘 때만. 줄거나 그대로면 보통(info).

### 바꾼 기존 시험 (교체 — 약화 아님, 계약이 바뀌었다)
- `apps/web/test/buyers.test.ts`: "(1번째 문자)" 이름 → 새 이름 표기 시험 묶음. 구분 표시 기대값(`끝 1111`은 이름으로). 합치기 미리 보기의 엔진 비교(planMerge = buyer.merge 결과) → 서버 응답 모양(코어 `previewMerge` 결과) → 낱말 시험. smsHolder 시험 → 코드 검사(`code-checks.node.test.ts`)와 sms-page 시험(응답 buyer).
- `apps/web/test/buyers-page.test.tsx`: 목록 줄 글자(뒤 4자리 따로 표시 없음). 합치기 시험은 미리 보기를 기다린 뒤(서버 조회), 막힘 흐름은 "합치기로 돌아가기"로.
- `apps/web/test/sms-page.test.tsx`: 방송 이름 "2부 · 10/19(월)" → "2부 · 2026년 10월 19일(월)", 결과 "받은 시각 10:00:00" → "받은 시각 10/19 10:00:00". "뒤 4자리만 같은 두 사람이면 정하지 않는다(일반 문장)" → G-ENG-176 흐름("이미 찜한 구매자라…(지금 대기 1번)", 같은 사람 하나 더 = Y).
- `apps/web/test/settlements-page.test.tsx`: 입력 창 이름 '입금 적기' 등 → `/^입금 적기 · /`(머리가 길어짐).
- `apps/web/test/undo-queue.test.ts`·`console-s06.test.tsx`: "닫기면 남은 시간부터" → 대기 시간 전체(D-103).
- `apps/web/test/console-flows.test.tsx`·`settlement.test.ts`: `BuyerNames(buyers)` → `BuyerNames(buyers, claims)`.

### 시험 (내 영역, 화면 단위 — TZ=Pacific/Honolulu)
- 27파일 424개 통과. 새것:
  - 이름 함수(겹침 없음·유튜브·뒤 4자리·전화번호 없음·받은 시각까지 같음·KST·합쳐진 구매자)
  - 날짜·받은 시각 글자, PC 표(구매자·정산), 입력 창 머리·입금 상태 미리 보기(G-ENG-177)·입금 상한, 주 버튼(정산 네 상태·구매자 자세히)
  - G-ENG-176 결과·`buyer` null, 고른 방송, 서버 미리 보기(막힘·풀림·갱신 중 잠김·실패·다시 받기·주소로 다시 열기), G-ENG-174 흐름
  - 휴대폰·PC 조치 기록, 닫기 뒤 전체 대기(가짜 시계), 처음 연 화면 뒤로 가기·returnValue, 코드 검사
- 가짜 서버(`test/engine-server.ts`): merge-preview 경로(코어 `previewMerge`), 문자찜 응답 `buyer`(코어 `buyerOfRef`).

### 테스트(test-e2e)에게 — 바뀐 글자·모양 (S06 E2E 중 교체가 필요한 곳)
- **PC(1280×720 기본 Desktop Chrome 포함 48rem 이상)의 구매자·정산 목록은 표다**.
  - `getByRole('list', { name: '구매자' | '정산 묶음' }).getByRole('link')` → `getByRole('table', { name: … }).getByRole('link')`(이름 칸 링크, 링크 이름 = 이름만). 줄 전체 글자는 `getByRole('row')`.
  - 휴대폰(375) 시험은 그대로 카드.
- 이름: "문자찜 (1번째 문자)"·"홍길동 (끝 1234)" → "문자찜 · 문자 10:00:00"·"홍길동 · 끝 1234". phase1 시험의 `/ \(끝 [^)]+\)$/` 떼기는 ` · 끝 ` 꼴로.
- 문자찜 결과·최근 목록의 받은 시각에 날짜("받은 시각 10/19 00:00:01"). 방송 고르기·고른 방송 날짜 "2026년 10월 19일(월)", 날짜 고르기 항목도 연도·요일.
- 정산 입력 창 이름 = 머리 전체(Playwright `name: '입금 적기'`는 부분 일치라 그대로 찾힌다, `exact: true`면 바뀜).
- "같은 사람 하나 더"·"다른 구매자와 합치기"는 이제 보통 버튼(이름 그대로). 결과 카드 배경은 tone에 따라(1등 초록, 대기 파랑, 안 생김 노랑).
- 상품 자세히의 조치 기록은 375에서 표가 아니다(`getByRole('row')` → `getByRole('listitem')`). PC는 표 그대로.
- 처음 연 화면(page.goto로 바로 연 화면)에서 조치를 넣으면 같은 주소 기록이 하나 더 쌓인다 — 그 화면에서 `page.goBack()`은 앱을 떠나지 않고 떠나기 창을 띄운다.

### 실행
- 화면 단위 시험: `cd apps/web && TZ=Pacific/Honolulu npx vitest run`(또는 루트 `pnpm test`).
- 손으로 볼 때: `pnpm --filter @livejjim/server e2e --port 3190 --origin http://localhost:5190 --host-delay-ms 2000` + `cd apps/web && node e2e/serve.ts --port 5190 --api http://127.0.0.1:3190` → http://localhost:5190 (계정 `apps/server/e2e/account.json`).
- E2E는 다른 작업 폴더의 E2E 서버와 포트가 겹치지 않게 `E2E_PORT_OFFSET`(예 400)을 줄 수 있다(재사용 서버가 다른 폴더 빌드일 수 있다).

### 검증 (dev-web 끝, `E2E_PORT_OFFSET=400 pnpm verify`, 커밋 d03099c 작업 트리, TZ=Pacific/Honolulu)
- 이 기계에서 다른 작업 폴더의 에이전트가 함께 돌아 load average 12~17이었다. 로그: scratchpad `verify-dev-web-S06b-1.log`.
- **통과**: typecheck(설정 8 · TS 301) · lint(오류 0 · 경고 0) · golden(파일 23 · 파서 379 · 엔진 123 · 통과 502, 그 밖 0) · adversarial(파일 30 · 642).
- **test 실패 1** — 코어 `engine-timing.test.ts` "checkInvariants: 상태 크기 4배에서 시간이 8배를 넘지 않는다". 부하에서의 시간 비율 시험(dev-core가 적어 둔 것과 같다). 화면 시험 27파일 424개는 통과.
  - 부하가 더 큰 때 다시 돌린 `pnpm test`에서는 코어·서버의 5초 제한 시험 몇 개와 화면 `console-flows` "다음 줄을 치는 중이면 … 사유 고치기"(포커스 시점) 하나가 더 실패했다.
  - 그 화면 시험은 따로 3번 모두 통과했고, 첫 verify의 test 단계에서도 통과했다.
- **coverage 실패** — 코어 속성 시험 `engine-properties-s03.test.ts`가 5초 제한을 넘음(부하). 코어 몫.
- **e2e 실패 11 / 통과 122**
  - 10개는 이번 계약 변경에 따른 S06 E2E 교체 몫(test-e2e)이다:
    - PC 목록이 표: `s06/buyers.spec.ts:30·178`, `s06/settlements.spec.ts:21·93`, `s06/navigation.spec.ts:82`, `s06/attacks-r1.spec.ts:324 @fill`.
    - 상품 자세히가 찜 취소 뒤에도 열려 있고 "합치기로 돌아가기"로 돌아간다(AC-S06b-34): `s06/buyers.spec.ts:106`.
    - 미리 보기를 서버에서 받는 동안 "합치기"가 잠겨, 바로 `isDisabled()`를 보면 막힘으로 읽는다(미리 보기를 기다린 뒤 보아야 한다): `s06/phase1.spec.ts:63`.
    - 방송 날짜 "2099년 12월 30일(수)": `s06/sms.spec.ts:19`.
    - 받은 시각에 날짜 "받은 시각 10/20 00:00:01": `s06/sms.spec.ts:181`.
  - 1개 `s05/fill.spec.ts:21 @fill`(p99 1,047ms > 1,000ms)는 부하 때문이다. 따로 다시 돌리면 p99 517ms로 통과했다(`E2E_PORT_OFFSET=400 npx playwright test --project=chromium-fill fill.spec`).

## dev-web 수정 라운드 1

### TE-S06b-001 (major) — PC 표 금액이 태블릿 폭에서 꺾임 → 고침 (`dfad121`)
- 원인: `body { overflow-wrap: anywhere }`가 표의 자동 폭 계산에서 칸의 최소 폭을 글자 하나로 줄였다. 그래서 768·1024px에서 금액 칸이 좁아져 "128,00|0원"·"1,234,000|원"처럼 꺾였다(1440에서도 9천만 원대 금액이면 같았다 — 실측).
- 고침(`apps/web/src/styles.css`):
  - `.list-table th, td { overflow-wrap: normal }` — 표 칸은 띄어쓰기에서만 꺾는다(낱말은 body의 keep-all 그대로). 입금 상태 칸 "과입금(환불 필요 1,384,000원)"도 띄어쓰기에서만 꺾여 금액은 한 덩어리.
  - 48rem 이상(`@media (min-width: 48rem)`, 표를 그리는 폭): 금액 칸(`td.num`)과 금액(`.won`) 한 줄, 열 머리 한 줄, 이름 칸 최소 6rem.
  - 배송비 예외 칸은 "직접 수령 " + `<span class="won">0원</span>` — 낱말은 꺾여도 금액은 한 덩어리.
  - 띄어쓰기 없는 긴 닉네임이 들어가는 이름 칸(`.cell-name`)만 `overflow-wrap: anywhere`.
  - 태블릿 폭(48~74.99rem): 표 글자 16px(기본 글자 16px 이상 그대로)·칸 여백 0.375rem, 열 머리는 띄어쓰기에서 꺾음. 768px에서 시험 자료(1,234,000원·−12,000원·1,500,000원·과입금)의 정산 표 여덟 열이 가로 밀기 없이 들어간다(표 736px = 칸 폭).
  - 표를 `.table-scroll`(`overflow-x: auto`)로 감쌌다 — 9천만 원대 금액이 여러 칸이면 768px에서 표만 옆으로 밀리고 화면 전체는 밀리지 않는다(실측 표 803px / 칸 736px).
- 같은 원인: 상품 자세히 PC 조치 기록 표의 열 머리 "조치|자"(S06 몫) — `.history th { overflow-wrap: normal }`로 함께 고쳤다(768·1024에서 열 머리 모두 한 줄 실측).
- 화면 단위 시험 `apps/web/test/styles.node.test.ts`:
  - 도우미가 `@media`를 읽는다(전에는 @media 조건을 버리고 안쪽 규칙만 읽었다 — 도우미 주석의 "중첩 규칙이 생기면 함께 고친다").
  - "375px 폭에서 고정 폭·줄바꿈 금지 없음" 검사에서 **375px보다 넓은 min-width @media 안의 규칙만** 뺀다. 나머지 규칙(max-width @media 포함)은 전처럼 모두 검사한다. 뺀 규칙이 절반을 넘지 않는지도 본다.
  - 새 시험: 표 칸 `overflow-wrap: normal`·금액 칸 `nowrap`이 `@media (min-width: 48rem)` 안·이름 칸 `anywhere`, 도우미의 @media 읽기.
- 확인: E2E `s06b/settle.spec.ts` TE-S06b-001 통과(768·1024 두 표 금액 0개 꺾임), 1440×900 표(8줄·44px·오른쪽 맞춤)·375 카드 통과. 768·820·900·1024·1280·1440에서 정산·구매자 표를 따로 재어 금액 꺾임 0, 화면 가로 밀림 0.

### TE-S06b-003 (GATE의 e2e 실패 중 웹 몫) — 충돌 알림 창 괄호 겹침 → 고침 (`3c1c901`)
- 배정 목록에는 없었지만 GATE-S06b-VERIFY의 e2e 실패 둘 중 하나이고 원인이 `apps/web/src/components/AlertDialogs.tsx`(내 영역)라 고쳤다.
- "홍길동 (채팅)"·"문자찜(김씨) (문자찜, 08:08:00 무렵)" → "홍길동 · 채팅"·"문자찜(김씨) · 문자찜 · 08:08:00 무렵". D-098 "괄호를 더하지 않는다"와 상품 자세히의 "이름 · 상태 · 들어온 길" 꼴에 맞췄다.
- 화면 단위 시험: `console.test.tsx` 충돌 창 기대값 "홍길동 (채팅)" → "홍길동 · 채팅"(AC-S06b-20으로 바뀐 문장), 새 시험 "앞선 찜이 문자찜(김씨)여도 `) (` 없음".
- 남은 것(시험 없음, 이번에 손대지 않음): 합치기 창 "남는 이름: 문자찜(김씨)(문자)" — 괄호가 붙어 있지만 `) (`는 아니고, S06 문장 "홍길동(유튜브)"을 E2E(`s06/buyers.spec.ts`·`s06b/merge.spec.ts`·`s06b/names.spec.ts`)가 글자로 찾는다. 바꾸려면 스펙 문장부터 바뀌어야 한다(test-notes의 같은 갈래 메모).

### 검증 (dev-web 수정 라운드 1 끝, `TZ=Pacific/Honolulu E2E_PORT_OFFSET=470 pnpm verify`, 커밋 3c1c901 작업 트리)
- **통과 7 · 실패 0 · 건너뜀 0**
  - typecheck(설정 8 · TS 309) · lint(오류 0 · 경고 0) · test(파일 96 · 2188)
  - golden(파일 23 · 파서 379 · 엔진 123 · 통과 502, 불일치·미구현·읽기 오류·결정성 위반·러너 오류 0)
  - adversarial(파일 32 · 654) · e2e(파일 27 · 통과 167 — TE-S06b-001·TE-S06b-003 포함) · coverage(라인 100% · 분기 99.66%)
