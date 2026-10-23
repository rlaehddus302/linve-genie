#!/usr/bin/env node
// 연습 모드로 라이브찜 켜기: pnpm try [--port 7700]
// 판매자가 자기 컴퓨터에서 처음부터 끝까지 따라 해 보는 용도다(docs/TRY-IT.md). 운영 기동(apps/server main.ts)이 아니다.
// - 화면을 운영용으로 빌드해(node_modules/.cache/livejjim-try/web-<포트>) 서버가 같은 출처로 함께 낸다.
// - 메모리 DB(끄면 연습 기록은 사라진다)·그 자리에서 만든 마스터 키·연습용 판매자 계정 하나(비밀번호는 실행마다 무작위, 터미널에만 보인다).
// - 시험용 프린터(실제로 출력하지 않음)·시험용 입금 넣기·가짜 유튜브(연습 채널과 진행 중인 "연습 라이브" 하나)를 켠다.
// - 연습용 시청자 채팅 화면 /_try/chat: 가짜 유튜브 라이브에 시청자 채팅을 넣는다(이 스크립트만 가진 화면).
// - 간편 로그인(L1, AC-L1-24): 가짜 구글·카카오·네이버를 연습 전용 경로 /_try/oauth/<공급자>/…에 붙여 켠다(운영 기동에는 이 경로가 없다).
//   승인 화면 위에 "연습용 가짜 화면이에요."가 보이고 연습 계정 둘(이메일 있음·없음)을 고른다. 돌아오는 주소는 http://localhost:<포트>/api/auth/<공급자>/callback.
// - AI 확인 필요 제안(A1, AC-A1-12): 가짜 LLM 서버를 연습 전용 경로 /_try/llm 밑에 붙이고 가짜 키로 켠다(실제 AI 회사로 나가는 요청은 없다).
//   설정 → "AI 제안"에서 동의하고 켜면, 옵션 리허설의 확인 필요 화면을 열 때 가짜 AI가 글에 든 선택지 이름으로 제안한다.
// - 이 컴퓨터: http://localhost:<포트> (127.0.0.1에서만 연다).
// - 같은 와이파이의 휴대폰: https://<이 컴퓨터 주소>:<포트+1>. 로그인 쿠키가 Secure라 휴대폰은 https로만 로그인된다.
//   그래서 자체 서명 인증서(openssl, 실행마다 새로)로 https를 열고 안쪽 서버로 넘긴다. 휴대폰에 "안전하지 않음" 경고가 한 번 뜬다.
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
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && /^\d{2,5}$/.test(args[i + 1] ?? '')) {
    wanted = Number(args[i + 1])
    i++
  } else if (args[i] === '--real-youtube') realYoutube = true
  else if (args[i] === '--') continue
  else fail('쓰는 법: pnpm try 또는 pnpm try --port 7800 또는 pnpm try --real-youtube')
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

/** 같은 와이파이에서 이 컴퓨터를 찾는 주소 (en0 = 맥의 와이파이 먼저) */
function lanAddress() {
  const all = networkInterfaces()
  const names = Object.keys(all).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : a < b ? -1 : 1))
  for (const name of names) {
    for (const entry of all[name] ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) return entry.address
    }
  }
  return null
}
const lan = lanAddress()

// ── 화면 빌드 ──────────────────────────────────────────────
say('')
say('라이브찜 연습 모드를 준비하고 있어요. 처음에는 1~2분 걸려요...')
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
const oauth = new FakeOAuth({ practice: true, basePath: '/_try/oauth', redirectUris: Object.fromEntries(SOCIAL.map((p) => [p, `${appOrigin}/api/auth/${p}/callback`])) })
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
  socialLogin: oauth.setup({ authBase: appOrigin, apiBase: `http://127.0.0.1:${String(port)}` }),
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

async function tryRoute(request) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/_try/oauth/')) return oauth.handle(request)
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
let phone = null
let certDir = null
if (lan !== null) {
  try {
    certDir = mkdtempSync(join(tmpdir(), 'livejjim-try-cert-'))
    const keyFile = join(certDir, 'key.pem')
    const certFile = join(certDir, 'cert.pem')
    const configFile = join(certDir, 'openssl.cnf')
    const config = `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=livejjim-try\n[ext]\nsubjectAltName=IP:${lan},DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`
    writeFileSync(configFile, config)
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', keyFile, '-out', certFile, '-config', configFile], { stdio: 'ignore' })
    // 휴대폰 주소와, 이 컴퓨터에서 https로 여는 주소(사파리에서 로그인이 안 될 때) 둘 다 화면 주소로 바꿔 넘긴다
    const httpsOrigins = new Set([`https://${lan}:${String(phonePort)}`, `https://localhost:${String(phonePort)}`])
    phone = createHttpsServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
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
  }
}

say('')
say('==============================================================')
say(' 라이브찜 연습 모드가 켜졌어요. (끄려면 이 창에서 Control + C)')
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
} else {
  say(' 3) 휴대폰 주소를 만들지 못했어요. 와이파이에 연결돼 있는지 확인하고 다시 켜 주세요.')
}
say('')
say(' 연습 기록은 이 창을 끄면 모두 지워져요. 실제 방송·실제 프린터·실제 돈과는 상관없어요.')
say('')

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
  if (certDir !== null) rmSync(certDir, { recursive: true, force: true })
  say('껐어요. 다시 켜려면 pnpm try')
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
