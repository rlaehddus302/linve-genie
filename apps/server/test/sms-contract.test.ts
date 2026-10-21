// AC-S06-16 문자찜 쓰기 계약 (S04 그대로 확인 — R-1, R-11, DAT-06, D-061, D-073, D-079, D-089, AC-S04-31).
// 휴대폰 문자찜 입력 화면(ORD-08)이 기대는 계약을 한곳에서 다시 확인한다. 이미 있는 시험(sms-privacy.test.ts)이 덮는 것은 그쪽에 두고,
// 빠진 것 — 비운 받은 시각이 실행 환경 시간대와 상관없이 KST 초까지, 받는 형식 표, 리허설 범위·404, 응답 모양 — 을 더한다.
import { listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'
const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

async function smsBodies(world: TestServer): Promise<Record<string, unknown>[]> {
  const rows = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms' order by seq`))?.rows ?? []
  return rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

/** KST 날짜·시각 → UTC 밀리초 */
const kst = (date: string, time: string, ms = 0) => Date.parse(`${date}T${time}+09:00`) + ms

describe('AC-S06-16 문자찜 쓰기 계약', () => {
  it('받은 시각을 비우면 서버가 그 입력의 도착 시각을 KST HH:MM:SS로 적는다 — 실행 환경 시간대와 상관없이(호놀룰루·UTC·뉴욕·서울)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const cases: [string, number, string][] = [
      ['Pacific/Honolulu', kst(DAY, '20:01:05', 400), '20:01:05'], // 밀리초는 버린다 (분까지로 올리거나 앞당기지 않는다)
      ['UTC', kst(DAY, '23:59:59', 999), '23:59:59'],
      ['America/New_York', kst('2026-10-20', '00:00:00'), '00:00:00'], // KST 자정 = UTC 15:00 (호놀룰루 05:00, 뉴욕 11:00)
      ['Asia/Seoul', kst('2026-10-20', '08:30:07'), '08:30:07'],
    ]
    for (const [zone, at] of cases) {
      process.env.TZ = zone
      world.clock.set(at)
      const response = await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1 }))
      expect(response.body.seq, zone).toEqual(expect.any(Number))
    }
    expect((await smsBodies(world)).map((event) => event.received)).toEqual(cases.map(([, , want]) => want))
    // 초까지 적은 값이라 같은 분에 먼저 온 유튜브 찜과 동률이 되지 않는다 (G-ENG-169의 재료 — 이벤트의 at과 같은 초)
    for (const event of await smsBodies(world)) expect(event.received).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('받은 시각을 적으면 HH:MM·HH:MM:SS만 그대로 받고, 그 밖(12시간 표기·숫자만·범위 밖·앞뒤 공백·소수 초)은 400이고 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const received of ['20:01', '20:01:05', '08:01', '00:30', '23:59:59']) await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received }))
    expect((await smsBodies(world)).map((event) => event.received)).toEqual(['20:01', '20:01:05', '08:01', '00:30', '23:59:59'])
    const before = await countRows(world.database, 'events')
    for (const received of ['8:01', '오후 8:01', '2001', '200105', '20:1', '20:61', '24:00', '20:01:60', ' 20:01', '20:01 ', '20:01:05.5', '20-01', 2001, true, null, '']) {
      const response = await writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received })
      expect(response.status, JSON.stringify(received)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'received' }] } })
    }
    expect(await countRows(world.database, 'events')).toBe(before)
  })

  it('응답: date·rehearsal·seq·type·changed·effects·phoneLast4(전화번호가 없거나 읽지 못하면 null)·buyer(AC-S06b-11). 같은 요청 번호는 한 번만 기록', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    const api = client(world, seller.cookie)
    const withPhone = await expectOk(api.post('/api/events', { requestId: 'sms-a', type: 'sms', b: b.id, no: 15, phone: '010-1234-5678', memo: '김씨' }))
    expect(Object.keys(withPhone.body).sort()).toEqual(['buyer', 'changed', 'date', 'effects', 'phoneLast4', 'rehearsal', 'seq', 'type'])
    expect(withPhone.body).toMatchObject({ date: DAY, rehearsal: false, seq: 3, type: 'sms', changed: true, phoneLast4: '5678' })
    const noPhone = await expectOk(api.post('/api/events', { requestId: 'sms-b', type: 'sms', b: b.id, no: 15 }))
    expect(noPhone.body).toMatchObject({ seq: 4, changed: true, phoneLast4: null })
    // 같은 요청 번호 재전송: 처음 결과 그대로, 기록은 한 번
    const again = await expectOk(api.post('/api/events', { requestId: 'sms-a', type: 'sms', b: b.id, no: 15, phone: '010-1234-5678', memo: '김씨' }))
    expect(again.body).toEqual(withPhone.body)
    expect(await countRows(world.database, 'events')).toBe(4)
    // 응답 seq의 찜 = 그 입력으로 생긴 찜 (화면 결과 카드가 찾는 방법, AC-S06-14)
    const state = (await world.server.writer.read(seller.sellerId, DAY)).state
    const claims = listClaims(state).filter((claim) => claim.origin === 'sms')
    expect(claims.map((claim) => claim.seq)).toEqual([3, 4])
    expect(claims.map((claim) => claim.status)).toEqual(['CONFIRMED', 'WAITLISTED'])
    // 응답·DB 어디에도 전화번호 원문·정규화 번호가 없다
    const dump = await dumpAllTables(world.database)
    for (const text of [withPhone.text, again.text, dump]) {
      expect(text).not.toContain('010-1234-5678')
      expect(text).not.toContain('01012345678')
    }
  })

  it('지정 구매자(buyer)로 넣으면 그 구매자의 찜이 되고 메모가 유튜브 이름을 바꾸지 않는다. 같은 사람 하나 더(같은 buyer)도 그 구매자다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [15, 16]) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: '구피', price: 10000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, buyer: 'UC_A', memo: '김씨' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 16, buyer: 'UC_A' }))
    const view = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))
    const buyers = view.body.buyers as { id: string; display: string }[]
    expect(buyers.find((buyer) => buyer.id === 'UC_A')?.display).toBe('홍길동')
    const claims = (view.body.claims as { buyer: string; no: number; origin: string; status: string }[]).filter((claim) => claim.origin === 'sms')
    expect(claims.map((claim) => [claim.no, claim.buyer, claim.status])).toEqual([
      [15, 'UC_A', 'CONFIRMED'],
      [16, 'UC_A', 'CONFIRMED'],
    ])
  })

  it('리허설 방송이면 리허설 범위로 가고, 다른 판매자·없는 방송이면 404이고 기록하지 않는다 (전화번호 키도 만들지 않는다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const stranger: Seller = await addSeller(world)
    const real = await createBroadcast(world, seller, { date: DAY })
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    const inRehearsal = await expectOk(writeEvent(world, seller, { type: 'sms', b: rehearsal.id, no: 1, phone: '010-2222-3333' }))
    expect(inRehearsal.body).toMatchObject({ date: DAY, rehearsal: true, seq: 2, phoneLast4: '3333' })
    const realView = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))
    expect(realView.body.seq).toBe(1)
    expect(realView.body.claims).toEqual([])
    const rehearsalView = await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}?rehearsal=true`))
    expect((rehearsalView.body.claims as { origin: string }[]).map((claim) => claim.origin)).toEqual(['sms'])
    // 리허설을 따로 적거나 날짜를 적으면 400 (방송이 범위를 정한다)
    expect((await writeEvent(world, seller, { type: 'sms', b: rehearsal.id, no: 1 }, undefined, true)).status).toBe(400)
    expect((await writeEvent(world, seller, { type: 'sms', b: real.id, no: 1 }, DAY)).status).toBe(400)
    const before = await countRows(world.database, 'events')
    expect((await writeEvent(world, stranger, { type: 'sms', b: real.id, no: 1, phone: '010-4444-5555' })).status).toBe(404)
    expect((await writeEvent(world, seller, { type: 'sms', b: 'no-such-broadcast', no: 1, phone: '010-4444-5555' })).status).toBe(404)
    expect((await client(world, seller.cookie).post('/api/events', { requestId: rid(), type: 'sms', no: 1 })).status).toBe(400)
    expect(await countRows(world.database, 'events')).toBe(before)
    // 거절한 전화번호는 어디에도 없다 — 번호 전체·뒤 4자리 값 그대로. (맨 글자 '5555'는 무작위 ID·요약값 안에 우연히 들 수 있어 값 경계로 본다)
    const dump = await dumpAllTables(world.database)
    for (const trace of ['4444-5555', '44445555', '"5555"', '\\"5555\\"']) expect(dump).not.toContain(trace)
  })
})
