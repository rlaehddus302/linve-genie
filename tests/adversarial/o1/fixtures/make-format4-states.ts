// BASE 코어(형식 4)로 strict-engine-base.json의 앞 로그 몇 개를 반쯤 재생해 저장한 상태 기록을 만든다 (AC-O1-30 적대 — upgradeState 이어 쓰기).
// 쓰는 법: node tests/adversarial/o1/fixtures/make-format4-states.ts <BASE packages/core/src> > tests/adversarial/o1/fixtures/format4-states.json
import { readFileSync } from 'node:fs'
const src = process.argv[2]
if (src === undefined) throw new Error('BASE packages/core/src 경로를 주세요')
const core = (await import(`${src}/index.ts`)) as Record<string, (...args: unknown[]) => unknown>
const { broadcast, runs } = JSON.parse(readFileSync(new URL('./strict-engine-base.json', import.meta.url), 'utf8')) as { broadcast: unknown; runs: { settings: unknown; log: unknown[] }[] }
const out = runs.slice(0, 6).map((run, run_) => {
  const cut = Math.floor(run.log.length / 2)
  let state = (core.initEngine as (x: unknown) => unknown)({ broadcasts: [broadcast], settings: run.settings })
  for (const event of run.log.slice(0, cut)) state = ((core.applyEvent as (s: unknown, e: unknown) => { state: unknown })(state, event)).state
  return { run: run_, cut, state }
})
process.stdout.write(`${JSON.stringify({ base: 'harness/sprints/O1/BASE', saved: out })}\n`)
