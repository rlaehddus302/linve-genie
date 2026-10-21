// 서버 기동 (AC-S00-42, AC-S04-20·32): pnpm --filter @livejjim/server start
// - PORT(기본 3000)에서 대기한다. 저장소 루트의 .env가 있으면 읽는다(이미 있는 환경변수가 우선).
// - DB 연결 설정(DATABASE_URL 또는 개발용 LIVEJJIM_PGLITE_DIR)·서버 마스터 키(LIVEJJIM_MASTER_KEY)·화면 앱 주소(LIVEJJIM_APP_ORIGIN)가
//   없거나 틀리면 쉬운 문장으로 알리고 시작하지 않는다(값은 출력하지 않는다). 메모리 DB로 조용히 바꾸지 않는다.
// - 시작할 때 마이그레이션을 적용한다.
// - 유튜브 연동(LIVEJJIM_GOOGLE_*)은 선택이다. 적었으면 주소는 https만 받는다(아니면 시작하지 않는다, AC-Y1-72). 워커(수집기·발송함·봉인)를 함께 돌린다.
// - 배포·운영 (I3, AC-I3-72): 앱 주소는 https만(내 컴퓨터 시험은 http://localhost), 운영 토큰(LIVEJJIM_OPS_TOKEN)은 32자 이상, 믿는 프록시 수
//   (LIVEJJIM_TRUSTED_PROXIES)는 0~5, 화면 폴더(LIVEJJIM_WEB_DIR)에는 index.html — 아니면 시작하지 않는다. 화면 폴더가 있으면 같은 출처로 함께 낸다.
// - 기동 로그에 환경변수 값을 찍지 않는다.
// - Ctrl+C(SIGINT)·SIGTERM이면 새 연결을 받지 않고 진행 중인 요청을 마친 뒤 종료 코드 0으로 끝난다.
//   한 번 더 누르면 바로 끝낸다.
import { existsSync } from 'node:fs'
import { FolderBackupStorage } from './backup.ts'
import { DEFAULT_PORT, readAppOrigin, readBackupDir, readDatabaseSetting, readDeploySetting, readPort, readYoutubeSetting } from './config.ts'
import { createNodeServer } from './node-server.ts'
import { openDatabaseFromEnv } from './commands/shared.ts'
import { productionServerOptions } from './production.ts'
import { readMasterKey } from './secrets.ts'
import { createServer } from './server.ts'
import { webDirProblem } from './web.ts'

/** 종료를 요청한 뒤 남은 연결을 강제로 끊기까지 기다리는 시간 */
const FORCE_CLOSE_AFTER_MS = 5000

const say = (line: string) => process.stdout.write(`[server] ${line}\n`)
const complain = (line: string) => process.stderr.write(`[server] ${line}\n`)

// 저장소 루트의 .env (커밋하지 않는다. 키 목록은 .env.example)
const ENV_FILE = new URL('../../../.env', import.meta.url)
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

const setting = readPort(process.env)
if (!setting.ok) {
  complain(`시작하지 못했어요. ${setting.message}`)
  process.exit(1)
}
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
if (!masterKey.ok) {
  complain(`시작하지 못했어요. ${masterKey.message}`)
  process.exit(1)
}
const origin = readAppOrigin(process.env)
if (!origin.ok) {
  complain(`시작하지 못했어요. ${origin.message}`)
  process.exit(1)
}
const deploy = readDeploySetting(process.env, origin.origin, webDirProblem)
if (!deploy.ok) {
  complain(`시작하지 못했어요. ${deploy.message}`)
  process.exit(1)
}
const youtubeSetting = readYoutubeSetting(process.env, origin.origin)
if (!youtubeSetting.ok) {
  complain(`시작하지 못했어요. ${youtubeSetting.message}`)
  process.exit(1)
}
const databaseSetting = readDatabaseSetting(process.env)
if (!databaseSetting.ok) {
  complain(`시작하지 못했어요. ${databaseSetting.message}`)
  process.exit(1)
}
const database = await openDatabaseFromEnv({ migrate: true })
if (database === null) {
  complain('시작하지 못했어요.')
  process.exit(1)
}

// 운영 옵션은 productionServerOptions로만 만든다 — 시험 모드 신호(시험용 프린터)는 늘 꺼져 있다 (AC-I1-16).
// 그 위에 배포·운영 설정(I3, AC-I3-72)과 유튜브 연동(Y1)을 더한다 — 둘 다 위에서 이미 확인했다
const assembled = productionServerOptions(process.env, database)
if (!assembled.ok) {
  complain(`시작하지 못했어요. ${assembled.message}`)
  await database.close()
  process.exit(1)
}
// 백업 저장소 (I2 D-I2-10): LIVEJJIM_BACKUP_DIR 폴더(판매자마다 하위 폴더 — 운영 백업 명령의 덤프와 같은 폴더). 없으면 자동 백업이 꺼진다는 경보만 남기고 판매는 그대로 한다
const backupDir = readBackupDir(process.env)
const livejjim = createServer({
  ...assembled.options,
  trustedProxies: deploy.trustedProxies,
  ...(deploy.opsToken === null ? {} : { opsToken: deploy.opsToken }),
  ...(deploy.webDir === null ? {} : { webDir: deploy.webDir }),
  ...(youtubeSetting.youtube === null ? {} : { youtube: youtubeSetting.youtube }),
  backupStorage: backupDir === null ? null : new FolderBackupStorage(backupDir),
})
// 워커: 유튜브 수집기·발송함(설정이 있을 때), 30일 봉인 작업 — 끝나지 않은 회차의 수집기가 저절로 다시 돈다 (NFR-03)
livejjim.start()
// 매일 판매자 자동 백업 (I2 D-I2-10)
livejjim.backups.start()
// 확인서 미리 보기 워커를 미리 띄운다 (첫 미리 보기가 워커를 띄우는 시간을 기다리지 않게 — RA-I2-003)
livejjim.work.receipts.warm()
const server = createNodeServer({ app: livejjim.app })

// PORT 환경변수 값은 로그에 찍지 않는다. 기본값일 때만 번호를 보여 준다.
const where = setting.fromEnv ? 'PORT 환경변수로 지정한 포트' : `기본 포트 ${DEFAULT_PORT}`

server.on('error', (error: Error & { code?: string }) => {
  // Node 오류 메시지에는 포트 번호가 들어 있으므로 코드만 보고 우리 문장으로 알린다
  if (error.code === 'EADDRINUSE') complain(`시작하지 못했어요. 다른 프로그램이 이미 쓰고 있는 포트예요(${where}). PORT 환경변수로 다른 포트를 지정해 주세요.`)
  else if (error.code === 'EACCES') complain(`시작하지 못했어요. 열 권한이 없는 포트예요(${where}).`)
  else complain(`시작하지 못했어요. (오류 코드: ${error.code ?? '알 수 없음'})`)
  // DB(특히 PGlite)가 열려 있으면 프로세스가 끝나지 않으므로 닫고 끝낸다
  livejjim.close()
  void finish(1)
})

/** DB를 닫고 종료 코드로 끝낸다 */
async function finish(code: number): Promise<never> {
  try {
    await database?.close()
  } catch {
    // 닫다 실패해도 끝낸다
  }
  process.exit(code)
}

server.listen(setting.port, () => {
  say(`시작했어요. ${where}에서 기다리는 중이에요. 상태 확인: GET /health · 끄려면 Ctrl+C`)
})

let stopping = false
function stop(): void {
  if (stopping) {
    complain('바로 끝낼게요.')
    process.exit(1)
  }
  stopping = true
  say('끄는 중이에요. 진행 중인 요청을 마무리하고 있어요.')
  livejjim.close()
  server.close((error) => {
    if (error) {
      complain('서버가 이미 멈춰 있었어요.')
      void finish(1)
      return
    }
    say('껐어요.')
    void finish(0)
  })
  server.closeIdleConnections()
  setTimeout(() => server.closeAllConnections(), FORCE_CLOSE_AFTER_MS).unref()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
