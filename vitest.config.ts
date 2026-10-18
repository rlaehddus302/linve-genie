// test 단계 설정 (AC-S00-12, AC-S00-14).
// packages/*·apps/* 안의 단위 테스트만 돈다(골든 러너 자체 테스트 포함). tests/**는 이 설정의 대상이 아니다.
import { defineConfig } from 'vitest/config'
import { TEST_TIME_ZONE } from './scripts/verify/time-zone.mjs'

// 개발 PC 시간대와 상관없이 같은 시간대에서 돈다 (D-026). 워커는 이 환경을 물려받는다.
process.env.TZ = TEST_TIME_ZONE

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
