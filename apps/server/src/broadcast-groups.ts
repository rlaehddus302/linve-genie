// 라이브 합치기 (D-MERGE-LIVE-01~, 판매자 요청 2026-11-17 "하루에 1차, 2차 이렇게 끊어서 방송하는 경우 … 나중에 정산할 때 정보가 파편화됨"):
// 같은 날 끝난 실제 라이브 여럿을 정산서 하나로 묶는다. 엔진 기록(찜·구매자·정산 묶음)은 손대지 않는다 — 같은 날 라이브는 이미 한 엔진 범위라(D-069)
// 같은 손님은 같은 구매자 ID이고, 묶음은 "정산서 화면·내려받기가 어떤 라이브를 함께 보일지"만 정한다.
// - 기록: broadcast_group_events에 덧붙이기만 한다(merge · split). 지금 묶음 = 기록을 id 순서로 접은 것. 같은 요청 번호면 처음 결과.
// - 막는 경우: 끝나지 않은 라이브 · 연습(리허설) 라이브 · 다른 판매자·없는 라이브(404처럼 "찾지 못함") · 날짜가 다른 라이브.
// - 이미 묶인 라이브를 다시 고르면 그 묶음을 흡수한다(3차를 더할 때: 1·2차 묶음 + 3차 → 하나). 흡수된 묶음은 split 기록을 남긴다.
// - 나누기: 그 묶음만 없앤다. 이미 없는 묶음이면 아무 일도 없다(같은 결과).
import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { broadcastGroupEvents } from './db/schema.ts'
import type { ErrorCode } from './errors.ts'
import { listBroadcastRows, type BroadcastRow } from './store.ts'

/** 한 묶음에 넣을 수 있는 라이브 수 */
export const GROUP_MAX = 10

export interface BroadcastGroup {
  readonly id: string
  readonly date: string
  /** 라이브 순서(그날 시작 순서) — 첫째가 1차 */
  readonly broadcasts: readonly string[]
}

export const GROUP_MESSAGES = {
  count: `라이브를 2개에서 ${GROUP_MAX}개까지 골라 주세요.`,
  notFound: '고른 라이브를 찾지 못했어요. 목록을 새로 고쳐 주세요.',
  notEnded: '끝난 라이브만 합칠 수 있어요. 라이브를 끝낸 뒤 다시 해 주세요.',
  rehearsal: '연습 라이브는 합칠 수 없어요.',
  otherDay: '같은 날 라이브만 합칠 수 있어요. 날짜가 다른 주문은 주문 화면에서 합배송으로 묶어 주세요.',
  groupMissing: '합친 라이브를 찾지 못했어요. 목록을 새로 고쳐 주세요.',
} as const

export type GroupRejection = { readonly status: 400 | 404 | 409; readonly code: ErrorCode; readonly message: string }
export type MergeResult = { readonly ok: true; readonly group: BroadcastGroup } | { readonly ok: false; readonly rejection: GroupRejection }
export type SplitResult = { readonly ok: true } | { readonly ok: false; readonly rejection: GroupRejection }

const lockKey = (sellerId: string) => sql`hashtextextended(${`broadcast-groups/${sellerId}`}, 0)`

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Reader = Db | Tx

function parseIds(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** 기록을 접은 지금 묶음 (기록 순서). 라이브가 지워졌거나 맞지 않게 된 묶음은 readGroups가 거른다 */
async function foldGroups(db: Reader, sellerId: string): Promise<Map<string, { date: string; broadcasts: string[] }>> {
  const rows = await db
    .select({ kind: broadcastGroupEvents.kind, groupId: broadcastGroupEvents.groupId, date: broadcastGroupEvents.date, ids: broadcastGroupEvents.broadcastIds })
    .from(broadcastGroupEvents)
    .where(eq(broadcastGroupEvents.sellerId, sellerId))
    .orderBy(asc(broadcastGroupEvents.id))
  const groups = new Map<string, { date: string; broadcasts: string[] }>()
  for (const row of rows) {
    if (row.kind === 'split') groups.delete(row.groupId)
    else if (row.kind === 'merge') {
      groups.delete(row.groupId)
      groups.set(row.groupId, { date: row.date, broadcasts: parseIds(row.ids) })
    }
  }
  return groups
}

/** 묶을 수 있는 라이브인지 (끝난 · 실제 · 화면에 들어온) */
const groupable = (row: BroadcastRow): boolean => !row.rehearsal && row.endedAt !== null && row.openedAt !== null

/**
 * 지금 묶음 — 라이브는 그날 시작 순서. 묶음의 라이브가 지금 목록에 없거나(복구 등) 날짜가 어긋나면 그 라이브를 빼고, 2개가 안 되면 묶음을 보이지 않는다
 * (정산서가 엉뚱한 라이브를 합치지 않게 — 기록은 그대로 남는다)
 */
export async function readGroups(db: Reader, sellerId: string, rows?: readonly BroadcastRow[]): Promise<BroadcastGroup[]> {
  const folded = await foldGroups(db, sellerId)
  if (folded.size === 0) return []
  const list = rows ?? (await listBroadcastRows(db as Db, sellerId))
  const byId = new Map(list.map((row) => [row.id, row]))
  const out: BroadcastGroup[] = []
  const taken = new Set<string>()
  for (const [id, group] of folded) {
    const members = group.broadcasts
      .map((b) => byId.get(b))
      .filter((row): row is BroadcastRow => row !== undefined && groupable(row) && row.date === group.date && !taken.has(row.id))
      .sort((a, b) => a.startSeq - b.startSeq)
    if (members.length < 2) continue
    for (const row of members) taken.add(row.id)
    out.push({ id, date: group.date, broadcasts: members.map((row) => row.id) })
  }
  return out
}

/** 그 라이브가 든 묶음 (없으면 null) */
export async function groupOfBroadcast(db: Db, sellerId: string, broadcastId: string): Promise<BroadcastGroup | null> {
  return (await readGroups(db, sellerId)).find((group) => group.broadcasts.includes(broadcastId)) ?? null
}

const reject = (status: 400 | 404 | 409, code: ErrorCode, message: string) => ({ ok: false as const, rejection: { status, code, message } })

async function priorEvent(db: Reader, sellerId: string, requestId: string) {
  const [row] = await db
    .select({ kind: broadcastGroupEvents.kind, groupId: broadcastGroupEvents.groupId })
    .from(broadcastGroupEvents)
    .where(and(eq(broadcastGroupEvents.sellerId, sellerId), eq(broadcastGroupEvents.requestId, requestId)))
    .limit(1)
  return row ?? null
}

/**
 * 합치기: 고른 라이브(2~10개, 같은 날, 끝난 실제 라이브)를 한 묶음으로. 고른 라이브가 이미 묶음에 있으면 그 묶음의 라이브도 함께 묶는다.
 * 같은 요청 번호로 다시 오면 처음 결과(그 묶음의 지금 모습)
 */
export async function mergeBroadcasts(db: Db, sellerId: string, accountId: string | null, requestId: string, picked: readonly string[], now: Date): Promise<MergeResult> {
  const ids = [...new Set(picked)]
  if (ids.length !== picked.length || ids.length < 2 || ids.length > GROUP_MAX) return reject(400, 'INVALID_INPUT', GROUP_MESSAGES.count)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
    const rows = await listBroadcastRows(tx as unknown as Db, sellerId)
    const prior = await priorEvent(tx, sellerId, requestId)
    if (prior !== null) {
      const group = (await readGroups(tx, sellerId, rows)).find((item) => item.id === prior.groupId)
      return group === undefined ? reject(409, 'GROUP_CHANGED', GROUP_MESSAGES.groupMissing) : { ok: true as const, group }
    }
    const byId = new Map(rows.map((row) => [row.id, row]))
    const chosen = ids.map((id) => byId.get(id))
    if (chosen.some((row) => row === undefined)) return reject(404, 'NOT_FOUND', GROUP_MESSAGES.notFound)
    const found = chosen as BroadcastRow[]
    if (found.some((row) => row.rehearsal)) return reject(409, 'REHEARSAL', GROUP_MESSAGES.rehearsal)
    if (found.some((row) => row.endedAt === null || row.openedAt === null)) return reject(409, 'NOT_ENDED', GROUP_MESSAGES.notEnded)
    const date = found[0]!.date
    if (found.some((row) => row.date !== date)) return reject(409, 'OTHER_DAY', GROUP_MESSAGES.otherDay)
    const current = await readGroups(tx, sellerId, rows)
    const touched = current.filter((group) => group.broadcasts.some((b) => ids.includes(b)))
    const members = new Set<string>(ids)
    for (const group of touched) for (const b of group.broadcasts) members.add(b)
    if (members.size > GROUP_MAX) return reject(400, 'INVALID_INPUT', GROUP_MESSAGES.count)
    const ordered = [...members].map((id) => byId.get(id)!).sort((a, b) => a.startSeq - b.startSeq).map((row) => row.id)
    // 이미 같은 모습의 묶음이면 그대로 (기록을 늘리지 않는다)
    const same = touched.length === 1 && touched[0]!.broadcasts.length === ordered.length ? touched[0]! : null
    if (same !== null) return { ok: true as const, group: same }
    // 흡수: 맨 앞 묶음의 ID를 이어 쓰고, 나머지 묶음은 나누기로 남긴다
    const groupId = touched[0]?.id ?? `g_${randomUUID()}`
    const base = { sellerId, date, accountId, createdAt: now }
    for (const [index, group] of touched.entries()) {
      if (group.id === groupId) continue
      await tx.insert(broadcastGroupEvents).values({ ...base, requestId: `${requestId}#absorb-${String(index)}`, kind: 'split', groupId: group.id, broadcastIds: JSON.stringify(group.broadcasts) })
    }
    await tx.insert(broadcastGroupEvents).values({ ...base, requestId, kind: 'merge', groupId, broadcastIds: JSON.stringify(ordered) })
    return { ok: true as const, group: { id: groupId, date, broadcasts: ordered } }
  })
}

/** 나누기: 그 묶음을 없앤다. 이미 없으면 아무 일도 없다(같은 결과). 다른 판매자의 묶음 ID는 없는 것과 같다 */
export async function splitGroup(db: Db, sellerId: string, accountId: string | null, requestId: string, groupId: string, now: Date): Promise<SplitResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
    if ((await priorEvent(tx, sellerId, requestId)) !== null) return { ok: true as const }
    const folded = await foldGroups(tx, sellerId)
    const group = folded.get(groupId)
    if (group === undefined) {
      // 한 번도 없던 묶음이면 찾지 못함, 이미 나눈 묶음이면 같은 결과
      const [seen] = await tx
        .select({ id: broadcastGroupEvents.id })
        .from(broadcastGroupEvents)
        .where(and(eq(broadcastGroupEvents.sellerId, sellerId), eq(broadcastGroupEvents.groupId, groupId)))
        .limit(1)
      return seen === undefined ? reject(404, 'NOT_FOUND', GROUP_MESSAGES.groupMissing) : { ok: true as const }
    }
    await tx.insert(broadcastGroupEvents).values({ sellerId, requestId, kind: 'split', groupId, date: group.date, broadcastIds: JSON.stringify(group.broadcasts), accountId, createdAt: now })
    return { ok: true as const }
  })
}
