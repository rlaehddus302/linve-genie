// 합치기(N3 + I2): 복구·가져오기(D-I2-11)가 입금 확인 표를 다루는 방식.
// - 입금·원천·기억한 입금자명은 그대로 둔다(입금 번호를 다시 쓰지 않는다). 처리 기록은 하나도 버리지 않는다(범위만 새 범위로).
// - 입금 연결은 파일로 다시 만든 범위에 그 입금의 엔진 기록(요청 번호 dep-<번호>-pay|rev-<차례>)이 있을 때만 남는다.
// - 입금 상태는 다시 만든 엔진 기록에 맞춘다: 반영한 입금 기록이 파일에 없으면 확인 필요로, 파일에 되돌림 없는 입금 기록이 있으면 반영된 상태로
//   (조치자 server의 처리 기록). 두 번 반영(엔진에는 입금이 있는데 확인 필요)·입금 놓침(엔진에는 없는데 확인됨)이 없게 한다.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSettlement } from '@livejjim/core'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, createBackupBytes, restoreSeller } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { addSeller, createBroadcast, expectOk } from './support.ts'
import { DAY, depositApi, depositWorld, deposits, order, pasteText, register, settlementEvents } from './deposit-support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

interface ActionView {
  readonly action: string
  readonly actor: { readonly kind: string }
  readonly date: string | null
  readonly seq: number | null
}

/** 실제 방송에 15번(10,000원)을 UC_A "다육이맘"이 1등 → 묶음 14,000원. 이름이 다른 입금 하나(확인 필요) */
async function setup() {
  const world = await depositWorld()
  const seller = await addSeller(world)
  const b = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, b.id, 15)
  await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
  world.clock.advance(60_000)
  const api = depositApi(world, seller)
  await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '박민수', amount: 14_000 }])))
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-n3-restore-'))
  dirs.push(dir)
  const storage = new FolderBackupStorage(dir)
  const backup = () => createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
  const restore = async (bytes: Uint8Array) => {
    world.clock.advance(60_000)
    const outcome = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage, clock: world.clock, ids: randomIds })
    world.server.writer.forgetSeller(seller.sellerId)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.checks.every((check) => check.ok)).toBe(true)
  }
  const actions = async (): Promise<ActionView[]> => ((await expectOk(api.detail(1))).body.deposit as { actions: ActionView[] }).actions
  const links = async () => ((await expectOk(api.day(DAY))).body as { depositLinks: { seq: number; kind: string; reverted: boolean; deposit: { no: number } }[] }).depositLinks
  const received = async () => getSettlement((await world.server.writer.read(seller.sellerId, DAY)).state, 'UC_A', DAY).received
  return { world, seller, api, backup, restore, actions, links, received }
}

describe('복구와 입금 확인 (N3 + I2 합치기)', () => {
  it('확정하기 전 백업으로 복구하면 엔진의 입금 기록이 없어지므로 입금은 확인 필요로 돌아오고, 확정·되돌림 처리 기록은 남는다', async () => {
    const { world, seller, api, backup, restore, actions, links, received } = await setup()
    const bytes = await backup()
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    expect(await received()).toBe(14_000)
    await restore(bytes)
    expect(await received()).toBe(0)
    expect(await settlementEvents(world, seller)).toEqual([])
    const [item] = await deposits(api)
    expect(item).toMatchObject({ no: 1, status: 'REVIEW', applied: null })
    expect(await links()).toEqual([])
    expect((await actions()).map((action) => [action.action, action.actor.kind])).toEqual([
      ['RECEIVED', 'account'],
      ['CONFIRM', 'account'],
      ['REOPEN', 'server'],
    ])
    // 다시 확정할 수 있다 (같은 입금이 두 번 반영되지 않는다 — 엔진 입금 기록 하나)
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    expect(await received()).toBe(14_000)
    expect((await settlementEvents(world, seller)).filter((event) => event.type === 'settlement.payment')).toHaveLength(1)
  })

  it('확정한 뒤 백업 → 되돌리기 → 복구: 파일의 입금 기록이 되돌림 없이 남으므로 입금은 다시 확인함이고 연결이 그 기록을 가리킨다. 다시 되돌릴 수 있다', async () => {
    const { world, seller, api, backup, restore, actions, links, received } = await setup()
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    const paid = (await settlementEvents(world, seller))[0]
    const bytes = await backup()
    await expectOk(api.revert(1))
    expect((await deposits(api))[0]?.status).toBe('REVIEW')
    await restore(bytes)
    expect(await received()).toBe(14_000)
    const [item] = await deposits(api, 'APPLIED')
    expect(item).toMatchObject({ no: 1, status: 'APPLIED', applied: { date: DAY, buyer: 'UC_A', seq: paid?.seq } })
    expect((await links()).map((link) => [link.kind, link.seq, link.reverted, link.deposit.no])).toEqual([['payment', paid?.seq, false, 1]])
    expect((await actions()).map((action) => [action.action, action.actor.kind])).toEqual([
      ['RECEIVED', 'account'],
      ['CONFIRM', 'account'],
      ['REVERT', 'account'],
      ['CONFIRM', 'server'],
    ])
    // 확인 필요로 남아 두 번 반영되지 않는다 — 확정은 거절, 되돌리기는 된다
    expect((await api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 0 })).status).toBe(409)
    await expectOk(api.revert(1))
    expect(await received()).toBe(0)
  })

  it('지금과 같은 기록으로 복구하면 입금 상태·연결은 그대로이고 처리 기록이 늘지 않는다 (범위만 새 범위)', async () => {
    const { api, backup, restore, actions, links } = await setup()
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000 }))
    const before = { item: (await deposits(api, 'APPLIED'))[0], links: await links(), actions: await actions() }
    await restore(await backup())
    expect((await deposits(api, 'APPLIED'))[0]).toEqual(before.item)
    expect(await links()).toEqual(before.links)
    expect(await actions()).toEqual(before.actions)
  })
})
