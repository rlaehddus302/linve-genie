// 틱톡 서버 연결 시험 도우미 (N2b-2). 가짜 웹캐스트·주입한 가짜 시계(서버 시계와 연결 객체 시계가 같다)로 서버를 띄운다.
import { expect } from 'vitest'
import type { Database } from '../src/db/database.ts'
import type { LogRecord } from '../src/log.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { ServerOptions } from '../src/server.ts'
import {
  FakeTikTokClock,
  FakeWebcast,
  readTikTokSettings,
  type FakeChatFields,
  type ShortLinkResolver,
  type TikTokAttemptLimiter,
  type TikTokAvatarFetch,
  type WebcastFactory,
} from '../src/tiktok/index.ts'
import { TIKTOK_NOTICE_VERSION } from '../src/tiktok-live/notice.ts'
import { T0, addSeller, client, openTestDb, rid, startServer, waitFor, type FakeClock, type JsonResponse, type Seller, type TestServer } from './support.ts'

export const DATE = '2026-10-19'

export interface TtWorld extends TestServer {
  readonly webcast: FakeWebcast
  readonly tclock: FakeTikTokClock
  /** 받은 SSE tiktok 알림 */
  readonly published: { sellerId: string; data: Record<string, unknown> }[]
  close(): Promise<void>
}

export interface TtOptions {
  /** 운영자 스위치 (기본 켬) */
  readonly beta?: string
  readonly libraryEnv?: readonly string[]
  readonly noticeVersion?: string
  readonly limiter?: TikTokAttemptLimiter
  readonly database?: Database
  readonly masterKey?: string
  readonly webcast?: FakeWebcast
  readonly factory?: WebcastFactory
  readonly tclock?: FakeTikTokClock
  readonly overrides?: Partial<ServerOptions>
  /** 짧은 공유 링크 풀기 (기본: 언제나 못 품 — 시험은 틱톡에 나가지 않는다, D-UX3-14) */
  readonly shortLinks?: ShortLinkResolver
  /** 틱톡 프로필 사진 받기 (기본: 언제나 못 받음 — 시험은 틱톡에 나가지 않는다, D-TT-PHOTO-01) */
  readonly avatarFetch?: TikTokAvatarFetch
}

export async function ttWorld(options: TtOptions = {}): Promise<TtWorld> {
  const tclock = options.tclock ?? new FakeTikTokClock(T0)
  const webcast = options.webcast ?? new FakeWebcast()
  const database = options.database ?? (await openTestDb())
  const masterKey = options.masterKey ?? generateMasterKey()
  const clock: FakeClock = { now: () => tclock.now(), set: () => undefined, advance: () => undefined }
  const world = startServer(database, masterKey, {
    clock,
    tiktok: {
      settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: options.beta ?? 'on' }),
      webcast: options.factory ?? webcast.factory,
      clock: tclock,
      ...(options.libraryEnv === undefined ? {} : { libraryEnv: options.libraryEnv }),
      ...(options.noticeVersion === undefined ? {} : { noticeVersion: options.noticeVersion }),
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      shortLinks: options.shortLinks ?? (async () => null),
      avatarFetch: options.avatarFetch ?? (async () => null),
    },
    ...(options.overrides as Partial<ServerOptions> & { clock?: FakeClock }),
  })
  const published: { sellerId: string; data: Record<string, unknown> }[] = []
  const original = world.server.hub.publishTiktok.bind(world.server.hub)
  world.server.hub.publishTiktok = (sellerId, data) => {
    published.push({ sellerId, data: data as Record<string, unknown> })
    original(sellerId, data)
  }
  return {
    ...world,
    webcast,
    tclock,
    published,
    close: async () => {
      world.server.close()
      // 진행 중이던 동의 확인·기록 질의가 끝난 뒤 닫는다 (질의 중에 PGlite를 닫으면 멈춘다)
      await world.server.tiktok.idle()
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (options.database === undefined) await database.close()
    },
  }
}

/** 같은 DB로 서버를 하나 더 (다시 켜기) — 앞 서버는 닫는다 */
export function restart(world: TtWorld, options: TtOptions = {}): Promise<TtWorld> {
  world.server.close()
  return ttWorld({ database: world.database, masterKey: world.masterKey, tclock: world.tclock, webcast: options.webcast ?? world.webcast, ...options })
}

/** 동의 켜기 (지금 판) */
export async function consentOn(world: TestServer, seller: Seller, version: string = TIKTOK_NOTICE_VERSION): Promise<JsonResponse> {
  return client(world, seller.cookie).post('/api/tiktok/consent', { requestId: rid('tc'), on: true, version })
}

/** 판매자 하나: 동의 켬·아이디 저장·가짜 웹캐스트 계정 상태 */
export async function tiktokSeller(world: TtWorld, options: { readonly tiktokId?: string; readonly account?: 'LIVE' | 'OFFLINE' | 'MISSING'; readonly seller?: Seller } = {}): Promise<{ seller: Seller; tiktokId: string }> {
  const seller = options.seller ?? (await addSeller(world))
  const tiktokId = options.tiktokId ?? `tt_${seller.loginId}`
  const on = await consentOn(world, seller)
  expect(on.status, on.text).toBe(200)
  const saved = await client(world, seller.cookie).put('/api/tiktok/account', { tiktokId: `@${tiktokId}` })
  expect(saved.status, saved.text).toBe(200)
  world.webcast.account(tiktokId, options.account ?? 'LIVE')
  return { seller, tiktokId }
}

/** 실제 방송 하나 (설정 덮어쓰기는 방송을 만들기 전에) */
export async function realBroadcast(world: TestServer, seller: Seller, settings?: Record<string, unknown>): Promise<string> {
  const api = client(world, seller.cookie)
  if (settings !== undefined) expect((await api.patch('/api/settings', { settings })).status).toBe(200)
  const created = await api.post('/api/broadcasts', { requestId: rid('bc'), date: DATE })
  expect(created.status, created.text).toBe(200)
  return (created.body.broadcast as { id: string }).id
}

export async function linkTiktok(world: TestServer, seller: Seller, b: string, requestId = rid('tl')): Promise<JsonResponse> {
  return client(world, seller.cookie).post(`/api/broadcasts/${b}/live/link`, { requestId, platform: 'TIKTOK' })
}

export async function unlinkTiktok(world: TestServer, seller: Seller, b: string): Promise<JsonResponse> {
  return client(world, seller.cookie).post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('tu'), platform: 'TIKTOK' })
}

/** 연결 객체가 받는 중이 될 때까지 (마이크로태스크·DB 동의 확인) */
export async function connected(world: TtWorld, seller: Seller, b: string): Promise<void> {
  await waitFor(async () => {
    await world.tclock.advance(0)
    const view = await client(world, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)
    return (view.body.link as { collection?: { state?: string } } | undefined)?.collection?.state === 'CONNECTED'
  })
}

let nextMsg = 7_302_000_000_000_000_000n
export function msgId(): string {
  nextMsg += 1n
  return nextMsg.toString()
}

/** 그 방송에 열린 연결로 댓글을 보내고 기록이 끝날 때까지 */
export async function tiktokComment(world: TtWorld, uniqueId: string, fields: FakeChatFields): Promise<void> {
  world.webcast.broadcast(uniqueId, { msgId: msgId(), uniqueId: 'viewer_a', nickname: '시청자', comment: '15', ...fields })
  await world.server.tiktok.idle()
}

/** 범위의 채팅 이벤트 (기록 순서) */
export async function chats(world: TestServer, sellerId: string): Promise<{ seq: number; id: string; ch: string; nick: string; text: string; owner?: boolean; b: string }[]> {
  const rows = await world.database.pglite?.query<{ seq: number; body: string; nick: string | null; text: string | null }>(
    `select e.seq, e.body, r.nick, r.text from events e left join chat_raw r on r.seller_id = e.seller_id and r.scope_id = e.scope_id and r.seq = e.seq where e.seller_id = $1 and e.type = 'chat' order by e.scope_id, e.seq`,
    [sellerId],
  )
  return (rows?.rows ?? []).map((row) => ({ ...(JSON.parse(row.body) as Record<string, unknown>), nick: row.nick ?? '', text: row.text ?? '', seq: row.seq }) as never)
}

export function logText(logs: readonly LogRecord[]): string {
  return JSON.stringify(logs)
}

