// AC-V1-13 이름이 다른 끝자리 손님·후보의 찜 번호·새 손님 (D-V1-14), AC-V1-14 여러 기기의 같은 음성 쓰기 (D-V1-13).
import { getBuyer, listBuyers, listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSellerKey, phoneKeyOf } from '../src/secrets.ts'
import { last4KeyText, newBuyerKeyText } from '../src/sms-last4.ts'
import { addSeller, client, countRows, createBroadcast, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-22'
const MISMATCH = '끝자리 1234 손님의 이름이 달라요. 누구인지 골라 주세요.'
const AMBIGUOUS = '끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.'
const REPEATED = { error: { code: 'VOICE_REPEATED', message: '같은 말을 다른 기기에서 방금 넣었어요.' } }

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(world: TestServer, seller: Seller, rehearsal = false): Promise<string> {
  const b = (await createBroadcast(world, seller, { date: DAY, ...(rehearsal ? { rehearsal: true } : {}) })).id
  for (const no of [15, 22, 165, 166, 167, 168]) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '핑크프릴', price: 10000 }))
  return b
}

async function smsBodies(world: TestServer): Promise<Record<string, unknown>[]> {
  const rows = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms' order by seq`))?.rows ?? []
  return rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

async function sellerKeyOf(world: TestServer, seller: Seller): Promise<Buffer> {
  const rows = (await world.database.pglite?.query<{ phone_key_enc: string }>(`select phone_key_enc from sellers where id = '${seller.sellerId}'`))?.rows ?? []
  return openSellerKey(Buffer.from(world.masterKey, 'base64'), seller.sellerId, rows[0]?.phone_key_enc ?? '')
}

const stateOf = async (world: TestServer, seller: Seller, rehearsal = false) => (await world.server.writer.read(seller.sellerId, DAY, rehearsal)).state

describe('AC-V1-13 이름이 다른 끝자리 손님 (D-V1-14)', () => {
  it('후보 한 사람의 표시 이름이 문자찜(<말한 이름>)이 아니면 409 고르기, 같으면·이름 없이면 그 사람', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const kim = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', memo: '김민지' }))
    const events = await countRows(world.database, 'events')

    const response = await writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234', memo: '박영희' })
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: { code: 'BUYER_AMBIGUOUS', message: MISMATCH },
      candidates: [{ buyer: kim.body.buyer, display: '문자찜(김민지)', phoneLast4: '1234', claims: [165] }],
    })
    expect(response.text).not.toMatch(/phoneKey|박영희/)
    expect(await countRows(world.database, 'events')).toBe(events)
    expect(getBuyer(await stateOf(world, seller), kim.body.buyer as string)?.display).toBe('문자찜(김민지)')

    // 같은 이름(앞뒤 공백은 엔진처럼 뺀다) → 그 사람
    const same = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234', memo: ' 김민지 ' }))
    expect(same.body.buyer).toBe(kim.body.buyer)
    // 이름 없이(빈 메모 포함) → 그 사람 (D-V1-03)
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '1234' }))).body.buyer).toBe(kim.body.buyer)
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 168, last4: '1234', memo: '  ' }))).body.buyer).toBe(kim.body.buyer)
    expect(listBuyers(await stateOf(world, seller))).toHaveLength(1)
  })

  it('후보의 표시 이름이 문자찜(이름 없음)·문자찜(확인 필요)·유튜브 닉네임(합친 사람)이고 이름을 말했으면 409', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const plain = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1111' }))
    const unsure = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '2222', memo: '확인 필요' }))
    const merged = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '3333', memo: '홍길동' }))
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: merged.body.buyer, into: 'UC_A', reason: '같은 사람' }, DAY))
    const cases: [string, unknown, string, number[]][] = [
      ['1111', plain.body.buyer, '문자찜', [165]],
      ['2222', unsure.body.buyer, '문자찜(확인 필요)', [165]],
      ['3333', 'UC_A', '홍길동', [166]],
    ]
    for (const [last4, buyer, display, claims] of cases) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 167, last4, memo: '홍길동' })
      expect(response.status, last4).toBe(409)
      expect(response.body).toEqual({
        error: { code: 'BUYER_AMBIGUOUS', message: `끝자리 ${last4} 손님의 이름이 달라요. 누구인지 골라 주세요.` },
        candidates: [{ buyer, display, phoneLast4: last4, claims }],
      })
    }
    // 대기 한 개(165번 2222)가 claims에 들어 있다 — 활성 찜은 확정·대기·보류·충돌
    expect(listClaims(await stateOf(world, seller)).find((claim) => claim.currentBuyer === unsure.body.buyer)?.status).toBe('WAITLISTED')
  })

  it('후보가 둘 이상인 409도 후보마다 claims (활성 찜 상품 번호, 처음 찜한 순서, 같은 번호 한 번, 없으면 [])', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    // 같은 표시 이름 "문자찜(김씨)" 두 사람
    const x = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 22, phone: '010-1111-1234', memo: '김씨' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, buyer: x.body.buyer }))
    const y = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '010-2222-1234', memo: '김씨' }))
    const z = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-3333-1234' }))
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 166, buyer: z.body.buyer, reason: '손님 취소' }))
    const response = await writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '1234', memo: '김씨' })
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: { code: 'BUYER_AMBIGUOUS', message: AMBIGUOUS },
      candidates: [
        { buyer: x.body.buyer, display: '문자찜(김씨)', phoneLast4: '1234', claims: [22, 15] },
        { buyer: y.body.buyer, display: '문자찜(김씨)', phoneLast4: '1234', claims: [15] },
        { buyer: z.body.buyer, display: '문자찜', phoneLast4: '1234', claims: [] },
      ],
    })
    expect(response.text).not.toMatch(/phoneKey|0101111|0102222|0103333/)
  })
})

describe('AC-V1-13 새 손님으로 넣기 (newBuyer, D-V1-14)', () => {
  it('후보를 찾지 않고 새 문자 구매자 — 키는 범위·뒤 4자리·그 문자찜 ref의 HMAC, 다음 뒤 4자리만은 후보 둘이라 409', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const kim = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', memo: '김민지' }))
    const park = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234', memo: '박영희', newBuyer: true }))
    expect(park.body.buyer).not.toBe(kim.body.buyer)
    expect(park.body.phoneLast4).toBe('1234')
    const state = await stateOf(world, seller)
    expect(getBuyer(state, park.body.buyer as string)).toMatchObject({ kind: 'sms', display: '문자찜(박영희)', phoneLast4: '1234' })
    expect(getBuyer(state, kim.body.buyer as string)?.display).toBe('문자찜(김민지)')
    expect(listClaims(state).map((claim) => [claim.no, claim.buyer])).toEqual([
      [165, kim.body.buyer],
      [166, park.body.buyer],
    ])
    const [kimEvent, parkEvent] = await smsBodies(world)
    expect(Object.keys(parkEvent ?? {}).sort()).toEqual(['at', 'b', 'memo', 'no', 'phoneKey', 'phoneLast4', 'received', 'ref', 'seq', 'type'])
    const key = await sellerKeyOf(world, seller)
    expect(parkEvent?.phoneKey).toBe(phoneKeyOf(key, newBuyerKeyText(DAY, false, '1234', parkEvent?.ref as string)))
    expect(parkEvent?.phoneKey).not.toBe(kimEvent?.phoneKey)
    expect(kimEvent?.phoneKey).toBe(phoneKeyOf(key, last4KeyText(DAY, false, '1234')))

    const both = await writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '1234' })
    expect(both.status).toBe(409)
    expect(both.body).toEqual({
      error: { code: 'BUYER_AMBIGUOUS', message: AMBIGUOUS },
      candidates: [
        { buyer: kim.body.buyer, display: '문자찜(김민지)', phoneLast4: '1234', claims: [165] },
        { buyer: park.body.buyer, display: '문자찜(박영희)', phoneLast4: '1234', claims: [166] },
      ],
    })
    // 새 손님으로 한 번 더 → 또 다른 새 구매자 (그 문자찜에만 쓰는 키)
    const third = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '1234', newBuyer: true }))
    expect([kim.body.buyer, park.body.buyer]).not.toContain(third.body.buyer)
    expect(listBuyers(await stateOf(world, seller))).toHaveLength(3)
  })

  it('같은 요청 번호로 다시 보내면 처음 응답, 새 구매자는 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const body = { requestId: rid('new'), type: 'sms', b, no: 165, last4: '1234', newBuyer: true }
    const first = await expectOk(client(world, seller.cookie).post('/api/events', body))
    expect((await expectOk(client(world, seller.cookie).post('/api/events', body))).body).toEqual(first.body)
    expect(listBuyers(await stateOf(world, seller))).toHaveLength(1)
  })

  it('newBuyer가 true가 아니거나, last4 없이, phone·buyer와 함께면 400 (기록 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    const events = await countRows(world.database, 'events')
    const bodies: Record<string, unknown>[] = [
      { last4: '1234', newBuyer: false },
      { last4: '1234', newBuyer: 'true' },
      { last4: '1234', newBuyer: 1 },
      { last4: '1234', newBuyer: null },
      { newBuyer: true },
      { newBuyer: true, memo: '박영희' },
      { newBuyer: true, phone: '010-1111-1234' },
      { newBuyer: true, buyer: 'UC_A' },
      { last4: '1234', newBuyer: true, phone: '010-1111-1234' },
      { last4: '1234', newBuyer: true, buyer: 'UC_A' },
    ]
    for (const extra of bodies) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 165, ...extra })
      expect(response.status, JSON.stringify(extra)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT' } })
      expect(response.text).not.toContain('1234')
    }
    expect(await countRows(world.database, 'events')).toBe(events)
  })
})

describe('AC-V1-14 여러 기기의 같은 음성 쓰기 (D-V1-13)', () => {
  it('10초 안에 다른 요청 번호로 같은 말 → 409 VOICE_REPEATED, 165번에 문자찜 하나(대기 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const said = { type: 'sms', b, no: 165, voice: true, memo: '확인 필요' }
    await expectOk(writeEvent(world, seller, said))
    world.clock.advance(3_000)
    const events = await countRows(world.database, 'events')
    const second = await writeEvent(world, seller, said)
    expect(second.status).toBe(409)
    expect(second.body).toEqual(REPEATED)
    expect(await countRows(world.database, 'events')).toBe(events)
    const claims = listClaims(await stateOf(world, seller))
    expect(claims.map((claim) => [claim.no, claim.status])).toEqual([[165, 'CONFIRMED']])
    // voice는 엔진 이벤트에 남지 않는다
    expect(await smsBodies(world)).toHaveLength(1)
    expect((await smsBodies(world))[0]).not.toHaveProperty('voice')
  })

  it('경계: 도착 시각 차 10,000ms는 막고 10,001ms는 기록한다 (앞 기록과의 차)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const said = { type: 'sms', b, no: 165, voice: true }
    await expectOk(writeEvent(world, seller, said))
    world.clock.advance(10_000)
    expect((await writeEvent(world, seller, said)).status).toBe(409)
    world.clock.advance(1)
    const later = await expectOk(writeEvent(world, seller, said))
    expect(later.body.changed).toBe(true)
    expect(listClaims(await stateOf(world, seller))).toHaveLength(2)
    // 새로 기록한 쓰기가 다시 10초 창을 연다
    world.clock.advance(10_000)
    expect((await writeEvent(world, seller, said)).body).toEqual(REPEATED)
  })

  it('구매자 말·주문이 다르거나, 손 입력이거나, 앞 쓰기가 기록되지 않았으면 지금처럼', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, voice: true, last4: '1234' }))
    // 구매자 말 다름: 끝자리 5678, 메모 다름, 메모 있음/없음
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, voice: true, last4: '5678' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, voice: true, memo: '김민지' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, voice: true, memo: '박영희' }))
    // 주문 다름: 번호·수량
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, voice: true, last4: '1234' }))
    // 손 입력(voice 없음)은 해당 없다 — 음성 쓰기 바로 뒤의 같은 본문도, 그 뒤의 음성 쓰기도
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, memo: '확인 필요' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, voice: true, memo: '확인 필요' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, memo: '확인 필요' }))
    // 기록되지 않은 앞 쓰기(409 고르기)는 두지 않는다: 두 번째도 BUYER_AMBIGUOUS
    const amb = { type: 'sms', b, no: 168, voice: true, last4: '1234', memo: '최수진' }
    expect((await writeEvent(world, seller, amb)).body).toMatchObject({ error: { code: 'BUYER_AMBIGUOUS' } })
    expect((await writeEvent(world, seller, amb)).body).toMatchObject({ error: { code: 'BUYER_AMBIGUOUS' } })
    // 기록되지 않은 앞 쓰기(400)도 두지 않는다
    expect((await writeEvent(world, seller, { type: 'sms', b, no: 168, voice: true, received: '25:00' })).status).toBe(400)
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 168, voice: true }))
  })

  it('같은 요청 번호를 다시 보내면 이 검사 전에 처음 응답 (멱등)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const body = { requestId: rid('voice'), type: 'sms', b, no: 165, voice: true }
    const first = await expectOk(client(world, seller.cookie).post('/api/events', body))
    world.clock.advance(1_000)
    expect((await expectOk(client(world, seller.cookie).post('/api/events', body))).body).toEqual(first.body)
    // 다시 보내기가 앞 등록을 지우지 않는다 — 다른 기기의 같은 말은 여전히 막는다
    expect((await writeEvent(world, seller, { type: 'sms', b, no: 165, voice: true })).body).toEqual(REPEATED)
  })

  it('두 기기가 거의 함께 보내도 하나만 기록', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const said = { type: 'sms', b, no: 166, voice: true, memo: '확인 필요' }
    const results = await Promise.all([writeEvent(world, seller, said), writeEvent(world, seller, said), writeEvent(world, seller, said)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(listClaims(await stateOf(world, seller)).map((claim) => [claim.no, claim.status])).toEqual([[166, 'CONFIRMED']])
  })

  it('다른 범위(리허설)·다른 판매자와 섞이지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const live = await setup(world, seller)
    const rehearsal = await setup(world, seller, true)
    const otherB = await setup(world, other)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: live, no: 165, voice: true }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: rehearsal, no: 165, voice: true }))
    await expectOk(writeEvent(world, other, { type: 'sms', b: otherB, no: 165, voice: true }))
    expect((await writeEvent(world, seller, { type: 'sms', b: rehearsal, no: 165, voice: true })).body).toEqual(REPEATED)
  })

  it('voice가 true가 아니면 400 (기록 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const events = await countRows(world.database, 'events')
    for (const voice of [false, 'true', 1, null]) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 165, voice })
      expect(response.status, String(voice)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'voice' }] } })
    }
    expect(await countRows(world.database, 'events')).toBe(events)
  })

  it('기록이 커밋되지 않았으면(저장 실패) 등록하지 않는다 — 다음 기기의 같은 말은 기록', async () => {
    const failing = { on: false }
    const world = await newWorld({
      hooks: {
        beforeCommit: (records) => {
          if (failing.on && records.some((r) => r.type === 'sms')) throw new Error('planted-db-error')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const said = { type: 'sms', b, no: 165, voice: true }
    failing.on = true
    expect((await writeEvent(world, seller, said)).status).toBeGreaterThanOrEqual(500)
    failing.on = false
    await expectOk(writeEvent(world, seller, said))
    expect(listClaims(await stateOf(world, seller))).toHaveLength(1)
  })

  it('409 응답·로그에 뒤 4자리·이름이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '))
      })
    }
    const b = await setup(world, seller)
    const said = { type: 'sms', b, no: 165, voice: true, last4: '4821', memo: '김민지' }
    await expectOk(writeEvent(world, seller, said))
    const again = await writeEvent(world, seller, said)
    expect(again.body).toEqual(REPEATED)
    const text = [again.text, ...printed, ...world.logs.map((record) => JSON.stringify(record))].join('\n')
    for (const secret of ['4821', '김민지']) expect(text).not.toContain(secret)
  })
})
