// 서버 조립 (S04): DB·마스터 키·앱 주소를 받아 기록 경로·서비스·로그인·실시간 알림·HTTP 앱을 만든다.
// 시험(단위·적대)은 PGlite로 열어 createServer(...).app.request(...)로 포트 없이 요청한다.
// 시험용 주입점: clock(서버 시계), ids(ID 생성), hooks(저장 실패·응답 전 멈춤·스냅샷 실패), engine(엔진 감싸기), log(로그 수집).
import { applyEvent } from '@livejjim/core'
import type { Hono } from 'hono'
import { Auth } from './auth.ts'
import { createApp } from './app.ts'
import type { Database } from './db/database.ts'
import { StreamHub } from './hub.ts'
import { randomIds, type IdSource } from './ids.ts'
import { errorKind, safeSink, stderrLog, type LogSink } from './log.ts'
import type { EngineAdapter } from './runtime.ts'
import { readMasterKey, type PasswordCost } from './secrets.ts'
import { Service, type ChatIngestOutcome } from './service.ts'
import { systemClock, type Clock } from './time.ts'
import { ScopeWriter, type WriterHooks } from './writer.ts'

/** 스냅샷 간격 상한 (AC-S04-28: 일정 이벤트 수, 최대 500) */
export const MAX_SNAPSHOT_EVERY = 500
/** 하트비트 기본 간격 (30초 이내, AC-S04-60) */
export const DEFAULT_HEARTBEAT_MS = 15_000

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
}

export interface LivejjimServer {
  readonly app: Hono
  readonly service: Service
  readonly writer: ScopeWriter
  readonly hub: StreamHub
  readonly auth: Auth
  /** 서버 안 채팅 수집 함수 (S05 리허설·S10 수집기, AC-S04-33) */
  ingestChat(sellerId: string, input: unknown): Promise<ChatIngestOutcome>
  /** 실시간 연결을 닫고 타이머를 멈춘다 (DB는 닫지 않는다) */
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

  const db = options.database.db
  const clock = options.clock ?? systemClock
  const ids: IdSource = { ...randomIds, ...options.ids }
  const log = safeSink(options.log ?? stderrLog)
  const engine: EngineAdapter = options.engine ?? { applyEvent }
  const auth = new Auth({ db, clock, ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }) })
  const hub = new StreamHub({ heartbeatMs, sessionAlive: (hash) => auth.alive(hash) })
  const writer = new ScopeWriter({
    db,
    engine,
    clock,
    ids,
    log,
    hooks: options.hooks ?? {},
    snapshotEvery,
    onCommit: (sellerId, date, records) => hub.publish(sellerId, records.map((record) => ({ date, seq: record.seq, type: record.type }))),
  })
  const service = new Service({ db, writer, masterKey, clock, ids })
  const app = createApp({
    logError: (error) => log({ level: 'error', code: 'REQUEST_FAILED', errorKind: errorKind(error) }),
    api: { service, auth, hub, appOrigin: options.appOrigin },
  })
  return {
    app,
    service,
    writer,
    hub,
    auth,
    ingestChat: (sellerId, input) => service.ingestChat(sellerId, input),
    close: () => hub.closeAll(),
  }
}
