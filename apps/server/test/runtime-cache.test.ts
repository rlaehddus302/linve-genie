// RA-S04-002 범위 상태 메모리 상한 (NFR-01·04, SYS-02): 없는 날짜는 메모리에 두지 않고, 있는 범위도 상한을 넘으면 오래 안 쓴 것부터 버린다.
// 버린 범위는 다음에 읽거나 쓸 때 스냅샷 + 뒤 이벤트로 다시 불러온다 — 결과는 메모리에 계속 둔 것과 같다.
import { describe, expect, it } from 'vitest'
import { DEFAULT_RUNTIME_CACHE_MAX } from '../src/writer.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent } from './support.ts'

describe('RA-S04-002 범위 상태 메모리 상한', () => {
  it('없는 날짜를 조회·쓰기·이력 조회해도 404이고 메모리에 아무것도 쌓이지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    for (let day = 1; day <= 28; day++) {
      const date = `2025-02-${String(day).padStart(2, '0')}`
      expect((await api.get(`/api/days/${date}`)).status, date).toBe(404)
      expect((await api.post(`/api/events?date=${date}`, { requestId: rid(), type: 'host.blockBuyer', buyer: 'UC1', reason: 'x' })).status, date).toBe(404)
      expect((await api.get(`/api/days/${date}/history`)).status, date).toBe(404)
    }
    expect(world.server.writer.cachedScopes).toBe(0)
    // 방송을 만들면(범위가 생기면) 그 범위만 메모리에 둔다
    const b = await createBroadcast(world, seller, { date: '2025-02-10' })
    expect(world.server.writer.cachedScopes).toBe(1)
    expect((await api.get(`/api/days/${b.date}`)).status).toBe(200)
  })

  it('상한을 넘으면 오래 안 쓴 범위부터 버리고, 버린 범위를 다시 읽거나 쓰면 DB에서 불러와 같은 결과다', async () => {
    const world = await newWorld({ runtimeCacheMax: 2, snapshotEvery: 2 })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const dates = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
    const views = new Map<string, unknown>()
    for (const [index, date] of dates.entries()) {
      const b = await createBroadcast(world, seller, { date })
      await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: `상품 ${date}`, price: 1000 + index, stock: 2 }))
      await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m-${date}`, ch: 'UC1', nick: '영희', text: '1' })
      views.set(date, (await expectOk(api.get(`/api/days/${date}`))).body)
      expect(world.server.writer.cachedScopes).toBeLessThanOrEqual(2)
    }
    // 처음 범위는 버려졌다 — 다시 읽어도 같다
    for (const date of dates) expect((await expectOk(api.get(`/api/days/${date}`))).body, date).toEqual(views.get(date))
    expect(world.server.writer.cachedScopes).toBe(2)
    // 버린 범위에 이어 쓰면 seq가 이어지고 판정도 이어진다 (두 번째 주문은 같은 상품의 두 번째 재고)
    const first = (await expectOk(api.get(`/api/days/${dates[0] ?? ''}`))).body
    const b0 = (first.broadcasts as { id: string }[])[0]?.id ?? ''
    await world.server.ingestChat(seller.sellerId, { b: b0, id: 'again', ch: 'UC2', nick: '철수', text: '1' })
    for (const date of dates.slice(1)) await expectOk(api.get(`/api/days/${date}`))
    const after = (await expectOk(api.get(`/api/days/${dates[0] ?? ''}`))).body
    expect(after.seq).toBe((first.seq as number) + 1)
    expect((after.claims as { status: string }[]).map((claim) => claim.status)).toEqual(['CONFIRMED', 'CONFIRMED'])
  })

  it('처리 중인 범위는 상한을 넘어도 버리지 않는다 (처리가 끝난 뒤 상태가 그대로 이어진다)', async () => {
    let release: () => void = () => {}
    let entered: () => void = () => {}
    const paused = { on: false }
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inside = new Promise<void>((resolve) => {
      entered = resolve
    })
    const world = await newWorld({
      runtimeCacheMax: 1,
      hooks: {
        // 커밋 뒤·메모리 교체 전 (트랜잭션 밖이라 다른 범위의 조회가 DB를 쓸 수 있다)
        afterCommit: async () => {
          if (!paused.on) return
          paused.on = false
          entered()
          await gate
        },
      },
    })
    const seller = await addSeller(world)
    const busy = await createBroadcast(world, seller, { date: '2026-10-10' })
    const other = await createBroadcast(world, seller, { date: '2026-10-11' })
    await expectOk(client(world, seller.cookie).get(`/api/days/${busy.date}`))
    paused.on = true
    const pending = writeEvent(world, seller, { type: 'product.register', b: busy.id, no: 1, name: 'a', price: 1000 })
    await inside
    // 처리 중인 동안 다른 범위를 읽어 상한(1)을 넘긴다
    await expectOk(client(world, seller.cookie).get(`/api/days/${other.date}`))
    expect(world.server.writer.cachedScopes).toBe(2)
    release()
    await expectOk(pending)
    const view = (await expectOk(client(world, seller.cookie).get(`/api/days/${busy.date}`))).body
    expect(view.seq).toBe(2)
    expect((view.products as { name: string }[]).map((product) => product.name)).toEqual(['a'])
    expect(world.server.writer.cachedScopes).toBe(1)
  })

  it('기본 상한과 잘못된 상한', async () => {
    expect(DEFAULT_RUNTIME_CACHE_MAX).toBe(128)
    for (const runtimeCacheMax of [0, -1, 1.5, Number.NaN]) await expect(newWorld({ runtimeCacheMax })).rejects.toThrow('메모리에 두는 범위 수는 1 이상이어야 해요.')
  })
})

describe('RA-N3-003 메모리를 밀어내지 않는 읽기 (peek)', () => {
  it('메모리에 없는 범위는 DB에서 불러와 read와 같은 상태를 주되 메모리에 두지 않는다. 메모리에 있으면 그 상태를 따라잡아 준다', async () => {
    const world = await newWorld({ runtimeCacheMax: 1, snapshotEvery: 2 })
    const seller = await addSeller(world)
    const dates = ['2026-10-17', '2026-10-18']
    for (const date of dates) {
      const b = await createBroadcast(world, seller, { date })
      await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: `상품 ${date}`, price: 1000, stock: 2 }))
      await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m-${date}`, ch: 'UC1', nick: '영희', text: '1' })
    }
    const writer = world.server.writer
    expect(writer.cachedScopes).toBe(1)
    // 10/18만 메모리에 있다 — 10/17을 peek해도 10/18은 그대로 남는다
    const peeked = await writer.peek(seller.sellerId, '2026-10-17')
    expect(writer.cachedScopes).toBe(1)
    const cachedBefore = await writer.peek(seller.sellerId, '2026-10-18')
    expect(writer.cachedScopes).toBe(1)
    const read17 = await writer.read(seller.sellerId, '2026-10-17')
    expect([peeked.seq, peeked.lastAt, JSON.stringify(peeked.state)]).toEqual([read17.seq, read17.lastAt, JSON.stringify(read17.state)])
    // 이제 10/17이 메모리에 있고 10/18은 버려졌다 — 10/18 peek는 DB에서 불러온 같은 상태
    const again18 = await writer.peek(seller.sellerId, '2026-10-18')
    expect([again18.seq, JSON.stringify(again18.state)]).toEqual([cachedBefore.seq, JSON.stringify(cachedBefore.state)])
    expect(writer.cachedScopes).toBe(1)
    // 없는 날짜는 빈 상태 (메모리에 두지 않는다)
    expect((await writer.peek(seller.sellerId, '2025-01-01')).scopeId).toBeNull()
    expect(writer.cachedScopes).toBe(1)
  })
})
