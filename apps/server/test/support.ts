// 서버 시험 도우미 (S04). 포트를 열지 않는다: PGlite(메모리)에 마이그레이션을 적용하고 app.request(...)로 요청한다.
// 마스터 키는 시험 안에서 만든다(소스에 고정한 값이 아니다, AC-S04-32).
import type { PGlite } from '@electric-sql/pglite'
import { expect } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { openPglite, type Database } from '../src/db/database.ts'
import type { LogRecord } from '../src/log.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { createServer, type LivejjimServer, type ServerOptions } from '../src/server.ts'

export const ORIGIN = 'https://app.livejjim.test'
/** 시험용 비밀번호 해시 비용 (빠르게) */
export const FAST_COST = { N: 2 ** 10, r: 8, p: 1 } as const
/** 2026-10-19 12:00:00 KST */
export const T0 = Date.UTC(2026, 9, 19, 3, 0, 0)

/** 마이그레이션까지 마친 PGlite 하나를 파일마다 만들어 두고, 시험마다 복제한다 */
let template: Promise<Database> | null = null

export async function openTestDb(): Promise<Database> {
  template ??= openPglite()
  const base = await template
  const clone = (await (base.pglite as PGlite).clone()) as PGlite
  return openPglite(clone)
}

export interface FakeClock {
  now(): number
  set(ms: number): void
  advance(ms: number): void
}

export function fakeClock(start = T0): FakeClock {
  let t = start
  return {
    now: () => t,
    set: (ms) => {
      t = ms
    },
    advance: (ms) => {
      t += ms
    },
  }
}

export interface TestServer {
  readonly server: LivejjimServer
  readonly database: Database
  readonly masterKey: string
  readonly clock: FakeClock
  readonly logs: LogRecord[]
}

export function startServer(database: Database, masterKey: string, overrides: Partial<ServerOptions> & { clock?: FakeClock } = {}): TestServer {
  const clock = overrides.clock ?? fakeClock()
  const logs: LogRecord[] = []
  const server = createServer({
    database,
    masterKey,
    appOrigin: ORIGIN,
    passwordCost: FAST_COST,
    log: (record) => logs.push(record),
    ...overrides,
    clock,
  })
  return { server, database, masterKey, clock, logs }
}

export async function newWorld(overrides: Partial<ServerOptions> & { clock?: FakeClock } = {}): Promise<TestServer> {
  const database = await openTestDb()
  return startServer(database, generateMasterKey(), overrides)
}

export interface Seller {
  readonly sellerId: string
  readonly accountId: string
  readonly loginId: string
  readonly password: string
  readonly cookie: string
}

let accountCounter = 0

export async function addSeller(world: TestServer, loginId = `shop${String(++accountCounter)}`, password = 'correct-horse-1'): Promise<Seller> {
  const created = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), { shopName: `가게 ${loginId}`, loginId, password }, { passwordCost: FAST_COST })
  if (!created.ok) throw new Error(created.message)
  const cookie = await login(world, loginId, password)
  return { sellerId: created.sellerId, accountId: created.accountId, loginId, password, cookie }
}

export async function login(world: TestServer, loginId: string, password: string): Promise<string> {
  const response = await world.server.app.request('/api/login', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = /lj_session=([^;]+)/.exec(setCookie)
  if (match === null) throw new Error('세션 쿠키가 없다')
  return `lj_session=${match[1] ?? ''}`
}

export interface JsonResponse {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly text: string
  readonly headers: Headers
}

async function toJson(response: Response): Promise<JsonResponse> {
  const text = await response.text()
  let body: Record<string, unknown>
  try {
    body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  } catch {
    body = {}
  }
  return { status: response.status, body, text, headers: response.headers }
}

export function client(world: TestServer, cookie: string | null) {
  const headers = (extra: Record<string, string> = {}) => ({ ...(cookie === null ? {} : { Cookie: cookie }), ...extra })
  return {
    get: async (path: string) => toJson(await world.server.app.request(path, { headers: headers() })),
    post: async (path: string, body: unknown) =>
      toJson(await world.server.app.request(path, { method: 'POST', headers: headers({ Origin: ORIGIN, 'Content-Type': 'application/json' }), body: JSON.stringify(body) })),
    patch: async (path: string, body: unknown) =>
      toJson(await world.server.app.request(path, { method: 'PATCH', headers: headers({ Origin: ORIGIN, 'Content-Type': 'application/json' }), body: JSON.stringify(body) })),
    put: async (path: string, body: unknown) =>
      toJson(await world.server.app.request(path, { method: 'PUT', headers: headers({ Origin: ORIGIN, 'Content-Type': 'application/json' }), body: JSON.stringify(body) })),
    raw: (path: string, init: RequestInit) => world.server.app.request(path, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) } }),
  }
}

let requestCounter = 0
export const rid = (prefix = 'req') => `${prefix}-${String(++requestCounter)}`

/** 방송 만들기 (성공을 기대한다) */
export async function createBroadcast(
  world: TestServer,
  seller: Seller,
  input: { date?: string; title?: string; rehearsal?: boolean } = {},
): Promise<{ id: string; date: string; seq: number; rehearsal: boolean }> {
  const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), ...input })
  expect(response.status, response.text).toBe(200)
  const broadcast = response.body.broadcast as { id: string; date: string; rehearsal: boolean }
  return { id: broadcast.id, date: broadcast.date, seq: response.body.seq as number, rehearsal: broadcast.rehearsal }
}

/** 기다리지 않는 생성기 타이머: 예약한 일을 다음 매크로 작업에서 바로 돌린다 (시험이 실제 시간을 기다리지 않는다) */
export const immediateTimer = {
  schedule(_ms: number, fn: () => void): () => void {
    const handle = setImmediate(fn)
    return () => clearImmediate(handle)
  },
}

/** 손으로 돌리는 생성기 타이머: 예약한 일을 모아 두고 runNext()로 하나씩 돌린다 */
export function manualTimer() {
  const queue: { ms: number; fn: () => void; cancelled: boolean }[] = []
  return {
    schedule(ms: number, fn: () => void): () => void {
      const job = { ms, fn, cancelled: false }
      queue.push(job)
      return () => {
        job.cancelled = true
      }
    },
    /** 예약된(취소되지 않은) 일 수 */
    get pending(): number {
      return queue.filter((job) => !job.cancelled).length
    },
    /** 마지막으로 예약된 지연 (밀리초) */
    get lastDelay(): number | null {
      return queue.at(-1)?.ms ?? null
    },
    runNext(): boolean {
      for (;;) {
        const job = queue.shift()
        if (job === undefined) return false
        if (job.cancelled) continue
        job.fn()
        return true
      }
    },
  }
}

/** 조건이 맞을 때까지 기다린다 (실제 시간 상한) */
export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났다')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** 이벤트 쓰기 */
export async function writeEvent(world: TestServer, seller: Seller, event: Record<string, unknown>, date?: string, rehearsal?: boolean): Promise<JsonResponse> {
  const query = [...(date === undefined ? [] : [`date=${date}`]), ...(rehearsal === undefined ? [] : [`rehearsal=${String(rehearsal)}`])]
  return client(world, seller.cookie).post(`/api/events${query.length === 0 ? '' : `?${query.join('&')}`}`, { requestId: rid('ev'), ...event })
}

export async function expectOk(promise: Promise<JsonResponse>): Promise<JsonResponse> {
  const response = await promise
  expect(response.status, response.text).toBe(200)
  return response
}

/** DB의 행 수 */
export async function countRows(database: Database, table: 'events' | 'outbox' | 'snapshots' | 'scopes' | 'broadcasts' | 'sessions'): Promise<number> {
  const result = await (database.pglite as PGlite).query<{ n: number }>(`select count(*)::int as n from ${table}`)
  return result.rows[0]?.n ?? 0
}

/** DB 전체를 문자열로 (모든 사용자 테이블의 모든 행) */
export async function dumpAllTables(database: Database): Promise<string> {
  const pg = database.pglite as PGlite
  const tables = await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)
  const parts: string[] = []
  for (const { table_name } of tables.rows) {
    const rows = await pg.query(`select * from "${table_name}"`)
    parts.push(`${table_name}:${JSON.stringify(rows.rows)}`)
  }
  return parts.join('\n')
}

/** SSE 응답을 읽는 도우미: 받은 이벤트를 모은다 */
export function sseReader(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  const events: { event: string; id: string | null; data: string; receivedAt: number }[] = []
  const comments: string[] = []
  let buffer = ''
  let closed = false
  const waiters: (() => void)[] = []
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        closed = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let split = buffer.indexOf('\n\n')
      while (split >= 0) {
        const block = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        let event = 'message'
        let id: string | null = null
        const data: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) comments.push(line)
          else if (line.startsWith('event: ')) event = line.slice(7)
          else if (line.startsWith('id: ')) id = line.slice(4)
          else if (line.startsWith('data: ')) data.push(line.slice(6))
        }
        if (data.length > 0) events.push({ event, id, data: data.join('\n'), receivedAt: performance.now() })
        split = buffer.indexOf('\n\n')
      }
      for (const wake of waiters.splice(0)) wake()
    }
    for (const wake of waiters.splice(0)) wake()
  }
  const done = pump().catch(() => {
    closed = true
  })
  return {
    events,
    comments,
    get closed() {
      return closed
    },
    done,
    /** 조건이 맞을 때까지 기다린다 */
    async until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (closed || Date.now() > deadline) {
          if (predicate()) return
          throw new Error('SSE 조건을 기다리다 시간이 지났다')
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, 20)
        })
      }
    },
    cancel: () => reader.cancel(),
  }
}

/**
 * 이벤트 본문 SQL 조각 (AC-Y1-60): Y1부터 채팅의 본문·이름은 chat_raw에 따로 둔다 — 시험이 DB 로그를 직접 재생할 때 둘을 합친다.
 * `from events e ${RAW_JOIN}`과 함께 `${MERGED_BODY} as body`로 쓴다
 */
export const RAW_JOIN = 'left join chat_raw r on r.scope_id = e.scope_id and r.seq = e.seq and r.seller_id = e.seller_id'
export const MERGED_BODY = `case when e.raw then (e.body::jsonb || jsonb_build_object('nick', r.nick, 'text', r.text))::text else e.body end`
