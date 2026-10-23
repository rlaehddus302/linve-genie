// 확장 단위 시험. test 단계(루트 vitest.config.ts의 projects)가 자동으로 포함한다.
// 기본 환경은 jsdom(가짜 유튜브 채팅 페이지 — D-X1-15). Node 시험은 파일 맨 위에 `@vitest-environment node`.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'extension',
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
