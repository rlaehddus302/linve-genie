// /api 경로 (AC-S04-40·41·42·50~52·60). 계약은 harness/sprints/S04/dev-notes.md "dev-server > 웹(S05)에게"에 적었다.
// - 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE): Origin이 설정한 앱 주소와 같아야 하고(403), 본문은 JSON 객체만(415·400), 64KB 이하(413).
// - 로그인·헬스체크 밖은 세션이 필요하다(401). 다른 판매자의 자원은 404(있는지 알리지 않는다).
// - 다른 출처를 허용하는 CORS 헤더를 내지 않는다. 모든 응답은 Cache-Control: no-store.
// - 받은 값은 오류 응답에 되돌려 보내지 않는다(문제에는 필드 이름과 서버가 정한 문장만).
import { isValidDate } from '@livejjim/core'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { REQUEST_ID_RE, isPlainObject, own, ownKeys } from './api-fields.ts'
import { CLEAR_SESSION_COOKIE, SESSION_COOKIE, sessionCookie, type Auth, type SessionContext } from './auth.ts'
import { apiError, JSON_CONTENT_TYPE } from './errors.ts'
import type { StreamHub } from './hub.ts'
import { unknownFieldProblems } from './messages.ts'
import { Service } from './service.ts'
import type { Actor, WriteOutcome, WriteResult } from './writer.ts'

/** 요청 본문 상한 (AC-S04-34) */
export const BODY_LIMIT_BYTES = 64 * 1024
const HISTORY_LIMIT_MAX = 500

export interface ApiDeps {
  readonly service: Service
  readonly auth: Auth
  readonly hub: StreamHub
  /** 화면 앱 주소 (Origin 검사, 예: https://app.livejjim.kr) */
  readonly appOrigin: string
}

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PUBLIC_PATHS = new Set(['POST /api/login', 'GET /api/health', 'HEAD /api/health'])

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const unauthorized = () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])

function json(c: Context, body: unknown, status: 200 = 200): Response {
  return c.json(body as object, status)
}

/** 쓰기 결과 → 응답 본문 */
function resultBody(result: WriteResult): Record<string, unknown> {
  const body: Record<string, unknown> = { date: result.date, seq: result.seq, type: result.type, changed: result.changed, effects: [...result.effects] }
  const event = result.event
  if (result.type === 'broadcast.start') body.broadcast = { id: event.b, date: event.date, title: event.title }
  if (result.type === 'sms') body.phoneLast4 = typeof event.phoneLast4 === 'string' ? event.phoneLast4 : null
  return body
}

function outcomeResponse(c: Context, outcome: WriteOutcome): Response {
  switch (outcome.kind) {
    case 'ok':
    case 'duplicate': {
      const result = outcome.kind === 'ok' ? outcome.result : outcome.result
      if (result === null) return apiError(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
      if (result.failed) {
        return apiError(500, 'PROCESSING_FAILED', '처리하지 못했어요. 확인 필요 목록에 남겼어요.', [], { date: result.date, seq: result.seq })
      }
      return json(c, resultBody(result))
    }
    case 'rejected':
      return apiError(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems)
    case 'not_found':
      return notFound()
    case 'save_failed':
      return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
  }
}

export function createApi(deps: ApiDeps): Hono<Env> {
  const { service, auth, hub } = deps
  const api = new Hono<Env>()

  // 모든 응답: 캐시 금지 (개인 데이터)
  api.use(async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
  })

  // 상태를 바꾸는 요청: Origin → 크기 → JSON (기록 전에 거른다)
  api.use(async (c, next) => {
    c.set('body', null)
    if (!STATE_CHANGING.has(c.req.method)) return next()
    if (c.req.header('origin') !== deps.appOrigin) return apiError(403, 'FORBIDDEN_ORIGIN', '허용하지 않은 곳에서 온 요청이에요.')
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== JSON_CONTENT_TYPE) return apiError(415, 'NOT_JSON', 'JSON 형식으로 보내 주세요.')
    return next()
  })
  api.use(
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.'),
    }),
  )
  api.use(async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method)) return next()
    let parsed: unknown
    try {
      parsed = JSON.parse(await c.req.text())
    } catch {
      return apiError(400, 'NOT_JSON', 'JSON 형식으로 보내 주세요.')
    }
    if (!isPlainObject(parsed)) return apiError(400, 'NOT_JSON', 'JSON 객체로 보내 주세요.')
    c.set('body', parsed)
    return next()
  })

  // 세션 (로그인·헬스체크 밖 전부)
  api.use(async (c, next) => {
    if (PUBLIC_PATHS.has(`${c.req.method} ${c.req.path}`)) return next()
    const session = await auth.session(getCookie(c, SESSION_COOKIE))
    if (session === null) return unauthorized()
    c.set('session', session)
    await next()
    if (session.refreshedCookie !== null) c.res.headers.append('Set-Cookie', session.refreshedCookie)
  })

  const body = (c: Context<Env>) => c.get('body') ?? {}
  const actorOf = (c: Context<Env>): Actor => ({ kind: 'account', accountId: c.get('session').accountId })
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }

  api.get('/health', (c) => c.json({ status: 'ok' }))

  // ── 로그인 (AC-S04-40) ────────────────────────────────────────────────
  api.post('/login', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['loginId', 'password'])
    if (extra !== null) return extra
    const loginId = own(input, 'loginId')
    const password = own(input, 'password')
    if (typeof loginId !== 'string' || typeof password !== 'string') {
      return apiError(400, 'INVALID_INPUT', '아이디와 비밀번호를 적어 주세요.', [
        ...(typeof loginId === 'string' ? [] : [{ field: 'loginId', message: '아이디를 적어 주세요.' }]),
        ...(typeof password === 'string' ? [] : [{ field: 'password', message: '비밀번호를 적어 주세요.' }]),
      ])
    }
    const outcome = await auth.login(loginId, password)
    if (outcome.kind === 'locked') return apiError(429, 'LOGIN_LOCKED', '로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요.')
    if (outcome.kind === 'failed') return apiError(401, 'LOGIN_FAILED', '아이디나 비밀번호가 맞지 않아요.')
    const session = await auth.session(outcome.token)
    c.header('Set-Cookie', sessionCookie(outcome.token))
    return c.json({ seller: { name: session?.sellerName ?? '' }, loginId: outcome.loginId })
  })

  api.post('/logout', async (c) => {
    const session = c.get('session')
    await auth.logout(session)
    hub.closeSession(session.tokenHash)
    c.header('Set-Cookie', CLEAR_SESSION_COOKIE)
    return c.json({ ok: true })
  })

  api.get('/me', (c) => {
    const session = c.get('session')
    return c.json({ seller: { name: session.sellerName }, loginId: session.loginId })
  })

  // ── 설정 (AC-S04-50) ──────────────────────────────────────────────────
  api.get('/settings', async (c) => c.json({ settings: await service.settings(sellerOf(c)) }))
  api.patch('/settings', async (c) => {
    const result = await service.updateSettings(sellerOf(c), body(c))
    if (!result.ok) return apiError(result.rejection.status, result.rejection.code, result.rejection.message, result.rejection.problems)
    return c.json({ settings: result.settings })
  })

  // ── 방송 (AC-S04-21) ──────────────────────────────────────────────────
  api.get('/broadcasts', async (c) => c.json({ broadcasts: await service.broadcasts(sellerOf(c)) }))
  api.post('/broadcasts', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const prior = await service.priorResult(sellerOf(c), requestId)
    if (prior !== null) return outcomeResponse(c, { kind: 'duplicate', result: prior })
    const extra = onlyKeys(input, ['requestId', 'date', 'title'])
    if (extra !== null) return extra
    const parsed = Service.broadcastInput(input)
    if (!parsed.ok) return apiError(parsed.rejection.status, parsed.rejection.code, parsed.rejection.message, parsed.rejection.problems)
    return outcomeResponse(c, await service.createBroadcast(sellerOf(c), actorOf(c), requestId, parsed))
  })
  api.post('/broadcasts/:id/end', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const prior = await service.priorResult(sellerOf(c), requestId)
    if (prior !== null) return outcomeResponse(c, { kind: 'duplicate', result: prior })
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    return outcomeResponse(c, await service.endBroadcast(sellerOf(c), actorOf(c), requestId, c.req.param('id')))
  })

  // ── 이벤트 쓰기 (AC-S04-31·51) ────────────────────────────────────────
  api.post('/events', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    // 같은 요청 번호로 이미 기록했으면(내용이 달라도) 처음 결과 (AC-S04-25). 동시에 온 경우는 기록 경로가 트랜잭션 안에서 다시 확인한다
    const prior = await service.priorResult(sellerOf(c), requestId)
    if (prior !== null) return outcomeResponse(c, { kind: 'duplicate', result: prior })
    const outcome = await service.writeEvent(sellerOf(c), actorOf(c), requestId, input, c.req.query('date'))
    return outcomeResponse(c, outcome.kind === 'phone' ? outcome.outcome : outcome)
  })

  // ── 조회 (AC-S04-52) ──────────────────────────────────────────────────
  api.get('/days', async (c) => c.json({ days: await service.scopes(sellerOf(c)) }))
  api.get('/days/:date', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const view = await service.scopeView(sellerOf(c), date)
    return view === null ? notFound() : c.json(view)
  })
  api.get('/days/:date/history', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const after = c.req.query('after') ?? '0'
    const limit = c.req.query('limit') ?? '100'
    if (!/^\d{1,9}$/.test(after) || !/^\d{1,4}$/.test(limit) || Number(limit) < 1) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [{ field: 'after', message: 'after는 0 이상, limit는 1 이상의 정수예요.' }])
    }
    const events = await service.history(sellerOf(c), date, Number(after), Math.min(Number(limit), HISTORY_LIMIT_MAX))
    return events === null ? notFound() : c.json({ date, events })
  })

  // ── 실시간 (AC-S04-60) ────────────────────────────────────────────────
  api.get('/stream', async (c) => {
    const session = c.get('session')
    return hub.open(session.sellerId, session.tokenHash, await service.scopes(session.sellerId))
  })

  api.notFound(() => notFound())
  return api
}
