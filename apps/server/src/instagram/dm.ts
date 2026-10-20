// 인스타그램 감사 DM 실행기 (YT-04, YT-06, R-13 "인스타그램 회차의 감사", INV-11, D-N2-01·D-N2-09·D-N2-10, AC-N2-40~52).
// - DM 행은 인스타그램 회차(가장 최근 연결 기록의 플랫폼)의 실제 범위 발송함 POST_THANKS 행마다 그 효과가 기록되는 같은 트랜잭션에서 만든다.
//   발송함 표의 열은 더하거나 고치지 않는다 — DM 상태는 ig_dm_rows·ig_dm_sends에 따로 둔다(D-N2-01). 리허설 범위에는 행을 만들지 않고,
//   실행기가 행을 고르는 조회(dueDmGroups)는 발송함 rehearsal = false를 조건에 고정한다(바꾸는 매개변수 없음).
// - 받는 곳 = 그 찜을 만든 댓글(채팅 주문·메시지 변환 찜의 `ig:` 메시지). 그 밖은 SKIPPED(NO_RECIPIENT), 영상 댓글 효과는 SKIPPED(NOT_SUPPORTED).
// - 댓글 하나에 DM 하나: 보낼 때 그 댓글의 기다리는 행을 모두 모아 한 DM(효과가 나온 순서로 한 줄씩, 최대 5줄). 같은 이벤트의 효과는 같은 트랜잭션에 생겨 늘 함께다.
//   그 댓글에 SENT·FAILED(UNCONFIRMED) 행이 있으면 새 행은 FAILED(ONE_REPLY). 보내는 중이면 결과를 기다린다(WAITING(PREVIOUS)).
// - 효과가 나온 때 동의가 없었으면 FAILED(NO_CONSENT). 보내기·다시 시도 직전마다 엔진 상태를 본다(취소 → SKIPPED(CANCELLED), 완료 → SENT).
// - 다시 시도 2·4·8·16·32초 최대 5번 → FAILED(GAVE_UP). 보내기 10초 타임아웃 → 대화를 한 번 조회해(30초) 그 시도 시작 − 5초 뒤의 같은 글이 있으면 SENT,
//   없으면 실패 한 번, 조회가 실패하면 FAILED(UNCONFIRMED)(자동으로 다시 보내지 않는다). 보내는 중 임대 60초 — 서버가 죽었다 살아나면 확인부터.
// - 자동 발송은 행이 생긴 뒤 10분 안에만(넘으면 FAILED(EXPIRED)). 수동 재전송은 동의·기한 없이, 연결·메시지 권한·이어진 라이브(이은 계정 = 지금 계정) 필요.
// - 보내면 효과마다 effect.thanksSent(조치자 서버, 요청 번호 = 행에서 정함 — 다시 해도 새 줄 없음). 실패·다시 시도·건너뜀은 엔진 이벤트가 아니다.
// - 한 댓글의 DM을 보내는 실행기는 서버 전체에서 하나다: 댓글 묶음마다 DB 어드바이저리 락 + 진행 중 발송 부분 유일 인덱스 + 임대.
import { listEffects, type EffectInfo, type EngineState } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { LinkOutcome } from '../live-links.ts'
import type { Clock } from '../time.ts'
import { claimIndex } from '../views.ts'
import type { ScopeWriter, TxHookContext } from '../writer.ts'
import type { InstagramSettings } from './config.ts'
import type { ApiConnection, InstagramConnections } from './connection.ts'
import type { MetaClient, MetaResult } from './meta.ts'
import type { LiveTimer } from './notices.ts'
import {
  activeSend,
  chatAtSeq,
  chatChannel,
  closeEmptySends,
  dmRowsByIds,
  dmRowsOfDate,
  dueDmGroups,
  expireDmRows,
  failPendingSends,
  failWaitingRows,
  findConnection,
  findDmRow,
  findRequest,
  findSend,
  insertDmRows,
  insertRequest,
  insertSend,
  latestLink,
  latestPlatforms,
  leaseExpiredSends,
  outboxIds,
  rowsOfComment,
  rowsOfSend,
  takeExpiredLease,
  unreportedRows,
  updateDmRows,
  updateSend,
  waitingRowsOf,
  type DmGroup,
  type DmRow,
  type NewDmRow,
} from './store.ts'
import { DM_LINES_MAX, dmLine, dmText } from './text.ts'

/** 다시 시도 간격 (초) — 최대 5번 (D-N2-10, 유튜브 발송함과 같은 숫자) */
export const RETRY_DELAYS_S = [2, 4, 8, 16, 32] as const
export const MAX_RETRIES = RETRY_DELAYS_S.length
/** 자동 발송 기한 (행이 생긴 뒤 10분) */
export const DM_DEADLINE_MS = 10 * 60 * 1000
/** 보내는 중 임대 (60초 — 지나면 타임아웃과 같이 확인부터) */
export const SEND_LEASE_MS = 60_000
/** 타임아웃 확인: 그 시도를 시작한 시각 − 5초 이후에 보낸 같은 글 */
export const CONFIRM_SLACK_MS = 5000
/** 실행기 주기 (자동 실행일 때) */
export const DM_POLL_MS = 1000

export type DmStatus = 'WAITING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED'

/** 행의 이유 코드 → 판매자에게 보일 문장 (AC-N2-42·43·45) */
export const DM_REASON_MESSAGES = {
  NO_CONSENT: '자동 DM에 동의하기 전의 감사예요.',
  NO_LINK: '이어진 인스타그램 라이브가 없어요.',
  NOT_MY_ACCOUNT: '지금 연결한 인스타그램 계정의 라이브가 아니라 보내지 않았어요.',
  ONE_REPLY: '이 댓글에는 이미 DM을 보냈어요. 댓글 하나에 DM은 한 번만 보낼 수 있어요. 인스타그램에서 직접 보내 주세요.',
  LIVE_ENDED: '인스타그램 라이브가 끝나 DM을 보낼 수 없어요.',
  NO_PERMISSION: 'DM을 보낼 권한이 없어요. 인스타그램 연결을 다시 해 주세요.',
  EXPIRED: '너무 늦어 보내지 않았어요.',
  GAVE_UP: '여러 번 보내지 못했어요.',
  REJECTED: '인스타그램이 받지 않았어요.',
  UNCONFIRMED: '보내졌는지 확인하지 못했어요. 인스타그램에서 확인하고 없으면 다시 보내 주세요.',
  CANCELLED: '확정이 풀린 판매라 보내지 않았어요.',
  NO_RECIPIENT: '댓글로 생긴 찜이 아니라 DM을 보낼 곳이 없어요.',
  NOT_SUPPORTED: '인스타그램에는 공개 댓글로 감사를 남길 수 없어요.',
  RETRY: '보내지 못해 잠시 뒤 다시 보내요.',
  RECONNECT: '인스타그램 연결을 다시 하면 보내요.',
  PREVIOUS: '이 댓글의 앞 DM 결과를 기다리는 중이에요.',
  CONFIRM: '보내졌는지 확인하는 중이에요.',
} as const

export type DmReason = keyof typeof DM_REASON_MESSAGES

/** 수동 재전송 응답 문장 (AC-N2-50) */
export const RESEND_MESSAGES = {
  SKIPPED: '확정이 풀린 판매라 보내지 않아요.',
  ALREADY_SENT: '이미 보낸 감사예요.',
  NOT_RESENDABLE: '다시 보낼 수 없는 DM이에요.',
  BUSY: '이 댓글의 DM을 보내는 중이에요. 잠시 뒤 다시 해 주세요.',
  RECONNECT_NEEDED: '인스타그램 연결을 다시 해 주세요.',
  NOT_CONFIGURED: '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.',
} as const

/** DM 행 조회 (AC-N2-51) */
export interface DmRowView {
  readonly id: number
  readonly broadcast: string
  /** 효과의 상품 키·구매자 ID */
  readonly product: string
  readonly buyer: string
  /** 받는 댓글 (`ig:` 메시지 ID, 없으면 null) */
  readonly comment: string | null
  /** 이 행의 DM 줄 */
  readonly line: string
  readonly status: DmStatus
  readonly reason: DmReason | null
  readonly message: string | null
  readonly attempts: number
  /** 다음 시도 시각 (UTC ISO) */
  readonly nextAt: string | null
  readonly sentAt: string | null
  readonly metaMessageId: string | null
  /** 같은 DM의 다른 행 ID */
  readonly together: readonly number[]
  readonly createdAt: string
}

export interface DmDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  readonly settings: InstagramSettings | null
  readonly meta: MetaClient | null
  readonly connections: InstagramConnections
  readonly timer: LiveTimer
  /** 실행기를 스스로 돌린다 (운영·E2E). 시험은 끄고 drain()을 부른다 */
  readonly autoRun: boolean
  /** DM 행 알림 (SSE) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
}

interface Claimed {
  readonly sendId: number
  readonly text: string
  readonly commentId: string
}

const groupKey = (group: Pick<DmGroup, 'sellerId' | 'scopeId' | 'comment'>) => sql`hashtextextended(${`ig-dm/${group.sellerId}/${group.scopeId}/${group.comment}`}, 0)`
const isReason = (value: string | null): value is DmReason => value !== null && Object.hasOwn(DM_REASON_MESSAGES, value)
const commentIdOf = (comment: string) => comment.slice('ig:'.length)

export class InstagramDms {
  readonly #deps: DmDeps
  readonly #effectCache = new WeakMap<EngineState, Map<string, EffectInfo>>()
  #loop: Promise<number> = Promise.resolve(0)
  #scheduled: (() => void) | null = null
  #closed = false
  readonly #chains = new Map<string, Promise<void>>()

  constructor(deps: DmDeps) {
    this.#deps = deps
  }

  #now(): Date {
    return new Date(this.#deps.clock.now())
  }

  #effects(state: EngineState): Map<string, EffectInfo> {
    let map = this.#effectCache.get(state)
    if (map === undefined) {
      map = new Map(listEffects(state).map((effect) => [effect.id, effect]))
      this.#effectCache.set(state, map)
    }
    return map
  }

  // ── 기록 경로 안 (DM 행 만들기) ─────────────────────────────────────────

  /**
   * 이벤트 기록과 같은 트랜잭션에서 부른다 (ScopeWriter txHook). 리허설 범위는 아무것도 하지 않는다.
   * 그 기록의 POST_THANKS 효과 중 회차의 가장 최근 연결 기록이 인스타그램인 것마다 DM 행 하나
   */
  readonly txHook = async (tx: Db, ctx: TxHookContext): Promise<(() => void) | null> => {
    if (ctx.rehearsal) return null
    const { sellerId, scopeId, records, states, now } = ctx
    const items: { index: number; ord: number; effect: (typeof records)[number]['effects'][number]; seq: number }[] = []
    records.forEach((record, index) => record.effects.forEach((effect, ord) => effect.kind === 'POST_THANKS' && items.push({ index, ord, effect, seq: record.seq })))
    if (items.length === 0) return null
    const platforms = await latestPlatforms(tx, sellerId, [...new Set(items.map((item) => item.effect.broadcast))])
    const instagram = items.filter((item) => platforms.get(item.effect.broadcast) === 'INSTAGRAM')
    if (instagram.length === 0) return null
    const connection = await findConnection(tx, sellerId)
    const ids = await outboxIds(tx, sellerId, scopeId, instagram.map((item) => item.effect.id))
    const rows: NewDmRow[] = []
    for (const item of instagram) {
      const outboxId = ids.get(item.effect.id)
      if (outboxId === undefined) continue
      const state = states[item.index] as EngineState
      const claim = claimIndex(ctx.runtime, state).get(item.effect.claim)
      let comment: string | null = null
      if (claim !== undefined && (claim.origin === 'chat' || claim.origin === 'convert')) {
        // 그 찜을 만든 메시지 = 찜의 순위 재료 seq의 채팅 이벤트 (메시지 변환도 원래 메시지의 seq, R-6)
        const chat = await chatAtSeq(tx, sellerId, scopeId, claim.seq)
        if (chat !== null && chat.b === claim.broadcast && chat.id.startsWith('ig:')) comment = chat.id
      }
      let status: DmStatus = 'WAITING'
      let reason: DmReason | null = null
      if (item.effect.target === 'VIDEO_COMMENT') [status, reason] = ['SKIPPED', 'NOT_SUPPORTED']
      else if (comment === null) [status, reason] = ['SKIPPED', 'NO_RECIPIENT']
      else if (connection === null || connection.consentAt === null) [status, reason] = ['FAILED', 'NO_CONSENT']
      else {
        const active = await activeSend(tx, { sellerId, scopeId, comment })
        if (active !== null && (active.state === 'SENDING' || active.state === 'CONFIRMING')) reason = 'PREVIOUS'
        else if (connection.status === 'RECONNECT_NEEDED') reason = 'RECONNECT'
        else if (active !== null && active.attempts > 0) reason = 'RETRY'
      }
      rows.push({
        sellerId,
        scopeId,
        date: ctx.date,
        outboxId,
        effectId: item.effect.id,
        seq: item.seq,
        ord: item.ord,
        broadcastId: item.effect.broadcast,
        product: item.effect.product,
        buyer: item.effect.buyer,
        comment,
        line: dmLine(item.effect.text ?? ''),
        status,
        reason,
        deadlineAt: status === 'WAITING' ? new Date(now.getTime() + DM_DEADLINE_MS) : null,
        now,
      })
    }
    const created = await insertDmRows(tx, rows)
    if (created.length === 0) return null
    return () => {
      this.#notify(sellerId, created)
      this.kick()
    }
  }

  // ── 바깥 조치가 바꾸는 행 (같은 트랜잭션) ─────────────────────────────────

  /** 동의 끔 (AC-N2-41): 기다리던 자동 발송 행 → FAILED(NO_CONSENT) (수동 재전송 행은 그대로) */
  async onConsentOff(tx: Db, sellerId: string, now: Date): Promise<(() => void) | null> {
    const rows = await failWaitingRows(tx, sellerId, 'NO_CONSENT', now, { keepManual: true })
    await failPendingSends(tx, sellerId, 'NO_CONSENT', now, { manual: false })
    return rows.length === 0 ? null : () => this.#notify(sellerId, rows.map((row) => row.id))
  }

  /** 연결 끊기 (AC-N2-16): 기다리던 행 → FAILED(NO_CONSENT) */
  async onDisconnect(tx: Db, sellerId: string, now: Date): Promise<(() => void) | null> {
    const rows = await failWaitingRows(tx, sellerId, 'NO_CONSENT', now)
    await failPendingSends(tx, sellerId, 'NO_CONSENT', now)
    return rows.length === 0 ? null : () => this.#notify(sellerId, rows.map((row) => row.id))
  }

  /** 라이브 연결 끊기 (AC-N2-23): 그 회차의 기다리던 행 → FAILED(NO_LINK) */
  async onUnlink(tx: Db, sellerId: string, broadcastId: string, now: Date): Promise<(() => void) | null> {
    const rows = await failWaitingRows(tx, sellerId, 'NO_LINK', now, { broadcastId })
    await failPendingSends(tx, sellerId, 'NO_LINK', now, { broadcastId })
    return rows.length === 0 ? null : () => this.#notify(sellerId, rows.map((row) => row.id))
  }

  // ── 실행기 ──────────────────────────────────────────────────────────────

  /** 곧 한 번 돌린다 (자동 실행일 때) */
  kick(): void {
    if (!this.#deps.autoRun || this.#closed || this.#scheduled !== null) return
    this.#scheduled = this.#deps.timer.schedule(0, () => {
      this.#scheduled = null
      void this.runOnce().catch((error: unknown) => this.#deps.log({ level: 'error', code: 'IG_DM_FAILED', errorKind: errorKind(error) }))
    })
  }

  /** 주기 실행 시작 (자동 실행일 때) */
  start(): void {
    if (!this.#deps.autoRun || this.#closed) return
    const tick = () => {
      if (this.#closed) return
      void this.runOnce()
        .catch((error: unknown) => this.#deps.log({ level: 'error', code: 'IG_DM_FAILED', errorKind: errorKind(error) }))
        .finally(() => {
          if (!this.#closed) this.#deps.timer.schedule(DM_POLL_MS, tick)
        })
    }
    this.#deps.timer.schedule(DM_POLL_MS, tick)
  }

  close(): void {
    this.#closed = true
    this.#scheduled?.()
    this.#scheduled = null
  }

  /** 할 일을 한 번 돈다 (프로세스 안에서는 한 줄로). 한 일의 수를 돌려준다 */
  runOnce(): Promise<number> {
    const next = this.#loop.then(
      () => this.#pass(),
      () => this.#pass(),
    )
    this.#loop = next.catch(() => 0)
    return next
  }

  /** 할 일이 없을 때까지 돈다 (시험) */
  async drain(maxRounds = 100): Promise<void> {
    for (let round = 0; round < maxRounds; round++) if ((await this.runOnce()) === 0) break
    await this.settled()
  }

  /** 쌓인 알림을 모두 보낼 때까지 기다린다 (시험) */
  async settled(): Promise<void> {
    for (;;) {
      const pending = [...this.#chains.values()]
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  async #pass(): Promise<number> {
    if (this.#deps.meta === null) return 0
    const { db } = this.#deps
    let work = 0
    const now = this.#now()
    const expired = await expireDmRows(db, now)
    await closeEmptySends(db, now)
    work += expired.length
    const bySeller = new Map<string, number[]>()
    for (const row of expired) bySeller.set(row.sellerId, [...(bySeller.get(row.sellerId) ?? []), row.id])
    for (const [sellerId, ids] of bySeller) this.#notify(sellerId, ids)
    for (const send of await leaseExpiredSends(db, now, 20)) {
      const until = new Date(now.getTime() + this.#confirmMs + SEND_LEASE_MS)
      if (!(await takeExpiredLease(db, send.sellerId, send.id, now, until))) continue
      work += 1
      await this.#guard(async () => {
        const rows = await rowsOfSend(db, send.sellerId, send.id)
        const sending = rows.filter((row) => row.status === 'SENDING').map((row) => row.id)
        await updateDmRows(db, send.sellerId, sending, { reason: 'CONFIRM' }, now)
        this.#notify(send.sellerId, sending)
        await this.#confirm(send.sellerId, send.id, null)
      })
    }
    for (const group of await dueDmGroups(db, now, 50)) {
      work += 1
      await this.#guard(() => this.#attempt(group))
    }
    for (const row of await unreportedRows(db, 50)) {
      work += 1
      await this.#guard(() => this.#report(row))
    }
    return work
  }

  async #guard(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      this.#deps.log({ level: 'error', code: 'IG_DM_FAILED', errorKind: errorKind(error) })
    }
  }

  get #confirmMs(): number {
    return this.#deps.settings?.timeouts.confirmMs ?? 30_000
  }

  /** 댓글 묶음 하나를 보낸다 (AC-N2-43·45·47) */
  async #attempt(group: DmGroup): Promise<void> {
    const { db, writer, connections } = this.#deps
    const meta = this.#deps.meta
    if (meta === null) return
    const api = await connections.api(group.sellerId)
    const runtime = await writer.read(group.sellerId, group.date, false)
    const effects = this.#effects(runtime.state)
    const touched: number[] = []
    const claimed = await db.transaction(async (tx): Promise<Claimed | null> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${groupKey(group)})`)
      const now = this.#now()
      const active = await activeSend(tx, group)
      const rows = await waitingRowsOf(tx, group)
      const set = async (targets: readonly DmRow[], patch: Parameters<typeof updateDmRows>[3]) => {
        await updateDmRows(tx, group.sellerId, targets.map((row) => row.id), patch, now)
        touched.push(...targets.map((row) => row.id))
      }
      if (active !== null && (active.state === 'SENDING' || active.state === 'CONFIRMING')) {
        await set(rows.filter((row) => row.sendId !== active.id && row.reason !== 'PREVIOUS'), { reason: 'PREVIOUS' })
        return null
      }
      if (active !== null && active.nextAt !== null && active.nextAt.getTime() > now.getTime()) return null
      const finish = async (reason: DmReason | null) => {
        if (active !== null) await updateSend(tx, group.sellerId, active.id, { state: 'FAILED', reason, nextAt: null, leaseUntil: null }, now)
      }
      if (rows.length === 0) {
        await finish(null)
        return null
      }
      const failAll = async (reason: DmReason) => {
        await set(rows, { status: 'FAILED', reason, nextAt: null })
        await finish(reason)
        return null
      }
      // 그 댓글로 이미 보냈거나 보냈는지 모르는 DM이 있으면 뒤 감사는 보내지 않는다 (AC-N2-43)
      const all = await rowsOfComment(tx, group)
      if (all.some((row) => row.status === 'SENT' || (row.status === 'FAILED' && row.reason === 'UNCONFIRMED'))) return failAll('ONE_REPLY')
      const connection = await findConnection(tx, group.sellerId)
      if (connection === null || (!api.ok && api.failure === 'NOT_CONNECTED')) return failAll('NO_CONSENT')
      if (connection.status === 'RECONNECT_NEEDED' || !api.ok) {
        await set(
          rows.filter((row) => row.reason !== 'RECONNECT'),
          { reason: 'RECONNECT' },
        )
        if (active !== null) await updateSend(tx, group.sellerId, active.id, { nextAt: null, leaseUntil: null }, now)
        return null
      }
      // 동의 없이 남은 자동 발송 행 (수동 재전송 행은 기한이 없다 — 동의가 필요 없다)
      let candidates = rows
      if (connection.consentAt === null) {
        const automatic = rows.filter((row) => row.deadlineAt !== null)
        await set(automatic, { status: 'FAILED', reason: 'NO_CONSENT', nextAt: null })
        candidates = rows.filter((row) => row.deadlineAt === null)
        if (candidates.length === 0) {
          await finish('NO_CONSENT')
          return null
        }
      }
      const failCandidates = async (reason: DmReason) => {
        await set(candidates, { status: 'FAILED', reason, nextAt: null })
        await finish(reason)
        return null
      }
      if (!connection.permMessages) return failCandidates('NO_PERMISSION')
      const link = await latestLink(tx, group.sellerId, group.broadcastId)
      if (link === null || link.state !== 'LINKED') return failCandidates('NO_LINK')
      if (link.accountId !== connection.accountId) return failCandidates('NOT_MY_ACCOUNT')
      // 보내기 직전 엔진 상태 (R-13): 취소 → SKIPPED(CANCELLED), 이미 완료 → SENT (보내지 않는다)
      const sendable: DmRow[] = []
      for (const row of candidates) {
        const effect = effects.get(row.effectId)
        if (effect === undefined || effect.status === 'CANCELLED') await set([row], { status: 'SKIPPED', reason: 'CANCELLED', nextAt: null })
        else if (effect.status === 'DONE') await set([row], { status: 'SENT', reason: null, nextAt: null, reported: true, sentAt: now })
        else sendable.push(row)
      }
      if (sendable.length === 0) {
        await finish(null)
        return null
      }
      const batch = sendable.slice(0, DM_LINES_MAX)
      const channel = await chatChannel(tx, group.sellerId, group.broadcastId, group.comment)
      if (channel === null || !channel.startsWith('ig:')) {
        await set(batch, { status: 'FAILED', reason: 'REJECTED', nextAt: null })
        await finish('REJECTED')
        return null
      }
      const igsid = channel.slice('ig:'.length)
      const text = dmText(batch.map((row) => row.line))
      const sendId =
        active?.id ?? (await insertSend(tx, { sellerId: group.sellerId, scopeId: group.scopeId, date: group.date, broadcastId: group.broadcastId, comment: group.comment, igsid, manual: false, now }))
      await updateSend(tx, group.sellerId, sendId, { state: 'SENDING', reason: null, text, startedAt: now, leaseUntil: new Date(now.getTime() + SEND_LEASE_MS), nextAt: null, igsid }, now)
      await set(batch, { status: 'SENDING', reason: null, sendId, nextAt: null })
      return { sendId, text, commentId: commentIdOf(group.comment) }
    })
    this.#notify(group.sellerId, touched)
    if (claimed === null || !api.ok) return
    const result = await meta.privateReply(api.conn, claimed.commentId, claimed.text)
    await this.#settle(group.sellerId, claimed.sendId, api, result)
  }

  /** 보내기 결과 처리 */
  async #settle(sellerId: string, sendId: number, api: ApiConnection, result: MetaResult<string>): Promise<void> {
    if (result.ok) return this.#sent(sellerId, sendId, result.value)
    const now = this.#now()
    const { db } = this.#deps
    const sending = (await rowsOfSend(db, sellerId, sendId)).filter((row) => row.status === 'SENDING').map((row) => row.id)
    switch (result.failure) {
      case 'TIMEOUT': {
        // 바로 다시 보내지 않고 대화를 한 번 조회해 확인한다 (AC-N2-48)
        await db.transaction(async (tx) => {
          await updateSend(tx, sellerId, sendId, { state: 'CONFIRMING', leaseUntil: new Date(now.getTime() + this.#confirmMs + SEND_LEASE_MS) }, now)
          await updateDmRows(tx, sellerId, sending, { reason: 'CONFIRM' }, now)
        })
        this.#notify(sellerId, sending)
        return this.#confirm(sellerId, sendId, api)
      }
      case 'RETRY':
        return this.#retry(sellerId, sendId)
      case 'TOKEN_INVALID': {
        await this.#deps.connections.markReconnect(sellerId)
        await db.transaction(async (tx) => {
          await updateSend(tx, sellerId, sendId, { state: 'PENDING', nextAt: null, leaseUntil: null }, now)
          await updateDmRows(tx, sellerId, sending, { status: 'WAITING', reason: 'RECONNECT' }, now)
        })
        this.#notify(sellerId, sending)
        return
      }
      default:
        return this.#fail(sellerId, sendId, result.failure)
    }
  }

  async #fail(sellerId: string, sendId: number, reason: DmReason): Promise<void> {
    const now = this.#now()
    const { db } = this.#deps
    const sending = (await rowsOfSend(db, sellerId, sendId)).filter((row) => row.status === 'SENDING').map((row) => row.id)
    await db.transaction(async (tx) => {
      await updateSend(tx, sellerId, sendId, { state: 'FAILED', reason, nextAt: null, leaseUntil: null }, now)
      await updateDmRows(tx, sellerId, sending, { status: 'FAILED', reason, nextAt: null }, now)
    })
    this.#notify(sellerId, sending)
    // 그 댓글의 기다리던 뒤 행이 있으면 이제 보낼 수 있다 (앞 DM이 보내지 않음으로 끝남)
    this.kick()
  }

  /** 실패 한 번: 다시 시도 2·4·8·16·32초, 다섯 번 넘게 실패하면 FAILED(GAVE_UP) (AC-N2-47) */
  async #retry(sellerId: string, sendId: number): Promise<void> {
    const { db } = this.#deps
    const send = await findSend(db, sellerId, sendId)
    if (send === null) return
    const attempts = send.attempts + 1
    if (attempts > MAX_RETRIES) {
      const now = this.#now()
      const sending = (await rowsOfSend(db, sellerId, sendId)).filter((row) => row.status === 'SENDING').map((row) => row.id)
      await updateSend(db, sellerId, sendId, { attempts }, now)
      await updateDmRows(db, sellerId, sending, { attempts }, now)
      return this.#fail(sellerId, sendId, 'GAVE_UP')
    }
    const now = this.#now()
    const nextAt = new Date(now.getTime() + (RETRY_DELAYS_S[attempts - 1] as number) * 1000)
    const sending = (await rowsOfSend(db, sellerId, sendId)).filter((row) => row.status === 'SENDING').map((row) => row.id)
    const waiting = (await waitingRowsOf(db, send)).map((row) => row.id)
    await db.transaction(async (tx) => {
      await updateSend(tx, sellerId, sendId, { state: 'PENDING', attempts, nextAt, leaseUntil: null }, now)
      await updateDmRows(tx, sellerId, sending, { status: 'WAITING', reason: 'RETRY', attempts, nextAt }, now)
      await updateDmRows(tx, sellerId, waiting, { reason: 'RETRY', nextAt }, now)
    })
    this.#notify(sellerId, [...sending, ...waiting])
  }

  /** 보냄: DM 기록에 메타 메시지 ID·보낸 시각, 모은 행을 SENT로, 효과마다 게시 보고 (AC-N2-46) */
  async #sent(sellerId: string, sendId: number, messageId: string): Promise<void> {
    const now = this.#now()
    const { db } = this.#deps
    const rows = (await rowsOfSend(db, sellerId, sendId)).filter((row) => row.status === 'SENDING')
    await db.transaction(async (tx) => {
      await updateSend(tx, sellerId, sendId, { state: 'SENT', reason: null, metaMessageId: messageId, sentAt: now, nextAt: null, leaseUntil: null }, now)
      await updateDmRows(tx, sellerId, rows.map((row) => row.id), { status: 'SENT', reason: null, sentAt: now, metaMessageId: messageId, nextAt: null }, now)
    })
    this.#notify(sellerId, rows.map((row) => row.id))
    for (const row of rows) await this.#guard(() => this.#report({ ...row, status: 'SENT' }))
    // 그 댓글에 기다리던 뒤 행은 이제 ONE_REPLY
    this.kick()
  }

  /** 타임아웃 확인 (AC-N2-48): 대화를 한 번 조회한다. 같은 글이 있으면 SENT, 없으면 실패 한 번, 조회 실패면 UNCONFIRMED */
  async #confirm(sellerId: string, sendId: number, api: ApiConnection | null): Promise<void> {
    const meta = this.#deps.meta
    const send = await findSend(this.#deps.db, sellerId, sendId)
    if (send === null) return
    const connection = api ?? (await this.#deps.connections.api(sellerId))
    if (meta === null || send.text === null || send.startedAt === null || !connection.ok) return this.#fail(sellerId, sendId, 'UNCONFIRMED')
    const result = await meta.conversation(connection.conn, send.igsid)
    if (!result.ok) {
      this.#deps.log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
      if (result.failure === 'TOKEN_INVALID') await this.#deps.connections.markReconnect(sellerId)
      return this.#fail(sellerId, sendId, 'UNCONFIRMED')
    }
    const since = send.startedAt.getTime() - CONFIRM_SLACK_MS
    const ours = new Set([connection.conn.accountId, ...(connection.conn.pageId === null ? [] : [connection.conn.pageId])])
    const found = result.value.find((message) => ours.has(message.fromId) && message.text === send.text && message.createdAt !== null && message.createdAt >= since)
    if (found !== undefined) return this.#sent(sellerId, sendId, found.id)
    return this.#retry(sellerId, sendId)
  }

  /** 게시 보고 effect.thanksSent (조치자 서버, 요청 번호 = 행에서 정함). 보고만 다시 한다 — 다시 보내지 않는다 */
  async #report(row: DmRow): Promise<void> {
    if (row.status !== 'SENT' || row.reported) return
    const requestId = `igdm:${String(row.id)}`
    const outcome = await this.#deps.writer.write({
      sellerId: row.sellerId,
      date: row.date,
      rehearsal: false,
      createScope: false,
      requestId,
      build: (ctx) => {
        const effect = this.#effects(ctx.state).get(row.effectId)
        // 이미 실행 완료(다른 길로 보고됨)면 새 줄을 쓰지 않는다 (INV-11)
        if (effect === undefined || effect.kind !== 'POST_THANKS' || effect.status === 'DONE') return { status: 409, code: 'REQUEST_ERROR', message: '이미 보고했어요.', problems: [] }
        return [{ fields: { type: 'effect.thanksSent', effectId: row.effectId }, actor: { kind: 'server' }, requestId }]
      },
    })
    if (outcome.kind === 'ok' || outcome.kind === 'duplicate' || outcome.kind === 'rejected') {
      await updateDmRows(this.#deps.db, row.sellerId, [row.id], { reported: true }, this.#now())
      return
    }
    this.#deps.log({ level: 'warn', code: 'IG_REPORT_FAILED', date: row.date })
  }

  // ── 조회·수동 재전송 ────────────────────────────────────────────────────

  #views(rows: readonly DmRow[], siblings: readonly DmRow[]): DmRowView[] {
    const bySend = new Map<number, number[]>()
    for (const row of siblings) if (row.sendId !== null) bySend.set(row.sendId, [...(bySend.get(row.sendId) ?? []), row.id])
    return rows.map((row) => {
      const reason = isReason(row.reason) ? row.reason : null
      return {
        id: row.id,
        broadcast: row.broadcastId,
        product: row.product,
        buyer: row.buyer,
        comment: row.comment,
        line: row.line,
        status: row.status as DmStatus,
        reason,
        message: reason === null ? null : DM_REASON_MESSAGES[reason],
        attempts: row.attempts,
        nextAt: row.nextAt === null ? null : row.nextAt.toISOString(),
        sentAt: row.sentAt === null ? null : row.sentAt.toISOString(),
        metaMessageId: row.metaMessageId,
        together: row.sendId === null ? [] : (bySend.get(row.sendId) ?? []).filter((id) => id !== row.id),
        createdAt: row.createdAt.toISOString(),
      }
    })
  }

  /** 날짜(실제 범위)의 DM 행 목록 (AC-N2-51). 리허설 범위는 빈 목록 */
  async list(sellerId: string, date: string, rehearsal: boolean): Promise<DmRowView[]> {
    if (rehearsal) return []
    const rows = await dmRowsOfDate(this.#deps.db, sellerId, date)
    return this.#views(rows, rows)
  }

  /** 행 상태가 바뀜 → SSE (판매자마다 차례로) */
  #notify(sellerId: string, ids: readonly number[]): void {
    if (ids.length === 0 || this.#closed) return
    const previous = this.#chains.get(sellerId) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        const rows = await dmRowsByIds(this.#deps.db, sellerId, [...new Set(ids)])
        const byDate = new Map<string, DmRow[]>()
        for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
        for (const [date, list] of byDate) {
          const siblings = await dmRowsOfDate(this.#deps.db, sellerId, date)
          if (!this.#closed) this.#deps.publish(sellerId, { kind: 'DM', date, rows: this.#views(list, siblings) })
        }
      })
      .catch((error: unknown) => this.#deps.log({ level: 'warn', code: 'STREAM_FAILED', errorKind: errorKind(error) }))
    this.#chains.set(sellerId, next)
    void next.then(() => {
      if (this.#chains.get(sellerId) === next) this.#chains.delete(sellerId)
    })
  }

  /**
   * 수동 재전송 (AC-N2-50): 그 댓글의 다시 보낼 수 있는 FAILED 행(ONE_REPLY 빼고)을 모두 모아 DM 하나로. 동의·기한은 보지 않는다.
   * 같은 요청 번호는 한 번만(처음 응답)
   */
  async resend(sellerId: string, requestId: string, rowId: number): Promise<LinkOutcome> {
    const { db, writer, connections } = this.#deps
    const stored = await findRequest(db, sellerId, requestId)
    if (stored !== null) return JSON.parse(stored) as LinkOutcome
    const reject = (status: number, code: string, message: string): LinkOutcome => ({ status, body: { error: { code, message } } })
    const row = await findDmRow(db, sellerId, rowId)
    if (row === null) return reject(404, 'NOT_FOUND', '찾을 수 없어요.')
    if (row.status !== 'FAILED' || row.reason === 'ONE_REPLY' || row.comment === null) return reject(409, 'DM_NOT_RESENDABLE', RESEND_MESSAGES.NOT_RESENDABLE)
    const api = await connections.api(sellerId)
    if (!api.ok) return api.failure === 'NOT_CONFIGURED' ? reject(409, 'NOT_CONFIGURED', RESEND_MESSAGES.NOT_CONFIGURED) : reject(409, 'RECONNECT_NEEDED', RESEND_MESSAGES.RECONNECT_NEEDED)
    if (!api.row.permMessages) return reject(409, 'NO_PERMISSION', DM_REASON_MESSAGES.NO_PERMISSION)
    const link = await latestLink(db, sellerId, row.broadcastId)
    if (link === null || link.state !== 'LINKED') return reject(409, 'NO_LINK', DM_REASON_MESSAGES.NO_LINK)
    if (link.accountId !== api.row.accountId) return reject(409, 'NOT_MY_ACCOUNT', DM_REASON_MESSAGES.NOT_MY_ACCOUNT)
    const effects = this.#effects((await writer.read(sellerId, row.date, false)).state)
    const comment = row.comment
    const group = { sellerId, scopeId: row.scopeId, comment }
    const touched: number[] = []
    const outcome = await db.transaction(async (tx): Promise<LinkOutcome> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${groupKey(group)})`)
      const now = this.#now()
      const set = async (targets: readonly DmRow[], patch: Parameters<typeof updateDmRows>[3]) => {
        await updateDmRows(tx, sellerId, targets.map((item) => item.id), patch, now)
        touched.push(...targets.map((item) => item.id))
      }
      const all = await rowsOfComment(tx, group)
      const chosen = all.find((item) => item.id === rowId)
      if (chosen === undefined || chosen.status !== 'FAILED' || chosen.reason === 'ONE_REPLY') return reject(409, 'DM_NOT_RESENDABLE', RESEND_MESSAGES.NOT_RESENDABLE)
      const done = async (result: string, message: string | null): Promise<LinkOutcome> => {
        const body = { result, message, rows: this.#views(await dmRowsByIds(tx, sellerId, touched.length === 0 ? [rowId] : touched), await dmRowsOfDate(tx, sellerId, row.date)) }
        const response: LinkOutcome = { status: 200, body }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(response), now)
        return response
      }
      const chosenEffect = effects.get(chosen.effectId)
      if (chosenEffect === undefined || chosenEffect.status === 'CANCELLED') {
        await set([chosen], { status: 'SKIPPED', reason: 'CANCELLED' })
        return done('SKIPPED', RESEND_MESSAGES.SKIPPED)
      }
      if (chosenEffect.status === 'DONE') {
        await set([chosen], { status: 'SENT', reason: null, reported: true })
        return done('ALREADY_SENT', RESEND_MESSAGES.ALREADY_SENT)
      }
      const resendable = all.filter((item) => item.status === 'FAILED' && item.reason !== 'ONE_REPLY')
      if (all.some((item) => item.status === 'SENT')) {
        await set(resendable, { status: 'FAILED', reason: 'ONE_REPLY' })
        return done('ONE_REPLY', DM_REASON_MESSAGES.ONE_REPLY)
      }
      if ((await activeSend(tx, group)) !== null) return reject(409, 'DM_BUSY', RESEND_MESSAGES.BUSY)
      const keep: DmRow[] = []
      for (const item of resendable) {
        const effect = effects.get(item.effectId)
        if (effect === undefined || effect.status === 'CANCELLED') await set([item], { status: 'SKIPPED', reason: 'CANCELLED' })
        else if (effect.status === 'DONE') await set([item], { status: 'SENT', reason: null, reported: true })
        else keep.push(item)
      }
      const channel = await chatChannel(tx, sellerId, row.broadcastId, comment)
      if (channel === null || !channel.startsWith('ig:')) return reject(409, 'DM_NOT_RESENDABLE', RESEND_MESSAGES.NOT_RESENDABLE)
      const sendId = await insertSend(tx, { sellerId, scopeId: row.scopeId, date: row.date, broadcastId: row.broadcastId, comment, igsid: channel.slice('ig:'.length), manual: true, now })
      await set(keep, { status: 'WAITING', reason: null, attempts: 0, nextAt: null, deadlineAt: null, sendId })
      return done('QUEUED', null)
    })
    if (outcome.status === 200) {
      this.#notify(sellerId, touched)
      this.kick()
    }
    return outcome
  }
}
