// I2 서버 시험 (정산 마무리 — 확인서·판매대장·포장·지난 구매·가져오기·백업). 문서 그리기·엑셀·큰 범위 채우기로 CPU를 많이 써서,
// 같은 시간에 돌면 서버 프로젝트의 응답 지연 시험(changes·latency — p99 기준)이 흔들린다. 그래서 서버 프로젝트(groupOrder 1)가 끝난 뒤에 돈다(groupOrder 2).
// 대상 파일·결과는 그대로다(서버 프로젝트 설정은 이 파일들을 빼고, 루트 vitest.config.ts가 이 설정을 프로젝트로 더한다).
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'server-i2',
    environment: 'node',
    include: ['test/i2-*.test.ts'],
    sequence: { groupOrder: 2 },
    testTimeout: 30_000,
  },
})
