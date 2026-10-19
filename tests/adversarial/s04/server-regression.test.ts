// S04 적대 테스트 (test-domain): 통과한 공격 중 회귀로 남길 것 (AC-S04-25·26·27·28·29·31).
// - 같은 요청 번호의 입금을 한꺼번에 네 번 → 기록 하나, 받은 금액 한 번
// - 두 인스턴스가 같은 범위에 채팅 20건을 동시에 → 두 인스턴스·재시작 인스턴스의 조회가 같고 재생 검사가 일치
// - 재시작한 인스턴스가 차단을 이어받는다: 구매자로 기록된 적 없는 미리 차단한 채널 포함, 풀린 차단·문자 구매자 제외
// - 문자찜 전화번호(여러 형식)는 DB 어디에도 원문·정규화 번호로 남지 않는다
import { checkReplay, INHERITED_BLOCK_REASON } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, dumpAll, event, harness, startBroadcast, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

describe('요청 번호·동시 쓰기·재시작 (AC-S04-25·26·28·29)', () => {
  it('같은 요청 번호의 입금 네 번(동시) → 같은 처음 결과, 받은 금액은 한 번만', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, '2026-10-18')
    await event(s, a.cookie, { type: 'product.register', b, no: 1, name: 'x', price: 1000 })
    await s.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC1', nick: '하나', text: '1' })
    const pay = { requestId: 'pay-1', type: 'settlement.payment', buyer: 'UC1', date: '2026-10-18', amount: 1000 }
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(s, a.cookie, 'POST', '/api/events?date=2026-10-18', pay)))
    expect(new Set(rs.map((r) => r.text)).size).toBe(1)
    expect(rs[0]?.status).toBe(200)
    const view = await call(s, a.cookie, 'GET', '/api/days/2026-10-18')
    const settlements = view.body.settlements as { buyer: string; received: number }[]
    expect(settlements.find((x) => x.buyer === 'UC1')?.received).toBe(1000)
    const history = await call(s, a.cookie, 'GET', '/api/days/2026-10-18/history')
    expect((history.body.events as { type: string }[]).filter((e) => e.type === 'settlement.payment')).toHaveLength(1)
  }, 60_000)

  it('두 인스턴스가 같은 범위에 동시에 쓴 뒤 두 인스턴스·재시작 인스턴스의 조회가 같고 재생 검사가 일치한다', async () => {
    h = await harness({ snapshotEvery: 3 })
    const a = await h.account('shopa')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, '2026-10-18')
    await event(s, a.cookie, { type: 'product.register', b, no: 2, name: 'y', price: 2000 })
    const s2 = h.restart({ snapshotEvery: 3 })
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? s : s2).ingestChat(a.sellerId, { b, id: `c${String(i)}`, ch: `U${String(i)}`, nick: 'n', text: '2' })))
    expect(many.every((m) => m.status === 'recorded')).toBe(true)
    const v1 = await call(s, a.cookie, 'GET', '/api/days/2026-10-18')
    const v2 = await call(s2, a.cookie, 'GET', '/api/days/2026-10-18')
    const v3 = await call(h.restart(), a.cookie, 'GET', '/api/days/2026-10-18')
    expect(v2.text).toBe(v1.text)
    expect(v3.text).toBe(v1.text)
    const winners = (v1.body.products as { winners: string[] }[])[0]?.winners
    expect(winners).toHaveLength(1)
    const checks = await checkReplay(h.database.db)
    expect(checks.map((c) => c.ok)).toEqual([true])
  }, 60_000)
})

describe('차단 이어받기 — 재시작한 인스턴스 (AC-S04-27)', () => {
  it('미리 차단한 채널(구매자 기록 없음)도 이어받고, 풀린 차단·문자 구매자는 이어받지 않는다', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    const b1 = await startBroadcast(s, a.cookie, '2026-10-18')
    await event(s, a.cookie, { type: 'product.register', b: b1, no: 1, name: 'x', price: 1000 })
    await s.ingestChat(a.sellerId, { b: b1, id: 'x0', ch: 'UCX', nick: 'x', text: '안녕' })
    await s.ingestChat(a.sellerId, { b: b1, id: 'y0', ch: 'UCY', nick: 'y', text: '안녕' })
    const sms = await event(s, a.cookie, { type: 'sms', b: b1, no: 1, phone: '010-1234-5678' })
    const smsBuyer = ((await call(s, a.cookie, 'GET', '/api/days/2026-10-18')).body.buyers as { id: string; kind: string }[]).find((x) => x.kind === 'sms')?.id
    expect(sms.status).toBe(200)
    for (const buyer of ['UCX', 'UCpre', 'UCY', smsBuyer]) await event(s, a.cookie, { type: 'host.blockBuyer', buyer, reason: '사유' }, '2026-10-18')
    await event(s, a.cookie, { type: 'host.unblockBuyer', buyer: 'UCY', reason: '사유' }, '2026-10-18')
    const s2 = h.restart()
    h.clock.t += 86_400_000
    const b2 = await startBroadcast(s2, a.cookie, '2026-10-19')
    const history = (await call(s2, a.cookie, 'GET', '/api/days/2026-10-19/history')).body.events as { seq: number; type: string; reason: string | null; fields: { buyer?: string }; actor: { kind: string } }[]
    expect(history.map((e) => [e.seq, e.type, e.fields.buyer ?? null])).toEqual([
      [1, 'broadcast.start', null],
      [2, 'host.blockBuyer', 'UCX'],
      [3, 'host.blockBuyer', 'UCpre'],
    ])
    expect(history.slice(1).every((e) => e.reason === INHERITED_BLOCK_REASON && e.actor.kind === 'server')).toBe(true)
    await event(s2, a.cookie, { type: 'product.register', b: b2, no: 1, name: 'x', price: 1000 })
    await s2.ingestChat(a.sellerId, { b: b2, id: 'p1', ch: 'UCpre', nick: 'p', text: '1' })
    const claims = (await call(s2, a.cookie, 'GET', '/api/days/2026-10-19')).body.claims as { buyer: string; status: string; reason: string | null }[]
    expect(claims.map((c) => [c.buyer, c.status, c.reason])).toEqual([['UCpre', 'REJECTED', 'BLOCKED']])
  }, 60_000)
})

describe('문자찜 전화번호가 DB에 남지 않는다 (AC-S04-31)', () => {
  it('여러 형식의 같은 번호 → 같은 문자 구매자, DB 전체에 원문·정규화 번호가 없다', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, '2026-10-18')
    await event(s, a.cookie, { type: 'product.register', b, no: 1, name: 'x', price: 1000, stock: 3 })
    for (const phone of ['010-8765-4321', '01087654321', '010 8765 4321', '０１０-８７６５-４３２１']) {
      const r = await event(s, a.cookie, { type: 'sms', b, no: 1, phone, memo: '김영희 이모' })
      expect(r.status).toBe(200)
      expect(r.body.phoneLast4).toBe('4321')
    }
    const buyers = (await call(s, a.cookie, 'GET', '/api/days/2026-10-18')).body.buyers as unknown[]
    expect(buyers).toHaveLength(1)
    const dump = await dumpAll(h.database)
    for (const needle of ['87654321', '8765-4321', '8765 4321', '８７６５']) expect(dump, needle).not.toContain(needle)
  }, 60_000)
})
