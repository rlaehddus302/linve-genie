// 유튜브 채팅 수집기 (AC-Y1-20~29, D-Y04·D-Y05·D-Y10).
// - 채팅 원천(ChatSource)은 하나의 모양(지점 → 응답 묶음·다음 지점·끝남 신호·오류)이고 구현이 셋이다: streamList(기본) · list 폴링(대체) · 시험용 가짜.
//   수집 관리자·이어받기·기록 코드는 셋에 똑같다. 실제 어댑터는 가짜 서버에 실제 통신 방식(HTTP·스트림)으로 붙는다.
// - 상태 (AC-I3-24): 스트림이 열리면(HTTP 200 — 첫 응답 묶음 전) 채팅을 받는 중(LIVE)이다. 폴링은 빈 목록이어도 받은 응답이면 LIVE.
// - streamList가 응답을 하나도 받지 못한 채 연속 3번 실패하거나 지원하지 않는다고 하면(404·501·UNIMPLEMENTED) 폴링으로 바꿔 같은 지점부터 이어 간다.
// - 호출 간격 (AC-Y1-94, D-Y1-04): 한 수집기의 채팅 호출(스트림 열기·폴링) 사이는 늘 2초 이상(401 뒤 새로 고쳐 한 번 더 하는 것만 예외).
//   폴링은 앞 응답을 받은 뒤 max(pollingIntervalMillis, 2초)(없거나 숫자가 아니면 5초), 스트림은 앞 스트림을 연 때부터 5초 뒤에 다시 연다.
//   실패가 이어지면(오류 응답·연결 오류·응답 없이 끝난 스트림, 두 방식 모두) 5·10·20·30초, 그 뒤 30초씩 — 응답을 받으면 5초로 되돌린다.
// - 예정 방송 (AC-Y1-94): 이은 유튜브 방송이 시작 전이면 채팅을 부르지 않고 30초마다 방송 상태만 본다(videos.list, 1단위). 상태 STARTING·NOT_STARTED.
//   시작하면 그 확인에서 바로 수집을 시작하고, 실제 시작 시각보다 먼저 게시된 메시지는 잇기 전 채팅처럼 기록하지 않는다. 서버를 다시 시작해도 그대로.
// - 한 응답의 메시지 이벤트가 모두 커밋된 뒤에만 그 응답의 nextPageToken을 이어받기 지점으로 저장한다(누락·중복 없음).
// - 잇기 전 채팅(지점 없이 받은 첫 응답에서 이은 시각보다 먼저 게시된 것)·끝낸 뒤 채팅(게시 시각 > 끝낸 시각)은 기록하지 않는다. 끝낸 뒤 10분이면 멈춘다.
// - 우리 채널이 쓴 메시지 중 발송함이 게시한 것은 기록하지 않고 게시 확인에 쓴다. 판매자가 손으로 쓴 것은 owner: true로 기록한다.
// - 지운 메시지·유튜브 차단은 알림만 남긴다(엔진은 그대로).
// - 같은 연결의 수집기는 서버 전체에서 하나만 돈다(DB 임대 20초, 5초마다 늘림). 하나가 죽으면 다른 서버가 30초 안에 이어받는다.
// - 서버 웹 읽기 (YT-11, D-YT-SRV-04~07·10): 방식 WEB인 수집기는 구글 연결·할당량 없이 유튜브 웹 내부 채팅 API로 공개 라이브의 전체 채팅을 받는다.
//   채팅 페이지에서 호출 정보·전체 채팅 첫 지점을 받고(그 수집기 메모리), get_live_chat을 한 번에 하나씩 부른다 — 다음 부름은 앞 응답을 받은 뒤
//   그 응답의 timeoutMs(1~10초로 자름, 없으면 5초). 실패 뒤: 연결 오류·5xx·모르는 모양 5·10·20·30초(그 뒤 30초씩), 막힘 30·60·120·300초(그 뒤 300초씩).
//   지점·기록·이어받기·잇기 전/예정/끝낸 뒤 거르기·우리 감사 거르기·지움/숨김 알림은 위와 같다. 구글 연결 상태는 이 수집을 멈추지 않는다.
//   다음 지점이 없거나 빈 응답이면 방송 페이지로 한 번 더 확인해 끝났을 때만 CHAT_ENDED, 아직 진행 중이면 모르는 모양이다(잘못 끝내면 되돌릴 수 없다).
//   막힘·모르는 모양은 처음 생길 때 바로 RETRYING + 이유 BLOCKED·FORMAT(콘솔 경고)과 운영자 경보, 연결 오류 5번 이어지면 운영자 경보.
//   1분 동안 읽은 메시지가 0개인데 모르는 종류·읽지 못함이 있으면 모르는 모양. 운영자 끄기면 STOPPED·OPERATOR_OFF(유튜브 요청 0).
import { getBroadcast } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { Service } from '../service.ts'
import { chatEventSeq, chatRowsByIds, findBroadcast, scopeSealedAt, type BroadcastRow } from '../store.ts'
import { messageLookup } from '../views.ts'
import type { ScopeWriter } from '../writer.ts'
import { YoutubeAccessError, googleFields, type YoutubeConnections } from './connect.ts'
import { GoogleError, type GoogleClient } from './google.ts'
import type { InnertubeSession, PageState } from './web-chat.ts'
import { WEB_MIN_WAIT_MS, WebChatError, backoffMs, nextWaitMs, type WebChatPoll, type WebChatSource } from './web-chat-source.ts'
import type { QuotaMeter } from './quota.ts'
import {
  acquireLease,
  activeLink,
  collectorCandidates,
  collectorOf,
  connectionChannel,
  insertNotice,
  insertOwnMessage,
  ownAuthorChannels,
  linkById,
  markChatEnded,
  markLinkStarted,
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
import { SERVICE_NAME } from '../brand.ts'

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
  // 시작하는 중(STARTING)의 이유: 예정 방송이 시작하기를 기다림 (AC-Y1-94)
  NOT_STARTED: '유튜브 방송이 시작되면 채팅을 받아요.',
  // 서버 웹 읽기 (YT-11 AC5·AC6): 다시 연결하는 중(RETRYING)의 이유 — 바로 경고, 저절로 다시 시도한다
  BLOCKED: '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.',
  FORMAT: '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.',
  // 운영자 끄기 — 다시 켜면(서버 다시 시작) 저절로 이어받는다
  OPERATOR_OFF: '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.',
} as const
export type CollectorReason = keyof typeof COLLECTOR_REASON_MESSAGES

/** 끊긴 동안 일부를 받지 못했을 수 있을 때 (지점 거절) */
export const GAP_MESSAGE = '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.'
/** 지운 메시지·유튜브 차단 알림 문장 (AC-Y1-27) */
export const NOTICE_MESSAGES = {
  DELETED: '시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.',
  BANNED: `유튜브에서 차단된 시청자예요. ${SERVICE_NAME}에서도 막으려면 차단해 주세요.`,
} as const

/** 판매자가 다시 시작해야 하는 이유 (저절로 이어받지 않는다) */
const MANUAL_REASONS: ReadonlySet<string> = new Set(['CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND'])
/** 다시 시작할 수 없는 이유 */
const FINAL_REASONS: ReadonlySet<string> = new Set(['UNLINKED', 'SEALED'])

/** 끝낸 뒤 이만큼 더 받는다 (AC-Y1-25) */
export const AFTER_END_MS = 10 * 60 * 1000
/** 채팅 호출 사이 아래 한도 (AC-Y1-94) */
export const MIN_CALL_GAP_MS = 2000
/** 같은 수집기가 스트림을 다시 여는 간격 — 앞 스트림을 연 때부터 (AC-Y1-94) */
export const STREAM_REOPEN_MS = 5000
/** 실패가 이어질 때 다음 시도까지: 5·10·20·30초, 그 뒤 30초씩 (AC-Y1-24·94) */
export const FAILURE_BACKOFF_MS: readonly number[] = [5000, 10_000, 20_000, 30_000]
/** 예정 방송의 상태 확인 간격 (AC-Y1-94) */
export const UPCOMING_CHECK_MS = 30_000
/** 응답 없이 연속 이만큼 실패하면 폴링으로 (AC-Y1-20) */
const STREAM_FAILURES_TO_POLL = 3
/** 폴링 응답에 간격이 없거나 숫자가 아니면 (AC-Y1-94) */
const DEFAULT_POLL_MS = 5000
/** 서버 웹 읽기 수집기의 방식 (youtube_collectors.mode, YT-11) */
export const WEB_MODE = 'WEB'
/** 연결 오류가 한 수집기에서 이만큼 이어지면 운영자 경보 YT_CHAT_NETWORK (AC5) */
const WEB_NETWORK_ALERT_AFTER = 5
/** 읽은 메시지 0개 + 모르는 종류·읽지 못함을 보는 창 (AC5) */
const WEB_FORMAT_WINDOW_MS = 60_000
/** 방송 페이지 상태 → 멈춤 이유 (판매자가 다시 시작해야 함). 로그인 없이 볼 수 없게 바뀐 방송(비공개·멤버 전용·연령 제한)은 채팅을 찾을 수 없음으로 */
const PAGE_STOPS: Readonly<Partial<Record<PageState, CollectorReason>>> = {
  NOT_FOUND: 'CHAT_NOT_FOUND',
  NOT_PUBLIC: 'CHAT_NOT_FOUND',
  CHAT_DISABLED: 'CHAT_DISABLED',
}
/** 로그에 남겨도 되는 모르는 종류 이름 (영문 이름 모양만 — 그 밖은 OTHER) */
const ITEM_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

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
  /** 찾기 바퀴마다 성공·실패 (워커 건강, AC-I3-82) */
  readonly onPass?: (ok: boolean) => void
  /** 서버 웹 읽기 원천 (YT-11). 없으면 방식 WEB 수집기는 멈춤 OPERATOR_OFF */
  readonly web?: WebChatSource | null
  /** 읽기는 서버 웹으로만 (운영 설정) — 옛 공식 방식(STREAM·POLL) 수집기도 WEB으로 바꿔 받는다 */
  readonly webOnly?: boolean
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
  /** 지금 시도를 시작할 때 본 회차 끝낸 시각·채널 (임대를 늘릴 때 DB와 다르면 시도를 끊고 다시 계산한다 — 다른 서버에서 한 조작) */
  basis: { readonly endedAt: number | null; readonly channelId: string } | null
  done: Promise<void>
  killed: boolean
  /** 웹 읽기 상태 (그 수집기 메모리만 — 저장·공유 없음, AC1) */
  web: WebRun
}

/** 웹 읽기 수집기 하나의 메모리 상태 */
interface WebRun {
  /** 호출 정보와 채팅 페이지의 전체 채팅 첫 지점 (다시 시작하면 채팅 페이지에서 다시 받는다) */
  session: { readonly session: InnertubeSession; readonly fresh: string } | null
  /** 이어진 실패 수: 막힘 · 그 밖(연결 오류·5xx·모르는 모양) · 연결 오류만(운영자 경보) */
  blocked: number
  others: number
  network: number
  /** 모르는 모양 창: 시작 시각·읽은 메시지·모르는 종류+읽지 못함 */
  window: { start: number; chats: number; odd: number } | null
  /** 창이 모르는 모양으로 판정했다 (메시지를 읽을 때까지 FORMAT으로 둔다) */
  formatHeld: boolean
  /** 로그에 이미 남긴 모르는 종류 이름 */
  readonly loggedItems: Set<string>
}

class StopRun extends Error {
  constructor() {
    super('stop')
    this.name = 'StopRun'
  }
}

/** 회차를 끝냈거나 연결을 끊었다(다른 서버에서 했을 수 있다) — 지금 시도를 끊고 상태를 다시 계산한다 */
class Recheck extends Error {
  constructor() {
    super('recheck')
    this.name = 'Recheck'
  }
}

class SaveFailed extends Error {
  constructor() {
    super('save failed')
    this.name = 'SaveFailed'
  }
}

/** 응답 하나에서 꺼낸 것 */
export interface Parsed {
  readonly chats: { id: string; ch: string; nick: string; text: string; owner: boolean; publishedAt: number }[]
  readonly own: { id: string; text: string; publishedAt: number }[]
  readonly deleted: string[]
  readonly bans: { id: string; channelId: string; nick: string; type: string | null; seconds: number | null }[]
  readonly next: string | null
  readonly offline: boolean
  readonly pollingMs: number | null
}

export class CollectorManager {
  readonly #options: CollectorOptions
  readonly #running = new Map<string, Running>()
  /** 웹 읽기에서 마지막으로 알린 막힘·모르는 모양 (연결 ID → 이유) — 다시 받으면 지운다 */
  readonly #trouble = new Map<string, 'BLOCKED' | 'FORMAT'>()
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
          this.#options.onPass?.(true)
        } catch (error) {
          this.#options.onPass?.(false)
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
    // 서버 웹 읽기는 구글 연결과 상관없다 — 운영자 끄기만 본다 (D-YT-SRV-10)
    if (row.mode === WEB_MODE) return this.#options.web == null || this.#options.web.off ? stop('OPERATOR_OFF') : { run: true }
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
      // 읽기는 서버 웹으로만(운영): 옛 공식 방식 수집기를 WEB으로 — 공식 지점은 웹에서 쓸 수 없어 새 전체 채팅 지점으로 시작한다(받던 중이면 끊긴 동안 일부를 못 받았을 수 있음)
      if (this.#options.webOnly === true && candidate.mode !== WEB_MODE) {
        await updateCollector(db, candidate.sellerId, candidate.linkId, { mode: WEB_MODE, pageToken: null, ...(candidate.firstDone ? { gap: true } : {}), firstDone: false }, new Date(timer.now()))
      }
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
    const running: Running = {
      sellerId: row.sellerId,
      broadcastId: row.broadcastId,
      controller: new AbortController(),
      attempt: null,
      basis: null,
      done: Promise.resolve(),
      killed: false,
      web: { session: null, blocked: 0, others: 0, network: 0, window: null, formatHeld: false, loggedItems: new Set() },
    }
    this.#running.set(row.linkId, running)
    running.done = this.#run(row, running)
      .catch((error: unknown) => {
        this.#options.log({ level: 'error', code: 'WORKER_FAILED', seller: row.sellerId, errorKind: errorKind(error) })
      })
      .finally(() => {
        this.#running.delete(row.linkId)
      })
  }

  /**
   * 임대를 늘린다. 잃으면 그 수집기를 멈춘다. 늘릴 때마다 회차 끝냄·연결 끊기·채널 연결 상태를 DB에서 다시 보고, 지금 시도를 시작할 때와 다르면
   * 그 시도를 끊어 다시 계산하게 한다 — 그 조작을 다른 서버가 받았어도(같은 서버의 알림이 없어도) 끝낸 뒤 10분에 멈추고 끊은 뒤엔 멈춘다
   * (AC-Y1-13·25·28, 메시지가 오지 않는 조용한 스트림 포함)
   */
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
        break
      }
      try {
        if (await this.#changedSince(row, running)) running.attempt?.abort()
      } catch {
        // DB가 잠깐 안 되면 다음에 다시
      }
    }
  }

  /** 지금 시도를 시작한 뒤 회차 끝냄·연결 끊기·채널 연결 상태가 바뀌었는지 */
  async #changedSince(row: CollectorRow, running: Running): Promise<boolean> {
    const basis = running.basis
    if (basis === null || running.attempt === null) return false
    const { db } = this.#options
    const link = await linkById(db, row.sellerId, row.linkId)
    if (link === null || link.unlinkedAt !== null) return true
    const broadcast = await findBroadcast(db, row.sellerId, row.broadcastId)
    if (broadcast === null || (broadcast.endedAt?.getTime() ?? null) !== basis.endedAt) return true
    // 서버 웹 읽기는 구글 연결이 바뀌어도 그대로 받는다
    if (row.mode === WEB_MODE) return false
    const connection = await connectionChannel(db, row.sellerId)
    return connection === null || connection.status !== 'CONNECTED' || connection.channelId !== basis.channelId
  }

  async #run(start: CollectorRow, running: Running): Promise<void> {
    const { timer, log } = this.#options
    const signal = running.controller.signal
    const lease = this.#leaseLoop(start, running)
    let streamFailures = 0
    /** 이어진 실패 수 (응답을 받으면 0) */
    let failures = 0
    /** 다음 채팅 호출을 할 수 있는 가장 이른 시각 (AC-Y1-94) */
    let nextCallAt = Number.NEGATIVE_INFINITY
    const failed = () => {
      failures += 1
      const delay = FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length) - 1] as number
      nextCallAt = Math.max(nextCallAt, timer.now() + delay)
    }
    try {
      // 예정 방송을 기다리던 수집기(STARTING·NOT_STARTED)는 다음 상태 확인 시각을 그대로 둔다 (서버를 다시 시작해도)
      if (start.status !== 'LIVE' && start.status !== 'RETRYING' && !(start.status === 'STARTING' && start.reason === 'NOT_STARTED')) {
        await this.#setStatus(start, { status: 'STARTING', reason: null, resumeAt: null }, this.#options.owner)
      }
      while (!signal.aborted) {
        const ctx = await this.#context(start)
        const verdict = this.#verdict(ctx, timer.now())
        if (!verdict.run) {
          if (verdict.change !== null) await this.#setStatus(ctx.row, verdict.change, this.#options.owner)
          return
        }
        const link = ctx.link as LinkRow
        const broadcast = ctx.broadcast as BroadcastRow
        // 예정 방송: 시작할 때까지 채팅을 부르지 않는다
        if (link.startedAt === null) {
          if ((await this.#awaitStart(ctx, link, broadcast, running)) === 'stop') return
          continue
        }
        // 호출 간격 (앞 호출 + 2초, 스트림은 앞 스트림을 연 때 + 5초, 실패가 이어지면 5·10·20·30초)
        const wait = nextCallAt - timer.now()
        if (wait > 0) {
          await this.#pause(ctx, broadcast, running, wait)
          continue
        }
        const stopAt = broadcast.endedAt === null ? null : broadcast.endedAt.getTime() + AFTER_END_MS
        const attempt = new AbortController()
        running.attempt = attempt
        running.basis = { endedAt: broadcast.endedAt?.getTime() ?? null, channelId: ctx.connection?.channelId ?? '' }
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
        const callAt = timer.now()
        nextCallAt = callAt + (ctx.row.mode === WEB_MODE ? WEB_MIN_WAIT_MS : ctx.row.mode === 'POLL' ? MIN_CALL_GAP_MS : STREAM_REOPEN_MS)
        try {
          if (ctx.row.mode === WEB_MODE) {
            const outcome = await this.#webOnce(ctx, link, broadcast, running, attempt.signal)
            if (outcome.kind === 'stop') return
            if (outcome.kind === 'ended') return await this.#chatEnded(ctx.row, link)
            received = 1
            // 응답을 받았다: 실패 수를 처음으로, 다음 부름은 받은 뒤 timeoutMs(1~10초, 없으면 5초)
            running.web.blocked = 0
            running.web.others = 0
            running.web.network = 0
            nextCallAt = Math.max(nextCallAt, outcome.receivedAt + nextWaitMs(outcome.timeoutMs))
            continue
          } else if (ctx.row.mode === 'POLL') {
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
            const receivedAt = timer.now()
            const result = await this.#handle(ctx, link, broadcast, parse(parsed, receivedAt), !ctx.row.firstDone)
            failures = 0
            // 다음 폴링: 앞 응답을 받은 뒤 max(pollingIntervalMillis, 2초) — 간격이 없거나 숫자가 아니면 5초
            nextCallAt = Math.max(nextCallAt, receivedAt + Math.max(result.pollingMs ?? DEFAULT_POLL_MS, MIN_CALL_GAP_MS))
            if (result.offline) return await this.#chatEnded(ctx.row, link)
            continue
          } else {
            let first = !ctx.row.firstDone
            await this.#options.connections.withToken(ctx.row.sellerId, async (token) => {
              const opened = async () => {
                // 다시 열기는 이 스트림이 열린 때부터 5초 뒤 (AC-Y1-94)
                nextCallAt = Math.max(nextCallAt, timer.now() + STREAM_REOPEN_MS)
                // 첫 응답 묶음 전이어도(채팅이 조용해도) 채팅을 받는 중 (AC-I3-24)
                await this.#opened(ctx)
              }
              for await (const response of this.#options.google.stream({ sellerId: ctx.row.sellerId, accessToken: token, liveChatId: link.liveChatId, pageToken: ctx.row.pageToken, signal: attempt.signal, onOpen: opened })) {
                received += 1
                const result = await this.#handle(ctx, link, broadcast, parse(response, timer.now()), first)
                first = false
                failures = 0
                streamFailures = 0
                if (result.offline) throw new ChatEnded()
                if (result.recheck) throw new Recheck()
                // 다음 응답의 지점은 방금 저장한 지점 (스트림 안에서는 서버가 이어서 보낸다)
              }
            })
            if (attempt.signal.aborted) {
              if (stopFired) return await this.#finish(ctx.row)
              continue
            }
            // 스트림이 정상으로 끝났다: 받은 게 있으면 앞 스트림을 연 때부터 5초 뒤 다시 열고, 없으면 실패로 센다
            if (received === 0) {
              streamFailures += 1
              if (streamFailures >= STREAM_FAILURES_TO_POLL) await this.#toPoll(ctx.row)
              failed()
              await this.#retrying(ctx.row)
            }
          }
        } catch (error) {
          if (error instanceof ChatEnded) return await this.#chatEnded(ctx.row, link)
          if (signal.aborted) return
          if (error instanceof Recheck) continue
          if (attempt.signal.aborted && stopFired) return await this.#finish(ctx.row)
          if (attempt.signal.aborted && !(error instanceof SaveFailed)) continue
          if (error instanceof StopRun) {
            running.killed = true // 임대를 잃었거나 봉인됨 — 이 서버는 더 손대지 않는다
            return
          }
          if (error instanceof WebChatError) {
            // 지점 거절·모르는 모양이면 호출 정보를 버리고 다음에 채팅 페이지에서 새 전체 채팅 지점을 받는다
            if (error.kind === 'REJECTED' || error.kind === 'UNKNOWN_SHAPE') running.web.session = null
            const action = await this.#webError(ctx.row, error, running)
            if (action === 'stop') return
            if (action === 'now') continue
            const blocked = error.kind === 'BLOCKED'
            if (blocked) running.web.blocked += 1
            else running.web.others += 1
            nextCallAt = Math.max(nextCallAt, timer.now() + backoffMs(blocked ? 'BLOCKED' : 'OTHER', blocked ? running.web.blocked : running.web.others))
            if (!blocked && error.kind !== 'UNKNOWN_SHAPE') await this.#retrying(ctx.row)
            continue
          }
          const action = await this.#onError(ctx.row, error)
          if (action === 'stop') return
          if (action === 'ended') return await this.#chatEnded(ctx.row, link)
          // 지점 거절: 지점 없이 다시 연다 (호출 간격은 그대로)
          if (action === 'now') continue
          if (action === 'poll') {
            await this.#toPoll(ctx.row)
            failed()
            continue
          }
          if (ctx.row.mode === 'STREAM' && received === 0) {
            streamFailures += 1
            if (streamFailures >= STREAM_FAILURES_TO_POLL) await this.#toPoll(ctx.row)
          }
          failed()
          await this.#retrying(ctx.row)
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

  /**
   * ms만큼 기다린다(채팅 호출 간격·예정 방송 상태 확인). 회차 끝냄·연결 끊기·채널 연결이 바뀌거나(임대를 늘릴 때 알아챈다) 멈추면 바로 깬다.
   * 끝낸 뒤 10분이 되면 그때 깨어 멈춘다 (부르는 쪽이 다시 계산한다)
   */
  async #pause(ctx: Context, broadcast: BroadcastRow, running: Running, ms: number): Promise<void> {
    const { timer } = this.#options
    const signal = running.controller.signal
    const pause = new AbortController()
    running.attempt = pause
    running.basis = { endedAt: broadcast.endedAt?.getTime() ?? null, channelId: ctx.connection?.channelId ?? '' }
    const onOuter = () => pause.abort()
    signal.addEventListener('abort', onOuter, { once: true })
    const stopAt = broadcast.endedAt === null ? null : broadcast.endedAt.getTime() + AFTER_END_MS
    try {
      await timer.sleep(stopAt === null ? ms : Math.min(ms, Math.max(0, stopAt - timer.now())), pause.signal)
    } finally {
      signal.removeEventListener('abort', onOuter)
      running.attempt = null
    }
  }

  /**
   * 예정 방송 (AC-Y1-94): 채팅을 부르지 않고 30초마다 방송 상태를 본다(videos.list). 처음 확인은 이은 때부터 30초 뒤(잇기가 이미 확인했다).
   * 진행 중이면 실제 시작 시각(없으면 지금)을 적고 'again'(바로 수집 시작), 아직 예정이면 다음 확인 시각을 적고 'again', 끝났거나 영상이 없으면 'stop'
   */
  async #awaitStart(ctx: Context, link: LinkRow, broadcast: BroadcastRow, running: Running): Promise<'again' | 'stop'> {
    const { timer, owner, db } = this.#options
    const row = ctx.row
    const dueAt = row.resumeAt?.getTime() ?? link.linkedAt.getTime() + UPCOMING_CHECK_MS
    if (row.status !== 'STARTING' || row.reason !== 'NOT_STARTED' || row.resumeAt === null) {
      await this.#setStatus(row, { status: 'STARTING', reason: 'NOT_STARTED', resumeAt: new Date(dueAt) }, owner)
    }
    const wait = dueAt - timer.now()
    if (wait > 0) {
      await this.#pause(ctx, broadcast, running, wait)
      return 'again'
    }
    if (row.mode === WEB_MODE) return await this.#webAwaitStart(row, link)
    let body: Record<string, unknown>
    try {
      body = await this.#options.connections.withToken(row.sellerId, (token) =>
        this.#options.google.api({ sellerId: row.sellerId, method: 'videos.list', accessToken: token, path: '/videos', query: { part: 'snippet,liveStreamingDetails', id: link.videoId } }),
      )
    } catch (error) {
      const notFound = error instanceof GoogleError && (error.status === 404 || error.reason === 'videoNotFound')
      if (notFound) {
        await this.#setStatus(row, { status: 'STOPPED', reason: 'CHAT_NOT_FOUND', resumeAt: null }, owner)
        return 'stop'
      }
      const quotaOrAccess = error instanceof YoutubeAccessError || (error instanceof GoogleError && error.reason === 'quotaExceeded')
      if (quotaOrAccess && (await this.#onError(row, error)) === 'stop') return 'stop'
      if (!quotaOrAccess) this.#options.log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, ...googleFields(error) })
      await updateCollector(db, row.sellerId, row.linkId, { resumeAt: new Date(timer.now() + UPCOMING_CHECK_MS) }, new Date(timer.now()), owner)
      return 'again'
    }
    const item = ((Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]).find((candidate) => candidate.id === link.videoId)
    if (item === undefined) {
      await this.#setStatus(row, { status: 'STOPPED', reason: 'CHAT_NOT_FOUND', resumeAt: null }, owner)
      return 'stop'
    }
    const content = record(item.snippet).liveBroadcastContent
    const details = record(item.liveStreamingDetails)
    const actualStart = Date.parse(text(details.actualStartTime) ?? '')
    const ended = text(details.actualEndTime) !== null
    if (!ended && (content === 'live' || (content !== 'upcoming' && Number.isFinite(actualStart)))) {
      await markLinkStarted(db, row.sellerId, link.id, new Date(Number.isFinite(actualStart) ? actualStart : timer.now()))
      await this.#setStatus(row, { status: 'STARTING', reason: null, resumeAt: null }, owner)
      return 'again'
    }
    if (!ended && content === 'upcoming') {
      await updateCollector(db, row.sellerId, row.linkId, { resumeAt: new Date(timer.now() + UPCOMING_CHECK_MS) }, new Date(timer.now()), owner)
      return 'again'
    }
    // 시작하기 전에 끝났다
    await this.#chatEnded(row, link)
    return 'stop'
  }

  /**
   * 스트림이 열렸다(HTTP 200, 첫 응답 묶음 전) — 시작하는 중·다시 연결하는 중이면 채팅을 받는 중(LIVE)으로 적고 알린다 (AC-I3-24, YT-03).
   * 채팅이 조용하면 응답 묶음이 한참 오지 않으므로 묶음을 기다리면 판매자는 연결이 안 붙은 줄 안다. 연결을 끊었으면 다시 계산, 임대를 잃었으면 멈춘다
   */
  async #opened(ctx: Context): Promise<void> {
    const row = ctx.row
    if (row.status === 'LIVE' && row.reason === null) return
    const { db, timer, owner } = this.#options
    const current = await linkById(db, row.sellerId, row.linkId)
    if (current === null || current.unlinkedAt !== null) throw new Recheck()
    const saved = await updateCollector(db, row.sellerId, row.linkId, { status: 'LIVE', reason: null, resumeAt: null }, new Date(timer.now()), owner)
    if (!saved) throw new StopRun()
    ctx.row = { ...row, status: 'LIVE', reason: null, resumeAt: null }
    await this.#publish(row)
  }

  async #toPoll(row: CollectorRow): Promise<void> {
    await this.#setStatus(row, { mode: 'POLL' }, this.#options.owner)
  }

  /** 다시 연결하는 중 (기다림은 다음 바퀴의 호출 간격으로) */
  async #retrying(row: CollectorRow): Promise<void> {
    const current = await collectorOf(this.#options.db, row.sellerId, row.linkId)
    if (current !== null && current.status !== 'RETRYING') await this.#setStatus(row, { status: 'RETRYING' }, this.#options.owner)
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

  /**
   * 응답 하나를 처리한다: 우리 메시지 → 기록 → 알림 → (시험 주입점) → 지점 저장.
   * 회차 끝낸 시각·연결 끊기는 응답마다 DB에서 다시 읽는다(다른 서버에서 했을 수 있다). 기록은 범위 락 안에서 한 번 더 거른다
   * (ingestYoutubeBatch — 끝낸 시각, #stillCollecting — 회차 잇기·유튜브 연결 상태).
   * 끝낸 시각이 이 시도를 시작할 때와 다르면 recheck — 시도를 끊고 끝낸 뒤 10분 멈춤을 다시 잡는다
   */
  async #handle(ctx: Context, link: LinkRow, broadcast: BroadcastRow, parsed: Parsed, firstResponse: boolean, hold: CollectorReason | null = null): Promise<{ offline: boolean; pollingMs: number | null; recheck: boolean }> {
    const { db, timer, service, owner } = this.#options
    const row = ctx.row
    const current = await linkById(db, row.sellerId, row.linkId)
    if (current === null || current.unlinkedAt !== null) throw new Recheck()
    const fresh = await findBroadcast(db, row.sellerId, row.broadcastId)
    if (fresh === null) throw new Recheck()
    // 잇기 전 채팅 거르기의 기준: 이은 시각, 예정이던 방송은 더 늦은 유튜브 실제 시작 시각 (AC-Y1-25·94)
    const linkedAt = Math.max(link.linkedAt.getTime(), link.startedAt?.getTime() ?? 0)
    const endedAt = fresh.endedAt?.getTime() ?? null
    // 우리 채널이 쓴 메시지: 발송함이 게시했거나 10분 안에 보내려 한 글이면 기록하지 않고 게시 확인에 쓴다 (AC-Y1-26).
    // 잇기 전·끝낸 뒤 거르기보다 먼저 본다 — 끝낸 뒤 올라간 우리 감사도 게시 확인에 쓰여야 두 번 게시하지 않는다 (AC-Y1-36)
    // 작성자는 그 회차의 글 올리는 계정(있으면)과 방송 채널 둘 다 본다 — 확장이 올린 글(방송 채널 주인)과 공식으로 올린 글을 한 규칙으로 (D-YT-SRV-16)
    const authors = ownAuthorChannels(link)
    const own: (Parsed['own'][number] & { ch: string | null })[] = parsed.own.map((message) => ({ ...message, ch: null }))
    const viewers: Parsed['chats'] = []
    for (const chat of parsed.chats) {
      if (authors.has(chat.ch) && (await this.#options.ourPost(row.sellerId, link.broadcastId, chat.id, chat.text))) {
        own.push({ id: chat.id, text: chat.text, publishedAt: chat.publishedAt, ch: chat.ch })
        continue
      }
      viewers.push(chat)
    }
    let skipped = 0
    const recordable: Parsed['chats'] = []
    for (const chat of viewers) {
      if (firstResponse && chat.publishedAt < linkedAt) {
        skipped += 1
        continue
      }
      if (endedAt !== null && chat.publishedAt > endedAt) continue
      recordable.push(chat)
    }
    // 우리 글은 회차에 묶는다 — 공식 채팅 ID를 받기 전에 본 글도 게시 확인에 쓴다 (D-YT-SRV-17)
    for (const message of own) {
      await insertOwnMessage(db, {
        sellerId: row.sellerId,
        scopeId: row.scopeId,
        linkId: link.id,
        liveChatId: link.liveChatId,
        authorChannelId: message.ch,
        messageId: message.id,
        text: message.text,
        publishedAt: new Date(message.publishedAt),
      })
    }
    const outcome = await service.ingestYoutubeBatch(
      row.sellerId,
      link.broadcastId,
      recordable.map((chat) => ({ id: chat.id, ch: chat.ch, nick: chat.nick, text: chat.text, publishedAt: chat.publishedAt, ...(chat.owner ? { owner: true } : {}) })),
      async (tx) => await this.#stillCollecting(tx, row, link),
    )
    if (outcome.status === 'sealed') throw new StopRun()
    if (outcome.status === 'unlinked') throw new Recheck()
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
        // 받았지만 모르는 모양으로 판정한 동안(웹 읽기)은 다시 연결하는 중 + 그 이유로 둔다
        status: hold === null ? 'LIVE' : 'RETRYING',
        reason: hold,
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
    ctx.row = { ...row, pageToken: parsed.next ?? row.pageToken, firstDone: true, status: hold === null ? 'LIVE' : 'RETRYING', reason: hold }
    if (row.status !== ctx.row.status || row.reason !== ctx.row.reason) await this.#publish(row)
    return { offline: parsed.offline, pollingMs: parsed.pollingMs, recheck: endedAt !== (broadcast.endedAt?.getTime() ?? null) }
  }

  // ── 서버 웹 읽기 (YT-11) ────────────────────────────────────────────────

  /**
   * 웹 읽기 한 번 (AC3): 지점 → 응답 묶음 → 기록(#handle — 기록을 마친 뒤 지점 저장). 호출 정보가 없으면 채팅 페이지에서 받는다(전체 채팅 첫 지점).
   * 저장한 지점이 있으면 그것부터(이어받기), 없으면 채팅 페이지의 첫 지점부터(그 응답은 잇기 전 거르기를 한다).
   * 다음 지점 없음·빈 응답·채팅 칸 없음은 방송 페이지로 확인한 뒤에만 ended. 막힘·모르는 모양·지점 거절은 WebChatError로 던진다(#webError)
   */
  async #webOnce(
    ctx: Context,
    link: LinkRow,
    broadcast: BroadcastRow,
    running: Running,
    signal: AbortSignal,
  ): Promise<{ kind: 'ok'; receivedAt: number; timeoutMs: number | null } | { kind: 'ended' } | { kind: 'stop' }> {
    const source = this.#options.web
    if (source == null) throw new WebChatError('OFF')
    let cached = running.web.session
    if (cached === null) {
      const page = await source.chatPage(link.videoId, signal)
      if (page.state === 'BLOCKED' || page.state === 'UNKNOWN_SHAPE') throw new WebChatError(page.state)
      if (page.state !== 'OK' || page.session === null || page.continuation === null) return await this.#webConfirmEnd(ctx.row, link, running, signal)
      cached = { session: page.session, fresh: page.continuation }
      running.web.session = cached
    }
    const result: WebChatPoll = await source.poll(cached.session, ctx.row.pageToken ?? cached.fresh, signal)
    const receivedAt = this.#options.timer.now()
    if (result.kind === 'no_contents') return await this.#webConfirmEnd(ctx.row, link, running, signal)
    this.#logUnknownItems(running, result.unknown)
    const hold = this.#formatWindow(running, result, receivedAt)
    await this.#handle(ctx, link, broadcast, webParsed(result), !ctx.row.firstDone, hold)
    if (hold === null) this.#trouble.delete(ctx.row.linkId)
    else this.#webTrouble(ctx.row, 'FORMAT')
    if (result.next === null) return await this.#webConfirmEnd(ctx.row, link, running, signal)
    return { kind: 'ok', receivedAt, timeoutMs: result.timeoutMs }
  }

  /**
   * 모르는 모양 창 (AC5): 1분 동안 읽은 메시지가 0개인데 모르는 종류·읽지 못함이 1개 이상이면 모르는 모양으로 판정하고,
   * 메시지를 하나라도 읽을 때까지 FORMAT으로 둔다. 판정 중이면 그 이유(FORMAT), 아니면 null
   */
  #formatWindow(running: Running, result: Extract<WebChatPoll, { kind: 'ok' }>, now: number): CollectorReason | null {
    const web = running.web
    if (result.chats.length > 0) web.formatHeld = false
    const window = web.window ?? { start: now, chats: 0, odd: 0 }
    window.chats += result.chats.length
    window.odd += result.unknown.length + result.unreadable
    web.window = window
    if (now - window.start >= WEB_FORMAT_WINDOW_MS) {
      if (window.chats === 0 && window.odd > 0) web.formatHeld = true
      web.window = null
    }
    return web.formatHeld ? 'FORMAT' : null
  }

  /** 모르는 종류 이름과 수만 남긴다 (AC10 — 응답 본문 없음). 같은 이름은 그 수집기에서 한 번 */
  #logUnknownItems(running: Running, names: readonly string[]): void {
    const counts = new Map<string, number>()
    for (const name of names) {
      const safe = ITEM_NAME_RE.test(name) ? name : 'OTHER'
      counts.set(safe, (counts.get(safe) ?? 0) + 1)
    }
    for (const [name, count] of counts) {
      if (running.web.loggedItems.has(name)) continue
      running.web.loggedItems.add(name)
      this.#options.log({ level: 'warn', code: 'YT_CHAT_UNKNOWN_ITEM', reason: name, count })
    }
  }

  /**
   * 채팅이 끝난 것 같다(다음 지점 없음·빈 응답·채팅 칸 없음) — 방송 페이지로 한 번 더 확인한다 (AC3). 끝났으면 ended, 멈출 까닭이면 그 상태로 stop,
   * 막혔으면 막힘, 아직 진행 중(또는 예정)이면 모르는 모양
   */
  async #webConfirmEnd(row: CollectorRow, link: LinkRow, running: Running, signal: AbortSignal): Promise<{ kind: 'ended' } | { kind: 'stop' }> {
    const source = this.#options.web
    if (source == null) throw new WebChatError('OFF')
    // 방송 페이지가 막히면 next로 대신 확인 — 들고 있던 채팅 페이지 호출 정보를 쓴다 (D-YT-SRV-19)
    const known = running.web.session?.session ?? null
    running.web.session = null
    const page = await source.pageOrNext(link.videoId, signal, known)
    if (page.state === 'ENDED' || page.state === 'NOT_LIVE') return { kind: 'ended' }
    if (page.state === 'BLOCKED') throw new WebChatError('BLOCKED')
    const stop = PAGE_STOPS[page.state]
    if (stop !== undefined) {
      await this.#setStatus(row, { status: 'STOPPED', reason: stop }, this.#options.owner)
      return { kind: 'stop' }
    }
    throw new WebChatError('UNKNOWN_SHAPE')
  }

  /**
   * 웹 읽기 오류별 동작 (AC3·AC5·AC6): 끔 → 멈춤(OPERATOR_OFF). 막힘 → RETRYING·BLOCKED + 경보(처음 생길 때). 모르는 모양 → 새 전체 채팅 지점으로 다시 시작
   * (받던 지점이 있었으면 "끊긴 동안 일부" 표시) + RETRYING·FORMAT + 경보. 지점 거절 → 받던 지점이 있었으면 새 지점으로 바로 다시(끊긴 동안 일부 표시).
   * 연결 오류는 기다렸다 다시, 한 수집기에서 5번 이어지면 운영자 경보. 잇기 전 거르기는 새 지점의 첫 응답에서 다시 한다
   */
  async #webError(row: CollectorRow, error: WebChatError, running: Running): Promise<'stop' | 'now' | 'retry'> {
    const owner = this.#options.owner
    this.#options.log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, errorKind: `YoutubeWeb_${error.kind}`, ...(error.status === null ? {} : { status: error.status }) })
    const restart = async (): Promise<boolean> => {
      const current = await collectorOf(this.#options.db, row.sellerId, row.linkId)
      if (current === null || current.pageToken === null) return false
      await this.#setStatus(row, { pageToken: null, gap: true, firstDone: false }, owner)
      return true
    }
    switch (error.kind) {
      case 'OFF':
        await this.#setStatus(row, { status: 'STOPPED', reason: 'OPERATOR_OFF' }, owner)
        return 'stop'
      case 'BLOCKED':
        this.#webTrouble(row, 'BLOCKED')
        await this.#setStatus(row, { status: 'RETRYING', reason: 'BLOCKED' }, owner)
        return 'retry'
      case 'UNKNOWN_SHAPE':
        await restart()
        this.#webTrouble(row, 'FORMAT')
        await this.#setStatus(row, { status: 'RETRYING', reason: 'FORMAT' }, owner)
        return 'retry'
      case 'REJECTED':
        return (await restart()) ? 'now' : 'retry'
      default:
        running.web.network += 1
        if (running.web.network === WEB_NETWORK_ALERT_AFTER) this.#options.log({ level: 'warn', code: 'YT_CHAT_NETWORK' })
        return 'retry'
    }
  }

  /** 막힘·모르는 모양이 그 수집기에서 처음 생겼다 — 운영자 경보 기록 재료(판매자 정보 없음, AC5). 다시 받으면 지운다 */
  #webTrouble(row: CollectorRow, reason: 'BLOCKED' | 'FORMAT'): void {
    if (this.#trouble.get(row.linkId) === reason) return
    this.#trouble.set(row.linkId, reason)
    this.#options.log({ level: 'warn', code: reason === 'BLOCKED' ? 'YT_CHAT_BLOCKED' : 'YT_CHAT_FORMAT' })
  }

  /**
   * 예정 방송 (웹 읽기, AC3): 채팅을 부르지 않고 30초마다 방송 페이지로 상태만 본다. 진행 중이면 실제 시작 시각(없으면 지금)을 적고 바로 수집 시작,
   * 아직 예정이면 다음 확인 시각, 끝났으면 채팅 끝남, 멈출 까닭이면 그 상태. 막힘·모르는 모양·연결 오류는 30초 뒤 다시 본다(막힘·모르는 모양은 경보)
   */
  async #webAwaitStart(row: CollectorRow, link: LinkRow): Promise<'again' | 'stop'> {
    const { timer, owner, db } = this.#options
    const later = async (): Promise<'again'> => {
      await updateCollector(db, row.sellerId, row.linkId, { resumeAt: new Date(timer.now() + UPCOMING_CHECK_MS) }, new Date(timer.now()), owner)
      return 'again'
    }
    const source = this.#options.web
    if (source == null || source.off) {
      await this.#setStatus(row, { status: 'STOPPED', reason: 'OPERATOR_OFF', resumeAt: null }, owner)
      return 'stop'
    }
    let page: { state: PageState; startedAt: number | null }
    try {
      // 방송 페이지가 막히면 next로 대신 확인 (D-YT-SRV-19). next에는 시작 시각이 없어 진행 중이면 확인한 지금을 시작으로 적는다(잇기 전 거르기 기준)
      page = await source.pageOrNext(link.videoId)
    } catch (error) {
      if (error instanceof WebChatError && error.kind === 'BLOCKED') this.#webTrouble(row, 'BLOCKED')
      this.#options.log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, errorKind: error instanceof WebChatError ? `YoutubeWeb_${error.kind}` : errorKind(error) })
      return await later()
    }
    if (page.state === 'LIVE') {
      await markLinkStarted(db, row.sellerId, link.id, new Date(page.startedAt ?? timer.now()))
      this.#trouble.delete(row.linkId)
      await this.#setStatus(row, { status: 'STARTING', reason: null, resumeAt: null }, owner)
      return 'again'
    }
    if (page.state === 'UPCOMING') return await later()
    if (page.state === 'ENDED' || page.state === 'NOT_LIVE') {
      await this.#chatEnded(row, link)
      return 'stop'
    }
    const stop = PAGE_STOPS[page.state]
    if (stop !== undefined) {
      await this.#setStatus(row, { status: 'STOPPED', reason: stop, resumeAt: null }, owner)
      return 'stop'
    }
    // 막힘·모르는 모양: 시작 확인을 30초 뒤 다시
    this.#webTrouble(row, page.state === 'BLOCKED' ? 'BLOCKED' : 'FORMAT')
    this.#options.log({ level: 'warn', code: 'COLLECTOR_ERROR', seller: row.sellerId, errorKind: `YoutubeWeb_${page.state}` })
    return await later()
  }

  /**
   * 기록 트랜잭션(범위 락) 안에서 이 수집기가 아직 기록해도 되는지: 그 회차에 지금 이어진 연결이 이 수집기의 것이고,
   * 유튜브 연결이 있고 CONNECTED이며 이은 방송의 채널과 같다(#verdict와 같은 기준). 연결 끊기·다시 연결 필요·다른 채널 연결을
   * 다른 서버가 받았어도(이 서버에 알림이 없어도) 그 뒤 응답은 기록하지 않는다 (AC-Y1-06·28). 거절이면 다시 계산해 멈춘다
   */
  async #stillCollecting(tx: Db, row: CollectorRow, link: LinkRow): Promise<boolean> {
    if ((await activeLink(tx, row.sellerId, link.broadcastId))?.id !== row.linkId) return false
    // 서버 웹 읽기는 구글 연결과 상관없다 — 그 회차에 지금 이어진 연결이면 기록한다 (D-YT-SRV-10)
    if (row.mode === WEB_MODE) return true
    const connection = await connectionChannel(tx, row.sellerId)
    return connection !== null && connection.status === 'CONNECTED' && connection.channelId === link.channelId
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

/**
 * 웹 읽기 응답 묶음 → 수집기 모양 (YT-11 AC4·AC9). 한 작성자 글 모두 지움은 D-Y10 숨김(차단) 알림 재료 — 영구/임시는 모른다(null).
 * 그 알림의 이름은 같은 묶음에 그 시청자 글이 있으면 그 이름(정리), 없으면 빈 이름(알림이 "시청자"로 보인다)
 */
export function webParsed(batch: Extract<WebChatPoll, { kind: 'ok' }>): Parsed {
  const nickOf = (channelId: string) => batch.chats.findLast((chat) => chat.ch === channelId)?.nick ?? ''
  return {
    chats: batch.chats.map((chat) => ({ id: chat.id, ch: chat.ch, nick: chat.nick, text: chat.text, owner: chat.owner, publishedAt: chat.publishedAt })),
    own: [],
    deleted: batch.deleted,
    bans: batch.removedAuthors.map((channelId) => {
      const nick = nickOf(channelId)
      return { id: `author:${channelId}`, channelId, nick: nick === '' ? '' : sanitizeNick(nick), type: null, seconds: null }
    }),
    next: batch.next,
    offline: false,
    pollingMs: batch.timeoutMs,
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
    restartable: status === 'STOPPED' && reason !== 'QUOTA' && reason !== 'OPERATOR_OFF' && reason !== null && !FINAL_REASONS.has(reason),
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
