// 인스타그램 묶음 조립 (N2, D-N2-01): 계정 연결·라이브 연결·웹훅·감사 DM·실시간 알림을 만든다.
// 서버 조립(server.ts)이 기록 경로의 같은 트랜잭션(txHook)과 /api 경로·웹훅 경로에 잇는다.
import type { Db } from '../db/database.ts'
import { LiveLinks, type InstagramPort, type LinkView } from '../live-links.ts'
import type { LogSink } from '../log.ts'
import type { LiveSource, ThanksSender } from '../platform.ts'
import { SellerLocks } from '../seller-locks.ts'
import type { Service } from '../service.ts'
import type { Clock } from '../time.ts'
import type { ScopeWriter, TxHook } from '../writer.ts'
import { instagramLiveSource, instagramThanksSender } from './adapters.ts'
import type { InstagramSettings } from './config.ts'
import { InstagramConnections } from './connection.ts'
import { InstagramDms } from './dm.ts'
import { MetaClient } from './meta.ts'
import { LiveNotices, realLiveTimer, type LiveTimer } from './notices.ts'
import { InstagramWebhook } from './webhook.ts'

export interface InstagramModuleOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly service: Service
  readonly clock: Clock
  readonly log: LogSink
  readonly masterKey: Buffer
  readonly appOrigin: string
  /** 인스타그램 설정 (없으면 null — 인스타그램 기능은 NOT_CONFIGURED, 웹훅은 503) */
  readonly settings: InstagramSettings | null
  /** 실시간 알림 (SSE event: instagram) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 알림·실행기 예약 (기본 실제 타이머) */
  readonly timer?: LiveTimer
  /** DM 실행기를 스스로 돌린다 (기본 true. 시험은 false로 두고 dms.drain()을 부른다) */
  readonly dmAutoRun?: boolean
  /** 수집 상태 알림 간격 (기본 1000밀리초) */
  readonly collectionIntervalMs?: number
  /** 판매자마다 한 줄 (라이브 연결 — 틱톡과 같은 것을 나눈다, D-N2b-2-01). 없으면 새로 만든다 */
  readonly locks?: SellerLocks
}

export interface InstagramModule {
  readonly settings: InstagramSettings | null
  readonly meta: MetaClient | null
  readonly connections: InstagramConnections
  readonly links: LiveLinks
  readonly webhook: InstagramWebhook
  readonly dms: InstagramDms
  readonly notices: LiveNotices
  /** 플랫폼 공통 어댑터 모양의 인스타그램 구현 (AC-N2-04) */
  readonly liveSource: LiveSource
  readonly thanksSender: ThanksSender
  /** 기록 경로의 같은 트랜잭션에서 부른다 (DM 행 만들기·끝낸 회차의 수집 상태 알림) */
  readonly txHook: TxHook
  /** 진행 중 라이브 (메타 live_media) */
  liveNow: LiveSource['liveNow']
  close(): void
}

export function createInstagram(options: InstagramModuleOptions): InstagramModule {
  const { db, writer, service, clock, log, settings } = options
  const timer = options.timer ?? realLiveTimer
  const meta = settings === null ? null : new MetaClient(settings)
  const locks = options.locks ?? new SellerLocks()
  // 서로 부르는 묶음이라 나중에 채운다
  let links: LiveLinks | null = null
  let dms: InstagramDms | null = null
  let notices: LiveNotices | null = null

  const publishConnection = (sellerId: string) => {
    void connections
      .view(sellerId)
      .then(async (connection) => {
        notices?.now(sellerId, { kind: 'CONNECTION', connection })
        // 연결 상태가 바뀌면 이어진 회차의 수집 상태도 바뀐다 (STOPPED ↔ LIVE)
        for (const link of await (links as LiveLinks).list(sellerId)) notices?.collection(sellerId, link.broadcast)
      })
      .catch(() => undefined)
  }

  const connections = new InstagramConnections({
    db,
    settings,
    meta,
    masterKey: options.masterKey,
    clock,
    log,
    appOrigin: options.appOrigin,
    onChange: publishConnection,
    onReconnected: () => dms?.kick(),
    onDisconnect: (tx, sellerId, now) => (dms as InstagramDms).onDisconnect(tx, sellerId, now),
    onConsentOff: (tx, sellerId, now) => (dms as InstagramDms).onConsentOff(tx, sellerId, now),
  })

  const liveSource = instagramLiveSource(connections, meta, log)
  const thanksSender = instagramThanksSender(connections, meta, log)
  const liveNow = liveSource.liveNow

  const port: InstagramPort = {
    configured: connections.configured,
    connection: async (sellerId, tx) => {
      const row = await connections.connection(sellerId, tx)
      return row === null ? null : { status: row.status, accountId: row.accountId }
    },
    liveNow,
  }

  notices = new LiveNotices({
    clock,
    timer,
    log,
    publish: options.publish,
    ...(options.collectionIntervalMs === undefined ? {} : { collectionIntervalMs: options.collectionIntervalMs }),
    collection: async (sellerId, broadcastId) => {
      const link: LinkView | null = await (links as LiveLinks).status(sellerId, broadcastId)
      if (link === null || link.collection === null) return null
      return { kind: 'COLLECTION', broadcast: broadcastId, link }
    },
  })

  links = new LiveLinks({
    db,
    writer,
    clock,
    locks,
    instagram: port,
    onChange: (sellerId, broadcastId) => {
      void (links as LiveLinks)
        .status(sellerId, broadcastId)
        .then((link) => {
          if (link !== null) notices?.now(sellerId, { kind: 'LINK', broadcast: broadcastId, link })
        })
        .catch(() => undefined)
    },
    onUnlink: (tx, sellerId, broadcastId, now) => (dms as InstagramDms).onUnlink(tx, sellerId, broadcastId, now),
  })

  dms = new InstagramDms({
    db,
    writer,
    clock,
    log,
    settings,
    sender: thanksSender,
    connections,
    timer,
    autoRun: options.dmAutoRun ?? true,
    publish: options.publish,
  })

  const webhook = new InstagramWebhook({ db, settings, connections, links, locks, service, clock, log, notices })
  const dmRunner = dms
  const liveNotices = notices
  const liveLinks = links
  dmRunner.start()

  const txHook: TxHook = async (tx, ctx) => {
    const created = await dmRunner.txHook(tx, ctx)
    const ended = ctx.rehearsal ? [] : ctx.records.filter((record) => record.type === 'broadcast.end' && record.changed).map((record) => (record.event as unknown as { b: string }).b)
    if (created === null && ended.length === 0) return null
    return () => {
      created?.()
      for (const broadcastId of ended) liveNotices.collection(ctx.sellerId, broadcastId)
    }
  }

  return {
    settings,
    meta,
    connections,
    links: liveLinks,
    webhook,
    dms: dmRunner,
    notices: liveNotices,
    liveSource,
    thanksSender,
    txHook,
    liveNow,
    close: () => {
      dmRunner.close()
      liveNotices.close()
    },
  }
}
