// 방송 리포트 경로 (SPEC RPT-01, KP1 AC-KP1-17~19). 판매자 계정만 — 보조자 허용 목록(roles.ts)에 넣지 않아 처리기에 닿기 전에 403이다.
// - 로그인·Cache-Control: no-store는 /api 공통 미들웨어가 한다. 다른 판매자의 날짜·리허설(?rehearsal=true)·실제 범위가 없는 날짜는 404.
// - 응답은 숫자만(손님 이름·연락처·표지 없음). 저장하지 않고 볼 때 계산한다.
import { isValidDate } from '@livejjim/core'
import type { Hono } from 'hono'
import type { SessionContext } from '../auth.ts'
import { apiError } from '../errors.ts'
import { LEDGER_UNREADABLE_MESSAGE } from '../sealed-state.ts'
import type { ReportService } from './service.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

export function registerReportRoutes(api: Hono<Env>, report: ReportService): void {
  api.get('/days/:date/report', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const rehearsal = c.req.query('rehearsal')
    if (rehearsal === 'true') return notFound()
    if (rehearsal !== undefined && rehearsal !== 'false') {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true, 실제 범위는 적지 않거나 rehearsal=false로 적어 주세요.' }])
    }
    const outcome = await report.report(c.get('session').sellerId, date)
    if (outcome.kind === 'not_found') return notFound()
    if (outcome.kind === 'unreadable') return apiError(500, 'LEDGER_UNREADABLE', LEDGER_UNREADABLE_MESSAGE)
    return c.json(outcome.view)
  })
}
