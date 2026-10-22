// N5 라벨 장 쓰기 (AC-N5-24, BL-5 3, BL-INV-4): 정량 방식(DAY·ORDERS) 방송의 상품 라벨 작업이 출력함이 될 때 1장(키 = 작업).
import { describe, expect, it } from 'vitest'
import { billingWorld, grant, status, usageKeys } from './billing-support.ts'
import { DEVICE_A, becomeDevice, chat, printApi, register } from './print-support.ts'
import { addSeller, createBroadcast, expectOk } from './support.ts'

const DAY = '2026-10-19'

describe('AC-N5-24 라벨 장 쓰기', () => {
  it('DAY 방식 방송: 자동·다시 출력 작업이 출력함이 될 때마다 1장, 실패 뒤 다시 시도해 출력함이 돼도 1장. 포장 라벨·출력 안 함은 세지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'DAYS', 1)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await register(world, seller, b.id, 1)
    await register(world, seller, b.id, 2)
    await chat(world, seller, b.id, 'UC_1', '하나', '1')
    await chat(world, seller, b.id, 'UC_2', '둘', '2')
    // 첫 장: 실패 → 다시 받아 출력함 → 1장
    const first = await p.claim(DEVICE_A)
    expect(await p.fail(DEVICE_A, first.job?.attempt ?? '', 'PRINT_FAILED')).toBe(true)
    await expectOk(p.state(DEVICE_A, true))
    await expectOk(p.restart())
    const retry = await p.claim(DEVICE_A)
    expect(retry.job?.id).toBe(first.job?.id)
    expect(await p.done(DEVICE_A, retry.job?.attempt ?? '')).toBe(true)
    expect(await usageKeys(world, 'LABELS')).toEqual([`LABELS:${DAY}:${first.job?.id ?? ''}`])
    // 둘째 작업은 출력 안 함 → 세지 않는다
    const overview = await p.overview()
    const waiting = overview.jobs.find((job) => job.status === 'WAITING')
    await expectOk(p.cancel(DAY, waiting?.id ?? ''))
    expect(await usageKeys(world, 'LABELS')).toHaveLength(1)
    // 다시 출력 → 새 작업 → 1장 더 (라벨 장권이 없어도 출력은 그대로 — 초과)
    const claim = overview.jobs.find((job) => job.label.no === 1)?.label.claim ?? first.job?.label.claim ?? ''
    await expectOk(p.reprint(b.id, claim))
    const again = await p.claim(DEVICE_A)
    expect(again.job?.reason).toBe('reprint')
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(true)
    expect(await usageKeys(world, 'LABELS')).toHaveLength(2)
    expect((await status(world, seller)).balances).toMatchObject({ LABELS: -2 })
    expect((await status(world, seller)).banners).toContainEqual({ kind: 'LABELS_OVER', count: 2 })
    // 포장 라벨은 세지 않는다
    await expectOk(p.packing(DAY, 'UC_1'))
    const packing = await p.claim(DEVICE_A)
    expect(packing.job?.kind).toBe('packing')
    expect(await p.done(DEVICE_A, packing.job?.attempt ?? '')).toBe(true)
    expect(await usageKeys(world, 'LABELS')).toHaveLength(2)
    // 라벨 장권은 방송 시작을 막지 않는다 (잔량 −2여도 창이 열려 있으면 시작)
    expect((await status(world, seller)).start).toMatchObject({ allowed: true, mode: 'DAY' })
  })

  it('FLAT 방식 방송의 라벨은 세지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'FLAT_30D')
    await grant(world, seller, 'LABELS', 10)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await register(world, seller, b.id, 1)
    await chat(world, seller, b.id, 'UC_1', '하나', '1')
    const job = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, job.job?.attempt ?? '')).toBe(true)
    expect(await usageKeys(world, 'LABELS')).toEqual([])
    expect((await status(world, seller)).balances).toMatchObject({ LABELS: 10 })
  })

  it('ORDERS 방식 방송: 1등 상품 1건과 그 라벨 1장', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'ORDERS', 3)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await register(world, seller, b.id, 7)
    await chat(world, seller, b.id, 'UC_1', '하나', '7')
    const job = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, job.job?.attempt ?? '')).toBe(true)
    expect(await usageKeys(world, 'ORDERS')).toHaveLength(1)
    expect(await usageKeys(world, 'LABELS')).toHaveLength(1)
  })
})
