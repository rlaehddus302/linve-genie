// AC-S06-72 보기 캐시는 범위별 (RA-S05-001, SYS-02, NFR-01, D-085, D-096).
// - 범위 조회·증분 조회의 보기 계산 캐시는 범위 실행 상태(판매자·날짜·리허설)에 묶이고 범위마다 최근 상태 8개다.
// - 모든 판매자가 함께 쓰는 캐시는 없다: 한 판매자가 여러 상태를 잇달아 조회해도 다른 판매자의 캐시 항목이 밀려나지 않는다.
// - 범위 실행 상태가 메모리에서 내려가면 그 캐시도 함께 사라진다.
// 계산 횟수는 범위 실행 상태의 캐시가 센 값(builds)으로 잰다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { StateCache } from '../src/state-cache.ts'
import { MESSAGE_LOOKUP_CACHE_MAX, VIEW_INDEX_CACHE_MAX } from '../src/views.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-19'

const runtimeOf = (world: TestServer, seller: Seller, date = DAY, rehearsal = false) => world.server.writer.read(seller.sellerId, date, rehearsal)

describe('AC-S06-72 보기 캐시는 범위별', () => {
  it('두 판매자가 번갈아 조회: 한 판매자가 상태를 20번 바꾸며 조회해도 다른 판매자의 보기는 한 번만 계산한다', async () => {
    const world = await newWorld()
    const busy = await addSeller(world)
    const quiet = await addSeller(world)
    const busyB = await createBroadcast(world, busy, { date: DAY })
    const quietB = await createBroadcast(world, quiet, { date: DAY })
    await expectOk(writeEvent(world, quiet, { type: 'product.register', b: quietB.id, no: 1, name: '구피', price: 1000 }))
    const busyApi = client(world, busy.cookie)
    const quietApi = client(world, quiet.cookie)
    const first = await expectOk(quietApi.get(`/api/days/${DAY}`))
    const quietRuntime = await runtimeOf(world, quiet)
    expect(quietRuntime.views.index.builds).toBe(1)
    for (let no = 1; no <= 20; no++) {
      await expectOk(writeEvent(world, busy, { type: 'product.register', b: busyB.id, no, name: '구피', price: 1000 * no }))
      await expectOk(busyApi.get(`/api/days/${DAY}`))
      await expectOk(busyApi.get(`/api/days/${DAY}/changes?since=${String(no)}`))
      expect((await expectOk(quietApi.get(`/api/days/${DAY}`))).body).toEqual(first.body)
    }
    // 바쁜 판매자: 상태마다 한 번씩(21개 상태) 계산했고, 캐시는 최근 8개만 둔다
    const busyRuntime = await runtimeOf(world, busy)
    expect(busyRuntime.views.index.builds).toBe(21)
    expect(busyRuntime.views.index.size).toBe(VIEW_INDEX_CACHE_MAX)
    // 조용한 판매자: 처음 한 번만 — 바쁜 판매자의 조회가 그 항목을 밀어내지 않았다
    expect((await runtimeOf(world, quiet)).views.index.builds).toBe(1)
    // 서로 다른 객체 (함께 쓰는 캐시가 없다)
    expect(busyRuntime.views).not.toBe(quietRuntime.views)
    expect(busyRuntime.views.index).not.toBe(quietRuntime.views.index)
  })

  it('같은 판매자라도 날짜·리허설 범위마다 따로다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const real = await createBroadcast(world, seller, { date: DAY })
    await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await createBroadcast(world, seller, { date: '2026-10-20' })
    await expectOk(api.get(`/api/days/${DAY}?rehearsal=true`))
    await expectOk(api.get('/api/days/2026-10-20'))
    for (let no = 1; no <= 12; no++) {
      await expectOk(writeEvent(world, seller, { type: 'product.register', b: real.id, no, name: '구피', price: 1000 }))
      await expectOk(api.get(`/api/days/${DAY}`))
    }
    await expectOk(api.get(`/api/days/${DAY}?rehearsal=true`))
    await expectOk(api.get('/api/days/2026-10-20'))
    expect((await runtimeOf(world, seller, DAY, true)).views.index.builds).toBe(1)
    expect((await runtimeOf(world, seller, '2026-10-20')).views.index.builds).toBe(1)
    expect((await runtimeOf(world, seller, DAY)).views.index.builds).toBe(12)
  })

  it('증분 조회는 since의 상태와 지금 상태를 그 범위 캐시로 본다 — 같은 since를 다시 물으면 다시 계산하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (let no = 1; no <= 3; no++) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no, name: '구피', price: 1000 }))
    const once = await expectOk(api.get(`/api/days/${DAY}/changes?since=2`))
    const runtime = await runtimeOf(world, seller)
    expect(runtime.views.index.builds).toBe(2) // seq 2의 상태 + 지금(seq 4)
    for (let i = 0; i < 5; i++) expect((await expectOk(api.get(`/api/days/${DAY}/changes?since=2`))).body).toEqual(once.body)
    await expectOk(api.get(`/api/days/${DAY}`))
    expect(runtime.views.index.builds).toBe(2)
    // 메시지 기록도 그 범위 캐시 (메시지 조회·증분 조회): 새 상태에서 한 번 계산하고 같은 상태의 조회는 다시 계산하지 않는다
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '1' })
    const messageBuilds = runtime.views.messages.builds
    await expectOk(api.get(`/api/days/${DAY}/messages`))
    await expectOk(api.get(`/api/days/${DAY}/messages`))
    await expectOk(api.get(`/api/days/${DAY}/changes?since=4`))
    expect(runtime.views.messages.builds).toBe(messageBuilds + 1)
    expect(runtime.views.messages.size).toBeLessThanOrEqual(MESSAGE_LOOKUP_CACHE_MAX)
  })

  it('범위 실행 상태가 메모리에서 내려가면 캐시도 함께 사라진다 — 다시 불러온 상태는 빈 캐시에서 시작하고 결과는 같다', async () => {
    const world = await newWorld({ runtimeCacheMax: 1 })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '구피', price: 1000 }))
    const before = await expectOk(api.get(`/api/days/${DAY}`))
    const old = await runtimeOf(world, seller)
    expect(old.views.index.builds).toBe(1)
    // 다른 범위를 불러와 상한(1)을 넘기면 이 범위의 실행 상태가 내려간다
    await createBroadcast(world, seller, { date: '2026-10-20' })
    await expectOk(api.get('/api/days/2026-10-20'))
    expect(world.server.writer.cachedScopes).toBe(1)
    const after = await expectOk(api.get(`/api/days/${DAY}`))
    expect(after.body).toEqual(before.body)
    const reloaded = await runtimeOf(world, seller)
    expect(reloaded).not.toBe(old)
    expect(reloaded.views).not.toBe(old.views)
    expect(reloaded.views.index.builds).toBe(1)
    // forget도 같다
    world.server.writer.forget(seller.sellerId, DAY)
    const fresh = await runtimeOf(world, seller)
    expect(fresh.views.index.size).toBe(0)
    expect(fresh.views.index.builds).toBe(0)
  })

  it('코드 검사: 보기 모듈에 모듈 단위(모두가 함께 쓰는) 캐시가 없다', () => {
    const source = readFileSync(new URL('../src/views.ts', import.meta.url), 'utf8')
    // 최상위에서 캐시 객체를 만들지 않는다 (newViewCaches 안에서만)
    expect(source).not.toMatch(/^(const|let|var)\s+\w+\s*=\s*new\s+StateCache/m)
    expect(source).not.toMatch(/^(const|let|var)\s+\w+\s*=\s*new\s+(Map|WeakMap)\b/m)
  })

  it('StateCache: 최근에 쓴 것부터 크기만큼, 다시 쓰면 앞으로, 새로 계산한 횟수를 센다', () => {
    const cache = new StateCache<number>(2)
    const states = [{}, {}, {}] as unknown as Parameters<typeof cache.get>[0][]
    let made = 0
    const make = () => ++made
    expect(cache.get(states[0] as never, make)).toBe(1)
    expect(cache.get(states[1] as never, make)).toBe(2)
    expect(cache.get(states[0] as never, make)).toBe(1) // 맞음 — 앞으로
    expect(cache.get(states[2] as never, make)).toBe(3) // states[1]이 밀려남
    expect(cache.size).toBe(2)
    expect(cache.get(states[0] as never, make)).toBe(1)
    expect(cache.get(states[1] as never, make)).toBe(4)
    expect(cache.builds).toBe(4)
    expect(() => new StateCache(0)).toThrow()
  })
})
