// 라이브 합치기 (D-MERGE-LIVE-01~04): 같은 날 끝난 실제 라이브 여럿을 정산서 하나로 묶고 다시 나눈다. 엔진 기록은 바뀌지 않는다
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { broadcastGroupEvents, events } from '../src/db/schema.ts'
import { chat, DAY, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid } from './support.ts'

const NEXT_DAY = '2026-10-20'

async function endedLive(world: Awaited<ReturnType<typeof newWorld>>, seller: Awaited<ReturnType<typeof addSeller>>, date = DAY) {
  const { id } = await createBroadcast(world, seller, { date })
  await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${id}/end`, { requestId: rid() }))
  return id
}

it('같은 날 끝난 라이브를 합치면 정산서 내려받기가 두 라이브를 한 손님 줄로 모으고, 같은 번호는 1차·2차로 나눠 적는다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const api = client(world, seller.cookie)
  const first = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, first.id, 12, '창금', 30000)
  await chat(world, seller, first.id, 'UC_A', '손님', '12')
  await expectOk(api.post(`/api/broadcasts/${first.id}/end`, { requestId: rid() }))
  const second = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, second.id, 12, '왕색금', 50000)
  await chat(world, seller, second.id, 'UC_A', '손님', '12')
  await expectOk(api.post(`/api/broadcasts/${second.id}/end`, { requestId: rid() }))
  const engineRows = async () => (await world.database.db.select({ id: events.id }).from(events).where(eq(events.sellerId, seller.sellerId))).length
  const before = await engineRows()

  // 합치기 전: 라이브마다 따로
  expect((await api.get(`/api/broadcasts/${first.id}/statement/buyers/csv`)).text).toContain('손님,30000,1')
  const merged = await expectOk(api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [second.id, first.id] }))
  const group = (merged.body as { group: { id: string; date: string; broadcasts: string[] } }).group
  // 그날 시작 순서(1차가 앞)
  expect(group).toEqual({ id: group.id, date: DAY, broadcasts: [first.id, second.id] })
  expect((await expectOk(api.get('/api/broadcast-groups'))).body).toEqual({ groups: [group] })
  // 어느 라이브에서 내려받아도 합친 정산서
  for (const id of [first.id, second.id]) {
    const buyers = (await api.get(`/api/broadcasts/${id}/statement/buyers/csv`)).text
    expect(buyers).toContain('손님,80000,2')
    expect(buyers).toContain('총계,80000,2')
    const products = (await api.get(`/api/broadcasts/${id}/statement/products/csv`)).text
    expect(products).toContain('1차 12,창금,30000,1')
    expect(products).toContain('2차 12,왕색금,50000,1')
    expect(products.indexOf('1차 12')).toBeLessThan(products.indexOf('2차 12'))
  }
  // 엔진 기록은 한 줄도 늘지 않는다 (판정·금액은 그대로)
  expect(await engineRows()).toBe(before)

  // 나누기: 다시 라이브마다 따로, 같은 요청 번호로 다시 보내도 같은 결과
  const splitId = rid()
  await expectOk(api.post(`/api/broadcast-groups/${group.id}/split`, { requestId: splitId }))
  await expectOk(api.post(`/api/broadcast-groups/${group.id}/split`, { requestId: splitId }))
  await expectOk(api.post(`/api/broadcast-groups/${group.id}/split`, { requestId: rid() }))
  expect((await expectOk(api.get('/api/broadcast-groups'))).body).toEqual({ groups: [] })
  expect((await api.get(`/api/broadcasts/${first.id}/statement/buyers/csv`)).text).toContain('손님,30000,1')
  // 기록은 덧붙이기만: 합치기 1 · 나누기 1
  const rows = await world.database.db.select({ kind: broadcastGroupEvents.kind }).from(broadcastGroupEvents).where(eq(broadcastGroupEvents.sellerId, seller.sellerId))
  expect(rows.map((row) => row.kind)).toEqual(['merge', 'split'])
})

it('같은 요청 번호로 다시 합치면 처음 묶음을 돌려주고 기록을 늘리지 않는다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const api = client(world, seller.cookie)
  const a = await endedLive(world, seller)
  const b = await endedLive(world, seller)
  const requestId = rid()
  const one = await expectOk(api.post('/api/broadcast-groups', { requestId, broadcasts: [a, b] }))
  const two = await expectOk(api.post('/api/broadcast-groups', { requestId, broadcasts: [a, b] }))
  expect(two.body).toEqual(one.body)
  // 같은 모습으로 다시 합쳐도 그대로
  expect((await expectOk(api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [b, a] }))).body).toEqual(one.body)
  expect(await world.database.db.select().from(broadcastGroupEvents).where(eq(broadcastGroupEvents.sellerId, seller.sellerId))).toHaveLength(1)
})

it('3차를 더하면 이미 합친 1·2차 묶음을 흡수해 하나가 된다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const api = client(world, seller.cookie)
  const [a, b, c] = [await endedLive(world, seller), await endedLive(world, seller), await endedLive(world, seller)]
  const first = (await expectOk(api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [a, b] }))).body as { group: { id: string } }
  const grown = (await expectOk(api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [c, b] }))).body as { group: { id: string; broadcasts: string[] } }
  expect(grown.group).toEqual({ id: first.group.id, date: DAY, broadcasts: [a, b, c] })
  expect((await expectOk(api.get('/api/broadcast-groups'))).body).toEqual({ groups: [grown.group] })
})

it('끝나지 않은 라이브·날짜가 다른 라이브·연습 라이브·다른 판매자 라이브는 합치지 않고 아무것도 기록하지 않는다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const other = await addSeller(world)
  const api = client(world, seller.cookie)
  const ended = await endedLive(world, seller)
  const live = (await createBroadcast(world, seller, { date: DAY })).id
  const nextDay = await endedLive(world, seller, NEXT_DAY)
  const rehearsal = (await createBroadcast(world, seller, { date: DAY, rehearsal: true })).id
  await expectOk(api.post(`/api/broadcasts/${rehearsal}/end`, { requestId: rid() }))
  const theirs = await endedLive(world, other)
  const tries: [string[], number, string][] = [
    [[ended, live], 409, 'NOT_ENDED'],
    [[ended, nextDay], 409, 'OTHER_DAY'],
    [[ended, rehearsal], 409, 'REHEARSAL'],
    [[ended, theirs], 404, 'NOT_FOUND'],
    [[ended], 400, 'INVALID_INPUT'],
    [[ended, ended], 400, 'INVALID_INPUT'],
  ]
  for (const [broadcasts, status, code] of tries) {
    const response = await api.post('/api/broadcast-groups', { requestId: rid(), broadcasts })
    expect(response.status, broadcasts.join()).toBe(status)
    expect((response.body as { error: { code: string } }).error.code).toBe(code)
  }
  expect((await api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: 'x' })).status).toBe(400)
  expect((await api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [ended, nextDay], extra: 1 })).status).toBe(400)
  expect(await world.database.db.select().from(broadcastGroupEvents)).toHaveLength(0)
  // 다른 판매자의 묶음은 나눌 수 없다
  const mine = await endedLive(world, seller)
  const group = ((await expectOk(api.post('/api/broadcast-groups', { requestId: rid(), broadcasts: [ended, mine] }))).body as { group: { id: string } }).group
  expect((await client(world, other.cookie).post(`/api/broadcast-groups/${group.id}/split`, { requestId: rid() })).status).toBe(404)
  expect((await expectOk(client(world, other.cookie).get('/api/broadcast-groups'))).body).toEqual({ groups: [] })
  expect((await expectOk(api.get('/api/broadcast-groups'))).body).toEqual({ groups: [{ id: group.id, date: DAY, broadcasts: [ended, mine] }] })
})
