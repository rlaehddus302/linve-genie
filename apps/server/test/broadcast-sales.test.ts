import { eq } from 'drizzle-orm'
import { scopes } from '../src/db/schema.ts'
import { expect, it } from 'vitest'
import { chat, DAY, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent } from './support.ts'

it('같은 날짜에 끝낸 방송마다 따로 합산하고 종료 후 취소하면 목록의 총매출을 갱신한다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const api = client(world, seller.cookie)
  const totals = async () => {
    const result = await expectOk(api.get('/api/broadcasts'))
    return (result.body as { broadcasts: { salesTotal?: number }[] }).broadcasts.map(row => row.salesTotal)
  }
  for (const price of [350000, 10000]) {
    const { id } = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, id, 15, '색금', price)
    await chat(world, seller, id, 'UC_A', '손님', '15')
    await expectOk(api.post(`/api/broadcasts/${id}/end`, { requestId: rid() }))
    if (price === 350000) {
      expect(await totals()).toEqual([350000])
      expect(await totals()).toEqual([350000])
    } else {
      expect(await totals()).toEqual([350000, 10000])
      await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
      expect(await totals()).toEqual([350000, 0])
    }
  }
})

it('이전 형식으로 봉인된 라이브는 장부에 남은 확정 판매가를 사용한다', async () => {
  const world = await newWorld()
  const seller = await addSeller(world)
  const { id } = await createBroadcast(world, seller, { date: DAY })
  const api = client(world, seller.cookie)
  await expectOk(api.post(`/api/broadcasts/${id}/end`, { requestId: rid() }))
  const sealedAt = new Date()
  const ledger = { format: 'livejjim-ledger/1', date: DAY, sealedAt: sealedAt.toISOString(), broadcasts: [{ id, date: DAY, title: '', endedAt: sealedAt.toISOString() }],
    products: [], buyers: [], settlements: [], sales: [{ broadcast: id, price: 350000 }] }
  await world.database.db.update(scopes).set({ sealedAt, ledger: JSON.stringify(ledger) }).where(eq(scopes.sellerId, seller.sellerId))
  const result = await expectOk(api.get('/api/broadcasts'))
  expect(result.body).toMatchObject({ broadcasts: [{ id, salesTotal: 350000 }] })
})
