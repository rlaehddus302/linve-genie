// MOB1 D-MOB1-06 (AC-MOB1-07·08): 연습 모드 휴대폰 https 중계로 유튜브 연결 한 바퀴.
// 가짜 구글이면 승인·돌아오기·마지막 화면 주소가 모두 휴대폰 https 주소로 이어지고(http://localhost·127.0.0.1로 가는 이동 0),
// 진짜 구글이면 휴대폰 주소의 연결 시작은 안쪽 서버로도 넘기지 않고 409 TRY_PHONE_YOUTUBE.
// 중계 처리기는 scripts/try/phone-relay.mjs(pnpm try가 쓰는 것 그대로)를 자체 서명 인증서 https 서버에 붙여 127.0.0.1에서만 연다.
// 휴대폰 주소(https://192.0.2.10:<포트>)는 Host 머리글로만 흉내 낸다 — 실제 연결은 127.0.0.1.
import { createServer as createPlainServer, request as httpRequest, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, request as httpsRequest, type Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FAKE_GOOGLE_PREFIX,
  TRY_PHONE_YOUTUBE,
  authorizeRoute,
  createPhoneRelay,
  fakeGoogleRedirectOk,
  fakeGoogleTarget,
  honoPath,
  locationAllowed,
  loginRoute,
  phoneYoutubeMessage,
  phoneYoutubeNotice,
  relayAuthorizeUrl,
  relayPath,
  rewriteAuthorizeBody,
  swapOrigin,
  withoutHopByHop,
} from '../../../scripts/try/phone-relay.mjs'
import { generateMasterKey } from '../src/secrets.ts'
import { createNodeServer } from '../src/node-server.ts'
import { createSellerAccount } from '../src/accounts.ts'
import { createSelfSignedCertificate } from '../src/try/self-signed-cert.ts'
import { FakeGoogle } from '../src/youtube/fake-google.ts'
import type { YoutubeConfig } from '../src/youtube/system.ts'
import { FAST_COST, openTestDb, startServer, type TestServer } from './support.ts'

const PHONE_IP = '192.0.2.10'
const CERT = createSelfSignedCertificate({ ips: [PHONE_IP], now: new Date(), days: 2 })

interface Reply {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly text: string
}

interface TryWorld {
  readonly world: TestServer
  readonly fake: FakeGoogle
  readonly port: number
  readonly appOrigin: string
  readonly here: string
  /** 안쪽 서버(127.0.0.1:<포트>)에 닿은 요청 (방법 경로) */
  readonly inner: string[]
  /** 휴대폰 주소(here로 시작하는 주소)로 https 요청 */
  phone(method: string, url: string, options?: { cookie?: string; body?: unknown; origin?: string }): Promise<Reply>
  /** 이 컴퓨터(http://localhost:<포트>)로 요청 */
  local(method: string, path: string, options?: { cookie?: string; body?: unknown }): Promise<Reply>
  close(): Promise<void>
}

const worlds: TryWorld[] = []
afterAll(async () => {
  for (const item of worlds) await item.close()
})

const listen = (server: HttpServer | HttpsServer): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })

async function tryWorld(mode: { real: boolean }): Promise<TryWorld> {
  const fake = await FakeGoogle.start({ pollingIntervalMillis: 1000 })
  const account = fake.addAccount()
  fake.addChannel(account, '연습 채널')
  const inner: string[] = []
  let fetcher: ((request: Request, env: unknown) => Response | Promise<Response>) | null = null
  const http = createNodeServer({
    app: {
      fetch: (request: Request, env: unknown) => {
        inner.push(`${request.method} ${new URL(request.url).pathname}`)
        if (fetcher === null) return new Response(null, { status: 503 })
        return fetcher(request, env)
      },
    } as never,
  })
  const port = await listen(http)
  const appOrigin = `http://localhost:${String(port)}`
  // 진짜 구글 모드: 승인 주소는 실제 구글(accounts.google.com) — 시험은 그 주소로 가지 않는다(가지면 setup-network-guard가 실패시킨다).
  // 토큰·API는 가짜로 둔다(이 컴퓨터에서 먼저 연결한 상태를 만들려고). 중계는 승인 주소가 어디든 휴대폰에 내주지 않는다
  const endpoints = fake.endpoints()
  const youtube: YoutubeConfig = {
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    redirectUri: `${appOrigin}/api/youtube/oauth/callback`,
    returnUrl: `${appOrigin}/settings/youtube`,
    endpoints: mode.real ? { ...endpoints, authUrl: 'https://accounts.google.com/o/oauth2/v2/auth' } : endpoints,
    allowInsecure: true,
  }
  const database = await openTestDb()
  const masterKey = generateMasterKey()
  const world = startServer(database, masterKey, { appOrigin, youtube, passwordCost: FAST_COST })
  fetcher = (request, env) => world.server.app.fetch(request, env as never)
  const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: '연습 가게', loginId: 'practice', password: 'try-pass-1234' }, { passwordCost: FAST_COST })
  if (!created.ok) throw new Error(created.message)

  let phonePort = 0
  const relayOrigins: string[] = []
  const phone = createHttpsServer({ key: CERT.key, cert: CERT.cert }, (req, res) => relay(req, res))
  phonePort = await listen(phone)
  const here = `https://${PHONE_IP}:${String(phonePort)}`
  relayOrigins.push(here, `https://localhost:${String(phonePort)}`)
  const relay = createPhoneRelay({ port, appOrigin, httpsOrigins: relayOrigins, fakeGoogle: mode.real ? null : { port: fake.port }, realYoutube: mode.real })

  const send = (target: { port: number; host: string; path: string; secure: boolean }, method: string, options: { cookie?: string; body?: unknown; origin?: string }): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const body = options.body === undefined ? null : JSON.stringify(options.body)
      const headers: Record<string, string> = { host: target.host }
      if (options.cookie !== undefined) headers.cookie = options.cookie
      if (options.origin !== undefined) headers.origin = options.origin
      if (body !== null) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = String(Buffer.byteLength(body))
      }
      const collect = (answer: IncomingMessage): void => {
        const chunks: Buffer[] = []
        answer.on('data', (chunk: Buffer) => chunks.push(chunk))
        answer.on('end', () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, text: Buffer.concat(chunks).toString('utf8') }))
        answer.on('error', reject)
      }
      const outgoing = target.secure
        ? httpsRequest({ host: '127.0.0.1', port: target.port, method, path: target.path, headers, rejectUnauthorized: false }, collect)
        : httpRequest({ host: '127.0.0.1', port: target.port, method, path: target.path, headers }, collect)
      outgoing.on('error', reject)
      outgoing.end(body ?? undefined)
    })

  const item: TryWorld = {
    world,
    fake,
    port,
    appOrigin,
    here,
    inner,
    phone: (method, url, options = {}) => {
      if (!url.startsWith(`${here}/`)) throw new Error(`휴대폰 주소가 아니다: ${url}`)
      return send({ port: phonePort, host: `${PHONE_IP}:${String(phonePort)}`, path: url.slice(here.length), secure: true }, method, { origin: here, ...options })
    },
    local: (method, path, options = {}) => send({ port, host: `localhost:${String(port)}`, path, secure: false }, method, { origin: appOrigin, ...options }),
    close: async () => {
      phone.closeAllConnections()
      http.closeAllConnections()
      await Promise.all([new Promise((resolve) => phone.close(resolve)), new Promise((resolve) => http.close(resolve))])
      world.server.close()
      await world.server.stop().catch(() => {})
      await fake.close()
      await database.close().catch(() => {})
    },
  }
  worlds.push(item)
  return item
}

const sessionOf = (reply: Reply): string => {
  const raw = reply.headers['set-cookie']
  const all = Array.isArray(raw) ? raw.join('; ') : (raw ?? '')
  const match = /lj_session=([^;]+)/.exec(all)
  if (match === null) throw new Error(`세션 쿠키가 없다 (${String(reply.status)} ${reply.text})`)
  return `lj_session=${match[1] ?? ''}`
}
const locationOf = (reply: Reply): string => {
  const location = reply.headers.location
  if (typeof location !== 'string') throw new Error(`돌려보내는 주소가 없다 (${String(reply.status)} ${reply.text})`)
  return location
}
const json = (reply: Reply): Record<string, unknown> => JSON.parse(reply.text) as Record<string, unknown>

async function phoneLogin(item: TryWorld): Promise<string> {
  const reply = await item.phone('POST', `${item.here}/api/login`, { body: { loginId: 'practice', password: 'try-pass-1234' } })
  expect(reply.status, reply.text).toBe(200)
  return sessionOf(reply)
}

/** 휴대폰에서 승인 주소부터 마지막 화면 주소까지 따라간다. 지나간 주소를 모두 돌려준다 */
async function follow(item: TryWorld, authorizeUrl: string, cookie: string): Promise<string[]> {
  const visited = [authorizeUrl]
  let url = authorizeUrl
  for (let hop = 0; hop < 5; hop++) {
    const reply = await item.phone('GET', url, { cookie })
    if (reply.status !== 302) break
    url = locationOf(reply)
    visited.push(url)
    if (!url.startsWith(`${item.here}/`)) break
    if (new URL(url).pathname === '/settings/youtube') break
  }
  return visited
}

describe('AC-MOB1-07 가짜 구글이면 휴대폰 주소로 한 바퀴', () => {
  it('연결 시작 → 가짜 구글 승인 → 돌아오기 → 설정 화면, 모든 주소가 휴대폰 https 주소이고 연결이 저장된다', async () => {
    const item = await tryWorld({ real: false })
    const cookie = await phoneLogin(item)
    const start = await item.phone('POST', `${item.here}/api/youtube/connection/start`, { cookie, body: {} })
    expect(start.status, start.text).toBe(200)
    const authorizeUrl = json(start).authorizeUrl as string
    expect(authorizeUrl.startsWith(`${item.here}${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/auth?`)).toBe(true)
    // 돌아오는 주소 매개변수는 가짜 구글에 등록한 값 그대로
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(`${item.appOrigin}/api/youtube/oauth/callback`)
    const visited = await follow(item, authorizeUrl, cookie)
    expect(visited).toHaveLength(3)
    for (const url of visited) {
      expect(url.startsWith(`${item.here}/`), url).toBe(true)
      expect(url).not.toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/)
    }
    expect(new URL(visited[1] ?? '').pathname).toBe('/api/youtube/oauth/callback')
    const last = new URL(visited[2] ?? '')
    expect(last.pathname).toBe('/settings/youtube')
    expect(last.searchParams.get('youtube')).toBe('connected')
    const status = await item.phone('GET', `${item.here}/api/youtube/connection`, { cookie })
    expect(status.status).toBe(200)
    const connection = json(status).connection as Record<string, unknown>
    expect(JSON.stringify(connection)).toContain('연습 채널')
    expect(connection.status).toBe('CONNECTED')
    expect(item.fake.calls('oauth.auth')).toBe(1)
    expect(item.fake.calls('oauth.token')).toBe(1)
  })

  it('자동 게시 동의도 같은 길: authorizeUrl이 휴대폰 주소 아래 연습 전용 경로, 따라가면 게시 권한이 생긴다', async () => {
    const item = await tryWorld({ real: false })
    const cookie = await phoneLogin(item)
    const start = await item.phone('POST', `${item.here}/api/youtube/connection/start`, { cookie, body: {} })
    await follow(item, json(start).authorizeUrl as string, cookie)
    const consent = await item.phone('PUT', `${item.here}/api/youtube/consent`, { cookie, body: { target: 'LIVE_CHAT', enabled: true } })
    expect(consent.status, consent.text).toBe(200)
    const authorizeUrl = json(consent).authorizeUrl as string
    expect(authorizeUrl.startsWith(`${item.here}${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/auth?`)).toBe(true)
    const visited = await follow(item, authorizeUrl, cookie)
    for (const url of visited) expect(url.startsWith(`${item.here}/`), url).toBe(true)
    expect(new URL(visited.at(-1) ?? '').pathname).toBe('/settings/youtube')
    const connection = json(await item.phone('GET', `${item.here}/api/youtube/connection`, { cookie })).connection as Record<string, unknown>
    expect(JSON.stringify(connection)).toContain('연습 채널')
    expect(connection.permissions).toEqual({ read: true, publish: true })
    expect((connection.consent as { liveChat: { enabled: boolean } }).liveChat.enabled).toBe(true)
  })

  it('TD-MOB1-001: 모양만 다른 연결 시작 경로로 와도 승인 주소는 휴대폰 주소 아래 연습 전용 경로', async () => {
    const item = await tryWorld({ real: false })
    const cookie = await phoneLogin(item)
    for (const path of ['/api/youtube/connection/./start', '/api/youtube/x/../connection/start', '/api/youtube/connection/%73tart']) {
      const reply = await item.phone('POST', `${item.here}${path}`, { cookie, body: {} })
      expect(reply.status, `${path} ${reply.text}`).toBe(200)
      const url = new URL(json(reply).authorizeUrl as string)
      expect(url.origin, path).toBe(item.here)
      expect(url.pathname, path).toBe(`${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/auth`)
    }
  })

  it('이 컴퓨터(http://localhost:<포트>)로 연 경우는 지금 그대로 — 승인 주소는 가짜 구글 주소', async () => {
    const item = await tryWorld({ real: false })
    const login = await item.local('POST', '/api/login', { body: { loginId: 'practice', password: 'try-pass-1234' } })
    const cookie = sessionOf(login)
    const start = await item.local('POST', '/api/youtube/connection/start', { cookie, body: {} })
    expect(start.status).toBe(200)
    expect((json(start).authorizeUrl as string).startsWith(`${item.fake.url}/o/oauth2/v2/auth?`)).toBe(true)
  })

  it('연습 전용 경로는 가짜 구글 승인 경로 하나만 넘긴다 — 다른 경로·조작 경로·POST는 404이고 가짜 구글에 닿지 않는다', async () => {
    const item = await tryWorld({ real: false })
    const before = JSON.stringify(item.fake.callCounts())
    for (const path of ['/_try/google', '/_try/google/', '/_try/google/token', '/_try/google/_fake/approval', '/_try/google/o/oauth2/v2/auth/../../../_fake/x', '/_try/google/o/oauth2/v2/authx', '/_try/google/%2E%2E/_fake/x']) {
      const reply = await item.phone('GET', `${item.here}${path}`)
      expect(reply.status, path).toBe(404)
    }
    expect((await item.phone('POST', `${item.here}/_try/google/o/oauth2/v2/auth?x=1`, { body: {} })).status).toBe(404)
    expect(JSON.stringify(item.fake.callCounts())).toBe(before)
  })
})

describe('AC-MOB1-08 진짜 구글이면 휴대폰에선 안내', () => {
  it('휴대폰 주소의 연결 시작은 409 TRY_PHONE_YOUTUBE(포트 숫자 그대로), 안쪽 서버로도 넘기지 않는다', async () => {
    const item = await tryWorld({ real: true })
    const cookie = await phoneLogin(item)
    const innerBefore = item.inner.length
    const start = await item.phone('POST', `${item.here}/api/youtube/connection/start`, { cookie, body: {} })
    expect(start.status).toBe(409)
    expect(json(start)).toEqual({
      error: {
        code: 'TRY_PHONE_YOUTUBE',
        message: `휴대폰에서는 유튜브를 연결할 수 없어요. 이 컴퓨터에서 http://localhost:${String(item.port)} 를 열어 먼저 연결해 주세요. 연결하면 휴대폰에서도 그대로 쓸 수 있어요.`,
      },
    })
    expect(item.inner.length).toBe(innerBefore)
    expect(item.fake.calls()).toBe(0)
  })

  it('이 컴퓨터에서 연결한 뒤 휴대폰에서 자동 게시 동의(승인 주소가 필요할 때)도 409, 연결은 그대로 쓴다', async () => {
    const item = await tryWorld({ real: true })
    // 이 컴퓨터에서 연결: 승인 단계만 가짜 구글로 대신한다(실제 구글 주소로는 가지 않는다)
    const localCookie = sessionOf(await item.local('POST', '/api/login', { body: { loginId: 'practice', password: 'try-pass-1234' } }))
    const start = await item.local('POST', '/api/youtube/connection/start', { cookie: localCookie, body: {} })
    const real = new URL(json(start).authorizeUrl as string)
    expect(real.origin).toBe('https://accounts.google.com')
    const approved = await fetch(`${item.fake.url}/o/oauth2/v2/auth${real.search}`, { redirect: 'manual' })
    const back = new URL(approved.headers.get('location') ?? '')
    const done = await item.local('GET', `${back.pathname}${back.search}`, { cookie: localCookie })
    expect(new URL(locationOf(done)).searchParams.get('youtube')).toBe('connected')

    const cookie = await phoneLogin(item)
    const status = await item.phone('GET', `${item.here}/api/youtube/connection`, { cookie })
    expect((json(status).connection as Record<string, unknown>).status).toBe('CONNECTED')
    const consent = await item.phone('PUT', `${item.here}/api/youtube/consent`, { cookie, body: { target: 'LIVE_CHAT', enabled: true } })
    expect(consent.status).toBe(409)
    expect((json(consent).error as Record<string, unknown>).code).toBe(TRY_PHONE_YOUTUBE)
    expect(consent.text).not.toContain('accounts.google.com')
    // 동의를 끄는 것(승인 주소 없음)은 지금 그대로
    const off = await item.phone('PUT', `${item.here}/api/youtube/consent`, { cookie, body: { target: 'LIVE_CHAT', enabled: false } })
    expect(off.status, off.text).toBe(200)
  })

  it('TD-MOB1-001: 모양만 다른 연결 시작 경로(`./`·`x/../`·`%73tart`·`%2e/`·`%252e`·`\\`·대문자)도 409, 안쪽 서버로 넘기지 않는다', async () => {
    const item = await tryWorld({ real: true })
    const cookie = await phoneLogin(item)
    const innerBefore = item.inner.length
    for (const path of ['/api/youtube/connection/./start', '/api/youtube/x/../connection/start', '/api/youtube/connection/%73tart', '/api/youtube/connection/%2e/start', '/api/youtube/connection/%252e/start', '/api//youtube/connection/start', '/API/youtube/connection/start', '/api/youtube/connection/start/']) {
      const reply = await item.phone('POST', `${item.here}${path}`, { cookie, body: {} })
      expect(reply.status, path).toBe(409)
      expect((json(reply).error as Record<string, unknown>).code, path).toBe(TRY_PHONE_YOUTUBE)
      expect(reply.text, path).not.toContain('accounts.google.com')
    }
    expect(item.inner.length).toBe(innerBefore)
    expect(item.fake.calls()).toBe(0)
  })

  it('이 컴퓨터 주소에서는 지금 그대로 구글 승인 주소를 받는다', async () => {
    const item = await tryWorld({ real: true })
    const cookie = sessionOf(await item.local('POST', '/api/login', { body: { loginId: 'practice', password: 'try-pass-1234' } }))
    const start = await item.local('POST', '/api/youtube/connection/start', { cookie, body: {} })
    expect(start.status).toBe(200)
    expect(new URL(json(start).authorizeUrl as string).origin).toBe('https://accounts.google.com')
  })

  it('시작 안내 한 줄과 안내 문장이 try.mjs에 들어 있다', () => {
    expect(phoneYoutubeNotice(false)).toBe('휴대폰에서도 유튜브 연결을 해 볼 수 있어요.')
    expect(phoneYoutubeNotice(true)).toBe('실제 유튜브 연결은 이 컴퓨터에서 먼저 해 주세요.')
    expect(phoneYoutubeMessage(7700)).toBe('휴대폰에서는 유튜브를 연결할 수 없어요. 이 컴퓨터에서 http://localhost:7700 를 열어 먼저 연결해 주세요. 연결하면 휴대폰에서도 그대로 쓸 수 있어요.')
    const script = readFileSync(new URL('../../../scripts/try/try.mjs', import.meta.url), 'utf8')
    expect(script).toContain('phoneYoutubeNotice(realGoogle !== null)')
    expect(script).toContain('createPhoneRelay(')
  })
})

describe('중계 규칙 (순수 함수)', () => {
  const app = 'http://localhost:7700'
  const here = 'https://192.0.2.10:7701'
  const google = 'http://127.0.0.1:5123'

  it('swapOrigin: 정확히 `<출처>/`로 시작할 때만 바꾼다', () => {
    expect(swapOrigin(`${app}/settings/youtube?youtube=connected`, app, here)).toBe(`${here}/settings/youtube?youtube=connected`)
    for (const text of [`${app}@evil/`, `${app}.evil/`, `https://evil/?u=${app}/`, 'http://localhost:7702/', app, `${app}?x`]) expect(swapOrigin(text, app, here)).toBe(text)
  })

  it('relayAuthorizeUrl: 가짜 구글 승인 주소만, redirect_uri는 그대로', () => {
    const url = `${google}/o/oauth2/v2/auth?client_id=a&redirect_uri=${encodeURIComponent(`${app}/api/youtube/oauth/callback`)}`
    const out = relayAuthorizeUrl(url, google, here)
    expect(out).toBe(`${here}/_try/google/o/oauth2/v2/auth?client_id=a&redirect_uri=${encodeURIComponent(`${app}/api/youtube/oauth/callback`)}`)
    for (const text of [`${google}/token`, `${google}/o/oauth2/v2/authx`, `${google}@evil/o/oauth2/v2/auth`, 'http://127.0.0.1:5124/o/oauth2/v2/auth', 'https://accounts.google.com/o/oauth2/v2/auth?x=1']) {
      expect(relayAuthorizeUrl(text, google, here)).toBe(text)
    }
  })

  it('fakeGoogleTarget: 승인 경로 하나만, 글자 그대로', () => {
    expect(fakeGoogleTarget('/_try/google/o/oauth2/v2/auth?a=1')).toBe('/o/oauth2/v2/auth?a=1')
    expect(fakeGoogleTarget('/_try/google/o/oauth2/v2/auth')).toBe('/o/oauth2/v2/auth')
    for (const target of ['/_try/google/o/oauth2/v2/auth/..', '/_try/google//evil/o/oauth2/v2/auth', '/_try/google/%2Fo/oauth2/v2/auth', 'http://evil/_try/google/o/oauth2/v2/auth', '/_try/google/o/oauth2/v2/auth?a=1\r\nHost: evil', '/_try/googleo/oauth2/v2/auth']) {
      expect(fakeGoogleTarget(target), target).toBeNull()
    }
  })

  it('relayPath: 절대 주소·퍼센트(두 번까지)·`.`·`..`·`#`·`\\`·빈 칸·대소문자·끝 `/`를 정리한 경로 (TD-MOB1-001)', () => {
    const start = '/api/youtube/connection/start'
    for (const target of [
      start,
      `${start}?x=1`,
      `${start}#x`,
      '/api/youtube/connection/./start',
      '/api/youtube/x/../connection/start',
      '/api/youtube/connection/%73tart',
      '/api/youtube/connection/%2e/start',
      '/api/youtube/connection/%2E%2E/connection/start',
      '/api/youtube/connection/%252e/start',
      '/api/youtube/connection%2Fstart',
      '/api\\youtube\\connection\\start',
      '//api///youtube/connection/start/',
      '/API/YouTube/Connection/Start',
      'http://localhost:7700/api/youtube/connection/start',
      'HTTP://evil.example/api/youtube/connection/./start?x',
      '/api/youtube/connection/%zz/../%73tart',
    ]) {
      expect(relayPath(target), target).toBe(start)
    }
    expect(relayPath('/../../etc')).toBe('/etc')
    expect(relayPath('')).toBe('/')
  })

  it('authorizeRoute·loginRoute: 모양만 다른 경로도 같은 요청으로 알아본다 (TD-MOB1-001)', () => {
    expect(authorizeRoute('POST', '/api/youtube/connection/%73tart')).toBe('start')
    expect(authorizeRoute('POST', 'http://localhost:7700/api/youtube/connection/start')).toBe('start')
    expect(authorizeRoute('PUT', '/api/youtube/./consent')).toBe('consent')
    expect(authorizeRoute('PUT', '/api/x/../youtube/%63onsent#y')).toBe('consent')
    expect(authorizeRoute('POST', '/api/outbox/12/./resend')).toBe('resend')
    expect(authorizeRoute('POST', '/api/outbox/%31%32/resend')).toBe('resend')
    expect(loginRoute('POST', '/api/auth/./start')).toBe(true)
    expect(loginRoute('POST', '/api/auth/link?x')).toBe(true)
    expect(loginRoute('GET', '/api/auth/start')).toBe(false)
    expect(loginRoute('POST', '/api/youtube/connection/start')).toBe(false)
  })

  it('authorizeRoute·rewriteAuthorizeBody', () => {
    expect(authorizeRoute('POST', '/api/youtube/connection/start')).toBe('start')
    expect(authorizeRoute('PUT', '/api/youtube/consent')).toBe('consent')
    expect(authorizeRoute('POST', '/api/outbox/12/resend')).toBe('resend')
    expect(authorizeRoute('GET', '/api/youtube/connection/start')).toBeNull()
    expect(authorizeRoute('POST', '/api/outbox/x/resend')).toBeNull()
    expect(rewriteAuthorizeBody('{"authorizeUrl":"a","x":1}', () => 'b')).toEqual({ text: '{"authorizeUrl":"b","x":1}', authorizeUrl: 'a' })
    expect(rewriteAuthorizeBody('{"connection":{}}', () => 'b')).toEqual({ text: '{"connection":{}}', authorizeUrl: null })
    expect(rewriteAuthorizeBody('not json', () => 'b')).toEqual({ text: 'not json', authorizeUrl: null })
  })
})

describe('TD-MOB1-001 경로와 상관없이 응답의 승인 주소 검사', () => {
  // 안쪽 서버 대신 어떤 경로에도 { authorizeUrl } JSON을 돌려주는 작은 서버 — 중계가 경로 모양에 기대지 않는지 본다
  const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'
  async function stubWorld(real: boolean): Promise<{ call: (method: string, path: string) => Promise<Reply>; close: () => Promise<void>; here: string }> {
    const stub = createPlainServer((req, res) => {
      req.resume()
      const path = req.url ?? '/'
      if (path.startsWith('/stream')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(`data: {"authorizeUrl":"${google}"}\n\n`)
        return
      }
      const body = JSON.stringify(path.startsWith('/api/auth/') ? { authorizeUrl: 'https://login.example/authorize?x=1' } : { authorizeUrl: real ? google : 'http://127.0.0.1:5123/o/oauth2/v2/auth?x=1', other: 1 })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
      res.end(body)
    })
    const stubPort = await listen(stub)
    const appOrigin = `http://localhost:${String(stubPort)}`
    let relay: ReturnType<typeof createPhoneRelay> | null = null
    const phone = createHttpsServer({ key: CERT.key, cert: CERT.cert }, (req, res) => relay?.(req, res))
    const phonePort = await listen(phone)
    const here = `https://${PHONE_IP}:${String(phonePort)}`
    relay = createPhoneRelay({ port: stubPort, appOrigin, httpsOrigins: [here], fakeGoogle: real ? null : { port: 5123 }, realYoutube: real })
    const call = (method: string, path: string): Promise<Reply> =>
      new Promise((resolve, reject) => {
        const outgoing = httpsRequest({ host: '127.0.0.1', port: phonePort, method, path, headers: { host: `${PHONE_IP}:${String(phonePort)}`, 'accept-encoding': 'gzip, br' }, rejectUnauthorized: false }, (answer) => {
          const chunks: Buffer[] = []
          answer.on('data', (chunk: Buffer) => chunks.push(chunk))
          answer.on('end', () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, text: Buffer.concat(chunks).toString('utf8') }))
        })
        outgoing.on('error', reject)
        outgoing.end()
      })
    return {
      call,
      here,
      close: async () => {
        phone.closeAllConnections()
        stub.closeAllConnections()
        await Promise.all([new Promise((resolve) => phone.close(resolve)), new Promise((resolve) => stub.close(resolve))])
      },
    }
  }

  it('진짜 구글: 어떤 경로·방법이든 맨 위 authorizeUrl이 든 JSON 응답은 409 — 간편 로그인 시작만 그대로', async () => {
    const item = await stubWorld(true)
    try {
      for (const [method, path] of [['GET', '/api/anything'], ['POST', '/api/youtube/connection/start/../../whatever'], ['PATCH', '/api/youtube/consent2'], ['GET', '/']] as const) {
        const reply = await item.call(method, path)
        expect(reply.status, `${method} ${path}`).toBe(409)
        expect(reply.text, path).not.toContain('accounts.google.com')
      }
      const login = await item.call('POST', '/api/auth/start')
      expect(login.status).toBe(200)
      expect(JSON.parse(login.text)).toEqual({ authorizeUrl: 'https://login.example/authorize?x=1' })
      // 실시간 푸시(JSON 아님)는 그대로 흘려 보낸다
      const stream = await item.call('GET', '/stream')
      expect(stream.status).toBe(200)
    } finally {
      await item.close()
    }
  })

  it('가짜 구글: 어떤 경로든 가짜 구글 승인 주소는 휴대폰 주소 아래 연습 전용 경로로 바뀐다', async () => {
    const item = await stubWorld(false)
    try {
      for (const path of ['/api/anything', '/api/youtube/connection/x/../start']) {
        const reply = await item.call('POST', path)
        expect(reply.status, path).toBe(200)
        expect(JSON.parse(reply.text), path).toEqual({ authorizeUrl: `${item.here}${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/auth?x=1`, other: 1 })
      }
    } finally {
      await item.close()
    }
  })
})

describe('TD-MOB1-001·002·003 중계 다듬기 (순수 함수)', () => {
  const app = 'http://localhost:7700'
  const here = 'https://192.0.2.10:7701'

  it('honoPath: 안쪽 서버가 읽는 그대로 — 절대 주소는 pathname, `.`·`..`·`%2e`·`#` 정리, decodeURI처럼 풀되 `%2F`는 그대로', () => {
    expect(honoPath('http://localhost:7700/api/youtube/connection/start')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/youtube/connection/./start')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/youtube/x/../connection/start')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/youtube/connection/%2e/start')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/youtube/connection/%73tart')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/youtube/connection/start#x')).toBe('/api/youtube/connection/start')
    expect(honoPath('/api/a%2Fb')).toBe('/api/a%2Fb')
  })

  it('authorizeRoute는 두 읽기 중 하나라도, loginRoute는 둘 다 맞아야 (막는 쪽 넓게, 빼 주는 쪽 좁게)', () => {
    expect(authorizeRoute('POST', '/api/youtube/connection/%2e/start')).toBe('start')
    expect(authorizeRoute('POST', 'http://localhost:7700/api/youtube/connection/start#x')).toBe('start')
    expect(authorizeRoute('PUT', 'http://localhost:7700/api/youtube/x/../consent')).toBe('consent')
    // 넓게 읽으면 로그인 시작이지만 안쪽 서버는 다른 경로로 읽는 것 — 빼 주지 않는다
    expect(loginRoute('POST', '/api/youtube/connection/start/..%2f..%2f..%2fauth/start')).toBe(false)
    expect(loginRoute('POST', '/API/auth/start')).toBe(false)
    expect(loginRoute('POST', '/api/auth/start')).toBe(true)
    expect(loginRoute('POST', 'http://localhost:7700/api/auth/./link')).toBe(true)
  })

  it('fakeGoogleRedirectOk: redirect_uri가 정확히 `http://localhost:<포트>/`로 시작할 때만 (TD-MOB1-002)', () => {
    const head = '/o/oauth2/v2/auth'
    expect(fakeGoogleRedirectOk(head, app)).toBe(true)
    expect(fakeGoogleRedirectOk(`${head}?client_id=a`, app)).toBe(true)
    expect(fakeGoogleRedirectOk(`${head}?redirect_uri=${encodeURIComponent(`${app}/api/youtube/oauth/callback`)}`, app)).toBe(true)
    expect(fakeGoogleRedirectOk(`${head}?redirect_uri=${app}/api/youtube/oauth/callback`, app)).toBe(true)
    for (const bad of ['https://아무곳/', `${app}@evil/`, `${app}.evil/`, 'http://localhost:7702/', app, `https://evil/?u=${app}/`, 'http://localhost:7700%40evil/', 'http%3A%2F%2Fevil%2F']) {
      expect(fakeGoogleRedirectOk(`${head}?redirect_uri=${bad}`, app), bad).toBe(false)
      expect(fakeGoogleRedirectOk(`${head}?redirect_uri=${encodeURIComponent(bad)}`, app), bad).toBe(false)
    }
    // 둘 이상이면 모두 맞아야
    expect(fakeGoogleRedirectOk(`${head}?redirect_uri=${app}/a&redirect_uri=https://evil/`, app)).toBe(false)
  })

  it('locationAllowed: 휴대폰 주소·화면 주소(안쪽 서버는 같은 곳 경로도)만 (TD-MOB1-002)', () => {
    const known = { here, known: true, appOrigin: app, allowRelative: false }
    expect(locationAllowed(`${here}/settings/youtube`, known)).toBe(true)
    expect(locationAllowed(`${app}/settings/youtube`, known)).toBe(true)
    for (const bad of ['https://evil/', `${here}@evil/`, `${here}.evil/`, `${app}@evil/`, '//evil/', '/r/abc', 'http://localhost:7702/']) expect(locationAllowed(bad, known), bad).toBe(false)
    expect(locationAllowed(`${here}/x`, { ...known, known: false })).toBe(false)
    const inner = { ...known, allowRelative: true }
    expect(locationAllowed('/r/abc', inner)).toBe(true)
    expect(locationAllowed('//evil/', inner)).toBe(false)
    expect(locationAllowed('/\\evil/', inner)).toBe(false)
  })

  it('withoutHopByHop: connection·keep-alive·transfer-encoding·upgrade·te·trailer·proxy-*·connection에 적힌 이름을 뺀다 (TD-MOB1-003)', () => {
    const out = withoutHopByHop({
      connection: 'keep-alive, X-Hop',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      upgrade: 'websocket',
      te: 'trailers',
      trailer: 'x',
      'proxy-authorization': 'secret',
      'proxy-connection': 'keep-alive',
      'x-hop': '1',
      'content-type': 'application/json',
      'set-cookie': ['a=1', 'b=2'],
    })
    expect(out).toEqual({ 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] })
  })
})

describe('TD-MOB1-002·003 중계 처리기', () => {
  async function stubWorld(real: boolean): Promise<{ call: (method: string, path: string, headers?: Record<string, string>) => Promise<Reply>; seen: Array<Record<string, string | string[] | undefined>>; close: () => Promise<void>; here: string; appOrigin: string }> {
    const seen: Array<Record<string, string | string[] | undefined>> = []
    let appOrigin = ''
    const stub = createPlainServer((req, res) => {
      req.resume()
      seen.push(req.headers)
      const path = req.url ?? '/'
      const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'
      if (path === '/go/evil') {
        res.writeHead(302, { location: 'https://evil.example/steal' })
        return res.end()
      }
      if (path === '/go/app') {
        res.writeHead(302, { location: `${appOrigin}/settings/youtube?youtube=connected` })
        return res.end()
      }
      if (path === '/go/relative') {
        res.writeHead(302, { location: '/r/abc' })
        return res.end()
      }
      if (path === '/api/plain') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end(JSON.stringify({ authorizeUrl: google }))
      }
      if (path === '/api/gzip') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
        return res.end(gzipSync(JSON.stringify({ authorizeUrl: google })))
      }
      res.writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive, x-hop', 'keep-alive': 'timeout=5', 'x-hop': '1', 'x-keep': '1' })
      res.end('ok')
    })
    const stubPort = await listen(stub)
    appOrigin = `http://localhost:${String(stubPort)}`
    let relay: ReturnType<typeof createPhoneRelay> | null = null
    const phone = createHttpsServer({ key: CERT.key, cert: CERT.cert }, (req, res) => relay?.(req, res))
    const phonePort = await listen(phone)
    const here = `https://${PHONE_IP}:${String(phonePort)}`
    relay = createPhoneRelay({ port: stubPort, appOrigin, httpsOrigins: [here], fakeGoogle: real ? null : { port: 5123 }, realYoutube: real })
    const call = (method: string, path: string, headers: Record<string, string> = {}): Promise<Reply> =>
      new Promise((resolve, reject) => {
        const outgoing = httpsRequest({ host: '127.0.0.1', port: phonePort, method, path, headers: { host: `${PHONE_IP}:${String(phonePort)}`, ...headers }, rejectUnauthorized: false }, (answer) => {
          const chunks: Buffer[] = []
          answer.on('data', (chunk: Buffer) => chunks.push(chunk))
          answer.on('end', () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, text: Buffer.concat(chunks).toString('utf8') }))
        })
        outgoing.on('error', reject)
        outgoing.end()
      })
    return {
      call,
      seen,
      here,
      appOrigin,
      close: async () => {
        phone.closeAllConnections()
        stub.closeAllConnections()
        await Promise.all([new Promise((resolve) => phone.close(resolve)), new Promise((resolve) => stub.close(resolve))])
      },
    }
  }

  it('Location: 바깥 주소는 400, 화면 주소는 휴대폰 주소로, 같은 곳 경로는 그대로', async () => {
    const item = await stubWorld(false)
    try {
      const evil = await item.call('GET', '/go/evil')
      expect(evil.status).toBe(400)
      expect(evil.headers.location).toBeUndefined()
      const app = await item.call('GET', '/go/app')
      expect(app.status).toBe(302)
      expect(app.headers.location).toBe(`${item.here}/settings/youtube?youtube=connected`)
      const relative = await item.call('GET', '/go/relative')
      expect(relative.status).toBe(302)
      expect(relative.headers.location).toBe('/r/abc')
    } finally {
      await item.close()
    }
  })

  it('hop-by-hop 머리글은 응답에도 요청에도 옮기지 않는다 — connection: close를 보내면 응답도 close', async () => {
    const item = await stubWorld(false)
    try {
      const reply = await item.call('GET', '/plain', { connection: 'close, x-secret', 'x-secret': 's', 'proxy-authorization': 'Basic abc', te: 'trailers', 'x-pass': 'p' })
      expect(reply.status).toBe(200)
      expect(reply.text).toBe('ok')
      expect(reply.headers.connection).toBe('close')
      expect(reply.headers['keep-alive']).toBeUndefined()
      expect(reply.headers['x-hop']).toBeUndefined()
      expect(reply.headers['x-keep']).toBe('1')
      const got = item.seen.at(-1) ?? {}
      expect(got['proxy-authorization']).toBeUndefined()
      expect(got['x-secret']).toBeUndefined()
      expect(got.te).toBeUndefined()
      expect(got['x-pass']).toBe('p')
    } finally {
      await item.close()
    }
  })

  it('진짜 구글: /api 아래 응답은 종류가 JSON이 아니거나 압축돼 있어도 authorizeUrl이 있으면 409', async () => {
    const item = await stubWorld(true)
    try {
      for (const path of ['/api/plain', '/api/gzip']) {
        const reply = await item.call('GET', path)
        expect(reply.status, path).toBe(409)
        expect(reply.text, path).not.toContain('accounts.google.com')
      }
    } finally {
      await item.close()
    }
  })
})

describe('TD-MOB1-002 연습 전용 가짜 구글 경로의 redirect_uri', () => {
  it('redirect_uri가 화면 주소가 아니면 400이고 가짜 구글로 넘긴 요청 0개, 맞으면 넘긴다', async () => {
    const item = await tryWorld({ real: false })
    const before = item.fake.calls('oauth.auth')
    const head = `${item.here}${FAKE_GOOGLE_PREFIX}/o/oauth2/v2/auth?client_id=${item.fake.clientId}&response_type=code`
    for (const bad of ['https://evil.example/', `${item.appOrigin}@evil/`, `${item.appOrigin}.evil/`, `http://localhost:${String(item.port + 1)}/`]) {
      for (const value of [bad, encodeURIComponent(bad)]) {
        const reply = await item.phone('GET', `${head}&redirect_uri=${value}`)
        expect(reply.status, value).toBe(400)
        expect(reply.headers.location, value).toBeUndefined()
      }
    }
    expect(item.fake.calls('oauth.auth')).toBe(before)
    const ok = await item.phone('GET', `${head}&redirect_uri=${encodeURIComponent(`${item.appOrigin}/api/youtube/oauth/callback`)}`)
    expect(ok.status).not.toBe(404)
    expect(item.fake.calls('oauth.auth')).toBe(before + 1)
  })
})
