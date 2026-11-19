// 한 가게의 하루 라이브 기록을 다른 가게로 복사하는 운영자 명령 (D-IDLOGIN-03).
//   node src/commands/copy-scope.ts --from-seller sel_… --to-seller sel_… --date 2026-11-12 [--apply yes]
// --apply yes가 없으면 미리보기만(무엇을 옮길지 보여 주고 아무것도 쓰지 않는다).
// 받는 가게에 그 날짜 기록이 있으면 하지 않는다. 원래 가게 기록은 그대로 둔다. 넣은 뒤 재생 검사가 어긋나면 되돌린다.
import { copyScope } from '../copy-scope.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

loadDotEnv()
const args = parseArgs(process.argv.slice(2), ['from-seller', 'to-seller', 'date', 'apply'])
if (!args.ok) {
  complain(args.message)
  process.exitCode = 1
} else if (!args.values.has('from-seller') || !args.values.has('to-seller') || !/^\d{4}-\d{2}-\d{2}$/.test(args.values.get('date') ?? '')) {
  complain('사용법: copy-scope --from-seller 가게ID --to-seller 가게ID --date YYYY-MM-DD [--apply yes]')
  process.exitCode = 1
} else {
  const database = await openDatabaseFromEnv({ migrate: false })
  if (database === null) {
    process.exitCode = 1
  } else {
    try {
      const apply = args.values.get('apply') === 'yes'
      const result = await copyScope(database.db, { fromSellerId: args.values.get('from-seller') ?? '', toSellerId: args.values.get('to-seller') ?? '', date: args.values.get('date') ?? '' }, { apply })
      if (!result.ok) {
        complain(`옮기지 않았어요. ${result.message}${result.check === undefined ? '' : ` ${JSON.stringify(result.check)}`}`)
        process.exitCode = 1
      } else {
        say(`${result.dryRun ? '미리보기' : '옮겼어요'}: 이벤트 ${result.events}개, 방송 ${result.broadcasts.map((b) => `${b.title}(${b.from} → ${b.to})`).join(', ')}`)
        if (result.check !== null) say(`재생 검사: ${result.check.ok ? '맞아요' : `어긋나요 ${JSON.stringify(result.check)}`}`)
      }
    } finally {
      await database.close()
    }
  }
}
