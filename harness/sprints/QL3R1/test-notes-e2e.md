
## 3회차 (D-QL3R1-10) — test-e2e
- `tests/e2e/ql3r1/words.spec.ts` AC-QL3R1-47·48: 칸 이름을 "상품 관리"로 바꿈(region·h3 제목, 같은 이름 칸 하나뿐). 화면 전체(body 글·region·heading·aria-label)에 "상품 명령"·"상품 바꾸기"가 없다는 단언을 더함. 393 WebKit 경우에도 같은 단언.
- `tests/e2e/ql3r1`·`tests/e2e/ql3r2` 80개 모두 통과(chromium·webkit-iphone). dev-notes에 남았던 `sticky-height.spec.ts:76`("보류 1")·`printer-lost.spec.ts:147`(긴 문장 0개)은 ab330f62 이후 닫힘.
- AC-QL3R1-60·61은 MOB2와 합친 뒤 확인할 몫(이 트랙 단독으로는 기존 묶음 통과로 충분).

## 4회차 (D-QL3R1-12·13) — test-e2e
- `tests/e2e/s06b/merge.spec.ts` AC-QL3R1-64: `cancelIn`·휴대폰 시험에서 빠른 사유 뒤 "찜 취소하기"를 한 번 더 누르던 옛 줄을 빼고 `quickReasonSent`로 단언(줄마다 `// QL3R1 D-QL3R1-05`) — 남은 창은 상품 자세히 하나(사유 창 0), 그 찜 줄 "보내기 전" + disabled "찜 취소하기" 하나, 되돌리기 띠 "… 초 뒤 보내요: …번 {그 사람} 취소", 휴대폰은 대기 중 `host.cancel` 아직 1개 → 대기 뒤 2개. 뒤 흐름(합치기로 돌아가기·떠나기 확인·23,000원) 그대로.
- `tests/e2e/ql3r1/undo-row.spec.ts` AC-QL3R1-63 새 줄: 375·412·1440 크로미움, 393 WebKit, 글자 100%에서 등록 "20번을 등록했어요"·찜 취소 "… 뒤 보내요: 1번 … 밤톨맘 취소" 항목의 단추 top < 문장 bottom, 등록 항목 ≤ 52px(휴대폰), 단추 ≥ 44px, 말줄임·옆 잘림·가로 넘침 0, 단추 이름·글 그대로, PC는 글 묶음 `display: contents`·항목 flex.
- 변이 확인: 고치기 전 `styles.css`(90341e2d)로 빌드하면 375 "단추 316 ≥ 문장 bottom 307"로, PC는 글 묶음 규칙 없음으로 실패 → 지금 코드로 통과.
