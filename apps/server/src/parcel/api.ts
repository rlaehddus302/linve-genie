// /api/parcels 경로 (T1 택배 자동 접수 — PARCEL_RULES, acceptance AC-T1-07·13·22·23·30~37·43). 계약은 harness/sprints/T1/dev-notes.md "[server] API".
// - 로그인·Origin·JSON·64KB 검사는 /api 공통 미들웨어가 먼저 한다. 보조자 계정은 이 경로를 모두 403으로 받는다(roles.ts 허용 목록 밖 — 기본 거부, D-T1-14).
// - 다른 판매자의 날짜·구매자는 없는 것과 같은 404. 실제 범위만 — ?rehearsal=true인 쓰기와 리허설 범위만 있는 날짜의 쓰기는 409, 읽기는 404.
// - 받은 값(배송지 칸)은 오류 응답에 되돌려 보내지 않는다(문제에는 칸 이름·서버가 정한 문장·칸 코드만). 모든 응답은 Cache-Control: no-store(공통).
import { isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { buyerParam, type ApiProblem, type FileResult, type Outcome } from '../closing.ts'
import type { Db } from '../db/database.ts'
import { apiError } from '../errors.ts'
import { fileResponse } from '../files.ts'
import { unknownFieldProblems } from '../messages.ts'
import { scopeSeqs } from '../store.ts'
import { EPOST_ACTIONS, type EpostAction } from './epost-window.ts'
import { PARCEL_MESSAGES } from './rules.ts'
import { ParcelService } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.', [{ field: 'requestId', message: '화면을 새로고침한 뒤 다시 해 주세요.' }])
const problemResponse = (error: ApiProblem): Response => apiError(error.status, error.code, error.message, error.problems ?? [], error.extra ?? {})

export function registerParcelRoutes(api: Hono<Env>, parcels: ParcelService, db: Db): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const accountOf = (c: Context<Env>) => c.get('session').accountId
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) && !id.startsWith('dep-') ? id : null
  }
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const json = <T>(c: Context<Env>, outcome: Outcome<T>, wrap: (value: T) => Record<string, unknown>): Response => {
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    return c.json(wrap(outcome.value))
  }
  const fileOf = (outcome: Outcome<FileResult>): Response => {
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return problemResponse(outcome.error)
    const file = outcome.value
    return fileResponse(file.bytes, file.type, file.fileName, file.fallback, file.headers)
  }
  /** 날짜 경로 + ?rehearsal= (실제 범위만). 리허설이면 쓰기 409·읽기 404 */
  const dateOf = async (c: Context<Env>, write: boolean): Promise<{ ok: true; date: string } | { ok: false; response: Response }> => {
    const date = c.req.param('date') ?? ''
    if (!isValidDate(date)) return { ok: false, response: notFound() }
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal !== undefined && rehearsal !== 'true' && rehearsal !== 'false') {
      return { ok: false, response: apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'rehearsal', message: '택배는 실제 방송만 접수해요.' }]) }
    }
    if (rehearsal === 'true') return { ok: false, response: write ? apiError(409, 'REHEARSAL_PARCEL', PARCEL_MESSAGES.rehearsal) : notFound() }
    if (write) {
      // 리허설 범위만 있는 날짜: 실제 범위가 없어 404 대신 리허설 문장 (그 판매자 자신의 날짜만 본다)
      const rows = await scopeSeqs(db, sellerOf(c))
      if (!rows.some((row) => row.date === date && !row.rehearsal) && rows.some((row) => row.date === date && row.rehearsal)) return { ok: false, response: apiError(409, 'REHEARSAL_PARCEL', PARCEL_MESSAGES.rehearsal) }
    }
    return { ok: true, date }
  }
  const buyerOf = (value: unknown): { ok: true; buyer: string } | { ok: false; response: Response } => {
    const read = buyerParam(typeof value === 'string' ? value : undefined)
    return read.ok ? read : { ok: false, response: problemResponse(read.error) }
  }

  // ── 설정 "택배" (AC-T1-23) ───────────────────────────────────────────
  api.get('/parcels/settings', async (c) => c.json({ settings: await parcels.settings(sellerOf(c)) }))
  api.put('/parcels/settings', async (c) => json(c, await parcels.updateSettings(sellerOf(c), body(c)), (settings) => ({ settings })))

  // ── 날짜·목록 (AC-T1-22) ─────────────────────────────────────────────
  api.get('/parcels/days', async (c) => c.json(await parcels.days(sellerOf(c))))
  api.get('/parcels/days/:date', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    return json(c, await parcels.day(sellerOf(c), date.date), (day) => ({ ...day }))
  })

  // ── 묶음 자세히·배송지 (AC-T1-13) ────────────────────────────────────
  api.get('/parcels/days/:date/bundle', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    const buyer = buyerOf(c.req.query('buyer'))
    if (!buyer.ok) return buyer.response
    return json(c, await parcels.bundle(sellerOf(c), date.date, buyer.buyer), (bundle) => ({ bundle }))
  })
  // 배송지 적기·고치기: { requestId, buyer, address: { name, phone, address, detail, zip, memo } }
  api.put('/parcels/days/:date/address', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer', 'address'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.writeAddress(sellerOf(c), accountOf(c), date.date, requestId, buyer.buyer, own(input, 'address')), (bundle) => ({ bundle }))
  })
  // 배송지 확인: { requestId, buyer, updatedAt(묶음 자세히의 address.updatedAt 그대로) }
  api.post('/parcels/days/:date/address/confirm', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer', 'updatedAt'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const updatedAt = own(input, 'updatedAt')
    if (typeof updatedAt !== 'string' || updatedAt.length > 40) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'updatedAt', message: '본 배송지의 고친 시각을 보내 주세요.' }])
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.confirm(sellerOf(c), accountOf(c), date.date, requestId, buyer.buyer, updatedAt), (bundle) => ({ bundle }))
  })
  // KP1 장부 배송지 확인 (CR-4): { requestId, buyer, ledgerId, updatedAt(묶음 자세히의 ledger.updatedAt 그대로) }
  api.post('/parcels/days/:date/address/ledger', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer', 'ledgerId', 'updatedAt'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const ledgerId = own(input, 'ledgerId')
    if (typeof ledgerId !== 'string' || !/^[0-9a-f]{32}$/.test(ledgerId)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'ledgerId', message: '지난 주문 배송지를 다시 열어 주세요.' }])
    const updatedAt = own(input, 'updatedAt')
    if (typeof updatedAt !== 'string' || updatedAt.length > 40) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'updatedAt', message: '본 배송지의 고친 시각을 보내 주세요.' }])
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.confirmFromLedger(sellerOf(c), accountOf(c), date.date, requestId, buyer.buyer, ledgerId, updatedAt), (bundle) => ({ bundle }))
  })
  // 배송지 지우기: { requestId, buyer }
  api.post('/parcels/days/:date/address/delete', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.removeAddress(sellerOf(c), date.date, requestId, buyer.buyer), (bundle) => ({ bundle }))
  })

  // ── 직접 넣은 택배 (D-UX3-38): 방송 판매 기록 없이 받는 분을 적어 접수 목록에 넣는다 ─────
  // 넣기·고치기: { requestId, buyer?(고칠 줄 — extra:…), address: { name, phone, address, detail, zip, memo }, qty }. 답 { bundle }
  api.put('/parcels/days/:date/extra', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer', 'address', 'qty'])
    if (extra !== null) return extra
    const buyerRaw = own(input, 'buyer')
    let buyer: string | null = null
    if (buyerRaw !== undefined && buyerRaw !== null) {
      const read = buyerOf(buyerRaw)
      if (!read.ok) return read.response
      buyer = read.buyer
    }
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.upsertExtra(sellerOf(c), accountOf(c), date.date, requestId, buyer, own(input, 'address'), own(input, 'qty')), (bundle) => ({ bundle }))
  })
  // 지우기: { requestId, buyer }. 접수한 줄은 409(접수 취소가 먼저). 답 { buyer }
  api.post('/parcels/days/:date/extra/delete', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.removeExtra(sellerOf(c), date.date, requestId, buyer.buyer), (value) => ({ ...value }))
  })

  // ── 한 번에 접수·다시 확인·실패한 것만 다시 (AC-T1-30~34) ───────────────
  // { requestId, items: [{ buyer, box? }] } (1~200). 답 { date, results: [{ buyer, ok, invoice?, invoiceText?, reason?, message? }] }
  api.post('/parcels/days/:date/book', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const parsed = ParcelService.bookInput(input)
    if (!parsed.ok) return problemResponse(parsed.error)
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.book(sellerOf(c), accountOf(c), date.date, requestId, parsed.items), (value) => ({ date: date.date, ...value }))
  })

  // ── 접수 취소 (AC-T1-37): { requestId, buyer } ─────────────────────────
  api.post('/parcels/days/:date/cancel', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.cancel(sellerOf(c), accountOf(c), date.date, requestId, buyer.buyer), (bundle) => ({ bundle }))
  })

  // ── 우체국 창구소포 간편사전접수 (EP1 PC-9) ───────────────────────────
  // 앱 안 우체국 화면에 채울 값: ?buyer= (판매자 계정만 — 받는 분 원문이 든다)
  api.get('/parcels/days/:date/epost', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    const buyer = buyerOf(c.req.query('buyer'))
    if (!buyer.ok) return buyer.response
    return json(c, await parcels.epostFill(sellerOf(c), date.date, buyer.buyer), (value) => ({ ...value }))
  })
  // 기록 바꾸기: { requestId, buyer, action: FILLED | RECEIVED | CLEAR, receiptNo?(RECEIVED만) }. 같은 일을 다시 보내도 결과가 같다
  api.post('/parcels/days/:date/epost', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'buyer', 'action', 'receiptNo'])
    if (extra !== null) return extra
    const buyer = buyerOf(own(input, 'buyer'))
    if (!buyer.ok) return buyer.response
    const action = own(input, 'action')
    if (typeof action !== 'string' || !(EPOST_ACTIONS as readonly string[]).includes(action)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'action', message: '할 일을 다시 골라 주세요.' }])
    const receiptNo = own(input, 'receiptNo')
    if (action !== 'RECEIVED' && receiptNo !== undefined) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(['receiptNo']))
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.epostMark(sellerOf(c), accountOf(c), date.date, buyer.buyer, action as EpostAction, receiptNo ?? null), (value) => ({ ...value }))
  })
  // 우체국 주소 파일 (PC용 — 우체국 화면의 파일 접수에 올린다)
  api.get('/parcels/days/:date/epost-addresses.xlsx', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    return fileOf(await parcels.epostFile(sellerOf(c), date.date))
  })

  // ── 운송장 PDF (AC-T1-43) ────────────────────────────────────────────
  api.get('/parcels/days/:date/waybill.pdf', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    const buyer = buyerOf(c.req.query('buyer'))
    if (!buyer.ok) return buyer.response
    return fileOf(await parcels.waybill(sellerOf(c), date.date, buyer.buyer, c.req.raw.signal))
  })
  api.get('/parcels/days/:date/waybills.pdf', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    return fileOf(await parcels.waybill(sellerOf(c), date.date, null, c.req.raw.signal))
  })

  // ── 우체국 방문접수 파일 (D-UX3-36): 인터넷우체국 [파일(주소) 등록]에 올리는 엑셀 ─────
  api.get('/parcels/days/:date/epost-visit.xlsx', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    return fileOf(await parcels.epostVisitFile(sellerOf(c), date.date, c.req.raw.signal))
  })

  // ── 앱 안 우체국 화면 (D-UX3-37): 자동 채우기 자료, 직접 접수한 송장번호 적기 ─────
  api.get('/parcels/days/:date/epost-kit', async (c) => {
    const date = await dateOf(c, false)
    if (!date.ok) return date.response
    c.header('Cache-Control', 'no-store')
    return json(c, await parcels.epostKit(sellerOf(c), date.date, c.req.raw.signal), (kit) => ({ kit }))
  })
  // { requestId, kind: VISIT·COUNTER, items: [{ buyer, invoice }] } (1~200). 답은 한 번에 접수와 같은 { date, results }
  api.post('/parcels/days/:date/direct', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const parsed = ParcelService.directInput(input)
    if (!parsed.ok) return problemResponse(parsed.error)
    const date = await dateOf(c, true)
    if (!date.ok) return date.response
    return json(c, await parcels.recordDirect(sellerOf(c), accountOf(c), date.date, requestId, parsed.kind, parsed.items), (value) => ({ date: date.date, ...value }))
  })
}
