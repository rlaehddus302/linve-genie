// AC-S06b-11 문자찜 쓰기 응답의 buyer (ORD-08 AC7, R-11 "문자찜 구매자 정하기", DAT-06, D-099, G-ENG-176, SA-S06-008).
// POST /api/events의 sms 응답에 그 문자찜이 정한 구매자 자신의 ID(코어 buyerOfRef(그 이벤트를 적용한 뒤 상태, ref))를 더한다.
// 같은 요청 번호의 재전송도 같은 값, 정하지 못했으면 null, 전화번호·메모는 담지 않는다.
import { applyEvent, buyerOfRef, getBuyer, listClaims, type EngineEvent } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-18'

/** DB에 기록한 그 seq의 문자찜 ref */
async function refAt(world: TestServer, seq: number): Promise<string> {
  const rows = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms' and seq = ${String(seq)}`))?.rows ?? []
  return (JSON.parse(rows[0]?.body ?? '{}') as { ref: string }).ref
}

async function setup(world: TestServer, seller: Seller, rehearsal = false): Promise<string> {
  const b = (await createBroadcast(world, seller, { date: DAY, ...(rehearsal ? { rehearsal: true } : {}) })).id
  for (const no of [15, 16]) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '핑크프릴', price: 10000 }))
  return b
}

describe('AC-S06b-11 문자찜 쓰기 응답의 buyer', () => {
  it('G-ENG-176 흐름: 뒤 4자리만 같은 두 번호 X·Y가 15번 1등·대기 → Y 번호로 다시 넣은 15번 문자찜은 찜이 없고 buyer는 Y(1등 X가 아니다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const first = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '010-1111-5678', memo: '김씨' }))
    const second = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '010-2222-5678', memo: '박씨' }))
    const x = `sms:${await refAt(world, first.body.seq as number)}`
    const y = `sms:${await refAt(world, second.body.seq as number)}`
    expect(first.body).toMatchObject({ buyer: x, phoneLast4: '5678' })
    expect(second.body).toMatchObject({ buyer: y, phoneLast4: '5678' })
    expect(x).not.toBe(y)
    // Y 번호로 다시: 전화번호 키로 Y에 이어지고, Y는 이미 15번에 활성 찜(대기)이 있어 새 찜이 생기지 않는다 (R-4 4번 줄)
    const again = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '010 2222 5678' }))
    expect(again.body.buyer).toBe(y)
    expect(again.body.phoneLast4).toBe('5678')
    const state = (await world.server.writer.read(seller.sellerId, DAY)).state
    expect(listClaims(state).filter((claim) => claim.seq === again.body.seq)).toEqual([])
    expect(listClaims(state).map((claim) => [claim.buyer, claim.status])).toEqual([
      [x, 'CONFIRMED'],
      [y, 'WAITLISTED'],
    ])
    // 응답 buyer = 코어 buyerOfRef(그 이벤트를 적용한 뒤 상태, ref)
    expect(buyerOfRef(state, await refAt(world, again.body.seq as number))).toBe(y)
    // X 번호로 다시 넣어도 X (1등)
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '01011115678' }))).body.buyer).toBe(x)
  })

  it('정하는 세 경우: 지정 구매자(합쳐져 있어도 그 자신), 전화번호 키로 이은 문자 구매자, 새 문자 구매자 = sms:<이 문자찜의 ref>', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    await world.server.ingestChat(seller.sellerId, { b, id: 'm2', ch: 'UC_B', nick: '영희', text: '안녕하세요' })
    // 1. 지정 구매자
    expect((await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, buyer: 'UC_A', memo: '김씨' }))).body.buyer).toBe('UC_A')
    // 지정 구매자가 다른 구매자에 합쳐져 있어도 지정한 그 자신 (지금의 구매자는 범위 조회의 buyers[].current)
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: 'UC_B', into: 'UC_A', reason: '같은 사람' }, DAY))
    const toMerged = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 16, buyer: 'UC_B' }))
    expect(toMerged.body.buyer).toBe('UC_B')
    const merged = (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))).body.buyers as { id: string; current: string }[]
    expect(merged.find((buyer) => buyer.id === 'UC_B')?.current).toBe('UC_A')
    // 3. 새 문자 구매자 (전화번호 없음): sms:<이 문자찜의 ref>
    const fresh = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 16, memo: '박씨' }))
    const ref = await refAt(world, fresh.body.seq as number)
    expect(ref).toMatch(/^[a-z]+$/)
    expect(fresh.body.buyer).toBe(`sms:${ref}`)
    // 2. 전화번호 키로 이은 문자 구매자: 처음 문자찜의 구매자
    const withPhone = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 16, phone: '010-3333-4444' }))
    const linked = await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 15, phone: '01033334444', memo: '최씨' }))
    expect(linked.body.buyer).toBe(withPhone.body.buyer)
    expect(linked.body.buyer).toBe(`sms:${await refAt(world, withPhone.body.seq as number)}`)
    expect(getBuyer((await world.server.writer.read(seller.sellerId, DAY)).state, linked.body.buyer as string)?.kind).toBe('sms')
  })

  it('같은 요청 번호의 재전송은 처음과 같은 buyer — 그 뒤 합치기·다른 문자찜·범위 상태를 메모리에서 내린 뒤에도, 동시에 보내도', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const api = client(world, seller.cookie)
    const body = { requestId: 'sms-once', type: 'sms', b, no: 15, phone: '010-5555-6666', memo: '김씨' }
    const first = await expectOk(api.post('/api/events', body))
    expect(first.body.buyer).toMatch(/^sms:[a-z]+$/)
    expect(await countRows(world.database, 'events')).toBe(4)
    expect((await expectOk(api.post('/api/events', body))).body).toEqual(first.body)
    // 내용이 달라도 같은 요청 번호면 처음 결과 그대로 (기록 없음)
    expect((await expectOk(api.post('/api/events', { ...body, phone: '010-7777-8888', no: 16 }))).body).toEqual(first.body)
    // 그 뒤 범위가 바뀌어도(같은 사람 문자찜, 다른 구매자에 합치기) 재전송의 buyer는 처음 값
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '16' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 16, phone: '01055556666' }))
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: first.body.buyer as string, into: 'UC_A', reason: '같은 사람' }, DAY))
    expect((await expectOk(api.post('/api/events', body))).body).toEqual(first.body)
    // 범위 상태를 메모리에서 내린 뒤(다시 불러온다)에도 같다
    world.server.writer.forget(seller.sellerId, DAY)
    expect((await expectOk(api.post('/api/events', body))).body).toEqual(first.body)
    // 다른 경로(방송 만들기)로 같은 요청 번호를 보내도 처음 문자찜 결과 그대로
    expect((await expectOk(api.post('/api/broadcasts', { requestId: 'sms-once', date: DAY }))).body).toEqual(first.body)
    // 동시에 같은 요청 번호: 기록은 한 번, 두 응답 모두 같은 buyer
    const twin = { requestId: 'sms-twin', type: 'sms', b, no: 16, memo: '쌍둥이' }
    const [one, two] = await Promise.all([expectOk(api.post('/api/events', twin)), expectOk(api.post('/api/events', twin))])
    expect(one.body).toEqual(two.body)
    expect(one.body.buyer).toBe(`sms:${await refAt(world, one.body.seq as number)}`)
  })

  it('정하지 못했으면 null — 엔진이 지정 구매자를 모르는 채로 적용한 문자찜(D-067), 다른 종류의 응답에는 buyer가 없다', async () => {
    // 서버는 모르는 지정 구매자를 기록 전에 거절한다(BUYER_NOT_FOUND). 엔진이 구매자를 정하지 않은 경우를 만들려고
    // 엔진 호출을 감싸 지정 구매자를 범위에 없는 ID로 바꿔 적용한다 (판정은 엔진 그대로)
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          const record = event as unknown as Record<string, unknown>
          return applyEvent(state, (record.type === 'sms' && record.buyer === 'UC_A' ? { ...record, buyer: 'UC_GHOST' } : event) as EngineEvent)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    await world.server.ingestChat(seller.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '안녕하세요' })
    const api = client(world, seller.cookie)
    const body = { requestId: 'sms-ghost', type: 'sms', b, no: 15, buyer: 'UC_A' }
    const unresolved = await expectOk(api.post('/api/events', body))
    expect(unresolved.body).toHaveProperty('buyer', null)
    expect((await expectOk(api.post('/api/events', body))).body).toEqual(unresolved.body)
    // 다른 종류: buyer 키가 없다
    const cancel = await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 15, buyer: 'UC_A', reason: '취소' }))
    expect(cancel.body).not.toHaveProperty('buyer')
    const register = await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 17, name: '라울', price: 5000 }))
    expect(register.body).not.toHaveProperty('buyer')
    // 모르는 지정 구매자는 기록 전에 거절 (그대로)
    const missing = await writeEvent(world, seller, { type: 'sms', b, no: 15, buyer: 'UC_NOBODY' })
    expect(missing.status).toBe(400)
    expect(missing.body).toMatchObject({ error: { code: 'BUYER_NOT_FOUND' } })
    expect(missing.body).not.toHaveProperty('buyer')
  })

  it('리허설 방송의 문자찜은 리허설 범위에서 정한 구매자', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const real = await setup(world, seller)
    const rehearsal = await setup(world, seller, true)
    const inReal = await expectOk(writeEvent(world, seller, { type: 'sms', b: real, no: 15, phone: '010-1212-3434' }))
    const inRehearsal = await expectOk(writeEvent(world, seller, { type: 'sms', b: rehearsal, no: 15, phone: '010-1212-3434' }))
    expect(inRehearsal.body.rehearsal).toBe(true)
    // 같은 번호라도 범위가 달라 각자의 새 문자 구매자 (리허설 범위는 실제 범위의 전화번호 키를 보지 않는다)
    expect(inRehearsal.body.buyer).not.toBe(inReal.body.buyer)
    const rehearsalState = (await world.server.writer.read(seller.sellerId, DAY, true)).state
    expect(getBuyer(rehearsalState, inRehearsal.body.buyer as string)).not.toBeNull()
    expect(getBuyer(rehearsalState, inReal.body.buyer as string)).toBeNull()
  })

  it('buyer에는 전화번호·메모가 없고, 응답·로그 어디에도 전화번호 원문이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await setup(world, seller)
    const api = client(world, seller.cookie)
    const texts: string[] = []
    for (const phone of ['010-2468-1357', '01024681357', '010 2468 1357']) {
      const body = { requestId: rid('sms'), type: 'sms', b, no: 15, phone, memo: '정씨' }
      const response = await expectOk(api.post('/api/events', body))
      const replay = await expectOk(api.post('/api/events', body))
      expect(response.body.buyer).toMatch(/^sms:[a-z]+$/)
      texts.push(response.text, replay.text)
    }
    const dump = await dumpAllTables(world.database)
    for (const text of [...texts, JSON.stringify(world.logs)]) {
      expect(text).not.toContain('2468')
      expect(text).not.toContain('정씨')
    }
    expect(dump).not.toContain('01024681357')
  })
})
