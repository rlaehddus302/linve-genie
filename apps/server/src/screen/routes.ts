// 화면 일꾼 입구 `POST /internal/screen/register` (D-SCR-01): 운영자 맥(집 회선)에서 도는 화면 일꾼이
// 방송 화면 번호표(OCR) + 판매자 말(STT) + 규칙으로 확정한 상품을 등록한다. 로그인·Origin 검사 밖, 일꾼 토큰으로만.
// 받는 값: { videoId, no, price, name?, heard?, conf?, requestId } — 유튜브 영상 번호로 지금 이어진(끊지 않은·끝나지 않은) 방송을 찾는다.
// D-SCR-04: 같은 영상에 이어진 방송이 여럿이면(판매자 여럿이 같은 라이브를 이음 — 초대받은 방송, D-LV1-15와 같게) 그 방송 모두에 등록한다.
//   한 판매자는 한 영상을 방송 하나에만 잇는다(VIDEO_IN_USE) — 요청 번호는 판매자마다 한 번만이라(events_request_uq) 같은 요청을 다시 보내도 방송마다 한 번.
// 등록은 서버 단독 소리 등록(headless #register, D-LV1-14)과 같은 길: product.register + voiceLog(device livegenie-screen).
// 같은 번호가 이미 있으면 엔진이 바꾸지 않는다(R-2, changed false). 번호 바꾸기는 아래 /internal/screen/renumber(D-SCR-06)만.
import { getProduct } from '@livejjim/core'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { bearerMatches } from '../app.ts'
import type { Db } from '../db/database.ts'
import { broadcasts, events, youtubeLinks } from '../db/schema.ts'
import type { Service } from '../service.ts'

export interface ScreenIntakeDeps {
  /** 일꾼 토큰 (LIVEJJIM_SCREEN_WORKER_TOKEN, 32자 이상). null이면 입구가 없다(404) */
  readonly token: string | null
  readonly db: Db
  readonly service: Pick<Service, 'writeEvent' | 'writer'>
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
    const allowed = new Set(['videoId', 'no', 'price', 'name', 'heard', 'conf', 'requestId', 'observedAt'])
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

    const observedAt = b['observedAt']
    if (observedAt !== undefined && (typeof observedAt !== 'number' || !Number.isSafeInteger(observedAt) || observedAt < 1 || observedAt > Date.now() + 5000)) return bad('인식한 시각을 확인해 주세요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const voiceLog: Record<string, unknown> = { heard, source: 'voice', device: 'livegenie-screen', ...(conf === undefined ? {} : { conf }) }
    const results: { broadcastId: string; changed: boolean; duplicate: boolean }[] = []
    for (const { sellerId, broadcastId } of open) {
      const outcome = await deps.service.writeEvent(sellerId, { kind: 'server' }, requestId, { type: 'product.register', b: broadcastId, no, name, price, voiceLog }, undefined)
      let result = outcome.kind === 'phone' ? outcome.outcome : outcome
      if (typeof observedAt === 'number' && (result.kind === 'duplicate' || (result.kind === 'ok' && !result.result.changed))) {
        const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
        if (broadcast && getProduct((await deps.service.writer.read(sellerId, broadcast.date)).state, broadcastId, no)?.status === 'CLOSED') {
          const reopenId = requestId + '-open'
          let fresh = false
          const reopened = await deps.service.writer.write({ sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId: reopenId,
            guard: async (tx, runtime) => {
              if (runtime.scopeId === null) return null
              const [close] = await tx.select({ at: events.receivedAt }).from(events)
                .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), eq(events.type, 'product.close'), eq(events.changed, true),
                  sql`${events.body}::jsonb->>'b' = ${broadcastId}`, sql`${events.body}::jsonb->>'no' = ${String(no)}`)).orderBy(desc(events.seq)).limit(1)
              fresh = close !== undefined && observedAt > close.at.getTime()
              return null
            },
            build: ({ state }) => fresh && getProduct(state, broadcastId, no)?.status === 'CLOSED' ? [
              { fields: { type: 'product.update', b: broadcastId, no, name, price }, actor: { kind: 'server' }, requestId: reopenId },
              { fields: { type: 'product.open', b: broadcastId, no }, actor: { kind: 'server' } },
            ] : [],
          })
          if (reopened.kind !== 'empty') result = reopened
        }
      }
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
  // 잘못 들은 번호 바로잡기 `POST /internal/screen/renumber` (D-SCR-06, 사용자 2026-11-12 "391을 392로 잘못 알아먹고 등록했는데 … 화면 인식 통해서 392는 잘못된거라고 판정"):
  // 받는 값 { videoId, from, to, requestId }. 방송마다 기록 트랜잭션 안의 지금 상태로 다시 보고, 아래가 모두 맞을 때만 product.renumber(from → to):
  //   - from은 화면 일꾼이 등록한 상품(요청 번호 screen-…)이고 판매 종료가 아니며 옵션 상품이 아니고 1등·대기·충돌 찜이 없다 (찜이 있으면 사람이 본다)
  //   - to 번호에는 상품이 없다. 있으면: 일꾼이 `drop: true`(to를 from보다 뒤에 따로 등록했음 — 같은 상품을 두 번호로 들은 것)를 보냈을 때만 from을 판매 종료(지움), 아니면 그대로
  // 가격·품종은 그대로 따라가고, to로 들어와 있던 보류 찜은 번호를 바꾸는 순간 판정된다(R-10·R-5). 하나라도 안 맞으면 바꾸지 않고 까닭을 돌려준다.
  app.post('/internal/screen/renumber', async (c) => {
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
    if (Object.keys(b).some((k) => !['videoId', 'from', 'to', 'requestId', 'drop'].includes(k))) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, from, to, requestId } = b
    const drop = b['drop'] === true
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    const isNo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999
    if (!isNo(from) || !isNo(to) || from === to) return bad('from·to는 서로 다른 1~9999 정수예요.')
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const results: { broadcastId: string; changed: boolean; skip?: string }[] = []
    for (const { sellerId, broadcastId } of open) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      let byScreen = false
      let skip: string | undefined
      const outcome = await deps.service.writer.write({
        sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId,
        guard: async (tx, runtime) => {
          if (runtime.scopeId === null) return null
          const [row] = await tx.select({ requestId: events.requestId }).from(events)
            .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), eq(events.type, 'product.register'), eq(events.changed, true),
              sql`${events.body}::jsonb->>'b' = ${broadcastId}`, sql`${events.body}::jsonb->>'no' = ${String(from)}`)).orderBy(desc(events.seq)).limit(1)
          byScreen = row?.requestId?.startsWith('screen-') === true
          return null
        },
        build: ({ state }) => {
          const product = getProduct(state, broadcastId, from)
          if (product === null || product.status === 'CLOSED') skip = 'NO_PRODUCT'
          else if (!byScreen) skip = 'NOT_SCREEN'
          else if (product.hasOptions || product.winners.length > 0 || product.waitlist.length > 0 || product.conflict) skip = 'HAS_CLAIMS'
          else if (getProduct(state, broadcastId, to) !== null) {
            const target = getProduct(state, broadcastId, to)
            if (!drop || target === null || target.status === 'CLOSED') skip = 'TARGET_EXISTS'
            else return [{ fields: { type: 'product.close', b: broadcastId, no: from }, actor: { kind: 'server' }, requestId }]
          }
          return skip === undefined ? [{ fields: { type: 'product.renumber', b: broadcastId, from, to }, actor: { kind: 'server' }, requestId }] : []
        },
      })
      if (outcome.kind === 'ok') results.push({ broadcastId, changed: outcome.result.changed })
      else if (outcome.kind === 'empty' || outcome.kind === 'duplicate') results.push({ broadcastId, changed: false, ...(skip === undefined ? {} : { skip }) })
      else if (outcome.kind === 'rejected') results.push({ broadcastId, changed: false, skip: outcome.rejection.code })
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    return json({ ok: true, changed: results.some((r) => r.changed), from, to, broadcasts: results }, 200)
  })
  app.all('/internal/screen/renumber', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  // 품종 이름 고치기 `POST /internal/screen/rename` (D-SCR-07, 사용자 2026-11-12 "이름 고치기 만들어"): LLM이 처음엔 비우거나 틀렸다가(정개구리·상광)
  // 뒤 답에서 확실하게 맞춘 품종으로 바꾼다. 받는 값 { videoId, no, name, requestId }. 방송마다 지금 상태로 다시 보고,
  // 그 번호의 마지막 등록이 일꾼 것(요청 번호 screen-)이고 판매 종료가 아니며 판매자 계정이 그 번호의 이름을 고친 적이 없을 때만 product.update(name).
  // 판매자가 고친 이름은 절대 덮어쓰지 않는다. 이미 같은 이름이면 아무 일도 없다.
  app.post('/internal/screen/rename', async (c) => {
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
    if (Object.keys(b).some((k) => !['videoId', 'no', 'name', 'requestId'].includes(k))) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, no, name, requestId } = b
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 9999) return bad('no는 1~9999 정수예요.')
    if (typeof name !== 'string' || name.trim() === '' || [...name].length > NAME_MAX) return bad(`name은 1~${String(NAME_MAX)}자예요.`)
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const results: { broadcastId: string; changed: boolean; skip?: string }[] = []
    for (const { sellerId, broadcastId } of open) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      let byScreen = false
      let sellerNamed = false
      let skip: string | undefined
      const outcome = await deps.service.writer.write({
        sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId,
        guard: async (tx, runtime) => {
          if (runtime.scopeId === null) return null
          const ofNo = and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), sql`${events.body}::jsonb->>'b' = ${broadcastId}`, sql`${events.body}::jsonb->>'no' = ${String(no)}`)
          const [reg] = await tx.select({ requestId: events.requestId }).from(events)
            .where(and(ofNo, eq(events.type, 'product.register'), eq(events.changed, true))).orderBy(desc(events.seq)).limit(1)
          byScreen = reg?.requestId?.startsWith('screen-') === true
          const [edit] = await tx.select({ seq: events.seq }).from(events)
            .where(and(ofNo, eq(events.type, 'product.update'), eq(events.actor, 'account'), sql`${events.body}::jsonb ? 'name'`)).limit(1)
          sellerNamed = edit !== undefined
          return null
        },
        build: ({ state }) => {
          const product = getProduct(state, broadcastId, no)
          if (product === null || product.status === 'CLOSED') skip = 'NO_PRODUCT'
          else if (!byScreen) skip = 'NOT_SCREEN'
          else if (sellerNamed) skip = 'SELLER_NAMED'
          else if (product.name === name.trim()) skip = 'SAME'
          return skip === undefined ? [{ fields: { type: 'product.update', b: broadcastId, no, name: name.trim() }, actor: { kind: 'server' }, requestId }] : []
        },
      })
      if (outcome.kind === 'ok') results.push({ broadcastId, changed: outcome.result.changed })
      else if (outcome.kind === 'empty' || outcome.kind === 'duplicate') results.push({ broadcastId, changed: false, ...(skip === undefined ? {} : { skip }) })
      else if (outcome.kind === 'rejected') results.push({ broadcastId, changed: false, skip: outcome.rejection.code })
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    return json({ ok: true, changed: results.some((r) => r.changed), no, broadcasts: results }, 200)
  })
  app.all('/internal/screen/rename', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
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
