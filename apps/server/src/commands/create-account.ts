// 판매자 계정 만들기 명령 (AC-S04-40, D-074). 가입 API·화면은 없다 — 운영자가 이 명령으로 만든다.
//   pnpm --filter @livejjim/server create-account --name "가게 이름" --login 아이디 [--bizno 123-45-67890]
// --bizno(선택, N5 AC-N5-12): 사업자등록번호. 검증 숫자까지 맞아야 계정을 만든다(틀리면 "사업자등록번호를 다시 확인해 주세요."). 번호는 암호화해 저장하고 출력하지 않는다.
// --seller sel_…(D-IDLOGIN-02): 새 가게를 만들지 않고 그 가게에 아이디·비밀번호 로그인을 하나 더 붙인다 (--name 없이). 여러 사람이 한 가게로 들어간다.
// 비밀번호는 명령행 인자로 받지 않는다: 표준 입력의 첫 줄로 받는다(터미널이면 화면에 보이지 않게 묻는다).
// 판매자 전화번호 키도 이때 만들어 서버 마스터 키(LIVEJJIM_MASTER_KEY)로 암호화해 저장한다(AC-S04-32).
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { addLoginToSeller, createSellerAccount } from '../accounts.ts'
import { readMasterKey } from '../secrets.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

/** 비밀번호 한 줄 읽기 (터미널이면 입력 글자를 화면에 쓰지 않는다) */
function readPassword(): Promise<string> {
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() })
  if (process.stdin.isTTY) process.stdout.write('비밀번호: ')
  const rl = createInterface({ input: process.stdin, output: muted, terminal: process.stdin.isTTY === true })
  return new Promise((resolve) => {
    let answered = false
    rl.once('line', (line) => {
      answered = true
      rl.close()
      if (process.stdin.isTTY) process.stdout.write('\n')
      resolve(line)
    })
    rl.once('close', () => {
      if (!answered) resolve('')
    })
  })
}

loadDotEnv()
const args = parseArgs(process.argv.slice(2), ['name', 'login', 'bizno', 'seller'])
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
if (!args.ok) {
  complain(args.message)
  process.exitCode = 1
} else if ((!args.values.has('name') && !args.values.has('seller')) || !args.values.has('login')) {
  complain('사용법: create-account --name "가게 이름" --login 아이디 [--bizno 사업자등록번호]  또는  create-account --seller 가게ID --login 아이디  (비밀번호는 표준 입력으로)')
  process.exitCode = 1
} else if (!masterKey.ok) {
  complain(`계정을 만들지 못했어요. ${masterKey.message}`)
  process.exitCode = 1
} else {
  const password = await readPassword()
  const database = await openDatabaseFromEnv({ migrate: true })
  if (database === null) {
    process.exitCode = 1
  } else {
    try {
      const result = args.values.has('seller')
        ? await addLoginToSeller(database.db, { sellerId: args.values.get('seller') ?? '', loginId: args.values.get('login') ?? '', password })
        : await createSellerAccount(database.db, masterKey.key, {
            shopName: args.values.get('name') ?? '',
            loginId: args.values.get('login') ?? '',
            password,
            ...(args.values.has('bizno') ? { businessNumber: args.values.get('bizno') ?? '' } : {}),
          })
      if (result.ok) say('계정을 만들었어요.')
      else {
        complain(`계정을 만들지 못했어요. ${result.message}`)
        process.exitCode = 1
      }
    } finally {
      await database.close()
    }
  }
}
