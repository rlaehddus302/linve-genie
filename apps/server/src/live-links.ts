// 회차의 라이브 연결 — 플랫폼 공통 (PLT-03, D-N2-05·D-N2-08·D-N2-12, AC-N2-03·04·20~24·37).
// - 회차마다 끊지 않은 연결(WAITING 기다리는 중·LINKED 이어짐)은 하나뿐이다(DB 부분 유일 인덱스 + 판매자마다 한 줄 처리).
// - 받지 않는 경우(아무것도 바꾸지 않는다): 다른 판매자·없는 회차 404, 리허설 REHEARSAL, 끝난 회차 ENDED, 이미 연결 ALREADY_LINKED,
//   틱톡 PLATFORM_NOT_SUPPORTED(어떤 외부 주소도 부르지 않는다), 인스타그램 설정 없음 NOT_CONFIGURED,
//   실제 시각순 스냅샷 회차 RECEIVED_TIME_NOT_ALLOWED, 연결 없음 NOT_CONNECTED, 진행 중 내 라이브가 아님 NOT_LIVE, 다른 회차에 이어진 라이브 LIVE_TAKEN.
// - 잇기·기다리기·끊기는 엔진 이벤트가 아니다 — 누가·언제는 live_links에 남는다(DAT-05). 같은 요청 번호는 한 번만 한다(처음 응답).
// - 웹훅 댓글의 회차 정하기(resolveTarget): 그 라이브에 이어진 끝나지 않은 회차, 없으면 기다리는 끝나지 않은 회차가 정확히 하나일 때 저절로 잇는다(조치자 서버).
//   기다리는 회차도 없으면, 서버가 저절로 이은(옮긴) 회차 하나를 같은 계정의 새 라이브로 옮긴다(AC-N2-25, D-N2-16 — 한 계정은 한 번에 라이브 하나).
//   다음 셋으로는 옮기지 않고 막힌 이유를 돌려준다(D-N2-17·18 — 웹훅이 UNLINKED_COMMENTS 대신 LIVE_NOT_MOVED로 알린다).
//   이유가 여럿이면 하나만, GAP → OTHER_BROADCAST → TOO_SOON 순서다(판매자가 손을 써야 풀리는 이유가 먼저 — TOO_SOON은 기다리면 풀린다):
//   (사) GAP: 그 댓글을 받은 시각이 그 회차의 마지막 활동(마지막으로 기록한 인스타 댓글을 받은 시각과 이은·옮긴 시각 중 늦은 것)에서 60분 넘게 떨어졌다
//        (60분 정각은 옮긴다). 서버 시계만 본다 — 방송 날짜·달력 날짜는 보지 않아 자정을 넘긴 방송의 다시 켜기도 옮긴다(TD-N2-004).
//   (바) OTHER_BROADCAST: 그 판매자에게 그 회차 말고 끝나지 않은 실제 회차가 있다(리허설만 빼고 연결 없는 회차·손으로 이은 회차·날짜가 다른 회차 모두)
//        — 새 라이브가 어느 회차의 라이브인지 모호하다(SA-N2-004·TD-N2-003: 끝내지 않은 1부가 2부 라이브로 옮겨 가 2부 주문이 1부 같은 번호의 찜이 되던 것).
//   (아) TOO_SOON: 그 댓글을 받은 시각이 그 연결의 이은 시각(옮겼으면 마지막으로 옮긴 시각)에서 60초 안이다(60초 정각도 옮기지 않고 60,001ms부터 옮긴다).
//        서버 시계만 본다 — entry.time은 늦은 댓글 판단에만 쓴다. 빠르게 두 번 다시 켤 때(M → M2 → M3) 늦게 배달된 끝난 라이브 M2의 댓글이
//        방송 중인 M3에서 b를 M2로 되돌리지 않게 한다(TD-N2-005). 막힌 라이브는 "이어진 적 있는 라이브"가 아니다 — 60초가 지나면 그 라이브의 다음 댓글에서 옮긴다.
//   옮기기는 그 댓글의 기록과 같은 트랜잭션에서 한다(applyMove) — 기록되지 않으면(끝난 회차 등) 옮기지도 않는다.
import { getBroadcast } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { isPlatform, PLATFORM_MESSAGES, type LiveSource, type Platform } from './platform.ts'
import type { SellerLocks } from './seller-locks.ts'
import { findBroadcast } from './store.ts'
import { activeLink as youtubeLink } from './youtube/store.ts'
import type { Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'
import {
  autoLink,
  findRequest,
  insertLink,
  insertRequest,
  lastMove,
  latestLink,
  linkedToLive,
  liveChatStats,
  liveEverLinked,
  movableLinks,
  moveLink,
  openLinks,
  otherOpenBroadcast,
  unlinkLink,
  waitingLinks,
  type LinkRow,
} from './instagram/store.ts'
import { liveMovedMessage } from './instagram/notices.ts'

export const LINK_MESSAGES = {
  REHEARSAL: '리허설 방송에는 라이브를 이을 수 없어요.',
  ENDED: '끝난 방송에는 라이브를 이을 수 없어요.',
  ALREADY_LINKED: '이 방송에는 이미 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.',
  RECEIVED_TIME_NOT_ALLOWED: "인스타그램 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요.",
  NOT_LIVE: '진행 중인 내 인스타그램 라이브만 이을 수 있어요.',
  LIVE_TAKEN: '이미 다른 방송에 이어진 인스타그램 라이브예요.',
  NOT_CONNECTED: '인스타그램 계정을 먼저 연결해 주세요.',
  RECONNECT_NEEDED: '인스타그램 연결을 다시 해 주세요.',
  NOT_CONFIGURED: PLATFORM_MESSAGES.instagramNotConfigured,
  PLATFORM_NOT_SUPPORTED: PLATFORM_MESSAGES.tiktokNotSupported,
  PLATFORM_NOT_READY: PLATFORM_MESSAGES.youtubeNotReady,
  NOT_LINKED: '이어진 라이브가 없어요.',
  UNAVAILABLE: '인스타그램에서 라이브 목록을 받지 못했어요. 잠시 뒤 다시 해 주세요.',
} as const

export type LinkErrorCode = keyof typeof LINK_MESSAGES

export const COLLECTION_MESSAGES = {
  WAITING: '인스타그램 라이브를 기다리는 중이에요. 라이브를 시작하면 첫 댓글부터 받아요.',
  LIVE: '댓글을 받는 중',
  FINISHED: '방송을 끝내 댓글 기록을 마쳤어요.',
  STOPPED: '인스타그램 연결이 끊겨 댓글을 받지 않아요.',
} as const

export type CollectionState = keyof typeof COLLECTION_MESSAGES

/** 수집 상태 (AC-N2-37) */
export interface CollectionView {
  readonly platform: Platform
  readonly state: CollectionState
  readonly message: string
  readonly liveId: string | null
  /** 마지막으로 댓글을 받은 시각 (UTC ISO) */
  readonly lastCommentAt: string | null
  /** 기록한 댓글 수·늦게 받은 댓글 수·형식 틀린 댓글 수 */
  readonly comments: number
  readonly late: number
  readonly malformed: number
}

/** 끊지 않은 연결의 마지막 옮기기 (AC-N2-03·25, D-N2-17 — SSE LIVE_MOVED를 놓쳐도 다시 볼 수 있게) */
export interface MovedView {
  /** 옮기기 전 라이브 ID */
  readonly fromLiveId: string
  /** 옮긴 시각 (UTC ISO) */
  readonly movedAt: string
  /** 옮기기 전까지 그 방송에 기록한 인스타그램 댓글 수 (그때 LIVE_MOVED의 N) */
  readonly comments: number
  /** 그때의 LIVE_MOVED 문장 */
  readonly message: string
}

/** 회차의 라이브 연결 조회 (AC-N2-03) */
export interface LinkView {
  readonly broadcast: string
  /** 끊지 않은 연결의 플랫폼 (없으면 null) */
  readonly platform: Platform | null
  readonly state: 'NONE' | 'WAITING' | 'LINKED'
  /** 이은 라이브 ID (LINKED일 때) */
  readonly liveId: string | null
  /** 이은(기다리기로 정한) 시각 (UTC ISO) */
  readonly linkedAt: string | null
  /** 조치자: 판매자 계정(로그인 아이디) 또는 서버(저절로 잇기) */
  readonly actor: { readonly kind: 'account' | 'server'; readonly loginId: string | null } | null
  /** 이을 때 연결돼 있던 인스타그램 계정 ID */
  readonly accountId: string | null
  readonly collection: CollectionView | null
  /** 그 연결이 새 라이브로 옮겨진 적이 있으면 마지막 옮기기 (없거나 NONE이면 null — 연결마다 따로) */
  readonly moved: MovedView | null
}

/** 저장해 두고 같은 요청 번호에 그대로 돌려주는 응답 */
export interface LinkOutcome {
  readonly status: number
  readonly body: Readonly<Record<string, unknown>>
}

/** 인스타그램 쪽에서 라이브 연결이 쓰는 것 */
export interface InstagramPort {
  readonly configured: boolean
  connection(sellerId: string, db?: Db): Promise<{ readonly status: string; readonly accountId: string } | null>
  liveNow: LiveSource['liveNow']
}

export interface LiveLinksDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly locks: SellerLocks
  readonly instagram: InstagramPort
  /** 연결이 바뀜 (SSE) */
  readonly onChange: (sellerId: string, broadcastId: string) => void
  /** 끊음: 그 회차의 기다리던 DM 행을 FAILED(NO_LINK)로 (같은 트랜잭션). 커밋된 뒤 부를 일(알림)을 돌려준다 */
  readonly onUnlink: (tx: Db, sellerId: string, broadcastId: string, now: Date) => Promise<(() => void) | null>
}

/** 새 라이브로 옮길 연결 (AC-N2-25) — 그 댓글을 기록하는 트랜잭션에서 applyMove로 옮긴다 */
export interface LiveMove {
  readonly kind: 'move'
  readonly linkId: number
  readonly broadcastId: string
  /** 옮기기 전 라이브 · 옮길 라이브(그 댓글의 라이브) */
  readonly fromLiveId: string
  readonly toLiveId: string
  /** 그 인스타그램 계정 ID (옮기기 전 연결과 같다) */
  readonly accountId: string
}

/**
 * 옮기기가 막힌 이유 (AC-N2-25, D-N2-17·18): (사) GAP 마지막 활동에서 60분 넘게 떨어짐 · (바) OTHER_BROADCAST 끝나지 않은 다른 실제 회차 ·
 * (아) TOO_SOON 이은·옮긴 시각에서 60초 안. 여럿이면 하나만, GAP → OTHER_BROADCAST → TOO_SOON 순서
 */
export type MoveBlockReason = 'GAP' | 'OTHER_BROADCAST' | 'TOO_SOON'

/** 다른 조건은 모두 맞는데 (바)·(사)·(아)로만 옮기지 못한 회차 */
export interface MoveBlocked {
  readonly broadcastId: string
  readonly reason: MoveBlockReason
}

/** 옮기기 간격 (사): 마지막 활동에서 이만큼까지는 옮긴다 (60분 정각 포함, D-N2-17) */
export const MOVE_GAP_MS = 60 * 60 * 1000

/** 옮기기 (아): 이은·옮긴 시각에서 이만큼까지는 옮기지 않는다 (60초 정각 포함 — 60,001ms부터 옮긴다, D-N2-18) */
export const MOVE_SETTLE_MS = 60_000

/** 웹훅 댓글의 회차 */
export type LiveTarget =
  | { readonly kind: 'linked'; readonly linkId: number; readonly broadcastId: string; readonly auto: boolean }
  | LiveMove
  | { readonly kind: 'many' }
  /** 기록하지 않는다. blocked: 옮기기가 (바)·(사)·(아)로만 막혔으면 그 회차와 이유 (아니면 null) */
  | { readonly kind: 'none'; readonly blocked: MoveBlocked | null }

const LIVE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

const fail = (status: number, code: LinkErrorCode): LinkOutcome => ({ status, body: { error: { code, message: LINK_MESSAGES[code] } } })
const notFound: LinkOutcome = { status: 404, body: { error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } } }

const lockKey = (sellerId: string) => sql`hashtextextended(${`live-link/${sellerId}`}, 0)`

export class LiveLinks {
  readonly #deps: LiveLinksDeps

  constructor(deps: LiveLinksDeps) {
    this.#deps = deps
  }

  #now(): Date {
    return new Date(this.#deps.clock.now())
  }

  /** 회차의 수집 상태 (인스타그램에 이어진·기다리는 회차만) */
  async collection(sellerId: string, link: LinkRow, db: Db = this.#deps.db): Promise<CollectionView | null> {
    if ((link.state !== 'WAITING' && link.state !== 'LINKED') || link.platform !== 'INSTAGRAM') return null
    const connection = await this.#deps.instagram.connection(sellerId, db)
    let state: CollectionState
    if (link.ended) state = 'FINISHED'
    else if (connection === null || (link.state === 'LINKED' && link.accountId !== connection.accountId)) state = 'STOPPED'
    else state = link.state === 'WAITING' ? 'WAITING' : 'LIVE'
    const stats = link.state === 'LINKED' ? await liveChatStats(db, sellerId, link.scopeId, link.broadcastId) : { count: 0, lastAt: null }
    return {
      platform: 'INSTAGRAM',
      state,
      message: COLLECTION_MESSAGES[state],
      liveId: link.liveId,
      lastCommentAt: stats.lastAt === null ? null : stats.lastAt.toISOString(),
      comments: stats.count,
      late: link.lateCount,
      malformed: link.malformedCount,
    }
  }

  async #view(sellerId: string, broadcastId: string, link: LinkRow | null): Promise<LinkView> {
    return this.#viewIn(this.#deps.db, sellerId, broadcastId, link)
  }

  /** 회차의 라이브 연결 (다른 판매자·없는 회차면 null — 404) */
  async status(sellerId: string, broadcastId: string): Promise<LinkView | null> {
    const broadcast = await findBroadcast(this.#deps.db, sellerId, broadcastId)
    if (broadcast === null) return null
    return this.#view(sellerId, broadcastId, await latestLink(this.#deps.db, sellerId, broadcastId))
  }

  /** 판매자의 끊지 않은 연결 전부 (수집 상태와 함께) */
  async list(sellerId: string): Promise<LinkView[]> {
    const links = await openLinks(this.#deps.db, sellerId)
    return Promise.all(links.map((link) => this.#view(sellerId, link.broadcastId, link)))
  }

  /** 그 라이브에 이어진 끝나지 않은 이 판매자의 회차 (라이브 목록, AC-N2-20) */
  async linkedBroadcast(sellerId: string, liveId: string): Promise<string | null> {
    return (await linkedToLive(this.#deps.db, sellerId, liveId))[0]?.broadcastId ?? null
  }

  /** 회차의 끊지 않은 연결 ID (없으면 null) */
  async openLink(sellerId: string, broadcastId: string): Promise<number | null> {
    const link = await latestLink(this.#deps.db, sellerId, broadcastId)
    return link !== null && link.state !== 'UNLINKED' ? link.id : null
  }

  /** 같은 요청 번호의 처음 응답 */
  async #prior(sellerId: string, requestId: string): Promise<LinkOutcome | null> {
    const stored = await findRequest(this.#deps.db, sellerId, requestId)
    return stored === null ? null : (JSON.parse(stored) as LinkOutcome)
  }

  /** 공통 조건 (AC-N2-03·04·17·21): 회차·플랫폼·리허설·끝남·이미 연결·실제 시각순·연결. 통과하면 null */
  async #common(sellerId: string, broadcastId: string, platform: unknown, needLive: boolean): Promise<LinkOutcome | { readonly date: string } | null> {
    const broadcast = await findBroadcast(this.#deps.db, sellerId, broadcastId)
    if (broadcast === null) return notFound
    if (!isPlatform(platform)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'platform', message: "플랫폼은 'INSTAGRAM'·'YOUTUBE'·'TIKTOK' 중 하나예요." }] } } }
    if (platform === 'TIKTOK') return fail(409, 'PLATFORM_NOT_SUPPORTED')
    if (platform === 'YOUTUBE') return fail(409, 'PLATFORM_NOT_READY')
    if (!this.#deps.instagram.configured) return fail(409, 'NOT_CONFIGURED')
    if (broadcast.rehearsal) return fail(409, 'REHEARSAL')
    if (broadcast.endedAt !== null) return fail(409, 'ENDED')
    const open = await latestLink(this.#deps.db, sellerId, broadcastId)
    if (open !== null && open.state !== 'UNLINKED') return fail(409, 'ALREADY_LINKED')
    // 한 회차 한 플랫폼: 유튜브 방송이 이어져 있어도 막는다 (PLT-01, N2 합치기 — acceptance "합칠 때 맞출 것" 2)
    if ((await youtubeLink(this.#deps.db, sellerId, broadcastId)) !== null) return fail(409, 'ALREADY_LINKED')
    // 그 회차의 설정 스냅샷 (broadcast.start) — 실제 시각순이면 이을 수 없다 (D-N2-05)
    const state = (await this.#deps.writer.read(sellerId, broadcast.date, false)).state
    if (getBroadcast(state, broadcastId)?.settings['contention.policy'] === 'RECEIVED_TIME') return fail(409, 'RECEIVED_TIME_NOT_ALLOWED')
    const connection = await this.#deps.instagram.connection(sellerId)
    if (connection === null) return fail(409, 'NOT_CONNECTED')
    if (needLive && connection.status !== 'CONNECTED') return fail(409, 'RECONNECT_NEEDED')
    return { date: broadcast.date }
  }

  /** 인스타그램 기다리기 (AC-N2-22) */
  async wait(sellerId: string, accountId: string, requestId: string, broadcastId: string, platform: unknown): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    return this.#deps.locks.run(sellerId, async () => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const checked = await this.#common(sellerId, broadcastId, platform, false)
      if (checked !== null && 'status' in checked) return checked
      return this.#insert(sellerId, accountId, requestId, broadcastId, null)
    })
  }

  /** 진행 중 라이브 잇기 (AC-N2-21) */
  async link(sellerId: string, accountId: string, requestId: string, broadcastId: string, platform: unknown, liveId: unknown): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    if (typeof liveId !== 'string' || !LIVE_ID_RE.test(liveId)) {
      const broadcast = await findBroadcast(this.#deps.db, sellerId, broadcastId)
      if (broadcast === null) return notFound
      return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'liveId', message: '이을 라이브를 목록에서 골라 주세요.' }] } } }
    }
    // 메타 호출은 판매자 줄 밖에서 (그동안 웹훅 댓글 기록이 멈추지 않게) — 조건은 줄 안에서 다시 본다
    const first = await this.#common(sellerId, broadcastId, platform, true)
    if (first !== null && 'status' in first) return first
    const lives = await this.#deps.instagram.liveNow(sellerId)
    if (!lives.ok) return fail(lives.failure === 'UNAVAILABLE' ? 503 : 409, lives.failure)
    if (!lives.lives.some((live) => live.id === liveId)) return fail(409, 'NOT_LIVE')
    return this.#deps.locks.run(sellerId, async () => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const checked = await this.#common(sellerId, broadcastId, platform, true)
      if (checked !== null && 'status' in checked) return checked
      return this.#insert(sellerId, accountId, requestId, broadcastId, liveId)
    })
  }

  async #insert(sellerId: string, accountId: string, requestId: string, broadcastId: string, liveId: string | null): Promise<LinkOutcome> {
    const now = this.#now()
    const outcome = await this.#deps.db.transaction(async (tx): Promise<LinkOutcome> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
      const open = await latestLink(tx, sellerId, broadcastId)
      if (open !== null && open.state !== 'UNLINKED') return fail(409, 'ALREADY_LINKED')
      if ((await youtubeLink(tx, sellerId, broadcastId)) !== null) return fail(409, 'ALREADY_LINKED')
      if (liveId !== null && (await linkedToLive(tx, sellerId, liveId)).length > 0) return fail(409, 'LIVE_TAKEN')
      const connection = await this.#deps.instagram.connection(sellerId, tx)
      if (connection === null) return fail(409, 'NOT_CONNECTED')
      await insertLink(tx, { sellerId, broadcastId, platform: 'INSTAGRAM', state: liveId === null ? 'WAITING' : 'LINKED', liveId, accountId: connection.accountId, actorAccountId: accountId, now })
      const link = await latestLink(tx, sellerId, broadcastId)
      const result: LinkOutcome = { status: 200, body: { link: await this.#viewIn(tx, sellerId, broadcastId, link) } }
      await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
      return result
    })
    if (outcome.status === 200) this.#deps.onChange(sellerId, broadcastId)
    return outcome
  }

  /** 연결 조회 (트랜잭션 안이면 tx — 수집 상태·마지막 옮기기를 같은 트랜잭션으로 읽는다) */
  async #viewIn(tx: Db, sellerId: string, broadcastId: string, link: LinkRow | null): Promise<LinkView> {
    if (link === null || (link.state !== 'WAITING' && link.state !== 'LINKED')) {
      return { broadcast: broadcastId, platform: null, state: 'NONE', liveId: null, linkedAt: null, actor: null, accountId: null, collection: null, moved: null }
    }
    const move = await lastMove(tx, sellerId, link.id)
    return {
      broadcast: broadcastId,
      platform: isPlatform(link.platform) ? link.platform : null,
      state: link.state === 'LINKED' ? 'LINKED' : 'WAITING',
      liveId: link.state === 'LINKED' ? link.liveId : null,
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: link.actor === 'server' ? 'server' : 'account', loginId: link.actor === 'server' ? null : link.actorLoginId },
      accountId: link.accountId,
      collection: await this.collection(sellerId, link, tx),
      moved: move === null ? null : { fromLiveId: move.fromLiveId, movedAt: move.movedAt.toISOString(), comments: move.comments, message: liveMovedMessage(move.comments) },
    }
  }

  /** 연결 끊기 (AC-N2-23): WAITING·LINKED 모두. 그 회차의 기다리던 DM 행은 FAILED(NO_LINK) */
  async unlink(sellerId: string, accountId: string, requestId: string, broadcastId: string): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    return this.#deps.locks.run(sellerId, async () => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const broadcast = await findBroadcast(this.#deps.db, sellerId, broadcastId)
      if (broadcast === null) return notFound
      const now = this.#now()
      let after: (() => void) | null = null
      const outcome = await this.#deps.db.transaction(async (tx): Promise<LinkOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
        const open = await latestLink(tx, sellerId, broadcastId)
        if (open === null || open.state === 'UNLINKED') return fail(409, 'NOT_LINKED')
        await unlinkLink(tx, sellerId, open.id, accountId, now)
        after = await this.#deps.onUnlink(tx, sellerId, broadcastId, now)
        const result: LinkOutcome = { status: 200, body: { link: await this.#viewIn(tx, sellerId, broadcastId, null) } }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
        return result
      })
      if (outcome.status === 200) {
        this.#deps.onChange(sellerId, broadcastId)
        ;(after as (() => void) | null)?.()
      }
      return outcome
    })
  }

  /**
   * 웹훅 댓글의 회차 (AC-N2-22·24·25). 판매자 줄 안에서 부른다.
   * 1. 그 라이브에 이어진 끝나지 않은 회차 → 그 회차
   * 2. 없으면 기다리는 끝나지 않은 실제 회차가 정확히 하나면 그 회차를 그 라이브에 잇는다(조치자 서버, 이은 시각 = 지금, 그때의 인스타 계정 ID). 둘 이상이면 many(잇지 않는다)
   * 3. 기다리는 회차도 없으면 옮길 수 있는지 본다(AC-N2-25) → move (아직 옮기지 않았다 — 그 댓글을 기록하는 트랜잭션에서 applyMove)
   * 4. 아니면 none. 옮기기가 (바)·(사)·(아)로만 막혔으면 blocked에 그 회차와 이유(D-N2-17·18 — 웹훅이 LIVE_NOT_MOVED로 알린다)
   * fresh: 그 댓글이 늦게 받은 댓글이 아니다(entry.time이 있고 받은 시각보다 60초 넘게 이르지 않다) — 아니면 옮기지 않는다(D-N2-04 — 자동 동작을 막는 쪽으로만)
   */
  async resolveTarget(sellerId: string, igAccountId: string, liveId: string, fresh: boolean): Promise<LiveTarget> {
    const now = this.#now()
    const target = await this.#deps.db.transaction(async (tx): Promise<LiveTarget> => {
      const linked = await linkedToLive(tx, sellerId, liveId)
      if (linked[0] !== undefined) return { kind: 'linked', linkId: linked[0].id, broadcastId: linked[0].broadcastId, auto: false }
      await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
      const linkedAgain = await linkedToLive(tx, sellerId, liveId)
      if (linkedAgain[0] !== undefined) return { kind: 'linked', linkId: linkedAgain[0].id, broadcastId: linkedAgain[0].broadcastId, auto: false }
      const waiting = await waitingLinks(tx, sellerId)
      if (waiting.length > 1) return { kind: 'many' }
      const only = waiting[0]
      if (only === undefined) {
        // 이 댓글은 아직 기록하지 않았다(이미 기록한 댓글은 웹훅이 먼저 거른다) — 마지막 활동에 들어가지 않는다
        const movable = await this.#movable(tx, sellerId, igAccountId, liveId, fresh, now, null)
        if (movable === null) return { kind: 'none', blocked: null }
        return movable.kind === 'move' ? movable : { kind: 'none', blocked: { broadcastId: movable.broadcastId, reason: movable.reason } }
      }
      if (!(await autoLink(tx, sellerId, only.id, liveId, igAccountId, now))) return { kind: 'none', blocked: null }
      return { kind: 'linked', linkId: only.id, broadcastId: only.broadcastId, auto: true }
    })
    if (target.kind === 'linked' && target.auto) this.#deps.onChange(sellerId, target.broadcastId)
    return target
  }

  /**
   * 옮길 연결 (AC-N2-25, D-N2-16·17·18): 늦지 않은 댓글이고, 그 라이브는 이 판매자의 어느 회차에도 이어진 적이 없으며,
   * 서버가 저절로 이었거나 옮긴, 같은 계정의 다른 라이브에 이어진 끝나지 않은 실제 회차가 정확히 하나일 때 그 회차를 옮긴다(move).
   * 그 밖의 조건이 아니면 null. 그 조건은 모두 맞는데 아래로 막히면 blocked와 이유 — 여럿이면 이 순서로 처음 걸린 하나(GAP → OTHER_BROADCAST → TOO_SOON):
   * - (사) GAP: 받은 시각(now) − 마지막 활동 시각 > 60분. 마지막 활동 시각 = 그 회차에 기록한 인스타그램 댓글 중 마지막 것을 받은 시각(어느 라이브의 댓글이든,
   *   exceptCommentId — 지금 옮기며 기록하려는 그 댓글 — 은 뺀다)과 그 연결의 이은 시각(옮겼으면 마지막으로 옮긴 시각) 중 늦은 것.
   *   서버 시계만 본다 — entry.time·방송 날짜·달력 날짜는 보지 않는다(자정을 넘긴 방송도 그 방송의 날짜 하나, R-12·D-022, TD-N2-004).
   *   (바)·(사)를 둘 다 만족하지 않아도 GAP다(다른 회차를 끝내도 저절로 옮겨지지 않으므로)
   * - (바) OTHER_BROADCAST: 그 판매자에게 그 회차 말고 끝나지 않은 실제 회차가 하나라도 있다(리허설만 빼고 연결 없는 회차·손으로 이은 회차·다른 플랫폼 회차·
   *   날짜가 다른 회차 모두) — 새 라이브가 어느 회차의 라이브인지 모호하다(SA-N2-004·TD-N2-003)
   * - (아) TOO_SOON: 받은 시각(now) − 그 연결의 이은 시각(옮겼으면 마지막으로 옮긴 시각, linkedAt) ≤ 60초. 60초 정각도 막고 60,001ms부터 옮긴다.
   *   서버 시계만 본다 — entry.time은 위 늦은 댓글 판단(fresh)에만 쓴다. 이은·옮긴 시각보다 먼저 쓴 옛 라이브 댓글이 늦은 댓글이 아니려면
   *   이은·옮긴 뒤 60초 안에 와야 하므로 여기서 막힌다(TD-N2-005 — 빠르게 두 번 다시 켤 때 끝난 라이브로 되돌아가지 않게). 기다리면 풀린다.
   *   (사)와 함께 걸리지 않는다(이은 지 60초 안이면 마지막 활동도 60초 안). 기록 트랜잭션 안의 다시 확인(applyMove)도 같은 판단을 거친다
   */
  async #movable(
    tx: Db,
    sellerId: string,
    igAccountId: string,
    liveId: string,
    fresh: boolean,
    now: Date,
    exceptCommentId: string | null,
  ): Promise<LiveMove | ({ readonly kind: 'blocked' } & MoveBlocked) | null> {
    if (!fresh) return null
    if (await liveEverLinked(tx, sellerId, liveId)) return null
    const candidates = await movableLinks(tx, sellerId, igAccountId, liveId)
    const only = candidates[0]
    if (candidates.length !== 1 || only === undefined || only.liveId === null) return null
    const lastChatAt = (await liveChatStats(tx, sellerId, only.scopeId, only.broadcastId, exceptCommentId ?? undefined)).lastAt
    const lastActive = Math.max(only.linkedAt.getTime(), lastChatAt === null ? Number.NEGATIVE_INFINITY : lastChatAt.getTime())
    if (now.getTime() - lastActive > MOVE_GAP_MS) return { kind: 'blocked', broadcastId: only.broadcastId, reason: 'GAP' }
    if (await otherOpenBroadcast(tx, sellerId, only.broadcastId)) return { kind: 'blocked', broadcastId: only.broadcastId, reason: 'OTHER_BROADCAST' }
    if (now.getTime() - only.linkedAt.getTime() <= MOVE_SETTLE_MS) return { kind: 'blocked', broadcastId: only.broadcastId, reason: 'TOO_SOON' }
    return { kind: 'move', linkId: only.id, broadcastId: only.broadcastId, fromLiveId: only.liveId, toLiveId: liveId, accountId: igAccountId }
  }

  /**
   * 연결을 새 라이브로 옮긴다 (AC-N2-25) — 그 댓글의 chat을 넣은 기록 트랜잭션 안에서 부른다(같이 커밋되거나 같이 취소된다).
   * 판매자 줄 밖의 다른 서버 인스턴스가 그사이 바꿨을 수 있어 잠금 안에서 조건을 다시 본다((바)·(사)·(아) 모두 — 그사이 다른 인스턴스가 옮겼으면 (아)·연결 비교로 막힌다).
   * 이미 넣은 그 댓글(commentId)은 마지막 활동에서 뺀다(넣으면 간격이 늘 0이다).
   * 옮겼으면 옮기기 전까지 그 방송에 기록한 인스타그램 댓글 수, 못 옮기면 null (웹훅은 회차를 다시 정한다 — 막혔으면 그때 이유가 나온다)
   */
  async applyMove(tx: Db, sellerId: string, move: LiveMove, scopeId: string, commentId: string, now: Date): Promise<number | null> {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
    if ((await waitingLinks(tx, sellerId)).length > 0) return null
    const again = await this.#movable(tx, sellerId, move.accountId, move.toLiveId, true, now, commentId)
    if (again === null || again.kind !== 'move' || again.linkId !== move.linkId || again.fromLiveId !== move.fromLiveId || again.broadcastId !== move.broadcastId) return null
    const before = (await liveChatStats(tx, sellerId, scopeId, move.broadcastId, commentId)).count
    const moved = await moveLink(tx, { sellerId, linkId: move.linkId, broadcastId: move.broadcastId, fromLiveId: move.fromLiveId, toLiveId: move.toLiveId, accountId: move.accountId, commentsBefore: before, now })
    return moved ? before : null
  }

  /** 옮긴 연결이 커밋됐다 — 연결 알림 (SSE) */
  moved(sellerId: string, broadcastId: string): void {
    this.#deps.onChange(sellerId, broadcastId)
  }
}
