// 코어 순수성 린트를 소스 안 주석으로 끌 수 없는지 (AC-S00-05, AC-S00-13, D-024).
// 저장소의 실제 ESLint 설정(eslint.config.mjs)으로 예시 코드를 린트한다. 설정이 약해지면 이 테스트가 잡는다.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const eslint = new ESLint({ cwd: ROOT })
const CORE_FILE = 'packages/core/src/__probe__.ts'
const PURE = '코어는 순수 함수'

async function lint(code: string, filePath = CORE_FILE): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath })
  if (!result) throw new Error('린트 결과가 없다')
  // 문법 오류로 린트가 안 된 경우를 "통과"로 착각하지 않게 따로 확인한다
  expect(result.messages.filter((m) => m.fatal)).toEqual([])
  return result.messages
}

const errorsOf = (messages: ESLint.LintResult['messages'], ruleId: string) => messages.filter((m) => m.severity === 2 && m.ruleId === ruleId)

describe('린트 끄기·인라인 설정 주석은 코어 소스에서 무시되고, 그 주석 자체가 오류다 (TD-S00-003)', () => {
  it.each([
    ['다음 줄 끄기', '// eslint-disable-next-line no-restricted-globals\nexport const f = (): number => Date.now()\n', 'no-restricted-globals'],
    ['같은 줄 끄기', 'export const f = (): number => Date.now() // eslint-disable-line no-restricted-globals\n', 'no-restricted-globals'],
    ['파일 전체 끄기', '/* eslint-disable */\nexport const f = (): number => Date.now()\n', 'no-restricted-globals'],
    ['끄고 다시 켜기', '/* eslint-disable */\nexport const f = (): number => Math.random()\n/* eslint-enable */\n', 'no-restricted-properties'],
    ['규칙 지정 끄기', '/* eslint-disable no-restricted-properties */\nexport const f = (): number => Math.random()\n', 'no-restricted-properties'],
    ['인라인 설정으로 끄기', '/* eslint no-restricted-globals: "off" */\nexport const f = (): number => Date.now()\n', 'no-restricted-globals'],
    ['global 선언 주석', '/* global Date */\nexport const f = (): number => Date.now()\n', 'no-restricted-globals'],
    [
      'Node 모듈 import 끄기',
      "// eslint-disable-next-line @typescript-eslint/no-restricted-imports\nimport { readFileSync } from 'node:fs'\nexport const f = (): unknown => readFileSync\n",
      '@typescript-eslint/no-restricted-imports',
    ],
  ])('%s → 원래 순수성 오류가 남고, 주석도 오류', async (_name, code, ruleId) => {
    const messages = await lint(code)
    const kept = errorsOf(messages, ruleId)
    expect(kept.length, JSON.stringify(messages)).toBeGreaterThan(0)
    expect(kept.every((m) => m.message.includes(PURE))).toBe(true)
    const directive = errorsOf(messages, 'core-guards/no-inline-lint-config')
    expect(directive.length).toBeGreaterThan(0)
    expect(directive[0]?.message).toContain(PURE)
  })

  it('일반 주석은 문제없다 (한국어 설명, eslint로 시작하지 않는 문장)', async () => {
    const code = '// 전역 상태 없음. global 이라는 단어가 들어가도 줄 주석이면 괜찮다\n/** 판정 결과 */\nexport const f = (n: number): number => n + 1\n'
    expect(await lint(code)).toEqual([])
  })

  it('코어 소스 밖(골든 러너·다른 패키지)에는 적용하지 않는다', async () => {
    for (const filePath of ['packages/core/test/__probe__.ts', 'apps/server/src/__probe__.ts']) {
      const messages = await lint('/* v8 ignore next */\nexport const f = (n: number): number => n\n', filePath)
      expect(messages.filter((m) => m.ruleId?.startsWith('core-guards/')), filePath).toEqual([])
    }
  })
})

describe('커버리지 무시 주석은 코어 소스에서 lint 오류 (AC-S00-13, TD-S00-005)', () => {
  const branch = (comment: string) => `export function f(x: number): number {\n  ${comment}\n  if (x > 0) return 1\n  return 2\n}\n`

  it.each([
    ['v8 ignore next', branch('/* v8 ignore next */')],
    ['v8 ignore next -- @preserve', branch('/* v8 ignore next -- @preserve */')],
    ['v8 ignore start/stop', '/* v8 ignore start */\nexport const f = (n: number): number => n\n/* v8 ignore stop */\n'],
    ['c8 ignore next', branch('/* c8 ignore next */')],
    ['c8 ignore else', branch('/* c8 ignore else */')],
    ['istanbul ignore file', '/* istanbul ignore file */\nexport const f = (n: number): number => n\n'],
    ['istanbul ignore if', branch('/* istanbul ignore if */')],
    ['node:coverage ignore next', branch('/* node:coverage ignore next */')],
    ['줄 주석', branch('// v8 ignore next')],
    ['대문자', branch('/* V8 IGNORE NEXT */')],
    ['줄바꿈 사이', branch('/* istanbul\n     ignore next */')],
  ])('%s → 오류', async (_name, code) => {
    const errors = errorsOf(await lint(code), 'core-guards/no-coverage-ignore')
    // 주석 하나에 오류 하나 (start/stop은 주석 두 개)
    expect(errors).toHaveLength(code.match(/ignore/gi)?.length ?? 0)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toContain('AC-S00-13')
  })

  it('주석 없는 같은 코드는 통과 (위 검사가 다른 이유로 실패하지 않는다는 전제)', async () => {
    expect(await lint(branch('// 양수면 1'))).toEqual([])
  })
})
