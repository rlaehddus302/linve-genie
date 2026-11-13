// 연습 방송 한 바퀴 명령 (D-RETRO-37, 복기 E3): 교체 스크립트(deploy/ec2/switch.sh)가 대기 자리 컨테이너 안에서 돌린다.
//   docker exec <대기 자리 컨테이너> node apps/server/src/commands/slot-smoke.ts
// 같은 컨테이너에서 도는 서버(http://127.0.0.1:<PORT>)에 점검용 가게의 리허설 방송 한 바퀴를 보낸다 — 무엇에 닿고 닿지 않는지는 slot-smoke.ts 머리말.
// 마이그레이션은 적용하지 않는다(서버가 뜰 때 이미 했다). 성공하면 종료 코드 0, 실패하면 1과 실패한 걸음. 비밀값·세션 값은 찍지 않는다.
import { readAppOrigin, readPort } from '../config.ts'
import { readMasterKey } from '../secrets.ts'
import { localFetch, runSlotSmoke } from '../slot-smoke.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, say } from './shared.ts'

loadDotEnv()
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
const origin = readAppOrigin(process.env)
const port = readPort(process.env)
if (!masterKey.ok) {
  complain(`연습 방송 확인을 하지 못했어요. ${masterKey.message}`)
  process.exitCode = 1
} else if (!origin.ok) {
  complain(`연습 방송 확인을 하지 못했어요. ${origin.message}`)
  process.exitCode = 1
} else if (!port.ok) {
  complain(`연습 방송 확인을 하지 못했어요. ${port.message}`)
  process.exitCode = 1
} else {
  const database = await openDatabaseFromEnv({ migrate: false })
  if (database === null) {
    process.exitCode = 1
  } else {
    try {
      const result = await runSlotSmoke({ db: database.db, masterKey: masterKey.key, origin: origin.origin, fetch: localFetch(`http://127.0.0.1:${String(port.port)}`) })
      if (result.ok) say(`연습 방송 한 바퀴 통과: ${result.steps.join(' → ')}`)
      else {
        complain(`연습 방송 한 바퀴 실패 — ${result.step}: ${result.message} (지나온 걸음: ${result.steps.join(' → ') || '없음'})`)
        process.exitCode = 1
      }
    } finally {
      await database.close()
    }
  }
}
