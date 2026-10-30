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
import { CollectorManager, UPCOMING_CHECK_MS, collectorView, noticeView, type CollectorHooks, type CollectorView, type NoticeView } from './collector.ts'
import { YoutubeAccessError, YoutubeConnections, googleFields, type ConnectionView, type SessionInfo } from './connect.ts'
import { DEFAULT_COSTS, GOOGLE_ENDPOINTS, GoogleClient, GoogleError, type ApiMethod, type GoogleEndpoints } from './google.ts'
import { OutboxRunner, type OutboxExtension, type OutboxHooks, type OutboxTiming } from './outbox.ts'
import { findRow, isOurPost } from './outbox-store.ts'
import { alreadyLinkedMessage } from '../platform.ts'
import { sellerLinkLockKey } from '../seller-locks.ts'
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
  isInvitedLink,
  linkedChannels,
  type LinkRow,
} from './store.ts'
import { parseVideoId } from './texts.ts'
import type { Timer } from './timer.ts'
import { webCollectorCounts } from '../ops-store.ts'
import { HttpWebTransport, WebChatError, WebChatSource, type WebTransport } from './web-chat-source.ts'
import type { WatchPage } from './web-chat.ts'

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
  /**
   * 서버가 유튜브 채팅 읽기 (YT-11, D-YT-SRV-01). 있으면 잇기·수집은 이 길로만 — 구글 연결 없이 방송 주소만, 공식 Data API로 읽지 않는다
   * (옛 공식 방식 수집기도 이 길로 바꾼다). 이때 구글 클라이언트 ID·비밀은 비워도 된다(감사 게시용 구글 연결만 503).
   * 없으면 옛 공식 API 읽기 — 가짜 구글로 도는 기존 시험 하네스(서버·적대·E2E)를 가짜 유튜브 웹 서버로 옮기기 전까지만 남긴다
   */
  readonly webChat?: {
    /** 운영자 스위치 (LIVEJJIM_YT_WEB_CHAT — off일 때만 false) */
    readonly on: boolean
    /** 스위치 값을 알아볼 수 없었다 (켬으로 봄, 서버가 경고 로그) */
    readonly warning?: 'YT_WEB_CHAT_INVALID' | null
    /** 유튜브 웹 주소 (기본 https://www.youtube.com — 시험은 가짜 유튜브 웹 서버) */
    readonly baseUrl?: string
    /** 유튜브에 묻는 부분을 갈아 끼운다 (맥 미니 일꾼 — AC7). 없으면 이 서버에서 바로 */
    readonly transport?: WebTransport
  }
}

/** 설정 확인: 운영은 모든 바깥 주소가 https (AC-Y1-72). 문제가 있으면 문장, 없으면 null (값은 문장에 넣지 않는다) */
export function checkYoutubeConfig(config: YoutubeConfig): string | null {
  if (config.webChat?.baseUrl !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(config.webChat.baseUrl)
    } catch {
      return '구글·유튜브 주소 설정을 확인해 주세요.'
    }
    if (parsed.protocol !== 'https:' && !(config.allowInsecure === true && parsed.protocol === 'http:')) return '구글·유튜브 주소는 https://로만 적을 수 있어요.'
  }
  // 서버 웹 읽기만 쓰는 서버: 구글 연결 설정이 없어도 된다 (YT-11)
  if (config.webChat !== undefined && config.clientId.trim() === '' && config.clientSecret.trim() === '') return null
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
  ALREADY_LINKED: alreadyLinkedMessage('YOUTUBE'),
  // 내 채널이 아닌 방송 — 잇지 않고 확인을 받는다 (D-PHN-17·D-INV1-04). 화면은 채널 이름을 넣은 확인 줄을 띄운다
  INVITED_CONFIRM_NEEDED: '내 채널 방송이 아니에요. 초대받은 방송이 맞나요?',
  NO_LIVE_CHAT: '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.',
  // YT-11 서버 잇기 (D-YT-SRV-03·07)
  YOUTUBE_NOT_PUBLIC: '로그인 없이 볼 수 있는 방송만 이을 수 있어요. 공개나 일부공개로 바꿔 주세요.',
  YOUTUBE_WEB_CHAT_OFF: '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.',
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
  /** 방송 채널 (서버 웹 읽기의 최근 채널 찾기 — "{채널 이름} · {방송 제목}", 바깥 글) */
  readonly channelId?: string
  readonly channelTitle?: string | null
}

/** 처음 잇는 채널 확인 줄 (YT-11 서버 잇기, D-YT-SRV-03 — 코드·확인 방식은 INV1 그대로) */
export const FIRST_CHANNEL_CONFIRM_MESSAGE = '처음 잇는 채널이에요. 이 방송이 맞나요?'

export interface LinkView {
  readonly link: {
    readonly videoId: string
    /** 글 올리는 계정 (이을 때 연결돼 있던 내 채널). 구글 연결 없이 이으면 null — 처음 공식으로 올릴 때 적는다 (D-YT-SRV-16) */
    readonly channelId: string | null
    /** 방송 채널 (영상의 채널, 옛 기록은 channelId와 같음 — D-INV1-01) */
    readonly broadcastChannelId: string
    /** 방송 채널 이름 (바깥 글 — 화면은 글자로만, 모르면 null) */
    readonly broadcastChannelTitle: string | null
    /** 초대 방송 = 방송 채널 ≠ 글 올리는 계정 (콘솔 "초대받은 방송 · {이름}") */
    readonly invited: boolean
    readonly linkedAt: string
    readonly chatEnded: boolean
  } | null
  readonly collector: CollectorView | null
}

/** 내 채널이 아닌 방송의 채널 (확인 줄에 쓴다, D-PHN-17). title은 바깥 글 — 비면 '' */
export interface InvitedChannel {
  readonly id: string
  readonly title: string
}

export type LinkOutcome =
  | { kind: 'ok'; view: LinkView }
  | { kind: 'not_found' }
  | { kind: 'rejected'; status: number; code: LinkCode }
  /** 내 채널 방송이 아님(서버 웹 읽기는 처음 잇는 채널 — firstChannel) — 잇지 않았다. 확인 표시(true)와 함께 다시 보내면 잇는다 (D-INV1-02·D-YT-SRV-03) */
  | { kind: 'confirm'; channel: InvitedChannel; firstChannel?: boolean }

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
  /** 크롬 확장 감사 올리기 (X1) */
  readonly outboxExtension?: OutboxExtension
}

export class YoutubeSystem {
  readonly google: GoogleClient
  readonly quota: QuotaMeter
  readonly connections: YoutubeConnections
  readonly collectors: CollectorManager
  readonly outbox: OutboxRunner
  readonly config: YoutubeConfig
  /** 서버 웹 읽기 원천 (YT-11). 설정에 webChat이 없으면 null(옛 공식 읽기) */
  readonly web: WebChatSource | null
  readonly #options: YoutubeSystemOptions

  constructor(options: YoutubeSystemOptions) {
    this.#options = options
    this.config = options.config
    const { db, timer, log, config, publish } = options
    const webChat = config.webChat
    this.web =
      webChat === undefined
        ? null
        : new WebChatSource({
            timer,
            off: !webChat.on,
            transport: webChat.transport ?? new HttpWebTransport({ timer, ...(webChat.baseUrl === undefined ? {} : { baseUrl: webChat.baseUrl }), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
          })
    if (webChat?.warning === 'YT_WEB_CHAT_INVALID') log({ level: 'warn', code: 'YT_WEB_CHAT_INVALID' })
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
      ...(options.outboxExtension === undefined ? {} : { extension: options.outboxExtension }),
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
      web: this.web,
      webOnly: this.web !== null,
    })
  }

  /** 구글 연결(OAuth) 설정이 있는가 — 없으면 연결·게시 동의는 503 (서버 웹 읽기만 쓰는 서버) */
  get oauthReady(): boolean {
    return this.config.clientId.trim() !== '' && this.config.clientSecret.trim() !== ''
  }

  /** 서버 웹 읽기 상태 (화면 — 잇기 칸·운영 상태). 옛 공식 읽기면 null */
  webChatView(): { readonly on: boolean } | null {
    return this.web === null ? null : { on: !this.web.off }
  }

  /** 운영 상태의 유튜브 수집 합계 (YT-11 AC5 — 판매자 정보 없음): 수집기·받는 중·막힘·모르는 모양 수, 이 서버의 분당 요청 수 */
  async webChatOps(): Promise<Record<string, unknown> | null> {
    if (this.web === null) return null
    return { operator: this.web.off ? 'off' : 'on', ...(await webCollectorCounts(this.#options.db)), requestsPerMinute: this.web.requestsPerMinute() }
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
    if (this.web !== null) return this.#recentBroadcasts(sellerId, this.web)
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
      link: {
        videoId: link.videoId,
        channelId: link.channelId,
        broadcastChannelId: link.broadcastChannelId,
        broadcastChannelTitle: link.broadcastChannelTitle,
        invited: isInvitedLink(link),
        linkedAt: link.linkedAt.toISOString(),
        chatEnded: link.chatEndedAt !== null,
      },
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
   * 잇기 (AC-Y1-12). 조건을 모두 만족할 때만 잇고 바로 수집을 시작한다. 같은 요청 번호로 두 번 보내도 한 번만 잇는다.
   * 다른 플랫폼(인스타그램·틱톡)이 이어져 있어도 막지 않는다 — 같은 플랫폼만 ALREADY_LINKED (동시 송출, D-N2b-2-01)
   * 초대 방송 (D-PHN-17·D-INV1-02): 영상의 채널이 내 채널과 다르면 confirmInvited가 true일 때만 잇고, 아니면 아무것도 넣지 않고 채널을 돌려준다.
   * 확인 상태는 서버에 남기지 않는다 — 확인 요청마다 영상을 다시 조회해 다시 판단하고, 다른 받는 조건은 확인이 있어도 그대로 본다
   */
  async link(session: SessionInfo, b: string, video: string, requestId: string, confirmInvited = false): Promise<LinkOutcome> {
    if (this.web !== null) return this.#linkWeb(session, b, video, requestId, confirmInvited, this.web)
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
      // 사장님 계정으로 보이지 않는 영상(지움·비공개) — 채팅을 받을 수 없는 방송 (옛 "내 채널의 방송만" 문장은 쓰지 않는다, D-INV1-04)
      if (error instanceof GoogleError && error.status === 404) return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
      return { kind: 'rejected', ...this.#accessFailure(sellerId, error) }
    }
    const item = ((Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]).find((candidate) => candidate.id === videoId)
    if (item === undefined) return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
    const snippet = (item.snippet ?? {}) as Record<string, unknown>
    const details = (item.liveStreamingDetails ?? {}) as Record<string, unknown>
    const content = snippet.liveBroadcastContent
    const liveChatId = details.activeLiveChatId
    // 받는 조건(진행 중·예정, 채팅 ID)은 채널과 상관없이 먼저 본다 — 확인을 받아도 건너뛰지 않는다 (AC-INV1-04)
    if ((content !== 'live' && content !== 'upcoming') || typeof liveChatId !== 'string' || liveChatId === '') return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
    const broadcastChannelId = typeof snippet.channelId === 'string' ? snippet.channelId : ''
    if (broadcastChannelId === '') return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
    const broadcastChannelTitle = typeof snippet.channelTitle === 'string' ? snippet.channelTitle : null
    // 내 채널이 아니면 확인 표시(정확히 true)가 있을 때만 잇는다 — 없으면 아무것도 넣지 않고 채널 이름을 돌려준다 (D-PHN-17)
    if (broadcastChannelId !== connection.channel.id && confirmInvited !== true) return { kind: 'confirm', channel: { id: broadcastChannelId, title: broadcastChannelTitle ?? '' } }
    // 유튜브 방송의 실제 시작 시각 — 예정이면 비워 둔다(수집기가 시작을 확인한다, AC-Y1-94)
    const actualStart = Date.parse(typeof details.actualStartTime === 'string' ? details.actualStartTime : '')
    const startedAt = content === 'upcoming' ? null : new Date(Number.isFinite(actualStart) ? actualStart : timer.now())
    const scope = await scopeRow(db, sellerId, row.date, false)
    if (scope === null) return { kind: 'not_found' }
    const id = `yl_${randomBytes(12).toString('base64url')}`
    let refused: LinkCode | null
    try {
      // 판매자 단위 잠금(모든 플랫폼 공통, D-N2b-2-01) 안에서 확인과 넣기를 함께 (AC-Y1-98): 같은 영상을 두 회차에 동시에 이어도 하나만. 끝난 회차에 이어 둔 영상은 막지 않는다
      refused = await db.transaction(async (tx): Promise<LinkCode | null> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        if ((await activeLink(tx, sellerId, b)) !== null) return 'ALREADY_LINKED'
        if ((await findBroadcast(tx, sellerId, b))?.endedAt != null) return 'BROADCAST_ENDED'
        const others = (await openLinksForVideo(tx, sellerId, [videoId])).filter((other) => other.broadcastId !== b)
        if (others.length > 0) return 'VIDEO_IN_USE'
        await this.#options.linkHooks?.beforeInsert?.(b)
        await insertLink(tx, { id, sellerId, scopeId: scope.id, broadcastId: b, videoId, liveChatId, channelId: connection.channel?.id ?? '', broadcastChannelId, broadcastChannelTitle, startedAt, linkedBy: session.accountId, requestId, now: new Date(timer.now()), ...(startedAt === null ? { upcomingCheckAt: new Date(timer.now() + UPCOMING_CHECK_MS) } : {}) })
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

  // ── 서버 잇기 (YT-11 AC2, D-YT-SRV-03) ────────────────────────────────

  /** 웹 읽기 실패 → 잇기·찾기 거절 (막힘·모르는 모양은 운영자 경보 재료 — 판매자 정보 없음) */
  #webFailure(sellerId: string, error: unknown): { status: number; code: LinkCode } {
    if (error instanceof WebChatError && error.kind === 'OFF') return { status: 409, code: 'YOUTUBE_WEB_CHAT_OFF' }
    if (error instanceof WebChatError && error.kind === 'BLOCKED') this.#options.log({ level: 'warn', code: 'YT_CHAT_BLOCKED' })
    if (error instanceof WebChatError && error.kind === 'UNKNOWN_SHAPE') this.#options.log({ level: 'warn', code: 'YT_CHAT_FORMAT' })
    this.#options.log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: sellerId, errorKind: error instanceof WebChatError ? `YoutubeWeb_${error.kind}` : errorKind(error) })
    return { status: 502, code: 'YOUTUBE_UNAVAILABLE' }
  }

  /** 방송 페이지 상태 → 잇기 거절 (진행 중·예정이면 null) */
  #pageRefusal(sellerId: string, page: WatchPage): { status: number; code: LinkCode } | null {
    switch (page.state) {
      case 'LIVE':
      case 'UPCOMING':
        return page.channelId === null || page.channelId === '' ? this.#webFailure(sellerId, new WebChatError('UNKNOWN_SHAPE')) : null
      case 'NOT_PUBLIC':
        return { status: 409, code: 'YOUTUBE_NOT_PUBLIC' }
      case 'BLOCKED':
      case 'UNKNOWN_SHAPE':
        return this.#webFailure(sellerId, new WebChatError(page.state))
      default:
        // 끝남·라이브 아님·없음·채팅 꺼짐
        return { status: 409, code: 'NO_LIVE_CHAT' }
    }
  }

  /** 확인한 채널: 실제 회차에 이은 적 있는 방송 채널 + 구글 연결이 있으면 그 채널 (처음 잇는 채널만 확인 줄) */
  async #confirmedChannels(sellerId: string, connectionChannel: string | null): Promise<Set<string>> {
    const channels = new Set((await linkedChannels(this.#options.db, sellerId)).map((channel) => channel.id))
    if (connectionChannel !== null) channels.add(connectionChannel)
    return channels
  }

  /**
   * 서버 잇기 (YT-11 AC2): 구글 연결 없이 주소만. 서버가 로그인 없이 공개 페이지로 영상이 있고 로그인 없이 볼 수 있으며(공개·일부공개) 진행 중·예정이고,
   * 진행 중이면 전체 채팅 지점을 얻을 수 있는지 본다(예정은 시작할 때 수집기가 본다). 처음 잇는 채널이면 확인 표시(true)가 있을 때만 잇는다(상태 없음, D-INV1-02).
   * 실제 회차·끝나지 않음·리허설 안 됨·한 영상 한 회차(D-Y1-08)·같은 요청 번호 한 번은 옛 잇기와 같다. 공식 Data API를 부르지 않는다.
   * 글 올리는 계정(이은 채널)은 구글 연결이 있으면 그 채널, 없으면 방송 채널 — 감사 게시 쪽 규칙(D-YT-SRV-13 결정 대기)이 지금과 같게 돈다
   */
  async #linkWeb(session: SessionInfo, b: string, video: string, requestId: string, confirmInvited: boolean, web: WebChatSource): Promise<LinkOutcome> {
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
    if (web.off) return { kind: 'rejected', status: 409, code: 'YOUTUBE_WEB_CHAT_OFF' }
    let page: WatchPage
    try {
      page = await web.page(videoId)
      const refused = this.#pageRefusal(sellerId, page)
      if (refused !== null) return { kind: 'rejected', ...refused }
      if (page.state === 'LIVE') {
        const chat = await web.chatPage(videoId)
        if (chat.state === 'BLOCKED') return { kind: 'rejected', ...this.#webFailure(sellerId, new WebChatError('BLOCKED')) }
        // 채팅 칸이 없거나 전체 채팅 지점을 얻지 못함 — 받을 수 없는 방송
        if (chat.state !== 'OK') return { kind: 'rejected', status: 409, code: 'NO_LIVE_CHAT' }
      }
    } catch (error) {
      return { kind: 'rejected', ...this.#webFailure(sellerId, error) }
    }
    const broadcastChannelId = page.channelId as string
    const broadcastChannelTitle = page.channelTitle
    const connection = await this.connections.status(sellerId)
    const connectionChannel = connection.channel?.id ?? null
    // 처음 잇는 채널이면 확인 표시(정확히 true)가 있을 때만 — 없으면 아무것도 넣지 않고 채널 이름을 돌려준다
    if (!(await this.#confirmedChannels(sellerId, connectionChannel)).has(broadcastChannelId) && confirmInvited !== true) {
      return { kind: 'confirm', channel: { id: broadcastChannelId, title: broadcastChannelTitle ?? '' }, firstChannel: true }
    }
    const startedAt = page.state === 'UPCOMING' ? null : new Date(page.startedAt ?? timer.now())
    const scope = await scopeRow(db, sellerId, row.date, false)
    if (scope === null) return { kind: 'not_found' }
    const id = `yl_${randomBytes(12).toString('base64url')}`
    let refused: LinkCode | null
    try {
      refused = await db.transaction(async (tx): Promise<LinkCode | null> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        if ((await activeLink(tx, sellerId, b)) !== null) return 'ALREADY_LINKED'
        if ((await findBroadcast(tx, sellerId, b))?.endedAt != null) return 'BROADCAST_ENDED'
        const others = (await openLinksForVideo(tx, sellerId, [videoId])).filter((other) => other.broadcastId !== b)
        if (others.length > 0) return 'VIDEO_IN_USE'
        await this.#options.linkHooks?.beforeInsert?.(b)
        await insertLink(tx, {
          id,
          sellerId,
          scopeId: scope.id,
          broadcastId: b,
          videoId,
          // 공식 채팅 ID는 부르지 않는다(읽기 할당량 0) — 감사를 공식으로 처음 올리려 할 때 발송함이 받는다 (D-YT-SRV-15)
          liveChatId: '',
          // 글 올리는 계정: 구글 연결이 있으면 그 채널, 없으면 비움 — 방송 채널로 채우지 않는다 (D-YT-SRV-16)
          channelId: connectionChannel,
          broadcastChannelId,
          broadcastChannelTitle,
          startedAt,
          linkedBy: session.accountId,
          requestId,
          now: new Date(timer.now()),
          mode: 'WEB',
          ...(startedAt === null ? { upcomingCheckAt: new Date(timer.now() + UPCOMING_CHECK_MS) } : {}),
        })
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

  /**
   * 최근 채널 찾기 (YT-11 AC2, D-YT-SRV-03 목록 ②): 최근 이은 채널 3개의 공개 채널 라이브 주소에서 지금·예정 공개 방송을 찾는다(채널마다 한 번, 하나씩).
   * 부를 때만 찾는다(되풀이하지 않음). 막히거나 못 읽은 채널은 건너뛴다. 운영자가 끄면 거절
   */
  async #recentBroadcasts(sellerId: string, web: WebChatSource): Promise<{ kind: 'ok'; broadcasts: LiveBroadcastItem[] } | { kind: 'rejected'; status: number; code: LinkCode }> {
    if (web.off) return { kind: 'rejected', status: 409, code: 'YOUTUBE_WEB_CHAT_OFF' }
    const list: Omit<LiveBroadcastItem, 'linkedBroadcast'>[] = []
    for (const channel of await linkedChannels(this.#options.db, sellerId, 3)) {
      let page: WatchPage
      try {
        page = await web.channelLive(channel.id)
      } catch (error) {
        if (error instanceof WebChatError && error.kind === 'OFF') return { kind: 'rejected', status: 409, code: 'YOUTUBE_WEB_CHAT_OFF' }
        if (error instanceof WebChatError && error.kind === 'BLOCKED') this.#options.log({ level: 'warn', code: 'YT_CHAT_BLOCKED' })
        continue
      }
      if ((page.state !== 'LIVE' && page.state !== 'UPCOMING') || page.videoId === null || page.channelId !== channel.id) continue
      const at = page.startedAt === null ? null : new Date(page.startedAt).toISOString()
      list.push({
        videoId: page.videoId,
        title: page.title ?? '',
        status: page.state === 'LIVE' ? 'LIVE' : 'UPCOMING',
        scheduledStartTime: page.state === 'UPCOMING' ? at : null,
        actualStartTime: page.state === 'LIVE' ? at : null,
        channelId: channel.id,
        channelTitle: page.channelTitle ?? channel.title,
      })
    }
    const linked = await openLinksForVideo(this.#options.db, sellerId, list.map((item) => item.videoId))
    const byVideo = new Map(linked.map((row) => [row.videoId, row.broadcastId]))
    return { kind: 'ok', broadcasts: list.map((item) => ({ ...item, linkedBroadcast: byVideo.get(item.videoId) ?? null })) }
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
      // 범위 락 → 판매자 잠금 (모든 플랫폼 공통 — 기록 트랜잭션과 같은 순서, D-N2b-2-01)
      await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
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

