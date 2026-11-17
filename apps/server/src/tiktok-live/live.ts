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
  type TikTokConnectionStatus,
  type TikTokConsentCheck,
  type TikTokSettings,
  type WebcastFactory,
  createTikTokSignMeter,
  TIKTOK_SIGN_MESSAGES,
  type TikTokSignMeter,
  fetchShortLinkResolver,
  type ShortLinkResolver,
  fetchTikTokAvatar,
  type TikTokAvatarFetch,
} from '../tiktok/index.ts'
import type { Draft, Rejection, ScopeWriter, TxHookContext } from '../writer.ts'
import type { OwnThanks } from './thanks/own.ts'
import { tiktokChatFields } from './chat.ts'
import { extensionViewOf, type TikTokExtensionView } from './extension.ts'
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
import { activeToken } from '../extension/store.ts'

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
/**
 * 틱톡 라이브가 끝났다는 첫 신호 뒤, 끝났음을 한 번 더 확인하기까지 (D-LIVE-AUTOEND → D-TT-END-01).
 * 첫 신호 = 방송 끝(STREAM_END) 또는 받던 라이브가 끊긴 뒤 틱톡 방 상태가 "방송 중 아님"(NOT_LIVE). 이만큼 뒤에 시작한 방 상태 확인이
 * 다시 "방송 중 아님"이면 회차를 끝낸다. 그 사이 한 번이라도 다시 받는 중(CONNECTED)이 되면 취소한다 — 판매자가 틱톡을 껐다 바로 새로 켜는 일
 * (2026-11-16 23:46:35 끝 → 23:47:10 새 방송, 35초)은 끝내지 않는다. 옛 5분 기다림은 판매자가 "자동으로 안 끝난다"고 느낄 만큼 길었다
 */
export const TIKTOK_AUTO_END_CONFIRM_MS = 60_000
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
  /** 링크로 잇기에서 틱톡 아이디를 찾지 못함 (D-UX3-14) */
  INVALID_TIKTOK_LINK: '알 수 없는 링크예요.',
  /** 링크로 잇기에서 다른 방송에 틱톡이 이어져 있음 — 화면이 옮길지 묻는다 (D-UX3-17) */
  TIKTOK_ELSEWHERE: '다른 방송에 틱톡이 이어져 있어요. 이 방송으로 옮길까요?',
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
  /** 서명 서비스 하루 한도에 가깝거나 넘었을 때 판매자에게 보일 쉬운 문장 (CH-20) — 아니면 null */
  readonly signNotice: string | null
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
  /** 크롬 확장 쪽 (TTX, D-TTX-09): 받는 길 한 줄·경고·확장 상태·기록 수·대기 수·읽지 못함 수. 연결이 없으면(NONE) null */
  readonly extension: TikTokExtensionView | null
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
  /** 서명 서비스 무료 한도 계량 (없으면 설정의 하루 한도로 만든다 — CH-20) */
  readonly signMeter?: TikTokSignMeter
  /** 실시간 알림 (SSE event: tiktok) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 우리 봇이 올린 틱톡 감사 글 거르개 (D-TT-SEND-06 — 없으면 거르지 않는다) */
  readonly ownThanks?: OwnThanks
  /** 지금 고지 판 (시험만 바꾼다) */
  readonly noticeVersion?: string
  /** 짧은 공유 링크 풀기 (기본: 틱톡에 GET으로 넘겨주는 곳만 따라감 — 시험은 가짜, D-UX3-14) */
  readonly shortLinks?: ShortLinkResolver
  /**
   * 틱톡 방송이 끝나(STREAM_END) 기다림(TIKTOK_AUTO_END_GRACE_MS) 동안 다시 켜지지 않았다 — 회차를 저절로 끝낸다 (D-LIVE-AUTOEND).
   * 없으면 저절로 끝내지 않는다. 던지지 않아야 한다
   */
  readonly onLiveEnded?: (sellerId: string, broadcastId: string) => Promise<unknown>
  /** 틱톡을 이은 뒤 같은 틱톡 라이브에 이은 다른 계정과 상품을 처음 맞춘다 (D-SYNC2-01 — 유튜브 잇기와 같은 catalog.afterLink). 없으면 하지 않는다 */
  readonly syncCatalog?: (sellerId: string, date: string) => Promise<void>
  /** 틱톡 프로필 사진 받기 (D-TT-PHOTO-01, 기본: 틱톡 이미지 서버에서 받음 — 시험은 가짜) */
  readonly avatarFetch?: TikTokAvatarFetch
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
  /** 틱톡이 라이브 끝을 알려 회차를 저절로 끝내려고 확인하는 중 (D-LIVE-AUTOEND·D-TT-END-01) — 없으면 null */
  autoEnd: AutoEndWait | null
  /** 이 연결로 받는 중(CONNECTED)이 된 적이 있다 — 또는 서버가 다시 켜지기 전 이 회차에 틱톡 댓글을 기록했다. 아니면 "방송 중 아님"은 방송 전이다 */
  wasLive: boolean
  /** 끝 확인을 한 번 마쳤다(끝냈거나 끝내지 않기로 함) — 다시 받는 중이 될 때까지 새로 확인하지 않는다(1분마다 같은 로그·질의가 쌓이지 않게) */
  autoEndTried: boolean
  /** 마지막 연결 시도(CONNECTING)를 시작한 시각 — 방 상태 확인 결과가 언제 물은 것인지 */
  attemptAt: number | null
}

/** 저절로 끝내기 확인: 첫 신호 시각·다시 확인 타이머 취소 */
interface AutoEndWait {
  readonly firstAt: number
  cancelCheck: (() => void) | null
}

const fail = (status: number, code: TikTokLinkCode | 'NOT_FOUND', message?: string): LinkOutcome => ({
  status,
  body: { error: { code, message: message ?? (code === 'NOT_FOUND' ? '찾을 수 없어요.' : TIKTOK_MESSAGES[code]) } },
})
const notFound = fail(404, 'NOT_FOUND')
const errorCodeOf = (outcome: LinkOutcome): unknown => (outcome.body as { error?: { code?: unknown } }).error?.code
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
  readonly #signMeter: TikTokSignMeter
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
    this.#signMeter = options.signMeter ?? createTikTokSignMeter(settings.signDailyLimit)
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

  /** 서명 서비스 하루 한도 경보 문장 (서버 전체 수치라 모든 판매자에게 같다) */
  #signNotice(): string | null {
    const level = this.#signMeter.level(this.#clock.now())
    return level === 'OK' ? null : TIKTOK_SIGN_MESSAGES[level]
  }

  async #viewOf(sellerId: string, broadcastId: string, link: TiktokLinkRow | null, db: Db = this.#options.db): Promise<TikTokLinkView> {
    if (link === null || link.state === 'UNLINKED') return { broadcast: broadcastId, platform: 'TIKTOK', state: 'NONE', linkedAt: null, actor: null, tiktokId: null, collection: null, extension: null }
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
      signNotice: this.#signNotice(),
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
    // 확장 쪽: 이어진 연결이고 운영자 스위치·동의가 맞을 때만 "확장으로 받는 중"이 될 수 있다 (D-TTX-06). 상태가 없으면 동의를 묻지 않는다
    const open = link.state === 'LINKED' && link.extStatusAt !== null && this.operatorOn && (await this.#consentIn(db, sellerId))
    // 막혔을 때 확장 안내 (D-TTX-17): 이 회차 확장 상태가 없고, 직접 연결이 막힘·서명 실패로 다시 시도 중이거나 멈췄고, 확장을 이은 판매자
    const blocked = status !== null && ((status.state === 'RETRYING' && (status.reason === 'BLOCKED' || status.reason === 'SIGN_FAILED')) || status.state === 'STOPPED')
    const hintable = link.state === 'LINKED' && link.extStatusAt === null && blocked && (await activeToken(db, sellerId)) !== null
    const extension = extensionViewOf(link, link.state === 'LINKED' && status?.state === 'CONNECTED', open, this.#options.clock.now(), hintable)
    return {
      broadcast: broadcastId,
      platform: 'TIKTOK',
      state: 'LINKED',
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: 'account', loginId: link.actorLoginId },
      tiktokId: link.tiktokId,
      collection,
      extension,
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

  /** 그 연결의 직접 연결 상태 (연결 객체가 없거나 다른 연결이면 null) — 확장 경로가 대기인지 정한다 (D-TTX-07) */
  directState(sellerId: string, linkId: number): string | null {
    const entry = this.#entries.get(sellerId)
    return entry === undefined || entry.linkId !== linkId || entry.closed ? null : entry.conn.status().state
  }

  /** 연결 객체의 시계·타이머 (확장 상태 확인 예약이 같은 시계를 쓴다) */
  get tiktokClock(): TikTokClock {
    return this.#clock
  }

  /** 연결 보기를 알린다 (확장 경로가 상태를 바꿨을 때) */
  publishLink(sellerId: string, broadcastId: string): void {
    this.#publish(sellerId, broadcastId)
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

  /**
   * 링크로 틱톡 잇기 (D-UX3-14): 방송 링크(또는 짧은 공유 링크를 푼 주소)에서 틱톡 아이디를 읽어, 저장한 아이디와 다르면 바꿔 두고 잇는다.
   * 같은 요청 번호는 처음 응답 그대로. 동의·운영자 스위치·회차 검사는 link()와 같다(NO_CONSENT면 화면이 안내를 보이고 동의를 받는다).
   * 다른 방송에 틱톡이 이어져 있으면 TIKTOK_ELSEWHERE — 판매자가 [옮기기]로 move를 보내면 그 연결을 끊고 여기 잇는다 (D-UX3-17)
   */
  /** beforeLink: 아이디를 읽은 뒤 잇기 전에 부른다 — 답이 있으면 잇지 않고 그 답 (같이 보는 라이브에 들어감, D-SHARE-LIVE-01) */
  async linkByUrl(sellerId: string, accountId: string, requestId: string, broadcastId: string, url: unknown, move = false, beforeLink?: (tiktokId: string) => Promise<LinkOutcome | null>): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    if ((await findBroadcast(this.#options.db, sellerId, broadcastId)) === null) return notFound
    const invalid = fail(400, 'INVALID_TIKTOK_LINK')
    let parsed = checkTikTokTarget(url)
    if (!parsed.ok && parsed.error === 'SHORT_LINK' && typeof url === 'string') {
      const opened = await (this.#options.shortLinks ?? fetchShortLinkResolver())(url)
      if (opened === null) return invalid
      parsed = checkTikTokTarget(opened)
    }
    if (!parsed.ok) return invalid
    const instead = await beforeLink?.(parsed.target.uniqueId)
    if (instead !== undefined && instead !== null) return instead
    const open = await sellerOpenTiktokLink(this.#options.db, sellerId)
    if (open !== null && open.broadcastId !== broadcastId) {
      if (!move) return fail(409, 'TIKTOK_ELSEWHERE')
      const off = await this.unlink(sellerId, accountId, `mv-${requestId}`.slice(0, 64), open.broadcastId)
      if (off.status !== 200 && !(off.status === 409 && errorCodeOf(off) === 'NOT_LINKED')) return off
    }
    if ((await findTiktokId(this.#options.db, sellerId)) !== parsed.target.uniqueId) {
      const saved = await this.setTiktokId(sellerId, accountId, parsed.target.uniqueId)
      if (saved.status !== 200) return saved
    }
    return this.link(sellerId, accountId, requestId, broadcastId)
  }

  /** 틱톡 잇기 (AC-N2b-2-30): 받으면 연결을 만들고 바로 start() */
  async link(sellerId: string, accountId: string, requestId: string, broadcastId: string): Promise<LinkOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let created: { linkId: number; date: string; tiktokId: string; draft: boolean } | null = null
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
        created = { linkId, date: current.date, tiktokId, draft: current.openedAt === null }
        return result
      })
    })
    const made = created as { linkId: number; date: string; tiktokId: string; draft: boolean } | null
    // 같은 틱톡 라이브에 먼저 이은 계정이 손으로 고친 상품을 이 계정에도 (D-SYNC2-01 — 유튜브 잇기와 같은 때). 실패해도 잇기는 그대로
    if (made !== null && this.#options.syncCatalog !== undefined) {
      try {
        await this.#options.syncCatalog(sellerId, made.date)
      } catch (error) {
        this.#options.log({ level: 'warn', code: 'CATALOG_SYNC_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
    }
    // 만드는 중인 방송(방송 화면에 들어오기 전)은 잇기만 적어 두고 받기 시작하지 않는다 — 화면에 들어오면 opened()가 시작한다 (D-UX3-27)
    if (made !== null && !made.draft) {
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
  #open(sellerId: string, linkId: number, broadcastId: string, date: string, tiktokId: string, wasLive = false): Entry | null {
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
      onStatus: (status) => {
        this.#publish(sellerId, broadcastId)
        if (entry !== null) this.#watchEnd(entry, status)
      },
      onAvatar: (url) => this.#rememberAvatar(checked.target.uniqueId, url),
      settings: this.#settings,
      consent: this.consentCheck,
      clock: this.#clock,
      log: this.#options.log,
      limiter: this.#limiter,
      signMeter: this.#signMeter,
    })
    entry = { sellerId, linkId, broadcastId, date, conn, pending, draining: false, closed: false, autoEnd: null, wasLive, autoEndTried: false, attemptAt: null }
    this.#entries.set(sellerId, entry)
    return entry
  }

  /** 판매자의 연결 객체를 멈추고 버린다 (남은 레코드는 기록 트랜잭션이 연결 상태를 다시 보고 센다) */
  #retire(sellerId: string, linkId?: number): void {
    const entry = this.#entries.get(sellerId)
    if (entry === undefined || (linkId !== undefined && entry.linkId !== linkId)) return
    entry.closed = true
    this.#clearAutoEnd(entry)
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

  /** 방송 화면에 들어왔다 (D-UX3-27): 만드는 중에 이어 둔 틱톡 연결을 그때 시작한다. 이미 받고 있으면 그대로 */
  async opened(sellerId: string, broadcastId: string): Promise<void> {
    await this.#options.locks.run(sellerId, async () => {
      const broadcast = await findBroadcast(this.#options.db, sellerId, broadcastId)
      if (broadcast === null || broadcast.rehearsal || broadcast.endedAt !== null || broadcast.openedAt === null) return
      const link = await latestTiktokLink(this.#options.db, sellerId, broadcastId)
      if (link === null || link.state !== 'LINKED') return
      const existing = this.#entries.get(sellerId)
      if (existing !== undefined && existing.linkId === link.id) return
      const entry = this.#open(sellerId, link.id, broadcastId, broadcast.date, link.tiktokId, await this.#recordedBefore(sellerId, broadcastId))
      entry?.conn.start()
      this.#publish(sellerId, broadcastId)
    })
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
      if (entry === undefined || entry.linkId !== link.id) entry = this.#open(sellerId, link.id, broadcastId, broadcast.date, link.tiktokId, await this.#recordedBefore(sellerId, broadcastId)) ?? undefined
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

  // ── 틱톡 방송이 끝나면 회차를 저절로 끝냄 (D-LIVE-AUTOEND · D-TT-END-01) ──────

  /**
   * 연결 상태가 바뀔 때마다 (연결 객체 안에서 부른다 — 연결 객체를 다시 부르지 않고 타이머·마이크로태스크로 미룬다).
   * 끝 신호 두 번(1분 넘게 떨어진)이 모두 "끝남"이어야 끝낸다 — 끊김·오류·막힘·서명 실패·멈춤은 신호가 아니다(끝내지도 취소하지도 않는다):
   * - 첫 신호: 방송 끝(STREAM_END → ENDED), 또는 받던 라이브(wasLive)에서 방 상태 확인이 "방송 중 아님"(RETRYING/NOT_LIVE).
   *   틱톡은 끝낼 때 끝 신호 없이 연결만 닫기도 한다(끊김 → 다시 연결 → 방송 중 아님) — 옛 판은 이 길에서 끝내지 않았다.
   * - 확인: 첫 신호 + TIKTOK_AUTO_END_CONFIRM_MS 이후에 시작한 방 상태 확인이 "방송 중 아님"이면 끝낸다. 그때 연결이 쉬고 있으면(끝남·다시 시도 대기) 바로 확인한다.
   * - 받는 중(CONNECTED): 판매자가 방송을 다시 켰다 — 취소한다. 판매자가 틱톡을 끔(OFF)도 취소한다.
   * 이어 둔 뒤 아직 방송을 시작하지 않아 "방송 중 아님"인 것(wasLive가 아님)은 신호가 아니다.
   */
  #watchEnd(entry: Entry, status: TikTokConnectionStatus): void {
    if (this.#closed || entry.closed) return
    const now = this.#clock.now()
    if (status.state === 'CONNECTING') {
      entry.attemptAt = now
      return
    }
    if (status.state === 'CONNECTED') {
      entry.wasLive = true
      entry.autoEndTried = false
      if (entry.autoEnd !== null) {
        this.#clearAutoEnd(entry)
        this.#options.log({ level: 'info', code: 'BROADCAST_AUTO_END_CANCELLED', seller: entry.sellerId })
      }
      return
    }
    if (this.#options.onLiveEnded === undefined) return
    if (status.state === 'OFF') {
      this.#clearAutoEnd(entry)
      return
    }
    const streamEnded = status.state === 'ENDED'
    const notLive = status.state === 'RETRYING' && status.reason === 'NOT_LIVE'
    if (!streamEnded && !notLive) return
    if (entry.autoEndTried || (notLive && !entry.wasLive)) return
    // 방 상태 확인 결과는 그 확인을 시작한 때의 것이다
    const signalAt = notLive ? (entry.attemptAt ?? now) : now
    const wait = entry.autoEnd
    if (wait === null) {
      const made: AutoEndWait = { firstAt: signalAt, cancelCheck: null }
      entry.autoEnd = made
      this.#options.log({ level: 'info', code: 'BROADCAST_AUTO_END_WAITING', seller: entry.sellerId })
      made.cancelCheck = this.#clock.setTimer(Math.max(0, signalAt + TIKTOK_AUTO_END_CONFIRM_MS - now), () => {
        made.cancelCheck = null
        if (entry.autoEnd !== made || entry.closed || this.#closed) return
        // 쉬고 있으면(끝남·다시 시도 대기) 지금 방 상태를 다시 묻는다. 연결 중·받는 중이면 그 결과를 기다린다. 멈춤·꺼짐은 건드리지 않는다
        const state = entry.conn.status().state
        if (state === 'ENDED' || state === 'RETRYING') entry.conn.resume()
      })
      return
    }
    if (notLive && signalAt - wait.firstAt >= TIKTOK_AUTO_END_CONFIRM_MS) queueMicrotask(() => this.#confirmEnd(entry, wait))
  }

  /** 두 번째 "방송 중 아님" — 회차를 끝낸다(LiveAutoEnd가 리허설·다른 플랫폼 등을 다시 본다) */
  #confirmEnd(entry: Entry, wait: AutoEndWait): void {
    if (entry.autoEnd !== wait || entry.closed || this.#closed) return
    this.#clearAutoEnd(entry)
    entry.autoEndTried = true
    const onLiveEnded = this.#options.onLiveEnded
    if (onLiveEnded === undefined) return
    const run = onLiveEnded(entry.sellerId, entry.broadcastId).then(
      () => undefined,
      () => undefined,
    )
    this.#draining.add(run)
    void run.finally(() => this.#draining.delete(run))
  }

  #clearAutoEnd(entry: Entry): void {
    const wait = entry.autoEnd
    if (wait === null) return
    entry.autoEnd = null
    wait.cancelCheck?.()
  }

  /** 서버가 다시 켜진 뒤 이어받는 연결: 이 회차에 틱톡 댓글을 기록한 적이 있으면 받던 라이브다 (모르면 false — 끝내지 않는 쪽) */
  async #recordedBefore(sellerId: string, broadcastId: string): Promise<boolean> {
    try {
      return (await tiktokChatStats(this.#options.db, sellerId, broadcastId)).count > 0
    } catch {
      return false
    }
  }

  // ── 틱톡 프로필 사진 (D-TT-PHOTO-01) ─────────────────────────────────────

  /** 틱톡 아이디 → 마지막으로 받은 방 정보의 프로필 사진 주소 (서명 붙은 주소 — 바뀌면 새것으로) */
  readonly #avatarUrls = new Map<string, string>()
  /** 틱톡 아이디 → 받은 사진(data: 주소)과 받은 시각 (있으면 6시간, 못 받았으면 10분 동안 다시 받지 않는다) */
  readonly #avatarPhotos = new Map<string, { readonly data: string | null; readonly at: number }>()
  readonly #avatarLoading = new Map<string, Promise<string | null>>()

  #rememberAvatar(tiktokId: string, url: string): void {
    if (this.#avatarUrls.size > 2000) this.#avatarUrls.clear()
    const before = this.#avatarUrls.get(tiktokId)
    this.#avatarUrls.set(tiktokId, url)
    // 전에 못 받았는데 새 주소가 왔으면 다음 물음에 다시 받는다
    if (before !== url && this.#avatarPhotos.get(tiktokId)?.data === null) this.#avatarPhotos.delete(tiktokId)
  }

  /**
   * 그 회차에 이은 틱톡 계정의 프로필 사진 (data: 주소). 이은 적이 없으면 판매자가 저장한 틱톡 아이디. 없는 회차면 undefined(404).
   * 사진 주소는 연결할 때의 방 정보에서만 얻는다 — 아직 받는 중이 된 적이 없으면(서버가 막 켜짐·직접 연결이 막힘) null
   */
  async avatar(sellerId: string, broadcastId: string): Promise<string | null | undefined> {
    if ((await findBroadcast(this.#options.db, sellerId, broadcastId)) === null) return undefined
    const tiktokId = (await latestTiktokLink(this.#options.db, sellerId, broadcastId))?.tiktokId ?? (await findTiktokId(this.#options.db, sellerId))
    if (tiktokId === null) return null
    const now = this.#clock.now()
    const cached = this.#avatarPhotos.get(tiktokId)
    if (cached !== undefined && now - cached.at < (cached.data === null ? 10 * 60_000 : 6 * 60 * 60_000)) return cached.data
    const url = this.#avatarUrls.get(tiktokId)
    if (url === undefined) return cached?.data ?? null
    let loading = this.#avatarLoading.get(tiktokId)
    if (loading === undefined) {
      const fetchAvatar = this.#options.avatarFetch ?? fetchTikTokAvatar()
      loading = fetchAvatar(url)
        .catch(() => null)
        .then((data) => {
          if (this.#avatarPhotos.size > 2000) this.#avatarPhotos.clear()
          // 새로 못 받았으면 전에 받은 사진을 그대로 둔다(10분 뒤 다시)
          this.#avatarPhotos.set(tiktokId, { data: data ?? cached?.data ?? null, at: data === null && cached?.data != null ? now - 6 * 60 * 60_000 + 10 * 60_000 : now })
          return data ?? cached?.data ?? null
        })
        .finally(() => this.#avatarLoading.delete(tiktokId))
      this.#avatarLoading.set(tiktokId, loading)
    }
    return loading
  }

  /**
   * 그 회차의 틱톡 연결이 아직 방송 중일 수 있는가 (다른 플랫폼이 끝났을 때 회차를 끝내도 되는지, D-LIVE-AUTOEND).
   * 이어진 틱톡 연결이 없으면 false. 이어져 있으면 틱톡이 끝났다(ENDED)거나 방송 전(NOT_LIVE)이라고 할 때만 false — 모르면 true
   */
  async mayBeLive(sellerId: string, broadcastId: string): Promise<boolean> {
    const link = await latestTiktokLink(this.#options.db, sellerId, broadcastId)
    if (link === null || link.state !== 'LINKED') return false
    const entry = this.#entries.get(sellerId)
    if (entry === undefined || entry.linkId !== link.id || entry.closed) return true
    const status = entry.conn.status()
    return !(status.state === 'ENDED' || (status.state === 'RETRYING' && status.reason === 'NOT_LIVE'))
  }

  // ── 레코드 → chat (AC-N2b-2-37·50~53) ────────────────────────────────────

  /** 우리 봇이 올린 틱톡 감사 댓글인가 (직접 연결·크롬 확장 모두 기록 전에 묻는다, D-TT-SEND-06) */
  isOwnThanks(sellerId: string, record: { readonly userId: string; readonly text: string }): boolean {
    return this.#options.ownThanks?.isOwn(sellerId, record) ?? false
  }

  #drain(entry: Entry): void {
    if (entry.draining) return
    entry.draining = true
    const run = (async () => {
      try {
        while (entry.pending.length > 0) {
          // 우리 봇이 올린 감사 글은 찜으로 읽지 않는다 (D-TT-SEND-06)
          const batch = entry.pending.splice(0, TIKTOK_RECORD_BATCH).filter((record) => !this.isOwnThanks(entry.sellerId, record))
          if (batch.length === 0) continue
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
            drafts.push({ fields: { type: 'chat', b, ...fields }, actor: { kind: 'collector' }, chat: { b, id: fields.id }, source: 'other', skipIfInvalid: true })
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
        // 만드는 중인 방송은 화면에 들어올 때까지 받지 않는다 (D-UX3-27)
        if (broadcast === null || broadcast.rehearsal || broadcast.endedAt !== null || broadcast.openedAt === null) continue
        const entry = this.#open(link.sellerId, link.id, link.broadcastId, broadcast.date, link.tiktokId, await this.#recordedBefore(link.sellerId, link.broadcastId))
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
