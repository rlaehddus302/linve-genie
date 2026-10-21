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
