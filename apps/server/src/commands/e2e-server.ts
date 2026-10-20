// E2E용 서버 기동 명령 (AC-S05-91): pnpm --filter @livejjim/server e2e [--port 3100 (0이면 빈 포트)] [--origin http://localhost:5173] [--fill yes]
//   [--fill-products 500] [--fill-chats 10000] [--host-delay-ms 5000] [--chat-speed 1] [--youtube fake] [--youtube-port 4100]
// - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 시험용 마스터 키, 시험용 판매자 계정(apps/server/e2e/account.json). 끄면 데이터는 사라진다.
// - --fill yes: 상품 500·채팅 1만 건을 채운 실제 범위(오늘, KST) — 화면 반영 1초 시험(AC-S05-64)용. 채우기가 끝난 뒤에 포트를 연다.
// - --host-delay-ms: 화면이 방송자 조치를 보내기 전에 기다리는 시간(GET /api/client-config, 운영 값 5000). E2E에서만 줄인다.
// - --chat-speed: 리허설 가짜 채팅 생성기의 간격을 이 값으로 나눈다(시험 속도, 운영 1).
// - --youtube fake: 가짜 구글·유튜브 서버를 127.0.0.1의 --youtube-port(기본 0 = 빈 포트)에 함께 띄우고 서버가 그 주소를 쓴다(AC-Y1-81).
//   조작은 http://127.0.0.1:<그 포트>/_fake/* (harness/sprints/Y1/dev-notes.md "화면(I3)에게"). 워커(수집기·발송함·봉인)도 돈다.
// - I3 시험용 선택 (AC-I3-93, harness/sprints/I3/dev-notes.md "화면에게" 8 — 운영 시작 main에는 없다):
//   --youtube-quota-budget n(유튜브 할당량 판매자 예산·프로젝트 한도) · --outbox-fast yes(발송함 시간 줄이기) · --web-dir <폴더>(서버가 화면을 같은 출처로 함께 낸다).
//   시험용 조작 경로 POST /_e2e/sellers · /_e2e/dates · /_e2e/seal (이 서버 주소, JSON).
// - 환경변수 PORT·LIVEJJIM_APP_ORIGIN도 읽는다(인자가 우선). .env는 읽지 않는다(실제 비밀값이 필요 없다).
// - 127.0.0.1에서만 연다(모든 인터페이스가 아니다, AC-S06-73). 헬스체크·프록시는 http://127.0.0.1:<포트>로.
// 포트를 연 뒤 "E2E 서버를 시작했어요. http://127.0.0.1:<포트> · …" 한 줄을 표준 출력에 쓴다. 비밀번호·마스터 키는 출력하지 않는다.
import { readAppOrigin, readPort } from '../config.ts'
import { startE2eServer, type FillOptions } from '../e2e.ts'
import { webDirProblem } from '../web.ts'
import { complain, parseArgs, say } from './shared.ts'

const DEFAULT_E2E_PORT = 3100

const args = parseArgs(process.argv.slice(2), ['port', 'origin', 'fill', 'fill-products', 'fill-chats', 'host-delay-ms', 'chat-speed', 'youtube', 'youtube-port', 'youtube-quota-budget', 'outbox-fast', 'web-dir'])
if (!args.ok) {
  complain(args.message)
  process.exit(2)
}
const values = args.values
const intArg = (name: string, min: number, max: number): number | undefined | null => {
  const raw = values.get(name)
  if (raw === undefined) return undefined
  const value = /^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

const portArg = intArg('port', 0, 65_535)
const envPort = readPort(process.env)
const port = portArg ?? (envPort.ok && envPort.fromEnv ? envPort.port : DEFAULT_E2E_PORT)
const originEnv = readAppOrigin(process.env)
const origin = values.get('origin') ?? (originEnv.ok ? originEnv.origin : 'http://localhost:5173')
const fillFlag = values.get('fill')
const products = intArg('fill-products', 1, 999)
const chats = intArg('fill-chats', 0, 100_000)
const hostDelay = intArg('host-delay-ms', 0, 5000)
const chatSpeed = intArg('chat-speed', 1, 1000)
const youtubeFlag = values.get('youtube')
const youtubePort = intArg('youtube-port', 0, 65_535)
const quotaBudget = intArg('youtube-quota-budget', 1, 1_000_000)
const outboxFast = values.get('outbox-fast')
const webDir = values.get('web-dir')

if (
  portArg === null ||
  products === null ||
  chats === null ||
  hostDelay === null ||
  chatSpeed === null ||
  youtubePort === null ||
  quotaBudget === null ||
  (fillFlag !== undefined && fillFlag !== 'yes' && fillFlag !== 'no') ||
  (youtubeFlag !== undefined && youtubeFlag !== 'fake' && youtubeFlag !== 'no') ||
  (outboxFast !== undefined && outboxFast !== 'yes' && outboxFast !== 'no') ||
  (webDir !== undefined && webDirProblem(webDir) !== null)
) {
  complain(
    '인자를 확인해 주세요. --port 0~65535, --fill yes|no, --fill-products 1~999, --fill-chats 0~100000, --host-delay-ms 0~5000, --chat-speed 1~1000, --youtube fake|no, --youtube-port 0~65535, ' +
      '--youtube-quota-budget 1~1000000, --outbox-fast yes|no, --web-dir <index.html이 있는 화면 빌드 폴더>',
  )
  process.exit(2)
}
if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
  complain('--origin은 http://localhost:5173 처럼 경로 없이 적어 주세요.')
  process.exit(2)
}

const fill: FillOptions | undefined =
  fillFlag === 'yes' ? { ...(products === undefined ? {} : { products }), ...(chats === undefined ? {} : { chats }) } : undefined

const started = Date.now()
const e2e = await startE2eServer({
  appOrigin: origin,
  ...(fill === undefined ? {} : { fill }),
  ...(hostDelay === undefined ? {} : { hostActionDelayMs: hostDelay }),
  ...(chatSpeed === undefined ? {} : { generatorSpeed: chatSpeed }),
  ...(youtubeFlag === 'fake' ? { youtube: { ...(youtubePort === undefined ? {} : { port: youtubePort }), ...(quotaBudget === undefined ? {} : { quotaBudget }) } } : {}),
  ...(outboxFast === 'yes' ? { outboxFast: true } : {}),
  ...(webDir === undefined ? {} : { webDir }),
})

// 127.0.0.1에서만 연다 (AC-S06-73, D-096 — 같은 네트워크의 다른 기기가 시험 계정·시험 데이터에 닿지 않게)
try {
  const opened = await e2e.listen(port)
  const filled = e2e.fill === null ? '채우기 없음' : `채운 범위 ${e2e.fill.date} · 상품 ${String(e2e.fill.products)} · 채팅 ${String(e2e.fill.chats)}`
  const youtube = e2e.fakeGoogle === null ? '' : ` · 가짜 유튜브 ${e2e.fakeGoogle.url}`
  const web = webDir === undefined ? '' : ' · 화면 함께 냄'
  say(
    `E2E 서버를 시작했어요. http://${opened.host}:${String(opened.port)} · 화면 주소 ${origin} · 시험 계정 ${e2e.account.loginId} · ${filled} · ` +
      `방송자 조치 대기 ${String(hostDelay ?? 5000)}ms${youtube}${web} · 준비 ${String(Date.now() - started)}ms`,
  )
  e2e.http.on('error', () => {
    complain('서버에 문제가 생겨 멈췄어요.')
    void e2e.close().finally(() => process.exit(1))
  })
} catch (error) {
  const code = (error as { code?: unknown }).code
  complain(code === 'EADDRINUSE' ? `시작하지 못했어요. 포트 ${String(port)}를 이미 쓰고 있어요. --port로 다른 포트를 골라 주세요.` : '시작하지 못했어요.')
  await e2e.close().catch(() => {})
  process.exit(1)
}

let stopping = false
function stop(): void {
  if (stopping) process.exit(1)
  stopping = true
  void e2e.close().finally(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
