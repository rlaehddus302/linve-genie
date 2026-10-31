// 음성 패키지 경계 — 코드 검사.
// - AC-I4-04 (VOC-05, D-I4-09 — AC-P2-15를 바꾼 규칙. 교체이지 약화가 아니다, harness/sprints/I4/dev-notes.md):
//   apps/web/src에서 @livejjim/voice를 불러오는 곳은 한 파일뿐이고 동적 import('@livejjim/voice')다.
//   정적 값 import·부수 효과 import·`import { type X }`(verbatimModuleSyntax에선 빈 import로 남아 모듈을 불러온다)·export … from·require·
//   packages/voice 경로 import는 없다. `import type …`과 타입 위치의 `import('…')`는 지워지므로 된다.
//   APP1b(D-APP-20·21): 서버 읽기 영역에는 추출기를 허용하고 웹 전송 경계에는 아래 3개 순수 전송 모듈만 허용한다.
//   이전 load.ts 로더의 단독 경계는 유지한다. 실제 화면은 remote.ts→transport.ts를 지연 로드한다.
//   core·label·documents 및 모바일 실행 코드에는 추출기를 허용하지 않는다.
// - AC-P2-40·AC-P2-14: packages/voice/src는 Node 전용 모듈을 import하지 않고, 시계·난수를 직접 읽지 않으며, 공급자 주소·키가 없다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const VOICE_DIR = join(ROOT, 'packages', 'voice')
const SOURCE = /\.(?:[cm]?[jt]sx?|json|html|vue|svelte)$/
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/
/** 다른 곳(서버·코어·라벨·문서): 글자로도 참조하지 않는다 (P2와 같다) */
const VOICE_TEXT = /@livejjim\/voice(?=[/"'`\s]|$)|packages\/voice(?=[/"'`\s]|$)|\.\.\/voice\//
/** apps/web/src의 글자 검사: 패키지 이름·packages/voice 경로 (상대 경로는 isVoiceSpecifier가 풀어서 본다 — 화면의 voice 폴더는 된다) */
const WEB_VOICE_TEXT = /@livejjim\/voice(?=[/"'`\s]|$)|packages\/voice(?=[/"'`\s]|$)/
const TRANSPORT_FILES = new Set(['livegenie.ts', 'web-speech.ts', 'speech.ts'].map((name) => join(VOICE_DIR, 'src', name)))

function files(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (SOURCE.test(name)) out.push(full)
  }
  return out
}

const rel = (path: string): string => relative(ROOT, path).split(sep).join('/')

// ── apps/web/src 검사기 ──────────────────────────────────────────────────

/** 음성 패키지 참조 한 곳 */
interface VoiceReference {
  /** 허용: dynamic(값을 부르는 유일한 길), type-import(`import type`), type-query(타입 위치의 import('…')) / 나머지는 위반 */
  readonly kind: 'dynamic' | 'type-import' | 'type-query' | 'static' | 'side-effect' | 'inline-type' | 'export' | 'require' | 'dynamic-other' | 'text'
  readonly line: number
  readonly specifier: string
}

const ALLOWED_ANYWHERE = new Set<VoiceReference['kind']>(['type-import', 'type-query'])

/** 그 파일에서 본 모듈 이름이 음성 패키지인가 (패키지 이름·하위 경로, 또는 상대·절대 경로로 packages/voice 안을 가리킴) */
function isVoiceSpecifier(specifier: string, file: string): boolean {
  if (/^@livejjim\/voice(?:\/|$)/.test(specifier)) return true
  if (/(?:^|\/)packages\/voice(?:\/|$)/.test(specifier)) return true
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const target = resolve(dirname(file), specifier)
    return target === VOICE_DIR || target.startsWith(VOICE_DIR + sep)
  }
  return false
}

const scriptKind = (file: string): ts.ScriptKind =>
  file.endsWith('x') ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS

/** 소스 하나에서 음성 패키지 참조를 모두 찾는다 (주석은 보지 않는다 — 구문 트리로 본다) */
function findVoiceReferences(file: string, text: string): VoiceReference[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  const found: VoiceReference[] = []
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const add = (kind: VoiceReference['kind'], node: ts.Node, specifier: string): void => {
    found.push({ kind, line: lineOf(node), specifier })
  }
  /** 모듈 이름 자리로 이미 분류한 글자 노드 (같은 글자를 'text'로 다시 세지 않게) */
  const classified = new Set<ts.Node>()

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isVoiceSpecifier(node.moduleSpecifier.text, file)) {
      classified.add(node.moduleSpecifier)
      const clause = node.importClause
      const specifier = node.moduleSpecifier.text
      if (clause === undefined) add('side-effect', node, specifier)
      else if (clause.isTypeOnly) add('type-import', node, specifier)
      else {
        const bindings = clause.namedBindings
        const onlyInlineTypes =
          clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.every((element) => element.isTypeOnly)
        add(onlyInlineTypes ? 'inline-type' : 'static', node, specifier)
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) && isVoiceSpecifier(node.moduleSpecifier.text, file)) {
      classified.add(node.moduleSpecifier)
      add('export', node, node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (ts.isStringLiteral(expression) && isVoiceSpecifier(expression.text, file)) {
        classified.add(expression)
        add('require', node, expression.text)
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal) && isVoiceSpecifier(argument.literal.text, file)) {
        classified.add(argument.literal)
        add('type-query', node, argument.literal.text)
      }
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments
      const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((isImportCall || isRequire) && first !== undefined && ts.isStringLiteralLike(first) && isVoiceSpecifier(first.text, file)) {
        classified.add(first)
        if (isRequire) add('require', node, first.text)
        else add(first.text === '@livejjim/voice' ? 'dynamic' : 'dynamic-other', node, first.text)
      }
    } else if (ts.isStringLiteralLike(node) && !classified.has(node) && WEB_VOICE_TEXT.test(node.text)) {
      // 모듈 이름을 글자로 들고 다니는 길(`const m = '@livejjim/voice'; import(m)`)도 막는다
      add('text', node, node.text)
    } else if (ts.isTemplateExpression(node) && WEB_VOICE_TEXT.test(node.getText(source))) {
      add('text', node, node.getText(source))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** apps/web/src 검사 결과: 위반 목록과 값을 부르는(동적 import) 파일 목록 */
function checkWebSources(sources: readonly { readonly file: string; readonly text: string }[]): { violations: string[]; loaders: string[] } {
  const violations: string[] = []
  const loaders: string[] = []
  for (const { file, text } of sources) {
    if (!SCRIPT.test(file)) {
      if (WEB_VOICE_TEXT.test(text)) violations.push(`${rel(file)}: 스크립트가 아닌 파일에 음성 패키지 참조`)
      continue
    }
    const references = findVoiceReferences(file, text)
    for (const reference of references) {
      if (reference.kind === 'dynamic' || ALLOWED_ANYWHERE.has(reference.kind)) continue
      if (rel(file) === 'apps/web/src/voice/transport.ts' && reference.kind === 'static' && TRANSPORT_FILES.has(resolve(dirname(file), reference.specifier))) continue
      violations.push(`${rel(file)}:${String(reference.line)} ${reference.kind} '${reference.specifier}'`)
    }
    if (references.some((reference) => reference.kind === 'dynamic')) loaders.push(rel(file))
  }
  return { violations, loaders }
}

describe('AC-I4-04 apps/web/src는 한 파일에서 동적 import로만 @livejjim/voice를 부른다 (VOC-05, D-I4-09)', () => {
  const webSources = files(join(ROOT, 'apps/web/src')).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

  it('정적 값 import·부수 효과 import·import { type X }·export … from·require·packages/voice 경로·모듈 이름 글자가 없다', () => {
    expect(checkWebSources(webSources).violations).toEqual([])
  })

  // 받아쓰기는 늘 서버가 한다(D-APP-22·D-APP-24) — 웹은 지금 값 import 없이 타입만 쓰므로 0개도 맞다.
  // 뜻은 그대로: 무거운 묶음은 많아야 한 곳에서만 늦게(동적) 부르고, 정적 값 import는 위 시험이 언제나 막는다.
  it('동적 import(\'@livejjim/voice\')는 많아야 한 파일에만 있다 (0개 또는 1개, D-APP-22·D-APP-24)', () => {
    expect(checkWebSources(webSources).loaders.length).toBeLessThanOrEqual(1)
  })

  it('검사 범위가 비어 있지 않다 (경로가 틀려 아무것도 안 보는 시험 방지)', () => {
    expect(webSources.length).toBeGreaterThan(10)
    expect(webSources.some(({ file }) => file.endsWith('.tsx'))).toBe(true)
  })

  // 검사기 자체 시험 — 검사기가 망가져 무엇이든 통과시키지 않게
  const at = (name: string): string => join(ROOT, 'apps/web/src', name)
  const check = (text: string, name = 'lib/x.ts'): ReturnType<typeof checkWebSources> => checkWebSources([{ file: at(name), text }])

  it.each([
    ["import { extractVoice } from '@livejjim/voice'", 'static'],
    ["import * as voice from '@livejjim/voice'", 'static'],
    ["import voice from '@livejjim/voice'", 'static'],
    ["import { type SuggestionCard, extractVoice } from '@livejjim/voice'", 'static'],
    ["import { type SuggestionCard } from '@livejjim/voice'", 'inline-type'],
    ["import '@livejjim/voice'", 'side-effect'],
    ["export { extractVoice } from '@livejjim/voice'", 'export'],
    ["export * from '@livejjim/voice'", 'export'],
    ["export type { SuggestionCard } from '@livejjim/voice'", 'export'],
    ["const v = require('@livejjim/voice')", 'require'],
    ["import { extractVoice } from '../../../../packages/voice/src/index.ts'", 'static'],
    ["const load = () => import('../../../../packages/voice/src/index.ts')", 'dynamic-other'],
    ["const load = () => import('@livejjim/voice/accuracy')", 'dynamic-other'],
    ["const name = '@livejjim/voice'; const load = () => import(name)", 'text'],
    ['const load = () => import(`@livejjim/voice`)', null],
  ] as const)('검사기: %s → %s', (text, kind) => {
    const result = check(text)
    if (kind === null) {
      expect(result.violations).toEqual([])
      expect(result.loaders).toHaveLength(1)
    } else {
      expect(result.violations.join('\n')).toContain(` ${kind} `)
    }
  })

  it('검사기: 동적 import·import type·타입 위치 import(…)·주석은 된다', () => {
    const text = [
      "import type { SuggestionCard } from '@livejjim/voice'",
      "import type * as Voice from '@livejjim/voice'",
      "type Module = typeof import('@livejjim/voice')",
      "// 음성은 @livejjim/voice를 켤 때 부른다",
      "export async function loadVoice(): Promise<Module> { return import('@livejjim/voice') }",
    ].join('\n')
    expect(check(text, 'components/VoicePanel.tsx')).toEqual({ violations: [], loaders: ['apps/web/src/components/VoicePanel.tsx'] })
    // 화면 안의 voice 폴더(상대 경로)는 음성 패키지가 아니다
    expect(check("import { VoicePanel } from '../voice/VoicePanel.tsx'\nimport { x } from './voice/x.ts'", 'components/Console.tsx')).toEqual({ violations: [], loaders: [] })
    // 다른 파일은 타입만 가져올 수 있다
    expect(check("import type { VoiceSettings } from '@livejjim/voice'\nexport const x = 1")).toEqual({ violations: [], loaders: [] })
  })

  it('검사기: 동적 import가 두 파일에 있으면 loaders가 둘이다', () => {
    const load = "export const load = () => import('@livejjim/voice')"
    expect(checkWebSources([{ file: at('a.ts'), text: load }, { file: at('b.tsx'), text: load }]).loaders).toHaveLength(2)
  })

  it('검사기: 스크립트가 아닌 파일(html·json)의 참조도 위반', () => {
    expect(checkWebSources([{ file: at('x.json'), text: '{"m":"@livejjim/voice"}' }]).violations).toHaveLength(1)
  })

  it('APP1b: 전송 경계의 세 모듈만 허용하고 추출기·사전·다른 화면의 우회 참조는 막는다', () => {
    for (const name of ['livegenie', 'web-speech', 'speech']) {
      const source = `import { transport } from '../../../../packages/voice/src/${name}.ts'`
      expect(check(source, 'voice/transport.ts').violations).toEqual([])
      expect(check(source, 'components/Panel.tsx').violations).toHaveLength(1)
    }
    for (const name of ['index', 'extract', 'dictionary']) {
      expect(check(`import { value } from '../../../../packages/voice/src/${name}.ts'`, 'voice/transport.ts').violations).toHaveLength(1)
    }
    expect(check("import { fromWire } from '@livejjim/voice-session/wire'").violations).toEqual([])
  })
})

describe('AC-I4-04·AC-P2-15 다른 곳은 @livejjim/voice에 기대지 않는다 (글자로도)', () => {
  const otherApps = readdirSync(join(ROOT, 'apps'))
    .filter((name) => !['web', 'server', 'mobile'].includes(name) && statSync(join(ROOT, 'apps', name)).isDirectory())
    .map((name) => `apps/${name}`)
  const scopes = [...otherApps, 'packages/core/src', 'packages/label', 'packages/documents']

  it.each(scopes)('%s 안에 @livejjim/voice·packages/voice 참조가 없다', (scope) => {
    const offenders = files(join(ROOT, scope)).filter((file) => VOICE_TEXT.test(readFileSync(file, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('검사 범위가 비어 있지 않다 (경로가 틀려 아무것도 안 보는 시험 방지)', () => {
    expect(files(join(ROOT, 'apps/server')).length).toBeGreaterThan(10)
    expect(files(join(ROOT, 'packages/core/src')).length).toBeGreaterThan(5)
    expect(files(join(ROOT, 'packages/documents')).length).toBeGreaterThan(3)
  })

  it('APP1b: 서버 src/voice 밖과 모바일 실행 코드에는 추출기 참조가 없다', () => {
    const checked = [...files(join(ROOT, 'apps/server/src')), ...files(join(ROOT, 'apps/mobile/src')), ...files(join(ROOT, 'apps/mobile/app'))]
      .filter((file) => SCRIPT.test(file) && !rel(file).startsWith('apps/server/src/voice/'))
    expect(checked.length).toBeGreaterThan(100)
    const violations = checked.flatMap((file) => findVoiceReferences(file, readFileSync(file, 'utf8'))
      .filter((reference) => !ALLOWED_ANYWHERE.has(reference.kind)).map((reference) => `${rel(file)}:${reference.line} ${reference.specifier}`))
    expect(violations).toEqual([])
  })
})

describe('AC-P2-40·AC-P2-14 packages/voice/src', () => {
  const sources = files(join(ROOT, 'packages/voice/src'))

  it('소스 파일이 있다', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  it.each(sources.map((file) => [rel(file), file]))('%s: Node 전용 모듈·시계·난수를 쓰지 않는다', (_name, file) => {
    const text = readFileSync(file, 'utf8')
    expect(text).not.toMatch(/from\s+['"](?:node:|fs['"]|path['"]|os['"]|child_process|crypto['"]|http|https|net['"])/)
    expect(text).not.toMatch(/\brequire\s*\(|\bprocess\.|\bBuffer\b/)
    expect(text).not.toMatch(/Date\.now|new Date\(\s*\)|Math\.random|performance\.now/)
  })

  it.each(sources.map((file) => [rel(file), file]))('%s: 공급자 주소·키·토큰 값이 없다', (_name, file) => {
    const text = readFileSync(file, 'utf8')
    expect(text).not.toMatch(/deepgram\.com|vito\.ai|rtzr\.ai|returnzero\.com|wss?:\/\/|https?:\/\//i)
    expect(text).not.toMatch(/api[_-]?key|apikey|secret|bearer|authorization|access[_-]?token/i)
    expect(text).not.toMatch(/token\s*[:=]\s*['"`]/i)
  })
})
