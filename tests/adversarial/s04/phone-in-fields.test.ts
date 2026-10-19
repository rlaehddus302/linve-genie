// S04 적대 테스트 (test-domain) 라운드 2: 판매자 입력 칸의 휴대폰 번호 (DAT-06, D-073, R-1 입력 오류).
// - 회귀(통과): TD-S04-003 — 입금 메모·사유·방송 제목·상품 이름의 번호, 'ㅡ'·'~'로 나눈 번호는 이제 400이고 DB에 남지 않는다
// - 실패(TD-S04-004): 구매자·메시지 같은 ID 칸에 휴대폰 번호를 넣으면 '맞지 않는 명령'(changed=false)이나
//   미리 차단으로 그대로 기록돼 이벤트 로그·엔진 상태에 평문 번호가 남고, 차단은 다음 날짜 범위로도 이어진다.
//   DAT-06: "이벤트 로그·엔진 상태에는 전화번호 원문·정규화한 번호가 남지 않는다".
import { containsPhoneNumber } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { call, dumpAll, event, harness, startBroadcast, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const DAY = '2026-10-18'
const NEXT = '2026-10-19'

describe('TD-S04-003 회귀: 판매자 글 칸의 휴대폰 번호는 거절되고 DB에 남지 않는다', () => {
  it('ㅡ·물결로 나눈 번호에 다른 숫자가 함께 있어도 번호로 본다', () => {
    for (const text of ['3시 010ㅡ1234ㅡ5678', '010 ㅡ 1234 ㅡ 5678 2개', '3시 010~1234~5678', '010:1234:5678 3시']) {
      expect(containsPhoneNumber(text), text).toBe(true)
    }
    for (const text of ['3시 15번 2개', '101동 1203호', '1,2,3번 각 1개', '10,000원 입금', 'r-20261018-0001']) {
      expect(containsPhoneNumber(text), text).toBe(false)
    }
  })

  it('입금 메모·환불 사유·취소 사유·방송 제목·상품 이름의 번호 → 400(필드 이름과 쉬운 문장), 기록 없음', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    const title = await call(s, a.cookie, 'POST', '/api/broadcasts', { requestId: 'bt-1', date: DAY, title: '김영희 010-3131-4141 특집' })
    expect(title.status).toBe(400)
    expect(title.body).toMatchObject({ error: { problems: [{ field: 'title' }] } })
    const b = await startBroadcast(s, a.cookie, DAY)
    await event(s, a.cookie, { type: 'product.register', b, no: 1, name: '구피', price: 1000 })
    await s.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC1', nick: '하나', text: '1' })
    const cases: [Record<string, unknown>, string, string | undefined][] = [
      [{ type: 'product.register', b, no: 2, name: '구피 010-3131-4142', price: 1000 }, 'name', undefined],
      [{ type: 'product.update', b, no: 1, name: '3시 010ㅡ3131ㅡ4143' }, 'name', undefined],
      [{ type: 'host.cancel', b, no: 1, buyer: 'UC1', reason: '010 3131 4144 요청' }, 'reason', undefined],
      [{ type: 'settlement.payment', buyer: 'UC1', date: DAY, amount: 1000, memo: '김영희 010~3131~4145 2개' }, 'memo', DAY],
      [{ type: 'settlement.refund', buyer: 'UC1', date: DAY, amount: 1000, reason: '환불 010-3131-4146' }, 'reason', DAY],
    ]
    for (const [body, field, date] of cases) {
      const res = await event(s, a.cookie, body, date)
      expect(res.status, JSON.stringify(body)).toBe(400)
      const problems = (res.body.error as { problems: { field: string; message: string }[] }).problems
      expect(problems[0]?.field).toBe(field)
      expect(problems[0]?.message).toContain('전화번호')
    }
    const dump = await dumpAll(h.database)
    for (const needle of ['3131-414', '3131414', '3131ㅡ414', '3131~414', '3131 414']) expect(dump, needle).not.toContain(needle)
  }, 60_000)
})

describe('TD-S04-004: 구매자·메시지 ID 칸의 휴대폰 번호가 이벤트 로그·엔진 상태에 평문으로 남는다', () => {
  it('ID 칸에 번호를 넣은 요청은 기록되지 않는다(400), DB 어디에도 번호가 없다', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, DAY)
    await event(s, a.cookie, { type: 'product.register', b, no: 1, name: '구피', price: 1000 })
    await s.ingestChat(a.sellerId, { b, id: 'm1', ch: 'UC1', nick: '하나', text: '1' })
    const cases: [Record<string, unknown>, string | undefined][] = [
      // 판매자가 "이 번호 차단"을 하려고 번호를 적은 경우 — 미리 차단(모르는 구매자)으로 받아 changed=true
      [{ type: 'host.blockBuyer', buyer: '010-5151-6161', reason: '노쇼' }, DAY],
      // 입금자를 번호로 적은 경우 — 모르는 구매자라 맞지 않는 명령(changed=false)이지만 기록된다
      [{ type: 'settlement.payment', buyer: '01051516162', date: DAY, amount: 1000 }, DAY],
      [{ type: 'buyer.merge', from: '010 5151 6163', into: 'UC1', reason: '같은 사람' }, DAY],
      [{ type: 'host.assign', b, no: 1, buyer: '010-5151-6164', reason: '전화 주문' }, undefined],
      [{ type: 'host.convertMessage', b, msg: '010-5151-6165', no: 1 }, undefined],
    ]
    const accepted: string[] = []
    for (const [body, date] of cases) {
      const res = await event(s, a.cookie, body, date)
      if (res.status === 200) accepted.push(`${String(body.type)} → ${res.text}`)
    }
    const dump = await dumpAll(h.database)
    const leaked = ['5151-616', '5151616', '5151 616'].filter((needle) => dump.includes(needle))
    expect({ accepted, leaked }).toEqual({ accepted: [], leaked: [] })
  }, 60_000)

  it('번호로 미리 차단한 것이 다음 날짜 범위로 이어져 서버가 평문 번호를 다시 기록한다(host.blockBuyer 재기록)', async () => {
    h = await harness()
    const a = await h.account('shopa')
    const s = h.server
    await startBroadcast(s, a.cookie, DAY)
    await event(s, a.cookie, { type: 'host.blockBuyer', buyer: '010-7171-8181', reason: '노쇼' }, DAY)
    await startBroadcast(s, a.cookie, NEXT)
    const next = await call(s, a.cookie, 'GET', `/api/days/${NEXT}`)
    expect(next.status).toBe(200)
    expect(next.text).not.toContain('7171-8181')
    const pglite = h.database.pglite
    if (pglite === null) throw new Error('PGlite가 아니다')
    const rows = (await pglite.query<{ seq: number; actor: string }>("select seq, actor from events where body like '%7171-8181%' order by id")).rows
    expect(rows.map((r) => `${r.actor}#${String(r.seq)}`)).toEqual([])
  }, 60_000)
})
