// 서버 조립 (S04·S05): DB·마스터 키·앱 주소를 받아 기록 경로·서비스·로그인·실시간 알림·리허설 생성기·HTTP 앱을 만든다.
// 시험(단위·적대)은 PGlite로 열어 createServer(...).app.request(...)로 포트 없이 요청한다.
// 시험용 주입점: clock(서버 시계), ids(ID 생성), hooks(저장 실패·응답 전 멈춤·스냅샷 실패), engine(엔진 감싸기), log(로그 수집), runtimeCacheMax(범위 상태 메모리 상한),
// changesWindow(증분 조회 기준점 수), generatorTimer·generatorSpeed(리허설 생성기 타이머·시험 속도), hostActionDelayMs(화면의 방송자 조치 대기 — E2E 기동만 줄인다),
// testPrinter(시험 모드 신호 — 화면이 시험용 프린터를 켠다. E2E 기동만 켠다, 운영 기동은 production.ts가 늘 끈다 — I1 L-11 15).
// I1: 출력 기록(PrintService)을 기록 경로의 같은 트랜잭션(txHook)에 잇고, 실시간 알림(print)·출력 기기 실시간 연결 여부를 허브에 잇는다.
// N5: 요금(BillingService)을 새 실제 방송 시작·주문 건 쓰기(txHook)·라벨 장 쓰기(출력함 트랜잭션)에 잇고, 실시간 알림(billing)을 허브에 잇는다.
// N3: 입금 확인(DepositService — 원천·받아 오기 주기·자동 확인·확인 필요)을 기록 경로와 실시간 알림(deposit)에 잇는다.
//   deposits.testMode(가짜 원천·시험용 입금 넣기)는 E2E 기동만 켠다 — 운영 기동은 production.ts가 늘 끈다(D-N3-12).
// N4a: 라벨 기능 켬/끔 알림(labels)을 허브에 잇는다.
import { readingFactory, type VoiceHistoryObserver } from './voice/reading.ts'
import { VoiceAliases } from './voice/aliases.ts'
import { VoiceRelay, registerVoiceRelay } from './voice/relay.ts'
import { FfmpegAudioFeed, ffmpegAvailable, notLiveBackoff, webStreamLocator, ytDlpResolver, ytDlpTiktokResolver, type AudioFeed, type MediaProxySetting, type StreamLocator } from './voice/stream-audio.ts'
import { StreamAudioService } from './voice/stream-service.ts'
import { sellerStreamAudioOn } from './voice/stream-routes.ts'
import { readFileSync } from 'node:fs'
import { applyEvent } from '@livejjim/core'
import type { Hono } from 'hono'
import { Auth } from './auth.ts'
import { createApp } from './app.ts'
import { BackupScheduler, type BackupStorage } from './backup.ts'
import { ClosingService } from './closing.ts'
import type { Database } from './db/database.ts'
import { StreamHub } from './hub.ts'
import { randomIds, type IdSource } from './ids.ts'
import { errorKind, safeSink, stderrLog, type LogSink } from './log.ts'
import { Alerter, WorkerHealth } from './ops.ts'
import { collectorCounts, failedEventCount, outboxCounts, ping } from './ops-store.ts'
import { createWebServer, webDirProblem } from './web.ts'
import type { EngineAdapter } from './runtime.ts'
import type { LoginLimitOptions } from './login-limit.ts'
import { loginLimitSecret, readMasterKey, type PasswordCost } from './secrets.ts'
import { realTimer as realGeneratorTimer, type GeneratorTimer } from './generator.ts'
import { PrintService } from './print.ts'
import { ReceiptLinkService } from './receipt-links.ts'
import { registerReceiptPage } from './receipt-page.ts'
import type { InstagramSettings } from './instagram/config.ts'
import { createInstagram, type InstagramModule } from './instagram/index.ts'
import type { LiveTimer } from './instagram/notices.ts'
import { createWebhookApp } from './instagram/routes.ts'
import { SellerLocks } from './seller-locks.ts'
import { routeThanks } from './thanks-route.ts'
import { libraryWebcast, type ShortLinkResolver, type TikTokAttemptLimiter, type TikTokClock, type TikTokSettings, type WebcastFactory } from './tiktok/index.ts'
import { TikTokLive } from './tiktok-live/live.ts'
import { TikTokExtension } from './tiktok-live/extension.ts'
import { PasteService } from './tiktok-live/paste-service.ts'
import { CustomerArchiver } from './customers/archive.ts'
import { CustomerService } from './customers/service.ts'
import { LedgerService } from './customers/ledger.ts' // KP1 손님 장부
import { LedgerSweeper } from './customers/ledger-sweep.ts' // KP1 손님 장부
import { sweepSchedule } from './schedule/sweep.ts' // KP1 정리 작업이 같이 부른다
import { ReportService } from './report/service.ts' // KP1 리포트
import { registerSchedulePage } from './schedule/page.ts' // KP1 일정
import { ScheduleService } from './schedule/service.ts' // KP1 일정
import { tiktokLinkCounts } from './tiktok-live/store.ts'
import { BandService, type BandClock, type BandHooks, type BandTiming } from './band/service.ts'
import type { BandSettings } from './band/config.ts'
import { recordPlatformChats } from './platform-record.ts'
import { instagramDmCounts } from './ops-store.ts'
import { DepositService, type DepositOptions } from './deposit/service.ts'
import { registerInboxIntake } from './inbox/routes.ts'
import { InboxService } from './inbox/service.ts'
import { ParcelService, type ParcelOptions } from './parcel/service.ts'
import { createExtensionApp } from './extension/routes.ts'
import { ExtensionService } from './extension/service.ts'
import { ExtensionThanks } from './extension/thanks.ts'
import { connectionAddress } from './api.ts'
import { readQueue } from './print-store.ts'
import { DEFAULT_CHANGES_WINDOW } from './runtime.ts'
import { Service, type ChatIngestOutcome } from './service.ts'
import { kstDate, systemClock, type Clock } from './time.ts'
import { ViewCacheBudget } from './view-budget.ts'
import { BillingRechecker } from './billing/recheck.ts'
import { BillingService, DISABLED_BILLING, type BillingSetup } from './billing/service.ts'
import { sharedWorkPools, type WorkPools } from './work-pool.ts'
import { DEFAULT_RUNTIME_CACHE_MAX, ScopeWriter, type WriterHooks } from './writer.ts'
import type { CollectorHooks } from './youtube/collector.ts'
import type { OutboxHooks, OutboxTiming } from './youtube/outbox.ts'
import { Sealer } from './youtube/seal.ts'
import { YoutubeSystem, checkYoutubeConfig, type LinkHooks, type YoutubeConfig } from './youtube/system.ts'
import { realTimer, type Timer } from './youtube/timer.ts'
import { checkSocialSetup, type SocialLoginSetup } from './social/providers.ts'
import type { SmsSender } from './social/phone.ts'
import { SocialLogin } from './social/service.ts'
import { AssistService, checkAssistSetup, type AssistSetup } from './assist/service.ts'

/** 스냅샷 간격 상한 (AC-S04-28: 일정 이벤트 수, 최대 500) */
export const MAX_SNAPSHOT_EVERY = 500
/** 하트비트 기본 간격 (30초 이내, AC-S04-60) */
export const DEFAULT_HEARTBEAT_MS = 15_000
/** 화면이 방송자 조치(host.*)를 보내기 전에 기다리는 시간 — 운영 값 5초 (D-083, AC-S05-41) */
export const HOST_ACTION_DELAY_MS = 5000
/** 준비 확인: DB 질의가 이 안에 되어야 한다 (AC-I3-80) */
export const READY_TIMEOUT_MS = 2000
/** 서버 버전 (apps/server/package.json) — 운영 상태에 */
export const SERVER_VERSION: string = (() => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

export interface ServerOptions {
  /** 이력 저장소 관측/장애 시험 포트. 운영 기동은 제공하지 않는다. */
  readonly voiceHistoryObserver?: VoiceHistoryObserver
  readonly transcribeWorkerToken?: string
  /**
   * 방송 소리로 듣기 (LV1, D-LV1-08). 없으면 꺼짐. `on: false`는 운영자 끔(LIVEJJIM_STREAM_AUDIO=off).
   * feed를 주지 않으면 ffmpeg를 쓰고, 없으면 시작 기록 한 줄 남기고 꺼진 것처럼. locate를 주지 않으면 유튜브 웹 방송 페이지의 HLS 주소
   */
  readonly streamAudio?: { readonly on: boolean; /** yt-dlp 경로 (D-LV1-11). 없으면 페이지의 HLS만 쓴다 */ readonly ytDlpPath?: string; /** 집 회선 프록시 (D-LV1-13) — yt-dlp·ffmpeg 모두 */ readonly mediaProxy?: MediaProxySetting; readonly feed?: AudioFeed; readonly locate?: StreamLocator; readonly schedule?: (run: () => void, ms: number) => () => void }
  readonly database: Pick<Database, 'db'>
  /** 서버 마스터 키 (32바이트 또는 그 base64). 형식이 틀리면 만들지 않는다 */
  readonly masterKey: Buffer | string
  /** 화면 앱 주소 (상태를 바꾸는 요청의 Origin과 같아야 한다) */
  readonly appOrigin: string
  /** 옛 앱 주소들 (도메인을 옮기는 동안 Origin 검사만 함께 받는다, D-OPS-DOMAIN) */
  readonly oldAppOrigins?: readonly string[]
  readonly clock?: Clock
  readonly ids?: Partial<IdSource>
  readonly hooks?: WriterHooks
  readonly engine?: EngineAdapter
  readonly log?: LogSink
  /** 이 이벤트 수마다 스냅샷 (1~500, 기본 500) */
  readonly snapshotEvery?: number
  /** 실시간 하트비트 간격 (1~30000밀리초, 기본 15000) */
  readonly heartbeatMs?: number
  /** 비밀번호 해시 비용 (시험은 낮춘다) */
  readonly passwordCost?: PasswordCost
  /** 메모리에 두는 범위 상태 수 상한 (1 이상, 기본 128 — 넘으면 오래 안 쓴 범위부터 버리고 다시 필요하면 DB에서 불러온다) */
  readonly runtimeCacheMax?: number
  /** 증분 조회 기준점 수 (범위마다 최근 seq 몇 개의 상태를 둘지, 1 이상, 기본 1000) */
  readonly changesWindow?: number
  /** 리허설 생성기 타이머 (시험은 기다리지 않는 타이머를 넣는다) */
  readonly generatorTimer?: GeneratorTimer
  /** 리허설 생성기 시험 속도 (간격을 이 값으로 나눈다, 1~1000, 기본 1 — E2E 기동만) */
  readonly generatorSpeed?: number
  /** 화면이 방송자 조치를 보내기 전에 기다리는 시간 (0~5000밀리초, 기본 5000 — E2E 기동만 줄인다, D-083) */
  readonly hostActionDelayMs?: number
  /** 유튜브 연동 설정 (Y1). 없으면 유튜브 API는 503 YOUTUBE_NOT_CONFIGURED */
  readonly youtube?: YoutubeConfig
  /** 워커의 시계·기다리기 (기본 clock + 실제 setTimeout — 시험은 ManualTimer) */
  readonly timer?: Timer
  /** 유튜브 HTTP (기본 전역 fetch) */
  readonly youtubeFetch?: typeof fetch
  /** 이 서버(인스턴스) 이름 — 수집기·발송함 임대 주인 (시험에서 둘을 띄울 때) */
  readonly instanceName?: string
  readonly collectorHooks?: CollectorHooks
  readonly outboxHooks?: OutboxHooks
  readonly linkHooks?: LinkHooks
  readonly collectorTiming?: { readonly leaseMs?: number; readonly renewMs?: number; readonly scanMs?: number }
  readonly sealHooks?: { readonly beforeCommit?: () => void | Promise<void> }
  /** 믿는 앞단 프록시 수 (0~5, 기본 0 — LIVEJJIM_TRUSTED_PROXIES, AC-I3-66) */
  readonly trustedProxies?: number
  /** 로그인 경로 속도 제한 (시험에서 줄인다 — 운영은 기본값, AC-I3-66·67) */
  readonly loginLimits?: LoginLimitOptions
  /** 확장 코드 넣기(/ext/connect)의 주소마다 한도 (E2E 기동만 넓힌다 — 운영은 기본값 10분 20번, D-QS1-06) */
  readonly extensionCodeLimits?: LoginLimitOptions
  /** 비밀번호 확인 함수 (시험이 호출 수·동시 수를 잰다) */
  readonly passwordVerifier?: (password: string, stored: string) => Promise<boolean>
  /** 화면 빌드 폴더 — 같은 출처로 함께 낸다 (LIVEJJIM_WEB_DIR, AC-I3-70). 그 폴더에 index.html이 없으면 만들지 않는다 */
  readonly webDir?: string
  /** 운영 토큰 (LIVEJJIM_OPS_TOKEN, 32자 이상 — 없으면 /ops/status는 404, AC-I3-81) */
  readonly opsToken?: string
  /** 준비 확인 시간 제한 (기본 2000밀리초) */
  readonly readyTimeoutMs?: number
  /** 준비 확인 질의 (시험: 느린 질의 흉내) */
  readonly dbPing?: () => Promise<void>
  /** 발송함 시간 (E2E 기동만 줄인다 — AC-I3-93) */
  readonly outboxTiming?: OutboxTiming
  /** 시험 모드 신호 (화면 설정 testPrinter — 시험용 프린터를 켠다). E2E 기동만 켠다. 기본 false (L-11 15, AC-I1-16) */
  readonly testPrinter?: boolean
  /**
   * 요금 (N5, BILLING_RULES). 없으면 꺼짐(기본 — 막지도 세지도 않고 요금 경로가 없다, BL-0 7).
   * 운영 기동은 productionServerOptions가 환경변수로 만든다(시험 결제 없음). 시험·E2E는 testBilling()(가짜 결제 서버·가짜 발행기)
   */
  readonly billing?: BillingSetup
  /** 인스타그램 연동 설정 (N2). 없으면 인스타그램 기능은 NOT_CONFIGURED, 웹훅은 503 (AC-N2-17) */
  readonly instagram?: InstagramSettings | null
  /** 인스타그램 알림·DM 실행기 예약 (시험은 기다리지 않는 타이머를 넣는다) */
  readonly liveTimer?: LiveTimer
  /** DM 실행기를 스스로 돌린다 (기본 true. 시험은 끄고 instagram.dms.drain()을 부른다) */
  readonly dmAutoRun?: boolean
  /** 수집 상태 알림 간격 (기본 1000밀리초 — 시험만 줄인다) */
  readonly collectionIntervalMs?: number
  /**
   * 틱톡 라이브 베타 (N2b-2). settings = readTikTokSettings(process.env)(없으면 꺼짐), libraryEnv = 비어 있지 않은 라이브러리 환경 변수 이름,
   * webcast = 웹캐스트 클라이언트를 만드는 곳(기본 실제 감싸개 libraryWebcast() — 시험·E2E만 가짜), clock = 연결 객체 시계(시험), limiter = 서버 전체 시도 한도,
   * noticeVersion = 지금 고지 판(시험만 바꾼다)
   */
  /** 서버 시작 때 남길 설정 경고 (값 없이 코드만 — 운영 설정 읽기가 정한다) */
  readonly startupWarnings?: readonly ('INSTAGRAM_CONFIG_INSECURE' | 'PARCEL_CARRIER_NOT_READY' | 'BAND_CONFIG_INVALID')[]
  /**
   * 밴드 글 댓글 (BND1). settings = readBandConfig(process.env)(없으면 NOT_CONFIGURED — 밴드로 나가는 요청 없음).
   * clock·timing·fetch·hooks는 시험·E2E만 (가짜 시계·짧은 간격·저장 실패 주입)
   */
  readonly band?: {
    readonly settings?: BandSettings | null
    readonly clock?: BandClock
    readonly timing?: Partial<BandTiming>
    readonly fetch?: typeof fetch
    readonly hooks?: BandHooks
  }
  readonly tiktok?: {
    readonly settings?: TikTokSettings
    readonly libraryEnv?: readonly string[]
    readonly webcast?: WebcastFactory
    readonly clock?: TikTokClock
    readonly limiter?: TikTokAttemptLimiter
    readonly noticeVersion?: string
    /** 짧은 공유 링크 풀기 (시험·E2E는 가짜 — 틱톡에 나가지 않게, D-UX3-14) */
    readonly shortLinks?: ShortLinkResolver
  }
  /** 백업 저장소 (I2 D-I2-10 — 없으면 자동 백업이 꺼진다. 판매는 그대로) */
  readonly backupStorage?: BackupStorage | null
  /** 자동 백업 확인 주기 (기본 5분) */
  readonly backupIntervalMs?: number
  /**
   * E2E 기동만: 확인서 데이터 조회가 ?at=<UTC 밀리초>를 받아 그 만든 시각으로 데이터를 낸다(AC-I2-15 — 공유 그림 바이트를 같은 데이터의 Node 그림과 맞댈 때).
   * 운영 서버는 켜지 않는다(늘 서버 시계의 지금 시각). PDF·PNG·전원 PDF는 이 값과 상관없이 늘 지금 시각이다
   */
  readonly receiptAtParam?: boolean
  /** 무거운 파일 작업의 워커 풀 (기본: 프로세스에 하나 — RA-I2-003). 시험은 작은 풀을 넣을 수 있다 */
  readonly work?: WorkPools
  /** 자동 백업: 서버를 켠 뒤 첫 확인까지 (기본 3분, RA-I2-003) */
  readonly backupStartDelayMs?: number
  /** 입금 확인 설정 (N3): 시험 모드(가짜 원천 — E2E 기동만)·팝빌 전송(연동 키가 있을 때)·주기 덮어쓰기(E2E 기동만)·시험용 타이머 */
  readonly deposits?: DepositOptions
  /** 휴대폰 알림 받기 (SMS3): 1분 한도 덮어쓰기·주기 정리 타이머 (시험만) */
  readonly inbox?: { readonly rateLimit?: number; readonly sweepTimer?: GeneratorTimer; readonly authLimits?: LoginLimitOptions }
  /**
   * 택배 자동 접수 (T1, PARCEL_RULES): 이어진 택배사 어댑터(가짜 택배사 FAKE — E2E 기동·서버 시험만, 운영 기동은 비어 있다 → 설정에 "우체국 택배 — 준비 중"만)·
   * 조회 간격(기본 30분)·배송지 정리 간격(기본 1시간)·한 번에 접수할 때 동시에 보내는 수
   */
  readonly parcel?: ParcelOptions
  /**
   * 간편 로그인 (L1). 운영 기동은 productionServerOptions가 환경 변수로 공급자 ID·비밀값만 만든다(주소는 고정값).
   * 공급자 주소 바꾸기·http 허용·HTTP 함수·시간 제한은 시험·E2E·연습 기동만(가짜 OAuth 서버). 없거나 공급자가 없으면 꺼짐(지금과 같다)
   */
  readonly socialLogin?: SocialLoginSetup
  /** 가입 문자 인증 발송 (D-UX3-30). 없으면 문자 인증 없이 가입 표로 바로 가입한다 */
  readonly sms?: SmsSender | null
  /** 간편 로그인 시험 주입점 (쓴 표시 직후·로그인 연결을 찾은 뒤 세션 거래 전 — 동시 사용 시험) */
  readonly socialHooks?: { readonly afterClaim?: () => void | Promise<void>; readonly beforeLoginSession?: () => void | Promise<void> }
  /**
   * AI 확인 필요 제안 (A1, D-A1-04·D-A1-08). 운영 기동은 productionServerOptions가 환경 변수로 키·모델·상한만 만든다(주소는 고정 https://api.anthropic.com).
   * 주소 바꾸기·http 허용·어댑터 바꾸기는 시험·E2E·연습 기동만(가짜 LLM 서버). 없거나 키가 없으면 AI 제안을 쓸 수 없다(규칙 제안만 — 지금과 같다)
   */
  readonly assist?: AssistSetup
  /** AI 제안 시험 주입점 (호출 기록을 넣은 뒤 어댑터를 부르기 직전 — 동시·끄기 시험) */
  readonly assistHooks?: { readonly beforeCall?: () => void | Promise<void> }
}

export interface LivejjimServer {
  readonly voice: VoiceRelay
  readonly streamAudio: StreamAudioService
  readonly app: Hono
  readonly service: Service
  readonly writer: ScopeWriter
  readonly hub: StreamHub
  readonly auth: Auth
  /** 보기 캐시 상한 (판매자마다 4·서버 전체 32·10분, AC-S06b-12 — 시험·점검용) */
  readonly viewCaches: ViewCacheBudget
  /** 출력 기록과 출력 기기 (I1) */
  readonly print: PrintService
  /** 요금 (N5) */
  readonly billing: BillingService
  /** 인스타그램 계정 연결·라이브 연결·웹훅·감사 DM (N2) */
  readonly instagram: InstagramModule
  /** 틱톡 동의·아이디·연결·댓글 기록 (N2b-2) */
  readonly tiktok: TikTokLive
  /** 댓글 붙여넣기 (N2b-2) */
  readonly paste: PasteService
  /** 밴드 계정·글 연결·댓글 읽기 (BND1) */
  readonly band: BandService
  /** 정산 마무리 (I2) */
  readonly closing: ClosingService
  /** 구매자 확인서 공유 링크 (N4b) */
  readonly receiptLinks: ReceiptLinkService
  /** 매일 자동 백업 (I2 D-I2-10 — 시작은 backups.start(), 시험은 check()를 직접 부른다) */
  readonly backups: BackupScheduler
  /** 무거운 파일 작업의 워커 풀 (확인서 그림·PDF·전원 PDF·판매대장 엑셀·.xlsx 읽기) */
  readonly work: WorkPools
  /** 입금 확인 (N3) */
  readonly deposits: DepositService
  readonly inbox: InboxService
  /** 택배 자동 접수 (T1) — 주기 작업(조회·배송지 정리)은 start()가 돌린다 */
  readonly parcels: ParcelService
  /** 간편 로그인 (L1 — 설정이 없으면 켜진 공급자가 없다) */
  readonly social: SocialLogin
  /** 크롬 확장으로 채팅 읽기 (X1) */
  readonly extension: ExtensionService
  /** 크롬 확장으로 틱톡 댓글 읽기 (TTX) */
  readonly tiktokExtension: TikTokExtension
  /** AI 확인 필요 제안 (A1 — 키가 없으면 규칙 제안만) */
  readonly assist: AssistService
  /** 손님 기록·메모·설정 "손님 관리" (CRM1 — 판매자 계정만, 엔진 이벤트를 쓰지 않는다) */
  readonly customers: CustomerService
  /** 손님 기록 보관 차례 (CRM1 D-CRM1-12 — 서버 시작 때와 1시간마다, 봉인 전 취소 수·'입금 안 함'을 남긴다) */
  readonly customerArchiver: CustomerArchiver
  /** KP1 손님 장부 (동의·이어 쓰기·연결 코드·손님 표시·손님 엑셀 — 엔진 이벤트를 쓰지 않는다) */
  readonly ledger: LedgerService
  /** KP1 손님 장부·방송 일정 정리 (시작 때·1시간마다) */
  readonly ledgerSweeper: LedgerSweeper
  /** KP1 방송 리포트 (볼 때 계산 — 저장하지 않는다) */
  readonly report: ReportService
  /** KP1 방송 일정·공개 일정 페이지·알림 신청 (문자를 보내지 않는다) */
  readonly schedule: ScheduleService
  /** 결제 대기 자동 재확인 (PAY2 BL-6 9 — 서버 시작 때와 20초마다, 요금 기능이 켜져 있을 때만) */
  readonly billingRechecker: BillingRechecker
  /** 서버 안 채팅 수집 함수 (S05 리허설·S10 수집기, AC-S04-33) */
  ingestChat(sellerId: string, input: unknown): Promise<ChatIngestOutcome>
  /** 유튜브 연동 (설정이 있을 때만) */
  readonly youtube: YoutubeSystem | null
  /** 30일 봉인 작업 (AC-Y1-61) */
  readonly sealer: Sealer
  /** 워커를 돌린다: 유튜브 수집기·발송함, 봉인 작업 (서버 시작 때) */
  start(): void
  /** 워커를 멈춘다 (임대를 놓는다) */
  stop(): Promise<void>
  /** 실시간 연결을 닫고 리허설 생성기·타이머·워커·자동 백업 확인을 멈춘다 (DB는 닫지 않는다) */
  close(): void
  /** 경보 기록 (AC-I3-82) */
  readonly alerter: Alerter
  /** 워커 건강 (AC-I3-81·82) */
  readonly health: WorkerHealth
}

/** 마스터 키를 확인한다 (값은 오류 문장에 넣지 않는다) */
export function masterKeyBuffer(key: Buffer | string): Buffer {
  if (typeof key === 'string') {
    const read = readMasterKey(key)
    if (!read.ok) throw new TypeError(read.message)
    return read.key
  }
  if (key.length !== 32) throw new TypeError('서버 마스터 키는 32바이트여야 해요.')
  return Buffer.from(key)
}

export function createServer(options: ServerOptions): LivejjimServer {
  const masterKey = masterKeyBuffer(options.masterKey)
  if (!/^https?:\/\/[^/\s]+$/.test(options.appOrigin)) throw new TypeError('앱 주소는 https://example.com 처럼 경로 없이 적어 주세요.')
  const snapshotEvery = options.snapshotEvery ?? MAX_SNAPSHOT_EVERY
  if (!Number.isSafeInteger(snapshotEvery) || snapshotEvery < 1 || snapshotEvery > MAX_SNAPSHOT_EVERY) throw new TypeError('스냅샷 간격은 1~500이어야 해요.')
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 30_000) throw new TypeError('하트비트 간격은 30초 이내여야 해요.')
  const runtimeCacheMax = options.runtimeCacheMax ?? DEFAULT_RUNTIME_CACHE_MAX
  if (!Number.isSafeInteger(runtimeCacheMax) || runtimeCacheMax < 1) throw new TypeError('메모리에 두는 범위 수는 1 이상이어야 해요.')
  const changesWindow = options.changesWindow ?? DEFAULT_CHANGES_WINDOW
  if (!Number.isSafeInteger(changesWindow) || changesWindow < 1) throw new TypeError('증분 조회 기준점 수는 1 이상이어야 해요.')
  const generatorSpeed = options.generatorSpeed ?? 1
  if (!Number.isFinite(generatorSpeed) || generatorSpeed < 1 || generatorSpeed > 1000) throw new TypeError('생성기 시험 속도는 1~1000이어야 해요.')
  const hostActionDelayMs = options.hostActionDelayMs ?? HOST_ACTION_DELAY_MS
  if (!Number.isSafeInteger(hostActionDelayMs) || hostActionDelayMs < 0 || hostActionDelayMs > HOST_ACTION_DELAY_MS) throw new TypeError('방송자 조치 대기 시간은 0~5000밀리초여야 해요.')

  if (options.youtube !== undefined) {
    const problem = checkYoutubeConfig(options.youtube)
    if (problem !== null) throw new TypeError(problem)
  }

  if (options.socialLogin !== undefined) {
    const problem = checkSocialSetup(options.socialLogin)
    if (problem !== null) throw new TypeError(problem)
  }

  if (options.assist !== undefined) {
    const problem = checkAssistSetup(options.assist)
    if (problem !== null) throw new TypeError(problem)
  }

  if (options.opsToken !== undefined && options.opsToken.trim().length < 32) throw new TypeError('운영 토큰은 32자 이상이어야 해요.')
  if (options.webDir !== undefined && webDirProblem(options.webDir) !== null) throw new TypeError('화면 폴더에 index.html이 없어요.')
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS

  const db = options.database.db
  const clock = options.clock ?? systemClock
  const timer = options.timer ?? realTimer(clock)
  const ids: IdSource = { ...randomIds, ...options.ids }
  const baseLog = safeSink(options.log ?? stderrLog)
  // 경보 (AC-I3-82): 남기던 로그에서 꺼내고(observe), 경보 자체는 그대로 기록에 쓴다
  const alerter = new Alerter(baseLog, clock)
  const log: LogSink = (record) => {
    baseLog(record)
    try {
      alerter.observe(record)
    } catch {
      // 경보를 못 써도 처리는 계속한다
    }
  }
  const health = new WorkerHealth(alerter, clock)
  for (const code of options.startupWarnings ?? []) log({ level: 'warn', code })
  const startedAt = new Date(clock.now()).toISOString()
  const engine: EngineAdapter = options.engine ?? { applyEvent }
  const trustedProxies = options.trustedProxies ?? 0
  if (!Number.isSafeInteger(trustedProxies) || trustedProxies < 0 || trustedProxies > 5) throw new TypeError('믿는 프록시 수는 0~5여야 해요.')
  const auth = new Auth({
    db,
    clock,
    limitSecret: loginLimitSecret(masterKey),
    log,
    ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }),
    ...(options.loginLimits === undefined ? {} : { loginLimits: options.loginLimits }),
    ...(options.passwordVerifier === undefined ? {} : { verify: options.passwordVerifier }),
  })
  const voiceAliases = new VoiceAliases(db)
  const streamSetting = options.streamAudio
  // 허용하지 않는 프록시 값은 쓰지 않고(바로 나감 → 데이터센터면 막힘 → 휴대폰 마이크 안내) 시작 기록 한 줄. 판매는 그대로 한다
  if (streamSetting?.on === true && streamSetting.mediaProxy?.kind === 'rejected') log({ level: 'warn', code: 'STREAM_AUDIO_PROXY_IGNORED' })
  const mediaProxy = streamSetting?.mediaProxy?.kind === 'ok' ? streamSetting.mediaProxy.url : null
  let streamFeed: AudioFeed | null = streamSetting?.feed ?? null
  if (streamSetting?.on === true && streamFeed === null) {
    if (ffmpegAvailable()) streamFeed = new FfmpegAudioFeed('ffmpeg', mediaProxy)
    else log({ level: 'warn', code: 'STREAM_AUDIO_NO_FFMPEG' })
  }
  const streamResolve = streamSetting?.ytDlpPath === undefined ? null : ytDlpResolver(streamSetting.ytDlpPath, undefined, mediaProxy)
  // 틱톡 라이브 소리 (D-UX3-16): 프록시 없이 바로. 라이브 시작 전에는 15초마다만 묻는다
  const tiktokResolve = streamSetting?.ytDlpPath === undefined ? null : notLiveBackoff(ytDlpTiktokResolver(streamSetting.ytDlpPath), () => clock.now())
  const streamAudio = new StreamAudioService({
    available: streamSetting?.on === true && streamFeed !== null,
    feed: streamFeed ?? { open: (_url, sink) => { queueMicrotask(() => sink.fail()); return { close: () => {} } } },
    locate: streamSetting?.locate ?? ((sellerId, b) => webStreamLocator(db, youtube?.web ?? null, { resolve: streamResolve, tiktok: tiktokResolve, log })(sellerId, b)),
    clock,
    log,
    sellerOn: (sellerId) => sellerStreamAudioOn(db, sellerId),
    ...(streamSetting?.schedule === undefined ? {} : { schedule: streamSetting.schedule }),
  })
  const voice = new VoiceRelay({ auth, db, appOrigin: options.appOrigin, oldAppOrigins: options.oldAppOrigins ?? [], clock, log, onMicChange: (sellerId, active) => streamAudio.micChanged(sellerId, active), reading: (context) => readingFactory({ db, service, writer, clock, aliases: voiceAliases, ...(options.voiceHistoryObserver === undefined ? {} : { historyObserver: options.voiceHistoryObserver }) })(context), ...(options.transcribeWorkerToken === undefined ? {} : { workerToken: options.transcribeWorkerToken }) })
  let print: PrintService | null = null
  let writerRef: ScopeWriter | null = null
  const billing = new BillingService({
    db,
    setup: options.billing ?? DISABLED_BILLING,
    clock,
    masterKey,
    log,
    publish: (sellerId, data) => hub.publishBilling(sellerId, data),
    readState: async (sellerId, date) => (await (writerRef as ScopeWriter).read(sellerId, date)).state,
  })
  let instagram: InstagramModule | null = null
  let tiktok: TikTokLive | null = null
  let band: BandService | null = null
  /** 라이브 연결 판매자 잠금 — 모든 플랫폼 공통 (D-N2b-2-01) */
  const liveLocks = new SellerLocks()
  const hub = new StreamHub({
    heartbeatMs,
    log,
    sessionAlive: (hash) => auth.alive(hash),
    // 출력 기기의 실시간 연결이 열리고 닫히면 다른 기기에 대기열 요약을 알린다 (AC-I1-10·15)
    onDevice: (sellerId, deviceId) => {
      void readQueue(db, sellerId)
        .then((queue) => {
          if (queue?.deviceId === deviceId) print?.notifyQueue(sellerId)
        })
        .catch((error: unknown) => log({ level: 'warn', code: 'PRINT_NOTIFY_FAILED', errorKind: errorKind(error) }))
    },
  })
  const viewCaches = new ViewCacheBudget({ now: () => clock.now() })
  const writer = new ScopeWriter({
    db,
    engine,
    clock,
    ids,
    log,
    hooks: options.hooks ?? {},
    snapshotEvery,
    runtimeCacheMax,
    changesWindow,
    onCommit: (sellerId, date, rehearsal, records) => {
      hub.publish(sellerId, records.map((record) => ({ date, rehearsal, seq: record.seq, type: record.type })))
      youtube?.onCommit(sellerId, rehearsal, records)
      for (const record of records) if (record.changed && record.event.type === 'broadcast.end') { voice.endBroadcast(sellerId, record.event.b); streamAudio.endBroadcast(sellerId, record.event.b) }
      voice.refreshSeller(sellerId)
      // 마지막 조회 뒤 10분이 지난 범위의 보기 캐시를 비운다 (커밋 뒤 — 항목이 많아야 33개, AC-S06b-12)
      viewCaches.sweep()
    },
    onDrop: (runtime) => viewCaches.release(runtime),
    // 효과 → 출력 작업·라벨 폐기(L-11 2·5), 인스타그램 회차의 감사 효과 → DM 행(N2), 주문 건 쓰기(N5 BL-5 2)를 이벤트 기록과 같은 트랜잭션에서
    // 여러 플랫폼 회차의 감사 경로(N2b-2) — 틱톡 구매자·보낼 곳 없는 감사는 건너뜀, 회차를 끝내면 틱톡 연결 ENDED(N2b-2)
    txHook: async (tx, ctx) => {
      const printed = await (print as PrintService).txHook(tx, ctx)
      const dm = await (instagram as InstagramModule).txHook(tx, ctx)
      await routeThanks(tx, ctx)
      const billed = await billing.txHook(tx, ctx)
      const ended = await (tiktok as TikTokLive).txHook(tx, ctx)
      // 회차를 끝내면 밴드 글 연결 FINISHED(ENDED) — 같은 트랜잭션, 커밋 뒤 읽기를 멈춘다 (BND1 AC-BND1-23)
      const bandEnded = await (band as BandService).txHook(tx, ctx)
      // KP1 채팅 연결 코드: 트랜잭션 안에서는 고르기만, 커밋 뒤 읽는다 (판정·기록에 영향 없음, CR-5)
      const ledgerAfter = await ledger.txHook(tx, ctx)
      const after = [billed, printed, dm, ended, bandEnded, ledgerAfter].filter((fn): fn is () => void => fn !== null)
      if (after.length === 0) return null
      return () => {
        for (const fn of after) fn()
      }
    },
  })
  writerRef = writer
  print = new PrintService({
    db,
    writer,
    clock,
    log,
    publish: (sellerId, data) => hub.publishPrint(sellerId, data),
    publishLabels: (sellerId, data) => hub.publishLabels(sellerId, data),
    deviceLive: (sellerId, deviceId) => hub.deviceLive(sellerId, deviceId),
    // 라벨 장 쓰기 (N5 BL-5 3): 상품 라벨 출력함과 같은 트랜잭션
    onPrinted: billing.onLabelPrinted,
  })
  const printService = print
  const assist = new AssistService({
    db,
    writer,
    clock,
    masterKey,
    log,
    setup: options.assist ?? null,
    ...(options.assistHooks === undefined ? {} : { hooks: options.assistHooks }),
  })
  const service = new Service({
    assist,
    db,
    writer,
    masterKey,
    clock,
    ids,
    viewCaches,
    generatorSpeed,
    onGenerator: (sellerId, payload) => hub.publishGenerator(sellerId, payload),
    log,
    billing,
    ...(options.generatorTimer === undefined ? {} : { generatorTimer: options.generatorTimer }),
  })
  const backups = new BackupScheduler({
    db,
    storage: options.backupStorage ?? null,
    clock,
    log,
    ...(options.backupIntervalMs === undefined ? {} : { intervalMs: options.backupIntervalMs }),
    ...(options.backupStartDelayMs === undefined ? {} : { startDelayMs: options.backupStartDelayMs }),
  })
  const work = options.work ?? sharedWorkPools()
  const closing = new ClosingService({ db, writer, clock, hub, backups, log, work })
  const customers = new CustomerService({ db, writer, clock, log, masterKey })
  const customerArchiver = new CustomerArchiver({ db, writer, timer, log, facts: customers.factsDeps() })
  // KP1 손님 장부 — 손님 자세히에 장부 칸을 건다
  const ledger = new LedgerService({ db, clock, masterKey, hub, log, customers, readState: async (sellerId, date) => (await writer.read(sellerId, date, false)).state, work: work.documents }) // KP1 RA-KP1-008 손님 엑셀은 documents 풀
  customers.useLedger((sellerId, marker) => ledger.customerLedger(sellerId, marker))
  const ledgerSweeper = new LedgerSweeper({ ledger, timer, log, schedule: (now) => sweepSchedule(db, now) })
  // KP1 방송 리포트·방송 일정
  const report = new ReportService({ db, writer, log, facts: customers.factsDeps() })
  const schedule = new ScheduleService({ db, clock, masterKey, appOrigin: options.appOrigin })
  const billingRechecker = new BillingRechecker({ billing, timer, log })
  // 구매자 확인서 공유 링크 (N4b) — 링크 주소 = 앱 주소 + /r/<토큰>
  const receiptLinks = new ReceiptLinkService({ db, writer, clock, masterKey, appOrigin: options.appOrigin, closing, log })
  const publishYoutube = (sellerId: string, data: Readonly<Record<string, unknown>>) => hub.publishYoutube(sellerId, data)
  // 크롬 확장으로 감사 채팅 올리기 (X1 AC11~AC17) — 공식 발송함 실행기가 공식으로 올릴 수 없는 회차의 감사를 맡긴다
  const extensionThanks = new ExtensionThanks({ db, timer, log, writer, publishOutbox: publishYoutube })
  const youtube: YoutubeSystem | null =
    options.youtube === undefined
      ? null
      : new YoutubeSystem({
          db,
          masterKey,
          timer,
          log,
          writer,
          service,
          config: options.youtube,
          publish: publishYoutube,
          ...(options.instanceName === undefined ? {} : { owner: options.instanceName }),
          ...(options.youtubeFetch === undefined ? {} : { fetch: options.youtubeFetch }),
          ...(options.collectorHooks === undefined ? {} : { collectorHooks: options.collectorHooks }),
          ...(options.outboxHooks === undefined ? {} : { outboxHooks: options.outboxHooks }),
          ...(options.linkHooks === undefined ? {} : { linkHooks: options.linkHooks }),
          ...(options.collectorTiming === undefined ? {} : { collectorTiming: options.collectorTiming }),
          ...(options.outboxTiming === undefined ? {} : { outboxTiming: options.outboxTiming }),
          outboxExtension: {
            route: (sellerId, broadcastId) => extensionThanks.route(sellerId, broadcastId),
            sweep: () => extensionThanks.sweep(),
          },
          health,
        })
  const sealer = new Sealer({
    db,
    writer,
    timer,
    log,
    onSealed: (sellerId, date) => publishYoutube(sellerId, { kind: 'sealed', date }),
    ...(options.sealHooks === undefined ? {} : { hooks: options.sealHooks }),
    onPass: (ok) => health.pass('sealer', ok),
  })
  // DB가 시간 안에 답하는지 (준비 확인·운영 상태)
  const dbAlive = async (): Promise<boolean> => {
    const probe = (options.dbPing ?? (() => ping(db)))().then(
      () => true,
      () => false,
    )
    let handle: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<boolean>((resolve) => {
      handle = setTimeout(() => resolve(false), readyTimeoutMs)
      handle.unref?.()
    })
    const ok = await Promise.race([probe, late])
    clearTimeout(handle)
    return ok
  }
  const opsStatus = async (): Promise<Record<string, unknown>> => {
    const now = clock.now()
    const date = kstDate(now)
    const dayStart = new Date(Date.parse(`${date}T00:00:00+09:00`))
    const dbOk = await dbAlive()
    const counts = async <T>(read: () => Promise<T>): Promise<T | null> => {
      if (!dbOk) return null
      try {
        return await read()
      } catch {
        return null
      }
    }
    return {
      version: SERVER_VERSION,
      transcribe: voice.status(),
      startedAt,
      db: dbOk ? 'ok' : 'unavailable',
      workers: health.view(),
      collectors: await counts(() => collectorCounts(db)),
      outbox: await counts(async () => ({ date, ...(await outboxCounts(db, dayStart, new Date(dayStart.getTime() + 24 * 60 * 60 * 1000))) })),
      failedEvents24h: await counts(() => failedEventCount(db, new Date(now - 24 * 60 * 60 * 1000))),
      realtimeConnections: hub.size,
      quota: youtube === null ? null : await counts(() => youtube.quota.projectToday()),
      // 서버 웹 읽기 합계 (YT-11 AC5): 스위치·수집기·받는 중·막힘·모르는 모양 수, 이 서버의 분당 유튜브 요청 수 (판매자 정보 없음)
      youtubeWebChat: youtube === null ? null : await counts(() => youtube.webChatOps()),
      // 인스타 DM 행은 유튜브 발송함 수와 따로 상태별로, 틱톡은 이어진 연결 수와 이 서버 연결 객체의 상태별 수 (판매자 정보 없이, AC-N2b-2-70)
      instagramDm: await counts(() => instagramDmCounts(db, dayStart, new Date(dayStart.getTime() + 24 * 60 * 60 * 1000))),
      tiktok: { operator: (tiktok as TikTokLive).operatorOn, links: await counts(() => tiktokLinkCounts(db)), connections: (tiktok as TikTokLive).stateCounts() },
      // 밴드 글 연결 수(상태별)·앱 전체 호출 한도 쉼 (판매자 정보 없이, AC-BND1-64)
      band: await counts(() => (band as BandService).opsStatus()),
      loginRejected: auth.loginRejections,
    }
  }
  instagram = createInstagram({
    db,
    writer,
    service,
    clock,
    log,
    masterKey,
    appOrigin: options.appOrigin,
    settings: options.instagram ?? null,
    publish: (sellerId, data) => hub.publishInstagram(sellerId, data),
    ...(options.liveTimer === undefined ? {} : { timer: options.liveTimer }),
    ...(options.dmAutoRun === undefined ? {} : { dmAutoRun: options.dmAutoRun }),
    ...(options.collectionIntervalMs === undefined ? {} : { collectionIntervalMs: options.collectionIntervalMs }),
    locks: liveLocks,
  })
  const instagramModule = instagram
  const tiktokOptions = options.tiktok ?? {}
  tiktok = new TikTokLive({
    db,
    writer,
    clock,
    log,
    locks: liveLocks,
    webcast: tiktokOptions.webcast ?? libraryWebcast(),
    publish: (sellerId, data) => hub.publishTiktok(sellerId, data),
    ...(tiktokOptions.settings === undefined ? {} : { settings: tiktokOptions.settings }),
    ...(tiktokOptions.libraryEnv === undefined ? {} : { libraryEnv: tiktokOptions.libraryEnv }),
    ...(tiktokOptions.clock === undefined ? {} : { tiktokClock: tiktokOptions.clock }),
    ...(tiktokOptions.limiter === undefined ? {} : { limiter: tiktokOptions.limiter }),
    ...(tiktokOptions.noticeVersion === undefined ? {} : { noticeVersion: tiktokOptions.noticeVersion }),
    ...(tiktokOptions.shortLinks === undefined ? {} : { shortLinks: tiktokOptions.shortLinks }),
  })
  const tiktokLive = tiktok
  const bandOptions = options.band ?? {}
  band = new BandService({
    db,
    clock,
    log,
    masterKey,
    appOrigin: options.appOrigin,
    settings: bandOptions.settings ?? null,
    locks: liveLocks,
    record: (job) => recordPlatformChats(writer, job),
    readState: async (sellerId, date) => (await writer.read(sellerId, date, false)).state,
    publish: (sellerId, data) => hub.publishBand(sellerId, data),
    ...(bandOptions.clock === undefined ? {} : { bandClock: bandOptions.clock }),
    ...(bandOptions.timing === undefined ? {} : { timing: bandOptions.timing }),
    ...(bandOptions.fetch === undefined ? {} : { fetch: bandOptions.fetch }),
    ...(bandOptions.hooks === undefined ? {} : { hooks: bandOptions.hooks }),
  })
  const bandService = band
  const paste = new PasteService({ db, writer })
  const deposits = new DepositService({
    db,
    writer,
    clock,
    masterKey,
    log,
    publish: (sellerId, data) => hub.publishDeposit(sellerId, data),
    options: options.deposits ?? {},
  })
  // 휴대폰 알림 받기 (SMS3 ORD-13·PAY-02): 손님 문자 → 지금의 sms 이벤트, 은행 알림 → 입금 확인
  const inbox = new InboxService({
    db,
    service,
    writer,
    deposits,
    clock,
    masterKey,
    log,
    publish: (sellerId, data) => hub.publishInbox(sellerId, data),
    ...(options.inbox?.rateLimit === undefined ? {} : { rateLimit: options.inbox.rateLimit }),
    timer: options.inbox?.sweepTimer ?? realGeneratorTimer,
  })
  const parcels = new ParcelService({ db, writer, clock, timer, masterKey, hub, log, work, options: options.parcel ?? {}, ledger })
  // 크롬 확장으로 채팅 읽기 (X1 YT-10 — 읽기만, 공식 수집기와 같은 '채팅' 이벤트)
  // 크롬 확장으로 틱톡 댓글 읽기 (TTX — 직접 연결의 대비책, 같은 '채팅' 이벤트·같은 틱톡 연결 조건)
  const tiktokExtension = new TikTokExtension({ db, writer, clock, log, live: tiktokLive })
  const extension = new ExtensionService({
    db,
    service,
    timer,
    log,
    thanks: extensionThanks,
    publish: (sellerId, view) => {
      hub.publishExtension(sellerId, { ...view })
      // 확장 연결이 생기거나 끊기면 틱톡 칸의 막혔을 때 안내(D-TTX-17)가 바뀔 수 있다
      void tiktokExtension.tokenChanged(sellerId)
    },
    onDisconnected: (sellerId) => tiktokExtension.disconnected(sellerId),
  })
  const social = new SocialLogin({
    db,
    masterKey,
    clock,
    appOrigin: options.appOrigin,
    setup: options.socialLogin ?? { providers: {} },
    sms: options.sms ?? null,
    auth,
    log,
    ...(options.loginLimits === undefined ? {} : { loginLimits: options.loginLimits }),
    onChanged: (sellerId) => hub.publishNamed(sellerId, 'login', { kind: 'methods' }),
    closeSessions: (hashes) => {
      for (const hash of hashes) hub.closeSession(hash)
    },
    ...(options.socialHooks === undefined ? {} : { hooks: options.socialHooks }),
  })
  const app = createApp({
    logError: (error) => log({ level: 'error', code: 'REQUEST_FAILED', errorKind: errorKind(error) }),
    api: {
      service,
      closing,
      receiptLinks,
      auth,
      hub,
      print: printService,
      voiceAliases,
      streamAudio: { db, service: streamAudio },
      billing,
      instagram: instagramModule,
      tiktok: { db, live: tiktokLive, paste },
      band: bandService,
      deposits,
      inbox,
      parcels: { service: parcels, db },
      appOrigin: options.appOrigin,
      oldAppOrigins: options.oldAppOrigins ?? [],
      clientConfig: { hostActionDelayMs, testPrinter: options.testPrinter === true },
      receiptAtParam: options.receiptAtParam === true,
      youtube,
      sealer,
      trustedProxies,
      social,
      extension,
      assist,
      customers,
      // KP1
      ledger,
      report,
      schedule,
    },
    extension: createExtensionApp({ extension, clock, trustedProxies, address: connectionAddress, tiktok: tiktokExtension, ...(options.extensionCodeLimits === undefined ? {} : { codeLimits: options.extensionCodeLimits }) }) as unknown as Hono,
    https: options.appOrigin.startsWith('https://'),
    web: options.webDir === undefined ? null : createWebServer(options.webDir),
    ready: async () => {
      const ok = await dbAlive()
      if (!ok) alerter.alert('DB_UNAVAILABLE')
      return ok
    },
    ops: { token: options.opsToken === undefined ? null : options.opsToken.trim(), status: opsStatus },
    webhooks: createWebhookApp(instagramModule),
    inbox: (app) =>
      registerInboxIntake(app, inbox, log, { clock, trustedProxies, address: connectionAddress, ...(options.inbox?.authLimits === undefined ? {} : { authLimits: options.inbox.authLimits }) }),
    receiptPage: (app) => {
      registerReceiptPage(app, { db, links: receiptLinks, closing, clock, parcels, appOrigin: options.appOrigin, writer, ledger })
      // KP1 공개 방송 일정 페이지 /s/<토큰> (화면 문서보다 먼저)
      registerSchedulePage(app, { db, schedule, clock, appOrigin: options.appOrigin, trustedProxies })
    },
  })
  registerVoiceRelay(app, voice)
  streamAudio.attach(voice)
  // 저장된 켜진 원천의 받아 오기 주기를 건다 (실패해도 서버는 뜬다 — 원천 실패는 판매를 멈추지 않는다, DP-0 5)
  deposits.start()
  // 휴대폰 알림 받기 주기 정리 (처리 안 한 카드 24시간·은행 알림 줄 30일 — C-07·D-SMS3-17)
  inbox.start()
  const stop = async () => {
    await Promise.all([youtube?.stop(), sealer.stop(), customerArchiver.stop(), parcels.stop(), ledgerSweeper.stop(), billingRechecker.stop()])
  }
  return {
    app,
    voice,
    streamAudio,
    service,
    writer,
    hub,
    auth,
    youtube,
    sealer,
    viewCaches,
    print: printService,
    billing,
    instagram: instagramModule,
    tiktok: tiktokLive,
    paste,
    band: bandService,
    closing,
    receiptLinks,
    backups,
    work,
    deposits,
    inbox,
    parcels,
    social,
    extension,
    tiktokExtension,
    assist,
    customers,
    customerArchiver,
    // KP1 손님 장부
    ledger,
    ledgerSweeper,
    report,
    schedule,
    billingRechecker,
    ingestChat: (sellerId, input) => service.ingestChat(sellerId, input),
    start: () => {
      youtube?.start()
      sealer.start()
      customerArchiver.start()
      // KP1 손님 장부·방송 일정 정리 (시작 때·1시간마다)
      ledgerSweeper.start()
      // 결제 대기 자동 재확인 — 꺼져 있던 동안 지난 칸은 한 번만 (BL-6 9)
      billingRechecker.start()
      // 택배 배송 조회(30분마다)·배송지 30일 정리 (T1 PC-8·PC-3)
      parcels.start()
      // 끝나지 않은 실제 회차의 이어진 틱톡 연결을 이어받는다 (NFR-03, AC-N2b-2-35)
      void tiktokLive.resume()
      // 확장 틱톡 상태의 "조용함"·"읽지 못함" 예약을 다시 건다 (RA-TTX-03)
      void tiktokExtension.resume()
      // 끝나지 않은 실제 회차의 밴드 글 연결을 다시 읽는다 · 보관 기간 지난 밴드 알림 글 지우기 (BND1 AC-BND1-23·41)
      void bandService.resume()
    },
    stop,
    close: () => {
      streamAudio.close()
      voice.close()
      service.generators.closeAll()
      printService.close()
      instagramModule.close()
      tiktokLive.close()
      bandService.close()
      deposits.close()
      inbox.close()
      extension.close()
      tiktokExtension.close()
      hub.closeAll()
      backups.stop()
      void stop()
    },
    alerter,
    health,
  }
}
