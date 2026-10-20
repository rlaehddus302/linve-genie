// N2b-2 적대 시험 (test-domain): 댓글 붙여넣기 — 같은 요청 번호 동시 재전송, 다른 글, 다른 입력이 쓴 요청 번호, 틱톡 댓글 몰림 사이의 넣기,
// 틱톡 구매자를 지정 구매자로 둔 문자찜의 감사 (AC-N2b-2-10·57·58, D-N2b-2-08·09).
import { listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { installNetworkGuard } from '../../../apps/server/test/network-guard.ts'
import { client, rid } from '../../../apps/server/test/support.ts'
import { connected, DATE, linkTiktok, msgId, realBroadcast, tiktokComment, tiktokSeller, ttWorld, type TtWorld } from '../../../apps/server/test/tiktok-live-support.ts'

installNetworkGuard()

const worlds: TtWorld[] = []
async function world(): Promise<TtWorld> {
  const w = await ttWorld()
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const register = async (w: TtWorld, cookie: string, b: string, no: number) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price: 1000 })
  expect(response.status, response.text).toBe(200)
}

async function smsEvents(w: TtWorld, sellerId: string): Promise<{ seq: number; body: Record<string, unknown> }[]> {
  const rows = await w.database.pglite?.query<{ seq: number; body: string }>(`select seq, body from events where seller_id = $1 and type = 'sms' order by scope_id, seq`, [sellerId])
  return (rows?.rows ?? []).map((row) => ({ seq: row.seq, body: JSON.parse(row.body) as Record<string, unknown> }))
}

const code = (body: Record<string, unknown>) => (body.error as { code?: string } | undefined)?.code

describe('N2b-2 붙여넣기 — 같은 요청 번호', () => {
  it('TD-N2b-2-P01: 같은 요청 번호·같은 글을 5번 동시에 보내면 모두 같은 응답, 찜은 한 번만 (AC-N2b-2-57 재전송)', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    for (const no of [15, 16, 17]) await register(w, seller.cookie, b, no)
    const api = client(w, seller.cookie)
    const requestId = rid('paste')
    const text = '홍길동: 15\n김철수: 16 17\n홍길동: 17'
    const responses = await Promise.all(Array.from({ length: 5 }, () => api.post(`/api/broadcasts/${b}/paste`, { requestId, text })))
    for (const response of responses) expect(response.status, response.text).toBe(200)
    for (const response of responses) expect(response.body).toEqual(responses[0]?.body)
    expect(await smsEvents(w, seller.sellerId)).toHaveLength(4)
    expect(listClaims((await w.server.writer.read(seller.sellerId, DATE)).state)).toHaveLength(4)
  })

  it('TD-N2b-2-P02: 같은 요청 번호에 다른 글 셋을 동시에 — 하나만 넣고 나머지는 REQUEST_REUSED, 넣은 찜은 이긴 글의 것뿐', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    for (const no of [1, 2, 3]) await register(w, seller.cookie, b, no)
    const api = client(w, seller.cookie)
    const requestId = rid('paste')
    const texts = ['가나: 1', '다라: 2\n마바: 3', '사아: 1 2 3']
    const responses = await Promise.all(texts.map((text) => api.post(`/api/broadcasts/${b}/paste`, { requestId, text })))
    const ok = responses.filter((r) => r.status === 200)
    expect(ok).toHaveLength(1)
    for (const r of responses.filter((x) => x.status !== 200)) expect([r.status, code(r.body)]).toEqual([409, 'REQUEST_REUSED'])
    expect((await smsEvents(w, seller.sellerId)).length).toBe(ok[0]?.body.added)
  })

  it('TD-N2b-2-P03: 다른 입력(문자찜 한 건)이 쓴 요청 번호로 붙여넣기 → REQUEST_REUSED, 이벤트 0 (500이나 찜 없음이 아님)', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 1)
    const api = client(w, seller.cookie)
    const requestId = rid('shared')
    expect((await api.post('/api/events', { requestId, type: 'sms', b, no: 1, received: '12:00' })).status).toBe(200)
    const before = (await smsEvents(w, seller.sellerId)).length
    const pasted = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text: '가나: 1' })
    expect([pasted.status, code(pasted.body)]).toEqual([409, 'REQUEST_REUSED'])
    expect((await smsEvents(w, seller.sellerId)).length).toBe(before)
  })

  it('TD-N2b-2-P04: 날짜가 다른 두 회차에 같은 요청 번호로 동시에 붙여넣기 → 하나만 넣는다 (판매자 단위 요청 번호)', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const api = client(w, seller.cookie)
    const b1 = await realBroadcast(w, seller)
    const created = await api.post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20' })
    expect(created.status, created.text).toBe(200)
    const b2 = (created.body.broadcast as { id: string }).id
    await register(w, seller.cookie, b1, 1)
    await register(w, seller.cookie, b2, 1)
    const requestId = rid('paste')
    const [r1, r2] = await Promise.all([api.post(`/api/broadcasts/${b1}/paste`, { requestId, text: '가나: 1' }), api.post(`/api/broadcasts/${b2}/paste`, { requestId, text: '가나: 1' })])
    expect([r1?.status, r2?.status].sort()).toEqual([200, 409])
    expect(code((r1?.status === 409 ? r1 : r2)?.body ?? {})).toBe('REQUEST_REUSED')
    expect(await smsEvents(w, seller.sellerId)).toHaveLength(1)
  })
})

describe('N2b-2 붙여넣기와 틱톡 댓글이 겹침', () => {
  it('TD-N2b-2-P05: 틱톡 댓글 300개가 기록되는 중에 붙여넣기 20찜 — 넣기의 seq는 이어지고, 빠짐·두 번 없음 (AC-N2b-2-37·57)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    for (let no = 1; no <= 20; no += 1) await register(w, seller.cookie, b, no)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    for (let i = 0; i < 300; i += 1) w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: `71018${String(i).padStart(14, '0')}`, uniqueId: `v${String(i)}`, nickname: `시청자${String(i)}`, comment: '안녕하세요' })
    const text = Array.from({ length: 20 }, (_, i) => `손님${String(i)}: ${String(i + 1)}`).join('\n')
    const pasted = await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text })
    expect(pasted.status, pasted.text).toBe(200)
    await w.server.tiktok.idle()
    const seqs = (await smsEvents(w, seller.sellerId)).map((event) => event.seq)
    expect(seqs).toHaveLength(20)
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => (seqs[0] as number) + i))
    const chatCount = (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1 and type = 'chat'`, [seller.sellerId]))?.rows[0]?.n
    expect(chatCount).toBe(300)
  })
})

describe('N2b-2 붙여넣기 — 붙여 넣은 글을 저장하지 않는다', () => {
  it('TD-N2b-2-001: 넣기 뒤 DB 어디에도 붙여 넣은 댓글 본문(휴대폰 번호 포함)이 남지 않는다 — 같은 요청 번호 재전송은 같은 글로 오므로 요약값만 두면 된다 (DAT-06, D-079, dev-notes 5)', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await register(w, seller.cookie, b, 16)
    const api = client(w, seller.cookie)
    const requestId = rid('paste')
    // 주문 줄 둘 + 시청자가 연락처를 적은 줄(주문 아님) — 찜 둘은 들어가고, 댓글 본문은 sms 이벤트에 들어가지 않는다
    const text = '홍길동: 15\n김철수: 16\n이영희: 연락처 010-2468-1357 PLANTED-COMMENT\n박지민: 안녕하세요 PLANTED-OTHER'
    const pasted = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(pasted.status, pasted.text).toBe(200)
    expect(pasted.body.added).toBe(2)
    // 재전송은 그대로 같은 응답
    const again = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(again.body).toEqual(pasted.body)
    // 판매자 데이터 표 전체에서 심은 본문·번호를 찾는다
    const tables = (await w.database.pglite?.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`))?.rows.map((row) => row.table_name) ?? []
    const found: string[] = []
    for (const table of tables) {
      const rows = (await w.database.pglite?.query<Record<string, unknown>>(`select * from "${table}"`))?.rows ?? []
      const dump = JSON.stringify(rows)
      for (const planted of ['PLANTED-COMMENT', 'PLANTED-OTHER', '010-2468-1357', '01024681357']) if (dump.includes(planted)) found.push(`${table}:${planted}`)
    }
    expect(found).toEqual([])
  })
})

describe('N2b-2 감사 경로 — 문자찜·붙여넣기의 지정 구매자가 틱톡 구매자', () => {
  it('TD-N2b-2-P06: 지정 구매자가 tt: 구매자인 문자찜의 감사는 틱톡 건너뜀(NOT_SUPPORTED) — 찜의 구매자 자신 기준 (D-N2b-2-09)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await register(w, seller.cookie, b, 16)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000777', uniqueId: 'hong', nickname: '홍길동', comment: '15' })
    const api = client(w, seller.cookie)
    const sms = await api.post('/api/events', { requestId: rid('sms'), type: 'sms', b, no: 16, received: '12:00', buyer: 'tt:7101000000000000777' })
    expect(sms.status, sms.text).toBe(200)
    const rows = await w.database.pglite?.query<{ product: string; buyer: string; state: string | null; reason: string | null }>(
      `select body::jsonb->>'product' as product, body::jsonb->>'buyer' as buyer, state, reason from outbox where seller_id = $1 and kind = 'POST_THANKS' order by id`,
      [seller.sellerId],
    )
    const of16 = rows?.rows.find((row) => row.product.endsWith('/16'))
    expect(of16).toBeDefined()
    expect(of16).toMatchObject({ state: 'SKIPPED', reason: 'NOT_SUPPORTED' })
  })
})
