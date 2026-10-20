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
import { REQUEST_ID_RE, isPlainObject, own, ownKeys } from './api-fields.ts'
import { CLEAR_SESSION_COOKIE, SESSION_COOKIE, sessionCookie, type Auth, type SessionContext } from './auth.ts'
import { ClosingService, buyerParam, type ApiProblem, type FileResult, type Outcome } from './closing.ts'
import { apiError, JSON_CONTENT_TYPE } from './errors.ts'
import { MIME, fileResponse } from './files.ts'
import type { StreamHub } from './hub.ts'
import { unknownFieldProblems } from './messages.ts'
import { MESSAGES_LIMIT_DEFAULT, MESSAGES_LIMIT_MAX, Service } from './service.ts'
import type { Actor, WriteOutcome, WriteResult } from './writer.ts'

/** 요청 본문 상한 (AC-S04-34) */
export const BODY_LIMIT_BYTES = 64 * 1024
/** 상품 목록 가져오기 미리 보기 본문 상한 (I2 AC-I2-51 — 파일 2MB의 base64·붙여 넣은 글 200,000글자) */
export const IMPORT_BODY_LIMIT_BYTES = 3 * 1024 * 1024
const IMPORT_PREVIEW_PATH = /^\/api\/broadcasts\/[^/]+\/import\/preview$/
const HISTORY_LIMIT_MAX = 500

export interface ApiDeps {
  readonly service: Service
  /** 정산 마무리 (I2 — 가게 설정·확인서·판매대장·포장·지난 구매·가져오기·백업·내려받기) */
  readonly closing: ClosingService
  readonly auth: Auth
  readonly hub: StreamHub
  /** 화면 앱 주소 (Origin 검사, 예: https://app.livejjim.kr) */
  readonly appOrigin: string
  /** 화면 설정 (방송자 조치 대기 시간 — 운영 5000, E2E 기동만 줄인다) */
  readonly clientConfig?: { readonly hostActionDelayMs: number }
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
  const { service, closing, auth, hub } = deps
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
    if (contentType !== JSON_CONTENT_TYPE) return apiError(415, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
    return next()
  })
  // 본문 상한: 64KB, 상품 목록 가져오기 미리 보기만 3MB (I2)
  const smallBody = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.') })
  const importBody = bodyLimit({ maxSize: IMPORT_BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요(2MB까지).') })
  api.use((c, next) => (c.req.method === 'POST' && IMPORT_PREVIEW_PATH.test(c.req.path) ? importBody(c, next) : smallBody(c, next)))
  api.use(async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method)) return next()
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

  // 화면 설정 (방송자 조치 대기 시간, D-083 — 운영 5000밀리초)
  api.get('/client-config', (c) => c.json({ hostActionDelayMs: deps.clientConfig?.hostActionDelayMs ?? 5000 }))

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
    const extra = onlyKeys(input, ['requestId', 'date', 'title', 'rehearsal'])
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
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const outcome = await service.writeEvent(sellerOf(c), actorOf(c), requestId, input, c.req.query('date'), rehearsal.value)
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
    return c.json({ days: await service.scopes(sellerOf(c), rehearsal.value ?? false) })
  })
  api.get('/days/:date', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const view = await service.scopeView(sellerOf(c), date, rehearsal.value ?? false)
    if (view === null) return notFound()
    // 실제 범위: 묶음마다 포장·배송 상태 (I2 AC-I2-33 — 리허설 범위에는 없다)
    if (rehearsal.value === true) return c.json(view)
    return c.json({ ...view, packing: await closing.packingSummary(sellerOf(c), date) })
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

  // ── I2 정산 마무리 (harness/sprints/I2/dev-notes.md "API") ─────────────
  const problemResponse = (error: ApiProblem): Response => apiError(error.status, error.code, error.message, error.problems ?? [], error.extra ?? {})
  const fileOf = (outcome: Outcome<FileResult>): Response => {
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    const file = outcome.value
    return fileResponse(file.bytes, file.type, file.fileName, file.fallback, file.headers)
  }
  /** 날짜 경로와 ?rehearsal= (확인서는 리허설 범위도 된다) */
  const scopeParams = (c: Context<Env>): { ok: true; date: string; rehearsal: boolean } | { ok: false; response: Response } => {
    const date = c.req.param('date') ?? ''
    if (!isValidDate(date)) return { ok: false, response: notFound() }
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal
    return { ok: true, date, rehearsal: rehearsal.value ?? false }
  }
  /** 포장·라벨·지난 구매는 실제 범위만 — ?rehearsal=true면 날짜 조회처럼 404 (AC-I2-30) */
  const realScope = (c: Context<Env>): { ok: true; date: string } | { ok: false; response: Response } => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope
    if (scope.rehearsal) return { ok: false, response: notFound() }
    return { ok: true, date: scope.date }
  }

  // 가게 설정 (AC-I2-01)
  api.get('/shop', async (c) => c.json({ shop: await closing.shop(sellerOf(c)) }))
  api.put('/shop', async (c) => {
    const result = await closing.updateShop(sellerOf(c), body(c))
    if (!result.ok) return apiError(result.rejection.status, result.rejection.code, result.rejection.message, result.rejection.problems)
    return c.json({ shop: result.shop })
  })

  // 확인서 (AC-I2-10·11): 데이터(JSON = 확인서 데이터 그대로)·PDF·PNG·전원 PDF
  api.get('/days/:date/receipt', async (c) => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    const outcome = await closing.receipt(sellerOf(c), scope.date, scope.rehearsal, buyer.buyer)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    c.header('X-Receipt-Created-At', String(outcome.value.createdAt))
    return c.json(outcome.value.receipt)
  })
  for (const kind of ['pdf', 'png'] as const) {
    api.get(`/days/:date/receipt.${kind}`, async (c) => {
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      const buyer = buyerParam(c.req.query('buyer'))
      if (!buyer.ok) return problemResponse(buyer.error)
      return fileOf(await closing.receiptFile(sellerOf(c), scope.date, scope.rehearsal, buyer.buyer, kind))
    })
  }
  api.get('/days/:date/receipts.pdf', async (c) => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope.response
    return fileOf(await closing.batchPdf(sellerOf(c), scope.date, scope.rehearsal))
  })

  // 판매대장 (AC-I2-20): ?from=&to=&b=<방송 ID>&b=… (b가 없으면 기간 안 모든 실제 방송)
  api.get('/ledger.xlsx', async (c) => {
    const picked = c.req.queries('b')
    return fileOf(await closing.ledger(sellerOf(c), c.req.query('from'), c.req.query('to'), picked === undefined ? null : picked))
  })

  // 포장·배송 (AC-I2-30~32)
  api.get('/days/:date/packing', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const list = await closing.packingList(sellerOf(c), scope.date)
    return list === null ? notFound() : c.json(list)
  })
  api.post('/days/:date/packing', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const parsed = ClosingService.packingInput(input)
    if (!parsed.ok) return problemResponse(parsed.error)
    const outcome = await closing.packingCommand(sellerOf(c), c.get('session').accountId, scope.date, requestId, parsed)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    return c.json({ date: scope.date, entry: outcome.value.entry, recorded: outcome.value.recorded })
  })

  // 포장 라벨 (AC-I2-34): 데이터(JSON)·쪽 그림(PNG, ?page=1부터)·라벨 PDF. 아무것도 기록하지 않고 출력 작업을 만들지 않는다
  api.get('/days/:date/packing-label', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    const outcome = await closing.packingLabel(sellerOf(c), scope.date, buyer.buyer)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    return c.json({ date: scope.date, buyer: outcome.value.buyer, data: outcome.value.data, pages: outcome.value.pages.length })
  })
  api.get('/days/:date/packing-label.png', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    const pageText = c.req.query('page') ?? '1'
    if (!/^[1-9][0-9]{0,3}$/.test(pageText)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'page', message: '쪽 번호를 확인해 주세요.' }])
    const outcome = await closing.packingLabel(sellerOf(c), scope.date, buyer.buyer)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    const page = Number(pageText)
    const bytes = outcome.value.pages[page - 1]
    if (bytes === undefined) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'page', message: '쪽 번호를 확인해 주세요.' }])
    const n = outcome.value.pages.length
    return fileResponse(bytes, MIME.png, `포장라벨-${scope.date}-${outcome.value.name}-${String(page)}of${String(n)}.png`, `packing-label-${scope.date}-${String(page)}of${String(n)}.png`)
  })
  api.get('/days/:date/packing-label.pdf', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    const outcome = await closing.packingLabel(sellerOf(c), scope.date, buyer.buyer)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    const pdf = outcome.value.pdf()
    if (pdf === null) return apiError(500, 'LABEL_INVALID', '포장 라벨을 만들지 못했어요. 고객센터에 알려 주세요.')
    return fileResponse(pdf, MIME.pdf, `포장라벨-${scope.date}-${outcome.value.name}.pdf`, `packing-label-${scope.date}.pdf`)
  })

  // 지난 구매 (AC-I2-40): ?buyer=&before=YYYY-MM-DD(다음 쪽)
  api.get('/days/:date/past', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    const before = c.req.query('before')
    if (before !== undefined && !isValidDate(before)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'before', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    const view = await closing.past(sellerOf(c), scope.date, buyer.buyer, before ?? null)
    return view === null ? notFound() : c.json(view)
  })

  // 상품 목록 가져오기 (AC-I2-51): 미리 보기(기록하지 않음)·등록(한 트랜잭션)
  api.post('/broadcasts/:id/import/preview', async (c) => {
    const outcome = await closing.importPreview(sellerOf(c), c.req.param('id'), body(c))
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    return c.json(outcome.value)
  })
  api.post('/broadcasts/:id/import', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const parsed = ClosingService.importRows(input)
    if (!parsed.ok) return problemResponse(parsed.error)
    const outcome = await closing.importRegister(sellerOf(c), actorOf(c), c.req.param('id'), requestId, parsed.rows)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    return c.json(outcome.value)
  })

  // 백업 상태·전체 내려받기 (AC-I2-61·64) — 백업 파일 내용을 내려받는 API는 없다
  api.get('/backups', async (c) => c.json(await closing.backupStatus(sellerOf(c))))
  api.get('/export/records.json.gz', async (c) => fileOf(await closing.exportRecords(sellerOf(c))))
  api.get('/export/ledger.xlsx', async (c) => fileOf(await closing.exportLedger(sellerOf(c))))

  // ── 실시간 (AC-S04-60) ────────────────────────────────────────────────
  api.get('/stream', async (c) => {
    const session = c.get('session')
    // 연결을 먼저 등록한 뒤 범위별 seq를 읽는다 — 그 사이 커밋된 변경도 알림으로 받는다 (RA-S04-003)
    return hub.open(session.sellerId, session.tokenHash, () => service.scopes(session.sellerId))
  })

  api.notFound(() => notFound())
  return api
}
