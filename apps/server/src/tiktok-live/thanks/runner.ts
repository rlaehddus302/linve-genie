// 틱톡 감사 채팅 실행기 (D-TT-SEND-01~08). 유튜브 봇 길(D-YT-SEND-11)과 같은 생각: 판매자는 아무것도 설정하지 않고, 운영자가 고른 판매자의
// 틱톡 구매자(tt:) 찜이 확정되면 라이브지니 봇 계정이 판매자의 틱톡 라이브 채팅에 감사 글을 올린다.
// - 행: 기록 트랜잭션이 via = TIKTOK·WAITING(TIKTOK)·기한 10분으로 적는다(thanks-route.ts). 실시간 채팅 감사 스위치(thanks.liveChat)가 꺼져 있으면
//   엔진이 감사 효과를 내지 않으므로 행도 없다 — 그 스위치가 곧 동의다(D-YT-SEND-18과 같음).
// - 한 바퀴(intervalMs마다, 겹치지 않음):
//   (1) 결과 없이 임대가 지난 보내는 중 행 → FAILED(UNCONFIRMED). 저절로 다시 올리지 않는다(서버가 보내는 도중 멈춤 — 올라갔을 수 있다).
//   (2) 때가 된 기다림 행을 판매자·회차마다: 기한 지남 → FAILED(EXPIRED) · 지금 엔진 상태 취소 → SKIPPED(CANCELLED), 완료 → SENT(보고함) ·
//       그 회차의 틱톡 연결이 없음·끊음 → FAILED(NO_LINK), 방송 끝 → FAILED(CHAT_ENDED) → 남은 행을 150자 묶음(판매 경계)으로 나눠 첫 메시지 하나만
//       SENDING으로 잡고(한 문장) 올린다.
//   (3) 게시됨인데 보고를 못 쓴 행 → effect.thanksSent (요청 번호 ytsent-<행 ID> — 유튜브 실행기와 같아 누가 써도 한 번만).
// - 실패: 보내기 단추 전의 실패(로그인 풀림·화면 없음·연결 안 됨)는 올라가지 않았으니 2·4·8·16·32초 뒤 다시(최대 5번, 그 뒤 FAILED —
//   로그인 풀림이면 BOT_LOGIN, 아니면 GAVE_UP). 누른 뒤 확인 못 함(unverified)은 FAILED(UNCONFIRMED) — 판매자가 "올라가 있어요"·다시 보내기로 고른다.
// - 보내기 직전에 그 글을 OwnThanks에 적는다 → 채팅에 뜬 봇 감사 글을 찜으로 읽지 않는다(D-TT-SEND-06).
// 로그에 글·아이디를 남기지 않는다(판매자 ID·코드·수만).
import { listEffects, type EngineEffect } from '@livejjim/core'
import type { Db } from '../../db/database.ts'
import { errorKind, type LogSink } from '../../log.ts'
import type { ScopeWriter } from '../../writer.ts'
import { ChatSendError } from '../../youtube/chat-send/sender.ts'
import { TT_LEASE_OWNER, tiktokDueRows, tiktokLapsedRows, tiktokUnreportedRows, updateTiktokRows, type RowChange, type RunnerRow } from '../../youtube/outbox-store.ts'
import { batchMessages } from '../../youtube/texts.ts'
import type { Timer } from '../../youtube/timer.ts'
import { latestTiktokLink } from '../store.ts'
import { TT_COMMENT_MAX, type TikTokChatSender } from './browser-sender.ts'
import type { OwnThanks } from './own.ts'

export const TT_THANKS_INTERVAL_MS = 2000
/** 보내는 중 임대 — 이보다 오래 결과가 없으면 확인하지 못함 (보내기 한 번은 열기 20초 + 확인 8초 + 간격) */
export const TT_THANKS_LEASE_MS = 90_000
/** 다시 시도 간격 (올라가지 않은 실패만) */
export const TT_THANKS_RETRY_MS = [2000, 4000, 8000, 16_000, 32_000] as const

export interface TikTokThanksOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly timer: Timer
  readonly log: LogSink
  readonly sender: TikTokChatSender
  /** 이 길을 쓰는 판매자 ('*' = 모두) */
  readonly sellers: readonly string[] | '*'
  readonly own: OwnThanks
  /** 발송함 행 바뀜 알림 (유튜브 발송함과 같은 꼴 — 콘솔 감사 목록이 다시 읽는다) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  readonly intervalMs?: number
}

const effectText = (row: RunnerRow): string => {
  try {
    return (JSON.parse(row.body) as EngineEffect).text ?? row.postText ?? ''
  } catch {
    return row.postText ?? ''
  }
}

export class TikTokThanks {
  readonly #options: TikTokThanksOptions
  readonly #chosen: ReadonlySet<string> | null
  #handle: ReturnType<typeof setInterval> | null = null
  #running: Promise<void> | null = null
  #closed = false

  constructor(options: TikTokThanksOptions) {
    this.#options = options
    this.#chosen = options.sellers === '*' ? null : new Set(options.sellers)
  }

  /** 그 판매자의 틱톡 구매자 감사를 이 길로 올리나 (기록 트랜잭션이 묻는다) */
  applies(sellerId: string): boolean {
    return this.#chosen === null || this.#chosen.has(sellerId)
  }

  start(): void {
    if (this.#handle !== null || this.#closed) return
    this.#handle = setInterval(() => void this.tick(), this.#options.intervalMs ?? TT_THANKS_INTERVAL_MS)
    this.#handle.unref?.()
  }

  async close(): Promise<void> {
    this.#closed = true
    if (this.#handle !== null) clearInterval(this.#handle)
    this.#handle = null
    await this.#running?.catch(() => {})
    await this.#options.sender.close()
  }

  /** 한 바퀴 (겹치면 앞 바퀴를 기다린다 — 시험은 직접 부른다) */
  tick(): Promise<void> {
    if (this.#running !== null) return this.#running
    this.#running = this.#round()
      .catch((error: unknown) => {
        this.#options.log({
          level: 'error',
          code: 'TIKTOK_THANKS_ROUND_FAILED',
          errorKind: errorKind(error),
        })
      })
      .finally(() => {
        this.#running = null
      })
    return this.#running
  }

  #now(): Date {
    return new Date(this.#options.timer.now())
  }

  #publish(sellerId: string, date: string | null, ids: readonly number[], state: string, reason: string | null): void {
    if (ids.length === 0) return
    this.#options.publish(sellerId, {
      kind: 'outbox',
      ...(date === null ? {} : { date }),
      ids: [...ids],
      state,
      reason,
    })
  }

  async #set(rows: readonly RunnerRow[], change: RowChange, expect: readonly string[]): Promise<number[]> {
    const first = rows[0]
    if (first === undefined) return []
    const changed = await updateTiktokRows(
      this.#options.db,
      first.sellerId,
      rows.map((row) => row.id),
      change,
      this.#now(),
      expect,
    )
    if (changed.length > 0 && change.state !== undefined) this.#publish(first.sellerId, first.date, changed, change.state ?? 'WAITING', change.reason ?? null)
    return changed
  }

  async #round(): Promise<void> {
    const { db } = this.#options
    // (1) 임대가 지난 보내는 중
    for (const row of await tiktokLapsedRows(db, this.#now())) {
      await this.#set(
        [row],
        {
          state: 'FAILED',
          reason: 'UNCONFIRMED',
          leaseOwner: null,
          leaseUntil: null,
          nextAt: null,
        },
        ['SENDING'],
      )
    }
    // (2) 때가 된 기다림 — 판매자·회차마다 메시지 하나
    const groups = new Map<string, RunnerRow[]>()
    for (const row of await tiktokDueRows(db, this.#now())) {
      const key = `${row.sellerId}\u0000${row.broadcastId ?? ''}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const rows of groups.values()) {
      if (this.#closed) return
      await this.#sendOne(rows)
    }
    // (3) 보고
    await this.#reportAll()
  }

  async #sendOne(waiting: readonly RunnerRow[]): Promise<void> {
    const { db, writer } = this.#options
    const first = waiting[0] as RunnerRow
    const sellerId = first.sellerId
    const now = this.#now()
    let rows = [...waiting]
    const end = async (list: readonly RunnerRow[], change: RowChange) => {
      if (list.length === 0) return
      await this.#set(list, { nextAt: null, ...change }, ['WAITING'])
      rows = rows.filter((row) => !list.includes(row))
    }
    await end(
      rows.filter((row) => !row.manual && row.deadlineAt !== null && row.deadlineAt.getTime() <= now.getTime()),
      { state: 'FAILED', reason: 'EXPIRED' },
    )
    for (const date of new Set(rows.map((row) => row.date))) {
      const statuses = new Map(listEffects((await writer.read(sellerId, date, false)).state).map((effect) => [effect.id, effect.status]))
      const ofDate = rows.filter((row) => row.date === date)
      await end(
        ofDate.filter((row) => statuses.get(row.effectId) === 'CANCELLED'),
        { state: 'SKIPPED', reason: 'CANCELLED', groupId: null },
      )
      await end(
        ofDate.filter((row) => statuses.get(row.effectId) === 'DONE'),
        { state: 'SENT', reason: null, reported: true, groupId: null },
      )
    }
    if (rows.length === 0) return
    const link = first.broadcastId === null ? null : await latestTiktokLink(db, sellerId, first.broadcastId)
    if (link === null || link.state === 'UNLINKED') {
      await end(rows, { state: 'FAILED', reason: 'NO_LINK' })
      return
    }
    if (link.state === 'ENDED') {
      await end(rows, { state: 'FAILED', reason: 'CHAT_ENDED' })
      return
    }
    const [message] = batchMessages(
      rows.map((row) => ({ id: row.id, text: effectText(row) })),
      TT_COMMENT_MAX,
    )
    if (message === undefined) return
    const members = rows.filter((row) => message.ids.includes(row.id))
    const groupId = `t${String(Math.min(...message.ids))}-${String(now.getTime())}`
    const claimed = await this.#set(
      members,
      {
        state: 'SENDING',
        reason: null,
        groupId,
        postText: message.text,
        sentText: message.text,
        attemptAt: now,
        leaseOwner: TT_LEASE_OWNER,
        leaseUntil: new Date(now.getTime() + TT_THANKS_LEASE_MS),
      },
      ['WAITING'],
    )
    if (claimed.length !== members.length) {
      // 그사이 다른 쪽(다시 보내기·다른 서버)이 바꿨다 — 잡은 것만 되돌리고 다음 바퀴에
      await updateTiktokRows(
        db,
        sellerId,
        claimed,
        {
          state: 'WAITING',
          reason: 'TIKTOK',
          groupId: null,
          sentText: null,
          attemptAt: null,
          leaseOwner: null,
          leaseUntil: null,
        },
        this.#now(),
        ['SENDING'],
      )
      return
    }
    const sending = members.filter((row) => claimed.includes(row.id))
    this.#options.own.remember(sellerId, message.text)
    try {
      await this.#options.sender.send(link.tiktokId, message.text)
    } catch (error) {
      const kind = error instanceof ChatSendError ? error.kind : 'unverified'
      this.#options.log({
        level: kind === 'auth' ? 'error' : 'warn',
        code: 'TIKTOK_THANKS_FAILED',
        seller: sellerId,
        errorKind: kind,
      })
      if (kind === 'unverified' || kind === 'timeout' || kind === 'server') {
        await this.#set(
          sending,
          {
            state: 'FAILED',
            reason: 'UNCONFIRMED',
            leaseOwner: null,
            leaseUntil: null,
            nextAt: null,
          },
          ['SENDING'],
        )
        return
      }
      // 올라가지 않음이 확실하다 — 행마다 시도 수를 올려 다시 (모두 같은 메시지라 같은 수)
      const attempts = Math.max(...sending.map((row) => row.attempts)) + 1
      const delay = TT_THANKS_RETRY_MS[attempts - 1]
      if (delay === undefined) {
        await this.#set(
          sending,
          {
            state: 'FAILED',
            reason: kind === 'auth' || kind === 'blocked' ? 'BOT_LOGIN' : 'GAVE_UP',
            attempts,
            groupId: null,
            leaseOwner: null,
            leaseUntil: null,
            nextAt: null,
          },
          ['SENDING'],
        )
        return
      }
      await this.#set(
        sending,
        {
          state: 'WAITING',
          reason: 'RETRY',
          attempts,
          groupId: null,
          sentText: null,
          attemptAt: null,
          leaseOwner: null,
          leaseUntil: null,
          nextAt: new Date(this.#options.timer.now() + delay),
        },
        ['SENDING'],
      )
      return
    }
    await this.#set(
      sending,
      {
        state: 'SENT',
        reason: null,
        postedAt: this.#now(),
        remoteId: null,
        reported: false,
        leaseOwner: null,
        leaseUntil: null,
        nextAt: null,
      },
      ['SENDING'],
    )
    this.#options.log({
      level: 'info',
      code: 'TIKTOK_THANKS_SENT',
      seller: sellerId,
      count: sending.length,
    })
  }

  async #reportAll(): Promise<void> {
    for (const row of await tiktokUnreportedRows(this.#options.db)) {
      const requestId = `ytsent-${String(row.id)}`
      const outcome = await this.#options.writer.write({
        sellerId: row.sellerId,
        date: row.date,
        rehearsal: false,
        createScope: false,
        requestId,
        build: () => [
          {
            fields: { type: 'effect.thanksSent', effectId: row.effectId },
            actor: row.confirmedBy === null ? { kind: 'server' } : { kind: 'account', accountId: row.confirmedBy },
            requestId,
          },
        ],
      })
      if (outcome.kind === 'ok' || outcome.kind === 'duplicate' || outcome.kind === 'empty' || (outcome.kind === 'rejected' && outcome.rejection.code === 'SEALED')) {
        await updateTiktokRows(this.#options.db, row.sellerId, [row.id], { reported: true }, this.#now(), ['SENT'])
      } else {
        this.#options.log({
          level: 'warn',
          code: 'OUTBOX_REPORT_FAILED',
          seller: row.sellerId,
          date: row.date,
        })
      }
    }
  }
}
