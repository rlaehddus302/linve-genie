// 감사 채팅 봇 계정 연결 명령 (D-YT-SEND-21). 운영자만 서버에서 쓴다 — 봇 연결은 로그인 계정이 없는 시스템 판매자에 두어 화면에서는 보거나 바꿀 수 없다.
//   pnpm --filter @livejjim/server youtube-bot status
//       봇 연결 상태(연결됨·다시 연결 필요·없음)와 채널
//   pnpm --filter @livejjim/server youtube-bot connect [--channel UC…]
//       구글 승인 주소를 찍는다(10분·한 번). 봇 계정으로 로그인한 브라우저에서 열어 허락하면 서버의 돌아오는 주소가 봇 연결로 저장한다.
//       채널을 적지 않으면 LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID. 그 채널이 아닌 계정으로 허락하면 받지 않는다
//   pnpm --filter @livejjim/server youtube-bot move --from-seller <판매자 ID> [--channel UC…]
//       판매자 계정에 이어 두었던 봇 연결(옛 D-YT-SEND-20)을 시스템 판매자로 옮긴다 — 구글 승인을 다시 받지 않는다(폐기 요청도 하지 않는다)
// 토큰·state는 출력하지 않는다(승인 주소 안의 state는 그 승인에만 쓰인다).
import { readAppOrigin, readYoutubeSetting } from '../config.ts'
import { readMasterKey } from '../secrets.ts'
import { BOT_SELLER_ID, YoutubeConnections } from '../youtube/connect.ts'
import { GoogleClient } from '../youtube/google.ts'
import { realTimer } from '../youtube/timer.ts'
import { complain, loadDotEnv, openDatabaseFromEnv, parseArgs, say } from './shared.ts'

const USAGE = '사용법: youtube-bot status | connect [--channel UC…] | move --from-seller <판매자 ID> [--channel UC…]'
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/

loadDotEnv()
const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest, command === 'move' ? ['from-seller', 'channel'] : command === 'connect' ? ['channel'] : [])
const masterKey = readMasterKey(process.env['LIVEJJIM_MASTER_KEY'])
const origin = readAppOrigin(process.env)
const setting = origin.ok ? readYoutubeSetting(process.env, origin.origin) : null
const channel = (args.ok ? args.values.get('channel') : undefined) ?? (process.env['LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID'] ?? '').trim()

if (command !== 'status' && command !== 'connect' && command !== 'move') {
  complain(USAGE)
  process.exitCode = 2
} else if (!args.ok) {
  complain(args.message)
  process.exitCode = 2
} else if (!masterKey.ok) {
  complain(masterKey.message)
  process.exitCode = 2
} else if (!origin.ok || setting === null || !setting.ok || setting.youtube === null) {
  complain('구글 연결 설정(LIVEJJIM_APP_ORIGIN·LIVEJJIM_GOOGLE_CLIENT_ID·SECRET·REDIRECT_URI)을 확인해 주세요.')
  process.exitCode = 2
} else if (command !== 'status' && !CHANNEL_RE.test(channel)) {
  complain('봇 채널 ID(--channel 또는 LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID)를 UC로 시작하는 24자로 적어 주세요.')
  process.exitCode = 2
} else if (command === 'move' && (args.values.get('from-seller') ?? '') === '') {
  complain(USAGE)
  process.exitCode = 2
} else {
  const database = await openDatabaseFromEnv({ migrate: true })
  if (database === null) {
    process.exitCode = 2
  } else {
    try {
      const timer = realTimer()
      const youtube = setting.youtube
      const google = new GoogleClient({ ...youtube.endpoints, clientId: youtube.clientId, clientSecret: youtube.clientSecret, redirectUri: youtube.redirectUri, timer, meter: async () => {} })
      const connections = new YoutubeConnections({ db: database.db, masterKey: masterKey.key, google, timer, log: () => {}, onStatus: () => {}, onConsentOff: async () => {} })
      if (command === 'status') {
        const view = await connections.status(BOT_SELLER_ID)
        const words = { NOT_CONNECTED: '연결 안 됨', CONNECTED: '연결됨', RECONNECT_NEEDED: '다시 연결 필요' } as const
        say(`봇 연결: ${words[view.status]}${view.channel === null ? '' : ` · 채널 ${view.channel.id} (${view.channel.title}) · 채팅 쓰기 권한 ${view.permissions.publish ? '있음' : '없음'}`}`)
      } else if (command === 'connect') {
        const url = await connections.startBot(channel)
        say('봇 계정(그 채널)으로 로그인한 브라우저에서 10분 안에 아래 주소를 열어 허락해 주세요. 한 번만 쓸 수 있어요.')
        say(url)
      } else {
        const result = await connections.moveToBot(args.values.get('from-seller') ?? '', channel)
        const words = {
          moved: '봇 연결을 시스템 판매자로 옮겼어요. 그 판매자 계정의 유튜브 연결은 지웠어요.',
          NOT_FOUND: '그 판매자에게 유튜브 연결이 없어요.',
          WRONG_CHANNEL: '그 판매자의 연결 채널이 봇 채널과 달라요.',
          NO_PUBLISH: '그 연결에는 채팅 쓰기 권한이 없어요. youtube-bot connect로 새로 이어 주세요.',
        } as const
        if (result === 'moved') say(words.moved)
        else {
          complain(words[result])
          process.exitCode = 1
        }
      }
    } finally {
      await database.close()
    }
  }
}
