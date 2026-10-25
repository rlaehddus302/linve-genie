// AC-CRM1-33 봉인 뒤에도 노쇼 기록이 남는다 (D-CRM1-12, TD-CRM1-002): 손님 기록 보관 표·1시간 차례·봉인 날짜 = 장부 + 보관 행.
// PGlite·주입한 시계, 서버 쓰기 경로·봉인 작업(Sealer) 그대로. 유튜브 봉인·장부 형식은 고치지 않는다.
import { describe, expect, it } from 'vitest'
import { CUSTOMER_ARCHIVE_EVERY_MS } from '../src/customers/archive.ts'
import { mergeArchive, readArchiveMembers, type DayFacts } from '../src/customers/facts.ts'
import { RESTORE_KEPT_TABLES } from '../src/backup.ts'
import { customerArchiveDays, customerArchiveRows } from '../src/db/schema.ts'
import { at, buy, chat, countOf, crm, crmWorld, kst, ok, payAll, type Row } from './crm1-support.ts'
import { addSeller, client, createBroadcast, expectOk, login, type Seller, type TestServer } from './support.ts'

const D = '2026-09-11'

/** 09-11: UC_N 1등 → '입금 안 함' 취소, 그 상품은 UC_Q가 다시 산다. UC_M 입금 완료 12,000 + 1등 하나 '연락 없음' 취소 */
async function sellDay(world: TestServer, seller: Seller): Promise<void> {
  at(world, D, '20:00:00')
  const b = (await createBroadcast(world, seller, { date: D, title: '9월 11일 방송' })).id
  await ok(world, seller, { type: 'product.register', b, no: 1, name: '백모단', price: 9000 })
  await chat(world, seller, b, 'n1', 'UC_N', '노쇼손님', '1')
  await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_N', reason: '입금 안 함' })
  await chat(world, seller, b, 'q1', 'UC_Q', '다시산손님', '1')
  await ok(world, seller, { type: 'product.register', b, no: 2, name: '라울', price: 12_000 })
  await chat(world, seller, b, 'm1', 'UC_M', '연락없음손님', '2')
  await ok(world, seller, { type: 'product.register', b, no: 3, name: '정야', price: 5000 })
  await chat(world, seller, b, 'm2', 'UC_M', '연락없음손님', '3')
  await ok(world, seller, { type: 'host.cancel', b, no: 3, buyer: 'UC_M', reason: '연락 없음' })
  await payAll(world, seller, D, 'UC_M')
  await payAll(world, seller, D, 'UC_Q')
}

const byName = (rows: Row[], name: string) => rows.find((row) => row.name === name)

async function archiveTable(world: TestServer): Promise<unknown[]> {
  const rows = await world.database.pglite?.query(`select seller_id, date, root, members, cancels, no_pay from customer_archive_rows order by id`)
  return rows?.rows ?? []
}

async function relogin(world: TestServer, seller: Seller): Promise<Seller> {
  return { ...seller, cookie: await login(world, seller.loginId, seller.password) }
}

describe('AC-CRM1-33 봉인 뒤에도 노쇼 기록이 남는다', () => {
  it("09-12 차례가 보관 행을 적고, 30일 봉인 뒤에도 UC_N 미입금 1번·취소 1번·주의, UC_M 구매 1번·12,000원·취소 1번 — 봉인 전과 같다", async () => {
    const { world, seller: first } = await crmWorld(kst(D, '09:00:00'))
    await sellDay(world, first)
    const archiver = world.server.customerArchiver
    // 방송 날짜 당일은 적지 않는다 (오늘보다 앞선 날짜만)
    at(world, D, '23:00:00')
    expect((await archiver.runOnce()).written).toBe(0)
    at(world, '2026-09-12', '12:00:00')
    expect(await archiver.runOnce()).toEqual({ written: 1, frozen: 0, failed: 0 })
    // seq가 그대로면 다음 차례는 다시 적지 않는다
    at(world, '2026-09-12', '13:00:00')
    expect((await archiver.runOnce()).written).toBe(0)
    const stored = await archiveTable(world)
    expect(stored).toHaveLength(3)
    const c0 = crm(world, first)
    const before = await c0.rows()
    expect(byName(before, '노쇼손님')).toMatchObject({ unpaidDays: 1, lastUnpaid: D, cancels: 1, caution: true, purchaseDays: 0 })
    expect(byName(before, '연락없음손님')).toMatchObject({ purchaseDays: 1, purchaseTotal: 12_000, cancels: 1, unpaidDays: 0, caution: false })

    // 30일 봉인 (10-11 0시 KST) 뒤
    at(world, '2026-10-26', '12:00:00')
    const seller = await relogin(world, first)
    const c = crm(world, seller)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const after = await c.rows()
    expect(after.map((row) => [row.name, row.purchaseDays, row.purchaseTotal, row.unpaidDays, row.lastUnpaid, row.cancels, row.caution])).toEqual(
      before.map((row) => [row.name, row.purchaseDays, row.purchaseTotal, row.unpaidDays, row.lastUnpaid, row.cancels, row.caution]),
    )
    const n = byName(after, '노쇼손님') as Row
    expect(n).toMatchObject({ unpaidDays: 1, lastUnpaid: D, cancels: 1, caution: true })
    expect(byName(after, '연락없음손님')).toMatchObject({ purchaseDays: 1, purchaseTotal: 12_000, cancels: 1, unpaidDays: 0 })

    // 손님 자세히의 09-11 줄: 미입금으로 셈, 누르는 것이 아니다. 그날 자세히는 404 그대로
    const detail = await expectOk(c.customer(n.id))
    expect(detail.body.days).toEqual([{ date: D, buyer: 'UC_N', name: '노쇼손님', subtotal: 0, payment: 'UNPAID', unpaid: true, openable: false }])
    expect((await c.day(D, 'UC_N')).status).toBe(404)
    // 장부에 있는 손님의 줄은 그대로 누를 수 있다
    const m = byName(after, '연락없음손님') as Row
    expect(((await expectOk(c.customer(m.id))).body.days as { openable: boolean }[]).map((line) => line.openable)).toEqual([true])
    // 봉인 날짜의 구매자 목록에 장부에 없는 구매자를 지어 넣지 않는다
    const sealedList = (await expectOk(c.dayList(D))).body.customers as { buyer: string }[]
    expect(sealedList.map((item) => item.buyer)).not.toContain('UC_N')

    // 다른 실제 날짜 구매자 목록·콘솔 1등 옆 꼬리표 재료
    await buy(world, seller, '2026-10-26', 'UC_N', '노쇼손님', 3000)
    const today = (await expectOk(c.dayList('2026-10-26'))).body.customers as { buyer: string; caution: boolean; unpaidDays: number; cancels: number }[]
    expect(today.find((item) => item.buyer === 'UC_N')).toMatchObject({ caution: true, unpaidDays: 1, cancels: 1 })
    expect(await c.summary('2026-10-26', 'UC_N')).toMatchObject({ unpaidDays: 1, lastUnpaid: D, cancels: 1, caution: true })

    // (4) 봉인한 날짜의 보관 행은 그 뒤 차례로 바뀌지 않는다 (굳힘)
    expect(await world.server.customerArchiver.runOnce()).toMatchObject({ frozen: 1 })
    at(world, '2026-10-26', '15:00:00')
    await world.server.customerArchiver.runOnce()
    expect(await archiveTable(world)).toEqual(stored)
    const header = await world.database.pglite?.query<{ frozen: boolean }>(`select frozen from customer_archive_days where date = '${D}'`)
    expect(header?.rows).toEqual([{ frozen: true }])

    // (5) 서버 로그에 표지·이름이 없다
    const logs = JSON.stringify(world.logs)
    for (const secret of ['UC_N', '노쇼손님', 'c:UC_N', 'customer_archive']) expect(logs).not.toContain(secret)
  })

  it('(3) 차례가 한 번도 돌지 않은 봉인 날짜는 장부만으로 센다 — 취소 0·(나) 없음, 숫자를 지어내지 않는다', async () => {
    const { world, seller: first } = await crmWorld(kst(D, '09:00:00'))
    await sellDay(world, first)
    at(world, '2026-10-26', '12:00:00')
    const seller = await relogin(world, first)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const c = crm(world, seller)
    const rows = await c.rows()
    // UC_N은 장부에 없고 보관 행도 없어 줄이 없다
    expect(byName(rows, '노쇼손님')).toBeUndefined()
    expect(byName(rows, '연락없음손님')).toMatchObject({ purchaseDays: 1, purchaseTotal: 12_000, cancels: 0, unpaidDays: 0 })
    // 봉인 뒤 차례는 봉인 날짜를 적지 않는다
    expect((await world.server.customerArchiver.runOnce()).written).toBe(0)
    expect(await countOf(world, 'customer_archive_rows')).toBe(0)
  })

  it('봉인 전 마지막 변경은 다음 차례가 통째로 바꿔 적는다 (seq가 바뀐 날짜만), 다른 판매자 행과 섞이지 않는다', async () => {
    const { world, seller } = await crmWorld(kst(D, '09:00:00'))
    const other = await addSeller(world)
    await sellDay(world, seller)
    at(world, '2026-09-12', '12:00:00')
    expect((await world.server.customerArchiver.runOnce()).written).toBe(1)
    // 다음 날 UC_M의 남은 1등도 '입금 안 함'으로 바꾸는 대신 다른 판매자가 같은 날짜에 팔기만 한다
    at(world, D, '21:00:00')
    const ob = (await createBroadcast(world, other, { date: D, title: '다른 가게' })).id
    await ok(world, other, { type: 'product.register', b: ob, no: 1, name: '다른', price: 7000 })
    await chat(world, other, ob, 'o1', 'UC_N', '같은채널', '1')
    await ok(world, other, { type: 'host.cancel', b: ob, no: 1, buyer: 'UC_N', reason: '연락 없음' })
    at(world, '2026-09-12', '13:00:00')
    // 판매자 하나의 seq만 바뀌었다 — 그 판매자 날짜 하나만 적는다
    expect((await world.server.customerArchiver.runOnce()).written).toBe(1)
    const own = await world.database.pglite?.query<{ seller_id: string; root: string; cancels: number; no_pay: number }>(
      `select seller_id, root, cancels, no_pay from customer_archive_rows order by seller_id, root`,
    )
    expect(own?.rows.filter((row) => row.seller_id === other.sellerId)).toEqual([{ seller_id: other.sellerId, root: 'UC_N', cancels: 1, no_pay: 0 }])
    expect(own?.rows.filter((row) => row.seller_id === seller.sellerId).map((row) => [row.root, row.cancels, row.no_pay])).toEqual([
      ['UC_M', 1, 0],
      ['UC_N', 1, 1],
      ['UC_Q', 0, 0],
    ])
    // 다른 판매자의 '연락 없음' 취소가 이 판매자의 UC_N에 섞이지 않는다
    const rows = await crm(world, seller).rows()
    expect(byName(rows, '노쇼손님')).toMatchObject({ cancels: 1, unpaidDays: 1 })
    const otherRows = await crm(world, other).rows()
    expect(otherRows.map((row) => [row.name, row.cancels, row.unpaidDays])).toEqual([['같은채널', 1, 0]])
  })

  it('서버 시작 때 한 번, 그 뒤 1시간마다 돈다 (시작·멈춤)', async () => {
    const { world, seller } = await crmWorld(kst(D, '09:00:00'))
    await sellDay(world, seller)
    at(world, '2026-09-12', '12:00:00')
    expect(CUSTOMER_ARCHIVE_EVERY_MS).toBe(60 * 60 * 1000)
    world.server.customerArchiver.start()
    for (let i = 0; i < 50 && (await countOf(world, 'customer_archive_days')) === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await countOf(world, 'customer_archive_days')).toBe(1)
    await world.server.customerArchiver.stop()
  })

  it('보관 표는 복구가 그대로 두는 표(백업 파일에 없음)이고, 범위를 참조하지 않는다', () => {
    expect(RESTORE_KEPT_TABLES).toContain(customerArchiveDays)
    expect(RESTORE_KEPT_TABLES).toContain(customerArchiveRows)
  })

  it('보관 행 셈: 장부 묶음엔 취소·(나)만 더하고, 장부에 없는 뿌리는 품목 0 묶음(archived), 읽을 수 없는 구성원 글은 null', () => {
    const facts: DayFacts = {
      date: D,
      scopeId: 's1',
      seq: 10,
      buyers: new Map([['UC_M', { id: 'UC_M', root: 'UC_M', platform: 'YOUTUBE', display: 'M', nameHistory: [], phoneLast4: null, blocked: false, marker: 'c:UC_M', archived: false }]]),
      bundles: new Map([
        ['UC_M', { date: D, buyer: 'UC_M', items: 1, subtotal: 12_000, payment: 'PAID', cancels: 0, noPay: 0, name: 'M', members: ['UC_M'], record: true, archived: false }],
      ]),
      markers: new Map([['c:UC_M', 'UC_M']]),
    }
    const merged = mergeArchive(facts, [
      { root: 'UC_M', members: [{ id: 'UC_M', marker: 'c:UC_M', display: 'M', phoneLast4: null }], cancels: 1, noPay: 0 },
      { root: 'UC_N', members: [{ id: 'UC_N', marker: 'c:UC_N', display: 'N', phoneLast4: null }], cancels: 1, noPay: 1 },
    ])
    expect(merged.bundles.get('UC_M')).toMatchObject({ items: 1, subtotal: 12_000, payment: 'PAID', cancels: 1, noPay: 0, archived: false })
    expect(merged.bundles.get('UC_N')).toMatchObject({ items: 0, subtotal: 0, payment: 'UNPAID', cancels: 1, noPay: 1, record: true, archived: true })
    expect(merged.markers.get('c:UC_N')).toBe('UC_N')
    expect(merged.buyers.get('UC_N')).toMatchObject({ archived: true, root: 'UC_N', nameHistory: [] })
    // 원래 재료는 바뀌지 않는다 (캐시가 같은 것을 다시 쓴다)
    expect(facts.bundles.get('UC_M')?.cancels).toBe(0)
    for (const bad of ['', '[]', '{}', '[1]', '[{"id":1,"marker":null,"display":"a","phoneLast4":null}]', 'nope']) expect(readArchiveMembers(bad)).toBeNull()
  })

  it('보조자는 손님 기록 경로 403 그대로 (보관 행도 판매자 전용 계산에만)', async () => {
    const { world, seller } = await crmWorld(kst(D, '09:00:00'))
    await sellDay(world, seller)
    at(world, '2026-09-12', '12:00:00')
    await world.server.customerArchiver.runOnce()
    const created = await expectOk(client(world, seller.cookie).post('/api/assistants', { name: '엄마' }))
    const assistant = created.body as { assistant: { loginId: string }; password: string }
    const helper = await login(world, assistant.assistant.loginId, assistant.password)
    expect((await client(world, helper).get('/api/customers')).status).toBe(403)
    expect((await client(world, seller.cookie).get('/api/customers')).status).toBe(200)
  })
})
