// D-IDLOGIN-03 하루 라이브 기록을 다른 가게로 복사 (사용자 2026-11-20 "db에서 지금까지 모든 방송 이력 보고 두 계정에 적절하게 나눠서 넣어")
import { describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { copyScope } from '../src/copy-scope.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

async function chat(world: TestServer, seller: Seller, b: { id: string; date: string }, id: string, nick: string, text: string) {
  const outcome = await world.server.writer.write({
    sellerId: seller.sellerId,
    date: b.date,
    rehearsal: false,
    createScope: false,
    requestId: null,
    chat: { b: b.id, id },
    build: () => [{ fields: { type: 'chat', b: b.id, id, ch: 'UCnosource0000000000001', nick, text }, actor: { kind: 'collector' }, chat: { b: b.id, id } }],
  })
  expect(outcome).toMatchObject({ kind: 'ok' })
}

describe('D-IDLOGIN-03 하루 라이브 기록 복사', () => {
  it('미리보기는 쓰지 않고, 옮기면 받는 가게에 같은 상품·찜·끝남이 새 방송 ID로 보이고 재생 검사가 맞고 원래 가게는 그대로다', async () => {
    const world = await newWorld()
    const from = await addSeller(world)
    const to = await addSeller(world)
    const b = await createBroadcast(world, from, { title: '보스삼촌 라이브' })
    await client(world, from.cookie).post(`/api/broadcasts/${b.id}/open`, {})
    await expectOk(writeEvent(world, from, { type: 'product.register', b: b.id, no: 12, name: '라울', price: 5000 }))
    await chat(world, from, b, 'm1', '손님하나', '12')
    await chat(world, from, b, 'm2', '손님둘', '안녕하세요')
    await expectOk(client(world, from.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') }))
    const beforeFrom = await client(world, from.cookie).get(`/api/days/${b.date}`)

    const preview = await copyScope(world.database.db, { fromSellerId: from.sellerId, toSellerId: to.sellerId, date: b.date }, { apply: false })
    expect(preview).toMatchObject({ ok: true, dryRun: true, broadcasts: [{ from: b.id, title: '보스삼촌 라이브' }] })
    expect(((await client(world, to.cookie).get('/api/broadcasts')).body.broadcasts as unknown[]).length).toBe(0)

    const done = await copyScope(world.database.db, { fromSellerId: from.sellerId, toSellerId: to.sellerId, date: b.date }, { apply: true })
    expect(done).toMatchObject({ ok: true, dryRun: false, check: { ok: true } })
    if (!done.ok) throw new Error('복사 실패')
    const newId = done.broadcasts[0]?.to ?? ''
    expect(newId).not.toBe(b.id)
    const list = (await client(world, to.cookie).get('/api/broadcasts')).body.broadcasts as { id: string; ended: boolean; title: string }[]
    expect(list).toEqual([expect.objectContaining({ id: newId, ended: true, title: '보스삼촌 라이브' })])
    const day = await client(world, to.cookie).get(`/api/days/${b.date}`)
    expect(day.status).toBe(200)
    expect(day.body.products).toEqual(JSON.parse(JSON.stringify(beforeFrom.body.products).split(b.id).join(newId)))
    expect(day.body.claims).toEqual([expect.objectContaining({ broadcast: newId, status: 'CONFIRMED', price: 5000 })])
    expect(JSON.stringify(day.body)).toContain('손님하나')
    // 원래 가게는 그대로, 재생 검사도 맞다
    expect((await client(world, from.cookie).get(`/api/days/${b.date}`)).body).toEqual(beforeFrom.body)
    for (const check of await checkReplay(world.database.db, {})) expect(check.ok, JSON.stringify(check.firstDiff)).toBe(true)

    // 받는 가게에 그 날짜가 있으면 섞지 않는다, 같은 가게·없는 기록도 거절
    expect(await copyScope(world.database.db, { fromSellerId: from.sellerId, toSellerId: to.sellerId, date: b.date }, { apply: true })).toEqual({ ok: false, message: '받는 가게에 그 날짜 기록이 이미 있어요(섞지 않아요).' })
    expect(await copyScope(world.database.db, { fromSellerId: from.sellerId, toSellerId: from.sellerId, date: b.date }, { apply: true })).toMatchObject({ ok: false })
    expect(await copyScope(world.database.db, { fromSellerId: to.sellerId, toSellerId: from.sellerId, date: '2020-01-01' }, { apply: true })).toEqual({ ok: false, message: '옮길 기록이 없어요.' })
  })
})
