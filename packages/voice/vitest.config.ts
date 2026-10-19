// 음성 패키지 단위 테스트 (P2). 마이크·네트워크 없이 가짜 인식 객체·가짜 연결로 돈다.
// 추출 성능 시험(p99)은 시간을 재므로 다른 패키지 시험이 끝난 뒤에 돈다(groupOrder) — 서로의 시간 측정이 흔들리지 않게.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'voice',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    sequence: { groupOrder: 2 },
  },
})
