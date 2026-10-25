// CRM1 수정 라운드 시험 (dev-server):
// - TD-CRM1-001 음성 문자찜의 "끝자리만"·"새 손님으로 넣기" 구매자는 전화번호 없는 문자 손님 — "모든 손님"에 없고 메모 칸이 없다. 전체 번호로 넣은 문자 손님은 그대로 날짜를 넘는다
// - RA-CRM1-01 날짜 재료 캐시는 범위마다 한 자리 — 방송 중 seq가 바뀌며 여러 번 조회해도 자리가 늘지 않는다
// - RA-CRM1-02 '입금 안 함' 찾기는 이어 센다(새 후보 뒤만 다시 적용), 이어 갈 상태가 없으면 스냅샷에서 시작, 같은 재료를 동시에 세우면 한 번만
import { describe, expect, it } from 'vitest'
import { factsBuildCount, factsCacheStats, forgetNoPayStates, noPayReplayCount } from '../src/customers/facts.ts'
import { at, buy, chat, crm, crmWorld, kst, ok, payAll } from './crm1-support.ts'
import { addSeller, createBroadcast, fakeClock, newWorld } from './support.ts'

describe('TD-CRM1-001 끝자리만 말한 문자 손님은 날짜를 넘지 않는다', () => {
  it('끝자리만·새 손님으로 넣기 구매자는 "모든 손님"에 없고 메모 칸이 없다 — 전체 번호 구매자는 두 날짜가 한 줄', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const byDate = new Map<string, { last4: string; fresh: string; phone: string }>()
    for (const date of ['2026-10-01', '2026-10-08']) {
      at(world, date, '20:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 10_000 })
      await ok(world, seller, { type: 'product.register', b, no: 2, name: '둘', price: 20_000 })
      await ok(world, seller, { type: 'product.register', b, no: 3, name: '셋', price: 30_000 })
      const phone = (await ok(world, seller, { type: 'sms', b, no: 3, received: '20:00', phone: '010-7777-9999' })).body.buyer as string
      const last4 = (await ok(world, seller, { type: 'sms', b, no: 1, received: '20:01', last4: '1234', voice: true })).body.buyer as string
      const fresh = (await ok(world, seller, { type: 'sms', b, no: 2, received: '20:02', last4: '1234', newBuyer: true, voice: true })).body.buyer as string
      for (const buyer of [phone, last4, fresh]) await payAll(world, seller, date, buyer)
      byDate.set(date, { last4, fresh, phone })
    }
    at(world, '2026-10-26', '12:00:00')
    const rows = await c.rows()
    expect(rows.map((row) => [row.kindLabel, row.purchaseDays, row.latestDate])).toEqual([['문자 · 끝자리 9999', 2, '2026-10-08']])
    const day = byDate.get('2026-10-08')
    expect(day).toBeDefined()
    for (const buyer of [day?.last4, day?.fresh] as string[]) {
      expect(await c.members('2026-10-08', buyer)).toEqual([expect.objectContaining({ buyer, phoneLast4: '1234', customer: null, memo: null })])
      expect((await c.summary('2026-10-08', buyer)).purchaseDays).toBe(1)
    }
    const [phoneMember] = await c.members('2026-10-08', day?.phone as string)
    expect(phoneMember?.customer).toMatch(/^[0-9a-f]{32}$/)
    expect((await c.summary('2026-10-08', day?.phone as string)).purchaseDays).toBe(2)
  })
})

describe('RA-CRM1-01 날짜 재료 캐시는 범위마다 한 자리', () => {
  it('방송 중 채팅이 들어올 때마다 조회해도 자리가 늘지 않고, 값은 매번 새 seq의 값이다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const { b } = await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await c.dayList('2026-10-01')
    const start = factsCacheStats().entries
    for (let index = 0; index < 12; index += 1) {
      await ok(world, seller, { type: 'product.register', b, no: 600 + index, name: `더${String(index)}`, price: 1000 })
      await chat(world, seller, b, `more-${String(index)}`, 'UC_A', '다육이맘', String(600 + index))
      const summary = await c.summary('2026-10-01', 'UC_A')
      expect(summary.cancels).toBe(0)
    }
    expect(factsCacheStats().entries).toBe(start)
    expect(factsCacheStats().weight).toBeGreaterThan(0)
  })
})

describe("RA-CRM1-02 '입금 안 함' 찾기는 이어 센다", () => {
  /** 같은 이야기를 한 세계에서: 채팅 20개 → '입금 안 함' 취소 → 둘째 취소 → (상태를 잃고) 셋째 취소. 단계마다 요약·다시 적용한 이벤트 수 */
  async function story(snapshotEvery: number) {
    const world = await newWorld({ clock: fakeClock(kst('2026-09-28', '09:00:00')), snapshotEvery })
    const seller = await addSeller(world)
    const c = crm(world, seller)
    const date = '2026-10-01'
    const replays: number[] = []
    const summaries: unknown[] = []
    const look = async (...buyers: string[]) => {
      at(world, '2026-10-26', '12:00:00')
      const before = noPayReplayCount()
      for (const buyer of buyers) summaries.push(await c.summary(date, buyer))
      replays.push(noPayReplayCount() - before)
    }
    const first = await buy(world, seller, date, 'UC_A', '다육이맘', 10_000)
    for (let index = 0; index < 20; index += 1) await chat(world, seller, first.b, `pad-${String(index)}`, 'UC_Z', '구경꾼', '안녕하세요')
    await ok(world, seller, { type: 'host.cancel', b: first.b, no: first.no, buyer: 'UC_A', reason: '입금 안 함' })
    await look('UC_A')
    at(world, date, '21:00:00')
    await ok(world, seller, { type: 'product.register', b: first.b, no: 700, name: '둘째', price: 5000 })
    await chat(world, seller, first.b, 'second', 'UC_A', '다육이맘', '700')
    await ok(world, seller, { type: 'host.cancel', b: first.b, no: 700, buyer: 'UC_A', reason: '입금안함' })
    await look('UC_A')
    forgetNoPayStates()
    at(world, date, '21:30:00')
    await ok(world, seller, { type: 'product.register', b: first.b, no: 701, name: '셋째', price: 5000 })
    await chat(world, seller, first.b, 'third', 'UC_B', '초록손', '701')
    await ok(world, seller, { type: 'host.cancel', b: first.b, no: 701, buyer: 'UC_B', reason: '입금 안 함' })
    await look('UC_A', 'UC_B')
    return { replays, summaries }
  }

  it('새 후보가 생기면 지난번 뒤만 다시 적용하고, 이어 갈 상태가 없으면 앞선 스냅샷에서 시작한다 — 값은 스냅샷 없이 센 것과 같다', async () => {
    const plain = await story(500)
    const snap = await story(5)
    expect(plain.summaries).toEqual([
      expect.objectContaining({ unpaidDays: 1, cancels: 1 }),
      expect.objectContaining({ unpaidDays: 1, cancels: 2 }),
      expect.objectContaining({ unpaidDays: 1, cancels: 2 }),
      expect.objectContaining({ unpaidDays: 1, cancels: 1 }),
    ])
    expect(snap.summaries).toEqual(plain.summaries)
    const [plainFirst = 0, plainSecond = 0, plainThird = 0] = plain.replays
    // 스냅샷이 없으면 처음엔 0번부터, 둘째는 첫 후보 뒤만(상품 등록·채팅·취소 셋), 상태를 잃은 셋째는 다시 0번부터
    expect(plainFirst).toBeGreaterThan(20)
    expect(plainSecond).toBeGreaterThan(0)
    expect(plainSecond).toBeLessThanOrEqual(3)
    expect(plainThird).toBeGreaterThan(20)
    // 스냅샷(5개마다)이 있으면 처음도, 상태를 잃은 뒤도 첫 새 후보 앞 스냅샷에서 시작한다
    for (const count of snap.replays) {
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(5)
    }
  })

  it('같은 날짜 재료를 동시에 세우는 조회 여럿은 한 번만 세운다 (휴대폰·PC가 함께 연다)', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const { b, no } = await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.cancel', b, no, buyer: 'UC_A', reason: '입금 안 함' })
    await buy(world, seller, '2026-10-02', 'UC_A', '다육이맘', 20_000)
    await payAll(world, seller, '2026-10-02', 'UC_A')
    at(world, '2026-10-26', '12:00:00')
    const builds = factsBuildCount()
    const replays = noPayReplayCount()
    const results = await Promise.all([c.summary('2026-10-02', 'UC_A'), c.summary('2026-10-02', 'UC_A'), c.summary('2026-10-01', 'UC_A')])
    for (const result of results) expect(result).toMatchObject({ purchaseDays: 1, purchaseTotal: 20_000, unpaidDays: 1, cancels: 1 })
    expect(factsBuildCount() - builds).toBe(2)
    const once = noPayReplayCount() - replays
    expect(once).toBeGreaterThan(0)
    // 다시 물어도 다시 적용하지 않는다
    await c.summary('2026-10-02', 'UC_A')
    expect(noPayReplayCount() - replays).toBe(once)
  })
})
