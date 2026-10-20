// 라이브 연결·인스타그램 경로 (N2, AC-N2-02·03·10~17·20~24·30·31·37·41·50·51·61). 계약은 harness/sprints/N2/dev-notes.md "화면에게".
// - /api 경로는 /api 공통 미들웨어(로그인·Origin·JSON·64KB)를 그대로 탄다. 로그인 없이 닿는 것은 OAuth 돌아오는 주소(GET /api/instagram/callback)뿐 —
//   state(그 세션에 묶임)로만 처리한다. 웹훅 받는 주소(/webhooks/instagram)는 /api 밖이라 로그인·Origin 검사 밖이고 서명이 유일한 인증이다.
// - 다른 판매자의 회차·DM 행은 404(있는지 알리지 않는다). 받은 값은 오류 응답에 되돌려 보내지 않는다.
import { isValidDate } from '@livejjim/core'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import { SESSION_COOKIE, type Auth, type SessionContext } from '../auth.ts'
import { apiError, JSON_CONTENT_TYPE } from '../errors.ts'
import type { LinkOutcome } from '../live-links.ts'
import { unknownFieldProblems } from '../messages.ts'
import { platformCapabilities } from '../platform.ts'
import { CALLBACK_MESSAGES } from './connection.ts'
import type { InstagramModule } from './index.ts'
import { WEBHOOK_BODY_LIMIT } from './webhook.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

/** 로그인 없이 닿는 /api 경로 (api.ts PUBLIC_PATHS에 더한다) */
export const INSTAGRAM_PUBLIC_PATHS = ['GET /api/instagram/callback'] as const

const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

function outcomeResponse(outcome: LinkOutcome): Response {
  return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })
}

export function registerLiveRoutes(api: Hono<Env>, instagram: InstagramModule, auth: Auth, ready: { readonly youtube: boolean }): void {
  const { connections, links, dms } = instagram
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

  // ── 플랫폼 공통 (AC-N2-02·03·04) ─────────────────────────────────────
  api.get('/platforms', (c) => c.json({ platforms: platformCapabilities({ youtube: ready.youtube, instagram: connections.configured }) }))

  api.get('/live', async (c) => c.json({ links: await links.list(session(c).sellerId) }))

  api.get('/broadcasts/:id/live', async (c) => {
    const link = await links.status(session(c).sellerId, c.req.param('id'))
    return link === null ? notFound() : c.json({ link })
  })

  api.post('/broadcasts/:id/live/wait', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'platform'])
    if (extra !== null) return extra
    return outcomeResponse(await links.wait(session(c).sellerId, session(c).accountId, requestId, c.req.param('id'), own(input, 'platform')))
  })

  api.post('/broadcasts/:id/live/link', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'platform', 'liveId'])
    if (extra !== null) return extra
    return outcomeResponse(await links.link(session(c).sellerId, session(c).accountId, requestId, c.req.param('id'), own(input, 'platform'), own(input, 'liveId')))
  })

  api.post('/broadcasts/:id/live/unlink', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    return outcomeResponse(await links.unlink(session(c).sellerId, session(c).accountId, requestId, c.req.param('id')))
  })

  // ── 인스타그램 계정 연결 (AC-N2-10~17·41) ─────────────────────────────
  api.get('/instagram', async (c) => c.json({ connection: await connections.view(session(c).sellerId) }))

  api.post('/instagram/connect', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const started = await connections.start(ref(c), 'CONNECT')
    if (!started.ok) return apiError(409, started.code, started.message)
    return c.json({ url: started.url })
  })

  // 돌아오기 (로그인 없이 닿는다 — state로만 처리, 결과는 코드로만 화면 주소에 붙인다)
  api.get('/instagram/callback', async (c) => {
    const found = await auth.session(getCookie(c, SESSION_COOKIE))
    const code = await connections.callback(
      { ...queryOf(c, 'code'), ...queryOf(c, 'state'), ...queryOf(c, 'error') },
      found === null ? null : { sellerId: found.sellerId, accountId: found.accountId, tokenHash: found.tokenHash },
    )
    const response = c.redirect(connections.returnUrl(code), 302)
    response.headers.set('Referrer-Policy', 'no-referrer')
    if (found?.refreshedCookie != null) response.headers.append('Set-Cookie', found.refreshedCookie)
    return response
  })

  api.post('/instagram/disconnect', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json({ connection: await connections.disconnect(session(c).sellerId) })
  })

  api.post('/instagram/consent', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['on'])
    if (extra !== null) return extra
    const on = own(input, 'on')
    if (typeof on !== 'boolean') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'on', message: '켤지 끌지 예나 아니오로 정해 주세요.' }])
    const result = await connections.consent(ref(c), on)
    if (result.kind === 'rejected') return apiError(409, result.code, result.message)
    if (result.kind === 'permission') return c.json({ permissionRequired: true, url: result.url, connection: await connections.view(session(c).sellerId) })
    return c.json({ permissionRequired: false, connection: result.view })
  })

  // ── 진행 중 라이브·이어지지 않은 댓글 (AC-N2-20·24·37) ─────────────────
  api.get('/instagram/lives', async (c) => {
    const sellerId = session(c).sellerId
    const result = await instagram.liveNow(sellerId)
    if (!result.ok) {
      const messages = { NOT_CONFIGURED: CALLBACK_MESSAGES.NOT_CONFIGURED, NOT_CONNECTED: '인스타그램 계정을 먼저 연결해 주세요.', RECONNECT_NEEDED: '인스타그램 연결을 다시 해 주세요.', UNAVAILABLE: '인스타그램에서 라이브 목록을 받지 못했어요. 잠시 뒤 다시 해 주세요.' } as const
      return apiError(result.failure === 'UNAVAILABLE' ? 503 : 409, result.failure, messages[result.failure])
    }
    const lives = await Promise.all(
      result.lives.map(async (live) => ({ id: live.id, startedAt: live.startedAt === null ? null : new Date(live.startedAt).toISOString(), broadcast: await links.linkedBroadcast(sellerId, live.id) })),
    )
    return c.json({ lives })
  })

  api.get('/instagram/unlinked', async (c) => {
    return c.json(await connections.unlinked(session(c).sellerId))
  })

  // ── 감사 DM (AC-N2-50·51) ─────────────────────────────────────────────
  api.get('/instagram/dms', async (c) => {
    const date = c.req.query('date')
    const rehearsal = c.req.query('rehearsal')
    if (date === undefined || !isValidDate(date)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    if (rehearsal !== undefined && rehearsal !== 'true' && rehearsal !== 'false') {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }])
    }
    return c.json({ date, rehearsal: rehearsal === 'true', rows: await dms.list(session(c).sellerId, date, rehearsal === 'true') })
  })

  api.post('/instagram/dms/:id/resend', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    const id = c.req.param('id')
    if (!/^\d{1,15}$/.test(id)) return notFound()
    return outcomeResponse(await dms.resend(session(c).sellerId, requestId, Number(id)))
  })
}

function queryOf(c: Context<Env>, name: 'code' | 'state' | 'error'): Record<string, string> {
  const value = c.req.query(name)
  return value === undefined ? {} : { [name]: value }
}

/**
 * 웹훅 받는 주소 (/webhooks/instagram, AC-N2-30·31·34): 로그인·Origin 검사 밖. 설정이 없으면 GET·POST 모두 503.
 * POST: 1MB 넘으면 413(서명 계산 전) → 서명 401 → JSON 아님 400 → 다룰 댓글을 모두 커밋한 뒤 200 / 저장 실패 500
 */
export function createWebhookApp(instagram: InstagramModule): Hono {
  const app = new Hono()
  const empty = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
  app.get('/instagram', (c) => {
    const result = instagram.webhook.verify({ ...optional('mode', c.req.query('hub.mode')), ...optional('token', c.req.query('hub.verify_token')), ...optional('challenge', c.req.query('hub.challenge')) })
    if (result.status !== 200) return empty(result.status)
    return new Response(result.body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  })
  app.post(
    '/instagram',
    async (c, next) => (instagram.settings === null ? empty(503) : next()),
    bodyLimit({ maxSize: WEBHOOK_BODY_LIMIT, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.') }),
    async (c) => {
      const raw = new Uint8Array(await c.req.arrayBuffer())
      if (!instagram.webhook.signatureOk(raw, c.req.header('x-hub-signature-256'))) return apiError(401, 'UNAUTHORIZED', '서명이 맞지 않아요.')
      const status = await instagram.webhook.receive(raw)
      if (status === 400) return apiError(400, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
      if (status === 500) return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 보내 주세요.')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })
    },
  )
  return app
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}
