// 로그인·세션 (SYS-01, D-074, AC-S04-40).
// - 아이디 없음과 비밀번호 틀림은 같은 상태 코드·같은 본문이다. 없는 아이디도 같은 비용의 해시 확인을 거쳐 시간 차이를 줄인다.
// - 같은 아이디로 연속 10번 틀리면 15분 동안 그 아이디의 로그인을 받지 않는다(맞는 비밀번호도). 이미 로그인한 세션은 그대로 쓴다.
//   없는 아이디도 같은 규칙으로 센다(메모리) — 잠금 여부로 아이디가 있는지 알아낼 수 없게.
// - 세션: 무작위 토큰(쿠키), 서버엔 해시만. 30일, 쓰는 동안 연장. 로그아웃하면 서버에서 지운다.
import { eq, sql } from 'drizzle-orm'
import { LOGIN_ID_RE, PASSWORD_MAX, normalizeLoginId } from './accounts.ts'
import type { Db } from './db/database.ts'
import { accounts } from './db/schema.ts'
import { DEFAULT_PASSWORD_COST, hashPassword, newSessionToken, sha256Hex, tokenHash, verifyPassword, type PasswordCost } from './secrets.ts'
import { deleteSession, extendSession, findAccountByLogin, findSession, insertSession, setLoginFailures, type SessionRow } from './store.ts'
import type { Clock } from './time.ts'

export const SESSION_COOKIE = 'lj_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 이 시간이 지나면 쓸 때 만료 시각을 다시 늘린다 (요청마다 DB에 쓰지 않게) */
export const SESSION_EXTEND_AFTER_MS = 10 * 60 * 1000
export const LOCK_AFTER_FAILURES = 10
export const LOCK_MS = 15 * 60 * 1000
const UNKNOWN_TRACK_MAX = 10_000

export type LoginOutcome =
  | { readonly kind: 'ok'; readonly token: string; readonly sellerId: string; readonly loginId: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'locked' }

export interface AuthOptions {
  readonly db: Db
  readonly clock: Clock
  readonly passwordCost?: PasswordCost
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
  /** 없는 아이디의 연속 실패 (아이디 해시 → 실패 수·잠금 시각) */
  readonly #unknown = new Map<string, { failures: number; lockedUntil: number }>()

  constructor(options: AuthOptions) {
    this.#options = options
    this.#dummyHash = hashPassword(newSessionToken(), options.passwordCost ?? DEFAULT_PASSWORD_COST)
    this.#dummyHash.catch(() => {})
  }

  async login(rawLoginId: string, password: string): Promise<LoginOutcome> {
    const { db, clock } = this.#options
    const now = clock.now()
    const loginId = normalizeLoginId(rawLoginId)
    const account = LOGIN_ID_RE.test(loginId) && password.length <= PASSWORD_MAX ? await findAccountByLogin(db, loginId) : null
    if (account === null) {
      const key = sha256Hex(loginId)
      const tracked = this.#unknown.get(key)
      if (tracked !== undefined && tracked.lockedUntil > now) return { kind: 'locked' }
      await verifyPassword(password.slice(0, PASSWORD_MAX), await this.#dummyHash)
      this.#countUnknown(key, tracked, now)
      return { kind: 'failed' }
    }
    if (account.lockedUntil !== null && account.lockedUntil.getTime() > now) return { kind: 'locked' }
    if (!(await verifyPassword(password, account.passwordHash))) {
      const lockUntil = new Date(now + LOCK_MS).toISOString()
      await db
        .update(accounts)
        .set({
          failedLogins: sql`CASE WHEN ${accounts.failedLogins} + 1 >= ${LOCK_AFTER_FAILURES} THEN 0 ELSE ${accounts.failedLogins} + 1 END`,
          lockedUntil: sql`CASE WHEN ${accounts.failedLogins} + 1 >= ${LOCK_AFTER_FAILURES} THEN ${lockUntil}::timestamptz ELSE ${accounts.lockedUntil} END`,
        })
        .where(eq(accounts.id, account.id))
      return { kind: 'failed' }
    }
    if (account.failedLogins !== 0 || account.lockedUntil !== null) await setLoginFailures(db, account, 0, null)
    const token = newSessionToken()
    await insertSession(db, { tokenHash: tokenHash(token), sellerId: account.sellerId, accountId: account.id, now: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
    return { kind: 'ok', token, sellerId: account.sellerId, loginId: account.loginId }
  }

  #countUnknown(key: string, tracked: { failures: number; lockedUntil: number } | undefined, now: number): void {
    const failures = (tracked === undefined || (tracked.lockedUntil !== 0 && tracked.lockedUntil <= now) ? 0 : tracked.failures) + 1
    if (!this.#unknown.has(key) && this.#unknown.size >= UNKNOWN_TRACK_MAX) {
      const oldest = this.#unknown.keys().next()
      if (oldest.done !== true) this.#unknown.delete(oldest.value)
    }
    this.#unknown.set(key, failures >= LOCK_AFTER_FAILURES ? { failures: 0, lockedUntil: now + LOCK_MS } : { failures, lockedUntil: 0 })
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
}
