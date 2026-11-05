// 서버 읽기 입구 (SRV1 약속 1, D-APP-22~24, APP-05 AC10·AC12): 판매자가 친 글 원문 → 읽은 값. 저장·로그·이벤트를 남기지 않는다(읽기만, AC-SRV1-03).
// - POST /api/broadcasts/:id/read  { kind, text } — kind = quick·fix·price·money·received·phone. 그 방송(로그인한 판매자의 것만 — 아니면 404)의
//   설정 스냅샷(price.unit·claim.maxNumber)과 지금 상품으로 읽는다. fix의 text는 { no, name, price } 세 칸.
// - POST /api/read  { kind, text } — 방송과 무관한 칸만(money·received·phone — 정산·설정·문자찜 화면). quick·fix·price는 400.
// 상태를 바꾸는 요청과 같은 문을 지난다(Origin 403·JSON·본문 상한·세션 401). 글 한 칸은 2,000자까지(넘으면 400).
// 보조자 계정은 문자찜 화면 칸(received·phone)만 — 그 밖은 403 (roles.ts 허용 목록 + 여기서 kind).
// 받은 글은 오류 응답·로그에 담지 않는다. 응답: { read: <읽은 결과> } — 모양은 @livejjim/voice-session/read ReadResult.
import type { Hono } from 'hono'
import { BROADCAST_READ_KINDS, READ_KINDS, READ_TEXT_MAX, readText, type FixText, type ReadKind } from '@livejjim/voice-session/read'
import { isPlainObject, own, ownKeys } from './api-fields.ts'
import type { Env } from './api.ts'
import { apiError } from './errors.ts'
import { unknownFieldProblems } from './messages.ts'
import type { Service } from './service.ts'

/** 보조자가 읽을 수 있는 칸 (문자찜 화면) */
const TEXT_MESSAGE = `글자로 ${String(READ_TEXT_MAX)}자까지 적어 주세요.`

const invalid = (field: string, message: string) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message }])

const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= READ_TEXT_MAX && value.isWellFormed()

type ParsedRead = { ok: true; kind: ReadKind; text: string | FixText } | { ok: false; response: Response }

/** 본문 { kind, text } 검사 (받은 글은 되돌려 보내지 않는다) */
function parseReadBody(body: Record<string, unknown>): ParsedRead {
  const extra = ownKeys(body).filter((key) => key !== 'kind' && key !== 'text')
  if (extra.length > 0) return { ok: false, response: apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
  const kind = own(body, 'kind')
  if (typeof kind !== 'string' || !(READ_KINDS as readonly string[]).includes(kind)) return { ok: false, response: invalid('kind', '읽을 칸을 골라 주세요.') }
  const text = own(body, 'text')
  if (kind === 'fix') {
    if (!isPlainObject(text)) return { ok: false, response: invalid('text', '번호·품종·가격 칸을 함께 보내 주세요.') }
    const keys = ownKeys(text).filter((key) => key !== 'no' && key !== 'name' && key !== 'price')
    if (keys.length > 0) return { ok: false, response: apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(keys.map((key) => `text.${key}`))) }
    const form = { no: own(text, 'no') ?? '', name: own(text, 'name') ?? '', price: own(text, 'price') ?? '' }
    for (const [key, value] of Object.entries(form)) if (!isText(value)) return { ok: false, response: invalid(`text.${key}`, TEXT_MESSAGE) }
    return { ok: true, kind, text: form as FixText }
  }
  if (!isText(text)) return { ok: false, response: invalid('text', TEXT_MESSAGE) }
  return { ok: true, kind: kind as ReadKind, text }
}

export function registerReadRoutes(api: Hono<Env>, deps: { readonly service: Service }): void {
  api.post('/broadcasts/:id/read', async (c) => {
    const parsed = parseReadBody(c.get('body') ?? {})
    if (!parsed.ok) return parsed.response
    const session = c.get('session')
    const scope = await deps.service.readScope(session.sellerId, c.req.param('id'))
    if (scope === null) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
    const read = readText(parsed.kind, parsed.text, { settings: { 'price.unit': scope.settings['price.unit'], 'claim.maxNumber': scope.settings['claim.maxNumber'] }, findProduct: scope.findProduct, now: deps.service.now() })
    return c.json({ read })
  })

  api.post('/read', async (c) => {
    const parsed = parseReadBody(c.get('body') ?? {})
    if (!parsed.ok) return parsed.response
    if (BROADCAST_READ_KINDS.includes(parsed.kind)) return invalid('kind', '이 칸은 방송을 골라 읽어요.')
    return c.json({ read: readText(parsed.kind, parsed.text, { now: deps.service.now() }) })
  })
}
