// 감사 메시지 발송함 실행기 (AC-Y1-30~46, R-13, D-Y01·D-Y06~D-Y08·D-Y12).
// - 행은 outbox-store.ts의 함수로만 고르고 바꾼다(rehearsal = false 고정, RA-S05-002). 감사(POST_THANKS)와 방송 후 요약 댓글만 다룬다.
// - 처음 볼 때: 효과가 나온 때(행이 생긴 시각) 그 대상의 동의가 없었으면 보내지 못함(NO_CONSENT). 실시간 채팅은 묶음 창(설정, 할당량 묶음 모드면 ≥ 60초)에 넣는다.
// - 보내기 직전: 기한(실시간 채팅 10분·영상 댓글 24시간·요약 24시간) → 그 범위의 지금 엔진 상태(취소 → 건너뜀, 완료 → 게시됨) → 연결·
//   그 방송을 이은 채널 = 지금 연결한 채널(아니면 NOT_MY_CHANNEL, D-Y1-02)·권한·이은 방송·채팅 끝남·할당량 → 문구(묶음·200자 분할) →
//   한 문장으로 SENDING을 잡고(실행기 둘이 같은 행을 잡지 않는다) 게시한다.
// - 게시가 성공하면 메시지(댓글) ID·시각을 적고 SENT, 그 메시지에 든 효과마다 effect.thanksSent를 조치자 server로 기록한다(요청 번호 = 행에서 정함 — 한 번만).
//   보고 기록이 실패하면 보고만 다시 한다(다시 게시하지 않는다).
// - 타임아웃·연결 끊김(응답을 모름)은 바로 다시 보내지 않고 SENDING인 채 확인한다: 그 시도를 시작한 시각 − 5초 뒤 우리 채널이 같은 글을 올렸는지
//   (수집기가 본 우리 메시지는 바퀴마다, 수집기가 LIVE가 아니면 이른 조회 한 번 — 영상·요약 댓글은 최근 댓글 이른 조회 한 번). 찾으면 SENT.
//   다시 게시(실패 한 번)는 확인 시간(30초)이 끝난 뒤 그 시도 뒤의 글을 모두 본 조회(끝 조회)로도 못 찾았을 때만 한다(실시간 채팅은 지점 없는 첫 쪽이
//   기준 시각까지 거슬러 가야 모두 본 것 — RA-I3-001). 조회 실패·다 보지 못한 조회는 "조회함"이 아니다 —
//   끝 조회가 3번 실패하면 다시 게시하지 않고 FAILED(UNCONFIRMED), 게시 보고 없음, 판매자가 수동 재전송으로 고른다 (D-Y1-06).
//   찾은 메시지는 이미 다른 묶음이 가진 것이면 고르지 않고, 같은 글을 확인하는 묶음끼리는 효과 순서대로 짝짓는다 (D-Y1-03, outbox-store claimRemote).
//   서버가 SENDING 행을 남긴 채 죽었다 살아나면 그 행은 임대가 지난 뒤 확인부터 한다(확인 시간이 이미 지났으면 바로 끝 조회부터).
// - 다시 시도: 2·4·8·16·32초 뒤 최대 5번, 그래도 안 되면 GAVE_UP. 다시 시도해도 소용없는 오류는 바로 보내지 못함.
// - 실패·재시도·건너뜀은 엔진 이벤트로 기록하지 않는다(effect.failed 없음, D-Y01).
import { formatWon, getBroadcast, getBuyer, listClaims, listEffects, listProducts, type EngineEffect, type EngineState } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { Actor, ScopeWriter } from '../writer.ts'
import { ChannelMismatchError, YoutubeAccessError, googleFields, type ConsentTarget, type YoutubeConnections } from './connect.ts'
import { batchWindowOf } from './collector.ts'
import { GoogleError, POST_TIMEOUT_MS, type GoogleClient } from './google.ts'
import {
  claimRemote,
  confirmPostedRows,
  dismissRow,
  dueRows,
  failWaiting,
  findRow,
  groupRows,
  insertSummaryRows,
  newThanksRows,
  openWindowAt,
  rowByConfirmRequest,
  rowByResendRequest,
  scopeDates,
  scopeRows,
  sendingRows,
  unreportedRows,
  updateRows,
  type RemoteCandidate,
  type RowChange,
  type RunnerRow,
} from './outbox-store.ts'
import type { QuotaMeter } from './quota.ts'
import { activeLink, insertOwnMessage, latestLink, markChatEnded, markSummaryDone, summaryCandidates, type LinkRow } from './store.ts'
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
  NOT_MY_CHANNEL: '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.',
  CHAT_ENDED: '유튜브 채팅이 끝났어요.',
  NO_PERMISSION: '게시 권한이 없어요.',
  EXPIRED: '너무 늦어 보내지 않았어요.',
  GAVE_UP: '여러 번 보내지 못했어요.',
  REJECTED: '유튜브가 받지 않았어요.',
  UNCONFIRMED: '올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.',
  SEALED: '30일이 지나 보내지 않았어요.',
  // 건너뜀
  CANCELLED: '확정이 풀린 판매라 보내지 않아요.',
  // 기다림
  WINDOW: '묶어서 보내려고 기다리는 중이에요.',
  RETRY: '다시 보내려고 기다리는 중이에요.',
  RECONNECT: '유튜브 연결을 다시 해 주세요.',
  QUOTA: '오늘 유튜브 사용량이 얼마 남지 않아 기다리는 중이에요.',
  // 보내는 중 (타임아웃 확인): CONFIRM 이른 조회 전 · CONFIRM_LISTED 이른 조회로 못 찾음 · CONFIRM_LIST_FAILED 이른 조회 실패 — 모두 확인 시간 끝의 조회를 기다린다
  CONFIRM: '올라갔는지 확인하는 중이에요.',
  CONFIRM_LISTED: '올라갔는지 확인하는 중이에요.',
  CONFIRM_LIST_FAILED: '올라갔는지 확인하는 중이에요.',
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
/** 확인 시간이 끝난 뒤의 조회가 이만큼 실패하면 확인하지 못함(UNCONFIRMED) — 다시 게시하지 않는다 (AC-Y1-96) */
export const MAX_CONFIRM_TRIES = 3
/** 보내는 중 임대 (서버가 죽으면 이 시간이 지난 뒤 확인부터) */
export const SENDING_LEASE_MS = 60_000
/** 할당량 묶음 모드의 실시간 채팅 최소 창 (AC-Y1-40·52) */
export const BATCH_MODE_WINDOW_SEC = 60
/** 방송 후 요약은 끝낸 뒤 이만큼 (AC-Y1-46) */
export const SUMMARY_DELAY_MS = 10 * 60 * 1000
/** 기다림을 다시 볼 간격 (연결·할당량) */
const RECHECK_MS = 5000
/** 한 시도의 확인 조회: 이른 조회 1번 + 끝 조회 3번까지, 같은 행의 조회 사이는 10초 이상 (D-I3-17 (3), AC-I3-87) */
export const LOOKUP_INTERVAL_MS = 10_000
/** 조회 한 번이 따라가는 쪽 수 상한 — 이만큼 보고도 그 시도 뒤의 글을 다 보지 못하면 실패한 조회 (D-I3-17 (2), AC-I3-86) */
export const LOOKUP_MAX_PAGES = 5
/** 조회 한 쪽의 최대 수: 실시간 채팅(요청한 수보다 적게 오면 끝까지 본 것) · 댓글(최신순) */
export const LIVE_CHAT_LOOKUP_PAGE = 2000
export const COMMENT_LOOKUP_PAGE = 50

/** 발송함 시간 (운영 기본값 — E2E 기동만 줄인다, AC-I3-93) */
export interface OutboxTiming {
  /** 게시 응답 기다림 (기본 10초) */
  readonly postTimeoutMs?: number
  /** 타임아웃 확인 시간 (기본 30초) */
  readonly confirmWindowMs?: number
  /** 같은 행의 조회 사이 최소 간격 (기본 10초) */
  readonly lookupIntervalMs?: number
  /** 다시 시도 간격의 바탕 (기본 1000 — 2·4·8·16·32초) */
  readonly retryBaseMs?: number
  /** 실시간 채팅 조회 한 쪽의 최대 수 (기본 2000) */
  readonly liveChatLookupPage?: number
}

export interface OutboxHooks {
  /** 게시 응답을 받은 직후·SENT로 적기 전 (시험: 던지면 서버가 죽은 것처럼 그 행을 SENDING인 채 둔다) */
  readonly afterPost?: (rowIds: readonly number[]) => void | Promise<void>
  /** 직전 확인(연결·채널·동의)을 지나 SENDING을 잡은 뒤·토큰을 꺼내기 전 (시험: 여기서 연결을 끊고 다른 채널을 잇는다, AC-I3-85) */
  readonly beforePost?: (rowIds: readonly number[]) => void | Promise<void>
  /** 게시가 401을 받아 토큰을 새로 고치기 직전 (시험: 그사이 채널을 바꾼다, AC-I3-85) */
  readonly beforeRetryToken?: () => void | Promise<void>
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
  /** 바퀴마다 성공·실패 (워커 건강 — 연속 3번 실패면 경보, AC-I3-82) */
  readonly onPass?: (ok: boolean) => void
  /** 시간 (E2E 기동만 줄인다) */
  readonly timing?: OutboxTiming
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
  /** 판매자가 "유튜브에 올라가 있어요"로 게시됨을 적은 행 (메시지 ID 없음, AC-I3-36) */
  readonly confirmedBySeller: boolean
  /** 알림에서 뺀 행 (알림 띠 "감사 실패"에서 세지 않는다, AC-I3-36) */
  readonly dismissed: boolean
  readonly dismissedAt: string | null
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
    confirmedBySeller: row.confirmedBy !== null,
    dismissed: row.dismissedAt !== null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
  }
}

/** 게시됨 확인·알림에서 빼기 문장 (AC-I3-36) */
export const SELLER_OUTBOX_MESSAGES = {
  CONFIRM_NOT_ALLOWED: '확인하지 못한 감사만 올라가 있다고 적을 수 있어요.',
  DISMISS_NOT_ALLOWED: '보내지 못한 감사만 알림에서 뺄 수 있어요.',
  REHEARSAL_OUTBOX: '리허설 감사 메시지는 유튜브에 올리지 않아요.',
} as const

export class OutboxRunner {
  readonly #options: OutboxOptions
  #loop: Promise<void> | null = null
  #stopped = false
  #killed = false
  #wake = new AbortController()
  #inflight = new AbortController()
  #running: Promise<void> | null = null
  /** 이번 바퀴에 오류가 있었는지 */
  #passFailed = false

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
      this.#passFailed = false
      const steps = [() => this.#options.quota.tick(), () => this.#intake(), () => this.#confirmAll(), () => this.#sendDue(), () => this.#reportAll(), () => this.#summaries()]
      for (const step of steps) {
        if (this.#killed) return
        try {
          await step()
        } catch (error) {
          if (error instanceof Killed || this.#killed) return
          this.#passFailed = true
          this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', errorKind: errorKind(error) })
        }
      }
      if (!this.#killed) this.#options.onPass?.(!this.#passFailed)
    })().finally(() => {
      this.#running = null
    })
    return this.#running
  }

  #now(): Date {
    return new Date(this.#options.timer.now())
  }

  get #postTimeoutMs(): number {
    return this.#options.timing?.postTimeoutMs ?? POST_TIMEOUT_MS
  }

  get #confirmWindowMs(): number {
    return this.#options.timing?.confirmWindowMs ?? CONFIRM_WINDOW_MS
  }

  get #lookupIntervalMs(): number {
    return this.#options.timing?.lookupIntervalMs ?? LOOKUP_INTERVAL_MS
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
    // 같은 방송·대상의 메시지는 효과가 나온 순서대로 하나씩(채팅에 순서대로 보이게), 서로 다른 방송·대상끼리는 함께
    const lanes = new Map<string, RunnerRow[][]>()
    for (const unit of units.values()) {
      const first = unit[0] as RunnerRow
      const lane = `${first.sellerId}|${first.broadcastId ?? ''}|${targetOf(first)}`
      lanes.set(lane, [...(lanes.get(lane) ?? []), unit])
    }
    await Promise.all(
      [...lanes.values()].map(async (list) => {
        for (const unit of list.sort((a, b) => Math.min(...a.map((row) => row.id)) - Math.min(...b.map((row) => row.id)))) {
          try {
            await this.#sendUnit(unit)
          } catch (error) {
            if (error instanceof Killed || this.#killed) return
            this.#passFailed = true
            this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', seller: unit[0]?.sellerId ?? '', errorKind: errorKind(error) })
          }
        }
      }),
    )
  }

  /**
   * 행 묶음 하나(같은 방송의 창, 또는 한 메시지)를 확인하고 보낸다. 메시지(200자 분할 포함)를 하나 보낼 때마다 그 직전에
   * 그 범위의 지금 엔진 상태와 연결·동의·이은 방송·할당량을 다시 본다 — 앞 메시지가 응답 없이 10초 걸리는 동안 취소된 판매·꺼진 동의를 놓치지 않는다
   * (R-13 "실행 직전", AC-Y1-32·42, D-Y12)
   */
  async #sendUnit(unit: RunnerRow[]): Promise<void> {
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
    while (rows.length > 0) {
      this.#check()
      // 2. 지금 엔진 상태 (R-13 실행 직전 — 메시지마다 새로 읽는다): 취소 → 건너뜀, 완료 → 게시됨
      if (first.kind === 'POST_THANKS') {
        rows = await this.#engineCheck(rows, (await this.#options.writer.read(sellerId, date, false)).state)
        if (rows.length === 0) return
      }
      // 3. 연결·동의·권한·이은 방송·채팅·할당량
      const open = await this.#gate(rows, target)
      if (open === null || open.length === 0) return
      rows = open
      const link = await activeLink(this.#options.db, sellerId, rows[0]?.broadcastId ?? '')
      if (link === null) return
      // 4. 문구와 메시지 — 남은 항목으로 다시 만들고(AC-Y1-42) 첫 메시지 하나만 보낸다. 나머지는 위의 직전 확인부터 다시
      let members: RunnerRow[]
      let text: string
      if (target === 'LIVE_CHAT') {
        const [message] = batchMessages(rows.map((row) => ({ id: row.id, text: effectOf(row)?.text ?? row.postText ?? '' })))
        if (message === undefined) return
        members = rows.filter((row) => message.ids.includes(row.id))
        if (members.length === 0) return
        text = message.text
      } else {
        const head = rows[0] as RunnerRow
        members = [head]
        text = target === 'SUMMARY' ? (head.postText ?? '') : commentText(effectOf(head)?.text ?? head.postText ?? '')
      }
      await this.#attempt(members, text, link, target)
      rows = rows.filter((row) => !members.includes(row))
    }
  }

  /** 엔진 상태로 거른다: 취소된 효과는 SKIPPED, 이미 완료면 SENT(게시 없음). 남은 행 */
  async #engineCheck(rows: RunnerRow[], state: EngineState): Promise<RunnerRow[]> {
    const statuses = new Map(listEffects(state).map((effect) => [effect.id, effect.status]))
    const cancelled = rows.filter((row) => statuses.get(row.effectId) === 'CANCELLED')
    const done = rows.filter((row) => statuses.get(row.effectId) === 'DONE')
    const first = rows[0] as RunnerRow
    // 기다리는 행만 바꾼다 (다른 실행기가 그사이 잡은 행은 건드리지 않고 이번엔 넘긴다)
    let taken: number[] = []
    if (cancelled.length > 0) {
      const ids = await this.#update(first, cancelled.map((row) => row.id), { state: 'SKIPPED', reason: 'CANCELLED', nextAt: null, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SKIPPED', 'CANCELLED')
      taken = [...taken, ...cancelled.map((row) => row.id).filter((id) => !ids.includes(id))]
    }
    if (done.length > 0) {
      const ids = await this.#update(first, done.map((row) => row.id), { state: 'SENT', reason: null, nextAt: null, reported: true, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SENT', null)
      taken = [...taken, ...done.map((row) => row.id).filter((id) => !ids.includes(id))]
    }
    if (taken.length > 0) return []
    return rows.filter((row) => !cancelled.includes(row) && !done.includes(row))
  }

  /**
   * 보낼 수 있는 행만 남긴다. 보낼 수 없는 행은 기다림·보내지 못함으로 바꾼다(모두 막히면 null).
   * 채널: 그 방송을 이은 채널 ID = 지금 연결한 채널 ID일 때만 — 아니면 모두 NOT_MY_CHANNEL(동의보다 먼저 본다 — 다른 채널의 채팅·영상에는
   * 어떤 행도 게시하지 않는다, AC-Y1-92·D-Y1-02). 자동 첫 시도·다시 시도·묶음의 메시지마다·영상 댓글·요약 댓글·수동 재전송 뒤의 시도 모두 여기를 지난다.
   * 동의: 수동 재전송이 아니면 지금 그 대상의 동의가 켜져 있고 그 행이 생기기 전에 켠 것이어야 한다 — 확인 중(SENDING)에 동의를 끈 행이
   * 확인 실패 뒤 다시 시도로 돌아와도 게시하지 않는다(AC-Y1-31, D-Y12). 요약 댓글은 영상 댓글 동의를 본다
   */
  async #gate(rows: RunnerRow[], target: OutboxTarget): Promise<RunnerRow[] | null> {
    const first = rows[0] as RunnerRow
    const { sellerId, date } = first
    const now = this.#now()
    const failRows = async (list: readonly RunnerRow[], reason: OutboxReason) => {
      const changed = await this.#update(first, list.map((row) => row.id), { state: 'FAILED', reason, nextAt: null }, { state: 'WAITING' })
      this.#publishRows(sellerId, date, changed, 'FAILED', reason)
    }
    const fail = async (reason: OutboxReason) => {
      await failRows(rows, reason)
      return null
    }
    const wait = async (reason: OutboxReason) => {
      const changed = await this.#update(first, rows.map((row) => row.id), { reason, nextAt: new Date(now.getTime() + RECHECK_MS) }, { state: 'WAITING' })
      if (rows.some((row) => row.reason !== reason)) this.#publishRows(sellerId, date, changed, 'WAITING', reason)
      return null
    }
    const connection = await this.#options.connections.row(sellerId)
    if (connection === null) return fail('NO_CONSENT')
    const link = await activeLink(this.#options.db, sellerId, first.broadcastId ?? '')
    if (link !== null && link.channelId !== connection.channelId) return fail('NOT_MY_CHANNEL')
    const consentAt = target === 'LIVE_CHAT' ? connection.consentLiveChatAt : connection.consentVideoCommentAt
    const noConsent = rows.filter((row) => !row.manual && (consentAt === null || consentAt.getTime() > row.createdAt.getTime()))
    if (noConsent.length > 0) {
      await failRows(noConsent, 'NO_CONSENT')
      rows = rows.filter((row) => !noConsent.includes(row))
      if (rows.length === 0) return null
    }
    if (connection.status !== 'CONNECTED') return wait('RECONNECT')
    if (!connection.canPublish) return fail('NO_PERMISSION')
    if (link === null) return fail('NO_LINK')
    if (target === 'LIVE_CHAT' && link.chatEndedAt !== null) return fail('CHAT_ENDED')
    const mode = await this.#options.quota.mode(sellerId)
    if (mode === 'PAUSED') return wait('QUOTA')
    if (mode === 'BATCH' && target !== 'LIVE_CHAT' && rows.some((row) => !row.manual)) return wait('QUOTA')
    return rows
  }

  /** 한 메시지 시도: SENDING을 잡고 → (지난 시도의 글이 올라가 있으면 SENT) → 게시 */
  async #attempt(rows: RunnerRow[], text: string, link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const groupId = first.groupId ?? `g${String(Math.min(...ids))}`
    // 지난 시도(5xx·확인 실패 등)의 글이 수집기에 보였으면 다시 보내지 않는다 — 이미 다른 묶음이 가진 메시지는 고르지 않는다 (AC-Y1-36·93).
    // 같은 글을 지금 게시하는 중인 다른 묶음이 있으면 그 응답을 본 뒤로 미룬다(다음 바퀴)
    if (first.attempts > 0 && first.sentText !== null && first.attemptAt !== null && target === 'LIVE_CHAT') {
      const outcome = await this.#claim(rows, link, target, [], 'WAITING')
      if (outcome !== 'none') return
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
        confirmTries: 0,
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
    const sending = rows.map((row) => ({ ...row, groupId, sentText: text, attemptAt: now, state: 'SENDING', reason: null, confirmTries: 0 }))
    await this.#options.hooks?.beforePost?.(ids)
    this.#check()
    let remoteId: string
    try {
      // 그 방송을 이은 채널의 토큰으로만 — 꺼내는 순간 채널이 다르면 보내지 않는다 (D-I3-17 (1), AC-I3-85)
      const body = await this.#options.connections.withChannelToken(first.sellerId, link.channelId, (token) =>
        target === 'LIVE_CHAT'
          ? this.#options.google.api({
              sellerId: first.sellerId,
              method: 'liveChatMessages.insert',
              accessToken: token,
              httpMethod: 'POST',
              path: '/liveChat/messages',
              query: { part: 'snippet' },
              body: { snippet: { liveChatId: link.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
              timeoutMs: this.#postTimeoutMs,
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
              timeoutMs: this.#postTimeoutMs,
              signal: this.#inflight.signal,
            }),
        () => this.#options.hooks?.beforeRetryToken?.(),
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
    // 토큰을 꺼내는 순간 연결의 채널이 그 방송을 이은 채널과 달랐다 — 보내지 않았다 (묶음이면 함께, AC-I3-85)
    if (error instanceof ChannelMismatchError) return fail('NOT_MY_CHANNEL')
    if (error instanceof YoutubeAccessError) return back('RECONNECT', RECHECK_MS)
    if (!(error instanceof GoogleError)) {
      log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, errorKind: errorKind(error) })
      return this.#failAttempt(rows)
    }
    log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, ...googleFields(error) })
    // 응답을 모른다(타임아웃·연결 끊김): 바로 다시 보내지 않고 올라갔는지 확인한다
    if (error.kind === 'timeout' || error.kind === 'network') {
      const confirmUntil = new Date(now.getTime() + this.#confirmWindowMs)
      await this.#update(first, ids, { reason: 'CONFIRM', confirmUntil, nextAt: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      await this.#confirm(rows.map((row) => ({ ...row, reason: 'CONFIRM', confirmUntil, nextAt: null })), link, target)
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
      const changed = await this.#update(first, ids, { state: 'FAILED', reason: 'GAVE_UP', attempts, nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 }, { state: 'SENDING' })
      this.#publishRows(first.sellerId, first.date, changed, 'FAILED', 'GAVE_UP')
      if (changed.length > 0) this.#options.log({ level: 'warn', code: 'OUTBOX_GAVE_UP', seller: first.sellerId, date: first.date })
      return
    }
    const changed = await this.#update(
      first,
      ids,
      { state: 'WAITING', reason: 'RETRY', attempts, nextAt: new Date(now.getTime() + 2 ** attempts * (this.#options.timing?.retryBaseMs ?? 1000)), leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 },
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
      { state: 'SENT', reason: null, remoteId, postedAt: this.#now(), nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 },
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
      // 판매자가 "유튜브에 올라가 있어요"로 적은 행은 그 계정이 조치자다 (AC-I3-36·DAT-05) — 요청 번호는 같아 누가 먼저 써도 한 번만
      const actor: Actor = row.confirmedBy === null ? { kind: 'server' } : { kind: 'account', accountId: row.confirmedBy }
      const outcome = await this.#options.writer.write({
        sellerId: row.sellerId,
        date: row.date,
        rehearsal: false,
        createScope: false,
        requestId,
        build: () => [{ fields: { type: 'effect.thanksSent', effectId: row.effectId }, actor, requestId }],
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
      const confirming = first.reason === 'CONFIRM' || first.reason === 'CONFIRM_LISTED' || first.reason === 'CONFIRM_LIST_FAILED'
      const leaseLive = first.leaseUntil !== null && first.leaseUntil.getTime() > now.getTime()
      if (!confirming && leaseLive) continue // 다른 실행기가 보내는 중
      if (confirming && leaseLive && first.leaseOwner !== this.#options.owner) continue
      let rowsNow = group
      if (!confirming || first.leaseOwner !== this.#options.owner) {
        // 서버가 죽은 뒤 남은 행(임대 지남): 확인부터 한다. 임대를 넘겨받는다(한 문장). 게시 중에 죽은 행의 확인 시간은 그 시도의 타임아웃부터 30초 —
        // 임대(60초)가 지났으니 이미 끝났다: 바로 끝 조회부터 (AC-Y1-96)
        const until = new Date(now.getTime() + SENDING_LEASE_MS)
        const confirmUntil = first.confirmUntil ?? (first.attemptAt === null ? now : new Date(first.attemptAt.getTime() + this.#postTimeoutMs + this.#confirmWindowMs))
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

  /**
   * 그 시도의 글이 올라갔는지 본다 (AC-Y1-36·93·96). 찾으면 SENT, 아니면 다음 바퀴에 다시.
   * - 실시간 채팅: 수집기가 본 우리 메시지를 바퀴마다 본다. 수집기가 LIVE가 아니면 확인 시간 안에 이른 조회를 한 번 한다(실패해도 한 번).
   * - 영상·요약 댓글: 확인 시간 안에 최근 댓글 이른 조회를 한 번 한다.
   * - 확인 시간이 끝나면 끝 조회: 성공한 조회로 못 찾았을 때만 실패 한 번(다시 시도). 끝 조회 실패는 다음 바퀴에 다시, 3번이면 UNCONFIRMED
   */
  async #confirm(rows: RunnerRow[], link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    if (first.sentText === null) {
      await this.#failAttempt(rows)
      return
    }
    const owner = this.#options.owner
    const now = this.#options.timer.now()
    // 확인이 길어져도(조회 시간 제한·끝 조회 다시 하기) 다른 실행기가 이 행을 넘겨받지 않게 임대를 늘린다
    const kept = await this.#update(first, ids, { leaseUntil: new Date(now + SENDING_LEASE_MS) }, { state: 'SENDING', leaseOwner: owner })
    if (kept.length !== ids.length) return
    // 1. 수집기가 본 우리 메시지 (실시간 채팅, 바퀴마다 — 유튜브를 부르지 않는다)
    if (target === 'LIVE_CHAT' && (await this.#claim(rows, link, target, [], 'SENDING')) !== 'none') return
    // 같은 행의 조회 사이는 10초 이상 (AC-I3-87) — 확인 중인 행(SENDING)의 next_at = 다음 조회를 해도 되는 시각
    if (first.nextAt !== null && now < first.nextAt.getTime()) return
    const nextLookup = new Date(now + this.#lookupIntervalMs)
    const until = first.confirmUntil?.getTime() ?? 0
    if (now < until) {
      // 2. 이른 조회 (시도마다 한 번): 수집기가 LIVE가 아닌 실시간 채팅, 영상·요약 댓글
      if (first.reason !== 'CONFIRM') return
      if (target === 'LIVE_CHAT' && (await this.#options.collectorRunning(first.sellerId, link.id))) return
      const lookup = await this.#lookup(first, link, target)
      await this.#update(first, ids, { reason: lookup === null || !lookup.complete ? 'CONFIRM_LIST_FAILED' : 'CONFIRM_LISTED', nextAt: nextLookup }, { state: 'SENDING', leaseOwner: owner })
      if (lookup !== null) await this.#claim(rows, link, target, lookup.found, 'SENDING')
      return
    }
    // 3. 끝 조회 (확인 시간이 끝난 뒤, 3번까지): 그 시도 뒤의 글을 모두 본 조회로도 못 찾았을 때만 다시 게시한다.
    //    조회 실패·같은 글을 게시하는 중인 다른 묶음 때문에 짝짓기를 미룸은 모두 한 번으로 센다 — 3번 안에 정하지 못하면 UNCONFIRMED(다시 게시 없음)
    //    다 보지 못한 조회(실시간 채팅의 첫 쪽이 기준 시각까지 거슬러 가지 못함·5쪽 상한)는 찾은 글로 짝지을 수는 있어도, 못 찾음은 실패한 조회다 (RA-I3-001)
    const lookup = await this.#lookup(first, link, target)
    const claimed = lookup === null ? 'failed' : await this.#claim(rows, link, target, lookup.found, 'SENDING')
    const outcome = claimed === 'none' && lookup !== null && !lookup.complete ? 'failed' : claimed
    if (outcome === 'sent' || outcome === 'gone') return
    if (outcome === 'none') {
      await this.#failAttempt(rows)
      return
    }
    const tries = first.confirmTries + 1
    if (tries < MAX_CONFIRM_TRIES) {
      await this.#update(first, ids, { confirmTries: tries, nextAt: nextLookup }, { state: 'SENDING', leaseOwner: owner })
      return
    }
    // 확인하지 못했다: 다시 게시하지 않는다(두 번 게시보다 빠짐이 안전하다). 게시 보고도 하지 않는다 — 판매자가 유튜브를 보고 다시 보낸다
    const changed = await this.#update(
      first,
      ids,
      { state: 'FAILED', reason: 'UNCONFIRMED', confirmTries: tries, nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null },
      { state: 'SENDING', leaseOwner: owner },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'FAILED', 'UNCONFIRMED')
    if (changed.length > 0) this.#options.log({ level: 'warn', code: 'OUTBOX_UNCONFIRMED', seller: first.sellerId, date: first.date })
  }

  /**
   * 게시 확인 짝짓기 (AC-Y1-93): 찾은 후보와 수집기가 본 우리 메시지 중 이 묶음의 메시지를 골라 SENT로 적고 게시 보고를 한다.
   * sent(적음) · none(없음) · defer(같은 글을 게시하는 중인 묶음의 응답을 기다림) · gone(다른 실행기가 바꿈)
   */
  async #claim(rows: RunnerRow[], link: LinkRow, target: OutboxTarget, candidates: readonly RemoteCandidate[], state: 'SENDING' | 'WAITING'): Promise<'sent' | 'none' | 'defer' | 'gone'> {
    this.#check()
    const first = rows[0] as RunnerRow
    const result = await claimRemote(this.#options.db, {
      sellerId: first.sellerId,
      broadcastId: first.broadcastId ?? link.broadcastId,
      targets: target === 'LIVE_CHAT' ? ['LIVE_CHAT'] : ['VIDEO_COMMENT', 'SUMMARY'],
      text: first.sentText ?? '',
      selfIds: rows.map((row) => row.id),
      selfState: state,
      ...(state === 'SENDING' ? { selfOwner: this.#options.owner } : {}),
      liveChatId: target === 'LIVE_CHAT' ? link.liveChatId : null,
      candidates,
      slackMs: CONFIRM_SLACK_MS,
      now: this.#now(),
    })
    if (result.kind !== 'claimed') return result.kind
    this.#publishRows(first.sellerId, first.date, result.ids, 'SENT', null)
    await this.#report(rows.filter((row) => result.ids.includes(row.id)))
    return 'sent'
  }

  /**
   * 확인 조회 한 번 — 우리 채널이 쓴 같은 글 전부(그 시도 시작 − 5초 이후). 응답의 다음 쪽을 따라가며(많아야 5쪽, 쪽마다 할당량에 센다) 찾은 글과
   * 그 범위를 **모두 봤는지**(complete)를 돌려준다 (D-I3-17 (2), AC-I3-86). 못 찾음은 모두 본 조회일 때만 결과다 — 다 보지 못했으면 실패한 조회로 센다.
   * - 실시간 채팅: 지점 없는 첫 쪽은 채팅 처음이 아니라 최근 메시지 몇 개(실제 API)이고 다음 쪽은 그 뒤로만 간다. 그래서 첫 쪽이 기준 시각까지 거슬러
   *   가야(첫 쪽이 비었거나 — 그때 채팅에 메시지가 없었다 — 게시 시각을 아는 첫 항목이 기준 시각보다 이름) 그 뒤를 모두 본 것이다 (RA-I3-001).
   *   그 뒤로 받은 쪽이 꽉 차지 않을 때까지(요청한 최대 수보다 적게 옴·다음 쪽 없음) 따라간다.
   * - 댓글(최신순): 기준 시각보다 이른 항목이 나올 때까지(다음 쪽이 없으면 끝).
   * - 5쪽으로 끝까지 가지 못하면 다 보지 못한 것이다.
   * 조회하지 못하면 null: 네트워크·시간 제한·5xx·429·속도 제한·할당량 초과·권한 없음·401 뒤 새로 고침 실패, 다시 연결 필요, 할당량 멈춤이라 부르지 않음,
   * 그 방송을 이은 채널의 토큰을 꺼낼 수 없음(채널이 바뀜 — AC-I3-85)
   */
  async #lookup(row: RunnerRow, link: LinkRow, target: OutboxTarget): Promise<{ readonly found: RemoteCandidate[]; readonly complete: boolean } | null> {
    const { connections, google, quota, log } = this.#options
    const text = row.sentText ?? ''
    const since = row.attemptAt === null ? 0 : row.attemptAt.getTime() - CONFIRM_SLACK_MS
    const pageSize = target === 'LIVE_CHAT' ? (this.#options.timing?.liveChatLookupPage ?? LIVE_CHAT_LOOKUP_PAGE) : COMMENT_LOOKUP_PAGE
    const found: RemoteCandidate[] = []
    let pageToken: string | null = null
    /** 실시간 채팅: 첫 쪽이 기준 시각까지 거슬러 갔다 (댓글은 늘 참 — 최신순이라 기준 시각보다 이른 항목으로 끝을 안다) */
    let reachedSince = target !== 'LIVE_CHAT'
    for (let page = 0; page < LOOKUP_MAX_PAGES; page++) {
      if ((await quota.mode(row.sellerId)) === 'PAUSED') return null
      let body: Record<string, unknown>
      try {
        const query: Record<string, string> =
          target === 'LIVE_CHAT'
            ? { liveChatId: link.liveChatId, part: 'snippet,authorDetails', maxResults: String(pageSize) }
            : { part: 'snippet', videoId: link.videoId, order: 'time', maxResults: String(pageSize) }
        if (pageToken !== null) query.pageToken = pageToken
        body = await connections.withChannelToken(row.sellerId, link.channelId, (token) =>
          google.api({
            sellerId: row.sellerId,
            method: target === 'LIVE_CHAT' ? 'liveChatMessages.list' : 'commentThreads.list',
            accessToken: token,
            path: target === 'LIVE_CHAT' ? '/liveChat/messages' : '/commentThreads',
            query,
            signal: this.#inflight.signal,
          }),
        )
      } catch (error) {
        log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: row.sellerId, ...googleFields(error) })
        if (error instanceof GoogleError && error.reason === 'quotaExceeded') await quota.markExceeded(row.sellerId)
        return null
      }
      if (!Array.isArray(body.items)) return null
      const items = body.items as Record<string, unknown>[]
      let reachedOlder = false
      /** 이 쪽에서 게시 시각을 아는 첫 항목의 시각 */
      let firstPublished: number | null = null
      for (const item of items) {
        if (typeof item.id !== 'string') continue
        let author: unknown
        let message: unknown
        let published: number
        if (target === 'LIVE_CHAT') {
          const snippet = (item.snippet ?? {}) as Record<string, unknown>
          author = ((item.authorDetails ?? {}) as Record<string, unknown>).channelId
          message = ((snippet.textMessageDetails ?? {}) as Record<string, unknown>).messageText
          published = Date.parse(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : '')
          if (firstPublished === null && Number.isFinite(published)) firstPublished = published
        } else {
          const top = (((item.snippet ?? {}) as Record<string, unknown>).topLevelComment ?? {}) as Record<string, unknown>
          const snippet = (top.snippet ?? {}) as Record<string, unknown>
          author = ((snippet.authorChannelId ?? {}) as Record<string, unknown>).value
          message = snippet.textOriginal
          published = Date.parse(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : '')
          if (Number.isFinite(published) && published < since) reachedOlder = true
        }
        if (author === link.channelId && message === text && Number.isFinite(published) && published >= since) found.push({ id: item.id, publishedAt: published })
      }
      // 지점 없는 첫 쪽: 비었으면 그때 채팅에 메시지가 없었고, 첫 항목이 기준 시각보다 이르면 그 뒤를 모두 이 쪽부터 본다
      if (target === 'LIVE_CHAT' && page === 0) reachedSince = items.length === 0 || (firstPublished !== null && firstPublished < since)
      const next = typeof body.nextPageToken === 'string' && body.nextPageToken !== '' ? body.nextPageToken : null
      // 끝까지 갔다 (실시간 채팅은 첫 쪽이 기준 시각까지 거슬러 갔어야 모두 본 것이다)
      if (target === 'LIVE_CHAT' ? items.length < pageSize || next === null : reachedOlder || next === null) return { found, complete: reachedSince }
      pageToken = next
    }
    return { found, complete: false }
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
   * 수동 재전송 (AC-Y1-38). FAILED 행 하나만(확인하지 못함 UNCONFIRMED 포함 — 판매자가 유튜브를 보고 고른다), 같은 요청 번호는 한 번만.
   * 그때 엔진 상태를 다시 보고, 동의는 필요 없지만 연결·그 방송을 이은 채널 = 지금 연결한 채널(AC-Y1-92)·게시 권한·이은 방송(실시간 채팅이면 열린 채팅)이
   * 있어야 하고 할당량 멈춤이면 받지 않는다. 받으면 한 건씩(묶지 않고) 다시 시도·타임아웃 규칙을 처음부터 — 기한은 없다
   */
  async resend(
    sellerId: string,
    rowId: number,
    requestId: string,
  ): Promise<
    | { kind: 'ok'; row: OutboxRowView }
    | { kind: 'not_found' }
    | {
        kind: 'rejected'
        code: 'EFFECT_CANCELLED' | 'ALREADY_SENT' | 'RESEND_NOT_ALLOWED' | 'NO_PERMISSION' | 'NOT_LINKED' | 'NOT_MY_CHANNEL' | 'CHAT_ENDED' | 'YOUTUBE_RECONNECT_NEEDED' | 'QUOTA_PAUSED'
        message: string
        row?: OutboxRowView
      }
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
    const link = await activeLink(db, sellerId, row.broadcastId ?? '')
    // 그 방송을 이은 채널 = 지금 연결한 채널일 때만 (AC-Y1-92). 행은 그대로 FAILED
    if (link !== null && link.channelId !== connection.channelId) return { kind: 'rejected', code: 'NOT_MY_CHANNEL', message: OUTBOX_REASON_MESSAGES.NOT_MY_CHANNEL }
    if (!connection.canPublish) return { kind: 'rejected', code: 'NO_PERMISSION', message: OUTBOX_REASON_MESSAGES.NO_PERMISSION }
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
        confirmTries: 0,
        remoteId: null,
        resendRequestId: requestId,
        // 다시 보내면 "알림에서 뺌"은 뜻이 없다 — 또 실패하면 새 실패로 알린다 (AC-I3-36)
        dismissedAt: null,
        dismissedBy: null,
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

  /**
   * 게시됨 확인 (AC-I3-36, D-I3-05): 판매자가 유튜브에서 본 확인하지 못한 감사(FAILED(UNCONFIRMED))를 그 메시지의 행 모두 SENT로 적고
   * 효과마다 게시 보고(effect.thanksSent, 조치자 = 그 계정)를 기록한다 — 공개 감사가 나간 확정은 잠긴다(R-7 3). 확정이 이미 풀린 효과도 보고는 한다
   * (엔진이 잠금 없이 실행 완료로 둔다 — R-13 늦은 보고). 같은 요청 번호는 처음 결과. 다시 게시하지 않는다
   */
  async confirmPosted(
    sellerId: string,
    rowId: number,
    accountId: string,
    requestId: string,
  ): Promise<{ kind: 'ok'; rows: OutboxRowView[] } | { kind: 'not_found' } | { kind: 'rejected'; code: 'CONFIRM_NOT_ALLOWED'; message: string }> {
    const { db } = this.#options
    const prior = await rowByConfirmRequest(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.id !== rowId) return { kind: 'rejected', code: 'CONFIRM_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.CONFIRM_NOT_ALLOWED }
      return { kind: 'ok', rows: await this.#groupViews(sellerId, prior) }
    }
    const result = await confirmPostedRows(db, sellerId, rowId, accountId, requestId, this.#now())
    if (result.kind === 'not_found') return { kind: 'not_found' }
    if (result.kind === 'not_allowed') return { kind: 'rejected', code: 'CONFIRM_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.CONFIRM_NOT_ALLOWED }
    const row = await findRow(db, sellerId, rowId)
    if (row === null) return { kind: 'not_found' }
    this.#publishRows(sellerId, row.date, result.ids, 'SENT', null)
    const members = (await this.#groupViews(sellerId, row)).filter((view) => result.ids.includes(view.id))
    // 게시 보고 (실행기의 보고와 같은 요청 번호 — 한 번만). 저장하지 못하면 실행기가 다음 바퀴에 같은 계정으로 다시 한다
    const runnerRows = (await Promise.all(result.ids.map((id) => findRow(db, sellerId, id)))).filter((item): item is RunnerRow => item !== null)
    await this.#report(runnerRows)
    return { kind: 'ok', rows: members.length > 0 ? members : await this.#groupViews(sellerId, row) }
  }

  /** 알림에서 빼기 (AC-I3-36): FAILED 행만 — 상태·이유는 그대로, 다시 보내기는 그대로 된다 */
  async dismiss(sellerId: string, rowId: number, accountId: string): Promise<{ kind: 'ok'; row: OutboxRowView } | { kind: 'not_found' } | { kind: 'rejected'; code: 'DISMISS_NOT_ALLOWED'; message: string }> {
    const result = await dismissRow(this.#options.db, sellerId, rowId, accountId, this.#now())
    if (result.kind === 'not_found') return { kind: 'not_found' }
    if (result.kind === 'not_allowed') return { kind: 'rejected', code: 'DISMISS_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.DISMISS_NOT_ALLOWED }
    this.#options.publish(sellerId, { kind: 'outbox', date: result.row.date, ids: [rowId], state: result.row.state ?? 'FAILED', reason: result.row.reason, dismissed: true })
    return { kind: 'ok', row: outboxRowView(result.row) }
  }

  /** 그 행의 묶음 행들의 보기 (묶음이 없으면 그 행만) */
  async #groupViews(sellerId: string, row: RunnerRow): Promise<OutboxRowView[]> {
    const rows = row.groupId === null ? [row] : await groupRows(this.#options.db, sellerId, row.groupId)
    return rows.map((item) => outboxRowView(item, rows))
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
