import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    // 무거운 속성 시험이 병렬 부하에서 기본 5초를 넘긴다 — 걸린 시간은 성능 시험(*.perf.test.ts)이 따로 잰다 (D-902)
    testTimeout: 30_000,
    name: 'core',
    include: ['test/**/*.test.ts'],
  },
})
