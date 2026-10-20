// AC-I3-75 운영 백업 명령 (DAT-03, SYS-05, D-012, D-I3-14): 가짜 pg_dump로 — 성공·실패·빈 파일·시간 초과·보관 기간·최근 하나 남김·다른 파일 그대로·인자에 비밀 없음.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_MESSAGES, backupName, backupTime, pgEnvOf, retentionVictims, runBackup } from '../src/backup.ts'
import { formatAlert } from '../src/log.ts'

let root = ''
let backups = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'livejjim-backup-'))
  backups = join(root, 'backups')
  mkdirSync(backups)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const NOW = Date.UTC(2026, 9, 19, 19, 0, 7) // 2026-10-20 04:00:07 KST
const URL_WITH_SECRET = 'postgres://livejjim:s3cret%2Fpass@db.internal:6543/livejjim_prod?sslmode=require'

/** 가짜 pg_dump: 받은 인자·PG 환경변수·그 밖의 환경변수 이름을 기록하고 mode대로 한다 */
function fakeDump(mode: 'ok' | 'fail' | 'empty' | 'slow' | 'partial-fail'): string {
  const script = join(root, `pg_dump_${mode}.sh`)
  const body = {
    ok: `printf 'PGDMP-fake-dump' > "$out"`,
    fail: 'exit 3',
    empty: `: > "$out"`,
    slow: 'sleep 5',
    'partial-fail': `printf 'half' > "$out"; exit 1`,
  }[mode]
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${root}/args.txt"`,
      `env | grep '^PG' | sort > "${root}/pgenv.txt"`,
      `env | cut -d= -f1 | sort > "${root}/envnames.txt"`,
      'out=""',
      'for arg in "$@"; do case "$arg" in --file=*) out="${arg#--file=}";; esac; done',
      body,
      '',
    ].join('\n'),
  )
  chmodSync(script, 0o755)
  return script
}

function env(dump: string, extra: Record<string, string> = {}): Record<string, string> {
  return { DATABASE_URL: URL_WITH_SECRET, LIVEJJIM_BACKUP_DIR: backups, LIVEJJIM_PG_DUMP: dump, LIVEJJIM_MASTER_KEY: 'master-key-should-not-pass', PATH: process.env.PATH ?? '/usr/bin:/bin', ...extra }
}

describe('AC-I3-75 운영 백업 명령', () => {
  it('성공: 사용자 정의 형식으로 livejjim-YYYYMMDD-HHmmss.dump(UTC) — 임시 이름으로 쓰고 이름을 바꾼다, 연결 정보는 환경변수로만(인자에 비밀 없음), 다른 환경변수는 넘기지 않는다', async () => {
    let alerts = 0
    const result = await runBackup({ env: env(fakeDump('ok')), now: () => NOW, onFailure: () => (alerts += 1) })
    expect(result).toEqual({ ok: true, file: 'livejjim-20261019-190007.dump', removed: [] })
    expect(readdirSync(backups)).toEqual(['livejjim-20261019-190007.dump'])
    expect(readFileSync(join(backups, 'livejjim-20261019-190007.dump'), 'utf8')).toBe('PGDMP-fake-dump')
    const args = readFileSync(join(root, 'args.txt'), 'utf8').trim().split('\n')
    expect(args).toEqual(['--format=custom', '--no-password', `--file=${join(backups, 'livejjim-20261019-190007.dump')}.tmp`])
    const argText = args.join(' ')
    for (const secret of ['s3cret', 'livejjim:', 'db.internal', '6543', 'postgres://', 'livejjim_prod']) expect(argText).not.toContain(secret)
    expect(readFileSync(join(root, 'pgenv.txt'), 'utf8').trim().split('\n')).toEqual(['PGDATABASE=livejjim_prod', 'PGHOST=db.internal', 'PGPASSWORD=s3cret/pass', 'PGPORT=6543', 'PGSSLMODE=require', 'PGUSER=livejjim'])
    const names = readFileSync(join(root, 'envnames.txt'), 'utf8')
    expect(names).not.toContain('LIVEJJIM_MASTER_KEY')
    expect(names).not.toContain('DATABASE_URL')
    expect(alerts).toBe(0)
  })

  it('성공한 뒤에만 이름 모양이 맞는 30일 넘은 백업을 지운다 — 다른 파일은 그대로', async () => {
    const keep = ['livejjim-20261001-000000.dump', 'livejjim-20260919-190008.dump', 'notes.txt', 'livejjim-old.dump', 'livejjim-20260901-000000.dump.tmp', 'other-20260101-000000.dump']
    const old = ['livejjim-20260901-000000.dump', 'livejjim-20260919-190006.dump', 'livejjim-20250101-120000.dump']
    for (const name of [...keep, ...old]) writeFileSync(join(backups, name), 'x')
    const result = await runBackup({ env: env(fakeDump('ok')), now: () => NOW })
    expect(result).toMatchObject({ ok: true, file: 'livejjim-20261019-190007.dump' })
    expect([...(result.ok ? result.removed : [])].sort()).toEqual([...old].sort())
    expect(readdirSync(backups).sort()).toEqual([...keep, 'livejjim-20261019-190007.dump'].sort())
  })

  for (const [label, mode] of [
    ['종료 코드가 0이 아님', 'fail'],
    ['빈 파일', 'empty'],
    ['반쯤 쓰고 실패', 'partial-fail'],
  ] as const) {
    it(`실패(${label}): 임시 파일을 지우고 다른 백업은 하나도 지우지 않는다 — 실패 알림(경보), 쉬운 문장`, async () => {
      const old = ['livejjim-20260901-000000.dump', 'livejjim-20250101-120000.dump']
      for (const name of old) writeFileSync(join(backups, name), 'x')
      let alerts = 0
      const result = await runBackup({ env: env(fakeDump(mode)), now: () => NOW, onFailure: () => (alerts += 1) })
      expect(result).toEqual({ ok: false, message: BACKUP_MESSAGES.FAILED })
      expect(readdirSync(backups).sort()).toEqual([...old].sort())
      expect(alerts).toBe(1)
      expect(result.ok ? '' : result.message).not.toMatch(/s3cret|db\.internal|postgres/)
    })
  }

  it('시간 초과: 덤프를 끝내고 실패 (임시 파일 없음, 경보)', async () => {
    let alerts = 0
    const started = Date.now()
    const result = await runBackup({ env: env(fakeDump('slow')), now: () => NOW, timeoutMs: 200, onFailure: () => (alerts += 1) })
    expect(result).toEqual({ ok: false, message: BACKUP_MESSAGES.FAILED })
    expect(Date.now() - started).toBeLessThan(4000)
    expect(readdirSync(backups)).toEqual([])
    expect(alerts).toBe(1)
  })

  it('pg_dump가 없으면 실패, 백업 폴더가 없으면 알리고 실패, PGlite면 하지 않는다(경보 없음)', async () => {
    let alerts = 0
    const onFailure = () => (alerts += 1)
    expect(await runBackup({ env: env(join(root, 'no-such-pg_dump')), now: () => NOW, onFailure })).toEqual({ ok: false, message: BACKUP_MESSAGES.FAILED })
    expect(await runBackup({ env: env(fakeDump('ok'), { LIVEJJIM_BACKUP_DIR: join(root, 'missing') }), now: () => NOW, onFailure })).toEqual({ ok: false, message: BACKUP_MESSAGES.NO_DIR })
    expect(await runBackup({ env: { ...env(fakeDump('ok')), LIVEJJIM_BACKUP_DIR: '' }, now: () => NOW, onFailure })).toEqual({ ok: false, message: BACKUP_MESSAGES.NO_DIR_SETTING })
    expect(alerts).toBe(3)
    expect(await runBackup({ env: { LIVEJJIM_PGLITE_DIR: join(root, 'pglite'), LIVEJJIM_BACKUP_DIR: backups }, now: () => NOW, onFailure })).toEqual({ ok: false, message: '개발용 데이터베이스는 폴더를 통째로 복사해 주세요.' })
    expect(await runBackup({ env: { LIVEJJIM_BACKUP_DIR: backups }, now: () => NOW, onFailure })).toMatchObject({ ok: false })
    expect(alerts).toBe(3)
    expect(existsSync(join(root, 'pglite'))).toBe(false)
    expect(formatAlert({ level: 'alert', code: 'BACKUP_FAILED' })).toBe('{"level":"alert","code":"BACKUP_FAILED","count":1}')
  })

  it('보관 규칙: 가장 최근 백업은 30일이 넘어도 하나 남긴다, 이름 모양이 다르면 건드리지 않는다', () => {
    const now = Date.UTC(2026, 11, 31)
    expect(retentionVictims(['livejjim-20260901-000000.dump', 'livejjim-20260801-000000.dump', 'x.dump'], now)).toEqual(['livejjim-20260801-000000.dump'])
    expect(retentionVictims(['livejjim-20260901-000000.dump'], now)).toEqual([])
    expect(retentionVictims(['readme.md', 'livejjim-2026-09-01.dump'], now)).toEqual([])
    expect(backupName(NOW)).toBe('livejjim-20261019-190007.dump')
    expect(backupTime('livejjim-20261019-190007.dump')).toBe(NOW)
    expect(backupTime('livejjim-20261019-190007.dump.tmp')).toBeNull()
    expect(pgEnvOf('postgresql://u@localhost/db?host=/var/run/postgresql')).toEqual({ PGHOST: '/var/run/postgresql', PGUSER: 'u', PGDATABASE: 'db' })
    expect(pgEnvOf('mysql://x')).toBeNull()
  })
})
