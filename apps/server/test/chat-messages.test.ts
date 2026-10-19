// AC-S05-20 메시지 조회 (R-4, R-7 4, D-062, D-076, D-085, D-086): GET /api/days/:date/messages
// - 주문·취소·무시·바꾼 번호는 엔진의 메시지 기록(코어 listMessages)과 같고, 언급은 그 방송 스냅샷 설정의 parseChat mentions다.
// - 이어 받기(after)·이전(before)·가장 최근, 개수 상한 500. 그날 메시지 전체를 한 번에 주는 길은 없다.
// - 리허설 방송의 메시지는 리허설을 명시해야 보인다. 응답에 전화번호 키·판매자 키가 없다. 로그에 본문·닉네임이 없다.
// AC-S05-35 상품별 조치 기록: 이력 조회에 방송·번호 거르기.
import { applyEvent, listClaims, listMessages, parseChat, type SettingsOverride } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'

interface Message {
  id: string
  broadcast: string
  channel: string
  nick: string
  text: string
  owner: boolean
  seq: number
  at: string
  publishedAt: string
  ignored: boolean
  order: boolean
  cancel: boolean
  orders: number[]
  cancels: number[]
  mentions: number[]
  converted: number[]
  claims: string[]
  failed: boolean
}

async function messages(world: TestServer, seller: Seller, query = ''): Promise<{ status: number; body: { seq: number; messages: Message[]; more: boolean; rehearsal: boolean }; text: string }> {
  const response = await client(world, seller.cookie).get(`/api/days/${DAY}/messages${query}`)
  return { status: response.status, body: response.body as never, text: response.text }
}

const TEXTS = ['15', '15번', '찜15', '15번이요', '15 취소', '15번 예뻐요', '3개 남았나요?', '1 2', '안녕', '15 1000원', '1000번', '십오번', '15 16 취소', '15,16', '20 21 22', '<img src=x onerror=alert(1)>', '15\n16']

describe('AC-S05-20 메시지 조회 = 엔진 기록', () => {
  it('무작위 채팅 로그에서 API의 주문·취소·무시·바꾼 번호 = 코어 listMessages, 언급 = parseChat, 찜 = 그 메시지 seq의 채팅·변환 찜 (STRICT·LOOSE·방송자 무시 끔·maxNumber·IGNORE)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<SettingsOverride>({}, { 'claim.parseMode': 'LOOSE' }, { 'claim.ignoreOwner': false }, { 'claim.maxNumber': 20, 'claim.multiNumber': 'IGNORE' }, { 'claim.multiNumber': 'FIRST' }),
        fc.array(fc.tuple(fc.constantFrom(...TEXTS), fc.boolean(), fc.constantFrom('UCa', 'UCb', 'UCc'), fc.option(fc.integer({ min: 0, max: 30 }), { nil: null })), { minLength: 1, maxLength: 30 }),
        async (settings, lines) => {
          const world = await newWorld()
          const seller = await addSeller(world)
          await expectOk(client(world, seller.cookie).patch('/api/settings', { settings }))
          const b = await createBroadcast(world, seller, { date: DAY })
          for (const no of [15, 16, 20]) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: 'a', price: 1000 }))
          for (const [index, [text, owner, ch, convert]] of lines.entries()) {
            await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(index)}`, ch, nick: ch, text, owner })
            // 가끔 앞 메시지를 찜으로 바꿔 본다 (주문·취소·무시였으면 엔진이 아무 일도 하지 않는다)
            if (convert !== null && convert < index) await writeEvent(world, seller, { type: 'host.convertMessage', b: b.id, msg: `m${String(convert)}`, no: 16 })
          }
          const response = await messages(world, seller, '?limit=500')
          expect(response.status).toBe(200)
          const state = (await world.server.writer.read(seller.sellerId, DAY)).state
          const engine = listMessages(state)
          const claims = listClaims(state)
          const snapshot = { ...settings }
          expect(response.body.messages.map((m) => m.id)).toEqual(engine.map((m) => m.id))
          response.body.messages.forEach((message, index) => {
            const record = engine[index]
            const [text, owner] = lines[index] as [string, boolean, string, number | null]
            const parsed = parseChat(text, snapshot)
            expect(message).toMatchObject({ seq: record?.seq, channel: record?.channel, ignored: record?.ignored, order: record?.order, cancel: record?.cancel, converted: record?.converted })
            expect(message.text).toBe(text)
            expect(message.owner).toBe(owner)
            expect(message.mentions).toEqual(parsed.mentions)
            expect(message.orders).toEqual(record?.order === true ? parsed.claims : [])
            expect(message.cancels).toEqual(record?.cancel === true ? parsed.cancels : [])
            expect(message.claims).toEqual(claims.filter((claim) => (claim.origin === 'chat' || claim.origin === 'convert') && claim.seq === message.seq).map((claim) => claim.id))
            expect(message.failed).toBe(false)
          })
          world.server.close()
        },
      ),
      { numRuns: 15 },
    )
  })

  it('항목 모양: ID·채널·닉네임·본문·게시/도착 시각(UTC ISO)·방송자·주문·취소·무시·주문/취소 번호·언급·바꾼 번호·찜 ID — 전화번호 키·판매자 키 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: 'a', price: 1000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, received: '11:00', phone: '010-1234-5678' }))
    const published = world.clock.now() - 3000
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '15번 주세요 16', publishedAt: published })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC2', nick: '김철수', text: '15' })
    const response = await messages(world, seller)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ date: DAY, rehearsal: false, seq: 5, more: false })
    expect(response.body.messages[1]).toEqual({
      id: 'm2',
      broadcast: b.id,
      channel: 'UC2',
      nick: '김철수',
      text: '15',
      owner: false,
      seq: 5,
      at: new Date(world.clock.now()).toISOString(),
      publishedAt: new Date(world.clock.now()).toISOString(),
      ignored: false,
      order: true,
      cancel: false,
      orders: [15],
      cancels: [],
      mentions: [], // 주문인 메시지는 언급이 아니다 (parseChat 그대로)
      converted: [],
      claims: ['c2'],
      failed: false,
    })
    expect(response.body.messages[0]).toMatchObject({ id: 'm1', publishedAt: new Date(published).toISOString(), order: false, orders: [], mentions: [15, 16] })
    expect(response.text).not.toMatch(/phoneKey|phone_key|sellerKey|010-1234-5678|01012345678/)
  })

  it('이어 받기: after 뒤 / before 앞의 가장 최근 / 둘 다 없으면 가장 최근, 늘 seq 오름차순, limit 상한 500, more', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (let i = 1; i <= 12; i++) {
      await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: 'UC1', nick: 'n', text: '안녕' })
      if (i === 6) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 })) // 채팅이 아닌 이벤트 (seq 8)
    }
    const ids = (body: { messages: Message[] }) => body.messages.map((m) => m.id)
    // 가장 최근 5개
    const latest = await messages(world, seller, '?limit=5')
    expect(ids(latest.body)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12'])
    expect(latest.body.more).toBe(true)
    expect(latest.body.seq).toBe(14)
    // 이전 메시지 보기: 가장 오래된 것의 seq 앞
    const older = await messages(world, seller, `?before=${String(latest.body.messages[0]?.seq)}&limit=5`)
    expect(ids(older.body)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7'])
    expect(older.body.more).toBe(true)
    const oldest = await messages(world, seller, `?before=${String(older.body.messages[0]?.seq)}&limit=5`)
    expect(ids(oldest.body)).toEqual(['m1', 'm2'])
    expect(oldest.body.more).toBe(false)
    // 이어 받기: after
    const after = await messages(world, seller, '?after=4&limit=3')
    expect(ids(after.body)).toEqual(['m4', 'm5', 'm6'])
    expect(after.body.more).toBe(true)
    expect(ids((await messages(world, seller, '?after=14')).body)).toEqual([])
    // 개수 상한 (9999를 적어도 500으로 자른다) · 잘못된 값
    expect((await messages(world, seller, '?limit=9999')).status).toBe(200)
    for (const bad of ['?limit=0', '?after=-1', '?after=1&before=3', '?before=x', '?limit=10000', '?b=', '?rehearsal=maybe']) expect((await messages(world, seller, bad)).status, bad).toBe(400)
  })

  it('방송 거르기: b를 주면 그 방송만, 그 범위의 방송이 아니면 404. 리허설 방송의 메시지는 rehearsal=true로만 보인다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b1 = await createBroadcast(world, seller, { date: DAY })
    const b2 = await createBroadcast(world, seller, { date: DAY })
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await world.server.ingestChat(seller.sellerId, { b: b1.id, id: 'x', ch: 'UC1', nick: 'n', text: '안녕' })
    await world.server.ingestChat(seller.sellerId, { b: b2.id, id: 'x', ch: 'UC1', nick: 'n', text: '반가워요' })
    await world.server.ingestChat(seller.sellerId, { b: rehearsal.id, id: 'x', ch: 'sim_c1', nick: 'n', text: '연습' })
    expect((await messages(world, seller)).body.messages.map((m) => [m.broadcast, m.text])).toEqual([
      [b1.id, '안녕'],
      [b2.id, '반가워요'],
    ])
    expect((await messages(world, seller, `?b=${b2.id}`)).body.messages.map((m) => m.text)).toEqual(['반가워요'])
    expect((await messages(world, seller, `?b=${rehearsal.id}`)).status).toBe(404)
    const practice = await messages(world, seller, `?rehearsal=true&b=${rehearsal.id}`)
    expect(practice.body).toMatchObject({ rehearsal: true, messages: [{ text: '연습', channel: 'sim_c1' }] })
    expect((await messages(world, seller, `?rehearsal=true&b=${b1.id}`)).status).toBe(404)
    // 다른 판매자는 없는 범위
    const other = await addSeller(world)
    expect((await messages(world, other)).status).toBe(404)
  })

  it('처리하지 못한 채팅(실패 표시)은 failed: true로, 주문·취소 표시 없이 보인다. 로그에 본문·닉네임이 없다', async () => {
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (event.type === 'chat' && event.text === '15 고장표식') throw new Error('엔진 고장 주입')
          return applyEvent(state, event)
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: 'a', price: 1000 }))
    const result = await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'bad', ch: 'UC1', nick: '닉네임표식', text: '15 고장표식' })
    expect(result).toMatchObject({ status: 'recorded', failed: true })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'ok', ch: 'UC2', nick: 'n', text: '15' })
    const view = await messages(world, seller)
    expect(view.body.messages.map((m) => [m.id, m.failed, m.order, m.orders, m.claims])).toEqual([
      ['bad', true, false, [], []],
      ['ok', false, true, [15], ['c1']],
    ])
    expect(view.body.messages[0]?.mentions).toEqual([15])
    expect(JSON.stringify(world.logs)).not.toMatch(/고장표식|닉네임표식/)
  })
})

describe('AC-S05-35 상품별 조치 기록', () => {
  it('방송·번호로 거르면 그 상품을 대상으로 한 product.*·host.* 이벤트만 seq 순 (번호 변경은 이전·새 번호 모두), 응답 모양은 이력과 같다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const other = await createBroadcast(world, seller, { date: DAY })
    const w = (event: Record<string, unknown>, date?: string) => expectOk(writeEvent(world, seller, event, date))
    await w({ type: 'product.register', b: b.id, no: 15, name: 'a', price: 1000 }) // 3
    await w({ type: 'product.register', b: other.id, no: 15, name: 'b', price: 1000 }) // 4 (다른 방송)
    await w({ type: 'product.register', b: b.id, no: 16, name: 'c', price: 1000 }) // 5 (다른 번호)
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '홍길동', text: '15' }) // 6 (채팅은 조치가 아니다)
    await w({ type: 'host.cancel', b: b.id, no: 15, buyer: 'UC1', reason: '시청자 요청' }) // 7
    await w({ type: 'host.cancel', b: b.id, no: 15, buyer: 'UC1', reason: '두 번째(맞지 않음)' }) // 8 — 적용되지 않았어도 기록으로 보인다
    await w({ type: 'host.blockBuyer', buyer: 'UC1', reason: '장난' }, DAY) // 9 (번호 없음)
    await w({ type: 'product.renumber', b: b.id, from: 15, to: 25 }) // 10
    await w({ type: 'product.hold', b: b.id, no: 25 }) // 11
    await w({ type: 'host.convertMessage', b: b.id, msg: 'm1', no: 15 }) // 12
    const api = client(world, seller.cookie)
    const fifteen = await expectOk(api.get(`/api/days/${DAY}/history?b=${b.id}&no=15`))
    const events = fifteen.body.events as { seq: number; type: string; reason: string | null; actor: { kind: string; loginId: string | null }; fields: Record<string, unknown> }[]
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [3, 'product.register'],
      [7, 'host.cancel'],
      [8, 'host.cancel'],
      [10, 'product.renumber'],
      [12, 'host.convertMessage'],
    ])
    expect(events[1]).toMatchObject({ reason: '시청자 요청', actor: { kind: 'account', loginId: seller.loginId }, fields: { b: b.id, no: 15, buyer: 'UC1' } })
    const all = (await expectOk(api.get(`/api/days/${DAY}/history`))).body.events as { seq: number }[]
    // 모양은 이력과 같다
    expect(events[1]).toEqual(all.find((event) => event.seq === 7))
    expect(fifteen.body).toMatchObject({ date: DAY, rehearsal: false })
    const twentyFive = (await expectOk(api.get(`/api/days/${DAY}/history?b=${b.id}&no=25`))).body.events as { seq: number }[]
    expect(twentyFive.map((event) => event.seq)).toEqual([10, 11])
    // 이어 받기·개수
    expect(((await expectOk(api.get(`/api/days/${DAY}/history?b=${b.id}&no=15&after=7&limit=2`))).body.events as { seq: number }[]).map((e) => e.seq)).toEqual([8, 10])
    // 없는 상품은 빈 목록, 반쪽 조건·잘못된 번호는 400
    expect((await expectOk(api.get(`/api/days/${DAY}/history?b=${b.id}&no=99`))).body.events).toEqual([])
    for (const bad of [`?b=${b.id}`, '?no=15', `?b=${b.id}&no=0`, `?b=${b.id}&no=x`, '?b=&no=1']) expect((await api.get(`/api/days/${DAY}/history${bad}`)).status, bad).toBe(400)
  })

  it('조치 이벤트가 많아도(1,000개 넘게) 끝까지 찾아 모은다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: 'a', price: 1000 }))
    const drafts = Array.from({ length: 1100 }, (_, i) => ({ fields: { type: i % 2 === 0 ? 'product.hold' : 'product.open', b: b.id, no: 2 }, actor: { kind: 'server' as const } }))
    const written = await world.server.writer.write({ sellerId: seller.sellerId, date: DAY, rehearsal: false, createScope: false, requestId: null, build: () => drafts })
    expect(written.kind).toBe('ok')
    await expectOk(writeEvent(world, seller, { type: 'product.hold', b: b.id, no: 1 }))
    const events = (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}/history?b=${b.id}&no=1`))).body.events as { seq: number; type: string }[]
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [2, 'product.register'],
      [1104, 'product.hold'],
    ])
  })
})
