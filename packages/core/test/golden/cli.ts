// `pnpm golden` — 골든 단계 (AC-S00-20~28).
// 항상 저장소의 tests/golden 과 tests/golden/known-unimplemented.yaml 만 쓴다.
// 이 경로나 허용 범위를 바꾸는 환경변수·명령행 옵션은 없다(D-020). 인자를 주면 거부한다.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGoldenDir } from './fs-runner.ts'
import { formatReport } from './report.ts'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const GOLDEN_DIR = join(REPO_ROOT, 'tests', 'golden')

if (process.argv.length > 2) {
  process.stderr.write(`골든 러너는 옵션을 받지 않는다 (받은 인자: ${process.argv.slice(2).join(' ')})\n`)
  process.exit(2)
}

const started = performance.now()
const report = runGoldenDir({ goldenDir: GOLDEN_DIR, allowlistPath: join(GOLDEN_DIR, 'known-unimplemented.yaml'), displayRoot: REPO_ROOT })
process.stdout.write(`${formatReport(report)}\n`)
process.stdout.write(`소요 시간: ${Math.round(performance.now() - started)}ms\n`)
process.exitCode = report.ok ? 0 : 1
