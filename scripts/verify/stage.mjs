// 단계 하나만 돌린다: pnpm typecheck | lint | test | golden | adversarial | coverage
// verify와 같은 정의(stages.mjs)를 쓴다. 단계 내용을 바꾸는 옵션은 받지 않는다.
import { STAGES, TZ_STAGES, runStage, statusLabel } from './stages.mjs'
import { TEST_TIME_ZONE } from './time-zone.mjs'

const [name, ...rest] = process.argv.slice(2)
if (!STAGES.includes(name) || rest.length > 0) {
  process.stderr.write(`사용법: node scripts/verify/stage.mjs <${STAGES.join('|')}> (옵션 없음)\n`)
  process.exit(2)
}

const result = await runStage(name)
const tz = TZ_STAGES.has(name) ? ` · TZ=${TEST_TIME_ZONE}` : ''
process.stdout.write(`\n[${name}] ${statusLabel(result.status)} — ${result.detail}${tz}\n`)
process.exitCode = result.status === 'pass' ? 0 : 1
