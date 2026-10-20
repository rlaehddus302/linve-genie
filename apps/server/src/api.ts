// /api 경로 (AC-S04-40·41·42·50~52·60, AC-S05-20·35·50~52·60·61·91, AC-S06-70·71, AC-S06b-10·11). 계약은 harness/sprints/S04/dev-notes.md "dev-server > 웹(S05)에게"와
// harness/sprints/S05/dev-notes.md "dev-server > 화면(dev-web)에게", harness/sprints/S06/dev-notes.md·harness/sprints/S06b/dev-notes.md "바뀐 계약"에 적었다.
// - 범위 = (날짜, 리허설인지). 날짜로 범위를 고르는 경로는 ?rehearsal=true를 적어야 리허설 범위이고, 적지 않으면 실제 범위다 (D-081).
// - 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE): Origin이 설정한 앱 주소와 같아야 하고(403), 본문은 JSON 객체만(415·400), 64KB 이하(413).
// - 로그인·헬스체크 밖은 세션이 필요하다(401). 다른 판매자의 자원은 404(있는지 알리지 않는다).
// - 다른 출처를 허용하는 CORS 헤더를 내지 않는다. 모든 응답은 Cache-Control: no-store.
// - 받은 값은 오류 응답에 되돌려 보내지 않는다(문제에는 필드 이름과 서버가 정한 문장만).
import { isValidDate } from '@livejjim/core'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { ASSISTANT_LIMIT, ASSISTANT_LIMIT_MESSAGE, ASSISTANT_NAME_MESSAGE, SHOP_NAME_MESSAGE } from './accounts.ts'
import { REQUEST_ID_RE, isPlainObject, own, ownKeys } from './api-fields.ts'
import { CLEAR_SESSION_COOKIE, SESSION_COOKIE, sessionCookie, type Auth, type SessionContext } from './auth.ts'
import { apiError, JSON_CONTENT_TYPE } from './errors.ts'
import type { StreamHub } from './hub.ts'
import { LOGIN_BUSY_MESSAGE, LOGIN_RATE_LIMITED_MESSAGE, clientAddress } from './login-limit.ts'
import { unknownFieldProblems } from './messages.ts'
import { ASSISTANT_EVENT_TYPES, ASSISTANT_FORBIDDEN_MESSAGE, assistantMayCall } from './roles.ts'
import { DEVICE_ID_RE, type PrintService } from './print.ts'
import { registerPrintRoutes } from './print-api.ts'
import { MESSAGES_LIMIT_DEFAULT, MESSAGES_LIMIT_MAX, Service } from './service.ts'
import { WEBHOOK_PATH, registerBillingRoutes } from './billing/api.ts'
import type { BillingService } from './billing/service.ts'
import type { Actor, WriteOutcome, WriteResult } from './writer.ts'
import { CALLBACK_PATH, registerYoutubeRoutes } from './youtube/routes.ts'
import type { Sealer } from './youtube/seal.ts'
import type { YoutubeSystem } from './youtube/system.ts'

/** 요청 본문 상한 (AC-S04-34) */
export const BODY_LIMIT_BYTES = 64 * 1024
const HISTORY_LIMIT_MAX = 500

export interface ApiDeps {
  readonly service: Service
  readonly auth: Auth
  readonly hub: StreamHub
  /** 출력 기록과 출력 기기 (I1). 없으면 /api/print 경로가 없다 */
  readonly print?: PrintService
  /** 화면 앱 주소 (Origin 검사, 예: https://app.livejjim.kr) */
  readonly appOrigin: string
  /** 화면 설정 (방송자 조치 대기 시간 — 운영 5000, E2E 기동만 줄인다 / 시험 모드 신호 testPrinter — E2E 기동만 켠다, I1) */
  readonly clientConfig?: { readonly hostActionDelayMs: number; readonly testPrinter?: boolean }
  /** 요금 (N5). 없거나 꺼져 있으면 /api/billing/**는 404 */
  readonly billing?: BillingService
  /** 유튜브 연동 (Y1, 설정이 없으면 null — 그 API는 503) */
  readonly youtube?: YoutubeSystem | null
  readonly sealer?: Sealer | null
  /** 믿는 앞단 프록시 수 (0~5, 기본 0 — X-Forwarded-For를 보지 않는다, AC-I3-66) */
  readonly trustedProxies?: number
}

/** TCP 연결 주소 (@hono/node-server가 넘기는 요청 정보). 프로세스 안 요청(시험의 app.request)은 env로 넣을 수 있고, 없으면 null */
export function connectionAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } }; server?: { incoming?: { socket?: { remoteAddress?: unknown } } } } | undefined
  const address = env?.incoming?.socket?.remoteAddress ?? env?.server?.incoming?.socket?.remoteAddress
  return typeof address === 'string' && address !== '' ? address : null
}

export type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** 세션을 강제하지 않는 경로. 유튜브 돌아오는 주소는 세션 쿠키와 state로 판매자를 정하고, 없으면 화면으로 돌려보낸다(AC-Y1-02) */
const PUBLIC_PATHS = new Set(['POST /api/login', 'GET /api/health', 'HEAD /api/health', `GET ${CALLBACK_PATH}`])

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const unauthorized = () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')
const assistantForbidden = () => apiError(403, 'ASSISTANT_FORBIDDEN', ASSISTANT_FORBIDDEN_MESSAGE)
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])

function json(c: Context, body: unknown, status: 200 = 200): Response {
  return c.json(body as object, status)
}

/** 쓰기 결과 → 응답 본문 */
function resultBody(result: WriteResult): Record<string, unknown> {
  const body: Record<string, unknown> = {
    date: result.date,
    rehearsal: result.rehearsal,
    seq: result.seq,
    type: result.type,
    changed: result.changed,
    effects: [...result.effects],
  }
  const event = result.event
  if (result.type === 'broadcast.start') body.broadcast = { id: event.b, date: event.date, title: event.title, rehearsal: result.rehearsal }
  if (result.type === 'sms') {
    body.phoneLast4 = typeof event.phoneLast4 === 'string' ? event.phoneLast4 : null
    // 그 문자찜이 정한 구매자 자신 (AC-S06b-11, D-099 — 처음 응답과 재전송 응답이 같다)
    body.buyer = result.smsBuyer ?? null
  }
  // 시청자로 보내기 (서버가 만든 메시지 ID와 쓴 가짜 채널)
  if (result.type === 'chat') body.message = { id: event.id, channel: event.ch }
  return body
}

/** ?rehearsal= 읽기: 없으면 undefined(실제), 'true'·'false'만 받는다 */
function rehearsalOf(c: Context): { ok: true; value: boolean | undefined } | { ok: false; response: Response } {
  const raw = c.req.query('rehearsal')
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' }
  return { ok: false, response: apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'rehearsal', message: "리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요." }]) }
}

const NUMBER_RE = /^\d{1,9}$/
/** 상품 ID (코어 listProducts의 id — 영문·숫자·'_'·'-' 1~64자) */
const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function outcomeResponse(c: Context, outcome: WriteOutcome, extra: Readonly<Record<string, unknown>> = {}): Response {
  switch (outcome.kind) {
    case 'ok':
    case 'duplicate': {
      const result = outcome.kind === 'ok' ? outcome.result : outcome.result
      if (result === null) return apiError(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
      if (result.failed) {
        return apiError(500, 'PROCESSING_FAILED', '처리하지 못했어요. 확인 필요 목록에 남겼어요.', [], { date: result.date, seq: result.seq })
      }
      return json(c, { ...resultBody(result), ...extra })
    }
    case 'rejected':
      return apiError(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems)
    case 'not_found':
      return notFound()
    case 'save_failed':
      return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    case 'empty':
      return apiError(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
  }
}

export function createApi(deps: ApiDeps): Hono<Env> {
  const { service, auth, hub } = deps
  const api = new Hono<Env>()
  const billing = deps.billing?.enabled === true ? deps.billing : null
  /** 요금 웹훅 (세션·Origin 없이 서명으로 확인 — 요금 기능이 켜져 있을 때만) */
  const isWebhook = (c: Context) => billing !== null && c.req.method === 'POST' && c.req.path === WEBHOOK_PATH

  // 모든 응답: 캐시 금지 (개인 데이터)
  api.use(async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
  })

  // 요금 기능이 꺼져 있으면 요금 경로는 웹훅까지 모두 404 (세션·Origin 검사보다 먼저 — BL-0 7, AC-N5-11)
  api.use(async (c, next) => {
    if (billing === null && (c.req.path === '/api/billing' || c.req.path.startsWith('/api/billing/'))) return notFound()
    return next()
  })

  // 상태를 바꾸는 요청: Origin → 크기 → JSON (기록 전에 거른다). 요금 웹훅은 Origin·JSON 읽기를 건너뛴다(서명은 받은 본문 그대로 확인)
  api.use(async (c, next) => {
    c.set('body', null)
    if (!STATE_CHANGING.has(c.req.method) || isWebhook(c)) return next()
    if (c.req.header('origin') !== deps.appOrigin) return apiError(403, 'FORBIDDEN_ORIGIN', '허용하지 않은 곳에서 온 요청이에요.')
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== JSON_CONTENT_TYPE) return apiError(415, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
    return next()
  })
  api.use(
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.'),
    }),
  )
  api.use(async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method) || isWebhook(c)) return next()
    let parsed: unknown
    try {
      parsed = JSON.parse(await c.req.text())
    } catch {
      return apiError(400, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
    }
    if (!isPlainObject(parsed)) return apiError(400, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
    c.set('body', parsed)
    return next()
  })

  // 세션 (로그인·헬스체크 밖 전부)
  api.use(async (c, next) => {
    if (PUBLIC_PATHS.has(`${c.req.method} ${c.req.path}`) || isWebhook(c)) return next()
    const session = await auth.session(getCookie(c, SESSION_COOKIE))
    if (session === null) return unauthorized()
    c.set('session', session)
    // 보조자 계정: 허용 목록 밖은 모두 403 — 처리기에 닿기 전에(아무것도 기록하지 않는다, AC-I3-61). 목록은 roles.ts(기본 거부)
    if (session.role === 'ASSISTANT' && !assistantMayCall(c.req.method, c.req.path, c.req.query('rehearsal'))) return assistantForbidden()
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

  /**
   * 방송 만들기 응답의 요금 항목 (N5, AC-N5-20): 요금 기능이 켜져 있고 실제 방송이면 그 방송의 이용 방식·방송 일을 새로 썼는지.
   * 이용 방식이 없는 방송(요금 기능을 켜기 전에 시작)은 null. 꺼져 있거나 리허설이면 항목이 없다. 같은 요청 번호의 재전송도 처음 결과와 같다
   */
  const billingOf = async (c: Context<Env>, result: WriteResult): Promise<Record<string, unknown>> => {
    if (billing === null || result.type !== 'broadcast.start' || result.rehearsal || result.failed) return {}
    const b = result.event.b
    const mode = typeof b === 'string' ? await billing.modeOf(sellerOf(c), b) : null
    return { billing: mode === null ? null : { mode: mode.mode, usedDay: mode.usedDay } }
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
    // 로그인 시도를 센 주소: 연결 주소(믿는 프록시가 있으면 X-Forwarded-For의 오른쪽에서 n번째) — 로그·응답에 남기지 않는다
    const address = clientAddress(connectionAddress(c), c.req.header('x-forwarded-for'), deps.trustedProxies ?? 0)
    const outcome = await auth.login(loginId, password, address)
    if (outcome.kind === 'rate_limited') return apiError(429, 'LOGIN_RATE_LIMITED', LOGIN_RATE_LIMITED_MESSAGE)
    if (outcome.kind === 'busy') return apiError(429, 'LOGIN_BUSY', LOGIN_BUSY_MESSAGE)
    if (outcome.kind === 'locked') return apiError(429, 'LOGIN_LOCKED', '로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요.')
    if (outcome.kind === 'failed') return apiError(401, 'LOGIN_FAILED', '아이디나 비밀번호가 맞지 않아요.')
    const session = await auth.session(outcome.token)
    c.header('Set-Cookie', sessionCookie(outcome.token))
    return c.json({ seller: { name: session?.sellerName ?? '' }, loginId: outcome.loginId, role: session?.role ?? 'SELLER' })
  })

  api.post('/logout', async (c) => {
    const session = c.get('session')
    await auth.logout(session)
    hub.closeSession(session.tokenHash)
    c.header('Set-Cookie', CLEAR_SESSION_COOKIE)
    return c.json({ ok: true })
  })

  // 내 정보: 가게 이름·아이디·역할 (보조자면 그 이름도, AC-I3-61·63)
  api.get('/me', (c) => {
    const session = c.get('session')
    const assistant = session.role === 'ASSISTANT'
    return c.json({ seller: { name: session.sellerName }, loginId: session.loginId, role: assistant ? 'ASSISTANT' : 'SELLER', assistant: assistant ? { name: session.accountName ?? '' } : null })
  })

  // ── 가게 이름 (AC-I3-47) ──────────────────────────────────────────────
  api.put('/shop', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['name'])
    if (extra !== null) return extra
    const name = await service.renameShop(sellerOf(c), own(input, 'name'))
    if (name === null) return apiError(400, 'INVALID_INPUT', SHOP_NAME_MESSAGE, [{ field: 'name', message: SHOP_NAME_MESSAGE }])
    return c.json({ shop: { name } })
  })

  // ── 시작 마법사 상태 (AC-I3-50) ───────────────────────────────────────
  api.get('/wizard', async (c) => c.json({ wizard: await service.wizard(sellerOf(c)) }))
  api.put('/wizard', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['status', 'step'])
    if (extra !== null) return extra
    const wizard = await service.setWizard(sellerOf(c), input)
    if (wizard === null) {
      return apiError(400, 'INVALID_INPUT', '마법사 상태를 확인해 주세요.', [
        { field: 'status', message: "상태는 'NEW'·'IN_PROGRESS'·'DONE'·'DISMISSED' 중 하나로 적어 주세요." },
        { field: 'step', message: "단계는 진행 중('IN_PROGRESS')일 때만 1~5의 정수로 적어 주세요." },
      ])
    }
    return c.json({ wizard })
  })

  // ── 보조자 계정 (AC-I3-60·62 — 판매자 계정만, 보조자 세션은 위에서 403) ────
  api.get('/assistants', async (c) => {
    const list = await service.assistants(sellerOf(c))
    return c.json({ assistants: list.map((row) => ({ id: row.id, name: row.name, loginId: row.loginId, createdAt: row.createdAt.toISOString() })), limit: ASSISTANT_LIMIT })
  })
  api.post('/assistants', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['name'])
    if (extra !== null) return extra
    const created = await auth.createAssistant(sellerOf(c), own(input, 'name'))
    if (!created.ok) {
      if (created.reason === 'limit') return apiError(409, 'ASSISTANT_LIMIT', ASSISTANT_LIMIT_MESSAGE)
      if (created.reason === 'name') return apiError(400, 'INVALID_INPUT', ASSISTANT_NAME_MESSAGE, [{ field: 'name', message: ASSISTANT_NAME_MESSAGE }])
      return notFound()
    }
    const { assistant, password } = created
    // 비밀번호는 이 응답에만 (DB엔 해시만, 로그 없음)
    return c.json({ assistant: { id: assistant.id, name: assistant.name, loginId: assistant.loginId, createdAt: assistant.createdAt.toISOString() }, password })
  })
  api.post('/assistants/:id/delete', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const hashes = await auth.deleteAssistant(sellerOf(c), c.req.param('id'))
    if (hashes === null) return notFound()
    // 그 보조자의 열린 실시간 연결을 바로 닫는다 (다음 요청은 401)
    for (const hash of hashes) hub.closeSession(hash)
    return c.json({ ok: true })
  })

  // 화면 설정 (방송자 조치 대기 시간, D-083 — 운영 5000밀리초 / 시험 모드 신호 — 시험용 프린터를 켠다, E2E 기동만 true, L-11 15)
  // 요금 (N5): 켜짐인지·시험 결제인지, 운영 결제일 때만 포트원 공개 값(상점 ID·채널 키). 비밀값은 없다
  api.get('/client-config', (c) =>
    c.json({
      hostActionDelayMs: deps.clientConfig?.hostActionDelayMs ?? 5000,
      testPrinter: deps.clientConfig?.testPrinter === true,
      billing:
        billing === null
          ? { enabled: false, testPayment: false }
          : {
              enabled: true,
              testPayment: billing.setup.test !== null,
              ...(billing.setup.test === null && billing.setup.publicKeys !== null ? { storeId: billing.setup.publicKeys.storeId, channelKey: billing.setup.publicKeys.channelKey } : {}),
            },
    }),
  )

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
    if (prior !== null) return outcomeResponse(c, { kind: 'duplicate', result: prior }, await billingOf(c, prior))
    const extra = onlyKeys(input, ['requestId', 'date', 'title', 'rehearsal'])
    if (extra !== null) return extra
    const parsed = Service.broadcastInput(input)
    if (!parsed.ok) return apiError(parsed.rejection.status, parsed.rejection.code, parsed.rejection.message, parsed.rejection.problems)
    const created = await service.createBroadcast(sellerOf(c), actorOf(c), requestId, parsed)
    return outcomeResponse(c, created, created.kind === 'ok' ? await billingOf(c, created.result) : {})
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
    // 보조자: 문자찜·방송자 취소만 (종류를 먼저 본다 — 그 밖은 요청 번호와 상관없이 403, 아무것도 기록하지 않는다, AC-I3-61)
    const assistant = c.get('session').role === 'ASSISTANT'
    if (assistant) {
      const type = own(input, 'type')
      if (typeof type !== 'string' || !ASSISTANT_EVENT_TYPES.includes(type)) return assistantForbidden()
    }
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    // 같은 요청 번호로 이미 기록했으면(내용이 달라도) 처음 결과 (AC-S04-25). 동시에 온 경우는 기록 경로가 트랜잭션 안에서 다시 확인한다
    const prior = await service.priorResult(sellerOf(c), requestId)
    if (prior !== null) {
      // 보조자에게는 문자찜·방송자 취소의 결과만 다시 보여 준다 (판매자의 다른 조치 결과를 요청 번호로 꺼내 보지 못하게)
      if (assistant && !ASSISTANT_EVENT_TYPES.includes(prior.type)) return assistantForbidden()
      return outcomeResponse(c, { kind: 'duplicate', result: prior })
    }
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const outcome = await service.writeEvent(sellerOf(c), actorOf(c), requestId, input, c.req.query('date'), rehearsal.value, { assistant })
    return outcomeResponse(c, outcome.kind === 'phone' ? outcome.outcome : outcome)
  })

  // ── 리허설: 시청자로 보내기·가짜 채팅 생성기 (AC-S05-51·52) ─────────────
  // 실제 방송·다른 판매자의 방송·없는 방송이면 404이고 아무것도 기록하지 않는다
  api.post('/broadcasts/:id/rehearsal/chat', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const prior = await service.priorResult(sellerOf(c), requestId)
    if (prior !== null) return outcomeResponse(c, { kind: 'duplicate', result: prior })
    const parsed = Service.viewerChatInput(input)
    if (!parsed.ok) return apiError(parsed.rejection.status, parsed.rejection.code, parsed.rejection.message, parsed.rejection.problems)
    return outcomeResponse(c, await service.viewerChat(sellerOf(c), c.req.param('id'), requestId, parsed))
  })
  api.get('/broadcasts/:id/rehearsal/generator', async (c) => {
    const status = await service.generatorStatus(sellerOf(c), c.req.param('id'))
    return status === null ? notFound() : c.json({ generator: status })
  })
  api.post('/broadcasts/:id/rehearsal/generator/start', async (c) => {
    const parsed = Service.generatorInput(body(c))
    if (!parsed.ok) return apiError(parsed.rejection.status, parsed.rejection.code, parsed.rejection.message, parsed.rejection.problems)
    const started = await service.startGenerator(sellerOf(c), c.req.param('id'), parsed)
    if (started.kind === 'not_found') return notFound()
    if (started.kind === 'rejected') return apiError(started.rejection.status, started.rejection.code, started.rejection.message, started.rejection.problems, started.extra)
    return c.json({ generator: started.status })
  })
  api.post('/broadcasts/:id/rehearsal/generator/stop', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const status = await service.stopGenerator(sellerOf(c), c.req.param('id'))
    return status === null ? notFound() : c.json({ generator: status })
  })

  // ── 조회 (AC-S04-52) ──────────────────────────────────────────────────
  // 범위 목록: 적지 않으면 실제 범위만, ?rehearsal=true면 리허설 범위만 (범위 행의 seq — 이벤트 표를 모으지 않는다, AC-S05-60)
  api.get('/days', async (c) => {
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    // 범위마다 봉인 예정 시각(sealAt)·봉인 여부 (AC-Y1-62)
    return c.json({ days: await service.days(sellerOf(c), rehearsal.value ?? false) })
  })
  api.get('/days/:date', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const view = await service.scopeView(sellerOf(c), date, rehearsal.value ?? false)
    return view === null ? notFound() : c.json(view)
  })
  api.get('/days/:date/history', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const after = c.req.query('after') ?? '0'
    const limit = c.req.query('limit') ?? '100'
    if (!NUMBER_RE.test(after) || !/^\d{1,4}$/.test(limit) || Number(limit) < 1) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [{ field: 'after', message: '시작 번호는 0 이상, 개수는 1 이상의 정수로 적어 주세요.' }])
    }
    // 상품별 조치 기록: 상품 ID(AC-S06-70 — 상품 기준) 또는 방송과 번호를 함께(AC-S05-35 — 번호 기준). 둘을 함께 적지 않는다
    const b = c.req.query('b')
    const no = c.req.query('no')
    const productId = c.req.query('product')
    if (productId !== undefined && (b !== undefined || no !== undefined || !PRODUCT_ID_RE.test(productId))) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [
        { field: 'product', message: '상품은 상품 ID(product) 하나로만 고르고, 방송(b)·번호(no)와 함께 적지 않아요.' },
      ])
    }
    if ((b === undefined) !== (no === undefined) || (b !== undefined && b === '') || (no !== undefined && (!NUMBER_RE.test(no) || Number(no) < 1))) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [{ field: 'no', message: '상품을 고를 때는 방송(b)과 1 이상의 번호(no)를 함께 적어 주세요.' }])
    }
    const product = productId !== undefined ? { product: productId } : b === undefined || no === undefined ? undefined : { b, no: Number(no) }
    const events = await service.history(sellerOf(c), date, Number(after), Math.min(Number(limit), HISTORY_LIMIT_MAX), rehearsal.value ?? false, product)
    return events === null ? notFound() : c.json({ date, rehearsal: rehearsal.value ?? false, events })
  })
  // 합치기 미리 보기 (AC-S06b-10, D-100): 그 범위의 지금 상태로 코어 previewMerge. 다른 판매자·없는 범위는 날짜 조회와 같은 404, 아무것도 기록하지 않는다
  api.get('/days/:date/merge-preview', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const input = Service.mergePreviewInput(c.req.query('from'), c.req.query('into'))
    if (!input.ok) return apiError(input.rejection.status, input.rejection.code, input.rejection.message, input.rejection.problems)
    const view = await service.mergePreview(sellerOf(c), date, rehearsal.value ?? false, input.from, input.into)
    return view === null ? notFound() : c.json(view)
  })
  // 증분 조회 (AC-S05-61, D-085): since 뒤로 바뀐 것. 줄 수 없는 since면 410 RESYNC_REQUIRED("전체를 다시 받으세요")
  api.get('/days/:date/changes', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const since = c.req.query('since')
    if (since === undefined || !NUMBER_RE.test(since)) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [{ field: 'since', message: '알고 있는 번호(since)를 0 이상의 정수로 적어 주세요.' }])
    }
    const changes = await service.changes(sellerOf(c), date, rehearsal.value ?? false, Number(since))
    if (changes === null) return notFound()
    if (changes === 'resync') return apiError(410, 'RESYNC_REQUIRED', '바뀐 내용을 이어 받을 수 없어요. 전체를 다시 불러와 주세요.')
    return c.json(changes)
  })
  // 채팅 메시지 이어 받기 (AC-S05-20): after 뒤 / before 앞 / 둘 다 없으면 가장 최근. 개수 1~500(기본 100)
  api.get('/days/:date/messages', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const after = c.req.query('after')
    const before = c.req.query('before')
    const limit = c.req.query('limit') ?? String(MESSAGES_LIMIT_DEFAULT)
    const b = c.req.query('b')
    if (
      (after !== undefined && !NUMBER_RE.test(after)) ||
      (before !== undefined && !NUMBER_RE.test(before)) ||
      (after !== undefined && before !== undefined) ||
      !/^\d{1,4}$/.test(limit) ||
      Number(limit) < 1 ||
      b === ''
    ) {
      return apiError(400, 'INVALID_INPUT', '조회 범위를 확인해 주세요.', [
        { field: 'after', message: 'after(뒤) 또는 before(앞) 중 하나를 0 이상의 정수로, 개수(limit)는 1 이상으로 적어 주세요.' },
      ])
    }
    const view = await service.messages(sellerOf(c), date, rehearsal.value ?? false, {
      ...(b === undefined ? {} : { b }),
      ...(after === undefined ? {} : { after: Number(after) }),
      ...(before === undefined ? {} : { before: Number(before) }),
      limit: Math.min(Number(limit), MESSAGES_LIMIT_MAX),
    })
    return view === null ? notFound() : c.json(view)
  })

  // ── 실시간 (AC-S04-60) ────────────────────────────────────────────────
  // ?device=<기기 ID>: 그 기기의 실시간 연결로 센다 (출력 기기 "연결됨/끊김", I1 AC-I1-10)
  api.get('/stream', async (c) => {
    const session = c.get('session')
    const device = c.req.query('device')
    if (device !== undefined && !DEVICE_ID_RE.test(device)) {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'device', message: "기기 ID는 영문·숫자·'_'·'-'로 된 8~64자여야 해요." }])
    }
    // 연결을 먼저 등록한 뒤 범위별 seq를 읽는다 — 그 사이 커밋된 변경도 알림으로 받는다 (RA-S04-003)
    // 보조자 연결은 유튜브·리허설 생성기·출력 기록 알림을 받지 않는다 (범위 변경 알림만 — 문자찜 입력 화면이 쓰는 것).
    // 보조자는 출력 기기가 될 수 없으므로(출력 API는 403) 기기 ID도 받지 않는다
    const assistant = session.role === 'ASSISTANT'
    return hub.open(session.sellerId, session.tokenHash, () => service.scopes(session.sellerId), { named: !assistant, deviceId: assistant ? null : (device ?? null) })
  })

  // ── 유튜브 (Y1) ──────────────────────────────────────────────────────
  registerYoutubeRoutes(api, { service, auth, youtube: deps.youtube ?? null, sealer: deps.sealer ?? null })

  // ── 출력 기록 (I1, LABEL_RULES L-11) ──────────────────────────────────
  if (deps.print !== undefined) registerPrintRoutes(api, deps.print)

  // ── 요금 (N5, BILLING_RULES) — 켜져 있을 때만 ───────────────────────────
  if (billing !== null) registerBillingRoutes(api, billing)

  api.notFound(() => notFound())
  return api
}
