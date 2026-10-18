// 골든 YAML 읽기 — YAML 1.2 core schema (D-021).
// - 날짜·시각을 자동 변환하지 않는다(`2026-10-18`, `20:00:00`은 문자열).
// - 불리언은 `true`/`false`만 (README). `True`·`yes`·`on`·`OFF`·`no`는 문자열이다.
// - 중복 키, 문법 오류, 경고, 명시적 태그(`!!timestamp` 등)는 모두 읽기 오류다.
import { LineCounter, parseAllDocuments, visit, type Document, type ScalarTag, type Tags } from 'yaml'

const BOOL_TAG = 'tag:yaml.org,2002:bool'

const strictBool: ScalarTag = {
  identify: (value) => typeof value === 'boolean',
  default: true,
  tag: BOOL_TAG,
  test: /^(?:true|false)$/,
  resolve: (source) => source === 'true',
}

const strictTags = (tags: Tags): Tags => tags.map((tag) => (typeof tag === 'object' && tag.tag === BOOL_TAG ? strictBool : tag))

export type PathSegment = string | number

export interface YamlDocument {
  /** 파일 안 문서 번호 (1부터) */
  readonly index: number
  readonly value: unknown
  /** 문서 안 경로의 줄 번호 (1부터). 경로가 없으면 가장 가까운 상위 노드의 줄 */
  lineOf(path: readonly PathSegment[]): number | undefined
}

export interface YamlIssue {
  readonly line?: number
  readonly message: string
}

export type YamlParseResult =
  | { readonly ok: true; readonly documents: readonly YamlDocument[] }
  | { readonly ok: false; readonly issues: readonly YamlIssue[] }

const PARSE_OPTIONS = {
  version: '1.2',
  schema: 'core',
  customTags: strictTags,
  merge: false,
  uniqueKeys: true,
  strict: true,
  prettyErrors: true,
  intAsBigInt: false,
} as const

function issueOf(error: { message: string; linePos?: readonly [{ line: number }, ...unknown[]] | undefined }): YamlIssue {
  const firstLine = error.message.split('\n')[0] ?? error.message
  const line = error.linePos?.[0]?.line
  return line === undefined ? { message: firstLine } : { line, message: firstLine }
}

function nodeOffset(doc: Document, path: readonly PathSegment[]): number | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    const node: unknown = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true)
    if (typeof node === 'object' && node !== null && 'range' in node) {
      const range = (node as { range?: readonly number[] | null }).range
      if (range && typeof range[0] === 'number') return range[0]
    }
  }
  return undefined
}

/** 골든 파일 하나를 읽는다. 문법 오류·경고가 하나라도 있으면 파일 전체가 읽기 오류다. */
export function parseGoldenYaml(text: string): YamlParseResult {
  const lineCounter = new LineCounter()
  const parsed = parseAllDocuments(text, { ...PARSE_OPTIONS, lineCounter })
  const docs: readonly Document[] = [...parsed]
  const issues: YamlIssue[] = []
  if ('empty' in parsed) {
    // 문서가 하나도 없는 스트림: 스트림 단위 오류·경고만 있다
    for (const error of parsed.errors) issues.push(issueOf(error))
    for (const warning of parsed.warnings) issues.push(issueOf(warning))
  }
  for (const doc of docs) {
    for (const error of doc.errors) issues.push(issueOf(error))
    for (const warning of doc.warnings) issues.push(issueOf(warning))
    // 명시적 태그는 core schema 밖의 타입(날짜·바이너리 등)을 만들 수 있으므로 쓰지 않는다
    visit(doc, {
      Node(_key, node) {
        if (node.tag !== undefined) {
          const offset = node.range?.[0]
          issues.push({
            ...(offset === undefined ? {} : { line: lineCounter.linePos(offset).line }),
            message: `명시적 태그 ${node.tag}는 쓸 수 없다 (YAML 1.2 core schema만)`,
          })
        }
      },
    })
  }
  if (issues.length > 0) return { ok: false, issues }

  const documents: YamlDocument[] = []
  for (const [i, doc] of docs.entries()) {
    let value: unknown
    try {
      value = doc.toJS({ maxAliasCount: 1000 })
    } catch (error) {
      return { ok: false, issues: [{ message: `YAML 값 변환 실패: ${error instanceof Error ? error.message : String(error)}` }] }
    }
    documents.push({
      index: i + 1,
      value,
      lineOf(path) {
        const offset = nodeOffset(doc, path)
        return offset === undefined ? undefined : lineCounter.linePos(offset).line
      },
    })
  }
  return { ok: true, documents }
}
