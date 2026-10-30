// 골든 결과 보고 (README "결과 상태", AC-S00-28).
// 같은 입력이면 출력이 글자 하나까지 같다(소요 시간 줄 제외). 시각·난수·환경값을 찍지 않는다.
import { showValue } from './contract.ts'
import type { GoldenReport, GoldenTotals, ItemResult, Problem } from './types.ts'

const STATUS_LABEL = {
  pass: '통과',
  mismatch: '불일치',
  'not-implemented': '미구현',
  determinism: '결정성 위반',
  'runner-error': '러너 오류',
} as const

function display(value: unknown): string {
  return value === undefined ? '(없음)' : showValue(value)
}

/** 항목 위치: 파일 · (시나리오 ID | suite 문서 n · 사례 m · 입력 "…") */
export function itemLocation(item: ItemResult): string {
  if (item.kind === 'scenario') return `${item.file} · ${item.id}`
  return `${item.file} · ${item.suite} 문서 ${item.docIndex} · 사례 ${item.caseIndex} · 입력 ${JSON.stringify(item.input)}${item.from === undefined ? '' : ` · 보낸 곳 ${JSON.stringify(item.from)}`}`
}

export function itemStatusLabel(item: ItemResult): string {
  if (item.status === 'not-implemented') return item.allowed ? '미구현(허용)' : '미구현(불허)'
  return STATUS_LABEL[item.status]
}

function problemLines(problem: Problem): string[] {
  const lines: string[] = []
  if (problem.where !== undefined) {
    const isAssert = problem.path !== undefined && !problem.path.startsWith('불변식') && problem.where.startsWith('events[')
    lines.push(`위치: ${problem.where}${isAssert ? ' (중간 검사)' : ''}`)
  }
  if (problem.path !== undefined) lines.push(`경로: ${problem.path}`)
  if ('expected' in problem) lines.push(`기대: ${display(problem.expected)}`)
  if ('actual' in problem) lines.push(`실제: ${display(problem.actual)}`)
  if (problem.message !== undefined) lines.push(`설명: ${problem.message}`)
  return lines
}

/** 끝 줄 합계 (verify가 이 줄을 읽는다) */
export function formatTotals(totals: GoldenTotals): string {
  return [
    `합계: 파일 ${totals.files}`,
    `파서 사례 ${totals.parserCases}`,
    `엔진 시나리오 ${totals.scenarios}`,
    `통과 ${totals.pass}`,
    `불일치 ${totals.mismatch}`,
    `미구현(허용) ${totals.notImplementedAllowed}`,
    `미구현(불허) ${totals.notImplementedDisallowed}`,
    `읽기 오류 ${totals.readError}`,
    `결정성 위반 ${totals.determinism}`,
    `러너 오류 ${totals.runnerError}`,
  ].join(' · ')
}

export function formatReport(report: GoldenReport): string {
  const out: string[] = []
  const allowlist = report.allowlist.present
    ? `${report.allowlist.file}${report.allowlist.sprint === undefined ? '' : ` (sprint ${report.allowlist.sprint})`}`
    : `${report.allowlist.file} (파일 없음 → 빈 목록)`
  out.push('골든 러너 — tests/golden/README.md 형식 계약 (D-020, D-021)')
  out.push(`골든 폴더: ${report.goldenLabel}`)
  out.push(`허용 목록: ${allowlist}`)
  out.push('')

  out.push('파일별')
  for (const file of report.files) {
    const items = report.items.filter((item) => item.file === file.file)
    const byStatus = new Map<string, number>()
    for (const item of items) byStatus.set(itemStatusLabel(item), (byStatus.get(itemStatusLabel(item)) ?? 0) + 1)
    const parts: string[] = []
    if (file.parserCases > 0) parts.push(`파서 사례 ${file.parserCases}`)
    if (file.scenarios > 0) parts.push(`엔진 시나리오 ${file.scenarios}`)
    for (const [label, n] of byStatus) parts.push(`${label} ${n}`)
    if (file.readErrors > 0) parts.push(`읽기 오류 ${file.readErrors}`)
    out.push(`  ${file.file}  ${parts.join(' · ')}`)
  }

  if (report.readErrors.length > 0) {
    out.push('')
    out.push(`읽기 오류 ${report.readErrors.length}건 (허용 목록과 상관없이 실패)`)
    for (const error of report.readErrors) {
      const head = [error.file]
      if (error.docIndex !== undefined) head.push(`문서 ${error.docIndex}`)
      if (error.label !== undefined) head.push(error.label)
      out.push(`  ✗ 읽기 오류 · ${head.join(' · ')}`)
      for (const issue of error.issues) {
        const where = [issue.path, issue.line === undefined ? undefined : `줄 ${issue.line}`].filter((x) => x !== undefined).join(' · ')
        out.push(`      ${where === '' ? '' : `${where}: `}${issue.message}`)
      }
    }
  }

  const failures = report.items.filter((item) => item.status !== 'pass' && !(item.status === 'not-implemented' && item.allowed))
  if (failures.length > 0) {
    out.push('')
    out.push(`실패 ${failures.length}건`)
    for (const item of failures) {
      out.push(`  ✗ ${itemStatusLabel(item)} · ${itemLocation(item)}`)
      for (const problem of item.problems) {
        const lines = problemLines(problem)
        lines.forEach((line, i) => out.push(`      ${i === 0 ? '- ' : '  '}${line}`))
      }
    }
  }

  if (report.warnings.length > 0) {
    out.push('')
    out.push(`경고 ${report.warnings.length}건 (실패 아님)`)
    for (const warning of report.warnings) out.push(`  ! ${warning}`)
  }

  out.push('')
  out.push(formatTotals(report.totals))
  out.push(`결과: ${report.ok ? '통과' : '실패'}`)
  return out.join('\n')
}
