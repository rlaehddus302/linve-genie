// 서버 조립 (S04·S05): DB·마스터 키·앱 주소를 받아 기록 경로·서비스·로그인·실시간 알림·리허설 생성기·HTTP 앱을 만든다.
// 시험(단위·적대)은 PGlite로 열어 createServer(...).app.request(...)로 포트 없이 요청한다.
// 시험용 주입점: clock(서버 시계), ids(ID 생성), hooks(저장 실패·응답 전 멈춤·스냅샷 실패), engine(엔진 감싸기), log(로그 수집), runtimeCacheMax(범위 상태 메모리 상한),
// changesWindow(증분 조회 기준점 수), generatorTimer·generatorSpeed(리허설 생성기 타이머·시험 속도), hostActionDelayMs(화면의 방송자 조치 대기 — E2E 기동만 줄인다),
// testPrinter(시험 모드 신호 — 화면이 시험용 프린터를 켠다. E2E 기동만 켠다, 운영 기동은 production.ts가 늘 끈다 — I1 L-11 15).
// I1: 출력 기록(PrintService)을 기록 경로의 같은 트랜잭션(txHook)에 잇고, 실시간 알림(print)·출력 기기 실시간 연결 여부를 허브에 잇는다.
// N4a: 라벨 기능 켬/끔 알림(labels)을 허브에 잇는다.
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
import type { GeneratorTimer } from './generator.ts'
import { PrintService } from './print.ts'
import type { InstagramSettings } from './instagram/config.ts'
import { createInstagram, type InstagramModule } from './instagram/index.ts'
import type { LiveTimer } from './instagram/notices.ts'
import { createWebhookApp } from './instagram/routes.ts'
import { readQueue } from './print-store.ts'
import { DEFAULT_CHANGES_WINDOW } from './runtime.ts'
import { Service, type ChatIngestOutcome } from './service.ts'
import { kstDate, systemClock, type Clock } from './time.ts'
import { ViewCacheBudget } from './view-budget.ts'
import { sharedWorkPools, type WorkPools } from './work-pool.ts'
import { DEFAULT_RUNTIME_CACHE_MAX, ScopeWriter, type WriterHooks } from './writer.ts'
import type { CollectorHooks } from './youtube/collector.ts'
import type { OutboxHooks, OutboxTiming } from './youtube/outbox.ts'
import { Sealer } from './youtube/seal.ts'
import { YoutubeSystem, checkYoutubeConfig, type LinkHooks, type YoutubeConfig } from './youtube/system.ts'
import { realTimer, type Timer } from './youtube/timer.ts'

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
  readonly database: Pick<Database, 'db'>
  /** 서버 마스터 키 (32바이트 또는 그 base64). 형식이 틀리면 만들지 않는다 */
  readonly masterKey: Buffer | string
  /** 화면 앱 주소 (상태를 바꾸는 요청의 Origin과 같아야 한다) */
  readonly appOrigin: string
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
  /** 인스타그램 연동 설정 (N2). 없으면 인스타그램 기능은 NOT_CONFIGURED, 웹훅은 503 (AC-N2-17) */
  readonly instagram?: InstagramSettings | null
  /** 인스타그램 알림·DM 실행기 예약 (시험은 기다리지 않는 타이머를 넣는다) */
  readonly liveTimer?: LiveTimer
  /** DM 실행기를 스스로 돌린다 (기본 true. 시험은 끄고 instagram.dms.drain()을 부른다) */
  readonly dmAutoRun?: boolean
  /** 수집 상태 알림 간격 (기본 1000밀리초 — 시험만 줄인다) */
  readonly collectionIntervalMs?: number
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
}

export interface LivejjimServer {
  readonly app: Hono
  readonly service: Service
  readonly writer: ScopeWriter
  readonly hub: StreamHub
  readonly auth: Auth
  /** 보기 캐시 상한 (판매자마다 4·서버 전체 32·10분, AC-S06b-12 — 시험·점검용) */
  readonly viewCaches: ViewCacheBudget
  /** 출력 기록과 출력 기기 (I1) */
  readonly print: PrintService
  /** 인스타그램 계정 연결·라이브 연결·웹훅·감사 DM (N2) */
  readonly instagram: InstagramModule
  /** 정산 마무리 (I2) */
  readonly closing: ClosingService
  /** 매일 자동 백업 (I2 D-I2-10 — 시작은 backups.start(), 시험은 check()를 직접 부른다) */
  readonly backups: BackupScheduler
  /** 무거운 파일 작업의 워커 풀 (확인서 그림·PDF·전원 PDF·판매대장 엑셀·.xlsx 읽기) */
  readonly work: WorkPools
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
  let print: PrintService | null = null
  let instagram: InstagramModule | null = null
  const hub = new StreamHub({
    heartbeatMs,
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
      // 마지막 조회 뒤 10분이 지난 범위의 보기 캐시를 비운다 (커밋 뒤 — 항목이 많아야 33개, AC-S06b-12)
      viewCaches.sweep()
    },
    onDrop: (runtime) => viewCaches.release(runtime),
    // 효과 → 출력 작업·라벨 폐기(L-11 2·5), 인스타그램 회차의 감사 효과 → DM 행(N2)을 이벤트 기록과 같은 트랜잭션에서
    txHook: async (tx, ctx) => {
      const printed = await (print as PrintService).txHook(tx, ctx)
      const dm = await (instagram as InstagramModule).txHook(tx, ctx)
      if (printed === null) return dm
      if (dm === null) return printed
      return () => {
        printed()
        dm()
      }
    },
  })
  print = new PrintService({
    db,
    writer,
    clock,
    log,
    publish: (sellerId, data) => hub.publishPrint(sellerId, data),
    publishLabels: (sellerId, data) => hub.publishLabels(sellerId, data),
    deviceLive: (sellerId, deviceId) => hub.deviceLive(sellerId, deviceId),
  })
  const printService = print
  const service = new Service({
    db,
    writer,
    masterKey,
    clock,
    ids,
    viewCaches,
    generatorSpeed,
    onGenerator: (sellerId, payload) => hub.publishGenerator(sellerId, payload),
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
  const publishYoutube = (sellerId: string, data: Readonly<Record<string, unknown>>) => hub.publishYoutube(sellerId, data)
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
      startedAt,
      db: dbOk ? 'ok' : 'unavailable',
      workers: health.view(),
      collectors: await counts(() => collectorCounts(db)),
      outbox: await counts(async () => ({ date, ...(await outboxCounts(db, dayStart, new Date(dayStart.getTime() + 24 * 60 * 60 * 1000))) })),
      failedEvents24h: await counts(() => failedEventCount(db, new Date(now - 24 * 60 * 60 * 1000))),
      realtimeConnections: hub.size,
      quota: youtube === null ? null : await counts(() => youtube.quota.projectToday()),
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
  })
  const instagramModule = instagram
  const app = createApp({
    logError: (error) => log({ level: 'error', code: 'REQUEST_FAILED', errorKind: errorKind(error) }),
    api: {
      service,
      closing,
      auth,
      hub,
      print: printService,
      instagram: instagramModule,
      appOrigin: options.appOrigin,
      clientConfig: { hostActionDelayMs, testPrinter: options.testPrinter === true },
      receiptAtParam: options.receiptAtParam === true,
      youtube,
      sealer,
      trustedProxies,
    },
    https: options.appOrigin.startsWith('https://'),
    web: options.webDir === undefined ? null : createWebServer(options.webDir),
    ready: async () => {
      const ok = await dbAlive()
      if (!ok) alerter.alert('DB_UNAVAILABLE')
      return ok
    },
    ops: { token: options.opsToken === undefined ? null : options.opsToken.trim(), status: opsStatus },
    webhooks: createWebhookApp(instagramModule),
  })
  const stop = async () => {
    await Promise.all([youtube?.stop(), sealer.stop()])
  }
  return {
    app,
    service,
    writer,
    hub,
    auth,
    youtube,
    sealer,
    viewCaches,
    print: printService,
    instagram: instagramModule,
    closing,
    backups,
    work,
    ingestChat: (sellerId, input) => service.ingestChat(sellerId, input),
    start: () => {
      youtube?.start()
      sealer.start()
    },
    stop,
    close: () => {
      service.generators.closeAll()
      printService.close()
      instagramModule.close()
      hub.closeAll()
      backups.stop()
      void stop()
    },
    alerter,
    health,
  }
}
