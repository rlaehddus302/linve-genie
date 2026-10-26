// MOB2 D-MOB2-09 (RA-MOB2-02) 서버 쪽 전제 확인 — 서버 코드는 바꾸지 않는다.
// 화면은 받은 시각을 비운 문자찜이 끊김으로 실패하면 그 칸에 처음 "넣기"를 누른 시각을 채워 같은 요청 번호로 다시 보낸다.
// (1) 처음 것이 이미 기록됐으면(응답만 잃음) 본문이 달라도 처음 기록·처음 응답 그대로, 기록은 하나
// (2) 기록되지 않았으면 채운 시각이 받은 시각 — RECEIVED_TIME 방송에서 끊긴 사이 들어온 채팅찜보다 앞선다
import { listClaims } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { addSeller, client, countRows, createBroadcast, expectOk, newWorld, writeEvent } from './support.ts'

const DAY = '2026-10-19'
const kst = (time: string) => Date.parse(`${DAY}T${time}+09:00`)

async function smsBodies(world: Awaited<ReturnType<typeof newWorld>>): Promise<Record<string, unknown>[]> {
  const rows = (await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms' order by seq`))?.rows ?? []
  return rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

describe('MOB2 D-MOB2-09 받은 시각을 채워 다시 보낸 문자찜', () => {
  it('처음 것이 기록됐으면 받은 시각을 채운 다시 보내기도 처음 응답 그대로이고, 기록·받은 시각은 처음 것 하나', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    const api = client(world, seller.cookie)
    world.clock.set(kst('20:01:05'))
    const first = await expectOk(api.post('/api/events', { requestId: 'mob2-sms-1', type: 'sms', b: b.id, no: 15 }))
    const before = await countRows(world.database, 'events')
    world.clock.set(kst('20:01:47'))
    const again = await expectOk(api.post('/api/events', { requestId: 'mob2-sms-1', type: 'sms', b: b.id, no: 15, received: '20:01:05' }))
    expect(again.body).toEqual(first.body)
    expect(await countRows(world.database, 'events')).toBe(before)
    expect((await smsBodies(world)).map((event) => event.received)).toEqual(['20:01:05'])
  })

  it('처음 것이 기록되지 않았으면 채운 시각이 받은 시각 — RECEIVED_TIME 방송에서 끊긴 사이 들어온 채팅찜보다 문자찜이 1등', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    // 20:01:05 처음 누름 — 끊겨 서버에 닿지 않음. 20:01:30 같은 번호 채팅찜이 먼저 기록됨
    world.clock.set(kst('20:01:30'))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' })
    // 20:01:47 연결이 돌아와 채운 시각으로 다시 보냄
    world.clock.set(kst('20:01:47'))
    await expectOk(api.post('/api/events', { requestId: 'mob2-sms-2', type: 'sms', b: b.id, no: 15, received: '20:01:05' }))
    expect((await smsBodies(world)).map((event) => event.received)).toEqual(['20:01:05'])
    const claims = listClaims((await world.server.writer.read(seller.sellerId, DAY)).state).filter((claim) => claim.no === 15)
    const byOrigin = Object.fromEntries(claims.map((claim) => [claim.origin, claim.status]))
    expect(byOrigin).toEqual({ sms: 'CONFIRMED', chat: 'WAITLISTED' })
  })

  it('대조: 받은 시각을 비운 채 다시 보내면(D-MOB2-09 전 동작) 다시 보낸 때가 받은 시각이라 채팅찜 뒤가 된다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'contention.policy': 'RECEIVED_TIME' } }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    world.clock.set(kst('20:01:30'))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15' })
    world.clock.set(kst('20:01:47'))
    await expectOk(api.post('/api/events', { requestId: 'mob2-sms-3', type: 'sms', b: b.id, no: 15 }))
    expect((await smsBodies(world)).map((event) => event.received)).toEqual(['20:01:47'])
    const claims = listClaims((await world.server.writer.read(seller.sellerId, DAY)).state).filter((claim) => claim.no === 15)
    expect(Object.fromEntries(claims.map((claim) => [claim.origin, claim.status]))).toEqual({ sms: 'WAITLISTED', chat: 'CONFIRMED' })
  })
})
