// 마이그레이션 적용 명령 (AC-S04-20): pnpm --filter @livejjim/server migrate
// 서버 시작(main.ts)도 같은 마이그레이션을 적용한다. DB 연결 설정은 서버와 같다(DATABASE_URL 또는 LIVEJJIM_PGLITE_DIR).
import { loadDotEnv, openDatabaseFromEnv, say } from './shared.ts'

loadDotEnv()
const database = await openDatabaseFromEnv({ migrate: true })
if (database === null) {
  process.exitCode = 1
} else {
  await database.close()
  say('마이그레이션을 적용했어요.')
}
