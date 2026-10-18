// pnpm verify 단계 정의 (AC-S00-10~14). 보호 경로(scripts/harness/) 밖에 둔다.
// 단계: typecheck → lint → test → golden → adversarial → coverage
// 각 단계는 자기 대상만 돈다. 결과: { name, status: 'pass'|'fail'|'skip', detail, durationMs }
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
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

/** pnpm-workspace.yaml의 `packages:` 목록(`dir/*` 형태)을 따라 패키지 폴더를 찾는다 */
export function workspacePackages() {
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
  const dirs = []
  for (const glob of globs) {
    if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) throw new Error(`pnpm-workspace.yaml: 'dir/*' 형태만 지원한다 (${glob})`)
    const base = join(ROOT, glob.slice(0, -2))
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
  let failed = 0
  for (const config of configs) {
    process.stdout.write(`tsc --noEmit -p ${rel(config)}\n`)
    const result = await exec([tsc, '--noEmit', '-p', config])
    if (result.code !== 0) failed++
  }
  for (const problem of problems) process.stdout.write(`✗ ${problem}\n`)
  const ok = failed === 0 && problems.length === 0
  return {
    status: ok ? 'pass' : 'fail',
    detail: ok ? `설정 ${configs.length}개 (strict·noUncheckedIndexedAccess 확인)` : `설정 ${configs.length}개 중 타입 오류 ${failed}개 · 설정 문제 ${problems.length}개`,
  }
}

function readJsonText(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function lint() {
  const result = await exec([bin('eslint'), '.', '--max-warnings', '0'])
  if (result.code === 0) return { status: 'pass', detail: '오류 0 · 경고 0 (--max-warnings 0)' }
  const m = /(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(result.output)
  return { status: 'fail', detail: m ? `오류 ${m[2]} · 경고 ${m[3]} (--max-warnings 0)` : `ESLint 종료 코드 ${result.code}` }
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
