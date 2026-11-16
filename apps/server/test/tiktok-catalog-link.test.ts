// D-SYNC2-01 틱톡 잇기 때 처음 맞추기: 같은 틱톡 `@아이디`에 먼저 이은 계정이 손으로 고친 상품이, 나중에 이은 계정에도 잇는 순간 들어간다
// (유튜브 잇기의 insertLink → syncOnVideoLink · catalog.afterLink와 같은 때). 잇기 전 다른 계정의 손 고침을 놓치지 않게.
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, expectOk, writeEvent, type Seller } from './support.ts'
import { DATE, linkTiktok, realBroadcast, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

async function productOf(w: TtWorld, seller: Seller, no: number) {
  const day = await client(w, seller.cookie).get(`/api/days/${DATE}`)
  expect(day.status, day.text).toBe(200)
  return ((day.body.products ?? []) as { no: number; name: string; price: number; status: string }[]).find((p) => p.no === no)
}

describe('D-SYNC2-01 틱톡을 나중에 이은 계정도 먼저 이은 계정의 손 고침을 받는다', () => {
  it('먼저 이은 계정의 손 등록·고침이 나중에 이은 계정에 잇는 때 들어간다', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const mine = await tiktokSeller(w, { tiktokId: 'bit_farm.link' })
    const mb = await realBroadcast(w, mine.seller)
    expect((await linkTiktok(w, mine.seller, mb)).status).toBe(200)
    await expectOk(writeEvent(w, mine.seller, { type: 'product.register', b: mb, no: 56, name: '라울', price: 6000 }))
    await expectOk(writeEvent(w, mine.seller, { type: 'product.update', b: mb, no: 56, name: '달빛마리아', price: 16000 }))
    await w.server.catalog.drain()

    const friend = await tiktokSeller(w, { tiktokId: 'bit_farm.link', seller: await addSeller(w) })
    const fb = await realBroadcast(w, friend.seller)
    expect(await productOf(w, friend.seller, 56)).toBeUndefined()
    const linked = await linkTiktok(w, friend.seller, fb)
    expect(linked.status, linked.text).toBe(200)
    // 잇기 응답 전에 맞춘다(유튜브 잇기와 같이 afterLink를 기다린다) — 대기열이 남았으면 한 바퀴 더
    await w.server.catalog.drain()
    expect(await productOf(w, friend.seller, 56)).toMatchObject({ name: '달빛마리아', price: 16000 })
  })
})
