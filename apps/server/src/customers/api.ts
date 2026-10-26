// 손님 기록 경로 (CRM1, SPEC BUY-06·BUY-07, D-CRM1-10). 판매자 계정만 — 보조자 허용 목록(roles.ts)에 넣지 않아 처리기에 닿기 전에 403이다.
// - 로그인·Origin·JSON·64KB 검사와 Cache-Control: no-store는 /api 공통 미들웨어가 한다. 다른 판매자의 날짜·손님은 없는 것과 같은 404.
// - 실제 날짜만: ?rehearsal=true는 404(아무 숫자도 내지 않는다, AC-CRM1-06).
// - 받은 값(메모 글·찾는 말)은 오류 응답·로그에 되돌려 보내지 않는다. 응답에 표지(채널 ID 전체·전화번호 키)를 따로 내지 않는다 — 손님은 불투명 ID로 가리킨다.
// - 어떤 경로도 엔진 이벤트·발송함을 쓰지 않는다.
import { containsPhoneRun, isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { hasUnsafeText } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { buyerParam } from '../closing.ts'
import { apiError, type FieldProblem } from '../errors.ts'
import { PHONE_NUMBER_MESSAGE } from '../messages.ts'
import { checkCustomerSettings, checkMemo } from './rules.ts'
import { CUSTOMER_FILTERS, CUSTOMER_SORTS, type CustomerFilter, type CustomerService, type CustomerSort } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const CUSTOMER_ID_RE = /^[0-9a-f]{32}$/
const QUERY_MAX = 40
const OFFSET_RE = /^(0|[1-9]\d{0,5})$/

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalid = (problems: readonly FieldProblem[]) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)

export function registerCustomerRoutes(api: Hono<Env>, customers: CustomerService): void {
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const body = (c: Context<Env>) => c.get('body') ?? {}
  /** 실제 날짜 경로 (?rehearsal=true면 404, 다른 값은 400) */
  const realDate = (c: Context<Env>): { ok: true; date: string } | { ok: false; response: Response } => {
    const date = c.req.param('date') ?? ''
    if (!isValidDate(date)) return { ok: false, response: notFound() }
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal === 'true') return { ok: false, response: notFound() }
    if (rehearsal !== undefined && rehearsal !== 'false') {
      return { ok: false, response: invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }]) }
    }
    return { ok: true, date }
  }
  const rejected = (checked: { unknown: boolean; problems: readonly FieldProblem[] }) =>
    checked.unknown ? apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', checked.problems) : invalid(checked.problems)

  // 설정 "손님 관리" (D-CRM1-05)
  api.get('/customer-settings', async (c) => c.json({ settings: await customers.settings(sellerOf(c)) }))
  api.put('/customer-settings', async (c) => {
    const checked = checkCustomerSettings(body(c))
    if (!checked.ok) return rejected(checked)
    return c.json({ settings: await customers.saveSettings(sellerOf(c), checked.value) })
  })

  // 날짜별 구매자 목록 꼬리표·누적 (구매자 목록·콘솔 1등 옆 "입금 늦음 주의")
  api.get('/days/:date/customers', async (c) => {
    const scope = realDate(c)
    if (!scope.ok) return scope.response
    const view = await customers.dayCustomers(sellerOf(c), scope.date)
    return view === null ? notFound() : c.json(view)
  })
  // 구매자 자세히 "손님 기록" 칸·메모 칸 (?buyer=)
  api.get('/days/:date/customer', async (c) => {
    const scope = realDate(c)
    if (!scope.ok) return scope.response
    const buyer = buyerParam(c.req.query('buyer'))
    if (!buyer.ok) return apiError(buyer.error.status, buyer.error.code, buyer.error.message, buyer.error.problems ?? [])
    const view = await customers.dayCustomer(sellerOf(c), scope.date, buyer.buyer)
    return view === null ? notFound() : c.json(view)
  })

  // 모든 손님 (?sort=total|recent|unpaid&filter=all|regular|caution&q=&offset=)
  api.get('/customers', async (c) => {
    const sort = c.req.query('sort') ?? 'total'
    const filter = c.req.query('filter') ?? 'all'
    const q = c.req.query('q')
    const offsetText = c.req.query('offset') ?? '0'
    const problems: FieldProblem[] = []
    if (!(CUSTOMER_SORTS as readonly string[]).includes(sort)) problems.push({ field: 'sort', message: '정렬을 다시 골라 주세요.' })
    if (!(CUSTOMER_FILTERS as readonly string[]).includes(filter)) problems.push({ field: 'filter', message: '거르기를 다시 골라 주세요.' })
    if (!OFFSET_RE.test(offsetText)) problems.push({ field: 'offset', message: '더 보기 위치를 확인해 주세요.' })
    const needle = q === undefined ? '' : q.trim()
    if (needle !== '' && ([...needle].length > QUERY_MAX || hasUnsafeText(needle))) problems.push({ field: 'q', message: '찾을 말은 40자까지 글자로 적어 주세요.' })
    else if (needle !== '' && containsPhoneRun(needle)) problems.push({ field: 'q', message: PHONE_NUMBER_MESSAGE, hint: '이름이나 끝자리 4개로 찾아 주세요.' })
    if (problems.length > 0) return invalid(problems)
    return c.json(await customers.customers(sellerOf(c), { sort: sort as CustomerSort, filter: filter as CustomerFilter, q: needle === '' ? null : needle, offset: Number(offsetText) }))
  })
  // 손님 자세히 (?before=YYYY-MM-DD 다음 쪽)
  api.get('/customers/:id', async (c) => {
    const id = c.req.param('id')
    if (!CUSTOMER_ID_RE.test(id)) return notFound()
    const before = c.req.query('before')
    if (before !== undefined && !isValidDate(before)) return invalid([{ field: 'before', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    const view = await customers.customer(sellerOf(c), id, before ?? null)
    return view === null ? notFound() : c.json(view)
  })
  // 메모 저장 { text } — 바로 저장(5초 대기 조치 아님), 빈 글 = 지움
  api.put('/customers/:id/memo', async (c) => {
    const id = c.req.param('id')
    if (!CUSTOMER_ID_RE.test(id)) return notFound()
    const checked = checkMemo(body(c))
    if (!checked.ok) return rejected(checked)
    const saved = await customers.saveMemo(sellerOf(c), c.get('session').accountId, id, checked.value)
    return saved === null ? notFound() : c.json(saved)
  })
}
