// 크롬 확장 경로 (X1 YT-10). 계약은 harness/sprints/X1/dev-notes.md "dev-server > 확장(device)·화면(web)에게"에 적었다.
// 1) 판매자 화면 경로 /api/extension/** — 세션이 필요하고(보조자는 허용 목록 밖이라 403), 상태를 바꾸는 요청은 api.ts의 Origin·JSON 검사를 거친다.
//    POST /api/extension/code · POST /api/extension/renew · POST /api/extension/disconnect · GET /api/extension
// 2) 확장 경로 /ext/** — 쿠키·Origin을 보지 않고 Authorization: Bearer <확장 토큰>으로만 받는다(연결하기만 토큰 없이 코드로).
//    확장 토큰은 /api 경로(세션 쿠키)를 부를 수 없다. 본문은 JSON 객체만·64KB 이하, 모르는 필드는 거절, 모든 응답 no-store.
//    POST /ext/connect { code } → { token } · GET /ext/broadcasts?v= · POST /ext/bind { v, broadcast } · POST /ext/chats { v, messages[] } · POST /ext/status
//    감사 올리기(X1 AC11~AC17): POST /ext/thanks/take { v, meIsOwner, owner } · POST /ext/thanks/result { ids, result }
//    판매자 화면: POST /api/extension/thanks { enabled, agreed } · POST /api/extension/thanks/resume { broadcast }
//    틱톡 읽기(TTX, D-TTX-01~14 — 유튜브 /chats와 따로): GET /ext/tiktok · POST /ext/tiktok/chats { pageId, items[] } · POST /ext/tiktok/status { screen, hidden, read, unread }
//    속도 제한은 유튜브와 따로 센다(토큰마다 초당 5요청·분당 600댓글). 계약은 harness/sprints/TTX/dev-notes.md "dev-server".
// 받은 값(토큰·닉네임·본문)은 응답·로그에 되돌려 보내지 않는다.
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError, JSON_CONTENT_TYPE, type FieldProblem } from '../errors.ts'
import { IpLimiter, clientAddress, ipKey } from '../login-limit.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { Clock } from '../time.ts'
import { activeToken } from './store.ts'
import { EXT_TIKTOK_BATCH_MAX, EXT_TIKTOK_COUNT_MAX, EXT_TIKTOK_MESSAGES, EXT_TIKTOK_SCREENS, type ExtTiktokInfo, type ExtTiktokScreen, type TikTokExtension } from '../tiktok-live/extension.ts'
import { BATCH_MAX, EXTENSION_MESSAGES, type ExtensionCaller, type ExtensionService, type IncomingChat } from './service.ts'
import { EXT_THANKS_MESSAGES, type ThanksResult } from './thanks.ts'

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

/** 서버 전체 코드 넣기 한도 (10분, D-QS1-06 (2) — 600 → 3,000) */
export const EXT_CODE_GLOBAL_MAX = 3000

/**
 * 판매자 화면 경로 (/api/extension). `address`는 요청의 주소 읽기(api.ts — 로그인 IP 한도와 같은 규칙)다.
 * 코드를 만들거나 다시 만들면 그 주소를 판매자의 믿는 주소로 10분 기억한다(D-QS1-06 (3)). 주소를 모르면 기억하지 않는다
 */
export function registerExtensionRoutes(api: Hono<ApiEnv>, extension: ExtensionService, address: (c: Context) => string | null = () => null): void {
  const body = (c: Context<ApiEnv>) => c.get('body') ?? {}
  const session = (c: Context<ApiEnv>) => c.get('session')
  const trust = (c: Context<ApiEnv>) => {
    const at = address(c)
    extension.trustedAddresses.remember(session(c).sellerId, at === null ? null : ipKey(at))
  }

  api.get('/extension', async (c) => c.json({ extension: await extension.view(session(c).sellerId) }))
  api.post('/extension/code', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const issued = await extension.issueCode(session(c).sellerId, session(c).accountId)
    trust(c)
    return c.json(issued)
  })
  api.post('/extension/renew', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const issued = await extension.renew(session(c).sellerId, session(c).accountId)
    trust(c)
    return c.json(issued)
  })
  api.post('/extension/disconnect', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    await extension.disconnect(session(c).sellerId)
    return c.json({ extension: await extension.view(session(c).sellerId) })
  })
  // 확장으로 감사 채팅 올리기 스위치 (AC11): 켜기는 설명 창의 "켤게요"(agreed: true)와 함께만
  api.post('/extension/thanks', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['enabled', 'agreed'])
    if (extra !== null) return extra
    const enabled = own(input, 'enabled')
    const agreed = own(input, 'agreed')
    if (typeof enabled !== 'boolean') return invalid([{ field: 'enabled', message: '켤지 끌지 골라 주세요.' }])
    if (agreed !== undefined && typeof agreed !== 'boolean') return invalid([{ field: 'agreed', message: '설명을 읽었는지 알려 주세요.' }])
    if (enabled && agreed !== true) return invalid([{ field: 'agreed', message: EXT_THANKS_MESSAGES.NOT_AGREED }])
    await extension.thanks.setEnabled(session(c).sellerId, session(c).accountId, enabled)
    return c.json({ extension: await extension.view(session(c).sellerId) })
  })
  // "다시 켜기" (AC17): 그 회차의 확장 게시 멈춤을 푼다
  api.post('/extension/thanks/resume', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['broadcast'])
    if (extra !== null) return extra
    const b = own(input, 'broadcast')
    if (typeof b !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b)) return invalid([{ field: 'broadcast', message: '회차를 골라 주세요.' }])
    if (!(await extension.thanks.resume(session(c).sellerId, b))) return notFound()
    return c.json({ extension: await extension.view(session(c).sellerId) })
  })
}

export interface ExtensionAppDeps {
  readonly extension: ExtensionService
  readonly clock: Clock
  readonly trustedProxies: number
  /** 연결 주소 읽기 (api.ts connectionAddress) */
  readonly address: (c: Context) => string | null
  /** 틱톡 확장 읽기 (TTX). 없으면 /ext/tiktok 경로가 없다(404) */
  readonly tiktok?: TikTokExtension
}

/** 틱톡 묶음 본문 상한 — 50개 × 500자(이모지 4바이트) + 키를 담는다. 그 밖의 확장 요청은 64KB 그대로 */
export const EXT_TIKTOK_BODY_MAX = 256 * 1024
/** 틱톡 묶음 항목이 객체일 때 쓸 수 있는 키 (owner·postedAt은 받아도 쓰지 않는다 — D-TTX-06·14) */
const TIKTOK_ITEM_KEYS = ['commentId', 'userId', 'uniqueId', 'nickname', 'text', 'owner', 'postedAt']
const TIKTOK_PATH = /^\/ext\/tiktok(?:\/|$)/

type ExtEnv = { Variables: { body: Record<string, unknown> | null; caller: ExtensionCaller } }

/** 확장 경로 (/ext) */
export function createExtensionApp(deps: ExtensionAppDeps): Hono<ExtEnv> {
  const { extension } = deps
  const app = new Hono<ExtEnv>()
  // 코드 넣기 시도 (주소마다 10분에 20번, 서버 전체 10분에 3,000번 — 8자리 코드를 맞혀 보지 못하게).
  // 판매자가 코드를 만든 주소(믿는 주소)는 서버 전체 한도를 세지도 막지도 않는다 — 주소마다 20번은 그대로 (D-QS1-06)
  const codeLimiter = new IpLimiter(deps.clock)
  const allCodes = new IpLimiter(deps.clock, { ipMaxAttempts: EXT_CODE_GLOBAL_MAX })

  app.use(async (c, next) => {
    await next()
    c.res.headers.set('Cache-Control', 'no-store')
  })
  const tooLarge = () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.')
  const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge })
  const tiktokBody = bodyLimit({ maxSize: EXT_TIKTOK_BODY_MAX, onError: tooLarge })
  app.use(async (c, next) => (c.req.path === '/ext/tiktok/chats' ? tiktokBody(c, next) : smallBody(c, next)))
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
    // 틱톡 경로는 따로 센다 (D-TTX-08 — 유튜브 /chats와 서로 밀어내지 않는다)
    const lane = TIKTOK_PATH.test(c.req.path) ? 'tiktok' : 'youtube'
    const messages = c.req.method !== 'POST' ? 0 : c.req.path === '/ext/chats' ? messageCount(c.get('body')) : c.req.path === '/ext/tiktok/chats' ? itemCount(c.get('body')) : 0
    const admitted = extension.admit(caller.tokenId, messages, lane)
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
    const key = address === null ? null : ipKey(address)
    // 주소 한도를 먼저 보되(막힌 주소는 전체 한도를 쓰지 않음) 주소 기록에는 전체 한도까지 지난 시도만 넣는다 — 전체 한도에 막힌
    // 요청으로 주소 기록을 밀어내 믿는 주소의 20번을 새로 받는 길을 막는다(TD-QS1-002, RA-QS1-02, D-QS1-06 (d), AC-QS1-32)
    if (!codeLimiter.allows(key)) return apiError(429, 'EXT_CODE_LIMITED', EXTENSION_MESSAGES.CODE_LIMITED)
    if (!extension.trustedAddresses.has(key) && !allCodes.take('*')) return apiError(429, 'EXT_CODE_LIMITED', EXTENSION_MESSAGES.CODE_LIMITED)
    if (!codeLimiter.take(key)) return apiError(429, 'EXT_CODE_LIMITED', EXTENSION_MESSAGES.CODE_LIMITED)
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
    return c.json({ recorded: outcome.recorded, skipped: outcome.skipped, ownerDenied: outcome.ownerDenied, broadcast: outcome.broadcast })
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

  // 감사 글 가져가기 (AC12~AC15): 한 번에 글 하나. meIsOwner = 로그인 계정이 방송 채널 주인인가(입력 칸의 주인 배지, D-X1-29),
  // owner = 방송 채널 ID (못 읽으면 null). 실제 유튜브 입력 칸에는 로그인 채널 ID가 없다(HG-X1)
  app.post('/thanks/take', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['v', 'meIsOwner', 'owner'])
    if (extra !== null) return extra
    const v = own(input, 'v')
    const meIsOwner = own(input, 'meIsOwner') ?? false
    const owner = own(input, 'owner') ?? null
    const problems: FieldProblem[] = []
    if (typeof v !== 'string' || !VIDEO_RE.test(v)) problems.push({ field: 'v', message: '유튜브 영상 번호가 올바르지 않아요.' })
    if (typeof meIsOwner !== 'boolean') problems.push({ field: 'meIsOwner', message: '채널 주인 여부가 올바르지 않아요.' })
    if (owner !== null && (typeof owner !== 'string' || !CHANNEL_RE.test(owner))) problems.push({ field: 'owner', message: '채널 번호가 올바르지 않아요.' })
    if (problems.length > 0) return invalid(problems)
    const outcome = await extension.thanks.take(caller(c).sellerId, v as string, meIsOwner === true, owner as string | null)
    switch (outcome.kind) {
      case 'post':
        return c.json({ state: 'POST', post: { ids: outcome.ids, text: outcome.text, until: outcome.until }, afterMs: null, message: null })
      case 'none':
        return c.json({ state: 'NONE', post: null, afterMs: outcome.afterMs, message: null })
      case 'off':
        return c.json({ state: 'OFF', post: null, afterMs: null, message: EXT_THANKS_MESSAGES.OFF })
      case 'not_bound':
        return c.json({ state: 'NOT_BOUND', post: null, afterMs: null, message: EXTENSION_MESSAGES.NOT_BOUND })
      case 'not_owner':
        return c.json({ state: 'NOT_OWNER', post: null, afterMs: null, message: EXT_THANKS_MESSAGES.OWNER })
      case 'paused':
        return c.json({ state: 'PAUSED', post: null, afterMs: null, message: EXT_THANKS_MESSAGES.PAUSED })
    }
  })

  // 결과 (AC16): 가져간 발송함 ID 모두와 POSTED(자기 글이 뜬 것을 봄) · UNCONFIRMED(15초 안에 못 봄) · NOT_POSTED(넣기 전에 멈춤). 두 번 알려도 한 번만
  app.post('/thanks/result', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['ids', 'result'])
    if (extra !== null) return extra
    const ids = own(input, 'ids')
    const result = own(input, 'result')
    const problems: FieldProblem[] = []
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_MAX || !ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
      problems.push({ field: 'ids', message: '감사 번호를 보내 주세요.' })
    }
    if (result !== 'POSTED' && result !== 'UNCONFIRMED' && result !== 'NOT_POSTED') problems.push({ field: 'result', message: '결과가 올바르지 않아요.' })
    if (problems.length > 0) return invalid(problems)
    const rows = await extension.thanks.result(caller(c).sellerId, ids as number[], result as ThanksResult)
    if (rows === null) return notFound()
    return c.json({ rows })
  })

  const tiktok = deps.tiktok
  if (tiktok !== undefined) registerTiktokExtRoutes(app, tiktok)

  app.notFound(() => notFound())
  return app
}

/** 확장 틱톡 응답 본문 (아이디는 그 판매자 자신의 것 — 확장이 화면 주소와 비교한다) */
const tiktokInfo = (info: ExtTiktokInfo) => ({ tiktokId: info.tiktokId, mode: info.mode, code: info.code, message: info.message, broadcast: info.broadcast })

/** 틱톡 확장 경로 (TTX). 토큰·속도 제한은 위 미들웨어가 했다 */
function registerTiktokExtRoutes(app: Hono<ExtEnv>, tiktok: TikTokExtension): void {
  const body = (c: Context<ExtEnv>) => c.get('body') ?? {}
  const caller = (c: Context<ExtEnv>) => c.get('caller')

  app.get('/tiktok', async (c) => c.json(tiktokInfo(await tiktok.info(caller(c).sellerId))))

  app.post('/tiktok/chats', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['pageId', 'items'])
    if (extra !== null) return extra
    const items = own(input, 'items')
    if (!Array.isArray(items) || items.length === 0) return invalid([{ field: 'items', message: '댓글 목록을 보내 주세요.' }])
    if (items.length > EXT_TIKTOK_BATCH_MAX) return invalid([{ field: 'items', message: `한 번에 ${String(EXT_TIKTOK_BATCH_MAX)}개까지 보낼 수 있어요.` }])
    // 항목 모양은 거르개가 본다(못 읽은 항목은 버림으로 센다). 객체 항목의 모르는 키만 거절한다
    for (const [index, item] of items.entries()) {
      if (!isPlainObject(item)) continue
      const unknown = ownKeys(item).filter((key) => !TIKTOK_ITEM_KEYS.includes(key))
      if (unknown.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(unknown.map((key) => `items.${String(index)}.${key}`)))
    }
    const who = caller(c)
    const outcome = await tiktok.ingest(who.sellerId, own(input, 'pageId'), items, async (tx) => (await activeToken(tx, who.sellerId))?.id === who.tokenId)
    switch (outcome.kind) {
      case 'recorded':
        return c.json({ result: 'recorded', recorded: outcome.recorded, standby: 0, dropped: outcome.dropped, duplicates: outcome.duplicates, broadcast: outcome.broadcast, message: EXT_TIKTOK_MESSAGES.RECORDING })
      case 'standby':
        return c.json({ result: 'standby', recorded: 0, standby: outcome.standby, dropped: outcome.dropped, duplicates: 0, broadcast: outcome.broadcast, message: EXT_TIKTOK_MESSAGES.STANDBY })
      case 'blocked':
        return apiError(outcome.code === 'NOT_OWN_LIVE' ? 403 : 409, outcome.code, EXT_TIKTOK_MESSAGES[outcome.code])
      case 'save_failed':
        return apiError(500, 'SAVE_FAILED', EXT_TIKTOK_MESSAGES.SAVE_FAILED)
    }
  })

  app.post('/tiktok/status', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['screen', 'hidden', 'read', 'unread'])
    if (extra !== null) return extra
    const screen = own(input, 'screen')
    const hidden = own(input, 'hidden')
    const read = own(input, 'read') ?? 0
    const unread = own(input, 'unread') ?? 0
    const problems: FieldProblem[] = []
    if (typeof screen !== 'string' || !(EXT_TIKTOK_SCREENS as readonly string[]).includes(screen)) problems.push({ field: 'screen', message: '화면 종류가 올바르지 않아요.' })
    if (typeof hidden !== 'boolean') problems.push({ field: 'hidden', message: '틱톡 화면이 보이는지 알려 주세요.' })
    for (const [field, value] of [['read', read], ['unread', unread]] as const) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > EXT_TIKTOK_COUNT_MAX) problems.push({ field, message: '수는 0 이상의 정수로 보내 주세요.' })
    }
    if (problems.length > 0) return invalid(problems)
    const info = await tiktok.status(caller(c).sellerId, { screen: screen as ExtTiktokScreen, hidden: hidden as boolean, read: read as number, unread: unread as number })
    return c.json(tiktokInfo(info))
  })
}

/** 틱톡 묶음 항목 수 (속도 제한용 — 모양 검사는 처리기가 한다) */
function itemCount(body: Record<string, unknown> | null): number {
  const items = body === null ? undefined : own(body, 'items')
  return Array.isArray(items) ? items.length : 0
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
    const extra = ownKeys(item).filter((key) => !['id', 'ch', 'nick', 'text', 'at', 'owner'].includes(key))
    if (extra.length > 0) return { ok: false, response: apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const id = own(item, 'id')
    const ch = own(item, 'ch')
    const nick = own(item, 'nick')
    const text = own(item, 'text')
    const at = own(item, 'at')
    // 방송자 표시 (D-X1-29): 있으면 true만. 서버가 회차 채널과 같을 때만 방송자로 인정한다
    const owner = own(item, 'owner')
    if (
      (owner !== undefined && owner !== true) ||
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
    chats.push({ id, ch, nick, text, at, ...(owner === true ? { owner: true as const } : {}) })
  }
  return { ok: true, v, chats }
}
