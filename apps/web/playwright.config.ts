// E2E 설정 (AC-S05-91). `pnpm --filter @livejjim/web e2e` — tests/e2e/**/*.spec.ts를 크로미움으로 돈다.
// 브라우저가 없으면: pnpm exec playwright install chromium (이 저장소의 @playwright/test 1.62.1 = chromium-1234)
//
// 서버와 화면을 묶음(stack)마다 하나씩 띄운다. 화면은 운영용 빌드 + Vite 미리 보기, /api는 같은 출처로 E2E 서버에 넘긴다.
//   | 프로젝트            | 화면  | 서버  | 서버 옵션                                        | 고르는 시험                     |
//   | chromium            | 5173  | 3100  | 방송자 조치 대기 E2E_HOST_DELAY_MS(기본 2000)    | 아래 태그가 없는 시험 전부      |
//   | chromium-prod-delay | 5174  | 3101  | 운영 값 5000 (대기 줄이지 않음)                  | 제목에 @prod-delay              |
//   | chromium-fill       | 5175  | 3102  | --fill yes(오늘 실제 범위 상품 500·채팅 1만)     | 제목에 @fill                    |
// - 리허설 생성기 시험 속도 E2E_CHAT_SPEED(기본 20 — 초당 50 설정이면 초당 1,000).
// - 포트가 겹치면 E2E_PORT_OFFSET(예: 100)으로 모두 옮긴다.
// - 시험 계정: apps/server/e2e/account.json (loginId e2e-shop / password e2e-pass-1234, 가게 이름 "시험 가게").
// - 서버는 메모리 DB라 실행마다 비어 있다(채움 묶음 제외). 같은 실행 안의 시험은 한 서버를 함께 쓴다.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const offset = Number(process.env['E2E_PORT_OFFSET'] ?? '0')
const hostDelay = process.env['E2E_HOST_DELAY_MS'] ?? '2000'
const chatSpeed = process.env['E2E_CHAT_SPEED'] ?? '20'
const reuse = process.env['CI'] === undefined

interface Stack {
  readonly name: string
  readonly web: number
  readonly api: number
  readonly serverArgs: string
  readonly grep?: RegExp
  readonly grepInvert?: RegExp
}

export const STACKS: readonly Stack[] = [
  { name: 'chromium', web: 5173 + offset, api: 3100 + offset, serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}`, grepInvert: /@prod-delay|@fill/ },
  { name: 'chromium-prod-delay', web: 5174 + offset, api: 3101 + offset, serverArgs: `--chat-speed ${chatSpeed}`, grep: /@prod-delay/ },
  { name: 'chromium-fill', web: 5175 + offset, api: 3102 + offset, serverArgs: `--fill yes --host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}`, grep: /@fill/ },
]

export default defineConfig({
  testDir: fileURLToPath(new URL('../../tests/e2e', import.meta.url)),
  testMatch: '**/*.spec.ts',
  outputDir: fileURLToPath(new URL('../../test-results/e2e', import.meta.url)),
  globalSetup: fileURLToPath(new URL('./e2e/global-setup.ts', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: STACKS.map((stack) => ({
    name: stack.name,
    use: { baseURL: `http://localhost:${String(stack.web)}` },
    ...(stack.grep === undefined ? {} : { grep: stack.grep }),
    ...(stack.grepInvert === undefined ? {} : { grepInvert: stack.grepInvert }),
  })),
  webServer: STACKS.flatMap((stack) => [
    {
      command: `pnpm --filter @livejjim/server e2e --port ${String(stack.api)} --origin http://localhost:${String(stack.web)} ${stack.serverArgs}`,
      url: `http://localhost:${String(stack.api)}/api/health`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'pipe' as const,
    },
    {
      command: `node e2e/serve.ts --port ${String(stack.web)} --api http://localhost:${String(stack.api)}`,
      url: `http://localhost:${String(stack.web)}`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'pipe' as const,
    },
  ]),
})
