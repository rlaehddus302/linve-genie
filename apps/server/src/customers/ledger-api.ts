// 손님 장부 경로 (KP1, CUSTOMER_RULES CR-3·CR-6·CR-7·CR-8). 판매자 계정만 — 보조자 허용 목록(roles.ts)에 넣지 않아 처리기에 닿기 전에 403이다.
// - 로그인 401·Origin·JSON·64KB 검사와 Cache-Control: no-store는 /api 공통 미들웨어가 한다. 다른 판매자의 날짜·손님은 없는 것과 같은 404.
// - 받은 값(구매자 ID·장부 ID)은 오류 응답·로그에 되돌리지 않는다. 표지·연락처 원문은 응답에 없다(엑셀은 판매자가 고를 때만 연락처 열).
// - 장부를 만드는 판매자 경로는 없다(AC-KP1-04). 어떤 경로도 엔진 이벤트·발송함을 쓰지 않는다.
import { isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import type { SessionContext } from '../auth.ts'
import { WORK_BUSY_MESSAGE, WORK_FAILED_MESSAGE, buyerParam } from '../closing.ts'
import { WorkBusy, WorkFailed } from '../work-pool.ts'
import { apiError, type FieldProblem } from '../errors.ts'
import { MIME, fileResponse } from '../files.ts'
import { isLedgerMonths } from './ledger-rules.ts'
import type { LedgerService, LedgerSettings } from './ledger.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const CUSTOMER_ID_RE = /^[0-9a-f]{32}$/
const LEDGER_ID_RE = /^[0-9a-f]{32}$/
/** 한 번에 묻는 손님 수 상한 (CR-7) */
export const BADGES_MAX = 50

export const LEDGER_MESSAGES = {
  months: '보관 기간을 다시 골라 주세요.',
  consoleBadges: '방송 화면에 손님 표시를 다시 골라 주세요.',
  buyers: '손님을 1~50명씩 물어 주세요.',
  noLedger: '이미 지운 장부예요.',
  contact: '연락처 열 넣기를 다시 골라 주세요.',
} as const

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalid = (problems: readonly FieldProblem[]) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)
const unknownField = (keys: readonly string[]) =>
  apiError(
    400,
    'UNKNOWN_FIELD',
    '받을 수 없는 항목이 있어요.',
    keys.map(() => ({ field: 'body', message: '받을 수 없는 항목이에요.' })),
  )

/** 설정 본문 검사: { months, consoleBadges } 둘 다 */
export function checkLedgerSettings(body: Record<string, unknown>): { ok: true; value: LedgerSettings } | { ok: false; response: Response } {
  const extra = Object.keys(body).filter((key) => key !== 'months' && key !== 'consoleBadges')
  if (extra.length > 0) return { ok: false, response: unknownField(extra) }
  const problems: FieldProblem[] = []
  if (!isLedgerMonths(body.months)) problems.push({ field: 'months', message: LEDGER_MESSAGES.months })
  if (typeof body.consoleBadges !== 'boolean') problems.push({ field: 'consoleBadges', message: LEDGER_MESSAGES.consoleBadges })
  if (problems.length > 0) return { ok: false, response: invalid(problems) }
  return { ok: true, value: { months: body.months as LedgerSettings['months'], consoleBadges: body.consoleBadges as boolean } }
}

export function registerLedgerRoutes(api: Hono<Env>, ledger: LedgerService): void {
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const body = (c: Context<Env>) => c.get('body') ?? {}

  // 설정 "손님 관리"의 장부 칸 (CR-3·CR-7)
  api.get('/ledger-settings', async (c) => c.json({ settings: await ledger.settings(sellerOf(c)) }))
  api.put('/ledger-settings', async (c) => {
    const checked = checkLedgerSettings(body(c))
    if (!checked.ok) return checked.response
    return c.json({ settings: await ledger.saveSettings(sellerOf(c), checked.value) })
  })

  // 콘솔 손님 표시 (CR-7): ?buyer=<id>&buyer=<id>… 1~50명, 실제 날짜만
  api.get('/days/:date/customer-badges', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal === 'true') return notFound()
    if (rehearsal !== undefined && rehearsal !== 'false') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }])
    const raw = c.req.queries('buyer') ?? []
    const buyers: string[] = []
    for (const value of raw) {
      const read = buyerParam(value)
      if (!read.ok) return invalid([{ field: 'buyer', message: LEDGER_MESSAGES.buyers }])
      if (!buyers.includes(read.buyer)) buyers.push(read.buyer)
    }
    if (buyers.length === 0 || buyers.length > BADGES_MAX) return invalid([{ field: 'buyer', message: LEDGER_MESSAGES.buyers }])
    const view = await ledger.badges(sellerOf(c), date, buyers)
    return view === null ? notFound() : c.json(view)
  })

  // 손님 엑셀 (CR-6): ?contact=0|1 — 경로를 /customers/:id와 겹치지 않게 customers.xlsx
  api.get('/customers.xlsx', async (c) => {
    const contact = c.req.query('contact') ?? '0'
    if (contact !== '0' && contact !== '1') return invalid([{ field: 'contact', message: LEDGER_MESSAGES.contact }])
    const session = c.get('session')
    let file: Awaited<ReturnType<LedgerService['exportXlsx']>>
    try {
      file = await ledger.exportXlsx(session.sellerId, session.accountId, contact === '1', c.req.raw.signal)
    } catch (error) {
      // 작업 워커 (RA-KP1-008): 밀려 있으면 429, 못 끝내면 500 — 판매대장과 같은 문장
      if (error instanceof WorkBusy) return apiError(429, 'BUSY', WORK_BUSY_MESSAGE)
      if (error instanceof WorkFailed) return apiError(500, 'FILE_FAILED', WORK_FAILED_MESSAGE)
      throw error
    }
    return fileResponse(file.bytes, MIME.xlsx, file.fileName, 'customers.xlsx')
  })

  // 판매자 손님 자세히 [장부에서 지우기] (CR-3 SELLER_DELETE)
  api.post('/customers/:id/ledger/delete', async (c) => {
    const id = c.req.param('id')
    if (!CUSTOMER_ID_RE.test(id)) return notFound()
    const input = body(c)
    const extra = Object.keys(input).filter((key) => key !== 'ledgerId')
    if (extra.length > 0) return unknownField(extra)
    const ledgerId = input.ledgerId
    if (typeof ledgerId !== 'string' || !LEDGER_ID_RE.test(ledgerId)) return invalid([{ field: 'ledgerId', message: '장부를 다시 골라 주세요.' }])
    const session = c.get('session')
    const result = await ledger.sellerDelete(session.sellerId, session.accountId, id, ledgerId)
    if (result === 'not_found') return notFound()
    if (result === 'no_ledger') return apiError(409, 'NO_LEDGER', LEDGER_MESSAGES.noLedger)
    return c.json({ ledger: null })
  })
}
