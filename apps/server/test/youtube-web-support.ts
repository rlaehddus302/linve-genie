// 서버 웹 읽기 시험 도우미 (YT-11): 가짜 유튜브 웹 서버(127.0.0.1) + 주입한 시계(ManualTimer) + 서버.
// 구글 OAuth 설정이 없는 서버(방송 주소만으로 읽기)가 기본이다. 구글 연결이 함께 있는 서버는 google: true로 가짜 구글도 띄운다.
import { expect } from 'vitest'
import type { Database } from '../src/db/database.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { ServerOptions } from '../src/server.ts'
import { FakeGoogle } from '../src/youtube/fake-google.ts'
import { FakeYoutubeWeb, type FakeWebVideo } from '../src/youtube/fake-youtube-web.ts'
import type { YoutubeConfig } from '../src/youtube/system.ts'
import { ManualTimer } from '../src/youtube/timer.ts'
import { MERGED_BODY, RAW_JOIN, T0, addSeller, client, createBroadcast, openTestDb, startServer, type FakeClock, type Seller, type TestServer } from './support.ts'
import { youtubeConfig } from './youtube-support.ts'

export const RETURN_URL = 'https://app.livejjim.test/settings/youtube'

export interface WebWorld extends TestServer {
  readonly web: FakeYoutubeWeb
  readonly google: FakeGoogle | null
  readonly timer: ManualTimer
  readonly config: YoutubeConfig
}

export function webConfig(web: FakeYoutubeWeb, options: { on?: boolean; google?: FakeGoogle | null } = {}): YoutubeConfig {
  const base: YoutubeConfig = options.google == null ? { clientId: '', clientSecret: '', redirectUri: '', returnUrl: RETURN_URL, allowInsecure: true } : youtubeConfig(options.google)
  return { ...base, webChat: { on: options.on ?? true, baseUrl: web.url } }
}

/** 시계 하나로 가짜 유튜브 웹과 우리 서버를 함께 (워커는 시험이 직접 돌린다 — start하지 않는다) */
export async function webWorld(options: { on?: boolean; google?: boolean; database?: Database; masterKey?: string; web?: FakeYoutubeWeb; timer?: ManualTimer; name?: string; overrides?: Partial<ServerOptions> } = {}): Promise<WebWorld> {
  const timer = options.timer ?? new ManualTimer(T0)
  const web = options.web ?? (await FakeYoutubeWeb.start({ now: () => timer.now() }))
  const google = options.google === true ? await FakeGoogle.start({ now: () => timer.now(), pollingIntervalMillis: 1000 }) : null
  const database = options.database ?? (await openTestDb())
  const masterKey = options.masterKey ?? generateMasterKey()
  const config = webConfig(web, { on: options.on ?? true, google })
  const world = startServer(database, masterKey, {
    clock: timer as unknown as FakeClock,
    timer,
    youtube: config,
    instanceName: options.name ?? 'A',
    collectorTiming: { leaseMs: 20_000, renewMs: 5000, scanMs: 5000 },
    ...(options.overrides as Partial<ServerOptions> & { clock?: FakeClock }),
  })
  return { ...world, web, google, timer, config }
}

/** 판매자 하나 + 실제 회차 하나 + 가짜 방송을 잇는다 (처음 잇는 채널이면 확인까지) */
export async function webLinked(world: WebWorld, options: { seller?: Seller; video?: FakeWebVideo; date?: string } = {}) {
  const seller = options.seller ?? (await addSeller(world))
  const b = await createBroadcast(world, seller, options.date === undefined ? {} : { date: options.date })
  const video = options.video ?? world.web.addVideo()
  const api = client(world, seller.cookie)
  let linked = await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: `link-${b.id}`, video: `https://www.youtube.com/watch?v=${video.videoId}` })
  if (linked.status === 409 && errorOf(linked.body).code === 'INVITED_CONFIRM_NEEDED') {
    linked = await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: `link-${b.id}-ok`, video: `https://www.youtube.com/watch?v=${video.videoId}`, confirmInvited: true })
  }
  expect(linked.status, JSON.stringify(linked.body)).toBe(200)
  return { seller, b, video }
}

/** 오류 응답 본문의 코드·문장 */
export const errorOf = (body: Record<string, unknown>) => (body.error ?? {}) as { code?: string; message?: string }

/** 수집 상태 */
export async function collectorOfWorld(world: TestServer, cookie: string, b: string): Promise<Record<string, unknown>> {
  return (await client(world, cookie).get(`/api/broadcasts/${b}/youtube`)).body.collector as Record<string, unknown>
}

/** 기록된 채팅 이벤트 (합친 본문) */
export async function chatEvents(world: TestServer): Promise<Record<string, unknown>[]> {
  const rows = await world.database.pglite?.query<{ body: string }>(`select ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.type = 'chat' order by e.seq`)
  return (rows?.rows ?? []).map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

/** 조건이 될 때까지 시계를 step씩 옮기며 기다린다 */
export async function waitFor(world: WebWorld, predicate: () => boolean | Promise<boolean>, options: { step?: number; max?: number } = {}): Promise<void> {
  const step = options.step ?? 100
  for (let i = 0; i < (options.max ?? 600); i++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 3))
    await world.timer.advance(step)
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

/** 시계를 ms만큼 step씩 옮긴다 (실제 I/O가 돌 틈을 준다) */
export async function pass(world: WebWorld, ms: number, step = 250): Promise<void> {
  for (let done = 0; done < ms; done += step) {
    await new Promise((resolve) => setTimeout(resolve, 3))
    await world.timer.advance(Math.min(step, ms - done))
  }
  await new Promise((resolve) => setTimeout(resolve, 3))
}
