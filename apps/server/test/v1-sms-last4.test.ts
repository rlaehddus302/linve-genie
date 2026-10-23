// AC-V1-10~12 음성 문자찜의 뒤 4자리(last4)로 구매자 정하기 (SPEC ORD-08 AC9, D-V1-03·D-V1-10).
// 한 사람 → 지정 구매자, 없음 → 범위·뒤 4자리 키의 새 문자 구매자, 둘 이상 → 409 BUYER_AMBIGUOUS(기록 없음).
import { getBuyer, listBuyers, listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSellerKey, phoneKeyOf } from '../src/secrets.ts'
import { last4KeyText } from '../src/sms-last4.ts'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-22'
const NEXT = '2026-10-23'
const AMBIGUOUS = '끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(world: TestServer, seller: Seller, date = DAY, rehearsal = false): Promise<string> {
  const b = (await createBroadcast(world, seller, { date, ...(rehearsal ? { rehearsal: true } : {}) })).id
  for (const no of [165, 166, 167]) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '핑크프릴', price: 10000 }))
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

describe('AC-V1-10 sms 쓰기의 last4', () => {
  it('없음 → 범위·뒤 4자리 키의 새 문자 구매자, 같은 범위에서 다시 말하면 그 구매자(지정 구매자)로 이어진다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const first = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234' }))
    expect(first.body).toMatchObject({ type: 'sms', changed: true, phoneLast4: '1234', buyer: expect.stringMatching(/^sms:[a-z]+$/) as unknown })
    const state = (await world.server.writer.read(seller.sellerId, DAY)).state
    const buyer = getBuyer(state, first.body.buyer as string)
    expect(buyer).toMatchObject({ kind: 'sms', display: '문자찜', phoneLast4: '1234' })
    const [event] = await smsBodies(world)
    expect(Object.keys(event ?? {}).sort()).toEqual(['at', 'b', 'no', 'phoneKey', 'phoneLast4', 'received', 'ref', 'seq', 'type'])
    expect(event?.phoneKey).toBe(phoneKeyOf(await sellerKeyOf(world, seller), last4KeyText(DAY, false, '1234')))
    expect(listClaims(state).map((claim) => [claim.buyer, claim.status])).toEqual([[first.body.buyer, 'CONFIRMED']])

    // 이름을 함께 말했는데 그 사람의 표시 이름(이름 없음 '문자찜')과 다르면 409 고르기 (D-V1-14, AC-V1-13) — 기록 없음
    const named = await writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234', memo: '김민지' })
    expect(named.status).toBe(409)
    expect(named.body).toEqual({
      error: { code: 'BUYER_AMBIGUOUS', message: '끝자리 1234 손님의 이름이 달라요. 누구인지 골라 주세요.' },
      candidates: [{ buyer: first.body.buyer, display: '문자찜', phoneLast4: '1234', claims: [165] }],
    })
    expect(await smsBodies(world)).toHaveLength(1)
    // 다시: 뒤 4자리만 말했고 한 사람 → 그 구매자를 지정 구매자로 (phoneKey·phoneLast4 없이 — R-11 1)
    const again = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234' }))
    expect(again.body.buyer).toBe(first.body.buyer)
    expect(again.body.phoneLast4).toBeNull()
    const second = (await smsBodies(world))[1]
    expect(second).toMatchObject({ buyer: first.body.buyer })
    expect(second).not.toHaveProperty('phoneKey')
    expect(second).not.toHaveProperty('phoneLast4')
    const after = (await world.server.writer.read(seller.sellerId, DAY)).state
    expect(listClaims(after).map((claim) => claim.buyer)).toEqual([first.body.buyer, first.body.buyer])
    // 이미 1등인 같은 번호를 다시 말하면 새 찜 없음, 응답 buyer는 그 구매자 (D-099)
    const repeat = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234' }))
    expect(repeat.body.buyer).toBe(first.body.buyer)
    expect(listClaims((await world.server.writer.read(seller.sellerId, DAY)).state)).toHaveLength(2)
    expect(listBuyers((await world.server.writer.read(seller.sellerId, DAY)).state)).toHaveLength(1)
  })

  it('손 입력 전화번호로 만든 문자 구매자도 뒤 4자리가 같으면 한 사람으로 찾는다 (키가 아니라 지정 구매자)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const typed = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, phone: '010-1111-1234', memo: '김씨' }))
    const voiced = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, last4: '1234' }))
    expect(voiced.body.buyer).toBe(typed.body.buyer)
    expect((await smsBodies(world))[1]).toMatchObject({ buyer: typed.body.buyer })
  })

  it('둘 이상 → 기록하지 않고 409 BUYER_AMBIGUOUS, 후보는 지금의 구매자(처음 생긴 순서)의 ID·표시 이름·뒤 4자리뿐', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const x = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, phone: '010-1111-1234', memo: '김씨' }))
    const y = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-2222-1234' }))
    // 다른 끝자리는 후보가 아니다
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, phone: '010-3333-5678' }))
    const events = await countRows(world.database, 'events')
    const body = { requestId: rid('amb'), type: 'sms', b, no: 167, last4: '1234' }
    const response = await client(world, seller.cookie).post('/api/events', body)
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: { code: 'BUYER_AMBIGUOUS', message: AMBIGUOUS },
      candidates: [
        { buyer: x.body.buyer, display: '문자찜(김씨)', phoneLast4: '1234', claims: [165] },
        { buyer: y.body.buyer, display: '문자찜', phoneLast4: '1234', claims: [166] },
      ],
    })
    expect(response.text).not.toMatch(/phoneKey|0101111|0102222/)
    expect(await countRows(world.database, 'events')).toBe(events)
    // 같은 요청 번호로 다시 보내도 409 (기록이 없으므로 새로 판단)
    const retry = await client(world, seller.cookie).post('/api/events', body)
    expect(retry.status).toBe(409)
    expect(retry.body).toEqual(response.body)
    // 후보를 골라 buyer로 보내면 기록 (같은 요청 번호도 가능 — 409는 기록이 없다)
    const chosen = await expectOk(client(world, seller.cookie).post('/api/events', { requestId: body.requestId, type: 'sms', b, no: 167, buyer: y.body.buyer }))
    expect(chosen.body.buyer).toBe(y.body.buyer)
    // 고른 뒤 같은 요청 번호는 처음 기록한 결과 그대로
    expect((await expectOk(client(world, seller.cookie).post('/api/events', body))).body).toEqual(chosen.body)
  })

  it('합친 두 구매자는 한 사람 — 지금의 구매자로 이어진다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const x = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, phone: '010-1111-1234' }))
    const y = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-2222-1234' }))
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: y.body.buyer, into: x.body.buyer, reason: '같은 사람' }, DAY))
    const voiced = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '1234' }))
    expect(voiced.body.buyer).toBe(x.body.buyer)
    // 유튜브 구매자에 합쳐진 문자 구매자 → 지금의 구매자(유튜브)가 후보
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: x.body.buyer, into: 'UC_A', reason: '같은 사람' }, DAY))
    const toYoutube = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234' }))
    expect(toYoutube.body.buyer).toBe('UC_A')
  })

  it('리허설 범위와 실제 범위는 따로 찾고 키도 다르다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const live = await setup(world, seller)
    const rehearsal = await setup(world, seller, DAY, true)
    const a = await expectOk(writeEvent(world, seller, { type: 'sms', b: live, no: 165, last4: '1234' }))
    const r = await expectOk(writeEvent(world, seller, { type: 'sms', b: rehearsal, no: 165, last4: '1234' }))
    expect(r.body).toMatchObject({ rehearsal: true, phoneLast4: '1234' })
    const [liveEvent, rehearsalEvent] = await smsBodies(world)
    expect(liveEvent?.phoneKey).not.toBe(rehearsalEvent?.phoneKey)
    // 리허설 구매자는 실제 범위에서 후보가 아니다: 실제 범위의 두 번째는 실제 구매자로 이어진다
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b: live, no: 166, last4: '1234' }))).body.buyer).toBe(a.body.buyer)
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b: rehearsal, no: 166, last4: '1234' }))).body.buyer).toBe(r.body.buyer)
  })

  it('같은 요청 번호: 다시 보내면 처음과 같은 응답, 동시에 두 번 보내도 찜 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const api = client(world, seller.cookie)
    const body = { requestId: 'v1-once', type: 'sms', b, no: 165, last4: '1234' }
    const first = await expectOk(api.post('/api/events', body))
    expect((await expectOk(api.post('/api/events', body))).body).toEqual(first.body)
    const twin = { requestId: 'v1-twin', type: 'sms', b, no: 166, last4: '5678' }
    const [one, two] = await Promise.all([expectOk(api.post('/api/events', twin)), expectOk(api.post('/api/events', twin))])
    expect(one.body).toEqual(two.body)
    const claims = listClaims((await world.server.writer.read(seller.sellerId, DAY)).state)
    expect(claims.filter((claim) => claim.buyer === one.body.buyer)).toHaveLength(1)
  })

  it('last4 형식이 틀리거나 phone·buyer와 함께면 400 (칸 오류, 기록 없음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    const events = await countRows(world.database, 'events')
    for (const last4 of ['１２３４', '123', '12345', '12a4', 1234, null, '', ' 1234', '٣٤٥٦']) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 165, last4 })
      expect(response.status, String(last4)).toBe(400)
      expect(response.body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'last4', message: '끝자리는 숫자 네 개로 적어 주세요.' }] } })
    }
    for (const extra of [{ phone: '010-1111-1234' }, { buyer: 'UC_A' }]) {
      const response = await writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', ...extra })
      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'last4' }] } })
      expect(response.text).not.toContain('1234')
    }
    expect(await countRows(world.database, 'events')).toBe(events)
  })

  it('메모·옵션·수량·받은 시각 검사는 손 입력과 같다 (메모의 휴대폰 번호 거절, 받은 시각 형식)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const memo = await writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', memo: '010-1234-5678' })
    expect(memo.status).toBe(400)
    expect(memo.body).toMatchObject({ error: { problems: [{ field: 'memo' }] } })
    const received = await writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', received: '25:00' })
    expect(received.status).toBe(400)
    expect(received.body).toMatchObject({ error: { problems: [{ field: 'received' }] } })
    const ok = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '1234', received: '11:30', memo: '김민지' }))
    expect((await smsBodies(world))[0]).toMatchObject({ received: '11:30', memo: '김민지', phoneLast4: '1234' })
    expect(getBuyer((await world.server.writer.read(seller.sellerId, DAY)).state, ok.body.buyer as string)?.display).toBe('문자찜(김민지)')
  })
})

describe('AC-V1-11 끝자리 키는 범위 밖과 이어지지 않는다', () => {
  it('다른 날·다른 판매자·손 입력 전화번호의 키와 모두 다르고, 다른 날의 구매자는 후보가 아니다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const other = await addSeller(world)
    const day1 = await setup(world, a, DAY)
    const day2 = await setup(world, a, NEXT)
    const otherB = await setup(world, other, DAY)
    const first = await expectOk(writeEvent(world, a, { type: 'sms', b: day1, no: 165, last4: '1234' }))
    // 10/22 범위에 두 사람을 만들어도 10/23엔 후보가 없다 → 새 구매자
    await expectOk(writeEvent(world, a, { type: 'sms', b: day1, no: 166, phone: '010-9999-1234' }))
    const next = await expectOk(writeEvent(world, a, { type: 'sms', b: day2, no: 165, last4: '1234' }))
    expect(next.body.phoneLast4).toBe('1234')
    expect(listBuyers((await world.server.writer.read(a.sellerId, NEXT)).state).map((buyer) => buyer.id)).toEqual([next.body.buyer])
    const otherSms = await expectOk(writeEvent(world, other, { type: 'sms', b: otherB, no: 165, last4: '1234' }))
    expect(otherSms.body.phoneLast4).toBe('1234')
    const typed = await expectOk(writeEvent(world, a, { type: 'sms', b: day2, no: 166, phone: '010-1111-1234' }))
    // 10/23 범위에 한 사람(끝자리 키 구매자)이 있었으므로 손 입력 번호 구매자는 전화번호 키로 새 구매자 — 끝자리 키와 다르다
    const bodies = await smsBodies(world)
    const keys = bodies.map((event) => event.phoneKey).filter((key): key is string => typeof key === 'string')
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(5)
    expect(typed.body.buyer).not.toBe(next.body.buyer)
    expect(first.body.buyer).not.toBe(next.body.buyer)
    // 다른 판매자의 구매자는 후보가 될 수 없다
    const stateOther = (await world.server.writer.read(other.sellerId, DAY)).state
    expect(listBuyers(stateOther).map((buyer) => buyer.id)).toEqual([otherSms.body.buyer])
  })

  it('지난 구매(BUY-05)는 끝자리 키로 두 날을 잇지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const day1 = await setup(world, seller, DAY)
    const day2 = await setup(world, seller, NEXT)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: day1, no: 165, last4: '1234' }))
    // 대조: 손 입력 전화번호는 두 날을 잇는다
    await expectOk(writeEvent(world, seller, { type: 'sms', b: day1, no: 166, phone: '010-5555-7777' }))
    const typed = await expectOk(writeEvent(world, seller, { type: 'sms', b: day2, no: 166, phone: '010-5555-7777' }))
    const next = await expectOk(writeEvent(world, seller, { type: 'sms', b: day2, no: 165, last4: '1234' }))
    const pastOf = async (buyer: string) => {
      const response = await client(world, seller.cookie).get(`/api/days/${NEXT}/past?buyer=${encodeURIComponent(buyer)}`)
      expect(response.status, response.text).toBe(200)
      return (response.body.items ?? []) as unknown[]
    }
    expect((await pastOf(typed.body.buyer as string)).length).toBeGreaterThan(0)
    expect(await pastOf(next.body.buyer as string)).toEqual([])
  })
})

describe('AC-V1-12 로그·응답에 남지 않음', () => {
  it('서버 로그·콘솔에 뒤 4자리·이름 메모·키·요청 본문이 없다 (성공·409·400 모두)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '))
      })
    }
    const b = await setup(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 165, last4: '4821', memo: '김민지' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-7777-9395' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 166, phone: '010-6666-9395' }))
    expect((await writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '9395', memo: '박서준' })).status).toBe(409)
    expect((await writeEvent(world, seller, { type: 'sms', b, no: 167, last4: '93a5' })).status).toBe(400)
    const keys = (await smsBodies(world)).map((event) => event.phoneKey).filter((key): key is string => typeof key === 'string')
    const text = [...printed, ...world.logs.map((record) => JSON.stringify(record))].join('\n')
    for (const secret of ['4821', '9395', '93a5', '김민지', '박서준', 'last4', ...keys]) expect(text).not.toContain(secret)
    // DB에도 원 전화번호는 없다 (뒤 4자리는 phoneLast4로만)
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('01077779395')
    expect(dump).not.toContain('last4')
  })
})
