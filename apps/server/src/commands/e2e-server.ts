// E2E용 서버 기동 명령 (AC-S05-91): pnpm --filter @livejjim/server e2e [--port 3100 (0이면 빈 포트)] [--origin http://localhost:5173] [--fill yes]
//   [--fill-products 500] [--fill-chats 10000] [--host-delay-ms 5000] [--chat-speed 1] [--test-printer yes|no] [--youtube fake] [--youtube-port 4100] [--instagram yes|no] [--instagram-port 4300] [--tiktok yes|no] [--band fake|no] [--band-port 4400] [--billing yes|no] [--billing-prices placeholder|final]
//   [--social fake|no] [--social-port 4500] [--social-providers kakao,naver,google]
//   [--assist fake|no] [--assist-port 4600] [--assist-daily 20] [--assist-global 500] [--assist-timeout-ms 15000]
// - --assist fake: 가짜 LLM 서버(Anthropic Messages API 모양)를 127.0.0.1의 --assist-port(기본 0 = 빈 포트)에 함께 띄우고 AI 제안을 가짜 키로 켠다(A1, AC-A1-11).
//   --assist-daily·--assist-global = 판매자·서버 전체 하루 상한(기본 20·500), --assist-timeout-ms = 호출 시간 제한(기본 15000). 조작은 http://127.0.0.1:<그 포트>/_fake/*
//   (harness/sprints/A1/dev-notes.md). 기본 no(키 없음 — 지금과 같다).
// - --social fake: 가짜 OAuth 서버(구글·카카오·네이버)를 127.0.0.1의 --social-port(기본 0 = 빈 포트)에 함께 띄우고 간편 로그인을 켠다(L1, AC-L1-12).
//   --social-providers로 켤 공급자를 고른다(쉼표, 기본 셋 다). 조작은 http://127.0.0.1:<그 포트>/_fake/* (harness/sprints/L1/dev-notes.md "시험에게"). 기본 no(지금과 같다).
// - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 시험용 마스터 키, 시험용 판매자 계정(apps/server/e2e/account.json). 끄면 데이터는 사라진다.
// - --fill yes: 상품 500·채팅 1만 건을 채운 실제 범위(오늘, KST) — 화면 반영 1초 시험(AC-S05-64)용. 채우기가 끝난 뒤에 포트를 연다.
// - --host-delay-ms: 화면이 방송자 조치를 보내기 전에 기다리는 시간(GET /api/client-config, 운영 값 5000). E2E에서만 줄인다.
// - --chat-speed: 리허설 가짜 채팅 생성기의 간격을 이 값으로 나눈다(시험 속도, 운영 1).
// - --test-printer: 시험 모드 신호(화면이 시험용 프린터를 켠다 — GET /api/client-config testPrinter, I1). 기본 yes, no면 끈다(AC-I1-50).
// - --billing: 요금 기능(N5). 기본 no(꺼짐 — 지금과 똑같다). yes면 시험 결제(가짜 결제 서버·가짜 발행기·시험 경로 /api/billing/test/**)와 기본 요금 표(AC-N5-11·40).
// - --youtube fake: 가짜 구글·유튜브 서버를 127.0.0.1의 --youtube-port(기본 0 = 빈 포트)에 함께 띄우고 서버가 그 주소를 쓴다(AC-Y1-81).
//   조작은 http://127.0.0.1:<그 포트>/_fake/* (harness/sprints/Y1/dev-notes.md "화면(I3)에게"). 워커(수집기·발송함·봉인)도 돈다.
//   --youtube-chat web|official: 채팅 읽기 길. 기본 web(운영처럼 서버가 유튜브 웹으로 읽음 — 가짜 유튜브 웹 서버를 함께 띄우고 가짜 구글 방송·채팅을 비춘다,
//   웹 조작은 같은 포트의 /_fake/web/*, harness/sprints/YT-SRV/dev-notes.md). official은 옛 공식 API 읽기.
// - I3 시험용 선택 (AC-I3-93, harness/sprints/I3/dev-notes.md "화면에게" 8 — 운영 시작 main에는 없다):
//   --youtube-quota-budget n(유튜브 할당량 판매자 예산·프로젝트 한도) · --outbox-fast yes(발송함 시간 줄이기) · --web-dir <폴더>(서버가 화면을 같은 출처로 함께 낸다).
//   시험용 조작 경로 POST /_e2e/sellers · /_e2e/dates · /_e2e/seal (이 서버 주소, JSON).
// - --instagram yes: 가짜 메타 서버를 함께 띄우고 인스타그램 연동을 그 주소로 둔다(N2 — 조작 주소 /_fake/*, harness/sprints/N2/dev-notes.md "화면에게"). 기본 no.
// - --band fake: 가짜 밴드 서버를 함께 띄우고 밴드 연동을 그 주소로 둔다(BND1 — 조작 주소 /_e2e/band/*, 읽기 간격 1초·3초, harness/sprints/BND1/dev-notes.md "화면에게"). 기본 no.
// - --tiktok yes: 가짜 웹캐스트로 틱톡 라이브 베타를 켠다(운영자 스위치 켬, N2b-2 — 조작 주소 /_e2e/tiktok/*, harness/sprints/N2b-2/dev-notes.md "화면에게"). 기본 no.
// - --backup-dir: 백업 폴더(I2). 적지 않으면 임시 폴더를 만들고 끌 때 지운다. 시작할 때 시험 판매자의 자동 백업 하나를 만든다.
// - --test-deposits: 입금 확인 시험 모드(가짜 원천·시험용 입금 넣기 POST /api/deposits/test/rows, N3). 기본 yes, no면 끈다.
// - --deposit-poll-ms: 받아 오기 주기(밀리초, 100~300000, 기본 1000). --deposit-refetch-ms: "지금 받아 오기" 간격(0~60000, 기본 60000 — 운영 값).
// - --parcel: 택배 자동 접수 시험 모드(가짜 택배사 127.0.0.1, T1). 기본 yes, no면 끈다. --parcel-port(기본 0 = 빈 포트) · --parcel-track-ms(조회 주기 1000~1800000, 기본 5000).
//   조작은 이 서버의 /_e2e/parcel/* (harness/sprints/T1/dev-notes.md "[server] 시험·E2E").
// - 환경변수 PORT·LIVEJJIM_APP_ORIGIN도 읽는다(인자가 우선). .env는 읽지 않는다(실제 비밀값이 필요 없다).
// - 127.0.0.1에서만 연다(모든 인터페이스가 아니다, AC-S06-73). 헬스체크·프록시는 http://127.0.0.1:<포트>로.
// 포트를 연 뒤 "E2E 서버를 시작했어요. http://127.0.0.1:<포트> · …" 한 줄을 표준 출력에 쓴다. 비밀번호·마스터 키는 출력하지 않는다.
import { readAppOrigin, readPort } from '../config.ts'
import { startE2eServer, type FillOptions } from '../e2e.ts'
import { webDirProblem } from '../web.ts'
import { complain, parseArgs, say } from './shared.ts'

const DEFAULT_E2E_PORT = 3100

const args = parseArgs(process.argv.slice(2), [
  'port',
  'origin',
  'fill',
  'fill-products',
  'fill-chats',
  'host-delay-ms',
  'chat-speed',
  'test-printer',
  'youtube',
  'youtube-port',
  'youtube-quota-budget',
  'youtube-chat',
  'outbox-fast',
  'web-dir',
  'instagram',
  'instagram-port',
  'tiktok',
  'band',
  'band-port',
  'backup-dir',
  'billing',
  'billing-prices',
  'test-deposits',
  'deposit-poll-ms',
  'deposit-refetch-ms',
  'parcel',
  'parcel-port',
  'parcel-track-ms',
  'social',
  'social-port',
  'social-providers',
  'assist',
  'assist-port',
  'assist-daily',
  'assist-global',
  'assist-timeout-ms',
  'stream-audio',
])
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
const testPrinterFlag = values.get('test-printer')
const youtubeFlag = values.get('youtube')
const youtubePort = intArg('youtube-port', 0, 65_535)
const quotaBudget = intArg('youtube-quota-budget', 1, 1_000_000)
const youtubeChat = values.get('youtube-chat')
const outboxFast = values.get('outbox-fast')
const webDir = values.get('web-dir')
const instagramFlag = values.get('instagram')
const billingFlag = values.get('billing')
// PAY2: 요금 표 — placeholder(기본, 자리 표시) · final(시험용 확정 요금 표 — 공개 요금 안내 /api/pricing이 ready)
const billingPricesFlag = values.get('billing-prices')
const instagramPort = intArg('instagram-port', 0, 65_535)
const tiktokFlag = values.get('tiktok')
// LV1: --stream-audio fake|off|no — fake면 가짜 방송 소리 + 모의 일꾼(조작 /_e2e/stream-audio), off면 운영자 끔과 같게(설정 칸 없음). 기본 no(꺼짐)
const streamAudioFlag = values.get('stream-audio')
const bandFlag = values.get('band')
const bandPort = intArg('band-port', 0, 65_535)
const testDepositsFlag = values.get('test-deposits')
const depositPoll = intArg('deposit-poll-ms', 100, 300_000)
const depositRefetch = intArg('deposit-refetch-ms', 0, 60_000)
const parcelFlag = values.get('parcel')
const parcelPort = intArg('parcel-port', 0, 65_535)
const parcelTrack = intArg('parcel-track-ms', 1000, 1_800_000)
const socialFlag = values.get('social')
const socialPort = intArg('social-port', 0, 65_535)
const socialProvidersRaw = values.get('social-providers')
const socialProviders = socialProvidersRaw === undefined ? undefined : socialProvidersRaw.split(',').map((item) => item.trim())
const assistFlag = values.get('assist')
const assistPort = intArg('assist-port', 0, 65_535)
const assistDaily = intArg('assist-daily', 0, 1_000_000)
const assistGlobal = intArg('assist-global', 0, 1_000_000)
const assistTimeout = intArg('assist-timeout-ms', 100, 60_000)
const socialProvidersOk = socialProviders === undefined || (socialProviders.length > 0 && socialProviders.every((item) => item === 'google' || item === 'kakao' || item === 'naver') && new Set(socialProviders).size === socialProviders.length)

if (
  portArg === null ||
  products === null ||
  chats === null ||
  hostDelay === null ||
  chatSpeed === null ||
  youtubePort === null ||
  instagramPort === null ||
  bandPort === null ||
  (bandFlag !== undefined && bandFlag !== 'fake' && bandFlag !== 'no') ||
  quotaBudget === null ||
  depositPoll === null ||
  depositRefetch === null ||
  parcelPort === null ||
  parcelTrack === null ||
  (parcelFlag !== undefined && parcelFlag !== 'yes' && parcelFlag !== 'no') ||
  socialPort === null ||
  !socialProvidersOk ||
  assistPort === null ||
  assistDaily === null ||
  assistGlobal === null ||
  assistTimeout === null ||
  (assistFlag !== undefined && assistFlag !== 'fake' && assistFlag !== 'no') ||
  (socialFlag !== undefined && socialFlag !== 'fake' && socialFlag !== 'no') ||
  (testDepositsFlag !== undefined && testDepositsFlag !== 'yes' && testDepositsFlag !== 'no') ||
  (fillFlag !== undefined && fillFlag !== 'yes' && fillFlag !== 'no') ||
  (testPrinterFlag !== undefined && testPrinterFlag !== 'yes' && testPrinterFlag !== 'no') ||
  (youtubeFlag !== undefined && youtubeFlag !== 'fake' && youtubeFlag !== 'no') ||
  (youtubeChat !== undefined && youtubeChat !== 'web' && youtubeChat !== 'official') ||
  (outboxFast !== undefined && outboxFast !== 'yes' && outboxFast !== 'no') ||
  (webDir !== undefined && webDirProblem(webDir) !== null) ||
  (instagramFlag !== undefined && instagramFlag !== 'yes' && instagramFlag !== 'no') ||
  (tiktokFlag !== undefined && tiktokFlag !== 'yes' && tiktokFlag !== 'no') ||
  (streamAudioFlag !== undefined && !['fake', 'off', 'no'].includes(streamAudioFlag)) ||
  (billingFlag !== undefined && billingFlag !== 'yes' && billingFlag !== 'no') ||
  (billingPricesFlag !== undefined && billingPricesFlag !== 'placeholder' && billingPricesFlag !== 'final')
) {
  complain(
    '인자를 확인해 주세요. --port 0~65535, --fill yes|no, --fill-products 1~999, --fill-chats 0~100000, --host-delay-ms 0~5000, --chat-speed 1~1000, --test-printer yes|no, ' +
      '--youtube fake|no, --youtube-port 0~65535, --youtube-quota-budget 1~1000000, --youtube-chat web|official, --outbox-fast yes|no, --web-dir <index.html이 있는 화면 빌드 폴더>, --instagram yes|no, --tiktok yes|no, --stream-audio fake|off|no, --band fake|no, --band-port 0~65535, ' +
      '--test-deposits yes|no, --deposit-poll-ms 100~300000, --deposit-refetch-ms 0~60000, --billing yes|no, --billing-prices placeholder|final, --parcel yes|no, --parcel-port 0~65535, --parcel-track-ms 1000~1800000, --social fake|no, --social-port 0~65535, --social-providers google,kakao,naver 중 고른 것, ' +
      '--assist fake|no, --assist-port 0~65535, --assist-daily 0~1000000, --assist-global 0~1000000, --assist-timeout-ms 100~60000',
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
  // 이 명령은 localhost의 일회성 시험 DB 전용이다. 실제 운영 기동에는 이 값이 없다.
  transcribeWorkerToken: 'livejjim-e2e-transcribe-worker',
  ...(fill === undefined ? {} : { fill }),
  ...(hostDelay === undefined ? {} : { hostActionDelayMs: hostDelay }),
  ...(chatSpeed === undefined ? {} : { generatorSpeed: chatSpeed }),
  testPrinter: testPrinterFlag !== 'no',
  ...(youtubeFlag === 'fake' ? { youtube: { ...(youtubePort === undefined ? {} : { port: youtubePort }), ...(quotaBudget === undefined ? {} : { quotaBudget }), chat: youtubeChat === 'official' ? 'official' : 'web' } } : {}),
  ...(outboxFast === 'yes' ? { outboxFast: true } : {}),
  ...(webDir === undefined ? {} : { webDir }),
  instagram: instagramFlag === 'yes',
  ...(instagramPort === undefined ? {} : { instagramPort }),
  tiktok: tiktokFlag === 'yes',
  ...(streamAudioFlag === 'fake' ? { streamAudio: { mockWorker: true } } : streamAudioFlag === 'off' ? { streamAudio: { on: false } } : {}),
  ...(bandFlag === 'fake' ? { band: bandPort === undefined ? {} : { port: bandPort } } : {}),
  ...(values.get('backup-dir') === undefined ? {} : { backupDir: values.get('backup-dir') as string }),
  billing: billingFlag === 'yes',
  ...(billingPricesFlag === 'final' ? { billingPrices: 'final' as const } : {}),
  testDeposits: testDepositsFlag !== 'no',
  ...(depositPoll === undefined ? {} : { depositPollMs: depositPoll }),
  ...(depositRefetch === undefined ? {} : { depositRefetchMs: depositRefetch }),
  parcel: parcelFlag !== 'no',
  ...(parcelPort === undefined ? {} : { parcelPort }),
  ...(parcelTrack === undefined ? {} : { parcelTrackMs: parcelTrack }),
  ...(socialFlag === 'fake'
    ? { social: { ...(socialPort === undefined ? {} : { port: socialPort }), ...(socialProviders === undefined ? {} : { providers: socialProviders as ('google' | 'kakao' | 'naver')[] }) } }
    : {}),
  ...(assistFlag === 'fake'
    ? {
        assist: {
          ...(assistPort === undefined ? {} : { port: assistPort }),
          ...(assistDaily === undefined ? {} : { dailyLimit: assistDaily }),
          ...(assistGlobal === undefined ? {} : { globalLimit: assistGlobal }),
          ...(assistTimeout === undefined ? {} : { timeoutMs: assistTimeout }),
        },
      }
    : {}),
})

// 127.0.0.1에서만 연다 (AC-S06-73, D-096 — 같은 네트워크의 다른 기기가 시험 계정·시험 데이터에 닿지 않게)
try {
  const opened = await e2e.listen(port)
  const filled = e2e.fill === null ? '채우기 없음' : `채운 범위 ${e2e.fill.date} · 상품 ${String(e2e.fill.products)} · 채팅 ${String(e2e.fill.chats)}`
  const youtube = e2e.fakeGoogle === null ? '' : ` · 가짜 유튜브 ${e2e.fakeGoogle.url}${e2e.fakeWeb === null ? '(공식 읽기)' : `(웹 읽기 ${e2e.fakeWeb.url}, 조작 /_fake/web/*)`}`
  const meta =
    (e2e.fakeMeta === null ? '' : ` · 가짜 메타 ${e2e.fakeMeta.url}`) +
    (e2e.fakeWebcast === null ? '' : ' · 가짜 틱톡(/_e2e/tiktok/*)') +
    (e2e.fakeBand === null ? '' : ` · 가짜 밴드 ${e2e.fakeBand.origin}(/_e2e/band/*)`)
  const web =
    (webDir === undefined ? '' : ' · 화면 함께 냄') +
    (e2e.fakeCarrier === null ? '' : ` · 가짜 택배 ${e2e.fakeCarrier.url}(/_e2e/parcel/*)`) +
    (e2e.fakeOAuth === null ? '' : ` · 가짜 OAuth ${e2e.fakeOAuth.url}`) +
    (e2e.fakeLlm === null ? '' : ` · 가짜 AI ${e2e.fakeLlm.url}`)
  say(
    `E2E 서버를 시작했어요. http://${opened.host}:${String(opened.port)} · 화면 주소 ${origin} · 시험 계정 ${e2e.account.loginId} · ${filled} · ` +
      `방송자 조치 대기 ${String(hostDelay ?? 5000)}ms · 시험용 프린터 ${testPrinterFlag === 'no' ? '끔' : '켬'} · 시험용 입금 ${testDepositsFlag === 'no' ? '끔' : '켬'} · 요금 ${billingFlag === 'yes' ? '켬(시험 결제)' : '끔'}${youtube}${meta}${web} · 준비 ${String(Date.now() - started)}ms`,
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
