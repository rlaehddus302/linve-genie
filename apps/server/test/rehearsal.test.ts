// AC-S05-50 리허설 방송과 범위 분리 (YT-09 AC1·AC3, R-0 6, R-9, R-12, R-13, D-081).
// 리허설 방송은 엔진 범위 (판매자, 날짜, 리허설)에 들어가 같은 날 실제 범위와 seq·이벤트 로그·스냅샷·발송함·정산·구매자·알림이 따로다.
import { listBroadcasts, listBuyers, listSettlements } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { INHERITED_BLOCK_REASON } from '../src/service.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, sseReader, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'

async function rows<T>(world: TestServer, sql: string, params: unknown[] = []): Promise<T[]> {
  return ((await world.database.pglite?.query<T>(sql, params))?.rows ?? []) as T[]
}

async function setFee(world: TestServer, seller: Seller, fee: number): Promise<void> {
  await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'shipping.baseFee': fee } }))
}

/** 번호 하나를 등록하고 채팅으로 1등을 만든다 */
async function sale(world: TestServer, seller: Seller, b: string, no: number, channel: string): Promise<void> {
  await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '구피', price: 10000 }))
  const result = await world.server.ingestChat(seller.sellerId, { b, id: `${b}-${channel}-${String(no)}`, ch: channel, nick: channel, text: String(no) })
  expect(result.status).toBe('recorded')
}

describe('AC-S05-50 리허설 방송 만들기', () => {
  it('리허설 여부를 받고(기본 아님) 응답·목록에 리허설인지가 있다. 리허설이 아닌 값은 400', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const real = await createBroadcast(world, seller, { date: DAY })
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    expect(real.rehearsal).toBe(false)
    expect(rehearsal.rehearsal).toBe(true)
    // 범위가 따로라 둘 다 그 범위의 seq 1이고 기본 제목도 각각 1부
    expect([real.seq, rehearsal.seq]).toEqual([1, 1])
    const list = (await api.get('/api/broadcasts')).body.broadcasts as { id: string; title: string; rehearsal: boolean }[]
    expect(list.map((item) => [item.id, item.title, item.rehearsal])).toEqual([
      [real.id, '1부', false],
      [rehearsal.id, '1부', true],
    ])
    const bad = await api.post('/api/broadcasts', { requestId: rid(), date: DAY, rehearsal: 'yes' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'rehearsal', message: '리허설인지는 예나 아니오로만 정할 수 있어요.' }] } })
    // 같은 요청 번호로 다시 보내면 처음 결과 (리허설인지 포함)
    const body = { requestId: rid(), date: DAY, rehearsal: true }
    const first = await expectOk(api.post('/api/broadcasts', body))
    const again = await expectOk(api.post('/api/broadcasts', { ...body, rehearsal: false }))
    expect(again.body).toEqual(first.body)
    expect(first.body).toMatchObject({ rehearsal: true, broadcast: { rehearsal: true } })
  })

  it('기존 범위·발송함은 모두 실제(마이그레이션 기본값)이고, 범위 행의 유일 키는 (판매자, 날짜, 리허설)이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller, { date: DAY })
    await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const scopes = await rows<{ date: string; rehearsal: boolean; seq: number }>(world, 'select date, rehearsal, seq from scopes order by rehearsal')
    expect(scopes).toEqual([
      { date: DAY, rehearsal: false, seq: 1 },
      { date: DAY, rehearsal: true, seq: 1 },
    ])
  })
})

describe('AC-S05-50 범위 고르기', () => {
  it('b가 있는 이벤트는 그 방송의 범위로, 리허설을 따로 적으면 400. b가 없는 이벤트는 rehearsal=true일 때만 리허설 범위', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    // 실제 범위가 아직 없다: 날짜만 적은 쓰기는 실제 범위라 404 (리허설 범위로 가지 않는다)
    expect((await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCa', reason: '장난' }, DAY)).status).toBe(404)
    expect((await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCa', reason: '장난' }, DAY, false)).status).toBe(404)
    const blocked = await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCa', reason: '장난' }, DAY, true))
    expect(blocked.body).toMatchObject({ date: DAY, rehearsal: true, seq: 2 })
    const registered = await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no: 1, name: 'a', price: 1000 }))
    expect(registered.body).toMatchObject({ rehearsal: true, seq: 3 })
    const mixed = await writeEvent(world, seller, { type: 'product.open', b: rehearsal.id, no: 1 }, undefined, true)
    expect(mixed.status).toBe(400)
    expect(mixed.body).toMatchObject({ error: { problems: [{ field: 'rehearsal' }] } })
    const odd = await client(world, seller.cookie).post(`/api/events?date=${DAY}&rehearsal=1`, { requestId: rid(), type: 'host.blockBuyer', buyer: 'UCb', reason: '장난' })
    expect(odd.status).toBe(400)
    expect(odd.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'rehearsal' }] } })
    // 조회도 같다: 적지 않으면 실제 범위(없음 → 404)
    expect((await api.get(`/api/days/${DAY}`)).status).toBe(404)
    expect((await api.get(`/api/days/${DAY}?rehearsal=false`)).status).toBe(404)
    expect((await api.get(`/api/days/${DAY}/history`)).status).toBe(404)
    const view = await expectOk(api.get(`/api/days/${DAY}?rehearsal=true`))
    expect(view.body).toMatchObject({ date: DAY, rehearsal: true, seq: 3 })
    expect((await api.get(`/api/days/${DAY}?rehearsal=yes`)).status).toBe(400)
    const history = await expectOk(api.get(`/api/days/${DAY}/history?rehearsal=true`))
    expect((history.body.events as { type: string }[]).map((event) => event.type)).toEqual(['broadcast.start', 'host.blockBuyer', 'product.register'])
  })

  it('같은 날 리허설과 실제: seq·이벤트 로그·구매자·정산·범위 목록이 따로다 (실제 조회에 리허설 구매자·정산 묶음이 없다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await sale(world, seller, rehearsal.id, 1, 'sim_c1')
    const real = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, real.id, 1, 'UCreal')
    const realView = (await expectOk(api.get(`/api/days/${DAY}`))).body
    const rehearsalView = (await expectOk(api.get(`/api/days/${DAY}?rehearsal=true`))).body
    expect(realView.seq).toBe(3)
    expect(rehearsalView.seq).toBe(3)
    expect((realView.broadcasts as { id: string }[]).map((b) => b.id)).toEqual([real.id])
    expect((rehearsalView.broadcasts as { id: string }[]).map((b) => b.id)).toEqual([rehearsal.id])
    expect((realView.buyers as { id: string }[]).map((b) => b.id)).toEqual(['UCreal'])
    expect((rehearsalView.buyers as { id: string }[]).map((b) => b.id)).toEqual(['sim_c1'])
    expect((realView.settlements as { buyer: string }[]).map((s) => s.buyer)).toEqual(['UCreal'])
    // 범위 목록: 적지 않으면 실제 범위만, rehearsal=true면 리허설 범위만
    expect((await api.get('/api/days')).body).toEqual({ days: [{ date: DAY, rehearsal: false, seq: 3 }] })
    expect((await api.get('/api/days?rehearsal=true')).body).toEqual({ days: [{ date: DAY, rehearsal: true, seq: 3 }] })
    expect((await api.get('/api/days?rehearsal=false')).body).toEqual({ days: [{ date: DAY, rehearsal: false, seq: 3 }] })
    // 메모리 상태도 따로 (리허설을 적지 않은 read는 실제 범위)
    const realState = (await world.server.writer.read(seller.sellerId, DAY)).state
    const rehearsalState = (await world.server.writer.read(seller.sellerId, DAY, true)).state
    expect(listBuyers(realState).map((b) => b.id)).toEqual(['UCreal'])
    expect(listBroadcasts(rehearsalState).map((b) => b.id)).toEqual([rehearsal.id])
  })

  it('같은 날 리허설 방송을 먼저 만들어도 실제 정산 묶음의 배송비 설정은 실제 첫 방송의 스냅샷이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await setFee(world, seller, 3000)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await setFee(world, seller, 5000)
    const real = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, real.id, 1, 'UCreal')
    await sale(world, seller, rehearsal.id, 1, 'sim_c1')
    const realSettlements = listSettlements((await world.server.writer.read(seller.sellerId, DAY)).state)
    const rehearsalSettlements = listSettlements((await world.server.writer.read(seller.sellerId, DAY, true)).state)
    expect(realSettlements.map((s) => [s.buyer, s.subtotal, s.shipping])).toEqual([['UCreal', 10000, 5000]])
    expect(rehearsalSettlements.map((s) => [s.buyer, s.subtotal, s.shipping])).toEqual([['sim_c1', 10000, 3000]])
  })

  it('리허설 범위의 발송함 행은 리허설 표시를 단다 (실제 범위 행은 아니다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const real = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, rehearsal.id, 1, 'sim_c1')
    await sale(world, seller, real.id, 1, 'UCreal')
    const outbox = await rows<{ rehearsal: boolean; scope: boolean; kind: string }>(
      world,
      'select o.rehearsal, s.rehearsal as scope, o.kind from outbox o join scopes s on s.id = o.scope_id order by o.id',
    )
    expect(outbox.length).toBe(4) // 범위마다 라벨·감사
    for (const row of outbox) expect(row.rehearsal).toBe(row.scope)
    expect(outbox.filter((row) => row.rehearsal).map((row) => row.kind).sort()).toEqual(['POST_THANKS', 'PRINT_PRODUCT_LABEL'])
  })

  it('다른 판매자의 리허설 방송은 404 (쓰기·조회 어디서도 보이지 않는다)', async () => {
    const world = await newWorld()
    const owner = await addSeller(world)
    const other = await addSeller(world)
    const rehearsal = await createBroadcast(world, owner, { date: DAY, rehearsal: true })
    expect((await writeEvent(world, other, { type: 'product.register', b: rehearsal.id, no: 1, name: 'a', price: 1 })).status).toBe(404)
    expect((await client(world, other.cookie).get(`/api/days/${DAY}?rehearsal=true`)).status).toBe(404)
    expect((await client(world, other.cookie).get('/api/days?rehearsal=true')).body).toEqual({ days: [] })
    expect((await client(world, other.cookie).post(`/api/broadcasts/${rehearsal.id}/end`, { requestId: rid() })).status).toBe(404)
    expect((await world.server.ingestChat(other.sellerId, { b: rehearsal.id, id: 'x', ch: 'UC1', nick: 'n', text: '1' })).status).toBe('not_found')
  })

  it('리허설 방송 끝내기는 그 리허설 범위에 기록한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const ended = await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${rehearsal.id}/end`, { requestId: rid() }))
    expect(ended.body).toMatchObject({ date: DAY, rehearsal: true, seq: 2, type: 'broadcast.end', changed: true })
    const list = (await client(world, seller.cookie).get('/api/broadcasts')).body.broadcasts as { rehearsal: boolean; ended: boolean }[]
    expect(list).toMatchObject([{ rehearsal: true, ended: true }])
  })
})

describe('AC-S05-50 차단 이어받기와 리허설', () => {
  async function blocked(world: TestServer, seller: Seller, date: string, rehearsal: boolean): Promise<string[]> {
    const events = await rows<{ body: string; actor: string }>(
      world,
      `select e.body, e.actor from events e join scopes s on s.id = e.scope_id where s.date = $1 and s.rehearsal = $2 and e.type = 'host.blockBuyer' order by e.seq`,
      [date, rehearsal],
    )
    return events.filter((event) => event.actor === 'server').map((event) => (JSON.parse(event.body) as { buyer: string; reason: string }).buyer)
  }

  it('리허설 범위는 이어받지 않고(실제·리허설 어느 쪽에서도), 넘겨주지도 않는다. 실제 범위는 실제 범위에서만 이어받는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller, { date: '2026-10-17' })
    await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCreal-blocked', reason: '노쇼' }, '2026-10-17'))
    // 10/18 리허설: 실제 10/17 차단을 이어받지 않는다
    await createBroadcast(world, seller, { date: '2026-10-18', rehearsal: true })
    expect(await blocked(world, seller, '2026-10-18', true)).toEqual([])
    await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'sim_rehearsal-blocked', reason: '연습' }, '2026-10-18', true))
    // 10/19 리허설: 10/18 리허설 차단도 이어받지 않는다
    await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    expect(await blocked(world, seller, '2026-10-19', true)).toEqual([])
    // 10/19 실제: 이전 실제 범위(10/17)에서만 — 더 늦은 리허설 범위(10/18·10/19)를 건너뛴다
    await createBroadcast(world, seller, { date: '2026-10-19' })
    expect(await blocked(world, seller, '2026-10-19', false)).toEqual(['UCreal-blocked'])
    const history = (await client(world, seller.cookie).get('/api/days/2026-10-19/history')).body.events as { type: string; reason: string | null }[]
    expect(history.map((event) => [event.type, event.reason])).toEqual([
      ['broadcast.start', null],
      ['host.blockBuyer', INHERITED_BLOCK_REASON],
    ])
  })
})

describe('AC-S05-50 실시간 알림·재생 검사', () => {
  it('ready의 범위 목록과 change 알림은 범위를 날짜와 리허설인지로 알린다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await createBroadcast(world, seller, { date: DAY })
    await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const response = await client(world, seller.cookie).raw('/api/stream', {})
    const reader = sseReader(response)
    try {
      await reader.until(() => reader.events.length >= 1)
      expect(JSON.parse(reader.events[0]?.data ?? '{}')).toEqual({
        scopes: [
          { date: DAY, rehearsal: false, seq: 1 },
          { date: DAY, rehearsal: true, seq: 1 },
        ],
      })
      await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCx', reason: '장난' }, DAY, true))
      await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCx', reason: '장난' }, DAY))
      await reader.until(() => reader.events.filter((event) => event.event === 'change').length >= 2)
      expect(reader.events.filter((event) => event.event === 'change').map((event) => JSON.parse(event.data) as unknown)).toEqual([
        { date: DAY, rehearsal: true, seq: 2, type: 'host.blockBuyer' },
        { date: DAY, rehearsal: false, seq: 2, type: 'host.blockBuyer' },
      ])
    } finally {
      await reader.cancel()
      world.server.close()
    }
  })

  it('재생 무결성 검사 명령은 리허설 범위도 검사한다 (리허설 표시와 함께)', async () => {
    const world = await newWorld({ snapshotEvery: 2 })
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await sale(world, seller, rehearsal.id, 1, 'sim_c1')
    await createBroadcast(world, seller, { date: DAY })
    const results = await checkReplay(world.database.db)
    expect(results.map((result) => [result.date, result.rehearsal, result.ok, result.events])).toEqual([
      [DAY, false, true, 1],
      [DAY, true, true, 3],
    ])
    expect(await checkReplay(world.database.db, { rehearsal: true })).toHaveLength(1)
    await world.database.pglite?.exec(`update events set body = replace(body, '"text":"1"', '"text":"2"') where type = 'chat'`)
    const [, broken] = await checkReplay(world.database.db)
    expect(broken).toMatchObject({ rehearsal: true, ok: false, firstDiff: { part: '이벤트' } })
  })
})
