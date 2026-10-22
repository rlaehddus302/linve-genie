// AI 확인 필요 제안 경로 (A1, AC-A1-02~10). 계약은 harness/sprints/A1/dev-notes.md "화면·시험에게".
// - GET  /api/assist/settings → { available, enabled, consentedAt, usedToday, dailyLimit }
// - PUT  /api/assist/settings { enabled, consent? } → 새 설정. 켜기는 consent: true가 있어야(없으면 400 CONSENT_REQUIRED), 키가 없으면 409 UNAVAILABLE. 끄기는 늘 된다
// - POST /api/assist/suggest { rehearsal, broadcast? } → { result, called }. 범위는 확인 필요 목록과 같다(다른 판매자·없는·리허설 구분이 다른 방송은 404). 이벤트를 만들지 않는다
// - 기존 /api 규칙(Origin·JSON·64KB·no-store·모르는 항목 400 UNKNOWN_FIELD)을 탄다. 보조자 세션은 roles.ts 허용 목록 밖이라 모두 403(처리기에 닿지 않는다).
// - 오류 응답에 받은 값·키·댓글 글을 담지 않는다.
import type { Context, Hono } from 'hono'
import { own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError } from '../errors.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { AssistService } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

export const ASSIST_CONSENT_MESSAGE = '안내를 읽고 동의해야 켤 수 있어요.'
export const ASSIST_UNAVAILABLE_MESSAGE = '지금은 쓸 수 없어요.'
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const invalid = (field: string, message: string) => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message }])

export function registerAssistRoutes(api: Hono<Env>, assist: AssistService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }

  api.get('/assist/settings', async (c) => c.json(await assist.view(sellerOf(c))))

  api.put('/assist/settings', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['enabled', 'consent'])
    if (extra !== null) return extra
    const enabled = own(input, 'enabled')
    const consent = own(input, 'consent')
    if (typeof enabled !== 'boolean') return invalid('enabled', '켤지 끌지 true·false로 보내 주세요.')
    if (consent !== undefined && typeof consent !== 'boolean') return invalid('consent', '동의는 true·false로 보내 주세요.')
    const outcome = await assist.update(sellerOf(c), enabled, consent === true)
    if (outcome.kind === 'unavailable') return apiError(409, 'UNAVAILABLE', ASSIST_UNAVAILABLE_MESSAGE)
    if (outcome.kind === 'consent_required') return apiError(400, 'CONSENT_REQUIRED', ASSIST_CONSENT_MESSAGE, [{ field: 'consent', message: ASSIST_CONSENT_MESSAGE }])
    return c.json(outcome.view)
  })

  api.post('/assist/suggest', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['rehearsal', 'broadcast'])
    if (extra !== null) return extra
    const rehearsal = own(input, 'rehearsal')
    const broadcast = own(input, 'broadcast')
    if (typeof rehearsal !== 'boolean') return invalid('rehearsal', '리허설 범위인지 true·false로 보내 주세요.')
    if (broadcast !== undefined && typeof broadcast !== 'string') return invalid('broadcast', '방송을 다시 골라 주세요.')
    if (typeof broadcast === 'string' && (broadcast === '' || broadcast.length > 64)) return notFound()
    const outcome = await assist.run(sellerOf(c), { rehearsal, ...(broadcast === undefined ? {} : { broadcast }) })
    return outcome === null ? notFound() : c.json(outcome)
  })
}
