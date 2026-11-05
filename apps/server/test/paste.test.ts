// 댓글 붙여넣기 통합 시험 (N2b-2, AC-N2b-2-56~59·72, D-N2b-2-07·08, G-ENG-N2b-2-02). 기록 경로·코어 파서·엔진을 그대로 탄다.
import { getBuyer, listBuyers, listClaims, listProducts } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { pasteRef } from '../src/tiktok-live/paste-service.ts'
import { addSeller, client, rid } from './support.ts'
import { connected, DATE, linkTiktok, logText, realBroadcast, tiktokComment, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(options: Parameters<typeof ttWorld>[0] = {}): Promise<TtWorld> {
  const w = await ttWorld(options)
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const register = async (w: TtWorld, cookie: string, b: string, no: number, price = 10_000) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price })
  expect(response.status, response.text).toBe(200)
}
const eventCount = async (w: TtWorld, sellerId: string) =>
  (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1`, [sellerId]))?.rows[0]?.n ?? 0

describe('AC-N2b-2-56 미리 보기 — 기록하지 않는다', () => {
  it('줄마다 결과·문장, 같은 닉네임 묶음·넣을 찜 수, 이벤트 0', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    const before = await eventCount(w, seller.sellerId)
    const text = ['홍길동: 15', '김철수: 16 17', '홍길동: 17번 주세요', '박지민: 15 취소', '이영희: 안녕하세요', '12:34', '010-1234-5678: 15', '빈댓글:', `긴댓글: ${'가'.repeat(501)}`, '최수진: 15 취소 16'].join('\n')
    const preview = await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste/preview`, { text })
    expect(preview.status, preview.text).toBe(200)
    expect(preview.body.rows).toEqual([
      { line: 1, nickname: '홍길동', text: '15', result: 'ORDER', numbers: [15], message: '15번 찜' },
      { line: 2, nickname: '김철수', text: '16 17', result: 'ORDER', numbers: [16, 17], message: '16번·17번 찜' },
      { line: 3, nickname: '홍길동', text: '17번 주세요', result: 'ORDER', numbers: [17], message: '17번 찜' },
      { line: 4, nickname: '박지민', text: '15 취소', result: 'CANCEL_NOT_SUPPORTED', numbers: [], message: '취소는 붙여넣기로 넣지 않아요. 찜 목록에서 취소해 주세요.' },
      { line: 5, nickname: '이영희', text: '안녕하세요', result: 'NOT_ORDER', numbers: [], message: '주문이 아니라 넣지 않아요.' },
      { line: 6, result: 'NO_NICKNAME', numbers: [], message: '닉네임: 댓글 모양이 아니에요.' },
      { line: 7, result: 'PHONE_NUMBER', numbers: [], message: '닉네임에 휴대폰 번호가 있어 넣지 않아요.' },
      { line: 8, result: 'NO_TEXT', numbers: [], message: '댓글이 비어 있어요.' },
      { line: 9, result: 'TEXT_TOO_LONG', numbers: [], message: '댓글이 너무 길어요. 500자까지 넣을 수 있어요.' },
      expect.objectContaining({ line: 10, nickname: '최수진' }),
    ])
    expect((preview.body.rows as { result: string }[])[9]?.result).not.toBe('ORDER')
    expect(preview.body.groups).toEqual([
      { nickname: '홍길동', lines: [1, 3], claims: 2, message: '같은 닉네임은 한 구매자로 넣어요' },
      { nickname: '김철수', lines: [2], claims: 2, message: null },
    ])
    expect(preview.body.total).toBe(4)
    expect(await eventCount(w, seller.sellerId)).toBe(before)
    expect(preview.text).not.toContain('010-1234-5678')
  })

  it('번호는 그 회차 스냅샷의 파서 설정(최대 번호·여러 번호)으로 읽는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller, { 'claim.maxNumber': 20, 'claim.multiNumber': 'FIRST' })
    const preview = await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste/preview`, { text: 'a가: 15 16\nb나: 25' })
    expect((preview.body.rows as { result: string; numbers: number[] }[]).map((row) => [row.result, row.numbers])).toEqual([
      ['ORDER', [15]],
      ['NOT_ORDER', []],
    ])
  })

  it('전체 거절 TOO_LONG·TOO_MANY_LINES (400, 줄 결과 없음, 받은 글을 되돌려 보내지 않음). 20,000자 한글은 본문 한도 안', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    const api = client(w, seller.cookie)
    const big = await api.post(`/api/broadcasts/${b}/paste/preview`, { text: `가: ${'가'.repeat(19_997)}` })
    expect(big.status).toBe(200)
    expect((big.body.rows as { result: string }[])[0]?.result).toBe('TEXT_TOO_LONG')
    const tooLong = await api.post(`/api/broadcasts/${b}/paste/preview`, { text: `PLANTED-PASTE${'가'.repeat(20_000)}` })
    expect([tooLong.status, tooLong.body]).toEqual([400, { error: { code: 'TOO_LONG', message: '한 번에 20,000자까지 붙여 넣을 수 있어요. 나눠서 넣어 주세요.' } }])
    const lines = Array.from({ length: 201 }, (_, i) => `시청자${String(i)}: 1`).join('\n')
    const tooMany = await api.post(`/api/broadcasts/${b}/paste/preview`, { text: lines })
    expect([tooMany.status, tooMany.body]).toEqual([400, { error: { code: 'TOO_MANY_LINES', message: '한 번에 200줄까지 붙여 넣을 수 있어요. 나눠서 넣어 주세요.' } }])
  })
})

describe('AC-N2b-2-57 넣기 — 번호마다 문자찜 (G-ENG-N2b-2-02를 서버 경로로)', () => {
  it('줄 순서·줄 안 번호 순서, 같은 수신 시각·메모 = 닉네임·같은 닉네임은 지정 구매자, 한 트랜잭션(seq 이어짐), 재전송은 같은 응답·찜 둘 없음', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    for (const [no, price] of [
      [15, 10_000],
      [16, 5000],
      [17, 8000],
      [18, 6000],
    ] as const)
      await register(w, seller.cookie, b, no, price)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000101', uniqueId: 'hong', nickname: '홍길동', comment: '18' })
    await tiktokComment(w, tiktokId, { userId: '7101000000000000102', uniqueId: 'park', nickname: '박지민', comment: '15번' })
    const api = client(w, seller.cookie)
    const requestId = rid('paste')
    const text = '홍길동: 15\n김철수: 16 17\n홍길동: 17'
    const seqBefore = (await api.get(`/api/days/${DATE}`)).body.seq as number
    const added = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(added.status, added.text).toBe(200)
    expect(added.body).toMatchObject({ added: 4, total: 4 })
    const rows = await w.database.pglite?.query<{ seq: number; body: string; actor: string; account_id: string; request_id: string | null }>(
      `select seq, body, actor, account_id, request_id from events where seller_id = $1 and type = 'sms' order by seq`,
      [seller.sellerId],
    )
    const events = rows?.rows.map((row) => JSON.parse(row.body) as Record<string, unknown>) ?? []
    expect(rows?.rows.map((row) => row.seq)).toEqual([seqBefore + 1, seqBefore + 2, seqBefore + 3, seqBefore + 4])
    expect(rows?.rows.every((row) => row.actor === 'account' && row.account_id === seller.accountId)).toBe(true)
    expect(rows?.rows.map((row) => row.request_id)).toEqual([requestId, null, null, null])
    const p = (line: number, k: number) => pasteRef(seller.sellerId, requestId, line, k)
    expect(events.map(({ seq: _s, at: _a, ...rest }) => rest)).toEqual([
      { type: 'sms', b, ref: p(1, 1), no: 15, received: events[0]?.received, memo: '홍길동' },
      { type: 'sms', b, ref: p(2, 1), no: 16, received: events[0]?.received, memo: '김철수' },
      { type: 'sms', b, ref: p(2, 2), no: 17, received: events[0]?.received, memo: '김철수', buyer: `sms:${p(2, 1)}` },
      { type: 'sms', b, ref: p(3, 1), no: 17, received: events[0]?.received, memo: '홍길동', buyer: `sms:${p(1, 1)}` },
    ])
    expect(events[0]?.received).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    for (const event of events) expect(String(event.ref)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    // 재전송: 같은 응답·찜 둘 없음
    const again = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(again.body).toEqual(added.body)
    const state = (await w.server.writer.read(seller.sellerId, DATE)).state
    expect(listClaims(state)).toHaveLength(6)
    const product = (no: number) => listProducts(state).find((item) => item.no === no)
    expect(product(15)).toMatchObject({ winnerClaims: [expect.any(String)] })
    expect(getBuyer(state, `sms:${p(1, 1)}`)?.display).toBe('문자찜(홍길동)')
    expect(getBuyer(state, `sms:${p(2, 1)}`)?.display).toBe('문자찜(김철수)')
    // 같은 요청 번호에 다른 글 → REQUEST_REUSED, 이벤트 0
    const before = await eventCount(w, seller.sellerId)
    const reused = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text: '홍길동: 18' })
    expect([reused.status, (reused.body.error as { code: string }).code]).toEqual([409, 'REQUEST_REUSED'])
    // 넣을 찜이 없음
    const nothing = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text: '홍길동: 안녕\n박지민: 15 취소' })
    expect([nothing.status, nothing.body.error]).toEqual([409, { code: 'NOTHING_TO_ADD', message: '넣을 찜이 없어요.' }])
    expect(await eventCount(w, seller.sellerId)).toBe(before)
  })

  it('중간에 실패하면 이벤트 0 (한 트랜잭션)', async () => {
    let fail = false
    const w = await world({ overrides: { hooks: { beforeCommit: () => { if (fail) throw new Error('x') } } } })
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 1)
    const before = await eventCount(w, seller.sellerId)
    fail = true
    const failed = await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: 'a가: 1\nb나: 1' })
    expect(failed.status).toBe(500)
    expect(await eventCount(w, seller.sellerId)).toBe(before)
  })
})

describe('붙여넣기 요청 기록에는 닉네임·댓글이 없다 (DAT-06·D-079, SA/RA-N2b-2-01)', () => {
  it('paste_requests.result는 줄 번호·결과·번호·문구·넣은 수뿐, 재전송 응답은 처음과 같다(오류 줄·취소·주문 아님 줄 포함)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    for (const no of [15, 16]) await register(w, seller.cookie, b, no)
    const api = client(w, seller.cookie)
    const requestId = rid('paste')
    const text = ['홍길동: 15', '김철수: 16', '홍길동: 16', '이영희: 연락처 010-2468-1357 심은글', '박지민: 15 취소', '12:34', '010-1111-2222: 15'].join('\n')
    const first = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(first.status, first.text).toBe(200)
    expect(first.body.added).toBe(3)
    const stored = (await w.database.pglite?.query<{ result: string }>(`select result from paste_requests where seller_id = $1`, [seller.sellerId]))?.rows ?? []
    expect(stored).toHaveLength(1)
    for (const planted of ['홍길동', '김철수', '이영희', '박지민', '010-2468-1357', '심은글', '010-1111-2222']) expect(stored[0]?.result).not.toContain(planted)
    const again = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(again.body.groups).toEqual([
      { nickname: '홍길동', lines: [1, 3], claims: 2, message: '같은 닉네임은 한 구매자로 넣어요' },
      { nickname: '김철수', lines: [2], claims: 1, message: null },
    ])
  })
})

describe('AC-N2b-2-58 다른 구매자에게 저절로 잇지 않는다', () => {
  it('(가) 따로 두 번 넣으면 문자 구매자 둘 (나) 같은 닉네임의 틱톡 구매자가 있어도 지정 구매자 없음 (다) 합치기로 이을 수 있다', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await register(w, seller.cookie, b, 16)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000101', uniqueId: 'hong', nickname: '홍길동', comment: '16' })
    const api = client(w, seller.cookie)
    expect((await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: '홍길동: 15' })).status).toBe(200)
    // 두 번째는 앞선 붙여넣기와 겹친다 — "그래도 넣기"로 넣는다 (D-N2b-2-14). 넣어도 앞 구매자에 잇지 않는다
    expect((await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: '홍길동: 15', includeOverlaps: [1] })).status).toBe(200)
    const smsBodies = (await w.database.pglite?.query<{ body: string }>(`select body from events where seller_id = $1 and type = 'sms' order by seq`, [seller.sellerId]))?.rows.map((row) => JSON.parse(row.body) as Record<string, unknown>) ?? []
    expect(smsBodies.every((body) => body.buyer === undefined)).toBe(true)
    const state = (await w.server.writer.read(seller.sellerId, DATE)).state
    const smsBuyers = listBuyers(state).filter((buyer) => buyer.id.startsWith('sms:'))
    expect(smsBuyers).toHaveLength(2)
    const merged = await api.post(`/api/events?date=${DATE}`, { requestId: rid('m'), type: 'buyer.merge', from: smsBuyers[0]?.id, into: 'tt:7101000000000000101', reason: '같은 사람' })
    expect(merged.status, merged.text).toBe(200)
  })
})

describe('AC-N2b-2-59 권한·회차', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('판매자는 실제·리허설(리허설 범위로), 끝난 회차도 받고 틱톡이 이어져 있지 않아도 쓸 수 있다, 다른 판매자 404', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 1)
    const rehearsal = ((await api.post('/api/broadcasts', { requestId: rid('bc'), date: DATE, rehearsal: true })).body.broadcast as { id: string }).id
    await api.post('/api/events', { requestId: rid('r'), type: 'product.register', b: rehearsal, no: 1, name: '리허설 상품', price: 1000 })
    const inRehearsal = await api.post(`/api/broadcasts/${rehearsal}/paste`, { requestId: rid('p'), text: '가나: 1' })
    expect(inRehearsal.status, inRehearsal.text).toBe(200)
    const rehearsalState = (await w.server.writer.read(seller.sellerId, DATE, true)).state
    expect(listClaims(rehearsalState)).toHaveLength(1)
    await api.post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    expect((await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: '마바: 1' })).status).toBe(200)
    const other = await addSeller(w)
    expect((await client(w, other.cookie).post(`/api/broadcasts/${b}/paste/preview`, { text: '가나: 1' })).status).toBe(404)
    expect((await client(w, other.cookie).post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: '가나: 1' })).status).toBe(404)
  })
})

describe('AC-N2b-2-72 로그·오류에 남지 않는 것 (붙여넣기·틱톡)', () => {
  it('심은 값(판매자 아이디·시청자 닉네임·댓글·사용자 ID·붙여넣기 글)이 로그에 0번, 오류 응답은 받은 값을 되돌려 보내지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const bad = await api.put('/api/tiktok/account', { tiktokId: 'planted_seller with space' })
    expect(bad.text).not.toContain('planted_seller')
    const { tiktokId } = await tiktokSeller(w, { seller, tiktokId: 'planted_seller' })
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7999999999999999991', uniqueId: 'planted_viewer', nickname: 'PLANTED-NICK', comment: 'PLANTED-TEXT-15' })
    w.webcast.last?.drop()
    await w.tclock.advance(5000)
    await connected(w, seller, b)
    await w.tclock.advance(30_000)
    await api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})
    await api.post(`/api/broadcasts/${b}/paste/preview`, { text: 'PLANTED-PASTE: 15\n010-1234-5678: 15' })
    await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: 'PLANTED-PASTE: 15' })
    const tooLong = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('p'), text: `PLANTED-PASTE${'가'.repeat(20_000)}` })
    expect(tooLong.text).not.toContain('PLANTED-PASTE')
    await api.post('/api/tiktok/consent', { requestId: rid('off'), on: false })
    await api.post('/api/tiktok/consent', { requestId: rid('on'), on: true, version: 'TT-BETA-1' })
    await w.server.tiktok.idle()
    const logs = logText(w.logs)
    for (const planted of ['planted_seller', 'PLANTED-NICK', 'PLANTED-TEXT-15', '7999999999999999991', 'PLANTED-PASTE', 'planted_viewer']) expect(logs, planted).not.toContain(planted)
  })
})
