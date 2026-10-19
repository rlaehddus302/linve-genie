// 로그인·세션 (SYS-01, D-074, AC-S04-40).
// - 아이디 없음과 비밀번호 틀림은 같은 상태 코드·같은 본문이다. 없는 아이디도 같은 비용의 해시 확인을 거쳐 시간 차이를 줄인다.
// - 같은 아이디로 연속 10번 틀리면 15분 동안 그 아이디의 로그인을 받지 않는다(맞는 비밀번호도). 이미 로그인한 세션은 그대로 쓴다.
//   시도 수는 비밀번호를 확인하기 **전에** 한 문장으로 먼저 올린다(SA-S04-001). 확인과 기록 사이가 비어 있으면
//   동시에 보낸 요청이 모두 잠금 확인을 통과해 한도를 넘어 비밀번호를 확인받는다.
//   있는 아이디와 없는 아이디를 같은 표(login_limits)·같은 순서로 센다(SA-S04-002) — 비밀번호 길이·서버 재시작·
//   인스턴스·표 정리 어느 쪽으로도 잠금 응답이 갈리지 않아 아이디가 있는지 알 수 없다.
// - 세션: 무작위 토큰(쿠키), 서버엔 해시만. 30일, 쓰는 동안 연장. 로그아웃하면 서버에서 지운다.
import { LOGIN_ID_RE, PASSWORD_MAX, createAssistant, normalizeLoginId, type CreateAssistantResult } from './accounts.ts'
import type { Db } from './db/database.ts'
import { errorKind, type LogSink } from './log.ts'
import { DEFAULT_PASSWORD_COST, hashPassword, loginLimitKey, newSessionToken, tokenHash, verifyPassword, type PasswordCost } from './secrets.ts'
import {
  claimLoginAttempt,
  deleteAssistant,
  deleteSession,
  extendSession,
  findAccountByLogin,
  findSession,
  insertSession,
  pruneLoginLimits,
  releaseLoginAttempt,
  type SessionRow,
} from './store.ts'
import type { Clock } from './time.ts'

export const SESSION_COOKIE = 'lj_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 이 시간이 지나면 쓸 때 만료 시각을 다시 늘린다 (요청마다 DB에 쓰지 않게) */
export const SESSION_EXTEND_AFTER_MS = 10 * 60 * 1000
export const LOCK_AFTER_FAILURES = 10
export const LOCK_MS = 15 * 60 * 1000
/** 잠기지 않은 시도 수 행을 이만큼까지 둔다 (넘으면 마지막 시도가 오래된 것부터 정리 — 잠긴 행은 잠금이 끝날 때까지 둔다) */
export const LOGIN_LIMIT_KEEP = 100_000
/** 로그인 시도 이만큼마다 한 번 시도 수 표를 정리한다 */
export const LOGIN_PRUNE_EVERY = 500

export type LoginOutcome =
  | { readonly kind: 'ok'; readonly token: string; readonly sellerId: string; readonly loginId: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'locked' }

export interface AuthOptions {
  readonly db: Db
  readonly clock: Clock
  /** 시도 수 표의 키를 만드는 비밀 키 (loginLimitSecret(마스터 키)) */
  readonly limitSecret: Buffer
  readonly passwordCost?: PasswordCost
  readonly log?: LogSink
  /** 정리 기준 (시험에서 줄인다): 잠기지 않은 행을 이만큼까지 둔다 */
  readonly limitKeep?: number
  /** 정리 간격 (시험에서 줄인다): 로그인 시도 이만큼마다 */
  readonly pruneEvery?: number
}

export interface SessionContext extends SessionRow {
  /** 쿠키를 다시 보내야 하면(만료 시각을 늘림) 새 쿠키 값 */
  readonly refreshedCookie: string | null
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(SESSION_TTL_MS / 1000)}`
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export class Auth {
  readonly #options: AuthOptions
  readonly #dummyHash: Promise<string>
  #attempts = 0

  constructor(options: AuthOptions) {
    this.#options = options
    this.#dummyHash = hashPassword(newSessionToken(), options.passwordCost ?? DEFAULT_PASSWORD_COST)
    this.#dummyHash.catch(() => {})
  }

  async login(rawLoginId: string, password: string): Promise<LoginOutcome> {
    const { db, clock } = this.#options
    const now = clock.now()
    const loginId = normalizeLoginId(rawLoginId)
    const key = loginLimitKey(this.#options.limitSecret, loginId)
    await this.#maybePrune(now)
    // 1. 비밀번호를 확인하기 전에 시도 자리를 잡는다. 잠겨 있으면(확인 중인 시도까지 10번) 확인하지 않는다
    const attempt = await claimLoginAttempt(db, key, new Date(now), new Date(now + LOCK_MS), LOCK_AFTER_FAILURES)
    if (attempt === null) return { kind: 'locked' }
    // 2. 계정은 비밀번호 길이와 상관없이 아이디로 찾는다. 형식이 틀린 아이디의 계정은 있을 수 없다
    const account = LOGIN_ID_RE.test(loginId) ? await findAccountByLogin(db, loginId) : null
    // 3. 계정이 없거나 비밀번호가 상한을 넘으면 같은 비용의 가짜 확인만 하고 실패다 (실패 수는 1에서 이미 셌다)
    if (account === null || password.length > PASSWORD_MAX) {
      await verifyPassword(password.slice(0, PASSWORD_MAX), await this.#dummyHash)
      return { kind: 'failed' }
    }
    if (!(await verifyPassword(password, account.passwordHash))) return { kind: 'failed' }
    // 4. 맞았다: 연속 실패 수를 0으로 (이 시도 뒤에 잡힌, 아직 확인 중인 시도만 남는다)
    await releaseLoginAttempt(db, key, attempt)
    const token = newSessionToken()
    await insertSession(db, { tokenHash: tokenHash(token), sellerId: account.sellerId, accountId: account.id, now: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
    return { kind: 'ok', token, sellerId: account.sellerId, loginId: account.loginId }
  }

  /** 시도 수 표가 끝없이 자라지 않게 가끔 정리한다. 정리하지 못해도 로그인은 계속한다 */
  async #maybePrune(now: number): Promise<void> {
    this.#attempts += 1
    if (this.#attempts % (this.#options.pruneEvery ?? LOGIN_PRUNE_EVERY) !== 0) return
    try {
      await pruneLoginLimits(this.#options.db, new Date(now), this.#options.limitKeep ?? LOGIN_LIMIT_KEEP)
    } catch (error) {
      this.#options.log?.({ level: 'warn', code: 'LOGIN_PRUNE_FAILED', errorKind: errorKind(error) })
    }
  }

  /** 쿠키의 토큰으로 세션 찾기 (만료·위조면 null). 쓰는 동안 만료 시각을 늘린다 */
  async session(token: string | undefined): Promise<SessionContext | null> {
    if (token === undefined || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
    const { db, clock } = this.#options
    const now = clock.now()
    const row = await findSession(db, tokenHash(token), new Date(now))
    if (row === null) return null
    if (now - row.extendedAt.getTime() < SESSION_EXTEND_AFTER_MS) return { ...row, refreshedCookie: null }
    const expiresAt = new Date(now + SESSION_TTL_MS)
    await extendSession(db, row, new Date(now), expiresAt)
    return { ...row, expiresAt, extendedAt: new Date(now), refreshedCookie: sessionCookie(token) }
  }

  /** 세션 해시가 아직 유효한지 (실시간 연결 하트비트) */
  async alive(sessionHash: string): Promise<boolean> {
    return (await findSession(this.#options.db, sessionHash, new Date(this.#options.clock.now()))) !== null
  }

  async logout(session: Pick<SessionRow, 'tokenHash' | 'sellerId'>): Promise<void> {
    await deleteSession(this.#options.db, session)
  }

  /** 판매자가 보조자를 만든다 (아이디·비밀번호는 서버가 만든다 — 비밀번호는 결과에만, AC-I3-60) */
  createAssistant(sellerId: string, name: unknown): Promise<CreateAssistantResult> {
    return createAssistant(this.#options.db, sellerId, name, { clock: this.#options.clock, ...(this.#options.passwordCost === undefined ? {} : { passwordCost: this.#options.passwordCost }) })
  }

  /** 보조자를 지운다: 그 계정의 세션을 모두 지우고 그 세션 해시를 돌려준다(실시간 연결 닫기). 그 판매자의 보조자가 아니면 null (AC-I3-62) */
  deleteAssistant(sellerId: string, accountId: string): Promise<string[] | null> {
    return deleteAssistant(this.#options.db, sellerId, accountId, new Date(this.#options.clock.now()))
  }
}
