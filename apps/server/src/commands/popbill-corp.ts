// 팝빌 사업자번호를 판매자에게 묶는 운영자 명령 (RA-N3-001, DP-1 "비밀값", SYS-02).
//   pnpm --filter @livejjim/server popbill-corp --login 아이디 --corp 사업자번호   (묶기)
//   pnpm --filter @livejjim/server popbill-corp --login 아이디 --clear yes          (풀기)
// 서버는 팝빌 연동 키 하나로 모든 판매자를 대신해 팝빌을 부른다. 운영에서는 서버가 저절로 묶지 않는다(TD-N3-004) — 운영자가 팝빌 연동회원을 등록하고
// 그 판매자가 사업자번호의 주인인지 확인한 뒤 이 명령으로 묶어야 그 판매자가 계좌조회 원천·계좌 관리 주소를 쓸 수 있다(시험 모드만 저절로 묶는다).
// 잘못 묶인 번호는 이 명령으로만 푼다.
// 사업자번호는 DB에 되돌릴 수 없는 키(HMAC)로만 두고, 출력에 사업자번호·키를 쓰지 않는다.
import { normalizeLoginId } from '../accounts.ts'
import { corpKeyOf } from '../deposit/account-seal.ts'
import { bindCorpKey, corpKeyOfSeller, sellerOfCorpKey, unbindCorp } from '../deposit/store.ts'
import { readMasterKey } from '../secrets.ts'
import { findAccountByLogin } from '../store.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

const USAGE = '사용법: popbill-corp --login 아이디 --corp 사업자번호  (풀기: popbill-corp --login 아이디 --clear yes)'

loadDotEnv()
const args = parseArgs(process.argv.slice(2), ['login', 'corp', 'clear'])
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
const corpNum = args.ok ? (args.values.get('corp') ?? '').replace(/[\s-]/g, '') : ''
const clear = args.ok && args.values.get('clear') === 'yes'
if (!args.ok) {
  complain(args.message)
  process.exitCode = 1
} else if (!args.values.has('login') || args.values.has('corp') === clear || (args.values.has('clear') && !clear)) {
  complain(USAGE)
  process.exitCode = 1
} else if (!clear && !/^\d{10}$/.test(corpNum)) {
  complain('사업자번호는 숫자 10자리로 적어 주세요.')
  process.exitCode = 1
} else if (!masterKey.ok) {
  complain(`사업자번호를 묶지 못했어요. ${masterKey.message}`)
  process.exitCode = 1
} else {
  const database = await openDatabaseFromEnv({ migrate: true })
  if (database === null) {
    process.exitCode = 1
  } else {
    try {
      const account = await findAccountByLogin(database.db, normalizeLoginId(args.values.get('login') ?? ''))
      if (account === null) {
        complain('그 아이디의 계정이 없어요.')
        process.exitCode = 1
      } else if (clear) {
        say((await unbindCorp(database.db, account.sellerId)) ? '사업자번호 묶음을 풀었어요.' : '이 계정에 묶인 사업자번호가 없어요.')
      } else {
        const key = corpKeyOf(masterKey.key, corpNum)
        const mine = await corpKeyOfSeller(database.db, account.sellerId)
        const owner = await sellerOfCorpKey(database.db, key)
        if (mine === key) say('이미 이 계정에 묶인 사업자번호예요.')
        else if (mine !== null) {
          complain('이 계정은 다른 사업자번호에 묶여 있어요. 먼저 --clear yes로 풀어 주세요.')
          process.exitCode = 1
        } else if (owner !== null) {
          complain('이 사업자번호는 다른 계정에 묶여 있어요. 그 계정에서 먼저 풀어 주세요.')
          process.exitCode = 1
        } else if (await bindCorpKey(database.db, account.sellerId, key, new Date())) say('사업자번호를 묶었어요.')
        else {
          complain('사업자번호를 묶지 못했어요. 다시 해 주세요.')
          process.exitCode = 1
        }
      }
    } finally {
      await database.close()
    }
  }
}
