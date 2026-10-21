// 기록 경로 (DAT-02, NFR-03, D-072, AC-S04-21~26·30).
// 1. 범위(판매자, 날짜, 리허설인지)마다 한 줄로 처리한다: 프로세스 안에서는 범위별 대기열, DB에서는 트랜잭션 안의 어드바이저리 락.
// 2. 트랜잭션 안에서 다른 인스턴스가 쓴 이벤트를 먼저 따라잡고, 요청 번호·채팅 ID 중복을 확인한다.
// 3. 이벤트를 메모리에서 미리 계산한다(엔진은 순수 함수): 입력 오류·미구현·상태 형식 오류는 기록하지 않고 거절한다.
//    엔진이 예상하지 못한 오류를 내면 그 입력은 실패 표시로 기록하고 상태는 그 전 그대로 둔다.
// 4. 이벤트 행과 그 효과(발송함 행)와 범위의 지금 seq(D-085)를 한 트랜잭션으로 커밋한다. 커밋된 뒤에야 메모리 상태 교체·실시간 알림·성공 응답이 나간다.
//    리허설 범위의 발송함 행은 리허설 표시를 단다(D-081).
//    같은 트랜잭션에서 txHook(출력 기록 — 효과 → 출력 작업·라벨 폐기, I1 L-11 2·5)을 부른다. 커밋된 뒤에야 그 알림을 보낸다.
// 5. (범위, seq) 유일 제약에 걸리면(다른 인스턴스가 먼저 씀) 최신 로그를 읽고 다시 계산한다.
import { STATE_FORMAT, checkEvent, isInvalidEvent, isNotImplemented, isStateFormatError, type EngineEffect, type EngineEvent, type EngineState } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { scopeLockKey } from './db/schema.ts'
import type { ErrorCode, FieldProblem } from './errors.ts'
import type { IdSource } from './ids.ts'
import { errorKind, type LogSink } from './log.ts'
import { easyProblems } from './messages.ts'
import { DEFAULT_CHANGES_WINDOW, FAILED_INPUT_MESSAGE, catchUp, loadRuntime, recordPoint, touchedMessage, type EngineAdapter, type ScopeRuntime } from './runtime.ts'
import { sha256Hex } from './secrets.ts'
import {
  chatEventSeq,
  existingChatIds,
  effectIdsAt,
  ensureScope,
  eventByRequestId,
  insertChatRaw,
  insertEvents,
  insertOutbox,
  insertSnapshot,
  markYoutubeChat,
  scopeSealedAt,
  setScopeSeq,
  type ChatRawRow,
  type NewEventRow,
  type NewOutboxRow,
  type RequestRecord,
} from './store.ts'
import type { Clock } from './time.ts'

/** 누가 보낸 입력인지 (DAT-05). deposit = 입금 자동 확인 (N3 DP-6 — 이력의 "누가"에 "입금 자동 확인") */
export type Actor = { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'server' } | { readonly kind: 'collector' } | { readonly kind: 'deposit' }

/** 채팅이 어디서 왔는지 (AC-Y1-60): 유튜브 수집기 · 리허설(생성기·시청자로 보내기) · 그 밖(시험 채우기 등) */
export type ChatSource = 'youtube' | 'rehearsal' | 'other'

/** 봉인한 범위에 쓰려 할 때 (AC-Y1-62) */
export const SEALED_MESSAGE = '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.'

/** 기록하지 않고 돌려보내는 이유 (4xx) */
export interface Rejection {
  readonly status: number
  readonly code: ErrorCode
  readonly message: string
  readonly problems: readonly FieldProblem[]
}

/** 쓸 이벤트 하나 (seq·at은 기록 경로가 붙인다) */
export interface Draft {
  /** 엔진 이벤트에서 seq·at을 뺀 것 (type 포함) */
  readonly fields: Readonly<Record<string, unknown>>
  readonly actor: Actor
  readonly requestId?: string
  readonly chat?: { readonly b: string; readonly id: string }
  readonly smsRef?: string
  /** checkEvent를 통과한 뒤 지금 상태로 더 거를 것 (예: 문자찜의 모르는 지정 구매자) */
  readonly validate?: (state: EngineState, event: EngineEvent) => Rejection | null
  /**
   * 서버가 덧붙이는 이벤트(차단 이어받기)라 checkEvent 문제가 있으면 요청 전체를 거절하지 않고 이 이벤트만 기록하지 않는다 (AC-S04-27).
   * 거른 이벤트는 seq를 쓰지 않는다(뒤 이벤트가 그 seq를 받는다)
   */
  readonly skipIfInvalid?: boolean
  /** 채팅이 어디서 왔는지 (채팅만, 기본 other). 본문·이름은 이벤트 기록 본문과 따로 둔다 (AC-Y1-60) */
  readonly source?: ChatSource
}

export interface BuildContext {
  readonly state: EngineState
  /** 이 범위의 첫 기록인지 (차단 이어받기) */
  readonly isNewScope: boolean
  /** 첫 이벤트가 받을 at (서버 시계, 범위 안에서 줄지 않음) */
  readonly at: number
  /** chatBatch로 넘긴 메시지 중 이미 기록된 메시지 ID (트랜잭션 안에서 읽은 것) */
  readonly existingChats: ReadonlySet<string>
}

export interface WriteJob {
  readonly sellerId: string
  readonly date: string
  /** 리허설 범위에 쓰는지 (D-081). 방송이 있는 이벤트는 그 방송의 범위를 따른다 */
  readonly rehearsal: boolean
  /** 범위가 없으면(이벤트 0개) 404 대신 만든다 (방송 만들기) */
  readonly createScope: boolean
  readonly requestId: string | null
  readonly chat?: { readonly b: string; readonly id: string }
  /** 여러 채팅을 한 번에 쓸 때 (유튜브 수집기의 한 응답): 이미 기록된 메시지 ID를 트랜잭션 안에서 읽어 build에 넘긴다 */
  readonly chatBatch?: { readonly b: string; readonly ids: readonly string[] }
  /**
   * 범위 락을 잡은 트랜잭션 안에서 쓰기 전에 더 확인할 것 (유튜브 수집기: 그 연결이 아직 이어져 있는지 — 다른 서버가 끊었으면 쓰지 않는다).
   * 거절이면 아무것도 쓰지 않는다. runtime = 락을 잡고 최신 로그까지 따라잡은 범위 상태(scopeId·state — 합치기 전 포장 기록 검사, D-I2-20)
   */
  readonly guard?: (tx: Db, runtime: Pick<ScopeRuntime, 'scopeId' | 'state'>) => Promise<Rejection | null>
  /** 트랜잭션 전에 미리 읽을 것 (차단 이어받기 목록). 범위가 새로울 때만 부른다 */
  readonly prepare?: () => Promise<unknown>
  /** 쓸 이벤트들. 첫 이벤트가 요청의 결과(요청 번호)다 */
  readonly build: (ctx: BuildContext, prepared: unknown) => readonly Draft[] | Rejection
  /** 같은 트랜잭션에서 더 쓸 것 (방송 목록) */
  readonly afterInsert?: (tx: Db, scopeId: string, records: readonly CommittedRecord[], now: Date) => Promise<void>
}

/** 범위 키 (판매자, 날짜, 리허설인지) */
export function scopeKey(sellerId: string, date: string, rehearsal: boolean): string {
  return JSON.stringify([sellerId, date, rehearsal])
}

export interface CommittedRecord {
  readonly event: EngineEvent
  readonly seq: number
  readonly type: string
  readonly changed: boolean
  readonly failed: boolean
  readonly effects: readonly EngineEffect[]
}

/** 요청의 결과 (처음 결과를 같은 요청 번호로 다시 돌려줄 때도 같은 모양) */
export interface WriteResult {
  readonly date: string
  /** 리허설 범위의 기록인지 */
  readonly rehearsal: boolean
  readonly seq: number
  readonly type: string
  readonly changed: boolean
  readonly failed: boolean
  readonly effects: readonly string[]
  /** 기록한 엔진 이벤트 (응답을 만들 때 읽는다 — 응답에 그대로 내보내지 않는다) */
  readonly event: Readonly<Record<string, unknown>>
  /** 문자찜이 정한 구매자 자신 (sms만, 서비스가 채운다 — 응답 buyer, AC-S06b-11, D-099). 정하지 못했으면 null */
  readonly smsBuyer?: string | null
}

export type WriteOutcome =
  | {
      readonly kind: 'ok'
      readonly result: WriteResult
      readonly records: readonly CommittedRecord[]
      /** 이벤트마다 적용한 뒤의 범위 상태 (records와 같은 순서) */
      readonly states: readonly EngineState[]
    }
  | { readonly kind: 'duplicate'; readonly result: WriteResult | null }
  | { readonly kind: 'rejected'; readonly rejection: Rejection }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'save_failed' }
  /** 아무것도 쓰지 않았다 (chatBatch의 메시지가 모두 이미 기록됨) */
  | { readonly kind: 'empty' }

/** 시험용 주입점 */
export interface WriterHooks {
  /** 커밋 직전(트랜잭션 안). 던지면 롤백 — 저장 실패 주입 */
  readonly beforeCommit?: (records: readonly CommittedRecord[]) => void | Promise<void>
  /** 커밋 직후·메모리 교체 전. 던지면 "응답 전에 멈춤"을 흉내 낸다(메모리·알림 없음) */
  readonly afterCommit?: (records: readonly CommittedRecord[]) => void | Promise<void>
  /** 스냅샷 쓰기 직전. 던지면 스냅샷 쓰기 실패 */
  readonly beforeSnapshot?: () => void | Promise<void>
}

/** 트랜잭션 안에서 더 쓸 것 (출력 기록, I1)에 넘기는 값 */
export interface TxHookContext {
  readonly sellerId: string
  readonly date: string
  readonly rehearsal: boolean
  readonly scopeId: string
  readonly records: readonly CommittedRecord[]
  /** 이벤트마다 적용한 뒤의 상태 (records와 같은 순서) */
  readonly states: readonly EngineState[]
  /** 이 기록 전의 상태 */
  readonly before: EngineState
  /** 이 범위의 실행 상태 (보기 캐시만 쓴다 — 상태는 커밋된 뒤에 바뀐다) */
  readonly runtime: ScopeRuntime
  readonly now: Date
}

/** 이벤트 행·발송함 행과 같은 트랜잭션에서 부른다. 커밋된 뒤 부를 일(알림)을 돌려준다. 던지면 기록 전체가 롤백된다 */
export type TxHook = (tx: Db, ctx: TxHookContext) => Promise<(() => void) | null>

export interface CommitListener {
  (sellerId: string, date: string, rehearsal: boolean, records: readonly CommittedRecord[]): void
}

export interface WriterOptions {
  readonly db: Db
  readonly engine: EngineAdapter
  readonly clock: Clock
  readonly ids: IdSource
  readonly log: LogSink
  readonly hooks: WriterHooks
  /** 이 이벤트 수마다 스냅샷 (최대 500) */
  readonly snapshotEvery: number
  readonly onCommit: CommitListener
  /** 메모리에 두는 범위 상태 수 상한 (기본 DEFAULT_RUNTIME_CACHE_MAX) */
  readonly runtimeCacheMax?: number
  /** 증분 조회 기준점 창 크기 (기본 DEFAULT_CHANGES_WINDOW) */
  readonly changesWindow?: number
  /** 범위 상태를 메모리에서 내렸을 때 (상한·forget — 보기 캐시 상한이 그 범위의 캐시를 비운다, AC-S06b-12) */
  readonly onDrop?: (runtime: ScopeRuntime) => void
  /** 같은 트랜잭션에서 더 쓸 것 (출력 기록, I1) */
  readonly txHook?: TxHook
}

const MAX_SEQ_RETRIES = 5
/**
 * 메모리에 두는 범위 상태 수 기본 상한 (RA-S04-002). 넘으면 가장 오래 안 쓴 범위부터 버린다 — 처리 중인 범위는 두고.
 * 버린 범위는 다음에 쓰거나 읽을 때 스냅샷 + 뒤 이벤트로 다시 불러온다(결과는 같다). 방송 중인 범위는 계속 쓰이므로 남는다.
 */
export const DEFAULT_RUNTIME_CACHE_MAX = 128

interface Committed {
  readonly records: CommittedRecord[]
  /** 이벤트마다 적용한 뒤의 상태 (records와 같은 순서) */
  readonly states: EngineState[]
  readonly state: EngineState
  readonly seq: number
  readonly lastAt: number
  readonly scopeId: string
  /** 커밋된 뒤 부를 일 (txHook이 돌려준 것) */
  readonly after: (() => void) | null
}

/**
 * 기록을 그만두고 이 결과를 돌려준다 (트랜잭션 롤백). 트랜잭션 안의 afterInsert·txHook이 던질 수 있다 —
 * 예: 출력 결과를 엔진 보고와 함께 기록하려는데 그 시도가 이미 끝났다(I1)
 */
export class WriteAbort {
  readonly outcome: WriteOutcome
  constructor(outcome: WriteOutcome) {
    this.outcome = outcome
  }
}

const Abort = WriteAbort

/** 유일 제약 위반이면 제약 이름 (PGlite: constraint, postgres: constraint_name) */
export function uniqueViolation(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>
      if (record.code === '23505') {
        const name = record.constraint ?? record.constraint_name
        return typeof name === 'string' ? name : ''
      }
      current = record.cause
    } else break
  }
  return null
}

/**
 * 기록 요약값. 본문·이름을 따로 둔 채팅(AC-Y1-60)은 그 둘도 함께 묶는다 — 따로 둔 값을 고치면 재생 검사가 그 seq를 잡는다
 */
export function eventDigest(scopeId: string, seq: number, type: string, body: string, failed: boolean, raw?: { readonly nick: string; readonly text: string } | null): string {
  if (raw === undefined || raw === null) return sha256Hex(JSON.stringify([scopeId, seq, type, body, failed]))
  return sha256Hex(JSON.stringify([scopeId, seq, type, body, failed, raw.nick, raw.text]))
}

/** 범위(판매자, 날짜, 리허설인지)마다 한 줄로 처리하는 기록기 */
export class ScopeWriter {
  readonly #options: WriterOptions
  /** 범위 상태 (키 = scopeKey). 넣은 순서 = 마지막으로 쓴 순서 (앞이 가장 오래 안 쓴 것). 범위 행이 있는 것만 둔다 */
  readonly #runtimes = new Map<string, ScopeRuntime>()
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(options: WriterOptions) {
    this.#options = options
  }

  /** 메모리에 둔 범위 상태 수 (시험·점검용) */
  get cachedScopes(): number {
    return this.#runtimes.size
  }

  /** 범위마다 한 줄: 같은 범위의 작업은 앞 작업이 끝난 뒤 시작한다 */
  serial<T>(sellerId: string, date: string, rehearsal: boolean, task: () => Promise<T>): Promise<T> {
    const key = scopeKey(sellerId, date, rehearsal)
    const previous = this.#queues.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(key, settled)
    void settled.then(() => {
      if (this.#queues.get(key) === settled) this.#queues.delete(key)
    })
    return run
  }

  /**
   * 범위 상태 (처음이면 DB에서 불러온다). serial 안에서 쓴다 — 같은 범위를 동시에 불러오지 않는다.
   * 범위 행이 없으면(이벤트 0개) 빈 상태를 돌려주되 메모리에 두지 않는다: 없는 날짜를 아무리 조회해도 쌓이지 않는다(RA-S04-002).
   */
  async runtime(sellerId: string, date: string, rehearsal = false): Promise<ScopeRuntime> {
    const key = scopeKey(sellerId, date, rehearsal)
    const cached = this.#runtimes.get(key)
    if (cached !== undefined) {
      this.#touch(key, cached)
      return cached
    }
    const window = this.#options.changesWindow ?? DEFAULT_CHANGES_WINDOW
    const runtime = await loadRuntime(this.#options.db, sellerId, date, rehearsal, this.#options.engine, this.#options.log, window)
    this.#keep(runtime)
    return runtime
  }

  /** 범위 행이 있는 상태만 메모리에 둔다. 상한을 넘으면 가장 오래 안 쓴, 처리 중이 아닌 범위부터 버린다 */
  #keep(runtime: ScopeRuntime): void {
    if (runtime.scopeId === null) return
    const key = scopeKey(runtime.sellerId, runtime.date, runtime.rehearsal)
    this.#touch(key, runtime)
    const max = this.#options.runtimeCacheMax ?? DEFAULT_RUNTIME_CACHE_MAX
    if (this.#runtimes.size <= max) return
    for (const [candidate, dropped] of this.#runtimes) {
      if (this.#runtimes.size <= max) break
      if (candidate !== key && !this.#queues.has(candidate)) this.#drop(candidate, dropped)
    }
  }

  #drop(key: string, runtime: ScopeRuntime): void {
    this.#runtimes.delete(key)
    this.#options.onDrop?.(runtime)
  }

  /** 마지막으로 쓴 것으로 옮긴다 */
  #touch(key: string, runtime: ScopeRuntime): void {
    this.#runtimes.delete(key)
    this.#runtimes.set(key, runtime)
  }

  /** 메모리 상태를 버린다 (다음에 DB에서 다시 불러온다) */
  forget(sellerId: string, date: string, rehearsal = false): void {
    const key = scopeKey(sellerId, date, rehearsal)
    const runtime = this.#runtimes.get(key)
    if (runtime !== undefined) this.#drop(key, runtime)
  }

  /**
   * 범위마다 한 줄 처리 안에서 최신 로그까지 따라잡은 범위 상태로 fn을 부른다 (출력 기록이 상태를 읽고 쓰는 동안 그 범위의 이벤트 기록이 끼지 않게, I1).
   * fn 안에서 같은 범위의 read·write·withState를 부르면 안 된다(자기 차례를 기다리다 멈춘다)
   */
  withState<T>(sellerId: string, date: string, rehearsal: boolean, fn: (runtime: ScopeRuntime) => Promise<T>): Promise<T> {
    return this.serial(sellerId, date, rehearsal, async () => {
      const runtime = await this.runtime(sellerId, date, rehearsal)
      await catchUp(this.#options.db, runtime, this.#options.engine, this.#options.log)
      this.#keep(runtime)
      return fn(runtime)
    })
  }

  /** 최신 로그까지 따라잡은 범위 상태 (조회용). 리허설을 적지 않으면 실제 범위다 */
  read(sellerId: string, date: string, rehearsal = false): Promise<ScopeRuntime> {
    return this.serial(sellerId, date, rehearsal, async () => {
      const runtime = await this.runtime(sellerId, date, rehearsal)
      await catchUp(this.#options.db, runtime, this.#options.engine, this.#options.log)
      // 다른 인스턴스가 그사이 범위를 만들었으면 이제 메모리에 둔다
      this.#keep(runtime)
      return runtime
    })
  }

  /**
   * 여러 날짜를 훑는 조회용 범위 상태 (기간·전체 판매대장, 지난 구매의 다른 날짜 — TD-I2-008·SA-I2-008).
   * 메모리에 있으면 그 상태를 최신 로그까지 따라잡아 쓰고, 없으면 스냅샷 + 뒤 이벤트로 임시 상태를 만들어 돌려주되 메모리에 두지 않는다.
   * 모든 판매자가 함께 쓰는 상한 캐시에 넣지 않으므로, 한 판매자가 지난 날짜를 아무리 많이 읽어도 방송 중인 다른 판매자의 범위 상태를 밀어내지 않고
   * 메모리도 한 번에 그 날짜 하나만큼만 잡는다(D-096의 원칙). 같은 범위의 쓰기와 겹치지 않게 범위 줄 안에서 읽는다. 돌려준 상태는 읽기만 한다.
   */
  readDetached(sellerId: string, date: string, rehearsal = false): Promise<ScopeRuntime> {
    return this.serial(sellerId, date, rehearsal, async () => {
      const { db, engine, log } = this.#options
      const cached = this.#runtimes.get(scopeKey(sellerId, date, rehearsal))
      if (cached !== undefined) {
        await catchUp(db, cached, engine, log)
        return cached
      }
      return loadRuntime(db, sellerId, date, rehearsal, engine, log, this.#options.changesWindow ?? DEFAULT_CHANGES_WINDOW)
    })
  }

  /**
   * 입금 확인의 묶음 찾기·기억한 이름 표시가 지난 날짜를 여럿 훑을 때 쓰는 이름 (N3 RA-N3-003) — readDetached와 같다:
   * 메모리를 밀어내지 않는 읽기라 방송 중인 범위의 상태를 상한 밖으로 밀어내지 않는다. 돌려준 상태를 고치면 안 된다.
   */
  peek(sellerId: string, date: string, rehearsal = false): Promise<ScopeRuntime> {
    return this.readDetached(sellerId, date, rehearsal)
  }

  write(job: WriteJob): Promise<WriteOutcome> {
    return this.serial(job.sellerId, job.date, job.rehearsal, () => this.#write(job))
  }

  /**
   * 범위 줄(serial) 안에서 최신 로그까지 따라잡은 범위 상태로 task를 부른다 (I2 포장·배송 기록 — 엔진 이벤트가 아닌 덧붙이기 기록, D-I2-05).
   * 같은 범위의 엔진 기록과 겹치지 않는다(같은 줄). task는 트랜잭션 안에서 범위 어드바이저리 락을 잡은 뒤 catchUpIn(tx)로
   * 다른 인스턴스가 쓴 이벤트까지 따라잡고 판단한다. 범위 상태는 커밋된 이벤트로만 바뀐다(task가 상태를 바꾸지 않는다)
   */
  withScope<T>(sellerId: string, date: string, rehearsal: boolean, task: (runtime: ScopeRuntime, catchUpIn: (tx: Db) => Promise<void>) => Promise<T>): Promise<T> {
    return this.serial(sellerId, date, rehearsal, async () => {
      const runtime = await this.runtime(sellerId, date, rehearsal)
      const { engine, log } = this.#options
      await catchUp(this.#options.db, runtime, engine, log)
      this.#keep(runtime)
      return task(runtime, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, date, rehearsal)})`)
        await catchUp(tx, runtime, engine, log)
      })
    })
  }

  /** 그 판매자의 범위 상태를 모두 메모리에서 내린다 (복구·가져오기 뒤 — 다음에 DB에서 다시 불러온다, D-I2-11) */
  forgetSeller(sellerId: string): void {
    for (const [key, runtime] of [...this.#runtimes]) if (runtime.sellerId === sellerId) this.#drop(key, runtime)
  }

  async #write(job: WriteJob): Promise<WriteOutcome> {
    const { db, engine, log } = this.#options
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      let runtime: ScopeRuntime
      try {
        runtime = await this.runtime(job.sellerId, job.date, job.rehearsal)
        await catchUp(db, runtime, engine, log)
      } catch (error) {
        this.forget(job.sellerId, job.date, job.rehearsal)
        log({ level: 'error', code: 'SAVE_FAILED', date: job.date, errorKind: errorKind(error) })
        return { kind: 'save_failed' }
      }
      if (!job.createScope && runtime.seq === 0) return { kind: 'not_found' }
      const prepared = runtime.seq === 0 && job.prepare !== undefined ? await job.prepare() : undefined
      let committed: Committed
      try {
        committed = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(job.sellerId, job.date, job.rehearsal)})`)
          await catchUp(tx, runtime, engine, log)
          if (!job.createScope && runtime.seq === 0) throw new Abort({ kind: 'not_found' })
          if (job.requestId !== null) {
            const existing = await eventByRequestId(tx, job.sellerId, job.requestId)
            if (existing !== null) throw new Abort({ kind: 'duplicate', result: await resultOf(tx, job.sellerId, existing) })
          }
          // 봉인한 범위는 읽기만 된다 (AC-Y1-62). 봉인 작업도 같은 락을 잡는다
          if (runtime.scopeId !== null && (await scopeSealedAt(tx, job.sellerId, runtime.scopeId)) !== null) {
            throw new Abort({ kind: 'rejected', rejection: { status: 409, code: 'SEALED', message: SEALED_MESSAGE, problems: [] } })
          }
          if (job.guard !== undefined) {
            const refused = await job.guard(tx, runtime)
            if (refused !== null) throw new Abort({ kind: 'rejected', rejection: refused })
          }
          if (job.chat !== undefined && (await chatEventSeq(tx, job.sellerId, job.chat.b, job.chat.id)) !== null) {
            throw new Abort({ kind: 'duplicate', result: null })
          }
          const existingChats = job.chatBatch === undefined ? new Set<string>() : await existingChatIds(tx, job.sellerId, job.chatBatch.b, job.chatBatch.ids)
          const computed = this.#compute(job, runtime, prepared, existingChats)
          if ('rejection' in computed) throw new Abort({ kind: 'rejected', rejection: computed.rejection })
          if (computed.records.length === 0) throw new Abort({ kind: 'empty' })
          const now = new Date(this.#options.clock.now())
          const scopeId = runtime.scopeId ?? (await ensureScope(tx, job.sellerId, job.date, job.rehearsal, this.#options.ids.scope(), now))
          const rows = computed.records.map((record, index) => eventRow(job, scopeId, record, computed.drafts[index] as Draft, now))
          await insertEvents(
            tx,
            rows.map((row) => row.event),
          )
          await insertChatRaw(
            tx,
            rows.flatMap((row) => (row.raw === null ? [] : [row.raw])),
          )
          if (!job.rehearsal && rows.some((row) => row.event.chatSource === 'youtube')) await markYoutubeChat(tx, job.sellerId, scopeId)
          await insertOutbox(tx, computed.records.flatMap((record) => outboxRows(job, scopeId, record, now)))
          // 범위의 지금 seq — 실패 표시 이벤트도 seq를 쓴다 (AC-S05-60)
          await setScopeSeq(tx, job.sellerId, scopeId, computed.seq)
          await job.afterInsert?.(tx, scopeId, computed.records, now)
          const after =
            this.#options.txHook === undefined || computed.records.length === 0
              ? null
              : await this.#options.txHook(tx, {
                  sellerId: job.sellerId,
                  date: job.date,
                  rehearsal: job.rehearsal,
                  scopeId,
                  records: computed.records,
                  states: computed.states,
                  before: runtime.state,
                  runtime,
                  now,
                })
          await this.#options.hooks.beforeCommit?.(computed.records)
          return { records: computed.records, states: computed.states, state: computed.state, seq: computed.seq, lastAt: computed.lastAt, scopeId, after }
        })
      } catch (error) {
        if (error instanceof Abort) {
          if (error.outcome.kind === 'rejected' && error.outcome.rejection.code === 'STATE_FORMAT') this.forget(job.sellerId, job.date, job.rehearsal)
          return error.outcome
        }
        const constraint = uniqueViolation(error)
        if (constraint === 'events_scope_seq_uq') continue
        if (constraint === 'events_request_uq' && job.requestId !== null) {
          const existing = await eventByRequestId(db, job.sellerId, job.requestId)
          if (existing !== null) return { kind: 'duplicate', result: await resultOf(db, job.sellerId, existing) }
        }
        if (constraint === 'events_chat_uq') return { kind: 'duplicate', result: null }
        log({ level: 'error', code: 'SAVE_FAILED', date: job.date, errorKind: errorKind(error) })
        return { kind: 'save_failed' }
      }
      return this.#afterCommit(job, runtime, committed)
    }
    log({ level: 'error', code: 'SAVE_FAILED', date: job.date, errorKind: 'SeqConflict' })
    return { kind: 'save_failed' }
  }

  /** 메모리에서 미리 계산한다 (상태는 아직 바꾸지 않는다) */
  #compute(
    job: WriteJob,
    runtime: ScopeRuntime,
    prepared: unknown,
    existingChats: ReadonlySet<string>,
  ): { records: CommittedRecord[]; states: EngineState[]; drafts: readonly Draft[]; state: EngineState; seq: number; lastAt: number } | { rejection: Rejection } {
    const { engine, log, clock } = this.#options
    const firstAt = Math.max(clock.now(), runtime.lastAt)
    const drafts = job.build({ state: runtime.state, isNewScope: runtime.seq === 0, at: firstAt, existingChats }, prepared)
    if (!Array.isArray(drafts)) return { rejection: drafts as Rejection }
    let state = runtime.state
    let seq = runtime.seq
    let lastAt = runtime.lastAt
    const records: CommittedRecord[] = []
    const states: EngineState[] = []
    const kept: Draft[] = []
    for (const draft of drafts as readonly Draft[]) {
      const at = Math.max(clock.now(), lastAt, firstAt)
      const event = { ...draft.fields, seq: seq + 1, at } as unknown as EngineEvent
      let problems
      try {
        problems = checkEvent(state, event)
      } catch (error) {
        if (isStateFormatError(error)) return { rejection: stateFormatRejection() }
        throw error
      }
      if (problems.length > 0) {
        if (draft.skipIfInvalid === true) {
          log({ level: 'warn', code: 'DRAFT_SKIPPED', date: job.date })
          continue
        }
        return { rejection: invalid(easyProblems(problems, event as unknown as Record<string, unknown>)) }
      }
      const extra = draft.validate?.(state, event) ?? null
      if (extra !== null) return { rejection: extra }
      seq += 1
      lastAt = at
      kept.push(draft)
      try {
        const result = engine.applyEvent(state, event)
        records.push({ event, seq, type: event.type, changed: result.state !== state, failed: false, effects: result.effects })
        state = result.state
        states.push(state)
      } catch (error) {
        if (isInvalidEvent(error)) return { rejection: invalid(easyProblems(error.problems, event as unknown as Record<string, unknown>)) }
        if (isNotImplemented(error)) return { rejection: { status: 422, code: 'NOT_SUPPORTED', message: '아직 지원하지 않는 기능이에요.', problems: [] } }
        if (isStateFormatError(error)) return { rejection: stateFormatRejection() }
        // 엔진이 예상하지 못한 오류: 실패 표시로 기록하고 상태는 그 전 그대로 (AC-S04-24)
        log({ level: 'error', code: 'ENGINE_FAILED', seller: job.sellerId, date: job.date, seq, errorKind: errorKind(error) })
        records.push({ event, seq, type: event.type, changed: false, failed: true, effects: [] })
        states.push(state)
      }
    }
    return { records, states, drafts: kept, state, seq, lastAt }
  }

  async #afterCommit(job: WriteJob, runtime: ScopeRuntime, committed: Committed): Promise<WriteOutcome> {
    const { hooks, onCommit, log } = this.#options
    try {
      await hooks.afterCommit?.(committed.records)
    } catch (error) {
      // 응답 전에 멈춘 것처럼: 메모리·알림을 바꾸지 않는다. 다음에 읽거나 쓸 때 로그에서 따라잡는다
      log({ level: 'error', code: 'REQUEST_FAILED', date: job.date, seq: committed.seq, errorKind: errorKind(error) })
      throw error
    }
    // 이벤트마다 기준점을 남긴다 (증분 조회, D-085)
    committed.records.forEach((record, index) => {
      runtime.state = committed.states[index] as EngineState
      runtime.seq = record.seq
      if (record.failed) runtime.attention = [...runtime.attention, { seq: record.seq, message: FAILED_INPUT_MESSAGE }]
      recordPoint(runtime, record.failed ? null : touchedMessage(record.event))
    })
    runtime.state = committed.state
    runtime.seq = committed.seq
    runtime.lastAt = committed.lastAt
    runtime.scopeId = committed.scopeId
    runtime.sinceSnapshot += committed.records.length
    // 이 기록으로 범위가 생겼으면(방송 만들기) 이제 메모리에 둔다
    this.#keep(runtime)
    try {
      onCommit(job.sellerId, job.date, job.rehearsal, committed.records)
    } catch (error) {
      log({ level: 'warn', code: 'STREAM_FAILED', date: job.date, errorKind: errorKind(error) })
    }
    try {
      committed.after?.()
    } catch (error) {
      log({ level: 'warn', code: 'STREAM_FAILED', date: job.date, errorKind: errorKind(error) })
    }
    if (runtime.sinceSnapshot >= this.#options.snapshotEvery || committed.records.some((record) => record.type === 'broadcast.end')) {
      await this.snapshot(runtime)
    }
    const first = committed.records[0] as CommittedRecord
    return {
      kind: 'ok',
      records: committed.records,
      states: committed.states,
      result: {
        date: job.date,
        rehearsal: job.rehearsal,
        seq: first.seq,
        type: first.type,
        changed: first.changed,
        failed: first.failed,
        effects: first.effects.map((effect) => effect.id),
        event: first.event as unknown as Record<string, unknown>,
      },
    }
  }

  /** 지금 범위 상태를 스냅샷으로 저장한다. 실패해도 기록·응답은 그대로다(스냅샷은 속도용) */
  async snapshot(runtime: ScopeRuntime): Promise<boolean> {
    if (runtime.scopeId === null || runtime.seq === 0) return false
    try {
      await this.#options.hooks.beforeSnapshot?.()
      await insertSnapshot(this.#options.db, {
        sellerId: runtime.sellerId,
        scopeId: runtime.scopeId,
        seq: runtime.seq,
        format: STATE_FORMAT,
        state: JSON.stringify(runtime.state),
        attention: JSON.stringify(runtime.attention),
        now: new Date(this.#options.clock.now()),
      })
      runtime.sinceSnapshot = 0
      return true
    } catch (error) {
      // 실패해도 다음 간격까지 다시 시도하지 않는다 (실패가 이어질 때 쓰기마다 상태 전체를 직렬화하지 않게)
      runtime.sinceSnapshot = 0
      this.#options.log({ level: 'warn', code: 'SNAPSHOT_FAILED', date: runtime.date, seq: runtime.seq, errorKind: errorKind(error) })
      return false
    }
  }
}

function invalid(problems: readonly FieldProblem[]): Rejection {
  return { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems }
}

function stateFormatRejection(): Rejection {
  return { status: 409, code: 'STATE_FORMAT', message: '저장된 상태를 다시 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.', problems: [] }
}

/** 채팅 이벤트의 본문·이름을 떼어 낸다 (AC-Y1-60). 둘 다 글자일 때만 — 아니면 그대로 둔다 */
export function splitChatRaw(event: Readonly<Record<string, unknown>>): { body: Record<string, unknown>; raw: { nick: string; text: string } } | null {
  if (event.type !== 'chat' || typeof event.nick !== 'string' || typeof event.text !== 'string') return null
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (key === 'nick' || key === 'text') continue
    Object.defineProperty(body, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return { body, raw: { nick: event.nick, text: event.text } }
}

function eventRow(job: WriteJob, scopeId: string, record: CommittedRecord, draft: Draft, now: Date): { event: NewEventRow; raw: ChatRawRow | null } {
  const split = splitChatRaw(record.event as unknown as Record<string, unknown>)
  const body = JSON.stringify(split === null ? record.event : split.body)
  return {
    event: {
      sellerId: job.sellerId,
      scopeId,
      seq: record.seq,
      type: record.type,
      body,
      at: record.event.at,
      receivedAt: now,
      actor: draft.actor.kind,
      accountId: draft.actor.kind === 'account' ? draft.actor.accountId : null,
      requestId: draft.requestId ?? null,
      chatBroadcast: draft.chat?.b ?? null,
      chatMessageId: draft.chat?.id ?? null,
      smsRef: draft.smsRef ?? null,
      changed: record.changed,
      failed: record.failed,
      digest: eventDigest(scopeId, record.seq, record.type, body, record.failed, split?.raw ?? null),
      chatSource: record.type === 'chat' ? (draft.source ?? 'other') : null,
      raw: split !== null,
    },
    raw: split === null ? null : { sellerId: job.sellerId, scopeId, seq: record.seq, nick: split.raw.nick, text: split.raw.text },
  }
}

function outboxRows(job: WriteJob, scopeId: string, record: CommittedRecord, now: Date): NewOutboxRow[] {
  return record.effects.map((effect) => ({
    sellerId: job.sellerId,
    scopeId,
    effectId: effect.id,
    seq: record.seq,
    kind: effect.kind,
    body: JSON.stringify(effect),
    rehearsal: job.rehearsal,
    createdAt: now,
  }))
}

/** 요청 번호로 기록한 이벤트의 결과 (처음 응답과 같은 모양) */
export async function resultOf(db: Db, sellerId: string, record: RequestRecord): Promise<WriteResult> {
  return {
    date: record.date,
    rehearsal: record.rehearsal,
    seq: record.seq,
    type: record.type,
    changed: record.changed,
    failed: record.failed,
    effects: await effectIdsAt(db, sellerId, record.scopeId, record.seq),
    event: JSON.parse(record.body) as Record<string, unknown>,
  }
}
