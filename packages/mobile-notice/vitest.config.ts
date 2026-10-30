// 문자찜·입금 알림 받기 모듈 단위 시험 — 가짜 네이티브로 돈다(실기기·네이티브 빌드 없음). 네이티브는 파일 구조·권한 선언을 검사한다.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'mobile-notice',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
