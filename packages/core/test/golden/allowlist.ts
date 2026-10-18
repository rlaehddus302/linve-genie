// 알려진 미구현 허용 목록 (D-020, tests/golden/known-unimplemented.yaml).
// - "미구현"만 허용한다. 불일치·읽기 오류·결정성 위반·러너 오류는 목록과 상관없이 실패다.
// - 목록을 넓히는 환경변수·명령행 옵션은 없다. 파일이 없으면 빈 목록이다.
// - 모르는 키·suite 이름, 어떤 시나리오와도 맞지 않는 패턴, 형식 오류는 읽기 오류다.
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
  | { readonly ok: true; readonly allowlist: Allowlist }
  | { readonly ok: false; readonly issues: readonly ReadIssue[]; readonly sprint?: string }

/** `*`는 0글자 이상, 나머지는 글자 그대로 */
export function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`)
}

/**
 * 허용 목록을 읽고, 실제로 불러온 suite·시나리오와 대조한다.
 * @param text 파일 내용 (null = 파일 없음 → 빈 목록)
 * @param loadedSuites 읽기 오류 없이 불러온 suite 이름
 * @param knownScenarioIds 골든에 있는 시나리오 ID (읽기 오류 문서의 ID 포함)
 */
export function readAllowlist(text: string | null, loadedSuites: ReadonlySet<string>, knownScenarioIds: ReadonlySet<string>): AllowlistResult {
  if (text === null) return { ok: true, allowlist: EMPTY_ALLOWLIST }
  const parsed = parseGoldenYaml(text)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }
  if (parsed.documents.length > 1) return { ok: false, issues: [{ message: '허용 목록은 YAML 문서 하나여야 한다' }] }
  const doc = parsed.documents[0]
  const value: unknown = doc === undefined ? null : doc.value
  if (value === null) return { ok: true, allowlist: EMPTY_ALLOWLIST }
  if (!isPlainObject(value)) return { ok: false, issues: [{ message: `허용 목록은 맵이어야 한다 (값: ${showValue(value)})` }] }

  const issues: ReadIssue[] = []
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
        } else if (!loadedSuites.has(name)) {
          issues.push({ ...where, message: `suite '${name}'에 맞는 골든 문서가 없다` })
        } else {
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
        if (![...knownScenarioIds].some((id) => regex.test(id))) {
          issues.push({ ...where, message: `패턴 '${pattern}'에 맞는 시나리오가 없다` })
          return
        }
        patterns.push({ pattern, regex })
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues, ...(sprint === undefined ? {} : { sprint }) }
  return { ok: true, allowlist: { ...(sprint === undefined ? {} : { sprint }), suites, patterns } }
}
