#!/usr/bin/env node
// 연습 모드로 라이브찜 켜기: pnpm try [--port 7700]
// 판매자가 자기 컴퓨터에서 처음부터 끝까지 따라 해 보는 용도다(docs/TRY-IT.md). 운영 기동(apps/server main.ts)이 아니다.
// - 화면을 운영용으로 빌드해(node_modules/.cache/livejjim-try/web-<포트>) 서버가 같은 출처로 함께 낸다.
// - 메모리 DB(끄면 연습 기록은 사라진다)·그 자리에서 만든 마스터 키·연습용 판매자 계정 하나(비밀번호는 실행마다 무작위, 터미널에만 보인다).
// - 시험용 프린터(실제로 출력하지 않음)·시험용 입금 넣기·가짜 유튜브(연습 채널과 진행 중인 "연습 라이브" 하나)를 켠다.
// - 연습용 시청자 채팅 화면 /_try/chat: 가짜 유튜브 라이브에 시청자 채팅을 넣는다(이 스크립트만 가진 화면).
// - 간편 로그인(L1, AC-L1-24): 가짜 구글·카카오·네이버를 연습 전용 경로 /_try/oauth/<공급자>/…에 붙여 켠다(운영 기동에는 이 경로가 없다).
//   승인 화면 위에 "연습용 가짜 화면이에요."가 보이고 연습 계정 둘(이메일 있음·없음)을 고른다. 돌아오는 주소는 http://localhost:<포트>/api/auth/<공급자>/callback.
// - 실제 간편 로그인(RL1, pnpm try --real-login): 저장소 맨 위 .env.login.local(깃에 올리지 않음)에서 운영과 같은 이름
//   (LIVEJJIM_LOGIN_GOOGLE_*·LIVEJJIM_LOGIN_KAKAO_*·LIVEJJIM_LOGIN_NAVER_*)을 읽어 값이 있는 공급자만 실제 카카오·네이버·구글로 켜고,
//   없는 공급자는 끈다(가짜를 섞지 않는다). 값은 화면·로그에 내지 않는다. 각 회사에 등록한 돌아오는 주소가 localhost라 휴대폰 https 주소로는 간편 로그인이 안 된다.
// - AI 확인 필요 제안(A1, AC-A1-12): 가짜 LLM 서버를 연습 전용 경로 /_try/llm 밑에 붙이고 가짜 키로 켠다(실제 AI 회사로 나가는 요청은 없다).
//   설정 → "AI 제안"에서 동의하고 켜면, 옵션 리허설의 확인 필요 화면을 열 때 가짜 AI가 글에 든 선택지 이름으로 제안한다.
// - 이 컴퓨터: http://localhost:<포트> (127.0.0.1에서만 연다).
// - 같은 와이파이의 휴대폰: https://<이 컴퓨터 주소>:<포트+1>. 로그인 쿠키가 Secure라 휴대폰은 https로만 로그인된다.
//   그래서 자체 서명 인증서(실행마다 새로)로 https를 열고 안쪽 서버로 넘긴다. 휴대폰에 "안전하지 않음" 경고가 한 번 뜬다.
//   인증서는 openssl이 있으면 openssl로, 없거나 실패하면(윈도우 기본) Node만으로 만든다(apps/server/src/try/self-signed-cert.ts).
//   넘길 때 Origin 머리글을 화면 주소로 바꾼다(서버는 화면 주소 하나만 받는다) — 그 https 주소(와 https://localhost:<포트+1>)에서 온 요청만.
//   E2E 서버와 달리 같은 와이파이에 열린다(휴대폰 때문). 연습 데이터뿐이고 비밀번호는 실행마다 무작위다.
// - 기본 포트를 다른 프로그램이 쓰고 있으면 다음 빈 포트로 옮긴다.
// 비밀번호·마스터 키는 파일과 로그에 남기지 않는다.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CACHE = join(ROOT, 'node_modules', '.cache', 'livejjim-try')
const DEFAULT_PORT = 7700
const LOGIN_ID = 'practice'
const SHOP_NAME = '연습 가게'

const say = (line = '') => process.stdout.write(`${line}\n`)
const fail = (line) => {
  process.stderr.write(`\n[연습 모드] ${line}\n`)
  process.exit(1)
}

// ── 준비 확인 ──────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0])
if (major < 24) fail(`Node 24 이상이 필요해요. 지금은 ${process.versions.node}이에요. docs/TRY-IT.md "준비물"을 보세요.`)
if (!existsSync(join(ROOT, 'node_modules', '.pnpm'))) fail('먼저 설치가 필요해요. 이 폴더에서 pnpm install 을 한 번 입력해 주세요.')

const args = process.argv.slice(2)
let wanted = DEFAULT_PORT
let realYoutube = false
let realLoginWanted = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && /^\d{2,5}$/.test(args[i + 1] ?? '')) {
    wanted = Number(args[i + 1])
    i++
  } else if (args[i] === '--real-youtube') realYoutube = true
  else if (args[i] === '--real-login') realLoginWanted = true
  else if (args[i] === '--') continue
  else fail('쓰는 법: pnpm try 또는 pnpm try --port 7800 또는 pnpm try --real-youtube 또는 pnpm try --real-login (함께 써도 돼요)')
}
// 실제 유튜브 시험: 운영자가 만든 구글 OAuth 클라이언트 값을 저장소 밖에 커밋되지 않는 .env.youtube.local에서 읽는다(대화·로그에 남기지 않음)
let realGoogle = null
if (realYoutube) {
  const file = join(ROOT, '.env.youtube.local')
  if (!existsSync(file)) fail('.env.youtube.local 파일이 없어요. docs/TRY-IT.md "실제 유튜브로 시험하기"를 보세요.')
  const values = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  )
  const clientId = values.LIVEJJIM_GOOGLE_CLIENT_ID ?? ''
  const clientSecret = values.LIVEJJIM_GOOGLE_CLIENT_SECRET ?? ''
  if (clientId === '' || clientSecret === '') fail('.env.youtube.local에 LIVEJJIM_GOOGLE_CLIENT_ID와 LIVEJJIM_GOOGLE_CLIENT_SECRET을 적어 주세요.')
  realGoogle = { clientId, clientSecret }
}
// 실제 간편 로그인 시험: .env.login.local을 운영과 같은 이름·규칙으로 읽는다. 파일이 없으면 셋 다 끈 채로 켠다(가짜를 섞지 않는다). 값은 어디에도 출력하지 않는다
const LOGIN_FILE = '.env.login.local'
let realLogin = null
let realLoginFileMissing = false
if (realLoginWanted) {
  const { parseLoginEnvFile } = await import(new URL('../../apps/server/src/social/login-env-file.ts', import.meta.url).href)
  const file = join(ROOT, LOGIN_FILE)
  if (existsSync(file)) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      fail(`${LOGIN_FILE} 파일을 읽지 못했어요. 파일 권한을 확인해 주세요.`)
    }
    const parsed = parseLoginEnvFile(text)
    if (!parsed.ok) fail(`${parsed.message}\n            (docs/TRY-IT.md "실제 간편 로그인으로 시험하기"를 보세요.)`)
    realLogin = parsed.providers
  } else {
    realLoginFileMissing = true
    realLogin = {}
  }
}
if (wanted < 1024 || wanted > 65_000) fail('--port는 1024~65000 사이로 적어 주세요.')

/** 그 포트를 지금 열 수 있나 (127.0.0.1과 모든 주소 둘 다) */
const free = (port, host) =>
  new Promise((resolve) => {
    const probe = createNetServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
async function findPorts(start) {
  for (let port = start; port < start + 40; port += 2) {
    if ((await free(port, '127.0.0.1')) && (await free(port, '0.0.0.0')) && (await free(port + 1, '0.0.0.0'))) return port
  }
  return null
}
const port = await findPorts(wanted)
if (port === null) fail(`${String(wanted)}번부터 빈 포트를 찾지 못했어요. pnpm try --port 8800 처럼 다른 번호로 해 보세요.`)
const phonePort = port + 1
const appOrigin = `http://localhost:${String(port)}`
/** 화면 빌드 폴더 — 포트마다 따로(연습 모드를 둘 켜도 서로의 화면 파일을 지우지 않게) */
const WEB_DIR = join(CACHE, `web-${String(port)}`)

// ── 화면 빌드 ──────────────────────────────────────────────
say('')
say('라이브지니 연습 모드를 준비하고 있어요. 처음에는 1~2분 걸려요...')
mkdirSync(CACHE, { recursive: true })
const built = spawnSync(process.execPath, [join(ROOT, 'apps', 'web', 'e2e', 'build.ts'), '--out', WEB_DIR], { cwd: join(ROOT, 'apps', 'web'), encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
if (built.status !== 0 || !existsSync(join(WEB_DIR, 'index.html'))) {
  process.stderr.write(built.stderr ?? '')
  fail('화면을 만들지 못했어요. 위에 나온 문장을 개발 쪽에 보여 주세요.')
}

// ── 서버 ──────────────────────────────────────────────────
const server = (path) => import(new URL(`../../apps/server/src/${path}`, import.meta.url).href)
const [{ openPglite }, { generateMasterKey }, { createServer }, { createNodeServer }, { createSellerAccount }, { FolderBackupStorage }, { FakeGoogle }] = await Promise.all([
  server('db/database.ts'),
  server('secrets.ts'),
  server('server.ts'),
  server('node-server.ts'),
  server('accounts.ts'),
  server('backup.ts'),
  server('youtube/fake-google.ts'),
])
const { FakeOAuth } = await server('social/fake-oauth.ts')
const { FakeLlm } = await server('assist/fake-llm.ts')
const { createSelfSignedCertificate, lanAddresses } = await server('try/self-signed-cert.ts')
const { createSmsTestBox, makeSmsTestToken, SMS_TEST_PATH } = await server('try/sms-test.ts')

/** 같은 와이파이에서 이 컴퓨터를 찾는 주소들 (와이파이 먼저, 윈도우의 가상·VPN 연결은 뒤로). 첫 주소를 휴대폰 주소로 알린다 */
const lans = lanAddresses(networkInterfaces())
const lan = lans[0] ?? null

const database = await openPglite()
const masterKey = generateMasterKey()
const backupDir = mkdtempSync(join(tmpdir(), 'livejjim-try-backup-'))
const fake = await FakeGoogle.start({ pollingIntervalMillis: 1000 })
// 연습 채널과 진행 중인 연습 라이브 (유튜브 연결을 누르면 바로 이 채널로 허락된다)
const fakeAccount = fake.addAccount()
const fakeChannel = fake.addChannel(fakeAccount, '연습 채널')
const fakeLive = fake.addBroadcast(fakeChannel.id, { title: '연습 라이브', status: 'live' })

// 가짜 간편 로그인 (연습 전용 경로 /_try/oauth — 승인 화면은 브라우저가 연습 화면과 같은 주소로 열고, 토큰·사용자 정보는 서버가 127.0.0.1로 부른다)
const SOCIAL = ['google', 'kakao', 'naver']
const oauth = realLogin !== null ? null : new FakeOAuth({ practice: true, basePath: '/_try/oauth', redirectUris: Object.fromEntries(SOCIAL.map((p) => [p, `${appOrigin}/api/auth/${p}/callback`])) })
// 가짜 AI (연습 전용 경로 /_try/llm — 서버가 127.0.0.1로 부른다. 조작 경로 없음)
const llm = new FakeLlm({ practice: true, basePath: '/_try/llm' })

const livejjim = createServer({
  database,
  masterKey,
  appOrigin,
  log: () => {},
  backupStorage: new FolderBackupStorage(backupDir),
  youtube:
    realGoogle === null
      ? {
          clientId: fake.clientId,
          clientSecret: fake.clientSecret,
          redirectUri: `${appOrigin}/api/youtube/oauth/callback`,
          returnUrl: `${appOrigin}/settings/youtube`,
          endpoints: fake.endpoints(),
          allowInsecure: true,
        }
      : {
          // 실제 구글·유튜브 주소(기본값). 돌아오는 주소는 구글 콘솔에 등록한 것과 글자까지 같아야 한다
          clientId: realGoogle.clientId,
          clientSecret: realGoogle.clientSecret,
          redirectUri: `${appOrigin}/api/youtube/oauth/callback`,
          returnUrl: `${appOrigin}/settings/youtube`,
          allowInsecure: true,
        },
  collectorTiming: { scanMs: 1000 },
  outboxTiming: { liveChatLookupPage: fake.pageSize },
  webDir: WEB_DIR,
  testPrinter: true,
  deposits: { testMode: true, popbill: null, pollMs: 1000 },
  // --real-login: 실제 공급자 고정 주소(https)·값이 있는 공급자만. 돌아오는 주소는 서버가 appOrigin(http://localhost:<포트>)으로 만든다
  socialLogin: realLogin === null ? oauth.setup({ authBase: appOrigin, apiBase: `http://127.0.0.1:${String(port)}` }) : { providers: realLogin },
  assist: llm.setup({ base: `http://127.0.0.1:${String(port)}` }),
})

const PASSWORD_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789'
const password = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => PASSWORD_LETTERS[randomInt(PASSWORD_LETTERS.length)]).join('')).join('-')
const account = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: SHOP_NAME, loginId: LOGIN_ID, password })
if (!account.ok) fail(`연습 계정을 만들지 못했어요. ${account.message}`)
livejjim.start()
livejjim.backups.start()
livejjim.work.receipts.warm()

// ── 연습용 시청자 채팅 (/_try/chat) ─────────────────────────
const VIEWERS = ['초록이네', '다육사랑', '밤톨맘', '선인장할매', '꽃집언니', '물주기담당', '햇살창가', '화분부자']
const viewerIds = new Map()
const viewerId = (name) => {
  if (!viewerIds.has(name)) viewerIds.set(name, `UCtry${String(viewerIds.size).padStart(3, '0')}${'x'.repeat(14)}`.slice(0, 24))
  return viewerIds.get(name)
}
const CHAT_PAGE = readFileSync(new URL('./chat.html', import.meta.url), 'utf8').replace('"__VIEWERS__"', JSON.stringify(VIEWERS))

// ── 문자 자동 수신 시험 (/_try/sms-test, 실험 — 판정·문자찜에 잇지 않는다. 메모리에만 최근 50건, 번호는 끝 4자리만) ──
const smsTestToken = makeSmsTestToken()
const smsTest = createSmsTestBox({ token: smsTestToken })

async function tryRoute(request) {
  const url = new URL(request.url)
  if (url.pathname === SMS_TEST_PATH) return (await smsTest.handle(request)) ?? new Response('없는 주소예요.', { status: 404 })
  if (url.pathname.startsWith('/_try/oauth/') && oauth !== null) return oauth.handle(request)
  if (url.pathname.startsWith('/_try/llm/')) return llm.handle(request)
  if (request.method === 'GET' && url.pathname === '/_try/chat') {
    return new Response(CHAT_PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" },
    })
  }
  if (request.method === 'POST' && url.pathname === '/_try/chat') {
    if (request.headers.get('origin') !== appOrigin) return Response.json({ error: '이 화면에서만 보낼 수 있어요.' }, { status: 403 })
    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const messages = Array.isArray(body?.messages) ? body.messages.slice(0, 20) : []
    for (const item of messages) {
      const name = typeof item?.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, 30) : '시청자'
      const text = typeof item?.text === 'string' ? item.text.slice(0, 200) : ''
      if (text.trim() === '') continue
      fake.addMessage(fakeLive.liveChatId, { author: viewerId(name), name, text })
    }
    return Response.json({ ok: true, sent: messages.length })
  }
  return new Response('없는 주소예요.', { status: 404 })
}

const app = {
  fetch: (request, env) => (new URL(request.url).pathname.startsWith('/_try/') ? tryRoute(request) : livejjim.app.fetch(request, env)),
}
const http = createNodeServer({ app })
await new Promise((resolve, reject) => {
  http.once('error', reject)
  http.listen(port, '127.0.0.1', resolve)
}).catch(() => fail(`포트 ${String(port)}를 열지 못했어요. pnpm try --port 8800 처럼 다른 번호로 해 보세요.`))

// ── 휴대폰용 https (같은 와이파이) ──────────────────────────
/**
 * 휴대폰용 자체 서명 인증서 (2일, 주소: 같은 와이파이 주소들·localhost, 서버 인증용).
 * openssl이 있으면 지금까지처럼 openssl로(임시 폴더에 쓰고 바로 지운다), 없거나 실패하면 Node만으로 만든다 — 윈도우에는 openssl이 기본으로 없다.
 */
function phoneCertificate(ips) {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-try-cert-'))
  try {
    const keyFile = join(dir, 'key.pem')
    const certFile = join(dir, 'cert.pem')
    const configFile = join(dir, 'openssl.cnf')
    const config = `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=livejjim-try\n[ext]\nsubjectAltName=${[...ips.map((ip) => `IP:${ip}`), 'DNS:localhost'].join(',')}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`
    writeFileSync(configFile, config)
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', keyFile, '-out', certFile, '-config', configFile], { stdio: 'ignore', windowsHide: true, timeout: 20_000 })
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) }
  } catch {
    return createSelfSignedCertificate({ ips, now: new Date(), days: 2 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let phone = null
let phoneProblem = null
if (lan !== null) {
  try {
    const { key, cert } = phoneCertificate(lans)
    // 휴대폰 주소들과, 이 컴퓨터에서 https로 여는 주소(사파리에서 로그인이 안 될 때) 모두 화면 주소로 바꿔 넘긴다
    const httpsOrigins = new Set([...lans.map((ip) => `https://${ip}:${String(phonePort)}`), `https://localhost:${String(phonePort)}`])
    phone = createHttpsServer({ key, cert }, (req, res) => {
      const headers = { ...req.headers }
      if (typeof headers.origin === 'string' && httpsOrigins.has(headers.origin)) headers.origin = appOrigin
      // 간편 로그인(L1): 돌려보내는 주소(Location)·승인 주소의 앞 http://localhost:<포트>를 휴대폰이 연 https 주소로 바꾼다.
      // 돌아오는 주소 매개변수(redirect_uri)는 그대로 둔다 — 가짜 공급자에 등록한 값과 같아야 한다
      const here = `https://${String(req.headers.host ?? '')}`
      const swap = httpsOrigins.has(here) ? (text) => (text.startsWith(`${appOrigin}/`) ? `${here}${text.slice(appOrigin.length)}` : text) : (text) => text
      const upstream = httpRequest({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (answer) => {
        const out = { ...answer.headers }
        if (typeof out.location === 'string') out.location = swap(out.location)
        if (req.method === 'POST' && (req.url === '/api/auth/start' || req.url === '/api/auth/link') && httpsOrigins.has(here)) {
          const chunks = []
          answer.on('data', (chunk) => chunks.push(chunk))
          answer.on('end', () => {
            const body = Buffer.from(Buffer.concat(chunks).toString('utf8').replaceAll(`"${appOrigin}/_try/oauth/`, `"${here}/_try/oauth/`), 'utf8')
            delete out['content-length']
            res.writeHead(answer.statusCode ?? 502, { ...out, 'content-length': String(body.length) })
            res.end(body)
          })
          return
        }
        res.writeHead(answer.statusCode ?? 502, out)
        answer.pipe(res)
      })
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      req.pipe(upstream)
      res.on('close', () => upstream.destroy())
    })
    await new Promise((resolve, reject) => {
      phone.once('error', reject)
      phone.listen(phonePort, '0.0.0.0', resolve)
    })
  } catch {
    phone = null
    phoneProblem = `휴대폰용 주소(포트 ${String(phonePort)})를 열지 못했어요. 껐다가 다시 켜 보세요.`
  }
}

say('')
say('==============================================================')
say(' 라이브지니 연습 모드가 켜졌어요. (끄려면 이 창에서 Ctrl + C)')
say('==============================================================')
say('')
say(` 1) 이 컴퓨터 크롬에서 열기 : ${appOrigin}`)
say(`    아이디   : ${LOGIN_ID}`)
say(`    비밀번호 : ${password}`)
say('    (비밀번호는 켤 때마다 바뀌어요. 이 창에만 보여요.)')
say('')
say(` 2) 연습용 시청자 채팅     : ${appOrigin}/_try/chat`)
say('    (가짜 유튜브 "연습 라이브"에 시청자 채팅을 넣어요)')
say('')
if (phone !== null) {
  say(` 3) 같은 와이파이 휴대폰  : https://${lan}:${String(phonePort)}`)
  say('    ("안전하지 않음" 경고가 나오면 docs/TRY-IT.md의 휴대폰 순서대로 넘어가세요)')
  if (lans.length > 1) say(`    (안 열리면 이 주소도 해 보세요: ${lans.slice(1).map((ip) => `https://${ip}:${String(phonePort)}`).join('  ')})`)
} else {
  say(` 3) ${phoneProblem ?? '휴대폰 주소를 만들지 못했어요. 와이파이에 연결돼 있는지 확인하고 다시 켜 주세요.'}`)
}
say('')
if (phone !== null) {
  say(` 문자 자동 수신 시험 주소 : https://${lan}:${String(phonePort)}${SMS_TEST_PATH}   (보기: 같은 주소 뒤에 ?t=${smsTestToken})`)
  say(` 문자 자동 수신 시험 토큰 : ${smsTestToken}   (머리글 X-Try-Token, 켤 때마다 바뀌어요. docs/TRY-IT.md "문자 자동 수신 시험하기")`)
} else {
  say(` 문자 자동 수신 시험 주소 : ${appOrigin}${SMS_TEST_PATH}   (휴대폰 주소가 없어 이 컴퓨터에서만 돼요)`)
  say(` 문자 자동 수신 시험 토큰 : ${smsTestToken}`)
}
say('')
say(' 연습 기록은 이 창을 끄면 모두 지워져요. 실제 방송·실제 프린터·실제 돈과는 상관없어요.')
say('')
if (realLogin !== null) {
  // 값은 보이지 않는다 — 켜짐·꺼짐과 등록할 주소만
  const NAMES = { kakao: '카카오', naver: '네이버', google: '구글' }
  say('--------------------------------------------------------------')
  say(' 실제 간편 로그인 시험 (가짜 로그인 화면은 꺼져 있어요)')
  say('--------------------------------------------------------------')
  say(' 각 회사 개발자 사이트에 아래 주소를 글자 그대로 등록해요.')
  if (realLoginFileMissing) say(` ${LOGIN_FILE} 파일이 없어서 카카오·네이버·구글 로그인이 모두 꺼져 있어요.`)
  for (const provider of ['kakao', 'naver', 'google']) {
    const on = realLogin[provider] !== undefined
    say(` ${NAMES[provider]}: ${on ? `진짜 ${NAMES[provider]} 로그인이 켜져 있어요` : `꺼져 있어요 (${LOGIN_FILE}에 값이 없어요)`}`)
    say(`    돌아오는 주소(Redirect URI) : ${appOrigin}/api/auth/${provider}/callback`)
    if (provider === 'kakao') say(`    Web 플랫폼 사이트 도메인    : ${appOrigin}`)
    if (provider === 'naver') say(`    서비스 URL                  : ${appOrigin}`)
  }
  say('')
  if (port !== DEFAULT_PORT) {
    say(` 주의: 지금 포트가 ${String(DEFAULT_PORT)}이 아니라 ${String(port)}이에요. 각 회사에 http://localhost:${String(DEFAULT_PORT)}/… 로 등록했다면 주소가 달라서`)
    say(`       로그인이 안 돼요. 위 주소를 그대로 등록하거나, ${String(DEFAULT_PORT)}번을 쓰는 프로그램을 끄고 다시 켜 주세요.`)
    say('')
  }
  say(' 휴대폰(https 주소)으로는 간편 로그인이 안 돼요. 등록한 돌아오는 주소가 이 컴퓨터(localhost)라서예요.')
  say(` 간편 로그인은 이 컴퓨터 크롬의 ${appOrigin} 에서 해 보세요. 아이디·비밀번호 로그인은 휴대폰에서도 돼요.`)
  say(` 먼저 아이디로 로그인한 뒤 설정 → 로그인 방법에서 [연결하기]를 눌러야 그 계정으로 들어올 수 있어요.`)
  say('')
}

let stopping = false
async function stop() {
  if (stopping) process.exit(1)
  stopping = true
  say('\n끄는 중이에요...')
  phone?.closeAllConnections()
  phone?.close()
  http.closeAllConnections()
  http.close()
  livejjim.close()
  await livejjim.stop().catch(() => {})
  await fake.close().catch(() => {})
  await database.close().catch(() => {})
  rmSync(backupDir, { recursive: true, force: true })
  say('껐어요. 다시 켜려면 pnpm try')
  process.exit(0)
}
// 끄기: Control(Ctrl) + C(SIGINT — 윈도우 명령 프롬프트에서도 Node가 이 이름으로 받는다), 창 닫기(SIGHUP — 맥·윈도우 둘 다),
// Ctrl + Break(SIGBREAK — 윈도우만), 그 밖의 끄기 요청(SIGTERM — 윈도우에는 없다). 창이 닫힌 뒤 글을 쓰다 나는 오류는 무시한다
process.stdout.on('error', () => {})
for (const signal of process.platform === 'win32' ? ['SIGINT', 'SIGHUP', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop())
