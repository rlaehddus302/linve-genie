// 화면 일꾼 입구 `POST /internal/screen/register` (D-SCR-01): 운영자 맥(집 회선)에서 도는 화면 일꾼이
// 방송 화면 번호표(OCR) + 판매자 말(STT) + 규칙으로 확정한 상품을 등록한다. 로그인·Origin 검사 밖, 일꾼 토큰으로만.
// 받는 값: { videoId, no, price, name?, pieces?(품종에서 떼어 낸 개수 1~99, D-PIECES-01), heard?, conf?, requestId } — 유튜브 영상 번호로 지금 이어진(끊지 않은·끝나지 않은) 방송을 찾는다.
// D-SCR-04: 같은 영상에 이어진 방송이 여럿이면(판매자 여럿이 같은 라이브를 이음 — 초대받은 방송, D-LV1-15와 같게) 그 방송 모두에 등록한다.
//   한 판매자는 한 영상을 방송 하나에만 잇는다(VIDEO_IN_USE) — 요청 번호는 판매자마다 한 번만이라(events_request_uq) 같은 요청을 다시 보내도 방송마다 한 번.
// 등록은 서버 단독 소리 등록(headless #register, D-LV1-14)과 같은 길: product.register + voiceLog(device livegenie-screen).
// 같은 번호가 이미 있으면 엔진이 바꾸지 않는다(R-2, changed false). 번호 바꾸기는 아래 /internal/screen/renumber(D-SCR-06)만.
// 임시 등록 (D-RETRO-82, 복기 A2·B2): 등록에 `tentative: { reasons, candidates? }`를 실으면 확인 중(공개 전)으로 올린다 — 찜은 보류로 받고
//   감사 채팅·라벨은 확정 뒤에만 나간다. 근거가 모이면 /internal/screen/confirm, 아니면 /internal/screen/withdraw. 싣지 않은 등록은 지금처럼 바로 판매 중(옛 일꾼).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBroadcast, getProduct, type ProductInfo } from '@livejjim/core'
import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import { bearerMatches } from '../app.ts'
import type { Db } from '../db/database.ts'
import { broadcasts, events, youtubeLinks } from '../db/schema.ts'
import type { Service } from '../service.ts'
import { carriedBy } from './catalog.ts'

export interface ScreenIntakeDeps {
  /** 일꾼 토큰 (LIVEJJIM_SCREEN_WORKER_TOKEN, 32자 이상). null이면 입구가 없다(404) */
  readonly token: string | null
  readonly db: Db
  readonly service: Pick<Service, 'writeEvent' | 'writer' | 'endBroadcast'>
  /** D-SCR-11: 판매 종료한 번호를 일꾼 등록이 다시 열려면 일꾼이 그 말을 본 시각이 종료보다 이만큼 뒤여야 한다(기본 60초).
   *  받아쓰기가 말보다 20~90초 늦어서, 종료 직후 도착한 것은 대개 종료 전에 한 말이다(394 리마인드를 지운 7초 뒤 로라클론으로 다시 열림) */
  readonly reopenGraceMs?: number
  /** 지금 운영 중인 서버 판(커밋) — `GET /internal/screen/capabilities`가 돌려준다. 없으면 배포가 남긴 파일에서 읽는다(deployedCommit) */
  readonly commit?: () => Promise<string | null>
}

/**
 * 일꾼 입구와 각 입구가 받는 항목 (D-RETRO-32). 요청 검사와 `GET /internal/screen/capabilities` 응답이 **같은 표**를 쓴다 —
 * 입구나 항목을 더하면 여기에 더한다. 그래야 일꾼이 "서버가 이 요청·이 항목을 받는가"를 물었을 때 답이 실제 검사와 어긋나지 않는다
 * (2026-11-12 방송: 일꾼이 서버보다 8분 33초 먼저 새 판이 돼 금액 고치기·번호 바꾸기 4건이 400·405로 거절됐다).
 */
export const SCREEN_ENDPOINTS = {
  register: { method: 'POST', path: '/internal/screen/register', fields: ['videoId', 'no', 'price', 'name', 'heard', 'conf', 'requestId', 'observedAt', 'tentative', 'pieces'] },
  confirm: { method: 'POST', path: '/internal/screen/confirm', fields: ['videoId', 'no', 'requestId', 'registerRequestId', 'to', 'price', 'name', 'pieces'] },
  withdraw: { method: 'POST', path: '/internal/screen/withdraw', fields: ['videoId', 'no', 'requestId', 'registerRequestId'] },
  renumber: { method: 'POST', path: '/internal/screen/renumber', fields: ['videoId', 'from', 'to', 'requestId', 'drop', 'registerRequestId'] },
  rename: { method: 'POST', path: '/internal/screen/rename', fields: ['videoId', 'no', 'name', 'requestId'] },
  reprice: { method: 'POST', path: '/internal/screen/reprice', fields: ['videoId', 'no', 'price', 'requestId'] },
  'end-stale': { method: 'POST', path: '/internal/screen/end-stale', fields: ['videoId'] },
  live: { method: 'GET', path: '/internal/screen/live', fields: [] },
  capabilities: { method: 'GET', path: '/internal/screen/capabilities', fields: [] },
} as const satisfies Record<string, { method: 'GET' | 'POST'; path: string; fields: readonly string[] }>

/** 그 입구가 받지 않는 항목이 하나라도 있나 */
const hasUnknownField = (endpoint: keyof typeof SCREEN_ENDPOINTS, body: object): boolean => {
  const fields: readonly string[] = SCREEN_ENDPOINTS[endpoint].fields
  return Object.keys(body).some((k) => !fields.includes(k))
}

/** 일꾼이 품종 이름에서 떼어 낸 개수 ("채홍 3개" → 3, D-PIECES-01): 1~99 정수만. 적지 않았으면 undefined, 틀렸으면 null */
const piecesOf = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99 ? value : null

const COMMIT_RE = /^[0-9a-f]{7,40}$/

/**
 * 지금 운영 중인 서버 판(커밋). 배포(scripts/deploy/lg-apply.sh)가 새 판을 올리고 건강 확인까지 끝낸 뒤
 * `<LIVEJJIM_APP_UPDATES_DIR>/server-commit`에 한 줄로 적는다 — 그 폴더는 "내보내기가 쓰고 서버는 읽기만 하는" 폴더라 같이 쓴다(D-RETRO-32).
 * 컨테이너 환경값으로 넣지 않는 까닭: 환경값이 바뀌면 이미지가 같아도 컨테이너가 다시 켜진다(끊김 9~10초).
 * 파일이 없거나(내 컴퓨터·시험) 모양이 이상하면 null.
 */
export async function deployedCommit(dir: string | undefined = process.env['LIVEJJIM_APP_UPDATES_DIR']): Promise<string | null> {
  if (dir === undefined || dir.trim() === '') return null
  try {
    const text = (await readFile(join(dir.trim(), 'server-commit'), 'utf8')).trim()
    return COMMIT_RE.test(text) ? text : null
  } catch {
    return null
  }
}

const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
const REQUEST_RE = /^screen-[A-Za-z0-9_.:-]{1,100}$/
const HEARD_MAX = 300
const NAME_MAX = 60

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

const bad = (message: string) => json({ error: { code: 'BAD_REQUEST', message } }, 400)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 등록 요청의 임시 등록 칸 `{ reasons, candidates? }` → 엔진의 확인 중 칸 (올린 쪽은 서버가 WORKER로 적는다).
 * 모양만 본다 — 까닭 낱말·후보의 개수와 값은 코어 기록 전 검사가 본다(틀리면 그 문장으로 400). 모양이 틀리면 null
 */
function tentativeOfRequest(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'reasons' && key !== 'candidates')) return null
  if (!Array.isArray(value['reasons'])) return null
  const candidates = value['candidates']
  if (candidates !== undefined && !isRecord(candidates)) return null
  return { by: 'WORKER', reasons: value['reasons'], ...(candidates === undefined ? {} : { candidates }) }
}

/**
 * 확인 중 상품을 만든 등록과 그 뒤 판매자가 손댄 칸 (기록 트랜잭션 안, D-RETRO-82).
 * - 만든 등록: 확인 중 표시에 적힌 순번의 이벤트. 일꾼이 직접 넣었거나(요청 번호 screen-), 계정을 처음 맞출 때 다른 계정의 일꾼 값을 옮겨 넣은 등록(D-RETRO-10)
 * - 판매자가 손댄 칸: 그 뒤 판매자 계정이(또는 판매자 고침을 옮긴 상품 목록이) 그 번호의 품종·금액을 고쳤거나 그 번호로 옮겼다
 */
async function tentativeFacts(tx: Db, sellerId: string, scopeId: string, broadcastId: string, product: ProductInfo & { tentative: NonNullable<ProductInfo['tentative']> }) {
  const inScope = and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId))
  const [made] = await tx.select({ requestId: events.requestId }).from(events).where(and(inScope, eq(events.seq, product.tentative.seq), eq(events.type, 'product.register'))).limit(1)
  const madeBy = made?.requestId ?? null
  const carriedWorker = (await carriedBy(tx, madeBy, 'price')) === 'worker'
  const later = and(inScope, sql`${events.seq} > ${product.tentative.seq}`, eq(events.changed, true), sql`${events.body}::jsonb->>'b' = ${broadcastId}`, or(eq(events.actor, 'account'), sql`${events.requestId} like 'catalog-%'`))
  const edits = await tx.select({ type: events.type, actor: events.actor, requestId: events.requestId, body: events.body }).from(events)
    .where(and(later, or(
      and(eq(events.type, 'product.update'), sql`${events.body}::jsonb->>'no' = ${String(product.no)}`),
      and(eq(events.type, 'product.renumber'), sql`${events.body}::jsonb->>'to' = ${String(product.no)}`),
    )))
  const touched = { name: false, price: false, number: false }
  for (const edit of edits) {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(edit.body) as Record<string, unknown>
    } catch {
      continue
    }
    const human = async (field: 'name' | 'price') => edit.actor === 'account' || (await carriedBy(tx, edit.requestId, field)) !== 'worker'
    if (edit.type === 'product.renumber') touched.number ||= await human('name')
    else {
      // 개수(D-PIECES-01)는 품종에 딸린 값으로 센다
      if (body['name'] !== undefined || body['pieces'] !== undefined) touched.name ||= await human('name')
      if (body['price'] !== undefined) touched.price ||= await human('price')
    }
  }
  return { madeBy, carriedWorker, touched }
}

/** 확정·거두기를 할 수 없는 까닭 (없으면 undefined): 상품 없음 · 확인 중 아님 · 일꾼이 올린 것이 아님 · 일꾼이 방금 보낸 그 등록이 아님 */
function tentativeSkip(product: ProductInfo | null, facts: Awaited<ReturnType<typeof tentativeFacts>> | null, registerRequestId: string): string | undefined {
  if (product === null || product.status === 'CLOSED') return 'NO_PRODUCT'
  if (product.tentative === undefined) return 'NOT_TENTATIVE'
  if (facts === null) return 'NO_PRODUCT'
  if (facts.carriedWorker) return undefined
  if (facts.madeBy?.startsWith('screen-') !== true) return 'NOT_SCREEN'
  return facts.madeBy === registerRequestId ? undefined : 'OTHER_REGISTER'
}

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
    if (hasUnknownField('register', b)) return bad('받을 수 없는 항목이 있어요.')
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
    const pieces = piecesOf(b['pieces'])
    if (pieces === null) return bad('pieces는 1~99 정수예요.')
    const withPieces = pieces === undefined ? {} : { pieces }

    const observedAt = b['observedAt']
    if (observedAt !== undefined && (typeof observedAt !== 'number' || !Number.isSafeInteger(observedAt) || observedAt < 1 || observedAt > Date.now() + 5000)) return bad('인식한 시각을 확인해 주세요.')
    // 임시 등록 (D-RETRO-82): 확인 중으로 올린다. 싣지 않으면(옛 일꾼) 지금처럼 바로 판매 중
    const tentative = b['tentative'] === undefined ? undefined : tentativeOfRequest(b['tentative'])
    if (tentative === null) return bad('tentative는 { reasons, candidates? } 모양이에요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const voiceLog: Record<string, unknown> = { heard, source: 'voice', device: 'livegenie-screen', ...(conf === undefined ? {} : { conf }) }
    const results: { broadcastId: string; changed: boolean; duplicate: boolean; tentative?: true; skip?: string }[] = []
    for (const { sellerId, broadcastId } of open) {
      const outcome = await deps.service.writeEvent(sellerId, { kind: 'server' }, requestId, { type: 'product.register', b: broadcastId, no, name, price, ...withPieces, voiceLog }, undefined, undefined, tentative === undefined ? undefined : { tentative })
      let result = outcome.kind === 'phone' ? outcome.outcome : outcome
      // 임시 등록은 판매 종료한 번호를 다시 열지 않는다 — 다시 열면 확인 없이 바로 판매 중이 된다. 일꾼은 근거가 모인 뒤 임시 칸 없는 등록(observedAt)으로 다시 보낸다
      if (tentative !== undefined && (result.kind === 'duplicate' || (result.kind === 'ok' && !result.result.changed))) {
        const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
        const closed = broadcast !== undefined && getProduct((await deps.service.writer.read(sellerId, broadcast.date)).state, broadcastId, no)?.status === 'CLOSED'
        results.push({ broadcastId, changed: false, duplicate: result.kind === 'duplicate', ...(closed ? { skip: 'CLOSED' } : {}) })
        continue
      }
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
              fresh = close !== undefined && observedAt > close.at.getTime() + (deps.reopenGraceMs ?? 60_000)
              return null
            },
            build: ({ state }) => fresh && getProduct(state, broadcastId, no)?.status === 'CLOSED' ? [
              { fields: { type: 'product.update', b: broadcastId, no, name, price, ...withPieces }, actor: { kind: 'server' }, requestId: reopenId },
              { fields: { type: 'product.open', b: broadcastId, no }, actor: { kind: 'server' } },
            ] : [],
          })
          if (reopened.kind !== 'empty') result = reopened
        }
      }
      if (result.kind === 'ok') results.push({ broadcastId, changed: result.result.changed, duplicate: false, ...(tentative !== undefined && result.result.changed ? { tentative: true as const } : {}) })
      else if (result.kind === 'duplicate') results.push({ broadcastId, changed: false, duplicate: true })
      // 하나라도 못 넣으면 오류로 돌려준다 — 일꾼이 다시 보내도 넣은 방송은 같은 요청 번호라 한 번만 들어간다
      else if (result.kind === 'rejected') return json({ error: { code: result.rejection.code, message: result.rejection.message, problems: result.rejection.problems } }, result.rejection.status)
      else if (result.kind === 'not_found') return json({ error: { code: 'NOT_FOUND', message: '방송을 찾지 못했어요.' } }, 404)
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    const [first] = results as [{ broadcastId: string; changed: boolean; duplicate: boolean }]
    return json({ ok: true, changed: results.some((r) => r.changed), ...(results.every((r) => r.duplicate) ? { duplicate: true } : {}), ...(results.some((r) => r.tentative) ? { tentative: true } : {}), broadcastId: first.broadcastId, no, broadcasts: results }, 200)
  })
  app.all('/internal/screen/register', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  // 임시 등록 확정 `POST /internal/screen/confirm` · 거두기 `POST /internal/screen/withdraw` (D-RETRO-82, 복기 A2·B2 "근거가 둘 모이면 확정"):
  // 받는 값 { videoId, no, registerRequestId, requestId } + 확정은 최종 값 { to?, price?, name? }(적지 않은 칸은 지금 값).
  // 방송마다 기록 트랜잭션 안의 지금 상태로 다시 보고, 아래가 모두 맞을 때만 product.confirm · product.withdraw:
  //   - 그 번호의 상품이 확인 중이다 (판매자가 이미 확정·공개했으면 NOT_TENTATIVE — 일꾼이 판매자가 확정한 값을 덮지 않는다)
  //   - 그 상품을 만든 등록이 일꾼이 방금 보낸 그 등록(registerRequestId)이다. 다른 계정의 손 등록이 동기화로 들어온 확인 중 상품은 일꾼이 확정하지 못한다(NOT_SCREEN)
  //   - 확정: 판매자가 그사이 고친 칸(품종·금액·번호)은 판매자 값 그대로 두고 나머지만 일꾼 값으로 확정한다(응답 kept). 옮길 번호에 상품이 있으면 TARGET_EXISTS
  //   - 거두기: 판매자가 그사이 손댄 상품은 거두지 않는다(SELLER_EDITED)
  // 확정하면 그 번호(최종 번호)로 기다리던 찜이 도착 순서대로 확정 시점의 값으로 판정되고 그때 감사 채팅·라벨이 나간다(R-5·R-13).
  const settle = (kind: 'confirm' | 'withdraw') => async (c: Context) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return bad('JSON이 아니에요.')
    }
    if (!isRecord(body)) return bad('JSON 객체여야 해요.')
    if (hasUnknownField(kind, body)) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, no, requestId, registerRequestId } = body
    const isNo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    if (!isNo(no)) return bad('no는 1~9999 정수예요.')
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')
    if (typeof registerRequestId !== 'string' || !REQUEST_RE.test(registerRequestId)) return bad('registerRequestId는 screen-로 시작해야 해요.')
    const to = kind === 'confirm' ? body['to'] : undefined
    const price = kind === 'confirm' ? body['price'] : undefined
    const name = kind === 'confirm' ? body['name'] : undefined
    if (to !== undefined && !isNo(to)) return bad('to는 1~9999 정수예요.')
    if (price !== undefined && (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 100_000_000)) return bad('price는 0~100,000,000 정수(원)예요.')
    if (name !== undefined && (typeof name !== 'string' || [...name].length > NAME_MAX)) return bad(`name은 ${String(NAME_MAX)}자까지예요.`)
    const pieces = kind === 'confirm' ? piecesOf(body['pieces']) : undefined
    if (pieces === null) return bad('pieces는 1~99 정수예요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const results: { broadcastId: string; changed: boolean; skip?: string; kept?: string[] }[] = []
    for (const { sellerId, broadcastId } of open) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      let facts: Awaited<ReturnType<typeof tentativeFacts>> | null = null
      let skip: string | undefined
      let kept: string[] = []
      const outcome = await deps.service.writer.write({
        sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId,
        guard: async (tx, runtime) => {
          facts = null
          const product = runtime.scopeId === null ? null : getProduct(runtime.state, broadcastId, no)
          if (runtime.scopeId !== null && product?.tentative !== undefined) facts = await tentativeFacts(tx, sellerId, runtime.scopeId, broadcastId, { ...product, tentative: product.tentative })
          return null
        },
        build: ({ state }) => {
          const product = getProduct(state, broadcastId, no)
          const found = facts as Awaited<ReturnType<typeof tentativeFacts>> | null
          skip = tentativeSkip(product, found, registerRequestId)
          kept = []
          if (skip !== undefined || found === null) return []
          const touched = found.touched
          if (kind === 'withdraw') {
            if (touched.name || touched.price || touched.number) skip = 'SELLER_EDITED'
            return skip === undefined ? [{ fields: { type: 'product.withdraw', b: broadcastId, no }, actor: { kind: 'server' as const }, requestId }] : []
          }
          // 판매자가 고친 칸은 판매자 값 그대로 — 일꾼 값으로 덮지 않는다
          const fields: Record<string, unknown> = { type: 'product.confirm', b: broadcastId, no }
          if (to !== undefined && to !== no) {
            if (touched.number) kept.push('no')
            else if (getProduct(state, broadcastId, to) !== null) skip = 'TARGET_EXISTS'
            else fields['to'] = to
          }
          if (name !== undefined && name !== product?.name) {
            if (touched.name) kept.push('name')
            else fields['name'] = name
          }
          // 개수는 품종에 딸린 값이다 — 판매자가 품종(개수 포함)을 고쳤으면 판매자 값 그대로 (D-PIECES-01)
          if (pieces !== undefined && pieces !== (product?.pieces ?? 1) && !touched.name) fields['pieces'] = pieces
          if (price !== undefined && price !== product?.price) {
            if (touched.price) kept.push('price')
            else fields['price'] = price
          }
          return skip === undefined ? [{ fields, actor: { kind: 'server' as const }, requestId }] : []
        },
      })
      const extra = { ...(skip === undefined ? {} : { skip }), ...(kept.length > 0 ? { kept } : {}) }
      // 서버가 앞에 덧붙인 이벤트(등록 전 찜 만료 끄기, D-PEND-01)가 아니라 확정·거두기 자신이 상태를 바꿨는지로 답한다
      if (outcome.kind === 'ok') results.push({ broadcastId, changed: outcome.records.some((record) => record.changed && record.type === `product.${kind}`), ...(kept.length > 0 ? { kept } : {}) })
      else if (outcome.kind === 'empty' || outcome.kind === 'duplicate') results.push({ broadcastId, changed: false, ...extra })
      else if (outcome.kind === 'rejected') results.push({ broadcastId, changed: false, skip: outcome.rejection.code })
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    return json({ ok: true, changed: results.some((r) => r.changed), no, ...(kind === 'confirm' && typeof to === 'number' ? { to } : {}), broadcasts: results }, 200)
  }
  app.post('/internal/screen/confirm', settle('confirm'))
  app.post('/internal/screen/withdraw', settle('withdraw'))
  app.all('/internal/screen/confirm', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  app.all('/internal/screen/withdraw', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
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
    if (hasUnknownField('renumber', b)) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, from, to, requestId, registerRequestId } = b
    const drop = b['drop'] === true
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    const isNo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999
    if (!isNo(from) || !isNo(to) || from === to) return bad('from·to는 서로 다른 1~9999 정수예요.')
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')
    // D-SCR-10: 바꿀 번호는 일꾼이 방금 보낸 그 등록(요청 번호)이 만든 상품이어야 한다 — 같은 번호의 옛 상품(다시 켠 일꾼이 모르는 것)은 건드리지 않는다
    if (typeof registerRequestId !== 'string' || !REQUEST_RE.test(registerRequestId)) return bad('registerRequestId는 screen-로 시작해야 해요.')
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const results: { broadcastId: string; changed: boolean; skip?: string }[] = []
    for (const { sellerId, broadcastId } of open) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      let byScreen = false
      let thisRegister = false
      let skip: string | undefined
      const outcome = await deps.service.writer.write({
        sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId,
        guard: async (tx, runtime) => {
          if (runtime.scopeId === null) return null
          const [row] = await tx.select({ requestId: events.requestId }).from(events)
            .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), eq(events.type, 'product.register'), eq(events.changed, true),
              sql`${events.body}::jsonb->>'b' = ${broadcastId}`, sql`${events.body}::jsonb->>'no' = ${String(from)}`)).orderBy(desc(events.seq)).limit(1)
          byScreen = row?.requestId?.startsWith('screen-') === true
          thisRegister = row?.requestId === registerRequestId
          return null
        },
        build: ({ state }) => {
          const product = getProduct(state, broadcastId, from)
          if (product === null || product.status === 'CLOSED') skip = 'NO_PRODUCT'
          else if (!byScreen) skip = 'NOT_SCREEN'
          else if (!thisRegister) skip = 'OTHER_REGISTER'
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
  // 금액 고치기 `POST /internal/screen/reprice` (D-SCR-09, 사용자 2026-11-12 "393번 손톱 만원 등록이 안 되노"): 같은 번호를 다른 금액으로
  // 다시 내놓거나(2만원 → 만원) 첫 답 금액이 틀렸을 때 확실한 뒤 답의 금액으로 바꾼다. 받는 값 { videoId, no, price, requestId }.
  // 조건은 이름 고치기와 같고(일꾼 등록·판매 종료 아님), 판매자(또는 판매자 고침을 다른 방송에 옮긴 상품 목록)가 금액을 고친 적이 있으면 건드리지 않는다.
  // 이미 찜한 사람의 금액은 그대로(applyTo NEW_ONLY) — 새로 찜하는 사람부터 새 금액.
  const fixField = (field: 'name' | 'price') => async (c: Context) => {
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
    if (hasUnknownField(field === 'name' ? 'rename' : 'reprice', b)) return bad('받을 수 없는 항목이 있어요.')
    const { videoId, no, requestId } = b
    const value = b[field]
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 9999) return bad('no는 1~9999 정수예요.')
    if (field === 'name' && (typeof value !== 'string' || value.trim() === '' || [...value].length > NAME_MAX)) return bad(`name은 1~${String(NAME_MAX)}자예요.`)
    if (field === 'price' && (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 10_000_000)) return bad('price는 100~10,000,000원 정수예요.')
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) return bad('requestId는 screen-로 시작해야 해요.')
    const next = field === 'name' ? (value as string).trim() : (value as number)
    const open = await openBroadcastsOfVideo(deps.db, videoId)
    if (open.length === 0) return json({ error: { code: 'NOT_LINKED', message: '이 영상에 이어진 방송이 없어요.' } }, 404)
    const results: { broadcastId: string; changed: boolean; skip?: string }[] = []
    for (const { sellerId, broadcastId } of open) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      let byScreen = false
      let sellerSet = false
      let skip: string | undefined
      const outcome = await deps.service.writer.write({
        sellerId, date: broadcast.date, rehearsal: false, createScope: false, requestId,
        guard: async (tx, runtime) => {
          if (runtime.scopeId === null) return null
          const inBroadcast = and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), sql`${events.body}::jsonb->>'b' = ${broadcastId}`)
          // 그 번호의 상품을 만든 등록을 찾는다. 번호를 옮긴 상품(번호 바로잡기 6 → 17)은 등록 이벤트가 옛 번호에 있다 —
          // 옮긴 길을 거슬러 올라가 만든 등록과 판매자 고침을 본다(D-SCR-33: 2026-11-13 방송 17번, 옮긴 뒤 금액 고치기가 NOT_SCREEN으로 거절됨)
          const numbers = [no]
          let reg: { requestId: string | null } | undefined
          let before: number | null = null
          for (let hop = 0; hop < 8; hop++) {
            const current = String(numbers[numbers.length - 1])
            const older: SQL | undefined = before === null ? undefined : sql`${events.seq} < ${before}`
            const [made] = await tx.select({ requestId: events.requestId, seq: events.seq }).from(events)
              .where(and(inBroadcast, older, eq(events.type, 'product.register'), eq(events.changed, true), sql`${events.body}::jsonb->>'no' = ${current}`)).orderBy(desc(events.seq)).limit(1)
            const [moved]: { seq: number; body: string }[] = await tx.select({ seq: events.seq, body: events.body }).from(events)
              .where(and(inBroadcast, older, eq(events.type, 'product.renumber'), eq(events.changed, true), sql`${events.body}::jsonb->>'to' = ${current}`)).orderBy(desc(events.seq)).limit(1)
            let from: unknown
            if (moved !== undefined && (made === undefined || moved.seq > made.seq)) {
              try {
                from = (JSON.parse(moved.body) as Record<string, unknown>)['from']
              } catch {
                from = undefined
              }
            }
            if (typeof from !== 'number' || !Number.isInteger(from) || numbers.includes(from)) {
              reg = made
              break
            }
            numbers.push(from)
            before = moved?.seq ?? null
          }
          const ofNo = and(inBroadcast, or(...numbers.map((n) => sql`${events.body}::jsonb->>'no' = ${String(n)}`)))
          // 일꾼 등록: 일꾼이 직접(screen-), 또는 계정을 처음 맞출 때 다른 계정의 일꾼 값을 옮겨 넣은 등록(D-RETRO-10 — 그 계정에서도 일꾼이 계속 고친다)
          byScreen = reg?.requestId?.startsWith('screen-') === true || (await carriedBy(tx, reg?.requestId, field)) === 'worker'
          // 판매자 고침: 판매자 계정이 직접, 또는 상품 목록이 판매자 고침을 다른 방송에 옮긴 것(요청 번호 catalog-). 처음 맞출 때 옮긴 일꾼 금액은 판매자 고침이 아니다
          const bySeller = field === 'name'
            ? eq(events.actor, 'account')
            : or(eq(events.actor, 'account'), sql`${events.requestId} like 'catalog-%'`)
          const edits = await tx.select({ actor: events.actor, requestId: events.requestId }).from(events)
            .where(and(ofNo, eq(events.type, 'product.update'), bySeller, sql`${events.body}::jsonb ? ${field}`))
          sellerSet = false
          for (const edit of edits) if (edit.actor === 'account' || (await carriedBy(tx, edit.requestId, field)) !== 'worker') sellerSet = true
          return null
        },
        build: ({ state }) => {
          const product = getProduct(state, broadcastId, no)
          if (product === null || product.status === 'CLOSED') skip = 'NO_PRODUCT'
          else if (!byScreen) skip = 'NOT_SCREEN'
          else if (sellerSet) skip = field === 'name' ? 'SELLER_NAMED' : 'SELLER_PRICED'
          else if (product[field] === next) skip = 'SAME'
          if (skip !== undefined) return []
          const fields = field === 'name'
            ? { type: 'product.update' as const, b: broadcastId, no, name: next as string }
            : { type: 'product.update' as const, b: broadcastId, no, price: next as number, applyTo: 'NEW_ONLY' as const }
          return [{ fields, actor: { kind: 'server' as const }, requestId }]
        },
      })
      if (outcome.kind === 'ok') results.push({ broadcastId, changed: outcome.result.changed })
      else if (outcome.kind === 'empty' || outcome.kind === 'duplicate') results.push({ broadcastId, changed: false, ...(skip === undefined ? {} : { skip }) })
      else if (outcome.kind === 'rejected') results.push({ broadcastId, changed: false, skip: outcome.rejection.code })
      else return json({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요.' } }, 503)
    }
    return json({ ok: true, changed: results.some((r) => r.changed), no, broadcasts: results }, 200)
  }
  app.post('/internal/screen/rename', fixField('name'))
  app.post('/internal/screen/reprice', fixField('price'))
  app.all('/internal/screen/reprice', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  app.all('/internal/screen/rename', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST만 받아요.' } }, 405))
  // 끝내지 않은 옛 방송 끝내기 `POST /internal/screen/end-stale` (D-SCR-08, 사용자 2026-11-12 "옛 방송 다 끝내줘"):
  // 받는 값 { videoId }. 그 영상에 이어진 끝나지 않은 방송 가운데 **방송 날짜가 오늘(한국 시각)보다 앞선 것만** 판매자의 [라이브 연결 끊기]와 같은 길
  // (service.endBroadcast, 요청 번호 live-end-<방송> — 저절로 끝내기와 같아 두 번 와도 한 번)로 끝낸다. 오늘 방송은 건드리지 않는다.
  app.post('/internal/screen/end-stale', async (c) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return bad('JSON이 아니에요.')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('JSON 객체여야 해요.')
    const { videoId } = body as Record<string, unknown>
    if (hasUnknownField('end-stale', body)) return bad('받을 수 없는 항목이 있어요.')
    if (typeof videoId !== 'string' || !VIDEO_RE.test(videoId)) return bad('videoId가 유튜브 영상 번호가 아니에요.')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const results: { broadcastId: string; date: string; result: string }[] = []
    for (const { sellerId, broadcastId } of await openBroadcastsOfVideo(deps.db, videoId)) {
      const [row] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (row === undefined) continue
      if (row.date >= today) {
        results.push({ broadcastId, date: row.date, result: 'TODAY' })
        continue
      }
      const outcome = await deps.service.endBroadcast(sellerId, { kind: 'server' }, `live-end-${broadcastId}`.slice(0, 64), broadcastId)
      results.push({ broadcastId, date: row.date, result: outcome.kind === 'ok' ? (outcome.records.some((r) => r.changed) ? 'ENDED' : 'ALREADY_ENDED') : outcome.kind.toUpperCase() })
    }
    return json({ ok: true, videoId, broadcasts: results }, 200)
  })
  // 지금 볼 라이브 (D-SCR-02): 일꾼이 30초마다 묻고, 목록에 생긴 영상에 붙고 빠진 영상에서 떨어진다 — 끊지 않은 연결 + 끝나지 않은 방송의 유튜브 영상 번호만(판매자 정보 없이)
  // 가격 단위 (D-RETRO-84, 복기 A6): 영상마다 그 방송의 설정 스냅샷 `price.unit`을 priceUnit으로 싣는다 — 일꾼이 단위 없는 가격을 판매자와 같은 단위로 읽게.
  // 같은 영상에 이어진 방송들의 값이 서로 다르거나 읽지 못하면 null(일꾼은 자기 규칙대로). 판매자·방송 정보는 여전히 없다
  app.get('/internal/screen/live', async (c) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    const videos: { videoId: string; priceUnit: string | null }[] = []
    for (const videoId of await liveVideos(deps.db)) videos.push({ videoId, priceUnit: await priceUnitOfVideo(deps, videoId) })
    return json({ videos }, 200)
  })
  // 서버가 받는 일꾼 요청 (D-RETRO-32, 복기 E11 "서버 먼저, 일꾼 나중"): 일꾼이 켜질 때 묻고, 서버가 모르는 입구·항목은 보내지 않는다.
  // 돌려주는 값 { commit, endpoints: { <이름>: { method, path, fields } } } — commit은 지금 운영 판(모르면 null), fields는 그 입구가 받는 항목 이름.
  // 판매자·방송 정보는 없다. 내보내기도 배포 뒤 이 입구로 "서버가 정말 그 판인가"를 본다.
  app.get('/internal/screen/capabilities', async (c) => {
    if (deps.token === null) return json({ error: { code: 'NOT_FOUND', message: '없는 주소예요.' } }, 404)
    if (!bearerMatches(c.req.header('authorization'), deps.token)) return json({ error: { code: 'UNAUTHORIZED', message: '일꾼 토큰이 필요해요.' } }, 401)
    return json({ commit: await (deps.commit ?? deployedCommit)(), endpoints: SCREEN_ENDPOINTS }, 200)
  })
  app.all('/internal/screen/capabilities', () => json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET만 받아요.' } }, 405))
}

/** 그 영상에 이어진 방송들의 가격 단위(설정 스냅샷 price.unit). 모두 같을 때만 그 값, 다르거나 읽지 못하면 null (D-RETRO-84) */
async function priceUnitOfVideo(deps: ScreenIntakeDeps, videoId: string): Promise<string | null> {
  try {
    const units = new Set<string>()
    for (const { sellerId, broadcastId } of await openBroadcastsOfVideo(deps.db, videoId)) {
      const [broadcast] = await deps.db.select({ date: broadcasts.date }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, sellerId)))
      if (broadcast === undefined) continue
      const unit = getBroadcast((await deps.service.writer.read(sellerId, broadcast.date)).state, broadcastId)?.settings['price.unit']
      if (unit === undefined) return null
      units.add(unit)
    }
    const [only] = [...units]
    return units.size === 1 && only !== undefined ? only : null
  } catch {
    // 단위를 읽지 못해도 지금 볼 라이브 목록은 돌려준다
    return null
  }
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
