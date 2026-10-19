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
