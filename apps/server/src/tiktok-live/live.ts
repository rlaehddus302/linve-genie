// 틱톡 라이브 베타 ② 서버 연결 (PLT-02, D-904, D-N2b-2-03~06·11, AC-N2b-2-20~38·50~53).
// 틱톡 연결 모듈(../tiktok/index.ts)을 서버에 잇는다: 위험 고지·동의 기록·판매자별 끄기·틱톡 아이디·운영자 스위치, 회차 잇기·끊기·다시 연결,
// 회차를 끝내면 멈춤, 서버가 다시 켜지면 이어받기, 레코드 → chat 기록(판매자마다 받은 순서대로 한 줄).
// - 판매자의 이어진 틱톡 연결은 모든 회차를 통틀어 하나다(판매자 잠금 + DB 부분 유일 인덱스). 연결 객체도 판매자마다 하나다.
// - 잇기·끊기·다시 연결은 엔진 이벤트가 아니다 — 누가·언제는 tiktok_links에 남는다(DAT-05). 같은 요청 번호는 한 번만 한다(처음 응답).
// - 기록은 그 회차가 틱톡에 이어져 있고(LINKED) 끝나지 않았을 때만 — 기록 트랜잭션 안(범위 락)에서 다시 본다. 끊기는 같은 범위 락을 잡고 끊는다.
// - 틱톡 아이디·시청자 닉네임·댓글은 로그·오류 응답에 쓰지 않는다(D-073·D-N2b-1-08). 로그는 정해진 코드·개수만.
import { getBroadcast } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { scopeLockKey } from '../db/schema.ts'
import type { LinkOutcome } from '../live-links.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { PlatformCapability } from '../platform.ts'
import { sellerLinkLockKey, type SellerLocks } from '../seller-locks.ts'
import { existingChatIds, findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'
import {
  checkTikTokTarget,
  createTikTokAttemptLimiter,
  createTikTokConnection,
  TIKTOK_MISSED_MESSAGE,
  TIKTOK_SETTINGS_OFF,
  type TikTokAttemptLimiter,
  type TikTokClock,
  type TikTokCommentRecord,
  type TikTokConnection,
  type TikTokConsentCheck,
  type TikTokSettings,
  type WebcastFactory,
} from '../tiktok/index.ts'
import type { Draft, Rejection, ScopeWriter, TxHookContext } from '../writer.ts'
import { tiktokChatFields } from './chat.ts'
import { TIKTOK_NOTICE, TIKTOK_NOTICE_VERSION, type TikTokNotice } from './notice.ts'
import {
  bumpTiktokCounter,
  consentByRequest,
  deleteTiktokId,
  endTiktokLinks,
  findTiktokId,
  findTiktokLink,
  insertConsent,
  insertTiktokLink,
  lastConsent,
  latestTiktokLink,
  markSaveFailedSeen,
  markStarted,
  resumableTiktokLinks,
  saveTiktokId,
  sellerOpenTiktokLink,
  tiktokChatStats,
  unlinkTiktokLink,
  type TiktokLinkRow,
} from './store.ts'
import { findRequest, insertRequest } from '../instagram/store.ts'

/** 라이브러리 2.1.0이 스스로 읽는 환경 변수 — 하나라도 비어 있지 않으면 틱톡을 끈 것으로 본다 (D-N2b-2-06) */
export const TIKTOK_LIBRARY_ENV_NAMES = ['SIGN_API_URL', 'SIGN_API_KEY', 'WHITELIST_AUTHENTICATED_SESSION_ID_HOST'] as const

/** 다시 연결은 판매자마다 이만큼에 한 번 (D-N2b-2-05) */
export const TIKTOK_RECONNECT_MS = 30_000
/** 한 번에 기록하는 댓글 수 상한 (받은 순서대로 묶어 한 트랜잭션) */
export const TIKTOK_RECORD_BATCH = 200
/**
 * 저장 실패 때 다시 쓰기 전 기다림 (ms) — 바로 한 번, 그 뒤 이 간격으로 더 (RA-N2b-2-02).
 * 틱톡은 다시 가져올 수 없어 짧은 DB 끊김에 묶음을 버리지 않는다. 기다리는 동안 새 댓글은 대기열 뒤에 쌓여 받은 순서가 지켜진다
 */
/** 연결 보기의 수(integer 열)가 담을 수 있는 가장 큰 값 — 확인 요청의 upTo를 여기까지로 자른다 */
export const TIKTOK_COUNTER_MAX = 2_147_483_647
export const TIKTOK_SAVE_RETRY_MS: readonly number[] = [0, 300, 1_500]
/** 저장하지 못한 댓글이 있을 때 함께 보일 문장 (알림 줄·"댓글 붙여넣기" 주 단추가 같이 뜬다) */
export const tiktokSaveFailedMessage = (count: number): string => `저장하지 못한 틱톡 댓글이 ${String(count)}개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.`

/** 판매자에게 그대로 보이는 문장 (AC-N2b-2-04·21·24·30·31·34) */
export const TIKTOK_MESSAGES = {
  REHEARSAL: '리허설 방송에는 라이브를 이을 수 없어요.',
  ENDED: '끝난 방송에는 라이브를 이을 수 없어요.',
  ALREADY_LINKED: '이 방송에는 이미 틱톡 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.',
  PLATFORM_NOT_READY: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.',
  NO_CONSENT: '틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.',
  NO_TIKTOK_ID: '설정에서 내 틱톡 아이디를 먼저 넣어 주세요.',
  TIKTOK_IN_USE: '이미 다른 방송에 틱톡이 이어져 있어요. 먼저 그 방송의 틱톡 연결을 끊어 주세요.',
  RECEIVED_TIME_NOT_ALLOWED: "틱톡 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요.",
  NOT_LINKED: '이어진 틱톡 라이브가 없어요.',
  TOO_SOON: '잠시 뒤 다시 눌러 주세요.',
  TIKTOK_LINKED: '먼저 틱톡 연결을 끊어 주세요.',
  NOTICE_CHANGED: '안내가 바뀌었어요. 새 안내를 읽고 다시 켜 주세요.',
  /** 운영자 스위치 꺼짐 — 설정 화면 (AC-N2b-2-25) */
  OPERATOR_OFF: '지금은 틱톡 연결을 쓸 수 없어요.',
  RECEIVED_TIME: '틱톡 라이브는 댓글마다의 시각이 없어 실제 시각순으로 판정할 수 없어요.',
  THANKS: '틱톡에는 감사 메시지를 보내지 않아요.',
  FINISHED: '방송을 끝내 댓글 기록을 마쳤어요.',
} as const

export type TikTokLinkCode = keyof typeof TIKTOK_MESSAGES

/** 틱톡 연결의 수집 상태 (연결 모듈 상태 + 이 회차에 기록한 수) */
export interface TikTokCollectionView {
  /** 연결 모듈 상태 (IDLE·CONNECTING·CONNECTED·RETRYING·STOPPED·ENDED·OFF) — 회차를 끝냈으면 FINISHED */
  readonly state: string
  readonly reason: string | null
  readonly message: string
  readonly failures: number
  readonly nextAttemptAt: string | null
  readonly missed: boolean
  /** missed일 때 함께 보일 문장 */
  readonly missedMessage: string | null
  /** 이 회차에 기록한 틱톡 댓글 수·마지막으로 기록한 시각 */
  readonly comments: number
  readonly lastCommentAt: string | null
  /** 이어진 동안이 아니라(끊는 중·끝낸 뒤) 기록하지 않은 댓글 수 · 저장하지 못한 댓글 수 */
  readonly notRecorded: number
  readonly saveFailed: number
  /** 판매자가 "확인했어요"로 본 저장 실패 수 (D-N2b-2-16) — 저장 실패 알림은 saveFailed > saveFailedSeen일 때만 */
  readonly saveFailedSeen: number
  /** 엔진 입력 검사에 걸려 기록하지 않은 댓글 수 (D-N2b-2-17) — 운영 확인용, 화면에 보이지 않는다 */
  readonly skipped: number
}

/** 회차의 틱톡 연결 보기 (AC-N2b-2-31) */
export interface TikTokLinkView {
  readonly broadcast: string
  readonly platform: 'TIKTOK'
  readonly state: 'NONE' | 'LINKED'
  readonly linkedAt: string | null
  readonly actor: { readonly kind: 'account'; readonly loginId: string | null } | null
  /** 이을 때의 틱톡 아이디 */
  readonly tiktokId: string | null
  readonly collection: TikTokCollectionView | null
}

/** 설정의 "틱톡 라이브(베타)" (AC-N2b-2-21) */
export interface TikTokSettingsView {
  /** 운영자 스위치가 켜졌는지 (라이브러리 환경 변수가 있으면 꺼짐) */
  readonly operator: boolean
  readonly operatorMessage: string | null
  readonly notice: TikTokNotice
  readonly consent: { readonly on: boolean; readonly at: string; readonly version: string | null } | null
  readonly tiktokId: string | null
}

export interface TikTokLiveOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  /** 판매자마다 한 줄 (라이브 연결 공통 — 인스타그램과 같은 것) */
  readonly locks: SellerLocks
  /** readTikTokSettings(process.env) — 서버 시작 때 한 번 읽은 것 (없으면 꺼짐) */
  readonly settings?: TikTokSettings
  /** 비어 있지 않은 라이브러리 환경 변수 이름 (TIKTOK_LIBRARY_ENV_NAMES 중) */
  readonly libraryEnv?: readonly string[]
  /** 웹캐스트 클라이언트를 만드는 곳 (운영: libraryWebcast(), 시험·E2E: FakeWebcast#factory) */
  readonly webcast: WebcastFactory
  /** 연결 객체의 시계·타이머 (기본: 서버 시계 + 실제 타이머) */
  readonly tiktokClock?: TikTokClock
  /** 서버 전체 연결 시도 한도 (기본 60초에 30번) */
  readonly limiter?: TikTokAttemptLimiter
  /** 실시간 알림 (SSE event: tiktok) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 지금 고지 판 (시험만 바꾼다) */
  readonly noticeVersion?: string
}

interface Entry {
  readonly sellerId: string
  readonly linkId: number
  readonly broadcastId: string
  readonly date: string
  readonly conn: TikTokConnection
  /** 받은 순서대로 기록할 레코드 */
  readonly pending: TikTokCommentRecord[]
  draining: boolean
  /** 끊었거나 회차를 끝내 버린 연결 (남은 레코드는 기록하지 않고 센다) */
  closed: boolean
}

const fail = (status: number, code: TikTokLinkCode | 'NOT_FOUND', message?: string): LinkOutcome => ({
  status,
  body: { error: { code, message: message ?? (code === 'NOT_FOUND' ? '찾을 수 없어요.' : TIKTOK_MESSAGES[code]) } },
})
const notFound = fail(404, 'NOT_FOUND')
const rejection = (status: number, code: Rejection['code'], message: string): Rejection => ({ status, code, message, problems: [] })

function systemClockOf(clock: Clock): TikTokClock {
  return {
    now: () => clock.now(),
    setTimer(ms, fn) {
      const handle = setTimeout(fn, ms)
      handle.unref?.()
      return () => clearTimeout(handle)
    },
  }
}

export class TikTokLive {
  readonly #options: TikTokLiveOptions
  readonly #settings: TikTokSettings
  readonly #clock: TikTokClock
  readonly #limiter: TikTokAttemptLimiter
  readonly #noticeVersion: string
  /** 판매자마다 연결 객체 하나 */
  readonly #entries = new Map<string, Entry>()
  /** 버린 연결의 남은 기록 (끝날 때까지 기다린다 — 시험·종료) */
  readonly #draining = new Set<Promise<void>>()
  #closed = false
  readonly operatorOn: boolean

  constructor(options: TikTokLiveOptions) {
    this.#options = options
    const settings = options.settings ?? TIKTOK_SETTINGS_OFF
    const libraryEnv = options.libraryEnv ?? []
    if (settings.warning !== null) options.log({ level: 'warn', code: 'TIKTOK_BETA_INVALID' })
    for (const name of libraryEnv) options.log({ level: 'warn', code: 'TIKTOK_LIBRARY_ENV', reason: name })
    this.operatorOn = settings.beta && libraryEnv.length === 0
    // 라이브러리 환경 변수가 있으면 스위치가 켜져 있어도 꺼진 것으로 넘긴다 — 이어 둔 연결은 OFF/OPERATOR_OFF, 바깥 연결 없음
    this.#settings = this.operatorOn ? settings : Object.freeze({ ...settings, beta: false })
    this.#clock = options.tiktokClock ?? systemClockOf(options.clock)
    this.#limiter = options.limiter ?? createTikTokAttemptLimiter()
    this.#noticeVersion = options.noticeVersion ?? TIKTOK_NOTICE_VERSION
  }

  #now(): Date {
    return new Date(this.#options.clock.now())
  }

  // ── 능력·고지·동의·아이디 ───────────────────────────────────────────────

  /** GET /api/platforms의 TIKTOK (AC-N2b-2-04) */
  capability(): PlatformCapability {
    return {
      platform: 'TIKTOK',
      ready: this.operatorOn,
      receivedTime: false,
      thanks: 'NONE',
      videoComment: false,
      reasons: {
        ...(this.operatorOn ? {} : { ready: TIKTOK_MESSAGES.PLATFORM_NOT_READY }),
        receivedTime: TIKTOK_MESSAGES.RECEIVED_TIME,
        thanks: TIKTOK_MESSAGES.THANKS,
        videoComment: TIKTOK_MESSAGES.THANKS,
      },
    }
  }

  get notice(): TikTokNotice {
    return this.#noticeVersion === TIKTOK_NOTICE_VERSION ? TIKTOK_NOTICE : { ...TIKTOK_NOTICE, version: this.#noticeVersion }
  }

  async settingsView(sellerId: string, db: Db = this.#options.db): Promise<TikTokSettingsView> {
    const consent = await lastConsent(db, sellerId)
    return {
      operator: this.operatorOn,
      operatorMessage: this.operatorOn ? null : TIKTOK_MESSAGES.OPERATOR_OFF,
      notice: this.notice,
      consent: consent === null ? null : { on: consent.on, at: consent.at.toISOString(), version: consent.noticeVersion },
      tiktokId: await findTiktokId(db, sellerId),
    }
  }

  /** 동의 확인 (연결 모듈에 넘긴다): 그 판매자의 마지막 기록이 "켬"이고 판이 지금 판일 때만 true. DB 오류는 거부(모듈이 동의 없음으로 본다) */
  readonly consentCheck: TikTokConsentCheck = async (sellerId) => {
    const consent = await lastConsent(this.#options.db, sellerId)
    return consent !== null && consent.on && consent.noticeVersion === this.#noticeVersion
  }

  /** 켜기·끄기 (AC-N2b-2-21·23): 한 줄씩 쌓는다. 끄면 응답 전에 그 판매자의 연결을 멈춘다(OFF/NO_CONSENT) */
  async setConsent(sellerId: string, accountId: string, requestId: string, on: boolean, version: unknown): Promise<LinkOutcome> {
    const respond = async (): Promise<LinkOutcome> => ({ status: 200, body: { tiktok: await this.settingsView(sellerId) } })
    if ((await consentByRequest(this.#options.db, sellerId, requestId)) !== null) return respond()
    if (on && version !== this.#noticeVersion) return fail(409, 'NOTICE_CHANGED')
    const inserted = await this.#options.locks.run(sellerId, async () => {
      if ((await consentByRequest(this.#options.db, sellerId, requestId)) !== null) return false
      await insertConsent(this.#options.db, { sellerId, accountId, on, noticeVersion: on ? this.#noticeVersion : null, requestId, at: this.#now() })
      return true
    })
    if (inserted && !on) {
      const entry = this.#entries.get(sellerId)
      if (entry !== undefined) entry.conn.off('NO_CONSENT')
    }
    return respond()
  }

  /** 틱톡 아이디 저장·지우기 (AC-N2b-2-24): 해석은 바깥에 묻지 않는다. 이어진 틱톡 연결이 있으면 바꿀 수 없다 */
  async setTiktokId(sellerId: string, accountId: string, input: unknown): Promise<LinkOutcome> {
    let tiktokId: string | null = null
    if (input !== null) {
      const checked = checkTikTokTarget(input)
      if (!checked.ok) return { status: 400, body: { error: { code: 'INVALID_TIKTOK_ID', message: checked.message, problems: [{ field: 'tiktokId', message: checked.message }] } } }
      tiktokId = checked.target.uniqueId
    }
    return this.#options.locks.run(sellerId, async () =>
      this.#options.db.transaction(async (tx): Promise<LinkOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        if ((await sellerOpenTiktokLink(tx, sellerId)) !== null) return fail(409, 'TIKTOK_LINKED')
        if (tiktokId === null) await deleteTiktokId(tx, sellerId)
        else await saveTiktokId(tx, sellerId, tiktokId, accountId, this.#now())
        return { status: 200, body: { tiktok: await this.settingsView(sellerId, tx) } }
      }),
    )
  }

  // ── 연결 보기 ─────────────────────────────────────────────────────────

  async #viewOf(sellerId: string, broadcastId: string, link: TiktokLinkRow | null, db: Db = this.#options.db): Promise<TikTokLinkView> {
    if (link === null || link.state === 'UNLINKED') return { broadcast: broadcastId, platform: 'TIKTOK', state: 'NONE', linkedAt: null, actor: null, tiktokId: null, collection: null }
    const stats = await tiktokChatStats(db, sellerId, broadcastId)
    const entry = this.#entries.get(sellerId)
    const status = link.state === 'LINKED' && entry !== undefined && entry.linkId === link.id ? entry.conn.status() : null
    const counts = {
      comments: stats.count,
      lastCommentAt: stats.lastAt === null ? null : stats.lastAt.toISOString(),
      notRecorded: link.notRecorded,
      saveFailed: link.saveFailed,
      saveFailedSeen: link.saveFailedSeen,
      skipped: link.skipped,
    }
    // 판매자가 아직 확인하지 않은 저장 실패가 있으면 끊긴 동안과 같이 "받지 못했을 수 있음"을 켠다 — 판매자가 붙여넣기로 채운다
    // (RA-N2b-2-02). 문장의 수 = 확인하지 않은 수 (D-N2b-2-16)
    const unseen = Math.max(0, link.saveFailed - link.saveFailedSeen)
    const lost = unseen > 0
    const lostMessage = lost ? tiktokSaveFailedMessage(unseen) : null
    let collection: TikTokCollectionView
    if (link.state === 'ENDED') {
      collection = { state: 'FINISHED', reason: null, message: TIKTOK_MESSAGES.FINISHED, failures: 0, nextAttemptAt: null, missed: false, missedMessage: null, ...counts }
    } else if (status === null) {
      collection = { state: 'IDLE', reason: null, message: '틱톡에 아직 연결하지 않았어요.', failures: 0, nextAttemptAt: null, missed: lost, missedMessage: lostMessage, ...counts }
    } else {
      collection = {
        state: status.state,
        reason: status.reason,
        message: status.message,
        failures: status.failures,
        nextAttemptAt: status.nextAttemptAt,
        missed: status.missed || lost,
        missedMessage: lostMessage ?? (status.missed ? TIKTOK_MISSED_MESSAGE : null),
        ...counts,
      }
    }
    return {
      broadcast: broadcastId,
      platform: 'TIKTOK',
      state: 'LINKED',
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: 'account', loginId: link.actorLoginId },
      tiktokId: link.tiktokId,
      collection,
    }
  }

  /** 회차의 틱톡 연결 (다른 판매자·없는 회차면 null — 404) */
  async view(sellerId: string, broadcastId: string): Promise<TikTokLinkView | null> {
    if ((await findBroadcast(this.#options.db, sellerId, broadcastId)) === null) return null
    return this.#viewOf(sellerId, broadcastId, await latestTiktokLink(this.#options.db, sellerId, broadcastId))
  }

  /** 판매자의 끊지 않은 틱톡 연결 (이어진 것 — 많아야 하나) */
  async list(sellerId: string): Promise<TikTokLinkView[]> {
    const link = await sellerOpenTiktokLink(this.#options.db, sellerId)
    return link === null ? [] : [await this.#viewOf(sellerId, link.broadcastId, link)]
  }

  #publish(sellerId: string, broadcastId: string): void {
    if (this.#closed) return
    void this.view(sellerId, broadcastId)
      .then((link) => {
        if (link !== null) this.#options.publish(sellerId, { kind: 'LINK', broadcast: broadcastId, link })
      })
      .catch(() => undefined)
  }

  // ── 잇기·끊기·다시 연결 ────────────────────────────────────────────────

  async #prior(sellerId: string, requestId: string): Promise<LinkOutcome | null> {
    const stored = await findRequest(this.#options.db, sellerId, requestId)
    return stored === null ? null : (JSON.parse(stored) as LinkOutcome)
  }

  /** 틱톡 잇기 (AC-N2b-2-30): 받으면 연결을 만들고 바로 start() */
  async link(sellerId: string, accountId: string, requestId: string, broadcastId: string): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let created: { linkId: number; date: string; tiktokId: string } | null = null
    const outcome = await this.#options.locks.run(sellerId, async () => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const broadcast = await findBroadcast(this.#options.db, sellerId, broadcastId)
      if (broadcast === null) return notFound
      if (broadcast.rehearsal) return fail(409, 'REHEARSAL')
      if (broadcast.endedAt !== null) return fail(409, 'ENDED')
      // 그 회차의 설정 스냅샷 (broadcast.start) — 바깥에 묻기 전에 읽는다
      const state = (await this.#options.writer.read(sellerId, broadcast.date, false)).state
      const receivedTime = getBroadcast(state, broadcastId)?.settings['contention.policy'] === 'RECEIVED_TIME'
      return this.#options.db.transaction(async (tx): Promise<LinkOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        const current = await findBroadcast(tx, sellerId, broadcastId)
        if (current === null) return notFound
        if (current.endedAt !== null) return fail(409, 'ENDED')
        const open = await sellerOpenTiktokLink(tx, sellerId)
        if (open !== null && open.broadcastId === broadcastId) return fail(409, 'ALREADY_LINKED')
        if (!this.operatorOn) return fail(409, 'PLATFORM_NOT_READY')
        if (!(await this.#consentIn(tx, sellerId))) return fail(409, 'NO_CONSENT')
        const tiktokId = await findTiktokId(tx, sellerId)
        if (tiktokId === null) return fail(409, 'NO_TIKTOK_ID')
        if (open !== null) return fail(409, 'TIKTOK_IN_USE')
        if (receivedTime) return fail(409, 'RECEIVED_TIME_NOT_ALLOWED')
        const now = this.#now()
        const linkId = await insertTiktokLink(tx, { sellerId, broadcastId, scopeId: current.scopeId, tiktokId, actorAccountId: accountId, now })
        const view = await this.#viewOf(sellerId, broadcastId, await findTiktokLink(tx, sellerId, linkId), tx)
        const result: LinkOutcome = { status: 200, body: { link: { ...view, collection: view.collection === null ? null : { ...view.collection, state: 'CONNECTING', message: '틱톡에 연결하는 중이에요.' } } } }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
        created = { linkId, date: current.date, tiktokId }
        return result
      })
    })
    const made = created as { linkId: number; date: string; tiktokId: string } | null
    if (made !== null) {
      const entry = this.#open(sellerId, made.linkId, broadcastId, made.date, made.tiktokId)
      entry?.conn.start()
      this.#publish(sellerId, broadcastId)
    }
    return outcome
  }

  async #consentIn(db: Db, sellerId: string): Promise<boolean> {
    const consent = await lastConsent(db, sellerId)
    return consent !== null && consent.on && consent.noticeVersion === this.#noticeVersion
  }

  /** 연결 객체를 만든다 (판매자마다 하나 — 앞 것이 있으면 멈추고 버린다) */
  #open(sellerId: string, linkId: number, broadcastId: string, date: string, tiktokId: string): Entry | null {
    const checked = checkTikTokTarget(tiktokId)
    if (!checked.ok) {
      this.#options.log({ level: 'warn', code: 'TIKTOK_RESUME_FAILED', seller: sellerId })
      return null
    }
    this.#retire(sellerId)
    const pending: TikTokCommentRecord[] = []
    let entry: Entry | null = null
    const conn = createTikTokConnection({
      sellerId,
      target: checked.target,
      webcast: this.#options.webcast,
      // 연결 모듈은 받은 순서대로 동기적으로 부르고 기다리지 않는다 — 판매자마다 받은 순서대로 줄을 세워 기록한다 (AC-N2b-2-37)
      onRecord: (record) => {
        pending.push(record)
        if (entry !== null) this.#drain(entry)
      },
      onStatus: () => this.#publish(sellerId, broadcastId),
      settings: this.#settings,
      consent: this.consentCheck,
      clock: this.#clock,
      log: this.#options.log,
      limiter: this.#limiter,
    })
    entry = { sellerId, linkId, broadcastId, date, conn, pending, draining: false, closed: false }
    this.#entries.set(sellerId, entry)
    return entry
  }

  /** 판매자의 연결 객체를 멈추고 버린다 (남은 레코드는 기록 트랜잭션이 연결 상태를 다시 보고 센다) */
  #retire(sellerId: string, linkId?: number): void {
    const entry = this.#entries.get(sellerId)
    if (entry === undefined || (linkId !== undefined && entry.linkId !== linkId)) return
    entry.closed = true
    entry.conn.stop()
    this.#entries.delete(sellerId)
  }

  /** 틱톡 연결 끊기 (AC-N2b-2-32): 범위 락 안에서 끊고 stop(). 같은 판매자가 다른 회차를 이을 수 있다 */
  async unlink(sellerId: string, accountId: string, requestId: string, broadcastId: string): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let unlinked: number | null = null
    const outcome = await this.#options.locks.run(sellerId, async () => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const broadcast = await findBroadcast(this.#options.db, sellerId, broadcastId)
      if (broadcast === null) return notFound
      // 범위 락 → 판매자 잠금 (기록 트랜잭션과 같은 순서) — 어느 서버의 기록이든 끊기와 겹치지 않는다
      return this.#options.db.transaction(async (tx): Promise<LinkOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, broadcast.date, broadcast.rehearsal)})`)
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        const link = await latestTiktokLink(tx, sellerId, broadcastId)
        if (link === null || link.state === 'UNLINKED') return fail(409, 'NOT_LINKED')
        const now = this.#now()
        await unlinkTiktokLink(tx, sellerId, link.id, accountId, now)
        const result: LinkOutcome = { status: 200, body: { link: await this.#viewOf(sellerId, broadcastId, null, tx) } }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
        unlinked = link.id
        return result
      })
    })
    const linkId = unlinked as number | null
    if (linkId !== null) {
      this.#retire(sellerId, linkId)
      this.#publish(sellerId, broadcastId)
    }
    return outcome
  }

  /** 다시 연결 (AC-N2b-2-34): 판매자마다 30초에 한 번. 운영자 스위치·동의는 모듈이 다시 본다 */
  async reconnect(sellerId: string, broadcastId: string): Promise<LinkOutcome> {
    return this.#options.locks.run(sellerId, async () => {
      const broadcast = await findBroadcast(this.#options.db, sellerId, broadcastId)
      if (broadcast === null) return notFound
      const link = await latestTiktokLink(this.#options.db, sellerId, broadcastId)
      if (link === null || link.state !== 'LINKED') return fail(409, link?.state === 'ENDED' ? 'ENDED' : 'NOT_LINKED')
      const now = this.#now()
      if (!(await markStarted(this.#options.db, sellerId, link.id, now, new Date(now.getTime() - TIKTOK_RECONNECT_MS)))) return fail(409, 'TOO_SOON')
      let entry = this.#entries.get(sellerId)
      if (entry === undefined || entry.linkId !== link.id) entry = this.#open(sellerId, link.id, broadcastId, broadcast.date, link.tiktokId) ?? undefined
      entry?.conn.start()
      this.#publish(sellerId, broadcastId)
      return { status: 200, body: { link: await this.#viewOf(sellerId, broadcastId, await findTiktokLink(this.#options.db, sellerId, link.id)) } }
    })
  }

  /**
   * 저장 실패 확인 (AC-N2b-2-74, D-N2b-2-16): saveFailedSeen = max(지금, min(upTo, saveFailed)). 같은 요청 두 번 = 같은 결과.
   * 다른 판매자·없는 회차 404, 이어진 틱톡 연결이 없으면 409 NOT_LINKED. 바꾼 뒤 SSE로 보기를 보낸다
   */
  async markSaveFailedSeen(sellerId: string, broadcastId: string, upTo: number): Promise<LinkOutcome> {
    const broadcast = await findBroadcast(this.#options.db, sellerId, broadcastId)
    if (broadcast === null) return notFound
    const linkId = await markSaveFailedSeen(this.#options.db, sellerId, broadcastId, Math.min(upTo, TIKTOK_COUNTER_MAX))
    if (linkId === null) return fail(409, 'NOT_LINKED')
    this.#publish(sellerId, broadcastId)
    return { status: 200, body: { link: await this.#viewOf(sellerId, broadcastId, await findTiktokLink(this.#options.db, sellerId, linkId)) } }
  }

  // ── 회차를 끝내면 멈춤 (기록 경로 txHook) ──────────────────────────────

  /**
   * 기록 트랜잭션 안 (ScopeWriter txHook): broadcast.end가 기록되면 그 회차의 이어진 틱톡 연결을 ENDED로 바꾸고(같이 커밋),
   * 커밋된 뒤(응답 전) 연결 객체를 멈춘다 (AC-N2b-2-33)
   */
  readonly txHook = async (tx: Db, ctx: TxHookContext): Promise<(() => void) | null> => {
    if (ctx.rehearsal) return null
    const ended = ctx.records.filter((record) => record.type === 'broadcast.end' && record.changed).map((record) => (record.event as unknown as { b: string }).b)
    if (ended.length === 0) return null
    const ids = await endTiktokLinks(tx, ctx.sellerId, ended, ctx.now)
    if (ids.length === 0) return null
    return () => {
      for (const id of ids) this.#retire(ctx.sellerId, id)
      for (const b of ended) this.#publish(ctx.sellerId, b)
    }
  }

  // ── 레코드 → chat (AC-N2b-2-37·50~53) ────────────────────────────────────

  #drain(entry: Entry): void {
    if (entry.draining) return
    entry.draining = true
    const run = (async () => {
      try {
        while (entry.pending.length > 0) {
          const batch = entry.pending.splice(0, TIKTOK_RECORD_BATCH)
          await this.#record(entry, batch)
        }
      } finally {
        entry.draining = false
      }
    })()
    this.#draining.add(run)
    void run.finally(() => this.#draining.delete(run))
  }

  /** 받은 순서대로 한 트랜잭션에 기록한다. 이어진 동안·끝나지 않은 회차만 — 아니면 기록하지 않고 센다 */
  async #record(entry: Entry, batch: readonly TikTokCommentRecord[]): Promise<void> {
    const { sellerId, linkId, broadcastId: b, date } = entry
    /**
     * 기록하려던 수 (이미 기록된 같은 메시지 ID를 뺀 것, AC-N2b-2-52) — build가 돈 시도에서만 정해진다(아니면 null).
     * 기록한 수와의 차 = 엔진 입력 검사로 건너뛴 수(skipIfInvalid, D-N2b-2-17)
     */
    let drafted: number | null = null
    const write = () => {
      drafted = null
      return this.#options.writer.write({
        sellerId,
        date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        chatBatch: { b, ids: batch.map((record) => tiktokChatFields(record).id) },
        guard: async (tx) => {
          const link = await findTiktokLink(tx, sellerId, linkId)
          return link !== null && link.state === 'LINKED' ? null : rejection(409, 'NOT_LINKED', TIKTOK_MESSAGES.NOT_LINKED)
        },
        build: (ctx) => {
          if (getBroadcast(ctx.state, b)?.ended === true) return rejection(409, 'BROADCAST_ENDED', TIKTOK_MESSAGES.FINISHED)
          const seen = new Set(ctx.existingChats)
          const drafts: Draft[] = []
          for (const record of batch) {
            const fields = tiktokChatFields(record)
            // 같은 (회차, tt: 메시지 ID)가 이미 기록돼 있으면 다시 기록하지 않는다 — 모듈 기억(2만 개) 밖 중복의 2차 방어 (AC-N2b-2-52)
            if (seen.has(fields.id)) continue
            seen.add(fields.id)
            drafts.push({ fields: { type: 'chat', b, ...fields }, actor: { kind: 'collector' }, chat: { b, id: fields.id }, skipIfInvalid: true })
          }
          drafted = drafts.length
          return drafts
        },
      })
    }
    let outcome = await write()
    // 락 밖 경합(다른 쪽이 같은 메시지를 먼저 기록)·저장 실패는 다시 — 경합이면 이미 기록된 것으로 빠진다.
    // 저장 실패는 잠깐 기다렸다가 몇 번 더 (짧은 DB 끊김에 선착순 찜을 버리지 않는다, RA-N2b-2-02)
    for (const wait of TIKTOK_SAVE_RETRY_MS) {
      if (outcome.kind !== 'duplicate' && outcome.kind !== 'save_failed') break
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
      outcome = await write()
    }
    try {
      const built = drafted as number | null
      if (outcome.kind === 'ok' || outcome.kind === 'empty') {
        // 기록하지 않은 나머지는 입력 검사로 건너뛴 것 — notRecorded(끊기·끝내기 뒤)와 따로 센다 (D-N2b-2-17, AC-N2b-2-75)
        const skipped = (built ?? 0) - (outcome.kind === 'ok' ? outcome.records.length : 0)
        if (skipped > 0) {
          this.#options.log({ level: 'warn', code: 'TIKTOK_SKIPPED', seller: sellerId, count: skipped })
          await bumpTiktokCounter(this.#options.db, sellerId, linkId, 'skipped', skipped)
        }
      } else if (outcome.kind === 'rejected' || outcome.kind === 'not_found') {
        // 끊기·끝내기 뒤가 된 댓글 (AC-N2b-2-51). 이미 기록된 같은 메시지 ID는 세지 않는다 (AC-N2b-2-52)
        await bumpTiktokCounter(this.#options.db, sellerId, linkId, 'notRecorded', await this.#unrecorded(sellerId, b, batch))
      } else if (outcome.kind === 'save_failed' || outcome.kind === 'duplicate') {
        this.#options.log({ level: 'error', code: 'TIKTOK_SAVE_FAILED', seller: sellerId, count: batch.length })
        await bumpTiktokCounter(this.#options.db, sellerId, linkId, 'saveFailed', batch.length)
        // 판매자가 알게 한다: 화면이 "받지 못했을 수 있음" 알림 줄·"댓글 붙여넣기" 주 단추를 띄운다
        this.#publish(sellerId, b)
      }
    } catch (error) {
      this.#options.log({ level: 'error', code: 'TIKTOK_SAVE_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  /** 묶음 중 아직 기록되지 않은 서로 다른 메시지 수 (이미 기록된 같은 메시지 ID·묶음 안의 겹침은 빼고) */
  async #unrecorded(sellerId: string, b: string, batch: readonly TikTokCommentRecord[]): Promise<number> {
    const ids = [...new Set(batch.map((record) => tiktokChatFields(record).id))]
    const existing = await existingChatIds(this.#options.db, sellerId, b, ids)
    return ids.filter((id) => !existing.has(id)).length
  }

  /** 기록 대기열이 빌 때까지 (시험·종료) */
  async idle(): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      const pending = [...this.#draining]
      const waiting = [...this.#entries.values()].some((entry) => entry.pending.length > 0)
      if (pending.length === 0 && !waiting) return
      await Promise.allSettled(pending)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  // ── 서버 시작·종료 ───────────────────────────────────────────────────

  /**
   * 서버가 다시 켜지면 이어받기 (AC-N2b-2-35, NFR-03): 끝나지 않은 실제 회차의 이어진 틱톡 연결마다 연결 객체를 만들어 resume()
   * ("끊긴 동안 받지 못했을 수 있음" 켬). 운영자 꺼짐·동의 없음이면 모듈이 바깥 연결 없이 OFF로 둔다
   */
  async resume(): Promise<number> {
    let resumed = 0
    try {
      for (const link of await resumableTiktokLinks(this.#options.db)) {
        if (this.#closed) break
        const broadcast = await findBroadcast(this.#options.db, link.sellerId, link.broadcastId)
        if (broadcast === null || broadcast.rehearsal || broadcast.endedAt !== null) continue
        const entry = this.#open(link.sellerId, link.id, link.broadcastId, broadcast.date, link.tiktokId)
        if (entry === null) continue
        entry.conn.resume()
        resumed += 1
      }
    } catch (error) {
      this.#options.log({ level: 'error', code: 'TIKTOK_RESUME_FAILED', errorKind: errorKind(error) })
    }
    return resumed
  }

  /** 연결 객체 수 (시험·운영 상태) */
  get connections(): number {
    return this.#entries.size
  }

  /** 운영 상태: 연결 모듈 상태별 수 (판매자 정보 없이) */
  stateCounts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const entry of this.#entries.values()) {
      const state = entry.conn.status().state
      out[state] = (out[state] ?? 0) + 1
    }
    return out
  }

  close(): void {
    this.#closed = true
    for (const sellerId of [...this.#entries.keys()]) this.#retire(sellerId)
  }
}
