// pnpm verify — 전체 검사 한 번 (AC-S00-10, AC-S00-11).
// typecheck → lint → test → golden → adversarial → coverage 순서로 모두 돌리고 끝에 요약표를 보여 준다.
// 한 단계가 실패해도 뒤 단계는 계속 돌린다(전체 상황을 한 번에 보이기 위해). 모든 단계가 통과할 때만 종료 코드 0.
// CI용 단일 명령: pnpm install --frozen-lockfile && pnpm verify
import { STAGES, TZ_STAGES, runStage, statusLabel } from './stages.mjs'
import { TEST_TIME_ZONE } from './time-zone.mjs'

if (process.argv.length > 2) {
  process.stderr.write('pnpm verify는 옵션을 받지 않는다\n')
  process.exit(2)
}

const results = []
for (const [i, name] of STAGES.entries()) {
  process.stdout.write(`\n━━━━ [${i + 1}/${STAGES.length}] ${name} ━━━━\n`)
  results.push(await runStage(name))
}

const width = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)))
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`

const lines = []
lines.push('')
lines.push('════════════════ pnpm verify 요약 ════════════════')
lines.push(` ${pad('단계', 12)} ${pad('결과', 6)} ${pad('시간', 7)} 내용`)
for (const r of results) {
  lines.push(` ${pad(r.name, 12)} ${pad(statusLabel(r.status), 6)} ${pad(seconds(r.durationMs), 7)} ${r.detail}`)
}
const count = (status) => results.filter((r) => r.status === status).length
const ok = count('pass') === results.length
lines.push(` 시간대: TZ=${TEST_TIME_ZONE} (D-026 · ${STAGES.filter((s) => TZ_STAGES.has(s)).join('·')} 단계)`)
lines.push(` 결과: ${ok ? '통과' : '실패'} (통과 ${count('pass')} · 실패 ${count('fail')} · 건너뜀 ${count('skip')})`)
process.stdout.write(`${lines.join('\n')}\n`)
process.exitCode = ok ? 0 : 1
