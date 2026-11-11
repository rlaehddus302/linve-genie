// 화면 일꾼 입구 `POST /internal/screen/register` (D-SCR-01): 운영자 맥(집 회선)에서 도는 화면 일꾼이
// 방송 화면 번호표(OCR) + 판매자 말(STT) + 규칙으로 확정한 상품을 등록한다. 로그인·Origin 검사 밖, 일꾼 토큰으로만.
// 받는 값: { videoId, no, price, name?, heard?, conf?, requestId } — 유튜브 영상 번호로 지금 이어진(끊지 않은·끝나지 않은) 방송을 찾는다.
// D-SCR-04: 같은 영상에 이어진 방송이 여럿이면(판매자 여럿이 같은 라이브를 이음 — 초대받은 방송, D-LV1-15와 같게) 그 방송 모두에 등록한다.
//   한 판매자는 한 영상을 방송 하나에만 잇는다(VIDEO_IN_USE) — 요청 번호는 판매자마다 한 번만이라(events_request_uq) 같은 요청을 다시 보내도 방송마다 한 번.
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

/** 유튜브 영상 번호 → 지금 이어진 방송 (판매자 상관없이, 판매자·방송 순서로 늘 같은 순서) */
export async function openBroadcastsOfVideo(db: Db, videoId: string): Promise<{ sellerId: string; broadcastId: string }[]> {
  const rows = await db
    .select({ sellerId: youtubeLinks.sellerId, broadcastId: youtubeLinks.broadcastId })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
    .where(and(eq(youtubeLinks.videoId, videoId), isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt)))
  const seen = new Map<string, { sellerId: string; broadcastId: string }>()
  for (const row of rows) seen.set(`${row.sellerId}/${row.broadcastId}`, row)
  return [...seen.values()].sort((x, y) => (x.sellerId === y.sellerId ? (x.broadcastId < y.broadcastId ? -1 : 1) : x.sellerId < y.sellerId ? -1 : 1))
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
    const voiceLog: Record<string, unknown> = { heard, source: 'voice', device: 'livegenie-screen', ...(conf === undefined ? {} : { conf }) }
    const results: { broadcastId: string; changed: boolean; duplicate: boolean }[] = []
    for (const { sellerId, broadcastId } of open) {
      const outcome = await deps.service.writeEvent(sellerId, { kind: 'server' }, requestId, { type: 'product.register', b: broadcastId, no, name, price, voiceLog }, undefined)
      const result = outcome.kind === 'phone' ? outcome.outcome : outcome
      if (result.kind === 'ok') results.push({ broadcastId, changed: result.result.changed, duplicate: false })
      else if (result.kind === 'duplicate') results.push({ broadcastId, changed: false, duplicate: true })
      // 하나라도 못 넣으면 오류로 돌려준다 — 일꾼이 다시 보내도 넣은 방송은 같은 요청 번호라 한 번만 들어간다
      else if (result.kind === 'rejected') return json({ error: { code: result.rejection.code, message: result.rejection.message, problems: result.rejection.problems } }, result.rejection.status)
      else if (result.kind === 'not_found') return json({ error: { code: 'NOT_FOUND', message: '방송을 찾지 못했어요.' } }, 404)
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    const [first] = results as [{ broadcastId: string; changed: boolean; duplicate: boolean }]
    return json({ ok: true, changed: results.some((r) => r.changed), ...(results.every((r) => r.duplicate) ? { duplicate: true } : {}), broadcastId: first.broadcastId, no, broadcasts: results }, 200)
  })
  app.all('/internal/screen/register', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  // 지금 볼 라이브 (D-SCR-02): 일꾼이 30초마다 묻고, 목록에 생긴 영상에 붙고 빠진 영상에서 떨어진다 — 끊지 않은 연결 + 끝나지 않은 방송의 유튜브 영상 번호만(판매자 정보 없이)
  app.get('/internal/screen/live', async (c) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    return json({ videos: (await liveVideos(deps.db)).map((videoId) => ({ videoId })) }, 200)
  })
}

/** 지금 이어진 유튜브 영상 번호 (끊지 않은 연결·끝나지 않은 방송, 겹치면 하나) */
export async function liveVideos(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ videoId: youtubeLinks.videoId })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
    .where(and(isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt)))
  return rows.map((row) => row.videoId).filter((id): id is string => typeof id === 'string' && VIDEO_RE.test(id)).sort()
}
