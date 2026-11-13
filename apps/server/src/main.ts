// 서버 기동 (AC-S00-42, AC-S04-20·32): pnpm --filter @livejjim/server start
// - PORT(기본 3000)에서 대기한다. 저장소 루트의 .env가 있으면 읽는다(이미 있는 환경변수가 우선).
// - DB 연결 설정(DATABASE_URL 또는 개발용 LIVEJJIM_PGLITE_DIR)·서버 마스터 키(LIVEJJIM_MASTER_KEY)·화면 앱 주소(LIVEJJIM_APP_ORIGIN)가
//   없거나 틀리면 쉬운 문장으로 알리고 시작하지 않는다(값은 출력하지 않는다). 메모리 DB로 조용히 바꾸지 않는다.
// - 시작할 때 마이그레이션을 적용한다.
// - 유튜브 채팅 읽기(YT-11)는 늘 켜 둔다(LIVEJJIM_YT_WEB_CHAT=off일 때만 끔). 구글 연결(LIVEJJIM_GOOGLE_*)은 선택이다 — 적었으면 주소는 https만 받는다
//   (아니면 시작하지 않는다, AC-Y1-72). 워커(수집기·발송함·봉인)를 함께 돌린다.
// - 배포·운영 (I3, AC-I3-72): 앱 주소는 https만(내 컴퓨터 시험은 http://localhost), 운영 토큰(LIVEJJIM_OPS_TOKEN)은 32자 이상, 믿는 프록시 수
//   (LIVEJJIM_TRUSTED_PROXIES)는 0~5, 화면 폴더(LIVEJJIM_WEB_DIR)에는 index.html — 아니면 시작하지 않는다. 화면 폴더가 있으면 같은 출처로 함께 낸다.
// - 기동 로그에 환경변수 값을 찍지 않는다.
// - Ctrl+C(SIGINT)·SIGTERM이면 새 연결을 받지 않고 진행 중인 요청을 마친 뒤 종료 코드 0으로 끝난다.
//   한 번 더 누르면 바로 끝낸다.
// - 두 자리 교대 (D-RETRO-35~37, slot.ts — 자리 이름 LIVEJJIM_SLOT을 적었을 때만):
//   · 자리 표시 파일이 다른 자리를 가리키면 **대기**로 뜬다: 요청은 받지만 뒤 작업(워커·주기 작업·자동 백업)을 시작하지 않는다.
//   · SIGUSR2를 받으면 운영으로 올린다(뒤 작업 시작). 바깥에서 부를 수 있는 HTTP 입구는 두지 않는다.
//   · SIGHUP을 받으면 뒤 작업만 멈추고 임대를 내려놓는다(넘기는 중 — 요청은 그대로 받는다). 새 자리를 올리기 전에 보내 뒤 작업이 두 곳에서 같이 돌지 않게 한다.
//   · SIGTERM을 받으면 내린다: (아직이면) 뒤 작업을 멈추고 임대를 내려놓음 → 앞단이 알아챌 때까지 잠깐 더 받음(/health/active는 바로 503) →
//     실시간 연결을 닫음 → 새 연결을 받지 않고 진행 중 요청을 마치고 끝.
import { readMediaProxy, readStreamAudioSwitch, readYtDlpPath } from './voice/stream-audio.ts'
import { existsSync } from 'node:fs'
import { FolderBackupStorage } from './backup.ts'
import { DEFAULT_PORT, readAppOrigin, readBackupDir, readDatabaseSetting, readDeploySetting, readPort, readTiktokChatSend, readYoutubeChatSend, readYoutubeSetting, readYoutubeWebChat } from './config.ts'
import { createChatSendRoute } from './youtube/chat-send/create.ts'
import { BrowserTikTokSender } from './tiktok-live/thanks/browser-sender.ts'
import { realTimer } from './youtube/timer.ts'
import { access } from 'node:fs/promises'
import { createNodeServer } from './node-server.ts'
import { openDatabaseFromEnv } from './commands/shared.ts'
import { productionServerOptions } from './production.ts'
import { readMasterKey } from './secrets.ts'
import { createServer } from './server.ts'
import { webDirProblem } from './web.ts'
import { SERVICE_NAME } from './brand.ts'
import { readSlotSetting, SlotState } from './slot.ts'

/** 종료를 요청한 뒤 남은 연결을 강제로 끊기까지 기다리는 시간 */
const FORCE_CLOSE_AFTER_MS = 5000
/**
 * 두 자리 교대에서 내릴 때: "내리는 중"이 된 뒤에도 이만큼은 요청을 계속 받는다.
 * 앞단(Caddy)은 1초마다 /health/active를 물어 한 번 실패로 이 자리를 뺀다(deploy/ec2/Caddyfile). 그 전에 연결을 닫으면 그 사이에 온 요청이 실패한다.
 */
const DRAIN_GRACE_MS = 4000
/**
 * 내리는 중이 된 뒤 실시간 연결(SSE)·음성 웹소켓을 닫는 때. 앞단이 이 자리를 뺀 다음(1초 + 여유)이라 다시 붙는 연결은 새 자리로 간다.
 * 끝까지 열어 두면 그 화면은 새 자리에서 일어난 기록을 알림으로 받지 못한다(알림은 프로세스 안에서만 퍼진다, hub.ts)
 */
const DRAIN_REALTIME_CLOSE_MS = 2000
/** 두 자리 교대에서 내릴 때 진행 중 요청(파일 만들기 등)을 기다리는 시간 — 새 요청은 이미 다른 자리로 간다 */
const DRAIN_FORCE_CLOSE_AFTER_MS = 20_000

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
// 감사 채팅 다른 길 (D-YT-SEND-08): 기본은 공식 Data API만. 다른 길을 적었으면 판매자·작성자 채널·로그인 파일이 모두 있어야 한다
const chatSendSetting = readYoutubeChatSend(process.env)
if (!chatSendSetting.ok) {
  complain(`시작하지 못했어요. ${chatSendSetting.message}`)
  process.exit(1)
}
let chatSend: Awaited<ReturnType<typeof createChatSendRoute>> | null = null
// 공식 API 봇 (D-YT-SEND-20·21): 비공식 길 없이 봇 계정의 구글 연결(운영자 명령 youtube-bot으로 잇는다)로 공식 API가 기본 길
const officialBot = chatSendSetting.send?.route === 'official-bot'
if (chatSendSetting.send !== null && officialBot) {
  if (youtubeSetting.youtube === null) {
    complain('시작하지 못했어요. 공식 API 봇(official-bot)에는 구글 연결 설정(LIVEJJIM_GOOGLE_CLIENT_ID)이 필요해요.')
    process.exit(1)
  }
  say(`감사 채팅을 ${SERVICE_NAME} 봇 계정 이름으로 공식 API로 올려요.`)
}
if (chatSendSetting.send !== null && !officialBot) {
  try {
    chatSend = await createChatSendRoute(chatSendSetting.send)
  } catch {
    complain('시작하지 못했어요. 감사 채팅 로그인 파일(LIVEJJIM_YT_SEND_SECRET_FILE)이나 계정 목록 파일(LIVEJJIM_YT_SEND_ACCOUNTS_FILE)을 읽지 못했어요.')
    process.exit(1)
  }
  say(`감사 채팅을 다른 길(${chatSendSetting.send.route})로 올려요 — 유튜브가 허락한 연동이 아니에요.`)
  // 공식 API 넘김은 구글 연결 설정이 있어야 한다 (봇 계정의 구글 토큰을 쓴다, D-YT-SEND-13·21)
  if (chatSendSetting.send.official !== null) {
    if (youtubeSetting.youtube === null) {
      complain('시작하지 못했어요. 공식 API 넘김(LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID)에는 구글 연결 설정(LIVEJJIM_GOOGLE_CLIENT_ID)이 필요해요.')
      process.exit(1)
    }
    say('봇 길이 막히면 봇 계정 이름으로 공식 API로 넘겨 올려요.')
  }
}
const chatSendOfficial =
  chatSendSetting.send?.official === undefined || chatSendSetting.send.official === null
    ? null
    : { ...chatSendSetting.send.official, ...(officialBot ? { primary: { sellers: chatSendSetting.send.sellers } } : {}) }
// 틱톡 감사 채팅 (D-TT-SEND-07): LIVEJJIM_TT_SEND_SELLERS가 비면 꺼짐. 켜면 봇 계정 로그인 파일이 있어야 한다(내용은 로그·문장에 넣지 않는다)
const tiktokSendSetting = readTiktokChatSend(process.env)
if (!tiktokSendSetting.ok) {
  complain(`시작하지 못했어요. ${tiktokSendSetting.message}`)
  process.exit(1)
}
const tiktokSend = tiktokSendSetting.send
if (tiktokSend !== null) {
  try {
    await access(tiktokSend.stateFile)
  } catch {
    complain('시작하지 못했어요. 틱톡 봇 계정 로그인 파일(LIVEJJIM_TT_SEND_STATE_FILE)을 읽지 못했어요.')
    process.exit(1)
  }
  say('틱톡 감사 채팅을 봇 계정 브라우저로 올려요 — 틱톡이 허락한 연동이 아니에요.')
}
// 두 자리 교대 (D-RETRO-35·36): 어느 자리인지, 대기로 뜰지. 자리 이름이 없으면 한 대 구성 — 늘 운영으로 뜬다
const slotSetting = readSlotSetting(process.env)
if (!slotSetting.ok) {
  complain(`시작하지 못했어요. ${slotSetting.message}`)
  process.exit(1)
}
if (slotSetting.notice !== null) complain(slotSetting.notice)
const slot = new SlotState(slotSetting)
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
  standby: slot.mode === 'standby',
  slot: () => slot.view(),
  trustedProxies: deploy.trustedProxies,
  ...(deploy.opsToken === null ? {} : { opsToken: deploy.opsToken }),
  ...(deploy.webDir === null ? {} : { webDir: deploy.webDir }),
  // 앱 화면 새 버전 묶음 폴더 (D-OTA-01): 맥 미니 자동 내보내기가 채운다. 없으면 앱은 늘 "새 것 없음"을 받는다
  ...(process.env['LIVEJJIM_APP_UPDATES_DIR']?.trim() ? { appUpdatesDir: process.env['LIVEJJIM_APP_UPDATES_DIR'].trim() } : {}),
  // 유튜브 채팅 읽기는 서버가 방송 주소만으로 (YT-11, D-YT-SRV-01) — 구글 OAuth 설정이 없어도 된다(그때 구글 연결은 503). 끄기는 LIVEJJIM_YT_WEB_CHAT=off
  youtube: { ...(youtubeSetting.youtube ?? { clientId: '', clientSecret: '', redirectUri: '', returnUrl: `${origin.origin}/settings/youtube` }), webChat: readYoutubeWebChat(process.env, (() => { const media = readMediaProxy(process.env); return media.kind === 'ok' ? media.url : null })()), ...(chatSend === null ? {} : { chatSend }), ...(chatSendOfficial === null ? {} : { chatSendOfficial }) },
  backupStorage: backupDir === null ? null : new FolderBackupStorage(backupDir),
  ...(tiktokSend === null
    ? {}
    : {
        tiktokThanks: {
          sender: new BrowserTikTokSender({ storageStatePath: tiktokSend.stateFile, timer: realTimer(), headless: tiktokSend.headless, ...(tiktokSend.chromiumPath === null ? {} : { executablePath: tiktokSend.chromiumPath }) }),
          sellers: tiktokSend.sellers,
          botUserIds: tiktokSend.botUserIds,
        },
      }),
  // 방송 소리로 듣기 (LV1 D-LV1-08): LIVEJJIM_STREAM_AUDIO=off면 끔, ffmpeg가 없으면 시작 기록 한 줄 남기고 꺼짐
  // 페이지에 HLS가 없으면 yt-dlp로 소리 주소를 얻는다 (D-LV1-11) — LIVEJJIM_YTDLP_PATH, 비우면 yt-dlp
  // 집 회선 프록시 (D-LV1-13): LIVEJJIM_YT_MEDIA_PROXY — 이 기계 안 터널 끝(http://127.0.0.1·localhost·host.docker.internal:<포트>)만. 그 밖이면 쓰지 않고 경고 한 줄
  streamAudio: { on: readStreamAudioSwitch(process.env), ytDlpPath: readYtDlpPath(process.env), mediaProxy: readMediaProxy(process.env) },
})
/** 뒤 작업을 켠다 — 운영으로 뜰 때 바로, 대기로 떴으면 올릴 때(SIGUSR2) */
function startBackground(): void {
  // 워커: 유튜브 수집기·발송함(설정이 있을 때), 30일 봉인 작업 — 끝나지 않은 회차의 수집기가 저절로 다시 돈다 (NFR-03)
  livejjim.start()
  // 매일 판매자 자동 백업 (I2 D-I2-10)
  livejjim.backups.start()
}
if (slot.mode === 'active') startBackground()
else say('대기 자리로 떴어요. 요청은 받지만 뒤 작업은 올릴 때까지 돌리지 않아요.')
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

/** 실시간 연결·남은 타이머를 닫고, 새 연결을 받지 않고, 진행 중 요청을 마친 뒤 끝낸다 */
function shutdown(forceAfterMs: number): void {
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
  setTimeout(() => server.closeAllConnections(), forceAfterMs).unref()
}

/** 뒤 작업을 멈추고 임대를 내려놓는다 — 한 번만 돈다(넘길 때 했으면 내릴 때 다시 하지 않는다) */
let quiet: Promise<void> | null = null
function quiesce(): Promise<void> {
  quiet ??= livejjim.quiesce().catch(() => {
    complain('뒤 작업을 멈추다 오류가 났어요. 남은 임대는 시간이 지나면 풀려요.')
  })
  return quiet
}

function stop(): void {
  if (stopping) {
    complain('바로 끝낼게요.')
    process.exit(1)
  }
  stopping = true
  // 한 대 구성(자리 이름 없음)은 지금까지와 같다: 바로 닫는다
  if (slot.view().slot === null) {
    shutdown(FORCE_CLOSE_AFTER_MS)
    return
  }
  // 두 자리 교대: 내리는 중으로 바꾸고(/health/active 503 — 앞단이 이 자리를 뺀다) 뒤 작업을 멈춰 임대를 내려놓는다.
  // 그동안에도 요청은 받는다. 앞단이 알아챌 시간(DRAIN_GRACE_MS)과 뒤 작업 멈추기가 둘 다 끝나면 닫는다
  slot.drain()
  say('내리는 중이에요. 요청은 잠깐 더 받아요.')
  const grace = new Promise<void>((resolve) => setTimeout(resolve, DRAIN_GRACE_MS))
  // 실시간 연결을 먼저 닫아 화면·앱·일꾼이 새 자리로 다시 붙게 한다 (요청은 계속 받는다)
  setTimeout(() => {
    livejjim.hub.closeAll()
    livejjim.voice.close()
  }, DRAIN_REALTIME_CLOSE_MS).unref()
  void Promise.all([grace, quiesce()]).then(() => shutdown(DRAIN_FORCE_CLOSE_AFTER_MS))
}

// 올리기 (D-RETRO-37): 대기 → 운영. 이미 운영이거나 내리는 중이면 아무것도 하지 않는다(처리기가 없으면 SIGUSR2는 프로세스를 끝낸다 — 늘 받아 둔다)
process.on('SIGUSR2', () => {
  if (!slot.promote()) {
    say('올리기 신호를 받았지만 대기 자리가 아니라 그대로 둬요.')
    return
  }
  startBackground()
  say('운영으로 올렸어요. 뒤 작업을 시작했어요.')
})
// 넘기기 (D-RETRO-37): 운영 → 넘기는 중. 뒤 작업이 다 멈춘 뒤에 상태를 바꾼다 — 교체 스크립트가 그 상태를 보고 새 자리를 올린다.
// 한 대 구성에서는 아무것도 하지 않는다(뒤 작업을 이어받을 자리가 없다)
process.on('SIGHUP', () => {
  if (slot.view().slot === null || slot.mode !== 'active' || stopping) {
    say('넘기기 신호를 받았지만 두 자리 구성의 운영 자리가 아니라 그대로 둬요.')
    return
  }
  say('뒤 작업을 멈추고 임대를 내려놓아요. 요청은 그대로 받아요.')
  void quiesce().then(() => {
    if (slot.handover()) say('뒤 작업을 넘길 준비가 됐어요.')
  })
})
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
