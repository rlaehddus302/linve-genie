// 서버 단위 테스트 (AC-S00-40, AC-S00-41, AC-S04-94). 포트를 열지 않는다: 앱은 app.request(...)로,
// Node HTTP 계층은 메모리 안의 연결(duplexPair)로 요청한다. DB는 PGlite(내장 Postgres, 메모리)라 도커·네트워크가 필요 없다.
// 서버 시험(PGlite·지연 측정)은 CPU를 많이 써서, 같은 시간에 돌면 다른 패키지의 처리 비용 비교 시험(코어 engine-timing)이 흔들린다.
// 그래서 다른 프로젝트가 끝난 뒤에 돈다(groupOrder). 서로의 결과·대상 파일은 그대로다.
// Y1: 유튜브 시험(가짜 서버·채팅 1만 건 수집 등)은 CPU를 많이 써서 서버의 지연 측정 시험(증분 조회 p99)과 같은 시간에 돌면 흔들린다.
// 그래서 서버 시험이 끝난 뒤에 따로 돈다(server-youtube, groupOrder 2). 대상 파일은 그대로 모두 돈다(test 단계가 파일 목록을 대조한다).
// 모든 서버 시험은 실제 구글·틱톡·메타·카카오·네이버·Anthropic 주소로 나가는 요청을 막는다(setupFiles, AC-Y1-72·AC-N2b-1-04·AC-N2-62·L1·A1 공통 전제).
// I2 시험(test/i2-*.test.ts — 문서 그리기·엑셀·큰 범위 채우기)은 server-i2 프로젝트가 서버·유튜브 시험이 끝난 뒤에 따로 돈다(groupOrder 3 — CPU를 다투지 않게).
import { defineConfig } from 'vitest/config'

const YOUTUBE_TESTS = 'test/youtube-*.test.ts'
/** 감사 채팅 다른 길 시험(D-YT-SEND) — Chromium을 띄워 CPU를 많이 쓴다. 유튜브 시험의 실제 시간 시험(응답 없음 15초 등)과 겹치지 않게 맨 뒤에 따로 */
const CHAT_SEND_TESTS = 'test/youtube-chat-send*.test.ts'
/** I2 서버 시험 — server-i2 프로젝트가 돌린다 */
const I2_TESTS = 'test/i2-*.test.ts'

/**
 * 명령행 `--exclude`(test·coverage 단계가 성능 시험 *.perf.test.*를 빼는 것, D-902)는 이 설정 안에 둔 프로젝트(server·server-youtube)에
 * 저절로 이어지지 않는다(Vitest는 프로젝트를 담은 설정의 하위 프로젝트에 명령행 제외를 넘기지 않는다) — 여기서 그대로 잇는다.
 * pnpm perf는 성능 시험 파일을 직접 고르고 --exclude를 주지 않으므로 그때는 아무것도 빼지 않는다.
 */
const cliExclude = process.argv.flatMap((arg, index, all) => {
  if (arg === '--exclude') return all[index + 1] === undefined ? [] : [all[index + 1] as string]
  return arg.startsWith('--exclude=') ? [arg.slice('--exclude='.length)] : []
})

const common = {
  root: import.meta.dirname,
  environment: 'node' as const,
  // 실제 구글로 나가는 요청을 막는다 (AC-Y1-72). 틱톡·서명 서비스로 나가는 연결도 막고, 막힌 시도가 있으면 그 시험 파일을 실패시킨다 (N2b-1, AC-N2b-1-04).
  // 실제 메타 주소로 나가는 연결도 막는다 (N2 AC-N2-62). 실제 밴드 주소(band.us)도 막는다 (BND1 AC-BND1-63)
  setupFiles: ['test/setup-network-guard.ts', 'test/setup-outbound-guard.ts', 'test/network-guard.ts', 'test/setup-social-guard.ts', 'test/setup-assist-guard.ts', 'test/setup-band-guard.ts'],
  // PGlite를 여는 시험이 많아 기본 5초보다 넉넉히 둔다 (지연 시험은 자체 시간 제한)
  hookTimeout: 30_000, // 부하 때 beforeAll(PGlite 열기·마이그레이션)이 기본 10초를 넘겨 파일 전체가 '건너뜀'으로 잡히던 일 (D-906과 같은 이유)
  testTimeout: 60_000, // 무거운 속성 시험이 병렬 부하에서 기본값을 넘긴다 — 걸린 시간은 성능 시험(*.perf.test.ts)이 따로 잰다 (D-902)
}

export default defineConfig({
  test: {
    projects: [
      { test: { ...common, name: 'server', include: ['test/**/*.test.ts'], exclude: [YOUTUBE_TESTS, I2_TESTS, ...cliExclude], sequence: { groupOrder: 1 } } },
      { test: { ...common, name: 'server-youtube', include: [YOUTUBE_TESTS], exclude: [CHAT_SEND_TESTS, ...cliExclude], sequence: { groupOrder: 2 } } },
      { test: { ...common, name: 'server-i2', include: [I2_TESTS], exclude: cliExclude, sequence: { groupOrder: 3 }, testTimeout: 30_000 } },
      { test: { ...common, name: 'server-chat-send', include: [CHAT_SEND_TESTS], exclude: cliExclude, sequence: { groupOrder: 4 } } },
    ],
  },
})
