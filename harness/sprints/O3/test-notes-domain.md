# O3 test-domain 노트 (라운드 0)

시험 폴더: `tests/adversarial/o3/` — 실행 `npx vitest run -c vitest.adversarial.config.ts tests/adversarial/o3/`

## 파일

| 파일 | 무엇을 보나 |
|---|---|
| `scenarios.ts` | 공용 도구(테스트 아님). 결정적 PRNG로 다육(STRICT 셋 — 같은 날 둘 + 다음 날 하나)·옵션 방송(b2, maxQuantity 99) 무작위 판매를 실제 코어로 돌린다. `snapshot()`은 상품 라벨 데이터·내용 키·그림 해시, 포장 라벨 데이터(label-data·packing 두 경로)·내용 키·쪽 그림 해시, 한 사람·전원 확인서, 대장 행·열 값을 모은다. 모듈을 인자로 받아 BASE src로도 돈다 |
| `gen-base.ts` | BASE 고정값 만들기(테스트 아님). BASE 커밋을 따로 풀고(`git archive <BASE> apps/server packages … \| tar -x`) 각 패키지 `node_modules`를 `cp -R`(상대 링크 그대로), 루트 `node_modules`는 링크로 둔 뒤 `node tests/adversarial/o3/gen-base.ts <그 루트>` |
| `fixtures/base-strict.json` | BASE src로 만든 다육 씨앗 40개의 결과(확정 찜 413 · 묶음 289 · 대장 행 549) |
| `strict-regression.test.ts` | AC-O3-30 (1): 지금 코드의 결과 = BASE 결과(깊은 같음), 다육만이면 라벨 데이터 다섯 칸·포장 항목 정수·대장 11열 |
| `options-props.test.ts` | AC-O3-30 (2)~(5): fast-check 씨앗 200개. 상품 라벨 가격 = 찜 금액 = 단가 × 수량, qty·variant는 있을 때만, 가격 글의 `N개` = 찜 수량. 포장 count = 수량 합, (번호, 옵션 글) 겹침 없음, 옵션 없는 수량 1만 정수, 두 경로 데이터 같음. 확인서 줄 합 = 상품 합계, 상품 수 = 수량 합. 대장 확정 행 = 확정 찜(번호·옵션·수량·금액 묶음까지), 가격 = 단가 × 수량, 14열 |
| `options-render.test.ts` | 무작위 옵션 판매의 서버 라벨 데이터를 모든 기본 템플릿으로 그림: 상품은 그려지거나 숫자 항목 DOES_NOT_FIT뿐, 가격 글 잘림 없음. 포장은 그려지거나 DOES_NOT_FIT(numbers)뿐, 줄을 공백으로 이으면 원래 글, 옵션 글이 있는 쪽은 perPage 절반까지 |
| `options-documents.test.ts` | AC-O3-30 (6): `=1+1`·`<b>`·`<script>`·`=HYPERLINK(...)`·숫자 모양 옵션 글(`100`)이 확인서 데이터·PDF 글·엑셀에서 글 그대로(엑셀 수식·하이퍼링크 칸 없음, 옵션 열은 글 칸, 수량·단가·가격은 수 칸) |
| `round0-findings.test.ts` | TD-O3-001 (실패하는 시험) |

## 지적

- **TD-O3-001** (minor, device) 수량 붙은 가격의 보장값(L-5 O3 문장, D-O3-02)이 `9`로만 된 글로 확인됐다. 내장 글꼴의 숫자 폭이 같지 않아(`0`·`4`가 `9`보다 넓다) 원 표기에서 `3개 300,000원`·`8개 800,000원`·`60개 30,000원`·`40개 40,000원`·`4개 444,444원`이 50×20~50×50 기본 템플릿에서 DOES_NOT_FIT(price)이다. 천원 표기·작은 템플릿·수량 1 보장값(I1)은 숫자마다 확인했고 들어간다.
- **TD-O3-002** (minor, server — 범위 밖 기능, 참고) 유튜브 방송 후 요약 댓글 줄(`summaryLines`, `apps/server/src/youtube/outbox.ts`)은 `product.winnerClaims`만 봐서, 옵션 상품의 1등(변형마다)이 빠지고 수량 2 이상 찜은 단가(`claim.price`)로 적힌다. G-ENG-O3-01 b2 요약 = 초코 과자 두 줄(`2,000원` — 홍길동의 실제 금액은 6,000원)뿐. 판매자 장부 봉인(`youtube/seal.ts`)의 1등 시각도 같은 방식이다. O3 범위(라벨·확인서·대장·포장) 밖이라 실패 시험은 남기지 않았다.
- **TD-O3-003** (nit, server/web — O4) 포장 완료 API가 수량 없는 품목 키 글도 그대로 받는다(이전 화면 호환). 지금 화면은 키 글만 보내고 수량도 보이지 않으므로, 화면을 연 뒤 같은 키의 수량만 바뀌면(취소 → 다시 1등) 서버가 지금 수량으로 "포장 완료"를 적는다. O4가 화면에서 `{ key, qty }`를 보내면 막힌다(dev-notes "O4에게").

## 통과한 공격 (버그 아님)

- 다육만 있는 판매 40씨앗: 라벨 그림 해시·내용 키·포장 데이터·확인서·대장이 BASE와 같다.
- 같은 (번호, 옵션 글) 찜 둘: 같은 변형을 다시 쓰면 DUPLICATE, 직접 배정은 아무 일 없음, 합치기는 확정이 둘이 되면 막힘 — 그래서 포장 항목 수량 합이 99를 넘는 길은 찾지 못했다.
- 아주 긴 옵션 글(선택지 20자 × 3, 공백 없음) + 30자 품종 + 수량: 확인서 PDF·PNG 품종 칸이 글자 사이에서 줄을 바꿔 다 찍힌다.
- 옵션 가격을 `UNPAID_CLAIMS`로 바꾼 뒤에도 라벨 가격·확인서 줄·대장 가격 = 단가 × 수량.
