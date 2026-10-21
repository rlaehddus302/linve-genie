// RA-N3-003: 입금 화면 조회가 읽는 범위 상태를 묶는다 (NFR-01, DP-0 5, AC-N3-23·25·33).
// - 확인 필요 목록·자동 확인: 입금 날짜마다 [dd − 30일, dd] 창의 합집합만 읽는다(가장 이른 입금 −30일 ~ 가장 늦은 입금 사이를 다 읽지 않는다).
// - 날짜 없는 묶음 찾기: 입금 날짜 60일 전 ~ 30일 뒤만, 늦은 날짜부터, 메모리를 밀어내지 않는 읽기(peek), 남은 금액 있는 묶음이 50개면 멈춤.
// - 기억한 입금자명의 표시 이름: 최근 60일 + 그 채널에 입금 확인으로 적은 가장 늦은 날짜.
// - 확인 필요 다시 계산은 묶음 이름 정규화를 한 번만 한다(evaluateEach = 입금마다 evaluateDeposits).
// 걸린 시간은 재지 않는다(D-902) — 읽은 날짜를 센다.
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateDeposits, evaluateEach, type MatchBundle, type MatchDeposit } from '../src/deposit/match.ts'
import { addSeller, createBroadcast, expectOk } from './support.ts'
import { depositApi, depositWorld, deposits, kst, order, pasteText, register } from './deposit-support.ts'

type World = Awaited<ReturnType<typeof depositWorld>>
type Seller = Awaited<ReturnType<typeof addSeller>>

afterEach(() => {
  vi.restoreAllMocks()
})

/** 그 날짜에 실제 범위 하나 (상품 하나 — seq > 0) */
async function scopeOn(world: World, seller: Seller, date: string, no = 1): Promise<string> {
  const b = await createBroadcast(world, seller, { date })
  await register(world, seller, b.id, no)
  return b.id
}

/** 조회 하나 동안 writer.read·peek가 읽은 날짜 */
async function readsDuring(world: World, work: () => Promise<unknown>): Promise<{ read: string[]; peek: string[] }> {
  const writer = world.server.writer
  const read = vi.spyOn(writer, 'read')
  const peek = vi.spyOn(writer, 'peek')
  await work()
  const out = { read: read.mock.calls.map((call) => call[1]), peek: peek.mock.calls.map((call) => call[1]) }
  read.mockRestore()
  peek.mockRestore()
  return out
}

describe('RA-N3-003 확인 필요 목록은 입금 날짜 창의 합집합만 읽는다', () => {
  it('40일 전 확인 필요 입금 + 오늘 입금: [9/9 − 30일, 9/9] ∪ [10/19 − 30일, 10/19]의 범위만 — 그 사이(9/14)·창 밖(8/9)은 읽지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    for (const date of ['2026-08-09', '2026-08-10', '2026-09-04', '2026-09-14', '2026-09-29', '2026-10-14']) await scopeOn(world, seller, date)
    world.clock.set(kst('2026-09-10 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-09-09 10:00:00', name: '옛입금', amount: 3_000 }])))
    world.clock.set(kst('2026-10-19 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '새입금', amount: 4_000 }])))
    const reads = await readsDuring(world, async () => {
      expect((await deposits(api)).map((item) => item.name)).toEqual(['새입금', '옛입금'])
    })
    expect([...new Set(reads.read)].sort()).toEqual(['2026-08-10', '2026-09-04', '2026-09-29', '2026-10-14'])
  })
})

describe('RA-N3-003 날짜를 고르지 않은 묶음 찾기', () => {
  it('입금 날짜 60일 전 ~ 30일 뒤의 범위만 늦은 날짜부터, 메모리를 밀어내지 않는 읽기로 — 더 먼 날짜는 날짜를 골라 찾는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.clock.set(kst('2026-08-19 20:00'))
    const far = await scopeOn(world, seller, '2026-08-19', 7)
    await order(world, seller, far, 'UC_F', '먼손님', '7')
    world.clock.set(kst('2026-08-20 20:00'))
    const edge = await scopeOn(world, seller, '2026-08-20', 8)
    await order(world, seller, edge, 'UC_E', '끝손님', '8')
    world.clock.set(kst('2026-10-18 20:00'))
    const near = await scopeOn(world, seller, '2026-10-18', 9)
    await order(world, seller, near, 'UC_N', '가까운손님', '9')
    world.clock.set(kst('2026-10-19 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '모르는이름', amount: 1_234 }])))
    const cached = world.server.writer.cachedScopes
    let found: { date: string; buyer: string }[] = []
    const reads = await readsDuring(world, async () => {
      found = ((await expectOk(api.bundles(1, ''))).body as { bundles: { date: string; buyer: string }[] }).bundles
    })
    expect(found.map((bundle) => [bundle.date, bundle.buyer])).toEqual([
      ['2026-10-18', 'UC_N'],
      ['2026-08-20', 'UC_E'],
    ])
    expect(reads.read).toEqual([])
    expect(reads.peek).toEqual(['2026-10-18', '2026-08-20'])
    expect(world.server.writer.cachedScopes).toBe(cached)
    // 더 먼 날짜는 날짜를 골라 찾는다 (확정할 수 있는 묶음은 그대로 — AC-N3-24 "30일 밖 날짜도")
    const picked = ((await expectOk(api.bundles(1, '먼손', '2026-08-19'))).body as { bundles: { date: string; buyer: string }[] }).bundles
    expect(picked.map((bundle) => [bundle.date, bundle.buyer])).toEqual([['2026-08-19', 'UC_F']])
  })

  it('남은 금액이 있는 묶음이 50개를 채우면 더 이른 날짜는 읽지 않는다(결과 순서상 50개 안에 들 수 없다)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.clock.set(kst('2026-10-10 20:00'))
    const old = await scopeOn(world, seller, '2026-10-10', 1)
    await order(world, seller, old, 'UC_OLD', '옛손님', '1')
    world.clock.set(kst('2026-10-18 20:00'))
    const busy = await scopeOn(world, seller, '2026-10-18', 1)
    // 손님마다 다른 상품 (선착순이라 같은 상품이면 1등 하나만 묶음이 생긴다)
    for (let i = 2; i <= 51; i++) await register(world, seller, busy, i)
    for (let i = 1; i <= 51; i++) await order(world, seller, busy, `UC_${String(i).padStart(2, '0')}`, `손님${String(i)}`, String(i))
    world.clock.set(kst('2026-10-19 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '모르는이름', amount: 1_234 }])))
    let found: { date: string }[] = []
    const reads = await readsDuring(world, async () => {
      found = ((await expectOk(api.bundles(1, ''))).body as { bundles: { date: string }[] }).bundles
    })
    expect(reads.peek).toEqual(['2026-10-18'])
    expect(found).toHaveLength(50)
    expect(new Set(found.map((bundle) => bundle.date))).toEqual(new Set(['2026-10-18']))
  })
})

describe('RA-N3-003 기억한 입금자명의 구매자 표시 이름', () => {
  it('최근 60일을 늦은 날짜부터 보고, 거기 없는 채널은 그 채널에 입금 확인으로 적은 가장 늦은 날짜에서 — 전 기간을 거꾸로 읽지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.clock.set(kst('2026-07-21 20:00'))
    const b = await scopeOn(world, seller, '2026-07-21', 15)
    await order(world, seller, b, 'UC_A', '다육이맘', '15')
    await scopeOn(world, seller, '2026-07-30', 2)
    await scopeOn(world, seller, '2026-10-09', 3)
    world.clock.set(kst('2026-10-19 12:00'))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '김영희', amount: 14_000 }])))
    await expectOk(api.confirm(1, { date: '2026-07-21', buyer: 'UC_A', remaining: 14_000, remember: true }))
    let names: { name: string; buyerName: string }[] = []
    const reads = await readsDuring(world, async () => {
      names = ((await expectOk(api.names())).body as { names: { name: string; buyerName: string }[] }).names
    })
    expect(names).toMatchObject([{ name: '김영희', buyerName: '다육이맘' }])
    expect(reads.read).toEqual([])
    expect(reads.peek).toEqual(['2026-10-09', '2026-07-21'])
  })
})

describe('RA-N3-003 evaluateEach = 입금마다 evaluateDeposits (묶음 이름 정규화 한 번)', () => {
  it('무작위 묶음·입금 (fast-check)', () => {
    const names = ['김영희', '김 영희', 'ＡＢＣ', 'abc', '다육이맘', '', '홍길동(엄마)']
    const dates = ['2026-09-20', '2026-10-01', '2026-10-17', '2026-10-18', '2026-10-19']
    const bundle = fc.record({
      buyer: fc.constantFrom('UC_A', 'UC_B', 'UC_C', 'sms_1'),
      date: fc.constantFrom(...dates),
      names: fc.array(fc.constantFrom(...names), { maxLength: 3 }),
      total: fc.constantFrom(7_000, 14_000, 21_000),
      received: fc.constantFrom(0, 7_000, 14_000),
      saleAt: fc.option(fc.constantFrom(kst('2026-09-20 20:00'), kst('2026-10-17 20:00'), kst('2026-10-18 20:00')), { nil: null }),
    })
    const deposit = fc.record({
      at: fc.constantFrom(kst('2026-10-17 21:00'), kst('2026-10-18 21:00'), kst('2026-10-19 10:00'), kst('2026-10-19 11:00')),
      amount: fc.constantFrom(7_000, 14_000),
      name: fc.constantFrom(...names),
    })
    fc.assert(
      fc.property(fc.array(bundle, { maxLength: 8 }), fc.array(deposit, { minLength: 1, maxLength: 10 }), fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }), (rawBundles, rawDeposits, pick) => {
        const bundles: MatchBundle[] = rawBundles.map((item, index) => ({ key: `${item.date}|${item.buyer}|${String(index)}`, ...item }))
        const all: MatchDeposit[] = rawDeposits.map((item, index) => ({ no: index + 1, ...item }))
        const targets = all.filter((_, index) => pick[index] === true)
        const each = evaluateEach({ bundles, earlier: all, targets })
        const one = targets.map((target) => evaluateDeposits({ bundles, earlier: all.filter((other) => other.no < target.no), incoming: [target] })[0])
        expect(each).toEqual(one)
      }),
      { numRuns: 500 },
    )
  })
})

