// 인스타그램 계정 연결 (PLT-01, DAT-06, NFR-06, SYS-02, D-N2-06, AC-N2-10~17·41).
// - 연결 시작은 승인 주소를 돌려준다. state는 무작위 32바이트이고 그 로그인 세션에 묶여 해시로만 저장된다(10분·한 번).
// - 돌아오기(로그인 없이 닿는 주소)는 state로만 처리한다: 그 세션의 것이고 10분 안이고 처음 쓰는 것일 때만 code를 토큰으로 바꾼다.
// - 허락받은 프로페셔널 계정이 정확히 하나이고 댓글 읽기 권한이 있고, 그 계정이 다른 판매자에 없고, 이 판매자의 다른 계정이 아니며,
//   웹훅 구독까지 성공해야 저장한다. 결과는 코드로만 화면 주소에 붙인다(토큰·code는 주소에 넣지 않는다).
// - 토큰은 마스터 키로 암호화해 저장한다. 풀 수 없으면(마스터 키가 바뀜) 서버는 죽지 않고 그 연결을 "다시 연결 필요"로 본다.
// - 인스타그램 로그인의 긴 토큰은 만료 7일 안이고 받은 지 24시간이 지났으면 메타 호출 전에 새로 고친다(판매자마다 동시에 하나).
import { randomBytes } from 'node:crypto'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import { SecretError } from '../secrets.ts'
import type { Clock } from '../time.ts'
import { uniqueViolation } from '../writer.ts'
import type { InstagramLogin, InstagramSettings } from './config.ts'
import { openTokens, sealTokens, stateHash } from './crypto.ts'
import type { MetaClient, MetaConnection, MetaTokens } from './meta.ts'
import {
  connectionByAccount,
  deleteConnection,
  findConnection,
  findState,
  insertConnection,
  insertState,
  loginIdOf,
  markReconnectNeeded,
  refreshConnection,
  setConsent,
  unlinkedCounts,
  updateTokens,
  useState,
  type ConnectionRow,
} from './store.ts'

export type ConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'

/** OAuth state 유효 시간 (10분) */
export const STATE_TTL_MS = 10 * 60 * 1000
/** 인스타그램 로그인 긴 토큰: 만료가 이만큼 안으로 들어오고 */
export const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
/** 받은 지 이만큼 지났으면 새로 고친다 */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

/** 돌아오기 결과 코드 → 화면 문장 (화면은 ?instagram=<코드>를 받아 이 문장을 보여 준다, AC-N2-11·41) */
export const CALLBACK_MESSAGES = {
  CONNECTED: '인스타그램 계정을 연결했어요.',
  CONSENT_ON: '인스타그램 DM 자동 발송을 켰어요.',
  NO_MESSAGE_PERMISSION: 'DM을 보내는 권한을 허락하지 않아 자동 발송을 켜지 못했어요.',
  STATE_INVALID: '연결 시간이 지났어요. 다시 시도해 주세요.',
  DENIED: '인스타그램 연결을 허락하지 않았어요. 다시 시도해 주세요.',
  NO_ACCOUNT: '연결할 수 있는 인스타그램 프로페셔널(비즈니스·크리에이터) 계정이 없어요.',
  MANY_ACCOUNTS: '인스타그램 계정을 하나만 골라 다시 연결해 주세요.',
  NO_COMMENT_PERMISSION: '댓글을 읽는 권한을 허락해야 연결할 수 있어요. 다시 연결해 주세요.',
  ACCOUNT_TAKEN: '이 인스타그램 계정은 연결할 수 없어요. 운영자에게 문의해 주세요.',
  OTHER_ACCOUNT: '처음 연결한 계정과 달라요. 바꾸려면 먼저 연결을 끊어 주세요.',
  SUBSCRIBE_FAILED: '인스타그램 댓글 받기를 켜지 못했어요. 잠시 뒤 다시 연결해 주세요.',
  CONNECT_FAILED: '인스타그램 연결을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  NOT_CONFIGURED: '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.',
} as const

export type CallbackCode = keyof typeof CALLBACK_MESSAGES

export const CONNECTION_MESSAGES = {
  notConfigured: CALLBACK_MESSAGES.NOT_CONFIGURED,
  notConnected: '인스타그램 계정을 먼저 연결해 주세요.',
  reconnect: '인스타그램 연결을 다시 해 주세요.',
} as const

/** 연결 상태 조회 (AC-N2-15) — 토큰·만료 시각은 없다 */
export interface ConnectionView {
  readonly configured: boolean
  readonly status: ConnectionStatus
  readonly login: InstagramLogin | null
  readonly account: { readonly id: string; readonly username: string; readonly type: 'BUSINESS' | 'CREATOR' | null } | null
  readonly permissions: { readonly comments: boolean; readonly messages: boolean }
  readonly consent: { readonly on: boolean; readonly by: string | null; readonly at: string | null }
}

export interface ConnectionDeps {
  readonly db: Db
  readonly settings: InstagramSettings | null
  readonly meta: MetaClient | null
  readonly masterKey: Buffer
  readonly clock: Clock
  readonly log: LogSink
  /** 화면 앱 주소 (돌아오기 뒤 화면 주소) */
  readonly appOrigin: string
  /** 연결 상태가 바뀜 (SSE) */
  readonly onChange: (sellerId: string) => void
  /** 다시 연결 필요 → 연결됨 (기다리던 DM을 보낸다) */
  readonly onReconnected: (sellerId: string) => void
  /** 끊김: 기다리던 DM 행을 FAILED(NO_CONSENT)로 (같은 트랜잭션). 커밋된 뒤 부를 일(알림)을 돌려준다 */
  readonly onDisconnect: (tx: Db, sellerId: string, now: Date) => Promise<(() => void) | null>
  /** 동의 끔: 기다리던 DM 행을 FAILED(NO_CONSENT)로 (같은 트랜잭션). 커밋된 뒤 부를 일(알림)을 돌려준다 */
  readonly onConsentOff: (tx: Db, sellerId: string, now: Date) => Promise<(() => void) | null>
}

/** API를 부를 수 있는 연결 */
export type ApiConnection = { readonly ok: true; readonly row: ConnectionRow; readonly conn: MetaConnection } | { readonly ok: false; readonly failure: 'NOT_CONNECTED' | 'RECONNECT_NEEDED' | 'NOT_CONFIGURED' }

export type StartOutcome = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly code: 'NOT_CONFIGURED' | 'NOT_CONNECTED'; readonly message: string }

/** 세션 (로그인한 판매자) */
export interface SessionRef {
  readonly sellerId: string
  readonly accountId: string
  readonly tokenHash: string
}

export class InstagramConnections {
  readonly #deps: ConnectionDeps
  /** 판매자마다 진행 중인 새로 고침 (동시에 하나) */
  readonly #refreshing = new Map<string, Promise<void>>()

  constructor(deps: ConnectionDeps) {
    this.#deps = deps
  }

  get configured(): boolean {
    return this.#deps.settings !== null && this.#deps.meta !== null
  }

  #now(): Date {
    return new Date(this.#deps.clock.now())
  }

  async view(sellerId: string): Promise<ConnectionView> {
    const row = await findConnection(this.#deps.db, sellerId)
    const configured = this.configured
    if (row === null) {
      return { configured, status: 'NOT_CONNECTED', login: null, account: null, permissions: { comments: false, messages: false }, consent: { on: false, by: null, at: null } }
    }
    const by = row.consentBy === null ? null : await loginIdOf(this.#deps.db, sellerId, row.consentBy)
    return {
      configured,
      status: row.status === 'RECONNECT_NEEDED' ? 'RECONNECT_NEEDED' : 'CONNECTED',
      login: row.login === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK',
      account: { id: row.accountId, username: row.username, type: row.accountType === 'BUSINESS' || row.accountType === 'CREATOR' ? row.accountType : null },
      permissions: { comments: row.permComments, messages: row.permMessages },
      consent: { on: row.consentAt !== null, by, at: row.consentAt === null ? null : row.consentAt.toISOString() },
    }
  }

  /** 연결 상태 행 (웹훅·DM — 연결 계정 확인) */
  connection(sellerId: string, db: Db = this.#deps.db): Promise<ConnectionRow | null> {
    return findConnection(db, sellerId)
  }

  /** 이어지지 않은 라이브의 댓글 수(라이브마다)와 형식 틀린 댓글 수 (판매자 단위, AC-N2-24·35·37) */
  async unlinked(sellerId: string): Promise<{ lives: { platform: string; liveId: string; count: number; firstAt: string; lastAt: string }[]; malformed: number }> {
    const counts = await unlinkedCounts(this.#deps.db, sellerId)
    const row = await findConnection(this.#deps.db, sellerId)
    return {
      lives: counts.map((item) => ({ platform: item.platform, liveId: item.liveId, count: item.count, firstAt: item.firstAt.toISOString(), lastAt: item.lastAt.toISOString() })),
      malformed: row?.malformedCount ?? 0,
    }
  }

  byAccount(accountId: string): Promise<ConnectionRow | null> {
    return connectionByAccount(this.#deps.db, accountId)
  }

  /** 연결 시작·다시 연결 (AC-N2-10). purpose MESSAGES는 DM 동의를 켜려고 메시지 권한을 다시 묻는다(AC-N2-41) */
  async start(session: SessionRef, purpose: 'CONNECT' | 'MESSAGES'): Promise<StartOutcome> {
    const { settings, meta } = this.#deps
    if (settings === null || meta === null) return { ok: false, code: 'NOT_CONFIGURED', message: CONNECTION_MESSAGES.notConfigured }
    const state = randomBytes(32).toString('base64url')
    const now = this.#now()
    const existing = await findConnection(this.#deps.db, session.sellerId)
    const login: InstagramLogin = existing !== null && purpose === 'MESSAGES' ? (existing.login === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK') : settings.login
    await insertState(this.#deps.db, {
      sellerId: session.sellerId,
      accountId: session.accountId,
      sessionHash: session.tokenHash,
      stateHash: stateHash(state),
      purpose,
      login,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      now,
    })
    return { ok: true, url: meta.authorizeUrl(login, state, purpose === 'MESSAGES') }
  }

  /** 돌아오기 뒤 보낼 화면 주소 (결과 코드만 붙인다) */
  returnUrl(code: CallbackCode): string {
    const path = this.#deps.settings?.returnPath ?? '/'
    return `${this.#deps.appOrigin}${path}${path.includes('?') ? '&' : '?'}instagram=${code}`
  }

  /**
   * 돌아오기 (AC-N2-11·12·41). session은 이 요청의 쿠키로 찾은 로그인 세션(없으면 null).
   * state가 그 세션의 것이고 10분 안이고 처음 쓰는 것일 때만 처리한다 — 다른 세션이면 state를 쓰지 않은 채 STATE_INVALID
   */
  async callback(query: { readonly code?: string; readonly state?: string; readonly error?: string }, session: SessionRef | null): Promise<CallbackCode> {
    const { settings, meta, db } = this.#deps
    if (settings === null || meta === null) return 'NOT_CONFIGURED'
    if (query.state === undefined || query.state === '' || query.state.length > 200 || session === null) return 'STATE_INVALID'
    const now = this.#now()
    const row = await findState(db, stateHash(query.state))
    if (row === null || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime() || row.sessionHash !== session.tokenHash || row.sellerId !== session.sellerId) return 'STATE_INVALID'
    if (!(await useState(db, row.sellerId, row.id, now))) return 'STATE_INVALID'
    if (query.error !== undefined) return 'DENIED'
    if (query.code === undefined || query.code === '' || query.code.length > 2000) return 'CONNECT_FAILED'
    const login: InstagramLogin = row.login === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK'
    const grant = await meta.grant(login, query.code)
    if (!grant.ok) {
      this.#deps.log({ level: 'warn', code: 'IG_META_FAILED', errorKind: grant.failure })
      return 'CONNECT_FAILED'
    }
    const { accounts, permissions } = grant.value
    if (accounts.length === 0) return 'NO_ACCOUNT'
    if (accounts.length > 1) return 'MANY_ACCOUNTS'
    if (!permissions.comments) return 'NO_COMMENT_PERMISSION'
    const account = accounts[0] as (typeof accounts)[number]
    const sellerId = row.sellerId
    const existing = await findConnection(db, sellerId)
    if (existing !== null && existing.accountId !== account.id) return 'OTHER_ACCOUNT'
    const owner = await connectionByAccount(db, account.id)
    if (owner !== null && owner.sellerId !== sellerId) return 'ACCOUNT_TAKEN'
    const tokens: MetaTokens = { user: grant.value.userToken, page: account.pageToken, ig: grant.value.igToken }
    const conn: MetaConnection = { login, accountId: account.id, pageId: account.pageId, tokens }
    const subscribed = await meta.subscribe(conn)
    if (!subscribed.ok) {
      this.#deps.log({ level: 'warn', code: 'IG_META_FAILED', errorKind: subscribed.failure })
      return 'SUBSCRIBE_FAILED'
    }
    const record = {
      sellerId,
      login,
      accountId: account.id,
      username: account.username,
      accountType: account.type,
      pageId: account.pageId,
      tokensEnc: sealTokens(this.#deps.masterKey, sellerId, tokens),
      tokenObtainedAt: now,
      tokenExpiresAt: grant.value.expiresIn === null ? null : new Date(now.getTime() + grant.value.expiresIn * 1000),
      permComments: permissions.comments,
      permMessages: permissions.messages,
      now,
    }
    let wasReconnect = false
    let consentOn = false
    try {
      await db.transaction(async (tx) => {
        const current = await findConnection(tx, sellerId, true)
        if (current !== null && current.accountId !== account.id) throw new CallbackAbort('OTHER_ACCOUNT')
        if (current === null) await insertConnection(tx, record)
        else {
          wasReconnect = current.status === 'RECONNECT_NEEDED'
          await refreshConnection(tx, record)
        }
        // DM 동의를 켜려던 승인: 메시지 권한을 받았으면 그때 켠다 (이미 켜져 있으면 켠 시각·계정은 그대로)
        if (row.purpose === 'MESSAGES' && permissions.messages) {
          consentOn = true
          if (current === null || current.consentAt === null) await setConsent(tx, sellerId, now, row.accountId, now)
        }
      })
    } catch (error) {
      if (error instanceof CallbackAbort) return error.code
      if (uniqueViolation(error) === 'ig_connections_account_uq') return 'ACCOUNT_TAKEN'
      throw error
    }
    this.#deps.onChange(sellerId)
    if (wasReconnect) this.#deps.onReconnected(sellerId)
    if (row.purpose === 'MESSAGES') return consentOn ? 'CONSENT_ON' : 'NO_MESSAGE_PERMISSION'
    return 'CONNECTED'
  }

  /**
   * API를 부를 연결 (토큰을 풀고, 인스타그램 로그인이면 필요할 때 새로 고친다).
   * 토큰을 풀 수 없으면 "다시 연결 필요"로 바꾼다(서버는 죽지 않는다, AC-N2-13)
   */
  async api(sellerId: string): Promise<ApiConnection> {
    if (!this.configured) return { ok: false, failure: 'NOT_CONFIGURED' }
    let row = await findConnection(this.#deps.db, sellerId)
    if (row === null) return { ok: false, failure: 'NOT_CONNECTED' }
    if (row.status === 'RECONNECT_NEEDED') return { ok: false, failure: 'RECONNECT_NEEDED' }
    if (row.login === 'INSTAGRAM' && this.#needsRefresh(row)) {
      await this.#refresh(sellerId)
      row = await findConnection(this.#deps.db, sellerId)
      if (row === null) return { ok: false, failure: 'NOT_CONNECTED' }
      if (row.status === 'RECONNECT_NEEDED') return { ok: false, failure: 'RECONNECT_NEEDED' }
    }
    const tokens = await this.#tokens(row)
    if (tokens === null) return { ok: false, failure: 'RECONNECT_NEEDED' }
    return { ok: true, row, conn: { login: row.login === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK', accountId: row.accountId, pageId: row.pageId, tokens } }
  }

  #needsRefresh(row: ConnectionRow): boolean {
    if (row.tokenExpiresAt === null) return false
    const now = this.#deps.clock.now()
    return row.tokenExpiresAt.getTime() - now < REFRESH_BEFORE_MS && now - row.tokenObtainedAt.getTime() > REFRESH_AFTER_MS
  }

  /** 토큰을 푼다. 풀 수 없으면 "다시 연결 필요"로 바꾸고 null */
  async #tokens(row: ConnectionRow): Promise<MetaTokens | null> {
    try {
      return openTokens(this.#deps.masterKey, row.sellerId, row.tokensEnc)
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
      this.#deps.log({ level: 'warn', code: 'IG_TOKEN_UNREADABLE', errorKind: errorKind(error) })
      await this.markReconnect(row.sellerId)
      return null
    }
  }

  /** 판매자마다 새로 고침은 동시에 하나 (동시 요청 여럿이 기다렸다 같은 결과를 쓴다, AC-N2-14) */
  #refresh(sellerId: string): Promise<void> {
    const running = this.#refreshing.get(sellerId)
    if (running !== undefined) return running
    const task = (async () => {
      const row = await findConnection(this.#deps.db, sellerId)
      if (row === null || row.status !== 'CONNECTED' || !this.#needsRefresh(row) || this.#deps.meta === null) return
      const tokens = await this.#tokens(row)
      if (tokens?.ig === null || tokens === null) return
      const result = await this.#deps.meta.refresh(tokens.ig)
      const now = this.#now()
      if (!result.ok) {
        this.#deps.log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
        if (result.failure === 'TOKEN_INVALID') await this.markReconnect(sellerId)
        return
      }
      const sealed = sealTokens(this.#deps.masterKey, sellerId, { ...tokens, ig: result.value.token })
      await updateTokens(this.#deps.db, sellerId, sealed, now, result.value.expiresIn === null ? null : new Date(now.getTime() + result.value.expiresIn * 1000), now)
    })().finally(() => this.#refreshing.delete(sellerId))
    this.#refreshing.set(sellerId, task)
    return task
  }

  /** 메타가 토큰 무효를 줬다 → "다시 연결 필요" + SSE (AC-N2-14) */
  async markReconnect(sellerId: string): Promise<void> {
    if (await markReconnectNeeded(this.#deps.db, sellerId, this.#now())) this.#deps.onChange(sellerId)
  }

  /**
   * 연결 끊기 (AC-N2-16): 메타에 구독 해제·권한 철회를 요청하고(실패·타임아웃이어도 계속), 토큰·DM 동의를 지운다.
   * 기다리던 DM 행은 FAILED(NO_CONSENT)
   */
  async disconnect(sellerId: string): Promise<ConnectionView> {
    const row = await findConnection(this.#deps.db, sellerId)
    if (row === null) return this.view(sellerId)
    const meta = this.#deps.meta
    if (meta !== null) {
      let tokens: MetaTokens | null
      try {
        tokens = openTokens(this.#deps.masterKey, sellerId, row.tokensEnc)
      } catch {
        tokens = null
      }
      if (tokens !== null) {
        const conn: MetaConnection = { login: row.login === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK', accountId: row.accountId, pageId: row.pageId, tokens }
        for (const result of [await meta.unsubscribe(conn), await meta.revoke(conn)]) {
          if (!result.ok) this.#deps.log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
        }
      }
    }
    const now = this.#now()
    const after = await this.#deps.db.transaction(async (tx) => {
      await deleteConnection(tx, sellerId)
      return this.#deps.onDisconnect(tx, sellerId, now)
    })
    this.#deps.onChange(sellerId)
    after?.()
    return this.view(sellerId)
  }

  /**
   * DM 자동 발송 동의 켜기·끄기 (AC-N2-41). 기본 꺼짐. 이미 켠 동의를 다시 켜면 켠 시각·계정은 그대로다.
   * 메시지 권한이 없는데 켜려 하면 켜지 않고 메시지 권한을 요청하는 승인 주소를 돌려준다
   */
  async consent(session: SessionRef, on: boolean): Promise<{ readonly kind: 'ok'; readonly view: ConnectionView } | { readonly kind: 'permission'; readonly url: string } | { readonly kind: 'rejected'; readonly code: 'NOT_CONFIGURED' | 'NOT_CONNECTED'; readonly message: string }> {
    if (!this.configured) return { kind: 'rejected', code: 'NOT_CONFIGURED', message: CONNECTION_MESSAGES.notConfigured }
    const row = await findConnection(this.#deps.db, session.sellerId)
    if (row === null) return { kind: 'rejected', code: 'NOT_CONNECTED', message: CONNECTION_MESSAGES.notConnected }
    const now = this.#now()
    if (on) {
      if (!row.permMessages) {
        const started = await this.start(session, 'MESSAGES')
        if (!started.ok) return { kind: 'rejected', code: started.code, message: started.message }
        return { kind: 'permission', url: started.url }
      }
      if (row.consentAt === null) await setConsent(this.#deps.db, session.sellerId, now, session.accountId, now)
    } else if (row.consentAt !== null) {
      const after = await this.#deps.db.transaction(async (tx) => {
        await setConsent(tx, session.sellerId, null, null, now)
        return this.#deps.onConsentOff(tx, session.sellerId, now)
      })
      after?.()
    }
    this.#deps.onChange(session.sellerId)
    return { kind: 'ok', view: await this.view(session.sellerId) }
  }
}

class CallbackAbort {
  readonly code: CallbackCode
  constructor(code: CallbackCode) {
    this.code = code
  }
}
