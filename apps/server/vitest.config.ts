// 서버 단위 테스트 (AC-S00-40, AC-S00-41, AC-S04-94). 포트를 열지 않는다: 앱은 app.request(...)로,
// Node HTTP 계층은 메모리 안의 연결(duplexPair)로 요청한다. DB는 PGlite(내장 Postgres, 메모리)라 도커·네트워크가 필요 없다.
// 서버 시험(PGlite·지연 측정)은 CPU를 많이 써서, 같은 시간에 돌면 다른 패키지의 처리 비용 비교 시험(코어 engine-timing)이 흔들린다.
// 그래서 다른 프로젝트가 끝난 뒤에 돈다(groupOrder). 서로의 결과·대상 파일은 그대로다.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    sequence: { groupOrder: 1 },
    // PGlite를 여는 시험이 많아 기본 5초보다 넉넉히 둔다 (지연 시험은 자체 시간 제한)
    testTimeout: 60_000, // 무거운 속성 시험이 병렬 부하에서 기본값을 넘긴다 — 걸린 시간은 성능 시험(*.perf.test.ts)이 따로 잰다 (D-902)
  },
})
