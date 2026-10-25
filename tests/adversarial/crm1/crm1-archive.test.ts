// CRM1 적대 시험 (test-domain) — AC-CRM1-33 봉인 뒤에도 노쇼 기록이 남는다 (D-CRM1-12, SA-CRM1-02).
// 모형 대조(crm1-model.test.ts)가 무작위로 섞는 것을 손으로 고정한 사례들:
// - "그 날짜의 마지막 보관 행": 차례 뒤 '입금 안 함' 취소 → 다음 차례가 바꿔 적으면 봉인 뒤에도 든다
// - 차례 뒤에 바뀌고 차례 없이 봉인된 날짜는 마지막 보관 행 그대로(받아들인 한계 — 지어내지 않는다), 차례가 한 번도 돌지 않은 날짜는 장부만
// - 같은 날 '입금 안 함'으로 1등을 잃은 손님을 입금 완료 손님에 합친 뒤 봉인 — 두 표지 줄이 봉인 전과 같다
// - 봉인 뒤 봉인 전 백업으로 복구하고 다시 봉인해도 숫자가 같다(보관 행은 복구가 지우지도 바꾸지도 않는다)
// - D-CRM1-15 한계: 봉인 날짜에서만 쓴 옛 닉네임으로는 "모든 손님" 찾기에 나오지 않고, 지금 이름으로는 나온다
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, createBackupBytes, restoreSeller } from '../../../apps/server/src/backup.ts'
import { randomIds } from '../../../apps/server/src/ids.ts'
import { at, chat, crm, crmWorld, kst, ok, payAll, type Row } from '../../../apps/server/test/crm1-support.ts'
import { createBroadcast, expectOk, login, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const relogin = async (world: TestServer, seller: Seller): Promise<Seller> => ({ ...seller, cookie: await login(world, seller.loginId, seller.password) })
const pick = (rows: Row[], buyer: string) => rows.find((row) => row.latestBuyer === buyer)
const numbers = (row: Row | undefined) =>
  row === undefined ? null : { purchaseDays: row.purchaseDays, purchaseTotal: row.purchaseTotal, unpaidDays: row.unpaidDays, lastUnpaid: row.lastUnpaid, cancels: row.cancels, caution: row.caution }

/** 그 날짜에 방송을 열고 상품 셋: 1번 UC_A(입금), 2번 UC_N, 3번 UC_B — 판 대로 둔다 */
async function sell(world: TestServer, seller: Seller, date: string, tag: string): Promise<string> {
  at(world, date, '20:00:00')
  const b = (await createBroadcast(world, seller, { date, title: `${date} 방송` })).id
  for (const [no, channel, nick, price] of [
    [1, 'UC_A', '단골손님', 20_000],
    [2, 'UC_N', '노쇼손님', 9000],
    [3, 'UC_B', '늦은손님', 7000],
  ] as const) {
    await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price })
    await chat(world, seller, b, `${tag}-${String(no)}`, channel, nick, String(no))
  }
  await payAll(world, seller, date, 'UC_A')
  return b
}

describe('AC-CRM1-33 봉인 날짜 = 장부 + 그 날짜의 마지막 보관 행 (적대, D-CRM1-12)', () => {
  it('차례 뒤 취소 → 다음 차례가 바꿔 적은 날짜는 든다 / 차례 뒤 취소하고 차례 없이 봉인한 날짜는 마지막 행 그대로 / 차례가 돌지 않은 날짜는 장부만', async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-10', '09:00:00'))
    const archiver = world.server.customerArchiver
    // A 09-10: 차례 → 그 뒤 UC_N 1등 '입금 안 함' 취소 → 다음 차례가 바꿔 적는다
    const a = await sell(world, first, '2026-09-10', 'a')
    at(world, '2026-09-11', '12:00:00')
    expect(await archiver.runOnce()).toEqual({ written: 1, frozen: 0, failed: 0 })
    await ok(world, first, { type: 'host.cancel', b: a, no: 2, buyer: 'UC_N', reason: '입금 안 함' })
    at(world, '2026-09-11', '13:00:00')
    expect(await archiver.runOnce()).toEqual({ written: 1, frozen: 0, failed: 0 })
    // B 09-12: UC_N 1등 '연락 없음' 취소 후 차례 → 그 뒤 UC_B 1등 '입금 안 함' 취소, 다시 차례 없음
    const b = await sell(world, first, '2026-09-12', 'b')
    await ok(world, first, { type: 'host.cancel', b, no: 2, buyer: 'UC_N', reason: '연락 없음' })
    at(world, '2026-09-13', '12:00:00')
    expect(await archiver.runOnce()).toEqual({ written: 1, frozen: 0, failed: 0 })
    await ok(world, first, { type: 'host.cancel', b, no: 3, buyer: 'UC_B', reason: '입금 안 함' })
    // C 09-14: UC_N 1등 '입금 안 함' 취소 — 차례가 한 번도 돌지 않는다
    const cDay = await sell(world, first, '2026-09-14', 'c')
    await ok(world, first, { type: 'host.cancel', b: cDay, no: 2, buyer: 'UC_N', reason: '입금 안 함' })

    at(world, '2026-09-20', '12:00:00')
    const c0 = crm(world, first)
    const before = await c0.rows()
    // 봉인 전(처음부터 센 값)
    expect(numbers(pick(before, 'UC_N'))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 2, lastUnpaid: '2026-09-14', cancels: 3, caution: true })
    // UC_B: A·C는 미입금 품목(기다리는 날 3일 지남), B는 '입금 안 함' 취소 → 3날짜
    expect(numbers(pick(before, 'UC_B'))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 3, lastUnpaid: '2026-09-14', cancels: 1, caution: true })
    expect(numbers(pick(before, 'UC_A'))).toEqual({ purchaseDays: 3, purchaseTotal: 60_000, unpaidDays: 0, lastUnpaid: null, cancels: 0, caution: false })

    // 세 날짜 모두 30일 봉인 (차례 없이)
    at(world, '2026-10-20', '12:00:00')
    const seller = await relogin(world, first)
    expect(await world.server.sealer.runOnce()).toBe(3)
    const c = crm(world, seller)
    const after = await c.rows()
    // UC_N: A(마지막 행 — '입금 안 함' 듦) + B(취소 1) + C(보관 행 없음 — 장부에 UC_N 없음)
    expect(numbers(pick(after, 'UC_N'))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 1, lastUnpaid: '2026-09-10', cancels: 2, caution: true })
    const n = pick(after, 'UC_N') as Row
    expect(n.latestDate).toBe('2026-09-12')
    const days = (await expectOk(c.customer(n.id))).body.days as { date: string; subtotal: number; unpaid: boolean; openable: boolean }[]
    expect(days.map((line) => [line.date, line.subtotal, line.unpaid, line.openable])).toEqual([
      ['2026-09-12', 0, false, false],
      ['2026-09-10', 0, true, false],
    ])
    // UC_B: 장부의 미입금 품목(A·C) 2날짜는 장부로, B의 '입금 안 함'은 차례 뒤 변경이라 빠진다(한계) — 숫자를 지어내지 않는다
    expect(numbers(pick(after, 'UC_B'))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 2, lastUnpaid: '2026-09-14', cancels: 0, caution: true })
    // UC_A: 장부 그대로
    expect(numbers(pick(after, 'UC_A'))).toEqual({ purchaseDays: 3, purchaseTotal: 60_000, unpaidDays: 0, lastUnpaid: null, cancels: 0, caution: false })
    // 봉인 날짜 구매자 목록엔 장부의 구매자만
    for (const date of ['2026-09-10', '2026-09-12', '2026-09-14']) {
      const list = (await expectOk(c.dayList(date))).body.customers as { buyer: string }[]
      expect(list.map((item) => item.buyer).sort(), date).toEqual(date === '2026-09-12' ? ['UC_A'] : ['UC_A', 'UC_B'])
      expect((await c.day(date, 'UC_N')).status, date).toBe(404)
    }
    // 봉인 뒤 차례: 굳히기만, 쓰지 않는다
    expect(await world.server.customerArchiver.runOnce()).toEqual({ written: 0, frozen: 2, failed: 0 })
  })

  it("같은 날 '입금 안 함'으로 1등을 잃은 UC_N을 입금 완료 UC_M에 합친 뒤 봉인 — UC_N·UC_M 줄이 봉인 전과 같다", async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-10', '09:00:00'))
    at(world, '2026-09-10', '20:00:00')
    const b = (await createBroadcast(world, first, { date: '2026-09-10' })).id
    await ok(world, first, { type: 'product.register', b, no: 1, name: '백모단', price: 9000 })
    await chat(world, first, b, 'n1', 'UC_N', '부계정', '1')
    await ok(world, first, { type: 'host.cancel', b, no: 1, buyer: 'UC_N', reason: '입금 안 함' })
    await ok(world, first, { type: 'product.register', b, no: 2, name: '라울', price: 12_000 })
    await chat(world, first, b, 'm1', 'UC_M', '본계정', '2')
    await ok(world, first, { type: 'buyer.merge', from: 'UC_N', into: 'UC_M', reason: '같은 사람' }, '2026-09-10')
    await payAll(world, first, '2026-09-10', 'UC_M')
    // 다른 날 UC_N이 따로 산다 (UC_N 표지 줄이 따로 있다)
    at(world, '2026-09-15', '20:00:00')
    const b2 = (await createBroadcast(world, first, { date: '2026-09-15' })).id
    await ok(world, first, { type: 'product.register', b: b2, no: 1, name: '정야', price: 5000 })
    await chat(world, first, b2, 'n2', 'UC_N', '부계정', '1')
    await payAll(world, first, '2026-09-15', 'UC_N')
    at(world, '2026-09-16', '12:00:00')
    expect((await world.server.customerArchiver.runOnce()).written).toBe(2)
    const before = await crm(world, first).rows()
    expect(numbers(pick(before, 'UC_N'))).toEqual({ purchaseDays: 2, purchaseTotal: 17_000, unpaidDays: 1, lastUnpaid: '2026-09-10', cancels: 1, caution: true })
    expect(numbers(pick(before, 'UC_M'))).toEqual({ purchaseDays: 1, purchaseTotal: 12_000, unpaidDays: 1, lastUnpaid: '2026-09-10', cancels: 1, caution: true })
    at(world, '2026-10-12', '12:00:00')
    const seller = await relogin(world, first)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const c = crm(world, seller)
    const after = await c.rows()
    expect(after.map((row) => [row.latestBuyer, numbers(row)])).toEqual(before.map((row) => [row.latestBuyer, numbers(row)]))
    // 봉인 날짜의 UC_M 자세히(장부) — 합쳐진 UC_N 구성원의 '입금 안 함'이 든다
    expect(await c.summary('2026-09-10', 'UC_M')).toMatchObject({ unpaidDays: 1, cancels: 1, caution: true })
  })

  it('봉인 뒤 봉인 전 백업으로 복구하고 다시 봉인해도 숫자가 같다 — 보관 행은 복구가 지우지도 바꾸지도 않는다 (AC-CRM1-33 (4))', async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-10', '09:00:00'))
    const a = await sell(world, first, '2026-09-10', 'r')
    await ok(world, first, { type: 'host.cancel', b: a, no: 2, buyer: 'UC_N', reason: '입금 안 함' })
    at(world, '2026-09-11', '12:00:00')
    expect((await world.server.customerArchiver.runOnce()).written).toBe(1)
    const backup = await createBackupBytes(world.database.db, first.sellerId, world.clock.now())
    // (5) 백업 파일엔 보관 표가 없다
    for (const word of ['customer_archive', 'no_pay', 'noPay']) expect(gunzipSync(backup).toString('utf8'), word).not.toContain(word)
    // 봉인 바로 전 (기다리는 날이 지난 뒤)
    at(world, '2026-10-08', '12:00:00')
    let seller = await relogin(world, first)
    const before = (await crm(world, seller).rows()).map((row) => [row.latestBuyer, numbers(row)])
    at(world, '2026-10-12', '12:00:00')
    seller = await relogin(world, seller)
    expect(await world.server.sealer.runOnce()).toBe(1)
    expect(await world.server.customerArchiver.runOnce()).toMatchObject({ frozen: 1 })
    const stored = JSON.stringify((await world.database.pglite?.query('select date, root, members, cancels, no_pay from customer_archive_rows order by id'))?.rows)
    const sealedRows = (await crm(world, seller).rows()).map((row) => [row.latestBuyer, numbers(row)])
    expect(sealedRows).toEqual(before)

    const dir = mkdtempSync(join(tmpdir(), 'livejjim-crm1-archive-'))
    dirs.push(dir)
    world.clock.advance(60_000)
    const outcome = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes: backup, replace: true, storage: new FolderBackupStorage(dir), clock: world.clock, ids: randomIds })
    world.server.writer.forgetSeller(seller.sellerId)
    expect(outcome.ok).toBe(true)
    seller = await relogin(world, seller)
    // 복구로 봉인 전 범위가 돌아왔다 (그래도 보관 날짜 줄은 굳은 채)
    expect((await world.database.pglite?.query<{ sealed_at: unknown }>('select sealed_at from scopes'))?.rows).toEqual([{ sealed_at: null }])
    expect((await world.database.pglite?.query<{ frozen: boolean }>('select frozen from customer_archive_days'))?.rows).toEqual([{ frozen: true }])
    // 복구 뒤 차례는 굳은 날짜를 다시 쓰지 않고, 다시 봉인한다
    expect(await world.server.customerArchiver.runOnce()).toEqual({ written: 0, frozen: 0, failed: 0 })
    expect(await world.server.sealer.runOnce()).toBe(1)
    expect(await world.server.customerArchiver.runOnce()).toEqual({ written: 0, frozen: 0, failed: 0 })
    expect(JSON.stringify((await world.database.pglite?.query('select date, root, members, cancels, no_pay from customer_archive_rows order by id'))?.rows)).toBe(stored)
    expect((await crm(world, seller).rows()).map((row) => [row.latestBuyer, numbers(row)])).toEqual(before)
  })
})

describe('D-CRM1-15 한계: 봉인 날짜에서만 쓴 옛 닉네임 (TD-CRM1-003)', () => {
  it('봉인 전엔 옛 닉네임으로 찾히고, 봉인 뒤엔 지금 이름으로만 찾힌다', async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-10', '09:00:00'))
    at(world, '2026-09-10', '20:00:00')
    const b = (await createBroadcast(world, first, { date: '2026-09-10' })).id
    await ok(world, first, { type: 'product.register', b, no: 1, name: '백모단', price: 9000 })
    await chat(world, first, b, 'o1', 'UC_A', '옛이름다육', '1')
    await ok(world, first, { type: 'product.register', b, no: 2, name: '라울', price: 9000 })
    await chat(world, first, b, 'o2', 'UC_A', '새이름다육', '2')
    await payAll(world, first, '2026-09-10', 'UC_A')
    at(world, '2026-09-20', '12:00:00')
    const c0 = crm(world, first)
    expect((await c0.rows(`q=${encodeURIComponent('옛이름')}`)).map((row) => row.latestBuyer)).toEqual(['UC_A'])
    at(world, '2026-10-12', '12:00:00')
    const seller = await relogin(world, first)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const c = crm(world, seller)
    expect(await c.rows(`q=${encodeURIComponent('옛이름')}`)).toEqual([])
    const found = await c.rows(`q=${encodeURIComponent('새이름')}`)
    expect(found.map((row) => [row.latestBuyer, row.name, row.purchaseTotal])).toEqual([['UC_A', '새이름다육', 18_000]])
  })
})
