// AC-I2-60 백업 파일 형식, AC-I2-61 매일 자동 백업·보관·상태, AC-I2-62 복구·가져오기, AC-I2-63 백업 → 복구 리허설, AC-I2-64 전체 내려받기
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BACKUP_RETENTION_MS,
  FolderBackupStorage,
  backupDigest,
  backupEventDigest,
  buildBackup,
  checkBackupBytes,
  encodeBackup,
  executableOutboxCount,
  restoreSeller,
  type BackupFile,
  type BackupStorage,
} from '../src/backup.ts'
import { checkReplay } from '../src/check-replay.ts'
import { fillScope } from '../src/e2e.ts'
import { randomIds } from '../src/ids.ts'
import { formatLog } from '../src/log.ts'
import { at, chat, getFile, kst, ok, pack, post, putShop, sellG201 } from './i2-support.ts'
import { addSeller, client, createBroadcast, dumpAllTables, fakeClock, login, newWorld, rid, startServer, type Seller, type TestServer } from './support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-backup-test-'))
  dirs.push(dir)
  return dir
}

async function backupWorld(start = kst('2026-10-17', '09:00:00')) {
  const storage = new FolderBackupStorage(tempDir())
  const world = await newWorld({ clock: fakeClock(start), backupStorage: storage })
  return { world, storage }
}

const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
const reencode = (file: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))

/** 백업에 들어가는 판매: 실제 범위 둘·리허설 범위 하나, 상품(가져오기 포함)·채팅·문자찜(전화번호 있음·없음)·방송자 조치·합치기·정산 기록·포장·배송·가게 설정 */
async function richSales(world: TestServer, seller: Seller): Promise<{ sms: string }> {
  await putShop(world, seller)
  const { b1, sms } = await sellG201(world, seller, '2026-10-18')
  at(world, '2026-10-18', '22:30:00')
  await ok(world, seller, { type: 'settlement.refund', buyer: 'UC_A', date: '2026-10-18', amount: 1000, reason: '부분 환불' }, '2026-10-18')
  await ok(world, seller, { type: 'host.blockBuyer', buyer: 'UC_BAD', reason: '욕설' }, '2026-10-18')
  expect((await pack(world, seller, '2026-10-18', { buyer: sms, action: 'pack', items: [`${b1}/31`] })).status).toBe(200)
  expect((await pack(world, seller, '2026-10-18', { buyer: sms, action: 'ship', invoice: '123456789012' })).status).toBe(200)
  at(world, '2026-10-19', '20:00:00')
  const d19 = (await createBroadcast(world, seller, { date: '2026-10-19', title: '19일' })).id
  expect((await post(world, seller, `/api/broadcasts/${d19}/import`, { requestId: rid('imp'), rows: [{ no: 1, name: '가져옴', price: 1000 }, { no: 2, name: '둘', price: 2000 }] })).status).toBe(200)
  await ok(world, seller, { type: 'product.open', b: d19, no: 1 })
  await ok(world, seller, { type: 'product.open', b: d19, no: 2 })
  await chat(world, seller, d19, 'n1', 'UC_A', '길동이', '1')
  const phoneless = (await ok(world, seller, { type: 'sms', b: d19, no: 2, received: '20:01', memo: '현장' })).body.buyer as string
  await ok(world, seller, { type: 'buyer.merge', from: phoneless, into: 'UC_A', reason: '같은 사람' }, '2026-10-19')
  await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_A', date: '2026-10-19', mode: 'FIXED', amount: 2500 }, '2026-10-19')
  await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: '2026-10-19', amount: 5500 }, '2026-10-19')
  await post(world, seller, `/api/broadcasts/${d19}/end`, { requestId: rid('end') })
  const r = (await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })).id
  await ok(world, seller, { type: 'product.register', b: r, no: 5, name: '연습', price: 1000 })
  await chat(world, seller, r, 'r1', 'sim_x', '연습손님', '5')
  return { sms }
}

/** "모든 조회": 방송 목록, 날짜마다 범위 보기·조치 기록·포장 목록, 가게 설정, 판매 규칙 설정, 확인서 데이터, 판매대장 행, 지난 구매 */
async function allQueries(world: TestServer, seller: Seller, options: { withActors?: boolean } = {}): Promise<string> {
  const api = client(world, seller.cookie)
  const out: Record<string, unknown> = {}
  out.broadcasts = (await api.get('/api/broadcasts')).body
  out.shop = (await api.get('/api/shop')).body
  out.settings = (await api.get('/api/settings')).body
  for (const rehearsal of [false, true]) {
    const days = ((await api.get(`/api/days${rehearsal ? '?rehearsal=true' : ''}`)).body.days as { date: string }[]).map((day) => day.date)
    for (const date of days) {
      const q = rehearsal ? '?rehearsal=true' : ''
      const view = (await api.get(`/api/days/${date}${q}`)).body
      out[`view ${date} ${String(rehearsal)}`] = view
      const history = (await api.get(`/api/days/${date}/history?limit=500${rehearsal ? '&rehearsal=true' : ''}`)).body.events as Record<string, unknown>[]
      out[`history ${date} ${String(rehearsal)}`] = options.withActors === false ? history.map(({ actor: _actor, ...rest }) => rest) : history
      const buyers = ((view.settlements as { buyer: string; items: unknown[] }[]) ?? []).filter((s) => s.items.length > 0).map((s) => s.buyer)
      for (const buyer of buyers) {
        // 확인서의 만든 시각은 조회하는 순간의 서버 시계라 뺀다 (나머지 칸이 같아야 한다)
        const { createdAt: _createdAt, ...receipt } = (await api.get(`/api/days/${date}/receipt?buyer=${encodeURIComponent(buyer)}${rehearsal ? '&rehearsal=true' : ''}`)).body
        out[`receipt ${date} ${buyer}`] = receipt
        if (!rehearsal) out[`past ${date} ${buyer}`] = (await api.get(`/api/days/${date}/past?buyer=${encodeURIComponent(buyer)}`)).body
      }
      if (!rehearsal) out[`packing ${date}`] = (await api.get(`/api/days/${date}/packing`)).body
    }
  }
  const ledger = await getFile(world, seller.cookie, '/api/ledger.xlsx?from=2026-10-01&to=2026-10-31')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(ledger.bytes) as unknown as ArrayBuffer)
  out.ledger = workbook.worksheets[0]?.getSheetValues()
  return JSON.stringify(out)
}

describe('AC-I2-60 백업 파일 형식', () => {
  it('gzip JSON: 형식 이름·번호·만든 시각·판매자 ID·가게 설정·판매 규칙 설정·모든 범위(실제·리허설)의 방송과 이벤트 전부·포장 기록·요약값', async () => {
    const { world } = await backupWorld()
    const seller = await addSeller(world)
    await client(world, seller.cookie).patch('/api/settings', { settings: { 'shipping.baseFee': 3500 } })
    await richSales(world, seller)
    // 로그인 시도 기록이 남게 한 번 틀린다
    expect((await client(world, null).post('/api/login', { loginId: seller.loginId, password: 'wrong-password-1' })).status).toBe(401)
    world.clock.set(Date.UTC(2026, 9, 19, 19, 0, 0))
    const file = await buildBackup(world.database.db, seller.sellerId, world.clock.now())
    expect(Object.keys(file)).toEqual(['format', 'version', 'createdAt', 'sellerId', 'shop', 'settings', 'scopes', 'packing', 'digest'])
    expect(file).toMatchObject({ format: 'livejjim-seller-backup', version: 1, createdAt: '2026-10-19T19:00:00.000Z', sellerId: seller.sellerId, settings: { 'shipping.baseFee': 3500 } })
    expect(file.shop).toEqual({ name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' })
    expect(file.scopes.map((scope) => [scope.date, scope.rehearsal])).toEqual([
      ['2026-10-18', false],
      ['2026-10-19', false],
      ['2026-10-19', true],
    ])
    const dbEvents = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1`, [seller.sellerId])
    expect(file.scopes.reduce((sum, scope) => sum + scope.events.length, 0)).toBe(dbEvents?.rows[0]?.n)
    for (const scope of file.scopes) {
      expect(scope.events.map((event) => event.seq)).toEqual(Array.from({ length: scope.events.length }, (_, i) => i + 1))
      expect(scope.seq).toBe(scope.events.length)
      for (const event of scope.events) {
        expect(Object.keys(event)).toEqual(['seq', 'type', 'body', 'at', 'receivedAt', 'actor', 'accountId', 'requestId', 'failed', 'digest'])
        expect(event.digest).toBe(backupEventDigest(scope.date, scope.rehearsal, event.seq, event.type, event.body, event.failed))
      }
    }
    expect(file.scopes[1]?.broadcasts).toEqual([expect.objectContaining({ title: '19일', endedAt: expect.any(String) })])
    expect(file.packing.map((record) => [record.kind, record.invoice])).toEqual([
      ['PACKED', null],
      ['SHIPPED', '123456789012'],
    ])
    expect(file.digest).toBe(backupDigest(file))
    // 파일 안을 찾아 없음: 비밀번호 해시·로그인 아이디·세션 토큰 해시·로그인 시도 키·판매자 전화번호 키(암호문)·마스터 키·스냅샷·발송함
    const text = JSON.stringify(file)
    const pg = world.database.pglite
    const secrets = [
      ...((await pg?.query<{ v: string }>('select password_hash as v from accounts'))?.rows ?? []),
      ...((await pg?.query<{ v: string }>('select login_id as v from accounts'))?.rows ?? []),
      ...((await pg?.query<{ v: string }>('select token_hash as v from sessions'))?.rows ?? []),
      ...((await pg?.query<{ v: string }>('select key as v from login_limits'))?.rows ?? []),
      ...((await pg?.query<{ v: string }>('select phone_key_enc as v from sellers'))?.rows ?? []),
    ].map((row) => row.v)
    expect(secrets.length).toBeGreaterThan(4)
    for (const secret of [...secrets, world.masterKey, seller.password]) expect(text).not.toContain(secret)
    expect(text).not.toContain('"snapshots"')
    expect(text).not.toContain('"outbox"')
    expect(text).not.toContain('010-1234-5678')
    expect(text).not.toContain('01012345678')
  })

  it('같은 기록이면 만든 시각 칸 말고 같은 내용 (범위는 날짜·리허설 순, 이벤트는 seq 순, 포장 기록은 기록 순)', async () => {
    const { world } = await backupWorld()
    const seller = await addSeller(world)
    await richSales(world, seller)
    const a = await buildBackup(world.database.db, seller.sellerId, Date.UTC(2026, 9, 19, 19))
    const b = await buildBackup(world.database.db, seller.sellerId, Date.UTC(2026, 9, 25, 19))
    expect({ ...a, createdAt: '' }).toEqual({ ...b, createdAt: '' })
    expect(a.digest).toBe(b.digest)
  })
})

describe('AC-I2-61 매일 자동 백업·보관·상태', () => {
  it('03:59:59 확인 → 안 만듦, 04:00 → 만듦, 같은 날 다시 → 안 만듦, 다시 켠 뒤 첫 확인 → 그날 것이 있으면 안 만듦, 다음 날 04:00 → 만듦 (기록 없는 판매자도)', async () => {
    const { world, storage } = await backupWorld(kst('2026-10-20', '03:00:00'))
    const seller = await addSeller(world)
    world.clock.set(kst('2026-10-20', '03:59:59'))
    expect((await world.server.backups.check()).created).toEqual([])
    world.clock.set(kst('2026-10-20', '04:00:00'))
    expect((await world.server.backups.check()).created).toEqual([seller.sellerId])
    world.clock.set(kst('2026-10-20', '23:59:00'))
    expect((await world.server.backups.check()).created).toEqual([])
    const restarted = startServer(world.database, world.masterKey, { clock: world.clock, backupStorage: storage })
    expect((await restarted.server.backups.check()).created).toEqual([])
    world.clock.set(kst('2026-10-21', '04:00:01'))
    expect((await restarted.server.backups.check()).created).toEqual([seller.sellerId])
    const list = await storage.list(seller.sellerId)
    expect(list.map((entry) => [entry.kind, new Date(entry.createdAt).toISOString()])).toEqual([
      ['daily', '2026-10-20T19:00:01.000Z'],
      ['daily', '2026-10-19T19:00:00.000Z'],
    ])
    // 파일 이름에 판매자 이름·구매자 정보가 없다 — 판매자마다 따로(폴더 = 판매자 ID)
    for (const entry of list) expect(entry.name).toMatch(/^daily-\d{8}T\d{9}Z\.json\.gz$/)
    expect(checkBackupBytes(await storage.read(seller.sellerId, list[0]?.name ?? '')).ok).toBe(true)
  })

  it('켜 있다 꺼진 날(04:00 뒤 첫 확인이 다음 날 오후)도 그날 것이 없으면 만든다', async () => {
    const { world } = await backupWorld(kst('2026-10-20', '03:00:00'))
    const seller = await addSeller(world)
    world.clock.set(kst('2026-10-22', '15:00:00'))
    expect((await world.server.backups.check()).created).toEqual([seller.sellerId])
  })

  it('보관: 만든 지 30×24시간이 지난 파일은 지우고, 판매자마다 가장 최근 파일 하나는 늘 남긴다', async () => {
    const { world, storage } = await backupWorld(kst('2026-10-20', '03:00:00'))
    const seller = await addSeller(world)
    const quiet = await addSeller(world)
    const now = kst('2026-10-20', '10:00:00')
    const bytes = encodeBackup(await buildBackup(world.database.db, seller.sellerId, now))
    await storage.write(seller.sellerId, 'daily', now - BACKUP_RETENTION_MS - 1, bytes)
    await storage.write(seller.sellerId, 'daily', now - BACKUP_RETENTION_MS, bytes)
    await storage.write(seller.sellerId, 'safety', now - 1000, bytes)
    // 오래 쉰 판매자: 아주 오래된 파일 하나뿐이어도 남긴다
    await storage.write(quiet.sellerId, 'daily', now - 90 * 24 * 3600 * 1000, bytes)
    await storage.write(quiet.sellerId, 'daily', now - 91 * 24 * 3600 * 1000, bytes)
    expect(await world.server.backups.prune(seller.sellerId, now)).toBe(1)
    expect(await world.server.backups.prune(quiet.sellerId, now)).toBe(1)
    expect((await storage.list(seller.sellerId)).map((entry) => now - entry.createdAt)).toEqual([1000, BACKUP_RETENTION_MS])
    expect((await storage.list(quiet.sellerId)).map((entry) => entry.createdAt)).toEqual([now - 90 * 24 * 3600 * 1000])
  })

  it('한 판매자의 백업이 실패해도 다른 판매자는 만든다 — 경보는 판매자 ID·까닭 종류만, 다음 확인 때 다시 한다', async () => {
    const real = new FolderBackupStorage(tempDir())
    let broken: string | null = null
    const flaky: BackupStorage = {
      list: (id) => real.list(id),
      read: (id, name) => real.read(id, name),
      remove: (id, name) => real.remove(id, name),
      write: (id, kind, createdAt, bytes) => (id === broken ? Promise.reject(new RangeError('디스크 가득')) : real.write(id, kind, createdAt, bytes)),
    }
    const world = await newWorld({ clock: fakeClock(kst('2026-10-20', '05:00:00')), backupStorage: flaky })
    const a = await addSeller(world)
    const b = await addSeller(world)
    await putShop(world, a)
    broken = a.sellerId
    const result = await world.server.backups.check()
    expect(result.failed).toEqual([a.sellerId])
    expect(result.created).toEqual([b.sellerId])
    const alert = world.logs.find((record) => record.code === 'BACKUP_FAILED')
    expect(alert).toEqual({ level: 'error', code: 'BACKUP_FAILED', seller: a.sellerId, errorKind: 'RangeError' })
    expect(world.logs.map(formatLog).join('\n')).not.toContain('초록다육')
    broken = null
    expect((await world.server.backups.check()).created).toEqual([a.sellerId])
  })

  it('저장소를 정하지 않고 켜면 시작 경보 "백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요."(판매는 그대로), 상태는 꺼짐', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    world.server.backups.start()
    expect(world.logs).toContainEqual({ level: 'warn', code: 'BACKUP_DISABLED' })
    expect(formatLog({ level: 'warn', code: 'BACKUP_DISABLED' })).toContain('백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요')
    expect((await client(world, seller.cookie).get('/api/backups')).body).toEqual({ enabled: false, retentionDays: 30, lastSuccessAt: null, backups: [] })
    expect((await createBroadcast(world, seller)).id).toMatch(/^b_/)
  })

  it('판매자는 자기 백업 목록(만든 시각·크기)·마지막 성공 시각만 본다 — 다른 판매자 것은 안 보이고, 백업 파일을 내려받는 API는 없다', async () => {
    const { world } = await backupWorld(kst('2026-10-20', '05:00:00'))
    const a = await addSeller(world)
    const b = await addSeller(world)
    await world.server.backups.check()
    world.clock.set(kst('2026-10-20', '06:00:00'))
    await world.server.backups.createNow(a.sellerId, 'safety')
    const status = (await client(world, a.cookie).get('/api/backups')).body as { enabled: boolean; lastSuccessAt: string; backups: { createdAt: string; size: number }[] }
    expect(status.enabled).toBe(true)
    expect(status.lastSuccessAt).toBe(new Date(kst('2026-10-20', '05:00:00')).toISOString())
    expect(status.backups.map((entry) => entry.createdAt)).toEqual([new Date(kst('2026-10-20', '06:00:00')).toISOString(), new Date(kst('2026-10-20', '05:00:00')).toISOString()])
    expect(status.backups.every((entry) => entry.size > 0)).toBe(true)
    expect(Object.keys(status.backups[0] ?? {}).sort()).toEqual(['createdAt', 'size'])
    expect(((await client(world, b.cookie).get('/api/backups')).body.backups as unknown[]).length).toBe(1)
    expect((await client(world, null).get('/api/backups')).status).toBe(401)
    expect((await client(world, a.cookie).get('/api/backups/download')).status).toBe(404)
  })

  it('백업을 만드는 동안 쓰기가 막히지 않고, 범위마다 한 시점의 일관된 기록이다(만든 파일이 검사를 통과한다)', async () => {
    const { world, storage } = await backupWorld(kst('2026-10-20', '05:00:00'))
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: '2026-10-20' })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    let writing = true
    const writes = (async () => {
      let n = 0
      while (writing) {
        await world.server.ingestChat(seller.sellerId, { b, id: `w${String(n)}`, ch: `UC_${String(n % 7)}`, nick: '손님', text: String((n % 3) + 1) })
        n++
        // 실제 쓰기는 HTTP 요청마다 온다 — 시험의 쓰기 고리도 매번 이벤트 고리에 차례를 넘긴다(파일 입출력이 굶지 않게)
        await new Promise((resolve) => setImmediate(resolve))
      }
      return n
    })()
    const backups = []
    for (let i = 0; i < 5; i++) backups.push(await world.server.backups.createNow(seller.sellerId, 'safety'))
    writing = false
    expect(await writes).toBeGreaterThan(0)
    for (const entry of backups) expect(checkBackupBytes(await storage.read(seller.sellerId, entry.name)).ok).toBe(true)
  })

  it('성능: 범위 10개(범위마다 상품 500·채팅 1만 건) 판매자의 백업이 60초 안', async () => {
    const { world } = await backupWorld(kst('2026-10-01', '05:00:00'))
    const seller = await addSeller(world)
    for (let day = 1; day <= 10; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`
      world.clock.set(kst(date, '10:00:00'))
      await fillScope(world.server, seller.sellerId, { date, clock: world.clock, seed: day })
      world.server.writer.forget(seller.sellerId, date)
    }
    const started = performance.now()
    const entry = await world.server.backups.createNow(seller.sellerId, 'daily')
    expect(performance.now() - started).toBeLessThan(60_000)
    expect(entry.size).toBeGreaterThan(0)
  }, 600_000)
})

describe('AC-I2-62 복구·가져오기', () => {
  async function source() {
    const { world, storage } = await backupWorld()
    const seller = await addSeller(world)
    await richSales(world, seller)
    const bytes = encodeBackup(await buildBackup(world.database.db, seller.sellerId, world.clock.now()))
    return { world, storage, seller, bytes }
  }
  const restore = (world: TestServer, sellerId: string, bytes: Uint8Array, replace = false, storage: BackupStorage | null = null) =>
    restoreSeller({ db: world.database.db, sellerId, bytes, replace, storage, clock: world.clock, ids: randomIds })

  it('손상 파일(요약값·이벤트 요약값·seq 빈틈·재생 오류·형식 번호·gzip 아님·범위 겹침·설정·포장 기록)은 아무것도 바꾸지 않는다', async () => {
    const { world, seller, bytes } = await source()
    const target = await addSeller(world)
    const before = await dumpAllTables(world.database)
    const file = decode(bytes)
    const fix = (mutate: (copy: BackupFile & Record<string, unknown>) => void, redigest = true): Uint8Array => {
      const copy = structuredClone(file) as BackupFile & Record<string, unknown>
      mutate(copy)
      if (redigest) (copy as { digest: string }).digest = backupDigest(copy)
      return reencode(copy)
    }
    const scope0 = (copy: BackupFile) => copy.scopes[0] as unknown as { events: { seq: number; body: string; digest: string; type: string; failed: boolean }[]; date: string; rehearsal: boolean; seq: number }
    const cases: [Uint8Array, RegExp][] = [
      [fix((copy) => ((copy.shop as { name: string }).name = '바뀐 이름'), false), /파일 요약값이 맞지 않아요/],
      [fix((copy) => { const e = scope0(copy).events.find((event) => event.body.includes('핑크프릴')) as { body: string }; e.body = e.body.replace('핑크프릴', '바꿈') }), /이벤트 요약값이 맞지 않아요/],
      [fix((copy) => { const s = scope0(copy); s.events.splice(2, 1); s.seq = s.events.length }), /seq가 1부터 빈틈없이 이어지지 않아요/],
      [
        fix((copy) => {
          const s = scope0(copy)
          const e = s.events.find((event) => event.type === 'product.register') as { body: string; digest: string; seq: number; type: string; failed: boolean }
          e.body = JSON.stringify({ ...JSON.parse(e.body), price: -5 })
          e.digest = backupEventDigest(s.date, s.rehearsal, e.seq, e.type, e.body, e.failed)
        }),
        /다시 계산하지 못했어요/,
      ],
      [fix((copy) => ((copy as { version: number }).version = 2)), /형식 번호/],
      [new Uint8Array(Buffer.from('not gzip')), /gzip/],
      [fix((copy) => (copy.scopes as unknown[]).push(structuredClone(copy.scopes[0]))), /두 번 있어요/],
      [fix((copy) => ((copy.settings as Record<string, unknown>)['claim.maxNumber'] = 0)), /판매 규칙 설정/],
      [fix((copy) => ((copy.packing[1] as { kind: string }).kind = 'UNPACKED')), /포장 기록 2번/],
      [fix((copy) => ((copy as { format: string }).format = 'other')), /형식 이름/],
    ]
    for (const [corrupt, reason] of cases) {
      const outcome = await restore(world, target.sellerId, corrupt)
      expect(outcome.ok, String(reason)).toBe(false)
      if (!outcome.ok) expect(outcome.reason).toMatch(reason)
      expect(await dumpAllTables(world.database)).toBe(before)
    }
    expect((await restore(world, seller.sellerId, bytes)).ok).toBe(false) // 기록이 있는 판매자 (바꾸기 없음)
  })

  it('빈 판매자로 가져오기 → 조회가 원래 판매자와 같다(판매자 ID·계정 빼고), 다시 만든 발송함은 모두 실행하지 않음, 재생 검사 통과', async () => {
    const { world, seller, bytes } = await source()
    const target = await addSeller(world)
    const outcome = await restore(world, target.sellerId, bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.safety).toBeNull()
    expect(outcome.checks.every((check) => check.ok)).toBe(true)
    expect(outcome.checks.map((check) => [check.date, check.rehearsal])).toEqual([
      ['2026-10-18', false],
      ['2026-10-19', false],
      ['2026-10-19', true],
    ])
    world.server.writer.forgetSeller(target.sellerId)
    expect(await allQueries(world, target, { withActors: false })).toBe(await allQueries(world, seller, { withActors: false }))
    expect(await executableOutboxCount(world.database.db, target.sellerId)).toBe(0)
    const rows = await world.database.pglite?.query<{ restored: boolean }>('select restored from outbox where seller_id = $1', [target.sellerId])
    expect(rows?.rows.length).toBeGreaterThan(0)
    expect(rows?.rows.every((row) => row.restored)).toBe(true)
    // 조치자 계정이 그 판매자 계정에 없으면 계정 없이 (가져온 기록)
    const history = (await client(world, target.cookie).get('/api/days/2026-10-19/history?limit=500')).body.events as { actor: { kind: string; loginId: string | null } }[]
    expect(history.filter((event) => event.actor.kind === 'account').every((event) => event.actor.loginId === null)).toBe(true)
    // 원래 판매자의 발송함 실행 대상은 그대로 (다른 판매자의 기록은 바뀌지 않는다)
    expect(await executableOutboxCount(world.database.db, seller.sellerId)).toBeGreaterThan(0)
  })

  it('기록이 있는 판매자: 바꾸기 없이 거절(아무것도 바꾸지 않음), 바꾸기 → 안전 백업을 먼저 쓰고 한 트랜잭션에 바꾼다. 저장소가 없으면 멈춘다', async () => {
    const { world, storage, seller, bytes } = await source()
    const target = await addSeller(world)
    const tb = (await createBroadcast(world, target, { date: '2026-10-25' })).id
    await ok(world, target, { type: 'product.register', b: tb, no: 1, name: '지금 기록', price: 1000 })
    const before = await dumpAllTables(world.database)
    const refused = await restore(world, target.sellerId, bytes, false, storage)
    expect(refused).toEqual({ ok: false, reason: '기록이 있는 판매자예요. 바꾸려면 --replace를 붙여 주세요(지금 기록은 먼저 백업해요).' })
    expect(await restore(world, target.sellerId, bytes, true, null)).toEqual({ ok: false, reason: '백업 저장소가 정해지지 않아 안전 백업을 만들 수 없어요. LIVEJJIM_BACKUP_DIR을 적어 주세요.' })
    expect(await dumpAllTables(world.database)).toBe(before)
    const replaced = await restore(world, target.sellerId, bytes, true, storage)
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    expect(replaced.safety).toMatch(/^safety-/)
    const safety = checkBackupBytes(await storage.read(target.sellerId, replaced.safety ?? ''))
    expect(safety.ok && safety.value.file.scopes.map((scope) => scope.date)).toEqual(['2026-10-25'])
    world.server.writer.forgetSeller(target.sellerId)
    expect(((await client(world, target.cookie).get('/api/days')).body.days as { date: string }[]).map((day) => day.date)).toEqual(['2026-10-18', '2026-10-19'])
    expect(await allQueries(world, target, { withActors: false })).toBe(await allQueries(world, seller, { withActors: false }))
  })

  it('중간에 실패하면 아무것도 바뀌지 않는다', async () => {
    const { world, storage, bytes } = await source()
    const target = await addSeller(world)
    const tb = (await createBroadcast(world, target, { date: '2026-10-25' })).id
    await ok(world, target, { type: 'product.register', b: tb, no: 1, name: '지금 기록', price: 1000 })
    const before = await dumpAllTables(world.database)
    const outcome = await restoreSeller({
      db: world.database.db,
      sellerId: target.sellerId,
      bytes,
      replace: true,
      storage,
      clock: world.clock,
      ids: randomIds,
      beforeCommit: () => {
        throw new Error('주입한 실패')
      },
    })
    expect(outcome).toEqual({ ok: false, reason: '복구 중 문제가 생겨 멈췄어요. 아무것도 바꾸지 않았어요.' })
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('판매자 ID·로그인 계정·세션·전화번호 키는 그대로 — 복구 뒤에도 로그인이 유지되고, 같은 전화번호의 새 문자찜이 복구한 문자 구매자와 이어진다', async () => {
    const { world, storage, seller, bytes } = await source()
    const b = ((await client(world, seller.cookie).get('/api/broadcasts')).body.broadcasts as { id: string; date: string }[]).find((item) => item.date === '2026-10-18')?.id as string
    // 백업 뒤 기록을 더한 다음 바꾸기 복구
    at(world, '2026-10-18', '23:30:00')
    await ok(world, seller, { type: 'product.register', b, no: 77, name: '백업 뒤', price: 7000 })
    const restored = await restore(world, seller.sellerId, bytes, true, storage)
    expect(restored.ok).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    expect((await client(world, seller.cookie).get('/api/me')).status).toBe(200)
    const view = (await client(world, seller.cookie).get('/api/days/2026-10-18')).body
    expect((view.products as { no: number }[]).map((product) => product.no)).not.toContain(77)
    await ok(world, seller, { type: 'product.register', b, no: 78, name: '새 상품', price: 1000 })
    const sms = await ok(world, seller, { type: 'sms', b, no: 78, received: '23:31', phone: '010 1234 5678' })
    const original = (view.buyers as { id: string; phoneLast4: string | null }[]).find((buyer) => buyer.phoneLast4 === '5678')?.id
    expect(sms.body.buyer).toBe(original)
  })
})

describe('AC-I2-63 백업 → 복구 리허설 (SPEC §8 2단계)', () => {
  it('판매 → 04:00 자동 백업 → 기록을 더 함 → 바꾸기 복구 → 모든 조회가 백업 때와 같고 발송함 실행 대상 0·재생 검사 통과 → 안전 백업으로 다시 복구하면 첫 복구 직전과 같다', async () => {
    const { world, storage } = await backupWorld()
    const seller = await addSeller(world)
    const { sms } = await richSales(world, seller)
    world.clock.set(kst('2026-10-20', '04:00:00'))
    const atBackup = await allQueries(world, seller)
    expect((await world.server.backups.check()).created).toEqual([seller.sellerId])
    const daily = (await storage.list(seller.sellerId))[0]
    // 기록을 더 함 (판매·포장)
    world.clock.set(kst('2026-10-20', '10:00:00'))
    const again = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const d20 = (await createBroadcast(world, again, { date: '2026-10-20' })).id
    await ok(world, again, { type: 'product.register', b: d20, no: 9, name: '더 판 것', price: 9000 })
    await chat(world, again, d20, 'more', 'UC_A', '길동이', '9')
    expect((await pack(world, again, '2026-10-18', { buyer: sms, action: 'unship' })).status).toBe(200)
    const beforeRestore = await allQueries(world, again)
    expect(beforeRestore).not.toBe(atBackup)
    const first = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes: await storage.read(seller.sellerId, daily?.name ?? ''), replace: true, storage, clock: world.clock, ids: randomIds })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    world.server.writer.forgetSeller(seller.sellerId)
    expect(await allQueries(world, again)).toBe(atBackup)
    expect(await executableOutboxCount(world.database.db, seller.sellerId)).toBe(0)
    expect((await checkReplay(world.database.db, { sellerId: seller.sellerId })).every((check) => check.ok)).toBe(true)
    // 안전 백업으로 다시 바꾸기 복구 → 첫 복구 직전의 조회
    const second = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes: await storage.read(seller.sellerId, first.safety ?? ''), replace: true, storage, clock: world.clock, ids: randomIds })
    expect(second.ok).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    expect(await allQueries(world, again)).toBe(beforeRestore)
  }, 120_000)
})

describe('AC-I2-64 판매자 전체 내려받기 (JSON)', () => {
  it('세션의 판매자 것만, 백업과 같은 형식(gzip), 이름 라이브찜-전체기록-<KST 날짜>.json.gz, 기록이 없어도 만든다, 빈 판매자에 가져오면 조회가 같다', async () => {
    const { world, seller } = await (async () => {
      const made = await backupWorld()
      const s = await addSeller(made.world)
      await richSales(made.world, s)
      return { world: made.world, seller: s }
    })()
    world.clock.set(Date.UTC(2026, 9, 20, 15, 30))
    const again = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const file = await getFile(world, again.cookie, '/api/export/records.json.gz')
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/gzip')
    expect(file.headers.get('cache-control')).toBe('no-store')
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(file.headers.get('content-disposition') ?? '')?.[1] ?? '')).toBe('라이브찜-전체기록-2026-10-21.json.gz')
    const checked = checkBackupBytes(file.bytes)
    expect(checked.ok).toBe(true)
    expect(checked.ok && checked.value.file.sellerId).toBe(seller.sellerId)
    const empty = await addSeller(world)
    const emptyFile = await getFile(world, empty.cookie, '/api/export/records.json.gz')
    const emptyChecked = checkBackupBytes(emptyFile.bytes)
    expect(emptyChecked.ok && emptyChecked.value.file.scopes).toEqual([])
    expect(emptyChecked.ok && emptyChecked.value.file.sellerId).toBe(empty.sellerId)
    const imported = await restoreSeller({ db: world.database.db, sellerId: empty.sellerId, bytes: file.bytes, replace: false, storage: null, clock: world.clock, ids: randomIds })
    expect(imported.ok).toBe(true)
    world.server.writer.forgetSeller(empty.sellerId)
    expect(await allQueries(world, empty, { withActors: false })).toBe(await allQueries(world, again, { withActors: false }))
    expect((await client(world, null).get('/api/export/records.json.gz')).status).toBe(401)
  })
})
