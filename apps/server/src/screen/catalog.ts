// 같은 유튜브 라이브에 이어진 계정 사이에서 상품 편집만 전달한다 (주문·찜은 계정마다 따로).
// - 사람이 고친 것(계정 조치)만 원본 쓰기와 같은 트랜잭션에서 대기열(live_catalog_delivery)에 넣는다. 영상마다 잠금을 잡고 넣으므로
//   행 번호(id)가 그 영상의 고침 차례다. 받는 방송마다 차례대로 넣는다(앞 것이 끝나야 다음 것).
// - 차례 지키기(D-RETRO-11): 원천 방송·순번·시각을 실어 보낸다. 받는 방송이 그 뒤에 스스로 고친 값이 있으면(뒤 차례의 자기 행) 옛 값은 건너뛴다.
//   끝난 행은 다시 넣지 않는다(임대가 끝난 뒤 다른 서버가 이미 넣은 행을 늦게 넣어 순서가 뒤집히지 않게).
// - 처음 맞추기(D-RETRO-10·14): 계정이 새로 이어지면 표시(live_catalog_backfill)만 남기고, 대기열 일꾼이 계정마다의 값과 "누가·언제"를 보고
//   바꿀 것만 넣는다. 사람이 고친 값 > 일꾼 값, 나중 > 먼저. 금액이 다르고 사람이 고친 값이 없으면 기준 계정(감사 채팅·라벨이 켜진 계정이 하나일 때)의
//   값을 쓰고, 기준 계정이 없으면 덮어쓰지 않는다.
// - 느린 꼬리(D-RETRO-12): 고친 요청이 커밋되면 바로 넣고, 그사이 온 요청은 한 번 더 돈다. 실패는 1초 뒤 다시, 5초 넘게 밀리면 로그·운영 상태에 남긴다.
// - 기다리는 찜은 확인 뒤 확정 (D-RETRO-83, 복기 G6·A5 — 2026-11-12 313번: 다른 계정의 1만 원 손 등록이 먼저 들어와 기다리던 찜이 1만 원으로 확정, 실제는 3만 원):
//   동기화로 새로 넣는 등록은 받는 계정에 그 번호로 기다리는 찜이 있으면 확인 중(임시 등록)으로 넣는다 — 그 계정 판매자가 확정한다. 없으면 지금처럼 판매 중.
//   원천 상품이 확인 중이면(일꾼의 임시 등록을 사람이 고친 것) 받는 계정에도 확인 중으로. 한 계정에서 사람이 확정·거두면 다른 계정의 확인 중 상품도 확정·거둔다.
import { getBroadcast, getProduct, pendingCount, type ProductInfo } from '@livejjim/core'
import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { errorKind, type LogCode, type LogSink } from '../log.ts'
import type { Draft, ScopeWriter, TxHookContext, WriteResult } from '../writer.ts'

/** 값을 정한 쪽: 사람(판매자 계정, 또는 그 고침을 옮긴 것) · 일꾼(화면 일꾼·서버) */
type By = 'human' | 'worker'
/** [누가, 원천 시각(ms)] */
type Stamp = [By, number]

/** 확인 중 표시에서 옮기는 것 (R-2 "확인 중") — 까닭 낱말과 후보 */
type Tentative = { reasons: string[]; candidates?: { no?: number[]; price?: number[]; name?: string[] } }

type Edit = {
  type: 'product.open' | 'product.update' | 'product.register' | 'product.close' | 'product.renumber' | 'product.confirm' | 'product.withdraw'
  no: number
  name: string
  /** null = 가격이 빈 확인 중 상품 (R-2 "가격 없는 확인 중", D-RECOG-22) — 받는 계정에도 가격 없이 확인 중으로만 넣고, 0원으로 넣지 않는다 */
  price: number | null
  linkId?: string
  from?: number
  setName: boolean
  setPrice: boolean
  /** 금액을 이미 찜한 손님(입금 전)에게도 적용했는지 — 받는 계정에도 같은 범위로 (D-RETRO-15) */
  applyTo?: 'UNPAID_CLAIMS'
  /** 원천 상품이 (이 고침 뒤에도) 확인 중이다 — 받는 계정에 새로 넣을 때 확인 중으로 넣는다 (D-RETRO-83) */
  tentative?: Tentative
  /** 원천 이벤트 (D-RETRO-11): 판매자·방송·순번·시각 */
  srcSeller?: string
  srcB?: string
  srcSeq?: number
  srcAt?: number
  /** 대기열에 넣은 시각 (ms) — 밀림을 잰다 */
  queuedAt?: number
  /** 처음 맞추기가 만든 행 (D-RETRO-10): 계산할 때 본 값(was)일 때만 바꾼다. was null = 그 계정에 없던 번호 */
  merge?: boolean
  was?: { name: string; price: number | null } | null
  /** 처음 맞추기가 옮긴 값의 원래 주인 (없으면 사람이 고친 값) */
  prov?: { name?: Stamp; price?: Stamp; state?: Stamp }
  attempts?: number
}
/** 처음 맞출 때 금액이 달라 덮어쓰지 않은 번호 (끝난 행으로만 남긴다 — 화면이 두 값을 보여 물을 때 읽는다) */
type Conflict = { type: 'conflict'; no: number; mine: number | null; prices: number[]; merge: true; queuedAt: number }
type Delivery = { id: string | number; seller_id: string; broadcast_id: string; scope_date: string; body: Edit }
export type Member = { id: string; seller_id: string; broadcast_id: string; date: string; scope_id: string }

/** 값을 정한 쪽·원천 시각(ms)·같은 시각일 때의 차례(이벤트 행 번호) */
export type Prov = { by: By; at: number; ord: number }
/** 한 계정의 한 번호: 지금 값과 칸마다 그 값을 정한 쪽 (stateP = 등록·다시 열기·판매 종료·확정 가운데 마지막). tentative = 지금 확인 중인지 (D-RETRO-83) */
export type Held = { name: string; price: number | null; closed: boolean; nameP: Prov; priceP: Prov; stateP: Prov; tentative?: boolean }
export type Party = Member & { held: Map<number, Held> }

const KINDS = ['product.register', 'product.open', 'product.update', 'product.renumber', 'product.close', 'product.confirm', 'product.withdraw'] as const
/** 동기화로 넣는 확인 중 등록의 까닭 낱말 (코어 TENTATIVE_REASONS와 같은 글자) */
const OTHER_ACCOUNT = 'OTHER_ACCOUNT'
const PENDING_CLAIMS = 'PENDING_CLAIMS'

const tentativeOf = (product: ProductInfo | null): Tentative | undefined => {
  const t = product?.tentative
  if (t === undefined) return undefined
  const candidates = { ...(t.candidates.no.length ? { no: [...t.candidates.no] } : {}), ...(t.candidates.price.length ? { price: [...t.candidates.price] } : {}), ...(t.candidates.name.length ? { name: [...t.candidates.name] } : {}) }
  return { reasons: [...t.reasons], ...(Object.keys(candidates).length ? { candidates } : {}) }
}

/** 받는 계정에 새로 넣는 등록의 확인 중 칸 — 원천이 확인 중이거나 그 번호로 기다리는 찜이 있을 때만 (없으면 undefined = 바로 판매 중) */
function syncTentative(source: Tentative | undefined, waiting: boolean): Record<string, unknown> | undefined {
  if (source === undefined && !waiting) return undefined
  const reasons = [...new Set([...(source?.reasons ?? []), OTHER_ACCOUNT, ...(waiting ? [PENDING_CLAIMS] : [])])].slice(-6)
  return { by: 'SYNC', reasons, ...(source?.candidates === undefined ? {} : { candidates: source.candidates }) }
}
const CATALOG_RE = /^catalog-(\d{1,18})(?:-open)?$/
/** 쓰기 전에 밀린 전달을 기다리는 한도이자 "밀림"으로 보는 기준 (ms) */
export const CATALOG_LATE_MS = 5000
/** 실패한 전달을 다시 넣기까지 (초) · 포기하기까지의 횟수 (약 1분) */
const RETRY_SECONDS = 1
const GIVE_UP_AFTER = 60
/** 넣는 중인 행을 다른 서버가 가져가지 않는 시간 (초). 서버가 죽으면 이만큼 뒤 이어받는다 — 같은 요청 번호라 두 번 들어가지 않는다 */
const LEASE_SECONDS = 10
/** 한 번에 넣는 받는 방송 수 (한 방송의 쓰기가 느려도 다른 방송이 밀리지 않게) */
const LANES = 3
/** 거의 동시에 넣은 손 등록으로 보는 간격 (D-RETRO-13) */
const CLASH_MS = 2000
/** 다시 시도하면 되는 거절 */
const TRANSIENT = new Set(['STATE_FORMAT'])

/** 대기열에 넣은 시각 (본문의 queuedAt — 숫자 모양일 때만. 옛 행에는 없다) */
const QUEUED_AT = sql.raw(`CASE WHEN body->>'queuedAt' ~ '^[0-9]{1,15}$' THEN (body->>'queuedAt')::bigint END`)

async function rows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query)
  return Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const handle = setTimeout(resolve, ms)
    handle.unref?.()
  })

export async function enqueueCatalogEdits(tx: Db, ctx: TxHookContext) {
  if (ctx.rehearsal) return false
  let queued = false
  for (const [index, record] of ctx.records.entries()) {
    const e = record.event
    if (
      !record.changed ||
      !['product.open', 'product.update', 'product.register', 'product.close', 'product.renumber', 'product.confirm', 'product.withdraw'].includes(e.type) ||
      !('b' in e)
    )
      continue
    if (
      e.type !== 'product.open' &&
      e.type !== 'product.update' &&
      e.type !== 'product.register' &&
      e.type !== 'product.close' &&
      e.type !== 'product.renumber' &&
      e.type !== 'product.confirm' &&
      e.type !== 'product.withdraw'
    )
      continue
    if (e.type === 'product.update' && e.name === undefined && e.price === undefined) continue
    const no = e.type === 'product.renumber' ? e.to : e.type === 'product.confirm' ? (e.to ?? e.no) : e.no
    const earlier = index === 0 ? ctx.before : ctx.states[index - 1]!
    // 거둔 상품은 지금 상태에 없다 — 거두기 전의 값으로 옮긴다
    const product = e.type === 'product.withdraw' ? getProduct(earlier, e.b, e.no) : getProduct(ctx.states[index]!, e.b, no)
    if (!product) continue
    // 확인 중 상품을 공개한 것은 지금 값으로 확정한 것이다 (R-2 "확인 중") — 다른 계정에도 확정으로 옮긴다
    const kind = e.type === 'product.open' && getProduct(earlier, e.b, e.no)?.tentative !== undefined ? 'product.confirm' : e.type
    const still = kind === 'product.withdraw' ? undefined : tentativeOf(product)
    const [link] = await rows<{ video_id: string }>(tx, sql`
      SELECT l.video_id FROM youtube_links l JOIN broadcasts b ON b.id=l.broadcast_id
      WHERE l.seller_id=${ctx.sellerId} AND l.broadcast_id=${e.b} AND l.unlinked_at IS NULL AND b.ended_at IS NULL
        AND EXISTS (SELECT 1 FROM events WHERE scope_id=${ctx.scopeId} AND seq=${record.seq} AND actor='account') LIMIT 1`)
    if (!link) continue
    await lockVideo(tx, link.video_id)
    const edit: Edit = {
      type: kind,
      no,
      name: product.name,
      price: product.price,
      ...(e.type === 'product.renumber' ? { from: e.from } : {}),
      ...(e.type === 'product.confirm' && e.to !== undefined && e.to !== e.no ? { from: e.no } : {}),
      setName: kind !== 'product.open' && kind !== 'product.withdraw' && (e.type !== 'product.update' || e.name !== undefined),
      setPrice: kind !== 'product.open' && kind !== 'product.withdraw' && (e.type !== 'product.update' || e.price !== undefined),
      ...(e.type === 'product.update' && e.price !== undefined && e.applyTo === 'UNPAID_CLAIMS' ? { applyTo: 'UNPAID_CLAIMS' as const } : {}),
      ...(still === undefined ? {} : { tentative: still }),
      srcSeller: ctx.sellerId,
      srcB: e.b,
      srcSeq: record.seq,
      srcAt: e.at,
      queuedAt: Math.round(ctx.now.getTime()),
    }
    await tx.execute(sql`INSERT INTO live_catalog_delivery (seller_id,broadcast_id,scope_date,body)
      SELECT DISTINCT l.seller_id,l.broadcast_id,b.date,(${JSON.stringify(edit)}::text::jsonb || jsonb_build_object('linkId',l.id)) FROM youtube_links l
      JOIN broadcasts b ON b.id=l.broadcast_id AND b.seller_id=l.seller_id JOIN scopes s ON s.id=b.scope_id AND NOT s.rehearsal
      WHERE l.video_id=${link.video_id} AND l.unlinked_at IS NULL AND b.ended_at IS NULL`)
    queued = true
  }
  return queued
}

async function lockVideo(tx: Db, video: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('live-catalog'),hashtext(${video}))`)
}

/** 계정을 영상에 이을 때(같은 트랜잭션): "처음 맞추기 필요" 표시만 남긴다. 맞추기는 대기열 일꾼이 한다(CatalogDelivery#merge) */
export async function syncOnVideoLink(tx: Db, video: string) {
  await tx.execute(sql`INSERT INTO live_catalog_backfill(video_id) VALUES (${video}) ON CONFLICT DO NOTHING`)
}

/** 그 영상에 지금 이어진(끊지 않은·끝나지 않은·실제) 방송 — 판매자·방송마다 하나 */
async function membersOf(db: Db, video: string): Promise<Member[]> {
  const found = await rows<Member>(db, sql`
    SELECT l.id,l.seller_id,l.broadcast_id,b.date,b.scope_id FROM youtube_links l
    JOIN broadcasts b ON b.id=l.broadcast_id AND b.seller_id=l.seller_id JOIN scopes s ON s.id=b.scope_id AND NOT s.rehearsal
    WHERE l.video_id=${video} AND l.unlinked_at IS NULL AND b.ended_at IS NULL ORDER BY l.seller_id,l.broadcast_id,l.id`)
  const seen = new Map<string, Member>()
  for (const member of found) if (!seen.has(`${member.seller_id}/${member.broadcast_id}`)) seen.set(`${member.seller_id}/${member.broadcast_id}`, member)
  return [...seen.values()]
}

/** 요청 번호 catalog-<행 번호>가 옮긴 행의 본문 (없으면 빈 지도) */
async function carriedBodies(db: Db, requestIds: readonly (string | null)[]): Promise<Map<string, Edit>> {
  const ids = [...new Set(requestIds.flatMap((id) => CATALOG_RE.exec(id ?? '')?.[1] ?? []))]
  const out = new Map<string, Edit>()
  for (let i = 0; i < ids.length; i += 500) {
    const found = await rows<{ id: string | number; body: Edit }>(db, sql`SELECT id,body FROM live_catalog_delivery WHERE id IN (${sql.join(
      ids.slice(i, i + 500).map((id) => sql`${id}::bigint`),
      sql`,`,
    )})`)
    for (const row of found) out.set(String(row.id), row.body)
  }
  return out
}

/**
 * 그 요청 번호(catalog-…)가 옮긴 값이 일꾼 값인지 사람이 고친 값인지. catalog- 요청이 아니면 null.
 * 처음 맞추기가 옮긴 일꾼 등록·금액은 일꾼 값이다(화면 일꾼이 계속 고칠 수 있다). 그 밖의 catalog- 는 사람이 고친 값을 옮긴 것이다.
 */
export async function carriedBy(db: Db, requestId: string | null | undefined, field: 'name' | 'price'): Promise<By | null> {
  const id = CATALOG_RE.exec(requestId ?? '')?.[1]
  if (id === undefined) return null
  const body = (await carriedBodies(db, [requestId ?? null])).get(id)
  const stamp = body?.prov?.[field]
  return stamp !== undefined && stamp[0] === 'worker' ? 'worker' : 'human'
}

/** 한 계정의 상품 이벤트를 차례대로 다시 읽어 번호마다 지금 값과 그 값을 정한 쪽·시각을 구한다 */
async function holdings(tx: Db, member: Member): Promise<Map<number, Held>> {
  const history = await rows<{
    id: string | number
    kind: string
    actor: string
    request_id: string | null
    at: string | number
    no: number | null
    name: string | null
    price: string | number | null
    old: number | null
    next: number | null
    tent: boolean | null
  }>(
    tx,
    sql`
    SELECT id,type AS kind,actor,request_id,at,(body::jsonb->>'no')::int AS no,body::jsonb->>'name' AS name,(body::jsonb->>'price')::bigint AS price,
      (body::jsonb->>'from')::int AS old,(body::jsonb->>'to')::int AS next,(body::jsonb->'tentative') IS NOT NULL AS tent FROM events
    WHERE seller_id=${member.seller_id} AND scope_id=${member.scope_id} AND changed AND NOT failed
    AND type IN (${sql.join(
      KINDS.map((kind) => sql`${kind}`),
      sql`,`,
    )}) AND body::jsonb->>'b'=${member.broadcast_id} ORDER BY seq`,
  )
  const carried = await carriedBodies(
    tx,
    history.map((e) => e.request_id),
  )
  const held = new Map<number, Held>()
  for (const e of history) {
    const at = Number(e.at)
    const ord = Number(e.id)
    const via = carried.get(CATALOG_RE.exec(e.request_id ?? '')?.[1] ?? '')
    const prov = (field: 'name' | 'price' | 'state'): Prov => {
      if (e.actor === 'account') return { by: 'human', at, ord }
      if (!e.request_id?.startsWith('catalog-')) return { by: 'worker', at, ord }
      const stamp = via?.prov?.[field]
      if (stamp !== undefined) return { by: stamp[0] === 'worker' ? 'worker' : 'human', at: Number(stamp[1]) || at, ord }
      return { by: 'human', at: typeof via?.srcAt === 'number' ? via.srcAt : at, ord }
    }
    if (e.kind === 'product.renumber') {
      const moved = e.old === null ? undefined : held.get(e.old)
      if (moved !== undefined && e.old !== null && e.next !== null) {
        held.delete(e.old)
        held.set(e.next, { ...moved, stateP: prov('state') })
      }
      continue
    }
    if (e.no === null) continue
    const last = held.get(e.no)
    if (e.kind === 'product.register') {
      // 가격 없는 확인 중 등록은 가격이 빈 번호다 — Number(null) = 0원으로 읽지 않는다 (D-RECOG-22)
      held.set(e.no, { name: e.name ?? '', price: e.price === null ? null : Number(e.price), closed: false, nameP: prov('name'), priceP: prov('price'), stateP: prov('state'), ...(e.tent === true ? { tentative: true } : {}) })
    } else if (e.kind === 'product.withdraw') {
      // 거둔 확인 중 상품은 없는 번호다 (R-2 "확인 중")
      held.delete(e.no)
    } else if (last !== undefined) {
      if (e.kind === 'product.open' || e.kind === 'product.close' || e.kind === 'product.confirm') {
        last.closed = e.kind === 'product.close'
        last.stateP = prov('state')
        delete last.tentative
      }
      // 확정하며 번호를 옮겼으면 그 번호로 (엔진이 받은 확정만 changed다 — 옮길 번호는 비어 있었다)
      if (e.kind === 'product.confirm' && e.next !== null && e.next !== e.no) {
        held.delete(e.no)
        held.set(e.next, last)
      }
      // 값이 실제로 바뀐 칸만 그 조치자의 값이다 (엔진과 같다 — 같은 값을 다시 적은 칸은 그대로)
      if (e.name !== null && e.name !== last.name) {
        last.name = e.name
        last.nameP = prov('name')
      }
      if (e.price !== null && Number(e.price) !== last.price) {
        last.price = Number(e.price)
        last.priceP = prov('price')
      }
    }
  }
  return held
}

const later = (a: Prov, b: Prov) => (a.at !== b.at ? a.at > b.at : a.ord > b.ord)
const newest = <T extends { p: Prov }>(list: readonly T[]): T => list.reduce((a, c) => (later(c.p, a.p) ? c : a))
const stamp = (p: Prov): Stamp => [p.by, p.at]

/**
 * 처음 맞출 때 한 칸(품종·금액)의 이길 값 (D-RETRO-10·14). 없으면(null) 덮어쓰지 않는다.
 * 사람이 고친 값 > 일꾼 값, 사람끼리는 나중 값. 일꾼 값끼리 다르면 기준 계정의 값, 기준 계정이 없으면 품종은 나중 값(빈 이름은 진다)·금액은 그대로 둔다.
 */
function pick<T extends string | number>(cands: readonly { m: Party; value: T; p: Prov }[], base: Party | null, kind: 'name' | 'price'): { value: T; p: Prov } | null {
  const humans = cands.filter((c) => c.p.by === 'human')
  if (new Set(cands.map((c) => c.value)).size === 1) return newest(humans.length > 0 ? humans : cands)
  if (humans.length > 0) return newest(humans)
  let pool = cands
  if (kind === 'name') {
    const named = cands.filter((c) => c.value !== '')
    if (named.length > 0) pool = named
    if (new Set(pool.map((c) => c.value)).size === 1) return newest(pool)
  }
  const mine = base === null ? undefined : pool.find((c) => c.m === base)
  if (mine !== undefined) return mine
  return kind === 'price' ? null : newest(pool)
}

/**
 * 처음 맞추기 계획 (순수 함수): 계정마다의 지금 값에서 계정마다 바꿀 것만 낸다.
 * 판매 종료·다시 열기는 사람이 한 것이 그 번호의 가장 새 일일 때만 옮긴다(일꾼의 등록은 사람이 지운 번호를 다시 열지 않는다, D-SCR-11).
 */
export function planFirstSync(members: readonly Party[], base: Party | null, now: number): { to: Party; body: Edit | Conflict }[] {
  const out: { to: Party; body: Edit | Conflict }[] = []
  const numbers = [...new Set(members.flatMap((m) => [...m.held.keys()]))].sort((a, b) => a - b)
  for (const no of numbers) {
    const have = members.flatMap((m) => {
      const h = m.held.get(no)
      return h === undefined ? [] : [{ m, h, p: h.stateP }]
    })
    const fact = newest(have)
    const open = have.filter((x) => !x.h.closed)
    if (fact.h.closed && fact.p.by === 'human') {
      for (const x of open) out.push({ to: x.m, body: { type: 'product.close', no, name: x.h.name, price: x.h.price, setName: false, setPrice: false, merge: true, queuedAt: now, prov: { state: stamp(fact.p) } } })
      continue
    }
    if (open.length === 0) continue
    const name = pick(open.map((x) => ({ m: x.m, value: x.h.name, p: x.h.nameP })), base, 'name')
    // 가격이 빈 확인 중 번호(D-RECOG-22)는 금액 후보가 아니다 — 가격을 가진 계정의 값만 견준다
    const priced = open.flatMap((x) => (x.h.price === null ? [] : [{ m: x.m, value: x.h.price, p: x.h.priceP }]))
    const price = priced.length === 0 ? null : pick(priced, base, 'price')
    /** 가진 계정이 모두 아직 가격을 모른다 — 금액 차이가 아니라 가격 없는 확인 중으로 옮긴다 */
    const unpriced = priced.length === 0
    if (name === null) continue
    const reopen = !fact.h.closed && fact.p.by === 'human'
    const prices = [...new Set(priced.map((x) => x.value))].sort((a, b) => a - b)
    for (const m of members) {
      const h = m.held.get(no)
      if (h !== undefined && h.closed && !reopen) continue
      if (h === undefined && fact.h.closed) continue
      if (price === null && !unpriced) out.push({ to: m, body: { type: 'conflict', no, mine: h === undefined || h.closed ? null : h.price, prices, merge: true, queuedAt: now } })
      if (h === undefined) {
        // 금액을 정하지 못한 번호는 없는 계정에 새로 넣지 않는다 (틀린 금액으로 기다리던 찜이 확정되지 않게)
        // 가진 계정이 모두 확인 중이면 새 계정에도 확인 중으로 넣는다 (D-RETRO-83). 기다리는 찜이 있는지는 넣을 때 그 계정의 상태로 본다
        const allTentative = open.every((x) => x.h.tentative === true)
        if (price !== null) out.push({ to: m, body: { type: 'product.register', no, name: name.value, price: price.value, setName: true, setPrice: true, merge: true, was: null, queuedAt: now, prov: { name: stamp(name.p), price: stamp(price.p), state: stamp(fact.p) }, ...(allTentative ? { tentative: { reasons: [OTHER_ACCOUNT] } } : {}) } })
        // 모두 가격 없는 확인 중이면 새 계정에도 가격 없이 확인 중으로 (열린 번호의 가격 빈 상품은 늘 확인 중이다 — INV-14)
        // 빈 가격을 정한 쪽(가격 없는 등록은 일꾼 입구에서만 온다)도 옮긴다 — 그래야 그 계정에서도 일꾼의 금액 고치기가 빈 가격을 채운다(NOT_SCREEN이 아니게, D-RECOG-26)
        else if (unpriced && allTentative) {
          const blank = open.reduce((last, x) => (x.h.priceP.at > last.at ? x.h.priceP : last), open[0]?.h.priceP ?? fact.p)
          const blankP: Prov = { ...blank, by: open.every((x) => x.h.priceP.by === 'worker') ? 'worker' : 'human' }
          out.push({ to: m, body: { type: 'product.register', no, name: name.value, price: null, setName: true, setPrice: false, merge: true, was: null, queuedAt: now, prov: { name: stamp(name.p), price: stamp(blankP), state: stamp(fact.p) }, tentative: { reasons: [OTHER_ACCOUNT] } } })
        }
        continue
      }
      const setName = h.name !== name.value
      const setPrice = price !== null && h.price !== price.value
      if (!h.closed && !setName && !setPrice) continue
      out.push({
        to: m,
        body: {
          type: h.closed ? 'product.open' : 'product.update',
          no,
          name: setName ? name.value : h.name,
          price: setPrice ? price.value : h.price,
          setName,
          setPrice,
          merge: true,
          was: { name: h.name, price: h.price },
          queuedAt: now,
          prov: { ...(setName ? { name: stamp(name.p) } : {}), ...(setPrice ? { price: stamp(price.p) } : {}), ...(h.closed ? { state: stamp(fact.p) } : {}) },
        },
      })
    }
  }
  return out
}

/** 처음 맞추기: 계정마다의 값을 읽어 계획을 세우고 바꿀 것만 대기열에 넣는다. 덮어쓰지 않은 금액 차이의 수를 돌려준다 */
async function mergeExisting(tx: Db, members: readonly Member[], base: Member | null, now: number): Promise<number> {
  const parties: Party[] = []
  for (const member of members) parties.push({ ...member, held: await holdings(tx, member) })
  const plan = planFirstSync(parties, base === null ? null : (parties.find((p) => p.id === base.id) ?? null), now)
  for (const party of parties) {
    const mine = plan.filter((item) => item.to === party).map((item) => item.body)
    if (mine.length === 0) continue
    await tx.execute(sql`INSERT INTO live_catalog_delivery(seller_id,broadcast_id,scope_date,body,done)
      SELECT ${party.seller_id},${party.broadcast_id},${party.date},item.value || jsonb_build_object('linkId',${party.id}::text),item.value->>'type'='conflict'
      FROM jsonb_array_elements(${JSON.stringify(mine)}::text::jsonb) WITH ORDINALITY AS item(value,ord) ORDER BY item.ord`)
  }
  return new Set(plan.filter((item) => item.body.type === 'conflict').map((item) => item.body.no)).size
}

export interface CatalogDeliveryOptions {
  readonly log?: LogSink
  /** 서버 시계 (이벤트 at과 같은 시계 — 밀림·동시 등록 간격을 잰다) */
  readonly now?: () => number
}

export interface CatalogSyncStatus {
  /** 아직 넣지 못한 전달 수 */
  readonly pending: number
  /** 가장 오래 기다린 전달이 기다린 시간 (초, 없으면 0) */
  readonly oldestSeconds: number
  /** 5초 넘게 밀렸는지 */
  readonly late: boolean
  /** 처음 맞추기를 기다리는 영상 수 */
  readonly merges: number
}

export class CatalogDelivery {
  #pass: Promise<void> | null = null
  #again: Promise<void> | null = null
  #stopped = false
  #timer?: ReturnType<typeof setInterval>
  #late = false
  #watchedAt = 0
  /** 처음 맞추기 표시를 볼 차례인지 (서버를 켤 때·계정을 이은 직후·주기마다) */
  #mergeDue = true
  readonly #inflight = new Set<string>()
  readonly #said = new Map<string, number>()
  readonly #log: LogSink
  readonly #now: () => number
  readonly db: Db
  readonly writer: ScopeWriter
  constructor(db: Db, writer: ScopeWriter, options: CatalogDeliveryOptions = {}) {
    this.db = db
    this.writer = writer
    this.#log = options.log ?? (() => {})
    this.#now = options.now ?? (() => Date.now())
  }

  /**
   * 받는 계정의 다음 쓰기(찜 판정) 앞에 밀린 전달을 먼저 넣는다 — 범위 줄 밖에서 기다린다.
   * 가장 오래된 전달이 5초 넘게 밀렸으면 더 기다리지 않고 쓴다: 막힌 전달 하나가 그 계정의 채팅·찜 기록을 세우면 안 된다(입력 우선 기록).
   * 늦게 들어오는 옛 고침은 차례 검사가 건너뛴다.
   */
  async beforeWrite(seller: string, date: string) {
    const started = Date.now()
    for (;;) {
      let head: { n: number | string; oldest: number | string | null } | undefined
      try {
        const found = await rows<{ n: number | string; oldest: number | string | null }>(this.db, sql`SELECT count(*) AS n,min(${QUEUED_AT}) AS oldest
          FROM live_catalog_delivery WHERE seller_id=${seller} AND scope_date=${date} AND NOT done`)
        head = found[0]
      } catch (error) {
        // 대기열을 보지 못해도 쓰기는 한다 (기록이 먼저다)
        this.#say('warn', 'CATALOG_SYNC_FAILED', { seller, date, reason: 'PENDING', errorKind: errorKind(error) })
        return
      }
      if (head === undefined || Number(head.n) === 0) return
      const waited = Math.max(Date.now() - started, head.oldest === null ? CATALOG_LATE_MS : this.#now() - Number(head.oldest))
      if (waited >= CATALOG_LATE_MS) {
        this.#say('warn', 'CATALOG_SYNC_LATE', { seller, date, count: Math.round(waited / 1000) })
        return
      }
      void this.drain()
      await pause(10)
    }
  }

  /** 계정을 영상에 이은 직후: 처음 맞추기를 돌리고 그 계정에 넣을 것을 (5초까지) 기다린다 */
  async afterLink(seller: string, date: string) {
    this.#mergeDue = true
    await Promise.race([this.drain(), pause(CATALOG_LATE_MS)])
    await this.beforeWrite(seller, date)
  }

  /** 처음 맞추기 표시를 지금 다시 본다 (동기화를 처음 켠 뒤·점검용). 대기열이 한 바퀴 돌면 풀린다 */
  async resync() {
    this.#mergeDue = true
    await this.drain()
  }

  start() {
    this.#timer ??= setInterval(() => {
      this.#mergeDue = true
      void this.drain()
    }, RETRY_SECONDS * 1000)
    this.#timer.unref()
    void this.drain()
  }
  close() {
    this.#stopped = true
    clearInterval(this.#timer)
  }

  /**
   * 대기열을 비운다. 도는 중에 부르면 그 바퀴가 끝난 뒤 한 바퀴 더 돈다 —
   * 바퀴가 "더 없음"을 본 직후 커밋된 전달이 다음 주기까지 기다리지 않는다. 돌려준 약속은 부른 뒤에 시작한 바퀴가 끝나면 풀린다.
   */
  drain(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (this.#pass === null) {
      const pass = this.#run().finally(() => {
        this.#pass = null
      })
      this.#pass = pass
      return pass
    }
    this.#again ??= this.#pass.then(() => {
      this.#again = null
      return this.drain()
    })
    return this.#again
  }

  async #run(): Promise<void> {
    if (this.#mergeDue) {
      this.#mergeDue = false
      try {
        await this.#merges()
      } catch (error) {
        this.#mergeDue = true
        this.#say('warn', 'CATALOG_SYNC_FAILED', { reason: 'MERGE', errorKind: errorKind(error) })
      }
    }
    // 할 일이 있을 때만 여러 줄로 넣는다 (빈 바퀴는 질의 하나)
    const first = await this.#claim()
    if (first !== undefined) await Promise.all([this.#lane(first), ...Array.from({ length: LANES - 1 }, () => this.#lane())])
    try {
      await this.#watch()
    } catch {
      // 밀림 확인 실패는 전달을 막지 않는다
    }
  }

  /** 같은 코드는 30초에 한 번만 남긴다. 판매자 ID·범위 날짜·수·오류 종류만 — 상품·구매자 값은 남기지 않는다 */
  #say(level: 'info' | 'warn', code: LogCode, fields: { seller?: string; date?: string; count?: number; reason?: string; errorKind?: string } = {}) {
    const key = `${code}/${fields.reason ?? ''}/${fields.seller ?? ''}`
    const last = this.#said.get(key)
    if (level === 'warn' && last !== undefined && Date.now() - last < 30_000) return
    if (this.#said.size > 1000) this.#said.clear()
    this.#said.set(key, Date.now())
    try {
      this.#log({ level, code, ...fields })
    } catch {
      // 기록 실패는 무시한다
    }
  }

  // ── 처음 맞추기 ────────────────────────────────────────────────────────

  async #merges(): Promise<void> {
    const videos = await rows<{ video_id: string }>(this.db, sql`SELECT video_id FROM live_catalog_backfill ORDER BY video_id`)
    for (const { video_id } of videos) {
      if (this.#stopped) return
      try {
        await this.#merge(video_id)
      } catch (error) {
        // 표시는 남아 있어 다음 바퀴에 다시 한다. 전달은 막지 않는다
        this.#mergeDue = true
        this.#say('warn', 'CATALOG_SYNC_FAILED', { reason: 'MERGE', errorKind: errorKind(error) })
      }
    }
  }

  async #merge(video: string): Promise<void> {
    // 기준 계정은 영상 잠금 밖에서 본다 (범위 상태를 읽는 줄과 영상 잠금이 서로 기다리지 않게)
    const seen = await membersOf(this.db, video)
    const base = seen.length > 1 ? await this.#baseOf(seen) : null
    const kept = await this.db.transaction(async (tx) => {
      await lockVideo(tx, video)
      await tx.execute(sql`DELETE FROM live_catalog_backfill WHERE video_id=${video}`)
      const members = await membersOf(tx, video)
      if (members.length < 2) return 0
      const anchor = base === null ? null : (members.find((m) => m.seller_id === base.seller_id && m.broadcast_id === base.broadcast_id) ?? null)
      return mergeExisting(tx, members, anchor, Math.round(this.#now()))
    })
    if (kept > 0) this.#say('info', 'CATALOG_SYNC_CONFLICT', { count: kept })
  }

  /**
   * 기준 계정 (D-RETRO-14): 감사 채팅(그 방송의 thanks.liveChat) 또는 라벨(확정 때 자동 출력 + 라벨 기능 켬 + 출력 기기 있음)이 켜진 방송.
   * 하나일 때만 기준이다 — 없거나 둘 이상이면 null
   */
  async #baseOf(members: readonly Member[]): Promise<Member | null> {
    const on: Member[] = []
    for (const member of members) {
      const settings = getBroadcast((await this.writer.read(member.seller_id, member.date)).state, member.broadcast_id)?.settings
      if (settings === undefined) continue
      let labels = false
      if (settings['print.autoOnConfirm']) {
        const [queue] = await rows<{ labels_enabled: boolean; device_id: string | null }>(this.db, sql`SELECT labels_enabled,device_id FROM print_queues WHERE seller_id=${member.seller_id}`)
        labels = queue !== undefined && queue.labels_enabled && queue.device_id !== null
      }
      if (settings['thanks.liveChat'] || labels) on.push(member)
    }
    return on.length === 1 ? (on[0] as Member) : null
  }

  // ── 전달 ───────────────────────────────────────────────────────────────

  /** 다음에 넣을 행 하나를 잡는다 (없으면 undefined). 받는 방송마다 가장 앞의 끝나지 않은 행만 — 앞 것이 끝나야 다음 것 */
  async #claim(): Promise<Delivery | undefined> {
    try {
      const busy = this.#inflight.size === 0 ? sql`` : sql`AND d.id NOT IN (${sql.join(
        [...this.#inflight].map((id) => sql`${id}::bigint`),
        sql`,`,
      )})`
      // 사람이 방금 고친 것이 처음 맞추기 묶음보다 먼저
      const got = await rows<Delivery>(
        this.db,
        sql`UPDATE live_catalog_delivery q SET lease_until=now()+${sql.raw(`interval '${String(LEASE_SECONDS)} seconds'`)} WHERE id=(
        SELECT d.id FROM live_catalog_delivery d WHERE NOT d.done AND (d.lease_until IS NULL OR d.lease_until < now()) ${busy}
          AND NOT EXISTS (SELECT 1 FROM live_catalog_delivery older WHERE older.seller_id=d.seller_id AND older.broadcast_id=d.broadcast_id AND NOT older.done AND older.id<d.id)
        ORDER BY (d.body ? 'merge'), d.id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING q.id,q.seller_id,q.broadcast_id,q.scope_date,q.body`,
      )
      const item = got[0]
      if (item !== undefined) this.#inflight.add(String(item.id))
      return item
    } catch (error) {
      this.#say('warn', 'CATALOG_SYNC_FAILED', { reason: 'CLAIM', errorKind: errorKind(error) })
      return undefined
    }
  }

  async #lane(first?: Delivery): Promise<void> {
    for (let item = first ?? (await this.#claim()); item !== undefined; item = this.#stopped ? undefined : await this.#claim()) {
      try {
        await this.#deliver(item)
      } catch (error) {
        await this.#retry(item, errorKind(error)).catch(() => undefined)
      } finally {
        this.#inflight.delete(String(item.id))
      }
    }
  }

  /** 실패한 전달: 1초 뒤 다시(그 방송의 뒤 행은 기다린다 — 차례). 약 1분 실패하면 포기하고 뒤 행을 보낸다 */
  async #retry(item: Delivery, kind: string): Promise<void> {
    const attempts = (item.body.attempts ?? 0) + 1
    const gaveUp = attempts >= GIVE_UP_AFTER
    const next = gaveUp ? sql`done=true, problem='gave_up', lease_until=NULL` : sql`lease_until=now()+${sql.raw(`interval '${String(RETRY_SECONDS)} seconds'`)}`
    await this.db.execute(sql`UPDATE live_catalog_delivery SET ${next}, body=body || jsonb_build_object('attempts',${attempts}::int) WHERE id=${item.id} AND NOT done`)
    this.#say('warn', 'CATALOG_SYNC_FAILED', { seller: item.seller_id, date: item.scope_date, count: attempts, reason: gaveUp ? 'GAVE_UP' : 'RETRY', errorKind: kind })
  }

  async #deliver(item: Delivery): Promise<void> {
    const edit = item.body
    // 금액 차이 기록(conflict)은 넣을 것이 없다 — 끝난 행으로만 만들지만, 열려 있으면 닫는다
    if ((edit.type as string) === 'conflict') {
      await this.db.execute(sql`UPDATE live_catalog_delivery SET done=true, lease_until=NULL WHERE id=${item.id}`)
      return
    }
    const b = item.broadcast_id
    const requestId = 'catalog-' + String(item.id)
    /** 넣지 않은 까닭: stale = 받는 방송에 더 새 값이 있음 · kept = 처음 맞추기가 본 값이 아님 · NUMBER_TAKEN */
    const seen: { done: boolean; name: boolean; price: boolean; note: string | null } = { done: false, name: false, price: false, note: null }
    const result = await this.writer.write({
      applyingCatalog: true,
      sellerId: item.seller_id,
      date: item.scope_date,
      rehearsal: false,
      createScope: false,
      requestId,
      guard: async (tx) => {
        // 범위 잠금 안에서: 이미 끝난 행인지, 이 방송이 이 행보다 뒤에 스스로 고친 칸이 있는지 (D-RETRO-11)
        const newer = (flag: 'setName' | 'setPrice') => sql`EXISTS (SELECT 1 FROM live_catalog_delivery n WHERE n.seller_id=d.seller_id AND n.broadcast_id=d.broadcast_id
          AND n.id>d.id AND n.body->>'no'=d.body->>'no' AND n.body->>${sql.raw(`'${flag}'`)}='true' AND n.body->>'srcB'=d.broadcast_id)`
        const [row] = await rows<{ done: boolean; name_newer: boolean; price_newer: boolean }>(tx, sql`
          SELECT d.done,${newer('setName')} AS name_newer,${newer('setPrice')} AS price_newer FROM live_catalog_delivery d WHERE d.id=${item.id}`)
        Object.assign(seen, { done: row === undefined || row.done, name: row?.name_newer === true, price: row?.price_newer === true })
        if (seen.done || !edit.linkId) return null
        const linked = await rows(tx, sql`SELECT 1 FROM youtube_links l JOIN broadcasts b ON b.id=l.broadcast_id
          WHERE l.id=${edit.linkId} AND l.seller_id=${item.seller_id} AND l.broadcast_id=${b}
          AND l.unlinked_at IS NULL AND b.ended_at IS NULL`)
        return linked.length ? null : { status: 409, code: 'REQUEST_ERROR', message: '라이브 연결이 끝났어요.', problems: [] }
      },
      build: ({ state }) => {
        const drafts: Draft[] = []
        if (seen.done) return drafts
        const target = getProduct(state, b, edit.no)
        const add = (fields: Record<string, unknown>) =>
          drafts.push({ fields: { ...fields, b }, actor: { kind: 'server' }, requestId: drafts.length ? `${requestId}-open` : requestId })
        // 다른 계정이 확정한 상품이 이 계정에서 아직 확인 중이면(같은 일꾼 임시 등록) 같은 값으로 확정한다 (D-RETRO-83)
        const awaiting = edit.type === 'product.confirm' ? getProduct(state, b, edit.from ?? edit.no) : null
        if (edit.type === 'product.withdraw') {
          // 다른 계정이 거둔 임시 등록: 이 계정에서도 아직 확인 중일 때만 거둔다 (확정했거나 손으로 넣은 상품은 그대로)
          if (target?.tentative !== undefined) add({ type: edit.type, no: edit.no })
        } else if (awaiting !== null && awaiting.tentative !== undefined) {
          const moving = awaiting.no !== edit.no
          if (moving && target) seen.note = 'NUMBER_TAKEN'
          else {
            // 이 계정이 그 뒤에 스스로 고친 칸은 그대로 두고 확정한다 (차례 지키기, D-RETRO-11)
            const name = edit.setName && !seen.name && awaiting.name !== edit.name
            const price = edit.setPrice && edit.price !== null && !seen.price && awaiting.price !== edit.price
            add({ type: 'product.confirm', no: awaiting.no, ...(moving ? { to: edit.no } : {}), ...(name ? { name: edit.name } : {}), ...(price ? { price: edit.price } : {}) })
          }
        } else if (awaiting !== null && awaiting.no !== edit.no && awaiting.status !== 'CLOSED') {
          // 다른 계정은 번호를 옮겨 확정했는데 이 계정은 처음 번호로 이미 확정했다 — 같은 상품을 두 번호로 만들지 않는다 (사람이 본다)
          seen.note = 'kept'
        } else if (edit.type === 'product.close') {
          if (target && target.status !== 'CLOSED') add({ type: edit.type, no: edit.no })
        } else if (
          edit.type === 'product.renumber' &&
          edit.from !== undefined &&
          getProduct(state, b, edit.from)?.status !== 'CLOSED' &&
          getProduct(state, b, edit.from)
        ) {
          if (target && target.status !== 'CLOSED') seen.note = 'NUMBER_TAKEN'
          else add({ type: edit.type, from: edit.from, to: edit.no, reuseClosed: true })
        } else if (!target) {
          // 처음 맞추기가 "있는 번호를 고침"으로 계산했는데 그사이 없어졌으면 새로 만들지 않는다
          if (edit.merge && edit.was) seen.note = 'kept'
          else {
            // 이 계정에 그 번호로 기다리는 찜이 있으면 확인 중으로 넣는다 — 다른 계정의 값으로 그 찜이 바로 확정되지 않게 (D-RETRO-83, 313번)
            const tentative = syncTentative(edit.tentative, pendingCount(state, b, edit.no) > 0)
            // 가격이 빈 상품은 확인 중으로만 넣는다 — 가격 없이 판매 중이 되는 등록을 만들지 않는다 (D-RECOG-22)
            if (edit.price === null && tentative === undefined) seen.note = 'kept'
            else add({ type: 'product.register', no: edit.no, name: edit.name, ...(edit.price === null ? {} : { price: edit.price }), ...(tentative === undefined ? {} : { tentative }) })
          }
        } else if (edit.merge && edit.was === null) {
          // 처음 맞추기가 "없는 번호에 등록"으로 계산했는데 그사이 누가 넣었으면 그 값을 그대로 둔다
          if (target.name !== edit.name || target.price !== edit.price) seen.note = 'kept'
        } else {
          let name = edit.setName && target.name !== edit.name
          // 가격 빈 값(D-RECOG-22)으로 받는 계정의 가격을 지우지 않는다
          let price = edit.setPrice && edit.price !== null && target.price !== edit.price
          // 처음 맞추기는 계산할 때 본 값일 때만 바꾼다 — 그사이 바뀐 칸은 건드리지 않는다
          if (edit.merge && edit.was) {
            if (name && target.name !== edit.was.name) [name, seen.note] = [false, 'kept']
            if (price && target.price !== edit.was.price) [price, seen.note] = [false, 'kept']
          }
          if (name && seen.name) [name, seen.note] = [false, 'stale']
          if (price && seen.price) [price, seen.note] = [false, 'stale']
          if (name || price)
            add({
              type: 'product.update',
              no: edit.no,
              ...(name ? { name: edit.name } : {}),
              ...(price ? { price: edit.price, applyTo: edit.applyTo === 'UNPAID_CLAIMS' ? 'UNPAID_CLAIMS' : 'NEW_ONLY' } : {}),
            })
          if ((edit.type === 'product.register' || edit.type === 'product.open' || edit.type === 'product.confirm') && target.status === 'CLOSED') add({ type: 'product.open', no: edit.no })
        }
        return drafts
      },
      // 넣은 이벤트와 같은 트랜잭션에서 끝남 표시 — 넣었는데 표시가 없는 틈이 없다
      afterInsert: async (tx) => {
        await tx.execute(sql`UPDATE live_catalog_delivery SET done=true, lease_until=NULL WHERE id=${item.id}`)
      },
    })
    if (seen.done) return
    let outcome: string
    let problem: string | null = null
    if (result.kind === 'ok') {
      const applied = result.records.some((record) => record.changed && record.type.startsWith('product.'))
      outcome = applied ? 'applied' : 'unchanged'
      if (!applied) problem = 'ok'
    } else if (result.kind === 'duplicate') outcome = 'applied'
    else if (result.kind === 'empty') {
      outcome = seen.note ?? 'same'
      if (seen.note === 'NUMBER_TAKEN') problem = seen.note
    } else if (result.kind === 'rejected' && !TRANSIENT.has(result.rejection.code)) {
      outcome = result.rejection.code
      problem = 'rejected'
    } else if (result.kind === 'not_found') {
      outcome = 'not_found'
      problem = 'not_found'
    } else {
      // 저장 실패·잠시 뒤 다시 하라는 거절: 끝내지 않고 1초 뒤 다시
      await this.#retry(item, result.kind === 'rejected' ? result.rejection.code : 'SaveFailed')
      return
    }
    await this.db.execute(
      sql`UPDATE live_catalog_delivery SET done=true, problem=${problem}, lease_until=NULL,
        body=body || jsonb_build_object('result',${outcome}::text,'doneAt',${Math.round(this.#now())}::bigint) WHERE id=${item.id}`,
    )
  }

  // ── 밀림 ───────────────────────────────────────────────────────────────

  /** 운영 상태에 싣는 합친 숫자 (판매자·상품 정보 없음) */
  async status(): Promise<CatalogSyncStatus> {
    const [head] = await rows<{ n: number | string; oldest: number | string | null; merges: number | string }>(this.db, sql`
      SELECT count(*) AS n,min(${QUEUED_AT}) AS oldest,(SELECT count(*) FROM live_catalog_backfill) AS merges FROM live_catalog_delivery WHERE NOT done`)
    const pending = Number(head?.n ?? 0)
    const oldestMs = pending === 0 || head === undefined || head.oldest === null ? 0 : Math.max(0, this.#now() - Number(head.oldest))
    return { pending, oldestSeconds: Math.floor(oldestMs / 1000), late: oldestMs >= CATALOG_LATE_MS, merges: Number(head?.merges ?? 0) }
  }

  /** 한 바퀴 끝에(1초에 한 번까지): 5초 넘게 밀리면 로그에 남기고, 풀리면 풀렸다고 남긴다 */
  async #watch(): Promise<void> {
    if (Date.now() - this.#watchedAt < 1000) return
    this.#watchedAt = Date.now()
    const status = await this.status()
    if (status.late) this.#say('warn', 'CATALOG_SYNC_LATE', { count: status.oldestSeconds })
    else if (this.#late) this.#say('info', 'CATALOG_SYNC_CAUGHT_UP')
    this.#late = status.late
  }

  // ── 거의 동시에 넣은 손 등록 ───────────────────────────────────────────

  /**
   * 손 등록이 "이미 있는 번호"로 아무 일도 없었는데(R-2), 그 번호를 만든 것이 직전 2초 안에 다른 계정에서 동기화로 들어온 등록이고
   * 품종·금액이 다르면 응답에 실을 값 (D-RETRO-13). 값은 바꾸지 않는다 — 화면이 둘을 보여 고르게 한다. 해당 없으면 빈 객체.
   */
  async registerClash(sellerId: string, result: WriteResult | null): Promise<Record<string, unknown>> {
    try {
      if (result === null || result.type !== 'product.register' || result.changed || result.failed || result.rehearsal) return {}
      const { b, no, at, name, price } = result.event
      if (typeof b !== 'string' || typeof no !== 'number' || typeof at !== 'number') return {}
      const [made] = await rows<{ request_id: string | null; at: number | string }>(this.db, sql`
        SELECT e.request_id,e.at FROM events e JOIN broadcasts br ON br.scope_id=e.scope_id AND br.seller_id=e.seller_id
        WHERE br.id=${b} AND br.seller_id=${sellerId} AND e.seller_id=${sellerId} AND e.type='product.register' AND e.changed AND NOT e.failed
          AND e.body::jsonb->>'b'=${b} AND e.body::jsonb->>'no'=${String(no)} AND e.seq<${result.seq} ORDER BY e.seq DESC LIMIT 1`)
      const id = /^catalog-(\d{1,18})$/.exec(made?.request_id ?? '')?.[1]
      if (made === undefined || id === undefined) return {}
      const agoMs = at - Number(made.at)
      if (agoMs < 0 || agoMs > CLASH_MS) return {}
      const product = getProduct((await this.writer.read(sellerId, result.date)).state, b, no)
      if (product === null || (product.name === name && product.price === price)) return {}
      const [source] = await rows<{ name: string }>(this.db, sql`
        SELECT s.name FROM live_catalog_delivery d JOIN sellers s ON s.id=d.body->>'srcSeller' WHERE d.id=${id}::bigint`)
      return { syncClash: { no, tried: { name, price }, current: { name: product.name, price: product.price, from: source?.name ?? null }, agoMs } }
    } catch (error) {
      // 알림용 값이라 실패해도 등록 응답은 그대로 나간다
      this.#say('warn', 'CATALOG_SYNC_FAILED', { reason: 'CLASH', errorKind: errorKind(error) })
      return {}
    }
  }
}
