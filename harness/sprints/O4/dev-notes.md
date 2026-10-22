# O4 dev-notes

## dev-server

### 한 일
- AC-O4-01: `packages/core/test/golden/core-adapter.test.ts` 합계 단언 파일 38·엔진 156·통과 752 → 39·159·755 (주석 "O4 +1·+0·+3·+3 (교체 — 약화 아님)"). 작업 지시대로 dev-server가 core 패키지의 시험 파일 숫자만 바꿨다(core 영역, 코드 변경 없음).
- AC-O4-03~07 (D-O4-01): `apps/server/src/generator.ts`
  - `GeneratorView`에 상품 이름·별칭·옵션·변형(옵션 쌍·상태·남은 수량)과 `focus`(지금 상품 번호 — 일시 중지·판매 종료면 null)를 더했다. 새 칸은 선택(없으면 빈 것)이라 예전 보기 모양도 받는다.
  - 설정 스냅샷 `claim.parseMode=OPTIONS`일 때만 `OPTION_KIND_WEIGHTS`(주문 30·보류 10·review 8·언급 12·취소 6·대화 13·닉네임 5·같은 닉네임 6·방송자 4·다시 보내기 6)와 `#makeOption`을 쓴다. 번호 방송은 기존 `KIND_WEIGHTS`·`#make` 그대로라 난수 소비 순서도 같다.
  - 옵션 글은 보내기 전에 코어 `parseOptionComment`(판매 종료 아닌 상품 목록, 지금 상품 ageSec = `FOCUS_GRACE_SEC`(15), 그 방송 설정)로 그 종류로 읽히는지 확인하고, 아니면 다음 후보, 다 아니면 `talk`.
  - 새 종류 `review`. 후보 = `{이름}`·`{이름} {선택지…} {maxQuantity+1}개`·`{이름} 특대`·`{이름} {같은 항목 선택지 둘}`. 옵션 상품이 없으면 `talk`.
  - 시험: `test/generator-base-hash.test.ts`(BASE e44d535 ChatMaker로 미리 구한 SHA-256 18개 고정 — STRICT·LOOSE × 보기 셋 × 시드 1·42·2147483647), `test/generator-options.test.ts`(AC-O4-04~07).
- AC-O4-22 (D-O4-05): `apps/server/src/packing.ts` `decidePacking` — 키 글만 온 품목은 수량 1로 읽어 지금 수량과 비교한다.
  - BASE 동작 변경: 키 글만 보내도 지금 수량으로 적던 것(TD-O3-003)이 이제 수량 2 이상이면 409 `ITEMS_CHANGED`다.
  - 그래서 `test/o3-options.test.ts`에서 수량 2 이상 묶음을 키 글로 포장하던 여섯 곳을 `{ key, qty }`로 바꿨다. AC-O3-22 시험에는 "키 글만 → 409·기록 0"을 더했다. 약화가 아니라 D-O4-05 규칙을 반영한 것이다. 다육(수량 1) 키 글 시험은 그대로 통과한다.
- AC-O4-24 (D-O4-06): `apps/server/src/past.ts`
  - 품목에 `variant`·`qty`·`amount`(코어 `ClaimInfo.amount` 그대로)를 더했다. `price`(단가)는 그대로 둔다.
  - 찜 금액이 없으면 `amount: null`로 두고 `AMOUNT_MISSING` 로그를 남긴다. 로그에는 `date`·`claim`(찜 ID)만 들어간다.
  - 순수 함수 `pastItemLines`를 내보낸다(시험 주입용). `test/i2-past.test.ts`의 품목 모양 기대값에는 새 세 칸을 더했다(더하기만 함).
  - 옵션 찜이 정산 품목과 맞는지는 `claim.key`(변형 키)와 `claim.product` 둘 다로 본다.

### 어긋남 기록 (무엇 · 왜 · 어느 AC)
- O3 포장 시험의 키 글 포장 → `{ key, qty }` · D-O4-05가 키 글을 수량 1로 정함 · AC-O4-22
- 지난 구매 I2 시험의 품목 모양 → 새 칸(variant·qty·amount) 추가 · D-O4-06 · AC-O4-24

### 다음 개발자(web)에게
- 포장 모드 웹(`PackingPage.tsx` 393줄)은 아직 `items: keys`(키 글)를 보낸다. 이제 수량 2 이상 품목이 있는 묶음은 409가 되므로 `{ key, qty }`로 바꿔야 한다(AC-O4-21).
- 지난 구매 품목: `{ title, no, name, price(단가), variant: string|null, qty: number, amount: number|null }`.

## dev-web

### 한 일
- AC-O4-20·21·23 (D-O4-04·05): `apps/web/src/components/PackingPage.tsx`, `apps/web/src/lib/packing.ts`
  - 체크리스트 줄 = `<span.pack-no>{번호}번</span> <span.pack-name>{품종}</span>[ <span.pack-variant>{옵션 글}</span>][ <strong.pack-qty>{수량}개</strong>]` — 수량은 2 이상만, 번호와 같은 2rem·800 굵기로 줄 끝(`margin-inline-start: auto`). 옵션 없는 수량 1 품목은 DOM이 BASE와 같다. 체크 칸 이름 예: `22번 반팔티 105/검정색 2개`.
  - "상품 n개"(체크리스트 머리·포장 목록 줄) = 수량 합(`itemCount`), "a/b 담음" = 줄 수.
  - 포장 완료 본문 `items` = `packItems(entry.items)` = 화면 품목마다 `{ key, qty }`, 화면 순서.
  - 체크·비교 기준 `itemIdentity` = (상품 ID, 키, **수량**). 연 동안(또는 409 응답으로) 수량만 바뀐 품목은 새 품목이라 체크가 지워지고 "새로 담을 것"·"뺄 것"에 함께 나온다.
  - `changeWords`: 옵션 글이 있거나 수량 2 이상인 품목은 `{번호}번 {품종}[ {옵션 글}][ {수량}개]`(뺄 것은 포장 때 수량). 옵션 없는 수량 1 품목은 BASE 규칙 그대로(번호만, 같은 번호가 두 쪽에 있으면 품종).
  - I2 단위 시험(`apps/web/test/closing-pages.test.tsx`)의 포장 완료 기대값을 `['b1/15','b1/28']` → `[{ key:'b1/15', qty:1 }, { key:'b1/28', qty:1 }]`로 바꾸고, 그 파일의 가짜 포장 서버가 `{ key, qty }`를 받게 했다(D-O4-05 규칙 반영 — 약화 아님).
- AC-O4-24 (D-O4-06): `PastPurchases.tsx` `pastLineWords` — `{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액}`, amount가 null이면 금액 칸을 비운다(단가로 채우지 않음). "상품 n개" = 수량 합.
- AC-O4-25 (D-O4-07): `print-words.ts` `labelOptionWords(data)` = `[ {옵션 글}][ · {수량}개]`.
  - 라벨 화면 "그림 파일로 저장할 라벨"·"출력 이력" 줄: `21번 L · 2개 · 홍길동`, `21번 M · 홍길동`, 다육 `7번 · 홍길동`(BASE 그대로).
  - 작업 줄(`JobLine`)은 BASE에 품종이 있어 `21번 반바지 L · 2개 · 홍길동 · 자동 · …`. 버릴 라벨 안내도 `21번 L · 2개 · 홍길동 · 26.10.28 라벨을 버려 주세요`.
  - 상품 자세히의 1등 라벨 묶음 이름·Alt+P 창 단추에도 옵션 글(`claimOptionWords` — 콘솔과 같은 ` L ×2`)을 붙였다. 같은 구매자가 같은 번호의 두 변형 1등일 때 묶음 이름이 겹치지 않게 하려는 것이다. 옵션 없는 찜은 그대로다.
- AC-O4-26 (D-O4-07): `LabelSettings.tsx` — 상품 템플릿의 품종 칸이 꺼져 있으면(고르거나 이미 저장된 것) 한 번 `GET /api/reviews`·`/api/reviews?rehearsal=true`를 묻고, 응답 `scopes`(서버 `optionScopes` — 옵션 방송이 있는 범위)가 하나라도 있으면 안내 "품종 칸을 끄면 사이즈·색상 같은 옵션이 라벨에 찍히지 않아요."를 보인다(`role="note"`). 저장은 막지 않는다. 품종 칸이 켜져 있으면 묻지도 않는다(BASE 화면·요청 그대로). 조회 실패면 안내만 없다.
- AC-O4-27 (D-O4-07): `settlement.ts` `quantityCounts(data)` — 묶음마다 품목 수 + 수량 2 이상 확정 찜의 (수량 − 1). 정산 카드·표의 상품 수에 쓴다. 수량 1 찜만이면 BASE 숫자 그대로. 코어 `settle`에 넘기는 품목 수(미리 보기)는 바꾸지 않았다(코어와 같은 셈 유지).
- 통합 어긋남(웹): 옵션 품목 키 `b/21#M`로 `data.products.get(key)`를 찾아 품종이 늘 ''이었다 — 옵션 상품 품종을 고쳐도 포장 목록·확인서·확인서 목록 그림을 다시 받지 않았다. `productKeyOfItem`으로 상품 키를 찾게 고쳤다(`use-packing.ts`·`ReceiptsPage.tsx`).

### 스스로 정한 세부 (AUTO 근거)
- 작업 줄의 옵션 글 자리: D-O4-07 모양 `{번호}번[ {옵션 글}][ · {수량}개] · {구매자}`에 BASE의 품종을 그대로 두고 그 뒤에 넣었다(`21번 반바지 L · 2개 · 홍길동`). 품종을 빼면 다육 작업 줄이 바뀐다.
- "옵션 방송이 있는 판매자" = 실제·리허설 어느 쪽이든 옵션 방송이 있는 범위가 있는 판매자. 리허설로 옵션을 연습한 판매자도 곧 옵션 방송을 할 것이라 안내를 보이는 쪽이 안전하다(막지 않으므로 손해 없음).

### 시험
- `apps/web/test/o4-web-lib.test.ts`, `apps/web/test/o4-web-screens.test.tsx`

### 다음(test-e2e)에게
- 포장 체크 칸 이름: `7번 핑크프릴` / `21번 반바지 M` / `11번 초코 과자 3개` / `22번 반팔티 105/검정색 2개`. 큰 수량은 `.pack-qty`, 옵션 글은 `.pack-variant`.
- 다시 확인 안내 글: `구매 내역이 바뀌었어요 — 새로 담을 것: 21번 반바지 L · 뺄 것: 21번 반바지 L 2개`.
- 409 뒤 버튼 근처 글: `그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.`
- 라벨 화면 "그림 파일로 저장할 라벨" 목록(`aria-label`)은 `<details>`("라벨마다 그림 파일로 저장") 안에 있다. 출력 방법이 있는 브라우저에서는 접혀 있으니 summary를 눌러 연다.
