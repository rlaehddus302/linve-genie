// adversarial 단계 설정 (AC-S00-12, AC-S00-15). tests/adversarial/**/*.test.ts 만 돈다.
// adversarial 단계는 결과를 디스크의 tests/adversarial/**/*.test.ts 목록과 대조한다. include·exclude·testNamePattern 등으로
// 파일이나 테스트를 빼면(건너뜀 포함) 단계가 실패한다 (TD-S00-014). 적대 테스트는 test-domain 소유라 여기서 고르지 않는다.
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
