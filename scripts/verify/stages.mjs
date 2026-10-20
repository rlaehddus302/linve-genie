// pnpm verify 단계 정의 (AC-S00-10~14). 보호 경로(scripts/harness/) 밖에 둔다.
// 단계: typecheck → lint → test → golden → adversarial → e2e → coverage
// 각 단계는 자기 대상만 돈다. 결과: { name, status: 'pass'|'fail'|'skip', detail, durationMs }
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { TEST_TIME_ZONE } from './time-zone.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const STAGES = ['typecheck', 'lint', 'test', 'golden', 'adversarial', 'e2e', 'coverage']
/** 시간대를 고정하는 단계 (D-026) */
export const TZ_STAGES = new Set(['test', 'golden', 'adversarial', 'coverage'])
/**
 * 성능 시험(D-902): 이름이 *.perf.test.* · *.perf.spec.* 인 파일. 걸린 시간(p99·배수)을 재므로 기계 부하에 따라 흔들린다.
 * pnpm verify(정확성)에서는 빼고, pnpm perf로 부하 없는 때(통합 시점)에 오케스트레이터가 돌린다.
 */
export const isPerfTest = (path) => /\.perf\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const PERF_EXCLUDE = ['--exclude', '**/*.perf.test.*']
/** 코어 커버리지 기준 (AC-S00-13). vitest.coverage.config.ts 임계값과 별개로 여기서도 다시 확인한다. */
export const COVERAGE_MINIMUM = 95

const CACHE = join(ROOT, 'node_modules', '.cache', 'livejjim-verify')
const toPosix = (path) => path.split(sep).join('/')
const rel = (path) => toPosix(relative(ROOT, path))

/** 설치된 패키지의 실행 파일(JS)을 node로 직접 띄운다 (셸·OS 차이 없음) */
function bin(pkg, name = pkg) {
  const manifestPath = join(ROOT, 'node_modules', pkg, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`${pkg}가 설치되지 않았다 (pnpm install --frozen-lockfile 먼저)`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name]
  if (!entry) throw new Error(`${pkg}에 실행 파일 ${name}이 없다`)
  return join(dirname(manifestPath), entry)
}

/** 자식 프로세스를 띄워 출력을 그대로 보여 주면서 모은다 */
function exec(args, { tz = false, quiet = false, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(tz ? { TZ: TEST_TIME_ZONE } : {}), ...extraEnv }
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (!quiet) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      if (!quiet) process.stderr.write(chunk)
    })
    child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.message}` }))
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), output }))
  })
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// ── 워크스페이스 ─────────────────────────────────────────────────────────

/** pnpm-workspace.yaml의 `packages:` 목록(`dir/*` 형태)에서 바탕 폴더(`packages`, `apps`)를 찾는다 */
export function workspaceBases() {
  const text = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const globs = []
  let inPackages = false
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const m = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*(#.*)?$/.exec(line)
      if (m) globs.push(m[1])
      else if (/^\S/.test(line)) inPackages = false
    }
  }
  return globs.map((glob) => {
    if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) throw new Error(`pnpm-workspace.yaml: 'dir/*' 형태만 지원한다 (${glob})`)
    return join(ROOT, glob.slice(0, -2))
  })
}

/** 워크스페이스 패키지 폴더 (바탕 폴더 바로 아래, package.json이 있는 폴더) */
export function workspacePackages() {
  const dirs = []
  for (const base of workspaceBases()) {
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name)
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  return dirs
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, predicate, out)
    else if (predicate(full)) out.push(full)
  }
  return out.sort()
}

/** 패키지 바로 아래의 빌드·측정 결과 폴더. eslint.config.mjs의 무시 범위와 같다(소스 안의 같은 이름 폴더는 검사 대상). */
const PACKAGE_OUTPUT_DIRS = new Set(['dist', 'build', 'coverage', '.vite'])

/**
 * `packages/*`·`apps/*` 아래의 파일을 모두 찾는다. package.json이 없는 폴더도 포함한다(범위 = 폴더, AC-S00-03).
 * node_modules와 패키지 바로 아래의 빌드·측정 결과 폴더만 뺀다.
 */
function workspaceFiles(predicate) {
  const out = []
  for (const base of workspaceBases()) {
    if (!existsSync(base)) continue
    for (const pkg of readdirSync(base, { withFileTypes: true })) {
      const pkgPath = join(base, pkg.name)
      if (!pkg.isDirectory()) {
        if (predicate(pkgPath)) out.push(pkgPath)
        continue
      }
      if (pkg.name === 'node_modules') continue
      for (const entry of readdirSync(pkgPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || (entry.isDirectory() && PACKAGE_OUTPUT_DIRS.has(entry.name))) continue
        const full = join(pkgPath, entry.name)
        if (entry.isDirectory()) walk(full, predicate, out)
        else if (predicate(full)) out.push(full)
      }
    }
  }
  return out.sort()
}

/** 경로 비교용: 심볼릭 링크(macOS의 /tmp → /private/tmp 등)를 푼 절대 경로 */
function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const listLines = (output) => output.split('\n').map((line) => line.trim()).filter((line) => line !== '' && isAbsolute(line))
const bullet = (items) => items.map((item) => `  ${item}`).join('\n')

// ── 단계 ─────────────────────────────────────────────────────────────────

const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'strictBuiltinIteratorReturn',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
]

/** 선언 파일(.d.ts·.d.mts·.d.cts·.d.<확장자>.ts) */
const isDeclarationFile = (path) => /\.d(?:\.[^./\\]+)?\.[cm]?ts$/.test(path)
/** 타입 검사 대상 확장자. 선언 파일은 skipLibCheck로 검사하지 않으므로 뺀다(대신 범위 안에 두는 것 자체를 막는다) */
const isTypeScriptSource = (path) => /\.(?:[cm]?ts|tsx)$/.test(path) && !isDeclarationFile(path)

/**
 * 범위 안 선언 파일 (SA-S00-011). skipLibCheck가 node_modules뿐 아니라 저장소 안 .d.ts의 오류도 숨기므로,
 * 손으로 쓴 선언 파일에 넣은 잘못된 타입은 어디서도 잡히지 않는다. 범위 안에는 두지 않는다.
 */
export function declarationFilesInScope() {
  const files = [
    ...workspaceFiles(isDeclarationFile),
    ...walk(join(ROOT, 'tests', 'adversarial'), isDeclarationFile),
    ...walk(join(ROOT, 'tests', 'e2e'), isDeclarationFile),
  ]
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && isDeclarationFile(entry.name)) files.push(join(ROOT, entry.name))
  }
  return files.sort()
}

/**
 * 타입 검사 범위(AC-S00-03): `packages/*`·`apps/*` 아래 전부(src·test·패키지 루트의 도구 설정 파일), `tests/adversarial/**`,
 * 저장소 루트의 TS 파일. 어느 tsconfig의 include에도 들지 않은 파일은 타입 오류가 있어도 tsc가 보지 않으므로,
 * 범위 안 파일이 모두 어떤 설정의 검사 대상인지 따로 확인한다 (TD-S00-015).
 */
export function typecheckScope() {
  const files = [
    ...workspaceFiles(isTypeScriptSource),
    ...walk(join(ROOT, 'tests', 'adversarial'), isTypeScriptSource),
    ...walk(join(ROOT, 'tests', 'e2e'), isTypeScriptSource),
  ]
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && isTypeScriptSource(entry.name)) files.push(join(ROOT, entry.name))
  }
  return files.sort()
}

/** E2E 타입 검사 설정 (DOM 포함, RA-S05-005) */
const E2E_TSCONFIG = join(ROOT, 'tests', 'e2e', 'tsconfig.json')

async function typecheck() {
  const configs = []
  const problems = []
  for (const dir of workspacePackages()) {
    const own = readdirSync(dir).filter((f) => /^tsconfig(\..+)?\.json$/.test(f)).sort()
    if (!own.includes('tsconfig.json')) problems.push(`타입 검사 설정이 없다: ${rel(dir)}/tsconfig.json`)
    for (const file of own) configs.push(join(dir, file))
  }
  configs.push(join(ROOT, 'tsconfig.json'))
  if (existsSync(join(ROOT, 'tests', 'e2e'))) {
    if (existsSync(E2E_TSCONFIG)) configs.push(E2E_TSCONFIG)
    else problems.push('E2E 타입 검사 설정이 없다: tests/e2e/tsconfig.json')
  }
  const tsc = bin('typescript', 'tsc')

  // 모든 설정이 strict·noUncheckedIndexedAccess를 상속하고 끄지 않는지 (AC-S00-03)
  for (const config of configs) {
    const shown = await exec([tsc, '--showConfig', '-p', config], { quiet: true })
    const options = shown.code === 0 ? readJsonText(shown.output)?.compilerOptions : undefined
    if (!options) {
      problems.push(`${rel(config)}: 설정을 읽지 못했다\n${shown.output.trim()}`)
      continue
    }
    if (options.strict !== true) problems.push(`${rel(config)}: strict가 꺼져 있다`)
    if (options.noUncheckedIndexedAccess !== true) problems.push(`${rel(config)}: noUncheckedIndexedAccess가 꺼져 있다`)
    for (const flag of STRICT_FAMILY) if (options[flag] === false) problems.push(`${rel(config)}: ${flag}를 끄면 안 된다`)
    // noCheck는 strict를 켠 채로 타입 오류 보고를 통째로 끈다 (SA-S00-009). 아래 tsc 실행에서도 --noCheck false로 덮어쓴다.
    if (options.noCheck === true) problems.push(`${rel(config)}: noCheck를 켜면 타입 오류를 하나도 보지 않는다 — 지운다`)
  }

  // 범위 안 TS 파일이 모두 어떤 설정의 검사 대상인지 (AC-S00-03 "범위 안 어느 파일에든", TD-S00-015)
  const listed = await Promise.all(configs.map((config) => exec([tsc, '--listFilesOnly', '-p', config], { quiet: true })))
  const checked = new Set(listed.flatMap((r) => listLines(r.output)).map(real))
  const scope = typecheckScope()
  const unchecked = scope.filter((file) => !checked.has(real(file))).map(rel)
  if (unchecked.length > 0) {
    problems.push(
      `어떤 tsconfig의 검사 대상에도 들어 있지 않은 파일 ${unchecked.length}개 — 이대로면 타입 오류가 있어도 통과한다. 알맞은 tsconfig의 include에 넣는다 (AC-S00-03):\n${bullet(unchecked)}`,
    )
  }

  const declarations = declarationFilesInScope().map(rel)
  if (declarations.length > 0) {
    problems.push(
      `범위 안 선언 파일 ${declarations.length}개 — skipLibCheck 때문에 그 안의 타입 오류는 검사되지 않는다. .ts 파일에 export type으로 옮긴다` +
        ` (Vite 환경 타입은 tsconfig의 types: ["vite/client"]로):\n${bullet(declarations)}`,
    )
  }

  let failed = 0
  for (const config of configs) {
    process.stdout.write(`tsc --noEmit -p ${rel(config)}\n`)
    const result = await exec([tsc, '--noEmit', '--noCheck', 'false', '-p', config])
    if (result.code !== 0) failed++
  }
  for (const problem of problems) process.stdout.write(`✗ ${problem}\n`)
  const ok = failed === 0 && problems.length === 0
  const outsideNote = unchecked.length > 0 ? ` · 검사 대상 밖 파일 ${unchecked.length}개 (${unchecked.join(', ')})` : ''
  return {
    status: ok ? 'pass' : 'fail',
    detail: ok
      ? `설정 ${configs.length}개 · 범위 안 TS 파일 ${scope.length}개 모두 검사 (strict·noUncheckedIndexedAccess 확인)`
      : `설정 ${configs.length}개 중 타입 오류 ${failed}개 · 설정 문제 ${problems.length}개${outsideNote}`,
  }
}

function readJsonText(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** lint 단계가 쓰는 유일한 ESLint 설정 (루트) */
const ESLINT_CONFIG = 'eslint.config.mjs'
const ESLINT_CONFIG_NAME = /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\..*)?)$/
/** 다른 ESLint 설정 파일을 찾지 않는 폴더: 설치물, git, 오케스트레이터 소유(.claude, lint 무시 범위) */
const ESLINT_SCAN_SKIP = new Set(['node_modules', '.git', '.claude'])

/**
 * 루트 eslint.config.mjs 말고 다른 ESLint 설정 파일 (TD-S00-013).
 * ESLint 10은 파일마다 그 파일 폴더에서 가장 가까운 eslint.config.*를 쓴다. 하위 폴더에 설정 파일이 하나 생기면
 * 그 아래 파일에는 루트 규칙(코어 순수성 AC-S00-05, 화면 XSS AC-S00-06)이 하나도 적용되지 않는다.
 * lint 단계는 --config로 루트 설정을 강제하고, 그런 파일이 있으면 경로를 보여 주고 실패한다.
 */
export function strayEslintConfigs() {
  const found = []
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ESLINT_SCAN_SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) scan(full)
      else if (ESLINT_CONFIG_NAME.test(entry.name) && full !== join(ROOT, ESLINT_CONFIG)) found.push(full)
    }
  }
  scan(ROOT)
  return found.sort()
}

/**
 * 린트 범위 전체에서 (1) 인라인 설정 주석이 무시되고(noInlineConfig) (2) @ts-nocheck·@ts-ignore 금지 규칙이 오류인지
 * ESLint가 실제로 계산한 설정으로 확인한다 (SA-S00-013). 둘 중 하나라도 빠지면 eslint-disable 한 줄 + // @ts-nocheck로
 * lint·typecheck를 함께 피할 수 있다.
 */
/** 린트 확인용 패키지 폴더. pnpm-workspace.yaml이 없으면(일부만 복사한 저장소) packages/*·apps/* 폴더를 직접 본다.
 *  워크스페이스 설정 자체가 없는 문제는 typecheck 단계가 실패로 잡는다. */
function lintProbeDirs() {
  try {
    return workspacePackages()
  } catch {
    return ['packages', 'apps'].flatMap((base) =>
      existsSync(join(ROOT, base))
        ? readdirSync(join(ROOT, base), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
            .map((entry) => join(ROOT, base, entry.name))
        : [],
    )
  }
}

export async function lintGuardProblems() {
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, ESLINT_CONFIG) })
  const probes = [join(ROOT, '__probe__.ts'), join(ROOT, 'tests', 'adversarial', '__probe__.ts'), join(ROOT, 'tests', 'e2e', '__probe__.ts')]
  for (const dir of lintProbeDirs()) probes.push(join(dir, 'src', '__probe__.ts'), join(dir, 'test', '__probe__.ts'), join(dir, '__probe__.ts'))
  const problems = []
  for (const probe of probes) {
    const config = await eslint.calculateConfigForFile(probe)
    const where = rel(probe).replace('__probe__.ts', '*.ts')
    if (!config) {
      problems.push(`${where}: 린트 대상에서 빠져 있다`)
      continue
    }
    if (config.linterOptions?.noInlineConfig !== true) problems.push(`${where}: noInlineConfig가 꺼져 있다 — 주석으로 규칙을 끌 수 있다`)
    const rule = config.rules?.['@typescript-eslint/ban-ts-comment']
    const level = Array.isArray(rule) ? rule[0] : rule
    if (level !== 2 && level !== 'error') problems.push(`${where}: @typescript-eslint/ban-ts-comment가 오류가 아니다 — @ts-nocheck·@ts-ignore를 쓸 수 있다`)
  }
  return problems
}

async function lint() {
  const stray = strayEslintConfigs().map(rel)
  const guards = await lintGuardProblems()
  // --config: 폴더별 설정 파일을 찾지 않고 루트 설정 하나로 모든 파일을 검사한다
  const result = await exec([bin('eslint'), '--config', join(ROOT, ESLINT_CONFIG), '.', '--max-warnings', '0'])
  if (stray.length > 0) {
    process.stdout.write(
      `✗ 루트 ${ESLINT_CONFIG} 말고 다른 ESLint 설정 파일이 있다 ${stray.length}개 — 지우고 규칙은 루트 설정에만 둔다.\n` +
        `  이런 파일이 있으면 그 아래 파일에 코어 순수성(AC-S00-05)·화면 XSS(AC-S00-06) 규칙이 빠진다:\n${bullet(stray)}\n`,
    )
  }
  const m = /(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(result.output)
  const counts = result.code === 0 ? '오류 0 · 경고 0' : m ? `오류 ${m[2]} · 경고 ${m[3]}` : `ESLint 종료 코드 ${result.code}`
  for (const problem of guards) process.stdout.write(`✗ ${problem}\n`)
  const strayNote = stray.length > 0 ? ` · 다른 ESLint 설정 파일 ${stray.length}개 (${stray.join(', ')})` : ''
  const guardNote = guards.length > 0 ? ` · 주석 우회 방지 설정 문제 ${guards.length}개` : ''
  const ok = result.code === 0 && stray.length === 0 && guards.length === 0
  return { status: ok ? 'pass' : 'fail', detail: `${counts} (--max-warnings 0, 설정 ${ESLINT_CONFIG} 하나)${strayNote}${guardNote}` }
}

/** 실제로 실행된 테스트의 상태. 그 밖(skipped·pending·todo·disabled)은 건너뛴 것이다 */
const RAN_STATUSES = new Set(['passed', 'failed'])

/**
 * Vitest를 돌리고 JSON 결과로 다시 확인한다. 설정 파일(vitest*.config.ts)만 바꿔 테스트를 빼는 우회를 막는다 (TD-S00-014).
 * - under·notUnder: 돈 파일이 단계 대상 폴더 안인지 (AC-S00-12)
 * - expected: 디스크에서 찾은 대상 파일 전부. 정확히 이 파일들이 돌아야 한다(include·exclude로 빼거나 넓히면 실패)
 * - 건너뛴 테스트(.skip·.todo·skipIf·.only·testNamePattern)가 하나라도 있으면 실패 (dev-common, AC-S00-11)
 */
async function vitestRun(config, label, { under, notUnder = [], expected, configHint = config, extraArgs = [] }) {
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, `${label}.json`)
  rmSync(out, { force: true })
  // --typecheck.enabled=false: 설정 파일의 typecheck 모드(테스트를 실행하지 않고 타입만 보고 passed로 보고)를 덮어쓴다 (SA-S00-010)
  const result = await exec(
    [bin('vitest'), 'run', '--config', config, '--typecheck.enabled=false', ...extraArgs, '--reporter=default', '--reporter=json', `--outputFile.json=${out}`],
    { tz: true },
  )
  const json = readJson(out)
  if (!json) return { status: 'fail', detail: `결과 파일이 없다 (Vitest 종료 코드 ${result.code})` }
  const files = json.testResults.map((r) => rel(r.name)).sort()
  process.stdout.write(`\n${label} 단계가 돌린 테스트 파일 ${files.length}개:\n${bullet(files)}\n`)

  const expectedSet = new Set(expected)
  const ranSet = new Set(files)
  const outside = files.filter((f) => !expectedSet.has(f) || !under.some((p) => f.startsWith(p)) || notUnder.some((p) => f.startsWith(p)))
  const missing = expected.filter((f) => !ranSet.has(f))
  const notRun = json.testResults.flatMap((r) =>
    r.assertionResults.filter((a) => !RAN_STATUSES.has(a.status)).map((a) => `${rel(r.name)} › ${a.fullName ?? a.title} (${a.status})`),
  )
  const skipped = Math.max(notRun.length, (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0))

  if (outside.length > 0) process.stdout.write(`✗ ${label} 단계 대상이 아닌 파일 ${outside.length}개를 돌렸다:\n${bullet(outside)}\n`)
  if (missing.length > 0) {
    process.stdout.write(`✗ ${label} 단계 대상인데 돌지 않은 테스트 파일 ${missing.length}개 — ${configHint}의 include·exclude를 확인한다:\n${bullet(missing)}\n`)
  }
  if (skipped > 0) {
    process.stdout.write(`✗ 건너뛴 테스트 ${skipped}개 — .skip·.todo·skipIf·.only·이름 필터(testNamePattern)는 쓸 수 없다:\n${bullet(notRun)}\n`)
  }

  const parts = [`파일 ${files.length}`, `테스트 ${json.numTotalTests}`]
  if (json.numFailedTests > 0) parts.push(`실패 ${json.numFailedTests}`)
  if (skipped > 0) parts.push(`건너뜀 ${skipped}`)
  if (missing.length > 0) parts.push(`돌지 않은 파일 ${missing.length}개 (${missing.join(', ')})`)
  if (outside.length > 0) parts.push(`대상 밖 파일 ${outside.length}개 (${outside.join(', ')})`)
  const ok = result.code === 0 && json.success === true && json.numFailedTests === 0 && skipped === 0 && missing.length === 0 && outside.length === 0
  if (!ok && parts.length === 2) parts.push(`Vitest 종료 코드 ${result.code}`)
  return { status: ok ? 'pass' : 'fail', detail: parts.join(' · ') }
}

/** test 단계 대상: `packages/*`·`apps/*` 안의 단위 테스트 파일 전부 (Vitest 기본 이름 규칙 *.test.*·*.spec.*) */
export function unitTestFiles() {
  return workspaceFiles((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f) && !isPerfTest(f))
}

/** 성능 시험 파일 (packages/*·apps/*) */
export function unitPerfFiles() {
  return workspaceFiles((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f) && isPerfTest(f))
}

async function test() {
  return vitestRun('vitest.config.ts', 'test', {
    under: ['packages/', 'apps/'],
    notUnder: ['tests/'],
    expected: unitTestFiles().map(rel),
    configHint: '각 패키지 vitest.config.ts',
    extraArgs: PERF_EXCLUDE,
  })
}

async function golden() {
  const result = await exec([join(ROOT, 'packages', 'core', 'test', 'golden', 'cli.ts')], { tz: true })
  const line = result.output.split('\n').find((l) => l.startsWith('합계: '))
  if (!line) return { status: 'fail', detail: `합계를 찾지 못했다 (종료 코드 ${result.code})` }
  return { status: result.code === 0 ? 'pass' : 'fail', detail: line.slice('합계: '.length) }
}

export function adversarialFiles() {
  return walk(join(ROOT, 'tests', 'adversarial'), (f) => f.endsWith('.test.ts') && !isPerfTest(f))
}

export function adversarialPerfFiles() {
  return walk(join(ROOT, 'tests', 'adversarial'), (f) => f.endsWith('.test.ts') && isPerfTest(f))
}

async function adversarial() {
  const files = adversarialFiles()
  if (files.length === 0) {
    process.stdout.write('tests/adversarial/**/*.test.ts 없음\n')
    return { status: 'pass', detail: '적대 테스트 0개' }
  }
  const result = await vitestRun('vitest.adversarial.config.ts', 'adversarial', { under: ['tests/adversarial/'], expected: files.map(rel), extraArgs: PERF_EXCLUDE })
  return { ...result, detail: `적대 테스트 ${result.detail}` }
}

export function e2eFiles() {
  return walk(join(ROOT, 'tests', 'e2e'), (f) => /\.spec\.[cm]?ts$/.test(f) && !isPerfTest(f))
}

export function e2ePerfFiles() {
  return walk(join(ROOT, 'tests', 'e2e'), (f) => /\.spec\.[cm]?ts$/.test(f) && isPerfTest(f))
}

/** 성능 E2E를 고르는 제목 태그 (playwright.config.ts의 @fill 묶음 포함) */
const E2E_PERF_TAGS = '@fill|@perf'

/** Playwright JSON 보고서의 스위트 트리에서 파일 이름을 모은다 */
function e2eReportFiles(suites, out = new Set()) {
  for (const suite of suites ?? []) {
    if (typeof suite.file === 'string') out.add(suite.file)
    e2eReportFiles(suite.suites, out)
  }
  return out
}

/**
 * E2E (RA-S05-005): apps/web/playwright.config.ts로 tests/e2e/**\/*.spec.ts를 실제 브라우저에서 돌린다.
 * 실패·건너뜀·흔들림(재시도로 통과)·돌지 않은 파일이 하나라도 있으면 실패. 브라우저가 없으면 설치 안내.
 */
async function e2e() {
  const files = e2eFiles()
  if (files.length === 0) {
    process.stdout.write('tests/e2e/**/*.spec.ts 없음\n')
    return { status: 'pass', detail: 'E2E 0개' }
  }
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, 'e2e.json')
  rmSync(out, { force: true })
  const config = join(ROOT, 'apps', 'web', 'playwright.config.ts')
  const result = await exec([bin('@playwright/test', 'playwright'), 'test', '--config', config, '--grep-invert', E2E_PERF_TAGS, '--reporter=line,json'], {
    extraEnv: { PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  })
  const report = readJson(out)
  if (!report) {
    const hint = /Executable doesn't exist|playwright install/i.test(result.output) ? ' — 브라우저 설치: pnpm exec playwright install chromium' : ''
    return { status: 'fail', detail: `결과 파일이 없다 (Playwright 종료 코드 ${result.code})${hint}` }
  }
  const stats = report.stats ?? {}
  const ran = e2eReportFiles(report.suites)
  const e2eRoot = join(ROOT, 'tests', 'e2e')
  const missing = files.map((f) => toPosix(relative(e2eRoot, f))).filter((f) => !ran.has(f))
  const passed = stats.expected ?? 0
  const failed = stats.unexpected ?? 0
  const flaky = stats.flaky ?? 0
  const skipped = stats.skipped ?? 0
  const errors = (report.errors ?? []).length
  if (missing.length > 0) process.stdout.write(`✗ 돌지 않은 E2E 파일 ${missing.length}개:\n${bullet(missing)}\n`)
  if (flaky > 0) process.stdout.write(`✗ 흔들린 E2E ${flaky}개 — 재시도로 통과한 시험도 실패로 본다(경쟁 상태는 진짜 버그일 수 있다)\n`)
  if (skipped > 0) process.stdout.write(`✗ 건너뛴 E2E ${skipped}개 — test.skip·fixme는 쓸 수 없다\n`)
  const parts = [`파일 ${files.length}`, `통과 ${passed}`]
  if (failed > 0) parts.push(`실패 ${failed}`)
  if (flaky > 0) parts.push(`흔들림 ${flaky}`)
  if (skipped > 0) parts.push(`건너뜀 ${skipped}`)
  if (errors > 0) parts.push(`오류 ${errors}`)
  if (missing.length > 0) parts.push(`돌지 않은 파일 ${missing.length}개 (${missing.join(', ')})`)
  const ok = result.code === 0 && failed === 0 && flaky === 0 && skipped === 0 && errors === 0 && missing.length === 0 && passed > 0
  return { status: ok ? 'pass' : 'fail', detail: parts.join(' · ') }
}

async function coverage() {
  const summaryPath = join(ROOT, 'coverage', 'coverage-summary.json')
  rmSync(summaryPath, { force: true })
  const result = await exec([bin('vitest'), 'run', '--config', 'vitest.coverage.config.ts', '--typecheck.enabled=false', ...PERF_EXCLUDE], { tz: true })
  const summary = readJson(summaryPath)
  const total = summary?.total
  if (!total) return { status: 'fail', detail: `커버리지 요약이 없다 (종료 코드 ${result.code})` }
  const files = Object.keys(summary).filter((k) => k !== 'total').length
  const lines = total.lines.pct
  const branches = total.branches.pct
  const detail = `라인 ${lines}% · 분기 ${branches}% (기준 ${COVERAGE_MINIMUM}%, packages/core/src 파일 ${files}개)`
  // 측정 대상이 비면 0/0이 "통과"로 보일 수 있으므로 따로 막는다
  if (total.lines.total === 0) return { status: 'fail', detail: `측정한 줄이 0개다 — 측정 범위 설정 확인 (${detail})` }
  const enough = typeof lines === 'number' && typeof branches === 'number' && lines >= COVERAGE_MINIMUM && branches >= COVERAGE_MINIMUM
  return { status: result.code === 0 && enough ? 'pass' : 'fail', detail }
}

/**
 * 성능 단계(D-902, pnpm perf): 성능 시험만 돌린다 — 단위·서버(*.perf.test.*), 적대(tests/adversarial/**\/*.perf.test.ts),
 * E2E(*.perf.spec.ts · @fill·@perf 제목). pnpm verify에는 들어가지 않는다. 다른 무거운 작업이 없을 때 돌려야 뜻이 있다.
 */
async function perf() {
  const parts = []
  let ok = true
  const unit = unitPerfFiles().map(rel)
  if (unit.length > 0) {
    const r = await vitestRun('vitest.config.ts', 'perf-unit', { under: ['packages/', 'apps/'], expected: unit, extraArgs: unit })
    parts.push(`단위·서버 ${r.detail}`)
    ok &&= r.status === 'pass'
  }
  const adv = adversarialPerfFiles().map(rel)
  if (adv.length > 0) {
    const r = await vitestRun('vitest.adversarial.config.ts', 'perf-adversarial', { under: ['tests/adversarial/'], expected: adv, extraArgs: adv })
    parts.push(`적대 ${r.detail}`)
    ok &&= r.status === 'pass'
  }
  if (e2ePerfFiles().length > 0) {
    mkdirSync(CACHE, { recursive: true })
    const out = join(CACHE, 'perf-e2e.json')
    rmSync(out, { force: true })
    const config = join(ROOT, 'apps', 'web', 'playwright.config.ts')
    const result = await exec([bin('@playwright/test', 'playwright'), 'test', '--config', config, '--grep', E2E_PERF_TAGS, '--reporter=line,json'], {
      extraEnv: { PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    })
    const stats = readJson(out)?.stats ?? {}
    const passed = stats.expected ?? 0
    const failed = (stats.unexpected ?? 0) + (stats.flaky ?? 0)
    parts.push(`E2E 통과 ${passed}${failed > 0 ? ` · 실패 ${failed}` : ''}`)
    ok &&= result.code === 0 && failed === 0 && passed > 0
  }
  if (parts.length === 0) return { status: 'pass', detail: '성능 시험 0개' }
  return { status: ok ? 'pass' : 'fail', detail: parts.join(' / ') }
}

const RUNNERS = { typecheck, lint, test, golden, adversarial, e2e, coverage, perf }
/** pnpm verify에 들어가지 않고 따로 부르는 단계 */
export const EXTRA_STAGES = ['perf']

export async function runStage(name) {
  const started = performance.now()
  let outcome
  try {
    outcome = await RUNNERS[name]()
  } catch (error) {
    outcome = { status: 'fail', detail: `단계 실행 오류: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { name, ...outcome, durationMs: Math.round(performance.now() - started) }
}

export function statusLabel(status) {
  return status === 'pass' ? '통과' : status === 'fail' ? '실패' : '건너뜀'
}
