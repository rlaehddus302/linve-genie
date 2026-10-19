// 감사 메시지 발송함 실행기 (AC-Y1-30~46, R-13, D-Y01·D-Y06~D-Y08·D-Y12).
// - 행은 outbox-store.ts의 함수로만 고르고 바꾼다(rehearsal = false 고정, RA-S05-002). 감사(POST_THANKS)와 방송 후 요약 댓글만 다룬다.
// - 처음 볼 때: 효과가 나온 때(행이 생긴 시각) 그 대상의 동의가 없었으면 보내지 못함(NO_CONSENT). 실시간 채팅은 묶음 창(설정, 할당량 묶음 모드면 ≥ 60초)에 넣는다.
// - 보내기 직전: 기한(실시간 채팅 10분·영상 댓글 24시간·요약 24시간) → 그 범위의 지금 엔진 상태(취소 → 건너뜀, 완료 → 게시됨) → 연결·권한·이은 방송·
//   채팅 끝남·할당량 → 문구(묶음·200자 분할) → 한 문장으로 SENDING을 잡고(실행기 둘이 같은 행을 잡지 않는다) 게시한다.
// - 게시가 성공하면 메시지(댓글) ID·시각을 적고 SENT, 그 메시지에 든 효과마다 effect.thanksSent를 조치자 server로 기록한다(요청 번호 = 행에서 정함 — 한 번만).
//   보고 기록이 실패하면 보고만 다시 한다(다시 게시하지 않는다).
// - 타임아웃·연결 끊김(응답을 모름)은 바로 다시 보내지 않고 SENDING인 채 확인한다: 그 시도를 시작한 시각 − 5초 뒤 우리 채널이 같은 글을 올렸는지
//   (수집기가 본 우리 메시지, 수집기가 돌지 않으면 최근 채팅 조회 한 번 — 영상 댓글은 최근 댓글 조회 한 번). 30초 안에 찾으면 SENT, 못 찾으면 실패 한 번.
//   서버가 SENDING 행을 남긴 채 죽었다 살아나면 그 행은 임대가 지난 뒤 확인부터 한다.
// - 다시 시도: 2·4·8·16·32초 뒤 최대 5번, 그래도 안 되면 GAVE_UP. 다시 시도해도 소용없는 오류는 바로 보내지 못함.
// - 실패·재시도·건너뜀은 엔진 이벤트로 기록하지 않는다(effect.failed 없음, D-Y01).
import { formatWon, getBroadcast, getBuyer, listClaims, listEffects, listProducts, type EngineEffect, type EngineState } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { ScopeWriter } from '../writer.ts'
import { YoutubeAccessError, googleFields, type ConsentTarget, type YoutubeConnections } from './connect.ts'
import { batchWindowOf } from './collector.ts'
import { GoogleError, POST_TIMEOUT_MS, type GoogleClient } from './google.ts'
import {
  dueRows,
  failWaiting,
  findRow,
  groupRows,
  insertSummaryRows,
  newThanksRows,
  openWindowAt,
  rowByResendRequest,
  scopeDates,
  scopeRows,
  sendingRows,
  unreportedRows,
  updateRows,
  type RowChange,
  type RunnerRow,
} from './outbox-store.ts'
import type { QuotaMeter } from './quota.ts'
import { activeLink, findOwnMessage, insertOwnMessage, latestLink, markChatEnded, markSummaryDone, summaryCandidates, type LinkRow } from './store.ts'
import { SUMMARY_KIND, batchMessages, commentText, liveChatText, summaryComments, type SummaryLine } from './texts.ts'
import type { Timer } from './timer.ts'

export type OutboxState = 'WAITING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED'
export type OutboxTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT' | 'SUMMARY'

export const OUTBOX_STATE_MESSAGES: Readonly<Record<OutboxState, string>> = {
  WAITING: '기다림',
  SENDING: '보내는 중',
  SENT: '게시됨',
  SKIPPED: '건너뜀',
  FAILED: '보내지 못함',
}

/** 이유 코드와 판매자에게 보이는 문장 (AC-Y1-32) */
export const OUTBOX_REASON_MESSAGES = {
  // 보내지 못함
  NO_CONSENT: '자동 게시에 동의하기 전의 감사예요.',
  NO_LINK: '이어진 유튜브 방송이 없어요.',
  CHAT_ENDED: '유튜브 채팅이 끝났어요.',
  NO_PERMISSION: '게시 권한이 없어요.',
  EXPIRED: '너무 늦어 보내지 않았어요.',
  GAVE_UP: '여러 번 보내지 못했어요.',
  REJECTED: '유튜브가 받지 않았어요.',
  SEALED: '30일이 지나 보내지 않았어요.',
  // 건너뜀
  CANCELLED: '확정이 풀린 판매라 보내지 않아요.',
  // 기다림
  WINDOW: '묶어서 보내려고 기다리는 중이에요.',
  RETRY: '다시 보내려고 기다리는 중이에요.',
  RECONNECT: '유튜브 연결을 다시 해 주세요.',
  QUOTA: '오늘 유튜브 사용량이 얼마 남지 않아 기다리는 중이에요.',
  // 보내는 중 (타임아웃 확인)
  CONFIRM: '올라갔는지 확인하는 중이에요.',
  CONFIRM_LISTED: '올라갔는지 확인하는 중이에요.',
} as const
export type OutboxReason = keyof typeof OUTBOX_REASON_MESSAGES

/** 수동 재전송 문장 (AC-Y1-38) */
export const RESEND_MESSAGES = {
  CANCELLED: '확정이 풀린 판매라 보내지 않아요.',
  ALREADY_SENT: '이미 게시된 감사예요.',
  QUOTA_PAUSED: '오늘 유튜브 사용량이 얼마 남지 않아 채팅 수집에 남겨 둬요.',
  NOT_ALLOWED: '다시 보낼 수 없는 감사예요.',
} as const

/** 자동 게시 기한 (AC-Y1-37) */
export const LIVE_CHAT_DEADLINE_MS = 10 * 60 * 1000
export const COMMENT_DEADLINE_MS = 24 * 60 * 60 * 1000
/** 다시 시도 (AC-Y1-35): 2·4·8·16·32초, 최대 5번 */
export const MAX_RETRIES = 5
/** 타임아웃 확인 (AC-Y1-36) */
export const CONFIRM_WINDOW_MS = 30_000
export const CONFIRM_SLACK_MS = 5000
/** 보내는 중 임대 (서버가 죽으면 이 시간이 지난 뒤 확인부터) */
export const SENDING_LEASE_MS = 60_000
/** 할당량 묶음 모드의 실시간 채팅 최소 창 (AC-Y1-40·52) */
export const BATCH_MODE_WINDOW_SEC = 60
/** 방송 후 요약은 끝낸 뒤 이만큼 (AC-Y1-46) */
export const SUMMARY_DELAY_MS = 10 * 60 * 1000
/** 기다림을 다시 볼 간격 (연결·할당량) */
const RECHECK_MS = 5000

export interface OutboxHooks {
  /** 게시 응답을 받은 직후·SENT로 적기 전 (시험: 던지면 서버가 죽은 것처럼 그 행을 SENDING인 채 둔다) */
  readonly afterPost?: (rowIds: readonly number[]) => void | Promise<void>
}

export interface OutboxOptions {
  readonly db: Db
  readonly timer: Timer
  readonly log: LogSink
  readonly google: GoogleClient
  readonly connections: YoutubeConnections
  readonly quota: QuotaMeter
  readonly writer: ScopeWriter
  /** 이 서버(인스턴스)의 이름 (보내는 중 임대 주인) */
  readonly owner: string
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 그 연결의 수집기가 지금 도는지 (서버 어디서든 — 타임아웃 확인에서 최근 채팅 조회를 할지) */
  readonly collectorRunning: (sellerId: string, linkId: string) => Promise<boolean>
  readonly hooks?: OutboxHooks
  /** 기본 순회 간격 (밀리초, 기본 1000) */
  readonly tickMs?: number
}

export interface OutboxRowView {
  readonly id: number
  readonly target: OutboxTarget
  readonly broadcast: string | null
  readonly product: string | null
  readonly buyer: string | null
  readonly text: string
  readonly state: OutboxState
  readonly stateMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  readonly attempts: number
  readonly nextAt: string | null
  readonly postedAt: string | null
  readonly messageId: string | null
  readonly manual: boolean
  /** 같은 메시지로 함께 보낸(보낼) 다른 행 */
  readonly groupWith: readonly number[]
}

class Killed extends Error {
  constructor() {
    super('killed')
    this.name = 'Killed'
  }
}

const effectOf = (row: RunnerRow): EngineEffect | null => {
  try {
    return JSON.parse(row.body) as EngineEffect
  } catch {
    return null
  }
}

const targetOf = (row: RunnerRow): OutboxTarget => {
  if (row.kind === SUMMARY_KIND) return 'SUMMARY'
  const target = (row.target ?? effectOf(row)?.target) as OutboxTarget | null
  return target === 'VIDEO_COMMENT' ? 'VIDEO_COMMENT' : 'LIVE_CHAT'
}

export function outboxRowView(row: RunnerRow, all: readonly RunnerRow[] = []): OutboxRowView {
  const effect = row.kind === SUMMARY_KIND ? null : effectOf(row)
  const target = targetOf(row)
  const state = (row.state ?? 'WAITING') as OutboxState
  const reason = row.reason
  const text = row.postText ?? (effect?.text === null || effect?.text === undefined ? '' : target === 'LIVE_CHAT' ? liveChatText(effect.text) : commentText(effect.text))
  return {
    id: row.id,
    target,
    broadcast: row.broadcastId ?? effect?.broadcast ?? null,
    product: effect?.product ?? null,
    buyer: effect?.buyer ?? null,
    text,
    state,
    stateMessage: OUTBOX_STATE_MESSAGES[state],
    reason,
    reasonMessage: reason !== null && reason in OUTBOX_REASON_MESSAGES ? OUTBOX_REASON_MESSAGES[reason as OutboxReason] : null,
    attempts: row.attempts,
    nextAt: state === 'WAITING' ? (row.nextAt?.toISOString() ?? null) : null,
    postedAt: row.postedAt?.toISOString() ?? null,
    messageId: row.remoteId,
    manual: row.manual,
    groupWith: row.groupId === null ? [] : all.filter((other) => other.groupId === row.groupId && other.id !== row.id).map((other) => other.id),
  }
}

export class OutboxRunner {
  readonly #options: OutboxOptions
  #loop: Promise<void> | null = null
  #stopped = false
  #killed = false
  #wake = new AbortController()
  #inflight = new AbortController()
  #running: Promise<void> | null = null

  constructor(options: OutboxOptions) {
    this.#options = options
  }

  get owner(): string {
    return this.#options.owner
  }

  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        await this.runOnce()
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#options.timer.sleep(this.#options.tickMs ?? 1000, this.#wake.signal)
      }
    })()
  }

  /** 곧 한 바퀴 돌게 한다 (새 효과·연결·동의가 바뀜) */
  notify(): void {
    this.#wake.abort()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    await this.#running
    this.#loop = null
  }

  /** 서버가 죽은 것처럼 멈춘다 (보내던 요청을 끊고 더 쓰지 않는다 — 시험용) */
  async kill(): Promise<void> {
    this.#killed = true
    this.#stopped = true
    this.#inflight.abort()
    this.#wake.abort()
    await this.#loop?.catch(() => {})
    await this.#running?.catch(() => {})
    this.#loop = null
  }

  #check(): void {
    if (this.#killed) throw new Killed()
  }

  /** 한 바퀴: 처음 보는 행 → 서버가 죽은 뒤 남은 행 → 타임아웃 확인 → 때가 된 행 보내기 → 게시 보고 → 방송 후 요약 */
  async runOnce(): Promise<void> {
    if (this.#running !== null) return this.#running
    this.#running = (async () => {
      const steps = [() => this.#intake(), () => this.#confirmAll(), () => this.#sendDue(), () => this.#reportAll(), () => this.#summaries()]
      for (const step of steps) {
        if (this.#killed) return
        try {
          await step()
        } catch (error) {
          if (error instanceof Killed || this.#killed) return
          this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', errorKind: errorKind(error) })
        }
      }
    })().finally(() => {
      this.#running = null
    })
    return this.#running
  }

  #now(): Date {
    return new Date(this.#options.timer.now())
  }

  async #update(row: Pick<RunnerRow, 'sellerId'>, ids: readonly number[], change: RowChange, expect?: Parameters<typeof updateRows>[5]): Promise<number[]> {
    this.#check()
    return updateRows(this.#options.db, row.sellerId, ids, change, this.#now(), expect)
  }

  #publishRows(sellerId: string, date: string | null, ids: readonly number[], state: string, reason: string | null): void {
    if (ids.length === 0) return
    this.#options.publish(sellerId, { kind: 'outbox', ...(date === null ? {} : { date }), ids: [...ids], state, reason })
  }

  /** 범위 상태 (한 바퀴 안에서 범위마다 한 번) */
  async #state(cache: Map<string, EngineState>, sellerId: string, date: string): Promise<EngineState> {
    const key = `${sellerId}|${date}`
    let state = cache.get(key)
    if (state === undefined) {
      state = (await this.#options.writer.read(sellerId, date, false)).state
      cache.set(key, state)
    }
    return state
  }

  // ── 처음 보는 행 (AC-Y1-31·37·40) ─────────────────────────────────────

  async #intake(): Promise<void> {
    const rows = await newThanksRows(this.#options.db)
    if (rows.length === 0) return
    const states = new Map<string, EngineState>()
    const modes = new Map<string, string>()
    for (const row of rows) {
      const effect = effectOf(row)
      if (effect === null || effect.text === null) {
        await this.#update(row, [row.id], { state: 'FAILED', reason: 'REJECTED' }, { state: null })
        continue
      }
      const target: ConsentTarget = effect.target === 'VIDEO_COMMENT' ? 'VIDEO_COMMENT' : 'LIVE_CHAT'
      const created = row.createdAt.getTime()
      const connection = await this.#options.connections.row(row.sellerId)
      const consentAt = connection === null ? null : target === 'LIVE_CHAT' ? connection.consentLiveChatAt : connection.consentVideoCommentAt
      const base: RowChange = {
        target,
        broadcastId: effect.broadcast,
        deadlineAt: new Date(created + (target === 'LIVE_CHAT' ? LIVE_CHAT_DEADLINE_MS : COMMENT_DEADLINE_MS)),
        postText: target === 'LIVE_CHAT' ? liveChatText(effect.text) : commentText(effect.text),
      }
      // 효과가 나온 때 그 대상의 동의가 없었으면 나중에 켜도 자동으로 보내지 않는다 (D-Y12)
      if (consentAt === null || consentAt.getTime() > created) {
        await this.#update(row, [row.id], { ...base, state: 'FAILED', reason: 'NO_CONSENT' }, { state: null })
        this.#publishRows(row.sellerId, row.date, [row.id], 'FAILED', 'NO_CONSENT')
        continue
      }
      if (target === 'VIDEO_COMMENT') {
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: null, nextAt: row.createdAt, groupId: `g${String(row.id)}` }, { state: null })
        this.#publishRows(row.sellerId, row.date, [row.id], 'WAITING', null)
        continue
      }
      const state = await this.#state(states, row.sellerId, row.date)
      let mode = modes.get(row.sellerId)
      if (mode === undefined) {
        mode = await this.#options.quota.mode(row.sellerId)
        modes.set(row.sellerId, mode)
      }
      const setting = batchWindowOf(state, effect.broadcast)
      const windowSec = mode === 'NORMAL' ? setting : Math.max(setting, BATCH_MODE_WINDOW_SEC)
      if (windowSec <= 0) {
        // 묶지 않고 한 건씩 바로
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: null, nextAt: row.createdAt, groupId: `g${String(row.id)}` }, { state: null })
      } else {
        const open = await openWindowAt(this.#options.db, row.sellerId, row.scopeId, effect.broadcast, row.createdAt)
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: 'WINDOW', nextAt: open ?? new Date(created + windowSec * 1000) }, { state: null })
      }
      this.#publishRows(row.sellerId, row.date, [row.id], 'WAITING', windowSec <= 0 ? null : 'WINDOW')
    }
  }

  // ── 때가 된 행 보내기 ─────────────────────────────────────────────────

  async #sendDue(): Promise<void> {
    const rows = await dueRows(this.#options.db, this.#now())
    if (rows.length === 0) return
    const units = new Map<string, RunnerRow[]>()
    for (const row of rows) {
      // 묶이기를 기다리는 실시간 채팅 감사(묶음 없음)는 그 방송끼리, 나머지는 묶음(메시지)마다
      const key = row.groupId === null ? (targetOf(row) === 'LIVE_CHAT' ? `w|${row.sellerId}|${row.scopeId}|${row.broadcastId ?? ''}` : `s|${String(row.id)}`) : `g|${row.sellerId}|${row.groupId}`
      const list = units.get(key) ?? []
      list.push(row)
      units.set(key, list)
    }
    const states = new Map<string, EngineState>()
    await Promise.all(
      [...units.values()].map((unit) =>
        this.#sendUnit(unit, states).catch((error: unknown) => {
          if (error instanceof Killed || this.#killed) return
          this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', seller: unit[0]?.sellerId ?? '', errorKind: errorKind(error) })
        }),
      ),
    )
  }

  /** 행 묶음 하나(같은 방송의 창, 또는 한 메시지)를 확인하고 보낸다 */
  async #sendUnit(unit: RunnerRow[], states: Map<string, EngineState>): Promise<void> {
    const first = unit[0] as RunnerRow
    const { sellerId, date } = first
    const now = this.#now()
    const target = targetOf(first)
    let rows = [...unit].sort((a, b) => a.id - b.id)
    // 1. 기한 (수동 재전송은 기한 없음)
    const expired = rows.filter((row) => !row.manual && row.deadlineAt !== null && row.deadlineAt.getTime() <= now.getTime())
    if (expired.length > 0) {
      const ids = await this.#update(first, expired.map((row) => row.id), { state: 'FAILED', reason: 'EXPIRED', nextAt: null }, { state: 'WAITING' })
      this.#publishRows(sellerId, date, ids, 'FAILED', 'EXPIRED')
      rows = rows.filter((row) => !expired.includes(row))
    }
    if (rows.length === 0) return
    // 2. 지금 엔진 상태 (R-13 실행 직전): 취소 → 건너뜀, 완료 → 게시됨
    if (first.kind === 'POST_THANKS') {
      rows = await this.#engineCheck(rows, await this.#state(states, sellerId, date))
      if (rows.length === 0) return
    }
    // 3. 연결·권한·이은 방송·채팅·할당량
    const blocked = await this.#gate(rows, target)
    if (blocked) return
    const link = (await activeLink(this.#options.db, sellerId, rows[0]?.broadcastId ?? '')) as LinkRow
    // 4. 문구와 메시지
    if (target === 'LIVE_CHAT') {
      const messages = batchMessages(rows.map((row) => ({ id: row.id, text: effectOf(row)?.text ?? row.postText ?? '' })))
      for (const message of messages) {
        const members = rows.filter((row) => message.ids.includes(row.id))
        await this.#attempt(members, message.text, link, target)
      }
      return
    }
    const text = target === 'SUMMARY' ? (first.postText ?? '') : commentText(effectOf(first)?.text ?? first.postText ?? '')
    await this.#attempt(rows.slice(0, 1), text, link, target)
    for (const rest of rows.slice(1)) await this.#attempt([rest], target === 'SUMMARY' ? (rest.postText ?? '') : commentText(effectOf(rest)?.text ?? ''), link, target)
  }

  /** 엔진 상태로 거른다: 취소된 효과는 SKIPPED, 이미 완료면 SENT(게시 없음). 남은 행 */
  async #engineCheck(rows: RunnerRow[], state: EngineState): Promise<RunnerRow[]> {
    const statuses = new Map(listEffects(state).map((effect) => [effect.id, effect.status]))
    const cancelled = rows.filter((row) => statuses.get(row.effectId) === 'CANCELLED')
    const done = rows.filter((row) => statuses.get(row.effectId) === 'DONE')
    const first = rows[0] as RunnerRow
    if (cancelled.length > 0) {
      const ids = await this.#update(first, cancelled.map((row) => row.id), { state: 'SKIPPED', reason: 'CANCELLED', nextAt: null, groupId: null })
      this.#publishRows(first.sellerId, first.date, ids, 'SKIPPED', 'CANCELLED')
    }
    if (done.length > 0) {
      const ids = await this.#update(first, done.map((row) => row.id), { state: 'SENT', reason: null, nextAt: null, reported: true, groupId: null })
      this.#publishRows(first.sellerId, first.date, ids, 'SENT', null)
    }
    return rows.filter((row) => !cancelled.includes(row) && !done.includes(row))
  }

  /** 보낼 수 없으면 행을 기다림·보내지 못함으로 바꾸고 true */
  async #gate(rows: RunnerRow[], target: OutboxTarget): Promise<boolean> {
    const first = rows[0] as RunnerRow
    const { sellerId, date } = first
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const fail = async (reason: OutboxReason) => {
      const changed = await this.#update(first, ids, { state: 'FAILED', reason, nextAt: null }, { state: 'WAITING' })
      this.#publishRows(sellerId, date, changed, 'FAILED', reason)
      return true
    }
    const wait = async (reason: OutboxReason) => {
      const changed = await this.#update(first, ids, { reason, nextAt: new Date(now.getTime() + RECHECK_MS) }, { state: 'WAITING' })
      if (rows.some((row) => row.reason !== reason)) this.#publishRows(sellerId, date, changed, 'WAITING', reason)
      return true
    }
    const connection = await this.#options.connections.row(sellerId)
    if (connection === null) return fail('NO_CONSENT')
    if (connection.status !== 'CONNECTED') return wait('RECONNECT')
    if (!connection.canPublish) return fail('NO_PERMISSION')
    const link = await activeLink(this.#options.db, sellerId, first.broadcastId ?? '')
    if (link === null) return fail('NO_LINK')
    if (target === 'LIVE_CHAT' && link.chatEndedAt !== null) return fail('CHAT_ENDED')
    const mode = await this.#options.quota.mode(sellerId)
    if (mode === 'PAUSED') return wait('QUOTA')
    if (mode === 'BATCH' && target !== 'LIVE_CHAT' && rows.some((row) => !row.manual)) return wait('QUOTA')
    return false
  }

  /** 한 메시지 시도: SENDING을 잡고 → (지난 시도의 글이 올라가 있으면 SENT) → 게시 */
  async #attempt(rows: RunnerRow[], text: string, link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const groupId = first.groupId ?? `g${String(Math.min(...ids))}`
    // 지난 시도(5xx 등)의 글이 수집기에 보였으면 다시 보내지 않는다
    if (first.attempts > 0 && first.sentText !== null && first.attemptAt !== null && target === 'LIVE_CHAT') {
      const seen = await findOwnMessage(this.#options.db, first.sellerId, link.liveChatId, first.sentText, new Date(first.attemptAt.getTime() - CONFIRM_SLACK_MS))
      if (seen !== null) {
        const claimed = await this.#update(first, ids, { state: 'SENDING', groupId, leaseOwner: this.#options.owner, leaseUntil: new Date(now.getTime() + SENDING_LEASE_MS) }, { state: 'WAITING' })
        if (claimed.length === ids.length) await this.#sent(rows, seen)
        return
      }
    }
    const claimed = await this.#update(
      first,
      ids,
      {
        state: 'SENDING',
        reason: null,
        groupId,
        sentText: text,
        postText: text,
        attemptAt: now,
        confirmUntil: null,
        nextAt: null,
        leaseOwner: this.#options.owner,
        leaseUntil: new Date(now.getTime() + SENDING_LEASE_MS),
      },
      { state: 'WAITING' },
    )
    if (claimed.length !== ids.length) {
      // 다른 실행기가 일부를 먼저 잡았다 — 잡은 것을 되돌리고 이번엔 넘긴다
      if (claimed.length > 0) await this.#update(first, claimed, { state: 'WAITING', leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      return
    }
    this.#publishRows(first.sellerId, first.date, ids, 'SENDING', null)
    const sending = rows.map((row) => ({ ...row, groupId, sentText: text, attemptAt: now, state: 'SENDING' }))
    let remoteId: string
    try {
      const body = await this.#options.connections.withToken(first.sellerId, (token) =>
        target === 'LIVE_CHAT'
          ? this.#options.google.api({
              sellerId: first.sellerId,
              method: 'liveChatMessages.insert',
              accessToken: token,
              httpMethod: 'POST',
              path: '/liveChat/messages',
              query: { part: 'snippet' },
              body: { snippet: { liveChatId: link.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
              timeoutMs: POST_TIMEOUT_MS,
              signal: this.#inflight.signal,
            })
          : this.#options.google.api({
              sellerId: first.sellerId,
              method: 'commentThreads.insert',
              accessToken: token,
              httpMethod: 'POST',
              path: '/commentThreads',
              query: { part: 'snippet' },
              body: { snippet: { videoId: link.videoId, topLevelComment: { snippet: { textOriginal: text } } } },
              timeoutMs: POST_TIMEOUT_MS,
              signal: this.#inflight.signal,
            }),
      )
      this.#check()
      remoteId = typeof body.id === 'string' ? body.id : ''
    } catch (error) {
      this.#check()
      await this.#postFailed(sending, error, link, target)
      return
    }
    await this.#options.hooks?.afterPost?.(ids)
    this.#check()
    if (target === 'LIVE_CHAT' && remoteId !== '') {
      await insertOwnMessage(this.#options.db, { sellerId: first.sellerId, scopeId: first.scopeId, liveChatId: link.liveChatId, messageId: remoteId, text, publishedAt: now })
    }
    await this.#sent(sending, remoteId === '' ? null : remoteId)
  }

  /** 게시 실패 처리 (AC-Y1-35·36) */
  async #postFailed(rows: RunnerRow[], error: unknown, link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const { log, quota } = this.#options
    const back = async (reason: OutboxReason, delayMs: number) => {
      const changed = await this.#update(first, ids, { state: 'WAITING', reason, nextAt: new Date(now.getTime() + delayMs), leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      this.#publishRows(first.sellerId, first.date, changed, 'WAITING', reason)
    }
    const fail = async (reason: OutboxReason) => {
      const changed = await this.#update(first, ids, { state: 'FAILED', reason, nextAt: null, leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      this.#publishRows(first.sellerId, first.date, changed, 'FAILED', reason)
    }
    if (error instanceof YoutubeAccessError) return back('RECONNECT', RECHECK_MS)
    if (!(error instanceof GoogleError)) {
      log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, errorKind: errorKind(error) })
      return this.#failAttempt(rows)
    }
    log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, ...googleFields(error) })
    // 응답을 모른다(타임아웃·연결 끊김): 바로 다시 보내지 않고 올라갔는지 확인한다
    if (error.kind === 'timeout' || error.kind === 'network') {
      await this.#update(first, ids, { reason: 'CONFIRM', confirmUntil: new Date(now.getTime() + CONFIRM_WINDOW_MS) }, { state: 'SENDING', leaseOwner: this.#options.owner })
      await this.#confirm(rows.map((row) => ({ ...row, reason: 'CONFIRM', confirmUntil: new Date(now.getTime() + CONFIRM_WINDOW_MS) })), link, target)
      return
    }
    const reason = error.reason
    if (reason === 'quotaExceeded') {
      await quota.markExceeded(first.sellerId)
      return back('QUOTA', RECHECK_MS)
    }
    if (reason === 'liveChatEnded' || reason === 'liveChatDisabled') {
      if (reason === 'liveChatEnded') await markChatEnded(this.#options.db, first.sellerId, link.id, now)
      return fail('CHAT_ENDED')
    }
    if (reason === 'forbidden' || reason === 'insufficientPermissions') return fail('NO_PERMISSION')
    const status = error.status ?? 0
    if (status >= 500 || status === 429 || status === 401 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return this.#failAttempt(rows)
    return fail('REJECTED')
  }

  /** 실패 한 번: 2·4·8·16·32초 뒤 다시, 5번을 넘으면 GAVE_UP */
  async #failAttempt(rows: RunnerRow[]): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const attempts = first.attempts + 1
    const now = this.#now()
    if (attempts > MAX_RETRIES) {
      const changed = await this.#update(first, ids, { state: 'FAILED', reason: 'GAVE_UP', attempts, nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null }, { state: 'SENDING' })
      this.#publishRows(first.sellerId, first.date, changed, 'FAILED', 'GAVE_UP')
      return
    }
    const changed = await this.#update(
      first,
      ids,
      { state: 'WAITING', reason: 'RETRY', attempts, nextAt: new Date(now.getTime() + 2 ** attempts * 1000), leaseOwner: null, leaseUntil: null, confirmUntil: null },
      { state: 'SENDING' },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'WAITING', 'RETRY')
  }

  /** 게시됨: ID·시각을 적고 효과마다 게시 보고 */
  async #sent(rows: RunnerRow[], remoteId: string | null): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const changed = await this.#update(
      first,
      ids,
      { state: 'SENT', reason: null, remoteId, postedAt: this.#now(), nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null },
      { state: 'SENDING' },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'SENT', null)
    await this.#report(rows.filter((row) => changed.includes(row.id)))
  }

  // ── 게시 보고 (AC-Y1-34) ──────────────────────────────────────────────

  async #report(rows: readonly RunnerRow[]): Promise<void> {
    for (const row of rows) {
      if (row.kind !== 'POST_THANKS') continue
      this.#check()
      const requestId = `ytsent-${String(row.id)}`
      const outcome = await this.#options.writer.write({
        sellerId: row.sellerId,
        date: row.date,
        rehearsal: false,
        createScope: false,
        requestId,
        build: () => [{ fields: { type: 'effect.thanksSent', effectId: row.effectId }, actor: { kind: 'server' }, requestId }],
      })
      // 기록됐거나(같은 요청 번호면 처음 것) 더 쓸 수 없는 범위(봉인)면 보고를 마친다. 저장 실패면 다음 바퀴에 보고만 다시
      if (outcome.kind === 'ok' || outcome.kind === 'duplicate' || outcome.kind === 'empty' || (outcome.kind === 'rejected' && outcome.rejection.code === 'SEALED')) {
        await this.#update(row, [row.id], { reported: true })
      } else {
        this.#options.log({ level: 'warn', code: 'OUTBOX_REPORT_FAILED', seller: row.sellerId, date: row.date })
      }
    }
  }

  async #reportAll(): Promise<void> {
    const rows = await unreportedRows(this.#options.db)
    await this.#report(rows)
  }

  // ── 타임아웃 확인·서버가 죽은 뒤 (AC-Y1-36) ────────────────────────────

  async #confirmAll(): Promise<void> {
    const rows = await sendingRows(this.#options.db)
    if (rows.length === 0) return
    const now = this.#now()
    const groups = new Map<string, RunnerRow[]>()
    for (const row of rows) {
      const key = `${row.sellerId}|${row.groupId ?? String(row.id)}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const group of groups.values()) {
      const first = group[0] as RunnerRow
      const confirming = first.reason === 'CONFIRM' || first.reason === 'CONFIRM_LISTED'
      const leaseLive = first.leaseUntil !== null && first.leaseUntil.getTime() > now.getTime()
      if (!confirming && leaseLive) continue // 다른 실행기가 보내는 중
      if (confirming && leaseLive && first.leaseOwner !== this.#options.owner) continue
      let rowsNow = group
      if (!confirming || first.leaseOwner !== this.#options.owner) {
        // 서버가 죽은 뒤 남은 행(임대 지남): 확인부터 한다. 임대를 넘겨받는다(한 문장)
        const until = new Date(now.getTime() + SENDING_LEASE_MS)
        const confirmUntil = first.confirmUntil ?? new Date(now.getTime() + CONFIRM_WINDOW_MS)
        const ids = group.map((row) => row.id)
        const claimed = await this.#update(first, ids, { reason: confirming ? first.reason : 'CONFIRM', confirmUntil, leaseOwner: this.#options.owner, leaseUntil: until }, { state: 'SENDING', ...(first.leaseOwner === null ? {} : { leaseOwner: first.leaseOwner }) })
        if (claimed.length !== ids.length) continue
        rowsNow = group.map((row) => ({ ...row, reason: confirming ? row.reason : 'CONFIRM', confirmUntil, leaseOwner: this.#options.owner, leaseUntil: until }))
      }
      const target = targetOf(first)
      const link = await latestLink(this.#options.db, first.sellerId, first.broadcastId ?? '')
      if (link === null) {
        await this.#failAttempt(rowsNow)
        continue
      }
      await this.#confirm(rowsNow, link, target)
    }
  }

  /** 그 시도의 글이 올라갔는지 본다. 찾으면 SENT, 확인 시간이 지나면 실패 한 번, 아니면 다음 바퀴에 다시 */
  async #confirm(rows: RunnerRow[], link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const text = first.sentText
    const since = first.attemptAt === null ? new Date(0) : new Date(first.attemptAt.getTime() - CONFIRM_SLACK_MS)
    const ids = rows.map((row) => row.id)
    if (text === null) {
      await this.#failAttempt(rows)
      return
    }
    let found: string | null = null
    if (target === 'LIVE_CHAT') {
      found = await findOwnMessage(this.#options.db, first.sellerId, link.liveChatId, text, since)
      if (found === null && first.reason === 'CONFIRM' && !(await this.#options.collectorRunning(first.sellerId, link.id))) {
        found = await this.#listChat(first, link, text, since)
        await this.#update(first, ids, { reason: 'CONFIRM_LISTED' }, { state: 'SENDING' })
      }
    } else if (first.reason === 'CONFIRM') {
      found = await this.#listComments(first, link, text, since)
      await this.#update(first, ids, { reason: 'CONFIRM_LISTED' }, { state: 'SENDING' })
    }
    if (found !== null) {
      await this.#sent(rows, found)
      return
    }
    const until = first.confirmUntil?.getTime() ?? 0
    if (this.#options.timer.now() >= until) await this.#failAttempt(rows)
  }

  /** 최근 채팅 조회 한 번 (수집기가 돌지 않을 때) — 우리 채널이 쓴 같은 글 */
  async #listChat(row: RunnerRow, link: LinkRow, text: string, since: Date): Promise<string | null> {
    try {
      const body = await this.#options.connections.withToken(row.sellerId, (token) =>
        this.#options.google.api({ sellerId: row.sellerId, method: 'liveChatMessages.list', accessToken: token, path: '/liveChat/messages', query: { liveChatId: link.liveChatId, part: 'snippet,authorDetails', maxResults: '2000' }, signal: this.#inflight.signal }),
      )
      const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
      for (const item of items) {
        const snippet = (item.snippet ?? {}) as Record<string, unknown>
        const author = (item.authorDetails ?? {}) as Record<string, unknown>
        const message = ((snippet.textMessageDetails ?? {}) as Record<string, unknown>).messageText
        const published = Date.parse(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : '')
        if (author.channelId === link.channelId && message === text && published >= since.getTime() && typeof item.id === 'string') return item.id
      }
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: row.sellerId, ...googleFields(error) })
    }
    return null
  }

  /** 최근 댓글 조회 한 번 — 우리 채널이 쓴 같은 글 */
  async #listComments(row: RunnerRow, link: LinkRow, text: string, since: Date): Promise<string | null> {
    try {
      const body = await this.#options.connections.withToken(row.sellerId, (token) =>
        this.#options.google.api({ sellerId: row.sellerId, method: 'commentThreads.list', accessToken: token, path: '/commentThreads', query: { part: 'snippet', videoId: link.videoId, order: 'time', maxResults: '50' }, signal: this.#inflight.signal }),
      )
      const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
      for (const item of items) {
        const top = ((((item.snippet ?? {}) as Record<string, unknown>).topLevelComment ?? {}) as Record<string, unknown>)
        const snippet = (top.snippet ?? {}) as Record<string, unknown>
        const author = ((snippet.authorChannelId ?? {}) as Record<string, unknown>).value
        const published = Date.parse(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : '')
        if (author === link.channelId && snippet.textOriginal === text && published >= since.getTime() && typeof item.id === 'string') return item.id
      }
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: row.sellerId, ...googleFields(error) })
    }
    return null
  }

  // ── 방송 후 요약 댓글 (AC-Y1-46) ──────────────────────────────────────

  async #summaries(): Promise<void> {
    const { db, timer, connections } = this.#options
    const now = timer.now()
    for (const candidate of await summaryCandidates(db, new Date(now - SUMMARY_DELAY_MS))) {
      this.#check()
      const { link, date } = candidate
      const runtime = await this.#options.writer.read(link.sellerId, date, false)
      const settings = getBroadcast(runtime.state, link.broadcastId)?.settings
      const texts = settings?.['thanks.videoComment'] === 'SUMMARY' ? summaryComments(summaryLines(runtime.state, link.broadcastId)) : []
      if (texts.length === 0) {
        await markSummaryDone(db, link.sellerId, link.id, new Date(now))
        continue
      }
      const connection = await connections.row(link.sellerId)
      const consent = connection?.consentVideoCommentAt ?? null
      const scopeId = link.scopeId
      await db.transaction(async (tx) => {
        if (!(await markSummaryDone(tx, link.sellerId, link.id, new Date(now)))) return
        await insertSummaryRows(
          tx,
          texts.map((text, index) => ({
            sellerId: link.sellerId,
            scopeId,
            effectId: `summary:${link.broadcastId}:${String(index + 1)}`,
            seq: runtime.seq,
            body: JSON.stringify({ kind: SUMMARY_KIND, broadcast: link.broadcastId, part: index + 1 }),
            broadcastId: link.broadcastId,
            text,
            state: consent === null ? 'FAILED' : 'WAITING',
            reason: consent === null ? 'NO_CONSENT' : null,
            now: new Date(now),
            deadlineAt: new Date(now + COMMENT_DEADLINE_MS),
          })),
        )
      })
      this.#options.publish(link.sellerId, { kind: 'outbox', date, summary: link.broadcastId })
    }
  }

  // ── 판매자 조작 ───────────────────────────────────────────────────────

  /** 동의를 껐다·연결을 끊었다: 그 대상의 기다리던 자동 게시 행 → 보내지 못함(NO_CONSENT) */
  async consentOff(sellerId: string, targets: readonly ConsentTarget[], includeManual: boolean): Promise<void> {
    const list: string[] = [...targets]
    if (targets.includes('VIDEO_COMMENT')) list.push('SUMMARY')
    const rows = await failWaiting(this.#options.db, sellerId, { targets: list, ...(includeManual ? {} : { manual: false }) }, 'NO_CONSENT', this.#now())
    await this.#publishFailed(sellerId, rows, 'NO_CONSENT')
  }

  /** 방송 연결을 끊었다: 그 방송의 기다리던 실시간 채팅 감사 → 보내지 못함(NO_LINK) (AC-Y1-13) */
  async unlinked(sellerId: string, broadcastId: string): Promise<void> {
    const rows = await failWaiting(this.#options.db, sellerId, { targets: ['LIVE_CHAT'], broadcastId }, 'NO_LINK', this.#now())
    await this.#publishFailed(sellerId, rows, 'NO_LINK')
  }

  /** 유튜브 채팅이 끝났다: 그 방송의 기다리던 실시간 채팅 감사 → 보내지 못함(CHAT_ENDED) */
  async chatEnded(sellerId: string, broadcastId: string): Promise<void> {
    const rows = await failWaiting(this.#options.db, sellerId, { targets: ['LIVE_CHAT'], broadcastId }, 'CHAT_ENDED', this.#now())
    await this.#publishFailed(sellerId, rows, 'CHAT_ENDED')
  }

  async #publishFailed(sellerId: string, rows: readonly { id: number; scopeId: string }[], reason: string): Promise<void> {
    if (rows.length === 0) return
    const dates = await scopeDates(this.#options.db, sellerId, rows.map((row) => row.scopeId))
    const byDate = new Map<string, number[]>()
    for (const row of rows) {
      const date = dates.get(row.scopeId) ?? ''
      byDate.set(date, [...(byDate.get(date) ?? []), row.id])
    }
    for (const [date, ids] of byDate) this.#publishRows(sellerId, date === '' ? null : date, ids, 'FAILED', reason)
  }

  /** 날짜(실제 범위)의 행 목록 (AC-Y1-39) */
  async list(sellerId: string, scopeId: string): Promise<OutboxRowView[]> {
    const rows = await scopeRows(this.#options.db, sellerId, scopeId)
    return rows.map((row) => outboxRowView(row, rows))
  }

  /**
   * 수동 재전송 (AC-Y1-38). FAILED 행 하나만, 같은 요청 번호는 한 번만. 그때 엔진 상태를 다시 보고, 동의는 필요 없지만 게시 권한·연결·이은 방송(실시간 채팅이면 열린 채팅)이 있어야 하고
   * 할당량 멈춤이면 받지 않는다. 받으면 한 건씩(묶지 않고) 다시 시도·타임아웃 규칙을 처음부터 — 기한은 없다
   */
  async resend(
    sellerId: string,
    rowId: number,
    requestId: string,
  ): Promise<
    | { kind: 'ok'; row: OutboxRowView }
    | { kind: 'not_found' }
    | { kind: 'rejected'; code: 'EFFECT_CANCELLED' | 'ALREADY_SENT' | 'RESEND_NOT_ALLOWED' | 'NO_PERMISSION' | 'NOT_LINKED' | 'CHAT_ENDED' | 'YOUTUBE_RECONNECT_NEEDED' | 'QUOTA_PAUSED'; message: string; row?: OutboxRowView }
  > {
    const { db } = this.#options
    const prior = await rowByResendRequest(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.id !== rowId) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
      return { kind: 'ok', row: outboxRowView(prior) }
    }
    const row = await findRow(db, sellerId, rowId)
    if (row === null) return { kind: 'not_found' }
    if (row.state !== 'FAILED') return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED, row: outboxRowView(row) }
    const target = targetOf(row)
    const now = this.#now()
    if (row.kind === 'POST_THANKS') {
      const state = (await this.#options.writer.read(sellerId, row.date, false)).state
      const status = listEffects(state).find((effect) => effect.id === row.effectId)?.status
      if (status === 'CANCELLED') {
        await updateRows(db, sellerId, [row.id], { state: 'SKIPPED', reason: 'CANCELLED', resendRequestId: requestId }, now, { state: 'FAILED' })
        this.#publishRows(sellerId, row.date, [row.id], 'SKIPPED', 'CANCELLED')
        return { kind: 'rejected', code: 'EFFECT_CANCELLED', message: RESEND_MESSAGES.CANCELLED }
      }
      if (status === 'DONE') {
        await updateRows(db, sellerId, [row.id], { state: 'SENT', reason: null, reported: true, resendRequestId: requestId }, now, { state: 'FAILED' })
        this.#publishRows(sellerId, row.date, [row.id], 'SENT', null)
        return { kind: 'rejected', code: 'ALREADY_SENT', message: RESEND_MESSAGES.ALREADY_SENT }
      }
    }
    const connection = await this.#options.connections.row(sellerId)
    if (connection === null || connection.status !== 'CONNECTED') return { kind: 'rejected', code: 'YOUTUBE_RECONNECT_NEEDED', message: OUTBOX_REASON_MESSAGES.RECONNECT }
    if (!connection.canPublish) return { kind: 'rejected', code: 'NO_PERMISSION', message: OUTBOX_REASON_MESSAGES.NO_PERMISSION }
    const link = await activeLink(db, sellerId, row.broadcastId ?? '')
    if (link === null) return { kind: 'rejected', code: 'NOT_LINKED', message: OUTBOX_REASON_MESSAGES.NO_LINK }
    if (target === 'LIVE_CHAT' && link.chatEndedAt !== null) return { kind: 'rejected', code: 'CHAT_ENDED', message: OUTBOX_REASON_MESSAGES.CHAT_ENDED }
    if ((await this.#options.quota.mode(sellerId)) === 'PAUSED') return { kind: 'rejected', code: 'QUOTA_PAUSED', message: RESEND_MESSAGES.QUOTA_PAUSED }
    const effect = effectOf(row)
    const text = target === 'SUMMARY' ? (row.postText ?? '') : target === 'LIVE_CHAT' ? liveChatText(effect?.text ?? '') : commentText(effect?.text ?? '')
    const changed = await updateRows(
      db,
      sellerId,
      [row.id],
      {
        state: 'WAITING',
        reason: null,
        manual: true,
        deadlineAt: null,
        attempts: 0,
        groupId: `m${String(row.id)}-${requestId}`,
        nextAt: now,
        postText: text,
        sentText: null,
        attemptAt: null,
        confirmUntil: null,
        remoteId: null,
        resendRequestId: requestId,
      },
      now,
      { state: 'FAILED' },
    )
    if (changed.length === 0) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
    this.#publishRows(sellerId, row.date, [row.id], 'WAITING', null)
    this.notify()
    const fresh = await findRow(db, sellerId, row.id)
    return { kind: 'ok', row: outboxRowView(fresh ?? row) }
  }

  /** 그 행이 속한 묶음의 행들 (시험·조회) */
  group(sellerId: string, groupId: string): Promise<RunnerRow[]> {
    return groupRows(this.#options.db, sellerId, groupId)
  }
}

/**
 * 방송 후 요약 줄 (AC-Y1-46): 그 방송의 확정 판매(지금 엔진 상태) — 번호 순, 같은 번호는 확정 순서.
 * 품종 = 지금 상품 이름, 가격 = 그 찜의 가격 스냅샷, 구매자 = 그 찜의 구매자 자신의 지금 표시 이름(문자 구매자·문자찜으로 생긴 찜은 늘 `문자찜`)
 */
export function summaryLines(state: EngineState, broadcastId: string): SummaryLine[] {
  const products = listProducts(state).filter((product) => product.broadcast === broadcastId)
  const claims = new Map(listClaims(state).map((claim) => [claim.id, claim]))
  const lines: SummaryLine[] = []
  for (const product of [...products].sort((a, b) => a.no - b.no)) {
    for (const claimId of product.winnerClaims) {
      const claim = claims.get(claimId)
      if (claim === undefined || claim.status !== 'CONFIRMED') continue
      const buyer = getBuyer(state, claim.buyer)
      const sms = claim.origin === 'sms' || buyer?.kind === 'sms'
      lines.push({ no: product.no, name: product.name, price: formatWon(claim.price ?? product.price), buyer: sms ? '문자찜' : (buyer?.display ?? '시청자') })
    }
  }
  return lines
}
