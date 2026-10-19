// 기록 경로 (DAT-02, NFR-03, D-072, AC-S04-21~26·30).
// 1. 범위(판매자, 날짜)마다 한 줄로 처리한다: 프로세스 안에서는 범위별 대기열, DB에서는 트랜잭션 안의 어드바이저리 락.
// 2. 트랜잭션 안에서 다른 인스턴스가 쓴 이벤트를 먼저 따라잡고, 요청 번호·채팅 ID 중복을 확인한다.
// 3. 이벤트를 메모리에서 미리 계산한다(엔진은 순수 함수): 입력 오류·미구현·상태 형식 오류는 기록하지 않고 거절한다.
//    엔진이 예상하지 못한 오류를 내면 그 입력은 실패 표시로 기록하고 상태는 그 전 그대로 둔다.
// 4. 이벤트 행과 그 효과(발송함 행)를 한 트랜잭션으로 커밋한다. 커밋된 뒤에야 메모리 상태 교체·실시간 알림·성공 응답이 나간다.
// 5. (범위, seq) 유일 제약에 걸리면(다른 인스턴스가 먼저 씀) 최신 로그를 읽고 다시 계산한다.
import { STATE_FORMAT, checkEvent, isInvalidEvent, isNotImplemented, isStateFormatError, type EngineEffect, type EngineEvent, type EngineState } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { scopeLockKey } from './db/schema.ts'
import type { ErrorCode, FieldProblem } from './errors.ts'
import type { IdSource } from './ids.ts'
import { errorKind, type LogSink } from './log.ts'
import { easyProblems } from './messages.ts'
import { FAILED_INPUT_MESSAGE, catchUp, loadRuntime, type EngineAdapter, type ScopeRuntime } from './runtime.ts'
import { sha256Hex } from './secrets.ts'
import {
  chatEventSeq,
  effectIdsAt,
  ensureScope,
  eventByRequestId,
  insertEvents,
  insertOutbox,
  insertSnapshot,
  type NewEventRow,
  type NewOutboxRow,
  type RequestRecord,
} from './store.ts'
import type { Clock } from './time.ts'

/** 누가 보낸 입력인지 (DAT-05) */
export type Actor = { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'server' } | { readonly kind: 'collector' }

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
}

export interface BuildContext {
  readonly state: EngineState
  /** 이 범위의 첫 기록인지 (차단 이어받기) */
  readonly isNewScope: boolean
  /** 첫 이벤트가 받을 at (서버 시계, 범위 안에서 줄지 않음) */
  readonly at: number
}

export interface WriteJob {
  readonly sellerId: string
  readonly date: string
  /** 범위가 없으면(이벤트 0개) 404 대신 만든다 (방송 만들기) */
  readonly createScope: boolean
  readonly requestId: string | null
  readonly chat?: { readonly b: string; readonly id: string }
  /** 트랜잭션 전에 미리 읽을 것 (차단 이어받기 목록). 범위가 새로울 때만 부른다 */
  readonly prepare?: () => Promise<unknown>
  /** 쓸 이벤트들. 첫 이벤트가 요청의 결과(요청 번호)다 */
  readonly build: (ctx: BuildContext, prepared: unknown) => readonly Draft[] | Rejection
  /** 같은 트랜잭션에서 더 쓸 것 (방송 목록) */
  readonly afterInsert?: (tx: Db, scopeId: string, records: readonly CommittedRecord[], now: Date) => Promise<void>
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
  readonly seq: number
  readonly type: string
  readonly changed: boolean
  readonly failed: boolean
  readonly effects: readonly string[]
  /** 기록한 엔진 이벤트 (응답을 만들 때 읽는다 — 응답에 그대로 내보내지 않는다) */
  readonly event: Readonly<Record<string, unknown>>
}

export type WriteOutcome =
  | { readonly kind: 'ok'; readonly result: WriteResult; readonly records: readonly CommittedRecord[] }
  | { readonly kind: 'duplicate'; readonly result: WriteResult | null }
  | { readonly kind: 'rejected'; readonly rejection: Rejection }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'save_failed' }

/** 시험용 주입점 */
export interface WriterHooks {
  /** 커밋 직전(트랜잭션 안). 던지면 롤백 — 저장 실패 주입 */
  readonly beforeCommit?: (records: readonly CommittedRecord[]) => void | Promise<void>
  /** 커밋 직후·메모리 교체 전. 던지면 "응답 전에 멈춤"을 흉내 낸다(메모리·알림 없음) */
  readonly afterCommit?: (records: readonly CommittedRecord[]) => void | Promise<void>
  /** 스냅샷 쓰기 직전. 던지면 스냅샷 쓰기 실패 */
  readonly beforeSnapshot?: () => void | Promise<void>
}

export interface CommitListener {
  (sellerId: string, date: string, records: readonly CommittedRecord[]): void
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
}

const MAX_SEQ_RETRIES = 5

class Abort {
  readonly outcome: WriteOutcome
  constructor(outcome: WriteOutcome) {
    this.outcome = outcome
  }
}

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

export function eventDigest(scopeId: string, seq: number, type: string, body: string, failed: boolean): string {
  return sha256Hex(JSON.stringify([scopeId, seq, type, body, failed]))
}

/** 범위(판매자, 날짜)마다 한 줄로 처리하는 기록기 */
export class ScopeWriter {
  readonly #options: WriterOptions
  readonly #runtimes = new Map<string, Promise<ScopeRuntime>>()
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(options: WriterOptions) {
    this.#options = options
  }

  /** 범위마다 한 줄: 같은 범위의 작업은 앞 작업이 끝난 뒤 시작한다 */
  serial<T>(sellerId: string, date: string, task: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([sellerId, date])
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

  /** 범위 상태 (처음이면 DB에서 불러온다). serial 안에서 쓴다 */
  async runtime(sellerId: string, date: string): Promise<ScopeRuntime> {
    const key = JSON.stringify([sellerId, date])
    let loading = this.#runtimes.get(key)
    if (loading === undefined) {
      loading = loadRuntime(this.#options.db, sellerId, date, this.#options.engine, this.#options.log)
      this.#runtimes.set(key, loading)
      loading.catch(() => this.#runtimes.delete(key))
    }
    return loading
  }

  /** 메모리 상태를 버린다 (다음에 DB에서 다시 불러온다) */
  forget(sellerId: string, date: string): void {
    this.#runtimes.delete(JSON.stringify([sellerId, date]))
  }

  /** 최신 로그까지 따라잡은 범위 상태 (조회용) */
  read(sellerId: string, date: string): Promise<ScopeRuntime> {
    return this.serial(sellerId, date, async () => {
      const runtime = await this.runtime(sellerId, date)
      await catchUp(this.#options.db, runtime, this.#options.engine, this.#options.log)
      return runtime
    })
  }

  write(job: WriteJob): Promise<WriteOutcome> {
    return this.serial(job.sellerId, job.date, () => this.#write(job))
  }

  async #write(job: WriteJob): Promise<WriteOutcome> {
    const { db, engine, log } = this.#options
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      let runtime: ScopeRuntime
      try {
        runtime = await this.runtime(job.sellerId, job.date)
        await catchUp(db, runtime, engine, log)
      } catch (error) {
        this.forget(job.sellerId, job.date)
        log({ level: 'error', code: 'SAVE_FAILED', date: job.date, errorKind: errorKind(error) })
        return { kind: 'save_failed' }
      }
      if (!job.createScope && runtime.seq === 0) return { kind: 'not_found' }
      const prepared = runtime.seq === 0 && job.prepare !== undefined ? await job.prepare() : undefined
      let committed: { records: CommittedRecord[]; state: EngineState; seq: number; lastAt: number; scopeId: string }
      try {
        committed = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(job.sellerId, job.date)})`)
          await catchUp(tx, runtime, engine, log)
          if (!job.createScope && runtime.seq === 0) throw new Abort({ kind: 'not_found' })
          if (job.requestId !== null) {
            const existing = await eventByRequestId(tx, job.sellerId, job.requestId)
            if (existing !== null) throw new Abort({ kind: 'duplicate', result: await resultOf(tx, job.sellerId, existing) })
          }
          if (job.chat !== undefined && (await chatEventSeq(tx, job.sellerId, job.chat.b, job.chat.id)) !== null) {
            throw new Abort({ kind: 'duplicate', result: null })
          }
          const computed = this.#compute(job, runtime, prepared)
          if ('rejection' in computed) throw new Abort({ kind: 'rejected', rejection: computed.rejection })
          const now = new Date(this.#options.clock.now())
          const scopeId = runtime.scopeId ?? (await ensureScope(tx, job.sellerId, job.date, this.#options.ids.scope(), now))
          await insertEvents(tx, computed.records.map((record, index) => eventRow(job, scopeId, record, computed.drafts[index] as Draft, now)))
          await insertOutbox(tx, computed.records.flatMap((record) => outboxRows(job.sellerId, scopeId, record, now)))
          await job.afterInsert?.(tx, scopeId, computed.records, now)
          await this.#options.hooks.beforeCommit?.(computed.records)
          return { records: computed.records, state: computed.state, seq: computed.seq, lastAt: computed.lastAt, scopeId }
        })
      } catch (error) {
        if (error instanceof Abort) {
          if (error.outcome.kind === 'rejected' && error.outcome.rejection.code === 'STATE_FORMAT') this.forget(job.sellerId, job.date)
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
  ): { records: CommittedRecord[]; drafts: readonly Draft[]; state: EngineState; seq: number; lastAt: number } | { rejection: Rejection } {
    const { engine, log, clock } = this.#options
    const firstAt = Math.max(clock.now(), runtime.lastAt)
    const drafts = job.build({ state: runtime.state, isNewScope: runtime.seq === 0, at: firstAt }, prepared)
    if (!Array.isArray(drafts)) return { rejection: drafts as Rejection }
    let state = runtime.state
    let seq = runtime.seq
    let lastAt = runtime.lastAt
    const records: CommittedRecord[] = []
    for (const draft of drafts as readonly Draft[]) {
      seq += 1
      lastAt = Math.max(clock.now(), lastAt, firstAt)
      const event = { ...draft.fields, seq, at: lastAt } as unknown as EngineEvent
      let problems
      try {
        problems = checkEvent(state, event)
      } catch (error) {
        if (isStateFormatError(error)) return { rejection: stateFormatRejection() }
        throw error
      }
      if (problems.length > 0) return { rejection: invalid(easyProblems(problems, event as unknown as Record<string, unknown>)) }
      const extra = draft.validate?.(state, event) ?? null
      if (extra !== null) return { rejection: extra }
      try {
        const result = engine.applyEvent(state, event)
        records.push({ event, seq, type: event.type, changed: result.state !== state, failed: false, effects: result.effects })
        state = result.state
      } catch (error) {
        if (isInvalidEvent(error)) return { rejection: invalid(easyProblems(error.problems, event as unknown as Record<string, unknown>)) }
        if (isNotImplemented(error)) return { rejection: { status: 422, code: 'NOT_SUPPORTED', message: '아직 지원하지 않는 기능이에요.', problems: [] } }
        if (isStateFormatError(error)) return { rejection: stateFormatRejection() }
        // 엔진이 예상하지 못한 오류: 실패 표시로 기록하고 상태는 그 전 그대로 (AC-S04-24)
        log({ level: 'error', code: 'ENGINE_FAILED', date: job.date, seq, errorKind: errorKind(error) })
        records.push({ event, seq, type: event.type, changed: false, failed: true, effects: [] })
      }
    }
    return { records, drafts: drafts as readonly Draft[], state, seq, lastAt }
  }

  async #afterCommit(
    job: WriteJob,
    runtime: ScopeRuntime,
    committed: { records: CommittedRecord[]; state: EngineState; seq: number; lastAt: number; scopeId: string },
  ): Promise<WriteOutcome> {
    const { hooks, onCommit, log } = this.#options
    try {
      await hooks.afterCommit?.(committed.records)
    } catch (error) {
      // 응답 전에 멈춘 것처럼: 메모리·알림을 바꾸지 않는다. 다음에 읽거나 쓸 때 로그에서 따라잡는다
      log({ level: 'error', code: 'REQUEST_FAILED', date: job.date, seq: committed.seq, errorKind: errorKind(error) })
      throw error
    }
    runtime.state = committed.state
    runtime.seq = committed.seq
    runtime.lastAt = committed.lastAt
    runtime.scopeId = committed.scopeId
    runtime.sinceSnapshot += committed.records.length
    for (const record of committed.records) {
      if (record.failed) runtime.attention = [...runtime.attention, { seq: record.seq, message: FAILED_INPUT_MESSAGE }]
    }
    try {
      onCommit(job.sellerId, job.date, committed.records)
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
      result: {
        date: job.date,
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

function eventRow(job: WriteJob, scopeId: string, record: CommittedRecord, draft: Draft, now: Date): NewEventRow {
  const body = JSON.stringify(record.event)
  return {
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
    digest: eventDigest(scopeId, record.seq, record.type, body, record.failed),
  }
}

function outboxRows(sellerId: string, scopeId: string, record: CommittedRecord, now: Date): NewOutboxRow[] {
  return record.effects.map((effect) => ({
    sellerId,
    scopeId,
    effectId: effect.id,
    seq: record.seq,
    kind: effect.kind,
    body: JSON.stringify(effect),
    createdAt: now,
  }))
}

/** 요청 번호로 기록한 이벤트의 결과 (처음 응답과 같은 모양) */
export async function resultOf(db: Db, sellerId: string, record: RequestRecord): Promise<WriteResult> {
  return {
    date: record.date,
    seq: record.seq,
    type: record.type,
    changed: record.changed,
    failed: record.failed,
    effects: await effectIdsAt(db, sellerId, record.scopeId, record.seq),
    event: JSON.parse(record.body) as Record<string, unknown>,
  }
}
