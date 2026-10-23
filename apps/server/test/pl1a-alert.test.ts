// PL1A AC-PL1A-08·09 판매자 자동 백업 실패 경보 (D-PL1-02, DAT-03·SYS-05)
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { FolderBackupStorage, type BackupEntry, type BackupKind, type BackupStorage } from '../src/backup.ts'
import { formatAlert } from '../src/log.ts'
import { kst } from './i2-support.ts'
import { tempDir, tempDirs } from './pl1a-support.ts'
import { addSeller, fakeClock, newWorld } from './support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 한 판매자의 쓰기만 실패하는 저장소 (보관 정리 실패도 고를 수 있다) */
class FlakyStorage implements BackupStorage {
  readonly #inner: FolderBackupStorage
  readonly failWrite = new Set<string>()
  readonly failRemove = new Set<string>()
  constructor(inner: FolderBackupStorage) {
    this.#inner = inner
  }
  list(sellerId: string): Promise<BackupEntry[]> {
    return this.#inner.list(sellerId)
  }
  write(sellerId: string, kind: BackupKind, createdAt: number, bytes: Uint8Array): Promise<BackupEntry> {
    if (this.failWrite.has(sellerId)) return Promise.reject(new Error(`/secret/path/${sellerId} 디스크가 가득 찼어요`))
    return this.#inner.write(sellerId, kind, createdAt, bytes)
  }
  read(sellerId: string, name: string): Promise<Uint8Array> {
    return this.#inner.read(sellerId, name)
  }
  remove(sellerId: string, name: string): Promise<void> {
    if (this.failRemove.has(sellerId)) return Promise.reject(new Error('지울 수 없음'))
    return this.#inner.remove(sellerId, name)
  }
}

describe('AC-PL1A-08 자동 백업이 실패하면 운영 경보', () => {
  it('Q만 실패: 경보 { level: alert, code: BACKUP_FAILED, count: 1, seller: Q } 하나(이름·메시지·경로 없음), 5분·9분 59초 뒤 경보 없음, 10분 뒤 count 3. P·R은 다시 만들지 않는다', async () => {
    const storage = new FlakyStorage(new FolderBackupStorage(tempDir()))
    const world = await newWorld({ clock: fakeClock(kst('2026-10-20', '03:00:00')), backupStorage: storage })
    const p = await addSeller(world, 'shopP')
    const q = await addSeller(world, 'shopQ')
    const r = await addSeller(world, 'shopR')
    // Q만 실패하게 (판매자 ID는 계정을 만든 뒤에 안다) — 서버 기동과 같은 로그 싱크·경보 연결(Alerter)
    storage.failWrite.add(q.sellerId)
    const scheduler = world.server.backups
    world.clock.set(kst('2026-10-20', '04:00:01'))
    world.logs.splice(0)
    const first = await scheduler.check()
    expect([...first.created].sort()).toEqual([p.sellerId, r.sellerId].sort())
    expect(first.failed).toEqual([q.sellerId])
    const alerts = () => world.logs.filter((log) => log.level === 'alert')
    expect(alerts()).toEqual([{ level: 'alert', code: 'BACKUP_FAILED', count: 1, seller: q.sellerId }])
    expect(formatAlert(alerts()[0] as never)).toBe(JSON.stringify({ level: 'alert', code: 'BACKUP_FAILED', count: 1, seller: q.sellerId }))
    const line = JSON.stringify(world.logs)
    for (const secret of ['shopQ', '/secret/path', '디스크가 가득', 'stack']) expect(line).not.toContain(secret)
    for (const [offset, expected] of [
      [5 * 60 * 1000, 0],
      [9 * 60 * 1000 + 59 * 1000, 0],
      [10 * 60 * 1000, 1],
    ] as const) {
      world.logs.splice(0)
      world.clock.set(kst('2026-10-20', '04:00:01') + offset)
      const again = await scheduler.check()
      expect(again.created).toEqual([])
      expect(again.failed).toEqual([q.sellerId])
      expect(alerts().length, String(offset)).toBe(expected)
    }
    expect(alerts()).toEqual([{ level: 'alert', code: 'BACKUP_FAILED', count: 3, seller: q.sellerId }])
    // 운영 백업 명령의 경보(seller 칸 없음)는 그대로
    world.logs.splice(0)
    world.server.alerter.alert('BACKUP_FAILED')
    expect(alerts()).toEqual([{ level: 'alert', code: 'BACKUP_FAILED', count: 1 }])
    // /ops/status는 바꾸지 않았다 (ops.ts의 상태 응답 코드는 그대로 — 기존 i3-deploy 시험이 모양을 고정한다)
  })

  it('보관 정리 실패(BACKUP_PRUNE_FAILED)는 경고 로그만, 경보 없음', async () => {
    const storage = new FlakyStorage(new FolderBackupStorage(tempDir()))
    const world = await newWorld({ clock: fakeClock(kst('2026-09-01', '05:00:00')), backupStorage: storage })
    const seller = await addSeller(world)
    await world.server.backups.createNow(seller.sellerId, 'daily')
    world.clock.set(kst('2026-09-02', '05:00:00'))
    await world.server.backups.createNow(seller.sellerId, 'daily')
    storage.failRemove.add(seller.sellerId)
    world.clock.set(kst('2026-10-10', '05:00:00'))
    world.logs.splice(0)
    await world.server.backups.check()
    expect(world.logs.filter((log) => log.code === 'BACKUP_PRUNE_FAILED').map((log) => log.level)).toEqual(['warn'])
    expect(world.logs.filter((log) => log.level === 'alert')).toEqual([])
  })
})

describe('AC-PL1A-09 운영 문서', () => {
  it('DEPLOY 경보 표의 BACKUP_FAILED 줄이 운영 백업 명령 실패와 판매자 자동 백업 실패(seller 칸)를 둘 다 적고 판매자 백업 폴더 확인을 더한다', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../docs/DEPLOY.md', import.meta.url)), 'utf8')
    const line = doc.split('\n').find((text) => text.startsWith('| `BACKUP_FAILED` |')) ?? ''
    expect(line).toContain('운영 백업 명령 실패')
    expect(line).toContain('판매자 자동 백업 실패')
    expect(line).toContain('`seller` 칸 = 판매자 ID')
    expect(line).toContain('LIVEJJIM_BACKUP_DIR/<판매자 ID>')
  })
})
