// AC-S06b-12 보기 캐시 전체 상한 (RA-S06-002, NFR-01, NFR-04, SYS-02, D-096, D-104).
// - 범위마다의 캐시 크기(색인 8·메시지 4)는 그대로.
// - 판매자마다 보기 캐시를 가진 범위는 가장 최근에 조회한 4개까지, 서버 전체 32개까지, 마지막 조회 뒤 10분이 지나면 비운다(주입 시계).
// - 다른 판매자의 캐시는 그 판매자 몫 상한으로 비우지 않는다. 비운 범위를 다시 조회하면 다시 계산하고 응답은 같다(증분 조회 포함).
// - 범위 실행 상태(writer의 128개 상한) 규칙은 그대로다 — 비우는 것은 보기 캐시뿐.
import { describe, expect, it } from 'vitest'
import { StateCache } from '../src/state-cache.ts'
import { VIEW_CACHE_IDLE_MS, VIEW_CACHE_SCOPES_MAX, VIEW_CACHE_SCOPES_PER_SELLER, ViewCacheBudget, type ViewScope } from '../src/view-budget.ts'
import { MESSAGE_LOOKUP_CACHE_MAX, VIEW_INDEX_CACHE_MAX, newViewCaches } from '../src/views.ts'
import { DEFAULT_RUNTIME_CACHE_MAX } from '../src/writer.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const DATES = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] as const

const runtimeOf = (world: TestServer, seller: Seller, date: string, rehearsal = false) => world.server.writer.read(seller.sellerId, date, rehearsal)

/** 그 날짜에 방송과 상품 하나·채팅 하나 */
async function scope(world: TestServer, seller: Seller, date: string, rehearsal = false): Promise<string> {
  const b = (await createBroadcast(world, seller, { date, ...(rehearsal ? { rehearsal: true } : {}) })).id
  await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 1, name: '구피', price: 1000 }))
  await world.server.ingestChat(seller.sellerId, { b, id: `m-${date}`, ch: 'UC1', nick: '영희', text: '1' })
  return b
}

const dayPath = (date: string, rehearsal = false) => `/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`

describe('AC-S06b-12 보기 캐시 상한', () => {
  it('상한 값: 판매자마다 4, 서버 전체 32, 10분 — 범위마다의 크기(색인 8·메시지 4)와 범위 실행 상태 상한(128)은 그대로', () => {
    expect(VIEW_CACHE_SCOPES_PER_SELLER).toBe(4)
    expect(VIEW_CACHE_SCOPES_MAX).toBe(32)
    expect(VIEW_CACHE_IDLE_MS).toBe(10 * 60 * 1000)
    expect(VIEW_INDEX_CACHE_MAX).toBe(8)
    expect(MESSAGE_LOOKUP_CACHE_MAX).toBe(4)
    expect(DEFAULT_RUNTIME_CACHE_MAX).toBe(128)
  })

  it('한 판매자가 범위 5개를 조회하면 그 판매자의 가장 오래 조회하지 않은 범위의 캐시를 비운다 — 다른 판매자의 캐시는 그대로', async () => {
    const world = await newWorld()
    const busy = await addSeller(world)
    const quiet = await addSeller(world)
    await scope(world, quiet, DATES[0])
    const quietApi = client(world, quiet.cookie)
    const quietBody = (await expectOk(quietApi.get(dayPath(DATES[0])))).body
    await expectOk(quietApi.get(`/api/days/${DATES[0]}/messages`))
    const quietRuntime = await runtimeOf(world, quiet, DATES[0])
    expect(quietRuntime.views.index.builds).toBe(1)
    const busyApi = client(world, busy.cookie)
    for (const date of DATES) await scope(world, busy, date)
    // 앞 넷: 판매자 상한 안 — 모두 캐시를 가진다
    for (const date of DATES.slice(0, 4)) await expectOk(busyApi.get(dayPath(date)))
    expect(world.server.viewCaches.countOf(busy.sellerId)).toBe(4)
    const first = await runtimeOf(world, busy, DATES[0])
    expect(first.views.index.size).toBe(1)
    // 다섯째: 가장 오래 조회하지 않은 첫 범위의 캐시를 비운다
    await expectOk(busyApi.get(dayPath(DATES[4])))
    expect(world.server.viewCaches.countOf(busy.sellerId)).toBe(4)
    expect(world.server.viewCaches.has(busy.sellerId, DATES[0])).toBe(false)
    expect(first.views.index.size).toBe(0)
    expect(first.views.messages.size).toBe(0)
    for (const date of DATES.slice(1)) {
      expect(world.server.viewCaches.has(busy.sellerId, date), date).toBe(true)
      expect((await runtimeOf(world, busy, date)).views.index.size, date).toBe(1)
    }
    // 범위 실행 상태는 그대로 메모리에 있다 (보기 캐시만 비웠다)
    expect(world.server.writer.cachedScopes).toBe(6)
    expect(await runtimeOf(world, busy, DATES[0])).toBe(first)
    // 다른 판매자: 그대로 (한 번만 계산, 캐시 그대로)
    expect(world.server.viewCaches.has(quiet.sellerId, DATES[0])).toBe(true)
    expect(quietRuntime.views.index.size).toBe(1)
    expect(quietRuntime.views.messages.size).toBe(1)
    expect((await expectOk(quietApi.get(dayPath(DATES[0])))).body).toEqual(quietBody)
    expect(quietRuntime.views.index.builds).toBe(1)
    // 한 판매자가 범위를 계속 바꿔 조회해도 그 판매자 몫 4개만 — 다른 판매자는 계속 그대로
    for (let round = 0; round < 3; round++) for (const date of DATES) await expectOk(busyApi.get(dayPath(date)))
    expect(world.server.viewCaches.countOf(busy.sellerId)).toBe(4)
    expect(world.server.viewCaches.size).toBe(5)
    expect(quietRuntime.views.index.builds).toBe(1)
  })

  it('실제·리허설 범위도 따로 센다 — 같은 날짜의 실제·리허설은 두 범위', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    for (const date of DATES.slice(0, 3)) {
      await scope(world, seller, date)
      await scope(world, seller, date, true)
    }
    await expectOk(api.get(dayPath(DATES[0])))
    await expectOk(api.get(dayPath(DATES[0], true)))
    await expectOk(api.get(dayPath(DATES[1])))
    await expectOk(api.get(dayPath(DATES[1], true)))
    expect(world.server.viewCaches.countOf(seller.sellerId)).toBe(4)
    await expectOk(api.get(`/api/days/${DATES[2]}/changes?since=1`))
    expect(world.server.viewCaches.countOf(seller.sellerId)).toBe(4)
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0], false)).toBe(false)
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0], true)).toBe(true)
    expect((await runtimeOf(world, seller, DATES[0])).views.index.size).toBe(0)
    expect((await runtimeOf(world, seller, DATES[0], true)).views.index.size).toBe(1)
  })

  it('판매자 9명 × 범위 4개 → 서버 전체 32개, 넘은 것은 가장 오래 조회하지 않은 범위부터 비운다', async () => {
    const world = await newWorld()
    const sellers: Seller[] = []
    for (let i = 0; i < 9; i++) sellers.push(await addSeller(world))
    for (const seller of sellers) for (const date of DATES.slice(0, 4)) await scope(world, seller, date)
    for (const seller of sellers) for (const date of DATES.slice(0, 4)) await expectOk(client(world, seller.cookie).get(dayPath(date)))
    expect(world.server.viewCaches.size).toBe(32)
    // 가장 먼저 조회한 첫 판매자의 넷이 비워졌다 (36 - 32)
    const [oldest, ...rest] = sellers as [Seller, ...Seller[]]
    expect(world.server.viewCaches.countOf(oldest.sellerId)).toBe(0)
    for (const date of DATES.slice(0, 4)) expect((await runtimeOf(world, oldest, date)).views.index.size, date).toBe(0)
    for (const seller of rest) {
      expect(world.server.viewCaches.countOf(seller.sellerId)).toBe(4)
      for (const date of DATES.slice(0, 4)) expect((await runtimeOf(world, seller, date)).views.index.size).toBe(1)
    }
    // 범위 실행 상태는 모두 그대로 (36 < 128)
    expect(world.server.writer.cachedScopes).toBe(36)
    // 첫 판매자가 다시 조회하면 전체에서 가장 오래 조회하지 않은 범위(둘째 판매자의 첫 범위)를 비운다
    await expectOk(client(world, oldest.cookie).get(dayPath(DATES[0])))
    expect(world.server.viewCaches.size).toBe(32)
    expect(world.server.viewCaches.has(oldest.sellerId, DATES[0])).toBe(true)
    expect(world.server.viewCaches.has((rest[0] as Seller).sellerId, DATES[0])).toBe(false)
  })

  it('마지막 조회 뒤 10분이 지난 범위의 캐시는 다음 정리(조회·쓰기) 때 비운다 — 10분이 안 되면 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const api = client(world, seller.cookie)
    const b = await scope(world, seller, DATES[0])
    await scope(world, seller, DATES[1])
    await scope(world, other, DATES[2])
    await expectOk(api.get(dayPath(DATES[0])))
    world.clock.advance(5 * 60 * 1000)
    await expectOk(api.get(dayPath(DATES[1])))
    world.clock.advance(5 * 60 * 1000 - 1)
    // 첫 범위: 9분 59.999초 — 그대로
    await expectOk(client(world, other.cookie).get(dayPath(DATES[2])))
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(true)
    world.clock.advance(1)
    // 10분: 다른 판매자의 조회 때 정리된다 (그 판매자 몫 상한과 상관없이 시간이 지난 범위)
    await expectOk(client(world, other.cookie).get(dayPath(DATES[2])))
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(false)
    expect((await runtimeOf(world, seller, DATES[0])).views.index.size).toBe(0)
    expect(world.server.viewCaches.has(seller.sellerId, DATES[1])).toBe(true)
    // 쓰기 커밋 뒤에도 정리한다: 둘째 범위의 마지막 조회 뒤 10분 — 조회 없이 쓰기만 있어도 비운다
    world.clock.advance(5 * 60 * 1000)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 2, name: '라울', price: 2000 }))
    expect(world.server.viewCaches.has(seller.sellerId, DATES[1])).toBe(false)
    expect((await runtimeOf(world, seller, DATES[1])).views.index.size).toBe(0)
    // 다른 판매자의 범위는 그 마지막 조회 뒤 5분 — 그대로
    expect(world.server.viewCaches.has(other.sellerId, DATES[2])).toBe(true)
  })

  it('비운 범위를 다시 조회하면 다시 계산하고 응답은 비우기 전과 같다 — 범위·증분·메시지 조회 모두', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const b = await scope(world, seller, DATES[0])
    for (let no = 2; no <= 4; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '구피', price: 1000 * no }))
    await world.server.ingestChat(seller.sellerId, { b, id: 'm2', ch: 'UC2', nick: '철수', text: '2' })
    const full = (await expectOk(api.get(dayPath(DATES[0])))).body
    const changes = (await expectOk(api.get(`/api/days/${DATES[0]}/changes?since=2`))).body
    const messages = (await expectOk(api.get(`/api/days/${DATES[0]}/messages`))).body
    const runtime = await runtimeOf(world, seller, DATES[0])
    const indexBuilds = runtime.views.index.builds
    const messageBuilds = runtime.views.messages.builds
    // 10분이 지나 비운다
    world.clock.advance(VIEW_CACHE_IDLE_MS)
    world.server.viewCaches.sweep()
    expect(runtime.views.index.size).toBe(0)
    expect(runtime.views.messages.size).toBe(0)
    // 다시 조회: 같은 응답, 계산 횟수가 늘었다
    expect((await expectOk(api.get(dayPath(DATES[0])))).body).toEqual(full)
    expect(runtime.views.index.builds).toBe(indexBuilds + 1)
    expect((await expectOk(api.get(`/api/days/${DATES[0]}/changes?since=2`))).body).toEqual(changes)
    expect(runtime.views.index.builds).toBe(indexBuilds + 2) // seq 2의 상태를 다시
    expect((await expectOk(api.get(`/api/days/${DATES[0]}/messages`))).body).toEqual(messages)
    expect(runtime.views.messages.builds).toBe(messageBuilds + 1)
    // 비우지 않은 동안은 다시 계산하지 않는다
    await expectOk(api.get(dayPath(DATES[0])))
    await expectOk(api.get(`/api/days/${DATES[0]}/changes?since=2`))
    expect(runtime.views.index.builds).toBe(indexBuilds + 2)
    // "전체 + 증분 = 새 전체": 비운 뒤 받은 증분을 비우기 전 전체에 덧붙여도 지금 전체와 같다
    await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 5, name: '라울', price: 5000 }))
    world.clock.advance(VIEW_CACHE_IDLE_MS)
    world.server.viewCaches.sweep()
    const delta = (await expectOk(api.get(`/api/days/${DATES[0]}/changes?since=${String(full.seq)}`))).body
    const now = (await expectOk(api.get(dayPath(DATES[0])))).body
    const products = new Map((full.products as { key: string }[]).map((item) => [item.key, item]))
    for (const item of delta.products as { key: string }[]) products.set(item.key, item)
    for (const key of (delta.removed as { products: string[] }).products) products.delete(key)
    expect([...products.values()]).toEqual(now.products)
    expect(delta.seq).toBe(now.seq)
  })

  it('범위 실행 상태가 메모리에서 내려가면(상한·forget) 보기 캐시 항목도 지운다 — 다시 불러온 범위는 새 항목', async () => {
    const world = await newWorld({ runtimeCacheMax: 1 })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await scope(world, seller, DATES[0])
    await expectOk(api.get(dayPath(DATES[0])))
    const old = await runtimeOf(world, seller, DATES[0])
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(true)
    await scope(world, seller, DATES[1])
    // 첫 범위 실행 상태가 내려갔다 — 그 캐시도 비우고 항목을 지운다
    expect(world.server.writer.cachedScopes).toBe(1)
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(false)
    expect(old.views.index.size).toBe(0)
    await expectOk(api.get(dayPath(DATES[0])))
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(true)
    world.server.writer.forget(seller.sellerId, DATES[0])
    expect(world.server.viewCaches.has(seller.sellerId, DATES[0])).toBe(false)
    expect(world.server.viewCaches.size).toBe(0)
  })
})

describe('ViewCacheBudget (주입 시계)', () => {
  const caches = (sellerId: string, date: string, rehearsal = false): ViewScope => {
    const views = newViewCaches()
    // 캐시를 하나씩 채워 둔다 (비우면 0)
    views.index.get({} as never, () => ({}) as never)
    views.messages.get({} as never, () => ({}) as never)
    return { sellerId, date, rehearsal, views }
  }

  it('판매자 상한·전체 상한·10분: 지금 조회하는 범위는 비우지 않는다', () => {
    let now = 0
    const budget = new ViewCacheBudget({ now: () => now, perSeller: 2, max: 3, idleMs: 100 })
    const a1 = caches('a', 'd1')
    const a2 = caches('a', 'd2')
    const a3 = caches('a', 'd3')
    const b1 = caches('b', 'd1')
    const c1 = caches('c', 'd1')
    budget.use(a1)
    budget.use(a2)
    budget.use(b1)
    expect(budget.size).toBe(3)
    // a의 셋째 → a의 가장 오래된 것(a1)만
    budget.use(a3)
    expect(a1.views.index.size).toBe(0)
    expect(a1.views.messages.size).toBe(0)
    expect(budget.has('a', 'd1')).toBe(false)
    expect(budget.countOf('a')).toBe(2)
    expect(b1.views.index.size).toBe(1)
    // c → 전체 4 > 3 → 가장 오래 조회하지 않은 a2
    now = 10
    budget.use(c1)
    expect(budget.size).toBe(3)
    expect(budget.has('a', 'd2')).toBe(false)
    expect(budget.has('b', 'd1')).toBe(true)
    // 다시 조회하면 가장 최근으로 옮긴다: b1을 다시 본 뒤 넘치면 b1이 아니라 a3(가장 오래 조회하지 않음)을 비운다
    budget.use(b1)
    now = 20
    budget.use(a1)
    expect(budget.has('a', 'd3')).toBe(false)
    expect(budget.has('b', 'd1')).toBe(true)
    expect(budget.has('c', 'd1')).toBe(true)
    expect(a1.views.index.size).toBe(0) // 비웠던 캐시는 다음 계산 때 다시 찬다
    // 10분(여기선 100): 마지막 조회 뒤 100이 지난 것만 (c1·b1은 10, a1은 20에 조회)
    now = 109
    budget.sweep()
    expect(budget.has('b', 'd1')).toBe(true)
    now = 110
    budget.sweep()
    expect(budget.has('b', 'd1')).toBe(false)
    expect(budget.has('c', 'd1')).toBe(false)
    expect(b1.views.index.size).toBe(0)
    expect(budget.has('a', 'd1')).toBe(true)
    // 시계가 뒤로 가도 비우지 않는다
    now = 0
    budget.sweep()
    expect(budget.has('a', 'd1')).toBe(true)
  })

  it('같은 범위를 새 실행 상태로 다시 조회하면 앞 실행 상태의 캐시를 비우고 새 것으로 바꾼다. release는 그 실행 상태의 것만 지운다', () => {
    const budget = new ViewCacheBudget({ now: () => 0 })
    const old = caches('a', 'd1')
    const fresh = caches('a', 'd1')
    budget.use(old)
    budget.use(fresh)
    expect(budget.size).toBe(1)
    expect(old.views.index.size).toBe(0)
    expect(fresh.views.index.size).toBe(1)
    budget.release(old)
    expect(budget.has('a', 'd1')).toBe(true)
    budget.release(fresh)
    expect(budget.has('a', 'd1')).toBe(false)
    expect(fresh.views.index.size).toBe(0)
    // 리허설 범위는 다른 범위
    budget.use(caches('a', 'd1', true))
    expect(budget.has('a', 'd1', true)).toBe(true)
    expect(budget.has('a', 'd1')).toBe(false)
  })

  it('상한이 1보다 작으면 만들지 않는다. StateCache.clear는 계산 횟수를 이어 센다', () => {
    expect(() => new ViewCacheBudget({ now: () => 0, perSeller: 0 })).toThrow(RangeError)
    expect(() => new ViewCacheBudget({ now: () => 0, max: 0 })).toThrow(RangeError)
    expect(() => new ViewCacheBudget({ now: () => 0, idleMs: 0 })).toThrow(RangeError)
    expect(() => new ViewCacheBudget({ now: () => 0, perSeller: 1.5 })).toThrow(RangeError)
    const cache = new StateCache<number>(2)
    const state = {} as never
    let made = 0
    cache.get(state, () => ++made)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get(state, () => ++made)).toBe(2)
    expect(cache.builds).toBe(2)
  })
})
