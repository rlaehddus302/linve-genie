// /api/print 경로 (I1, LABEL_RULES L-11, acceptance AC-I1-01~17). 계약은 harness/sprints/I1/dev-notes.md "dev-server > 화면(dev-web)에게".
// - 로그인·Origin·JSON·크기 검사는 /api 공통 미들웨어가 먼저 한다. 다른 판매자의 작업·방송은 없는 것과 같은 404다.
// - 받은 값은 오류 응답에 되돌려 보내지 않는다(문제에는 칸 이름과 서버가 정한 문장만).
// - 출력·다시 출력·포장 라벨 요청은 요청 번호(requestId)로 한 번만 만든다. 엔진 기록이 아니어서 5초 대기 없이 바로 처리된다.
// - 라벨 기능 켬/끔 (N4a, L-13): GET·PUT /api/settings/labels. 꺼져 있으면 출력을 새로 시작하거나 라벨을 새로 만드는 요청은 409 LABELS_OFF.
//   계약은 harness/sprints/N4a/dev-notes.md "dev-server > 바뀐 계약". 켬/끔 요청 본문·로그인 아이디는 로그에 남기지 않는다(NFR-06).
import { isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { REQUEST_ID_RE, hasControlChar, own, ownKeys } from './api-fields.ts'
import type { SessionContext } from './auth.ts'
import { apiError, type FieldProblem } from './errors.ts'
import { unknownFieldProblems } from './messages.ts'
import { DEVICE_ID_RE, PRINT_MESSAGES, cleanDeviceName, isKnownErrorCode, type ActionOutcome, type PrintService } from './print.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

/** 찜 ID·방송 ID (코어·서버가 만든 ID) */
const REF_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 작업 ID (효과 ID `<찜>:<종류>:<대상>:<확정버전>` 또는 서버가 만든 ID) */
const JOB_ID_RE = /^[A-Za-z0-9_:-]{1,200}$/
/** 구매자 ID (채널 ID·문자 구매자 ID) — 1~200자, 제어 문자 없음 */
const isBuyerId = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 200 && !hasControlChar(value)
const ITEM_RE = /^[a-z]{1,20}$/

const invalid = (problems: readonly FieldProblem[]) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.', [{ field: 'requestId', message: '화면을 새로고침한 뒤 다시 해 주세요.' }])

function outcome<T>(c: Context<Env>, result: ActionOutcome<T>): Response {
  if (result.kind === 'not_found') return notFound()
  if (result.kind === 'rejected') return apiError(result.rejection.status, result.rejection.code, result.rejection.message, result.rejection.problems, result.extra ?? {})
  return c.json(result.value as object)
}

export function registerPrintRoutes(api: Hono<Env>, print: PrintService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const accountOf = (c: Context<Env>) => c.get('session').accountId
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const deviceIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'deviceId')
    return typeof id === 'string' && DEVICE_ID_RE.test(id) ? id : null
  }
  const badDevice = () => invalid([{ field: 'deviceId', message: '이 기기를 알아보지 못했어요. 화면을 새로고침한 뒤 다시 해 주세요.' }])
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }
  /** 리허설 범위를 적은 조회 (?rehearsal=true) — 리허설에는 라벨이 없다 */
  const rehearsalQuery = (c: Context<Env>): Response | null | 'bad' => {
    const raw = c.req.query('rehearsal')
    if (raw === undefined || raw === 'false') return null
    if (raw === 'true') return apiError(422, 'PRINT_REHEARSAL', PRINT_MESSAGES.rehearsal)
    return 'bad'
  }

  // 앱은 서버가 만든 점을 그대로 보낸다. 다른 판매자·기기·끝난 시도는 조회 불가.
  const bitmapResponse = (value: Awaited<ReturnType<PrintService['jobBitmap']>>): Response => {
    if (value.kind === 'not_found') return notFound()
    if (value.kind === 'error') return apiError(422, 'LABEL_INVALID', value.error.message, [], { renderError: value.error })
    return new Response(JSON.stringify({ width: value.image.width, height: value.image.height, data: Buffer.from(value.image.data).toString('base64') }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
  api.get('/print/jobs/:id/bitmap', async (c) => {
    const device = c.req.query('device')
    const attempt = c.req.query('attempt')
    if (device === undefined || !DEVICE_ID_RE.test(device)) return badDevice()
    if (attempt === undefined || !/^[A-Za-z0-9_-]{8,64}$/.test(attempt)) return invalid([{ field: 'attempt', message: '시도 표를 확인해 주세요.' }])
    return bitmapResponse(await print.jobBitmap(sellerOf(c), device, attempt, c.req.param('id')))
  })
  api.get('/print/test-bitmap', async (c) => bitmapResponse(await print.testBitmap(sellerOf(c))))

  // 미리보기는 출력 시도와 별도인 읽기 전용 조회다. 이름·가격·구매자·템플릿은 클라이언트에서 받지 않는다.
  api.get('/print/preview/:kind', async (c) => {
    const date = c.req.query('date')
    const kind = c.req.param('kind')
    const ref = c.req.query('ref')
    if (date === undefined || !isValidDate(date)) return invalid([{ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    const rehearsal = rehearsalQuery(c)
    if (rehearsal === 'bad') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true로 적어 주세요.' }])
    if (rehearsal !== null) return rehearsal
    if (ref === undefined || (kind === 'product' ? !/^[A-Za-z0-9_-]{1,64}@[1-9][0-9]{0,8}$/.test(ref) : kind === 'packing' ? !isBuyerId(ref) : kind === 'job' ? !JOB_ID_RE.test(ref) : true)) return notFound()
    const value = kind === 'product' ? await print.previewProduct(sellerOf(c), date, ref) : kind === 'packing' ? await print.previewPacking(sellerOf(c), date, ref) : await print.previewWaitingJob(sellerOf(c), date, ref)
    if (value.kind === 'not_found') return notFound()
    if (value.kind === 'error') return apiError(422, 'LABEL_INVALID', value.error.message, [], { renderError: value.error })
    return new Response(JSON.stringify({ images: value.images.map((image) => ({ width: image.width, height: image.height, data: Buffer.from(image.data).toString('base64') })) }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  })

  // ── 라벨 기능 켬/끔 (N4a, RCP-01, L-13 1·2) — 판매 규칙 설정(/api/settings)과 따로 ──
  api.get('/settings/labels', async (c) => c.json(await print.labelSettings(sellerOf(c))))
  api.put('/settings/labels', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['enabled'])
    if (extra !== null) return extra
    const enabled = own(input, 'enabled')
    if (typeof enabled !== 'boolean') return invalid([{ field: 'enabled', message: PRINT_MESSAGES.labelsInvalid }])
    return c.json(await print.setLabels(sellerOf(c), accountOf(c), enabled))
  })

  // ── 조회 ─────────────────────────────────────────────────────────────────
  api.get('/print', async (c) => c.json(await print.overview(sellerOf(c))))

  api.get('/print/labels', async (c) => {
    const date = c.req.query('date')
    if (date === undefined || !isValidDate(date)) return invalid([{ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    const rehearsal = rehearsalQuery(c)
    if (rehearsal === 'bad') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true로 적어 주세요.' }])
    if (rehearsal !== null) return rehearsal
    const view = await print.labels(sellerOf(c), date)
    return view === null ? notFound() : c.json(view)
  })

  api.get('/print/packing', async (c) => {
    const date = c.req.query('date')
    const buyer = c.req.query('buyer')
    if (date === undefined || !isValidDate(date)) return invalid([{ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." }])
    if (!isBuyerId(buyer)) return invalid([{ field: 'buyer', message: '구매자를 골라 주세요.' }])
    const rehearsal = rehearsalQuery(c)
    if (rehearsal === 'bad') return invalid([{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true로 적어 주세요.' }])
    if (rehearsal !== null) return rehearsal
    const view = await print.packing(sellerOf(c), date, buyer)
    return view === null ? notFound() : c.json(view)
  })

  api.get('/print/templates', async (c) => c.json(await print.templates(sellerOf(c))))

  api.put('/print/templates/:kind', async (c) => {
    const kind = c.req.param('kind')
    if (kind !== 'product' && kind !== 'packing') return notFound()
    const input = body(c)
    const extra = onlyKeys(input, ['template', 'version'])
    if (extra !== null) return extra
    const version = own(input, 'version')
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return invalid([{ field: 'version', message: '읽은 라벨 설정의 판 번호를 0 이상의 정수로 적어 주세요.' }])
    return outcome(c, await print.saveTemplate(sellerOf(c), kind, own(input, 'template'), version))
  })

  // ── 출력 기기 (L-11 8·10) ──────────────────────────────────────────────
  api.post('/print/device', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['deviceId', 'name', 'replace'])
    if (extra !== null) return extra
    const deviceId = deviceIdOf(input)
    if (deviceId === null) return badDevice()
    const name = cleanDeviceName(own(input, 'name'))
    if (name === null) return invalid([{ field: 'name', message: '기기 이름은 1~20자로 적어 주세요.' }])
    const replace = own(input, 'replace')
    if (replace !== undefined && typeof replace !== 'boolean') return invalid([{ field: 'replace', message: '바꿀지는 예나 아니오로만 정할 수 있어요.' }])
    return outcome(c, await print.registerDevice(sellerOf(c), deviceId, name, replace === true))
  })

  api.post('/print/device/state', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['deviceId', 'connected'])
    if (extra !== null) return extra
    const deviceId = deviceIdOf(input)
    if (deviceId === null) return badDevice()
    const connected = own(input, 'connected')
    if (typeof connected !== 'boolean') return invalid([{ field: 'connected', message: '프린터 연결 여부는 예나 아니오로만 알려 주세요.' }])
    return outcome(c, await print.deviceState(sellerOf(c), deviceId, connected))
  })

  api.post('/print/device/release', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json(await print.releaseDevice(sellerOf(c)))
  })

  api.post('/print/pause', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json(await print.pause(sellerOf(c)))
  })

  api.post('/print/restart', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return outcome(c, await print.restart(sellerOf(c)))
  })

  // ── 받기·결과 (L-11 4·6·7) ─────────────────────────────────────────────
  api.post('/print/claim', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['deviceId'])
    if (extra !== null) return extra
    const deviceId = deviceIdOf(input)
    if (deviceId === null) return badDevice()
    const claimed = await print.claim(sellerOf(c), deviceId)
    if (claimed.kind === 'labels_off') return apiError(409, 'LABELS_OFF', PRINT_MESSAGES.labelsOff)
    if (claimed.kind === 'not_device') return apiError(409, 'PRINT_NOT_DEVICE', PRINT_MESSAGES.notDevice)
    if (claimed.kind === 'none') return c.json({ job: null, reason: claimed.reason })
    return c.json({ job: claimed.job })
  })

  api.post('/print/result', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['deviceId', 'attempt', 'ok', 'error'])
    if (extra !== null) return extra
    const deviceId = deviceIdOf(input)
    if (deviceId === null) return badDevice()
    const attempt = own(input, 'attempt')
    if (typeof attempt !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(attempt)) return invalid([{ field: 'attempt', message: '시도 표를 확인해 주세요.' }])
    const ok = own(input, 'ok')
    if (typeof ok !== 'boolean') return invalid([{ field: 'ok', message: '출력했는지는 예나 아니오로만 알려 주세요.' }])
    const error = own(input, 'error')
    let result: { ok: true } | { ok: false; code: string; item: string | null }
    if (ok) {
      if (error !== undefined) return invalid([{ field: 'error', message: '출력했으면 오류를 적지 않아요.' }])
      result = { ok: true }
    } else {
      if (typeof error !== 'object' || error === null || Array.isArray(error)) return invalid([{ field: 'error', message: '오류 코드를 적어 주세요.' }])
      const record = error as Record<string, unknown>
      const unknown = ownKeys(record).filter((key) => key !== 'code' && key !== 'item')
      if (unknown.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', [{ field: 'error', message: '받을 수 없는 항목이 있어요.' }])
      const code = own(record, 'code')
      const item = own(record, 'item')
      if (!isKnownErrorCode(code)) return invalid([{ field: 'error.code', message: '알 수 없는 오류 코드예요.' }])
      if (item !== undefined && (typeof item !== 'string' || !ITEM_RE.test(item))) return invalid([{ field: 'error.item', message: '항목을 확인해 주세요.' }])
      result = { ok: false, code, item: code === 'DOES_NOT_FIT' && typeof item === 'string' ? item : null }
    }
    const recorded = await print.result(sellerOf(c), deviceId, attempt, result)
    if (recorded.kind === 'not_found') return notFound()
    if (recorded.kind === 'save_failed') return apiError(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    return c.json({ recorded: recorded.recorded })
  })

  // ── 판매자 조치 (L-11 3·9·12) ──────────────────────────────────────────
  api.post('/print/labels/print', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'b', 'claim'])
    if (extra !== null) return extra
    const b = own(input, 'b')
    const claim = own(input, 'claim')
    const problems: FieldProblem[] = []
    if (typeof b !== 'string' || !REF_RE.test(b)) problems.push({ field: 'b', message: '방송을 골라 주세요.' })
    if (typeof claim !== 'string' || !REF_RE.test(claim)) problems.push({ field: 'claim', message: '찜을 골라 주세요.' })
    if (problems.length > 0) return invalid(problems)
    return outcome(c, await print.printLabel(sellerOf(c), accountOf(c), requestId, b as string, claim as string))
  })

  api.post('/print/labels/reprint', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'b', 'claim', 'version'])
    if (extra !== null) return extra
    const b = own(input, 'b')
    const claim = own(input, 'claim')
    const version = own(input, 'version')
    const problems: FieldProblem[] = []
    if (typeof b !== 'string' || !REF_RE.test(b)) problems.push({ field: 'b', message: '방송을 골라 주세요.' })
    if (typeof claim !== 'string' || !REF_RE.test(claim)) problems.push({ field: 'claim', message: '찜을 골라 주세요.' })
    if (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)) problems.push({ field: 'version', message: '확정버전은 1 이상의 정수로 적어 주세요.' })
    if (problems.length > 0) return invalid(problems)
    return outcome(c, await print.reprintLabel(sellerOf(c), accountOf(c), requestId, b as string, claim as string, typeof version === 'number' ? version : null))
  })

  api.post('/print/packing', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'date', 'buyer', 'rehearsal'])
    if (extra !== null) return extra
    const date = own(input, 'date')
    const buyer = own(input, 'buyer')
    const rehearsal = own(input, 'rehearsal')
    const problems: FieldProblem[] = []
    if (!isValidDate(date)) problems.push({ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." })
    if (!isBuyerId(buyer)) problems.push({ field: 'buyer', message: '구매자를 골라 주세요.' })
    if (rehearsal !== undefined && typeof rehearsal !== 'boolean') problems.push({ field: 'rehearsal', message: '리허설인지는 예나 아니오로만 정할 수 있어요.' })
    if (problems.length > 0) return invalid(problems)
    if (rehearsal === true) return apiError(422, 'PRINT_REHEARSAL', PRINT_MESSAGES.rehearsal)
    return outcome(c, await print.printPacking(sellerOf(c), accountOf(c), requestId, date as string, buyer as string))
  })

  const jobRef = (input: Record<string, unknown>): { date: string; id: string } | Response => {
    const date = own(input, 'date')
    const id = own(input, 'id')
    const problems: FieldProblem[] = []
    if (!isValidDate(date)) problems.push({ field: 'date', message: "날짜는 '2026-10-18'처럼 적어 주세요." })
    if (typeof id !== 'string' || !JOB_ID_RE.test(id)) problems.push({ field: 'id', message: '작업을 골라 주세요.' })
    return problems.length > 0 ? invalid(problems) : { date: date as string, id: id as string }
  }

  api.post('/print/jobs/cancel', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['date', 'id'])
    if (extra !== null) return extra
    const ref = jobRef(input)
    if (ref instanceof Response) return ref
    return outcome(c, await print.cancelJob(sellerOf(c), ref.date, ref.id))
  })

  api.post('/print/jobs/cancel-all', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['confirm'])
    if (extra !== null) return extra
    if (own(input, 'confirm') !== true) return apiError(400, 'PRINT_CONFIRM_REQUIRED', PRINT_MESSAGES.confirmRequired)
    return c.json(await print.cancelAll(sellerOf(c)))
  })

  api.post('/print/jobs/discard', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['date', 'id'])
    if (extra !== null) return extra
    const ref = jobRef(input)
    if (ref instanceof Response) return ref
    return outcome(c, await print.discard(sellerOf(c), accountOf(c), ref.date, ref.id))
  })
}
