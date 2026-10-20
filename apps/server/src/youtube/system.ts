// 유튜브 연동 조립 (Y1): 구글 연결·방송 잇기·수집기·발송함·할당량. 설정이 없으면 만들지 않는다(그 서버의 유튜브 API는 503).
// - 바깥 주소는 설정에서 온다. 운영 설정은 https만 받는다(아니면 서버가 시작하지 않는다, AC-Y1-72). 시험·E2E는 가짜 서버(127.0.0.1) 주소를 쓴다.
// - 방송 잇기(AC-Y1-10~13): 내 라이브 목록, 주소·영상 ID 읽기, 잇기 조건, 끊기. 잇기는 엔진 이벤트가 아니다 — 누가·언제 이었는지 연결 표에 남긴다(DAT-05).
//   "그 영상이 끝나지 않은 다른 회차에 이어져 있지 않다" 확인과 넣기는 판매자 단위 잠금 안에서 함께 한다 — 서버가 둘이어도 하나씩(AC-Y1-98, D-Y1-08).
//   예정(시작 전) 방송을 이으면 시작 시각을 비워 둔다 — 수집기가 시작할 때까지 채팅을 부르지 않는다(AC-Y1-94).
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { scopeLockKey } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { Service } from '../service.ts'
import { findBroadcast, scopeRow, scopeSealedAt, type BroadcastRow } from '../store.ts'
import { uniqueViolation, type CommittedRecord, type ScopeWriter } from '../writer.ts'
import { CollectorManager, collectorView, noticeView, type CollectorHooks, type CollectorView, type NoticeView } from './collector.ts'
import { YoutubeAccessError, YoutubeConnections, googleFields, type ConnectionView, type SessionInfo } from './connect.ts'
import { DEFAULT_COSTS, GOOGLE_ENDPOINTS, GoogleClient, GoogleError, type ApiMethod, type GoogleEndpoints } from './google.ts'
import { OutboxRunner, type OutboxHooks, type OutboxTiming } from './outbox.ts'
import { findRow, isOurPost } from './outbox-store.ts'
import { DEFAULT_QUOTA, QuotaMeter, type QuotaSettings } from './quota.ts'
import {
  activeLink,
  collectorOf,
  connectedSellerIds,
  insertLink,
  linkByRequest,
  openLinksForVideo,
  outboxRowRehearsal,
  recordedChats,
  scopeNotices,
  unlinkRow,
  updateCollector,
  type LinkRow,
} from './store.ts'
import { parseVideoId } from './texts.ts'
import type { Timer } from './timer.ts'

export interface YoutubeConfig {
  readonly clientId: string
  readonly clientSecret: string
  /** 설정에 고정한 돌아오는 주소 하나 (구글에 등록한 것, 예: https://api.livejjim.kr/api/youtube/oauth/callback) */
  readonly redirectUri: string
  /** 돌아온 뒤 판매자를 보낼 화면 주소 (결과는 ?youtube=코드로만) */
  readonly returnUrl: string
  readonly endpoints?: GoogleEndpoints
  readonly quota?: { readonly limit?: number; readonly sellerBudget?: number; readonly costs?: Partial<Record<ApiMethod, number>> }
  /** http:// 주소를 받는다 (시험·E2E의 가짜 서버만 — 운영 설정은 https만) */
  readonly allowInsecure?: boolean
}

/** 설정 확인: 운영은 모든 바깥 주소가 https (AC-Y1-72). 문제가 있으면 문장, 없으면 null (값은 문장에 넣지 않는다) */
export function checkYoutubeConfig(config: YoutubeConfig): string | null {
  if (config.clientId.trim() === '' || config.clientSecret.trim() === '') return '구글 클라이언트 ID·비밀을 적어 주세요.'
  const endpoints = config.endpoints ?? GOOGLE_ENDPOINTS
  const urls = [endpoints.authUrl, endpoints.tokenUrl, endpoints.revokeUrl, endpoints.apiBase, config.redirectUri, config.returnUrl]
  for (const url of urls) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return '구글·유튜브 주소 설정을 확인해 주세요.'
    }
    if (parsed.protocol !== 'https:' && !(config.allowInsecure === true && parsed.protocol === 'http:')) return '구글·유튜브 주소는 https://로만 적을 수 있어요.'
  }
  return null
}

/** 방송 잇기 결과 코드와 문장 (AC-Y1-11·12) */
export const LINK_MESSAGES = {
  INVALID_VIDEO_URL: '유튜브 방송 주소를 확인해 주세요.',
  REHEARSAL_LINK: '리허설 방송에는 유튜브 방송을 이을 수 없어요.',
  BROADCAST_ENDED: '끝난 방송에는 유튜브 방송을 이을 수 없어요.',
  ALREADY_LINKED: '이 방송에는 이미 유튜브 방송이 이어져 있어요. 먼저 연결을 끊어 주세요.',
  NOT_MY_CHANNEL: '내 채널의 방송만 연결할 수 있어요.',
  NO_LIVE_CHAT: '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.',
  VIDEO_IN_USE: '이미 다른 방송에 이어진 유튜브 방송이에요.',
  NOT_LINKED: '이어진 유튜브 방송이 없어요.',
  YOUTUBE_NOT_CONNECTED: '유튜브 채널을 먼저 연결해 주세요.',
  YOUTUBE_RECONNECT_NEEDED: '유튜브 연결을 다시 해 주세요.',
  YOUTUBE_UNAVAILABLE: '유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  SEALED: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.',
  COLLECTOR_NOT_RESTARTABLE: '다시 시작할 수 없는 수집이에요.',
} as const
export type LinkCode = keyof typeof LINK_MESSAGES

export interface LiveBroadcastItem {
  readonly videoId: string
  readonly title: string
  /** LIVE 진행 중 · UPCOMING 예정 */
  readonly status: 'LIVE' | 'UPCOMING'
  readonly scheduledStartTime: string | null
  readonly actualStartTime: string | null
  /** 이미 이어져 있는 이 판매자의 회차 ID (없으면 null) */
  readonly linkedBroadcast: string | null
}

export interface LinkView {
  readonly link: { readonly videoId: string; readonly channelId: string; readonly linkedAt: string; readonly chatEnded: boolean } | null
  readonly collector: CollectorView | null
}

export type LinkOutcome = { kind: 'ok'; view: LinkView } | { kind: 'not_found' } | { kind: 'rejected'; status: number; code: LinkCode }

export interface LinkHooks {
  /** 잇기: 조건 확인을 마친 뒤·연결을 넣기 직전 (시험: 기다리게 해 동시에 잇는 요청이 겹치게 한다, AC-Y1-98) */
  readonly beforeInsert?: (broadcastId: string) => void | Promise<void>
}

export interface YoutubeSystemOptions {
  readonly db: Db
  readonly masterKey: Buffer
  readonly timer: Timer
  readonly log: LogSink
  readonly writer: ScopeWriter
  readonly service: Service
  readonly config: YoutubeConfig
  /** 이 서버(인스턴스)의 이름 (수집기·발송함 임대 주인) */
  readonly owner?: string
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  readonly fetch?: typeof fetch
  readonly collectorHooks?: CollectorHooks
  readonly outboxHooks?: OutboxHooks
  readonly linkHooks?: LinkHooks
  /** 수집기 임대·순회 (시험에서 줄인다) */
  readonly collectorTiming?: { readonly leaseMs?: number; readonly renewMs?: number; readonly scanMs?: number }
  /** 워커 건강 (바퀴마다 성공·실패 — 운영 상태·경보, AC-I3-81·82) */
  readonly health?: { pass(worker: 'collector' | 'outbox', ok: boolean): void }
  /** 발송함 시간 (E2E 기동만 줄인다 — AC-I3-93) */
  readonly outboxTiming?: OutboxTiming
}

export class YoutubeSystem {
  readonly google: GoogleClient
  readonly quota: QuotaMeter
  readonly connections: YoutubeConnections
  readonly collectors: CollectorManager
  readonly outbox: OutboxRunner
  readonly config: YoutubeConfig
  readonly #options: YoutubeSystemOptions

  constructor(options: YoutubeSystemOptions) {
    this.#options = options
    this.config = options.config
    const { db, timer, log, config, publish } = options
    const owner = options.owner ?? `srv_${randomBytes(6).toString('base64url')}`
    const settings: QuotaSettings = {
      limit: config.quota?.limit ?? DEFAULT_QUOTA.limit,
      sellerBudget: config.quota?.sellerBudget ?? config.quota?.limit ?? DEFAULT_QUOTA.sellerBudget,
      costs: { ...DEFAULT_COSTS, ...config.quota?.costs },
    }
    this.quota = new QuotaMeter(
      db,
      settings,
      () => timer.now(),
      (sellerId, mode) => {
        publish(sellerId, { kind: 'quota', mode })
        this.outbox.notify()
      },
      () => connectedSellerIds(db),
      (sellerId) => log({ level: 'warn', code: 'QUOTA_EXCEEDED', seller: sellerId }),
    )
    const endpoints = config.endpoints ?? GOOGLE_ENDPOINTS
    this.google = new GoogleClient({
      ...endpoints,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      timer,
      meter: (sellerId, method) => this.quota.count(sellerId, method),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
    this.connections = new YoutubeConnections({
      db,
      masterKey: options.masterKey,
      google: this.google,
      timer,
      log,
      onStatus: (sellerId, view) => {
        publish(sellerId, { kind: 'connection', connection: view })
        // 끊김·다시 연결 필요면 그 판매자의 도는 수집기가 바로 멈춘다(열린 스트림도), 다시 연결되면 찾아 이어받는다
        this.collectors.refreshSeller(sellerId)
        this.outbox.notify()
      },
      onConsentOff: (sellerId, targets) => this.outbox.consentOff(sellerId, targets, targets.length > 1),
    })
    this.outbox = new OutboxRunner({
      db,
      timer,
      log,
      google: this.google,
      connections: this.connections,
      quota: this.quota,
      writer: options.writer,
      owner,
      publish,
      // 채팅을 받는 중(LIVE)일 때만 — 시작하는 중·다시 연결하는 중이면 우리 글을 받지 못했을 수 있어 최근 채팅을 본다
      collectorRunning: async (sellerId, linkId) => {
        const row = await collectorOf(db, sellerId, linkId)
        return row !== null && row.leaseUntil !== null && row.leaseUntil.getTime() > timer.now() && row.status === 'LIVE'
      },
      ...(options.outboxHooks === undefined ? {} : { hooks: options.outboxHooks }),
      ...(options.outboxTiming === undefined ? {} : { timing: options.outboxTiming }),
      onPass: (ok) => options.health?.pass('outbox', ok),
    })
    this.collectors = new CollectorManager({
      db,
      timer,
      log,
      google: this.google,
      connections: this.connections,
      quota: this.quota,
      service: options.service,
      writer: options.writer,
      owner,
      publish,
      ourPost: (sellerId, broadcastId, messageId, text) => isOurPost(db, sellerId, broadcastId, messageId, text, new Date(timer.now() - 10 * 60 * 1000)),
      onChatEnded: (sellerId, link) => this.outbox.chatEnded(sellerId, link.broadcastId),
      ...(options.collectorHooks === undefined ? {} : { hooks: options.collectorHooks }),
      ...options.collectorTiming,
      onPass: (ok) => options.health?.pass('collector', ok),
    })
  }

  /** 워커를 돌린다 (서버 시작 — 끝나지 않은 회차의 수집기가 저절로 다시 돈다, NFR-03) */
  start(): void {
    this.collectors.start()
    this.outbox.start()
  }

  async stop(): Promise<void> {
    await Promise.all([this.collectors.stop(), this.outbox.stop()])
  }

  /** 커밋된 기록 (새 효과 → 발송함, 방송 끝냄 → 수집기 다시 계산) */
  onCommit(sellerId: string, rehearsal: boolean, records: readonly CommittedRecord[]): void {
    if (rehearsal) return
    if (records.some((record) => record.effects.length > 0)) this.outbox.notify()
    for (const record of records) {
      if (record.type === 'broadcast.end') {
        const b = (record.event as unknown as { b?: unknown }).b
        if (typeof b === 'string') this.collectors.refresh(sellerId, b)
      }
    }
  }

  // ── 내 라이브 목록 (AC-Y1-10) ─────────────────────────────────────────

  async liveBroadcasts(sellerId: string): Promise<{ kind: 'ok'; broadcasts: LiveBroadcastItem[] } | { kind: 'rejected'; status: number; code: LinkCode }> {
    const view = await this.connections.status(sellerId)
    if (view.status === 'NOT_CONNECTED') return { kind: 'rejected', status: 409, code: 'YOUTUBE_NOT_CONNECTED' }
    if (view.status === 'RECONNECT_NEEDED') return { kind: 'rejected', status: 409, code: 'YOUTUBE_RECONNECT_NEEDED' }
    let body: Record<string, unknown>
    try {
      body = await this.connections.withToken(sellerId, (token) =>
        this.google.api({ sellerId, method: 'liveBroadcasts.list', accessToken: token, path: '/liveBroadcasts', query: { part: 'snippet,status', mine: 'true', maxResults: '50' } }),
      )
    } catch (error) {
      return { kind: 'rejected', ...this.#accessFailure(sellerId, error) }
    }
    const items = (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]
    const list: Omit<LiveBroadcastItem, 'linkedBroadcast'>[] = []
    for (const item of items) {
      const snippet = (item.snippet ?? {}) as Record<string, unknown>
      const status = String(((item.status ?? {}) as Record<string, unknown>).lifeCycleStatus ?? '')
      if (typeof item.id !== 'string') continue
      if (view.channel !== null && typeof snippet.channelId === 'string' && snippet.channelId !== view.channel.id) continue
      const live = status === 'live' || status === 'liveStarting'
      const upcoming = status === 'created' || status === 'ready' || status === 'testing' || status === 'testStarting'
      if (!live && !upcoming) continue
      list.push({
        videoId: item.id,
        title: typeof snippet.title === 'string' ? snippet.title : '',
        status: live ? 'LIVE' : 'UPCOMING',
        scheduledStartTime: typeof snippet.scheduledStartTime === 'string' ? snippet.scheduledStartTime : null,
        actualStartTime: typeof snippet.actualStartTime === 'string' ? snippet.actualStartTime : null,
      })
    }
    const linked = await openLinksForVideo(this.#options.db, sellerId, list.map((item) => item.videoId))
    const byVideo = new Map(linked.map((row) => [row.videoId, row.broadcastId]))
    return { kind: 'ok', broadcasts: list.map((item) => ({ ...item, linkedBroadcast: byVideo.get(item.videoId) ?? null })) }
  }

  #accessFailure(sellerId: string, error: unknown): { status: number; code: LinkCode } {
    if (error instanceof YoutubeAccessError) return { status: 409, code: error.status === 'NOT_CONNECTED' ? 'YOUTUBE_NOT_CONNECTED' : 'YOUTUBE_RECONNECT_NEEDED' }
    this.#options.log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: sellerId, ...googleFields(error) })
    return { status: 502, code: 'YOUTUBE_UNAVAILABLE' }
  }

  // ── 잇기·끊기 (AC-Y1-12·13) ───────────────────────────────────────────

  async #linkView(sellerId: string, link: LinkRow | null): Promise<LinkView> {
    if (link === null) return { link: null, collector: null }
    const collector = await collectorOf(this.#options.db, sellerId, link.id)
    return {
      link: { videoId: link.videoId, channelId: link.channelId, linkedAt: link.linkedAt.toISOString(), chatEnded: link.chatEndedAt !== null },
      collector: collector === null ? null : collectorView(collector, await recordedChats(this.#options.db, sellerId, link.broadcastId)),
    }
  }

  async linkView(sellerId: string, b: string): Promise<LinkView | null> {
    const row = await findBroadcast(this.#options.db, sellerId, b)
    if (row === null) return null
    return this.#linkView(sellerId, await activeLink(this.#options.db, sellerId, b))
  }

  async #sealed(sellerId: string, row: BroadcastRow): Promise<boolean> {
    return (await scopeRow(this.#options.db, sellerId, row.date, row.rehearsal))?.sealedAt != null
  }

  /**
   * 잇기 (AC-Y1-12). 조건을 모두 만족할 때만 잇고 바로 수집을 시작한다. 같은 요청 번호로 두 번 보내도 한 번만 잇는다
   */
  async link(session: SessionInfo, b: string, video: string, requestId: string): Promise<LinkOutcome> {
    const { db, timer } = this.#options
    const sellerId = session.sellerId
    const prior = await linkByRequest(db, sellerId, requestId)
    if (prior !== null) return prior.broadcastId === b ? { kind: 'ok', view: await this.#linkView(sellerId, prior) } : { kind: 'rejected', status: 409, code: 'ALREADY_LINKED' }
    const row = await findBroadcast(db, sellerId, b)
    if (row === null) return { kind: 'not_found' }
    const videoId = parseVideoId(video)
    if (videoId === null) return { kind: 'rejected', status: 400, code: 'INVALID_VIDEO_URL' }
    if (row.rehearsal) return { kind: 'rejected', status: 409, code: 'REHEARSAL_LINK' }
    if (await this.#sealed(sellerId, row)) return { kind: 'rejected', status: 409, code: 'SEALED' }
    if (row.endedAt !== null) return { kind: 'rejected', status: 409, code: 'BROADCAST_ENDED' }
    if ((await activeLink(db, sellerId, b)) !== null) return { kind: 'rejected', status: 409, code: 'ALREADY_LINKED' }
    const connection = await this.connections.status(sellerId)
    if (connection.status === 'NOT_CONNECTED' || connection.channel === null) return { kind: 'rejected', status: 409, code: 'YOUTUBE_NOT_CONNECTED' }
    if (connection.status === 'RECONNECT_NEEDED') return { kind: 'rejected', status: 409, code: 'YOUTUBE_RECONNECT_NEEDED' }
    let body: Record<string, unknown>
    try {
      body = await this.connections.withToken(sellerId, (token) =>
        this.google.api({ sellerId, method: 'videos.list', accessToken: token, path: '/videos', query: { part: 'snippet,liveStreamingDetails', id: videoId } }),
      )
    } catch (error) {
      if (error instanceof GoogleError && error.status === 404) return { kind: 'rejected', status: 409, code: 'NOT_MY_CHANNEL' }
      return { kind: 'rejected', ...this.#accessFailure(sellerId, error) }
    }
    const item = ((Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]).find((candidate) => candidate.id === videoId)
    const snippet = (item?.snippet ?? {}) as Record<string, unknown>
    if (item === undefined || snippet.channelId !== connection.channel.id) return { kind: 'rejected', status: 409, code: 'NOT_MY_CHANNEL' }
    const details = (item.liveStreamingDetails ?? {}) as Record<string, unknown>
    const content = snippet.liveBroadcastContent
    const liveChatId = details.activeLiveChatId
    if ((content !== 'live' && content !== 'upcoming') || typeof liveChatId !== 'string' || liveChatId === '') return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
    // 유튜브 방송의 실제 시작 시각 — 예정이면 비워 둔다(수집기가 시작을 확인한다, AC-Y1-94)
    const actualStart = Date.parse(typeof details.actualStartTime === 'string' ? details.actualStartTime : '')
    const startedAt = content === 'upcoming' ? null : new Date(Number.isFinite(actualStart) ? actualStart : timer.now())
    const scope = await scopeRow(db, sellerId, row.date, false)
    if (scope === null) return { kind: 'not_found' }
    const id = `yl_${randomBytes(12).toString('base64url')}`
    let refused: LinkCode | null
    try {
      // 판매자 단위 잠금 안에서 확인과 넣기를 함께 (AC-Y1-98): 같은 영상을 두 회차에 동시에 이어도 하나만. 끝난 회차에 이어 둔 영상은 막지 않는다
      refused = await db.transaction(async (tx): Promise<LinkCode | null> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`livejjim/youtube-link/${sellerId}`}, 0))`)
        if ((await activeLink(tx, sellerId, b)) !== null) return 'ALREADY_LINKED'
        if ((await findBroadcast(tx, sellerId, b))?.endedAt != null) return 'BROADCAST_ENDED'
        const others = (await openLinksForVideo(tx, sellerId, [videoId])).filter((other) => other.broadcastId !== b)
        if (others.length > 0) return 'VIDEO_IN_USE'
        await this.#options.linkHooks?.beforeInsert?.(b)
        await insertLink(tx, { id, sellerId, scopeId: scope.id, broadcastId: b, videoId, liveChatId, channelId: connection.channel?.id ?? '', startedAt, linkedBy: session.accountId, requestId, now: new Date(timer.now()) })
        return null
      })
    } catch (error) {
      const constraint = uniqueViolation(error)
      if (constraint === 'youtube_links_request_uq') {
        const again = await linkByRequest(db, sellerId, requestId)
        if (again !== null) return { kind: 'ok', view: await this.#linkView(sellerId, again) }
      }
      if (constraint === 'youtube_links_active_uq') return { kind: 'rejected', status: 409, code: 'ALREADY_LINKED' }
      throw error
    }
    if (refused !== null) return { kind: 'rejected', status: 409, code: refused }
    this.collectors.wake()
    const view = await this.#linkView(sellerId, await activeLink(db, sellerId, b))
    this.#options.publish(sellerId, { kind: 'collector', broadcast: b, date: row.date, collector: view.collector })
    return { kind: 'ok', view }
  }

  /** 끊기 (AC-Y1-13): 수집기가 멈추고, 그 방송의 기다리던 실시간 채팅 감사는 보내지 못함(NO_LINK) */
  async unlink(session: SessionInfo, b: string): Promise<LinkOutcome> {
    const { db, timer } = this.#options
    const sellerId = session.sellerId
    const row = await findBroadcast(db, sellerId, b)
    if (row === null) return { kind: 'not_found' }
    if (await this.#sealed(sellerId, row)) return { kind: 'rejected', status: 409, code: 'SEALED' }
    const link = await activeLink(db, sellerId, b)
    if (link === null) return { kind: 'rejected', status: 409, code: 'NOT_LINKED' }
    const now = new Date(timer.now())
    // 범위 락을 잡고 끊는다 — 어느 서버의 수집기든 그 회차에 채팅을 기록하는 트랜잭션(같은 락, 연결이 이어져 있는지 확인)과 겹치지 않는다
    const unlinked = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, row.date, false)})`)
      return unlinkRow(tx, sellerId, link.id, session.accountId, now)
    })
    if (unlinked) {
      await updateCollector(db, sellerId, link.id, { status: 'STOPPED', reason: 'UNLINKED' }, now)
      this.collectors.refresh(sellerId, b)
      await this.outbox.unlinked(sellerId, b)
      const collector = await collectorOf(db, sellerId, link.id)
      this.#options.publish(sellerId, { kind: 'collector', broadcast: b, date: row.date, collector: collector === null ? null : collectorView(collector) })
    }
    return { kind: 'ok', view: { link: null, collector: null } }
  }

  /** 멈춘 수집기 다시 시작 (AC-Y1-24 — 끝남·할당량·끊음·봉인 제외, 같은 지점부터) */
  async restartCollector(sellerId: string, b: string): Promise<LinkOutcome> {
    const { db, timer } = this.#options
    const row = await findBroadcast(db, sellerId, b)
    if (row === null) return { kind: 'not_found' }
    const link = await activeLink(db, sellerId, b)
    if (link === null) return { kind: 'rejected', status: 409, code: 'NOT_LINKED' }
    const collector = await collectorOf(db, sellerId, link.id)
    if (collector === null || !collectorView(collector).restartable) return { kind: 'rejected', status: 409, code: 'COLLECTOR_NOT_RESTARTABLE' }
    await updateCollector(db, sellerId, link.id, { status: 'STARTING', reason: null }, new Date(timer.now()))
    this.collectors.wake()
    return { kind: 'ok', view: await this.#linkView(sellerId, link) }
  }

  /** 발송함 행이 봉인한 범위의 것인지 (재전송 409 SEALED, AC-Y1-62). 그 판매자의 행이 아니면 not_found */
  async outboxSealed(sellerId: string, rowId: number): Promise<boolean | 'not_found'> {
    const row = await findRow(this.#options.db, sellerId, rowId)
    if (row === null) return 'not_found'
    return (await scopeSealedAt(this.#options.db, sellerId, row.scopeId)) !== null
  }

  /** 발송함 행이 리허설 범위의 것인지 (게시됨 확인·알림에서 빼기의 409, AC-I3-36). 그 판매자의 행이 없으면 null */
  outboxRowRehearsal(sellerId: string, rowId: number): Promise<boolean | null> {
    return outboxRowRehearsal(this.#options.db, sellerId, rowId)
  }

  /** 그 날짜(범위)의 지운 메시지·차단 알림 */
  async notices(sellerId: string, scopeId: string): Promise<NoticeView[]> {
    return (await scopeNotices(this.#options.db, sellerId, scopeId)).map(noticeView)
  }

  /** 연결 상태 (토큰·만료 시각 없음) */
  status(sellerId: string): Promise<ConnectionView> {
    return this.connections.status(sellerId)
  }

  /** 워커 오류 기록 */
  logError(sellerId: string, error: unknown): void {
    this.#options.log({ level: 'error', code: 'WORKER_FAILED', seller: sellerId, errorKind: errorKind(error) })
  }
}

