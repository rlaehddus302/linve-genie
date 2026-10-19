// AC-S04-27 차단 이어받기, AC-S04-28 재시작·스냅샷·형식
import { applyEvent, getBuyer, listClaims, type EngineEvent } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { INHERITED_BLOCK_REASON } from '../src/service.ts'
import { addSeller, client, countRows, createBroadcast, expectOk, fakeClock, newWorld, startServer, writeEvent, type Seller, type TestServer } from './support.ts'

async function eventsOf(world: TestServer, date: string) {
  const result = await world.database.pglite?.query<{ seq: number; type: string; body: string; actor: string; account_id: string | null }>(
    `select e.seq, e.type, e.body, e.actor, e.account_id from events e join scopes s on s.id = e.scope_id where s.date = $1 order by e.seq`,
    [date],
  )
  return (result?.rows ?? []).map((row) => ({ ...row, body: JSON.parse(row.body) as Record<string, unknown> }))
}

describe('AC-S04-27 차단 이어받기', () => {
  async function setup(): Promise<{ world: TestServer; seller: Seller; d18: { id: string; date: string } }> {
    const world = await newWorld()
    const seller = await addSeller(world)
    const d18 = await createBroadcast(world, seller, { date: '2026-10-18' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: d18.id, no: 1, name: 'a', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: d18.id, id: 'x1', ch: 'UCX', nick: 'X', text: '안녕' })
    await world.server.ingestChat(seller.sellerId, { b: d18.id, id: 'y1', ch: 'UCY', nick: 'Y', text: '안녕' })
    const sms = await expectOk(writeEvent(world, seller, { type: 'sms', b: d18.id, no: 1, received: '20:00', phone: '010-2222-3333' }))
    const smsBuyer = listClaims((await world.server.writer.read(seller.sellerId, '2026-10-18')).state).find((claim) => claim.origin === 'sms')?.buyer
    expect(sms.status).toBe(200)
    const block = (buyer: string) => writeEvent(world, seller, { type: 'host.blockBuyer', buyer, reason: '욕설' }, '2026-10-18')
    await expectOk(block('UCX'))
    await expectOk(block('UCY'))
    await expectOk(writeEvent(world, seller, { type: 'host.unblockBuyer', buyer: 'UCY', reason: '오해' }, '2026-10-18'))
    await expectOk(block(smsBuyer as string))
    // 구매자로 기록된 적 없는 채널도 미리 차단할 수 있다
    await expectOk(block('UCZ-never-seen'))
    return { world, seller, d18 }
  }

  it('다음 날짜 첫 방송: seq 1 broadcast.start 바로 뒤에 차단 중인 유튜브 채널마다 host.blockBuyer(서버). 풀린 차단·문자 구매자는 없다', async () => {
    const { world, seller } = await setup()
    const d19 = await createBroadcast(world, seller, { date: '2026-10-19' })
    const events = await eventsOf(world, '2026-10-19')
    expect(events.map((event) => [event.seq, event.type, event.body.buyer ?? null, event.body.reason ?? null, event.actor])).toEqual([
      [1, 'broadcast.start', null, null, 'account'],
      [2, 'host.blockBuyer', 'UCX', INHERITED_BLOCK_REASON, 'server'],
      [3, 'host.blockBuyer', 'UCZ-never-seen', INHERITED_BLOCK_REASON, 'server'],
    ])
    expect(events[1]?.account_id).toBeNull()
    // 10/19에 X가 쓴 주문은 REJECTED(BLOCKED)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: d19.id, no: 5, name: 'b', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: d19.id, id: 'x2', ch: 'UCX', nick: 'X', text: '5' })
    await world.server.ingestChat(seller.sellerId, { b: d19.id, id: 'y2', ch: 'UCY', nick: 'Y', text: '5' })
    const state = (await world.server.writer.read(seller.sellerId, '2026-10-19')).state
    const claims = listClaims(state)
    expect(claims.find((claim) => claim.buyer === 'UCX')).toMatchObject({ status: 'REJECTED', reason: 'BLOCKED' })
    expect(claims.find((claim) => claim.buyer === 'UCY')).toMatchObject({ status: 'CONFIRMED' })
    expect(getBuyer(state, 'UCX')?.blocked).toBe(true)
  })

  it('같은 날짜의 두 번째 방송은 이어받지 않고, 이전 범위가 없으면 이어받을 것이 없다', async () => {
    const { world, seller } = await setup()
    await createBroadcast(world, seller, { date: '2026-10-19' })
    await createBroadcast(world, seller, { date: '2026-10-19' })
    expect((await eventsOf(world, '2026-10-19')).map((event) => event.type)).toEqual(['broadcast.start', 'host.blockBuyer', 'host.blockBuyer', 'broadcast.start'])
    // 가장 이른 날짜(앞선 범위 없음)
    await createBroadcast(world, seller, { date: '2026-10-01' })
    expect((await eventsOf(world, '2026-10-01')).map((event) => event.type)).toEqual(['broadcast.start'])
  })

  it('기준은 새 날짜보다 이른 날짜 중 가장 늦은 범위의 최종 상태', async () => {
    const { world, seller } = await setup()
    // 10/16 범위(더 이른)에는 다른 차단이 있다 — 쓰이지 않는다
    await createBroadcast(world, seller, { date: '2026-10-16' })
    await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCOLD', reason: '예전' }, '2026-10-16'))
    // 10/18 범위에서 X 차단을 나중에 풀면 10/21은 X를 이어받지 않는다
    await expectOk(writeEvent(world, seller, { type: 'host.unblockBuyer', buyer: 'UCX', reason: '풀어 줌' }, '2026-10-18'))
    await createBroadcast(world, seller, { date: '2026-10-21' })
    expect((await eventsOf(world, '2026-10-21')).map((event) => event.body.buyer ?? event.type)).toEqual(['broadcast.start', 'UCZ-never-seen'])
  })

  it('차단된 ID가 휴대폰 번호(looksLikePhoneId — D-079 전 로그에 남은 값)면 이어받지 않고, 방송은 만들어진다 (TD-S04-004)', async () => {
    const { world, seller } = await setup()
    // 예전 규칙으로 기록된 로그를 흉내 낸다: 차단 대상 하나를 번호 모양 ID로 바꾸고 스냅샷을 지운 뒤 새 인스턴스로 연다
    await world.database.pglite?.query(`update events set body = replace(body, '"UCZ-never-seen"', '"010-4826-1937"') where body like '%UCZ-never-seen%'`)
    await world.database.pglite?.query(`delete from snapshots`)
    const fresh = startServer(world.database, world.masterKey)
    const created = await client(fresh, seller.cookie).post('/api/broadcasts', { requestId: 'bc-phone-block', date: '2026-10-19' })
    expect(created.status, created.text).toBe(200)
    const events = await eventsOf(fresh, '2026-10-19')
    expect(events.map((event) => [event.seq, event.type, event.body.buyer ?? null])).toEqual([
      [1, 'broadcast.start', null],
      [2, 'host.blockBuyer', 'UCX'],
    ])
    expect(fresh.logs).toEqual([])
    fresh.server.close()
  })

  it('이어받는 차단도 checkEvent를 통과해야 기록한다 — 통과하지 못한 것만 빼고(seq를 쓰지 않음) 나머지·방송은 기록한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-18' })
    const block = (buyer: string, skipIfInvalid: boolean) => ({ fields: { type: 'host.blockBuyer', buyer, reason: INHERITED_BLOCK_REASON }, actor: { kind: 'server' as const }, skipIfInvalid })
    const write = (requestId: string, skipIfInvalid: boolean) =>
      world.server.writer.write({
        sellerId: seller.sellerId,
        date: b.date,
        createScope: false,
        requestId,
        build: () => [
          { fields: { type: 'host.blockBuyer', buyer: 'UCA', reason: '노쇼' }, actor: { kind: 'account', accountId: seller.accountId }, requestId },
          block('010-4826-1938', skipIfInvalid),
          block('', skipIfInvalid),
          block('UCB', skipIfInvalid),
        ],
      })
    // 표시가 없으면 요청 전체를 거절한다 (기록 없음)
    const rejected = await write('req-strict', false)
    expect(rejected.kind).toBe('rejected')
    expect(await eventsOf(world, b.date)).toHaveLength(1)
    // 표시가 있으면 그 이벤트만 빼고 기록한다
    const written = await write('req-skip', true)
    expect(written.kind).toBe('ok')
    expect((await eventsOf(world, b.date)).map((event) => [event.seq, event.body.buyer ?? event.type, event.actor])).toEqual([
      [1, 'broadcast.start', 'account'],
      [2, 'UCA', 'account'],
      [3, 'UCB', 'server'],
    ])
    expect(world.logs).toEqual([
      { level: 'warn', code: 'DRAFT_SKIPPED', date: b.date },
      { level: 'warn', code: 'DRAFT_SKIPPED', date: b.date },
    ])
    // 메모리 상태도 기록과 같은 seq까지 (거른 이벤트는 seq를 쓰지 않았다)
    expect((await world.server.writer.read(seller.sellerId, b.date)).seq).toBe(3)
  })
})

describe('AC-S04-28 재시작·스냅샷·형식', () => {
  async function busyScope(snapshotEvery: number) {
    const world = await newWorld({ snapshotEvery })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 10000, stock: 2 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: '라울', price: 8000 }))
    for (let i = 0; i < 6; i++) await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i)}`, nick: `n${String(i)}`, text: i % 2 === 0 ? '1' : '2' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 2, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 1, buyer: 'UC0', reason: '취소 요청' }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'c1', ch: 'UC2', nick: 'n2', text: '1 취소' })
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC4', date: b.date, amount: 5000 }, b.date))
    return { world, seller, b }
  }

  it('일정 이벤트 수마다와 broadcast.end 뒤에 스냅샷(상태 JSON·seq·형식 번호)을 저장한다', async () => {
    const { world, seller, b } = await busyScope(5)
    const rows = await world.database.pglite?.query<{ seq: number; format: number }>(`select seq, format from snapshots order by seq`)
    expect(rows?.rows).toEqual([
      { seq: 5, format: 4 },
      { seq: 10, format: 4 },
    ])
    await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-1' }))
    const after = await world.database.pglite?.query<{ seq: number }>(`select seq from snapshots order by seq`)
    expect(after?.rows.map((row) => row.seq)).toEqual([5, 10, 14])
  })

  it('스냅샷 쓰기가 실패해도 이벤트 기록·응답은 성공한다', async () => {
    const world = await newWorld({
      snapshotEvery: 1,
      hooks: {
        beforeSnapshot: () => {
          throw new Error('스냅샷 저장소 고장')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    expect(await countRows(world.database, 'snapshots')).toBe(0)
    expect(await countRows(world.database, 'events')).toBe(2)
    expect(world.logs.some((log) => log.code === 'SNAPSHOT_FAILED')).toBe(true)
    // 상태는 그대로 맞고, 재시작하면 스냅샷 없이 로그를 재생한다
    const fresh = startServer(world.database, world.masterKey)
    expect((await client(fresh, seller.cookie).get(`/api/days/${b.date}`)).body).toEqual((await client(world, seller.cookie).get(`/api/days/${b.date}`)).body)
  })

  it('같은 DB로 새 인스턴스를 열면 모든 조회 결과가 재시작 전과 같다 (스냅샷 + 뒤 이벤트)', async () => {
    const { world, seller, b } = await busyScope(4)
    const api = client(world, seller.cookie)
    const before = { view: await api.get(`/api/days/${b.date}`), list: await api.get('/api/broadcasts'), days: await api.get('/api/days') }
    const fresh = startServer(world.database, world.masterKey)
    const again = client(fresh, seller.cookie)
    expect((await again.get(`/api/days/${b.date}`)).body).toEqual(before.view.body)
    expect((await again.get('/api/broadcasts')).body).toEqual(before.list.body)
    expect((await again.get('/api/days')).body).toEqual(before.days.body)
    // 새 인스턴스는 스냅샷(seq 12)에서 시작해 뒤 이벤트만 재생했다
    let applied = 0
    const counting = startServer(world.database, world.masterKey, {
      engine: {
        applyEvent: (state, event: EngineEvent) => {
          applied++
          return applyEvent(state, event)
        },
      },
    })
    expect((await client(counting, seller.cookie).get(`/api/days/${b.date}`)).body).toEqual(before.view.body)
    expect(applied).toBe(13 - 12)
  })

  it('스냅샷 형식이 다르거나 읽을 수 없으면 쓰지 않고 처음부터 재생해 같은 결과를 낸다', async () => {
    const { world, seller, b } = await busyScope(4)
    const before = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body
    const pg = world.database.pglite
    // 가장 최근 스냅샷: 형식 번호를 옛 번호로
    await pg?.query(`update snapshots set format = 3 where seq = 12`)
    // 그다음 스냅샷: 읽을 수 없는 JSON
    await pg?.query(`update snapshots set state = '{"format":4, broken' where seq = 8`)
    // 남은 스냅샷: 형식 번호는 같은데 상태 안의 형식이 다름
    await pg?.query(`update snapshots set state = replace(state, '"format":4', '"format":3') where seq = 4`)
    let applied = 0
    const fresh = startServer(world.database, world.masterKey, {
      engine: {
        applyEvent: (state, event: EngineEvent) => {
          applied++
          return applyEvent(state, event)
        },
      },
    })
    expect((await client(fresh, seller.cookie).get(`/api/days/${b.date}`)).body).toEqual(before)
    // 형식이 같은 마지막 스냅샷(seq 8)은 읽을 수 없어 처음부터 13개를 재생했다
    expect(applied).toBe(13)
    expect(fresh.logs).toContainEqual({ level: 'warn', code: 'SNAPSHOT_UNUSABLE', date: b.date, seq: 8 })
  })

  it('스냅샷 상태가 손상돼 불변식이 깨졌으면 쓰지 않는다', async () => {
    const { world, seller, b } = await busyScope(4)
    const before = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body
    const pg = world.database.pglite
    const original = (await pg?.query<{ state: string }>(`select state from snapshots where seq = 12`))?.rows[0]?.state ?? ''
    expect(original).toMatch(/"subtotal":[1-9]/)
    await pg?.query(`update snapshots set state = regexp_replace(state, '"subtotal":[1-9][0-9]*', '"subtotal":7', 'g') where seq = 12`)
    expect((await pg?.query<{ state: string }>(`select state from snapshots where seq = 12`))?.rows[0]?.state).not.toBe(original)
    let applied = 0
    const fresh = startServer(world.database, world.masterKey, {
      clock: fakeClock(),
      engine: {
        applyEvent: (state, event: EngineEvent) => {
          applied++
          return applyEvent(state, event)
        },
      },
    })
    expect((await client(fresh, seller.cookie).get(`/api/days/${b.date}`)).body).toEqual(before)
    expect(applied).toBe(13)
  })
})
