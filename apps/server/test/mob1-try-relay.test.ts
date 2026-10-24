// MOB1 D-MOB1-06 (AC-MOB1-07·08): 연습 모드 휴대폰 https 중계로 유튜브 연결 한 바퀴.
// 가짜 구글이면 승인·돌아오기·마지막 화면 주소가 모두 휴대폰 https 주소로 이어지고(http://localhost·127.0.0.1로 가는 이동 0),
// 진짜 구글이면 휴대폰 주소의 연결 시작은 안쪽 서버로도 넘기지 않고 409 TRY_PHONE_YOUTUBE.
// 중계 처리기는 scripts/try/phone-relay.mjs(pnpm try가 쓰는 것 그대로)를 자체 서명 인증서 https 서버에 붙여 127.0.0.1에서만 연다.
// 휴대폰 주소(https://192.0.2.10:<포트>)는 Host 머리글로만 흉내 낸다 — 실제 연결은 127.0.0.1.
import { request as httpRequest, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, request as httpsRequest, type Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FAKE_GOOGLE_PREFIX,
  TRY_PHONE_YOUTUBE,
  authorizeRoute,
  createPhoneRelay,
  fakeGoogleTarget,
  phoneYoutubeMessage,
  phoneYoutubeNotice,
  relayAuthorizeUrl,
  rewriteAuthorizeBody,
  swapOrigin,
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
