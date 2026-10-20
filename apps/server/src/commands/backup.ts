// 운영 백업 명령 (DAT-03, D-I3-14, AC-I3-75): pnpm --filter @livejjim/server backup
// DATABASE_URL(PostgreSQL)을 LIVEJJIM_PG_DUMP(기본 pg_dump)로 LIVEJJIM_BACKUP_DIR에 livejjim-YYYYMMDD-HHmmss.dump(UTC)로 백업하고,
// 성공하면 30일 넘은 백업(이름 모양이 맞는 것만, 가장 최근 것은 남긴다)을 지운다. 실패하면 아무것도 지우지 않고 종료 코드 1·경보 BACKUP_FAILED(JSON 한 줄).
// 연결 문자열·비밀번호는 출력하지 않는다. 일정은 운영자가 정한다(예: 매일 04:00 KST — docs/DEPLOY.md "백업·복구").
import { runBackup } from '../backup.ts'
import { stderrLog } from '../log.ts'
import { complain, loadDotEnv, say } from './shared.ts'

loadDotEnv()
const result = await runBackup({
  env: process.env,
  now: () => Date.now(),
  onFailure: () => stderrLog({ level: 'alert', code: 'BACKUP_FAILED' }),
})
if (result.ok) {
  say(`백업했어요: ${result.file}${result.removed.length === 0 ? '' : ` · 30일 넘은 백업 ${String(result.removed.length)}개를 지웠어요`}`)
} else {
  complain(result.message)
  process.exitCode = 1
}
