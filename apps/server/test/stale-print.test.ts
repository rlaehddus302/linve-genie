// 지난 방송 라벨이 프린터를 다시 이을 때 줄줄이 나오지 않게 (D-STALEPRINT-01, LABEL_RULES L-11 8 보강):
// - 만든 지 12시간이 넘은 대기 작업이 있으면 프린터 다시 연결은 쌓인 라벨 멈춤(판매자 멈춤 + backlog) — 받지 않는다
// - "출력 시작"을 누르면 먼저 들어온 것부터 받는다. 모두 빼면 멈춤이 풀린다
// - 오늘 만든 대기 작업만 있으면 지금처럼 다시 이으면 바로 이어 찍는다
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DAY, DEVICE_A, becomeDevice, chat, printApi, register } from './print-support.ts'
import { addSeller, createBroadcast, expectOk, newWorld, type Seller, type TestServer } from './support.ts'

async function age(world: TestServer, seller: Seller, hours: number): Promise<void> {
  await (world.database.pglite as PGlite).query(`update print_jobs set created_at = created_at - ($2 || ' hours')::interval where seller_id = $1 and status = 'WAITING'`, [seller.sellerId, String(hours)])
}

async function setup() {
  const world = await newWorld()
  const seller = await addSeller(world)
  const b = await createBroadcast(world, seller, { date: DAY })
  const p = printApi(world, seller)
  await becomeDevice(world, seller)
  // 프린터가 끊긴 채 방송 — 라벨이 대기로 남는다
  await expectOk(p.state(DEVICE_A, false))
  await register(world, seller, b.id, 1)
  await register(world, seller, b.id, 2)
  await chat(world, seller, b.id, 'UC_1', '하나', '1')
  await chat(world, seller, b.id, 'UC_2', '둘', '2')
  expect((await p.overview()).queue.waiting).toBe(2)
  return { world, seller, p }
}

describe('D-STALEPRINT-01 지난 라벨은 다시 이어도 저절로 찍지 않는다', () => {
  it('오래 기다린 대기 라벨이 있으면 다시 연결은 쌓인 라벨 멈춤이고, 출력 시작 뒤에 받는다', async () => {
    const { world, seller, p } = await setup()
    await age(world, seller, 13)
    await expectOk(p.state(DEVICE_A, true))
    const paused = await p.overview()
    expect(paused.queue.pause).toMatchObject({ reason: 'SELLER', backlog: true })
    expect(await p.claim(DEVICE_A)).toMatchObject({ job: null, reason: 'PAUSED' })
    await expectOk(p.restart())
    expect((await p.overview()).queue.pause).toBeNull()
    const first = await p.claim(DEVICE_A)
    expect(first.job?.label.no).toBe(1)
  })

  it('모두 빼면 쌓인 라벨 멈춤이 풀린다 (프린터가 이어져 있으면 멈춤 없음)', async () => {
    const { world, seller, p } = await setup()
    await age(world, seller, 13)
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.pause).toMatchObject({ reason: 'SELLER', backlog: true })
    await expectOk(p.cancelAll())
    const after = await p.overview()
    expect(after.queue.waiting).toBe(0)
    expect(after.queue.pause).toBeNull()
  })

  it('하나씩 빼다가 대기가 남아 있으면 멈춤 그대로, 다 빼면 풀린다', async () => {
    const { world, seller, p } = await setup()
    await age(world, seller, 13)
    await expectOk(p.state(DEVICE_A, true))
    const jobs = (await p.overview()).jobs.filter((job) => job.status === 'WAITING')
    expect(jobs).toHaveLength(2)
    await expectOk(p.cancel(DAY, jobs[0]?.id ?? ''))
    expect((await p.overview()).queue.pause).toMatchObject({ reason: 'SELLER', backlog: true })
    await expectOk(p.cancel(DAY, jobs[1]?.id ?? ''))
    expect((await p.overview()).queue.pause).toBeNull()
  })

  it('오늘 만든 대기 라벨만 있으면 다시 이으면 바로 이어 찍는다 (지금 규칙 그대로)', async () => {
    const { world, seller, p } = await setup()
    await age(world, seller, 2)
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.pause).toBeNull()
    expect((await p.claim(DEVICE_A)).job?.label.no).toBe(1)
  })

  it('프린터 오류 멈춤(손으로 푸는 멈춤)은 다시 이어도 그대로다', async () => {
    const { world, seller, p } = await setup()
    await expectOk(p.state(DEVICE_A, true))
    const first = await p.claim(DEVICE_A)
    expect(await p.fail(DEVICE_A, first.job?.attempt ?? '', 'PRINT_FAILED')).toBe(true)
    await age(world, seller, 13)
    await expectOk(p.state(DEVICE_A, false))
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.pause).toMatchObject({ reason: 'PRINTER_ERROR', backlog: false })
  })
})
