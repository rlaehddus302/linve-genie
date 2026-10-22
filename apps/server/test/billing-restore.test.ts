// N5 요금 원장과 I2 복구 (DAT-03·BL-0 4): 판매자 백업 파일로 복구해도 요금 원장(이용권·쓴 기록·이용 방식·결제)은 그대로 남는다.
// 원장은 파일에 없고 덧붙이기만 한다 — 복구가 범위를 새 ID로 다시 만들어도 같은 방송의 이용 방식이 이어져 주문 건을 그대로 센다.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, createBackupBytes, restoreSeller } from '../src/backup.ts'
import { checkReplay } from '../src/check-replay.ts'
import { randomIds } from '../src/ids.ts'
import { billingWorld, grant, query, status } from './billing-support.ts'
import { chat, register } from './print-support.ts'
import { addSeller, createBroadcast } from './support.ts'

const DAY = '2026-10-19'
const dir = mkdtempSync(join(tmpdir(), 'livejjim-billing-restore-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('복구해도 요금 원장은 남는다 (N5 + I2)', () => {
  it('복구 전후로 이용권·쓴 기록·이용 방식이 같고, 재생 검사의 요금 대조가 일치하며, 복구한 방송의 다음 주문 건도 센다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await grant(world, seller, 'ORDERS', 5)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    await register(world, seller, b.id, 2)
    await register(world, seller, b.id, 3)
    await chat(world, seller, b.id, 'UC_1', '하나', '1')
    await chat(world, seller, b.id, 'UC_2', '둘', '2')
    const ledger = async () => ({
      grants: await query(world, `select id, kind, quantity, source from billing_grants order by id`),
      usage: await query(world, `select kind, key, broadcast_id from billing_usage order by key`),
      modes: await query(world, `select broadcast_id, mode, used_day from billing_modes order by broadcast_id`),
    })
    const before = await ledger()
    expect(before.usage).toHaveLength(2)
    expect(before.modes).toEqual([{ broadcast_id: b.id, mode: 'ORDERS', used_day: false }])
    const scopeBefore = (await query<{ id: string }>(world, `select id from scopes where seller_id = '${seller.sellerId}' and not rehearsal`))[0]?.id

    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: new FolderBackupStorage(dir), clock: world.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    if (!restored.ok) return
    world.server.writer.forgetSeller(seller.sellerId)
    const scopeAfter = (await query<{ id: string }>(world, `select id from scopes where seller_id = '${seller.sellerId}' and not rehearsal`))[0]?.id
    expect(scopeAfter).not.toBe(scopeBefore)

    // 원장은 그대로 (지우거나 고치지 않는다)
    expect(await ledger()).toEqual(before)
    // 재생 검사의 요금 대조: 이용 방식은 방송 표의 범위로 찾으므로 새 범위에서도 일치
    expect(restored.checks.map((check) => [check.ok, check.billing])).toEqual([[true, []]])
    // 복구한 방송의 다음 1등도 주문 건으로 센다 (남은 건 5 − 3 = 2)
    await chat(world, seller, b.id, 'UC_3', '셋', '3')
    expect(await query(world, `select key from billing_usage where kind = 'ORDERS' order by key`)).toHaveLength(3)
    const [after] = await checkReplay(world.database.db, { sellerId: seller.sellerId, rehearsal: false })
    expect(after).toMatchObject({ ok: true, billing: [] })
    expect((await status(world, seller)).balances).toMatchObject({ ORDERS: 2 })
  })
})
