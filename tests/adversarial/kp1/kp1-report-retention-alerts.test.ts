// KP1 적대 시험 (test-domain) — 리포트 = 판매대장 합(AC-KP1-18, 임의 기록 속성 시험)·봉인 날짜(AC-KP1-17),
// 보관 기간 정리(AC-KP1-06 — 리허설·품목 없는 묶음은 마지막 주문이 아니다, 설정을 줄이면 다음 정리에서 바로),
// 알림 받기 신청(AC-KP1-22 — 체크 없음·휴대폰 아닌 번호·그만 받기 같은 문장·판매자마다), 바깥 연결 0번(AC-KP1-24).
import { createRequire } from 'node:module'
import type ExcelJSType from 'exceljs'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { at, chat, getFile, kst } from '../../../apps/server/test/i2-support.ts'
import { codes, consent, consents, ledgerApi, ledgerWorld, lines, markers, postForm } from '../../../apps/server/test/kp1-ledger-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, login, newWorld, writeEvent, type Seller, type TestServer } from '../../../apps/server/test/support.ts'
import { sell } from '../../../apps/server/test/t1-support.ts'
import { storedPhones } from '../../../apps/server/src/schedule/service.ts'

/** exceljs는 서버 패키지 의존성이라 그 패키지 기준으로 불러온다 */
const ExcelJS = createRequire(new URL('../../../apps/server/package.json', import.meta.url))('exceljs') as typeof ExcelJSType

afterEach(() => {
  vi.restoreAllMocks()
})

const relogin = async (world: TestServer, seller: Seller): Promise<Seller> => ({ ...seller, cookie: await login(world, seller.loginId, seller.password) })

async function readSheet(bytes: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (sheet === undefined) return []
  const rows: string[][] = []
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= 11; c++) {
      const value = row.getCell(c).value
      cells.push(value === null || value === undefined ? '' : String(value))
    }
    rows.push(cells)
  }
  return rows
}

// ── AC-KP1-18·17 리포트 = 판매대장 합 ────────────────────────────────

type Op =
  | { kind: 'chat'; buyer: number; product: number }
  | { kind: 'cancel'; buyer: number; product: number }
  | { kind: 'assign'; buyer: number; product: number }
  | { kind: 'pay'; buyer: number; amount: number }
  | { kind: 'adjust'; buyer: number; amount: number }
  | { kind: 'merge'; from: number; into: number }

const BUYERS = ['UC_A', 'UC_B', 'UC_C', 'UC_D']
const RD = '2026-09-01'

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('chat' as const), buyer: fc.nat(3), product: fc.nat(4) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('cancel' as const), buyer: fc.nat(3), product: fc.nat(4) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('assign' as const), buyer: fc.nat(3), product: fc.nat(4) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('pay' as const), buyer: fc.nat(3), amount: fc.integer({ min: 1, max: 60 }).map((n) => n * 1000) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('adjust' as const), buyer: fc.nat(3), amount: fc.integer({ min: -5, max: 5 }).map((n) => n * 1000) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('merge' as const), from: fc.nat(3), into: fc.nat(3) }) },
)

const scenarioArb = fc.record({
  products: fc.array(fc.record({ price: fc.integer({ min: 1, max: 80 }).map((n) => n * 500), stock: fc.integer({ min: 1, max: 3 }) }), { minLength: 1, maxLength: 5 }),
  ops: fc.array(opArb, { minLength: 4, maxLength: 24 }),
})

interface Totals {
  sales: number
  qty: number
  received: number
}

async function ledgerTotals(world: TestServer, seller: Seller, date: string): Promise<{ sales: number; qty: number }> {
  const file = await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${date}&to=${date}`)
  expect(file.status).toBe(200)
  const rows = (await readSheet(file.bytes)).slice(1).filter((row) => row[0] === date && row[8] === '1등')
  return { sales: rows.reduce((sum, row) => sum + Number(row[4]), 0), qty: rows.length }
}

async function receivedSum(world: TestServer, seller: Seller, date: string): Promise<number> {
  const view = await expectOk(client(world, seller.cookie).get(`/api/days/${date}`))
  return (view.body.settlements as { date: string; received: number }[]).filter((item) => item.date === date).reduce((sum, item) => sum + item.received, 0)
}

describe('AC-KP1-18 리포트 판매 금액·수량 = 판매대장, 받은 돈 = 정산 화면 (임의 기록 속성 시험)', () => {
  it('임의의 찜·취소·직접 배정·입금·조정·합치기 뒤 — 봉인 전과 봉인 뒤 모두 같다', async () => {
    // 속성 시험이 빈 판매만 보지 않았는지 (판매가 있고 받은 돈이 있는 실행이 있어야 한다)
    let sold = 0
    let paid = 0
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ products, ops }) => {
        const world = await newWorld({ clock: fakeClock(kst(RD, '19:00:00')) })
        const first = await addSeller(world)
        at(world, RD, '20:00:00')
        const b = (await createBroadcast(world, first, { date: RD })).id
        for (const [i, product] of products.entries()) await expectOk(writeEvent(world, first, { type: 'product.register', b, no: i + 1, name: `품종${String(i + 1)}`, price: product.price, stock: product.stock }))
        let n = 0
        for (const op of ops) {
          n++
          world.clock.advance(1000)
          const no = 'product' in op ? (op.product % products.length) + 1 : 0
          if (op.kind === 'chat') await chat(world, first, b, `c${String(n)}`, BUYERS[op.buyer] as string, `손님${String(op.buyer)}`, String(no))
          else if (op.kind === 'cancel') await writeEvent(world, first, { type: 'host.cancel', b, no, buyer: BUYERS[op.buyer], reason: '손님 요청' })
          else if (op.kind === 'assign') await writeEvent(world, first, { type: 'host.assign', b, no, buyer: BUYERS[op.buyer], reason: '전화 주문' })
          else if (op.kind === 'pay') await writeEvent(world, first, { type: 'settlement.payment', buyer: BUYERS[op.buyer], date: RD, amount: op.amount }, RD)
          else if (op.kind === 'adjust') await writeEvent(world, first, { type: 'settlement.adjust', buyer: BUYERS[op.buyer], date: RD, amount: op.amount, reason: '덤' }, RD)
          else if (op.from !== op.into) await writeEvent(world, first, { type: 'buyer.merge', from: BUYERS[op.from], into: BUYERS[op.into], reason: '같은 사람' }, RD)
        }
        const check = async (seller: Seller): Promise<Totals> => {
          const report = await expectOk(client(world, seller.cookie).get(`/api/days/${RD}/report`))
          const summary = report.body.summary as Totals
          const ledger = await ledgerTotals(world, seller, RD)
          expect({ sales: summary.sales, qty: summary.qty }).toEqual(ledger)
          expect(summary.received).toBe(await receivedSum(world, seller, RD))
          return summary
        }
        const before = await check(first)
        if (before.qty > 0) sold++
        if (before.received > 0) paid++
        // 봉인 뒤 (봉인 장부 값)
        at(world, '2026-10-15', '12:00:00')
        const seller = await relogin(world, first)
        expect(await world.server.sealer.runOnce()).toBe(1)
        const after = await check(seller)
        expect(after).toEqual(before)
      }),
      { numRuns: 8, seed: 20261031 },
    )
    expect(sold).toBeGreaterThan(3)
    expect(paid).toBeGreaterThan(0)
  })
})

describe('AC-KP1-18 옵션 방송이 섞인 날짜 (적대)', () => {
  it('번호 방송 + 옵션 방송(변형·수량 2·3개)의 리포트 판매 금액·수량 = 판매대장(옵션 열)의 가격 합·수량 합', async () => {
    const world = await newWorld({ clock: fakeClock(kst(RD, '19:00:00')) })
    const seller = await addSeller(world)
    at(world, RD, '20:00:00')
    const b1 = (await createBroadcast(world, seller, { date: RD, title: '다육 1부' })).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b1, no: 7, name: '핑크프릴', price: 8000 }))
    await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '7')
    at(world, RD, '21:00:00')
    const opened = await client(world, seller.cookie).post('/api/broadcasts', { requestId: `bc-opt-${String(Date.now())}`, date: RD, title: '의류 2부', saleMode: 'OPTIONS' })
    expect(opened.status, opened.text).toBe(200)
    const b2 = (opened.body.broadcast as { id: string }).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b2, no: 21, name: '반바지', price: 10000, stock: 3, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', price: 1500 }] }] }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b2, no: 11, name: '초코 과자', price: 2000, stock: 5 }))
    at(world, RD, '21:00:05')
    await chat(world, seller, b2, 'o1', 'UC_A', '홍길동', '반바지 M 2')
    await chat(world, seller, b2, 'o2', 'UC_B', '김철수', '초코 과자 3')
    await chat(world, seller, b2, 'o3', 'UC_C', '이영희', '반바지 S')
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_B', date: RD, amount: 6000 }, RD))
    const report = await expectOk(client(world, seller.cookie).get(`/api/days/${RD}/report`))
    const summary = report.body.summary as Totals
    const file = await getFile(world, seller.cookie, `/api/ledger.xlsx?from=${RD}&to=${RD}`)
    expect(file.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(file.bytes) as unknown as ArrayBuffer)
    const sheet = workbook.worksheets[0]
    const rows: unknown[][] = []
    sheet?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
    const header = rows[0] as string[]
    const col = (name: string) => header.indexOf(name)
    expect(col('수량')).toBeGreaterThan(0)
    const confirmed = rows.slice(1).filter((row) => row[col('상태')] === '1등')
    const ledger = {
      sales: confirmed.reduce((sum: number, row) => sum + Number(row[col('가격')]), 0),
      qty: confirmed.reduce((sum: number, row) => sum + Number(row[col('수량')]), 0),
    }
    expect(ledger.qty).toBe(1 + 2 + 3 + 1)
    expect({ sales: summary.sales, qty: summary.qty }).toEqual(ledger)
    expect(summary.received).toBe(await receivedSum(world, seller, RD))
  })
})

describe('AC-KP1-17 봉인 날짜 리포트 (적대)', () => {
  it('봉인 날짜: 돈·손님·품종은 봉인 전과 같고 시간대·몰린 상품은 없음, 방송 중 표시 없음. 같은 날짜 리허설은 그대로 빠진다', async () => {
    const world = await newWorld({ clock: fakeClock(kst(RD, '19:00:00')) })
    const first = await addSeller(world)
    at(world, RD, '20:00:00')
    const b = (await createBroadcast(world, first, { date: RD })).id
    const r = (await createBroadcast(world, first, { date: RD, rehearsal: true })).id
    await expectOk(writeEvent(world, first, { type: 'product.register', b, no: 1, name: '백모단', price: 12_000 }))
    await expectOk(writeEvent(world, first, { type: 'product.register', b: r, no: 1, name: '연습', price: 99_000 }))
    await chat(world, first, b, 'a', 'UC_A', '가람', '1')
    await chat(world, first, r, 'r', 'UC_R', '연습', '1')
    await expectOk(writeEvent(world, first, { type: 'settlement.payment', buyer: 'UC_A', date: RD, amount: 5000 }, RD))
    const live = await expectOk(client(world, first.cookie).get(`/api/days/${RD}/report`))
    expect(live.body.live).toBe(true)
    at(world, '2026-10-15', '12:00:00')
    const seller = await relogin(world, first)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const sealed = await expectOk(client(world, seller.cookie).get(`/api/days/${RD}/report`))
    expect(sealed.body).toMatchObject({ sealed: true, live: false, rush: null, buckets: null, summary: live.body.summary, varieties: live.body.varieties })
    expect((sealed.body.summary as Totals).sales).toBe(12_000)
    expect(sealed.text).not.toMatch(/연습|UC_|가람/)
    // 봉인 날짜에 입금을 더 적을 수 없다 — 리포트도 그대로
    await writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: RD, amount: 1000 }, RD)
    expect((await expectOk(client(world, seller.cookie).get(`/api/days/${RD}/report`))).body.summary).toEqual(sealed.body.summary)
  })
})

// ── AC-KP1-06 보관 기간 정리 ─────────────────────────────────────────

describe('AC-KP1-06 지우는 날 (적대 — 가짜 시계)', () => {
  it('마지막 주문 2026-01-31·동의 24개월·설정 12개월 → 2027-01-31 0시 KST 뒤 첫 정리에서 줄·표지·코드가 사라지고 EXPIRE. 리허설 주문·품목 없는 묶음은 마지막 주문이 아니다', async () => {
    const { world, seller: s0 } = await ledgerWorld(kst('2026-01-31', '19:00:00'))
    let seller = s0
    const api = () => ledgerApi(world, seller.cookie)
    expect((await api().saveSettings({ months: 24, consoleBadges: true })).status).toBe(200)
    at(world, '2026-01-31', '20:00:00')
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ], '2026-01-31')
    const tokenA = await consent(world, seller, 'UC_A', '2026-01-31')
    await consent(world, seller, 'UC_B', '2026-01-31', { name: '나래', phone: '010-3333-4444', address: '대전 서구 둔산로 1', detail: '', zip: '35200', memo: '' })
    expect((await postForm(world, `/r/${tokenA}/ledger/code`, {})).status).toBe(303)
    expect((await lines(world)).map((row) => row.consent_months)).toEqual([24, 24])
    expect((await api().saveSettings({ months: 12, consoleBadges: true })).status).toBe(200)
    // UC_B: 실제 주문 2026-03-10 (지우는 날을 늦춘다)
    at(world, '2026-03-10', '20:00:00')
    seller = await relogin(world, seller)
    await sell(world, seller, [['UC_B', '나래', 1]], '2026-03-10')
    // UC_A: 리허설 주문 2026-05-01, 취소해 품목 없는 실제 묶음 2026-06-01 — 둘 다 마지막 주문이 아니다
    at(world, '2026-05-01', '20:00:00')
    seller = await relogin(world, seller)
    await sell(world, seller, [['UC_A', '가람', 1]], '2026-05-01', { rehearsal: true })
    at(world, '2026-06-01', '20:00:00')
    seller = await relogin(world, seller)
    const b = await sell(world, seller, [['UC_A', '가람', 1]], '2026-06-01')
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_A', reason: '손님 요청' }))

    const sweep = async (date: string, time: string) => {
      world.clock.set(kst(date, time))
      await world.server.ledgerSweeper.runOnce()
    }
    await sweep('2027-01-30', '23:59:59')
    expect(await lines(world)).toHaveLength(2)
    await sweep('2027-01-31', '00:00:00')
    expect((await markers(world)).map((row) => row.marker)).toEqual(['c:UC_B'])
    expect(await lines(world)).toHaveLength(1)
    expect(await codes(world)).toEqual([])
    expect((await consents(world)).filter((row) => row.type === 'EXPIRE').map((row) => [row.reason, row.months])).toEqual([['기간 지남', 24]])
    await sweep('2027-03-09', '23:59:59')
    expect(await lines(world)).toHaveLength(1)
    await sweep('2027-03-10', '00:00:00')
    expect(await lines(world)).toEqual([])
    expect(await markers(world)).toEqual([])
  })

  it('설정을 1년 → 6개월로 줄이면 이미 지난 줄은 다음 정리에서 바로 지운다', async () => {
    const { world, seller: s0 } = await ledgerWorld(kst('2026-03-01', '19:00:00'))
    at(world, '2026-03-01', '20:00:00')
    await sell(world, s0, [['UC_A', '가람', 1]], '2026-03-01')
    await consent(world, s0, 'UC_A', '2026-03-01')
    world.clock.set(kst('2026-09-15', '12:00:00'))
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toHaveLength(1)
    const seller = await relogin(world, s0)
    expect((await ledgerApi(world, seller.cookie).saveSettings({ months: 6, consoleBadges: true })).status).toBe(200)
    world.clock.advance(60 * 60 * 1000)
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toEqual([])
    expect((await consents(world)).map((row) => [row.type, row.reason])).toEqual([
      ['AGREE', null],
      ['EXPIRE', '기간 지남'],
    ])
  })
})

// ── AC-KP1-22·24 알림 받기 신청 ──────────────────────────────────────

async function schedulePath(world: TestServer, seller: Seller): Promise<string> {
  const page = await client(world, seller.cookie).put('/api/schedule/page', { enabled: true, channelUrl: null })
  expect(page.status, page.text).toBe(200)
  return new URL((page.body.page as { url: string }).url).pathname
}

describe('AC-KP1-22 알림 받기 신청 (적대)', () => {
  it('체크 칸은 처음 비어 있고, 휴대폰 번호가 아닌 것(일반 전화·070·대표 번호·자리 수 넘침)은 저장하지 않는다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-31', '10:00:00')) })
    const seller = await addSeller(world)
    const path = await schedulePath(world, seller)
    const html = await (await world.server.app.request(path)).text()
    const agree = /<input[^>]*name="agree"[^>]*>/.exec(html)?.[0] ?? ''
    expect(agree).not.toBe('')
    expect(agree).not.toMatch(/checked/)
    for (const phone of ['02-1234-5678', '070-1234-5678', '1588-1234', '031-123-4567', '010-1234-56789', '', '공일공-1234-5678']) {
      world.clock.advance(7_000)
      const sent = await postForm(world, `${path}/alert`, { phone, agree: 'on' })
      expect(sent.status, phone).toBe(400)
      expect(sent.text).toContain('휴대폰 번호를 확인해 주세요.')
    }
    for (const body of [{ phone: '010-2345-6789' }, { phone: '010-2345-6789', agree: '' }, { phone: '010-2345-6789', agree: 'off' }]) {
      world.clock.advance(7_000)
      expect((await postForm(world, `${path}/alert`, body)).status).toBe(400)
    }
    expect(await storedPhones(world.database.db, seller.sellerId)).toBe(0)
  })

  it('그만 받기: 있는 번호·없는 번호·다른 가게에만 있는 번호가 같은 응답·같은 문장이고, 다른 가게 신청은 그대로다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-31', '10:00:00')) })
    const a = await addSeller(world)
    const b = await addSeller(world)
    const pathA = await schedulePath(world, a)
    const pathB = await schedulePath(world, b)
    expect((await postForm(world, `${pathA}/alert`, { phone: '010-1111-2222', agree: 'on' })).status).toBe(303)
    expect((await postForm(world, `${pathB}/alert`, { phone: '010-3333-4444', agree: 'on' })).status).toBe(303)
    const known = await postForm(world, `${pathA}/stop`, { phone: '010-1111-2222' })
    const unknown = await postForm(world, `${pathA}/stop`, { phone: '010-9999-8888' })
    const otherShop = await postForm(world, `${pathA}/stop`, { phone: '010-3333-4444' })
    expect([known.status, unknown.status, otherShop.status]).toEqual([303, 303, 303])
    expect(new Set([known.headers.get('location'), unknown.headers.get('location'), otherShop.headers.get('location')]).size).toBe(1)
    expect(known.text).toBe(unknown.text)
    expect(known.text).toBe(otherShop.text)
    expect(await storedPhones(world.database.db, a.sellerId)).toBe(0)
    expect(await storedPhones(world.database.db, b.sellerId)).toBe(1)
    expect(await expectOk(client(world, b.cookie).get('/api/schedule/alerts')).then((r) => r.body)).toEqual({ pending: 1, active: 0, withdrawn: 0 })
  })
})

describe('AC-KP1-24 바깥 연결 0번 (적대)', () => {
  it('동의·연결 코드·다음 방송 꼬리표·[배송지 확인]·알림 신청·그만 받기·정리 작업(기한 지남까지) 내내 fetch가 한 번도 불리지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    const code = (await codes(world))[0]?.code as string
    await chat(world, seller, b, 'x', 'UC_B', '나래', code)
    const path = await schedulePath(world, seller)
    expect((await postForm(world, `${path}/alert`, { phone: '010-5555-6666', agree: 'on' })).status).toBe(303)
    expect((await postForm(world, `${path}/stop`, { phone: '010-5555-6666' })).status).toBe(303)
    expect((await postForm(world, `${path}/alert`, { phone: '010-5555-7777', agree: 'on' })).status).toBe(303)
    at(world, '2026-10-26', '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], '2026-10-26')
    const api = ledgerApi(world, seller.cookie)
    expect((await api.badges('2026-10-26', ['UC_A'])).status).toBe(200)
    const bundle = (await api.bundle('UC_A', '2026-10-26')).body.bundle as { ledger: { ledgerId: string; updatedAt: string } }
    expect((await api.confirmLedger('UC_A', bundle.ledger.ledgerId, bundle.ledger.updatedAt, '2026-10-26')).status).toBe(200)
    for (const date of ['2026-11-20', '2028-12-01']) {
      world.clock.set(kst(date, '00:30:00'))
      await world.server.ledgerSweeper.runOnce()
    }
    expect(await storedPhones(world.database.db, seller.sellerId)).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
