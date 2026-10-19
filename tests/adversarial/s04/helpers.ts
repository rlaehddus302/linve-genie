// S04 적대 테스트 공용 도구 (test-domain). 서버를 프로세스 안에서 PGlite(메모리)로 띄우고 /api를 포트 없이 부른다.
// 마스터 키는 시험 안에서 만들고, 비밀번호 해시 비용은 낮춘다(dev-notes "시험용 기동과 주입점").
import { createSellerAccount, createServer, generateMasterKey, openPglite, type Database, type LivejjimServer, type LogRecord, type ServerOptions } from '@livejjim/server'

export const ORIGIN = 'https://app.test'
export const COST = { N: 1024, r: 8, p: 1 } as const
/** 2026-10-18 20:00 KST */
export const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

export interface Clock {
  t: number
  now(): number
}

export function clockAt(t = T0): Clock {
  return {
    t,
    now() {
      return this.t
    },
  }
}

export interface Harness {
  readonly database: Database
  readonly masterKey: string
  readonly clock: Clock
  readonly logs: LogRecord[]
  server: LivejjimServer
  /** 같은 DB로 새 인스턴스 (재시작·두 번째 인스턴스) */
  restart(extra?: Partial<ServerOptions>): LivejjimServer
  account(loginId: string, shopName?: string): Promise<{ sellerId: string; cookie: string; loginId: string }>
  login(loginId: string, password?: string): Promise<string>
  close(): Promise<void>
}

export const PASSWORD = 'pass-word-1'

export async function harness(extra: Partial<ServerOptions> = {}): Promise<Harness> {
  const database = await openPglite()
  const masterKey = generateMasterKey()
  const clock = clockAt()
  const logs: LogRecord[] = []
  const make = (more: Partial<ServerOptions> = {}): LivejjimServer =>
    createServer({ database, masterKey, appOrigin: ORIGIN, passwordCost: COST, clock, log: (r) => logs.push(r), ...extra, ...more })
  const servers: LivejjimServer[] = []
  const h: Harness = {
    database,
    masterKey,
    clock,
    logs,
    server: make(),
    restart(more) {
      const s = make(more)
      servers.push(s)
      return s
    },
    async login(loginId, password = PASSWORD) {
      const res = await h.server.app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
      const cookie = /lj_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0]
      if (cookie === undefined) throw new Error(`로그인 실패 ${String(res.status)} ${await res.text()}`)
      return cookie
    },
    async account(loginId, shopName = '가게') {
      const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName, loginId, password: PASSWORD }, { passwordCost: COST })
      if (!created.ok) throw new Error(created.message)
      return { sellerId: created.sellerId, cookie: await h.login(loginId), loginId }
    },
    async close() {
      h.server.close()
      for (const s of servers) s.close()
      await database.close()
    },
  }
  servers.push(h.server)
  return h
}

export interface Res {
  status: number
  body: Record<string, unknown>
  text: string
  headers: Headers
}

/** /api 호출 (상태를 바꾸는 요청은 Origin·JSON을 붙인다) */
export async function call(server: LivejjimServer, cookie: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const h: Record<string, string> = { ...headers }
  if (cookie !== null) h.Cookie = cookie
  const init: RequestInit = { method, headers: h }
  if (method !== 'GET' && method !== 'HEAD') {
    h.Origin ??= ORIGIN
    h['Content-Type'] ??= 'application/json'
    init.body = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  }
  const res = await server.app.request(path, init)
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // SSE 등
  }
  return { status: res.status, body: parsed, text, headers: res.headers }
}

let counter = 0
export const rid = (prefix = 'r'): string => `${prefix}${String(++counter)}`

export async function startBroadcast(server: LivejjimServer, cookie: string, date: string, title?: string): Promise<string> {
  const res = await call(server, cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date, ...(title === undefined ? {} : { title }) })
  if (res.status !== 200) throw new Error(`방송 만들기 실패 ${String(res.status)} ${res.text}`)
  return (res.body.broadcast as { id: string }).id
}

export async function event(server: LivejjimServer, cookie: string, body: Record<string, unknown>, date?: string): Promise<Res> {
  return call(server, cookie, 'POST', `/api/events${date === undefined ? '' : `?date=${date}`}`, { requestId: rid('ev'), ...body })
}

/** PGlite 전체 테이블을 텍스트로 (개인정보 검색용) */
export async function dumpAll(database: Database): Promise<string> {
  const pglite = database.pglite
  if (pglite === null) throw new Error('PGlite가 아니다')
  const tables = (await pglite.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'")).rows
  let out = ''
  for (const { tablename } of tables) {
    const rows = (await pglite.query(`select * from "${tablename}"`)).rows
    out += `${tablename}\n${JSON.stringify(rows)}\n`
  }
  return out
}
