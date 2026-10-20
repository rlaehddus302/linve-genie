// N2 적대 테스트 (test-domain): 인스타그램 라이브 댓글 수집·잇기·감사 DM (acceptance AC-N2-01~52).
// 서버를 프로세스 안에서 PGlite로 띄우고 가짜 메타 서버(127.0.0.1, 실제 HTTP)에 실제 어댑터를 붙인다(서버 시험 도우미 그대로).
// 네트워크 가드를 걸어 실제 메타 주소에 닿지 않는다(AC-N2-62).
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { chatEvents, connectedShop, igWorld, linkLive, liveBroadcast, register, sendComments, webhookTarget, type IgWorld } from '../../../apps/server/test/instagram-support.ts'
import { client, rid } from '../../../apps/server/test/support.ts'

installNetworkGuard()

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})
async function world(): Promise<IgWorld> {
  ig = await igWorld()
  return ig
}

interface Claim {
  readonly product: string
  readonly buyer: string
  readonly status: string
}

async function claimsOf(w: IgWorld, cookie: string): Promise<Claim[]> {
  const day = await client(w, cookie).get('/api/days/2026-10-19')
  expect(day.status, day.text).toBe(200)
  return day.body.claims as Claim[]
}

describe('N2 웹훅 댓글 → chat', () => {
  it('회귀: 줄바꿈이 든 댓글 "15\\n28"은 그대로 기록되고 두 번호 주문이다 (chat N2 골든 "줄바꿈 두 번호는 주문")', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    await register(w, seller, b, 28, '라울', 5000)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    expect((await sendComments(w, account, live, [{ igsid: '6024400000000001', username: 'pink.mom', text: '15\n28' }])).status).toBe(200)
    expect((await chatEvents(w, seller.sellerId)).map((event) => event.text)).toEqual(['15\n28'])
    const claims = await claimsOf(w, seller.cookie)
    expect(claims.filter((claim) => claim.buyer === 'ig:6024400000000001').map((claim) => claim.product).sort()).toEqual([`${b}/15`, `${b}/28`].sort())
  })

  it('회귀: 휴대폰 번호 모양 IGSID(01012345678) 구매자에게 방송자 확인(buyer = ig:01012345678)을 서버 API로 기록할 수 있다 (D-N2-02, G-ENG-N2-02)', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    expect((await sendComments(w, account, live, [{ igsid: '01012345678', username: 'cactus_kim', text: '15' }])).status).toBe(200)
    const confirm = await client(w, seller.cookie).post('/api/events', { requestId: rid('cf'), type: 'host.confirm', b, no: 15, buyer: 'ig:01012345678' })
    expect(confirm.status, confirm.text).toBe(200)
  })

  it('회귀: 본문이 정확히 1MB면 받고(서명 검사·200), 1바이트 넘으면 413 (AC-N2-31 경계)', async () => {
    const w = await world()
    const base = JSON.stringify({ object: 'instagram', entry: [], pad: '' })
    const exact = JSON.stringify({ object: 'instagram', entry: [], pad: 'x'.repeat(1024 * 1024 - base.length) })
    expect(Buffer.byteLength(exact)).toBe(1024 * 1024)
    expect((await w.fake.deliver(webhookTarget(w), exact)).status).toBe(200)
    const over = JSON.stringify({ object: 'instagram', entry: [], pad: 'x'.repeat(1024 * 1024 - base.length + 1) })
    expect((await w.fake.deliver(webhookTarget(w), over)).status).toBe(413)
  })
})

describe('N2 재배달과 1부·2부', () => {
  it('TD-N2-001: 1부에 이미 기록한 댓글을 메타가 1부를 끝낸 뒤 다시 보내도 기다리던 2부에 다시 기록되지 않는다 (AC-N2-33 "두 번째는 아무 일도 없다")', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b1 = await liveBroadcast(w, seller)
    const b2 = await liveBroadcast(w, seller)
    // 방송마다 번호를 새로 쓴다 — 1부 15번과 2부 15번은 다른 상품
    await register(w, seller, b1, 15, '1부 핑크프릴', 10000)
    await register(w, seller, b2, 15, '2부 라울', 5000)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b1, live)
    expect((await api.post(`/api/broadcasts/${b2}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    // 1부 시청자 A의 "15" → 1부 15번 1등
    const first = await sendComments(w, account, live, [{ id: '17900000000000101', igsid: '6024400000000001', username: 'pink.mom', text: '15' }])
    expect(first.status).toBe(200)
    expect((await api.post(`/api/broadcasts/${b1}/end`, { requestId: rid('end') })).status).toBe(200)
    // 메타가 같은 댓글(같은 댓글 ID)을 다시 배달한다 (재시도·중복 배달)
    const again = await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: first.changes }]))
    expect(again.status).toBe(200)
    // 2부 15번에 A의 찜이 생기면 안 된다 (A는 1부 상품을 주문했다)
    expect((await claimsOf(w, seller.cookie)).filter((claim) => claim.product === `${b2}/15`)).toEqual([])
    const events = await chatEvents(w, seller.sellerId)
    expect(events.filter((event) => event.id === 'ig:17900000000000101').map((event) => event.b)).toEqual([b1])
    // 이어지지 않은 댓글로 세지도 않는다 (거짓 알림 없음)
    expect((await api.get('/api/instagram/unlinked')).body.lives).toEqual([])
  })

  it('TD-N2-001: 회차를 끊은 뒤 이미 기록한 댓글이 다시 배달되면 "이어진 방송이 없어요" 수로 세지 않는다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const first = await sendComments(w, account, live, [{ id: '17900000000000201', igsid: '1', username: 'a', text: '안녕하세요' }])
    expect((await api.post(`/api/broadcasts/${b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    expect((await w.fake.deliver(webhookTarget(w), w.fake.payload([{ accountId: account.id, changes: first.changes }]))).status).toBe(200)
    expect((await api.get('/api/instagram/unlinked')).body.lives).toEqual([])
    expect(w.published.filter((item) => item.data.code === 'UNLINKED_COMMENTS')).toEqual([])
  })
})
