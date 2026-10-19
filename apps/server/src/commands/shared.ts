// 명령 공통: 저장소 루트 .env 읽기, 환경변수로 DB 열기. 오류 문장에 환경변수 값을 넣지 않는다.
import { existsSync } from 'node:fs'
import { readDatabaseSetting } from '../config.ts'
import { openPglite, openPostgres, type Database } from '../db/database.ts'

/** 저장소 루트의 .env (커밋하지 않는다. 키 목록은 .env.example). 이미 있는 환경변수가 우선한다 */
export function loadDotEnv(): void {
  const file = new URL('../../../../.env', import.meta.url)
  if (existsSync(file)) process.loadEnvFile(file)
}

export const say = (line: string) => process.stdout.write(`${line}\n`)
export const complain = (line: string) => process.stderr.write(`${line}\n`)

/** 환경변수(DATABASE_URL 또는 LIVEJJIM_PGLITE_DIR)로 DB를 연다. 설정이 없으면 문장을 알리고 null */
export async function openDatabaseFromEnv(options: { migrate: boolean }): Promise<Database | null> {
  const setting = readDatabaseSetting(process.env)
  if (!setting.ok) {
    complain(setting.message)
    return null
  }
  try {
    return setting.kind === 'postgres' ? await openPostgres(setting.url, options) : await openPglite(setting.dir, options)
  } catch {
    complain('데이터베이스를 열지 못했어요. 연결 설정을 확인해 주세요.')
    return null
  }
}

/** `--이름 값` 형태의 인자 읽기 (모르는 인자는 오류) */
export function parseArgs(argv: readonly string[], allowed: readonly string[]): { ok: true; values: Map<string, string> } | { ok: false; message: string } {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? ''
    const value = argv[i + 1]
    if (!name.startsWith('--') || !allowed.includes(name.slice(2))) return { ok: false, message: `모르는 인자예요. 쓸 수 있는 인자: ${allowed.map((a) => `--${a}`).join(' ')}` }
    if (value === undefined) return { ok: false, message: `${name} 뒤에 값을 적어 주세요.` }
    values.set(name.slice(2), value)
  }
  return { ok: true, values }
}
