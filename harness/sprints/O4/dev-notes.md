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
