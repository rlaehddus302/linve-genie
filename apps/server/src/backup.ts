// 운영 백업 (DAT-03, SYS-05, D-012, D-I3-14, AC-I3-75): 데이터베이스 전체를 pg_dump 사용자 정의 형식으로 백업 폴더에 둔다.
// - 파일 이름 livejjim-YYYYMMDD-HHmmss.dump (UTC). 임시 이름(.tmp)으로 다 쓴 뒤 이름을 바꾼다 — 반쯤 쓴 파일이 백업으로 보이지 않게.
// - 성공한 뒤에만 그 폴더에서 이름 모양이 맞는 30일 넘은 파일을 지운다(다른 파일은 건드리지 않는다). 가장 최근 백업은 30일이 넘어도 하나 남긴다.
// - 실패(종료 코드가 0이 아님·시간 초과·빈 파일)면 임시 파일을 지우고 다른 백업은 하나도 지우지 않는다 — 경보 BACKUP_FAILED.
// - 연결 정보(호스트·사용자·비밀번호·데이터베이스)는 덤프 프로그램의 환경변수(PG*)로만 넘긴다 — 명령행 인자·로그에 나오지 않는다.
//   덤프 프로그램에는 서버의 다른 환경변수(마스터 키 등)를 넘기지 않는다.
// - 개발용 PGlite는 하지 않는다(폴더를 통째로 복사). 일정은 운영자가 정한다(예: 매일 04:00 KST — docs/DEPLOY.md).
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readDatabaseSetting } from './config.ts'

export const BACKUP_KEEP_DAYS = 30
export const BACKUP_TIMEOUT_MS = 30 * 60 * 1000
export const BACKUP_NAME_RE = /^livejjim-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/

export const BACKUP_MESSAGES = {
  PGLITE: '개발용 데이터베이스는 폴더를 통째로 복사해 주세요.',
  NO_DIR_SETTING: '백업 폴더(LIVEJJIM_BACKUP_DIR)를 적어 주세요.',
  NO_DIR: '백업 폴더(LIVEJJIM_BACKUP_DIR)가 없어요. 폴더를 먼저 만들어 주세요.',
  FAILED: '백업하지 못했어요. pg_dump가 있는지, 데이터베이스에 닿는지 확인해 주세요.',
  BAD_URL: '데이터베이스 연결 문자열(DATABASE_URL)을 확인해 주세요.',
} as const

export interface BackupOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** 지금 (UTC 밀리초) */
  readonly now: () => number
  /** 덤프 시간 제한 (기본 30분) */
  readonly timeoutMs?: number
  /** 실패했을 때 (경보 BACKUP_FAILED) */
  readonly onFailure?: () => void
}

export type BackupResult = { readonly ok: true; readonly file: string; readonly removed: readonly string[] } | { readonly ok: false; readonly message: string }

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** 백업 파일 이름 (UTC) */
export function backupName(ms: number): string {
  const d = new Date(ms)
  return `livejjim-${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.dump`
}

/** 이름의 시각 (UTC 밀리초). 모양이 다르면 null */
export function backupTime(name: string): number | null {
  const match = BACKUP_NAME_RE.exec(name)
  if (match === null) return null
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number]
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  return Number.isFinite(ms) ? ms : null
}

/** 지울 백업: 이름 모양이 맞고 30일이 넘은 것 — 가장 최근 것은 늘 남긴다 */
export function retentionVictims(names: readonly string[], now: number, keepDays = BACKUP_KEEP_DAYS): string[] {
  const dated = names.flatMap((name) => {
    const at = backupTime(name)
    return at === null ? [] : [{ name, at }]
  })
  if (dated.length === 0) return []
  const newest = dated.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.name > a.name) ? b : a))
  return dated.filter((item) => item !== newest && now - item.at > keepDays * 24 * 60 * 60 * 1000).map((item) => item.name)
}

/** DATABASE_URL → 덤프 프로그램의 환경변수 (PG*). 읽을 수 없으면 null */
export function pgEnvOf(databaseUrl: string): Record<string, string> | null {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const out: Record<string, string> = {}
  const host = url.searchParams.get('host') ?? url.hostname.replace(/^\[|\]$/g, '')
  if (host !== '') out.PGHOST = decode(host)
  const port = url.searchParams.get('port') ?? url.port
  if (port !== '') out.PGPORT = port
  if (url.username !== '') out.PGUSER = decode(url.username)
  if (url.password !== '') out.PGPASSWORD = decode(url.password)
  const database = url.pathname.replace(/^\//, '')
  if (database !== '') out.PGDATABASE = decode(database)
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode !== null) out.PGSSLMODE = sslmode
  return out
}

/** 덤프 프로그램을 돌린다. 종료 코드 0이면 true (시간 제한을 넘기면 끝내고 false) */
function runDump(command: string, args: readonly string[], env: Record<string, string>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    let child: ReturnType<typeof spawn>
    try {
      // 표준 출력·오류는 버린다 (연결 정보가 섞일 수 있다)
      child = spawn(command, [...args], { env, stdio: 'ignore', shell: false })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(false)
    }, timeoutMs)
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
  })
}

export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const { env } = options
  const fail = (message: string): BackupResult => {
    options.onFailure?.()
    return { ok: false, message }
  }
  const setting = readDatabaseSetting(env)
  if (!setting.ok) return { ok: false, message: setting.message }
  if (setting.kind === 'pglite') return { ok: false, message: BACKUP_MESSAGES.PGLITE }
  const dir = env['LIVEJJIM_BACKUP_DIR']?.trim() ?? ''
  if (dir === '') return fail(BACKUP_MESSAGES.NO_DIR_SETTING)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail(BACKUP_MESSAGES.NO_DIR)
  const pg = pgEnvOf(setting.url)
  if (pg === null) return fail(BACKUP_MESSAGES.BAD_URL)
  const now = options.now()
  const name = backupName(now)
  const finalPath = join(dir, name)
  const tempPath = `${finalPath}.tmp`
  const command = env['LIVEJJIM_PG_DUMP']?.trim() || 'pg_dump'
  const childEnv: Record<string, string> = { ...pg }
  for (const key of ['PATH', 'HOME', 'LANG', 'TZ']) {
    const value = env[key] ?? process.env[key]
    if (value !== undefined) childEnv[key] = value
  }
  const ok = await runDump(command, ['--format=custom', '--no-password', `--file=${tempPath}`], childEnv, options.timeoutMs ?? BACKUP_TIMEOUT_MS)
  let size = 0
  try {
    size = ok ? (await stat(tempPath)).size : 0
  } catch {
    size = 0
  }
  if (!ok || size === 0) {
    await rm(tempPath, { force: true })
    return fail(BACKUP_MESSAGES.FAILED)
  }
  await rename(tempPath, finalPath)
  // 성공한 뒤에만 오래된 백업을 지운다 (이름 모양이 맞는 것만, 가장 최근 것은 남긴다)
  const victims = retentionVictims(await readdir(dir), now)
  const removed: string[] = []
  for (const victim of victims) {
    try {
      await rm(join(dir, victim))
      removed.push(victim)
    } catch {
      // 못 지우면 다음 백업 때 다시
    }
  }
  return { ok: true, file: name, removed }
}
