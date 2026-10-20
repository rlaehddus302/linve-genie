// 서버 조립 (S04·S05): DB·마스터 키·앱 주소를 받아 기록 경로·서비스·로그인·실시간 알림·리허설 생성기·HTTP 앱을 만든다.
// 시험(단위·적대)은 PGlite로 열어 createServer(...).app.request(...)로 포트 없이 요청한다.
// 시험용 주입점: clock(서버 시계), ids(ID 생성), hooks(저장 실패·응답 전 멈춤·스냅샷 실패), engine(엔진 감싸기), log(로그 수집), runtimeCacheMax(범위 상태 메모리 상한),
// changesWindow(증분 조회 기준점 수), generatorTimer·generatorSpeed(리허설 생성기 타이머·시험 속도), hostActionDelayMs(화면의 방송자 조치 대기 — E2E 기동만 줄인다),
// testPrinter(시험 모드 신호 — 화면이 시험용 프린터를 켠다. E2E 기동만 켠다, 운영 기동은 production.ts가 늘 끈다 — I1 L-11 15).
// I1: 출력 기록(PrintService)을 기록 경로의 같은 트랜잭션(txHook)에 잇고, 실시간 알림(print)·출력 기기 실시간 연결 여부를 허브에 잇는다.
import { applyEvent } from '@livejjim/core'
import type { Hono } from 'hono'
import { Auth } from './auth.ts'
import { createApp } from './app.ts'
import type { Database } from './db/database.ts'
import { StreamHub } from './hub.ts'
import { randomIds, type IdSource } from './ids.ts'
import { errorKind, safeSink, stderrLog, type LogSink } from './log.ts'
import type { EngineAdapter } from './runtime.ts'
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
import { systemClock, type Clock } from './time.ts'
import { ViewCacheBudget } from './view-budget.ts'
import { DEFAULT_RUNTIME_CACHE_MAX, ScopeWriter, type WriterHooks } from './writer.ts'

/** 스냅샷 간격 상한 (AC-S04-28: 일정 이벤트 수, 최대 500) */
export const MAX_SNAPSHOT_EVERY = 500
/** 하트비트 기본 간격 (30초 이내, AC-S04-60) */
export const DEFAULT_HEARTBEAT_MS = 15_000
/** 화면이 방송자 조치(host.*)를 보내기 전에 기다리는 시간 — 운영 값 5초 (D-083, AC-S05-41) */
export const HOST_ACTION_DELAY_MS = 5000

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
  /** 서버 안 채팅 수집 함수 (S05 리허설·S10 수집기, AC-S04-33) */
  ingestChat(sellerId: string, input: unknown): Promise<ChatIngestOutcome>
  /** 실시간 연결을 닫고 리허설 생성기·타이머를 멈춘다 (DB는 닫지 않는다) */
  close(): void
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

  const db = options.database.db
  const clock = options.clock ?? systemClock
  const ids: IdSource = { ...randomIds, ...options.ids }
  const log = safeSink(options.log ?? stderrLog)
  const engine: EngineAdapter = options.engine ?? { applyEvent }
  const auth = new Auth({ db, clock, limitSecret: loginLimitSecret(masterKey), log, ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }) })
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
    api: { service, auth, hub, print: printService, instagram: instagramModule, appOrigin: options.appOrigin, clientConfig: { hostActionDelayMs, testPrinter: options.testPrinter === true } },
    webhooks: createWebhookApp(instagramModule),
  })
  return {
    app,
    service,
    writer,
    hub,
    auth,
    viewCaches,
    print: printService,
    instagram: instagramModule,
    ingestChat: (sellerId, input) => service.ingestChat(sellerId, input),
    close: () => {
      service.generators.closeAll()
      printService.close()
      instagramModule.close()
      hub.closeAll()
    },
  }
}
