// 재생 무결성 검사 명령 (AC-S04-29): pnpm --filter @livejjim/server check-replay [--seller 판매자ID] [--date YYYY-MM-DD]
// 범위마다 결과 한 줄. 모두 같으면 종료 코드 0, 하나라도 다르면 1(설정 오류는 2). DB를 바꾸지 않는다(마이그레이션도 하지 않는다).
// 출력에는 이벤트 내용·개인정보가 없다(판매자 ID·날짜·seq·부분 이름·개수만).
import { isValidDate } from '@livejjim/core'
import { checkReplay, formatCheck } from '../check-replay.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

loadDotEnv()
const args = parseArgs(process.argv.slice(2), ['seller', 'date'])
const date = args.ok ? args.values.get('date') : undefined
if (!args.ok) {
  complain(args.message)
  process.exitCode = 2
} else if (date !== undefined && !isValidDate(date)) {
  complain("--date는 '2026-10-18'처럼 적어 주세요.")
  process.exitCode = 2
} else {
  const database = await openDatabaseFromEnv({ migrate: false })
  if (database === null) {
    process.exitCode = 2
  } else {
    try {
      const seller = args.values.get('seller')
      const results = await checkReplay(database.db, { ...(seller === undefined ? {} : { sellerId: seller }), ...(date === undefined ? {} : { date }) })
      for (const result of results) say(formatCheck(result))
      const bad = results.filter((result) => !result.ok).length
      say(bad === 0 ? `범위 ${String(results.length)}개 모두 일치해요.` : `범위 ${String(results.length)}개 중 ${String(bad)}개가 달라요.`)
      process.exitCode = bad === 0 ? 0 : 1
    } catch {
      complain('검사하지 못했어요. 데이터베이스를 확인해 주세요.')
      process.exitCode = 2
    } finally {
      await database.close()
    }
  }
}
