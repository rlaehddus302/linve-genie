// Y1 적대 테스트 공용 도구 (test-domain). 가짜 구글·유튜브 서버(127.0.0.1) + 주입한 시계(ManualTimer) + 서버(PGlite 메모리).
// 실제 구글 주소로 나가는 요청은 막는다(installGoogleBlock). 워커(수집기·발송함·봉인)는 시험이 직접 돌린다.
import {
  FakeGoogle,
  ManualTimer,
  createSellerAccount,
  createServer,
  generateMasterKey,
  installGoogleBlock,
  openPglite,
  settle,
  type Database,
  type FakeChannel,
  type LivejjimServer,
  type LogRecord,
  type ServerOptions,
} from '@livejjim/server'
import { expect } from 'vitest'

installGoogleBlock()

export const ORIGIN = 'https://app.livejjim.test'
export const API_ORIGIN = 'https://api.livejjim.test'
export const RETURN_URL = 'https://app.livejjim.test/settings/youtube'
const COST = { N: 1024, r: 8, p: 1 } as const
/** 2026-10-19 20:00 KST */
export const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')
export const NO_LABEL = { 'print.autoOnConfirm': false }

export interface World {
  readonly database: Database
  readonly masterKey: string
  readonly fake: FakeGoogle
  readonly timer: ManualTimer
  readonly logs: LogRecord[]
  server: LivejjimServer
  sibling(name: string, extra?: Partial<ServerOptions>): LivejjimServer
  close(): Promise<void>
}

export async function world(options: { start?: number; extra?: Partial<ServerOptions> } = {}): Promise<World> {
  const timer = new ManualTimer(options.start ?? EIGHT_PM)
  const fake = await FakeGoogle.start({ now: () => timer.now(), pollingIntervalMillis: 1000 })
  const database = await openPglite()
  const masterKey = generateMasterKey()
  const logs: LogRecord[] = []
  const servers: LivejjimServer[] = []
  const make = (name: string, extra: Partial<ServerOptions> = {}): LivejjimServer => {
    const s = createServer({
      database,
      masterKey,
      appOrigin: ORIGIN,
      passwordCost: COST,
      clock: timer,
      timer,
      instanceName: name,
      log: (record) => logs.push(record),
      collectorTiming: { leaseMs: 20_000, renewMs: 5000, scanMs: 5000 },
      youtube: {
        clientId: fake.clientId,
        clientSecret: fake.clientSecret,
        redirectUri: `${API_ORIGIN}/api/youtube/oauth/callback`,
        returnUrl: RETURN_URL,
        endpoints: fake.endpoints(),
        allowInsecure: true,
      },
      ...options.extra,
      ...extra,
    })
    servers.push(s)
    return s
  }
  const w: World = {
    database,
    masterKey,
    fake,
    timer,
    logs,
    server: make('A'),
    sibling: (name, extra) => make(name, extra),
    async close() {
      for (const s of servers) {
        s.close()
        await s.stop().catch(() => {})
      }
      await fake.close()
      await database.close()
    },
  }
  return w
}

export interface JsonRes {
  status: number
  body: Record<string, unknown>
  text: string
  headers: Headers
}

async function toJson(res: Response): Promise<JsonRes> {
  const text = await res.text()
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = {}
  }
  return { status: res.status, body, text, headers: res.headers }
}

export function api(server: LivejjimServer, cookie: string | null) {
  const headers = (extra: Record<string, string> = {}) => ({ ...(cookie === null ? {} : { Cookie: cookie }), ...extra })
  const send = async (method: string, path: string, body?: unknown) =>
    toJson(await server.app.request(path, { method, headers: headers(body === undefined ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json' }), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  return {
    get: (path: string) => send('GET', path),
    post: (path: string, body: unknown) => send('POST', path, body),
    put: (path: string, body: unknown) => send('PUT', path, body),
    patch: (path: string, body: unknown) => send('PATCH', path, body),
  }
}

let counter = 0
export const rid = (prefix = 'r') => `${prefix}-${String(++counter)}`

export interface Seller {
  readonly sellerId: string
  readonly cookie: string
}

export async function addSeller(w: World): Promise<Seller> {
  const loginId = `ytadv${String(++counter)}`
  const password = 'correct-horse-1'
  const created = await createSellerAccount(w.database.db, Buffer.from(w.masterKey, 'base64'), { shopName: `가게 ${loginId}`, loginId, password }, { passwordCost: COST })
  if (!created.ok) throw new Error(created.message)
  const res = await w.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
  const cookie = /lj_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0]
  if (cookie === undefined) throw new Error('로그인 실패')
  return { sellerId: created.sellerId, cookie }
}

export async function approve(authorizeUrl: string): Promise<string> {
  const response = await fetch(authorizeUrl, { redirect: 'manual' })
  const location = response.headers.get('location')
  if (location === null) throw new Error(`가짜 구글이 돌려보내지 않았다 (${String(response.status)})`)
  return new URL(location).search
}

export async function callback(server: LivejjimServer, cookie: string | null, search: string): Promise<string> {
  const response = await server.app.request(`/api/youtube/oauth/callback${search}`, { headers: cookie === null ? {} : { Cookie: cookie } })
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location') ?? 'https://x.invalid/').searchParams.get('youtube') ?? ''
}

export interface Connected {
  readonly seller: Seller
  readonly channel: FakeChannel
  readonly account: string
}

export async function connect(w: World, options: { publish?: boolean | 'LIVE_CHAT' | 'VIDEO_COMMENT'; seller?: Seller } = {}): Promise<Connected> {
  const seller = options.seller ?? (await addSeller(w))
  const account = w.fake.addAccount()
  const channel = w.fake.addChannel(account, '구피 가게')
  w.fake.approval = { account, channel: channel.id }
  const started = await api(w.server, seller.cookie).post('/api/youtube/connection/start', {})
  expect(started.status, started.text).toBe(200)
  expect(await callback(w.server, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  const targets = options.publish === true ? (['LIVE_CHAT', 'VIDEO_COMMENT'] as const) : options.publish === 'LIVE_CHAT' || options.publish === 'VIDEO_COMMENT' ? [options.publish] : []
  for (const target of targets) {
    const res = await api(w.server, seller.cookie).put('/api/youtube/consent', { target, enabled: true })
    expect(res.status, res.text).toBe(200)
    if (typeof res.body.authorizeUrl === 'string') expect(await callback(w.server, seller.cookie, await approve(res.body.authorizeUrl))).toBe('connected')
  }
  return { seller, channel, account }
}

export async function linked(w: World, c: Connected, options: { date?: string; settings?: Record<string, unknown> } = {}) {
  const client = api(w.server, c.seller.cookie)
  if (options.settings !== undefined) {
    const patched = await client.patch('/api/settings', { settings: options.settings })
    expect(patched.status, patched.text).toBe(200)
  }
  const created = await client.post('/api/broadcasts', { requestId: rid('bc'), ...(options.date === undefined ? {} : { date: options.date }) })
  expect(created.status, created.text).toBe(200)
  const b = created.body.broadcast as { id: string; date: string }
  const live = w.fake.addBroadcast(c.channel.id, { title: '라이브', status: 'live' })
  const res = await client.post(`/api/broadcasts/${b.id}/youtube`, { requestId: rid('link'), video: `https://www.youtube.com/watch?v=${live.videoId}` })
  expect(res.status, res.text).toBe(200)
  return { b, live, liveChatId: live.liveChatId as string }
}

export async function writeEvent(w: World, c: Connected, event: Record<string, unknown>, date?: string): Promise<JsonRes> {
  return api(w.server, c.seller.cookie).post(`/api/events${date === undefined ? '' : `?date=${date}`}`, { requestId: rid('ev'), ...event })
}

export async function ok(promise: Promise<JsonRes>): Promise<JsonRes> {
  const res = await promise
  expect(res.status, res.text).toBe(200)
  return res
}

export async function product(w: World, c: Connected, b: string, no: number, name: string, price: number): Promise<void> {
  await ok(writeEvent(w, c, { type: 'product.register', b, no, name, price }))
}

export async function chat(w: World, c: Connected, b: string, id: string, ch: string, nick: string, text: string): Promise<void> {
  const outcome = await w.server.ingestChat(c.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

export function outbox(w: World, server: LivejjimServer = w.server) {
  const yt = server.youtube
  if (yt === null) throw new Error('유튜브가 없다')
  return yt.outbox
}

export function collectors(w: World, server: LivejjimServer = w.server) {
  const yt = server.youtube
  if (yt === null) throw new Error('유튜브가 없다')
  return yt.collectors
}

/** 진행 중인 프로미스를 시계를 옮기며 끝까지 */
export async function drive<T>(w: World, promise: Promise<T>, step = 1000, max = 400): Promise<T> {
  let done = false
  let value: T | undefined
  let error: unknown
  let failed = false
  promise.then(
    (v) => {
      done = true
      value = v
    },
    (e: unknown) => {
      done = true
      failed = true
      error = e
    },
  )
  for (let i = 0; i < max && !done; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!done) await w.timer.advance(step)
  }
  if (!done) throw new Error('끝나지 않았다')
  if (failed) throw error
  return value as T
}

/** 조건이 될 때까지 (step > 0이면 시계를 옮기며) */
export async function until(w: World, predicate: () => boolean | Promise<boolean>, options: { step?: number; max?: number } = {}): Promise<void> {
  const max = options.max ?? 400
  for (let i = 0; i < max; i++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
    if ((options.step ?? 0) > 0) await w.timer.advance(options.step ?? 0)
    else await settle()
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

export interface Row {
  id: number
  target: string
  state: string
  reason: string | null
  text: string
  attempts: number
  buyer: string | null
  product: string | null
  messageId: string | null
}

export async function rows(w: World, c: Connected, date: string): Promise<Row[]> {
  const res = await api(w.server, c.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(res.status, res.text).toBe(200)
  return res.body.rows as Row[]
}

export async function query<T>(w: World, sql: string, params: unknown[] = []): Promise<T[]> {
  const pg = w.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  return (await pg.query<T>(sql, params)).rows
}

export async function eventTypes(w: World): Promise<string[]> {
  return (await query<{ type: string }>(w, 'select type from events order by id')).map((row) => row.type)
}

export async function dumpText(w: World): Promise<string> {
  const tables = await query<{ table_name: string }>(w, `select table_name from information_schema.tables where table_schema = 'public'`)
  let out = ''
  for (const { table_name } of tables) out += JSON.stringify(await query(w, `select * from "${table_name}"`))
  return out
}
