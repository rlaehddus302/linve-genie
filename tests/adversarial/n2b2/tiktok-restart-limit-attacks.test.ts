// N2b-2 적대 시험 (test-domain): 서버 전체 연결 시도 한도를 서버 경로(잇기·재시작 이어받기)로, 동의를 끈 판매자의 재시작 (AC-N2b-2-35·42).
// 가짜 웹캐스트·주입한 시계 — 바깥 연결 없음.
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { client, rid, waitFor } from '../../../apps/server/test/support.ts'
import { FakeWebcast } from '../../../apps/server/src/tiktok/index.ts'
import { linkTiktok, realBroadcast, restart, tiktokSeller, ttWorld, type TtWorld } from '../../../apps/server/test/tiktok-live-support.ts'

installNetworkGuard()

const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const settle = async (w: TtWorld) => {
  for (let i = 0; i < 5; i += 1) await w.tclock.advance(0)
  await w.server.tiktok.idle()
}

describe('N2b-2 서버 전체 연결 시도 한도 — 서버 경로', () => {
  it('TD-N2b-2-L01: 판매자 31명이 같은 순간 틱톡에 이으면 바깥 시도 30, 59,999ms에도 30, 60,000ms에 31 (AC-N2b-2-42)', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const sellers: { seller: Awaited<ReturnType<typeof tiktokSeller>>['seller']; b: string }[] = []
    for (let i = 0; i < 31; i += 1) {
      const { seller } = await tiktokSeller(w)
      sellers.push({ seller, b: await realBroadcast(w, seller) })
    }
    const responses = await Promise.all(sellers.map(({ seller, b }) => linkTiktok(w, seller, b)))
    expect(responses.every((r) => r.status === 200)).toBe(true)
    await settle(w)
    await waitFor(async () => {
      await w.tclock.advance(0)
      return w.webcast.attempts >= 30
    })
    expect(w.webcast.attempts).toBe(30)
    await w.tclock.advance(59_999)
    await settle(w)
    expect(w.webcast.attempts).toBe(30)
    await w.tclock.advance(1)
    await settle(w)
    await waitFor(async () => {
      await w.tclock.advance(0)
      return w.webcast.attempts === 31
    })
  })

  it('TD-N2b-2-L02: 다시 켠 서버가 연결 31개를 이어받아도 같은 한도 — 바로 30, 60초 뒤 31 (AC-N2b-2-35·42)', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const ids: string[] = []
    for (let i = 0; i < 31; i += 1) {
      const { seller, tiktokId } = await tiktokSeller(w, { account: 'OFFLINE' })
      ids.push(tiktokId)
      expect((await linkTiktok(w, seller, await realBroadcast(w, seller))).status).toBe(200)
    }
    await settle(w)
    const fresh = new FakeWebcast()
    for (const id of ids) fresh.account(id, 'LIVE')
    const again = await restart(w, { webcast: fresh })
    worlds.push(again)
    expect(await again.server.tiktok.resume()).toBe(31)
    await settle(again)
    await waitFor(async () => {
      await again.tclock.advance(0)
      return fresh.attempts >= 30
    })
    expect(fresh.attempts).toBe(30)
    await again.tclock.advance(59_999)
    await settle(again)
    expect(fresh.attempts).toBe(30)
    await again.tclock.advance(1)
    await waitFor(async () => {
      await again.tclock.advance(0)
      return fresh.attempts === 31
    })
  })
})

describe('N2b-2 재시작 — 동의를 끈 판매자', () => {
  it('TD-N2b-2-L03: 이어 둔 채 동의를 끄고 서버를 다시 켜면 바깥 연결 없이 OFF/NO_CONSENT (AC-N2b-2-35)', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await settle(w)
    expect((await client(w, seller.cookie).post('/api/tiktok/consent', { requestId: rid('off'), on: false })).status).toBe(200)
    const fresh = new FakeWebcast().account(tiktokId, 'LIVE')
    const again = await restart(w, { webcast: fresh })
    worlds.push(again)
    await again.server.tiktok.resume()
    await waitFor(async () => {
      await again.tclock.advance(0)
      const view = (await client(again, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: { state: string } | null }
      return view.collection?.state === 'OFF'
    })
    const view = (await client(again, seller.cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: Record<string, unknown> }
    expect(view.collection).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
    expect(fresh.attempts).toBe(0)
  })
})
