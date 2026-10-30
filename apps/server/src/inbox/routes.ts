// 휴대폰 알림 받기 경로 (SMS3 ORD-13 C-02·C-04, 문자 확인 카드). 계약은 dev-notes "dev-server > 화면·기기에게"(SMS3).
// 1) 기기 입구 POST /api/inbox/messages — 쿠키·Origin을 보지 않고 Authorization: Bearer <받기 토큰>으로만 받는다. /api 공통 미들웨어보다 먼저 붙는다.
//    401 TOKEN_INVALID(토큰 먼저) → 413(256KB) → 400 BAD_REQUEST(모양 — 한 건이라도 틀리면 아무것도 처리 안 함) → 429 TOO_MANY → 200.
//    응답에는 메시지마다 상태와 거르기 목록뿐(읽은 결과 없음). 받은 값은 오류 응답에 되돌려 보내지 않고, 로그엔 코드·종류만.
// 2) 화면 경로 /api/inbox/** — /api 공통(세션·Origin·JSON·64KB) 뒤. 설정은 판매자만(보조자 403 — roles.ts 목록 밖), 카드는 보조자도.
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError, JSON_CONTENT_TYPE } from '../errors.ts'
import { errorKind, type LogSink } from '../log.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { Actor, WriteResult } from '../writer.ts'
import { INBOX_MESSAGES, parseInboxRequest, type InboxOutcome, type InboxService } from './service.ts'

/** 기기 입구 경로 (C-04) */
export const INBOX_PATH = '/api/inbox/messages'
/** 기기 입구 본문 상한 (20건 × 본문 — 1,000자를 넘는 본문도 받아서 앞 1,000자만 읽는다) */
export const INBOX_BODY_LIMIT_BYTES = 256 * 1024

const noStore = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })

/** 기기 입구를 앱에 붙인다 (/api 경로보다 먼저) */
export function registerInboxIntake(app: Hono, inbox: InboxService, log: LogSink): void {
  const limit = bodyLimit({ maxSize: INBOX_BODY_LIMIT_BYTES, onError: () => apiError(413, 'PAYLOAD_TOO_LARGE', '보낸 내용이 너무 커요.') })
  /** 토큰으로 정한 판매자 (요청마다 — 본문 상한 단계가 요청 객체를 바꾸므로 컨텍스트 변수로 넘긴다) */
  type IntakeContext = Context<{ Variables: { inboxSeller: string } }>
  app.post(INBOX_PATH, async (c, next) => {
    // 토큰 먼저 (본문을 읽기 전에 — 토큰 없는 큰 본문을 받아 두지 않는다)
    const sellerId = await inbox.authenticate(c.req.header('authorization'))
    if (sellerId === null) return apiError(401, 'TOKEN_INVALID', INBOX_MESSAGES.tokenInvalid)
    ;(c as unknown as IntakeContext).set('inboxSeller', sellerId)
    return limit(c, next)
  }, async (c) => {
    const sellerId = (c as unknown as IntakeContext).get('inboxSeller')
    if (typeof sellerId !== 'string') return apiError(401, 'TOKEN_INVALID', INBOX_MESSAGES.tokenInvalid)
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== JSON_CONTENT_TYPE) return apiError(400, 'BAD_REQUEST', INBOX_MESSAGES.badRequest)
    let raw: unknown
    try {
      raw = JSON.parse(await c.req.text())
    } catch {
      return apiError(400, 'BAD_REQUEST', INBOX_MESSAGES.badRequest)
    }
    const request = parseInboxRequest(raw)
    if (request === null) return apiError(400, 'BAD_REQUEST', INBOX_MESSAGES.badRequest)
    try {
      const outcome = await inbox.receive(sellerId, request)
      if (!outcome.ok) return apiError(outcome.status, outcome.code, outcome.message)
      return noStore(outcome.value)
    } catch (error) {
      log({ level: 'error', code: 'INBOX_FAILED', errorKind: errorKind(error) })
      return apiError(500, 'INTERNAL_ERROR', '잠시 뒤에 다시 보내 주세요.')
    }
  })
  app.all(INBOX_PATH, () => apiError(405, 'METHOD_NOT_ALLOWED', '허용하지 않는 요청이에요.', [], {}, { Allow: 'POST' }))
}

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const CARD_ID_RE = /^ic_[0-9a-f-]{36}$/
const BROADCAST_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 카드 넣기에서 받는 옵션 칸 (지금 옵션 문자찜 입력과 같은 칸만 — 그 밖은 400) */
const INSERT_EXTRA = ['qty', 'options']

function respond<T>(c: Context<Env>, outcome: InboxOutcome<T>, view: (value: T) => Record<string, unknown>): Response {
  if (!outcome.ok) return apiError(outcome.status, outcome.code, outcome.message, [], outcome.extra ?? {})
  return c.json(view(outcome.value))
}

/** 쓰기 결과 → 응답 본문 (지금 이벤트 쓰기 응답과 같은 칸) */
function resultBody(result: WriteResult): Record<string, unknown> {
  return {
    date: result.date,
    rehearsal: result.rehearsal,
    seq: result.seq,
    type: result.type,
    changed: result.changed,
    effects: [...result.effects],
    ...(result.type === 'sms' ? { phoneLast4: typeof result.event.phoneLast4 === 'string' ? result.event.phoneLast4 : null, buyer: result.smsBuyer ?? null } : {}),
  }
}

/** 화면 경로 (/api 공통 미들웨어 뒤) */
export function registerInboxRoutes(api: Hono<Env>, inbox: InboxService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const actorOf = (c: Context<Env>): Actor => ({ kind: 'account', accountId: c.get('session').accountId })
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) && !id.startsWith('dep-') && !id.startsWith('inbox-') ? id : null
  }
  const invalidRequestId = () => apiError(400, 'INVALID_REQUEST_ID', '보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.', [{ field: 'requestId', message: '화면을 새로고침한 뒤 다시 해 주세요.' }])

  // ── 설정 "휴대폰 알림 받기" (C-02 — 판매자만) ─────────────────────────────
  api.get('/inbox/settings', async (c) => c.json({ inbox: await inbox.view(sellerOf(c)) }))
  api.put('/inbox/settings', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['enabled'])
    if (extra !== null) return extra
    const enabled = own(input, 'enabled')
    if (typeof enabled !== 'boolean') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'enabled', message: '켤지는 예나 아니오로만 정할 수 있어요.' }])
    return respond(c, await inbox.setEnabled(sellerOf(c), enabled), (view) => ({ inbox: view }))
  })
  // 토큰은 이 응답에만 한 번 (DB엔 해시만, 로그 없음)
  api.post('/inbox/token', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const made = await inbox.makeToken(sellerOf(c))
    return c.json({ token: made.token, inbox: made.inbox })
  })

  // ── 콘솔 "문자 확인" 칸 (보조자도) ────────────────────────────────────────
  api.get('/inbox/cards', async (c) => {
    const b = c.req.query('b')
    if (b === undefined || !BROADCAST_RE.test(b)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'b', message: '어느 방송인지 골라 주세요.' }])
    return c.json(await inbox.cards(sellerOf(c), b))
  })
  api.post('/inbox/cards/:id/insert', async (c) => {
    const id = c.req.param('id')
    if (!CARD_ID_RE.test(id)) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
    const input = body(c)
    const extra = onlyKeys(input, ['requestId', 'no', ...INSERT_EXTRA])
    if (extra !== null) return extra
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const no = own(input, 'no')
    if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 9999) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'no', message: '넣을 번호를 골라 주세요.' }])
    const fields: Record<string, unknown> = {}
    for (const key of INSERT_EXTRA) {
      const value = own(input, key)
      if (value !== undefined) fields[key] = value
    }
    return respond(c, await inbox.insert(sellerOf(c), actorOf(c), id, { requestId, no, extra: fields }), (value) => ({ ok: true, card: value.card, result: resultBody(value.result) }))
  })
  api.post('/inbox/cards/:id/approve', async (c) => {
    const id = c.req.param('id')
    if (!CARD_ID_RE.test(id)) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
    const input = body(c)
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    return respond(c, await inbox.approve(sellerOf(c), actorOf(c), id, requestId), (value) => ({ ok: true, card: value.card, cancelled: true, result: resultBody(value.result) }))
  })
  api.post('/inbox/cards/:id/ignore', async (c) => {
    const id = c.req.param('id')
    if (!CARD_ID_RE.test(id)) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return respond(c, await inbox.ignore(sellerOf(c), id), (value) => ({ ok: true, card: value.card }))
  })
}
