// 밴드 시험 도우미 (BND1). 가짜 밴드 서버(127.0.0.1)·주입한 가짜 시계(서버 시계와 읽기 일정 시계가 같다)로 서버를 띄운다.
import { expect } from 'vitest'
import type { Database } from '../src/db/database.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { ServerOptions } from '../src/server.ts'
import { FakeBand } from '../src/band/fake.ts'
import type { BandHooks, BandTiming } from '../src/band/service.ts'
import type { BandClock } from '../src/band/service.ts'
import { ORIGIN, T0, addSeller, client, openTestDb, rid, startServer, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

export { DATE, chats, realBroadcast } from './tiktok-live-support.ts'

export const REDIRECT = `${ORIGIN}/api/band/callback`

/**
 * 읽기 일정의 가짜 시계: 타이머를 시각 순서대로 하나씩 부르고, 부를 때마다 settle(읽기가 끝날 때까지)을 기다린다.
 * 앞 읽기가 끝난 뒤에야 다음 타이머가 걸리므로 하나씩 기다려야 10초·60초 일정이 실제처럼 돈다
 */
export class StepClock implements BandClock {
  #now: number
  #seq = 0
  #timers: { seq: number; at: number; fn: () => void }[] = []
  settle: () => Promise<void> = async () => undefined

  constructor(start = T0) {
    this.#now = start
  }

  now(): number {
    return this.#now
  }

  setTimer(ms: number, fn: () => void): () => void {
    const timer = { seq: (this.#seq += 1), at: this.#now + Math.max(0, ms), fn }
    this.#timers.push(timer)
    return () => {
      this.#timers = this.#timers.filter((t) => t !== timer)
    }
  }

  get pendingTimers(): number {
    return this.#timers.length
  }

  /** ms 뒤까지: 그 사이 타이머를 하나씩 부르고 매번 settle */
  async advance(ms: number): Promise<void> {
    const target = this.#now + Math.max(0, ms)
    await this.settle()
    for (;;) {
      let next: { seq: number; at: number; fn: () => void } | undefined
      for (const t of this.#timers) if (t.at <= target && (next === undefined || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t
      if (next === undefined) break
      const due = next
      this.#timers = this.#timers.filter((t) => t !== due)
      this.#now = Math.max(this.#now, due.at)
      due.fn()
      await this.settle()
    }
    this.#now = Math.max(this.#now, target)
  }

  /** 타이머를 부르지 않고 시각만 (진행 중인 읽기를 기다리지 않는 시험) */
  jump(ms: number): void {
    this.#now += ms
  }

  /** 기다리지 않고 지금 걸린 것 중 ms 안의 타이머만 부른다 (읽기가 진행 중인 채로 — 겹침 시험) */
  fire(ms: number): void {
    const target = this.#now + ms
    for (const t of [...this.#timers].sort((a, b) => a.at - b.at || a.seq - b.seq)) {
      if (t.at > target) break
      this.#timers = this.#timers.filter((x) => x !== t)
      this.#now = Math.max(this.#now, t.at)
      t.fn()
    }
    this.#now = Math.max(this.#now, target)
  }
}

export interface BandWorld extends TestServer {
  readonly fake: FakeBand
  readonly bclock: StepClock
  /** 받은 SSE band 알림 */
  readonly published: { sellerId: string; data: Record<string, unknown> }[]
  close(): Promise<void>
}

export interface BandWorldOptions {
  readonly database?: Database
  readonly masterKey?: string
  readonly fake?: FakeBand
  readonly bclock?: StepClock
  /** 밴드 설정 없음 (NOT_CONFIGURED) */
  readonly notConfigured?: boolean
  readonly timeoutMs?: number
  readonly timing?: Partial<BandTiming>
  readonly hooks?: BandHooks
  readonly overrides?: Partial<ServerOptions>
}

export async function bandWorld(options: BandWorldOptions = {}): Promise<BandWorld> {
  const bclock = options.bclock ?? new StepClock(T0)
  const fake = options.fake ?? (await FakeBand.start({ now: () => bclock.now() }))
  const database = options.database ?? (await openTestDb())
  const masterKey = options.masterKey ?? generateMasterKey()
  const clock: FakeClock = { now: () => bclock.now(), set: () => undefined, advance: () => undefined }
  const world = startServer(database, masterKey, {
    clock,
    band: {
      settings: options.notConfigured === true ? null : fake.settings({ redirectUri: REDIRECT, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }),
      clock: bclock,
      ...(options.timing === undefined ? {} : { timing: options.timing }),
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    },
    ...(options.overrides as Partial<ServerOptions> & { clock?: FakeClock }),
  })
  bclock.settle = async () => {
    for (let i = 0; i < 3; i += 1) {
      await world.server.band.idle()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  const published: { sellerId: string; data: Record<string, unknown> }[] = []
  const original = world.server.hub.publishBand.bind(world.server.hub)
  world.server.hub.publishBand = (sellerId, data) => {
    published.push({ sellerId, data: data as Record<string, unknown> })
    original(sellerId, data)
  }
  return {
    ...world,
    fake,
    bclock,
    published,
    close: async () => {
      world.server.close()
      await world.server.band.idle()
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (options.fake === undefined) await fake.close()
      if (options.database === undefined) await database.close()
    },
  }
}

/** 같은 DB·같은 가짜 밴드로 서버를 하나 더 (다시 켜기) — 앞 서버는 닫는다 */
export async function restartBand(world: BandWorld, options: BandWorldOptions = {}): Promise<BandWorld> {
  world.server.close()
  await world.server.band.idle()
  return bandWorld({ database: world.database, masterKey: world.masterKey, fake: world.fake, bclock: world.bclock, ...options })
}

/** 가짜 시계를 ms만큼 돌리고 읽기가 끝날 때까지 */
export async function tick(world: BandWorld, ms: number): Promise<void> {
  await world.bclock.advance(ms)
  await world.bclock.advance(0)
}

/** 연결 시작 → 가짜 승인 창 → 돌아오기. 돌려주는 값 = ?band=<결과> */
export async function connectBand(world: BandWorld, seller: Seller): Promise<string> {
  const started = await client(world, seller.cookie).post('/api/band/connect', {})
  expect(started.status, started.text).toBe(200)
  const back = await approve(world, started.body.url as string)
  return callback(world, seller, back)
}

/** 승인 창을 열어 돌아오는 주소(경로+질의)를 받는다 */
export async function approve(world: BandWorld, url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'manual' })
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') as string)
  expect(location.origin).toBe(ORIGIN)
  return `${location.pathname}${location.search}`
}

/** 돌아오기를 그 판매자 세션으로 (결과 코드) */
export async function callback(world: BandWorld, seller: Seller | null, path: string): Promise<string> {
  const response = await client(world, seller?.cookie ?? null).raw(path, { method: 'GET' })
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') as string)
  expect(`${location.origin}${location.pathname}`).toBe(`${ORIGIN}/settings/band`)
  return location.searchParams.get('band') ?? ''
}

export interface BandSeller {
  readonly seller: Seller
  readonly userKey: string
  readonly bandKey: string
}

/** 판매자 하나: 가짜 밴드 사용자·밴드(판매자와 손님 둘)·계정 연결 */
export async function bandSeller(world: BandWorld, options: { readonly seller?: Seller; readonly name?: string; readonly userKey?: string } = {}): Promise<BandSeller> {
  const seller = options.seller ?? (await addSeller(world))
  const userKey = world.fake.addUser(options.name ?? '다육가게', options.userKey)
  const bandKey = world.fake.addBand({ name: '다육 공구방', members: [userKey] })
  world.fake.nextLogin({ decision: 'approve', userKey })
  expect(await connectBand(world, seller)).toBe('connected')
  return { seller, userKey, bandKey }
}

export async function linkBand(world: TestServer, seller: Seller, b: string, bandKey: string, postKey: string, requestId = rid('bl')): Promise<JsonResponse> {
  return client(world, seller.cookie).post(`/api/broadcasts/${b}/band/link`, { requestId, bandKey, postKey })
}

export async function unlinkBand(world: TestServer, seller: Seller, b: string, requestId = rid('bu')): Promise<JsonResponse> {
  return client(world, seller.cookie).post(`/api/broadcasts/${b}/band/unlink`, { requestId })
}

export async function bandView(world: TestServer, seller: Seller, b: string): Promise<Record<string, unknown>> {
  const view = await client(world, seller.cookie).get(`/api/broadcasts/${b}/band`)
  expect(view.status, view.text).toBe(200)
  return view.body.link as Record<string, unknown>
}

let nextGuest = 0
/** 손님 댓글 하나 (기본: 새 손님) */
export function guestComment(world: BandWorld, postKey: string, content: string, options: { readonly userKey?: string | null; readonly name?: string; readonly createdAt?: number } = {}): string {
  nextGuest += 1
  const userKey = options.userKey === undefined ? `GUEST${String(nextGuest)}` : options.userKey
  return world.fake.addComment(postKey, { content, userKey, name: options.name ?? `손님${String(nextGuest)}`, ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }) }) as string
}
