// test 단계 설정 (AC-S00-12, AC-S00-14).
// packages/*·apps/* 안의 단위 테스트만 돈다(골든 러너 자체 테스트 포함). tests/**는 이 설정의 대상이 아니다.
// test 단계는 결과를 packages/*·apps/* 안의 *.test.*·*.spec.* 파일 목록과 대조한다. 돌지 않은 파일이나 건너뛴 테스트가 있으면 실패한다.
import { defineConfig } from 'vitest/config'
import { TEST_TIME_ZONE } from './scripts/verify/time-zone.mjs'

// 개발 PC 시간대와 상관없이 같은 시간대에서 돈다 (D-026). 워커는 이 환경을 물려받는다.
process.env.TZ = TEST_TIME_ZONE

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
