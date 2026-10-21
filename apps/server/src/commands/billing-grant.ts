// 운영자 이용권 부여 명령 (N5 AC-N5-12, BL-1 출처 OPERATOR — 보상·기존 판매자·시험):
//   pnpm --filter @livejjim/server billing-grant --login 아이디 --kind FLAT_30D|DAYS|ORDERS|LABELS [--quantity 10] --reason "사유"
// - 정량(DAYS·ORDERS·LABELS)은 --quantity 1~100,000이 필요하고, 정액(FLAT_30D)은 양을 적지 않는다.
// - 사유는 1~200자, 휴대폰 번호를 적으면 거절한다(D-079).
// - 같은 명령을 두 번 실행하면 이용권이 두 장이다(명령마다 새 이용권). 실행 중인 서버의 화면은 요금 화면을 다시 열 때 새로 읽는다.
// - 출력에는 판매자 ID·이용권 ID·종류·양만 쓴다(사유는 쓰지 않는다).
import { grantForLogin } from '../billing/operator.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

loadDotEnv()
const args = parseArgs(process.argv.slice(2), ['login', 'kind', 'quantity', 'reason'])
if (!args.ok) {
  complain(args.message)
  process.exitCode = 2
} else if (!args.values.has('login') || !args.values.has('kind') || !args.values.has('reason')) {
  complain('사용법: billing-grant --login 아이디 --kind FLAT_30D|DAYS|ORDERS|LABELS [--quantity 양] --reason "사유"')
  process.exitCode = 2
} else {
  const rawQuantity = args.values.get('quantity')
  const quantity = rawQuantity === undefined ? undefined : /^\d{1,7}$/.test(rawQuantity) ? Number(rawQuantity) : Number.NaN
  const database = await openDatabaseFromEnv({ migrate: true })
  if (database === null) {
    process.exitCode = 2
  } else {
    try {
      const result = await grantForLogin(database.db, { loginId: args.values.get('login') ?? '', kind: args.values.get('kind'), quantity, reason: args.values.get('reason') }, Date.now())
      if (result.ok) say(`이용권을 줬어요. 판매자 ${result.sellerId} · 이용권 ${result.grantId} · ${result.kind}${result.quantity === null ? '' : ` · ${String(result.quantity)}`}`)
      else {
        complain(`이용권을 주지 못했어요. ${result.message}`)
        process.exitCode = 1
      }
    } finally {
      await database.close()
    }
  }
}
