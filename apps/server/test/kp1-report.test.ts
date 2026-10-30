// AC-KP1-17·18·26 방송 리포트 경로: 실제 날짜 하나의 모든 회차, 리허설 빼고, 볼 때 계산, 봉인 날짜, 정산 화면·판매대장과 같은 합, 권한.
import { describe, expect, it } from 'vitest'
import { at, chat, kst, ok } from './i2-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, login, newWorld, rid, type Seller, type TestServer } from './support.ts'

interface Settlement {
  buyer: string
  date: string
  subtotal: number
  total: number
  received: number
}

async function world(start = kst('2026-10-01', '09:00:00')): Promise<{ world: TestServer; seller: Seller }> {
  const w = await newWorld({ clock: fakeClock(start) })
  return { world: w, seller: await addSeller(w) }
}

const report = (w: TestServer, seller: Seller, date: string, query = '') => client(w, seller.cookie).get(`/api/days/${date}/report${query}`)

async function settlementsOf(w: TestServer, seller: Seller, date: string): Promise<Settlement[]> {
  const view = await expectOk(client(w, seller.cookie).get(`/api/days/${date}`))
  return (view.body.settlements as Settlement[]).filter((item) => item.date === date)
}

async function pay(w: TestServer, seller: Seller, date: string, buyer: string, amount: number): Promise<void> {
  await ok(w, seller, { type: 'settlement.payment', buyer, date, amount }, date)
}

/** 10-01: UC_A 한 개. 10-08: 1부(UC_A·UC_B, 몰림), 2부(UC_C 옵션 없는 두 번째 상품), 리허설(UC_R) */
async function sellTwoDays(w: TestServer, seller: Seller): Promise<{ b1: string; b2: string }> {
  at(w, '2026-10-01', '20:00:00')
  const old = (await createBroadcast(w, seller, { date: '2026-10-01', title: '지난 방송' })).id
  await ok(w, seller, { type: 'product.register', b: old, no: 1, name: '백모단', price: 10_000 })
  await chat(w, seller, old, 'o1', 'UC_A', '다육이맘', '1')

  at(w, '2026-10-08', '20:00:00')
  const b1 = (await createBroadcast(w, seller, { date: '2026-10-08', title: '1부' })).id
  const b2 = (await createBroadcast(w, seller, { date: '2026-10-08', title: '2부' })).id
  await ok(w, seller, { type: 'product.register', b: b1, no: 15, name: '청개구리', price: 20_000 })
  at(w, '2026-10-08', '20:00:03')
  await chat(w, seller, b1, 'n1', 'UC_A', '다육이맘', '15')
  at(w, '2026-10-08', '20:00:10')
  await chat(w, seller, b1, 'n2', 'UC_B', '초록손', '15')
  at(w, '2026-10-08', '20:12:00')
  await ok(w, seller, { type: 'product.register', b: b2, no: 3, name: '핑크 프릴', price: 15_000 })
  await chat(w, seller, b2, 'n3', 'UC_C', '새손님', '3')
  // 리허설 범위 — 리포트에 없다
  const r = (await createBroadcast(w, seller, { date: '2026-10-08', rehearsal: true })).id
  await ok(w, seller, { type: 'product.register', b: r, no: 1, name: '연습', price: 99_000 })
  await chat(w, seller, r, 'r1', 'UC_R', '연습손님', '1')
  return { b1, b2 }
}

describe('AC-KP1-17·18 방송 리포트 숫자', () => {
  it('실제 날짜의 두 회차를 함께, 리허설 빼고 — 정산 화면 합과 같고, 입금을 더 적으면 받은 돈이 바로 는다', async () => {
    const { world: w, seller } = await world()
    await sellTwoDays(w, seller)
    const first = await expectOk(report(w, seller, '2026-10-08'))
    expect(first.headers.get('cache-control')).toContain('no-store')
    const settlements = await settlementsOf(w, seller, '2026-10-08')
    const sum = (key: 'subtotal' | 'received') => settlements.reduce((total, item) => total + item[key], 0)
    expect(first.body.summary).toEqual({
      sales: 35_000,
      qty: 2,
      received: 0,
      unpaid: settlements.reduce((total, item) => total + Math.max(item.total - item.received, 0), 0),
      refund: 0,
      buyers: 2,
      unpaidBuyers: 2,
      newBuyers: 1,
      returningBuyers: 1,
      unknownBuyers: 0,
    })
    expect((first.body.summary as { sales: number }).sales).toBe(sum('subtotal'))
    expect(first.body.date).toBe('2026-10-08')
    expect(first.body.sealed).toBe(false)
    expect(first.body.live).toBe(true)
    // 비교: 지난 방송 10-01 (10,000원·1개·1명)
    expect(first.body.compare).toEqual({
      last: { date: '2026-10-01', sales: 10_000, qty: 1, buyers: 1, diff: { sales: 25_000, qty: 1, buyers: 1 } },
      recent: { count: 1, sales: 10_000, qty: 1, buyers: 1, diff: { sales: 25_000, qty: 1, buyers: 1 } },
    })
    expect(first.body.varieties).toEqual([
      { name: '청개구리', qty: 1, amount: 20_000 },
      { name: '핑크프릴', qty: 1, amount: 15_000 },
    ])
    expect(first.body.buckets).toEqual([
      { start: '2026-10-08 20:00', qty: 1, amount: 20_000 },
      { start: '2026-10-08 20:10', qty: 1, amount: 15_000 },
    ])
    // D-KP1-37: 그날 실제 회차가 둘이라 줄마다 회차 이름
    expect(first.body.rush).toEqual([
      { b: '1부', no: 15, name: '청개구리', buyers: 2, waiting: 1, scopeName: '1부' },
      { b: '2부', no: 3, name: '핑크 프릴', buyers: 1, waiting: 0, scopeName: '2부' },
    ])
    // 회차가 하나인 날은 회차 이름 칸이 없다
    const single = (await expectOk(report(w, seller, '2026-10-01'))).body.rush as Record<string, unknown>[]
    expect(single.length).toBeGreaterThan(0)
    for (const row of single) expect(row).not.toHaveProperty('scopeName')
    // 손님 이름·채널 ID는 없다
    expect(first.text).not.toMatch(/UC_|다육이맘|초록손|새손님|연습/)

    // 입금을 적으면 다음 조회에 바로 는다 (저장하지 않고 볼 때 계산)
    const a = settlements.find((item) => item.buyer === 'UC_A') as Settlement
    await pay(w, seller, '2026-10-08', 'UC_A', a.total)
    const second = await expectOk(report(w, seller, '2026-10-08'))
    const after = await settlementsOf(w, seller, '2026-10-08')
    expect((second.body.summary as { received: number }).received).toBe(after.reduce((total, item) => total + item.received, 0))
    expect(second.body.summary).toMatchObject({ received: a.total, unpaidBuyers: 1 })
  })

  it('모든 회차를 끝내면 live=false, 앞선 방송이 없는 날은 비교 없음', async () => {
    const { world: w, seller } = await world()
    const { b1, b2 } = await sellTwoDays(w, seller)
    for (const b of [b1, b2]) await expectOk(client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') }))
    expect((await expectOk(report(w, seller, '2026-10-08'))).body.live).toBe(false)
    const firstDay = await expectOk(report(w, seller, '2026-10-01'))
    expect(firstDay.body.compare).toEqual({ last: null, recent: null })
    expect(firstDay.body.summary).toMatchObject({ sales: 10_000, buyers: 1, newBuyers: 1, returningBuyers: 0 })
  })

  it('봉인 날짜는 장부 값으로 돈·손님·품종만, 시간대·몰린 상품은 null', async () => {
    const { world: w, seller: first } = await world()
    await sellTwoDays(w, first)
    const before = await expectOk(report(w, first, '2026-10-08'))
    at(w, '2026-11-20', '12:00:00')
    const seller = { ...first, cookie: await login(w, first.loginId, first.password) }
    expect(await w.server.sealer.runOnce()).toBeGreaterThanOrEqual(1)
    const sealed = await expectOk(report(w, seller, '2026-10-08'))
    expect(sealed.body.sealed).toBe(true)
    expect(sealed.body.live).toBe(false)
    expect(sealed.body.buckets).toBeNull()
    expect(sealed.body.rush).toBeNull()
    expect(sealed.body.summary).toEqual(before.body.summary)
    expect(sealed.body.varieties).toEqual(before.body.varieties)
    expect(sealed.body.compare).toEqual(before.body.compare)
  })
})

describe('AC-KP1-26 리포트 경로 권한', () => {
  it('로그인 없음 401, 보조자 403, 다른 판매자 404, 리허설·범위 없는 날짜 404', async () => {
    const { world: w, seller } = await world()
    await sellTwoDays(w, seller)
    expect((await client(w, null).get('/api/days/2026-10-08/report')).status).toBe(401)
    const created = await expectOk(client(w, seller.cookie).post('/api/assistants', { name: '엄마' }))
    const assistant = created.body as { assistant: { loginId: string }; password: string }
    const helper = await login(w, assistant.assistant.loginId, assistant.password)
    const forbidden = await client(w, helper).get('/api/days/2026-10-08/report')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body).toEqual({ error: { code: 'ASSISTANT_FORBIDDEN', message: '보조자 계정으로는 할 수 없는 일이에요.' } })
    const other = await addSeller(w)
    const stranger = await client(w, other.cookie).get('/api/days/2026-10-08/report')
    expect(stranger.status).toBe(404)
    expect(stranger.headers.get('cache-control')).toContain('no-store')
    expect((await report(w, seller, '2026-10-08', '?rehearsal=true')).status).toBe(404)
    expect((await report(w, seller, '2026-10-02')).status).toBe(404)
    expect((await report(w, seller, '2026-13-02')).status).toBe(404)
    expect((await report(w, seller, '2026-10-08', '?rehearsal=maybe')).status).toBe(400)
  })
})
