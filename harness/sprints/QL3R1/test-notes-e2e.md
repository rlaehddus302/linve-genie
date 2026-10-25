
## 3회차 (D-QL3R1-10) — test-e2e
- `tests/e2e/ql3r1/words.spec.ts` AC-QL3R1-47·48: 칸 이름을 "상품 관리"로 바꿈(region·h3 제목, 같은 이름 칸 하나뿐). 화면 전체(body 글·region·heading·aria-label)에 "상품 명령"·"상품 바꾸기"가 없다는 단언을 더함. 393 WebKit 경우에도 같은 단언.
- `tests/e2e/ql3r1`·`tests/e2e/ql3r2` 80개 모두 통과(chromium·webkit-iphone). dev-notes에 남았던 `sticky-height.spec.ts:76`("보류 1")·`printer-lost.spec.ts:147`(긴 문장 0개)은 ab330f62 이후 닫힘.
- AC-QL3R1-60·61은 MOB2와 합친 뒤 확인할 몫(이 트랙 단독으로는 기존 묶음 통과로 충분).
