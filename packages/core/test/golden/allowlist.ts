// 알려진 미구현 허용 목록 (D-020, tests/golden/known-unimplemented.yaml).
// - "미구현"만 허용한다. 불일치·읽기 오류·결정성 위반·러너 오류는 목록과 상관없이 실패다.
// - 목록을 넓히는 환경변수·명령행 옵션은 없다. 파일이 없으면 빈 목록이다.
// - 모르는 키·suite 이름, 어떤 시나리오와도 맞지 않는 패턴, 형식 오류는 읽기 오류다.
// - 단, 골든 쪽에 정체(suite·시나리오 ID)를 알 수 없는 읽기 오류 문서가 있으면 "맞는 문서 없음"은 판단할 수 없다.
//   그때는 그 항목을 읽기 오류로 만들지 않고 "확인 보류"로 돌려준다(AC-S00-22: 한 파일의 오류가 다른 파일 결과를 가리지 않는다).
//   그런 항목은 불러온 어떤 항목과도 맞지 않으므로 아무것도 더 허용하지 않는다. 골든 읽기 오류 때문에 실행은 어차피 실패다.
import { SUITES, isPlainObject, showValue, type SuiteName } from './contract.ts'
import { parseGoldenYaml } from './yaml.ts'
import type { ReadIssue } from './types.ts'

export interface Allowlist {
  readonly sprint?: string
  readonly suites: ReadonlySet<SuiteName>
  readonly patterns: readonly { readonly pattern: string; readonly regex: RegExp }[]
}

export const EMPTY_ALLOWLIST: Allowlist = { suites: new Set(), patterns: [] }

export type AllowlistResult =
  | {
      readonly ok: true
      readonly allowlist: Allowlist
      /** 골든을 다 읽지 못해 "맞는 문서 없음"을 판단하지 못한 항목 (경고로 보여 준다) */
      readonly deferred: readonly string[]
    }
  | { readonly ok: false; readonly issues: readonly ReadIssue[]; readonly sprint?: string }

/** `*`는 0글자 이상, 나머지는 글자 그대로 */
export function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`)
}

export interface ReadAllowlistOptions {
  /**
   * 골든에 정체를 알 수 없는 읽기 오류 문서가 있다(YAML 문법 오류로 파일을 못 읽음, suite·id를 알아볼 수 없는 문서 등).
   * true면 "맞는 문서·시나리오가 없다"를 읽기 오류 대신 확인 보류(deferred)로 돌려준다.
   */
  readonly goldenIncomplete?: boolean
}

/**
 * 허용 목록을 읽고, 골든에 있는 suite·시나리오와 대조한다.
 * @param text 파일 내용 (null = 파일 없음 → 빈 목록)
 * @param knownSuites 골든에 있는 suite 이름 (읽기 오류 문서의 suite 포함)
 * @param knownScenarioIds 골든에 있는 시나리오 ID (읽기 오류 문서의 ID 포함)
 */
export function readAllowlist(
  text: string | null,
  knownSuites: ReadonlySet<string>,
  knownScenarioIds: ReadonlySet<string>,
  options: ReadAllowlistOptions = {},
): AllowlistResult {
  const issues: ReadIssue[] = []
  const deferred: string[] = []
  /** 맞는 골든 문서가 없는 항목: 골든을 다 읽었으면 읽기 오류, 아니면 확인 보류 */
  const unmatched = (issue: ReadIssue): void => {
    if (options.goldenIncomplete === true) deferred.push(`${issue.path === undefined ? '' : `${issue.path}: `}${issue.message} (읽지 못한 골든 문서가 있어 확인 보류)`)
    else issues.push(issue)
  }
  if (text === null) return { ok: true, allowlist: EMPTY_ALLOWLIST, deferred }
  const parsed = parseGoldenYaml(text)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }
  if (parsed.documents.length > 1) return { ok: false, issues: [{ message: '허용 목록은 YAML 문서 하나여야 한다' }] }
  const doc = parsed.documents[0]
  const value: unknown = doc === undefined ? null : doc.value
  if (value === null) return { ok: true, allowlist: EMPTY_ALLOWLIST, deferred }
  if (!isPlainObject(value)) return { ok: false, issues: [{ message: `허용 목록은 맵이어야 한다 (값: ${showValue(value)})` }] }

  const lineOf = (path: (string | number)[]): { line?: number } => {
    const line = doc?.lineOf(path)
    return line === undefined ? {} : { line }
  }
  for (const key of Object.keys(value)) {
    if (key !== 'sprint' && key !== 'suites' && key !== 'scenarios') issues.push({ path: key, ...lineOf([key]), message: `모르는 키 '${key}'` })
  }
  let sprint: string | undefined
  if (Object.hasOwn(value, 'sprint')) {
    if (typeof value.sprint === 'string' && value.sprint !== '') sprint = value.sprint
    else issues.push({ path: 'sprint', ...lineOf(['sprint']), message: `sprint는 문자열이어야 한다 (값: ${showValue(value.sprint)})` })
  }

  const suites = new Set<SuiteName>()
  if (Object.hasOwn(value, 'suites')) {
    const list = value.suites
    if (!Array.isArray(list)) issues.push({ path: 'suites', ...lineOf(['suites']), message: `suites는 목록이어야 한다 (값: ${showValue(list)})` })
    else {
      list.forEach((name, i) => {
        const where = { path: `suites[${i}]`, ...lineOf(['suites', i]) }
        if (typeof name !== 'string' || !(SUITES as readonly string[]).includes(name)) {
          issues.push({ ...where, message: `모르는 suite 이름 ${showValue(name)} (${SUITES.join(' / ')} 중 하나)` })
        } else if (suites.has(name as SuiteName)) {
          issues.push({ ...where, message: `suite '${name}' 중복` })
        } else {
          if (!knownSuites.has(name)) unmatched({ ...where, message: `suite '${name}'에 맞는 골든 문서가 없다` })
          suites.add(name as SuiteName)
        }
      })
    }
  }

  const patterns: { pattern: string; regex: RegExp }[] = []
  if (Object.hasOwn(value, 'scenarios')) {
    const list = value.scenarios
    if (!Array.isArray(list)) issues.push({ path: 'scenarios', ...lineOf(['scenarios']), message: `scenarios는 목록이어야 한다 (값: ${showValue(list)})` })
    else {
      const seen = new Set<string>()
      list.forEach((pattern, i) => {
        const where = { path: `scenarios[${i}]`, ...lineOf(['scenarios', i]) }
        if (typeof pattern !== 'string' || pattern === '') {
          issues.push({ ...where, message: `시나리오 패턴은 빈 문자열이 아닌 문자열이어야 한다 (값: ${showValue(pattern)})` })
          return
        }
        if (seen.has(pattern)) {
          issues.push({ ...where, message: `패턴 '${pattern}' 중복` })
          return
        }
        seen.add(pattern)
        const regex = patternToRegExp(pattern)
        if (![...knownScenarioIds].some((id) => regex.test(id))) unmatched({ ...where, message: `패턴 '${pattern}'에 맞는 시나리오가 없다` })
        patterns.push({ pattern, regex })
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues, ...(sprint === undefined ? {} : { sprint }) }
  return { ok: true, allowlist: { ...(sprint === undefined ? {} : { sprint }), suites, patterns }, deferred }
}
