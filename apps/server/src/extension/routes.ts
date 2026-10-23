// 크롬 확장 경로 (X1 YT-10). 계약은 harness/sprints/X1/dev-notes.md "dev-server > 확장(device)·화면(web)에게"에 적었다.
// 1) 판매자 화면 경로 /api/extension/** — 세션이 필요하고(보조자는 허용 목록 밖이라 403), 상태를 바꾸는 요청은 api.ts의 Origin·JSON 검사를 거친다.
//    POST /api/extension/code · POST /api/extension/renew · POST /api/extension/disconnect · GET /api/extension
// 2) 확장 경로 /ext/** — 쿠키·Origin을 보지 않고 Authorization: Bearer <확장 토큰>으로만 받는다(연결하기만 토큰 없이 코드로).
//    확장 토큰은 /api 경로(세션 쿠키)를 부를 수 없다. 본문은 JSON 객체만·64KB 이하, 모르는 필드는 거절, 모든 응답 no-store.
//    POST /ext/connect { code } → { token } · GET /ext/broadcasts?v= · POST /ext/bind { v, broadcast } · POST /ext/chats { v, messages[] } · POST /ext/status
// 받은 값(토큰·닉네임·본문)은 응답·로그에 되돌려 보내지 않는다.
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError, JSON_CONTENT_TYPE, type FieldProblem } from '../errors.ts'
import { IpLimiter, clientAddress, ipKey } from '../login-limit.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { Clock } from '../time.ts'
import { BATCH_MAX, EXTENSION_MESSAGES, type ExtensionCaller, type ExtensionService, type IncomingChat } from './service.ts'

type ApiEnv = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
/** 유튜브 메시지 ID (공식 API·화면 모두 영문·숫자·기호 몇 가지) */
const MESSAGE_ID_RE = /^[A-Za-z0-9_\-.%=+/:]{1,256}$/
/** 유튜브 채널 ID (UC…) */
const CHANNEL_RE = /^[A-Za-z0-9_-]{1,64}$/
const NICK_MAX = 200
const TEXT_MAX = 2000
const COUNT_MAX = 1_000_000_000

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
  const extra = ownKeys(value).filter((key) => !allowed.includes(key))
  return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
}
const invalid = (problems: FieldProblem[]) => apiError(400, 'INVALID_INPUT', '보낸 내용을 확인해 주세요.', problems)
const disconnected = () => apiError(401, 'EXT_DISCONNECTED', EXTENSION_MESSAGES.DISCONNECTED)
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

/** 판매자 화면 경로 (/api/extension) */
export function registerExtensionRoutes(api: Hono<ApiEnv>, extension: ExtensionService): void {
  const body = (c: Context<ApiEnv>) => c.get('body') ?? {}
  const session = (c: Context<ApiEnv>) => c.get('session')

  api.get('/extension', async (c) => c.json({ extension: await extension.view(session(c).sellerId) }))
  api.post('/extension/code', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json(await extension.issueCode(session(c).sellerId, session(c).accountId))
  })
  api.post('/extension/renew', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json(await extension.renew(session(c).sellerId, session(c).accountId))
  })
  api.post('/extension/disconnect', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    await extension.disconnect(session(c).sellerId)
    return c.json({ extension: await extension.view(session(c).sellerId) })
  })
}

export interface ExtensionAppDeps {
  readonly extension: ExtensionService
  readonly clock: Clock
  readonly trustedProxies: number
  /** 연결 주소 읽기 (api.ts connectionAddress) */
  readonly address: (c: Context) => string | null
}

type ExtEnv = { Variables: { body: Record<string, unknown> | null; caller: ExtensionCaller } }

/** 확장 경로 (/ext) */
export function createExtensionApp(deps: ExtensionAppDeps): Hono<ExtEnv> {
  const { extension } = deps
  const app = new Hono<ExtEnv>()
  // 코드 넣기 시도 (주소마다 10분에 20번, 서버 전체 10분에 600번 — 8자리 코드를 맞혀 보지 못하게)
  const codeLimiter = new IpLimiter(deps.clock)
  const allCodes = new IpLimiter(deps.clock, { ipMaxAttempts: 600 })

  app.use(async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
  })
  app.use(bodyLimit({ maxSize: 64 * 1024, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.') }))
  app.use(async (c, next) => {
    c.set('body', null)
    if (c.req.method !== 'POST') return next()
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== JSON_CONTENT_TYPE) return apiError(415, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.')
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
  // 토큰 (연결하기 밖 전부) + 토큰마다 초당 요청 수 (메시지 수는 채팅 받기가 센다)
  app.use(async (c, next) => {
    if (c.req.method === 'POST' && c.req.path === '/ext/connect') return next()
    const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(c.req.header('authorization') ?? '')
    const caller = match === null ? null : await extension.authenticate(match[1] as string)
    if (caller === null) return disconnected()
    c.set('caller', caller)
    const messages = c.req.method === 'POST' && c.req.path === '/ext/chats' ? messageCount(c.get('body')) : 0
    const admitted = extension.admit(caller.tokenId, messages)
    if (!admitted.ok) return apiError(429, 'EXT_RATE_LIMITED', EXTENSION_MESSAGES.RATE_LIMITED, [], {}, { 'Retry-After': String(Math.ceil(admitted.retryAfterMs / 1000)) })
    return next()
  })

  const body = (c: Context<ExtEnv>) => c.get('body') ?? {}
  const caller = (c: Context<ExtEnv>) => c.get('caller')

  app.post('/connect', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['code'])
    if (extra !== null) return extra
    const code = own(input, 'code')
    if (typeof code !== 'string') return invalid([{ field: 'code', message: '연결 코드 8자리를 적어 주세요.' }])
    const address = clientAddress(deps.address(c), c.req.header('x-forwarded-for'), deps.trustedProxies)
    if (!codeLimiter.take(address === null ? null : ipKey(address)) || !allCodes.take('*')) return apiError(429, 'EXT_CODE_LIMITED', EXTENSION_MESSAGES.CODE_LIMITED)
    const token = await extension.exchange(code.replace(/[\s-]/g, ''))
    if (token === null) return apiError(400, 'EXT_CODE_INVALID', EXTENSION_MESSAGES.CODE_INVALID)
    return c.json({ token })
  })

  app.get('/broadcasts', async (c) => {
    const v = c.req.query('v') ?? ''
    if (!VIDEO_RE.test(v)) return invalid([{ field: 'v', message: '유튜브 영상 번호가 올바르지 않아요.' }])
    return c.json(await extension.candidates(caller(c), v))
  })

  app.post('/bind', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['v', 'broadcast'])
    if (extra !== null) return extra
    const v = own(input, 'v')
    const b = own(input, 'broadcast')
    const problems: FieldProblem[] = []
    if (typeof v !== 'string' || !VIDEO_RE.test(v)) problems.push({ field: 'v', message: '유튜브 영상 번호가 올바르지 않아요.' })
    if (typeof b !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b)) problems.push({ field: 'broadcast', message: '회차를 골라 주세요.' })
    if (problems.length > 0) return invalid(problems)
    const outcome = await extension.bind(caller(c), v as string, b as string)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'rejected') return apiError(409, 'EXT_BIND_REJECTED', EXTENSION_MESSAGES[outcome.reason], [], { reason: outcome.reason })
    return c.json({ broadcast: outcome.broadcast })
  })

  app.post('/chats', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['v', 'messages'])
    if (extra !== null) return extra
    const parsed = parseChats(input)
    if (!parsed.ok) return parsed.response
    const outcome = await extension.ingest(caller(c), parsed.v, parsed.chats)
    if (outcome.kind === 'not_bound') return apiError(409, 'EXT_NOT_BOUND', EXTENSION_MESSAGES.NOT_BOUND)
    if (outcome.kind === 'ended') return apiError(409, 'EXT_ENDED', EXTENSION_MESSAGES.ENDED)
    if (outcome.kind === 'save_failed') return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    return c.json({ recorded: outcome.recorded, skipped: outcome.skipped, broadcast: outcome.broadcast })
  })

  app.post('/status', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['v', 'hidden', 'read', 'unread', 'dropped'])
    if (extra !== null) return extra
    const v = own(input, 'v') ?? null
    const hidden = own(input, 'hidden')
    const counts = ['read', 'unread', 'dropped'].map((key) => own(input, key) ?? 0)
    const problems: FieldProblem[] = []
    if (v !== null && (typeof v !== 'string' || !VIDEO_RE.test(v))) problems.push({ field: 'v', message: '유튜브 영상 번호가 올바르지 않아요.' })
    if (typeof hidden !== 'boolean') problems.push({ field: 'hidden', message: '채팅 창이 보이는지 알려 주세요.' })
    ;['read', 'unread', 'dropped'].forEach((key, index) => {
      const value = counts[index]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > COUNT_MAX) problems.push({ field: key, message: '수는 0 이상의 정수로 보내 주세요.' })
    })
    if (problems.length > 0) return invalid(problems)
    const view = await extension.status(caller(c), { videoId: v as string | null, hidden: hidden as boolean, read: counts[0] as number, unread: counts[1] as number, dropped: counts[2] as number })
    return c.json({ state: view.state, message: view.message })
  })

  app.notFound(() => notFound())
  return app
}

/** 메시지 수 (속도 제한용 — 모양 검사는 처리기가 한다) */
function messageCount(body: Record<string, unknown> | null): number {
  const messages = body === null ? undefined : own(body, 'messages')
  return Array.isArray(messages) ? messages.length : 0
}

function parseChats(input: Record<string, unknown>): { ok: true; v: string; chats: IncomingChat[] } | { ok: false; response: Response } {
  const v = own(input, 'v')
  const messages = own(input, 'messages')
  if (typeof v !== 'string' || !VIDEO_RE.test(v)) return { ok: false, response: invalid([{ field: 'v', message: '유튜브 영상 번호가 올바르지 않아요.' }]) }
  if (!Array.isArray(messages)) return { ok: false, response: invalid([{ field: 'messages', message: '채팅 목록을 보내 주세요.' }]) }
  if (messages.length > BATCH_MAX) return { ok: false, response: invalid([{ field: 'messages', message: `한 번에 ${String(BATCH_MAX)}개까지 보낼 수 있어요.` }]) }
  const chats: IncomingChat[] = []
  for (const [index, item] of messages.entries()) {
    const field = `messages.${String(index)}`
    if (!isPlainObject(item)) return { ok: false, response: invalid([{ field, message: '채팅 하나의 모양이 올바르지 않아요.' }]) }
    const extra = ownKeys(item).filter((key) => !['id', 'ch', 'nick', 'text', 'at'].includes(key))
    if (extra.length > 0) return { ok: false, response: apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const id = own(item, 'id')
    const ch = own(item, 'ch')
    const nick = own(item, 'nick')
    const text = own(item, 'text')
    const at = own(item, 'at')
    if (
      typeof id !== 'string' ||
      !MESSAGE_ID_RE.test(id) ||
      typeof ch !== 'string' ||
      !CHANNEL_RE.test(ch) ||
      typeof nick !== 'string' ||
      Array.from(nick).length > NICK_MAX ||
      typeof text !== 'string' ||
      Array.from(text).length > TEXT_MAX ||
      typeof at !== 'number' ||
      !Number.isSafeInteger(at) ||
      at < 0
    ) {
      return { ok: false, response: invalid([{ field, message: '채팅 하나의 모양이 올바르지 않아요.' }]) }
    }
    chats.push({ id, ch, nick, text, at })
  }
  return { ok: true, v, chats }
}
