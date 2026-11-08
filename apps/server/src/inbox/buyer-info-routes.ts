// 방송 뒤 손님 정보 문자 경로 (ORD-14, D-REAL-11) — /api 공통(세션·Origin·JSON·64KB) 뒤, 판매자 계정만.
// GET /api/buyer-info → { cards, buyers } · POST /api/buyer-info/:id/apply { date, buyer, name, phone, address, detail } → { card } · POST /api/buyer-info/:id/dismiss → { id }
import type { Context, Hono } from 'hono'
import { own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import type { Outcome } from '../closing.ts'
import { apiError } from '../errors.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { BuyerInfoService } from './buyer-info-service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const CARD_ID_RE = /^bi_[0-9a-f-]{36}$/
const APPLY_KEYS = ['date', 'buyer', 'name', 'phone', 'address', 'detail'] as const

export function registerBuyerInfoRoutes(api: Hono<Env>, buyerInfo: BuyerInfoService): void {
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const notFound = () => apiError(404, 'NOT_FOUND', '이 문자를 찾지 못했어요. 화면을 새로고침해 주세요.')
  const respond = <T>(c: Context<Env>, outcome: Outcome<T>, body: (value: T) => Record<string, unknown>): Response => {
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'error') return apiError(outcome.error.status, outcome.error.code, outcome.error.message, outcome.error.problems ?? [])
    return c.json(body(outcome.value))
  }

  api.get('/buyer-info', async (c) => c.json(await buyerInfo.list(sellerOf(c))))

  api.post('/buyer-info/:id/apply', async (c) => {
    const id = c.req.param('id')
    if (!CARD_ID_RE.test(id)) return notFound()
    const input = c.get('body') ?? {}
    const extra = ownKeys(input).filter((key) => !(APPLY_KEYS as readonly string[]).includes(key))
    if (extra.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    const values: Record<string, string> = {}
    for (const key of APPLY_KEYS) {
      const value = own(input, key)
      if (value === undefined || value === null) {
        values[key] = ''
        continue
      }
      if (typeof value !== 'string' || [...value].length > 200) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: key, message: '입력한 내용을 확인해 주세요.' }])
      values[key] = value
    }
    if (values.date === '' || values.buyer === '') return apiError(400, 'INVALID_INPUT', '손님을 골라 주세요.', [{ field: 'buyer', message: '손님을 골라 주세요.' }])
    const outcome = await buyerInfo.apply(sellerOf(c), id, {
      date: values.date as string,
      buyer: values.buyer as string,
      name: values.name as string,
      phone: values.phone as string,
      address: values.address as string,
      detail: values.detail as string,
    })
    return respond(c, outcome, (card) => ({ card }))
  })

  api.post('/buyer-info/:id/dismiss', async (c) => {
    const id = c.req.param('id')
    if (!CARD_ID_RE.test(id)) return notFound()
    const extra = ownKeys(c.get('body') ?? {})
    if (extra.length > 0) return apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    return respond(c, await buyerInfo.dismiss(sellerOf(c), id), (value) => value)
  })
}
