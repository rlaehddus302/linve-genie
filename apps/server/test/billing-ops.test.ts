// N5 운영 설정·운영자 명령·요금 상태·알림 띠·실시간·내역·사업자 정보·로그·구조 (AC-N5-01·10·11·12·13·14·15·37·39·41).
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSellerAccount } from '../src/accounts.ts'
import { DEFAULT_PRICE_TABLE, PLACEHOLDER_REFUSAL, PORTONE_REFUSAL, parsePriceTable, readBillingEnv } from '../src/billing/config.ts'
import { formatOperatorLists, grantForLogin, operatorLists } from '../src/billing/operator.ts'
import { DAY_MS, HOUR_MS, billingStatus } from '../src/billing/rules.ts'
import { openPglite } from '../src/db/database.ts'
import { productionServerOptions } from '../src/production.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { createServer } from '../src/server.ts'
import { BIZNO, billingWorld, buy, fake, grant, kst, order, query, saveBusiness, status } from './billing-support.ts'
import { FAST_COST, addSeller, client, createBroadcast, dumpAllTables, expectOk, fakeClock, openTestDb, rid, sseReader, startServer, writeEvent } from './support.ts'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
function sources(dir = SRC): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (entry.name.endsWith('.ts')) out.push({ path: full.slice(SRC.length + 1), text: readFileSync(full, 'utf8') })
  }
  return out
}

describe('AC-N5-11 운영 설정·스위치·기동 거부', () => {
  const portone = { PORTONE_STORE_ID: 'store-live', PORTONE_CHANNEL_KEY: 'channel-live', PORTONE_API_SECRET: 'api-secret-live-77', PORTONE_WEBHOOK_SECRET: `whsec_${Buffer.from('hook-secret-live').toString('base64')}` }
  const table = JSON.stringify({ items: [{ id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', price: 29000 }, { id: 'days-1', name: '방송 일권 1일', kind: 'DAYS', quantity: 1, price: 4900 }] })

  it('기본 꺼짐·기본 요금 표(자리 표시). 켜면 자리 표시 표·빈 포트원 설정을 거부한다(비밀값을 문장에 넣지 않는다)', () => {
    expect(readBillingEnv({})).toEqual({ ok: true, billing: { enabled: false, prices: DEFAULT_PRICE_TABLE, portone: { storeId: '', channelKey: '', apiSecret: '', webhookSecret: '' } } })
    expect(DEFAULT_PRICE_TABLE.placeholder).toBe(true)
    expect(readBillingEnv({ LIVEJJIM_BILLING: 'on', ...portone })).toEqual({ ok: false, message: PLACEHOLDER_REFUSAL })
    expect(PLACEHOLDER_REFUSAL).toBe('요금 표가 자리 표시 값이에요. 운영 가격을 정한 뒤 켜 주세요.')
    for (const key of Object.keys(portone)) {
      const result = readBillingEnv({ LIVEJJIM_BILLING: 'on', LIVEJJIM_BILLING_PRICES: '/prices.json', ...portone, [key]: '' }, () => table)
      expect(result).toEqual({ ok: false, message: PORTONE_REFUSAL })
    }
    expect(PORTONE_REFUSAL).toBe('결제 설정이 비어 있어 요금 기능을 켤 수 없어요.')
    const ok = readBillingEnv({ LIVEJJIM_BILLING: 'on', LIVEJJIM_BILLING_PRICES: '/prices.json', ...portone }, () => table)
    expect(ok.ok).toBe(true)
    expect(readBillingEnv({ LIVEJJIM_BILLING: 'yes' })).toMatchObject({ ok: false })
    expect(readBillingEnv({ LIVEJJIM_BILLING: 'off', LIVEJJIM_BILLING_PRICES: '/x' }, () => '{nope')).toMatchObject({ ok: false, message: expect.stringContaining('요금 표 파일') })
  })

  it('요금 표 형식이 틀리면 무엇이 틀렸는지 한 문장 (꺼져 있어도 기동하지 않는다)', () => {
    const bad: [unknown, RegExp][] = [
      [[], /맨 바깥/],
      [{ items: [] }, /하나 이상/],
      [{ items: [{ id: 'A B', name: 'x', kind: 'DAYS', quantity: 1, price: 1000 }] }, /1번째 항목: ID/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 1, price: 1000 }, { id: 'a', name: 'y', kind: 'DAYS', quantity: 1, price: 1000 }] }, /2번째 항목: 같은 ID/],
      [{ items: [{ id: 'a', name: '', kind: 'DAYS', quantity: 1, price: 1000 }] }, /이름/],
      [{ items: [{ id: 'a', name: 'x'.repeat(31), kind: 'DAYS', quantity: 1, price: 1000 }] }, /이름/],
      [{ items: [{ id: 'a', name: 'x', kind: 'POINTS', price: 1000 }] }, /종류/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', price: 1000 }] }, /양/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 100001, price: 1000 }] }, /양/],
      [{ items: [{ id: 'a', name: 'x', kind: 'FLAT_30D', quantity: 1, price: 1000 }] }, /정액제에는 양/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 1, price: 99 }] }, /가격/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 1, price: 10000001 }] }, /가격/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 1, price: 1000.5 }] }, /가격/],
      [{ items: [{ id: 'a', name: 'x', kind: 'DAYS', quantity: 1, price: 1000, extra: 1 }] }, /모르는 칸/],
    ]
    for (const [value, message] of bad) {
      const result = parsePriceTable(value)
      expect(result.ok, JSON.stringify(value)).toBe(false)
      if (!result.ok) expect(result.message).toMatch(message)
    }
    expect(parsePriceTable({ items: [{ id: 'a', name: '방송 일권', kind: 'DAYS', quantity: 3, price: 100, onSale: false }] })).toEqual({
      ok: true,
      table: { placeholder: false, items: [{ id: 'a', name: '방송 일권', kind: 'DAYS', quantity: 3, price: 100, onSale: false }] },
    })
  })

  it('운영 조립: 켜면 포트원 공개 값만 화면 설정에, 시험 결제·시험 경로·가짜 발행기는 없다. 비밀값은 응답에 없다', async () => {
    const database = await openTestDb()
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'https://app.livejjim.test', LIVEJJIM_BILLING: 'on', LIVEJJIM_BILLING_PRICES: '/prices.json', ...portone }
    const assembled = productionServerOptions(env, database, () => table)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.billing?.test).toBeNull()
    expect(assembled.options.billing?.issuer.constructor.name).not.toBe('FakeIssuer')
    const server = createServer({ ...assembled.options, passwordCost: FAST_COST, log: () => {} })
    const world = { server, database, masterKey: env.LIVEJJIM_MASTER_KEY, clock: fakeClock(), logs: [] }
    const seller = await addSeller(world)
    const config = await client(world, seller.cookie).get('/api/client-config')
    expect(config.body).toEqual({ hostActionDelayMs: 5000, testPrinter: false, billing: { enabled: true, testPayment: false, storeId: 'store-live', channelKey: 'channel-live' } })
    expect(config.text).not.toMatch(/api-secret-live|whsec_|hook-secret/)
    const view = await client(world, seller.cookie).get('/api/billing')
    expect(view.body.testPayment).toBe(false)
    expect(view.body.items).toEqual([
      { id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 29000 },
      { id: 'days-1', name: '방송 일권 1일', kind: 'DAYS', quantity: 1, price: 4900 },
    ])
    for (const path of ['/api/billing/test/grants', '/api/billing/test/payments/lj0123456789abcdef0123456789abcdef']) expect((await client(world, seller.cookie).post(path, { kind: 'DAYS', quantity: 1 })).status).toBe(404)
    expect((await client(world, seller.cookie).raw('/api/billing/test/gateway', { method: 'PUT', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    // 운영 결제 창 공개 값은 주문 응답에도 (비밀값 없음)
    await saveBusiness(world, seller)
    const created = await order(world, seller, 'days-1')
    expect(created.body).toMatchObject({ storeId: 'store-live', channelKey: 'channel-live', testPayment: false, amount: 4900 })
    expect(created.text).not.toMatch(/api-secret-live|whsec_/)
    // 기동 거부
    expect(productionServerOptions({ ...env, LIVEJJIM_BILLING_PRICES: '' }, database)).toEqual({ ok: false, message: PLACEHOLDER_REFUSAL })
    expect(productionServerOptions({ ...env, PORTONE_API_SECRET: '' }, database, () => table)).toEqual({ ok: false, message: PORTONE_REFUSAL })
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(main).toContain('productionServerOptions(process.env, database)')
    expect(main).not.toMatch(/testBilling|FakePortOne|FakeIssuer/)
    expect(readFileSync(new URL('../src/production.ts', import.meta.url), 'utf8')).not.toMatch(/testBilling|FakePortOne|FakeIssuer|fake\.ts/)
    server.close()
  })
})

describe('AC-N5-11·40 E2E 기동', () => {
  it('startE2eServer({ billing: true })는 시험 결제로 켜고, 기본은 꺼짐', async () => {
    const { startE2eServer, readE2eAccount } = await import('../src/e2e.ts')
    const loginTo = async (app: { request: (path: string, init: RequestInit) => Response | Promise<Response> }, loginId: string, password: string) => {
      const response = await app.request('/api/login', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
      return /lj_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? ''
    }
    const account = readE2eAccount()
    const on = await startE2eServer({ billing: true, passwordCost: FAST_COST })
    try {
      const cookie = await loginTo(on.server.app, account.loginId, account.password)
      const config = (await (await on.server.app.request('/api/client-config', { headers: { Cookie: cookie } })).json()) as Record<string, unknown>
      expect(config.billing).toEqual({ enabled: true, testPayment: true })
      const granted = await on.server.app.request('/api/billing/test/grants', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'DAYS', quantity: 1 }) })
      expect(granted.status).toBe(200)
      const view = (await (await on.server.app.request('/api/billing', { headers: { Cookie: cookie } })).json()) as { balances: Record<string, number>; items: unknown[] }
      expect(view.balances.DAYS).toBe(1)
      expect(view.items).toHaveLength(7)
    } finally {
      await on.close()
    }
    const off = await startE2eServer({ passwordCost: FAST_COST })
    try {
      const cookie = await loginTo(off.server.app, account.loginId, account.password)
      expect((await off.server.app.request('/api/billing', { headers: { Cookie: cookie } })).status).toBe(404)
    } finally {
      await off.close()
    }
  })
})

describe('AC-N5-12 운영자 명령', () => {
  it('이용권 부여: 아이디·종류·양·사유(휴대폰 번호 거절). 같은 명령 두 번 = 두 장', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const give = (kind: unknown, quantity: unknown, reason: unknown) => grantForLogin(world.database.db, { loginId: seller.loginId, kind, quantity, reason }, world.clock.now())
    expect(await give('DAYS', 3, '기존 판매자 보상')).toMatchObject({ ok: true, sellerId: seller.sellerId, kind: 'DAYS', quantity: 3 })
    expect(await give('DAYS', 3, '기존 판매자 보상')).toMatchObject({ ok: true })
    expect((await status(world, seller)).balances).toMatchObject({ DAYS: 6 })
    expect(await give('FLAT_30D', undefined, '시험')).toMatchObject({ ok: true, quantity: null })
    expect(await give('FLAT_30D', 1, '시험')).toEqual({ ok: false, message: '정액제에는 양을 적지 않아요.' })
    expect(await give('DAYS', 0, '시험')).toMatchObject({ ok: false })
    expect(await give('DAYS', 100_001, '시험')).toMatchObject({ ok: false })
    expect(await give('POINTS', 1, '시험')).toMatchObject({ ok: false })
    expect(await give('DAYS', 1, '')).toMatchObject({ ok: false })
    expect(await give('DAYS', 1, 'x'.repeat(201))).toMatchObject({ ok: false })
    expect(await give('DAYS', 1, '010-1234-5678 보상')).toEqual({ ok: false, message: '사유에 휴대폰 번호를 적지 않아요.' })
    expect(await grantForLogin(world.database.db, { loginId: 'nobody', kind: 'DAYS', quantity: 1, reason: 'x' }, 0)).toEqual({ ok: false, message: '그 아이디의 판매자가 없어요.' })
    const list = (await client(world, seller.cookie).get('/api/billing/payments')).body.items as Record<string, unknown>[]
    expect(list.filter((item) => item.type === 'operator')).toHaveLength(3)
    expect(list[0]).toMatchObject({ type: 'operator', reason: '시험', kind: 'FLAT_30D' })
  })

  it('계정 만들기의 사업자등록번호(선택): 틀리면 계정을 만들지 않는다, 맞으면 번호만 암호화해 둔다', async () => {
    const world = await billingWorld()
    const key = Buffer.from(world.masterKey, 'base64')
    expect(await createSellerAccount(world.database.db, key, { shopName: '가게', loginId: 'biz-bad', password: 'password-1', businessNumber: '123-45-67890' }, { passwordCost: FAST_COST })).toEqual({
      ok: false,
      message: '사업자등록번호를 다시 확인해 주세요.',
    })
    expect(await query(world, `select * from accounts where login_id = 'biz-bad'`)).toEqual([])
    const created = await createSellerAccount(world.database.db, key, { shopName: '가게', loginId: 'biz-good', password: 'password-1', businessNumber: '1234567891' }, { passwordCost: FAST_COST })
    expect(created.ok).toBe(true)
    const { login } = await import('./support.ts')
    const cookie = await login(world, 'biz-good', 'password-1')
    const view = (await client(world, cookie).get('/api/billing')).body
    expect(view.business).toEqual({ masked: '123-45-*****', name: null, ceo: null, email: null, receiptKind: 'TAX_INVOICE', complete: false })
    // 상호·대표자가 없으면 결제 주문을 만들지 않는다
    expect((await client(world, cookie).post('/api/billing/orders', { requestId: rid('o'), itemId: 'days-1', method: 'CARD', agreed: true })).body).toMatchObject({ error: { code: 'BUSINESS_REQUIRED' } })
    expect(await dumpAllTables(world.database)).not.toContain('1234567891')
  })

  it('목록: 확인 필요·1시간 넘게 결제 대기·발행 대기 증빙(복호화한 사업자 정보 — 표준 출력용)', async () => {
    const { noneIssuer } = await import('../src/billing/documents.ts')
    const { testBilling } = await import('../src/billing/fake.ts')
    const clock = fakeClock(kst('2026-10-20', '12:00'))
    const world = await billingWorld({ clock, billing: { ...testBilling(), issuer: noneIssuer } })
    const seller = await addSeller(world)
    await saveBusiness(world, seller, { email: 'tax@shop.kr' })
    const review = (await order(world, seller, 'days-1')).body.paymentId as string
    fake(world).portone.setStatus(review, 'PARTIAL_CANCELLED', 5000)
    await client(world, seller.cookie).post(`/api/billing/orders/${review}/confirm`, { requestId: rid('c') })
    const pending = (await order(world, seller, 'days-10')).body.paymentId as string
    const transfer = await buy(world, seller, 'flat-30', 'TRANSFER')
    clock.advance(HOUR_MS + 1)
    const lists = await operatorLists(world.database.db, Buffer.from(world.masterKey, 'base64'), clock.now())
    expect(lists.review.map((row) => row.paymentId)).toEqual([review])
    expect(lists.stalePending.map((row) => row.paymentId)).toEqual([pending])
    expect(lists.documents.map((doc) => doc.document.paymentId)).toEqual([transfer])
    expect(lists.documents[0]?.recipient).toEqual({ businessNumber: BIZNO, name: '다육 상회', ceo: '김대표', email: 'tax@shop.kr' })
    const lines = formatOperatorLists(lists).join('\n')
    expect(lines).toContain(`사업자등록번호 ${BIZNO}`)
    expect(lines).toContain('공급가액 27,273원')
    expect(lines).toContain('세액 2,727원')
    expect(lines).toContain('발행 대기')
    // 서버 로그에는 사업자 정보가 없다
    expect(JSON.stringify(world.logs)).not.toMatch(/67891|다육 상회|김대표|tax@shop/)
  })

  it('명령 프로세스: billing-grant·billing-list·create-account --bizno', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-billing-'))
    try {
      const masterKey = generateMasterKey()
      const env = { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: masterKey }
      const script = (name: string) => fileURLToPath(new URL(`../src/commands/${name}`, import.meta.url))
      const run = (file: string, args: string[], input = '') =>
        new Promise<{ code: number; out: string; err: string }>((resolve) => {
          const child = execFile(process.execPath, [file, ...args], { env: { PATH: process.env.PATH ?? '', ...env } }, (error, out, err) => resolve({ code: error === null ? 0 : ((error as { code?: number }).code ?? 1), out, err }))
          child.stdin?.end(input)
        })
      const bad = await run(script('create-account.ts'), ['--name', '가게', '--login', 'cmdbiz', '--bizno', '123-45-67890'], 'password-123\n')
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('사업자등록번호를 다시 확인해 주세요.')
      const good = await run(script('create-account.ts'), ['--name', '가게', '--login', 'cmdbiz', '--bizno', '123-45-67891'], 'password-123\n')
      expect(good.code, good.err).toBe(0)
      expect(good.out + good.err).not.toContain('67891')
      const granted = await run(script('billing-grant.ts'), ['--login', 'cmdbiz', '--kind', 'DAYS', '--quantity', '5', '--reason', '보상 사유 표식'])
      expect(granted.code, granted.err).toBe(0)
      expect(granted.out).toMatch(/이용권을 줬어요\. 판매자 sel_.* · 이용권 g[0-9a-f]+ · DAYS · 5/)
      expect(granted.out).not.toContain('보상 사유 표식')
      const refused = await run(script('billing-grant.ts'), ['--login', 'cmdbiz', '--kind', 'DAYS', '--reason', '양 없음'])
      expect(refused.code).toBe(1)
      const listed = await run(script('billing-list.ts'), [])
      expect(listed.code, listed.err).toBe(0)
      expect(listed.out).toContain('확인 필요 결제 0건')
      const database = await openPglite(dir, { migrate: false })
      const rows = await database.pglite?.query<{ n: number }>(`select count(*)::int as n from billing_grants`)
      expect(rows?.rows[0]?.n).toBe(1)
      await database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('AC-N5-13 요금 상태·알림 띠·실시간', () => {
  it('알림 띠: 정액 남은 N일(올림)·정액 끝남·시작할 이용권 없음·주문 건 초과·라벨 장 초과', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock })
    let seller = await addSeller(world)
    expect((await status(world, seller)).banners).toEqual([{ kind: 'NO_PASS' }])
    // 정액이 2일 1시간 남음 → 3일
    await grant(world, seller, 'FLAT_30D', null, kst('2026-10-20', '20:00') - 28 * DAY_MS + HOUR_MS)
    const view = await status(world, seller)
    expect(view.banners).toEqual([{ kind: 'FLAT_REMAINING', days: 3, until: (view.flat as { until: string }).until }])
    expect(view.start).toMatchObject({ allowed: true, mode: 'FLAT', flatUntil: (view.flat as { until: string }).until })
    // 끝난 뒤 7일 안이고 시작할 이용권 없음 → 끝남 띠
    clock.advance(3 * DAY_MS)
    const { login } = await import('./support.ts')
    seller = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const ended = await status(world, seller)
    expect(ended.flat).toMatchObject({ active: false, until: null })
    expect(ended.banners).toEqual([{ kind: 'FLAT_ENDED', at: (ended.flat as { endedAt: string }).endedAt }])
    // 끝난 지 7일이 넘으면 그냥 "이용권 없음"
    clock.advance(7 * DAY_MS)
    seller = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    expect((await status(world, seller)).banners).toEqual([{ kind: 'NO_PASS' }])
  })

  it('부여·결제 주문·방송 시작·사업자 정보는 요금 알림 하나(까닭만), 주문 건 쓰기는 알리지 않는다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const sse = sseReader(await world.server.app.request('/api/stream', { headers: { Cookie: seller.cookie } }))
    await sse.until(() => sse.events.some((e) => e.event === 'ready'))
    const reasons = () => sse.events.filter((e) => e.event === 'billing').map((e) => (JSON.parse(e.data) as { reason: string }).reason)
    await saveBusiness(world, seller)
    await sse.until(() => reasons().includes('business'))
    await grant(world, seller, 'ORDERS', 1)
    await sse.until(() => reasons().includes('grant'))
    const b = await createBroadcast(world, seller)
    await sse.until(() => reasons().includes('start'))
    const before = reasons().length
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 1000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, phone: '010-1234-5678' }))
    await sse.until(() => sse.events.filter((e) => e.event === 'change').length >= 3)
    expect(reasons().length).toBe(before)
    await order(world, seller, 'days-1')
    await sse.until(() => reasons().includes('order'))
    for (const e of sse.events.filter((item) => item.event === 'billing')) expect(Object.keys(JSON.parse(e.data) as object)).toEqual(['reason'])
    await sse.cancel()
  })

  it('다시 켜도(새 인스턴스) 잔량·사슬·열린 창·이용 방식·주문 상태가 그대로', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await buy(world, seller, 'days-10')
    await grant(world, seller, 'FLAT_30D')
    await createBroadcast(world, seller)
    const before = await status(world, seller)
    world.server.close()
    const again = { ...startServer(world.database, world.masterKey, { billing: world.setup, clock: world.clock }), setup: world.setup }
    expect(await status(again, seller)).toEqual(before)
  })
})

describe('AC-N5-14 결제 내역·쓴 내역', () => {
  it('최근 것 먼저, 이어 받기로 빠짐·겹침 없이 끝까지', async () => {
    const clock = fakeClock(kst('2026-10-20', '20:00'))
    const world = await billingWorld({ clock, ids: { broadcast: (() => { let n = 0; return () => `bx${String(++n)}` })() } })
    const seller = await addSeller(world)
    for (let i = 0; i < 5; i++) {
      clock.advance(1000)
      await grant(world, seller, 'ORDERS', 10)
      await buy(world, seller, 'labels-100')
    }
    const all: string[] = []
    let cursor: string | null = null
    do {
      const page = (await client(world, seller.cookie).get(`/api/billing/payments?limit=3${cursor === null ? '' : `&cursor=${cursor}`}`)).body as { items: { type: string; paymentId?: string; grantId?: string; createdAt?: string; at?: string }[]; next: string | null }
      all.push(...page.items.map((item) => item.paymentId ?? item.grantId ?? ''))
      cursor = page.next
    } while (cursor !== null)
    expect(all).toHaveLength(10)
    expect(new Set(all).size).toBe(10)
    expect((await client(world, seller.cookie).get('/api/billing/payments?limit=0')).status).toBe(400)
    expect((await client(world, seller.cookie).get('/api/billing/payments?limit=101')).status).toBe(400)
    expect((await client(world, seller.cookie).get('/api/billing/payments?cursor=../x')).status).toBe(400)
    // 쓴 내역: 방송 일·주문 건(지금 품종)·라벨
    await grant(world, seller, 'DAYS', 1)
    const b = await createBroadcast(world, seller, { date: '2026-10-20' })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 1000 }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, phone: '010-1234-5678' }))
    const usage = (await client(world, seller.cookie).get('/api/billing/usage')).body as { items: Record<string, unknown>[]; next: null }
    expect(usage.items).toHaveLength(1)
    expect(usage.items[0]).toMatchObject({ kind: 'DAYS', broadcast: { id: b.id, title: '1부', date: '2026-10-20' }, windowUntil: new Date(Date.parse(usage.items[0]?.at as string) + DAY_MS).toISOString() })
    // ORDERS 방송의 주문 건 (번호를 바꾸면 지금 번호·지금 품종)
    const clock2 = clock
    clock2.advance(2 * DAY_MS)
    const { login } = await import('./support.ts')
    const fresh = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const ob = await createBroadcast(world, fresh, { date: '2026-10-22' })
    await expectOk(writeEvent(world, fresh, { type: 'product.register', b: ob.id, no: 3, name: '라울', price: 1000 }))
    await expectOk(writeEvent(world, fresh, { type: 'sms', b: ob.id, no: 3, phone: '010-1234-5678' }))
    await expectOk(writeEvent(world, fresh, { type: 'product.update', b: ob.id, no: 3, name: '라울 대품' }))
    await expectOk(writeEvent(world, fresh, { type: 'product.renumber', b: ob.id, from: 3, to: 33 }))
    const pages = (await client(world, fresh.cookie).get('/api/billing/usage?limit=1')).body as { items: Record<string, unknown>[]; next: string }
    expect(pages.items[0]).toMatchObject({ kind: 'ORDERS', productNo: 33, productName: '라울 대품', broadcast: { id: ob.id }, windowUntil: null })
    const second = (await client(world, fresh.cookie).get(`/api/billing/usage?limit=1&cursor=${pages.next}`)).body as { items: Record<string, unknown>[]; next: string | null }
    expect(second.items[0]).toMatchObject({ kind: 'DAYS' })
    expect(second.next).toBeNull()
  })
})

describe('AC-N5-15 출처를 보지 않는 사슬·시작 (자동 갱신 구조)', () => {
  it('같은 시각의 결제 이용권과 운영자 이용권은 사슬·잔량·시작에서 똑같다 (환불만 결제 확인)', () => {
    const now = kst('2026-10-21', '10:00')
    const base = { usage: [], flatStarts: [], now }
    const paid = billingStatus({ ...base, grants: [{ id: 'g1', kind: 'FLAT_30D', source: 'PAYMENT', at: kst('2026-10-20', '20:00') }, { id: 'g2', kind: 'DAYS', quantity: 2, source: 'PAYMENT', at: kst('2026-10-20', '20:00') }] })
    const operator = billingStatus({ ...base, grants: [{ id: 'g1', kind: 'FLAT_30D', source: 'OPERATOR', at: kst('2026-10-20', '20:00') }, { id: 'g2', kind: 'DAYS', quantity: 2, source: 'OPERATOR', at: kst('2026-10-20', '20:00') }] })
    expect(operator.flat).toEqual(paid.flat)
    expect(operator.balances).toEqual(paid.balances)
    expect(operator.start).toEqual(paid.start)
    expect(paid.refundable).toEqual(['g1', 'g2'])
    expect(operator.refundable).toEqual([])
  })

  it('지금 코드에 빌링키 경로·설정이 없다', () => {
    for (const { path, text } of sources()) expect(text, path).not.toMatch(/billingKey|billing-key|BILLING_KEY|issueBillingKey/i)
  })
})

describe('AC-N5-01·02·10·41 구조 (소스 검사)', () => {
  it('판단은 순수 함수 하나: billingStatus·judgePayment를 부르는 곳은 요금 서비스뿐, 기간 상수는 rules.ts에만', () => {
    for (const { path, text } of sources()) {
      if (path === 'billing/rules.ts' || path === 'index.ts') continue
      if (/billingStatus\(|judgePayment\(/.test(text)) expect(path).toBe('billing/service.ts')
      // 요금 기간(30일·7일·24시간 창)을 다시 계산한 곳이 없다 (세션 30일 같은 다른 기간은 요금 밖)
      if (path.startsWith('billing/')) expect(text, path).not.toMatch(/30\s*\*\s*DAY_MS|30\s*\*\s*24\s*\*\s*60|7\s*\*\s*DAY_MS|7\s*\*\s*24\s*\*\s*60|REFUND_PERIOD_MS|FLAT_PERIOD_MS/)
    }
  })

  it('이용권·회수·쓴 기록·이용 방식 표에는 고치거나 지우는 코드가 없다 (덧붙이기만)', () => {
    const tables = ['billingGrants', 'billingRevocations', 'billingUsage', 'billingModes']
    const raw = ['billing_grants', 'billing_revocations', 'billing_usage', 'billing_modes']
    for (const { path, text } of sources()) {
      for (const table of tables) expect(text, `${path} ${table}`).not.toMatch(new RegExp(`\\.(update|delete)\\(\\s*${table}\\b`))
      for (const table of raw) expect(text.toLowerCase(), `${path} ${table}`).not.toMatch(new RegExp(`(update|delete\\s+from)\\s+"?${table}\\b`))
      expect(text, path).not.toMatch(/onConflictDoUpdate\(\{\s*target:\s*billing(Grants|Revocations|Usage|Modes)/)
    }
  })

  it('충전금·넘기기·출금 경로가 없다 — 돈이 돌아가는 길은 결제 어댑터의 취소뿐', async () => {
    const world = await billingWorld()
    const routes = world.server.app.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes.filter((route) => route.includes('/api/billing'))).toEqual(
      expect.arrayContaining(['GET /api/billing', 'POST /api/billing/orders', 'POST /api/billing/orders/:paymentId/refund', 'POST /api/billing/webhook']),
    )
    for (const route of routes) expect(route).not.toMatch(/charge|point|wallet|balance|transfer|withdraw|payout|deposit-to|gift|send/i)
    const cancelCallers = sources().filter(({ text }) => /gateway\.cancel\(/.test(text)).map(({ path }) => path)
    expect(cancelCallers).toEqual(['billing/service.ts'])
  })
})

describe('AC-N5-37 사업자 정보', () => {
  it('검사·문장: 형식 → "숫자 10자리", 검증 숫자 → "다시 확인", 상호·대표자·이메일·증빙 종류·제어 글자', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const problems = async (extra: Record<string, unknown>) => ((await saveBusiness(world, seller, extra)).body as { error?: { problems?: { field: string; message: string }[] } }).error?.problems ?? []
    expect(await problems({ businessNumber: '123-45-6789' })).toEqual([{ field: 'businessNumber', message: '사업자등록번호는 숫자 10자리로 적어 주세요.' }])
    expect(await problems({ businessNumber: '123-45-67890' })).toEqual([{ field: 'businessNumber', message: '사업자등록번호를 다시 확인해 주세요.' }])
    expect(await problems({ name: '' })).toEqual([{ field: 'name', message: '상호는 1~50자로 적어 주세요.' }])
    expect(await problems({ name: '가'.repeat(51) })).toEqual([{ field: 'name', message: '상호는 1~50자로 적어 주세요.' }])
    expect(await problems({ ceo: '대표\u0000' })).toEqual([{ field: 'ceo', message: '대표자 이름은 1~30자로 적어 주세요.' }])
    expect(await problems({ email: 'nope' })).toEqual([{ field: 'email', message: '이메일은 이름@도메인 모양으로 100자 이하로 적어 주세요.' }])
    expect(await problems({ receiptKind: 'BOTH' })).toEqual([{ field: 'receiptKind', message: '계좌이체 증빙은 세금계산서나 현금영수증 중에서 골라 주세요.' }])
    const wrong = await saveBusiness(world, seller, { businessNumber: '999-99-99999' })
    expect(wrong.text).not.toContain('999-99')
    // 휴대폰 번호 검사는 하지 않는다 (판매자 자신의 정보) · 수식 모양도 글자 그대로
    const saved = await saveBusiness(world, seller, { businessNumber: ' 123 45 67891 ', name: '=SUM(A1)', ceo: '김대표 010-1111-2222', email: 'a@b.kr' })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body).toEqual({ masked: '123-45-*****', name: '=SUM(A1)', ceo: '김대표 010-1111-2222', email: 'a@b.kr', receiptKind: 'TAX_INVOICE', complete: true })
    expect((await saveBusiness(world, seller, { extra: 1 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await client(world, seller.cookie).raw('/api/billing/business', { method: 'PUT', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)
  })

  it('암호화 저장: DB 어디에도 번호 10자리·상호·대표자 평문이 없다, 조회는 가린 번호만, 로그에도 없다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    await saveBusiness(world, seller, { name: '비밀상호표식', ceo: '비밀대표표식', email: 'secret-mail@shop.kr' })
    await buy(world, seller, 'flat-30', 'TRANSFER')
    const dump = await dumpAllTables(world.database)
    for (const value of ['1234567891', '123-45-67891', '비밀상호표식', '비밀대표표식', 'secret-mail@shop.kr']) expect(dump).not.toContain(value)
    const view = await client(world, seller.cookie).get('/api/billing')
    expect(view.text).toContain('123-45-*****')
    expect(view.text).not.toContain('67891')
    const logs = JSON.stringify(world.logs)
    for (const value of ['67891', '비밀상호표식', '비밀대표표식', 'secret-mail']) expect(logs).not.toContain(value)
  })
})

describe('AC-N5-39 비밀값·로그', () => {
  it('결제·웹훅·환불·증빙·사업자 정보 흐름을 지난 뒤 로그에 비밀값·사업자 정보·조회 원문이 없다', async () => {
    const world = await billingWorld()
    const seller = await addSeller(world)
    const paid = await buy(world, seller, 'days-10', 'TRANSFER')
    fake(world).portone.lookupFailure = true
    const pending = (await order(world, seller, 'days-1')).body.paymentId as string
    await client(world, seller.cookie).post(`/api/billing/orders/${pending}/confirm`, { requestId: rid('c') })
    fake(world).portone.lookupFailure = false
    fake(world).portone.cancelFailure = true
    await client(world, seller.cookie).post(`/api/billing/orders/${paid}/refund`, { requestId: rid('r') })
    fake(world).portone.cancelFailure = false
    await client(world, seller.cookie).post(`/api/billing/orders/${paid}/refund`, { requestId: rid('r') })
    await world.server.app.request('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'v1,x' }, body: '{}' })
    const logs = JSON.stringify(world.logs)
    expect(world.logs.length).toBeGreaterThan(0)
    for (const value of ['test-portone-api-secret', 'whsec_', '67891', '다육 상회', '김대표', 'PaymentMethod', 'storeId', paid, pending]) expect(logs).not.toContain(value)
    expect(await dumpAllTables(world.database)).not.toMatch(/test-portone-api-secret|whsec_/)
  })
})
