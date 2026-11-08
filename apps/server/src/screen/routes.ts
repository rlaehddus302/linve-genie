// 화면 일꾼 입구 `POST /internal/screen/register` (D-SCR-01): 운영자 맥(집 회선)에서 도는 화면 일꾼이
// 방송 화면 번호표(OCR) + 판매자 말(STT) + 규칙으로 확정한 상품을 등록한다. 로그인·Origin 검사 밖, 일꾼 토큰으로만.
// 받는 값: { videoId, no, price, name?, heard?, conf?, requestId } — 유튜브 영상 번호로 지금 이어진(끊지 않은·끝나지 않은) 방송을 찾는다.
// 등록은 서버 단독 소리 등록(headless #register, D-LV1-14)과 같은 길: product.register + voiceLog(device livegenie-screen).
// 같은 번호가 이미 있으면 엔진이 바꾸지 않는다(R-2, changed false). 고치기·번호 바꾸기는 하지 않는다(사람이 확인).
import { and, eq, isNull } from 'drizzle-orm'
import type { Hono } from 'hono'
import { bearerMatches } from '../app.ts'
import type { Db } from '../db/database.ts'
import { broadcasts, youtubeLinks } from '../db/schema.ts'
import type { Service } from '../service.ts'

export interface ScreenIntakeDeps {
  /** 일꾼 토큰 (LIVEJJIM_SCREEN_WORKER_TOKEN, 32자 이상). null이면 입구가 없다(404) */
  readonly token: string | null
  readonly db: Db
  readonly service: Pick<Service, 'writeEvent'>
}

const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
const REQUEST_RE = /^screen-[A-Za-z0-9_.:-]{1,100}$/
const HEARD_MAX = 300
const NAME_MAX = 60

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

const bad = (message: string) => json({ error: { code: 'BAD_REQUEST', message } }, 400)

/** 유튜브 영상 번호 → 지금 이어진 방송 (판매자 상관없이). 둘 이상이면 고르지 않는다 */
export async function openBroadcastsOfVideo(db: Db, videoId: string): Promise<{ sellerId: string; broadcastId: string }[]> {
  const rows = await db
    .select({ sellerId: youtubeLinks.sellerId, broadcastId: youtubeLinks.broadcastId })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
    .where(and(eq(youtubeLinks.videoId, videoId), isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt)))
  const seen = new Map<string, { sellerId: string; broadcastId: string }>()
  for (const row of rows) seen.set(`${row.sellerId}/${row.broadcastId}`, row)
  return [...seen.values()]
}

export function registerScreenIntake(app: Hono, deps: ScreenIntakeDeps): void {
  app.post('/internal/screen/register', async (c) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return bad('JSON이 아니에요.')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('JSON 객체여야 해요.')
    const b = body as Record<string, unknown>
    const allowed = new Set(['videoId', 'no', 'price', 'name', 'heard', 'conf', 'requestId'])
    if (Object.keys(b).some((k) => !allowed.has(k))) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, no, price, requestId } = b
    const name = b.name ?? ''
    const heard = b.heard ?? ''
    const conf = b.conf
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 9999) return bad('no는 1~9999 정수예요.')
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 100_000_000) return bad('price는 0~100,000,000 정수(원)예요.')
    if (typeof name !== 'string' || [...name].length > NAME_MAX) return bad(`name은 ${String(NAME_MAX)}자까지예요.`)
    if (typeof heard !== 'string' || [...heard].length > HEARD_MAX) return bad(`heard는 ${String(HEARD_MAX)}자까지예요.`)
    if (conf !== undefined && (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1)) return bad('conf는 0~1이에요.')
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')

    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    if (open.length > 1) return json({ error: { code: 'AMBIGUOUS', message: '이 영상에 이어진 방송이 여럿이에요.' } }, 409)
    const [{ sellerId, broadcastId }] = open as [{ sellerId: string; broadcastId: string }]

    const voiceLog: Record<string, unknown> = { heard, source: 'voice', device: 'livegenie-screen', ...(conf === undefined ? {} : { conf }) }
    const outcome = await deps.service.writeEvent(sellerId, { kind: 'server' }, requestId, { type: 'product.register', b: broadcastId, no, name, price, voiceLog }, undefined)
    const result = outcome.kind === 'phone' ? outcome.outcome : outcome
    if (result.kind === 'ok') return json({ ok: true, changed: result.result.changed, broadcastId, no }, 200)
    if (result.kind === 'duplicate') return json({ ok: true, changed: false, duplicate: true, broadcastId, no }, 200)
    if (result.kind === 'rejected') return json({ error: { code: result.rejection.code, message: result.rejection.message, problems: result.rejection.problems } }, result.rejection.status)
    if (result.kind === 'not_found') return json({ error: { code: 'NOT_FOUND', message: '방송을 찾지 못했어요.' } }, 404)
    return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
  })
  app.all('/internal/screen/register', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
}
