// MOB1 적대 시험 공용 도구 (test-domain): 연습 모드 휴대폰 https 중계(scripts/try/phone-relay.mjs)를 실제 서버·가짜 구글과 함께 띄운다.
// 서버 시험 apps/server/test/mob1-try-relay.test.ts의 구성을 따르되(내보내지 않아 복사), 공격에 필요한 것을 더했다:
// - 요청 줄을 글자 그대로 보내는 raw(): Node http 클라이언트가 고치거나 막는 대상(절대 주소·`..`·이상한 글자)도 그대로 보낸다
// - 미끼 서버(127.0.0.1:<미끼 포트>): 중계가 다른 곳으로 요청을 보내면 여기에 닿는다
// - 연결 기록: 이 프로세스가 연 TCP 연결의 목적지를 모두 적는다(net.Socket.prototype.connect) — 허용한 포트 밖으로 나가면 잡힌다
// 휴대폰 주소(https://192.0.2.10:<포트>)는 Host 머리글로만 흉내 낸다 — 실제 연결은 127.0.0.1.
import { request as httpRequest, createServer as createPlainServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, request as httpsRequest, Agent as HttpsAgent, type Server as HttpsServer } from 'node:https'
import net, { type AddressInfo } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { createPhoneRelay } from '../../../scripts/try/phone-relay.mjs'
import { createSellerAccount } from '../../../apps/server/src/accounts.ts'
import { createNodeServer } from '../../../apps/server/src/node-server.ts'
import { generateMasterKey } from '../../../apps/server/src/secrets.ts'
import { createSelfSignedCertificate } from '../../../apps/server/src/try/self-signed-cert.ts'
import { FakeGoogle } from '../../../apps/server/src/youtube/fake-google.ts'
import { installGoogleBlock } from '../../../apps/server/src/youtube/network-guard.ts'
import type { YoutubeConfig } from '../../../apps/server/src/youtube/system.ts'
import { FAST_COST, openTestDb, startServer, type TestServer } from '../../../apps/server/test/support.ts'

// 실제 구글로 나가는 요청은 막는다(나가면 BlockedRequestError — 응답이 깨져 시험이 실패한다)
installGoogleBlock()

export const PHONE_IP = '192.0.2.10'
const CERT = createSelfSignedCertificate({ ips: [PHONE_IP], now: new Date(), days: 2 })

// ── 연결 기록 ───────────────────────────────────────────────────────────
interface Dial {
  readonly host: string
  readonly port: number
}
const dials: Dial[] = []
const DIAL_KEY = Symbol.for('livejjim.test.mob1-dials')
const holder = globalThis as unknown as Record<symbol, boolean>
if (holder[DIAL_KEY] !== true) {
  holder[DIAL_KEY] = true
  const original = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = args[0]
    if (Array.isArray(first)) {
      const options = first[0] as { host?: string; port?: number | string } | undefined
      if (options !== undefined && options.port !== undefined) dials.push({ host: String(options.host ?? 'localhost'), port: Number(options.port) })
    } else if (typeof first === 'object' && first !== null) {
      const options = first as { host?: string; port?: number | string; path?: string }
      if (options.port !== undefined) dials.push({ host: String(options.host ?? 'localhost'), port: Number(options.port) })
    } else if (typeof first === 'number' || typeof first === 'string') {
      if (/^\d+$/.test(String(first))) dials.push({ host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(first) })
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect
}
/** 지금까지 적은 연결 목적지를 돌려주고 비운다 */
export function takeDials(): Dial[] {
  return dials.splice(0, dials.length)
}

export interface Reply {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly text: string
}

export interface TryWorld {
  readonly world: TestServer
  readonly fake: FakeGoogle
  readonly port: number
  readonly phonePort: number
  readonly decoyPort: number
  readonly appOrigin: string
  readonly here: string
  /** 안쪽 서버(127.0.0.1:<포트>)에 닿은 요청 (방법 경로) */
  readonly inner: string[]
  /** 미끼 서버에 닿은 요청 */
  readonly decoyHits: string[]
  /** 휴대폰 주소 경로(here 뒤)로 https 요청. headers는 그대로 더한다(host 포함 덮어쓰기 가능) */
  phone(method: string, path: string, options?: { cookie?: string; body?: string | Buffer; headers?: Record<string, string>; chunked?: boolean }): Promise<Reply>
  /** 이 컴퓨터(http://localhost:<포트>)로 요청 */
  local(method: string, path: string, options?: { cookie?: string; body?: unknown }): Promise<Reply>
  /** 휴대폰 https 포트로 요청 줄·머리글을 글자 그대로 보낸다 (latin1 바이트) */
  raw(requestLine: string, headers?: Record<string, string>): Promise<{ status: number; head: string; body: string }>
  /** 로그인하고 세션 쿠키 */
  phoneLogin(): Promise<string>
  localLogin(): Promise<string>
  close(): Promise<void>
}

const listen = (server: HttpServer | HttpsServer): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })

export const sessionOf = (reply: Reply): string => {
  const raw = reply.headers['set-cookie']
  const all = Array.isArray(raw) ? raw.join('; ') : (raw ?? '')
  const match = /lj_session=([^;]+)/.exec(all)
  if (match === null) throw new Error(`세션 쿠키가 없다 (${String(reply.status)} ${reply.text})`)
  return `lj_session=${match[1] ?? ''}`
}
export const json = (reply: Reply): Record<string, unknown> => JSON.parse(reply.text) as Record<string, unknown>

export async function tryWorld(mode: { real: boolean }): Promise<TryWorld> {
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

  const decoyHits: string[] = []
  const decoy = createPlainServer((req, res) => {
    decoyHits.push(`${req.method ?? ''} ${req.url ?? ''}`)
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('decoy')
  })
  const decoyPort = await listen(decoy)

  const relayOrigins: string[] = []
  let relay: ReturnType<typeof createPhoneRelay> | null = null
  const phoneServer = createHttpsServer({ key: CERT.key, cert: CERT.cert }, (req, res) => relay?.(req, res))
  const phonePort = await listen(phoneServer)
  const here = `https://${PHONE_IP}:${String(phonePort)}`
  relayOrigins.push(here, `https://localhost:${String(phonePort)}`)
  relay = createPhoneRelay({ port, appOrigin, httpsOrigins: relayOrigins, fakeGoogle: mode.real ? null : { port: fake.port }, realYoutube: mode.real })
  const agent = new HttpsAgent({ keepAlive: true, maxSockets: 8, rejectUnauthorized: false })

  const collect =
    (resolve: (reply: Reply) => void, reject: (error: unknown) => void) =>
    (answer: IncomingMessage): void => {
      const chunks: Buffer[] = []
      answer.on('data', (chunk: Buffer) => chunks.push(chunk))
      answer.on('end', () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, text: Buffer.concat(chunks).toString('utf8') }))
      answer.on('error', reject)
    }

  const item: TryWorld = {
    world,
    fake,
    port,
    phonePort,
    decoyPort,
    appOrigin,
    here,
    inner,
    decoyHits,
    phone: (method, path, options = {}) =>
      new Promise((resolve, reject) => {
        const headers: Record<string, string> = { host: `${PHONE_IP}:${String(phonePort)}`, origin: here }
        if (options.cookie !== undefined) headers.cookie = options.cookie
        const body = options.body
        if (body !== undefined && options.chunked !== true) headers['content-length'] = String(Buffer.byteLength(body))
        Object.assign(headers, options.headers ?? {})
        const outgoing = httpsRequest({ host: '127.0.0.1', port: phonePort, method, path, headers, agent }, collect(resolve, reject))
        outgoing.on('error', reject)
        if (body !== undefined) outgoing.write(body)
        outgoing.end()
      }),
    local: (method, path, options = {}) =>
      new Promise((resolve, reject) => {
        const body = options.body === undefined ? null : JSON.stringify(options.body)
        const headers: Record<string, string> = { host: `localhost:${String(port)}`, origin: appOrigin }
        if (options.cookie !== undefined) headers.cookie = options.cookie
        if (body !== null) {
          headers['content-type'] = 'application/json'
          headers['content-length'] = String(Buffer.byteLength(body))
        }
        const outgoing = httpRequest({ host: '127.0.0.1', port, method, path, headers }, collect(resolve, reject))
        outgoing.on('error', reject)
        outgoing.end(body ?? undefined)
      }),
    raw: (requestLine, headers = {}) =>
      new Promise((resolve, reject) => {
        const socket = tlsConnect({ host: '127.0.0.1', port: phonePort, rejectUnauthorized: false, servername: 'localhost' }, () => {
          const all: Record<string, string> = { host: `${PHONE_IP}:${String(phonePort)}`, connection: 'close', ...headers }
          const head = `${requestLine}\r\n${Object.entries(all)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n')}\r\n\r\n`
          socket.write(Buffer.from(head, 'latin1'))
        })
        const chunks: Buffer[] = []
        // 응답이 다 오면 바로 끊는다 — 중계가 위쪽의 keep-alive 머리글을 그대로 옮겨 connection: close를 보내도 연결이 남는다
        const complete = (all: Buffer): boolean => {
          const split = all.indexOf('\r\n\r\n')
          if (split < 0) return false
          const head = all.subarray(0, split).toString('latin1')
          if (/^HTTP\/1\.[01] (1\d\d|204|304)/.test(head)) return true
          const length = /\r\ncontent-length: *(\d+)/i.exec(head)
          if (length !== null) return all.length - split - 4 >= Number(length[1])
          if (/\r\ntransfer-encoding: *chunked/i.test(head)) return all.subarray(split + 4).includes('0\r\n\r\n')
          return false
        }
        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          if (complete(Buffer.concat(chunks))) socket.destroy()
        })
        socket.on('error', reject)
        socket.on('close', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const match = /^HTTP\/1\.[01] (\d{3})/.exec(text)
          const split = text.indexOf('\r\n\r\n')
          resolve({ status: match === null ? 0 : Number(match[1]), head: split < 0 ? text : text.slice(0, split), body: split < 0 ? '' : text.slice(split + 4) })
        })
      }),
    phoneLogin: async () => {
      const body = JSON.stringify({ loginId: 'practice', password: 'try-pass-1234' })
      const reply = await item.phone('POST', '/api/login', { body, headers: { 'content-type': 'application/json' } })
      return sessionOf(reply)
    },
    localLogin: async () => sessionOf(await item.local('POST', '/api/login', { body: { loginId: 'practice', password: 'try-pass-1234' } })),
    close: async () => {
      agent.destroy()
      phoneServer.closeAllConnections()
      http.closeAllConnections()
      decoy.closeAllConnections()
      await Promise.all([new Promise((resolve) => phoneServer.close(resolve)), new Promise((resolve) => http.close(resolve)), new Promise((resolve) => decoy.close(resolve))])
      world.server.close()
      await world.server.stop().catch(() => {})
      await fake.close()
      await database.close().catch(() => {})
    },
  }
  return item
}
