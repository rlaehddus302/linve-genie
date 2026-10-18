// 서버 단위 테스트 (AC-S00-40, AC-S00-41). 포트를 열지 않는다: 앱은 app.request(...)로,
// Node HTTP 계층은 메모리 안의 연결(duplexPair)로 요청한다.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
