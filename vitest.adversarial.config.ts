// adversarial 단계 설정 (AC-S00-12, AC-S00-15). tests/adversarial/**/*.test.ts 만 돈다.
import { defineConfig } from 'vitest/config'
import { TEST_TIME_ZONE } from './scripts/verify/time-zone.mjs'

process.env.TZ = TEST_TIME_ZONE

export default defineConfig({
  test: {
    name: 'adversarial',
    root: import.meta.dirname,
    include: ['tests/adversarial/**/*.test.ts'],
  },
})
