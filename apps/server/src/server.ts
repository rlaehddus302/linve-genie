// 서버 조립 (S04·S05): DB·마스터 키·앱 주소를 받아 기록 경로·서비스·로그인·실시간 알림·리허설 생성기·HTTP 앱을 만든다.
// 시험(단위·적대)은 PGlite로 열어 createServer(...).app.request(...)로 포트 없이 요청한다.
// 시험용 주입점: clock(서버 시계), ids(ID 생성), hooks(저장 실패·응답 전 멈춤·스냅샷 실패), engine(엔진 감싸기), log(로그 수집), runtimeCacheMax(범위 상태 메모리 상한),
// changesWindow(증분 조회 기준점 수), generatorTimer·generatorSpeed(리허설 생성기 타이머·시험 속도), hostActionDelayMs(화면의 방송자 조치 대기 — E2E 기동만 줄인다).
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
import { DEFAULT_CHANGES_WINDOW } from './runtime.ts'
import { Service, type ChatIngestOutcome } from './service.ts'
import { systemClock, type Clock } from './time.ts'
import { DEFAULT_RUNTIME_CACHE_MAX, ScopeWriter, type WriterHooks } from './writer.ts'
import type { CollectorHooks } from './youtube/collector.ts'
import type { OutboxHooks } from './youtube/outbox.ts'
import { Sealer } from './youtube/seal.ts'
import { YoutubeSystem, checkYoutubeConfig, type YoutubeConfig } from './youtube/system.ts'
import { realTimer, type Timer } from './youtube/timer.ts'

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
  readonly collectorTiming?: { readonly leaseMs?: number; readonly renewMs?: number; readonly scanMs?: number }
  readonly sealHooks?: { readonly beforeCommit?: () => void | Promise<void> }
}

export interface LivejjimServer {
  readonly app: Hono
  readonly service: Service
  readonly writer: ScopeWriter
  readonly hub: StreamHub
  readonly auth: Auth
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
  /** 실시간 연결을 닫고 리허설 생성기·타이머·워커를 멈춘다 (DB는 닫지 않는다) */
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

  if (options.youtube !== undefined) {
    const problem = checkYoutubeConfig(options.youtube)
    if (problem !== null) throw new TypeError(problem)
  }

  const db = options.database.db
  const clock = options.clock ?? systemClock
  const timer = options.timer ?? realTimer(clock)
  const ids: IdSource = { ...randomIds, ...options.ids }
  const log = safeSink(options.log ?? stderrLog)
  const engine: EngineAdapter = options.engine ?? { applyEvent }
  const auth = new Auth({ db, clock, limitSecret: loginLimitSecret(masterKey), log, ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }) })
  const hub = new StreamHub({ heartbeatMs, sessionAlive: (hash) => auth.alive(hash) })
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
    },
  })
  const service = new Service({
    db,
    writer,
    masterKey,
    clock,
    ids,
    generatorSpeed,
    onGenerator: (sellerId, payload) => hub.publishGenerator(sellerId, payload),
    ...(options.generatorTimer === undefined ? {} : { generatorTimer: options.generatorTimer }),
  })
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
          ...(options.collectorTiming === undefined ? {} : { collectorTiming: options.collectorTiming }),
        })
  const sealer = new Sealer({
    db,
    writer,
    timer,
    log,
    onSealed: (sellerId, date) => publishYoutube(sellerId, { kind: 'sealed', date }),
    ...(options.sealHooks === undefined ? {} : { hooks: options.sealHooks }),
  })
  const app = createApp({
    logError: (error) => log({ level: 'error', code: 'REQUEST_FAILED', errorKind: errorKind(error) }),
    api: { service, auth, hub, appOrigin: options.appOrigin, clientConfig: { hostActionDelayMs }, youtube, sealer },
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
    ingestChat: (sellerId, input) => service.ingestChat(sellerId, input),
    start: () => {
      youtube?.start()
      sealer.start()
    },
    stop,
    close: () => {
      service.generators.closeAll()
      hub.closeAll()
      void stop()
    },
  }
}
