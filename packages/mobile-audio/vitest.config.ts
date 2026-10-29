// 앱 마이크 모듈 단위 시험 — 가짜 네이티브 모듈·가짜 웹소켓으로 돈다(실기기·네이티브 빌드 없음). 네이티브는 파일 구조·권한 선언을 검사한다.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'mobile-audio',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
