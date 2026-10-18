// pnpm verify 단계 정의 (AC-S00-10~14). 보호 경로(scripts/harness/) 밖에 둔다.
// 단계: typecheck → lint → test → golden → adversarial → coverage
// 각 단계는 자기 대상만 돈다. 결과: { name, status: 'pass'|'fail'|'skip', detail, durationMs }
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEST_TIME_ZONE } from './time-zone.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const STAGES = ['typecheck', 'lint', 'test', 'golden', 'adversarial', 'coverage']
/** 시간대를 고정하는 단계 (D-026) */
export const TZ_STAGES = new Set(['test', 'golden', 'adversarial', 'coverage'])
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
function exec(args, { tz = false, quiet = false } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(tz ? { TZ: TEST_TIME_ZONE } : {}) }
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

/** 타입 검사 대상 확장자. 선언 파일(.d.ts·.d.mts·.d.cts·.d.<확장자>.ts)은 skipLibCheck로 검사하지 않으므로 뺀다 */
const isTypeScriptSource = (path) => /\.(?:[cm]?ts|tsx)$/.test(path) && !/\.d(?:\.[^./\\]+)?\.[cm]?ts$/.test(path)

/**
 * 타입 검사 범위(AC-S00-03): `packages/*`·`apps/*` 아래 전부(src·test·패키지 루트의 도구 설정 파일), `tests/adversarial/**`,
 * 저장소 루트의 TS 파일. 어느 tsconfig의 include에도 들지 않은 파일은 타입 오류가 있어도 tsc가 보지 않으므로,
 * 범위 안 파일이 모두 어떤 설정의 검사 대상인지 따로 확인한다 (TD-S00-015).
 */
export function typecheckScope() {
  const files = [...workspaceFiles(isTypeScriptSource), ...walk(join(ROOT, 'tests', 'adversarial'), isTypeScriptSource)]
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && isTypeScriptSource(entry.name)) files.push(join(ROOT, entry.name))
  }
  return files.sort()
}

async function typecheck() {
  const configs = []
  const problems = []
  for (const dir of workspacePackages()) {
    const own = readdirSync(dir).filter((f) => /^tsconfig(\..+)?\.json$/.test(f)).sort()
    if (!own.includes('tsconfig.json')) problems.push(`타입 검사 설정이 없다: ${rel(dir)}/tsconfig.json`)
    for (const file of own) configs.push(join(dir, file))
  }
  configs.push(join(ROOT, 'tsconfig.json'))
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

  let failed = 0
  for (const config of configs) {
    process.stdout.write(`tsc --noEmit -p ${rel(config)}\n`)
    const result = await exec([tsc, '--noEmit', '-p', config])
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

async function lint() {
  const stray = strayEslintConfigs().map(rel)
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
  const strayNote = stray.length > 0 ? ` · 다른 ESLint 설정 파일 ${stray.length}개 (${stray.join(', ')})` : ''
  const ok = result.code === 0 && stray.length === 0
  return { status: ok ? 'pass' : 'fail', detail: `${counts} (--max-warnings 0, 설정 ${ESLINT_CONFIG} 하나)${strayNote}` }
}

async function vitestRun(config, label, mustBeUnder, mustNotBeUnder) {
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, `${label}.json`)
  rmSync(out, { force: true })
  const result = await exec([bin('vitest'), 'run', '--config', config, '--reporter=default', '--reporter=json', `--outputFile.json=${out}`], { tz: true })
  const json = readJson(out)
  if (!json) return { status: 'fail', detail: `결과 파일이 없다 (Vitest 종료 코드 ${result.code})` }
  const files = json.testResults.map((r) => rel(r.name))
  process.stdout.write(`\n${label} 단계가 돌린 테스트 파일 ${files.length}개:\n${files.map((f) => `  ${f}`).join('\n')}\n`)
  const outside = files.filter((f) => (mustBeUnder && !mustBeUnder.some((p) => f.startsWith(p))) || (mustNotBeUnder && mustNotBeUnder.some((p) => f.startsWith(p))))
  const counts = `파일 ${files.length} · 테스트 ${json.numTotalTests}`
  if (outside.length > 0) return { status: 'fail', detail: `${counts} · 대상 밖 파일 ${outside.length}개 (${outside.join(', ')})` }
  if (result.code !== 0 || !json.success) return { status: 'fail', detail: `${counts} · 실패 ${json.numFailedTests}` }
  return { status: 'pass', detail: counts }
}

async function test() {
  return vitestRun('vitest.config.ts', 'test', ['packages/', 'apps/'], ['tests/'])
}

async function golden() {
  const result = await exec([join(ROOT, 'packages', 'core', 'test', 'golden', 'cli.ts')], { tz: true })
  const line = result.output.split('\n').find((l) => l.startsWith('합계: '))
  if (!line) return { status: 'fail', detail: `합계를 찾지 못했다 (종료 코드 ${result.code})` }
  return { status: result.code === 0 ? 'pass' : 'fail', detail: line.slice('합계: '.length) }
}

export function adversarialFiles() {
  return walk(join(ROOT, 'tests', 'adversarial'), (f) => f.endsWith('.test.ts'))
}

async function adversarial() {
  const files = adversarialFiles()
  if (files.length === 0) {
    process.stdout.write('tests/adversarial/**/*.test.ts 없음\n')
    return { status: 'pass', detail: '적대 테스트 0개' }
  }
  const result = await vitestRun('vitest.adversarial.config.ts', 'adversarial', ['tests/adversarial/'])
  return { ...result, detail: `적대 테스트 ${result.detail}` }
}

async function coverage() {
  const summaryPath = join(ROOT, 'coverage', 'coverage-summary.json')
  rmSync(summaryPath, { force: true })
  const result = await exec([bin('vitest'), 'run', '--config', 'vitest.coverage.config.ts'], { tz: true })
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

const RUNNERS = { typecheck, lint, test, golden, adversarial, coverage }

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
