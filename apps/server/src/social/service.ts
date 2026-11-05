// 간편 로그인 (L1, SYS-01·SYS-02·SYS-04, D-L1-01~D-L1-05). 계약은 harness/sprints/L1/dev-notes.md "화면·시험에게".
// - 가입 (D-UX3-28, D-L1-01을 바꿈): 로그인은 (공급자, 공급자 계정 ID)로 연결 표에서 판매자 계정(SELLER)을 찾는다. 없으면 바로 만들지 않고
//   가입 표(SIGNUP, 10분·한 번)를 주고 `?login=SIGNUP`으로 보낸다 — 화면이 이용약관·개인정보처리방침 동의를 받은 뒤 POST /api/auth/signup이 계정을 만든다.
//   이메일은 찾기·합치기에 쓰지 않는다(가린 이름만 저장). 간편 로그인으로 만든 계정은 비밀번호가 없다(빈 해시 — 마지막 연결은 끊을 수 없다).
// - 앱 (D-UX3-28): 앱은 GET /api/auth/app/start?provider&challenge를 앱 안 로그인 창(ASWebAuthenticationSession·Custom Tabs)으로 연다.
//   돌아오면 그 창에는 세션을 주지 않고 `livejjim://auth?ticket=…`(또는 `?login=<결과>`)로 보낸다. 앱이 POST /api/auth/app/finish {ticket, verifier}로
//   표를 내면(검증 값의 SHA-256이 시작 때의 challenge와 같아야) 앱에 세션 쿠키를 준다 — 다른 앱이 주소를 가로채도 검증 값이 없으면 쓰지 못한다.
// - 연결은 로그인한 판매자가 시작하고(그 계정·세션·브라우저에 묶인 state), 돌아왔을 때 같은 세션이 살아 있어야 한다.
// - state: 무작위 32바이트(base64url), 서버엔 해시만, 10분, 한 번만(쓴 표시를 한 문장으로 먼저 단다 — 동시에 와도 하나만 다음으로 간다).
//   브라우저 쿠키(__Host-lj_oauth, Path=/·Secure·Domain 없음, 10분, 무작위 — 서버엔 해시만)와 짝이 맞아야 한다 (RA-L1-02).
//   시작할 때마다 쿠키 값은 새로 발급한다(요청에 온 값을 그대로 다시 내보내지 않는다). 그 브라우저에 진행 중인 state(쓰지 않음·끝나지 않음)가 있으면
//   그 행들을 새 값의 해시로 다시 묶는다 — 여러 탭이 차례로 시작해도 탭마다 state는 따로 살아 있고, 다른 브라우저의 state는 쿠키가 달라 통과하지 못한다.
//   (두 탭이 같은 순간에 시작하면 늦게 도착한 쿠키만 남아 한 탭은 EXPIRED — 쿠키 없이 처음 두 탭을 동시에 열 때와 같은 한계)
// - 돌아오는 주소는 결과와 상관없이 쿠키를 지우지 않는다 (RA-L1-01): 성공(로그인·연결)했고 그 브라우저에 살아 있는 다른 state가 없을 때만 지우고,
//   아니면 Max-Age(10분) 만료에 맡긴다 — 다른 탭에서 진행 중인 연결·로그인이 깨지지 않게.
// - 돌아오는 주소 검사 순서(AC-L1-04): IP 한도 → 공급자 error → state·쿠키 검사와 쓴 표시(한 문장) → 연결이면 세션 → 코드 교환·사용자 정보 → 연결 표.
// - 돌아간 뒤 가는 곳은 앱 주소 + 고정 경로(`/` 또는 `/settings`) + login·provider 두 매개변수뿐이다(요청의 Host·매개변수로 바꾸지 않는다).
// - 로그·응답에 코드·state·토큰·비밀값·공급자 계정 ID·이메일을 남기지 않는다(공급자 이름·결과 코드·오류 종류만).
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/database.ts'
import { accounts, loginLinks, loginStates, loginTickets, sellers, sessions } from '../db/schema.ts'
import { randomIds } from '../ids.ts'
import { newSealedSellerKey } from '../secrets.ts'
import { loginIdTaken } from '../store.ts'
import { uniqueViolation } from '../writer.ts'
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
export type SocialResult = 'CANCELLED' | 'EXPIRED' | 'NOT_LINKED' | 'SIGNUP' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'LINKED' | 'LINKED_ELSEWHERE' | 'ALREADY_LINKED' | 'SESSION_GONE'
export type SocialPurpose = 'LOGIN' | 'LINK'

/** __Host- 접두어: Secure·Path=/·Domain 없음이어야 브라우저가 받는다 (하위 도메인이 덮어쓸 수 없다). 세션 쿠키처럼 항상 Secure (http 개발은 localhost·127.0.0.1만 — 브라우저가 믿을 만한 곳으로 본다) */
export const STATE_COOKIE = '__Host-lj_oauth'
export const STATE_COOKIE_PATH = '/'
export const STATE_TTL_MS = 10 * 60 * 1000
const COOKIE_RE = /^[A-Za-z0-9_-]{43}$/
const STATE_RE = /^[A-Za-z0-9_-]{43,200}$/

export const stateCookie = (value: string): string => `${STATE_COOKIE}=${value}; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(STATE_TTL_MS / 1000)}`
export const CLEAR_STATE_COOKIE = `${STATE_COOKIE}=; Path=${STATE_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export const callbackPath = (provider: ProviderId): string => `/api/auth/${provider}/callback`

/** 웹 가입 표 쿠키 (D-UX3-28) — 약관 동의 화면에서 POST /api/auth/signup이 읽는다 */
export const SIGNUP_COOKIE = '__Host-lj_signup'
export const TICKET_TTL_MS = 10 * 60 * 1000
export const signupCookie = (value: string): string => `${SIGNUP_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(TICKET_TTL_MS / 1000)}`
export const CLEAR_SIGNUP_COOKIE = `${SIGNUP_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
/** 앱으로 돌아가는 주소 (앱 scheme `livejjim` — app.json) */
export const APP_RETURN = 'livejjim://auth'
/** 간편 로그인으로 만든 계정의 가게 이름 (시작 안내 첫 단계에서 바꾼다) */
export const SIGNUP_SHOP_NAME = '내 가게'
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/
const ticketAad = (provider: string, ticketHash: string) => `livejjim/login-ticket/v1/${provider}/${ticketHash}`
/** 간편 로그인 가입 아이디: `lg-` + 8자 (보조자 `bo-`와 같은 글자 — LOGIN_ID_RE를 지킨다) */
const SIGNUP_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const signupLoginId = (): string => {
  const bytes = randomBytes(8)
  let out = 'lg-'
  for (const byte of bytes) out += SIGNUP_ID_ALPHABET[byte % SIGNUP_ID_ALPHABET.length]
  return out
}

/** 앱의 검증 값 → challenge (SHA-256 base64url) */
export const appChallengeOf = (verifier: string): string => createHash('sha256').update(verifier, 'ascii').digest('base64url')

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
  /** 브라우저 확인 쿠키를 지울지 (성공했고 그 브라우저에 살아 있는 다른 state가 없을 때만 — RA-L1-01) */
  readonly clearStateCookie: boolean
  /** 웹 가입 표 (쿠키로 보낸다, D-UX3-28) */
  readonly signupTicket?: string | null
}

/** 가입·앱 로그인을 마친 결과: 세션 토큰과 화면에 줄 내 정보 */
export interface TicketSession {
  readonly token: string
  readonly me: { readonly seller: { readonly name: string }; readonly loginId: string; readonly role: 'SELLER' }
}

export type AppFinishOutcome =
  | { readonly kind: 'logged_in'; readonly session: TicketSession }
  | { readonly kind: 'signup'; readonly provider: ProviderId }
  | { readonly kind: 'expired' }
  | { readonly kind: 'rate_limited' }

export type SignupOutcome = { readonly kind: 'ok'; readonly session: TicketSession } | { readonly kind: 'expired' } | { readonly kind: 'rate_limited' } | { readonly kind: 'not_agreed' }

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
  /** 시험 주입점: afterClaim = 쓴 표시를 단 직후·공급자를 부르기 전, beforeLoginSession = 로그인 연결을 찾은 뒤·세션 거래 전 (TD-L1-001) */
  readonly hooks?: { readonly afterClaim?: () => void | Promise<void>; readonly beforeLoginSession?: () => void | Promise<void> }
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
  async start(provider: unknown, purpose: SocialPurpose, browserCookie: string | undefined, session: SessionInfo | null, address: string | null, appChallenge: string | null = null): Promise<StartOutcome> {
    if (!this.isEnabled(provider)) return { kind: 'not_found' }
    if (purpose === 'LINK' && (session === null || session.role !== 'SELLER')) return { kind: 'not_found' }
    if (appChallenge !== null && (purpose !== 'LOGIN' || !CHALLENGE_RE.test(appChallenge))) return { kind: 'not_found' }
    if (!this.#startLimiter.take(address === null ? null : ipKey(address))) return { kind: 'rate_limited' }
    const { db, masterKey, clock } = this.#options
    const now = clock.now()
    const state = randomBytes(32).toString('base64url')
    const stateHash = sha256(state)
    // 쿠키 값은 늘 새로 (RA-L1-02). 들고 온 값이 있으면 그 브라우저의 진행 중 state를 새 값에 다시 묶는다
    const cookie = randomBytes(32).toString('base64url')
    const browserHash = sha256(cookie)
    const previousHash = browserCookie !== undefined && COOKIE_RE.test(browserCookie) ? sha256(browserCookie) : null
    const verifier = USES_PKCE[provider] ? randomBytes(48).toString('base64url') : null
    const challenge = verifier === null ? null : createHash('sha256').update(verifier, 'ascii').digest('base64url')
    // 끝난 행 정리 (만료 시각 인덱스)
    await db.delete(loginStates).where(lt(loginStates.expiresAt, new Date(now)))
    if (previousHash !== null) {
      await db
        .update(loginStates)
        .set({ browserHash })
        .where(and(eq(loginStates.browserHash, previousHash), isNull(loginStates.usedAt), gt(loginStates.expiresAt, new Date(now))))
    }
    await db.insert(loginStates).values({
      stateHash,
      browserHash,
      provider,
      purpose,
      sellerId: purpose === 'LINK' ? (session as SessionInfo).sellerId : null,
      accountId: purpose === 'LINK' ? (session as SessionInfo).accountId : null,
      sessionHash: purpose === 'LINK' ? (session as SessionInfo).tokenHash : null,
      verifierEnc: verifier === null ? null : sealText(masterKey, verifierAad(provider, stateHash), verifier),
      appChallenge,
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

  /** 앱으로 돌아가는 주소: 결과 코드 또는 표 (D-UX3-28) */
  #appLocation(provider: ProviderId, result: { readonly login: SocialResult } | { readonly ticket: string }): string {
    return 'ticket' in result ? `${APP_RETURN}?ticket=${result.ticket}&provider=${provider}` : `${APP_RETURN}?login=${result.login}&provider=${provider}`
  }

  #finish(provider: ProviderId, purpose: SocialPurpose | null, result: SocialResult, extra: { status?: number; errorKind?: string } = {}, app = false): CallbackOutcome {
    this.#options.log({ level: result === 'PROVIDER_ERROR' ? 'warn' : 'info', code: 'SOCIAL_LOGIN', provider, reason: result, ...extra })
    if (app) return { location: this.#appLocation(provider, { login: result }), sessionToken: null, clearStateCookie: false }
    const path = result === 'SESSION_GONE' || result === 'RATE_LIMITED' || result === 'NOT_LINKED' || result === 'SIGNUP' ? '/' : purpose === 'LINK' ? '/settings' : '/'
    return { location: this.#location(path, result, provider), sessionToken: null, clearStateCookie: false }
  }

  /** 그 브라우저에 아직 살아 있는 state(쓰지 않음·끝나지 않음)가 없는지 — 없을 때만 성공한 돌아오기가 쿠키를 지운다 */
  async #noOtherLiveState(browserHash: string, now: number): Promise<boolean> {
    const rows = await this.#options.db
      .select({ stateHash: loginStates.stateHash })
      .from(loginStates)
      .where(and(eq(loginStates.browserHash, browserHash), isNull(loginStates.usedAt), gt(loginStates.expiresAt, new Date(now))))
      .limit(1)
    return rows.length === 0
  }

  /** 그 state 행의 목적·앱에서 시작했는지 (가는 곳을 고르는 데만 — 쓴 표시는 하지 않는다) */
  async #peek(stateHash: string | null): Promise<{ readonly purpose: SocialPurpose | null; readonly app: boolean }> {
    if (stateHash === null) return { purpose: null, app: false }
    const rows = await this.#options.db.select({ purpose: loginStates.purpose, appChallenge: loginStates.appChallenge }).from(loginStates).where(eq(loginStates.stateHash, stateHash)).limit(1)
    const purpose = rows[0]?.purpose
    return { purpose: purpose === 'LINK' || purpose === 'LOGIN' ? purpose : null, app: (rows[0]?.appChallenge ?? null) !== null }
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
        appChallenge: loginStates.appChallenge,
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
    const stateHash = typeof params.state === 'string' && STATE_RE.test(params.state) ? sha256(params.state) : null
    if (!auth.takeLoginAttempt(address)) return this.#finish(provider, null, 'RATE_LIMITED', {}, (await this.#peek(stateHash)).app)
    const now = clock.now()
    const browserHash = browserCookie !== undefined && COOKIE_RE.test(browserCookie) ? sha256(browserCookie) : null
    // 2. 공급자 error: 취소면 CANCELLED, 아니면 PROVIDER_ERROR. state가 맞으면 쓴 것으로 표시한다
    if (params.error !== undefined) {
      const claimed = stateHash !== null && browserHash !== null ? await this.#claim(provider, stateHash, browserHash, now) : null
      const peeked = claimed === null ? await this.#peek(stateHash) : { purpose: claimed.purpose as SocialPurpose, app: claimed.appChallenge !== null }
      return this.#finish(provider, peeked.purpose, CANCEL_ERRORS[provider].includes(params.error) ? 'CANCELLED' : 'PROVIDER_ERROR', {}, peeked.app)
    }
    // 3·4. state·쿠키 검사와 쓴 표시 (한 문장)
    const row = stateHash !== null && browserHash !== null ? await this.#claim(provider, stateHash, browserHash, now) : null
    if (row === null) {
      const peeked = await this.#peek(stateHash)
      return this.#finish(provider, peeked.purpose, 'EXPIRED', {}, peeked.app)
    }
    const purpose: SocialPurpose = row.purpose === 'LINK' ? 'LINK' : 'LOGIN'
    const app = row.appChallenge !== null
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
    if (typeof code !== 'string' || code === '' || code.length > 2048) return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: 'Provider_code_missing' }, app)
    let verifier: string | null = null
    if (row.verifierEnc !== null) {
      try {
        verifier = openText(this.#options.masterKey, verifierAad(provider, stateHash as string), row.verifierEnc)
      } catch {
        return this.#finish(provider, purpose, 'EXPIRED', {}, app)
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
        return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: `Provider_${error.step}_${error.kind}`, ...(error.status === null ? {} : { status: error.status }) }, app)
      }
      return this.#finish(provider, purpose, 'PROVIDER_ERROR', { errorKind: 'Provider_unknown' }, app)
    }
    const label = maskedLabel(profile.email, profile.nickname)
    if (purpose === 'LOGIN') {
      const done = await this.#login(provider, profile.id, label, row.appChallenge)
      // 세션을 준 로그인만 확인 쿠키를 지운다 (가입 표·앱 표는 Max-Age 만료에 맡긴다 — RA-L1-01)
      if (done.sessionToken === null) return done
      return { ...done, clearStateCookie: await this.#noOtherLiveState(browserHash as string, clock.now()) }
    }
    const result = await this.#link(provider, { sellerId: row.sellerId as string, accountId: row.accountId as string, sessionHash: row.sessionHash as string }, profile.id, label, now)
    if (result === 'LINKED') this.#notify(row.sellerId as string)
    const finished = this.#finish(provider, purpose, result)
    if (result !== 'LINKED') return finished
    return { ...finished, clearStateCookie: await this.#noOtherLiveState(browserHash as string, clock.now()) }
  }

  async #login(provider: ProviderId, providerUserId: string, label: string, appChallenge: string | null): Promise<CallbackOutcome> {
    const { db, clock } = this.#options
    // 판매자 계정(SELLER, 지우지 않음)만 찾는다 — 보조자 계정 ID로 된 행이 있어도(손상) 세션을 만들지 않는다
    const findLink = (from: Db, accountId?: string) =>
      from
        .select({ id: loginLinks.id, sellerId: loginLinks.sellerId, accountId: loginLinks.accountId })
        .from(loginLinks)
        .innerJoin(accounts, and(eq(accounts.id, loginLinks.accountId), eq(accounts.sellerId, loginLinks.sellerId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
        .where(and(eq(loginLinks.provider, provider), eq(loginLinks.providerUserId, providerUserId), ...(accountId === undefined ? [] : [eq(loginLinks.accountId, accountId)])))
        .limit(1)
    const found = (await findLink(db))[0]
    // 연결되지 않은 공급자 계정: 가입 표를 준다 (D-UX3-28 — 약관 동의 뒤 계정을 만든다)
    if (found === undefined) {
      const ticket = await this.#issueTicket({ kind: 'SIGNUP', provider, appChallenge, providerUserId, label })
      this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'SIGNUP' })
      if (appChallenge !== null) return { location: this.#appLocation(provider, { ticket }), sessionToken: null, clearStateCookie: false }
      return { location: this.#location('/', 'SIGNUP', provider), sessionToken: null, clearStateCookie: false, signupTicket: ticket }
    }
    // 앱에서 시작했으면 이 창(앱 안 로그인 창)에는 세션을 주지 않고 표만 준다 — 앱이 검증 값과 함께 내면 세션을 만든다
    if (appChallenge !== null) {
      await db
        .update(loginLinks)
        .set({ label })
        .where(and(eq(loginLinks.id, found.id), eq(loginLinks.sellerId, found.sellerId)))
      const ticket = await this.#issueTicket({ kind: 'LOGIN', provider, appChallenge, sellerId: found.sellerId, accountId: found.accountId })
      return { location: this.#appLocation(provider, { ticket }), sessionToken: null, clearStateCookie: false }
    }
    await this.#options.hooks?.beforeLoginSession?.()
    // 연결 확인과 세션 넣기를 한 거래로 (TD-L1-001): 끊기와 같은 계정 잠금을 잡고 연결이 아직 있는지 다시 읽은 뒤에만 세션을 넣는다.
    // 끊기가 먼저 끝났으면 NOT_LINKED, 로그인이 먼저 끝났으면 뒤따르는 끊기가 이 세션을 지운다
    const token = await db.transaction(async (tx): Promise<string | null> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-links/${found.accountId}`}, 0))`)
      const link = (await findLink(tx as unknown as Db, found.accountId))[0]
      if (link === undefined) return null
      const created = await this.#options.auth.createSession({ sellerId: link.sellerId, accountId: link.accountId }, PROVIDER_METHOD[provider], tx as unknown as Db)
      await tx
        .update(loginLinks)
        .set({ lastLoginAt: new Date(clock.now()), label })
        .where(and(eq(loginLinks.id, link.id), eq(loginLinks.sellerId, link.sellerId)))
      return created
    })
    if (token === null) return this.#finish(provider, 'LOGIN', 'NOT_LINKED', {}, appChallenge !== null)
    this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'LOGGED_IN' })
    return { location: this.#location('/', null, provider), sessionToken: token, clearStateCookie: false }
  }

  /**
   * 연결 (유일 제약이 동시에 둘을 막는다). 공급자 왕복 뒤 한 거래 안에서 (TD-L1-005, AC-L1-06):
   * 끊기와 같은 계정 잠금을 잡고, 연결을 시작한 그 세션 행을 잠가 다시 읽는다 — 그 사이 로그아웃·만료됐으면 아무것도 만들지 않고 SESSION_GONE.
   * 로그아웃이 세션 행을 지우므로 행 잠금이 둘을 줄 세운다(연결이 먼저 끝나면 로그아웃은 그 뒤에 세션만 지운다)
   */
  async #link(provider: ProviderId, owner: { sellerId: string; accountId: string; sessionHash: string }, providerUserId: string, label: string, now: number): Promise<SocialResult> {
    const { db, clock } = this.#options
    return db.transaction(async (raw): Promise<SocialResult> => {
      const tx = raw as unknown as Db
      await raw.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-links/${owner.accountId}`}, 0))`)
      const alive = await tx
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .innerJoin(accounts, and(eq(accounts.id, sessions.accountId), eq(accounts.sellerId, sessions.sellerId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
        .where(
          and(
            eq(sessions.tokenHash, owner.sessionHash),
            eq(sessions.sellerId, owner.sellerId),
            eq(sessions.accountId, owner.accountId),
            gt(sessions.expiresAt, new Date(clock.now())),
          ),
        )
        .limit(1)
        .for('update', { of: sessions })
      if (alive.length === 0) return 'SESSION_GONE'
      for (let attempt = 0; attempt < 2; attempt++) {
        const taken = await tx
          .select({ id: loginLinks.id, accountId: loginLinks.accountId, sellerId: loginLinks.sellerId })
          .from(loginLinks)
          .where(and(eq(loginLinks.provider, provider), eq(loginLinks.providerUserId, providerUserId)))
          .limit(1)
        const existing = taken[0]
        if (existing !== undefined) {
          if (existing.accountId !== owner.accountId || existing.sellerId !== owner.sellerId) return 'LINKED_ELSEWHERE'
          await tx.update(loginLinks).set({ label }).where(and(eq(loginLinks.id, existing.id), eq(loginLinks.sellerId, owner.sellerId)))
          return 'LINKED'
        }
        const mine = await tx
          .select({ id: loginLinks.id })
          .from(loginLinks)
          .where(and(eq(loginLinks.sellerId, owner.sellerId), eq(loginLinks.accountId, owner.accountId), eq(loginLinks.provider, provider)))
          .limit(1)
        if (mine.length > 0) return 'ALREADY_LINKED'
        const inserted = await tx
          .insert(loginLinks)
          .values({ sellerId: owner.sellerId, accountId: owner.accountId, provider, providerUserId, label, linkedAt: new Date(now) })
          .onConflictDoNothing()
          .returning({ id: loginLinks.id })
        if (inserted.length > 0) return 'LINKED'
        // 같은 순간 다른 쪽이 먼저 넣었다 — 다시 읽어 정한다
      }
      return 'LINKED_ELSEWHERE'
    })
  }

  // ── 표: 앱 로그인·가입 (D-UX3-28) ─────────────────────────────────

  async #issueTicket(input: {
    readonly kind: 'LOGIN' | 'SIGNUP'
    readonly provider: ProviderId
    readonly appChallenge: string | null
    readonly sellerId?: string
    readonly accountId?: string
    readonly providerUserId?: string
    readonly label?: string
  }): Promise<string> {
    const { db, clock, masterKey } = this.#options
    const now = clock.now()
    const ticket = randomBytes(32).toString('base64url')
    const ticketHash = sha256(ticket)
    await db.delete(loginTickets).where(lt(loginTickets.expiresAt, new Date(now)))
    await db.insert(loginTickets).values({
      ticketHash,
      kind: input.kind,
      provider: input.provider,
      appChallenge: input.appChallenge,
      sellerId: input.sellerId ?? null,
      accountId: input.accountId ?? null,
      providerUserEnc: input.providerUserId === undefined ? null : sealText(masterKey, ticketAad(input.provider, ticketHash), input.providerUserId),
      label: input.label ?? '',
      createdAt: new Date(now),
      expiresAt: new Date(now + TICKET_TTL_MS),
    })
    return ticket
  }

  /** 표를 읽는다 (쓰지 않았고·끝나지 않았고·앱이면 검증 값이 맞을 때만). 쓴 표시는 하지 않는다 */
  async #findTicket(ticket: unknown, verifier: unknown): Promise<(typeof loginTickets.$inferSelect) | null> {
    if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return null
    const now = this.#options.clock.now()
    const rows = await this.#options.db
      .select()
      .from(loginTickets)
      .where(and(eq(loginTickets.ticketHash, sha256(ticket)), isNull(loginTickets.usedAt), gt(loginTickets.expiresAt, new Date(now))))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    if (row.appChallenge === null) return verifier === undefined || verifier === null ? row : null
    if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier) || appChallengeOf(verifier) !== row.appChallenge) return null
    return row
  }

  /** 표를 쓴 것으로 표시한다 (한 문장 — 동시에 와도 하나만) */
  async #useTicket(db: Db, ticketHash: string): Promise<boolean> {
    const now = this.#options.clock.now()
    const rows = await db
      .update(loginTickets)
      .set({ usedAt: new Date(now) })
      .where(and(eq(loginTickets.ticketHash, ticketHash), isNull(loginTickets.usedAt), gt(loginTickets.expiresAt, new Date(now))))
      .returning({ ticketHash: loginTickets.ticketHash })
    return rows.length > 0
  }

  async #ticketSession(db: Db, sellerId: string, accountId: string, provider: ProviderId): Promise<TicketSession | null> {
    const rows = await db
      .select({ loginId: accounts.loginId, name: sellers.name })
      .from(accounts)
      .innerJoin(sellers, eq(sellers.id, accounts.sellerId))
      .where(and(eq(accounts.id, accountId), eq(accounts.sellerId, sellerId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const token = await this.#options.auth.createSession({ sellerId, accountId }, PROVIDER_METHOD[provider], db)
    return { token, me: { seller: { name: row.name }, loginId: row.loginId, role: 'SELLER' } }
  }

  /**
   * 앱이 돌아온 표를 낸다 (POST /api/auth/app/finish). LOGIN 표면 그 앱에 세션을 준다(연결이 아직 있을 때만).
   * SIGNUP 표면 쓰지 않고 signup을 알린다 — 앱이 약관 동의를 받은 뒤 같은 표·검증 값으로 signup을 부른다
   */
  async appFinish(ticket: unknown, verifier: unknown, address: string | null): Promise<AppFinishOutcome> {
    if (!this.#options.auth.takeLoginAttempt(address)) return { kind: 'rate_limited' }
    if (typeof verifier !== 'string') return { kind: 'expired' }
    const row = await this.#findTicket(ticket, verifier)
    if (row === null || !isProviderId(row.provider)) return { kind: 'expired' }
    const provider = row.provider
    if (row.kind === 'SIGNUP') return { kind: 'signup', provider }
    if (row.sellerId === null || row.accountId === null) return { kind: 'expired' }
    const { sellerId, accountId } = row
    const session = await this.#options.db.transaction(async (raw): Promise<TicketSession | null> => {
      const tx = raw as unknown as Db
      await raw.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-links/${accountId}`}, 0))`)
      if (!(await this.#useTicket(tx, row.ticketHash))) return null
      const link = await tx
        .select({ id: loginLinks.id })
        .from(loginLinks)
        .where(and(eq(loginLinks.sellerId, sellerId), eq(loginLinks.accountId, accountId), eq(loginLinks.provider, provider)))
        .limit(1)
      if (link[0] === undefined) return null
      await tx.update(loginLinks).set({ lastLoginAt: new Date(this.#options.clock.now()) }).where(and(eq(loginLinks.id, link[0].id), eq(loginLinks.sellerId, sellerId)))
      return this.#ticketSession(tx, sellerId, accountId, provider)
    })
    if (session === null) return { kind: 'expired' }
    this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'LOGGED_IN' })
    return { kind: 'logged_in', session }
  }

  /**
   * 가입 (POST /api/auth/signup, D-UX3-28): 웹은 가입 표 쿠키, 앱은 본문의 표·검증 값. agree가 true여야 한다(이용약관·개인정보처리방침).
   * 새 판매자 계정(가게 이름 "내 가게", 아이디 `lg-…`, 비밀번호 없음)과 연결을 한 거래로 만들고 세션을 준다.
   * 그 사이 같은 공급자 계정이 다른 곳에 연결됐으면(다른 탭에서 먼저 가입) 새로 만들지 않고 그 계정으로 로그인한다
   */
  async signup(input: { readonly ticket: unknown; readonly verifier: unknown; readonly agree: unknown }, address: string | null): Promise<SignupOutcome> {
    if (input.agree !== true) return { kind: 'not_agreed' }
    if (!this.#options.auth.takeLoginAttempt(address)) return { kind: 'rate_limited' }
    const row = await this.#findTicket(input.ticket, input.verifier)
    if (row === null || row.kind !== 'SIGNUP' || row.providerUserEnc === null || !isProviderId(row.provider)) return { kind: 'expired' }
    const provider = row.provider
    let providerUserId: string
    try {
      providerUserId = openText(this.#options.masterKey, ticketAad(provider, row.ticketHash), row.providerUserEnc)
    } catch {
      return { kind: 'expired' }
    }
    const { db, clock, masterKey } = this.#options
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const session = await db.transaction(async (raw): Promise<TicketSession | null> => {
          const tx = raw as unknown as Db
          await raw.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login-signup/${provider}/${sha256(providerUserId)}`}, 0))`)
          if (!(await this.#useTicket(tx, row.ticketHash))) return null
          const now = new Date(clock.now())
          const existing = await tx
            .select({ sellerId: loginLinks.sellerId, accountId: loginLinks.accountId })
            .from(loginLinks)
            .where(and(eq(loginLinks.provider, provider), eq(loginLinks.providerUserId, providerUserId)))
            .limit(1)
          if (existing[0] !== undefined) return this.#ticketSession(tx, existing[0].sellerId, existing[0].accountId, provider)
          let loginId = signupLoginId()
          while (await loginIdTaken(tx, loginId)) loginId = signupLoginId()
          const sellerId = randomIds.seller()
          const accountId = randomIds.account()
          await tx.insert(sellers).values({ id: sellerId, name: SIGNUP_SHOP_NAME, phoneKeyEnc: newSealedSellerKey(masterKey, sellerId), settings: '{}', createdAt: now })
          await tx.insert(accounts).values({ id: accountId, sellerId, loginId, passwordHash: '', createdAt: now, termsAgreedAt: now })
          await tx.insert(loginLinks).values({ sellerId, accountId, provider, providerUserId, label: row.label, linkedAt: now, lastLoginAt: now })
          return this.#ticketSession(tx, sellerId, accountId, provider)
        })
        if (session === null) return { kind: 'expired' }
        this.#options.log({ level: 'info', code: 'SOCIAL_LOGIN', provider, reason: 'SIGNED_UP' })
        return { kind: 'ok', session }
      } catch (error) {
        // 아이디가 같은 순간 겹쳤다 — 새 아이디로 다시 (표는 거래가 되돌아가 아직 쓰지 않음)
        if (uniqueViolation(error) === null) throw error
      }
    }
    return { kind: 'expired' }
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
