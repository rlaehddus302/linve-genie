// V1 적대 시험 (test-domain, AC-V1-10~12·AC-V1-50 (2)~(5)): 서버 `sms` 쓰기의 `last4`를 공격한다.
// - 처음 말한 끝자리를 여러 요청이 동시에(다른 요청 번호, 두 인스턴스) 보내도 구매자는 한 사람이고 같은 사람이 한 상품에 찜 둘을 갖지 않는다
// - 같은 요청 번호 동시 두 번(두 인스턴스) → 찜 하나
// - 다른 판매자 토큰으로 남의 방송에 last4 → 기록·후보 노출 없음, 다른 판매자의 같은 끝자리 구매자는 후보가 아니다
// - 409 응답 후보에 키·전화번호가 없고, 로그에 본문·끝자리·키가 없다
// - 본문에 phoneKey·phoneLast4를 직접 넣어 서버 키를 덮어쓸 수 없다, 전화번호 칸에 끝자리 키 글을 넣어도 끝자리 구매자로 이어지지 않는다
// - last4 형식: 전각·3자리·5자리·영문·공백·줄바꿈·부호·배열·객체 → 400, 기록 없음
import { listBuyers, listClaims, type EngineState } from '@livejjim/core'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, startServer, writeEvent, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const DAY = '2026-10-22'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(world: TestServer, seller: Seller, nos: readonly number[] = [165, 166, 167], rehearsal = false): Promise<string> {
  const b = (await createBroadcast(world, seller, { date: DAY, ...(rehearsal ? { rehearsal: true } : {}) })).id
  for (const no of nos) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '핑크프릴', price: 10000 }))
  return b
}

async function stateOf(world: TestServer, seller: Seller): Promise<EngineState> {
  return (await world.server.writer.read(seller.sellerId, DAY)).state
}

async function smsBodies(world: TestServer): Promise<Record<string, unknown>[]> {
  const rows = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms' order by seq`))?.rows ?? []
  return rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

/** INV-2: 지금의 구매자 한 사람은 한 상품에 활성 찜을 최대 1개 */
function expectOneActivePerBuyerProduct(state: EngineState): void {
  const active = listClaims(state).filter((claim) => ['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'].includes(claim.status))
  const seen = new Set<string>()
  for (const claim of active) {
    const key = `${claim.buyer}|${String(claim.product)}`
    expect(seen.has(key), key).toBe(false)
    seen.add(key)
  }
}

describe('TD-V1-SRV 동시 쓰기 (AC-V1-50 (3))', () => {
  it('처음 말한 끝자리를 다른 요청 번호로 동시에 8번(상품 8개) → 문자 구매자는 한 사람, 찜 8개 모두 그 사람', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const nos = [101, 102, 103, 104, 105, 106, 107, 108]
    const b = await setup(world, seller, nos)
    const api = client(world, seller.cookie)
    const responses = await Promise.all(nos.map((no) => api.post('/api/events', { requestId: rid('race'), type: 'sms', b, no, last4: '1234' })))
    for (const response of responses) expect(response.status, response.text).toBe(200)
    const state = await stateOf(world, seller)
    const smsBuyers = listBuyers(state).filter((buyer) => buyer.kind === 'sms' && buyer.phoneLast4 === '1234')
    expect(new Set(smsBuyers.map((buyer) => buyer.current)).size).toBe(1)
    const claims = listClaims(state)
    expect(claims).toHaveLength(8)
    expect(new Set(claims.map((claim) => claim.buyer)).size).toBe(1)
    expect(new Set(responses.map((response) => response.body.buyer)).size).toBe(1)
  })

  it('두 인스턴스(같은 DB)에서 같은 끝자리를 다른 요청 번호로 동시에 → 한 사람, 같은 상품엔 찜 하나', async () => {
    const world = await newWorld()
    const second = startServer(world.database, world.masterKey, { clock: world.clock })
    const seller = await addSeller(world)
    const b = await setup(world, seller, [165, 166])
    const bodies = [165, 165, 166, 166, 165, 166].map((no) => ({ requestId: rid('two'), type: 'sms', b, no, last4: '4321' }))
    const responses = await Promise.all(bodies.map((body, i) => client(i % 2 === 0 ? world : second, seller.cookie).post('/api/events', body)))
    for (const response of responses) expect(response.status, response.text).toBe(200)
    const state = (await second.server.writer.read(seller.sellerId, DAY)).state
    const people = new Set(listBuyers(state).filter((buyer) => buyer.kind === 'sms' && buyer.phoneLast4 === '4321').map((buyer) => buyer.current))
    expect(people.size).toBe(1)
    expectOneActivePerBuyerProduct(state)
    expect(listClaims(state).filter((claim) => claim.status === 'CONFIRMED')).toHaveLength(2)
  })

  it('같은 요청 번호를 두 인스턴스에서 동시에 → 이벤트 하나·찜 하나·같은 응답', async () => {
    const world = await newWorld()
    const second = startServer(world.database, world.masterKey, { clock: world.clock })
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const body = { requestId: rid('twin'), type: 'sms', b, no: 165, last4: '7777' }
    const before = (await smsBodies(world)).length
    const [one, two] = await Promise.all([client(world, seller.cookie).post('/api/events', body), client(second, seller.cookie).post('/api/events', body)])
    expect(one.status, one.text).toBe(200)
    expect(two.status, two.text).toBe(200)
    expect(one.body.buyer).toBe(two.body.buyer)
    expect(one.body.seq).toBe(two.body.seq)
    expect((await smsBodies(world)).length).toBe(before + 1)
    expect(listClaims(await stateOf(world, seller))).toHaveLength(1)
  })
})

describe('TD-V1-SRV 판매자·범위 경계 (AC-V1-11·12, AC-V1-50 (2)·(4))', () => {
  it('판매자 B 토큰으로 판매자 A 방송에 last4 → 거절, A의 기록·후보가 B에게 보이지 않는다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const bSeller = await addSeller(world)
    const aB = await setup(world, a)
    await setup(world, bSeller)
    await expectOk(writeEvent(world, a, { type: 'sms', b: aB, no: 165, phone: '010-1111-1234', memo: '김씨' }))
    await expectOk(writeEvent(world, a, { type: 'sms', b: aB, no: 166, phone: '010-2222-1234', memo: '박씨' }))
    const events = await countRows(world.database, 'events')
    const response = await client(world, bSeller.cookie).post('/api/events', { requestId: rid('x'), type: 'sms', b: aB, no: 167, last4: '1234' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).not.toBe(409)
    expect(response.text).not.toMatch(/candidates|김씨|박씨|sms:/)
    expect(await countRows(world.database, 'events')).toBe(events)
  })

  it('다른 판매자·리허설 범위에 같은 끝자리가 여럿이어도 후보가 아니다 (내 실제 범위엔 없음 → 새 구매자)', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const other = await addSeller(world)
    const live = await setup(world, a)
    const rehearsal = await setup(world, a, [165, 166, 167], true)
    const otherB = await setup(world, other)
    for (const [seller, b] of [
      [other, otherB],
      [a, rehearsal],
    ] as const) {
      await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, phone: '010-1111-1234' }))
      await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-2222-1234' }))
    }
    const mine = await expectOk(writeEvent(world, a, { type: 'sms', b: live, no: 167, last4: '1234' }))
    expect(mine.body.phoneLast4).toBe('1234')
    const buyers = listBuyers(await stateOf(world, a))
    expect(buyers.map((buyer) => buyer.id)).toEqual([mine.body.buyer])
  })

  it('409 후보는 정확히 buyer·display·phoneLast4·claims 네 칸(D-V1-14), 키·전화번호·다른 판매자 구매자 없음, 로그에 끝자리·이름·키 없음', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const other = await addSeller(world)
    const b = await setup(world, a)
    const otherB = await setup(world, other)
    await expectOk(writeEvent(world, other, { type: 'sms', b: otherB, no: 165, phone: '010-3333-8642', memo: '남의손님' }))
    await expectOk(writeEvent(world, a, { type: 'sms', b, no: 165, phone: '010-1111-8642', memo: '첫손님' }))
    await expectOk(writeEvent(world, a, { type: 'sms', b, no: 166, phone: '010-2222-8642' }))
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '))
      })
    }
    const logsBefore = world.logs.length
    const response = await writeEvent(world, a, { type: 'sms', b, no: 167, last4: '8642', memo: '셋째손님' })
    expect(response.status).toBe(409)
    const candidates = response.body.candidates as Record<string, unknown>[]
    expect(candidates).toHaveLength(2)
    // D-V1-14·AC-V1-13: 후보마다 claims(그 범위의 활성 찜 상품 번호, 처음 찜한 순서)가 더해졌다 — 네 칸
    for (const candidate of candidates) expect(Object.keys(candidate).sort()).toEqual(['buyer', 'claims', 'display', 'phoneLast4'])
    // claims는 그 판매자·그 범위의 찜만 — 첫손님 165, 둘째 166 (남의 판매자 165는 섞이지 않는다)
    expect(candidates.map((candidate) => candidate.claims).sort()).toEqual([[165], [166]])
    expect(response.text).not.toMatch(/phoneKey|남의손님|0101111|0102222|0103333|셋째손님/)
    const keys = (await smsBodies(world)).map((event) => event.phoneKey).filter((key): key is string => typeof key === 'string')
    for (const key of keys) expect(response.text).not.toContain(key)
    const logged = [...printed, ...world.logs.slice(logsBefore).map((record) => JSON.stringify(record))].join('\n')
    for (const secret of ['8642', '셋째손님', 'last4', ...keys]) expect(logged).not.toContain(secret)
  })
})

describe('TD-V1-SRV 덮어쓰기·형식 (AC-V1-10, AC-V1-50 (5))', () => {
  it('본문의 phoneKey·phoneLast4는 서버가 정한 값을 덮어쓰지 못한다 (거절하거나 무시)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const victim = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, phone: '010-5555-0001' }))
    const victimKey = (await smsBodies(world))[0]?.phoneKey
    expect(typeof victimKey).toBe('string')
    const forged = await writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '9999', phoneKey: victimKey, phoneLast4: '0001' })
    if (forged.status === 200) {
      expect(forged.body.buyer).not.toBe(victim.body.buyer)
      const event = (await smsBodies(world)).at(-1)
      expect(event?.phoneKey).not.toBe(victimKey)
      expect(event?.phoneLast4).toBe('9999')
    } else expect(forged.status).toBe(400)
  })

  it('전화번호 칸에 끝자리 키 글을 넣어도 끝자리 구매자로 이어지지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const voiced = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234' }))
    for (const phone of [`livejjim/sms-last4/v1|${DAY}|live|1234`, `${DAY}|live|1234`, '1234']) {
      const typed = await writeEvent(world, seller, { type: 'sms', b, no: 166, phone })
      if (typed.status === 200) expect(typed.body.buyer).not.toBe(voiced.body.buyer)
      else expect(typed.status).toBe(400)
    }
  })

  it('last4 형식이 숫자 4개 글이 아니면 400, 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const events = await countRows(world.database, 'events')
    for (const last4 of ['１２３４', '123', '12345', '12a4', '1234\n', '\n1234', '+123', '-123', '1e34', '12.4', '0x12', '١٢٣٤', '𝟏𝟐𝟑𝟒', ['1234'], { 0: '1234' }, true, 1234, 0, '']) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 165, last4 })
      expect(response.status, JSON.stringify(last4)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'last4' }] } })
    }
    expect(await countRows(world.database, 'events')).toBe(events)
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('last4')
  })

  it('"0000"도 끝자리다 — 새 구매자로 넣고 다시 말하면 그 사람', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const first = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '0000' }))
    expect(first.body.phoneLast4).toBe('0000')
    const again = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '0000' }))
    expect(again.body.buyer).toBe(first.body.buyer)
  })
})

describe('TD-V1-SRV D-V1-14 409 후보의 claims (AC-V1-13·AC-V1-50 (6))', () => {
  it('claims는 그 범위의 활성 찜만 처음 찜한 순서 — 취소한 찜·리허설 범위 찜은 없고, 찜이 없으면 []', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const live = await setup(world, a, [165, 166, 167, 168, 169])
    const rehearsal = await setup(world, a, [165, 166, 167], true)
    // 리허설 범위에 같은 끝자리 손님 — 실제 방송 후보에도 claims에도 섞이면 안 된다
    await expectOk(writeEvent(world, a, { type: 'sms', b: rehearsal, no: 167, phone: '010-9999-8642' }))
    const first = await expectOk(writeEvent(world, a, { type: 'sms', b: live, no: 167, phone: '010-1111-8642' }))
    await expectOk(writeEvent(world, a, { type: 'sms', b: live, no: 165, phone: '010-1111-8642' }))
    await expectOk(writeEvent(world, a, { type: 'sms', b: live, no: 166, phone: '010-1111-8642' }))
    // 첫손님의 166 찜은 취소 → claims에서 빠진다
    await expectOk(writeEvent(world, a, { type: 'host.cancel', b: live, no: 166, buyer: first.body.buyer as string, reason: '구매자 요청' }))
    // 둘째 손님은 끝자리만 같고 찜을 모두 취소 → claims []
    const second = await expectOk(writeEvent(world, a, { type: 'sms', b: live, no: 168, phone: '010-2222-8642' }))
    await expectOk(writeEvent(world, a, { type: 'host.cancel', b: live, no: 168, buyer: second.body.buyer as string, reason: '구매자 요청' }))
    const response = await writeEvent(world, a, { type: 'sms', b: live, no: 169, last4: '8642' })
    expect(response.status, response.text).toBe(409)
    const candidates = response.body.candidates as { buyer: string; claims: unknown }[]
    expect(candidates).toHaveLength(2)
    const byBuyer = new Map(candidates.map((candidate) => [candidate.buyer, candidate.claims]))
    expect(byBuyer.get(first.body.buyer as string)).toEqual([167, 165])
    expect(byBuyer.get(second.body.buyer as string)).toEqual([])
    // 169는 기록되지 않았다
    expect(listClaims(await stateOf(world, a)).filter((claim) => claim.no === 169)).toEqual([])
  })
})
