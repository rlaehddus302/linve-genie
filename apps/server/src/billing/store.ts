// 요금 원장 저장소 (BILLING_RULES BL-0 2·4, BL-INV-5·8, SYS-02). 모든 질의에 판매자 ID 조건을 건다.
// 이용권·회수·쓴 기록·이용 방식 표에는 넣기만 한다(UPDATE·DELETE 없음 — 시험이 소스를 검사한다).
// 결제 주문·증빙 요청은 상태 칸만 바꾼다. 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다.
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import {
  billingBusiness,
  billingDocuments,
  billingGrants,
  billingLockKey,
  billingModes,
  billingOrders,
  billingRequests,
  billingRevocations,
  billingUsage,
  broadcasts,
} from '../db/schema.ts'
import type { GrantSource, OrderState, PassKind, QuantityKind, StartMode } from './rules.ts'

/** 그 판매자의 요금 처리를 차례로 (트랜잭션이 끝날 때 풀린다 — BL-4 3·BL-7 4) */
export async function lockBilling(tx: Db, sellerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${billingLockKey(sellerId)})`)
}

// ── 이용권·회수 ───────────────────────────────────────────────────────────

export interface GrantRow {
  readonly id: string
  readonly kind: PassKind
  readonly quantity: number | null
  readonly source: GrantSource
  readonly paymentId: string | null
  readonly reason: string | null
  readonly at: Date
  /** 회수됨 */
  readonly revoked: boolean
  /** 결제 이용권의 환불 중 표시 (있으면 지워질 때까지 쓰지 않는다 — 값은 결제 취소를 맡은 요청의 기한, RA-N5-01) */
  readonly refundHoldUntil: Date | null
}

export async function grantRows(db: Db, sellerId: string): Promise<GrantRow[]> {
  const rows = await db
    .select({
      id: billingGrants.id,
      kind: billingGrants.kind,
      quantity: billingGrants.quantity,
      source: billingGrants.source,
      paymentId: billingGrants.paymentId,
      reason: billingGrants.reason,
      at: billingGrants.at,
      revocation: billingRevocations.id,
      refundHoldUntil: billingOrders.refundHoldUntil,
    })
    .from(billingGrants)
    .leftJoin(billingRevocations, and(eq(billingRevocations.grantId, billingGrants.id), eq(billingRevocations.sellerId, sellerId)))
    .leftJoin(billingOrders, and(eq(billingOrders.paymentId, billingGrants.paymentId), eq(billingOrders.sellerId, sellerId)))
    .where(eq(billingGrants.sellerId, sellerId))
    .orderBy(asc(billingGrants.at), asc(billingGrants.id))
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as PassKind,
    quantity: row.quantity,
    source: row.source as GrantSource,
    paymentId: row.paymentId,
    reason: row.reason,
    at: row.at,
    revoked: row.revocation !== null,
    refundHoldUntil: row.refundHoldUntil,
  }))
}

export async function insertGrant(
  tx: Db,
  row: { id: string; sellerId: string; kind: PassKind; quantity: number | null; source: GrantSource; paymentId: string | null; reason: string | null; at: Date },
): Promise<void> {
  await tx.insert(billingGrants).values(row)
}

export async function insertRevocation(tx: Db, row: { sellerId: string; grantId: string; reason: string; at: Date }): Promise<void> {
  await tx.insert(billingRevocations).values(row)
}

export async function grantOfPayment(db: Db, sellerId: string, paymentId: string): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: billingGrants.id })
    .from(billingGrants)
    .where(and(eq(billingGrants.sellerId, sellerId), eq(billingGrants.paymentId, paymentId)))
    .limit(1)
  return rows[0] ?? null
}

// ── 쓴 기록 ───────────────────────────────────────────────────────────────

export interface UsageSummary {
  /** 방송 일 쓴 시각 (24시간 창) */
  readonly days: readonly Date[]
  readonly orders: number
  readonly labels: number
}

export async function usageSummary(db: Db, sellerId: string): Promise<UsageSummary> {
  const days = await db
    .select({ at: billingUsage.at })
    .from(billingUsage)
    .where(and(eq(billingUsage.sellerId, sellerId), eq(billingUsage.kind, 'DAYS')))
    .orderBy(asc(billingUsage.at))
  const counts = await db
    .select({ kind: billingUsage.kind, n: sql<number>`count(*)::int` })
    .from(billingUsage)
    .where(and(eq(billingUsage.sellerId, sellerId), inArray(billingUsage.kind, ['ORDERS', 'LABELS'])))
    .groupBy(billingUsage.kind)
  const count = (kind: string) => Number(counts.find((row) => row.kind === kind)?.n ?? 0)
  return { days: days.map((row) => row.at), orders: count('ORDERS'), labels: count('LABELS') }
}

export interface NewUsage {
  readonly sellerId: string
  readonly kind: QuantityKind
  readonly key: string
  readonly at: Date
  readonly broadcastId: string | null
  readonly date: string | null
  readonly productId: string | null
  readonly productNo: number | null
  readonly jobId: string | null
}

/** 쓴 기록 넣기 — 같은 (판매자, 키)는 한 번만 (넣은 키를 돌려준다) */
export async function insertUsage(tx: Db, rows: readonly NewUsage[]): Promise<string[]> {
  if (rows.length === 0) return []
  const inserted = await tx
    .insert(billingUsage)
    .values([...rows])
    .onConflictDoNothing({ target: [billingUsage.sellerId, billingUsage.key] })
    .returning({ key: billingUsage.key })
  return inserted.map((row) => row.key)
}

export interface UsageRow {
  readonly id: number
  readonly kind: QuantityKind
  readonly key: string
  readonly at: Date
  readonly broadcastId: string | null
  readonly date: string | null
  readonly productId: string | null
  readonly productNo: number | null
  readonly jobId: string | null
  readonly broadcastTitle: string | null
  readonly broadcastDate: string | null
}

/** 쓴 기록 (최근 것 먼저 — 시각 다음 ID). before = (시각, ID) 이어 받기 기준 */
export async function usageRows(db: Db, sellerId: string, before: { at: Date; id: number } | null, limit: number): Promise<UsageRow[]> {
  const conditions = [eq(billingUsage.sellerId, sellerId)]
  if (before !== null) conditions.push(sql`(${billingUsage.at}, ${billingUsage.id}) < (${before.at.toISOString()}::timestamptz, ${before.id})`)
  const rows = await db
    .select({
      id: billingUsage.id,
      kind: billingUsage.kind,
      key: billingUsage.key,
      at: billingUsage.at,
      broadcastId: billingUsage.broadcastId,
      date: billingUsage.date,
      productId: billingUsage.productId,
      productNo: billingUsage.productNo,
      jobId: billingUsage.jobId,
      broadcastTitle: broadcasts.title,
      broadcastDate: broadcasts.date,
    })
    .from(billingUsage)
    .leftJoin(broadcasts, and(eq(broadcasts.id, billingUsage.broadcastId), eq(broadcasts.sellerId, sellerId)))
    .where(and(...conditions))
    .orderBy(desc(billingUsage.at), desc(billingUsage.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, kind: row.kind as QuantityKind }))
}

/** 그 판매자의 쓴 기록 전부 (재생 무결성 검사) */
export async function allUsage(db: Db, sellerId: string): Promise<{ kind: string; key: string; at: Date; broadcastId: string | null; date: string | null }[]> {
  return db
    .select({ kind: billingUsage.kind, key: billingUsage.key, at: billingUsage.at, broadcastId: billingUsage.broadcastId, date: billingUsage.date })
    .from(billingUsage)
    .where(eq(billingUsage.sellerId, sellerId))
    .orderBy(asc(billingUsage.at), asc(billingUsage.id))
}

// ── 방송의 이용 방식 ───────────────────────────────────────────────────────

export async function insertMode(tx: Db, row: { broadcastId: string; sellerId: string; scopeId: string; mode: StartMode; usedDay: boolean; at: Date }): Promise<void> {
  await tx.insert(billingModes).values(row)
}

export async function modeOf(db: Db, sellerId: string, broadcastId: string): Promise<{ mode: StartMode; usedDay: boolean } | null> {
  const rows = await db
    .select({ mode: billingModes.mode, usedDay: billingModes.usedDay })
    .from(billingModes)
    .where(and(eq(billingModes.sellerId, sellerId), eq(billingModes.broadcastId, broadcastId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : { mode: row.mode as StartMode, usedDay: row.usedDay }
}

/**
 * 그 범위의 방송 중 이용 방식이 주어진 것인 방송 ID. 범위는 방송 표로 찾는다(이용 방식 행의 scope_id가 아니다 —
 * 복구(I2)가 범위를 새 ID로 다시 만들어도 같은 방송 ID의 이용 방식이 이어진다)
 */
export async function broadcastsWithMode(db: Db, sellerId: string, scopeId: string, modes: readonly StartMode[]): Promise<Map<string, StartMode>> {
  const rows = await db
    .select({ broadcastId: billingModes.broadcastId, mode: billingModes.mode })
    .from(billingModes)
    .innerJoin(broadcasts, and(eq(broadcasts.id, billingModes.broadcastId), eq(broadcasts.sellerId, sellerId)))
    .where(and(eq(billingModes.sellerId, sellerId), eq(broadcasts.scopeId, scopeId), inArray(billingModes.mode, [...modes])))
  return new Map(rows.map((row) => [row.broadcastId, row.mode as StartMode]))
}

/** 정액 방식으로 시작한 방송의 시작 시각 */
export async function flatStartTimes(db: Db, sellerId: string): Promise<Date[]> {
  const rows = await db
    .select({ at: billingModes.at })
    .from(billingModes)
    .where(and(eq(billingModes.sellerId, sellerId), eq(billingModes.mode, 'FLAT')))
  return rows.map((row) => row.at)
}

/** 그 판매자의 이용 방식 전부 (재생 무결성 검사) */
export async function allModes(db: Db, sellerId: string): Promise<{ broadcastId: string; scopeId: string; mode: StartMode; usedDay: boolean; at: Date }[]> {
  const rows = await db
    .select({ broadcastId: billingModes.broadcastId, scopeId: billingModes.scopeId, mode: billingModes.mode, usedDay: billingModes.usedDay, at: billingModes.at })
    .from(billingModes)
    .where(eq(billingModes.sellerId, sellerId))
  return rows.map((row) => ({ ...row, mode: row.mode as StartMode }))
}

// ── 결제 주문 ─────────────────────────────────────────────────────────────

export type OrderRow = typeof billingOrders.$inferSelect

export async function insertOrder(tx: Db, row: typeof billingOrders.$inferInsert): Promise<void> {
  await tx.insert(billingOrders).values(row)
}

export async function findOrder(db: Db, sellerId: string, paymentId: string, forUpdate = false): Promise<OrderRow | null> {
  const query = db
    .select()
    .from(billingOrders)
    .where(and(eq(billingOrders.sellerId, sellerId), eq(billingOrders.paymentId, paymentId)))
    .limit(1)
  const rows = forUpdate ? await query.for('update') : await query
  return rows[0] ?? null
}

/**
 * 결제 ID로 주문의 판매자 찾기 (웹훅 — 판매자를 모른다. 결제 ID는 서버가 만든 추측할 수 없는 값이고, 찾은 뒤 모든 처리는 그 판매자 조건으로 한다)
 */
export async function orderSeller(db: Db, paymentId: string): Promise<string | null> {
  const rows = await db.select({ sellerId: billingOrders.sellerId }).from(billingOrders).where(eq(billingOrders.paymentId, paymentId)).limit(1)
  return rows[0]?.sellerId ?? null
}

export async function orderByRequest(db: Db, sellerId: string, requestId: string): Promise<OrderRow | null> {
  const rows = await db
    .select()
    .from(billingOrders)
    .where(and(eq(billingOrders.sellerId, sellerId), eq(billingOrders.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

export type OrderPatch = Partial<Pick<OrderRow, 'state' | 'paidMethod' | 'grantedAt' | 'refundHoldUntil' | 'refundedAt'>>

export async function updateOrder(tx: Db, sellerId: string, paymentId: string, patch: OrderPatch, now: Date): Promise<void> {
  await tx
    .update(billingOrders)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(billingOrders.sellerId, sellerId), eq(billingOrders.paymentId, paymentId)))
}

export async function ordersOf(db: Db, sellerId: string): Promise<OrderRow[]> {
  return db.select().from(billingOrders).where(eq(billingOrders.sellerId, sellerId)).orderBy(desc(billingOrders.createdAt), desc(billingOrders.paymentId))
}

/** 운영자 목록: 확인 필요 주문·오래 결제 대기인 주문 (모든 판매자) */
export async function ordersInState(db: Db, state: OrderState): Promise<OrderRow[]> {
  return db.select().from(billingOrders).where(eq(billingOrders.state, state)).orderBy(asc(billingOrders.createdAt))
}

/** 환불 중 표시가 있는 결제 완료 주문 (그 판매자 — 결제 내역을 열 때 결제 조회로 맞춘다, RA-N5-01) */
export async function refundingOrders(db: Db, sellerId: string): Promise<OrderRow[]> {
  return db
    .select()
    .from(billingOrders)
    .where(and(eq(billingOrders.sellerId, sellerId), eq(billingOrders.state, 'GRANTED'), isNotNull(billingOrders.refundHoldUntil)))
    .orderBy(asc(billingOrders.refundHoldUntil), asc(billingOrders.paymentId))
}

/** 운영자 목록: 환불 중 표시가 있는 결제 완료 주문 (모든 판매자, RA-N5-01) */
export async function allRefundingOrders(db: Db): Promise<OrderRow[]> {
  return db
    .select()
    .from(billingOrders)
    .where(and(eq(billingOrders.state, 'GRANTED'), isNotNull(billingOrders.refundHoldUntil)))
    .orderBy(asc(billingOrders.refundHoldUntil), asc(billingOrders.paymentId))
}

// ── 사업자 정보 ───────────────────────────────────────────────────────────

export type BusinessRow = typeof billingBusiness.$inferSelect

export async function readBusiness(db: Db, sellerId: string): Promise<BusinessRow | null> {
  const rows = await db.select().from(billingBusiness).where(eq(billingBusiness.sellerId, sellerId)).limit(1)
  return rows[0] ?? null
}

export async function upsertBusiness(tx: Db, row: BusinessRow): Promise<void> {
  await tx
    .insert(billingBusiness)
    .values(row)
    .onConflictDoUpdate({ target: billingBusiness.sellerId, set: { sealed: row.sealed, masked: row.masked, receiptKind: row.receiptKind, updatedAt: row.updatedAt } })
}

// ── 증빙 요청 ─────────────────────────────────────────────────────────────

export type DocumentRow = typeof billingDocuments.$inferSelect

export async function insertDocument(tx: Db, row: typeof billingDocuments.$inferInsert): Promise<void> {
  await tx.insert(billingDocuments).values(row)
}

export async function documentOf(db: Db, sellerId: string, paymentId: string): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(billingDocuments)
    .where(and(eq(billingDocuments.sellerId, sellerId), eq(billingDocuments.paymentId, paymentId)))
    .limit(1)
  return rows[0] ?? null
}

export async function documentsOf(db: Db, sellerId: string): Promise<DocumentRow[]> {
  return db.select().from(billingDocuments).where(eq(billingDocuments.sellerId, sellerId))
}

export async function updateDocument(tx: Db, sellerId: string, paymentId: string, patch: Partial<Pick<DocumentRow, 'status' | 'approval' | 'cancel'>>, now: Date): Promise<void> {
  await tx
    .update(billingDocuments)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(billingDocuments.sellerId, sellerId), eq(billingDocuments.paymentId, paymentId)))
}

/** 운영자 목록: 발행 대기·발행 실패·취소 요청 증빙 (모든 판매자) */
export async function documentsToHandle(db: Db): Promise<DocumentRow[]> {
  return db
    .select()
    .from(billingDocuments)
    .where(sql`${billingDocuments.status} in ('PENDING', 'FAILED') or ${billingDocuments.cancel} in ('REQUESTED', 'FAILED')`)
    .orderBy(asc(billingDocuments.createdAt))
}

// ── 요청 번호 ─────────────────────────────────────────────────────────────

export async function findBillingRequest(db: Db, sellerId: string, requestId: string): Promise<{ kind: string; result: string } | null> {
  const rows = await db
    .select({ kind: billingRequests.kind, result: billingRequests.result })
    .from(billingRequests)
    .where(and(eq(billingRequests.sellerId, sellerId), eq(billingRequests.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertBillingRequest(tx: Db, row: { sellerId: string; requestId: string; kind: string; result: string; createdAt: Date }): Promise<void> {
  await tx.insert(billingRequests).values(row).onConflictDoNothing({ target: [billingRequests.sellerId, billingRequests.requestId] })
}

/** 요금 원장이 있는 판매자 (재생 무결성 검사) */
export async function sellersWithBilling(db: Db): Promise<string[]> {
  const found = new Set<string>()
  for (const table of [billingModes, billingUsage]) {
    for (const row of await db.selectDistinct({ sellerId: table.sellerId }).from(table)) found.add(row.sellerId)
  }
  return [...found].sort()
}
