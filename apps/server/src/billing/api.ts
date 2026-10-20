// /api/billing 경로 (N5, BILLING_RULES BL-4·BL-6~BL-9, AC-N5-13·14·30~41). 계약은 harness/sprints/N5/dev-notes.md "요금 API".
// - 요금 기능이 꺼져 있으면 /api/billing/** 전부 404다(웹훅 포함 — api.ts가 세션·Origin 검사보다 먼저 거른다).
// - 로그인·Origin·JSON·64KB 검사는 /api 공통 미들웨어가 한다. 예외는 웹훅(세션·Origin 없음 — 서명으로 확인, 64KB 제한은 그대로).
// - 다른 판매자의 결제 ID는 없는 결제와 같은 404다. 받은 값은 오류 응답에 되돌려 보내지 않는다.
// - 시험 결제 경로(/api/billing/test/**)는 시험 결제(가짜 결제 서버)일 때만 있다. 운영 구성에는 경로 자체가 없다(404).
import type { Context, Hono } from 'hono'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError } from '../errors.ts'
import { unknownFieldProblems } from '../messages.ts'
import { DAY_MS, PASS_KINDS, isQuantityKind, type PassKind } from './rules.ts'
import { BILLING_LIST_DEFAULT, BILLING_LIST_MAX, checkOperatorGrant, parseCursor, type BillingOutcome, type BillingService } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

/** 웹훅 경로 (세션·Origin 없이 받는다) */
export const WEBHOOK_PATH = '/api/billing/webhook'

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])
const invalid = (field: string, message: string) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message }])

function outcome<T>(c: Context<Env>, result: BillingOutcome<T>): Response {
  if (result.kind === 'not_found') return notFound()
  if (result.kind === 'rejected') return apiError(result.rejection.status, result.rejection.code, result.rejection.message, result.rejection.problems)
  return c.json(result.value as object)
}

export function registerBillingRoutes(api: Hono<Env>, billing: BillingService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  /** 이어 받기·개수 (1~100) */
  const pageOf = (c: Context<Env>): { cursor: { at: number; id: string } | null; limit: number } | Response => {
    const cursor = parseCursor(c.req.query('cursor'))
    const rawLimit = c.req.query('limit') ?? String(BILLING_LIST_DEFAULT)
    if (cursor === 'bad') return invalid('cursor', '이어 받기 기준을 확인해 주세요.')
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > BILLING_LIST_MAX) return invalid('limit', '개수는 1부터 100까지의 정수로 적어 주세요.')
    return { cursor, limit: Number(rawLimit) }
  }

  // ── 조회 ─────────────────────────────────────────────────────────────────
  api.get('/billing', async (c) => c.json(await billing.status(sellerOf(c))))

  api.get('/billing/payments', async (c) => {
    const page = pageOf(c)
    if (page instanceof Response) return page
    return c.json(await billing.payments(sellerOf(c), page.cursor, page.limit))
  })

  api.get('/billing/usage', async (c) => {
    const page = pageOf(c)
    if (page instanceof Response) return page
    return c.json(await billing.usage(sellerOf(c), page.cursor, page.limit))
  })

  // ── 사업자 정보 (AC-N5-37) ─────────────────────────────────────────────
  api.put('/billing/business', async (c) => {
    const input = body(c)
    if (requestIdOf(input) === null) return invalidRequestId()
    return outcome(c, await billing.saveBusiness(sellerOf(c), input))
  })

  // ── 결제 주문·확인·환불 (AC-N5-30·31·36) ─────────────────────────────────
  api.post('/billing/orders', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    return outcome(c, await billing.createOrder(sellerOf(c), requestId, input))
  })

  // 확인 요청 본문은 요청 번호뿐이다 — 금액·상태 같은 항목은 UNKNOWN_FIELD (결제 창이 돌려준 값·주소의 쿼리는 판단에 쓰지 않는다)
  api.post('/billing/orders/:paymentId/confirm', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    if (requestIdOf(input) === null) return invalidRequestId()
    return outcome(c, await billing.confirm(sellerOf(c), c.req.param('paymentId')))
  })

  api.post('/billing/orders/:paymentId/refund', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    return outcome(c, await billing.refund(sellerOf(c), requestId, c.req.param('paymentId')))
  })

  // ── 웹훅 (AC-N5-32) — 세션·Origin 없음, 서명으로 확인. 응답에 내부 상태를 담지 않는다 ──
  api.post('/billing/webhook', async (c) => {
    const status = await billing.webhook(c.req.raw.headers, await c.req.text())
    if (status === 400) return apiError(400, 'BAD_REQUEST', '요청 형식이 올바르지 않아요.')
    if (status === 503) return apiError(503, 'INTERNAL_ERROR', '잠시 뒤 다시 보내 주세요.')
    return c.json({ ok: true })
  })

  // ── 시험 결제 (AC-N5-40) — 가짜 결제 서버가 있을 때만 ─────────────────────
  const test = billing.setup.test
  if (test === null) return

  /** 시험 결제 창: 그 결제를 완료(카드·계좌이체)·실패·금액 바꿔 완료 */
  api.post('/billing/test/payments/:paymentId', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['requestId', 'action', 'method', 'amount'])
    if (extra !== null) return extra
    const order = await billing.order(sellerOf(c), c.req.param('paymentId'))
    if (order === null) return notFound()
    const action = own(input, 'action')
    const method = own(input, 'method') ?? 'CARD'
    const amount = own(input, 'amount') ?? order.amount
    if (action !== 'PAID' && action !== 'FAILED' && action !== 'CHANGED_AMOUNT') return invalid('action', "action은 'PAID'·'FAILED'·'CHANGED_AMOUNT' 중 하나로 적어 주세요.")
    if (method !== 'CARD' && method !== 'TRANSFER') return invalid('method', "method는 'CARD'나 'TRANSFER'로 적어 주세요.")
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return invalid('amount', '금액은 1 이상의 정수로 적어 주세요.')
    if (action === 'FAILED') test.portone.fail(order.paymentId, order.amount, method)
    // 금액을 바꿔 결제: 주문보다 1,000원 적게 (시험용 — 금액 불일치 자동 취소를 본다)
    else test.portone.pay(order.paymentId, action === 'CHANGED_AMOUNT' ? Math.max(1, order.amount - 1000) : amount, method)
    return c.json({ paymentId: order.paymentId, status: test.portone.status(order.paymentId) })
  })

  /** 시험 웹훅: 가짜 결제 서버가 서명한 웹훅을 보낸다 (그 판매자의 결제만) */
  api.post('/billing/test/payments/:paymentId/webhook', async (c) => {
    const extra = onlyKeys(body(c), ['requestId'])
    if (extra !== null) return extra
    const order = await billing.order(sellerOf(c), c.req.param('paymentId'))
    if (order === null) return notFound()
    return c.json({ status: await billing.testWebhook(order.paymentId) })
  })

  /** 가짜 결제 서버: 조회 실패·취소 실패 켜고 끄기 */
  api.put('/billing/test/gateway', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['requestId', 'lookupFailure', 'cancelFailure', 'issueFailure'])
    if (extra !== null) return extra
    for (const key of ['lookupFailure', 'cancelFailure', 'issueFailure']) {
      const value = own(input, key)
      if (value !== undefined && typeof value !== 'boolean') return invalid(key, `${key}는 true나 false로 적어 주세요.`)
    }
    const lookup = own(input, 'lookupFailure')
    const cancel = own(input, 'cancelFailure')
    const issue = own(input, 'issueFailure')
    if (typeof lookup === 'boolean') test.portone.lookupFailure = lookup
    if (typeof cancel === 'boolean') test.portone.cancelFailure = cancel
    if (typeof issue === 'boolean') test.issuer.fail = issue
    return c.json({ lookupFailure: test.portone.lookupFailure, cancelFailure: test.portone.cancelFailure, issueFailure: test.issuer.fail })
  })

  /** 시험용 이용권 부여 (운영자 이용권 — at을 과거로 줄 수 있다, 400일 전까지) */
  api.post('/billing/test/grants', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['requestId', 'kind', 'quantity', 'reason', 'at'])
    if (extra !== null) return extra
    const kind = own(input, 'kind')
    const checked = checkOperatorGrant({ kind, quantity: own(input, 'quantity'), reason: own(input, 'reason') ?? '시험용 이용권' })
    if (!checked.ok) return invalid(typeof kind === 'string' && (PASS_KINDS as readonly string[]).includes(kind) ? (isQuantityKind(kind) ? 'quantity' : 'reason') : 'kind', checked.message)
    const rawAt = own(input, 'at')
    let at: number | undefined
    if (rawAt !== undefined) {
      const parsed = typeof rawAt === 'string' ? Date.parse(rawAt) : Number.NaN
      if (!Number.isFinite(parsed)) return invalid('at', "부여 시각은 '2026-10-20T20:00:00+09:00'처럼 적어 주세요.")
      at = parsed
    }
    const now = billing.now()
    if (at !== undefined && (at > now || at < now - 400 * DAY_MS)) return invalid('at', '부여 시각은 지금이나 그 전(400일 안)으로 적어 주세요.')
    const grantId = await billing.grantByOperator(sellerOf(c), { kind: checked.kind as PassKind, quantity: checked.quantity, reason: checked.reason, ...(at === undefined ? {} : { at }) })
    return c.json({ grantId })
  })
}
