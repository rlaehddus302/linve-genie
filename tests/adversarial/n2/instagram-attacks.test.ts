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

describe('N2 옮기기 (AC-N2-25)', () => {
  it('TD-N2-003: 1부를 끝내지 않은 채 2부 방송을 새로 만들고 새 라이브를 켜면, 2부 시청자의 댓글로 1부가 새 라이브에 옮겨져 1부 같은 번호(다른 상품)에 2부 시청자의 찜이 생기고 2부는 그 라이브에 이을 수 없다', async () => {
    const w = await world()
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    // 1부: 기다리기 → 1부 라이브 M의 첫 댓글로 저절로 이어짐 (조치자 서버)
    const b1 = await liveBroadcast(w, seller)
    await register(w, seller, b1, 15, '1부 핑크프릴', 10000)
    expect((await api.post(`/api/broadcasts/${b1}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    const m = w.fake.startLive(account.id)
    expect((await sendComments(w, account, m, [{ id: '17900000000000301', igsid: '6024400000000009', username: 'hello.viewer', text: '안녕하세요' }])).status).toBe(200)
    expect(((await api.get(`/api/broadcasts/${b1}/live`)).body.link as { liveId: string }).liveId).toBe(m)
    // 판매자는 1부를 끝내는 것을 잊고 2부 방송을 새로 만들어 상품을 올린다 (방송마다 번호를 새로 쓴다)
    const b2 = await liveBroadcast(w, seller)
    await register(w, seller, b2, 15, '2부 라울', 5000)
    // 2부 라이브 M2를 켰다. 판매자가 2부를 M2에 잇기 전에 2부 시청자 A의 "15"가 먼저 온다 (늦지 않은 댓글)
    const m2 = w.fake.startLive(account.id)
    expect((await sendComments(w, account, m2, [{ id: '17900000000000302', igsid: '6024400000000001', username: 'pink.mom', text: '15' }])).status).toBe(200)
    // A는 2부 상품을 보고 주문했다 — 1부 15번(다른 상품)에 A의 찜이 생기면 안 된다
    expect((await claimsOf(w, seller.cookie)).filter((claim) => claim.product === `${b1}/15`)).toEqual([])
    // 판매자가 2부를 M2에 이을 수 있어야 한다
    const linked = await api.post(`/api/broadcasts/${b2}/live/link`, { requestId: rid('link'), platform: 'INSTAGRAM', liveId: m2 })
    expect(linked.status, linked.text).toBe(200)
  })
})

describe('N2 옮기기 수정(바·사)으로 생긴 구멍', () => {
  it('TD-N2-004: 자정을 넘겨 이어지는 방송(DOMAIN_RULES "자정을 넘겨 끝난 방송도 그 방송의 날짜 하나")에서 인스타 라이브가 끊겨 다시 켜면, 다른 회차가 없어도 새 라이브로 옮기지 않아 다시 켠 뒤의 주문이 기록되지 않는다 (AC-N2-25 조건은 모두 맞음)', async () => {
    const w = await world()
    // 2026-10-19 23:00 KST에 방송 시작
    w.clock.set(Date.UTC(2026, 9, 19, 14, 0, 0))
    const { seller, account } = await connectedShop(w)
    const api = client(w, seller.cookie)
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    expect((await api.post(`/api/broadcasts/${b}/live/wait`, { requestId: rid('w'), platform: 'INSTAGRAM' })).status).toBe(200)
    const m = w.fake.startLive(account.id)
    w.clock.set(Date.UTC(2026, 9, 19, 14, 30, 0))
    expect((await sendComments(w, account, m, [{ id: '17900000000000401', igsid: '6024400000000009', username: 'hello.viewer', text: '안녕하세요' }])).status).toBe(200)
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.link as { liveId: string }).liveId).toBe(m)
    // 00:05 KST(다음 날) 휴대폰 통신이 끊겨 인스타 라이브가 끝났다 → 판매자가 바로 다시 켠다. 방송(회차 b)은 계속 진행 중이고 다른 회차는 없다
    w.clock.set(Date.UTC(2026, 9, 19, 15, 5, 0))
    w.fake.endLive(m)
    const m2 = w.fake.startLive(account.id)
    w.clock.set(Date.UTC(2026, 9, 19, 15, 6, 0))
    expect((await sendComments(w, account, m2, [{ id: '17900000000000402', igsid: '6024400000000001', username: 'pink.mom', text: '15' }])).status).toBe(200)
    // AC-N2-25: 늦지 않은 댓글, M2는 처음, 서버가 저절로 이은 끝나지 않은 실제 회차가 정확히 하나 → 옮기고 그 댓글부터 b에 기록한다
    expect(((await api.get(`/api/broadcasts/${b}/live`)).body.link as { liveId: string }).liveId).toBe(m2)
    expect((await chatEvents(w, seller.sellerId)).filter((event) => event.b === b).map((event) => event.id)).toContain('ig:17900000000000402')
  })
})
