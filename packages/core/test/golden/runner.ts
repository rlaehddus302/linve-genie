// 골든 러너 본체 (README "러너가 읽는 범위"·"결과 상태", D-020, D-021, NFR-02).
// 입력은 파일 내용(문자열)과 코어(GoldenCore)뿐이다. 파일 시스템·환경변수·명령행을 보지 않는다.
import { isNotImplemented } from '@livejjim/core'
import { EMPTY_ALLOWLIST, readAllowlist, type Allowlist } from './allowlist.ts'
import { SCENARIO_ID_RE, SUITES, isPlainObject, type SuiteName } from './contract.ts'
import { compareExpect, compareParserOutput } from './compare.ts'
import { SerializationError, stableSerialize } from './serialize.ts'
import { snapshotIssues } from './snapshot-check.ts'
import type {
  FileSummary,
  GoldenCore,
  GoldenEngineCore,
  GoldenEvent,
  GoldenReport,
  GoldenSnapshot,
  GoldenTotals,
  ItemResult,
  ItemStatus,
  Problem,
  ReadError,
} from './types.ts'
import { formatPath, validateDocument, type ParserCase, type ScenarioDoc, type ValidatedDocument } from './validate.ts'
import { parseGoldenYaml } from './yaml.ts'

export interface GoldenSource {
  /** 보고에 쓰는 경로. 파일은 이 경로의 문자 코드 순서로 처리한다. */
  readonly path: string
  readonly text: string
}

export interface RunGoldenSourcesOptions {
  readonly files: readonly GoldenSource[]
  /** 허용 목록. `text: null`이면 파일 없음 → 빈 목록 */
  readonly allowlist: { readonly path: string; readonly text: string | null }
  readonly core: GoldenCore
  /** 보고 머리말에 쓰는 골든 폴더 이름 */
  readonly goldenLabel?: string
}

/** 러너가 스스로 판단한 실패 (러너 오류로 센다) */
class RunnerFailure extends Error {
  readonly where: string | undefined

  constructor(message: string, where?: string) {
    super(message)
    this.name = 'RunnerFailure'
    this.where = where
  }
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return `던져진 값: ${String(error)}`
}

// ── 파서 사례 ────────────────────────────────────────────────────────────

function runParserCase(core: GoldenCore, suite: SuiteName, settings: object, testCase: ParserCase): { status: ItemStatus; problems: Problem[] } {
  let actual: unknown
  try {
    const copy = { ...settings }
    switch (suite) {
      case 'chat':
        actual = core.parser.chat(testCase.input, copy)
        break
      case 'amount':
        actual = core.parser.amount(testCase.input, copy)
        break
      case 'korean-number':
        actual = core.parser.koreanNumber(testCase.input)
        break
      case 'quick-input':
        actual = core.parser.quickInput(testCase.input, copy)
        break
    }
  } catch (error) {
    if (isNotImplemented(error)) return { status: 'not-implemented', problems: [{ message: error.message }] }
    return { status: 'runner-error', problems: [{ message: `미구현이 아닌 예외: ${describeError(error)}` }] }
  }
  let problems: Problem[]
  try {
    problems = compareParserOutput(suite, testCase.out, actual)
  } catch (error) {
    return { status: 'runner-error', problems: [{ message: `결과 비교 중 예외: ${describeError(error)}` }] }
  }
  return { status: problems.length > 0 ? 'mismatch' : 'pass', problems }
}

// ── 엔진 시나리오 ────────────────────────────────────────────────────────

interface TraceStep {
  readonly where: string
  readonly serialized: string
}

interface Trace {
  readonly steps: readonly TraceStep[]
  readonly problems: readonly Problem[]
  /** 코어가 "미구현"을 알려 멈춘 지점. 끝까지 돌았으면 없음 */
  readonly stoppedAt?: { readonly where: string; readonly message: string }
}

/** 최종 expect 비교에서 멈췄을 때의 위치 이름 */
const FINAL_EXPECT = 'expect (최종 비교)'

function checkEffectReport(event: GoldenEvent, snapshot: GoldenSnapshot): string | undefined {
  if (event.type !== 'effect.labelPrinted' && event.type !== 'effect.thanksSent') return undefined
  const kind = event.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
  const product = `${String(event.b)}/${String(event.no)}`
  const buyerKey = String(event.buyer)
  const buyerId = Object.hasOwn(snapshot.buyerKeys, buyerKey) ? snapshot.buyerKeys[buyerKey] : undefined
  const target = event.type === 'effect.thanksSent' ? (typeof event.target === 'string' ? event.target : 'LIVE_CHAT') : undefined
  const found = snapshot.effects.some(
    (effect) =>
      effect.kind === kind &&
      effect.product === product &&
      buyerId !== undefined &&
      effect.buyer === buyerId &&
      (target === undefined || effect.target === target) &&
      effect.status !== 'CANCELLED',
  )
  if (found) return undefined
  return `효과 보고 대상이 없다: ${event.type} ${product} ${buyerKey}${target === undefined ? '' : ` ${target}`} (취소되지 않은 ${kind} 효과 없음)`
}

/**
 * 시나리오를 처음부터 한 번 돌린다.
 * 코어가 "미구현"을 알리면 그 지점에서 멈추되, 그때까지 쌓인 trace·problems는 버리지 않고 함께 돌려준다
 * (README "결과 상태": 불일치·결정성 위반은 허용 목록과 상관없이 항상 실패 — 뒤의 미구현이 앞의 실패를 가리면 안 된다).
 */
function runScenarioOnce(engine: GoldenEngineCore, doc: ScenarioDoc): Trace {
  const steps: TraceStep[] = []
  const problems: Problem[] = []
  let where = '시작 상태'
  try {
    let state = engine.start(structuredClone(doc.setup))
    /** 지금 상태를 직렬화한 값. 엔진이 상태를 제자리에서 바꾸는지 확인한다 (RA-S00-001) */
    let stateText = stableSerialize(state)
    /** 관찰 스냅샷 + 형식 검사 (TD-S00-010). 형식이 틀리면 러너 오류 */
    const look = (at: string | undefined): GoldenSnapshot => {
      const seen = engine.observe(state)
      const issues = snapshotIssues(seen)
      if (issues.length > 0) {
        const shown = issues.slice(0, 5).join(' · ')
        throw new RunnerFailure(`관찰 스냅샷 형식 오류 ${issues.length}건: ${shown}${issues.length > 5 ? ' …' : ''}`, at)
      }
      return seen
    }
    let snapshot: GoldenSnapshot | undefined
    const observe = (at: string | undefined): GoldenSnapshot => (snapshot ??= look(at))
    const compare = (expect: ScenarioDoc['expect'], at: string | undefined): Problem[] => {
      const seen = observe(at ?? FINAL_EXPECT)
      try {
        return compareExpect(expect, seen, at)
      } catch (error) {
        throw new RunnerFailure(`관찰 스냅샷 비교 중 예외 (스냅샷 형식 오류?): ${describeError(error)}`, at)
      }
    }
    // 결정성 검사의 첫 단계에 시작 상태의 관찰 스냅샷도 넣는다 (TD-S00-009).
    // 관찰이 아직 미구현인 코어(S00 가짜 코어 등)는 표시만 남기고, 관찰이 필요한 지점에서 미구현으로 멈춘다.
    let startSnapshot: GoldenSnapshot | string
    try {
      startSnapshot = observe(where)
    } catch (error) {
      if (!isNotImplemented(error)) throw error
      startSnapshot = '(관찰 미구현)'
    }
    steps.push({ where, serialized: stableSerialize({ state, snapshot: startSnapshot }) })

    for (const step of doc.steps) {
      where = `events[${step.index}]`
      if (step.kind === 'assert') {
        problems.push(...compare(step.expect, where))
        continue
      }
      const reportProblem = checkEffectReport(step.event, observe(where))
      if (reportProblem !== undefined) throw new RunnerFailure(reportProblem, where)
      if (stableSerialize(state) !== stateText) throw new RunnerFailure('관찰·불변식 검사 중에 엔진이 상태를 제자리에서 바꿨다 (RA-S00-001)', where)
      const result: unknown = engine.apply(state, structuredClone(step.event))
      if (stableSerialize(state) !== stateText) {
        throw new RunnerFailure('엔진이 넘겨받은 상태를 제자리에서 바꿨다 — apply는 입력을 그대로 두고 새 상태를 돌려줘야 한다 (RA-S00-001, AC-S02-02)', where)
      }
      if (typeof result !== 'object' || result === null || !('state' in result) || !('effects' in result) || !Array.isArray(result.effects)) {
        throw new RunnerFailure('apply 결과는 { state, effects: [] } 모양이어야 한다', where)
      }
      state = result.state
      stateText = stableSerialize(state)
      snapshot = look(where)
      for (const violation of engine.invariants?.(state, snapshot) ?? []) {
        problems.push({ where, path: `불변식 ${violation.id}`, message: violation.message })
      }
      steps.push({ where, serialized: stableSerialize({ state, effects: result.effects, snapshot }) })
    }
    where = FINAL_EXPECT
    problems.push(...compare(doc.expect, undefined))
  } catch (error) {
    if (!isNotImplemented(error)) throw error
    return { steps, problems, stoppedAt: { where, message: error.message } }
  }
  return { steps, problems }
}

function excerpt(text: string | undefined, at: number): string {
  if (text === undefined) return '(없음)'
  const start = Math.max(0, at - 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, at + 60)}${at + 60 < text.length ? '…' : ''}`
}

function firstDifference(a: readonly TraceStep[], b: readonly TraceStep[]): Problem | undefined {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x?.serialized === y?.serialized) continue
    const sx = x?.serialized ?? ''
    const sy = y?.serialized ?? ''
    let at = 0
    while (at < sx.length && at < sy.length && sx[at] === sy[at]) at++
    return {
      where: x?.where ?? y?.where ?? '(알 수 없음)',
      message: '처음부터 두 번 실행한 결과(상태·효과·관찰 스냅샷)가 다르다',
      expected: excerpt(x?.serialized, at),
      actual: excerpt(y?.serialized, at),
    }
  }
  return undefined
}

/** 두 실행이 미구현으로 멈춘 지점이 다르면 결정성 위반 (같은 이벤트 열인데 한쪽만 더 가거나 덜 갔다) */
function stopDifference(first: Trace, second: Trace): Problem | undefined {
  const a = first.stoppedAt?.where
  const b = second.stoppedAt?.where
  if (a === b) return undefined
  const describe = (where: string | undefined): string => (where === undefined ? '끝까지 실행' : `${where}에서 미구현으로 멈춤`)
  return {
    where: a ?? b ?? '(알 수 없음)',
    message: '처음부터 두 번 실행했는데 "미구현"으로 멈춘 지점이 다르다',
    expected: describe(a),
    actual: describe(b),
  }
}

/**
 * 엔진 시나리오 하나의 결과 (README "결과 상태", AC-S00-23, AC-S00-27).
 * 판정 우선순위: 러너 오류 > 결정성 위반 > 불일치 > 미구현 > 통과.
 * - 미구현으로 멈춰도 두 번째 실행을 같은 지점까지 돌려 그 앞까지의 결정성을 비교한다.
 * - 멈추기 전에 드러난 불일치·불변식 위반은 그대로 불일치다(허용 목록으로 숨길 수 없다).
 */
function runScenario(core: GoldenCore, doc: ScenarioDoc): { status: ItemStatus; problems: Problem[] } {
  let first: Trace
  try {
    first = runScenarioOnce(core.engine, doc)
  } catch (error) {
    if (error instanceof RunnerFailure) return { status: 'runner-error', problems: [{ ...(error.where ? { where: error.where } : {}), message: error.message }] }
    if (error instanceof SerializationError) return { status: 'runner-error', problems: [{ message: error.message }] }
    return { status: 'runner-error', problems: [{ message: `미구현이 아닌 예외: ${describeError(error)}` }] }
  }
  let second: Trace
  try {
    second = runScenarioOnce(core.engine, doc)
  } catch (error) {
    const firstEnd = first.stoppedAt === undefined ? '첫 실행은 끝났는데' : `첫 실행은 ${first.stoppedAt.where}에서 미구현으로 멈췄는데`
    return {
      status: 'determinism',
      problems: [{ message: `${firstEnd} 두 번째 실행에서만 예외가 났다: ${describeError(error)}` }, ...first.problems],
    }
  }
  const difference = firstDifference(first.steps, second.steps) ?? stopDifference(first, second)
  if (difference) return { status: 'determinism', problems: [difference, ...first.problems] }
  const { stoppedAt } = first
  if (first.problems.length > 0) {
    const stopNote: Problem[] =
      stoppedAt === undefined
        ? []
        : [{ where: stoppedAt.where, message: `여기서 코어가 미구현을 알려 멈췄다. 이 뒤는 확인하지 못했다: ${stoppedAt.message}` }]
    return { status: 'mismatch', problems: [...first.problems, ...stopNote] }
  }
  if (stoppedAt !== undefined) return { status: 'not-implemented', problems: [{ where: stoppedAt.where, message: stoppedAt.message }] }
  return { status: 'pass', problems: [] }
}

// ── 전체 실행 ────────────────────────────────────────────────────────────

interface LoadedDocument {
  readonly file: string
  readonly docIndex: number
  readonly doc: ValidatedDocument
}

/** 형식 검증과 상관없이 문서가 어느 suite·시나리오인지 (허용 목록 대조용). 알아볼 수 없으면 빈 객체 */
function documentIdentity(value: unknown): { readonly suite?: SuiteName; readonly id?: string } {
  if (!isPlainObject(value)) return {}
  const suite = typeof value.suite === 'string' && (SUITES as readonly string[]).includes(value.suite) ? (value.suite as SuiteName) : undefined
  const id = typeof value.id === 'string' && SCENARIO_ID_RE.test(value.id) ? value.id : undefined
  return { ...(suite === undefined ? {} : { suite }), ...(id === undefined ? {} : { id }) }
}

/** 골든 파일 내용과 허용 목록으로 골든을 돌린다 (프로그램 API, 테스트용). */
export function runGoldenSources(options: RunGoldenSourcesOptions): GoldenReport {
  const files = [...options.files].sort((a, b) => byCodeUnit(a.path, b.path))
  const readErrors: ReadError[] = []
  const loaded: LoadedDocument[] = []
  // 허용 목록 대조용: 읽기 오류 문서까지 포함해 골든에 있는 suite·시나리오 ID (AC-S00-22: 한 문서의 오류가 다른 파일 결과를 가리지 않게)
  const knownSuites = new Set<string>()
  const knownIds = new Set<string>()
  /** 정체를 알 수 없는 읽기 오류(파일 전체를 못 읽음, suite·id를 알아볼 수 없는 문서)가 있는지 */
  let goldenIncomplete = false
  const firstSeen = new Map<string, { file: string; docIndex: number }>()
  const summaries = new Map<string, { parserCases: number; scenarios: number; readErrors: number }>()

  if (files.length === 0) {
    readErrors.push({ file: options.goldenLabel ?? '(골든)', issues: [{ message: '골든 파일(*.yaml·*.yml)이 하나도 없다' }] })
  }

  for (const file of files) {
    const summary = { parserCases: 0, scenarios: 0, readErrors: 0 }
    summaries.set(file.path, summary)
    const parsed = parseGoldenYaml(file.text)
    if (!parsed.ok) {
      readErrors.push({ file: file.path, issues: parsed.issues.map((issue) => ({ ...issue, message: `YAML 오류: ${issue.message}` })) })
      summary.readErrors++
      goldenIncomplete = true
      continue
    }
    if (parsed.documents.length === 0) {
      readErrors.push({ file: file.path, issues: [{ message: 'YAML 문서가 없다' }] })
      summary.readErrors++
      goldenIncomplete = true
      continue
    }
    for (const document of parsed.documents) {
      const identity = documentIdentity(document.value)
      if (identity.suite !== undefined) knownSuites.add(identity.suite)
      if (identity.id !== undefined) knownIds.add(identity.id)
      const result = validateDocument(document.value)
      if (!result.ok) {
        if (identity.suite === undefined && identity.id === undefined) goldenIncomplete = true
        readErrors.push({
          file: file.path,
          docIndex: document.index,
          ...(result.label === undefined ? {} : { label: result.label }),
          issues: result.issues.map((issue) => {
            const line = document.lineOf(issue.path)
            const path = formatPath(issue.path)
            return { ...(path === '' ? {} : { path }), ...(line === undefined ? {} : { line }), message: issue.message }
          }),
        })
        summary.readErrors++
        continue
      }
      const doc = result.doc
      if (doc.kind === 'scenario') {
        const previous = firstSeen.get(doc.id)
        if (previous) {
          const line = document.lineOf(['id'])
          readErrors.push({
            file: file.path,
            docIndex: document.index,
            label: doc.id,
            issues: [{ path: 'id', ...(line === undefined ? {} : { line }), message: `시나리오 ID 중복 (처음: ${previous.file} 문서 ${previous.docIndex})` }],
          })
          summary.readErrors++
          continue
        }
        firstSeen.set(doc.id, { file: file.path, docIndex: document.index })
        summary.scenarios++
      } else {
        summary.parserCases += doc.cases.length
      }
      loaded.push({ file: file.path, docIndex: document.index, doc })
    }
  }

  // 허용 목록
  const allowlistResult = readAllowlist(options.allowlist.text, knownSuites, knownIds, { goldenIncomplete })
  let allowlist: Allowlist = EMPTY_ALLOWLIST
  let sprint: string | undefined
  const warnings: string[] = []
  if (allowlistResult.ok) {
    allowlist = allowlistResult.allowlist
    sprint = allowlist.sprint
    for (const note of allowlistResult.deferred) warnings.push(`허용 목록 ${note}`)
  } else {
    sprint = allowlistResult.sprint
    readErrors.push({ file: options.allowlist.path, label: '허용 목록', issues: allowlistResult.issues })
  }

  // 실행
  const items: ItemResult[] = []
  for (const entry of loaded) {
    const { doc } = entry
    if (doc.kind === 'suite') {
      const listed = allowlist.suites.has(doc.suite)
      for (const testCase of doc.cases) {
        const { status, problems } = runParserCase(options.core, doc.suite, doc.settings, testCase)
        items.push({
          kind: 'parser',
          file: entry.file,
          docIndex: entry.docIndex,
          suite: doc.suite,
          caseIndex: testCase.index,
          input: testCase.input,
          status,
          listed,
          allowed: listed && status === 'not-implemented',
          problems,
        })
      }
    } else {
      const listed = allowlist.patterns.some(({ regex }) => regex.test(doc.id))
      const { status, problems } = runScenario(options.core, doc)
      items.push({
        kind: 'scenario',
        file: entry.file,
        docIndex: entry.docIndex,
        id: doc.id,
        title: doc.title,
        status,
        listed,
        allowed: listed && status === 'not-implemented',
        problems,
      })
    }
  }

  // 경고: 허용 목록에 있는데 통과
  for (const suite of allowlist.suites) {
    const cases = items.filter((item) => item.kind === 'parser' && item.suite === suite)
    const passed = cases.filter((item) => item.status === 'pass').length
    if (cases.length > 0 && passed === cases.length) warnings.push(`허용 목록에서 빼도 됨: suite '${suite}' (사례 ${cases.length}개 모두 통과)`)
    else if (passed > 0) warnings.push(`허용 목록 suite '${suite}': 사례 ${passed}/${cases.length}개 통과`)
  }
  for (const item of items) {
    if (item.kind === 'scenario' && item.listed && item.status === 'pass') warnings.push(`허용 목록에서 빼도 됨: 시나리오 ${item.id} (통과)`)
  }

  const count = (predicate: (item: ItemResult) => boolean): number => items.filter(predicate).length
  const totals: GoldenTotals = {
    files: files.length,
    parserCases: count((item) => item.kind === 'parser'),
    scenarios: count((item) => item.kind === 'scenario'),
    pass: count((item) => item.status === 'pass'),
    mismatch: count((item) => item.status === 'mismatch'),
    notImplementedAllowed: count((item) => item.status === 'not-implemented' && item.allowed),
    notImplementedDisallowed: count((item) => item.status === 'not-implemented' && !item.allowed),
    readError: readErrors.length,
    determinism: count((item) => item.status === 'determinism'),
    runnerError: count((item) => item.status === 'runner-error'),
  }
  const ok = totals.mismatch + totals.notImplementedDisallowed + totals.readError + totals.determinism + totals.runnerError === 0

  const fileSummaries: FileSummary[] = files.map((file) => ({ file: file.path, ...(summaries.get(file.path) ?? { parserCases: 0, scenarios: 0, readErrors: 0 }) }))
  return {
    goldenLabel: options.goldenLabel ?? '(골든)',
    allowlist: { file: options.allowlist.path, present: options.allowlist.text !== null, ...(sprint === undefined ? {} : { sprint }) },
    files: fileSummaries,
    readErrors,
    items,
    warnings,
    totals,
    ok,
  }
}
