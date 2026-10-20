// /api/deposits 경로 (N3, acceptance "API 뜻", AC-N3-10~33). 계약은 harness/sprints/N3/dev-notes.md "dev-server > 화면(dev-web)에게".
// - 로그인·Origin·JSON·64KB 검사는 /api 공통 미들웨어가 먼저 한다. 다른 판매자의 입금·원천·기억한 이름은 없는 것과 같은 404다.
// - 모르는 항목은 400 UNKNOWN_FIELD(아무것도 기록하지 않는다) — 계좌 비밀번호·빠른조회 아이디/비밀번호·생년월일 같은 칸도 그렇다(AC-N3-16).
// - 받은 값은 오류 응답에 되돌려 보내지 않는다(문제에는 칸 이름과 서버가 정한 문장만). 찾을 말·붙여넣은 글은 로그에 남기지 않는다.
// - 시험용 입금 넣기(/deposits/test/rows)는 시험 모드(E2E 기동)에서만 붙는다 — 운영 기동에는 경로 자체가 없다(404, AC-N3-17).
import { isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { REQUEST_ID_RE, hasControlChar, isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError, type FieldProblem } from '../errors.ts'
import { unknownFieldProblems } from '../messages.ts'
import { BULK_MAX, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, TEST_ROWS_MAX, DepositService, type BulkEntry, type ConfirmInput, type DepositOutcome } from './service.ts'
import { DEPOSIT_STATUSES, type DepositStatus } from './store.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const NO_RE = /^[1-9]\d{0,8}$/
const SOURCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 묶음 찾기 말 길이 상한 */
const QUERY_MAX = 40
/** 구매자 ID (채널 ID·문자 구매자 ID) — 1~200자, 제어 문자 없음 */
const isBuyerId = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 200 && !hasControlChar(value)

const invalid = (problems: readonly FieldProblem[]) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])

function respond<T>(c: Context<Env>, outcome: DepositOutcome<T>): Response {
  if (!outcome.ok) return apiError(outcome.status, outcome.code, outcome.message, outcome.problems ?? [])
  return c.json(outcome.value as object)
}

/** 확정 칸 { date, buyer, remaining, remember? } 검사 */
function confirmInput(input: Record<string, unknown>): ConfirmInput | FieldProblem[] {
  const date = own(input, 'date')
  const buyer = own(input, 'buyer')
  const remaining = own(input, 'remaining')
  const remember = own(input, 'remember')
  const problems: FieldProblem[] = []
  if (!isValidDate(date)) problems.push({ field: 'date', message: '묶음 날짜를 골라 주세요.' })
  if (!isBuyerId(buyer)) problems.push({ field: 'buyer', message: '묶음을 골라 주세요.' })
  if (typeof remaining !== 'number' || !Number.isSafeInteger(remaining)) problems.push({ field: 'remaining', message: '본 남은 금액을 정수(원)로 보내 주세요.' })
  if (remember !== undefined && typeof remember !== 'boolean') problems.push({ field: 'remember', message: '입금자명을 기억할지는 예나 아니오로만 정할 수 있어요.' })
  if (problems.length > 0) return problems
  return { date: date as string, buyer: buyer as string, remaining: remaining as number, remember: remember === true }
}

export function registerDepositRoutes(api: Hono<Env>, deposits: DepositService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const accountOf = (c: Context<Env>) => c.get('session').accountId
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }
  const noOf = (c: Context<Env>): number | null => {
    const raw = c.req.param('no') ?? ''
    return NO_RE.test(raw) ? Number(raw) : null
  }

  // ── 목록·수 ──────────────────────────────────────────────────────────────
  // ?status=REVIEW|AUTO_APPLIED|APPLIED|IGNORED (기본 REVIEW, 쉼표로 여럿 — 예: AUTO_APPLIED,APPLIED) &before=<입금 번호> &limit=1~200 (기본 50)
  api.get('/deposits', async (c) => {
    const status = c.req.query('status') ?? 'REVIEW'
    const statuses = status.split(',')
    const before = c.req.query('before')
    const limit = c.req.query('limit') ?? String(LIST_LIMIT_DEFAULT)
    const problems: FieldProblem[] = []
    if (statuses.length > DEPOSIT_STATUSES.length || new Set(statuses).size !== statuses.length || !statuses.every((item) => (DEPOSIT_STATUSES as readonly string[]).includes(item))) {
      problems.push({ field: 'status', message: '상태를 골라 주세요.' })
    }
    if (before !== undefined && !NO_RE.test(before)) problems.push({ field: 'before', message: '이어 받을 입금 번호를 1 이상의 정수로 적어 주세요.' })
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > LIST_LIMIT_MAX) problems.push({ field: 'limit', message: '개수는 1~200으로 적어 주세요.' })
    if (problems.length > 0) return invalid(problems)
    return c.json(await deposits.list(sellerOf(c), statuses as DepositStatus[], before === undefined ? null : Number(before), Number(limit)))
  })

  api.get('/deposits/count', async (c) => c.json(await deposits.count(sellerOf(c))))

  // ── 원천 (AC-N3-14·15·16·17) ────────────────────────────────────────────
  api.get('/deposits/sources', async (c) => c.json(await deposits.sources(sellerOf(c))))

  api.post('/deposits/sources', async (c) => {
    const input = body(c)
    // 계좌 비밀번호·빠른조회 아이디/비밀번호·생년월일 같은 칸은 받지 않는다 — 모르는 항목으로 거절하고 아무것도 기록하지 않는다
    const extra = onlyKeys(input, ['kind', 'label', 'corpNum', 'bank', 'accountNumber', 'intervalMin'])
    if (extra !== null) return extra
    return respond(
      c,
      await deposits.createSource(sellerOf(c), {
        kind: own(input, 'kind'),
        label: own(input, 'label'),
        corpNum: own(input, 'corpNum'),
        bank: own(input, 'bank'),
        accountNumber: own(input, 'accountNumber'),
        intervalMin: own(input, 'intervalMin'),
      }),
    )
  })

  api.patch('/deposits/sources/:id', async (c) => {
    const id = c.req.param('id')
    if (!SOURCE_ID_RE.test(id)) return notFound()
    const input = body(c)
    const extra = onlyKeys(input, ['label', 'intervalMin', 'enabled'])
    if (extra !== null) return extra
    return respond(c, await deposits.updateSource(sellerOf(c), id, { label: own(input, 'label'), intervalMin: own(input, 'intervalMin'), enabled: own(input, 'enabled') }))
  })

  api.post('/deposits/sources/:id/fetch', async (c) => {
    const id = c.req.param('id')
    if (!SOURCE_ID_RE.test(id)) return notFound()
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const outcome = await deposits.fetchNow(sellerOf(c), id)
    return outcome.ok ? c.json({ source: outcome.value }) : respond(c, outcome)
  })

  // 팝빌 계좌 관리 주소 { corpNum } 또는 { source } — 서버가 팝빌에서 받은 주소 그대로(저장하지 않는다)
  api.post('/deposits/popbill/manage-url', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['corpNum', 'source'])
    if (extra !== null) return extra
    return respond(c, await deposits.manageUrl(sellerOf(c), { corpNum: own(input, 'corpNum'), source: own(input, 'source') }))
  })

  // 시험용 입금 넣기 (시험 모드에서만 — 운영 기동에는 이 경로가 없다)
  if (deposits.testMode) {
    api.post('/deposits/test/rows', async (c) => {
      const input = body(c)
      const extra = onlyKeys(input, ['source', 'rows'])
      if (extra !== null) return extra
      const source = own(input, 'source')
      const raw = own(input, 'rows')
      if (typeof source !== 'string' || !SOURCE_ID_RE.test(source)) return invalid([{ field: 'source', message: '시험용 원천을 골라 주세요.' }])
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > TEST_ROWS_MAX) return invalid([{ field: 'rows', message: '입금 줄은 1~1000개로 보내 주세요.' }])
      const rows = raw.map((row) => DepositService.testRow(row))
      const bad = rows.findIndex((row) => row === null)
      if (bad >= 0) return invalid([{ field: `rows.${String(bad)}`, message: '입금 줄은 { key, at, amount, name }으로 보내 주세요.' }])
      return respond(c, await deposits.testInsert(sellerOf(c), source, rows as NonNullable<(typeof rows)[number]>[]))
    })
  }

  // ── 기억한 입금자명 (AC-N3-25) ──────────────────────────────────────────
  api.get('/deposits/names', async (c) => c.json(await deposits.names(sellerOf(c))))

  api.delete('/deposits/names/:id', async (c) => {
    const raw = c.req.param('id')
    if (!NO_RE.test(raw)) return notFound()
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return respond(c, await deposits.forgetName(sellerOf(c), Number(raw)))
  })

  // ── 붙여넣기 (AC-N3-13) ─────────────────────────────────────────────────
  api.post('/deposits/paste/preview', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['text'])
    if (extra !== null) return extra
    const text = own(input, 'text')
    if (typeof text !== 'string' || text.trim() === '') return invalid([{ field: 'text', message: '입금 내역을 붙여 넣어 주세요.' }])
    return respond(c, await deposits.pastePreview(sellerOf(c), text))
  })

  api.post('/deposits/paste', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'text'])
    if (extra !== null) return extra
    const text = own(input, 'text')
    if (typeof text !== 'string' || text.trim() === '') return invalid([{ field: 'text', message: '입금 내역을 붙여 넣어 주세요.' }])
    return respond(c, await deposits.pasteInsert(sellerOf(c), accountOf(c), requestId, text))
  })

  // ── 한꺼번에 (AC-N3-28) ─────────────────────────────────────────────────
  api.post('/deposits/bulk', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'items'])
    if (extra !== null) return extra
    const raw = own(input, 'items')
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > BULK_MAX) return invalid([{ field: 'items', message: '처리할 입금을 1~100개 골라 주세요.' }])
    const items: BulkEntry[] = raw.map((item: unknown): BulkEntry => {
      if (!isPlainObject(item)) return { no: null, invalid: { ok: false, status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.' } }
      const no = own(item, 'no')
      const okNo = typeof no === 'number' && Number.isSafeInteger(no) && no >= 1 ? no : null
      const unknown = ownKeys(item).filter((key) => !['no', 'action', 'date', 'buyer', 'remaining', 'remember'].includes(key))
      if (unknown.length > 0) return { no: okNo, invalid: { ok: false, status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.' } }
      if (okNo === null) return { no: null, invalid: { ok: false, status: 400, code: 'INVALID_INPUT', message: '입금 번호를 확인해 주세요.' } }
      const action = own(item, 'action')
      if (action === 'ignore') return { no: okNo, action: 'ignore' }
      if (action !== 'confirm') return { no: okNo, invalid: { ok: false, status: 400, code: 'INVALID_INPUT', message: '확정이나 무시를 골라 주세요.' } }
      const confirm = confirmInput(item)
      if (Array.isArray(confirm)) return { no: okNo, invalid: { ok: false, status: 400, code: 'INVALID_INPUT', message: '묶음을 골라 주세요.' } }
      return { no: okNo, action: 'confirm', ...confirm }
    })
    return respond(c, await deposits.bulk(sellerOf(c), accountOf(c), requestId, items))
  })

  // ── 입금 하나·묶음 찾기·처리 (AC-N3-24~27·31·33) ──────────────────────────
  api.get('/deposits/:no', async (c) => {
    const no = noOf(c)
    if (no === null) return notFound()
    const detail = await deposits.detail(sellerOf(c), no)
    return detail === null ? notFound() : c.json({ deposit: detail })
  })

  // 묶음 찾기 ?q=<찾을 말>&date=<YYYY-MM-DD> (찾을 말·결과는 로그에 남지 않는다)
  api.get('/deposits/:no/bundles', async (c) => {
    const no = noOf(c)
    if (no === null) return notFound()
    const q = c.req.query('q') ?? ''
    const date = c.req.query('date')
    const problems: FieldProblem[] = []
    if ([...q].length > QUERY_MAX || hasControlChar(q)) problems.push({ field: 'q', message: `찾을 말은 ${String(QUERY_MAX)}자까지 적어 주세요.` })
    if (date !== undefined && !isValidDate(date)) problems.push({ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." })
    if (problems.length > 0) return invalid(problems)
    return respond(c, await deposits.searchBundles(sellerOf(c), no, q, date ?? null))
  })

  api.post('/deposits/:no/confirm', async (c) => {
    const no = noOf(c)
    if (no === null) return notFound()
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'date', 'buyer', 'remaining', 'remember'])
    if (extra !== null) return extra
    const confirm = confirmInput(input)
    if (Array.isArray(confirm)) return invalid(confirm)
    return respond(c, await deposits.confirm(sellerOf(c), accountOf(c), requestId, no, confirm))
  })

  for (const action of ['ignore', 'reopen', 'revert'] as const) {
    api.post(`/deposits/:no/${action}`, async (c) => {
      const no = noOf(c)
      if (no === null) return notFound()
      const input = body(c)
      const requestId = requestIdOf(input)
      if (requestId === null) return invalidRequestId()
      const extra = onlyKeys(input, ['requestId'])
      if (extra !== null) return extra
      const seller = sellerOf(c)
      const account = accountOf(c)
      const outcome =
        action === 'ignore' ? await deposits.ignore(seller, account, requestId, no) : action === 'reopen' ? await deposits.reopen(seller, account, requestId, no) : await deposits.revert(seller, account, requestId, no)
      return respond(c, outcome)
    })
  }
}
