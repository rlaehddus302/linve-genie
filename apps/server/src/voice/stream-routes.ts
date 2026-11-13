// LV1 방송 소리로 듣기 REST (dev-notes `## web` 모양). 판매자만 — 보조자는 roles.ts 기본 거부로 403.
import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { sellers } from '../db/schema.ts'
import { apiError } from '../errors.ts'
import { findBroadcast } from '../store.ts'
import type { StreamAudioService } from './stream-service.ts'
import type { HeadlessVoice } from './headless.ts'

export async function sellerStreamAudioOn(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.select({ on: sellers.streamAudio }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  return rows[0]?.on ?? false
}

/** 소리 듣기 고르기 (D-RETRO-70): 'mic' 휴대폰 마이크 · 'stream' 라이브 소리 */
export type ListenSource = 'mic' | 'stream'
export interface ListenSourceView {
  /** 지금 통하는 선택 — 라이브 소리를 쓸 수 없거나 꺼져 있으면 'mic' */
  readonly source: ListenSource
  /** 이 서버에서 라이브 소리로 들을 수 있는지 (운영자 스위치) */
  readonly streamAvailable: boolean
  /** 판매자의 라이브 소리 듣기 켬·끔 (웹 설정의 스위치와 같은 값) */
  readonly streamEnabled: boolean
}

/** 저장된 선택과 라이브 소리 켬·끔을 한 번에 읽는다. 모르는 값은 'mic' */
export async function sellerListenSource(db: Db, sellerId: string, streamAvailable: boolean): Promise<ListenSourceView> {
  const rows = await db.select({ on: sellers.streamAudio, source: sellers.listenSource }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  const streamEnabled = rows[0]?.on ?? false
  return { source: rows[0]?.source === 'stream' && streamAvailable && streamEnabled ? 'stream' : 'mic', streamAvailable, streamEnabled }
}

export function registerStreamAudioRoutes(api: Hono<Env>, db: Db, service: StreamAudioService, heard: HeadlessVoice | null = null): void {
  const settings = async (sellerId: string) => ({ available: service.available, enabled: await sellerStreamAudioOn(db, sellerId) })
  // 소리 듣기 고르기 (D-RETRO-70). 서버가 방송 소리를 듣는 규칙은 그대로다 — 마이크가 켜지면 쉬고 꺼지면 돌아온다(D-LV1-06).
  // 이 값은 앱이 휴대폰 마이크를 켤지 말지를 정한다. 'stream'을 고르면 라이브 소리 듣기(stream_audio)도 같이 켠다.
  api.get('/settings/listen-source', async (c) => c.json(await sellerListenSource(db, c.get('session').sellerId, service.available)))
  api.put('/settings/listen-source', async (c) => {
    const input = c.get('body')
    if (input === null || (input.source !== 'mic' && input.source !== 'stream') || Object.keys(input).some((key) => key !== 'source')) return apiError(400, 'INVALID_INPUT', '휴대폰 마이크와 라이브 소리 가운데 하나를 골라 주세요.')
    const sellerId = c.get('session').sellerId
    if (input.source === 'stream') {
      if (!service.available) return apiError(409, 'NOT_SUPPORTED', '지금은 라이브 소리로 들을 수 없어요. 휴대폰 마이크를 골라 주세요.')
      await db.update(sellers).set({ listenSource: 'stream', streamAudio: true }).where(eq(sellers.id, sellerId))
    } else await db.update(sellers).set({ listenSource: 'mic' }).where(eq(sellers.id, sellerId))
    return c.json(await sellerListenSource(db, sellerId, service.available))
  })
  api.get('/settings/stream-audio', async (c) => c.json(await settings(c.get('session').sellerId)))
  api.put('/settings/stream-audio', async (c) => {
    const input = c.get('body')
    if (input === null || typeof input.enabled !== 'boolean' || Object.keys(input).some((key) => key !== 'enabled')) return apiError(400, 'INVALID_INPUT', '켬·끔을 골라 주세요.')
    const sellerId = c.get('session').sellerId
    // 라이브 소리를 끄면 남는 듣는 길은 휴대폰 마이크뿐 — 고른 값도 같이 돌려 서로 어긋나지 않게 한다 (D-RETRO-71)
    await db.update(sellers).set(input.enabled ? { streamAudio: true } : { streamAudio: false, listenSource: 'mic' }).where(and(eq(sellers.id, sellerId)))
    if (!input.enabled) service.stopSeller(sellerId)
    return c.json(await settings(sellerId))
  })
  const broadcastOf = async (sellerId: string, b: string) => {
    const row = await findBroadcast(db, sellerId, b)
    return row === null ? null : row
  }
  const missing = () => apiError(404, 'NOT_FOUND', '방송을 찾을 수 없어요. 새로고침해 주세요.')
  api.get('/broadcasts/:b/stream-audio', async (c) => {
    const sellerId = c.get('session').sellerId
    const row = await broadcastOf(sellerId, c.req.param('b'))
    if (row === null) return missing()
    if (row.endedAt !== null) return c.json(service.available ? { phase: 'ended' } : { phase: 'hidden' })
    return c.json(await service.viewFor(sellerId, row.id))
  })
  // D-LV1-14 앱이 없는 동안 서버가 들은 말·한 일 (메모리, 최근 300줄). 앱이 다 보면 지운다
  api.get('/broadcasts/:b/stream-audio/heard', async (c) => {
    const sellerId = c.get('session').sellerId
    const row = await broadcastOf(sellerId, c.req.param('b'))
    if (row === null) return missing()
    return c.json(heard === null ? { entries: [], pending: [] } : heard.view(sellerId, row.id))
  })
  api.post('/broadcasts/:b/stream-audio/heard/clear', async (c) => {
    const sellerId = c.get('session').sellerId
    const row = await broadcastOf(sellerId, c.req.param('b'))
    if (row === null) return missing()
    heard?.clear(sellerId, row.id)
    return c.json({ entries: [], pending: [] })
  })
  for (const op of ['watch', 'restart'] as const) {
    api.post(`/broadcasts/:b/stream-audio/${op}`, async (c) => {
      const sellerId = c.get('session').sellerId
      const row = await broadcastOf(sellerId, c.req.param('b'))
      if (row === null) return missing()
      if (row.endedAt !== null) return c.json(service.available ? { phase: 'ended' } : { phase: 'hidden' })
      return c.json(op === 'watch' ? await service.watch(sellerId, row.id) : await service.restart(sellerId, row.id))
    })
  }
}
