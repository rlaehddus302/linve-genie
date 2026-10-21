// 붙여넣기 겹침 통합 시험 (N2b-2, AC-N2b-2-54, D-N2b-2-14, RA-N2b-2-03). 기록 경로·코어 파서·엔진을 그대로 탄다.
import { listClaims } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, expectOk, rid, writeEvent, type Seller } from './support.ts'
import { connected, DATE, linkTiktok, msgId, realBroadcast, tiktokComment, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(): Promise<TtWorld> {
  const w = await ttWorld()
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const OVERLAP_15 = '15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.'

const register = async (w: TtWorld, seller: Seller, b: string, no: number, stock = 1) => {
  const response = await writeEvent(w, seller, { type: 'product.register', b, no, name: `상품${String(no)}`, price: 10_000, stock })
  expect(response.status, response.text).toBe(200)
}
const eventCount = async (w: TtWorld, sellerId: string) =>
  (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1`, [sellerId]))?.rows[0]?.n ?? 0
const smsCount = async (w: TtWorld, sellerId: string) =>
  (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1 and type = 'sms'`, [sellerId]))?.rows[0]?.n ?? 0

/** 채팅 한 건을 기록 경로로 (유튜브 `UC…`·인스타그램 `ig:`·틱톡 `tt:` — 이름은 따로 둔 이름 그대로) */
async function chat(w: TtWorld, seller: Seller, b: string, ch: string, nick: string, text: string, rehearsal = false): Promise<void> {
  const id = `${ch.startsWith('ig:') ? 'ig:' : ch.startsWith('tt:') ? 'tt:' : ''}${msgId()}`
  const outcome = await w.server.writer.write({
    sellerId: seller.sellerId,
    date: DATE,
    rehearsal,
    createScope: false,
    requestId: null,
    chat: { b, id },
    build: () => [{ fields: { type: 'chat', b, id, ch, nick, text }, actor: { kind: 'collector' }, chat: { b, id } }],
  })
  expect(outcome.kind).toBe('ok')
}

type Row = { line: number; numbers: number[]; overlaps?: number[]; overlapMessage?: string }
const preview = async (w: TtWorld, seller: Seller, b: string, text: string) => {
  const response = await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste/preview`, { text })
  expect(response.status, response.text).toBe(200)
  return response.body as { rows: Row[]; groups: { nickname: string; lines: number[]; claims: number }[]; total: number }
}

describe('AC-N2b-2-54 이미 들어온 찜과 겹치는 줄', () => {
  it('틱톡으로 받은 홍길동 15 — 미리 보기는 겹침·문장·합계 1, 넣기는 16만, "그래도 넣기"로 15도, 재전송·REQUEST_REUSED', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller, b, 15, 2)
    await register(w, seller, b, 16)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000101', uniqueId: 'hong', nickname: '홍길동', comment: '15' })
    const api = client(w, seller.cookie)
    const text = '홍길동: 15\n김철수: 16'

    const before = await eventCount(w, seller.sellerId)
    const seen = await preview(w, seller, b, text)
    expect(seen.rows[0]).toMatchObject({ line: 1, nickname: '홍길동', result: 'ORDER', numbers: [15], message: '15번 찜', overlaps: [15], overlapMessage: OVERLAP_15 })
    expect(seen.rows[1]).not.toHaveProperty('overlaps')
    expect(seen.total).toBe(1)
    expect(seen.groups).toEqual([{ nickname: '김철수', lines: [2], claims: 1, message: null }])
    expect(await eventCount(w, seller.sellerId)).toBe(before)

    // includeOverlaps 없이 넣기 → 16만
    const first = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text })
    expect(first.status, first.text).toBe(200)
    expect(first.body).toMatchObject({ added: 1, total: 1 })
    expect((first.body.rows as Row[])[0]).toMatchObject({ overlaps: [15], overlapMessage: OVERLAP_15 })
    expect(await smsCount(w, seller.sellerId)).toBe(1)
    let state = (await w.server.writer.read(seller.sellerId, DATE)).state
    expect(listClaims(state).filter((claim) => claim.no === 15).map((claim) => claim.buyer)).toEqual(['tt:7101000000000000101'])

    // 새 요청 번호 + "그래도 넣기"(1줄) → 15도 넣는다. 16은 앞선 붙여넣기(메모 김철수)와 겹쳐 빠진다
    const requestId = rid('paste')
    const forced = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text, includeOverlaps: [1] })
    expect(forced.status, forced.text).toBe(200)
    expect(forced.body).toMatchObject({ added: 1, total: 1 })
    const forcedRows = forced.body.rows as Row[]
    expect(forcedRows[0]).not.toHaveProperty('overlaps')
    expect(forcedRows[1]).toMatchObject({ overlaps: [16], overlapMessage: '16번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.' })
    state = (await w.server.writer.read(seller.sellerId, DATE)).state
    const fifteen = listClaims(state).filter((claim) => claim.no === 15)
    expect(fifteen).toHaveLength(2)
    expect(fifteen[1]?.buyer.startsWith('sms:')).toBe(true)

    // 재전송은 처음 응답 그대로, 이벤트 수 그대로. 고르기만 달라도 REQUEST_REUSED
    const count = await eventCount(w, seller.sellerId)
    const again = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text, includeOverlaps: [1] })
    expect(again.body).toEqual(forced.body)
    const reused = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text })
    expect([reused.status, (reused.body.error as { code: string }).code]).toEqual([409, 'REQUEST_REUSED'])
    const reused2 = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text, includeOverlaps: [1, 2] })
    expect([reused2.status, (reused2.body.error as { code: string }).code]).toEqual([409, 'REQUEST_REUSED'])
    expect(await eventCount(w, seller.sellerId)).toBe(count)

    // 고른 줄 모양이 틀리면 400
    const bad = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text, includeOverlaps: ['1'] })
    expect([bad.status, (bad.body.error as { code: string }).code]).toEqual([400, 'INVALID_INPUT'])
  })

  it('겹침은 넣기 때 다시 본다 — 미리 보기 뒤에 들어온 같은 닉네임 채팅. 넣을 것이 없으면 NOTHING_TO_ADD(이벤트 0)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller, b, 15, 3)
    await register(w, seller, b, 16)
    const api = client(w, seller.cookie)
    expect((await preview(w, seller, b, '홍길동: 15')).total).toBe(1)
    expect((await preview(w, seller, b, '홍길동: 15\n이영희: 16')).total).toBe(2)
    await chat(w, seller, b, 'UCyoutube00000000000001', '홍길동', '15')
    const before = await eventCount(w, seller.sellerId)
    const nothing = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text: '홍길동: 15' })
    expect([nothing.status, nothing.body.error]).toEqual([409, { code: 'NOTHING_TO_ADD', message: '넣을 찜이 없어요.' }])
    expect(await eventCount(w, seller.sellerId)).toBe(before)
    const partial = await api.post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text: '홍길동: 15\n이영희: 16' })
    expect(partial.status, partial.text).toBe(200)
    expect(partial.body).toMatchObject({ added: 1 })
    expect((partial.body.rows as Row[])[0]).toMatchObject({ overlaps: [15], overlapMessage: OVERLAP_15 })
  })

  it('겹침의 원천 — 유튜브·인스타그램·틱톡 채팅의 정리한 닉네임, 앞선 붙여넣기·직접 넣은 문자찜의 메모', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    for (const no of [11, 12, 13, 14, 15]) await register(w, seller, b, no, 5)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await chat(w, seller, b, 'UCyoutube00000000000002', '  유튜브  손님 ', '11') // 정리하면 "유튜브 손님"
    await chat(w, seller, b, 'ig:17841400000000001', 'insta_kim', '12')
    await tiktokComment(w, tiktokId, { userId: '7101000000000000201', uniqueId: 'tok', nickname: '틱톡손님', comment: '13' })
    await expectOk(client(w, seller.cookie).post(`/api/broadcasts/${b}/paste`, { requestId: rid('paste'), text: '붙인손님: 14' }))
    await expectOk(writeEvent(w, seller, { type: 'sms', b, no: 15, received: '11:59', memo: '문자손님' }))
    const seen = await preview(w, seller, b, '유튜브 손님: 11\ninsta_kim: 12\n틱톡손님: 13\n붙인손님: 14\n문자손님: 15')
    expect(seen.rows.map((row) => row.overlaps)).toEqual([[11], [12], [13], [14], [15]])
    expect(seen.total).toBe(0)
  })

  it('겹침 아님 — 다른 닉네임, 같은 닉네임의 다른 번호, 취소·DUPLICATE·밀려난 찜, 다른 범위, 한 번 넣기 안의 같은 줄 둘', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await realBroadcast(w, seller, { 'waitlist.max': 0 })
    for (const no of [21, 22, 24, 25]) await register(w, seller, b, no)
    await expectOk(writeEvent(w, seller, { type: 'product.register', b, no: 23, name: '상품23', price: 10_000, status: 'READY' }))
    // 다른 닉네임 · 같은 닉네임 다른 번호
    await chat(w, seller, b, 'UCyoutube00000000000003', '가나다', '21')
    // 취소된 찜 (문자찜 메모 "취소손님" → 판매자 취소)
    await expectOk(writeEvent(w, seller, { type: 'sms', b, no: 22, received: '11:59', memo: '취소손님' }))
    const state0 = (await w.server.writer.read(seller.sellerId, DATE)).state
    const cancelled = listClaims(state0).find((claim) => claim.no === 22)
    await expectOk(writeEvent(w, seller, { type: 'host.cancel', b, no: 22, buyer: cancelled?.buyer, reason: '취소' }))
    // DUPLICATE: 아직 열지 않은 23에 문자찜(메모 옛이름)과 유튜브 채팅(새이름)이 보류 — 채팅 구매자를 문자 구매자에 합치면 하나는 DUPLICATE
    await expectOk(writeEvent(w, seller, { type: 'sms', b, no: 23, received: '11:59', memo: '옛이름' }))
    await chat(w, seller, b, 'UCyoutube00000000000004', '새이름', '23')
    const owner = listClaims((await w.server.writer.read(seller.sellerId, DATE)).state).find((claim) => claim.no === 23)?.buyer
    await expectOk(writeEvent(w, seller, { type: 'buyer.merge', from: 'UCyoutube00000000000004', into: owner, reason: '같은 사람' }, DATE))
    const dropped = listClaims((await w.server.writer.read(seller.sellerId, DATE)).state).find((claim) => claim.no === 23 && claim.status === 'DUPLICATE')
    const [droppedName, keptName] = dropped?.origin === 'sms' ? ['옛이름', '새이름'] : ['새이름', '옛이름']
    // 밀려난 찜: 재고 1·대기 0 → 두 번째는 거절
    await chat(w, seller, b, 'UCyoutube00000000000005', '첫손님', '24')
    await chat(w, seller, b, 'UCyoutube00000000000006', '늦은손님', '24')
    // 다른 범위: 리허설 회차의 같은 닉네임·같은 번호
    const rehearsal = ((await client(w, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: DATE, rehearsal: true })).body.broadcast as { id: string }).id
    await register(w, seller, rehearsal, 25)
    await chat(w, seller, rehearsal, 'UCyoutube00000000000007', '리허설손님', '25', true)
    const statuses = listClaims((await w.server.writer.read(seller.sellerId, DATE)).state).map((claim) => [claim.no, claim.status])
    expect(statuses).toEqual(expect.arrayContaining([[22, 'CANCELLED'], [23, 'DUPLICATE'], [24, 'REJECTED']]))

    const seen = await preview(w, seller, b, ['라마바: 21', '가나다: 22', '취소손님: 22', `${droppedName}: 23`, '늦은손님: 24', '리허설손님: 25', '중복손님: 25', '중복손님: 25'].join('\n'))
    expect(seen.rows.every((row) => row.overlaps === undefined)).toBe(true)
    expect(seen.total).toBe(8)
    // 대조: 활성 찜의 이름(남은 찜·첫손님)은 겹침
    const control = await preview(w, seller, b, `${keptName}: 23\n첫손님: 24`)
    expect(control.rows.map((row) => row.overlaps)).toEqual([[23], [24]])
  })
})
