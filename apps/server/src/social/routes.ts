// 간편 로그인 경로 (L1, AC-L1-01~07). 계약은 harness/sprints/L1/dev-notes.md "화면·시험에게".
// - POST /api/auth/start { provider } (세션 없음) · POST /api/auth/link { provider } (판매자 세션) → { authorizeUrl } + state 쿠키
// - GET /api/auth/<provider>/callback (세션 없음 — state·쿠키로 판단) → 302 앱 주소 + `/` 또는 `/settings` (+ ?login=<코드>&provider=<p>)
// - GET /api/auth/methods (판매자) → { loginId, providers } · POST /api/auth/unlink { provider } (판매자) → 새 목록, 없으면 404, 마지막 수단이면 409
// - (D-UX3-28) GET /api/auth/app/start?provider&challenge (세션 없음 — 앱 안 로그인 창이 연다) → state 쿠키 + 302 공급자 승인 주소
// - (D-UX3-28) POST /api/auth/app/finish { ticket, verifier } → 세션 쿠키 + { result: 'LOGGED_IN', me } 또는 { result: 'SIGNUP', provider }, 아니면 410 LOGIN_EXPIRED
// - (D-UX3-28) POST /api/auth/signup { agree: true } (웹 — 가입 표 쿠키) 또는 { agree, ticket, verifier } (앱) → 세션 쿠키 + me
// - 공급자가 하나도 켜지지 않았으면 /api/auth/** 전부 404 (api.ts가 세션 검사보다 먼저 거른다). 꺼진·모르는 공급자는 404(남은 연결 끊기만 된다).
// - 보조자 세션의 link·methods·unlink는 api.ts의 보조자 허용 목록 밖이라 403이다(처리기에 닿지 않는다).
import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { own, ownKeys } from '../api-fields.ts'
import { SESSION_COOKIE, sessionCookie, type SessionContext } from '../auth.ts'
import { apiError } from '../errors.ts'
import { LOGIN_RATE_LIMITED_MESSAGE } from '../login-limit.ts'
import { unknownFieldProblems } from '../messages.ts'
import { isProviderId } from './providers.ts'
import { CLEAR_SIGNUP_COOKIE, CLEAR_STATE_COOKIE, SIGNUP_COOKIE, signupCookie, STATE_COOKIE, stateCookie, type SessionInfo, type SocialLogin, type SocialPurpose } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

export const LINK_LAST_MESSAGE = '마지막 로그인 방법은 끊을 수 없어요.'
export const TICKET_EXPIRED_MESSAGE = '로그인 요청이 오래됐어요. 처음부터 다시 해 주세요.'
export const SIGNUP_AGREE_MESSAGE = '이용약관과 개인정보처리방침에 동의해 주세요.'
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

/** 세션을 강제하지 않는 간편 로그인 경로 (켜진 공급자의 돌아오는 주소·로그인 시작) */
export function socialPublicPaths(social: SocialLogin | null): string[] {
  if (social === null || social.enabled.length === 0) return []
  return ['POST /api/auth/start', 'GET /api/auth/app/start', 'POST /api/auth/app/finish', 'POST /api/auth/signup', ...social.enabled.map((provider) => `GET /api/auth/${provider}/callback`)]
}

/** 간편 로그인 경로인지 (공급자가 하나도 켜지지 않은 서버는 전부 404) */
export const isSocialPath = (path: string): boolean => path === '/api/auth' || path.startsWith('/api/auth/')

export function registerSocialRoutes(api: Hono<Env>, social: SocialLogin, addressOf: (c: Context) => string | null): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const info = (c: Context<Env>): SessionInfo => {
    const session = c.get('session')
    return { sellerId: session.sellerId, accountId: session.accountId, tokenHash: session.tokenHash, loginId: session.loginId, role: session.role }
  }
  const onlyProvider = (input: Record<string, unknown>): Response | null => {
    const extra = ownKeys(input).filter((key) => key !== 'provider')
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }

  const start = async (c: Context<Env>, purpose: SocialPurpose): Promise<Response> => {
    const input = body(c)
    const extra = onlyProvider(input)
    if (extra !== null) return extra
    const outcome = await social.start(own(input, 'provider'), purpose, getCookie(c, STATE_COOKIE), purpose === 'LINK' ? info(c) : null, addressOf(c))
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'rate_limited') return apiError(429, 'LOGIN_RATE_LIMITED', LOGIN_RATE_LIMITED_MESSAGE)
    c.header('Set-Cookie', stateCookie(outcome.cookie), { append: true })
    return c.json({ authorizeUrl: outcome.authorizeUrl })
  }

  api.post('/auth/start', (c) => start(c, 'LOGIN'))
  api.post('/auth/link', (c) => start(c, 'LINK'))

  // 앱 안 로그인 창이 여는 시작 주소 (D-UX3-28). 고친 것: state 쿠키를 그 창에 두고 공급자로 보낸다. 틀리면 앱으로 돌아가지 않고 404 문장
  api.get('/auth/app/start', async (c) => {
    const outcome = await social.start(c.req.query('provider'), 'LOGIN', getCookie(c, STATE_COOKIE), null, addressOf(c), c.req.query('challenge') ?? '')
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'rate_limited') return apiError(429, 'LOGIN_RATE_LIMITED', LOGIN_RATE_LIMITED_MESSAGE)
    const headers = new Headers({ Location: outcome.authorizeUrl, 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', stateCookie(outcome.cookie))
    return new Response(null, { status: 302, headers })
  })

  api.post('/auth/app/finish', async (c) => {
    const input = body(c)
    const extra = ownKeys(input).filter((key) => key !== 'ticket' && key !== 'verifier')
    if (extra.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    const outcome = await social.appFinish(own(input, 'ticket'), own(input, 'verifier'), addressOf(c))
    if (outcome.kind === 'rate_limited') return apiError(429, 'LOGIN_RATE_LIMITED', LOGIN_RATE_LIMITED_MESSAGE)
    if (outcome.kind === 'expired') return apiError(410, 'LOGIN_EXPIRED', TICKET_EXPIRED_MESSAGE)
    if (outcome.kind === 'signup') return c.json({ result: 'SIGNUP', provider: outcome.provider })
    c.header('Set-Cookie', sessionCookie(outcome.session.token))
    return c.json({ result: 'LOGGED_IN', me: outcome.session.me })
  })

  api.post('/auth/signup', async (c) => {
    const input = body(c)
    const extra = ownKeys(input).filter((key) => key !== 'agree' && key !== 'ticket' && key !== 'verifier')
    if (extra.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    const fromBody = own(input, 'ticket')
    const ticket = fromBody === undefined ? getCookie(c, SIGNUP_COOKIE) : fromBody
    const verifier = fromBody === undefined ? undefined : own(input, 'verifier')
    const outcome = await social.signup({ ticket, verifier, agree: own(input, 'agree') }, addressOf(c))
    if (outcome.kind === 'not_agreed') return apiError(400, 'INVALID_INPUT', SIGNUP_AGREE_MESSAGE)
    if (outcome.kind === 'rate_limited') return apiError(429, 'LOGIN_RATE_LIMITED', LOGIN_RATE_LIMITED_MESSAGE)
    if (outcome.kind === 'expired') {
      if (fromBody === undefined) c.header('Set-Cookie', CLEAR_SIGNUP_COOKIE, { append: true })
      return apiError(410, 'LOGIN_EXPIRED', TICKET_EXPIRED_MESSAGE)
    }
    c.header('Set-Cookie', sessionCookie(outcome.session.token), { append: true })
    if (fromBody === undefined) c.header('Set-Cookie', CLEAR_SIGNUP_COOKIE, { append: true })
    return c.json(outcome.session.me)
  })

  api.get('/auth/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    if (!social.isEnabled(provider)) return notFound()
    const outcome = await social.callback(
      provider,
      { code: c.req.query('code'), state: c.req.query('state'), error: c.req.query('error') },
      getCookie(c, STATE_COOKIE),
      getCookie(c, SESSION_COOKIE),
      addressOf(c),
    )
    const headers = new Headers({ Location: outcome.location, 'Cache-Control': 'no-store' })
    if (outcome.clearStateCookie) headers.append('Set-Cookie', CLEAR_STATE_COOKIE)
    if (outcome.sessionToken !== null) headers.append('Set-Cookie', sessionCookie(outcome.sessionToken))
    if ((outcome.signupTicket ?? null) !== null) headers.append('Set-Cookie', signupCookie(outcome.signupTicket as string))
    return new Response(null, { status: 302, headers })
  })

  api.get('/auth/methods', async (c) => c.json(await social.methods(info(c))))

  api.post('/auth/unlink', async (c) => {
    const input = body(c)
    const extra = onlyProvider(input)
    if (extra !== null) return extra
    const provider = own(input, 'provider')
    if (!isProviderId(provider)) return notFound()
    const outcome = await social.unlink(info(c), provider)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'last') return apiError(409, 'LOGIN_METHOD_LAST', LINK_LAST_MESSAGE)
    return c.json(outcome.view)
  })
}
