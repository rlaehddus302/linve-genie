// PL1A 봉인 범위의 백업·전체 기록·복구 (D-PL1-01, D-I2-22 (1)): AC-PL1A-01·03~07
// 봉인 작업(Sealer)을 실제로 돌려 날짜 A를 봉인한 판매자의 자동 백업·전체 기록 파일(형식 3)을 검사·복구·가져오기 한다.
import { readFileSync, rmSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, SEALED_BACKUP_MESSAGES, backupDigest, checkBackupBytes, restoreSeller, type BackupFile, type BackupScope } from '../src/backup.ts'
import { checkReplay } from '../src/check-replay.ts'
import { randomIds } from '../src/ids.ts'
import { sha256Hex } from '../src/secrets.ts'
import { at, chat, getFile, kst, pack } from './i2-support.ts'
import { A, AFTER_SEAL, B, LOOKER_NICK, LOOKER_TEXT, X, scenario, scopeRowOf, sealA, tempDir, tempDirs, type Scenario } from './pl1a-support.ts'
import { addSeller, client, dumpAllTables, fakeClock, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SEALED_TEXT = '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.'
const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
const reencode = (file: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))
/** 고친 파일의 요약값을 다시 계산해 맞춘다 */
const resign = (file: BackupFile): Uint8Array => reencode({ ...file, digest: backupDigest(file) })
const scopeOf = (file: BackupFile, date: string, rehearsal = false): BackupScope => file.scopes.find((scope) => scope.date === date && scope.rehearsal === rehearsal) as BackupScope
const withScope = (file: BackupFile, date: string, change: (scope: BackupScope) => BackupScope, rehearsal = false): BackupFile => ({
  ...file,
  scopes: file.scopes.map((scope) => (scope.date === date && scope.rehearsal === rehearsal ? change(scope) : scope)),
})

async function sealedScenario(): Promise<Scenario> {
  const s = await scenario()
  s.world.clock.set(AFTER_SEAL)
  await sealA(s.world)
  return s
}

async function exportRecords(world: TestServer, seller: Seller): Promise<Uint8Array> {
  const response = await getFile(world, seller.cookie, '/api/export/records.json.gz')
  expect(response.status).toBe(200)
  return response.bytes
}

/** 봉인 날짜에 쓰는 요청 — 모두 409 SEALED */
async function expectWritesSealed(world: TestServer, seller: Seller, b: string): Promise<void> {
  const responses = [
    await writeEvent(world, seller, { type: 'product.register', b, no: 90, name: '새 상품', price: 1000 }),
    await writeEvent(world, seller, { type: 'sms', b, no: 15, received: '20:00' }),
    await writeEvent(world, seller, { type: 'settlement.payment', buyer: X, date: A, amount: 1000 }, A),
    await pack(world, seller, A, { buyer: X, action: 'unship' }),
  ]
  for (const response of responses) {
    expect(response.status, response.text).toBe(409)
    expect((response.body.error as { code: string; message: string }).code).toBe('SEALED')
    expect((response.body.error as { message: string }).message).toBe(SEALED_TEXT)
  }
}

/** A 범위의 스냅샷·발송함·채팅 원문 행 수 */
async function sealedLeftovers(world: TestServer, seller: Seller): Promise<number[]> {
  const row = await scopeRowOf(world, seller, A)
  const counts: number[] = []
  for (const table of ['snapshots', 'outbox', 'chat_raw']) {
    const result = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from ${table} where seller_id = $1 and scope_id = $2`, [seller.sellerId, row?.id])
    counts.push(result?.rows[0]?.n ?? -1)
  }
  return counts
}

describe('AC-PL1A-01 백업 파일에 봉인 범위를 담는다', () => {
  it('자동 백업·전체 기록 모두 형식 3. A의 sealed = 범위 행의 봉인 시각·장부(바이트 같음)·장부 요약값, A의 이벤트는 저장된 그대로, B·리허설은 null. 파일 요약값이 sealed까지 덮는다', async () => {
    const s = await sealedScenario()
    const entry = await s.world.server.backups.createNow(s.seller.sellerId, 'daily')
    const daily = decode(await s.storage.read(s.seller.sellerId, entry.name))
    const records = decode(await exportRecords(s.world, s.seller))
    const row = await scopeRowOf(s.world, s.seller, A)
    for (const file of [daily, records]) {
      expect(file.format).toBe('livejjim-seller-backup')
      expect(file.version).toBe(3)
      expect(file.scopes.map((scope) => [scope.date, scope.rehearsal, scope.sealed === null ? null : 'sealed'])).toEqual([
        [A, false, 'sealed'],
        [B, false, null],
        [B, true, null],
      ])
      const sealed = scopeOf(file, A).sealed
      expect(Object.keys(sealed ?? {})).toEqual(['sealedAt', 'ledger', 'ledgerDigest'])
      expect(sealed?.sealedAt).toBe(row?.sealed_at?.toISOString())
      expect(Buffer.from(sealed?.ledger ?? '', 'utf8').equals(Buffer.from(row?.ledger ?? '', 'utf8'))).toBe(true)
      expect(sealed?.ledgerDigest).toBe(row?.ledger_digest)
      // 이벤트는 저장된 그대로 (seq 1부터, 이벤트마다 요약값) — 채팅 본문·이름 칸이 없다
      const stored = (await s.world.database.pglite?.query<{ seq: number; body: string }>(`select seq, body from events where scope_id = $1 order by seq`, [row?.id]))?.rows ?? []
      expect(scopeOf(file, A).events.map((event) => [event.seq, event.body])).toEqual(stored.map((event) => [event.seq, event.body]))
      for (const event of scopeOf(file, A).events.filter((item) => item.type === 'chat')) {
        expect(Object.keys(JSON.parse(event.body) as object)).not.toContain('text')
        expect(Object.keys(JSON.parse(event.body) as object)).not.toContain('nick')
      }
      const text = JSON.stringify(file)
      expect(text).not.toContain(LOOKER_TEXT)
      expect(text).not.toContain(LOOKER_NICK)
      expect(file.digest).toBe(backupDigest(file))
      // 봉인 칸 한 글자만 바꾸면 파일 요약값이 맞지 않는다
      const touched = withScope(file, A, (scope) => ({ ...scope, sealed: { ...(scope.sealed as NonNullable<BackupScope['sealed']>), sealedAt: (scope.sealed?.sealedAt ?? '').replace(/\d(?=Z$)/, (c) => (c === '1' ? '2' : '1')) } }))
      expect(backupDigest(touched)).not.toBe(file.digest)
      expect(await checkBackupBytes(reencode(touched))).toEqual({ ok: false, reason: '파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요).' })
    }
  })
})

describe('AC-PL1A-03 손상된 봉인 범위는 거절하고 아무것도 바꾸지 않는다', () => {
  it('장부·장부 요약값·seq 빈틈·이벤트 본문·모르는 판·다른 날짜·리허설 봉인·장부 방송 행 모양·장부 안 __proto__·파일 요약값 — 바꾸기 복구·빈 판매자 가져오기 모두 거절, 기록·백업 목록 그대로', async () => {
    const s = await sealedScenario()
    const bytes = await exportRecords(s.world, s.seller)
    const file = decode(bytes)
    const sealed = scopeOf(file, A).sealed as NonNullable<BackupScope['sealed']>
    const flip = (text: string, index: number): string => `${text.slice(0, index)}${text[index] === '1' ? '2' : '1'}${text.slice(index + 1)}`
    const ledgerAt = sealed.ledger.indexOf('"price":') + 8
    const unknownFormat = sealed.ledger.replace('"livejjim-ledger/2"', '"livejjim-ledger/9"')
    const otherDate = sealed.ledger.replace(`"date":"${A}"`, '"date":"2026-08-31"')
    const aEvents = scopeOf(file, A).events
    const bodyAt = aEvents[2]?.body.indexOf('"at":') ?? 0
    const ledgerJson = JSON.parse(sealed.ledger) as Record<string, unknown>
    const ledgerBroadcasts = ledgerJson.broadcasts as unknown[]
    const reLedger = (ledger: string): Uint8Array => {
      expect(ledger).not.toBe(sealed.ledger)
      return resign(withScope(file, A, (scope) => ({ ...scope, sealed: { ...sealed, ledger, ledgerDigest: sha256Hex(ledger) } })))
    }
    const cases: [string, Uint8Array, string][] = [
      ['(a) 장부 한 글자', resign(withScope(file, A, (scope) => ({ ...scope, sealed: { ...sealed, ledger: flip(sealed.ledger, ledgerAt) } }))), SEALED_BACKUP_MESSAGES.digest(A)],
      ['(b) 장부 요약값 한 글자', resign(withScope(file, A, (scope) => ({ ...scope, sealed: { ...sealed, ledgerDigest: `${sealed.ledgerDigest.slice(0, -1)}${sealed.ledgerDigest.endsWith('0') ? '1' : '0'}` } }))), SEALED_BACKUP_MESSAGES.digest(A)],
      [
        '(c) 이벤트 하나 뺌',
        resign(withScope(file, A, (scope) => ({ ...scope, events: scope.events.filter((event) => event.seq !== 3) }))),
        `범위 ${A}의 seq가 1부터 빈틈없이 이어지지 않아요(3번째).`,
      ],
      [
        '(d) 이벤트 본문 한 글자',
        resign(withScope(file, A, (scope) => ({ ...scope, events: scope.events.map((event) => (event.seq === 3 ? { ...event, body: flip(event.body, bodyAt + 6) } : event)) }))),
        `범위 ${A}의 seq 3 이벤트 요약값이 맞지 않아요(기록이 바뀌었어요).`,
      ],
      ['(e) 모르는 판', resign(withScope(file, A, (scope) => ({ ...scope, sealed: { ...sealed, ledger: unknownFormat, ledgerDigest: sha256Hex(unknownFormat) } }))), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(f) 장부의 날짜', resign(withScope(file, A, (scope) => ({ ...scope, sealed: { ...sealed, ledger: otherDate, ledgerDigest: sha256Hex(otherDate) } }))), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(g) 리허설 범위에 sealed', resign(withScope(file, B, (scope) => ({ ...scope, sealed }), true)), '리허설 범위는 봉인할 수 없어요.'],
      // TD-PL1A-001: 방송 행 모양이 틀린 장부(요약값 다시 계산) — 예외가 아니라 읽을 수 없는 장부 문장
      ['(i) 장부 방송 목록에 null', reLedger(JSON.stringify({ ...ledgerJson, broadcasts: [null, ...ledgerBroadcasts] })), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(j) 장부 방송 목록에 숫자', reLedger(JSON.stringify({ ...ledgerJson, broadcasts: [1, ...ledgerBroadcasts] })), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(k) 장부 방송 id가 숫자', reLedger(JSON.stringify({ ...ledgerJson, broadcasts: ledgerBroadcasts.map((row) => ({ ...(row as object), id: 7 })) })), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(l) 장부 방송 끝난 시각이 숫자', reLedger(JSON.stringify({ ...ledgerJson, broadcasts: ledgerBroadcasts.map((row) => ({ ...(row as object), endedAt: 0 })) })), SEALED_BACKUP_MESSAGES.unreadable(A)],
      // TD-PL1A-002: 장부 안 __proto__ 칸(맨 위·판매 행·더 안쪽)
      ['(m) 장부 맨 위 __proto__', reLedger(sealed.ledger.replace(/^\{/, '{"__proto__":{"date":"2026-08-15"},')), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(n) 판매 행 __proto__', reLedger(sealed.ledger.replace('"sales":[{', '"sales":[{"__proto__":{"amount":1},')), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(o) 방송 행 __proto__', reLedger(sealed.ledger.replace('"broadcasts":[{', '"broadcasts":[{"__proto__":{"id":"x"},')), SEALED_BACKUP_MESSAGES.unreadable(A)],
      ['(h) 파일 요약값만 틀림', reencode({ ...file, digest: file.digest.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) }), '파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요).'],
    ]
    const other = await newWorld({ clock: fakeClock(s.world.clock.now()), backupStorage: new FolderBackupStorage(tempDir()) })
    const empty = await addSeller(other)
    const dumpBefore = await dumpAllTables(s.world.database)
    const listBefore = await s.storage.list(s.seller.sellerId)
    const otherBefore = await dumpAllTables(other.database)
    for (const [label, broken, reason] of cases) {
      expect(await checkBackupBytes(broken), label).toEqual({ ok: false, reason })
      expect(await restoreSeller({ db: s.world.database.db, sellerId: s.seller.sellerId, bytes: broken, replace: true, storage: s.storage, clock: s.world.clock, ids: randomIds }), label).toEqual({ ok: false, reason })
      expect(await restoreSeller({ db: other.database.db, sellerId: empty.sellerId, bytes: broken, replace: false, storage: null, clock: other.clock, ids: randomIds }), label).toEqual({ ok: false, reason })
    }
    expect(await dumpAllTables(s.world.database)).toBe(dumpBefore)
    expect(await s.storage.list(s.seller.sellerId)).toEqual(listBefore)
    expect(await dumpAllTables(other.database)).toBe(otherBefore)
    // 바르게 만든 파일은 통과한다 (늘 거절하는 구현이 아니다)
    expect((await checkBackupBytes(bytes)).ok).toBe(true)
  })
})

describe('AC-PL1A-04 바꾸기 복구 뒤에도 A는 봉인된 날짜다', () => {
  it('안전 백업(형식 3)이 먼저 남고 B는 백업 때로, A는 봉인 시각·장부 그대로·스냅샷·발송함·채팅 원문 없음·같은 봉인 조회·쓰기 409·재생 검사 통과·봉인 작업이 다시 봉인하지 않는다', async () => {
    const s = await sealedScenario()
    const { world, seller } = s
    const api = client(world, seller.cookie)
    const entry = await world.server.backups.createNow(seller.sellerId, 'daily')
    const bytes = await s.storage.read(seller.sellerId, entry.name)
    const file = decode(bytes)
    const viewA = (await api.get(`/api/days/${A}`)).body
    const viewB = (await api.get(`/api/days/${B}`)).body
    expect(viewA.sealed).toBe(true)
    // 그 뒤 B에 찜을 하나 더
    at(world, '2026-10-01', '00:10:00')
    await chat(world, seller, s.bBroadcast, 'late1', 'UC_LATE', '늦은손님', '3')
    expect((await api.get(`/api/days/${B}`)).body).not.toEqual(viewB)
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: s.storage, clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    if (!restored.ok) return
    expect(restored.safety).not.toBeNull()
    expect(decode(await s.storage.read(seller.sellerId, restored.safety as string)).version).toBe(3)
    expect(restored.checks.map((check) => [check.date, check.rehearsal, check.ok, check.sealed])).toEqual([
      [A, false, true, true],
      [B, false, true, false],
      [B, true, true, false],
    ])
    const row = await scopeRowOf(world, seller, A)
    expect(row?.sealed_at?.toISOString()).toBe(scopeOf(file, A).sealed?.sealedAt)
    expect(row?.ledger).toBe(scopeOf(file, A).sealed?.ledger)
    expect(row?.ledger_digest).toBe(scopeOf(file, A).sealed?.ledgerDigest)
    expect(await sealedLeftovers(world, seller)).toEqual([0, 0, 0])
    expect((await api.get(`/api/days/${A}`)).body).toEqual(viewA)
    expect((await api.get(`/api/days/${B}`)).body).toEqual(viewB)
    await expectWritesSealed(world, seller, s.aBroadcasts[0] as string)
    expect((await checkReplay(world.database.db, { sellerId: seller.sellerId })).every((check) => check.ok)).toBe(true)
    expect(await world.server.sealer.runOnce()).toBe(0)
    const again = await scopeRowOf(world, seller, A)
    expect([again?.sealed_at?.toISOString(), again?.ledger]).toEqual([row?.sealed_at?.toISOString(), row?.ledger])
  })
})

describe('AC-PL1A-05 빈 판매자(다른 서버)로 가져오기', () => {
  it('가져온 서버의 시계가 A + 30일보다 앞이어도 A는 봉인된 채 들어간다(봉인 시각은 파일 값) — 같은 봉인 조회·쓰기 409·재생 검사', async () => {
    const s = await sealedScenario()
    const bytes = await exportRecords(s.world, s.seller)
    const file = decode(bytes)
    const viewA = (await client(s.world, s.seller.cookie).get(`/api/days/${A}`)).body
    const other = await newWorld({ clock: fakeClock(kst(B, '21:00:00')), backupStorage: new FolderBackupStorage(tempDir()) })
    const target = await addSeller(other)
    const restored = await restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    other.server.writer.forgetSeller(target.sellerId)
    const row = await scopeRowOf(other, target, A)
    expect(row?.sealed_at?.toISOString()).toBe(scopeOf(file, A).sealed?.sealedAt)
    expect(row?.ledger).toBe(scopeOf(file, A).sealed?.ledger)
    expect(await sealedLeftovers(other, target)).toEqual([0, 0, 0])
    expect((await client(other, target.cookie).get(`/api/days/${A}`)).body).toEqual(viewA)
    await expectWritesSealed(other, target, s.aBroadcasts[0] as string)
    expect((await checkReplay(other.database.db, { sellerId: target.sellerId })).every((check) => check.ok)).toBe(true)
    expect(await other.server.sealer.runOnce()).toBe(0)
  })
})

describe('AC-PL1A-06 형식 2 파일도 읽는다', () => {
  const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/pl1a/${name}`, import.meta.url)))
  const base = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/pl1a/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>

  it('(a) 봉인 범위가 없는 형식 2 파일(BASE 코드로 만든 것)은 BASE와 같이 통과하고 복구 결과가 같다', async () => {
    const bytes = fixture('v2-plain.json.gz')
    const expected = base('v2-plain.base.json')
    expect(decode(bytes).version).toBe(2)
    const checked = await checkBackupBytes(bytes)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.file.version).toBe(2)
    expect(checked.value.file.scopes.map(({ date, rehearsal, seq, events, broadcasts }) => ({ date, rehearsal, seq, events, broadcasts }))).toEqual(expected.check)
    expect(checked.value.file.scopes.every((scope) => !scope.sealed)).toBe(true)
    const world = await newWorld({ clock: fakeClock(kst('2026-10-18', '23:00:00')) })
    const seller = await addSeller(world)
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: false, storage: null, clock: world.clock, ids: randomIds })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect({ scopes: restored.scopes, events: restored.events, packing: restored.packing, checks: restored.checks.map((c) => ({ date: c.date, rehearsal: c.rehearsal, ok: c.ok, sealed: c.sealed, events: c.events })) }).toEqual(expected.restored)
    expect((await client(world, seller.cookie).get('/api/days/2026-10-18')).body).toEqual(expected.view)
    expect((await client(world, seller.cookie).get('/api/days/2026-10-18?rehearsal=1')).body).toEqual(expected.rehearsal)
  })

  it('(b) 봉인 범위가 든 형식 2 파일은 BASE와 같은 문장으로 거절된다 (새로 생기는 손실 없음)', async () => {
    const bytes = fixture('v2-sealed.json.gz')
    expect(decode(bytes).version).toBe(2)
    expect(await checkBackupBytes(bytes)).toEqual({ ok: false, reason: base('v2-sealed.base.json').reason })
  })
})

describe('AC-PL1A-07 봉인 전에 만든 백업을 봉인 뒤에 복구 (기존 동작 고정)', () => {
  it('A + 29일 백업(A의 sealed = null)을 A + 31일에 복구하면 A는 재생돼 들어가고, 봉인 작업 한 바퀴 뒤 다시 봉인된다 — 조회는 처음 봉인 때와 같다(봉인 시각만 다름)', async () => {
    const s = await scenario()
    const { world, seller } = s
    world.clock.set(kst('2026-09-30', '12:00:00'))
    const entry = await world.server.backups.createNow(seller.sellerId, 'daily')
    const bytes = await s.storage.read(seller.sellerId, entry.name)
    expect(scopeOf(decode(bytes), A).sealed).toBeNull()
    await sealA(world)
    const first = (await client(world, seller.cookie).get(`/api/days/${A}`)).body
    world.clock.set(kst('2026-10-02', '12:00:00'))
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: s.storage, clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    world.server.writer.forgetSeller(seller.sellerId)
    expect((await scopeRowOf(world, seller, A))?.sealed_at).toBeNull()
    expect((await client(world, seller.cookie).get(`/api/days/${A}`)).body.sealed).toBeUndefined()
    expect(await world.server.sealer.runOnce()).toBe(1)
    const second = (await client(world, seller.cookie).get(`/api/days/${A}`)).body
    expect(second.sealed).toBe(true)
    expect(second.sealedAt).not.toBe(first.sealedAt)
    expect({ ...second, sealedAt: null }).toEqual({ ...first, sealedAt: null })
    // 채팅 원문·스냅샷이 다시 지워졌다 (복구로 다시 만든 발송함 행은 봉인 작업이 지우지 않고 문구만 비운다 — 기존 동작)
    const [snapshotRows, , rawRows] = await sealedLeftovers(world, seller)
    expect([snapshotRows, rawRows]).toEqual([0, 0])
  })
})
