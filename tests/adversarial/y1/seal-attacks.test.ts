// Y1 적대 테스트 (test-domain): 유튜브 원문 30일 봉인 (AC-Y1-60~62, D-Y11).
// 봉인 뒤 DB 어디에도 채팅 본문·산 적 없는 시청자 닉네임이 없고, 그 범위에 쓰는 모든 길이 막히며, 장부 금액은 봉인 전과 같다.
import { sealAtOf } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, chat, connect, dumpText, linked, ok, product, rid, world, writeEvent, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

describe('봉인 (AC-Y1-61·62)', () => {
  it('TD-Y1-004: 봉인 뒤 DB 전체에서 채팅 본문·산 적 없는 시청자(구경만·취소됨·역전됨) 닉네임 0건, 정산 금액은 봉인 전과 같다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'contention.policy': 'RECEIVED_TIME' } })
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await product(w, c, b.id, 16, '라울', 5000)
    await product(w, c, b.id, 18, '미니마', 800)
    await chat(w, c, b.id, 'v1', 'UC_buy', '구매한홍길동', '15')
    await chat(w, c, b.id, 'v2', 'UC_look', '구경만하는고양이', '와 예쁘다 비밀본문문자열')
    await chat(w, c, b.id, 'v3', 'UC_cancel', '취소된김철수', '16')
    await ok(writeEvent(w, c, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UC_cancel', reason: '취소' }))
    await w.timer.advance(5000)
    await chat(w, c, b.id, 'v4', 'UC_rev', '역전된박민수', '18')
    // 늦게 온 선순위 문자찜으로 18번이 역전된다 (게시 보고 전)
    await ok(writeEvent(w, c, { type: 'sms', b: b.id, no: 18, received: '19:59:00' }))
    await ok(api(w.server, c.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') }))
    const before = await api(w.server, c.seller.cookie).get(`/api/days/${b.date}`)
    expect(before.status, before.text).toBe(200)
    const settlementsBefore = JSON.stringify((before.body.settlements as { finalAmount?: unknown; buyer?: unknown }[]).map((s) => [s.buyer, s.finalAmount]))
    await w.timer.set(sealAtOf(b.date))
    expect(await w.server.sealer.runOnce()).toBe(1)
    const dump = await dumpText(w)
    for (const secret of ['비밀본문문자열', '구경만하는고양이', '취소된김철수', '역전된박민수']) expect(dump, secret).not.toContain(secret)
    const after = await api(w.server, c.seller.cookie).get(`/api/days/${b.date}`)
    expect(after.status, after.text).toBe(200)
    expect(after.body.sealed).toBe(true)
    expect(JSON.stringify((after.body.settlements as { finalAmount?: unknown; buyer?: unknown }[]).map((s) => [s.buyer, s.finalAmount]))).toBe(settlementsBefore)
    expect(JSON.stringify(after.body)).toContain('구매한홍길동')
  }, 60_000)

  it('TD-Y1-005: 봉인한 날짜에는 새 방송 만들기·이벤트 쓰기·방송 잇기가 409 SEALED이고 아무것도 기록하지 않는다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: NO_LABEL })
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await chat(w, c, b.id, 'v1', 'UC_buy', '홍길동', '15')
    await ok(api(w.server, c.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') }))
    await w.timer.set(sealAtOf(b.date))
    expect(await w.server.sealer.runOnce()).toBe(1)
    const pg = w.database.pglite
    if (pg === null) throw new Error('PGlite')
    const count = async () => (await pg.query<{ n: number }>('select count(*)::int as n from events')).rows[0]?.n ?? 0
    const events = await count()
    const client = api(w.server, c.seller.cookie)
    const created = await client.post('/api/broadcasts', { requestId: rid('bc'), date: b.date })
    expect(created.status, created.text).toBe(409)
    expect(created.body.code ?? (created.body.error as { code?: string } | undefined)?.code).toBe('SEALED')
    const written = await writeEvent(w, c, { type: 'product.register', b: b.id, no: 20, name: '새상품', price: 1000 })
    expect(written.status, written.text).toBe(409)
    const live = w.fake.addBroadcast(c.channel.id, { status: 'live' })
    const link = await client.post(`/api/broadcasts/${b.id}/youtube`, { requestId: rid('link'), video: live.videoId })
    expect(link.status, link.text).toBe(409)
    expect(await count()).toBe(events)
  }, 60_000)
})
