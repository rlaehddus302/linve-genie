// time.test.ts가 다른 TZ의 자식 프로세스로 실행한다. AC-S00-26 표의 값을 찍는다.
import { formatUtcIso, resolveAt } from '../time.ts'

const lines = [`tz=${process.env.TZ ?? ''}`]
for (const at of ['20:00:00', '20:00:02.1', '2026-10-19T00:00:10+09:00']) {
  const result = resolveAt(at, '2026-10-18')
  lines.push(result.ok ? formatUtcIso(result.utcMs) : `오류: ${result.reason}`)
}
process.stdout.write(`${lines.join('\n')}\n`)
