// S05 적대 테스트 (test-domain): 리허설 범위 분리·수집기 경로 (AC-S05-50·51·52). 통과한 공격을 회귀로 남긴다.
// - 실제 D 차단 → 리허설 D+1(이어받지 않음, 차단된 채널도 리허설에선 찜) → 실제 D+1(실제 D에서만 이어받음) → 리허설 D+1의 차단은 실제 D+2로 가지 않는다
// - 날짜만 적은 쓰기(차단·입금)가 리허설을 적지 않으면 실제 범위로, 적으면 리허설 범위로만
// - 같은 요청 번호의 시청자로 보내기를 동시에 두 번(Enter 연타) → 기록 하나, 같은 결과
// - 생성기 시작을 동시에 두 번(두 기기) → 하나만 돈다
// - 리허설 방송 ID로 실제 범위 조회·이력·메시지에 섞이지 않는다
import { checkReplay } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, event, harness, rid, type Harness } from '../s04/helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const D1 = '2026-10-18'
const D2 = '2026-10-19'
const D3 = '2026-10-20'

async function broadcast(h: Harness, cookie: string, date: string, rehearsal: boolean): Promise<string> {
  const res = await call(h.server, cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date, rehearsal })
  expect(res.status, res.text).toBe(200)
  return (res.body.broadcast as { id: string }).id
}

const blockedIn = async (h: Harness, cookie: string, date: string, rehearsal: boolean): Promise<string[]> => {
  const res = await call(h.server, cookie, 'GET', `/api/days/${date}/history?limit=500${rehearsal ? '&rehearsal=true' : ''}`)
  if (res.status === 404) return []
  const events = res.body.events as { type: string; fields: { buyer?: string } }[]
  return events.filter((e) => e.type === 'host.blockBuyer').map((e) => e.fields.buyer ?? '')
}

describe('리허설과 차단 이어받기 — 사흘 (AC-S05-50, R-9)', () => {
  it('실제 D 차단은 리허설 D+1로 가지 않고 실제 D+1로만, 리허설 D+1 차단은 실제 D+2로 가지 않는다', async () => {
    h = await harness()
    const a = await h.account('iso1')
    const s = h.server
    const real1 = await broadcast(h, a.cookie, D1, false)
    await event(s, a.cookie, { type: 'product.register', b: real1, no: 1, name: 'x', price: 1000 })
    await s.ingestChat(a.sellerId, { b: real1, id: 'r1', ch: 'UCX', nick: '엑스', text: '안녕' })
    expect((await event(s, a.cookie, { type: 'host.blockBuyer', buyer: 'UCX', reason: '장난 찜' }, D1)).status).toBe(200)

    h.clock.t += 86_400_000
    const reh2 = await broadcast(h, a.cookie, D2, true)
    expect(await blockedIn(h, a.cookie, D2, true)).toEqual([])
    await event(s, a.cookie, { type: 'product.register', b: reh2, no: 1, name: 'x', price: 1000 })
    await s.ingestChat(a.sellerId, { b: reh2, id: 'h1', ch: 'UCX', nick: '엑스', text: '1' })
    const rehView = (await call(s, a.cookie, 'GET', `/api/days/${D2}?rehearsal=true`)).body
    expect((rehView.products as { winners: string[] }[])[0]?.winners).toEqual(['UCX'])
    // 리허설에서 다른 사람을 차단 (리허설 범위, 날짜만 적은 쓰기는 rehearsal=true를 적어야 리허설로)
    await s.ingestChat(a.sellerId, { b: reh2, id: 'h2', ch: 'UCY', nick: '와이', text: '안녕' })
    const blockY = await call(s, a.cookie, 'POST', `/api/events?date=${D2}&rehearsal=true`, { requestId: rid('ev'), type: 'host.blockBuyer', buyer: 'UCY', reason: '연습' })
    expect(blockY.status, blockY.text).toBe(200)
    expect(blockY.body.rehearsal).toBe(true)
    // 같은 날 실제 범위는 아직 없다 — 리허설을 적지 않은 날짜 쓰기는 실제 범위(없음 404)로 가고 리허설에 쓰지 않는다
    expect((await event(s, a.cookie, { type: 'host.blockBuyer', buyer: 'UCZ', reason: '연습' }, D2)).status).toBe(404)
    expect(await blockedIn(h, a.cookie, D2, true)).toEqual(['UCY'])

    const real2 = await broadcast(h, a.cookie, D2, false)
    expect(await blockedIn(h, a.cookie, D2, false)).toEqual(['UCX'])
    await event(s, a.cookie, { type: 'product.register', b: real2, no: 1, name: 'x', price: 1000 })
    await s.ingestChat(a.sellerId, { b: real2, id: 'q1', ch: 'UCY', nick: '와이', text: '1' })
    const realView = (await call(s, a.cookie, 'GET', `/api/days/${D2}`)).body
    expect((realView.products as { winners: string[] }[])[0]?.winners).toEqual(['UCY'])
    // 실제 범위 조회에 리허설 방송·구매자가 없다
    expect((realView.broadcasts as { id: string }[]).map((x) => x.id)).toEqual([real2])
    expect((realView.buyers as { id: string }[]).map((x) => x.id).sort()).toEqual(['UCY'])

    h.clock.t += 86_400_000
    await broadcast(h, a.cookie, D3, false)
    expect(await blockedIn(h, a.cookie, D3, false)).toEqual(['UCX'])

    // 범위 목록: 실제만 / 리허설만
    expect(((await call(s, a.cookie, 'GET', '/api/days')).body.days as { date: string; rehearsal: boolean }[]).map((x) => [x.date, x.rehearsal])).toEqual([
      [D1, false],
      [D2, false],
      [D3, false],
    ])
    expect(((await call(s, a.cookie, 'GET', '/api/days?rehearsal=true')).body.days as { date: string; rehearsal: boolean }[]).map((x) => [x.date, x.rehearsal])).toEqual([[D2, true]])
    // 리허설 방송 ID로 실제 범위의 메시지·이력을 고를 수 없다
    expect((await call(s, a.cookie, 'GET', `/api/days/${D2}/messages?b=${reh2}`)).status).toBe(404)
    expect(((await call(s, a.cookie, 'GET', `/api/days/${D2}/history?b=${reh2}&no=1`)).body.events as unknown[]).length).toBe(0)
    expect((await checkReplay(h.database.db)).every((c) => c.ok)).toBe(true)
  }, 60_000)
})

describe('수집기 경로 연타 (AC-S05-51·52)', () => {
  it('같은 요청 번호의 시청자로 보내기를 동시에 두 번 → 기록 하나, 두 응답이 같다', async () => {
    h = await harness()
    const a = await h.account('iso2')
    const b = await broadcast(h, a.cookie, D1, true)
    const body = { requestId: 'viewer-double', nick: '구피사랑', text: '1번이요' }
    const [r1, r2] = await Promise.all([1, 2].map(() => call(h!.server, a.cookie, 'POST', `/api/broadcasts/${b}/rehearsal/chat`, body)))
    expect(r1?.status, r1?.text).toBe(200)
    expect(r2?.text).toBe(r1?.text)
    const messages = (await call(h.server, a.cookie, 'GET', `/api/days/${D1}/messages?rehearsal=true&b=${b}`)).body.messages as { id: string }[]
    expect(messages).toHaveLength(1)
    const history = (await call(h.server, a.cookie, 'GET', `/api/days/${D1}/history?rehearsal=true`)).body.events as { type: string; actor: { kind: string } }[]
    expect(history.filter((e) => e.type === 'chat').map((e) => e.actor.kind)).toEqual(['collector'])
  }, 60_000)

  it('생성기 시작을 두 기기가 동시에 → 하나만 돈다 (하나는 200, 하나는 409 GENERATOR_RUNNING)', async () => {
    const jobs: (() => void)[] = []
    h = await harness({ generatorTimer: { schedule: (_ms: number, fn: () => void) => (jobs.push(fn), () => undefined) } })
    const a = await h.account('iso3')
    const b = await broadcast(h, a.cookie, D1, true)
    const rs = await Promise.all([1, 2].map((n) => call(h!.server, a.cookie, 'POST', `/api/broadcasts/${b}/rehearsal/generator/start`, { total: 5, seed: n })))
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    expect(h.server.service.generators.running).toBe(1)
  }, 60_000)
})
