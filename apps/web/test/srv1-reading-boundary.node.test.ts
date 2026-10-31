// @vitest-environment node
// SRV1 의존 검사 (AC-SRV1-13, APP-05 AC9, D-APP-23): 기기 소스(웹·앱·확장, 시험 파일 제외)는 글을 값으로 읽는 함수를 부르지 않는다.
// 금지 목록(D-APP-23): @livejjim/core의 parseChat·parseAmount·parseKoreanNumber·parseQuickInput·parseOptionComment·normalizeText·normalizePhone·
// containsPhoneRun·phoneLast4·resolveReceivedTime, @livejjim/core/quick-input, packages/core/src/parse/, @livejjim/voice 값 import·동적 import,
// packages/voice/src/web-speech.ts·createWebSpeechEngine, 서버 읽기(packages/voice-session/src/read/) 값 import, VoiceController 실행 코드(서버 전용 packages/voice-session/src/controller/).
// 타입 import(`import type`, `{ type X }`)는 허용. 기기 소스에 `webkitSpeechRecognition` 글자도 없다(크롬 받아쓰기 길 없음, D-APP-22).
// 빌드 결과 쪽(모듈 목록·글자)은 build.node.test.ts가 본다.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const DEVICE_ROOTS = ['apps/web/src', 'apps/mobile/src', 'apps/extension/src']

/** 시험 파일이 아닌 기기 소스 */
function deviceSources(): { readonly file: string; readonly text: string }[] {
  const out: { file: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.(test|spec)\.[tj]sx?$/.test(entry.name)) out.push({ file: relative(REPO, full), text: readFileSync(full, 'utf8') })
    }
  }
  for (const root of DEVICE_ROOTS) if (existsSync(join(REPO, root))) walk(join(REPO, root))
  return out
}

/** 금지된 코어 이름 (D-APP-23) */
export const FORBIDDEN_CORE = ['parseChat', 'parseAmount', 'parseKoreanNumber', 'parseQuickInput', 'parseOptionComment', 'normalizeText', 'normalizePhone', 'containsPhoneRun', 'phoneLast4', 'resolveReceivedTime']

/** 값으로 가져오면 안 되는 모듈 (이름과 상관없이) */
function forbiddenModule(spec: string): string | null {
  if (spec === '@livejjim/core/quick-input') return '입력 읽기 모듈(@livejjim/core/quick-input)'
  if (spec === '@livejjim/voice' || spec.startsWith('@livejjim/voice/')) return '음성 패키지(@livejjim/voice)'
  if (/(^|\/)packages\/core\/src\/parse\//.test(spec)) return '코어 파서(packages/core/src/parse/)'
  if (/(^|\/)packages\/voice\/src\/web-speech(\.ts)?$/.test(spec)) return '크롬 받아쓰기(web-speech.ts)'
  if (/(^|\/)packages\/voice-session\/src\/read(\/|\.ts$|$)/.test(spec) || spec === '@livejjim/voice-session/read' || spec === '@livejjim/voice-session/rules') return '서버 읽기(voice-session read)'
  if (/(^|\/)packages\/voice-session\/src\/(controller\/|server\.ts$)/.test(spec) || spec === '@livejjim/voice-session/server') return '음성 읽기 컨트롤러(voice-session controller)'
  if (/(^|\/)voice\/controller(\.ts)?$/.test(spec) || /^\.\/controller(\.ts)?$/.test(spec)) return '음성 읽기 컨트롤러(voice/controller.ts)'
  return null
}

/** `{ a, type b, c as d }` 안의 값 이름 (type 붙은 것은 뺀다) */
function valueNames(list: string): string[] {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.startsWith('type '))
    .map((part) => (part.split(/\s+as\s+/)[0] ?? '').trim())
}

/**
 * 한 파일 글에서 금지된 값 import를 찾는다 (정적 import·export from·동적 import). 문제마다 한 줄.
 * 시험(고정 사례)에서도 부른다 — 금지 import 한 줄이 들어가면 반드시 잡아야 한다.
 */
export function readingImports(source: string): string[] {
  const problems: string[] = []
  const statements = source.matchAll(/\b(import|export)\s+(type\s+)?([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)
  for (const match of statements) {
    const sideEffect = match[5]
    if (sideEffect !== undefined) {
      const why = forbiddenModule(sideEffect)
      if (why !== null) problems.push(`${sideEffect}: ${why}`)
      continue
    }
    if (match[2] !== undefined) continue // import type / export type
    const clause = match[3] ?? ''
    const spec = match[4] ?? ''
    const braces = /\{([^}]*)\}/.exec(clause)
    const named = braces === null ? [] : valueNames(braces[1] ?? '')
    const outside = braces === null ? clause : clause.replace(braces[0], '')
    // 기본 import·네임스페이스 import(`* as x`)는 값이다
    const whole = /\*\s+as\s+\w+/.test(outside) || /^\s*\w+\s*(,|$)/.test(outside)
    if (braces !== null && named.length === 0 && !whole) continue // 모두 타입
    const why = forbiddenModule(spec)
    if (why !== null) problems.push(`${spec}: ${why}`)
    if (spec === '@livejjim/core' || spec.startsWith('@livejjim/core/')) {
      for (const name of named) if (FORBIDDEN_CORE.includes(name)) problems.push(`${spec}의 ${name}`)
      if (whole && /\*\s+as/.test(outside)) problems.push(`${spec} 전체(* as)`)
    }
  }
  for (const match of source.matchAll(/\bimport\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]([^'"`]+)['"`]\s*\)/g)) {
    const spec = match[1] ?? ''
    const why = forbiddenModule(spec)
    if (why !== null) problems.push(`동적 import ${spec}: ${why}`)
  }
  if (/\bcreateWebSpeechEngine\b/.test(source)) problems.push('createWebSpeechEngine')
  return problems
}

const files = deviceSources()

describe('기기 소스에 읽기 함수가 없다 (AC-SRV1-13, D-APP-23)', () => {
  it('기기 소스를 읽었다 (빈 목록으로 통과하지 않게)', () => {
    expect(files.some((item) => item.file === 'apps/web/src/components/ConsolePage.tsx')).toBe(true)
    expect(files.some((item) => item.file === 'apps/mobile/src/screens/console/QuickInput.tsx')).toBe(true)
    expect(files.some((item) => item.file.startsWith('apps/extension/src/'))).toBe(true)
  })

  it('금지 목록의 값 import(정적·동적)가 0이다', () => {
    const found: string[] = []
    for (const { file, text } of files) for (const problem of readingImports(text)) found.push(`${file}: ${problem}`)
    expect(found).toEqual([])
  })

  it('기기 소스에 webkitSpeechRecognition 글자가 없다 (크롬 받아쓰기 길 없음, D-APP-22)', () => {
    for (const { file, text } of files) expect(text, file).not.toContain('webkitSpeechRecognition')
  })

  it('VoiceController 실행 코드가 기기 소스에 없다 — 서버 전용 자리로 옮긴다 (D-APP-23, AC-SRV1-15)', () => {
    const holders = files.filter(({ text }) => /\bexport\s+class\s+VoiceController\b/.test(text)).map((item) => item.file)
    expect(holders).toEqual([])
  })
})

describe('검사가 금지 import를 잡는다 (고정 사례, AC-SRV1-13)', () => {
  it.each([
    ["import { parseAmount } from '@livejjim/core'", '@livejjim/core의 parseAmount'],
    ["import { formatWon, normalizePhone as norm } from '@livejjim/core'", '@livejjim/core의 normalizePhone'],
    ["import { parseQuickInput, type QuickInputError } from '@livejjim/core/quick-input'", '@livejjim/core/quick-input'],
    ["import * as voice from '@livejjim/voice'", '@livejjim/voice'],
    ["const v = await import('@livejjim/voice')", '동적 import @livejjim/voice'],
    ["import { createWebSpeechEngine } from '../../../../packages/voice/src/web-speech.ts'", 'web-speech.ts'],
    ["import { readText } from '../../../../packages/voice-session/src/read/index.ts'", 'read/index.ts'],
    ["import { decideQuickInput } from '@livejjim/voice-session/read'", '@livejjim/voice-session/read'],
    ["import { VoiceController } from '../../../../packages/voice-session/src/controller/controller.ts'", 'controller/controller.ts'],
    ["import { VoiceController } from './controller.ts'", './controller.ts'],
    ["import { parseAmount } from '../../../../packages/core/src/parse/amount.ts'", 'packages/core/src/parse/amount.ts'],
    ["export { containsPhoneRun } from '@livejjim/core'", '@livejjim/core의 containsPhoneRun'],
  ])('%s → 잡는다', (line, expected) => {
    const problems = readingImports(`${line}\n`)
    expect(problems.join('\n')).toContain(expected)
  })

  it.each([
    "import type { QuickInputError } from '@livejjim/core'",
    "import { formatWon, type QuickInputError } from '@livejjim/core'",
    "import type * as Voice from '@livejjim/voice'",
    "import type { SuggestionCard } from '@livejjim/voice'",
    "import { type SuggestionCard } from '@livejjim/voice'",
    "import type { ReadResult } from '../../../../packages/voice-session/src/read/index.ts'",
    "import type { VoiceController } from '../../../../packages/voice-session/src/controller/controller.ts'",
    "import type { VoiceController } from './controller.ts'",
    "import { formatWon } from '@livejjim/core/format'",
  ])('%s → 타입·허용 모듈은 통과', (line) => {
    expect(readingImports(`${line}\n`)).toEqual([])
  })
})
