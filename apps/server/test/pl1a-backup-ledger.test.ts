// PL1A 감사 minor 수정 (SA-PL1A-02, RA-PL1A-02·SA-PL1A-04·TD-PL1A-003):
// (1) 이스케이프로 숨긴 `__proto__` 칸(`"__proto__"`)도 장부 안 __proto__로 거절한다.
// (2) 백업 파일 검사는 봉인 날짜 문서와 같은 기준(sealed-state.ts stateFromLedger)으로 장부를 본다 — 문서가 못 읽는 장부(찜 금액 ≠ 단가 × 수량,
//     1등 짝이 없음, 다시 세운 값 ≠ 장부 값)는 바꾸기 복구·빈 판매자 가져오기 모두 거절하고 아무것도 바꾸지 않는다.
//     같은 장부를 DB에 직접 넣으면 그 날짜 문서가 500 LEDGER_UNREADABLE이 된다 — 두 기준이 같은지 확인한다.
import { rmSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, SEALED_BACKUP_MESSAGES, backupDigest, checkBackupBytes, restoreSeller, type BackupFile, type BackupScope } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { sha256Hex } from '../src/secrets.ts'
import { getFile } from './i2-support.ts'
import { A, AFTER_SEAL, X, scenario, scopeRowOf, sealA, tempDir, tempDirs } from './pl1a-support.ts'
import { addSeller, client, dumpAllTables, fakeClock, newWorld } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Row = Record<string, unknown>
const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
const reencode = (file: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))
const resign = (file: BackupFile): Uint8Array => reencode({ ...file, digest: backupDigest(file) })
const UNREADABLE_TEXT = '30일이 지나 봉인한 기록을 읽지 못했어요. 운영자에게 알려 주세요.'

/** 장부를 바꾼 경우들 (장부 요약값·파일 요약값은 다시 계산 — 요약값 검사는 통과한다) */
function brokenLedgers(ledgerText: string): [string, string][] {
  const ledger = JSON.parse(ledgerText) as Row
  const sales = ledger.sales as Row[]
  const products = ledger.products as Row[]
  const buyers = ledger.buyers as Row[]
  const first = sales[0] as Row
  const winnerProduct = products.findIndex((product) => Array.isArray(product.winners) && (product.winners as unknown[]).length > 0)
  expect(winnerProduct).toBeGreaterThanOrEqual(0)
  const mapAt = <T>(list: T[], index: number, change: (item: T) => T): T[] => list.map((item, i) => (i === index ? change(item) : item))
  return [
    // 찜 금액 ≠ 단가 × 수량 (readLedger는 정수인지만 본다)
    ['찜 금액 ≠ 단가 × 수량', JSON.stringify({ ...ledger, sales: mapAt(sales, 0, (sale) => ({ ...sale, amount: (first.amount as number) + 1000 })) })],
    // 1등 목록에 판매가 없는 구매자 — 1등 짝을 찾지 못함
    ['1등 짝 없음', JSON.stringify({ ...ledger, products: mapAt(products, winnerProduct, (product) => ({ ...product, winners: ['UC_NOBODY'] })) })],
    // 다시 세운 구매자 소계 ≠ 장부의 소계 (matchesLedger)
    ['구매자 소계가 장부와 다름', JSON.stringify({ ...ledger, buyers: mapAt(buyers, 0, (buyer) => ({ ...buyer, subtotal: (buyer.subtotal as number) + 1 })) })],
    // 판매 행을 하나 빼면 1등 목록과 판매가 맞지 않음
    ['판매 하나 뺌', JSON.stringify({ ...ledger, sales: sales.slice(1) })],
  ]
}

describe('SA-PL1A-02 이스케이프로 숨긴 __proto__ 칸', () => {
  it('맨 위·판매 행·방송 행의 "\\u005f_proto__"·"__\\u0070roto__"는 읽을 수 없는 장부로 거절, 이스케이프만 있고 그 칸이 없는 장부는 통과', async () => {
    const s = await scenario()
    s.world.clock.set(AFTER_SEAL)
    await sealA(s.world)
    const bytes = (await getFile(s.world, s.seller.cookie, '/api/export/records.json.gz')).bytes
    const file = decode(bytes)
    const scope = file.scopes.find((item) => item.date === A && !item.rehearsal) as BackupScope
    const sealed = scope.sealed as NonNullable<BackupScope['sealed']>
    expect(sealed.ledger.includes('\\u')).toBe(false)
    const reLedger = (ledger: string): Uint8Array => {
      expect(ledger).not.toBe(sealed.ledger)
      return resign({ ...file, scopes: file.scopes.map((item) => (item === scope ? { ...item, sealed: { ...sealed, ledger, ledgerDigest: sha256Hex(ledger) } } : item)) })
    }
    const cases: [string, string][] = [
      ['맨 위', sealed.ledger.replace(/^\{/, '{"\\u005f_proto__":{"date":"2026-08-15"},')],
      ['판매 행', sealed.ledger.replace('"sales":[{', '"sales":[{"__\\u0070roto__":{"amount":1},')],
      ['방송 행', sealed.ledger.replace('"broadcasts":[{', '"broadcasts":[{"\\u005F\\u005Fproto\\u005F\\u005F":{"id":"x"},')],
    ]
    for (const [label, ledger] of cases) {
      expect(ledger.includes('__proto__'), label).toBe(false)
      expect(await checkBackupBytes(reLedger(ledger)), label).toEqual({ ok: false, reason: SEALED_BACKUP_MESSAGES.unreadable(A) })
    }
    // 이스케이프 글자만 있고 __proto__ 칸이 없는 장부 — 지름길을 지나 끝까지 읽어도 거절하지 않는다(늘 거절하는 구현이 아니다)
    const harmless = sealed.ledger.replace('"format":', '"note":"\\u0041","format":')
    expect(harmless.includes('\\u')).toBe(true)
    expect((await checkBackupBytes(reLedger(harmless))).ok).toBe(true)
    // 바른 파일은 통과
    expect((await checkBackupBytes(bytes)).ok).toBe(true)
  })
})

describe('RA-PL1A-02 · SA-PL1A-04 · TD-PL1A-003 백업 검사와 봉인 날짜 문서가 같은 기준으로 장부를 본다', () => {
  it('문서가 못 읽는 장부는 검사·바꾸기 복구·빈 판매자 가져오기 모두 읽을 수 없는 장부 문장으로 거절, 기록·백업 목록 그대로. 같은 장부를 DB에 넣으면 문서는 500', async () => {
    const s = await scenario()
    s.world.clock.set(AFTER_SEAL)
    await sealA(s.world)
    const bytes = (await getFile(s.world, s.seller.cookie, '/api/export/records.json.gz')).bytes
    const file = decode(bytes)
    const scope = file.scopes.find((item) => item.date === A && !item.rehearsal) as BackupScope
    const sealed = scope.sealed as NonNullable<BackupScope['sealed']>
    const reLedger = (ledger: string): Uint8Array =>
      resign({ ...file, scopes: file.scopes.map((item) => (item === scope ? { ...item, sealed: { ...sealed, ledger, ledgerDigest: sha256Hex(ledger) } } : item)) })

    const other = await newWorld({ clock: fakeClock(s.world.clock.now()), backupStorage: new FolderBackupStorage(tempDir()) })
    const empty = await addSeller(other)
    const dumpBefore = await dumpAllTables(s.world.database)
    const listBefore = await s.storage.list(s.seller.sellerId)
    const otherBefore = await dumpAllTables(other.database)
    const reason = SEALED_BACKUP_MESSAGES.unreadable(A)
    const cases = brokenLedgers(sealed.ledger)
    for (const [label, ledger] of cases) {
      const broken = reLedger(ledger)
      expect(await checkBackupBytes(broken), label).toEqual({ ok: false, reason })
      expect(await restoreSeller({ db: s.world.database.db, sellerId: s.seller.sellerId, bytes: broken, replace: true, storage: s.storage, clock: s.world.clock, ids: randomIds }), label).toEqual({ ok: false, reason })
      expect(await restoreSeller({ db: other.database.db, sellerId: empty.sellerId, bytes: broken, replace: false, storage: null, clock: other.clock, ids: randomIds }), label).toEqual({ ok: false, reason })
    }
    expect(await dumpAllTables(s.world.database)).toBe(dumpBefore)
    expect(await s.storage.list(s.seller.sellerId)).toEqual(listBefore)
    expect(await dumpAllTables(other.database)).toBe(otherBefore)
    // 바른 파일은 통과하고, 빈 판매자로 가져오면 그 날짜 문서가 읽힌다
    expect((await checkBackupBytes(bytes)).ok).toBe(true)
    expect((await restoreSeller({ db: other.database.db, sellerId: empty.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })).ok).toBe(true)
    expect((await client(other, empty.cookie).get(`/api/days/${A}/receipt?buyer=${X}`)).status).toBe(200)

    // 같은 장부를 DB에 직접 넣으면 봉인 날짜 문서는 읽지 못한다 — 백업 검사가 거절한 장부 = 문서가 못 읽는 장부
    const row = await scopeRowOf(s.world, s.seller, A)
    const api = client(s.world, s.seller.cookie)
    expect((await api.get(`/api/days/${A}/receipt?buyer=${X}`)).status).toBe(200)
    for (const [label, ledger] of cases) {
      await s.world.database.pglite?.query(`update scopes set ledger = $1, ledger_digest = $2 where id = $3`, [ledger, sha256Hex(ledger), row?.id])
      const response = await api.get(`/api/days/${A}/receipt?buyer=${X}`)
      expect(response.status, label).toBe(500)
      expect(response.body.error, label).toEqual({ code: 'LEDGER_UNREADABLE', message: UNREADABLE_TEXT })
    }
  })
})
