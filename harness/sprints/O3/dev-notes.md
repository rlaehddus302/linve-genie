# O3 dev-notes

## dev-device (AC-O3-01~13)

### 만든 것
- `packages/label`
  - `ProductLabelData`에 선택 칸 `variant?: string | null`·`qty?: number`(1~99). `checkProductData`는 옵션 없는 수량 1이면 O3 전과 같은 다섯 칸 객체를 돌려준다(`variant`는 옵션이 있을 때만, `qty`는 2 이상일 때만 넣는다).
  - 포장 `PackingBroadcast.numbers`의 원소 = `PackingEntry` = 정수 번호 | `{ no, variant?, qty? }`. 검사를 통과하면 옵션 없는 수량 1 항목은 정수로 바뀐다. 같음 = (번호, 다듬은 옵션 글).
  - 새 export: `PackingEntry`·`PackingEntryObject`·`entryNo`·`entryQty`·`entryVariant`·`isOptionEntry`·`formatLabelPriceWithQty`·`formatPackingEntry`.
  - `PackingPage.numbers`의 원소 타입이 `number | string`이 됐다(옵션 항목은 `"22 105/검정색 ×2"` 글).
  - 번호 목록 줄 바꿈(`placeList`): 글을 공백으로 나눈 낱말을 앞에서부터 채운다. 정수만 있으면 낱말이 `번호,`라 O3 전과 같은 줄이다(BASE 그림 해시로 확인).
  - 내용 키: 옵션 글·수량이 있을 때만 키 끝에 `["option", 다듬은 옵션 글|null, 수량]`을 더한다. 포장 키의 옵션 항목은 `[번호, 옵션 글|null, 수량]`, 나머지는 정수 그대로.
- `packages/documents`
  - 확인서 `ReceiptLine.name` = 품종 칸 글(`itemText` — `{품종}[ {옵션 글}][ ({단가} × {수량}개)]`), `price` = `ClaimInfo.amount`, `itemCount` = 수량 합. 줄 모양(키)은 그대로.
  - 판매대장 `buildLedger` 결과에 `options: boolean`(대장에 든 방송 중 옵션 방송이 있나)을 더했다. 옵션이면 모든 행에 `variant`·`qty`·`unitPrice` 칸이 있고 가격 = 찜 금액. 옵션이 아니면 행 객체는 O3 전 그대로.
  - 옵션 상품의 확정 찜은 변형들의 `winnerClaims`를 모아 `confirmVersion` 순으로 행을 만든다(이전엔 `product.winnerClaims`가 비어 "판매 중" 빈 행이 되던 자리).
  - 새 export: `LEDGER_OPTION_COLUMNS`·`ledgerColumns(options)`·`hasOptionColumns(row)`·`ledgerRowValuesWith(row, options)`·`itemText`. `ledgerRowValues(row)`는 그 행에 옵션 칸이 있으면 14열(Array.map에 그대로 넘겨도 된다).
  - `ledgerToXlsx(rows, options?)` — 옵션을 넘기지 않으면 행 중 하나라도 옵션 칸이 있으면 14열. 옵션 칸 없는 행(다육만 있는 날짜)을 옵션 대장에 이어 붙이면 확정 행 = 옵션 "" · 수량 1 · 단가 = 가격, 확정 없는 행 = 빈칸.

### 시험
- `packages/label/test/golden.test.ts` — 파일 6 · 사례 154 고정, ID `G-LBL-<세 자리>` 또는 `G-LBL-<스프린트>-<두 자리>`.
- `packages/label/test/o3.test.ts` — AC-O3-02~09. 다육 회귀 고정값 `packages/label/test/fixtures/base-o3.json`은 **BASE(06ef423) src로** `gen-base-snapshot.ts`를 돌려 만든 그림 해시 782개·내용 키 102개다(`git stash push packages/label/src && node packages/label/test/gen-base-snapshot.ts && git stash pop`).
- `packages/documents/test/golden.test.ts` — 문서 골든(파일 2 · 사례 6), 형식 위반 읽기 오류 시험 포함. `checkDocFile`을 export한다.
- `packages/documents/test/o3.test.ts` — AC-O3-11~13 (PDF 글·전원 PDF·긴 품종 칸 줄 바꿈·PNG·엑셀 다시 읽기).

### 스스로 정한 경계 (스펙이 정하지 않은 작은 것)
- 확인서 품종이 비어 "품종 미입력"이면 옵션 글을 그 뒤에 붙인다(`품종 미입력 M`). 라벨은 L-3대로 옵션 글만.
- 확인서 옵션 글은 코어 `ClaimInfo.variant`를 앞뒤 공백만 지우고 쓴다.

### dev-server에게
- 대장: 서버는 날짜마다 `buildLedger`를 따로 불러 행을 이어 붙인다(`closing.ts #ledgerRows`). 대장 전체의 열 모양은 **그중 하나라도 `result.options`면 14열**이어야 한다(D-O3-07). `ledgerToXlsx(rows)`는 행으로 정하므로 행이 있으면 맞지만, 옵션 방송에 상품이 하나도 없는 날짜만 옵션이면 11열이 된다 — 정확히 하려면 `options`를 모아 `ledgerToXlsx(rows, options)`로 넘긴다(`work-worker.ts`).
- 상품 라벨 데이터: `variant`는 `ClaimInfo.variant`가 있을 때만, `qty`는 2 이상일 때만 넣으면 다육 라벨 객체가 O3 전과 같다. `price`는 `ClaimInfo.amount`.
- 포장 라벨 데이터: 옵션 없는 수량 1 찜은 정수 번호 그대로, 아니면 `{ no, variant?, qty? }`. 같은 (번호, 옵션 글)은 수량을 더해 한 항목으로(안 그러면 `INVALID_DATA`).

## dev-server (AC-O3-20~25)

### 만든 것
- `apps/server/src/label-data.ts`
  - `productLabelData`: `price` = `ClaimInfo.amount`(찜 금액), `variant`는 `ClaimInfo.variant`가 있을 때만, `qty`는 2 이상일 때만. 다육 찜은 O3 전 다섯 칸 객체 그대로.
  - 새 `packingBroadcasts(state, root, date, claims?)`: 지금의 구매자 root의 그 날짜 확정 찜을 (방송, 번호, 옵션 글)로 묶어 수량을 더한다. 순서는 방송 선언 순 → 번호 → 상품의 변형 순서(`ProductInfo.variants` 순). 옵션 없는 수량 1은 정수 번호. `claims`는 시험용 주입 자리(기본 `listClaims(state)`).
  - 출력 경로(`print.ts`)와 포장 모드(`packing.ts`)의 포장 라벨 데이터가 둘 다 이 함수를 쓴다.
- `apps/server/src/packing.ts`
  - 포장 품목 = 찜의 키(`ClaimInfo.key` — 옵션 찜은 변형 키 `<방송>/<번호>#<옵션 글>`)마다 하나. `PackingItem`에 `variant`(옵션 글 또는 null)·`qty`(확정 찜 수량 합)를 더했다. `price`는 그 키의 찜 금액 합이다(다육 수량 1이면 가격 스냅샷 그대로).
  - `PackedItem`에 `qty`를 더했다. 견줄 글 `pairText`는 (ID, 키, 수량)이라 수량만 달라도 `포장 다시 확인`·`배송 뒤 바뀜`이 된다.
  - 기록 형식: 수량 1이면 `{ id, key }`(O3 전 그대로), 2 이상이면 `{ id, key, qty }`. 수량 칸이 없는 기록은 1로 읽는다.
  - 품목 키 정규식 `ITEM_KEY_RE`가 변형 키를 받는다(옵션 글은 제어 글자 없는 1~200자). 상품 키 글만 있는 이전 기록(`PRODUCT_KEY_RE`)은 그대로다.
  - 포장 완료 본문 `items`의 원소는 키 글이거나 `{ key, qty }`(화면이 본 수량)다. 수량을 보냈는데 지금 수량과 다르면 409 `ITEMS_CHANGED`.
- `apps/server/src/backup.ts`: 복원 검사의 "상품 ID 겹침 금지"를 "같은 상품 ID는 같은 상품 키(`#` 앞)에만"으로 바꿨다. 옵션 상품은 변형마다 품목이라 같은 ID가 여럿 나온다. 이렇게 바꾸지 않으면 옵션 묶음의 포장 기록이 든 백업은 복원되지 않는다.
- `apps/server/src/print.ts`: 새 `winnerClaimsOf(product)` = 상품의 `winnerClaims` + 변형마다의 `winnerClaims`.
  - 상품 라벨 폐기(txHook)와 라벨 목록(`labels`)이 이 함수를 쓴다.
  - 고치기 전에는 옵션 상품 1등의 자동 작업이 만들어지자마자 "1등이 아님"으로 폐기됐다. 옵션 상품은 `winnerClaims`가 빈 목록이기 때문이다(D-O1-01). 그래서 출력 대기열에 옵션 라벨이 나오지 않았다.
- 판매대장 엑셀 (`closing.ts #ledgerRows` → `work-worker.ts`): 날짜 조각마다 `{ rows, options }`를 보낸다. 워커는 `options`를 OR로 모아 `ledgerToXlsx(rows, options)`에 넘긴다(D-O3-07). 상품 없는 옵션 방송만 있는 날짜가 섞여도 14열이다.
- `packages/core/test/golden/core-adapter.test.ts`: 합계 단언 숫자만 파일 34 · 파서 596 · 엔진 147 · 통과 743으로 바꿨다(AC-O3-25).

### 시험 (`apps/server/test/o3-options.test.ts`)
- 판매는 G-ENG-O3-01과 같다. 옵션 칸이 있는 이벤트(옵션 상품 등록·별칭·옵션 문자찜)는 `world.server.writer.write`(같은 기록 경로·코어)로 바로 쓴다.
  - 까닭: 이 트랙의 API는 `options`·`aliases`·`stocks`를 받지 않는다(`UNKNOWN_FIELD`). 옵션 쓰기 칸은 O2 서버 트랙 몫이다.
  - 채팅·방송·다육 상품·포장·내려받기는 API로 한다.
- 같은 변형 확정 찜 둘(AC-O3-21 둘째 Given)은 지금 코어로 만들 수 없다. 같은 변형의 두 번째 직접 배정은 아무 일도 없고, 같은 변형을 가진 두 구매자의 합치기도 `changed: false`다.
  - 그래서 `packingBroadcasts`에 지금 상태의 찜 목록과 복제한 같은 변형 확정 찜을 넘겨 수량 합을 확인했다.
  - 포장 품목(`currentItems`)도 같은 방식으로 키마다 더한다.

### O4·화면에게
- 포장 모드 화면은 지금 `items`를 키 글로 보낸다. O4에서 수량을 보이면 `{ key, qty }`로 보내야 한다. 그래야 "2개 담았는데 그 사이 3개로 바뀜"을 409로 막는다.
- `remove`(뺄 것) 항목에는 옵션 글·수량을 더하지 않았다. 기존 시험이 객체를 그대로 비교하기 때문이다. 수량만 바뀌면 같은 키가 `add`(새 수량)와 `remove`에 함께 나온다.

## dev-device 수정 라운드 1 — SA-O3-001·TD-O3-001 (spec-keeper에게)

- 원인: 기본 템플릿 50×20·50×30·50×40·50×50의 가격 상자 폭은 180점이다. 20점에서 내장 글꼴(Pretendard Bold)의 숫자 폭은 `1` 9.38 … `9` 12.85 · `4` 13.14 · `0` 13.20이다.
  `가격: 9개 999,999원`은 178.88점이라 겨우 들어간다. 같은 글자 수의 `가격: 3개 300,000원`은 180.16점이고 `0`으로만 채우면 약 182점이라 넘친다.
- 기기 쪽에서 고칠 길이 없다. L-3 "찍는 글"(`가격: {수량}개 {가격 표기}`)은 고정이고, D-O3-02는 템플릿을 바꾸지 않는다고 정했고, 범위 경계는 기본 템플릿 배치를 바꾸지 않는다. L-5는 20점 아래로 줄이는 것을 막고, 맞추기 4는 숫자 항목을 줄이는 것을 막는다. 남은 수단은 자간 줄이기 같은 그리기 꼼수뿐인데, 브라우저마다 결과가 달라 미리보기와 출력이 같다는 원칙이 깨진다.
- 실측(숫자 0~9를 모두 돌림, 수량 첫 자리·금액 첫 자리는 1 이상):
  - 큰 네 크기 원 표기: 수량·금액 숫자가 모두 7자리(`9개 999,999원`·`99개 99,999원`)이면 실패한다. 6자리(`9개 99,999원`·`99개 9,999원`)면 숫자와 상관없이 통과한다.
  - 큰 네 크기 천원 표기(`9개 9,999 천원`·`99개 999 천원`): 숫자와 상관없이 통과한다.
  - 작은 템플릿(`99개 99,999,999원`·`99개 99,999 천원`): 숫자와 상관없이 통과한다.
- 제안: L-5 O3 문장과 AC-O3-04에 있는 큰 템플릿의 원 표기 보장값을 `9개 99,999원`·`99개 9,999원`으로 바꾼다. 천원 표기와 작은 템플릿 보장값은 그대로 둔다. 그러면 TD-O3-001 적대 시험 사례(`3개 300,000원` 등)는 "그보다 긴 값"이 되어 `DOES_NOT_FIT`이 맞는 결과가 된다. 판매자에게는 천원 표기(기본값)를 쓰면 들어간다고 안내한다.
- 단위 시험: `packages/label/test/o3.test.ts`의 AC-O3-04에 숫자 0~9를 모두 도는 시험을 넣었다. 천원 표기 보장값, 원 표기 6자리 글, 작은 템플릿 보장값이 대상이다. 스펙이 바뀌면 `bigCases`의 원 표기 두 줄(`9개 999,999원`·`99개 99,999원`)을 새 값으로 바꾼다.

## dev-server 수정 라운드 1 — RA-O3-001

- `winnerClaimsOf`를 `apps/server/src/winners.ts`로 옮겼다(`print.ts`는 다시 내보낸다). 출력·봉인·요약이 같은 함수를 쓴다.
- 봉인 장부(`youtube/seal.ts` `confirmTimes`, 이제 export): 상품의 1등 집합 = `winnerClaimsOf(product)`. 옵션 방송(방송 설정 `claim.parseMode=OPTIONS`)의 채팅은 번호 파서로 상품을 못 찾으므로 그 방송 상품 전부를 본다. → 옵션 판매의 `confirmedAt`이 남는다.
- 방송 후 요약(`youtube/outbox.ts` `summaryLines`): 옵션 상품 판매를 넣고, 가격은 찜 금액 `claim.amount`(없으면 단가 × 수량). 옵션 상품의 같은 번호 줄은 순위 재료(rankTime → seq) 순 — 옵션 없는 상품의 1등 순서와 같은 기준(문자찜은 받은 분의 시작 시각).
- spec-keeper에게: 요약 댓글 줄에 옵션 글·수량을 R-13 문구 규칙대로 넣을지 정해 주세요. 지금 줄은 `번호 품종 금액 구매자` 그대로이고 옵션 글·수량은 없다(금액은 찜 금액).
- 시험: `apps/server/test/o3-options.test.ts` "RA-O3-001" 두 개(장부 confirmedAt 7건 모두 값·변형별 시각, 요약 줄 b1·b2).
- 웹(ProductDetail·ConsolePage·BuyersPage·AlertDialogs·LabelParts)의 `product.winnerClaims`만 보는 곳은 O2/O4 몫이라 그대로다.
