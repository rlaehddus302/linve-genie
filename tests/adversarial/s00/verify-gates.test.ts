// S00 검사 파이프라인(verify 단계) 자체 공격 (AC-S00-03·05·06·11·12·15).
// 저장소를 임시 폴더에 복사하고 그 안에서 실제 단계 스크립트(scripts/verify/stage.mjs)를 돌린다.
// 작업 트리·실제 node_modules/.cache는 건드리지 않는다(임시 폴더의 node_modules는 패키지별 링크만 둔 진짜 폴더).
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
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

/**
 * 단계 자식 프로세스 하나의 시간 제한(STAB). 지키려는 것은 단계의 결과(종료 코드·출력)지 걸린 시간이 아니다.
 * 측정(작은 복사본, 2026-10-23): apps/server 복사본 typecheck가 조용할 때 27~34초, yes 12개 + 다른 시험이 함께 돌 때(load 55~100)
 * 57·71·113·137·149초 — 90초 제한에서는 SIGKILL로 거의 매번 실패했다. 관측 최댓값(149초)의 2배로 둔다.
 * 시간 초과는 여전히 단계 결과로 세지 않고 시험 실패로 던진다(아래 runStage).
 */
const STAGE_LIMIT_MS = 300_000
/** 시험 하나의 제한: 단계 하나 + 복사·준비 여유 */
const STAGE_TEST_TIMEOUT_MS = STAGE_LIMIT_MS + 30_000

interface StageRun {
  readonly code: number | null
  readonly output: string
}

/** 임시 저장소에서 `node scripts/verify/stage.mjs <단계>` (= pnpm <단계>)를 돌린다 */
function runStage(dir: string, stage: string): Promise<StageRun> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('VITEST') || key === 'TEST') delete env[key]
  // `pnpm <단계>`처럼 node_modules/.bin을 PATH 맨 앞에 둔다 (pnpm run이 하는 일과 같다)
  env['PATH'] = `${join(ROOT, 'node_modules', '.bin')}${delimiter}${env['PATH'] ?? ''}`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join('scripts', 'verify', 'stage.mjs'), stage], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, STAGE_LIMIT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      // 시간 초과로 멈춘 것(code null)을 단계 실패로 세면 '실패해야 한다'(not.toBe(0)) 시험이 거짓으로 통과한다 → 시험 자체를 실패시킨다
      if (timedOut) reject(new Error(`${stage} 단계가 ${STAGE_LIMIT_MS / 1000}초 안에 끝나지 않아 멈췄다 — 단계 결과가 아니다:\n${output.split('\n').slice(-25).join('\n')}`))
      else resolve({ code, output })
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
  }, STAGE_TEST_TIMEOUT_MS)

  it.each([
    ['packages/core/eslint.config.mjs (빈 설정)', 'packages/core/eslint.config.mjs', 'export default [{}]\n', CORE_PROBE, '코어는 순수 함수'],
    ['packages/core/src/eslint.config.js (TS 파서만)', 'packages/core/src/eslint.config.js', WEB_LOCAL_CONFIG, CORE_PROBE, '코어는 순수 함수'],
    ['apps/web/eslint.config.js (Vite 템플릿 같은 화면 전용 설정)', 'apps/web/eslint.config.js', WEB_LOCAL_CONFIG, WEB_PROBE, 'NFR-06'],
    ['packages/core/eslint.config.ts (TS 설정 파일, 회귀)', 'packages/core/eslint.config.ts', 'export default [{}]\n', CORE_PROBE, '코어는 순수 함수'],
  ] as const)('TD-S00-013: %s가 있어도 lint 단계는 실패해야 한다', async (_label, configPath, configText, probe, ruleText) => {
    const dir = repoCopy(LINT_BASE)
    put(dir, configPath, configText)
    put(dir, probe[0], probe[1])
    const run = await runStage(dir, 'lint')
    expect(run.code, `하위 설정 파일 ${configPath} 때문에 ${probe[0]}의 위반이 검사되지 않았다:\n${tail(run)}`).not.toBe(0)
    // 실패 이유가 출력에 드러나야 한다: 원래 규칙 위반 메시지, 또는 하위 설정 파일을 막았다는 안내(파일 이름)
    expect(run.output.includes(ruleText) || run.output.includes(configPath.split('/').at(-1) ?? configPath), tail(run)).toBe(true)
  }, STAGE_TEST_TIMEOUT_MS)

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

/** 임시 저장소(실패하는 적대 테스트 1개 + 통과 1개)에서 adversarial 단계를 돌린다. config가 null이면 저장소의 실제 설정 */
async function adversarialWith(config: string | null): Promise<StageRun> {
  const dir = repoCopy(['package.json', 'tsconfig.base.json', 'tsconfig.json', 'scripts/verify', ...(config === null ? ['vitest.adversarial.config.ts'] : [])])
  if (config !== null) put(dir, 'vitest.adversarial.config.ts', config)
  put(dir, 'tests/adversarial/probe/bug.test.ts', FAILING_TEST)
  put(dir, 'tests/adversarial/probe/ok.test.ts', PASSING_TEST)
  return runStage(dir, 'adversarial')
}

describe('TD-S00-014: vitest.adversarial.config.ts를 고치면 실패하는 적대 테스트를 빼고도 adversarial 단계가 통과한다 (AC-S00-11(b)·12·15)', () => {
  // 개발자는 tests/를 고칠 수 없지만(보호 경로) 루트 vitest.adversarial.config.ts는 고칠 수 있다.
  // adversarial 단계는 실제로 돈 파일이 tests/adversarial 안인지만 보고, tests/adversarial의 모든 *.test.ts가 돌았는지·
  // 건너뛴 테스트가 없는지는 보지 않는다. 그래서 설정 한 줄로 test-domain의 실패 테스트가 게이트에서 빠진다.
  it('전제: 저장소의 실제 설정으로는 실패하는 적대 테스트 하나 때문에 adversarial 단계가 실패한다', async () => {
    const run = await adversarialWith(null)
    expect(run.code, tail(run)).toBe(1)
  }, STAGE_TEST_TIMEOUT_MS)

  it.each([
    ['exclude로 실패 파일 빼기', "exclude: ['**/node_modules/**', '**/bug.test.ts']"],
    ['include를 좁히기', "include: ['tests/adversarial/**/ok.test.ts']"],
    ['testNamePattern으로 지적 ID 테스트 건너뛰기', "testNamePattern: '^(?!TD-)'"],
  ])('TD-S00-014: 설정에서 %s → adversarial 단계는 실패해야 한다', async (_label, extra) => {
    const run = await adversarialWith(adversarialConfig(extra))
    expect(run.code, `설정만 바꿔 실패하는 적대 테스트를 게이트에서 뺐는데 통과했다:\n${tail(run)}`).not.toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)
})

// ── TD-S00-018 ───────────────────────────────────────────────────────────

describe('TD-S00-018: vitest.adversarial.config.ts의 타입 검사 전용 모드(typecheck.only)로 실패하는 적대 테스트가 "통과"로 바뀐다 (AC-S00-11(b)·15)', () => {
  // TD-S00-014 수정은 "돈 파일 집합 = 디스크 파일 집합"과 "건너뛴 테스트 0개"만 본다.
  // Vitest의 typecheck 모드는 테스트 파일을 실행하지 않고 tsc로 타입만 본 뒤, 타입 오류가 없으면 모든 테스트를 passed로 보고한다.
  // 그래서 설정에 한 줄을 넣으면 파일 집합·테스트 수·상태가 모두 맞는 채로 expect(1 + 1).toBe(3)이 "통과"한다.
  const TYPECHECK_ONLY = "typecheck: { enabled: true, only: true, include: ['tests/adversarial/**/*.test.ts'] }"
  const TYPECHECK_AND_NO_RUN = adversarialConfig("typecheck: { enabled: true, include: ['tests/adversarial/**/*.test.ts'] }").replace(
    "include: ['tests/adversarial/**/*.test.ts'], typecheck",
    'include: [], typecheck',
  )

  it('전제: 두 번째 변형 설정은 실행 include만 비우고 타입 검사 include에 적대 테스트를 둔다', () => {
    expect(TYPECHECK_AND_NO_RUN).toContain("include: [], typecheck: { enabled: true, include: ['tests/adversarial/**/*.test.ts'] }")
  })

  it.each([
    ['typecheck: { enabled, only, include: 적대 테스트 }', adversarialConfig(TYPECHECK_ONLY)],
    ['typecheck: { enabled, include: 적대 테스트 } + 실행 include 비우기', TYPECHECK_AND_NO_RUN],
  ])('TD-S00-018: 설정에 %s → adversarial 단계는 실패해야 한다', async (_label, config) => {
    const run = await adversarialWith(config)
    // tsc를 못 찾아서 실패한 것이면 이 공격을 확인한 것이 아니다 (pnpm 단계처럼 node_modules/.bin이 PATH에 있어야 한다)
    expect(run.output, tail(run)).not.toContain('Spawning typechecker failed')
    expect(run.code, `실패하는 적대 테스트를 실행하지 않고 타입만 보게 바꿨는데 adversarial 단계가 통과했다:\n${tail(run)}`).not.toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)
})

// ── TD-S00-015 ───────────────────────────────────────────────────────────

/**
 * typecheck 단계 공격용 작은 복사본(STAB): 루트 설정·단계 스크립트 + 공격 대상 패키지(와 그 패키지가 상대 경로로 가져오는 패키지)만 담는다.
 * 저장소 전체를 복사하면 복사본 typecheck 하나가 혼자 30초, CPU 부하(yes 12개)에서 60~85초 걸려 90초 제한에 걸렸다.
 * 시간 대부분은 tsc 설정 하나하나(루트 tsconfig.json이 tests/adversarial 전체를 끌어와 1,289개 파일, apps/server·apps/web 각 1,200~1,300개)다.
 * 빼도 단계는 복사본 안의 범위 전체(packages/*·apps/*·루트 TS)를 그대로 대조하므로 '범위 밖 파일이 타입 오류를 숨기지 못한다'는 뜻은 같다.
 * 상대 경로 의존이 빠지면 '전제' 시험(같은 복사본이 통과)이 먼저 실패한다.
 */
const TYPECHECK_ROOT = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.json', 'vitest.config.ts', 'vitest.adversarial.config.ts', 'vitest.coverage.config.ts', 'scripts/verify']
/** packages/core: 골든 시험이 packages/voice 소스와 apps/server/src/product-import.ts(코어만 씀)를 상대 경로로 가져온다 */
const TYPECHECK_CORE = [...TYPECHECK_ROOT, 'packages/core', 'packages/voice', 'apps/server/src/product-import.ts']
/** packages/label: 다른 패키지 소스를 상대 경로로 가져오지 않는다 */
const TYPECHECK_LABEL = [...TYPECHECK_ROOT, 'packages/label']
/** apps/server: 기존 순수 조회 어댑터를 APP1b 서버 읽기가 재사용한다. 상대 경로 의존도 복사해 같은 타입 오류 공격을 유지한다. */
const TYPECHECK_SERVER = [...TYPECHECK_ROOT, 'apps/server', 'packages/core', 'packages/voice', 'packages/documents', 'packages/label',
  ...['scope-data', 'derive', 'received', 'voice', 'kst', 'sale-line', 'words'].map((name) => `apps/web/src/lib/${name}.ts`),
  ...['types', 'deposit-types', 'parcel-types'].map((name) => `apps/web/src/api/${name}.ts`),
]
const TYPE_ERROR = "export const probe: number = '타입 오류'\n"

describe('TD-S00-015: 타입 검사 범위(AC-S00-03) 안의 새 파일이 어떤 tsconfig에도 들지 않아 타입 오류가 통과한다', () => {
  // typecheck 단계는 패키지마다 tsconfig*.json을 tsc로 돌릴 뿐이고, 각 설정의 include는 src·test 같은 폴더 목록이다.
  // 그 목록 밖의 파일은 lint·test 단계에는 들어가는데 타입 검사만 빠진다.
  it.each([
    ['packages/label', TYPECHECK_LABEL],
    ['apps/server', TYPECHECK_SERVER],
  ] as const)('전제: 임시 저장소 복사본(%s)은 typecheck 단계를 통과한다', async (_label, copy) => {
    const run = await runStage(repoCopy(copy), 'typecheck')
    expect(run.code, tail(run)).toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)

  it.each([
    ['packages/label/test/index.test.ts', 'packages/*의 test (test 단계는 @livejjim/label 프로젝트로 이 파일을 실행한다)', TYPECHECK_LABEL],
    ['apps/server/drizzle.config.ts', 'apps/* 루트의 도구 설정 파일 (lint 단계는 검사한다)', TYPECHECK_SERVER],
  ] as const)('TD-S00-015: %s에 타입 오류 → typecheck 단계가 실패해야 한다 (%s)', async (path, _why, copy) => {
    const dir = repoCopy(copy)
    put(dir, path, TYPE_ERROR)
    const run = await runStage(dir, 'typecheck')
    expect(run.code, `${path}의 타입 오류를 typecheck 단계가 보지 못했다:\n${tail(run)}`).not.toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)

  it('회귀: 지금 저장소의 범위 안 TS 파일은 모두 어떤 tsconfig 검사 대상에 들어 있다', () => {
    // tsc --listFilesOnly로 각 설정이 실제로 검사하는 파일을 모은다
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

// ── TD-S00-017 ───────────────────────────────────────────────────────────

/** 복사본의 설정 파일 하나를 고친다. 고칠 자리가 없으면(원본이 바뀌었으면) 테스트가 먼저 실패한다 */
function patch(dir: string, path: string, from: string, to: string): void {
  const text = readFileSync(join(dir, path), 'utf8')
  expect(text, `${path}에 '${from}'가 없다 — 테스트의 고칠 자리를 갱신한다`).toContain(from)
  writeFileSync(join(dir, path), text.replace(from, to))
}

describe('TD-S00-017: tsconfig에 "noCheck": true 한 줄이면 typecheck 단계가 타입 오류를 하나도 보지 않고 "모두 검사"로 통과한다 (AC-S00-03)', () => {
  // typecheck 단계는 tsc --showConfig로 strict·noUncheckedIndexedAccess·strict 계열 플래그만 확인한다.
  // TypeScript 6의 noCheck는 strict를 켠 채로 의미 검사(타입 오류 보고)를 통째로 끈다. tsc는 종료 코드 0을 내고,
  // 단계 요약은 "범위 안 TS 파일 N개 모두 검사 (strict·noUncheckedIndexedAccess 확인)"이라고 적는다.
  it('전제: noCheck 없이 packages/core/src와 apps/server/src의 같은 타입 오류는 typecheck 단계를 실패시킨다', async () => {
    const dir = repoCopy(TYPECHECK_SERVER)
    put(dir, 'packages/core/src/probe.ts', TYPE_ERROR)
    put(dir, 'apps/server/src/probe.ts', TYPE_ERROR)
    const run = await runStage(dir, 'typecheck')
    expect(run.code, tail(run)).toBe(1)
    expect(run.output).toContain('TS2322')
  }, STAGE_TEST_TIMEOUT_MS)

  it.each([
    ['tsconfig.base.json (모든 설정이 상속)', 'tsconfig.base.json', '"strict": true,', '"strict": true,\n    "noCheck": true,', 'packages/core/src/probe.ts'],
    ['apps/server/tsconfig.json (패키지 설정 하나)', 'apps/server/tsconfig.json', '"types": ["node"]', '"types": ["node"],\n    "noCheck": true', 'apps/server/src/probe.ts'],
  ])('TD-S00-017: %s에 noCheck → 타입 오류가 있는 범위 안 파일 때문에 typecheck 단계는 실패해야 한다', async (_label, config, from, to, probe) => {
    const dir = repoCopy(TYPECHECK_SERVER)
    patch(dir, config, from, to)
    put(dir, probe, TYPE_ERROR)
    const run = await runStage(dir, 'typecheck')
    expect(run.code, `${config}의 noCheck 때문에 ${probe}의 타입 오류를 typecheck 단계가 보지 못했다:\n${tail(run)}`).not.toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)
})

// ── TD-S00-019 ───────────────────────────────────────────────────────────

describe('TD-S00-019: 범위 안의 선언 파일(.d.ts)은 타입 검사도, 검사 범위 대조도 받지 않아 오타 난 타입이 조용히 any가 된다 (AC-S00-03)', () => {
  // tsconfig.base.json의 skipLibCheck: true는 node_modules뿐 아니라 저장소 안의 모든 .d.ts의 오류를 숨긴다.
  // typecheck 단계의 범위 대조(TD-S00-015 수정)도 .d.ts를 "검사하지 않으므로" 뺀다.
  // 그래서 packages/core/src에 손으로 쓴 타입 선언 파일의 오타(없는 타입 이름)는 오류 없이 any처럼 풀리고,
  // 그 타입을 쓰는 .ts 파일의 잘못된 값도 통과한다. 지금 범위 안에 .d.ts는 없다(앞으로 생길 파일의 구멍).
  const CLAIM_TYPES = 'export interface ClaimRow {\n  readonly product: Strnig\n  readonly qty: number\n}\nexport declare function total(rows: readonly ClaimRow[]): numbr\n'
  const USES_CLAIM_TYPES = "import type { ClaimRow } from './claim-types.d.ts'\n\n// product는 문자열이어야 하는데 숫자를 넣는다\nexport const row: ClaimRow = { product: 15, qty: 1 }\n"

  it('전제: 같은 내용을 .ts 파일에 쓰면 typecheck 단계가 실패한다', async () => {
    const dir = repoCopy(TYPECHECK_CORE)
    put(dir, 'packages/core/src/claim-types.ts', CLAIM_TYPES.replace('export declare function total(rows: readonly ClaimRow[]): numbr\n', 'export type Total = numbr\n'))
    put(dir, 'packages/core/src/probe.ts', USES_CLAIM_TYPES.replace('./claim-types.d.ts', './claim-types.ts'))
    const run = await runStage(dir, 'typecheck')
    expect(run.code, tail(run)).toBe(1)
    expect(run.output).toContain('Strnig')
  }, STAGE_TEST_TIMEOUT_MS)

  it('TD-S00-019: packages/core/src/claim-types.d.ts의 없는 타입 이름(Strnig·numbr) → typecheck 단계는 실패해야 한다', async () => {
    const dir = repoCopy(TYPECHECK_CORE)
    put(dir, 'packages/core/src/claim-types.d.ts', CLAIM_TYPES)
    put(dir, 'packages/core/src/probe.ts', USES_CLAIM_TYPES)
    const run = await runStage(dir, 'typecheck')
    expect(run.code, `범위 안 선언 파일의 타입 오류를 typecheck 단계가 보지 못했다:\n${tail(run)}`).not.toBe(0)
  }, STAGE_TEST_TIMEOUT_MS)
})

// ── TD-S00-020 ───────────────────────────────────────────────────────────

describe('TD-S00-020: 검사 단계가 소스로 보는 src/build·src/dist·src/coverage·src/.vite를 git은 무시한다 — 작업 트리에선 verify 통과, 커밋에는 파일이 빠진다 (AC-S00-01·10)', () => {
  // 라운드 1에서 lint 무시 범위를 저장소 루트와 패키지 바로 아래 결과물 폴더로 좁혔고(소스 안 build 폴더도 검사),
  // typecheck·test 단계의 대상 목록도 같은 기준이다(stages.mjs PACKAGE_OUTPUT_DIRS). 그런데 .gitignore는
  // `build/`·`dist/`·`coverage/`·`.vite/`를 깊이와 상관없이 무시한다. 그래서 apps/server/src/build/router.ts 같은 소스는
  // 작업 트리의 verify(게이트)를 통과하지만 `git add -A`에 들어가지 않고 `git status`에도 보이지 않는다(보호 경로 게이트의
  // "커밋 안 된 변경" 검사도 못 본다). 깨끗한 체크아웃(AC-S00-01, CI 단일 명령)에서는 그 파일이 없다.
  const gitIgnored = (path: string): boolean => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: ROOT, encoding: 'utf8' })
    if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore 실패: ${result.stderr}`)
    return result.status === 0
  }

  it('회귀: 실제 결과물·비밀값 폴더는 계속 git이 무시한다', () => {
    for (const path of ['apps/web/dist/index.html', 'packages/core/dist/index.js', 'coverage/coverage-summary.json', 'apps/web/.vite/deps/x.js', 'node_modules/x/index.js', 'packages/core/node_modules/x/index.js', '.env', '.env.local']) {
      expect(gitIgnored(path), path).toBe(true)
    }
    expect(gitIgnored('.env.example')).toBe(false)
  })

  it.each(['packages/core/src/build/plan.ts', 'apps/server/src/build/router.ts', 'apps/web/src/dist/Chat.tsx', 'packages/label/src/coverage/sheet.ts', 'packages/core/src/.vite/x.ts', 'packages/core/test/build/plan.test.ts'])(
    'TD-S00-020: 검사 단계가 소스로 보는 %s는 git이 무시하면 안 된다',
    (path) => {
      expect(gitIgnored(path), `${path}는 lint·typecheck·test 단계 대상인데 .gitignore 때문에 커밋되지 않는다`).toBe(false)
    },
  )
})
