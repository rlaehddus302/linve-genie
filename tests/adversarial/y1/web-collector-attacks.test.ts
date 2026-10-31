// YT-SRV 적대 테스트 (test-domain): 서버 웹 읽기(수집기 방식 WEB, YT-11·D-YT-SRV-10)만의 구멍.
// world({ chat: 'web' }) — 가짜 유튜브 웹(127.0.0.1) + bridgeFakeWeb. 가짜 구글 채팅에 넣은 줄을 웹 수집기가 같은 ID로 받는다.
// 지키는 약속(D-YT-SRV-10 그대로인 것): 같은 (판매자, 방송, 메시지 ID)는 한 번, 접수 순서 = 응답 순서, 이어받기 지점은 기록 뒤 저장,
// 다른 판매자 회차로 새지 않음.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, collectors, connect, linked, pass, query, until, webCalls, world, type Connected, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

/** 판매자별·회차별 기록된 chat 메시지 ID (접수 순서) */
async function idsOf(w: World, sellerId: string, b: string): Promise<string[]> {
  return (
    await query<{ id: string }>(w, `select body::jsonb->>'id' as id from events where type = 'chat' and seller_id = $1 and body::jsonb->>'b' = $2 order by seq`, [sellerId, b])
  ).map((row) => row.id)
}

async function collectorOf(w: World, c: Connected, b: string): Promise<Record<string, unknown>> {
  return (await api(w.server, c.seller.cookie).get(`/api/broadcasts/${b}/youtube`)).body.collector as Record<string, unknown>
}

describe('웹 읽기 — 다시 불러오기 지점이 이미 받은 줄을 겹쳐 줄 때 (D-YT-SRV-10 같은 메시지 ID 한 번)', () => {
  it('TD-YT-SRV-001: 응답 모양이 깨져 새 전체 채팅 지점으로 다시 붙으면 최근 줄(이미 기록한 것 포함)을 다시 받지만 중복 기록은 0이고, 그 사이 글은 순서대로 한 번 기록된다', async () => {
    w = await world({ chat: 'web' })
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    let at = w.timer.now()
    const before = ['15', '16', '17'].map((text, i) => fake.addMessage(liveChatId, { author: `UC_a${String(i)}`, name: `앞${String(i)}`, text, publishedAt: (at += 1000) }))
    const ww = w
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).length === 3, { step: 200 })
    expect(await idsOf(w, c.seller.sellerId, b.id)).toEqual(before)
    // 다음 get_live_chat 두 번은 모르는 모양 → 수집기는 지점을 버리고 채팅 페이지에서 새 전체 채팅 지점을 받는다(첫 응답 = 최근 80줄)
    const pagesBefore = webCalls(w, 'chatPage')
    w.web?.fail('poll', { kind: 'shape' }, 2)
    at = w.timer.now()
    const during = ['18', '19'].map((text, i) => fake.addMessage(liveChatId, { author: `UC_b${String(i)}`, name: `사이${String(i)}`, text, publishedAt: (at += 500) }))
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).length >= 5, { step: 500 })
    expect(webCalls(w, 'chatPage')).toBeGreaterThan(pagesBefore)
    const after = fake.addMessage(liveChatId, { author: 'UC_c', name: '뒤', text: '20', publishedAt: w.timer.now() + 500 })
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).includes(after), { step: 500 })
    await pass(w, 30_000)
    expect(await idsOf(w, c.seller.sellerId, b.id)).toEqual([...before, ...during, after])
    expect(await collectorOf(w, c, b.id)).toMatchObject({ mode: 'WEB', status: 'LIVE' })
  }, 60_000)

  it('TD-YT-SRV-002: 수집하던 서버가 죽고 다른 서버가 임대를 넘겨받아도, 그 사이 글은 빠짐없이 한 번씩 순서대로 기록된다', async () => {
    w = await world({ chat: 'web' })
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    let at = w.timer.now()
    const first = fake.addMessage(liveChatId, { author: 'UC_1', name: '하나', text: '15', publishedAt: (at += 1000) })
    const ww = w
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).length === 1, { step: 200 })
    // A가 갑자기 멈춘다 (임대를 풀지 못한 채)
    w.server.close()
    await w.server.stop().catch(() => {})
    const gapIds = ['16', '17', '18'].map((text, i) => fake.addMessage(liveChatId, { author: `UC_g${String(i)}`, name: `사이${String(i)}`, text, publishedAt: (at += 1000) }))
    const other = w.sibling('B')
    collectors(w, other).start()
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).length >= 4, { step: 1000, max: 200 })
    const last = fake.addMessage(liveChatId, { author: 'UC_9', name: '끝', text: '19', publishedAt: w.timer.now() + 500 })
    await until(w, async () => (await idsOf(ww, c.seller.sellerId, b.id)).includes(last), { step: 500 })
    await pass(w, 30_000)
    expect(await idsOf(w, c.seller.sellerId, b.id)).toEqual([first, ...gapIds, last])
  }, 60_000)
})

describe('웹 읽기 — 판매자 사이 (D-YT-SRV-10 같은 (판매자, 방송, 메시지 ID))', () => {
  it('TD-YT-SRV-003: 판매자 1의 방송 채팅은 판매자 2의 회차로 새지 않고, 판매자 2가 같은 방송을 (확인하고) 이으면 두 판매자 회차에 각각 한 번씩 기록된다', async () => {
    w = await world({ chat: 'web' })
    const one = await connect(w, { publish: false })
    const two = await connect(w, { publish: false })
    const l1 = await linked(w, one, { settings: NO_LABEL })
    const l2 = await linked(w, two, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    let at = w.timer.now()
    const toOne = fake.addMessage(l1.liveChatId, { author: 'UC_x', name: '시청자', text: '15', publishedAt: (at += 1000) })
    const toTwo = fake.addMessage(l2.liveChatId, { author: 'UC_x', name: '시청자', text: '16', publishedAt: (at += 1000) })
    const ww = w
    await until(w, async () => (await idsOf(ww, one.seller.sellerId, l1.b.id)).length === 1 && (await idsOf(ww, two.seller.sellerId, l2.b.id)).length === 1, { step: 200 })
    expect(await idsOf(w, one.seller.sellerId, l1.b.id)).toEqual([toOne])
    expect(await idsOf(w, two.seller.sellerId, l2.b.id)).toEqual([toTwo])
    // 잇기 시각이 위 글들의 게시 시각보다 확실히 뒤가 되게 시계를 옮긴다
    await pass(w, 10_000)
    expect(w.timer.now()).toBeGreaterThan(at + 5000)
    // 판매자 2의 둘째 회차(다른 날)에 판매자 1의 방송을 확인하고 잇는다 (초대 방송)
    const client2 = api(w.server, two.seller.cookie)
    const created = await client2.post('/api/broadcasts', { requestId: `bc-shared-${String(at)}`, date: '2026-10-20' })
    expect(created.status, created.text).toBe(200)
    const b3 = (created.body.broadcast as { id: string }).id
    const shared = await client2.post(`/api/broadcasts/${b3}/youtube`, { requestId: `link-shared-${String(at)}`, video: l1.live.videoId, confirmInvited: true })
    expect(shared.status, shared.text).toBe(200)
    const both = fake.addMessage(l1.liveChatId, { author: 'UC_y', name: '둘다', text: '17', publishedAt: w.timer.now() + 1000 })
    await until(w, async () => (await idsOf(ww, one.seller.sellerId, l1.b.id)).includes(both) && (await idsOf(ww, two.seller.sellerId, b3)).includes(both), { step: 500 })
    await pass(w, 20_000)
    expect(await idsOf(w, one.seller.sellerId, l1.b.id)).toEqual([toOne, both])
    expect(await idsOf(w, two.seller.sellerId, l2.b.id)).toEqual([toTwo])
    // 이은 뒤 글만 (잇기 전 toOne은 판매자 2 회차에 넣지 않는다)
    expect(await idsOf(w, two.seller.sellerId, b3)).toEqual([both])
    // 판매자 2의 chat 이벤트는 모두 판매자 2 회차 것
    const leaked = await query<{ n: number }>(w, `select count(*)::int as n from events where type = 'chat' and seller_id = $1 and body::jsonb->>'b' not in ($2, $3)`, [two.seller.sellerId, l2.b.id, b3])
    expect(leaked[0]?.n).toBe(0)
  }, 60_000)
})
