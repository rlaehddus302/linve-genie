// AC-Y1-60~62 유튜브 원문 30일 (DAT-06, D-012, D-078, D-Y11): 원문 분리, 봉인, 봉인 뒤 읽기만
import { applyEvent, initEngine, type EngineEvent } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReplay, formatCheck } from '../src/check-replay.ts'
import { eventDigest } from '../src/writer.ts'
import { MERGED_BODY, RAW_JOIN, addSeller, client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { connectSeller, dumpText, linkedBroadcast, sibling, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
const extras: { server: { close(): void; stop(): Promise<void> } }[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of extras.splice(0)) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

/** 2026-10-18 20:00 KST */
const DAY = '2026-10-18'
const START = Date.parse('2026-10-18T11:00:00Z')
/** 2026-11-17T00:00:00+09:00 */
const SEAL_AT = Date.parse('2026-11-16T15:00:00Z')

describe('AC-Y1-60 원문 분리', () => {
  it('수집 경로로 기록한 chat의 text·nick은 이벤트 본문에 없고 따로 둔다(유튜브 수집기·리허설). 재생은 합쳐서 — 재생 결과 = 저장한 상태', async () => {
    const w = await world({ start: START })
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected, { date: DAY })
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { id: 'x1', author: 'UCa', name: '비밀닉네임', text: '비밀본문 15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 1, { step: 100 })
    const rehearsal = await createBroadcast(w, connected.seller, { date: DAY, rehearsal: true })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${rehearsal.id}/rehearsal/chat`, { requestId: 'v1', nick: '연습닉', text: '연습본문' })).status).toBe(200)
    const rows = (await w.database.pglite?.query<{ body: string; raw: boolean; chat_source: string }>(`select body, raw, chat_source from events where type = 'chat' order by id`))?.rows ?? []
    expect(rows.map((row) => [row.raw, row.chat_source])).toEqual([
      [true, 'youtube'],
      [true, 'rehearsal'],
    ])
    for (const row of rows) {
      expect(row.body).not.toMatch(/비밀닉네임|비밀본문|연습닉|연습본문/)
      expect(JSON.parse(row.body)).not.toHaveProperty('text')
    }
    const raw = (await w.database.pglite?.query<{ nick: string; text: string }>(`select nick, text from chat_raw order by seq`))?.rows ?? []
    expect(raw.map((row) => [row.nick, row.text]).sort()).toEqual([
      ['비밀닉네임', '비밀본문 15'],
      ['연습닉', '연습본문'],
    ])
    // 다시 시작한 서버의 재생 = 저장한 상태
    const fresh = sibling(w, 'R')
    extras.push(fresh)
    expect((await fresh.server.writer.read(connected.seller.sellerId, DAY)).state).toEqual((await w.server.writer.read(connected.seller.sellerId, DAY)).state)
    expect((await checkReplay(w.database.db)).every((check) => check.ok)).toBe(true)
    // 메시지 조회·이력은 Y1 전과 같은 모양 (본문·이름 있음)
    const messages = (await client(w, connected.seller.cookie).get(`/api/days/${DAY}/messages`)).body.messages as { nick: string; text: string }[]
    expect(messages.map((message) => [message.nick, message.text])).toEqual([['비밀닉네임', '비밀본문 15']])
  })

  it('따로 둔 본문·이름을 고치면 재생 검사가 그 seq를 보고한다. Y1 전에 기록된 이벤트(본문에 text·nick)도 그대로 재생된다', async () => {
    const w = await world({ start: START })
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller, { date: DAY })
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UCa', nick: '가', text: '안녕' })
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UCb', nick: '나', text: '반가워요' })
    // m1을 Y1 전 모양으로 되돌린다 (본문에 text·nick, 따로 둔 값 없음, 요약값은 본문만)
    const pg = w.database.pglite
    const row = (await pg?.query<{ scope_id: string; seq: number; body: string }>(`select e.scope_id, e.seq, ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.chat_message_id = 'm1'`))?.rows[0]
    if (row === undefined) throw new Error('없다')
    await pg?.query(`delete from chat_raw where seq = $1`, [row.seq])
    await pg?.query(`update events set body = $1, raw = false, digest = $2 where chat_message_id = 'm1'`, [row.body, eventDigest(row.scope_id, row.seq, 'chat', row.body, false)])
    await pg?.query(`delete from snapshots`)
    const fresh = sibling(w, 'R')
    extras.push(fresh)
    const messages = (await client(fresh, seller.cookie).get(`/api/days/${DAY}/messages`)).body.messages as { id: string; text: string }[]
    expect(messages.map((message) => [message.id, message.text])).toEqual([
      ['m1', '안녕'],
      ['m2', '반가워요'],
    ])
    expect((await checkReplay(w.database.db)).every((check) => check.ok)).toBe(true)
    // 따로 둔 이름을 고치면 그 seq
    await pg?.query(`update chat_raw set nick = '다른이름' where text = '반가워요'`)
    const [broken] = await checkReplay(w.database.db)
    expect(broken).toMatchObject({ ok: false, firstDiff: { seq: 3, part: '이벤트' } })
  })
})

describe('AC-Y1-61 봉인', () => {
  async function busyDay(w: YoutubeWorld) {
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { date: DAY, settings: { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': 600 } })
    const api = client(w, connected.seller.cookie)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 16, name: '라울', price: 5000 }))
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { id: 'buy1', author: 'UCbuyer', name: '산사람', text: '15', publishedAt: w.timer.now() + 1 })
    w.fake.addMessage(liveChatId, { id: 'look1', author: 'UClooker', name: '구경만한사람', text: '비밀스러운 수다 본문', publishedAt: w.timer.now() + 1 })
    w.fake.addMessage(liveChatId, { id: 'wait1', author: 'UCwaiter', name: '대기만한사람', text: '15', publishedAt: w.timer.now() + 1 })
    w.fake.addMessage(liveChatId, { id: 'del1', author: 'UClooker', name: '구경만한사람', text: '지울 말', publishedAt: w.timer.now() + 1 })
    await until(w, async () => ((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 4, { step: 100 })
    w.fake.deleteMessage(liveChatId, 'del1')
    await until(w, async () => ((await api.get(`/api/days/${DAY}/youtube-notices`)).body.notices as unknown[]).length === 1, { step: 100 })
    await expectOk(writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 16, received: '20:05', memo: '단골 메모' }))
    await expectOk(writeEvent(w, connected.seller, { type: 'settlement.payment', buyer: 'UCbuyer', date: DAY, amount: 5000, memo: '입금' }, DAY))
    await w.server.youtube?.outbox.runOnce()
    await w.server.youtube?.collectors.stop()
    return { connected, b, api }
  }

  it('그 날짜 + 30일 0시(KST) 전에는 봉인하지 않고, 지나면 한 번에 봉인: 원문·스냅샷·알림·이어받기 지점 삭제, 기다리던 발송함 → SEALED, 장부 저장', async () => {
    const w = await world({ start: START })
    const { connected, b, api } = await busyDay(w)
    const beforeView = (await api.get(`/api/days/${DAY}`)).body
    await w.timer.set(SEAL_AT - 1)
    expect(await w.server.sealer.runOnce()).toBe(0)
    await w.timer.set(SEAL_AT)
    expect(await w.server.sealer.runOnce()).toBe(1)
    expect(await w.server.sealer.runOnce()).toBe(0)
    const dump = await dumpText(w)
    expect(dump).not.toContain('비밀스러운 수다 본문')
    expect(dump).not.toContain('지울 말')
    expect(dump).not.toContain('구경만한사람')
    expect(dump).not.toContain('대기만한사람')
    expect(dump).toContain('산사람') // 산 사람은 장부에 남는다
    for (const table of ['chat_raw', 'snapshots', 'youtube_notices', 'youtube_own_messages']) {
      const count = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from ${table} t join scopes s on s.id = t.scope_id where s.date = '${DAY}' and s.rehearsal = false`)
      expect(count?.rows[0]?.n, table).toBe(0)
    }
    const collector = (await w.database.pglite?.query<{ page_token: string | null; status: string; reason: string }>(`select page_token, status, reason from youtube_collectors`))?.rows[0]
    expect(collector).toEqual({ page_token: null, status: 'STOPPED', reason: 'SEALED' })
    const outbox = (await api.get(`/api/days/${DAY}/outbox`)).body.rows as { state: string; reason: string; text: string }[]
    expect(outbox.every((row) => row.state === 'FAILED' && row.reason === 'SEALED')).toBe(true)
    // 채팅이 아닌 이벤트는 그대로 (누가·언제·왜)
    const types = ((await w.database.pglite?.query<{ type: string }>(`select type from events order by seq`))?.rows ?? []).map((row) => row.type)
    expect(types).toContain('sms')
    expect(types).toContain('settlement.payment')
    // 장부의 정산 금액 = 봉인 직전 조회 결과
    const afterView = (await api.get(`/api/days/${DAY}`)).body
    expect(afterView.sealed).toBe(true)
    expect(afterView.settlements).toEqual(beforeView.settlements)
    expect((afterView.products as { key: string; status: string }[]).map((p) => [p.key, p.status])).toEqual((beforeView.products as { key: string; status: string }[]).map((p) => [p.key, p.status]))
    const buyers = (afterView.buyers as { id: string; display: string }[]).map((buyer) => buyer.id).sort()
    // 산 사람·문자 구매자만 (대기만 한 시청자·구경만 한 시청자는 없다)
    expect(buyers).toHaveLength(2)
    expect(buyers).toContain('UCbuyer')
    expect(buyers.some((id) => id.startsWith('sms:'))).toBe(true)
    const sales = afterView.claims as { product: string; buyer: string; buyerName: string; price: number; confirmedAt: string }[]
    expect(sales.map((sale) => [sale.product, sale.buyerName, sale.price])).toEqual([
      [`${b.id}/15`, '산사람', 10000],
      [`${b.id}/16`, '문자찜(단골 메모)', 5000],
    ])
    expect(sales.every((sale) => typeof sale.confirmedAt === 'string')).toBe(true)
    void connected
  })

  it('중간에 죽으면 아무것도 바뀌지 않은 채 다음 실행에서 다시 한다. 리허설·유튜브 채팅 없는 범위는 봉인하지 않는다', async () => {
    let die = true
    const w = await world({ start: START, overrides: { sealHooks: { beforeCommit: () => (die ? Promise.reject(new Error('죽음')) : undefined) } } })
    const { connected } = await busyDay(w)
    await createBroadcast(w, connected.seller, { date: DAY, rehearsal: true })
    await createBroadcast(w, connected.seller, { date: '2026-10-17' })
    const before = await dumpText(w)
    await w.timer.set(SEAL_AT + 60 * 24 * 3600 * 1000)
    expect(await w.server.sealer.runOnce()).toBe(0)
    expect(await dumpText(w)).toBe(before)
    die = false
    expect(await w.server.sealer.runOnce()).toBe(1)
    const sealed = (await w.database.pglite?.query<{ date: string; rehearsal: boolean; sealed: boolean }>(`select date, rehearsal, sealed_at is not null as sealed from scopes order by date, rehearsal`))?.rows ?? []
    expect(sealed).toEqual([
      { date: '2026-10-17', rehearsal: false, sealed: false },
      { date: DAY, rehearsal: false, sealed: true },
      { date: DAY, rehearsal: true, sealed: false },
    ])
  })
})

describe('AC-Y1-62 봉인 뒤', () => {
  it('채팅 목록은 비고 문장, 쓰는 모든 요청은 409 SEALED, 재생 검사는 "봉인됨"·장부 요약값 대조, 범위 목록의 sealAt·sealed', async () => {
    const w = await world({ start: START })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { date: DAY, settings: { 'print.autoOnConfirm': false } })
    const api = client(w, connected.seller.cookie)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCa', nick: '가', text: '15' })
    await w.server.youtube?.outbox.runOnce()
    const failedRow = ((await api.get(`/api/days/${DAY}/outbox`)).body.rows as { id: number }[])[0]
    expect((await api.get('/api/days')).body.days).toEqual([{ date: DAY, rehearsal: false, seq: expect.any(Number), sealAt: '2026-11-16T15:00:00.000Z', sealed: false }])
    await w.timer.set(SEAL_AT)
    expect(await w.server.sealer.runOnce()).toBe(1)
    expect((await api.get('/api/days')).body.days).toEqual([{ date: DAY, rehearsal: false, seq: expect.any(Number), sealAt: '2026-11-16T15:00:00.000Z', sealed: true }])
    const messages = (await api.get(`/api/days/${DAY}/messages`)).body
    expect(messages).toMatchObject({ messages: [], sealed: true, sealedMessage: '30일이 지나 채팅 내용을 지웠어요.' })
    const seqBefore = (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events`))?.rows[0]?.n
    const sealedError = { error: { code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' } }
    const attempts = [
      await writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 16, name: '라울', price: 5000 }),
      await writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 15, received: '12:00' }),
      await writeEvent(w, connected.seller, { type: 'settlement.payment', buyer: 'UCa', date: DAY, amount: 1000 }, DAY),
      await writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UCa', reason: '취소' }),
      await writeEvent(w, connected.seller, { type: 'host.blockBuyer', buyer: 'UCa', reason: '차단' }, DAY),
      await api.post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-sealed' }),
      await api.post(`/api/broadcasts/${b.id}/youtube/unlink`, {}),
      await api.post(`/api/outbox/${String(failedRow?.id)}/resend`, { requestId: 'rs-sealed' }),
    ]
    for (const response of attempts) {
      expect(response.status, response.text).toBe(409)
      expect(response.body).toMatchObject(sealedError)
    }
    expect((await w.server.ingestChat(connected.seller.sellerId, { b: b.id, id: 'c9', ch: 'UCz', nick: 'z', text: '안녕' })).status).toBe('rejected')
    const b2 = await createBroadcast(w, connected.seller, { date: DAY }).catch(() => null)
    expect(b2).toBeNull()
    expect((await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events`))?.rows[0]?.n).toBe(seqBefore)
    // 재생 검사: 봉인됨, 장부 요약값 대조
    const [check] = await checkReplay(w.database.db)
    expect(check).toMatchObject({ sealed: true, ok: true })
    expect(formatCheck(check as NonNullable<typeof check>)).toContain('봉인됨 · 장부 일치')
    await w.database.pglite?.exec(`update scopes set ledger = replace(ledger, '10000', '1') where sealed_at is not null`)
    const [tampered] = await checkReplay(w.database.db)
    expect(tampered).toMatchObject({ sealed: true, ok: false, firstDiff: { part: '장부' } })
  })

  it('장부는 코어 상태 형식과 상관없이 읽힌다 (재생하지 않는다)', async () => {
    const w = await world({ start: START })
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller, { date: DAY })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 1, name: '구피', price: 3000 }))
    await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'c1', ch: 'UCa', nick: '가', text: '1' })
    await w.timer.set(SEAL_AT)
    expect(await w.server.sealer.runOnce()).toBe(1)
    // 이벤트 본문을 엔진이 읽을 수 없게 망가뜨려도 봉인한 날짜의 조회는 장부로 된다
    await w.database.pglite?.exec(`update events set body = '{"type":"x"}'`)
    const fresh = sibling(w, 'R')
    extras.push(fresh)
    const view = (await client(fresh, seller.cookie).get(`/api/days/${DAY}`)).body
    expect(view).toMatchObject({ sealed: true, products: [{ no: 1, name: '구피', price: 3000, status: 'SOLD' }] })
    void applyEvent
    void initEngine
    void ({} as EngineEvent)
  })
})
