// 회차의 라이브 연결 — 플랫폼 공통 (PLT-03, D-N2-05·D-N2-08·D-N2-12, AC-N2-03·04·20~24·37).
// - 회차마다 끊지 않은 연결(WAITING 기다리는 중·LINKED 이어짐)은 하나뿐이다(DB 부분 유일 인덱스 + 판매자마다 한 줄 처리).
// - 받지 않는 경우(아무것도 바꾸지 않는다): 다른 판매자·없는 회차 404, 리허설 REHEARSAL, 끝난 회차 ENDED, 이미 연결 ALREADY_LINKED,
//   틱톡 PLATFORM_NOT_SUPPORTED(어떤 외부 주소도 부르지 않는다), 인스타그램 설정 없음 NOT_CONFIGURED,
//   실제 시각순 스냅샷 회차 RECEIVED_TIME_NOT_ALLOWED, 연결 없음 NOT_CONNECTED, 진행 중 내 라이브가 아님 NOT_LIVE, 다른 회차에 이어진 라이브 LIVE_TAKEN.
// - 잇기·기다리기·끊기는 엔진 이벤트가 아니다 — 누가·언제는 live_links에 남는다(DAT-05). 같은 요청 번호는 한 번만 한다(처음 응답).
// - 웹훅 댓글의 회차 정하기(resolveTarget): 그 라이브에 이어진 끝나지 않은 회차, 없으면 기다리는 끝나지 않은 회차가 정확히 하나일 때 저절로 잇는다(조치자 서버).
import { getBroadcast } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { isPlatform, PLATFORM_MESSAGES, type LiveSource, type Platform } from './platform.ts'
import type { SellerLocks } from './seller-locks.ts'
import { findBroadcast } from './store.ts'
import type { Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'
import {
  autoLink,
  findRequest,
  insertLink,
  insertRequest,
  latestLink,
  linkedToLive,
  liveChatStats,
  openLinks,
  unlinkLink,
  waitingLinks,
  type LinkRow,
} from './instagram/store.ts'

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

/** 웹훅 댓글의 회차 */
export type LiveTarget = { readonly kind: 'linked'; readonly linkId: number; readonly broadcastId: string; readonly auto: boolean } | { readonly kind: 'many' } | { readonly kind: 'none' }

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
    if (link === null || (link.state !== 'WAITING' && link.state !== 'LINKED')) {
      return { broadcast: broadcastId, platform: null, state: 'NONE', liveId: null, linkedAt: null, actor: null, accountId: null, collection: null }
    }
    return {
      broadcast: broadcastId,
      platform: isPlatform(link.platform) ? link.platform : null,
      state: link.state === 'LINKED' ? 'LINKED' : 'WAITING',
      liveId: link.state === 'LINKED' ? link.liveId : null,
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: link.actor === 'server' ? 'server' : 'account', loginId: link.actor === 'server' ? null : link.actorLoginId },
      accountId: link.accountId,
      collection: await this.collection(sellerId, link),
    }
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

  /** 트랜잭션 안에서 만드는 조회 (수집 상태는 같은 트랜잭션으로 읽는다) */
  async #viewIn(tx: Db, sellerId: string, broadcastId: string, link: LinkRow | null): Promise<LinkView> {
    if (link === null || (link.state !== 'WAITING' && link.state !== 'LINKED')) return this.#view(sellerId, broadcastId, null)
    return {
      broadcast: broadcastId,
      platform: isPlatform(link.platform) ? link.platform : null,
      state: link.state === 'LINKED' ? 'LINKED' : 'WAITING',
      liveId: link.state === 'LINKED' ? link.liveId : null,
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: link.actor === 'server' ? 'server' : 'account', loginId: link.actor === 'server' ? null : link.actorLoginId },
      accountId: link.accountId,
      collection: await this.collection(sellerId, link, tx),
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
   * 웹훅 댓글의 회차 (AC-N2-22·24). 판매자 줄 안에서 부른다.
   * 1. 그 라이브에 이어진 끝나지 않은 회차 → 그 회차
   * 2. 없으면 기다리는 끝나지 않은 실제 회차가 정확히 하나면 그 회차를 그 라이브에 잇는다(조치자 서버, 이은 시각 = 지금, 그때의 인스타 계정 ID)
   * 3. 둘 이상이면 many(잇지 않는다), 없으면 none
   */
  async resolveTarget(sellerId: string, igAccountId: string, liveId: string): Promise<LiveTarget> {
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
      if (only === undefined) return { kind: 'none' }
      if (!(await autoLink(tx, sellerId, only.id, liveId, igAccountId, now))) return { kind: 'none' }
      return { kind: 'linked', linkId: only.id, broadcastId: only.broadcastId, auto: true }
    })
    if (target.kind === 'linked' && target.auto) this.#deps.onChange(sellerId, target.broadcastId)
    return target
  }
}
