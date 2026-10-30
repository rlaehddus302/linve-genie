import { defineProject } from 'vitest/config'

// SRV1: 서버 전용 음성 읽기 컨트롤러 시험(test/controller — 웹에서 옮긴 실방송 재현 시험)은 가짜 시계로 긴 말을 돌려 무겁다.
// 다른 프로젝트와 같은 시간에 돌 때 기본 5초를 넘기지 않게 넉넉히 둔다 — 걸린 시간은 재지 않는다(D-902)
export default defineProject({ test: { name: 'voice-session', environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60_000 } })
