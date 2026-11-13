// HTTP 앱 (AC-S00-40, AC-S00-41, AC-S04-40~60). 포트를 열지 않는다: 기동은 main.ts, 노드 HTTP 연결은 node-server.ts가 맡는다.
// 테스트는 app.request(...)로 프로세스 안에서 요청한다. /api는 서버(createServer)가 DB·서비스를 넘길 때만 붙는다.
import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createApi, type ApiDeps } from './api.ts'
import { JSON_CONTENT_TYPE, errorResponse } from './errors.ts'
import { errorKind, formatLog } from './log.ts'
import { isServerPath, type WebServer } from './web.ts'
import { takesTraffic, type SlotView } from './slot.ts'

export type ErrorLogger = (error: unknown) => void

export interface AppOptions {
  /** 처리 중 예상하지 못한 오류를 기록한다. 응답에는 오류 내용이 들어가지 않는다. 기본값: 표준 오류 출력 */
  readonly logError?: ErrorLogger
  /** /api 경로 (S04). 없으면 헬스체크만 있다 */
  readonly api?: ApiDeps
  /** 웹훅 받는 경로 (/webhooks — 로그인·Origin 검사 밖, 서명으로만 받는다, N2) */
  readonly webhooks?: Hono
  /** 앱 주소가 https면 HSTS를 붙인다 (AC-I3-71) */
  readonly https?: boolean
  /** 화면 빌드를 같은 출처로 낸다 (LIVEJJIM_WEB_DIR, AC-I3-70). 없으면 화면 없음 */
  readonly web?: WebServer | null
  /** 준비 확인 /health/ready: DB가 2초 안에 답하는지 (AC-I3-80). 없으면 그 경로 없음 */
  readonly ready?: () => Promise<boolean>
  /**
   * 두 자리 교대 (D-RETRO-35~37, slot.ts): 주면 /health에 자리 이름·판(커밋)·상태를 싣고, 앞단이 "운영 자리인가"를 묻는 /health/active를 연다.
   * 없으면 /health는 `{"status":"ok"}` 그대로이고 /health/active는 없다(404)
   */
  readonly slot?: () => SlotView
  /** 운영 상태 /ops/status (AC-I3-81): 토큰(없으면 404)과 합친 숫자 */
  readonly ops?: { readonly token: string | null; readonly status: () => Promise<Record<string, unknown>> }
  /** 크롬 확장 경로 (/ext — 로그인·Origin 검사 밖, 확장 토큰으로만 받는다, X1) */
  readonly extension?: Hono
  /** 휴대폰 알림 받는 입구 `POST /api/inbox/messages` (SMS3 — 로그인·Origin 검사 밖, 받기 토큰으로만. /api 경로보다 먼저 붙는다) */
  readonly inbox?: (app: Hono) => void
  /** 구매자 확인서 링크 화면 `/r/<토큰>` (N4b — 로그인·Origin 검사 밖, 화면 문서보다 먼저) */
  readonly receiptPage?: (app: Hono) => void
  /** 화면 일꾼 입구 `POST /internal/screen/register` (D-SCR-01 — 로그인·Origin 검사 밖, 일꾼 토큰으로만) */
  readonly screen?: (app: Hono) => void
  /** 앱 화면 새 버전 나눠 주기 `/app-updates/*` (D-OTA-01 — 로그인·Origin 검사 밖, 화면 문서보다 먼저) */
  readonly appUpdates?: (app: Hono) => void
}

/** 모든 응답의 보안 머리글 (AC-I3-71) */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}
export const HSTS_HEADER = 'max-age=31536000'

/** 운영 토큰 일정 시간 비교 (길이도 드러내지 않게 해시를 견준다) */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? '')
  const given = createHash('sha256').update(match?.[1] ?? '', 'utf8').digest()
  const expected = createHash('sha256').update(token, 'utf8').digest()
  return timingSafeEqual(given, expected) && match !== null
}

function jsonNoStore(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })
}

/** 응답에 머리글을 붙인다 (머리글을 바꿀 수 없는 응답이면 복사해서) */
function withHeaders(c: Context, headers: Readonly<Record<string, string>>): void {
  try {
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value)
  } catch {
    const copy = new Response(c.res.body, c.res)
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value)
    c.res = copy
  }
}

/**
 * 기본 오류 기록: 오류 종류 이름만 표준 오류 출력에 남긴다 (D-073, AC-S04-34).
 * 오류 메시지·스택에는 요청 값·DB 질의 인자(전화번호 키·메모·닉네임 등)가 들어 있을 수 있어 남기지 않는다.
 */
export const defaultLogError: ErrorLogger = (error) => {
  console.error(formatLog({ level: 'error', code: 'REQUEST_FAILED', errorKind: errorKind(error) }))
}

/** 기록하다 실패해도 응답은 나가야 한다 */
export function safeLogger(log: ErrorLogger): ErrorLogger {
  return (error) => {
    try {
      log(error)
    } catch {
      // 기록 실패는 무시한다
    }
  }
}

/** 경로마다 허용하는 메서드. HEAD는 GET 처리기가 받는다(본문 없이). */
const HEALTH_ALLOW = 'GET, HEAD'

export function createApp(options: AppOptions = {}): Hono {
  const logError = safeLogger(options.logError ?? defaultLogError)
  const app = new Hono()
  const securityHeaders = options.https === true ? { ...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS_HEADER } : SECURITY_HEADERS

  // 모든 응답(화면·API·헬스·오류)에 보안 머리글 (AC-I3-71)
  app.use(async (c, next) => {
    await next()
    withHeaders(c, securityHeaders)
  })

  // Hono의 onError는 Error 인스턴스만 받는다. 처리기가 Error가 아닌 값을 던져도 JSON 500으로 끝나게 한다.
  app.use(async (_c, next) => {
    try {
      await next()
    } catch (thrown) {
      logError(thrown)
      return errorResponse(500)
    }
    return undefined
  })

  // 헬스체크: DB·외부 서비스·비밀값을 보지 않는다 (D-025)
  // 두 자리 교대(D-RETRO-35): 자리 이름·판·상태를 더 싣는다 — 대기 자리도 200이다(프로세스가 살아 있는지만 답한다)
  const slot = options.slot
  app.get('/health', (c) => (slot === undefined ? c.json({ status: 'ok' }) : jsonNoStore({ status: 'ok', ...slot() }, 200)))
  app.all('/health', () => errorResponse(405, { Allow: HEALTH_ALLOW }))

  // 앞단(Caddy)의 건강 확인 (D-RETRO-36): 운영 자리(와 뒤 작업만 넘기는 중인 자리)만 200. 대기·내리는 중은 503이라 앞단이 그 자리로 보내지 않는다. DB·비밀값을 보지 않는다
  if (slot !== undefined) {
    app.get('/health/active', () => {
      const { mode } = slot()
      return jsonNoStore({ status: mode }, takesTraffic(mode) ? 200 : 503)
    })
    app.all('/health/active', () => errorResponse(405, { Allow: HEALTH_ALLOW }))
  }

  // 준비 확인 (AC-I3-80): DB에 가벼운 질의가 2초 안에 되면 200, 아니면 503 — 이유·오류 문장 없음. 세션·Origin 필요 없음
  const ready = options.ready
  if (ready !== undefined) {
    app.get('/health/ready', async () => ((await ready()) ? jsonNoStore({ status: 'ready' }, 200) : jsonNoStore({ status: 'not_ready' }, 503)))
    app.all('/health/ready', () => errorResponse(405, { Allow: HEALTH_ALLOW }))
  }

  // 운영 상태 (AC-I3-81): 토큰 설정이 없으면 일반 404와 같다. 있으면 Bearer 토큰이 같을 때만 — 다르거나 없으면 같은 401(힌트 없음)
  const ops = options.ops
  if (ops !== undefined) {
    app.get('/ops/status', async (c) => {
      if (ops.token === null) return errorResponse(404)
      if (!bearerMatches(c.req.header('authorization'), ops.token)) return jsonNoStore({ error: { code: 'UNAUTHORIZED', message: '운영 토큰이 필요해요.' } }, 401)
      return jsonNoStore(await ops.status(), 200)
    })
    app.all('/ops/status', () => (ops.token === null ? errorResponse(404) : errorResponse(405, { Allow: HEALTH_ALLOW })))
  }

  options.inbox?.(app)
  options.screen?.(app)
  options.appUpdates?.(app)
  if (options.api !== undefined) app.route('/api', createApi(options.api))
  if (options.webhooks !== undefined) app.route('/webhooks', options.webhooks)
  if (options.extension !== undefined) app.route('/ext', options.extension)
  // 구매자 확인서 링크 (N4b AC-N4b-25): /r·/r/*는 화면 문서(index.html) 대신 링크 처리로 간다
  options.receiptPage?.(app)

  // 화면 (AC-I3-70): /api·/health·/ops 밖의 GET·HEAD는 화면 빌드에서, 그 밖의 메서드는 405
  const web = options.web ?? null
  if (web !== null) {
    app.on(['GET', 'HEAD'], '*', (c) => (isServerPath(c.req.path) ? errorResponse(404) : web.serve(c)))
    app.all('*', (c) => (isServerPath(c.req.path) ? errorResponse(404) : errorResponse(405, { Allow: HEALTH_ALLOW })))
  }

  app.notFound(() => errorResponse(404))

  app.onError((error) => {
    // 요청 쪽 문제(4xx)는 상태만 살리고, 프레임워크가 붙인 메시지는 버린다
    if (error instanceof HTTPException && error.status >= 400 && error.status < 500) return errorResponse(error.status)
    logError(error)
    return errorResponse(error instanceof HTTPException ? error.status : 500)
  })

  return app
}
