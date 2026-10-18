// S00 검사 파이프라인(verify 단계) 자체 공격 (AC-S00-03·05·06·11·12·15).
// 저장소를 임시 폴더에 복사하고 그 안에서 실제 단계 스크립트(scripts/verify/stage.mjs)를 돌린다.
// 작업 트리·실제 node_modules/.cache는 건드리지 않는다(임시 폴더의 node_modules는 패키지별 링크만 둔 진짜 폴더).
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './helpers.ts'

const created: string[] = []
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

/** 복사하지 않는 폴더: 설치물·빌드·측정 결과·캐시 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.cache', '.claude'])

/** 저장소의 일부(루트 기준 경로들)를 임시 폴더로 복사하고 node_modules는 링크로 잇는다 */
function repoCopy(paths: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-gate-'))
  created.push(dir)
  for (const path of paths) {
    const from = join(ROOT, path)
    if (!existsSync(from)) continue
    cpSync(from, join(dir, path), {
      recursive: true,
      filter: (source) => !relative(ROOT, source).split(sep).some((part) => SKIP_DIRS.has(part)),
    })
  }
  // 루트 node_modules: 항목마다 링크(캐시 폴더 제외) → 단계가 쓰는 node_modules/.cache는 임시 폴더 안에 생긴다
  mkdirSync(join(dir, 'node_modules'))
  for (const name of readdirSync(join(ROOT, 'node_modules'))) {
    if (name.startsWith('.')) continue
    symlinkSync(join(ROOT, 'node_modules', name), join(dir, 'node_modules', name))
  }
  // 워크스페이스 패키지의 node_modules
  for (const base of ['packages', 'apps']) {
    if (!existsSync(join(ROOT, base))) continue
    for (const name of readdirSync(join(ROOT, base))) {
      const nm = join(ROOT, base, name, 'node_modules')
      if (existsSync(nm) && existsSync(join(dir, base, name))) symlinkSync(nm, join(dir, base, name, 'node_modules'))
    }
  }
  return dir
}

function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

interface StageRun {
  readonly code: number | null
  readonly output: string
}

/** 임시 저장소에서 `node scripts/verify/stage.mjs <단계>` (= pnpm <단계>)를 돌린다 */
function runStage(dir: string, stage: string): Promise<StageRun> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('VITEST') || key === 'TEST') delete env[key]
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join('scripts', 'verify', 'stage.mjs'), stage], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

const tail = (run: StageRun): string => run.output.split('\n').slice(-25).join('\n')

// ── TD-S00-013 ───────────────────────────────────────────────────────────

const LINT_BASE = ['package.json', 'eslint.config.mjs', 'scripts/verify']
const CORE_PROBE = ['packages/core/src/probe.ts', 'export const now = (): number => Date.now()\n'] as const
const WEB_PROBE = ['apps/web/src/Probe.tsx', 'export const Probe = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />\n'] as const
/** Vite React 템플릿이 만들어 주는 것 같은, 화면 폴더 전용 ESLint 설정 */
const WEB_LOCAL_CONFIG = "import tseslint from 'typescript-eslint'\n\nexport default [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } }]\n"

describe('TD-S00-013: 하위 폴더의 ESLint 설정 파일 하나로 코어 순수성·화면 XSS 린트가 통째로 꺼진다 (AC-S00-05·06, D-024, NFR-06)', () => {
  // ESLint 10은 파일마다 "그 파일의 폴더에서 가장 가까운 eslint.config.*"를 설정으로 쓴다.
  // lint 단계는 `eslint . --max-warnings 0`만 부르므로 packages/core·apps/web 아래에 설정 파일이 하나 생기면
  // 그 아래 파일에는 루트 설정(순수성·XSS 규칙)이 적용되지 않는다. 주석과 달리 noInlineConfig로도 막히지 않는다.
  it('전제: 하위 설정 파일이 없으면 임시 저장소의 lint 단계가 순수성·XSS 위반으로 실패한다', async () => {
    const dir = repoCopy(LINT_BASE)
    put(dir, ...CORE_PROBE)
    put(dir, ...WEB_PROBE)
    const run = await runStage(dir, 'lint')
    expect(run.code, tail(run)).toBe(1)
    expect(run.output).toContain('코어는 순수 함수')
    expect(run.output).toContain('NFR-06')
  }, 120_000)

  it.each([
    ['packages/core/eslint.config.mjs (빈 설정)', 'packages/core/eslint.config.mjs', 'export default [{}]\n', CORE_PROBE, '코어는 순수 함수'],
    ['packages/core/src/eslint.config.js (TS 파서만)', 'packages/core/src/eslint.config.js', WEB_LOCAL_CONFIG, CORE_PROBE, '코어는 순수 함수'],
    ['apps/web/eslint.config.js (Vite 템플릿 같은 화면 전용 설정)', 'apps/web/eslint.config.js', WEB_LOCAL_CONFIG, WEB_PROBE, 'NFR-06'],
  ] as const)('TD-S00-013: %s가 있어도 lint 단계는 실패해야 한다', async (_label, configPath, configText, probe, ruleText) => {
    const dir = repoCopy(LINT_BASE)
    put(dir, configPath, configText)
    put(dir, probe[0], probe[1])
    const run = await runStage(dir, 'lint')
    expect(run.code, `하위 설정 파일 ${configPath} 때문에 ${probe[0]}의 위반이 검사되지 않았다:\n${tail(run)}`).not.toBe(0)
    // 실패 이유가 출력에 드러나야 한다: 원래 규칙 위반 메시지, 또는 하위 설정 파일을 막았다는 안내(파일 이름)
    expect(run.output.includes(ruleText) || run.output.includes(configPath.split('/').at(-1) ?? configPath), tail(run)).toBe(true)
  }, 120_000)

  it('회귀: 저장소 안에 루트 말고 다른 ESLint 설정 파일이 없다', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\..+)?)$/.test(entry.name) && dirname(full) !== ROOT.replace(/\/$/, '')) found.push(relative(ROOT, full))
      }
    }
    walk(ROOT)
    expect(found).toEqual([])
  })
})

// ── TD-S00-014 ───────────────────────────────────────────────────────────

const FAILING_TEST = "import { expect, it } from 'vitest'\n\nit('TD-S00-999: 개발자가 고쳐야 하는 버그', () => {\n  expect(1 + 1).toBe(3)\n})\n"
const PASSING_TEST = "import { expect, it } from 'vitest'\n\nit('통과하는 회귀 테스트', () => {\n  expect(1 + 1).toBe(2)\n})\n"
const adversarialConfig = (extra: string): string =>
  [
    "import { defineConfig } from 'vitest/config'",
    "import { TEST_TIME_ZONE } from './scripts/verify/time-zone.mjs'",
    '',
    'process.env.TZ = TEST_TIME_ZONE',
    '',
    "export default defineConfig({ test: { name: 'adversarial', root: import.meta.dirname, include: ['tests/adversarial/**/*.test.ts'], " + extra + ' } })',
    '',
  ].join('\n')

describe('TD-S00-014: vitest.adversarial.config.ts를 고치면 실패하는 적대 테스트를 빼고도 adversarial 단계가 통과한다 (AC-S00-11(b)·12·15)', () => {
  // 개발자는 tests/를 고칠 수 없지만(보호 경로) 루트 vitest.adversarial.config.ts는 고칠 수 있다.
  // adversarial 단계는 실제로 돈 파일이 tests/adversarial 안인지만 보고, tests/adversarial의 모든 *.test.ts가 돌았는지·
  // 건너뛴 테스트가 없는지는 보지 않는다. 그래서 설정 한 줄로 test-domain의 실패 테스트가 게이트에서 빠진다.
  async function adversarialWith(config: string | null): Promise<StageRun> {
    const dir = repoCopy(['package.json', 'scripts/verify', ...(config === null ? ['vitest.adversarial.config.ts'] : [])])
    if (config !== null) put(dir, 'vitest.adversarial.config.ts', config)
    put(dir, 'tests/adversarial/probe/bug.test.ts', FAILING_TEST)
    put(dir, 'tests/adversarial/probe/ok.test.ts', PASSING_TEST)
    return runStage(dir, 'adversarial')
  }

  it('전제: 저장소의 실제 설정으로는 실패하는 적대 테스트 하나 때문에 adversarial 단계가 실패한다', async () => {
    const run = await adversarialWith(null)
    expect(run.code, tail(run)).toBe(1)
  }, 120_000)

  it.each([
    ['exclude로 실패 파일 빼기', "exclude: ['**/node_modules/**', '**/bug.test.ts']"],
    ['include를 좁히기', "include: ['tests/adversarial/**/ok.test.ts']"],
    ['testNamePattern으로 지적 ID 테스트 건너뛰기', "testNamePattern: '^(?!TD-)'"],
  ])('TD-S00-014: 설정에서 %s → adversarial 단계는 실패해야 한다', async (_label, extra) => {
    const run = await adversarialWith(adversarialConfig(extra))
    expect(run.code, `설정만 바꿔 실패하는 적대 테스트를 게이트에서 뺐는데 통과했다:\n${tail(run)}`).not.toBe(0)
  }, 120_000)
})

// ── TD-S00-015 ───────────────────────────────────────────────────────────

const TYPECHECK_BASE = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.json', 'vitest.config.ts', 'vitest.adversarial.config.ts', 'vitest.coverage.config.ts', 'scripts/verify', 'packages', 'apps', 'tests/adversarial']
const TYPE_ERROR = "export const probe: number = '타입 오류'\n"

describe('TD-S00-015: 타입 검사 범위(AC-S00-03) 안의 새 파일이 어떤 tsconfig에도 들지 않아 타입 오류가 통과한다', () => {
  // typecheck 단계는 패키지마다 tsconfig*.json을 tsc로 돌릴 뿐이고, 각 설정의 include는 src·test 같은 폴더 목록이다.
  // 그 목록 밖의 파일은 lint·test 단계에는 들어가는데 타입 검사만 빠진다.
  it('전제: 임시 저장소 복사본은 typecheck 단계를 통과한다', async () => {
    const run = await runStage(repoCopy(TYPECHECK_BASE), 'typecheck')
    expect(run.code, tail(run)).toBe(0)
  }, 120_000)

  it.each([
    ['packages/label/test/index.test.ts', 'packages/*의 test (test 단계는 @livejjim/label 프로젝트로 이 파일을 실행한다)'],
    ['apps/server/drizzle.config.ts', 'apps/* 루트의 도구 설정 파일 (lint 단계는 검사한다)'],
  ])('TD-S00-015: %s에 타입 오류 → typecheck 단계가 실패해야 한다 (%s)', async (path) => {
    const dir = repoCopy(TYPECHECK_BASE)
    put(dir, path, TYPE_ERROR)
    const run = await runStage(dir, 'typecheck')
    expect(run.code, `${path}의 타입 오류를 typecheck 단계가 보지 못했다:\n${tail(run)}`).not.toBe(0)
  }, 120_000)

  it('회귀: 지금 저장소의 범위 안 TS 파일은 모두 어떤 tsconfig 검사 대상에 들어 있다', async () => {
    // tsc --listFilesOnly로 각 설정이 실제로 검사하는 파일을 모은다
    const { spawnSync } = await import('node:child_process')
    const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
    const configs = ['tsconfig.json', ...['packages', 'apps'].flatMap((base) => readdirSync(join(ROOT, base)).flatMap((name) => readdirSync(join(ROOT, base, name)).filter((f) => /^tsconfig(\..+)?\.json$/.test(f)).map((f) => join(base, name, f))))]
    const included = new Set<string>()
    for (const config of configs) {
      const result = spawnSync(process.execPath, [tsc, '--listFilesOnly', '-p', config], { cwd: ROOT, encoding: 'utf8' })
      for (const line of result.stdout.split('\n')) if (line.trim() !== '') included.add(relative(ROOT, line.trim()))
    }
    const inScope: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) inScope.push(path)
      }
    }
    for (const dir of ['packages', 'apps', join('tests', 'adversarial')]) walk(dir)
    expect(inScope.length).toBeGreaterThan(30)
    expect(inScope.filter((path) => !included.has(path))).toEqual([])
    expect(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).toContain('"strict": true')
  }, 60_000)
})
