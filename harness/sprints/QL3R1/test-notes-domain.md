# QL3R1 시험 노트 (test-domain)

## 4회차: 합친 main E2E 실패 셋 (D-QL3R1-12·13, AC-QL3R1-63·64)
- 개발 고침 8e5241c4(휴대폰 되돌리기 두 칸 한 줄)를 `tests/adversarial/ql3r1/undo-two-column.test.ts`로 확인했다.
  - 휴대폰 grid 모양이 기대는 DOM 구조를 모든 종류(등록 6상태·조치 7상태)에서 무작위 300묶음으로 공격: 항목 직속 글자 노드 0, 단추는 항목 직속·글 칸 뒤, 단추 있는 항목의 글 칸은 `.undo-text` 하나, 남은 시간은 글 칸 안 문장 바로 뒤 띄어 붙음.
  - 문장(role)·단추 글·`aria-label`·차례·누르면 하는 일은 고치기 전(6b1f2629) 참조 모형과 같다. 이름 속 HTML 태그는 글로만 들어간다.
  - 변이 확인: 옛 UndoBar(6b1f2629) → 실패, 남은 시간 앞 띄어쓰기 빼고 글 칸 밖에 빈칸 → 실패. 원래 코드로 통과(3개).
- 화면 높이(단추 top < 문장 bottom, ≤ 52px, 284px)와 merge.spec.ts 고침(AC-QL3R1-64)은 E2E 몫(test-e2e, `tests/e2e/**`)이라 손대지 않았다.
