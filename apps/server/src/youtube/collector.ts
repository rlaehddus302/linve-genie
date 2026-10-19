// 유튜브 채팅 수집기 (AC-Y1-20~29, D-Y04·D-Y05·D-Y10).
// - 채팅 원천(ChatSource)은 하나의 모양(지점 → 응답 묶음·다음 지점·끝남 신호·오류)이고 구현이 셋이다: streamList(기본) · list 폴링(대체) · 시험용 가짜.
//   수집 관리자·이어받기·기록 코드는 셋에 똑같다. 실제 어댑터는 가짜 서버에 실제 통신 방식(HTTP·스트림)으로 붙는다.
// - streamList가 응답을 하나도 받지 못한 채 연속 3번 실패하거나 지원하지 않는다고 하면(404·501·UNIMPLEMENTED) 폴링으로 바꿔 같은 지점부터 이어 간다.
// - 한 응답의 메시지 이벤트가 모두 커밋된 뒤에만 그 응답의 nextPageToken을 이어받기 지점으로 저장한다(누락·중복 없음).
// - 잇기 전 채팅(지점 없이 받은 첫 응답에서 이은 시각보다 먼저 게시된 것)·끝낸 뒤 채팅(게시 시각 > 끝낸 시각)은 기록하지 않는다. 끝낸 뒤 10분이면 멈춘다.
// - 우리 채널이 쓴 메시지 중 발송함이 게시한 것은 기록하지 않고 게시 확인에 쓴다. 판매자가 손으로 쓴 것은 owner: true로 기록한다.
// - 지운 메시지·유튜브 차단은 알림만 남긴다(엔진은 그대로).
// - 같은 연결의 수집기는 서버 전체에서 하나만 돈다(DB 임대 20초, 5초마다 늘림). 하나가 죽으면 다른 서버가 30초 안에 이어받는다.
import { getBroadcast } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { Service } from '../service.ts'
import { chatEventSeq, chatRowsByIds, findBroadcast, scopeSealedAt, type BroadcastRow } from '../store.ts'
import { messageLookup } from '../views.ts'
import type { ScopeWriter } from '../writer.ts'
import { YoutubeAccessError, googleFields, type YoutubeConnections } from './connect.ts'
import { GoogleError, type GoogleClient } from './google.ts'
import type { QuotaMeter } from './quota.ts'
import {
  acquireLease,
  collectorCandidates,
  collectorOf,
  connectionChannel,
  insertNotice,
  insertOwnMessage,
  linkById,
  markChatEnded,
  recordedChats,
  releaseLease,
  renewLease,
  updateCollector,
  type CollectorChange,
  type CollectorRow,
  type LinkRow,
} from './store.ts'
import { sanitizeNick } from './texts.ts'
import { nextPacificMidnight, type Timer } from './timer.ts'

export type CollectorStatus = 'STARTING' | 'LIVE' | 'RETRYING' | 'STOPPED' | 'FINISHED' | 'CHAT_ENDED'

/** 수집 상태 문장 (AC-Y1-28) */
export const COLLECTOR_STATUS_MESSAGES: Readonly<Record<CollectorStatus, string>> = {
  STARTING: '시작하는 중',
  LIVE: '채팅을 받는 중',
  RETRYING: '다시 연결하는 중',
  STOPPED: '멈춤',
  FINISHED: '방송을 끝내 수집을 마쳤어요.',
  CHAT_ENDED: '유튜브 채팅이 끝났어요.',
}

/** 멈춘 이유와 문장 (AC-Y1-24·06·13) */
export const COLLECTOR_REASON_MESSAGES = {
  RECONNECT: '유튜브 연결을 다시 해 주세요.',
  NOT_CONNECTED: '유튜브 연결이 끊겨 수집을 멈췄어요.',
  NOT_MY_CHANNEL: '내 채널의 방송이 아니에요.',
  QUOTA: '오늘 유튜브 사용량을 다 썼어요.',
  CHAT_DISABLED: '채팅이 꺼져 있어요.',
  FORBIDDEN: '채팅을 읽을 권한이 없어요.',
  CHAT_NOT_FOUND: '채팅을 찾을 수 없어요.',
  UNLINKED: '유튜브 방송 연결을 끊었어요.',
  SEALED: '30일이 지나 봉인한 방송이에요.',
} as const
export type CollectorReason = keyof typeof COLLECTOR_REASON_MESSAGES

/** 끊긴 동안 일부를 받지 못했을 수 있을 때 (지점 거절) */
export const GAP_MESSAGE = '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.'
/** 지운 메시지·유튜브 차단 알림 문장 (AC-Y1-27) */
export const NOTICE_MESSAGES = {
  DELETED: '시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.',
  BANNED: '유튜브에서 차단된 시청자예요. 라이브찜에서도 막으려면 차단해 주세요.',
} as const

/** 판매자가 다시 시작해야 하는 이유 (저절로 이어받지 않는다) */
const MANUAL_REASONS: ReadonlySet<string> = new Set(['CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND'])
/** 다시 시작할 수 없는 이유 */
const FINAL_REASONS: ReadonlySet<string> = new Set(['UNLINKED', 'SEALED'])

/** 끝낸 뒤 이만큼 더 받는다 (AC-Y1-25) */
export const AFTER_END_MS = 10 * 60 * 1000
const BACKOFF_START_MS = 1000
const BACKOFF_MAX_MS = 30_000
/** 응답 없이 연속 이만큼 실패하면 폴링으로 (AC-Y1-20) */
const STREAM_FAILURES_TO_POLL = 3
const DEFAULT_POLL_MS = 5000

export interface CollectorHooks {
  /** 한 응답의 기록을 마친 뒤, 지점을 저장하기 직전 (시험: 던지면 그 수집기가 죽은 것처럼 멈춘다 — 지점 저장 없음) */
  readonly beforeSaveToken?: (linkId: string) => void | Promise<void>
}

export interface CollectorOptions {
  readonly db: Db
  readonly timer: Timer
  readonly log: LogSink
  readonly google: GoogleClient
  readonly connections: YoutubeConnections
  readonly quota: QuotaMeter
  readonly service: Service
  readonly writer: ScopeWriter
  /** 이 서버(인스턴스)의 이름 (임대 주인) */
  readonly owner: string
  /** SSE (그 판매자) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 발송함이 게시했거나 보내려 한 글인지 (AC-Y1-26) */
  readonly ourPost: (sellerId: string, broadcastId: string, messageId: string, text: string) => Promise<boolean>
  /** 유튜브 채팅이 끝났다 (발송함: 그 방송의 실시간 채팅 감사 → 보내지 못함) */
  readonly onChatEnded: (sellerId: string, link: LinkRow) => Promise<void>
  readonly hooks?: CollectorHooks
  readonly leaseMs?: number
  readonly renewMs?: number
  readonly scanMs?: number
}

/** 수집기 하나가 지금 무엇을 할지 */
type Verdict = { readonly run: true } | { readonly run: false; readonly change: CollectorChange | null }

interface Context {
  /** 수집기 행 (한 시도 안에서 응답을 처리할 때마다 지점·상태를 고쳐 둔다) */
  row: CollectorRow
  readonly link: LinkRow | null
  readonly connection: { channelId: string; status: string } | null
  readonly broadcast: BroadcastRow | null
  readonly sealed: boolean
}

interface Running {
  readonly sellerId: string
  readonly broadcastId: string
  readonly controller: AbortController
  /** 지금 시도(스트림 하나·폴링 한 번)만 끊는다 — 다시 계산(방송 끝남 등) */
  attempt: AbortController | null
  done: Promise<void>
  killed: boolean
}

class StopRun extends Error {
  constructor() {
    super('stop')
    this.name = 'StopRun'
  }
}

class SaveFailed extends Error {
  constructor() {
    super('save failed')
    this.name = 'SaveFailed'
  }
}

/** 응답 하나에서 꺼낸 것 */
interface Parsed {
  readonly chats: { id: string; ch: string; nick: string; text: string; owner: boolean; publishedAt: number }[]
  readonly own: { id: string; text: string; publishedAt: number }[]
  readonly deleted: string[]
  readonly bans: { id: string; channelId: string; nick: string; type: string; seconds: number | null }[]
  readonly next: string | null
  readonly offline: boolean
  readonly pollingMs: number | null
}

export class CollectorManager {
  readonly #options: CollectorOptions
  readonly #running = new Map<string, Running>()
  #loop: Promise<void> | null = null
  #stopped = false
  #wake: AbortController = new AbortController()

  constructor(options: CollectorOptions) {
    this.#options = options
  }

  get owner(): string {
    return this.#options.owner
  }

  /** 지금 이 서버에서 도는 수집기 (연결 ID) */
  get running(): readonly string[] {
    return [...this.#running.keys()]
  }

  get #leaseMs(): number {
    return this.#options.leaseMs ?? 20_000
  }

  /** 주기적으로 돌 수집기를 찾는다 (서버 시작 때 바로 한 번 — 끝나지 않은 회차의 수집기가 저절로 다시 돈다, NFR-03) */
  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        try {
          await this.scan()
        } catch (error) {
          this.#options.log({ level: 'error', code: 'WORKER_FAILED', errorKind: errorKind(error) })
        }
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#options.timer.sleep(this.#options.scanMs ?? 5000, this.#wake.signal)
      }
    })()
  }

  /** 곧 다시 찾게 한다 (연결 상태가 바뀜·방송을 이음) */
  wake(): void {
    this.#wake.abort()
  }

  /** 그 방송의 수집기가 다시 계산하게 한다 (방송을 끝냄 — 끝낸 시각 + 10분) */
  refresh(sellerId: string, broadcastId: string): void {
    for (const running of this.#running.values()) if (running.sellerId === sellerId && running.broadcastId === broadcastId) running.attempt?.abort()
    this.wake()
  }

  /** 그 판매자의 도는 수집기가 모두 다시 계산하게 한다 (연결이 끊김·다시 연결 필요 — 멈춤 상태로) */
  refreshSeller(sellerId: string): void {
    for (const running of this.#running.values()) if (running.sellerId === sellerId) running.attempt?.abort()
    this.wake()
  }

  /** 모두 멈춘다 (임대를 놓는다) */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    const all = [...this.#running.values()]
    for (const running of all) running.controller.abort()
    await Promise.all(all.map((running) => running.done))
    await this.#loop
    this.#loop = null
  }

  /** 서버가 죽은 것처럼 멈춘다 (임대·상태를 그대로 둔다 — 시험용) */
  async kill(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    const all = [...this.#running.values()]
    for (const running of all) {
      running.killed = true
      running.controller.abort()
    }
    await Promise.all(all.map((running) => running.done))
    await this.#loop
    this.#loop = null
  }

  async #context(row: CollectorRow): Promise<Context> {
    const { db } = this.#options
    const link = await linkById(db, row.sellerId, row.linkId)
    const connection = await connectionChannel(db, row.sellerId)
    const broadcast = await findBroadcast(db, row.sellerId, row.broadcastId)
    const sealed = (await scopeSealedAt(db, row.sellerId, row.scopeId)) !== null
    const fresh = (await collectorOf(db, row.sellerId, row.linkId)) ?? row
    return { row: fresh, link, connection, broadcast, sealed }
  }

  #verdict(ctx: Context, now: number): Verdict {
    const { row, link, connection, broadcast } = ctx
    const stop = (reason: CollectorReason): Verdict =>
      row.status === 'STOPPED' && row.reason === reason ? { run: false, change: null } : { run: false, change: { status: 'STOPPED', reason } }
    if (link === null || link.unlinkedAt !== null || broadcast === null) return stop('UNLINKED')
    if (ctx.sealed) return stop('SEALED')
    if (row.status === 'FINISHED' || row.status === 'CHAT_ENDED') return { run: false, change: null }
    if (row.status === 'STOPPED' && row.reason !== null && (MANUAL_REASONS.has(row.reason) || FINAL_REASONS.has(row.reason))) return { run: false, change: null }
    if (broadcast.endedAt !== null && now >= broadcast.endedAt.getTime() + AFTER_END_MS) return { run: false, change: { status: 'FINISHED', reason: null } }
    if (connection === null) return stop('NOT_CONNECTED')
    if (connection.status !== 'CONNECTED') return stop('RECONNECT')
    if (connection.channelId !== link.channelId) return stop('NOT_MY_CHANNEL')
    if (row.status === 'STOPPED' && row.reason === 'QUOTA' && row.resumeAt !== null && row.resumeAt.getTime() > now) return { run: false, change: null }
    return { run: true }
  }

  async #setStatus(row: CollectorRow, change: CollectorChange, owner?: string): Promise<void> {
    const changed = await updateCollector(this.#options.db, row.sellerId, row.linkId, change, new Date(this.#options.timer.now()), owner)
    if (changed && (change.status !== undefined || change.reason !== undefined || change.gap !== undefined || change.mode !== undefined)) await this.#publish(row)
    if (changed && change.status === 'STOPPED') this.#options.log({ level: 'info', code: 'COLLECTOR_STOPPED', seller: row.sellerId, ...(change.reason === null || change.reason === undefined ? {} : { reason: change.reason }) })
  }

  async #publish(row: CollectorRow): Promise<void> {
    const current = await collectorOf(this.#options.db, row.sellerId, row.linkId)
    const broadcast = await findBroadcast(this.#options.db, row.sellerId, row.broadcastId)
    if (current === null) return
    const recorded = await recordedChats(this.#options.db, row.sellerId, row.broadcastId)
    this.#options.publish(row.sellerId, { kind: 'collector', broadcast: row.broadcastId, ...(broadcast === null ? {} : { date: broadcast.date }), collector: collectorView(current, recorded) })
  }

  /** 돌 수집기를 찾아 임대를 잡고 돌린다 */
  async scan(): Promise<void> {
    const { db, timer, owner } = this.#options
    const now = timer.now()
    for (const candidate of await collectorCandidates(db, owner, new Date(now))) {
      if (this.#running.has(candidate.linkId) || this.#stopped) continue
      const ctx = await this.#context(candidate)
      const verdict = this.#verdict(ctx, timer.now())
      if (!verdict.run) {
        if (verdict.change !== null) await this.#setStatus(ctx.row, verdict.change)
        continue
      }
      if (!(await acquireLease(db, candidate.sellerId, candidate.linkId, owner, new Date(timer.now()), new Date(timer.now() + this.#leaseMs)))) continue
      this.#launch(ctx.row)
    }
  }

  #launch(row: CollectorRow): void {
    const running: Running = { sellerId: row.sellerId, broadcastId: row.broadcastId, controller: new AbortController(), attempt: null, done: Promise.resolve(), killed: false }
    this.#running.set(row.linkId, running)
    running.done = this.#run(row, running)
      .catch((error: unknown) => {
        this.#options.log({ level: 'error', code: 'WORKER_FAILED', seller: row.sellerId, errorKind: errorKind(error) })
      })
      .finally(() => {
        this.#running.delete(row.linkId)
      })
  }

  /** 임대를 늘린다. 잃으면 그 수집기를 멈춘다 */
  async #leaseLoop(row: CollectorRow, running: Running): Promise<void> {
    const { db, timer, owner } = this.#options
    const signal = running.controller.signal
    while (!signal.aborted) {
      await timer.sleep(this.#options.renewMs ?? 5000, signal)
      if (signal.aborted) break
      let kept: boolean
      try {
        kept = await renewLease(db, row.sellerId, row.linkId, owner, new Date(timer.now() + this.#leaseMs))
      } catch {
        kept = true // DB가 잠깐 안 되면 다음에 다시
      }
      if (!kept) {
        running.killed = true // 다른 서버가 이어받았다 — 상태를 건드리지 않는다
        running.controller.abort()
      }
    }
  }

  async #run(start: CollectorRow, running: Running): Promise<void> {
    const { timer, log } = this.#options
    const signal = running.controller.signal
    const lease = this.#leaseLoop(start, running)
    let backoff = BACKOFF_START_MS
    let streamFailures = 0
    try {
      if (start.status !== 'LIVE' && start.status !== 'RETRYING') await this.#setStatus(start, { status: 'STARTING', reason: null, resumeAt: null }, this.#options.owner)
      while (!signal.aborted) {
        const ctx = await this.#context(start)
        const verdict = this.#verdict(ctx, timer.now())
        if (!verdict.run) {
          if (verdict.change !== null) await this.#setStatus(ctx.row, verdict.change, this.#options.owner)
          return
        }
        const link = ctx.link as LinkRow
        const broadcast = ctx.broadcast as BroadcastRow
        const stopAt = broadcast.endedAt === null ? null : broadcast.endedAt.getTime() + AFTER_END_MS
        const attempt = new AbortController()
        running.attempt = attempt
        const onOuter = () => attempt.abort()
        signal.addEventListener('abort', onOuter, { once: true })
        let stopFired = false
        const stopTimer =
          stopAt === null
            ? Promise.resolve()
            : timer.sleep(Math.max(0, stopAt - timer.now()), attempt.signal).then(() => {
                if (!attempt.signal.aborted) {
                  stopFired = true
                  attempt.abort()
                }
              })
        let received = 0
        try {
          if (ctx.row.mode === 'POLL') {
            const parsed = await this.#options.connections.withToken(ctx.row.sellerId, (token) =>
              this.#options.google.api({
                sellerId: ctx.row.sellerId,
                method: 'liveChatMessages.list',
                accessToken: token,
                path: '/liveChat/messages',
                query: { liveChatId: link.liveChatId, part: 'snippet,authorDetails', maxResults: '2000', ...(ctx.row.pageToken === null ? {} : { pageToken: ctx.row.pageToken }) },
              }),
            )
            received = 1
            const result = await this.#handle(ctx, link, broadcast, parse(parsed, timer.now()), !ctx.row.firstDone)
            backoff = BACKOFF_START_MS
            if (result.offline) return await this.#chatEnded(ctx.row, link)
            await timer.sleep(Math.max(result.pollingMs ?? DEFAULT_POLL_MS, 0), attempt.signal)
          } else {
            let first = !ctx.row.firstDone
            await this.#options.connections.withToken(ctx.row.sellerId, async (token) => {
              for await (const response of this.#options.google.stream({ sellerId: ctx.row.sellerId, accessToken: token, liveChatId: link.liveChatId, pageToken: ctx.row.pageToken, signal: attempt.signal })) {
                received += 1
                const result = await this.#handle(ctx, link, broadcast, parse(response, timer.now()), first)
                first = false
                backoff = BACKOFF_START_MS
                streamFailures = 0
                if (result.offline) throw new ChatEnded()
                // 다음 응답의 지점은 방금 저장한 지점 (스트림 안에서는 서버가 이어서 보낸다)
              }
            })
            if (attempt.signal.aborted) {
              if (stopFired) return await this.#finish(ctx.row)
              continue
            }
            // 스트림이 정상으로 끝났다: 받은 게 있으면 바로 다시 열고, 없으면 실패로 센다
            if (received === 0) {
              streamFailures += 1
              if (streamFailures >= STREAM_FAILURES_TO_POLL) await this.#toPoll(ctx.row)
              await this.#retrying(ctx.row, backoff, attempt.signal)
              backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
            }
          }
        } catch (error) {
          if (error instanceof ChatEnded) return await this.#chatEnded(ctx.row, link)
          if (signal.aborted) return
          if (attempt.signal.aborted && stopFired) return await this.#finish(ctx.row)
          if (attempt.signal.aborted && !(error instanceof SaveFailed)) continue
          if (error instanceof StopRun) {
            running.killed = true // 임대를 잃었거나 봉인됨 — 이 서버는 더 손대지 않는다
            return
          }
          const action = await this.#onError(ctx.row, error)
          if (action === 'stop') return
          if (action === 'ended') return await this.#chatEnded(ctx.row, link)
          if (action === 'now') continue
          if (action === 'poll') {
            await this.#toPoll(ctx.row)
            continue
          }
          if (ctx.row.mode === 'STREAM' && received === 0) {
            streamFailures += 1
            if (streamFailures >= STREAM_FAILURES_TO_POLL) await this.#toPoll(ctx.row)
          }
          await this.#retrying(ctx.row, backoff, signal)
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
        } finally {
          signal.removeEventListener('abort', onOuter)
          if (!attempt.signal.aborted) attempt.abort()
          await stopTimer
          running.attempt = null
        }
      }
    } catch (error) {
      log({ level: 'error', code: 'COLLECTOR_ERROR', seller: start.sellerId, errorKind: errorKind(error) })
    } finally {
      running.controller.abort()
      await lease
      if (!running.killed) await releaseLease(this.#options.db, start.sellerId, start.linkId, this.#options.owner).catch(() => {})
    }
  }

  async #toPoll(row: CollectorRow): Promise<void> {
    await this.#setStatus(row, { mode: 'POLL' }, this.#options.owner)
  }

  async #retrying(row: CollectorRow, waitMs: number, signal: AbortSignal): Promise<void> {
    const current = await collectorOf(this.#options.db, row.sellerId, row.linkId)
    if (current !== null && current.status !== 'RETRYING') await this.#setStatus(row, { status: 'RETRYING' }, this.#options.owner)
    await this.#options.timer.sleep(waitMs, signal)
  }

  async #finish(row: CollectorRow): Promise<void> {
    await this.#setStatus(row, { status: 'FINISHED', reason: null }, this.#options.owner)
  }

  async #chatEnded(row: CollectorRow, link: LinkRow): Promise<void> {
    await markChatEnded(this.#options.db, row.sellerId, link.id, new Date(this.#options.timer.now()))
    await this.#setStatus(row, { status: 'CHAT_ENDED', reason: null }, this.#options.owner)
    await this.#options.onChatEnded(row.sellerId, link)
  }

  /** 오류별 동작 (AC-Y1-24): stop(멈춤 — 상태를 정했다) · now(바로 다시) · poll(폴링으로) · retry(기다렸다 다시) */
  async #onError(row: CollectorRow, error: unknown): Promise<'stop' | 'ended' | 'now' | 'poll' | 'retry'> {
    const { log, quota, timer } = this.#options
    const owner = this.#options.owner
    if (error instanceof YoutubeAccessError) {
      await this.#setStatus(row, { status: 'STOPPED', reason: error.status === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : 'RECONNECT' }, owner)
      return 'stop'
    }
    if (error instanceof SaveFailed) {
      log({ level: 'warn', code: 'COLLECTOR_SAVE_FAILED', seller: row.sellerId })
      return 'retry'
    }
    if (!(error instanceof GoogleError)) {
      log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, errorKind: errorKind(error) })
      return 'retry'
    }
    log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, ...googleFields(error) })
    const reason = error.reason
    if (reason === 'quotaExceeded') {
      await quota.markExceeded(row.sellerId)
      await this.#setStatus(row, { status: 'STOPPED', reason: 'QUOTA', resumeAt: new Date(nextPacificMidnight(timer.now())) }, owner)
      return 'stop'
    }
    if (reason === 'pageTokenInvalid') {
      // 지점 없이 다시 — 받은 메시지는 모두 기록 대상(메시지 ID로 중복 없음), 잇기 전 거르기는 하지 않는다
      await this.#setStatus(row, { pageToken: null, gap: true, firstDone: true }, owner)
      return 'now'
    }
    if (reason === 'liveChatEnded') return 'ended'
    const stops: Readonly<Record<string, CollectorReason>> = {
      liveChatDisabled: 'CHAT_DISABLED',
      forbidden: 'FORBIDDEN',
      insufficientPermissions: 'FORBIDDEN',
      liveChatNotFound: 'CHAT_NOT_FOUND',
    }
    const stop = reason === null ? undefined : stops[reason]
    if (stop !== undefined) {
      await this.#setStatus(row, { status: 'STOPPED', reason: stop }, owner)
      return 'stop'
    }
    if (row.mode === 'STREAM' && (error.status === 404 || error.status === 501 || reason === 'UNIMPLEMENTED' || reason === 'notImplemented')) return 'poll'
    return 'retry'
  }

  /** 응답 하나를 처리한다: 기록 → 알림·우리 메시지 → (시험 주입점) → 지점 저장 */
  async #handle(ctx: Context, link: LinkRow, broadcast: BroadcastRow, parsed: Parsed, firstResponse: boolean): Promise<{ offline: boolean; pollingMs: number | null }> {
    const { db, timer, service, owner } = this.#options
    const row = ctx.row
    const linkedAt = link.linkedAt.getTime()
    const endedAt = broadcast.endedAt?.getTime() ?? null
    let skipped = 0
    const chats: { id: string; ch: string; nick: string; text: string; owner: boolean; publishedAt: number }[] = []
    for (const chat of parsed.chats) {
      if (firstResponse && chat.publishedAt < linkedAt) {
        skipped += 1
        continue
      }
      if (endedAt !== null && chat.publishedAt > endedAt) continue
      chats.push(chat)
    }
    // 우리 채널이 쓴 메시지: 발송함이 게시했거나 10분 안에 보내려 한 글이면 기록하지 않고 게시 확인에 쓴다
    const own: Parsed['own'] = []
    const recordable: typeof chats = []
    for (const chat of chats) {
      if (chat.ch === link.channelId && (await this.#options.ourPost(row.sellerId, link.broadcastId, chat.id, chat.text))) {
        own.push({ id: chat.id, text: chat.text, publishedAt: chat.publishedAt })
        continue
      }
      recordable.push(chat)
    }
    for (const message of [...parsed.own, ...own]) {
      await insertOwnMessage(db, { sellerId: row.sellerId, scopeId: row.scopeId, liveChatId: link.liveChatId, messageId: message.id, text: message.text, publishedAt: new Date(message.publishedAt) })
    }
    const outcome = await service.ingestYoutubeBatch(
      row.sellerId,
      link.broadcastId,
      recordable.map((chat) => ({ id: chat.id, ch: chat.ch, nick: chat.nick, text: chat.text, publishedAt: chat.publishedAt, ...(chat.owner ? { owner: true } : {}) })),
    )
    if (outcome.status === 'sealed') throw new StopRun()
    if (outcome.status !== 'ok') throw new SaveFailed()
    await this.#notices(row, link, broadcast, parsed)
    await this.#options.hooks?.beforeSaveToken?.(row.linkId)
    const lastAt = recordable.length === 0 ? undefined : new Date(timer.now())
    const saved = await updateCollector(
      db,
      row.sellerId,
      row.linkId,
      {
        pageToken: parsed.next ?? row.pageToken,
        firstDone: true,
        status: 'LIVE',
        reason: null,
        resumeAt: null,
        addRecorded: outcome.recorded,
        addSkipped: skipped,
        ...(lastAt === undefined ? {} : { lastMessageAt: lastAt }),
      },
      new Date(timer.now()),
      owner,
    )
    if (!saved) throw new StopRun()
    // 다음 응답이 이 지점을 이어받는다 (같은 시도 안)
    ctx.row = { ...row, pageToken: parsed.next ?? row.pageToken, firstDone: true, status: 'LIVE', reason: null }
    if (row.status !== 'LIVE' || row.reason !== null) await this.#publish(row)
    return { offline: parsed.offline, pollingMs: parsed.pollingMs }
  }

  /** 지운 메시지·차단 알림 (엔진은 그대로, AC-Y1-27) */
  async #notices(row: CollectorRow, link: LinkRow, broadcast: BroadcastRow, parsed: Parsed): Promise<void> {
    if (parsed.deleted.length === 0 && parsed.bans.length === 0) return
    const { db, timer, writer } = this.#options
    const now = new Date(timer.now())
    for (const messageId of parsed.deleted) {
      if ((await chatEventSeq(db, row.sellerId, link.broadcastId, messageId)) === null) continue
      const [chatRow] = await chatRowsByIds(db, row.sellerId, row.scopeId, [{ b: link.broadcastId, id: messageId }])
      const event = chatRow === undefined ? null : (JSON.parse(chatRow.body) as { ch?: string; nick?: string })
      const runtime = await writer.read(row.sellerId, broadcast.date)
      const info = messageLookup(runtime, runtime.state).byKey.get(JSON.stringify([link.broadcastId, messageId]))
      const notice = await insertNotice(db, {
        sellerId: row.sellerId,
        scopeId: row.scopeId,
        broadcastId: link.broadcastId,
        kind: 'DELETED',
        dedupeKey: `del:${link.broadcastId}:${messageId}`,
        messageId,
        channelId: event?.ch ?? '',
        nick: event?.nick ?? '',
        wasOrder: info?.order ?? false,
        wasCancel: info?.cancel ?? false,
        banType: null,
        banSeconds: null,
        now,
      })
      if (notice !== null) this.#options.publish(row.sellerId, { kind: 'notice', date: broadcast.date, notice: noticeView(notice) })
    }
    for (const ban of parsed.bans) {
      const notice = await insertNotice(db, {
        sellerId: row.sellerId,
        scopeId: row.scopeId,
        broadcastId: link.broadcastId,
        kind: 'BANNED',
        dedupeKey: `ban:${link.broadcastId}:${ban.id}`,
        messageId: null,
        channelId: ban.channelId,
        nick: ban.nick,
        wasOrder: false,
        wasCancel: false,
        banType: ban.type,
        banSeconds: ban.seconds,
        now,
      })
      if (notice !== null) this.#options.publish(row.sellerId, { kind: 'notice', date: broadcast.date, notice: noticeView(notice) })
    }
  }
}

class ChatEnded extends Error {
  constructor() {
    super('chat ended')
    this.name = 'ChatEnded'
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * 응답(LiveChatMessageListResponse) → 기록할 채팅·삭제·차단·다음 지점·끝남 (AC-Y1-21·27).
 * - textMessageEvent: 그 글. superChatEvent·memberMilestoneChatEvent: 시청자 댓글(userComment)이 비어 있지 않을 때만 그 글.
 * - 그 밖(스티커·멤버십 가입·선물·투표·시스템)은 기록하지 않는다. messageDeletedEvent·userBannedEvent는 알림 재료.
 * - owner는 isChatOwner일 때만 true (운영자·후원자는 시청자)
 */
export function parse(response: Record<string, unknown>, now: number): Parsed {
  const chats: Parsed['chats'] = []
  const deleted: string[] = []
  const bans: Parsed['bans'] = []
  const items = Array.isArray(response.items) ? response.items : []
  for (const raw of items) {
    const item = record(raw)
    const snippet = record(item.snippet)
    const author = record(item.authorDetails)
    const id = text(item.id)
    const type = text(snippet.type)
    if (id === null || id === '' || type === null) continue
    if (type === 'messageDeletedEvent') {
      const target = text(record(snippet.messageDeletedDetails).deletedMessageId)
      if (target !== null && target !== '') deleted.push(target)
      continue
    }
    if (type === 'userBannedEvent') {
      const details = record(snippet.userBannedDetails)
      const user = record(details.bannedUserDetails)
      const channelId = text(user.channelId)
      if (channelId === null || channelId === '') continue
      const seconds = Number(details.banDurationSeconds)
      bans.push({
        id,
        channelId,
        nick: sanitizeNick(text(user.displayName) ?? ''),
        type: details.banType === 'temporary' ? 'TEMPORARY' : 'PERMANENT',
        seconds: details.banType === 'temporary' && Number.isSafeInteger(seconds) ? seconds : null,
      })
      continue
    }
    let body: string | null = null
    if (type === 'textMessageEvent') body = text(record(snippet.textMessageDetails).messageText)
    else if (type === 'superChatEvent') body = text(record(snippet.superChatDetails).userComment)
    else if (type === 'memberMilestoneChatEvent') body = text(record(snippet.memberMilestoneChatDetails).userComment)
    if (body === null || body.trim() === '') continue
    const ch = text(author.channelId) ?? text(snippet.authorChannelId)
    if (ch === null || ch === '') continue
    const published = Date.parse(text(snippet.publishedAt) ?? '')
    chats.push({
      id,
      ch,
      nick: text(author.displayName) ?? '',
      text: body,
      owner: author.isChatOwner === true,
      publishedAt: Number.isFinite(published) ? published : Number.NaN,
    })
  }
  const offline = text(response.offlineAt) !== null
  const polling = Number(response.pollingIntervalMillis)
  return {
    chats: chats.map((chat) => (Number.isFinite(chat.publishedAt) ? chat : { ...chat, publishedAt: now })),
    own: [],
    deleted,
    bans,
    next: text(response.nextPageToken),
    offline,
    pollingMs: Number.isFinite(polling) && polling >= 0 ? polling : null,
  }
}

export interface CollectorView {
  readonly status: CollectorStatus
  readonly statusMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  /** STREAM · POLL */
  readonly mode: string
  readonly lastMessageAt: string | null
  readonly recorded: number
  readonly skippedBeforeLink: number
  /** 일부를 받지 못했을 수 있다 */
  readonly gap: boolean
  readonly gapMessage: string | null
  /** 판매자가 다시 시작할 수 있는지 */
  readonly restartable: boolean
}

/** 수집 상태 (recorded = 그 방송에 기록된 유튜브 채팅 수 — 주면 그 값, 아니면 수집기 칸) */
export function collectorView(row: CollectorRow, recorded?: number): CollectorView {
  const status = row.status as CollectorStatus
  const reason = row.reason
  return {
    status,
    statusMessage: status === 'STOPPED' && reason !== null && reason in COLLECTOR_REASON_MESSAGES ? COLLECTOR_REASON_MESSAGES[reason as CollectorReason] : COLLECTOR_STATUS_MESSAGES[status],
    reason,
    reasonMessage: reason !== null && reason in COLLECTOR_REASON_MESSAGES ? COLLECTOR_REASON_MESSAGES[reason as CollectorReason] : null,
    mode: row.mode,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    recorded: recorded ?? row.recorded,
    skippedBeforeLink: row.skippedBeforeLink,
    gap: row.gap,
    gapMessage: row.gap ? GAP_MESSAGE : null,
    restartable: status === 'STOPPED' && reason !== 'QUOTA' && reason !== null && !FINAL_REASONS.has(reason),
  }
}

export interface NoticeView {
  readonly id: number
  readonly kind: 'DELETED' | 'BANNED'
  readonly broadcast: string
  readonly messageId: string | null
  readonly channel: string
  readonly nick: string
  readonly wasOrder: boolean
  readonly wasCancel: boolean
  readonly banType: string | null
  readonly banSeconds: number | null
  readonly at: string
  readonly message: string
}

export function noticeView(row: { id: number; kind: string; broadcastId: string; messageId: string | null; channelId: string; nick: string; wasOrder: boolean; wasCancel: boolean; banType: string | null; banSeconds: number | null; createdAt: Date }): NoticeView {
  const kind = row.kind === 'BANNED' ? 'BANNED' : 'DELETED'
  return {
    id: row.id,
    kind,
    broadcast: row.broadcastId,
    messageId: row.messageId,
    channel: row.channelId,
    nick: row.nick,
    wasOrder: row.wasOrder,
    wasCancel: row.wasCancel,
    banType: row.banType,
    banSeconds: row.banSeconds,
    at: row.createdAt.toISOString(),
    message: NOTICE_MESSAGES[kind],
  }
}

/** 방송 설정의 감사 묶음 시간 (초) — 없으면 0 */
export function batchWindowOf(state: Parameters<typeof getBroadcast>[0], broadcastId: string): number {
  const settings = getBroadcast(state, broadcastId)?.settings
  const value = settings?.['thanks.batchWindowSec']
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
