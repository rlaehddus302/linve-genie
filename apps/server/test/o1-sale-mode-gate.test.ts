// RA-O1-01 아직 쓸 수 없는 판매 방식: 옵션 방송(claim.parseMode=OPTIONS)은 O1에서 코어만 안다. 서버·화면·라벨이 옵션·수량을 모르므로
// O2가 들어오기 전까지 판매 규칙 설정 저장·백업 복원·방송 만들기에서 쉬운 한국어 오류로 막고 아무것도 바꾸지 않는다. O2에서 풂.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { backupDigest, backupEventDigest, createBackupBytes, restoreSeller, type BackupFile } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { NOT_YET_PARSE_MODES, usesNotYetSaleMode } from '../src/sale-mode.ts'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, rid, writeEvent } from './support.ts'

const NOT_YET = {
  error: {
    code: 'NOT_SUPPORTED',
    message: '아직 쓸 수 없는 판매 방식이에요.',
    problems: [{ field: 'settings.claim.parseMode', message: '아직 쓸 수 없어요. 엄격하게나 느슨하게 중에서 골라 주세요.' }],
  },
}

describe('RA-O1-01 아직 쓸 수 없는 판매 방식 알아보기', () => {
  it('OPTIONS만 막고 STRICT·LOOSE·빠진 값·모르는 값은 막지 않는다. 자기 속성만 본다', () => {
    expect(NOT_YET_PARSE_MODES).toEqual(['OPTIONS'])
    expect(usesNotYetSaleMode({ 'claim.parseMode': 'OPTIONS' })).toBe(true)
    expect(usesNotYetSaleMode({ ...DEFAULT_SETTINGS, 'claim.parseMode': 'OPTIONS' })).toBe(true)
    expect(usesNotYetSaleMode({ 'claim.parseMode': 'STRICT' })).toBe(false)
    expect(usesNotYetSaleMode({ 'claim.parseMode': 'LOOSE' })).toBe(false)
    expect(usesNotYetSaleMode({})).toBe(false)
    expect(usesNotYetSaleMode({ ...DEFAULT_SETTINGS })).toBe(false)
    expect(usesNotYetSaleMode({ 'claim.parseMode': ['OPTIONS'] })).toBe(false)
    expect(usesNotYetSaleMode(Object.create({ 'claim.parseMode': 'OPTIONS' }) as Record<string, unknown>)).toBe(false)
  })
})

describe('RA-O1-01 판매 규칙 설정 저장', () => {
  it('OPTIONS로 바꾸기는 400 NOT_SUPPORTED(쉬운 문장), 함께 보낸 다른 설정도 저장하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const alone = await api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS' } })
    expect(alone.status).toBe(400)
    expect(alone.body).toEqual(NOT_YET)
    const mixed = await api.patch('/api/settings', { settings: { 'waitlist.max': 0, 'claim.parseMode': 'OPTIONS', 'claim.maxQuantity': 5 } })
    expect(mixed.status).toBe(400)
    expect(mixed.body).toEqual(NOT_YET)
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
  })

  it('STRICT·LOOSE는 그대로 저장한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'LOOSE' } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'claim.parseMode': 'LOOSE' } })
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'STRICT' } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
  })

  it('이미 OPTIONS가 저장돼 있으면(이전 판의 서버) 다른 설정을 바꿔도 저장하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await world.database.pglite?.query(`update sellers set settings = $1 where id = $2`, [JSON.stringify({ 'claim.parseMode': 'OPTIONS' }), seller.sellerId])
    const api = client(world, seller.cookie)
    const response = await api.patch('/api/settings', { settings: { 'waitlist.max': 0 } })
    expect(response.status).toBe(400)
    // 고르면 풀린다 — 엄격하게로 바꾸기는 받는다
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'STRICT' } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
  })
})

describe('RA-O1-01 방송 만들기', () => {
  it('저장된 설정이 OPTIONS면 실제·리허설 방송 모두 422 NOT_SUPPORTED, 아무것도 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    // 설정 API는 OPTIONS를 막는다 — DB에 직접 넣어 방송 만들기의 막음을 확인한다
    await world.database.pglite?.query(`update sellers set settings = $1 where id = $2`, [JSON.stringify({ 'claim.parseMode': 'OPTIONS' }), seller.sellerId])
    const api = client(world, seller.cookie)
    for (const extra of [{}, { rehearsal: true }]) {
      const response = await api.post('/api/broadcasts', { requestId: rid(), ...extra })
      expect(response.status).toBe(422)
      expect(response.body).toEqual(NOT_YET)
    }
    expect(await countRows(world.database, 'events')).toBe(0)
    expect(await countRows(world.database, 'broadcasts')).toBe(0)
    expect(await countRows(world.database, 'scopes')).toBe(0)
  })

  it('STRICT·LOOSE 방송은 그대로 만든다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.parseMode': 'LOOSE' } }))
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
  })
})

describe('RA-O1-01 백업 복원', () => {
  const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
  const reencode = (file: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))

  async function source() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    // 방송 ID는 서버 전체에서 유일해서(RA-I2-002) 원래 기록이 없는 다른 서버로 가져온다
    const other = await newWorld()
    const target = await addSeller(other)
    const restore = (file: Uint8Array) => restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes: file, replace: false, storage: null, clock: other.clock, ids: randomIds })
    return { world: other, bytes, restore }
  }

  it('파일의 판매 규칙 설정이 OPTIONS면 거절하고 아무것도 바꾸지 않는다', async () => {
    const { world, bytes, restore } = await source()
    const before = await dumpAllTables(world.database)
    const copy = structuredClone(decode(bytes)) as BackupFile & { settings: Record<string, unknown>; digest: string }
    copy.settings = { ...copy.settings, 'claim.parseMode': 'OPTIONS' }
    copy.digest = backupDigest(copy)
    const outcome = await restore(reencode(copy))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('백업 파일에 아직 쓸 수 없는 판매 방식이 있어요.')
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('방송 시작 이벤트의 설정 스냅샷이 OPTIONS여도 거절하고 아무것도 바꾸지 않는다', async () => {
    const { world, bytes, restore } = await source()
    const before = await dumpAllTables(world.database)
    const copy = structuredClone(decode(bytes)) as BackupFile & { digest: string }
    const scope = copy.scopes[0] as unknown as { date: string; rehearsal: boolean; events: { seq: number; type: string; body: string; digest: string; failed: boolean }[] }
    const start = scope.events.find((event) => event.type === 'broadcast.start')
    if (start === undefined) throw new Error('방송 시작 이벤트가 없다')
    const body = JSON.parse(start.body) as { settings: Record<string, unknown> }
    start.body = JSON.stringify({ ...body, settings: { ...body.settings, 'claim.parseMode': 'OPTIONS' } })
    start.digest = backupEventDigest(scope.date, scope.rehearsal, start.seq, start.type, start.body, start.failed)
    copy.digest = backupDigest(copy)
    const outcome = await restore(reencode(copy))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('백업 파일에 아직 쓸 수 없는 판매 방식이 있어요.')
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('OPTIONS가 없는 파일은 그대로 복원한다', async () => {
    const { bytes, restore } = await source()
    expect((await restore(bytes)).ok).toBe(true)
  })
})
