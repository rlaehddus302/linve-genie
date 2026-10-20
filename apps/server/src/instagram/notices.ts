// 인스타그램 실시간 알림 (SSE event: instagram — AC-N2-15·24·25·36·37·51).
// - 알림 문장 알림(UNLINKED_COMMENTS·MANY_WAITING·LATE_COMMENTS·LIVE_NOT_MOVED)은 처음 한 번과 그 뒤 1분에 한 번까지(서버 시계). LIVE_MOVED는 옮길 때마다 한 번.
// - LIVE_NOT_MOVED(AC-N2-25, D-N2-17·18)는 옮기기가 (바)·(사)·(아)로만 막힌 새 라이브 댓글 — UNLINKED_COMMENTS 대신 보낸다(라이브마다 같은 간격).
//   문장은 이유마다 다르고, 이유가 여럿이면 하나만 준다: GAP → OTHER_BROADCAST → TOO_SOON 순서(판매자가 손을 써야 풀리는 이유가 먼저).
// - 수집 상태 알림은 댓글마다가 아니라 묶어서 1초에 한 번까지(처음은 바로, 그 사이 바뀐 것은 1초 창 끝에 한 번).
// - 여러 서버 인스턴스 사이의 알림 공유는 범위 밖(컨테이너 1개, hub.ts와 같다).
import { errorKind, type LogSink } from '../log.ts'
import type { Clock } from '../time.ts'

export const NOTICE_MESSAGES = {
  UNLINKED_COMMENTS: '인스타그램 라이브 댓글이 오고 있는데 이어진 방송이 없어요. 방송에 이어 주세요.',
  MANY_WAITING: '인스타그램을 기다리는 방송이 둘 이상이라 고르지 못했어요. 하나에 이어 주세요.',
  LATE_COMMENTS: '인스타그램 댓글이 늦게 도착했어요. 순서가 실제와 다를 수 있어요.',
} as const

/**
 * 옮기기가 막힌 이유마다 문장 (AC-N2-25): OTHER_BROADCAST (바) 끝나지 않은 다른 실제 회차 · GAP (사) 마지막 활동에서 60분 넘게 떨어짐 ·
 * TOO_SOON (아) 이은·옮긴 시각에서 60초 안(기다리면 풀린다, D-N2-18)
 */
export const LIVE_NOT_MOVED_MESSAGES = {
  OTHER_BROADCAST:
    '새 인스타그램 라이브 댓글이 오고 있는데, 끝나지 않은 방송이 여럿이라 어느 방송에 이을지 몰라 기록하지 않고 있어요. 쓰지 않는 방송은 끝내고, 이어 갈 방송을 새 라이브에 이어 주세요.',
  GAP: '새 인스타그램 라이브 댓글이 오고 있는데, 방송의 마지막 댓글과 1시간 넘게 떨어져 같은 방송인지 몰라 기록하지 않고 있어요. 이어 갈 방송을 새 라이브에 이어 주세요.',
  TOO_SOON:
    '방송을 방금 인스타그램 라이브에 이어서, 1분 동안은 다른 라이브에서 온 댓글을 기록하지 않아요. 1분이 지나도 지금 방송 중인 라이브의 댓글이 기록되지 않으면 방송을 그 라이브에 다시 이어 주세요.',
} as const

export type LiveNotMovedReason = keyof typeof LIVE_NOT_MOVED_MESSAGES

/** 1분 간격 알림 코드 (문장 하나짜리 셋 + 이유마다 문장인 LIVE_NOT_MOVED) */
export type NoticeCode = keyof typeof NOTICE_MESSAGES | 'LIVE_NOT_MOVED'

/** 저절로 이은 회차를 새 라이브로 옮김 (AC-N2-25) — 옮길 때마다 한 번. N이 0이면 첫 문장만 */
export const LIVE_MOVED_MESSAGE = '인스타그램 라이브가 바뀌어 방송을 새 라이브에 다시 이었어요.'

export function liveMovedMessage(count: number): string {
  return count > 0 ? `${LIVE_MOVED_MESSAGE} 그 전 라이브에서 이 방송에 기록한 댓글 ${String(count)}개를 확인해 주세요.` : LIVE_MOVED_MESSAGE
}

/** 알림 예약 (시험은 기다리지 않는 타이머를 넣는다) */
export interface LiveTimer {
  schedule(ms: number, fn: () => void): () => void
}

export const realLiveTimer: LiveTimer = {
  schedule(ms, fn) {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return () => clearTimeout(handle)
  },
}

/** 알림 문장 알림 간격 (1분) · 수집 상태 알림 간격 (1초) */
export const NOTICE_INTERVAL_MS = 60_000
export const COLLECTION_INTERVAL_MS = 1000

export interface NoticeDeps {
  readonly clock: Clock
  readonly timer: LiveTimer
  readonly log: LogSink
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 회차의 수집 상태 알림 본문을 만든다 (없으면 null) */
  readonly collection: (sellerId: string, broadcastId: string) => Promise<Readonly<Record<string, unknown>> | null>
  readonly collectionIntervalMs?: number
}

interface Window {
  pending: boolean
  cancel: (() => void) | null
}

export class LiveNotices {
  readonly #deps: NoticeDeps
  readonly #lastNotice = new Map<string, number>()
  readonly #windows = new Map<string, Window>()
  #closed = false

  constructor(deps: NoticeDeps) {
    this.#deps = deps
  }

  #publish(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    if (this.#closed) return
    try {
      this.#deps.publish(sellerId, data)
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'STREAM_FAILED', errorKind: errorKind(error) })
    }
  }

  /** (판매자, 코드, key)마다 처음 한 번과 그 뒤 1분에 한 번까지 — 보낼 차례면 true (그 시각을 적는다) */
  #due(sellerId: string, code: NoticeCode, key: string): boolean {
    const id = JSON.stringify([sellerId, code, key])
    const now = this.#deps.clock.now()
    const last = this.#lastNotice.get(id)
    if (last !== undefined && now - last < NOTICE_INTERVAL_MS) return false
    this.#lastNotice.set(id, now)
    return true
  }

  /** 알림 문장 알림 (key마다 처음 한 번과 그 뒤 1분에 한 번까지). extra는 수 등 */
  notice(sellerId: string, code: keyof typeof NOTICE_MESSAGES, key: string, extra: Readonly<Record<string, unknown>>): void {
    if (!this.#due(sellerId, code, key)) return
    this.#publish(sellerId, { kind: 'NOTICE', code, message: NOTICE_MESSAGES[code], ...extra })
  }

  /**
   * 옮기기가 (바)·(사)·(아)로만 막힌 새 라이브의 댓글 (AC-N2-25, D-N2-17·18) — UNLINKED_COMMENTS 대신. 라이브(liveId)마다 처음 한 번과 그 뒤 1분에 한 번까지.
   * broadcast = 옮기려던 회차, count = 그 라이브의 이어지지 않은 댓글 수, reason = GAP · OTHER_BROADCAST · TOO_SOON (여럿이면 이 순서로 하나 — live-links #movable이 정한다)
   */
  notMoved(sellerId: string, extra: { readonly broadcast: string; readonly liveId: string; readonly count: number; readonly reason: LiveNotMovedReason }): void {
    if (!this.#due(sellerId, 'LIVE_NOT_MOVED', extra.liveId)) return
    this.#publish(sellerId, {
      kind: 'NOTICE',
      code: 'LIVE_NOT_MOVED',
      message: LIVE_NOT_MOVED_MESSAGES[extra.reason],
      reason: extra.reason,
      broadcast: extra.broadcast,
      liveId: extra.liveId,
      count: extra.count,
    })
  }

  /** 라이브를 옮김 (AC-N2-25): 옮길 때마다 한 번 — 묶거나 거르지 않는다. count = 옮기기 전까지 그 방송에 기록한 인스타그램 댓글 수 */
  moved(sellerId: string, broadcastId: string, extra: { readonly liveId: string; readonly count: number }): void {
    this.#publish(sellerId, { kind: 'NOTICE', code: 'LIVE_MOVED', message: liveMovedMessage(extra.count), broadcast: broadcastId, liveId: extra.liveId, count: extra.count })
  }

  /** 바로 알린다 (연결·라이브 연결·DM 행) */
  now(sellerId: string, data: Readonly<Record<string, unknown>>): void {
    this.#publish(sellerId, data)
  }

  /** 수집 상태가 바뀜 — 1초에 한 번까지 묶어서 */
  collection(sellerId: string, broadcastId: string): void {
    if (this.#closed) return
    const id = JSON.stringify([sellerId, broadcastId])
    const window = this.#windows.get(id)
    if (window !== undefined) {
      window.pending = true
      return
    }
    const fresh: Window = { pending: false, cancel: null }
    this.#windows.set(id, fresh)
    this.#send(sellerId, broadcastId)
    const close = () => {
      if (fresh.pending && !this.#closed) {
        fresh.pending = false
        this.#send(sellerId, broadcastId)
        fresh.cancel = this.#deps.timer.schedule(this.#deps.collectionIntervalMs ?? COLLECTION_INTERVAL_MS, close)
        return
      }
      this.#windows.delete(id)
    }
    fresh.cancel = this.#deps.timer.schedule(this.#deps.collectionIntervalMs ?? COLLECTION_INTERVAL_MS, close)
  }

  #send(sellerId: string, broadcastId: string): void {
    void this.#deps
      .collection(sellerId, broadcastId)
      .then((data) => {
        if (data !== null) this.#publish(sellerId, data)
      })
      .catch((error: unknown) => this.#deps.log({ level: 'warn', code: 'STREAM_FAILED', errorKind: errorKind(error) }))
  }

  close(): void {
    this.#closed = true
    for (const window of this.#windows.values()) window.cancel?.()
    this.#windows.clear()
  }
}
