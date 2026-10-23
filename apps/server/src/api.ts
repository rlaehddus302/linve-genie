// /api 경로 (AC-S04-40·41·42·50~52·60, AC-S05-20·35·50~52·60·61·91, AC-S06-70·71, AC-S06b-10·11). 계약은 harness/sprints/S04/dev-notes.md "dev-server > 웹(S05)에게"와
// harness/sprints/S05/dev-notes.md "dev-server > 화면(dev-web)에게", harness/sprints/S06/dev-notes.md·harness/sprints/S06b/dev-notes.md "바뀐 계약"에 적었다.
// - 범위 = (날짜, 리허설인지). 날짜로 범위를 고르는 경로는 ?rehearsal=true를 적어야 리허설 범위이고, 적지 않으면 실제 범위다 (D-081).
// - 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE): Origin이 설정한 앱 주소와 같아야 하고(403), 본문은 JSON 객체만(415·400), 64KB 이하(413).
// - 로그인·헬스체크 밖은 세션이 필요하다(401). 다른 판매자의 자원은 404(있는지 알리지 않는다).
// - 다른 출처를 허용하는 CORS 헤더를 내지 않는다. 모든 응답은 Cache-Control: no-store.
// - 받은 값은 오류 응답에 되돌려 보내지 않는다(문제에는 필드 이름과 서버가 정한 문장만).
// - N3: /api/deposits 경로(deposit/api.ts). 날짜 범위 조회(/days/:date·/changes)에 입금 연결(depositLinks)을 붙인다(AC-N3-32).
//   엔진 요청 번호 `dep-`는 입금 확인이 쓴다(dep-<번호>-pay-<차례>) — 화면 이벤트 쓰기의 요청 번호로는 받지 않는다(같은 번호로 미리 막지 못하게).
import { isValidDate } from '@livejjim/core'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { ASSISTANT_LIMIT, ASSISTANT_LIMIT_MESSAGE, ASSISTANT_NAME_MESSAGE, SHOP_NAME_MESSAGE } from './accounts.ts'
import { REQUEST_ID_RE, isPlainObject, own, ownKeys } from './api-fields.ts'
import { CLEAR_SESSION_COOKIE, SESSION_COOKIE, sessionCookie, type Auth, type SessionContext } from './auth.ts'
import { ClosingService, buyerParam, type ApiProblem, type FileResult, type Outcome } from './closing.ts'
import { apiError, JSON_CONTENT_TYPE } from './errors.ts'
import { MIME, fileResponse } from './files.ts'
import type { StreamHub } from './hub.ts'
import { IMPORT_FILE_MESSAGES, IMPORT_PREVIEW_BODY_LIMIT_BYTES, IMPORT_REGISTER_BODY_LIMIT_BYTES } from './import-files.ts'
import { LOGIN_BUSY_MESSAGE, LOGIN_RATE_LIMITED_MESSAGE, clientAddress } from './login-limit.ts'
import { unknownFieldProblems } from './messages.ts'
import { ASSISTANT_EVENT_TYPES, ASSISTANT_FORBIDDEN_MESSAGE, assistantMayCall } from './roles.ts'
import { DEVICE_ID_RE, type PrintService } from './print.ts'
import { registerPrintRoutes } from './print-api.ts'
import type { InstagramModule } from './instagram/index.ts'
import { INSTAGRAM_PUBLIC_PATHS, registerLiveRoutes } from './instagram/routes.ts'
import type { ReceiptLinkService } from './receipt-links.ts'
import type { TikTokLive } from './tiktok-live/live.ts'
import type { PasteService } from './tiktok-live/paste-service.ts'
import { registerTiktokRoutes } from './tiktok-live/routes.ts'
import type { Db } from './db/database.ts'
import { MESSAGES_LIMIT_DEFAULT, MESSAGES_LIMIT_MAX, Service } from './service.ts'
import { WEBHOOK_PATH, registerBillingRoutes } from './billing/api.ts'
import type { BillingService } from './billing/service.ts'
import { registerDepositRoutes } from './deposit/api.ts'
import type { DepositService } from './deposit/service.ts'
import { registerParcelRoutes } from './parcel/api.ts'
import type { ParcelBrief, ParcelService } from './parcel/service.ts'
import type { Actor, WriteOutcome, WriteResult } from './writer.ts'
import { CALLBACK_PATH, registerYoutubeRoutes } from './youtube/routes.ts'
import type { Sealer } from './youtube/seal.ts'
import type { YoutubeSystem } from './youtube/system.ts'
import { isSocialPath, registerSocialRoutes, socialPublicPaths } from './social/routes.ts'
import type { SocialLogin } from './social/service.ts'
import { registerAssistRoutes } from './assist/routes.ts'
import type { AssistService } from './assist/service.ts'

/** 요청 본문 상한 (AC-S04-34) */
export const BODY_LIMIT_BYTES = 64 * 1024
/**
 * 상품 목록 가져오기 본문 상한 (I2 AC-I2-51): 미리 보기 3MB(파일 2MB의 base64·붙여 넣은 글 200,000글자), 등록 6MB 남짓(2MB 파일에서 나온 품종의 최악 크기 —
 * import-files.ts IMPORT_REGISTER_BODY_LIMIT_BYTES). 미리 보기가 "n개 등록하기"를 보인 목록은 늘 등록 상한 안이다 (SA-I2-001·SA-I2-007)
 */
const IMPORT_PREVIEW_PATH = /^\/api\/broadcasts\/[^/]+\/import\/preview$/
const IMPORT_REGISTER_PATH = /^\/api\/broadcasts\/[^/]+\/import$/
const HISTORY_LIMIT_MAX = 500

export interface ApiDeps {
  readonly service: Service
  /** 정산 마무리 (I2 — 가게 설정·확인서·판매대장·포장·지난 구매·가져오기·백업·내려받기) */
  readonly closing: ClosingService
  /** 구매자 확인서 공유 링크 (N4b). 없으면 /api/days/:date/receipt-links 경로가 없다 */
  readonly receiptLinks?: ReceiptLinkService
  readonly auth: Auth
  readonly hub: StreamHub
  /** 출력 기록과 출력 기기 (I1). 없으면 /api/print 경로가 없다 */
  readonly print?: PrintService
  /** 인스타그램·플랫폼 공통 라이브 연결 (N2). 없으면 /api/platforms·/api/live·/api/instagram 경로가 없다 */
  readonly instagram?: InstagramModule
  /** 입금 확인 (N3). 없으면 /api/deposits 경로가 없고 날짜 범위 조회에 입금 연결이 없다 */
  readonly deposits?: DepositService
  /** 화면 앱 주소 (Origin 검사, 예: https://app.livejjim.kr) */
  readonly appOrigin: string
  /** 화면 설정 (방송자 조치 대기 시간 — 운영 5000, E2E 기동만 줄인다 / 시험 모드 신호 testPrinter — E2E 기동만 켠다, I1) */
  readonly clientConfig?: { readonly hostActionDelayMs: number; readonly testPrinter?: boolean }
  /** 요금 (N5). 없거나 꺼져 있으면 /api/billing/**는 404 */
  readonly billing?: BillingService
  /** E2E 기동만: 확인서 데이터 조회의 ?at=<UTC 밀리초> (AC-I2-15, ServerOptions.receiptAtParam) */
  readonly receiptAtParam?: boolean
  /** 유튜브 연동 (Y1, 설정이 없으면 null — 그 API는 503) */
  readonly youtube?: YoutubeSystem | null
  readonly sealer?: Sealer | null
  /** 믿는 앞단 프록시 수 (0~5, 기본 0 — X-Forwarded-For를 보지 않는다, AC-I3-66) */
  readonly trustedProxies?: number
  /** 틱톡 연결·붙여넣기 (N2b-2). instagram과 함께 준다 — 회차 연결 조회가 플랫폼마다 */
  readonly tiktok?: { readonly db: Db; readonly live: TikTokLive; readonly paste: PasteService }
  /** 택배 자동 접수 (T1). 없으면 /api/parcels 경로가 없고 정산 묶음·포장 모드에 parcel이 없다 */
  readonly parcels?: { readonly service: ParcelService; readonly db: Db }
  /** 간편 로그인 (L1). 없거나 켜진 공급자가 없으면 /api/auth/**는 404이고 client-config에 loginProviders가 없다 */
  readonly social?: SocialLogin | null
  /** AI 확인 필요 제안 (A1). 없으면 /api/assist/** 경로가 없다 */
  readonly assist?: AssistService
}

/** TCP 연결 주소 (@hono/node-server가 넘기는 요청 정보). 프로세스 안 요청(시험의 app.request)은 env로 넣을 수 있고, 없으면 null */
export function connectionAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } }; server?: { incoming?: { socket?: { remoteAddress?: unknown } } } } | undefined
  const address = env?.incoming?.socket?.remoteAddress ?? env?.server?.incoming?.socket?.remoteAddress
  return typeof address === 'string' && address !== '' ? address : null
}

export type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** 세션을 강제하지 않는 경로. 유튜브 돌아오는 주소는 세션 쿠키와 state로 판매자를 정하고, 없으면 화면으로 돌려보낸다(AC-Y1-02). 인스타그램 OAuth 돌아오는 주소는 state로만 처리한다(N2 AC-N2-61) */
const PUBLIC_PATHS = new Set(['POST /api/login', 'GET /api/health', 'HEAD /api/health', `GET ${CALLBACK_PATH}`, ...INSTAGRAM_PUBLIC_PATHS])

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
/** 입금 확인이 엔진에 쓰는 요청 번호 앞머리 (DP-6 — dep-<번호>-pay-<차례>·dep-<번호>-rev-<차례>) */
export const DEPOSIT_REQUEST_PREFIX = 'dep-'
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
      return apiError(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems, outcome.rejection.extra ?? {})
    case 'not_found':
      return notFound()
    case 'save_failed':
      return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    case 'empty':
      return apiError(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
  }
}

export function createApi(deps: ApiDeps): Hono<Env> {
  const { service, closing, auth, hub } = deps
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

  // 간편 로그인 (L1): 켜진 공급자가 없으면 /api/auth/** 전부 404, 꺼진·모르는 공급자의 돌아오는 주소도 404 (세션·Origin 검사보다 먼저)
  const social = deps.social !== undefined && deps.social !== null && deps.social.enabled.length > 0 ? deps.social : null
  const publicPaths = new Set([...PUBLIC_PATHS, ...socialPublicPaths(social)])
  api.use(async (c, next) => {
    if (!isSocialPath(c.req.path)) return next()
    if (social === null) return notFound()
    const callback = /^\/api\/auth\/([^/]+)\/callback$/.exec(c.req.path)
    if (callback !== null && !social.isEnabled(callback[1])) return notFound()
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
  // 세션 확인: 로그인·헬스체크 밖 전부. 보조자 계정은 허용 목록 밖이면 모두 403 — 처리기에 닿기 전에(아무것도 기록하지 않는다, AC-I3-61). 목록은 roles.ts(기본 거부)
  const checkSession = async (c: Context<Env>): Promise<Response | null> => {
    const session = await auth.session(getCookie(c, SESSION_COOKIE))
    if (session === null) return unauthorized()
    c.set('session', session)
    sessionChecked.add(c.req.raw)
    if (session.role === 'ASSISTANT' && !assistantMayCall(c.req.method, c.req.path, c.req.query('rehearsal'))) return assistantForbidden()
    return null
  }
  /** 세션을 이미 본 요청 (가져오기 두 경로 — 아래 세션 단계가 두 번 보지 않게) */
  const sessionChecked = new WeakSet<Request>()
  const isImportPath = (c: Context<Env>): boolean => c.req.method === 'POST' && (IMPORT_PREVIEW_PATH.test(c.req.path) || IMPORT_REGISTER_PATH.test(c.req.path))
  // 상품 목록 가져오기 두 경로(큰 본문 — 미리 보기 3MB·등록 6MB 남짓)는 세션을 본문 읽기 앞에서 본다 (RA-I2-010):
  // 로그인하지 않은 요청의 큰 본문을 받아 두지 않는다
  api.use(async (c, next) => {
    if (!isImportPath(c)) return next()
    const refused = await checkSession(c)
    if (refused !== null) return refused
    return next()
  })
  // 본문 상한: 64KB, 상품 목록 가져오기 미리 보기만 3MB·등록만 6MB 남짓 (I2, SA-I2-001·SA-I2-007) — 넘으면 할 일을 적은 쉬운 문장
  const smallBody = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.') })
  const previewBody = bodyLimit({ maxSize: IMPORT_PREVIEW_BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', IMPORT_FILE_MESSAGES.previewBodyTooLarge) })
  const registerBody = bodyLimit({ maxSize: IMPORT_REGISTER_BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', IMPORT_FILE_MESSAGES.registerBodyTooLarge) })
  api.use((c, next) => {
    if (c.req.method === 'POST' && IMPORT_PREVIEW_PATH.test(c.req.path)) return previewBody(c, next)
    if (c.req.method === 'POST' && IMPORT_REGISTER_PATH.test(c.req.path)) return registerBody(c, next)
    return smallBody(c, next)
  })
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

  // 세션 (로그인·헬스체크 밖 전부 — 가져오기 두 경로는 위에서 이미 봤다)
  api.use(async (c, next) => {
    if (publicPaths.has(`${c.req.method} ${c.req.path}`) || isWebhook(c)) return next()
    if (!sessionChecked.has(c.req.raw)) {
      const refused = await checkSession(c)
      // 로그인 화면의 간편 로그인 버튼 (L1): 공급자가 켜진 서버는 로그인 전 client-config에 켜진 공급자 이름만 답한다 (꺼진 서버는 지금처럼 401)
      if (refused !== null && refused.status === 401 && social !== null && c.req.method === 'GET' && c.req.path === '/api/client-config') return c.json({ loginProviders: [...social.enabled] })
      if (refused !== null) return refused
    }
    await next()
    const { refreshedCookie } = c.get('session')
    if (refreshedCookie !== null) c.res.headers.append('Set-Cookie', refreshedCookie)
  })

  const body = (c: Context<Env>) => c.get('body') ?? {}
  const actorOf = (c: Context<Env>): Actor => ({ kind: 'account', accountId: c.get('session').accountId })
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) && !id.startsWith(DEPOSIT_REQUEST_PREFIX) ? id : null
  }
  /** 묶음마다 택배 줄 (T1 — 택배 기능이 없으면 빈 맵) */
  const parcelBriefs = async (sellerId: string, date: string): Promise<Map<string, ParcelBrief | null>> => (deps.parcels === undefined ? new Map() : deps.parcels.service.briefs(sellerId, date))
  /** 실제 범위 조회에 붙이는 입금 연결 (리허설 범위는 빈 목록 — AC-N3-32) */
  const depositLinksOf = async (sellerId: string, date: string, rehearsal: boolean) =>
    deps.deposits === undefined || rehearsal ? [] : await deps.deposits.linksForDay(sellerId, date)
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

  // ── 가게 (I3 AC-I3-47 가게 이름 · I2 AC-I2-01 가게 설정) ──────────────────
  // 본문이 { name } 하나면 가게 이름만(시작 마법사·가게 이름 칸 — 답은 { shop: { name } }), 아니면 가게 설정 다섯 칸(답은 다섯 칸).
  // 가게 이름 상한은 가게 설정 규칙(shop.ts — 새 이름 1~30글자, 지금 이름 그대로면 길이를 다시 따지지 않음)이고 저장하면 가게 설정 알림(shop)을 보낸다
  api.put('/shop', async (c) => {
    const input = body(c)
    if (ownKeys(input).length === 1 && Object.hasOwn(input, 'name')) {
      const name = await closing.renameShop(sellerOf(c), own(input, 'name'))
      if (name === null) return apiError(400, 'INVALID_INPUT', SHOP_NAME_MESSAGE, [{ field: 'name', message: SHOP_NAME_MESSAGE }])
      return c.json({ shop: { name } })
    }
    const result = await closing.updateShop(sellerOf(c), input)
    if (!result.ok) return apiError(result.rejection.status, result.rejection.code, result.rejection.message, result.rejection.problems)
    return c.json({ shop: result.shop })
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
      // 켜진 간편 로그인 공급자 (L1 — 카카오·네이버·구글 순, 이름만). 하나도 없으면 항목이 없다(L1 전과 같은 응답)
      ...(social === null ? {} : { loginProviders: [...social.enabled] }),
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
    const extra = onlyKeys(input, ['requestId', 'date', 'title', 'rehearsal', 'saleMode'])
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

  // ── 확인 필요 목록 (O2 AC-O2-30, D-O2-14) ──────────────────────────────
  // 적지 않으면 실제 범위만, ?rehearsal=true면 리허설 범위만(D-081). ?broadcast=<ID>면 그 방송만 — 다른 판매자의·없는·리허설인지가 다른 방송은 404.
  // 쓰기(바로잡기·지우기·지금 상품)는 POST /api/events (host.resolveReview·host.dismissReview·product.focus)
  api.get('/reviews', async (c) => {
    const rehearsal = rehearsalOf(c)
    if (!rehearsal.ok) return rehearsal.response
    const broadcast = c.req.query('broadcast')
    if (broadcast !== undefined && (broadcast === '' || broadcast.length > 64)) return notFound()
    const view = await service.reviews(sellerOf(c), { rehearsal: rehearsal.value ?? false, ...(broadcast === undefined ? {} : { broadcast }) })
    return view === null ? notFound() : c.json(view)
  })

  // ── 옵션 방송 있음 (D-O4-13, AC-O4-38) ────────────────────────────────
  // 라벨 설정의 "품종 칸 끔" 안내용 가벼운 조회: 실제·리허설 방송 중 옵션 방송이 하나라도 있으면 참. 응답은 { exists } 하나뿐 —
  // 방송 ID·날짜·댓글·구매자 정보를 담지 않는다. 세션이 필요하고(앞의 세션 검사) 그 판매자 것만 센다.
  api.get('/option-broadcasts/exists', async (c) => {
    return c.json({ exists: await service.hasOptionBroadcasts(sellerOf(c)) })
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
    if (view === null) return notFound()
    const depositLinks = await depositLinksOf(sellerOf(c), date, rehearsal.value ?? false)
    // 실제 범위: 묶음마다 포장·배송 상태 (I2 AC-I2-33 — 리허설 범위에는 없다), 택배 줄 parcel (T1 AC-T1-52 — 없으면 null)
    if (rehearsal.value === true) return c.json({ ...view, depositLinks })
    const briefs = await parcelBriefs(sellerOf(c), date)
    const packing = (await closing.packingSummary(sellerOf(c), date)).map((item) => ({ ...item, parcel: briefs.get(item.buyer) ?? null }))
    return c.json({ ...view, packing, depositLinks })
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
    // 입금 연결은 정산 묶음이 바뀐 증분에만 담는다(그 범위 전체) — 입금 확인의 기록·되돌림은 늘 정산 기록을 바꾼다. 없으면 화면은 이전 값을 그대로 둔다
    const settlementsChanged = changes.settlements.length > 0 || changes.removed.settlements.length > 0
    return c.json(settlementsChanged ? { ...changes, depositLinks: await depositLinksOf(sellerOf(c), date, rehearsal.value ?? false) } : changes)
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

  // 가게 설정 (AC-I2-01) — 바꾸기(PUT /api/shop)는 위 "가게"에서 가게 이름만과 함께 받는다
  api.get('/shop', async (c) => c.json({ shop: await closing.shop(sellerOf(c)) }))

  // 확인서 (AC-I2-10·11): 데이터(JSON = 확인서 데이터 그대로)·PDF·PNG·전원 PDF
  api.get('/days/:date/receipt', async (c) => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return problemResponse(buyer.error)
    // E2E 기동만 ?at= (그 PNG를 만든 시각 — 응답 머리 X-Receipt-Created-At)으로 같은 확인서 데이터를 다시 얻는다. 운영 서버는 이 값을 보지 않는다
    const atText = deps.receiptAtParam === true ? c.req.query('at') : undefined
    if (atText !== undefined && !/^[0-9]{1,15}$/.test(atText)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'at', message: '만든 시각을 확인해 주세요.' }])
    const outcome = await closing.receipt(sellerOf(c), scope.date, scope.rehearsal, buyer.buyer, atText === undefined ? undefined : Number(atText))
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    c.header('X-Receipt-Created-At', String(outcome.value.createdAt))
    return c.json(outcome.value.receipt)
  })
  // 한 사람 JPG (N4b AC-N4b-01 — PNG와 같은 그림, 같은 인자·같은 오류 답)
  for (const kind of ['pdf', 'png', 'jpg'] as const) {
    api.get(`/days/:date/receipt.${kind}`, async (c) => {
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      const buyer = buyerParam(c.req.query('buyer'))
      if (!buyer.ok) return problemResponse(buyer.error)
      return fileOf(await closing.receiptFile(sellerOf(c), scope.date, scope.rehearsal, buyer.buyer, kind, c.req.raw.signal))
    })
  }
  api.get('/days/:date/receipts.pdf', async (c) => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope.response
    return fileOf(await closing.batchPdf(sellerOf(c), scope.date, scope.rehearsal, c.req.raw.signal))
  })

  // 전원 이미지 묶음 ZIP (N4b AC-N4b-02 — 리허설 범위도 된다)
  api.get('/days/:date/receipts.zip', async (c) => {
    const scope = scopeParams(c)
    if (!scope.ok) return scope.response
    return fileOf(await closing.batchJpgZip(sellerOf(c), scope.date, scope.rehearsal, c.req.raw.signal))
  })

  // ── 영수증 보내기 (N4b — harness/sprints/N4b/dev-notes.md "API") ─────────
  const links = deps.receiptLinks
  if (links !== undefined) {
    const linkOutcome = <T>(c: Context<Env>, outcome: Outcome<T>, body: (value: T) => Record<string, unknown>): Response => {
      if (outcome.kind === 'not_found') return notFound()
      if (outcome.kind === 'error') return problemResponse(outcome.error)
      return c.json(body(outcome.value))
    }
    // 구매자 줄 (AC-N4b-32): 품목 있는 묶음마다 이름·끝자리·상품 수·최종 금액·입금 상태(확인서 데이터 그대로), 일괄 순서. 실제 범위면 링크 상태도
    api.get('/days/:date/receipt-buyers', async (c) => {
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      const outcome = await closing.receiptBuyers(sellerOf(c), scope.date, scope.rehearsal)
      if (outcome.kind !== 'ok') return linkOutcome(c, outcome, () => ({}))
      const rows = outcome.value.rows
      const statuses = scope.rehearsal ? null : await links.statuses(sellerOf(c), scope.date, rows.map((row) => row.buyer))
      return c.json({ date: scope.date, rehearsal: scope.rehearsal, buyers: rows.map((row) => ({ ...row, link: statuses?.get(row.buyer) ?? null })) })
    })
    // 링크 목록 (AC-N4b-12): 리허설 범위는 빈 목록
    api.get('/days/:date/receipt-links', async (c) => {
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      return linkOutcome(c, await links.list(sellerOf(c), scope.date, scope.rehearsal), (list) => ({ date: scope.date, rehearsal: scope.rehearsal, links: list }))
    })
    // 링크 만들기 (AC-N4b-10): { requestId, buyer }
    api.post('/days/:date/receipt-links', async (c) => {
      const input = body(c)
      const requestId = requestIdOf(input)
      if (requestId === null) return invalidRequestId()
      const extra = onlyKeys(input, ['requestId', 'buyer'])
      if (extra !== null) return extra
      const buyer = buyerParam(typeof own(input, 'buyer') === 'string' ? (own(input, 'buyer') as string) : undefined)
      if (!buyer.ok) return problemResponse(buyer.error)
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      return linkOutcome(c, await links.create(sellerOf(c), c.get('session').accountId, scope.date, scope.rehearsal, requestId, buyer.buyer), (value) => ({ date: scope.date, ...value }))
    })
    // 링크 전부 만들기 (AC-N4b-11): { requestId }
    api.post('/days/:date/receipt-links/all', async (c) => {
      const input = body(c)
      const requestId = requestIdOf(input)
      if (requestId === null) return invalidRequestId()
      const extra = onlyKeys(input, ['requestId'])
      if (extra !== null) return extra
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      return linkOutcome(c, await links.createAll(sellerOf(c), c.get('session').accountId, scope.date, scope.rehearsal, requestId), (value) => ({ date: scope.date, ...value }))
    })
    // 링크 끊기 (AC-N4b-13): { requestId, buyer }
    api.post('/days/:date/receipt-links/revoke', async (c) => {
      const input = body(c)
      const requestId = requestIdOf(input)
      if (requestId === null) return invalidRequestId()
      const extra = onlyKeys(input, ['requestId', 'buyer'])
      if (extra !== null) return extra
      const buyer = buyerParam(typeof own(input, 'buyer') === 'string' ? (own(input, 'buyer') as string) : undefined)
      if (!buyer.ok) return problemResponse(buyer.error)
      const scope = scopeParams(c)
      if (!scope.ok) return scope.response
      return linkOutcome(c, await links.revoke(sellerOf(c), c.get('session').accountId, scope.date, scope.rehearsal, requestId, buyer.buyer), (value) => ({ date: scope.date, ...value }))
    })
  }

  // 판매대장 (AC-I2-20): ?from=&to=&b=<방송 ID>&b=… (b가 없으면 기간 안 모든 실제 방송)
  api.get('/ledger.xlsx', async (c) => {
    const picked = c.req.queries('b')
    return fileOf(await closing.ledger(sellerOf(c), c.req.query('from'), c.req.query('to'), picked === undefined ? null : picked, c.req.raw.signal))
  })

  // 포장·배송 (AC-I2-30~32)
  api.get('/days/:date/packing', async (c) => {
    const scope = realScope(c)
    if (!scope.ok) return scope.response
    const list = await closing.packingList(sellerOf(c), scope.date)
    if (list === null) return notFound()
    // 묶음마다 택배 줄 parcel (T1 AC-T1-52 — 조회 낱말·송장번호·마지막 확인 시각, 없으면 null)
    const briefs = await parcelBriefs(sellerOf(c), scope.date)
    return c.json({ ...list, entries: list.entries.map((entry) => ({ ...entry, parcel: briefs.get(entry.buyer) ?? null })) })
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
    const outcome = await closing.importPreview(sellerOf(c), c.req.param('id'), body(c), c.req.raw.signal)
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
  api.get('/export/ledger.xlsx', async (c) => fileOf(await closing.exportLedger(sellerOf(c), c.req.raw.signal)))

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
  if (deps.assist !== undefined) registerAssistRoutes(api, deps.assist)
  if (social !== null) registerSocialRoutes(api, social, (c) => clientAddress(connectionAddress(c), c.req.header('x-forwarded-for'), deps.trustedProxies ?? 0))

  // ── 출력 기록 (I1, LABEL_RULES L-11) ──────────────────────────────────
  if (deps.print !== undefined) registerPrintRoutes(api, deps.print)

  // ── 플랫폼 공통 라이브 연결·인스타그램 (N2) ────────────────────────────
  // 플랫폼 능력 조회의 YOUTUBE.ready = 유튜브 연동 설정(Y1)이 있는지. 유튜브 잇기 자체는 /api/youtube 경로(Y1)가 맡는다
  // 틱톡(N2b-2): 설정·연결 보기·다시 연결·붙여넣기. 잇기·끊기는 플랫폼 공통 경로(/broadcasts/:id/live/link·unlink, platform TIKTOK)
  if (deps.instagram !== undefined && deps.tiktok !== undefined) {
    registerLiveRoutes(api, deps.instagram, auth, { db: deps.tiktok.db, tiktok: deps.tiktok.live, youtubeReady: deps.youtube !== undefined && deps.youtube !== null })
    registerTiktokRoutes(api, deps.tiktok.live, deps.tiktok.paste)
  }
  // ── 요금 (N5, BILLING_RULES) — 켜져 있을 때만 ───────────────────────────
  if (billing !== null) registerBillingRoutes(api, billing)

  // ── 입금 확인 (N3, DEPOSIT_RULES) ─────────────────────────────────────
  if (deps.deposits !== undefined) registerDepositRoutes(api, deps.deposits)

  // ── 택배 자동 접수 (T1, PARCEL_RULES) — 판매자만(보조자는 roles.ts 허용 목록 밖이라 403) ──
  if (deps.parcels !== undefined) registerParcelRoutes(api, deps.parcels.service, deps.parcels.db)

  // 시험용 시청자 채팅 (입금 확인 시험 모드에서만 — 운영 기동에는 경로 자체가 없다, 404. SA-N3-03·D-N3-12).
  // 실제 방송에도 유튜브 구매자를 만들 수 있게(기억한 입금자명 흐름 E2E, AC-N3-42·46) 수집 함수(ingestChat, 조치자 수집기)를 그대로 부른다.
  // 입력 { b, id, ch, nick, text } — 같은 (방송, 메시지 ID)는 한 번만 기록한다. 리허설 방송이면 그 리허설 범위로 간다
  if (deps.deposits?.testMode === true) {
    api.post('/deposits/test/chat', async (c) => {
      const input = c.get('body') ?? {}
      const extra = onlyKeys(input, ['b', 'id', 'ch', 'nick', 'text'])
      if (extra !== null) return extra
      const outcome = await service.ingestChat(sellerOf(c), input)
      switch (outcome.status) {
        case 'recorded':
          return c.json({ recorded: true, date: outcome.date, seq: outcome.seq, changed: outcome.changed })
        case 'duplicate':
          return c.json({ recorded: false })
        case 'rejected':
          return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', outcome.problems)
        case 'not_found':
          return notFound()
        case 'save_failed':
          return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
      }
    })
  }

  api.notFound(() => notFound())
  return api
}
