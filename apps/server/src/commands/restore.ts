// 복구·가져오기 명령 (DAT-04, I2 D-I2-11, AC-I2-62): 운영자가 돌린다 — 판매자 화면에는 없다.
//   pnpm --filter @livejjim/server restore --seller <판매자 ID> --file <백업·내보내기 파일(.json.gz)> [--replace]
// - 먼저 검사한다(형식 이름·번호, 파일 요약값, 이벤트마다 요약값, 범위마다 seq 1부터 빈틈없음, 범위 겹침, 처음부터 재생, 판매 규칙 설정, 포장 기록 형식).
//   하나라도 어긋나면 아무것도 바꾸지 않고 까닭을 출력하고 종료 코드 1.
// - 기록이 없는 판매자에는 가져온다. 기록이 있으면 --replace를 붙였을 때만: 지금 기록을 안전 백업으로 백업 저장소(LIVEJJIM_BACKUP_DIR)에 쓴 뒤 한 트랜잭션에 바꾼다.
// - 다시 만든 발송함은 실행하지 않음 표시. 끝나면 그 판매자에 재생 무결성 검사 — 모두 일치해야 종료 코드 0.
// - 판매자 ID·로그인 계정·세션·전화번호 키는 그대로. 서버가 켜져 있으면 다시 켜야 메모리의 범위 상태를 버린다.
// - 출력에는 기록 내용·개인정보가 없다(판매자 ID·날짜·seq·개수·파일 이름만). 인자 오류·설정 오류는 종료 코드 2.
import { readFile } from 'node:fs/promises'
import { FolderBackupStorage, restoreSeller } from '../backup.ts'
import { formatCheck } from '../check-replay.ts'
import { readBackupDir } from '../config.ts'
import { randomIds } from '../ids.ts'
import { systemClock } from '../time.ts'
import { parseRestoreArgs } from './restore-args.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, say } from './shared.ts'

loadDotEnv()
const args = parseRestoreArgs(process.argv.slice(2))
if (!args.ok) {
  complain(args.message)
  process.exit(2)
}
let bytes: Uint8Array
try {
  bytes = new Uint8Array(await readFile(args.file))
} catch {
  complain('백업 파일을 읽지 못했어요. 경로를 확인해 주세요.')
  process.exit(2)
}
const database = await openDatabaseFromEnv({ migrate: true })
if (database === null) process.exit(2)
const backupDir = readBackupDir(process.env)
try {
  const outcome = await restoreSeller({
    db: database.db,
    sellerId: args.seller,
    bytes,
    replace: args.replace,
    storage: backupDir === null ? null : new FolderBackupStorage(backupDir),
    clock: systemClock,
    ids: randomIds,
  })
  if (!outcome.ok) {
    complain(`가져오지 않았어요. ${outcome.reason}`)
    process.exitCode = 1
  } else {
    if (outcome.safety !== null) say(`지금 기록을 안전 백업으로 남겼어요: ${outcome.safety}`)
    say(`가져왔어요. 범위 ${String(outcome.scopes)}개 · 이벤트 ${String(outcome.events)}개 · 포장 기록 ${String(outcome.packing)}개 (다시 만든 발송함은 실행하지 않아요)`)
    for (const check of outcome.checks) say(formatCheck(check))
    const bad = outcome.checks.filter((check) => !check.ok).length
    say(bad === 0 ? `재생 검사: 범위 ${String(outcome.checks.length)}개 모두 일치해요.` : `재생 검사: 범위 ${String(outcome.checks.length)}개 중 ${String(bad)}개가 달라요.`)
    say('서버가 켜져 있으면 다시 켜 주세요(메모리에 둔 지난 상태를 버려요).')
    process.exitCode = bad === 0 ? 0 : 1
  }
} catch {
  complain('가져오지 못했어요. 데이터베이스를 확인해 주세요.')
  process.exitCode = 1
} finally {
  await database.close()
}
