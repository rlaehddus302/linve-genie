// 간편 로그인 (L1, SYS-01·SYS-02·SYS-04, D-L1-01~D-L1-05). 계약은 harness/sprints/L1/dev-notes.md "화면·시험에게".
// - 가입은 받지 않는다: 로그인은 (공급자, 공급자 계정 ID)로 연결 표에서 판매자 계정(SELLER)을 찾을 뿐이고, 없으면 아무것도 만들지 않고 NOT_LINKED.
//   이메일은 찾기·합치기에 쓰지 않는다(가린 이름만 저장).
// - 연결은 로그인한 판매자가 시작하고(그 계정·세션·브라우저에 묶인 state), 돌아왔을 때 같은 세션이 살아 있어야 한다.
// - state: 무작위 32바이트(base64url), 서버엔 해시만, 10분, 한 번만(쓴 표시를 한 문장으로 먼저 단다 — 동시에 와도 하나만 다음으로 간다).
//   브라우저 쿠키(lj_oauth, 경로 /api/auth, 10분, 무작위 — 서버엔 해시만)와 짝이 맞아야 한다. 같은 브라우저의 여러 탭은 쿠키 하나를 함께 쓴다
//   (시작할 때 그 브라우저의 쿠키가 있으면 그대로 쓰고 Max-Age만 다시 10분) — 탭마다 state는 따로 살아 있고, 다른 브라우저의 state는 쿠키가 달라 통과하지 못한다.
// - 돌아오는 주소 검사 순서(AC-L1-04): IP 한도 → 공급자 error → state·쿠키 검사와 쓴 표시(한 문장) → 연결이면 세션 → 코드 교환·사용자 정보 → 연결 표.
// - 돌아간 뒤 가는 곳은 앱 주소 + 고정 경로(`/` 또는 `/settings`) + login·provider 두 매개변수뿐이다(요청의 Host·매개변수로 바꾸지 않는다).
// - 로그·응답에 코드·state·토큰·비밀값·공급자 계정 ID·이메일을 남기지 않는다(공급자 이름·결과 코드·오류 종류만).
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/database.ts'
import { accounts, loginLinks, loginStates, sessions } from '../db/schema.ts'
import { IpLimiter, ipKey, IP_MAX_ATTEMPTS, type LoginLimitOptions } from '../login-limit.ts'
import type { LogSink } from '../log.ts'
import { openText, sealText } from '../secrets.ts'
import type { Clock } from '../time.ts'
import { maskedLabel } from './masked.ts'
import {
  CANCEL_ERRORS,
  PROVIDER_METHOD,
  PROVIDER_ORDER,
  PROVIDER_TIMEOUT_MS,
  ProviderError,
  USES_PKCE,
  authorizeUrl,
  endpointsOf,
  enabledProviders,
  fetchProfile,
  isProviderId,
  type ProviderClient,
  type ProviderId,
  type SocialLoginSetup,
} from './providers.ts'

/** 돌아오기 결과 코드 (acceptance "결과 문장" 표 — 화면이 정해진 문장으로 바꾼다) */
export type SocialResult = 'CANCELLED' | 'EXPIRED' | 'NOT_LINKED' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'LINKED' | 'LINKED_ELSEWHERE' | 'ALREADY_LINKED' | 'SESSION_GONE'
export type SocialPurpose = 'LOGIN' | 'LINK'

export const STATE_COOKIE = 'lj_oauth'
export const STATE_COOKIE_PATH = '/api/auth'
export const STATE_TTL_MS = 10 * 60 * 1000
const COOKIE_RE = /^[A-Za-z0-9_-]{43}$/
const STATE_RE = /^[A-Za-z0-9_-]{43,200}$/

export const stateCookie = (value: string): string => `${STATE_COOKIE}=${value}; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(STATE_TTL_MS / 1000)}`
export const CLEAR_STATE_COOKIE = `${STATE_COOKIE}=; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export const callbackPath = (provider: ProviderId): string => `/api/auth/${provider}/callback`

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url')
const verifierAad = (provider: ProviderId, stateHash: string) => `livejjim/login-verifier/v1/${provider}/${stateHash}`

export interface SessionInfo {
  readonly sellerId: string
  readonly accountId: string
  readonly tokenHash: string
  readonly loginId: string
  readonly role: string
}

export interface ProviderMethodView {
  readonly provider: ProviderId
  readonly enabled: boolean
  readonly linked: boolean
  readonly label: string
  readonly linkedAt: string | null
}

export interface MethodsView {
  readonly loginId: string
  readonly providers: readonly ProviderMethodView[]
}

export interface CallbackOutcome {
  /** 302 Location (앱 주소 + 고정 경로) */
  readonly location: string
  /** 로그인 성공이면 새 세션 토큰 (쿠키로 보낸다) */
  readonly sessionToken: string | null
}

export interface SocialLoginOptions {
  readonly db: Db
  readonly masterKey: Buffer
  readonly clock: Clock
  readonly appOrigin: string
  readonly setup: SocialLoginSetup
  readonly auth: Auth
  readonly log: LogSink
  /** 로그인 경로 속도 제한 (시작 요청의 IP 한도 = 로그인 IP 한도의 5배) */
  readonly loginLimits?: LoginLimitOptions
  /** 연결이 바뀌었다 (실시간 알림 — 판매자의 다른 화면이 목록을 새로 읽는다) */
  readonly onChanged: (sellerId: string) => void
  /** 지운 세션의 실시간 연결을 닫는다 */
  readonly closeSessions: (hashes: readonly string[]) => void
  /** 시험 주입점: 쓴 표시를 단 직후·공급자를 부르기 전 */
  readonly hooks?: { readonly afterClaim?: () => void | Promise<void> }
}

export type StartOutcome = { readonly kind: 'ok'; readonly authorizeUrl: string; readonly cookie: string } | { readonly kind: 'not_found' } | { readonly kind: 'rate_limited' }

export type UnlinkOutcome = { readonly kind: 'ok'; readonly view: MethodsView } | { readonly kind: 'not_found' } | { readonly kind: 'last' }

export class SocialLogin {
  readonly #options: SocialLoginOptions
  readonly #enabled: readonly ProviderId[]
  readonly #startLimiter: IpLimiter

  constructor(options: SocialLoginOptions) {
    this.#options = options
    this.#enabled = enabledProviders(options.setup)
    const limits = options.loginLimits ?? {}
    this.#startLimiter = new IpLimiter(options.clock, { ...limits, ipMaxAttempts: (limits.ipMaxAttempts ?? IP_MAX_ATTEMPTS) * 5 })
  }

  /** 켜진 공급자 (카카오·네이버·구글 순) */
  get enabled(): readonly ProviderId[] {
    return this.#enabled
  }

  isEnabled(provider: unknown): provider is ProviderId {
    return isProviderId(provider) && this.#enabled.includes(provider)
  }

  redirectUri(provider: ProviderId): string {
    return `${this.#options.appOrigin}${callbackPath(provider)}`
  }

  #client(provider: ProviderId): ProviderClient {
    return this.#options.setup.providers[provider] as ProviderClient
  }

  // ── 시작 (AC-L1-03) ──────────────────────────────────────────────────

  /** 승인 주소를 만들고 state(해시)·검증 값(암호화)·브라우저 쿠키(해시)를 둔다. 연결이면 그 판매자 계정·세션에 묶는다 */
  async start(provider: unknown, purpose: SocialPurpose, browserCookie: string | undefined, session: SessionInfo | null, address: string | null): Promise<StartOutcome> {
    if (!this.isEnabled(provider)) return { kind: 'not_found' }
    if (purpose === 'LINK' && (session === null || session.role !== 'SELLER')) return { kind: 'not_found' }
    if (!this.#startLimiter.take(address === null ? null : ipKey(address))) return { kind: 'rate_limited' }
    const { db, masterKey, clock } = this.#options
    const now = clock.now()
    const state = randomBytes(32).toString('base64url')
    const stateHash = sha256(state)
    const cookie = browserCookie !== undefined && COOKIE_RE.test(browserCookie) ? browserCookie : randomBytes(32).toString('base64url')
    const verifier = USES_PKCE[provider] ? randomBytes(48).toString('base64url') : null
    const challenge = verifier === null ? null : createHash('sha256').update(verifier, 'ascii').digest('base64url')
    // 끝난 행 정리 (만료 시각 인덱스)
    await db.delete(loginStates).where(lt(loginStates.expiresAt, new Date(now)))
    await db.insert(loginStates).values({
      stateHash,
      browserHash: sha256(cookie),
      provider,
      purpose,
      sellerId: purpose === 'LINK' ? (session as SessionInfo).sellerId : null,
      accountId: purpose === 'LINK' ? (session as SessionInfo).accountId : null,
      sessionHash: purpose === 'LINK' ? (session as SessionInfo).tokenHash : null,
      verifierEnc: verifier === null ? null : sealText(masterKey, verifierAad(provider, stateHash), verifier),
      createdAt: new Date(now),
      expiresAt: new Date(now + STATE_TTL_MS),
    })
    const url = authorizeUrl(endpointsOf(this.#options.setup, provider), { provider, clientId: this.#client(provider).clientId, redirectUri: this.redirectUri(provider), state, challenge })
    return { kind: 'ok', authorizeUrl: url, cookie }
  }

  // ── 돌아오는 주소 (AC-L1-04~06) ──────────────────────────────────────

  #location(path: '/' | '/settings', result: SocialResult | null, provider: ProviderId): string {
    if (result === null) return `${this.#options.appOrigin}/`
    return `${this.#options.appOrigin}${path}?login=${result}&provider=${provider}`
  }

  #finish(provider: ProviderId, purpose: SocialPurpose | null, result: SocialResult, extra: { status?: number; errorKind?: string } = {}): CallbackOutcome {
    this.#options.log({ level: result === 'PROVIDER_ERROR' ? 'warn' : 'info', code: 'SOCIAL_LOGIN', provider, reason: result, ...extra })
    const path = result === 'SESSION_GONE' || result === 'RATE_LIMITED' || result === 'NOT_LINKED' ? '/' : purpose === 'LINK' ? '/settings' : '/'
    return { location: this.#location(path, result, provider), sessionToken: null }
  }

  /** 그 state 행의 목적 (가는 곳을 고르는 데만 — 쓴 표시는 하지 않는다) */
  async #peekPurpose(stateHash: string | null): Promise<SocialPurpose | null> {
    if (stateHash === null) return null
    const rows = await this.#options.db.select({ purpose: loginStates.purpose }).from(loginStates).where(eq(loginStates.stateHash, stateHash)).limit(1)
    const purpose = rows[0]?.purpose
    return purpose === 'LINK' || purpose === 'LOGIN' ? purpose : null
  }

  /** state를 쓴 것으로 표시한다 (한 문장 — 쓰지 않았고·끝나지 않았고·공급자·브라우저가 맞을 때만). 표시했으면 그 행 */
  async #claim(provider: ProviderId, stateHash: string, browserHash: string, now: number) {
    const rows = await this.#options.db
      .update(loginStates)
      .set({ usedAt: new Date(now) })
      .where(
        and(
          eq(loginStates.stateHash, stateHash),
          isNull(loginStates.usedAt),
          gt(loginStates.expiresAt, new Date(now)),
          eq(loginStates.provider, provider),
          eq(loginStates.browserHash, browserHash),
        ),
      )
      .returning({
        purpose: loginStates.purpose,
        sellerId: loginStates.sellerId,
        accountId: loginStates.accountId,
        sessionHash: loginStates.sessionHash,
        verifierEnc: loginStates.verifierEnc,
      })
    return rows[0] ?? null
  }

  /**
   * 돌아오는 주소 처리. provider는 켜진 공급자(경로에서 — 아니면 부르는 쪽이 404), params는 받은 매개변수, browserCookie = lj_oauth, sessionToken = lj_session,
   * address = 로그인 IP 한도에 셀 주소
   */
  async callback(
    provider: ProviderId,
    params: { readonly code?: string | undefined; readonly state?: string | undefined; readonly error?: string | undefined },
    browserCookie: string | undefined,
    sessionToken: string | undefined,
    address: string | null,
  ): Promise<CallbackOutcome> {
    const { auth, clock } = this.#options
    // 1. 로그인 IP 한도 (공급자를 부르지 않는다)
    if (!auth.takeLoginAttempt(address)) return this.#finish(provider, null, 'RATE_LIMITED')
    const now = clock.now()
    const stateHash = typeof params.state === 'string' && STATE_RE.test(params.state) ? sha256(params.state) : null
    const browserHash = browserCookie !== undefined && COOKIE_RE.test(browserCookie) ? sha256(browserCookie) : null
    // 2. 공급자 error: 취소면 CANCELLED, 아니면 PROVIDER_ERROR. state가 맞으면 쓴 것으로 표시한다
    if (params.error !== undefined) {
      const claimed = stateHash !== null && browserHash !== null ? await this.#claim(provider, stateHash, browserHash, now) : null
      const purpose = claimed === null ? await this.#peekPurpose(stateHash) : (claimed.purpose as SocialPurpose)
      return this.#finish(provider, purpose, CANCEL_ERRORS[provider].includes(params.error) ? 'CANCELLED' : 'PROVIDER_ERROR')
    }
    // 3·4. state·쿠키 검사와 쓴 표시 (한 문장)
    const row = stateHash !== null && browserHash !== null ? await this.#claim(provider, stateHash, browserHash, now) : null
    if (row === null) return this.#finish(provider, await this.#peekPurpose(stateHash), 'EXPIRED')
    const purpose: SocialPurpose = row.purpose === 'LINK' ? 'LINK' : 'LOGIN'
    // 5. 연결: 시작한 그 세션이 아직 살아 있고 같은 판매자 계정이어야 한다
    if (purpose === 'LINK') {
      const current = await auth.session(sessionToken)
      if (current === null || current.tokenHash !== row.sessionHash || current.accountId !== row.accountId || current.sellerId !== row.sellerId || current.role !== 'SELLER') {
        return this.#finish(provider, purpose, 'SESSION_GONE')
      }
    }
    await this.#options.hooks?.afterClaim?.()
    // 6. 코드 교환·사용자 정보 (같은 돌아오는 주소·검증 값, 비밀값은 서버에서만). 토큰은 fetchProfile 안에서만 쓴다
    const code = params.code
    if (typeof code !== 'string' || code === '' || code.length > 2048) return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: 'Provider_code_missing' })
    let verifier: string | null = null
    if (row.verifierEnc !== null) {
      try {
        verifier = openText(this.#options.masterKey, verifierAad(provider, stateHash as string), row.verifierEnc)
      } catch {
        return this.#finish(provider, purpose, 'EXPIRED')
      }
    }
    let profile
    try {
      profile = await fetchProfile({
        provider,
        client: this.#client(provider),
        endpoints: endpointsOf(this.#options.setup, provider),
        redirectUri: this.redirectUri(provider),
        code,
        verifier,
        state: params.state as string,
        fetch: this.#options.setup.fetch ?? globalThis.fetch,
        timeoutMs: this.#options.setup.timeoutMs ?? PROVIDER_TIMEOUT_MS,
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: `Provider_${error.step}_${error.kind}`, ...(error.status === null ? {} : { status: error.status }) })
      }
      return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: 'Provider_unknown' })
    }
    const label = maskedLabel(profile.email, profile.nickname)
    if (purpose === 'LOGIN') return this.#login(provider, profile.id, label)
    const result = await this.#link(provider, { sellerId: row.sellerId as string, accountId: row.accountId as string }, profile.id, label, now)
    if (result === 'LINKED') this.#notify(row.sellerId as string)
    return this.#finish(provider, purpose, result)
  }

  async #login(provider: ProviderId, providerUserId: string, label: string): Promise<CallbackOutcome> {
    const { db, clock } = this.#options
    // 판매자 계정(SELLER, 지우지 않음)만 찾는다 — 보조자 계정 ID로 된 행이 있어도(손상) 세션을 만들지 않는다
    const rows = await db
      .select({ id: loginLinks.id, sellerId: loginLinks.sellerId, accountId: loginLinks.accountId })
      .from(loginLinks)
      .innerJoin(accounts, and(eq(accounts.id, loginLinks.accountId), eq(accounts.sellerId, loginLinks.sellerId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
      .where(and(eq(loginLinks.provider, provider), eq(loginLinks.providerUserId, providerUserId)))
      .limit(1)
    const link = rows[0]
    if (link === undefined) return this.#finish(provider, 'LOGIN', 'NOT_LINKED')
    const token = await this.#options.auth.createSession({ sellerId: link.sellerId, accountId: link.accountId }, PROVIDER_METHOD[provider])
    await db
      .update(loginLinks)
      .set({ lastLoginAt: new Date(clock.now()), label })
      .where(and(eq(loginLinks.id, link.id), eq(loginLinks.sellerId, link.sellerId)))
    this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'LOGGED_IN' })
    return { location: this.#location('/', null, provider), sessionToken: token }
  }

  /** 연결 (유일 제약이 동시에 둘을 막는다) */
  async #link(provider: ProviderId, owner: { sellerId: string; accountId: string }, providerUserId: string, label: string, now: number): Promise<SocialResult> {
    const { db } = this.#options
    for (let attempt = 0; attempt < 2; attempt++) {
      const taken = await db
        .select({ id: loginLinks.id, accountId: loginLinks.accountId, sellerId: loginLinks.sellerId })
        .from(loginLinks)
        .where(and(eq(loginLinks.provider, provider), eq(loginLinks.providerUserId, providerUserId)))
        .limit(1)
      const existing = taken[0]
      if (existing !== undefined) {
        if (existing.accountId !== owner.accountId || existing.sellerId !== owner.sellerId) return 'LINKED_ELSEWHERE'
        await db.update(loginLinks).set({ label }).where(and(eq(loginLinks.id, existing.id), eq(loginLinks.sellerId, owner.sellerId)))
        return 'LINKED'
      }
      const mine = await db
        .select({ id: loginLinks.id })
        .from(loginLinks)
        .where(and(eq(loginLinks.sellerId, owner.sellerId), eq(loginLinks.accountId, owner.accountId), eq(loginLinks.provider, provider)))
        .limit(1)
      if (mine.length > 0) return 'ALREADY_LINKED'
      const inserted = await db
        .insert(loginLinks)
        .values({ sellerId: owner.sellerId, accountId: owner.accountId, provider, providerUserId, label, linkedAt: new Date(now) })
        .onConflictDoNothing()
        .returning({ id: loginLinks.id })
      if (inserted.length > 0) return 'LINKED'
      // 같은 순간 다른 쪽이 먼저 넣었다 — 다시 읽어 정한다
    }
    return 'LINKED_ELSEWHERE'
  }

  #notify(sellerId: string): void {
    try {
      this.#options.onChanged(sellerId)
    } catch {
      // 알림 실패는 결과에 영향을 주지 않는다
    }
  }

  // ── 목록·끊기 (AC-L1-07) ─────────────────────────────────────────────

  async methods(session: SessionInfo): Promise<MethodsView> {
    const rows = await this.#options.db
      .select({ provider: loginLinks.provider, label: loginLinks.label, linkedAt: loginLinks.linkedAt })
      .from(loginLinks)
      .where(and(eq(loginLinks.sellerId, session.sellerId), eq(loginLinks.accountId, session.accountId)))
    const linked = new Map(rows.map((row) => [row.provider, row]))
    const providers = PROVIDER_ORDER.filter((provider) => this.#enabled.includes(provider) || linked.has(provider)).map((provider): ProviderMethodView => {
      const row = linked.get(provider)
      return { provider, enabled: this.#enabled.includes(provider), linked: row !== undefined, label: row?.label ?? '', linkedAt: row?.linkedAt.toISOString() ?? null }
    })
    return { loginId: session.loginId, providers }
  }

  /**
   * 끊기: 연결 행을 지우고 그 계정에서 그 공급자로 만든 세션을 모두 지운다 — 요청한 지금 세션은 남긴다. 연결이 없으면 not_found,
   * 끊은 뒤 로그인 수단(비밀번호 + 남은 연결)이 없으면 last (D-L1-03)
   */
  async unlink(session: SessionInfo, provider: unknown): Promise<UnlinkOutcome> {
    if (!isProviderId(provider)) return { kind: 'not_found' }
    const { db } = this.#options
    const outcome = await db.transaction(async (tx): Promise<{ kind: 'not_found' } | { kind: 'last' } | { kind: 'ok'; hashes: string[] }> => {
      // 같은 계정의 끊기를 하나씩 (마지막 수단 확인과 지우기 사이에 다른 끊기가 끼지 않게)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-links/${session.accountId}`}, 0))`)
      const account = await tx
        .select({ passwordHash: accounts.passwordHash })
        .from(accounts)
        .where(and(eq(accounts.id, session.accountId), eq(accounts.sellerId, session.sellerId)))
        .limit(1)
      if (account[0] === undefined) return { kind: 'not_found' }
      const links = await tx
        .select({ provider: loginLinks.provider })
        .from(loginLinks)
        .where(and(eq(loginLinks.sellerId, session.sellerId), eq(loginLinks.accountId, session.accountId)))
      if (!links.some((row) => row.provider === provider)) return { kind: 'not_found' }
      const remaining = (account[0].passwordHash !== '' ? 1 : 0) + links.length - 1
      if (remaining < 1) return { kind: 'last' }
      await tx.delete(loginLinks).where(and(eq(loginLinks.sellerId, session.sellerId), eq(loginLinks.accountId, session.accountId), eq(loginLinks.provider, provider)))
      const removed = await tx
        .delete(sessions)
        .where(
          and(
            eq(sessions.sellerId, session.sellerId),
            eq(sessions.accountId, session.accountId),
            eq(sessions.method, PROVIDER_METHOD[provider]),
            ne(sessions.tokenHash, session.tokenHash),
          ),
        )
        .returning({ tokenHash: sessions.tokenHash })
      return { kind: 'ok', hashes: removed.map((row) => row.tokenHash) }
    })
    if (outcome.kind !== 'ok') return outcome
    this.#options.closeSessions(outcome.hashes)
    this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'UNLINKED', count: outcome.hashes.length })
    this.#notify(session.sellerId)
    return { kind: 'ok', view: await this.methods(session) }
  }
}
