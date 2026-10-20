// AC-I3-70·71·72·80·81·82 배포·운영 (SYS-05, NFR-06, D-I3-13·16): 서버가 화면을 같은 출처로 함께 낸다, 보안 머리글·CSP, 운영 시작 검사,
// 준비 확인(/health/ready), 운영 상태(/ops/status), 경보 기록.
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { applyEvent as applyReal } from '@livejjim/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HTTPS_ORIGIN_MESSAGE, OPS_TOKEN_MESSAGE, TRUSTED_PROXIES_MESSAGE, WEB_DIR_MESSAGE, isProductionOrigin, readDeploySetting } from '../src/config.ts'
import { formatAlert, stderrLog, type LogRecord } from '../src/log.ts'
import { createNodeServer } from '../src/node-server.ts'
import { ALERT_CODES, ALERT_THROTTLE_MS } from '../src/ops.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { createServer, type ServerOptions } from '../src/server.ts'
import { CONTENT_SECURITY_POLICY, webDirProblem } from '../src/web.ts'
import { rawRequest } from './helpers.ts'
import { ORIGIN, addSeller, client, createBroadcast, expectOk, fakeClock, newWorld, openTestDb, startServer, writeEvent, type FakeClock, type TestServer } from './support.ts'

const worlds: TestServer[] = []
async function world(overrides: Partial<ServerOptions> & { clock?: FakeClock } = {}): Promise<TestServer> {
  const created = await newWorld(overrides)
  worlds.push(created)
  return created
}
afterEach(() => {
  for (const item of worlds.splice(0)) item.server.close()
})

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
const INDEX = '<!doctype html><html><head><title>라이브찜</title><script type="module" src="/assets/app-3f9a.js"></script></head><body><div id="root"></div></body></html>'

let base = ''
let webDir = ''
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'livejjim-web-'))
  webDir = join(base, 'dist')
  mkdirSync(join(webDir, 'assets'), { recursive: true })
  writeFileSync(join(webDir, 'index.html'), INDEX)
  writeFileSync(join(webDir, 'assets', 'app-3f9a.js'), 'console.log("app")')
  writeFileSync(join(webDir, 'assets', 'app-3f9a.css'), 'body{}')
  writeFileSync(join(webDir, 'assets', '.hidden.js'), 'secret')
  writeFileSync(join(webDir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  writeFileSync(join(webDir, 'manifest.webmanifest'), '{"name":"라이브찜"}')
  writeFileSync(join(webDir, 'robots.txt'), 'User-agent: *')
  writeFileSync(join(webDir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(webDir, '.env'), 'LIVEJJIM_MASTER_KEY=secret')
  writeFileSync(join(base, 'secret.txt'), 'outside')
  symlinkSync(join(base, 'secret.txt'), join(webDir, 'link.txt'))
})
afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

const get = (w: TestServer, path: string, init: RequestInit = {}) => w.server.app.request(path, init)

describe('AC-I3-70 서버가 화면을 같은 출처로 함께 낸다', () => {
  it('있는 파일은 그 파일(내용 종류), 확장자 없는 화면 주소는 index.html 200, 없는 파일은 404 — 캐시 규칙', async () => {
    const w = await world({ webDir })
    for (const path of ['/', '/settings/youtube', '/broadcasts/x', '/privacy', '/terms', '/start', '/sms', '/settings/']) {
      const response = await get(w, path)
      expect(response.status, path).toBe(200)
      expect(response.headers.get('content-type'), path).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control'), path).toBe('no-cache')
      expect(response.headers.get('content-security-policy'), path).toBe(CSP)
      expect(await response.text()).toBe(INDEX)
    }
    const direct = await get(w, '/index.html')
    expect([direct.status, direct.headers.get('cache-control'), direct.headers.get('content-security-policy')]).toEqual([200, 'no-cache', CSP])
    const cases: [string, string, string][] = [
      ['/assets/app-3f9a.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable'],
      ['/assets/app-3f9a.css', 'text/css; charset=utf-8', 'public, max-age=31536000, immutable'],
      ['/sw.js', 'text/javascript; charset=utf-8', 'no-cache'],
      ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
      ['/robots.txt', 'text/plain; charset=utf-8', 'no-cache'],
      ['/icon.png', 'image/png', 'no-cache'],
    ]
    for (const [path, type, cache] of cases) {
      const response = await get(w, path)
      expect([response.status, response.headers.get('content-type'), response.headers.get('cache-control')], path).toEqual([200, type, cache])
      expect(response.headers.get('content-security-policy'), path).toBeNull()
    }
    for (const path of ['/assets/none.js', '/none.png', '/assets/app-3f9a.js.map']) {
      const response = await get(w, path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('content-type')).toBe('application/json')
    }
    const head = await get(w, '/settings/youtube', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('폴더 밖·숨김 파일은 읽지 못한다(404): .. · %2e%2e · %2f · %5c · 역슬래시 · 널 문자 · 점 파일 · 바깥을 가리키는 링크', async () => {
    const w = await world({ webDir })
    for (const path of ['/.env', '/assets/.hidden.js', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/assets%5c..%5c..%5csecret.txt', '/a%00.js', '/link.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt']) {
      const response = await get(w, path)
      expect(response.status, path).toBe(404)
      const text = await response.text()
      expect(text, path).not.toContain('outside')
      expect(text, path).not.toContain('MASTER_KEY')
    }
    // 정규화하기 전의 요청 원문으로도 막는다 (Node HTTP 그대로)
    const http = createNodeServer({ app: w.server.app })
    for (const target of ['/../secret.txt', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..\\..\\secret.txt', '/./.env', '/assets/%2E%2E/%2E%2E/secret.txt']) {
      const response = await rawRequest(http, `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
      expect([response.status, target]).toEqual([response.status === 400 ? 400 : 404, target])
      expect(response.text, target).not.toContain('outside')
      expect(response.text, target).not.toContain('<html>')
    }
  })

  it('GET·HEAD가 아닌 화면 요청은 405, /api·/health·/ops는 화면으로 넘기지 않는다 (없는 API는 JSON 404)', async () => {
    const w = await world({ webDir })
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await get(w, '/settings', { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{}' })
      expect(response.status, method).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
    }
    const seller = await addSeller(w)
    const missing = await client(w, seller.cookie).get('/api/nothing-here')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toBe('application/json')
    expect((await client(w, null).get('/api/me')).status).toBe(401)
    expect((await client(w, null).get('/api/health')).body).toEqual({ status: 'ok' })
    expect(await (await get(w, '/health')).json()).toEqual({ status: 'ok' })
    expect(await (await get(w, '/health/ready')).json()).toEqual({ status: 'ready' })
    expect((await get(w, '/ops/status')).status).toBe(404)
    expect((await get(w, '/ops/other')).status).toBe(404)
    expect((await get(w, '/health/other')).status).toBe(404)
    // API 응답의 no-store는 그대로
    expect((await client(w, seller.cookie).get('/api/me')).headers.get('cache-control')).toBe('no-store')
  })

  it('화면 폴더가 없으면 지금과 같다(화면 없음 — 회귀), index.html이 없는 폴더는 만들지 않는다', async () => {
    const w = await world()
    expect((await get(w, '/')).status).toBe(404)
    expect((await get(w, '/settings/youtube')).status).toBe(404)
    const empty = mkdtempSync(join(tmpdir(), 'livejjim-empty-'))
    try {
      const database = await openTestDb()
      expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: ORIGIN, webDir: empty })).toThrow('화면 폴더에 index.html이 없어요.')
      expect(webDirProblem(empty)).toBe('missing')
      expect(webDirProblem(join(empty, 'none'))).toBe('missing')
      expect(webDirProblem(webDir)).toBeNull()
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('AC-I3-71 보안 머리글', () => {
  const security = (response: Response) => [response.headers.get('x-content-type-options'), response.headers.get('referrer-policy'), response.headers.get('x-frame-options')]

  it('모든 응답(화면·API·헬스·오류)에 nosniff·no-referrer·DENY, 앱 주소가 https면 HSTS — CSP는 화면 문서에만(정한 정책 그대로)', async () => {
    const w = await world({ webDir })
    const seller = await addSeller(w)
    const responses = [
      await get(w, '/'),
      await get(w, '/assets/app-3f9a.js'),
      await get(w, '/assets/none.js'),
      await get(w, '/health'),
      await get(w, '/health/ready'),
      await get(w, '/api/health'),
      await get(w, '/api/me'),
      await get(w, '/api/me', { headers: { Cookie: seller.cookie } }),
      await get(w, '/settings', { method: 'POST' }),
      await get(w, '/ops/status'),
      await get(w, '/api/stream', { headers: { Cookie: seller.cookie } }),
    ]
    for (const response of responses) {
      expect(security(response), response.url).toEqual(['nosniff', 'no-referrer', 'DENY'])
      expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
      await response.body?.cancel()
    }
    expect(CONTENT_SECURITY_POLICY).toBe(CSP)
    expect((await get(w, '/api/me', { headers: { Cookie: seller.cookie } })).headers.get('content-security-policy')).toBeNull()
    // 앱 주소가 http(내 컴퓨터 시험)면 HSTS 없음
    const local = startServer(await openTestDb(), generateMasterKey(), { appOrigin: 'http://localhost:5173', webDir })
    worlds.push(local)
    const plain = await get(local, '/')
    expect(security(plain)).toEqual(['nosniff', 'no-referrer', 'DENY'])
    expect(plain.headers.get('strict-transport-security')).toBeNull()
    // 앱에 닿기 전의 오류(HTTP 파서)도
    const raw = await rawRequest(createNodeServer({ app: w.server.app }), 'GET /health HTTP/1.1\r\nConnection: close\r\n\r\n')
    expect(raw.status).toBe(400)
    expect([raw.headers.get('x-content-type-options'), raw.headers.get('referrer-policy'), raw.headers.get('x-frame-options')]).toEqual(['nosniff', 'no-referrer', 'DENY'])
  })
})

describe('AC-I3-72 운영 시작 검사', () => {
  const ok = () => null
  it('앱 주소 https(내 컴퓨터는 http://localhost·127.0.0.1만) · 운영 토큰 32자 이상 · 믿는 프록시 0~5 · 화면 폴더에 index.html', () => {
    for (const origin of ['https://app.livejjim.kr', 'https://a.b:8443', 'http://localhost', 'http://localhost:5173', 'http://127.0.0.1:3000']) expect(isProductionOrigin(origin), origin).toBe(true)
    for (const origin of ['http://app.livejjim.kr', 'http://192.168.0.10:3000', 'http://localhost.evil.com', 'http://[::1]:3000', 'ftp://x']) expect(isProductionOrigin(origin), origin).toBe(false)
    expect(readDeploySetting({}, 'http://app.example.com', ok)).toEqual({ ok: false, message: HTTPS_ORIGIN_MESSAGE })
    expect(HTTPS_ORIGIN_MESSAGE).toBe('화면 앱 주소는 https://로 적어 주세요(내 컴퓨터 시험은 http://localhost만).')
    expect(readDeploySetting({}, 'https://app.example.com', ok)).toEqual({ ok: true, opsToken: null, trustedProxies: 0, webDir: null })
    const token = 'x'.repeat(32)
    expect(readDeploySetting({ LIVEJJIM_OPS_TOKEN: 'short-token' }, 'https://a.example', ok)).toEqual({ ok: false, message: OPS_TOKEN_MESSAGE })
    expect(readDeploySetting({ LIVEJJIM_OPS_TOKEN: token }, 'https://a.example', ok)).toMatchObject({ ok: true, opsToken: token })
    for (const value of ['6', '-1', '1.5', 'two', '10']) expect(readDeploySetting({ LIVEJJIM_TRUSTED_PROXIES: value }, 'https://a.example', ok), value).toEqual({ ok: false, message: TRUSTED_PROXIES_MESSAGE })
    for (const value of ['0', '1', '5']) expect(readDeploySetting({ LIVEJJIM_TRUSTED_PROXIES: value }, 'https://a.example', ok), value).toMatchObject({ ok: true, trustedProxies: Number(value) })
    expect(readDeploySetting({ LIVEJJIM_WEB_DIR: '/nowhere' }, 'https://a.example', webDirProblem)).toEqual({ ok: false, message: WEB_DIR_MESSAGE })
    expect(readDeploySetting({ LIVEJJIM_WEB_DIR: webDir }, 'https://a.example', webDirProblem)).toMatchObject({ ok: true, webDir })
    // 값은 문장에 넣지 않는다
    for (const result of [readDeploySetting({ LIVEJJIM_OPS_TOKEN: 'secret-short' }, 'https://a.example', ok), readDeploySetting({ LIVEJJIM_WEB_DIR: '/secret/place' }, 'https://a.example', webDirProblem)]) {
      expect(JSON.stringify(result)).not.toMatch(/secret/)
    }
  })

  it('운영 시작(main)은 그 문장으로 알리고 시작하지 않는다 — 값은 출력하지 않는다', async () => {
    const key = generateMasterKey()
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(process.execPath, [fileURLToPath(new URL('../src/main.ts', import.meta.url))], { env: { PATH: process.env.PATH ?? '', PORT: '39998', LIVEJJIM_MASTER_KEY: key, ...env }, timeout: 60_000 }, (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, out: `${stdout}\n${stderr}` })
        })
      })
    const cases: [Record<string, string>, string, string[]][] = [
      [{ LIVEJJIM_APP_ORIGIN: 'http://shop.example.com' }, HTTPS_ORIGIN_MESSAGE, ['shop.example.com']],
      [{ LIVEJJIM_APP_ORIGIN: 'https://shop.example.com', LIVEJJIM_OPS_TOKEN: 'short-ops-secret' }, OPS_TOKEN_MESSAGE, ['short-ops-secret']],
      [{ LIVEJJIM_APP_ORIGIN: 'https://shop.example.com', LIVEJJIM_TRUSTED_PROXIES: '9' }, TRUSTED_PROXIES_MESSAGE, []],
      [{ LIVEJJIM_APP_ORIGIN: 'https://shop.example.com', LIVEJJIM_WEB_DIR: join(base, 'secret-missing-dir') }, WEB_DIR_MESSAGE, ['secret-missing-dir']],
    ]
    for (const [env, message, secrets] of cases) {
      const result = await run(env)
      expect(result.code, result.out).toBe(1)
      expect(result.out).toContain(`시작하지 못했어요. ${message}`)
      expect(result.out).not.toContain('시작했어요.')
      for (const secret of [...secrets, key]) expect(result.out).not.toContain(secret)
    }
  }, 120_000)

  it('서버 조립도 짧은 운영 토큰·틀린 프록시 수를 받지 않는다', async () => {
    const database = await openTestDb()
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: ORIGIN, opsToken: 'short' })).toThrow('운영 토큰은 32자 이상이어야 해요.')
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: ORIGIN, trustedProxies: 6 })).toThrow('믿는 프록시 수는 0~5여야 해요.')
  })
})

describe('AC-I3-80 준비 확인 /health/ready', () => {
  it('DB가 2초 안에 답하면 200 ready, 닫혔거나 느리면 503 not_ready(이유 없음)·경보 DB_UNAVAILABLE(10분에 한 번) — 세션·Origin 필요 없음, no-store, GET·HEAD만', async () => {
    const w = await world()
    const ready = await get(w, '/health/ready')
    expect([ready.status, ready.headers.get('cache-control'), await ready.json()]).toEqual([200, 'no-store', { status: 'ready' }])
    expect((await get(w, '/health/ready', { method: 'HEAD' })).status).toBe(200)
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await get(w, '/health/ready', { method })
      expect(response.status, method).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
    }
    await (w.database.pglite as PGlite).close()
    const down = await get(w, '/health/ready')
    expect([down.status, down.headers.get('cache-control'), await down.json()]).toEqual([503, 'no-store', { status: 'not_ready' }])
    expect((await get(w, '/health/ready')).status).toBe(503)
    const alerts = w.logs.filter((record) => record.level === 'alert')
    expect(alerts).toEqual([{ level: 'alert', code: 'DB_UNAVAILABLE', count: 1 }])
    // /health는 DB를 보지 않는다 (그대로 200)
    expect((await get(w, '/health')).status).toBe(200)
  })

  it('느린 질의(시간 제한을 넘김)는 503 — 시간 제한 안에 답한다', async () => {
    const w = await world({ readyTimeoutMs: 200, dbPing: () => new Promise((resolve) => setTimeout(resolve, 2000)) })
    const started = Date.now()
    const response = await get(w, '/health/ready')
    expect(response.status).toBe(503)
    expect(Date.now() - started).toBeLessThan(1500)
    const quick = await world({ readyTimeoutMs: 2000, dbPing: () => new Promise((resolve) => setTimeout(resolve, 50)) })
    expect((await get(quick, '/health/ready')).status).toBe(200)
  })
})

describe('AC-I3-81 운영 상태 /ops/status', () => {
  const TOKEN = 'ops-token-0123456789-abcdefghijklmnop'

  it('토큰 설정이 없으면 일반 404와 같은 본문, 있으면 Bearer 토큰이 같을 때만 200 — 다르거나 없거나 세션 쿠키면 같은 401', async () => {
    const none = await world()
    const generic = await (await get(none, '/no-such-path')).text()
    const off = await get(none, '/ops/status', { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(off.status).toBe(404)
    expect(await off.text()).toBe(generic)
    const w = await world({ opsToken: TOKEN })
    const seller = await addSeller(w)
    const refused = [
      await get(w, '/ops/status'),
      await get(w, '/ops/status', { headers: { Authorization: 'Bearer wrong' } }),
      await get(w, '/ops/status', { headers: { Authorization: `Bearer ${TOKEN}x` } }),
      await get(w, '/ops/status', { headers: { Authorization: TOKEN } }),
      await get(w, '/ops/status', { headers: { Cookie: seller.cookie } }),
    ]
    const bodies = new Set<string>()
    for (const response of refused) {
      expect(response.status).toBe(401)
      bodies.add(await response.text())
    }
    expect(bodies.size).toBe(1)
    const ok = await get(w, '/ops/status', { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    const body = (await ok.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['collectors', 'db', 'failedEvents24h', 'loginRejected', 'outbox', 'quota', 'realtimeConnections', 'startedAt', 'version', 'workers'])
    expect(body).toMatchObject({ db: 'ok', quota: null, realtimeConnections: 0, loginRejected: { ip: 0, busy: 0 }, version: '0.0.0' })
    expect(body.workers).toEqual({
      collector: { lastSuccessAt: null, consecutiveFailures: 0 },
      outbox: { lastSuccessAt: null, consecutiveFailures: 0 },
      sealer: { lastSuccessAt: null, consecutiveFailures: 0 },
    })
  })

  it('본문은 합친 숫자만 — 시험 데이터의 판매자 ID·가게 이름·방송 제목·닉네임·채팅·전화번호·IP가 0건, 처리 실패 표시 수·실시간 연결 수가 맞다', async () => {
    let boom = false
    const w = await world({
      opsToken: TOKEN,
      engine: {
        applyEvent: (state, event) => {
          if (boom) throw new RangeError('boom 9999')
          return applyReal(state, event)
        },
      },
    })
    const seller = await addSeller(w, 'opsshop', 'pass-word-11')
    await expectOk(client(w, seller.cookie).put('/api/shop', { name: '비밀가게이름' }))
    const b = await createBroadcast(w, seller, { title: '비밀방송제목' })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 1, name: '비밀상품', price: 1000 }))
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'm-secret', ch: 'UCsecretchannel000000000', nick: '비밀닉네임', text: '1 비밀채팅' })
    await expectOk(writeEvent(w, seller, { type: 'sms', b: b.id, no: 1, phone: '010-9876-5432', memo: '비밀메모' }))
    boom = true
    expect((await writeEvent(w, seller, { type: 'product.register', b: b.id, no: 2, name: 'x', price: 1 })).status).toBe(500)
    boom = false
    await w.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'opsshop', password: 'nope' }) }, { incoming: { socket: { remoteAddress: '203.0.113.99' } } })
    const stream = await get(w, '/api/stream', { headers: { Cookie: seller.cookie } })
    const response = await get(w, '/ops/status', { headers: { Authorization: `Bearer ${TOKEN}` } })
    const text = await response.text()
    for (const value of [seller.sellerId, 'opsshop', '비밀가게이름', '비밀방송제목', '비밀상품', 'UCsecretchannel', '비밀닉네임', '비밀채팅', '010-9876-5432', '9876', '5432', '비밀메모', '203.0.113.99', b.id, 'boom']) {
      expect(text, value).not.toContain(value)
    }
    const body = JSON.parse(text) as { failedEvents24h: number; realtimeConnections: number; outbox: { date: string } }
    expect(body.failedEvents24h).toBe(1)
    expect(body.realtimeConnections).toBe(1)
    expect(body.outbox.date).toBe('2026-10-19')
    await stream.body?.cancel()
  })
})


describe('AC-I3-82 경보 기록', () => {
  it('경보는 level alert JSON 한 줄 — 정해진 코드·셈·판매자 ID·범위 날짜·워커 이름만', () => {
    const line = formatAlert({ level: 'alert', code: 'ENGINE_FAILED', count: 3, seller: 'sel_abc-1', date: '2026-10-19', errorKind: 'RangeError', status: 500, reason: 'quotaExceeded' })
    expect(JSON.parse(line)).toEqual({ level: 'alert', code: 'ENGINE_FAILED', count: 3, seller: 'sel_abc-1', date: '2026-10-19' })
    expect(JSON.parse(formatAlert({ level: 'alert', code: 'WORKER_FAILING', worker: 'outbox' }))).toEqual({ level: 'alert', code: 'WORKER_FAILING', count: 1, worker: 'outbox' })
    // 모양이 다른 값은 넣지 않는다
    expect(JSON.parse(formatAlert({ level: 'alert', code: 'SEAL_FAILED', seller: '닉네임 010-1234-5678', date: 'yesterday' }))).toEqual({ level: 'alert', code: 'SEAL_FAILED', count: 1 })
    const written: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      written.push(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      stderrLog({ level: 'alert', code: 'BACKUP_FAILED' })
    } finally {
      process.stderr.write = original
    }
    expect(written).toEqual(['{"level":"alert","code":"BACKUP_FAILED","count":1}\n'])
    expect([...ALERT_CODES].sort()).toEqual(['BACKUP_FAILED', 'COLLECTOR_STOPPED', 'DB_UNAVAILABLE', 'ENGINE_FAILED', 'OUTBOX_GAVE_UP', 'OUTBOX_UNCONFIRMED', 'QUOTA_EXCEEDED', 'SEAL_FAILED', 'WORKER_FAILING'])
  })

  it('처리 실패 표시(ENGINE_FAILED)는 경보 — 같은 판매자는 10분에 한 번, 그 사이 수는 다음 경보의 count, 다른 판매자는 따로', async () => {
    let boom = false
    const clock = fakeClock()
    const w = await world({
      clock,
      engine: {
        applyEvent: (state, event) => {
          if (boom) throw new RangeError('boom')
          return applyReal(state, event)
        },
      },
    })
    const a = await addSeller(w)
    const b2 = await addSeller(w)
    const ba = await createBroadcast(w, a)
    const bb = await createBroadcast(w, b2)
    boom = true
    for (let i = 0; i < 3; i++) await writeEvent(w, a, { type: 'product.register', b: ba.id, no: i + 1, name: 'x', price: 1 })
    await writeEvent(w, b2, { type: 'product.register', b: bb.id, no: 1, name: 'x', price: 1 })
    const alerts = () => w.logs.filter((record): record is LogRecord => record.level === 'alert')
    expect(alerts()).toEqual([
      { level: 'alert', code: 'ENGINE_FAILED', count: 1, seller: a.sellerId, date: ba.date },
      { level: 'alert', code: 'ENGINE_FAILED', count: 1, seller: b2.sellerId, date: bb.date },
    ])
    clock.advance(ALERT_THROTTLE_MS)
    await writeEvent(w, a, { type: 'product.register', b: ba.id, no: 9, name: 'x', price: 1 })
    expect(alerts().at(-1)).toEqual({ level: 'alert', code: 'ENGINE_FAILED', count: 3, seller: a.sellerId, date: ba.date })
    expect(JSON.stringify(alerts())).not.toContain('boom')
  })

  it('봉인 실패는 SEAL_FAILED, 워커가 연속 3번 실패하면 WORKER_FAILING(워커 이름) — 성공하면 다시 센다', async () => {
    const clock = fakeClock()
    let fail = true
    const w = await world({
      clock,
      sealHooks: {
        beforeCommit: () => {
          if (fail) throw new Error('disk full 010-1111-2222')
        },
      },
    })
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller, { date: '2026-09-01' })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 1, name: 'x', price: 1 }))
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'y1', ch: 'UCviewer', nick: '시청자', text: '1' })
    for (let i = 0; i < 3; i++) await w.server.sealer.runOnce()
    const alerts = w.logs.filter((record) => record.level === 'alert')
    expect(alerts).toEqual([
      { level: 'alert', code: 'SEAL_FAILED', count: 1, seller: seller.sellerId, date: '2026-09-01' },
      { level: 'alert', code: 'WORKER_FAILING', count: 1, worker: 'sealer' },
    ])
    expect(w.server.health.view().sealer).toEqual({ lastSuccessAt: null, consecutiveFailures: 3 })
    fail = false
    expect(await w.server.sealer.runOnce()).toBe(1)
    expect(w.server.health.view().sealer).toEqual({ lastSuccessAt: new Date(clock.now()).toISOString(), consecutiveFailures: 0 })
    expect(JSON.stringify(alerts)).not.toContain('010-1111-2222')
    expect(JSON.stringify(alerts)).not.toContain('disk')
  })
})
