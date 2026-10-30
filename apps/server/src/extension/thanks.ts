// 크롬 확장으로 감사 채팅 올리기 — 서버 쪽 (X1 YT-10 AC11~AC17, D-X1-17~D-X1-24).
// - 스위치 (AC11, D-X1-18): 판매자 계정만, 기본 꺼짐. 켠 시각 뒤에 생긴 실시간 채팅 감사만 맡긴다. YT-04 실시간 채팅 동의도 있어야 한다
//   (동의가 없으면 공식 실행기가 처음 볼 때 NO_CONSENT로 끝내 여기까지 오지 않고, 가져갈 때 다시 본다).
// - 한쪽 경로만 (AC13, D-X1-19): 공식 실행기가 직전 확인에서 공식으로 올릴 수 없을 때만 route()로 묻고 맡긴다(outbox.via = EXTENSION).
//   맡긴 행은 공식 실행기가 집지 않고, 맡김이 끝나도(확인 필요·기한) 저절로 공식으로 넘기지 않는다.
// - 가져가기 (AC12·AC14): 로그인 채널 = 방송 채널 = (YT-02 이은 채널, 없으면 유튜브 연결 채널)일 때만. 한 번에 글 하나(YT-07 묶음 — 200자, 판매 경계에서 나눔),
//   결과를 받은 뒤 3초가 지나야 다음 글. 가져갈 때 기한(10분)·동의·지금 엔진 상태(취소 → 건너뜀)·채팅 끝남을 다시 본다.
// - 결과 (AC16, D-X1-23): 발송함 ID로. 게시됨(자기 글이 뜬 것을 봄)·확인 필요·안 올림(넣기 전에 멈춤 — 다시 맡을 수 있음). 같은 결과를 두 번 알려도 한 번만.
//   가져간 뒤 60초 결과가 없으면 확인 필요. 어떤 경우에도 저절로 다시 올리지 않는다.
// - 실패 경고 (AC17, D-X1-24): 연달아 3번 확인 필요면 그 회차를 멈춘다(판매자가 "다시 켜기"). 게시됨이 끼면 처음부터.
// 같은 판매자·회차의 가져가기·결과는 이 서버 안에서 하나씩 한다(글 사이 3초를 지키려고).
import { listEffects, type EngineEffect } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import type { LogSink } from '../log.ts'
import { findBroadcast } from '../store.ts'
import type { ScopeWriter } from '../writer.ts'
import {
  EXT_LEASE_OWNER,
  extensionLapsedRows,
  extensionRowsById,
  extensionSendingRows,
  extensionWaitingRows,
  failExtensionWaiting,
  scopeDates,
  updateExtensionRows,
  type RowChange,
  type RunnerRow,
} from '../youtube/outbox-store.ts'
import { activeLink, isInvitedLink } from '../youtube/store.ts'
import { batchMessages } from '../youtube/texts.ts'
import type { Timer } from '../youtube/timer.ts'
import { activeBindings, activeToken, addLaneFail, bindingOfBroadcast, bindingOfVideo, lanesOf, postEnabledAt, readLane, writeLane, writePostEnabled, youtubeChannelOf } from './store.ts'

/** 글 사이 최소 간격 (D-X1-21) */
export const POST_GAP_MS = 3000
/** 가져간 뒤 결과를 기다리는 시간 — 지나면 확인 필요 (D-X1-23) */
export const TAKE_LEASE_MS = 60_000
/** 연달아 이만큼 실패하면 그 회차를 멈춘다 (D-X1-24) */
export const MAX_FAILS = 3

export const EXT_THANKS_MESSAGES = {
  OWNER: '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요',
  PAUSED: '확장으로 감사 글을 올리지 못하고 있어요',
  OFF: '확장으로 감사 올리기가 꺼져 있어요',
  NOT_AGREED: '설명을 읽고 "켤게요"를 눌러야 켤 수 있어요.',
} as const

export type ThanksResult = 'POSTED' | 'UNCONFIRMED' | 'NOT_POSTED'

/** 초대 방송 회차에서 확장이 다시 물을 때까지 (가져갈 글이 생기지 않는다 — 드물게만 묻게) */
const INVITED_RECHECK_MS = 60_000

export type TakeOutcome =
  /** 넣을 글 하나 (발송함 ID들, 서버가 만든 글 그대로 — 글자로만 넣는다) */
  | { readonly kind: 'post'; readonly ids: readonly number[]; readonly text: string; readonly until: string; readonly channel: string }
  /** 지금은 없음 (afterMs 뒤 다시 물어도 된다) */
  | { readonly kind: 'none'; readonly afterMs: number; readonly channel: string | null }
  | { readonly kind: 'off' }
  | { readonly kind: 'not_bound' }
  | { readonly kind: 'not_owner'; readonly channel: string | null }
  | { readonly kind: 'paused' }

export interface ThanksWarning {
  readonly broadcast: string
  readonly kind: 'PAUSED' | 'OWNER'
  readonly message: string
}

export interface ThanksView {
  readonly enabled: boolean
  readonly enabledAt: string | null
  /** 끝나지 않은 이은 회차의 경고 (콘솔 고정 영역·팝업) */
  readonly warnings: readonly ThanksWarning[]
}

export interface ThanksDeps {
  readonly db: Db
  readonly timer: Timer
  readonly log: LogSink
  readonly writer: ScopeWriter
  /** 발송함 행이 바뀌었다 (유튜브 SSE — 실행기와 같은 모양 { kind: 'outbox', date, ids, state, reason }) */
  readonly publishOutbox: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
}

const effectText = (row: RunnerRow): string => {
  try {
    return (JSON.parse(row.body) as EngineEffect).text ?? row.postText ?? ''
  } catch {
    return row.postText ?? ''
  }
}

export class ExtensionThanks {
  readonly #deps: ThanksDeps
  readonly #queues = new Map<string, Promise<unknown>>()
  /** 확장 상태가 바뀌었다 (ExtensionService가 건다 — SSE event: extension) */
  onChanged: (sellerId: string) => void = () => {}

  constructor(deps: ThanksDeps) {
    this.#deps = deps
  }

  #now(): Date {
    return new Date(this.#deps.timer.now())
  }

  /** 같은 판매자·회차의 일은 하나씩 (이 서버 안) */
  #serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.#queues.get(key) ?? Promise.resolve()
    const next = before.catch(() => {}).then(work)
    this.#queues.set(key, next)
    void next.finally(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key)
    }).catch(() => {})
    return next
  }

  #publish(sellerId: string, date: string | null, ids: readonly number[], state: string, reason: string | null): void {
    if (ids.length === 0) return
    this.#deps.publishOutbox(sellerId, { kind: 'outbox', ...(date === null ? {} : { date }), ids: [...ids], state, reason })
  }

  // ── 스위치 (AC11) ─────────────────────────────────────────────────────

  async enabledAt(sellerId: string): Promise<Date | null> {
    return postEnabledAt(this.#deps.db, sellerId)
  }

  /** 켜기·끄기 (판매자 계정만 — 경로가 보조자를 막는다). 끄면 확장에 맡겨 기다리던 감사는 보내지 못함(EXT_OFF) */
  async setEnabled(sellerId: string, accountId: string, enabled: boolean): Promise<void> {
    const { db } = this.#deps
    const now = this.#now()
    await writePostEnabled(db, sellerId, enabled, accountId, now)
    if (!enabled) {
      const rows = await failExtensionWaiting(db, sellerId, 'EXT_OFF', now)
      const dates = await scopeDates(db, sellerId, rows.map((row) => row.scopeId))
      for (const row of rows) this.#publish(sellerId, dates.get(row.scopeId) ?? null, [row.id], 'FAILED', 'EXT_OFF')
    }
    this.onChanged(sellerId)
  }

  /** "다시 켜기": 그 회차의 멈춤·실패 수를 지운다 */
  async resume(sellerId: string, broadcastId: string): Promise<boolean> {
    const broadcast = await findBroadcast(this.#deps.db, sellerId, broadcastId)
    if (broadcast === null) return false
    await writeLane(this.#deps.db, sellerId, broadcastId, { fails: 0, pausedAt: null })
    this.onChanged(sellerId)
    return true
  }

  // ── 공식 실행기가 묻는다 (AC13) ────────────────────────────────────────

  /** 그 회차를 확장으로 올릴 수 있으면 스위치를 켠 시각: 스위치 켬 · 확장 연결 살아 있음 · 그 회차에 이어짐 · 멈추지 않음 */
  async route(sellerId: string, broadcastId: string): Promise<Date | null> {
    const { db } = this.#deps
    const enabledAt = await postEnabledAt(db, sellerId)
    if (enabledAt === null) return null
    if ((await activeToken(db, sellerId)) === null) return null
    if ((await bindingOfBroadcast(db, sellerId, broadcastId)) === null) return null
    // 초대 방송(남의 채널 방송)의 감사는 확장에 맡기지 않는다 — 공식 경로만 (D-PHN-21, AC-INV1-10)
    if (await this.#invited(sellerId, broadcastId)) return null
    const lane = await readLane(db, sellerId, broadcastId)
    if (lane?.pausedAt !== null && lane?.pausedAt !== undefined) return null
    return enabledAt
  }

  /** 기한이 지난 기다림 → 보내지 못함(EXPIRED), 가져간 뒤 60초 결과 없음 → 확인 필요(UNCONFIRMED, 실패 한 번) */
  async sweep(): Promise<void> {
    const { db } = this.#deps
    const now = this.#now()
    const rows = await extensionLapsedRows(db, now)
    const lanes = new Map<string, RunnerRow[]>()
    for (const row of rows) {
      const key = `${row.sellerId}\u0000${row.broadcastId ?? ''}`
      lanes.set(key, [...(lanes.get(key) ?? []), row])
    }
    for (const list of lanes.values()) {
      const first = list[0] as RunnerRow
      await this.#serial(`${first.sellerId}\u0000${first.broadcastId ?? ''}`, async () => {
        const expired = list.filter((row) => row.state === 'WAITING')
        const lapsed = list.filter((row) => row.state === 'SENDING')
        const done = await updateExtensionRows(db, first.sellerId, expired.map((row) => row.id), { state: 'FAILED', reason: 'EXPIRED', nextAt: null }, now, ['WAITING'])
        this.#publish(first.sellerId, first.date, done, 'FAILED', 'EXPIRED')
        const failed = await updateExtensionRows(
          db,
          first.sellerId,
          lapsed.filter((row) => row.leaseUntil !== null && row.leaseUntil.getTime() <= now.getTime()).map((row) => row.id),
          { state: 'FAILED', reason: 'UNCONFIRMED', leaseOwner: null, leaseUntil: null },
          now,
          ['SENDING'],
        )
        if (failed.length > 0) {
          this.#publish(first.sellerId, first.date, failed, 'FAILED', 'UNCONFIRMED')
          await this.#failed(first.sellerId, first.broadcastId ?? '', now)
        }
      })
    }
  }

  async #failed(sellerId: string, broadcastId: string, now: Date): Promise<void> {
    const fails = await addLaneFail(this.#deps.db, sellerId, broadcastId, now, MAX_FAILS)
    if (fails >= MAX_FAILS) this.#deps.log({ level: 'warn', code: 'EXT_POST_PAUSED', seller: sellerId })
    this.onChanged(sellerId)
  }

  // ── 확장이 가져간다 (AC12·AC14·AC15) ─────────────────────────────────

  /**
   * 넣을 글 하나를 맡긴다. meIsOwner = 채팅 화면에 로그인한 계정이 방송 채널 주인인가(입력 칸의 주인 배지 — 실제 유튜브 입력 칸에는 채널 ID가 없다, D-X1-29),
   * owner = 방송 채널 ID (확장이 읽은 값, 못 읽으면 null). 주인이고 방송 채널이 그 회차의 채널(YT-02 이은 채널, 없으면 유튜브 연결 채널,
   * 둘 다 없으면 이 방송 채널을 회차 채널로 기록)과 같을 때만 준다. 못 읽으면 다른 값으로 대신하지 않는다(RA-X1-08)
   */
  async take(sellerId: string, videoId: string, meIsOwner: boolean, owner: string | null): Promise<TakeOutcome> {
    const { db } = this.#deps
    const enabledAt = await postEnabledAt(db, sellerId)
    if (enabledAt === null) return { kind: 'off' }
    const binding = await bindingOfVideo(db, sellerId, videoId)
    if (binding === null) return { kind: 'not_bound' }
    const broadcast = await findBroadcast(db, sellerId, binding.broadcastId)
    if (broadcast === null || broadcast.rehearsal) return { kind: 'not_bound' }
    const b = binding.broadcastId
    return this.#serial(`${sellerId}\u0000${b}`, async () => {
      const now = this.#now()
      const link = await activeLink(db, sellerId, b)
      // 초대 방송: 확장은 감사를 가져가지 않고 방송자 로그인 안내도 남기지 않는다 (D-PHN-21, AC-INV1-10)
      if (link !== null && isInvitedLink(link)) return { kind: 'none', afterMs: INVITED_RECHECK_MS, channel: null }
      const lane = await readLane(db, sellerId, b)
      const connection = await youtubeChannelOf(db, sellerId)
      const expected = link?.channelId ?? connection?.channelId ?? lane?.ownerChannelId ?? owner
      const ownerOk = meIsOwner && owner !== null && expected !== null && owner === expected
      if (!ownerOk) {
        if (lane?.ownerProblemAt === null || lane?.ownerProblemAt === undefined) {
          await writeLane(db, sellerId, b, { ownerProblemAt: now })
          this.onChanged(sellerId)
        }
        return { kind: 'not_owner', channel: expected }
      }
      if (lane === null || lane.ownerProblemAt !== null || lane.ownerChannelId !== owner) {
        await writeLane(db, sellerId, b, { ownerProblemAt: null, ownerChannelId: owner })
        if (lane?.ownerProblemAt !== null && lane?.ownerProblemAt !== undefined) this.onChanged(sellerId)
      }
      if (lane?.pausedAt !== null && lane?.pausedAt !== undefined) return { kind: 'paused' }
      // 결과를 기다리는 글이 있으면 하나씩
      const pending = await extensionSendingRows(db, sellerId, b)
      if (pending.length > 0) {
        const until = Math.min(...pending.map((row) => row.leaseUntil?.getTime() ?? now.getTime()))
        return { kind: 'none', afterMs: Math.max(1000, until - now.getTime()), channel: expected }
      }
      // 글 사이 3초
      const gapUntil = (lane?.lastDoneAt?.getTime() ?? 0) + POST_GAP_MS
      if (gapUntil > now.getTime()) return { kind: 'none', afterMs: gapUntil - now.getTime(), channel: expected }
      const rows = await this.#ready(sellerId, b, enabledAt, connection === null ? enabledAt : connection.consentLiveChatAt, link?.chatEndedAt ?? null, now)
      const [message] = batchMessages(rows.map((row) => ({ id: row.id, text: effectText(row) })))
      if (message === undefined) return { kind: 'none', afterMs: 2000, channel: expected }
      const members = rows.filter((row) => message.ids.includes(row.id))
      const ids = members.map((row) => row.id)
      const leaseUntil = new Date(now.getTime() + TAKE_LEASE_MS)
      const claimed = await updateExtensionRows(
        db,
        sellerId,
        ids,
        { state: 'SENDING', reason: null, groupId: `x${String(Math.min(...ids))}-${String(now.getTime())}`, sentText: message.text, postText: message.text, attemptAt: now, leaseOwner: EXT_LEASE_OWNER, leaseUntil },
        now,
        ['WAITING'],
      )
      if (claimed.length !== ids.length) {
        // 그사이 다른 쪽이 바꿨다 — 잡은 것을 되돌리고 이번엔 넘긴다
        await updateExtensionRows(db, sellerId, claimed, { state: 'WAITING', reason: 'EXTENSION', groupId: null, sentText: null, attemptAt: null, leaseOwner: null, leaseUntil: null }, now, ['SENDING'])
        return { kind: 'none', afterMs: 1000, channel: expected }
      }
      await writeLane(db, sellerId, b, { lastTakenAt: now })
      this.#publish(sellerId, members[0]?.date ?? null, ids, 'SENDING', null)
      return { kind: 'post', ids, text: message.text, until: leaseUntil.toISOString(), channel: owner }
    })
  }

  /** 가져갈 수 있는 행: 기한·동의·스위치·채팅 끝남·지금 엔진 상태를 다시 보고 나머지는 끝낸다 (R-13 실행 직전) */
  async #ready(sellerId: string, b: string, enabledAt: Date, consentAt: Date | null, chatEndedAt: Date | null, now: Date): Promise<RunnerRow[]> {
    const { db, writer } = this.#deps
    let rows = await extensionWaitingRows(db, sellerId, b)
    const end = async (list: readonly RunnerRow[], state: string, reason: string | null, extra: RowChange = {}) => {
      if (list.length === 0) return
      const changed = await updateExtensionRows(db, sellerId, list.map((row) => row.id), { state, reason, nextAt: null, ...extra }, now, ['WAITING'])
      for (const row of list) if (changed.includes(row.id)) this.#publish(sellerId, row.date, [row.id], state, reason)
      rows = rows.filter((row) => !list.includes(row))
    }
    await end(rows.filter((row) => row.deadlineAt !== null && row.deadlineAt.getTime() <= now.getTime()), 'FAILED', 'EXPIRED')
    // 판매자가 누른 다시 보내기(manual)는 동의·스위치 켠 시각을 보지 않는다 (공식 수동 재전송과 같다)
    await end(rows.filter((row) => !row.manual && (consentAt === null || consentAt.getTime() > row.createdAt.getTime())), 'FAILED', 'NO_CONSENT')
    await end(rows.filter((row) => !row.manual && enabledAt.getTime() > row.createdAt.getTime()), 'FAILED', 'EXT_OFF')
    if (chatEndedAt !== null) await end(rows, 'FAILED', 'CHAT_ENDED')
    const dates = [...new Set(rows.map((row) => row.date))]
    for (const date of dates) {
      const statuses = new Map(listEffects((await writer.read(sellerId, date, false)).state).map((effect) => [effect.id, effect.status]))
      const ofDate = rows.filter((row) => row.date === date)
      await end(ofDate.filter((row) => statuses.get(row.effectId) === 'CANCELLED'), 'SKIPPED', 'CANCELLED', { groupId: null })
      await end(ofDate.filter((row) => statuses.get(row.effectId) === 'DONE'), 'SENT', null, { reported: true, groupId: null })
    }
    return rows
  }

  // ── 결과 (AC16·AC17) ─────────────────────────────────────────────────

  /** 결과 알림. 그 판매자의 확장 행이 아닌 ID가 있으면 null. 바뀐(또는 이미 그 상태인) 행의 지금 상태 */
  async result(sellerId: string, ids: readonly number[], result: ThanksResult): Promise<{ id: number; state: string }[] | null> {
    const { db } = this.#deps
    const rows = await extensionRowsById(db, sellerId, ids)
    if (rows.length !== new Set(ids).size) return null
    const broadcasts = [...new Set(rows.map((row) => row.broadcastId ?? ''))]
    if (broadcasts.length !== 1) return null
    const b = broadcasts[0] as string
    return this.#serial(`${sellerId}\u0000${b}`, async () => {
      const now = this.#now()
      const first = rows[0] as RunnerRow
      if (result === 'POSTED') {
        const changed = await updateExtensionRows(db, sellerId, ids, { state: 'SENT', reason: null, postedAt: now, nextAt: null, leaseOwner: null, leaseUntil: null, reported: false }, now, ['SENDING'])
        if (changed.length > 0) {
          this.#publish(sellerId, first.date, changed, 'SENT', null)
          const lane = await readLane(db, sellerId, b)
          await writeLane(db, sellerId, b, { fails: 0, lastDoneAt: now })
          if ((lane?.fails ?? 0) > 0) this.onChanged(sellerId)
        }
      } else if (result === 'UNCONFIRMED') {
        const changed = await updateExtensionRows(db, sellerId, ids, { state: 'FAILED', reason: 'UNCONFIRMED', nextAt: null, leaseOwner: null, leaseUntil: null }, now, ['SENDING'])
        if (changed.length > 0) {
          this.#publish(sellerId, first.date, changed, 'FAILED', 'UNCONFIRMED')
          await this.#failed(sellerId, b, now)
        }
      } else {
        // 넣기 전에 멈췄다 — 다시 맡을 수 있게 (기한은 가져갈 때 본다)
        const changed = await updateExtensionRows(
          db,
          sellerId,
          ids,
          { state: 'WAITING', reason: 'EXTENSION', groupId: null, sentText: null, attemptAt: null, leaseOwner: null, leaseUntil: null },
          now,
          ['SENDING'],
        )
        this.#publish(sellerId, first.date, changed, 'WAITING', 'EXTENSION')
      }
      const fresh = await extensionRowsById(db, sellerId, ids)
      return fresh.map((row) => ({ id: row.id, state: row.state ?? 'WAITING' }))
    })
  }

  // ── 화면 ──────────────────────────────────────────────────────────────

  async view(sellerId: string): Promise<ThanksView> {
    const { db } = this.#deps
    const enabledAt = await postEnabledAt(db, sellerId)
    const warnings: ThanksWarning[] = []
    if (enabledAt !== null) {
      const bound = new Set<string>()
      for (const binding of await activeBindings(db, sellerId)) {
        const broadcast = await findBroadcast(db, sellerId, binding.broadcastId)
        if (broadcast !== null && broadcast.endedAt === null) bound.add(binding.broadcastId)
      }
      for (const lane of await lanesOf(db, sellerId)) {
        if (!bound.has(lane.broadcastId)) continue
        // 초대 방송은 확장으로 올리지 않으니 확장 경고(방송 채널 로그인 등)도 띄우지 않는다 (AC-INV1-10)
        if (await this.#invited(sellerId, lane.broadcastId)) continue
        if (lane.pausedAt !== null) warnings.push({ broadcast: lane.broadcastId, kind: 'PAUSED', message: EXT_THANKS_MESSAGES.PAUSED })
        if (lane.ownerProblemAt !== null) warnings.push({ broadcast: lane.broadcastId, kind: 'OWNER', message: EXT_THANKS_MESSAGES.OWNER })
      }
    }
    return { enabled: enabledAt !== null, enabledAt: enabledAt?.toISOString() ?? null, warnings }
  }

  /** 그 회차에 이어진 유튜브 방송이 초대 방송(방송 채널 ≠ 글 올리는 계정)인가 */
  async #invited(sellerId: string, broadcastId: string): Promise<boolean> {
    const link = await activeLink(this.#deps.db, sellerId, broadcastId)
    return link !== null && isInvitedLink(link)
  }

  /**
   * 회차의 방송 채널: YT-02 이은 영상의 방송 채널(초대 방송이면 유튜버 채널, 옛 기록은 이은 채널) → 유튜브 연결 채널 → 감사 올리기에서 확인한 채널
   * (모르면 null) — 확장의 방송자 표시를 견줄 때 (D-X1-29, D-PHN-21)
   */
  async broadcastChannel(sellerId: string, broadcastId: string): Promise<string | null> {
    const { db } = this.#deps
    const link = await activeLink(db, sellerId, broadcastId)
    if (link !== null) return link.broadcastChannelId
    const connection = await youtubeChannelOf(db, sellerId)
    if (connection !== null) return connection.channelId
    return (await readLane(db, sellerId, broadcastId))?.ownerChannelId ?? null
  }

  /** 확장이 읽은 채팅 중 우리(판매자 채널)가 올린 글을 가릴 때 쓰는 채널 ID들 */
  async ownChannels(sellerId: string, broadcastId: string): Promise<Set<string>> {
    const { db } = this.#deps
    const out = new Set<string>()
    const link = await activeLink(db, sellerId, broadcastId)
    if (link !== null) out.add(link.channelId)
    const lane = await readLane(db, sellerId, broadcastId)
    if (lane?.ownerChannelId !== null && lane?.ownerChannelId !== undefined) out.add(lane.ownerChannelId)
    const connection = await youtubeChannelOf(db, sellerId)
    if (connection !== null) out.add(connection.channelId)
    return out
  }
}
