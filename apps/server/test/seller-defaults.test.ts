// 판매자 기본값 (D-YT-SRV-23, 사용자 지시 2026-11-09 "감사 댓글 달아주는거 그거 기본적으로 꺼둬. 내가 테스트용으로 연결한 라이브 링크에 댓글 달 수도 있으니까"):
// 운영 기동은 감사 채팅을 끈 채로 시작하고, 판매자가 켜면 그 값이 이긴다. 판정 엔진 기본값(DEFAULT_SETTINGS)은 그대로다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import type { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { generateMasterKey } from '../src/secrets.ts'
import { productionServerOptions } from '../src/production.ts'
import { SELLER_DEFAULTS } from '../src/service.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, ORIGIN, openTestDb, writeEvent, type TestServer } from './support.ts'

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

// D-YT-SRV-24 (사용자 지시 2026-11-09 "방송 화면에서 ... 버튼 눌러서 켜고 끌 수 있게"): 방송 중 감사 채팅 켜기·끄기
describe('D-YT-SRV-24 방송 중 감사 채팅 켜기·끄기', () => {
  it('끔으로 시작한 방송에서 켜면 그 뒤 확정부터 감사가 발송함에 들어가고, 끄면 다시 들어가지 않는다', async () => {
    world = await newWorld({ sellerDefaults: SELLER_DEFAULTS })
    const seller = await addSeller(world)
    const broadcast = await createBroadcast(world, seller)
    const b = broadcast.id
    // 발송함에는 라벨 효과도 들어간다 — 감사(POST_THANKS)만 센다
    const thanksRows = async () => {
      const found = await ((world as TestServer).database.pglite as PGlite).query<{ n: number }>(`select count(*)::int as n from outbox where kind = 'POST_THANKS'`)
      return found.rows[0]?.n ?? 0
    }
    for (const no of [1, 2, 3]) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 10_000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 1, received: '20:00:01', phone: '010-1111-2222' }))
    expect(await thanksRows()).toBe(0)
    await expectOk(writeEvent(world, seller, { type: 'broadcast.thanks', b, liveChat: true }))
    expect((await startSettings(world, b))['thanks.liveChat']).toBe(false)
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 2, received: '20:00:02', phone: '010-3333-4444' }))
    expect(await thanksRows()).toBe(1)
    await expectOk(writeEvent(world, seller, { type: 'broadcast.thanks', b, liveChat: false }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 3, received: '20:00:03', phone: '010-5555-6666' }))
    expect(await thanksRows()).toBe(1)
  })

  it('켜기·끄기 값은 참·거짓만 받는다', async () => {
    world = await newWorld({ sellerDefaults: SELLER_DEFAULTS })
    const seller = await addSeller(world)
    const broadcast = await createBroadcast(world, seller)
    const bad = await writeEvent(world, seller, { type: 'broadcast.thanks', b: broadcast.id, liveChat: 'yes' })
    expect(bad.status).toBe(400)
  })
})
