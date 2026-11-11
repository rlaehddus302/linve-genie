// 틱톡 감사 채팅 봇 계정 명령 (D-TT-SEND-04·08). 운영자만 쓴다. 비밀번호·쿠키 값은 출력하지 않는다.
//   pnpm --filter @livejjim/server tiktok-bot login --out <로그인 파일>
//       창 있는 Chromium으로 틱톡 로그인 화면을 연다. 사람이 봇 계정으로 직접 로그인하면(로그인 쿠키가 생기면) Playwright 로그인 상태를 파일에 적는다(600).
//       서버는 비밀번호를 다루지 않는다 — 틱톡은 자동 로그인을 막을 수 있다. 파일을 서버의 LIVEJJIM_TT_SEND_STATE_FILE 자리에 둔다.
//   pnpm --filter @livejjim/server tiktok-bot check --state <로그인 파일>
//       파일에 살아 있는 로그인 쿠키가 있는지만 본다(틱톡에 나가지 않는다).
//   pnpm --filter @livejjim/server tiktok-bot try --state <로그인 파일> --live <틱톡 아이디> --text <글>
//       실물 시험: 그 라이브 채팅에 글 하나를 올리고 화면에서 확인한다 — 실제 틱톡에 글이 올라간다. 사람이 직접 칠 때만 쓴다(시험·서버는 부르지 않는다).
import { chmod } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { BrowserTikTokSender, TT_SEND_BASE_URL, TT_SESSION_COOKIE } from '../tiktok-live/thanks/browser-sender.ts'
import { ChatSendError } from '../youtube/chat-send/sender.ts'
import { realTimer } from '../youtube/timer.ts'
import { complain, parseArgs, say } from './shared.ts'

const USAGE = '사용법: tiktok-bot login --out <파일> | check --state <파일> | try --state <파일> --live <틱톡 아이디> --text <글>'
/** 사람이 로그인하기를 기다리는 시간 */
const LOGIN_WAIT_MS = 10 * 60_000

const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest, command === 'login' ? ['out', 'chromium'] : command === 'check' ? ['state'] : command === 'try' ? ['state', 'live', 'text', 'chromium'] : [])
const chromiumPath = args.ok ? args.values.get('chromium') : undefined

async function login(out: string): Promise<number> {
  const browser = await chromium.launch({
    headless: false,
    ...(chromiumPath === undefined ? {} : { executablePath: chromiumPath }),
  })
  try {
    const context = await browser.newContext({ locale: 'ko-KR' })
    const page = await context.newPage()
    await page.goto(`${TT_SEND_BASE_URL}/login`)
    say('열린 창에서 라이브지니 틱톡 봇 계정으로 로그인해 주세요. 로그인되면 저절로 저장하고 닫아요(10분 기다림).')
    const until = Date.now() + LOGIN_WAIT_MS
    while (Date.now() < until) {
      const cookies = await context.cookies(TT_SEND_BASE_URL)
      if (cookies.some((cookie) => cookie.name === TT_SESSION_COOKIE && cookie.value !== '')) {
        // 쿠키가 다 붙을 때까지 잠깐
        await page.waitForTimeout(3000)
        await context.storageState({ path: out })
        await chmod(out, 0o600)
        say(`로그인 상태를 저장했어요: ${out}`)
        return 0
      }
      await page.waitForTimeout(1000)
    }
    complain('10분 안에 로그인하지 않아 저장하지 않았어요.')
    return 1
  } finally {
    await browser.close()
  }
}

async function check(state: string): Promise<number> {
  const sender = new BrowserTikTokSender({
    storageStatePath: state,
    timer: realTimer(),
    headless: true,
  })
  try {
    const ok = await sender.loggedIn()
    say(ok ? '로그인돼 있어요.' : '로그인이 풀렸어요. tiktok-bot login으로 다시 만들어 주세요.')
    return ok ? 0 : 1
  } finally {
    await sender.close()
  }
}

async function tryOnce(state: string, live: string, text: string): Promise<number> {
  const sender = new BrowserTikTokSender({
    storageStatePath: state,
    timer: realTimer(),
    headless: false,
    gapMs: 0,
    ...(chromiumPath === undefined ? {} : { executablePath: chromiumPath }),
  })
  try {
    await sender.send(live.replace(/^@/, ''), text)
    say('올렸고 채팅에서 확인했어요.')
    return 0
  } catch (error) {
    const kind = error instanceof ChatSendError ? error.kind : 'unknown'
    complain(
      kind === 'auth'
        ? '로그인이 풀렸어요(올리지 않음).'
        : kind === 'unverified'
          ? '보냈지만 채팅에서 확인하지 못했어요(올라갔을 수 있어요 — 틱톡에서 보세요).'
          : kind === 'rejected'
            ? '채팅 칸을 찾지 못했어요(방송 중이 아니거나 화면이 바뀜 — 올리지 않음).'
            : `올리지 못했어요(${kind}).`,
    )
    return 1
  } finally {
    await sender.close()
  }
}

let code = 2
if (!args.ok) complain(args.message)
else if (command === 'login' && args.values.get('out') !== undefined) code = await login(args.values.get('out') as string)
else if (command === 'check' && args.values.get('state') !== undefined) code = await check(args.values.get('state') as string)
else if (command === 'try' && args.values.get('state') !== undefined && args.values.get('live') !== undefined && args.values.get('text') !== undefined)
  code = await tryOnce(args.values.get('state') as string, args.values.get('live') as string, args.values.get('text') as string)
else complain(USAGE)
process.exitCode = code
