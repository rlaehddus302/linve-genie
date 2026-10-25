// E2E 설정 (AC-S05-91). `pnpm --filter @livejjim/web e2e` — tests/e2e/**/*.spec.ts를 크로미움으로 돈다(제목에 @webkit인 시험은 WebKit으로).
// 브라우저가 없으면: pnpm exec playwright install chromium (이 저장소의 @playwright/test 1.62.1 = chromium-1234)
// WebKit(아이폰 크기 묶음 webkit-iphone, I5 D-I5-08)도 설치해야 한다: pnpm exec playwright install webkit (= webkit-2336).
//   설치하지 않으면 그 묶음은 브라우저를 열지 못해 **실패**한다 — 건너뛰지 않는다(아이폰 시험이 통과로 숨지 않게).
//
// 서버와 화면을 묶음(stack)마다 하나씩 띄운다. 화면은 운영용 빌드 + Vite 미리 보기, /api는 같은 출처로 E2E 서버에 넘긴다.
//   | 프로젝트            | 화면  | 서버  | 가짜 유튜브 | 서버 옵션                                                         | 고르는 시험                |
//   | chromium            | 5173  | 3100  | —           | 방송자 조치 대기 E2E_HOST_DELAY_MS(기본 2000), 유튜브 준비 안 됨  | 아래 태그가 없는 시험 전부 |
//   | chromium-prod-delay | 5174  | 3101  | —           | 운영 값 5000 (대기 줄이지 않음)                                   | 제목에 @prod-delay         |
//   | chromium-fill       | 5175  | 3102  | —           | --fill yes(오늘 실제 범위 상품 500·채팅 1만)                      | 제목에 @fill               |
//   | chromium-youtube    | 5176  | 3103  | 4100        | --youtube fake --outbox-fast yes (I3: 연결·잇기·수집·발송함)      | 제목에 @youtube            |
//   | chromium-quota      | 5177  | 3104  | 4101        | 위 + --youtube-quota-budget 400 (묶음 < 20%·멈춤 < 5%)            | 제목에 @quota              |
//   | chromium-served     | (3105)| 3105  | —           | --web-dir(서버가 화면을 같은 출처로 함께 냄 — 보안 머리글·CSP)     | 제목에 @served             |
//   | chromium-no-test-printer | 5178 | 3106 | —      | --test-printer no(시험 모드 끔 — 운영처럼 시험용 프린터 없음, AC-I1-50) | 제목에 @no-test-printer    |
//   | chromium-billing    | 5179  | 3107  | —           | --billing yes(요금 기능 켬 + 시험 결제 — 가짜 결제 서버·가짜 발행기, N5 AC-N5-11·40) | 제목에 @billing |
//   | chromium-multi      | 5180  | 3108  | 4102        | 가짜 유튜브 + --instagram yes(가짜 메타 4103) + --tiktok yes(가짜 웹캐스트) — N2b-2 동시 송출 | 제목에 @multi |
//   | chromium-social     | 5181  | 3109  | —           | --social fake --social-port 4104(가짜 OAuth — 구글·카카오·네이버 셋 다 켬, L1)               | 제목에 @social |
//   | chromium-social-one | 5182  | 3110  | —           | --social fake --social-port 4105 --social-providers google(구글 하나만 켬, L1 AC-L1-30)     | 제목에 @social-one |
//   | webkit-iphone       | 5183  | 3111  | —           | 기본과 같음 — 브라우저만 WebKit·devices['iPhone 15'](393px 폭·터치), I5 AC-I5-20~24·90     | 제목에 @webkit     |
//   | chromium-assist     | 5184  | 3112  | —           | --assist fake --assist-port 4106 --assist-daily 3 --assist-timeout-ms 2000(가짜 AI·작은 상한, A1) | 제목에 @assist |
// - 아이폰 크기 묶음(I5): Playwright WebKit은 http://localhost에서 Secure 쿠키를 보내지 않는다 — 그 묶음의 화면 미리 보기 서버만 /api 응답 Set-Cookie의
//   Secure를 떼어 넘긴다(serve.ts --drop-secure-cookie yes, 서버는 그대로). Playwright WebKit은 실제 아이폰 사파리가 아니다(음성 인식 자체는 HG-4). 사파리 흉내 가짜 인식은 시험(tests/e2e/i5)이 넣는다.
// - AI 제안 묶음(A1 AC-A1-11·31): 가짜 LLM 서버가 127.0.0.1:<assist 포트>에 함께 뜬다(조작 GET /_fake/requests·POST /_fake/answers·/_fake/fail·/_fake/reset —
//   A1 dev-notes "가짜 LLM 서버", fakeLlmUrl). 판매자 하루 상한 3, 호출 시간 제한 2초. 기본 묶음들은 키 없는 서버다(AI 제안 "지금은 쓸 수 없어요.", 외부 호출 0).
// - 간편 로그인 묶음(L1 AC-L1-30): 가짜 OAuth 서버가 127.0.0.1:<social 포트>에 함께 뜬다(조작 POST /_fake/* — L1 dev-notes "시험에게", fakeOAuthUrl).
//   기본 묶음들은 간편 로그인이 꺼진 서버다(로그인 화면에 버튼 없음·/api/auth/** 404 — 기본 묶음에서 본다).
// - 요금 기능(N5): 기본 묶음들은 요금 기능이 꺼진 서버다(메뉴 "요금" 없음 — AC-N5-50의 꺼진 서버 시험은 기본 묶음에서 돈다).
//   요금을 켠 시험은 제목에 @billing을 달아 chromium-billing에서만 돈다(실행마다 빈 메모리 DB — 시험 계정은 이용권 없이 시작한다).
// - 여러 플랫폼 묶음(N2b-2 AC-N2b-2-80): 가짜 메타 서버는 127.0.0.1:<instagram 포트>(조작 POST /_fake/* — N2 dev-notes "화면에게" 7, fakeMetaUrl),
//   틱톡은 가짜 웹캐스트(운영자 스위치 켬) — 조작은 그 묶음 서버 주소의 POST /_e2e/tiktok/*(N2b-2 dev-notes "화면에게" 6). 인스타그램 연결을 마치면
//   서버가 화면 주소 `/?instagram=<결과>`로 돌려보내고 화면이 설정의 인스타그램 칸으로 연다.
// - 시험용 프린터(I1): E2E 서버는 기본으로 시험 모드다(화면 연결 방법에 "시험용 프린터 — 실제로 출력되지 않아요"와 window.livejjimTestPrinter 손잡이).
// - 가짜 유튜브 묶음(AC-I3-93): 가짜 구글·유튜브 서버가 127.0.0.1:<가짜 유튜브 포트>에 함께 뜬다(조작은 POST /_fake/*, 상태 GET /_fake/state —
//   harness/sprints/Y1/dev-notes.md "화면(I3)에게" 8). 시험은 STACKS의 youtube 포트를 쓴다(fakeYoutubeUrl). 실제 구글 주소로는 나가지 않는다.
// - 서버가 화면을 내는 묶음(AC-I3-70·71): 화면 서버 없이 브라우저가 서버 주소를 바로 연다. 띄우기 전에 화면을 운영용으로 빌드한다
//   (node_modules/.cache/livejjim-e2e/served-web — 린트·git이 보지 않는 곳). 서버 --origin = 그 서버 주소.
// - E2E 서버의 시험용 조작 POST /_e2e/sellers·/_e2e/dates·/_e2e/seal은 모든 묶음의 서버 주소에서 쓸 수 있다(I3 dev-notes "화면에게" 8).
// - 리허설 생성기 시험 속도 E2E_CHAT_SPEED(기본 20 — 초당 50 설정이면 초당 1,000).
// - 포트가 겹치면 E2E_PORT_OFFSET(예: 100)으로 모두 옮긴다.
// - 시험 계정: apps/server/e2e/account.json (loginId e2e-shop / password e2e-pass-1234, 가게 이름 "시험 가게").
// - 서버는 메모리 DB라 실행마다 비어 있다(채움 묶음 제외). 같은 실행 안의 시험은 한 서버를 함께 쓴다.
// - 서버·화면 모두 127.0.0.1에서만 연다(AC-S06-73, D-096 — 모든 인터페이스가 아니다). 헬스체크·화면의 /api 프록시 대상도 127.0.0.1이다.
//   브라우저 주소(baseURL)는 http://localhost:<포트>로 둔다 — 크로미움이 localhost를 127.0.0.1로 잇는다. 세션 쿠키가 Secure라
//   Playwright의 page.request(시험이 API를 직접 부르는 길)는 http에서 localhost에만 그 쿠키를 보낸다(127.0.0.1이면 401).
//   서버 --origin은 브라우저 주소와 똑같이 http://localhost:<화면 포트>.
// - 서비스 워커(PWA)는 크로미움 묶음에선 막지 않는다 — /api/는 가로채지 않으므로 page.route가 그대로 쓰인다(AC-S06-51).
//   **예외: WebKit(webkit-iphone)** — 서비스 워커가 페이지를 맡으면(navigator.serviceWorker.controller) 그 페이지의 요청이 page.route에 한 번도
//   걸리지 않는다(I5 감사 TE-I5-001에서 재현: /api/days 1번 나감·route 0번, 'block'이면 1번). 그래서 그 묶음은 use에 serviceWorkers: 'block'을 둔다
//   (blockServiceWorkers) — route로 응답을 붙잡거나 바꾸는 @webkit 시험이 조용히 효과 없이 통과하지 않게. 서비스 워커·오프셋 안내 시험은 크로미움 묶음에서 본다.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const offset = Number(process.env['E2E_PORT_OFFSET'] ?? '0')
const hostDelay = process.env['E2E_HOST_DELAY_MS'] ?? '2000'
const chatSpeed = process.env['E2E_CHAT_SPEED'] ?? '20'
const reuse = process.env['CI'] === undefined
/** E2E 서버·화면이 듣는 주소 (모든 인터페이스가 아니다) */
export const E2E_HOST = '127.0.0.1'
/** 듣는 주소 (헬스체크·프록시 대상) */
const listen = (port: number) => `http://${E2E_HOST}:${String(port)}`
/** 브라우저가 여는 주소 (= 서버 --origin) */
const browserOrigin = (port: number) => `http://localhost:${String(port)}`

export interface Stack {
  readonly name: string
  /** 브라우저가 여는 포트 (서버가 화면을 내는 묶음이면 서버 포트와 같다) */
  readonly web: number
  readonly api: number
  readonly serverArgs: string
  readonly grep?: RegExp
  readonly grepInvert?: RegExp
  /** 가짜 구글·유튜브 서버 포트 (I3 — 가짜 유튜브 묶음만) */
  readonly youtube?: number
  /** 서버가 화면 빌드를 같은 출처로 함께 낸다 (화면 서버 없음, AC-I3-70) */
  readonly served?: boolean
  /** 가짜 메타 서버 포트 (N2b-2 — 여러 플랫폼 묶음만) */
  readonly instagram?: number
  /** 가짜 OAuth 서버 포트 (L1 — 간편 로그인 묶음만) */
  readonly social?: number
  /** 브라우저·기기 (Playwright devices 이름). 없으면 위 use의 Desktop Chrome (I5 — 아이폰 크기 묶음만 'iPhone 15') */
  readonly device?: keyof typeof devices
  /**
   * 화면 미리 보기 서버가 Set-Cookie의 Secure를 떼어 넘긴다 (I5 — WebKit은 http://localhost에서 Secure 쿠키를 보내지 않는다).
   * 시험용 미리 보기 서버에서만이고 서버는 그대로 Secure를 붙인다.
   */
  readonly dropSecureCookie?: boolean
  /** 서비스 워커를 막는다 (I5 TE-I5-001 — WebKit은 서비스 워커가 맡은 페이지의 요청을 page.route로 잡지 못한다) */
  readonly blockServiceWorkers?: boolean
  /** 가짜 LLM 서버 포트 (A1 — AI 제안 묶음만) */
  readonly assist?: number
  /** 가짜 밴드 서버 포트 (BND1 — 여러 플랫폼 묶음·아이폰 크기 묶음만. 조작은 서버의 /_e2e/band/*) */
  readonly band?: number
}

/** 서버가 화면을 내는 묶음의 화면 빌드 폴더 (실행마다 다시 빌드한다 — 빌드 결과물이 린트 범위에 들어가지 않게 node_modules/.cache 아래) */
export const SERVED_WEB_DIR = fileURLToPath(new URL('../../node_modules/.cache/livejjim-e2e/served-web', import.meta.url))
/** 작은 할당량 묶음의 예산 (게시 20 · 목록 조회 5 · 댓글 50 단위) */
export const E2E_QUOTA_BUDGET = 400

const socialArgs = (port: number, providers?: string) => `--social fake --social-port ${String(port)}${providers === undefined ? '' : ` --social-providers ${providers}`}`
/** AI 제안 묶음의 판매자 하루 상한 (작은 값 — 상한 문장을 빨리 본다) */
export const E2E_ASSIST_DAILY = 3
const assistArgs = (port: number) => `--assist fake --assist-port ${String(port)} --assist-daily ${String(E2E_ASSIST_DAILY)} --assist-timeout-ms 2000`
/** 가짜 밴드 서버 (BND1 AC-BND1-80 — 읽기 간격 1초·3초, 조작 경로 /_e2e/band/*는 E2E 서버에만) */
const bandArgs = (port: number) => `--band fake --band-port ${String(port)}`
const youtubeArgs = (port: number) => `--youtube fake --youtube-port ${String(port)} --outbox-fast yes`

export const STACKS: readonly Stack[] = [
  {
    name: 'chromium',
    web: 5173 + offset,
    api: 3100 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}`,
    grepInvert: /@prod-delay|@fill|@youtube|@quota|@served|@no-test-printer|@billing|@multi|@social|@webkit|@assist/,
  },
  { name: 'chromium-prod-delay', web: 5174 + offset, api: 3101 + offset, serverArgs: `--chat-speed ${chatSpeed}`, grep: /@prod-delay/ },
  { name: 'chromium-fill', web: 5175 + offset, api: 3102 + offset, serverArgs: `--fill yes --host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}`, grep: /@fill/ },
  {
    name: 'chromium-youtube',
    web: 5176 + offset,
    api: 3103 + offset,
    youtube: 4100 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${youtubeArgs(4100 + offset)}`,
    grep: /@youtube/,
  },
  {
    name: 'chromium-quota',
    web: 5177 + offset,
    api: 3104 + offset,
    youtube: 4101 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${youtubeArgs(4101 + offset)} --youtube-quota-budget ${String(E2E_QUOTA_BUDGET)}`,
    grep: /@quota/,
  },
  { name: 'chromium-served', web: 3105 + offset, api: 3105 + offset, served: true, serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} --web-dir "${SERVED_WEB_DIR}"`, grep: /@served/ },
  { name: 'chromium-no-test-printer', web: 5178 + offset, api: 3106 + offset, serverArgs: `--test-printer no --host-delay-ms ${hostDelay}`, grep: /@no-test-printer/ },
  { name: 'chromium-billing', web: 5179 + offset, api: 3107 + offset, serverArgs: `--billing yes --host-delay-ms ${hostDelay} --chat-speed ${chatSpeed}`, grep: /@billing/ },
  {
    name: 'chromium-multi',
    web: 5180 + offset,
    api: 3108 + offset,
    youtube: 4102 + offset,
    instagram: 4103 + offset,
    band: 4107 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${youtubeArgs(4102 + offset)} --instagram yes --instagram-port ${String(4103 + offset)} --tiktok yes ${bandArgs(4107 + offset)}`,
    grep: /@multi/,
  },
  {
    name: 'chromium-social',
    web: 5181 + offset,
    api: 3109 + offset,
    social: 4104 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${socialArgs(4104 + offset)}`,
    grep: /@social(?!-one)/,
  },
  {
    name: 'chromium-social-one',
    web: 5182 + offset,
    api: 3110 + offset,
    social: 4105 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${socialArgs(4105 + offset, 'google')}`,
    grep: /@social-one/,
  },
  {
    // 아이폰 크기 WebKit (I5 D-I5-08, AC-I5-90) — WebKit이 설치되지 않았으면 실패한다
    name: 'webkit-iphone',
    web: 5183 + offset,
    api: 3111 + offset,
    band: 4108 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${bandArgs(4108 + offset)}`,
    grep: /@webkit/,
    device: 'iPhone 15',
    dropSecureCookie: true,
    blockServiceWorkers: true,
  },
  {
    name: 'chromium-assist',
    web: 5184 + offset,
    api: 3112 + offset,
    assist: 4106 + offset,
    serverArgs: `--host-delay-ms ${hostDelay} --chat-speed ${chatSpeed} ${assistArgs(4106 + offset)}`,
    grep: /@assist/,
  },
]

/** 그 프로젝트의 가짜 유튜브 주소 (가짜 유튜브 묶음이 아니면 null) — 시험이 /_fake/*를 부를 때 */
export function fakeYoutubeUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.youtube
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

/** 그 프로젝트의 가짜 메타 주소 (여러 플랫폼 묶음이 아니면 null) — 시험이 /_fake/*를 부를 때 */
export function fakeMetaUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.instagram
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

/** 그 프로젝트의 가짜 OAuth 주소 (간편 로그인 묶음이 아니면 null) — 시험이 /_fake/*를 부를 때 (L1) */
export function fakeOAuthUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.social
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

/** 그 프로젝트의 가짜 LLM 주소 (AI 제안 묶음이 아니면 null) — 시험이 /_fake/*를 부를 때 (A1) */
export function fakeLlmUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.assist
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

/** 그 프로젝트의 가짜 밴드 주소 (가짜 밴드 묶음이 아니면 null) — 조작은 e2eServerUrl의 /_e2e/band/*로 한다 (BND1) */
export function fakeBandUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.band
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

/** 그 프로젝트의 서버 주소 (시험이 /_e2e/*를 부를 때 — 틱톡 가짜 웹캐스트 조작) */
export function e2eServerUrl(project: string): string | null {
  const port = STACKS.find((stack) => stack.name === project)?.api
  return port === undefined ? null : `http://${E2E_HOST}:${String(port)}`
}

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
    use: {
      ...(stack.device === undefined ? {} : devices[stack.device]),
      baseURL: browserOrigin(stack.web),
      ...(stack.blockServiceWorkers === true ? { serviceWorkers: 'block' as const } : {}),
    },
    ...(stack.grep === undefined ? {} : { grep: stack.grep }),
    ...(stack.grepInvert === undefined ? {} : { grepInvert: stack.grepInvert }),
  })),
  webServer: STACKS.flatMap((stack) =>
    stack.served === true
      ? [
          {
            // 화면을 운영용으로 빌드한 뒤 서버가 그 폴더를 같은 출처로 낸다
            command: `node e2e/build.ts --out "${SERVED_WEB_DIR}" && pnpm --filter @livejjim/server e2e --port ${String(stack.api)} --origin ${browserOrigin(stack.web)} ${stack.serverArgs}`,
            url: `${listen(stack.api)}/api/health`,
            reuseExistingServer: reuse,
            timeout: 180_000,
            stdout: 'pipe' as const,
          },
        ]
      : [
          {
            command: `pnpm --filter @livejjim/server e2e --port ${String(stack.api)} --origin ${browserOrigin(stack.web)} ${stack.serverArgs}`,
            url: `${listen(stack.api)}/api/health`,
            reuseExistingServer: reuse,
            timeout: 120_000,
            stdout: 'pipe' as const,
          },
          {
            command: `node e2e/serve.ts --port ${String(stack.web)} --api ${listen(stack.api)}${stack.dropSecureCookie === true ? ' --drop-secure-cookie yes' : ''}`,
            url: listen(stack.web),
            reuseExistingServer: reuse,
            timeout: 120_000,
            stdout: 'pipe' as const,
          },
        ],
  ),
})
