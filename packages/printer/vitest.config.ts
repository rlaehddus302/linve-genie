// 프린터 패키지 단위 테스트 — 가짜 niimbluelib 클라이언트·가짜 프린터·주입 타이머로 돈다(실기기·블루투스 없음).
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'printer',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
