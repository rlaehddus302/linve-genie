// 웹 단위 테스트 (AC-S00-50). test 단계(루트 vitest.config.ts의 projects)가 이 설정을 자동으로 포함한다.
// 기본 환경은 jsdom이다. Node가 필요한 테스트(빌드·린트 확인)는 파일 맨 위에 `@vitest-environment node`를 적는다.
import { defineProject, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
    },
  }),
)
