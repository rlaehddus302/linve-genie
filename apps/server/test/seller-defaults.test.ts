// 판매자 기본값 (D-YT-SRV-23, 사용자 지시 2026-11-09 "감사 댓글 달아주는거 그거 기본적으로 꺼둬. 내가 테스트용으로 연결한 라이브 링크에 댓글 달 수도 있으니까"):
// 운영 기동은 감사 채팅을 끈 채로 시작하고, 판매자가 켜면 그 값이 이긴다. 판정 엔진 기본값(DEFAULT_SETTINGS)은 그대로다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import type { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { generateMasterKey } from '../src/secrets.ts'
import { productionServerOptions } from '../src/production.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, ORIGIN, openTestDb, type TestServer } from './support.ts'

let world: TestServer | null = null

/** 방송 시작 기록에 담긴 설정 */
async function startSettings(at: TestServer, broadcastId: string): Promise<Record<string, unknown>> {
  const found = await (at.database.pglite as PGlite).query<{ body: string }>(`select body from events where type = 'broadcast.start'`)
  const bodies = found.rows.map((row) => JSON.parse(row.body) as { b: string; settings: Record<string, unknown> })
  return bodies.find((body) => body.b === broadcastId)?.settings ?? {}
}
afterEach(async () => {
  world?.server.close()
  await world?.database.close()
  world = null
})

describe('D-YT-SRV-23 감사 채팅 기본 끔', () => {
  it('운영 설정은 판매자 기본값으로 감사 채팅 끔을 넣는다 — 엔진 기본값은 그대로 켬', async () => {
    expect(SELLER_DEFAULTS).toEqual({ 'thanks.liveChat': false })
    expect(DEFAULT_SETTINGS['thanks.liveChat']).toBe(true)
    const database = await openTestDb()
    const assembled = productionServerOptions({ LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: ORIGIN }, database)
    expect(assembled.ok).toBe(true)
    if (assembled.ok) expect(assembled.options.sellerDefaults).toEqual({ 'thanks.liveChat': false })
    await database.close()
  })

  it('새 판매자는 설정·새 방송 모두 감사 채팅 끔, 판매자가 켜면 다음 방송부터 켬', async () => {
    world = await newWorld({ sellerDefaults: SELLER_DEFAULTS })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect(((await expectOk(api.get('/api/settings'))).body.settings as Record<string, unknown>)['thanks.liveChat']).toBe(false)
    const first = await createBroadcast(world, seller)
    expect((await startSettings(world, first.id))['thanks.liveChat']).toBe(false)
    const saved = await expectOk(api.patch('/api/settings', { settings: { 'thanks.liveChat': true } }))
    expect((saved.body.settings as Record<string, unknown>)['thanks.liveChat']).toBe(true)
    expect(((await expectOk(api.get('/api/settings'))).body.settings as Record<string, unknown>)['thanks.liveChat']).toBe(true)
    const second = await createBroadcast(world, seller, { title: '다음 방송' })
    expect((await startSettings(world, second.id))['thanks.liveChat']).toBe(true)
    // 먼저 연 방송은 그대로
    expect((await startSettings(world, first.id))['thanks.liveChat']).toBe(false)
  })
})
