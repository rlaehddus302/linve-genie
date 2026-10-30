// 방송 일정·방송 알림 수 경로 (SPEC SCH-01~SCH-03, KP1 AC-KP1-20·23·26). 판매자 계정만 — 보조자 허용 목록(roles.ts)에 넣지 않아 처리기에 닿기 전에 403이다.
// - 로그인·Origin·JSON 객체·64KB 검사와 Cache-Control: no-store는 /api 공통 미들웨어가 한다. 다른 판매자의 일정은 없는 것과 같은 404.
// - 알림은 상태별 수만 낸다 — 번호 목록·내려받기·대신 넣기 경로가 없다. 문자를 보내는 경로도 없다.
// - 받은 값(제목·소개·주소)은 오류 응답·로그에 되돌려 보내지 않는다.
import type { Context, Hono } from 'hono'
import type { SessionContext } from '../auth.ts'
import { apiError, type FieldProblem } from '../errors.ts'
import { checkScheduleItem, checkSchedulePage, SCHEDULE_MESSAGES, type Checked } from './rules.ts'
import type { ItemOutcome, ScheduleService } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const ITEM_ID_RE = /^[0-9a-f]{32}$/
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

function rejected<T>(checked: Exclude<Checked<T>, { ok: true }>): Response {
  return checked.unknown
    ? apiError(400, 'UNKNOWN_FIELD', SCHEDULE_MESSAGES.unknown, checked.problems as FieldProblem[])
    : apiError(400, 'INVALID_INPUT', SCHEDULE_MESSAGES.invalid, checked.problems as FieldProblem[])
}

export function registerScheduleRoutes(api: Hono<Env>, schedule: ScheduleService): void {
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const answer = (c: Context<Env>, outcome: ItemOutcome) => {
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'full') return apiError(409, 'SCHEDULE_FULL', SCHEDULE_MESSAGES.full)
    return c.json(outcome.view)
  }
  /** 본문이 빈 객체여야 하는 요청 ({}) */
  const emptyBody = (c: Context<Env>) => {
    const extra = Object.keys(body(c))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', SCHEDULE_MESSAGES.unknown, [{ field: 'body', message: SCHEDULE_MESSAGES.unknown }])
  }

  api.get('/schedule', async (c) => c.json(await schedule.view(sellerOf(c))))
  api.put('/schedule/page', async (c) => {
    const checked = checkSchedulePage(body(c))
    if (!checked.ok) return rejected(checked)
    return c.json(await schedule.savePage(sellerOf(c), checked.value))
  })
  api.post('/schedule/page/renew', async (c) => {
    const bad = emptyBody(c)
    if (bad !== null) return bad
    return c.json(await schedule.renewPage(sellerOf(c)))
  })
  api.post('/schedule/items', async (c) => {
    const checked = checkScheduleItem(body(c), schedule.now())
    if (!checked.ok) return rejected(checked)
    return answer(c, await schedule.addItem(sellerOf(c), checked.value))
  })
  api.put('/schedule/items/:id', async (c) => {
    const id = c.req.param('id')
    if (!ITEM_ID_RE.test(id)) return notFound()
    const checked = checkScheduleItem(body(c), schedule.now())
    if (!checked.ok) return rejected(checked)
    return answer(c, await schedule.editItem(sellerOf(c), id, checked.value))
  })
  api.delete('/schedule/items/:id', async (c) => {
    const id = c.req.param('id')
    if (!ITEM_ID_RE.test(id)) return notFound()
    const bad = emptyBody(c)
    if (bad !== null) return bad
    return answer(c, await schedule.deleteItem(sellerOf(c), id))
  })
  api.get('/schedule/alerts', async (c) => c.json(await schedule.alertCounts(sellerOf(c))))
}
