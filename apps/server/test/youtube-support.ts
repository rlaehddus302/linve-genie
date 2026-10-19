// 유튜브 시험 도우미 (Y1): 가짜 구글·유튜브 서버(127.0.0.1) + 주입한 시계(ManualTimer) + 서버.
// 실제 어댑터가 가짜 서버에 실제 통신 방식(HTTP·스트림)으로 붙는다 — 주소만 다르다(AC-Y1-20·80).
import { expect } from 'vitest'
import type { Database } from '../src/db/database.ts'
import type { LogRecord } from '../src/log.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { ServerOptions } from '../src/server.ts'
import { FakeGoogle, type FakeChannel } from '../src/youtube/fake-google.ts'
import type { YoutubeConfig } from '../src/youtube/system.ts'
import { ManualTimer, settle } from '../src/youtube/timer.ts'
import { T0, addSeller, client, createBroadcast, openTestDb, startServer, type FakeClock, type Seller, type TestServer } from './support.ts'

export const API_ORIGIN = 'https://api.livejjim.test'
export const RETURN_URL = 'https://app.livejjim.test/settings/youtube'

export interface YoutubeWorld extends TestServer {
  readonly fake: FakeGoogle
  readonly timer: ManualTimer
  readonly config: YoutubeConfig
}

export function youtubeConfig(fake: FakeGoogle): YoutubeConfig {
  return {
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    redirectUri: `${API_ORIGIN}/api/youtube/oauth/callback`,
    returnUrl: RETURN_URL,
    endpoints: fake.endpoints(),
    allowInsecure: true,
  }
}

/** 시계 하나로 가짜 서버와 우리 서버를 함께 (워커는 시험이 직접 돌린다 — start하지 않는다) */
export async function youtubeWorld(options: { start?: number; overrides?: Partial<ServerOptions>; database?: Database; masterKey?: string; fake?: FakeGoogle; timer?: ManualTimer } = {}): Promise<YoutubeWorld> {
  const timer = options.timer ?? new ManualTimer(options.start ?? T0)
  const fake = options.fake ?? (await FakeGoogle.start({ now: () => timer.now(), pollingIntervalMillis: 1000 }))
  const database = options.database ?? (await openTestDb())
  const masterKey = options.masterKey ?? generateMasterKey()
  const config = youtubeConfig(fake)
  const world = startServer(database, masterKey, {
    clock: timer as unknown as FakeClock,
    timer,
    youtube: config,
    instanceName: 'A',
    collectorTiming: { leaseMs: 20_000, renewMs: 5000, scanMs: 5000 },
    ...(options.overrides as Partial<ServerOptions> & { clock?: FakeClock }),
  })
  return { ...world, fake, timer, config }
}

/** 같은 DB·가짜 서버·시계로 서버를 하나 더 (재시작·인스턴스 둘) */
export function sibling(world: YoutubeWorld, name: string, overrides: Partial<ServerOptions> = {}): YoutubeWorld {
  const logs: LogRecord[] = []
  const other = startServer(world.database, world.masterKey, {
    clock: world.timer as unknown as FakeClock,
    timer: world.timer,
    youtube: world.config,
    instanceName: name,
    collectorTiming: { leaseMs: 20_000, renewMs: 5000, scanMs: 5000 },
    log: (record) => logs.push(record),
    ...(overrides as Partial<ServerOptions> & { clock?: FakeClock }),
  })
  return { ...other, logs, fake: world.fake, timer: world.timer, config: world.config }
}

/** 승인 주소 → 가짜 구글이 돌려보낸 돌아오는 주소의 쿼리 (?code=…&state=…) */
export async function approve(authorizeUrl: string): Promise<string> {
  const response = await fetch(authorizeUrl, { redirect: 'manual' })
  const location = response.headers.get('location')
  if (location === null) throw new Error(`가짜 구글이 돌려보내지 않았다 (${String(response.status)})`)
  return new URL(location).search
}

/** 돌아오는 주소를 부른다. 화면 주소로 보낸 결과 코드 (?youtube=) */
export async function callback(world: TestServer, cookie: string | null, search: string): Promise<string> {
  const response = await world.server.app.request(`/api/youtube/oauth/callback${search}`, { headers: cookie === null ? {} : { Cookie: cookie } })
  expect(response.status).toBe(302)
  const location = response.headers.get('location') ?? ''
  expect(location.startsWith(RETURN_URL)).toBe(true)
  return new URL(location).searchParams.get('youtube') ?? ''
}

export interface Connected {
  readonly seller: Seller
  readonly channel: FakeChannel
  readonly account: string
}

/** 판매자를 만들고 채널을 연결한다 (읽기 권한). publish면 게시 권한·동의(실시간 채팅·영상 댓글)까지 */
export async function connectSeller(world: YoutubeWorld, options: { publish?: boolean | 'LIVE_CHAT' | 'VIDEO_COMMENT'; seller?: Seller; channelTitle?: string } = {}): Promise<Connected> {
  const seller = options.seller ?? (await addSeller(world))
  const account = world.fake.addAccount()
  const channel = world.fake.addChannel(account, options.channelTitle ?? '구피 가게')
  world.fake.approval = { account, channel: channel.id }
  const api = client(world, seller.cookie)
  const started = await api.post('/api/youtube/connection/start', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  expect(await callback(world, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  const targets = options.publish === true ? (['LIVE_CHAT', 'VIDEO_COMMENT'] as const) : options.publish === 'LIVE_CHAT' || options.publish === 'VIDEO_COMMENT' ? [options.publish] : []
  for (const target of targets) await enableConsent(world, seller, target)
  return { seller, channel, account }
}

/** 게시 동의 켜기 (게시 권한이 없으면 승인을 거쳐서) */
export async function enableConsent(world: YoutubeWorld, seller: Seller, target: 'LIVE_CHAT' | 'VIDEO_COMMENT'): Promise<void> {
  const api = client(world, seller.cookie)
  const response = await api.put('/api/youtube/consent', { target, enabled: true })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  if (typeof response.body.authorizeUrl === 'string') {
    expect(await callback(world, seller.cookie, await approve(response.body.authorizeUrl))).toBe('connected')
  }
  const status = await api.get('/api/youtube/connection')
  const consent = (status.body.connection as { consent: Record<string, { enabled: boolean }> }).consent
  expect(consent[target === 'LIVE_CHAT' ? 'liveChat' : 'videoComment']?.enabled).toBe(true)
}

/** 라이브찜 방송 + 가짜 유튜브 방송을 만들고 잇는다 */
export async function linkedBroadcast(world: YoutubeWorld, connected: Connected, options: { date?: string; title?: string; settings?: Record<string, unknown> } = {}) {
  if (options.settings !== undefined) {
    const patched = await client(world, connected.seller.cookie).patch('/api/settings', { settings: options.settings })
    expect(patched.status, JSON.stringify(patched.body)).toBe(200)
  }
  const b = await createBroadcast(world, connected.seller, { ...(options.date === undefined ? {} : { date: options.date }) })
  const live = world.fake.addBroadcast(connected.channel.id, { title: options.title ?? '라이브', status: 'live' })
  const linked = await client(world, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube`, { requestId: `link-${b.id}`, video: `https://www.youtube.com/watch?v=${live.videoId}` })
  expect(linked.status, JSON.stringify(linked.body)).toBe(200)
  return { b, live, liveChatId: live.liveChatId as string }
}

/** 조건이 될 때까지 시계를 step씩 옮기며 기다린다 (실제 I/O가 돌 틈을 준다) */
export async function until(world: YoutubeWorld, predicate: () => boolean | Promise<boolean>, options: { step?: number; max?: number; realMs?: number } = {}): Promise<void> {
  const step = options.step ?? 0
  const max = options.max ?? 400
  for (let i = 0; i < max; i++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, options.realMs ?? 5))
    if (step > 0) await world.timer.advance(step)
    else await settle()
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

/** 진행 중인 프로미스를 시계를 옮기며 끝까지 */
export async function drive<T>(world: YoutubeWorld, promise: Promise<T>, step = 1000, max = 400): Promise<T> {
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
    if (!done) await world.timer.advance(step)
  }
  if (!done) throw new Error('끝나지 않았다')
  if (failed) throw error
  return value as T
}

/** DB 전체(모든 표의 모든 글 열)를 덤프한 문자열 */
export async function dumpText(world: TestServer): Promise<string> {
  const pg = world.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  const tables = await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)
  let out = ''
  for (const { table_name } of tables.rows) {
    const rows = await pg.query(`select * from "${table_name}"`)
    out += JSON.stringify(rows.rows)
  }
  return out
}
