// AC-I2-40 지난 구매 조회 (BUY-05, D-I2-08): 채널 ID·전화번호 키로만, 한 번만 따라간다
import { describe, expect, it } from 'vitest'
import { at, chat, kst, ok, pack } from './i2-support.ts'
import { addSeller, client, createBroadcast, fakeClock, newWorld, type Seller, type TestServer } from './support.ts'

interface PastItem {
  date: string
  buyer: string
  name: string
  broadcasts: string[]
  items: { title: string; no: number; name: string; price: number }[]
  subtotal: number
  total: number
  payment: string
  received: number
  packing: string
  invoice: string | null
  reasons: string[]
}

async function past(world: TestServer, seller: Seller, date: string, buyer: string, before?: string): Promise<{ status: number; items: PastItem[]; more: boolean; next: string | null; text: string }> {
  const response = await client(world, seller.cookie).get(`/api/days/${date}/past?buyer=${encodeURIComponent(buyer)}${before === undefined ? '' : `&before=${before}`}`)
  return { status: response.status, items: (response.body.items ?? []) as PastItem[], more: response.body.more as boolean, next: (response.body.next ?? null) as string | null, text: response.text }
}

/** 고정할 예 (실제 범위 셋) */
async function world3() {
  const world = await newWorld({ clock: fakeClock(kst('2026-10-17', '09:00:00')) })
  const seller = await addSeller(world)
  at(world, '2026-10-18', '20:00:00')
  const d18 = (await createBroadcast(world, seller, { date: '2026-10-18', title: '18일 방송' })).id
  await ok(world, seller, { type: 'product.register', b: d18, no: 15, name: '핑크프릴', price: 10000 })
  await ok(world, seller, { type: 'product.register', b: d18, no: 31, name: '방울복랑', price: 15000 })
  await chat(world, seller, d18, 'a', 'UC_A', '홍길동', '15')
  const s1 = (await ok(world, seller, { type: 'sms', b: d18, no: 31, received: '20:00', phone: '010-1111-2222' })).body.buyer as string
  at(world, '2026-10-19', '20:00:00')
  const d19 = (await createBroadcast(world, seller, { date: '2026-10-19', title: '19일 방송' })).id
  for (const no of [7, 8, 9, 10]) await ok(world, seller, { type: 'product.register', b: d19, no, name: `품종${String(no)}`, price: 1000 * no })
  await chat(world, seller, d19, 'b', 'UC_A', '길동이', '7')
  const phone19 = (await ok(world, seller, { type: 'sms', b: d19, no: 8, received: '20:00', phone: '010-1111-2222' })).body.buyer as string
  const nophone19 = (await ok(world, seller, { type: 'sms', b: d19, no: 9, received: '20:00', memo: '홍길동' })).body.buyer as string
  await chat(world, seller, d19, 'c', 'UC_B', '홍길동', '10')
  at(world, '2026-10-20', '20:00:00')
  const d20 = (await createBroadcast(world, seller, { date: '2026-10-20' })).id
  await chat(world, seller, d20, 'd', 'UC_A', '길동이', '안녕하세요')
  return { world, seller, d18, d19, s1, phone19, nophone19 }
}

describe('AC-I2-40 지난 구매 조회', () => {
  it('10/19 UC_A의 지난 구매 = 10/18 UC_A 묶음 하나(같은 유튜브 채널) — 10/20(품목 없음)·같은 닉네임 UC_B·메모 홍길동 문자 구매자는 없다', async () => {
    const { world, seller } = await world3()
    const view = await past(world, seller, '2026-10-19', 'UC_A')
    expect(view.status, view.text).toBe(200)
    expect(view.items).toEqual([
      expect.objectContaining({
        date: '2026-10-18',
        buyer: 'UC_A',
        name: '홍길동',
        broadcasts: ['18일 방송'],
        items: [{ title: '18일 방송', no: 15, name: '핑크프릴', price: 10000 }],
        subtotal: 10000,
        total: 14000,
        payment: 'UNPAID',
        received: 0,
        packing: '포장 대기',
        invoice: null,
        reasons: ['같은 유튜브 채널'],
      }),
    ])
    expect(view.more).toBe(false)
    expect(view.next).toBeNull()
  })

  it('10/19 전화 문자 구매자의 지난 구매 = 10/18 문자 구매자 묶음(같은 휴대폰 번호(끝자리 2222)), 전화 없는 문자 구매자 = 없음, 응답에 전화번호 키·전화번호 전체 없음', async () => {
    const { world, seller, s1, phone19, nophone19 } = await world3()
    const view = await past(world, seller, '2026-10-19', phone19)
    expect(view.items.map((item) => [item.date, item.buyer, item.reasons])).toEqual([['2026-10-18', s1, ['같은 휴대폰 번호(끝자리 2222)']]])
    expect((await past(world, seller, '2026-10-19', nophone19)).items).toEqual([])
    const keys = await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'sms'`)
    const phoneKeys = (keys?.rows ?? []).map((row) => (JSON.parse(row.body) as { phoneKey?: string }).phoneKey).filter((key): key is string => typeof key === 'string')
    expect(phoneKeys.length).toBeGreaterThan(0)
    for (const key of phoneKeys) expect(view.text).not.toContain(key)
    expect(view.text).not.toContain('010-1111-2222')
    expect(view.text).not.toContain('01011112222')
  })

  it('10/19에서 전화 문자 구매자를 UC_A에 합치면 지난 구매 두 항목, 10/18에서 sms:s1을 UC_A에 합쳐 두었으면 10/18 UC_A 한 항목(까닭 둘)', async () => {
    const { world, seller, s1, phone19 } = await world3()
    await ok(world, seller, { type: 'buyer.merge', from: phone19, into: 'UC_A', reason: '같은 사람' }, '2026-10-19')
    let view = await past(world, seller, '2026-10-19', 'UC_A')
    expect(view.items.map((item) => [item.date, item.buyer, item.reasons]).sort()).toEqual([
      ['2026-10-18', 'UC_A', ['같은 유튜브 채널']],
      ['2026-10-18', s1, ['같은 휴대폰 번호(끝자리 2222)']],
    ])
    // 합쳐진 구매자 ID로 물어도 지금의 구매자(UC_A)로 푼다
    expect((await past(world, seller, '2026-10-19', phone19)).items).toHaveLength(2)
    await ok(world, seller, { type: 'buyer.merge', from: s1, into: 'UC_A', reason: '같은 사람' }, '2026-10-18')
    view = await past(world, seller, '2026-10-19', 'UC_A')
    expect(view.items.map((item) => [item.date, item.buyer, [...item.reasons].sort()])).toEqual([['2026-10-18', 'UC_A', ['같은 유튜브 채널', '같은 휴대폰 번호(끝자리 2222)']]])
    expect(view.items[0]?.subtotal).toBe(25000)
  })

  it('한 번만 따라간다 — 찾은 묶음의 다른 구매자로 다시 넓히지 않는다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-17', '09:00:00')) })
    const seller = await addSeller(world)
    // 10/18: UC_A와 UC_Z를 한 사람으로 합쳐 둠. 10/19: UC_Z만. 10/20: UC_A를 본다 → 10/18(UC_A 채널)만, 10/19 UC_Z는 나오지 않는다
    at(world, '2026-10-18', '20:00:00')
    const d18 = (await createBroadcast(world, seller, { date: '2026-10-18' })).id
    await ok(world, seller, { type: 'product.register', b: d18, no: 1, name: '하나', price: 1000 })
    await ok(world, seller, { type: 'product.register', b: d18, no: 2, name: '둘', price: 1000 })
    await chat(world, seller, d18, 'a1', 'UC_A', '에이', '1')
    await chat(world, seller, d18, 'z1', 'UC_Z', '제트', '2')
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_Z', into: 'UC_A', reason: '같은 사람' }, '2026-10-18')
    at(world, '2026-10-19', '20:00:00')
    const d19 = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b: d19, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, d19, 'z2', 'UC_Z', '제트', '1')
    at(world, '2026-10-20', '20:00:00')
    const d20 = (await createBroadcast(world, seller, { date: '2026-10-20' })).id
    await ok(world, seller, { type: 'product.register', b: d20, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, d20, 'a3', 'UC_A', '에이', '1')
    const view = await past(world, seller, '2026-10-20', 'UC_A')
    expect(view.items.map((item) => [item.date, item.buyer])).toEqual([['2026-10-18', 'UC_A']])
  })

  it('항목: 포장·배송 상태·송장, 입금만 있는 묶음(품목 없음·받은 금액 있음)은 넣고, 품목도 받은 금액도 없는 묶음은 뺀다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-17', '09:00:00')) })
    const seller = await addSeller(world)
    at(world, '2026-10-17', '20:00:00')
    const d17 = (await createBroadcast(world, seller, { date: '2026-10-17' })).id
    await chat(world, seller, d17, 'p', 'UC_A', '에이', '안녕')
    await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-17', amount: 5000 }, '2026-10-17')
    at(world, '2026-10-18', '20:00:00')
    const d18 = (await createBroadcast(world, seller, { date: '2026-10-18' })).id
    await ok(world, seller, { type: 'product.register', b: d18, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, d18, 'a', 'UC_A', '에이', '1')
    expect((await pack(world, seller, '2026-10-18', { buyer: 'UC_A', action: 'pack', items: [`${d18}/1`] })).status).toBe(200)
    expect((await pack(world, seller, '2026-10-18', { buyer: 'UC_A', action: 'ship', invoice: '123456789012' })).status).toBe(200)
    at(world, '2026-10-19', '20:00:00')
    const d19 = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await chat(world, seller, d19, 'b', 'UC_A', '에이', '구경')
    const view = await past(world, seller, '2026-10-19', 'UC_A')
    expect(view.items.map((item) => [item.date, item.packing, item.invoice, item.received, item.payment])).toEqual([
      ['2026-10-18', '배송 완료', '123456789012', 0, 'UNPAID'],
      ['2026-10-17', '포장 대기', null, 5000, 'OVERPAID'],
    ])
  })

  it('최근 날짜부터 20개, 다음 쪽은 before=<next>', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-09-01', '09:00:00')) })
    const seller = await addSeller(world)
    const dates: string[] = []
    for (let day = 1; day <= 26; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`
      dates.push(date)
      at(world, date, '20:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
      await chat(world, seller, b, `m${String(day)}`, 'UC_A', '에이', '1')
    }
    const first = await past(world, seller, '2026-09-26', 'UC_A')
    expect(first.items.map((item) => item.date)).toEqual(dates.slice(5, 25).reverse())
    expect(first.more).toBe(true)
    expect(first.next).toBe('2026-09-06')
    const second = await past(world, seller, '2026-09-26', 'UC_A', first.next ?? '')
    expect(second.items.map((item) => item.date)).toEqual(dates.slice(0, 5).reverse())
    expect(second.more).toBe(false)
  })

  it('다른 판매자의 범위·리허설 범위·모르는 구매자 → 404, 다른 판매자의 같은 채널 ID 기록은 찾지 않는다, 리허설 기록은 보지 않는다', async () => {
    const { world, seller } = await world3()
    const other = await addSeller(world)
    at(world, '2026-10-21', '20:00:00')
    const theirs = (await createBroadcast(world, other, { date: '2026-10-21' })).id
    await ok(world, other, { type: 'product.register', b: theirs, no: 1, name: '남의', price: 1000 })
    await chat(world, other, theirs, 'o', 'UC_A', '남의 홍길동', '1')
    const rehearsal = (await createBroadcast(world, seller, { date: '2026-10-21', rehearsal: true })).id
    await ok(world, seller, { type: 'product.register', b: rehearsal, no: 1, name: '연습', price: 1000 })
    await chat(world, seller, rehearsal, 'r', 'UC_A', '연습', '1')
    expect((await past(world, seller, '2026-10-19', 'UC_A')).items.map((item) => item.date)).toEqual(['2026-10-18'])
    expect((await past(world, other, '2026-10-21', 'UC_A')).items).toEqual([])
    expect((await past(world, other, '2026-10-19', 'UC_A')).status).toBe(404)
    expect((await client(world, seller.cookie).get('/api/days/2026-10-21/past?buyer=UC_A&rehearsal=true')).status).toBe(404)
    expect((await past(world, seller, '2026-10-19', 'UC_NOBODY')).status).toBe(404)
    expect((await client(world, seller.cookie).get('/api/days/2026-10-19/past?buyer=UC_A&before=x')).status).toBe(400)
    expect((await client(world, null).get('/api/days/2026-10-19/past?buyer=UC_A')).status).toBe(401)
  })

  it('성능: 실제 범위 100개(범위마다 구매자 50명)에서 첫 쪽 응답이 2초 안 (메모리 캐시 없이)', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-06-01', '09:00:00')) })
    const seller = await addSeller(world)
    for (let day = 0; day < 100; day++) {
      const date = new Date(Date.UTC(2026, 5, 2 + day)).toISOString().slice(0, 10)
      at(world, date, '20:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await world.server.writer.write({
        sellerId: seller.sellerId,
        date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        build: () =>
          Array.from({ length: 50 }, (_, i) => [
            { fields: { type: 'product.register', b, no: i + 1, name: `품종${String(i)}`, price: 1000 }, actor: { kind: 'server' } as const },
            { fields: { type: 'chat', b, id: `c${String(i)}`, ch: `UC_${String(i).padStart(3, '0')}`, nick: `구매자${String(i)}`, text: String(i + 1) }, actor: { kind: 'collector' } as const, chat: { b, id: `c${String(i)}` } },
          ]).flat(),
      })
    }
    world.server.writer.forgetSeller(seller.sellerId)
    const last = new Date(Date.UTC(2026, 5, 101)).toISOString().slice(0, 10)
    const started = performance.now()
    const view = await past(world, seller, last, 'UC_007')
    const elapsed = performance.now() - started
    expect(view.items).toHaveLength(20)
    expect(view.more).toBe(true)
    expect(elapsed).toBeLessThan(2000)
  }, 300_000)
})
