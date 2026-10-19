// 서버 단위 테스트 (AC-S00-40, AC-S00-41, AC-S04-94). 포트를 열지 않는다: 앱은 app.request(...)로,
// Node HTTP 계층은 메모리 안의 연결(duplexPair)로 요청한다. DB는 PGlite(내장 Postgres, 메모리)라 도커·네트워크가 필요 없다.
// 서버 시험(PGlite·지연 측정)은 CPU를 많이 써서, 같은 시간에 돌면 다른 패키지의 처리 비용 비교 시험(코어 engine-timing)이 흔들린다.
// 그래서 다른 프로젝트가 끝난 뒤에 돈다(groupOrder). 서로의 결과·대상 파일은 그대로다.
// Y1: 유튜브 시험(가짜 서버·채팅 1만 건 수집 등)은 CPU를 많이 써서 서버의 지연 측정 시험(증분 조회 p99)과 같은 시간에 돌면 흔들린다.
// 그래서 서버 시험이 끝난 뒤에 따로 돈다(server-youtube, groupOrder 2). 대상 파일은 그대로 모두 돈다(test 단계가 파일 목록을 대조한다).
// 모든 서버 시험은 실제 구글 주소로 나가는 요청을 막는다(setupFiles, AC-Y1-72).
import { defineConfig } from 'vitest/config'

const YOUTUBE_TESTS = 'test/youtube-*.test.ts'

const common = {
  root: import.meta.dirname,
  environment: 'node' as const,
  // 실제 구글로 나가는 요청을 막는다 (AC-Y1-72)
  setupFiles: ['test/setup-network-guard.ts'],
  // PGlite를 여는 시험이 많아 기본 5초보다 넉넉히 둔다 (지연 시험은 자체 시간 제한)
  testTimeout: 30_000,
}

export default defineConfig({
  test: {
    projects: [
      { test: { ...common, name: 'server', include: ['test/**/*.test.ts'], exclude: [YOUTUBE_TESTS], sequence: { groupOrder: 1 } } },
      { test: { ...common, name: 'server-youtube', include: [YOUTUBE_TESTS], sequence: { groupOrder: 2 } } },
    ],
  },
})
