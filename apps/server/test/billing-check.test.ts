// N5 재생 무결성 검사의 요금 대조 (AC-N5-26, BL-INV-2·3·4·6). 다르면 판매자·범위·키를 알리고 실패, 고치지 않는다.
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { checkReplay, formatCheck } from '../src/check-replay.ts'
import { billingWorld, grant, query } from './billing-support.ts'
import { DEVICE_A, becomeDevice, chat, printApi, register } from './print-support.ts'
import { addSeller, createBroadcast, expectOk, writeEvent } from './support.ts'

const DAY = '2026-10-19'

async function busyWorld() {
  const world = await billingWorld()
  const seller = await addSeller(world)
  await grant(world, seller, 'ORDERS', 2)
  const b = await createBroadcast(world, seller, { date: DAY })
  const p = printApi(world, seller)
  await becomeDevice(world, seller)
  await register(world, seller, b.id, 1)
  await register(world, seller, b.id, 2)
  await chat(world, seller, b.id, 'UC_1', '하나', '1')
  await chat(world, seller, b.id, 'UC_2', '둘', '2')
  for (let i = 0; i < 2; i++) {
    const job = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, job.job?.attempt ?? '')).toBe(true)
  }
  // 리허설 범위 (이용 방식·쓴 기록 없음)
  const r = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: r.id, no: 1, name: '리허설', price: 1000 }))
  return { world, seller, b }
}

describe('AC-N5-26 재생 무결성 검사의 요금 대조', () => {
  it('맞으면 일치, 쓴 기록 한 줄을 지우거나 더하면 그 키를 알리고 실패 (고치지 않는다)', async () => {
    const { world, seller, b } = await busyWorld()
    expect(await query(world, `select key from billing_usage where kind = 'ORDERS'`)).toHaveLength(2)
    expect(await query(world, `select key from billing_usage where kind = 'LABELS'`)).toHaveLength(2)
    let results = await checkReplay(world.database.db, { sellerId: seller.sellerId })
    expect(results.map((r) => [r.rehearsal, r.ok, r.billing])).toEqual([
      [false, true, []],
      [true, true, []],
    ])
    const pg = world.database.pglite as PGlite
    const removed = (await query<{ key: string }>(world, `select key from billing_usage where kind = 'ORDERS' order by key limit 1`))[0]?.key ?? ''
    await pg.exec(`delete from billing_usage where key = '${removed}'`)
    results = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    expect(results[0]).toMatchObject({ ok: false, firstDiff: { part: '요금' }, billing: [removed] })
    expect(formatCheck(results[0] as NonNullable<(typeof results)[0]>)).toContain(`요금 키 ${removed}`)
    // 검사는 고치지 않는다
    expect(await query(world, `select key from billing_usage where key = '${removed}'`)).toEqual([])
    // 더한 줄 (1등이 없는 상품의 주문 건)
    await pg.exec(`insert into billing_usage (seller_id, kind, key, at, broadcast_id, date, product_id) values ('${seller.sellerId}', 'ORDERS', 'ORDERS:${DAY}:p999', now(), '${b.id}', '${DAY}', 'p999')`)
    results = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    expect(results[0]?.billing).toEqual([removed, `ORDERS:${DAY}:p999`].sort())
  })

  it('라벨 장 줄이 빠지거나, 이용 방식 없는 방송·리허설 방송에 쓴 기록·이용 방식이 있으면 실패', async () => {
    const { world, seller } = await busyWorld()
    const pg = world.database.pglite as PGlite
    const label = (await query<{ key: string }>(world, `select key from billing_usage where kind = 'LABELS' order by key limit 1`))[0]?.key ?? ''
    await pg.exec(`delete from billing_usage where key = '${label}'`)
    let [real] = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    expect(real?.billing).toEqual([label])
    // 리허설 방송에 이용 방식
    const rehearsal = (await query<{ id: string; scope_id: string }>(world, `select b.id, b.scope_id from broadcasts b join scopes s on s.id = b.scope_id where s.rehearsal`))[0]
    await pg.exec(`insert into billing_modes (broadcast_id, seller_id, scope_id, mode, used_day, at) values ('${rehearsal?.id ?? ''}', '${seller.sellerId}', '${rehearsal?.scope_id ?? ''}', 'ORDERS', false, now())`)
    const [r] = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: true })
    expect(r).toMatchObject({ ok: false, billing: [`MODE:${rehearsal?.id ?? ''}`] })
    // 방송 일을 썼다는 이용 방식에 쓴 기록이 없음
    ;[real] = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    await pg.exec(`insert into billing_usage (seller_id, kind, key, at, broadcast_id, date) values ('${seller.sellerId}', 'DAYS', 'DAYS:nobroadcast', now(), 'nobroadcast', '${DAY}')`)
    const [again] = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    expect(again?.billing).toContain('DAYS:nobroadcast')
    expect(real?.ok).toBe(false)
  })
})
