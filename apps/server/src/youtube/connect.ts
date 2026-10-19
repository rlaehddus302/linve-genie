// 구글 연결 (AC-Y1-01~06·31, D-Y02·D-Y12).
// - 연결: 읽기 권한(youtube.readonly)만. 게시 권한(youtube.force-ssl)은 자동 게시에 동의할 때 더 받는다(include_granted_scopes).
//   다시 연결(같은 채널)은 게시 권한을 받았거나 동의를 켠 적이 있으면 게시 권한도 함께 요청하고, 받지 못하면 동의를 끈다.
// - 승인 요청: PKCE(S256, 검증 값 86자)와 state(무작위 32바이트) — state는 로그인 세션에 묶여 해시로만 서버에 두고 10분·한 번만 쓴다.
//   검증 값은 마스터 키로 암호화해 둔다. 둘 다 응답의 승인 주소 밖 어디에도(로그·이벤트 기록) 남지 않는다.
// - 토큰: 새로 고침·접근 토큰은 마스터 키로 암호화해 저장한다. 접근 토큰은 만료 60초 전에 새로 고치고 같은 판매자의 새로 고침은 동시에 하나만 한다.
//   유튜브가 401을 주면 한 번 새로 고쳐 한 번 더. invalid_grant거나 토큰을 풀 수 없으면(마스터 키 바뀜) "다시 연결 필요".
// - 채널: 판매자마다 하나, 같은 채널은 한 판매자에만. 다른 채널로 다시 승인하면 받지 않는다(같은 채널이면 토큰만 바꾼다).
// - 끊기: 구글에 폐기 요청(실패·타임아웃이어도 계속) → 토큰·게시 동의 삭제 → 수집기 멈춤.
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, lt, ne } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { youtubeConnections, youtubeOauthStates } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import { openText, sealText } from '../secrets.ts'
import { uniqueViolation } from '../writer.ts'
import { GoogleError, PUBLISH_SCOPE, READ_SCOPE, type GoogleClient } from './google.ts'
import type { Timer } from './timer.ts'

export type ConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'
export type ConsentTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT'
export const CONSENT_TARGETS: readonly ConsentTarget[] = ['LIVE_CHAT', 'VIDEO_COMMENT']

/** state 유효 시간 (AC-Y1-01) */
export const STATE_TTL_MS = 10 * 60 * 1000
/** 접근 토큰을 이만큼 남기고 새로 고친다 (AC-Y1-04) */
export const REFRESH_BEFORE_MS = 60 * 1000

/** 돌아오기 결과 코드와 판매자에게 보이는 문장 (AC-Y1-02) */
export const CALLBACK_MESSAGES = {
  connected: '유튜브 채널을 연결했어요.',
  STATE_INVALID: '연결 시간이 지났어요. 다시 시도해 주세요.',
  ACCESS_DENIED: '구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.',
  NO_CHANNEL: '이 구글 계정에는 유튜브 채널이 없어요.',
  CHANNEL_TAKEN: '이 채널은 연결할 수 없어요. 운영자에게 문의해 주세요.',
  CHANNEL_MISMATCH: '처음 연결한 채널과 달라요. 바꾸려면 먼저 연결을 끊어 주세요.',
  GOOGLE_FAILED: '구글에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
} as const
export type CallbackResult = keyof typeof CALLBACK_MESSAGES

/** "다시 연결 필요"·"연결 안 됨" 문장 */
export const RECONNECT_MESSAGE = '유튜브 연결을 다시 해 주세요.'
export const NOT_CONNECTED_MESSAGE = '유튜브 채널을 먼저 연결해 주세요.'

/** 연결이 없거나 다시 연결해야 해서 유튜브를 부를 수 없다 */
export class YoutubeAccessError extends Error {
  readonly status: Exclude<ConnectionStatus, 'CONNECTED'>
  constructor(status: Exclude<ConnectionStatus, 'CONNECTED'>) {
    super(status)
    this.name = 'YoutubeAccessError'
    this.status = status
  }
}

export interface ConnectionView {
  readonly status: ConnectionStatus
  readonly channel: { readonly id: string; readonly title: string } | null
  /** 받은 권한 (읽기·게시) */
  readonly permissions: { readonly read: boolean; readonly publish: boolean }
  /** 게시 동의 (대상마다 — 켜짐 여부·켠 시각 UTC ISO) */
  readonly consent: {
    readonly liveChat: { readonly enabled: boolean; readonly at: string | null }
    readonly videoComment: { readonly enabled: boolean; readonly at: string | null }
  }
}

export interface ConnectionRow {
  readonly sellerId: string
  readonly channelId: string
  readonly channelTitle: string
  readonly status: string
  readonly canPublish: boolean
  readonly refreshEnc: string | null
  readonly accessEnc: string | null
  readonly accessExpiresAt: Date | null
  readonly consentLiveChatAt: Date | null
  readonly consentVideoCommentAt: Date | null
}

export interface SessionInfo {
  readonly sellerId: string
  readonly accountId: string
  /** 세션 토큰 해시 (state를 그 세션에 묶는다) */
  readonly tokenHash: string
}

export interface ConnectionsOptions {
  readonly db: Db
  readonly masterKey: Buffer
  readonly google: GoogleClient
  readonly timer: Timer
  readonly log: LogSink
  /** 연결 상태가 바뀌었다 (수집기·발송함 깨우기, SSE) */
  readonly onStatus: (sellerId: string, view: ConnectionView) => void
  /** 동의가 꺼졌다 (그 대상의 기다리던 발송함 행 → 보내지 못함(NO_CONSENT)) */
  readonly onConsentOff: (sellerId: string, targets: readonly ConsentTarget[]) => Promise<void>
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url')
const tokenAad = (sellerId: string, kind: 'refresh' | 'access') => `livejjim/youtube-token/v1/${sellerId}/${kind}`
const verifierAad = (sellerId: string, stateHash: string) => `livejjim/youtube-verifier/v1/${sellerId}/${stateHash}`

const columns = {
  sellerId: youtubeConnections.sellerId,
  channelId: youtubeConnections.channelId,
  channelTitle: youtubeConnections.channelTitle,
  status: youtubeConnections.status,
  canPublish: youtubeConnections.canPublish,
  refreshEnc: youtubeConnections.refreshEnc,
  accessEnc: youtubeConnections.accessEnc,
  accessExpiresAt: youtubeConnections.accessExpiresAt,
  consentLiveChatAt: youtubeConnections.consentLiveChatAt,
  consentVideoCommentAt: youtubeConnections.consentVideoCommentAt,
}

export function viewOf(row: ConnectionRow | null): ConnectionView {
  if (row === null) {
    return {
      status: 'NOT_CONNECTED',
      channel: null,
      permissions: { read: false, publish: false },
      consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } },
    }
  }
  return {
    status: row.status === 'CONNECTED' ? 'CONNECTED' : 'RECONNECT_NEEDED',
    channel: { id: row.channelId, title: row.channelTitle },
    permissions: { read: true, publish: row.canPublish },
    consent: {
      liveChat: { enabled: row.consentLiveChatAt !== null, at: row.consentLiveChatAt?.toISOString() ?? null },
      videoComment: { enabled: row.consentVideoCommentAt !== null, at: row.consentVideoCommentAt?.toISOString() ?? null },
    },
  }
}

export class YoutubeConnections {
  readonly #options: ConnectionsOptions
  /** 판매자별 진행 중인 새로 고침 (동시에 하나만) */
  readonly #refreshing = new Map<string, Promise<string>>()

  constructor(options: ConnectionsOptions) {
    this.#options = options
  }

  async row(sellerId: string): Promise<ConnectionRow | null> {
    const rows = await this.#options.db.select(columns).from(youtubeConnections).where(eq(youtubeConnections.sellerId, sellerId)).limit(1)
    return rows[0] ?? null
  }

  async status(sellerId: string): Promise<ConnectionView> {
    return viewOf(await this.row(sellerId))
  }

  async #changed(sellerId: string): Promise<void> {
    try {
      this.#options.onStatus(sellerId, await this.status(sellerId))
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'WORKER_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  // ── 승인 시작 (AC-Y1-01·31) ───────────────────────────────────────────

  /** 승인 주소를 만들고 state(해시)·검증 값(암호화)을 그 세션에 묶어 둔다 */
  async start(session: SessionInfo, purpose: 'connect' | 'publish', target: ConsentTarget | null = null): Promise<string> {
    const { db, masterKey, google, timer } = this.#options
    const now = timer.now()
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
    const stateHash = sha256(state)
    await db.delete(youtubeOauthStates).where(and(eq(youtubeOauthStates.sellerId, session.sellerId), lt(youtubeOauthStates.expiresAt, new Date(now))))
    await db.insert(youtubeOauthStates).values({
      stateHash,
      sellerId: session.sellerId,
      sessionHash: session.tokenHash,
      accountId: session.accountId,
      verifierEnc: sealText(masterKey, verifierAad(session.sellerId, stateHash), verifier),
      purpose,
      target,
      createdAt: new Date(now),
      expiresAt: new Date(now + STATE_TTL_MS),
    })
    // 다시 연결(같은 채널): 게시 권한을 받았거나 동의를 켠 적이 있으면 게시 권한도 함께 다시 받는다 — 권한을 거둔 뒤 다시 연결해도
    // "동의는 켜졌는데 게시 권한이 없는" 상태가 되지 않게 (AC-Y1-04·05·31, D-Y12). 처음 연결은 읽기 권한 하나만 (AC-Y1-01)
    const existing = purpose === 'connect' ? await this.row(session.sellerId) : null
    const keepPublish = existing !== null && (existing.canPublish || existing.consentLiveChatAt !== null || existing.consentVideoCommentAt !== null)
    const scopes = purpose === 'publish' ? [PUBLISH_SCOPE] : keepPublish ? [READ_SCOPE, PUBLISH_SCOPE] : [READ_SCOPE]
    return google.authorizeUrl({ scopes, state, challenge, incremental: purpose === 'publish' || keepPublish })
  }

  // ── 돌아오기 (AC-Y1-02) ──────────────────────────────────────────────

  /**
   * 돌아오는 주소. state가 그 세션의 것이고 10분 안이고 처음 쓰는 것일 때만 code를 토큰으로 바꾼다(검증 값과 함께).
   * 같은 state로 두 번 와도 한 번만 처리한다(쓴 표시를 한 문장으로 먼저 단다)
   */
  async callback(session: SessionInfo | null, params: { code?: string; state?: string; error?: string }): Promise<CallbackResult> {
    const { db, masterKey, google, timer, log } = this.#options
    const now = timer.now()
    if (session === null || typeof params.state !== 'string' || params.state === '' || params.state.length > 200) return 'STATE_INVALID'
    const stateHash = sha256(params.state)
    // 한 번만: 그 세션·판매자의 state 행을 한 문장으로 지우며 꺼낸다 — 동시에 두 번 와도 하나만 행을 돌려받는다.
    // 다른 세션이 보낸 state는 지우지 않는다(그 세션의 연결을 망치지 않게)
    const claimed = await db
      .delete(youtubeOauthStates)
      .where(and(eq(youtubeOauthStates.stateHash, stateHash), eq(youtubeOauthStates.sellerId, session.sellerId), eq(youtubeOauthStates.sessionHash, session.tokenHash)))
      .returning({
        accountId: youtubeOauthStates.accountId,
        verifierEnc: youtubeOauthStates.verifierEnc,
        purpose: youtubeOauthStates.purpose,
        target: youtubeOauthStates.target,
        expiresAt: youtubeOauthStates.expiresAt,
        usedAt: youtubeOauthStates.usedAt,
      })
    const row = claimed[0]
    if (row === undefined || row.usedAt !== null || row.expiresAt.getTime() <= now) return 'STATE_INVALID'
    if (params.error !== undefined) return 'ACCESS_DENIED'
    if (typeof params.code !== 'string' || params.code === '' || params.code.length > 2048) return 'STATE_INVALID'
    let verifier: string
    try {
      verifier = openText(masterKey, verifierAad(session.sellerId, stateHash), row.verifierEnc)
    } catch {
      return 'STATE_INVALID'
    }
    let tokens
    try {
      tokens = await google.exchangeCode(params.code, verifier)
    } catch (error) {
      log({ level: 'warn', code: 'YOUTUBE_CONNECT_FAILED', seller: session.sellerId, ...googleFields(error) })
      return 'GOOGLE_FAILED'
    }
    let channel: { id: string; title: string } | null
    try {
      channel = await this.#mine(session.sellerId, tokens.accessToken)
    } catch (error) {
      log({ level: 'warn', code: 'YOUTUBE_CONNECT_FAILED', seller: session.sellerId, ...googleFields(error) })
      return 'GOOGLE_FAILED'
    }
    if (channel === null) return 'NO_CHANNEL'
    const result = await this.#save(session.sellerId, channel, tokens, now)
    if (result !== 'connected') return result
    // 게시 권한을 받으러 온 것이고 받았으면 그 대상의 동의를 켠다 (AC-Y1-31) — 이미 켜져 있으면 켠 시각·계정은 그대로 (AC-Y1-95)
    if (row.purpose === 'publish' && tokens.scopes.includes(PUBLISH_SCOPE) && (row.target === 'LIVE_CHAT' || row.target === 'VIDEO_COMMENT')) {
      await this.#setConsentRow(session.sellerId, row.target, true, row.accountId, now)
    }
    // 다시 연결에서 게시 권한을 받지 못했으면(구글 화면에서 뺌 등) 켜져 있던 동의를 끈다 — 켜진 동의는 늘 게시 권한과 함께다.
    // 그 대상의 기다리던 행은 보내지 못함(NO_CONSENT), 상태 알림으로 화면에 알린다
    const saved = await this.row(session.sellerId)
    if (saved !== null && !saved.canPublish) {
      for (const target of CONSENT_TARGETS) {
        if (YoutubeConnections.consentAt(saved, target) === null) continue
        await this.#setConsentRow(session.sellerId, target, false, null, now)
        await this.#options.onConsentOff(session.sellerId, [target])
      }
    }
    await this.#changed(session.sellerId)
    return 'connected'
  }

  /** channels.list mine=true (그 토큰의 채널) */
  async #mine(sellerId: string, accessToken: string): Promise<{ id: string; title: string } | null> {
    const body = await this.#options.google.api({ sellerId, method: 'channels.list', accessToken, path: '/channels', query: { part: 'snippet', mine: 'true' } })
    const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
    const first = items[0]
    if (first === undefined || typeof first.id !== 'string' || first.id === '') return null
    const snippet = (first.snippet ?? {}) as Record<string, unknown>
    return { id: first.id, title: typeof snippet.title === 'string' ? snippet.title.slice(0, 200) : '' }
  }

  async #save(sellerId: string, channel: { id: string; title: string }, tokens: { accessToken: string; refreshToken: string | null; expiresIn: number; scopes: readonly string[] }, now: number): Promise<CallbackResult> {
    const { db, masterKey } = this.#options
    const existing = await this.row(sellerId)
    if (existing !== null && existing.channelId !== channel.id) return 'CHANNEL_MISMATCH'
    const other = await db
      .select({ sellerId: youtubeConnections.sellerId })
      .from(youtubeConnections)
      .where(and(eq(youtubeConnections.channelId, channel.id), ne(youtubeConnections.sellerId, sellerId)))
      .limit(1)
    if (other.length > 0) return 'CHANNEL_TAKEN'
    const refreshEnc = tokens.refreshToken === null ? (existing?.refreshEnc ?? null) : sealText(masterKey, tokenAad(sellerId, 'refresh'), tokens.refreshToken)
    if (refreshEnc === null) return 'GOOGLE_FAILED'
    const values = {
      channelTitle: channel.title,
      status: 'CONNECTED',
      canPublish: tokens.scopes.includes(PUBLISH_SCOPE) || (existing?.canPublish === true && tokens.refreshToken === null),
      refreshEnc,
      accessEnc: sealText(masterKey, tokenAad(sellerId, 'access'), tokens.accessToken),
      accessExpiresAt: new Date(now + tokens.expiresIn * 1000),
      updatedAt: new Date(now),
    }
    try {
      await db
        .insert(youtubeConnections)
        .values({ sellerId, channelId: channel.id, connectedAt: new Date(now), ...values })
        .onConflictDoUpdate({ target: youtubeConnections.sellerId, set: values, setWhere: eq(youtubeConnections.channelId, channel.id) })
    } catch (error) {
      if (uniqueViolation(error) === 'youtube_connections_channel_uq') return 'CHANNEL_TAKEN'
      throw error
    }
    const saved = await this.row(sellerId)
    if (saved === null || saved.channelId !== channel.id) return 'CHANNEL_MISMATCH'
    return 'connected'
  }

  // ── 토큰 (AC-Y1-03·04) ───────────────────────────────────────────────

  /** "다시 연결 필요"로 바꾼다 (수집기 멈춤·발송함 기다림은 상태 알림을 받은 쪽이 한다) */
  async markReconnect(sellerId: string): Promise<void> {
    const updated = await this.#options.db
      .update(youtubeConnections)
      .set({ status: 'RECONNECT_NEEDED', updatedAt: new Date(this.#options.timer.now()) })
      .where(and(eq(youtubeConnections.sellerId, sellerId), eq(youtubeConnections.status, 'CONNECTED')))
      .returning({ sellerId: youtubeConnections.sellerId })
    if (updated.length > 0) {
      this.#options.log({ level: 'warn', code: 'YOUTUBE_RECONNECT_NEEDED', seller: sellerId })
      await this.#changed(sellerId)
    }
  }

  /** 지금 쓸 접근 토큰 (만료 60초 안이면 새로 고친다) */
  async accessToken(sellerId: string): Promise<string> {
    const row = await this.row(sellerId)
    if (row === null) throw new YoutubeAccessError('NOT_CONNECTED')
    if (row.status !== 'CONNECTED') throw new YoutubeAccessError('RECONNECT_NEEDED')
    const now = this.#options.timer.now()
    if (row.accessEnc !== null && row.accessExpiresAt !== null && row.accessExpiresAt.getTime() - now > REFRESH_BEFORE_MS) {
      try {
        return openText(this.#options.masterKey, tokenAad(sellerId, 'access'), row.accessEnc)
      } catch {
        await this.markReconnect(sellerId)
        throw new YoutubeAccessError('RECONNECT_NEEDED')
      }
    }
    return this.#refresh(sellerId, null)
  }

  /**
   * 새로 고침 (동시에 하나만). stale을 주면(401을 받은 토큰) 그사이 다른 쪽이 이미 새로 고쳤으면 그 토큰을 쓴다
   */
  #refresh(sellerId: string, stale: string | null): Promise<string> {
    const running = this.#refreshing.get(sellerId)
    if (running !== undefined) return running
    const task = this.#doRefresh(sellerId, stale).finally(() => {
      if (this.#refreshing.get(sellerId) === task) this.#refreshing.delete(sellerId)
    })
    this.#refreshing.set(sellerId, task)
    return task
  }

  async #doRefresh(sellerId: string, stale: string | null): Promise<string> {
    const { masterKey, google, timer, db, log } = this.#options
    const row = await this.row(sellerId)
    if (row === null) throw new YoutubeAccessError('NOT_CONNECTED')
    if (row.status !== 'CONNECTED' || row.refreshEnc === null) throw new YoutubeAccessError('RECONNECT_NEEDED')
    const now = timer.now()
    // 다른 쪽(다른 인스턴스)이 이미 새로 고쳤으면 그것을 쓴다
    if (row.accessEnc !== null && row.accessExpiresAt !== null && row.accessExpiresAt.getTime() - now > REFRESH_BEFORE_MS) {
      try {
        const current = openText(masterKey, tokenAad(sellerId, 'access'), row.accessEnc)
        if (stale === null || current !== stale) return current
      } catch {
        // 풀 수 없으면 새로 고친다
      }
    }
    let refreshToken: string
    try {
      refreshToken = openText(masterKey, tokenAad(sellerId, 'refresh'), row.refreshEnc)
    } catch {
      await this.markReconnect(sellerId)
      throw new YoutubeAccessError('RECONNECT_NEEDED')
    }
    let tokens
    try {
      tokens = await google.refresh(refreshToken)
    } catch (error) {
      if (error instanceof GoogleError && error.reason === 'invalid_grant') {
        await this.markReconnect(sellerId)
        throw new YoutubeAccessError('RECONNECT_NEEDED')
      }
      log({ level: 'warn', code: 'YOUTUBE_REFRESH_FAILED', seller: sellerId, ...googleFields(error) })
      throw error
    }
    await db
      .update(youtubeConnections)
      .set({
        accessEnc: sealText(masterKey, tokenAad(sellerId, 'access'), tokens.accessToken),
        accessExpiresAt: new Date(timer.now() + tokens.expiresIn * 1000),
        ...(tokens.refreshToken === null ? {} : { refreshEnc: sealText(masterKey, tokenAad(sellerId, 'refresh'), tokens.refreshToken) }),
        updatedAt: new Date(timer.now()),
      })
      .where(and(eq(youtubeConnections.sellerId, sellerId), eq(youtubeConnections.channelId, row.channelId)))
    return tokens.accessToken
  }

  /**
   * 토큰을 받아 유튜브를 부른다. 401이면 한 번 새로 고쳐 한 번 더 (AC-Y1-04). 연결이 없거나 다시 연결 필요면 YoutubeAccessError
   */
  async withToken<T>(sellerId: string, call: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.accessToken(sellerId)
    try {
      return await call(token)
    } catch (error) {
      if (!(error instanceof GoogleError) || error.status !== 401) throw error
      const next = await this.#refresh(sellerId, token)
      return call(next)
    }
  }

  // ── 게시 동의 (AC-Y1-31) ─────────────────────────────────────────────

  /**
   * 동의를 적는다. 켜기는 꺼져 있던 동의일 때만 켠 시각·계정을 적는다 — 이미 켜진 동의를 다시 켜는 요청(바로 켜기·게시 권한 승인을 거쳐 돌아오기·
   * 다시 연결)은 시각·계정을 바꾸지 않는다(그 사이 기다리던 감사가 NO_CONSENT로 빠지지 않게, AC-Y1-95·D-Y1-05). 끄면 지운다
   */
  async #setConsentRow(sellerId: string, target: ConsentTarget, enabled: boolean, accountId: string | null, now: number): Promise<void> {
    const at = enabled ? new Date(now) : null
    const by = enabled ? accountId : null
    const column = target === 'LIVE_CHAT' ? youtubeConnections.consentLiveChatAt : youtubeConnections.consentVideoCommentAt
    await this.#options.db
      .update(youtubeConnections)
      .set(target === 'LIVE_CHAT' ? { consentLiveChatAt: at, consentLiveChatBy: by, updatedAt: new Date(now) } : { consentVideoCommentAt: at, consentVideoCommentBy: by, updatedAt: new Date(now) })
      .where(and(eq(youtubeConnections.sellerId, sellerId), ...(enabled ? [isNull(column)] : [])))
  }

  /**
   * 동의 켜기·끄기. 켜려는데 게시 권한이 없으면 켜지 않고 구글 승인 주소를 돌려준다(승인을 마치고 돌아오면 그때 켜진다).
   * 연결이 없으면 not_connected. 끄면 그 대상의 기다리던 행은 보내지 못함(NO_CONSENT)
   */
  async setConsent(session: SessionInfo, target: ConsentTarget, enabled: boolean): Promise<{ kind: 'ok'; view: ConnectionView } | { kind: 'authorize'; url: string } | { kind: 'not_connected' }> {
    const row = await this.row(session.sellerId)
    if (row === null) return { kind: 'not_connected' }
    const now = this.#options.timer.now()
    if (enabled) {
      if (!row.canPublish || row.status !== 'CONNECTED') return { kind: 'authorize', url: await this.start(session, 'publish', target) }
      await this.#setConsentRow(session.sellerId, target, true, session.accountId, now)
    } else {
      await this.#setConsentRow(session.sellerId, target, false, null, now)
      await this.#options.onConsentOff(session.sellerId, [target])
    }
    await this.#changed(session.sellerId)
    return { kind: 'ok', view: await this.status(session.sellerId) }
  }

  /** 게시 권한을 받으러 가는 승인 주소 (수동 재전송을 처음 할 때 등) */
  publishAuthorizeUrl(session: SessionInfo): Promise<string> {
    return this.start(session, 'publish', null)
  }

  // ── 끊기 (AC-Y1-06) ──────────────────────────────────────────────────

  async disconnect(sellerId: string): Promise<ConnectionView> {
    const { db, masterKey, google, log } = this.#options
    const row = await this.row(sellerId)
    if (row === null) return viewOf(null)
    // 구글에 폐기 요청 (실패·타임아웃이어도 계속)
    try {
      const token = row.refreshEnc === null ? null : openText(masterKey, tokenAad(sellerId, 'refresh'), row.refreshEnc)
      if (token !== null) await google.revoke(token)
    } catch (error) {
      log({ level: 'warn', code: 'YOUTUBE_REVOKE_FAILED', seller: sellerId, ...googleFields(error) })
    }
    await db.delete(youtubeConnections).where(eq(youtubeConnections.sellerId, sellerId))
    await db.delete(youtubeOauthStates).where(eq(youtubeOauthStates.sellerId, sellerId))
    await this.#options.onConsentOff(sellerId, CONSENT_TARGETS)
    await this.#changed(sellerId)
    return viewOf(null)
  }

  /** 동의 시각 (효과가 나온 때 동의가 있었는지 — 켠 시각 ≤ 효과 시각) */
  static consentAt(row: ConnectionRow | null, target: ConsentTarget): Date | null {
    if (row === null) return null
    return target === 'LIVE_CHAT' ? row.consentLiveChatAt : row.consentVideoCommentAt
  }
}

/** 로그에 남길 구글 오류 필드 (종류·HTTP 상태·이유 코드만) */
export function googleFields(error: unknown): { errorKind: string; status?: number; reason?: string } {
  if (error instanceof GoogleError) return { errorKind: `Google_${error.kind}`, ...(error.status === null ? {} : { status: error.status }), ...(error.reason === null ? {} : { reason: error.reason }) }
  return { errorKind: errorKind(error) }
}
