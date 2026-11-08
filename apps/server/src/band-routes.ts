// 밴드 경로 (BND1, AC-BND1-11~15·20~24·41) — 밴드 모듈(band/) 밖에 둔다: 밴드 모듈 안에는 밴드로 보내는 읽기 요청만 있다(AC-BND1-60). 계약은 harness/sprints/BND1/dev-notes.md "화면에게".
// - /api 공통 미들웨어(로그인·Origin·JSON·64KB)를 그대로 탄다. 로그인 없이 닿는 것은 돌아오는 주소(GET /api/band/callback/<표>)뿐 — 표와 쿠키 세션으로만 처리한다.
// - 보조자는 허용 목록(roles.ts)의 회차 연결 보기 하나만 — 나머지는 403. 다른 판매자의 회차는 404(있는지 알리지 않는다).
// - 받은 값·밴드가 준 글은 오류 응답에 되돌려 보내지 않는다.
import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { REQUEST_ID_RE, own, ownKeys } from './api-fields.ts'
import { SESSION_COOKIE, type Auth, type SessionContext } from './auth.ts'
import { apiError, JSON_CONTENT_TYPE } from './errors.ts'
import { unknownFieldProblems } from './messages.ts'
import type { BandOutcome, BandService } from './band/service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

/** 로그인 없이 닿는 돌아오는 주소 (api.ts가 세션 검사에서 뺀다) */
export const BAND_CALLBACK_RE = /^\/api\/band\/callback\/[^/]+$/

export function isBandPublicPath(method: string, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && BAND_CALLBACK_RE.test(path)
}

const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

export function bandResponse(outcome: BandOutcome): Response {
  return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })
}

export function registerBandRoutes(api: Hono<Env>, band: BandService, auth: Auth): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const session = (c: Context<Env>) => c.get('session')
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }
  const ref = (c: Context<Env>) => ({ sellerId: session(c).sellerId, accountId: session(c).accountId, tokenHash: session(c).tokenHash })

  // ── 계정 (AC-BND1-11~14) ───────────────────────────────────────────────
  api.get('/band', async (c) => c.json({ band: await band.accountView(session(c).sellerId) }))

  api.post('/band/connect', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return bandResponse(await band.start(ref(c)))
  })

  // 돌아오기 (로그인 없이 닿는다 — 경로의 표와 쿠키 세션으로만 처리, 결과는 코드로만 화면 주소에 붙인다)
  api.get('/band/callback/:state', async (c) => {
    const found = await auth.session(getCookie(c, SESSION_COOKIE))
    const result = await band.callback(c.req.param('state'), c.req.queries('code') ?? [], found === null ? null : { sellerId: found.sellerId, accountId: found.accountId, tokenHash: found.tokenHash })
    const response = c.redirect(band.returnUrl(result), 302)
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('Cache-Control', 'no-store')
    if (found?.refreshedCookie != null) response.headers.append('Set-Cookie', found.refreshedCookie)
    return response
  })

  api.post('/band/disconnect', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    return bandResponse(await band.disconnect(session(c).sellerId, session(c).accountId, requestId))
  })

  // ── 밴드·글 고르기 (AC-BND1-20·21) ─────────────────────────────────────
  api.get('/band/bands', async (c) => bandResponse(await band.bands(session(c).sellerId)))

  api.get('/band/posts', async (c) => bandResponse(await band.posts(session(c).sellerId, c.req.query('band'), c.req.query('cursor'))))

  // ── 회차의 밴드 글 연결 (AC-BND1-22·23·41·50) — 보기는 보조자도 ──────────
  api.get('/broadcasts/:id/band', async (c) => {
    const link = await band.view(session(c).sellerId, c.req.param('id'))
    return link === null ? notFound() : c.json({ link })
  })

  api.post('/broadcasts/:id/band/link', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'bandKey', 'postKey'])
    if (extra !== null) return extra
    return bandResponse(await band.link(session(c).sellerId, session(c).accountId, requestId, c.req.param('id'), own(input, 'bandKey'), own(input, 'postKey')))
  })

  api.post('/broadcasts/:id/band/unlink', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    return bandResponse(await band.unlink(session(c).sellerId, session(c).accountId, requestId, c.req.param('id')))
  })

  api.post('/broadcasts/:id/band/notices-seen', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['upTo'])
    if (extra !== null) return extra
    const upTo = own(input, 'upTo')
    if (typeof upTo !== 'number' || !Number.isSafeInteger(upTo) || upTo < 0) {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'upTo', message: '확인한 알림 번호를 0 이상의 정수로 보내 주세요.' }])
    }
    return bandResponse(await band.noticesSeen(session(c).sellerId, c.req.param('id'), upTo))
  })
}
