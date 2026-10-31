// LV1 방송 소리로 듣기 REST (dev-notes `## web` 모양). 판매자만 — 보조자는 roles.ts 기본 거부로 403.
import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { sellers } from '../db/schema.ts'
import { apiError } from '../errors.ts'
import { findBroadcast } from '../store.ts'
import type { StreamAudioService } from './stream-service.ts'

export async function sellerStreamAudioOn(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.select({ on: sellers.streamAudio }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  return rows[0]?.on ?? false
}

export function registerStreamAudioRoutes(api: Hono<Env>, db: Db, service: StreamAudioService): void {
  const settings = async (sellerId: string) => ({ available: service.available, enabled: await sellerStreamAudioOn(db, sellerId) })
  api.get('/settings/stream-audio', async (c) => c.json(await settings(c.get('session').sellerId)))
  api.put('/settings/stream-audio', async (c) => {
    const input = c.get('body')
    if (input === null || typeof input.enabled !== 'boolean' || Object.keys(input).some((key) => key !== 'enabled')) return apiError(400, 'INVALID_INPUT', '켬·끔을 골라 주세요.')
    const sellerId = c.get('session').sellerId
    await db.update(sellers).set({ streamAudio: input.enabled }).where(and(eq(sellers.id, sellerId)))
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
