# O1 개발 노트 — dev-core (업종 확장 코어: 옵션 모델·변형 재고·수량·댓글 옵션 인식·확인 필요)

작업 폴더 `/Users/unhoyeo/livejjim-wt/o1`, 브랜치 `track/o1-options-core`, 스펙 커밋 3b51d73, BASE 66a88a1. 순서: core(이 노트) → test-domain.

## 만든 것 (`packages/core`)

| 파일 | 내용 | 수용 기준 |
|---|---|---|
| `src/settings.ts` | `claim.parseMode`에 `OPTIONS`, `claim.maxQuantity`(1~99, 기본 10), `OPTIONS` + `RECEIVED_TIME`은 `checkSettings` 문제(키 `contention.policy`) | AC-O1-01 |
| `src/options.ts` | 옵션 모델 도구: `compareChars`(비교 글자)·`variantTexts`·`variantCount`·`unitPriceOf`·`OPTION_LIMITS`, 고른 옵션 ↔ 선택지 번호 | AC-O1-04·05 |
| `src/parse/options.ts` | **`parseOptionComment(text, catalog, focus, settings)`** — R-20 1~9의 순수 함수(시계·난수·I/O 없음, 예외 없음) | AC-O1-15~19 |
| `src/engine/validate-options.ts` | 옵션 방송 입력 검사(옵션 방송인지·옵션 모양·비교 글자 겹침·변형 재고 키·단가 0 이상·고른 옵션·수량 상한·바로잡기 번호의 상품) — `checkEvent`·`applyEvent` 공통 구조 검사. 이름·별칭의 휴대폰 번호는 `checkEvent`만 | AC-O1-02·04~06·14·22 |
| `src/engine/draft.ts` | 판정 자리 `Unit`(옵션 없는 상품 = 번호 자신, 옵션 상품 = 변형 하나), 확인 필요 항목 작업 사본 | AC-O1-08 |
| `src/engine/rules.ts` | 변형·수량 판 R-4 판정표(`decide` — 수량 2 이상은 대기 없음, 모자라면 `STOCK_SHORT`), 단가 × 수량, 승계는 풀린 수량만큼, 공개 전 찜의 `OPTION_MISSING`, 옵션 방송의 메시지 변환은 1등을 밀어내지 않음 | AC-O1-08~13·24 |
| `src/engine/reducer.ts` | 새 이벤트 `product.focus`·`host.resolveReview`·`host.dismissReview`, 옵션 바꾸기, 지금 상품, 옵션 방송 채팅(`parseOptionComment`), 시청자 취소 요청(변형 미정), 방송자 조치의 `options` | AC-O1-07·14·19~26 |
| `src/engine/views.ts` | `listReviews`, 상품 조회의 `variants`·`confirmedUnits`·`hasOptions`, 방송 조회의 `focus`, 찜 조회의 `key`·`qty`·`variant`·`options`·`amount`, 취소 요청의 `chooseVariant`·`choices` | AC-O1-40 |
| `src/engine/invariants.ts` | 변형마다 INV-1(확정 수량 ≤ 변형 재고)·INV-2·INV-7, INV-5(단가 × 수량), INV-O1(대기 수량 1), INV-O2(확인 필요 항목 형식) | AC-O1-28 |
| `src/engine/upgrade.ts` | `upgradeState` — 형식 4(옵션 전) → 5 | AC-O1-30 |
| `src/format.ts` | `formatThanksText({ ..., optionText?, qty? })` — 옵션 글은 있을 때만, 수량은 2 이상일 때만, 금액 = 가격 × 수량 | AC-O1-27 |
| `test/golden/*` | 형식 계약: suite `comment-options`(입력 `catalog`·`focus`), 옵션 방송 필드·이벤트(다른 방송이면 읽기 오류), expect `variants`·`reviews`·`confirmedUnits`·`claims[].qty`, 거절 사유 `OPTION_MISSING`, 옵션 상품의 상품 단위 `winner`·`winners`·`waitlist`·`conflict`는 러너 오류, 효과 보고 `options`. 옵션 모양 검사는 코어 함수를 쓰지 않고 README대로 따로(`validate-options.ts`) | AC-O1-31~36 |
| `test/unit/engine-options.test.ts`·`options.test.ts`·`engine-properties-o1.test.ts`·`test/golden/runner-o1.test.ts` | 단위·러너 자체(받음 1·읽기 오류 1, 틀린 기대값 실패)·속성(무작위 옵션 방송, INV-O2·결정성) | AC-O1-01~33 |

## 실행

- `pnpm golden` — 지금: 파일 33 · 파서 596 · 엔진 146 · **통과 740 · 불일치 2**(G-ENG-O1-08·10 — 아래 "스펙 이의"). 나머지 0.
- `pnpm test` — `packages/core/test/golden/core-adapter.test.ts`의 합계 단언은 AC-O1-35 목표(통과 742)로 바꿨다. 위 두 골든을 spec-keeper가 고치기 전까지 이 하나가 실패한다(약화하지 않았다).
- 골든 하나만 돌리기(예: 고친 사본 확인): `@livejjim/core/golden`의 `runGoldenSources({ files: [{ path, text }], allowlist: { path: 'x', text: null }, core: realCore })`.

## 스펙 이의 (disputesWithSpec — 골든을 고치지 않았다)

1. **G-ENG-O1-08**: `host.assign`의 `UC_B`·`UC_C`가 시나리오에서 한 번도 채팅·문자찜을 하지 않아 엔진이 모르는 구매자다. R-9 "구매자는 엔진이 이미 아는 구매자여야 한다 … 모르는 구매자 … 아무 일도 없다"대로면 두 배정은 아무 일도 없고 뒤 기대값(S·M 1등, s1 취소, A 승계)이 모두 어긋난다. 또 `products.b1/21.confirmedUnits: 4`는 같은 줄 주석 "S 1 + M 2(C 1 + A 1)"의 합 3과 다르다(L은 비어 있다). 두 채널이 배정 전에 채팅(예: `안녕하세요`)을 한 줄씩 하고 `confirmedUnits: 3`이면 나머지 기대값은 모두 지금 코어로 통과한다(사본으로 확인).
2. **G-ENG-O1-10**: `product.renumber 31 → 35` 뒤 `b1/35#흰색`의 1등이 그대로 A(대기 G)라고 기대하지만, R-10 1 "a에 붙어 있던 찜(확정·대기)은 전부 `REJECTED(RENUMBERED)`"(다육 규칙 그대로, R-19 "번호 변경은 상품 전체에 걸린다")대로면 A·B가 번호 바뀜으로 끝나고 G가 35 흰색 1등이 된다(`b1/35` OPEN, 검정색 OPEN·1등 없음, 효과 5·5). 지금 상품이 번호 변경을 따라가는 것(이 시나리오의 뜻)은 그대로 확인된다. R-10 기대값으로 고친 사본은 지금 코어로 통과한다. 옵션 방송만 번호를 바꿔도 찜을 남기려면 R-10·R-19 문장과 결정이 먼저 필요하다 — 그때까지 코어는 R-10대로 둔다(판매자가 번호를 바꿨는데 이전 번호로 산 확정이 말없이 이어지는 것보다 확인 목록에 올리는 쪽이 지금 규칙).

## 스스로 정한 것 (스펙이 말하지 않은 경계 — spec-keeper 검토 부탁)

| # | 경우 | 정한 것 | 까닭 |
|---|---|---|---|
| 1 | 공개 때 수량 2 이상 보류 찜의 수량이 남은 수량보다 많다 | 판정하지 않고 찜을 `REJECTED(SOLD_OUT)`로 끝내고 확인 필요 `STOCK_SHORT`(번호·옵션·수량) | R-19는 "찜을 만들지 않고 확인 필요"인데 보류 찜은 이미 있다. 거절 사유 열거값에 맞는 것이 없어 새 값을 만들지 않았다(이의 — 사유를 더할지 spec-keeper가 정한다) |
| 2 | 옵션 상품의 `product.update.stock` | 등록과 같게 "stocks에 적지 않은 변형마다의 재고" — 적으면 그 변형들을 모두 그 값으로(확정 수량보다 작으면 이벤트 전체 아무 일도 없음), 적지 않으면 변형 재고 그대로 | README 등록 행의 뜻을 수정에도 그대로. 판매자에게 다른 뜻으로 보이면 화면(O2)이 `stocks`로만 보내면 된다 |
| 3 | 찜이 있을 때 별칭 바꾸기 | (수정 라운드 1, SA-O1-06) 기존 선택지의 별칭 바꾸기는 **받지 않는다**(이벤트 전체 아무 일도 없음) — AC-O1-07 "선택지 더하기·가격 차이·변형 재고만". 새로 더하는 선택지의 별칭은 받는다. **상품 별칭**(`aliases`)은 옵션이 아니라고 보고 받는다 — spec-keeper 확인 부탁 | R-19 "옵션은 선택지 더하기와 가격 차이 바꾸기만". 상품 별칭은 찜의 변형을 바꾸지 않고, 방송 중 인식을 늘리는 쪽이 판매자에게 덜 놀랍다 |
| 4 | 변형을 정하지 않은 시청자 취소 요청의 조회 | `listCancelRequests`에 `product` = 상품 키, `chooseVariant: true`, `claim` = `request:<상품 키>:<구매자>`(요청 하나의 키), `choices` = 그 채널의 활성 찜 ID. 승인·무시는 `options`로 변형을 골라 보낸다. 그 채널의 그 상품 활성 찜이 모두 끝나면 요청도 사라진다 | 화면·서버가 지금처럼 `claim`을 키로 쓴다(서버 views가 `claim`으로 묶는다) |
| 5 | 항목 이름·상품 별칭의 제어 글자 | 입력 오류(label·선택지 별칭과 같게) | 판매자 글 칸이 화면·라벨에 그대로 나간다 |
| 6 | 변형이 하나뿐인 상품(선택지 하나뿐인 항목만)의 번호만 쓴 찜 | 그 변형의 찜으로 판정(인식 함수도 `61` → 옵션을 채운 주문). 같은 사람의 같은 변형 보류 찜이 이미 있어 공개 때 둘이 되면 뒤 찜은 `DUPLICATE` | "선택지가 하나뿐인 항목은 댓글에 없어도 그 선택지" |
| 7 | 번호 문법 한 메시지(`21 22`)의 두 번호 보류 찜이 둘 다 공개 때 `OPTION_MISSING` | 항목은 출처(메시지)마다 하나 — 처음 것(먼저 공개된 번호)만 남는다 | "같은 출처는 하나만" |
| 8 | 확인 필요의 읽은 것 | `OPTION_CONFLICT`·`UNKNOWN_WORD`·`NUMBER_AMBIGUOUS`·`MULTI_PRODUCT`·`PRODUCT_AMBIGUOUS`는 골든대로 옵션을 담지 않는다. `OPTION_CONFLICT`는 쓴 수량이 있으면 담는다. 선택지가 하나뿐이라 자동으로 채운 항목은 읽은 것이 아니다(담지 않는다) | D-O1-08 "읽은 것만" |
| 9 | 받을 때 확인 필요 항목이 된 메시지의 메시지 변환 | 항목을 지우거나 바로잡은 뒤에도 늘 아무 일도 없다(메시지 기록의 `review` 표시) | "주문·취소였던 메시지"처럼 받을 때의 해석으로 정한다 — 한 메시지가 두 길로 찜이 되지 않게(D-O1-07) |
| 10 | `NUMBER_AMBIGUOUS`(숫자만 쓴 댓글이 지금 상품의 선택지와 같음) | 메시지가 숫자만일 때만(`100`). `100번`은 번호 주문 | "숫자만 있는 메시지" |
| 11 | 옵션 값도 비교 글자(공백 무시)로 맞춘다 | `물 1 L` = `1L` (숫자 앞뒤 붙음 검사는 원래 메시지에서) | R-19 "비교 글자" |
| 12 | 번호를 바꾼 뒤 이전 번호에 남은 변형 보류 찜(이름으로 찜했는데 상품이 떠남)이 그 번호의 새 상품에서 공개될 때 | 새 상품에 그 변형이 없으면 `REJECTED(OPTION_MISSING)` + 확인 필요 | 지어낸 변형으로 판정하지 않는다 |
| 13 | 대기 중인 구매자에게 수량을 적어 직접 배정 | 그 대기 찜이 적은 수량을 받아 확정(빈 자리 = 수량 ≤ 남은 수량) | R-9 "대기 찜이 있으면 그 찜이 확정" + R-19 수량 |
| 14 | 승계(AUTO)·교체 뒤 승계 | 풀린 수량만큼만(수량 1 찜이면 지금처럼 한 명). 교체 WAITLIST로 원래 비어 있던 자리는 승계로 채우지 않는다 | 다육 방송 동작 그대로 — 기존 속성 시험이 지킨다 |

## O2·O3에게 (AC-O1-40)

### 새 이벤트·필드 (모두 옵션 방송 `claim.parseMode=OPTIONS`에서만 — 다른 방송이면 `checkEvent` 문제)

| 이벤트 | 새 칸 |
|---|---|
| `product.register` | `aliases: string[]`(0~10, 1~20자), `options: { name, choices: { label, aliases?, price? }[] }[]`, `stocks: Record<옵션 글, 0 이상 정수>` |
| `product.update` | 같은 세 칸 (`options`는 바꾼 뒤 전체). 찜이 있으면 선택지 더하기(끝)·가격 차이·별칭·변형 재고만 — 막힌 바꾸기는 입력 오류가 아니라 **아무 일도 없음**(같은 상태) → 화면이 "새 번호로 등록해 주세요"로 안내 |
| `product.focus` | `b`, `no` (없는 번호·`HOLD`·`CLOSED`면 지금 상품을 없앤다) |
| `sms` | `qty`(1~maxQuantity), `options`(상품이 있으면 모든 항목 필수, 없으면 쓰지 않는다) |
| `host.assign` | `qty`, `options`(옵션 상품이면 필수) |
| `host.cancel`·`reject`·`promote`·`confirm`·`approveCancel`·`dismissCancel`·`reopen` | `options`(변형 고르기 — 옵션 없는 상품에 적으면 문제. 안 적으면 그 구매자의 활성 찜이 하나뿐일 때만 그 찜, `reopen`은 옵션 상품이면 필수처럼 동작) |
| `host.resolveReview` | `b`, `item`(메시지 ID 또는 `sms:<ref>`), `no`(그 방송에 상품이 있어야 한다), `qty`, `options?`, `reason?` |
| `host.dismissReview` | `b`, `item`, `reason?` |

`checkEvent` 문제의 `field`(서버가 판매자 문장으로 바꿀 자리 — 문장은 O2가 정한다): `options`(옵션 방송 아님 / 항목과 안 맞음 / 빠진 항목 / 상품 없음), `options[i].name`·`options[i].choices[j].label`·`…aliases[k]`·`…price`(모양·겹침), `aliases[i]`, `stocks`·`stocks.<옵션 글>`(옵션 없음 / 모르는 변형 / 값), `qty`(범위), `no`(바로잡기 번호에 상품 없음), `type`(옵션 방송만의 이벤트), `price`(변형 단가가 0 아래). 이름·별칭의 휴대폰 번호는 `code: 'PHONE_NUMBER'`(지금 문장 그대로).

### 조회 (모두 `@livejjim/core`)

- `getProduct`·`listProducts` → `ProductInfo`에 `aliases`, `options`, `hasOptions`, `confirmedUnits`, **`variants: VariantInfo[]`**(항목 순서·선택지 순서). 옵션 상품의 `winners`·`waitlist`는 빈 목록 — 1등·대기는 변형에.
- `VariantInfo` = `{ key: '<b>/<no>#<옵션 글>', text: '흰색/대형', options: [항목, label][], status, stock, confirmedUnits, remaining, price(단가), winners, winnerClaims, waitlist, waitlistClaims, awaitingSuccession, conflict }`. 상태: 판매 중이면 확정 수량 = 재고일 때 `SOLD`(재고 0은 처음부터), 아니면 `OPEN`, 판매 중이 아니면 상품 상태.
- `listReviews(state)` → `ReviewInfo[]` 원래 순위(출처의 seq) 순, 모든 방송 한 목록: `{ broadcast, item, buyer, currentBuyer, reason, product(지금 상품 키|null), no|null, options([항목, label][] 읽은 것만|null), qty|null, seq, at, origin('chat'|'sms') }`. 사유 9개: `OPTION_MISSING`·`OPTION_CONFLICT`·`UNKNOWN_WORD`·`QTY_INVALID`·`NUMBER_AMBIGUOUS`·`PRODUCT_AMBIGUOUS`·`MULTI_PRODUCT`·`FOCUS_CHANGED`·`STOCK_SHORT`. 화면은 남은 수량을 `VariantInfo.remaining`으로 보인다.
- `getBroadcast`·`listBroadcasts` → `focus: { product, no, productId, at } | null`(지금 상품, 옵션 방송만. 이름 없는 옵션 댓글은 채팅 `at − focus.at < 15초`면 `FOCUS_CHANGED` — `FOCUS_GRACE_SEC`).
- `listClaims` → `ClaimInfo`에 `key`(변형 키 또는 상품 키), `qty`, `variant`(옵션 글|null), `options`, `amount`(= `price` × `qty`, 확정된 적 없으면 null). `price`는 **단가** 스냅샷이다. `product`는 지금처럼 상품 키.
- `listCancelRequests` → `chooseVariant`·`choices`(위 "스스로 정한 것" 4).
- `activeClaimId(state, b, no, buyer, variant?)` — 옵션 글을 주면 그 변형의 활성 찜.
- `getBuyer`·`listBuyers`·`getSettlement`의 `items`는 변형 키, `subtotal`은 찜 금액(단가 × 수량)의 합.
- 인식 함수만 따로 쓸 때(콘솔 미리 보기 등): `parseOptionComment(text, catalog, focus, settings)` → `{ orders: { no, options?, qty }[], cancels, mentions, review: { reason, no?, options?, qty? } | null }`.

### 라벨·문서·포장(O3)이 읽을 것

- 찜 하나 = `ClaimInfo`: 옵션 글 `variant`(없으면 null), 수량 `qty`, 단가 `price`, 금액 `amount`. 품종 자리 `{name} {variant}`, 수량 2 이상이면 `{qty}개`, 가격 자리는 `amount`(R-19 "표시").
- 감사 문구는 코어가 만든다: `formatThanksText({ no, name, price: 단가, buyerName, optionText, qty })`.
- 효과(`EffectInfo`)의 `product`는 상품 키다(변형을 가리지 않는다). 어느 변형의 효과인지는 `effect.claim` → `ClaimInfo.variant`로 찾는다. 확정버전은 상품마다 센다(변형을 가리지 않는다) — 라벨 키 (찜, 확정버전)는 그대로 유일하다.

### 상태 저장 형식

- `STATE_FORMAT` = **5**(O1). `applyEvent`·`checkEvent`는 형식 4를 받으면 지금처럼 `StateFormatError`(received 4)다 — 서버는 지금처럼 이벤트 로그를 재생하면 된다. 재생 없이 이어 쓰려면 `upgradeState(saved)`(형식 4 → 5, 형식 5면 그대로, 그 밖은 `StateFormatError`). 바꿔 이어 재생한 결과 = 처음부터 재생한 결과(단위 시험).
- 새 상태 칸: 방송 `focus`, 상품 `aliases`·`options`·`variants`, 번호 `units`·`variantActive`·`requests`, 찜 `qty`·`qtyWritten`·`variant`·`options`, 메시지 `review`, 상태 `reviews`. 모두 JSON 데이터.

## 남의 영역을 고친 곳 (최소, 타입·형식 번호 따라가기)

- `apps/web/src/lib/words.ts`: 거절 사유 낱말 `OPTION_MISSING: '옵션 없음'`(코어 열거값이 늘어 `Record<ClaimReason, string>` 타입이 깨졌다 — O2가 문장을 다듬는다).
- `apps/web/test/support.ts`·`console*.test.tsx`: 시험 고정값에 새 조회 칸(`focus`·`aliases`·`options`·`hasOptions`·`confirmedUnits`·`variants`·찜의 `key`·`qty`·`variant`·`options`·`amount`·요청의 `chooseVariant`·`choices`)을 옵션 없는 값으로 더했다(기대값은 그대로).
- `apps/server/test/inherit-restart.test.ts`: 스냅샷 형식 번호를 `STATE_FORMAT` 상수로(4 → 5).
- `apps/server/test/api.test.ts`: 엔진만 먼저 처리하는 이벤트 목록에 `product.focus`·`host.resolveReview`·`host.dismissReview`(쓰기 API는 O2).

## 시험 쪽에게 (test-domain)

- 무작위 옵션 방송 로그 만들기는 `packages/core/test/unit/engine-properties-o1.test.ts`의 `eventsOf`가 참고가 된다(입력 오류 이벤트는 `checkEvent`로 걸러 서버처럼 기록하지 않는다).
- 확인 필요 항목 비우기(INV-O2 비교): 상태의 `reviews`를 빈 영속 맵으로 바꾼 뒤 `listProducts`·`listBuyers`·`listEffects`를 비교하면 된다(위 시험이 그렇게 한다).

## 수정 라운드 1 (dev-core)

| 지적 | 처리 |
|---|---|
| SA-O1-03 · TD-O1-001 · TD-O1-002 | 번호를 바꾸거나(`from`·`to`), 그 번호에 새 상품을 등록하거나, 상품을 수정해도 **그 번호의 변형 보류 찜이 가진 변형 자리는 남긴다**(`withPendingUnits`, 빈 자리 — 보류 찜만 가리킨다). 이벤트 끝에 상품 변형이 아니고 보류 찜도 없는 자리는 지운다(`pruneUnits`). 그래서 차단·합치기·방송자 취소·무효(옵션 없이 — 활성 찜 하나뿐)·시청자 취소가 그 찜을 찾고 끝낸다. 조회(`ProductInfo.variants`)는 상품 변형만 보인다. 상태 형식은 그대로 5(자리 목록에 빈 자리가 더 있을 수 있을 뿐) |
| SA-O1-04 · TD-O1-003 | `parse/chat.ts`에 `matchesNumberGrammar` — 범위·개수 상한·multiNumber와 따로 "메시지 전체가 번호 문법인가". 옵션 인식은 문법이면 STRICT 결과(언급)를 그대로 돌려준다(R-20 2) |
| SA-O1-06 | 위 표 3 |
| SA-O1-01 · 02 | 골든(spec-keeper 몫) — 위 "스펙 이의" 1·2 그대로. 코어는 바꾸지 않았다 |
| SA-O1-05 | 거절 사유 열거값은 스펙 몫(D-O1-11 대기). 정해지면 `rules.ts` `openPending`의 `'SOLD_OUT'` 한 곳과 `ClaimReason`만 바꾸면 된다 |
| TD-O1-004 | R-20 5대로 동작(코드 버그 아님) — spec-keeper 결정 대기 |


## 수정 라운드 2 (dev-core)

| 지적 | 처리 |
|---|---|
| SA-O1-03 (TD-O1-002 남은 부분) | 새 `engine/leftover.ts` `leftoverVariant(slot, readClaim, pick)` — 그 번호의 보류 찜 가운데 옵션 쌍(`claim.options`)이 고른 옵션과 똑같은(항목 수·이름·label) 변형 찜의 옵션 글. 입력 검사(`validate-options.ts` 찜을 가리키는 조치 = `host.cancel`·`reject`·`promote`·`confirm`·`approveCancel`·`dismissCancel`·`reopen`)는 그 번호 상품의 옵션과 안 맞아도(상품 없음·다른 상품·옵션 없는 상품) 이 함수가 찾으면 받는다. 엔진은 `pickedVariant` — 상품 변형이면 그 변형, 아니면 같은 함수로 남은 찜의 변형(`targetOf`, `reopen`). 맞는 찜이 없으면 지금처럼 입력 오류. 같은 함수라 받는 입력과 찾는 찜이 어긋나지 않는다(받았는데 엔진이 `CorruptStateError`를 내는 일 없음). 단위 시험: `engine-options.test.ts` "남은 변형 보류 찜을 옵션으로 골라 끝내기" |
| SA-O1-01 · 02 | 그대로 골든(spec-keeper 몫). `core-adapter.test.ts` 합계 시험(통과 742)과 coverage 실패는 이 두 골든 불일치에서 온다 |
| SA-O1-05 | D-O1-11이 아직 없다. 골든 README 열거값(거절 사유)에 새 값이 없어 코어가 혼자 값을 만들지 않는다. 정해지면 `rules.ts` `openPending`의 한 줄과 `ClaimReason`만 바꾼다 |
| TD-O1-004 | R-20 5 "그 밖(옵션 없는 상품, 남은 말 둘 이상, 지금 상품 후보뿐)은 그 밖(언급)이다" 그대로 — spec-keeper 결정 대기 |

## 분쟁 판정 반영 (라운드 2, dev-core)

| 지적 | 처리 |
|---|---|
| SA-O1-01 · 02 | spec-keeper가 골든을 고쳤다(4fe2af5, D-O1-12). 코어 변경 없음. G-ENG-O1-08·10 통과 |
| SA-O1-05 | D-O1-11대로 `ClaimReason`에 `STOCK_SHORT`, `rules.ts` `openPending`의 수량 부족 보류 찜 → `REJECTED(STOCK_SHORT)`(남은 수량 0이면 지금처럼 `SOLD_OUT` — `decide`가 먼저 품절로 거절). 러너 계약 `REJECT_REASONS`에 추가, 화면 낱말 `apps/web/src/lib/words.ts` `STOCK_SHORT: '수량 부족'`. 단위 시험: 기존 수량 부족 시험의 사유를 D-O1-11대로 바꾸고, 남은 수량 0 경계(SOLD_OUT·확인 필요 없음)·번호 변경으로 판정되는 보류 찜(STOCK_SHORT) 두 개 추가. `core-adapter.test.ts` 합계를 파일 33 · 파서 596 · 엔진 147 · 통과 743으로(G-ENG-O1-11) |
