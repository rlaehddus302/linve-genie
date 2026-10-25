// AC-V3-55 서버 몫 (VOC-03, DOMAIN_RULES R-23, D-V3-49): 판매자가 주인 배지 채팅에 쓴 "93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀"에서 품종을 배운다.
// (a) 채팅 이벤트가 먼저 기록되고 판매자 품종 사전에 이름이 생긴다(같은 글 두 번이면 하나) · (b) 같은 번호의 빈 품종·같은 가격 상품만 고친다(손 고치기와 같은 product.update)
// (c) 손님 채팅은 배우지 않는다 · (e) 채팅 판정(언급)·감사는 그대로. 가짜 유튜브 서버(공식 수집기)와 확장 경로(ingestYoutubeBatch 'extension') 둘 다.
import { getProduct } from '@livejjim/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { learnSellerName, listSellerNames } from '../src/seller-names.ts'
import { MERGED_BODY, RAW_JOIN, addSeller, client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { connectSeller, linkedBroadcast, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld()
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const NOTE = '93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀'

const pg = (w: YoutubeWorld) => {
  const db = w.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function chatCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select count(*)::int as n from events where type = 'chat'`)).rows[0]?.n ?? 0
}

async function eventTypes(w: YoutubeWorld): Promise<{ seq: number; type: string; body: Record<string, unknown>; actor: string }[]> {
  const rows = await pg(w).query<{ seq: number; type: string; body: string; actor: string }>(`select e.seq, e.type, ${MERGED_BODY} as body, e.actor from events e ${RAW_JOIN} order by e.seq`)
  return rows.rows.map((row) => ({ seq: row.seq, type: row.type, body: JSON.parse(row.body) as Record<string, unknown>, actor: row.actor }))
}

async function names(w: YoutubeWorld, cookie: string): Promise<unknown> {
  return (await expectOk(client(w, cookie).get('/api/voice/seller-names'))).body
}

async function outboxCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select count(*)::int as n from outbox`)).rows[0]?.n ?? 0
}

/** 수집기가 기록했다고 센 수 — 기록(ingestYoutubeBatch, 품종 글 읽기 포함)이 끝난 뒤에 는다 */
async function recordedCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select coalesce(sum(recorded), 0)::int as n from youtube_collectors`)).rows[0]?.n ?? 0
}

/** 공식 수집기로 받은 채팅 하나를 기다린다 (기록과 그 뒤 품종 글 읽기까지) */
async function collect(w: YoutubeWorld, liveChatId: string, message: { author: string; name: string; text: string }): Promise<void> {
  const before = await chatCount(w)
  const counted = await recordedCount(w)
  w.fake.addMessage(liveChatId, { ...message, publishedAt: w.timer.now() + 1 })
  await until(w, async () => (await chatCount(w)) === before + 1 && (await recordedCount(w)) === counted + 1, { step: 100 })
}

async function started(w: YoutubeWorld) {
  const connected = await connectSeller(w)
  const linked = await linkedBroadcast(w, connected)
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  youtube.collectors.start()
  return { connected, ...linked }
}

describe('AC-V3-55 (a) 주인 배지 채팅 → 이벤트 먼저, 판매자 품종 사전', () => {
  it('공식 수집기: 채팅 이벤트가 기록되고 사전에 청개구리 하나 — 같은 글을 두 번 써도 하나, 조회 API·실시간 알림', async () => {
    const w = await world()
    const { connected, liveChatId } = await started(w)
    const spy = vi.spyOn(w.server.hub, 'publishVoice')
    // 새 이름 알림만 센다 (93번 상품이 없어 놓친 번호 신호도 간다 — D-V3-60, 아래 시험)
    const pushed = { calls: () => spy.mock.calls.filter((call) => (call[1] as { kind?: unknown }).kind === 'sellerNames') }
    expect(await names(w, connected.seller.cookie)).toEqual({ names: [], max: 2000 })
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    const events = await eventTypes(w)
    expect(events.filter((event) => event.type === 'chat').map((event) => event.body)).toEqual([expect.objectContaining({ text: NOTE, owner: true })])
    expect(await names(w, connected.seller.cookie)).toEqual({ names: ['청개구리'], max: 2000 })
    expect(pushed.calls()).toEqual([[connected.seller.sellerId, { kind: 'sellerNames', name: '청개구리' }]])
    // 같은 글을 한 번 더 (다른 메시지 ID) → 사전은 그대로 하나, 새 이름이 아니라 알림 없음
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    expect(await names(w, connected.seller.cookie)).toEqual({ names: ['청개구리'], max: 2000 })
    expect(pushed.calls()).toHaveLength(1)
    expect((await pg(w).query<{ n: number }>(`select count(*)::int as n from seller_names`)).rows[0]?.n).toBe(1)
  })

  it('규칙에 맞지 않는 주인 글(₩ 없음·번호 둘·대괄호 없음)은 배우지 않는다 — 채팅 기록은 그대로', async () => {
    const w = await world()
    const { connected, liveChatId } = await started(w)
    for (const text of ['93번 [청개구리] 70,000원', '93번 94번 [청개구리] ₩70,000', '93번 청개구리 ₩70,000']) {
      await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text })
    }
    expect(await chatCount(w)).toBe(3)
    expect(await names(w, connected.seller.cookie)).toEqual({ names: [], max: 2000 })
  })

  it('판매자마다 따로 — 다른 판매자의 조회에는 보이지 않는다', async () => {
    const w = await world()
    const { connected, liveChatId } = await started(w)
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    const other = await connectSeller(w)
    expect(await names(w, other.seller.cookie)).toEqual({ names: [], max: 2000 })
    expect(await names(w, connected.seller.cookie)).toEqual({ names: ['청개구리'], max: 2000 })
  })

  it('로그인하지 않은 요청은 사전을 받지 못한다', async () => {
    const w = await world()
    expect((await client(w, null).get('/api/voice/seller-names')).status).toBe(401)
  })
})

describe('AC-V3-55 (b) 같은 번호 상품의 빈 품종 채우기', () => {
  it('93번 · 품종 미입력 · 70,000원 → 품종 청개구리 (product.update 품종만, 채팅 뒤 seq, 상품 이력에 남음)', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await started(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    const events = await eventTypes(w)
    const chat = events.find((event) => event.type === 'chat')
    const update = events.find((event) => event.type === 'product.update')
    expect(update?.body).toMatchObject({ type: 'product.update', b: b.id, no: 93, name: '청개구리' })
    expect(update?.body).not.toHaveProperty('price')
    expect((update?.seq ?? 0) > (chat?.seq ?? Infinity)).toBe(true)
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '청개구리', price: 70_000 })
    const history = (await expectOk(client(w, connected.seller.cookie).get(`/api/days/${b.date}/history?b=${b.id}&no=93`))).body.events as { type: string; fields: Record<string, unknown> }[]
    expect(history.map((item) => item.type)).toEqual(['product.register', 'product.update'])
    expect(history[1]?.fields).toMatchObject({ name: '청개구리' })
    // 같은 글을 다시 써도 두 번 고치지 않는다 (이미 품종이 있다)
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    expect((await eventTypes(w)).filter((event) => event.type === 'product.update')).toHaveLength(1)
  })

  it('가격이 다르면(72,000원)·품종이 이미 있으면·상품이 없으면 상품은 그대로 — 이름은 배운다', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await started(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 72_000 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 94, name: '라울', price: 70_000 }))
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: '94번🍀[청수박] ₩70,000 [용용]님 감사합니다🍀' })
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: '95번🍀[로제스타수박] ₩70,000 [용용]님 감사합니다🍀' })
    expect((await eventTypes(w)).filter((event) => event.type.startsWith('product.') && event.type !== 'product.register')).toEqual([])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '', price: 72_000 })
    expect(getProduct(state, b.id, 94)).toMatchObject({ name: '라울', price: 70_000 })
    expect(getProduct(state, b.id, 95)).toBeNull()
    expect(await names(w, connected.seller.cookie)).toEqual({ names: ['로제스타수박', '청수박', '청개구리'], max: 2000 })
  })
})

describe('AC-V3-68 (d) 판매자 글의 번호가 그 방송에 없음 (D-V3-60)', () => {
  it('61번이 없으면 채팅 이벤트를 먼저 기록한 뒤 voice 신호 sellerNoteMissing 하나 — 상품은 생기지 않는다. 있는 번호면 신호 없음', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await started(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 62, name: '', price: 30_000 }))
    const pushed = vi.spyOn(w.server.hub, 'publishVoice')
    const missing = () => pushed.mock.calls.filter((call) => (call[1] as { kind?: unknown }).kind === 'sellerNoteMissing')
    let chatsAtSignal = -1
    pushed.mockImplementation(() => {
      void chatCount(w).then((n) => {
        if (chatsAtSignal < 0) chatsAtSignal = n
      })
    })
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: '61번🍀[녹금] ₩30,000 [용용]님 감사합니다🍀' })
    const events = await eventTypes(w)
    const chat = events.find((event) => event.type === 'chat')
    expect(missing()).toEqual([[connected.seller.sellerId, { kind: 'sellerNoteMissing', b: b.id, date: b.date, no: 61, name: '녹금', price: 30_000, chat: chat?.body.id }]])
    expect(chatsAtSignal).toBe(1)
    expect(events.filter((event) => event.type.startsWith('product.') && event.type !== 'product.register')).toEqual([])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 61)).toBeNull()
    // 있는 번호(62번 · 품종 미입력 · 같은 가격)는 채우기만, 놓친 번호 신호 없음
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: '62번🍀[청수박] ₩30,000' })
    expect(missing()).toHaveLength(1)
    // 손님 글은 신호 없음
    await collect(w, liveChatId, { author: 'UCbuyer0000000000000009', name: '용용', text: '63번🍀[녹금] ₩30,000' })
    expect(missing()).toHaveLength(1)
  })
})

describe('AC-V3-55 (c) 손님 채팅은 배우지 않는다', () => {
  it('주인 배지가 아닌 같은 글: 사전 없음·상품 그대로', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await started(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    await collect(w, liveChatId, { author: 'UCbuyer0000000000000009', name: '용용', text: NOTE })
    expect(await names(w, connected.seller.cookie)).toEqual({ names: [], max: 2000 })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '' })
  })

  it('기록 함수: ownerSure인 글만 읽는다 — owner만 있고 ownerSure가 없는 글·표시 없는 글은 배우지 않는다', async () => {
    const w = await world()
    const { connected, b } = await started(w)
    const service = w.server.service
    const sellerId = connected.seller.sellerId
    // ownerSure는 받는 경로가 정한다 (공식 isChatOwner, 확장은 owner로 기록한 글 — D-V3-62, 아래 시험)
    expect(await service.ingestYoutubeBatch(sellerId, b.id, [{ id: 'ext-1', ch: 'UCbuyer0000000000000009', nick: '용용', text: NOTE }], undefined, 'extension')).toEqual({ status: 'ok', recorded: 1 })
    expect(await service.ingestYoutubeBatch(sellerId, b.id, [{ id: 'ext-2', ch: 'UCbuyer0000000000000009', nick: '용용', text: NOTE, owner: true }], undefined, 'extension')).toEqual({ status: 'ok', recorded: 1 })
    expect(await names(w, connected.seller.cookie)).toEqual({ names: [], max: 2000 })
    expect(await service.ingestYoutubeBatch(sellerId, b.id, [{ id: 'ext-3', ch: connected.channel.id, nick: '구피 가게', text: NOTE, owner: true, ownerSure: true }], undefined, 'extension')).toEqual({ status: 'ok', recorded: 1 })
    expect(await names(w, connected.seller.cookie)).toEqual({ names: ['청개구리'], max: 2000 })
  })
})

describe('D-V3-62 확장만 쓰는 판매자 (유튜브 연결 없음 — 회차 채널을 모름)', () => {
  const VIDEO = 'abcdefghijk'
  const ORIGIN = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }
  async function ext(w: YoutubeWorld, path: string, token: string | null, body: unknown) {
    const headers: Record<string, string> = { ...ORIGIN, 'Content-Type': 'application/json' }
    if (token !== null) headers.Authorization = `Bearer ${token}`
    const response = await w.server.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text }
  }

  it('묶인 영상의 owner 표시 글은 배우고 놓친 번호 신호를 보낸다 — 표시 없는 글·묶이지 않은 영상의 글은 읽지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    const issued = await client(w, seller.cookie).post('/api/extension/code', {})
    const token = (await ext(w, '/ext/connect', null, { code: issued.body.code })).body.token as string
    const spy = vi.spyOn(w.server.hub, 'publishVoice')
    // 묶이지 않은 영상: 기록도 배우기도 없다
    expect((await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: 'e0', ch: 'UCseller00000000000000001', nick: '가게', text: NOTE, at: w.timer.now(), owner: true }] })).status).toBe(409)
    expect(await names(w, seller.cookie)).toEqual({ names: [], max: 2000 })
    expect((await ext(w, '/ext/bind', token, { v: VIDEO, broadcast: b.id })).status).toBe(200)
    // 표시 없는 같은 글(손님) → 읽지 않음
    expect((await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: 'e1', ch: 'UCbuyer0000000000000009', nick: '용용', text: NOTE, at: w.timer.now() }] })).status).toBe(200)
    expect(await names(w, seller.cookie)).toEqual({ names: [], max: 2000 })
    // owner 표시 글 → 배우고 93번 품종을 채운다, 61번(없는 번호)은 신호만
    const sent = await ext(w, '/ext/chats', token, {
      v: VIDEO,
      messages: [
        { id: 'e2', ch: 'UCseller00000000000000001', nick: '가게', text: NOTE, at: w.timer.now(), owner: true },
        { id: 'e3', ch: 'UCseller00000000000000001', nick: '가게', text: '61번🍀[녹금] ₩30,000', at: w.timer.now(), owner: true },
      ],
    })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body).toMatchObject({ recorded: 2, ownerDenied: 0 })
    expect(await names(w, seller.cookie)).toEqual({ names: ['녹금', '청개구리'], max: 2000 })
    const state = (await w.server.writer.read(seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '청개구리' })
    expect(getProduct(state, b.id, 61)).toBeNull()
    expect(spy.mock.calls.filter((call) => (call[1] as { kind?: unknown }).kind === 'sellerNoteMissing').map((call) => call[1])).toEqual([
      { kind: 'sellerNoteMissing', b: b.id, date: b.date, no: 61, name: '녹금', price: 30_000, chat: 'e3' },
    ])
  })
})

describe('AC-V3-55 (e) 채팅 판정·감사는 그대로', () => {
  it('주인 글은 지금처럼 언급(방송자 무시) — 찜 없음, 감사 발송함 줄 없음, 품종 채우기는 효과를 내지 않는다', async () => {
    const w = await world()
    const { connected, b, liveChatId } = await started(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.open', b: b.id, no: 93 }))
    const outbox = await outboxCount(w)
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    const messages = (await expectOk(client(w, connected.seller.cookie).get(`/api/days/${b.date}/messages`))).body.messages as Record<string, unknown>[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ text: NOTE, owner: true, ignored: true, order: false, orders: [], mentions: [93], claims: [] })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '청개구리', winners: [], status: 'OPEN' })
    expect(await outboxCount(w)).toBe(outbox)
  })
})

describe('판매자 품종 사전 저장 (R-23 — 같은 이름 하나·상한)', () => {
  it('같은 이름은 한 줄, 상한을 넘으면 오래 안 본 것부터 지운다 (다시 본 이름은 남는다)', async () => {
    const w = await world()
    const { connected } = await started(w)
    const db = w.database.db
    const sellerId = connected.seller.sellerId
    const t = (n: number) => new Date(Date.UTC(2026, 9, 25, 0, 0, n))
    expect(await learnSellerName(db, sellerId, '가나', t(1), 3)).toBe(true)
    expect(await learnSellerName(db, sellerId, '다라', t(2), 3)).toBe(true)
    expect(await learnSellerName(db, sellerId, '마바', t(3), 3)).toBe(true)
    expect(await learnSellerName(db, sellerId, '가나', t(4), 3)).toBe(false)
    expect(await learnSellerName(db, sellerId, '사아', t(5), 3)).toBe(true)
    expect(await listSellerNames(db, sellerId)).toEqual(['사아', '가나', '마바'])
  })
})
