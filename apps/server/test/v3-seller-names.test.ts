// AC-V3-55 서버 몫 — D-V3-68로 판매자 채팅 품종 읽기(R-23)를 없앴다: "없음 확인".
// 판매자(주인 배지) 채팅 "93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀"가 공식 수집기·확장 어느 길로 들어와도
// 채팅은 지금처럼 기록·판정(언급)되고, 품종 사전 조회·상품 품종·놓친 번호 안내·감사는 바뀌지 않는다.
import { getProduct } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
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
const MISSING = '61번🍀[녹금] ₩30,000'

const pg = (w: YoutubeWorld) => {
  const db = w.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function chatCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select count(*)::int as n from events where type = 'chat'`)).rows[0]?.n ?? 0
}

async function recordedCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select coalesce(sum(recorded), 0)::int as n from youtube_collectors`)).rows[0]?.n ?? 0
}

async function eventTypes(w: YoutubeWorld): Promise<string[]> {
  const rows = await pg(w).query<{ type: string }>(`select e.type, ${MERGED_BODY} as body from events e ${RAW_JOIN} order by e.seq`)
  return rows.rows.map((row) => row.type)
}

async function outboxCount(w: YoutubeWorld): Promise<number> {
  return (await pg(w).query<{ n: number }>(`select count(*)::int as n from outbox`)).rows[0]?.n ?? 0
}

async function collect(w: YoutubeWorld, liveChatId: string, message: { author: string; name: string; text: string }): Promise<void> {
  const before = await chatCount(w)
  const counted = await recordedCount(w)
  w.fake.addMessage(liveChatId, { ...message, publishedAt: w.timer.now() + 1 })
  await until(w, async () => (await chatCount(w)) === before + 1 && (await recordedCount(w)) === counted + 1, { step: 100 })
}

describe('AC-V3-55 (D-V3-68) 판매자 채팅 품종 글은 읽지 않는다', () => {
  it('공식 수집기: 주인 글이 들어와도 품종 미입력 상품은 그대로, 상품 고치기·놓친 번호 안내 없음, 판정은 언급·감사 줄 없음', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.open', b: b.id, no: 93 }))
    const youtube = w.server.youtube
    if (youtube === null) throw new Error('유튜브가 없다')
    youtube.collectors.start()
    const outbox = await outboxCount(w)
    // 판매자 글 알림을 보내는 길이 없다 (SSE voice sellerNames·sellerNoteMissing 없앰)
    expect('publishVoice' in w.server.hub).toBe(false)
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: NOTE })
    await collect(w, liveChatId, { author: connected.channel.id, name: '구피 가게', text: MISSING })
    expect((await eventTypes(w)).filter((type) => type === 'chat')).toHaveLength(2)
    expect((await eventTypes(w)).filter((type) => type.startsWith('product.') && type !== 'product.register' && type !== 'product.open')).toEqual([])
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '', price: 70_000, winners: [] })
    expect(getProduct(state, b.id, 61)).toBeNull()
    const messages = (await expectOk(client(w, connected.seller.cookie).get(`/api/days/${b.date}/messages`))).body.messages as Record<string, unknown>[]
    expect(messages[0]).toMatchObject({ text: NOTE, owner: true, ignored: true, order: false, orders: [], mentions: [93], claims: [] })
    expect(await outboxCount(w)).toBe(outbox)
    // 품종 사전 조회 길은 없다
    expect((await client(w, connected.seller.cookie).get('/api/voice/seller-names')).status).toBe(404)
  })

  it('확장 경로(유튜브 연결 없음): 묶인 영상의 owner 글도 품종을 채우지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 93, name: '', price: 70_000 }))
    const headers = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Content-Type': 'application/json' }
    const post = async (path: string, token: string | null, body: unknown) => {
      const response = await w.server.app.request(path, { method: 'POST', headers: token === null ? headers : { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    const issued = await client(w, seller.cookie).post('/api/extension/code', {})
    const token = (await post('/ext/connect', null, { code: issued.body.code })).body.token as string
    expect((await post('/ext/bind', token, { v: 'abcdefghijk', broadcast: b.id })).status).toBe(200)
    const sent = await post('/ext/chats', token, { v: 'abcdefghijk', messages: [{ id: 'e1', ch: 'UCseller00000000000000001', nick: '가게', text: NOTE, at: w.timer.now(), owner: true }] })
    expect(sent).toMatchObject({ status: 200, body: { recorded: 1 } })
    const state = (await w.server.writer.read(seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 93)).toMatchObject({ name: '' })
    expect((await eventTypes(w)).filter((type) => type === 'product.update')).toEqual([])
  })
})
