// 감사 채팅 다른 길 실물 시험 명령 (D-YT-SEND-09). 운영자가 자기 방송에서 손으로만 쓴다 — 자동 시험·CI는 부르지 않는다(절대 규칙 7).
//   status --video <ID>                                   방송 상태·방송 채널 (읽기만, 로그인 없음)
//   login  --state <파일> [--chrome 1]                     창을 띄워 사람이 로그인 → 유튜브 쿠키가 생기면 Playwright 로그인 상태를 파일에 저장(권한 0600)
//   profile --profile <폴더> --state <파일>                  구글이 자동 제어 창의 로그인을 막을 때(실물 2026-11-08): 자동화 없는 평범한 크롬을 시험용 별도 프로필로 열고,
//          사람이 로그인한 뒤 크롬을 끝내면 그 프로필의 유튜브 쿠키를 같은 로그인 상태 파일로 저장한다. 차단을 속이지 않는다 — 로그인은 사람이 평범한 크롬에서 한다
//   send   --route innertube|browser|nightbot --video <ID> --channel <작성자 UC…> (--state <파일> | --token-file <파일>) [--chat-id <공식 채팅 ID>] [--text <글>]
//          [--all-chats 1] (nightbot만: 채팅 ID 없이 — 그 채널의 모든 채팅방. 방송이 하나뿐일 때만)
//   nightbot-login --token-file <파일>                    운영자가 자기 터미널에서: Nightbot 앱 클라이언트 ID·비밀을 묻고(비밀은 화면에 안 보임) 브라우저로 승인 →
//          http://localhost:8765/nightbot/callback 으로 받은 코드를 토큰으로 바꿔 파일에 저장(0600). 앱 리디렉션 주소를 이 주소로 적어 둔다
//          → 한 번 올리고, 로그인 없이 그 방송 채팅을 30초 동안 읽어 같은 글이 떴는지·작성자가 누구인지 확인한다
// 쿠키·토큰 값은 출력하지 않는다(이름·개수만).
import { spawn } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { BrowserChatSender } from '../youtube/chat-send/browser-sender.ts'
import { InnertubeChatSender, cookieHeaderFromState } from '../youtube/chat-send/innertube-sender.ts'
import { NightbotChatSender, nightbotTokenFromFile } from '../youtube/chat-send/nightbot-sender.ts'
import { ChatSendError, type ChatSender } from '../youtube/chat-send/sender.ts'
import { realTimer } from '../youtube/timer.ts'
import { HttpWebTransport, WebChatSource } from '../youtube/web-chat-source.ts'
import { complain, parseArgs, say } from './shared.ts'
import { SERVICE_NAME } from '../brand.ts'

const timer = realTimer()
const web = new WebChatSource({ timer, transport: new HttpWebTransport({ timer }) })
const [command, ...rest] = process.argv.slice(2)

async function status(videoId: string) {
  const page = await web.pageOrNext(videoId)
  say(`방송 상태 ${page.state} · 방송 채널 ${page.channelId ?? '모름'} · 제목 ${page.title ?? '모름'}`)
  const chat = await web.chatPage(videoId)
  say(`채팅 페이지 ${chat.state}`)
  return page
}

async function login(statePath: string, realChrome: boolean) {
  const browser = await chromium.launch({ headless: false, ...(realChrome ? { channel: 'chrome' } : {}) })
  const context = await browser.newContext({ locale: 'ko-KR' })
  const page = await context.newPage()
  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F')
  say('열린 창에서 감사 채팅을 올릴 계정으로 로그인해 주세요. 유튜브 첫 화면이 뜨면 저절로 저장하고 닫아요(15분까지 기다려요).')
  const until = Date.now() + 15 * 60 * 1000
  while (Date.now() < until) {
    const cookies = await context.cookies('https://www.youtube.com').catch(() => [])
    if (cookies.some((cookie) => cookie.name === 'SAPISID' || cookie.name === '__Secure-3PAPISID') && page.url().startsWith('https://www.youtube.com')) {
      await context.storageState({ path: statePath })
      await chmod(statePath, 0o600)
      say(`저장했어요: 유튜브 쿠키 ${String(cookies.length)}개 (값은 출력하지 않아요)`)
      await browser.close()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  await browser.close()
  throw new Error('login timeout')
}

/** 크롬이 이 프로필을 쓰는 중인가 — SingletonLock은 없는 대상을 가리키는 심볼릭 링크라 existsSync로는 늘 없다 */
function profileLocked(lock: string): boolean {
  try {
    lstatSync(lock)
    return true
  } catch {
    return false
  }
}

async function profile(profileDir: string, statePath: string) {
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const lock = join(profileDir, 'SingletonLock')
  // 평범한 크롬 (자동화 인자 없음) — 이 프로필 폴더만 쓴다
  spawn('open', ['-na', 'Google Chrome', '--args', `--user-data-dir=${profileDir}`, '--no-first-run', 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'], { stdio: 'ignore' })
  say('열린 크롬 창에서 감사 채팅을 올릴 계정으로 로그인하고, 유튜브 첫 화면이 뜨면 그 크롬을 끝내 주세요(⌘Q). 30분까지 기다려요.')
  const until = Date.now() + 30 * 60 * 1000
  let opened = false
  while (Date.now() < until) {
    const locked = profileLocked(lock)
    if (locked) opened = true
    if (opened && !locked) break
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  if (!opened || profileLocked(lock)) throw new Error('profile timeout')
  await saveProfile(profileDir, statePath)
}

/** 끝낸 크롬 프로필의 유튜브 로그인 → 로그인 상태 파일 */
async function saveProfile(profileDir: string, statePath: string) {
  if (profileLocked(join(profileDir, 'SingletonLock'))) throw new Error('chrome still running on profile')
  // 크롬이 쿠키를 맥 키체인으로 암호화한다 — 같은 크롬·키체인으로 열어야 읽힌다(Playwright 기본 가짜 키체인을 쓰지 않음)
  const context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: true, ignoreDefaultArgs: ['--use-mock-keychain'] })
  try {
    const cookies = await context.cookies('https://www.youtube.com')
    if (!cookies.some((cookie) => cookie.name === 'SAPISID' || cookie.name === '__Secure-3PAPISID')) throw new Error('no youtube login in profile')
    await context.storageState({ path: statePath })
    await chmod(statePath, 0o600)
    say(`저장했어요: 유튜브 쿠키 ${String(cookies.length)}개 (값은 출력하지 않아요)`)
  } finally {
    await context.close()
  }
}

const NIGHTBOT_REDIRECT = 'http://localhost:8765/nightbot/callback'

/** 터미널에서 묻기 (hidden이면 친 글자를 보이지 않는다) */
async function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) process.stdout.write(chunk)
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  const answer = new Promise<string>((resolve) => rl.question(question, resolve))
  muted = hidden
  const value = await answer
  rl.close()
  if (hidden) process.stdout.write('\n')
  return value.trim()
}

async function nightbotLogin(tokenFile: string) {
  const clientId = await ask('Nightbot 앱 Client ID: ', false)
  const clientSecret = await ask('Nightbot 앱 Client Secret (화면에 안 보여요): ', true)
  if (clientId === '' || clientSecret === '') throw new Error('client id/secret')
  const state = randomBytes(16).toString('hex')
  // 1. 승인 코드 받기 (이 기계 127.0.0.1:8765에서만 듣는다)
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost:8765')
      if (url.pathname !== '/nightbot/callback') {
        res.writeHead(404).end()
        return
      }
      const got = url.searchParams.get('code')
      const ok = got !== null && url.searchParams.get('state') === state
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' }).end(ok ? '승인을 받았어요. 이 창은 닫아도 돼요.' : '승인을 받지 못했어요.')
      server.close()
      if (ok) resolve(got)
      else reject(new Error('nightbot authorize'))
    })
    server.on('error', reject)
    server.listen(8765, '127.0.0.1', () => {
      const authorize = new URL('https://api.nightbot.tv/oauth2/authorize')
      authorize.searchParams.set('client_id', clientId)
      authorize.searchParams.set('redirect_uri', NIGHTBOT_REDIRECT)
      authorize.searchParams.set('response_type', 'code')
      authorize.searchParams.set('scope', 'channel_send')
      authorize.searchParams.set('state', state)
      spawn('open', [authorize.toString()], { stdio: 'ignore' })
      say('브라우저에서 Nightbot 승인을 눌러 주세요 (10분까지 기다려요).')
    })
    setTimeout(() => {
      server.close()
      reject(new Error('nightbot login timeout'))
    }, 10 * 60 * 1000).unref()
  })
  // 2. 코드 → 토큰
  const response = await fetch('https://api.nightbot.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: NIGHTBOT_REDIRECT, code }).toString(),
  })
  if (!response.ok) throw new Error(`nightbot token ${String(response.status)}`)
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }
  if (typeof body.access_token !== 'string') throw new Error('nightbot token shape')
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 0
  await writeFile(tokenFile, JSON.stringify({ accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scope: body.scope ?? null }), { mode: 0o600 })
  await chmod(tokenFile, 0o600)
  say(`저장했어요: ${tokenFile} (토큰 값은 출력하지 않아요, 권한 ${String(body.scope ?? '')})`)
}

async function send(values: Map<string, string>) {
  const route = values.get('route')
  const videoId = values.get('video') ?? ''
  const author = values.get('channel') ?? ''
  const page = await status(videoId)
  if (page.state !== 'LIVE' || page.channelId === null) throw new Error('not live')
  const stamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })
  const text = values.get('text') ?? `[${SERVICE_NAME} 시험 ${route ?? ''} ${stamp}] 15번 핑크프릴 10,000원 테스트님 구매 감사합니다`
  let sender: ChatSender
  if (route === 'innertube') {
    const cookie = cookieHeaderFromState(await readFile(values.get('state') ?? '', 'utf8'), Math.floor(Date.now() / 1000))
    sender = new InnertubeChatSender({ cookie, authorChannelId: author, timer })
  } else if (route === 'browser') {
    sender = new BrowserChatSender({ storageStatePath: values.get('state') ?? '', authorChannelId: author, timer, headless: values.get('headless') === '1' })
  } else if (route === 'nightbot') {
    sender = new NightbotChatSender({ token: nightbotTokenFromFile(await readFile(values.get('token-file') ?? '', 'utf8')), authorChannelId: author, timer, allowAllChats: values.get('all-chats') === '1' })
  } else throw new Error('route')
  // 보내기 전 채팅 지점을 잡아 둔다 (보낸 뒤 새로 뜬 글만 본다)
  const chat = await web.chatPage(videoId)
  if (chat.state !== 'OK' || chat.session === null || chat.continuation === null) throw new Error('no chat')
  let continuation = chat.continuation
  const first = await web.poll(chat.session, continuation)
  if (first.kind === 'ok' && first.next !== null) continuation = first.next
  const started = Date.now()
  say(`보내요: ${route} · ${text}`)
  try {
    const result = await sender.send({ videoId, channelId: page.channelId, liveChatId: values.get('chat-id') ?? '' }, text)
    say(`보내기 결과: 게시됨 · 메시지 ID ${result.messageId ?? '(모름)'} · ${String(Date.now() - started)}ms`)
  } catch (error) {
    say(`보내기 결과: 실패 ${error instanceof ChatSendError ? `${error.kind}${error.status === null ? '' : ` ${String(error.status)}`}` : error instanceof Error ? error.name : 'unknown'}`)
  } finally {
    await sender.close()
  }
  // 로그인 없이 채팅을 읽어 확인
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    const polled = await web.poll(chat.session, continuation)
    if (polled.kind === 'ok') {
      const mine = polled.chats.find((item) => item.text.trim() === text.trim())
      if (mine !== undefined) {
        say(`채팅에 떴어요: ID ${mine.id} · 작성자 ${mine.ch}${mine.ch === author ? ' (설정한 작성자와 같음)' : ' (설정한 작성자와 다름!)'} · 주인 배지 ${mine.owner ? '있음' : '없음'}`)
        return
      }
      if (polled.next !== null) continuation = polled.next
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(polled.timeoutMs ?? 2000, 1000), 5000)))
    } else await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  say('30초 동안 채팅에서 같은 글을 보지 못했어요.')
}

try {
  if (command === 'status') {
    const args = parseArgs(rest, ['video'])
    if (!args.ok) throw new Error(args.message)
    await status(args.values.get('video') ?? '')
  } else if (command === 'login') {
    const args = parseArgs(rest, ['state', 'chrome'])
    if (!args.ok) throw new Error(args.message)
    await login(args.values.get('state') ?? '', args.values.get('chrome') === '1')
  } else if (command === 'profile') {
    const args = parseArgs(rest, ['profile', 'state'])
    if (!args.ok) throw new Error(args.message)
    await profile(args.values.get('profile') ?? '', args.values.get('state') ?? '')
  } else if (command === 'profile-save') {
    const args = parseArgs(rest, ['profile', 'state'])
    if (!args.ok) throw new Error(args.message)
    await saveProfile(args.values.get('profile') ?? '', args.values.get('state') ?? '')
  } else if (command === 'nightbot-login') {
    const args = parseArgs(rest, ['token-file'])
    if (!args.ok) throw new Error(args.message)
    await nightbotLogin(args.values.get('token-file') ?? '')
  } else if (command === 'send') {
    const args = parseArgs(rest, ['route', 'video', 'channel', 'state', 'token-file', 'chat-id', 'text', 'headless', 'all-chats'])
    if (!args.ok) throw new Error(args.message)
    await send(args.values)
  } else {
    complain('명령: status · login · profile · profile-save · nightbot-login · send')
    process.exitCode = 2
  }
} catch (error) {
  complain(`멈췄어요: ${error instanceof Error ? error.message : 'unknown'}`)
  process.exitCode = 1
}
