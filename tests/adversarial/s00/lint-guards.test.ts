// S00 검사 장치 공격: 코어 순수성 린트(AC-S00-05), 화면 XSS 린트(AC-S00-06), 코어 커버리지 기준(AC-S00-13).
// 린트 설정이나 커버리지 설정이 나중에 약해지거나, 소스 안의 주석 한 줄로 꺼질 수 있으면 여기서 잡는다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import coverageConfig, { CORE_COVERAGE_INCLUDE, CORE_COVERAGE_THRESHOLDS } from '../../../vitest.coverage.config.ts'
import { ROOT, node } from './helpers.ts'

const eslint = new ESLint({ cwd: ROOT })
const PURE = '코어는 순수 함수'
const CORE_FILE = 'packages/core/src/__probe__.ts'

async function lint(code: string, filePath: string): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath })
  if (!result) throw new Error('ESLint 결과가 없다')
  return result.messages
}

const pureErrors = (messages: ESLint.LintResult['messages']) => messages.filter((m) => m.severity === 2 && m.message.includes(PURE))

/** AC-S00-05 금지 목록 (모든 형태) */
const FORBIDDEN_IN_CORE: readonly (readonly [string, string])[] = [
  ['Date.now()', 'export const f = (): number => Date.now()\n'],
  ['new Date(...)', 'export const f = (): unknown => new Date(0)\n'],
  ['Date.UTC(...)', 'export const f = (): number => Date.UTC(2026, 0, 1)\n'],
  ['Date()', 'export const f = (): string => Date()\n'],
  ['Date.parse', "export const f = (): number => Date.parse('2026-10-18')\n"],
  ['Date 타입', 'export type T = Date\n'],
  ['globalThis.Date', 'export const f = (): number => globalThis.Date.now()\n'],
  ['Math.random', 'export const f = (): number => Math.random()\n'],
  ["Math['random']", "export const f = (): number => Math['random']()\n"],
  ['구조 분해 random', 'const { random } = Math\nexport const f = (): number => random()\n'],
  ['performance', 'export const f = (): number => performance.now()\n'],
  ['crypto', 'export const f = (): string => crypto.randomUUID()\n'],
  ['process', 'export const f = (): string | undefined => process.env.TZ\n'],
  ['console', 'export const f = (): void => console.log(1)\n'],
  ['setTimeout', 'export const f = (): unknown => setTimeout(() => 1, 1)\n'],
  ['setInterval', 'export const f = (): unknown => setInterval(() => 1, 1)\n'],
  ['setImmediate', 'export const f = (): unknown => setImmediate(() => 1)\n'],
  ['queueMicrotask', 'export const f = (): void => queueMicrotask(() => undefined)\n'],
  ['Intl', 'export const f = (): unknown => new Intl.NumberFormat()\n'],
  ['toLocaleString', 'export const f = (n: number): string => n.toLocaleString()\n'],
  ['toLocaleDateString', 'export const f = (d: { toLocaleDateString(): string }): string => d.toLocaleDateString()\n'],
  ['toLocaleTimeString', 'export const f = (d: { toLocaleTimeString(): string }): string => d.toLocaleTimeString()\n'],
  ['localeCompare', "export const f = (a: string): number => a.localeCompare('b')\n"],
  ['정렬 비교 localeCompare', 'export const f = (a: string[]): string[] => a.sort((x, y) => x.localeCompare(y))\n'],
  ["import 'fs'", "import { readFileSync } from 'fs'\nexport const f = (): unknown => readFileSync\n"],
  ["import 'node:fs'", "import { readFileSync } from 'node:fs'\nexport const f = (): unknown => readFileSync\n"],
  ["import 'fs/promises'", "import { readFile } from 'fs/promises'\nexport const f = (): unknown => readFile\n"],
  ['부수 효과 import', "import 'node:path'\nexport {}\n"],
  ['타입만 import', "import type { Stats } from 'node:fs'\nexport type S = Stats\n"],
  ['export from', "export { readFileSync } from 'fs'\n"],
  ['export * from', "export * from 'node:os'\n"],
  ['동적 import', "export const f = (): unknown => import('node:fs')\n"],
  ['require', "export const f = (): unknown => require('fs')\n"],
  ['node: 전용 모듈', "import { DatabaseSync } from 'node:sqlite'\nexport const f = (): unknown => DatabaseSync\n"],
]

describe('코어 순수성 린트 (AC-S00-05) — 회귀', () => {
  it.each(FORBIDDEN_IN_CORE)('packages/core/src에서 %s → "코어는 순수 함수" 오류', async (_label, code) => {
    for (const ext of ['ts', 'mts']) {
      const messages = await lint(code, `packages/core/src/__probe__.${ext}`)
      expect(pureErrors(messages).length, `${ext}: ${JSON.stringify(messages.map((m) => m.message))}`).toBeGreaterThan(0)
    }
  })

  it('하위 폴더와 .js 파일도 같다', async () => {
    expect(pureErrors(await lint('export const f = (): number => Date.now()\n', 'packages/core/src/deep/er/__probe__.ts')).length).toBeGreaterThan(0)
    expect(pureErrors(await lint('export const f = () => Date.now() + Math.random()\n', 'packages/core/src/__probe__.js')).length).toBe(2)
  })

  it.each(['build', 'dist', 'coverage', '.vite', 'a/build'])('소스 안의 %s 폴더도 순수성 검사를 받는다 (라운드 1 무시 범위 변경의 코어 쪽 회귀)', async (folder) => {
    const filePath = `packages/core/src/${folder}/__probe__.ts`
    expect(await eslint.isPathIgnored(filePath), filePath).toBe(false)
    expect(pureErrors(await lint('export const f = (): number => Date.now()\n', filePath)).length).toBeGreaterThan(0)
  })

  it.each(['packages/core/test/__probe__.ts', 'packages/core/test/golden/__probe__.ts', 'packages/label/src/__probe__.ts', 'apps/server/src/__probe__.ts', 'tests/adversarial/__probe__.test.ts'])(
    '%s에는 적용하지 않는다',
    async (filePath) => {
      expect(pureErrors(await lint('export const f = (): number => Date.now() + Math.random()\n', filePath))).toEqual([])
    },
  )
})

describe('TD-S00-003: 코어 소스 안의 ESLint 주석 한 줄로 순수성 규칙이 꺼진다 (AC-S00-05, D-024, CLAUDE.md 규칙 1)', () => {
  const bypasses: readonly (readonly [string, string])[] = [
    ['다음 줄 끄기', '// eslint-disable-next-line no-restricted-globals\nexport const f = (): number => Date.now()\n'],
    ['같은 줄 끄기', 'export const f = (): number => Date.now() // eslint-disable-line no-restricted-globals\n'],
    ['파일 전체 끄기', '/* eslint-disable */\nexport const f = (): number => Date.now()\n'],
    ['규칙 지정 블록 끄기', '/* eslint-disable no-restricted-properties */\nexport const f = (): number => Math.random()\n'],
    ['인라인 설정으로 규칙 끄기', '/* eslint no-restricted-globals: "off" */\nexport const f = (): number => Date.now()\n'],
    ['Node 모듈 import 끄기', "// eslint-disable-next-line @typescript-eslint/no-restricted-imports\nimport { readFileSync } from 'node:fs'\nexport const f = (): unknown => readFileSync\n"],
  ]

  it.each(bypasses)('TD-S00-003: %s 주석이 있어도 lint 단계는 "코어는 순수 함수" 오류로 실패해야 한다', async (_label, code) => {
    const messages = await lint(code, CORE_FILE)
    expect(pureErrors(messages).length, `주석으로 금지 목록이 꺼졌다: ${JSON.stringify(messages)}`).toBeGreaterThan(0)
  })
})

describe('화면 XSS 린트 (AC-S00-06) — 회귀와 TD-S00-004', () => {
  const RAW_HTML = 'export const A = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />\n'
  const xssErrors = (messages: ESLint.LintResult['messages']) => messages.filter((m) => m.severity === 2 && m.ruleId === 'no-restricted-syntax' && m.message.includes('NFR-06'))

  it('apps/web의 dangerouslySetInnerHTML → lint 오류 (회귀)', async () => {
    expect(xssErrors(await lint(RAW_HTML, 'apps/web/src/__probe__.tsx')).length).toBeGreaterThan(0)
  })

  it.each([
    ['다음 줄 끄기', `// eslint-disable-next-line no-restricted-syntax\n${RAW_HTML}`],
    ['파일 전체 끄기', `/* eslint-disable */\n${RAW_HTML}`],
    ['인라인 설정으로 규칙 끄기', `/* eslint no-restricted-syntax: "off" */\n${RAW_HTML}`],
  ])('TD-S00-004: %s 주석이 있어도 apps/web의 dangerouslySetInnerHTML은 lint 오류여야 한다 (NFR-06, CLAUDE.md 규칙 7)', async (_label, code) => {
    const messages = await lint(code, 'apps/web/src/__probe__.tsx')
    expect(xssErrors(messages).length, `주석으로 XSS 금지가 꺼졌다: ${JSON.stringify(messages)}`).toBeGreaterThan(0)
  })
})

describe('TD-S00-005: 코어 소스의 커버리지 무시 주석이 95% 기준과 "모든 소스 파일 측정"을 우회한다 (AC-S00-13)', () => {
  // 임시 주입으로 확인: 테스트 없는 분기를 `/* v8 ignore next */`로, 테스트 없는 파일을 `/* istanbul ignore file */`로 감싸면
  // coverage 단계가 라인·분기 100%로 통과하고 그 파일은 측정 대상에서 아예 빠진다(“packages/core/src 파일 5개”).
  // AC-S00-13: 제외는 타입 선언만 있는 파일뿐 → 이런 주석은 검사 단계(lint)에서 막혀야 한다.
  const UNTESTED = 'export function f(x: number): number {\n  if (x > 0) return 1\n  return 2\n}\n'
  it.each([
    ['v8 ignore next', `export function f(x: number): number {\n  /* v8 ignore next */\n  if (x > 0) return 1\n  return 2\n}\n`],
    ['v8 ignore next -- @preserve', `export function f(x: number): number {\n  /* v8 ignore next -- @preserve */\n  if (x > 0) return 1\n  return 2\n}\n`],
    ['v8 ignore start/stop', `/* v8 ignore start */\n${UNTESTED}/* v8 ignore stop */\n`],
    ['c8 ignore next', `export function f(x: number): number {\n  /* c8 ignore next */\n  if (x > 0) return 1\n  return 2\n}\n`],
    ['istanbul ignore file', `/* istanbul ignore file */\n${UNTESTED}`],
    ['istanbul ignore else', `export function f(x: number): number {\n  /* istanbul ignore else */\n  if (x > 0) return 1\n  else return 2\n}\n`],
  ])('TD-S00-005: packages/core/src의 "%s" 주석 → lint 오류', async (_label, code) => {
    const messages = await lint(code, CORE_FILE)
    expect(messages.filter((m) => m.severity === 2).length, `커버리지 무시 주석이 그대로 통과한다: ${JSON.stringify(messages)}`).toBeGreaterThan(0)
  })

  it('주석 없는 같은 코드는 lint 통과 (위 검사가 다른 이유로 실패하지 않는다는 전제)', async () => {
    expect((await lint(UNTESTED, CORE_FILE)).filter((m) => m.severity === 2)).toEqual([])
  })
})

describe('커버리지 설정 약화 감지 (AC-S00-13) — 회귀', () => {
  interface CoverageShape {
    readonly enabled?: boolean
    readonly provider?: string
    readonly include?: readonly string[]
    readonly exclude?: readonly string[]
    readonly reporter?: readonly (string | readonly unknown[])[]
    readonly thresholds?: Readonly<Record<string, unknown>>
  }
  const test = (coverageConfig as { test?: { include?: readonly string[]; coverage?: CoverageShape } }).test
  const coverage = test?.coverage

  it('측정 범위는 packages/core/src 전체, 제외는 타입 선언 파일뿐', () => {
    expect(CORE_COVERAGE_INCLUDE).toContain('packages/core/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}')
    expect(coverage?.include).toEqual(CORE_COVERAGE_INCLUDE)
    expect(coverage?.enabled).toBe(true)
    expect(coverage?.provider).toBe('v8')
    for (const pattern of coverage?.exclude ?? []) expect(pattern).toMatch(/\.d\.[cm]?ts$/)
    expect(coverage?.reporter?.some((r) => r === 'json-summary' || (Array.isArray(r) && r[0] === 'json-summary'))).toBe(true)
    expect(test?.include).toContain('packages/core/test/**/*.test.ts')
  })

  it('임계값: 라인·분기 95 이상 (설정과 verify 재확인 모두)', () => {
    expect(CORE_COVERAGE_THRESHOLDS.lines).toBeGreaterThanOrEqual(95)
    expect(CORE_COVERAGE_THRESHOLDS.branches).toBeGreaterThanOrEqual(95)
    expect(coverage?.thresholds?.['lines']).toBe(CORE_COVERAGE_THRESHOLDS.lines)
    expect(coverage?.thresholds?.['branches']).toBe(CORE_COVERAGE_THRESHOLDS.branches)
    expect(coverage?.thresholds?.['perFile'] ?? false).toBe(false)
    const result = node(['--input-type=module', '-e', "import { COVERAGE_MINIMUM } from './scripts/verify/stages.mjs'; process.stdout.write(String(COVERAGE_MINIMUM))"])
    expect(result.status, result.stderr).toBe(0)
    expect(Number(result.stdout)).toBeGreaterThanOrEqual(95)
  })

  it('측정에서 코드를 빼는 다른 설정이 없다: ignoreClassMethods·allowExternal·excludeAfterRemap·임계값 자동 조정', () => {
    // ignoreClassMethods에 이름을 적으면 그 메서드 안의 문장·분기가 측정에서 빠진다(ast-v8-to-istanbul ignoreNode)
    const extra = coverage as (CoverageShape & { ignoreClassMethods?: readonly string[]; allowExternal?: boolean; excludeAfterRemap?: boolean }) | undefined
    expect(extra?.ignoreClassMethods ?? []).toEqual([])
    expect(extra?.allowExternal ?? false).toBe(false)
    expect(extra?.excludeAfterRemap ?? false).toBe(false)
    expect(coverage?.thresholds?.['autoUpdate'] ?? false).toBe(false)
  })

  it('verify의 coverage 단계는 이 설정 파일을 쓴다', () => {
    expect(readFileSync(join(ROOT, 'scripts', 'verify', 'stages.mjs'), 'utf8')).toContain("'vitest.coverage.config.ts'")
  })
})
