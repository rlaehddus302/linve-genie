// 밴드 글 댓글 묶음 (PLT-04, BND1, D-BND1-01~15): 계정 연결(경로 표 OAuth·토큰 암호화)·밴드/글 목록·회차 잇기(기준선)·끊기,
// 10초 빠른 읽기·60초 전체 읽기 → chat 기록(접수순, 한 묶음 안은 작성 시각 순)·지운/고친 댓글 알림·실패와 다시 시도·호출 한도.
// - 판정은 하지 않는다 — 댓글을 수집 경로(record, 조치자 collector)로 넣을 뿐이고 판정은 엔진이 한다.
// - 판매자마다 읽기는 하나다(타이머는 앞 읽기가 끝난 뒤에만 건다). 잇기·끊기·다시 연결은 판매자 잠금(플랫폼 공통) 안에서 한다.
// - 기록은 범위 락 안에서 연결 상태를 다시 본다 — 끊기·회차 끝·유튜브 잇기 뒤의 댓글은 기록하지 않는다.
// - 토큰·코드·경로 표·user_key·밴드/글 키·손님 이름·댓글 본문은 로그·오류 응답에 쓰지 않는다(D-BND1-14). 로그는 정해진 코드와 수만.
import { randomBytes } from 'node:crypto'
import { getBroadcast, type EngineState } from '@livejjim/core'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { scopeLockKey } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { PlatformCapability } from '../platform.ts'
import type { PlatformRecordJob, PlatformRecordOutcome } from '../platform-record.ts'
import { sellerLinkLockKey, type SellerLocks } from '../seller-locks.ts'
import { SecretError } from '../secrets.ts'
import { findBroadcast } from '../store.ts'
import { findRequest, insertRequest } from '../instagram/store.ts'
import { kstDate, type Clock } from '../time.ts'
import { authorUserKey, bandBatch, bandFirstLine, bandText, clipWithEllipsis, type BandSkipCode } from './comment.ts'
import { BandClient, pagingParams, type BandFailure } from './client.ts'
import type { BandSettings } from './config.ts'
import { bandHash, openBandToken, sealBandToken } from './crypto.ts'
import {
  BAND_MESSAGES,
  bandBaselineMessage,
  bandDeletedMessage,
  bandEditedMessage,
  bandLateMessage,
  bandNoAuthorMessage,
  bandRateMessage,
  bandTooLongMessage,
  type BandCallbackResult,
} from './messages.ts'
import {
  BAND_ACTIVE_STATES,
  bandChatCount,
  bandLinkCounts,
  bandLinkTextsExpired,
  bandNoticeSummary,
  bumpBandSkips,
  dropBandAccount,
  eraseOldBandTexts,
  findBandAccount,
  findBandLink,
  findBandState,
  finishBandLinks,
  insertBandLink,
  insertBandNotice,
  insertBandSeen,
  insertBandState,
  latestBandLink,
  markBandAccountReconnect,
  markBandNoticesSeen,
  markBandSeen,
  moveSellerBandLinks,
  openBandLink,
  recordedBandSeen,
  resumableBandLinks,
  saveBandAccount,
  seenBandKeys,
  setBandLinkState,
  setChosenBand,
  useBandState,
  youtubeEverLinked,
  type BandAccountRow,
  type BandFinishReason,
  type BandLinkRow,
  type BandLinkState,
  type BandNoticeRow,
  type BandSeenInput,
  type BandSkipColumn,
} from './store.ts'

// ── 시계·시간 ──────────────────────────────────────────────────────────

/** 읽기 일정의 시계·타이머 (주입한다 — 시험은 가짜 시계로 10초·60초·다시 시도 시간표를 빠르게 돈다) */
export interface BandClock {
  now(): number
  /** ms 뒤에 fn을 한 번. 돌려준 함수를 부르면 취소 */
  setTimer(ms: number, fn: () => void): () => void
}

export interface BandTiming {
  /** 빠른 읽기 간격 (앞 읽기가 끝난 때부터) */
  readonly fastMs: number
  /** 전체 읽기 간격 */
  readonly fullMs: number
  /** 다시 시도 시간표 (첫 실패부터) · 그 뒤 간격 */
  readonly retryMs: readonly number[]
  readonly retryEveryMs: number
  /** 판매자 호출 한도(1002·1003): 처음 쉼 · 가장 긴 쉼 */
  readonly sellerRateFirstMs: number
  readonly sellerRateMaxMs: number
  /** 이만큼 넘게 읽지 못하다가 다시 읽어 새 댓글을 넣으면 늦게 읽음 알림 */
  readonly lateMs: number
  /** 빠른 읽기 한 번의 쪽 수 · 전체 읽기의 댓글 수 상한 */
  readonly fastPages: number
  readonly fullMax: number
  /** 글 목록 "더 보기" 쪽 수 상한 */
  readonly postPages: number
  /** 보관 기간이 지난 손님 글 지우기 간격 */
  readonly eraseEveryMs: number
}

export const BAND_TIMING: BandTiming = Object.freeze({
  fastMs: 10_000,
  fullMs: 60_000,
  retryMs: Object.freeze([10_000, 20_000, 40_000, 80_000, 160_000]),
  retryEveryMs: 300_000,
  sellerRateFirstMs: 30_000,
  sellerRateMaxMs: 300_000,
  lateMs: 60_000,
  fastPages: 5,
  fullMax: 1_000,
  postPages: 5,
  eraseEveryMs: 60 * 60 * 1000,
})

/** 연결 시작 표 유효 시간 (10분) */
export const BAND_STATE_TTL_MS = 10 * 60 * 1000
/** 글 목록 "더 보기" 표 유효 시간 */
const CURSOR_TTL_MS = 10 * 60 * 1000
/** 밴드 목록 기억 (글 목록에서 고른 밴드가 목록에 있는지) */
const BANDS_CACHE_MS = 5 * 60 * 1000
/** 알림 최근 몇 개 */
export const BAND_NOTICE_RECENT = 20
/** 알림의 손님 글 자르기 (코드 포인트) */
export const BAND_NOTICE_TEXT_MAX = 60
/** 보관 날 수 (D-LND1-11과 같다) */
const KEEP_DAYS = 30
/** 받은 값 모양 (밴드·글 키, 경로 표) */
const KEY_RE = /^[A-Za-z0-9_-]{1,200}$/
const STATE_RE = /^[A-Za-z0-9_-]{20,128}$/

export const BAND_REQUIRED_SCOPES: readonly string[] = Object.freeze(['READ_BAND_AND_USERS_LIST', 'READ_POST', 'READ_COMMENT'])

function realClockOf(clock: Clock): BandClock {
  return {
    now: () => clock.now(),
    setTimer(ms, fn) {
      const handle = setTimeout(fn, ms)
      handle.unref?.()
      return () => clearTimeout(handle)
    },
  }
}

// ── 보기 모양 ──────────────────────────────────────────────────────────

/** 판매자의 밴드 계정 보기 (AC-BND1-13) — 토큰·user_key·코드는 없다 */
export interface BandAccountView {
  readonly status: 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'
  /** 상태 문장 (연결됨이면 null) */
  readonly message: string | null
  readonly profileName: string | null
  readonly connectedAt: string | null
  /** 기억한 밴드 키 */
  readonly chosenBand: string | null
}

export interface BandNoticeView {
  readonly id: number
  readonly kind: 'DELETED' | 'EDITED' | 'LATE'
  readonly message: string
  readonly at: string
  /** 판매자가 "확인했어요"로 본 것인지 */
  readonly seen: boolean
}

export type BandSkipCounts = Readonly<Record<BandSkipCode, number>>

/** 회차의 밴드 글 연결 보기 (AC-BND1-35·41·50) */
export interface BandLinkView {
  readonly broadcast: string
  readonly platform: 'BAND'
  /** NONE = 이은 적 없음 */
  readonly state: 'NONE' | BandLinkState
  /** 상태 문장 (NONE이면 null) */
  readonly message: string | null
  /** 지금 새로 이을 수 있는지와 막는 까닭 (콘솔 칸 — 준비 안 됨·연결 안 함·리허설·유튜브 등) */
  readonly canLink: boolean
  readonly blockCode: string | null
  readonly blockMessage: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: 'account'; readonly loginId: string | null } | null
  readonly post: { readonly bandKey: string; readonly postKey: string; readonly firstLine: string } | null
  readonly lastReadAt: string | null
  /** 받은 댓글 수 (기록한 chat) · 기준선 수 */
  readonly received: number
  readonly baseline: number
  readonly baselineMessage: string | null
  readonly skipped: BandSkipCounts
  /** 넣지 못한 수의 문장 (작성자 모름·너무 긺) */
  readonly skipMessages: readonly string[]
  readonly failures: number
  readonly retryAt: string | null
  readonly rateLimited: boolean
  readonly finishReason: BandFinishReason | null
  readonly notices: {
    readonly items: readonly BandNoticeView[]
    readonly total: number
    /** 확인한 마지막 번호 */
    readonly seenUpTo: number
    readonly unseen: number
    /** 확인하지 않은 지운·고친 댓글 알림 수 (알림 띠) */
    readonly unseenEdits: number
  }
}

export interface BandOutcome {
  readonly status: number
  readonly body: Readonly<Record<string, unknown>>
}

const fail = (status: number, code: string, message: string): BandOutcome => ({ status, body: { error: { code, message } } })
const notFound = (): BandOutcome => fail(404, 'NOT_FOUND', '찾을 수 없어요.')
const badInput = (field: string, message: string): BandOutcome => ({
  status: 400,
  body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field, message }] } },
})

const FINISH_MESSAGES: Readonly<Record<BandFinishReason, string>> = {
  UNLINKED: BAND_MESSAGES.FINISHED_UNLINKED,
  ENDED: BAND_MESSAGES.FINISHED_ENDED,
  ACCOUNT_CHANGED: BAND_MESSAGES.FINISHED_ACCOUNT_CHANGED,
  DISCONNECTED: BAND_MESSAGES.FINISHED_DISCONNECTED,
  RESTORED: BAND_MESSAGES.FINISHED_RESTORED,
}

const SKIP_COLUMNS: Readonly<Partial<Record<BandSkipCode, BandSkipColumn>>> = {
  SELLER: 'skipSeller',
  NO_AUTHOR: 'skipNoAuthor',
  BAD_TIME: 'skipBadTime',
  NO_TEXT: 'skipNoText',
  TEXT_TOO_LONG: 'skipTooLong',
  DUPLICATE: 'skipDuplicate',
}

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString())
const isUniqueViolation = (error: unknown): boolean => {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if (typeof current === 'object' && (current as Obj)['code'] === '23505') return true
    current = typeof current === 'object' ? (current as Obj)['cause'] : undefined
  }
  return false
}

// ── 묶음 ───────────────────────────────────────────────────────────────

export interface SessionRef {
  readonly sellerId: string
  readonly accountId: string
  readonly tokenHash: string
}

export interface BandHooks {
  /** 본 댓글 표에 적기 직전 (던지면 적지 못한 것 — AC-BND1-34 (다)) */
  readonly beforeSeen?: () => void | Promise<void>
}

export interface BandServiceOptions {
  readonly db: Db
  readonly clock: Clock
  readonly log: LogSink
  readonly masterKey: Buffer
  readonly appOrigin: string
  /** 밴드 설정 (없으면 NOT_CONFIGURED — 밴드로 나가는 요청이 없다) */
  readonly settings: BandSettings | null
  /** 판매자 잠금 (라이브 연결 공통 — 인스타그램·틱톡과 같은 것) */
  readonly locks: SellerLocks
  /** 댓글 묶음 기록 (수집 경로 — server.ts가 recordPlatformChats를 잇는다) */
  readonly record: (job: PlatformRecordJob) => Promise<PlatformRecordOutcome>
  /** 범위 상태 (회차 설정 스냅샷 — 실제 시각순인지) */
  readonly readState: (sellerId: string, date: string) => Promise<EngineState>
  /** 실시간 알림 (SSE event: band) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  readonly bandClock?: BandClock
  readonly timing?: Partial<BandTiming>
  readonly fetch?: typeof fetch
  readonly hooks?: BandHooks
}

interface Entry {
  readonly sellerId: string
  readonly linkId: number
  cancel: (() => void) | null
  running: Promise<void> | null
  closed: boolean
  /** 마지막 전체 읽기를 시작한 시각 */
  lastFullAt: number
  /** 판매자 호출 한도 쉼 (0 = 처음) */
  rateMs: number
}

interface Cursor {
  readonly sellerId: string
  readonly bandKey: string
  readonly page: number
  readonly params: Readonly<Record<string, string>>
  readonly expiresAt: number
}

/** 읽기 결과 (오래된 것부터의 차례) */
type ReadResult = { readonly ok: true; readonly items: readonly unknown[]; readonly complete: boolean; readonly overflow: boolean } | { readonly ok: false; readonly failure: BandFailure }

export class BandService {
  readonly #o: BandServiceOptions
  readonly #timing: BandTiming
  readonly #clock: BandClock
  readonly #client: BandClient | null
  readonly #entries = new Map<string, Entry>()
  readonly #cursors = new Map<string, Cursor>()
  readonly #bandsCache = new Map<string, { keys: Set<string>; at: number }>()
  readonly #pending = new Set<Promise<unknown>>()
  #eraseCancel: (() => void) | null = null
  #closed = false

  constructor(options: BandServiceOptions) {
    this.#o = options
    this.#timing = { ...BAND_TIMING, ...(options.timing ?? {}) }
    this.#clock = options.bandClock ?? realClockOf(options.clock)
    this.#client = options.settings === null ? null : new BandClient({ settings: options.settings, now: () => this.#clock.now(), log: options.log, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) })
  }

  get configured(): boolean {
    return this.#client !== null
  }

  #now(): Date {
    return new Date(this.#o.clock.now())
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise)
    void promise.finally(() => this.#pending.delete(promise)).catch(() => undefined)
    return promise
  }

  // ── 플랫폼 능력 (AC-BND1-02) ──────────────────────────────────────────

  capability(): PlatformCapability {
    return {
      platform: 'BAND',
      ready: this.configured,
      receivedTime: false,
      thanks: 'NONE',
      videoComment: false,
      reasons: {
        ...(this.configured ? {} : { ready: BAND_MESSAGES.NOT_CONFIGURED }),
        receivedTime: BAND_MESSAGES.RECEIVED_TIME,
        thanks: BAND_MESSAGES.THANKS,
        videoComment: BAND_MESSAGES.THANKS,
      },
    }
  }

  // ── 계정 (AC-BND1-11~15) ──────────────────────────────────────────────

  /** 토큰이 끝났으면(저장한 끝나는 시각이 지남) 다시 연결 필요로 본다 */
  #accountStatus(account: BandAccountRow | null): BandAccountView['status'] {
    if (!this.configured) return 'NOT_CONFIGURED'
    if (account === null) return 'NOT_CONNECTED'
    if (account.status === 'RECONNECT_NEEDED') return 'RECONNECT_NEEDED'
    if (account.expiresAt !== null && account.expiresAt.getTime() <= this.#o.clock.now()) return 'RECONNECT_NEEDED'
    return 'CONNECTED'
  }

  async accountView(sellerId: string, db: Db = this.#o.db): Promise<BandAccountView> {
    const account = await findBandAccount(db, sellerId)
    const status = this.#accountStatus(account)
    const message = status === 'NOT_CONFIGURED' ? BAND_MESSAGES.NOT_CONFIGURED : status === 'NOT_CONNECTED' ? BAND_MESSAGES.NOT_CONNECTED : status === 'RECONNECT_NEEDED' ? BAND_MESSAGES.RECONNECT_NEEDED : null
    return {
      status,
      message,
      profileName: account?.profileName ?? null,
      connectedAt: account === null ? null : account.connectedAt.toISOString(),
      chosenBand: account?.chosenBand ?? null,
    }
  }

  #publishAccount(sellerId: string): void {
    if (this.#closed) return
    void this.accountView(sellerId)
      .then((band) => this.#o.publish(sellerId, { kind: 'ACCOUNT', band }))
      .catch(() => undefined)
  }

  /** 연결 시작 (AC-BND1-11): 한 번 쓰는 표(10분, 그 세션)를 만들고 승인 창 주소를 돌려준다 */
  async start(session: SessionRef): Promise<BandOutcome> {
    const client = this.#client
    if (client === null) return fail(409, 'NOT_CONFIGURED', BAND_MESSAGES.NOT_CONFIGURED)
    const state = randomBytes(32).toString('base64url')
    const now = this.#now()
    await insertBandState(this.#o.db, { sellerId: session.sellerId, accountId: session.accountId, sessionHash: session.tokenHash, stateHash: bandHash(state), expiresAt: new Date(now.getTime() + BAND_STATE_TTL_MS), now })
    return { status: 200, body: { url: client.authorizeUrl(`${client.settings.redirectUri}/${state}`, state) } }
  }

  /** 돌아온 뒤 보낼 화면 주소 (결과 코드만 붙인다) */
  returnUrl(result: BandCallbackResult): string {
    return `${this.#o.appOrigin}/settings/band?band=${result}`
  }

  /**
   * 돌아오기 (AC-BND1-12): 표가 있고·10분 안이고·안 쓴 것이고·지금 세션 판매자의 것일 때만 code로 토큰을 받는다. 표는 한 번 쓰면 끝난다.
   * codes = 질의의 code 값들 (여러 개면 실패)
   */
  async callback(state: string, codes: readonly string[], session: SessionRef | null): Promise<BandCallbackResult> {
    const client = this.#client
    if (client === null) return 'failed'
    if (!STATE_RE.test(state) || session === null) return 'expired'
    const now = this.#now()
    const row = await findBandState(this.#o.db, bandHash(state))
    if (row === null || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime() || row.sessionHash !== session.tokenHash || row.sellerId !== session.sellerId) return 'expired'
    if (!(await useBandState(this.#o.db, row.sellerId, row.id, now))) return 'expired'
    if (codes.length === 0 || codes[0] === '') return 'denied'
    if (codes.length > 1 || (codes[0] as string).length > 1024) return 'failed'
    const sellerId = session.sellerId
    const tokenResult = await client.token(codes[0] as string, sellerId)
    if (!tokenResult.ok) return 'failed'
    const body = tokenResult.data
    const token = body['access_token']
    if (typeof token !== 'string' || token === '' || token.length > 4096) return 'failed'
    const scope = body['scope']
    if (scope !== undefined && scope !== null) {
      const granted = new Set(typeof scope === 'string' ? scope.split(/[\s,]+/).filter((item) => item !== '') : [])
      if (!BAND_REQUIRED_SCOPES.every((name) => granted.has(name))) {
        this.#o.log({ level: 'warn', code: 'BAND_CONNECT_FAILED', reason: 'SCOPE', seller: sellerId })
        return 'scope'
      }
    }
    const expiresIn = body['expires_in']
    const expiresAt = typeof expiresIn === 'number' && Number.isSafeInteger(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null
    // 프로필 이름 (실패해도 연결은 성공) · 토큰 응답에 user_key가 없으면 프로필의 것
    const profile = await client.api('profile', token, {}, sellerId)
    const profileName = profile.ok && typeof profile.data['name'] === 'string' ? clipWithEllipsis(profile.data['name'], 64) : null
    const fromToken = body['user_key']
    const fromProfile = profile.ok ? profile.data['user_key'] : undefined
    const userKey = typeof fromToken === 'string' && fromToken !== '' ? fromToken : typeof fromProfile === 'string' && fromProfile !== '' ? fromProfile : null
    if (userKey === null || userKey.length > 251) {
      this.#o.log({ level: 'warn', code: 'BAND_CONNECT_FAILED', reason: 'NO_USER_KEY', seller: sellerId })
      return 'failed'
    }
    const resumed: number[] = []
    let changed = false
    try {
      await this.#o.locks.run(sellerId, () =>
        this.#o.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
          const existing = await findBandAccount(tx, sellerId)
          const same = existing !== null && existing.userKey === userKey
          if (existing !== null && !same) {
            // 다른 밴드 계정: 그 판매자의 열린 밴드 글 연결을 모두 끝내고 기억한 밴드를 지운다 (AC-BND1-14)
            for (const link of await finishBandLinks(tx, sellerId, 'ACCOUNT_CHANGED', now)) resumed.push(-link.id)
            changed = true
          }
          await saveBandAccount(tx, { sellerId, userKey, tokenEnc: sealBandToken(this.#o.masterKey, sellerId, token), expiresAt, profileName, chosenBand: same ? existing.chosenBand : null, now })
          // 같은 계정으로 다시 연결: 다시 연결이 필요해 멈춘 글 연결을 이어 읽는다 (AC-BND1-14·55)
          if (same) for (const id of await moveSellerBandLinks(tx, sellerId, ['RECONNECT_NEEDED'], 'READING', { retryAt: null, failures: 0, rateLimited: false })) resumed.push(id)
        }),
      )
    } catch (error) {
      this.#o.log({ level: 'error', code: 'BAND_CONNECT_FAILED', reason: 'SAVE', seller: sellerId, errorKind: errorKind(error) })
      return 'failed'
    }
    this.#bandsCache.delete(sellerId)
    for (const id of resumed) {
      if (id < 0) this.#retire(sellerId, -id)
      else this.#open(sellerId, id, true)
    }
    this.#publishAccount(sellerId)
    if (changed || resumed.length > 0) void this.#publishOpenLinks(sellerId, resumed.map(Math.abs))
    return 'connected'
  }

  /** 연결 끊기 (AC-BND1-14): 토큰을 지우고 열린 밴드 글 연결을 모두 끝낸다. 밴드에는 아무 요청도 하지 않는다. 같은 요청 번호는 한 번 */
  async disconnect(sellerId: string, accountId: string, requestId: string): Promise<BandOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let finished: { id: number; broadcastId: string }[] = []
    const outcome = await this.#o.locks.run(sellerId, () =>
      this.#o.db.transaction(async (tx): Promise<BandOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        const again = await findRequest(tx, sellerId, requestId)
        if (again !== null) return JSON.parse(again) as BandOutcome
        const now = this.#now()
        finished = await finishBandLinks(tx, sellerId, 'DISCONNECTED', now, { by: accountId })
        await dropBandAccount(tx, sellerId)
        const result: BandOutcome = { status: 200, body: { band: await this.accountView(sellerId, tx) } }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
        return result
      }),
    )
    this.#bandsCache.delete(sellerId)
    for (const link of finished) {
      this.#retire(sellerId, link.id)
      this.#publishLink(sellerId, link.broadcastId)
    }
    this.#publishAccount(sellerId)
    return outcome
  }

  async #prior(sellerId: string, requestId: string): Promise<BandOutcome | null> {
    const stored = await findRequest(this.#o.db, sellerId, requestId)
    return stored === null ? null : (JSON.parse(stored) as BandOutcome)
  }

  /** API를 부를 수 있는 토큰 (아니면 그 거절) */
  async #tokenOf(sellerId: string, db: Db = this.#o.db): Promise<{ ok: true; token: string; account: BandAccountRow } | { ok: false; outcome: BandOutcome }> {
    if (!this.configured) return { ok: false, outcome: fail(409, 'NOT_CONFIGURED', BAND_MESSAGES.NOT_CONFIGURED) }
    const account = await findBandAccount(db, sellerId)
    const status = this.#accountStatus(account)
    if (account === null) return { ok: false, outcome: fail(409, 'NOT_CONNECTED', BAND_MESSAGES.NOT_CONNECTED) }
    if (status !== 'CONNECTED') return { ok: false, outcome: fail(409, 'RECONNECT_NEEDED', BAND_MESSAGES.RECONNECT_NEEDED) }
    try {
      return { ok: true, token: openBandToken(this.#o.masterKey, sellerId, account.tokenEnc), account }
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
      this.#o.log({ level: 'warn', code: 'BAND_TOKEN_UNREADABLE', seller: sellerId })
      await this.#reconnectNeeded(sellerId)
      return { ok: false, outcome: fail(409, 'RECONNECT_NEEDED', BAND_MESSAGES.RECONNECT_NEEDED) }
    }
  }

  /** 실패 → 판매자에게 보낼 거절 (이 문서의 문장과 코드만 — 밴드가 준 message는 되돌려 보내지 않는다) */
  async #failureOutcome(sellerId: string, failure: BandFailure): Promise<BandOutcome> {
    switch (failure.kind) {
      case 'RECONNECT':
        await this.#reconnectNeeded(sellerId)
        return fail(409, 'RECONNECT_NEEDED', BAND_MESSAGES.RECONNECT_NEEDED)
      case 'NO_ACCESS':
        return fail(409, 'NO_ACCESS', BAND_MESSAGES.NO_ACCESS)
      case 'RATE_SELLER':
        return fail(503, 'RATE_LIMITED', bandRateMessage(Math.ceil(this.#timing.sellerRateFirstMs / 1000)))
      case 'RATE_APP':
        return fail(503, 'RATE_LIMITED', bandRateMessage(Math.max(1, Math.ceil((this.#client?.appPauseRemaining() ?? 0) / 1000))))
      default:
        return fail(503, 'UNAVAILABLE', BAND_MESSAGES.RETRYING)
    }
  }

  /** 토큰 풀림 (10401·토큰 응답 invalid_token·끝나는 시각 지남·풀 수 없음): 계정과 그 판매자의 읽던 연결을 모두 멈춘다 */
  async #reconnectNeeded(sellerId: string): Promise<void> {
    const now = this.#now()
    let moved: number[] = []
    await this.#o.db.transaction(async (tx) => {
      await markBandAccountReconnect(tx, sellerId, now)
      moved = await moveSellerBandLinks(tx, sellerId, BAND_ACTIVE_STATES, 'RECONNECT_NEEDED', { retryAt: null })
    })
    this.#o.log({ level: 'warn', code: 'BAND_RECONNECT_NEEDED', seller: sellerId, count: moved.length })
    for (const id of moved) this.#retire(sellerId, id)
    this.#publishAccount(sellerId)
    await this.#publishOpenLinks(sellerId, moved)
  }

  // ── 밴드·글 고르기 (AC-BND1-20·21) ─────────────────────────────────────

  async bands(sellerId: string): Promise<BandOutcome> {
    const got = await this.#tokenOf(sellerId)
    if (!got.ok) return got.outcome
    const result = await (this.#client as BandClient).api('bands', got.token, {}, sellerId)
    if (!result.ok) return this.#failureOutcome(sellerId, result.failure)
    const raw = result.data['bands']
    const bands: { bandKey: string; name: string; memberCount: number | null }[] = []
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!isObj(item)) continue
      const bandKey = item['band_key']
      const name = item['name']
      const members = item['member_count']
      if (typeof bandKey !== 'string' || !KEY_RE.test(bandKey) || typeof name !== 'string') continue
      bands.push({ bandKey, name: clipWithEllipsis(name.trim(), 100), memberCount: typeof members === 'number' && Number.isSafeInteger(members) && members >= 0 ? members : null })
    }
    this.#bandsCache.set(sellerId, { keys: new Set(bands.map((band) => band.bandKey)), at: this.#clock.now() })
    const chosen = got.account.chosenBand !== null && bands.some((band) => band.bandKey === got.account.chosenBand) ? got.account.chosenBand : null
    // 기억한 밴드를 먼저
    const ordered = chosen === null ? bands : [...bands.filter((band) => band.bandKey === chosen), ...bands.filter((band) => band.bandKey !== chosen)]
    return { status: 200, body: { bands: ordered, chosenBand: chosen, message: bands.length === 0 ? BAND_MESSAGES.NO_BANDS : null } }
  }

  /** 내 글 목록 (AC-BND1-21): 작성자 user_key가 판매자와 같은 글만. cursor = 앞 응답의 "더 보기" 값 (5쪽까지) */
  async posts(sellerId: string, bandKey: unknown, cursorId: unknown): Promise<BandOutcome> {
    if (typeof bandKey !== 'string' || !KEY_RE.test(bandKey)) return badInput('band', '밴드를 골라 주세요.')
    if (cursorId !== undefined && (typeof cursorId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(cursorId))) return fail(400, 'CURSOR_EXPIRED', BAND_MESSAGES.CURSOR_EXPIRED)
    const got = await this.#tokenOf(sellerId)
    if (!got.ok) return got.outcome
    const client = this.#client as BandClient
    let cached = this.#bandsCache.get(sellerId)
    if (cached === undefined || this.#clock.now() - cached.at > BANDS_CACHE_MS) {
      const listed = await this.bands(sellerId)
      if (listed.status !== 200) return listed
      cached = this.#bandsCache.get(sellerId)
    }
    if (cached === undefined || !cached.keys.has(bandKey)) return fail(400, 'UNKNOWN_BAND', BAND_MESSAGES.UNKNOWN_BAND)
    let page = 1
    let params: Readonly<Record<string, string>> = {}
    if (typeof cursorId === 'string') {
      const cursor = this.#cursors.get(cursorId)
      if (cursor === undefined || cursor.sellerId !== sellerId || cursor.bandKey !== bandKey || cursor.expiresAt <= this.#clock.now()) return fail(400, 'CURSOR_EXPIRED', BAND_MESSAGES.CURSOR_EXPIRED)
      page = cursor.page + 1
      params = cursor.params
      if (page > this.#timing.postPages) return fail(400, 'MORE_LIMIT', BAND_MESSAGES.MORE_LIMIT)
    }
    await setChosenBand(this.#o.db, sellerId, bandKey, this.#now())
    const result = await client.api('posts', got.token, { ...params, band_key: bandKey, locale: 'ko_KR' }, sellerId)
    if (!result.ok) return this.#failureOutcome(sellerId, result.failure)
    const items = result.data['items']
    const posts: { postKey: string; createdAt: string | null; firstLine: string; commentCount: number | null }[] = []
    for (const item of Array.isArray(items) ? items : []) {
      if (!isObj(item)) continue
      const postKey = item['post_key']
      if (typeof postKey !== 'string' || !KEY_RE.test(postKey) || authorUserKey(item) !== got.account.userKey) continue
      const createdAt = item['created_at']
      const comments = item['comment_count']
      posts.push({
        postKey,
        createdAt: typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt > 0 ? new Date(createdAt).toISOString() : null,
        firstLine: bandFirstLine(item['content']),
        commentCount: typeof comments === 'number' && Number.isSafeInteger(comments) && comments >= 0 ? comments : null,
      })
    }
    const paging = result.data['paging']
    const next = pagingParams(isObj(paging) ? paging['next_params'] : undefined)
    let cursor: string | null = null
    if (next !== null) {
      for (const [key, value] of this.#cursors) if (value.expiresAt <= this.#clock.now()) this.#cursors.delete(key)
      cursor = randomBytes(12).toString('base64url')
      this.#cursors.set(cursor, { sellerId, bandKey, page, params: next, expiresAt: this.#clock.now() + CURSOR_TTL_MS })
    }
    return { status: 200, body: { posts, page, more: cursor !== null, cursor } }
  }

  // ── 연결 보기 ──────────────────────────────────────────────────────────

  /** 그 회차가 실제 시각순인지 (회차 설정 스냅샷). 트랜잭션 밖에서만 부른다 — 기록기 상태 읽기는 바깥 DB를 쓴다 */
  async #receivedTime(sellerId: string, broadcastId: string): Promise<boolean> {
    const broadcast = await findBroadcast(this.#o.db, sellerId, broadcastId)
    if (broadcast === null) return false
    const state = await this.#o.readState(sellerId, broadcast.date)
    return getBroadcast(state, broadcastId)?.settings['contention.policy'] === 'RECEIVED_TIME'
  }

  /**
   * 지금 새로 이을 수 있는지 (콘솔 칸의 막는 까닭). receivedTime을 주지 않으면 여기서 읽는다 —
   * 트랜잭션 안(db = tx)에서는 반드시 미리 읽은 값을 준다(PGlite 한 연결에서 바깥 DB를 기다리지 않게)
   */
  async #block(sellerId: string, broadcastId: string, db: Db, receivedTime?: boolean): Promise<{ code: string; message: string } | null> {
    const broadcast = await findBroadcast(db, sellerId, broadcastId)
    if (broadcast === null) return { code: 'NOT_FOUND', message: '찾을 수 없어요.' }
    if (broadcast.rehearsal) return { code: 'REHEARSAL', message: BAND_MESSAGES.REHEARSAL }
    if (broadcast.endedAt !== null) return { code: 'ENDED', message: BAND_MESSAGES.ENDED }
    const open = await openBandLink(db, sellerId)
    if (open !== null && open.broadcastId === broadcastId) return { code: 'ALREADY_LINKED', message: BAND_MESSAGES.ALREADY_LINKED }
    const status = this.#accountStatus(await findBandAccount(db, sellerId))
    if (status === 'NOT_CONFIGURED') return { code: 'NOT_CONFIGURED', message: BAND_MESSAGES.NOT_CONFIGURED }
    if (status === 'NOT_CONNECTED') return { code: 'NOT_CONNECTED', message: BAND_MESSAGES.NOT_CONNECTED }
    if (status === 'RECONNECT_NEEDED') return { code: 'RECONNECT_NEEDED', message: BAND_MESSAGES.RECONNECT_NEEDED }
    if (open !== null) return { code: 'BAND_IN_USE', message: BAND_MESSAGES.BAND_IN_USE }
    if (await youtubeEverLinked(db, sellerId, broadcastId)) return { code: 'YOUTUBE_LINKED', message: BAND_MESSAGES.YOUTUBE_LINKED }
    if (receivedTime ?? (await this.#receivedTime(sellerId, broadcastId))) return { code: 'RECEIVED_TIME_NOT_ALLOWED', message: BAND_MESSAGES.RECEIVED_TIME_NOT_ALLOWED }
    return null
  }

  #stateMessage(link: BandLinkRow): string {
    switch (link.state) {
      case 'READING':
        return BAND_MESSAGES.READING
      case 'RETRYING':
        if (link.rateLimited && link.retryAt !== null) return bandRateMessage(Math.max(1, Math.ceil((link.retryAt.getTime() - this.#clock.now()) / 1000)))
        return BAND_MESSAGES.RETRYING
      case 'RECONNECT_NEEDED':
        return BAND_MESSAGES.RECONNECT_NEEDED
      case 'NO_ACCESS':
        return BAND_MESSAGES.NO_ACCESS
      case 'YOUTUBE_LINKED':
        return BAND_MESSAGES.YOUTUBE_STOPPED
      default:
        return FINISH_MESSAGES[link.finishReason ?? 'UNLINKED']
    }
  }

  #noticeMessage(row: BandNoticeRow, expired: boolean): string {
    if (row.kind === 'LATE') return bandLateMessage(row.minutes ?? 1, row.count ?? 0)
    if (row.erased || expired) return BAND_MESSAGES.NOTICE_ERASED
    const nick = row.nick ?? '시청자'
    const before = clipWithEllipsis(row.beforeText ?? '', BAND_NOTICE_TEXT_MAX)
    if (row.kind === 'DELETED') return bandDeletedMessage(nick, before)
    return bandEditedMessage(nick, before, clipWithEllipsis(row.afterText ?? '', BAND_NOTICE_TEXT_MAX))
  }

  #cutoffDate(): string {
    return kstDate(this.#o.clock.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
  }

  async #viewOf(sellerId: string, broadcastId: string, link: BandLinkRow | null, db: Db = this.#o.db, receivedTime?: boolean): Promise<BandLinkView> {
    const block = await this.#block(sellerId, broadcastId, db, receivedTime)
    const zero: BandSkipCounts = { SELLER: 0, NO_AUTHOR: 0, BAD_COMMENT_KEY: 0, BAD_TIME: 0, NO_TEXT: 0, TEXT_TOO_LONG: 0, DUPLICATE: 0 }
    const blocking = { canLink: block === null, blockCode: block?.code ?? null, blockMessage: block?.message ?? null }
    if (link === null) {
      return {
        broadcast: broadcastId,
        platform: 'BAND',
        state: 'NONE',
        message: null,
        ...blocking,
        linkedAt: null,
        actor: null,
        post: null,
        lastReadAt: null,
        received: 0,
        baseline: 0,
        baselineMessage: null,
        skipped: zero,
        skipMessages: [],
        failures: 0,
        retryAt: null,
        rateLimited: false,
        finishReason: null,
        notices: { items: [], total: 0, seenUpTo: 0, unseen: 0, unseenEdits: 0 },
      }
    }
    const skipped: BandSkipCounts = {
      SELLER: link.skipSeller,
      NO_AUTHOR: link.skipNoAuthor,
      BAD_COMMENT_KEY: link.skipBadKey,
      BAD_TIME: link.skipBadTime,
      NO_TEXT: link.skipNoText,
      TEXT_TOO_LONG: link.skipTooLong,
      DUPLICATE: link.skipDuplicate,
    }
    const skipMessages = [...(link.skipNoAuthor > 0 ? [bandNoAuthorMessage(link.skipNoAuthor)] : []), ...(link.skipTooLong > 0 ? [bandTooLongMessage(link.skipTooLong)] : [])]
    const summary = await bandNoticeSummary(db, sellerId, link.id, link.noticesSeen, BAND_NOTICE_RECENT)
    const expired = await bandLinkTextsExpired(db, sellerId, link.date, this.#cutoffDate())
    return {
      broadcast: broadcastId,
      platform: 'BAND',
      state: link.state,
      message: this.#stateMessage(link),
      ...blocking,
      linkedAt: link.linkedAt.toISOString(),
      actor: { kind: 'account', loginId: link.actorLoginId },
      post: { bandKey: link.bandKey, postKey: link.postKey, firstLine: link.postLine },
      lastReadAt: iso(link.lastReadAt),
      received: await bandChatCount(db, sellerId, broadcastId),
      baseline: link.baseline,
      baselineMessage: bandBaselineMessage(link.baseline),
      skipped,
      skipMessages,
      failures: link.failures,
      retryAt: iso(link.retryAt),
      rateLimited: link.rateLimited,
      finishReason: link.finishReason,
      notices: {
        items: summary.items.map((row) => ({ id: row.id, kind: row.kind, message: this.#noticeMessage(row, expired), at: row.createdAt.toISOString(), seen: row.id <= link.noticesSeen })),
        total: summary.total,
        seenUpTo: link.noticesSeen,
        unseen: summary.unseen,
        unseenEdits: summary.unseenEdits,
      },
    }
  }

  /** 회차의 밴드 글 연결 (다른 판매자·없는 회차면 null — 404). 보조자도 본다 */
  async view(sellerId: string, broadcastId: string): Promise<BandLinkView | null> {
    if ((await findBroadcast(this.#o.db, sellerId, broadcastId)) === null) return null
    return this.#viewOf(sellerId, broadcastId, await latestBandLink(this.#o.db, sellerId, broadcastId))
  }

  /** 판매자의 끝나지 않은 밴드 글 연결 (많아야 하나) */
  async list(sellerId: string): Promise<BandLinkView[]> {
    const link = await openBandLink(this.#o.db, sellerId)
    return link === null ? [] : [await this.#viewOf(sellerId, link.broadcastId, link)]
  }

  #publishLink(sellerId: string, broadcastId: string): void {
    if (this.#closed) return
    void this.view(sellerId, broadcastId)
      .then((link) => {
        if (link !== null) this.#o.publish(sellerId, { kind: 'LINK', broadcast: broadcastId, link })
      })
      .catch(() => undefined)
  }

  async #publishOpenLinks(sellerId: string, ids: readonly number[]): Promise<void> {
    for (const id of new Set(ids)) {
      const link = await findBandLink(this.#o.db, sellerId, id)
      if (link !== null) this.#publishLink(sellerId, link.broadcastId)
    }
  }

  // ── 잇기·끊기 (AC-BND1-22·23·24) ──────────────────────────────────────

  /** 밴드 글 잇기: 거절 검사 → 글 상세(내 글인지) → 댓글 끝까지(기준선) → 연결. 같은 요청 번호는 처음 응답 */
  link(sellerId: string, accountId: string, requestId: string, broadcastId: string, bandKey: unknown, postKey: unknown): Promise<BandOutcome> {
    return this.#track(this.#link(sellerId, accountId, requestId, broadcastId, bandKey, postKey))
  }

  async #link(sellerId: string, accountId: string, requestId: string, broadcastId: string, bandKey: unknown, postKey: unknown): Promise<BandOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let created: number | null = null
    const outcome = await this.#o.locks.run(sellerId, async (): Promise<BandOutcome> => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const block = await this.#block(sellerId, broadcastId, this.#o.db)
      if (block !== null) return block.code === 'NOT_FOUND' ? notFound() : fail(409, block.code, block.message)
      if (typeof bandKey !== 'string' || !KEY_RE.test(bandKey)) return badInput('bandKey', '밴드를 골라 주세요.')
      if (typeof postKey !== 'string' || !KEY_RE.test(postKey)) return badInput('postKey', '이을 글을 골라 주세요.')
      const got = await this.#tokenOf(sellerId)
      if (!got.ok) return got.outcome
      const client = this.#client as BandClient
      // (2) 글 상세 — 작성자가 판매자인지
      const detail = await client.api('post', got.token, { band_key: bandKey, post_key: postKey }, sellerId)
      if (!detail.ok) return this.#failureOutcome(sellerId, detail.failure)
      const post = detail.data['post']
      if (!isObj(post) || authorUserKey(post) !== got.account.userKey) return fail(409, 'NOT_MY_POST', BAND_MESSAGES.NOT_MY_POST)
      // (3) 댓글을 오래된 순으로 끝까지 — 그때 있던 댓글은 모두 기준선
      const read = await this.#readComments(sellerId, got.token, bandKey, postKey, 'full')
      if (!read.ok) return this.#failureOutcome(sellerId, read.failure)
      if (read.overflow) return fail(409, 'TOO_MANY_COMMENTS', BAND_MESSAGES.TOO_MANY_COMMENTS)
      if (!read.complete) return fail(503, 'UNAVAILABLE', BAND_MESSAGES.RETRYING)
      const keys = new Set<string>()
      let keyless = 0
      for (const item of read.items) {
        const key = isObj(item) ? item['comment_key'] : undefined
        if (typeof key === 'string' && key !== '' && key.length <= 1024) keys.add(key)
        else keyless += 1
      }
      const broadcast = await findBroadcast(this.#o.db, sellerId, broadcastId)
      if (broadcast === null) return notFound()
      const receivedTime = await this.#receivedTime(sellerId, broadcastId)
      try {
        return await this.#o.db.transaction(async (tx): Promise<BandOutcome> => {
          await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
          // 바깥에 묻는 동안 바뀌었을 수 있다 — 다시 본다
          const recheck = await this.#block(sellerId, broadcastId, tx, receivedTime)
          if (recheck !== null) return recheck.code === 'NOT_FOUND' ? notFound() : fail(409, recheck.code, recheck.message)
          const now = this.#now()
          const linkId = await insertBandLink(tx, { sellerId, broadcastId, date: broadcast.date, bandKey, postKey, postLine: bandFirstLine(post['content']), actorAccountId: accountId, baseline: read.items.length, skipBadKey: keyless, now })
          await insertBandSeen(tx, sellerId, linkId, [...keys].map((commentKey): BandSeenInput => ({ commentKey, kind: 'BASELINE' })), now)
          const view = await this.#viewOf(sellerId, broadcastId, await findBandLink(tx, sellerId, linkId), tx, receivedTime)
          const result: BandOutcome = { status: 200, body: { link: view } }
          await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
          created = linkId
          return result
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        // 다른 서버가 먼저 이음 (부분 유일 인덱스)
        const open = await openBandLink(this.#o.db, sellerId)
        return open !== null && open.broadcastId === broadcastId ? fail(409, 'ALREADY_LINKED', BAND_MESSAGES.ALREADY_LINKED) : fail(409, 'BAND_IN_USE', BAND_MESSAGES.BAND_IN_USE)
      }
    })
    const linkId = created as number | null
    if (linkId !== null) {
      this.#open(sellerId, linkId, false)
      this.#publishLink(sellerId, broadcastId)
    }
    return outcome
  }

  /** 끊기 (AC-BND1-23): 범위 락 → 판매자 잠금 안에서 FINISHED(끊었어요). 같은 요청 번호는 처음 응답 */
  async unlink(sellerId: string, accountId: string, requestId: string, broadcastId: string): Promise<BandOutcome> {
    const prior = await this.#prior(sellerId, requestId)
    if (prior !== null) return prior
    let finished: number | null = null
    const outcome = await this.#o.locks.run(sellerId, async (): Promise<BandOutcome> => {
      const again = await this.#prior(sellerId, requestId)
      if (again !== null) return again
      const broadcast = await findBroadcast(this.#o.db, sellerId, broadcastId)
      if (broadcast === null) return notFound()
      const receivedTime = await this.#receivedTime(sellerId, broadcastId)
      return this.#o.db.transaction(async (tx): Promise<BandOutcome> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, broadcast.date, broadcast.rehearsal)})`)
        await tx.execute(sql`select pg_advisory_xact_lock(${sellerLinkLockKey(sellerId)})`)
        const link = await latestBandLink(tx, sellerId, broadcastId)
        if (link === null || link.state === 'FINISHED') return fail(409, 'NOT_LINKED', BAND_MESSAGES.NOT_LINKED)
        const now = this.#now()
        await finishBandLinks(tx, sellerId, 'UNLINKED', now, { linkId: link.id, by: accountId })
        const result: BandOutcome = { status: 200, body: { link: await this.#viewOf(sellerId, broadcastId, await findBandLink(tx, sellerId, link.id), tx, receivedTime) } }
        await insertRequest(tx, sellerId, requestId, JSON.stringify(result), now)
        finished = link.id
        return result
      })
    })
    const linkId = finished as number | null
    if (linkId !== null) {
      this.#retire(sellerId, linkId)
      this.#publishLink(sellerId, broadcastId)
    }
    return outcome
  }

  /** 알림 확인 (AC-BND1-41): upTo까지 확인한 것으로 (더 큰 번호는 그대로). 같은 upTo 두 번 = 같은 결과 */
  async noticesSeen(sellerId: string, broadcastId: string, upTo: number): Promise<BandOutcome> {
    if ((await findBroadcast(this.#o.db, sellerId, broadcastId)) === null) return notFound()
    const link = await latestBandLink(this.#o.db, sellerId, broadcastId)
    if (link === null) return fail(409, 'NOT_LINKED', BAND_MESSAGES.NOT_LINKED)
    await markBandNoticesSeen(this.#o.db, sellerId, link.id, upTo)
    this.#publishLink(sellerId, broadcastId)
    return { status: 200, body: { link: await this.#viewOf(sellerId, broadcastId, await findBandLink(this.#o.db, sellerId, link.id)) } }
  }

  /**
   * 기록 트랜잭션 안 (ScopeWriter txHook): broadcast.end가 기록되면 그 회차의 밴드 글 연결을 FINISHED(ENDED)로(같이 커밋) — 커밋된 뒤 읽기를 멈춘다.
   * 마지막 읽기는 없다 (AC-BND1-23)
   */
  readonly txHook = async (tx: Db, ctx: { readonly sellerId: string; readonly rehearsal: boolean; readonly now: Date; readonly records: readonly { readonly type: string; readonly changed: boolean; readonly event: unknown }[] }): Promise<(() => void) | null> => {
    if (ctx.rehearsal) return null
    const ended = ctx.records.filter((record) => record.type === 'broadcast.end' && record.changed).map((record) => (record.event as { b: string }).b)
    if (ended.length === 0) return null
    const done = await finishBandLinks(tx, ctx.sellerId, 'ENDED', ctx.now, { broadcastIds: ended })
    if (done.length === 0) return null
    return () => {
      for (const link of done) {
        this.#retire(ctx.sellerId, link.id)
        this.#publishLink(ctx.sellerId, link.broadcastId)
      }
    }
  }

  // ── 읽기 (AC-BND1-30~37·40·50~55) ────────────────────────────────────

  /** 읽기 하나를 만든다 (판매자마다 하나 — 앞 것은 버린다). soon = 바로 전체 읽기(다시 켜기·다시 연결) */
  #open(sellerId: string, linkId: number, soon: boolean): void {
    if (this.#closed) return
    const before = this.#entries.get(sellerId)
    if (before !== undefined && before.linkId === linkId && !before.closed) {
      if (soon && before.running === null) {
        before.lastFullAt = Number.NEGATIVE_INFINITY
        this.#schedule(before, 0)
      }
      return
    }
    this.#retire(sellerId)
    const entry: Entry = { sellerId, linkId, cancel: null, running: null, closed: false, lastFullAt: soon ? Number.NEGATIVE_INFINITY : this.#clock.now(), rateMs: 0 }
    this.#entries.set(sellerId, entry)
    this.#schedule(entry, soon ? 0 : this.#timing.fastMs)
  }

  #retire(sellerId: string, linkId?: number): void {
    const entry = this.#entries.get(sellerId)
    if (entry === undefined || (linkId !== undefined && entry.linkId !== linkId)) return
    entry.closed = true
    entry.cancel?.()
    entry.cancel = null
    this.#entries.delete(sellerId)
  }

  #schedule(entry: Entry, ms: number): void {
    if (entry.closed || this.#closed) return
    entry.cancel?.()
    entry.cancel = this.#clock.setTimer(Math.max(0, ms), () => {
      entry.cancel = null
      if (entry.closed || entry.running !== null) return
      const run = this.#cycle(entry)
        .catch((error: unknown) => {
          this.#o.log({ level: 'error', code: 'BAND_READ_FAILED', seller: entry.sellerId, errorKind: errorKind(error) })
          return this.#retryLater(entry, 'ERROR')
        })
        .finally(() => {
          entry.running = null
        })
      entry.running = run
      void this.#track(run)
    })
  }

  /** 한 번 읽고 다음 읽기를 건다 */
  async #cycle(entry: Entry): Promise<void> {
    const { sellerId, linkId } = entry
    const db = this.#o.db
    const link = await findBandLink(db, sellerId, linkId)
    if (link === null || !BAND_ACTIVE_STATES.includes(link.state)) return this.#retire(sellerId, linkId)
    // 유튜브가 이어졌으면 멈춘다 (D-BND1-12 — 유튜브 방송 후 요약이 band:를 거르지 않는다)
    if (await youtubeEverLinked(db, sellerId, link.broadcastId)) {
      await setBandLinkState(db, sellerId, linkId, BAND_ACTIVE_STATES, { state: 'YOUTUBE_LINKED', retryAt: null })
      this.#o.log({ level: 'warn', code: 'BAND_YOUTUBE_LINKED', seller: sellerId })
      this.#retire(sellerId, linkId)
      return this.#publishLink(sellerId, link.broadcastId)
    }
    const got = await this.#tokenOf(sellerId)
    if (!got.ok) {
      // 계정이 없거나 풀림 — 끊기면 연결은 이미 끝났다. 남은 것은 다시 연결 필요로
      if (got.outcome.status === 409 && (got.outcome.body['error'] as Obj)['code'] === 'RECONNECT_NEEDED') await this.#reconnectNeeded(sellerId)
      return this.#retire(sellerId, linkId)
    }
    const client = this.#client as BandClient
    const paused = client.appPauseRemaining()
    if (paused > 0) return this.#rateWait(entry, link, paused)
    const full = link.state === 'READING' && this.#clock.now() - entry.lastFullAt >= this.#timing.fullMs
    if (full) entry.lastFullAt = this.#clock.now()
    const read = await this.#readComments(sellerId, got.token, link.bandKey, link.postKey, full ? 'full' : 'fast', linkId)
    if (entry.closed) return
    if (!read.ok) return this.#failed(entry, link, read.failure)
    const done = await this.#ingest(entry, link, got.account, read, full)
    if (!done || entry.closed) return
    entry.rateMs = 0
    this.#schedule(entry, this.#timing.fastMs)
  }

  /**
   * 댓글 목록 읽기 (D-BND1-08). fast = 최신순, 본 댓글이 나온 쪽에서 멈춤, 5쪽까지. full = 오래된 순 처음부터 끝까지, 1,000개까지(넘으면 overflow).
   * 다음 쪽은 next_params의 값 가운데 토큰·밴드 키·글 키를 버리고 우리 값으로 채운다. 같은 after가 다시 나오면 그 읽기를 끝낸다(고리).
   * 돌려주는 items는 오래된 것부터의 차례다
   */
  async #readComments(sellerId: string, token: string, bandKey: string, postKey: string, mode: 'fast' | 'full', linkId?: number): Promise<ReadResult> {
    const client = this.#client as BandClient
    const collected: unknown[] = []
    const afters = new Set<string>()
    let params: Readonly<Record<string, string>> = {}
    for (let page = 1; ; page += 1) {
      const result = await client.api('comments', token, { ...params, band_key: bandKey, post_key: postKey, sort: mode === 'full' ? '+created_at' : '-created_at' }, sellerId)
      if (!result.ok) return result
      const items = result.data['items']
      if (!Array.isArray(items)) return { ok: false, failure: { kind: 'RETRY', code: 'SHAPE' } }
      collected.push(...items)
      if (mode === 'full' && collected.length > this.#timing.fullMax) return { ok: true, items: collected.slice(0, this.#timing.fullMax), complete: false, overflow: true }
      if (mode === 'fast' && linkId !== undefined) {
        const keys = items.map((item) => (isObj(item) ? item['comment_key'] : undefined)).filter((key): key is string => typeof key === 'string')
        if ((await seenBandKeys(this.#o.db, sellerId, linkId, keys)).size > 0) break
      }
      const paging = result.data['paging']
      const next = pagingParams(isObj(paging) ? paging['next_params'] : undefined)
      if (next === null) return { ok: true, items: mode === 'full' ? collected : collected.reverse(), complete: mode === 'full', overflow: false }
      const after = next['after'] ?? JSON.stringify(next)
      if (afters.has(after)) {
        this.#o.log({ level: 'warn', code: 'BAND_PAGING_LOOP', seller: sellerId })
        return { ok: true, items: mode === 'full' ? collected : collected.reverse(), complete: false, overflow: false }
      }
      afters.add(after)
      if (mode === 'fast' && page >= this.#timing.fastPages) break
      params = next
    }
    return { ok: true, items: collected.reverse(), complete: false, overflow: false }
  }

  /** 읽은 목록 → 기록·본 댓글 표·수·지운/고친 댓글·늦게 읽음 알림. false면 다음 읽기를 이미 정했다(실패·멈춤) */
  async #ingest(entry: Entry, link: BandLinkRow, account: BandAccountRow, read: Extract<ReadResult, { ok: true }>, full: boolean): Promise<boolean> {
    const { sellerId, linkId } = entry
    const db = this.#o.db
    const keys = read.items.map((item) => (isObj(item) ? item['comment_key'] : undefined)).filter((key): key is string => typeof key === 'string')
    const known = await seenBandKeys(db, sellerId, linkId, keys)
    const batch = bandBatch({ sellerUserKey: account.userKey, postKey: link.postKey, known, items: read.items })
    const recorded = await this.#o.record({
      sellerId,
      date: link.date,
      b: link.broadcastId,
      chats: batch.record.map((entry) => entry.chat),
      guard: async (tx) => {
        const now = await findBandLink(tx, sellerId, linkId)
        return now !== null && BAND_ACTIVE_STATES.includes(now.state) && !(await youtubeEverLinked(tx, sellerId, link.broadcastId))
      },
    })
    if (recorded.kind === 'rejected') {
      // 끊기·회차 끝·유튜브 잇기 뒤 — 다음 읽기에서 상태를 본다
      this.#schedule(entry, 0)
      return false
    }
    if (recorded.kind === 'save_failed') {
      this.#o.log({ level: 'error', code: 'BAND_SAVE_FAILED', seller: sellerId, count: batch.record.length })
      await this.#retryLater(entry, 'SAVE')
      return false
    }
    const kept = new Set([...recorded.recorded, ...recorded.existing])
    const now = this.#now()
    const seen: BandSeenInput[] = []
    for (const item of batch.record) {
      if (kept.has(item.chat.id)) seen.push({ commentKey: item.key, kind: 'RECORDED', textHash: bandHash(item.chat.text), nick: item.chat.nick, text: item.chat.text })
      else seen.push({ commentKey: item.key, kind: 'SKIPPED' })
    }
    for (const skip of batch.skip) if (skip.key !== null && skip.code !== 'BAD_COMMENT_KEY' && skip.code !== 'DUPLICATE' && skip.key.length <= 1024) seen.push({ commentKey: skip.key, kind: 'SKIPPED' })
    await this.#o.hooks?.beforeSeen?.()
    await insertBandSeen(db, sellerId, linkId, seen, now)
    const add: Partial<Record<BandSkipColumn, number>> = {}
    for (const skip of batch.skip) {
      const column = SKIP_COLUMNS[skip.code]
      if (column !== undefined) add[column] = (add[column] ?? 0) + 1
    }
    const keyless = full ? batch.skip.filter((skip) => skip.code === 'BAD_COMMENT_KEY').length : null
    await bumpBandSkips(db, sellerId, linkId, add, keyless)
    if (recorded.skipped.length > 0) this.#o.log({ level: 'warn', code: 'BAND_SKIPPED', seller: sellerId, count: recorded.skipped.length })
    if (full && read.complete) await this.#edits(sellerId, linkId, read.items)
    // 오래 못 읽다가 다시 읽어 새 댓글을 넣음 (AC-BND1-54)
    const last = link.lastReadAt?.getTime() ?? null
    const gap = last === null ? 0 : now.getTime() - last
    if (recorded.recorded.length > 0 && gap > this.#timing.lateMs) {
      await insertBandNotice(db, { sellerId, linkId, kind: 'LATE', minutes: Math.max(1, Math.ceil(gap / 60_000)), count: recorded.recorded.length, now })
    }
    await setBandLinkState(db, sellerId, linkId, BAND_ACTIVE_STATES, { state: 'READING', failures: 0, retryAt: null, rateLimited: false, lastReadAt: now })
    this.#publishLink(sellerId, link.broadcastId)
    return true
  }

  /** 끝까지 된 전체 읽기에서만: 기록한 댓글이 없으면 지운 댓글, 바꾼 본문이 다르면 고친 댓글 (D-BND1-09) */
  async #edits(sellerId: string, linkId: number, items: readonly unknown[]): Promise<void> {
    const db = this.#o.db
    const byKey = new Map<string, Obj>()
    for (const item of items) if (isObj(item) && typeof item['comment_key'] === 'string') byKey.set(item['comment_key'], item)
    const now = this.#now()
    for (const row of await recordedBandSeen(db, sellerId, linkId)) {
      const item = byKey.get(row.commentKey)
      if (item === undefined) {
        if (row.deletedNoticed) continue
        await insertBandNotice(db, { sellerId, linkId, kind: 'DELETED', nick: row.nick, beforeText: row.text, now })
        await markBandSeen(db, sellerId, row.id, { deletedNoticed: true })
        continue
      }
      const text = bandText(item['content']) ?? ''
      const hash = bandHash(text)
      if (hash === row.textHash || hash === row.editedHash) continue
      await insertBandNotice(db, { sellerId, linkId, kind: 'EDITED', nick: row.nick, beforeText: row.text, afterText: text, now })
      await markBandSeen(db, sellerId, row.id, { editedHash: hash })
    }
  }

  /** 읽기 실패 나누기 (AC-BND1-51) */
  async #failed(entry: Entry, link: BandLinkRow, failure: BandFailure): Promise<void> {
    const { sellerId, linkId } = entry
    if (failure.kind === 'RECONNECT') {
      await this.#reconnectNeeded(sellerId)
      return this.#retire(sellerId, linkId)
    }
    if (failure.kind === 'NO_ACCESS') {
      await setBandLinkState(this.#o.db, sellerId, linkId, BAND_ACTIVE_STATES, { state: 'NO_ACCESS', retryAt: null, rateLimited: false })
      this.#retire(sellerId, linkId)
      return this.#publishLink(sellerId, link.broadcastId)
    }
    if (failure.kind === 'RATE_SELLER') {
      entry.rateMs = entry.rateMs === 0 ? this.#timing.sellerRateFirstMs : Math.min(this.#timing.sellerRateMaxMs, entry.rateMs * 2)
      return this.#rateWait(entry, link, entry.rateMs)
    }
    if (failure.kind === 'RATE_APP') return this.#rateWait(entry, link, (this.#client as BandClient).appPauseRemaining())
    return this.#retryLater(entry, failure.code)
  }

  /** 호출 한도로 쉼: RETRYING(쉬는 문장)으로 두고 ms 뒤 다시 읽는다 */
  async #rateWait(entry: Entry, link: BandLinkRow, ms: number): Promise<void> {
    const wait = Math.max(1, ms)
    await setBandLinkState(this.#o.db, entry.sellerId, entry.linkId, BAND_ACTIVE_STATES, { state: 'RETRYING', rateLimited: true, retryAt: new Date(this.#clock.now() + wait) })
    this.#schedule(entry, wait)
    this.#publishLink(entry.sellerId, link.broadcastId)
  }

  /** 다시 시도 시간표: 첫 실패 뒤 10·20·40·80·160초, 그 뒤 300초마다 (AC-BND1-52) */
  async #retryLater(entry: Entry, _code: string): Promise<void> {
    if (entry.closed) return
    const link = await findBandLink(this.#o.db, entry.sellerId, entry.linkId)
    if (link === null || !BAND_ACTIVE_STATES.includes(link.state)) return this.#retire(entry.sellerId, entry.linkId)
    const failures = link.failures + 1
    const wait = this.#timing.retryMs[failures - 1] ?? this.#timing.retryEveryMs
    await setBandLinkState(this.#o.db, entry.sellerId, entry.linkId, BAND_ACTIVE_STATES, { state: 'RETRYING', failures, rateLimited: false, retryAt: new Date(this.#clock.now() + wait) })
    this.#schedule(entry, wait)
    this.#publishLink(entry.sellerId, link.broadcastId)
  }

  // ── 서버 시작·운영 ─────────────────────────────────────────────────────

  /** 서버가 다시 켜지면 (NFR-03, AC-BND1-23): 끝나지 않은 실제 회차의 READING·RETRYING 연결을 바로 다시 읽는다. 보관 기간 지난 글 지우기를 건다 */
  async resume(): Promise<number> {
    this.#scheduleErase(0)
    if (!this.configured) return 0
    let resumed = 0
    try {
      for (const link of await resumableBandLinks(this.#o.db)) {
        if (this.#closed) break
        this.#open(link.sellerId, link.id, true)
        resumed += 1
      }
    } catch (error) {
      this.#o.log({ level: 'error', code: 'BAND_RESUME_FAILED', errorKind: errorKind(error) })
    }
    return resumed
  }

  #scheduleErase(ms: number): void {
    if (this.#closed) return
    this.#eraseCancel?.()
    this.#eraseCancel = this.#clock.setTimer(ms, () => {
      void this.#track(this.eraseOld())
        .catch(() => undefined)
        .finally(() => this.#scheduleErase(this.#timing.eraseEveryMs))
    })
  }

  /** 보관 기간이 지난 손님 글 지우기 (D-BND1-14) — 지운 알림 수 */
  async eraseOld(): Promise<number> {
    try {
      return await eraseOldBandTexts(this.#o.db, this.#cutoffDate())
    } catch (error) {
      this.#o.log({ level: 'error', code: 'BAND_ERASE_FAILED', errorKind: errorKind(error) })
      return 0
    }
  }

  /** 운영 상태 (AC-BND1-64): 상태별 연결 수와 앱 전체 호출 한도 쉼 — 판매자 정보 없이 */
  async opsStatus(): Promise<Record<string, unknown>> {
    const remaining = this.#client?.appPauseRemaining() ?? 0
    return { configured: this.configured, links: await bandLinkCounts(this.#o.db), appPause: { active: remaining > 0, remainingSeconds: Math.ceil(remaining / 1000) }, readers: this.#entries.size }
  }

  /** 읽기·잇기가 모두 끝날 때까지 (시험·종료) */
  async idle(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const pending = [...this.#pending]
      if (pending.length === 0) return
      await Promise.allSettled(pending)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  /** 지금 읽기를 도는 판매자 수 (시험) */
  get readers(): number {
    return this.#entries.size
  }

  close(): void {
    this.#closed = true
    this.#eraseCancel?.()
    for (const sellerId of [...this.#entries.keys()]) this.#retire(sellerId)
  }
}
