// 운영자 요금 목록 명령 (N5 AC-N5-12, BL-6 4·BL-8 5): pnpm --filter @livejjim/server billing-list
// - 확인 필요(NEEDS_REVIEW) 결제, 1시간 넘게 결제 대기(PENDING)인 주문, 발행 대기·발행 실패·취소 요청 증빙을 판매자·결제 ID·금액·시각과 함께 보인다.
// - 증빙 목록에는 손으로 발행하는 데 필요한 사업자 정보(복호화한 번호·상호·대표자·이메일·종류·공급가액·세액)를 보인다 — 표준 출력에만, 서버 로그에는 쓰지 않는다.
// - 서버 마스터 키(LIVEJJIM_MASTER_KEY)가 필요하다. DB를 바꾸지 않는다.
import { operatorLists, formatOperatorLists } from '../billing/operator.ts'
import { readMasterKey } from '../secrets.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

loadDotEnv()
const args = parseArgs(process.argv.slice(2), [])
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
if (!args.ok) {
  complain(args.message)
  process.exitCode = 2
} else if (!masterKey.ok) {
  complain(`목록을 보이지 못했어요. ${masterKey.message}`)
  process.exitCode = 2
} else {
  const database = await openDatabaseFromEnv({ migrate: false })
  if (database === null) {
    process.exitCode = 2
  } else {
    try {
      for (const line of formatOperatorLists(await operatorLists(database.db, masterKey.key, Date.now()))) say(line)
    } catch {
      complain('목록을 보이지 못했어요. 데이터베이스를 확인해 주세요.')
      process.exitCode = 2
    } finally {
      await database.close()
    }
  }
}
