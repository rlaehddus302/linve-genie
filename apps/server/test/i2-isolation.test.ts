// AC-I2-83 판매자 격리 (새 API 전부: 로그인 없으면 401, 다른 판매자의 범위·방송·구매자는 없는 것과 같은 응답), AC-I2-81 개인정보(주소·로그),
// 복구 명령 인자·실행(AC-I2-62), E2E 기동의 백업·?at= (AC-I2-15·65)
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDocumentFont, renderReceiptPng, type ReceiptData } from '@livejjim/documents'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, createBackupBytes } from '../src/backup.ts'
import { parseRestoreArgs } from '../src/commands/restore-args.ts'
import { openPglite } from '../src/db/database.ts'
import { startE2eServer } from '../src/e2e.ts'
import { formatLog } from '../src/log.ts'
import { fontBytes } from '../../../packages/documents/test/helpers.ts'
import { chat, getFile, ok, pack, post, putShop } from './i2-support.ts'
import { FAST_COST, ORIGIN, addSeller, client, createBroadcast, newWorld, rid } from './support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('AC-I2-83 판매자 격리 — 새 API 전부', () => {
  it('로그인이 없으면 401, 다른 판매자의 범위·방송·구매자는 없는 것과 같은 응답', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    const bc = (await createBroadcast(world, a, { date: '2026-10-19' })).id
    await ok(world, a, { type: 'product.register', b: bc, no: 1, name: '하나', price: 1000 })
    await chat(world, a, bc, 'm1', 'UC_A', '홍길동', '1')
    const gets = [
      '/api/shop',
      '/api/days/2026-10-19/receipt?buyer=UC_A',
      '/api/days/2026-10-19/receipt.pdf?buyer=UC_A',
      '/api/days/2026-10-19/receipt.png?buyer=UC_A',
      '/api/days/2026-10-19/receipts.pdf',
      '/api/ledger.xlsx?from=2026-10-19&to=2026-10-19',
      '/api/days/2026-10-19/packing',
      '/api/days/2026-10-19/packing-label?buyer=UC_A',
      '/api/days/2026-10-19/packing-label.png?buyer=UC_A',
      '/api/days/2026-10-19/packing-label.pdf?buyer=UC_A',
      '/api/days/2026-10-19/past?buyer=UC_A',
      '/api/backups',
      '/api/export/records.json.gz',
      '/api/export/ledger.xlsx',
    ]
    for (const path of gets) expect((await getFile(world, null, path)).status, path).toBe(401)
    const posts: [string, Record<string, unknown>][] = [
      ['/api/days/2026-10-19/packing', { requestId: rid(), buyer: 'UC_A', action: 'unpack' }],
      [`/api/broadcasts/${bc}/import/preview`, { text: '2,둘,1000' }],
      [`/api/broadcasts/${bc}/import`, { requestId: rid(), rows: [{ no: 2, name: '둘', price: 1000 }] }],
    ]
    for (const [path, body] of posts) expect((await client(world, null).post(path, body)).status, path).toBe(401)
    const put = await world.server.app.request('/api/shop', { method: 'PUT', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })
    expect(put.status).toBe(401)
    // 다른 판매자: 날짜·방송·구매자 자원은 404 (판매대장은 방송이 없는 것과 같은 문장)
    for (const path of gets.slice(1, 5).concat(gets.slice(6, 11))) expect((await getFile(world, b.cookie, path)).status, path).toBe(404)
    expect((await getFile(world, b.cookie, '/api/ledger.xlsx?from=2026-10-19&to=2026-10-19')).json?.error).toEqual({ code: 'NO_BROADCASTS', message: '고른 기간에 방송이 없어요.' })
    expect((await getFile(world, b.cookie, `/api/ledger.xlsx?from=2026-10-19&to=2026-10-19&b=${bc}`)).json?.error).toMatchObject({ message: '고른 방송을 다시 확인해 주세요.' })
    for (const [path, body] of posts) expect((await post(world, b, path, body)).status, path).toBe(404)
    // 자기 것만 보이는 자원
    expect(((await client(world, b.cookie).get('/api/shop')).body.shop as { name: string }).name).toBe(`가게 ${b.loginId}`)
    expect((await getFile(world, b.cookie, '/api/export/ledger.xlsx')).status).toBe(422)
    const exported = await getFile(world, b.cookie, '/api/export/records.json.gz')
    expect(exported.status).toBe(200)
  })
})

describe('AC-I2-81 개인정보 — 주소·로그', () => {
  it('새 경로의 주소에는 날짜·방송 ID·구매자 ID만, 송장번호·가게 설정·가져오기 글·문서 내용·파일 이름이 로그에 남지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, { name: '비밀가게', bank: '비밀은행', accountNumber: '111-222', accountHolder: '비밀주인', accountNote: '비밀안내' })
    const bc = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b: bc, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, bc, 'm1', 'UC_A', '비밀닉네임', '1')
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_A', action: 'pack', items: [`${bc}/1`] })).status).toBe(200)
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_A', action: 'ship', invoice: '987654321098' })).status).toBe(200)
    await post(world, seller, `/api/broadcasts/${bc}/import/preview`, { text: '2,비밀품종,1000' })
    for (const path of ['receipt.pdf?buyer=UC_A', 'receipt.png?buyer=UC_A', 'receipts.pdf', 'packing-label.pdf?buyer=UC_A']) await getFile(world, seller.cookie, `/api/days/2026-10-19/${path}`)
    await getFile(world, seller.cookie, '/api/ledger.xlsx?from=2026-10-19&to=2026-10-19')
    await getFile(world, seller.cookie, '/api/export/records.json.gz')
    // 경보가 나는 길도 값 없이
    await getFile(world, seller.cookie, '/api/days/2026-10-19/receipt?buyer=UC_NOBODY')
    const logs = world.logs.map(formatLog).join('\n')
    for (const secret of ['비밀', '987654321098', '111-222', '확인서-', '포장라벨-', '판매대장-']) expect(logs).not.toContain(secret)
  })
})

describe('AC-I2-62 복구 명령 (운영자)', () => {
  it('인자: --seller·--file 필수, --replace는 값 없음, pnpm이 넘긴 맨 앞 -- 는 건너뛴다', () => {
    expect(parseRestoreArgs(['--seller', 's1', '--file', 'f.json.gz'])).toEqual({ ok: true, seller: 's1', file: 'f.json.gz', replace: false })
    expect(parseRestoreArgs(['--', '--file', 'f', '--replace', '--seller', 's'])).toEqual({ ok: true, seller: 's', file: 'f', replace: true })
    expect(parseRestoreArgs(['--seller', 's'])).toMatchObject({ ok: false })
    expect(parseRestoreArgs(['--seller', '--file', 'f'])).toMatchObject({ ok: false })
    expect(parseRestoreArgs(['--what', 'x'])).toMatchObject({ ok: false })
  })

  it('명령으로 빈 판매자에 가져오고(종료 코드 0, 재생 검사 출력), 바꾸기 없이 기록 있는 판매자면 거절(1), 같은 서버의 다른 판매자와 방송이 겹치면 거절(1), 인자 오류는 2 — 출력에 기록 내용이 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-restore-cmd-'))
    const backupDir = mkdtempSync(join(tmpdir(), 'livejjim-restore-bak-'))
    dirs.push(dir, backupDir)
    const { createSellerAccount } = await import('../src/accounts.ts')
    const { generateMasterKey } = await import('../src/secrets.ts')
    const masterKey = generateMasterKey()
    // 원래 판매자는 다른 서버(DB)에 있다 — 방송 ID는 서버 전체에서 유일하다(RA-I2-002)
    const sourceDb = await openPglite(join(dir, 'source-db'))
    const source = await createSellerAccount(sourceDb.db, Buffer.from(masterKey, 'base64'), { shopName: '원래 가게', loginId: 'srcshop', password: 'password-123' }, { passwordCost: FAST_COST })
    if (!source.ok) throw new Error('계정')
    const { startServer } = await import('./support.ts')
    const world = startServer(sourceDb, masterKey)
    const cookie = await (await import('./support.ts')).login(world, 'srcshop', 'password-123')
    const seller = { sellerId: source.sellerId, accountId: source.accountId, loginId: 'srcshop', password: 'password-123', cookie }
    const bc = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b: bc, no: 1, name: '비밀상품', price: 1000 })
    await chat(world, seller, bc, 'm1', 'UC_A', '비밀닉', '1')
    const file = join(dir, 'backup.json.gz')
    writeFileSync(file, await createBackupBytes(sourceDb.db, source.sellerId, Date.now()))
    await sourceDb.close()
    const database = await openPglite(join(dir, 'db'))
    const target = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: '빈 가게', loginId: 'dstshop', password: 'password-123' }, { passwordCost: FAST_COST })
    const second = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), { shopName: '둘째 가게', loginId: 'dstshop2', password: 'password-123' }, { passwordCost: FAST_COST })
    if (!target.ok || !second.ok) throw new Error('계정')
    await database.close()
    const script = fileURLToPath(new URL('../src/commands/restore.ts', import.meta.url))
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? '', TZ: process.env.TZ ?? '', LIVEJJIM_PGLITE_DIR: join(dir, 'db'), LIVEJJIM_BACKUP_DIR: backupDir }, timeout: 60_000 }, (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, out: `${stdout}\n${stderr}` })
        })
      })
    expect((await run(['--seller', target.sellerId])).code).toBe(2)
    expect((await run(['--seller', target.sellerId, '--file', join(dir, 'none.json.gz')])).code).toBe(2)
    const imported = await run(['--seller', target.sellerId, '--file', file])
    expect(imported.code, imported.out).toBe(0)
    expect(imported.out).toContain('가져왔어요. 범위 1개')
    expect(imported.out).toContain('모두 일치해요')
    expect(imported.out).not.toContain('비밀')
    const refused = await run(['--seller', target.sellerId, '--file', file])
    expect(refused.code).toBe(1)
    expect(refused.out).toContain('기록이 있는 판매자예요. 바꾸려면 --replace를 붙여 주세요(지금 기록은 먼저 백업해요).')
    const replaced = await run(['--seller', target.sellerId, '--file', file, '--replace'])
    expect(replaced.code, replaced.out).toBe(0)
    expect(replaced.out).toContain('지금 기록을 안전 백업으로 남겼어요: safety-')
    expect((await new FolderBackupStorage(backupDir).list(target.sellerId)).map((entry) => entry.kind)).toEqual(['safety'])
    // 같은 서버의 다른 판매자로 같은 파일 → 방송 ID가 겹쳐 거절, 아무것도 바꾸지 않는다
    const taken = await run(['--seller', second.sellerId, '--file', file])
    expect(taken.code).toBe(1)
    expect(taken.out).toContain('이 서버의 다른 판매자에게 같은 방송 기록이 있어 가져올 수 없어요. 아무것도 바꾸지 않았어요.')
    expect(taken.out).not.toContain('비밀')
  }, 180_000)
})

describe('E2E 기동 (AC-I2-15·65 시험 준비)', () => {
  it('시작할 때 시험 판매자의 자동 백업 하나, ?at=로 그 PNG를 만든 확인서 데이터를 얻어 Node 그림과 같은 바이트', async () => {
    const e2e = await startE2eServer({ passwordCost: FAST_COST })
    try {
      const status = await e2e.server.backups.status(e2e.sellerId)
      expect(status.enabled).toBe(true)
      expect(status.lastSuccessAt).not.toBeNull()
      expect(status.backups).toHaveLength(1)
      const world = { server: e2e.server, database: e2e.database, masterKey: '', clock: { now: () => Date.now(), set: () => {}, advance: () => {} }, logs: [] }
      const login = await e2e.server.app.request('/api/login', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: e2e.account.loginId, password: e2e.account.password }) })
      const cookie = /lj_session=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? ''
      const headers = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }
      const created = await e2e.server.app.request('/api/broadcasts', { method: 'POST', headers, body: JSON.stringify({ requestId: rid('e2e'), date: '2026-10-19' }) })
      const b = ((await created.json()) as { broadcast: { id: string } }).broadcast.id
      await e2e.server.app.request('/api/events', { method: 'POST', headers, body: JSON.stringify({ requestId: rid('e2e'), type: 'product.register', b, no: 1, name: '핑크', price: 1000 }) })
      await e2e.server.ingestChat(e2e.sellerId, { b, id: 'm1', ch: 'UC_A', nick: '길동이', text: '1' })
      const png = await getFile(world as never, cookie, '/api/days/2026-10-19/receipt.png?buyer=UC_A')
      const at = png.headers.get('x-receipt-created-at')
      expect(at).toMatch(/^\d+$/)
      const data = (await getFile(world as never, cookie, `/api/days/2026-10-19/receipt?buyer=UC_A&at=${at ?? ''}`)).json as unknown as ReceiptData
      expect(Buffer.from(renderReceiptPng(data, loadDocumentFont(fontBytes()))).equals(Buffer.from(png.bytes))).toBe(true)
      expect((await getFile(world as never, cookie, '/api/days/2026-10-19/receipt?buyer=UC_A&at=x')).status).toBe(400)
    } finally {
      await e2e.close()
    }
  })

  it('운영 서버(createServer 기본)는 ?at=를 보지 않는다 — 늘 서버 시계의 지금 시각', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const bc = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b: bc, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, bc, 'm1', 'UC_A', '길동이', '1')
    const response = await client(world, seller.cookie).get('/api/days/2026-10-19/receipt?buyer=UC_A&at=0')
    expect(response.headers.get('x-receipt-created-at')).toBe(String(world.clock.now()))
    expect(response.body.createdAt).not.toBe('1970년 1월 1일 09:00')
  })
})
