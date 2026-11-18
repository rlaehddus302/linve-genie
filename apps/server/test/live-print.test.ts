// 라이브별 라벨 출력 (D-LIVEPRINT-01, LABEL_RULES L-11 4 보강, 사용자 "오랜만에 프린터 연결했더니 옛날 라벨들이 줄줄이 나온다"):
// - 출력 기기는 지금 라이브(끝나지 않았고 만든 지 12시간 안 — D-LIVEPRINT-03)의 자동 라벨과 손으로 넣은 작업만 저절로 받는다
// - 끝난 라이브의 자동 라벨은 대기로 남는다(지우지 않는다). 그 라이브 라벨 탭에서 출력을 누르면(print-waiting) 받는다
import { describe, expect, it } from 'vitest'
import { DAY, DEVICE_A, becomeDevice, chat, printApi, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, type Seller, type TestServer } from './support.ts'

const end = (world: TestServer, seller: Seller, b: string) => client(world, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
const printWaiting = (world: TestServer, seller: Seller, b: string) => client(world, seller.cookie).post('/api/print/labels/print-waiting', { b })

/** 프린터가 끊긴 채 라이브 하나 — 라벨 n장이 대기로 남는다 */
async function offlineLive(world: TestServer, seller: Seller, nos: readonly number[]): Promise<string> {
  const b = await createBroadcast(world, seller, { date: DAY })
  for (const no of nos) {
    await register(world, seller, b.id, no)
    await chat(world, seller, b.id, `UC_${String(no)}`, `손님${String(no)}`, String(no))
  }
  return b.id
}

describe('D-LIVEPRINT-01 끝난 라이브 라벨은 저절로 나오지 않는다', () => {
  it('끝난 라이브의 대기 라벨은 건너뛰고 지금 라이브 라벨만 받는다. 그 라이브에서 출력을 누르면 받는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.state(DEVICE_A, false))
    const old = await offlineLive(world, seller, [1, 2])
    expect((await expectOk(end(world, seller, old))).status).toBe(200)
    const now = await offlineLive(world, seller, [7])
    // 전체 대기 수는 저절로 나갈 라벨만 — 끝난 라이브 라벨은 그 라이브 라벨 탭에서만 대기로 보인다 (D-LIVEPRINT-02. 옛 기대: 3)
    expect((await p.overview()).queue.waiting).toBe(1)
    expect((await p.labels()).labels.filter((label) => label['broadcast'] === old && label['state'] === 'WAITING')).toHaveLength(2)

    // 프린터를 다시 이으면 지금 라이브 라벨(7번)만 나온다
    await expectOk(p.state(DEVICE_A, true))
    const first = await p.claim(DEVICE_A)
    expect(first.job?.label.no).toBe(7)
    expect(await p.done(DEVICE_A, first.job?.attempt ?? '')).toBe(true)
    expect(await p.claim(DEVICE_A)).toMatchObject({ job: null, reason: 'EMPTY' })
    // 끝난 라이브 라벨은 지워지지 않고 그 라이브에 대기로 남아 있다 — 전체 대기 수에는 세지 않는다 (D-LIVEPRINT-02)
    expect((await p.overview()).queue.waiting).toBe(0)
    expect((await p.labels()).labels.filter((label) => label['broadcast'] === old && label['state'] === 'WAITING')).toHaveLength(2)

    // 끝난 라이브 라벨 탭에서 출력 → 먼저 들어온 것부터 받는다
    const released = await expectOk(printWaiting(world, seller, old))
    expect(released.body).toEqual({ released: 2 })
    expect((await p.overview()).queue.waiting).toBe(2)
    const a = await p.claim(DEVICE_A)
    expect(a.job?.label.no).toBe(1)
    expect(a.job?.reason).toBe('manual')
    expect(await p.done(DEVICE_A, a.job?.attempt ?? '')).toBe(true)
    expect((await p.claim(DEVICE_A)).job?.label.no).toBe(2)
    // 다시 눌러도 바뀔 것이 없다
    expect((await expectOk(printWaiting(world, seller, old))).body).toEqual({ released: 0 })
    expect((await expectOk(printWaiting(world, seller, now))).body).toEqual({ released: 0 })
  })

  it('끝내지 않은 라이브여도 이틀 전 라이브의 자동 라벨은 저절로 나오지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.state(DEVICE_A, false))
    const b = await offlineLive(world, seller, [3])
    world.clock.advance(2 * 24 * 60 * 60 * 1000)
    await expectOk(p.state(DEVICE_A, true))
    expect(await p.claim(DEVICE_A)).toMatchObject({ job: null, reason: 'EMPTY' })
    expect((await expectOk(printWaiting(world, seller, b))).body).toEqual({ released: 1 })
    expect((await p.claim(DEVICE_A)).job?.label.no).toBe(3)
  })

  it('끝내지 않은 라이브도 만든 지 12시간이 넘은 자동 라벨은 저절로 나오지 않는다 — 어제 라이브를 끝내지 않은 채 다음 날 프린터를 이은 경우 (D-LIVEPRINT-03. 옛 기대: 어제 날짜면 이어 찍음)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.state(DEVICE_A, false))
    const b = await offlineLive(world, seller, [4, 5])
    world.clock.advance(13 * 60 * 60 * 1000)
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.waiting).toBe(0)
    expect(await p.claim(DEVICE_A)).toMatchObject({ job: null, reason: 'EMPTY' })
    expect((await expectOk(printWaiting(world, seller, b))).body).toEqual({ released: 2 })
    expect((await p.claim(DEVICE_A)).job?.label.no).toBe(4)
  })

  it('라이브 중 끊겼다 몇 시간 뒤 다시 이으면(12시간 안) 그대로 이어 찍는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.state(DEVICE_A, false))
    await offlineLive(world, seller, [6])
    world.clock.advance(11 * 60 * 60 * 1000)
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.waiting).toBe(1)
    expect((await p.claim(DEVICE_A)).job?.label.no).toBe(6)
  })

  it('다른 판매자의 라이브·없는 라이브는 받지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    expect((await printWaiting(world, other, b.id)).status).toBe(404)
    expect((await printWaiting(world, seller, 'nope')).status).toBe(404)
    expect((await client(world, seller.cookie).post('/api/print/labels/print-waiting', { b: b.id, extra: 1 })).status).toBe(400)
  })
})
