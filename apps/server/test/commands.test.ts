// 명령: 계정 만들기(AC-S04-40 — 비밀번호는 명령행 인자가 아니라 표준 입력), 마이그레이션(AC-S04-20),
// 서버 시작 거절(AC-S04-20·32 — DB 연결 설정·마스터 키가 없으면 쉬운 문장으로 시작하지 않고 값은 출력하지 않는다)
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { openPglite } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { login, startServer } from './support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const script = (name: string) => fileURLToPath(new URL(`../src/${name}`, import.meta.url))

function run(file: string, args: string[], env: Record<string, string>, stdin = ''): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [file, ...args], { env: { PATH: process.env.PATH ?? '', TZ: process.env.TZ ?? '', ...env }, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, out: `${stdout}\n${stderr}` })
    })
    child.stdin?.end(stdin)
  })
}

describe('계정 만들기 명령 (AC-S04-40)', () => {
  it('비밀번호는 표준 입력으로 받고, 만든 계정으로 로그인할 수 있다. 출력에 비밀번호·키가 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-account-'))
    dirs.push(dir)
    const masterKey = generateMasterKey()
    const env = { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: masterKey }
    const created = await run(script('commands/create-account.ts'), ['--name', '다육 가게', '--login', 'cmdshop'], env, 'stdin-secret-77\n')
    expect(created.code, created.out).toBe(0)
    expect(created.out).toContain('계정을 만들었어요.')
    expect(created.out).not.toContain('stdin-secret-77')
    expect(created.out).not.toContain(masterKey)
    // 같은 아이디는 다시 만들 수 없다
    const again = await run(script('commands/create-account.ts'), ['--name', '다른 가게', '--login', 'cmdshop'], env, 'stdin-secret-88\n')
    expect(again.code).toBe(1)
    expect(again.out).toContain('이미 있는 아이디예요.')
    // 명령행으로 비밀번호를 받는 인자는 없다
    const viaArg = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'argshop', '--password', 'argv-secret-99'], env)
    expect(viaArg.code).toBe(1)
    expect(viaArg.out).not.toContain('argv-secret-99')
    const database = await openPglite(dir)
    try {
      const world = startServer(database, masterKey)
      expect(await login(world, 'cmdshop', 'stdin-secret-77')).toMatch(/^lj_session=/)
      const sellers = await database.pglite?.query<{ phone_key_enc: string }>(`select phone_key_enc from sellers`)
      expect(sellers?.rows).toHaveLength(1)
      expect(sellers?.rows[0]?.phone_key_enc).toMatch(/^v1\./)
    } finally {
      await database.close()
    }
  }, 120_000)

  it('마스터 키가 없거나 틀리면 만들지 않는다 (값은 출력하지 않는다)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-account-'))
    dirs.push(dir)
    const noKey = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'nokey'], { LIVEJJIM_PGLITE_DIR: dir }, 'secret-secret\n')
    expect(noKey.code).toBe(1)
    expect(noKey.out).toContain('마스터 키')
    const badKey = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'badkey'], { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: 'c2hvcnQta2V5' }, 'secret-secret\n')
    expect(badKey.code).toBe(1)
    expect(badKey.out).not.toContain('c2hvcnQta2V5')
  }, 120_000)
})

describe('마이그레이션 명령 (AC-S04-20)', () => {
  it('설정한 DB에 마이그레이션을 적용하고, 설정이 없으면 쉬운 문장으로 실패한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-migrate-'))
    dirs.push(dir)
    const ok = await run(script('commands/migrate.ts'), [], { LIVEJJIM_PGLITE_DIR: dir })
    expect(ok.code, ok.out).toBe(0)
    expect(ok.out).toContain('마이그레이션을 적용했어요.')
    const database = await openPglite(dir, { migrate: false })
    const tables = await database.pglite?.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)
    await database.close()
    // 스키마의 테이블이 모두 생겼다 (판매자·계정·로그인 시도 수·세션·범위·방송·이벤트·발송함·스냅샷 + Y1: 채팅 원문·유튜브 연결·승인 요청·방송 잇기·수집기·우리 메시지·알림·할당량
    //   + I1 출력 기록: 대기열·라벨 키·작업·시도·라벨 템플릿·출력 요청 번호 + I2 포장 기록
    //   + N2: 인스타그램 연결·OAuth state·라이브 연결·라이브 옮긴 기록·이어지지 않은 댓글 수·라이브 요청 번호·DM 발송·DM 행 + N4a 라벨 기능 켬/끔 바꾼 기록
    //   + N2b-2: 틱톡 연결·틱톡 동의 기록·틱톡 아이디·붙여넣기 요청 번호)
    expect(tables?.rows.map((row) => row.table_name).sort()).toEqual(Object.values(schema).map((table) => getTableConfig(table).name).sort())
    expect(tables?.rows).toHaveLength(37)
    const none = await run(script('commands/migrate.ts'), [], {})
    expect(none.code).toBe(1)
    expect(none.out).toContain('데이터베이스 연결 설정이 없어요')
  }, 120_000)
})

describe('서버 시작 거절 (AC-S04-20·32)', () => {
  it('DB 연결 설정·마스터 키·앱 주소가 없거나 틀리면 쉬운 문장으로 시작하지 않는다 — 값은 출력하지 않고 메모리 DB로 바꾸지 않는다', async () => {
    const key = generateMasterKey()
    const origin = 'https://app.livejjim.test'
    const cases: [Record<string, string>, RegExp, string[]][] = [
      [{ LIVEJJIM_APP_ORIGIN: origin }, /마스터 키\(LIVEJJIM_MASTER_KEY\)가 없어요/, []],
      [{ LIVEJJIM_MASTER_KEY: 'dG9vLXNob3J0', LIVEJJIM_APP_ORIGIN: origin }, /길이가 맞지 않아요/, ['dG9vLXNob3J0']],
      [{ LIVEJJIM_MASTER_KEY: key }, /앱 주소\(LIVEJJIM_APP_ORIGIN\)가 없어요/, [key]],
      [{ LIVEJJIM_MASTER_KEY: key, LIVEJJIM_APP_ORIGIN: origin }, /데이터베이스 연결 설정이 없어요/, [key]],
      [{ LIVEJJIM_MASTER_KEY: key, LIVEJJIM_APP_ORIGIN: origin, DATABASE_URL: 'mysql://admin:hunter2@db/prod' }, /postgres:\/\/로 시작해야 해요/, [key, 'hunter2']],
    ]
    for (const [env, message, secrets] of cases) {
      const result = await run(script('main.ts'), [], { PORT: '39999', ...env })
      expect(result.code, result.out).toBe(1)
      expect(result.out).toMatch(/시작하지 못했어요/)
      expect(result.out).toMatch(message)
      expect(result.out).not.toContain('시작했어요.')
      for (const secret of secrets) expect(result.out).not.toContain(secret)
    }
  }, 120_000)
})
