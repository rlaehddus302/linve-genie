// coverage 단계 설정 (AC-S00-13, AC-S00-14).
// - 코어 단위 테스트(packages/core/test)만 돌려 packages/core/src 를 측정한다.
// - include 에 맞는 파일은 테스트가 import하지 않아도 0%로 포함된다. 제외는 타입 선언 파일(.d.ts)뿐이다.
//   (타입만 있는 .ts 파일은 실행할 문장이 없어 "빈 파일"로 빠진다.)
// - --project 필터를 쓰면 Vitest가 측정 기준 폴더를 그 프로젝트로 바꿔 include가 조용히 비므로,
//   프로젝트 없이 저장소 루트를 기준으로 하는 별도 설정을 쓴다.
import { defineConfig } from 'vitest/config'
import { TEST_TIME_ZONE } from './scripts/verify/time-zone.mjs'

process.env.TZ = TEST_TIME_ZONE

export const CORE_COVERAGE_INCLUDE = ['packages/core/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}']
export const CORE_COVERAGE_THRESHOLDS = { lines: 95, branches: 95 } as const

export default defineConfig({
  test: {
    name: 'core-coverage',
    root: import.meta.dirname,
    // 코어 단위 시험 설정(packages/core/vitest.config.ts)과 같은 시간 제한 — 여러 작업 폴더가 동시에 돌 때 속성 시험이 5초 기본값에 걸리지 않게 (D-906)
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['packages/core/test/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: CORE_COVERAGE_INCLUDE,
      exclude: ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { ...CORE_COVERAGE_THRESHOLDS },
    },
  },
})
