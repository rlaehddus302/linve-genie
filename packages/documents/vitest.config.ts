// 문서 패키지 단위 테스트 (P2). 골든 G-ENG-201·202의 이벤트를 실제 코어로 재생해 문서 금액을 맞댄다.
// PDF·PNG·엑셀을 실제로 만들고 다시 읽는다(시간이 걸린다). 성능 시험이 있어 다른 패키지 시험이 끝난 뒤에 돈다(groupOrder).
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'documents',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    sequence: { groupOrder: 2 },
    testTimeout: 60_000,
  },
})
