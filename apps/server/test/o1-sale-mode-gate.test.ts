// RA-O1-01 막음 풀기 (O2): O1에서는 옵션 방송(claim.parseMode=OPTIONS)을 코어만 알아서 판매 규칙 설정 저장·백업 복원·방송 만들기에서
// 400/422 NOT_SUPPORTED로 막았다(apps/server/src/sale-mode.ts). O2가 서버·화면에 옵션·수량·확인 필요를 넣었으므로 막음을 뺐다
// (sale-mode.ts 머리 주석 "O2에서 풂: 이 파일과 부르는 곳을 함께 뺀다"). 이 파일은 O1의 "막는다" 계약을 O2의 "받아들인다" 계약으로 바꾼다 —
// 약화가 아니라 계약 교체다. 같은 세 입구를 같은 방식으로 두드리고, 막음이 풀렸는지·다른 검사(옵션 방식 + 실제 시각순, AC-O2-03)는 그대로인지 본다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { backupDigest, backupEventDigest, createBackupBytes, restoreSeller, type BackupFile } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { addSeller, client, countRows, createBroadcast, expectOk, newWorld, rid, writeEvent } from './support.ts'

const OPTIONS_SETTINGS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const

describe('RA-O1-01 막음 풀기 — 막던 파일이 없다', () => {
  it('apps/server/src/sale-mode.ts(아직 쓸 수 없는 판매 방식 목록)를 뺐다', () => {
    expect(existsSync(new URL('../src/sale-mode.ts', import.meta.url))).toBe(false)
  })
})

describe('RA-O1-01 막음 풀기 — 판매 규칙 설정 저장', () => {
  it('OPTIONS로 바꾸기를 받고, 함께 보낸 다른 설정도 저장한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS' } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'claim.parseMode': 'OPTIONS' } })
    await expectOk(api.patch('/api/settings', { settings: { 'waitlist.max': 0, 'claim.parseMode': 'OPTIONS', 'claim.maxQuantity': 5 } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'waitlist.max': 0, 'claim.parseMode': 'OPTIONS', 'claim.maxQuantity': 5 } })
  })

  it('이미 OPTIONS가 저장돼 있어도 다른 설정을 바꿀 수 있다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await world.database.pglite?.query(`update sellers set settings = $1 where id = $2`, [JSON.stringify({ 'claim.parseMode': 'OPTIONS' }), seller.sellerId])
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'waitlist.max': 0 } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'claim.parseMode': 'OPTIONS', 'waitlist.max': 0 } })
  })

  it('막음을 뺀 뒤에도 옵션 방식 + 실제 시각순은 400이고 설정이 바뀌지 않는다 (AC-O2-03, R-19 "판매 방식")', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const together = await api.patch('/api/settings', { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'RECEIVED_TIME' } })
    expect(together.status).toBe(400)
    expect((together.body.error as { code: string }).code).toBe('INVALID_INPUT')
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
  })
})

describe('RA-O1-01 막음 풀기 — 방송 만들기', () => {
  it('저장된 설정이 OPTIONS면 실제·리허설 방송 모두 만들고 스냅샷이 OPTIONS다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await world.database.pglite?.query(`update sellers set settings = $1 where id = $2`, [JSON.stringify(OPTIONS_SETTINGS), seller.sellerId])
    const api = client(world, seller.cookie)
    for (const extra of [{}, { rehearsal: true }]) {
      const response = await api.post('/api/broadcasts', { requestId: rid(), ...extra })
      expect(response.status, response.text).toBe(200)
    }
    expect(await countRows(world.database, 'broadcasts')).toBe(2)
    const result = await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'broadcast.start'`)
    const snapshots = (result?.rows ?? []).map((row) => (JSON.parse(row.body) as { settings: Record<string, unknown> }).settings['claim.parseMode'])
    expect(snapshots).toEqual(['OPTIONS', 'OPTIONS'])
  })

  it('STRICT·LOOSE 방송은 그대로 만든다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.parseMode': 'LOOSE' } }))
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
  })
})

describe('RA-O1-01 막음 풀기 — 백업 복원', () => {
  const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
  const reencode = (file: unknown): Uint8Array => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))

  async function source(options = false) {
    const world = await newWorld()
    const seller = await addSeller(world)
    const response = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), ...(options ? { saleMode: 'OPTIONS' } : {}) })
    expect(response.status, response.text).toBe(200)
    const b = response.body.broadcast as { id: string }
    const product = options
      ? { type: 'product.register', b: b.id, no: 1, name: '반바지', price: 15000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }], stocks: { S: 1, M: 1 } }
      : { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }
    await expectOk(writeEvent(world, seller, product))
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    // 방송 ID는 서버 전체에서 유일해서(RA-I2-002) 원래 기록이 없는 다른 서버로 가져온다
    const other = await newWorld()
    const target = await addSeller(other)
    const restore = (file: Uint8Array) => restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes: file, replace: false, storage: null, clock: other.clock, ids: randomIds })
    return { world: other, target, bytes, restore }
  }

  it('파일의 판매 규칙 설정이 OPTIONS여도 복원한다', async () => {
    const { world, target, bytes, restore } = await source()
    const copy = structuredClone(decode(bytes)) as BackupFile & { settings: Record<string, unknown>; digest: string }
    copy.settings = { ...copy.settings, 'claim.parseMode': 'OPTIONS' }
    copy.digest = backupDigest(copy)
    const outcome = await restore(reencode(copy))
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect((await client(world, target.cookie).get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'claim.parseMode': 'OPTIONS' } })
  })

  it('방송 시작 이벤트의 설정 스냅샷이 OPTIONS여도 복원한다', async () => {
    const { bytes, restore } = await source()
    const copy = structuredClone(decode(bytes)) as BackupFile & { digest: string }
    const scope = copy.scopes[0] as unknown as { date: string; rehearsal: boolean; events: { seq: number; type: string; body: string; digest: string; failed: boolean }[] }
    const start = scope.events.find((event) => event.type === 'broadcast.start')
    if (start === undefined) throw new Error('방송 시작 이벤트가 없다')
    const body = JSON.parse(start.body) as { settings: Record<string, unknown> }
    start.body = JSON.stringify({ ...body, settings: { ...body.settings, ...OPTIONS_SETTINGS } })
    start.digest = backupEventDigest(scope.date, scope.rehearsal, start.seq, start.type, start.body, start.failed)
    copy.digest = backupDigest(copy)
    const outcome = await restore(reencode(copy))
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
  })

  it('실제 옵션 방송(옵션 상품 포함)의 백업을 그대로 복원하고, 방송 스냅샷이 OPTIONS로 남는다', async () => {
    const { world, bytes, restore } = await source(true)
    const outcome = await restore(bytes)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    const result = await world.database.pglite?.query<{ body: string }>(`select body from events where type = 'broadcast.start'`)
    expect((result?.rows ?? []).map((row) => (JSON.parse(row.body) as { settings: Record<string, unknown> }).settings['claim.parseMode'])).toEqual(['OPTIONS'])
  })

  it('OPTIONS가 없는 파일은 그대로 복원한다', async () => {
    const { bytes, restore } = await source()
    expect((await restore(bytes)).ok).toBe(true)
  })
})
