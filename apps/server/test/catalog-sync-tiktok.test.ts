// D-SYNC2-01 같은 틱톡 라이브에 이은 두 계정 사이의 상품 동기화 (2026-11-16 @bit_succulent_farm 방송: 내 폰·친구 폰 두 계정이 같은 틱톡에 이었는데
// 화면 일꾼 등록만 두 계정에 들어가고, 판매자가 손으로 고친 품종·금액·삭제는 다른 계정에 옮겨지지 않았다 — 동기화가 유튜브 연결만 봤다).
// 찜·주문은 계정마다 따로다(그대로). 대기열은 시험이 직접 돌린다(world.server.catalog.drain).
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, expectOk, writeEvent, type Seller } from './support.ts'
import { DATE, linkTiktok, realBroadcast, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from './tiktok-live-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'
const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

async function world(): Promise<TtWorld> {
  const w = await ttWorld({ overrides: { screenWorkerToken: TOKEN } })
  worlds.push(w)
  return w
}

async function screen(w: TtWorld, body: unknown) {
  const response = await w.server.app.request('/internal/screen/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  expect(response.status, await response.clone().text()).toBe(200)
}

async function productOf(w: TtWorld, seller: Seller, no: number) {
  const day = await client(w, seller.cookie).get(`/api/days/${DATE}`)
  expect(day.status, day.text).toBe(200)
  return ((day.body.products ?? []) as { no: number; name: string; price: number; status: string }[]).find((p) => p.no === no)
}

/** 두 계정이 같은 틱톡 `@아이디`에 잇는다 (내 폰·친구 폰) */
async function twoShops(w: TtWorld) {
  const mine = await tiktokSeller(w, { tiktokId: 'bit_farm.test' })
  const friend = await tiktokSeller(w, { tiktokId: 'bit_farm.test', seller: await addSeller(w) })
  const shops = [
    { seller: mine.seller, b: await realBroadcast(w, mine.seller) },
    { seller: friend.seller, b: await realBroadcast(w, friend.seller) },
  ] as const
  for (const shop of shops) {
    const linked = await linkTiktok(w, shop.seller, shop.b)
    expect(linked.status, linked.text).toBe(200)
  }
  return shops
}

describe('D-SYNC2-01 같은 틱톡 라이브에 이은 계정 사이의 상품 동기화', () => {
  it('한 계정에서 손으로 고친 품종·금액과 상품 삭제(판매 종료)가 다른 계정에도 들어간다', async () => {
    const w = await world()
    const [a, b] = await twoShops(w)
    await screen(w, { videoId: '@bit_farm.test', no: 56, price: 6000, name: '라울', requestId: 'screen-tt-56' })
    expect(await productOf(w, b.seller, 56)).toMatchObject({ name: '라울', price: 6000 })

    await expectOk(writeEvent(w, a.seller, { type: 'product.update', b: a.b, no: 56, name: '달빛마리아', price: 16000 }))
    await w.server.catalog.drain()
    expect(await productOf(w, b.seller, 56)).toMatchObject({ name: '달빛마리아', price: 16000 })

    // 친구 폰(다른 계정)에서 손 등록 → 내 계정에도
    await expectOk(writeEvent(w, b.seller, { type: 'product.register', b: b.b, no: 77, name: '창수박금', price: 60000 }))
    await w.server.catalog.drain()
    expect(await productOf(w, a.seller, 77)).toMatchObject({ name: '창수박금', price: 60000 })

    // 삭제 = 판매 종료 (R-2 소프트 삭제)
    await expectOk(writeEvent(w, a.seller, { type: 'product.close', b: a.b, no: 77 }))
    await w.server.catalog.drain()
    expect(await productOf(w, b.seller, 77)).toMatchObject({ status: 'CLOSED' })
  })

  it('틱톡 연결을 끊은 계정에는 더 옮기지 않는다', async () => {
    const w = await world()
    const [a, b] = await twoShops(w)
    const off = await unlinkTiktok(w, b.seller, b.b)
    expect(off.status, off.text).toBe(200)
    await expectOk(writeEvent(w, a.seller, { type: 'product.register', b: a.b, no: 5, name: '라울', price: 5000 }))
    await w.server.catalog.drain()
    expect(await productOf(w, b.seller, 5)).toBeUndefined()
  })
})
